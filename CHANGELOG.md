# Changelog

## Unreleased

- Add optional voice glow: while the GM enables it, talking players' character tokens and camera tiles glow green. Each browser measures only its own mic level locally; only talking / not talking is shared, never audio. Includes player consent, opt-out, a per-client show toggle, a sensitivity meter, and a GM-only muted-mic mark.

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
