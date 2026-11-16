// Overlay soak test: opens /overlay in Chromium, drives it with simulated LIVE events (readings, replies, gifts,
// likes, follows) through the local admin API, and samples memory / DOM / GPU-ish counters every 30 s.
// Usage: BASE=http://localhost:3202 MINUTES=15 OUT=/tmp/soak-after.json node tools/soak.mjs
// The server must run without an adminKey (localhost-only admin) so the simulator routes are open.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');
const BASE = process.env.BASE || 'http://localhost:3202';
const MINUTES = Number(process.env.MINUTES || 15);
const OUT = process.env.OUT || '/tmp/soak.json';
const URLQ = process.env.URLQ || '';
const LOSE = process.env.LOSE_CONTEXT === '1';

// instrumentation injected before any page script
const INIT = () => {
  const C = (window.__soak = { blobs: 0, revoked: 0, intervals: 0, clearedIntervals: 0, ws: 0, audioCtx: 0, webgl: 0, reloads: 0, lost: 0, restored: 0 });
  const cu = URL.createObjectURL, ru = URL.revokeObjectURL;
  URL.createObjectURL = function (o) { C.blobs++; return cu.call(URL, o); };
  URL.revokeObjectURL = function (u) { C.revoked++; return ru.call(URL, u); };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { C.intervals++; return si.apply(window, a); };
  window.clearInterval = function (...a) { C.clearedIntervals++; return ci.apply(window, a); };
  const W = window.WebSocket; window.WebSocket = function (...a) { C.ws++; return new W(...a); }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  for (const k of ['AudioContext', 'webkitAudioContext']) { const A = window[k]; if (A) { window[k] = function (...a) { C.audioCtx++; return new A(...a); }; window[k].prototype = A.prototype; } }
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...r) { const x = gc.call(this, t, ...r); if (x && /webgl/.test(t) && !this.__counted) { this.__counted = 1; C.webgl++; this.addEventListener('webglcontextlost', () => C.lost++); this.addEventListener('webglcontextrestored', () => C.restored++); } return x; };
  addEventListener('beforeunload', () => { C.reloads++; });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(BASE + '/api/admin' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((e) => ({ err: e.message }));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// MOBILE=1: iPhone Safari-like page (390x844 @3x, touch, iOS user agent) - the device where the overlay crashed
const MOBILE = process.env.MOBILE === '1';
const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 540, height: 960 }, deviceScaleFactor: Number(process.env.DPR || 2) });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
let navs = 0, crashed = 0; const consoleErr = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
page.on('crash', () => { crashed++; console.log('PAGE CRASHED at', ((Date.now() - (globalThis.T0 || Date.now())) / 60e3).toFixed(2), 'min'); });
page.on('close', () => console.log('page closed'));
browser.on('disconnected', () => console.log('browser disconnected'));
page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 200)); });
await page.goto(BASE + '/overlay' + URLQ, { waitUntil: 'load' });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await sleep(6000);

async function sample(tMin) {
  await page.evaluate(() => window.gc && window.gc());
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
  const p = await page.evaluate(() => ({ ...window.__soak, canvases: document.querySelectorAll('canvas').length, kind: window.__diag && window.__diag().kind,
    fps: window.__fps || null, rigCanvas: (() => { const c = document.querySelector('.rigCanvas'); return c ? [c.width, c.height] : null; })(),
    events: (window.__events || []).length, lite: window.__diag && window.__diag().lite,
    canvasMP: +([...document.querySelectorAll('canvas')].reduce((a, c) => a + c.width * c.height, 0) / 1e6).toFixed(2) }));
  // memory (PSS) of this Chromium's renderer + GPU processes (blobs, decoded images and GPU buffers live outside the JS heap)
  const rss = { renderer: 0, gpu: 0 };
  try {
    const pid = process.pid, procs = [];   // Chromium runs as a child of this script
    for (const line of execSync('ps -eo pid=,ppid=,rss=,args=', { maxBuffer: 1 << 24 }).toString().split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); if (m) procs.push({ pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] });
    }
    const mine = new Set([pid]); let grew = true;
    while (grew) { grew = false; for (const p of procs) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; } }
    // PSS (proportional set size): shared libraries split between processes, so it is close to what the page really costs
    const pss = (pid) => { try { const m = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m); return m ? Number(m[1]) : 0; } catch { return 0; } };
    for (const p of procs) if (mine.has(p.pid)) { if (/--type=renderer/.test(p.args)) rss.renderer += pss(p.pid); else if (/--type=gpu-process/.test(p.args)) rss.gpu += pss(p.pid); }
  } catch {}
  return { tMin: +tMin.toFixed(2), rendererMB: +(rss.renderer / 1024).toFixed(1), gpuMB: +(rss.gpu / 1024).toFixed(1), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, docs: dom.documents, navs, crashed, ...p };
}
// fps probe
await page.evaluate(() => { let n = 0, t0 = performance.now(); const f = () => { n++; const t = performance.now(); if (t - t0 >= 2000) { window.__fps = Math.round((n * 1000) / (t - t0)); n = 0; t0 = t; } requestAnimationFrame(f); }; requestAnimationFrame(f); });

