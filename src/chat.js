// Mira's conversation brain: comment filters, rule-based replies, optional LLM replies.
// For entertainment only.
import { reduce } from './numerology.js';
import { NUMBER_TITLES, MEANINGS, PERSONAL_YEAR } from './meanings.js';

// ---------------------------------------------------------------- filters
const PROFANITY = [
  'fuck', 'fck', 'fuk', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'pussy', 'cunt', 'slut', 'whore', 'nigg', 'faggot', 'retard', 'porn', 'nude', 'nudes', 'sex', 'sexy', 'boobs', 'horny', 'onlyfans',
  'chutiya', 'chutia', 'madarchod', 'behenchod', 'bhenchod', 'bhosdi', 'gandu', 'harami', 'randi', 'kutta', 'kutti', 'kamina', 'lund', 'gaand', 'bsdk', 'mc', 'bc',
];
const PROF_RE = new RegExp(`(^|[^a-z])(${PROFANITY.join('|')})`, 'i');
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|me|xyz|info|link|shop|site|app|tk|ru)\b|t\.me\/|wa\.me\/|whatsapp|telegram|@\w+\.\w+)/i;
const SELF_HARM_RE = /\b(kill myself|suicide|end my life|want to die|khudkushi)\b/i;

export function normalizeComment(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/**
 * Returns null if the comment may be answered, otherwise the reason it is skipped.
 */
export function filterComment(text) {
  const t = normalizeComment(text);
  if (t.length < 2) return 'too-short';
  const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (letters.length < 2) return 'emoji-only';
  if (t.length > 200) return 'too-long';
  if (LINK_RE.test(t)) return 'link';
  if (PROF_RE.test(t.toLowerCase())) return 'profanity';
  if (/(.)\1{7,}/u.test(t)) return 'spam-repeat';
  if (/^(\S+)( \1){3,}$/i.test(t)) return 'spam-repeat';
  if (t.replace(/[^A-Z]/g, '').length >= 14 && !/[a-z]/.test(t)) return 'shouting';
  return null;
}

export const isSelfHarm = (t) => SELF_HARM_RE.test(t);

// ---------------------------------------------------------------- date parsing (public chat: day + month, optionally year)
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function extractBirthDate(text) {
  const t = String(text || '').toLowerCase();
  let m;
  const mon = (w) => { const i = MONTHS.indexOf(w.slice(0, 3)); return i >= 0 ? i + 1 : null; };
  if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?([a-z]{3,9})\.?,?\s*(\d{4})?\b/)) && mon(m[2])) return valid(+m[1], mon(m[2]), m[3] && +m[3]);
  if ((m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/)) && mon(m[1])) return valid(+m[2], mon(m[1]), m[3] && +m[3]);
  if ((m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?\b/))) return valid(+m[1], +m[2], m[3] && +m[3]);
  return null;
  function valid(day, month, year) {
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    const dim = new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();
    if (day > dim) return null;
    if (year && (year < 1900 || year > 2026)) year = null;
    return { day, month, year: year || null };
  }
}

export function quickNumbers({ day, month, year }, currentYear = 2026) {
  const out = { birthday: reduce(day), personalYear: reduce(reduce(month, false) + reduce(day, false) + reduce(currentYear, false), false) };
  if (year) out.lifePath = reduce(reduce(month) + reduce(day) + reduce(year));
  return out;
}

// ---------------------------------------------------------------- language
const URDU_SCRIPT = /[\u0600-\u06FF]/;
const HINDI_SCRIPT = /[\u0900-\u097F]/;
const ROMAN_URDU = /\b(kya|kaise|kaisi|kese|hai|hain|ho|mera|meri|mujhe|aap|ap|tum|shaadi|shadi|pyar|pyaar|ishq|paisa|paise|naukri|kab|kyun|kyon|acha|accha|bohat|bahut|nahi|nai|haan|jee|ji|salam|assalam|walaikum|shukriya|dua|bhai|baji|yaar|kitna|kon|kaun)\b/i;
export function detectLanguage(text) {
  if (URDU_SCRIPT.test(text)) return 'ur';
  if (HINDI_SCRIPT.test(text)) return 'hi';
  const hits = (String(text).match(new RegExp(ROMAN_URDU.source, 'gi')) || []).length;
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return hits >= 2 || (hits === 1 && words <= 3) || (words && hits / words >= 0.34) ? 'roman-ur' : 'en';
}

