// Dev tool: screenshots the 9:16 overlay (idle / reading / reply) at 1080x1920 and at iPhone aspect (1080x2338),
// draws a mock TikTok phone UI on top (top bar, right buttons, comments + joins + gift bar at the bottom) and
// reports any box that overlaps it. Writes screenshots/layout-9x16.png.
//   BASE=http://localhost:3123 node tools/layout-check.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const require = (await import('node:module')).createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');
const BASE = process.env.BASE || 'http://localhost:3123', KEY = process.env.ADMIN_KEY || '';
const TMP = '/tmp/layoutcheck/'; fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reading = { id: 'x1', kind: 'reading', nickname: 'sara.m', name: 'Sara', tierName: 'Live prediction', level: 1, title: 'The Powerhouse',
  keyNumbers: [{ label: 'Life Path', value: 8 }, { label: 'Year 2026', value: 9 }, { label: 'Destiny', value: 3 }, { label: 'Soul', value: 2 }],
  sentences: ['Sara, born 12 May 1998.', 'You are Life Path 8, a powerhouse built for success, money and authority.', '2026 is your Personal Year 9, a year of endings and release.'],
  caption: { icon: '🔮', title: 'Sara · 12 May 1998', text: 'will I travel this year?' }, speech: { text: 'x', url: null, duration: 20, start: 0.2 }, seconds: 60 };
const reply = { id: 'x2', kind: 'say', sub: 'reply', text: 'Rohan asks, will I get married this year? Love follows its own calendar. Tell me your birth date and I will whisper your 2026 energy.',
  comment: { nickname: 'rohan.k', text: 'will I get married this year?' }, speech: { text: 'x', url: null, duration: 20, start: 0.2 }, seconds: 60 };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shots = []; const problems = [];
