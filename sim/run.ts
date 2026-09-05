/** Headless balance simulator: drives the REAL engine + rules in Node. */
import {
  createInitialState, step, derive, homeCard, tableauSpark, winHand, dealHand,
  buyUpgrade, visibleUpgrades, upgradeCost, maxAffordable,
  canCut, cutsOnCut, performCut,
  canReshuffle, permutationsOnReshuffle, performReshuffle, cycleCuts as cycleCutsOf,
  numberingOptions, unlockNumbering, selectNumbering,
  buyNode, canBuyNode, nodeCost, visibleNodes,
  formatNumber, formatRate
} from '$engine/index';
import type { NumberingId } from '$engine/types';
import type Decimal from 'break_eternity.js';
import { EventBus } from '$engine/events';
import { mulberry32 } from '$engine/rng';
import { NO_TWISTS } from '$rules/module';
import { gameById } from '$rules/registry';
import { nextMove } from '$rules/autoplay';

type Profile = 'engaged' | 'relaxer' | 'idle';

export interface SimOptions {
  /** Seconds per step. The engine's `step` never clamps, so a coarser sim is still the real engine. */
  dt?: number;
}

export interface CutRecord {
  /** Simulated seconds at which the cut was taken. */
  t: number;
  /** Cuts awarded. */
  earned: number;
  /** log10 of deckRate immediately before the cut. */
  log10RateBefore: number;
  /** Reshuffle cycle this cut belongs to (0 = before the first reshuffle). */
  cycle: number;
  /** `cycleCuts` immediately after this cut: what layer 2 measures. */
  cycleCuts: number;
}

export interface ReshuffleRecord {
  /** Simulated seconds at which the reshuffle was taken. */
  t: number;
  /** Permutations awarded. */
  earned: number;
  /** `cycleCuts` the cycle ended on. */
  cycleCuts: number;
}

/** One Reshuffle cycle: from a reshuffle (or launch) to the next one. */
export interface CycleRecord {
  index: number;
  start: number;
  /** null while the cycle is still running at the end of the sim. */
  end: number | null;
  /** `cycleCuts` at the end (or at the end of the sim). */
  cutsInCycle: number;
  /**
   * Simulated seconds from the cycle's start until it had banked `n` cycle cuts, or null if it
   * never got there. This is the layer-2 pacing measure: cycle 2 must reach cycle 1's final count
   * faster than cycle 1 did.
   */
  timeToCycleCuts: (n: number) => number | null;
}

export interface SimResult {
  hours: number;
  profile: Profile;
  firstAwakeAt: number | null;
  allAwakeAt: number | null;
  /** Whether the whole deck was awake before the first cut (the "inside the first run" target). */
  allAwakeInFirstRun: boolean;
  hands: number;
  wins: number;
  finalRate: string;
  lifetime: string;
  /** log10 of the final lifetimeShuffles; Infinity/NaN if the economy diverged. */
  lifetimeLog10: number;
  /** log10 of the final deckRate. */
  finalRateLog10: number;
  samples: { t: number; rate: string; awake: number; lifetime: string }[];
  milestones: { id: string; t: number }[];
  reveals: { feature: string; t: number }[];
  /** When a cut first became available, whether or not the profile takes it. */
  firstCutAvailableAt: number | null;
  firstCutAt: number | null;
  cuts: CutRecord[];
  /** log10 of deckRate 10 simulated minutes after cut k (index k, 0-based). */
  log10RateAfterCut: (number | null)[];
  lifetimeCuts: number;
  nodes: Record<string, number>;
  firstReshuffleAt: number | null;
  reshuffles: ReshuffleRecord[];
  cycles: CycleRecord[];
  lifetimePermutations: number;
  /** Numbering systems owned at the end, and the one selected. */
  unlockedNumberings: NumberingId[];
  numbering: NumberingId;
  /** Cuts taken during simulated hour `h` (h = 0 is the first hour). */
  cutsPerHourInHour: (h: number) => number;
}

const PROBE_SECONDS = 600;

