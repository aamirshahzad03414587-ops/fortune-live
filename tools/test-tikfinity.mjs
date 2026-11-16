// Local integration test: fake TikFinity WS + headless Chrome (or a node overlay
// stand-in) confirms the overlay forwards a gift and a comment, and a reading is queued.
// Usage (from repo root, after npm install): node tools/test-tikfinity.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

async function listenTf(port) {
  try {
    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    await new Promise((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
    return wss;
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    return null;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-tf-it-'));
const port = await freePort();
const key = 'tf-test-key';
const cfg = {
  port, publicUrl: `http://127.0.0.1:${port}`, adminKey: key,
  tiktok: { username: '', autoConnect: true }, // autoConnect must be ignored
  trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
  tiers: [
    { name: 'Short reading', minDiamonds: 1, level: 1, secondsOnScreen: 8 },
    { name: 'Extended reading', minDiamonds: 30, level: 2, secondsOnScreen: 8 },
  ],
  readings: { fromComments: true, requireGift: false, perViewerPerStream: 1, maxQueue: 10, giftPriority: true, howToEverySeconds: 0, privateForm: false },
  limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 30, giftCreditMinutes: 10, secondsBetweenReadings: 0, maxSubmissionsPerIpPerHour: 10 },
  data: { retentionHours: 24, maxRetentionHoursIfUserOptsOut: 168 },
  overlay: { title: 'Test', callToAction: '', characterImage: '/assets/mira2.jpg', showQueue: true, character: { mode: 'still', still: '/assets/mira2.jpg', prophecy: { enabled: false }, mouth: { enabled: false }, breathing: { enabled: false } } },
  voice: { enabled: false, voice: 'en-US-AvaNeural', urduVoice: 'ur-PK-UzmaNeural', hindiVoice: 'hi-IN-SwaraNeural', rate: '+0%', pitch: '+0%', browserLang: 'en-US', readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
  chat: { enabled: false, idlePromptSeconds: 0, welcomeJoins: false, greetGifters: false, greetFollowers: false },
  llm: { enabled: false },
};
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg, null, 2));

let tfPort = 21213;
let wss = await listenTf(tfPort);
if (!wss) { tfPort = await freePort(); wss = await listenTf(tfPort); }
const clients = [];
wss.on('connection', (ws) => clients.push(ws));
const waitClient = async (ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = clients.find((x) => x.readyState === 1);
    if (c) return c;
    await sleep(100);
  }
  throw new Error('TikFinity client did not connect');
};

const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, CONFIG_PATH: path.join(tmp, 'config.json'), DATA_FILE: path.join(tmp, 'submissions.json'), PORT: String(port), ADMIN_KEY: key },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => { out += d; });
server.stderr.on('data', (d) => { out += d; });
const kids = [server];

const shutdown = () => {
  try { wss.close(); } catch {}
  for (const k of kids) try { k.kill('SIGTERM'); } catch {}
};
process.on('exit', shutdown);

const t0 = Date.now();
while (Date.now() - t0 < 15000) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/admin/state?key=${key}`); if (r.ok) break; } catch {}
  if (server.exitCode != null) throw new Error('server exited:\n' + out);
  await sleep(150);
}
const health = await fetch(`http://127.0.0.1:${port}/api/admin/state?key=${key}`);
if (!health.ok) throw new Error('server not ready:\n' + out);
const st0 = await health.json();
if (st0.tiktok?.state === 'connected') throw new Error('server auto-connected to TikTok, which must never happen');

