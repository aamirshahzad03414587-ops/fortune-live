import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { PhoneBridge, toTikFinity, normalizeUser, validUser } from '../src/bridge.js';

const U = (id, nick, extra = {}) => ({
  user: { uniqueId: id, nickname: nick, userId: id, profilePictureUrl: '' },
  uniqueId: id, nickname: nick, ...extra,
});

class FakeConnection extends EventEmitter {
  constructor(username, opts) {
    super();
    this.uniqueId = username;
    this.opts = opts;
    this.connected = false;
    FakeConnection.created.push(this);
  }
  async connect() {
    FakeConnection.connectCalls++;
    if (FakeConnection.connectImpl) return FakeConnection.connectImpl(this);
    this.connected = true;
    return { roomId: '1' };
  }
  async disconnect() {
    this.connected = false;
    this.disconnected = true;
    this.emit('disconnected');
  }
}
FakeConnection.created = [];
FakeConnection.connectCalls = 0;
FakeConnection.connectImpl = null;
FakeConnection.reset = () => {
  FakeConnection.created = [];
  FakeConnection.connectCalls = 0;
  FakeConnection.connectImpl = null;
};

const FakeModule = {
  TikTokLiveConnection: FakeConnection,
  WebcastEvent: { CHAT: 'chat', GIFT: 'gift', LIKE: 'like', FOLLOW: 'follow', SHARE: 'share', MEMBER: 'member', ROOM_USER: 'roomUser', STREAM_END: 'streamEnd' },
  ControlEvent: { DISCONNECTED: 'disconnected', ERROR: 'error', CONNECTED: 'connected' },
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function startBridge(opts = {}) {
  FakeConnection.reset();
  const bridge = new PhoneBridge({
    loadConnector: async () => FakeModule,
    idleMs: opts.idleMs ?? 60_000,
    retryMin: opts.retryMin ?? 20,
    retryMax: opts.retryMax ?? 80,
    log: () => {},
    ...opts,
  });
  const server = http.createServer(opts.onRequest || ((_q, res) => { res.writeHead(404); res.end(); }));
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (!bridge.handleUpgrade(req, socket, head, url)) socket.destroy();
  });
  const port = await listen(server);
  return { bridge, server, port, url: `ws://127.0.0.1:${port}/tt` };
}

