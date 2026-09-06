/**
 * FreeCell — the fifth GameModule. Eight all-face-up tableau columns, four free cells, four
 * foundations. No stock, no waste, no face-down cards anywhere. PURE and IMMUTABLE: every move
 * returns a fresh board. No DOM / Svelte / Pixi. See src/rules/module.ts for THE contract.
 *
 * Supermove: a valid descending-alternating-colour run may move as a unit if
 * `(1 + freeCells) * 2^emptyColumns` covers its length (the classic "move by way of the free cells"
 * arithmetic) — with the destination column, if empty, not counted towards `emptyColumns`. See
 * `maxRunLength`.
 *
 * `canPickUp` and the view's `pickableFrom` are computed with NO_TWISTS, matching every other game
 * in the roster (Klondike/Golf never let a twist affect *which* cards can be grabbed, only where
 * they can go) — `view()` has no twists parameter to consult anyway. A Wild/Mirror-lengthened chain
 * is still fully playable via `legalTargets`/`move`, which do receive `twists`; only the cosmetic
 * drag-start range in the table renderer stays conservative. That is an existing contract shape, not
 * a new gap.
 *
 * Twists honoured:
 *  - wild   : the card may be placed on anything (tableau or foundation) and accepts anything on it.
 *  - mirror : the card counts as both colours, so it stacks either way in the tableau.
 *  - glass  : irrelevant — every card is dealt face-up already.
 */
import { cardDef, isRed } from '$engine/types';
import type { CardId } from '$engine/types';
import { deckCardIds, STANDARD_52 } from '$engine/deck';
import { mulberry32, shuffle } from '$engine/rng';
import {
  noop,
  optionValue,
  isWildCard,
  NO_TWISTS,
  FAN_UP,
  type BoardView,
  type DealDeck,
  type GameConfig,
  type GameModule,
  type GameOption,
  type MoveResult,
  type PileView,
  type Twists
} from '../module';

export interface FreeCellBoard {
  /** Free cells; each holds at most one card. Length follows the `cells` option (4/3/2). */
  cells: (CardId | null)[];
  /** Four foundations, each built A→K by suit. */
  foundations: CardId[][];
  /** Eight tableau columns, all face-up; the TOP (only naturally pickable card) is the LAST element. */
  tableau: CardId[][];
  moves: number;
  /** How many cards this hand was dealt — the board's deck may not be the standard 52 (docs/12). */
  dealt: number;
}

export const FREECELL_TABLEAU_COUNT = 8;
export const FREECELL_FOUNDATION_COUNT = 4;

const OPTIONS: GameOption[] = [
  {
    id: 'cells',
    label: 'Free cells',
    kind: 'select',
    values: [
      { value: '4', label: 'Four (standard)' },
      { value: '3', label: 'Three (harder)' },
      { value: '2', label: 'Two (hardest)' }
    ],
    default: '4'
  }
];

// ---------------------------------------------------------------- geometry ---

/**
 * Grid extents. Cells and foundations sit at y = 0 (a single card each, no fan); tableau columns
 * sit at y = TABLEAU_Y and fan down. layout.ts places a pile at y * (cardH + gapY) with
 * gapY = 0.098 * cardH, but sizes the felt as rows * cardH — so `rows` must cover the deepest thing
 * on the board: TABLEAU_Y * 1.098 + (fan extent of the deepest column).
 *
 * Unlike Golf/Pyramid, a FreeCell column's depth isn't fixed by the deal (7 cards) — repeated
 * supermoves can pile an entire alternating-colour run into one column. Sizing `rows` for that worst
 * case would make every card tiny at the deal, when nothing is deep yet, so `rows` covers a
 * comfortably deep column (11) and the renderer's fan compression (src/table/layout.ts) tightens the
 * spacing on any column that outgrows it — which is what a person does with real cards.
 */
const TABLEAU_Y = 1.25;
const GRID_GAP_Y = 0.098; // gapY in card heights (0.14 * cardW, cardW = 0.7 * cardH), from layout.ts
const MAX_TABLEAU_DEPTH = 11;
export const FREECELL_ROWS =
  Math.ceil((TABLEAU_Y * (1 + GRID_GAP_Y) + 1 + (MAX_TABLEAU_DEPTH - 1) * FAN_UP) * 20) / 20; // 5.2

