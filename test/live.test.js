import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine, extractCodes } from '../src/live.js';

function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const store = new Store(path.join(dir, 's.json'));
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 1 }, { name: 'Ext', minDiamonds: 30, level: 2, secondsOnScreen: 1 }, { name: 'Scroll', minDiamonds: 100, level: 3, secondsOnScreen: 1 }],
    readings: { fromComments: false, privateForm: true }, // legacy flow: private form + codes
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 2, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: false, idlePromptSeconds: 0 },
    ...over,
  };
  const live = new LiveEngine({ config, store, estimate: () => 0.01 });
  live.paused = true; // keep items in the queue for inspection
  const sub = (name = 'Aamir Shahzad') => store.create({ fullName: name, dob: '1990-05-14', question: 'love?' }, 24);
  return { store, live, sub };
}

test('extractCodes', () => {
  assert.deepEqual(extractCodes('my code is #a17 pls'), ['A17']);
  assert.deepEqual(extractCodes('B204'), ['B204']);
  assert.deepEqual(extractCodes('I am 25 years'), []);
  assert.deepEqual(extractCodes('xyzA17'), []);
});

test('gift then code enqueues with tier', () => {
  const { live, sub } = setup(); const s = sub();
  live.handleGift({ userId: 'u1', nickname: 'Ali', giftName: 'Rose', diamonds: 1 });
  const r = live.handleChat({ userId: 'u1', nickname: 'Ali', comment: `#${s.code}` });
  assert.equal(r.ok, true); assert.equal(r.item.level, 1); assert.equal(live.queue.length, 1);
  assert.equal(r.item.sentences.length, 2);
});

test('code then gift also works, and big gifts unlock higher tiers', () => {
  const { live, sub } = setup(); const s = sub();
  assert.equal(live.handleChat({ userId: 'u2', nickname: 'Sara', comment: s.code }).reason, 'needs-gift');
  const r = live.handleGift({ userId: 'u2', nickname: 'Sara', giftName: 'Hand Hearts', diamonds: 100 });
  assert.equal(r.ok, true); assert.equal(r.item.level, 3);
});

test('gift streaks accumulate into credit', () => {
  const { live, sub } = setup(); const s = sub();
  live.handleGift({ userId: 'u3', nickname: 'Z', giftName: 'Rose', diamonds: 20 });
  live.handleGift({ userId: 'u3', nickname: 'Z', giftName: 'Rose', diamonds: 15 });
  assert.equal(live.handleChat({ userId: 'u3', nickname: 'Z', comment: s.code }).item.level, 2);
});

test('limits: code reuse, per-user limit, queue length, non-qualifying gift', () => {
  const { live, sub } = setup({ trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: false } });
  const a = sub(), b = sub('Sara Khan'), c = sub('Omar Ali'), d = sub('Hina Malik');
  live.handleGift({ userId: 'u1', nickname: 'A', giftName: 'Rose', diamonds: 1 });
  assert.ok(live.handleChat({ userId: 'u1', nickname: 'A', comment: a.code }).ok);
  live.handleGift({ userId: 'u2', nickname: 'B', giftName: 'Rose', diamonds: 1 });
  assert.equal(live.handleChat({ userId: 'u2', nickname: 'B', comment: a.code }).reason, 'code-used');
  live.handleGift({ userId: 'u1', nickname: 'A', giftName: 'Rose', diamonds: 1 });
  assert.equal(live.handleChat({ userId: 'u1', nickname: 'A', comment: b.code }).reason, 'user-limit');
  assert.ok(live.handleChat({ userId: 'u2', nickname: 'B', comment: b.code }).ok);
  live.handleGift({ userId: 'u3', nickname: 'C', giftName: 'Rose', diamonds: 1 });
  assert.equal(live.handleChat({ userId: 'u3', nickname: 'C', comment: c.code }).reason, 'queue-full');
  assert.equal(live.handleGift({ userId: 'u4', nickname: 'D', giftName: 'Doughnut', diamonds: 30 }).reason, 'gift-not-qualifying');
  assert.equal(live.handleChat({ userId: 'u4', nickname: 'D', comment: d.code }).reason, 'needs-gift');
});

test('expired credit is not usable', () => {
  let t = 0; const { store } = setup();
  const live = new LiveEngine({ config: setup().live.config, store, now: () => t, estimate: () => 0.01 }); live.paused = true;
  const s = store.create({ fullName: 'Aamir Shahzad', dob: '1990-05-14' }, 24);
  live.handleGift({ userId: 'u', nickname: 'U', giftName: 'Rose', diamonds: 1 });
  t = 11 * 60e3;
  assert.equal(live.handleChat({ userId: 'u', nickname: 'U', comment: s.code }).reason, 'needs-gift');
});

test('store: codes unique, retention purge, delete', () => {
  const { store } = setup();
  const codes = new Set(); for (let i = 0; i < 300; i++) codes.add(store.create({ fullName: 'X Y', dob: '2000-01-01' }, 24).code);
  assert.equal(codes.size, 300);
  const r = store.create({ fullName: 'X Y', dob: '2000-01-01' }, 1);
  assert.equal(store.purgeExpired(Date.now() + 2 * 3600e3), 1);
  assert.equal(store.count(), 300);
  const keep = store.items[0]; assert.ok(store.delete(keep.token)); assert.equal(store.byToken(keep.token), null);
  assert.equal(store.byToken(r.token), null);
});

test('queue runs readings one after another', async () => {
  const { live, sub } = setup();
  const reveals = []; live.on('reveal', (i) => reveals.push(i.nickname));
  live.config.tiers.forEach((t) => (t.secondsOnScreen = 0.05));
  for (const [u, n] of [['u1', 'A'], ['u2', 'B']]) { live.handleGift({ userId: u, nickname: n, giftName: 'Rose', diamonds: 1 }); live.handleChat({ userId: u, nickname: n, comment: sub(n + ' Test').code }); }
  live.setPaused(false);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(reveals, ['A', 'B']);
});
