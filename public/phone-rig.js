/*
 * Mira for iPhones (phone mode): no WebGL, no video, one small 2D canvas.
 * iOS Safari kills a tab that holds too much graphics memory ("A problem repeatedly occurred"). The WebGL rig needs
 * full-size textures, a drawing buffer and a face canvas; this needs ~11-17 MB in total, like the fight game that runs
 * fine on the same phones (one 2D canvas, sized to the screen's real pixels, never above what it shows).
 * Sprites are baked from the real rig by tools/build-phone-sprites.{mjs,py} (public/assets/phone/<v>/):
 *   base.jpg   the room, table, crystal ball and her lower body (780 px wide = an iPhone's ~390 CSS px x 2)
 *   upper.png  her upper body without the solid core of her head; it breathes and sways about her hips
 *   head.png   her head, its own layer: tilts, turns and nods about the neck (soft edges overlap the upper body at
 *              the neck, so there is no seam and no old head behind a moved one)
 *   hair.png   the hair ends (v1 and v2), swung by a spring when her head moves
 *   tail.png / charm.png / table-front.png (v2)  the ponytail and the tarot charm swing as spring chains (drawn in
 *              thin strips, each turned a little more toward the tip: a bend without a mesh); the table goes back in front
 *   eye-* / gaze-* / brow-* / mouth-*.png  small face patches: blinks, happy eyes, eye glances, brows, 8-11 mouths
 * Cheap extras on the same canvas: the crystal ball and candles glow and flicker (radial gradients), a few sparkles,
 * and a tarot card that flips over when a card is pulled.
 * Same API as MiraRig (public/rig.js): frame(nowMs, { speaking, shape, open, mood }), gesture(kind), resize, destroy;
 * plus react(text, mood, sub) (an expression for what she is about to say) and showCards(cards, delayS).
 */
