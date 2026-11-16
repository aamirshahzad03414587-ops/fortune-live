// Live "director": gift credits, code matching, limits, and ONE speaking queue for Mira.
// Priority: fortune readings > greetings (gifters/followers) > chat replies > idle prompts.
// Events: 'reveal' (reading), 'say' (reply/greet/prompt), 'queue', 'chatQueue', 'toast', 'gift', 'like', 'follow', 'idle', 'skip'
import { EventEmitter } from 'node:events';
import { computeReading, liveReading } from './numerology.js';
import { answerMystic, mysticSnippets, COMMAND_PROMPTS } from './kb/index.js';
import { AiGate, Memory, llmReady, ENGAGE_T, ENGAGE_DOB_T } from './ai.js';
import { ReplyEngine, filterComment, llmReply, llmComplete, detectLanguage, cleanSpoken, normalizeComment, isSelfHarm, isQuestion, withQuestion, welcomeNames, spokenName, extractBirthDate } from './chat.js';
import { parseReadingComment, readingScript, showDate, partialScript, parsedWithDate } from './comment-reading.js';
import { looksLikeDateAttempt, resolveDateAnswer, readAiDate, AI_DATE_PROMPT, MONTH_NAMES, ord } from './dates.js';
import { FILLER_T, FILLER_UR_T, GROUP_T, ALREADY_READ_T, SESSION_END_T, unclearKind, clarifyLine, sessionLine, numbersPhrase, fill } from './talk.js';
import { withName } from './ai.js';
import { Variety, WELCOME_T, WELCOME_ONE_T, HOWTO_T, HOWTO_SHORT_T, EXAMPLE_DATES, IDLE_T } from './variety.js';

export const CODE_RE = /(?:^|[^A-Z0-9])#?([A-HJ-NP-Z]\d{2,4})(?![0-9])/gi;
export function extractCodes(comment) {
  const out = [];
  for (const m of String(comment || '').matchAll(CODE_RE)) out.push(m[1].toUpperCase());
  return out;
}

// Every comment gets an answer: no per-viewer cooldown; a viewer's new comments are merged into their waiting one;
// when the queue is full the rest wait in a backlog (overflowMax), and comments that waited longer than
// maxCommentAgeSeconds are answered together, by name, in one group line (groupMaxNames per line). While her real
// answer (AI + voice) takes longer than fillerAfterMs she says a short "thinking" line first (thinkingFiller).
const CHAT_DEFAULTS = { enabled: true, mode: 'everyone', maxQueue: 12, maxCommentAgeSeconds: 150, secondsBetweenReplies: 1,
  overflowMax: 300, groupMaxNames: 6, mergeMax: 3, thinkingFiller: true, fillerAfterMs: 900, aiMaxBacklog: 4, voiceMaxWaitMs: 14000,
  idlePromptSeconds: 35, idlePrompts: [], greetGifters: true, greetFollowers: true, greetCooldownSeconds: 8, maxReplyWords: 45,
  // conversations: a viewer answering Mira's question (within followUpSeconds) skips the cooldown and continues the
  // thread; nobody gets more than maxConsecutiveTurns replies in a row while others wait; when quiet, Mira sometimes
  // (engageChance) turns to an active chatter by name with a question.
  followUpSeconds: 180, maxConsecutiveTurns: 2, engageChance: 0.4,
  // viewers joining the LIVE: everyone is welcomed BY NAME with a short "how to get a reading". Batched ("Welcome Sara,
  // Ali and Zoya!"), at most joinMaxNames names per welcome (the rest wait for the next one, nobody is dropped), at most
  // one welcome every joinGreetSeconds. Readings go first, but while readings are queued a welcome slips in between them.
  welcomeJoins: true, joinGreetSeconds: 10, joinBatchSeconds: 2.5, joinMaxNames: 6, readQuestionAloud: true };
// Readings straight from TikTok comments ("Sara 12/05/1998 will I travel?"). No form, no codes.
// requireGift=false: everyone who comments a birth date gets one; gifters jump ahead (bigger gift = higher tier).
// yearOptional: day + month alone still gets a (Birthday + Personal Year) reading. askAmbiguous: for 05/12/1998 ask
// "5 December or 12 May?" instead of reading it day-first. aiDates: messy dates the rules can't read go to the AI.
// sessionReplies: after her reading, that viewer's next N comments are answered first, as follow-ups about it.
export const READINGS_DEFAULTS = { sessionReplies: 2, yearOptional: true, askAmbiguous: false, aiDates: true, fromComments: true, requireGift: false, perViewerPerStream: 1, maxQueue: 10, giftPriority: true,
  freeTierName: 'Live prediction', freeSeconds: 18, howToEverySeconds: 75, privateForm: false };
const VOICE_DEFAULTS = { readingSpeechStart: 3, talkSpeechStart: 0.5, tailSeconds: 1.2 };

export const estimateSpeechSeconds = (text) => Math.max(1.5, String(text).split(/\s+/).length / 2.6);

export class LiveEngine extends EventEmitter {
  constructor({ config, store, tts = null, replies = new ReplyEngine(), llm = llmReply, complete = llmComplete, now = () => Date.now(), estimate = estimateSpeechSeconds }) {
    super();
    Object.assign(this, { config, store, tts, replies, llm, complete, now, estimate });
    this.newStream();
  }

  get chatCfg() { return { ...CHAT_DEFAULTS, ...(this.config.chat || {}) }; }
  get voiceCfg() { return { ...VOICE_DEFAULTS, ...(this.config.voice || {}) }; }
  get readingsCfg() { return { ...READINGS_DEFAULTS, ...(this.config.readings || {}) }; }
  get prophecyCfg() { return this.config.overlay?.character?.prophecy || { enabled: false }; }

  /** Reset per-stream counters (on connect or from the admin panel). */
  newStream() {
    clearTimeout(this.timer); clearTimeout(this.idleTimer); clearTimeout(this.welcomeTimer);
    this.credits = new Map(); this.pendingCodes = new Map(); this.readingsByUser = new Map();
    this.queue = []; this.chatQueue = []; this.current = null; this.busy = false;
    this.gifters = new Set(); this.lastReplyAt = new Map(); this.lastGreetAt = new Map();
    this.pendingGiftGreets = []; this.pendingFollowGreets = []; this.lastGreetTime = 0;
    this.pendingJoins = []; this.welcomed = new Set(); this.lastWelcomeTime = -1e12;
    this.ai = this.ai || new AiGate({ now: () => this.now() });
    this.memory = new Memory({ now: () => this.now() }); this.dateChecks = new Map(); this.dateAsks = new Map(); this.lastReplyUser = null; this.replyStreak = 0;   // per-stream: cleared here
    this.prepared = new Map(); // chat id -> Promise<{ text, source, sp }> (reply + voice made while she is still talking)
    // wording variety for this stream (readings, welcomes, idle lines)
    this.variety = new Variety(`${this.now()}-${Math.random().toString(36).slice(2, 8)}`); this.lastJobKind = null;
    this.lastActivity = 0; this.lastHowTo = this.now(); this.pendingDates = new Map(); this.readingVoice = new Map();
    this.overflow = []; this.sessions = new Map(); this.lastSaySub = null;
    this.stats = { gifts: 0, diamonds: 0, likes: 0, follows: 0, joins: 0, welcomes: 0, readings: 0, replies: 0, startedAt: this.now() };
    this.emit('queue', this.queue); this.emit('chatQueue', this.chatQueue);
  }

