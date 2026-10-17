/** Speaking user id while a scene is active, else null. */
export function speakingUserId(state) {
  return state?.active && state.speaker ? state.speaker : null;
}

/** Canvas tokens of the given users' assigned characters. */
export function characterTokens(userIds, users, tokens) {
  const characterIds = new Set();
  for (const id of userIds) {
    const characterId = users.get(id)?.character?.id;
    if (characterId) characterIds.add(characterId);
  }
  if (!characterIds.size) return [];
  return tokens.filter(token => characterIds.has(token.actor?.id ?? token.document?.actorId));
}

/** Canvas tokens of the speaking user's assigned character. */
export function speakerTokens(state, users, tokens) {
  const id = speakingUserId(state);
  return id ? characterTokens([id], users, tokens) : [];
}

/** Green ring around the speaker's tokens; rendering is injected so the logic stays testable. */
export class SpeakerHighlight {
  constructor(host) { this.host = host; this.rings = new Map(); }

  /** Tokens that should carry a ring for this input; subclasses override. */
  targets(state) { return speakerTokens(state, this.host.users(), this.host.tokens()); }

  sync(input) {
    const targets = this.host.enabled() ? this.targets(input) : [];
    const keep = new Set(targets);
    for (const [token, ring] of this.rings) {
      if (keep.has(token)) continue;
      if (this.host.detachRing) this.host.detachRing(token, ring);
      else { token.removeChild?.(ring); ring.destroy?.(); }
      this.rings.delete(token);
    }
    for (const token of targets) {
      if (this.rings.has(token)) continue;
      const ring = this.host.createRing();
      token.addChild(ring);
      this.rings.set(token, ring);
      this.host.drawRing(ring, token);
    }
  }

  /** Canvas torn down: its tokens are gone, so forget their rings without touching them. */
  reset() { this.rings.clear(); }

  redraw(token) {
    const ring = this.rings.get(token);
    if (ring) this.host.drawRing(ring, token);
  }

  /** Redraw every tracked ring, e.g. after an appearance change. */
  redrawAll() {
    for (const [token, ring] of this.rings) this.host.drawRing(ring, token);
  }
}

/** PIXI ring sized to the token, in RP Frame's speaking green. */
export function createPixiRing() {
  const ring = new PIXI.Graphics();
  ring.name = 'rp-frame-speaker-ring';
  ring.eventMode = 'none';
  return ring;
}

export function drawPixiRing(ring, token) {
  const w = token.w ?? token.width ?? 100, h = token.h ?? token.height ?? 100;
  const radius = Math.max(w, h) / 2 + 4;
  ring.clear();
  ring.lineStyle(10, 0x51cf66, 0.25).drawCircle(w / 2, h / 2, radius + 4);
  ring.lineStyle(4, 0x51cf66, 0.95).drawCircle(w / 2, h / 2, radius);
}
