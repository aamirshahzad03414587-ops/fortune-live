/*
 * Mira for iPhones (phone mode): no WebGL, no video, one small 2D canvas.
 * iOS Safari kills a tab that holds too much graphics memory ("A problem repeatedly occurred"). The WebGL rig needs
 * full-size textures, a drawing buffer and a face canvas; this needs ~10 MB in total, like the fight game that runs
 * fine on the same phones (one 2D canvas, sized to the screen's real pixels, never above what it shows).
 * Sprites are baked from the real rig by tools/build-phone-sprites.{mjs,py} (public/assets/phone/<v>/):
 *   base.jpg  the room, table, crystal ball and her lower body (780 px wide = an iPhone's ~390 CSS px x 2)
 *   upper.png her upper body; it breathes, sways and bows (a transform about her hips)
 *   eye-* / mouth-*.png  small patches that only cover what changes (blinks, happy eyes, 8-11 mouth shapes)
 * Same API as MiraRig (public/rig.js): frame(nowMs, { speaking, shape, open, mood }), gesture(kind), resize, destroy.
 */
(function (root) {
  const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => bad(new Error('image ' + src)); i.src = src; });
  const noise = (t, s) => (Math.sin(t * 1.7 + s) + Math.sin(t * 2.9 + s * 1.3) * 0.6 + Math.sin(t * 4.3 + s * 0.7) * 0.3) / 1.9;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const FALLBACK = { I: 'E', FV: 'small', MBP: null };
  const BLINK = [['lid1', 0.04], ['lid2', 0.04], ['closed', 0.08], ['lid2', 0.04], ['lid1', 0.045]];

  async function create(container, opts = {}) {
    const base = opts.base || '/assets/phone/v1/';
    const man = await (await fetch(base + 'phone.json')).json();
    const imgs = {};
    const jobs = [loadImg(base + 'base.jpg').then((i) => (imgs.base = i)), loadImg(base + man.upper.src).then((i) => (imgs.upper = i))];
    for (const k of Object.keys(man.patches)) jobs.push(loadImg(base + k + '.png').then((i) => (imgs[k] = i)));
    await Promise.all(jobs);
    const canvas = document.createElement('canvas'); canvas.className = 'layer rigCanvas phoneCanvas';
    const ctx = canvas.getContext('2d', { alpha: false });
    const [ux, uy, uw, uh] = man.upper.rect, [hx, hy] = man.pivots.hips, span = Math.max(1, hy - uy), k0 = man.scale;   // k0: sprite px per rig px
    const R = rng(opts.seed || 7);
    const S = { t: 0, last: null, talk: 0, open: 0, happy: 0, listen: 0, think: 0, happyUntil: 0, listenUntil: 0, thinkUntil: 0, listenSide: 1,
      gestures: [], blink: { next: 1.5, start: -1, dbl: false }, eye: 'open', mouth: { cur: null }, idleSmileNext: 6, idleSmileUntil: 0, drawn: '' };
    function gesture(kind, o = {}) {
      const t = S.t;
      if (kind === 'greet') { S.gestures.push({ t0: t, dur: 1.5, amp: o.amp || 1, tilt: R() < 0.5 ? -1 : 1 }); S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.2)); }
      else if (kind === 'thanks') { S.gestures.push({ t0: t, dur: 2.0, amp: 1.6 * (o.amp || 1), tilt: 0 }); S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.6)); }
      else if (kind === 'nod') S.gestures.push({ t0: t, dur: 0.95, amp: 0.45 * (o.amp || 1), tilt: 0 });
      else if (kind === 'happy') S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.6));
      else if (kind === 'listen' || kind === 'question') { S.listenUntil = t + (o.seconds || 1.8); S.listenSide = R() < 0.5 ? -1 : 1; }
      else if (kind === 'think') S.thinkUntil = t + (o.seconds || 3);
      else if (kind === 'blink') S.blink.next = t;
      else if (kind === 'brow') S.gestures.push({ t0: t, dur: 0.7, amp: 0.2, tilt: 0 });
    }
    function update(dt, inp) {
      const t = (S.t += dt), speaking = !!inp.speaking;
      S.talk = approach(S.talk, speaking ? 1 : 0, 6, dt);
      S.open = approach(S.open, speaking ? clamp(inp.open || 0, 0, 1) : 0, 28, dt);
      S.happy = approach(S.happy, S.happyUntil > t || inp.mood === 'happy' ? 1 : 0, 7, dt);
      S.listen = approach(S.listen, S.listenUntil > t ? 1 : 0, 5, dt);
      S.think = approach(S.think, S.thinkUntil > t || inp.mood === 'prophecy' ? 1 : 0, 3, dt);
      // body: breathing (shoulders up ~2 px), slow sway about the hips, a little life while talking, bows / nods
      const breath = 2.1 * (1 - Math.cos((2 * Math.PI * t) / (speaking ? 3.6 : 4.4))) / 2;
      let rot = 0.0045 * noise(t * 0.12, 5) + 0.0025 * S.talk * Math.sin(t * 1.3 + 0.5 * Math.sin(t * 0.7));
      rot += S.listen * 0.012 * S.listenSide + S.think * 0.004;
      let lean = -S.talk * 0.8 * S.open;
      for (const g of S.gestures) {
        const u = (t - g.t0) / g.dur; if (u < 0 || u > 1) continue;
        const kk = u < 0.3 ? ease(u / 0.3) : u < 0.5 ? 1 : 1 - ease((u - 0.5) / 0.5);
        lean += 11 * g.amp * kk; rot += 0.012 * g.tilt * Math.sin(Math.PI * u);
      }
      S.gestures = S.gestures.filter((g) => t - g.t0 < g.dur);
      S.rot = rot; S.sy = 1 + ((breath - lean) * k0) / span; S.sx = 1 + breath * 0.25 * k0 / span;
      // eyes: blinks every 2-6 s (sometimes double), happy eyes when greeting / thanking
      const b = S.blink; S.eye = 'open';
      if (b.start < 0 && t >= b.next && S.happy < 0.5) { b.start = t; b.dbl = R() < 0.18; }
      if (b.start >= 0) {
        let u = t - b.start, i = 0; const seq = b.dbl ? BLINK.concat([['lid2', 0.05]], BLINK.slice(1)) : BLINK;
        for (; i < seq.length && u > seq[i][1]; i++) u -= seq[i][1];
        if (i >= seq.length) { b.start = -1; b.next = t + 2.0 + R() * 4.2; } else S.eye = seq[i][0];
      }
      if (S.happy > 0.5) S.eye = S.happy > 0.8 ? 'happy' : 'lid1'; else if (S.happy > 0.15 && S.eye === 'open') S.eye = 'lid1';
      if (S.think > 0.6 && S.eye === 'open') S.eye = 'lid1';                       // looking down into the ball
      // mouth: the viseme from the voice; a smile now and then while quiet
      let shape = speaking ? inp.shape || null : null;
      if (shape && !imgs['mouth-' + shape] && shape in FALLBACK) shape = FALLBACK[shape];
      if (shape === 'rest' || (shape && !imgs['mouth-' + shape])) shape = null;
      if (!speaking) {
        if (t > S.idleSmileNext && S.idleSmileUntil < t) { S.idleSmileUntil = t + 2 + R() * 3; S.idleSmileNext = t + 9 + R() * 12; }
        if (S.happy > 0.4 || S.idleSmileUntil > t) shape = 'smile';
      } else if (S.happy > 0.5 && (shape === 'E' || shape === 'I' || shape === 'small' || shape === 'A')) shape = 'happy';
      S.mouth.cur = shape;
    }
    function draw() {
      const k = canvas.width / man.width;
      // nothing moved (to a quarter of a screen pixel) and the face is the same: keep the last frame
      const key = `${S.eye}|${S.mouth.cur}|${Math.round(S.rot * 4000)}|${Math.round((S.sy - 1) * span * k * 4)}|${Math.round((S.sx - 1) * 400 * k)}|${canvas.width}`;
      if (key === S.drawn) return; S.drawn = key;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.drawImage(imgs.base, 0, 0, man.width, man.height);
      const c = Math.cos(S.rot), s = Math.sin(S.rot);
      // about the hips: translate(h) . rotate . scale(sx, sy) . translate(-h)
      ctx.transform(c * S.sx, s * S.sx, -s * S.sy, c * S.sy, hx - (c * S.sx * hx - s * S.sy * hy), hy - (s * S.sx * hx + c * S.sy * hy));
      ctx.drawImage(imgs.upper, ux, uy, uw, uh);
      const p = (name) => { const r = man.patches[name], im = imgs[name]; if (r && im) ctx.drawImage(im, ux + r[0], uy + r[1], r[2], r[3]); };
      if (S.eye !== 'open') p('eye-' + S.eye);
      if (S.mouth.cur) p('mouth-' + S.mouth.cur);
    }
    const api = {
      canvas, version: man.version, kind: 'phone', state: S, gesture, lost: false, manifest: man,
      /** Backing size: what is shown (CSS size after the stage's scale) x min(devicePixelRatio, 2), never above the sprites. */
      resize(w, h) {
        const d = Math.min(2, opts.dpr || window.devicePixelRatio || 1);
        const shown = (canvas.isConnected && canvas.getBoundingClientRect().width) || w;
        const cw = Math.max(2, Math.min(man.width, Math.round(shown * d))), ch = Math.max(2, Math.round((cw * man.height) / man.width));
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; S.drawn = ''; }
      },
      frame(nowMs, inp = {}) {
        const dt = S.last == null ? 1 / 60 : clamp((nowMs - S.last) / 1000, 0, 0.1); S.last = nowMs;
        update(dt, inp); draw();
      },
      get mouthOpen() { return S.open; },
      /** Bytes of decoded pictures + the canvas (for the diagnostics). */
      memory() { let px = canvas.width * canvas.height; for (const i of Object.values(imgs)) if (i) px += i.naturalWidth * i.naturalHeight; return px * 4; },
      destroy() { api.dead = true; canvas.width = canvas.height = 1; canvas.remove(); for (const k in imgs) { if (imgs[k]) imgs[k].src = ''; imgs[k] = null; } },
    };
    container.appendChild(canvas);
    return api;
  }
  root.MiraPhone = { create };
})(window);
