import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { welcomeNames, isQuestion, withQuestion, ReplyEngine } from '../src/chat.js';

function setup(chat = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-w-'));
  const store = new Store(path.join(dir, 's.json'));
  const clock = { t: 1_000_000 };
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 1 }],
    readings: { fromComments: false, privateForm: true }, // legacy flow: private form + codes
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 5, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, idlePromptSeconds: 0, joinGreetSeconds: 10, joinBatchSeconds: 2.5, joinMaxNames: 3, ...chat },
  };
  const live = new LiveEngine({ config, store, now: () => clock.t, estimate: () => 0.01, replies: new ReplyEngine({ random: () => 0 }) });
  live.paused = true; // inspect jobs with nextJob() instead of speaking them
  return { live, clock };
}

test('welcomeNames: names, then "and N others"', () => {
  assert.equal(welcomeNames(['ali_99']), 'Ali');
  assert.equal(welcomeNames(['Ali', 'Sara']), 'Ali and Sara');
  assert.equal(welcomeNames(['Ali', 'Sara', 'Omar']), 'Ali, Sara and Omar');
  assert.equal(welcomeNames(['Ali', 'Sara', 'Omar', 'Hina', 'Zoya', 'Bilal'], 2), 'Ali, Sara and 4 others');
  assert.equal(welcomeNames(['Ali', 'Sara', 'Omar', 'Hina']), 'Ali, Sara, Omar and 1 other');
});

test('joins are batched into one welcome after a short wait', () => {
  const { live, clock } = setup();
  for (const n of ['Ali', 'Sara', 'Omar', 'Hina', 'Zoya']) live.handleJoin({ userId: n, nickname: n });
  assert.equal(live.nextJob(), null, 'waits joinBatchSeconds so more joins land in the same greeting');
  clock.t += 2600;
  const job = live.nextJob();
  assert.equal(job.sub, 'welcome');
  assert.equal(job.count, 3);
  // nobody is summed up as "and 2 others" any more: 3 names now (joinMaxNames), the other 2 in the next welcome
  assert.match(job.text, /Ali, Sara and Omar/);
  assert.equal(job.caption.text, 'Ali, Sara and Omar');
  assert.deepEqual(live.pendingJoins.map((p) => p.nickname), ['Hina', 'Zoya']);
  assert.match(job.text, /birth date/i, 'every welcome says how to get a reading');
});

test('at most one welcome every joinGreetSeconds; each viewer welcomed once per stream', () => {
  const { live, clock } = setup();
  live.handleJoin({ userId: 'a', nickname: 'Ali' }); clock.t += 3000;
  assert.equal(live.nextJob().sub, 'welcome');
  live.handleJoin({ userId: 'b', nickname: 'Sara' });
  assert.equal(live.handleJoin({ userId: 'a', nickname: 'Ali' }).reason, 'already-welcomed', 'rejoining does not greet again');
  clock.t += 4000;
  assert.equal(live.nextJob(), null, 'only 4 s since the last welcome');
  assert.ok(Math.abs(live.welcomeWait() - 6) < 0.01);
  clock.t += 6100;
  const job = live.nextJob();
  assert.equal(job.sub, 'welcome'); assert.match(job.text, /Sara/); assert.doesNotMatch(job.text, /Ali/);
  live.newStream();
  assert.equal(live.handleJoin({ userId: 'a', nickname: 'Ali' }).ok, true, 'a new stream welcomes everyone again');
});

test('priority: gift thanks before welcomes, welcomes interleave with chat replies', () => {
  const { live, clock } = setup();
  live.handleJoin({ userId: 'j1', nickname: 'Joiner' });
  live.handleChat({ userId: 'c1', nickname: 'Asker', comment: 'will I be rich?' });
  live.handleGift({ userId: 'g1', nickname: 'Giver', giftName: 'Rose', diamonds: 1 });
  clock.t += 5000;
  const a = live.nextJob(); assert.equal(a.sub, 'greet'); assert.match(a.text, /Giver/); assert.equal(a.caption.icon, '🎁');
  const b = live.nextJob(); assert.equal(b.sub, 'welcome'); assert.match(b.text, /Joiner/);
  const c = live.nextJob(); assert.equal(c.sub, 'reply'); assert.equal(c.chat.nickname, 'Asker');
});

test('a busy chat slows welcomes down (every 2x joinGreetSeconds)', () => {
  const { live, clock } = setup();
  live.handleJoin({ userId: 'a', nickname: 'Ali' }); clock.t += 3000; live.nextJob();
  for (let i = 0; i < 5; i++) live.handleChat({ userId: 'q' + i, nickname: 'Q' + i, comment: 'what is my lucky number?' });
  live.handleJoin({ userId: 'b', nickname: 'Sara' });
  clock.t += 12000;
  assert.equal(live.welcomeWait() > 0, true);
  clock.t += 8100;
  assert.equal(live.welcomeWait(), 0);
});

test('welcomes can be switched off', () => {
  const { live, clock } = setup({ welcomeJoins: false });
  assert.equal(live.handleJoin({ userId: 'a', nickname: 'Ali' }).ok, false);
  clock.t += 5000; assert.equal(live.nextJob(), null);
});

test('questions: read aloud with the name, and they push out plain comments when the queue is full', () => {
  assert.equal(isQuestion('will I get married?'), true); assert.equal(isQuestion('kya meri shaadi hogi'), true); assert.equal(isQuestion('nice live'), false);
  assert.equal(withQuestion('rohan.k', 'will I get married this year?', 'Rohan K, love follows its own calendar.'), 'Rohan K asks, will I get married this year? Love follows its own calendar.');
  assert.equal(withQuestion('Sara', 'hello Mira', 'Hi Sara!'), 'Hi Sara!', 'plain comments are not repeated');
  const { live } = setup({ maxQueue: 2 });
  live.handleChat({ userId: 'a', nickname: 'A', comment: 'hello there' });
  live.handleChat({ userId: 'b', nickname: 'B', comment: 'nice live' });
  assert.equal(live.handleChat({ userId: 'c', nickname: 'C', comment: 'so pretty' }).reason, 'chat-queue-full');
  assert.equal(live.handleChat({ userId: 'd', nickname: 'D', comment: 'when will I travel?' }).ok, true);
  assert.deepEqual(live.chatQueue.map((q) => q.nickname), ['B', 'D']);
});