// --------------------------------------------------------------- pile ids ---

function cellIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 'c') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 ? i : -1;
}

function foundationIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 'f') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 && i < FREECELL_FOUNDATION_COUNT ? i : -1;
}

function tableauIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 't') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 && i < FREECELL_TABLEAU_COUNT ? i : -1;
}

// ------------------------------------------------------------- card colour ---

function redCard(id: CardId): boolean {
  return isRed(cardDef(id).suit);
}

/** upper sits directly below lower in the array (i.e. lower would land on top of upper). */
function colourOk(upper: CardId, lower: CardId, twists: Twists): boolean {
  if (twists.isMirror(upper) || twists.isMirror(lower)) return true;
  return redCard(upper) !== redCard(lower);
}

/** May `lower` sit directly on `upper` in a tableau run (one rank down, alternating colour)? */
function runPairOk(upper: CardId, lower: CardId, twists: Twists): boolean {
  if (isWildCard(upper, twists) || isWildCard(lower, twists)) return true;
  if (cardDef(lower).rank !== cardDef(upper).rank - 1) return false;
  return colourOk(upper, lower, twists);
}

// ------------------------------------------------------------- acceptance ---

/**
 * Foundations are ranked by height: a pile of n cards wants rank n+1, in the pile's suit.
 * Not exported: `foundationAccepts` is already a bare export of games/klondike.ts, and the barrel
 * (rules/index.ts) re-exports every game — a second bare export of the same name is TS2308.
 */
function foundationAccepts(pile: readonly CardId[], card: CardId, twists: Twists): boolean {
  const need = pile.length + 1;
  // A card with NO RANK OF ITS OWN (the Joker) cannot stand in for one: it crowns a foundation
  // that is already complete, and that is its only way home. Two reasons, both load-bearing.
  // Capacity: four foundations hold 52 ranks, so a 53-card deck needs somewhere for the extra card
  // to go (docs/12-ascension.md). Safety: a rankless card played as a stand-in would occupy a rank
  // slot and strand the real card of that rank forever — and greedy autoplay, which homes whatever
  // it can, would do exactly that on the first hand.
  if (cardDef(card).rank === 0) return pile.length === 13;
  if (isWildCard(card, twists)) return need <= 13;
  if (need > 13) return false;
  const def = cardDef(card);
  if (def.rank !== need) return false;
  const anchor = pile.find((c) => !isWildCard(c, twists));
  if (anchor === undefined) return true;
  return cardDef(anchor).suit === def.suit;
}

/** Can `card` (the bottom of the run being moved) land on tableau column `col`? Empty takes anything. */
function tableauAccepts(col: readonly CardId[], card: CardId, twists: Twists): boolean {
  const top = col[col.length - 1];
  if (top === undefined) return true;
  return runPairOk(top, card, twists);
}

// -------------------------------------------------------------- supermove ---

/**
 * The longest run that may be moved as a single unit right now: `(1 + freeCells) * 2^emptyColumns`.
 * When the destination itself is an empty tableau column, it doesn't count towards `emptyColumns`
 * (you can't use the column you're filling as one of the shuttles that gets you there).
 */
export function maxRunLength(board: FreeCellBoard, toEmptyColumn: boolean): number {
  const freeCells = board.cells.filter((c) => c === null).length;
  const emptyColumns = board.tableau.filter((col) => col.length === 0).length;
  const usableEmpty = toEmptyColumn ? Math.max(0, emptyColumns - 1) : emptyColumns;
  return (1 + freeCells) * Math.pow(2, usableEmpty);
}

// ------------------------------------------------------------------- runs ---

/**
 * The cards that would be picked up at (pile, index) under `twists`, or null if not liftable: a
 * single card from a cell or foundation, or a tableau suffix that is itself a valid
 * descending-alternating-colour chain and fits within `maxRunLength` for at least a non-empty
 * destination (a run too long to go anywhere can't be picked up at all).
 * Not exported: `runAt` is already a bare export of games/klondike.ts (see `foundationAccepts` above).
 */
