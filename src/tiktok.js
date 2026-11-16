// TikTok LIVE connection via the unofficial `tiktok-live-connector` package.
// Converts raw TikTok events into simple objects for LiveEngine.
import { EventEmitter } from 'node:events';

export class TikTokBridge extends EventEmitter {
  constructor(live) {
    super();
    this.live = live;
    this.conn = null;
    this.status = { state: 'disconnected', username: '', message: '' };
  }

  setStatus(state, message = '') {
    this.status = { ...this.status, state, message };
    this.emit('status', this.status);
  }

  async connect(username) {
    username = String(username || '').trim().replace(/^@/, '');
    if (!username) throw new Error('Set your TikTok username first');
    await this.disconnect();
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
    this.status.username = username;
    this.setStatus('connecting');
    const opts = { enableExtendedGiftInfo: true, processInitialData: false };
    if (this.signApiKey) opts.signApiKey = this.signApiKey; // optional free Euler Stream key for more reliable connections
    const conn = new TikTokLiveConnection(username, opts);
    this.conn = conn;

    const user = (d) => ({ userId: String(d?.user?.userId || d?.user?.uniqueId || 'unknown'), uniqueId: d?.user?.uniqueId || '', nickname: d?.user?.nickname || d?.user?.uniqueId || 'Viewer' });

    conn.on(WebcastEvent.CHAT, (d) => {
      const id = d.userIdentity || {};
      const isFollower = !!(id.isFollowerOfAnchor || id.isMutualFollowingWithAnchor || Number(d.user?.followInfo?.followStatus) >= 1);
      this.live.handleChat({ ...user(d), comment: d.comment || '', isFollower, isGifter: !!id.isGiftGiverOfAnchor });
    });
    conn.on(WebcastEvent.GIFT, (d) => {
      const details = d.giftDetails || {};
      const ext = d.extendedGiftInfo || {};
      const giftType = details.giftType ?? ext.type;
      if (giftType === 1 && !d.repeatEnd) return; // streak still running; wait for the final event
      const per = Number(details.diamondCount || ext.diamond_count || 0);
      const count = Number(d.repeatCount || 1);
      this.live.handleGift({ ...user(d), giftName: details.giftName || ext.name || `Gift ${d.giftId}`, diamonds: per * count, count });
    });
    conn.on(WebcastEvent.LIKE, (d) => this.live.handleLike({ ...user(d), count: Number(d.likeCount || 1) }));
    conn.on(WebcastEvent.FOLLOW, (d) => this.live.handleFollow(user(d)));
    conn.on(WebcastEvent.STREAM_END, () => this.setStatus('ended', 'The LIVE has ended'));
    conn.on(ControlEvent.DISCONNECTED, () => { if (this.conn === conn) this.setStatus('disconnected'); });
    conn.on(ControlEvent.ERROR, (e) => this.emit('log', `TikTok error: ${e?.info || e?.exception?.message || e}`));

    try {
      const state = await conn.connect();
      this.live.newStream();
      this.setStatus('connected', `Room ${state?.roomId || ''}`);
      return this.status;
    } catch (e) {
      this.conn = null;
      const raw = e?.message || String(e);
      const msg = /offline|not.*live|room id/i.test(raw + ' ' + (e?.constructor?.name || '')) ? `Could not find a LIVE for @${username}. Check the username and make sure you are LIVE right now, then connect again. (${raw})` : raw;
      this.setStatus('error', msg);
      throw new Error(msg);
    }
  }

  async disconnect() {
    if (this.conn) { const c = this.conn; this.conn = null; try { await c.disconnect(); } catch {} }
    if (this.status.state !== 'disconnected') this.setStatus('disconnected');
  }
}
