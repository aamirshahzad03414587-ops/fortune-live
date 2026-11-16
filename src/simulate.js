// CLI simulator: creates demo form submissions and fakes gifts + code comments.
// Usage: npm run simulate            (server must be running: npm start)
//        npm run simulate -- 5       (simulate 5 viewers)
import { loadConfig } from './config.js';
const cfg = loadConfig();
const base = process.env.BASE_URL || `http://localhost:${cfg.port}`;
const headers = { 'content-type': 'application/json', ...(cfg.adminKey ? { 'x-admin-key': cfg.adminKey } : {}) };
const post = async (p, body) => { const r = await fetch(base + '/api/admin' + p, { method: 'POST', headers, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };
const people = [
  ['Ayesha Khan', '1998-07-23', 'Nadia Khan', 'Imran Khan', 'Will I find love this year?', 'Rose', 1],
  ['Omar Farooq', '1991-11-29', '', '', 'Should I start my own business?', 'Doughnut', 30],
  ['Sara Malik', '2001-02-14', 'Hina Malik', '', 'Will I move abroad?', 'Rose', 1],
  ['Bilal Ahmed', '1985-12-03', '', 'Tariq Ahmed', 'What does 2026 hold for my money?', 'Hand Hearts', 100],
  ['Fatima Noor', '1995-04-22', '', '', '', 'Rose', 1],
  ['Hamza Ali', '1978-04-22', '', '', 'Will my exams go well?', 'Rose', 1],
];
const n = Math.min(Number(process.argv[2] || 3), people.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < n; i++) {
  const [fullName, dob, motherName, fatherName, question, giftName, diamonds] = people[i];
  const nick = fullName.split(' ')[0] + '_' + (100 + i);
  const { code, reportUrl } = await post('/sim/submission', { fullName, dob, motherName, fatherName, question });
  console.log(`${nick}: form submitted -> code ${code}  report ${base}${reportUrl}`);
  await post('/sim/like', { nickname: nick, count: 15 });
  const g = await post('/sim/gift', { nickname: nick, giftName, diamonds });
  console.log(`  sent ${giftName} (${diamonds} diamonds)`, g.ok ? 'credited' : g.reason);
  const c = await post('/sim/chat', { nickname: nick, comment: `my code #${code} 🙏` });
  console.log(`  commented code ->`, c.ok ? `queued (${c.item.tierName})` : c.reason);
  await sleep(800);
}
await post('/sim/follow', { nickname: 'NewFan_77' });
// chat comments: Mira answers these one by one after the readings
for (const [nickname, comment] of [['Zainab_07', 'Assalam o alaikum Mira!'], ['rohan.k', 'will I get married this year?'], ['spam_bot', 'free followers www.cheap.com'], ['Hira_x', 'born 14 march 1996']]) {
  const r = await post('/sim/comment', { nickname, comment });
  console.log(`${nickname} comments "${comment}" ->`, r.ok ? 'queued for Mira' : 'skipped: ' + r.reason);
}
console.log('Done. Watch the overlay.');
