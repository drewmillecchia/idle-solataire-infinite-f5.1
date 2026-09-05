/**
 * Pyramid — the fourth GameModule, and the first *matching* game: two cards leave the table together
 * when their ranks add to 13. PURE and IMMUTABLE: every move returns a fresh board.
 * No DOM / Svelte / Pixi. See src/rules/module.ts for THE contract.
 *
 * Shape (x in card widths, y in card heights; rows overlap by half a card, 28 one-card piles):
 *
 *                                  p0                                          y = 0.0
 *                               p1    p2                                       y = 0.5
 *                            p3    p4    p5                                    y = 1.0
 *                           p6   p7   p8   p9                                  y = 1.5
 *                        p10 p11 p12 p13 p14                                   y = 2.0
 *          stock       p15 p16 p17 p18 p19 p20                                 y = 2.2 / 2.5
 *          waste     p21 p22 p23 p24 p25 p26 p27          discard              y = 3.0
 *
 * Row r holds r+1 cards at x = 1 + (6 - r) / 2 + c, so the pyramid is centred over columns 1..7 and
 * leaves column 0 for the stock/waste and column 8 for the discard. Those three sit low, level with
 * the widest rows, so the dealer's hand reads as part of the same table rather than three lone
 * outlines in the corners.
 *
 * Rule: a card is *exposed* when nothing covers it — a pyramid card whose two slots on the row below
 * are both empty, the waste top, or the stock top. Two exposed cards whose ranks sum to 13 leave
 * together (Q+A, J+2, 10+3, 9+4, 8+5, 7+6); a King is 13 on its own and leaves alone.
 *
 * The two-card selection rides the ordinary contract: `move(board, pileA, 0, pileB)` where pileB holds
 * the complementary exposed card. A King (or a Wild) goes to the 'discard' pile by itself, which is
 * also its `autoTarget`, so tap-to-move works for the unambiguous cases; `autoTarget` returns null
 * when several complements are exposed and the player must drag onto the one they mean.
 *
 * "Home" in a matching game is *removal*: every card sent to the discard is reported in `homed`, which
 * is what wakes and charges its generator. Cards turned from the stock are not.
 *
 * Twists honoured:
 *  - wild  : the card pairs with any exposed card, and may also be discarded alone.
 *  - glass : irrelevant — every pyramid card is dealt face-up.
 *  - mirror: irrelevant — Pyramid never looks at colour.
 *
 * Note on difficulty: raw Pyramid is won well under 5 % of the time (docs/06-games.md). That is the
 * design; the greedy driver is expected to lose almost every deal, and only has to terminate.
 */
