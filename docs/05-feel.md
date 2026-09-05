# Feel specification

Feel is pillar #2 and it is *configuration* (ADR-011). Every constant below is a key in
`src/content/feel.json`, editable live in the **Feel Lab** dev panel, and exportable. This document
says what each does and what "good" feels like so tuning has a target.

## Principles

1. **1:1 during the gesture.** The card is under the finger the whole way. Any lag is deliberate
   "weight", small (≤ 40 ms equivalent), and tunable.
2. **Springs, not durations.** Every settle is a spring parametrised by `response` (s) and
   `dampingRatio`. Bounce only where momentum came in.
3. **Down is the moment.** Selection feedback, lift, haptic tick, and sound all fire on `pointerdown`,
   not on release.
4. **No dead input.** `touch-action: none` on the canvas; no tap delay; no debounces on the input path.
5. **Every input is acknowledged.** An illegal drop still *does* something: a soft shake and a return
   spring. Silence is a bug.
6. **Reduced motion is honoured.** OS preference and a manual override collapse springs to fast
   critically-damped settles and disable tilt/particles; the game stays fully playable.

## Cards

### Select / pick up
- `tapMaxMs` 220, `dragThresholdPx` 6 (device-pixel aware): under both → tap; over distance → drag.
- On down: lift spring to `liftScale` 1.06 with `liftResponse` 0.12 s, `shadowLiftPx` 14, haptic
  `tick` (light), sound `pick` (very quiet paper slide, velocity 0).
- A run (multiple cards) lifts as one body with a slight per-card lag `runLagMs` 12 so the tail
  trails — reads as physical.

### Drag
- Position follows pointer through a `followSpring` (`response` 0.04, `dampingRatio` 1.0). At the
  default it is imperceptible lag that kills jitter; raise response for a "heavy" card.
- **Tilt**: rotation = clamp(velocity.x × `tiltGain` 0.0009, ±`tiltMaxRad` 0.18), damped by
  `tiltResponse` 0.15. Cards lean into movement like paper does.
- Valid drop targets glow (`targetGlowAlpha` 0.35) and the nearest valid target *breathes* slightly
  larger (`targetMagnetScale` 1.02) when within `magnetRadiusPx` 60.
- Drop targets span a pile's **whole occupied extent** (lesson from prior builds).

### Drop
- On up: if pointer is over a valid target → **place**: spring to slot (`placeResponse` 0.18,
  `dampingRatio` 0.82 — a whisper of bounce because momentum arrived), shadow drops to 0, sound
  `place` scaled by approach speed, haptic `soft`.
- If not over a target but release velocity > `throwMinPxPerS` 900 → **throw** (below).
- Else → **return**: spring home (`returnResponse` 0.28, `dampingRatio` 0.9) with a one-cycle
  shake (`illegalShakePx` 4) if a target was *attempted*; sound `slideBack`.

### Throw
Tossing is part of the charm and is allowed to be a *little* silly.
- Release velocity `v` → projectile with friction `throwFriction` 0.985/frame (60 fps-normalised)
  and spin from tilt. If the projected path passes within `throwCatchRadiusPx` 70 of a **valid**
  target, the card is caught: it curves in (`catchResponse` 0.22) and places with a louder `place`.
- If no valid target lies on the path, the card slides, slows, then springs home (`return`).
- Throws never move a card somewhere illegal. They are a faster, more expressive way to make a legal
  move — never a cheat.

### Tap-to-move
A tap on a movable card auto-moves it to the best legal target (foundation preferred) with a
`autoMoveResponse` 0.22 flight along a slight arc (`arcHeightPx` 24). Double-tap does the same to
avoid the “did that register?” doubt. Tap on the stock draws.

### Flip
Face-down → face-up is a 3-D-ish flip via `scale.x` through 0 with a `flipResponse` 0.16 and a
`flipLift` 1.04; sound `flip` (a short crisp paper snap), no haptic.

### Deal
Cards leave the stock one per `dealIntervalMs` 38 along arcs, land with `place` at low velocity and
a brief tilt. The deal's total time (~2 s for 28 cards) is skippable by tapping.

### Shuffle (ASMR set piece)
Styles, each a choreography over all 52 sprites + a synthesised soundscape:
- **Riffle**: split, interleave in two arcs, square up. `riffleDurationMs` 1100.
- **Overhand**: chunks drop from the top hand to the bottom hand. 1400 ms.
- **Hindu** and **Faro** later; **Cascade / bridge** as the flourish after a riffle.
Shuffles play on new hand (style chosen in settings or random), on Cut the Deck (a slow ceremonial
riffle), and in **Idle Riffle** — hold the deck to riffle continuously for a tiny trickle of shuffles
(a meditative toy, from the v1 workshop notes).

## Buttons and controls

- **Press**: down → scale `btnPressScale` 0.96 with `btnPressResponse` 0.08; up → spring back with
  `dampingRatio` 0.7 (a small bounce, because a press is momentum). Haptic `tick` on down.
- **Hold-to-repeat** (buying upgrades, adding charge, anything countable): first repeat after
  `holdInitialMs` 400; the interval then follows an ease curve from `holdStartHz` 3 to `holdMaxHz` 20
  over `holdRampMs` 1800. Each repeat gives a haptic `tick` whose intensity fades as rate rises,
  and a sound `tick` whose pitch climbs slightly with rate (satisfying ratchet). Releasing gives a
  final `soft` haptic. Multi-buy amount grows with hold rate (×1 → ×10 → ×100) with visible steps.
- **Toggle**: a small slide with `toggleResponse` 0.14, `dampingRatio` 0.75.
- **Long-press**: 450 ms → contextual info (card detail, mark placement) with a `soft` haptic.

## Haptics
`navigator.vibrate` on Android; iOS Safari has no vibration API — we use the `<input type="switch">`
haptic trick where available and otherwise rely on sound + motion. Patterns: `tick` 8 ms, `soft`
15 ms, `thud` 25 ms, `success` [10, 40, 15]. All behind one `HapticPresenter`.

## Sound hooks (see ADR-013)
`pick`, `slide`, `place`, `slideBack`, `flip`, `deal`, `tossLand`, `riffle`, `square`, `tick`,
`chime` (wake), `bloom` (win). Every sound takes `velocity` 0..1 and gets a random pitch jitter
±`pitchJitter` 0.04 so nothing sounds sampled twice.

## Tuning workflow
1. Open Feel Lab (dev build, `?feel=1` or the ⚙ → Feel).
2. Sliders bind to `feel.json` keys live; a "throw test" mini table is included.
3. "Export" copies JSON; paste into `src/content/feel.json`; commit with a note on what changed and why.
4. Real-device pass on the iPad after each tuning session — drag feel on glass is not judgeable headlessly.
