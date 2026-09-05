/**
 * Klondike solver — "thoughtful" solitaire (every card identity is known, which a KlondikeBoard
 * already carries). PURE TS: no DOM, no timers, no engine state, so it runs in a test, in the sim,
 * and inside a Web Worker unchanged. Way of the Scholar uses `findWinnableSeed` to hand the player a
 * deal that is *proven* winnable.
 *
 * Architecture (after Solvitaire, Blake & Gent 2019 — see docs/04-research.md §6):
 *  - depth-first search over an in-place mutable copy of the board with apply/undo, so a node costs
 *    no clone;
 *  - a transposition table keyed by a canonical position string (tableau columns sorted, foundations
 *    sorted, stock/waste as sequences) — column and foundation identity is a symmetry, not a fact;
 *  - safe-automove: a card that can never be needed in the tableau again goes home immediately and
 *    the node does not branch;
 *  - move ordering: foundation, then a move that flips a face-down card, then king-to-empty, then
 *    from the waste, then the rest, then draw;
 *  - a node budget turns "too hard" into 'unknown' rather than a hang.
 *
 * Deliberate incompleteness (both only ever weaken a 'lost' claim, never a 'won' one):
 *  - the solver never takes a card back OFF a foundation. It is legal in Klondike and vanishingly
 *    rarely necessary; allowing it multiplies the branching factor.
 *  - the search is depth-limited (`maxDepth`); hitting the limit reports 'unknown', not 'lost'.
 *
 * The acceptance rules below are a local, allocation-free copy of `foundationAccepts` /
 * `tableauAccepts` / the colour rule in `../games/klondike.ts` (which allocate a CardDef per call).
 * They must stay in step with that file; `tests/solver.test.ts` replays every solved line through the
 * real `klondike.move` / `klondike.draw`, which is what keeps them honest.
 */
import { cardDef, isRed } from '$engine/types';
import type { CardId } from '$engine/types';
import { dealKlondike, type KlondikeBoard } from '../games/klondike';
import { NO_TWISTS, type GameConfig, type Twists } from '../module';

// ------------------------------------------------------------------ tables ---

const DECK = 52;
const RANK: number[] = new Array<number>(DECK);
const SUIT: number[] = new Array<number>(DECK);
const RED: boolean[] = new Array<boolean>(DECK);
for (let i = 0; i < DECK; i++) {
  const d = cardDef(i);
  RANK[i] = d.rank;
  SUIT[i] = Math.floor(i / 13);
  RED[i] = isRed(d.suit);
}
/** SUITS is ['S','H','D','C']: 0 and 3 are black, 1 and 2 red. */
const OPPOSITE: readonly [number, number][] = [
  [1, 2],
  [0, 3],
  [0, 3],
  [1, 2]
];

const rank = (c: CardId): number => RANK[c] as number;
const suit = (c: CardId): number => SUIT[c] as number;
const red = (c: CardId): boolean => RED[c] as boolean;

// ------------------------------------------------------------------- types ---

/** One step of a solution line. Replay with `klondike.move(board, pile, index, to)` / `klondike.draw`. */
export type SolverMove = { pile: string; index: number; to: string } | { kind: 'draw' };

export interface SolverOptions {
  /** Nodes expanded before the search gives up with 'unknown'. */
  budgetNodes?: number;
  twists?: Twists;
  /** Plies before a line is abandoned. A line that hits it reports 'unknown', never 'lost'. */
  maxDepth?: number;
}

export interface SolverResult {
  result: 'won' | 'lost' | 'unknown';
  nodes: number;
  /** Present only when `result` is 'won'. */
  line?: SolverMove[];
}

export const DEFAULT_BUDGET = 200_000;
export const DEFAULT_MAX_DEPTH = 600;

// -------------------------------------------------------------- candidates ---

interface Cand {
  pri: number;
  sub: number;
  /** -1 = the waste, 0..6 = a tableau column. */
  from: number;
  /** Offset into that column's face-up run (0 for the waste). */
  off: number;
  /** Destination foundation, or -1. */
  toFound: number;
  /** Destination column, or -1. */
  toCol: number;
}

