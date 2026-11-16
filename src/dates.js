// Forgiving birth-date reader for TikTok comments. Handles what people actually type:
//   typos in month names ("feburary", "agust", "septmber"), ordinals and spelled-out numbers ("twelfth may",
//   "12th of may", "twenty first of march"), 2-digit years ("98" -> 1998, "05" -> 2005), no separators ("12051998",
//   "120598", "12may1998"), mixed separators / spaces / emojis ("12 🎂 05 — 1998"), Urdu / Arabic / Hindi digits
//   (١٢/٠٥/١٩٩٨, ۱۲, १२), month names in Urdu / Hindi / Arabic script and romanized (janwari, farwari, agast, sitambar),
//   a missing year (day + month only), and the date anywhere in the comment.
// Numeric dates are read day/month first; when both numbers could be the month the result says ambiguous, with the
// other reading in .alt. Dates that cannot exist (31/02) come back with .impossible so Mira can ask.
// Pure functions, no I/O.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CURRENT_YEAR = 2026;

// month words that are not English (romanized Urdu / Hindi, Urdu, Hindi, Arabic)
const MONTH_ALIASES = [
  ['janwari', 'janvari', 'janwary', 'جنوری', 'जनवरी', 'يناير', 'كانون الثاني'],
  ['farwari', 'farvari', 'farwary', 'faravri', 'fabruary', 'فروری', 'फरवरी', 'फ़रवरी', 'فبراير', 'شباط'],
  ['maarch', 'marach', 'مارچ', 'मार्च', 'مارس', 'آذار'],
  ['aprail', 'aprel', 'apreel', 'اپریل', 'अप्रैल', 'أبريل', 'ابريل', 'نيسان'],
  ['mai', 'mayi', 'مئی', 'मई', 'مايو', 'أيار', 'ايار'],
  ['joon', 'jun', 'جون', 'जून', 'يونيو', 'حزيران'],
  ['julai', 'julaai', 'jolai', 'جولائی', 'जुलाई', 'يوليو', 'تموز'],
  ['agast', 'agust', 'augast', 'august', 'اگست', 'अगस्त', 'أغسطس', 'اغسطس', 'آب'],
  ['sitambar', 'sitamber', 'sitmbr', 'ستمبر', 'सितंबर', 'सितम्बर', 'سبتمبر', 'أيلول', 'ايلول'],
  ['aktubar', 'aktoobar', 'aktober', 'اکتوبر', 'अक्टूबर', 'أكتوبر', 'اكتوبر', 'تشرين الأول'],
  ['navambar', 'nawambar', 'navamber', 'نومبر', 'नवंबर', 'नवम्बर', 'نوفمبر', 'تشرين الثاني'],
  ['disambar', 'dasambar', 'disamber', 'دسمبر', 'दिसंबर', 'दिसम्बर', 'ديسمبر', 'كانون الأول'],
];
const ALIAS = new Map(); MONTH_ALIASES.forEach((list, i) => list.forEach((w) => ALIAS.set(w, i + 1)));
const ENGLISH = MONTH_NAMES.map((m) => m.toLowerCase());
const ABBR = { jan: 1, feb: 2, febr: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// words that look like a month after typo-correction but are ordinary words
const NOT_MONTH = new Set(['man', 'may be', 'maybe', 'mar', 'jane', 'june', 'mars', 'marc', 'match', 'much', 'mach', 'main', 'mail', 'many', 'mary', 'jay', 'just', 'jule', 'octo', 'nova', 'dear', 'deck', 'sept', 'aug', 'feel', 'fab', 'march']);

function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    // transposition ("feburary")
    prev = cur;
  }
  return prev[n];
}

