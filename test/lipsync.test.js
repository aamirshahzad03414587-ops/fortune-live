import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../public/lipsync.js', import.meta.url), 'utf8'), ctx);
const L = ctx.LipSync;
const SR = 24000;

/** Synthetic "speech": voiced bursts (harmonic tone with a syllable envelope) separated by real silences. */
function synth(segments) {
  const total = segments.reduce((a, s) => a + s.sec, 0), pcm = new Float32Array(Math.round(total * SR));
  let p = 0;
  for (const s of segments) {
    const n = Math.round(s.sec * SR);
    for (let i = 0; i < n; i++) {
      if (!s.amp) continue;
      const t = i / SR, syl = 0.5 - 0.5 * Math.cos(2 * Math.PI * 4.5 * t); // ~4.5 syllables per second
      const tone = Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 660 * t);
      pcm[p + i] = s.amp * syl * tone * 0.4 + (s.hiss ? (Math.random() - 0.5) * s.hiss : 0);
    }
    p += n;
  }
  return pcm;
}

test('lipsync: mouth closed in silence, open while speaking', () => {
  const pcm = synth([{ sec: 0.5, amp: 0 }, { sec: 1.2, amp: 1 }, { sec: 0.6, amp: 0 }, { sec: 1.0, amp: 0.8 }, { sec: 0.5, amp: 0 }]);
  const tr = L.analyze(pcm, SR);
  assert.equal(tr.fps, 100);
  assert.ok(Math.abs(tr.duration - 3.8) < 0.05);
  const slice = (a, b) => Array.from(tr.vis.slice(Math.round(a * 100), Math.round(b * 100)));
  assert.ok(slice(0, 0.45).every((v) => v === 0), 'closed before speech');
  assert.ok(slice(1.8, 2.25).every((v) => v === 0), 'closed in the pause (after a short release)');
  assert.ok(slice(3.45, 3.8).every((v) => v === 0), 'closed after speech');
  const talking = slice(0.5, 1.7);
  assert.ok(talking.filter((v) => v > 0).length / talking.length > 0.6, 'mostly open while speaking');
  assert.ok(new Set(talking).size >= 3, 'uses several mouth shapes, not just open/closed');
  const s = L.stats(tr);
  assert.equal(s.silenceClosedPct, 100);
  assert.ok(s.pearsonLoudness > 0.6, 'openness follows loudness: ' + s.pearsonLoudness);
});

test('lipsync: no flicker (each shape held >= minHold) and opens within ~60 ms of a sound', () => {
  const pcm = synth([{ sec: 0.4, amp: 0 }, { sec: 2, amp: 1 }]);
  const tr = L.analyze(pcm, SR);
  let run = 1, minRun = Infinity;
  for (let i = 1; i < tr.vis.length; i++) { if (tr.vis[i] === tr.vis[i - 1]) run++; else { if (tr.vis[i - 1] !== 0) minRun = Math.min(minRun, run); run = 1; } }
  assert.ok(minRun >= 5, 'shortest open shape lasts ' + minRun * 10 + ' ms');
  const first = tr.vis.findIndex((v) => v > 0);
  assert.ok(first >= 40 && first <= 46 + 10, 'first open frame ' + first); // syllable envelope starts at 0 at 0.40 s
});

test('lipsync: loudness-independent (quiet clip behaves like loud clip)', () => {
  const loud = L.analyze(synth([{ sec: 0.3, amp: 0 }, { sec: 1.5, amp: 1 }, { sec: 0.3, amp: 0 }]), SR);
  const quiet = L.analyze(synth([{ sec: 0.3, amp: 0 }, { sec: 1.5, amp: 0.12 }, { sec: 0.3, amp: 0 }]), SR);
  const same = loud.vis.reduce((a, v, i) => a + (v === quiet.vis[i] ? 1 : 0), 0) / loud.vis.length;
  assert.ok(same > 0.9, 'same shapes ' + same);
});

test('lipsync: at() lookup and text fallback', () => {
  const tr = L.analyze(synth([{ sec: 0.3, amp: 0 }, { sec: 1, amp: 1 }]), SR);
  assert.equal(L.at(tr, -1), 0); assert.equal(L.at(tr, 99), 0); assert.equal(L.at(null, 0.5), 0);
  assert.equal(L.at(tr, 0.1), 0);
  const ft = L.fromText('Hello my dear, the stars are glowing for you tonight.', 3);
  assert.equal(ft.vis.length, 300); assert.ok(ft.fromText);
  assert.ok(Array.from(ft.vis).some((v) => v > 0) && Array.from(ft.vis).some((v) => v === 0));
  const comma = L.fromText('Hi, hi', 1);
  assert.ok(Array.from(comma.vis).filter((v) => v === 0).length > 10, 'pauses at punctuation');
});

test('mouth patches exist and match the rectangle the overlay places them in', () => {
  const pngSize = (f) => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  const jpgSize = (f) => { const b = fs.readFileSync(f); let i = 2; while (i < b.length) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } };
  const A = new URL('../public/assets/', import.meta.url);
  const still = jpgSize(new URL('mira2.jpg', A));
  assert.deepEqual(still, { w: 941, h: 1672 });
  const js = fs.readFileSync(new URL('../public/overlay.js', import.meta.url), 'utf8');
  const m = js.match(/mouth: \{ enabled: true, x: ([\d.]+), y: ([\d.]+), w: ([\d.]+), h: ([\d.]+)/);
  assert.ok(m, 'mouth rectangle in overlay defaults');
  for (const n of ['o', 'e', 'a']) {
    const p = pngSize(new URL(`mira2-mouth-${n}.png`, A));
    assert.ok(Math.abs((p.w / still.w) * 100 - Number(m[3])) < 0.01 && Math.abs((p.h / still.h) * 100 - Number(m[4])) < 0.01, `patch ${n} size ${p.w}x${p.h}`);
  }
  assert.ok(!fs.existsSync(new URL('mira2-idle.mp4', A)) && !fs.existsSync(new URL('mira2-talk.mp4', A)), 'no videos are used');
});
