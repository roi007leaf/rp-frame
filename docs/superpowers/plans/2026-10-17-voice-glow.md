# Voice Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft green glow on a player's character tokens and camera tile while they talk, detected from their own mic level in Foundry. No Discord, no audio leaves the machine.

**Architecture:** Pure logic modules (detector, roster, service, glow target selection) take Foundry and browser access through injected host objects, following the repo pattern (`SpeakerHighlight`, `SceneController`). `main.mjs` wires settings, the socketlib `voice` message, hooks and PIXI/DOM rendering.

**Tech Stack:** Foundry VTT 13–14, socketlib, PIXI (Foundry's canvas), Web Audio (`getUserMedia`, `AudioContext`, `AnalyserNode`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-voice-glow-design.md`

**Branch:** work on `feat/voice-glow`, not `main`.

## Global Constraints

- `module.json` compatibility stays `minimum: "13"`, `verified: "14"`. No new dependencies.
- Only a boolean `talking` and a mic status string ever leave the client. Never send, record or store audio.
- Glow colour comes from the existing palette, `#51cf66`.
- The RP turn holder (`speakingUserId(state)`) never gets voice glow. They get only the existing RP ring and `.rp-frame-speaking` outline.
- Tests: `npm test` (`node --test tests/*.test.mjs`) must stay green after every task.
- Setting keys use the module id `rp-frame`. Setting names start with `RP Frame: `, like the existing settings.

## Review Focus

1. **Player opts out, or the GM turns the world switch off, mid-sentence.** The glow must clear on every client and not stick. Covered in Task 3 (`stop() sends talking:false`) and Task 5 (`world switch off clears all glows`).
2. **Tab closed or network dropped while talking.** The glow must clear within the stale window or on disconnect. Covered in Task 2 (`prune drops stale talkers`, `remove clears user`).
3. **RP scene ends while the turn holder is still talking.** Their voice glow must appear right away, because precedence is recomputed on state change. Covered in Task 4.
4. **Mic unplugged mid-session (track `ended`).** Status becomes `unavailable` and `talking:false` is sent. Covered in Task 3.
5. **Player with no assigned character.** Only the camera glows, with no error. Covered in Task 4.

## Constants (used across tasks)

`scripts/voice-roster.mjs` exports these:

```js
export const HEARTBEAT_MS = 3000;   // sender repeats talking:true this often
export const STALE_MS = 9000;       // receivers drop a talker after this long without a refresh
export const MIC = { ok: 'ok', off: 'off', denied: 'denied', unavailable: 'unavailable' };
```

`scripts/voice-detector.mjs` exports these:

```js
export const START_MS = 100, STOP_MS = 500, DEFAULT_THRESHOLD_DB = -45, FLOOR_DB = -100;
```

---

### Task 1: Level detector with hysteresis

**Files:**
- Create: `scripts/voice-detector.mjs`
- Test: `tests/voice-detector.test.mjs`

**Interfaces:**
- Produces: `rmsDb(samples: Float32Array) -> number` (dBFS, clamped to `FLOOR_DB` for silence). `class VoiceDetector { constructor({ threshold = DEFAULT_THRESHOLD_DB, startMs = START_MS, stopMs = STOP_MS } = {}); threshold: number; talking: boolean; sample(db: number, now: number) -> boolean | null; reset() }`. `sample` returns the new `talking` value on a transition, else `null`.

- [ ] **Step 1: Write the failing tests** in `tests/voice-detector.test.mjs`:
  - `rmsDb of silence is the floor`: `rmsDb(new Float32Array(512)) === FLOOR_DB`.
  - `rmsDb of full-scale square is 0`: `Math.round(rmsDb(Float32Array.from({length:512}, (_, i) => i % 2 ? 1 : -1))) === 0`.
  - `starts after 100ms above threshold`: with threshold -45, samples at -30 for t=0,50 return `null`; t=100 returns `true`.
  - `brief spike does not start`: -30 at t=0, -60 at t=50, -30 at t=100 → all `null`, `talking === false`.
  - `lingers 500ms after speech`: once talking, -60 at t=200..650 return `null`; at t=700 (500ms after the first quiet sample at 200) returns `false`.
  - `speech during linger keeps talking`: quiet at 200, loud at 400, quiet from 450 → `false` only at ≥ 950.
  - `threshold change applies to next sample`: set `detector.threshold = -20` while talking at -30 → stops 500ms later.
  - `reset clears talking without emitting`.
- [ ] **Step 2: Run** `node --test tests/voice-detector.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `scripts/voice-detector.mjs`. Track the timestamp when the level first crossed into the opposite state, and clear it when the level returns. `rmsDb = 20*log10(rms)`, clamped to `FLOOR_DB`.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: voice level detector with hysteresis`.

### Task 2: Talking roster

**Files:**
- Create: `scripts/voice-roster.mjs`
- Test: `tests/voice-roster.test.mjs`

**Interfaces:**
- Produces: the constants above, plus `class VoiceRoster { update(userId: string, { talking: boolean, mic: string }, now: number) -> boolean /* changed */; remove(userId) -> boolean; prune(now) -> boolean; talkingIds() -> Set<string>; noMicIds() -> Set<string> /* mic !== MIC.ok */; clear() }`.

- [ ] **Step 1: Write the failing tests:**
  - `update marks talking and refreshes`: `update('a', {talking:true, mic:'ok'}, 0)` → `true`. A repeat at 3000 → `false` (no visible change) but refreshes the timestamp. `talkingIds()` has `'a'`.
  - `prune drops stale talkers`: talking at 0, `prune(9000)` → `false`, `prune(9001)` → `true`, `talkingIds()` empty. The mic status is kept.
  - `heartbeat keeps talker alive`: updates at 0, 3000, 6000 → `prune(14000)` → `false`.
  - `remove clears user`: talking and `mic:'denied'` user → `remove` returns `true`, gone from both sets.
  - `noMicIds lists off/denied/unavailable only`.
  - `garbage payload ignored`: `update('a', null, 0)` and `update('a', {talking:'yes'}, 0)` → `false`, no entry.
- [ ] **Step 2: Run** `node --test tests/voice-roster.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with a `Map<userId, { talking, mic, at }>`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: voice talking roster with stale pruning`.

### Task 3: Mic capture and voice service

**Files:**
- Create: `scripts/voice-mic.mjs`, `scripts/voice-service.mjs`
- Test: `tests/voice-service.test.mjs`

**Interfaces:**
- Consumes: `VoiceDetector`, `rmsDb` (Task 1); `HEARTBEAT_MS`, `MIC` (Task 2).
- Produces:
  - `class VoiceMic { constructor({ mediaDevices, createAudioContext, setInterval, clearInterval, intervalMs = 50 }); start(onLevel: (db) => void, onEnded: () => void) -> Promise<'ok'|'denied'|'unavailable'>; stop(); resume() }`.
    - `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })`.
    - The source is connected to the analyser only, never to `destination`.
    - `NotAllowedError`/`SecurityError` → `'denied'`. Missing `mediaDevices` or any other error → `'unavailable'`.
    - A track `ended` event calls `onEnded`.
    - `stop()` stops every track, clears the interval and closes the context.
    - `resume()` calls `context.resume()` when the state is `'suspended'`.
  - `class VoiceService { constructor(host); update() -> Promise<void>; announce(); stop(); get status(): string; get talking(): boolean }`. The host is `{ enabled(), optedOut(), consented(), askConsent() -> Promise<boolean>, setOptOut(v) -> Promise, setConsent() -> Promise, threshold(), mic: VoiceMic, send(payload: {talking, mic}), now(), setInterval, clearInterval }`.

Service behaviour:
- `update()`:
  - If `!enabled()`, stop with status `off`. This covers the GM turning the switch off.
  - If `optedOut()`, stop with status `off` and send.
  - Else, if not running: when `!consented()`, call `askConsent()`. On `false`, call `setOptOut(true)` and use status `off`. On `true`, call `setConsent()`. Then `mic.start`. Set the status from the result and send `{talking:false, mic:status}`.
  - Concurrent `update()` calls share one in-flight promise, so you never get two prompts.
- Level handling: `detector.threshold = host.threshold()` on every sample. Transitions send `{talking, mic:'ok'}`. While talking, a heartbeat interval re-sends every `HEARTBEAT_MS`. It is cleared on stop or on `talking:false`.
- `onEnded`: status `unavailable`, `talking=false`, send.
- `stop()`: if talking, send `{talking:false, mic:<new status>}`, then `mic.stop()` and `detector.reset()`.
- `announce()` re-sends the current `{talking, mic:status}`.

- [ ] **Step 1: Write the failing tests** using fake `mediaDevices` (resolve or reject with `{ name }`), a fake context/analyser whose `getFloatTimeDomainData` fills from a scripted level, fake timers, and a recorded `send`:
  - `consent asked once, allow stores consent and starts`: `askConsent` called once across two concurrent `update()` calls. `setConsent` called. First send is `{talking:false, mic:'ok'}`.
  - `no thanks opts out and never opens mic`: `getUserMedia` not called. `setOptOut(true)` called. Sends `mic:'off'`.
  - `consented player is not asked again`.
  - `denied permission reports denied`: `getUserMedia` rejects `{name:'NotAllowedError'}` → status `'denied'`, sent. A later `update()` doesn't prompt again (`askConsent` count unchanged).
  - `no mediaDevices reports unavailable`.
  - `loud audio sends talking true then heartbeats`: a transition sends `true`. Advancing 3000ms sends another `true`. Quiet sends `false`, and the heartbeat stops.
  - `stop() sends talking:false`: opt-out while talking → sends `{talking:false, mic:'off'}`. Tracks stopped, context closed.
  - `world switch off while talking sends false and closes mic`.
  - `track ended reports unavailable`: fire `ended` while talking → sends `{talking:false, mic:'unavailable'}`.
  - `mic never connected to destination`: the fake context records `connect` targets, and `destination` isn't among them.
  - `announce resends current state`.
- [ ] **Step 2: Run** `node --test tests/voice-service.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `scripts/voice-mic.mjs` and `scripts/voice-service.mjs` per the interfaces.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: local mic voice service`.

### Task 4: Glow targets, token glow and camera glow

**Files:**
- Modify: `scripts/speaker-highlight.mjs`. Extract `characterTokens(userIds: Iterable<string>, users, tokens) -> token[]`; `speakerTokens` delegates to it. Make `SpeakerHighlight.sync(input)` select through an overridable `targets(input)` method (default: `speakerTokens(input, ...)`), and remove rings through `this.host.detachRing?.(token, ring)`, falling back to the current immediate removal.
- Create: `scripts/voice-glow.mjs`
- Modify: `styles/rp-frame.css`
- Test: `tests/voice-glow.test.mjs`. Existing `tests/highlight.test.mjs` must still pass unchanged.

**Interfaces:**
- Consumes: `speakingUserId`, `SpeakerHighlight`, `characterTokens` (this task); `VoiceRoster` sets (Task 2).
- Produces:
  - `voiceGlowIds(talkingIds: Set, state) -> Set` (talking minus `speakingUserId(state)`).
  - `class VoiceGlow extends SpeakerHighlight` with `targets({ talkingIds, state })`. It glows nothing when `host.enabled()` is false.
  - `createPixiGlow()`, `drawPixiGlow(glow, token)`: radius `max(w,h)/2 + 6`, three concentric strokes in `0x51cf66` at alpha 0.12/0.2/0.35, widths 18/10/4. The ring name is `rp-frame-voice-glow`.
  - `fadeGlow(glow, from, to, ms = 150, done?)` uses `canvas.app.ticker`.
  - `applyVoiceCameras(root, glowIds: Set, noMicIds: Set | null)`: toggles class `rp-frame-voice` on `.camera-view[data-user]` for glow ids. When `noMicIds` is given (GM only), it keeps one `span.rp-frame-nomic.fa-solid.fa-microphone-slash` with title `Voice glow off for this player` on those tiles and removes stale ones.
- CSS: `.camera-view.rp-frame-voice { box-shadow: 0 0 18px 6px rgb(81 207 102 / 40%); transition: box-shadow .2s; }`. Camera views without the class transition back to none. `.camera-view > .rp-frame-nomic` is pinned to the opposite corner from `.rp-frame-badge`, muted grey, `pointer-events: none`.

- [ ] **Step 1: Write the failing tests:**
  - `voice glow skips the RP turn holder`: `voiceGlowIds(new Set(['a','b']), active('a'))` → `{'b'}`. With the scene inactive → `{'a','b'}`.
  - `scene ending reveals the turn holder's glow`: `VoiceGlow.sync` with `active('a')` → no glow on Amiri's tokens. `sync` with `{...active('a'), active:false}` → glow added.
  - `multiple talkers glow at once`: two users with different characters → both token sets glow.
  - `user without a character glows no tokens`: no throw, empty.
  - `disabled host clears glows`.
  - `detachRing used for removal`: the host's `detachRing` receives `(token, ring)`, and the base ring isn't removed directly.
  - `cameras toggle voice class and no-mic marks`: a fake root with two `.camera-view` elements (minimal `classList`, `dataset`, `querySelector`, `append`, `remove`). Glow ids `{'a'}` → only `a` has the class. noMic `{'b'}` → one mark on `b`. A second apply with an empty set removes it. `null` noMic → no marks at all.
  - Existing `highlight.test.mjs` passes, which shows the refactor kept its behaviour.
- [ ] **Step 2: Run** `node --test tests/voice-glow.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the refactor in `speaker-highlight.mjs`, then `scripts/voice-glow.mjs` and the CSS.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: voice glow on tokens and camera tiles`.

### Task 5: Settings, consent, sensitivity window and wiring

**Files:**
- Create: `scripts/voice-sensitivity-app.mjs`. It's an ApplicationV2, lazily created like `avatar-frame-app.mjs`.
- Modify: `main.mjs`, `tests/standalone.test.mjs` and `tests/runtime.test.mjs` (add `registerMenu: () => {}` to the `game.settings` stubs, and stub `navigator.mediaDevices` as absent), `README.md`, `CHANGELOG.md`.
- Test: extend `tests/runtime.test.mjs`.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Settings (exact):
  - `voiceGlow`: world, config, Boolean, default `false`. Name `RP Frame: voice glow`. Hint `Players' character tokens and camera tiles glow while they talk. Each player's browser measures their own mic level; no audio is sent or recorded.` `onChange` → `voice.update()` + render.
  - `voiceOptOut`: client, config, Boolean, default `false`. Name `RP Frame: don't use my mic for voice glow`. `onChange` → `voice.update()`.
  - `voiceShow`: client, config, Boolean, default `true`. Name `RP Frame: show voice glow`. `onChange` → render.
  - `voiceConsent`: client, hidden, Boolean, default `false`.
  - `voiceThreshold`: client, hidden, Number, default `DEFAULT_THRESHOLD_DB`.
  - Menu `voiceSensitivity`: name `RP Frame: voice glow sensitivity`, label `Adjust`, icon `fa-solid fa-microphone-lines`, restricted `false`, type: the sensitivity app class.
- Consent dialog: `foundry.applications.api.DialogV2.confirm`. Title `Voice glow`. Content `<p>Your GM turned on voice glow: your character's token glows while you talk.</p><p>Foundry will listen to your mic's <strong>volume level only</strong>. Nothing is recorded or sent; only "talking / not talking" is shared.</p>`. Yes label `Allow`, no label `No thanks`. Closing the dialog counts as no.
- Sensitivity app:
  - A range input from -80 to -10 dB (step 1), bound to `voiceThreshold`, and a live meter bar showing the current `rmsDb` with a marker at the threshold. The meter turns green while the detector would be talking.
  - Uses its own `VoiceMic` while open, stopped on close. When the world switch is off it shows `Voice glow is off for this world.`
  - Saving writes the setting. The service reads `threshold()` per sample, so changes apply live.
- Wiring in `main.mjs`:
  - `roster = new VoiceRoster()`. `socket.register('voice', function(payload) { if (roster.update(sender(this), payload, Date.now())) renderVoice(); })`.
  - `voice = new VoiceService({ ..., send: payload => socket.executeForOthers('voice', payload) })`, created in `initialize()`, then `void voice.update()`.
  - `renderVoice()`: when `setting('voiceGlow') && setting('voiceShow')`, glow ids = `voiceGlowIds(roster.talkingIds() ∪ (voice.talking ? {self} : ∅), controller.state)`. Otherwise use an empty set. Then `voiceGlow.sync({ talkingIds, state })` and `applyVoiceCameras(document, ids, game.user.isGM && setting('voiceGlow') ? roster.noMicIds() : null)`.
  - Local transitions also call `renderVoice()`, so the speaker sees their own glow.
  - Call `renderVoice()` from `refresh()`.
  - Existing `poll` interval: `if (roster.prune(Date.now())) renderVoice()`.
  - `userConnected` hook: `(user, connected)`. On `!connected`, call `roster.remove(user.id)` and render. On connect, call `voice.announce()`.
  - Hooks: `canvasTearDown` also calls `voiceGlow.reset()`. `refreshToken` also calls `voiceGlow.redraw(token)`. The first `pointerdown`/`keydown` on `document` → `voice.mic.resume()`. `pagehide` → `voice.stop()`.

- [ ] **Step 1: Write the failing tests** in `tests/runtime.test.mjs`:
  - `world switch off clears all glows`: with roster entries talking, flipping the `voiceGlow` setting value to false and calling `refresh()` → no `.rp-frame-voice` cameras.
  - `voice socket from another user renders glow`: invoke the registered `voice` handler with context `{ socketdata: { userId: 'player' } }` → that player's camera gets `rp-frame-voice`.
  - `settings registered`: all five keys plus the `voiceSensitivity` menu exist.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL, and existing ones PASS once the stubs are updated.
- [ ] **Step 3: Implement** the settings, sensitivity app and wiring per the interfaces.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Manual check in Foundry** (GM + one player browser):
  - Enable `RP Frame: voice glow` → the player gets the consent dialog, then the browser mic prompt.
  - Talking → a soft glow on the player's token and camera, visible on the GM screen. It stops about 0.5s after they stop talking.
  - Start an RP scene with that player as speaker → only the solid RP ring shows while they talk. End the scene while they're talking → the voice glow appears.
  - Player opts out → the glow is gone and the GM sees the muted-mic mark.
  - Sensitivity window → the meter moves and the threshold changes apply live.
- [ ] **Step 6: Docs.** Add a README section "Voice glow" covering what it does, that it's GM-enabled, the privacy line, sensitivity, opt-out, and the push-to-talk caveat. Add a CHANGELOG entry under Unreleased.
- [ ] **Step 7: Commit** `feat: voice glow settings, consent and wiring`.
