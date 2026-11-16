// Small talk helpers that need no AI: "thinking" fillers, clarifying questions, group acknowledgements for a busy
// chat, and the reading session (free follow-ups about a viewer's reading). Every line says the viewer's name.
import { classifyIntent, normalizeComment, extractBirthDate, detectLanguage } from './chat.js';
import { topicOf } from './ai.js';
import { PY_SHORT, LP_SHORT } from './variety.js';

/** Said at once while her real answer (AI / voice) is still being made, so she never sounds stuck. */
export const FILLER_T = [
  '{name}, hmm, let me read the stars for you...',
  '{name}, one moment, the cards are turning...',
  '{name}, let me look into the crystal ball...',
  '{name}, ooh, good one. Let me see...',
  '{name}, hmm, the candles are whispering something...',
  '{name}, let me feel your energy...',
  '{name}, wait, the stars are aligning for you...',
  '{name}, mmm, give me a second with the cards...',
];
export const FILLER_UR_T = [
  '{name}, hmm, zara sitaron se poochti hoon...',
  '{name}, ek lamha, cards palat rahi hoon...',
  '{name}, crystal ball mein dekhti hoon...',
];

/** She did not understand: she asks the person directly. */
export const CLARIFY_DATE_T = [
  '{name}, did you mean your birth date? Write it like 12 Aug 1998.',
  '{name}, is that your birth date? Please write it like 12 Aug 1998, and I will read your numbers.',
  '{name}, I see numbers! If that is your date of birth, write it like 5 March 1995.',
];
export const CLARIFY_UR_DATE_T = ['{name}, kya ye aap ki date of birth hai? Aise likhein: 12 Aug 1998.'];
export const CLARIFY_T = [
  '{name}, what do you mean, my dear? Ask me about love, work or luck, or write your birth date like 12 Aug 1998.',
  '{name}, I did not quite catch that. Tell me more: is it about love, money or your future?',
  '{name}, say that again for me? You can ask me a question, or type your birth date like 12 Aug 1998.',
  '{name}, the stars are confused! What would you like to know?',
];
export const CLARIFY_UR_T = ['{name}, main samajh nahi saki. Mohabbat, kaam ya qismat ke baare mein poochein, ya apni date of birth likhein: 12 Aug 1998.'];

/** A very busy chat: those who waited too long are greeted together, by name (nobody is silently dropped). */
export const GROUP_T = [
  '{names}, I see all your messages! The chat is busy, so a blessing for each of you: good news is on its way. Comment your birth date for your own reading.',
  '{names}, thank you for writing to me! I cannot answer everyone at once, but the stars are smiling at you. Ask again and I will come to you.',
  '{names}, your messages reached the crystal ball! Keep them coming, and type your name and birth date for a prediction.',
  'So many of you tonight! {names}, I see you and I send you lucky energy. Ask me again in a moment.',
];

/** Second birth date from someone who already had their reading this LIVE. */
export const ALREADY_READ_T = [
  '{name}, I already read your numbers tonight: {numbers}. Ask me a question about it, or send a gift for a deeper reading!',
  '{name}, your reading is done for this LIVE: {numbers}. You can still ask me anything about it!',
];

/** End of the free follow-ups after a reading. Gentle, no pressure. */
export const SESSION_END_T = [
  'That was your free follow-up, {name}. If you want more, send a gift or ask me again later. I loved reading for you!',
  '{name}, our little session is complete for now. A gift unlocks more, or come back later and I will look again.',
  'And that closes your reading, {name}. Thank you! Send a gift if you want me to look deeper, or ask again a bit later.',
];

