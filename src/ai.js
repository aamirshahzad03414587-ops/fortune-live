// "Answer anything": free keyless AI for Mira's chat replies, with a request gate and a per-viewer memory.
//  * PROVIDERS: presets chosen with LLM_PROVIDER (pollinations = the free, keyless, OpenAI-compatible Pollinations
//    "classic" text API: one reply per ~45 s per server IP, 5-20 s per reply, best effort).
//  * AiGate: at most one request in flight, a minimum gap between requests (and the provider's Retry-After after a
//    402 / 429), a short cache for repeated questions. Whatever the gate refuses gets the built-in replies instead,
//    so Mira never goes silent.
//  * Memory: per viewer, for one stream: the last exchanges and a few known facts (name, birth date, zodiac, topic,
//    language), whether Mira just asked them something (their next comment continues the thread), turn counters
//    for fairness. Capped in size and cleared on every new stream.
import { normalizeComment, extractBirthDate, detectLanguage, spokenName, quickNumbers } from './chat.js';

export const PROVIDERS = {
  pollinations: { baseUrl: 'https://text.pollinations.ai/openai', model: 'openai', noKey: true, minIntervalSeconds: 45, reasoningEffort: 'low', maxTokens: 0, timeoutMs: 8000 },
};

/** Is the AI usable with this config? (a key, or a keyless provider) */
export const llmReady = (L = {}) => !!(L.enabled && L.baseUrl && L.model && (L.apiKey || L.noKey));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (comment) => normalizeComment(comment).toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

export class AiGate {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.nextAt = 0; this.inFlight = 0; this.cache = new Map(); this.stats = { asked: 0, ok: 0, cached: 0, refused: 0, failed: 0, ms: [] }; }
  minGapMs(L) { return Math.max(3, Number(L.minIntervalSeconds ?? 3)) * 1000; }
  /** Would a request be sent right now? */
  open() { return this.inFlight === 0 && this.now() >= this.nextAt; }
  /** Seconds until the next request may go out. */
  wait() { return Math.max(0, (this.nextAt - this.now()) / 1000); }
  cached(comment, cacheSeconds = 300) {
    const k = keyOf(comment), c = this.cache.get(k);
    if (c && this.now() - c.at < cacheSeconds * 1000) return c.body;
    return null;
  }
  /**
   * fn() makes the request. Returns { text, cached } or throws (refused: gate closed / provider error).
   * cacheable: only answers that don't depend on the conversation (no history) are cached, keyed by the comment text,
   * stored without the viewer's name and re-personalised for whoever asks next.
   */
  async ask(L, { comment, name, cacheable }, fn) {
    if (cacheable) { const body = this.cached(comment, L.cacheSeconds ?? 300); if (body) { this.stats.cached++; return { text: withName(name, body), cached: true }; } }
    if (!this.open()) { this.stats.refused++; const e = new Error(`AI busy (next slot in ${Math.ceil(this.wait())} s)`); e.refused = true; throw e; }
    this.inFlight++; this.stats.asked++; this.nextAt = this.now() + this.minGapMs(L);
    const t0 = this.now();
    try {
      const text = await fn();
      this.stats.ok++; this.stats.ms.push(this.now() - t0); if (this.stats.ms.length > 50) this.stats.ms.shift();
      if (cacheable) { this.cache.set(keyOf(comment), { body: stripName(name, text), at: this.now() }); if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value); }
      return { text: withName(name, text), cached: false };
    } catch (e) {
      this.stats.failed++;
      if (e.retryAfter) this.nextAt = Math.max(this.nextAt, this.now() + e.retryAfter * 1000 + 1000);   // the provider said when
      throw e;
    } finally { this.inFlight--; }
  }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "Ali, ..." -> "..." (so a cached answer can be given to someone else) */
