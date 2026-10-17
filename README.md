# RP Frame

Shared roleplay scenes with optional StoryFrame integration. Requires socketlib; Foundry VTT 13–14.

## Use

Enable **RP Frame** and **socketlib** in Manage Modules. StoryFrame is optional. Disable Raise My Hand's RP queue (or that module) to avoid overlapping controls and banners. RP Frame has its own settings and socket namespace; it does not change either existing module.

- Players click **RP Frame — join scene** to request a scene. The GM clicks **start scene** to approve the queue and give the first participant the spotlight.
- During a scene, players join/leave, flag an urgent request, finish speaking, or delay their turn. Finishing moves the speaker to the back and advances the next participant, urgent first. Finishing as the last participant ends the scene.
- GMs use **start scene** / **end scene** in token controls. Click a queue chip to choose; right-click to remove.
- The speaker banner shows **You are speaking** or **Name speaks**. When the GM socket is unavailable, the same banner keeps its portrait and queue and reads **Waiting for GM**. No waiting banner remains after the scene ends.
- Drag the banner to move it; drag its corner to resize. Layout and visibility are per client. Queue badges appear beside player names and on cameras.
- Scenes persist through GM refresh. Offline participants are retained so a refresh does not reorder the queue. Commands wait for a ready GM socket; slow heartbeat replies have a five-second deadline.
- Combat automatically ends RP scenes by default. Disable this in RP Frame settings if desired.

Default shortcuts, editable in Foundry's **Configure Controls**: **H** requests/leaves the queue, **X** toggles urgent speak, **Space** takes/finishes spotlight (GM: approve/end scene), and **Shift+Space** delays your speaking turn. H cannot remove the active speaker; use Space to finish.

## StoryFrame integration

With StoryFrame active and **follow StoryFrame spotlight** enabled, RP Frame highlights an existing visible StoryFrame speaker matching the participant's assigned character or user ID. Add characters to StoryFrame first. RP Frame does not create/delete StoryFrame speakers or replace journals. Ending the scene restores the prior spotlight, unless the GM independently selected another speaker.

## API

`game.modules.get('rp-frame').api` exposes `getState()`, `isGmConnected()`, `start()`, `end()`, `join()`, `finish()`, `urgent()`, and `command(type, userId)`. With StoryFrame active, the same API is available at `game.storyframe.rpFrame`. Commands authenticate the actual socket sender; GM operations are rejected for players. `rpFrameStateChanged` receives a copy of each applied scene snapshot.

## Development

Run `npm test` or `node --test tests/*.test.mjs`. State, persistence ordering, authenticated socket commands, GM connection races, speaker presentation, and StoryFrame integration are independently testable.

This module is a new implementation of the RP scene behavior developed for the local Raise My Hand fork. It does not import or require Raise My Hand's code, assets, settings, or sockets.
