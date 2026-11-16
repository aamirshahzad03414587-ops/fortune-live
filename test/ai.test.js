import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { llmReply, LlmError, cleanSpoken, isQuestion, spokenName, withQuestion, scriptHint } from '../src/chat.js';
import { AiGate, Memory, PROVIDERS, llmReady, withName, stripName, langOf, topicOf } from '../src/ai.js';
import { loadConfig } from '../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = { ...PROVIDERS.pollinations, enabled: true, temperature: 0.9 };
const okFetch = (content, seen = []) => async (url, opt) => { seen.push({ url, opt, body: JSON.parse(opt.body) }); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }; };

function setup({ chat = {}, readings = { fromComments: false, privateForm: false }, llm = { ...POLL } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fla-'));
  const store = new Store(path.join(dir, 's.json'));
  const clock = { t: 5_000_000 };
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 0 }],
    readings, limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 5, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, mode: 'everyone', userCooldownSeconds: 60, maxQueue: 8, maxCommentAgeSeconds: 90, idlePromptSeconds: 0, greetCooldownSeconds: 0, greetDelaySeconds: 0, secondsBetweenReplies: 0, welcomeJoins: false, ...chat },
    llm,
  };
  const live = new LiveEngine({ config, store, now: () => clock.t, estimate: () => 0.02 });
  live.paused = true;
  return { live, clock, config };
}

test('keyless provider: no Authorization header, persona + history + language hint, reasoning effort', async () => {
  const seen = [];
  const text = await llmReply(POLL, { nickname: 'zain_99', comment: 'کیا میری شادی ہوگی؟', history: [{ role: 'user', content: 'salam' }, { role: 'assistant', content: 'Zain, salam!' }] }, okFetch('**Zain**, ہاں، ستارے کہتے ہیں ✨ https://x.com', seen));
  assert.equal(seen[0].url, 'https://text.pollinations.ai/openai/chat/completions');
  assert.equal(seen[0].opt.headers.authorization, undefined);
  const b = seen[0].body;
  assert.equal(b.model, 'openai'); assert.equal(b.reasoning_effort, 'low'); assert.equal(b.max_tokens, undefined);
  assert.deepEqual(b.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.match(b.messages[3].content, /Answer entirely in Urdu/);
  assert.match(b.messages[0].content, /Start your reply with the viewer's name/);
  assert.equal(text, 'Zain, ہاں، ستارے کہتے ہیں');            // markdown, emoji and links stripped, Urdu kept
  // with a key: Bearer header
  const s2 = []; await llmReply({ baseUrl: 'https://api.x/v1', model: 'm', apiKey: 'k' }, { nickname: 'a', comment: 'hi' }, okFetch('Hi', s2));
  assert.equal(s2[0].opt.headers.authorization, 'Bearer k');
  await assert.rejects(llmReply({ baseUrl: 'https://api.x/v1', model: 'm' }, { nickname: 'a', comment: 'hi' }, okFetch('x')), /not configured/);
});

test('rate limit (402 FREE_LIMIT): Retry-After read from the body, gate closes for that long', async () => {
  const f402 = async () => ({ ok: false, status: 402, headers: { get: () => null }, text: async () => '{"code":"FREE_LIMIT","message":"Free limit reached: 1 reply every 45 seconds per IP. Retry after 42s"}' });
  const e = await llmReply(POLL, { nickname: 'a', comment: 'hi' }, f402).catch((x) => x);
  assert.ok(e instanceof LlmError); assert.equal(e.status, 402); assert.equal(e.retryAfter, 42);
  let t = 0; const g = new AiGate({ now: () => t });
  await assert.rejects(g.ask(POLL, { comment: 'hi', name: 'A' }, () => Promise.reject(e)));
  assert.equal(g.open(), false); t += 42_000; assert.equal(g.open(), false); t += 4000; assert.equal(g.open(), true);
  const slow = async () => { throw new LlmError('LLM timeout'); };
  assert.equal(await llmReply({ ...POLL, timeoutMs: 20 }, { nickname: 'a', comment: 'hi' }, (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))))).catch((x) => x.message), 'LLM timeout');
  assert.ok(slow);
});

