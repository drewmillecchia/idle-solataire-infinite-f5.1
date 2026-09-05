/**
 * Layer 2 prestige: Reshuffle (docs/02-game-design.md §6). PURE.
 *
 * A Reshuffle trades *every Cut of this cycle* for Permutations, which buy the Numbering ladder.
 * It obeys THE SAME TWO ANTI-DIVERGENCE INVARIANTS as the Cut (CLAUDE.md #4, docs/04-research.md
 * §9):
 *
 *  1. The threshold scales with the layer's own multiplier, `mults.permutation`. Cuts accrue
 *     roughly in proportion to how fast the Cut layer cycles, and the permutation multiplier is
 *     exactly what makes it cycle faster, so dividing by `RESHUFFLE_BASE x permutationMult`
 *     cancels it: what is left measures how far this CYCLE got, not how big the numbers are.
 *  2. `mults.permutation` (in derive) reads `prestige.lifetimePermutations`, never the spendable
 *     `prestige.permutations`, so buying a Numbering system can never lower the rate.
 *
 * The cycle is measured by `cycleCuts = lifetimeCuts - cutsAtCycleStart`, which is the layer-2
 * analogue of `runEarned`: it never touches the odometer and never reads a balance.
 *
 * ---- TUNED CONSTANTS (sim numbers; 8 h engaged, dt 0.5 s, seeds 1..5) ----------------------
 *
 * RESHUFFLE_BASE = 8. Cycle Cuts per point of permutation multiplier that one Permutation is
 * worth. Swept 12 -> 8 (see the seed note): at 12 the first Reshuffle lands at 2h14 and the second
 * cycle is only 1 % faster than the first on seed 1 — inside the noise, i.e. the layer is not
 * really worth entering. At 8 the first Reshuffle lands at 1h28-2h18 on seeds 1..5 and every
 * second cycle is 1.4x-2.3x faster. Note this is Cuts BANKED, not Cut events: a Cut event awards
 * 1-3+ Cuts, so 8 banked is ~6 events, and the layer is takeable a while before the reveal at 12
 * events fires — which is deliberate. When the panel appears it is already worth pressing.
 *
 * RESHUFFLE_EXPONENT = 0.75, the briefed starting value, kept. 4.8 found 0.5 made the layer
 * strictly not worth entering. Worth recording honestly: the exponent is NOT what the balance test
 * turned on here. A greedy bot reshuffles the moment the ratio crosses 1, where every exponent
 * awards exactly 1, so the sim mints 1 Permutation per cycle at 0.5 and at 0.75 alike. The
 * exponent is felt only by a player who overshoots — the one who waits for the reveal, arrives
 * with ~40 cycle Cuts (ratio 5) and collects 3 Permutations at 0.75 where 0.5 would pay 2. It is
 * kept flat for the same reason CUT_EXPONENT is: a root of a scale-free ratio cannot mint
 * thousands from one lucky cycle.
 *
 * SEED = SEED_BASE + SEED_PER_CYCLE x reshuffles = 2 + 8 x reshuffles. This is the constant that
 * makes the layer worth entering, and it is why docs/02 §6 says a fresh cycle is *seeded with
 * Cuts*. Resetting `lifetimeCuts` costs nothing in Cut CADENCE — `cutPotential` is scale-free, so
 * the Cut multiplier cancels out of it entirely (invariant #4) — which means a Reshuffle can only
 * pay for itself through what the seed buys: the seed lands in the Cuts BALANCE, so a new cycle
 * opens with a Constellation shopping trip, and permanent nodes (Kept Flame, Warm Start, Sharper
 * Cut) are exactly what shortens a run. Swept at base 8: the briefed seed of 2+1n gives 1.19x /
 * 0.96x / 2.2x on seeds 1..3 — seed 2 comes out SLOWER, so the layer is not reliably worth
 * entering. At 2+8n the second cycle reaches the first cycle's final Cut count in
 * 3054/3801/3604/5610/3363 s against 6228/5336/8291/7820/6815 s on seeds 1..5: 1.4x-2.3x, every
 * seed, which is the margin tests/balance.test.ts asserts.
 *
 * 8 engaged hours take 3 Reshuffles on every seed, end at lifetimeShuffles ~1e16.5 and deckRate
 * ~1e11 (finite, far under the 1e40 guard), and buy the first two rungs of the Numbering ladder.
 *
 * PERMANENT THROUGH A RESHUFFLE: the Constellation (bought with Cuts already spent — a reset that
 * refunded or cleared it would make the layer a punishment), `unlockedNumberings`, `revealed`,
 * `milestones`, `marks.placed`, and above all `lifetimeShuffles` (invariant #5).
 */
import type Decimal from 'break_eternity.js';
import { D } from '../numbers';
import { derive, type Derived } from './derive';
import { resetRun } from './prestige';
import type { EventBus } from '../events';
import type { GameState } from '../state';

