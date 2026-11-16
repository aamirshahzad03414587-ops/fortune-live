import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const A = new URL('../public/assets/rig-v2/', import.meta.url);
const pngSize = (u) => { const b = fs.readFileSync(u); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('rig v2: every layer and face part the renderer loads exists, at the size rig.json says', () => {
  const rig = JSON.parse(fs.readFileSync(new URL('rig.json', A), 'utf8'));
  assert.equal(rig.version, 2); assert.equal(rig.width, 1080); assert.equal(rig.height, 1920);
  assert.deepEqual(pngSize(new URL('body.png', A)), [1080, 1920]);
  assert.deepEqual(pngSize(new URL('weights.png', A)), [540, 960]);
  for (const k of ['tail', 'charm', 'table']) assert.deepEqual(pngSize(new URL(k + '.png', A)), rig.layers[k].rect.slice(2), k);
  for (const k of ['room.jpg', 'still.jpg']) assert.ok(fs.statSync(new URL(k, A)).size > 50000, k);
  for (const e of ['L', 'R']) for (const n of ['white', 'inner', 'mask', 'band', 'lid1', 'lid2', 'closed', 'happy']) {
    const [x0, y0, x1, y1] = rig.eyes[e].box; assert.deepEqual(pngSize(new URL(`face/eye${e}-${n}.png`, A)), [x1 - x0, y1 - y0], `eye${e}-${n}`);
  }
  const [mx0, my0, mx1, my1] = rig.mouth.box;
  for (const m of ['rest', 'MBP', 'smile', 'small', 'I', 'E', 'FV', 'A', 'O', 'U', 'happy']) {
    assert.ok(rig.mouthShapes.includes(m), m); assert.deepEqual(pngSize(new URL(`face/mouth-${m}.png`, A)), [mx1 - mx0, my1 - my0], m);
  }
  // iPhone budget: no texture over 2048 px
  for (const f of ['body.png', 'table.png', 'tail.png', 'charm.png']) assert.ok(Math.max(...pngSize(new URL(f, A))) <= 2048, f);
});

test('rig v2 is behind a switch: the old painting rig stays the default', () => {
  const js = fs.readFileSync(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(js, /rig: \{ base: '\/assets\/rig\/', image: '\/assets\/mira2\.jpg' \}/);
  assert.match(js, /qs\.get\('char'\) \|\| \(cfg\.overlay\.character \|\| \{\}\)\.char\) === 'v2'/);
  const rigJs = fs.readFileSync(new URL('../public/rig.js', import.meta.url), 'utf8');
  assert.match(rigJs, /v2 \? FRAG2 : FRAG/);
  assert.match(rigJs, /MOUTH_FALLBACK = \{ I: 'E', FV: 'small', MBP: null \}/);
  const v1 = JSON.parse(fs.readFileSync(new URL('../public/assets/rig/rig.json', import.meta.url), 'utf8'));
  assert.notEqual(v1.version, 2);
});

test('lipsync: extra visemes I / FV / MBP are named, and short closures inside speech press the lips (MBP)', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../public/lipsync.js', import.meta.url), 'utf8'), ctx);
  const L = ctx.LipSync, SR = 24000;
  assert.deepEqual(Array.from(L.SHAPES), ['rest', 'small', 'E', 'A', 'O', 'U', 'I', 'FV', 'MBP']);
  // two vowels with an 80 ms stop between them ("a-ba")
  const seg = (sec, amp) => Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * (Math.sin(2 * Math.PI * 220 * i / SR) + 0.5 * Math.sin(2 * Math.PI * 660 * i / SR)) * 0.4);
  const pcm = Float32Array.from([...seg(0.3, 0), ...seg(0.4, 1), ...seg(0.08, 0), ...seg(0.4, 1), ...seg(0.3, 0)]);
  const tr = L.analyze(pcm, SR);
  const names = Array.from(tr.shape).map((s) => L.SHAPES[s]);
  assert.ok(names.slice(70, 78).includes('MBP'), 'closure between vowels: ' + names.slice(66, 82).join(','));
  assert.ok(names.slice(0, 25).every((n) => n === 'rest'), 'silence before speech stays rest');
  assert.ok(names.slice(-20).every((n) => n === 'rest'), 'silence after speech stays rest');
});
