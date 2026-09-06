/**
 * Klondike — the first GameModule. PURE and IMMUTABLE: every move returns a fresh board.
 * No DOM / Svelte / Pixi. See src/rules/module.ts for THE contract.
 *
 * Twists honoured:
 *  - wild   : the card may be placed on anything (tableau or foundation) and accepts anything on it.
 *  - mirror : the card counts as both colours, so it stacks either way in the tableau.
 *  - glass  : `dealtFaceUp(card)` cards dealt into a tableau's face-down stack stay visible in view().
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
  type BoardCardView,
  type BoardView,
  type DealDeck,
  type GameConfig,
  type GameModule,
  type GameOption,
  type MoveResult,
  type PileView,
  type RulesEvent,
  type Twists
} from '../module';

export interface KlondikeColumn {
  down: CardId[];
  up: CardId[];
}

export interface KlondikeBoard {
  /** Face-down draw pile; the TOP is the LAST element. */
  stock: CardId[];
  /** Face-up discard; the TOP (only pickable card) is the LAST element. */
  waste: CardId[];
  /** Four foundations, each built A→K. */
  foundations: CardId[][];
  /** Seven columns of face-down + face-up cards. */
  tableau: KlondikeColumn[];
  drawCount: 1 | 3;
  /** Remaining stock recycles; -1 = unlimited, 0 = none left. */
  redealsLeft: number;
  moves: number;
  /** Cards the Glass twist dealt face-up while they sit in a face-down stack. */
  glass: CardId[];
  /** How many cards this hand was dealt — the board's deck may not be the standard 52 (docs/12). */
  dealt: number;
}

export const FOUNDATION_IDS = ['f0', 'f1', 'f2', 'f3'] as const;
export const TABLEAU_IDS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'] as const;

const OPTIONS: GameOption[] = [
  {
    id: 'draw',
    label: 'Draw',
    kind: 'select',
    values: [
      { value: '1', label: 'Draw one' },
      { value: '3', label: 'Draw three' }
    ],
    default: '1'
  },
  {
    id: 'redeals',
    label: 'Redeals',
    kind: 'select',
    values: [
      { value: 'unlimited', label: 'Unlimited' },
      { value: '3', label: 'Three' },
      { value: '0', label: 'None' }
    ],
    default: 'unlimited'
  }
];

// ---------------------------------------------------------------- pile ids ---

function tableauIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 't') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 && i < 7 ? i : -1;
}

function foundationIndex(pile: string): number {
  if (pile.length !== 2 || pile[0] !== 'f') return -1;
  const i = Number(pile[1]);
  return Number.isInteger(i) && i >= 0 && i < 4 ? i : -1;
}

// ------------------------------------------------------------- card colour ---

function redCard(id: CardId): boolean {
  return isRed(cardDef(id).suit);
}

/** Two cards may sit on top of each other colour-wise (mirror counts as both colours). */
function colourOk(lower: CardId, upper: CardId, twists: Twists): boolean {
  if (twists.isMirror(lower) || twists.isMirror(upper)) return true;
  return redCard(lower) !== redCard(upper);
}

// ------------------------------------------------------------- acceptance ---

/** Foundations are ranked by height: a pile of n cards wants rank n+1, in the pile's suit. */
export function foundationAccepts(pile: readonly CardId[], card: CardId, twists: Twists): boolean {
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

/** Can `card` (the bottom card of a run) land on tableau column `col`? */
export function tableauAccepts(col: KlondikeColumn, card: CardId, twists: Twists): boolean {
  const top = col.up[col.up.length - 1];
  if (top === undefined) {
    // A column with face-down cards but no face-up card is not a legal empty slot; the
    // auto-flip in move() means this cannot happen on a well-formed board, but stay safe.
    if (col.down.length > 0) return false;
    return isWildCard(card, twists) || cardDef(card).rank === 13;
  }
  if (isWildCard(card, twists) || isWildCard(top, twists)) return true;
  if (cardDef(card).rank !== cardDef(top).rank - 1) return false;
  return colourOk(top, card, twists);
}

// ------------------------------------------------------------------- runs ---

/** The cards that would be picked up at (pile, index), or null if that is not pickable. */
export function runAt(board: KlondikeBoard, pile: string, index: number): CardId[] | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (pile === 'waste') {
    if (board.waste.length === 0 || index !== board.waste.length - 1) return null;
    const c = board.waste[index];
    return c === undefined ? null : [c];
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
    if (!col) return null;
    if (index < col.down.length) return null; // face-down cards are never pickable
    const offset = index - col.down.length;
    if (offset >= col.up.length) return null;
    return col.up.slice(offset);
  }
  return null; // 'stock' and anything unknown
}

