import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceGlowIds, VoiceGlow, applyVoiceCameras, fadeGlow } from '../scripts/voice-glow.mjs';

const users = new Map([
  ['a', { id: 'a', character: { id: 'amiri' } }],
  ['b', { id: 'b', character: { id: 'bo' } }],
  ['c', { id: 'c', character: null }]
]);
const token = (id, actorId) => ({ id, actor: actorId ? { id: actorId } : null, document: { actorId }, children: [],
  addChild(child) { this.children.push(child); child.parent = this; return child; },
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; } });
const active = (speaker) => ({ active: true, speaker, participants: [speaker], urgent: [] });
const make = (tokens, extra = {}) => new VoiceGlow({ tokens: () => tokens, users: () => users, enabled: () => true,
  createRing: () => ({ destroy() { this.destroyed = true; } }), drawRing: () => {}, ...extra });
const ids = (set) => [...set].sort();

test('voice glow skips the RP turn holder', () => {
  assert.deepEqual(ids(voiceGlowIds(new Set(['a', 'b']), active('a'))), ['b']);
  assert.deepEqual(ids(voiceGlowIds(new Set(['a', 'b']), { ...active('a'), active: false })), ['a', 'b']);
});

test('scene ending reveals the turn holder\'s glow', () => {
  const tokens = [token('t1', 'amiri')];
  const glow = make(tokens);
  glow.sync({ talkingIds: new Set(['a']), state: active('a') });
  assert.equal(tokens[0].children.length, 0);
  glow.sync({ talkingIds: new Set(['a']), state: { ...active('a'), active: false } });
  assert.equal(tokens[0].children.length, 1);
});

test('multiple talkers glow at once', () => {
  const tokens = [token('t1', 'amiri'), token('t2', 'bo'), token('t3', 'goblin')];
  const glow = make(tokens);
  glow.sync({ talkingIds: new Set(['a', 'b']), state: null });
  assert.deepEqual(tokens.map(t => t.children.length), [1, 1, 0]);
});

test('user without a character glows no tokens', () => {
  const tokens = [token('t1', 'amiri')];
  const glow = make(tokens);
  assert.doesNotThrow(() => glow.sync({ talkingIds: new Set(['c']), state: null }));
  assert.equal(tokens[0].children.length, 0);
});

test('disabled host clears glows', () => {
  const tokens = [token('t1', 'amiri')];
  let on = true;
  const glow = make(tokens, { enabled: () => on });
  glow.sync({ talkingIds: new Set(['a']), state: null });
  assert.equal(tokens[0].children.length, 1);
  on = false;
  glow.sync({ talkingIds: new Set(['a']), state: null });
  assert.equal(tokens[0].children.length, 0);
});

test('detachRing used for removal', () => {
  const tokens = [token('t1', 'amiri')];
  const detached = [];
  const glow = make(tokens, { detachRing: (t, r) => detached.push([t, r]) });
  glow.sync({ talkingIds: new Set(['a']), state: null });
  const ring = tokens[0].children[0];
  glow.sync({ talkingIds: new Set(), state: null });
  assert.deepEqual(detached, [[tokens[0], ring]]);
  assert.equal(tokens[0].children.length, 1, 'base removal is skipped');
  assert.notEqual(ring.destroyed, true);
});

function fakeEl(userId) {
  const classes = new Set(), kids = [];
  const el = { dataset: { user: userId }, kids,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle(c, force) { (force ? classes.add(c) : classes.delete(c)); return force; } },
    querySelector: (sel) => kids.find(k => sel === ':scope > .rp-frame-nomic' && k.cls === 'rp-frame-nomic') ?? null,
    append(k) { kids.push(k); k.parent = el; },
    ownerDocument: { createElement: () => ({ cls: null, title: '', className: '',
      set className(v) { this.cls = v.split(' ').includes('rp-frame-nomic') ? 'rp-frame-nomic' : v; },
      get className() { return this.cls; },
      remove() { kids.splice(kids.indexOf(this), 1); } }) } };
  return el;
}

test('cameras toggle voice class and no-mic marks', () => {
  const a = fakeEl('a'), b = fakeEl('b');
  const root = { querySelectorAll: () => [a, b] };
  applyVoiceCameras(root, new Set(['a']), new Set(['b']));
  assert.equal(a.classList.contains('rp-frame-voice'), true);
  assert.equal(b.classList.contains('rp-frame-voice'), false);
  assert.equal(a.kids.length, 0);
  assert.equal(b.kids.length, 1);
  assert.equal(b.kids[0].title, 'Voice glow off for this player');
  applyVoiceCameras(root, new Set(['a']), new Set(['b']));
  assert.equal(b.kids.length, 1, 'no duplicate mark');
  applyVoiceCameras(root, new Set(), new Set());
  assert.equal(a.classList.contains('rp-frame-voice'), false);
  assert.equal(b.kids.length, 0);
  applyVoiceCameras(root, new Set(), new Set(['b']));
  applyVoiceCameras(root, new Set(), null);
  assert.equal(b.kids.length, 0, 'null noMic leaves no marks');
});

function fakeTicker() {
  const ticker = { deltaMS: 50, callbacks: new Set(), add(fn) { this.callbacks.add(fn); }, remove(fn) { this.callbacks.delete(fn); },
    tick() { for (const fn of [...this.callbacks]) fn(); } };
  globalThis.canvas = { app: { ticker } };
  return ticker;
}

test('fade tweens alpha then calls done', () => {
  const ticker = fakeTicker();
  const glow = { alpha: 1 };
  let done = 0;
  fadeGlow(glow, 0, 1, 150, () => done++);
  assert.equal(glow.alpha, 0);
  ticker.tick();
  assert.ok(glow.alpha > 0 && glow.alpha < 1);
  ticker.tick(); ticker.tick();
  assert.equal(glow.alpha, 1);
  assert.equal(done, 1);
  assert.equal(ticker.callbacks.size, 0);
});

test('fade stops without done when the glow is destroyed mid-fade', () => {
  const ticker = fakeTicker();
  const glow = { alpha: 1, destroyed: false };
  let done = 0;
  fadeGlow(glow, 1, 0, 150, () => done++);
  ticker.tick();
  glow.destroyed = true;
  ticker.tick();
  assert.equal(ticker.callbacks.size, 0);
  ticker.tick();
  assert.equal(done, 0);
});

test('fade without a canvas ticker jumps to the end', () => {
  globalThis.canvas = undefined;
  const glow = { alpha: 0 };
  let done = 0;
  assert.doesNotThrow(() => fadeGlow(glow, 0, 1, 150, () => done++));
  assert.equal(glow.alpha, 1);
  assert.equal(done, 1);
});
