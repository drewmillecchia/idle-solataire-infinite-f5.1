/**
 * Layer 1 prestige: Cut the Deck (docs/02-game-design.md 6). PURE.
 *
 * THE TWO ANTI-DIVERGENCE INVARIANTS (CLAUDE.md #4, docs/04-research.md 9 — a prior build hit
 * 1e3838 in four sim-hours by ignoring them):
 *
 *  1. The threshold scales with the FULL current non-card multiplier `M`. Because run earnings are
 *     roughly `cardBase x M x (time the multiplier stack takes to e-fold)`, dividing by `CUT_BASE x M`
 *     cancels the stack: what is left measures *play* progress — cards woken, charge accumulated,
 *     hands won — not how big the numbers got.
 *  2. `cutMult` (in derive) reads `prestige.lifetimeCuts`, never the spendable `prestige.cuts`, so
 *     spending on the Constellation can never reduce the rate.
 *
 * `M` = mults.global x awake x devotion x cut x permutation x way. The Constellation's `globalMult`
 * is folded into `mults.global` by derive, so it is already inside `M`. Per-SUIT multipliers are
 * deliberately NOT in `M`: they are part of the card base, i.e. part of the play progress a Cut is
 * supposed to measure.
 *
 * ---- TUNED CONSTANTS (sim numbers below; see also memory/tuning-log.md) ---------------------
 *
 * CUT_BASE = 1e6. The ratio `runEarned / (CUT_BASE x M)` is scale-free, so this single number sets
 * the whole cadence. Swept on the engaged sim at 4 Hz (first-cut time, seed 1): 4e4 -> 6m34,
 * 2e5 -> 10m39, 5e5 -> 16m08, 1e6 -> 18m47, 3e6 -> 18m47 (the ratio jumps hard the moment the last
 * cards wake, so the curve flattens above 1e6). At 1e6 the first cut lands at 14m48 / 15m43 /
 * 17m20 / 18m47 / 20m48 on seeds 1..5 — median 17m20, every seed inside the documented 12-30 min
 * window — and the whole deck is awake before the first cut on 4 of 5 seeds.
 *
 * CUT_EXPONENT = 0.5, the briefed starting value, kept. Because the potential is already
 * scale-free, the exponent only shapes how many Cuts a given overshoot pays: sweeping
 * 0.5 / 0.75 / 1.0 / 1.25 changed lifetime Cuts after 4 h from 25 to 735 but left the cut *rhythm*
 * at 2-3 cuts per hour throughout, and left the first cut untouched (at ratio = 1 every exponent
 * awards exactly 1). 0.5 is the flattest of those, so it is the one that cannot mint thousands
 * from a single lucky run — the 4.8 build's failure mode, which came from taking a root of an
 * ABSOLUTE quantity rather than of this scale-free one.
 *
 * Six engaged hours end at lifetimeShuffles ~ 1e15.7 and deckRate ~ 1e9.1: finite, far under the
 * 1e30 divergence guard, with the rate a run reaches climbing cut over cut. See tests/balance.test.ts
 * for the one place the pacing contract is not met (cuts per hour in hours 2-4) and why.
 */
import Decimal from 'break_eternity.js';
import { D } from '../numbers';
import { derive } from './derive';
import type { Derived } from './derive';
import type { EventBus } from '../events';
import type { GameState } from '../state';
import type { WayId } from '../types';

/** Shuffles a run must earn, per point of current multiplier, to be worth exactly one Cut. */
export const CUT_BASE = '1e6';
/** Reward curve: cuts ~ (overshoot)^CUT_EXPONENT. One constant, nowhere else. */
export const CUT_EXPONENT = 0.5;

/** Shuffles earned since this run began. Never touches the odometer (invariant #5). */
export function runEarned(state: GameState): Decimal {
  return state.lifetimeShuffles.minus(state.run.earnedAtStart);
}

/** The full current non-card multiplier: everything a Cut must scale against (invariant #4). */
export function cutMultiplier(derived: Derived): Decimal {
  const m = derived.mults;
  return m.global.times(m.awake).times(m.devotion).times(m.cut).times(m.permutation).times(m.way);
}

