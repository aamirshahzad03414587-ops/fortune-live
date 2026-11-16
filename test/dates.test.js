import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDates, monthOf, asciiDigits, resolveDateAnswer, looksLikeDateAttempt, readAiDate } from '../src/dates.js';
import { parseReadingComment, partialScript } from '../src/comment-reading.js';
import { extractBirthDate } from '../src/chat.js';

const d = (t) => { const r = findDates(t)[0]; return r ? `${r.day}/${r.month}/${r.year ?? '-'}${r.impossible ? '!' : ''}${r.ambiguous ? '?' : ''}` : null; };

test('messy dates: typos in month names', () => {
  assert.equal(d('12 feburary 1998'), '12/2/1998');
  assert.equal(d('agust 5 2001'), '5/8/2001');
  assert.equal(d('septmber 3rd 1990'), '3/9/1990');
  assert.equal(d('15 Decmber 2003'), '15/12/2003');
  assert.equal(d('janurary 9 1999'), '9/1/1999');
  assert.equal(d('octobr 30 1985'), '30/10/1985');
  assert.equal(monthOf('dance'), 0); assert.equal(monthOf('june'), 6); assert.equal(monthOf('mai'), 5);
});

test('messy dates: ordinals and spelled-out numbers', () => {
  assert.equal(d('twelfth may 1998'), '12/5/1998');
  assert.equal(d('12th of may 1998'), '12/5/1998');
  assert.equal(d('the twenty first of march 95'), '21/3/1995');
  assert.equal(d('twenty-fifth december 2000'), '25/12/2000');
  assert.equal(d('3rd sep 1999'), '3/9/1999');
  assert.equal(d('may first 2004'), '1/5/2004');
});

test('messy dates: 2-digit years, no separators, mixed separators and emojis', () => {
  assert.equal(d('12 may 98'), '12/5/1998');
  assert.equal(d('3/7/05'), '3/7/2005?');
  assert.equal(d('12051998'), '12/5/1998?');
  assert.equal(d('120598'), '12/5/1998?');
  assert.equal(d('19980512'), '12/5/1998');
  assert.equal(d('25121990'), '25/12/1990');
  assert.equal(d('12may1998'), '12/5/1998');
  assert.equal(d('12 🎂 05 — 1998'), '12/5/1998?');
  assert.equal(d('Zara ⭐ 3rd  sep ✨ 1999'), '3/9/1999');
  assert.equal(d('12 . 5 . 1998'), '12/5/1998?');
  assert.equal(d('1998-05-12'), '12/5/1998');
});

test('messy dates: Urdu / Arabic / Hindi digits and month names, romanized months', () => {
  assert.equal(asciiDigits('١٢/٠٥/١٩٩٨'), '12/05/1998');
  assert.equal(d('١٢/٠٥/١٩٩٨'), '12/5/1998?');
  assert.equal(d('۱۲ مئی ۱۹۹۸'), '12/5/1998');
  assert.equal(d('१२ मई १९९८'), '12/5/1998');
  assert.equal(d('15 दिसंबर 2001'), '15/12/2001');
  assert.equal(d('٣ مارس ١٩٩٠'), '3/3/1990');
  assert.equal(d('5 janwari 2000'), '5/1/2000');
  assert.equal(d('20 agast 1997'), '20/8/1997');
  assert.equal(d('sitambar 9'), '9/9/-');
  assert.equal(d('meri date of birth 7 farwari 2002 hai'), '7/2/2002');
});

test('messy dates: missing year, impossible dates, ambiguity, and things that are not dates', () => {
  assert.equal(d('born 14 march'), '14/3/-');
  assert.equal(d('dec 25'), '25/12/-');
  assert.equal(d('31/02/1999'), '31/2/1999!');
  assert.equal(d('05/25/1990'), '25/5/1990');          // MM/DD when the second number can't be a month
  assert.equal(d('05/12/1998'), '5/12/1998?');         // day first, the other reading kept as .alt
  for (const t of ['I am 25 and have 3 kids', 'may I know my future', 'hello 2026', '12/05/2030', 'I need 2 tips', 'ek baat 12 sal ki']) assert.equal(d(t), null, t);
  assert.deepEqual(extractBirthDate('my birthday is twelfth of agust'), { day: 12, month: 8, year: null });
});

