# Observer camera control audit — six independent degrees of freedom

The Observer and Experiment cameras are free-flight views in a real 3D world. Player input affects only presentation and camera state, not the deterministic ecology. Existing mouse, touch, and gamepad controls remain intact.

## Standard 3D navigation coverage

| Degree of freedom | Controls | Implementation |
|---|---|---|
| Translate forward/backward | W / S (also Up/Down arrows) | Existing camera-relative horizontal movement with pitch-dependent climb/dive |
| Translate left/right (strafe) | A / D (also Left/Right arrows) | Existing horizontal strafe |
| Translate up/down | Space / Q (or left Control); gamepad triggers; touch buttons | Existing vertical movement, clamped above ground/water and below world ceiling |
| Yaw (turn left/right) | Drag mouse / captured mouse / right gamepad stick / J / L | Existing mouse/gamepad plus keyboard |
| Pitch (look up/down) | Drag mouse / captured mouse / right gamepad stick / I / K | Existing mouse/gamepad plus keyboard, with clamped pitch |
| Roll (bank/tilt horizon) | U / O | NEW: observer/experiment bank about camera viewing axis; preserved through save/load, reset by B |

Other gameplay-style camera controls:
- Shift: faster movement
- Mouse wheel: fly-speed adjustment in free flight; orbit-distance adjustment while following wildlife
- **Alt + wheel: optical zoom** (changes perspective field of view between 24° and 85°), without changing flight speed or follow distance
- B: level camera (roll 0) and restore default 62° optical field of view, without changing yaw or pitch
- Click: pick an animal; G: follow and orbit that subject; C: pointer-lock mouse look; Escape: leave pointer lock/open menu
- Touch: left thumb move, right thumb look; gamepad: left/right sticks, triggers for vertical flight

**Navigation model:** The observer retains world-up movement for comfort, even when banked. Roll changes viewing orientation, not gravity or the direction of strafing; this is a cinematic free-fly camera, not a spacecraft physics controller. Animal-follow orbit and wildlife modes intentionally level the camera instead of using bank. Avoid inadvertent roll in scripted Curiosity camera paths.

## Implementation and compatibility

- Keyboard look is frame-time-scaled and additive to existing mouse/gamepad look deltas.
- Roll is applied in camera-local coordinates after the existing `camera.lookAt` orientation.
- Optical zoom updates the perspective projection matrix and is independent of existing wheel-controlled speed and follow distance.
- New camera data (`roll`, `fov`) is optional in save snapshots; previous saves load with 0 roll and 62° FOV. The ecological save version does **not** change.
- Tests run in a paused actual game to verify yaw, pitch, roll, lens zoom, level/reset and unchanged `Simulation.stateHash()`.

## Remaining optional features, not part of this change

An RTS/editor-style pan via middle-mouse drag, customizable sensitivities/keybinding profiles, configurable inverted Y-axis and gamepad roll bindings would be separate UX improvements. Six independent degrees of freedom do not require these to be present.

**Merge rule:** Draft PR for owner review. Verify controls and save/load on desktop and at least one touch device before production merge. This is independent of rendering PR #22 and ecology work.
