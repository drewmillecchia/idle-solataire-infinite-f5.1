/**
 * Core engine types. PURE: no DOM, no Svelte, no Pixi. See CLAUDE.md invariants.
 */
import type Decimal from 'break_eternity.js';

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
/** Rank 1 = Ace … 13 = King. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** Stable card identity 0..51: suitIndex*13 + (rank-1). Ascension decks extend past 51. */
export type CardId = number;

export interface CardDef {
  id: CardId;
  suit: Suit;
  rank: Rank;
}

export function cardId(suit: Suit, rank: Rank): CardId {
  return SUITS.indexOf(suit) * 13 + (rank - 1);
}
export function cardDef(id: CardId): CardDef {
  const suit = SUITS[Math.floor(id / 13)];
  if (!suit) throw new RangeError(`bad card id ${id}`);
  return { id, suit, rank: ((id % 13) + 1) as Rank };
}
export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}
export const STANDARD_DECK: readonly CardDef[] = Array.from({ length: 52 }, (_, i) => cardDef(i));

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
  | { type: 'card-woken'; card: CardId }
  | { type: 'charge-gained'; card: CardId; charge: number; source: 'home' | 'mark' | 'way' }
  | { type: 'spark'; amount: Decimal; anchor?: CardId }
  | { type: 'hand-won'; burst: Decimal; game: string; moves: number; seconds: number }
  | { type: 'hand-dealt'; game: string; seed: number }
  | { type: 'milestone'; id: string; value: string }
  | { type: 'reveal'; feature: string }
  | { type: 'cut'; cuts: Decimal; way: WayId }
  | { type: 'reshuffle'; permutations: Decimal }
  | { type: 'mark-fired'; mark: string; card: CardId; depth: number }
  | { type: 'purchase'; id: string; count: number };

export type EventListener = (e: GameEvent) => void;