const samples = []; const t0 = (globalThis.T0 = Date.now()); let i = 0, nextSample = 0;
const names = ['Amir', 'Sara', 'Hina', 'Omar', 'Zara', 'Ali', 'Noor', 'Bilal'];
while (Date.now() - t0 < MINUTES * 60e3) {
  const el = (Date.now() - t0) / 60e3;
  if (crashed || page.isClosed()) { samples.push({ tMin: +el.toFixed(2), crashed: crashed || 1, note: 'renderer gone' }); break; }
  if (el >= nextSample) { const s = await sample(el).catch((e) => ({ tMin: +el.toFixed(2), error: e.message.slice(0, 120) })); samples.push(s); console.log(JSON.stringify(s)); nextSample += 0.5; }
  const n = names[i % names.length] + (i + 1), k = i % 6;
  if (k === 0) await post('/sim/comment', { nickname: n, comment: `${names[i % names.length]} ${1 + (i % 27)}/${1 + (i % 12)}/199${i % 10} will I be lucky?` });
  else if (k === 1) await post('/say', { text: `Welcome ${n}, the stars are shining on you tonight, my dear.` });
  else if (k === 2) await post('/sim/gift', { nickname: n, giftName: 'Rose', diamonds: 1 });
  else if (k === 3) await post('/sim/like', { nickname: n, count: 15 });
  else if (k === 4) await post('/sim/follow', { nickname: n });
  else await post('/sim/join', { nickname: n });
  if (LOSE && i === 20) { const r = await page.evaluate(() => { const c = document.querySelector('.rigCanvas'); const gl = c && (c.getContext('webgl') || c.getContext('experimental-webgl')); const x = gl && gl.getExtension('WEBGL_lose_context'); if (!x) return 'no-ext'; x.loseContext(); setTimeout(() => { try { x.restoreContext(); } catch (e) {} }, 1500); return 'lost'; }); console.log('context loss:', r); }
  i++; await sleep(Number(process.env.EVERY_MS || 4000));
}
if (!page.isClosed() && !crashed) samples.push(await sample((Date.now() - t0) / 60e3).catch((e) => ({ error: e.message })));
const shot = OUT.replace(/\.json$/, '.png'); await page.screenshot({ path: shot }).catch(() => {});
const peak = (k) => Math.max(0, ...samples.map((x) => x[k] || 0));
const summary = { peakRendererMB: peak('rendererMB'), peakGpuMB: peak('gpuMB'), peakTotalMB: Math.max(0, ...samples.map((x) => (x.rendererMB || 0) + (x.gpuMB || 0))), peakHeapMB: peak('heapMB'), peakCanvasMP: peak('canvasMP'),
  first: samples[1] || samples[0], last: samples.at(-1) };
console.log('SUMMARY', JSON.stringify(summary));
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, minutes: MINUTES, events: i, summary, consoleErr: consoleErr.slice(0, 30), samples }, null, 1));
console.log('wrote', OUT, shot); await browser.close();
