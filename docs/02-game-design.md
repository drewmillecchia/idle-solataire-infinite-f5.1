# Game design

This is the design contract. Numbers here are targets the balance simulator asserts; when a number
moves, it moves here first and deliberately.

## 1. The counter

The game's score is **arrangements witnessed**, informally *shuffles*. The goal line is 52!.

- `lifetimeShuffles` — monotonic, never decreases through any reset. This is the **odometer** and
  drives milestones, the sky, and the journey bar.
- `shuffles` — the spendable balance. Buying things spends this, never the odometer.
- `deckRate` — shuffles/second, the sum of every awake card's output.

Milestones are real magnitudes with a one-line ledger entry (see `brainstorming/milestones.md`):
1e6 "a small town's worth of hands", 1e9, 7.5e18 grains of sand on Earth, 1e21, 7e27 atoms in a
human body, 1e40, 1e50 atoms in the Earth, 1e57, **8.07e67 = 52!**, and beyond after Ascension.

## 2. Cards are generators

Each of the 52 cards has a state: `awake`, `charge` (integer level), `marks` (see §4).

- A card produces **nothing** until it has been played to a foundation once. Then it is awake.
- `output(card) = rankValue(card.rank, numbering) × suitMult(card.suit) × chargeMult(card.charge) × marks(card) × global`
- **Playing a card home again** (any later hand) adds **charge**: `chargeMult = 1 + 0.1 × charge`
  (soft-capped later by Ways). This is the relaxer's whole progression system without a single menu:
  play hands → cards charge → the number climbs faster.
- Tableau moves (not home) give a tiny **spark** (one-off shuffles) so every move feels acknowledged.
- **Winning a hand** pays a **burst**: 60 s of `deckRate` × burst multipliers, plus a
  celebration. Both the player and the Auto-Dealer route wins through the same function.

The first quiet goal a new player finds alone: *wake the whole deck.* 52 steps; the tutorial.

## 3. Numbering systems (value shape)

The rank→value map. Every system is **normalized to the same deck total**, so switching
redistributes value rather than adding it; which system wins depends on which cards you have
charged and marked.

`Natural (A=1..K=13) → Prime → Triangular → Fibonacci → Powers of 2 → Factorial → Tetration`

Unlocked with Permutations (layer 2). Later Ascension decks add ranks and the normalization extends.

## 4. Marks — placed powers that combine

The build system. **Deterministic, placed, limited.** No shop, no draw, no inventory.

- A Mark is a rule attached to a card, a rank, or a suit: *when X happens, Y follows*.
- Marks are **unlocked** on the Constellation (§6) and **placed** by the player on specific cards.
- **Slots** limit how many marks are placed at once (start 1, grow with layers). Re-placing is free
  between hands; this is the aficionado's toy and the relaxer can ignore it entirely.
- Marks fire on engine events (`card-home`, `card-woken`, `hand-won`, `charge-gained`, `tick`), and
  many produce *further* events, so chains emerge:

| Mark | Rule | Combines with |
| --- | --- | --- |
| **Echo** | When this card comes home, the next card of the same rank to come home this hand pays ×2 spark and +1 charge. | Twin, Kindling |
| **Kindling** | When this card gains charge, its rank-neighbours (±1) in the same suit gain +1 charge. | Twin (chains across suits), Echo |
| **Twin** | Two cards are entangled: when one wakes or gains charge, so does the other. | Everything — Twin is the wire |
| **Lantern** | While awake, this card multiplies its whole suit ×1.5. Lanterns stack multiplicatively. | Anchor (keep it through a cut) |
| **Anchor** | This card keeps its charge and wake state through Cut the Deck. | Lantern, high-charge cards |
| **Wild** | *Rules twist:* in the tableau this card may be placed on any card. | Any — makes deals easier, feeds everything |
| **Mirror** | *Rules twist:* this card counts as both colours. | Wild-lite for Klondike/Spider |
| **Glass** | *Rules twist:* this card is dealt face-up even where the game deals face-down. | Planning |
| **Heavy** | Tableau moves of this card count as a home play for charge (not for waking). | Echo/Kindling engines |
| **Tithe** | This card's output is 0, but every other card of its suit gets +25%. | Lantern stacking |

Design rules for Marks: each is one sentence; each has a visible glyph on the card; each has at
least one *interesting* partner; no Mark is strictly best. Rule-twist Marks are how "special cards
put twists into the games" happens *without* changing the deck's identity.

## 5. Ways — how you play the next run