const overlayUrl = `http://127.0.0.1:${port}/overlay?key=${encodeURIComponent(key)}&tikfinity=${encodeURIComponent('ws://127.0.0.1:' + tfPort + '/')}&audio=0&panel=0`;
const chromePath = process.env.CHROME || ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'].find((c) => {
  try { return fs.existsSync(c) || fs.existsSync(`/usr/bin/${c}`); } catch { return false; }
});
const chromeBin = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromePath);
let mode = 'node';
if (chromeBin) {
  const profile = path.join(tmp, 'chrome');
  fs.mkdirSync(profile, { recursive: true });
  const ch = spawn(chromeBin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--hide-scrollbars', `--user-data-dir=${profile}`,
    `--window-size=1080,1920`, overlayUrl,
  ], { stdio: 'ignore' });
  kids.push(ch);
  mode = 'chrome';
} else {
  // Node stand-in: same client the overlay uses, same forward messages.
  await import(path.join(ROOT, 'public/tikfinity.js'));
  const tfMod = globalThis.TikFinity;
  const serverWs = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${encodeURIComponent(key)}`);
  await new Promise((res, rej) => { serverWs.once('open', res); serverWs.once('error', rej); });
  const tfWs = new WebSocket(`ws://127.0.0.1:${tfPort}/`);
  tfWs.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    const name = String(msg.event || msg.type || '');
    const data = msg.data || msg;
    const ev = tfMod.tfNormalize(name, data);
    if (!ev || (ev.type !== 'viewers' && tfMod.tfDuplicate(name, data, ev))) return;
    ev.dedupeKey = tfMod.tfDedupeKey(name, data, ev) || '';
    if (ev.type === 'status') return;
    serverWs.send(JSON.stringify({ type: 'tikfinity', event: ev }));
  };
  tfWs.onopen = () => serverWs.send(JSON.stringify({ type: 'tikfinityStatus', state: 'connected', message: 'TikFinity connected' }));
}

const client = await waitClient(25000);
const U = (id, nick) => ({ uniqueId: id, nickname: nick, profilePictureUrl: '' });
const send = (o) => client.send(JSON.stringify(o));
send({ event: 'gift', data: { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: false, msgId: 'g1' } }); // mid-streak: ignore
send({ event: 'gift', data: { ...U('aisha_01', 'Aisha'), giftName: 'Rose', diamondCount: 1, repeatCount: 5, giftType: 1, repeatEnd: true, msgId: 'g2' } });
send({ event: 'chat', data: { ...U('aisha_01', 'Aisha'), comment: 'Ayesha Khan 12/05/1998 will I travel?', msgId: 'c1' } });
send({ event: 'chat', data: { ...U('aisha_01', 'Aisha'), comment: 'Ayesha Khan 12/05/1998 will I travel?', msgId: 'c1' } }); // duplicate

let last = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/state?key=${key}`);
  last = await r.json();
  const queued = (last.live?.queue || []).some((q) => /ayesha/i.test(q.name || q.nickname || ''));
  const current = last.live?.current && last.live.current.kind === 'reading' && /ayesha/i.test(last.live.current.name || last.live.current.nickname || '');
  if ((queued || current) && last.live?.stats?.gifts >= 1 && last.live?.stats?.diamonds === 5) break;
}

shutdown();
await sleep(300);

const queued = (last?.live?.queue || []).some((q) => /ayesha/i.test(q.name || q.nickname || ''));
const current = last?.live?.current && last.live.current.kind === 'reading' && /ayesha/i.test(last.live.current.name || last.live.current.nickname || '');
const giftsOk = last?.live?.stats?.gifts === 1 && last?.live?.stats?.diamonds === 5;
const readingOk = queued || current || last?.live?.stats?.readings >= 1;
const ok = giftsOk && readingOk;
const report = { ok, mode, tfPort, overlayUrl, tiktok: last?.tiktok, stats: last?.live?.stats, current: last?.live?.current && { kind: last.live.current.kind, name: last.live.current.name, nickname: last.live.current.nickname }, queue: (last?.live?.queue || []).map((q) => ({ name: q.name, nickname: q.nickname, tierName: q.tierName })) };
console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error('FAIL: expected one 5-coin gift and a queued/current reading for Ayesha');
  process.exit(1);
}
console.log(`PASS tikfinity integration (${mode}): gift streak 5 coins, comment queued a reading, mid-streak + duplicate ignored`);
process.exit(0);
