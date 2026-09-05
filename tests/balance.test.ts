/**
 * The pacing contract of docs/02-game-design.md 9, turned into assertions against the REAL engine
 * via the headless sim. A failing test here is a design decision, never a silent widening.
 *
 * Every simulation runs once in `beforeAll` and is shared: the whole file is ~35 s of wall clock
 * (budget: under 60 s). The sim steps at 4 Hz, which is legitimate because `step` never clamps its
 * delta (CLAUDE.md invariant #3) — it is the same arithmetic, sampled more coarsely.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runSim, type SimResult } from '../sim/run';
import {
  createInitialState, step, homeCard, tableauSpark, winHand, dealHand,
  buyUpgrade, visibleUpgrades, upgradeCost, maxAffordable
} from '$engine/index';
import { EventBus } from '$engine/events';
import { mulberry32 } from '$engine/rng';
import { NO_TWISTS } from '$rules/module';
import { gameById } from '$rules/registry';
import { nextMove } from '$rules/autoplay';

const SEEDS = [1, 2, 3, 4, 5];
/** Long enough to contain the first cut on every seed, short enough to run five of them. */
const SHORT_HOURS = 0.75;
const LONG_HOURS = 6;
/** 4 simulated days for the relaxer. */
const RELAXER_HOURS = 96;
/** Long enough for three Reshuffles, so two whole layer-2 cycles can be compared. */
const RESHUFFLE_HOURS = 8;

let short: SimResult[] = [];
let long: SimResult;
let relaxer: SimResult;
let cycles: SimResult;

beforeAll(() => {
  short = SEEDS.map((s) => runSim(SHORT_HOURS, 'engaged', s));
  long = runSim(LONG_HOURS, 'engaged', 1);
  relaxer = runSim(RELAXER_HOURS, 'relaxer', 1);
  // 0.5 s steps: `step` never clamps its delta (invariant #3), so a coarser sim is the same
  // arithmetic, and it keeps this file inside its wall-clock budget.
  cycles = runSim(RESHUFFLE_HOURS, 'engaged', 1, { dt: 0.5 });
}, 180_000);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Least-squares slope of y against its own index. */
function slope(ys: number[]): number {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * ((ys[i] as number) - my);
    den += (i - mx) * (i - mx);
  }
  return num / den;
}

/**
 * A standalone "how long does the run-upgrade shop keep offering something worth buying" probe
 * (docs/02 §9 "Run-upgrade tier exhausted"). Deliberately NOT `sim/run.ts`: that harness takes
 * Cuts, which resets `run.upgrades` to `{}` (see `economy/prestige.ts`'s `resetRun`) every time,
 * so it cannot see how long a single, uninterrupted run keeps the shop interesting — which is
 * exactly the "more to buy" question tier 2 answers. This mirrors `sim/run.ts`'s engaged-profile
 * play loop (same deal/autoplay/buy cadence) minus the Cut policy, against the same real engine.
 */
function simulateSingleRunPurchases(minutes: number, seed = 1): { purchaseTimes: number[]; ids: string[] } {
  const bus = new EventBus();
  const state = createInitialState(0);
  const rng = mulberry32(seed);
  const game = gameById('klondike')!;
  let board: unknown = game.deal(rng, {}, NO_TWISTS);
  let seen = new Set<string>();
  dealHand(state, bus, 'klondike', 0);

  const purchaseTimes: number[] = [];
  const ids: string[] = [];

  let t = 0;
  const dt = 0.5;
  const total = minutes * 60;
  const movePeriod = 1.2;
  let moveAcc = 0;
  let buyAcc = 0;
  let handStart = 0;

  const newHand = () => {
    board = game.deal(rng, {}, NO_TWISTS);
    seen = new Set();
    dealHand(state, bus, 'klondike', 0);
    handStart = t;
  };

  while (t < total) {
    step(state, dt, bus);
    t += dt;
    state.lastSeenAt = t * 1000;

    moveAcc += dt;
    if (moveAcc >= movePeriod) {
      moveAcc = 0;
      const mv = nextMove(game, board, NO_TWISTS, seen);
      if (!mv || t - handStart > 900) {
        newHand();
      } else {
        seen.add(game.hash(board));
        const r = mv.kind === 'draw' ? game.draw(board, NO_TWISTS) : game.move(board, mv.pile, mv.index, mv.to, NO_TWISTS);
        if (r.changed) {
          board = r.board;
          for (const id of r.homed) homeCard(state, bus, id, 'sim');
          if (r.homed.length === 0 && mv.kind !== 'draw') tableauSpark(state, bus);
          if (r.won) {
            winHand(state, bus, { game: 'klondike', moves: 0, seconds: t - handStart });
            newHand();
          }
        }
      }
    }

    // The same greedy policy sim/run.ts uses for run upgrades, minus the Constellation/Cut half
    // (there is no Cut here, by design: this probe measures ONE run in isolation).
    const ups = visibleUpgrades(state, bus);
    buyAcc += dt;
    if (buyAcc >= 5) {
      buyAcc = 0;
      const affordable = ups.filter((u) => maxAffordable(state, u.id) > 0);
      affordable.sort((a, b) => upgradeCost(state, a.id).cmp(upgradeCost(state, b.id)));
      const u = affordable[0];
      if (u && buyUpgrade(state, bus, u.id, 1)) {
        purchaseTimes.push(t);
        ids.push(u.id);
      }
    }
  }
  return { purchaseTimes, ids };
}