Chosen at each **Cut the Deck**. A Way reshapes the run and gives it a mood. Ways are the
"multiple progression paths": the Constellation has a branch per Way, and permanent unlocks in a
branch make that Way stronger, so a player can specialise or rotate.

| Way | Run mood | Mechanics |
| --- | --- | --- |
| **Way of the Hand** | Active, sharp | Home plays pay ×3 spark; charge caps higher; Auto-Dealer disabled; win burst 120 s. |
| **Way of the Dealer** | Idle, watchful | Auto-Dealer unlocked from minute one and faster; idle rate +50%; home plays pay ×0.5 spark. |
| **Way of the Gambler** | Variance | Every hand rolls a 0.5×–3× run multiplier on deal; wins re-roll upward; Marks may misfire (fizzle) 10%. |
| **Way of the Scholar** | Puzzle | Deals are always winnable (solver-checked); undo unlimited; charge gain ×0.7 but every *win* also charges the whole deck +1. |

A Way is not a class; it is a lens for one run. The first cut offers Hand and Dealer; others reveal.

## 6. Prestige layers

### Layer 1 — Cut the Deck → **Cuts**
Trade the run (balance, run upgrades, most charge; Anchored cards keep theirs) for Cuts.
- Multiplier reads **lifetime Cuts**: `cutMult = (1 + lifetimeCuts)^1.5`.
- The cut threshold **scales with the full current multiplier**, so a cut measures progress *within*
  the run; measuring absolute earnings diverges (a prior build hit 1e3838 in four sim-hours).
- Reward is a quarter-power of the overshoot (`CUT_EXPONENT = 0.25`).
- Cuts buy nodes on the **Constellation** — the permanent tree, with a branch per Way plus a trunk
  (Mark slots, offline cap, Auto-Dealer speed, starting charge).
- A cut is a ceremony: the deck is squared, cut, and re-spread; the lamp flickers; the window gains a star.

### Layer 2 — Reshuffle → **Permutations**
Trades *every cut ever made* for Permutations, which buy Numbering Systems and Mark slots.
Revealed after 12 lifetime cuts (behavioural trigger, not a number). A fresh cycle is seeded with
Cuts so it runs shorter than the last. Same two anti-divergence invariants.

### Layer 3 — Ascend at 52! → **a new deck**
Reaching 52! *once* (lifetime) opens Ascension. Each Ascension adds a card or a suit:
first a **Joker** (53!), then a fifth suit **Stars ★** (65! with 13 ranks)… The odometer target
grows factorially; games gain variant rules for the new cards (a Joker is Wild by nature; Stars are
a third colour). This is why the title says *Infinite*. Ascension is designed in
`brainstorming/ascension.md`, built after everything above is solid.

## 7. Automation — the Auto-Dealer

- Waits `autoDealerDelay` (12 s default) of no input, then plays visibly, one move per beat, with a
  hint-glow a beat before each move so watching it is *something*.
- Any `pointerdown` resets the timer. Credit accrues through the wait (capped at one delay) so
  politeness never costs throughput.
- Plays greedy-with-lookahead; wins ~8–15 % of Klondike hands; unlocked early in Way of the Dealer,
  later otherwise.

## 8. Offline

`applyOffline` slices the elapsed time and calls the **same `step`** the live loop uses. Cap 8 h base,
Constellation extends to 24 h. Welcome-back is a non-blocking ledger entry, not a modal.

## 9. Pacing contract (sim-asserted)

| Target | Value |
| --- | --- |
| Time to first awake card | < 90 s from first launch |
| Reveals in first minute | ≤ 3 |
| Whole deck awake | inside the first run |
| First Cut (engaged sim player) | 12–30 min |
| Cuts per hour, mid-game | 3–6 |
| Run-upgrade tier exhausted | ~2 h engaged |
| Reshuffle reveal | ~12 cuts (≈ 3–4 h engaged) |
| Relaxer, 3 hands/day, no panels | still sees a new milestone at least every 2–3 days for the first month |
| No economy divergence | 24 sim-hours engaged, finite |

The sim player is a perfect greedy buyer; humans run slower. A failing pacing test is a decision,
never a silent widening.

## 10. What a hand pays (summary)

| Event | Pays |
| --- | --- |
| Tableau move | spark = 1 s of deckRate × 0.05 (min 1) |
| Card home (first time) | wake → permanent output |
| Card home (again) | +1 charge; spark = 1 s of deckRate × 0.25 |
| Hand won | burst = 60 s of deckRate × burstMult |
| Stock exhausted / stuck | nothing; "new hand" is always one tap away and never costs |
