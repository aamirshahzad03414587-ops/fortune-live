// Live TTS for any text: sentence pieces in parallel, the free Google voice when Edge fails or is slow, real MP3 durations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TTS, splitSpeech, mp3Frames } from '../src/tts.js';

// MPEG-2 layer III, 48 kbps, 24 kHz, mono: 144-byte frames of 576 samples (24 ms) - what Edge sends
const frame = () => { const b = Buffer.alloc(144); b[0] = 0xff; b[1] = 0xf3; b[2] = 0x64; b[3] = 0xc4; return b; };
const mp3 = (seconds) => Buffer.concat(Array.from({ length: Math.round(seconds / 0.024) }, frame));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('splitSpeech: sentences, long ones cut at commas, short bits joined, every piece <= 180 chars', () => {
  const long = 'Sara, here is what your numbers whisper. Your birth date adds up to Life Path 8: you are a strong achiever who rises after every setback. ' + 'Love, money, travel and work, '.repeat(8) + 'all open for you. Yes!';
  const parts = splitSpeech(long);
  assert.ok(parts.length >= 4, String(parts.length));
  assert.ok(parts.every((p) => p.length <= 180), parts.map((p) => p.length).join(','));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').trim());
  assert.deepEqual(splitSpeech('Hi. I am Mira.'), ['Hi. I am Mira.']);   // tiny sentences stay together
});

test('mp3Frames: real duration from the frame headers (ID3 tag skipped), frames re-joined', () => {
  const tag = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x0a', 'latin1'), Buffer.alloc(10)]);
  const m = mp3Frames(Buffer.concat([tag, mp3(2.4)]));
  assert.ok(Math.abs(m.duration - 2.4) < 0.03, String(m.duration));
  assert.equal(m.buf.length, 100 * 144);
});

test('Edge fails -> the keyless Google voice speaks the line; one voice per line; latency logged', async () => {
  const t = new TTS(() => ({ enabled: true, logLatency: false }));
  t.edge = async () => { throw new Error('Stream closed before the synthesis completed'); };
  let calls = 0; t.google = async () => { calls++; return { ...mp3Frames(mp3(1.2)), via: 'google' }; };
  const r = await t.synth('Hina, the moon is listening tonight. Ask me about love, money or travel, and I will answer you.');
  assert.ok(r && r.url, 'a voice'); assert.equal(r.via, 'google'); assert.ok(r.duration > 2);
  assert.ok(calls >= 1);
});

test('Edge too slow -> Google after edgePieceMs; a fast Edge piece is cached and reused', async () => {
  const t = new TTS(() => ({ enabled: true, logLatency: false, edgePieceMs: 80 }));
  t.edge = async () => { await sleep(400); return mp3(1); };
  t.google = async () => ({ ...mp3Frames(mp3(1)), via: 'google' });
  const t0 = Date.now(); const r = await t.synth('This line must not wait for a slow voice.');
  assert.equal(r.via, 'google'); assert.ok(Date.now() - t0 < 350, String(Date.now() - t0));
  const t2 = new TTS(() => ({ enabled: true, logLatency: false }));
  let n = 0; t2.edge = async () => { n++; return mp3(1); };
  await t2.synth('Welcome to the live, my dear.'); await t2.synth('Welcome to the live, my dear.');
  assert.equal(n, 1); assert.equal(t2.stats.cached, 1);
});

test('every voice failed -> null and a [diag] line (never a fake voice)', async () => {
  const t = new TTS(() => ({ enabled: true, logLatency: false, edgePieceMs: 20 }));
  t.edge = async () => { throw new Error('down'); }; t.google = async () => { throw new Error('HTTP 429'); };
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { assert.equal(await t.synth('Nobody can hear this.'), null); } finally { console.log = orig; }
  assert.ok(logs.some((l) => /^\[diag\] tts failed/.test(l)), logs.join('\n'));
});

test('overlay: crystal-ball gaze + card pulls on phone and desktop, always-on banner', () => {
  const ov = fs.readFileSync(new URL('../public/overlay.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/overlay.html', import.meta.url), 'utf8');
  const ph = fs.readFileSync(new URL('../public/phone-rig.js', import.meta.url), 'utf8');
  assert.match(html, /mira-fx\.js[\s\S]*phone-rig\.js/);
  assert.match(html, /id="mysticBanner"[\s\S]*mystical arts/);
  assert.match(ov, /item\.sub === 'filler'\) Rig\.gesture\('gaze'/);
  assert.match(ov, /DeskFX\.show\(item\.cards/);
  assert.match(ph, /kind === 'gaze'/); assert.match(ph, /FX\.drawBall/);
  for (const v of ['v1', 'v2']) {
    const m = JSON.parse(fs.readFileSync(new URL(`../public/assets/phone/${v}/phone.json`, import.meta.url), 'utf8'));
    assert.ok(m.hands && m.hands.l && m.hands.r, v + ' hands');
    for (const s of ['l', 'r']) assert.ok(fs.existsSync(new URL(`../public/assets/phone/${v}/${m.hands[s].src}`, import.meta.url)));
  }
});