function openClient(port, user = 'testuser') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/tt?u=${encodeURIComponent(user)}`);
    const msgs = [];
    ws.on('message', (raw) => { try { msgs.push(JSON.parse(String(raw))); } catch {} });
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
  });
}

function waitFor(msgs, pred, ms = 2000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = msgs.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > ms) return reject(new Error('timeout waiting for message: ' + JSON.stringify(msgs.slice(-5))));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('normalize / validate usernames', () => {
  assert.equal(normalizeUser('@DailyTrendCo21'), 'DailyTrendCo21');
  assert.equal(validUser('dailytrendco21'), true);
  assert.equal(validUser('silver.secret'), true);
  assert.equal(validUser('x'), false);
  assert.equal(validUser('nope!'), false);
  assert.equal(validUser('bad name'), false);
});

test('toTikFinity maps chat, like, roomUser, follow from connector-shaped events', () => {
  const chat = toTikFinity('chat', { ...U('sara_1', 'Sara'), comment: 'hello', common: { msgId: 'm1' } });
  assert.equal(chat.event, 'chat');
  assert.equal(chat.data.uniqueId, 'sara_1');
  assert.equal(chat.data.nickname, 'Sara');
  assert.equal(chat.data.comment, 'hello');
  assert.equal(chat.data.msgId, 'm1');
  const like = toTikFinity('like', { user: { uniqueId: 'sara_1', nickname: 'Sara' }, likeCount: 15, msgId: 'm2' });
  assert.equal(like.event, 'like');
  assert.equal(like.data.likeCount, 15);
  const likeProto = toTikFinity('like', { user: { displayId: 'sara_1', nickname: 'Sara', id: '99' }, count: 7 });
  assert.equal(likeProto.data.uniqueId, 'sara_1');
  assert.equal(likeProto.data.likeCount, 7);
  const room = toTikFinity('roomUser', { viewerCount: 42 });
  assert.equal(room.event, 'roomUser');
  assert.equal(room.data.viewerCount, 42);
  const follow = toTikFinity('follow', U('sara_1', 'Sara'));
  assert.equal(follow.event, 'follow');
});

test('toTikFinity gift keeps streak fields (does not drop mid-streak frames)', () => {
  const mid = toTikFinity('gift', {
    ...U('aisha_01', 'Aisha'),
    giftName: 'Rose', diamondCount: 1, repeatCount: 3, giftType: 1, repeatEnd: false,
    giftDetails: { giftName: 'Rose', giftType: 1, diamondCount: 1 },
    groupId: 'g1', msgId: 'x1',
  });
  assert.equal(mid.event, 'gift');
  assert.equal(mid.data.repeatEnd, false);
  assert.equal(mid.data.repeatCount, 3);
  assert.equal(mid.data.giftType, 1);
  assert.equal(mid.data.diamondCount, 1);
  assert.equal(mid.data.giftName, 'Rose');
  assert.equal(mid.data.groupId, 'g1');
  const proto = toTikFinity('gift', {
    user: { displayId: 'bilal_02', nickname: 'Bilal' },
    gift: { name: 'Doughnut', type: 2, diamondCount: 30 },
    repeatCount: 1, repeatEnd: 1, common: { msgId: 'g3' },
  });
  assert.equal(proto.data.giftName, 'Doughnut');
  assert.equal(proto.data.diamondCount, 30);
  assert.equal(proto.data.giftType, 2);
  assert.equal(proto.data.repeatEnd, 1);
});

test('WS clients get TikFinity-shaped like / chat / gift (including mid-streak)', async (t) => {
  const { bridge, server, port } = await startBridge();
  t.after(async () => { await bridge.close(); server.close(); });
  const { ws, msgs } = await openClient(port, 'testuser');
  await waitFor(msgs, (m) => m.event === 'status' && m.data.state === 'live');
  assert.equal(FakeConnection.created.length, 1);
  const conn = FakeConnection.created[0];
  conn.emit('like', { ...U('sara_1', 'Sara'), likeCount: 4, msgId: 'm-like' });
  conn.emit('chat', { ...U('sara_1', 'Sara'), comment: 'hi', common: { msgId: 'm-chat' } });
  conn.emit('gift', { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 3, giftType: 1, repeatEnd: false, groupId: 'gg', msgId: 'g-mid' });
  conn.emit('gift', { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: true, groupId: 'gg', msgId: 'g-end' });
  const like = await waitFor(msgs, (m) => m.event === 'like');
  const chat = await waitFor(msgs, (m) => m.event === 'chat');
  const mid = await waitFor(msgs, (m) => m.event === 'gift' && m.data.repeatEnd === false);
  const end = await waitFor(msgs, (m) => m.event === 'gift' && m.data.repeatEnd === true);
  assert.equal(like.data.uniqueId, 'sara_1');
  assert.equal(like.data.likeCount, 4);
  assert.equal(like.data.msgId, 'm-like');
  assert.equal(chat.data.comment, 'hi');
  assert.equal(mid.data.repeatCount, 3);
  assert.equal(end.data.repeatCount, 5);
  assert.equal(end.data.giftType, 1);
  ws.close();
});

test('one shared connection per username; second client does not open another; idle teardown after last client', async (t) => {
  const { bridge, server, port } = await startBridge({ idleMs: 40 });
  t.after(async () => { await bridge.close(); server.close(); });
  const a = await openClient(port, 'SameUser');
  await waitFor(a.msgs, (m) => m.event === 'status' && m.data.state === 'live');
  const b = await openClient(port, 'sameuser'); // case-insensitive share
  await waitFor(b.msgs, (m) => m.event === 'status' && m.data.state === 'live');
  assert.equal(FakeConnection.connectCalls, 1);
  FakeConnection.created[0].emit('like', { ...U('x', 'X'), likeCount: 1, msgId: 'shared' });
  await waitFor(a.msgs, (m) => m.event === 'like');
  await waitFor(b.msgs, (m) => m.event === 'like');
  a.ws.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bridge.rooms.size, 1);
  assert.equal(FakeConnection.created[0].disconnected, undefined);
  b.ws.close();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(bridge.rooms.size, 0);
  assert.equal(FakeConnection.created[0].disconnected, true);
});

test('invalid username is rejected; missing u is rejected', async (t) => {
  const { bridge, server, port } = await startBridge();
  t.after(async () => { await bridge.close(); server.close(); });
  for (const q of ['?u=x', '?u=', '', '?u=bad%20name']) {
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/tt${q}`);
      const timer = setTimeout(() => { try { ws.terminate(); } catch {} resolve('timeout'); }, 1500);
      ws.on('open', () => { clearTimeout(timer); try { ws.terminate(); } catch {} resolve('open'); });
      ws.on('error', () => { clearTimeout(timer); try { ws.terminate(); } catch {} resolve('error'); });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        res.resume();
        resolve('http:' + res.statusCode);
      });
    });
    assert.notEqual(result, 'open', 'should reject ' + JSON.stringify(q) + ' got ' + result);
  }
});