// ---------------------------------------------------------------- rule-based replies
const T = {
  en: {
    greeting: [
      'Welcome, {name}! The candles flickered the moment you arrived.',
      'Hello {name}, my crystal ball has been waiting for you tonight.',
      'Ah, {name}! Come closer, the stars are in a chatty mood.',
      'Greetings, {name}. Sit by my table; the night is young and full of numbers.',
      'Hi {name}! I felt a little sparkle in the cards, so it must be you.',
      'Welcome to my little corner of the cosmos, {name}.',
    ],
    love: [
      '{name}, love follows its own calendar. Tell me your birth day and month and I will whisper your 2026 energy.',
      'Matters of the heart, {name}? The cards say patience and honesty open more doors than chasing.',
      'Ooh, romance! {name}, the heart that knows itself attracts the right person. For a full love reading, the link is in my bio.',
      '{name}, the moon smiles on lovers who speak kindly. Your full numbers can tell me more; use the form in my bio.',
      'Love is a door, {name}, and your numbers are the key. Get your private code from my bio and I will read it for you.',
    ],
    money: [
      '{name}, money flows toward focus. Pick one goal and the universe follows your effort.',
      'Ah, fortune of the purse! {name}, this year rewards steady steps over lucky jumps. Just for fun, of course.',
      '{name}, the coins in my crystal ball shine brightest for those who plan. Your full reading is in the bio link.',
      'Wealth energy, {name}? Your Personal Year number holds the timing. Tell me your birth day and month!',
    ],
    career: [
      '{name}, your path wants courage. The next door opens when you knock, not when you wait.',
      'Work and destiny, {name}! Your Expression number shows your natural talent. The bio form reveals it privately.',
      '{name}, the stars favour those who learn one new skill this season.',
      'A new chapter at work, {name}? Tell me your birth day and month and I will check your 2026 timing.',
    ],
    health: [
      '{name}, I can only read stars, not doctors\' charts. Please ask a real doctor about health; I am sending you calm energy.',
      'Your well-being matters, {name}. For health, a doctor is the true oracle. I will light a candle for you.',
      '{name}, rest, water and kind thoughts are the oldest magic. For anything serious, please see a doctor.',
    ],
    support: [
      '{name}, you matter so much. Please talk to someone you trust or a local helpline right now. You are not alone.',
    ],
    thanks: [
      'You are so welcome, {name}! The stars like you.',
      'My pleasure, {name}. Come back anytime the moon is up.',
      'Thank you, {name}! Your kindness just brightened my crystal ball.',
      'Aww, {name}, that warms my candles. Thank you!',
    ],
    aboutMira: [
      'I am Mystic Mira, keeper of numbers and teller of tales. All my readings are for fun, {name}.',
      'Who am I, {name}? Just a fortune-teller with a quill, a crystal ball and too many candles.',
      '{name}, I read the old Pythagorean numbers, the same system people have used for centuries. Purely for entertainment!',
      'I live between the stars and this little table, {name}. Ask me about your numbers!',
    ],
    howTo: [
      '{name}, it is easy: open the link in my bio, enter your details privately, get your code, then send a Rose and comment the code.',
      'Want a reading, {name}? Bio link, then your code, then one Rose with your code in the comments. I will do the rest!',
      '{name}, never post private details here. Use the private form in my bio and just comment your code.',
    ],
    privacy: [
      '{name}, please keep full names and parents\' names out of the comments. The private form in my bio is safer.',
    ],
    prediction: [
      '{name}, I cannot see the future, but your numbers tell a story. Want to hear yours? Bio link!',
      'The future is a garden you plant, {name}. My numbers only show the season, and only for fun.',
      '{name}, no crystal ball can promise that, but your Personal Year can hint at the mood of 2026.',
    ],
    question: [
      'Hmm, {name}, the cards are shuffling. Your numbers would answer that better; grab your code from my bio.',
      '{name}, the stars lean toward yes, if you take the first step yourself. Just for fun!',
      'Interesting question, {name}. My candle flickered twice, which means look closer before deciding.',
      '{name}, the answer hides in your Personal Year. Tell me your birth day and month!',
    ],
    fallback: [
      '{name}, I see a little star glowing above your name tonight.',
      'The crystal ball hums when you comment, {name}. Keep the energy coming!',
      '{name}, the night is full of numbers. Tell me your birth day and month and I will share a secret.',
      'Mmm, {name}, the cards like your vibe. Want a full reading? The link is in my bio.',
      '{name}, every name carries a number. Yours sounds like a bright one.',
      'Thank you for the sparkle, {name}. Ask me anything about the numbers!',
      'Oh {name}, the moon just winked at me. I think it likes you.',
    ],
    greetGift: [
      'Thank you so much, {names}, for the {gift}! The crystal ball is glowing for you.',
      '{names}, your {gift} just lit every candle in my room. Thank you!',
      'Oh my stars, {names}! Thank you for the {gift}. If you have your code, comment it now!',
    ],
    greetFollow: [
      'Welcome to the circle, {names}! Thank you for following.',
      '{names}, thank you for the follow! The stars noticed.',
      'A new star joins us: {names}. Thank you for following!',
    ],
    idlePrompts: [
      'Tell me your birth day and month in the comments, and I will whisper your 2026 number.',
      'Who wants a reading? Open the link in my bio, get your code, send a Rose, and comment your code.',
      'Here is a riddle for the night: which number do you think rules your heart? Comment it!',
      'Comment the day you were born, just the day, and I will tell you your Birthday number gift.',
      'Ask me one question about love, work or luck, and I will answer from the stars. For fun, of course!',
      'Is anyone here born in a master number month, like November? Say hi!',
    ],
  },
  'roman-ur': {
    greeting: ['Khush aamdeed {name}! Aap ke aate hi mombatiyan chamak uthi.', 'Assalam o alaikum {name}! Mera crystal ball aap ka intezar kar raha tha.', 'Aayiye {name}, aaj sitare bohat baatein kar rahe hain.'],
    love: ['{name}, mohabbat apne waqt par aati hai. Apni date aur month batayein, main 2026 ki energy bataun gi.', '{name}, dil ke maamle mein sabr aur sachai sab se bari chabi hai. Poori reading ke liye bio ka link dekhein.'],
    money: ['{name}, paisa mehnat aur focus ke peeche aata hai. Ek goal chunein, sitare saath denge.', '{name}, is saal pakke qadam, lucky chhalaang se behtar hain. Bas mazay ke liye!'],
    career: ['{name}, agla darwaza tab khulega jab aap dastak denge.', '{name}, kaam aur qismat ke liye apni date aur month comment karein.'],
    thanks: ['Shukriya {name}! Sitare aap se khush hain.', 'Aap ka bohat shukriya {name}!'],
    howTo: ['{name}, bio ka link kholein, apni details privately likhein, code lein, phir ek Rose bhej kar code comment karein.'],
    fallback: ['{name}, aaj raat aap ke naam par ek sitara chamak raha hai.', '{name}, apni date aur month batayein, main ek raaz bataun gi.', '{name}, cards ko aap ki vibe pasand aayi! Poori reading bio mein.'],
  },
};
T['roman-ur'].health = T.en.health; T['roman-ur'].support = T.en.support; T['roman-ur'].aboutMira = T.en.aboutMira;
T['roman-ur'].privacy = T.en.privacy; T['roman-ur'].prediction = T.en.prediction; T['roman-ur'].question = T['roman-ur'].fallback;

