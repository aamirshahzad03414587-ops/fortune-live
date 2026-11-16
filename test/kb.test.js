import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { answerMystic, intentOf, mysticSnippets, CARDS, SIGNS, moonPhase, signOf, chineseOf, COMMAND_PROMPTS } from '../src/kb/index.js';
import { draw, findCard } from '../src/kb/tarot.js';
import { compatibility, signByName } from '../src/kb/astro.js';
import { numerologyExtras, angelNumber, DREAMS, findDream } from '../src/kb/lore.js';

const now = new Date('2026-11-17T00:00:00+04:00');
const seeded = (s = 7) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const ask = (t, facts = { dob: '12/5/1998' }, random = seeded()) => answerMystic(t, { name: 'Sara', facts, now, random });

test('knowledge base: 78 tarot cards, 12 signs, ~50 dream symbols', () => {
  assert.equal(CARDS.length, 78); assert.equal(new Set(CARDS.map((c) => c.name)).size, 78);
  assert.equal(CARDS.filter((c) => c.arcana === 'major').length, 22);
  for (const c of CARDS) assert.ok(c.up && c.rev, c.name);
  assert.equal(SIGNS.length, 12); assert.ok(DREAMS.length >= 50);
  const three = draw(3, seeded(3)); assert.equal(new Set(three.map((c) => c.name)).size, 3);
  assert.equal(findCard('what does the 3 of coins mean').name, 'Three of Pentacles');
});

test('astro: sun signs on the cusps, Chinese zodiac, compatibility, moon phase computed for the date', () => {
  assert.equal(signOf(19, 4).name, 'Aries'); assert.equal(signOf(20, 4).name, 'Taurus'); assert.equal(signOf(31, 12).name, 'Capricorn'); assert.equal(signOf(19, 1).name, 'Capricorn'); assert.equal(signOf(20, 1).name, 'Aquarius');
  assert.deepEqual([chineseOf(1998, 5, 12).animal, chineseOf(1998, 5, 12).element], ['Tiger', 'Earth']);
  assert.equal(chineseOf(2026).animal, 'Horse'); assert.equal(chineseOf(1999, 1, 10).animal, 'Tiger');   // January: previous lunar year
  assert.ok(compatibility(signByName('Leo'), signByName('Aries')).score >= 85);
  assert.ok(compatibility(signByName('Leo'), signByName('Cancer')).score < 70);
  assert.equal(moonPhase(new Date('2026-11-24T14:00:00Z')).name, 'Full Moon');      // full moon 24 Nov 2026
  assert.equal(moonPhase(new Date('2026-11-09T12:00:00Z')).name, 'New Moon');       // new moon 9 Nov 2026
  assert.equal(moonPhase(now).name, 'First Quarter');
});

test('numerology extras: personal month / day, master numbers, karmic debt', () => {
  const x = numerologyExtras({ day: 12, month: 5, year: 1998 }, now);
  assert.deepEqual([x.personalYear, x.personalMonth, x.personalDay, x.lifePath], [9, 2, 1, 8]);
  assert.deepEqual(numerologyExtras({ day: 29, month: 11, year: 1990 }, now).master, [11]);   // born on the 29th -> 11
  assert.deepEqual(numerologyExtras({ day: 13, month: 3, year: 1990 }, now).karmic, [13]);
  assert.match(angelNumber('444'), /protection/); assert.match(angelNumber('777'), /luck/); assert.match(angelNumber('8888'), /abundance/);
  assert.equal(findDream('I dreamt about snakes').symbol, 'snakes'); assert.match(findDream('dream of death').meaning, /not literal/);
});