(function (root) {
  const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => bad(new Error('image ' + src)); i.src = src; });
  const noise = (t, s) => (Math.sin(t * 1.7 + s) + Math.sin(t * 2.9 + s * 1.3) * 0.6 + Math.sin(t * 4.3 + s * 0.7) * 0.3) / 1.9;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const spring = (s, target, k, damp, dt) => { s.v += ((target - s.x) * k - s.v * damp) * dt; s.x += s.v * dt; };
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const FALLBACK = { I: 'E', FV: 'small', MBP: null };
  const BLINK = [['lid1', 0.04], ['lid2', 0.04], ['closed', 0.08], ['lid2', 0.04], ['lid1', 0.045]];
  const GAZES = ['l', 'r', 'u', 'd', 'ul', 'ur'];

  /** What she is about to say -> an expression (keywords in English / Roman Urdu, and the knowledge base's mood). */
  function feeling(text, mood) {
    const t = String(text || '').toLowerCase();
    if (/\b(haha+|hehe|lol|lmao|funny|joke|laugh)\b|😂|🤣/.test(t)) return 'laugh';
    if (mood === 'surprised' || /\b(wow|ooh+|whoa|amazing|incredible|really\?|no way|oh my)\b|!!/.test(t)) return 'surprised';
    if (mood === 'happy' || /\b(congrat\w*|wonderful|beautiful|lucky|joy|happy|yay|thank\w*|welcome|love|sweet|bright|sunshine|percent!|mubarak|shukriya)\b/.test(t)) return 'happy';
    if (mood === 'thinking' || mood === 'mystic' || /\b(hmm+|let me (see|look)|maybe|perhaps|the cards|i see|mystery|secret|dream|whisper\w*|moon)\b/.test(t)) return 'thinking';
    if (mood === 'smile') return 'smile';
    return null;
  }

  async function create(container, opts = {}) {
    const base = opts.base || '/assets/phone/v1/';
    const man = await (await fetch(base + 'phone.json')).json();
    const imgs = {};
    const layers = ['upper', 'head', 'hair', 'tail', 'charm', 'tableFront'].filter((k) => man[k]);
    const jobs = [loadImg(base + 'base.jpg').then((i) => (imgs.base = i))];
    for (const k of layers) jobs.push(loadImg(base + man[k].src).then((i) => (imgs[k] = i)));
    for (const k of Object.keys(man.patches)) jobs.push(loadImg(base + k + '.png').then((i) => (imgs[k] = i)));
    await Promise.all(jobs);
    const canvas = document.createElement('canvas'); canvas.className = 'layer rigCanvas phoneCanvas';
    const ctx = canvas.getContext('2d', { alpha: false });
    const [ux, uy, uw, uh] = man.upper.rect, [hx, hy] = man.pivots.hips, [nx, ny] = man.pivots.neck, span = Math.max(1, hy - uy), k0 = man.scale;
    const [bx, by, br] = man.ball;
    const R = rng(opts.seed || 7);
    const fpsCap = opts.fps || 30;
    const sparkles = Array.from({ length: opts.sparkles ?? 7 }, (_, i) => ({ born: -10, life: 1, x: 0, y: 0, vy: 0, size: 0, seed: i }));
    const S = { t: 0, last: null, lastDraw: -1, talk: 0, open: 0, happy: 0, listen: 0, think: 0, surprise: 0, laugh: 0, smile: 0,
      happyUntil: 0, listenUntil: 0, thinkUntil: 0, surpriseUntil: 0, laughUntil: 0, smileUntil: 0, listenSide: 1,
      gestures: [], blink: { next: 1.5, start: -1, dbl: false }, eye: 'open', gaze: { cur: null, next: 1.2 }, browUp: 0, browDown: 0, browKick: 0,
      mouth: { cur: null }, idleSmileNext: 6, idleSmileUntil: 0, roll: 0, yaw: 0, pitch: 0, headX: 0, headXv: 0,
      hair: { x: 0, v: 0 }, tail1: { x: 0, v: 0 }, tail2: { x: 0, v: 0 }, charm: { x: 0, v: 0 }, charm2: { x: 0, v: 0 }, swayPrev: 0,
      glow: 0, cards: null, frames: 0, drawn: 0, expr: null };

    function gesture(kind, o = {}) {
      const t = S.t;
      if (kind === 'greet') { S.gestures.push({ kind: 'bow', t0: t, dur: 1.5, amp: o.amp || 1, tilt: R() < 0.5 ? -1 : 1 }); S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.2)); S.browKick = 0.8; S.charm.v += 0.25; }
      else if (kind === 'thanks') { S.gestures.push({ kind: 'bow', t0: t, dur: 2.0, amp: 1.6 * (o.amp || 1), tilt: 0 }); S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.6)); S.charm.v += 0.35; S.glow = 1; }
      else if (kind === 'nod') S.gestures.push({ kind: 'nod', t0: t, dur: 0.95, amp: o.amp || 1 });
      else if (kind === 'happy') S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 2.6));
      else if (kind === 'smile') S.smileUntil = Math.max(S.smileUntil, t + (o.seconds || 3));
      else if (kind === 'listen' || kind === 'question') { S.listenUntil = t + (o.seconds || 1.8); S.listenSide = R() < 0.5 ? -1 : 1; S.browKick = 1; S.gaze.next = t; }
      else if (kind === 'think') { S.thinkUntil = t + (o.seconds || 3); S.gaze.next = t; }
      else if (kind === 'surprised') { S.surpriseUntil = t + (o.seconds || 1.2); S.gestures.push({ kind: 'jolt', t0: t, dur: 0.7, amp: 1 }); S.blink.next = t + 1.2; }
      else if (kind === 'laugh') { S.laughUntil = t + (o.seconds || 1.8); S.happyUntil = Math.max(S.happyUntil, t + (o.seconds || 1.8) + 0.6); }
      else if (kind === 'blink') S.blink.next = t;
      else if (kind === 'brow') S.browKick = 1;
      else if (kind === 'glow') S.glow = 1;
    }
    /** An expression for what she is about to say (called when a line starts). */
    function react(text, mood, sub) {
      const f = feeling(text, mood); S.expr = f;
      if (f === 'laugh') gesture('laugh', { seconds: 1.6 });
      else if (f === 'surprised') gesture('surprised', { seconds: 1.0 });
      else if (f === 'happy') { gesture('smile', { seconds: 4 }); if (sub !== 'reply') gesture('happy', { seconds: 1.4 }); }
      else if (f === 'thinking') gesture('think', { seconds: 1.6 });
      else if (f === 'smile') gesture('smile', { seconds: 3 });
      if (mood === 'mystic' || mood === 'prophecy') S.glow = 1;
      return f;
    }

    // ------------------------------------------------------------ tarot card flip (drawn on the same canvas)
    const CW = 118, CH = 196;
    function cardFace(c) {
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
      g.fillStyle = '#f5e9cf'; g.fillRect(0, 0, CW, CH);
      g.strokeStyle = '#b8892c'; g.lineWidth = 6; g.strokeRect(4, 4, CW - 8, CH - 8); g.lineWidth = 1.5; g.strokeRect(11, 11, CW - 22, CH - 22);
      const sym = c.arcana === 'major' ? '★' : { Wands: '🜂', Cups: '🜄', Swords: '🜁', Pentacles: '⛤' }[c.suit] || '✦';
      g.fillStyle = '#5b2d86'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 54px Georgia, serif'; g.fillText(sym === '🜂' ? '♣' : sym === '🜄' ? '♥' : sym === '🜁' ? '♠' : sym === '⛤' ? '✪' : sym, CW / 2, CH * 0.4);
      g.font = 'bold 15px Georgia, serif';
      const words = c.name.split(' '); const lines = []; let line = '';
      for (const w of words) { if ((line + ' ' + w).trim().length > 11) { lines.push(line.trim()); line = w; } else line += ' ' + w; }
      lines.push(line.trim());
      lines.slice(0, 3).forEach((l, i) => g.fillText(l, CW / 2, CH * 0.7 + i * 17));
      if (c.reversed) { const r = document.createElement('canvas'); r.width = CW; r.height = CH; const rg = r.getContext('2d'); rg.translate(CW, CH); rg.rotate(Math.PI); rg.drawImage(cv, 0, 0); cv.width = 1; return r; }
      return cv;
    }
    let cardBack = null;
    function backFace() {
      if (cardBack) return cardBack;
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
      g.fillStyle = '#2a0f45'; g.fillRect(0, 0, CW, CH); g.strokeStyle = '#d9a93f'; g.lineWidth = 5; g.strokeRect(4, 4, CW - 8, CH - 8);
      g.fillStyle = '#d9a93f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '44px Georgia, serif'; g.fillText('☾', CW / 2, CH / 2 - 26); g.fillText('✦', CW / 2, CH / 2 + 30);
      return (cardBack = cv);
    }
    function showCards(cards, delay = 0.6) {
      const list = (cards || []).slice(0, 3); if (!list.length) return;
      // the phone layout zooms in on her (the bottom of the table is off screen): one card stands beside the ball,
      // three float in a row just above it
      const n = list.length, scale = n === 1 ? 1 : 0.78, gap = CW * scale + 12;
      const cx = n === 1 ? bx + br + CW * 0.62 : bx + 18, y = n === 1 ? by - br * 0.25 : by - br - CH * scale * 0.5 + 18;
      S.cards = list.map((c, i) => ({ face: cardFace(c), x: cx + (i - (n - 1) / 2) * gap, y, scale, t0: S.t + delay + i * 0.45, dur: n === 1 ? 7 : 8.5 }));
      S.glow = 1;
    }
    function drawCards() {
      if (!S.cards) return;
      let alive = false;
      for (const c of S.cards) {
        const u = S.t - c.t0; if (u < -0.001 || u > c.dur) { if (u <= c.dur) alive = true; continue; }
        alive = true;
        const rise = ease(u / 0.35), fade = u > c.dur - 0.5 ? 1 - ease((u - (c.dur - 0.5)) / 0.5) : 1;
        const flip = clamp((u - 0.35) / 0.55, 0, 1), sx = Math.abs(Math.cos(Math.PI * flip)) || 0.02, face = flip > 0.5 ? c.face : backFace();
        const w = CW * c.scale, h = CH * c.scale, cy = c.y + (1 - rise) * 40 - 6 * Math.sin(u * 1.6);
        ctx.save(); ctx.globalAlpha = rise * fade; ctx.translate(c.x, cy); ctx.rotate(0.03 * Math.sin(u * 1.1 + c.x));
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-w * sx / 2 + 4, -h / 2 + 6, w * sx, h);
        ctx.drawImage(face, -w * sx / 2, -h / 2, w * sx, h);
        if (flip > 0.5 && flip < 1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - flip) * 1.6 * rise; ctx.fillStyle = '#ffd98a'; ctx.fillRect(-w * sx / 2, -h / 2, w * sx, h); }
        ctx.restore();
      }
      if (!alive) { for (const c of S.cards) c.face.width = 1; S.cards = null; }
    }

    // ------------------------------------------------------------ motion
    function update(dt, inp) {
      const t = (S.t += dt), speaking = !!inp.speaking, mood = inp.mood;
      S.talk = approach(S.talk, speaking ? 1 : 0, 6, dt);
      S.open = approach(S.open, speaking ? clamp(inp.open || 0, 0, 1) : 0, 28, dt);
      S.happy = approach(S.happy, S.happyUntil > t || mood === 'happy' ? 1 : 0, 7, dt);
      S.listen = approach(S.listen, S.listenUntil > t ? 1 : 0, 5, dt);
      S.think = approach(S.think, S.thinkUntil > t || mood === 'prophecy' ? 1 : 0, 3, dt);
      S.surprise = approach(S.surprise, S.surpriseUntil > t ? 1 : 0, 9, dt);
      S.laugh = approach(S.laugh, S.laughUntil > t ? 1 : 0, 8, dt);
      S.smile = approach(S.smile, S.smileUntil > t ? 1 : 0, 4, dt);
      // body: clear breathing (shoulders rise ~3 px, chest widens) and a slow sway about the hips
      const breath = 3.0 * (1 - Math.cos((2 * Math.PI * t) / (speaking ? 3.4 : 4.6))) / 2;
      let sway = 0.0085 * noise(t * 0.13, 5) + 0.004 * S.talk * Math.sin(t * 0.9 + 0.5 * Math.sin(t * 0.6)) + 0.006 * S.laugh * Math.sin(t * 9);
      let lean = -S.talk * 0.8 * S.open;
      // head (about the neck): idle drift, emphasis while talking, listening tilt, thinking tilt / down, laughing bob
      let roll = 0.028 * noise(t * 0.21, 1) + 0.010 * noise(t * 0.53, 4) + S.talk * 0.022 * Math.sin(t * 1.4 + 0.6 * Math.sin(t * 0.7));
      let yaw = 2.2 * noise(t * 0.17, 3) + S.talk * 1.8 * noise(t * 0.8, 12);
      let pitch = 1.2 * noise(t * 0.23, 7) + S.talk * (1.8 * S.open + 0.8 * noise(t * 1.1, 2));
      roll += S.listen * 0.06 * S.listenSide; yaw += S.listen * 2.4 * S.listenSide; pitch -= S.listen * 1.2;
      roll += S.think * 0.035; pitch += S.think * 2.4; yaw -= S.think * 1.2;
      roll += S.happy * 0.03 * Math.sin(t * 2.1);
      pitch += S.laugh * 1.8 * Math.abs(Math.sin(t * 8.5)); roll += S.laugh * 0.02 * Math.sin(t * 4.2);
      pitch -= S.surprise * 2.2;
      for (const g of S.gestures) {
        const u = (t - g.t0) / g.dur; if (u < 0 || u > 1) continue;
        if (g.kind === 'bow') {
          const kk = u < 0.3 ? ease(u / 0.3) : u < 0.5 ? 1 : 1 - ease((u - 0.5) / 0.5);
          lean += 11 * g.amp * kk; pitch += 3.5 * g.amp * kk; roll += 0.05 * g.tilt * Math.sin(Math.PI * u); yaw += 1.6 * g.tilt * Math.sin(Math.PI * u);
        } else if (g.kind === 'nod') {
          const nod = u < 0.5 ? Math.sin(Math.PI * u / 0.5) : 0.55 * Math.sin(Math.PI * (u - 0.5) / 0.5);
          pitch += 4.2 * g.amp * nod; roll += 0.012 * g.amp * nod;
        } else if (g.kind === 'jolt') { lean -= 3 * Math.sin(Math.PI * u); }
      }
      S.gestures = S.gestures.filter((g) => t - g.t0 < g.dur);
      // short "yes" nods on stressed syllables while talking
      if (speaking && inp.open > 0.85 && (S.lastOpen || 0) <= 0.85 && R() < 0.08) gesture('nod', { amp: 0.45 });
      S.lastOpen = inp.open || 0;
      S.roll = roll; S.yaw = yaw; S.pitch = pitch; S.sway = sway;
      S.sy = 1 + ((breath - lean) * k0 * 1.38) / span; S.sx = 1 + breath * 0.35 * k0 / span;
      // hair / ponytail / charm: springs pulled by the head's and body's sideways motion, plus a candle draft
      const headX = yaw + roll * 120;
      S.headXv = approach(S.headXv, (headX - S.headX) / Math.max(dt, 1e-3), 10, dt); S.headX = headX;
      spring(S.hair, clamp(-0.11 * S.headXv, -2.5, 2.5) + 0.9 * noise(t * 0.45, 21), 38, 5.5, dt);
      spring(S.tail1, clamp(0.0016 * S.headXv, -0.09, 0.09) + 0.02 * noise(t * 0.37, 41) + 0.6 * sway, 26, 3.4, dt);
      spring(S.tail2, S.tail1.x * 0.9 + 0.01 * noise(t * 0.8, 43), 15, 2.2, dt);
      const swayV = (sway - S.swayPrev) / Math.max(dt, 1e-3); S.swayPrev = sway;
      spring(S.charm, clamp(1.2 * swayV * 160 / 9.8, -0.16, 0.16) + 0.02 * noise(t * 0.29, 47) - 0.004 * lean, 30, 1.3, dt);
      spring(S.charm2, S.charm.x * 0.6, 40, 4, dt);
      // brows: up when listening / surprised / greeting, down (focused) when thinking
      S.browKick = approach(S.browKick, 0, 1.6, dt);
      if (speaking && inp.open > 0.8 && (S.lastBrowOpen || 0) <= 0.8 && R() < 0.1) S.browKick = Math.max(S.browKick, 0.7);
      S.lastBrowOpen = inp.open || 0;
      S.browUp = approach(S.browUp, clamp(Math.max(S.listen, S.browKick, S.surprise) * 1.0 + S.happy * 0.25, 0, 1), 10, dt);
      S.browDown = approach(S.browDown, clamp(S.think * 0.75 * (1 - S.surprise), 0, 1), 6, dt);
      // eyes: glances (saccades are instant), back to the viewer often; up toward the comment when listening,
      // down into the ball when thinking
      if (t >= S.gaze.next) {
        let g = null;
        if (S.listen > 0.5) g = S.listenSide < 0 ? 'ul' : 'ur';
        else if (S.think > 0.5) g = R() < 0.6 ? 'd' : R() < 0.5 ? 'ul' : 'ur';
        else if (R() > (speaking ? 0.6 : 0.5)) g = GAZES[Math.floor(R() * GAZES.length)];
        if (g && !imgs['gaze-' + g]) g = null;
        if (g !== S.gaze.cur && S.happy < 0.5 && R() < 0.25) S.blink.next = t;   // big glances often come with a blink
        S.gaze.cur = g; S.gaze.next = t + (g ? 0.5 + R() * 1.4 : speaking ? 0.9 + R() * 2.0 : 1.2 + R() * 3.0);
      }
      const b = S.blink; S.eye = 'open';
      if (b.start < 0 && t >= b.next && S.happy < 0.5 && S.surprise < 0.5) { b.start = t; b.dbl = R() < 0.18; }
      if (b.start >= 0) {
        let u = t - b.start, i = 0; const seq = b.dbl ? BLINK.concat([['lid2', 0.05]], BLINK.slice(1)) : BLINK;
        for (; i < seq.length && u > seq[i][1]; i++) u -= seq[i][1];
        if (i >= seq.length) { b.start = -1; b.next = t + 2.0 + R() * 4.2; } else S.eye = seq[i][0];
      }
      if (S.happy > 0.5) S.eye = S.happy > 0.8 ? 'happy' : 'lid1'; else if (S.happy > 0.15 && S.eye === 'open') S.eye = 'lid1';
      if (S.think > 0.6 && S.eye === 'open' && S.gaze.cur === 'd') S.eye = 'lid1';     // eyelids lower, looking into the ball
      if (S.smile > 0.6 && S.eye === 'open' && !speaking) S.eye = 'lid1';             // a warm, soft look
      // mouth: the viseme from the voice; smiles, an "oh!" when surprised, laughing
      let shape = speaking ? inp.shape || null : null;
      if (shape && !imgs['mouth-' + shape] && shape in FALLBACK) shape = FALLBACK[shape];
      if (shape === 'rest' || (shape && !imgs['mouth-' + shape])) shape = null;
      if (!speaking) {
        if (t > S.idleSmileNext && S.idleSmileUntil < t) { S.idleSmileUntil = t + 2 + R() * 3; S.idleSmileNext = t + 9 + R() * 12; }
        if (S.laugh > 0.4) shape = Math.sin(t * 17) > 0 ? 'happy' : 'smile';
        else if (S.surprise > 0.5) shape = 'O';
        else if (S.happy > 0.4 || S.smile > 0.4 || S.idleSmileUntil > t) shape = 'smile';
        else if (S.think > 0.6) shape = 'small';
        if (shape && !imgs['mouth-' + shape]) shape = shape === 'small' ? null : 'smile';
      } else if ((S.happy > 0.5 || S.smile > 0.5 || S.laugh > 0.4) && (shape === 'E' || shape === 'I' || shape === 'small' || shape === 'A')) shape = 'happy';
      S.mouth.cur = shape;
      // glow + sparkles
      S.glow = approach(S.glow, 0, 0.8, dt);
      const spawn = 0.35 + S.glow * 2 + S.think * 0.8 + (S.cards ? 1.2 : 0);
      for (const p of sparkles) if (t - p.born > p.life && R() < spawn * dt) {
        const a = R() * Math.PI * 2, rr = br * (0.9 + R() * 0.7);
        Object.assign(p, { born: t, life: 1.1 + R() * 1.4, x: bx + Math.cos(a) * rr, y: by + Math.sin(a) * rr * 0.7 - br * 0.2, vy: -(10 + R() * 18), size: 2.5 + R() * 3.5 });
      }
    }

    // ------------------------------------------------------------ drawing
    const p = (name, a = 1) => { const r = man.patches[name], im = imgs[name]; if (r && im && a > 0.02) { if (a < 1) ctx.globalAlpha = a; ctx.drawImage(im, ux + r[0], uy + r[1], r[2], r[3]); if (a < 1) ctx.globalAlpha = 1; } };
    function strips(im, rect, anchor, length, a1, a2, n) {
      // a spring chain without a mesh: thin rows, each turned about the anchor by root angle + extra bend toward the tip
      const [rx, ry, rw, rh] = rect, [ax, ay] = anchor, sw = im.naturalWidth / rw, sh = im.naturalHeight / rh, step = rh / n;
      for (let i = 0; i < n; i++) {
        const y0 = ry + i * step, s = clamp((y0 + step / 2 - ay) / length, 0, 1.2), th = a1 * s + a2 * s * s;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(th);
        ctx.drawImage(im, 0, i * step * sh, im.naturalWidth, Math.min(im.naturalHeight - i * step * sh, (step + 1) * sh), rx - ax, y0 - ay, rw, step + 1);
        ctx.restore();
      }
    }
    function glow(t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // crystal ball: a slow pulse, brighter when she is reading / thinking / a card is pulled
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6) * Math.sin(t * 0.37 + 1);
      const ga = 0.10 + 0.08 * pulse + 0.18 * S.glow + 0.08 * S.think + 0.05 * S.talk;
      let g = ctx.createRadialGradient(bx, by, br * 0.15, bx, by, br * 1.55);
      g.addColorStop(0, `rgba(205,140,255,${ga})`); g.addColorStop(0.55, `rgba(150,70,255,${ga * 0.45})`); g.addColorStop(1, 'rgba(120,40,220,0)');
      ctx.fillStyle = g; ctx.fillRect(bx - br * 1.6, by - br * 1.6, br * 3.2, br * 3.2);
      // candles: small warm flickers
      (man.flames || []).forEach(([fx, fy], i) => {
        const f = 0.55 + 0.3 * noise(t * 3.1, i * 7.3) + 0.15 * Math.sin(t * 11 + i);
        const rr = 16 + 4 * f;
        g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rr);
        g.addColorStop(0, `rgba(255,200,110,${0.28 * f})`); g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g; ctx.fillRect(fx - rr, fy - rr, rr * 2, rr * 2);
      });
      // sparkles: little four-point stars rising around the ball
      for (const s of sparkles) {
        const u = (t - s.born) / s.life; if (u < 0 || u > 1) continue;
        const a = Math.sin(Math.PI * u), x = s.x + 4 * Math.sin(t * 2 + s.seed), y = s.y + s.vy * u * s.life, z = s.size * (0.6 + 0.4 * a);
        ctx.globalAlpha = 0.85 * a; ctx.fillStyle = '#fff3d6';
        ctx.fillRect(x - z, y - 0.6, z * 2, 1.2); ctx.fillRect(x - 0.6, y - z, 1.2, z * 2);
        ctx.globalAlpha = 0.35 * a; ctx.fillStyle = '#d9b8ff'; ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
      }
      ctx.restore();
    }
    function draw() {
      const k = canvas.width / man.width, t = S.t;
      ctx.setTransform(k, 0, 0, k, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(imgs.base, 0, 0, man.width, man.height);
      // the charm hangs in the static part of the picture; the table goes back in front of it
      if (imgs.charm) { strips(imgs.charm, man.charm.rect, man.charm.anchor, man.charm.length, S.charm.x, S.charm2.x - S.charm.x, 10); if (imgs.tableFront) { const r = man.tableFront.rect; ctx.drawImage(imgs.tableFront, r[0], r[1], r[2], r[3]); } }
      ctx.save();
      // body: about the hips, translate(h) . rotate . scale(sx, sy) . translate(-h)
      const c = Math.cos(S.sway), s = Math.sin(S.sway);
      ctx.transform(c * S.sx, s * S.sx, -s * S.sy, c * S.sy, hx - (c * S.sx * hx - s * S.sy * hy), hy - (s * S.sx * hx + c * S.sy * hy));
      ctx.drawImage(imgs.upper, ux, uy, uw, uh);
      if (imgs.tail) strips(imgs.tail, man.tail.rect, man.tail.anchor, man.tail.length, S.tail1.x, S.tail2.x - S.tail1.x, 14);
      // head: roll about the neck, turn / nod as a small shift
      ctx.translate(nx, ny); ctx.rotate(S.roll); ctx.translate(-nx + S.yaw * k0, -ny + S.pitch * k0);
      const h = man.head.rect; ctx.drawImage(imgs.head, h[0], h[1], h[2], h[3]);
      if (imgs.hair) { const r = man.hair.rect; ctx.drawImage(imgs.hair, r[0] + S.hair.x * k0 * 0.8, r[1], r[2], r[3]); }
      if (S.eye === 'open') { if (S.gaze.cur) p('gaze-' + S.gaze.cur); } else p('eye-' + S.eye);
      p('brow-up', S.browUp); p('brow-down', S.browDown * (1 - S.browUp));
      if (S.mouth.cur) p('mouth-' + S.mouth.cur);
      ctx.restore();
      glow(t);
      drawCards();
      S.drawn++;
    }
    const api = {
      canvas, version: man.version, kind: 'phone', lively: true, state: S, gesture, react, showCards, lost: false, manifest: man,
      /** Backing size: what is shown (CSS size after the stage's scale) x min(devicePixelRatio, 2), never above the sprites. */
      resize(w, h) {
        const d = Math.min(2, opts.dpr || window.devicePixelRatio || 1);
        const shown = (canvas.isConnected && canvas.getBoundingClientRect().width) || w;
        const cw = Math.max(2, Math.min(man.width, Math.round(shown * d))), ch = Math.max(2, Math.round((cw * man.height) / man.width));
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; S.lastDraw = -1; }
      },
      frame(nowMs, inp = {}) {
        const dt = S.last == null ? 1 / 60 : clamp((nowMs - S.last) / 1000, 0, 0.1); S.last = nowMs;
        update(dt, inp); S.frames++;
        if (S.force) Object.assign(S, S.force);   // tests / visual checks: hold a pose
        // ~30 fps is plenty for a phone (and half the battery / heat of 60)
        if (S.lastDraw >= 0 && nowMs - S.lastDraw < 1000 / fpsCap - 4) return;
        S.lastDraw = nowMs; draw();
      },
      get mouthOpen() { return S.open; },
      /** Bytes of decoded pictures + the canvas + card canvases (for the diagnostics). */
      memory() {
        let px = canvas.width * canvas.height;
        for (const i of Object.values(imgs)) if (i) px += i.naturalWidth * i.naturalHeight;
        if (cardBack) px += CW * CH; if (S.cards) px += S.cards.length * CW * CH;
        return px * 4;
      },
      destroy() { api.dead = true; canvas.width = canvas.height = 1; canvas.remove(); for (const k in imgs) { if (imgs[k]) imgs[k].src = ''; imgs[k] = null; } if (cardBack) cardBack.width = 1; },
    };
    container.appendChild(canvas);
    return api;
  }
  root.MiraPhone = { create, feeling };
})(window);
