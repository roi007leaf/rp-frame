import { SceneController } from './scripts/scene-controller.mjs';
import { GmConnection } from './scripts/gm-connection.mjs';
import { SceneView } from './scripts/view.mjs';
import { StoryframeLink } from './scripts/storyframe-link.mjs';
import { registerRpKeybindings } from './scripts/keybindings.mjs';

export const MODULE_ID = 'rp-frame';
let socket, controller, connection, view, spotlight, pollTimer;
const session = Date.now() + Math.random();
let initialized = false;
const isAuthority = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
const isPlayer = id => Boolean(game.users.get(id) && !game.users.get(id).isGM);
const inCombat = () => game.combats?.some(combat => combat.active && combat.started) ?? false;
const connected = () => isAuthority() ? Boolean(controller?.ready) : Boolean(connection?.connected);
const report = error => { console.error('RP Frame |', error); ui.notifications?.error(`RP Frame: ${error.message}`); };
const setting = key => game.settings.get(MODULE_ID, key);
const sender = context => context?.socketdata?.userId;
const packet = () => ({ session, ready: Boolean(controller?.ready && isAuthority()), state: controller?.state });

function refresh() {
  if (!controller) return;
  view?.render(controller.state);
  void ui.controls?.render?.({ reset: true });
}

function changed(state) {
  refresh();
  if (isAuthority()) void spotlight?.sync(state);
  Hooks.callAll('rpFrameStateChanged', structuredClone(state));
}

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register('scene', { scope: 'world', config: false, type: Object, default: {} });
  register('spotlightLink', { scope: 'world', config: false, type: Object, default: {} });
  register('layout', { scope: 'client', config: false, type: Object, default: {} });
  register('banner', { name: 'RP Frame: speaker banner', hint: 'Show the active speaker and queue. Drag to move, use the corner to resize.', scope: 'client', config: true, type: Boolean, default: true, onChange: refresh });
  register('badges', { name: 'RP Frame: player and camera badges', scope: 'client', config: true, type: Boolean, default: true, onChange: refresh });
  register('linkSpotlight', { name: 'RP Frame: follow StoryFrame spotlight', hint: 'When optional StoryFrame is enabled, highlight existing speakers matching each player character. Restore the previous spotlight when the RP scene ends.', scope: 'world', config: true, type: Boolean, default: true, onChange: () => { if (controller) void spotlight?.sync(controller.state); } });
  register('stopForCombat', { name: 'RP Frame: end scene when combat starts', scope: 'world', config: true, type: Boolean, default: true });
}

export function registerKeybindings() {
  registerRpKeybindings({
    register: (id, data) => game.keybindings.register(MODULE_ID, id, data),
    context: () => ({ state: controller?.state, user: game.user, ready: controller?.ready, combat: setting('stopForCombat') && inCombat() }),
    command
  });
}

export function registerSocket() {
  if (socket) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket.register('command', async function(command, expectedSession) {
    if (!isAuthority() || !controller?.ready || expectedSession !== session) return;
    const actor = game.users.get(sender(this));
    if (actor) {
      // socketlib commands do not await handlers; contain rejected writes here.
      try { await controller.enqueue(command, { id: actor.id, isGM: actor.isGM }); }
      catch (error) { report(error); }
    }
  });
  socket.register('state', function(data) {
    const from = sender(this);
    if (!isAuthority() && controller && connection?.accept(from, data, game.users.activeGM?.id)) controller.accept(data.state);
  });
  socket.register('ping', async function(nonce) {
    if (!isAuthority() || !controller?.ready) return;
    // A GM elected after another disconnects must first recover durable state.
    if (!controller.authority) {
      try { await controller.initialize(); }
      catch (error) { report(error); return; }
      if (!isAuthority()) return;
    }
    const requester = sender(this);
    if (requester) socket.executeForUsers('pong', [requester], nonce, packet());
  });
  socket.register('pong', function(nonce, data) {
    if (connection?.accept(sender(this), data, game.users.activeGM?.id, nonce)) controller?.accept(data.state);
  });
  socket.register('unavailable', function(previousSession) {
    connection?.unavailable(sender(this), previousSession);
    connection?.poll(game.users.activeGM?.id, true);
  });
  if (game.ready) void initialize();
}

export async function command(type, userId = null) {
  if (!controller?.ready) return;
  if (isAuthority()) {
    try { return await controller.enqueue({ type, userId }, { id: game.user.id, isGM: true }); }
    catch (error) { report(error); return false; }
  }
  if (!connected()) { ui.notifications?.warn('Waiting for GM'); return false; }
  socket.executeForAllGMs('command', { type, userId }, connection?.session);
  return true;
}

