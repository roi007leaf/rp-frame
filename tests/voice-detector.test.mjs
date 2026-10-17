import assert from 'node:assert/strict';
import test from 'node:test';
import { rmsDb, VoiceDetector, FLOOR_DB } from '../scripts/voice-detector.mjs';

const detector = () => new VoiceDetector({ threshold: -45 });
const feed = (d, db, times) => times.map(t => d.sample(db, t));
const talking = () => { const d = detector(); feed(d, -30, [0, 50, 100]); return d; };

test('rmsDb of silence is the floor', () => {
  assert.equal(rmsDb(new Float32Array(512)), FLOOR_DB);
});

test('rmsDb of full-scale square is 0', () => {
  assert.equal(Math.round(rmsDb(Float32Array.from({ length: 512 }, (_, i) => i % 2 ? 1 : -1))), 0);
});

test('starts after 100ms above threshold', () => {
  const d = detector();
  assert.deepEqual(feed(d, -30, [0, 50]), [null, null]);
  assert.equal(d.sample(-30, 100), true);
  assert.equal(d.talking, true);
});

test('brief spike does not start', () => {
  const d = detector();
  assert.deepEqual([d.sample(-30, 0), d.sample(-60, 50), d.sample(-30, 100)], [null, null, null]);
  assert.equal(d.talking, false);
});

test('lingers 500ms after speech', () => {
  const d = talking();
  assert.deepEqual(feed(d, -60, [200, 300, 400, 500, 600, 650]), Array(6).fill(null));
  assert.equal(d.sample(-60, 700), false);
  assert.equal(d.talking, false);
});

test('speech during linger keeps talking', () => {
  const d = talking();
  assert.equal(d.sample(-60, 200), null);
  assert.equal(d.sample(-30, 400), null);
  assert.deepEqual(feed(d, -60, [450, 600, 949]), [null, null, null]);
  assert.equal(d.sample(-60, 950), false);
});

test('threshold change applies to next sample', () => {
  const d = talking();
  assert.equal(d.sample(-30, 200), null);
  d.threshold = -20;
  assert.equal(d.sample(-30, 300), null);
  assert.equal(d.sample(-30, 799), null);
  assert.equal(d.sample(-30, 800), false);
});

test('reset clears talking without emitting', () => {
  const d = talking();
  d.reset();
  assert.equal(d.talking, false);
  assert.equal(d.sample(-60, 200), null);
});
