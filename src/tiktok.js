// Live events arrive from the overlay, which listens to the TikFinity desktop app
// at ws://127.0.0.1:21213/ on the streamer's PC. This server NEVER connects to TikTok.
import { EventEmitter } from 'node:events';

export class TikTokBridge extends EventEmitter {
  constructor(live) {
    super();
    this.live = live;
    this.seen = new Map();
    this.status = {
      state: 'waiting',
      username: '',
      message: 'Open the overlay on the streaming PC with TikFinity running (ws://127.0.0.1:21213/)',
    };
  }

  setStatus(state, message = '', extra = {}) {
    this.status = { ...this.status, state, message, ...extra };
    this.emit('status', this.status);
  }

  /** Removed: the server must never open a TikTok connection, even if a username is set. */
  async connect() {
    const msg = 'The server no longer connects to TikTok. Install the TikFinity desktop app on the streaming PC, connect it by username, and keep the overlay open in LIVE Studio.';
    this.setStatus('waiting', msg);
    throw new Error(msg);
  }

  async disconnect() {
    this.setStatus('waiting', 'Open the overlay on the streaming PC with TikFinity running (ws://127.0.0.1:21213/)');
  }

  ingest(ev) {
    if (!ev || typeof ev !== 'object') return { ok: false, reason: 'bad-event' };
    const key = String(ev.dedupeKey || '');
    if (key) {
      const now = Date.now();
      if (this.seen.has(key)) return { ok: false, reason: 'duplicate' };
      this.seen.set(key, now);
      if (this.seen.size > 600) for (const [k, t] of this.seen) if (now - t > 60e3) this.seen.delete(k);
    }
    const userId = String(ev.id || ev.userId || ev.uniqueId || '').slice(0, 80);
    const nickname = String(ev.nick || ev.nickname || ev.uniqueId || 'Viewer').slice(0, 80);
    if (!userId && ev.type !== 'viewers') return { ok: false, reason: 'no-user' };
    switch (ev.type) {
      case 'chat':
        return this.live.handleChat({
          userId, uniqueId: userId, nickname,
          comment: String(ev.text || ev.comment || '').slice(0, 500),
          isFollower: !!ev.isFollower, isGifter: !!ev.isGifter,
        });
      case 'gift': {
        const coins = Number(ev.coins || ev.diamonds || 0) || 0;
        const count = Number(ev.count || 1) || 1;
        return this.live.handleGift({
          userId, uniqueId: userId, nickname,
          giftName: String(ev.giftName || 'Gift').slice(0, 80),
          diamonds: coins * count, count,
        });
      }
      case 'like':
        this.live.handleLike({ userId, nickname, count: Number(ev.count || 1) || 1 });
        return { ok: true };
      case 'follow':
        this.live.handleFollow({ userId, uniqueId: userId, nickname });
        return { ok: true };
      case 'join':
        return this.live.handleJoin({ userId, uniqueId: userId, nickname });
      case 'viewers':
      case 'share':
      case 'status':
        return { ok: true, ignored: ev.type };
      default:
        return { ok: false, reason: 'unknown-type' };
    }
  }
}
