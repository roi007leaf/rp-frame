export const HEARTBEAT_MS = 3000;
export const STALE_MS = 9000;
export const MIC = { ok: 'ok', off: 'off', denied: 'denied', unavailable: 'unavailable' };

const MIC_VALUES = new Set(Object.values(MIC));

/** Per-user talking/mic status; talkers expire if not refreshed within STALE_MS. */
export class VoiceRoster {
  constructor() {
    this.users = new Map();
  }

  /** Record a status broadcast; returns true if the talking flag or mic status changed. */
  update(userId, payload, now) {
    if (!payload || typeof payload.talking !== 'boolean') return false;
    const mic = payload.mic ?? MIC.ok;
    if (!MIC_VALUES.has(mic)) return false;
    const prev = this.users.get(userId);
    this.users.set(userId, { talking: payload.talking, mic, at: now });
    return !prev || prev.talking !== payload.talking || prev.mic !== mic;
  }

  remove(userId) {
    return this.users.delete(userId);
  }

  /** Drop talkers not refreshed within STALE_MS (mic status kept); returns true if any dropped. */
  prune(now) {
    let changed = false;
    for (const entry of this.users.values()) {
      if (entry.talking && now - entry.at > STALE_MS) {
        entry.talking = false;
        changed = true;
      }
    }
    return changed;
  }

  talkingIds() {
    return this.#ids(e => e.talking);
  }

  noMicIds() {
    return this.#ids(e => e.mic !== MIC.ok);
  }

  clear() {
    this.users.clear();
  }

  #ids(pred) {
    const ids = new Set();
    for (const [id, entry] of this.users) if (pred(entry)) ids.add(id);
    return ids;
  }
}
