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

export const DEFAULT_APPEARANCE = { color: '#51cf66', size: 1, brightness: 1, opacity: 1 };
export const APPEARANCE_RANGES = { size: [0.5, 2], brightness: [0.25, 2.5], opacity: [0.1, 1] };

/** Clamp an appearance into range; invalid colors and non-finite numbers fall back to the defaults. */
export function normalizeAppearance(appearance) {
  const a = appearance ?? {};
  const color = typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.toLowerCase() : DEFAULT_APPEARANCE.color;
  const out = { color };
  for (const [key, [min, max]] of Object.entries(APPEARANCE_RANGES)) {
    const value = typeof a[key] === 'number' && Number.isFinite(a[key]) ? a[key] : DEFAULT_APPEARANCE[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  return out;
}

export const DEFAULT_APPEARANCES = { token: { ...DEFAULT_APPEARANCE }, camera: { ...DEFAULT_APPEARANCE } };
const FLAT_KEYS = ['color', 'size', 'brightness', 'opacity'];

/** Token and camera appearances; an old flat appearance applies to both, a missing part is the default. */
export function normalizeAppearances(value) {
  const v = value && typeof value === 'object' ? value : {};
  const flat = !('token' in v) && !('camera' in v) && FLAT_KEYS.some(key => key in v);
  return flat
    ? { token: normalizeAppearance(v), camera: normalizeAppearance(v) }
    : { token: normalizeAppearance(v.token), camera: normalizeAppearance(v.camera) };
}

/** Token strokes (outer to inner) and camera box-shadow for an appearance; defaults match the original glow. */
export function glowStyle(appearance) {
  const { color, size, brightness: b, opacity } = normalizeAppearance(appearance);
  const hex = parseInt(color.slice(1), 16);
  const widths = [18, 10, 4].map(w => w * size);
  const alphas = [0.12 * b, 0.2 * b, Math.min(1, 0.35 * b * b)].map(alpha => Math.min(1, alpha * opacity));
  const [r, g, bl] = [hex >> 16, (hex >> 8) & 0xff, hex & 0xff];
  const shadowAlpha = Math.round(Math.min(1, 0.4 * b * opacity) * 100);
  const px = n => Math.round(n * 100) / 100;
  return {
    color: hex, pad: 6 * size,
    strokes: widths.map((width, i) => ({ width, alpha: alphas[i] })),
    cameraShadow: `0 0 ${px(18 * size)}px ${px(6 * size)}px rgb(${r} ${g} ${bl} / ${shadowAlpha}%)`
  };
}

/** Opacity lives in the stroke alphas so fadeGlow can keep animating glow.alpha. */
export function drawPixiGlow(glow, token, appearance = DEFAULT_APPEARANCE) {
  const w = token.w ?? token.width ?? 100, h = token.h ?? token.height ?? 100;
  const style = glowStyle(appearance);
  const radius = Math.max(w, h) / 2 + style.pad;
  glow.clear();
  for (const { width, alpha } of style.strokes) {
    glow.lineStyle(width, style.color, alpha).drawCircle(w / 2, h / 2, radius);
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
