// Mira's magic knowledge base: answers "tarot", "pull a card", "3 cards", "my zodiac", "love match Leo Aries",
// "dream about snakes", "angel number 444", "moon today", "lucky colour" ... without the AI, in varied wording,
// and gives the AI short relevant facts when it is used. For entertainment: no medical / legal / financial promises.
import { draw, cardMeaning, cardTitle, findCard, CARDS } from './tarot.js';
import { SIGNS, signsIn, signOf, compatibility, chineseOf, moonPhase } from './astro.js';
import { numerologyExtras, ymd, MASTER, KARMIC, PALM, CRYSTALS, crystalFor, findDream, angelNumber, COLOURS, NUMBER_DAY, RITUALS, DAY_VIBE, reduce } from './lore.js';

export { CARDS, SIGNS, moonPhase, signOf, chineseOf };

const any = (list, random) => list[Math.floor(random() * list.length)];
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const and = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');

/** "12/5/1998" (memory) or { day, month, year } -> { day, month, year|null } */
export function dobOf(facts = {}) {
  const d = facts.dob;
  if (!d) return null;
  if (typeof d === 'object') return d.day ? d : null;
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  return m ? { day: +m[1], month: +m[2], year: m[3] ? +m[3] : null } : null;
}

const TOPIC = (t) => (/love|crush|marr|shaadi|shadi|pyar|ishq|relationship|partner/.test(t) ? 'love' : /job|career|work|naukri|business|interview/.test(t) ? 'career'
  : /exam|study|school|college|result|padhai/.test(t) ? 'study' : /luck|lucky/.test(t) ? 'luck' : /calm|stress|sleep|peace|anx/.test(t) ? 'calm' : /money|paisa|rich/.test(t) ? 'money' : null);

