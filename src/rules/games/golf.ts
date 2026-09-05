/**
 * Golf — the third GameModule. Seven short columns, one running waste, no building anywhere.
 * PURE and IMMUTABLE: every move returns a fresh board. No DOM / Svelte / Pixi.
 * See src/rules/module.ts for THE contract.
 *
 * Shape (x in card widths, y in card heights):
 *
 *   t0   t1   t2   t3   t4   t5   t6      y = 0, five face-up cards fanned down
 *    .    .    .    .    .    .    .
 *              stock  waste               y = 2.5, at x 2.5 / 3.5
 *
 * Deal: 7 x 5 = 35 face-up tableau cards, 16 face-down in the stock, 1 turned to the waste. 52 total.
 *
 * Rule: only the LAST card of a column may be lifted, and only onto the waste, and only when its rank
 * is one away from the waste top. Nothing is ever built on the tableau, so a column only shrinks.
 * The `wrap` option decides whether Ace and King are neighbours (off by default — the classic game
 * dead-ends on a King).
 *
 * "Home" in a clearing game is *removal*: every card played off a column onto the waste is reported in
 * `homed`, which is what wakes and charges its generator. Cards turned from the stock are not.
 *
 * Twists honoured:
 *  - wild  : the card may always be played onto the waste, and anything may be played onto a wild top.
 *  - mirror: irrelevant — Golf never looks at colour.
 *  - glass : irrelevant — every tableau card is dealt face-up already.
 */
import { cardDef, STANDARD_DECK } from '$engine/types';
import type { CardId } from '$engine/types';
import { mulberry32, shuffle } from '$engine/rng';
import {
  noop,
  optionValue,
  NO_TWISTS,
  FAN_UP,
  type BoardView,
  type GameConfig,
  type GameModule,
  type GameOption,
  type MoveResult,
  type PileView,
  type Twists
} from '../module';

export interface GolfBoard {
  /** Seven columns, all face-up; the TOP (the only pickable card) is the LAST element. */
  columns: CardId[][];
  /** Face-down draw pile; the TOP (next to turn) is the LAST element. */
  stock: CardId[];
  /** Face-up discard; the LAST element is the card everything must match. */
  waste: CardId[];
  /** Ace and King count as neighbours. */
  wrap: boolean;
  moves: number;
}

export const GOLF_COLUMNS = 7;
export const GOLF_COLUMN_HEIGHT = 5;
export const GOLF_TABLEAU_IDS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'] as const;

const OPTIONS: GameOption[] = [
  {
    id: 'wrap',
    label: 'Around the corner',
    kind: 'select',
    values: [
      { value: 'no', label: 'King stops the run' },
      { value: 'yes', label: 'Ace wraps to King' }
    ],
    default: 'no'
  }
];

// ---------------------------------------------------------------- geometry ---

/**
 * Grid extents. The columns sit at y = 0 and fan down; the stock row sits at y = STOCK_Y.
 * layout.ts places a pile at y * (cardH + gapY) with gapY = 0.14 * cardW = 0.098 * cardH, but sizes the
 * felt as rows * cardH — so `rows` has to cover STOCK_Y * 1.098 + 1 for the deepest thing on the board.
 */
const STOCK_Y = 2.5;
/** A full column, fanned: 1 + 4 * FAN_UP = 2.12 card heights. */
const COLUMN_EXTENT = 1 + (GOLF_COLUMN_HEIGHT - 1) * FAN_UP;
const GRID_GAP_Y = 0.098; // gapY in card heights, from layout.ts (0.14 * cardW, cardW = 0.7 * cardH)
const GRID_ROWS =
  Math.ceil(Math.max(COLUMN_EXTENT, STOCK_Y * (1 + GRID_GAP_Y) + 1) * 20) / 20; // 3.75

// --------------------------------------------------------------- pile ids ---

function columnIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 't') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 && i < GOLF_COLUMNS ? i : -1;
}

function columnId(index: number): string {
  return `t${index}`;
}

// ---------------------------------------------------------------- matching ---

/** Ranks one apart. With `wrap`, Ace and King are neighbours too. */
function adjacentRank(a: CardId, b: CardId, wrap: boolean): boolean {
  const d = Math.abs(cardDef(a).rank - cardDef(b).rank);
  return d === 1 || (wrap && d === 12);
}

/** May `card` be played onto the waste right now? */
export function golfPlayableOnWaste(board: GolfBoard, card: CardId, twists: Twists): boolean {
  if (twists.isWild(card)) return true;
  const top = board.waste[board.waste.length - 1];
  if (top === undefined) return false;
  if (twists.isWild(top)) return true;
  return adjacentRank(card, top, board.wrap);
}

// ------------------------------------------------------------------ clone ---

function cloneBoard(board: GolfBoard): GolfBoard {
  return {
    columns: board.columns.map((c) => c.slice()),
    stock: board.stock.slice(),
    waste: board.waste.slice(),
    wrap: board.wrap,
    moves: board.moves
  };
}

// ------------------------------------------------------------------- deal ---

function wrapOf(config: GameConfig | undefined): boolean {
  return optionValue(golf as GameModule, config, 'wrap') === 'yes';
}