  touch() { this.lastActivity = this.now(); }

  tierFor(diamonds) {
    let tier = null;
    for (const t of this.config.tiers) if (diamonds >= t.minDiamonds) tier = t;
    return tier || this.config.tiers[0];
  }

  giftQualifies(giftName, diamonds) {
    const t = this.config.trigger;
    if (diamonds < t.minDiamonds) return false;
    if (t.acceptOtherGifts || !t.giftName) return true;
    return String(giftName).toLowerCase() === String(t.giftName).toLowerCase();
  }

  // ------------------------------------------------------------------ incoming events
  handleGift(g) {
    this.touch();
    this.stats.gifts++; this.stats.diamonds += g.diamonds;
    this.gifters.add(g.userId);
    this.emit('gift', g);
    this.queueGreeting('gift', g);
    if (!this.giftQualifies(g.giftName, g.diamonds)) return { ok: false, reason: 'gift-not-qualifying' };
    const ttl = this.config.limits.giftCreditMinutes * 60e3;
    const prev = this.credits.get(g.userId);
    const diamonds = (prev && prev.expiresAt > this.now() ? prev.diamonds : 0) + g.diamonds;
    this.credits.set(g.userId, { diamonds, expiresAt: this.now() + ttl, giftName: g.giftName });
    // a viewer who already commented their birth date (and was waiting for the gift) or is in the free queue gets upgraded
    const waitingDate = this.pendingDates.get(g.userId);
    if (waitingDate && waitingDate.expiresAt > this.now()) { this.pendingDates.delete(g.userId); return this.enqueueCommentReading(waitingDate.c, waitingDate.parsed); }
    const queued = this.queue.find((q) => q.userId === g.userId && q.source === 'comment');
    if (queued) { this.upgradeQueued(queued, diamonds); this.pump(); return { ok: true, credited: diamonds, upgraded: true }; }
    const pending = this.pendingCodes.get(g.userId);
    if (pending && pending.expiresAt > this.now()) {
      this.pendingCodes.delete(g.userId);
      return this.tryEnqueue(g.userId, g.nickname, pending.code);
    }
    this.pump();
    return { ok: true, credited: diamonds };
  }

  /** { userId, nickname, comment, isFollower?, isGifter? } */
  handleChat(c) {
    this.touch();
    const R = this.readingsCfg;
    this.replies.liveReadings = !!R.fromComments;
    if (R.fromComments) {
      const bad = filterComment(c.comment);
      if (!['link', 'profanity', 'spam-repeat'].includes(bad)) {
        // she asked this viewer about their date ("5 December or 12 May?"): this comment is the answer
        const chk = this.dateChecks.get(c.userId);
        if (chk && this.now() - chk.at < this.chatCfg.followUpSeconds * 1000) {
          const d = resolveDateAnswer(c.comment, chk.options, chk.parsed?.date);
          if (d) { this.dateChecks.delete(c.userId); return this.readingFor(chk.c, parsedWithDate(chk.c.comment, chk.c.nickname, d, chk.parsed && !chk.parsed.nameFromProfile ? chk.parsed.name : chk.name || '')); }
          if (++chk.tries >= 2) this.dateChecks.delete(c.userId);
        }
        const parsed = parseReadingComment(c.comment, c.nickname, { allowNoYear: R.yearOptional, askAmbiguous: R.askAmbiguous });
        if (parsed?.check) return this.askDate(c, parsed);
        if (parsed) return this.readingFor(c, parsed);
        // looks like a birth date the rules can't read ("5 dicmbr 98"): the AI reads it, or she asks
        if (looksLikeDateAttempt(c.comment) && !this.queue.some((q) => q.userId === c.userId) && !this.dateChecks.has(c.userId)) return this.guessDate(c);
      }
    }
    if (R.privateForm) for (const code of extractCodes(c.comment)) {
      if (!this.store.byCode(code)) continue;
      const credit = this.credits.get(c.userId);
      if (!credit || credit.expiresAt <= this.now()) {
        this.pendingCodes.set(c.userId, { code, expiresAt: this.now() + this.config.limits.giftCreditMinutes * 60e3 });
        const gift = this.config.trigger.giftName || 'a gift';
        this.toast(`${c.nickname}: send ${this.config.trigger.minDiamonds > 1 ? this.config.trigger.minDiamonds + ' coins' : '1 ' + gift} to unlock code ${code} ✨`, 'hint');
        return { ok: false, reason: 'needs-gift', code };
      }
      return this.tryEnqueue(c.userId, c.nickname, code);
    }
    return this.enqueueChat(c);
  }

  handleLike(l) { this.touch(); this.stats.likes += l.count || 1; this.emit('like', l); }
  handleFollow(f) { this.touch(); this.stats.follows++; this.emit('follow', f); this.queueGreeting('follow', f); }

  /** A viewer joined the LIVE (TikTok "member" event). Each person is welcomed once per stream, in batches. */
  handleJoin(u) {
    this.touch(); this.stats.joins++;
    const C = this.chatCfg;
    if (!C.enabled || !C.welcomeJoins) return { ok: false, reason: 'welcome-off' };
    const id = String(u.userId || u.uniqueId || u.nickname || '');
    if (!id || this.welcomed.has(id)) return { ok: false, reason: 'already-welcomed' };
    this.welcomed.add(id);
    this.pendingJoins.push({ userId: id, nickname: u.nickname || u.uniqueId || 'friend', at: this.now() });
    if (this.pendingJoins.length > 1000) this.pendingJoins.splice(0, this.pendingJoins.length - 1000);   // memory guard only
    this.pump();
    return { ok: true };
  }

  /** Seconds until the next batched welcome may be spoken (0 = now, null = nobody waiting). */
  welcomeWait() {
    if (!this.pendingJoins.length) return null;
    const C = this.chatCfg;
    const every = C.joinGreetSeconds * (this.chatQueue.length > 3 ? 2 : 1) * 1000;
    return Math.max(0, this.lastWelcomeTime + every - this.now(), this.pendingJoins[0].at + C.joinBatchSeconds * 1000 - this.now()) / 1000;
  }

  takeWelcome() {
    // every name is spoken: up to joinMaxNames per welcome, the rest are welcomed next time
    const max = Math.max(1, this.chatCfg.joinMaxNames || 6);
    const people = this.pendingJoins.slice(0, max); this.pendingJoins = this.pendingJoins.slice(max);
    this.lastWelcomeTime = this.now(); this.stats.welcomes++;
    const names = people.map((p) => p.nickname);
    const shown = welcomeNames(names, max);
    return { kind: 'say', sub: 'welcome', text: this.welcomeText(names), caption: { icon: '👋', title: 'Welcome!', text: shown }, count: people.length, names };
  }