const TOPIC_LINES = {
  love: ['In love, your Personal Year {py} says: {pyText} Be open, but take your time.', 'For your heart, Life Path {lp} loves honestly. This year the energy is {pyText}'],
  career: ['For work, your Life Path {lp} gives you {lpText} Use it: this year is {pyText}', 'Career-wise, Personal Year {py} is {pyText} Step forward when a door opens.'],
  money: ['With money, Personal Year {py} means {pyText} Plan before you spend.', 'Your Life Path {lp} is {lpText} Money follows focus this year.'],
  study: ['For studies, Personal Year {py} is {pyText} Steady effort will show.', 'Life Path {lp} learns best with patience. This year: {pyText}'],
  travel: ['Travel? Personal Year {py} is {pyText} Keep your plans flexible.', 'Your numbers like movement this year: {pyText}'],
  family: ['For family, your Life Path {lp} is {lpText} This year: {pyText}', 'At home, Personal Year {py} brings {pyText}'],
  health: ['I cannot answer health questions, please ask a doctor. But your numbers say: {pyText}'],
  other: ['Your numbers say: Personal Year {py}, {pyText} Trust your timing.', 'Remember, Life Path {lp}: {lpText} This year: {pyText}', 'The short answer from your numbers: yes, step by step. Personal Year {py} is {pyText}'],
};

const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const clean = (s) => String(s || '').replace(/^(a|an) /, '').replace(/\.$/, '');

/** Is she unsure what this comment means? -> 'date' (numbers that are not a readable date) / 'unclear' / null */
export function unclearKind(comment) {
  const t = normalizeComment(comment);
  if (!t) return 'unclear';
  if (/\d/.test(t) && !extractBirthDate(t) && !/\b(1{3,}|2{3,}|3{3,}|4{3,}|5{3,}|6{3,}|7{3,}|8{3,}|9{3,})\b/.test(t)) return 'date';
  const intent = classifyIntent(t);
  if (intent !== 'fallback') return null;
  const words = t.split(/\s+/);
  // small talk she understands without a question back ("nice", "you are beautiful", "lol")
  if (/\b(nice|wow|beautiful|pretty|cute|cool|love|lol|haha+|hehe|ok|okay|yes|no|yeah|great|amazing|good|awesome|mashallah|masha allah|subhanallah|wah|zabardast|acha|theek|sahi)\b/i.test(t)) return null;
  // gibberish ("asdfgh") or one or two words she can't place
  const letters = t.replace(/[^a-z]/gi, '');
  if (letters.length >= 4 && !/[aeiouy]/i.test(letters)) return 'unclear';
  if (words.length <= 2) return 'unclear';
  return null;
}

/** "Sara, did you mean your birth date? ..." */
export function clarifyLine(kind, name, comment, pick) {
  const ur = detectLanguage(comment) === 'roman-ur';
  const list = kind === 'date' ? (ur ? CLARIFY_UR_DATE_T : CLARIFY_DATE_T) : (ur ? CLARIFY_UR_T : CLARIFY_T);
  return fill(pick(kind === 'date' ? 'clarify-date' : 'clarify', list), { name });
}

/** A follow-up about their reading, from their numbers (no AI): topic of the comment -> a line about it. */
export function sessionLine({ name, facts = {}, comment, pick }) {
  const py = facts.personalYear, lp = facts.lifePath;
  const pyText = py && PY_SHORT[py] ? PY_SHORT[py][0] : 'a year of steady growth.';
  const lpText = lp && LP_SHORT[lp] ? LP_SHORT[lp][0] : 'a soul with your own rhythm.';
  const tp = topicOf(comment || '') || 'other';
  const list = (TOPIC_LINES[tp] || TOPIC_LINES.other).filter((l) => (lp || !/\{lp/.test(l)) && (py || !/\{py\}/.test(l)));
  const body = fill(pick('session-' + tp, list.length ? list : TOPIC_LINES.other), { py: py || '', lp: lp || '', pyText, lpText });
  return `${name}, ${body.charAt(0).toLowerCase() + body.slice(1)}`;
}

export function numbersPhrase(facts = {}) {
  const bits = [];
  if (facts.lifePath) bits.push(`Life Path ${facts.lifePath}`);
  if (facts.personalYear) bits.push(`Personal Year ${facts.personalYear}`);
  return bits.join(' and ') || 'your numbers are glowing';
}
export { fill, clean };
