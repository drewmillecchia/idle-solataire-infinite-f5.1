/**
 * Deck shapes: the size and composition of "a deck" as data the engine reads, not a 52 it
 * assumes. PURE. See docs/12-ascension.md.
 *
 * THE MODEL: there is one append-only **universe** of cards, and every deck shape is a PREFIX of
 * it. The standard 52 is the first 52; the Joker deck is those plus the Joker at id 52; a future
 * Stars suit appends at 53 and up. Three things fall out of that, and they are the reason for it:
 *
 *   - A card id means the same card in every shape, so a Mark placed on the seven of hearts stays
 *     on the seven of hearts across an Ascension (docs/12: placements survive where the card does).
 *   - `state.cards` stays a dense array indexed by id, sized `deckSize(shape)`.
 *   - `cardDef(id)` needs no shape argument, so games, marks and the renderer never thread one.
 *
 * The rule this buys is simple to keep: **never insert into the middle of the universe, only
 * append.** Reordering it would silently move every save's Marks onto different cards.
 */
import type { CardDef, CardId, CardRank, CardSuit, Rank, Suit } from './types';

// Local literals, NOT imported from './types': types.ts's `STANDARD_DECK` is itself built from
// `STANDARD_52` below (via `deckCards`), so importing types.ts's runtime `SUITS`/`RANKS` here
// would be a circular runtime dependency between the two modules.
const STANDARD_SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const STANDARD_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * A card outside the suit x rank grid. `rank` 0 means "has no rank of its own" and `suit` 'J'
 * means "belongs to no suit" — the Joker is both, and is wild in every game because of it
 * (`isJoker` below; `rules/module.ts` folds it into the Wild twist).
 */
export interface ExtraCardDef {
  name: string;
  suit: CardSuit;
  rank: CardRank;
}

export const JOKER: ExtraCardDef = { name: 'Joker', suit: 'J', rank: 0 };

export interface DeckShape {
  id: string;
  name: string;
  suits: readonly Suit[];
  ranks: readonly Rank[];
  /** Cards outside the suit x rank grid, in universe order after the grid. */
  extras: readonly ExtraCardDef[];
}

// --------------------------------------------------------------- universe ---

const UNIVERSE: CardDef[] = [];

function appendGrid(suits: readonly Suit[], ranks: readonly Rank[]): void {
  for (const suit of suits) {
    for (const rank of ranks) UNIVERSE.push({ id: UNIVERSE.length, suit, rank });
  }
}

function appendExtra(extra: ExtraCardDef): void {
  UNIVERSE.push({ id: UNIVERSE.length, suit: extra.suit, rank: extra.rank });
}

// Ascension order. Append only — see the header. ids 0..51: the standard grid, S,H,D,C x A..K,
// exactly the ids the game has always used.
appendGrid(STANDARD_SUITS, STANDARD_RANKS);
/** The Joker's id. 52, and it will stay 52 however many shapes are added after it. */
export const JOKER_ID: CardId = UNIVERSE.length;
appendExtra(JOKER);

const BY_ID: ReadonlyMap<CardId, CardDef> = new Map(UNIVERSE.map((c) => [c.id, c] as const));

/** Every card that could ever exist, in universe order. A shape is a prefix of this. */
export const ALL_CARDS: readonly CardDef[] = UNIVERSE;

/** True for a card that is wild by nature rather than by a Mark: today, only the Joker. */
export function isJoker(id: CardId): boolean {
  return BY_ID.get(id)?.suit === 'J';
}

// ------------------------------------------------------------------ shapes ---

export const STANDARD_52: DeckShape = {
  id: 'standard-52',
  name: 'Standard 52',
  suits: STANDARD_SUITS,
  ranks: STANDARD_RANKS,
  extras: []
};

/** The first Ascension deck (docs/12-ascension.md): the standard 52 with the Joker on top. */
export const JOKER_53: DeckShape = {
  id: 'joker-53',
  name: 'The Joker',
  suits: STANDARD_SUITS,
  ranks: STANDARD_RANKS,
  extras: [JOKER]
};

export const DECK_SHAPES: Record<string, DeckShape> = {
  [STANDARD_52.id]: STANDARD_52,
  [JOKER_53.id]: JOKER_53
};

/** Shapes in Ascension order: each is a prefix of the next. */
export const DECK_LADDER: readonly DeckShape[] = [STANDARD_52, JOKER_53];

/** Looks up a shape by id. An unknown id falls back to the standard 52 (CLAUDE.md invariant #10: defensive, never throw). */
export function deckShape(id: string): DeckShape {
  return DECK_SHAPES[id] ?? STANDARD_52;
}

/** Total card count of a shape: the suit x rank grid plus its extras. */
export function deckSize(shape: DeckShape): number {
  return shape.suits.length * shape.ranks.length + shape.extras.length;
}

/** Every card in `shape`, in id order — the universe's first `deckSize(shape)` cards. */
export function deckCards(shape: DeckShape): readonly CardDef[] {
  return UNIVERSE.slice(0, deckSize(shape));
}

/** Just the ids, which is what a game's `deal` is handed. */
export function deckCardIds(shape: DeckShape): readonly CardId[] {
  return deckCards(shape).map((c) => c.id);
}

/**
 * `cardDef(id)` for an arbitrary shape: a universe lookup, NOT `id / 13` arithmetic.
 * Throws for an id outside the shape, same as the standard-deck-only `cardDef` in types.ts.
 */
export function cardDefIn(shape: DeckShape, id: CardId): CardDef {
  const def = BY_ID.get(id);
  if (!def || id >= deckSize(shape)) throw new RangeError(`bad card id ${id} for deck ${shape.id}`);
  return def;
}

/** `cardDef(id)` against the whole universe, for code that must read a card it may not hold. */
export function cardDefAnywhere(id: CardId): CardDef {
  const def = BY_ID.get(id);
  if (!def) throw new RangeError(`bad card id ${id}`);
  return def;
}
