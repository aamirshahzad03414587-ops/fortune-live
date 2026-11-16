import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = new URL('../public/assets/', import.meta.url);
const track = JSON.parse(fs.readFileSync(new URL('mira2-idle-loop.track.json', A), 'utf8'));
const pngSize = (u) => { const b = fs.readFileSync(u); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const apply = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

test('video track: one entry per loop frame, sane transforms', () => {
  assert.equal(track.fps, 24); assert.equal(track.width, 1088); assert.equal(track.height, 1920);
  for (const k of ['mouth', 'skull', 'scene']) {
    assert.equal(track[k].length, track.frames, k);
    for (const m of track[k]) { assert.equal(m.length, 6); assert.ok(m.every(Number.isFinite)); }
  }
  assert.equal(track.gain.length, track.frames);
  assert.ok(track.gain.every((g) => g > 0.9 && g < 1.1), 'skin tone gain within 10%');
  // frame 0 is the reference: (near) identity at the mouth (the track is lightly smoothed)
  const c0 = [track.mouthRect.x + track.mouthRect.w / 2, track.mouthRect.y + track.mouthRect.h / 2], q0 = apply(track.mouth[0], ...c0);
  assert.ok(Math.hypot(q0[0] - c0[0], q0[1] - c0[1]) < 0.3);
  // ping-pong loop: the last frame comes back next to the first (no jump at the wrap)
  const c = [track.mouthRect.x + track.mouthRect.w / 2, track.mouthRect.y + track.mouthRect.h / 2];
  const p0 = apply(track.mouth[0], ...c), pl = apply(track.mouth[track.frames - 1], ...c);
  assert.ok(Math.hypot(p0[0] - pl[0], p0[1] - pl[1]) < 0.5, 'wrap jump < 0.5 px');
  // smooth: no frame-to-frame jump of the mouth larger than 1.5 px
  for (let i = 1; i < track.frames; i++) { const a = apply(track.mouth[i - 1], ...c), b = apply(track.mouth[i], ...c); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5, 'frame ' + i); }
});

test('video track matches the video files and the mouth patches', () => {
  for (const f of ['mira2v-mouth-o.png', 'mira2v-mouth-e.png', 'mira2v-mouth-a.png']) assert.deepEqual(pngSize(new URL(f, A)), { w: track.mouthRect.w, h: track.mouthRect.h }, f);
  for (const [f, mb] of [['mira2-idle-loop-1080.mp4', 8], ['mira2-idle-loop-720.mp4', 5]]) {
    const st = fs.statSync(new URL(f, A)); assert.ok(st.size < mb * 1024 * 1024, `${f} under ${mb} MB`);
    let probe; try { probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,r_frame_rate,codec_name', '-of', 'csv=p=0', new URL(f, A).pathname]).toString().trim(); } catch { continue; } // ffprobe optional
    const [codec, rate, n] = probe.split(',');
    assert.equal(codec, 'h264'); assert.equal(rate, '24/1'); assert.equal(Number(n), track.frames, f + ' frame count');
  }
});

test('overlay: video mode default, still mode kept as fallback', () => {
  const js = fs.readFileSync(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(js, /mode: 'video'/); assert.match(js, /initStill\(\)/); assert.match(js, /requestVideoFrameCallback/);
  assert.match(js, /video-failed/, 'falls back to the still picture if the video or track fails');
});