  /** "Welcome Sara, Ali and Zoya! I'm Mira, I read your destiny with numerology. Type your name and birth date..." */
  welcomeText(names) {
    const V = this.variety, list = welcomeNames(names, names.length), key = names.join('|');
    const hello = V.choose('welcome', names.length > 1 ? WELCOME_T : WELCOME_ONE_T, key).replace('{names}', list);
    const ex = `${spokenName(names[0]).split(' ')[0] || 'Sara'} ${V.choose('example-date', EXAMPLE_DATES, key)}`;
    // busy LIVE (many waiting or readings queued): the short how-to, so welcomes stay quick
    const busy = this.queue.length > 0 || this.pendingJoins.length > 0 || names.length > 3;
    const how = V.choose(busy ? 'howto-short' : 'howto', busy ? HOWTO_SHORT_T : HOWTO_T, key).replace('{ex}', ex);
    return `${hello} ${how}`;
  }

  // ------------------------------------------------------------------ chat queue
  enqueueChat(c) {
    const C = this.chatCfg;
    if (!C.enabled) return { ok: false, reason: 'chat-off' };
    const bad = filterComment(c.comment);
    if (bad) return { ok: false, reason: bad };
    const isGifter = c.isGifter || this.gifters.has(c.userId);
    const isFollower = !!c.isFollower;
    if (C.mode === 'gifters' && !isGifter) return { ok: false, reason: 'not-gifter' };
    if (C.mode === 'followers' && !isFollower) return { ok: false, reason: 'not-follower' };
    if (C.mode === 'followersOrGifters' && !isFollower && !isGifter) return { ok: false, reason: 'not-follower-or-gifter' };
    // her question to this viewer is still open, or they are in their reading session: this comment continues the thread
    const comment = String(c.comment).trim().slice(0, 200);
    const followUp = this.memory.awaiting(c.userId, C.followUpSeconds);
    const session = this.sessionLeft(c.userId) > 0;
    this.memory.learn(c.userId, c.nickname, comment);
    const question = isQuestion(comment);
    // the same viewer again while their comment still waits: merged into one answer (nothing they say is lost)
    // (in a reading session each follow-up is its own answer, up to the free ones left)
    const waiting = [...this.chatQueue, ...this.overflow].filter((q) => q.userId === c.userId);
    const mine = session && !waiting.some((q) => q.preset) && waiting.length < this.sessionLeft(c.userId) ? null : waiting.at(-1);
    if (mine && !mine.preset) {
      mine.parts = [...(mine.parts || [mine.comment]), comment].slice(-(C.mergeMax || 3));
      mine.comment = mine.parts.join('. ').replace(/([.?!])\./g, '$1').slice(-200);
      mine.question = mine.question || question; mine.followUp = mine.followUp || followUp; mine.session = mine.session || session; mine.at = this.now();
      this.prepared.delete(mine.id);
      this.emit('chatQueue', this.chatQueue); this.prefetch();
      return { ok: true, merged: true, chat: mine };
    }
    if (mine) return { ok: true, merged: true, chat: mine };   // she is about to ask them something (date check): that comes first
    // copy-paste from several viewers: one answer that names all of them
    const norm = normalizeComment(comment).toLowerCase();
    const same = norm.length > 3 && this.chatQueue.find((q) => !q.preset && this.now() - q.at <= C.maxCommentAgeSeconds * 1000 && normalizeComment(q.comment).toLowerCase() === norm);
    if (same) { same.others = [...new Set([...(same.others || []), c.nickname])].slice(0, 5); return { ok: true, merged: true, duplicate: true, chat: same }; }
    const item = { id: `c${this.now()}${Math.random().toString(36).slice(2, 6)}`, userId: c.userId, nickname: c.nickname, comment, at: this.now(), isGifter, isFollower, question, followUp, session };
    if (this.chatQueue.length >= C.maxQueue) {
      // a question, a follow-up or a session comment gets in by moving the newest plain comment to the backlog
      const j = (question || followUp || session) ? this.chatQueue.map((q) => !q.question && !q.followUp && !q.session && !q.preset).lastIndexOf(true) : -1;
      if (j >= 0) this.overflow.unshift(...this.chatQueue.splice(j, 1));
      else {
        this.overflow.push(item);
        if (this.overflow.length > (C.overflowMax || 300)) this.overflow.splice(0, this.overflow.length - (C.overflowMax || 300));   // memory guard only
        this.lastReplyAt.set(c.userId, this.now());
        this.emit('chatQueue', this.chatQueue); this.pump();
        return { ok: true, backlog: this.overflow.length, chat: item };
      }
    }
    if (followUp || session) { const i = this.chatQueue.findIndex((q) => !q.followUp && !q.session && !q.preset); this.chatQueue.splice(i < 0 ? this.chatQueue.length : i, 0, item); }   // answers to her questions / reading follow-ups first
    else this.chatQueue.push(item);
    this.lastReplyAt.set(c.userId, this.now());
    this.warmFiller(c);
    this.emit('chatQueue', this.chatQueue);
    this.pump();
    this.prefetch();
    return { ok: true, chat: item };
  }

  /** Free follow-ups left in this viewer's reading session (0 = none). */
  sessionLeft(userId) { const x = this.sessions.get(userId); return x ? x.left : 0; }
  startSession(userId) {
    const n = Math.max(0, Number(this.readingsCfg.sessionReplies ?? 2));
    if (n > 0) this.sessions.set(userId, { left: n, max: n, at: this.now() }); else { this.sessions.delete(userId); return; }
    // comments they wrote while waiting for the reading are the first follow-ups
    const theirs = this.chatQueue.filter((q) => q.userId === userId && !q.preset);
    if (theirs.length) {
      this.chatQueue = this.chatQueue.filter((q) => !theirs.includes(q));
      for (const q of theirs) { q.session = true; this.prepared.delete(q.id); }
      const i = this.chatQueue.findIndex((q) => !q.followUp && !q.session && !q.preset); this.chatQueue.splice(i < 0 ? this.chatQueue.length : i, 0, ...theirs);
      this.emit('chatQueue', this.chatQueue);
    }
  }

  queueGreeting(kind, u) {
    const C = this.chatCfg;
    if (!C.enabled || (kind === 'gift' && !C.greetGifters) || (kind === 'follow' && !C.greetFollowers)) return;
    const key = kind + ':' + u.userId;
    if (this.now() - (this.lastGreetAt.get(key) || -1e12) < 10 * 60e3) return; // greet each person at most every 10 min
    this.lastGreetAt.set(key, this.now());
    const list = kind === 'gift' ? this.pendingGiftGreets : this.pendingFollowGreets;
    if (!list.some((x) => x.userId === u.userId)) list.push({ userId: u.userId, nickname: u.nickname, gift: u.giftName, due: this.now() + (C.greetDelaySeconds ?? 4) * 1000 });
    this.pump();
  }

