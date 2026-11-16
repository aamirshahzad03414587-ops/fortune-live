// Dev tool (needs playwright-core + Chrome): server running on :3123 with the clip copied to public/assets/_demo.mp3.
// Frame-accurate lip-sync demo: the real overlay page, driven by a virtual clock (?render=1), one screenshot per video frame.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const FPS = 30, LEAD_IN = 0.8, TAIL = 0.8, out = '/tmp/render/';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto('http://localhost:3123/overlay?render=1&queue=0');
await page.waitForFunction(() => window.__diag && window.__diag().mode === 'idle', null, { timeout: 15000 });
await page.evaluate(() => { document.getElementById('idleBox').style.display = 'none'; document.getElementById('titleBar').style.display = 'none'; document.getElementById('footer').style.display = 'none'; });
const info = await page.evaluate(() => window.__render.load('/assets/_demo.mp3'));
console.log('track', JSON.stringify(info));
await page.evaluate(() => window.__render.begin(0));
const N = Math.ceil((LEAD_IN + info.duration + TAIL) * FPS);
const frames = [];
for (let i = 0; i < N; i++) {
  const ms = (i * 1000) / FPS, st = ms / 1000 - LEAD_IN;
  const r = await page.evaluate(([ms, st, d]) => window.__render.at(ms, st >= 0 && st <= d ? st : null), [ms, st, info.duration]);
  frames.push({ i, t: ms / 1000, speechT: st, v: r.v, open: r.open });
  await page.screenshot({ path: `${out}f${String(i).padStart(5, '0')}.png` });
}
fs.writeFileSync(out + 'frames.json', JSON.stringify({ FPS, LEAD_IN, duration: info.duration, frames }));
console.log('frames', N);
await browser.close();
