import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/numerology.js';
import { MEANINGS, PERSONAL_YEAR, QUESTION_GUIDANCE, NUMBER_TITLES } from '../src/meanings.js';

test('letter chart is Pythagorean', () => {
  assert.equal(N.LETTER_VALUES.A, 1); assert.equal(N.LETTER_VALUES.I, 9); assert.equal(N.LETTER_VALUES.J, 1);
  assert.equal(N.LETTER_VALUES.R, 9); assert.equal(N.LETTER_VALUES.S, 1); assert.equal(N.LETTER_VALUES.Z, 8);
});

test('reduce keeps master numbers only when asked', () => {
  assert.equal(N.reduce(29), 11); assert.equal(N.reduce(38), 11); assert.equal(N.reduce(22), 22);
  assert.equal(N.reduce(33), 33); assert.equal(N.reduce(1990), 1); assert.equal(N.reduce(29, false), 2);
  assert.equal(N.reduce(7), 7); assert.equal(N.reduce(0), 0);
});

test('life path: reduce month, day, year separately', () => {
  assert.equal(N.lifePathNumber('1990-05-14'), 11);   // 5 + 5 + 1
  assert.equal(N.lifePathNumber('1987-11-29'), 11);   // 11 + 11 + 7 = 29 -> 11
  assert.equal(N.lifePathNumber('1978-04-22'), 33);   // 4 + 22 + 7
  assert.equal(N.lifePathNumber('2000-01-01'), 4);
  assert.equal(N.lifePathNumber('1985-12-03'), 11);   // 3 + 3 + 5 = 11 (master kept)
});

test('date formats and validation', () => {
  assert.equal(N.lifePathNumber('14/05/1990'), 11);
  assert.throws(() => N.parseDate('1990-02-30'));
  assert.throws(() => N.parseDate('hello'));
});

test('name numbers', () => {
  assert.equal(N.expressionNumber('John Smith'), 8);          // 20->2, 24->6
  assert.equal(N.expressionNumber('Aamir Shahzad'), 1);       // 24->6, 31->4
  assert.equal(N.expressionNumber('jöhn  SMITH'), 8);         // accents/case/spaces
  assert.equal(N.soulUrgeNumber('Mary'), 8);                  // A1 + Y7 (Y as vowel)
  assert.equal(N.personalityNumber('Mary'), 4);               // M4 + R9 = 13 -> 4
  assert.equal(N.soulUrgeNumber('Maya'), 2);                  // A1 + A1 (Y is a consonant here)
});

test('Y rule', () => {
  assert.equal(N.isVowelAt('LYNN', 1), true);
  assert.equal(N.isVowelAt('YOLANDA', 0), false);
  assert.equal(N.isVowelAt('MAYA', 2), false);
});

test('birthday, personal year 2026, maturity', () => {
  assert.equal(N.birthdayNumber('1990-05-29'), 11);
  assert.equal(N.birthdayNumber('1990-05-31'), 4);
  assert.equal(N.personalYearNumber('1990-05-14', 2026), 2);   // 5 + 5 + 1 = 11 -> 2
  assert.equal(N.personalYearNumber('1990-01-01', 2026), 3);
  assert.equal(N.maturityNumber(11, 1), 3);
  assert.equal(N.maturityNumber(4, 7), 11);
});

test('full reading is deterministic and complete', () => {
  const input = { fullName: 'Aamir Shahzad', dob: '1990-05-14', motherName: 'Fatima Bibi', fatherName: 'Muhammad Shahzad', question: 'Will I get a new job?' };
  const a = N.computeReading(input), b = N.computeReading(input);
  assert.deepEqual(a, b);
  assert.equal(a.sections.length, 7);
  assert.equal(a.family.length, 2);
  assert.equal(a.answer.topic, 'career');
  for (const s of [...a.sections, ...a.family]) { assert.ok(s.text && s.text.length > 40, s.key); assert.ok(s.title); }
  const live = N.liveReading(a, 1);
  assert.equal(live.sentences.length, 2);
  assert.ok(N.liveReading(a, 3).sentences.length > live.sentences.length);
});

test('meanings exist for every number in every category', () => {
  for (const n of N.VALID_NUMBERS) {
    assert.ok(NUMBER_TITLES[n]);
    for (const cat of ['lifePath', 'expression', 'soulUrge', 'personality', 'birthday', 'maturity', 'family', 'adviceByLifePath'])
      assert.ok(MEANINGS[cat][n], `${cat} ${n}`);
    for (const cat of ['lifePath', 'soulUrge', 'expression', 'maturity']) assert.ok(MEANINGS.short[cat][n], `short ${cat} ${n}`);
  }
  for (let y = 1; y <= 9; y++) {
    assert.ok(PERSONAL_YEAR[y].text);
    for (const t of ['love', 'career', 'money', 'health', 'travel', 'family', 'study', 'general']) assert.ok(QUESTION_GUIDANCE[y][t]);
  }
});

test('every possible DOB produces numbers with meanings', () => {
  const d = new Date(Date.UTC(1930, 0, 1));
  while (d.getUTCFullYear() < 2026) {
    const iso = d.toISOString().slice(0, 10);
    const lp = N.lifePathNumber(iso), py = N.personalYearNumber(iso);
    assert.ok(N.VALID_NUMBERS.includes(lp), iso); assert.ok(py >= 1 && py <= 9);
    d.setUTCDate(d.getUTCDate() + 3);
  }
});

test('question classifier', () => {
  assert.equal(N.classifyQuestion('Will I get married this year?'), 'love');
  assert.equal(N.classifyQuestion('should I move to Canada'), 'travel');
  assert.equal(N.classifyQuestion('what does my future hold'), 'general');
  assert.equal(N.classifyQuestion(''), null);
});