test('commands: every one answers without the AI, with the name, short, varied', () => {
  const cmds = { tarot: 'card', 'pull a card': 'card', '3 cards': 'three', 'my zodiac': 'zodiac', 'love match Leo Aries': 'match', 'dream about snakes': 'dream', 'angel number 444': 'angel',
    'moon today': 'moon', 'lucky colour': 'lucky', 'lucky number': 'lucky', 'what does the tower mean?': 'cardInfo', 'chinese zodiac': 'chinese', 'palm reading': 'palm', 'crystal for love': 'crystal', 'love ritual': 'ritual', 'my personal day': 'numerology', '777': 'angel', 'card nikalo': 'card' };
  for (const [t, intent] of Object.entries(cmds)) {
    const r = ask(t);
    assert.ok(r, t); assert.equal(r.intent, intent, t); assert.match(r.text, /Sara/, t);
    assert.ok(r.text.split(/\s+/).length <= 50, `${t}: ${r.text.split(/\s+/).length} words`);
    assert.doesNotMatch(r.text, /\b(guarantee|will die|cure|diagnos|invest)\w*/i, t);
  }
  for (const t of ['hi mira', 'will I find love?', 'nice live', 'what is my lucky number?']) assert.equal(intentOf(t) === 'lucky' ? 'lucky' : intentOf(t), t.includes('lucky') ? 'lucky' : null, t);
  assert.match(ask('my zodiac').text, /Taurus/);
  assert.match(ask('love match Leo Aries').text, /Leo/); assert.match(ask('love match Leo Aries').text, /Aries/);
  assert.match(ask('moon today').text, /First Quarter/);
  assert.match(ask('my zodiac', {}).text, /\?$/);           // no birth date known: she asks (and waits for the answer)
  const r = ask('3 cards'); assert.equal(r.cards.length, 3);
  const texts = new Set(Array.from({ length: 8 }, (_, i) => ask('pull a card', {}, seeded(i + 1)).text)); assert.ok(texts.size >= 6);
  assert.match(mysticSnippets('is leo good for me? I dreamt of water', { dob: '12/5/1998' }, now), /Taurus.*Leo.*water/s);
  assert.equal(mysticSnippets('hello', {}, now), '');
  assert.ok(COMMAND_PROMPTS.length >= 6);
});

test('live: commands answered from the knowledge base (not the AI), card info for the overlay, AI gets snippets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flk-'));
  let t = Date.parse('2026-11-17T00:00:00+04:00');
  const config = { trigger: { giftName: 'Rose', minDiamonds: 1 }, tiers: [{ name: 'S', minDiamonds: 1, level: 1, secondsOnScreen: 0 }], readings: { fromComments: true },
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 5, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, mode: 'everyone', userCooldownSeconds: 0, maxQueue: 8, maxCommentAgeSeconds: 90, idlePromptSeconds: 0, greetCooldownSeconds: 0, greetDelaySeconds: 0, secondsBetweenReplies: 0, welcomeJoins: false, readQuestionAloud: false },
    llm: { enabled: true, baseUrl: 'https://x', model: 'm', noKey: true } };
  const live = new LiveEngine({ config, store: new Store(path.join(dir, 's.json')), now: () => t, estimate: () => 0.01 });
  const asked = [];
  live.llm = async (L, a) => { asked.push(a); return 'Sara, Leo hearts burn bright.'; };
  live.paused = true;
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'pull a card' });
  const said = new Promise((r) => live.once('say', r)); live.setPaused(false);
  const s = await said; live.paused = true;
  assert.equal(s.source, 'kb'); assert.equal(s.cards.length, 1); assert.ok(s.mood); assert.equal(asked.length, 0);
  live.memory.setDob('s', { day: 12, month: 5, year: 1998 });
  assert.match((await live.makeReply({ userId: 's', nickname: 'Sara', comment: 'my zodiac' })).text, /Taurus/);   // remembered birth date
  await live.makeReply({ userId: 's', nickname: 'Sara', comment: 'is a leo man good for me?', question: true });
  assert.equal(asked.length, 1); assert.match(asked[0].context, /Mystic facts.*Taurus.*Leo/s);
  live.idleCount = 1; assert.ok(COMMAND_PROMPTS.includes(live.idleLine()));
});
