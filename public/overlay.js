(() => {
  const SharedAudio = { el: new Audio(), unlocked: false }; SharedAudio.el.setAttribute('playsinline', ''); SharedAudio.el.preload = 'auto';
  const qs = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const root = $('root');
  // ?render=1: the page runs on a virtual clock driven by window.__render (frame-accurate demo / measurements).
  const renderMode = qs.get('render') === '1';
  const VT = { now: 0, timers: [], id: 0, pending: [] };
  const setTimeout = renderMode ? (fn, ms = 0) => { const id = ++VT.id; VT.timers.push({ id, at: VT.now + Math.max(0, ms || 0), fn }); return id; } : window.setTimeout.bind(window);
  const clearTimeout = renderMode ? (id) => { VT.timers = VT.timers.filter((t) => t.id !== id); } : window.clearTimeout.bind(window);
  const performance = renderMode ? { now: () => VT.now } : window.performance;
  const LS = (k, v) => (v === undefined ? localStorage.getItem('fl_' + k) : localStorage.setItem('fl_' + k, v));
  const prefs = {
    layout: qs.get('layout') || LS('layout') || 'vertical', // 9:16 by default
    audio: qs.has('audio') ? qs.get('audio') !== '0' : LS('audio') !== '0',
    chime: qs.has('chime') ? qs.get('chime') !== '0' : LS('chime') !== '0',
    queue: LS('queue') !== null ? LS('queue') === '1' : null,
  };
  // ------------------------------------------------------------ lite mode (weak GPUs, phones, after a GPU reset)
  // ?lite=1 forces it, ?lite=0 turns it off. Auto: phones / tablets, devices reporting <= 4 GB memory, or a WebGL
  // context loss in the last 24 h on this browser. Lite = lower-resolution rig, 24 fps, 1024 px textures, no sparkles,
  // no smoke and a plain (unblurred) background.
  const lite = (() => {
    if (qs.has('lite')) return qs.get('lite') !== '0';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    const lowMem = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
    const lostAt = Number(LS('glLostAt') || 0), recentLoss = lostAt && Date.now() - lostAt < 24 * 3600e3;
    return !!(mobile || lowMem || recentLoss);
  })();
  const FPS = Number(qs.get('fps')) || (lite ? 24 : 30);   // the rig and effects never draw faster than this
  let cfg = { overlay: { character: {} }, trigger: { giftName: 'Rose', minDiamonds: 1 }, tiers: [], voice: {} };
  const events = (window.__events = []);
  const logEv = (e, extra = {}) => { events.push({ t: Math.round(performance.now()), e, ...extra }); if (events.length > 600) events.splice(0, events.length - 400); };  // capped (it grew forever)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ layout & scaling
  function applyLayout() {
    root.className = prefs.layout === 'landscape' ? 'landscape' : 'vertical';
    // vertical: 1080 wide, at least 1920 tall (9:16). On taller screens (iPhone ~19.5:9) the canvas grows taller instead of
    // letterboxing, and every box is placed by the TikTok safe zones (fractions of --H), so nothing hides under TikTok's own UI.
    const vert = prefs.layout !== 'landscape';
    const W = vert ? 1080 : 1920;
    const H = vert ? Math.round(Math.min(2400, Math.max(1920, (1080 * innerHeight) / Math.max(1, innerWidth)))) : 1080;
    root.style.height = H + 'px'; root.style.setProperty('--H', H + 'px');
    const s = Math.min(innerWidth / W, innerHeight / H);
    root.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
    layoutChar();
  }
  addEventListener('resize', applyLayout);

  // ------------------------------------------------------------ character
  // Two modes:
  //  * video (default): the generated idle clip loops underneath; the lip-sync mouth patch and the prophecy effects
  //    follow a precomputed per-frame track of her face / the skull / the camera, read from the frame on screen.
  //  * still (fallback): one picture with code-driven breathing, room effects and the same audio-driven mouth.
  // Everything is positioned in % of the picture / video frame inside #charBox, so it lines up at any size.
  const still = $('still'), bodyImg = $('bodyImg'), body = $('body'), mouthEl = $('mouth'), mouthWrap = $('mouthWrap'), proph = $('prophecy'), flash = $('flash');
  const vid = $('baseVid'), pTrack = $('pTrack'), sceneTrack = $('sceneTrack');
  const charBox = $('charBox'), scene = $('scene'), sc = scene.getContext('2d'), mist = $('mist'), mx = mist.getContext('2d');
  const DEFAULT_CHAR = {
    mode: 'rig',
    rig: { base: '/assets/rig/', image: '/assets/mira2.jpg' },
    video: { src: '/assets/mira2-idle-loop-1080.mp4', src720: '/assets/mira2-idle-loop-720.mp4', quality: 'auto', track: '/assets/mira2-idle-loop.track.json', poster: '/assets/mira2v-poster.jpg',
      mouthImages: ['/assets/mira2v-mouth-o.png', '/assets/mira2v-mouth-e.png', '/assets/mira2v-mouth-a.png'],
      closedImage: '/assets/mira2v-mouth-x.png', toneMatch: true },
    still: '/assets/mira2.jpg', width: 941, height: 1672,
    breathing: { enabled: true, amount: 0.0045, seconds: 4.6 },
    mouth: { enabled: true, x: 46.2274, y: 32.7153, w: 8.5016, h: 4.067, leadMs: 30, fadeMs: 45,
      images: ['/assets/mira2-mouth-o.png', '/assets/mira2-mouth-e.png', '/assets/mira2-mouth-a.png'] },
    ball: { x: 49.9, y: 63.6, r: 11.4 },
    candles: [{ x: 13.3, y: 33.8 }, { x: 83.2, y: 37.4 }, { x: 73.3, y: 42.3 }, { x: 4.25, y: 47.1 }, { x: 97.6, y: 52.8 }, { x: 91.4, y: 59.9 }],
    lanterns: [{ x: 10.3, y: 10.4 }, { x: 88.2, y: 11.2 }],
    incense: [{ x: 85.5, y: 57.2 }],
    prophecy: { enabled: true, eyes: [{ x: 15.8, y: 55.4 }, { x: 20.3, y: 55.0 }], eyeSize: 3.6, skull: { x: 14.8, y: 55.6 } },
  };
  const ID = [1, 0, 0, 0, 1, 0];
  /** Rig mode: the live puppet (null in video / still mode). */
  const Rig = { api: null, gesture(kind, o) { if (this.api) this.api.gesture(kind, o); } };
  /** Video mode state: the track and the loop frame currently on screen. */
  const Vid = { on: false, track: null, idx: 0, frames: 1, lastMedia: -1, rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    A(kind) { const t = this.track; return t ? t[kind][this.idx] || ID : ID; } };
  const Char = {
    mode: 'loading', inited: false, kind: 'still',
    get c() {
      const u = cfg.overlay.character || {}, d = DEFAULT_CHAR, pick = (k) => ({ ...d[k], ...(u[k] && typeof u[k] === 'object' ? u[k] : {}) });
      return { ...d, ...u, rig: pick('rig'), video: pick('video'), breathing: pick('breathing'), mouth: pick('mouth'), ball: pick('ball'), prophecy: pick('prophecy'),
        candles: u.candles || d.candles, lanterns: u.lanterns || d.lanterns, incense: u.incense || d.incense };
    },
    init() {
      if (this.inited) return; this.inited = true;
      const c = this.c, want = qs.get('mode') || c.mode;
      if (want === 'rig') this.initRig().catch((e) => { logEv('rig-failed', { err: String(e && e.message || e) }); console.warn('rig failed', e); this.initStill(); });
      else if (want === 'video' && c.video.src) this.initVideo().catch((e) => { logEv('video-failed', { err: String(e && e.message || e) }); this.initStill(); });
      else this.initStill();
    },
    /** Picks the 720p file when the overlay is drawn small (landscape, small browser sources). */
    videoSrc() {
      const v = this.c.video, q = qs.get('quality') || (lite ? '720' : v.quality);   // lite: never the 1080p file
      if (q === '720' && v.src720) return v.src720;
      if (q === '1080' || !v.src720) return v.src;
      const px = $('stage').getBoundingClientRect().width * (window.devicePixelRatio || 1);
      return px < 820 ? v.src720 : v.src;
    },
    async initVideo() {
      const v = this.c.video;
      this.kind = 'video'; root.classList.add('videoMode');
      const res = await fetch(v.track); if (!res.ok) throw new Error('track HTTP ' + res.status);
      const tr = await res.json();
      // convert flat [a00,a01,a02,a10,a11,a12] rows to CSS order once
      for (const k of ['mouth', 'skull', 'scene']) tr[k] = tr[k].map((m) => [m[0], m[3], m[1], m[4], m[2], m[5]]);
      Vid.track = tr; Vid.frames = tr.frames;
      this.aspect = tr.width / tr.height;
      still.src = v.poster || ''; $('bgBlur').style.backgroundImage = `url("${v.poster}")`;
      vid.poster = v.poster || '';
      layoutChar(); this.build();
      vid.src = this.videoSrc(); logEv('video-src', { src: vid.src.replace(location.origin, '') });
      await new Promise((ok, bad) => { vid.addEventListener('loadeddata', ok, { once: true }); vid.addEventListener('error', () => bad(new Error('video error')), { once: true }); setTimeout(() => bad(new Error('video timeout')), 15000); });
      if (!renderMode) { vid.loop = true; await vid.play().catch(() => {}); }
      vid.addEventListener('error', () => { logEv('video-error'); });
      if (Vid.rvfc) { const onFrame = (now, meta) => { setVideoFrame(meta.mediaTime); vid.requestVideoFrameCallback(onFrame); }; vid.requestVideoFrameCallback(onFrame); }
      Vid.on = true; this.mouthOk = this.c.mouth.enabled !== false; mouthEl.hidden = !this.mouthOk;
      vid.classList.add('on');
      this.mode = 'idle'; logEv('idle-on', { from: 'loading', kind: 'video' });
    },
    /** Rig mode (default): her painting as a real-time 2D puppet (public/rig.js). Effects use the still's coordinates. */
    async initRig() {
      const r = this.c.rig;
      if (!window.MiraRig) throw new Error('rig.js not loaded');
      this.kind = 'rig'; Vid.on = false;
      still.src = r.image; bodyImg.removeAttribute('src'); $('bgBlur').style.backgroundImage = `url("${r.image}")`;
      this.aspect = DEFAULT_CHAR.width / DEFAULT_CHAR.height;
      vid.pause(); vid.removeAttribute('src');   // no background video under the rig
      Rig.api = await MiraRig.create(charBox, { base: r.base, image: r.image, preserve: renderMode, seed: 11,
        // lite stays sharp: full painting resolution (941x1672, 1.6 MP) and full-size textures; it saves memory elsewhere
        scale: 1, maxTex: 2048, lean: lite,
        // GPU reset: show her still picture at once (never a black box), wait for the browser to restore the context,
        // rebuild the rig; if it doesn't come back in 4 s, stay on the still picture and remember to use lite mode.
        onLost: () => {
          logEv('rig-lost'); Rig.lost = (Rig.lost || 0) + 1; LS('glLostAt', String(Date.now()));
          root.classList.remove('rigMode'); Rig.paused = true;
          clearTimeout(Rig.lostTimer); Rig.lostTimer = setTimeout(() => this.rigFallback('not restored'), 4000);
        },
        onRestored: () => {
          clearTimeout(Rig.lostTimer); logEv('rig-restored');
          if (Rig.lost >= 3) return this.rigFallback('lost 3 times');
          Rig.paused = false; root.classList.add('rigMode'); layoutChar();
        },
        onRestoreFailed: (e) => this.rigFallback(String(e && e.message || e)) });
      charBox.insertBefore(Rig.api.canvas, $('warm'));
      root.classList.add('rigMode');
      layoutChar(); this.build();
      this.mouthOk = false; mouthEl.hidden = true;
      this.mode = 'idle'; logEv('idle-on', { from: 'loading', kind: 'rig' });
    },
    /** Give up on WebGL for this page: free the GPU, keep her still picture (with breathing and the audio-driven mouth). */
    rigFallback(why) {
      clearTimeout(Rig.lostTimer); logEv('rig-fallback', { why });
      if (Rig.api) { Rig.api.destroy(); Rig.api = null; }
      Rig.paused = false; root.classList.remove('rigMode'); this.initStill();
    },
    initStill() {
      const c = this.c; this.kind = 'still'; Vid.on = false; root.classList.remove('videoMode'); vid.removeAttribute('src'); vid.classList.remove('on');
      const stills = [...new Set([c.still, DEFAULT_CHAR.still].filter(Boolean))]; let i = 0;
      const nextStill = () => {
        if (i >= stills.length) { $('fallback').hidden = false; charBox.hidden = true; this.mode = 'idle'; return; }
        const url = stills[i++]; const probe = new Image();
        probe.onload = () => {
          still.src = url; bodyImg.src = url; $('bgBlur').style.backgroundImage = `url("${url}")`;
          this.aspect = probe.naturalWidth / probe.naturalHeight; layoutChar(); this.build();
          // mouth patches only fit the picture they were cut from
          const mouthOk = c.mouth.enabled !== false && (url === DEFAULT_CHAR.still || c.mouth.images !== DEFAULT_CHAR.mouth.images);
          mouthEl.hidden = !mouthOk; this.mouthOk = mouthOk;
          this.mode = 'idle'; logEv('idle-on', { from: 'loading', kind: 'still' });
        };
        probe.onerror = nextStill; probe.src = url;
      };
      nextStill();
    },
    build() {
      const c = this.c, m = c.mouth, video = this.kind === 'video' && Vid.track;
      const T = video ? Vid.track : null, pct = (x, y) => (T ? { x: (x / T.width) * 100, y: (y / T.height) * 100 } : { x, y });
      const r = T ? { x: (T.mouthRect.x / T.width) * 100, y: (T.mouthRect.y / T.height) * 100, w: (T.mouthRect.w / T.width) * 100, h: (T.mouthRect.h / T.height) * 100 } : m;
      Object.assign(mouthEl.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', transform: '' });
      const imgs = video ? c.video.mouthImages : m.images;
      mouthEl.querySelectorAll('img[data-v]').forEach((im, k) => { if (imgs[k] && im.getAttribute('src') !== imgs[k]) im.src = imgs[k]; });
      // video mode: frame 1's own closed lips are held under the shapes while she speaks, so the lips keep one shape for the whole sentence
      const cl = video ? (c.video.closedImage ?? DEFAULT_CHAR.video.closedImage) : null;
      if (cl) { if (mouthBase.getAttribute('src') !== cl) mouthBase.src = cl; } else { mouthBase.removeAttribute('src'); mouthBase.style.opacity = 0; Mouth.base = 0; }
      // room lights: in video mode the clip animates candles, lanterns and smoke itself; only the crystal ball gets an extra glow
      const L = $('lights'); L.innerHTML = ''; sceneTrack.innerHTML = ''; this.glows = [];
      const add = (cls, p, size, seed, parent = L) => { const d = document.createElement('div'); d.className = 'glow ' + cls; d.style.left = p.x + '%'; d.style.top = p.y + '%'; d.style.width = size + '%'; parent.appendChild(d); this.glows.push({ el: d, cls, seed }); };
      if (video) { if (cfg.overlay.effects?.ballGlow !== false) add('ball', pct(T.points.ball[0], T.points.ball[1]), ((T.points.ballR * 2.7) / T.width) * 100, 0, sceneTrack); }
      else {
        if (cfg.overlay.effects?.ballGlow !== false) add('ball', c.ball, c.ball.r * 2.7, 0);
        c.lanterns.forEach((p, k) => add('lantern', p, 17, 10 + k * 7.3));
        c.candles.forEach((p, k) => add('candle', p, 7.5, 3 + k * 4.1));
      }
      const P = c.prophecy, fx = $('pFx'); fx.innerHTML = '';
      const eyes = video ? T.points.eyes.map(([x, y]) => pct(x, y)) : P.eyes || [];
      this.eyes = eyes;
      eyes.forEach((e, k) => { const d = document.createElement('div'); d.className = 'eyeGlow ' + (k ? 'r' : 'l'); d.style.left = e.x + '%'; d.style.top = e.y + '%'; d.style.width = (P.eyeSize ?? 3.6) + '%'; fx.appendChild(d); });
      const sk = video ? pct(T.points.skull[0], T.points.skull[1]) : P.skull || P.eyes?.[0] || { x: 15, y: 55 };
      this.skull = sk;
      Object.assign($('skullAura').style, { left: sk.x + '%', top: sk.y + '%' });
      $('vignette').style.setProperty('--sx', sk.x + '%'); $('vignette').style.setProperty('--sy', sk.y + '%');
      if (Vid.on) applyTrack();
    },
    /** She is speaking (mouth follows the voice). */
    talk() { if (this.mode !== 'prophecy') { const prev = this.mode; this.mode = 'talk'; if (prev !== 'talk') logEv('talk-on', { from: prev }); } },
    idle() {
      const prev = this.mode; if (prev === 'idle' || prev === 'loading') return;
      this.mode = 'idle';
      if (prev === 'prophecy') { flashAt(); proph.classList.remove('on'); setTimeout(stopMist, 700); }
      logEv('idle-on', { from: prev });
    },
    /** Prophecy: purple flash, the room dims, the skull's eye sockets glow, mist rises, the crystal ball blazes. */
    prophecy() {
      if (this.c.prophecy.enabled === false) return this.talk();
      this.mode = 'prophecy'; flashAt();
      setTimeout(() => { proph.classList.add('on'); startMist(); }, 220);
      logEv('prophecy-on');
    },
    stop() { if (this.mode === 'prophecy' || this.mode === 'talk') this.idle(); },
  };

  /** The frame on screen changed (from requestVideoFrameCallback, or currentTime as a fallback): move tracked layers. */
  function setVideoFrame(mediaTime) {
    if (!Vid.track) return;
    const idx = ((Math.round(mediaTime * Vid.track.fps) % Vid.frames) + Vid.frames) % Vid.frames;
    if (idx === Vid.idx && mediaTime === Vid.lastMedia) return;
    Vid.idx = idx; Vid.lastMedia = mediaTime; applyTrack();
  }
  const cssM = (A, u) => `matrix(${A[0]},${A[1]},${A[2]},${A[3]},${(A[4] * u).toFixed(3)},${(A[5] * u).toFixed(3)})`;
  function applyTrack() {
    const T = Vid.track; if (!T) return;
    const u = charBox.clientWidth / T.width;                       // css px per video px
    // mouth div sits at the frame-0 rectangle; transform about its own top-left corner: q -> A_lin q + (A r0 - r0)
    const A = Vid.A('mouth'), r = T.mouthRect;
    const ex = A[0] * r.x + A[2] * r.y + A[4] - r.x, ey = A[1] * r.x + A[3] * r.y + A[5] - r.y;
    mouthEl.style.transform = `matrix(${A[0]},${A[1]},${A[2]},${A[3]},${(ex * u).toFixed(3)},${(ey * u).toFixed(3)})`;
    if (Char.c.video.toneMatch !== false && T.gain) mouthEl.style.filter = `brightness(${T.gain[Vid.idx]})`;
    pTrack.style.transform = cssM(Vid.A('skull'), u);
    sceneTrack.style.transform = cssM(Vid.A('scene'), u);
  }
  const mapPt = (A, x, y) => [A[0] * x + A[2] * y + A[4], A[1] * x + A[3] * y + A[5]];

  function layoutChar() {
    const st = $('stage'), W = st.clientWidth, H = st.clientHeight, a = Char.aspect || DEFAULT_CHAR.width / DEFAULT_CHAR.height;
    let w = W, h = W / a; if (h < H) { h = H; w = H * a; }
    Object.assign(charBox.style, { width: w + 'px', height: h + 'px', left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px' });
    // effect canvases: no bigger than her painting (they were the full 1404x2495 box, redrawn every frame)
    const ek = Math.min(1, (DEFAULT_CHAR.width * (lite ? 0.6 : 1)) / Math.max(1, w));   // soft glows only: 60% is invisible here
    for (const c of [scene, mist]) { const cw = Math.round(w * ek), ch = Math.round(h * ek); if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; } }
    if (Rig.api) Rig.api.resize(w, h);
    // sparkles are off in lite mode: keep that full-stage canvas at 1x1 instead of ~1080x2340 (10 MB on an iPhone)
    const sw = lite ? 1 : W, sh = lite ? 1 : H;
    if (sp.width !== sw || sp.height !== sh) { sp.width = sw; sp.height = sh; }
    if (Vid.on) applyTrack();
  }

  function flashAt() {
    const e = Char.eyes && Char.eyes.length ? Char.eyes : [{ x: 18, y: 55 }];
    flash.style.setProperty('--fx', (e.reduce((a, b) => a + b.x, 0) / e.length) + '%');
    flash.style.setProperty('--fy', (e.reduce((a, b) => a + b.y, 0) / e.length) + '%');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  }

  // ------------------------------------------------------------ mouth (lip-sync patches)
  const mouthImgs = [...mouthEl.querySelectorAll('img[data-v]')], mouthBase = $('mouthBase');
  const Mouth = {
    op: [1, 0, 0, 0], target: 0, z: 1, base: 0,
    set(v) { if (!Char.mouthOk) v = 0; if (v !== this.target) { this.target = v; if (v > 0) mouthImgs[v - 1].style.zIndex = ++this.z; } },
    step(dt, speaking) {
      const f = Math.min(1, dt / Math.max(1, Char.c.mouth.fadeMs ?? 45)), t = this.target;
      for (let i = 1; i <= 3; i++) {
        const want = i === t ? 1 : (t === 0 || this.op[t] >= 0.999 ? 0 : this.op[i]);
        const o = this.op[i]; this.op[i] = want > o ? Math.min(want, o + f) : Math.max(want, o - f);
        if (o !== this.op[i]) mouthImgs[i - 1].style.opacity = this.op[i].toFixed(3);
      }
      // closed-lips base (video mode): in while speaking, out ~160 ms after the voice ends, once the mouth has closed
      const bw = Vid.on && Char.mouthOk && mouthBase.getAttribute('src') && (speaking || t > 0 || this.op.slice(1).some((o) => o > 0.01)) ? 1 : 0, b = this.base;
      this.base = bw > b ? Math.min(1, b + dt / 120) : Math.max(0, b - dt / 160);
      if (b !== this.base) mouthBase.style.opacity = this.base.toFixed(3);
    },
    get open() { return Math.max(...this.op.slice(1).map((o, i) => o * LipSync.OPEN[i + 1])); },
  };
  /** Lip-sync state: a viseme track and a clock (seconds into the speech audio, or null when not speaking). */
  const Lip = { track: null, clock: null, source: 'none' };
  let decoder = null;
  /** The speech blob URL currently on the shared <audio>; revoked as soon as another one replaces it (they used to pile up). */
  function setAudioSrc(el, src) {
    if (SharedAudio.blob && SharedAudio.blob !== src) { try { URL.revokeObjectURL(SharedAudio.blob); } catch {} SharedAudio.blob = null; }
    el.src = src; if (src.startsWith('blob:')) SharedAudio.blob = src;
  }
  async function loadTrack(url) {
    const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status);
    const bytes = await res.arrayBuffer();
    // one decoder for the whole session (no new audio context per line)
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decoder = decoder || new OAC(1, 1, 24000);
    const buf = await decoder.decodeAudioData(bytes.slice(0));
    const track = LipSync.analyze(buf.getChannelData(0), buf.sampleRate);
    return { track, bytes };
  }

  // ------------------------------------------------------------ the animation frame (also callable with a virtual clock)
  const sp = $('sparkles'), spx = sp.getContext('2d');
  let parts = [], smoke = [], mistParts = [], mistOn = false, boost = 0, lastNow = 0;
  function startMist() { mistOn = true; }
  function stopMist() { mistOn = false; }
  const noise = (t, s) => (Math.sin(t * 1.7 + s) + Math.sin(t * 2.9 + s * 1.3) * 0.6 + Math.sin(t * 6.1 + s * 0.7) * 0.35 + Math.sin(t * 13.3 + s * 2.1) * 0.2) / 2.15;

  function frame(now) {
    const dt = Math.min(100, Math.max(0, now - (lastNow || now))); lastNow = now;
    const k = dt / 16.67, t = now / 1000, c = Char.c, W = scene.width, H = scene.height, proOn = Char.mode === 'prophecy', video = Vid.on;
    if (video && !Vid.rvfc && !renderMode) setVideoFrame(vid.currentTime);
    // lips: the mouth shape comes from the voice audio at the current playback time
    const lt = Lip.clock ? Lip.clock() : null;
    Mouth.set(lt == null ? 0 : LipSync.at(Lip.track, lt + (c.mouth.leadMs ?? 30) / 1000));
    Mouth.step(dt, lt != null);
    if (Rig.api && !Rig.paused) {
      const sh = lt == null ? null : LipSync.shapeAt(Lip.track, lt + (c.mouth.leadMs ?? 30) / 1000);
      Rig.api.frame(now, { speaking: lt != null, shape: sh ? sh.shape : 'rest', open: sh ? sh.open : 0, mood: Char.mode === 'prophecy' ? 'prophecy' : 'neutral' });
      if (window.__rigLog) window.__rigLog.push({ t: lt, shape: sh && sh.shape, eye: Rig.api.state.eye });
    }
    // breathing (still mode only; the video breathes by itself): her body copy and the mouth move together
    if (!video && !Rig.api && c.breathing.enabled !== false) {
      const b = (1 - Math.cos((2 * Math.PI * t) / (c.breathing.seconds || 4.6))) / 2, a = c.breathing.amount ?? 0.0045;
      const tf = `translateY(${(-a * 0.25 * b * 100).toFixed(4)}%) scale(${(1 + a * 0.35 * b).toFixed(5)}, ${(1 + a * b).toFixed(5)})`;
      body.style.transform = tf; mouthWrap.style.transform = tf;
    }
    // candles, lanterns, crystal ball
    const open = Rig.api ? Rig.api.mouthOpen : Mouth.open, ballLvl = proOn ? 1.9 : 1 + open * 0.35;
    for (const g of Char.glows || []) {
      if (g.cls === 'ball') {
        const base = video ? (proOn ? 0.75 : 0.12 + 0.35 * open) : (0.42 + 0.12 * Math.sin(t * 1.3)) * ballLvl;
        g.el.style.opacity = Math.min(1, base).toFixed(3); g.el.style.transform = `translate(-50%,-50%) scale(${(1 + 0.04 * Math.sin(t * 0.9) + (proOn ? 0.12 : 0)).toFixed(3)})`; continue;
      }
      const n = noise(t * (g.cls === 'candle' ? 2.2 : 0.9), g.seed);
      g.el.style.opacity = (g.cls === 'candle' ? 0.62 + 0.3 * n : 0.5 + 0.18 * n).toFixed(3);
      g.el.style.transform = `translate(-50%,-50%) scale(${(1 + (g.cls === 'candle' ? 0.1 : 0.05) * n).toFixed(3)})`;
    }
    if (!video) $('warm').style.opacity = (0.2 + 0.07 * noise(t * 1.6, 1.1)).toFixed(3);

    sc.clearRect(0, 0, W, H);
    if (!video) {
      // crystal-ball swirl: glowing blobs orbiting inside the ball, clipped to the glass
      if (cfg.overlay.effects?.ballGlow !== false) {
        const bx = (c.ball.x / 100) * W, by = (c.ball.y / 100) * H, R = (c.ball.r / 100) * W;
        sc.save(); sc.beginPath(); sc.arc(bx, by, R * 0.93, 0, Math.PI * 2); sc.clip(); sc.globalCompositeOperation = 'lighter';
        for (let j = 0; j < 5; j++) {
          const ang = t * (0.5 + j * 0.13) * (j % 2 ? -1 : 1) + j * 1.26, rr = R * (0.28 + 0.12 * Math.sin(t * 0.7 + j));
          const x = bx + Math.cos(ang) * rr, y = by + Math.sin(ang) * rr * 0.8, r = R * (0.38 + 0.08 * Math.sin(t + j * 2));
          const g = sc.createRadialGradient(x, y, 0, x, y, r);
          const al = (0.13 + 0.05 * Math.sin(t * 2 + j)) * ballLvl;
          g.addColorStop(0, `rgba(235,200,255,${al})`); g.addColorStop(0.5, `rgba(170,90,255,${al * 0.5})`); g.addColorStop(1, 'rgba(120,40,255,0)');
          sc.fillStyle = g; sc.fillRect(x - r, y - r, r * 2, r * 2);
        }
        sc.restore();
      }
      // incense smoke
      if (!lite) for (const p of c.incense || []) if (Math.random() < 0.22 * k) smoke.push({ x: (p.x / 100) * W, y: (p.y / 100) * H, vx: (Math.random() - 0.5) * 0.1, vy: -(0.32 + Math.random() * 0.22), r: W * 0.006, life: 1, sw: Math.random() * 6.28 });
      smoke = smoke.filter((p) => p.life > 0);
      for (const p of smoke) {
        p.sw += 0.025 * k; p.x += (p.vx + Math.sin(p.sw) * 0.22) * k * (W / 941); p.y += p.vy * k * (W / 941); p.r *= 1 + 0.007 * k; p.life -= 0.0042 * k;
        const a = 0.075 * Math.min(1, p.life * 1.4) * Math.min(1, (1 - p.life) * 8);
        const g = sc.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g.addColorStop(0, `rgba(215,190,240,${a})`); g.addColorStop(1, 'rgba(160,120,220,0)');
        sc.fillStyle = g; sc.fillRect(p.x - p.r * 3, p.y - p.r * 3, p.r * 6, p.r * 6);
      }
    }
    // prophecy mist from the skull's eyes (follows the skull in video mode)
    const mistIdle = !mistOn && !mistParts.length;
    if (lite && mist.classList.contains('idle') !== mistIdle) mist.classList.toggle('idle', mistIdle);
    if (!mistIdle || !lite) mx.clearRect(0, 0, W, H);
    if (mistOn || mistParts.length) {
      const SA = video ? Vid.A('skull') : ID, sx = W / 100, sy = H / 100;
      if (mistOn) for (const e of Char.eyes || []) if (Math.random() < 0.5 * k) { const [ex, ey] = mapPt(SA, e.x * sx, e.y * sy); mistParts.push({ x: ex + (Math.random() - 0.5) * W * 0.012, y: ey, vx: (Math.random() - 0.5) * 0.5, vy: -(0.5 + Math.random() * 0.8), r: W * 0.007, life: 1, sw: Math.random() * 6.28 }); }
      mx.globalCompositeOperation = 'lighter';
      mistParts = mistParts.filter((p) => p.life > 0);
      for (const p of mistParts) {
        p.sw += 0.04 * k; p.x += (p.vx + Math.sin(p.sw) * 0.35) * k; p.y += p.vy * k; p.r *= 1 + 0.012 * k; p.life -= 0.011 * k;
        const g = mx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g.addColorStop(0, `rgba(205,130,255,${0.22 * p.life})`); g.addColorStop(1, 'rgba(140,60,255,0)');
        mx.fillStyle = g; mx.beginPath(); mx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); mx.fill();
      }
    }
    // sparkles over the whole stage
    const w = sp.width, h = sp.height;
    spx.clearRect(0, 0, w, h);
    if (cfg.overlay.effects?.sparkles !== false && !lite) {
      const want = cfg.overlay.effects?.sparkleCount ?? 28;
      while (parts.length < want) parts.push({ x: Math.random() * w, y: h * (0.1 + Math.random() * 0.85), vx: (Math.random() - 0.5) * 0.25, vy: -Math.random() * 0.35 - 0.08, r: Math.random() * 1.8 + 0.5, life: 1, decay: 0.0025 + Math.random() * 0.004, hue: Math.random() < 0.5 ? 45 : 285 });
      if (boost > 0) { boost--; parts.push({ x: w * (0.15 + Math.random() * 0.7), y: h * (0.5 + Math.random() * 0.4), vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 1.6 - 0.4, r: Math.random() * 2.4 + 1, life: 1, decay: 0.01, hue: 285 }); }
      spx.globalCompositeOperation = 'lighter';
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.x += p.vx * k; p.y += p.vy * k; p.life -= p.decay * k;
        const a = Math.max(0, p.life) * (0.35 + 0.25 * Math.sin(now / 240 + p.x));
        const g = spx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue},100%,85%,${a})`); g.addColorStop(1, `hsla(${p.hue},100%,70%,0)`);
        spx.fillStyle = g; spx.beginPath(); spx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); spx.fill();
      }
    }
    if (Lip.clock && window.__lipLog) window.__lipLog.push({ t: lt, v: Mouth.target, f: Vid.idx });
  }
  // Capped at FPS (30, or 24 in lite mode): screens and LIVE Studio often run rAF at 60-144 Hz, which only burns GPU time.
  let lastDraw = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (renderMode || document.hidden) return;
    now = performance.now();
    if (now - lastDraw < 1000 / FPS - 2) return;
    lastDraw = now; frame(now);
  }

  // ------------------------------------------------------------ audio / speech
  let curSpeech = null;
  function stopSpeech() { if (curSpeech) { curSpeech.stop(); curSpeech = null; } }
  /**
   * Plays server MP3 (preferred), else the browser voice, else silent timing.
   * The MP3 is fetched once: the bytes are decoded for the lip-sync track and played from a blob URL.
   * Returns { stop, elapsed(), duration, ended: Promise, how }
   */
  function playSpeech(s, delayMs) {
    stopSpeech();
    let audio = null, timer = null, stopped = false, startedAt = 0, endFn, lastCT = -1, lastCTAt = 0;
    const ended = new Promise((r) => (endFn = (why) => { if (curSpeech === ctl) { Lip.clock = null; } r(why); }));
    const ctl = { duration: s.duration || 3, how: 'text', ended,
      stop() { stopped = true; clearTimeout(timer); try { audio && audio.pause(); } catch {} try { speechSynthesis.cancel(); } catch {} endFn('stopped'); },
      elapsed() { if (audio && ctl.how === 'audio') return audio.currentTime; return startedAt ? (performance.now() - startedAt) / 1000 : 0; } };
    curSpeech = ctl;
    const textTrack = () => LipSync.fromText(s.text || '', ctl.duration);
    const trackP = s.url ? loadTrack(s.url).catch((e) => { logEv('lip-decode-failed', { err: String(e && e.message || e) }); return null; }) : Promise.resolve(null);
    // clock for the lips: audio time, smoothed between the browser's currentTime updates
    const audioClock = () => {
      if (!audio || audio.paused || audio.ended) return null;
      const ct = audio.currentTime, p = performance.now();
      if (ct !== lastCT) { lastCT = ct; lastCTAt = p; return ct; }
      return ct + Math.min(0.1, (p - lastCTAt) / 1000) * (audio.playbackRate || 1);
    };
    const timerClock = () => (startedAt ? Math.min(ctl.duration + 0.2, (performance.now() - startedAt) / 1000) : null);
    const startLips = (clock, track) => { Lip.track = track; Lip.clock = clock; Lip.source = track.fromText ? 'text' : 'audio'; Char.talk(); logEv('lips-on', { source: Lip.source }); };
    const silent = () => { ctl.how = 'text'; startedAt = performance.now(); timer = setTimeout(() => endFn('text'), ctl.duration * 1000); logEv('speech-text', { url: s.url || null, dur: ctl.duration });
      trackP.then((r) => { if (curSpeech === ctl && !stopped) startLips(timerClock, r ? r.track : textTrack()); }); };
    const browser = () => {
      if (cfg.overlay.browserVoiceFallback === false || !('speechSynthesis' in window) || !prefs.audio || !audioOwner) return silent();
      try {
        const u = new SpeechSynthesisUtterance(s.text);
        const vs = speechSynthesis.getVoices(); const lang = cfg.voice?.browserLang || 'en-US';
        const fem = /(female|zira|aria|jenny|ava|emma|samantha|sonia|libby|natasha|google uk english female)/i;
        u.voice = vs.find((v) => v.lang === lang && fem.test(v.name)) || vs.find((v) => v.lang === lang) || null;
        u.rate = 1.02; u.pitch = 1.15; ctl.how = 'browser'; startedAt = performance.now();
        u.onend = () => endFn('browser'); u.onerror = () => endFn('browser-error');
        speechSynthesis.cancel(); speechSynthesis.speak(u); logEv('speech-browser');
        startLips(timerClock, textTrack());
        timer = setTimeout(() => endFn('browser-timeout'), (ctl.duration + 6) * 1000);
      } catch { silent(); }
    };
    if (renderMode) VT.pending.push(trackP);
    setTimeout(async () => {
      if (stopped) return;
      if (renderMode) { window.__audioLog = (window.__audioLog || []).concat({ url: s.url, vt: performance.now() }); return silent(); }  // demo renderer: virtual clock, audio mixed afterwards
      if (!s.url) return browser();
      // wait (briefly) for the lip track so the mouth is right from the first syllable
      const r = await Promise.race([trackP, sleep(1200).then(() => null)]);
      if (stopped) return;
      if (!prefs.audio) return silent();
      if (!audioOwner) return silent();   // another overlay window is the one that speaks (only one voice on the LIVE)
      audio = SharedAudio.el; audio.onended = null; audio.onerror = null; audio.preload = 'auto';
      setAudioSrc(audio, r ? URL.createObjectURL(new Blob([r.bytes], { type: 'audio/mpeg' })) : s.url);
      audio.onended = () => endFn('audio');
      audio.onerror = () => { logEv('audio-error'); browser(); };
      audio.play().then(() => {
        ctl.how = 'audio'; startedAt = performance.now();
        if (r) startLips(audioClock, r.track); else { startLips(audioClock, textTrack()); trackP.then((x) => { if (x && curSpeech === ctl) { Lip.track = x.track; Lip.source = 'audio'; } }); }
        logEv('audio-play', { url: s.url }); window.__audioLog = (window.__audioLog || []).slice(-50).concat({ url: s.url, at: Date.now() });
      }).catch((e) => { logEv('audio-blocked', { err: e.name }); if (e.name === 'NotAllowedError') $('soundChip').hidden = false; silent(); });
    }, Math.max(0, delayMs));
    return ctl;
  }
  // Phones only allow sound after a tap, and only on an audio element that was "unlocked" by that tap.
  // So we use ONE shared <audio> for all of Mira's speech and unlock it on the first tap anywhere.
  function unlockAudio() {
    if (SharedAudio.unlocked) return;
    const el = SharedAudio.el;
    setAudioSrc(el, 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    el.play().then(() => { el.pause(); SharedAudio.unlocked = true; $('soundChip').hidden = true; }).catch(() => {});
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch {}
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}
    $('soundChip').hidden = true;
  }
  $('soundChip').onclick = unlockAudio;
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((ev) => addEventListener(ev, unlockAudio, { passive: true }));
  if (!renderMode && prefs.audio) {
    // show the tap prompt up front; if the browser already allows sound (desktop / LIVE Studio) it hides itself
    const probe = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    probe.play().then(() => { SharedAudio.unlocked = true; }).catch(() => { $('soundChip').hidden = false; });
  }

  let actx;
  function chime() {
    if (!prefs.chime || !audioOwner) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.11;
        o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 1.6);
      });
    } catch {}
  }

  // ------------------------------------------------------------ subtitles (word-by-word, synced to the audio clock)
  let subLoop = null;
  function subtitles(sentences, ctl, pageChars) {
    cancelAnimationFrame(subLoop);
    const words = sentences.join(' ').split(/\s+/);
    const pages = []; let cur = [];
    for (const w of words) { if (cur.length && (cur.join(' ').length + w.length) > pageChars) { pages.push(cur); cur = []; } cur.push(w); }
    if (cur.length) pages.push(cur);
    const total = words.length; let shownPage = -1;
    const box = $('readingText'), bar = $('progress').firstElementChild;
    const step = () => {
      const p = Math.min(1, ctl.elapsed() / Math.max(0.5, ctl.duration));
      const idx = Math.floor(p * total);
      let acc = 0, page = 0;
      for (let i = 0; i < pages.length; i++) { if (idx < acc + pages[i].length) { page = i; break; } acc += pages[i].length; page = i; }
      if (page !== shownPage) { shownPage = page; box.innerHTML = pages[page].map((w) => `<span class="w">${esc(w)} </span>`).join(''); }
      const start = pages.slice(0, page).reduce((a, b) => a + b.length, 0);
      box.querySelectorAll('.w').forEach((el, i) => el.classList.toggle('on', start + i <= idx));
      bar.style.width = (p * 100).toFixed(1) + '%';
      if (p < 1) subLoop = requestAnimationFrame(step);
      else box.querySelectorAll('.w').forEach((el) => el.classList.add('on'));
    };
    box.innerHTML = pages[0].map((w) => `<span class="w">${esc(w)} </span>`).join(''); bar.style.width = '0';
    subLoop = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ show reading / say
  let hideTimers = [];
  const later = (ms, fn) => hideTimers.push(setTimeout(fn, ms));
  function clearLater() { hideTimers.forEach(clearTimeout); hideTimers = []; }
  function panels({ top = false, box = false, solo = false, bubble = false, hold = false }) {
    $('revealTop').classList.toggle('hidden', !top);
    $('readingBox').classList.toggle('hidden', !box); $('readingBox').classList.toggle('solo', solo);
    $('commentBubble').classList.toggle('hidden', !bubble);
    $('idleBox').classList.toggle('hidden', top || box || bubble || hold);
    root.classList.toggle('busy', !!(top || bubble || hold));
  }

  function reveal(item) {
    clearLater(); logEv('reveal', { id: item.id, prophecy: !!item.prophecy });
    // readings asked in the comments: show who asked, their date and question in the caption bubble
    const cap = item.caption && cfg.overlay.showChat !== false ? item.caption : null;
    if (cap) { $('cbAvatar').textContent = cap.icon || '🔮'; $('cbName').textContent = cap.title || ''; $('cbText').textContent = cap.text || ''; }
    $('commentBubble').classList.toggle('isQuestion', !!cap);
    const vert = prefs.layout !== 'landscape';
    const bubble = !!cap && !vert; // on phones the question goes inside the card (one box instead of two)
    $('revQ').textContent = cap && cap.text && !/^@/.test(cap.text) ? cap.text : '';
    panels({ hold: true, bubble });
    const card = $('card'); card.classList.remove('flip');
    $('cardNum').textContent = item.keyNumbers[0].value; $('cardTitle').textContent = item.title;
    $('tierBadge').textContent = item.tierName; $('name').textContent = item.name; $('handle').textContent = '@' + item.nickname + (item.caption && item.caption.title && item.caption.title.includes('·') ? ' · ' + item.caption.title.split('·').slice(1).join('·').trim() : '');
    $('nums').innerHTML = item.keyNumbers.slice(1).map((n) => `<div class="num"><b>${n.value}</b><span>${esc(n.label)}</span></div>`).join('');
    $('readingText').innerHTML = '';
    chime(); boost = 40;
    const s = item.speech || { text: item.sentences.join(' '), duration: item.seconds - 4, start: 3 };
    const startMs = (s.start ?? 3) * 1000;
    if (item.prophecy) Char.prophecy(); else if (Char.mode === 'prophecy') Char.idle();
    Rig.gesture('think', { seconds: Math.max(2, (s.start ?? 3) - 0.3) });
    const ctl = playSpeech(s, startMs);
    ctl.ended.then(() => { if (curSpeech === ctl || !curSpeech) setTimeout(() => { if (!Lip.clock) Char.idle(); }, 700); });
    later(600, () => panels({ top: true, bubble }));
    later(1300, () => card.classList.add('flip'));
    later(1900, () => document.querySelectorAll('#nums .num').forEach((n, i) => setTimeout(() => n.classList.add('on'), i * 220)));
    later(Math.max(2200, startMs), () => { panels({ top: true, box: true, bubble }); subtitles(item.sentences, ctl, prefs.layout === 'landscape' ? 260 : 140); });
    later((item.seconds || 20) * 1000, endShow);
  }

  function say(item) {
    clearLater(); logEv('say', { id: item.id, sub: item.sub });
    if (Char.mode === 'prophecy') Char.idle();
    const s = item.speech || { text: item.text, duration: 3, start: 0.5 };
    const cap = item.comment ? { icon: (item.comment.nickname || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '★', title: '@' + item.comment.nickname, text: item.comment.text }
      : item.caption || null;
    const showCap = !!cap && cfg.overlay.showChat !== false;
    if (showCap) { $('cbAvatar').textContent = cap.icon || '✦'; $('cbName').textContent = cap.title || ''; $('cbText').textContent = cap.text || ''; }
    $('commentBubble').classList.toggle('isQuestion', !!item.comment);
    panels({ box: true, solo: true, bubble: showCap });
    // body language: she reads the question first (head tilt, brows up), nods hello, smiles at thank-yous
    const lead = (s.start ?? 0.5);
    if (item.sub === 'reply') Rig.gesture('listen', { seconds: lead + 0.5 });
    else if (item.sub === 'welcome') { Rig.gesture('nod'); Rig.gesture('happy', { seconds: 0.9 }); }
    else if (item.sub === 'greet') { Rig.gesture('happy', { seconds: 1.9 }); Rig.gesture('nod', { amp: 0.7 }); }
    else Rig.gesture('brow');
    $('readingText').innerHTML = '';
    const startMs = (s.start ?? 0.5) * 1000;
    const ctl = playSpeech(s, startMs);
    later(startMs, () => subtitles([item.text], ctl, prefs.layout === 'landscape' ? 300 : 160));
    ctl.ended.then(() => { if (!Lip.clock) Char.idle(); });
    later((item.seconds || 5) * 1000, endShow);
  }

  function endShow() { cancelAnimationFrame(subLoop); panels({}); if (!Lip.clock) Char.idle(); logEv('show-end'); }
  function skip() { clearLater(); stopSpeech(); Lip.clock = null; endShow(); }

  // ------------------------------------------------------------ queue, toasts, hearts
  let lastQueue = [], lastChat = [];
  function renderQueue() {
    const show = prefs.queue !== null ? prefs.queue : cfg.overlay.showQueue !== false;
    const n = cfg.overlay.queueVisibleCount || 5;
    $('queueBox').classList.toggle('empty', !show || (!lastQueue.length && !lastChat.length));
    $('queueList').innerHTML = lastQueue.slice(0, n).map((q, i) => `<li><i>${i + 1}.</i>${esc(q.name)} ${q.level >= 3 ? '📜' : q.level >= 2 ? '✨' : '🌹'}</li>`).join('');
    $('queueMore').textContent = lastQueue.length > n ? `+${lastQueue.length - n} more` : '';
    $('chatWaiting').textContent = lastChat.length ? `💬 ${lastChat.length} comment${lastChat.length > 1 ? 's' : ''} waiting` : '';
    $('queueBox').querySelector('.qTitle').style.display = lastQueue.length ? '' : 'none';
  }
  function toast(text, kind = 'info', life = 4.5) {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text; el.style.setProperty('--life', life + 's');
    $('toasts').prepend(el); while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
    setTimeout(() => el.remove(), (life + .6) * 1000);
  }
  let heartCount = 0;
  function hearts(n) {
    if (cfg.overlay.showLikeHearts === false) return;
    for (let i = 0; i < Math.min(n, 5); i++) setTimeout(() => {
      if (heartCount > 20) return;
      const h = document.createElement('div'); h.className = 'heart'; h.textContent = ['💜', '💖', '✨', '💗'][Math.floor(Math.random() * 4)];
      h.style.left = Math.random() * 110 + 'px'; h.style.setProperty('--dx', (Math.random() - .5) * 110 + 'px');
      $('hearts').appendChild(h); heartCount++; setTimeout(() => { h.remove(); heartCount--; }, 2700);
    }, i * 160);
  }

  function applyConfig(m) {
    cfg = { ...cfg, ...m, overlay: { ...(m.overlay || cfg.overlay) } };
    const o = cfg.overlay;
    $('title').textContent = o.title || 'Fate Reading';
    $('cta').textContent = o.callToAction || '';
    const g = cfg.trigger || {};
    $('giftTxt').textContent = g.minDiamonds > 1 ? `a ${g.minDiamonds}-coin gift` : `1 ${g.giftName || 'gift'} ${/rose/i.test(g.giftName) ? '🌹' : '🎁'}`;
    const R = cfg.readings || { fromComments: true };
    $('stepsLive').classList.toggle('hidden', !R.fromComments); $('stepsForm').classList.toggle('hidden', !!R.fromComments);
    $('giftLive').textContent = R.requireGift ? `send ${$('giftTxt').textContent} to unlock` : 'gifts jump the queue 🌹';
    $('tiersRow').classList.toggle('hidden', !!R.fromComments && !R.requireGift);
    $('tiersRow').innerHTML = (cfg.tiers || []).map((t) => `<span>${t.minDiamonds} coin${t.minDiamonds > 1 ? 's' : ''}: ${esc(t.name)}</span>`).join('');
    Char.init();
    const sig = JSON.stringify(o);   // state is re-sent on every status change; only rebuild her layers when the look changed
    if (sig !== lastLook) { lastLook = sig; Char.build(); }
    // TikFinity runs on the streaming PC only when the server uses it (not in direct-only mode)
    const src = cfg.tiktok && cfg.tiktok.source;
    if (src === 'direct') stopTikFinity(); else startTikFinity();
  }
  let lastLook = '';

  // ------------------------------------------------------------ TikFinity (local) → server
  // The overlay runs on the streaming PC, so it can hear TikFinity at ws://127.0.0.1:21213/
  // and forward those events over the existing /ws connection. The server never talks to TikTok.
  let serverWs = null, wsWait = 1000;
  let audioOwner = true;   // until the server says another overlay window is the voice
  function stopSpeechAudio() { try { SharedAudio.el.pause(); } catch {} try { speechSynthesis.cancel(); } catch {} }
  function forwardTikFinity(ev) {
    if (!ev || ev.type === 'viewers' || ev.type === 'share') return;
    if (!serverWs || serverWs.readyState !== 1) return;
    if (ev.type === 'status') {
      const state = ev.mode === 'live' ? 'connected' : (ev.mode || 'connecting');
      serverWs.send(JSON.stringify({ type: 'tikfinityStatus', state, message: ev.message || '', username: ev.username || '' }));
      return;
    }
    serverWs.send(JSON.stringify({ type: 'tikfinity', event: ev }));
  }
  function startTikFinity() {
    if (typeof TikFinity === 'undefined' || !serverWs || serverWs.readyState !== 1) return;
    TikFinity.setSink(forwardTikFinity);
    TikFinity.connect();
  }
  function stopTikFinity() { if (typeof TikFinity !== 'undefined' && TikFinity.stop) TikFinity.stop(); }

  // ------------------------------------------------------------ server connection
  // keep the free Render server awake while this page is open (it sleeps after 15 min with no HTTP requests)
  setInterval(() => fetch('/healthz', { cache: 'no-store' }).catch(() => {}), 4 * 60e3);
  function connect() {
    const key = qs.get('key');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${key ? '?key=' + encodeURIComponent(key) : ''}`);
    serverWs = ws;
    ws.onopen = () => {
      $('conn').classList.add('ok'); wsWait = 1000;
      // tell the server this is an overlay, so only ONE open overlay plays Mira's voice
      ws.send(JSON.stringify({ type: 'hello', role: 'overlay', audio: !!prefs.audio && !renderMode, primary: qs.get('primary') === '1',
        mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent), lite }));
      if (typeof TikFinity !== 'undefined' && TikFinity.state === 'live') {
        forwardTikFinity({ type: 'status', mode: 'live', message: 'TikFinity connected' });
      }
    };
    // reconnect with backoff (1 s → 15 s); never reloads the page
    ws.onclose = () => { if (serverWs !== ws) return; serverWs = null; $('conn').classList.remove('ok'); setTimeout(connect, wsWait); wsWait = Math.min(15000, wsWait * 1.7); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'audioOwner') { audioOwner = !!m.you; logEv('audio-owner', { you: audioOwner }); if (!audioOwner) stopSpeechAudio(); }
      else if (m.type === 'state') { applyConfig(m); lastQueue = m.queue || []; lastChat = m.chatQueue || []; renderQueue(); }
      else if (m.type === 'queue') { lastQueue = m.queue; renderQueue(); }
      else if (m.type === 'chatQueue') { lastChat = m.chatQueue; renderQueue(); }
      else if (renderMode && (m.type === 'reveal' || m.type === 'say')) window.__render.events.push(m);  // the renderer plays them on its clock
      else if (m.type === 'reveal') reveal(m.item);
      else if (m.type === 'say') say(m.item);
      else if (m.type === 'skip') skip();
      else if (m.type === 'toast') toast(m.text, m.kind);
      else if (m.type === 'gift') { Rig.gesture('happy', { seconds: 1.5 }); toast(`🎁 ${m.nickname} sent ${m.giftName}${m.diamonds > 1 ? ` (${m.diamonds})` : ''}`, 'gift', 3); }
      else if (m.type === 'like') hearts(Math.ceil((m.count || 1) / 3));
      else if (m.type === 'follow' && cfg.overlay.showFollowToasts !== false) toast(`💫 ${m.nickname} followed!`, 'info', 3.5);
    };
  }

  // ------------------------------------------------------------ settings panel (press C, or ?panel=1)
  const panel = $('panel');
  function syncPanel() {
    document.querySelectorAll('input[name=layout]').forEach((r) => (r.checked = r.value === prefs.layout));
    $('pAudio').checked = prefs.audio; $('pChime').checked = prefs.chime; $('pQueue').checked = prefs.queue !== null ? prefs.queue : cfg.overlay.showQueue !== false;
    $('pAdmin').href = '/admin' + (qs.get('key') ? '?key=' + encodeURIComponent(qs.get('key')) : '');
    $('pDiag').textContent = JSON.stringify(window.__diag(), null, 1);
  }
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'c') { panel.hidden = !panel.hidden; syncPanel(); } });
  document.querySelectorAll('input[name=layout]').forEach((r) => r.onchange = () => { prefs.layout = r.value; LS('layout', r.value); applyLayout(); });
  $('pAudio').onchange = (e) => { prefs.audio = e.target.checked; LS('audio', e.target.checked ? '1' : '0'); };
  $('pChime').onchange = (e) => { prefs.chime = e.target.checked; LS('chime', e.target.checked ? '1' : '0'); };
  $('pQueue').onchange = (e) => { prefs.queue = e.target.checked; LS('queue', e.target.checked ? '1' : '0'); renderQueue(); };
  const demoReading = { id: 'local', name: 'Ayesha', nickname: 'ayesha_test', tierName: 'Test reading', level: 2, seconds: 16, title: 'The Seeker', prophecy: true,
    keyNumbers: [{ label: 'Life Path', value: 7 }, { label: 'Destiny', value: 3 }, { label: 'Soul', value: 6 }, { label: 'Year 2026', value: 5 }],
    sentences: ['Life Path 7, The Seeker: a deep seeker who finds truth others miss.', 'Your 2026 is a Personal Year 5: a year of change, travel and surprising opportunities.'],
    speech: { text: 'Ayesha, Life Path 7, the seeker.', duration: 9, start: 1.8 } };
  $('pTest').onclick = () => reveal(demoReading);
  $('pTalk').onclick = () => say({ id: 'local2', sub: 'reply', text: 'Hello my dear, the stars are glowing for you tonight.', comment: { nickname: 'tester', text: 'hi Mira!' }, speech: { text: 'Hello my dear, the stars are glowing for you tonight.', duration: 4, start: 0.5 }, seconds: 6 });
  if (qs.get('panel') === '1') panel.hidden = false;

  window.__diag = () => ({ tikfinity: typeof TikFinity === 'undefined' ? null : { state: TikFinity.state, url: TikFinity.url, count: TikFinity.count }, kind: Char.kind, rig: Rig.api ? { eye: Rig.api.state.eye, mouth: Rig.api.state.mouth.cur } : null, videoFrame: Vid.idx, videoSrc: vid.currentSrc ? vid.currentSrc.replace(location.origin, '') : null, rvfc: Vid.rvfc, mode: Char.mode, mouthOk: !!Char.mouthOk, viseme: Mouth.target, lipSource: Lip.source, speaking: !!Lip.clock,
    prophecyOn: proph.classList.contains('on'), prophecyOpacity: getComputedStyle(proph).opacity, speech: curSpeech ? curSpeech.how : null,
    charBox: { w: charBox.clientWidth, h: charBox.clientHeight }, lite, fps: FPS, audioOwner, rigLost: Rig.lost || 0,
    rigCanvas: Rig.api ? [Rig.api.canvas.width, Rig.api.canvas.height] : null });
  window.__fortune = { reveal, say, toast, hearts, Char, Mouth, Lip, LipSync, Rig };
  // Frame-accurate renderer (?render=1): virtual clock for timers, CSS animations, lips and the video frame.
  const animBase = new WeakMap();
  window.__render = {
    events: [], audio: [],
    async load(url) { const r = await loadTrack(url); this.track = r.track; return { duration: r.track.duration, stats: LipSync.stats(r.track) }; },
    begin(t0Ms) { lastNow = t0Ms; VT.now = t0Ms; Lip.track = this.track; Char.talk(); },
    /** Advance the virtual clock to `ms`, show the matching video frame, draw. speechT: optional manual lip clock. */
    async at(ms, speechT) {
      VT.now = ms;
      for (;;) { const due = VT.timers.filter((t) => t.at <= ms).sort((x, y) => x.at - y.at)[0]; if (!due) break; VT.timers = VT.timers.filter((t) => t !== due); try { due.fn(); } catch (e) { console.error(e); } await 0; }
      await new Promise((r) => window.setTimeout(r, 0));          // let async work (track decode, awaits) settle
      while (VT.pending.length) { await Promise.all(VT.pending.splice(0)); await new Promise((r) => window.setTimeout(r, 0)); }
      if (speechT !== undefined) { Lip.track = this.track; Lip.clock = speechT == null ? null : () => speechT; }
      for (const an of document.getAnimations()) { if (!animBase.has(an)) animBase.set(an, ms); an.pause(); an.currentTime = ms - animBase.get(an); }
      if (Vid.on) {
        const idx = Math.floor((ms / 1000) * Vid.track.fps) % Vid.frames;
        if (idx !== Vid.idx || !this.seeked) {
          await new Promise((res) => {
            const done = () => { window.clearTimeout(to); res(); }; const to = window.setTimeout(done, 1500);
            vid.addEventListener('seeked', () => { if (Vid.rvfc) vid.requestVideoFrameCallback(() => done()); else done(); }, { once: true });
            vid.currentTime = (idx + 0.5) / Vid.track.fps;
          });
          this.seeked = true;
        }
        Vid.idx = idx; applyTrack();
      }
      frame(ms);
      return { v: Mouth.target, open: Mouth.open, f: Vid.idx };
    },
    /** Measurement only: show a fixed patch (e.g. frame 0's own closed mouth) at full opacity, or remove it. */
    probe(url) {
      let p = $('mouthProbe');
      if (!url) { if (p) p.remove(); return; }
      if (!p) { p = document.createElement('img'); p.id = 'mouthProbe'; Object.assign(p.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 99999, opacity: 1 }); mouthEl.appendChild(p); }
      return new Promise((r) => { p.onload = r; p.src = url; });
    },
    diag: () => window.__diag(),
  };

  if (lite) root.classList.add('lite');
  applyLayout(); syncPanel(); requestAnimationFrame(tick);
  connect();
  window.setTimeout(() => { if (!Char.inited) { Char.init(); } }, 1500);
})();
