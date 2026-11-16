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
    return { fps: o.fps, duration: n / o.fps, ref, gate, rms, open, vis };
  }

  /** Fallback when there are no samples: rough syllables from the text, spread over `seconds`. */
  function fromText(text, seconds, opts) {
    const fps = (opts && opts.fps) || 100, n = Math.max(1, Math.round(seconds * fps));
    const vis = new Uint8Array(n), open = new Float32Array(n);
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
          for (let j = 0; j < per; j++) { const idx = f + k * per + j; if (idx >= n) break; const edge = j === 0 || j === per - 1; vis[idx] = edge ? Math.min(shape, 1) : shape; open[idx] = OPEN[vis[idx]]; }
          k++;
        }
      }
      f += span;
    }
    return { fps, duration: n / fps, vis, open, fromText: true };
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

  const api = { analyze, fromText, at, stats, OPEN, NAMES, DEFAULTS: DEF };
  root.LipSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
