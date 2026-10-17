# Voice Glow — design

## Intent

GMs running pf2e scenarios for strangers hear players in Discord but watch Foundry. They can't tell whose voice belongs to which character. Voice glow puts a soft green glow on the talking player's character tokens and camera tile, so the GM can match voice to character without leaving the table.

The request came from a Discord user who asked for "Discord integration that highlights speaking tokens." We chose **not** to integrate with Discord. Reading Discord's voice state needs either a hosted bot or the approval-gated `rpc.voice.read` scope. Instead, each player's Foundry client measures their own mic level locally and broadcasts only "talking / not talking". This works with any voice app.

## Goals

- While the GM has it on, a player's character tokens and camera tile glow while that player talks.
- Works all the time (exploration, combat, downtime), not only during RP scenes.
- Several players can glow at once.
- Each player tunes their own sensitivity.
- Players can decline or opt out without being nagged.

## Non-goals

- Any Discord connection (bot, RPC, StreamKit).
- Sending, recording or storing audio. Only a boolean leaves the client.
- Matching Discord push-to-talk. A PTT player may glow while muttering without transmitting. This is accepted.
- Glow anywhere besides tokens and camera tiles (no player list, banner or chat).
- Automatic calibration.

## Anti-goals (failure even if it "works")

- Any audio leaving the player's machine.
- Flicker between words, or a glow that never turns off.
- Repeated permission prompts or nagging players who said no.
- Voice glow competing with the RP Frame turn ring on the same token.

## Behaviour

### Who turns it on

- **World setting, GM-only, default off:** "RP Frame: voice glow". Turning it on or off applies live, with no reload.
- Once it's on, each non-opted-out client starts detection. Before the browser mic prompt, the player sees a one-time Foundry dialog: what it does, that only levels are measured and nothing is recorded or sent, and **Allow** / **No thanks**. *(My call: this protects trust with strangers.)*
  - **No thanks** sets the player's opt-out setting. No further prompts.
  - Browser permission denied: no glow for that player, no retry nagging.
- **Client setting, opt-out**, in the player's own module settings, so they can change their mind either way.
- **Consent remembered:** clicking **Allow** stores a hidden client setting, so the dialog never shows again on that browser. *(My call.)*
- **Display toggle:** a separate client setting, "Show voice glow" (default on), hides other people's glow on this screen. It's independent of the opt-out (which stops *your* mic) and of the existing `tokenHighlight` setting. *(My call.)*
- The GM's own mic is included like any user's. *(My call: the GM has a camera tile too. A GM usually has no assigned character, so only the camera glows.)*

### "No mic" mark

When a player has opted out, denied permission or has no mic, the **GM** sees a small muted-mic mark on that player's camera tile, so they know why nobody glows. Players don't see it. *(My call.)*

### Sensitivity

- **Per player, client setting:** threshold slider.
- Opened from a settings menu button ("Voice glow sensitivity") as a small window with the slider and a **live level meter** showing where the threshold sits and when they'd glow. Saving applies immediately.
- The default should suit a typical headset mic in a quiet room. The builder picks the number.

### Detection (client side)

- `getUserMedia({ audio })` → `AudioContext` → `AnalyserNode`. Sample the level about every 50 ms. Never connect to the output, and never send the stream anywhere.
- Hysteresis so the glow doesn't flicker:
  - Start: level above threshold for about 100 ms.
  - Stop: level below threshold for about 500 ms (the "linger").
- The `AudioContext` may start suspended (autoplay policy). Resume it on the first user click or keypress.
- Stop all tracks and close the context when the world setting turns off or the player opts out.
- The builder decides whether to enable browser noise suppression or turn off auto gain. Pick whatever makes the meter most predictable.

### Broadcast

- Send through the existing socketlib registration, on **transitions only**: `voice(talking: boolean)` to all other clients. The sender id comes from socketlib's context, as for existing commands.
- Every client keeps a set of talking user ids.
- **Stale safety:** while talking, the sender repeats `true` every few seconds. Receivers drop a user who has been "talking" for longer than about 3× that interval without a refresh. Also clear a user when they disconnect (`userConnected` hook). The builder picks the exact intervals.
- The "no mic" status (opted out / denied / unavailable) is broadcast too, so the GM can draw the mark. Each client re-sends its current status (talking and mic status) when another user connects, so a GM who reloads or joins late sees correct marks. *(My call.)*

### Rendering

- **Tokens:** every canvas token whose actor is the user's assigned character, using the same matching as `speakerTokens` in `scripts/speaker-highlight.mjs`.
  - Look: green from the existing palette (`#51cf66`), but softer and wider than the RP ring, fading in and out with speech so the two read differently at a glance. *(My call.)*
- **Camera tiles:** a CSS class on `.camera-view[data-user]` with a soft green `box-shadow` and a transition. It's distinct from `.rp-frame-speaking`, which has a solid outline.
- **Precedence:** if a user holds the RP turn in an active RP scene (`speakingUserId(state)`), they get only the existing RP ring and camera outline. Voice glow is suppressed for them. Other users talking during the scene still get voice glow. *(The user decided this.)*
- Re-sync when the talking set, RP state, canvas tokens or the camera dock change. Survive canvas teardown the same way `SpeakerHighlight.reset()` does.

## Constraints

- Foundry 13 minimum, verified on 14 (`module.json`). Requires socketlib, which is already a dependency.
- Follow the repo's pattern: pure logic in `scripts/*.mjs` with Foundry and browser access injected through a host object (see `SpeakerHighlight`, `SceneController`), wired up in `main.mjs`.
- Unit tests use `node --test tests/*.test.mjs`. Test the detector hysteresis (fed level samples plus a fake clock), the talking-set/stale logic, precedence, and token selection without a browser.
- Update the README and CHANGELOG.

## Left to the builder

- File and class names, default threshold, intervals, exact glow animation.
- Whether to reuse Foundry's own A/V mic stream when the user is already streaming audio through Foundry A/V (it would avoid a second capture).
- Level metric (RMS vs. peak, dB scaling for the slider).
