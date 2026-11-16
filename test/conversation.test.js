// Every comment answered, a question back when she does not understand, "thinking" fillers, reading sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { unclearKind, clarifyLine, sessionLine } from '../src/talk.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup({ chat = {}, readings = {}, llm = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flv-'));
  let t = 1_000_000;
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 0 }],
    readings: { fromComments: true, requireGift: false, perViewerPerStream: 1, maxQueue: 10, freeSeconds: 0, howToEverySeconds: 0, ...readings },
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 5, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, mode: 'everyone', maxQueue: 8, maxCommentAgeSeconds: 90, idlePromptSeconds: 0, greetCooldownSeconds: 0, greetDelaySeconds: 0, secondsBetweenReplies: 0, welcomeJoins: false, readQuestionAloud: false, ...chat },
    llm,
  };
  const live = new LiveEngine({ config, store: new Store(path.join(dir, 's.json')), now: () => t, estimate: () => 0.02 });
  const said = []; live.on('say', (s) => said.push(s)); live.on('reveal', (r) => said.push({ ...r, sub: 'reading' }));
  return { live, said, clock: { get t() { return t; }, set t(v) { t = v; } } };
}

test('she does not understand -> she asks the person directly (date-like numbers, gibberish, one unclear word)', () => {
  assert.equal(unclearKind('12 98'), 'date');
  assert.equal(unclearKind('asdfgh'), 'unclear');
  assert.equal(unclearKind('what'), 'unclear');
  assert.equal(unclearKind('nice live'), null);
  assert.equal(unclearKind('will I marry this year?'), null);
  const pick = (c, l) => l[0];
  assert.equal(clarifyLine('date', 'Sara', '12 98', pick), 'Sara, did you mean your birth date? Write it like 12 Aug 1998.');
  assert.match(clarifyLine('unclear', 'Ali', 'kya bol', pick), /^Ali, /);
});

test('every message from the same viewer gets an answer (one after another), each naming them', async () => {
  const { live, said } = setup();
  live.handleChat({ userId: 'u', nickname: 'Hina_22', comment: 'hello mira' });
  await sleep(120);
  live.handleChat({ userId: 'u', nickname: 'Hina_22', comment: 'will I get married?' });
  await sleep(120);
  live.handleChat({ userId: 'u', nickname: 'Hina_22', comment: 'xqzt' });
  await sleep(150);
  const mine = said.filter((s) => s.comment?.nickname === 'Hina_22' && s.sub === 'reply');
  assert.equal(mine.length, 3);
  for (const s of mine) assert.match(s.text, /Hina/);
  assert.match(mine[2].text, /what do you mean|catch that|say that again|confused/i);
});

test('AI rate-limited: the reply falls back to the knowledge base / built-in answers, never skipped', async () => {
  const { live, said } = setup({ llm: { enabled: true, baseUrl: 'http://x', model: 'm', noKey: true, minIntervalSeconds: 45 } });
  live.llm = async () => 'Sara, the stars say yes.';
  live.ai.nextAt = live.now() + 60_000;   // the free AI slot is taken
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'why is my life so hard?' });
  live.handleChat({ userId: 'b', nickname: 'Bo', comment: 'pull a card' });
  await sleep(200);
  assert.equal(said.length, 2);
  assert.notEqual(said[0].source, 'llm'); assert.match(said[0].text, /Sara/);
  assert.equal(said[1].source, 'kb'); assert.match(said[1].text, /Bo/);
});

test('thinking filler: a slow answer gets a short "let me see" line first, never twice in a row', async () => {
  const { live, said } = setup({ chat: { fillerAfterMs: 30 }, llm: { enabled: true, baseUrl: 'http://x', model: 'm', noKey: true, minIntervalSeconds: 3 } });
  live.llm = async () => { await sleep(150); return 'Sara, Venus smiles on you.'; };
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'will I find love?' });
  await sleep(400);
  assert.equal(said[0].sub, 'filler'); assert.match(said[0].text, /Sara/);
  assert.equal(said[1].sub, 'reply'); assert.equal(said[1].source, 'llm');
  assert.ok(said[0].text.split(' ').length <= 12, 'short');
});

