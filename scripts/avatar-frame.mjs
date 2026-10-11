/** Camera portrait framing: where the avatar sits in a camera tile when video is off. */
export const FRAME_FLAG = 'avatarFrame';
const DEFAULT = { x: 50, y: 50, scale: 1 };
const round = n => Math.round(n * 100) / 100;
const clamp = (n, min, max, fallback) => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export function clampFrame(frame = {}) {
  return {
    x: round(clamp(frame?.x, 0, 100, DEFAULT.x)),
    y: round(clamp(frame?.y, 0, 100, DEFAULT.y)),
    scale: round(clamp(frame?.scale, 1, 3, DEFAULT.scale))
  };
}

export function getFrame(user) {
  return clampFrame(user?.getFlag?.('rp-frame', FRAME_FLAG));
}

/** Dragging the image by (dx, dy) pixels in a box: the picture follows the pointer. */
export function panFrame(frame, dx, dy, box) {
  return clampFrame({
    ...frame,
    x: frame.x - (dx / box.width) * 100 / frame.scale,
    y: frame.y - (dy / box.height) * 100 / frame.scale
  });
}

/** Mouse wheel: negative deltaY zooms in. */
export function zoomFrame(frame, deltaY) {
  return clampFrame({ ...frame, scale: frame.scale - deltaY * 0.001 });
}

export function frameStyle(frame) {
  const { x, y, scale } = clampFrame(frame);
  return {
    objectFit: 'cover', objectPosition: `${x}% ${y}%`,
    transform: scale === 1 ? '' : `scale(${scale})`, transformOrigin: `${x}% ${y}%`
  };
}

export function applyFrame(img, frame) {
  Object.assign(img.style, frameStyle(frame));
}

export function canEditFrame(editor, target) {
  return Boolean(editor && target && (editor.isGM || editor.id === target.id));
}