/** Shuffles this run must earn before a Cut is worth taking. */
export function cutThreshold(state: GameState, derived: Derived): Decimal {
  void state;
  return D(CUT_BASE).times(cutMultiplier(derived));
}

/** Raw (unrounded, un-yielded) Cuts this run is worth. 0 while the run has earned nothing. */
export function cutPotential(state: GameState, derived: Derived): Decimal {
  const earned = runEarned(state);
  if (earned.lte(0)) return D(0);
  const ratio = earned.div(cutThreshold(state, derived));
  if (ratio.lte(0)) return D(0);
  return ratio.pow(CUT_EXPONENT);
}

/** Whole Cuts a Cut would award right now, after the Constellation's cut-yield multiplier. */
export function cutsOnCut(state: GameState, derived: Derived): Decimal {
  return cutPotential(state, derived).times(derived.cutYieldMult).floor();
}

/** A Cut is available once it would award at least one whole Cut. */
export function canCut(state: GameState, derived: Derived): boolean {
  return cutsOnCut(state, derived).gte(1);
}

/**
 * Cheap per-tick check: notes when the Cut first became reachable this run and reveals the feature
 * the first time it ever happens. `run.cutAvailableSeenAt` doubles as the once-per-run guard, so
 * the expensive path runs at most once per run.
 */
export function checkCutReveal(state: GameState, derived: Derived, bus: EventBus): void {
  if (state.run.cutAvailableSeenAt !== null) return;
  if (!canCut(state, derived)) return;
  // `lastSeenAt` is the engine's clock reading: the host loop refreshes it every frame.
  state.run.cutAvailableSeenAt = state.lastSeenAt;
  if (!state.revealed.includes('cut')) {
    state.revealed.push('cut');
    bus.emit({ type: 'reveal', feature: 'cut' });
  }
}

/** Card ids, highest charge first; ties broken by id so the choice is deterministic. */
function topByCharge(state: GameState, count: number): Set<number> {
  if (count <= 0) return new Set();
  const ids = state.cards
    .map((c, id) => ({ id, awake: c.awake, charge: c.charge }))
    .filter((c) => c.awake)
    .sort((a, b) => (b.charge - a.charge) || (a.id - b.id))
    .slice(0, count)
    .map((c) => c.id);
  return new Set(ids);
}

/**
 * Takes the Cut: banks the Cuts, then resets the run. `lifetimeShuffles` is NEVER touched, and
 * `revealed` / `milestones` are never re-hidden. Returns the Cuts awarded (0 if not available).
 */
export function performCut(state: GameState, bus: EventBus, way: WayId, now: number): Decimal {
  const derived = derive(state);
  const earned = cutsOnCut(state, derived);
  if (earned.lt(1)) return D(0);

  state.prestige.cuts = state.prestige.cuts.plus(earned);
  state.prestige.lifetimeCuts = state.prestige.lifetimeCuts.plus(earned);
  state.prestige.cutsPerformed += 1;
  state.stats.totalCuts += 1;

  const runSeconds = Math.max(0, (now - state.run.startedAt) / 1000);
  const best = state.stats.fastestCutSeconds;
  state.stats.fastestCutSeconds = best === null ? runSeconds : Math.min(best, runSeconds);

  // Cards: everything sleeps except the best-charged `keepAwake` of them.
  const kept = topByCharge(state, derived.keepAwake);
  for (let id = 0; id < state.cards.length; id++) {
    const card = state.cards[id];
    if (!card) continue;
    if (kept.has(id)) {
      card.awake = true;
      card.charge = Math.max(Math.floor(card.charge * derived.keepCharge), derived.startCharge);
    } else {
      card.awake = false;
      card.charge = 0;
    }
  }

  const chosen = state.prestige.waysUnlocked.includes(way) ? way : 'hand';
  state.shuffles = D(0);
  state.run = {
    way: chosen,
    startedAt: now,
    earnedAtStart: state.lifetimeShuffles,
    cutAvailableSeenAt: null,
    upgrades: {},
    handsPlayed: 0,
    handsWon: 0,
    homedThisRun: 0,
    undosThisHand: 0
  };

  bus.emit({ type: 'cut', cuts: earned, way: chosen });
  return earned;
}
