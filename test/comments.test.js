import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { ReplyEngine } from '../src/chat.js';
import { findBirthDate, parseReadingComment, readingScript } from '../src/comment-reading.js';
import { computeReading, lifePathNumber, personalYearNumber } from '../src/numerology.js';

const d = (t) => { const r = findBirthDate(t); return r && `${r.year}-${r.month}-${r.day}`; };

test('dates: common formats, DD/MM by default, MM/DD when the second number is over 12', () => {
  assert.equal(d('12/05/1998'), '1998-5-12');
  assert.equal(d('12-5-1998'), '1998-5-12');
  assert.equal(d('12.05.1998'), '1998-5-12');
  assert.equal(d('12 May 1998'), '1998-5-12');
  assert.equal(d('12th of May, 1998'), '1998-5-12');
  assert.equal(d('May 12 1998'), '1998-5-12');
  assert.equal(d('May 12th, 1998'), '1998-5-12');
  assert.equal(d('1998-05-12'), '1998-5-12');
  assert.equal(d('05/25/1990'), '1990-5-25');   // MM/DD fallback
  assert.equal(d('3/7/01'), '2001-7-3');        // two-digit year
  assert.equal(d('31/02/1999'), null);          // no such day
  assert.equal(d('born 14 march'), null);       // no year -> normal chat answer
  assert.equal(d('hello 2026'), null);
  assert.equal(d('12/05/2030'), null);          // future
});

test('comment parser: name, parents, question; TikTok name when no name is given', () => {
  const p = parseReadingComment('Ayesha Khan 12/05/1998 mother Sara father Ali will I travel this year?', 'aye_99');
  assert.deepEqual([p.name, p.dob, p.mother, p.father, p.question, p.nameFromProfile], ['Ayesha Khan', '1998-05-12', 'Sara', 'Ali', 'will I travel this year?', false]);
  const q = parseReadingComment('my name is Omar, born 05/25/1990, should I start a business?', 'omar.fq');
  assert.deepEqual([q.name, q.dob, q.question], ['Omar', '1990-05-25', 'should I start a business?']);
  const r = parseReadingComment('12 May 1998', 'zara_khan_7');
  assert.equal(r.name, 'Zara Khan'); assert.equal(r.nameFromProfile, true); assert.equal(r.question, '');
  const s = parseReadingComment('Hina 1/2/2000 mom Sara Malik dad Ali Raza, will I marry?', 'h');
  assert.deepEqual([s.name, s.mother, s.father, s.question], ['Hina', 'Sara Malik', 'Ali Raza', 'will I marry?']);
  const t = parseReadingComment('May 12 1998 Bilal ahmed', 'x');
  assert.equal(t.name, 'Bilal Ahmed');
  const u = parseReadingComment('dob 12th of March, 1995 ammi Nadia abbu Imran kya meri job lagegi?', 'sana_22');
  assert.deepEqual([u.name, u.mother, u.father, u.question], ['Sana', 'Nadia', 'Imran', 'kya meri job lagegi?']);
  assert.equal(parseReadingComment('hi Mira, will I find love?', 'x'), null);
});

test('reading script: real numbers, short enough to speak in about 15-25 s', () => {
  const p = parseReadingComment('Ayesha 12/05/1998 will I travel this year?', 'a');
  const r = computeReading({ fullName: p.name, dob: p.dob, question: p.question });
  const s = readingScript(r, p, 1);
  assert.equal(s.keyNumbers[0].value, lifePathNumber('1998-05-12'));
  assert.equal(s.keyNumbers[1].value, personalYearNumber('1998-05-12', 2026));
  assert.match(s.spoken, /^(Ah, |Here we go, )?Ayesha, .*12 May 1998\./);
  assert.match(s.spoken, /Life Path 8|Number 8 rules your Life Path/);
  assert.match(s.spoken, /Personal Year 9/);
  assert.match(s.spoken, /will I travel this year\?/);
  const words = s.spoken.split(/\s+/).length;
  assert.ok(words >= 35 && words <= 70, `${words} words`);
});

