import assert from 'node:assert/strict';
import test from 'node:test';
import { speakerTokens, speakingUserId, SpeakerHighlight } from '../scripts/speaker-highlight.mjs';

const users = new Map([
  ['a', { id: 'a', character: { id: 'amiri' } }],
  ['b', { id: 'b', character: null }]
]);
const token = (id, actorId) => ({ id, actor: actorId ? { id: actorId } : null, document: { actorId }, children: [],
  addChild(child) { this.children.push(child); child.parent = this; return child; },
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; } });
const active = (speaker) => ({ active: true, speaker, participants: [speaker], urgent: [] });

test('speaking user only while a scene is active', () => {
  assert.equal(speakingUserId(active('a')), 'a');
  assert.equal(speakingUserId({ ...active('a'), active: false }), null);
  assert.equal(speakingUserId({ active: true, speaker: null }), null);
  assert.equal(speakingUserId(null), null);
});

test('speaker tokens are every token of the speaking user\'s character', () => {
  const tokens = [token('t1', 'amiri'), token('t2', 'goblin'), token('t3', 'amiri'), token('t4', null)];
  assert.deepEqual(speakerTokens(active('a'), users, tokens).map(t => t.id), ['t1', 't3']);
});

test('no tokens when the speaker has no character or the scene is not active', () => {
  const tokens = [token('t1', 'amiri')];
  assert.deepEqual(speakerTokens(active('b'), users, tokens), []);
  assert.deepEqual(speakerTokens({ ...active('a'), active: false }, users, tokens), []);
});

test('highlight rings follow the speaker and clear when the scene ends', () => {
  const tokens = [token('t1', 'amiri'), token('t2', 'goblin')];
  const drawn = [];
  const hl = new SpeakerHighlight({ tokens: () => tokens, users: () => users, enabled: () => true,
    createRing: () => ({ name: 'rp-frame-speaker-ring', destroy() { this.destroyed = true; } }),
    drawRing: (ring, t) => drawn.push(t.id) });
  hl.sync(active('a'));
  assert.equal(tokens[0].children.length, 1);
  assert.equal(tokens[1].children.length, 0);
  assert.deepEqual(drawn, ['t1']);
  hl.sync(active('a'));
  assert.equal(tokens[0].children.length, 1, 'no duplicate rings on re-sync');
  const ring = tokens[0].children[0];
  hl.sync({ ...active('a'), active: false });
  assert.equal(tokens[0].children.length, 0);
  assert.equal(ring.destroyed, true);
});

test('disabled setting removes and suppresses rings', () => {
  const tokens = [token('t1', 'amiri')];
  let on = true;
  const hl = new SpeakerHighlight({ tokens: () => tokens, users: () => users, enabled: () => on,
    createRing: () => ({ destroy() {} }), drawRing: () => {} });
  hl.sync(active('a'));
  on = false;
  hl.sync(active('a'));
  assert.equal(tokens[0].children.length, 0);
});

test('redraw re-sizes an existing ring only', () => {
  const tokens = [token('t1', 'amiri'), token('t2', 'goblin')];
  const drawn = [];
  const hl = new SpeakerHighlight({ tokens: () => tokens, users: () => users, enabled: () => true,
    createRing: () => ({ destroy() {} }), drawRing: (_ring, t) => drawn.push(t.id) });
  hl.sync(active('a'));
  drawn.length = 0;
  hl.redraw(tokens[0]);
  hl.redraw(tokens[1]);
  assert.deepEqual(drawn, ['t1']);
});

test('reset forgets rings of a torn-down canvas without touching its tokens', () => {
  const tokens = [token('t1', 'amiri')];
  const hl = new SpeakerHighlight({ tokens: () => tokens, users: () => users, enabled: () => true,
    createRing: () => ({ destroy() {} }), drawRing: () => {} });
  hl.sync(active('a'));
  tokens[0].removeChild = () => { throw new Error('destroyed token'); };
  hl.reset();
  const fresh = [token('t9', 'amiri')];
  hl.host.tokens = () => fresh;
  hl.sync(active('a'));
  assert.equal(fresh[0].children.length, 1);
});