export const INTENTS = [
  ['three', /\b(3|three|teen|tin)\s*(tarot\s*)?cards?\b|past,? present,? (and )?future/],
  ['cardInfo', /\b(mean|meaning|matlab)\b/, (t) => !!findCard(t)],
  ['card', /\b(tarot|pull (a |me a |one |my )?card|card (for me|pull|nikalo|nikaalo|kholo|of the day)|draw (a |me a )?card|one card|daily card|pick a card)\b|ٹیرو|टैरो/],
  ['match', /\b(love match|match|compatib\w*|vs|together|jodi|rishta)\b/, (t) => signsIn(t).length >= 2 || (/\b(love match|compatib)/.test(t) && signsIn(t).length >= 1)],
  ['chinese', /\b(chinese (zodiac|sign|horoscope|year)|year of the|chinese animal)\b/],
  ['numerology', /\b(personal (month|day)|master number|karmic( debt)?)\b/],
  ['zodiac', /\b(my (zodiac|sign|star sign|horoscope|sun sign)|zodiac|horoscope|star sign|mera sitara|mera burj|meri rashi|rashi|burj)\b|بُرج|برج|राशि/, null],
  ['signInfo', null, (t) => signsIn(t).length === 1 && t.split(/\s+/).length <= 6],
  ['dream', /\b(dream\w*|khwab\w*|khwaab\w*|sapn\w*)\b|خواب|सपन/],
  ['angel', /\bangel numbers?\b|\b(keep seeing|seeing)\s+\d{3,4}\b|^\s*(?<rep>\d)\k<rep>{2,3}\s*[!?.]*\s*$|^\s*(1010|1212|1234|1122)\s*[!?.]*\s*$/],
  ['moon', /\b(moon (today|tonight|phase|now)|moon phase|full moon|new moon|chand|chaand)\b|\btoday'?s moon\b|^\s*moon\s*[?!]*\s*$/],
  ['lucky', /\blucky\s*(colou?r|number|day|stone|crystal|rang)?\b|\bluck (colou?r|number)\b/],
  ['palm', /\b(palm|palmistry|palm reading|heart line|head line|life line|fate line|hath ki lakeer|haath ki lakeer)\b/],
  ['crystal', /\b(crystal|crystals|gemstone|stone for)\b/],
  ['ritual', /\b(ritual|spell|manifest\w*|totka)\b/],
];

export function intentOf(text) {
  const t = String(text || '').toLowerCase();
  for (const [name, re, test] of INTENTS) if ((!re || re.test(t)) && (!test || test(t))) return name;
  return null;
}

/**
 * Answer a magic command from the knowledge base, or null if it is not one.
 * ctx: { name, facts (memory facts: dob, zodiac ...), now: Date, tz (the streamer's time zone, for personal day / lucky), random, pick(cat, list) for no-repeat wording }
 * Returns { intent, text, mood, cards? }  (cards: drawn tarot cards, for the on-screen flip)
 */
export function answerMystic(comment, { name = 'friend', facts = {}, now = new Date(), random = Math.random, pick, tz = 'Asia/Dubai' } = {}) {
  const t = String(comment || '').toLowerCase();
  const intent = intentOf(t);
  if (!intent) return null;
  const P = pick || ((cat, list) => any(list, random));
  const dob = dobOf(facts);
  const say = (cat, list, v) => fill(P(cat, list), { name, ...v });
  switch (intent) {
    case 'card': {
      const [c] = draw(1, random);
      const topic = TOPIC(t);
      return { intent, mood: c.reversed ? 'thinking' : 'smile', cards: [c], text: say('kb-card', [
        '{name}, I draw {card}. It speaks of {m}.{t}',
        'Your card, {name}: {card}. That means {m}.{t}',
        '{name}, the deck chose {card} for you: {m}.{t}',
        'Ooh, {name}, {card}! {M}.{t}',
      ], { card: cardTitle(c), m: cardMeaning(c), M: cap(cardMeaning(c)), t: topic ? ` For ${topic}, take it as a gentle hint, just for fun.` : '' }) };
    }
    case 'three': {
      const cs = draw(3, random);
      const short = (c) => { let m = cardMeaning(c).split(';')[0]; if (m.split(' ').length > 7) m = m.split(/,| and /)[0]; return `${cardTitle(c)}, ${m}`; };
      return { intent, mood: 'mystic', cards: cs, text: say('kb-three', [
        '{name}, your past: {a}. Present: {b}. Future: {c}.',
        'Three cards for {name}. Behind you, {a}. Now, {b}. Ahead, {c}.',
        '{name}, the past shows {a}; today brings {b}; and the future whispers {c}.',
      ], { a: short(cs[0]), b: short(cs[1]), c: short(cs[2]) }) };
    }
    case 'cardInfo': {
      const c = findCard(t);
      return { intent, mood: 'thinking', text: say('kb-cardinfo', ['{name}, {card} upright means {up}. Reversed, it means {rev}.', '{card}, {name}? Upright: {up}. Reversed: {rev}.'], { card: c.name, up: c.up, rev: c.rev }) };
    }
    case 'match': {
      let [a, b] = signsIn(t);
      if (!b && dob) b = signOf(dob.day, dob.month);
      if (!b) return { intent, mood: 'smile', text: `${name}, name two signs, like "love match Leo Aries", and I will read the stars for you two.` };
      const c = compatibility(a, b);
      return { intent, mood: c.score >= 85 ? 'happy' : 'smile', text: say('kb-match', [
        '{name}, {a} and {b}: {score} percent! {Vibe}, because {why}.',
        '{a} with {b}, {name}? I see {vibe}: {why}. Love score {score} percent, just for fun.',
        'The stars rate {a} and {b} at {score} percent, {name}. {Vibe}; {why}.',
      ], { a: a.name, b: b.name, score: c.score, vibe: c.vibe, Vibe: cap(c.vibe), why: c.why }) };
    }
    case 'chinese': {
      if (!dob?.year) return { intent, mood: 'smile', text: `${name}, tell me your birth year, like 12 May 1998, and I will find your Chinese zodiac animal. What year were you born?` };
      const z = chineseOf(dob.year, dob.month, dob.day);
      return { intent, mood: 'smile', text: say('kb-chinese', ['{name}, you are a {el} {animal}: {traits}.{cusp}', 'Born in the year of the {animal}, {name}! {Traits}, with {el} energy.{cusp}'],
        { animal: z.animal, el: z.element, traits: z.traits, Traits: cap(z.traits), cusp: z.cusp ? ' Born near the lunar new year, so check the exact date too.' : '' }) };
    }
    case 'numerology': {
      if (!dob) return { intent, mood: 'smile', text: `${name}, give me your birth date, like 12 May 1998, and I will find your personal month and day. When were you born?` };
      const x = numerologyExtras(dob, now, tz);
      const bits = [`your Personal Month is ${x.personalMonth}, for ${DAY_VIBE[x.personalMonth]}, and today is a Personal Day ${x.personalDay}, for ${DAY_VIBE[x.personalDay]}`];
      if (/master/.test(t) || x.master.length) bits.push(x.master.length ? MASTER[x.master[0]] : 'no master number in your core, which keeps you wonderfully grounded');
      if (/karmic/.test(t) || x.karmic.length) bits.push(x.karmic.length ? KARMIC[x.karmic[0]] : 'no karmic debt numbers, a light suitcase for this life');
      return { intent, mood: 'thinking', text: `${name}, ${bits.join('. ')}.` };
    }
    case 'zodiac': case 'signInfo': {
      let s = intent === 'signInfo' ? signsIn(t)[0] : null;
      const mine = !s;
      if (!s && dob) s = signOf(dob.day, dob.month);
      if (!s) return { intent: 'zodiac', mood: 'smile', text: say('kb-askdob', ['{name}, I need your birthday for that. Write it like 12 May. When is your birthday?', '{name}, tell me your birth day and month and I will name your sign. When were you born?']) };
      return { intent: 'zodiac', mood: 'happy', text: say('kb-zodiac', [
        '{name}, {who} {sign}, {symbol}: {traits}. Watch out for being a little {shadow}. Lucky colour {colour}, crystal {crystal}.',
        '{sign}! {Who} a {el} sign ruled by {ruler}, {name}: {traits}. Your lucky day is {day}.',
        '{name}, {who} {sign}. {Traits}. Wear {colour} on {day} for extra sparkle.',
      ], { who: mine ? 'you are' : 'that is', Who: mine ? 'You are' : 'It is', sign: s.name, symbol: s.symbol, traits: and(s.traits), Traits: cap(and(s.traits)), shadow: s.shadow, colour: s.colour, crystal: s.crystal, el: s.el, ruler: s.ruler, day: s.day }) };
    }
    case 'dream': {
      const d = findDream(t);
      if (!d) return { intent, mood: 'thinking', text: `${name}, tell me what was in your dream, like "dream about snakes", and I will read its symbol.` };
      return { intent, mood: 'thinking', text: say('kb-dream', ['{name}, dreaming of {symbol} means {m}.', 'Ah, {symbol}, {name}. In dream lore that is {m}.', '{name}, {symbol} in a dream? It points to {m}.'], { symbol: d.symbol, m: d.meaning }) };
    }
    case 'angel': {
      const n = (t.match(/\d{3,4}/) || [])[0];
      if (!n) return { intent, mood: 'smile', text: `${name}, which number do you keep seeing? Tell me, like "angel number 444".` };
      return { intent, mood: 'happy', text: say('kb-angel', ['{name}, {n} is an angel number of {m}.', 'Seeing {n}, {name}? The angels say: {m}.', '{n}! {name}, the angels send {m}.'], { n, m: angelNumber(n) }) };
    }
    case 'moon': {
      const m = moonPhase(now);
      return { intent, mood: 'mystic', text: say('kb-moon', [
        '{name}, tonight the moon is a {phase}, {pct} percent lit. Its energy says: {energy}.',
        'The moon today is a {phase}, {name}, {pct} percent bright. A good time to {energy}.',
        '{name}, we are under a {phase} moon. {Energy}, my dear.',
      ], { phase: m.name, pct: Math.round(m.illumination * 100), energy: m.energy, Energy: cap(m.energy) }) };
    }
    case 'lucky': {
      // today's luck: from the birth date (Personal Day) or from the name and the date
      const today = ymd(now, tz);
      const day = dob ? numerologyExtras(dob, now, tz).personalDay : reduce([...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) + today.d + today.m * 31, false) || 1;
      const what = /number/.test(t) ? 'number' : /day/.test(t) ? 'day' : /stone|crystal/.test(t) ? 'stone' : 'colour';
      const stone = CRYSTALS[day % CRYSTALS.length];
      const v = { colour: COLOURS[day], num: day, day: NUMBER_DAY[day], stone: stone.name, why: dob ? 'your Personal Day' : 'your name and today\'s date' };
      const T = {
        colour: ['{name}, your lucky colour today is {colour}, from {why}. Your lucky number is {num}.', 'Wear a touch of {colour} today, {name}! It matches {why}.'],
        number: ['{name}, your lucky number today is {num}, and your colour is {colour}.', 'Number {num} is your lucky charm today, {name}, from {why}.'],
        day: ['{name}, your luckiest day this week is {day}. Pair it with {colour}.', 'Plan something fun on {day}, {name}; that is your lucky day.'],
        stone: ['{name}, your lucky stone today is {stone}.', 'Keep {stone} close today, {name}, for good vibes.'],
      };
      return { intent, mood: 'happy', text: say('kb-lucky-' + what, T[what], v) };
    }
    case 'palm': {
      const key = /heart/.test(t) ? 'heart' : /head/.test(t) ? 'head' : /life/.test(t) ? 'life' : /fate/.test(t) ? 'fate' : P('kb-palm', ['heart', 'head', 'shapes', 'mounts', 'sun']);
      return { intent, mood: 'thinking', text: `${name}, ${PALM[key].charAt(0).toLowerCase() + PALM[key].slice(1)}. Palm reading is a fun tradition, not a medical one.` };
    }
    case 'crystal': {
      const topic = TOPIC(t) || (dob ? null : 'general');
      const c = (topic && crystalFor(topic === 'money' ? 'career' : topic)) || (dob ? CRYSTALS.find((x) => x.name === signOf(dob.day, dob.month).crystal) : null) || CRYSTALS[Math.floor(random() * CRYSTALS.length)];
      return { intent, mood: 'smile', text: say('kb-crystal', ['{name}, try {c}, the stone of {says}.', '{name}, {c} would suit you: {says}.'], { c: c.name, says: c.says }) };
    }
    case 'ritual': {
      const topic = TOPIC(t) || 'general';
      const r = P('kb-ritual-' + topic, RITUALS[topic === 'money' ? 'career' : topic] || RITUALS.general);
      return { intent, mood: 'mystic', text: `${name}, a little ritual, just for fun: ${r}.` };
    }
    default: return null;
  }
}

/** Short facts for the AI prompt (a line or two), relevant to the comment and what is known about the viewer. */
export function mysticSnippets(comment, facts = {}, now = new Date()) {
  const t = String(comment || '').toLowerCase(), out = [];
  const dob = dobOf(facts);
  if (dob) { const s = signOf(dob.day, dob.month); out.push(`Their sign: ${s.name} (${s.el}, ${and(s.traits)}; lucky colour ${s.colour}).`); }
  for (const s of signsIn(t).slice(0, 2)) out.push(`${s.name}: ${s.el} sign, ${and(s.traits)}, can be ${s.shadow}.`);
  const c = findCard(t); if (c) out.push(`Tarot ${c.name}: upright ${c.up}; reversed ${c.rev}.`);
  if (/dream|khwab|sapn/.test(t)) { const d = findDream(t); if (d) out.push(`Dream symbol ${d.symbol}: ${d.meaning}.`); }
  const n = t.match(/\b(\d)\1{2,3}\b/); if (n) out.push(`Angel number ${n[0]}: ${angelNumber(n[0])}.`);
  if (/moon|chand|night|tonight/.test(t)) { const m = moonPhase(now); out.push(`Moon today: ${m.name}, ${Math.round(m.illumination * 100)}% lit (${m.energy}).`); }
  const tp = TOPIC(t); if (tp && tp !== 'money') { const cr = crystalFor(tp); if (cr) out.push(`Crystal for ${tp}: ${cr.name} (${cr.says}).`); }
  return out.length ? `Mystic facts you may use: ${out.slice(0, 4).join(' ')}\n` : '';
}

/** Lines for quiet moments that teach the commands. */
export const COMMAND_PROMPTS = [
  'Want a tarot card? Type "pull a card" and I will draw one for you!',
  'Type "3 cards" for your past, present and future in tarot.',
  'Curious about love? Type "love match", then two signs, like "love match Leo Aries".',
  'Had a strange dream? Type "dream about" and the symbol, like "dream about snakes".',
  'Keep seeing the same numbers? Type "angel number 444" and I will tell you its message.',
  'Type "moon today" to hear what tonight\'s moon brings.',
  'Type "lucky colour" for your lucky colour today.',
  'Type "my zodiac" and I will read your star sign.',
];
