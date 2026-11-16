/*
 * Mira lip-sync: turns speech audio into a mouth-shape (viseme) timeline.
 * Shared by the overlay (browser) and the tests / demo renderer (Node, loaded with vm).
 *
 * Visemes (index: name, how open):  0 X closed (the still itself) · 1 O small · 2 E medium/teeth · 3 A wide
 *
 * analyze(pcm, sampleRate) works on the decoded MP3 samples:
 *   - 100 frames per second, 20 ms window, RMS loudness in dB + high-frequency ratio (first difference energy)
 *   - loudness is normalised to the clip's own speaking level (95th percentile), so quiet and loud voices both work
 *   - a silence gate closes the mouth (anything 30 dB under the speaking level or below -60 dBFS)
 *   - fast attack / slower release smoothing, then hysteresis so a shape is held >= minHoldMs (no flicker)
 *   - sibilants ("s", "sh", "f": loud high-frequency) show teeth (E) instead of a wide A
 * fromText(text, seconds) is the fallback when audio samples are not available (browser voice / text only).
 */
(function (root) {
  const OPEN = [0, 0.35, 0.85, 1];
  const NAMES = ['X', 'O', 'E', 'A'];
  const DEF = { fps: 100, floorDb: 24, rangeDb: 20, gateDb: 30, absGateDb: -60, attack: 0.65, release: 0.3, minHoldMs: 50, closeAfterMs: 40, tO: 0.12, tE: 0.5, tA: 0.82, hfSibilant: 0.62 };

  function percentile(arr, p) { const a = Array.from(arr).sort((x, y) => x - y); if (!a.length) return 0; return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))]; }

  function analyze(pcm, sampleRate, opts) {
    const o = Object.assign({}, DEF, opts || {});
    const hop = sampleRate / o.fps, win = Math.round(hop * 2);
    const n = Math.max(0, Math.floor((pcm.length - win) / hop) + 1);
    const rms = new Float32Array(n), db = new Float32Array(n), hf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s0 = Math.round(i * hop); let e = 0, d = 0, prev = pcm[s0];
      for (let k = s0; k < s0 + win; k++) { const v = pcm[k]; e += v * v; const dv = v - prev; d += dv * dv; prev = v; }
      rms[i] = Math.sqrt(e / win); db[i] = 20 * Math.log10(rms[i] + 1e-9); hf[i] = e > 0 ? Math.min(2, Math.sqrt(d / e)) : 0;
    }
    const voiced = Array.from(db).filter((v) => v > o.absGateDb);
    const ref = voiced.length ? percentile(voiced, 95) : -20;
    const gate = Math.max(ref - o.gateDb, o.absGateDb);
    const raw = new Float32Array(n), open = new Float32Array(n), vis = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = db[i] <= gate ? 0 : Math.max(0, Math.min(1, (db[i] - (ref - o.floorDb)) / o.rangeDb));
    let env = 0;
    for (let i = 0; i < n; i++) { const r = raw[i]; env += (r - env) * (r > env ? o.attack : o.release); if (r === 0 && env < o.tO) env = 0; open[i] = env; }
    // shape choice + hysteresis
    const holdF = Math.max(1, Math.round((o.minHoldMs / 1000) * o.fps)), closeF = Math.max(1, Math.round((o.closeAfterMs / 1000) * o.fps));
    let cur = 0, since = 0, silentRun = 0;
    for (let i = 0; i < n; i++) {
      const v = open[i];
      silentRun = raw[i] === 0 ? silentRun + 1 : 0;
      let want = v < o.tO ? 0 : v < o.tE ? 1 : v < o.tA ? 2 : 3;
      if (want === 3 && hf[i] > o.hfSibilant) want = 2;
      if (silentRun >= closeF) want = 0;                         // real silence: close right away
      if (want !== cur && (since >= holdF || want === 0 && silentRun >= closeF)) { cur = want; since = 0; }
      else since++;
      vis[i] = cur;
    }
    const shape = classifyShapes(pcm, sampleRate, hop, win, n, open, raw, o);
    return { fps: o.fps, duration: n / o.fps, ref, gate, rms, open, vis, shape };
  }

  // ------------------------------------------------------------------ mouth shapes for the 2D rig
  // Shapes: 0 rest · 1 small · 2 E (eh/s, teeth) · 3 A (ah) · 4 O (oh) · 5 U (oo/w)
  //         6 I (ee: wide, nearly closed, teeth) · 7 FV (f/v: lower lip under the teeth) · 8 MBP (m/b/p: lips pressed)
  // Rigs without a drawing for 6-8 fall back to E / small / rest (public/rig.js MOUTH_FALLBACK).
  const SHAPES = ['rest', 'small', 'E', 'A', 'O', 'U', 'I', 'FV', 'MBP'];
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  /**
   * Vowel-ish class per frame from the spectrum: spectral centroid (150-3500 Hz) relative to this clip's
   * median says back/rounded (O, U) vs front (E) vs open (A); strong 4-10 kHz energy (s, sh, z, ch) shows teeth.
   * The openness envelope decides how wide (small vs full shape). Smoothed with a 5-frame majority and a hold time.
   */
  function classifyShapes(pcm, sr, hop, win, n, open, raw, o) {
    const N = 512, re = new Float32Array(N), im = new Float32Array(N), hz = sr / N;
    const cent = new Float32Array(n), sib = new Float32Array(n), front = new Float32Array(n);
    const b = (f) => Math.min(N / 2 - 1, Math.max(1, Math.round(f / hz)));
    const L0 = b(150), L1 = b(900), M1 = b(1700), H1 = b(3500), S0 = b(4000), S1 = b(Math.min(10000, sr / 2 - 100));
    const hann = new Float32Array(Math.min(win, N)); for (let i = 0; i < hann.length; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (hann.length - 1));
    const cents = [];
    for (let i = 0; i < n; i++) {
      if (raw[i] === 0) continue;
      const s0 = Math.round(i * hop); re.fill(0); im.fill(0);
      for (let k = 0; k < hann.length && s0 + k < pcm.length; k++) re[k] = pcm[s0 + k] * hann[k];
      fft(re, im);
      let eL = 0, eM = 0, eH = 0, eS = 0, cw = 0, cs = 0;
      for (let k = L0; k <= S1; k++) {
        const e = re[k] * re[k] + im[k] * im[k];
        if (k < L1) eL += e; else if (k < M1) eM += e; else if (k < H1) eH += e; else if (k >= S0) eS += e;
        if (k < H1) { cw += e; cs += e * k * hz; }
      }
      const tot = eL + eM + eH + eS + 1e-12;
      cent[i] = cs / (cw + 1e-12); sib[i] = eS / tot; front[i] = eH / (eM + 1e-12);
      cents.push(cent[i]);
    }
    const med = cents.length ? percentile(cents, 50) : 1000;
    const want = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = open[i];
      if (v < o.tO || raw[i] === 0) { want[i] = 0; continue; }
      const rel = cent[i] / med;
      let s;
      if (sib[i] > 0.45) s = v < 0.35 && sib[i] < 0.7 ? 7 : v < 0.5 ? 1 : 2;   // soft, broad hiss: f / v; strong: s / sh
      else if (rel < 0.8) s = v > 0.5 ? 4 : 5;
      else if (rel > 1.22 || front[i] > 1.4) s = v < 0.55 ? 6 : 2;
      else s = v > 0.5 ? 3 : 1;
      want[i] = s;
    }
    // a short dip to (near) silence between two voiced stretches is a closure: m / b / p press the lips together
    for (let i = 0; i < n; i++) {
      if (want[i] !== 0) continue;
      let j = i; while (j < n && want[j] === 0) j++;
      if (i > 0 && j < n && j - i <= 12 && want[i - 1] !== 0) for (let k = i; k < j; k++) want[k] = 8;
      i = j;
    }
    // majority over 5 frames, then hold >= 60 ms (closing on real silence right away)
    const out = new Uint8Array(n), cnt = new Uint8Array(SHAPES.length);
    let cur = 0, since = 99;
    for (let i = 0; i < n; i++) {
      cnt.fill(0); for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) cnt[want[k]]++;
      let best = want[i]; for (let s = 0; s < SHAPES.length; s++) if (cnt[s] > cnt[best]) best = s;
      if (best !== cur && (since >= 6 || (best === 0 && raw[i] === 0))) { cur = best; since = 0; } else since++;
      out[i] = cur;
    }
    return out;
  }

  /** { shape: 'rest'|'small'|'E'|'A'|'O'|'U'|'I'|'FV'|'MBP', open: 0..1 } at time t (seconds into the clip). */
  function shapeAt(track, t) {
    if (!track || t < 0) return { shape: 'rest', open: 0 };
    const i = Math.floor(t * track.fps);
    if (i < 0 || i >= track.vis.length) return { shape: 'rest', open: 0 };
    const s = track.shape ? track.shape[i] : [0, 1, 2, 3][track.vis[i]];
    return { shape: SHAPES[s], open: track.open ? track.open[i] : OPEN[track.vis[i]] };
  }

  /** Fallback when there are no samples: rough syllables from the text, spread over `seconds`. */
  function fromText(text, seconds, opts) {
    const fps = (opts && opts.fps) || 100, n = Math.max(1, Math.round(seconds * fps));
    const vis = new Uint8Array(n), open = new Float32Array(n), shp = new Uint8Array(n);
    const toks = String(text || '').split(/(\s+|[,.!?;:]+)/).filter((t) => t && t.trim());
    const units = toks.map((t) => (/^[,.!?;:]+$/.test(t) ? { pause: /[.!?]/.test(t) ? 6 : 3 } : { word: t, len: Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, '').length) }));
    const total = units.reduce((a, u) => a + (u.pause || u.len + 1), 0) || 1;
    let f = 0;
    for (const u of units) {
      const span = Math.round(((u.pause || u.len + 1) / total) * n);
      if (u.word) {
        const groups = (u.word.toLowerCase().match(/[aeiouy]+|[^aeiouy]+/g) || [u.word]);
        const syl = Math.max(1, groups.filter((g) => /[aeiouy]/.test(g)).length);
        const per = Math.max(1, Math.floor((span - 1) / syl)); let k = 0;
        for (const g of groups) {
          if (!/[aeiouy]/.test(g)) continue;
          const shape = /a|o/.test(g) ? (g.includes('o') || g.includes('u') ? 1 : 3) : /e|i|y/.test(g) ? 2 : 1;
          const rs = g.includes('o') ? 4 : g.includes('u') ? 5 : g.includes('a') ? 3 : /^(i|ee|y)$/.test(g) ? 6 : 2;   // rig shape
          for (let j = 0; j < per; j++) { const idx = f + k * per + j; if (idx >= n) break; const edge = j === 0 || j === per - 1; vis[idx] = edge ? Math.min(shape, 1) : shape; open[idx] = OPEN[vis[idx]]; shp[idx] = edge ? 1 : rs; }
          k++;
        }
      }
      f += span;
    }
    return { fps, duration: n / fps, vis, open, shape: shp, fromText: true };
  }

  function at(track, t) {
    if (!track || t < 0) return 0;
    const i = Math.floor(t * track.fps);
    return i >= 0 && i < track.vis.length ? track.vis[i] : 0;
  }

  /** Objective check: correlation of mouth openness with loudness and how often the mouth is shut in silences. */
  function stats(track) {
    const n = track.vis.length; if (!n || !track.rms) return null;
    const m = new Float64Array(n), a = new Float64Array(n);
    for (let i = 0; i < n; i++) { m[i] = OPEN[track.vis[i]]; a[i] = 20 * Math.log10(track.rms[i] + 1e-9) > track.gate ? track.rms[i] : 0; }
    const ld = new Float64Array(n); // perceptual loudness 0..1 (dB above the gate)
    for (let i = 0; i < n; i++) ld[i] = a[i] ? Math.min(1, Math.max(0, (20 * Math.log10(a[i]) - track.gate) / (track.ref - track.gate || 1))) : 0;
    const pearson = (x, y) => {
      const mean = (z) => z.reduce((s, v) => s + v, 0) / z.length; const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxy / Math.sqrt(sxx * syy || 1);
    };
    let silent = 0, silentClosed = 0, voiced = 0, voicedOpen = 0, run = 0;
    for (let i = 0; i < n; i++) {
      const isSilent = a[i] === 0; run = isSilent ? run + 1 : 0;
      if (isSilent && run > 6) { silent++; if (track.vis[i] === 0) silentClosed++; }      // silence longer than 60 ms
      if (!isSilent) { voiced++; if (track.vis[i] > 0) voicedOpen++; }
    }
    let changes = 0; for (let i = 1; i < n; i++) if (track.vis[i] !== track.vis[i - 1]) changes++;
    return { frames: n, pearson: pearson(m, a), pearsonLoudness: pearson(m, ld), silenceClosedPct: silent ? (100 * silentClosed) / silent : 100, voicedOpenPct: voiced ? (100 * voicedOpen) / voiced : 0, changesPerSecond: changes / (n / track.fps) };
  }

  const api = { analyze, fromText, at, shapeAt, stats, OPEN, NAMES, SHAPES, DEFAULTS: DEF };
  root.LipSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