test('reading comments: name and date in any order, messy formats, no year', () => {
  const a = parseReadingComment('12 feburary 98 Bilal', 'x');
  assert.deepEqual([a.name, a.dob], ['Bilal', '1998-02-12']);
  const b = parseReadingComment('twelfth of agust 2001 meri shadi kab hogi?', 'zain99');
  assert.deepEqual([b.name, b.dob, b.question], ['Zain', '2001-08-12', 'meri shadi kab hogi?']);
  const c = parseReadingComment('Hina 🌸 ٧/١١/١٩٩٢', 'h');
  assert.deepEqual([c.name, c.dob], ['Hina', '1992-11-07']);
  const e = parseReadingComment('born 14 march, will I get a job?', 'hina_x', { allowNoYear: true });
  assert.deepEqual([e.partial, e.dob, e.date, e.question], [true, null, { day: 14, month: 3, year: null }, 'will I get a job?']);
  assert.equal(parseReadingComment('born 14 march', 'x'), null);                     // a year is needed unless allowNoYear
  const s = partialScript(e);
  assert.match(s.spoken, /Hina X, .*14 March/); assert.match(s.spoken, /Personal Year 9/); assert.match(s.spoken, /birth year/);
  assert.deepEqual(s.keyNumbers.map((k) => k.label), ['Birthday', 'Year 2026']);
  const f = parseReadingComment('Sara 31/02/1999', 's');
  assert.equal(f.check.reason, 'impossible');
  const g = parseReadingComment('Sara 05/12/1998', 's', { askAmbiguous: true });
  assert.deepEqual(g.check.options.map((o) => `${o.day}/${o.month}`), ['5/12', '12/5']);
  assert.equal(parseReadingComment('Sara 05/12/1998', 's').check, undefined);       // default: day first, no question
});

test('answers to "5 December or 12 May?" and the AI parser output', () => {
  const o = [{ day: 5, month: 12, year: 1998 }, { day: 12, month: 5, year: 1998 }];
  const r = (t) => { const x = resolveDateAnswer(t, o); return x && `${x.day}/${x.month}/${x.year}`; };
  assert.equal(r('12 may'), '12/5/1998'); assert.equal(r('December'), '5/12/1998'); assert.equal(r('दिसंबर'), '5/12/1998');
  assert.equal(r('the second one'), '12/5/1998'); assert.equal(r('pehla wala'), '5/12/1998'); assert.equal(r('12'), '12/5/1998');
  assert.equal(r('yes'), '5/12/1998'); assert.equal(r('no idea'), null);
  assert.deepEqual(resolveDateAnswer('28 feb', [], { year: 1999 }), { day: 28, month: 2, year: 1999 });
  assert.equal(looksLikeDateAttempt('5 dicmbr 1998'), true); assert.equal(looksLikeDateAttempt('my dob is 3 fbrry'), true);
  assert.equal(looksLikeDateAttempt('will 2026 be good for my 2 kids'), false); assert.equal(looksLikeDateAttempt('hello mira'), false);
  assert.deepEqual(readAiDate('{"day":5,"month":12,"year":1998,"name":"Sara","clear":true,"options":[]}'), { day: 5, month: 12, year: 1998, name: 'Sara', clear: true, options: [] });
  assert.equal(readAiDate('{"day":31,"month":2,"year":1999}'), null);
  assert.equal(readAiDate('not json'), null);
  assert.equal(readAiDate('{"day":null,"options":[{"day":5,"month":12,"year":1998},{"day":12,"month":5,"year":1998}]}').clear, false);
});