  // ------------------------------------------------------------------ readings
  tryEnqueue(userId, nickname, code) {
    const L = this.config.limits;
    const sub = this.store.byCode(code);
    if (!sub) return { ok: false, reason: 'unknown-code' };
    if (sub.uses >= L.usesPerCode) { this.toast(`${nickname}: code ${code} was already used. Get a new one from the link in bio.`, 'warn'); return { ok: false, reason: 'code-used' }; }
    const done = this.readingsByUser.get(userId) || 0;
    if (done >= L.readingsPerUserPerStream) { this.toast(`${nickname}: you've reached the limit of ${L.readingsPerUserPerStream} reading(s) this live 💜`, 'warn'); return { ok: false, reason: 'user-limit' }; }
    if (this.queue.length >= L.maxQueueLength) { this.toast(`The queue is full (${L.maxQueueLength}). Please try again in a few minutes!`, 'warn'); return { ok: false, reason: 'queue-full' }; }

    const credit = this.credits.get(userId);
    const tier = this.tierFor(credit ? credit.diamonds : this.config.trigger.minDiamonds);
    this.credits.delete(userId);
    let reading;
    try { reading = computeReading({ ...sub.input, year: 2026 }); } catch { return { ok: false, reason: 'bad-data' }; }
    const live = liveReading(reading, tier.level);
    const item = { id: `${code}-${this.now()}`, kind: 'reading', code, userId, nickname, tierName: tier.name, level: tier.level, seconds: tier.secondsOnScreen, ...live };
    this.store.markUsed(code);
    this.readingsByUser.set(userId, done + 1);
    // the reading replaces a thank-you greeting for this person
    this.pendingGiftGreets = this.pendingGiftGreets.filter((g) => g.userId !== userId);
    this.queue.push(item);
    this.toast(`🔮 ${nickname} joined the queue (#${this.queue.length + (this.current?.kind === 'reading' ? 1 : 0)})`, 'join');
    this.emit('queue', this.queue);
    this.pump();
    return { ok: true, item };
  }

  // ------------------------------------------------------------------ readings from comments
  readingFor(c, parsed) {
    const m = this.memory.learn(c.userId, c.nickname, c.comment);
    m.facts.reading = true;
    if (parsed.date) this.memory.setDob(c.userId, parsed.date);
    return this.enqueueCommentReading(c, parsed);
  }

  /** A messy date the rules could not read: ask the AI (when its slot is free), otherwise ask the viewer. */
  guessDate(c) {
    const L = this.config.llm || {};
    if (!(this.readingsCfg.aiDates && llmReady(L) && this.ai.open())) return this.askDate(c, null);
    this.ai.ask(L, { comment: c.comment, name: '', cacheable: false }, () => this.complete({ ...L, temperature: 0 }, [{ role: 'system', content: AI_DATE_PROMPT }, { role: 'user', content: String(c.comment).slice(0, 200) }]))
      .then((r) => {
        const g = readAiDate(r.text);
        if (g && g.clear && g.day) return this.readingFor(c, parsedWithDate(c.comment, c.nickname, g, g.name));
        this.askDate(c, g?.options?.length >= 2 ? { check: { reason: 'ambiguous', options: g.options }, name: g.name || '', nameFromProfile: !g.name } : null);
      })
      .catch((e) => { this.emit('log', `AI date reader not used (${e.message})`); this.askDate(c, null); });
    return { ok: true, pending: 'date-ai' };
  }

  /** A fixed answer for this viewer, in the chat queue like any reply (replaces anything of theirs still waiting). */
  presetReply(c, text) {
    const item = { id: `p${this.now()}${Math.random().toString(36).slice(2, 6)}`, userId: c.userId, nickname: c.nickname, comment: String(c.comment || '').slice(0, 200), at: this.now(), preset: text, followUp: false, question: false };
    this.chatQueue = this.chatQueue.filter((q) => q.userId !== c.userId); this.overflow = this.overflow.filter((q) => q.userId !== c.userId);
    this.chatQueue.push(item); this.emit('chatQueue', this.chatQueue); this.prefetch(); this.pump();
    return item;
  }

  /** Mira asks about the date ("Sara, is that 5 December or 12 May?"); the viewer's next comment completes the reading. */
  askDate(c, parsed) {
    const asked = this.dateAsks.get(c.userId) || 0;
    if (asked >= 2) return { ok: false, reason: 'date-unclear' };
    this.dateAsks.set(c.userId, asked + 1);
    const name = parsed && !parsed.nameFromProfile && parsed.name ? String(parsed.name).split(' ')[0] : spokenName(c.nickname);
    const opts = (parsed?.check?.options || []).filter(Boolean), ur = detectLanguage(c.comment) !== 'en';
    let text;
    if (opts.length >= 2) text = ur ? `${name}, ${showDate(opts[0])} ya ${showDate(opts[1])}?` : `${name}, is that ${showDate(opts[0])} or ${showDate(opts[1])}?`;
    else if (parsed?.check?.reason === 'impossible') { const d = parsed.date; text = `${name}, ${MONTH_NAMES[d.month - 1]} has no ${ord(d.day)}! Which date did you mean? Write it like 12 May 1998.`; }
    else text = ur ? `${name}, aap ki date of birth samajh nahi aayi. Aise likhein: 12 May 1998.` : `${name}, I could not quite read your birth date. Write it like 12 May 1998?`;
    this.dateChecks.set(c.userId, { c, parsed, name: parsed?.name && !parsed.nameFromProfile ? parsed.name : '', options: opts, at: this.now(), tries: 0 });
    const item = { id: `q${this.now()}${Math.random().toString(36).slice(2, 6)}`, userId: c.userId, nickname: c.nickname, comment: String(c.comment).slice(0, 200), at: this.now(), preset: text, followUp: true, question: false };
    this.chatQueue = this.chatQueue.filter((q) => q.userId !== c.userId);
    const i = this.chatQueue.findIndex((q) => !q.followUp); this.chatQueue.splice(i < 0 ? this.chatQueue.length : i, 0, item);
    this.emit('chatQueue', this.chatQueue); this.prefetch(); this.pump();
    return { ok: true, asked: text };
  }