import { cardDef, STANDARD_DECK } from '$engine/types';
import type { CardId } from '$engine/types';
import { mulberry32, shuffle } from '$engine/rng';
import {
  noop,
  optionValue,
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

export interface PyramidBoard {
  /** 28 pyramid positions, one card or none each. Index = the slot id in `p<N>`. */
  slots: (CardId | null)[];
  /** Face-down draw pile; the TOP (playable, and the next to turn) is the LAST element. */
  stock: CardId[];
  /** Face-up talon; the TOP (playable) is the LAST element. */
  waste: CardId[];
  /** Cards matched away, oldest first. Never picked up again. */
  discard: CardId[];
  /** Remaining waste -> stock recycles; -1 = unlimited, 0 = none left. */
  redealsLeft: number;
  moves: number;
}

// --------------------------------------------------------------- geometry ---

export interface PyramidSlot {
  index: number;
  row: number;
  col: number;
  /** Grid position in card widths / card heights, as PileView wants it. */
  x: number;
  y: number;
  /** The two slots one row below that must both be empty before this card is exposed. */
  covers: number[];
}

export const PYRAMID_ROWS = 7;
export const PYRAMID_SLOT_COUNT = 28;
const ROW_STEP = 0.5;
/** Column 0 is the stock/waste lane, so the pyramid starts one card width in. */
const PYRAMID_X = 1;

/** First slot index of row r: 0, 1, 3, 6, 10, 15, 21. */
function rowStart(row: number): number {
  return (row * (row + 1)) / 2;
}

function buildSlots(): PyramidSlot[] {
  const out: PyramidSlot[] = [];
  for (let row = 0; row < PYRAMID_ROWS; row++) {
    for (let col = 0; col <= row; col++) {
      // Each row is half a card to the right of the two it sits on.
      const x = PYRAMID_X + (PYRAMID_ROWS - 1 - row) * 0.5 + col;
      const covers =
        row === PYRAMID_ROWS - 1 ? [] : [rowStart(row + 1) + col, rowStart(row + 1) + col + 1];
      out.push({ index: rowStart(row) + col, row, col, x, y: row * ROW_STEP, covers });
    }
  }
  return out;
}

/** The static pyramid: position and covering slots for each of the 28 positions. */
export const PYRAMID_SLOTS: readonly PyramidSlot[] = Object.freeze(
  buildSlots().map((s) => Object.freeze({ ...s, covers: Object.freeze(s.covers) as number[] }))
);

const STOCK_X = 0;
const STOCK_Y = 2.2;
const WASTE_X = 0;
const WASTE_Y = 3;
const DISCARD_X = 8;
const DISCARD_Y = 3;
const GRID_COLS = 9;
const GRID_GAP_Y = 0.098; // gapY in card heights, from layout.ts (0.14 * cardW, cardW = 0.7 * cardH)
/**
 * layout.ts places a pile at y * (cardH + gapY) but sizes the felt as rows * cardH, so `rows` has to
 * cover the deepest row's y * 1.098 plus the card itself: 3.0 * 1.098 + 1 = 4.295 -> 4.3.
 */
const DEEPEST_Y = Math.max((PYRAMID_ROWS - 1) * ROW_STEP, STOCK_Y, WASTE_Y, DISCARD_Y);
const GRID_ROWS = Math.ceil(DEEPEST_Y * (1 + GRID_GAP_Y) * 20 + 20) / 20;

// --------------------------------------------------------------- pile ids ---

export const DISCARD_ID = 'discard';

function slotIndex(pile: string): number {
  if (pile.length < 2 || pile[0] !== 'p') return -1;
  const n = Number(pile.slice(1));
  return Number.isInteger(n) && n >= 0 && n < PYRAMID_SLOT_COUNT ? n : -1;
}

function slotId(index: number): string {
  return `p${index}`;
}

/** Every pile that can hold an exposed card, in a stable order: p0..p27, then the stock, the waste. */
const SOURCE_IDS: readonly string[] = Object.freeze([
  ...Array.from({ length: PYRAMID_SLOT_COUNT }, (_, i) => slotId(i)),
  'stock',
  'waste'
]);

// ---------------------------------------------------------------- exposure ---

/** A pyramid card is exposed when it exists and both slots covering it are empty. */
export function pyramidExposed(board: PyramidBoard, slot: number): boolean {
  const geom = PYRAMID_SLOTS[slot];
  if (!geom) return false;
  if (board.slots[slot] == null) return false;
  return geom.covers.every((c) => board.slots[c] == null);
}

/** The index at which `pile`'s exposed card sits, or -1 if the pile holds none. */
function topIndex(board: PyramidBoard, pile: string): number {
  if (pile === 'stock') return board.stock.length - 1;
  if (pile === 'waste') return board.waste.length - 1;
  const slot = slotIndex(pile);
  if (slot < 0) return -1;
  return pyramidExposed(board, slot) ? 0 : -1;
}

/** The exposed card of `pile`, or null: a free pyramid card, the stock top, or the waste top. */
export function exposedCard(board: PyramidBoard, pile: string): CardId | null {
  if (pile === 'stock') return board.stock[board.stock.length - 1] ?? null;
  if (pile === 'waste') return board.waste[board.waste.length - 1] ?? null;
  const slot = slotIndex(pile);
  if (slot < 0 || !pyramidExposed(board, slot)) return null;
  return board.slots[slot] ?? null;
}

/** The card at (pile, index) if that coordinate names an exposed card, else null. */
function cardAt(board: PyramidBoard, pile: string, index: number): CardId | null {
  const top = topIndex(board, pile);
  if (top < 0 || index !== top) return null;
  return exposedCard(board, pile);
}

// ---------------------------------------------------------------- matching ---

function rankOf(card: CardId): number {
  return cardDef(card).rank;
}

/** Two exposed cards leave together when their ranks add to 13. A Wild pairs with anything. */
export function pairsTo13(a: CardId, b: CardId, twists: Twists): boolean {
  if (twists.isWild(a) || twists.isWild(b)) return true;
  return rankOf(a) + rankOf(b) === 13;
}

/** A King is 13 by itself — and so is a Wild. */
export function discardsAlone(card: CardId, twists: Twists): boolean {
  return twists.isWild(card) || rankOf(card) === 13;
}

// ------------------------------------------------------------------ clone ---

function cloneBoard(board: PyramidBoard): PyramidBoard {
  return {
    slots: board.slots.slice(),
    stock: board.stock.slice(),
    waste: board.waste.slice(),
    discard: board.discard.slice(),
    redealsLeft: board.redealsLeft,
    moves: board.moves
  };
}

// ------------------------------------------------------------------- deal ---

const OPTIONS: GameOption[] = [
  {
    id: 'redeals',
    label: 'Redeals',
    kind: 'select',
    values: [
      { value: 'unlimited', label: 'Unlimited' },
      { value: '2', label: 'Two' },
      { value: '0', label: 'None' }
    ],
    default: '2'
  }
];

function redealsOf(config: GameConfig | undefined): number {
  const v = optionValue(pyramid as GameModule, config, 'redeals');
  if (v === 'unlimited') return -1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 2;
}

function dealWith(rng: () => number, config: GameConfig, _twists: Twists): PyramidBoard {
  const deck = shuffle(
    STANDARD_DECK.map((c) => c.id),
    rng
  );
  const slots: (CardId | null)[] = deck.slice(0, PYRAMID_SLOT_COUNT).map((c) => c ?? null);
  // 24 left over; reversed so the TOP (playable, next to turn) is the last element.
  const stock = deck.slice(PYRAMID_SLOT_COUNT).reverse();
  return {
    slots,
    stock,
    waste: [],
    discard: [],
    redealsLeft: redealsOf(config),
    moves: 0
  };
}

/** Convenience for tests, the sim and bug reports: a seeded Pyramid deal. */
export function dealPyramid(seed: number, config?: GameConfig, twists?: Twists): PyramidBoard {
  return dealWith(mulberry32(seed), config ?? {}, twists ?? NO_TWISTS);
}

// ------------------------------------------------------------------- view ---

function canDraw(board: PyramidBoard): boolean {
  return board.stock.length > 0;
}

function canRecycle(board: PyramidBoard): boolean {
  return board.stock.length === 0 && board.waste.length > 0 && board.redealsLeft !== 0;
}

function buildView(board: PyramidBoard): BoardView {
  const piles: PileView[] = [];

  // Rows 0 -> 6 in order: later piles draw on top, so a lower row visually covers the one above it.
  for (const geom of PYRAMID_SLOTS) {
    const card = board.slots[geom.index];
    const pile: PileView = {
      id: slotId(geom.index),
      kind: 'peak',
      x: geom.x,
      y: geom.y,
      fan: 'none',
      // Every pyramid card is dealt face-up; only its freedom changes.
      cards: card == null ? [] : [{ id: card, faceUp: true }]
    };
    if (card == null) {
      // A cleared position leaves a hole in the pyramid, not an empty slot outline.
      pile.slot = false;
    } else if (pyramidExposed(board, geom.index)) {
      pile.pickableFrom = 0;
    } else {
      pile.covered = true;
    }
    piles.push(pile);
  }

  const stock: PileView = {
    id: 'stock',
    kind: 'stock',
    x: STOCK_X,
    y: STOCK_Y,
    fan: 'none',
    // The stock's top card is playable, so it shows its face; the rest of the pile is face-down.
    cards: board.stock.map((id, i) => ({ id, faceUp: i === board.stock.length - 1 })),
    ...(board.stock.length > 0 ? { pickableFrom: board.stock.length - 1 } : {})
  };
  if (!canDraw(board) && !canRecycle(board)) stock.blocked = true;
  piles.push(stock);

  piles.push({
    id: 'waste',
    kind: 'waste',
    x: WASTE_X,
    y: WASTE_Y,
    fan: 'none',
    cards: board.waste.map((id) => ({ id, faceUp: true })),
    ...(board.waste.length > 0 ? { pickableFrom: board.waste.length - 1 } : {})
  });

  // Matched cards are gone: the discard is a destination only, never a source.
  piles.push({
    id: DISCARD_ID,
    kind: 'discard',
    x: DISCARD_X,
    y: DISCARD_Y,
    fan: 'none',
    cards: board.discard.map((id) => ({ id, faceUp: true }))
  });

  return { cols: GRID_COLS, rows: GRID_ROWS, piles };
}

// -------------------------------------------------------------- targeting ---

function targetsFor(board: PyramidBoard, pile: string, index: number, twists: Twists): string[] {
  const card = cardAt(board, pile, index);
  if (card === null) return [];
  const out: string[] = [];
  if (discardsAlone(card, twists)) out.push(DISCARD_ID);
  for (const other of SOURCE_IDS) {
    if (other === pile) continue;
    const partner = exposedCard(board, other);
    if (partner === null) continue;
    if (pairsTo13(card, partner, twists)) out.push(other);
  }
  return out;
}

function autoTargetFor(
  board: PyramidBoard,
  pile: string,
  index: number,
  twists: Twists
): string | null {
  const card = cardAt(board, pile, index);
  if (card === null) return null;
  // A King (or a Wild) always has an unambiguous home of its own.
  if (discardsAlone(card, twists)) return DISCARD_ID;
  const partners = targetsFor(board, pile, index, twists);
  // Exactly one complement: tap it home. Several: the player drags onto the one they mean.
  return partners.length === 1 ? (partners[0] ?? null) : null;
}

// ------------------------------------------------------------------- move ---

/** Lift `pile`'s exposed card off a mutable board copy. */
function lift(board: PyramidBoard, pile: string): void {
  if (pile === 'stock') {
    board.stock.pop();
    return;
  }
  if (pile === 'waste') {
    board.waste.pop();
    return;
  }
  const slot = slotIndex(pile);
  if (slot >= 0) board.slots[slot] = null;
}

function doMove(
  board: PyramidBoard,
  pile: string,
  index: number,
  toPile: string,
  twists: Twists
): MoveResult<PyramidBoard> {
  const card = cardAt(board, pile, index);
  if (card === null) return noop(board);
  if (toPile === pile) return noop(board);

  const next = cloneBoard(board);
  let homed: CardId[];

  if (toPile === DISCARD_ID) {
    if (!discardsAlone(card, twists)) return noop(board);
    lift(next, pile);
    next.discard = [...next.discard, card];
    homed = [card];
  } else {
    const partner = exposedCard(board, toPile);
    if (partner === null) return noop(board);
    if (!pairsTo13(card, partner, twists)) return noop(board);
    lift(next, pile);
    lift(next, toPile);
    next.discard = [...next.discard, card, partner];
    homed = [card, partner];
  }

  next.moves = board.moves + 1;
  // Every pyramid card is already face-up, so uncovering one reveals nothing: no flip events.
  return { board: next, homed, changed: true, won: isWonBoard(next), events: [] };
}

// ------------------------------------------------------------------- draw ---

function doDraw(board: PyramidBoard): MoveResult<PyramidBoard> {
  if (canDraw(board)) {
    const next = cloneBoard(board);
    const card = next.stock.pop();
    if (card === undefined) return noop(board);
    next.waste = [...next.waste, card];
    next.moves = board.moves + 1;
    // A card turned from the stock is NOT homed: it was never matched away.
    return {
      board: next,
      homed: [],
      changed: true,
      won: isWonBoard(next),
      events: [{ type: 'draw', count: 1 }]
    };
  }
  if (!canRecycle(board)) return noop(board);

  const next = cloneBoard(board);
  // The waste turns back over: its bottom card becomes the next one drawn.
  next.stock = [...next.waste].reverse();
  next.waste = [];
  if (next.redealsLeft > 0) next.redealsLeft -= 1;
  next.moves = board.moves + 1;
  const events: RulesEvent[] = [{ type: 'recycle' }];
  return { board: next, homed: [], changed: true, won: isWonBoard(next), events };
}

// ------------------------------------------------------------- state tests ---

function isWonBoard(board: PyramidBoard): boolean {
  return board.slots.every((c) => c == null);
}

/**
 * Every legal non-draw move on the board, each unordered pair listed ONCE (from the pile that comes
 * first in `SOURCE_IDS`) plus every lone-King discard. Useful for tests, autoplay and the solver.
 */
export function legalPyramidMoves(
  board: PyramidBoard,
  twists: Twists = NO_TWISTS
): { pile: string; index: number; to: string }[] {
  const out: { pile: string; index: number; to: string }[] = [];
  for (let i = 0; i < SOURCE_IDS.length; i++) {
    const pile = SOURCE_IDS[i] as string;
    const card = exposedCard(board, pile);
    if (card === null) continue;
    const index = topIndex(board, pile);
    if (discardsAlone(card, twists)) out.push({ pile, index, to: DISCARD_ID });
    for (let j = i + 1; j < SOURCE_IDS.length; j++) {
      const other = SOURCE_IDS[j] as string;
      const partner = exposedCard(board, other);
      if (partner === null) continue;
      if (pairsTo13(card, partner, twists)) out.push({ pile, index, to: other });
    }
  }
  return out;
}

function stuck(board: PyramidBoard, twists: Twists): boolean {
  if (isWonBoard(board)) return false;
  if (canDraw(board) || canRecycle(board)) return false;
  return legalPyramidMoves(board, twists).length === 0;
}

function hashBoard(board: PyramidBoard): string {
  // `moves` is deliberately excluded: the hash identifies a POSITION for autoplay cycle detection.
  // `discard` is not hashed either — it is exactly the deck minus the slots, the stock and the waste.
  const slots = board.slots.map((c) => (c == null ? '-' : c)).join(',');
  return `${slots}|${board.stock.join('.')}|${board.waste.join('.')}|${board.redealsLeft}`;
}

// ----------------------------------------------------------------- module ---

export const pyramid: GameModule<PyramidBoard> = {
  id: 'pyramid',
  name: 'Pyramid',
  blurb: 'Pairs that add to thirteen leave the table. Kings go alone. Dismantle the pyramid.',
  options: OPTIONS,
  honours: ['wild'],

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
    return autoTargetFor(board, pile, index, twists);
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

export default pyramid;
