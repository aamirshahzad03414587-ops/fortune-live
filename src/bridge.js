// Phone-mode TikTok LIVE bridge for the fight game (clash-live / chibi-clash).
// Separate from the fortune overlay: this file is the only place fortune-live opens a
// TikTok connection. Clients connect to  /tt?u=<username>  and receive events in the
// same JSON shape TikFinity Desktop sends, so clash-live's live.js handlers stay unchanged.
// One shared tiktok-live-connector connection per username (refcount); the connection
// is dropped 60s after the last client leaves, and reconnects with backoff if the LIVE
// has not started yet or the socket drops.
import { WebSocketServer } from 'ws';

const USER_RE = /^[A-Za-z0-9._]{2,24}$/;
const EVENTS = {
  chat: 'chat',
  comment: 'chat',
  gift: 'gift',
  like: 'like',
  follow: 'follow',
  share: 'share',
  member: 'member',
  roomUser: 'roomUser',
};

export function normalizeUser(raw) {
  return String(raw || '').trim().replace(/^@/, '');
}

export function validUser(name) {
  return USER_RE.test(name);
}

function picUrl(user, d) {
  const u = user || {};
  const direct = d?.profilePictureUrl || u.profilePictureUrl || u.profilePictureUrlJpeg;
  if (typeof direct === 'string' && direct) return direct;
  const pic = u.profilePicture || u.avatarThumb || u.avatarMedium || u.avatarLarge;
  if (!pic) return '';
  if (typeof pic === 'string') return pic;
  return pic.url || pic.urlList?.[0] || pic.urls?.[0] || '';
}

function msgIdOf(d) {
  return String(d?.msgId || d?.msg_id || d?.messageId || d?.logId || d?.common?.msgId || d?.common?.logId || '');
}

/** Map a tiktok-live-connector event into a TikFinity Desktop {event, data} frame. */
export function toTikFinity(name, d) {
  const event = EVENTS[name] || name;
  const data = d && typeof d === 'object' ? d : {};
  const user = data.user || data.sender || {};
  const giftObj = data.giftDetails || data.gift || data.extendedGiftInfo || {};
  const uniqueId = String(data.uniqueId || data.unique_id || user.uniqueId || user.unique_id || user.displayId || user.userId || user.id || data.userId || '').trim();
  const nickname = String(data.nickname || data.nickName || user.nickname || user.nickName || uniqueId || '').trim();
  const userId = String(data.userId || user.userId || user.id || uniqueId || '').trim();
  const profilePictureUrl = picUrl(user, data);
  const out = {
    uniqueId,
    nickname,
    userId,
    profilePictureUrl,
    msgId: msgIdOf(data),
    user: { uniqueId, nickname, userId, profilePictureUrl },
  };
  if (event === 'chat') {
    out.comment = String(data.comment ?? data.text ?? data.message ?? '');
  } else if (event === 'like') {
    out.likeCount = Number(data.likeCount ?? data.like_count ?? data.count ?? 1) || 1;
  } else if (event === 'gift') {
    const giftType = giftObj.giftType ?? giftObj.type ?? data.giftType ?? data.gift_type;
    const diamondCount = Number(data.diamondCount ?? data.diamond_count ?? giftObj.diamondCount ?? giftObj.diamond_count ?? 1) || 1;
    const giftName = String(data.giftName ?? data.gift_name ?? giftObj.giftName ?? giftObj.name ?? 'Gift');
    out.giftName = giftName;
    out.diamondCount = diamondCount;
    out.repeatCount = Number(data.repeatCount ?? data.repeat_count ?? data.comboCount ?? giftObj.repeatCount ?? 1) || 1;
    out.repeatEnd = data.repeatEnd ?? data.repeat_end;
    out.giftType = giftType;
    out.groupId = String(data.groupId ?? data.group_id ?? '');
    out.gift = { name: giftName, giftName, type: giftType, giftType, diamondCount, diamond_count: diamondCount };
  } else if (event === 'roomUser') {
    const n = Number(data.viewerCount ?? data.viewer_count ?? data.totalUser ?? data.total);
    if (Number.isFinite(n)) out.viewerCount = n;
  }
  return { event, data: out };
}

function defaultLoader() {
  return import('tiktok-live-connector');
}

