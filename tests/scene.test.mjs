import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyScene, readScene, transition, waitingOrder } from '../scripts/scene-state.mjs';
import { SceneController } from '../scripts/scene-controller.mjs';
import { GmConnection } from '../scripts/gm-connection.mjs';
import { scenePresentation } from '../scripts/view.mjs';
import { StoryframeLink } from '../scripts/storyframe-link.mjs';

const gm = { id: 'gm', isGM: true };
const player = id => ({ id, isGM: false });
const isPlayer = id => ['a', 'b', 'c'].includes(id);
const apply = (state, type, actor = gm, userId = null, combat = false) => transition(state, { type, userId }, actor, { isPlayer, combat });
const scene = () => ['a', 'b', 'c'].reduce((state, id) => apply(state, 'join', player(id)), emptyScene());

test('player requests remain pending until GM approval; urgent request wins first spotlight', () => {
  let state = scene();
  assert.equal(state.active, false);
  assert.equal(state.speaker, null);
  state = apply(state, 'urgent', player('c'));
  state = apply(state, 'start');
  assert.equal(state.active, true);
  assert.equal(state.speaker, 'c');
  assert.deepEqual(state.urgent, []);
  assert.deepEqual(waitingOrder(state), ['a', 'b']);
});

test('players cannot approve, end, choose, remove others, or impersonate another player', () => {
  const state = apply(scene(), 'start');
  for (const type of ['start', 'end', 'choose', 'remove', 'next']) assert.equal(apply(state, type, player('b'), 'a'), state);
  assert.equal(apply(state, 'finish', player('b'), 'a'), state);
  const urgent = apply(state, 'urgent', player('b'), 'c');
  assert.deepEqual(urgent.urgent, ['b']);
  assert.equal(apply(state, 'join', player('fake')), state);
});

test('finish rotates speaker to back, prioritizing urgent participant', () => {
  let state = apply(scene(), 'start');
  state = apply(state, 'urgent', player('c'));
  state = apply(state, 'finish', player('a'));
  assert.equal(state.speaker, 'c');
  assert.deepEqual(state.participants, ['b', 'c', 'a']);
  assert.deepEqual(state.urgent, []);
});

test('delay swaps current and next positions without dropping either participant', () => {
  const state = apply(apply(scene(), 'start'), 'delay', player('a'));
  assert.equal(state.speaker, 'b');
  assert.deepEqual(state.participants, ['b', 'a', 'c']);
});

test('last speaker finishing ends scene; empty active scene survives recovery', () => {
  let state = apply(apply(emptyScene(), 'join', player('a')), 'start');
  state = apply(state, 'finish', player('a'));
  assert.deepEqual(state, emptyScene());
  assert.equal(readScene(apply(emptyScene(), 'start')).active, true);
});

test('GM can override and remove speaker; player must finish before leaving spotlight', () => {
  let state = apply(scene(), 'start');
  assert.equal(apply(state, 'leave', player('a')), state);
  state = apply(state, 'choose', gm, 'c');
  assert.equal(state.speaker, 'c');
  state = apply(state, 'remove', gm, 'c');
  assert.equal(state.speaker, 'a');
  assert.deepEqual(state.participants, ['a', 'b']);
});

test('combat blocks new scene activity but allows GM cleanup', () => {
  const state = apply(scene(), 'start');
  for (const type of ['start', 'join', 'urgent', 'take', 'finish']) assert.equal(apply(state, type, player('b'), null, true), state);
  assert.deepEqual(apply(state, 'end', gm, null, true), emptyScene());
});

test('snapshot validation discards deleted users and GMs without filtering offline players', () => {
  const state = readScene({ ...emptyScene(), revision: 8, active: true, participants: ['a', 'a', 'gm', 'deleted', 'b'], speaker: 'a', urgent: ['a', 'b', 'deleted'] }, isPlayer);
  assert.deepEqual(state.participants, ['a', 'b']);
  assert.deepEqual(state.urgent, ['b']);
  assert.equal(state.speaker, 'a');
  assert.deepEqual(readScene({ version: 999, active: true }), emptyScene());
});

function controllerRig() {
  let stored = emptyScene(), authority = true, now = 100;
  const events = [], errors = [];
  const host = {
    isAuthority: () => authority, isPlayer, inCombat: () => false, now: () => ++now,
    load: () => structuredClone(stored), save: async state => { events.push('save'); stored = structuredClone(state); },
    changed: () => events.push('changed'), publish: () => events.push('publish'), error: error => errors.push(error)
  };
  return { host, controller: new SceneController(host), events, errors, stored: () => stored, authority: value => { authority = value; } };
}

