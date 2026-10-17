import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceMic } from '../scripts/voice-mic.mjs';
import { VoiceService } from '../scripts/voice-service.mjs';

const LOUD = 0.1, QUIET = 0.001;

function fakeClock() {
  const timers = new Map();
  let nextId = 1;
  const clock = {
    t: 0,
    timers,
    now: () => clock.t,
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms, due: clock.t + ms });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.due <= end && (!next || tm.due < next[1].due)) next = [id, tm];
        if (!next) break;
        const [, tm] = next;
        clock.t = tm.due;
        tm.due += tm.ms;
        tm.fn();
      }
      clock.t = end;
    },
  };
  return clock;
}

function fakeAudio() {
  const audio = {
    level: QUIET,
    contexts: [],
    tracks: [],
    calls: 0,
    reject: null,
    mediaDevices: {
      getUserMedia: async constraints => {
        audio.calls++;
        audio.constraints = constraints;
        if (audio.reject) throw audio.reject;
        const track = {
          stopped: false,
          listeners: {},
          addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
          stop() { this.stopped = true; },
          fire(type) { for (const fn of this.listeners[type] ?? []) fn(); },
        };
        audio.tracks.push(track);
        return { getTracks: () => [track] };
      },
    },
    createAudioContext() {
      const destination = { name: 'destination' };
      const ctx = {
        state: 'running',
        closed: false,
        resumed: 0,
        connections: [],
        destination,
        createMediaStreamSource: () => ({ connect: target => ctx.connections.push(target) }),
        createAnalyser: () => ({
          fftSize: 256,
          getFloatTimeDomainData: buf => buf.fill(audio.level),
          connect: target => ctx.connections.push(target),
        }),
        close: async () => { ctx.closed = true; ctx.state = 'closed'; },
        resume: async () => { ctx.resumed++; ctx.state = 'running'; },
      };
      audio.contexts.push(ctx);
      return ctx;
    },
  };
  return audio;
}

