// Numerology extras, palmistry, crystals, dream symbols, angel numbers, lucky things, harmless rituals.
// Entertainment only: no medical, legal or financial promises; nothing about death or harm as a prediction.

export const reduce = (n, keep = true) => { n = Math.abs(Math.trunc(n)); while (n > 9 && !(keep && [11, 22, 33].includes(n))) n = String(n).split('').reduce((a, b) => a + +b, 0); return n; };

export const MASTER = {
  11: 'Master Number 11, the intuitive messenger: sensitive, inspiring and spiritually tuned in',
  22: 'Master Number 22, the master builder: big dreams turned into real, lasting things',
  33: 'Master Number 33, the master teacher: compassion, healing words and a big heart',
};
export const KARMIC = {
  13: 'Karmic number 13: growth through steady effort; shortcuts never suit you, patience does',
  14: 'Karmic number 14: learning balance; freedom is sweetest with a little self-discipline',
  16: 'Karmic number 16: rebuilding the ego with humility; every fall makes you wiser',
  19: 'Karmic number 19: learning to accept help; independence plus teamwork is your magic',
};
const PM = ['', 'new beginnings', 'patience and partnership', 'fun and creativity', 'steady work', 'change and surprises', 'love, home and care', 'reflection and learning', 'focus and achievement', 'finishing and letting go'];
export const DAY_VIBE = PM;

/** Life Path with its karmic debt (13/14/16/19 in the birthday or the totals) and master numbers. */
/** Calendar date of `date` in a time zone (the streamer's; servers run in UTC). */
export function ymd(date = new Date(), tz = 'Asia/Dubai') {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day };
  } catch { return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }; }
}

export function numerologyExtras({ day, month, year }, today = new Date(), tz = 'Asia/Dubai') {
  const { y: cy, m: cm, d: cd } = ymd(today, tz);
  const py = reduce(reduce(month, false) + reduce(day, false) + reduce(cy, false), false);
  const pm = reduce(py + cm, false), pd = reduce(pm + cd, false);
  const out = { personalYear: py, personalMonth: pm, personalDay: pd, karmic: [], master: [] };
  if (KARMIC[day]) out.karmic.push(day);
  if (year) {
    const raw = reduce(month) + reduce(day) + reduce(year);
    const lp = reduce(raw);
    out.lifePath = lp;
    if (KARMIC[raw] && !out.karmic.includes(raw)) out.karmic.push(raw);
    if (MASTER[lp]) out.master.push(lp);
  }
  const bd = reduce(day); if (MASTER[bd] && !out.master.includes(bd)) out.master.push(bd);
  return out;
}

export const PALM = {
  heart: 'The heart line, the top line, shows how you love: long and curved means warm and expressive, straight means calm and thoughtful',
  head: 'The head line, the middle line, shows how you think: long means careful planning, short means quick decisions, a slope means a creative mind',
  life: 'The life line circles the thumb and shows energy and big life changes, not how long you live; deep means lots of vitality',
  fate: 'The fate line runs up the middle of the palm and shows career paths; many people do not have one and that is perfectly fine',
  sun: 'The sun line under the ring finger shows creativity and the joy of being seen',
  mounts: 'The mounts are the soft pads: Venus under the thumb is love and warmth, Jupiter under the index finger is ambition',
  shapes: 'Hand shapes match elements: square palms are earth, practical; long fingers are air, curious; long palms are water, sensitive; short fingers are fire, bold',
};

export const CRYSTALS = [
  { name: 'rose quartz', for: ['love', 'self-love', 'friendship'], says: 'soft pink love and kindness' },
  { name: 'amethyst', for: ['calm', 'sleep', 'intuition', 'stress'], says: 'calm, dreams and intuition' },
  { name: 'citrine', for: ['success', 'confidence', 'career', 'money', 'study'], says: 'sunny confidence and motivation' },
  { name: 'clear quartz', for: ['focus', 'clarity', 'study'], says: 'clarity and focus, the master crystal' },
  { name: 'black tourmaline', for: ['protection', 'negativity'], says: 'protection from bad vibes' },
  { name: 'tiger eye', for: ['courage', 'confidence', 'career'], says: 'courage and grounded confidence' },
  { name: 'moonstone', for: ['new beginnings', 'intuition', 'travel'], says: 'new beginnings and moon magic' },
  { name: 'green aventurine', for: ['luck', 'opportunity', 'career'], says: 'the luck stone for new chances' },
  { name: 'carnelian', for: ['creativity', 'energy', 'motivation'], says: 'fiery creativity and get-up-and-go' },
  { name: 'lapis lazuli', for: ['truth', 'wisdom', 'study', 'communication'], says: 'wisdom and honest words' },
  { name: 'aquamarine', for: ['calm', 'communication', 'travel'], says: 'ocean calm and brave speaking' },
  { name: 'obsidian', for: ['protection', 'grounding'], says: 'grounding and a protective shield' },
  { name: 'turquoise', for: ['travel', 'luck', 'protection'], says: 'a traveller\'s lucky charm' },
  { name: 'garnet', for: ['passion', 'love', 'energy'], says: 'passion and devotion' },
  { name: 'selenite', for: ['peace', 'cleansing', 'sleep'], says: 'peaceful, cleansing light' },
];
export const crystalFor = (topic) => CRYSTALS.find((c) => c.for.includes(topic)) || null;

