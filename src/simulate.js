// CLI simulator: creates demo form submissions and fakes gifts + code comments.
// Usage: npm run simulate            (server must be running: npm start)
//        npm run simulate -- 5       (simulate 5 viewers)
//        npm run simulate -- busy    (busy live: join bursts + same-birthday comment readings; prints what Mira says)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (process.argv[2] === 'busy') { await busyLive(); process.exit(0); }
const n = Math.min(Number(process.argv[2] || 3), people.length);
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

// Busy live: bursts of joins while viewers comment readings (some share a birthday). Logs every line Mira says,
// so you can check nobody is left un-greeted, readings come first, and she is never silent for long.
async function busyLive() {
  const { WebSocket } = await import('ws');
  const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  const said = [];
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.type === 'say' || d.type === 'reveal') { const it = d.item; said.push({ t: Date.now() - t0, it }); console.log(`${ts()} [${d.type}/${it.sub || it.kind || it.tierName || ''}] ${it.spoken || it.text || ''}`); } });
  await new Promise((r) => ws.on('open', r));
  const joiners = ['Sara', 'Ali', 'Zoya', 'Hina', 'Omar', 'Bilal', 'Ayesha', 'Fatima', 'Hamza', 'Noor', 'Rohan', 'Maya', 'Zain', 'Iqra', 'Usman', 'Mehak', 'Asad', 'Laiba'];
  const readings = [['Sara_1', 'Sara 12/05/1998'], ['Ali_2', 'Ali 12/05/1998 will I travel this year?'], ['Zoya_3', 'Zoya 12-05-1998 mother Nadia father Imran'], ['Omar_4', 'Omar 3 march 1990']];
  const joined = [];
  for (let i = 0; i < joiners.length; i++) { await post('/sim/join', { nickname: joiners[i] }); joined.push(joiners[i]); if (i % 6 === 5) await sleep(1500); }
  for (const [nickname, comment] of readings) { const r = await post('/sim/comment', { nickname, comment }); console.log(`${ts()} ${nickname}: "${comment}" ->`, r.ok ? 'queued' : r.reason); }
  await sleep(4000); for (const n of ['Kiran', 'Danish', 'Sana']) { await post('/sim/join', { nickname: n }); joined.push(n); }
  const dur = Number(process.env.SIM_SECONDS || 240) * 1000;
  while (Date.now() - t0 < dur) await sleep(1000);
  const all = said.map((s) => s.it.spoken || s.it.text || '').join(' ');
  const missed = joined.filter((n) => !all.includes(n));
  const gaps = said.slice(1).map((s, i) => (s.t - said[i].t) / 1000);
  console.log(`\n${said.length} lines; joiners ${joined.length}, not greeted: ${missed.length ? missed.join(', ') : 'none'}; longest gap between line starts ${Math.max(0, ...gaps).toFixed(1)} s`);
  ws.close();
}
