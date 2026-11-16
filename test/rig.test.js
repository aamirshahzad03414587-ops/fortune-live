import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pub = (p) => new URL('../public' + p, import.meta.url);
const pngSize = (file) => { const b = fs.readFileSync(file); assert.equal(b.toString('ascii', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('rig: every layer and face part exists and lines up with the picture', () => {
  const rig = JSON.parse(fs.readFileSync(pub('/assets/rig/rig.json'), 'utf8'));
  assert.deepEqual([rig.width, rig.height], [941, 1672]);
  assert.deepEqual(pngSize(pub('/assets/rig/char-alpha.png')), [941, 1672]);
  assert.deepEqual(pngSize(pub('/assets/rig/weights.png')), [470, 836]);
  assert.ok(fs.statSync(pub('/assets/rig/bg.jpg')).size > 50_000);
  for (const e of ['L', 'R']) {
    const [x0, y0, x1, y1] = rig.eyes[e].box;
    for (const n of ['white', 'inner', 'mask', 'band', 'lid1', 'lid2', 'closed', 'happy']) assert.deepEqual(pngSize(pub(`/assets/rig/face/eye${e}-${n}.png`)), [x1 - x0, y1 - y0], `${e} ${n}`);
    assert.ok(x0 >= rig.face[0] && y0 >= rig.face[1] && x1 <= rig.face[2] && y1 <= rig.face[3], 'eyes inside the face canvas');
  }
  const [mx0, my0, mx1, my1] = rig.mouth.box;
  for (const m of rig.mouthShapes) assert.deepEqual(pngSize(pub(`/assets/rig/face/mouth-${m}.png`)), [mx1 - mx0, my1 - my0], m);
  for (const m of ['small', 'E', 'A', 'O', 'U']) assert.ok(rig.mouthShapes.includes(m));
});

test('overlay loads the rig script and uses it by default', () => {
  const html = fs.readFileSync(pub('/overlay.html'), 'utf8');
  assert.match(html, /<script src="\/rig.js"><\/script>/);
  const rig = fs.readFileSync(pub('/rig.js'), 'utf8');
  for (const k of ['uRoll', 'uBreath', 'uHair', 'uJaw', 'uBrow', 'uPatch', "'nod'", "'listen'", "'happy'"]) assert.ok(rig.includes(k), k);
});

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(pub('/lipsync.js'), 'utf8'), ctx);
const L = ctx.LipSync, SR = 24000;
function tone(sec, freqs, amp = 0.5) {
  const n = Math.round(sec * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR, env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t); out[i] = amp * env * freqs.reduce((a, [f, g]) => a + g * Math.sin(2 * Math.PI * f * t), 0); }
  return out;
}
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Float32Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const share = (tr, from, to, names) => { let hit = 0, n = 0; for (let t = from; t < to; t += 0.01) { n++; if (names.includes(L.shapeAt(tr, t).shape)) hit++; } return hit / n; };

test('lip shapes: dark/back vowels round the lips, bright/front vowels show teeth, silence closes', () => {
  const back = [[220, 1], [440, 0.8], [660, 0.4]];               // energy low in the spectrum, like "oo"/"oh"
  const front = [[220, 0.5], [2400, 1], [2900, 0.8]];           // strong high formant, like "ee"
  const pcm = cat(new Float32Array(SR * 0.4), tone(1.2, back), new Float32Array(SR * 0.5), tone(1.2, front), new Float32Array(SR * 0.5));
  const tr = L.analyze(pcm, SR);
  assert.ok(tr.shape && tr.shape.length === tr.vis.length);
  assert.ok(share(tr, 0.6, 1.4, ['O', 'U']) > 0.7, 'back vowel -> O/U');
  assert.ok(share(tr, 2.3, 3.1, ['E']) > 0.7, 'front vowel -> E');
  assert.ok(share(tr, 0.0, 0.3, ['rest']) > 0.95 && share(tr, 1.75, 1.95, ['rest']) > 0.9, 'silence -> closed');
  const o = L.shapeAt(tr, 1.0); assert.ok(o.open > 0.2 && o.open <= 1);
  assert.deepEqual({ ...L.shapeAt(tr, 99) }, { shape: 'rest', open: 0 });
});

test('lip shapes from text when there is no audio', () => {
  const tr = L.fromText('Hello my dear, oh you look so cool', 3);
  const seen = new Set(); for (let t = 0; t < 3; t += 0.01) seen.add(L.shapeAt(tr, t).shape);
  for (const s of ['O', 'E', 'rest']) assert.ok(seen.has(s), s);
});
