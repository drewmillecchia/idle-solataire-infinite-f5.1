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

**Sequencing.** (1) ✅ **Done 2026-09-05.** `engine/deck.ts` defines `DeckShape`; `state.deck` holds a
shape id (save v7); `deckSize` / `deckCards` / `cardDefIn` replace the `id / 13` arithmetic and every
hardcoded 52 in `state`, `numbering`, `permutation`, `derive` and the save repair. No behaviour change:
490 tests passed and **not one existing test needed editing**. (2) ✅ **Done 2026-09-06** — see below.
(3) Build the Ascension layer itself: `performAscend`, the ceremony, the re-scaled Journey bar.

### Step 2, as built (2026-09-06)

**The model changed, and that is the load-bearing part.** Card ids are now indices into ONE
append-only universe of cards, and a deck shape is a *prefix* of it — [ADR-015](03-decisions.md).
The standard 52 is the first 52 ids, exactly as before; `JOKER_53` is those plus the Joker at id 52.
Because shapes nest, a Mark placed on a card survives an Ascension without any remapping, and
`cardDef(id)` still answers without being told which deck is in play.

| Landed | Where |
| --- | --- |
| The universe, `JOKER_53`, `isJoker`, `deckCardIds` | `engine/deck.ts` |
| `CardSuit = Suit \| 'J'`, `CardRank = Rank \| 0`, `isSuited` | `engine/types.ts` |
| A card with no rank is worth the **average** rank under every system | `engine/numbering.ts` |
| Unsuited cards take no suit multiplier, join no per-suit total, are never the favored or a laggard suit | `engine/economy/derive.ts` |
| Kindling on an unsuited or unranked card warms nothing | `engine/marks/interpret.ts` |
| Mark repair measures "off the deck" against the *active shape*, not a literal 52; `pruneMarksForShape` drops what a shape cannot hold (a Twin goes whole, not half) | `engine/save/serialize.ts`, `engine/marks/placement.ts` |
| `deal(rng, config, twists, deck)` — a game is handed its cards; `isWildCard` makes the Joker wild by nature in every game | `rules/module.ts` |
| A suit registry (glyph + ink) and the Joker's face: a floppy two-horned cap in brass, index `?` | `table/cardFaces.ts` |
| A **rankless card crowns a finished foundation** (below) | `rules/games/klondike.ts`, `freecell.ts`, `rules/solver/klondike.ts` |

**Where does the 53rd card go home?** This was the one real design problem step 2 turned up, and it
is worth stating because it is not obvious. Klondike and FreeCell foundations hold thirteen ranks
each: four piles, fifty-two places, fifty-three cards. A wild card can stand in for a rank, but a
card with *no rank of its own* must not — standing in would occupy a rank's place and strand the real
card of that rank forever, and greedy autoplay, which homes whatever it can, would do it on the first
hand every time. **The rule:** a rankless card may only be played onto a foundation that is already
complete, where it sits as a fourteenth card and crowns it. Capacity becomes 4 x 14, the Joker is
always safely playable, and no line is ever poisoned by homing it early. `tests/solver.test.ts`
proves the loop closes: the solver cracks a 53-card deal, the line replays through the real rules,
and the winning position is 14/13/13/13 with the Joker on top.

**A Mark that cannot work on the Joker is currently just inert** — Kindling has no rank-neighbours
to warm, a Lantern lights no suit. The engine handles each safely and says so in a comment, but the
Deck panel still offers them. Step 3 should either grey those out for a card outside the grid or
give the Joker its own reading of them (a Lantern on the Joker lifting *every* suit is the obvious
temptation, and probably too strong).

**Open decisions this deliberately left to step 3.** The Joker's value is the average rank, which is
the safe reading, not the exciting one — docs above say "earns what the highest-charged card earns",
and that dynamic version is a `derive` question best answered when there is an Ascension to balance
it against. Nothing yet *switches* a save's shape: `performAscend` is step 3, and it is the caller
that must call `pruneMarksForShape` and say so in the ledger.

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
