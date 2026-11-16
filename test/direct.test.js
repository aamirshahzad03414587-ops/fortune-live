import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TikTokBridge, contentKey } from '../src/tiktok.js';
import { parseReadingComment } from '../src/comment-reading.js';

const WebcastEvent = { CHAT: 'chat', GIFT: 'gift', LIKE: 'like', FOLLOW: 'follow', MEMBER: 'member', STREAM_END: 'streamEnd' };
const ControlEvent = { DISCONNECTED: 'disconnected', ERROR: 'error' };
class UserOfflineError extends Error {}
function fakeConnector({ fail = null } = {}) {
  const made = [];
  class TikTokLiveConnection {
    constructor(user, opts) { this.user = user; this.opts = opts; this.h = {}; made.push(this); }
    on(n, f) { this.h[n] = f; }
    emit(n, d) { this.h[n]?.(d); }
    async connect() { if (fail) throw fail(); return { roomId: '123' }; }
    async disconnect() { this.closed = true; }
  }
  return { made, load: async () => ({ TikTokLiveConnection, WebcastEvent, ControlEvent }) };
}
function fakeLive() {
  const got = { chat: [], gift: [], join: [], like: [], streams: 0 };
  return { got, newStream() { got.streams++; }, handleChat: (c) => { got.chat.push(c); return { ok: true }; }, handleGift: (g) => { got.gift.push(g); return { ok: true }; },
    handleLike: (l) => got.like.push(l), handleFollow() {}, handleJoin: (j) => { got.join.push(j); return { ok: true }; } };
}

test('"Amir 23/6/1997" (D/M/YYYY, one-digit month) is a reading request', () => {
  const p = parseReadingComment('Amir 23/6/1997', 'amir.k');
  assert.deepEqual([p.name, p.dob], ['Amir', '1997-06-23']);
});

test('default source: direct when a username is set, TikFinity otherwise', () => {
  const b = new TikTokBridge(fakeLive());
  b.configure({ username: '@silversecretsketchbook' }); assert.equal(b.source, 'direct'); assert.equal(b.username, 'silversecretsketchbook');
  b.configure({}); assert.equal(b.source, 'tikfinity');
  b.configure({ username: 'x', liveSource: 'both' }); assert.equal(b.source, 'both');
});

test('direct: connects, turns TikTok events into Mira events, gift streaks count once at the end', async () => {
  const live = fakeLive(), c = fakeConnector();
  const b = new TikTokBridge(live, { connector: c.load });
  b.configure({ username: 'silversecretsketchbook', signApiKey: 'k' });
  await b.connect();
  assert.equal(b.status.direct.state, 'connected'); assert.equal(c.made[0].opts.signApiKey, 'k'); assert.equal(live.got.streams, 1);
  const conn = c.made[0], user = { uniqueId: 'amir_k', nickname: 'Amir' };
  conn.emit('chat', { user, comment: 'Amir 23/6/1997' });
  assert.equal(live.got.chat[0].comment, 'Amir 23/6/1997'); assert.equal(live.got.chat[0].userId, 'amir_k');
  conn.emit('gift', { user, giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 }, repeatCount: 3, repeatEnd: false });
  conn.emit('gift', { user, giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 }, repeatCount: 5, repeatEnd: true });
  assert.equal(live.got.gift.length, 1); assert.equal(live.got.gift[0].diamonds, 5);
  conn.emit('member', { user: { uniqueId: 'sara', nickname: 'Sara' } }); assert.equal(live.got.join.length, 1);
  await b.disconnect(); assert.equal(conn.closed, true); assert.equal(b.status.direct.state, 'off');
});

test('direct: offline -> waiting + retry; errors suggest a sign key', async () => {
  const c = fakeConnector({ fail: () => new UserOfflineError('The requested user isn\'t online :(') });
  const b = new TikTokBridge(fakeLive(), { connector: c.load });
  b.configure({ username: 'someone', retrySeconds: 30 });
  await b.connect();
  assert.equal(b.status.direct.state, 'waiting'); assert.match(b.status.direct.message, /not live right now.*30 s/);
  assert.ok(b.retryTimer); await b.disconnect(); assert.equal(b.retryTimer, null);
  const c2 = fakeConnector({ fail: () => new Error('Request blocked: 403 captcha') });
  const b2 = new TikTokBridge(fakeLive(), { connector: c2.load }); b2.configure({ username: 'someone' });
  await b2.connect(); assert.equal(b2.status.direct.state, 'error'); assert.match(b2.status.direct.message, /SIGN_API_KEY/); await b2.disconnect();
});

test('direct: a dropped connection reconnects', async () => {
  const c = fakeConnector();
  const b = new TikTokBridge(fakeLive(), { connector: c.load }); b.configure({ username: 'x' });
  await b.connect(); c.made[0].emit('disconnected');
  assert.equal(b.status.direct.state, 'reconnecting'); assert.ok(b.retryTimer);
  await b.disconnect();
});

test('both sources: the same comment / gift / join is counted once; TikFinity likes ignored while direct is connected', async () => {
  const live = fakeLive(), c = fakeConnector();
  const b = new TikTokBridge(live, { connector: c.load }); b.configure({ username: 'x', liveSource: 'both' });
  await b.connect();
  const conn = c.made[0];
  conn.emit('chat', { user: { uniqueId: 'amir_k', nickname: 'Amir' }, comment: 'Amir 23/6/1997' });
  assert.equal(b.ingest({ type: 'chat', id: 'amir_k', nick: 'Amir', text: 'Amir 23/6/1997' }, 'tikfinity').reason, 'duplicate');
  assert.equal(b.ingest({ type: 'chat', id: 'sara', nick: 'Sara', text: 'hi' }, 'tikfinity').ok, true);
  assert.equal(b.ingest({ type: 'like', id: 'sara', nick: 'Sara', count: 5 }, 'tikfinity').reason, 'duplicate');
  assert.equal(live.got.chat.length, 2); assert.equal(b.status.counts.duplicates >= 1, true);
  // direct only: TikFinity events are ignored
  b.configure({ username: 'x', liveSource: 'direct' });
  assert.equal(b.ingest({ type: 'chat', id: 'z', nick: 'Z', text: 'yo' }, 'tikfinity').reason, 'source-off');
  await b.disconnect();
  assert.equal(contentKey({ type: 'gift', id: 'A', giftName: 'Rose', count: 2 }), 'gift|a|rose|2');
});