function runAt(board: FreeCellBoard, pile: string, index: number, twists: Twists): CardId[] | null {
  if (!Number.isInteger(index) || index < 0) return null;

  const ci = cellIndex(pile);
  if (ci >= 0) {
    if (ci >= board.cells.length || index !== 0) return null;
    const c = board.cells[ci];
    return c === undefined || c === null ? null : [c];
  }

  const fi = foundationIndex(pile);
  if (fi >= 0) {
    const f = board.foundations[fi];
    if (!f || f.length === 0 || index !== f.length - 1) return null;
    const c = f[index];
    return c === undefined ? null : [c];
  }

  const ti = tableauIndex(pile);
  if (ti >= 0) {
    const col = board.tableau[ti];
    if (!col || index >= col.length) return null;
    const run = col.slice(index);
    for (let i = 0; i < run.length - 1; i++) {
      const upper = run[i];
      const lower = run[i + 1];
      if (upper === undefined || lower === undefined || !runPairOk(upper, lower, twists)) return null;
    }
    if (run.length > maxRunLength(board, false)) return null;
    return run;
  }

  return null; // unknown pile
}

/**
 * The smallest index `i` such that every index in [i, col.length) is independently liftable — i.e.
 * the maximal trailing chain, capped so the resulting run still fits `maxRunLength`. A suffix of a
 * valid chain is itself a valid chain, so every index in this range really is pickable. Computed
 * with NO_TWISTS: see the file header on why `view()` can't consult twists.
 */
function pickupStart(board: FreeCellBoard, ti: number): number {
  const col = board.tableau[ti] ?? [];
  if (col.length === 0) return 0;
  let i = col.length - 1;
  while (i > 0) {
    const upper = col[i - 1];
    const lower = col[i];
    if (upper === undefined || lower === undefined || !runPairOk(upper, lower, NO_TWISTS)) break;
    i--;
  }
  const cap = maxRunLength(board, false);
  return Math.max(i, col.length - cap);
}

// ------------------------------------------------------------------ clone ---

function cloneBoard(board: FreeCellBoard): FreeCellBoard {
  return {
    cells: board.cells.slice(),
    foundations: board.foundations.map((f) => f.slice()),
    tableau: board.tableau.map((c) => c.slice()),
    moves: board.moves,
    dealt: board.dealt
  };
}

// ------------------------------------------------------------------- deal ---

