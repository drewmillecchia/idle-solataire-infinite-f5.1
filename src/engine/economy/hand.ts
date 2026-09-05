/**
 * Hand lifecycle: dealing and winning (docs/02-game-design.md §2, §10). PURE.
 * Both the player and the Auto-Dealer route wins through `winHand`.
 */
import type Decimal from 'break_eternity.js';
import { derive } from './derive';
import { mulberry32 } from '../rng';
import type { EventBus } from '../events';
import type { GameState } from '../state';

/**
 * Way of the Gambler (docs/02-game-design.md §5): every deal is a wager. The roll is LOG-uniform
 * over [ROLL_MIN, ROLL_MAX] — `0.5 x 6^u` — so "half" and "double" are equally likely draws and
 * the geometric mean is 1.22x. A uniform roll would sit at 1.75x and make the Gambler strictly
 * best; log-uniform makes it a real wager.
 */
export const ROLL_MIN = 0.5;
export const ROLL_MAX = 3;

/** The Gambler's roll for a given seed. Deterministic: the same seed always gives the same wager. */
export function gamblerRoll(seed: number): number {
  const u = mulberry32(seed >>> 0)();
  const roll = ROLL_MIN * Math.pow(ROLL_MAX / ROLL_MIN, u);
  return Math.min(ROLL_MAX, Math.max(ROLL_MIN, roll));
}

/**
 * The seed a win re-rolls from. `winHand` takes no seed, so it is mixed deterministically out of
 * the state that identifies this win: the hand's own roll and the wins banked so far. Same state,
 * same re-roll — which is what makes a save round-trip reproducible.
 */
export function rerollSeed(state: GameState): number {
  const fromRoll = Math.floor(state.run.hand.roll * 1e6);
  return (Math.imul(fromRoll, 0x9e3779b1) ^ Math.imul(state.run.handsWon + 1, 0x85ebca6b)) >>> 0;
}

export interface WinHandParams {
  game: string;
  moves: number;
  seconds: number;
}

/** Pays the win burst: 60s of deckRate x burstMult, halved-ish (x0.7) if the hand used an undo. */
export function winHand(state: GameState, bus: EventBus, params: WinHandParams): Decimal {
  const d = derive(state);
  const undoPenalty = state.run.undosThisHand > 0 ? 0.7 : 1;
  const burst = d.deckRate.times(60).times(d.burstMult).times(undoPenalty);

  state.shuffles = state.shuffles.plus(burst);
  state.lifetimeShuffles = state.lifetimeShuffles.plus(burst);
  // The Gambler re-rolls on a win and KEEPS THE BETTER of the two: a win can only improve the
  // wager, never spoil it. The burst above is paid at the pre-win roll, which is the roll the
  // player was looking at while playing the hand. Rolled BEFORE the counters move, so `rerollSeed`
  // reads the same state a caller can reconstruct.
  if (state.run.way === 'gambler') {
    state.run.hand.roll = Math.max(state.run.hand.roll, gamblerRoll(rerollSeed(state)));
  }

  state.run.handsWon += 1;
  state.stats.totalWins += 1;

  bus.emit({ type: 'hand-won', burst, game: params.game, moves: params.moves, seconds: params.seconds });
  return burst;
}

/**
 * Starts a new hand: resets the per-hand undo counter and the per-hand Mark scratch (Echo's armed
 * ranks do not survive the deal), rolls the Gambler's wager from the deal seed, and bumps the
 * hand-played counters.
 */
export function dealHand(state: GameState, bus: EventBus, game: string, seed: number, opts: { count?: boolean } = {}): void {
  // A restore/boot deal is not a hand the player chose to play; it must not inflate the counters.
  if (opts.count !== false) {
    state.run.handsPlayed += 1;
    state.stats.totalHands += 1;
  }
  state.run.undosThisHand = 0;
  state.run.hand = {
    echoRanks: [],
    homedThisHand: [],
    roll: state.run.way === 'gambler' ? gamblerRoll(seed) : 1
  };
  bus.emit({ type: 'hand-dealt', game, seed });
}
