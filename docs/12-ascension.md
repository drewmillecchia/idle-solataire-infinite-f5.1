# Ascension — the layer that makes 52! a landing, not an ending

Design and the refactor it needs. Nothing here is built yet. Promoted from
[`brainstorming/ascension.md`](../brainstorming/ascension.md), which keeps the wilder variants.

## The idea

Reaching **52!** once (lifetime, not per run) opens **Ascension**: you trade everything for a deck that
has never existed. The odometer's target grows with the deck, so the journey restarts against a bigger
number — which is the honest reading of *Infinite* in the title.

| # | Deck | Cards | Target | What changes |
| --- | --- | --- | --- | --- |
| 1 | + the **Joker** | 53 | 53! ≈ 4.27e69 | The Joker is Wild by nature in every game. As a generator it has rank 0 and earns what the highest-charged card earns. |
| 2 | + the **Stars ★** suit | 65 | 65! ≈ 8.25e90 | A third colour (blue ink). Klondike gains a fifth foundation and an eighth column; "alternating colour" becomes "a different colour". |
| 3 | + the **Fool's rank** (a Zero below Ace) | 70 | 70! ≈ 1.20e100 | Sequences may run below the Ace. Pyramid's pairs now sum to 13 *or* 0. |
| 4 | + **Moons ☾** | 84 | 84! | A fourth colour. Beyond here the ladder repeats with diminishing novelty; stop or go generic. |

**What an Ascension costs:** every Permutation and every Cut. **What it never touches:**
`lifetimeShuffles` (invariant #5) or anything already revealed. Numbering systems stay unlocked; the
Constellation stays lit. A fresh cycle is seeded like a Reshuffle is, for the same reason: a reset this
severe with nothing to show for it reads as punishment however good the maths.

**Why it is worth entering:** a bigger deck is strictly more generators, and each new rank or suit
extends the numbering systems' normalised total — so the *shape* of value changes again, the way layer 2
promised. The Joker in particular breaks the "one mark per card" economy open, because a Wild card is a
legal target everywhere.

## What must change first: the deck is not 52

The engine assumes a 52-card deck in a handful of places. **This refactor is worth doing on its own
merits, before any Ascension content**, because it is the only thing standing between the current game
and a deck of any size.

| Place | Assumption | Change |
| --- | --- | --- |
| `engine/types.ts` | `cardDef` computes `suit = SUITS[id / 13]`, `rank = id % 13 + 1`; `STANDARD_DECK` is 52 long | A `DeckShape { suits: Suit[]; ranks: Rank[]; extras: ExtraCard[] }` and a `deckOf(shape)` that builds the id↔(suit,rank) map once. `cardDef` reads the map, not arithmetic. |
| `engine/state.ts` | `cards: Array(52)` | Sized from the current shape; save repair resizes rather than rejecting. `state.deck: DeckShapeId` persisted. |
| `engine/numbering.ts` | normalises 13 ranks to a total of 91 | Normalise `shape.ranks.length` ranks to the shape's natural total. The Zero rank and the Joker need a defined natural value (0 and "copy the best"). |
| `engine/economy/derive.ts` | `awakeCount / 52`, `keepAwake` clamped to 52 | `/ deckSize`, clamped to `deckSize`. |
| `engine/permutation.ts` | `FACT_52`, `LOG10_FACT_52` | `factorialOf(deckSize)` cached per shape; `journeyFraction` reads the current target. The name `FACT_52` becomes `DECK_FACTORIAL`. |
| `rules/games/*.ts` | deal `STANDARD_DECK` | Deal `context.deck` handed in by the host. Games declare how they handle extras: a game that cannot use a fifth suit says so and the host offers only compatible games. |
| `table/cardFaces.ts` | 4 suit paths, 13 rank labels, red/black | A suit registry with path + ink colour; a Joker face; the Zero. |
| `marks`, `constellation` | ids 0..51 in placements | Placements survive a shape change only if the card still exists; drop the rest on migration, and say so in the ledger. |

**Sequencing.** (1) Introduce `DeckShape` with exactly one shape (the standard 52) and make everything
read it — no behaviour change, all tests still green. (2) Add the Joker shape behind a flag and make the
five games deal it. (3) Only then build the Ascension layer itself.

## The layer

- Revealed when `lifetimeShuffles ≥ deckFactorial` for the first time. Not a threshold that scales — this
  one is *the* number, and arriving at it is the point.
- `performAscend(state, bus, now)`: `ascensions++`, deck shape advances, Permutations and Cuts to a seed,
  the run resets, every card re-sleeps, `lifetimeShuffles` untouched. Emits `ascend`.
- A ceremony worth the moment: the whole deck fans out across the felt, the new card walks in, the window
  changes hue, and the ledger gets the Keeper's note about the knock at the door.
- The Journey bar re-scales to the new factorial with the old one drawn as a passed brass line.

## Open questions

- **Does the odometer show progress toward the current deck's factorial, or the original 52!?** Leaning
  current, with 52! marked as a line already passed — the alternative is a bar that never moves again.
- **Do Marks survive?** Leaning yes for cards that still exist, because losing a carefully built engine at
  the exact moment of triumph is the punishing reading. The Joker arrives unmarked.
- **Does the deck's *back* change?** Yes — it is the cheapest way to make the new deck feel new.