export async function initialize() {
  if (initialized || !socket || !game.ready) return;
  initialized = true;
  spotlight = new StoryframeLink({
    isAuthority, enabled: () => Boolean(game.modules.get('storyframe')?.active && setting('linkSpotlight')),
    manager: () => game.modules.get('storyframe')?.active ? game.storyframe?.stateManager : null,
    sceneId: () => game.scenes.current?.id, user: id => game.users.get(id),
    load: () => setting('spotlightLink'), save: data => game.settings.set(MODULE_ID, 'spotlightLink', data),
    render: () => { game.storyframe?.gmSidebar?.render(); game.storyframe?.playerViewer?.render(); }, error: report
  });
  connection = new GmConnection({
    sendPing: (_gm, nonce) => socket.executeForAllGMs('ping', nonce), changed: refresh
  });
  view = new SceneView({
    context: () => ({ users: game.users, userId: game.user.id, isGM: game.user.isGM, connected: connected() }),
    command, showBanner: () => setting('banner'), showBadges: () => setting('badges'),
    layout: () => setting('layout'), saveLayout: data => game.settings.set(MODULE_ID, 'layout', data)
  });
  controller = new SceneController({
    isAuthority, isPlayer, inCombat: () => setting('stopForCombat') && inCombat(), now: () => Date.now(),
    load: () => setting('scene'), save: data => game.settings.set(MODULE_ID, 'scene', data),
    changed, publish: () => socket.executeForOthers('state', packet()), error: report
  });
  try { await controller.initialize(); }
  catch (error) { initialized = false; report(error); return; }
  const api = game.modules.get(MODULE_ID).api = {
    getState: () => structuredClone(controller.state), isGmConnected: connected,
    command, start: () => command('start'), end: () => command('end'),
    join: () => command('join'), finish: () => command('finish'), urgent: () => command('urgent')
  };
  if (game.modules.get('storyframe')?.active && game.storyframe) game.storyframe.rpFrame = api;
  const poll = () => {
    if (!isAuthority()) {
      controller.authority = false;
      connection.poll(game.users.activeGM?.id);
    } else if (!controller.authority) void controller.initialize().catch(report);
    else if (controller.state.active) void spotlight.sync(controller.state);
  };
  poll();
  pollTimer = globalThis.setInterval(poll, 1000);
  // Warn once; do not alter another module's settings.
  if (game.user.isGM && game.modules.get('raise-my-hand')?.active && game.settings.get('raise-my-hand', 'enableQueue')) {
    ui.notifications.warn('RP Frame: disable Raise My Hand\'s queue to avoid two RP scene systems.');
  }
  refresh();
}

export function tokenControls(controls) {
  const tokens = Array.isArray(controls) ? controls.find(control => control.name === 'token') : controls.tokens;
  if (!tokens) return;
  const state = controller?.state;
  const tools = [];
  if (game.user.isGM) tools.push({ name: 'rp-frame-scene', title: state?.active ? 'RP Frame — end scene' : 'RP Frame — start scene', icon: state?.active ? 'fas fa-stop' : 'fas fa-play', visible: Boolean(state?.active || state?.participants.length), onClick: () => command(state?.active ? 'end' : 'start') });
  else {
    const speaking = state?.speaker === game.user.id;
    const joined = state?.participants.includes(game.user.id);
    tools.push({ name: 'rp-frame-join', title: speaking ? 'RP Frame — finish speaking' : joined ? 'RP Frame — leave queue' : 'RP Frame — join scene', icon: speaking ? 'fas fa-microphone' : 'fas fa-hand', onClick: () => command(speaking ? 'finish' : joined ? 'leave' : 'join') },
      { name: 'rp-frame-urgent', title: 'RP Frame — urgent speak', icon: 'fas fa-exclamation', onClick: () => command('urgent') },
      { name: 'rp-frame-delay', title: 'RP Frame — delay turn', icon: 'fas fa-forward', visible: speaking, onClick: () => command('delay') });
  }
  for (const tool of tools) {
    tool.button = true;
    tool.visible ??= true;
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
    else {
      // Foundry 13+ invokes BOTH callbacks if present; register only its native API.
      const action = tool.onClick;
      delete tool.onClick;
      tool.onChange = (_event, active) => active ? action() : undefined;
      tokens.tools ??= {};
      tool.order = Object.keys(tokens.tools).length;
      tokens.tools[tool.name] = tool;
    }
  }
}

Hooks.once('init', () => { registerSettings(); registerKeybindings(); });
Hooks.once('socketlib.ready', registerSocket);
Hooks.once('ready', initialize);
Hooks.on('getSceneControlButtons', tokenControls);
for (const hook of ['renderPlayers', 'renderCameraViews', 'renderCameraPopout', 'canvasReady']) Hooks.on(hook, refresh);
Hooks.on('updateUser', refresh);
Hooks.on('userConnected', () => {
  if (!controller?.ready) return;
  if (!isAuthority()) controller.authority = false;
  if (!isAuthority()) connection.poll(game.users.activeGM?.id, true);
  refresh();
});
Hooks.on('updateCombat', combat => {
  if (combat.started && setting('stopForCombat') && isAuthority()) void command('end');
});
globalThis.addEventListener?.('pagehide', () => {
  globalThis.clearInterval(pollTimer);
  if (isAuthority() && controller?.ready) socket?.executeForOthers('unavailable', session);
});