const PRI_FOUNDATION = 0;
const PRI_FLIP = 1;
const PRI_EMPTY = 2; // king (or wild) into an empty column
const PRI_WASTE = 3;
const PRI_OTHER = 4;
/** Burning a Wild card on a foundation is almost always wrong; try everything else first. */
const PRI_WILD_HOME = 5;

interface Undo {
  moved: CardId[];
  flipped: boolean;
}

// ------------------------------------------------------------------ solver ---

class Search {
  private readonly down: CardId[][];
  private readonly up: CardId[][];
  private readonly found: CardId[][];
  private stock: CardId[];
  private waste: CardId[];
  private redeals: number;
  private readonly drawCount: number;

  private readonly wild: boolean[];
  private readonly mirror: boolean[];
  private readonly anyWild: boolean;
  /** Mirror cards still in play break the safe-automove colour argument; there are rarely any. */
  private readonly mirrorCards: CardId[] = [];

  private homed = 0;
  private readonly budget: number;
  private readonly maxDepth: number;
  nodes = 0;
  /** A budget or depth cut happened somewhere, so a failure is 'unknown' rather than 'lost'. */
  truncated = false;

  private readonly tt = new Map<string, number>();
  private readonly path = new Set<string>();
  readonly line: SolverMove[] = [];

  constructor(board: KlondikeBoard, opts: SolverOptions | undefined) {
    this.down = Array.from({ length: 7 }, (_, i) => (board.tableau[i]?.down ?? []).slice());
    this.up = Array.from({ length: 7 }, (_, i) => (board.tableau[i]?.up ?? []).slice());
    this.found = Array.from({ length: 4 }, (_, i) => (board.foundations[i] ?? []).slice());
    this.stock = board.stock.slice();
    this.waste = board.waste.slice();
    this.redeals = board.redealsLeft;
    this.drawCount = board.drawCount;
    for (const f of this.found) this.homed += f.length;

    const twists = opts?.twists ?? NO_TWISTS;
    this.wild = new Array<boolean>(DECK);
    this.mirror = new Array<boolean>(DECK);
    let anyWild = false;
    for (let i = 0; i < DECK; i++) {
      const w = twists.isWild(i);
      const m = twists.isMirror(i);
      this.wild[i] = w;
      this.mirror[i] = m;
      anyWild ||= w;
      if (m) this.mirrorCards.push(i);
    }
    this.anyWild = anyWild;

    this.budget = Math.max(1, opts?.budgetNodes ?? DEFAULT_BUDGET);
    this.maxDepth = Math.max(1, opts?.maxDepth ?? DEFAULT_MAX_DEPTH);
  }

  // ------------------------------------------------------------ acceptance ---

  private foundationTakes(pile: CardId[], card: CardId): boolean {
    const need = pile.length + 1;
    if (need > 13) return false;
    if (this.wild[card] === true) return true;
    if (rank(card) !== need) return false;
    if (pile.length === 0) return true;
    let anchor: CardId | undefined = pile[0];
    if (this.anyWild) {
      anchor = pile.find((c) => this.wild[c] !== true);
      if (anchor === undefined) return true;
    }
    return suit(anchor as CardId) === suit(card);
  }

  private columnTakes(col: number, card: CardId): boolean {
    const up = this.up[col] as CardId[];
    const top = up[up.length - 1];
    if (top === undefined) {
      if ((this.down[col] as CardId[]).length > 0) return false;
      return this.wild[card] === true || rank(card) === 13;
    }
    if (this.wild[card] === true || this.wild[top] === true) return true;
    if (rank(card) !== rank(top) - 1) return false;
    if (this.mirror[card] === true || this.mirror[top] === true) return true;
    return red(top) !== red(card);
  }

  // ------------------------------------------------------------------ key ---

