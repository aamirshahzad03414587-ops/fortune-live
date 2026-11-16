import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { LiveEngine } from '../src/live.js';
import { ReplyEngine } from '../src/chat.js';
import { Variety, hash, LP_SHORT, PY_SHORT, SOUL_SHORT, EXPR_SHORT, READING_T, WELCOME_T, HOWTO_T, IDLE_T } from '../src/variety.js';
import { parseReadingComment, readingScript } from '../src/comment-reading.js';
import { computeReading } from '../src/numerology.js';

const script = (comment, variety, level = 1) => {
  const p = parseReadingComment(comment, 'x');
  const r = computeReading({ fullName: p.name, dob: p.dob, motherName: p.mother, fatherName: p.father, question: p.question, year: 2026 });
  return readingScript(r, p, level, variety);
};

function setup(chat = {}, readings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-v-'));
  const clock = { t: 1_000_000 };
  const config = {
    trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
    tiers: [{ name: 'Short', minDiamonds: 1, level: 1, secondsOnScreen: 1 }],
    readings: { fromComments: true, maxQueue: 50, ...readings },
    limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 50, giftCreditMinutes: 10, secondsBetweenReadings: 0 },
    voice: { readingSpeechStart: 0, talkSpeechStart: 0, tailSeconds: 0, minSaySeconds: 0 },
    chat: { enabled: true, idlePromptSeconds: 0, joinGreetSeconds: 10, joinBatchSeconds: 2.5, joinMaxNames: 6, ...chat },
  };
  const live = new LiveEngine({ config, store: new Store(path.join(dir, 's.json')), now: () => clock.t, estimate: () => 0.01, replies: new ReplyEngine({ random: () => 0 }) });
  return { live, clock };
}

test('every number meaning has at least 5 wordings, every frame at least 4', () => {
  for (const T of [LP_SHORT, SOUL_SHORT, EXPR_SHORT]) for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33]) assert.ok(new Set(T[k]).size >= 5, k);
  for (let k = 1; k <= 9; k++) assert.ok(new Set(PY_SHORT[k]).size >= 5, 'PY' + k);
  for (const k of Object.keys(READING_T)) assert.ok(READING_T[k].length >= 4, k);
  assert.ok(WELCOME_T.length >= 8 && HOWTO_T.length >= 6 && IDLE_T.length >= 10);
  assert.equal(hash('abc'), hash('abc')); assert.notEqual(hash('abc'), hash('abd'));
});

test('same birth date, different names: every reading in a stream is worded differently', () => {
  const v = new Variety('stream-1');
  const texts = ['Sara', 'Ali', 'Zoya', 'Omar', 'Hina'].map((n) => script(`${n} 12/05/1998`, v).spoken.replace(/^.*?1998\.( [^.]*\.)?/, ''));
  assert.equal(new Set(texts).size, 5, texts.join('\n'));
  // and no sentence is shared between any two of them (each part rotates)
  const sents = texts.map((t) => t.split(/(?<=[.!?])\s+/).filter((x) => x.length > 20));
  for (let i = 0; i < sents.length; i++) for (let j = i + 1; j < sents.length; j++) assert.equal(sents[i].filter((x) => sents[j].includes(x)).length, 0, `${i} vs ${j}`);
});

test('same name and birth date twice in a stream still gets different words; wording is deterministic per stream seed', () => {
  const v = new Variety('stream-2');
  assert.notEqual(script('Sara 12/05/1998', v).spoken, script('Sara 12/05/1998', v).spoken);
  const a = script('Sara 12/05/1998 will I travel?', new Variety('s')).spoken, b = script('Sara 12/05/1998 will I travel?', new Variety('s')).spoken;
  assert.equal(a, b, 'same seed, same choice');
  const c = script('Sara 12/05/1998 mother Nadia father Imran will I travel?', new Variety('s3')).spoken;
  assert.match(c, /will I travel\?/); assert.match(c, /Life Path 8/); assert.match(c, /Personal Year 9/);
  assert.match(c, /Nadia|Imran|parents/);
});

test('no back-to-back repeats: consecutive readings never open the same way', () => {
  const v = new Variety('stream-3');
  let prev = null;
  for (const c of ['Sara 12/05/1998', 'Ali 03/11/2001', 'Zoya 25/07/1995', 'Omar 12/05/1998', 'Hina 08/02/1999', 'Bilal 12/05/1998']) {
    const lead = script(c, v).sentences[0].replace(/^[^,]*, /, '').replace(/\d.*$/, '');
    if (prev != null) assert.notEqual(lead + '|' + v.last.get('lead'), prev);
    prev = lead + '|' + v.last.get('lead');
  }
});

test('burst of joins: everyone is welcomed by name (batched), with how to get a reading', () => {
  const { live, clock } = setup();
  live.paused = true;
  const names = Array.from({ length: 23 }, (_, i) => `viewer${i}`);
  for (const n of names) live.handleJoin({ userId: n, nickname: n });
  const spoken = []; let guard = 0;
  while (live.pendingJoins.length && guard++ < 20) {
    clock.t += 10_100;
    const job = live.nextJob(); assert.equal(job.sub, 'welcome');
    assert.ok(job.names.length <= 6); assert.match(job.text, /birth date/i); assert.doesNotMatch(job.text, /other/);
    spoken.push(...job.names);
  }
  assert.deepEqual(spoken, names, 'nobody dropped, in arrival order');
});

test('readings first, but a welcome slips in between readings so joiners are not kept waiting', () => {
  const { live, clock } = setup();
  live.paused = true;
  for (const n of ['Ali', 'Sara', 'Omar']) live.handleChat({ userId: n, nickname: n, comment: `${n} 12/05/1998` });
  live.handleJoin({ userId: 'z', nickname: 'Zoya' });
  clock.t += 3000;
  const kinds = [];
  for (let i = 0; i < 4; i++) { const j = live.nextJob(); kinds.push(j.kind === 'reading' ? 'reading' : j.sub); live.lastJobKind = kinds.at(-1); }
  assert.deepEqual(kinds, ['reading', 'welcome', 'reading', 'reading']);
  // the 3 readings of the same birth date are worded differently
  const t = live.queue.length === 0;
  assert.ok(t);
});

test('never silent: an idle line plays after 25-40 s of nothing, and lines do not repeat', async () => {
  const realST = globalThis.setTimeout;
  const { live } = setup({ idlePromptSeconds: 35 });
  const said = []; live.on('say', (s) => said.push(s));
  live.lastActivity = live.now();
  const waits = [], idleFns = [];
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); if (ms >= 20000) idleFns.push(fn); return { unref() {} }; };
  try {
    for (let i = 0; i < IDLE_T.length; i++) {
      live.busy = false; live.current = null;
      live.scheduleIdlePrompt(); idleFns.pop()();
      await new Promise((r) => realST(r, 2));
    }
  } finally { globalThis.setTimeout = realST; }
  const idle = said.filter((s) => s.sub === 'prompt');
  assert.equal(idle.length, IDLE_T.length, 'an idle line every time nothing happens');
  assert.ok(waits.filter((w) => w >= 20000).every((w) => w >= 25000 && w <= 40000), 'waits in 25-40 s: ' + waits.join(','));
  assert.equal(new Set(idle.map((s) => s.text)).size, idle.length, 'no repeats until all were used');
});
