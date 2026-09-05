/**
 * TriPeaks — the second GameModule, and the contract proof: a layout with nothing in common with
 * Klondike (28 one-card piles that overlap in three peaks) implemented against the same interface.
 * PURE and IMMUTABLE: every move returns a fresh board. No DOM / Svelte / Pixi.
 * See src/rules/module.ts for THE contract.
 *
 * Shape (x in card widths, y in card heights; rows overlap by half a card):
 *
 *      row 0            p0                p1                p2                 y = 0.0
 *      row 1         p3    p4          p5    p6          p7    p8              y = 0.5
 *      row 2       p9  p10  p11    p12  p13  p14    p15  p16  p17              y = 1.0
 *      row 3     p18 p19 p20 p21 p22 p23 p24 p25 p26 p27                       y = 1.5
 *
 * A slot's card is *exposed* (pickable) when both slots that cover it are empty. Row 3 is covered by
 * nothing, so it starts exposed and face-up; rows 0-2 are face-down until uncovered.
 *
 * "Home" in a matching game is *removal*: every card played from the peaks onto the waste is reported
 * in `homed`, which is what wakes and charges its generator. Cards turned from the stock are not.
 *
 * Twists honoured:
 *  - wild  : the card may always be played onto the waste, and anything may be played onto it.
 *  - glass : `dealtFaceUp(card)` cards dealt into a covered slot stay visible in view().
 *  - mirror: irrelevant here — TriPeaks never looks at colour.
 */
import { cardDef, STANDARD_DECK } from '$engine/types';
import type { CardId } from '$engine/types';
import { mulberry32, shuffle } from '$engine/rng';
import {
  noop,
  NO_TWISTS,
  type BoardView,
  type GameConfig,
  type GameModule,
  type GameOption,
  type MoveResult,
  type PileView,
  type RulesEvent,
  type Twists
} from '../module';

export interface TriPeaksBoard {
  /** 28 tableau positions, one card or none each. Index = the slot id in `p<N>`. */
  slots: (CardId | null)[];
  /** Face-down draw pile; the TOP (next to turn) is the LAST element. */
  stock: CardId[];
  /** Face-up discard; the LAST element is the card everything must match. */
  waste: CardId[];
  moves: number;
  /** Cards the Glass twist dealt face-up while they sit in a still-covered slot. */
  glass: CardId[];
}

// -------------------------------------------------------------- geometry ---

export interface TriPeaksSlot {
  index: number;
  row: number;
  col: number;
  /** Grid position in card widths / card heights, as PileView wants it. */
  x: number;
  y: number;
  /** The two slots one row below that must both be empty before this card is exposed. */
  covers: number[];
}

/** x positions per row. Row r sits at y = r * ROW_STEP; each row is offset half a card from the next. */
const ROW_X: readonly (readonly number[])[] = [
  [1.5, 4.5, 7.5],
  [1, 2, 4, 5, 7, 8],
  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
];
const ROW_STEP = 0.5;
const ROW_START = [0, 3, 9, 18];
export const SLOT_COUNT = 28;

function buildSlots(): TriPeaksSlot[] {
  const out: TriPeaksSlot[] = [];
  for (let row = 0; row < ROW_X.length; row++) {
    const xs = ROW_X[row] ?? [];
    const below = ROW_X[row + 1];
    const belowStart = ROW_START[row + 1] ?? 0;
    for (let col = 0; col < xs.length; col++) {
      const x = xs[col] as number;
      const covers: number[] = [];
      if (below) {
        // The card is covered by the two cards half a width to its left and right on the row below.
        for (const dx of [-0.5, 0.5]) {
          const k = below.indexOf(x + dx);
          if (k >= 0) covers.push(belowStart + k);
        }
      }
      out.push({ index: (ROW_START[row] ?? 0) + col, row, col, x, y: row * ROW_STEP, covers });
    }
  }
  return out;
}

/** The static pyramid: position and covering slots for each of the 28 tableau positions. */
export const TRIPEAKS_SLOTS: readonly TriPeaksSlot[] = Object.freeze(
  buildSlots().map((s) => Object.freeze({ ...s, covers: Object.freeze(s.covers) as number[] }))
);

/** Reverse of `covers`: the slots directly above that this slot helps keep hidden. */
const COVERED_BY: readonly (readonly number[])[] = TRIPEAKS_SLOTS.map((s) =>
  TRIPEAKS_SLOTS.filter((o) => o.covers.includes(s.index)).map((o) => o.index)
);

// ------------------------------------------------------------- pile ids ---

