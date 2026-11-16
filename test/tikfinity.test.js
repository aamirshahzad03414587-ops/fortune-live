import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { TikTokBridge } from '../src/tiktok.js';
import '../public/tikfinity.js';

const TF = globalThis.TikFinity;

function ev(name, data) { return TF.tfNormalize(name, data); }
const U = (id, nick, extra = {}) => ({ uniqueId: id, nickname: nick, ...extra });

test('TikFinity normalize: chat, like, follow, join', () => {
  assert.deepEqual(ev('chat', { ...U('sara_1', 'Sara'), comment: 'hello' }), {
    type: 'chat', id: 'sara_1', nick: 'Sara', avatar: '', isFollower: false, isGifter: false, text: 'hello',
  });
  assert.equal(ev('comment', { ...U('sara_1', 'Sara'), text: 'hi' }).text, 'hi');
  assert.equal(ev('like', { ...U('sara_1', 'Sara'), likeCount: 15 }).count, 15);
  assert.equal(ev('follow', U('sara_1', 'Sara')).type, 'follow');
  assert.equal(ev('member', U('sara_1', 'Sara')).type, 'join');
  assert.equal(ev('roomUser', { viewerCount: 42 }).count, 42);
});

test('TikFinity normalize: gift streak is counted only when it ends', () => {
  const mid = ev('gift', { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 3, giftType: 1, repeatEnd: false });
  assert.equal(mid, null);
  const end = ev('gift', { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: true });
  assert.equal(end.type, 'gift');
  assert.equal(end.coins, 1);
  assert.equal(end.count, 5);
  const one = ev('gift', { ...U('bilal_02', 'Bilal'), giftName: 'Doughnut', diamondCount: 30, repeatCount: 1, giftType: 2 });
  assert.equal(one.coins, 30);
  assert.equal(one.count, 1);
});

test('TikFinity dedupe: same msgId is ignored the second time', () => {
  const d = { ...U('sara_1', 'Sara'), comment: 'hello', msgId: 'm1' };
  const a = ev('chat', d);
  assert.equal(TF.tfDuplicate('chat', d, a), false);
  assert.equal(TF.tfDuplicate('chat', d, a), true);
});

test('with liveSource "tikfinity" the bridge never connects to TikTok, even with a username', async () => {
  let loaded = false;
  const tiktok = new TikTokBridge({ handleChat() {} }, { connector: async () => { loaded = true; return {}; } });
  tiktok.configure({ liveSource: 'tikfinity', username: 'someone' });
  await assert.rejects(() => tiktok.connect('someone'), /Live source is "tikfinity"/);
  assert.equal(loaded, false); assert.equal(tiktok.status.state, 'waiting');
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-tf-'));
  const store = new Store(path.join(dir, 's.json'));
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [
      { name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 1 },
      { name: 'Ext', minDiamonds: 30, level: 2, secondsOnScreen: 1 },
    ],
    readings: { fromComments: true, requireGift: false, perViewerPerStream: 1, maxQueue: 10, giftPriority: true, howToEverySeconds: 0 },
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 10, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: false, idlePromptSeconds: 0, welcomeJoins: false, greetGifters: false, greetFollowers: false },
  };
  const live = new LiveEngine({ config, store, estimate: () => 0.01 });
  live.paused = true;
  const tiktok = new TikTokBridge(live);
  return { live, tiktok };
}

test('ingest: a comment with a birth date queues a reading; gift streak credit is coins × count', () => {
  const { live, tiktok } = setup();
  const gift = ev('gift', { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: true, msgId: 'g2' });
  gift.dedupeKey = 'g2';
  const g = tiktok.ingest(gift);
  assert.equal(g.ok, true);
  assert.equal(live.stats.diamonds, 5);
  const chat = ev('chat', { ...U('aisha_01', 'Aisha'), comment: 'Ayesha Khan 12/05/1998 will I travel?', msgId: 'm1' });
  chat.dedupeKey = 'm1';
  const r = tiktok.ingest(chat);
  assert.equal(r.ok, true);
  assert.ok(r.item);
  assert.equal(live.queue.length, 1);
  assert.match(live.queue[0].name, /Ayesha/);
  assert.equal(tiktok.ingest(chat).reason, 'duplicate');
  assert.equal(live.queue.length, 1);
});
