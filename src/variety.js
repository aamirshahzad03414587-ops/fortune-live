// Varied wording for spoken readings and greetings, so viewers with the same birth date never hear the same lines
// in one stream. Choices are deterministic (a hash of name + birth date + a per-stream seed) and remembered per
// stream: the same variant is never used twice in a row, and never twice for the same birth date until all are used.

/** FNV-1a 32-bit hash. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export class Variety {
  constructor(seed = '') { this.seed = String(seed); this.last = new Map(); this.byKey = new Map(); }
  /** Index into a list of n options for `cat`. `who` seeds the choice; `group` (e.g. the birth date) must not repeat. */
  pick(cat, n, who = '', group = '') {
    if (n <= 1) return 0;
    const base = hash(`${this.seed}|${who}|${cat}`) % n;
    const gk = group ? `${cat}|${group}` : null;
    const used = gk ? this.byKey.get(gk) || new Set() : new Set();
    if (used.size >= n) used.clear();                       // every variant used for this group: start over
    const last = this.last.get(cat);
    let idx = -1;
    for (let k = 0; k < n; k++) { const i = (base + k) % n; if (used.has(i) || i === last) continue; idx = i; break; }
    if (idx < 0) for (let k = 0; k < n; k++) { const i = (base + k) % n; if (i !== last) { idx = i; break; } }
    if (idx < 0) idx = base;
    this.last.set(cat, idx);
    if (gk) { used.add(idx); this.byKey.set(gk, used); }
    return idx;
  }
  choose(cat, list, who, group) { return list[this.pick(cat, list.length, who, group)]; }
}

/** Stateless choice (no stream memory): still differs by name + birth date. */
export const choose = (cat, list, who = '') => list[hash(`${who}|${cat}`) % list.length];

// ---------------------------------------------------------------- reading wording
// {name} {date} {n} {m} (meaning) placeholders. Meanings are fragments that fit every frame of their kind.
export const READING_T = {
  lead: [
    '{name}, born {date}.',
    '{name}, born on {date}. Let me look at your numbers.',
    'Ah, {name}, {date}. The crystal ball is already glowing.',
    '{name}, your date is {date}. Let us see what it holds.',
    'Here we go, {name}, born {date}.',
    '{name}, {date}. Your numbers are speaking to me.',
  ],
  lifePath: [
    'You are Life Path {n}, {m}',
    'Your Life Path is {n}. That makes you {m}',
    'Life Path {n} is yours, and it shows you are {m}',
    'Your birth date adds up to Life Path {n}: you are {m}',
    'I see Life Path {n}, {m}',
    'Number {n} rules your Life Path. You are {m}',
  ],
  year: [
    '2026 is your Personal Year {n}, {m}',
    'For 2026 you are in Personal Year {n}, {m}',
    'This year is a Personal Year {n} for you, {m}',
    'Your 2026 vibration is Personal Year {n}, {m}',
    'And 2026? Personal Year {n}, {m}',
  ],
  soul: [
    'Your heart, Soul Urge {n}, {m}',
    'Deep inside, with Soul Urge {n}, your heart {m}',
    'Your Soul Urge number is {n}, and your heart {m}',
    'With Soul Urge {n}, your heart {m}',
    'Your inner self, Soul Urge {n}, {m}',
  ],
  expression: [
    'Your destiny, Expression {n}, {m}',
    'Your name gives Expression {n}; your destiny {m}',
    'Expression {n} says your purpose {m}',
    'From your name, Expression {n}, your calling {m}',
    'Your destiny number, Expression {n}, says your mission {m}',
  ],
  parentsBoth: [
    'Your parents\' names add a {a} and a {b} to your path.',
    'From your mother {M} comes a {a}, and from your father {F} a {b}. Both protect your path.',
    '{M} and {F} give you a {a} and a {b}, a family blessing on your path.',
    'Your mother {M} brings a {a}, your father {F} a {b}. Their energy stands behind you.',
    'I feel your family too: {M} adds a {a}, {F} adds a {b}.',
  ],
  parentOne: [
    'Your {who}\'s name adds a {a}, {title}.',
    'Your {who} {P} brings you a {a}, {title}.',
    '{P}, your {who}, gives your path a {a}, {title}.',
    'From your {who} {P} comes the {a}, {title}, guarding you.',
  ],
  question: [
    'You asked, {q} {g}',
    'About your question, {q} {g}',
    'You asked me, {q} Here is what I see: {g}',
    'You want to know, {q} The stars say: {g}',
    'And your question, {q} {g}',
  ],
  closer: [
    '', 'Trust your numbers, {first}.', 'The stars are with you, {first}.', 'Keep this energy close, {first}.',
    'May your numbers guide you, {first}.', 'That is your reading, {first}. Blessings!',
  ],
};

