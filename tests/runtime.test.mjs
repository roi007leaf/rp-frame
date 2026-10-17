import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const hooks = new Map(), onHooks = new Map(), settings = new Map(), values = new Map(), menus = new Map(), handlers = new Map(), outbound = [];
let saved = {}, authority = 'gm', timer;
const users = new Map([['gm',{id:'gm',isGM:true}],['other',{id:'other',isGM:true}],['a',{id:'a',isGM:false}],['b',{id:'b',isGM:false}],['player',{id:'player',isGM:false}]]);
Object.defineProperty(users,'activeGM',{get:()=>users.get(authority)});
globalThis.Hooks = { once:(name,callback)=>hooks.set(name,callback), on:(name,callback)=>onHooks.set(name,[...(onHooks.get(name)??[]),callback]), callAll:()=>{} };
let cameras = [];
const cssVars = new Map();
globalThis.document = { body:null, documentElement:{ style:{ setProperty:(name,value)=>cssVars.set(name,value) } }, querySelectorAll:selector=>selector==='.camera-view[data-user]' ? cameras : [],
  createElement:()=>({dataset:{},setAttribute(){},addEventListener(){}}) };
// No mic in this environment: voice glow must stay quiet rather than throw.
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
globalThis.foundry = { applications:{ api:{ ApplicationV2:class {} } } };
globalThis.game = {
  ready:false, user:users.get('gm'), users, combats:[],scenes:{current:{id:'scene'}},
  modules:new Map([['storyframe',{active:true}],['rp-frame',{}]]),storyframe:{},
  settings:{register:(_module,key,value)=>settings.set(key,value),registerMenu:(_module,key,value)=>menus.set(key,value),
    get:(_module,key)=>key==='scene' ? saved : values.has(key) ? values.get(key) : settings.get(key)?.default,
    set:async(_module,key,value)=>{if(key==='scene')saved=structuredClone(value);else values.set(key,value);}}
};
globalThis.ui = {controls:{render:async()=>{}},notifications:{warn:()=>{},error:error=>{throw Error(error);}}};
globalThis.socketlib = { registerModule:module=>{assert.equal(module,'rp-frame');return {
  register:(name,fn)=>handlers.set(name,fn),executeForOthers:(...args)=>outbound.push(args),executeForAllGMs:(...args)=>outbound.push(args),executeForUsers:(...args)=>outbound.push(args)
};}};
const nativeInterval = globalThis.setInterval;
globalThis.setInterval = callback => {timer=callback;return 1;};
const runtime = await import('../main.mjs');
runtime.registerSettings();
runtime.registerSocket();
game.ready=true;
await runtime.initialize();
globalThis.setInterval=nativeInterval;
const context = id => ({socketdata:{userId:id}});
const session = () => outbound.findLast(args=>args[0]==='state')[1].session;

test('runtime transport authenticates sender; claimed user ID cannot hijack queue', async () => {
  await handlers.get('command').call(context('a'),{type:'join',userId:'b'},session());
  assert.deepEqual(game.storyframe.rpFrame.getState().participants,['a']);
  await handlers.get('command').call(context('a'),{type:'start'},session());
  assert.equal(game.storyframe.rpFrame.getState().active,false);
  await handlers.get('command').call(context('unknown'),{type:'end'},session());
  assert.deepEqual(game.storyframe.rpFrame.getState().participants,['a']);
});

test('closing GM session cannot process commands intended for replacement', async () => {
  await handlers.get('command').call(context('b'),{type:'join'},session()-1);
  assert.deepEqual(game.storyframe.rpFrame.getState().participants,['a']);
  await handlers.get('command').call(context('b'),{type:'join'},session());
  assert.deepEqual(game.storyframe.rpFrame.getState().participants,['a','b']);
});

test('GM approval broadcasts active scene atomically; ping returns same durable snapshot', async () => {
  await runtime.command('start');
  assert.equal(saved.active,true);
  assert.equal(saved.speaker,'a');
  await handlers.get('ping').call(context('b'),27);
  const reply=outbound.findLast(args=>args[0]==='pong');
  assert.deepEqual(reply.slice(0,3),['pong',['b'],27]);
  assert.deepEqual(reply[3].state,saved);
  assert.equal(reply[3].ready,true);
});

test('v13/v14 token controls use isolated names and role-specific operations', () => {
  for(const version of [13,14]){
    const tokens=version===13 ? {name:'token',tools:[]} : {tools:{}};
    const controls=version===13 ? [tokens] : {tokens};
    runtime.tokenControls(controls);
    const tools=Array.isArray(tokens.tools)?tokens.tools:Object.values(tokens.tools);
    assert.equal(tools.length,1);
    assert.equal(tools.some(tool=>tool.name==='rp-frame-manager'),false);
    assert.equal(tools.every(tool=>tool.name.startsWith('rp-frame-')),true);
  }
  const original=game.user;
  game.user=users.get('a');
  const controls={tokens:{tools:{}}};
  runtime.tokenControls(controls);
  assert.match(controls.tokens.tools['rp-frame-join'].title,/finish speaking/);
  assert.equal(controls.tokens.tools['rp-frame-delay'].visible,true);
  game.user=original;
});

