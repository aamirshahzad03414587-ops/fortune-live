// Readings straight from TikTok comments: "Ayesha Khan 12/05/1998 mother Sara father Ali will I travel this year?"
// Finds a full birth date (with year), a name (or falls back to the TikTok display name), optional parents' names
// and an optional question. Pure functions, no I/O.
import { spokenName } from './chat.js';
import { findDates, MONTH_NAMES as MN, ord as ordinal } from './dates.js';
import { classifyQuestion } from './numerology.js';
import { NUMBER_TITLES, QUESTION_GUIDANCE } from './meanings.js';
import { choose, READING_T, LP_SHORT, PY_SHORT, SOUL_SHORT, EXPR_SHORT } from './variety.js';

// dates: the forgiving reader in dates.js (typos, ordinals, words, 2-digit years, no separators, other scripts)

/**
 * Finds a full birth date (with a year). Returns { day, month, year, start, end, text } or null.
 * Numeric dates are read DD/MM/YYYY; when the second number can't be a month (> 12), MM/DD/YYYY.
 */
export function findBirthDate(text) {
  const d = findDates(text).find((x) => x.year && !x.impossible);
  return d ? { day: d.day, month: d.month, year: d.year, start: d.start, end: d.end, text: d.text, ambiguous: d.ambiguous, alt: d.alt } : null;
}

const BIRTH_WORD = /\b(dob|d\.o\.b|born|birth ?day|birth ?date|date of birth|paida|paidaish|janam|janamdin|tareekh|tarikh)\b|پیدائش|تاریخ|जन्म|ميلاد/i;
const PARENT_RE = /\b(mother|mom|mum|mama|ammi|ammi jaan|maa|mother'?s name|mom'?s name|father|dad|papa|abbu|abba|baba|father'?s name|dad'?s name)\b\s*(?:name\s*)?(?:is|:|-|=)?\s*/gi;
const Q_WORDS = /^(will|would|can|could|should|shall|is|are|am|do|does|did|when|what|whats|what's|where|who|why|how|which|kya|kab|kaise|kaisi|kese|kyun|kyon|kon|kaun|kitna|kahan|meri|mera)\b/i;
const FILLER = /\b(my|name|is|naam|hai|mera|meri|i am|i'm|im|this is|it'?s|hello|hi|hey|salam|salaam|assalam o alaikum|aoa|mira|please|pls|plz|dob|d\.o\.b|date of birth|birth ?date|birthday|born|on|date|reading|prediction|for me|me|and|my name is)\b/gi;
const NOT_NAME = /^(the|a|an|and|or|i|you|me|my|mira|love|job|money|will|what|when|how|why|who|is|are|question|q|please|future|year|this|next|reading|prediction|birthday|born|hi|hello|hey|salam|dob|tell|about|predict|for|with|of|to|in|on|worried|sick|says|said|wants|told|not|no|also|too|was|very|so)$/i;

function nameWords(chunk, max = 3) {
  const words = String(chunk || '').replace(FILLER, ' ').replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) { if (NOT_NAME.test(w) || w.length < 2) { if (out.length) break; continue; } out.push(w); if (out.length >= max) break; }
  return out.length ? out.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
}

/**
 * Parses a reading request from a public comment. Returns null unless it has a full birth date.
 * { name, nameFromProfile, dob: 'YYYY-MM-DD', date: {day,month,year}, dateText, mother, father, question }
 */
export function parseReadingComment(comment, displayName = '', { allowNoYear = false, askAmbiguous = false } = {}) {
  const text = String(comment || '').replace(/\s+/g, ' ').trim();
  const all = findDates(text);
  let date = all.find((x) => x.year && !x.impossible) || null;
  let check = null;   // Mira should ask before reading: { reason: 'impossible' | 'ambiguous', options }
  if (!date) {
    const d = all[0];
    if (!d) return null;
    // a date without a year: a birthday + Personal Year reading (numbers without separators need a birth word or a short comment)
    if (!d.impossible && allowNoYear && (d.monthWord || BIRTH_WORD.test(text) || text.split(' ').length <= 4)) date = d;
    else if (d.impossible) { date = d; check = { reason: 'impossible', options: [] }; }
    else return null;
  }
  if (!check && date.ambiguous && askAmbiguous) check = { reason: 'ambiguous', options: [pickD(date), date.alt] };
  return { ...partsAround(text, date, displayName), date: pickD(date), dateText: date.text, ...(date.year ? {} : { partial: true }), ...(check ? { check } : {}),
    dob: date.year ? isoDob(date) : null, ambiguous: !!date.ambiguous, alt: date.alt || null };
}

