// Pythagorean numerology engine. Pure, deterministic: same input -> same output.
// For entertainment purposes only.
import { MEANINGS, NUMBER_TITLES, PERSONAL_YEAR, QUESTION_GUIDANCE } from './meanings.js';

export const MASTER_NUMBERS = [11, 22, 33];
export const VALID_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33];

// A J S = 1, B K T = 2, C L U = 3, D M V = 4, E N W = 5, F O X = 6, G P Y = 7, H Q Z = 8, I R = 9
const LETTER_VALUES = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch, i) => { LETTER_VALUES[ch] = (i % 9) + 1; });
export { LETTER_VALUES };

const PURE_VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/** Strip accents and keep letters A-Z, preserving word boundaries. */
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/).filter(Boolean);
}

/** Sum the digits of a number once. */
function digitSum(n) {
  return String(Math.abs(n)).split('').reduce((a, d) => a + Number(d), 0);
}

/** Reduce to 1-9, keeping master numbers 11/22/33 when keepMaster is true. */
export function reduce(n, keepMaster = true) {
  n = Math.abs(Math.trunc(n));
  while (n > 9) {
    if (keepMaster && MASTER_NUMBERS.includes(n)) return n;
    n = digitSum(n);
  }
  return n;
}

/**
 * Y rule: Y counts as a vowel when it is not next to another vowel
 * (e.g. "Lynn", "Mary", "Bryan" -> vowel; "Yolanda", "Maya", "Joy" -> consonant).
 */
export function isVowelAt(word, i) {
  const ch = word[i];
  if (PURE_VOWELS.has(ch)) return true;
  if (ch !== 'Y') return false;
  const prev = word[i - 1], next = word[i + 1];
  return !(PURE_VOWELS.has(prev) || PURE_VOWELS.has(next));
}

/** Traditional method: reduce each name part separately, then add the parts and reduce again. */
function nameNumber(name, filter) {
  const words = normalizeName(name);
  if (!words.length) return null;
  let partsTotal = 0;
  let rawTotal = 0;
  for (const w of words) {
    let s = 0;
    for (let i = 0; i < w.length; i++) {
      if (filter === 'all' || (filter === 'vowels') === isVowelAt(w, i)) s += LETTER_VALUES[w[i]];
    }
    rawTotal += s;
    partsTotal += reduce(s);
  }
  if (rawTotal === 0) return null;
  return reduce(partsTotal);
}

export const expressionNumber = (name) => nameNumber(name, 'all');
export const soulUrgeNumber = (name) => nameNumber(name, 'vowels');
export const personalityNumber = (name) => nameNumber(name, 'consonants');

/** Parse YYYY-MM-DD (also accepts DD/MM/YYYY). Returns {year, month, day} or throws. */
export function parseDate(dob) {
  let y, m, d;
  const s = String(dob || '').trim();
  let mt;
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = mt.map(Number);
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else throw new Error('Date of birth must look like 1995-03-14');
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error('That date does not exist');
  if (y < 1900 || y > 2026) throw new Error('Year of birth must be between 1900 and 2026');
  return { year: y, month: m, day: d };
}

/** Life Path: reduce month, day and year separately (keeping masters), add, reduce (keeping masters). */
export function lifePathNumber(dob) {
  const { year, month, day } = parseDate(dob);
  return reduce(reduce(month) + reduce(day) + reduce(year));
}

/** Birthday number: the day of birth reduced (11 and 22 are kept). */
export function birthdayNumber(dob) {
  return reduce(parseDate(dob).day);
}

/** Personal Year: birth month + birth day + the current calendar year, reduced to 1-9. */
export function personalYearNumber(dob, year = 2026) {
  const { month, day } = parseDate(dob);
  return reduce(reduce(month, false) + reduce(day, false) + reduce(year, false), false);
}

/** Maturity: Life Path + Expression, reduced (masters kept). */
export function maturityNumber(lifePath, expression) {
  return reduce(lifePath + expression);
}

const TOPICS = [
  ['love', /\b(love|marr|wedding|husband|wife|partner|relationship|crush|girlfriend|boyfriend|soulmate|rishta|shaadi|ishq|pyar|divorce|ex)\w*/i],
  ['career', /\b(job|career|work|business|boss|promotion|interview|company|startup|visa|office|salary)\w*/i],
  ['money', /\b(money|rich|wealth|debt|loan|invest|crypto|paisa|lottery|income|property|house|car)\w*/i],
  ['health', /\b(health|sick|ill|weight|gym|doctor|heal|recover|baby|pregnan)\w*/i],
  ['travel', /\b(travel|move|abroad|country|trip|relocat|dubai|europe|america|canada|uk)\w*/i],
  ['family', /\b(family|mother|father|mom|dad|brother|sister|son|daughter|child|parents|kids)\w*/i],
  ['study', /\b(study|exam|school|university|college|degree|test|result|learn)\w*/i],
];