function cellsCountOf(config: GameConfig | undefined): number {
  const v = optionValue(freecell as GameModule, config, 'cells');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function dealWith(rng: () => number, config: GameConfig, _twists: Twists, deck: DealDeck): FreeCellBoard {
  const shuffled = shuffle(deck, rng);
  // Classic round-robin deal: card k goes to column k % 8, so columns 0-3 (52 mod 8 = 4 of them)
  // pick up the extra card — 7 cards each — and columns 4-7 get 6. A larger deck (docs/12) simply
  // rides the same round-robin: every card handed in lands on some column.
  const tableau: CardId[][] = Array.from({ length: FREECELL_TABLEAU_COUNT }, () => []);
  for (let k = 0; k < shuffled.length; k++) {
    const card = shuffled[k];
    const col = tableau[k % FREECELL_TABLEAU_COUNT];
    if (card !== undefined && col) col.push(card);
  }
  const cellCount = cellsCountOf(config);
  return {
    cells: Array.from({ length: cellCount }, () => null),
    foundations: [[], [], [], []],
    tableau,
    moves: 0,
    dealt: shuffled.length
  };
}

/** Convenience for tests, the sim and bug reports: a seeded FreeCell deal off the standard 52. */
export function dealFreeCell(
  seed: number,
  config?: GameConfig,
  twists?: Twists,
  deck?: DealDeck
): FreeCellBoard {
  return dealWith(mulberry32(seed), config ?? {}, twists ?? NO_TWISTS, deck ?? deckCardIds(STANDARD_52));
}

// ------------------------------------------------------------------- view ---

function buildView(board: FreeCellBoard): BoardView {
  const piles: PileView[] = [];

  for (let i = 0; i < board.cells.length; i++) {
    const c = board.cells[i];
    const occupied = c !== undefined && c !== null;
    piles.push({
      id: `c${i}`,
      kind: 'cell',
      x: i,
      y: 0,
      fan: 'none',
      cards: occupied ? [{ id: c, faceUp: true }] : [],
      ...(occupied ? { pickableFrom: 0 } : {})
    });
  }

  for (let i = 0; i < FREECELL_FOUNDATION_COUNT; i++) {
    const f = board.foundations[i] ?? [];
    piles.push({
      id: `f${i}`,
      kind: 'foundation',
      x: 4 + i,
      y: 0,
      fan: 'none',
      cards: f.map((id) => ({ id, faceUp: true })),
      ...(f.length > 0 ? { pickableFrom: f.length - 1 } : {})
    });
  }

  for (let i = 0; i < FREECELL_TABLEAU_COUNT; i++) {
    const col = board.tableau[i] ?? [];
    piles.push({
      id: `t${i}`,
      kind: 'tableau',
      x: i,
      y: TABLEAU_Y,
      fan: 'down',
      cards: col.map((id) => ({ id, faceUp: true })),
      ...(col.length > 0 ? { pickableFrom: pickupStart(board, i) } : {})
    });
  }

  return { cols: FREECELL_TABLEAU_COUNT, rows: FREECELL_ROWS, piles };
}

// -------------------------------------------------------------- targeting ---

function targetsFor(board: FreeCellBoard, pile: string, run: CardId[], twists: Twists): string[] {
  const out: string[] = [];
  const bottom = run[0];
  if (bottom === undefined) return out;

  if (run.length === 1) {
    for (let i = 0; i < FREECELL_FOUNDATION_COUNT; i++) {
      const id = `f${i}`;
      if (id === pile) continue;
      const f = board.foundations[i];
      if (f && foundationAccepts(f, bottom, twists)) out.push(id);
    }
    for (let i = 0; i < board.cells.length; i++) {
      const id = `c${i}`;
      if (id === pile) continue;
      if (board.cells[i] === null || board.cells[i] === undefined) out.push(id);
    }
  }

  for (let i = 0; i < FREECELL_TABLEAU_COUNT; i++) {
    const id = `t${i}`;
    if (id === pile) continue;
    const col = board.tableau[i];
    if (!col) continue;
    if (!tableauAccepts(col, bottom, twists)) continue;
    const cap = maxRunLength(board, col.length === 0);
    if (run.length <= cap) out.push(id);
  }

  return out;
}

// ------------------------------------------------------------------- move ---

function doMove(
  board: FreeCellBoard,
  pile: string,
  index: number,
  toPile: string,
  twists: Twists
): MoveResult<FreeCellBoard> {
  const run = runAt(board, pile, index, twists);
  if (!run || run.length === 0) return noop(board);
  if (!targetsFor(board, pile, run, twists).includes(toPile)) return noop(board);

  const next = cloneBoard(board);
  const homed: CardId[] = [];

  // lift
  const fromCell = cellIndex(pile);
  const fromFoundation = foundationIndex(pile);
  const fromTableau = tableauIndex(pile);
  if (fromCell >= 0 && fromCell < next.cells.length) next.cells[fromCell] = null;
  else if (fromFoundation >= 0) next.foundations[fromFoundation]?.pop();
  else if (fromTableau >= 0) {
    const col = next.tableau[fromTableau];
    if (!col) return noop(board);
    next.tableau[fromTableau] = col.slice(0, index);
  } else return noop(board);

  // land
  const toCell = cellIndex(toPile);
  const toFoundation = foundationIndex(toPile);
  const toTableau = tableauIndex(toPile);
  if (toCell >= 0 && toCell < next.cells.length) {
    if (next.cells[toCell] !== null) return noop(board);
    const card = run[0];
    if (card === undefined) return noop(board);
    next.cells[toCell] = card;
  } else if (toFoundation >= 0) {
    const f = next.foundations[toFoundation];
    if (!f) return noop(board);
    f.push(...run);
    homed.push(...run);
  } else if (toTableau >= 0) {
    const col = next.tableau[toTableau];
    if (!col) return noop(board);
    next.tableau[toTableau] = [...col, ...run];
  } else return noop(board);

  next.moves = board.moves + 1;
  // Every card is already face-up: nothing to flip, and there's no stock to draw or recycle.
  return { board: next, homed, changed: true, won: isWonBoard(next), events: [] };
}

// ------------------------------------------------------------- state tests ---

/**
 * Won when every dealt card is home — see the equivalent comment on `isWonBoard` in
 * games/klondike.ts for why this isn't `foundations.every(f => f.length === 13)`, and how a card
 * with no rank of its own gets home at all.
 */
function isWonBoard(board: FreeCellBoard): boolean {
  if (board.foundations.length !== FREECELL_FOUNDATION_COUNT) return false;
  const home = board.foundations.reduce((sum, f) => sum + f.length, 0);
  return home === board.dealt;
}

/** Every legal move on the board (there is no draw in FreeCell). Useful for tests and autoplay. */
export function legalFreeCellMoves(
  board: FreeCellBoard,
  twists: Twists = NO_TWISTS
): { pile: string; index: number; to: string }[] {
  const out: { pile: string; index: number; to: string }[] = [];
  const push = (pile: string, index: number) => {
    const run = runAt(board, pile, index, twists);
    if (!run || run.length === 0) return;
    for (const to of targetsFor(board, pile, run, twists)) out.push({ pile, index, to });
  };
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i] !== null && board.cells[i] !== undefined) push(`c${i}`, 0);
  }
  for (let i = 0; i < FREECELL_FOUNDATION_COUNT; i++) {
    const f = board.foundations[i];
    if (f && f.length > 0) push(`f${i}`, f.length - 1);
  }
  for (let i = 0; i < FREECELL_TABLEAU_COUNT; i++) {
    const col = board.tableau[i];
    if (!col) continue;
    for (let k = 0; k < col.length; k++) push(`t${i}`, k);
  }
  return out;
}