export function stripName(name, text) { return String(text).replace(new RegExp('^\\s*(?:(?:oh|ah|dear|hey|hi|hello)\\s+)?' + esc(name) + '\\s*[,!.:]?\\s*', 'i'), '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()); }
/** Her answer starts with the viewer's name (added if the model forgot; kept if it is already in the first words). */
export function withName(name, text) {
  const t = String(text).trim();
  if (!name || new RegExp(esc(name), 'i').test(t.split(/\s+/).slice(0, 4).join(' '))) return t;
  // written in another script (Urdu, Hindi, Arabic ...): the model wrote their name its own way - leave it
  if (/^[^\p{Script=Latin}]*[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Thai}]/u.test(t)) return t;
  const keep = /^(I|I'm|I'll|I've|I'd)\b/.test(t) || /^\p{Lu}{2}/u.test(t);
  return `${name}, ${keep ? t : t.charAt(0).toLowerCase() + t.slice(1)}`;
}

// ---------------------------------------------------------------- per-viewer memory
const ZODIAC = [['Capricorn', 1, 19], ['Aquarius', 2, 18], ['Pisces', 3, 20], ['Aries', 4, 19], ['Taurus', 5, 20], ['Gemini', 6, 20], ['Cancer', 7, 22], ['Leo', 8, 22], ['Virgo', 9, 22], ['Libra', 10, 22], ['Scorpio', 11, 21], ['Sagittarius', 12, 21], ['Capricorn', 12, 31]];
export function zodiacOf(day, month) { for (const [z, m, d] of ZODIAC) if (month < m || (month === m && day <= d)) return z; return 'Capricorn'; }
const TOPICS = [['love', /\b(love|crush|marr|shaadi|shadi|pyar|pyaar|ishq|relationship|boyfriend|girlfriend|partner|rishta|mohabbat)|محبت|شادی|प्यार|शादी|حب/iu],
  ['career', /\b(job|career|work|naukri|business|boss|promotion|interview|kaam)|نوکری|نौकरी|عمل/iu], ['money', /\b(money|paisa|paise|rich|salary|loan|debt|lottery)|پیسہ|पैसा|مال/iu],
  ['study', /\b(exam|study|studies|school|college|university|result|padhai)|امتحان|परीक्षा/iu], ['travel', /\b(travel|abroad|visa|trip|bahar|move to)|سفر|यात्रा/iu],
  ['health', /\b(health|sick|doctor|sehat)|صحت|सेहत/iu], ['family', /\b(family|mother|father|mom|dad|ammi|abbu|bhai|sister|brother)|خاندان|परिवार/iu]];
export const topicOf = (t) => (TOPICS.find(([, re]) => re.test(t)) || [null])[0];
export function langOf(t) {
  if (/[\u0600-\u06FF]/.test(t)) return /[پچژگکیۓےٹڈڑں]/.test(t) ? 'Urdu (Urdu script)' : 'Arabic';
  if (/[\u0900-\u097F]/.test(t)) return 'Hindi (Devanagari)';
  const l = detectLanguage(t);
  return l === 'roman-ur' ? 'Roman Urdu / Hindi' : null;   // Latin script: the model can tell English from Spanish itself
}

export class Memory {
  constructor({ now = () => Date.now(), maxViewers = 300, maxTurns = 12 } = {}) { this.now = now; this.maxViewers = maxViewers; this.maxTurns = maxTurns; this.v = new Map(); }
  clear() { this.v.clear(); }
  get(userId, nickname) {
    let m = this.v.get(userId);
    if (!m) {
      m = { userId, name: spokenName(nickname), turns: [], facts: {}, askedAt: null, lastSeen: this.now(), engagedAt: 0, chats: 0 };
      this.v.set(userId, m);
      if (this.v.size > this.maxViewers) { const oldest = [...this.v.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]; this.v.delete(oldest.userId); }
    }
    if (nickname) m.name = spokenName(nickname);
    m.lastSeen = this.now();
    return m;
  }
  has(userId) { return this.v.has(userId); }
  /** { day, month, year|null } -> facts: dob, zodiac, Personal Year, Life Path (with a year) */
  setDob(userId, d) {
    const m = this.v.get(userId); if (!m || !d?.day) return;
    const f = m.facts; f.dob = `${d.day}/${d.month}${d.year ? '/' + d.year : ''}`; f.zodiac = zodiacOf(d.day, d.month);
    const n = quickNumbers(d); f.personalYear = n.personalYear; if (n.lifePath) f.lifePath = n.lifePath; else delete f.lifePath;
  }
  /** Learn what we can from a comment: birth date (+ zodiac, numbers), topic, language. */
  learn(userId, nickname, text) {
    const m = this.get(userId, nickname), f = m.facts, d = extractBirthDate(text);
    if (d) this.setDob(userId, d);
    const tp = topicOf(text); if (tp) f.topic = tp;
    const lg = langOf(text); if (lg) f.lang = lg; else if (/[a-z]/i.test(text) && text.split(/\s+/).length >= 3) f.lang = null;
    m.chats++;
    return m;
  }
  /** One turn: role 'user' (viewer) or 'assistant' (Mira). Mira ending on a question = she waits for their answer. */
  add(userId, role, text) {
    const m = this.v.get(userId); if (!m) return;
    m.turns.push({ role, content: String(text).slice(0, 300), at: this.now() });
    if (m.turns.length > this.maxTurns) m.turns.splice(0, m.turns.length - this.maxTurns);
    if (role === 'assistant') m.askedAt = /[?؟]\s*$/.test(String(text).trim()) ? this.now() : null;
  }
  /** Is this comment the viewer's answer to Mira's question? (she asked them within the last `withinSeconds`) */
  awaiting(userId, withinSeconds = 180) { const m = this.v.get(userId); return !!(m && m.askedAt != null && this.now() - m.askedAt < withinSeconds * 1000); }
  history(userId) { const m = this.v.get(userId); return m ? m.turns.map(({ role, content }) => ({ role, content })) : []; }
  /** Facts for the prompt: "What you know about Sara: born 12/5/1998 (Taurus, Life Path 8), interested in love, writes in Urdu." */
  context(userId) {
    const m = this.v.get(userId); if (!m) return '';
    const f = m.facts, bits = [];
    if (f.dob) bits.push(`born ${f.dob} (${f.zodiac}${f.lifePath ? `, Life Path ${f.lifePath}` : ''}, Personal Year ${f.personalYear} in 2026)`);
    else bits.push('birth date unknown');
    if (f.reading) bits.push(`already had a numerology reading tonight`);
    if (f.topic) bits.push(`talking about ${f.topic}`);
    if (f.lang) bits.push(`writes in ${f.lang}, so answer in that`);
    if (this.awaiting(userId)) bits.push('this comment answers the question you just asked them, so continue that thread');
    return `What you know about ${m.name}: ${bits.join('; ')}.\n`;
  }
  /** Someone who chatted recently and was not engaged by Mira for a while (for "engage the chat" lines). */
  activeChatter(withinSeconds = 180, quietSeconds = 300) {
    const t = this.now();
    return [...this.v.values()].filter((m) => m.chats && t - m.lastSeen < withinSeconds * 1000 && t - (m.engagedAt || 0) > quietSeconds * 1000 && !this.awaiting(m.userId))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0] || null;
  }
}

/** Short lines where Mira turns to an active chatter with a question (no AI needed). */
export const ENGAGE_T = [
  "{name}, I see you in the chat tonight. Tell me, is your heart asking about love or career?",
  "{name}, the crystal ball keeps glowing when you comment. What would you like to know?",
  "{name}, you have a curious energy tonight. Shall I look at love, money or travel for you?",
  "{name}, I have not read your numbers yet. What is your birth date, my dear?",
  "{name}, tell me, what made you smile today?",
  "{name}, if the stars could answer one question for you tonight, what would it be?",
];
export const ENGAGE_DOB_T = [
  "{name}, I know you are a {zodiac}. Do you want to hear what 2026 holds for your love life or your work?",
  "{name}, a {zodiac} with Personal Year {py} in 2026. Shall I tell you about love, or about money?",
];
export { sleep };