// ------------------------------------------------------------------ clone ---

function cloneBoard(board: KlondikeBoard): KlondikeBoard {
  return {
    stock: board.stock.slice(),
    waste: board.waste.slice(),
    foundations: board.foundations.map((f) => f.slice()),
    tableau: board.tableau.map((c) => ({ down: c.down.slice(), up: c.up.slice() })),
    drawCount: board.drawCount,
    redealsLeft: board.redealsLeft,
    moves: board.moves,
    glass: board.glass.slice(),
    dealt: board.dealt
  };
}

// ------------------------------------------------------------------- deal ---

function drawCountOf(config: GameConfig | undefined): 1 | 3 {
  return optionValue(klondike as GameModule, config, 'draw') === '3' ? 3 : 1;
}

function redealsOf(config: GameConfig | undefined): number {
  const v = optionValue(klondike as GameModule, config, 'redeals');
  if (v === 'unlimited') return -1;
  const n = Number(v);
  return Number.isFinite(n) ? n : -1;
}

function dealWith(rng: () => number, config: GameConfig, twists: Twists, deck: DealDeck): KlondikeBoard {
  const shuffled = shuffle(deck, rng);
  const tableau: KlondikeColumn[] = Array.from({ length: 7 }, () => ({ down: [], up: [] }));
  let k = 0;
  // The classic deal: one card to each remaining column, row by row.
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const card = shuffled[k++];
      const target = tableau[col];
      if (card === undefined || !target) continue;
      if (row === col) target.up.push(card);
      else target.down.push(card);
    }
  }
  const glass: CardId[] = [];
  for (const col of tableau) for (const c of col.down) if (twists.dealtFaceUp(c)) glass.push(c);
  return {
    stock: shuffled.slice(k),
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    drawCount: drawCountOf(config),
    redealsLeft: redealsOf(config),
    moves: 0,
    glass,
    dealt: shuffled.length
  };
}

/** Convenience for tests, the sim and bug reports: a seeded Klondike deal off the standard 52. */
export function dealKlondike(
  seed: number,
  config?: GameConfig,
  twists?: Twists,
  deck?: DealDeck
): KlondikeBoard {
  return dealWith(mulberry32(seed), config ?? {}, twists ?? NO_TWISTS, deck ?? deckCardIds(STANDARD_52));
}

// ------------------------------------------------------------------- view ---

/**
 * Face-down card as the renderer wants it: the id is ALWAYS carried (module.ts: one stable sprite per
 * card through flips), and `faceUp` alone says whether the face shows. Glass cards were dealt face-up
 * while still sitting in a face-down stack, so they show.
 */
function faceDownView(id: CardId, glass: readonly CardId[]): BoardCardView {
  return { id, faceUp: glass.includes(id) };
}

function canRecycle(board: KlondikeBoard): boolean {
  return board.stock.length === 0 && board.waste.length > 0 && board.redealsLeft !== 0;
}

function buildView(board: KlondikeBoard): BoardView {
  const piles: PileView[] = [];

  const stockPile: PileView = {
    id: 'stock',
    kind: 'stock',
    x: 0,
    y: 0,
    fan: 'none',
    cards: board.stock.map((id) => faceDownView(id, board.glass))
  };
  if (board.stock.length === 0 && !canRecycle(board)) stockPile.blocked = true;
  piles.push(stockPile);

  const waste: PileView = {
    id: 'waste',
    kind: 'waste',
    x: 1,
    y: 0,
    fan: board.drawCount === 3 ? 'right' : 'none',
    cards: board.waste.map((id) => ({ id, faceUp: true })),
    ...(board.waste.length > 0 ? { pickableFrom: board.waste.length - 1 } : {})
  };
  piles.push(waste);

  for (let i = 0; i < 4; i++) {
    const f = board.foundations[i] ?? [];
    piles.push({
      id: `f${i}`,
      kind: 'foundation',
      x: 3 + i,
      y: 0,
      fan: 'none',
      cards: f.map((id) => ({ id, faceUp: true })),
      ...(f.length > 0 ? { pickableFrom: f.length - 1 } : {})
    });
  }

  for (let i = 0; i < 7; i++) {
    const col = board.tableau[i] ?? { down: [], up: [] };
    const cards: BoardCardView[] = [
      ...col.down.map((id) => faceDownView(id, board.glass)),
      ...col.up.map((id) => ({ id, faceUp: true }))
    ];
    piles.push({
      id: `t${i}`,
      kind: 'tableau',
      x: i,
      y: 1.25,
      fan: 'down',
      cards,
      ...(col.up.length > 0 ? { pickableFrom: col.down.length } : {})
    });
  }

  return { cols: 7, rows: 4.6, piles };
}

