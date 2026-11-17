/*
 * Mira's magic effects, drawn with plain 2D canvas (no WebGL, tiny memory; used by phone mode on iPhone and by the
 * desktop rig through its own small effects canvas):
 *  - the crystal ball "looking" effect: violet mist swirling inside the ball, a brighter core, a halo
 *  - tarot card pulls: a small deck appears on the table, a card slides out (her hand reaches for it in phone mode),
 *    flips over to its face (the drawn card's own symbol art, name, number) and stays while she explains it, then fades
 *  - card faces: drawn once per pull (no images to download): gold frame, starry night, the card's symbol
 *    (sun, moon, star, crown, wheel, tower, scales, cups, wands, swords, pentacles ...), its number and name
 * All coordinates are in the caller's picture space (the ball's centre / radius are passed in).
 */
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const GOLD = '#e8c26a', GOLD2 = '#b8862c', INK = '#2a0f45';
  const MAJOR = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World'];
  const MAJOR_ART = ['star4', 'infinity', 'moon', 'heart', 'crown', 'cross', 'hearts', 'star', 'infinity', 'lantern', 'wheel', 'scales', 'triangle', 'scythe', 'cup', 'pentagramDown', 'tower', 'star', 'moon', 'sun', 'rays', 'wreath'];
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
  const SUIT_ART = { Cups: 'cup', Wands: 'wand', Swords: 'sword', Pentacles: 'pentacle' };

  // ---------------------------------------------------------------- symbol art (centred at 0,0, size ~ s)
  function star(g, n, r1, r2, rot = -Math.PI / 2) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); }
  function heart(g, s, x = 0, y = 0) { g.beginPath(); g.moveTo(x, y + s * 0.35); g.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.85, x, y - s * 0.38); g.bezierCurveTo(x + s * 0.45, y - s * 0.85, x + s * 0.9, y - s * 0.25, x, y + s * 0.35); g.closePath(); }
  function art(g, kind, s) {
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    const fill = () => g.fill(), stroke = (w) => { g.lineWidth = w || s * 0.07; g.stroke(); };
    switch (kind) {
      case 'sun': g.beginPath(); g.arc(0, 0, s * 0.32, 0, 7); fill(); for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42); g.lineTo(Math.cos(a) * s * (i % 2 ? 0.62 : 0.75), Math.sin(a) * s * (i % 2 ? 0.62 : 0.75)); stroke(s * 0.06); } break;
      case 'rays': g.beginPath(); g.arc(0, s * 0.3, s * 0.34, Math.PI, 0); fill(); for (let i = 0; i <= 8; i++) { const a = Math.PI + (i * Math.PI) / 8; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.44, s * 0.3 + Math.sin(a) * s * 0.44); g.lineTo(Math.cos(a) * s * 0.74, s * 0.3 + Math.sin(a) * s * 0.74); stroke(s * 0.06); } g.fillRect(-s * 0.7, s * 0.32, s * 1.4, s * 0.06); break;
      case 'moon': g.save(); g.beginPath(); g.rect(-s, -s, s * 2, s * 2); g.arc(s * 0.26, -s * 0.14, s * 0.46, 0, 7); g.clip('evenodd'); g.beginPath(); g.arc(0, 0, s * 0.55, 0, 7); fill(); g.restore(); g.translate(s * 0.32, -s * 0.3); star(g, 4, s * 0.13, s * 0.04); fill(); break;
      case 'star': star(g, 8, s * 0.62, s * 0.24); fill(); break;
      case 'star4': star(g, 4, s * 0.62, s * 0.14); fill(); g.rotate(Math.PI / 4); star(g, 4, s * 0.3, s * 0.08); fill(); break;
      case 'heart': heart(g, s * 0.8); fill(); break;
      case 'hearts': heart(g, s * 0.55, -s * 0.2, -s * 0.05); fill(); heart(g, s * 0.55, s * 0.22, s * 0.12); stroke(s * 0.06); break;
      case 'crown': g.beginPath(); g.moveTo(-s * 0.55, s * 0.35); g.lineTo(-s * 0.6, -s * 0.3); g.lineTo(-s * 0.28, 0); g.lineTo(0, -s * 0.5); g.lineTo(s * 0.28, 0); g.lineTo(s * 0.6, -s * 0.3); g.lineTo(s * 0.55, s * 0.35); g.closePath(); fill(); break;
      case 'cross': g.fillRect(-s * 0.05, -s * 0.6, s * 0.1, s * 1.2); [-0.4, -0.2, 0].forEach((y, i) => g.fillRect(-s * (0.18 + i * 0.08), s * y - s * 0.04, s * (0.36 + i * 0.16), s * 0.08)); break;
      case 'infinity': g.beginPath(); for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2, d = 1 + Math.sin(a) ** 2; g.lineTo((s * 0.6 * Math.cos(a)) / d, (s * 0.6 * Math.sin(a) * Math.cos(a)) / d); } stroke(s * 0.09); break;
      case 'lantern': g.beginPath(); g.arc(0, 0, s * 0.5, 0, 7); stroke(s * 0.05); star(g, 6, s * 0.36, s * 0.14); fill(); break;
      case 'wheel': g.beginPath(); g.arc(0, 0, s * 0.55, 0, 7); stroke(s * 0.08); g.beginPath(); g.arc(0, 0, s * 0.14, 0, 7); fill(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14); g.lineTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55); stroke(s * 0.05); } break;
      case 'scales': g.fillRect(-s * 0.04, -s * 0.5, s * 0.08, s * 1.0); g.fillRect(-s * 0.6, -s * 0.36, s * 1.2, s * 0.07); [-1, 1].forEach((d) => { g.beginPath(); g.moveTo(d * s * 0.52, -s * 0.33); g.lineTo(d * s * 0.32, s * 0.08); g.lineTo(d * s * 0.72, s * 0.08); g.closePath(); stroke(s * 0.035); g.beginPath(); g.arc(d * s * 0.52, s * 0.08, s * 0.2, 0, Math.PI); fill(); }); g.fillRect(-s * 0.25, s * 0.48, s * 0.5, s * 0.08); break;
      case 'triangle': g.beginPath(); g.moveTo(-s * 0.55, -s * 0.4); g.lineTo(s * 0.55, -s * 0.4); g.lineTo(0, s * 0.55); g.closePath(); stroke(s * 0.08); g.beginPath(); g.arc(0, -s * 0.05, s * 0.12, 0, 7); fill(); break;
      case 'scythe': g.fillRect(-s * 0.03, -s * 0.6, s * 0.07, s * 1.2); g.beginPath(); g.moveTo(0, -s * 0.55); g.quadraticCurveTo(-s * 0.7, -s * 0.6, -s * 0.62, -s * 0.05); g.quadraticCurveTo(-s * 0.45, -s * 0.42, 0, -s * 0.38); g.closePath(); fill(); break;
      case 'cup': g.beginPath(); g.moveTo(-s * 0.45, -s * 0.45); g.quadraticCurveTo(-s * 0.45, s * 0.12, 0, s * 0.15); g.quadraticCurveTo(s * 0.45, s * 0.12, s * 0.45, -s * 0.45); g.closePath(); fill(); g.fillRect(-s * 0.05, s * 0.12, s * 0.1, s * 0.32); g.fillRect(-s * 0.3, s * 0.42, s * 0.6, s * 0.08); break;
      case 'wand': g.rotate(0.5); g.fillRect(-s * 0.06, -s * 0.62, s * 0.12, s * 1.24); [-0.3, 0.05, 0.35].forEach((y, i) => { g.beginPath(); g.ellipse((i % 2 ? -1 : 1) * s * 0.14, s * y, s * 0.12, s * 0.05, (i % 2 ? 0.6 : -0.6), 0, 7); fill(); }); break;
      case 'sword': g.beginPath(); g.moveTo(0, -s * 0.68); g.lineTo(s * 0.08, -s * 0.5); g.lineTo(s * 0.06, s * 0.3); g.lineTo(-s * 0.06, s * 0.3); g.lineTo(-s * 0.08, -s * 0.5); g.closePath(); fill(); g.fillRect(-s * 0.32, s * 0.3, s * 0.64, s * 0.08); g.fillRect(-s * 0.05, s * 0.38, s * 0.1, s * 0.22); g.beginPath(); g.arc(0, s * 0.64, s * 0.07, 0, 7); fill(); break;
      case 'pentacle': g.beginPath(); g.arc(0, 0, s * 0.58, 0, 7); stroke(s * 0.07); star(g, 5, s * 0.52, s * 0.2); stroke(s * 0.05); break;
      case 'pentagramDown': g.rotate(Math.PI); star(g, 5, s * 0.6, s * 0.23); stroke(s * 0.06); g.beginPath(); g.arc(0, 0, s * 0.64, 0, 7); stroke(s * 0.04); break;
      case 'tower': g.fillRect(-s * 0.22, -s * 0.35, s * 0.44, s * 0.9); g.beginPath(); g.moveTo(-s * 0.3, -s * 0.35); g.lineTo(0, -s * 0.62); g.lineTo(s * 0.3, -s * 0.35); g.closePath(); fill(); g.fillStyle = INK; g.fillRect(-s * 0.06, -s * 0.15, s * 0.12, s * 0.2); g.strokeStyle = '#fff3c0'; g.beginPath(); g.moveTo(s * 0.62, -s * 0.7); g.lineTo(s * 0.3, -s * 0.3); g.lineTo(s * 0.45, -s * 0.28); g.lineTo(s * 0.18, s * 0.08); stroke(s * 0.05); break;
      case 'wreath': g.beginPath(); g.ellipse(0, 0, s * 0.42, s * 0.6, 0, 0, 7); stroke(s * 0.08); star(g, 4, s * 0.24, s * 0.07); fill(); break;
      default: star(g, 5, s * 0.6, s * 0.25); fill();
    }
    g.restore();
  }

  /** What to draw for a card (name, numeral, art). */
  function cardInfo(c) {
    const name = String(c && c.name || 'The Star');
    const mi = MAJOR.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    if (mi >= 0 || (c && c.arcana === 'major')) return { name, num: mi >= 0 ? ROMAN[mi] : '', art: mi >= 0 ? MAJOR_ART[mi] : 'star', major: true };
    const suit = (c && c.suit) || (name.match(/of (\w+)/) || [])[1] || 'Cups';
    const rank = name.split(' of ')[0];
    return { name, num: rank.toUpperCase(), art: SUIT_ART[suit] || 'star', major: false, suit };
  }

  /** A card face (W x H canvas, made once per pull). Upright art; a reversed card says so and its art is turned over. */
  function cardFace(c, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    const info = cardInfo(c), u = W / 100;
    // night sky
    let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3a1466'); gr.addColorStop(0.55, '#1d0838'); gr.addColorStop(1, '#2b0d4a');
    g.fillStyle = gr; rr(g, 0, 0, W, H, 7 * u); g.fill();
    // a soft halo behind the art
    gr = g.createRadialGradient(W / 2, H * 0.47, 2, W / 2, H * 0.47, W * 0.55); gr.addColorStop(0, 'rgba(255,214,130,.55)'); gr.addColorStop(0.5, 'rgba(190,110,255,.22)'); gr.addColorStop(1, 'rgba(120,40,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // little stars
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) { g.globalAlpha = 0.35 + rnd() * 0.5; g.fillStyle = '#fff3d6'; const x = rnd() * W, y = rnd() * H, z = 0.4 * u + rnd() * u; g.fillRect(x - z / 2, y - z / 2, z, z); }
    g.globalAlpha = 1;
    // gold frame (double line, corner stars)
    g.strokeStyle = GOLD; g.lineWidth = 2.6 * u; rr(g, 3 * u, 3 * u, W - 6 * u, H - 6 * u, 6 * u); g.stroke();
    g.strokeStyle = GOLD2; g.lineWidth = 0.9 * u; rr(g, 7.5 * u, 7.5 * u, W - 15 * u, H - 15 * u, 4 * u); g.stroke();
    g.fillStyle = GOLD; for (const [x, y] of [[11, 11], [W / u - 11, 11], [11, H / u - 11], [W / u - 11, H / u - 11]]) { g.save(); g.translate(x * u, y * u); star(g, 4, 3.2 * u, 0.9 * u); g.fill(); g.restore(); }
    // number on top
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = GOLD;
    g.font = `bold ${Math.round(11 * u)}px Georgia, 'Times New Roman', serif`; g.fillText(info.num || '✦', W / 2, 17 * u);
    // the art: gold with a glow
    g.save(); g.translate(W / 2, H * 0.47); if (c && c.reversed) g.rotate(Math.PI);
    g.shadowColor = 'rgba(255,200,110,.9)'; g.shadowBlur = 8 * u;
    gr = g.createLinearGradient(0, -30 * u, 0, 30 * u); gr.addColorStop(0, '#fff1c1'); gr.addColorStop(0.5, GOLD); gr.addColorStop(1, GOLD2);
    g.fillStyle = gr; g.strokeStyle = gr; art(g, info.art, 54 * u);
    g.restore();
    // name banner
    const by = H - 30 * u;
    g.fillStyle = '#f3e3bf'; rr(g, 9 * u, by - 9 * u, W - 18 * u, 21 * u, 3 * u); g.fill();
    g.strokeStyle = GOLD2; g.lineWidth = 0.8 * u; g.stroke();
    g.fillStyle = INK; const words = info.name.toUpperCase();
    let fs = 9.5 * u; g.font = `bold ${Math.round(fs)}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(words).width > W - 24 * u && fs > 5 * u) { fs -= 0.5 * u; g.font = `bold ${Math.round(fs)}px Georgia, 'Times New Roman', serif`; }
    g.fillText(words, W / 2, by + 1.5 * u);
    if (c && c.reversed) { g.fillStyle = '#ffb3c8'; g.font = `bold ${Math.round(6.5 * u)}px Georgia, serif`; g.fillText('REVERSED', W / 2, H - 41 * u); }
    return cv;
  }
  function cardBack(W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), u = W / 100;
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3b145f'); gr.addColorStop(1, '#1b0730');
    g.fillStyle = gr; rr(g, 0, 0, W, H, 7 * u); g.fill();
    g.strokeStyle = GOLD; g.lineWidth = 2.6 * u; rr(g, 3 * u, 3 * u, W - 6 * u, H - 6 * u, 6 * u); g.stroke();
    g.strokeStyle = GOLD2; g.lineWidth = 0.8 * u; for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(W / 2, H / 2, i * 11 * u, 0, 7); g.stroke(); }
    g.fillStyle = GOLD; g.save(); g.translate(W / 2, H / 2); star(g, 8, 9 * u, 3 * u); g.fill(); g.restore();
    g.save(); g.translate(W / 2, H * 0.2); art(g, 'moon', 20 * u); g.restore(); g.save(); g.translate(W / 2, H * 0.8); art(g, 'sun', 20 * u); g.restore();
    return cv;
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ---------------------------------------------------------------- crystal ball: swirling mist + brighter core
  function drawBall(g, t, bx, by, br, amt) {
    if (amt < 0.01) return;
    g.save();
    g.beginPath(); g.arc(bx, by, br * 0.93, 0, 7); g.clip();
    g.globalCompositeOperation = 'lighter';
    // mist: soft blobs orbiting the centre at different speeds and radii
    for (let i = 0; i < 5; i++) {
      const a = t * (0.9 + i * 0.23) * (i % 2 ? -1 : 1) + i * 1.7, r = br * (0.22 + 0.11 * i), x = bx + Math.cos(a) * r, y = by + Math.sin(a) * r * 0.75;
      const gr = g.createRadialGradient(x, y, 0, x, y, br * 0.55);
      gr.addColorStop(0, `rgba(${i % 2 ? '235,200,255' : '190,120,255'},${0.32 * amt})`); gr.addColorStop(1, 'rgba(150,70,255,0)');
      g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // swirl arms
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let j = 0; j <= 28; j++) { const u = j / 28, a = t * 1.6 + k * 2.09 + u * 4.2, r = br * (0.08 + 0.78 * u); g.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.8); }
      g.strokeStyle = `rgba(255,236,255,${0.22 * amt})`; g.lineWidth = br * 0.07; g.stroke();
      g.strokeStyle = `rgba(200,140,255,${0.18 * amt})`; g.lineWidth = br * 0.16; g.stroke();
    }
    // the core brightens
    const core = 0.5 + 0.5 * Math.sin(t * 3.1);
    const gr = g.createRadialGradient(bx, by + br * 0.15, 0, bx, by + br * 0.15, br * 0.7);
    gr.addColorStop(0, `rgba(255,240,255,${(0.35 + 0.2 * core) * amt})`); gr.addColorStop(1, 'rgba(200,120,255,0)');
    g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
    g.restore();
    // halo around the ball
    g.save(); g.globalCompositeOperation = 'lighter';
    const h = g.createRadialGradient(bx, by, br * 0.85, bx, by, br * 1.7);
    h.addColorStop(0, `rgba(210,150,255,${0.32 * amt})`); h.addColorStop(1, 'rgba(140,60,255,0)');
    g.fillStyle = h; g.fillRect(bx - br * 1.8, by - br * 1.8, br * 3.6, br * 3.6);
    g.restore();
  }

  // ---------------------------------------------------------------- card pulls
  /**
   * Cards(opts): opts.W / H card size, opts.layout(n) -> [{x, y, rot, scale}] where the cards stand, opts.deck [x, y]
   * show(cards, now, { delay, hold }): pull up to 3 cards; draw(g, now) each frame; reach(now) -> how far her hand
   * reaches for the deck (0..1) and the deck position, for a rig that animates a hand.
   */
  function Cards(opts) {
    const W = opts.W || 120, H = opts.H || 200;
    let list = null, back = null, deckUntil = -1, deckFrom = 0;
    return {
      get active() { return !!list; },
      show(cards, now, o = {}) {
        const cs = (cards || []).slice(0, 3); if (!cs.length) return;
        this.clear();
        const spots = opts.layout(cs.length), delay = o.delay ?? 0.4, hold = Math.max(4, o.hold ?? 7);
        back = back || cardBack(W, H);
        deckFrom = now + delay - 0.6;
        list = cs.map((c, i) => {
          const t0 = now + delay + 0.6 + i * 0.85;
          return { face: cardFace(c, W, H), spot: spots[i], t0, end: Math.max(t0 + 3.2, now + delay + hold + i * 0.4) };
        });
        deckUntil = list[list.length - 1].t0 + 1.2;
      },
      clear() { if (list) for (const c of list) c.face.width = 1; list = null; },
      /** 0..1: her hand going out to the deck just before each card slides out. */
      reach(now) {
        if (!list) return 0;
        let r = 0;
        for (const c of list) { const u = now - (c.t0 - 0.6); if (u > 0 && u < 1.2) r = Math.max(r, Math.sin(Math.PI * clamp(u / 1.2, 0, 1))); }
        return r;
      },
      deck: opts.deck,
      draw(g, now) {
        if (!list) return;
        let alive = false;
        // the deck on the table (a few stacked backs), while cards are being pulled
        const dk = opts.deck, da = clamp((now - deckFrom) / 0.4, 0, 1) * (1 - clamp((now - deckUntil) / 0.6, 0, 1));
        if (dk && da > 0.01) {
          g.save(); g.globalAlpha = da; const s = 0.42;
          for (let i = 0; i < 4; i++) { g.save(); g.translate(dk[0] + i * 1.2, dk[1] - i * 2.2); g.rotate(-0.25); g.scale(s, s * 0.55); g.drawImage(back, -W / 2, -H / 2, W, H); g.restore(); }
          g.restore();
        }
        for (const c of list) {
          const u = now - c.t0;
          if (u < 0) { alive = true; continue; }
          if (now > c.end + 0.7) continue;
          alive = true;
          const sp = c.spot, slide = ease(clamp(u / 0.7, 0, 1)), flip = clamp((u - 0.7) / 0.55, 0, 1);
          const fade = 1 - clamp((now - c.end) / 0.7, 0, 1);
          // slide from the deck (small, tilted, on the table) up to its place, along a little arc
          const x0 = dk ? dk[0] : sp.x, y0 = dk ? dk[1] : sp.y + 40;
          const x = x0 + (sp.x - x0) * slide, y = y0 + (sp.y - y0) * slide - Math.sin(Math.PI * slide) * 30 + (u > 1.3 ? 4 * Math.sin((u - 1.3) * 1.5) : 0);
          const sc = (0.42 + (1 - 0.42) * slide) * (sp.scale || 1), rot = -0.25 * (1 - slide) + (sp.rot || 0) * slide;
          const sx = Math.max(0.03, Math.abs(Math.cos(Math.PI * flip))), face = flip > 0.5 ? c.face : back;
          g.save(); g.globalAlpha = Math.min(1, 0.3 + slide) * fade; g.translate(x, y); g.rotate(rot); g.scale(sc * sx, sc);
          // glow behind the card
          g.save(); g.globalCompositeOperation = 'lighter'; const gl = g.createRadialGradient(0, 0, W * 0.2, 0, 0, W * 0.95);
          gl.addColorStop(0, `rgba(255,205,120,${0.35 * (flip > 0.5 ? 1 : 0.4)})`); gl.addColorStop(1, 'rgba(180,90,255,0)'); g.fillStyle = gl; g.fillRect(-W, -H * 0.8, W * 2, H * 1.6); g.restore();
          g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-W / 2 + 5, -H / 2 + 7, W, H);
          g.drawImage(face, -W / 2, -H / 2, W, H);
          // a gold flash as it turns over
          if (flip > 0.45 && flip < 1) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - flip) * 1.4 * fade; g.fillStyle = '#ffd98a'; g.fillRect(-W / 2, -H / 2, W, H); }
          g.restore();
        }
        if (!alive) this.clear();
      },
      memory() { return (list ? list.length : 0) * W * H * 4 + (back ? W * H * 4 : 0); },
      destroy() { this.clear(); if (back) back.width = 1; back = null; },
    };
  }

  root.MiraFX = { cardFace, cardBack, cardInfo, drawBall, Cards, art };
})(window);