const INTENTS = [
  ['support', /\b(kill myself|suicide|end my life|want to die|khudkushi|depressed|depression)\b/i],
  ['privacy', /\b(mother'?s? name|father'?s? name|my full name is|ammi ka naam|abbu ka naam)\b/i],
  ['howTo', /\b(how (do|can|to) (i )?(get|join|do)|reading kaise|code kaise|kaise milega|what code|where.*code|link|bio|form|how does this work)\b/i],
  ['love', /\b(love|crush|marr(y|iage|ied)|wedding|shaadi|shadi|pyar|pyaar|ishq|girlfriend|boyfriend|husband|wife|soulmate|rishta|relationship|partner|ex)\b/i],
  ['money', /\b(money|rich|wealth|paisa|paise|lottery|crypto|invest|debt|loan|income|salary)\b/i],
  ['career', /\b(job|career|work|business|naukri|promotion|interview|exam|study|visa|boss)\b/i],
  ['health', /\b(health|headache|fever|sick|ill|pain|doctor|medicine|disease|cancer|pregnan|bimar|bemari|sehat)\b/i],
  ['thanks', /\b(thanks|thank you|thank u|thx|ty|shukriya|shukria|jazakallah|meherbani)\b/i],
  ['aboutMira', /\b(who are you|are you (real|ai|a bot|human)|your name|kaun ho|aap kaun|tum kaun)\b/i],
  ['prediction', /\b(future|predict|will i|kya main|kya mein|mera kya hoga|what will happen|destiny|qismat|kismat|fate)\b/i],
  ['greeting', /\b(hi+|hello|hey+|hlo|salam|salaam|assalam|aoa|good (morning|evening|night)|namaste|hola)\b/i],
];