test('gate: one request at a time, minimum gap, cache re-personalised for the next viewer', async () => {
  let t = 0; const g = new AiGate({ now: () => t });
  const L = { minIntervalSeconds: 45, cacheSeconds: 300 };
  const r1 = await g.ask(L, { comment: 'What is the capital of Japan?', name: 'Ali', cacheable: true }, async () => 'Ali, Tokyo shines like a lantern.');
  assert.equal(r1.text, 'Ali, Tokyo shines like a lantern.');
  t += 10_000;
  await assert.rejects(g.ask(L, { comment: 'tell me a joke', name: 'Bo' }, async () => 'x'), (e) => e.refused);
  const r2 = await g.ask(L, { comment: 'what is the capital of japan', name: 'Sara', cacheable: true }, async () => { throw new Error('should be cached'); });
  assert.deepEqual(r2, { text: 'Sara, tokyo shines like a lantern.', cached: true });
  assert.equal(g.stats.cached, 1); assert.equal(g.stats.refused, 1);
  assert.equal(withName('Ali', 'I see love'), 'Ali, I see love'); assert.equal(stripName('Ali', 'Ali, the stars'), 'The stars');
});

test('memory: facts, context for the AI, awaiting an answer, capped, cleared per stream', () => {
  let t = 0; const m = new Memory({ now: () => t, maxViewers: 3, maxTurns: 4 });
  m.learn('u1', 'sara.k', 'I was born 12 may 1998, will I find love?');
  m.add('u1', 'user', 'will I find love?'); m.add('u1', 'assistant', 'Sara, love is near. Is it someone you already know?');
  assert.equal(m.awaiting('u1'), true);
  const ctx = m.context('u1');
  assert.match(ctx, /born 12\/5\/1998 \(Taurus, Life Path 8, Personal Year 9 in 2026\)/); assert.match(ctx, /love/); assert.match(ctx, /answers the question you just asked/);
  t += 200_000; assert.equal(m.awaiting('u1'), false);
  for (let i = 0; i < 6; i++) m.add('u1', 'user', 'x' + i);
  assert.equal(m.history('u1').length, 4);
  for (const u of ['u2', 'u3', 'u4']) { t += 1; m.learn(u, u, 'hi'); }
  assert.equal(m.has('u1'), false); assert.equal(m.has('u4'), true);   // oldest viewer dropped
  assert.equal(langOf('کیا حال ہے'), 'Urdu (Urdu script)'); assert.equal(langOf('ما هو'), 'Arabic'); assert.equal(langOf('क्या'), 'Hindi (Devanagari)');
  assert.equal(topicOf('will I marry this year'), 'love'); assert.equal(topicOf('meri naukri'), 'career');
  const { live } = setup();
  live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'hello mira' });
  assert.equal(live.memory.has('a'), true); live.newStream(); assert.equal(live.memory.has('a'), false);
});

test('any language: questions, names and spoken text keep their script', () => {
  assert.equal(isQuestion('کیا میری شادی ہوگی؟'), true); assert.equal(isQuestion('क्या मुझे नौकरी मिलेगी'), true); assert.equal(isQuestion('هل سأسافر'), true);
  assert.equal(spokenName('राहुल.k'), 'राहुल K');
  assert.equal(cleanSpoken('मीरा कहती है: सितारे चमक रहे हैं। 🌟'), 'मीरा कहती है: सितारे चमक रहे हैं।');
  assert.equal(withQuestion('zain', 'کیا میری شادی ہوگی؟', 'زین، ہاں'), 'زین، ہاں');
  assert.equal(scriptHint('hello'), '');
});

