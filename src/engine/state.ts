/**
 * Save-shape game state and its factory. PURE. See CLAUDE.md invariants #5 and #10.
 */
import Decimal from 'break_eternity.js';
import { D } from './numbers';
import type { CardState, NumberingId, WayId } from './types';

/** Bump on any state-shape change; add a matching branch in save/migrate.ts. */
export const SAVE_VERSION = 1;

export interface RunState {
  way: WayId;
  startedAt: number;
  /** Upgrade id -> owned levels. */
  upgrades: Record<string, number>;
  handsPlayed: number;
  handsWon: number;
  homedThisRun: number;
  undosThisHand: number;
}

export interface PrestigeState {
  cuts: Decimal;
  lifetimeCuts: Decimal;
  cutsPerformed: number;
  permutations: Decimal;
  lifetimePermutations: Decimal;
  reshuffles: number;
  /** Constellation node id -> level. */
  constellation: Record<string, number>;
}

export interface SettingsState {
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  autoDealerDelaySeconds: number;
  shuffleStyle: 'riffle' | 'overhand' | 'random';
}

export interface StatsState {
  totalHomed: number;
  totalHands: number;
  totalWins: number;
  bestRate: Decimal;
  playSeconds: number;
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
      upgrades: {},
      handsPlayed: 0,
      handsWon: 0,
      homedThisRun: 0,
      undosThisHand: 0
    },
    prestige: {
      cuts: D(0),
      lifetimeCuts: D(0),
      cutsPerformed: 0,
      permutations: D(0),
      lifetimePermutations: D(0),
      reshuffles: 0,
      constellation: {}
    },
    revealed: [],
    milestones: [],
    settings: {
      sound: true,
      haptics: true,
      reducedMotion: false,
      autoDealerDelaySeconds: 12,
      shuffleStyle: 'riffle'
    },
    stats: {
      totalHomed: 0,
      totalHands: 0,
      totalWins: 0,
      bestRate: D(0),
      playSeconds: 0
    },
    activeGame: 'klondike',
    gameConfig: {}
  };
}