  /** c = { userId, nickname, comment }, parsed = parseReadingComment(...) */
  enqueueCommentReading(c, parsed) {
    const R = this.readingsCfg;
    const credit = this.credits.get(c.userId);
    const paid = credit && credit.expiresAt > this.now() ? credit.diamonds : 0;
    const name = spokenName(c.nickname);
    if (this.queue.some((q) => q.userId === c.userId) || this.current?.userId === c.userId) {
      const at = this.queue.findIndex((q) => q.userId === c.userId);
      if (at >= 0) this.presetReply(c, `${name}, your reading is coming, you are number ${at + 1} in line. Stay with me!`);
      return { ok: false, reason: 'already-queued' };
    }
    const done = this.readingsByUser.get(c.userId) || 0;
    if (done >= R.perViewerPerStream) {
      this.toast(`${name}: you already had your prediction this live 💜`, 'warn');
      // she still answers: a reading follow-up while their session lasts, otherwise a short reminder of their numbers
      if (this.sessionLeft(c.userId) > 0) this.enqueueChat({ ...c });
      else this.presetReply(c, fill(this.variety.choose('already-read', ALREADY_READ_T, c.userId, 'stream'), { name, numbers: numbersPhrase(this.memory.get(c.userId, c.nickname).facts) }));
      return { ok: false, reason: 'user-limit' };
    }
    if (R.requireGift && !paid) {
      this.pendingDates.set(c.userId, { c, parsed, expiresAt: this.now() + this.config.limits.giftCreditMinutes * 60e3 });
      const gift = this.config.trigger.giftName || 'a gift';
      this.toast(`${spokenName(c.nickname)}: send ${this.config.trigger.minDiamonds > 1 ? this.config.trigger.minDiamonds + ' coins' : '1 ' + gift} for your prediction ✨`, 'hint');
      return { ok: false, reason: 'needs-gift' };
    }
    const tier = paid ? this.tierFor(paid) : null;
    // the queue cap only stops free readings; gifters always get in
    if (!paid && this.queue.length >= R.maxQueue) { this.toast(`The prediction queue is full (${R.maxQueue}). Try again in a few minutes!`, 'warn'); return { ok: false, reason: 'queue-full' }; }
    let reading = null;   // no birth year: a Birthday + Personal Year reading (partialScript)
    if (!parsed.partial) try { reading = computeReading({ fullName: parsed.name, dob: parsed.dob, motherName: parsed.mother, fatherName: parsed.father, question: parsed.question, year: 2026 }); } catch { return { ok: false, reason: 'bad-data' }; }
    const level = tier ? tier.level : 1;
    const item = {
      id: `d${this.now()}${Math.random().toString(36).slice(2, 5)}`, kind: 'reading', source: 'comment', code: parsed.dateText, userId: c.userId, nickname: c.nickname,
      tierName: tier ? tier.name : R.freeTierName, level, seconds: tier ? Math.min(tier.secondsOnScreen, 18 + level * 6) : R.freeSeconds,
      priority: paid && R.giftPriority ? 1 + level : 0, at: this.now(), parsed, reading,
      caption: { icon: '🔮', title: `${parsed.name} · ${showDate(parsed.date)}`, text: parsed.question || [parsed.mother && `Mother: ${parsed.mother}`, parsed.father && `Father: ${parsed.father}`].filter(Boolean).join(' · ') || `@${c.nickname}` },
      ...(reading ? readingScript(reading, parsed, level, this.variety) : partialScript(parsed, this.variety)),
    };
    if (paid) this.credits.delete(c.userId);
    this.readingsByUser.set(c.userId, done + 1);
    this.pendingGiftGreets = this.pendingGiftGreets.filter((g) => g.userId !== c.userId);
    this.insertByPriority(item);
    this.prepareReadingVoice(item);
    this.toast(`🔮 ${item.name} is #${this.queue.indexOf(item) + 1} for a prediction`, 'join');
    this.emit('queue', this.queue);
    this.pump();
    return { ok: true, item };
  }

  insertByPriority(item) {
    const at = this.queue.findIndex((q) => (q.priority || 0) < (item.priority || 0));
    if (at < 0) this.queue.push(item); else this.queue.splice(at, 0, item);
  }

  /** Make the voice for the next readings while Mira is still busy, so she starts speaking right away. */
  prepareReadingVoice(item) {
    if (!this.tts || this.readingVoice.has(item.id) || this.queue.indexOf(item) > 2) return;
    const text = item.spoken;
    this.readingVoice.set(item.id, this.speech(text).then((sp) => (sp.text === text ? sp : null)).catch(() => null));
  }

  /** A viewer waiting in the free queue sent a gift: move them up (and give the longer tier). */
  upgradeQueued(item, diamonds) {
    const tier = this.tierFor(diamonds);
    this.queue.splice(this.queue.indexOf(item), 1);
    Object.assign(item, { tierName: tier.name, level: tier.level, seconds: Math.min(tier.secondsOnScreen, 18 + tier.level * 6), priority: this.readingsCfg.giftPriority ? 1 + tier.level : 0 },
      item.reading ? readingScript(item.reading, item.parsed, tier.level, this.variety) : partialScript(item.parsed, this.variety));
    this.readingVoice.delete(item.id); this.prepareReadingVoice(item);
    this.credits.delete(item.userId);
    this.insertByPriority(item);
    this.toast(`✨ ${item.name} moved up to #${this.queue.indexOf(item) + 1}`, 'join');
    this.emit('queue', this.queue);
  }

  /** Speak custom text next (admin "test voice"). */
  sayNow(text) { this.adminLines = [...(this.adminLines || []), String(text)]; this.pump(); }

  // ------------------------------------------------------------------ director
  nextJob() {
    if (this.adminLines?.length) return { kind: 'say', sub: 'admin', text: this.adminLines.shift() };
    // readings first, but people who joined are never kept waiting behind a long queue: one welcome between readings
    if (this.queue.length && this.lastJobKind === 'reading' && this.pendingJoins.length && this.now() - this.pendingJoins[0].at >= this.chatCfg.joinBatchSeconds * 1000) return this.takeWelcome();
    if (this.queue.length) return this.queue.shift();
    const C = this.chatCfg;
    const greetDue = this.now() - this.lastGreetTime >= C.greetCooldownSeconds * 1000;
    const dueNow = (list) => list.some((p) => p.due <= this.now());
    if (greetDue && dueNow(this.pendingGiftGreets)) {
      const people = this.pendingGiftGreets.filter((p) => p.due <= this.now()); this.pendingGiftGreets = this.pendingGiftGreets.filter((p) => p.due > this.now()); const gifts = [...new Set(people.map((p) => p.gift))];
      return { kind: 'say', sub: 'greet', text: this.replies.greetGift(people.map((p) => p.nickname), gifts.length === 1 ? gifts[0] : 'gifts'),
        caption: { icon: '🎁', title: 'Thank you!', text: `${welcomeNames(people.map((p) => p.nickname), 3)} · ${gifts.length === 1 ? gifts[0] : 'gifts'}` } };
    }
    if (greetDue && dueNow(this.pendingFollowGreets)) {
      const people = this.pendingFollowGreets.filter((p) => p.due <= this.now()); this.pendingFollowGreets = this.pendingFollowGreets.filter((p) => p.due > this.now());
      return { kind: 'say', sub: 'greet', text: this.replies.greetFollow(people.map((p) => p.nickname)), caption: { icon: '💫', title: 'New follower', text: welcomeNames(people.map((p) => p.nickname), 3) } };
    }
    if (this.welcomeWait() === 0) return this.takeWelcome();
    const R = this.readingsCfg;
    if (R.fromComments && R.howToEverySeconds > 0 && this.now() - this.lastHowTo >= R.howToEverySeconds * 1000 && this.chatQueue.length && this.chatQueue.length <= 2 && !this.overflow.length) {   // not while a busy chat waits
      this.lastHowTo = this.now();
      return { kind: 'say', sub: 'prompt', text: this.replies.howToAsk(), caption: { icon: '🔮', title: 'Get your prediction', text: 'Comment: your name + birth date (+ a question)' } };
    }
    // comments that waited too long (a very busy chat) are not dropped: she greets those viewers together, by name
    const old = (q) => !q.preset && !q.followUp && !q.session && this.now() - q.at > C.maxCommentAgeSeconds * 1000;
    const stale = [...this.chatQueue.filter(old), ...this.overflow.filter(old)];
    if (stale.length) {
      const people = stale.slice(0, Math.max(1, C.groupMaxNames || 6)), ids = new Set(people.map((q) => q.id));
      this.chatQueue = this.chatQueue.filter((q) => !ids.has(q.id)); this.overflow = this.overflow.filter((q) => !ids.has(q.id));
      this.emit('chatQueue', this.chatQueue);
      const names = people.flatMap((q) => [q.nickname, ...(q.others || [])]);   // people who wrote the same thing are named too
      return { kind: 'say', sub: 'group', text: fill(this.variety.choose('group', GROUP_T, names.join('|'), 'stream'), { names: welcomeNames(names, 12) }), caption: { icon: '💬', title: 'I see you!', text: welcomeNames(names, 4) }, names };
    }
    // the backlog moves up as soon as there is room
    while (this.overflow.length && this.chatQueue.length < C.maxQueue) this.chatQueue.push(this.overflow.shift());
    // take the first one - unless that viewer just had maxConsecutiveTurns replies in a row and somebody else is
    // waiting (nobody hogs her; the thread continues after the others had a turn)
    if (!this.chatQueue.length) { this.emit('chatQueue', this.chatQueue); return null; }
    let i = 0;
    if (this.replyStreak >= (C.maxConsecutiveTurns || 2)) { const j = this.chatQueue.findIndex((q) => q.userId !== this.lastReplyUser); if (j >= 0) i = j; }
    const c = this.chatQueue.splice(i, 1)[0];
    this.emit('chatQueue', this.chatQueue);
    return { kind: 'say', sub: 'reply', chat: c };
  }

