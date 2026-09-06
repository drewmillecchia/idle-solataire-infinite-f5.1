/**
 * Deck shapes: the size and composition of "a deck" as data the engine reads, not a 52 it
 * assumes. PURE. See docs/12-ascension.md, "Sequencing" step 1: exactly one shape exists today
 * (the standard 52) and everything reads it through this module, with no behaviour change.
 * Ascension adds shapes here later; the modules that call `deckSize` / `deckCards` / `cardDefIn`
 * do not change.
 */
import type { CardDef, CardId, Rank, Suit } from './types';

// Local literals, NOT imported from './types': types.ts's `STANDARD_DECK` is itself built from
// `STANDARD_52` below (via `deckCards`), so importing types.ts's runtime `SUITS`/`RANKS` here
// would be a circular runtime dependency between the two modules.
const STANDARD_SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const STANDARD_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * A card outside the suit x rank grid, e.g. a future Joker. None exist yet — every shape defined
 * today has an empty `extras`. `rank` is the value the numbering systems should use; 0 means "has
 * no rank of its own" (docs/12-ascension.md: the Joker earns what the highest-charged card
 * earns — a rule for Ascension to add, not this refactor).
 */
export interface ExtraCardDef {
  id: CardId;
  name: string;
  rank: number;
}

export interface DeckShape {
  id: string;
  name: string;
  suits: readonly Suit[];
  ranks: readonly Rank[];
  /** Cards outside the suit x rank grid, e.g. a Joker. Empty for now. */
  extras: readonly ExtraCardDef[];
}

export const STANDARD_52: DeckShape = {
  id: 'standard-52',
  name: 'Standard 52',
  suits: STANDARD_SUITS,
  ranks: STANDARD_RANKS,
  extras: []
};

export const DECK_SHAPES: Record<string, DeckShape> = {
  [STANDARD_52.id]: STANDARD_52
};

/** Looks up a shape by id. An unknown id falls back to the standard 52 (CLAUDE.md invariant #10: defensive, never throw). */
export function deckShape(id: string): DeckShape {
  return DECK_SHAPES[id] ?? STANDARD_52;
}

/** Total card count of a shape: the suit x rank grid plus its extras. */
export function deckSize(shape: DeckShape): number {
  return shape.suits.length * shape.ranks.length + shape.extras.length;
}

interface BuiltDeck {
  cards: readonly CardDef[];
  byId: ReadonlyMap<CardId, CardDef>;
}

const DECK_CACHE = new Map<string, BuiltDeck>();

function build(shape: DeckShape): BuiltDeck {
  const cards: CardDef[] = [];
  let id = 0;
  for (const suit of shape.suits) {
    for (const rank of shape.ranks) {
      cards.push({ id, suit, rank });
      id++;
    }
  }
  // Extras sit outside the suit x rank grid; how one maps onto `CardDef.suit` is an Ascension
  // design question (the Joker), deferred until a shape actually has one. Every shape defined
  // today has `extras: []`, so this loop never runs; it exists so `deckCards`/`cardDefIn` already
  // have somewhere to grow into.
  for (const extra of shape.extras) {
    const suit = shape.suits[0];
    if (!suit) continue;
    cards.push({ id: extra.id, suit, rank: extra.rank as Rank });
  }
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  return { cards, byId };
}

function cached(shape: DeckShape): BuiltDeck {
  let built = DECK_CACHE.get(shape.id);
  if (!built) {
    built = build(shape);
    DECK_CACHE.set(shape.id, built);
  }
  return built;
}

/** Every card in `shape`, in id order. Memoised per shape id. */
export function deckCards(shape: DeckShape): readonly CardDef[] {
  return cached(shape).cards;
}

/**
 * `cardDef(id)` for an arbitrary shape: a lookup built once per shape, NOT `id / 13` arithmetic.
 * Throws for an id outside the shape, same as the standard-deck-only `cardDef` in types.ts.
 */
export function cardDefIn(shape: DeckShape, id: CardId): CardDef {
  const def = cached(shape).byId.get(id);
  if (!def) throw new RangeError(`bad card id ${id} for deck ${shape.id}`);
  return def;
}
