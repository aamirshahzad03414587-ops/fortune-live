// Dev tool: renders a ~30 s demo of the live rig with simulated TikTok events and Mira's real voice.
// Needs: server on BASE (default http://localhost:3123, no admin key or ADMIN_KEY env), playwright-core + Chrome, ffmpeg.
//   node tools/render-rig-demo.mjs [out.mp4]
// 1) fires joins, a follow, a gift and 3 questions at the real server and records what Mira says (text + TTS clip);
// 2) replays those items in the real overlay on a virtual clock (?render=1), one screenshot per frame;
// 3) muxes the frames with her voice clips at the exact times they were played.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';
const require = (await import('node:module')).createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');

const BASE = process.env.BASE || 'http://localhost:3123', KEY = process.env.ADMIN_KEY || '';
const OUT = process.argv[2] || 'screenshots/rig-demo.mp4', FPS = 30, W = 720, H = 1280, TMP = '/tmp/rigdemo/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body = {}) => fetch(`${BASE}/api/admin${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(KEY ? { 'x-admin-key': KEY } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());

// ---------------------------------------------------------------- 1. live run against the server
await post('/new-stream');
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws${KEY ? '?key=' + KEY : ''}`);
await new Promise((r) => ws.on('open', r));
const log = []; let t0 = 0;
ws.on('message', (raw) => { const m = JSON.parse(raw); if (['say', 'reveal', 'gift', 'follow', 'like'].includes(m.type)) log.push({ at: (Date.now() - t0) / 1000, m }); });
const script = [
  [0.0, '/sim/join', { nickname: 'Ali_khan' }], [0.2, '/sim/join', { nickname: 'sara.m' }], [0.5, '/sim/join', { nickname: 'Omar22' }],
  [0.8, '/sim/join', { nickname: 'hina_x' }], [1.1, '/sim/join', { nickname: 'Zoya' }],
  [2.6, '/sim/comment', { nickname: 'rohan.k', comment: 'will I get married this year?' }],
  [3.2, '/sim/follow', { nickname: 'NewFan_77' }],
  [4.0, '/sim/gift', { nickname: 'Ayesha_99', giftName: 'Rose', diamonds: 1 }],
  [4.2, '/sim/like', { nickname: 'Ayesha_99', count: 15 }],
  [5.0, '/sim/comment', { nickname: 'Bilal', comment: 'what does 2026 hold for my money?' }],
  [6.0, '/sim/comment', { nickname: 'maria_22', comment: 'Mira are you real?' }],
  [9.0, '/sim/like', { nickname: 'maria_22', count: 30 }],
];
t0 = Date.now();
for (const [at, p, body] of script) { await sleep(Math.max(0, at * 1000 - (Date.now() - t0))); await post(p, body); }
// wait until every expected line (welcome, 2 thank-yous, 3 answers) has been spoken
const EXPECT = Number(process.env.EXPECT || 6);
for (;;) {
  await sleep(300);
  const says = log.filter((e) => e.m.type === 'say');
  if (says.length >= EXPECT) { await sleep(says[says.length - 1].m.item.seconds * 1000); break; }
  if (Date.now() - t0 > 90000) break;
}
ws.close();
const says = log.filter((e) => e.m.type === 'say');
console.log('lines:', says.map((e) => `${e.at.toFixed(1)}s [${e.m.item.sub}] ${e.m.item.text}`).join('\n  '));
const last = says[says.length - 1];
const DURATION = Math.min(55, last.at + last.m.item.seconds + 0.5);

// ---------------------------------------------------------------- 2. frame-accurate replay in the overlay
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${BASE}/overlay?render=1&queue=0&chime=0${KEY ? '&key=' + KEY : ''}`);
await page.waitForFunction(() => window.__diag && window.__diag().kind === 'rig' && window.__diag().mode === 'idle', null, { timeout: 30000 });
await page.evaluate(() => { document.getElementById('idleBox').style.display = 'none'; window.__render.begin(0); });
const events = log.map((e) => ({ at: e.at, m: e.m }));
let ei = 0; const N = Math.ceil(DURATION * FPS);
for (let i = 0; i < N; i++) {
  const ms = (i * 1000) / FPS;
  while (ei < events.length && events[ei].at * 1000 <= ms) {
    const { m } = events[ei++];
    await page.evaluate((m) => {
      const F = window.__fortune;
      if (m.type === 'say') F.say(m.item);
      else if (m.type === 'reveal') F.reveal(m.item);
      else if (m.type === 'gift') { F.Rig.gesture('happy', { seconds: 1.5 }); F.toast(`🎁 ${m.nickname} sent ${m.giftName}`, 'gift', 3); }
      else if (m.type === 'follow') F.toast(`💫 ${m.nickname} followed!`, 'info', 3.5);
      else if (m.type === 'like') F.hearts(Math.ceil((m.count || 1) / 3));
    }, m);
  }
  await page.evaluate((ms) => window.__render.at(ms), ms);
  await page.screenshot({ path: `${TMP}f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 });
  if (i % 150 === 0) console.log('frame', i, '/', N);
}
const audio = await page.evaluate(() => window.__audioLog || []);
await browser.close();

// ---------------------------------------------------------------- 3. encode with her voice
const inputs = [], filters = [];
let k = 0;
for (const a of audio) {
  if (!a.url) continue;
  const f = `${TMP}a${k}.mp3`; fs.writeFileSync(f, Buffer.from(await (await fetch(BASE + a.url)).arrayBuffer()));
  inputs.push('-i', f); const d = Math.round(a.vt); filters.push(`[${k + 1}:a]adelay=${d}|${d}[a${k}]`); k++;
}
const args = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${TMP}f%05d.jpg`, ...inputs];
if (k) args.push('-filter_complex', filters.join(';') + ';' + Array.from({ length: k }, (_, i) => `[a${i}]`).join('') + `amix=inputs=${k}:normalize=0,apad[aout]`, '-map', '0:v', '-map', '[aout]');
args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', OUT);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
fs.writeFileSync(OUT.replace(/\.mp4$/, '.json'), JSON.stringify({ duration: DURATION, lines: says.map((e) => ({ at: e.at, sub: e.m.item.sub, text: e.m.item.text, caption: e.m.item.caption, comment: e.m.item.comment })), audio }, null, 1));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1) + ' MB');
process.exit(0);