const pickD = (d) => ({ day: d.day, month: d.month, year: d.year ?? null });
const pad = (n) => String(n).padStart(2, '0');
export const isoDob = (d) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** Name, parents and question around the date (the name may come before or after it). */
function partsAround(text, date, displayName) {
  const before = text.slice(0, date.start), after = text.slice(date.end);
  // parents: "mother Sara father Ali", "ammi Nadia, abbu Imran", "mom's name is Hina"
  let mother = '', father = '';
  const cut = (str) => {
    let out = str, m; const re = new RegExp(PARENT_RE.source, 'gi');
    const found = [];
    while ((m = re.exec(str))) found.push({ who: /moth|mom|mum|mama|ammi|maa/i.test(m[1]) ? 'mother' : 'father', at: m.index, end: m.index + m[0].length });
    for (let i = found.length - 1; i >= 0; i--) {
      const f = found[i];
      const seg = str.slice(f.end, i + 1 < found.length ? found[i + 1].at : str.length);
      const words = seg.match(/^[\s,:-]*([\p{L}'-]+)(\s+[\p{L}'-]+)?/u);
      let nm = '', len = 0;
      if (words) {
        const two = words[2] && !NOT_NAME.test(words[2].trim()) && !Q_WORDS.test(words[2].trim());
        nm = nameWords(two ? words[1] + words[2] : words[1], 2);
        len = nm ? (two ? words[0].length : words[0].length - (words[2] || '').length) : 0;
      }
      if (f.who === 'mother') mother = nm || mother; else father = nm || father;
      out = out.slice(0, f.at) + ' ' + out.slice(f.end + len);
    }
    return out;
  };
  const beforeName = cut(before), afterNoParents = cut(after);
  let question = '';
  const qm = afterNoParents.match(/(?:question\s*[:-]?\s*)?((?:will|would|can|could|should|shall|is|are|am|do|does|did|when|what|whats|what's|where|who|why|how|which|kya|kab|kaise|kaisi|kese|kyun|kyon|kon|kaun|kitna|kahan|meri|mera)\b[^]*$)/i)
    || afterNoParents.match(/([^.!,;]*\?)/) || beforeName.match(/((?:will|should|can|when|what|how|kya|kab)\b[^]*\?)/i);
  if (qm) question = qm[1].replace(/\s+/g, ' ').replace(/^[\s,.:;-]+/, '').trim();
  if (question && !/\?$/.test(question) && !Q_WORDS.test(question)) question = '';
  question = question.slice(0, 140);
  // name: words before the date, else right after it (before the question / parents)
  let name = nameWords(beforeName.replace(question, ''));
  if (!name) name = nameWords((question ? afterNoParents.replace(question, ' ') : afterNoParents).split(/\?|\b(?:will|would|can|should|when|what|how|why|kya|kab|kaise|question)\b/i)[0]);
  const nameFromProfile = !name;
  if (!name) name = spokenName(displayName);
  return { name, nameFromProfile, mother, father, question };
}

/** A reading for a date someone confirmed later (answer to Mira's question, or the AI parser): same shape as parseReadingComment. */
export function parsedWithDate(comment, displayName, d, name = '') {
  const text = String(comment || '').replace(/\s+/g, ' ').trim();
  const p = partsAround(text, { start: text.length, end: text.length }, displayName);
  if (name) { p.name = name; p.nameFromProfile = false; }
  const date = pickD(d);
  return { ...p, date, dateText: showDate(date), dob: date.year ? isoDob(date) : null, ...(date.year ? {} : { partial: true }), ambiguous: false, alt: null };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
/** "12 May 1998" for captions, "the 12th of May, 1998" for speech */
export const showDate = (d) => `${d.day} ${MONTH_NAMES[d.month - 1]}${d.year ? ' ' + d.year : ''}`;
export const sayDate = (d) => `the ${ord(d.day)} of ${MONTH_NAMES[d.month - 1]}${d.year ? ', ' + d.year : ''}`;

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

/**
 * Short spoken prediction (about 15-25 s) for a reading asked in the comments.
 * level 1 = Life Path + Personal Year 2026 + answer; 2 adds Soul Urge; 3 adds Destiny.
 * variety (a Variety from variety.js, one per stream) makes the wording differ for everyone, especially for people
 * who share a birth date; without it the wording still depends on the name + birth date.
 */
export function readingScript(reading, parsed, level = 1, variety = null) {
  const n = reading.numbers, who = `${parsed.name}|${parsed.dob}`, dob = parsed.dob;
  const pick = (cat, list) => (variety ? variety.choose(cat, list, who, dob) : choose(cat, list, who));
  const name = reading.displayName || parsed.name, first = String(parsed.name).split(' ')[0];
  const s = [];
  s.push(fill(pick('lp-frame', READING_T.lifePath), { n: n.lifePath, m: pick('lp-' + n.lifePath, LP_SHORT[n.lifePath]) }));
  s.push(fill(pick('py-frame', READING_T.year), { n: n.personalYear, m: pick('py-' + n.personalYear, PY_SHORT[n.personalYear]) }));
  if (level >= 2) s.push(fill(pick('su-frame', READING_T.soul), { n: n.soulUrge, m: pick('su-' + n.soulUrge, SOUL_SHORT[n.soulUrge]) }));
  if (level >= 3) s.push(fill(pick('ex-frame', READING_T.expression), { n: n.expression, m: pick('ex-' + n.expression, EXPR_SHORT[n.expression]) }));
  if (n.mother && n.father) s.push(fill(pick('parents2', READING_T.parentsBoth), { a: n.mother, b: n.father, M: parsed.mother || 'your mother', F: parsed.father || 'your father' }));
  else if (n.mother || n.father) {
    const isM = !!n.mother, num = n.mother || n.father;
    s.push(fill(pick('parents1', READING_T.parentOne), { who: isM ? 'mother' : 'father', P: (isM ? parsed.mother : parsed.father) || (isM ? 'your mother' : 'your father'), a: num, title: NUMBER_TITLES[num].toLowerCase() }));
  }
  if (reading.answer) s.push(fill(pick('question', READING_T.question), { q: /[?]$/.test(parsed.question) ? parsed.question : parsed.question + '?', g: QUESTION_GUIDANCE[n.personalYear][reading.answer.topic] }));
  else if (level === 1 && !n.mother && !n.father) { const c = fill(pick('closer', READING_T.closer), { first }); if (c) s.push(c); }
  const lead = fill(pick('lead', READING_T.lead), { name, date: showDate(parsed.date) });
  const keyNumbers = [
    { label: 'Life Path', value: n.lifePath },
    { label: 'Year 2026', value: n.personalYear },
    { label: 'Destiny', value: n.expression },
    ...(n.mother || n.father ? [{ label: 'Family', value: n.mother || n.father }] : [{ label: 'Soul', value: n.soulUrge }]),
  ];
  return { name: parsed.name, title: NUMBER_TITLES[n.lifePath], keyNumbers, sentences: [lead, ...s], spoken: `${lead} ${s.join(' ')}` };
}

/**
 * No birth year: a shorter reading from what the day and month give - Birthday number, Personal Year 2026, the
 * answer to their question - and an invitation to give the year next time for the Life Path. Same shape as readingScript.
 */
export function partialScript(parsed, variety = null) {
  const { day, month } = parsed.date, who = `${parsed.name}|${day}-${month}`;
  const pick = (cat, list) => (variety ? variety.choose(cat, list, who, `${day}-${month}`) : choose(cat, list, who));
  const red = (n, keep = true) => { n = Math.abs(n); while (n > 9 && !(keep && [11, 22, 33].includes(n))) n = String(n).split('').reduce((a, b) => a + +b, 0); return n; };
  const birthday = red(day), py = red(red(month, false) + red(day, false) + red(2026, false), false);
  const first = String(parsed.name).split(' ')[0];
  const s = [
    fill(pick('bd-frame', BIRTHDAY_T), { n: birthday, m: pick('lp-' + birthday, LP_SHORT[birthday] || LP_SHORT[red(birthday, false)]) }),
    fill(pick('py-frame', READING_T.year), { n: py, m: pick('py-' + py, PY_SHORT[py]) }),
  ];
  const topic = classifyQuestion(parsed.question);
  if (topic) s.push(fill(pick('question', READING_T.question), { q: /[?]$/.test(parsed.question) ? parsed.question : parsed.question + '?', g: QUESTION_GUIDANCE[py][topic] }));
  s.push(fill(pick('no-year', NO_YEAR_T), { first }));
  const lead = fill(pick('lead', READING_T.lead), { name: parsed.name, date: showDate(parsed.date) });
  return { name: parsed.name, title: NUMBER_TITLES[birthday], keyNumbers: [{ label: 'Birthday', value: birthday }, { label: 'Year 2026', value: py }],
    sentences: [lead, ...s], spoken: `${lead} ${s.join(' ')}` };
}
const BIRTHDAY_T = ['Your Birthday number is {n}, so you are {m}', 'Born on that day, your Birthday number is {n}: you are {m}', 'The day you were born gives you the number {n}. You are {m}'];
const NO_YEAR_T = ['Tell me your birth year next time, {first}, and I will reveal your Life Path too.', 'Add your birth year, {first}, and the crystal ball will show your Life Path.', 'With your birth year I can read your Life Path as well, {first}.'];
