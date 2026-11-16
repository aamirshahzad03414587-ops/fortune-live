// Server-side text-to-speech with free Microsoft Edge neural voices (msedge-tts).
// Produces MP3 that the overlay plays, so the voice works inside OBS.
import crypto from 'node:crypto';

const BITRATE = 48000; // audio-24khz-48kbitrate-mono-mp3 (constant bitrate => duration = bytes*8/48000)
const URDU_SCRIPT = /[\u0600-\u06FF]/, HINDI_SCRIPT = /[\u0900-\u097F]/;

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function speakableText(text) {
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\u200d\uFE0F]/gu, '')
    .replace(/@([\w.]+)/g, (_, h) => h.replace(/[_.]+/g, ' '))
    .replace(/#([A-Z]\d+)/gi, 'code $1')
    .replace(/\s+/g, ' ').trim();
}

export class TTS {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.clips = new Map(); // id -> { buf, createdAt }
    this.lastError = '';
    setInterval(() => { const cut = Date.now() - 10 * 60e3; for (const [k, v] of this.clips) if (v.createdAt < cut) this.clips.delete(k); }, 60e3).unref();
  }

  voiceFor(text) {
    const c = this.getConfig();
    if (URDU_SCRIPT.test(text) && c.urduVoice) return c.urduVoice;
    if (HINDI_SCRIPT.test(text) && c.hindiVoice) return c.hindiVoice;
    return c.voice || 'en-US-AvaMultilingualNeural';
  }

  /** Returns { id, url, duration, voice } or null when TTS is off/unavailable. */
  async synth(text) {
    const c = this.getConfig();
    if (!c.enabled) return null;
    const clean = speakableText(text);
    if (!clean) return null;
    const voice = this.voiceFor(clean);
    try {
      const buf = await this.edge(clean, voice, c);
      if (!buf || buf.length < 500) throw new Error('empty audio');
      const id = crypto.randomBytes(9).toString('base64url');
      this.clips.set(id, { buf, createdAt: Date.now() });
      this.lastError = '';
      return { id, url: `/tts/${id}.mp3`, duration: (buf.length * 8) / BITRATE, voice };
    } catch (e) {
      this.lastError = e.message || String(e);
      console.log('[tts] failed:', this.lastError);
      return null;
    }
  }

  async edge(text, voice, c) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 });
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(escapeXml(text), { rate: c.rate || '+0%', pitch: c.pitch || '+0Hz' });
      return await new Promise((resolve, reject) => {
        const chunks = [];
        const t = setTimeout(() => reject(new Error('TTS timeout')), 25000);
        audioStream.on('data', (d) => chunks.push(d));
        audioStream.on('error', (e) => { clearTimeout(t); reject(e); });
        audioStream.on('close', () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
      });
    } finally { try { tts.close(); } catch {} }
  }

  get(id) { return this.clips.get(id)?.buf || null; }

  /** MP3 bytes for a short, often repeated text (her "thinking" lines, viewers' names), made once and kept. */
  cachedClip(text) {
    const c = this.getConfig(); if (!c.enabled) return Promise.resolve(null);
    const clean = speakableText(text); if (!clean) return Promise.resolve(null);
    this.memo = this.memo || new Map();
    const key = this.voiceFor(clean) + '|' + clean;
    if (!this.memo.has(key)) {
      const p = this.edge(clean, this.voiceFor(clean), c).then((b) => (b && b.length >= 300 ? b : null)).catch(() => null);
      p.then((b) => { if (!b) this.memo.delete(key); });
      this.memo.set(key, p);
      if (this.memo.size > 400) this.memo.delete(this.memo.keys().next().value);
    }
    return this.memo.get(key);
  }
  /** Serve ready-made MP3 bytes (e.g. a name clip + a cached line, joined: constant-bitrate MP3 frames concatenate). */
  register(buf) {
    const id = crypto.randomBytes(9).toString('base64url');
    this.clips.set(id, { buf, createdAt: Date.now() });
    return { id, url: `/tts/${id}.mp3`, duration: (buf.length * 8) / BITRATE, voice: this.voiceFor('') };
  }
}

export const VOICE_CHOICES = [
  // multilingual: the same voice speaks the viewer's language (Urdu, Hindi, Arabic, Spanish ...) - Mira's default
  'en-US-AvaMultilingualNeural', 'en-US-EmmaMultilingualNeural',
  'en-US-AvaNeural', 'en-US-EmmaNeural', 'en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-MichelleNeural',
  'en-GB-SoniaNeural', 'en-AU-NatashaNeural', 'en-IN-NeerjaNeural', 'en-IN-NeerjaExpressiveNeural',
  'ur-PK-UzmaNeural', 'ur-IN-GulNeural', 'hi-IN-SwaraNeural', 'ar-AE-FatimaNeural',
];