// -------------------------------------------------------------- targeting ---

function targetsFor(board: KlondikeBoard, pile: string, run: CardId[], twists: Twists): string[] {
  const out: string[] = [];
  const bottom = run[0];
  if (bottom === undefined) return out;
  const fromFoundation = foundationIndex(pile) >= 0;

  if (run.length === 1 && !fromFoundation) {
    for (let i = 0; i < 4; i++) {
      const f = board.foundations[i];
      if (f && foundationAccepts(f, bottom, twists)) out.push(`f${i}`);
    }
  }
  for (let i = 0; i < 7; i++) {
    const id = `t${i}`;
    if (id === pile) continue;
    const col = board.tableau[i];
    if (col && tableauAccepts(col, bottom, twists)) out.push(id);
  }
  return out;
}

/** A move that changes nothing about what is reachable: a whole naked column to an empty one. */
function noProgressShuffle(board: KlondikeBoard, pile: string, index: number, to: string): boolean {
  const from = tableauIndex(pile);
  const dest = tableauIndex(to);
  if (from < 0 || dest < 0) return false;
  const src = board.tableau[from];
  const target = board.tableau[dest];
  if (!src || !target) return false;
  if (target.up.length > 0 || target.down.length > 0) return false;
  // Moving the entire column, with nothing face-down to reveal behind it.
  return src.down.length === 0 && index === 0;
}

// ------------------------------------------------------------------- move ---

function doMove(
  board: KlondikeBoard,
  pile: string,
  index: number,
  toPile: string,
  twists: Twists
): MoveResult<KlondikeBoard> {
  const run = runAt(board, pile, index);
  if (!run || run.length === 0) return noop(board);
  if (!targetsFor(board, pile, run, twists).includes(toPile)) return noop(board);

  const next = cloneBoard(board);
  const events: RulesEvent[] = [];
  const homed: CardId[] = [];

  // lift
  const fromFoundation = foundationIndex(pile);
  const fromTableau = tableauIndex(pile);
  if (pile === 'waste') next.waste.pop();
  else if (fromFoundation >= 0) next.foundations[fromFoundation]?.pop();
  else if (fromTableau >= 0) {
    const col = next.tableau[fromTableau];
    if (col) col.up = col.up.slice(0, index - col.down.length);
  }

  // land
  const toFoundation = foundationIndex(toPile);
  const toTableau = tableauIndex(toPile);
  if (toFoundation >= 0) {
    const f = next.foundations[toFoundation];
    if (!f) return noop(board);
    f.push(...run);
    homed.push(...run);
  } else if (toTableau >= 0) {
    const col = next.tableau[toTableau];
    if (!col) return noop(board);
    col.up = [...col.up, ...run];
  } else return noop(board);

  // auto-flip the newly exposed card in the origin column
  if (fromTableau >= 0) {
    const col = next.tableau[fromTableau];
    if (col && col.up.length === 0 && col.down.length > 0) {
      const flipped = col.down[col.down.length - 1];
      if (flipped !== undefined) {
        col.down = col.down.slice(0, -1);
        col.up = [flipped];
        next.glass = next.glass.filter((c) => c !== flipped);
        events.push({ type: 'flip', pile, index: col.down.length });
      }
    }
  }

  next.moves = board.moves + 1;
  return { board: next, homed, changed: true, won: isWonBoard(next), events };
}

// ------------------------------------------------------------------- draw ---

function doDraw(board: KlondikeBoard): MoveResult<KlondikeBoard> {
  if (board.stock.length > 0) {
    const count = Math.min(board.drawCount, board.stock.length);
    const next = cloneBoard(board);
    const taken = next.stock.splice(next.stock.length - count, count).reverse();
    next.waste.push(...taken);
    next.moves = board.moves + 1;
    return {
      board: next,
      homed: [],
      changed: true,
      won: false,
      events: [{ type: 'draw', count }]
    };
  }
  if (!canRecycle(board)) return noop(board);
  const next = cloneBoard(board);
  next.stock = next.waste.slice().reverse();
  next.waste = [];
  if (next.redealsLeft > 0) next.redealsLeft -= 1;
  next.moves = board.moves + 1;
  return { board: next, homed: [], changed: true, won: false, events: [{ type: 'recycle' }] };
}

