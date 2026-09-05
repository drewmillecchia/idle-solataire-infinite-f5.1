/**
 * Card generators: waking and charging (docs/02-game-design.md §2). PURE.
 */
import Decimal from 'break_eternity.js';
import { D } from '../numbers';
import { derive } from './derive';
import type { EventBus } from '../events';
import type { CardId } from '../types';
import type { GameState } from '../state';

/** Where a charge came from. Marks pass 'mark'; a Way effect would pass 'way'. */
export type ChargeSource = 'home' | 'mark' | 'way';

/** Pays shuffles and announces them. The ONE place a spark reaches the balance. */
export function spark(state: GameState, bus: EventBus, amount: Decimal, anchor?: CardId): void {
  state.shuffles = state.shuffles.plus(amount);
  state.lifetimeShuffles = state.lifetimeShuffles.plus(amount);
  if (anchor === undefined) {
    bus.emit({ type: 'spark', amount });
  } else {
    bus.emit({ type: 'spark', amount, anchor });
  }
}

/** The spark a home play pays: a quarter-second of the deck, floored at one. */
export function homeSpark(state: GameState): Decimal {
  const d = derive(state);
  return Decimal.max(d.deckRate.times(0.25).times(d.sparkMult), 1);
}

/**
 * +1 charge with no spark: the currency Marks deal in. `depth` is the chain depth of the effect
 * (0 is player-caused), carried on the event so the interpreter can stop a runaway chain.
 */
export function chargeCard(
  state: GameState,
  bus: EventBus,
  card: CardId,
  source: ChargeSource,
  depth: number
): void {
  const c = state.cards[card];
  if (!c) return;
  c.charge += 1;
  bus.emit({ type: 'charge-gained', card, charge: c.charge, source, depth });
}

/** Wakes a sleeping card with no spark and no home play. No-op if it is already awake. */
export function wakeCard(state: GameState, bus: EventBus, card: CardId, depth: number): void {
  const c = state.cards[card];
  if (!c || c.awake) return;
  c.awake = true;
  bus.emit({ type: 'card-woken', card, depth });
}

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
    bus.emit({ type: 'card-woken', card, depth: 0 });
  } else {
    c.charge += 1;
    bus.emit({ type: 'charge-gained', card, charge: c.charge, source: 'home', depth: 0 });
    bus.emit({ type: 'card-home', card, first: false, pile });
  }

  spark(state, bus, first ? D(0) : homeSpark(state), card);

  state.run.homedThisRun += 1;
  state.stats.totalHomed += 1;
}

/** A tableau move (not home) — a tiny one-off acknowledgement so every move feels felt. */
export function tableauSpark(state: GameState, bus: EventBus, anchor?: CardId): void {
  const d = derive(state);
  spark(state, bus, Decimal.max(d.deckRate.times(0.05).times(d.sparkMult), 1), anchor);
}