for (const [w, h, label] of [[1080, 1920, '9:16'], [1080, 2338, 'iPhone 19.5:9']]) {
  for (const state of ['idle', 'reading', 'reply']) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`${BASE}/overlay?chime=0${KEY ? '&key=' + KEY : ''}`);
    await page.waitForFunction(() => window.__fortune && document.querySelector('#stage canvas, #still'), null, { timeout: 30000 });
    await sleep(2500);
    await page.evaluate(({ state, reading, reply }) => {
      const chip = document.getElementById('soundChip'); if (chip) chip.hidden = true;
      if (state === 'reading') window.__fortune.reveal(reading);
      if (state === 'reply') window.__fortune.say(reply);
      if (state !== 'idle') window.__fortune.toast('🎁 Ayesha_99 sent Rose', 'gift', 30);
    }, { state, reading, reply });
    await sleep(state === 'idle' ? 500 : 3500);
    // boxes that matter, in screen pixels
    const boxes = await page.evaluate(() => [...document.querySelectorAll('#titleBar,#commentBubble,#revealTop,#readingBox,#idleBox,#queueBox:not(.empty),#footer')]
      .filter((e) => getComputedStyle(e).opacity !== '0' && !e.classList.contains('hidden')).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, x: r.left, y: r.top, r: r.right, b: r.bottom }; }));
    const zones = { top: [0, 0, w, h * 0.10], right: [w * 0.88, h * 0.45, w, h * 0.64], bottom: [0, h * 0.64, w, h] };
    for (const b of boxes) for (const [z, [x0, y0, x1, y1]] of Object.entries(zones)) {
      if (b.x < x1 && b.r > x0 && b.y < y1 && b.b > y0) problems.push(`${label} ${state}: #${b.id} overlaps TikTok ${z} UI (${Math.round(b.y)}-${Math.round(b.b)})`);
    }
    // mock TikTok phone UI on top
    await page.evaluate(({ w, h }) => {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:999;pointer-events:none;font:600 26px system-ui;color:#fff';
      const bar = h * 0.10, bot = h * 0.64;
      d.innerHTML = `
        <div style="position:absolute;left:0;right:0;top:0;height:${bar}px;background:rgba(255,40,80,.18);border-bottom:4px dashed #ff4d6d"></div>
        <div style="position:absolute;left:24px;top:${bar * 0.35}px;padding:10px 26px 10px 10px;border-radius:40px;background:rgba(0,0,0,.45);display:flex;gap:12px;align-items:center"><span style="width:56px;height:56px;border-radius:50%;background:#bbb;display:inline-block"></span>Host · 1.2K likes <b style="background:#fe2c55;padding:4px 14px;border-radius:20px">Follow</b></div>
        <div style="position:absolute;right:24px;top:${bar * 0.4}px;display:flex;gap:8px;align-items:center"><span style="width:46px;height:46px;border-radius:50%;background:#999"></span><span style="width:46px;height:46px;border-radius:50%;background:#aaa"></span><span style="padding:8px 14px;border-radius:20px;background:rgba(0,0,0,.45)">327</span><span style="font-size:40px">✕</span></div>
        <div style="position:absolute;right:0;width:${w * 0.12}px;top:${h * 0.45}px;height:${h * 0.19}px;background:rgba(255,40,80,.12);border-left:4px dashed #ff4d6d;display:flex;flex-direction:column;align-items:center;justify-content:space-around;font-size:54px">💗<span>↗</span><span>🎁</span></div>
        <div style="position:absolute;left:0;right:0;top:${bot}px;bottom:0;background:linear-gradient(180deg,rgba(255,40,80,.10),rgba(0,0,0,.55));border-top:4px dashed #ff4d6d"></div>
        <div style="position:absolute;left:28px;width:${w * 0.72}px;top:${bot + 30}px;display:flex;flex-direction:column;gap:14px">
          <div style="background:rgba(0,0,0,.35);padding:8px 16px;border-radius:18px;width:max-content">👋 zoya_22 joined</div>
          <div style="background:rgba(0,0,0,.35);padding:8px 16px;border-radius:18px"><b style="color:#ffd27a">sara.m</b> Sara 12/05/1998 will I travel this year?</div>
          <div style="background:rgba(0,0,0,.35);padding:8px 16px;border-radius:18px"><b style="color:#ffd27a">omar_fq</b> my name is Omar, born 25 Nov 1991</div>
          <div style="background:rgba(0,0,0,.35);padding:8px 16px;border-radius:18px"><b style="color:#ffd27a">hina_x</b> hi Mira 💜</div>
          <div style="background:rgba(254,44,85,.6);padding:8px 16px;border-radius:18px;width:max-content">🌹 Ayesha_99 sent Rose x1</div>
          <div style="background:rgba(0,0,0,.35);padding:8px 16px;border-radius:18px;width:max-content">👋 bilal joined</div>
        </div>
        <div style="position:absolute;left:24px;right:24px;bottom:${h * 0.025}px;display:flex;gap:16px;align-items:center"><div style="flex:1;padding:22px 28px;border-radius:40px;background:rgba(255,255,255,.18)">Add comment…</div><span style="font-size:52px">🎁</span><span style="font-size:52px">💗</span><span style="font-size:52px">↗</span></div>
        <div style="position:absolute;left:24px;top:${bar + 6}px;font:700 22px system-ui;color:#ff8da1;text-shadow:0 0 4px #000">TikTok top bar ↑</div>
        <div style="position:absolute;left:24px;top:${bot - 34}px;font:700 22px system-ui;color:#ff8da1;text-shadow:0 0 4px #000">TikTok comments / joins / gifts ↓</div>`;
      document.body.appendChild(d);
    }, { w, h });
    const f = `${TMP}${label.replace(/\W+/g, '')}-${state}.png`;
    await page.screenshot({ path: f }); shots.push({ f, w, h, label, state });
    await page.close();
  }
}
await browser.close();
// side by side, 540 px wide each
const OUT = process.argv[2] || 'screenshots/layout-9x16.png';
execFileSync('python3', ['tools/layout-composite.py', OUT, ...shots.map((s) => `${s.f}::${s.label} · ${s.state}`)], { stdio: 'inherit' });
console.log(problems.length ? 'OVERLAPS:\n  ' + problems.join('\n  ') : 'no overlaps with the TikTok UI zones');
