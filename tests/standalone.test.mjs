import assert from 'node:assert/strict';
import test from 'node:test';

for (const scenario of ['absent', 'disabled']) {
  test(`standalone scene lifecycle works with StoryFrame ${scenario}`, async () => {
    const settings = new Map(), outbound = [], errors = [];
    const users = new Map([['gm', { id: 'gm', isGM: true }], ['player', { id: 'player', isGM: false }]]);
    users.activeGM = users.get('gm');
    const modules = new Map([['rp-frame', {}]]);
    if (scenario === 'disabled') modules.set('storyframe', { active: false });
    const staleStoryframe = { stateManager: { getState: () => { throw Error('Disabled StoryFrame accessed'); } } };
    const previous = Object.fromEntries(['Hooks', 'document', 'game', 'ui', 'socketlib', 'setInterval'].map(key => [key, globalThis[key]]));
    try {
      globalThis.Hooks = { once: () => {}, on: () => {}, callAll: () => {} };
      globalThis.document = { body: null };
      globalThis.game = {
        ready: false, user: users.get('gm'), users, modules, combats: [], scenes: { current: { id: 'scene' } },
        ...(scenario === 'disabled' ? { storyframe: staleStoryframe } : {}),
        settings: {
          register: (_module, key, data) => settings.set(key, structuredClone(data.default)),
          get: (_module, key) => settings.get(key),
          set: async (_module, key, value) => settings.set(key, structuredClone(value))
        }
      };
      globalThis.ui = { controls: { render: async () => {} }, notifications: { warn: () => {}, error: error => errors.push(error) } };
      globalThis.socketlib = { registerModule: () => ({ register: () => {}, executeForOthers: (...args) => outbound.push(args) }) };
      globalThis.setInterval = () => 1;
      const runtime = await import(`../rp-frame.mjs?standalone=${scenario}`);
      runtime.registerSettings();
      runtime.registerSocket();
      game.ready = true;
      await runtime.initialize();
      const api = modules.get('rp-frame').api;
      assert.ok(api);
      assert.equal(api.isGmConnected(), true);
      await api.command('join', 'player');
      await api.start();
      assert.equal(api.getState().active, true);
      assert.equal(api.getState().speaker, 'player');
      assert.deepEqual(outbound.findLast(args => args[0] === 'state')[1].state, settings.get('scene'));
      await api.end();
      assert.equal(api.getState().active, false);
      assert.deepEqual(api.getState().participants, []);
      assert.deepEqual(errors, []);
      if (scenario === 'absent') assert.equal(game.storyframe, undefined);
      else {
        assert.equal(game.storyframe, staleStoryframe);
        assert.equal(game.storyframe.rpFrame, undefined);
      }
    } finally {
      Object.assign(globalThis, previous);
    }
  });
}
