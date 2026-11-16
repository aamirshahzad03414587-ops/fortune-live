import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadConfig, saveConfig, ROOT } from './config.js';
import { Store } from './store.js';
import { LiveEngine } from './live.js';
import { TikTokBridge } from './tiktok.js';
import { PhoneBridge } from './bridge.js';
import { computeReading, parseDate } from './numerology.js';
import { diagRoute } from './diag.js';
import { TTS, VOICE_CHOICES } from './tts.js';
import { llmReply, spokenName } from './chat.js';

let config = loadConfig();
const store = new Store(process.env.DATA_FILE || path.join(ROOT, 'data', 'submissions.json'));
const tts = new TTS(() => config.voice);
const live = new LiveEngine({ config, store, tts });
live.on('log', (m) => console.log('[mira]', m));
const tiktok = new TikTokBridge(live);
const phoneBridge = new PhoneBridge();
const configureTikTok = () => tiktok.configure({ liveSource: config.tiktok.liveSource, username: config.tiktok.username, signApiKey: config.tiktok.signApiKey || '', retrySeconds: config.tiktok.retrySeconds });
configureTikTok();
setInterval(() => { const n = store.purgeExpired(); if (n) console.log(`[data] auto-deleted ${n} expired submission(s)`); }, 5 * 60e3).unref();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '20kb' }));

// ---------- access control for the streamer-only pages ----------
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
function keyOk(req) {
  if (config.adminKey) return (req.query.key || req.headers['x-admin-key']) === config.adminKey;
  return isLocal(req); // no key set => only this computer may open admin/overlay
}
function requireKey(req, res, next) {
  if (keyOk(req)) return next();
  res.status(401).send('Admin key required. Add ?key=YOUR_ADMIN_KEY to the URL (set "adminKey" in config.json).');
}

// ---------- public pages ----------
const pub = path.join(ROOT, 'public');
// readings now happen in the TikTok comments; the old private form + codes only run with readings.privateForm = true
const formOn = () => !!live.readingsCfg.privateForm;
const formOnly = (req, res, next) => (formOn() ? next() : res.status(404).json({ error: 'The private form is turned off. Comment your name and birth date on the LIVE instead.' }));
app.get('/', (req, res) => res.sendFile(path.join(pub, formOn() ? 'form.html' : 'home.html')));
app.get('/r/:token', formOnly, (req, res) => res.sendFile(path.join(pub, 'report.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(pub, 'overlay.html')));
app.get('/admin', requireKey, (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.post('/diag', express.text({ type: '*/*', limit: '8kb' }), diagRoute());
app.get('/healthz', (req, res) => res.json({ ok: true, tiktok: tiktok.status.state }));
app.get('/tts/:id.mp3', (req, res) => {
  const buf = tts.get(req.params.id);
  if (!buf) return res.status(404).end();
  res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'content-length': buf.length });
  res.end(buf);
});
app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: 0, etag: true }));
app.use(express.static(pub, { index: false }));

app.get('/api/public-config', (req, res) => res.json({
  trigger: config.trigger, tiers: config.tiers.map(({ name, minDiamonds, level }) => ({ name, minDiamonds, level })),
  retentionHours: config.data.retentionHours, maxRetentionHours: config.data.maxRetentionHoursIfUserOptsOut, title: config.overlay.title,
}));

const ipHits = new Map();
app.post('/api/submit', formOnly, (req, res) => {
  const ip = req.ip || 'x'; const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => t > now - 3600e3);
  if (hits.length >= config.limits.maxSubmissionsPerIpPerHour) return res.status(429).json({ error: 'Too many requests from this device. Please try again later.' });
  const b = req.body || {};
  if (!b.consent) return res.status(400).json({ error: 'Please tick the consent box.' });
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const input = { fullName: s(b.fullName, 80), dob: s(b.dob, 10), motherName: s(b.motherName, 80), fatherName: s(b.fatherName, 80), question: s(b.question, 140) };
  try { parseDate(input.dob); computeReading(input); } catch (e) { return res.status(400).json({ error: e.message }); }
  const hours = b.autoDelete === false ? config.data.maxRetentionHoursIfUserOptsOut : config.data.retentionHours;
  const rec = store.create(input, hours);
  hits.push(now); ipHits.set(ip, hits);
  res.json({ code: rec.code, token: rec.token, reportUrl: `/r/${rec.token}`, expiresAt: rec.expiresAt });
});

