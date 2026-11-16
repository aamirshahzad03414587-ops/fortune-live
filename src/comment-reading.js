// Readings straight from TikTok comments: "Ayesha Khan 12/05/1998 mother Sara father Ali will I travel this year?"
// Finds a full birth date (with year), a name (or falls back to the TikTok display name), optional parents' names
// and an optional question. Pure functions, no I/O.
import { spokenName } from './chat.js';
import { MEANINGS, NUMBER_TITLES, PERSONAL_YEAR, QUESTION_GUIDANCE } from './meanings.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
const monthNum = (w) => MONTHS.indexOf(String(w).toLowerCase().slice(0, 3)) + 1;
const fullYear = (y) => { y = +y; return y >= 100 ? y : y > 26 ? 1900 + y : 2000 + y; };

function valid(day, month, year) {
  if (!(year >= 1900 && year <= 2026 && month >= 1 && month <= 12 && day >= 1)) return null;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= dim ? { day, month, year } : null;
}

/**
 * Finds a full birth date. Returns { day, month, year, start, end, text } or null.
 * Numeric dates are read DD/MM/YYYY; when the second number can't be a month (> 12), MM/DD/YYYY.
 */
export function findBirthDate(text) {
  const s = String(text || '');
  const tries = [
    // 1998-05-12, 1998/5/12, 1998.05.12
    [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => valid(+m[3], +m[2], +m[1])],
    // 12/05/1998, 12-5-1998, 12.05.98
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, (m) => { const a = +m[1], b = +m[2], y = fullYear(m[3]); return b > 12 && a <= 12 ? valid(b, a, y) : valid(a, b, y); }],
    // 12 May 1998, 12th of May, 1998
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_WORD}\\.?,?\\s*(\\d{4})\\b`, 'i'), (m) => valid(+m[1], monthNum(m[2]), +m[3])],
    // May 12 1998, May 12th, 1998
    [new RegExp(`\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, 'i'), (m) => valid(+m[2], monthNum(m[1]), +m[3])],
  ];
  for (const [re, fn] of tries) {
    const m = s.match(re);
    if (!m) continue;
    const d = fn(m);
    if (d) return { ...d, start: m.index, end: m.index + m[0].length, text: m[0] };
  }
  return null;
}

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
export function parseReadingComment(comment, displayName = '') {
  const text = String(comment || '').replace(/\s+/g, ' ').trim();
  const date = findBirthDate(text);
  if (!date) return null;
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
  if (!name) name = nameWords(afterNoParents.split(/\?|\b(?:will|would|can|should|when|what|how|why|kya|kab|kaise|question)\b/i)[0]);
  const nameFromProfile = !name;
  if (!name) name = spokenName(displayName);
  const pad = (n) => String(n).padStart(2, '0');
  return { name, nameFromProfile, dob: `${date.year}-${pad(date.month)}-${pad(date.day)}`, date: { day: date.day, month: date.month, year: date.year }, dateText: date.text, mother, father, question };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
/** "12 May 1998" for captions, "the 12th of May, 1998" for speech */
export const showDate = (d) => `${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}`;
export const sayDate = (d) => `the ${ord(d.day)} of ${MONTH_NAMES[d.month - 1]}, ${d.year}`;

/**
 * Short spoken prediction (about 15-25 s) for a reading asked in the comments.
 * level 1 = Life Path + Personal Year 2026 + answer; 2 adds Soul Urge; 3 adds Destiny.
 */
export function readingScript(reading, parsed, level = 1) {
  const n = reading.numbers, py = PERSONAL_YEAR[n.personalYear];
  const s = [];
  s.push(`You are Life Path ${n.lifePath}, ${MEANINGS.short.lifePath[n.lifePath]}`);
  s.push(`2026 is your Personal Year ${n.personalYear}, ${py.short}`);
  if (level >= 2) s.push(`Your heart, Soul Urge ${n.soulUrge}, ${MEANINGS.short.soulUrge[n.soulUrge]}`);
  if (level >= 3) s.push(`Your destiny, Expression ${n.expression}, ${MEANINGS.short.expression[n.expression]}`);
  if (n.mother && n.father) s.push(`Your parents' names add a ${n.mother} and a ${n.father} to your path.`);
  else if (n.mother || n.father) s.push(`Your ${n.mother ? 'mother' : 'father'}'s name adds a ${n.mother || n.father}, ${NUMBER_TITLES[n.mother || n.father].toLowerCase()}.`);
  if (reading.answer) s.push(`You asked, ${/[?]$/.test(parsed.question) ? parsed.question : parsed.question + '?'} ${QUESTION_GUIDANCE[n.personalYear][reading.answer.topic]}`);
  const lead = `${reading.displayName || parsed.name}, born ${showDate(parsed.date)}.`;
  const keyNumbers = [
    { label: 'Life Path', value: n.lifePath },
    { label: 'Year 2026', value: n.personalYear },
    { label: 'Destiny', value: n.expression },
    ...(n.mother || n.father ? [{ label: 'Family', value: n.mother || n.father }] : [{ label: 'Soul', value: n.soulUrge }]),
  ];
  return { name: parsed.name, title: NUMBER_TITLES[n.lifePath], keyNumbers, sentences: [lead, ...s], spoken: `${lead} ${s.join(" ")}` };
}