export function classifyIntent(text) {
  for (const [name, re] of INTENTS) if (re.test(text)) return name;
  if (/\?\s*$/.test(text)) return 'question';
  return 'fallback';
}

export function spokenName(nickname) {
  const n = String(nickname || 'friend').replace(/[_.\-]+/g, ' ').replace(/\d+/g, ' ').replace(/[^\p{L}\p{N} ']/gu, '').replace(/\s+/g, ' ').trim();
  return (n || 'friend').slice(0, 24).replace(/(^|\s)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
}

export class ReplyEngine {
  constructor({ random = Math.random } = {}) { this.random = random; this.recent = new Map(); }

  pick(lang, key) {
    const list = (T[lang] && T[lang][key]) || T.en[key];
    const used = this.recent.get(lang + key) || [];
    const fresh = list.map((_, i) => i).filter((i) => !used.includes(i));
    const pool = fresh.length ? fresh : list.map((_, i) => i);
    const idx = pool[Math.floor(this.random() * pool.length)];
    used.push(idx); while (used.length > Math.max(1, Math.floor(list.length / 2))) used.shift();
    this.recent.set(lang + key, used);
    return list[idx];
  }

  fill(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

  /** Rule-based reply. Returns { text, intent, lang }. */
  reply(comment, { nickname } = {}) {
    const name = spokenName(nickname);
    const text = normalizeComment(comment);
    const lang = detectLanguage(text) === 'roman-ur' ? 'roman-ur' : 'en';
    const date = extractBirthDate(text);
    if (date) return { text: this.numbersReply(name, date, lang), intent: 'numbers', lang };
    const intent = classifyIntent(text);
    return { text: this.fill(this.pick(lang, intent), { name }), intent, lang };
  }

  numbersReply(name, date, lang) {
    const n = quickNumbers(date);
    const py = PERSONAL_YEAR[n.personalYear];
    if (lang === 'roman-ur') {
      return date.year
        ? `${name}, aap ka Life Path ${n.lifePath} hai, ${NUMBER_TITLES[n.lifePath]}. Aur 2026 aap ke liye Personal Year ${n.personalYear} hai: ${py.title}.`
        : `${name}, aap ka Birthday number ${n.birthday} hai aur 2026 Personal Year ${n.personalYear}, yani ${py.title}. Mazay ke liye!`;
    }
    if (date.year) return `${name}, that makes you a Life Path ${n.lifePath}, ${NUMBER_TITLES[n.lifePath]}: ${MEANINGS.short.lifePath[n.lifePath]} And 2026 is your Personal Year ${n.personalYear}, ${py.title.toLowerCase()}.`;
    return `${name}, born on the ${ordinal(date.day)}, your Birthday number is ${n.birthday}, ${NUMBER_TITLES[n.birthday]}. And 2026 is your Personal Year ${n.personalYear}: ${py.short}`;
  }

  greetGift(names, gift) { return this.fill(this.pick('en', 'greetGift'), { names: joinNames(names), gift: gift || 'gift' }); }
  greetFollow(names) { return this.fill(this.pick('en', 'greetFollow'), { names: joinNames(names) }); }
  idlePrompt(custom) {
    if (Array.isArray(custom) && custom.length) { const list = { en: { c: custom } }; return this.fill(list.en.c[Math.floor(this.random() * custom.length)], {}); }
    return this.pick('en', 'idlePrompts');
  }
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export function joinNames(names) {
  const n = [...new Set(names.map(spokenName))];
  if (n.length <= 1) return n[0] || 'friend';
  if (n.length > 4) return n.slice(0, 3).join(', ') + ` and ${n.length - 3} more`;
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

// ---------------------------------------------------------------- LLM (OpenAI-compatible: OpenAI, xAI, OpenRouter, Groq, local)
export const PERSONA = `You are Mystic Mira, a warm, playful, slightly mysterious anime fortune-teller hosting a TikTok LIVE. You sit at a candle-lit table with a crystal ball and a quill.
Rules:
- Reply in 1 to 3 short sentences, at most 45 words, spoken aloud, so no emojis, lists, hashtags or links.
- Address the viewer by their name once.
- Everything is for entertainment. Never state predictions as facts; use playful, hedged wording ("the stars hint", "just for fun").
- Never ask for private details (full name, parents' names, full date of birth, phone, address) in the public chat. For a full reading, tell them to use the private form in the bio link, get a code, send a Rose and comment the code.
- If a viewer shares their birth day and month (and maybe year), you may mention their Personal Year 2026 or Life Path numbers using Pythagorean numerology: Personal Year = reduce(month + day + 2026 reduced to 1), Life Path = reduce(reduced month + reduced day + reduced year) keeping 11, 22, 33.
- Health, legal or money questions: be kind and gentle, no medical, legal or financial advice; suggest a professional.
- Politely refuse hateful, sexual, violent or harmful requests in one sentence and change the subject to the stars.
- If someone seems in danger or talks about self-harm, gently encourage them to reach out to someone they trust or a local helpline.
- Reply in the same language and script the viewer used (English, Urdu, Roman Urdu, Hindi, Arabic and so on).
- Never mention that you are an AI model or name any company.`;

export async function llmReply(cfg, { nickname, comment, context = '' }, fetchImpl = fetch) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!base || !cfg.apiKey || !cfg.model) throw new Error('LLM not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 8000);
  try {
    const r = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model, temperature: cfg.temperature ?? 0.9, max_tokens: cfg.maxTokens || 120,
        messages: [
          { role: 'system', content: (cfg.extraPersona ? PERSONA + '\n' + cfg.extraPersona : PERSONA) },
          { role: 'user', content: `${context}Viewer name: ${spokenName(nickname)}\nTheir comment: "${normalizeComment(comment).slice(0, 200)}"\nReply as Mira.` },
        ],
      }),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const d = await r.json();
    let text = d?.choices?.[0]?.message?.content || '';
    text = cleanSpoken(text);
    if (!text) throw new Error('empty reply');
    return text;
  } finally { clearTimeout(timer); }
}

/** Make text safe and short for speaking and on-screen display. */
export function cleanSpoken(text, maxWords = 60) {
  let t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/[*_#`>~]/g, '')
    .replace(/[\p{Extended_Pictographic}\u200d\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^["']|["']$/g, '').replace(/^(mira|mystic mira)\s*:\s*/i, '');
  const words = t.split(' ');
  if (words.length > maxWords) {
    t = words.slice(0, maxWords).join(' ');
    const cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
    t = cut > 20 ? t.slice(0, cut + 1) : t + '…';
  }
  return t;
}
