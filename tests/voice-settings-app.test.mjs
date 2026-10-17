import assert from 'node:assert/strict';
import test from 'node:test';
import { MicTest } from '../scripts/voice-settings-app.mjs';

/** A fake VoiceMic whose start resolves when the test says so; tracks whether it is live. */
function fakeMic(mics) {
  let resolve;
  const mic = { live: false, stops: 0, onLevel: null, onEnded: null,
    start(onLevel, onEnded) { mic.onLevel = onLevel; mic.onEnded = onEnded; return new Promise(r => { resolve = r; }); },
    resolve(result = 'ok') { if (result === 'ok') mic.live = true; resolve(result); },
    stop() { mic.live = false; mic.stops++; } };
  mics.push(mic);
  return mic;
}

test('fast Test, Stop, Test with out-of-order getUserMedia leaves only the current run live', async () => {
  const mics = [];
  const tester = new MicTest(() => fakeMic(mics));
  const first = tester.start(() => {}, () => {});
  tester.stop();
  const second = tester.start(() => {}, () => {});
  assert.equal(mics.length, 2);
  mics[1].resolve('ok');
  assert.equal(await second, 'ok');
  mics[0].resolve('ok');
  assert.equal(await first, 'cancelled');
  assert.equal(mics[0].live, false);
  assert.equal(mics[1].live, true);
  assert.equal(tester.running, true);
  tester.stop();
  assert.equal(mics[1].live, false);
  assert.equal(tester.running, false);
});

test('stop while start is pending releases the mic once it opens (window closed mid-start)', async () => {
  const mics = [];
  const tester = new MicTest(() => fakeMic(mics));
  const pending = tester.start(() => {}, () => {});
  assert.equal(tester.running, true);
  tester.stop();
  mics[0].resolve('ok');
  assert.equal(await pending, 'cancelled');
  assert.equal(mics[0].live, false);
  assert.equal(tester.running, false);
});

test('failed start reports the result and is not running; stale runs never forward levels or ended', async () => {
  const mics = [];
  const tester = new MicTest(() => fakeMic(mics));
  const denied = tester.start(() => {}, () => {});
  mics[0].resolve('denied');
  assert.equal(await denied, 'denied');
  assert.equal(tester.running, false);
  const levels = [], ended = [];
  const run = tester.start(db => levels.push(db), () => ended.push(1));
  mics[1].resolve('ok');
  await run;
  mics[1].onLevel(-20);
  tester.stop();
  mics[1].onLevel(-30);
  mics[1].onEnded();
  assert.deepEqual(levels, [-20]);
  assert.deepEqual(ended, []);
});

test('a throwing mic start counts as unavailable', async () => {
  const tester = new MicTest(() => ({ start: async () => { throw Error('boom'); }, stop() {} }));
  assert.equal(await tester.start(() => {}, () => {}), 'unavailable');
  assert.equal(tester.running, false);
});