test('live: AI answers questions with memory; unsafe or failed answers fall back; gate refusal -> built-in reply', async () => {
  const { live, clock } = setup();
  const calls = [];
  live.llm = async (L, a) => { calls.push(a); return 'Sara, love is close. Love or career next?'; };
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'will I find love?' });
  const r = await live.prepared.get(live.chatQueue[0].id);   // made in the background as soon as it was queued
  assert.equal(r.source, 'llm'); assert.match(r.text, /^Sara asks, will I find love\? Love is close/);   // question read aloud, then her answer
  assert.equal(calls[0].history.length, 0); assert.match(calls[0].context, /What you know about Sara/);
  // next viewer within the 45 s gap: built-in reply, she is never silent
  live.handleChat({ userId: 'b', nickname: 'Bo', comment: 'what is my lucky colour?' });
  const r2 = await live.makeReply(live.chatQueue[1]);
  assert.equal(r2.source, 'rules'); assert.ok(r2.text.length > 5);
  // unsafe AI output is never spoken
  clock.t += 60_000; live.llm = async () => 'Bo, visit www.win-money.com now';
  assert.equal((await live.makeReply(live.chatQueue[1])).source, 'rules');
  // a birth date in chat: numbers from code, not the AI
  clock.t += 60_000; live.llm = async () => { throw new Error('not called'); };
  assert.match((await live.makeReply({ userId: 'z', nickname: 'Zed', comment: 'my birthday is 3rd agust' })).text, /Personal Year/);
  // prefetch while the gate is closed: nothing stored, retried when it is her turn
  clock.t += 1000; live.ai.nextAt = clock.t + 30_000;
  assert.equal(await live.makeReply({ userId: 'q', nickname: 'Q', comment: 'why is the sky blue?', question: true }, { prefetch: true }), null);
});

test('two-way: her question -> the viewer\'s next comment continues the thread (no cooldown, first in line, with history)', async () => {
  const { live, clock } = setup();
  const seen = [];
  live.llm = async (L, a) => { seen.push(a); return seen.length === 1 ? 'Sara, the cards whisper change. Is it love or career?' : 'Sara, then love it is: Venus smiles on you in spring.'; };
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'what will 2026 bring me?' });
  const item = live.chatQueue.find((q) => q.userId === 's');
  await live.prepared.get(item.id); live.chatQueue = live.chatQueue.filter((q) => q !== item); live.lastReplyAt.set('s', clock.t);
  clock.t += 20_000;   // inside the 60 s cooldown, but she asked them something
  live.handleChat({ userId: 'o', nickname: 'Other', comment: 'nice stream' });
  const res = live.handleChat({ userId: 's', nickname: 'Sara', comment: 'love' });
  assert.equal(res.ok, true); assert.equal(live.chatQueue[0].userId, 's'); assert.equal(live.chatQueue[0].followUp, true);
  clock.t += 30_000;
  const r = await live.makeReply(live.chatQueue[0]);
  assert.equal(r.source, 'llm');
  assert.deepEqual(seen[1].history.map((h) => h.role), ['user', 'assistant']);
  assert.match(seen[1].context, /talking about love/); assert.match(seen[1].context, /answers the question you just asked/);
  // without her question the cooldown still applies
  live.handleChat({ userId: 'o2', nickname: 'O2', comment: 'hello' }); live.lastReplyAt.set('o2', clock.t);
  assert.equal(live.handleChat({ userId: 'o2', nickname: 'O2', comment: 'hello again' }).reason, 'cooldown');
});

test('fair turns: nobody gets more than 2 replies in a row while others wait; copy-paste spam dropped', () => {
  const { live } = setup();
  live.replyStreak = 2; live.lastReplyUser = 's';
  live.chatQueue = [{ id: 1, userId: 's', nickname: 'Sara', comment: 'and money?', at: live.now(), followUp: true }, { id: 2, userId: 'b', nickname: 'Bo', comment: 'hi', at: live.now() }];
  assert.equal(live.nextJob().chat.userId, 'b');
  assert.equal(live.nextJob().chat.userId, 's');
  live.handleChat({ userId: 'x1', nickname: 'X1', comment: 'FOLLOW ME for luck' });
  assert.equal(live.handleChat({ userId: 'x2', nickname: 'X2', comment: 'follow me  for luck' }).reason, 'duplicate');
});

test('engage: when quiet, she asks an active chatter something by name; their reply continues it', () => {
  const { live, clock } = setup({ chat: { engageChance: 1 } });
  live.memory.learn('s', 'Sara', 'hello mira, born 12 may 1998'); live.memory.add('s', 'user', 'hello mira');
  clock.t += 60_000;
  const j = live.engageLine();
  assert.equal(j.sub, 'engage'); assert.match(j.text, /Sara/); assert.match(j.text, /\?$/);
  assert.equal(live.memory.awaiting('s'), true);
  assert.equal(live.engageLine(), null);   // not the same person again right away
});

