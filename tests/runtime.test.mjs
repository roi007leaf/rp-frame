import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const hooks = new Map(), settings = new Map(), handlers = new Map(), outbound = [];
let saved = {}, authority = 'gm', timer;
const users = new Map([['gm',{id:'gm',isGM:true}],['other',{id:'other',isGM:true}],['a',{id:'a',isGM:false}],['b',{id:'b',isGM:false}]]);
Object.defineProperty(users,'activeGM',{get:()=>users.get(authority)});
globalThis.Hooks = { once:(name,callback)=>hooks.set(name,callback), on:()=>{}, callAll:()=>{} };
globalThis.document = { body:null };
globalThis.game = {
  ready:false, user:users.get('gm'), users, combats:[],scenes:{current:{id:'scene'}},
  modules:new Map([['storyframe',{active:true}],['rp-frame',{}]]),storyframe:{},
  settings:{register:(_module,key,value)=>settings.set(key,value),get:(_module,key)=>key==='scene' ? saved : settings.get(key)?.default,set:async(_module,key,value)=>{if(key==='scene')saved=structuredClone(value);}}
};
globalThis.ui = {controls:{render:async()=>{}},notifications:{warn:()=>{},error:error=>{throw Error(error);}}};
globalThis.socketlib = { registerModule:module=>{assert.equal(module,'rp-frame');return {
  register:(name,fn)=>handlers.set(name,fn),executeForOthers:(...args)=>outbound.push(args),executeForAllGMs:(...args)=>outbound.push(args),executeForUsers:(...args)=>outbound.push(args)
};}};
const nativeInterval = globalThis.setInterval;
globalThis.setInterval = callback => {timer=callback;return 1;};
const runtime = await import('../rp-frame.mjs');
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
  const source=await readFile(new URL('../rp-frame.mjs',import.meta.url),'utf8');
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
