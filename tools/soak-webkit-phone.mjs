// iPhone-profile WebKit soak for phone mode (?mode=phone): drives the overlay with simulated LIVE events
// (greetings, tarot pulls, readings, replies, gifts, follows, likes) and samples every 30 s:
// the rig's own decoded-picture + canvas estimate (api.memory()), frames drawn, and the PSS of the WebKit web process.
// Usage: BASE=http://localhost:3931 MINUTES=10 CHAR=v2 OUT=/tmp/soak-phone.json node tools/soak-webkit-phone.mjs
// The server must run without an adminKey (localhost-only admin). WebKitGTK here has no media plugins, so media is stubbed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { webkit, devices } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');
const BASE = process.env.BASE || 'http://localhost:3931', MINUTES = Number(process.env.MINUTES || 10), OUT = process.env.OUT || '/tmp/soak-phone.json';
const CHAR = process.env.CHAR || 'v2';
const STUB = `
Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, set(v) { this.__s = v; }, get() { return this.__s || ''; } });
HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('stub', 'NotAllowedError')); };
HTMLMediaElement.prototype.load = function () {};
if (window.OfflineAudioContext) OfflineAudioContext.prototype.decodeAudioData = function () { return Promise.reject(new Error('stub decode')); };`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(BASE + '/api/admin' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((e) => ({ err: e.message }));
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(STUB);
const page = await ctx.newPage();
let crashed = 0; const errs = [];
page.on('crash', () => { crashed++; console.log('PAGE CRASHED'); });
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await page.goto(`${BASE}/overlay?mode=phone${CHAR === 'v2' ? '&char=v2' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__fortune && window.__fortune.Rig.api && window.__fortune.Rig.api.kind === 'phone', null, { timeout: 60000 });
await sleep(4000);
await page.evaluate(() => { window.__raf = 0; const f = () => { window.__raf++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
function pss() {
  // every process started under this script (WebKit's web process: WPEWebProcess / WebKitWebProcess)
  const procs = [];
  for (const line of execSync('ps -eo pid=,ppid=,args=', { maxBuffer: 1 << 24 }).toString().split('\n')) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); if (m) procs.push({ pid: +m[1], ppid: +m[2], args: m[3] }); }
  const mine = new Set([process.pid]); let grew = true;
  while (grew) { grew = false; for (const p of procs) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; } }
  const get = (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1]); } catch { return 0; } };
  let web = 0; for (const p of procs) if (mine.has(p.pid) && /WebProcess/.test(p.args)) web += get(p.pid);
  return +(web / 1024).toFixed(1);
}
let lastDrawn = 0 /* rAF count */, lastT = Date.now();
async function sample(tMin) {
  const p = await page.evaluate(() => { const a = window.__fortune.Rig.api; return { rigMB: +(a.memory() / 1048576).toFixed(2), drawn: typeof a.state.drawn === 'number' ? a.state.drawn : null, raf: window.__raf || 0, canvas: [a.canvas.width, a.canvas.height], canvases: document.querySelectorAll('canvas').length, lively: !!a.lively, nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null }; });
  const now = Date.now(), fps = +((p.raf - lastDrawn) / ((now - lastT) / 1000)).toFixed(1); lastDrawn = p.raf; lastT = now;
  return { tMin: +tMin.toFixed(2), webProcessMB: pss(), fps, ...p, crashed };
}
const samples = []; const t0 = Date.now(); let i = 0, next = 0;
const names = ['Amir', 'Sara', 'Hina', 'Omar', 'Zara', 'Ali', 'Noor', 'Bilal'];
const asks = ['pull a card for me', 'tarot 3 cards please', 'love match Leo Aries', 'dream about snakes', 'angel number 444', 'moon today', 'lucky colour', 'what is my zodiac'];
await post('/new-stream', {});
while (Date.now() - t0 < MINUTES * 60e3) {
  const el = (Date.now() - t0) / 60e3;
  if (crashed || page.isClosed()) { samples.push({ tMin: +el.toFixed(2), crashed: 1 }); break; }
  if (el >= next) { const s = await sample(el).catch((e) => ({ tMin: +el.toFixed(2), error: e.message.slice(0, 120) })); samples.push(s); console.log(JSON.stringify(s)); next += 0.5; }
  const n = names[i % names.length] + (i + 1), k = i % 7;
  if (k === 0) await post('/sim/join', { nickname: n });
  else if (k === 1 || k === 4) await post('/sim/comment', { nickname: n, comment: asks[(i >> 1) % asks.length] });
  else if (k === 2) await post('/sim/comment', { nickname: n, comment: `${names[i % names.length]} ${1 + (i % 27)}/${1 + (i % 12)}/199${i % 10} will I be lucky?` });
  else if (k === 3) await post('/sim/gift', { nickname: n, giftName: 'Rose', diamonds: 1 });
  else if (k === 5) await post('/sim/follow', { nickname: n });
  else await post('/sim/like', { nickname: n, count: 15 });
  i++; await sleep(Number(process.env.EVERY_MS || 5000));
}
if (!page.isClosed() && !crashed) samples.push(await sample((Date.now() - t0) / 60e3).catch((e) => ({ error: e.message })));
const peak = (k) => Math.max(0, ...samples.map((x) => x[k] || 0));
const ok = samples.filter((s) => s.webProcessMB);
const summary = { char: CHAR, base: BASE, minutes: MINUTES, events: i, crashed, peakWebProcessMB: peak('webProcessMB'), firstWebProcessMB: ok[1]?.webProcessMB, lastWebProcessMB: ok.at(-1)?.webProcessMB, peakRigMB: peak('rigMB'),
  avgFps: +(samples.slice(1).reduce((a, s) => a + (s.fps || 0), 0) / Math.max(1, samples.length - 1)).toFixed(1), lively: samples[0]?.lively, canvas: samples[0]?.canvas, pageErrors: errs.slice(0, 10) };
console.log('SUMMARY', JSON.stringify(summary));
fs.writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 1));
await browser.close();