  pump() {
    this.replies.liveReadings = !!this.readingsCfg.fromComments;
    if (this.busy || this.paused) return;
    const job = this.nextJob();
    if (!job) {
      // greetings wait a few seconds (so a code comment right after a gift turns into a reading instead)
      const pend = [...this.pendingGiftGreets, ...this.pendingFollowGreets];
      if (pend.length) {
        const wait = Math.max(50, Math.min(...pend.map((p) => p.due)) - this.now(), this.chatCfg.greetCooldownSeconds * 1000 - (this.now() - this.lastGreetTime));
        clearTimeout(this.greetTimer); this.greetTimer = setTimeout(() => this.pump(), wait); this.greetTimer.unref?.();
      }
      const ww = this.welcomeWait();
      if (ww != null) { clearTimeout(this.welcomeTimer); this.welcomeTimer = setTimeout(() => this.pump(), Math.max(50, ww * 1000)); this.welcomeTimer.unref?.(); }
      this.scheduleIdlePrompt(); return;
    }
    clearTimeout(this.idleTimer);
    this.busy = true; this.lastJobKind = job.kind === 'reading' ? 'reading' : job.sub;
    this.run(job).catch((e) => { console.log('[director]', e); this.finishCurrent(); });
  }

  scheduleIdlePrompt() {
    clearTimeout(this.idleTimer);
    const s = this.chatCfg.idlePromptSeconds;
    if (!this.chatCfg.enabled || !s || s <= 0) return;
    // never silent for long: a short line after 25-40 s of nothing (idlePromptSeconds caps it; shorter settings are kept)
    const lo = Math.min(s, 25), hi = Math.min(Math.max(s, lo), 40), wait = lo + (hi - lo) * Math.random();
    this.idleTimer = setTimeout(() => {
      // only prompt while a stream is active (some activity in the last 15 minutes)
      if (this.busy || this.paused || this.now() - this.lastActivity > 15 * 60e3) return;
      this.adminLines = [...(this.adminLines || [])];
      this.busy = true;
      this.replies.liveReadings = !!this.readingsCfg.fromComments;
      if (this.replies.liveReadings) this.lastHowTo = this.now();
      this.lastJobKind = 'prompt';
      const eng = this.engageLine();
      if (eng) return this.run(eng).catch(() => this.finishCurrent());
      this.run({ kind: 'say', sub: 'prompt', text: this.idleLine(), caption: this.replies.liveReadings ? { icon: '🔮', title: 'Get your prediction', text: 'Comment: your name + birth date (+ a question)' } : null }).catch(() => this.finishCurrent());
    }, wait * 1000);
    this.idleTimer.unref?.();
  }

  /** Sometimes, when it is quiet, she turns to someone who has been chatting and asks them something (a 2-way chat). */
  engageLine() {
    const C = this.chatCfg;
    if (!C.engageChance || Math.random() >= C.engageChance) return null;
    const m = this.memory.activeChatter(C.followUpSeconds, 300); if (!m) return null;
    const f = m.facts, dob = !!f.dob;
    const list = dob ? ENGAGE_DOB_T.concat(ENGAGE_T.filter((t) => !/birth date/.test(t))) : ENGAGE_T;
    const text = this.variety.choose('engage', list, m.userId, 'stream').replace(/\{name\}/g, m.name).replace(/\{zodiac\}/g, f.zodiac || '').replace(/\{py\}/g, f.personalYear || '');
    m.engagedAt = this.now(); this.memory.add(m.userId, 'assistant', text);
    return { kind: 'say', sub: 'engage', text, caption: { icon: '💬', title: '@' + m.name, text: 'Mira asks you' } };
  }

  /** Idle line: the streamer's own lines (config chat.idlePrompts) if set, else invites, teasers and numerology facts. */
  idleLine() {
    const custom = this.chatCfg.idlePrompts;
    if (Array.isArray(custom) && custom.length) return this.replies.idlePrompt(custom);
    if (!this.readingsCfg.fromComments) return this.replies.idlePrompt();
    this.idleCount = (this.idleCount || 0) + 1;
    // every other quiet moment teaches a magic command ("type pull a card ...")
    if (this.chatCfg.mystic !== false && this.idleCount % 2 === 0) return this.variety.choose('idle-cmd', COMMAND_PROMPTS, String(this.idleCount), 'stream');
    return this.variety.choose('idle', IDLE_T, String(this.idleCount), 'stream');   // no repeats until all were used
  }