function slotIndex(pile: string): number {
  if (pile.length < 2 || pile[0] !== 'p') return -1;
  const n = Number(pile.slice(1));
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? n : -1;
}

function slotId(index: number): string {
  return `p${index}`;
}

// ------------------------------------------------------------- exposure ---

/** A slot's card is pickable when it exists and both slots covering it are empty. */
export function exposed(board: TriPeaksBoard, slot: number): boolean {
  const geom = TRIPEAKS_SLOTS[slot];
  if (!geom) return false;
  if (board.slots[slot] == null) return false;
  return geom.covers.every((c) => board.slots[c] == null);
}

// ------------------------------------------------------------ matching ---

/** Ranks are adjacent, with Ace wrapping to King. */
function adjacentRank(a: CardId, b: CardId): boolean {
  const d = Math.abs(cardDef(a).rank - cardDef(b).rank);
  return d === 1 || d === 12;
}

/** May `card` be played onto the waste right now? */
export function playableOnWaste(board: TriPeaksBoard, card: CardId, twists: Twists): boolean {
  if (twists.isWild(card)) return true;
  const top = board.waste[board.waste.length - 1];
  if (top === undefined) return false;
  if (twists.isWild(top)) return true;
  return adjacentRank(card, top);
}

// ---------------------------------------------------------------- clone ---

function cloneBoard(board: TriPeaksBoard): TriPeaksBoard {
  return {
    slots: board.slots.slice(),
    stock: board.stock.slice(),
    waste: board.waste.slice(),
    moves: board.moves,
    glass: board.glass.slice()
  };
}

// ----------------------------------------------------------------- deal ---

function dealWith(rng: () => number, _config: GameConfig, twists: Twists): TriPeaksBoard {
  const deck = shuffle(
    STANDARD_DECK.map((c) => c.id),
    rng
  );
  const slots: (CardId | null)[] = deck.slice(0, SLOT_COUNT).map((c) => c ?? null);
  // 24 left over; reversed so the TOP (last element) is the next card to turn. One goes up at deal.
  const stock = deck.slice(SLOT_COUNT).reverse();
  const first = stock.pop();
  const waste: CardId[] = first === undefined ? [] : [first];

  const board: TriPeaksBoard = { slots, stock, waste, moves: 0, glass: [] };
  const glass: CardId[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const card = slots[i];
    // Only a still-covered card needs the Glass twist to show; row 3 is face-up anyway.
    if (card != null && !exposed(board, i) && twists.dealtFaceUp(card)) glass.push(card);
  }
  board.glass = glass;
  return board;
}

/** Convenience for tests, the sim and bug reports: a seeded TriPeaks deal. */
export function dealTriPeaks(seed: number, config?: GameConfig, twists?: Twists): TriPeaksBoard {
  return dealWith(mulberry32(seed), config ?? {}, twists ?? NO_TWISTS);
}

// ----------------------------------------------------------------- view ---

function buildView(board: TriPeaksBoard): BoardView {
  const piles: PileView[] = [];

  // Rows 0 -> 3 in order: later piles draw on top, and a lower row visually covers the one above it.
  for (const geom of TRIPEAKS_SLOTS) {
    const card = board.slots[geom.index];
    const up = exposed(board, geom.index);
    const pile: PileView = {
      id: slotId(geom.index),
      kind: 'peak',
      x: geom.x,
      y: geom.y,
      fan: 'none',
      cards: card == null ? [] : [{ id: card, faceUp: up || board.glass.includes(card) }]
    };
    if (card != null) {
      if (up) pile.pickableFrom = 0;
      else pile.covered = true;
    }
    piles.push(pile);
  }

  const stock: PileView = {
    id: 'stock',
    kind: 'stock',
    x: 3.5,
    y: 2.7,
    fan: 'none',
    cards: board.stock.map((id) => ({ id, faceUp: false }))
  };
  // No recycling in TriPeaks: an empty stock is dead.
  if (board.stock.length === 0) stock.blocked = true;
  piles.push(stock);

  piles.push({
    id: 'waste',
    kind: 'waste',
    x: 5.5,
    y: 2.7,
    fan: 'none',
    cards: board.waste.map((id) => ({ id, faceUp: true }))
  });

  return { cols: 10, rows: 4, piles };
}

// ------------------------------------------------------------ targeting ---

/** The card at (pile, index) if that coordinate names an exposed tableau card, else null. */
function cardAt(board: TriPeaksBoard, pile: string, index: number): CardId | null {
  if (index !== 0) return null;
  const slot = slotIndex(pile);
  if (slot < 0) return null;
  if (!exposed(board, slot)) return null;
  return board.slots[slot] ?? null;
}

