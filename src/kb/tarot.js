// The 78 tarot cards (Rider-Waite names), short upright / reversed meanings for speaking aloud. Entertainment only.
const MAJOR = [
  ['The Fool', 'a fresh start, a leap of faith and a free spirit', 'holding back, or rushing in without looking'],
  ['The Magician', 'skill, willpower and making things happen', 'scattered energy or tricks; focus your talents'],
  ['The High Priestess', 'intuition, secrets and quiet inner wisdom', 'ignoring your gut; listen inside'],
  ['The Empress', 'abundance, love, comfort and creativity', 'neglecting yourself; nurture your own garden'],
  ['The Emperor', 'structure, protection and steady leadership', 'too much control, or too little discipline'],
  ['The Hierophant', 'tradition, guidance and learning from a mentor', 'breaking the rules to find your own way'],
  ['The Lovers', 'love, harmony and an important choice of the heart', 'mixed signals; choose with your values'],
  ['The Chariot', 'drive, victory and moving forward with purpose', 'pulling in two directions; steady the reins'],
  ['Strength', 'courage, patience and gentle power', 'self-doubt; your quiet strength is still there'],
  ['The Hermit', 'reflection, solitude and searching for truth', 'too much isolation; let a friend in'],
  ['Wheel of Fortune', 'luck, cycles and a turn for the better', 'a slow spin; patience until the wheel turns'],
  ['Justice', 'fairness, truth and balance', 'something feels unfair; be honest with yourself'],
  ['The Hanged Man', 'pause, surrender and a new point of view', 'stalling; it is time to decide'],
  ['Death', 'an ending that clears the way for a new beginning (never a literal death)', 'resisting change; let the old chapter close'],
  ['Temperance', 'balance, patience and the right mix', 'too much of one thing; find your middle path'],
  ['The Devil', 'temptation, habits and things that tie you down', 'breaking free from what holds you back'],
  ['The Tower', 'a sudden shake-up that reveals the truth', 'a change you already feel coming; rebuild stronger'],
  ['The Star', 'hope, healing and wishes coming true', 'a dim moment; keep your hope alive'],
  ['The Moon', 'dreams, mystery and trusting your intuition', 'confusion lifting; the truth comes to light'],
  ['The Sun', 'joy, success and warm good vibes', 'a cloudy day before the sunshine returns'],
  ['Judgement', 'awakening, a calling and a second chance', 'being too hard on yourself; forgive and rise'],
  ['The World', 'completion, success and a happy ending to a chapter', 'almost there; finish what you started'],
];
const RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
const MINOR = {
  Wands: [ // fire: passion, energy, career
    ['a spark of inspiration and a bold new start', 'a delay; the spark needs fuel'],
    ['planning your next big move', 'fear of leaving your comfort zone'],
    ['expansion and your ships coming in', 'plans that need more patience'],
    ['celebration, home and happy gatherings', 'tension at home that will pass'],
    ['friendly competition and clashing ideas', 'avoiding a needed conversation'],
    ['victory, praise and public recognition', 'waiting for the applause; believe in yourself'],
    ['standing your ground with courage', 'feeling tired of defending yourself'],
    ['fast news and things moving quickly', 'slowdowns; messages arrive late'],
    ['resilience; you are almost at the finish', 'exhaustion; rest before the last step'],
    ['carrying a heavy load', 'putting down burdens that are not yours'],
    ['exciting news and a curious adventure', 'restless ideas without a plan'],
    ['passion, action and a daring move', 'haste; slow down a little'],
    ['confidence, warmth and charisma', 'jealousy or insecurity; shine anyway'],
    ['a natural leader with a big vision', 'impatience; lead with kindness'],
  ],
  Cups: [ // water: love, feelings
    ['new love and an open, overflowing heart', 'feelings held back; open up slowly'],
    ['a beautiful bond and mutual attraction', 'a small misunderstanding between two hearts'],
    ['friendship, fun and celebration', 'too many voices; choose your circle'],
    ['daydreaming and missing an offer in front of you', 'saying yes to new chances'],
    ['regret over what was lost', 'moving on and seeing what remains'],
    ['sweet memories and childhood joy', 'living in the past; look ahead'],
    ['many choices and wishful dreams', 'clarity; one option shines'],
    ['walking away to find something deeper', 'fear of change; or returning to try again'],
    ['the wish card: contentment and a wish granted', 'a wish that needs a clearer heart'],
    ['happy family and emotional fulfilment', 'small family tension; talk it out'],
    ['a sweet message or a creative idea', 'moodiness; express your feelings kindly'],
    ['romance, charm and an offer of love', 'mixed promises; look for actions'],
    ['compassion and emotional wisdom', 'giving too much; care for yourself'],
    ['calm, balanced and generous emotions', 'hidden feelings; let them out gently'],
  ],
  Swords: [ // air: mind, truth, decisions
    ['a breakthrough idea and clear truth', 'confusion; take a breath before deciding'],
    ['a difficult choice and a pause', 'the choice becomes clear'],
    ['heartache that teaches and heals', 'healing and forgiveness'],
    ['rest, recovery and a quiet break', 'restlessness; you are ready to return'],
    ['conflict and choosing your battles', 'making peace after an argument'],
    ['moving to calmer waters', 'unfinished business; let it go'],
    ['strategy and thinking cleverly', 'coming clean; honesty wins'],
    ['feeling stuck by your own thoughts', 'freedom; the blindfold comes off'],
    ['worry at night that looks bigger than it is', 'the worry fades with the morning'],
    ['the end of a painful chapter, and dawn after it', 'recovery; the worst is behind you'],
    ['curiosity and sharp new ideas', 'gossip; think before you speak'],
    ['fast action and ambition', 'rushing; aim before you charge'],
    ['clear, honest and independent thinking', 'coldness; mix truth with kindness'],
    ['wisdom, logic and fair decisions', 'overthinking; trust your heart too'],
  ],
  Pentacles: [ // earth: work, home, practical life (no money guarantees)
    ['a new practical opportunity and steady growth', 'a plan that needs a firmer base'],
    ['juggling priorities with grace', 'too many things at once; simplify'],
    ['teamwork and skills being noticed', 'working alone; ask for help'],
    ['saving and holding on tight', 'loosening your grip; share a little'],
    ['a tough patch and finding support', 'recovery; help arrives'],
    ['generosity and giving and receiving', 'balance what you give and take'],
    ['patience; your efforts are growing', 'impatience with slow results'],
    ['hard work and mastering a craft', 'perfectionism; progress over perfect'],
    ['comfort, independence and self-worth', 'relying on others; trust your own strength'],
    ['family, roots and long-term stability', 'family plans that need a talk'],
    ['a new skill and a study opportunity', 'distraction from your goals'],
    ['steady, reliable progress', 'feeling stuck in a routine'],
    ['a warm, practical, caring nature', 'balance work and self-care'],
    ['security, success and a generous spirit', 'stubbornness; stay open to new ways'],
  ],
};
const SUIT_THEME = { Wands: 'passion and career', Cups: 'love and feelings', Swords: 'thoughts and decisions', Pentacles: 'work and home life' };

