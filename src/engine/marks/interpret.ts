/**
 * The Mark interpreter (docs/02-game-design.md §4, ADR-006). PURE.
 *
 * Marks are rules over the event bus: an event comes in, a placed mark reacts, and the reaction is
 * itself emitted as events — so chains emerge without any mark knowing about any other one.
 *
 * RE-ENTRANCY. `bus.emit` is synchronous, so an effect emitted here re-enters this same listener
 * immediately. Every effect therefore carries a `depth`: 0 for a player-caused event, +1 for each
 * link of the chain. The interpreter ignores any event at `depth >= DEPTH_CAP`, which is what makes
 * a chain finite — a branching factor of 2 (Kindling) over 3 levels is at most 15 effects.
 *
 * `mark-fired` is emitted BEFORE the mark's effects, carrying the depth of the event that fired it,
 * so a presenter sees the mark light up and then the consequences arrive.
 */
import { MARKS } from '$content/index';
import { chargeCard, homeSpark, spark, wakeCard } from '../economy/cards';
import { cardDef, cardId } from '../types';
import type { CardId, Rank } from '../types';
import type { EventBus } from '../events';
import type { GameState, HandState } from '../state';
import { hasMark, placementOf, revealAvailableMarks } from './placement';

/** Events at or beyond this depth are ignored: the one thing standing between a chain and a loop. */
export const DEPTH_CAP = 3;
/** Twin is the wire everything else hangs from, so it stops one link earlier than the cap. */
const TWIN_DEPTH_CAP = 2;

/** Per-hand scratch, repaired in place if a host handed us a state that predates it. */
function handState(state: GameState): HandState {
  const hand = state.run.hand;
  if (!hand || !Array.isArray(hand.echoRanks) || !Array.isArray(hand.homedThisHand)) {
    state.run.hand = { echoRanks: [], homedThisHand: [], roll: 1 };
    return state.run.hand;
  }
  return hand;
}

function fired(bus: EventBus, mark: string, card: CardId, depth: number): void {
  bus.emit({ type: 'mark-fired', mark, card, depth });
}

/**
 * Echo, both halves. First the payoff: a rank armed earlier this hand is spent on the card now
 * coming home, which gains a charge and a second spark (the "x2 spark" of the rule — the home play
 * pays the first). Then the arming: an Echo card coming home remembers its own rank, and cannot
 * pay itself off with the rank it just armed.
 */
function onHome(state: GameState, bus: EventBus, card: CardId): void {
  const hand = handState(state);
  if (!hand.homedThisHand.includes(card)) hand.homedThisHand.push(card);
  const rank = cardDef(card).rank;

  const armed = hand.echoRanks.indexOf(rank);
  if (armed >= 0) {
    hand.echoRanks.splice(armed, 1);
    fired(bus, 'echo', card, 0);
    chargeCard(state, bus, card, 'mark', 1);
    spark(state, bus, homeSpark(state), card);
  }

  if (hasMark(state, card, 'echo')) hand.echoRanks.push(rank);
}

/** Kindling: charge travels to the rank-neighbours in the same suit. */
function onKindling(state: GameState, bus: EventBus, card: CardId, depth: number): void {
  if (!hasMark(state, card, 'kindling')) return;
  const { suit, rank } = cardDef(card);
  fired(bus, 'kindling', card, depth);
  for (const r of [rank - 1, rank + 1]) {
    if (r < 1 || r > 13) continue;
    chargeCard(state, bus, cardId(suit, r as Rank), 'mark', depth + 1);
  }
}

/**
 * Twin: what happens to one happens to the other — a wake if the partner is asleep, a charge if it
 * is not. The partner's charge re-enters here at depth+1, so `TWIN_DEPTH_CAP` (below the global
 * cap) is what keeps a pair from ringing back and forth.
 */
function onTwin(state: GameState, bus: EventBus, card: CardId, depth: number): void {
  if (depth >= TWIN_DEPTH_CAP) return;
  const placed = placementOf(state, card, 'twin');
  if (!placed) return;
  const partner = placed.cards.find((c) => c !== card);
  if (partner === undefined) return;

  fired(bus, 'twin', card, depth);
  if (state.cards[partner]?.awake) {
    chargeCard(state, bus, partner, 'mark', depth + 1);
  } else {
    wakeCard(state, bus, partner, depth + 1);
  }
}

/** Heavy: a tableau move charges the card. Never a wake — Heavy cannot start a generator. */
function onMoved(state: GameState, bus: EventBus, card: CardId, depth: number): void {
  if (!hasMark(state, card, 'heavy')) return;
  fired(bus, 'heavy', card, depth);
  chargeCard(state, bus, card, 'mark', depth + 1);
}

/**
 * Subscribes the interpreter to the bus. Returns the unsubscribe function; the host attaches this
 * once, beside the presenters. Attaching twice would double every trigger, so don't.
 */
export function attachMarks(state: GameState, bus: EventBus): () => void {
  return bus.on((e) => {
    switch (e.type) {
      case 'card-home':
        // A home play is always player-caused: depth 0.
        onHome(state, bus, e.card);
        break;
      case 'charge-gained': {
        const depth = e.depth ?? 0;
        if (depth >= DEPTH_CAP) return;
        onKindling(state, bus, e.card, depth);
        onTwin(state, bus, e.card, depth);
        break;
      }
      case 'card-woken': {
        const depth = e.depth ?? 0;
        if (depth >= DEPTH_CAP) return;
        onTwin(state, bus, e.card, depth);
        break;
      }
      case 'card-moved': {
        const depth = e.depth ?? 0;
        if (depth >= DEPTH_CAP) return;
        onMoved(state, bus, e.card, depth);
        break;
      }
      case 'cut':
        // A Cut is the only thing that can unlock a mark, so it is the only place to announce one.
        revealAvailableMarks(state, bus);
        break;
      default:
        break;
    }
  });
}

/** Mark ids that fire on events, for a UI that wants to explain why something happened. */
export const TRIGGER_MARKS: readonly string[] = MARKS.filter((m) => m.kind === 'trigger').map((m) => m.id);
