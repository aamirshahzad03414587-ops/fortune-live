import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { ReplyEngine, filterComment, extractBirthDate, quickNumbers, detectLanguage, classifyIntent, cleanSpoken, spokenName, llmReply } from '../src/chat.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(chat = {}, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flc-'));
  const store = new Store(path.join(dir, 's.json'));
  let t = 1_000_000;
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 0 }, { name: 'Scroll', minDiamonds: 100, level: 3, secondsOnScreen: 0 }],
    readings: { fromComments: false, privateForm: true }, // legacy flow: private form + codes
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 5, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, mode: 'everyone', userCooldownSeconds: 60, maxQueue: 3, maxCommentAgeSeconds: 90, idlePromptSeconds: 0, greetCooldownSeconds: 0, greetDelaySeconds: 0, secondsBetweenReplies: 0, ...chat },
    overlay: { character: { prophecy: { enabled: true, tiers: [3], voiceOffset: 0, minSeconds: 0, crossfadeMs: 0 } } },
    ...extra,
  };
  const live = new LiveEngine({ config, store, now: () => t, estimate: () => 0.02 });
  return { live, store, advance: (ms) => (t += ms), config };
}

test('filters skip spam, links, profanity, emoji-only', () => {
  assert.equal(filterComment('hello mira'), null);
  assert.equal(filterComment('check www.win-money.com'), 'link');
  assert.equal(filterComment('join t.me/xyz'), 'link');
  assert.equal(filterComment('you are a bitch'), 'profanity');
  assert.equal(filterComment('chutiya'), 'profanity');
  assert.equal(filterComment('🔥🔥🔥'), 'emoji-only');
  assert.equal(filterComment('aaaaaaaaaaaaa'), 'spam-repeat');
  assert.equal(filterComment('hi hi hi hi hi'), 'spam-repeat');
  assert.equal(filterComment('BUY FOLLOWERS NOW CHEAP'), 'shouting');
  assert.equal(filterComment('a'), 'too-short');
  assert.equal(filterComment('Assalam o alaikum Mira, how are you?'), null);
  assert.equal(filterComment('kya meri shaadi hogi?'), null);
});

test('birth date parsing and quick numbers', () => {
  assert.deepEqual(extractBirthDate('I was born 14 march'), { day: 14, month: 3, year: null });
  assert.deepEqual(extractBirthDate('march 14th 1990'), { day: 14, month: 3, year: 1990 });
  assert.deepEqual(extractBirthDate('14/05/1990'), { day: 14, month: 5, year: 1990 });
  assert.equal(extractBirthDate('31 feb'), null);
  assert.equal(extractBirthDate('hello'), null);
  assert.deepEqual(quickNumbers({ day: 14, month: 5, year: 1990 }), { birthday: 5, personalYear: 2, lifePath: 11 });
});

test('intent + language detection', () => {
  assert.equal(classifyIntent('will I get married?'), 'love');
  assert.equal(classifyIntent('hello everyone'), 'greeting');
  assert.equal(classifyIntent('how do I get a reading'), 'howTo');
  assert.equal(classifyIntent('who are you'), 'aboutMira');
  assert.equal(classifyIntent('I have a fever'), 'health');
  assert.equal(classifyIntent('lol nice'), 'fallback');
  assert.equal(detectLanguage('kya meri shaadi hogi'), 'roman-ur');
  assert.equal(detectLanguage('السلام علیکم'), 'ur');
  assert.equal(detectLanguage('hello there'), 'en');
});

test('reply engine: personalised, varied, numbers from date, never asks for private data', () => {
  const r = new ReplyEngine();
  const a = new Set(); for (let i = 0; i < 6; i++) a.add(r.reply('hello', { nickname: 'ali_khan.22' }).text);
  assert.ok(a.size >= 4, 'greetings should vary');
  for (const t of a) assert.match(t, /Ali Khan/);
  const n = r.reply('born 14 may 1990', { nickname: 'sara' });
  assert.equal(n.intent, 'numbers'); assert.match(n.text, /Life Path 11/); assert.match(n.text, /Personal Year 2/);
  assert.match(r.reply('kya meri shaadi hogi', { nickname: 'zain' }).text, /Zain/);
  for (const q of ['hi', 'love?', 'money', 'job', 'thanks', 'who are you', 'what?', 'random words']) {
    const t = r.reply(q, { nickname: 'x' }).text;
    assert.doesNotMatch(t, /(your|apni) (full name|mother|father|phone|address)/i);
  }
  assert.match(r.reply('I want to die', { nickname: 'x' }).text, /helpline|trust/);
  assert.equal(spokenName('omar_fq.786'), 'Omar Fq');
});

