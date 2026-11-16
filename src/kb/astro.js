// Western zodiac, Chinese zodiac and the moon phase. Entertainment only.
export const SIGNS = [
  { name: 'Aries', from: [3, 21], to: [4, 19], el: 'fire', mode: 'cardinal', ruler: 'Mars', symbol: 'the Ram', traits: ['brave', 'energetic', 'a natural starter'], shadow: 'impatient', colour: 'red', crystal: 'carnelian', day: 'Tuesday' },
  { name: 'Taurus', from: [4, 20], to: [5, 20], el: 'earth', mode: 'fixed', ruler: 'Venus', symbol: 'the Bull', traits: ['loyal', 'patient', 'a lover of comfort and beauty'], shadow: 'stubborn', colour: 'green', crystal: 'rose quartz', day: 'Friday' },
  { name: 'Gemini', from: [5, 21], to: [6, 20], el: 'air', mode: 'mutable', ruler: 'Mercury', symbol: 'the Twins', traits: ['witty', 'curious', 'a brilliant talker'], shadow: 'restless', colour: 'yellow', crystal: 'citrine', day: 'Wednesday' },
  { name: 'Cancer', from: [6, 21], to: [7, 22], el: 'water', mode: 'cardinal', ruler: 'the Moon', symbol: 'the Crab', traits: ['caring', 'intuitive', 'deeply loyal to family'], shadow: 'moody', colour: 'silver', crystal: 'moonstone', day: 'Monday' },
  { name: 'Leo', from: [7, 23], to: [8, 22], el: 'fire', mode: 'fixed', ruler: 'the Sun', symbol: 'the Lion', traits: ['warm', 'generous', 'born to shine'], shadow: 'proud', colour: 'gold', crystal: 'tiger eye', day: 'Sunday' },
  { name: 'Virgo', from: [8, 23], to: [9, 22], el: 'earth', mode: 'mutable', ruler: 'Mercury', symbol: 'the Maiden', traits: ['thoughtful', 'helpful', 'wonderfully detailed'], shadow: 'over-critical', colour: 'navy blue', crystal: 'amazonite', day: 'Wednesday' },
  { name: 'Libra', from: [9, 23], to: [10, 22], el: 'air', mode: 'cardinal', ruler: 'Venus', symbol: 'the Scales', traits: ['charming', 'fair', 'a lover of harmony'], shadow: 'indecisive', colour: 'pink', crystal: 'lapis lazuli', day: 'Friday' },
  { name: 'Scorpio', from: [10, 23], to: [11, 21], el: 'water', mode: 'fixed', ruler: 'Pluto', symbol: 'the Scorpion', traits: ['passionate', 'magnetic', 'fiercely loyal'], shadow: 'secretive', colour: 'deep red', crystal: 'obsidian', day: 'Tuesday' },
  { name: 'Sagittarius', from: [11, 22], to: [12, 21], el: 'fire', mode: 'mutable', ruler: 'Jupiter', symbol: 'the Archer', traits: ['adventurous', 'optimistic', 'funny and free'], shadow: 'blunt', colour: 'purple', crystal: 'turquoise', day: 'Thursday' },
  { name: 'Capricorn', from: [12, 22], to: [1, 19], el: 'earth', mode: 'cardinal', ruler: 'Saturn', symbol: 'the Sea-Goat', traits: ['ambitious', 'disciplined', 'quietly funny'], shadow: 'too serious', colour: 'brown', crystal: 'garnet', day: 'Saturday' },
  { name: 'Aquarius', from: [1, 20], to: [2, 18], el: 'air', mode: 'fixed', ruler: 'Uranus', symbol: 'the Water-Bearer', traits: ['original', 'friendly', 'ahead of their time'], shadow: 'distant', colour: 'electric blue', crystal: 'amethyst', day: 'Saturday' },
  { name: 'Pisces', from: [2, 19], to: [3, 20], el: 'water', mode: 'mutable', ruler: 'Neptune', symbol: 'the Fish', traits: ['dreamy', 'kind', 'deeply creative'], shadow: 'escapist', colour: 'sea green', crystal: 'aquamarine', day: 'Thursday' },
];
const ALIASES = { aries: 'Aries', mesh: 'Aries', hamal: 'Aries', taurus: 'Taurus', vrishabh: 'Taurus', saur: 'Taurus', gemini: 'Gemini', mithun: 'Gemini', jauza: 'Gemini', cancer: 'Cancer', kark: 'Cancer', saratan: 'Cancer', leo: 'Leo', singh: 'Leo', asad: 'Leo', virgo: 'Virgo', kanya: 'Virgo', sunbula: 'Virgo', libra: 'Libra', tula: 'Libra', mizan: 'Libra', scorpio: 'Scorpio', vrishchik: 'Scorpio', aqrab: 'Scorpio', sagittarius: 'Sagittarius', sag: 'Sagittarius', dhanu: 'Sagittarius', qaus: 'Sagittarius', capricorn: 'Capricorn', cap: 'Capricorn', makar: 'Capricorn', jadi: 'Capricorn', aquarius: 'Aquarius', kumbh: 'Aquarius', dalv: 'Aquarius', pisces: 'Pisces', meen: 'Pisces', hoot: 'Pisces',
  'حمل': 'Aries', 'ثور': 'Taurus', 'جوزا': 'Gemini', 'سرطان': 'Cancer', 'اسد': 'Leo', 'سنبلہ': 'Virgo', 'میزان': 'Libra', 'عقرب': 'Scorpio', 'قوس': 'Sagittarius', 'جدی': 'Capricorn', 'دلو': 'Aquarius', 'حوت': 'Pisces',
  'मेष': 'Aries', 'वृषभ': 'Taurus', 'मिथुन': 'Gemini', 'कर्क': 'Cancer', 'सिंह': 'Leo', 'कन्या': 'Virgo', 'तुला': 'Libra', 'वृश्चिक': 'Scorpio', 'धनु': 'Sagittarius', 'मकर': 'Capricorn', 'कुंभ': 'Aquarius', 'मीन': 'Pisces' };