/** Month number for a word (English with typos, abbreviations, other languages), or 0. */
export function monthOf(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  if (!w) return 0;
  if (ALIAS.has(w)) return ALIAS.get(w);
  const exact = ENGLISH.indexOf(w); if (exact >= 0) return exact + 1;
  if (ABBR[w]) return ABBR[w];
  if (!/^[a-z]+$/.test(w) || w.length < 4) return 0;
  if (NOT_MONTH.has(w)) return 0;
  // typos: close to a full month name (1 edit for short words, 2 for long), or a known alias
  let best = 0, bestD = 9;
  ENGLISH.forEach((m, i) => { const d = lev(w, m); if (d < bestD) { bestD = d; best = i + 1; } });
  for (const [a, i] of ALIAS) if (/^[a-z]+$/.test(a) && a.length >= 4) { const d = lev(w, a); if (d < bestD) { bestD = d; best = i; } }
  const allowed = w.length <= 5 ? 1 : 2;
  // the first letter must match (avoids "dance" -> "june"); "feburary", "agust", "septmber", "decmber", "janurary"
  const first = ENGLISH[best - 1][0];
  return bestD <= allowed && (w[0] === first || (best === 8 && w[0] === 'a')) ? best : 0;
}

// spelled-out numbers (cardinal and ordinal) for days 1-31
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const UNITS_ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS = { twenty: 20, thirty: 30, twentieth: 20, thirtieth: 30 };
const ORD_TYPO = { twelth: 12, ninth: 9, nineth: 9, fourty: 40, fith: 5, thrid: 3, secnd: 2, frist: 1 };
function numberWord(w) {
  if (UNITS.includes(w)) return { v: UNITS.indexOf(w) };
  if (UNITS_ORD.includes(w)) return { v: UNITS_ORD.indexOf(w), ord: true };
  if (w in TENS) return { v: TENS[w], ord: /th$/.test(w), tens: true };
  if (w in ORD_TYPO) return { v: ORD_TYPO[w], ord: true };
  return null;
}

// non-ASCII digits -> ASCII (same length, so positions in the text stay right)
const DIGIT_BASES = [0x0660, 0x06F0, 0x0966, 0x09E6, 0xFF10];
export function asciiDigits(s) {
  return String(s || '').replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\uFF10-\uFF19]/g, (c) => {
    const code = c.charCodeAt(0); const b = DIGIT_BASES.find((x) => code >= x && code <= x + 9); return String(code - b);
  });
}

const FILLER_WORDS = new Set(['of', 'the', 'st', 'nd', 'rd', 'th', 'on', 'year', 'sal', 'saal', 'tarikh', 'tareekh', 'din', 'and', 'in', 'ko', 'ki', 'ka', 'se']);

/** Words, numbers and the text between them, with positions. */
function tokens(text) {
  const s = asciiDigits(text).toLowerCase();
  const out = [];
  const re = /\d+|[\p{L}\p{M}]+/gu; let m;
  while ((m = re.exec(s))) {
    const raw = m[0], start = m.index, end = start + raw.length;
    if (/^\d/.test(raw)) { out.push({ k: 'num', v: +raw, digits: raw, start, end }); continue; }
    if (/^(st|nd|rd|th)$/.test(raw) && out.length && out[out.length - 1].k === 'num' && out[out.length - 1].end === start) { out[out.length - 1].ord = true; out[out.length - 1].end = end; continue; }
    const mo = monthOf(raw);
    // "may" is also a verb: only a month next to a number
    if (mo) { out.push({ k: 'mon', v: mo, start, end, weak: raw === 'may' || raw === 'mai' || raw === 'march' || raw === 'aug' }); continue; }
    const nw = numberWord(raw);
    if (nw) {
      const prev = out[out.length - 1];
      // "twenty first", "twenty-first", "thirty one"
      if (prev && prev.k === 'num' && prev.tens && nw.v < 10 && start - prev.end <= 1) { prev.v += nw.v; prev.ord = !!nw.ord; prev.tens = false; prev.end = end; prev.digits = String(prev.v); continue; }
      out.push({ k: 'num', v: nw.v, digits: String(nw.v), ord: !!nw.ord, tens: !!nw.tens, start, end, word: true }); continue;
    }
    out.push({ k: FILLER_WORDS.has(raw) ? 'fill' : 'word', start, end });
  }
  return { s, list: out };
}

export const fullYear = (y, digits) => (String(digits).length <= 2 ? (y > CURRENT_YEAR % 100 ? 1900 + y : 2000 + y) : y);
const isYear = (t) => t.k === 'num' && !t.word && ((t.digits.length === 4 && t.v >= 1900 && t.v <= CURRENT_YEAR) || t.digits.length === 2);