export function classifyQuestion(q) {
  if (!q || !String(q).trim()) return null;
  for (const [topic, re] of TOPICS) if (re.test(q)) return topic;
  return 'general';
}

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * Full reading. input: { fullName, dob, motherName?, fatherName?, question?, year? }
 */
export function computeReading(input) {
  const fullName = clean(input.fullName);
  if (normalizeName(fullName).length === 0) throw new Error('Please enter your full birth name');
  const year = input.year || 2026;
  const dateParts = parseDate(input.dob);

  const lifePath = lifePathNumber(input.dob);
  const expression = expressionNumber(fullName);
  const soulUrge = soulUrgeNumber(fullName) ?? expression;
  const personality = personalityNumber(fullName) ?? expression;
  const birthday = birthdayNumber(input.dob);
  const personalYear = personalYearNumber(input.dob, year);
  const maturity = maturityNumber(lifePath, expression);

  const mother = clean(input.motherName) ? expressionNumber(input.motherName) : null;
  const father = clean(input.fatherName) ? expressionNumber(input.fatherName) : null;
  const question = clean(input.question) || null;
  const topic = classifyQuestion(question);

  const numbers = { lifePath, expression, soulUrge, personality, birthday, personalYear, maturity };
  if (mother) numbers.mother = mother;
  if (father) numbers.father = father;

  const sections = [
    { key: 'lifePath', label: 'Life Path', number: lifePath, title: NUMBER_TITLES[lifePath], text: MEANINGS.lifePath[lifePath] },
    { key: 'expression', label: 'Expression / Destiny', number: expression, title: NUMBER_TITLES[expression], text: MEANINGS.expression[expression] },
    { key: 'soulUrge', label: "Soul Urge (Heart's Desire)", number: soulUrge, title: NUMBER_TITLES[soulUrge], text: MEANINGS.soulUrge[soulUrge] },
    { key: 'personality', label: 'Personality', number: personality, title: NUMBER_TITLES[personality], text: MEANINGS.personality[personality] },
    { key: 'birthday', label: 'Birthday', number: birthday, title: NUMBER_TITLES[birthday], text: MEANINGS.birthday[birthday] },
    { key: 'maturity', label: 'Maturity', number: maturity, title: NUMBER_TITLES[maturity], text: MEANINGS.maturity[maturity] },
    { key: 'personalYear', label: `Personal Year ${year}`, number: personalYear, title: PERSONAL_YEAR[personalYear].title, text: PERSONAL_YEAR[personalYear].text },
  ];
  const family = [];
  if (mother) family.push({ key: 'mother', label: "Mother's influence", number: mother, title: NUMBER_TITLES[mother], text: MEANINGS.family[mother] });
  if (father) family.push({ key: 'father', label: "Father's influence", number: father, title: NUMBER_TITLES[father], text: MEANINGS.family[father] });

  let answer = null;
  if (question) {
    answer = {
      question, topic,
      text: QUESTION_GUIDANCE[personalYear][topic] + ' ' + MEANINGS.adviceByLifePath[lifePath],
    };
  }

  const firstName = normalizeName(fullName)[0];
  const displayName = fullName.split(' ')[0];

  return {
    displayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
    firstName, fullName, dob: `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`,
    year, numbers, sections, family, answer,
    disclaimer: 'Numerology is a traditional practice for entertainment and reflection. It is not scientific and does not predict the future.',
  };
}

/**
 * Short on-screen reading, 2-3 sentences (tier 1), longer for higher tiers.
 * tier: 1 = short, 2 = extended (adds heart's desire + question), 3 = destiny scroll (adds destiny + maturity)
 */
export function liveReading(reading, tier = 1) {
  const n = reading.numbers;
  const parts = [];
  parts.push(`Life Path ${n.lifePath}, ${NUMBER_TITLES[n.lifePath]}: ${MEANINGS.short.lifePath[n.lifePath]}`);
  parts.push(`Your ${reading.year} is a Personal Year ${n.personalYear}: ${PERSONAL_YEAR[n.personalYear].short}`);
  if (tier >= 2) parts.push(`Your heart (Soul Urge ${n.soulUrge}) ${MEANINGS.short.soulUrge[n.soulUrge]}`);
  if (tier >= 3) {
    parts.push(`Your destiny (Expression ${n.expression}) ${MEANINGS.short.expression[n.expression]}`);
    parts.push(`Later in life (Maturity ${n.maturity}) ${MEANINGS.short.maturity[n.maturity]}`);
  }
  if (tier >= 2 && reading.answer) parts.push(`On your question: ${QUESTION_GUIDANCE[n.personalYear][reading.answer.topic]}`);
  const keyNumbers = [
    { label: 'Life Path', value: n.lifePath },
    { label: 'Destiny', value: n.expression },
    { label: 'Soul', value: n.soulUrge },
    { label: `Year ${reading.year}`, value: n.personalYear },
  ];
  return { name: reading.displayName, tier, keyNumbers, title: NUMBER_TITLES[n.lifePath], text: parts.join(' '), sentences: parts };
}
