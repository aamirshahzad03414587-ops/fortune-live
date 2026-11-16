// Dev tool: bakes the iPhone ("phone mode") sprites for Mira v1 and v2 from the real WebGL rig.
// Needs: the server running on BASE (default http://localhost:3931), playwright-core + Chrome, the rig Python env.
//   node tools/build-phone-sprites.mjs            -> /tmp/phone-frames/<v>/*.png, then tools/build-phone-sprites.py cuts them
// Each frame is the rig frozen at a neutral pose (api.override) with one thing changed: an eyelid state or a mouth shape.
import fs from 'node:fs';
const require = (await import('node:module')).createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/tmp/shot/node_modules/playwright-core');
const BASE = process.env.BASE || 'http://localhost:3931', OUT = process.env.OUT || '/tmp/phone-frames/';
const CHARS = { v1: { base: '/assets/rig/', image: '/assets/mira2.jpg' }, v2: { base: '/assets/rig-v2/', image: '/assets/rig-v2/still.jpg' } };
const OPEN = { small: 0.35, E: 0.6, I: 0.5, A: 1, O: 0.85, U: 0.5, FV: 0.3, MBP: 0, smile: 0, happy: 0.6 };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 });
await page.goto(BASE + '/healthz');
await page.addScriptTag({ url: BASE + '/rig.js' });
for (const [v, c] of Object.entries(CHARS)) {
  fs.mkdirSync(OUT + v, { recursive: true });
  const info = await page.evaluate(async (c) => {
    document.body.innerHTML = ''; document.body.style.margin = 0;
    const r = await (await fetch(c.base + 'rig.json')).json();
    const box = document.createElement('div'); box.style.cssText = `position:absolute;left:0;top:0;width:${r.width}px;height:${r.height}px`; document.body.appendChild(box);
    window.api = await MiraRig.create(box, { base: c.base, image: c.image, preserve: true, dpr: 1, maxTex: 4096 });
    api.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%'; api.resize(r.width, r.height);
    return { w: api.canvas.width, h: api.canvas.height, shapes: r.mouthShapes, rig: r };
  }, c);
  fs.writeFileSync(OUT + v + '/rig.json', JSON.stringify(info.rig));
  const zero = { x: 0, v: 0 };
  const neutral = { roll: 0, yaw: 0, pitch: 0, sway: 0, breath: 0, lean: 0, jaw: 0, brow: 0, happy: 0, eye: 'open', hairX: 0, fringeX: 0, hairY: zero, tail1: zero, tail2: zero, charm: zero, charm2: zero,
    gaze: { x: 0, y: 0, tx: 0, ty: 0, next: 1e9 }, mouth: { cur: null, prev: null, f: 1 } };
  const frames = { neutral: {} };
  for (const e of ['lid1', 'lid2', 'closed']) frames['eye-' + e] = { eye: e };
  frames['eye-happy'] = { eye: 'happy', happy: 1 };
  for (const s of info.shapes.filter((s) => s !== 'rest' && s !== 'orig')) frames['mouth-' + s] = { mouth: { cur: s, prev: null, f: 1 }, jaw: 2.2 * (OPEN[s] ?? 0.4) };
  for (const [name, o] of Object.entries(frames)) {
    const url = await page.evaluate((o) => { for (let i = 0; i < 3; i++) { api.override = structuredClone(o); api.frame(1000 + i * 16, {}); } return api.canvas.toDataURL('image/png'); }, { ...neutral, ...o });
    fs.writeFileSync(`${OUT}${v}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(v, info.w + 'x' + info.h, Object.keys(frames).join(' '));
}
await browser.close();
