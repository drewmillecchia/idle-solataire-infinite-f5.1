/**
 * Core engine types. PURE: no DOM, no Svelte, no Pixi. See CLAUDE.md invariants.
 */
import type Decimal from 'break_eternity.js';
import { STANDARD_52, cardDefAnywhere, deckCards } from './deck';

/** The four suits value is made of. Ascension appends Stars and Moons here (docs/12). */
export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
/**
 * The suit slot on a card. 'J' is "belongs to no suit" — the Joker. Anything that indexes BY suit
 * (a suit multiplier, a per-suit total) takes `Suit` and must decide what an unsuited card does;
 * `isSuited` is that check, and the answer so far is always "it sits out".
 */
export type CardSuit = Suit | 'J';
/** Rank 1 = Ace ... 13 = King. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/** The rank slot on a card. 0 is "has no rank of its own" — the Joker again. */
export type CardRank = Rank | 0;

/** Stable card identity: an index into the card universe in `deck.ts`. 0..51 is the standard deck. */
export type CardId = number;

export interface CardDef {
  id: CardId;
  suit: CardSuit;
  rank: CardRank;
}

/**
 * STANDARD DECK ONLY: `suitIndex*13 + (rank-1)`. Shape-aware code (anything that does not know
 * it is always the standard 52) should use `cardDefIn`/`deckCards` from `./deck` instead.
 */
export function cardId(suit: Suit, rank: Rank): CardId {
  return SUITS.indexOf(suit) * 13 + (rank - 1);
}
/**
 * The card with this id, from the universe every deck shape is a prefix of — so this answers for
 * the Joker too, not only for 0..51. Use `cardDefIn` when you need "and it must be in THIS deck".
 */
export function cardDef(id: CardId): CardDef {
  return cardDefAnywhere(id);
}
export function isRed(suit: CardSuit): boolean {
  return suit === 'H' || suit === 'D';
}
/** Narrows off the unsuited cards (the Joker), so `Record<Suit, ...>` indexing stays honest. */
export function isSuited(suit: CardSuit): suit is Suit {
  return suit !== 'J';
}
export const STANDARD_DECK: readonly CardDef[] = deckCards(STANDARD_52);

/** Per-card generator state. A card earns nothing until `awake`. */
export interface CardState {
  awake: boolean;
  /** Times played home after waking. */
  charge: number;
  /** Mark ids placed on this card. */
  marks: string[];
}

export type NumberingId =
  | 'natural' | 'prime' | 'triangular' | 'fibonacci' | 'powers' | 'factorial' | 'tetration';

export type WayId = 'none' | 'hand' | 'dealer' | 'gambler' | 'scholar';

/** Events the logic emits. Presenters (table FX, sound, haptics, toasts) subscribe. */
export type GameEvent =
  | { type: 'card-home'; card: CardId; first: boolean; pile: string }
  /** A tableau move (not home). The host emits it; the Heavy mark listens. */
  | { type: 'card-moved'; card: CardId; from: string; to: string; depth?: number }
  | { type: 'card-woken'; card: CardId; depth?: number }
  | { type: 'charge-gained'; card: CardId; charge: number; source: 'home' | 'mark' | 'way'; depth?: number }
  | { type: 'spark'; amount: Decimal; anchor?: CardId }
  | { type: 'hand-won'; burst: Decimal; game: string; moves: number; seconds: number }
  | { type: 'hand-dealt'; game: string; seed: number }
  | { type: 'milestone'; id: string; value: string }
  | { type: 'reveal'; feature: string }
  | { type: 'cut'; cuts: Decimal; way: WayId }
  | { type: 'reshuffle'; permutations: Decimal }
  /** `fizzled` is set only by Way of the Gambler's Mark fizzle (docs/02 §5); absent everywhere else. */
  | { type: 'mark-fired'; mark: string; card: CardId; depth: number; fizzled?: boolean }
  | { type: 'purchase'; id: string; count: number };

export type EventListener = (e: GameEvent) => void;
