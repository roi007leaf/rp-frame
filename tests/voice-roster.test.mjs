import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceRoster, MIC, HEARTBEAT_MS, STALE_MS } from '../scripts/voice-roster.mjs';

const ok = { talking: true, mic: 'ok' };

test('constants', () => {
  assert.equal(HEARTBEAT_MS, 3000);
  assert.equal(STALE_MS, 9000);
  assert.deepEqual(MIC, { ok: 'ok', off: 'off', denied: 'denied', unavailable: 'unavailable' });
});

test('update marks talking and refreshes', () => {
  const r = new VoiceRoster();
  assert.equal(r.update('a', ok, 0), true);
  assert.equal(r.update('a', ok, 3000), false);
  assert.ok(r.talkingIds().has('a'));
});

test('prune drops stale talkers', () => {
  const r = new VoiceRoster();
  r.update('a', { talking: true, mic: 'denied' }, 0);
  assert.equal(r.prune(9000), false);
  assert.equal(r.prune(9001), true);
  assert.equal(r.talkingIds().size, 0);
  assert.ok(r.noMicIds().has('a'));
});

test('heartbeat keeps talker alive', () => {
  const r = new VoiceRoster();
  for (const t of [0, 3000, 6000]) r.update('a', ok, t);
  assert.equal(r.prune(14000), false);
  assert.ok(r.talkingIds().has('a'));
});

test('remove clears user', () => {
  const r = new VoiceRoster();
  r.update('a', { talking: true, mic: 'denied' }, 0);
  assert.equal(r.remove('a'), true);
  assert.equal(r.remove('a'), false);
  assert.equal(r.talkingIds().size, 0);
  assert.equal(r.noMicIds().size, 0);
});

test('noMicIds lists off/denied/unavailable only', () => {
  const r = new VoiceRoster();
  r.update('a', { talking: false, mic: 'ok' }, 0);
  r.update('b', { talking: false, mic: 'off' }, 0);
  r.update('c', { talking: false, mic: 'denied' }, 0);
  r.update('d', { talking: false, mic: 'unavailable' }, 0);
  assert.deepEqual([...r.noMicIds()].sort(), ['b', 'c', 'd']);
});

test('garbage payload ignored', () => {
  const r = new VoiceRoster();
  assert.equal(r.update('a', null, 0), false);
  assert.equal(r.update('a', { talking: 'yes' }, 0), false);
  assert.equal(r.update('a', { talking: true, mic: 'bogus' }, 0), false);
  assert.equal(r.talkingIds().size, 0);
  assert.equal(r.noMicIds().size, 0);
});

test('mic defaults to ok; mic change counts as changed; clear empties', () => {
  const r = new VoiceRoster();
  assert.equal(r.update('a', { talking: false }, 0), true);
  assert.equal(r.update('a', { talking: false, mic: 'off' }, 1), true);
  assert.ok(r.noMicIds().has('a'));
  r.clear();
  assert.equal(r.noMicIds().size, 0);
});