export class PhoneBridge {
  constructor(opts = {}) {
    this.loadConnector = opts.loadConnector || defaultLoader;
    this.idleMs = opts.idleMs ?? 60_000;
    this.retryMin = opts.retryMin ?? 1000;
    this.retryMax = opts.retryMax ?? 15_000;
    this.signApiKey = opts.signApiKey ?? process.env.SIGN_API_KEY ?? '';
    this.setTimeout = opts.setTimeout || setTimeout;
    this.clearTimeout = opts.clearTimeout || clearTimeout;
    this.log = opts.log || ((m) => console.log('[tt-bridge]', m));
    this.rooms = new Map();
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** @returns {boolean} true if this request was handled (pathname is /tt). */
  handleUpgrade(req, socket, head, url) {
    const u = url || new URL(req.url, 'http://x');
    if (u.pathname !== '/tt') return false;
    const username = normalizeUser(u.searchParams.get('u') || u.searchParams.get('user') || u.searchParams.get('tiktok'));
    if (!validUser(username)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this._onClient(ws, username));
    return true;
  }

  statusPayload(room) {
    return { event: 'status', data: { state: room.status, message: room.message || '', username: room.username } };
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(room, msg) {
    const s = JSON.stringify(msg);
    for (const ws of room.clients) if (ws.readyState === 1) ws.send(s);
  }

  setRoomStatus(room, state, message = '') {
    room.status = state;
    room.message = message;
    this.broadcast(room, this.statusPayload(room));
  }

  _onClient(ws, username) {
    const room = this._room(username);
    if (room.idleTimer) { this.clearTimeout(room.idleTimer); room.idleTimer = null; }
    room.stopped = false;
    room.clients.add(ws);
    this.send(ws, this.statusPayload(room));
    if (!room.conn && !room.connecting) this.connectRoom(room);
    ws.on('close', () => this._dropClient(room, ws));
    ws.on('error', () => this._dropClient(room, ws));
  }

  _dropClient(room, ws) {
    if (!room.clients.has(ws)) return;
    room.clients.delete(ws);
    if (room.clients.size === 0 && !room.idleTimer) {
      room.idleTimer = this.setTimeout(() => this._idleClose(room), this.idleMs);
    }
  }

  _idleClose(room) {
    room.idleTimer = null;
    if (room.clients.size > 0) return;
    this._teardown(room, 'idle');
  }

  _room(username) {
    const key = username.toLowerCase();
    let room = this.rooms.get(key);
    if (!room) {
      room = {
        key, username, clients: new Set(), conn: null, connecting: false, stopped: false,
        status: 'connecting', message: `Connecting to @${username}…`,
        wait: this.retryMin, idleTimer: null, retryTimer: null,
      };
      this.rooms.set(key, room);
    }
    return room;
  }

  async connectRoom(room) {
    if (room.stopped || room.connecting) return;
    room.connecting = true;
    this.setRoomStatus(room, 'connecting', `Connecting to @${room.username}…`);
    let conn;
    try {
      const mod = await this.loadConnector();
      const { TikTokLiveConnection, WebcastEvent, ControlEvent } = mod;
      const opts = { enableExtendedGiftInfo: false, processInitialData: false };
      if (this.signApiKey) opts.signApiKey = this.signApiKey;
      conn = new TikTokLiveConnection(room.username, opts);
      room.conn = conn;
      this._bind(room, conn, WebcastEvent, ControlEvent);
      await conn.connect();
      if (room.stopped || room.conn !== conn) {
        try { await conn.disconnect(); } catch {}
        return;
      }
      room.wait = this.retryMin;
      this.setRoomStatus(room, 'live', `Live @${room.username}`);
    } catch (e) {
      if (room.conn === conn) room.conn = null;
      const raw = e?.message || String(e);
      const offline = e?.name === 'UserOfflineError' || /offline|not.*live|room id/i.test(raw + ' ' + (e?.constructor?.name || ''));
      const state = offline ? 'offline' : 'error';
      const message = offline
        ? `Waiting for @${room.username} to go live`
        : `Could not connect to @${room.username}: ${raw}`;
      this.setRoomStatus(room, state, message);
      room.connecting = false;
      this._scheduleRetry(room);
    } finally {
      room.connecting = false;
    }
  }

  _bind(room, conn, WebcastEvent, ControlEvent) {
    const ev = WebcastEvent || {};
    const ctl = ControlEvent || {};
    const emit = (name) => (d) => this.broadcast(room, toTikFinity(name, d));
    if (ev.CHAT) conn.on(ev.CHAT, emit('chat'));
    if (ev.GIFT) conn.on(ev.GIFT, emit('gift'));
    if (ev.LIKE) conn.on(ev.LIKE, emit('like'));
    if (ev.FOLLOW) conn.on(ev.FOLLOW, emit('follow'));
    if (ev.SHARE) conn.on(ev.SHARE, emit('share'));
    if (ev.MEMBER) conn.on(ev.MEMBER, emit('member'));
    if (ev.ROOM_USER) conn.on(ev.ROOM_USER, emit('roomUser'));
    if (ev.STREAM_END) conn.on(ev.STREAM_END, () => {
      if (room.conn !== conn) return;
      this.setRoomStatus(room, 'offline', `LIVE ended for @${room.username}`);
      this._scheduleRetry(room);
    });
    const onDisc = () => {
      if (room.conn !== conn) return;
      room.conn = null;
      if (room.stopped) return;
      if (room.status !== 'offline') this.setRoomStatus(room, 'connecting', `Reconnecting to @${room.username}…`);
      this._scheduleRetry(room);
    };
    if (ctl.DISCONNECTED) conn.on(ctl.DISCONNECTED, onDisc);
    if (ctl.ERROR) conn.on(ctl.ERROR, (e) => this.log(`@${room.username} ${e?.info || e?.exception?.message || e?.message || e}`));
  }

  _scheduleRetry(room) {
    if (room.stopped || room.retryTimer || room.connecting) return;
    if (room.clients.size === 0) return; // idle-grace: wait for a new client or the idle teardown
    const wait = room.wait;
    room.wait = Math.min(this.retryMax, Math.round(room.wait * 1.7));
    room.retryTimer = this.setTimeout(() => {
      room.retryTimer = null;
      if (room.stopped || room.clients.size === 0) return;
      this.connectRoom(room);
    }, wait);
  }

  async _teardown(room, reason) {
    room.stopped = true;
    if (room.retryTimer) { this.clearTimeout(room.retryTimer); room.retryTimer = null; }
    if (room.idleTimer) { this.clearTimeout(room.idleTimer); room.idleTimer = null; }
    const conn = room.conn;
    room.conn = null;
    if (conn) try { await conn.disconnect(); } catch {}
    this.rooms.delete(room.key);
    this.log(`closed @${room.username} (${reason})`);
  }

  async close() {
    for (const room of [...this.rooms.values()]) await this._teardown(room, 'shutdown');
    try { this.wss.close(); } catch {}
  }
}

export function attachPhoneBridge(server, opts = {}) {
  const bridge = opts instanceof PhoneBridge ? opts : new PhoneBridge(opts);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/tt') return;
    bridge.handleUpgrade(req, socket, head, url);
  });
  return bridge;
}