  /**
   * Canonical position key. Columns and foundations are sorted because their slot index is a
   * symmetry of Klondike, not part of the position; `moves` is excluded for the same reason.
   * A foundation is fully described by its top card under the classic rules (suit + height), so the
   * cheap form is used unless a Wild card could be sitting in one.
   */
  private key(): string {
    const cols: string[] = [];
    for (let i = 0; i < 7; i++) {
      cols.push(`${(this.down[i] as CardId[]).join(',')}|${(this.up[i] as CardId[]).join(',')}`);
    }
    cols.sort();
    const f: string[] = [];
    for (let j = 0; j < 4; j++) {
      const p = this.found[j] as CardId[];
      if (this.anyWild) f.push(p.join(','));
      else f.push(p.length === 0 ? '' : String(p[p.length - 1]));
    }
    f.sort();
    return `${cols.join('/')}#${f.join('/')}#${this.stock.join(',')}#${this.waste.join(',')}#${this.redeals}`;
  }

  // -------------------------------------------------------------- automove ---

  /**
   * The one card that can go home and can never be wanted in the tableau again: rank ≤ 2, or both
   * opposite-colour foundations already hold rank-1, so nothing is left for it to cover. Playing it
   * immediately, without branching, is the single biggest saving in the search.
   *
   * Twists narrow it rather than switching it off: a Wild card anywhere on a foundation makes the
   * suit-height bookkeeping meaningless (bail out), a Wild card in hand is never "safe" because it
   * can cover anything, and a Mirror card counts as both colours, so every mirrored rank-1 card must
   * be home too before the colour argument holds.
   */
  private safeAuto(): Cand | null {
    const height = [0, 0, 0, 0];
    const slot = [-1, -1, -1, -1];
    let empty = -1;
    for (let j = 0; j < 4; j++) {
      const p = this.found[j] as CardId[];
      const first = p[0];
      if (first === undefined) {
        if (empty < 0) empty = j;
        continue;
      }
      if (this.anyWild) for (const c of p) if (this.wild[c] === true) return null;
      height[suit(first)] = p.length;
      slot[suit(first)] = j;
    }
    const target = (c: CardId): number => {
      const s = suit(c);
      const r = rank(c);
      // A suit that already has a foundation has its ace home, so an ace wants an empty slot.
      if (r === 1) return (slot[s] as number) >= 0 ? -1 : empty;
      if ((slot[s] as number) < 0) return -1;
      return (height[s] as number) === r - 1 ? (slot[s] as number) : -1;
    };
    const safe = (c: CardId): boolean => {
      if (this.wild[c] === true) return false;
      const r = rank(c);
      if (r <= 2) return true;
      const opp = OPPOSITE[suit(c)] as [number, number];
      if ((height[opp[0]] as number) < r - 1 || (height[opp[1]] as number) < r - 1) return false;
      for (const m of this.mirrorCards) {
        if (rank(m) === r - 1 && (height[suit(m)] as number) < rank(m)) return false;
      }
      return true;
    };
    const top = this.waste[this.waste.length - 1];
    if (top !== undefined && safe(top)) {
      const j = target(top);
      if (j >= 0) return { pri: PRI_FOUNDATION, sub: 0, from: -1, off: 0, toFound: j, toCol: -1 };
    }
    for (let i = 0; i < 7; i++) {
      const up = this.up[i] as CardId[];
      const c = up[up.length - 1];
      if (c === undefined || !safe(c)) continue;
      const j = target(c);
      if (j >= 0) {
        return { pri: PRI_FOUNDATION, sub: 0, from: i, off: up.length - 1, toFound: j, toCol: -1 };
      }
    }
    return null;
  }

  // -------------------------------------------------------------- children ---