function setup(readings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-c-'));
  const clock = { t: 1_000_000 };
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short reading', minDiamonds: 1, level: 1, secondsOnScreen: 20 }, { name: 'Extended reading', minDiamonds: 30, level: 2, secondsOnScreen: 30 }],
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 30, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, idlePromptSeconds: 0, welcomeJoins: false },
    readings: { maxQueue: 3, howToEverySeconds: 75, ...readings },
  };
  const live = new LiveEngine({ config, store: new Store(path.join(dir, 's.json')), now: () => clock.t, estimate: () => 0.01, replies: new ReplyEngine({ random: () => 0 }) });
  live.paused = true;
  return { live, clock, config };
}
const chat = (live, nick, comment) => live.handleChat({ userId: 'u_' + nick, nickname: nick, comment });

test('live: a birth-date comment becomes a free reading, no gift and no code needed', () => {
  const { live } = setup();
  const r = chat(live, 'aye_99', 'Ayesha 12/05/1998 will I travel this year?');
  assert.equal(r.ok, true); assert.equal(r.item.kind, 'reading'); assert.equal(r.item.tierName, 'Live prediction');
  assert.equal(r.item.caption.title, 'Ayesha · 12 May 1998'); assert.equal(r.item.caption.text, 'will I travel this year?');
  assert.equal(live.chatQueue.length, 0);
  // a comment without a date is a normal chat reply
  assert.equal(chat(live, 'bob', 'hello Mira!').chat?.comment, 'hello Mira!');
  const job = live.nextJob(); assert.equal(job.kind, 'reading');
});

test('live: one reading per viewer per stream, queue cap for free readings, gifters always get in', () => {
  const { live } = setup();
  assert.equal(chat(live, 'a', 'Ali 1/1/1990').ok, true);
  assert.equal(chat(live, 'a', 'Ali 1/1/1990').reason, 'already-queued');
  live.queue.shift();
  assert.equal(chat(live, 'a', 'Ali 2/2/1990').reason, 'user-limit');
  chat(live, 'b', 'Bea 2/2/1992'); chat(live, 'c', 'Cy 3/3/1993'); chat(live, 'd', 'Di 4/4/1994');
  assert.equal(chat(live, 'e', 'Ed 5/5/1995').reason, 'queue-full');
  live.handleGift({ userId: 'u_f', nickname: 'f', giftName: 'Rose', diamonds: 1 });
  const r = chat(live, 'f', 'Fay 6/6/1996');
  assert.equal(r.ok, true); assert.equal(r.item.tierName, 'Short reading');
  assert.equal(live.queue[0].name, 'Fay'); // gifter first
});

test('live: a gift after the comment moves the viewer up; bigger gifts beat smaller ones', () => {
  const { live } = setup({ maxQueue: 10 });
  chat(live, 'a', 'Ali 1/1/1990'); chat(live, 'b', 'Bea 2/2/1992'); chat(live, 'c', 'Cy 3/3/1993');
  live.handleGift({ userId: 'u_c', nickname: 'c', giftName: 'Rose', diamonds: 1 });
  assert.deepEqual(live.queue.map((q) => q.name), ['Cy', 'Ali', 'Bea']);
  live.handleGift({ userId: 'u_b', nickname: 'b', giftName: 'Doughnut', diamonds: 30 });
  assert.deepEqual(live.queue.map((q) => q.name), ['Bea', 'Cy', 'Ali']);
  assert.equal(live.queue[0].tierName, 'Extended reading'); assert.match(live.queue[0].spoken, /Soul Urge/);
});

test('live: requireGift=true waits for the gift, then reads the saved comment', () => {
  const { live } = setup({ requireGift: true });
  assert.equal(chat(live, 'a', 'Ali 1/1/1990 will I be rich?').reason, 'needs-gift');
  assert.equal(live.queue.length, 0);
  const r = live.handleGift({ userId: 'u_a', nickname: 'a', giftName: 'Rose', diamonds: 1 });
  assert.equal(r.ok, true); assert.equal(live.queue[0].parsed.question, 'will I be rich?');
});

test('live: Mira tells people how to ask now and then; no bio/code talk in comment mode', () => {
  const { live, clock } = setup();
  chat(live, 'x', 'how do I get a reading?');
  assert.doesNotMatch(live.replies.reply('how do I get a reading?', { nickname: 'x' }).text, /bio|code/i);
  clock.t += 80e3; chat(live, 'y', 'hello');
  const job = live.nextJob();
  assert.equal(job.sub, 'prompt'); assert.match(job.text, /name|birth/i);
  assert.equal(live.nextJob().sub, 'reply');
});