test('simultaneous commands serialize; durable save precedes UI and socket publication', async () => {
  const rig = controllerRig();
  await rig.controller.initialize();
  rig.events.length = 0;
  await Promise.all([rig.controller.enqueue({ type: 'join' }, player('a')), rig.controller.enqueue({ type: 'join' }, player('b'))]);
  assert.deepEqual(rig.controller.state.participants, ['a', 'b']);
  assert.deepEqual(rig.events, ['save', 'changed', 'publish', 'save', 'changed', 'publish']);
  assert.equal(rig.stored().revision, 102);
});

test('GM reload restores scene, speaker, urgent users and order from durable snapshot', async () => {
  const rig = controllerRig();
  await rig.controller.initialize();
  for (const id of ['a', 'b']) await rig.controller.enqueue({ type: 'join' }, player(id));
  await rig.controller.enqueue({ type: 'start' }, gm);
  await rig.controller.enqueue({ type: 'urgent' }, player('b'));
  const reload = new SceneController(rig.host);
  await reload.initialize();
  assert.deepEqual(reload.state, rig.controller.state);
  assert.equal(reload.state.active, true);
  assert.equal(reload.state.speaker, 'a');
});

test('failed save publishes nothing and does not poison later commands', async () => {
  const rig = controllerRig();
  await rig.controller.initialize();
  rig.events.length = 0;
  const save = rig.host.save;
  rig.host.save = () => { throw new Error('save failed'); };
  await assert.rejects(rig.controller.enqueue({ type: 'join' }, player('a')), /save failed/);
  assert.deepEqual(rig.controller.state.participants, []);
  assert.deepEqual(rig.events, []);
  rig.host.save = save;
  await rig.controller.enqueue({ type: 'join' }, player('b'));
  assert.deepEqual(rig.controller.state.participants, ['b']);
});

test('stale snapshot cannot resurrect ended scene', async () => {
  const rig = controllerRig();
  await rig.controller.initialize();
  await rig.controller.enqueue({ type: 'start' }, gm);
  const old = structuredClone(rig.controller.state);
  await rig.controller.enqueue({ type: 'end' }, gm);
  assert.equal(rig.controller.accept(old), false);
  const reload = new SceneController(rig.host);
  await reload.initialize();
  assert.equal(reload.state.active, false);
});

test('non-authority cannot mutate; election reads latest snapshot before writing', async () => {
  const rig = controllerRig();
  rig.authority(false);
  await rig.controller.initialize();
  assert.equal(await rig.controller.enqueue({ type: 'join' }, player('a')), false);
  await rig.host.save({ ...emptyScene(), revision: 500, participants: ['b'] });
  rig.authority(true);
  await rig.controller.enqueue({ type: 'join' }, player('a'));
  assert.deepEqual(rig.controller.state.participants, ['b', 'a']);
  assert.equal(rig.controller.state.revision, 501);
});

function connectionRig() {
  let now = 0;
  const pings = [], changes = [];
  const connection = new GmConnection({ sendPing: (...args) => pings.push(args), changed: value => changes.push(value), now: () => now });
  return { connection, pings, changes, at: value => { now = value; } };
}

test('ready heartbeat proves GM module available, independent of user activity', () => {
  const rig = connectionRig();
  rig.connection.poll('gm');
  assert.equal(rig.connection.accept('gm', { session: 1, ready: false }, 'gm', 1), false);
  assert.equal(rig.connection.connected, false);
  assert.equal(rig.connection.accept('gm', { session: 1, ready: true }, 'gm', 1), true);
  rig.connection.poll(null, true);
  assert.equal(rig.connection.connected, true);
  rig.connection.accept('gm', { session: 1, ready: true }, null, 2);
  assert.deepEqual(rig.changes, [true]);
});

test('slow three-second heartbeat does not flicker; five-second silence shows waiting', () => {
  const rig = connectionRig();
  rig.connection.poll('gm');
  rig.connection.accept('gm', { session: 1, ready: true }, 'gm', 1);
  rig.at(1000); rig.connection.poll('gm');
  rig.at(4000); rig.connection.poll('gm');
  assert.equal(rig.connection.connected, true);
  rig.connection.accept('gm', { session: 1, ready: true }, 'gm', 2);
  rig.at(5000); rig.connection.poll('gm');
  rig.at(10000); rig.connection.poll('gm');
  assert.equal(rig.connection.connected, false);
});

