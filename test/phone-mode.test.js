// Phone mode (iPhone / iPad / ?lite=1 / ?mode=phone): a small 2D-canvas sprite puppet instead of WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const P = (...a) => path.join(import.meta.dirname, '..', 'public', ...a);
const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
function jpgSize(f) {
  const b = fs.readFileSync(f); let i = 2;
  while (i < b.length) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; }
  return null;
}

for (const v of ['v1', 'v2']) {
  test(`phone sprites ${v}: phone-sized pictures, head / hair (+ ponytail, charm) layers, small face patches, < 14 MB decoded`, () => {
    const man = JSON.parse(fs.readFileSync(P('assets', 'phone', v, 'phone.json'), 'utf8'));
    assert.equal(man.version, v === 'v2' ? 2 : 1);
    const [bw, bh] = jpgSize(P('assets', 'phone', v, 'base.jpg'));
    assert.deepEqual([bw, bh], [man.width, man.height]);
    assert.ok(bw <= 800, 'base is phone-sized (<= 800 px wide), not the 941/1080 px painting');
    const [ux, uy, uw, uh] = man.upper.rect;
    assert.deepEqual(pngSize(P('assets', 'phone', v, 'upper.png')), [uw, uh]);
    let px = bw * bh + uw * uh;
    const names = Object.keys(man.patches);
    for (const need of ['eye-closed', 'eye-happy', 'mouth-A', 'mouth-O', 'mouth-E', 'mouth-smile', 'gaze-l', 'gaze-r', 'gaze-u', 'gaze-d', 'brow-up', 'brow-down']) assert.ok(names.includes(need), need);
    // lively layers: head (tilt / turn / nod), hair ends; v2 also the ponytail, the tarot charm and the table in front of it
    for (const k of ['head', 'hair', ...(v === 'v2' ? ['tail', 'charm', 'tableFront'] : [])]) {
      assert.ok(man[k], k); const [, , w, h] = man[k].rect;
      assert.deepEqual(pngSize(P('assets', 'phone', v, man[k].src)), [w, h], k);
      px += w * h;
    }
    for (const k of ['tail', 'charm']) if (man[k]) assert.ok(man[k].anchor.length === 2 && man[k].length > 50, k);
    assert.ok(man.flames.length >= 3, 'candle flames for the glow');
    for (const [n, [x, y, w, h]] of Object.entries(man.patches)) {
      assert.deepEqual(pngSize(P('assets', 'phone', v, n + '.png')), [w, h], n);
      assert.ok(x >= 0 && y >= 0 && x + w <= uw && y + h <= uh, `${n} inside the upper layer`);
      assert.ok(w * h < 20000, `${n} is a small patch`);
      px += w * h;
    }
    px += bw * bh;   // + the canvas itself
    assert.ok(px * 4 < 14e6, `decoded pictures + canvas ${(px * 4 / 1e6).toFixed(1)} MB < 14 MB (iOS budget ~20-25 MB)`);
    assert.ok(ux + uw <= bw && uy + uh <= bh);
  });
}

test('overlay: phone mode on iPhones / iPads / ?lite=1 / ?mode=phone, no WebGL there, phone CSS really applied', () => {
  const js = fs.readFileSync(P('overlay.js'), 'utf8'), css = fs.readFileSync(P('overlay.css'), 'utf8'), html = fs.readFileSync(P('overlay.html'), 'utf8');
  assert.match(js, /const IOS = \/iPhone\|iPad\|iPod\/\.test\(navigator\.userAgent\)/);
  assert.match(js, /const phone = qs\.has\('phone'\) \? qs\.get\('phone'\) !== '0' : \(IOS \|\| qs\.get\('mode'\) === 'phone' \|\| qs\.get\('lite'\) === '1'\)/);
  assert.match(js, /want = phone \? 'phone'/);
  assert.match(js, /MiraPhone\.create\(/);
  assert.ok(html.indexOf('/phone-rig.js') > 0 && html.indexOf('/phone-rig.js') < html.indexOf('/overlay.js'));
  // the layout used to overwrite root.className, wiping 'lite' / 'phone' (so the phone CSS never applied)
  assert.doesNotMatch(js, /root\.className\s*=/);
  // no empty data: WAV (it crashed WebKit's media pipeline in testing); one shared <audio>
  assert.doesNotMatch(js, /data:audio\/wav/);
  assert.equal((js.match(/new Audio\(/g) || []).length, 1);
  assert.ok(fs.statSync(P('assets', 'silence.mp3')).size > 500);
  // phone CSS: no blur / backdrop / blend layers, effect layers hidden
  const phoneCss = css.slice(css.indexOf('/* phone mode'));
  assert.match(phoneCss, /\.phone #bgBlur[^{]*#prophecy[^{]*#fx[^{]*\{ display:none !important; \}/);
  assert.match(phoneCss, /backdrop-filter:none/);
  // bows on greet / thanks for v1 too in phone mode
  assert.match(js, /Rig\.bows && \(item\.sub === 'welcome'/);
});

test('phone rig: same API as the WebGL rig + react / showCards, capped at 30 fps, never above the sprite size, no WebGL / blur / filters', () => {
  const src = fs.readFileSync(P('phone-rig.js'), 'utf8');
  for (const k of ['frame(nowMs', 'gesture', 'resize(w, h)', 'destroy()', 'get mouthOpen()', 'memory()', 'react(text, mood, sub)', 'showCards(cards']) assert.ok(src.includes(k), k);
  assert.match(src, /Math\.min\(man\.width, Math\.round\(shown \* d\)\)/);
  assert.match(src, /nowMs - S\.lastDraw < 1000 \/ fpsCap/);
  assert.doesNotMatch(src, /getContext\('webgl/);
  assert.doesNotMatch(src, /\.filter\s*=|shadowBlur|blur\(/);
  for (const g of ['greet', 'thanks', 'nod', 'happy', 'smile', 'listen', 'think', 'surprised', 'laugh', 'blink', 'brow', 'glow']) assert.ok(src.includes(`kind === '${g}'`), g);
});

test('phone rig: feeling() picks an expression from what she says (and the knowledge base mood)', async () => {
  const vm = await import('node:vm');
  const win = {}; vm.runInNewContext(fs.readFileSync(P('phone-rig.js'), 'utf8'), { window: win });
  const f = win.MiraPhone.feeling;
  assert.equal(f('haha that is funny'), 'laugh');
  assert.equal(f('Wow, really? No way!'), 'surprised');
  assert.equal(f('Congratulations, a lucky year!'), 'happy');
  assert.equal(f('Hmm, let me see what the cards say'), 'thinking');
  assert.equal(f('Your number is 7.', 'mystic'), 'thinking');
  assert.equal(f('Your number is 7.'), null);
});

test('overlay: phone mode draws expressions / tarot cards on its canvas; the PC rig itself is untouched (cards go to its effects canvas)', () => {
  const js = fs.readFileSync(P('overlay.js'), 'utf8'), rig = fs.readFileSync(P('rig.js'), 'utf8');
  assert.match(js, /if \(Rig\.api && Rig\.api\.react\) Rig\.api\.react\(item\.text, item\.mood, item\.sub\)/);
  assert.match(js, /if \(Rig\.api && Rig\.api\.showCards\) Rig\.api\.showCards\(item\.cards[^;]*; else DeskFX\.show\(item\.cards/);
  assert.doesNotMatch(rig, /showCards|react\(/);
});