  /**
   * Her answer to a chat comment. AI (any OpenAI-compatible provider, keyless ones too) with this viewer's memory when the
   * request gate is open; otherwise, or on any error / timeout / unsafe answer, the built-in replies (never silent).
   * prefetch: made ahead of time; if the gate is closed now, return null so it is retried when it is really her turn.
   */
  async makeReply(chat, { prefetch = false } = {}) {
    const L = this.config.llm || {};
    const C = this.chatCfg;
    const name = spokenName(chat.nickname);
    const pick = (cat, list) => this.variety.choose(cat, list, chat.userId + '|' + chat.comment, 'stream');
    const facts = this.memory.get(chat.userId, chat.nickname).facts;
    const inSession = chat.session && this.sessionLeft(chat.userId) > 0;
    // built-in answers (no AI, or the AI is busy / rate-limited / failed): a reading follow-up in a session, a question
    // back when she does not understand, otherwise the rule-based replies - always with the viewer's name
    const rules = () => {
      if (inSession && facts.personalYear) return { text: sessionLine({ name, facts, comment: chat.comment, pick }), source: 'session' };
      const unclear = unclearKind(chat.comment);
      if (unclear) return { text: clarifyLine(unclear, name, chat.comment, pick), source: 'clarify' };
      return { text: withName(name, this.replies.reply(chat.comment, chat).text), source: 'rules' };
    };
    if (chat.preset) return { text: chat.preset, source: 'rules' };
    if (isSelfHarm(chat.comment)) return rules();
    // magic commands ("pull a card", "my zodiac", "love match Leo Aries" ...): the knowledge base, no AI needed
    if (C.mystic !== false) {
      const kb = answerMystic(chat.comment, { name: spokenName(chat.nickname), facts: this.memory.get(chat.userId, chat.nickname).facts, now: new Date(this.now()), tz: this.config.timezone || process.env.STREAM_TZ || 'Asia/Dubai',
        pick: (cat, list) => this.variety.choose(cat, list, chat.userId, 'stream') });
      if (kb) return { text: kb.text, source: 'kb', cards: kb.cards || null, mood: kb.mood, intent: kb.intent };
    }
    // a birth date in a chat comment: the numbers come from code, not the AI
    if (extractBirthDate(chat.comment)) return rules();
    // the one AI slot goes to reading follow-ups, questions and answers to her questions first; plain chat gets it when none are waiting
    // the free AI is slow (6-20 s): in a busy chat she answers from her own knowledge so nobody waits for minutes
    const backlog = this.chatQueue.filter((q) => q !== chat).length + this.overflow.length;
    const priority = inSession || (backlog < (this.chatCfg.aiMaxBacklog ?? 4) && (chat.question || chat.followUp || !this.chatQueue.some((q) => q !== chat && (q.question || q.followUp || q.session))));
    if (llmReady(L) && priority) {
      if (prefetch && !this.ai.open() && !this.ai.cached(chat.comment, L.cacheSeconds ?? 300)) return null;
      try {
        const history = this.memory.history(chat.userId);
        const sess = inSession ? `This viewer just had their numerology reading from you; this comment is free follow-up ${this.sessions.get(chat.userId).max - this.sessions.get(chat.userId).left + 1} of ${this.sessions.get(chat.userId).max} about it: answer about their reading and numbers.\n` : '';
        const ctx = sess + this.memory.context(chat.userId) + mysticSnippets(chat.comment, this.memory.get(chat.userId).facts, new Date(this.now())) + (chat.isGifter ? 'This viewer sent a gift tonight.\n' : '');
        const name = spokenName(chat.nickname);
        const r = await this.ai.ask(L, { comment: chat.comment, name, cacheable: !history.length },
          () => this.llm(L, { nickname: chat.nickname, comment: chat.comment, context: ctx, history, liveReadings: !!this.readingsCfg.fromComments }));
        const text = cleanSpoken(r.text, C.maxReplyWords);
        const bad = filterComment(text);
        if (bad === 'link' || bad === 'profanity') throw new Error('unsafe answer: ' + bad);
        return { text, source: 'llm' };
      } catch (e) { if (prefetch && e.refused) return null; this.emit('log', `AI reply not used (${e.message}), using built-in replies`); }
    }
    return rules();
  }

  /** Make the next replies (text + voice) in the background so there is no pause between answers. */
  prefetch() {
    const live = new Set(this.chatQueue.map((c) => c.id));
    for (const id of this.prepared.keys()) if (!live.has(id)) this.prepared.delete(id);
    for (const c of this.chatQueue.slice(0, this.chatCfg.prefetchReplies ?? 2)) if (!this.prepared.has(c.id)) this.prepared.set(c.id, this.prepareReply(c, { prefetch: true }));
  }

  async prepareReply(chat, opt = {}) {
    // is this the last free follow-up of their reading session? (decided now: the queue moves while the answer is made)
    const ahead = Math.max(0, this.chatQueue.filter((q) => q.userId === chat.userId && q.session).indexOf(chat));
    const lastOfSession = !!chat.session && this.sessionLeft(chat.userId) - (this.current?.sub === 'reply' && this.current.userId === chat.userId ? 1 : 0) - ahead === 1;
    try {
      const r = await this.makeReply(chat, opt);
      if (!r) return null;
      let { text, source } = r; const extra = { cards: r.cards || null, mood: r.mood || null, intent: r.intent || null };
      // memory: what they said and what she answered (an answer ending on a question waits for theirs)
      this.memory.get(chat.userId, chat.nickname);
      this.memory.add(chat.userId, 'user', chat.comment); this.memory.add(chat.userId, 'assistant', text);
      if (this.chatCfg.readQuestionAloud && !chat.preset && source !== 'clarify') text = withQuestion(chat.nickname, chat.comment, text);
      if (chat.others?.length) text += ` Same to you, ${welcomeNames(chat.others, 3)}!`;
      // the last free follow-up of a reading session ends it, gently
      if (lastOfSession) text += ' ' + fill(this.variety.choose('session-end', SESSION_END_T, chat.userId, 'stream'), { name: spokenName(chat.nickname) });
      return { text, source, ...extra, sp: await this.speech(text, this.chatCfg.voiceMaxWaitMs ?? 14000) };
    } catch { return null; }
  }

  /** Make the voice for her "thinking" lines ahead: the lines once per server, each viewer's name when they comment. */
  warmFiller(c) {
    if (!this.tts?.cachedClip || this.chatCfg.thinkingFiller === false) return;
    if (!this.fillersWarm) { this.fillersWarm = true; (async () => { for (const t of [...FILLER_T, ...FILLER_UR_T]) await this.tts.cachedClip(t.replace(/^\{name\},\s*/, '')); })(); }   // one at a time
    this.tts.cachedClip(spokenName(c.nickname) + ',');
  }

  /** "Sara, hmm, let me read the stars for you..." - said right away, then her real answer follows. */
  async sayFiller(chat) {
    const name = spokenName(chat.nickname), ur = detectLanguage(chat.comment) === 'roman-ur';
    const tpl = this.variety.choose('filler', ur ? FILLER_UR_T : FILLER_T, chat.id, 'stream'), text = fill(tpl, { name });
    // the voice is ready at once: the name clip (made when the comment arrived) + the line (made once per server)
    const voice = (async () => {
      if (!this.tts?.cachedClip) return null;
      const [a, b] = await Promise.all([this.tts.cachedClip(name + ','), this.tts.cachedClip(tpl.replace(/^\{name\},\s*/, ''))]);
      return a && b ? { text, ...this.tts.register(Buffer.concat([a, b])), server: true } : null;
    })();
    const sp = { ...((await Promise.race([voice, new Promise((r) => { const t = setTimeout(() => r(null), 700); t.unref?.(); })])) || { text, url: null, duration: this.estimate(text), server: false }) };
    sp.start = 0.2;
    const total = Math.max(this.voiceCfg.minSaySeconds ?? 1.5, sp.start + sp.duration + (this.voiceCfg.tailSeconds ?? 0.3));
    sp.start = Math.min(sp.start, this.voiceCfg.talkSpeechStart ?? 0.2);
    this.current = { id: `f${this.now()}`, kind: 'say', sub: 'filler', text, source: 'filler', comment: { nickname: chat.nickname, text: chat.comment }, caption: null, speech: sp, seconds: Math.round(total * 10) / 10 };
    this.lastSaySub = 'filler'; this.stats.fillers = (this.stats.fillers || 0) + 1;
    this.emit('say', this.current);
    await new Promise((r) => { const t = setTimeout(r, total * 1000); t.unref?.(); });
  }