function dealWith(rng: () => number, config: GameConfig, _twists: Twists): GolfBoard {
  const deck = shuffle(
    STANDARD_DECK.map((c) => c.id),
    rng
  );
  const columns: CardId[][] = Array.from({ length: GOLF_COLUMNS }, () => []);
  let k = 0;
  // Row by row, dealer style: one card to each column, five times round.
  for (let row = 0; row < GOLF_COLUMN_HEIGHT; row++) {
    for (let col = 0; col < GOLF_COLUMNS; col++) {
      const card = deck[k++];
      const target = columns[col];
      if (card === undefined || !target) continue;
      target.push(card);
    }
  }
  // 17 left over; reversed so the TOP (last element) is the next card to turn. One goes up at deal.
  const stock = deck.slice(k).reverse();
  const first = stock.pop();
  const waste: CardId[] = first === undefined ? [] : [first];

  return { columns, stock, waste, wrap: wrapOf(config), moves: 0 };
}

/** Convenience for tests, the sim and bug reports: a seeded Golf deal. */
export function dealGolf(seed: number, config?: GameConfig, twists?: Twists): GolfBoard {
  return dealWith(mulberry32(seed), config ?? {}, twists ?? NO_TWISTS);
}

// ------------------------------------------------------------------- view ---

function buildView(board: GolfBoard): BoardView {
  const piles: PileView[] = [];

  for (let i = 0; i < GOLF_COLUMNS; i++) {
    const col = board.columns[i] ?? [];
    piles.push({
      id: columnId(i),
      kind: 'tableau',
      x: i,
      y: 0,
      fan: 'down',
      cards: col.map((id) => ({ id, faceUp: true })),
      // Only the top card is ever pickable: Golf never moves a run.
      ...(col.length > 0 ? { pickableFrom: col.length - 1 } : {})
    });
  }

  const stock: PileView = {
    id: 'stock',
    kind: 'stock',
    x: 2.5,
    y: STOCK_Y,
    fan: 'none',
    cards: board.stock.map((id) => ({ id, faceUp: false }))
  };
  // No recycling in Golf: an empty stock is dead.
  if (board.stock.length === 0) stock.blocked = true;
  piles.push(stock);

  // The waste is a one-way street; nothing is ever picked up off it, so it has no pickableFrom.
  piles.push({
    id: 'waste',
    kind: 'waste',
    x: 3.5,
    y: STOCK_Y,
    fan: 'none',
    cards: board.waste.map((id) => ({ id, faceUp: true }))
  });

  return { cols: GOLF_COLUMNS, rows: GRID_ROWS, piles };
}

// -------------------------------------------------------------- targeting ---

/** The card at (pile, index) if that coordinate names a liftable column top, else null. */
function cardAt(board: GolfBoard, pile: string, index: number): CardId | null {
  const col = columnIndex(pile);
  if (col < 0) return null;
  const cards = board.columns[col];
  if (!cards || cards.length === 0) return null;
  if (index !== cards.length - 1) return null;
  return cards[index] ?? null;
}

function targetsFor(board: GolfBoard, pile: string, index: number, twists: Twists): string[] {
  const card = cardAt(board, pile, index);
  if (card === null) return [];
  return golfPlayableOnWaste(board, card, twists) ? ['waste'] : [];
}

// ------------------------------------------------------------------- move ---

function doMove(
  board: GolfBoard,
  pile: string,
  index: number,
  toPile: string,
  twists: Twists
): MoveResult<GolfBoard> {
  if (toPile !== 'waste') return noop(board);
  const card = cardAt(board, pile, index);
  if (card === null) return noop(board);
  if (!golfPlayableOnWaste(board, card, twists)) return noop(board);

  const next = cloneBoard(board);
  const col = next.columns[columnIndex(pile)];
  if (!col) return noop(board);
  col.pop();
  next.waste = [...next.waste, card];
  next.moves = board.moves + 1;

  // Every tableau card is dealt face-up, so nothing is ever revealed: no flip events.
  return { board: next, homed: [card], changed: true, won: isWonBoard(next), events: [] };
}

// ------------------------------------------------------------------- draw ---

function doDraw(board: GolfBoard): MoveResult<GolfBoard> {
  if (board.stock.length === 0) return noop(board); // Golf never recycles
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

// ------------------------------------------------------------- state tests ---

function isWonBoard(board: GolfBoard): boolean {
  return board.columns.every((c) => c.length === 0);
}

/** Every legal non-draw move on the board. Useful for tests, autoplay and the solver. */
export function legalGolfMoves(
  board: GolfBoard,
  twists: Twists = NO_TWISTS
): { pile: string; index: number; to: string }[] {
  const out: { pile: string; index: number; to: string }[] = [];
  for (let i = 0; i < GOLF_COLUMNS; i++) {
    const col = board.columns[i] ?? [];
    const card = col[col.length - 1];
    if (card === undefined) continue;
    if (golfPlayableOnWaste(board, card, twists)) {
      out.push({ pile: columnId(i), index: col.length - 1, to: 'waste' });
    }
  }
  return out;
}

function stuck(board: GolfBoard, twists: Twists): boolean {
  if (isWonBoard(board)) return false;
  if (board.stock.length > 0) return false;
  return legalGolfMoves(board, twists).length === 0;
}

function hashBoard(board: GolfBoard): string {
  // `moves` is deliberately excluded: the hash identifies a POSITION for autoplay cycle detection.
  const cols = board.columns.map((c) => c.join('.')).join('/');
  return `${cols}|${board.stock.join('.')}|${board.waste.join('.')}|${board.wrap ? 'w' : '-'}`;
}

// ----------------------------------------------------------------- module ---

export const golf: GameModule<GolfBoard> = {
  id: 'golf',
  name: 'Golf',
  blurb: 'Seven short columns, one running waste. Play up or down a rank until the course is clear.',
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

export default golf;