test('reading session: after her reading the viewer gets 2 free follow-ups about it (first in line), then a gentle end; others still answered', async () => {
  const { live, said } = setup();
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'Sara 12/05/1998 will I travel?' });
  await sleep(100);
  assert.equal(said[0].sub, 'reading');
  assert.equal(live.sessionLeft('s'), 2);
  live.paused = true;
  live.handleChat({ userId: 'o', nickname: 'Omar', comment: 'hello mira' });
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'and what about love?' });
  assert.equal(live.chatQueue[0].userId, 's'); assert.equal(live.chatQueue[0].session, true);
  live.setPaused(false); await sleep(150);
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'and my career?' });
  await sleep(150);
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'one more thing please' });
  await sleep(150);
  const sara = said.filter((s) => s.comment?.nickname === 'Sara');
  assert.equal(sara.length, 3);
  assert.equal(sara[0].source, 'session'); assert.match(sara[0].text, /Sara, .*(Personal Year 9|Life Path 8)/);
  assert.match(sara[1].text, /free follow-up|session is complete|closes your reading/);
  assert.equal(live.sessionLeft('s'), 0);
  assert.notEqual(sara[2].source, 'session');   // after the session: normal replies (still answered)
  assert.ok(said.some((s) => s.comment?.nickname === 'Omar'));
  // the session length is configurable
  const z = setup({ readings: { sessionReplies: 0 } });
  z.live.handleChat({ userId: 'q', nickname: 'Q', comment: 'Q 1/1/1990' }); await sleep(60);
  assert.equal(z.live.sessionLeft('q'), 0);
});

test('a second birth date after the reading is answered (not just a toast)', async () => {
  const { live, said } = setup({ readings: { sessionReplies: 0 } });
  live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'Ali 1/1/1990' });
  await sleep(80);
  assert.equal(live.handleChat({ userId: 'a', nickname: 'Ali', comment: 'Ali 2/2/1991' }).reason, 'user-limit');
  await sleep(80);
  const last = said.at(-1);
  assert.equal(last.sub, 'reply'); assert.match(last.text, /Ali, .*(already read|reading is done)/); assert.match(last.text, /Life Path/);
});

test('session line without AI uses the viewer\'s own numbers and topic', () => {
  const t = sessionLine({ name: 'Sara', facts: { personalYear: 9, lifePath: 8 }, comment: 'what about my job?', pick: (c, l) => l[0] });
  assert.match(t, /^Sara, for work, your Life Path 8/);
});

test('session: follow-ups are separate answers (not merged) up to the free ones left; comments written while waiting for the reading count', async () => {
  const { live, said } = setup();
  live.paused = true;
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'Sara 12/05/1998' });
  live.handleChat({ userId: 's', nickname: 'Sara', comment: 'what about love?' });   // written before the reading starts
  const job = live.nextJob(); assert.equal(job.kind, 'reading');
  live.busy = true; await live.run(job); live.finishCurrent();
  live.paused = true;
  assert.equal(live.chatQueue[0].session, true);
  assert.equal(live.handleChat({ userId: 's', nickname: 'Sara', comment: 'and money?' }).merged, undefined);
  assert.equal(live.handleChat({ userId: 's', nickname: 'Sara', comment: 'and travel?' }).merged, true);   // only 2 free
  assert.equal(live.chatQueue.filter((q) => q.userId === 's').length, 2);
  live.setPaused(false); await sleep(200);
  const sara = said.filter((x) => x.sub === 'reply' && x.comment?.nickname === 'Sara');
  assert.equal(sara.length, 2); assert.match(sara[1].text, /free follow-up|session is complete|closes your reading/);
});
