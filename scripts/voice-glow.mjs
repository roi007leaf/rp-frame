import { SpeakerHighlight, characterTokens, speakingUserId } from './speaker-highlight.mjs';

/** Talking users who should glow: the RP turn holder keeps only the solid ring. */
export function voiceGlowIds(talkingIds, state) {
  const holder = speakingUserId(state);
  return new Set([...talkingIds].filter(id => id !== holder));
}

/** Soft green glow on the tokens of talking users. */
export class VoiceGlow extends SpeakerHighlight {
  targets({ talkingIds, state } = {}) {
    return characterTokens(voiceGlowIds(talkingIds ?? new Set(), state), this.host.users(), this.host.tokens());
  }
}

export function createPixiGlow() {
  const glow = new PIXI.Graphics();
  glow.name = 'rp-frame-voice-glow';
  glow.eventMode = 'none';
  return glow;
}

export function drawPixiGlow(glow, token) {
  const w = token.w ?? token.width ?? 100, h = token.h ?? token.height ?? 100;
  const radius = Math.max(w, h) / 2 + 6;
  glow.clear();
  for (const [width, alpha] of [[18, 0.12], [10, 0.2], [4, 0.35]]) {
    glow.lineStyle(width, 0x51cf66, alpha).drawCircle(w / 2, h / 2, radius);
  }
}

/** Tween alpha via the canvas ticker; calls done when finished. Stops silently if the glow is destroyed. */
export function fadeGlow(glow, from, to, ms = 150, done) {
  const ticker = globalThis.canvas?.app?.ticker;
  if (!ticker) {
    glow.alpha = to;
    done?.();
    return;
  }
  let elapsed = 0;
  glow.alpha = from;
  const step = () => {
    if (glow.destroyed) return void ticker.remove(step);
    elapsed += ticker.deltaMS;
    const t = Math.min(1, elapsed / ms);
    glow.alpha = from + (to - from) * t;
    if (t >= 1) { ticker.remove(step); done?.(); }
  };
  ticker.add(step);
}

/** Toggle the voice class on camera tiles; GM-only no-mic marks when noMicIds is given. */
export function applyVoiceCameras(root, glowIds, noMicIds) {
  for (const el of root.querySelectorAll('.camera-view[data-user]')) {
    const id = el.dataset.user;
    el.classList.toggle('rp-frame-voice', glowIds.has(id));
    const mark = el.querySelector(':scope > .rp-frame-nomic');
    const wanted = !!noMicIds && noMicIds.has(id);
    if (wanted && !mark) {
      const span = el.ownerDocument.createElement('span');
      span.className = 'rp-frame-nomic fa-solid fa-microphone-slash';
      span.title = 'Voice glow off for this player';
      el.append(span);
    } else if (!wanted && mark) mark.remove();
  }
}