// ~50 dream symbols: [pattern, symbol, meaning]
export const DREAMS = [
  [/snake|serpent|saanp|سانپ|साँप|सांप/, 'snakes', 'transformation and hidden energy; something in you is shedding an old skin'],
  [/teeth|tooth|daant/, 'teeth falling out', 'worry about how others see you; a sign to speak up with confidence'],
  [/fall(ing)?\b/, 'falling', 'a feeling of losing control; time to find your footing and slow down'],
  [/fly(ing)?\b|flew/, 'flying', 'freedom and rising above a problem'],
  [/water|ocean|sea|river|pani|paani/, 'water', 'your emotions; calm water is peace, rough water is feelings to talk about'],
  [/fire|aag/, 'fire', 'passion and transformation; a fresh energy is lighting up'],
  [/chase|chased|running/, 'being chased', 'something you are avoiding; face it gently and it shrinks'],
  [/exam|test\b|imtihan/, 'an exam', 'feeling tested; you are more prepared than you think'],
  [/baby|bacha|bachcha/, 'a baby', 'a new beginning, idea or project being born'],
  [/wedding|marriage|shaadi|shadi|dulhan/, 'a wedding', 'a union of ideas, a commitment or a new chapter'],
  [/\bdead\b|death|dying|died/, 'death', 'an ending that makes room for something new; it is symbolic, not literal'],
  [/house|home|ghar/, 'a house', 'your self and inner life; new rooms mean new talents'],
  [/car\b|driving/, 'a car', 'the direction of your life; who is driving shows who is in control'],
  [/cat\b|cats|billi/, 'a cat', 'independence and intuition'],
  [/dog\b|dogs|kutta/, 'a dog', 'loyalty, friendship and protection'],
  [/spider/, 'a spider', 'creativity and patience; you are weaving something'],
  [/money|gold|treasure|paisa|sona/, 'gold or money', 'self-worth and hidden talents (a symbol, not a money prediction)'],
  [/rain|barish/, 'rain', 'cleansing and renewal after a heavy time'],
  [/moon|chand/, 'the moon', 'intuition and feelings you have not spoken yet'],
  [/sun\b|suraj/, 'the sun', 'success, clarity and joy'],
  [/star|sitara|taray/, 'stars', 'hope and a wish guiding you'],
  [/ex\b|ex-|former partner/, 'an ex', 'an old lesson or feeling being processed, not always a return'],
  [/naked|nude/, 'being underdressed in public', 'feeling exposed; your real self is more welcome than you think'],
  [/late|missing (a|the) (bus|train|flight)/, 'being late', 'pressure and too many plans; you need breathing space'],
  [/lost\b|getting lost/, 'being lost', 'searching for direction; a new path is forming'],
  [/school|class\b/, 'school', 'a life lesson you are learning right now'],
  [/bird|parinda/, 'birds', 'messages, freedom and good news'],
  [/fish\b|machli/, 'fish', 'abundance and deep feelings'],
  [/horse|ghora/, 'a horse', 'power, drive and freedom'],
  [/lion|sher\b/, 'a lion', 'courage and inner strength'],
  [/rat|mouse|chuha/, 'a mouse', 'small worries nibbling at you; sort them one by one'],
  [/blood|khoon/, 'blood', 'life energy and passion (symbolic only)'],
  [/door|darwaza/, 'a door', 'a new opportunity opening'],
  [/key\b|chabi/, 'a key', 'the answer you are looking for is close'],
  [/mirror|aina/, 'a mirror', 'self-reflection; look at yourself with kindness'],
  [/ring\b|angoothi/, 'a ring', 'commitment and promises'],
  [/flower|phool/, 'flowers', 'love, beauty and growth'],
  [/tree|darakht|ped\b/, 'a tree', 'growth, family roots and stability'],
  [/mountain|pahar/, 'a mountain', 'a goal worth the climb'],
  [/storm|toofan/, 'a storm', 'big emotions passing through; calm comes after'],
  [/earthquake/, 'an earthquake', 'a big shake-up that resets things'],
  [/phone|call/, 'a phone call', 'a message you are waiting for or need to send'],
  [/hair\b|baal/, 'hair', 'strength and self-image'],
  [/shoes|joota/, 'shoes', 'your path and your next steps'],
  [/bridge|pul\b/, 'a bridge', 'a transition from one stage of life to the next'],
  [/ghost|bhoot|jinn|djinn/, 'a ghost', 'a memory or unfinished feeling asking for attention'],
  [/angel|farishta|fariste/, 'an angel', 'protection and guidance'],
  [/pregnan/, 'pregnancy', 'a creative project growing inside you'],
  [/kiss|kissing/, 'a kiss', 'affection, acceptance and connection'],
  [/food|eating|khana/, 'food', 'what nourishes you; feed your heart and mind'],
  [/ice|snow|baraf/, 'snow or ice', 'feelings on pause; a thaw is coming'],
  [/rainbow/, 'a rainbow', 'hope and good things after a hard time'],
];
export const findDream = (t) => { const s = String(t || '').toLowerCase(); const d = DREAMS.find(([re]) => re.test(s)); return d ? { symbol: d[1], meaning: d[2] } : null; };

