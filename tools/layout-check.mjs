// Dev tool: how the 9:16 overlay looks on a real iPhone in TikTok LIVE.
// Renders the overlay at 1080x1920 (the LIVE Studio / OBS source) in 3 states (idle, reading, reply), crops it the way an
// iPhone (19.5:9, object-fit cover) does, scales it to the phone screen (473x1024) and draws TikTok's own UI on top, using
// the covered zones measured from a real phone screenshot:
//   top ~14% (host badge, Join, league bar), comments + welcome messages on the LEFT 70% from ~32% to ~88%, input bar bottom 8%.
// Reports every box that lands under that UI and writes a composite PNG (one row per server).
//   SERVERS="before=http://localhost:3124,after=http://localhost:3123" node tools/layout-check.mjs screenshots/layout-phone-v2.png
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const require = (await import('node:module')).createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');
const SERVERS = (process.env.SERVERS || `now=${process.env.BASE || 'http://localhost:3123'}`).split(',').map((x) => x.split('='));
const OUT = process.argv[2] || 'screenshots/layout-phone-v2.png';
const TMP = '/tmp/layoutcheck/'; fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1080, H = 1920, PW = 473, PH = 1024, CROP = Math.round((W - (H * PW) / PH) / 2); // ~96 px cut on each side
// TikTok's covered zones on the phone, as fractions of the phone screen
const ZONES = { top: [0, 0, 1, 0.14], comments: [0, 0.32, 0.70, 0.88], bottom: [0, 0.92, 1, 1] };

const reading = { id: 'x1', kind: 'reading', nickname: 'amir_k', name: 'Amir', tierName: 'Live prediction', level: 1, title: 'The Peacemaker',
  keyNumbers: [{ label: 'Life Path', value: 2 }, { label: 'Year 2026', value: 2 }, { label: 'Destiny', value: 8 }, { label: 'Soul', value: 1 }],
  sentences: ['Amir, born 23 June 1997.', 'You are Life Path 2, a gentle heart with the gift of bringing people together.', '2026 is your Personal Year 2, a slower year of patience, partnership and quiet growth.'],
  caption: { icon: '🔮', title: 'Amir · 23 June 1997', text: 'will I get a new job this year?' }, speech: { text: 'x', url: null, duration: 30, start: 0.2 }, seconds: 60 };
const reply = { id: 'x2', kind: 'say', sub: 'reply', text: 'Rohan asks, will I get married this year? Love follows its own calendar. Tell me your birth date and I will whisper your 2026 energy.',
  comment: { nickname: 'rohan.k', text: 'will I get married this year?' }, speech: { text: 'x', url: null, duration: 30, start: 0.2 }, seconds: 60 };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [], problems = [];
for (const [label, base] of SERVERS) {
  const shots = [];
  for (const state of ['idle', 'reading', 'reply']) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`${base}/overlay?chime=0&layout=vertical`);
    await page.waitForFunction(() => window.__fortune && document.querySelector('#stage canvas, #still'), null, { timeout: 30000 });
    await sleep(2500);
    await page.evaluate(({ state, reading, reply }) => {
      const chip = document.getElementById('soundChip'); if (chip) chip.hidden = true;
      if (state === 'reading') window.__fortune.reveal(reading);
      if (state === 'reply') window.__fortune.say(reply);
      if (state !== 'idle') window.__fortune.toast('🎁 Ayesha_99 sent Rose', 'gift', 30);
    }, { state, reading, reply });
    await sleep(state === 'idle' ? 600 : 4000);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('#titleBar,#commentBubble,#revealTop,#readingBox,#idleBox,#queueBox:not(.empty),#footer')]
      .filter((e) => !e.classList.contains('hidden') && +getComputedStyle(e).opacity > 0.05 && e.getBoundingClientRect().height > 0)
      .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, x: r.left, y: r.top, r: r.right, b: r.bottom }; }));
    const face = await page.evaluate(() => { const r = window.__fortune?.Rig?.api?.rig; const c = document.querySelector('#charBox').getBoundingClientRect(); return r ? { y0: c.top + (r.face[1] - 40) / r.height * c.height, y1: c.top + r.face[3] / r.height * c.height } : null; });
    const toPhone = (x, y) => [((x - CROP) * PW) / (W - 2 * CROP), (y * PH) / H];
    for (const b of boxes) {
      const [x0, y0] = toPhone(b.x, b.y), [x1, y1] = toPhone(b.r, b.b);
      if (x0 < 0 || x1 > PW) problems.push(`${label} ${state}: #${b.id} is cut off by the iPhone crop`);
      for (const [z, [a, c, d, e]] of Object.entries(ZONES)) if (x0 < d * PW && x1 > a * PW && y0 < e * PH && y1 > c * PH) problems.push(`${label} ${state}: #${b.id} under TikTok ${z} (${(y0 / PH * 100).toFixed(0)}-${(y1 / PH * 100).toFixed(0)}% high)`);
      if (face && b.id !== 'footer' && b.y < face.y1 && b.b > face.y0 && b.x < 700 && b.r > 380) problems.push(`${label} ${state}: #${b.id} covers Mira's face`);
    }
    if (face) problems.push(`${label} ${state}: face at ${(face.y0 / H * 100).toFixed(0)}-${(face.y1 / H * 100).toFixed(0)}% height`);
    const raw = `${TMP}${label}-${state}-raw.png`, out = `${TMP}${label}-${state}.png`;
    await page.screenshot({ path: raw }); await page.close();
    shots.push({ raw, out, state });
  }
  rows.push({ label, shots });
}
await browser.close();
fs.writeFileSync(`${TMP}plan.json`, JSON.stringify({ rows, crop: CROP, pw: PW, ph: PH, zones: ZONES }));
execFileSync('python3', ['tools/layout-composite.py', `${TMP}plan.json`, OUT], { stdio: 'inherit' });
console.log(problems.filter((p) => !/face at/.test(p)).length ? 'ISSUES:\n  ' + problems.join('\n  ') : 'no boxes under TikTok UI\n  ' + problems.join('\n  '));
