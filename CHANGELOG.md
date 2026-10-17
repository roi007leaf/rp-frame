# Changelog

## 0.2.0 (prerelease)

- Add optional voice glow: while the GM enables it, talking players' character tokens and camera tiles glow green. Each browser measures only its own mic level locally; only talking / not talking is shared, never audio. Includes player consent, opt-out, a per-client show toggle, a sensitivity meter, a per-client glow appearance window (color, size, brightness, opacity), and a GM-only muted-mic mark.
- Put all voice glow settings in one **RP Frame: voice glow** window (Table, My mic, What I see) instead of separate settings and windows. The mic meter now runs only while you press **Test mic**.
- Give the token glow and the camera glow separate appearance settings (**Token glow** and **Camera glow** under What I see), each with its own preview and reset. An existing single appearance is used for both.

## 0.1.0 (prerelease)

First public prerelease.

- Introduce RP Frame as a standalone module with optional StoryFrame integration.
- Add player scene requests, GM approval, speaking queues, urgent requests, turn delay, and GM queue management.
- Preserve editable H/X/Space/Shift+Space RP shortcuts.
- Persist scenes through refresh and show Waiting for GM inside the current speaker banner while its socket is unavailable.
- Add draggable/resizable speaker banners and player/camera queue badges.
- Highlight the current speaker's camera and tokens in green.
- Add camera portrait framing for players without video.
- Follow existing StoryFrame character spotlights and restore the prior spotlight when RP ends.
