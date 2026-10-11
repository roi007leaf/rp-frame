import assert from 'node:assert/strict';
import test from 'node:test';
import { canEditFrame, clampFrame, frameStyle, getFrame, panFrame, zoomFrame } from '../scripts/avatar-frame.mjs';

test('clampFrame fills defaults and clamps ranges', () => {
  assert.deepEqual(clampFrame(), { x: 50, y: 50, scale: 1 });
  assert.deepEqual(clampFrame({ x: -20, y: 140, scale: 9 }), { x: 0, y: 100, scale: 3 });
  assert.deepEqual(clampFrame({ x: '30', y: Number.NaN, scale: 0.2 }), { x: 30, y: 50, scale: 1 });
});

test('getFrame reads the user flag, defaulting when unset', () => {
  const user = (frame) => ({ getFlag: (scope, key) => (scope === 'rp-frame' && key === 'avatarFrame' ? frame : undefined) });
  assert.deepEqual(getFrame(user(undefined)), { x: 50, y: 50, scale: 1 });
  assert.deepEqual(getFrame(user({ x: 20, y: 70, scale: 1.5 })), { x: 20, y: 70, scale: 1.5 });
  assert.deepEqual(getFrame(null), { x: 50, y: 50, scale: 1 });
});

test('dragging right/down moves the image right/down (position decreases), slower when zoomed', () => {
  const box = { width: 200, height: 100 };
  assert.deepEqual(panFrame({ x: 50, y: 50, scale: 1 }, 20, 10, box), { x: 40, y: 40, scale: 1 });
  assert.deepEqual(panFrame({ x: 50, y: 50, scale: 2 }, 20, 10, box), { x: 45, y: 45, scale: 2 });
  assert.deepEqual(panFrame({ x: 2, y: 98, scale: 1 }, 100, -100, box), { x: 0, y: 100, scale: 1 });
});

test('wheel up zooms in, wheel down zooms out, within limits', () => {
  assert.equal(zoomFrame({ x: 50, y: 50, scale: 1 }, -100).scale, 1.1);
  assert.equal(zoomFrame({ x: 50, y: 50, scale: 1 }, 100).scale, 1);
  assert.equal(zoomFrame({ x: 50, y: 50, scale: 2.95 }, -500).scale, 3);
});

test('frameStyle positions and scales around the focal point', () => {
  assert.deepEqual(frameStyle({ x: 30, y: 60, scale: 1.5 }), {
    objectFit: 'cover', objectPosition: '30% 60%', transform: 'scale(1.5)', transformOrigin: '30% 60%'
  });
  assert.equal(frameStyle({ x: 50, y: 50, scale: 1 }).transform, '');
});

test('players edit only their own portrait; GMs edit anyone', () => {
  const gm = { id: 'gm', isGM: true }, a = { id: 'a', isGM: false }, b = { id: 'b', isGM: false };
  assert.equal(canEditFrame(a, a), true);
  assert.equal(canEditFrame(a, b), false);
  assert.equal(canEditFrame(gm, b), true);
  assert.equal(canEditFrame(null, b), false);
});