test('offline LIVE retries with backoff, then reaches live', async (t) => {
  let fails = 2;
  FakeConnection.reset();
  const { bridge, server, port } = await startBridge({
    retryMin: 25,
    retryMax: 80,
    loadConnector: async () => FakeModule,
  });
  FakeConnection.connectImpl = async (c) => {
    if (fails-- > 0) {
      const err = new Error('LIVE has ended / UserOfflineError room id');
      err.name = 'UserOfflineError';
      throw err;
    }
    c.connected = true;
    return { roomId: '2' };
  };
  t.after(async () => { await bridge.close(); server.close(); });
  const { ws, msgs } = await openClient(port, 'notliveyet');
  await waitFor(msgs, (m) => m.event === 'status' && m.data.state === 'offline');
  await waitFor(msgs, (m) => m.event === 'status' && m.data.state === 'live', 2000);
  assert.ok(FakeConnection.connectCalls >= 3);
  ws.close();
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf',
  '.css': 'text/css', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

test('headless Chrome: a like makes a fighter join and a gift adds HP', async (t) => {
  const root = path.resolve('/workspace/clash-live');
  const { bridge, server, port } = await startBridge({
    onRequest(req, res) {
      const u = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(u.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('no'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    },
  });
  t.after(async () => { await bridge.close(); server.close(); });

  const { launch } = await import('../../clash-live/tools/cdp.mjs');
  const dbg = 9344;
  const b = await launch(`http://127.0.0.1:${port}/?overlay=1&tiktok=test&bridge=ws://127.0.0.1:${port}/tt`, { port: dbg, W: 390, H: 844 });
  t.after(() => b.close());

  for (let i = 0; i < 80; i++) {
    if (await b.ev('!!(window.SF&&SF.ready)').catch(() => false)) break;
    await b.sleep(100);
  }
  assert.equal(await b.ev('!!(window.SF&&SF.ready)'), true);
  await waitForStatus(bridge, 'test', 'live');
  // page should have switched off 127.0.0.1:21213
  const tfUrl = await b.ev('SF.tf.url');
  assert.match(tfUrl, /\/tt\?u=test/);
  assert.equal(await b.ev('SF.tf.phone'), true);

  const conn = FakeConnection.created[0];
  assert.ok(conn, 'bridge opened a connector');
  conn.emit('like', { ...U('bilal_02', 'Bilal'), likeCount: 1, msgId: 'like-1' });
  await settle(b);
  let s = await b.ev('SF.state()');
  const bilal = s.roster.find((p) => p.id === 'bilal_02') || s.fighters.find((f) => f.id === 'bilal_02');
  assert.ok(bilal, 'like should join a fighter, roster=' + JSON.stringify(s.roster) + ' fighters=' + JSON.stringify(s.fighters));
  const joined = s.fighters.find((f) => f.id === 'bilal_02' || f.name === 'Bilal');
  assert.ok(joined, 'fighter should be in the pit');
  assert.equal(joined.hp, 50);

  conn.emit('gift', { ...U('bilal_02', 'Bilal'), giftName: 'Rose', diamondCount: 1, repeatCount: 3, giftType: 1, repeatEnd: false, groupId: 'gg', msgId: 'g-mid' });
  await settle(b);
  s = await b.ev('SF.state()');
  let gifter = s.roster.find((p) => p.id === 'bilal_02');
  assert.equal(gifter.coins, 0, 'mid-streak gift must not count');

  conn.emit('gift', { ...U('bilal_02', 'Bilal'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: true, groupId: 'gg', msgId: 'g-end' });
  await settle(b);
  s = await b.ev('SF.state()');
  gifter = s.roster.find((p) => p.id === 'bilal_02');
  const fighter = s.fighters.find((f) => f.id === 'bilal_02' || f.name === 'Bilal');
  assert.equal(gifter.coins, 5);
  assert.equal(gifter.bonus, 150); // 5 coins × 30 HP
  assert.ok(fighter, 'gifter still in the pit');
  assert.equal(fighter.hp, 200); // 50 base + 150 gift
  assert.equal(fighter.max, 200);
});

async function waitForStatus(bridge, user, state, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const room = bridge.rooms.get(user.toLowerCase());
    if (room && room.status === state) return room;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('room never reached ' + state);
}

async function settle(b) {
  await b.sleep(80);
  await b.ev('SF.step(20, 30); 0').catch(async () => {
    // if step throws, just wait for rAF
    await b.sleep(400);
  });
  await b.sleep(50);
}
