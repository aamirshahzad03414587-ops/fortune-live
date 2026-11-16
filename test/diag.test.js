import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDiag, diagRoute } from '../src/diag.js';

test('diag: only whitelisted, short, safe fields reach the log', () => {
  const s = sanitizeDiag({ id: 'abc123', reason: 'tick', up: 61.234, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', key: 'SECRET', url: 'https://x/overlay?key=SECRET',
    mode: { phone: true, kind: 'phone', v: 2, evil: 'x' }, cv: { w: 780, h: 1387 }, mem: { img: 9.9 }, last: ['say', 'lips-on', '<script>'], errs: ['TypeError: x'],
    prev: { id: 'old', reason: 'tick', up: 300, key: 'SECRET' } });
  const line = JSON.stringify(s);
  assert.doesNotMatch(line, /SECRET|key|url|evil|<script>/);
  assert.equal(s.up, 61.23); assert.equal(s.mode.kind, 'phone'); assert.equal(s.cv.w, 780); assert.equal(s.prev.up, 300);
  assert.deepEqual(s.last, ['say', 'lips-on', 'script']);
  assert.equal(sanitizeDiag('nope'), null);
});

test('diag route: logs one line, 204, and rate-limits each address', () => {
  const logs = []; let t = 0;
  const h = diagRoute({ log: (s) => logs.push(s), now: () => t });
  const res = () => { const r = { code: 0, status(c) { r.code = c; return r; }, end() { return r; } }; return r; };
  const r1 = res(); h({ ip: '1.2.3.4', body: JSON.stringify({ id: 'a', reason: 'start' }) }, r1);
  assert.equal(r1.code, 204); assert.match(logs[0], /^\[diag\] \{"id":"a","reason":"start"\}$/);
  for (let i = 0; i < 25; i++) h({ ip: '1.2.3.4', body: '{"id":"a"}' }, res());
  const r2 = res(); h({ ip: '1.2.3.4', body: '{"id":"a"}' }, r2); assert.equal(r2.code, 429);
  t += 61e3; const r3 = res(); h({ ip: '1.2.3.4', body: '{"id":"a"}' }, r3); assert.equal(r3.code, 204);
  const r4 = res(); h({ ip: '5.6.7.8', body: 'not json' }, r4); assert.equal(r4.code, 400);
});