test('messy dates live: impossible date -> she asks, the answer completes the reading; no year -> short reading', async () => {
  const { live, clock } = setup({ readings: { fromComments: true, privateForm: false } });
  const a = live.handleChat({ userId: 's', nickname: 'sara_x', comment: 'Sara 31/02/1999 will I travel?' });
  assert.match(a.asked, /^Sara, February has no 31st/);
  assert.equal(live.chatQueue[0].preset, a.asked);
  clock.t += 30_000;
  const b = live.handleChat({ userId: 's', nickname: 'sara_x', comment: '28 feb' });
  assert.equal(b.ok, true); assert.equal(b.item.parsed.dob, '1999-02-28'); assert.equal(b.item.name, 'Sara');
  const c = live.handleChat({ userId: 'h', nickname: 'hina_k', comment: 'born 14 march, will I get a job?' });
  assert.equal(c.ok, true); assert.deepEqual(c.item.keyNumbers.map((k) => k.label), ['Birthday', 'Year 2026']); assert.match(c.item.spoken, /birth year/);
  assert.equal(c.item.caption.title, 'Hina K · 14 March');
});

test('messy dates live: ambiguous (askAmbiguous) -> "5 December or 12 May?"; AI reads what the rules cannot', async () => {
  const { live, clock } = setup({ readings: { fromComments: true, privateForm: false, askAmbiguous: true } });
  const a = live.handleChat({ userId: 's', nickname: 'sara_x', comment: 'Sara 05/12/1998' });
  assert.equal(a.asked, 'Sara, is that 5 December 1998 or 12 May 1998?');
  clock.t += 10_000;
  const b = live.handleChat({ userId: 's', nickname: 'sara_x', comment: 'may' });
  assert.equal(b.item.parsed.dob, '1998-05-12');
  // the AI fallback parser (mocked)
  const sent = [];
  live.complete = async (L, msgs) => { sent.push(msgs); return '{"day":5,"month":12,"year":1998,"name":"Omar","clear":true,"options":[]}'; };
  const r = live.handleChat({ userId: 'o', nickname: 'omar_1', comment: 'omar here dob 5 dicmbr 98' });
  assert.equal(r.pending, 'date-ai');
  await sleep(10);
  assert.match(sent[0][0].content, /birth dates/); assert.equal(live.queue.find((q) => q.userId === 'o').parsed.dob, '1998-12-05');
  // AI unsure -> she asks with its two options
  clock.t += 60_000;
  live.complete = async () => '{"day":null,"month":null,"year":null,"clear":false,"options":[{"day":4,"month":6,"year":2001},{"day":6,"month":4,"year":2001}]}';
  live.handleChat({ userId: 'p', nickname: 'pia', comment: 'dob 0406 2001 plz' });
  await sleep(10);
  assert.equal(live.chatQueue.find((q) => q.userId === 'p').preset, 'Pia, is that 4 June 2001 or 6 April 2001?');
  // no AI at all: she asks right away
  live.config.llm = { enabled: false };
  assert.match(live.handleChat({ userId: 'q', nickname: 'qasim', comment: 'born 1999 on the 31 feb' }).asked || '', /Qasim/);
});

test('config: LLM_PROVIDER=pollinations turns the free keyless AI on; multilingual voice by default', () => {
  const old = { ...process.env };
  try {
    process.env.LLM_PROVIDER = 'pollinations'; delete process.env.LLM_API_KEY; delete process.env.LLM_ENABLED;
    const c = loadConfig();
    assert.equal(llmReady(c.llm), true); assert.equal(c.llm.noKey, true); assert.equal(c.llm.baseUrl, 'https://text.pollinations.ai/openai');
    assert.equal(c.voice.voice, 'en-US-AvaMultilingualNeural');
    process.env.LLM_ENABLED = '0'; assert.equal(llmReady(loadConfig().llm), false);
  } finally { process.env = old; }
});