test('cleanSpoken trims links, emojis and length', () => {
  assert.equal(cleanSpoken('Mira: Hello **dear** 🌙 visit https://x.com'), 'Hello dear visit');
  assert.ok(cleanSpoken(Array(100).fill('word.').join(' '), 20).split(' ').length <= 20);
});

test('llmReply calls an OpenAI-compatible endpoint with the persona', async () => {
  let sent;
  const fake = async (url, opts) => { sent = { url, body: JSON.parse(opts.body), auth: opts.headers.authorization }; return { ok: true, json: async () => ({ choices: [{ message: { content: '  Hello Ali, the stars smile on you tonight! ✨ ' } }] }) }; };
  const t = await llmReply({ baseUrl: 'https://api.example.com/v1/', apiKey: 'k', model: 'm' }, { nickname: 'ali_1', comment: 'hi' }, fake);
  assert.equal(t, 'Hello Ali, the stars smile on you tonight!');
  assert.equal(sent.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(sent.auth, 'Bearer k');
  assert.match(sent.body.messages[0].content, /Mystic Mira/);
  assert.match(sent.body.messages[0].content, /private/);
});

test('chat queue: one by one, cooldown, duplicates, max queue, filter modes', async () => {
  const { live, advance } = setup();
  const said = []; live.on('say', (s) => said.push(s));
  live.paused = true;
  assert.ok(live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hello mira' }).ok);
  assert.equal(live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hello again' }).reason, 'cooldown');
  assert.ok(live.handleChat({ userId: 'b', nickname: 'Sara', comment: 'will I marry?' }).ok);
  assert.ok(live.handleChat({ userId: 'c', nickname: 'Omar', comment: 'born 3 june' }).ok);
  assert.equal(live.handleChat({ userId: 'd', nickname: 'Zara', comment: 'hi' }).reason, 'chat-queue-full');
  assert.equal(live.handleChat({ userId: 'e', nickname: 'Spam', comment: 'free followers www.x.com' }).reason, 'link');
  advance(61e3);
  assert.equal(live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hey' }).reason, 'already-queued');
  live.setPaused(false);
  await sleep(250);
  assert.deepEqual(said.map((s) => s.comment.nickname), ['Ali', 'Sara', 'Omar']);
  assert.match(said[2].text, /Birthday number/);

  const g = setup({ mode: 'gifters' });
  assert.equal(g.live.handleChat({ userId: 'x', nickname: 'X', comment: 'hello' }).reason, 'not-gifter');
  g.live.paused = true;
  g.live.handleGift({ userId: 'x', nickname: 'X', giftName: 'Rose', diamonds: 1 });
  assert.ok(g.live.handleChat({ userId: 'x', nickname: 'X', comment: 'hello' }).ok);
  const f = setup({ mode: 'followers' });
  assert.equal(f.live.handleChat({ userId: 'y', nickname: 'Y', comment: 'hello' }).reason, 'not-follower');
  f.live.paused = true;
  assert.ok(f.live.handleChat({ userId: 'y', nickname: 'Y', comment: 'hello', isFollower: true }).ok);
});

test('stale comments are skipped', async () => {
  const { live, advance } = setup();
  const said = []; live.on('say', (s) => said.push(s)); live.paused = true;
  live.handleChat({ userId: 'a', nickname: 'Old', comment: 'hello' });
  advance(120e3);
  live.handleChat({ userId: 'b', nickname: 'New', comment: 'hello' });
  live.setPaused(false); await sleep(150);
  assert.deepEqual(said.map((s) => s.comment.nickname), ['New']);
});

test('priority: readings before greetings before chat; prophecy for tier 3', async () => {
  const { live, store } = setup();
  const order = []; live.on('reveal', (r) => order.push('reading:' + r.nickname + ':' + r.prophecy)); live.on('say', (s) => order.push(s.sub + ':' + (s.comment?.nickname || '')));
  live.paused = true;
  live.handleChat({ userId: 'c1', nickname: 'Chatter', comment: 'hello mira' });
  const s = store.create({ fullName: 'Ayesha Khan', dob: '1998-07-23' }, 24);
  live.handleGift({ userId: 'g1', nickname: 'Ayesha', giftName: 'Hand Hearts', diamonds: 100 });
  live.handleChat({ userId: 'g1', nickname: 'Ayesha', comment: '#' + s.code });
  live.handleFollow({ userId: 'f1', nickname: 'NewFan' });
  live.setPaused(false); await sleep(300);
  assert.deepEqual(order, ['reading:Ayesha:true', 'greet:', 'reply:Chatter']);
});

test('reading speech uses voice offset and extends screen time to fit audio', async () => {
  const { live, store, config } = setup();
  config.overlay.character.prophecy = { enabled: true, tiers: [1, 3], voiceOffset: 5, crossfadeMs: 600 };
  live.tts = { synth: async () => ({ url: '/tts/x.mp3', duration: 12, voice: 'v' }) };
  live.paused = true;
  const s = store.create({ fullName: 'Ayesha Khan', dob: '1998-07-23' }, 24);
  live.handleGift({ userId: 'g', nickname: 'A', giftName: 'Rose', diamonds: 1 });
  live.handleChat({ userId: 'g', nickname: 'A', comment: s.code });
  const got = new Promise((r) => live.once('reveal', r));
  live.setPaused(false);
  const r = await got;
  assert.equal(r.prophecy, true); assert.equal(r.speech.start, 5); assert.equal(r.speech.url, '/tts/x.mp3');
  assert.ok(r.seconds >= 5 + 12);
  live.skip(); live.paused = true;
});

test('TTS failure falls back to text-only speech payload', async () => {
  const { live } = setup();
  live.tts = { synth: async () => null };
  const got = new Promise((r) => live.once('say', r));
  live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hello' });
  const s = await got;
  assert.equal(s.speech.url, null); assert.equal(s.speech.server, false); assert.ok(s.text.length > 5);
  live.paused = true; live.skip();
});

test('LLM errors fall back to rule replies; LLM used when configured', async () => {
  const { live } = setup({}, { llm: { enabled: true, baseUrl: 'x', apiKey: 'k', model: 'm' } });
  live.llm = async () => { throw new Error('down'); };
  let s = new Promise((r) => live.once('say', r));
  live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hello' });
  assert.equal((await s).source, 'rules');
  live.paused = true; live.skip(); live.paused = false;
  live.ai.nextAt = 0;   // the request gate keeps a gap after every request (also failed ones); open it for the test
  live.llm = async () => 'Hello Sara, the moon adores you.';
  s = new Promise((r) => live.once('say', r));
  live.handleChat({ userId: 'b', nickname: 'Sara', comment: 'hi' });
  const got = await s; assert.equal(got.source, 'llm'); assert.equal(got.text, 'Hello Sara, the moon adores you.');
  live.paused = true; live.skip();
});

test('idle prompt fires after N seconds of silence while stream active', async () => {
  const { live } = setup({ idlePromptSeconds: 0.05 });
  live.touch();
  const got = new Promise((r) => live.once('say', r));
  live.pump();
  const s = await got; assert.equal(s.sub, 'prompt'); assert.ok(s.text.length > 10);
  live.paused = true; live.skip(); live.newStream();
});

test('a gift followed quickly by a code becomes a reading, not a thank-you', async () => {
  let t = 5_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flg-'));
  const store = new Store(path.join(dir, 's.json'));
  const { config } = setup({ greetDelaySeconds: 4 });
  const live = new LiveEngine({ config, store, now: () => t, estimate: () => 0.01 });
  const seen = []; live.on('say', (s) => seen.push(s.sub)); live.on('reveal', () => seen.push('reading'));
  const s = store.create({ fullName: 'Ayesha Khan', dob: '1998-07-23' }, 24);
  live.handleGift({ userId: 'g', nickname: 'Ayesha', giftName: 'Rose', diamonds: 1 });
  await sleep(30); assert.deepEqual(seen, []); // greeting is waiting
  live.handleChat({ userId: 'g', nickname: 'Ayesha', comment: s.code });
  await sleep(30); t += 5000; live.pump(); await sleep(60);
  assert.deepEqual(seen, ['reading']);
  // another gifter without code is thanked after the delay
  live.handleGift({ userId: 'h', nickname: 'Hamza', giftName: 'Rose', diamonds: 1 });
  t += 5000; await sleep(120); live.pump(); await sleep(60);
  assert.ok(seen.includes('greet'));
  live.paused = true; live.skip(); live.newStream();
});