test('replacement ready session supersedes old-tab unload and heartbeat replies', () => {
  const rig = connectionRig();
  rig.connection.poll('gm');
  rig.connection.accept('gm', { session: 100, ready: true }, 'gm', 1);
  rig.connection.unavailable('gm', 100);
  assert.equal(rig.connection.connected, false);
  rig.connection.accept('gm', { session: 101, ready: true }, 'gm');
  rig.connection.unavailable('gm', 100);
  assert.equal(rig.connection.connected, true);
  assert.equal(rig.connection.accept('gm', { session: 100, ready: true }, 'gm'), false);
  rig.connection.unavailable('gm', 101);
  assert.equal(rig.connection.connected, false);
});

test('GM authority change rejects old sender even when its session epoch is newer', () => {
  const rig = connectionRig();
  rig.connection.poll('gm');
  assert.equal(rig.connection.accept('gm', { session: 900, ready: true }, 'other'), false);
  rig.connection.poll('other');
  assert.equal(rig.connection.accept('other', { session: 10, ready: true }, 'other', 2), true);
});

test('old nonce cannot complete a newer heartbeat', () => {
  const rig = connectionRig();
  rig.connection.poll('gm');
  rig.at(5000); rig.connection.poll('gm');
  assert.equal(rig.connection.accept('gm', { session: 100, ready: true }, 'gm', 1), false);
  assert.equal(rig.connection.accept('gm', { session: 100, ready: true }, 'gm', 2), true);
});

const users = new Map([
  ['a', { id: 'a', name: 'Anna', character: { name: 'Celdar Stoneplow', img: 'celdar.webp', uuid: 'Actor.a' } }],
  ['b', { id: 'b', name: 'Ben', character: { name: 'Ed Carver', img: 'ed.webp', uuid: 'Actor.b' } }]
]);

test('waiting changes only speaker text: self and other preserve portrait, tone, queue', () => {
  const state = apply(apply(scene(), 'start'), 'urgent', player('b'));
  for (const userId of ['a', 'b']) {
    const context = { users, userId, isGM: false, connected: true };
    const normal = scenePresentation(state, context);
    const waiting = scenePresentation(state, { ...context, connected: false });
    assert.equal(normal.text, userId === 'a' ? 'You are speaking' : 'Celdar speaks');
    assert.equal(waiting.text, 'Waiting for GM');
    assert.deepEqual({ ...normal, text: waiting.text, waiting: true }, waiting);
  }
});

test('ended scene never shows waiting; pending request switches directly to approved speaker', () => {
  const context = { users, userId: 'a', isGM: false, connected: false };
  assert.equal(scenePresentation(emptyScene(), context), null);
  assert.equal(scenePresentation(scene(), context).text, 'You want to start RP scene');
  assert.equal(scenePresentation(apply(scene(), 'start'), { ...context, connected: true }).text, 'You are speaking');
});

function linkRig() {
  let persisted = {}, enabled = true;
  const story = { speakers: [{ id: 'npc' }, { id: 'pc', actorUuid: 'Actor.a' }], activeSpeaker: 'npc' };
  const calls = [];
  const manager = { getState: () => story, setActiveSpeaker: async id => { calls.push(id); story.activeSpeaker = id; } };
  const link = new StoryframeLink({ isAuthority: () => true, enabled: () => enabled, manager: () => manager, sceneId: () => 'scene', user: id => users.get(id), load: () => persisted, save: async data => { persisted = data; }, render: () => {}, error: error => { throw error; } });
  return { link, story, calls, enabled: value => { enabled = value; }, persisted: () => persisted };
}

test('StoryFrame existing PC spotlight follows RP scene and previous NPC restores on end', async () => {
  const rig = linkRig();
  await rig.link.sync(apply(scene(), 'start'));
  assert.equal(rig.story.activeSpeaker, 'pc');
  assert.deepEqual(rig.persisted(), { sceneId: 'scene', previous: 'npc', managed: 'pc' });
  await rig.link.sync(emptyScene());
  assert.equal(rig.story.activeSpeaker, 'npc');
  assert.deepEqual(rig.calls, ['pc', 'npc']);
});

test('GM manual StoryFrame choice survives RP end; missing character does not create speakers', async () => {
  const rig = linkRig();
  await rig.link.sync(apply(scene(), 'start'));
  rig.story.activeSpeaker = 'npc';
  await rig.link.sync(emptyScene());
  assert.deepEqual(rig.calls, ['pc']);
  await rig.link.sync({ ...apply(scene(), 'start'), speaker: 'b' });
  assert.equal(rig.story.speakers.length, 2);
  assert.deepEqual(rig.calls, ['pc']);
});

test('disabling StoryFrame link restores prior spotlight', async () => {
  const rig = linkRig();
  const state = apply(scene(), 'start');
  await rig.link.sync(state);
  rig.enabled(false);
  await rig.link.sync(state);
  assert.equal(rig.story.activeSpeaker, 'npc');
});
