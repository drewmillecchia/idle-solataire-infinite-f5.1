# Playtest guide

What to try on the iPad after each session, in the order the game reveals itself, and what to report
back. Feel notes go in `memory/tuning-log.md`; bugs go straight into the conversation with the seed
(the Ledger shows the hand's seed on long-press — coming) or a screenshot.

## First five minutes (a new save)
1. **Deal and drag.** Pick up a run of cards; drag slowly, then fast. Does the tilt read as paper? Does
   the lift feel like the card left the felt? *Tune:* Feel tab → Tap & drag, Tilt.
2. **Drop and miss.** Drop on a legal column; drop on an illegal one; release in empty felt. Every
   release should do *something* (place, shake, return). Silence is a bug.
3. **Throw.** Flick a card at a foundation from across the table. It should curve in and land, or
   slide, slow, and come home. *Tune:* Feel tab → Throw (`throwCatchRadiusPx`, `throwMinPxPerS`).
4. **Tap.** Tap a card with an obvious home: it flies. Tap a king in a column bottom with empty columns:
   it *arms* (lifts, targets glow); tap a target. Tap elsewhere to disarm.
5. **Stock.** Tap draws. Tap the stock when empty: recycle. In Settings, switch Draw three: the waste fans.
6. **Wake the first card.** The chime, the brass star, "A card wakes." The Rate readout starts moving.
7. **Hold the deck.** Press and hold the stock for half a second: it riffles until you let go, and
   pays a trickle proportional to what the deck already earns (so nothing at all until cards are
   awake). This is the ASMR toy — tell me if the loop is the wrong length or the sound wears thin.
8. **New hand.** Watch the riffle. Tap during it to skip. Does the deal speed feel right?
   *Tune:* Feel tab → Flip & deal (`dealIntervalMs`), Settings → Shuffle style.

## The first hour
- **Upgrades** appear one at a time. Hold the Buy button: it should ratchet faster the longer you hold.
- **Win a hand** (or lose quickly and deal again). The cascade should feel like a small celebration,
  not an interruption; the banner must never block the felt.
- **The Auto-Dealer** arrives when the whole deck is awake (or with the Night Shift star later). Leave
  the iPad alone for 12 s: the dealer lifts a card and glows its target before moving. Touch anything:
  it stops instantly.
- **Cut the Deck** reveals when a cut is worth at least one Cut (about 15–20 minutes of engaged play).
  Choose a Way. Watch the ceremony. The deck re-sleeps; the Constellation (Stars) opens.

## The long game (multiple sessions)
- **Stars**: Kept Flame first (cards stay awake through cuts), then Sharper Cut.
- **Deck panel → Marks** after the first cut: place Twin on 5♠ and 5♥ and Kindling on 5♠, then home 5♠
  twice across two hands and watch the neighbours charge.
- **Permute** reveals at 12 cuts performed. Reshuffle, then buy Prime and compare the rate. Switch back.
- **Come back after hours away**: the welcome-back note should state what the deck counted.
- **Reload mid-anything**: the save must come back exactly, ledger included.

## What to report
| Area | Say |
| --- | --- |
| Feel | "Drag lags" / "throw never catches" / "tap threshold too tight" + the Feel Lab values you changed |
| Pacing | When the first upgrade, first cut, and first reshuffle happened, and whether that felt right |
| Confusion | Anything you did not understand without reading a doc |
| Delight | Anything that made you smile; we protect those |
| Bugs | What you did, what happened, what you expected; a screenshot if visual |

## Also worth a look now
- **The window** in the top bar grows stars as the odometer climbs, joins them into constellations at
  intervals, and raises a moon near 52!.
- **Sound**: Settings has a volume slider and a row of test buttons for every sound. Card sounds are
  three layers (paper, edge click, felt thud) and shift pitch per card.
- **Keyboard and screen reader**: press Tab on load for a skip link into an off-canvas set of move
  controls; `n` new hand, `u` undo, `d` draw, `?` shortcuts.
- **Golf and Pyramid** in Settings → Game.

## Known gaps (do not report)
No sound *samples* yet (everything is synthesised); no Ascension; Golf and Pyramid have had no feel
pass on glass; the DynamoDB store is a stub.