function stuck(board: FreeCellBoard, twists: Twists): boolean {
  if (isWonBoard(board)) return false;
  return legalFreeCellMoves(board, twists).length === 0;
}

function hashBoard(board: FreeCellBoard): string {
  // `moves` and `dealt` are deliberately excluded: the hash identifies a POSITION, so autoplay's
  // cycle detection works, and `dealt` is fixed at deal time — identical across every position
  // reachable from one deal, so it could never help distinguish two of them.
  const c = board.cells.map((x) => (x === null || x === undefined ? '-' : x)).join('.');
  const f = board.foundations.map((x) => x.join('.')).join('/');
  const t = board.tableau.map((x) => x.join('.')).join('/');
  return `${c}|${f}|${t}`;
}

// ----------------------------------------------------------------- module ---

export const freecell: GameModule<FreeCellBoard> = {
  id: 'freecell',
  name: 'FreeCell',
  blurb: 'All the cards face up from the start. Four free cells buy you room to dig; nearly every deal wins.',
  options: OPTIONS,
  honours: ['wild', 'mirror'],

  deal(rng, config, twists, deck) {
    return dealWith(rng, config, twists, deck);
  },

  view(board) {
    return buildView(board);
  },

  canPickUp(board, pile, index) {
    // NO_TWISTS: see the file header — which cards can be grabbed never depends on twists here,
    // matching Klondike/Golf, and it keeps this in lockstep with view()'s pickableFrom.
    const run = runAt(board, pile, index, NO_TWISTS);
    return run !== null && run.length > 0;
  },

  legalTargets(board, pile, index, twists) {
    const run = runAt(board, pile, index, twists);
    if (!run || run.length === 0) return [];
    return targetsFor(board, pile, run, twists);
  },

  autoTarget(board, pile, index, twists) {
    const run = runAt(board, pile, index, twists);
    if (!run || run.length === 0) return null;
    const targets = targetsFor(board, pile, run, twists);
    for (const to of targets) if (foundationIndex(to) >= 0) return to;
    for (const to of targets) if (tableauIndex(to) >= 0) return to;
    for (const to of targets) if (cellIndex(to) >= 0) return to;
    return null;
  },

  move(board, pile, index, toPile, twists) {
    return doMove(board, pile, index, toPile, twists);
  },

  draw(board) {
    // No stock, no waste: tapping it never does anything.
    return noop(board);
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

export default freecell;