/** Cuts one cycle must bank, per point of permutation multiplier, to be worth exactly one Permutation. */
export const RESHUFFLE_BASE = 8;
/** Cuts a first cycle is seeded with. */
export const RESHUFFLE_SEED_BASE = 2;
/** Extra seed Cuts per Reshuffle already taken, so each cycle starts a little further along. */
export const RESHUFFLE_SEED_PER_CYCLE = 8;
/** Reward curve: permutations ~ (overshoot)^RESHUFFLE_EXPONENT. One constant, nowhere else. */
export const RESHUFFLE_EXPONENT = 0.75;
/** Cuts performed before the layer is revealed. Behavioural trigger, not a number (docs/02 §6). */
export const RESHUFFLE_REVEAL_CUTS = 12;

/** Cuts banked since this cycle began. The layer-2 analogue of `runEarned`. */
export function cycleCuts(state: GameState): Decimal {
  const c = state.prestige.lifetimeCuts.minus(state.prestige.cutsAtCycleStart);
  return c.lte(0) ? D(0) : c;
}

/**
 * Cuts a fresh cycle is seeded with, after `reshuffles` Reshuffles. Written to BOTH the balance
 * (so the Constellation is immediately shoppable, which is what actually shortens the next cycle)
 * and to `lifetimeCuts` (so the rate does not fall back to 1x).
 */
export function cycleSeed(reshuffles: number): Decimal {
  return D(RESHUFFLE_SEED_BASE + RESHUFFLE_SEED_PER_CYCLE * Math.max(0, Math.floor(reshuffles)));
}

/** Cuts this cycle must bank before a Reshuffle is worth taking (invariant #4, layer 2). */
export function reshuffleThreshold(state: GameState, derived: Derived): Decimal {
  void state;
  return D(RESHUFFLE_BASE).times(derived.mults.permutation);
}

/** Raw (unrounded) Permutations this cycle is worth. 0 while the cycle has banked nothing. */
export function reshufflePotential(state: GameState, derived: Derived): Decimal {
  const cuts = cycleCuts(state);
  if (cuts.lte(0)) return D(0);
  const ratio = cuts.div(reshuffleThreshold(state, derived));
  if (ratio.lte(0)) return D(0);
  return ratio.pow(RESHUFFLE_EXPONENT);
}

/** Whole Permutations a Reshuffle would award right now. */
export function permutationsOnReshuffle(state: GameState, derived: Derived): Decimal {
  return reshufflePotential(state, derived).floor();
}

/** A Reshuffle is available once it would award at least one whole Permutation. */
export function canReshuffle(state: GameState, derived: Derived): boolean {
  return permutationsOnReshuffle(state, derived).gte(1);
}

/**
 * Cheap per-tick check: reveals the layer the first time the player has performed
 * `RESHUFFLE_REVEAL_CUTS` Cuts. Behavioural, not a threshold on a number, and once only —
 * nothing revealed is ever re-hidden.
 */
export function checkReshuffleReveal(state: GameState, bus: EventBus): void {
  if (state.prestige.cutsPerformed < RESHUFFLE_REVEAL_CUTS) return;
  if (state.revealed.includes('reshuffle')) return;
  state.revealed.push('reshuffle');
  bus.emit({ type: 'reveal', feature: 'reshuffle' });
}

/**
 * Takes the Reshuffle: banks the Permutations, reseeds the Cut layer, and resets the run through
 * the same `resetRun` a Cut uses (so Anchor and Kept Flame behave identically). The current Way is
 * kept. Returns the Permutations awarded (0 if not available).
 */
export function performReshuffle(state: GameState, bus: EventBus, now: number): Decimal {
  const derived = derive(state);
  const earned = permutationsOnReshuffle(state, derived);
  if (earned.lt(1)) return D(0);

  state.prestige.permutations = state.prestige.permutations.plus(earned);
  state.prestige.lifetimePermutations = state.prestige.lifetimePermutations.plus(earned);
  state.prestige.reshuffles += 1;

  // Reset the Cut layer, seeded so the next cycle runs shorter than this one. The Constellation is
  // permanent and is deliberately left alone.
  const seed = cycleSeed(state.prestige.reshuffles);
  state.prestige.cuts = seed;
  state.prestige.lifetimeCuts = seed;
  state.prestige.cutsAtCycleStart = seed;

  // `derived` was taken before the reseed, which is what we want: the deck sleeps under the rules
  // the player was actually playing under (keepAwake / keepCharge come from the Constellation,
  // which the Reshuffle does not touch).
  resetRun(state, bus, state.run.way, now, derived);

  bus.emit({ type: 'reshuffle', permutations: earned });
  return earned;
}

/** Re-exported for symmetry with the Cut layer: the multiplier the threshold scales against. */
export function reshuffleMultiplier(derived: Derived): Decimal {
  return derived.mults.permutation;
}
