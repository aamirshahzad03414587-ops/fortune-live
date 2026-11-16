// Overlay stability: one voice across overlay windows, no status re-broadcast storms, TikFinity retry hygiene,
// and guards against the things that made the overlay go black (huge WebGL canvas, no context restore, leaked blobs, reloads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { TikTokBridge } from '../src/tiktok.js';

const read = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

test('overlay never reloads itself; rig restores after a WebGL context loss; speech blobs are revoked', () => {
  const ov = read('overlay.js'), rig = read('rig.js');
  assert.doesNotMatch(ov, /location\.reload|location\.(href|assign|replace)\s*[=(]|http-equiv/);
  assert.doesNotMatch(read('overlay.html'), /http-equiv=["']?refresh/i);
  assert.match(rig, /webglcontextlost[\s\S]*preventDefault/);
  assert.match(rig, /webglcontextrestored[\s\S]*setupGL\(\)/);
  assert.match(ov, /revokeObjectURL/);
  assert.match(ov, /rigFallback/);
  // backing canvas is capped at the painting's own width (941 px), never CSS size x devicePixelRatio
  assert.match(rig, /Math\.min\(1, \(rig\.width \* \(opts\.scale \|\| 1\)\)/);
});

test('TikFinity status from overlays is only re-broadcast when it changes', () => {
  const b = new TikTokBridge({ on() {} }); let n = 0; b.on('status', () => n++);
  b.setStatus('connecting', 'Waiting for TikFinity'); b.setStatus('connecting', 'Waiting for TikFinity'); b.setStatus('connecting', 'Waiting for TikFinity');
  assert.equal(n, 1);
  b.setStatus('connected', 'TikFinity connected'); assert.equal(n, 2);
});

test('TikFinity client: one socket at a time, stop() cancels retries', async () => {
  const made = [];
  class FakeWS { constructor(u) { this.url = u; made.push(this); } close() { this.onclose && this.onclose(); } }
  const prev = globalThis.WebSocket; globalThis.WebSocket = FakeWS;
  const mod = await import('../public/tikfinity.js?stability');
  const TF = globalThis.TikFinity || mod.default;
  try {
    TF.TF.wait = 5; TF.connect(); TF.connect(); TF.connect();
    assert.equal(made.length, 1, 'no parallel sockets');
    made[0].onclose();                      // refused -> one retry scheduled
    TF.connect();                            // a second connect while a retry is pending does nothing
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(made.length, 2);
    TF.stop(); assert.equal(TF.state, 'off');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(made.length, 2, 'no retries after stop()');
  } finally { globalThis.WebSocket = prev; TF.stop(); }
});

test('only one overlay window plays the voice: desktop beats phone, ?primary=1 beats both, re-elected on close', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-voice-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port, adminKey: '', tiktok: { username: '', liveSource: 'tikfinity' } }));
  const srv = spawn(process.execPath, ['src/server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CONFIG_PATH: path.join(dir, 'config.json'), PORT: String(port), TIKTOK_USERNAME: '', ADMIN_KEY: '', LIVE_SOURCE: '' }, stdio: 'pipe' });
  try {
    await new Promise((ok, bad) => { srv.stdout.on('data', (d) => /running/.test(d) && ok()); srv.on('exit', () => bad(new Error('server exited'))); setTimeout(() => bad(new Error('server start timeout')), 10000); });
    const open = (hello) => new Promise((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); ws.you = null;
      ws.on('message', (m) => { const x = JSON.parse(m); if (x.type === 'audioOwner') ws.you = x.you; });
      ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role: 'overlay', audio: true, ...hello })); ok(ws); });
    });
    const settle = () => new Promise((r) => setTimeout(r, 250));
    const phone = await open({ mobile: true }); await settle();
    assert.equal(phone.you, true, 'alone: the phone speaks');
    const pc = await open({ mobile: false }); await settle();
    assert.deepEqual([phone.you, pc.you], [false, true], 'LIVE Studio / PC overlay takes the voice from a phone preview');
    const pc2 = await open({ mobile: false }); await settle();
    assert.deepEqual([pc.you, pc2.you], [true, false], 'first desktop overlay keeps it');
    const prim = await open({ mobile: false, primary: true }); await settle();
    assert.deepEqual([pc.you, prim.you], [false, true], '?primary=1 wins');
    prim.close(); await settle();
    assert.equal(pc.you, true, 're-elected when the speaking overlay closes');
    for (const w of [phone, pc, pc2]) w.close();
  } finally { srv.kill(); }
});
