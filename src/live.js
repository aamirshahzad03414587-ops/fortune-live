// Live "director": gift credits, code matching, limits, and ONE speaking queue for Mira.
// Priority: fortune readings > greetings (gifters/followers) > chat replies > idle prompts.
// Events: 'reveal' (reading), 'say' (reply/greet/prompt), 'queue', 'chatQueue', 'toast', 'gift', 'like', 'follow', 'idle', 'skip'
import { EventEmitter } from 'node:events';
import { computeReading, liveReading } from './numerology.js';
import { ReplyEngine, filterComment, llmReply, cleanSpoken, isSelfHarm, isQuestion, withQuestion, welcomeNames, spokenName } from './chat.js';
import { parseReadingComment, readingScript, showDate } from './comment-reading.js';

export const CODE_RE = /(?:^|[^A-Z0-9])#?([A-HJ-NP-Z]\d{2,4})(?![0-9])/gi;
export function extractCodes(comment) {
  const out = [];
  for (const m of String(comment || '').matchAll(CODE_RE)) out.push(m[1].toUpperCase());
  return out;
}

const CHAT_DEFAULTS = { enabled: true, mode: 'everyone', userCooldownSeconds: 30, maxQueue: 12, maxCommentAgeSeconds: 120, secondsBetweenReplies: 1,
  idlePromptSeconds: 45, idlePrompts: [], greetGifters: true, greetFollowers: true, greetCooldownSeconds: 8, maxReplyWords: 35,
  // viewers joining the LIVE: batched ("Welcome Ali, Sara and 3 others!"), at most one welcome every joinGreetSeconds
  welcomeJoins: true, joinGreetSeconds: 10, joinBatchSeconds: 2.5, joinMaxNames: 3, readQuestionAloud: true };
// Readings straight from TikTok comments ("Sara 12/05/1998 will I travel?"). No form, no codes.
// requireGift=false: everyone who comments a birth date gets one; gifters jump ahead (bigger gift = higher tier).
export const READINGS_DEFAULTS = { fromComments: true, requireGift: false, perViewerPerStream: 1, maxQueue: 10, giftPriority: true,
  freeTierName: 'Live prediction', freeSeconds: 18, howToEverySeconds: 75, privateForm: false };
const VOICE_DEFAULTS = { readingSpeechStart: 3, talkSpeechStart: 0.5, tailSeconds: 1.2 };

export const estimateSpeechSeconds = (text) => Math.max(1.5, String(text).split(/\s+/).length / 2.6);