app.get('/api/report/:token', formOnly, (req, res) => {
  const rec = store.byToken(req.params.token);
  if (!rec) return res.status(404).json({ error: 'This report has expired or was deleted.' });
  res.json({ code: rec.code, expiresAt: rec.expiresAt, used: rec.uses > 0, reading: computeReading({ ...rec.input, year: 2026 }) });
});
app.delete('/api/report/:token', (req, res) => res.json({ deleted: store.delete(req.params.token) }));

// ---------- admin API ----------
const admin = express.Router();
admin.use(requireKey);
const MASK = '••••••••';
const publicCfg = () => ({ ...config, llm: { ...config.llm, apiKey: config.llm.apiKey ? MASK : '' } });
admin.get('/state', (req, res) => res.json({ config: publicCfg(), tiktok: tiktok.status, live: { ...live.snapshot(), queue: pubQueue(live.queue) }, submissions: store.count(), voices: VOICE_CHOICES, ttsError: tts.lastError }));
admin.post('/config', (req, res) => {
  try {
    const next = req.body;
    if (!next || typeof next !== 'object' || !Array.isArray(next.tiers)) throw new Error('Invalid config');
    if (next.llm && next.llm.apiKey === MASK) next.llm.apiKey = config.llm.apiKey;
    const before = tiktok.usesDirect;
    saveConfig(next); config = loadConfig(); live.config = config; configureTikTok();
    if (tiktok.usesDirect && !before && tiktok.username) tiktok.connect().catch(() => {});
    if (!tiktok.usesDirect && before) tiktok.disconnect().catch(() => {});
    broadcastState();
    res.json({ ok: true, config: publicCfg() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
admin.post('/connect', async (req, res) => {
  try { await tiktok.connect(req.body?.username); res.json(tiktok.status); }
  catch (e) { res.status(400).json({ error: e.message, tiktok: tiktok.status }); }
});
admin.post('/disconnect', async (req, res) => { await tiktok.disconnect(); res.json(tiktok.status); });
admin.post('/new-stream', (req, res) => { live.newStream(); res.json({ ok: true }); });
admin.post('/skip', (req, res) => { live.skip(); res.json({ ok: true }); });
admin.post('/clear', (req, res) => { live.clearQueue(); res.json({ ok: true }); });
admin.post('/pause', (req, res) => { live.setPaused(!!req.body.paused); broadcastState(); res.json({ paused: live.paused }); });
admin.post('/delete-all-data', (req, res) => res.json({ deleted: store.deleteAll() }));

// Simulator: fake TikTok events so you can test without going live
admin.post('/sim/gift', (req, res) => {
  const { userId = 'sim_' + (req.body.nickname || 'viewer'), nickname = 'Viewer', giftName = 'Rose', diamonds = 1 } = req.body;
  res.json(live.handleGift({ userId, nickname, giftName, diamonds: Number(diamonds) }));
});
admin.post('/sim/chat', (req, res) => {
  const { userId = 'sim_' + (req.body.nickname || 'viewer'), nickname = 'Viewer', comment = '' } = req.body;
  res.json(live.handleChat({ userId, nickname, comment }));
});
admin.post('/sim/comment', (req, res) => {
  const { nickname = 'Viewer', comment = '', isFollower = false } = req.body;
  res.json(live.handleChat({ userId: req.body.userId || 'sim_' + nickname, nickname, comment, isFollower: !!isFollower }));
});
admin.post('/say', (req, res) => { live.sayNow(String(req.body.text || 'Hello my dears, I am Mystic Mira.').slice(0, 400)); res.json({ ok: true }); });
admin.post('/test-llm', async (req, res) => {
  // goes through the same request gate as the live chat (free providers allow ~1 request / 45 s): if the slot is
  // taken, answer 429 with retryAfter instead of hitting the provider
  const t = Date.now();
  try {
    const b = req.body || {}, L = { ...config.llm, enabled: true };
    for (const k of ['baseUrl', 'model', 'apiKey']) if (b[k]) L[k] = b[k];
    if (L.apiKey === MASK) L.apiKey = config.llm.apiKey;
    const nickname = String(b.nickname || 'Tester').slice(0, 40), comment = String(b.comment || 'Hi Mira, will I be lucky this year?').slice(0, 200);
    const r = await live.ai.ask(L, { comment, name: spokenName(nickname), cacheable: false },
      () => llmReply(L, { nickname, comment, liveReadings: !!live.readingsCfg.fromComments }));
    res.json({ ok: true, text: r.text, ms: Date.now() - t, provider: L.provider || L.baseUrl, model: L.model });
  } catch (e) {
    const retryAfter = e.refused ? Math.ceil(live.ai.wait()) : e.retryAfter;
    res.status(e.refused ? 429 : 400).json({ error: e.message, retryAfter, ms: Date.now() - t });
  }
});
admin.post('/test-tts', async (req, res) => { const r = await tts.synth(req.body.text || 'Hello, I am Mystic Mira.'); res.json(r ? { ok: true, ...r } : { ok: false, error: tts.lastError || 'TTS disabled' }); });
admin.post('/sim/like', (req, res) => { live.handleLike({ nickname: req.body.nickname || 'Viewer', count: Number(req.body.count || 10) }); res.json({ ok: true }); });
admin.post('/sim/follow', (req, res) => { live.handleFollow({ userId: req.body.userId || 'sim_' + (req.body.nickname || 'viewer'), nickname: req.body.nickname || 'Viewer' }); res.json({ ok: true }); });
admin.post('/sim/join', (req, res) => { const n = String(req.body.nickname || 'Viewer').slice(0, 40); res.json(live.handleJoin({ userId: req.body.userId || 'sim:' + n, nickname: n })); });
admin.post('/sim/submission', (req, res) => {
  // creates a demo form submission and returns its code
  const rec = store.create({ fullName: req.body.fullName || 'Ayesha Khan', dob: req.body.dob || '1998-07-23', motherName: req.body.motherName || '', fatherName: req.body.fatherName || '', question: req.body.question || 'Will I find love this year?' }, config.data.retentionHours);
  res.json({ code: rec.code, reportUrl: `/r/${rec.token}` });
});
app.use('/api/admin', admin);

// ---------- WebSocket to overlay + admin ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const fakeReq = { query: Object.fromEntries(url.searchParams), headers: req.headers, socket: req.socket };
  if (phoneBridge.handleUpgrade(req, socket, head, url)) return; // fight-game phone mode: /tt?u=username
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  void fakeReq; // overlay + its socket are public (no key needed); admin pages/API still require the key
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (msg) => { const s = JSON.stringify(msg); wss.clients.forEach((c) => c.readyState === 1 && c.send(s)); };
function statePayload() { return { type: 'state', overlay: config.overlay, voice: { browserLang: config.voice.browserLang, enabled: config.voice.enabled }, trigger: config.trigger, tiers: config.tiers, publicUrl: config.publicUrl, readings: live.readingsCfg, tiktok: tiktok.status, ...live.snapshot(), queue: pubQueue(live.queue) }; }
function broadcastState() { broadcast(statePayload()); }
// Only ONE open overlay plays Mira's voice (e.g. LIVE Studio on the PC + a preview on a phone would otherwise talk twice,
// and TikTok hears both). Pick: ?primary=1 first, then desktop over phone, then the one opened first. The others stay silent
// (her lips still move). Re-elected when an overlay opens or closes.
let overlaySeq = 0, voiceWs = null;
function electVoice() {
  const all = [...wss.clients].filter((c) => c.overlay && c.readyState === 1);
  const rank = (c) => [c.overlay.audio ? 0 : 1, c.overlay.primary ? 0 : 1, c.overlay.mobile ? 1 : 0, c.overlay.seq];
  const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const best = all.sort(cmp)[0] || null;
  const winner = best && best.overlay.audio ? best : null;
  for (const c of all) { const you = c === winner; if (c.overlay.you !== you) { c.overlay.you = you; send(c, { type: 'audioOwner', you, overlays: all.length }); } }
  voiceWs = winner;
}
wss.on('connection', (ws) => {
  send(ws, statePayload());
  if (live.current) send(ws, live.current.kind === 'reading' ? { type: 'reveal', item: live.current } : { type: 'say', item: live.current });
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'revealDone' && live.current && m.id === live.current.id) { /* timer-driven; ignore */ }
      else if (m.type === 'hello' && m.role === 'overlay') { ws.overlay = { audio: m.audio !== false, primary: !!m.primary, mobile: !!m.mobile, at: Date.now(), seq: ++overlaySeq }; electVoice(); }
      else if (m.type === 'tikfinityStatus') {
        ws.fromTikFinity = true;
        const state = m.state === 'live' ? 'connected' : (m.state || 'connecting');
        tiktok.setStatus(state, m.message || '', { username: m.username || tiktok.status.username || '' });
      } else if (m.type === 'tikfinity') {
        ws.fromTikFinity = true;
        tiktok.ingest(m.event);
      }
    } catch {}
  });
  ws.on('close', () => {
    if (ws.overlay) electVoice();
    if (!ws.fromTikFinity) return;
    const still = [...wss.clients].some((c) => c !== ws && c.fromTikFinity && c.readyState === 1);
    if (!still && tiktok.tikfinity.state !== 'waiting') {
      tiktok.setStatus('waiting', 'Open the overlay on the streaming PC with TikFinity running (ws://127.0.0.1:21213/)');
    }
  });
});
live.on('reveal', (item) => broadcast({ type: 'reveal', item }));
live.on('say', (item) => broadcast({ type: 'say', item }));
live.on('skip', (item) => broadcast({ type: 'skip', id: item.id }));
live.on('chatQueue', (q) => broadcast({ type: 'chatQueue', chatQueue: q.map(({ id, nickname, comment }) => ({ id, nickname, comment })) }));
const pubQueue = (q) => q.map(({ reading, parsed, ...i }) => i);
live.on('queue', (queue) => broadcast({ type: 'queue', queue: pubQueue(queue) }));
live.on('idle', () => broadcast({ type: 'idle' }));
live.on('toast', (t) => broadcast({ type: 'toast', ...t }));
live.on('gift', (g) => broadcast({ type: 'gift', nickname: g.nickname, giftName: g.giftName, diamonds: g.diamonds }));
live.on('like', (l) => broadcast({ type: 'like', nickname: l.nickname, count: l.count }));
live.on('follow', (f) => broadcast({ type: 'follow', nickname: f.nickname }));
tiktok.on('status', () => broadcastState());
tiktok.on('log', (m) => console.log(m));

server.listen(config.port, () => {
  const base = `http://localhost:${config.port}`;
  const k = config.adminKey ? '?key=<ADMIN_KEY>' : '';
  console.log('\n🔮  Fortune Live is running');
  console.log(`   Viewer form (put this link in bio): ${config.publicUrl || base}/`);
  console.log(`   OBS overlay vertical 1080x1920:   ${base}/overlay`);
  console.log(`   OBS overlay landscape 1920x1080:  ${base}/overlay?layout=landscape`);
  console.log(`   Control panel + simulator:        ${base}/admin${k}`);
  if (!config.adminKey) console.log('   (No adminKey set: overlay and admin only open on this PC. Set "adminKey" in config.json before hosting online.)');
  console.log(`   LIVE source: ${tiktok.source}${tiktok.usesDirect ? ` (server reads @${tiktok.username || '?'} directly${tiktok.signApiKey ? ', signed' : ''})` : ''}${tiktok.usesTikFinity ? ' + TikFinity desktop app via the overlay' : ''}`);
  console.log('   Fight-game phone mode (server-side TikTok connection):  ' + base + '/tt?u=USERNAME');
  console.log('');
  if (tiktok.usesDirect && tiktok.username) tiktok.connect().catch((e) => console.log('[tiktok]', e.message));
});