// 5 wordings per number (the first is the original)
export const LP_SHORT = {
  1: ['a born leader who is meant to forge your own way.', 'a pioneer with the courage to go first.', 'an independent spirit who shines brightest when you lead.', 'a trailblazer, built to start what others only dream about.', 'a natural leader full of fire and original ideas.'],
  2: ['a gentle heart with the gift of bringing people together.', 'a peacemaker who feels what others need before they say it.', 'a diplomat with a soft heart and sharp intuition.', 'the gentle bridge between people.', 'a partner soul who grows strongest in harmony.'],
  3: ['a creative spirit whose words and joy light up others.', 'a born communicator with sunshine in your voice.', 'an artist at heart who turns feelings into words and colour.', 'a joyful soul who makes every room lighter.', 'a creative storyteller with a magnetic smile.'],
  4: ['a steady builder who turns effort into lasting success.', 'a builder whose patience makes dreams solid.', 'the rock others lean on, loyal and hardworking.', 'a planner who turns chaos into order.', 'a steady soul whose work stands the test of time.'],
  5: ['a free soul who grows through change and adventure.', 'an adventurer who needs freedom like air.', 'a curious explorer of places, people and ideas.', 'a restless, magnetic spirit made for change.', 'a free bird who learns by living fully.'],
  6: ['a loving protector whose home and family are your strength.', 'a nurturer with a heart big enough for everyone.', 'the caretaker who makes any place feel like home.', 'a loving soul with a strong sense of beauty and duty.', 'a healer of hearts, devoted to the people you love.'],
  7: ['a deep seeker who finds truth others miss.', 'a seeker of hidden truths and quiet wisdom.', 'a thinker with deep intuition and an old soul.', 'a mystic mind who needs silence to hear the answers.', 'an observer who sees straight through the surface.'],
  8: ['a powerhouse built for success, money and authority.', 'a natural boss with a gift for money and big results.', 'an ambitious soul made for leadership and abundance.', 'a strong achiever who rises after every setback.', 'a born executive with power in your hands.'],
  9: ['a compassionate old soul here to help the world.', 'a humanitarian with a wise and generous heart.', 'an old soul who carries the wisdom of every number.', 'a giver whose kindness reaches far beyond you.', 'a dreamer of a better world with a big, forgiving heart.'],
  11: ['a master intuitive whose inner voice can inspire many.', 'a spiritual messenger with powerful intuition.', 'a sensitive old soul who can light the way for others.', 'a visionary with a master number glowing on your path.', 'an inspired dreamer who feels what others cannot see.'],
  22: ['a master builder able to turn huge dreams into reality.', 'a master builder with the power to shape the world.', 'a visionary who can make the impossible real.', 'a rare master number, made for big and lasting work.', 'a practical dreamer with a huge destiny.'],
  33: ['a master teacher whose love heals those around you.', 'a master teacher with a healing heart.', 'a rare soul of pure compassion and guidance.', 'a nurturer of many, carrying the master number of love.', 'a gentle guide whose care changes lives.'],
};
export const PY_SHORT = {
  1: ['a year of fresh starts, so plant the seeds you want to grow for nine years.', 'a fresh start, the first page of a new nine-year chapter.', 'a year to begin boldly and put yourself first.', 'a year of new doors, new plans and brave first steps.', 'a year to plant the seeds of your next nine years.'],
  2: ['a slower year of patience, partnership and quiet growth.', 'a gentle year of patience, love and partnership.', 'a year where cooperation wins over force.', 'a soft, slow year, where good things grow quietly.', 'a year of relationships, details and inner calm.'],
  3: ['a bright, social year to express yourself and enjoy life.', 'a joyful year of creativity, friends and visibility.', 'a year to speak up, create and celebrate.', 'a lively year where people bring you luck.', 'a year of fun, expression and new friendships.'],
  4: ['a year of hard work and building solid foundations.', 'a year of steady work and strong foundations.', 'a year to organise, save and build step by step.', 'a disciplined year where effort really pays.', 'a year of solid plans, good health and hard work.'],
  5: ['a year of change, travel and surprising opportunities.', 'a lively year of change, movement and surprises.', 'a turning-point year full of new experiences.', 'a year to say yes to adventure and stay flexible.', 'a restless, exciting year of travel and freedom.'],
  6: ['a year of love, family and responsibility.', 'a warm year focused on home, love and family.', 'a year of commitment, care and deeper bonds.', 'a year where love and responsibility walk together.', 'a heart-centred year of family, beauty and support.'],
  7: ['a quiet, reflective year to look inward and grow wiser.', 'a quiet year of study, faith and inner growth.', 'a reflective year to rest, learn and trust your intuition.', 'a soul-searching year where the answers come from within.', 'a slower year for wisdom, healing and planning.'],
  8: ['a powerful year of achievement, money and recognition.', 'a harvest year for career, money and recognition.', 'a power year where past effort gets rewarded.', 'a year to think big and claim your success.', 'a strong year of ambition, authority and abundance.'],
  9: ['a year of endings and release that clears the way for something new.', 'a year of completion, forgiveness and letting go.', 'a closing chapter that makes room for a new beginning.', 'a year to finish, release and clear space for 2027.', 'a cleansing year of endings and a generous heart.'],
};
export const SOUL_SHORT = {
  1: ['longs for independence and recognition.', 'wants to stand on its own and be seen.', 'craves the freedom to lead your own life.', 'dreams of achieving something truly yours.', 'needs respect and room to shine.'],
  2: ['longs for true love and peace.', 'wants a gentle, loyal partner.', 'craves harmony and closeness.', 'dreams of a love that feels safe.', 'needs peace more than victory.'],
  3: ['longs to create and be heard.', 'wants to express itself freely.', 'craves joy, laughter and an audience.', 'dreams in colours, words and music.', 'needs to share its light with others.'],
  4: ['longs for security and a stable home.', 'wants order and something solid to build on.', 'craves loyalty and a reliable life.', 'dreams of a safe, well-built future.', 'needs stability to feel free.'],
  5: ['longs for freedom and adventure.', 'wants to travel and taste everything life offers.', 'craves excitement and new horizons.', 'dreams of open roads.', 'needs space to breathe and roam.'],
  6: ['longs for a loving family.', 'wants to care for the people it loves.', 'craves a warm, beautiful home.', 'dreams of a love that lasts.', 'needs to feel needed and loved.'],
  7: ['longs for truth and inner peace.', 'wants to understand the mysteries of life.', 'craves quiet time and deep answers.', 'dreams of wisdom and faith.', 'needs solitude to recharge.'],
  8: ['longs for success and respect.', 'wants to build something powerful.', 'craves achievement and financial freedom.', 'dreams of being at the top.', 'needs to prove its strength.'],
  9: ['longs to make the world better.', 'wants to help and heal others.', 'craves a life with meaning.', 'dreams of a kinder world.', 'needs to give to feel whole.'],
  11: ['longs for spiritual meaning.', 'wants to inspire and uplift.', 'craves a deeper connection to the unseen.', 'dreams of a higher purpose.', 'needs to follow its intuition.'],
  22: ['longs to build a lasting legacy.', 'wants to create something that outlives you.', 'craves big, meaningful work.', 'dreams on a grand scale.', 'needs a mission worthy of its power.'],
  33: ['longs to heal and uplift others.', 'wants to guide with love.', 'craves to serve with compassion.', 'dreams of healing the people around you.', 'needs to give love freely.'],
};
export const EXPR_SHORT = {
  1: ['is to lead and invent.', 'is to pioneer new ideas.', 'is to go first and show the way.', 'is to create with courage.', 'is to stand out and lead.'],
  2: ['is to unite and support.', 'is to bring people together.', 'is to heal through kindness.', 'is to be the trusted partner.', 'is to make peace.'],
  3: ['is to inspire through expression.', 'is to create and communicate.', 'is to bring joy through words and art.', 'is to lift others with your voice.', 'is to tell stories that touch hearts.'],
  4: ['is to build what lasts.', 'is to organise and protect.', 'is to turn plans into reality.', 'is to create order and security.', 'is to work with patience and skill.'],
  5: ['is to explore and promote progress.', 'is to spread new ideas.', 'is to adapt and inspire change.', 'is to connect people and places.', 'is to live boldly and teach freedom.'],
  6: ['is to nurture and serve.', 'is to care for family and community.', 'is to create harmony and beauty.', 'is to heal and protect.', 'is to teach through love and duty.'],
  7: ['is to master knowledge.', 'is to seek and share wisdom.', 'is to uncover hidden truths.', 'is to think deeply and teach.', 'is to bring faith and insight.'],
  8: ['is to achieve and manage wealth.', 'is to lead in business and power.', 'is to build abundance.', 'is to organise big things.', 'is to turn ambition into results.'],
  9: ['is to serve humanity.', 'is to give and inspire.', 'is to heal the world in your own way.', 'is to teach compassion.', 'is to finish what matters and uplift many.'],
  11: ['is to illuminate others.', 'is to inspire through intuition.', 'is to be a light for many.', 'is to share spiritual insight.', 'is to awaken others.'],
  22: ['is to build on a grand scale.', 'is to turn great visions into reality.', 'is to create a lasting legacy.', 'is to lead big projects for many.', 'is to build for the future.'],
  33: ['is to teach through love.', 'is to heal and guide.', 'is to serve with compassion.', 'is to uplift through kindness.', 'is to be a teacher of the heart.'],
};