function targetsFor(board: TriPeaksBoard, pile: string, index: number, twists: Twists): string[] {
  const card = cardAt(board, pile, index);
  if (card === null) return [];
  return playableOnWaste(board, card, twists) ? ['waste'] : [];
}

// ----------------------------------------------------------------- move ---

function doMove(
  board: TriPeaksBoard,
  pile: string,
  index: number,
  toPile: string,
  twists: Twists
): MoveResult<TriPeaksBoard> {
  if (toPile !== 'waste') return noop(board);
  const card = cardAt(board, pile, index);
  if (card === null) return noop(board);
  if (!playableOnWaste(board, card, twists)) return noop(board);
  const slot = slotIndex(pile);

  const next = cloneBoard(board);
  next.slots[slot] = null;
  next.waste = [...next.waste, card];
  next.moves = board.moves + 1;
  next.glass = next.glass.filter((c) => c !== card);

  // Lifting this card can only free the one or two slots directly above it.
  const events: RulesEvent[] = [];
  for (const above of COVERED_BY[slot] ?? []) {
    if (!exposed(next, above) || exposed(board, above)) continue;
    const revealed = next.slots[above];
    if (revealed != null) next.glass = next.glass.filter((c) => c !== revealed);
    events.push({ type: 'flip', pile: slotId(above), index: 0 });
  }

  return { board: next, homed: [card], changed: true, won: isWonBoard(next), events };
}

// ----------------------------------------------------------------- draw ---

function doDraw(board: TriPeaksBoard): MoveResult<TriPeaksBoard> {
  if (board.stock.length === 0) return noop(board); // TriPeaks never recycles
  const next = cloneBoard(board);
  const card = next.stock.pop();
  if (card === undefined) return noop(board);
  next.waste = [...next.waste, card];
  next.moves = board.moves + 1;
  // A card turned from the stock is NOT homed: it was never on the table.
  return {
    board: next,
    homed: [],
    changed: true,
    won: isWonBoard(next),
    events: [{ type: 'draw', count: 1 }]
  };
}

// ------------------------------------------------------------ state tests ---

function isWonBoard(board: TriPeaksBoard): boolean {
  return board.slots.every((c) => c == null);
}

/** Every legal non-draw move on the board. Useful for tests, autoplay and the solver. */
export function legalTriPeaksMoves(
  board: TriPeaksBoard,
  twists: Twists = NO_TWISTS
): { pile: string; index: number; to: string }[] {
  const out: { pile: string; index: number; to: string }[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const card = board.slots[i];
    if (card == null || !exposed(board, i)) continue;
    if (playableOnWaste(board, card, twists)) out.push({ pile: slotId(i), index: 0, to: 'waste' });
  }
  return out;
}

function stuck(board: TriPeaksBoard, twists: Twists): boolean {
  if (isWonBoard(board)) return false;
  if (board.stock.length > 0) return false;
  return legalTriPeaksMoves(board, twists).length === 0;
}

function hashBoard(board: TriPeaksBoard): string {
  // `moves` is deliberately excluded: the hash identifies a POSITION for autoplay cycle detection.
  const slots = board.slots.map((c) => (c == null ? '-' : c)).join(',');
  return `${slots}|${board.stock.join('.')}|${board.waste.join('.')}|${board.glass.join('.')}`;
}

// ---------------------------------------------------------------- module ---

export const tripeaks: GameModule<TriPeaksBoard> = {
  id: 'tripeaks',
  name: 'TriPeaks',
  blurb: 'Three peaks, one running rank. Clear the board by playing a card up or down from the waste.',
  options: [] as GameOption[],
  honours: ['wild', 'glass'],

  deal(rng, config, twists) {
    return dealWith(rng, config, twists);
  },

  view(board) {
    return buildView(board);
  },

  canPickUp(board, pile, index) {
    return cardAt(board, pile, index) !== null;
  },

  legalTargets(board, pile, index, twists) {
    return targetsFor(board, pile, index, twists);
  },

  autoTarget(board, pile, index, twists) {
    return targetsFor(board, pile, index, twists)[0] ?? null;
  },

  move(board, pile, index, toPile, twists) {
    return doMove(board, pile, index, toPile, twists);
  },

  draw(board) {
    return doDraw(board);
  },

  isWon(board) {
    return isWonBoard(board);
  },

  isStuck(board, twists) {
    return stuck(board, twists);
  },

  hash(board) {
    return hashBoard(board);
  },

  clone(board) {
    return cloneBoard(board);
  }
};

export default tripeaks;
