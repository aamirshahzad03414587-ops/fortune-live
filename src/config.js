import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, 'config.json');

const DEFAULTS = {
  port: 3000, publicUrl: '', adminKey: '',
  tiktok: { username: '', autoConnect: false },
  trigger: { giftName: 'Rose', minDiamonds: 1, acceptOtherGifts: true },
  tiers: [{ name: 'Short reading', minDiamonds: 1, level: 1, secondsOnScreen: 20 }],
  limits: { readingsPerUserPerStream: 1, usesPerCode: 1, maxQueueLength: 30, giftCreditMinutes: 10, secondsBetweenReadings: 3, maxSubmissionsPerIpPerHour: 10 },
  data: { retentionHours: 24, maxRetentionHoursIfUserOptsOut: 168 },
  overlay: {
    title: 'Fate Reading', callToAction: '', characterImage: '/assets/mira2.jpg', showQueue: true, queueVisibleCount: 5, showLikeHearts: true, showFollowToasts: true, showChat: true, browserVoiceFallback: true,
    character: {
      mode: 'rig',
      rig: { base: '/assets/rig/', image: '/assets/mira2.jpg' },
      video: { src: '/assets/mira2-idle-loop-1080.mp4', src720: '/assets/mira2-idle-loop-720.mp4', quality: 'auto', track: '/assets/mira2-idle-loop.track.json', poster: '/assets/mira2v-poster.jpg', toneMatch: true },
      still: '/assets/mira2.jpg',
      breathing: { enabled: true, amount: 0.0045, seconds: 4.6 },
      mouth: { enabled: true, leadMs: 30, fadeMs: 45 },
      prophecy: { enabled: true, tiers: [1, 2, 3], voiceOffset: 1.8, minSeconds: 3 },
    },
    effects: { sparkles: true, sparkleCount: 28, ballGlow: true, floatingCards: false },
  },
  voice: { enabled: true, voice: 'en-US-AvaNeural', urduVoice: 'ur-PK-UzmaNeural', hindiVoice: 'hi-IN-SwaraNeural', rate: '+2%', pitch: '+6%', browserLang: 'en-US', readingSpeechStart: 3, talkSpeechStart: 0.6, tailSeconds: 0.8, minSaySeconds: 3 },
  chat: { enabled: true, mode: 'everyone', userCooldownSeconds: 30, maxQueue: 12, maxCommentAgeSeconds: 120, secondsBetweenReplies: 0.6, prefetchReplies: 2, idlePromptSeconds: 45, idlePrompts: [], greetGifters: true, greetFollowers: true, greetCooldownSeconds: 8, greetDelaySeconds: 4, maxReplyWords: 35,
    welcomeJoins: true, joinGreetSeconds: 10, joinBatchSeconds: 2.5, joinMaxNames: 3, readQuestionAloud: true },
  llm: { enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.9, maxTokens: 120, timeoutMs: 8000, extraPersona: '' },
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`config.json is not valid JSON: ${e.message}`); }
  const cfg = merge(DEFAULTS, file);
  // Environment overrides (handy on Render/Railway)
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.ADMIN_KEY) cfg.adminKey = process.env.ADMIN_KEY;
  if (process.env.PUBLIC_URL) cfg.publicUrl = process.env.PUBLIC_URL;
  if (process.env.TIKTOK_USERNAME) cfg.tiktok.username = process.env.TIKTOK_USERNAME;
  if (process.env.LLM_API_KEY) { cfg.llm.apiKey = process.env.LLM_API_KEY; if (process.env.LLM_BASE_URL) cfg.llm.baseUrl = process.env.LLM_BASE_URL; if (process.env.LLM_MODEL) cfg.llm.model = process.env.LLM_MODEL; }
  cfg.tiers = [...cfg.tiers].sort((a, b) => a.minDiamonds - b.minDiamonds);
  return cfg;
}

export function saveConfig(cfg) {
  // Never write environment overrides (PORT, ADMIN_KEY, ...) back into the file.
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  cfg = JSON.parse(JSON.stringify(cfg));
  if (process.env.PORT) cfg.port = file.port ?? 3000;
  if (process.env.ADMIN_KEY) cfg.adminKey = file.adminKey ?? '';
  if (process.env.PUBLIC_URL) cfg.publicUrl = file.publicUrl ?? '';
  if (process.env.LLM_API_KEY) cfg.llm = { ...cfg.llm, apiKey: file.llm?.apiKey ?? '' };
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}