  async speech(text, maxMs = 0) {
    let audio = null;
    // one retry: the free voice service sometimes closes a stream early or times out
    const tries = (async () => {
      if (this.tts) for (let i = 0; i < 2 && !audio; i++) { try { audio = await this.tts.synth(text); } catch (e) { audio = null; if (i) this.emit('log', `voice failed twice (${String(e?.message || e).slice(0, 80)}); the overlay uses its own voice / captions`); } }
      return audio;
    })();
    // a reply never waits forever for the voice: after maxMs the overlay speaks it with the device voice / captions
    audio = maxMs > 0 ? await Promise.race([tries, new Promise((r) => { const t = setTimeout(() => r(null), maxMs); t.unref?.(); })]) : await tries;
    if (!audio && maxMs > 0) this.emit('log', 'voice too slow, the overlay uses its own voice');
    return { text, url: audio?.url || null, duration: audio ? audio.duration : this.estimate(text), voice: audio?.voice || null, server: !!audio };
  }

  async run(job) {
    const V = this.voiceCfg;
    if (job.kind === 'reading') {
      const P = this.prophecyCfg;
      const prophecy = !!(P.enabled && (P.tiers || [1, 2, 3]).includes(job.level));
      const text = job.spoken || `${job.name}, here is what your numbers whisper. ${job.sentences.join(' ')}`;
      const pre = this.readingVoice.get(job.id); this.readingVoice.delete(job.id);
      for (const q of this.queue.slice(0, 2)) if (q.source === 'comment') this.prepareReadingVoice(q);
      const sp = { ...(((pre && (await pre)) || (await this.speech(text, 30000)))) };
      sp.start = prophecy ? Number(P.voiceOffset ?? 4.5) : V.readingSpeechStart;
      const total = Math.max(job.seconds || 0, sp.start + sp.duration + V.tailSeconds, prophecy ? Number(P.voiceOffset ?? 1.8) + Number(P.minSeconds ?? 3) : 0);
      const { reading, parsed, ...show } = job;
      this.current = { ...show, speech: sp, prophecy, seconds: Math.round(total * 10) / 10 };
      this.stats.readings++;
      if (job.userId) this.startSession(job.userId);   // their next comments are follow-ups about this reading
      this.emit('queue', this.queue);
      this.emit('reveal', this.current);
      this.timer = setTimeout(() => this.finishCurrent(), (total + this.config.limits.secondsBetweenReadings) * 1000);
      return;
    }
    // say: reply / greet / prompt / admin
    let text = job.text, source = 'rules', sp = null, cards = null, mood = job.mood || null;
    if (job.sub === 'reply') {
      const pre = this.prepared.get(job.chat.id); this.prepared.delete(job.chat.id);
      const C = this.chatCfg, made = (async () => (pre && (await pre)) || (await this.prepareReply(job.chat)))();
      // not ready at once (AI / voice still working): a short "thinking" line first, so she never sounds stuck
      if (C.thinkingFiller !== false && this.lastSaySub !== 'filler') {
        const ready = await Promise.race([made.then(() => true), new Promise((r) => { const t = setTimeout(() => r(false), C.fillerAfterMs ?? 900); t.unref?.(); })]);
        if (!ready) await this.sayFiller(job.chat);
      }
      const r = await made;
      if (r) ({ text, source, sp, cards = null, mood = null } = r);
      else { text = this.replies.reply(job.chat.comment, job.chat).text; }
    }
    if (!sp) sp = await this.speech(text, this.chatCfg.voiceMaxWaitMs ?? 14000);
    sp = { ...sp };
    sp.start = V.talkSpeechStart;
    const total = Math.max(V.minSaySeconds ?? 3, sp.start + sp.duration + V.tailSeconds);
    this.current = { id: `s${this.now()}`, kind: 'say', sub: job.sub, text, source, comment: job.chat ? { nickname: job.chat.nickname, text: job.chat.comment } : null, caption: job.caption || null, speech: sp, seconds: Math.round(total * 10) / 10,
      ...(cards ? { cards: cards.map((c) => ({ name: c.name, reversed: !!c.reversed, arcana: c.arcana, suit: c.suit || null })) } : {}), ...(mood ? { mood } : {}) };
    if (job.sub === 'reply') {
      this.stats.replies++; if (source === 'llm') this.stats.aiReplies = (this.stats.aiReplies || 0) + 1;
      this.replyStreak = this.lastReplyUser === job.chat.userId ? this.replyStreak + 1 : 1; this.lastReplyUser = job.chat.userId;
    }
    if (job.sub === 'greet') this.lastGreetTime = this.now();
    if (job.sub === 'reply' && job.chat.session) { const x = this.sessions.get(job.chat.userId); if (x && --x.left <= 0) this.sessions.delete(job.chat.userId); }
    this.lastSaySub = job.sub;
    this.emit('say', this.current);
    this.prefetch();
    this.timer = setTimeout(() => this.finishCurrent(), (total + (this.chatCfg.secondsBetweenReplies || 0)) * 1000);
  }

  finishCurrent() {
    clearTimeout(this.timer); this.timer = null;
    const was = this.current;
    this.current = null; this.busy = false;
    if (was) this.emit('done', was);
    if (!this.queue.length && !this.chatQueue.length) this.emit('idle');
    this.pump();
  }

  skip() { if (this.current) this.emit('skip', this.current); this.finishCurrent(); }
  clearQueue() { this.queue = []; this.readingVoice.clear(); this.chatQueue = []; this.emit('queue', this.queue); this.emit('chatQueue', this.chatQueue); }
  setPaused(p) { this.paused = !!p; if (!p) this.pump(); }
  toast(text, kind = 'info') { this.emit('toast', { text, kind }); }

  snapshot() {
    const a = this.ai.stats, ms = a.ms.length ? Math.round(a.ms.reduce((x, y) => x + y, 0) / a.ms.length) : null;
    return { queue: this.queue, chatQueue: this.chatQueue, current: this.current, paused: !!this.paused, stats: this.stats,
      ai: { ready: llmReady(this.config.llm), asked: a.asked, ok: a.ok, cached: a.cached, refused: a.refused, failed: a.failed, avgMs: ms, nextSlotSeconds: Math.ceil(this.ai.wait()) } };
  }
}