function check(day, month, year) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return 'bad';
  if (year != null && (year < 1900 || year > CURRENT_YEAR)) return 'bad';
  const dim = new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();   // year unknown: 29 Feb allowed
  return day <= dim ? 'ok' : 'impossible';
}

/** A compact digit run ("12051998", "120598", "1251998", "19980512"): every valid day/month/year split. */
function splitCompact(d) {
  const out = [];
  const add = (dd, mm, yy, ystr) => { const y = fullYear(+yy, ystr); if (check(+dd, +mm, y) === 'ok') out.push({ day: +dd, month: +mm, year: y }); };
  if (d.length === 8) { add(d.slice(6), d.slice(4, 6), d.slice(0, 4), d.slice(0, 4)); add(d.slice(0, 2), d.slice(2, 4), d.slice(4), d.slice(4)); add(d.slice(2, 4), d.slice(0, 2), d.slice(4), d.slice(4)); }
  else if (d.length === 6) { add(d.slice(0, 2), d.slice(2, 4), d.slice(4), d.slice(4)); add(d.slice(2, 4), d.slice(0, 2), d.slice(4), d.slice(4)); }
  else if (d.length === 7) { add(d.slice(0, 2), d.slice(2, 3), d.slice(3), d.slice(3)); add(d.slice(0, 1), d.slice(1, 3), d.slice(3), d.slice(3)); }
  else if (d.length === 5) { add(d.slice(0, 1), d.slice(1, 2), d.slice(2) , d.slice(3)); }
  const seen = new Set(); return out.filter((x) => { const k = `${x.day}-${x.month}-${x.year}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Every date-looking group in the text, best first.
 * Each: { day, month, year|null, start, end, text, ambiguous, alt: {day,month,year}|null, impossible, monthWord }
 */
export function findDates(text) {
  const { s, list } = tokens(text);
  const orig = String(text || '');
  // runs of numbers / months, joined only by separators (/ - . , spaces, emojis) or filler words ("of", "the", "sal")
  const runs = []; let cur = [];
  const flush = () => { if (cur.some((t) => t.k !== 'fill')) runs.push(cur.filter((t) => t.k !== 'fill')); cur = []; };
  for (const t of list) {
    if (t.k === 'word') { flush(); continue; }
    if (cur.length) {
      const gap = s.slice(cur[cur.length - 1].end, t.start);
      if (gap.length > 6 || /[!?;:]/.test(gap)) flush();
    }
    if (t.k === 'fill' && !cur.length) continue;
    cur.push(t);
  }
  flush();
  const found = [];
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      const r = interpret(run.slice(i), s);
      if (r) { found.push({ ...r, text: orig.slice(r.start, r.end) }); break; }
    }
  }
  const score = (d) => (d.impossible ? 0 : 10) + (d.year ? 4 : 0) + (d.monthWord ? 2 : 0) - (d.ambiguous ? 1 : 0);
  return found.sort((a, b) => score(b) - score(a));
}

function interpret(run, s) {
  const nums = run.filter((t) => t.k === 'num'), mons = run.filter((t) => t.k === 'mon');
  const seps = (a, b) => s.slice(a.end, b.start);
  const span = (ts) => ({ start: ts[0].start, end: ts[ts.length - 1].end });
  // a month word: day = a number 1-31 next to it, year = a 4-digit (or a 2-digit after the day) number
  if (mons.length) {
    const mo = mons[0], mi = run.indexOf(mo);
    const near = run.filter((t, i) => t.k === 'num' && Math.abs(i - mi) <= 2);
    if (!near.length) return null;
    let year = near.find((t) => t.digits.length === 4 && !t.word) || null;
    let day = near.find((t) => t !== year && t.v >= 1 && t.v <= 31 && (t.ord || t.digits.length <= 2)) || null;
    // "march 1998 12"? "12 may 98": a second 2-digit number is the year
    if (!year) { const two = near.find((t) => t !== day && t.digits.length === 2 && !t.word); if (two) year = two; }
    // "may 1998" (no day), or the day swapped with a 2-digit year ("98 may 12")
    if (!day) {
      // "12051998 may"? no. "1st"? handled. Glued "12may1998": tokens are separate already.
      return null;
    }
    if (year && year === day) year = null;
    const y = year ? fullYear(year.v, year.digits) : null;
    if (mo.weak && !(day.start <= mo.start ? mo.start - day.end <= 4 : day.start - mo.end <= 4)) return null;
    const used = [mo, day, year].filter(Boolean).sort((a, b) => a.start - b.start);
    const st = check(day.v, mo.v, y);
    if (st === 'bad') return year ? { ...interpretNoYear(day, mo), ...span(used) } : null;
    return { day: day.v, month: mo.v, year: y, ...span(used), ambiguous: false, alt: null, impossible: st === 'impossible', monthWord: true };
  }
  // only numbers
  if (nums.length === 1) {
    const t = nums[0];
    if (t.word || t.digits.length < 5 || t.digits.length > 8) return null;
    const opts = splitCompact(t.digits);
    if (!opts.length) return null;
    const [a, b] = opts;
    return { ...a, start: t.start, end: t.end, ambiguous: opts.length > 1 && !(b.day === a.day && b.month === a.month), alt: opts.length > 1 ? b : null, impossible: false, monthWord: false, compact: true };
  }
  if (nums.some((t) => t.word)) return null;   // "two 3 kids"
  let [a, b, c] = nums;
  // ISO: 1998-05-12
  if (a.digits.length === 4 && c) { const st = check(c.v, b.v, a.v); return st === 'bad' ? null : { day: c.v, month: b.v, year: a.v, ...span([a, c]), ambiguous: false, alt: null, impossible: st === 'impossible', monthWord: false }; }
  const strongSep = (x, y) => /[/.\-\\|_]/.test(seps(x, y));
  if (!c) {
    // day/month without a year: only with a date separator ("12/5", "12-05")
    if (!strongSep(a, b) || a.digits.length > 2 || b.digits.length > 2) return null;
    return pickDM(a.v, b.v, null, span([a, b]));
  }
  if (a.digits.length > 2 || b.digits.length > 2 || !(c.digits.length === 4 || c.digits.length === 2)) return null;
  // spaces only ("12 5 98") are fine when the last number is a real year; 2-digit years need date separators
  if (c.digits.length === 2 && !strongSep(a, b) && !strongSep(b, c)) return null;
  return pickDM(a.v, b.v, fullYear(c.v, c.digits), span([a, c]));
}

function interpretNoYear(day, mo) {
  const st = check(day.v, mo.v, null);
  return st === 'bad' ? null : { day: day.v, month: mo.v, year: null, ambiguous: false, alt: null, impossible: st === 'impossible', monthWord: true };
}

function pickDM(a, b, year, span) {
  const dm = check(a, b, year), md = check(b, a, year);
  if (dm === 'ok' && md === 'ok' && a !== b) return { day: a, month: b, year, ...span, ambiguous: true, alt: { day: b, month: a, year }, impossible: false, monthWord: false };
  if (dm === 'ok') return { day: a, month: b, year, ...span, ambiguous: false, alt: null, impossible: false, monthWord: false };
  if (md === 'ok') return { day: b, month: a, year, ...span, ambiguous: false, alt: null, impossible: false, monthWord: false };
  if (dm === 'impossible' || md === 'impossible') return { day: a, month: b, year, ...span, ambiguous: false, alt: null, impossible: true, monthWord: false };
  return null;
}

/** The best birth date in the text (see findDates), or null. */
export const bestDate = (text) => findDates(text)[0] || null;

/** Does the comment look like someone trying to give a birth date (for the AI fallback / a follow-up question)? */
export function looksLikeDateAttempt(text) {
  const t = asciiDigits(text).toLowerCase();
  const birthWord = /\b(dob|d\.o\.b|born|birth ?day|birth ?date|date of birth|paida|paidaish|janam|janamdin|tareekh|tarikh)\b|پیدائش|تاریخ|जन्म|ميلاد|مواليد/.test(t);
  const digits = /\d/.test(t);
  if (birthWord && (digits || /\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/.test(t))) return true;
  if (/(^|\D)\d{5,8}(\D|$)/.test(t)) return true;
  if (/\b\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}\b/.test(t)) return true;
  // a past year with a small number ("1998 12 5", "5 dicmbr 1998"): not 2025-2027 ("will 2026 be good")
  const y = t.match(/\b(19\d{2}|20[01]\d|202[0-4])\b/);
  return !!(y && /\b\d{1,2}\b/.test(t.replace(y[0], '')));
}

const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const dateWords = (d) => `${d.day} ${MONTH_NAMES[d.month - 1]}${d.year ? ' ' + d.year : ''}`;
export { ord };

/**
 * The viewer's answer to "is that 5 December or 12 May?" / "which date did you mean?".
 * options: the dates she offered (may be empty); base: what was known before (its year fills a missing one).
 * Understands a new date, a month name ("may", "दिसंबर"), "first" / "second" / "pehla" / "doosra", the day number,
 * or "yes" (= the first option). Returns { day, month, year } or null.
 */
export function resolveDateAnswer(text, options = [], base = null) {
  const t = asciiDigits(text).toLowerCase();
  const match = (x) => x && options.find((o) => o.day === x.day && o.month === x.month);
  const d = findDates(text).find((x) => !x.impossible);
  if (d) { const o = match(d) || match(d.alt); const y = d.year ?? o?.year ?? base?.year ?? null; return o ? { ...o, year: y } : { day: d.day, month: d.month, year: y }; }
  if (!options.length) return null;
  for (const w of t.split(/[^\p{L}\p{M}]+/u)) { const m = monthOf(w); if (m) { const o = options.find((x) => x.month === m); if (o) return o; } }
  if (/\b(first|1st|pehla|pehli|pahla|pehle|former)\b|پہلا|پہلی|पहला|पहली|الأول/.test(t)) return options[0];
  if (/\b(second|2nd|doosra|dusra|dusri|doosri|latter|other one|last one)\b|دوسرا|دوسری|दूसरा|दूसरी|الثاني/.test(t)) return options[1] || null;
  const n = t.match(/\b(\d{1,2})\b/); if (n) { const o = options.find((x) => x.day === +n[1]); if (o) return o; }
  if (/\b(yes|yeah|yep|yup|haan|han|ji|jee|correct|right|sahi|theek)\b|ہاں|جی|हाँ|हां|नعم|نعم/.test(t)) return options[0];
  return null;
}

/** The AI fallback parser's answer (JSON) -> { day, month, year, name, clear, options } or null. */
export function readAiDate(raw) {
  let j; try { j = JSON.parse(String(raw).match(/\{[^]*\}/)?.[0] || ''); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const ok = (x) => x && Number.isInteger(+x.day) && Number.isInteger(+x.month) && check(+x.day, +x.month, x.year ? +x.year : null) === 'ok';
  const norm = (x) => ({ day: +x.day, month: +x.month, year: x.year ? +x.year : null });
  const options = (Array.isArray(j.options) ? j.options : []).filter(ok).map(norm).slice(0, 2);
  const name = typeof j.name === 'string' && /^[\p{L}\p{M} .'-]{2,30}$/u.test(j.name.trim()) ? j.name.trim() : '';
  if (!ok(j)) return options.length ? { day: null, month: null, year: null, name, clear: false, options } : null;
  return { ...norm(j), name, clear: j.clear !== false && options.length < 2, options };
}
export const AI_DATE_PROMPT = 'You read birth dates from TikTok live comments. People type them messily: typos in month names, words or ordinals, 2-digit years, no separators, Urdu / Hindi / Arabic digits or month names, name and date in any order. '
  + 'Reply with JSON only, no other text: {"day":1-31 or null,"month":1-12 or null,"year":4-digit or null,"name":"their own first name if they wrote one, else null","clear":true or false,"options":[]}. '
  + 'Numeric dates are day/month/year unless that is impossible. If you are not sure which of two dates they meant, set clear to false and put both in options as {"day":..,"month":..,"year":..}. If there is no birth date, reply {"day":null,"month":null,"year":null,"name":null,"clear":false,"options":[]}.';