// ---------------------------------------------------------------- greetings for viewers who join
// Every welcome says who she is and how to get a reading. {names} = "Sara, Ali and Zoya", {ex} = "Sara 12/05/1998".
export const WELCOME_T = [
  'Welcome {names}!', 'Hello {names}, welcome to my table!', 'Hi {names}! The candles brightened when you came in.',
  'Welcome in, {names}!', 'Oh, {names}, welcome! Come sit by my crystal ball.', 'Hey {names}, so happy you are here!',
  'Welcome, welcome, {names}!', '{names}, welcome to the circle!', 'The stars just whispered your names: welcome, {names}!',
  'Hello {names}! My crystal ball lit up for you.',
];
export const WELCOME_ONE_T = [
  'Welcome {names}!', 'Hello {names}, welcome to my table!', 'Hi {names}! The candles brightened when you came in.',
  'Welcome in, {names}!', 'Oh, {names}, welcome! Come sit by my crystal ball.', 'Hey {names}, so happy you are here!',
  '{names}, welcome to the circle!', 'The stars just whispered your name: welcome, {names}!', 'Hello {names}! My crystal ball lit up for you.',
  'Look who arrived: {names}! Welcome.',
];
export const HOWTO_T = [
  'I\'m Mira, I read your destiny with numerology. Type your name and birth date in the comments, like {ex}.',
  'I\'m Mira, and I read numbers. Comment your name and birth date, like {ex}, for your 2026 prediction.',
  'I read destinies from birth dates. Just comment your name and date of birth, like {ex}.',
  'Want your reading? Type your name and birth date, like {ex}, and add a question if you like.',
  'I\'m Mira, your numerology fortune teller. Comment your name and birth date and I\'ll read your numbers live.',
  'Comment your name and birth date, like {ex}, and I will reveal your Life Path and your year ahead.',
  'I\'m reading everyone\'s numbers tonight. Your name and birth date in the comments, like {ex}, is all I need.',
  'Your prediction is free: type your name and birth date, like {ex}, and ask me one question.',
];
// short version when she welcomes often (busy LIVE)
export const HOWTO_SHORT_T = [
  'Comment your name and birth date for your reading!', 'Type your name and birth date, and I\'ll read your numbers.',
  'Name and birth date in the comments for your prediction!', 'Your name and birth date, and your destiny is next!',
];
export const EXAMPLE_DATES = ['12/05/1998', '03/11/2001', '25/07/1995', '08/02/1999', '17/09/1993', '30/04/2000'];