export const signByName = (n) => SIGNS.find((s) => s.name === n) || null;
/** Sign names mentioned in the text, in order. */
export function signsIn(text) {
  const out = [];
  const re = /[\p{L}\p{M}]+/gu; let m;
  while ((m = re.exec(String(text || '')))) { const n = ALIASES[m[0].toLowerCase()]; if (n && !out.includes(n)) out.push(n); }
  return out.map(signByName);
}
export function signOf(day, month) {
  for (const s of SIGNS) {
    const [fm, fd] = s.from, [tm, td] = s.to;
    if ((month === fm && day >= fd) || (month === tm && day <= td)) return s;
  }
  return SIGNS[9];
}
// element pairs: same = deep understanding; fire+air, earth+water = natural; others = opposites that teach
const EL_SCORE = { 'fire-fire': 88, 'earth-earth': 86, 'air-air': 84, 'water-water': 90, 'air-fire': 92, 'earth-water': 93, 'earth-fire': 64, 'fire-water': 62, 'air-earth': 61, 'air-water': 66 };
export function compatibility(a, b) {
  const key = [a.el, b.el].sort().join('-');
  let score = EL_SCORE[key];
  const ia = SIGNS.indexOf(a), ib = SIGNS.indexOf(b), d = Math.abs(ia - ib) % 12;
  if (d === 6) score += 3;            // opposite signs attract
  if (a === b) score -= 4;
  const vibe = score >= 85 ? 'a natural, easy flow' : score >= 70 ? 'a spicy spark that grows with effort' : 'opposites who can teach each other a lot';
  const why = a.el === b.el ? `both are ${a.el} signs and understand each other` : key === 'air-fire' ? 'air feeds fire: ideas and passion' : key === 'earth-water' ? 'water nourishes earth: care and stability' : `${a.el} and ${b.el} move at different speeds`;
  return { score, vibe, why };
}

export const CHINESE = [
  ['Rat', 'clever, quick and resourceful'], ['Ox', 'strong, patient and dependable'], ['Tiger', 'brave, bold and full of energy'], ['Rabbit', 'gentle, elegant and lucky'],
  ['Dragon', 'confident, lucky and full of charisma'], ['Snake', 'wise, calm and mysterious'], ['Horse', 'free, lively and hard-working'], ['Goat', 'kind, artistic and peaceful'],
  ['Monkey', 'witty, playful and inventive'], ['Rooster', 'honest, proud and hard-working'], ['Dog', 'loyal, fair and protective'], ['Pig', 'generous, sweet and fun-loving'],
];
const CN_EL = ['Metal', 'Metal', 'Water', 'Water', 'Wood', 'Wood', 'Fire', 'Fire', 'Earth', 'Earth'];
/** Chinese zodiac by birth year; January and early February births may belong to the previous year (lunar new year). */
export function chineseOf(year, month = 6, day = 15) {
  const cusp = month === 1 || (month === 2 && day <= 20);
  const y = month === 1 || (month === 2 && day < 4) ? year - 1 : year;
  const [animal, traits] = CHINESE[((y - 4) % 12 + 12) % 12];
  return { animal, traits, element: CN_EL[((y % 10) + 10) % 10], cusp, year: y };
}
export const chineseYear = (y) => chineseOf(y);   // 2026: Fire Horse

// ---------------------------------------------------------------- moon
const SYNODIC = 29.530588853, NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);
const PHASES = [
  ['New Moon', 'plant a new intention', 0.0], ['Waxing Crescent', 'take the first small step', 0.07], ['First Quarter', 'push through small obstacles', 0.21], ['Waxing Gibbous', 'refine and keep going', 0.29],
  ['Full Moon', 'celebrate, release and feel everything strongly', 0.46], ['Waning Gibbous', 'share gratitude and wisdom', 0.54], ['Last Quarter', 'let go of what is not working', 0.71], ['Waning Crescent', 'rest and recharge before the next cycle', 0.79],
];
/** Moon phase for a date: { name, age (days), illumination 0-1, energy, waxing } */
export function moonPhase(date = new Date()) {
  const age = ((((date.getTime() - NEW_MOON_2000) / 864e5) % SYNODIC) + SYNODIC) % SYNODIC;
  const f = age / SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
  // boundaries: new < 1.85 d, full 13.8-15.8 d (as calendars name them)
  let i;
  if (age < 1.85 || age > SYNODIC - 1.0) i = 0; else if (age < 6.4) i = 1; else if (age < 8.4) i = 2; else if (age < 13.8) i = 3;
  else if (age < 15.8) i = 4; else if (age < 21.1) i = 5; else if (age < 23.1) i = 6; else i = 7;
  return { name: PHASES[i][0], energy: PHASES[i][1], age: Math.round(age * 10) / 10, illumination: Math.round(illum * 100) / 100, waxing: age < SYNODIC / 2 };
}
