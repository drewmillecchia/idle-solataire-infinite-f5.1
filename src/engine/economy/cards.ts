/**
 * Card generators: waking and charging (docs/02-game-design.md §2). PURE.
 */
import Decimal from 'break_eternity.js';
import { D } from '../numbers';
import { derive } from './derive';
import type { EventBus } from '../events';
import type { CardId } from '../types';
import type { GameState } from '../state';

/**
 * Plays a card home. First time: wakes it (permanent output, no spark). Subsequent times:
 * gains a charge and pays a small spark. Order of events matches docs/02 §2 and §10.
 */
export function homeCard(state: GameState, bus: EventBus, card: CardId, pile: string): void {
  const c = state.cards[card];
  if (!c) throw new RangeError(`bad card id ${card}`);

  const first = !c.awake;
  if (first) {
    c.awake = true;
    bus.emit({ type: 'card-home', card, first: true, pile });
    bus.emit({ type: 'card-woken', card });
  } else {
    c.charge += 1;
    bus.emit({ type: 'charge-gained', card, charge: c.charge, source: 'home' });
    bus.emit({ type: 'card-home', card, first: false, pile });
  }

  const d = derive(state);
  const sparkAmount = first ? D(0) : Decimal.max(d.deckRate.times(0.25).times(d.sparkMult), 1);
  state.shuffles = state.shuffles.plus(sparkAmount);
  state.lifetimeShuffles = state.lifetimeShuffles.plus(sparkAmount);
  bus.emit({ type: 'spark', amount: sparkAmount, anchor: card });

  state.run.homedThisRun += 1;
  state.stats.totalHomed += 1;
}

/** A tableau move (not home) — a tiny one-off acknowledgement so every move feels felt. */
export function tableauSpark(state: GameState, bus: EventBus, anchor?: CardId): void {
  const d = derive(state);
  const amount = Decimal.max(d.deckRate.times(0.05).times(d.sparkMult), 1);
  state.shuffles = state.shuffles.plus(amount);
  state.lifetimeShuffles = state.lifetimeShuffles.plus(amount);
  if (anchor === undefined) {
    bus.emit({ type: 'spark', amount });
  } else {
    bus.emit({ type: 'spark', amount, anchor });
  }
}