export const CARDS = [
  ...MAJOR.map(([name, up, rev], i) => ({ id: i, name, arcana: 'major', up, rev })),
  ...Object.entries(MINOR).flatMap(([suit, list], s) => list.map(([up, rev], r) => ({ id: 22 + s * 14 + r, name: `${RANKS[r]} of ${suit}`, arcana: 'minor', suit, theme: SUIT_THEME[suit], up, rev }))),
];

/** Draw n different cards; each may be reversed (about 1 in 3). random: () => [0, 1). */
export function draw(n = 1, random = Math.random) {
  const pool = CARDS.slice(), out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const c = pool.splice(Math.floor(random() * pool.length), 1)[0];
    out.push({ ...c, reversed: random() < 0.33 });
  }
  return out;
}

export const cardMeaning = (c) => (c.reversed ? c.rev : c.up);
export const cardTitle = (c) => `${c.name}${c.reversed ? ' reversed' : ''}`;
/** Look a card up by name in text ("what does the tower mean", "three of cups"). */
export function findCard(text) {
  const t = String(text || '').toLowerCase();
  const nums = { 1: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
  const norm = t.replace(/\b(\d{1,2})\b/g, (m) => nums[m] || m).replace(/\bcoins?\b/g, 'pentacles').replace(/\bstaffs?|rods?\b/g, 'wands');
  return CARDS.slice().sort((a, b) => b.name.length - a.name.length).find((c) => norm.includes(c.name.toLowerCase()) || norm.includes(c.name.toLowerCase().replace(/^the /, '') + ' card')) || null;
}