export class LiveEngine extends EventEmitter {
  constructor({ config, store, tts = null, replies = new ReplyEngine(), llm = llmReply, now = () => Date.now(), estimate = estimateSpeechSeconds }) {
    super();
    Object.assign(this, { config, store, tts, replies, llm, now, estimate });
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
    this.prepared = new Map(); // chat id -> Promise<{ text, source, sp }> (reply + voice made while she is still talking)
    this.lastActivity = 0; this.lastHowTo = this.now(); this.pendingDates = new Map(); this.readingVoice = new Map();
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
      const parsed = ['link', 'profanity', 'spam-repeat'].includes(bad) ? null : parseReadingComment(c.comment, c.nickname);
      if (parsed) return this.enqueueCommentReading(c, parsed);
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
    if (this.pendingJoins.length > 80) this.pendingJoins.splice(0, this.pendingJoins.length - 80);
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
    const people = this.pendingJoins; this.pendingJoins = [];
    this.lastWelcomeTime = this.now(); this.stats.welcomes++;
    const names = people.map((p) => p.nickname);
    const shown = welcomeNames(names, this.chatCfg.joinMaxNames);
    return { kind: 'say', sub: 'welcome', text: this.replies.welcome(names, this.chatCfg.joinMaxNames), caption: { icon: '👋', title: 'Welcome!', text: shown }, count: people.length };
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
    const last = this.lastReplyAt.get(c.userId) || 0;
    if (this.now() - last < C.userCooldownSeconds * 1000) return { ok: false, reason: 'cooldown' };
    if (this.chatQueue.some((q) => q.userId === c.userId)) return { ok: false, reason: 'already-queued' };
    const question = isQuestion(c.comment);
    if (this.chatQueue.length >= C.maxQueue && question) {
      // a question gets in by pushing out the oldest plain comment ("hi", "nice")
      const drop = this.chatQueue.findIndex((q) => !q.question);
      if (drop >= 0) this.chatQueue.splice(drop, 1);
    }
    if (this.chatQueue.length >= C.maxQueue) return { ok: false, reason: 'chat-queue-full' };
    const item = { id: `c${this.now()}${Math.random().toString(36).slice(2, 6)}`, userId: c.userId, nickname: c.nickname, comment: String(c.comment).trim().slice(0, 200), at: this.now(), isGifter, isFollower, question };
    this.chatQueue.push(item);
    this.lastReplyAt.set(c.userId, this.now()); // cooldown counts from when we accepted the comment
    this.emit('chatQueue', this.chatQueue);
    this.pump();
    this.prefetch();
    return { ok: true, chat: item };
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
  /** c = { userId, nickname, comment }, parsed = parseReadingComment(...) */
  enqueueCommentReading(c, parsed) {
    const R = this.readingsCfg;
    const credit = this.credits.get(c.userId);
    const paid = credit && credit.expiresAt > this.now() ? credit.diamonds : 0;
    if (this.queue.some((q) => q.userId === c.userId) || this.current?.userId === c.userId) return { ok: false, reason: 'already-queued' };
    const done = this.readingsByUser.get(c.userId) || 0;
    if (done >= R.perViewerPerStream) { this.toast(`${spokenName(c.nickname)}: you already had your prediction this live 💜`, 'warn'); return { ok: false, reason: 'user-limit' }; }
    if (R.requireGift && !paid) {
      this.pendingDates.set(c.userId, { c, parsed, expiresAt: this.now() + this.config.limits.giftCreditMinutes * 60e3 });
      const gift = this.config.trigger.giftName || 'a gift';
      this.toast(`${spokenName(c.nickname)}: send ${this.config.trigger.minDiamonds > 1 ? this.config.trigger.minDiamonds + ' coins' : '1 ' + gift} for your prediction ✨`, 'hint');
      return { ok: false, reason: 'needs-gift' };
    }
    const tier = paid ? this.tierFor(paid) : null;
    // the queue cap only stops free readings; gifters always get in
    if (!paid && this.queue.length >= R.maxQueue) { this.toast(`The prediction queue is full (${R.maxQueue}). Try again in a few minutes!`, 'warn'); return { ok: false, reason: 'queue-full' }; }
    let reading;
    try { reading = computeReading({ fullName: parsed.name, dob: parsed.dob, motherName: parsed.mother, fatherName: parsed.father, question: parsed.question, year: 2026 }); } catch { return { ok: false, reason: 'bad-data' }; }
    const level = tier ? tier.level : 1;
    const item = {
      id: `d${this.now()}${Math.random().toString(36).slice(2, 5)}`, kind: 'reading', source: 'comment', code: parsed.dateText, userId: c.userId, nickname: c.nickname,
      tierName: tier ? tier.name : R.freeTierName, level, seconds: tier ? Math.min(tier.secondsOnScreen, 18 + level * 6) : R.freeSeconds,
      priority: paid && R.giftPriority ? 1 + level : 0, at: this.now(), parsed, reading,
      caption: { icon: '🔮', title: `${parsed.name} · ${showDate(parsed.date)}`, text: parsed.question || [parsed.mother && `Mother: ${parsed.mother}`, parsed.father && `Father: ${parsed.father}`].filter(Boolean).join(' · ') || `@${c.nickname}` },
      ...readingScript(reading, parsed, level),
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
      readingScript(item.reading, item.parsed, tier.level));
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
    if (R.fromComments && R.howToEverySeconds > 0 && this.now() - this.lastHowTo >= R.howToEverySeconds * 1000 && this.chatQueue.length) {
      this.lastHowTo = this.now();
      return { kind: 'say', sub: 'prompt', text: this.replies.howToAsk(), caption: { icon: '🔮', title: 'Get your prediction', text: 'Comment: your name + birth date (+ a question)' } };
    }
    while (this.chatQueue.length) {
      const c = this.chatQueue.shift();
      this.emit('chatQueue', this.chatQueue);
      if (this.now() - c.at <= C.maxCommentAgeSeconds * 1000) return { kind: 'say', sub: 'reply', chat: c };
    }
    return null;
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
    this.busy = true;
    this.run(job).catch((e) => { console.log('[director]', e); this.finishCurrent(); });
  }

  scheduleIdlePrompt() {
    clearTimeout(this.idleTimer);
    const s = this.chatCfg.idlePromptSeconds;
    if (!this.chatCfg.enabled || !s || s <= 0) return;
    this.idleTimer = setTimeout(() => {
      // only prompt while a stream is active (some activity in the last 15 minutes)
      if (this.busy || this.paused || this.now() - this.lastActivity > 15 * 60e3) return;
      this.adminLines = [...(this.adminLines || [])];
      this.busy = true;
      this.replies.liveReadings = !!this.readingsCfg.fromComments;
      if (this.replies.liveReadings) this.lastHowTo = this.now();
      this.run({ kind: 'say', sub: 'prompt', text: this.replies.idlePrompt(this.chatCfg.idlePrompts), caption: this.replies.liveReadings ? { icon: '🔮', title: 'Get your prediction', text: 'Comment: your name + birth date (+ a question)' } : null }).catch(() => this.finishCurrent());
    }, s * 1000);
    this.idleTimer.unref?.();
  }

  async makeReply(chat) {
    const L = this.config.llm || {};
    const C = this.chatCfg;
    if (isSelfHarm(chat.comment)) return { text: this.replies.reply(chat.comment, chat).text, source: 'rules' };
    if (L.enabled && L.apiKey && L.baseUrl && L.model) {
      try {
        const ctx = chat.isGifter ? 'This viewer sent a gift tonight.\n' : '';
        return { text: cleanSpoken(await this.llm(L, { nickname: chat.nickname, comment: chat.comment, context: ctx, liveReadings: !!this.readingsCfg.fromComments }), C.maxReplyWords), source: 'llm' };
      } catch (e) { this.emit('log', `LLM failed, using built-in replies: ${e.message}`); }
    }
    return { text: this.replies.reply(chat.comment, chat).text, source: 'rules' };
  }

  /** Make the next replies (text + voice) in the background so there is no pause between answers. */
  prefetch() {
    const live = new Set(this.chatQueue.map((c) => c.id));
    for (const id of this.prepared.keys()) if (!live.has(id)) this.prepared.delete(id);
    for (const c of this.chatQueue.slice(0, this.chatCfg.prefetchReplies ?? 2)) if (!this.prepared.has(c.id)) this.prepared.set(c.id, this.prepareReply(c));
  }

  async prepareReply(chat) {
    try {
      let { text, source } = await this.makeReply(chat);
      if (this.chatCfg.readQuestionAloud) text = withQuestion(chat.nickname, chat.comment, text);
      return { text, source, sp: await this.speech(text) };
    } catch { return null; }
  }

  async speech(text) {
    let audio = null;
    if (this.tts) { try { audio = await this.tts.synth(text); } catch { audio = null; } }
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
      const sp = { ...(((pre && (await pre)) || (await this.speech(text)))) };
      sp.start = prophecy ? Number(P.voiceOffset ?? 4.5) : V.readingSpeechStart;
      const total = Math.max(job.seconds || 0, sp.start + sp.duration + V.tailSeconds, prophecy ? Number(P.voiceOffset ?? 1.8) + Number(P.minSeconds ?? 3) : 0);
      const { reading, parsed, ...show } = job;
      this.current = { ...show, speech: sp, prophecy, seconds: Math.round(total * 10) / 10 };
      this.stats.readings++;
      this.emit('queue', this.queue);
      this.emit('reveal', this.current);
      this.timer = setTimeout(() => this.finishCurrent(), (total + this.config.limits.secondsBetweenReadings) * 1000);
      return;
    }
    // say: reply / greet / prompt / admin
    let text = job.text, source = 'rules', sp = null;
    if (job.sub === 'reply') {
      const pre = this.prepared.get(job.chat.id); this.prepared.delete(job.chat.id);
      const r = (pre && (await pre)) || (await this.prepareReply(job.chat));
      if (r) ({ text, source, sp } = r);
      else { text = this.replies.reply(job.chat.comment, job.chat).text; }
    }
    if (!sp) sp = await this.speech(text);
    sp = { ...sp };
    sp.start = V.talkSpeechStart;
    const total = Math.max(V.minSaySeconds ?? 3, sp.start + sp.duration + V.tailSeconds);
    this.current = { id: `s${this.now()}`, kind: 'say', sub: job.sub, text, source, comment: job.chat ? { nickname: job.chat.nickname, text: job.chat.comment } : null, caption: job.caption || null, speech: sp, seconds: Math.round(total * 10) / 10 };
    if (job.sub === 'reply') this.stats.replies++;
    if (job.sub === 'greet') this.lastGreetTime = this.now();
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
    return { queue: this.queue, chatQueue: this.chatQueue, current: this.current, paused: !!this.paused, stats: this.stats };
  }
}
