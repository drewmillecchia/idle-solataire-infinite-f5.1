/**
 * Save-shape game state and its factory. PURE. See CLAUDE.md invariants #5 and #10.
 */
import Decimal from 'break_eternity.js';
import { D } from './numbers';
import type { CardId, CardState, NumberingId, WayId } from './types';

/** Bump on any state-shape change; add a matching branch in save/migrate.ts. */
export const SAVE_VERSION = 6;

/** Per-hand scratch for the Marks that only reach across one hand. Reset by `dealHand`. */
export interface HandState {
  /** Ranks an Echo card has armed this hand; the next home of that rank spends one. */
  echoRanks: number[];
  /** Cards played home this hand, in order. */
  homedThisHand: CardId[];
  /**
   * Way of the Gambler's wager for this hand: a multiplier in [0.5, 3] rolled by `dealHand` and
   * re-rolled upward by `winHand`. 1 (no effect) for every other Way, and the default everywhere
   * else, so a state that never met the Gambler behaves exactly as before.
   */
  roll: number;
  /** The deal seed `dealHand` was given. Feeds the Gambler's Mark fizzle (docs/02 §5). */
  seed: number;
  /**
   * Counter incremented on every trigger-mark opportunity this hand, whether or not it fizzles.
   * `marks/interpret.ts` mixes it with `seed` into `mulberry32` so a fizzle is deterministic and
   * a replay of the same events fizzles the same way — never `Math.random()`.
   */
  fizzleSeq: number;
}

export interface RunState {
  way: WayId;
  startedAt: number;
  /**
   * `lifetimeShuffles` at the moment this run began. `runEarned = lifetimeShuffles - earnedAtStart`,
   * which is how a Cut measures the run without ever touching the odometer (invariant #5).
   */
  earnedAtStart: Decimal;
  /** ms timestamp when the Cut first became reachable this run, or null. UI velocity hint only. */
  cutAvailableSeenAt: number | null;
  /** Upgrade id -> owned levels. */
  upgrades: Record<string, number>;
  handsPlayed: number;
  handsWon: number;
  homedThisRun: number;
  undosThisHand: number;
  hand: HandState;
}

export interface PrestigeState {
  cuts: Decimal;
  lifetimeCuts: Decimal;
  /**
   * `lifetimeCuts` at the moment the current Reshuffle cycle began (the seed a Reshuffle wrote, or
   * 0 before the first one). `cycleCuts = lifetimeCuts - cutsAtCycleStart` is what layer 2
   * measures — the layer-2 analogue of `run.earnedAtStart`.
   */
  cutsAtCycleStart: Decimal;
  cutsPerformed: number;
  permutations: Decimal;
  lifetimePermutations: Decimal;
  reshuffles: number;
  /** Constellation node id -> level. */
  constellation: Record<string, number>;
  /** Ways offered at the next Cut. The first Cut offers Hand and Dealer; others unlock on the tree. */
  waysUnlocked: WayId[];
}

/** One placement: a mark id and the cards it covers (2 for Twin, 1 otherwise). */
export interface PlacedMark {
  mark: string;
  cards: CardId[];
}

/**
 * Placed marks. THIS is the source of truth; `cards[i].marks` is a cache kept in step by
 * `engine/marks/placement.ts` (and rebuilt from here on load) so the renderer can read a card alone.
 */
export interface MarksState {
  placed: PlacedMark[];
}

export interface SettingsState {
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  autoDealerDelaySeconds: number;
  shuffleStyle: 'riffle' | 'overhand' | 'random';
  /** Opt-in cloud save (docs/07). Off by default: local storage is the truth, the network an optimisation. */
  cloud: boolean;
  /** Master audio volume, 0..1. Wired to `audio/presenters.ts`'s `setMasterVolume`. */
  volume: number;
}

/** What a player has done at one game. Keyed by `GameModule.id`. */
export interface GameRecord {
  hands: number;
  wins: number;
  /** Fastest win in seconds, or null before the first win. */
  bestSeconds: number | null;
}

export interface StatsState {
  totalHomed: number;
  totalHands: number;
  totalWins: number;
  bestRate: Decimal;
  playSeconds: number;
  /** Shortest run (seconds) that ended in a Cut, or null before the first Cut. */
  fastestCutSeconds: number | null;
  totalCuts: number;
  /** Hands, wins and best time per game. Lifetime — a Cut does not clear it. */
  perGame: Record<string, GameRecord>;
}

export interface GameState {
  version: number;
  createdAt: number;
  lastSeenAt: number;
  /** Spendable balance. */
  shuffles: Decimal;
  /** Monotonic odometer; never decreases through a reset. */
  lifetimeShuffles: Decimal;
  cards: CardState[];
  numbering: NumberingId;
  unlockedNumberings: NumberingId[];
  run: RunState;
  prestige: PrestigeState;
  marks: MarksState;
  revealed: string[];
  milestones: string[];
  settings: SettingsState;
  stats: StatsState;
  activeGame: string;
  gameConfig: Record<string, Record<string, string>>;
}

export function createInitialState(now: number): GameState {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeenAt: now,
    shuffles: D(0),
    lifetimeShuffles: D(0),
    cards: Array.from({ length: 52 }, () => ({ awake: false, charge: 0, marks: [] })),
    numbering: 'natural',
    unlockedNumberings: ['natural'],
    run: {
      way: 'none',
      startedAt: now,
      earnedAtStart: D(0),
      cutAvailableSeenAt: null,
      upgrades: {},
      handsPlayed: 0,
      handsWon: 0,
      homedThisRun: 0,
      undosThisHand: 0,
      hand: { echoRanks: [], homedThisHand: [], roll: 1, seed: 0, fizzleSeq: 0 }
    },
    prestige: {
      cuts: D(0),
      lifetimeCuts: D(0),
      cutsAtCycleStart: D(0),
      cutsPerformed: 0,
      permutations: D(0),
      lifetimePermutations: D(0),
      reshuffles: 0,
      constellation: {},
      waysUnlocked: ['hand', 'dealer']
    },
    marks: { placed: [] },
    revealed: [],
    milestones: [],
    settings: {
      sound: true,
      haptics: true,
      reducedMotion: false,
      autoDealerDelaySeconds: 12,
      shuffleStyle: 'riffle',
      cloud: false,
      volume: 0.7
    },
    stats: {
      totalHomed: 0,
      totalHands: 0,
      totalWins: 0,
      bestRate: D(0),
      playSeconds: 0,
      fastestCutSeconds: null,
      totalCuts: 0,
      perGame: {}
    },
    activeGame: 'klondike',
    gameConfig: {}
  };
}
