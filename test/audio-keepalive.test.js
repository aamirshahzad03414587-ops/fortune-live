// iPhone voice reliability (Web Audio, resumed every time, hint + [diag] when it still fails) and the free keep-alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, '..', ...p), 'utf8');

test('overlay voice: one Web Audio context, resumed before every line and on taps / return; hint + diag when it still fails', () => {
  const js = read('public', 'overlay.js');
  assert.equal((js.match(/new AC\(\)/g) || []).length, 1, 'one AudioContext for the session');
  assert.equal((js.match(/new Audio\(/g) || []).length, 1, 'one persistent <audio>');
  assert.match(js, /if \(!\(await AudioOut\.resume\(\)\)\)/);
  assert.match(js, /navigator\.audioSession\.type = 'playback'/);
  assert.match(js, /\(IOS \|\| SharedAudio\.preferWebAudio\) && \(await webAudio\(\)\)/);
  assert.match(js, /addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) AudioOut\.resume\(\); \}\)/);
  assert.match(js, /AudioOut\.tap\(\);/);
  assert.match(js, /\$\('soundChip'\)\.hidden = false;\s+\/\/ small "tap to enable sound" hint/);
  assert.match(js, /sendDiag\('audio-fail'\)/);
  assert.match(js, /ctx: AudioOut\.state, via: AudioOut\.via, err: AudioOut\.err/);
});

test('server: retries the free voice once; keeps itself awake through its public URL (free, no account)', () => {
  const live = read('src', 'live.js'), server = read('src', 'server.js');
  assert.match(live, /for \(let i = 0; i < 2 && !audio; i\+\+\)/);
  assert.match(server, /process\.env\.RENDER_EXTERNAL_URL/);
  assert.match(server, /KEEP_ALIVE_MINUTES \|\| 10/);
  assert.match(server, /app\.get\(\['\/healthz', '\/health'\]/);
});