// ------------------------------------------------------------- state tests ---

/**
 * Won when every dealt card is home. NOT `foundations.every(f => f.length === 13)`: that assumes
 * a 52-card deck, and with a wild card in play (the Joker, docs/12) it is wrong either way — a
 * deck bigger than 52 could satisfy it while a card is still stranded on the table, and a deck
 * smaller than 52 could never satisfy it at all. A foundation holds its thirteen ranks and, once
 * complete, one rankless card crowning it (`foundationAccepts`) — so a 53-card deck does fit:
 * fifty-two cards in their four runs, and the Joker on top of whichever finishes first.
 */
function isWonBoard(board: KlondikeBoard): boolean {
  if (board.foundations.length !== 4) return false;
  const home = board.foundations.reduce((sum, f) => sum + f.length, 0);
  return home === board.dealt;
}

/** Every legal non-draw move on the board. Useful for tests, autoplay and the solver. */
export function legalMoves(
  board: KlondikeBoard,
  twists: Twists = NO_TWISTS
): { pile: string; index: number; to: string }[] {
  const out: { pile: string; index: number; to: string }[] = [];
  const push = (pile: string, index: number) => {
    const run = runAt(board, pile, index);
    if (!run || run.length === 0) return;
    for (const to of targetsFor(board, pile, run, twists)) out.push({ pile, index, to });
  };
  if (board.waste.length > 0) push('waste', board.waste.length - 1);
  for (let i = 0; i < 4; i++) {
    const f = board.foundations[i];
    if (f && f.length > 0) push(`f${i}`, f.length - 1);
  }
  for (let i = 0; i < 7; i++) {
    const col = board.tableau[i];
    if (!col) continue;
    for (let k = 0; k < col.up.length; k++) push(`t${i}`, col.down.length + k);
  }
  return out;
}

function stuck(board: KlondikeBoard, twists: Twists): boolean {
  if (legalMoves(board, twists).length > 0) return false;
  // A draw would change something if there is stock left, or the waste can be recycled.
  if (board.stock.length > 0) return false;
  if (canRecycle(board)) return false;
  return true;
}

function hashBoard(board: KlondikeBoard): string {
  // `moves` is deliberately excluded: the hash identifies a POSITION, so autoplay's cycle
  // detection works. `dealt` is excluded too: it is fixed at deal time and identical across every
  // position reachable from one deal, so it could never help distinguish two of them. Everything
  // else that can differ between positions is included.
  const t = board.tableau.map((c) => `${c.down.join('.')}:${c.up.join('.')}`).join('/');
  const f = board.foundations.map((x) => x.join('.')).join('/');
  return `${board.stock.join('.')}|${board.waste.join('.')}|${f}|${t}|${board.drawCount}|${board.redealsLeft}|${board.glass.join('.')}`;
}

// ----------------------------------------------------------------- module ---

export const klondike: GameModule<KlondikeBoard> = {
  id: 'klondike',
  name: 'Klondike',
  blurb: 'The solitaire. Build four foundations from ace to king; dig the columns out to do it.',
  options: OPTIONS,
  honours: ['wild', 'mirror', 'glass'],

  deal(rng, config, twists, deck) {
    return dealWith(rng, config, twists, deck);
  },

  view(board) {
    return buildView(board);
  },

  canPickUp(board, pile, index) {
    const run = runAt(board, pile, index);
    return run !== null && run.length > 0;
  },

  legalTargets(board, pile, index, twists) {
    const run = runAt(board, pile, index);
    if (!run || run.length === 0) return [];
    return targetsFor(board, pile, run, twists);
  },

  autoTarget(board, pile, index, twists) {
    const run = runAt(board, pile, index);
    if (!run || run.length === 0) return null;
    const targets = targetsFor(board, pile, run, twists);
    for (const to of targets) if (foundationIndex(to) >= 0) return to;
    for (const to of targets) {
      if (to === pile) continue;
      if (noProgressShuffle(board, pile, index, to)) continue;
      return to;
    }
    return null;
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

export default klondike;