export function runSim(hours: number, profile: Profile, seed = 1, opts: SimOptions = {}): SimResult {
  const bus = new EventBus();
  const state = createInitialState(0);
  const rng = mulberry32(seed);
  const game = gameById('klondike')!;
  let board: unknown = game.deal(rng, {}, NO_TWISTS);
  let seen = new Set<string>();
  const res: SimResult = {
    hours, profile, firstAwakeAt: null, allAwakeAt: null, allAwakeInFirstRun: false,
    hands: 0, wins: 0, finalRate: '', lifetime: '', lifetimeLog10: -Infinity, finalRateLog10: -Infinity,
    samples: [], milestones: [], reveals: [],
    firstCutAvailableAt: null, firstCutAt: null, cuts: [], log10RateAfterCut: [],
    lifetimeCuts: 0, nodes: {},
    firstReshuffleAt: null, reshuffles: [], cycles: [], lifetimePermutations: 0,
    unlockedNumberings: [], numbering: 'natural',
    cutsPerHourInHour: (h: number) => res.cuts.filter((c) => c.t >= h * 3600 && c.t < (h + 1) * 3600).length
  };
  /** Cuts recorded in a cycle, so `timeToCycleCuts` can be answered without re-scanning. */
  const cycleOf = (index: number): CycleRecord => ({
    index,
    start: 0,
    end: null,
    cutsInCycle: 0,
    timeToCycleCuts: (n: number) => {
      const cycle = res.cycles[index];
      if (!cycle) return null;
      const hit = res.cuts.find((c) => c.cycle === index && c.cycleCuts >= n);
      return hit ? hit.t - cycle.start : null;
    }
  });
  res.cycles.push(cycleOf(0));

  let t = 0;
  const dt = opts.dt ?? 0.25;
  const total = hours * 3600;
  let nextSample = 0;
  // The simulated player makes one move per `movePeriod` seconds while playing.
  const movePeriod = profile === 'engaged' ? 1.2 : 2.0;
  let moveAcc = 0;
  let buyAcc = 0;
  let cutCheckAcc = 0;
  let handsToday = 0;
  let dayStart = 0;
  let playing = true;
  let handStart = 0;

  bus.on((e) => {
    if (e.type === 'milestone') res.milestones.push({ id: e.id, t });
    if (e.type === 'reveal') res.reveals.push({ feature: e.feature, t });
  });

  const log10 = (d: Decimal): number => (d.lte(0) ? -Infinity : d.log10().toNumber());

  /** Spends Permutations on the cheapest system still locked, if the balance covers it. */
  const buyCheapestNumbering = () => {
    const locked = numberingOptions(state).filter((o) => !o.unlocked && o.affordable);
    locked.sort((a, b) => a.cost.cmp(b.cost));
    const pick = locked[0];
    if (pick) unlockNumbering(state, bus, pick.id);
  };

  /**
   * Selects the owned system with the highest immediate deckRate. Every system is normalized to
   * the same 13-rank total, so this is a redistribution: which one wins depends on which cards are
   * awake and charged. `derive` is pure, so trying each one on the live state and restoring the
   * choice is equivalent to trying it on a clone.
   */
  const pickBestNumbering = () => {
    const current = state.numbering;
    let best = current;
    let bestRate = derive(state).deckRate;
    for (const opt of numberingOptions(state)) {
      if (!opt.unlocked || opt.id === current) continue;
      state.numbering = opt.id;
      const rate = derive(state).deckRate;
      if (rate.gt(bestRate)) { bestRate = rate; best = opt.id; }
    }
    state.numbering = current;
    selectNumbering(state, best);
  };

  const newHand = () => {
    board = game.deal(rng, {}, NO_TWISTS);
    seen = new Set();
    dealHand(state, bus, 'klondike', 0);
    res.hands++;
    handStart = t;
  };
  dealHand(state, bus, 'klondike', 0);
  res.hands++;

  while (t < total) {
    // Idle time is stepped coarsely: `step` never clamps, and a sleeping player's rate is constant,
    // so a 30 s slice is the same arithmetic as 120 quarter-second ones.
    const stepDt = playing ? dt : Math.min(30, Math.max(dt, total - t));
    step(state, stepDt, bus);
    t += stepDt;
    state.lastSeenAt = t * 1000;
    const d = derive(state);
    if (res.firstAwakeAt === null && d.awakeCount > 0) res.firstAwakeAt = t;
    if (res.allAwakeAt === null && d.awakeCount >= 52) {
      res.allAwakeAt = t;
      if (res.firstCutAt === null) res.allAwakeInFirstRun = true;
    }
    // Fill any due post-cut rate probes.
    for (let k = 0; k < res.cuts.length; k++) {
      const cut = res.cuts[k];
      if (!cut) continue;
      if (res.log10RateAfterCut[k] == null && t >= cut.t + PROBE_SECONDS) {
        res.log10RateAfterCut[k] = log10(d.deckRate);
      }
    }

    // Day boundary for the relaxer.
    if (t - dayStart >= 86400) { dayStart = t; handsToday = 0; playing = true; }
    if (profile === 'idle' && res.hands > 1) playing = false;
    if (profile === 'relaxer' && handsToday >= 3) playing = false;

    if (playing) {
      moveAcc += stepDt;
      if (moveAcc >= movePeriod) {
        moveAcc = 0;
        const mv = nextMove(game, board, NO_TWISTS, seen);
        if (!mv || t - handStart > 900) {
          handsToday++;
          newHand();
        } else {
          seen.add(game.hash(board));
          const r = mv.kind === 'draw' ? game.draw(board, NO_TWISTS) : game.move(board, mv.pile, mv.index, mv.to, NO_TWISTS);
          if (r.changed) {
            board = r.board;
            for (const id of r.homed) homeCard(state, bus, id, 'sim');
            if (r.homed.length === 0 && mv.kind !== 'draw') tableauSpark(state, bus);
            if (r.won) { winHand(state, bus, { game: 'klondike', moves: 0, seconds: t - handStart }); res.wins++; handsToday++; newHand(); }
          }
        }
      }

      if (profile === 'engaged') {
        // Greedy buyer: every 5 s, the cheapest affordable Constellation node, else the cheapest
        // affordable run upgrade. `visibleUpgrades` runs every tick so reveal timing is honest.
        const ups = visibleUpgrades(state, bus);
        buyAcc += stepDt;
        if (buyAcc >= 5) {
          buyAcc = 0;
          const nodes = visibleNodes(state).filter((n) => canBuyNode(state, n.id));
          nodes.sort((a, b) => nodeCost(state, a.id).cmp(nodeCost(state, b.id)));
          const n = nodes[0];
          if (n) {
            buyNode(state, bus, n.id);
          } else {
            const affordable = ups.filter((u) => maxAffordable(state, u.id) > 0);
            affordable.sort((a, b) => upgradeCost(state, a.id).cmp(upgradeCost(state, b.id)));
            const u = affordable[0];
            if (u) buyUpgrade(state, bus, u.id, 1);
          }
        }

      }
    }

    // Cut availability, and (engaged only) the cut policy. Checked at 1 Hz on a FRESH derive:
    // this tick's moves may have woken cards or paid a burst since `d` was taken.
    cutCheckAcc += stepDt;
    if (cutCheckAcc >= 1) {
      cutCheckAcc = 0;
      const dNow = derive(state);
      if (res.firstCutAvailableAt === null && canCut(state, dNow)) res.firstCutAvailableAt = t;
      // Take the cut as soon as it is worth taking, but once a few are banked, hold out for a run
      // worth ~30 % of everything banked so far.
      if (profile === 'engaged' && playing && canCut(state, dNow)) {
        const n2 = cutsOnCut(state, dNow);
        const lifetime = state.prestige.lifetimeCuts;
        if (lifetime.lt(3) || n2.gte(lifetime.times(0.3))) {
          const before = log10(dNow.deckRate);
          const earned = performCut(state, bus, 'hand', t * 1000);
          if (earned.gt(0)) {
            const cycle = res.cycles[res.cycles.length - 1];
            const banked = cycleCutsOf(state).toNumber();
            res.cuts.push({
              t, earned: earned.toNumber(), log10RateBefore: before,
              cycle: cycle ? cycle.index : 0, cycleCuts: banked
            });
            if (cycle) cycle.cutsInCycle = banked;
            res.log10RateAfterCut.push(null);
            if (res.firstCutAt === null) res.firstCutAt = t;
            newHand();
          }
        }
      }

      // Layer 2. Take the reshuffle as soon as it is worth taking, but once permutations are
      // banked, hold out for a cycle worth half of everything banked so far — the same shape of
      // policy the cut uses, one layer up.
      if (profile === 'engaged' && playing) {
        const dRe = derive(state);
        if (canReshuffle(state, dRe)) {
          const gain = permutationsOnReshuffle(state, dRe);
          const bar = Math.max(1, 0.5 * state.prestige.lifetimePermutations.toNumber());
          if (gain.gte(bar)) {
            const ending = res.cycles[res.cycles.length - 1];
            const banked = cycleCutsOf(state).toNumber();
            const earned = performReshuffle(state, bus, t * 1000);
            if (earned.gt(0)) {
              if (ending) { ending.end = t; ending.cutsInCycle = banked; }
              res.reshuffles.push({ t, earned: earned.toNumber(), cycleCuts: banked });
              if (res.firstReshuffleAt === null) res.firstReshuffleAt = t;
              const next = cycleOf(res.cycles.length);
              next.start = t;
              res.cycles.push(next);
              buyCheapestNumbering();
              pickBestNumbering();
              newHand();
            }
          }
        }
      }
    }

    if (t >= nextSample) {
      nextSample += Math.max(60, total / 48);
      res.samples.push({ t, rate: formatRate(d.deckRate), awake: d.awakeCount, lifetime: formatNumber(state.lifetimeShuffles) });
    }
  }
  const d = derive(state);
  res.finalRate = formatRate(d.deckRate);
  res.lifetime = formatNumber(state.lifetimeShuffles);
  res.lifetimeLog10 = log10(state.lifetimeShuffles);
  res.finalRateLog10 = log10(d.deckRate);
  res.wins = state.stats.totalWins;
  res.lifetimeCuts = state.prestige.lifetimeCuts.toNumber();
  res.nodes = { ...state.prestige.constellation };
  res.lifetimePermutations = state.prestige.lifetimePermutations.toNumber();
  res.unlockedNumberings = [...state.unlockedNumberings];
  res.numbering = state.numbering;
  const open = res.cycles[res.cycles.length - 1];
  if (open && open.end === null) open.cutsInCycle = cycleCutsOf(state).toNumber();
  return res;
}