  private children(): Cand[] {
    const out: Cand[] = [];
    /**
     * Two empty columns (or two empty foundations) are interchangeable, so only the first is offered
     * as a destination: the rest are the same position under a different name.
     */
    let firstEmptyCol = -1;
    for (let i = 0; i < 7; i++) {
      if ((this.up[i] as CardId[]).length === 0 && (this.down[i] as CardId[]).length === 0) {
        firstEmptyCol = i;
        break;
      }
    }

    const offer = (from: number, off: number, card: CardId, wholeRun: boolean) => {
      const fromDown = from >= 0 ? (this.down[from] as CardId[]).length : 0;
      if (wholeRun) {
        const home = this.wild[card] === true ? PRI_WILD_HOME : PRI_FOUNDATION;
        let offeredEmpty = false;
        for (let j = 0; j < 4; j++) {
          const p = this.found[j] as CardId[];
          if (!this.foundationTakes(p, card)) continue;
          if (p.length === 0) {
            if (offeredEmpty) continue; // empty foundations are interchangeable
            offeredEmpty = true;
          }
          out.push({ pri: home, sub: 0, from, off, toFound: j, toCol: -1 });
        }
      }
      for (let t = 0; t < 7; t++) {
        if (t === from) continue;
        const empty = (this.up[t] as CardId[]).length === 0 && (this.down[t] as CardId[]).length === 0;
        if (empty && t !== firstEmptyCol) continue;
        if (!this.columnTakes(t, card)) continue;
        // Relocating a whole naked column into an empty one reveals nothing and changes nothing.
        if (empty && from >= 0 && off === 0 && fromDown === 0) continue;
        const flips = from >= 0 && off === 0 && fromDown > 0;
        const pri = flips ? PRI_FLIP : empty ? PRI_EMPTY : from === -1 ? PRI_WASTE : PRI_OTHER;
        out.push({ pri, sub: -fromDown, from, off, toFound: -1, toCol: t });
      }
    };

    const wasteTop = this.waste[this.waste.length - 1];
    if (wasteTop !== undefined) offer(-1, 0, wasteTop, true);
    for (let i = 0; i < 7; i++) {
      const up = this.up[i] as CardId[];
      for (let k = 0; k < up.length; k++) {
        offer(i, k, up[k] as CardId, k === up.length - 1);
      }
    }
    out.sort((a, b) => a.pri - b.pri || a.sub - b.sub);
    return out;
  }

  // --------------------------------------------------------- apply / undo ---

  private emit(c: Cand): SolverMove {
    const pile = c.from === -1 ? 'waste' : `t${c.from}`;
    const index =
      c.from === -1 ? this.waste.length - 1 : (this.down[c.from] as CardId[]).length + c.off;
    const to = c.toFound >= 0 ? `f${c.toFound}` : `t${c.toCol}`;
    return { pile, index, to };
  }

  private apply(c: Cand): Undo {
    let moved: CardId[];
    if (c.from === -1) moved = [this.waste.pop() as CardId];
    else moved = (this.up[c.from] as CardId[]).splice(c.off);
    if (c.toFound >= 0) {
      (this.found[c.toFound] as CardId[]).push(...moved);
      this.homed += moved.length;
    } else {
      (this.up[c.toCol] as CardId[]).push(...moved);
    }
    let flipped = false;
    if (c.from >= 0) {
      const up = this.up[c.from] as CardId[];
      const down = this.down[c.from] as CardId[];
      if (up.length === 0 && down.length > 0) {
        up.push(down.pop() as CardId);
        flipped = true;
      }
    }
    return { moved, flipped };
  }

  private undo(c: Cand, u: Undo): void {
    if (c.from >= 0 && u.flipped) {
      (this.down[c.from] as CardId[]).push((this.up[c.from] as CardId[]).pop() as CardId);
    }
    if (c.toFound >= 0) {
      (this.found[c.toFound] as CardId[]).length -= u.moved.length;
      this.homed -= u.moved.length;
    } else {
      (this.up[c.toCol] as CardId[]).length -= u.moved.length;
    }
    if (c.from === -1) this.waste.push(u.moved[0] as CardId);
    else (this.up[c.from] as CardId[]).push(...u.moved);
  }

  /** null when the stock is dead: no cards and no redeal left. */
  private applyDraw(): { count: number; recycled: boolean; spent: boolean } | null {
    if (this.stock.length > 0) {
      const count = Math.min(this.drawCount, this.stock.length);
      const taken = this.stock.splice(this.stock.length - count, count).reverse();
      this.waste.push(...taken);
      return { count, recycled: false, spent: false };
    }
    if (this.waste.length === 0 || this.redeals === 0) return null;
    this.stock = this.waste.slice().reverse();
    this.waste = [];
    const spent = this.redeals > 0;
    if (spent) this.redeals -= 1;
    return { count: 0, recycled: true, spent };
  }

