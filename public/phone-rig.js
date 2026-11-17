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
    // crystal-ball gaze: her hands rise over the ball (v1: her resting hands leave the table; tools/build-hand-sprites.py)
    for (const sd of ['l', 'r']) {
      if (man.hands && man.hands[sd]) jobs.push(loadImg(base + man.hands[sd].src).then((i) => (imgs['hand-' + sd] = i)).catch(() => {}));
      if (man.restHands && man.restHands[sd]) jobs.push(loadImg(base + man.restHands[sd].fill).then((i) => (imgs['rest-fill-' + sd] = i)).catch(() => {}));
    }
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
      glow: 0, cards: null, frames: 0, drawn: 0, expr: null, gazeUntil: 0, gazeAmt: 0, handAmt: 0, reach: 0 };

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
      // looking into the crystal ball: head down, eyes on the ball, hands rise over it, the ball swirls and glows
      else if (kind === 'gaze') { S.gazeUntil = Math.max(S.gazeUntil, t + (o.seconds || 3)); S.glow = 1; S.gaze.next = t; }
      else if (kind === 'gazeEnd') S.gazeUntil = t;
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

    // ------------------------------------------------------------ tarot card pulls (public/mira-fx.js, same canvas)
    // the phone layout zooms in on her (the bottom of the table is off screen; TikTok's comments cover the left):
    // one card stands right of the ball, three fan out there; the deck lies on the table right of the ball
    const CW = 132, CH = 220;
    const FX = root.MiraFX;
    const cards = FX ? FX.Cards({ W: CW, H: CH, deck: [bx + br * 1.2, by + br * 0.62],
      layout: (n) => n === 1 ? [{ x: bx + br + CW * 0.62, y: by - br * 0.3, rot: 0.04, scale: 1 }]
        : [0, 1, 2].slice(0, n).map((i) => ({ x: bx + br + CW * 0.42 + (i - (n - 1) / 2) * CW * 0.6, y: by - br * 0.45 + Math.abs(i - (n - 1) / 2) * 14, rot: (i - (n - 1) / 2) * 0.2, scale: 0.78 })) }) : null;
    /** Pull up to 3 cards: her hand reaches for the deck, each card slides out, flips over, stays `hold` s, fades. */
    function showCards(list, delay = 0.6, hold = 7) {
      if (!cards || !list || !list.length) return;
      cards.show(list, S.t, { delay, hold });
      S.cards = true; S.glow = 1;
    }
    function drawCards() { if (!cards) return; cards.draw(ctx, S.t); S.cards = cards.active || null; }

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
      S.gazeAmt = approach(S.gazeAmt, S.gazeUntil > t ? 1 : 0, S.gazeUntil > t ? 3.2 : 2.2, dt);
      S.reach = cards ? cards.reach(t) : 0;
      S.handAmt = Math.max(S.gazeAmt, S.reach);
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
      pitch += S.gazeAmt * 3.6; roll -= S.gazeAmt * 0.02; lean += S.gazeAmt * 4;   // she leans in and looks down into the ball
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
      S.browDown = approach(S.browDown, clamp(Math.max(S.think * 0.75, S.gazeAmt * 0.55) * (1 - S.surprise), 0, 1), 6, dt);
      // eyes: glances (saccades are instant), back to the viewer often; up toward the comment when listening,
      // down into the ball when thinking
      if (t >= S.gaze.next) {
        let g = null;
        if (S.listen > 0.5) g = S.listenSide < 0 ? 'ul' : 'ur';
        else if (S.gazeAmt > 0.4) g = 'd';
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
      if ((S.think > 0.6 || S.gazeAmt > 0.5) && S.eye === 'open' && S.gaze.cur === 'd') S.eye = 'lid1';     // eyelids lower, looking into the ball
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
      const spawn = 0.35 + S.glow * 2 + S.think * 0.8 + S.gazeAmt * 2.5 + (S.cards ? 1.2 : 0);
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
    /** Her hands rise from the cuffs and hover over the ball (soft circles), palms glowing; the right one reaches for the deck. */
    function hands(t) {
      const a = ease(S.handAmt); if (a < 0.02 || !man.hands) return;
      for (const sd of ['l', 'r']) {
        const im = imgs['hand-' + sd], hm = man.hands[sd]; if (!im) continue;
        const side = sd === 'l' ? -1 : 1, [rx, ry, rw, rh] = hm.rect, [wx, wy] = hm.wrist;
        const hover = S.gazeAmt;
        let dx = -side * (1 - a) * 10 + Math.sin(t * 2.3 + side) * 2.5 * hover, dy = (1 - a) * 26 + Math.cos(t * 1.9 + side * 0.7) * 3 * hover;
        let rot = 0.05 * Math.sin(t * 1.6 + side) * hover - side * (1 - a) * 0.3;
        if (sd === 'r' && S.reach > 0.01 && cards) { const e = ease(S.reach); dx += (cards.deck[0] - (rx + rw * 0.4)) * 0.55 * e; dy += (cards.deck[1] - (ry + rh * 0.5)) * 0.5 * e; rot += 0.35 * e; }
        ctx.save(); ctx.globalAlpha = a; ctx.translate(wx + dx, wy + dy); ctx.rotate(rot); ctx.translate(-wx, -wy);
        ctx.drawImage(im, rx, ry, rw, rh);
        ctx.restore();
        // a violet glow under the palm
        const px = rx + rw * (sd === 'l' ? 0.62 : 0.38) + dx, py = ry + rh * 0.62 + dy, pr = rw * 0.55;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const gg = ctx.createRadialGradient(px, py, 0, px, py, pr); gg.addColorStop(0, `rgba(220,160,255,${0.32 * a * (0.8 + 0.2 * Math.sin(t * 4 + side))})`); gg.addColorStop(1, 'rgba(160,80,255,0)');
        ctx.fillStyle = gg; ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2); ctx.restore();
      }
    }
    function glow(t) {
      if (FX) FX.drawBall(ctx, t, bx, by, br, Math.max(S.gazeAmt, S.reach * 0.6, S.glow * 0.5));
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
      // v1: while her hands are up, the table where they rested shows (filled in)
      if (man.restHands && S.handAmt > 0.02) for (const sd of ['l', 'r']) { const im = imgs['rest-fill-' + sd], r = man.restHands[sd].rect; if (im) { ctx.globalAlpha = ease(S.handAmt); ctx.drawImage(im, r[0], r[1], r[2], r[3]); ctx.globalAlpha = 1; } }
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
      hands(t);
      glow(t);
      drawCards();
      S.drawn++;
    }
    const api = {
      canvas, version: man.version, kind: 'phone', lively: true, state: S, gesture, react, showCards, lost: false, manifest: man, gazeHands: !!man.hands,
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
        return px * 4 + (cards ? cards.memory() : 0);
      },
      destroy() { api.dead = true; canvas.width = canvas.height = 1; canvas.remove(); for (const k in imgs) { if (imgs[k]) imgs[k].src = ''; imgs[k] = null; } if (cards) cards.destroy(); },
    };
    container.appendChild(canvas);
    return api;
  }
  root.MiraPhone = { create, feeling };
})(window);
