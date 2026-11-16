/*
 * Mira's real-time 2D puppet rig (WebGL). One painting of her, split into a rig by tools/build-rig.py:
 *   - her silhouette (alpha) over a painted-out room plate, so she can move without leaving holes
 *   - deformation weights for head+hair, side-hair sway and the fringe
 *   - face parts painted in her style: 3-step eyelids, closed and happy eyes, eye whites + iris (gaze),
 *     and mouth shapes made from her own lips (rest, smile, small, E/I, A, O, U, happy)
 * Every frame:
 *   1. the face parts are composited into a small face canvas (eyes, mouth, blush) in picture space;
 *   2. a fragment shader warps the whole picture with smooth displacement fields (breathing, body sway,
 *      head roll / turn / nod with face parallax, hair springs, jaw, brows) and samples the face canvas
 *      through the SAME warp, so the mouth and eyes move with the face (never a sticker on top).
 * Usage: const rig = await MiraRig.create(container, { base: '/assets/rig/', image: '/assets/mira2.jpg' });
 *        rig.frame(nowMs, { speaking, shape, open, mood }); rig.gesture('nod' | 'listen' | 'happy' | 'think');
 */
(function (root) {
  const VERT = `attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5); gl_Position = vec4(aPos,0.0,1.0); }`;
  const FRAG = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 vUV;
  uniform sampler2D uOrig, uAlpha, uBg, uW, uPatch;
  uniform vec2 uSize; uniform vec4 uFace; uniform vec2 uNeck, uHips; uniform vec3 uBall;
  uniform float uRoll, uSway, uBreath, uYaw, uPitch, uJaw, uBrow, uFringe; uniform vec2 uHeadT, uHair;
  vec2 rot(vec2 p, vec2 c, float a){ vec2 d = p - c; float s = sin(a), co = cos(a); return c + vec2(co*d.x - s*d.y, s*d.x + co*d.y); }
  void main(){
    vec2 p = vUV * uSize;
    vec4 w = texture2D(uW, vUV);
    // body: breathing + a slow sway about the hips; the table, hands and crystal ball stay put
    float body = smoothstep(1185.0, 720.0, p.y) * smoothstep(uBall.z, uBall.z + 45.0, length(p - uBall.xy));
    vec2 D = body * (rot(p, uHips, uSway) - p);
    D.y -= uBreath * body;
    float chest = exp(-pow((p.y - 845.0) / 115.0, 2.0));
    D.x += uBreath * 0.45 * body * chest * clamp((p.x - 476.0) / 170.0, -1.5, 1.5);
    // head: roll about the neck, plus turn / nod where the face (nose, eyes, mouth) moves more than the outline
    vec2 hd = rot(p, uNeck, uRoll) - p + uHeadT;
    vec2 f = (p - vec2(477.0, 536.0)) / vec2(48.0, 60.0);
    hd += vec2(uYaw, uPitch) * (0.35 + 0.65 * exp(-0.5 * dot(f, f)));
    D += w.r * hd;
    D += w.g * uHair;
    D.x += w.b * uFringe;
    // jaw follows the mouth opening; brows lift
    float jx = (p.x - 476.0) / 26.0;
    D.y += uJaw * smoothstep(581.0, 591.0, p.y) * (1.0 - smoothstep(603.0, 624.0, p.y)) * exp(-0.5 * jx * jx);
    vec2 b1 = (p - vec2(434.0, 497.0)) / vec2(14.0, 5.5), b2 = (p - vec2(519.0, 500.0)) / vec2(14.0, 5.5);
    D.y -= uBrow * (exp(-0.5 * dot(b1, b1)) + exp(-0.5 * dot(b2, b2)));
    vec2 q = p - D, qu = q / uSize;
    vec3 c = texture2D(uOrig, qu).rgb;
    vec2 fp = (q - uFace.xy) / uFace.zw;
    if (fp.x > 0.0 && fp.y > 0.0 && fp.x < 1.0 && fp.y < 1.0) c = texture2D(uPatch, fp).rgb;
    float a = texture2D(uAlpha, qu).r;
    // the room: the original picture, or the painted-out plate where she used to be
    vec3 back = mix(texture2D(uOrig, vUV).rgb, texture2D(uBg, vUV).rgb, texture2D(uAlpha, vUV).r);
    gl_FragColor = vec4(mix(back, c, a), 1.0);
  }`;

  const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('image ' + src)); i.src = src; });
  // smooth pseudo-random motion
  const noise = (t, s) => (Math.sin(t * 1.7 + s) + Math.sin(t * 2.9 + s * 1.3) * 0.6 + Math.sin(t * 4.3 + s * 0.7) * 0.3) / 1.9;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  async function create(container, opts = {}) {
    const base = opts.base || '/assets/rig/';
    const rig = await (await fetch(base + 'rig.json')).json();
    const faceNames = ['white', 'inner', 'mask', 'band', 'lid1', 'lid2', 'closed', 'happy'];
    const imgs = {};
    const jobs = [loadImg(opts.image || '/assets/mira2.jpg').then((i) => (imgs.orig = i)), loadImg(base + 'char-alpha.png').then((i) => (imgs.alpha = i)),
      loadImg(base + 'bg.jpg').then((i) => (imgs.bg = i)), loadImg(base + 'weights.png').then((i) => (imgs.w = i))];
    for (const e of ['L', 'R']) for (const n of faceNames) jobs.push(loadImg(`${base}face/eye${e}-${n}.png`).then((i) => (imgs[`eye${e}-${n}`] = i)));
    for (const m of rig.mouthShapes) jobs.push(loadImg(`${base}face/mouth-${m}.png`).then((i) => (imgs['mouth-' + m] = i)));
    await Promise.all(jobs);

    // Textures are capped (2048, or 1024 in lite mode) so a weak GPU / LIVE Studio's browser source never gets huge uploads.
    const maxTex = opts.maxTex || 2048;
    const fit = (im) => {
      const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, maxTex / Math.max(w, h));
      if (k >= 1) return im;
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c;
    };
    const texSrc = { orig: fit(imgs.orig), alpha: fit(imgs.alpha), bg: fit(imgs.bg), w: fit(imgs.w) };
    const canvas = document.createElement('canvas'); canvas.className = 'layer rigCanvas';
    const [fx0, fy0, fx1, fy1] = rig.face;
    const face = document.createElement('canvas'); face.width = fx1 - fx0; face.height = fy1 - fy0;
    const fc = face.getContext('2d');
    const tmp = document.createElement('canvas'); const tc = tmp.getContext('2d');
    let gl = null, U = {}, patchTex = null;
    // All GPU state is built here, so it can be rebuilt after a WebGL context loss (GPU reset, driver hiccup, memory pressure).
    function setupGL() {
      gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: !!opts.preserve }) || canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('WebGL not available');
      if (!texSrc.alpha) throw new Error('layers released (lite mode)');
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      U = {}; for (const n of ['uOrig', 'uAlpha', 'uBg', 'uW', 'uPatch', 'uSize', 'uFace', 'uNeck', 'uHips', 'uBall', 'uRoll', 'uSway', 'uBreath', 'uYaw', 'uPitch', 'uJaw', 'uBrow', 'uFringe', 'uHeadT', 'uHair']) U[n] = gl.getUniformLocation(prog, n);
      const tex = (unit, src, fmt = gl.RGBA) => {
        const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src); return t;
      };
      tex(0, texSrc.orig, gl.RGB); tex(1, texSrc.alpha, gl.LUMINANCE); tex(2, texSrc.bg, gl.RGB); tex(3, texSrc.w);   // no unused channels on the GPU
      patchTex = tex(4, face);
      gl.uniform1i(U.uOrig, 0); gl.uniform1i(U.uAlpha, 1); gl.uniform1i(U.uBg, 2); gl.uniform1i(U.uW, 3); gl.uniform1i(U.uPatch, 4);
      gl.uniform2f(U.uSize, rig.width, rig.height); gl.uniform4f(U.uFace, fx0, fy0, fx1 - fx0, fy1 - fy0);
      gl.uniform2f(U.uNeck, ...rig.pivots.neck); gl.uniform2f(U.uHips, ...rig.pivots.hips); gl.uniform3f(U.uBall, ...rig.ball);
    }
    setupGL();
    // lean (lite) mode: the full-size layer pictures are on the GPU now, so let the page drop its copies (phones have little
    // memory; iOS Safari kills the tab around 300-400 MB). A context loss then falls back to the still picture instead.
    if (opts.lean) { texSrc.alpha = texSrc.bg = texSrc.w = null; imgs.alpha = imgs.bg = imgs.w = null; }

    // ---------------------------------------------------------------- animation state
    const R = rng(opts.seed || 7);
    const S = {
      t: 0, last: null, mood: 'neutral', happy: 0, listen: 0, think: 0, talk: 0, open: 0, jaw: 0, brow: 0, browKick: 0,
      roll: 0, yaw: 0, pitch: 0, headX: 0, headXv: 0, hair: { x: 0, v: 0 }, hairY: { x: 0, v: 0 }, fringe: { x: 0, v: 0 },
      gaze: { x: 0, y: 0, tx: 0, ty: 0, next: 1.2 }, blink: { next: 1.5, start: -1, dbl: false, frames: null },
      gestures: [], listenSide: 1, mouth: { cur: null, prev: null, f: 1 }, lastShape: null, smile: 0, idleSmileNext: 6, idleSmileUntil: 0,
    };
    const BLINK = [['lid1', 0.035], ['lid2', 0.035], ['closed', 0.075], ['lid2', 0.04], ['lid1', 0.045]];

    function gesture(kind, opt = {}) {
      const t = S.t;
      if (kind === 'nod') S.gestures.push({ kind, t0: t, dur: 0.95, amp: opt.amp || 1 });
      else if (kind === 'listen') { S.listenUntil = t + (opt.seconds || 1.8); S.listenSide = R() < 0.5 ? -1 : 1; S.browKick = 1; }
      else if (kind === 'happy') { S.happyUntil = t + (opt.seconds || 2.6); }
      else if (kind === 'think') { S.thinkUntil = t + (opt.seconds || 3); }
      else if (kind === 'brow') S.browKick = 1;
      else if (kind === 'blink') S.blink.next = t;
    }

    function spring(s, target, k, c, dt) { const a = -k * (s.x - target) - c * s.v; s.v += a * dt; s.x += s.v * dt; }

    function update(dt, inp) {
      const t = (S.t += dt);
      const speaking = !!inp.speaking;
      S.talk = approach(S.talk, speaking ? 1 : 0, 6, dt);
      const open = speaking ? clamp(inp.open || 0, 0, 1) : 0;
      S.open = approach(S.open, open, 28, dt);
      S.happy = approach(S.happy, (S.happyUntil > t || inp.mood === 'happy') ? 1 : 0, 7, dt);
      S.listen = approach(S.listen, S.listenUntil > t ? 1 : 0, 5, dt);
      S.think = approach(S.think, (S.thinkUntil > t || inp.mood === 'prophecy') ? 1 : 0, 3, dt);

      // head: idle drift + talking emphasis + gestures
      let roll = 0.017 * noise(t * 0.21, 1) + 0.006 * noise(t * 0.53, 4);
      let yaw = 2.0 * noise(t * 0.17, 3) + 0.6 * noise(t * 0.45, 9);
      let pitch = 1.0 * noise(t * 0.23, 7);
      roll += S.talk * 0.012 * Math.sin(t * 1.3 + 0.5 * Math.sin(t * 0.7));
      yaw += S.talk * 1.3 * noise(t * 0.8, 12);
      pitch += S.talk * (1.6 * S.open + 0.5 * noise(t * 1.1, 2));
      roll += S.listen * 0.045 * S.listenSide; pitch -= S.listen * 1.6; yaw += S.listen * 1.5 * S.listenSide;
      pitch += S.think * 2.4; roll += S.think * 0.02;
      roll += S.happy * 0.022 * Math.sin(t * 2.1);
      for (const g of S.gestures) {
        const u = (t - g.t0) / g.dur; if (u < 0 || u > 1) continue;
        // two dips, the second smaller (a natural "yes, welcome" nod)
        const nod = u < 0.5 ? Math.sin(Math.PI * u / 0.5) : 0.55 * Math.sin(Math.PI * (u - 0.5) / 0.5);
        pitch += 5.2 * g.amp * nod; roll += 0.01 * g.amp * nod;
      }
      S.gestures = S.gestures.filter((g) => t - g.t0 < g.dur);
      S.roll = roll; S.yaw = yaw; S.pitch = pitch;
      const breath = (1 - Math.cos((2 * Math.PI * t) / (speaking ? 3.6 : 4.4))) / 2;
      S.breath = 2.1 * breath;
      S.sway = 0.0045 * noise(t * 0.12, 5) + 0.0015 * S.talk * Math.sin(t * 0.9);

      // hair: springs pulled by the head's sideways velocity, plus a soft draft from the candles
      const headX = yaw + roll * 150;
      S.headXv = approach(S.headXv, (headX - S.headX) / Math.max(dt, 1e-3), 10, dt); S.headX = headX;
      spring(S.hair, clamp(-0.09 * S.headXv, -4, 4) + 0.55 * noise(t * 0.45, 21), 38, 5.5, dt);
      spring(S.hairY, -0.05 * S.breath, 30, 6, dt);
      spring(S.fringe, clamp(-0.05 * S.headXv, -2, 2) + 0.3 * noise(t * 0.6, 31), 55, 7, dt);

      // brows: lift when listening, on emphasis while speaking
      if (speaking && inp.open > 0.8 && S.lastOpen <= 0.8 && R() < 0.12) S.browKick = Math.max(S.browKick, 0.7);
      S.lastOpen = inp.open || 0;
      S.browKick = approach(S.browKick, 0, 1.6, dt);
      S.brow = approach(S.brow, Math.max(S.listen * 1.0, S.browKick) * 1.7 + S.happy * 0.5, 10, dt);
      S.jaw = approach(S.jaw, 2.2 * S.open, 30, dt);

      // gaze: small saccades; up toward the comment while listening, down to the ball when thinking
      if (t >= S.gaze.next) {
        const far = R() < 0.25;
        S.gaze.tx = (R() * 2 - 1) * (far ? 1.6 : 0.8); S.gaze.ty = (R() * 2 - 1) * 0.45;
        S.gaze.next = t + (speaking ? 0.8 + R() * 1.8 : 1.0 + R() * 3.2);
        if (R() < 0.45) { S.gaze.tx = 0; S.gaze.ty = 0; }              // back to the camera (the viewer) often
      }
      const gtx = S.gaze.tx * (1 - S.listen) + S.listen * 0.9 * S.listenSide, gty = S.gaze.ty * (1 - S.listen - S.think) - S.listen * 0.9 + S.think * 1.2;
      S.gaze.x = approach(S.gaze.x, gtx, 30, dt); S.gaze.y = approach(S.gaze.y, gty, 30, dt);

      // blinking: every 2-6 s, sometimes double; also on big gaze changes
      const b = S.blink;
      if (b.start < 0 && t >= b.next && S.happy < 0.5) { b.start = t; b.dbl = R() < 0.18; }
      S.eye = 'open';
      if (b.start >= 0) {
        let u = t - b.start, k = 0; const seq = b.dbl ? BLINK.concat([['lid2', 0.05]], BLINK.slice(1)) : BLINK;
        for (; k < seq.length && u > seq[k][1]; k++) u -= seq[k][1];
        if (k >= seq.length) { b.start = -1; b.next = t + 2.0 + R() * 4.2; } else S.eye = seq[k][0];
      }
      if (S.happy > 0.5) S.eye = S.happy > 0.8 ? 'happy' : 'lid1';
      else if (S.happy > 0.15 && S.eye === 'open') S.eye = 'lid1';

      // mouth shape
      let shape = speaking ? inp.shape || null : null;
      if (shape === 'rest') shape = null;
      if (!speaking) {
        if (t > S.idleSmileNext && S.idleSmileUntil < t) { S.idleSmileUntil = t + 2 + R() * 3; S.idleSmileNext = t + 9 + R() * 12; }
        if (S.happy > 0.4 || S.idleSmileUntil > t) shape = 'smile';
      } else if (S.happy > 0.5 && (shape === 'E' || shape === 'small' || shape === 'A')) shape = 'happy';
      const M = S.mouth;
      if (shape !== M.cur) { M.prev = M.f > 0.5 ? M.cur : M.prev; M.cur = shape; M.f = 0; }
      M.f = Math.min(1, M.f + dt / (speaking ? 0.045 : 0.16));
    }

    function drawFace() {
      fc.globalCompositeOperation = 'source-over'; fc.globalAlpha = 1;
      fc.drawImage(imgs.orig, fx0, fy0, face.width, face.height, 0, 0, face.width, face.height);
      for (const k of ['L', 'R']) {
        const e = rig.eyes[k], [bx0, by0, bx1, by1] = e.box, ox = bx0 - fx0, oy = by0 - fy0;
        if (S.eye === 'open') {
          const gx = S.gaze.x, gy = S.gaze.y;
          if (Math.abs(gx) > 0.05 || Math.abs(gy) > 0.05) {
            tmp.width = bx1 - bx0; tmp.height = by1 - by0;
            tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, tmp.width, tmp.height);
            tc.drawImage(imgs[`eye${k}-inner`], gx, gy);
            tc.globalCompositeOperation = 'destination-in'; tc.drawImage(imgs[`eye${k}-mask`], 0, 0);
            fc.drawImage(imgs[`eye${k}-white`], ox, oy); fc.drawImage(tmp, ox, oy); fc.drawImage(imgs[`eye${k}-band`], ox, oy);
          }
        } else fc.drawImage(imgs[`eye${k}-${S.eye}`], ox, oy);
      }
      // blush when happy
      if (S.happy > 0.02) {
        for (const [x, y] of [[437, 548], [522, 548]]) {
          const g = fc.createRadialGradient(x - fx0, y - fy0, 0, x - fx0, y - fy0, 13);
          g.addColorStop(0, `rgba(255,120,130,${0.2 * S.happy})`); g.addColorStop(1, 'rgba(255,120,130,0)');
          fc.fillStyle = g; fc.fillRect(x - fx0 - 14, y - fy0 - 14, 28, 28);
        }
      }
      const M = S.mouth, [mx0, my0] = rig.mouth.box;
      if (M.prev && M.f < 1) { fc.globalAlpha = 1; fc.drawImage(imgs['mouth-' + M.prev], mx0 - fx0, my0 - fy0); }
      if (M.cur) { fc.globalAlpha = M.prev || M.f < 1 ? ease(M.f) : 1; fc.drawImage(imgs['mouth-' + M.cur], mx0 - fx0, my0 - fy0); }
      else if (M.prev && M.f < 1) { fc.globalAlpha = ease(M.f); fc.drawImage(imgs.orig, mx0, my0, rig.mouth.box[2] - mx0, rig.mouth.box[3] - my0, mx0 - fx0, my0 - fy0, rig.mouth.box[2] - mx0, rig.mouth.box[3] - my0); }
      fc.globalAlpha = 1;
    }

    function render() {
      if (api.lost || !gl || gl.isContextLost()) return;
      drawFace();
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, patchTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face);
      gl.uniform1f(U.uRoll, S.roll); gl.uniform1f(U.uSway, S.sway); gl.uniform1f(U.uBreath, S.breath);
      gl.uniform1f(U.uYaw, S.yaw); gl.uniform1f(U.uPitch, S.pitch); gl.uniform1f(U.uJaw, S.jaw); gl.uniform1f(U.uBrow, S.brow);
      gl.uniform1f(U.uFringe, S.fringe.x); gl.uniform2f(U.uHeadT, 0, 0); gl.uniform2f(U.uHair, S.hair.x, S.hairY.x);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    const api = {
      canvas, rig, state: S, gesture,
      /** Backing size: never more pixels than her painting has (941x1672); the browser scales the canvas up for free.
       *  (It used to be CSS size x devicePixelRatio: about 2100x3700 in a 1080x1920 LIVE Studio source at 150% Windows scaling,
       *  ~8 million shaded pixels with 9 texture reads each, 60+ times a second.) opts.scale < 1 makes it lighter still. */
      resize(w, h) {
        // pixels actually shown: CSS size after the stage's scale transform (on a phone the 1080-wide stage is ~0.36x)
        // x min(devicePixelRatio, 2), but never more than her painting has
        const d = Math.min(2, opts.dpr || window.devicePixelRatio || 1);
        const shown = (canvas.isConnected && canvas.getBoundingClientRect().width) || w, sc = shown / Math.max(1, w);
        const k = Math.min(1, (rig.width * (opts.scale || 1)) / Math.max(1, w * sc * d));
        canvas.width = Math.max(2, Math.round(w * sc * d * k)); canvas.height = Math.max(2, Math.round(h * sc * d * k));
      },
      /** nowMs: page clock; inp: { speaking, shape: 'rest'|'small'|'E'|'A'|'O'|'U', open: 0..1, mood: 'neutral'|'happy'|'prophecy' } */
      frame(nowMs, inp = {}) {
        const dt = S.last == null ? 1 / 60 : clamp((nowMs - S.last) / 1000, 0, 0.1); S.last = nowMs;
        update(dt, inp);
        if (api.override) { const o = api.override; for (const k in o) { if (k === 'hairX') S.hair.x = o[k]; else if (k === 'fringeX') S.fringe.x = o[k]; else S[k] = o[k]; } }  // testing / tuning
        render();
      },
      get mouthOpen() { return S.open; },
      /** Frees the GPU memory right away (instead of waiting for garbage collection) and removes the canvas. */
      destroy() { api.dead = true; try { const x = gl && gl.getExtension('WEBGL_lose_context'); x && x.loseContext(); } catch {} canvas.remove(); },
      lost: false,
    };
    // Context loss: keep the page alive (preventDefault lets the browser restore it), rebuild everything on restore.
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (api.dead) return; api.lost = true; opts.onLost && opts.onLost(); }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      if (api.dead) return;
      try { setupGL(); api.lost = false; opts.onRestored && opts.onRestored(); }
      catch (e) { opts.onRestoreFailed && opts.onRestoreFailed(e); }
    }, false);
    container.appendChild(canvas);
    return api;
  }

  root.MiraRig = { create };
})(typeof window !== 'undefined' ? window : globalThis);