  private undoDraw(d: { count: number; recycled: boolean; spent: boolean }): void {
    if (d.recycled) {
      this.waste = this.stock.slice().reverse();
      this.stock = [];
      if (d.spent) this.redeals += 1;
      return;
    }
    const taken = this.waste.splice(this.waste.length - d.count, d.count).reverse();
    this.stock.push(...taken);
  }

  // ------------------------------------------------------------- the search ---

  run(): 'won' | 'lost' | 'unknown' {
    if (this.homed === DECK) return 'won';
    const won = this.search(this.maxDepth);
    if (won) return 'won';
    return this.truncated ? 'unknown' : 'lost';
  }

  private search(remaining: number): boolean {
    if (this.homed === DECK) return true;
    if (this.nodes >= this.budget) {
      this.truncated = true;
      return false;
    }
    if (remaining <= 0) {
      this.truncated = true;
      return false;
    }
    this.nodes++;

    const key = this.key();
    if (this.path.has(key)) return false; // the position repeats on this line
    const lost = this.tt.get(key);
    if (lost !== undefined && lost >= remaining) return false;
    this.path.add(key);

    const auto = this.safeAuto();
    const kids = auto ? [auto] : this.children();

    for (const c of kids) {
      const move = this.emit(c);
      const u = this.apply(c);
      this.line.push(move);
      if (this.search(remaining - 1)) return true;
      this.line.pop();
      this.undo(c, u);
    }

    // The draw is the last resort: it is the only move that is never progress on its own.
    if (!auto) {
      const d = this.applyDraw();
      if (d) {
        this.line.push({ kind: 'draw' });
        if (this.search(remaining - 1)) return true;
        this.line.pop();
        this.undoDraw(d);
      }
    }

    this.path.delete(key);
    this.tt.set(key, remaining);
    return false;
  }
}

// -------------------------------------------------------------- public API ---

/**
 * Solve a Klondike position with every card visible. 'lost' means proven unwinnable within the
 * documented incompleteness above; 'unknown' means the budget (or the depth limit) ran out first.
 */
export function solveKlondike(board: KlondikeBoard, opts?: SolverOptions): SolverResult {
  const s = new Search(board, opts);
  const result = s.run();
  if (result === 'won') return { result, nodes: s.nodes, line: s.line.slice() };
  return { result, nodes: s.nodes };
}

/** true / false / null when the budget ran out before either was proven. */
export function isWinnable(seed: number, config?: GameConfig, opts?: SolverOptions): boolean | null {
  const board = dealKlondike(seed, config, opts?.twists);
  const r = solveKlondike(board, opts);
  if (r.result === 'won') return true;
  if (r.result === 'lost') return false;
  return null;
}

export interface FindOptions {
  maxTries?: number;
  budgetNodes?: number;
  twists?: Twists;
  maxDepth?: number;
}

export interface FoundSeed {
  seed: number;
  tries: number;
  nodes: number;
  /** The proven line, so a hint system (or the Scholar's ghost) can replay it. */
  line: SolverMove[];
}

/**
 * Walk seeds startSeed, startSeed+1, … and return the first deal PROVEN winnable. This is the
 * Scholar's deal: a smaller per-try budget and several tries beats one big search, because ~82 % of
 * draw-1 Klondike deals are winnable and the easy ones fall out in a few thousand nodes.
 */
export function findWinnableSeed(
  startSeed: number,
  config?: GameConfig,
  opts?: FindOptions
): FoundSeed | null {
  const maxTries = Math.max(1, opts?.maxTries ?? 25);
  const budgetNodes = opts?.budgetNodes ?? 60_000;
  for (let i = 0; i < maxTries; i++) {
    const seed = (startSeed + i) >>> 0;
    const board = dealKlondike(seed, config, opts?.twists);
    const r = solveKlondike(board, {
      budgetNodes,
      ...(opts?.twists ? { twists: opts.twists } : {}),
      ...(opts?.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {})
    });
    if (r.result === 'won' && r.line) {
      return { seed, tries: i + 1, nodes: r.nodes, line: r.line };
    }
  }
  return null;
}