function setup({ consented = false, allow = true, enabled = true, optedOut = false, mediaDevices } = {}) {
  const clock = fakeClock();
  const audio = fakeAudio();
  const mic = new VoiceMic({
    mediaDevices: mediaDevices === undefined ? audio.mediaDevices : mediaDevices,
    createAudioContext: () => audio.createAudioContext(),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  });
  const state = { enabled, optedOut, consented, allow, asked: 0, consentSet: 0, optOutCalls: [] };
  const sent = [];
  const host = {
    enabled: () => state.enabled,
    optedOut: () => state.optedOut,
    consented: () => state.consented,
    askConsent: async () => { state.asked++; return state.allow; },
    setOptOut: async v => { state.optOutCalls.push(v); state.optedOut = v; },
    setConsent: async () => { state.consentSet++; state.consented = true; },
    threshold: () => -45,
    mic,
    send: payload => sent.push(payload),
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  const service = new VoiceService(host);
  return { clock, audio, mic, state, sent, host, service };
}

async function talkingSetup(opts) {
  const s = setup({ consented: true, ...opts });
  await s.service.update();
  s.audio.level = LOUD;
  s.clock.advance(200);
  assert.equal(s.service.talking, true);
  s.sent.length = 0;
  return s;
}

test('consent asked once, allow stores consent and starts', async () => {
  const { service, state, sent, audio } = setup();
  await Promise.all([service.update(), service.update()]);
  assert.equal(state.asked, 1);
  assert.equal(state.consentSet, 1);
  assert.equal(audio.calls, 1);
  assert.deepEqual(sent[0], { talking: false, mic: 'ok' });
  assert.equal(service.status, 'ok');
  assert.deepEqual(audio.constraints, {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
});

test('no thanks opts out and never opens mic', async () => {
  const { service, state, sent, audio } = setup({ allow: false });
  await service.update();
  assert.equal(audio.calls, 0);
  assert.deepEqual(state.optOutCalls, [true]);
  assert.equal(state.consentSet, 0);
  assert.deepEqual(sent, [{ talking: false, mic: 'off' }]);
  assert.equal(service.status, 'off');
});

test('consented player is not asked again', async () => {
  const { service, state, audio, sent } = setup({ consented: true });
  await service.update();
  assert.equal(state.asked, 0);
  assert.equal(audio.calls, 1);
  assert.deepEqual(sent, [{ talking: false, mic: 'ok' }]);
});

test('denied permission reports denied', async () => {
  const { service, state, audio, sent } = setup();
  audio.reject = { name: 'NotAllowedError' };
  await service.update();
  assert.equal(service.status, 'denied');
  assert.deepEqual(sent, [{ talking: false, mic: 'denied' }]);
  await service.update();
  assert.equal(state.asked, 1);
  assert.equal(service.status, 'denied');
});

test('denial is never re-asked even if host does not persist consent', async () => {
  const { service, state, audio, host } = setup();
  host.setConsent = async () => { state.consentSet++; }; // consented() stays false
  audio.reject = { name: 'SecurityError' };
  await service.update();
  await service.update();
  assert.equal(state.asked, 1);
  assert.equal(audio.calls, 2);
  assert.equal(service.status, 'denied');
});

test('other getUserMedia errors report unavailable', async () => {
  const { service, audio, sent } = setup({ consented: true });
  audio.reject = { name: 'NotFoundError' };
  await service.update();
  assert.equal(service.status, 'unavailable');
  assert.deepEqual(sent, [{ talking: false, mic: 'unavailable' }]);
});

test('no mediaDevices reports unavailable', async () => {
  const { service, sent } = setup({ consented: true, mediaDevices: null });
  await service.update();
  assert.equal(service.status, 'unavailable');
  assert.deepEqual(sent, [{ talking: false, mic: 'unavailable' }]);
});

test('loud audio sends talking true then heartbeats', async () => {
  const { service, audio, clock, sent } = setup({ consented: true });
  await service.update();
  sent.length = 0;
  audio.level = LOUD;
  clock.advance(200);
  assert.deepEqual(sent, [{ talking: true, mic: 'ok' }]);
  clock.advance(3000);
  assert.deepEqual(sent, [{ talking: true, mic: 'ok' }, { talking: true, mic: 'ok' }]);
  audio.level = QUIET;
  clock.advance(600);
  assert.deepEqual(sent.at(-1), { talking: false, mic: 'ok' });
  assert.equal(service.talking, false);
  const count = sent.length;
  clock.advance(10000);
  assert.equal(sent.length, count);
});

test('threshold is read from host on every sample', async () => {
  const s = setup({ consented: true });
  let threshold = -45;
  s.host.threshold = () => threshold;
  await s.service.update();
  threshold = -10;
  s.audio.level = LOUD; // -20 dB, below -10 threshold
  s.clock.advance(500);
  assert.equal(s.service.talking, false);
  threshold = -30;
  s.clock.advance(200);
  assert.equal(s.service.talking, true);
});

test('stop() sends talking:false', async () => {
  const { service, state, sent, audio, clock } = await talkingSetup();
  state.optedOut = true;
  await service.update();
  assert.deepEqual(sent, [{ talking: false, mic: 'off' }]);
  assert.ok(audio.tracks.every(t => t.stopped));
  assert.ok(audio.contexts.every(c => c.closed));
  assert.equal(clock.timers.size, 0);
  assert.equal(service.status, 'off');
  assert.equal(service.talking, false);
});

test('world switch off while talking sends false and closes mic', async () => {
  const { service, state, sent, audio, clock } = await talkingSetup();
  state.enabled = false;
  await service.update();
  assert.deepEqual(sent, [{ talking: false, mic: 'off' }]);
  assert.ok(audio.tracks.every(t => t.stopped));
  assert.ok(audio.contexts.every(c => c.closed));
  assert.equal(clock.timers.size, 0);
});

test('re-enabling after switch off restarts the mic', async () => {
  const { service, state, audio } = await talkingSetup();
  state.enabled = false;
  await service.update();
  state.enabled = true;
  await service.update();
  assert.equal(audio.calls, 2);
  assert.equal(service.status, 'ok');
});

test('switch off while mic is opening closes it', async () => {
  const { service, state, audio, sent, clock } = setup({ consented: true });
  const pending = service.update();
  state.enabled = false;
  await pending;
  assert.equal(service.status, 'off');
  assert.ok(audio.tracks.every(t => t.stopped));
  assert.ok(audio.contexts.every(c => c.closed));
  assert.equal(clock.timers.size, 0);
  assert.deepEqual(sent, []);
});

test('track ended reports unavailable', async () => {
  const { service, sent, audio, clock } = await talkingSetup();
  audio.tracks[0].fire('ended');
  assert.deepEqual(sent, [{ talking: false, mic: 'unavailable' }]);
  assert.equal(service.status, 'unavailable');
  assert.equal(service.talking, false);
  assert.equal(clock.timers.size, 0);
  clock.advance(5000);
  assert.equal(sent.length, 1);
});

test('mic never connected to destination', async () => {
  const { service, audio } = setup({ consented: true });
  await service.update();
  const ctx = audio.contexts[0];
  assert.ok(ctx.connections.length > 0);
  assert.ok(!ctx.connections.includes(ctx.destination));
});

test('announce resends current state', async () => {
  const { service, sent } = await talkingSetup();
  service.announce();
  assert.deepEqual(sent, [{ talking: true, mic: 'ok' }]);
});

test('mic getter exposes host mic', () => {
  const { service, mic } = setup();
  assert.equal(service.mic, mic);
});

test('VoiceMic resume only resumes a suspended context', async () => {
  const audio = fakeAudio();
  const clock = fakeClock();
  const mic = new VoiceMic({
    mediaDevices: audio.mediaDevices,
    createAudioContext: () => audio.createAudioContext(),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  });
  mic.resume();
  assert.equal(await mic.start(() => {}, () => {}), 'ok');
  const ctx = audio.contexts[0];
  mic.resume();
  assert.equal(ctx.resumed, 0);
  ctx.state = 'suspended';
  mic.resume();
  assert.equal(ctx.resumed, 1);
});

test('VoiceMic reports levels at its interval and stop cleans up', async () => {
  const audio = fakeAudio();
  const clock = fakeClock();
  const mic = new VoiceMic({
    mediaDevices: audio.mediaDevices,
    createAudioContext: () => audio.createAudioContext(),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    intervalMs: 50,
  });
  const levels = [];
  await mic.start(db => levels.push(db), () => {});
  audio.level = LOUD;
  clock.advance(100);
  assert.deepEqual(levels.map(Math.round), [-20, -20]);
  mic.stop();
  assert.ok(audio.tracks[0].stopped);
  assert.ok(audio.contexts[0].closed);
  assert.equal(clock.timers.size, 0);
  mic.stop();
});