export const ANGEL = {
  '000': 'a fresh start and endless possibility', '111': 'fast-manifesting thoughts, so think happy ones', '222': 'balance and trust, as things fall into place',
  '333': 'support and encouragement all around you', '444': 'protection and steady foundations: you are on the right track', '555': 'big change coming, and for the better',
  '666': 'a reminder to rebalance and care for yourself', '777': 'luck, intuition and spiritual growth', '888': 'abundance and rewards for your effort', '999': 'a chapter is ending so a new one can begin',
  '1010': 'positivity and growth', '1111': 'wishes and a doorway of new beginnings', '1212': 'stepping out of your comfort zone with trust', '1234': 'a clear path, step by step',
  '1122': 'new beginnings in partnership', '2222': 'harmony and a strong foundation', '5555': 'major positive change',
};
const DIGIT = ['fresh starts', 'new beginnings and leadership', 'harmony and partnership', 'creativity and joy', 'stability and hard work', 'change and freedom', 'love and home', 'wisdom and intuition', 'abundance and strength', 'completion and kindness'];
export function angelNumber(num) {
  const n = String(num);
  if (ANGEL[n]) return ANGEL[n];
  if (/^(\d)\1+$/.test(n)) return `a strong message of ${DIGIT[+n[0]]}`;
  const r = reduce(+n, false);
  return `it adds up to ${r}, the number of ${DIGIT[r]}`;
}

export const COLOURS = ['', 'red', 'orange', 'yellow', 'green', 'sky blue', 'pink', 'violet', 'emerald green', 'gold'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const NUMBER_DAY = ['', 'Sunday', 'Monday', 'Thursday', 'Sunday', 'Wednesday', 'Friday', 'Monday', 'Saturday', 'Tuesday'];

// harmless symbolic rituals (no fire, nothing to swallow, nothing risky)
export const RITUALS = {
  love: ['write three things you love about yourself on pink paper and keep it in your wallet', 'place a rose quartz or a pink flower by your bed and say one kind word to yourself each morning'],
  career: ['write your goal on a bay leaf or a small card and keep it under your laptop', 'on a Thursday, tidy your desk and set one tiny goal for the week'],
  study: ['write the subject on a sticky note with a star on it and look at it before you start', 'open the window, take three slow breaths, then study for 25 minutes'],
  luck: ['carry something green for seven days and smile at three strangers', 'write your wish on paper, fold it towards you three times and keep it in a book'],
  calm: ['hold a glass of water, think of what you want to release, then water a plant with it', 'light a gentle lamp in the evening, list three things you are grateful for, and switch off your phone'],
  general: ['under tonight\'s moon, write one intention and read it aloud once', 'put a coin in a jar for every kind thing you do this week, then share the jar'],
};