test('inactive GM ignores mutations and heartbeat requests', async () => {
  authority='other';
  timer();
  const before=structuredClone(saved);
  await handlers.get('command').call(context('gm'),{type:'end'},session());
  const length=outbound.length;
  await handlers.get('ping').call(context('a'),1);
  assert.equal(outbound.length,length);
  assert.deepEqual(saved,before);
  authority='gm';
});

test('Foundry native button activation dispatches once; deactivation does nothing', async () => {
  const controls={tokens:{tools:{}}};
  runtime.tokenControls(controls);
  const tool=controls.tokens.tools['rp-frame-scene'];
  assert.equal(tool.onClick,undefined);
  const revision=game.storyframe.rpFrame.getState().revision;
  await tool.onChange({},false);
  assert.equal(game.storyframe.rpFrame.getState().revision,revision);
  await tool.onChange({},true);
  assert.equal(game.storyframe.rpFrame.getState().active,false);
});

test('manifest requires only socketlib and recommends StoryFrame; no legacy imports', async () => {
  const manifest=JSON.parse(await readFile(new URL('../module.json',import.meta.url),'utf8'));
  assert.equal(manifest.id,'rp-frame');
  assert.equal(manifest.title,'RP Frame');
  assert.deepEqual(manifest.relationships.requires.map(item=>item.id),['socketlib']);
  assert.deepEqual(manifest.relationships.recommends.map(item=>item.id),['storyframe']);
  const source=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\s+['"][^'"]*raise-my-hand/);
});

test('init registers original shortcuts under RP Frame namespace; GM Space uses durable command path', async () => {
  const bindings = new Map();
  game.keybindings = { register: (module, id, data) => {
    assert.equal(module, 'rp-frame'); bindings.set(id, data);
  } };
  hooks.get('init')();
  assert.equal(bindings.size, 4);
  await runtime.command('join', 'a');
  assert.equal(bindings.get('snatch-spotlight').onDown({ event: { repeat: false } }), true);
  // The callback must return synchronously while the serialized save completes.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.active, true);
  assert.equal(saved.speaker, 'a');
  assert.equal(bindings.get('snatch-spotlight').onDown({ event: { repeat: true } }), false);
  assert.equal(bindings.get('snatch-spotlight').onDown({ event: {} }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.active, false);
});

function camera(userId) {
  const classes = new Set();
  return { dataset:{user:userId}, classes, querySelector:()=>null, append(){},
    classList:{ toggle:(name,force)=>force ? classes.add(name) : classes.delete(name), contains:name=>classes.has(name) },
    ownerDocument:{ createElement:()=>({ remove(){} }) } };
}
const fire = (name, ...args) => { for (const callback of onHooks.get(name) ?? []) callback(...args); };
const glowing = () => cameras.filter(tile=>tile.classes.has('rp-frame-voice')).map(tile=>tile.dataset.user);

test('settings registered', () => {
  for (const key of ['voiceGlow','voiceOptOut','voiceShow','voiceConsent','voiceThreshold']) assert.ok(settings.has(key), key);
  assert.equal(settings.get('voiceGlow').scope,'world');
  assert.equal(settings.get('voiceGlow').default,false);
  assert.equal(settings.get('voiceThreshold').default,-45);
  assert.equal(settings.get('voiceConsent').config,false);
});

test('voice toggles are hidden from the settings list and keep scope and default', () => {
  const expected = { voiceGlow:['world',false], voiceOptOut:['client',false], voiceShow:['client',true] };
  for (const [key,[scope,value]] of Object.entries(expected)) {
    const data = settings.get(key);
    assert.equal(data.config,false,key);
    assert.equal(data.scope,scope,key);
    assert.equal(data.type,Boolean,key);
    assert.equal(data.default,value,key);
    assert.equal(typeof data.onChange,'function',key);
  }
});

test('one voice glow menu replaces the sensitivity and appearance menus', () => {
  assert.equal(menus.has('voiceSensitivity'),false);
  assert.equal(menus.has('voiceAppearance'),false);
  const menu = menus.get('voiceSettings');
  assert.ok(menu);
  assert.equal(menu.name,'RP Frame: voice glow');
  assert.equal(menu.label,'Open');
  assert.equal(menu.hint,'Turn voice glow on for the table (GM), set up your mic, and choose how the glow looks on your screen.');
  assert.equal(menu.icon,'fa-solid fa-microphone-lines');
  assert.equal(menu.restricted,false);
  assert.equal(typeof menu.type,'function');
});

test('voice glow window helpers: table status line and test button label', async () => {
  const { tableStatus, testLabel } = await import('../scripts/voice-settings-app.mjs');
  assert.equal(tableStatus(true),'Voice glow is on for this table.');
  assert.equal(tableStatus(false),'Voice glow is off. Your GM can turn it on.');
  assert.equal(testLabel(false),'Test mic');
  assert.equal(testLabel(true),'Stop test');
});

test('old voice window files are gone', async () => {
  for (const file of ['voice-sensitivity-app.mjs','voice-appearance-app.mjs']) {
    await assert.rejects(readFile(new URL(`../scripts/${file}`,import.meta.url)), file);
  }
  const source = await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/voice-(sensitivity|appearance)-app/);
});

test('voice socket from another user renders glow', () => {
  cameras = [camera('player'), camera('a')];
  values.set('voiceGlow',true);
  handlers.get('voice').call(context('player'),{talking:true,mic:'ok'});
  assert.deepEqual(glowing(),['player']);
  handlers.get('voice').call(context('player'),{talking:false,mic:'ok'});
  assert.deepEqual(glowing(),[]);
});

test('world switch off clears all glows', () => {
  cameras = [camera('player'), camera('a')];
  values.set('voiceGlow',true);
  handlers.get('voice').call(context('player'),{talking:true,mic:'ok'});
  handlers.get('voice').call(context('a'),{talking:true,mic:'ok'});
  assert.deepEqual(glowing(),['player','a']);
  values.set('voiceGlow',false);
  fire('renderPlayers');
  assert.deepEqual(glowing(),[]);
});

test('disconnected talker stops glowing', () => {
  cameras = [camera('player')];
  values.set('voiceGlow',true);
  handlers.get('voice').call(context('player'),{talking:true,mic:'ok'});
  fire('renderPlayers');
  assert.deepEqual(glowing(),['player']);
  fire('userConnected',users.get('player'),false);
  assert.deepEqual(glowing(),[]);
  values.delete('voiceGlow');
  cameras = [];
});

test('initialize asks others to re-announce; voiceHello announces mic status when enabled', () => {
  assert.ok(outbound.some(args=>args[0]==='voiceHello' && args.length===1));
  assert.equal(typeof handlers.get('voiceHello'),'function');
  const voices = () => outbound.filter(args=>args[0]==='voice').length;
  let before = voices();
  handlers.get('voiceHello').call(context('other'));
  assert.equal(voices(),before);
  values.set('voiceGlow',true);
  before = voices();
  handlers.get('voiceHello').call(context('other'));
  assert.equal(voices(),before+1);
  assert.deepEqual(outbound.at(-1)[1],{talking:false,mic:'off'});
  values.delete('voiceGlow');
});

test('voice appearance setting registered; changes update the camera shadow var', () => {
  const data = settings.get('voiceAppearance');
  assert.ok(data);
  assert.equal(data.scope,'client');
  assert.equal(data.config,false);
  assert.equal(data.type,Object);
  const flat = {color:'#51cf66',size:1,brightness:1,opacity:1};
  assert.deepEqual(data.default,{token:flat,camera:flat});
  assert.equal(cssVars.get('--rp-frame-voice-shadow'),'0 0 18px 6px rgb(81 207 102 / 40%)');
  const appearance = {token:flat,camera:{color:'#ff0000',size:2,brightness:1,opacity:1}};
  values.set('voiceAppearance',appearance);
  data.onChange(appearance);
  assert.equal(cssVars.get('--rp-frame-voice-shadow'),'0 0 36px 12px rgb(255 0 0 / 40%)');
  values.delete('voiceAppearance');
});

test('parts are independent: token glow uses the token color, camera var the camera color', () => {
  const lines = [];
  globalThis.PIXI = { Graphics: class { clear() { lines.length = 0; return this; } lineStyle(...args) { lines.push(args); return this; } drawCircle() { return this; } destroy() { this.destroyed = true; } } };
  const tok = { actor:{id:'char'}, w:100, h:100, addChild(){}, removeChild(){} };
  globalThis.canvas = { tokens:{ placeables:[tok] } };
  users.get('player').character = {id:'char'};
  values.set('voiceGlow',true);
  handlers.get('voice').call(context('player'),{talking:true,mic:'ok'});
  assert.ok(lines.length > 0);
  const appearance = {token:{color:'#ff0000'},camera:{color:'#0000ff'}};
  values.set('voiceAppearance',appearance);
  settings.get('voiceAppearance').onChange(appearance);
  assert.ok(lines.length > 0);
  assert.ok(lines.every(args=>args[1]===0xff0000));
  assert.match(cssVars.get('--rp-frame-voice-shadow'),/rgb\(0 0 255 /);
  handlers.get('voice').call(context('player'),{talking:false,mic:'ok'});
  values.delete('voiceAppearance');
  settings.get('voiceAppearance').onChange(settings.get('voiceAppearance').default);
  values.delete('voiceGlow');
  delete users.get('player').character;
  delete globalThis.canvas;
  delete globalThis.PIXI;
});