// ---------------------------------------------------------------- idle lines (nothing happening for a while)
export const IDLE_T = [
  'Who wants a prediction? Comment your name and birth date, like Sara 12 May 1998, and ask me one question.',
  'The crystal ball is restless tonight. Comment your name and birth date and let me read your numbers.',
  'Fun fact: 11, 22 and 33 are master numbers. Comment your birth date to see if you carry one!',
  'Did you know your Life Path number comes from your full birth date added together? Comment yours and I will add it up live.',
  'Numerology secret: people with Life Path 7 often feel they think differently. Any sevens here tonight?',
  'Is 2026 your lucky year? Your Personal Year number knows. Comment your name and birth date.',
  'I can feel someone in the chat thinking about love. Ask me, with your name and birth date!',
  'Fun fact: in numerology, every nine years your life starts a new cycle. Want to know where you are? Comment your birth date.',
  'Quiet in here! Type your name and birth date, and I will tell you what the stars planned for your year.',
  'Here is a riddle: which number rules your heart? Comment your name and birth date and I will tell you.',
  'Numerology says 8 is the number of money and power. Is anyone here a Life Path 8? Tell me your birth date.',
  'Ask me about love, money, work or travel. Your name and birth date first, then your question!',
  'The candles are flickering, someone\'s destiny wants to be read. Is it yours? Comment your name and birth date.',
  'Fun fact: Pythagoras himself believed numbers hold the secrets of the universe. Let me read yours!',
];
