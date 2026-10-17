import assert from 'node:assert/strict';
import test from 'node:test';
import { PushToTalk, PTT_MOUSE } from '../scripts/voice-ptt.mjs';

function tracker(mouse) {
  const changes = [];
  const ptt = new PushToTalk({ onChange: held => changes.push(held) });
  if (mouse) ptt.mouse = mouse;
  changes.length = 0;
  return { ptt, changes };
}

test('PTT_MOUSE maps setting values to MouseEvent.button', () => {
  assert.deepEqual(PTT_MOUSE, { none: null, back: 3, forward: 4 });
});

test('key down/up toggles held and fires onChange once per change', () => {
  const { ptt, changes } = tracker();
  assert.equal(ptt.held, false);
  ptt.keyDown();
  ptt.keyDown();
  assert.equal(ptt.held, true);
  ptt.keyUp();
  ptt.keyUp();
  assert.equal(ptt.held, false);
  assert.deepEqual(changes, [true, false]);
});

test('key and mouse are independent', () => {
  const { ptt, changes } = tracker('back');
  ptt.keyDown();
  ptt.pointerDown(3);
  ptt.keyUp();
  assert.equal(ptt.held, true);
  ptt.pointerUp(3);
  assert.equal(ptt.held, false);
  assert.deepEqual(changes, [true, false]);
});

test('the wrong mouse button is ignored', () => {
  const { ptt, changes } = tracker('forward');
  for (const button of [0, 1, 2, 3]) ptt.pointerDown(button);
  assert.equal(ptt.held, false);
  ptt.pointerDown(4);
  assert.equal(ptt.held, true);
  ptt.pointerUp(3);
  assert.equal(ptt.held, true);
  ptt.pointerUp(4);
  assert.deepEqual(changes, [true, false]);
});

test("mouse 'none' ignores all buttons", () => {
  const { ptt, changes } = tracker('none');
  assert.equal(ptt.mouse, 'none');
  for (const button of [0, 1, 2, 3, 4]) ptt.pointerDown(button);
  assert.equal(ptt.held, false);
  assert.deepEqual(changes, []);
});

test('release() clears both and fires once', () => {
  const { ptt, changes } = tracker('back');
  ptt.keyDown();
  ptt.pointerDown(3);
  changes.length = 0;
  ptt.release();
  assert.equal(ptt.held, false);
  assert.deepEqual(changes, [false]);
  ptt.pointerUp(3);
  ptt.keyUp();
  ptt.release();
  assert.deepEqual(changes, [false]);
});

test('changing mouse clears the mouse state', () => {
  const { ptt, changes } = tracker('back');
  ptt.pointerDown(3);
  ptt.mouse = 'forward';
  assert.equal(ptt.held, false);
  assert.deepEqual(changes, [true, false]);
  ptt.keyDown();
  ptt.pointerDown(4);
  ptt.mouse = 'back';
  assert.equal(ptt.held, true);
  ptt.keyUp();
  assert.equal(ptt.held, false);
});