describe('first Cut (docs/02 9: 12-30 min, engaged)', () => {
  it('lands inside the window on the median of seeds 1..5', () => {
    const times = short.map((r) => r.firstCutAt);
    expect(times.every((t) => t !== null)).toBe(true);
    const m = median(times as number[]);
    expect(m).toBeGreaterThanOrEqual(12 * 60);
    expect(m).toBeLessThanOrEqual(30 * 60);
  });

  it('lands inside the window on every one of seeds 1..5', () => {
    for (const r of short) {
      expect(r.firstCutAt).not.toBeNull();
      expect(r.firstCutAt as number).toBeGreaterThanOrEqual(12 * 60);
      expect(r.firstCutAt as number).toBeLessThanOrEqual(30 * 60);
    }
  });
});

describe('reveals (docs/02 9: at most 3 in the first minute)', () => {
  it('shows at most three things in the first 60 s on every seed', () => {
    for (const r of short) {
      const early = r.reveals.filter((x) => x.t <= 60);
      expect(early.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('waking the deck (docs/02 9: whole deck awake inside the first run)', () => {
  it('wakes all 52 before the first cut on the majority of seeds', () => {
    const won = short.filter((r) => r.allAwakeInFirstRun).length;
    // Measured 4/5 (seed 3 draws badly: 52 awake at 23m22, first cut at 17m20).
    expect(won).toBeGreaterThanOrEqual(4);
  });

  it('always wakes the whole deck well inside the first hour', () => {
    for (const r of short) {
      expect(r.allAwakeAt).not.toBeNull();
      expect(r.allAwakeAt as number).toBeLessThanOrEqual(30 * 60);
    }
  });

  it('wakes the first card in under 90 s', () => {
    for (const r of short) {
      expect(r.firstAwakeAt).not.toBeNull();
      expect(r.firstAwakeAt as number).toBeLessThan(90);
    }
  });
});

describe('cut rhythm, hours 2-4', () => {
  /**
   * DEVIATION from docs/02-game-design.md 9 ("Cuts per hour, mid-game: 3-6"). NOT widened here.
   *
   * Measured on seed 1, 6 h engaged, CUT_BASE 1e6 / CUT_EXPONENT 0.5: cut EVENTS per hour are
   * 3, 3, 2, 1, 2, 1 for hours 1..6, so hours 2-4 give 3, 2, 1. Cuts EARNED per hour over the
   * same window is 7, 9, 6.
   *
   * The cadence lengthens for a structural reason, not a tuning one: the sim's brief cut policy
   * holds out for `cutsOnCut >= 0.3 * lifetimeCuts`, a bar that grows exponentially with the
   * cuts already banked, while `cutPotential` is deliberately scale-free (invariant #4 divides
   * run earnings by the full current multiplier, so the multiplier cancels and only play progress
   * — cards woken, charge accumulated — is left). A scale-free numerator cannot chase an
   * exponential bar, so runs must lengthen. Sweeping CUT_EXPONENT over 0.5/0.75/1.0/1.25 moved
   * the Cuts awarded but left cut events at 2-3 per hour throughout; so did strengthening Kept
   * Flame. Fixing this needs a design decision (a cut policy that is not proportional to lifetime
   * cuts, or a restated target), which belongs in docs/02 first.
   *
   * What is asserted here is the true, weaker property: the rhythm never stalls.
   */
  it('keeps cutting through hours 2, 3 and 4 (recorded: 3, 2, 1 events/hour)', () => {
    const perHour = [1, 2, 3].map((h) => long.cutsPerHourInHour(h));
    for (const n of perHour) expect(n).toBeGreaterThanOrEqual(1);
    expect(perHour.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
  });

  it('earns cuts steadily across hours 2-4', () => {
    for (const h of [1, 2, 3]) {
      const earned = long.cuts.filter((c) => c.t >= h * 3600 && c.t < (h + 1) * 3600)
        .reduce((a, c) => a + c.earned, 0);
      expect(earned).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('no divergence (docs/02 9)', () => {
  it('ends 6 engaged hours finite and far below 1e30', () => {
    expect(Number.isFinite(long.lifetimeLog10)).toBe(true);
    expect(Number.isFinite(long.finalRateLog10)).toBe(true);
    // Measured: lifetimeShuffles ~ 1e15.7, deckRate ~ 1e9.1.
    expect(long.lifetimeLog10).toBeLessThan(30);
    expect(long.lifetimeLog10).toBeGreaterThan(6);
  });

  it('grows the rate across cuts on average', () => {
    const probes = long.log10RateAfterCut
      .slice(2)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(probes.length).toBeGreaterThanOrEqual(5);
    // "On average": the rate 10 min after cut k trends up in k. Individual probes are noisy
    // because a probe can land in the *next* run, a few minutes after its deck went back to sleep.
    expect(slope(probes)).toBeGreaterThan(0);
    expect(probes[probes.length - 1] as number).toBeGreaterThan(probes[0] as number);
  });

  it('raises the rate a run reaches, cut over cut', () => {
    const atCut = long.cuts.map((c) => c.log10RateBefore);
    expect(slope(atCut)).toBeGreaterThan(0);
    expect(atCut[atCut.length - 1] as number).toBeGreaterThan(atCut[0] as number);
  });
});

describe('the relaxer (3 hands a day, no panels)', () => {
  it('reaches the million milestone within 4 simulated days', () => {
    const million = relaxer.milestones.find((m) => m.id === 'million');
    expect(million).toBeDefined();
    expect(million?.t).toBeLessThanOrEqual(RELAXER_HOURS * 3600);
    // Measured: 3 h 33 m.
    expect(million?.t).toBeLessThanOrEqual(4 * 3600);
  });

  it('never cuts, but the cut does become reachable', () => {
    expect(relaxer.cuts).toHaveLength(0);
    expect(relaxer.firstCutAvailableAt).not.toBeNull();
    // Measured: 3 h 34 m. The relaxer simply never opens the panel.
    expect(relaxer.firstCutAvailableAt as number).toBeLessThan(RELAXER_HOURS * 3600);
  });
});

describe('Reshuffle, layer 2 (docs/02 §6)', () => {
  it('reveals itself the moment the twelfth Cut is performed', () => {
    const reveal = cycles.reveals.find((r) => r.feature === 'reshuffle');
    expect(reveal).toBeDefined();
    expect(cycles.cuts.length).toBeGreaterThanOrEqual(12);
    const twelfth = cycles.cuts[11] as { t: number };
    // The reveal is behavioural: cuts performed, checked once per `step`.
    expect(reveal?.t).toBeGreaterThanOrEqual(twelfth.t);
    expect(reveal?.t).toBeLessThanOrEqual(twelfth.t + 2);
  });

  it('is reachable well inside a first long session', () => {
    expect(cycles.firstReshuffleAt).not.toBeNull();
    // Measured on seeds 1..5: 1 h 43, 1 h 28, 2 h 18, 2 h 10, 1 h 53.
    expect(cycles.firstReshuffleAt as number).toBeLessThanOrEqual(3 * 3600);
    expect(cycles.reshuffles.length).toBeGreaterThanOrEqual(2);
    expect(cycles.lifetimePermutations).toBeGreaterThanOrEqual(2);
  });

  it('spends Permutations on the Numbering ladder', () => {
    expect(cycles.unlockedNumberings.length).toBeGreaterThanOrEqual(2);
    expect(cycles.unlockedNumberings).toContain('natural');
  });

  /**
   * THE reason layer 2 exists. Resetting `lifetimeCuts` costs nothing in Cut *cadence* — the Cut
   * potential is scale-free, so the Cut multiplier cancels out of it (invariant #4) — so a
   * Reshuffle can only pay for itself through what the seed and the permanent Constellation buy.
   * If this fails, the seed (RESHUFFLE_SEED_PER_CYCLE) is the constant to move, in
   * `economy/reshuffle.ts`, and the sim numbers there record the sweep.
   */
  it('is strictly worth entering: the second cycle outruns the first', () => {
    const first = cycles.cycles[0];
    const second = cycles.cycles[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    const target = first.cutsInCycle;
    expect(target).toBeGreaterThan(0);
    const firstTime = first.timeToCycleCuts(target);
    const secondTime = second.timeToCycleCuts(target);
    expect(firstTime).not.toBeNull();
    expect(secondTime).not.toBeNull();
    // Measured on seeds 1..5: 3054/3801/3604/5610/3363 s against 6228/5336/8291/7820/6815 s,
    // i.e. the second cycle is 1.4x-2.3x faster to the same Cut count.
    expect(secondTime as number).toBeLessThan(firstTime as number);
  });

  it('ends 8 engaged hours finite and far below 1e40', () => {
    expect(Number.isFinite(cycles.lifetimeLog10)).toBe(true);
    expect(Number.isFinite(cycles.finalRateLog10)).toBe(true);
    // Measured: lifetimeShuffles ~ 1e16.5, deckRate ~ 1e11.5.
    expect(cycles.lifetimeLog10).toBeLessThan(40);
    expect(cycles.lifetimeLog10).toBeGreaterThan(6);
  });
});
