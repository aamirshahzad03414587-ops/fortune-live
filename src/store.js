// Tiny JSON-file store for form submissions. Data auto-expires.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (look like 1 / 0)

export class Store {
  constructor(file) {
    this.file = file;
    this.items = [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.items = []; }
    this.purgeExpired();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.file);
  }
  purgeExpired(now = Date.now()) {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.expiresAt > now);
    if (this.items.length !== before) this.save();
    return before - this.items.length;
  }
  newCode() {
    const used = new Set(this.items.map((s) => s.code));
    for (let digits = 2; digits <= 4; digits++) {
      const min = 10 ** (digits - 1), span = 9 * min;
      for (let i = 0; i < 200; i++) {
        const code = CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)] + (min + crypto.randomInt(span));
        if (!used.has(code)) return code;
      }
    }
    throw new Error('Could not allocate a code');
  }
  create(input, retentionHours) {
    const now = Date.now();
    const rec = {
      token: crypto.randomBytes(18).toString('base64url'),
      code: this.newCode(),
      createdAt: now,
      expiresAt: now + retentionHours * 3600e3,
      uses: 0,
      input,
    };
    this.items.push(rec);
    this.save();
    return rec;
  }
  byToken(token) { return this.items.find((s) => s.token === token && s.expiresAt > Date.now()) || null; }
  byCode(code) { code = String(code || '').toUpperCase(); return this.items.find((s) => s.code === code && s.expiresAt > Date.now()) || null; }
  markUsed(code) { const s = this.byCode(code); if (s) { s.uses++; this.save(); } }
  delete(token) { const n = this.items.length; this.items = this.items.filter((s) => s.token !== token); if (n !== this.items.length) { this.save(); return true; } return false; }
  deleteAll() { const n = this.items.length; this.items = []; this.save(); return n; }
  count() { return this.items.length; }
}
