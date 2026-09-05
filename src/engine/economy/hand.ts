/**
 * Hand lifecycle: dealing and winning (docs/02-game-design.md §2, §10). PURE.
 * Both the player and the Auto-Dealer route wins through `winHand`.
 */
import type Decimal from 'break_eternity.js';
import { derive } from './derive';
import type { EventBus } from '../events';
import type { GameState } from '../state';

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
  state.run.handsWon += 1;
  state.stats.totalWins += 1;

  bus.emit({ type: 'hand-won', burst, game: params.game, moves: params.moves, seconds: params.seconds });
  return burst;
}

/** Starts a new hand: resets the per-hand undo counter and bumps hand-played counters. */
export function dealHand(state: GameState, bus: EventBus, game: string, seed: number): void {
  state.run.handsPlayed += 1;
  state.stats.totalHands += 1;
  state.run.undosThisHand = 0;
  bus.emit({ type: 'hand-dealt', game, seed });
}
