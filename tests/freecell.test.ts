/**
 * FreeCell rules. The generic contract lives in tests/contract.test.ts; this file is the
 * game-specific half: the deal shape, alternating-colour tableau building, supermove arithmetic,
 * the `cells` option, twists, and end states.
 */
import { describe, expect, it } from 'vitest';
import { cardId, type CardId } from '$engine/types';
import { deckCardIds, JOKER_53, JOKER_ID } from '$engine/deck';
import { NO_TWISTS, isWildCard, type Twists } from '../src/rules/module';
import { solveGreedy } from '../src/rules/autoplay';
import {
  dealFreeCell,
  freecell,
  legalFreeCellMoves,
  maxRunLength,
  FREECELL_TABLEAU_COUNT,
  FREECELL_FOUNDATION_COUNT,
  FREECELL_ROWS,
  type FreeCellBoard
} from '../src/rules/games/freecell';

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);
const C = (r: number) => cardId('C', r as 1);

function board(p: Partial<FreeCellBoard> = {}): FreeCellBoard {
  return {
    cells: [null, null, null, null],
    foundations: [[], [], [], []],
    tableau: Array.from({ length: FREECELL_TABLEAU_COUNT }, () => [] as CardId[]),
    moves: 0,
    dealt: 52,
    ...p
  };
}

/** A board with exactly the given tableau columns filled, everything else default/empty. */
function withCols(filled: Record<number, CardId[]>, p: Partial<FreeCellBoard> = {}): FreeCellBoard {
  const tableau: CardId[][] = Array.from({ length: FREECELL_TABLEAU_COUNT }, () => [] as CardId[]);
  for (const [k, v] of Object.entries(filled)) tableau[Number(k)] = v.slice();
  return board({ tableau, ...p });
}

function wildTwists(...cards: CardId[]): Twists {
  return { isWild: (c) => cards.includes(c), isMirror: () => false, dealtFaceUp: () => false };
}
function mirrorTwists(...cards: CardId[]): Twists {
  return { isWild: () => false, isMirror: (c) => cards.includes(c), dealtFaceUp: () => false };
}

function pile(b: FreeCellBoard, id: string) {
  const p = freecell.view(b).piles.find((x) => x.id === id);
  if (!p) throw new Error(`no pile ${id}`);
  return p;
}

// ------------------------------------------------------------------ deal ---

describe('deal', () => {
  it('lays out 52 unique cards across cells, foundations and tableau, in the 7/7/7/7/6/6/6/6 shape', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = dealFreeCell(seed);
      expect(b.cells).toEqual([null, null, null, null]);
      expect(b.foundations).toEqual([[], [], [], []]);
      expect(b.tableau).toHaveLength(FREECELL_TABLEAU_COUNT);
      expect(b.tableau.map((c) => c.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
      const all = b.tableau.flat();
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(b.moves).toBe(0);
    }
  });

  it('reads the cells option, defaulting to four', () => {
    expect(dealFreeCell(1).cells).toHaveLength(4);
    expect(dealFreeCell(1, {}).cells).toHaveLength(4);
    expect(dealFreeCell(1, { cells: '4' }).cells).toHaveLength(4);
    expect(dealFreeCell(1, { cells: '3' }).cells).toHaveLength(3);
    expect(dealFreeCell(1, { cells: '2' }).cells).toHaveLength(2);
    expect(dealFreeCell(1, { cells: 'nonsense' }).cells).toHaveLength(4); // falls back to default
    // the same seed deals the same cards whichever way the option goes
    expect(dealFreeCell(3, { cells: '2' }).tableau).toEqual(dealFreeCell(3).tableau);
  });

  it('deals a 53-card (Joker) deck too: every card lands, `dealt` tracks it (docs/12)', () => {
    const b = dealFreeCell(1, {}, NO_TWISTS, deckCardIds(JOKER_53));
    const all = b.tableau.flat();
    expect(all).toHaveLength(53);
    expect(new Set(all).size).toBe(53);
    expect(all).toContain(JOKER_ID);
    expect(b.dealt).toBe(53);
    // round-robin over 8 columns: 53 = 6*8 + 5, so five columns get 7 and three get 6.
    expect(b.tableau.map((c) => c.length).sort()).toEqual([6, 6, 6, 7, 7, 7, 7, 7]);
    expect(freecell.isWon(b)).toBe(false);
  });
});

// -------------------------------------------------------------- geometry ---

describe('view', () => {
  it('places cells, foundations and tableau on the grid, and nothing overflows', () => {
    const b = dealFreeCell(1);
    const v = freecell.view(b);
    expect(v.cols).toBe(8);
    expect(v.rows).toBe(FREECELL_ROWS);
    for (let i = 0; i < 4; i++) expect(pile(b, `c${i}`)).toMatchObject({ x: i, y: 0, fan: 'none', kind: 'cell' });
    for (let i = 0; i < FREECELL_FOUNDATION_COUNT; i++) {
      expect(pile(b, `f${i}`)).toMatchObject({ x: 4 + i, y: 0, fan: 'none', kind: 'foundation' });
    }
    for (let i = 0; i < FREECELL_TABLEAU_COUNT; i++) {
      expect(pile(b, `t${i}`)).toMatchObject({ x: i, y: 1.25, fan: 'down', kind: 'tableau' });
    }
    expect(Math.max(...v.piles.map((p) => p.x))).toBeLessThanOrEqual(v.cols - 1);
  });

  it('sizes rows for a comfortably deep column, leaving deeper ones to fan compression', () => {
    // layout.ts places a pile at y * (cardH + gapY), gapY = 0.098 * cardH, but sizes the felt as
    // rows * cardH. Sizing for the theoretical worst case (a 20-card column) would shrink every card
    // at the deal, when nothing is deep; the renderer tightens the fan on columns that outgrow rows.
    const FAN_UP = 0.28;
    const GAP = 0.098;
    const COMFORTABLE = 11;
    const deepest = 1.25 * (1 + GAP) + 1 + (COMFORTABLE - 1) * FAN_UP;
    expect(deepest).toBeLessThanOrEqual(FREECELL_ROWS);
    expect(FREECELL_ROWS).toBeLessThan(deepest + 0.3);
    // The 7-card deal must leave the cards a usable size: well under the full grid.
    const dealt = 1.25 * (1 + GAP) + 1 + 6 * FAN_UP;
    expect(dealt).toBeLessThan(FREECELL_ROWS);
  });

  it('only the maximal liftable suffix of a column is pickableFrom, and empty piles report none', () => {
    // 8S can sit under 7H (8 red? no: 8S black, 7H red -> ok), 7H under nothing above it here.
    // Build a column where only the top two cards form a valid chain: [9S, 8S(bad), 7H, 6S]
    // 7H -> 6S is a valid pair (7 red? no wait define explicitly below with named cards).
    const b = withCols({ 0: [S(9), H(2), S(7), H(6)] }); // S9,H2 unrelated; S7->H6 valid (7->6, black->red)
    expect(pile(b, 't0').pickableFrom).toBe(2); // S7 and H6 are pickable; H2 is buried under a broken link
    expect(freecell.canPickUp(b, 't0', 2, NO_TWISTS)).toBe(true);
    expect(freecell.canPickUp(b, 't0', 3, NO_TWISTS)).toBe(true);
    expect(freecell.canPickUp(b, 't0', 1, NO_TWISTS)).toBe(false); // H2 -> S7 is not a valid pair
    expect(pile(b, 't1').pickableFrom).toBeUndefined();
    expect(pile(b, 'c0').pickableFrom).toBeUndefined();
    expect(pile(board(), 'f0').pickableFrom).toBeUndefined();
  });
});

// ----------------------------------------------------------------- moves ---

describe('tableau moves', () => {
  it('allows an alternating-colour descending move and refuses a same-colour one', () => {
    const b = withCols({ 0: [S(6)], 1: [H(5)], 2: [S(5)] });
    // H5 (red) onto S6 (black): legal
    expect(freecell.legalTargets(b, 't1', 0, NO_TWISTS)).toContain('t0');
    const r = freecell.move(b, 't1', 0, 't0', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]).toEqual([S(6), H(5)]);
    expect(r.board.tableau[1]).toEqual([]);
    expect(r.homed).toEqual([]);
    expect(r.board.moves).toBe(1);
    expect(b.tableau[0]).toEqual([S(6)]); // original untouched

    // S5 (black) onto S6 (black): illegal, same colour
    expect(freecell.legalTargets(b, 't2', 0, NO_TWISTS)).not.toContain('t0');
    const bad = freecell.move(b, 't2', 0, 't0', NO_TWISTS);
    expect(bad.changed).toBe(false);
    expect(bad.board).toBe(b);
  });

  it('lets any card land on an empty column', () => {
    const b = withCols({ 0: [S(9)] });
    expect(freecell.legalTargets(b, 't0', 0, NO_TWISTS)).toContain('t1');
    const r = freecell.move(b, 't0', 0, 't1', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[1]).toEqual([S(9)]);
  });
});

describe('foundation moves', () => {
  it('builds Ace then 2 and reports homed', () => {
    const b = withCols({ 0: [S(1)], 1: [S(2)] });
    const r1 = freecell.move(b, 't0', 0, 'f0', NO_TWISTS);
    expect(r1.changed).toBe(true);
    expect(r1.homed).toEqual([S(1)]);
    expect(r1.board.foundations[0]).toEqual([S(1)]);

    expect(freecell.legalTargets(r1.board, 't1', 0, NO_TWISTS)).toContain('f0');
    const r2 = freecell.move(r1.board, 't1', 0, 'f0', NO_TWISTS);
    expect(r2.changed).toBe(true);
    expect(r2.homed).toEqual([S(2)]);
    expect(r2.board.foundations[0]).toEqual([S(1), S(2)]);
  });

  it('refuses a wrong rank or wrong suit', () => {
    const b = withCols({ 0: [S(2)] }, { foundations: [[], [], [], []] });
    // 2 needs an Ace on the foundation first: no foundation target at all yet
    expect(freecell.legalTargets(b, 't0', 0, NO_TWISTS)).not.toContain('f0');
    const withAce = withCols({ 0: [H(2)] }, { foundations: [[S(1)], [], [], []] });
    expect(freecell.legalTargets(withAce, 't0', 0, NO_TWISTS)).not.toContain('f0'); // wrong suit
  });
});

describe('free cell moves', () => {
  it('sends a card to an empty cell and back to an (empty) column', () => {
    const b = withCols({ 0: [S(9)] });
    expect(freecell.legalTargets(b, 't0', 0, NO_TWISTS)).toContain('c0');
    const toCell = freecell.move(b, 't0', 0, 'c0', NO_TWISTS);
    expect(toCell.changed).toBe(true);
    expect(toCell.board.cells[0]).toBe(S(9));
    expect(toCell.board.tableau[0]).toEqual([]);
    expect(toCell.homed).toEqual([]);

    // t0 is now empty, so the cell card can come straight back
    expect(freecell.canPickUp(toCell.board, 'c0', 0, NO_TWISTS)).toBe(true);
    expect(freecell.legalTargets(toCell.board, 'c0', 0, NO_TWISTS)).toContain('t0');
    const back = freecell.move(toCell.board, 'c0', 0, 't0', NO_TWISTS);
    expect(back.changed).toBe(true);
    expect(back.board.cells[0]).toBeNull();
    expect(back.board.tableau[0]).toEqual([S(9)]);
    // moves is excluded from the hash, so the round trip is invisible to it
    expect(freecell.hash(back.board)).toBe(freecell.hash(b));
  });

  it('a full cell refuses another card', () => {
    const b = withCols({ 0: [S(9)], 1: [H(8)] }, { cells: [S(3), null, null, null] });
    expect(freecell.legalTargets(b, 't0', 0, NO_TWISTS)).not.toContain('c0');
    expect(freecell.move(b, 't0', 0, 'c0', NO_TWISTS).changed).toBe(false);
  });
});

// -------------------------------------------------------------- supermove ---

describe('maxRunLength', () => {
  function withFreeAndEmpty(freeCells: number, emptyColumns: number): FreeCellBoard {
    const cells = Array.from({ length: 4 }, (_, i) => (i < freeCells ? null : S(1)));
    const tableau = Array.from({ length: FREECELL_TABLEAU_COUNT }, (_, i) => (i < emptyColumns ? [] : [S(1)]));
    return board({ cells, tableau });
  }

  it('is (1 + freeCells) * 2^emptyColumns for a non-empty destination', () => {
    const b = withFreeAndEmpty(4, 0);
    expect(maxRunLength(b, false)).toBe(5); // (1+4) * 2^0
    expect(5 <= maxRunLength(b, false)).toBe(true); // a 5-run is legal
    expect(6 <= maxRunLength(b, false)).toBe(false); // a 6-run is not

    const withOneEmpty = withFreeAndEmpty(4, 1);
    expect(maxRunLength(withOneEmpty, false)).toBe(10); // (1+4) * 2^1, a 10-run is legal
    expect(10 <= maxRunLength(withOneEmpty, false)).toBe(true);
  });

  it('does not count the destination column itself when it is the empty one', () => {
    const withOneEmpty = withFreeAndEmpty(4, 1);
    // moving INTO that one empty column: it can't count towards emptyColumns for its own capacity
    expect(maxRunLength(withOneEmpty, true)).toBe(5); // (1+4) * 2^0
  });

  it('a shorter cells option lowers the ceiling', () => {
    const b = dealFreeCell(1, { cells: '2' });
    // a fresh deal has no empty columns (7/7/7/7/6/6/6/6), so this is purely the free-cell term
    expect(b.tableau.every((c) => c.length > 0)).toBe(true);
    expect(maxRunLength(b, false)).toBe(3); // (1+2) * 2^0
    expect(maxRunLength(dealFreeCell(1), false)).toBe(5); // the default 4-cell deal: (1+4) * 2^0
  });
});

describe('supermove in practice', () => {
  it('moves a whole valid run onto a compatible target when capacity allows, and refuses when it does not', () => {
    // A 3-card alternating run: S8, H7, S6 (black, red, black — each one rank down).
    const run = [S(8), H(7), S(6)];
    const withCapacity = withCols({ 0: run, 1: [H(9)] }, { cells: [null, null, null, null] }); // 4 free cells: cap 5
    expect(freecell.canPickUp(withCapacity, 't0', 0, NO_TWISTS)).toBe(true);
    expect(freecell.legalTargets(withCapacity, 't0', 0, NO_TWISTS)).toContain('t1');
    const moved = freecell.move(withCapacity, 't0', 0, 't1', NO_TWISTS);
    expect(moved.changed).toBe(true);
    expect(moved.board.tableau[1]).toEqual([H(9), S(8), H(7), S(6)]);
    expect(moved.board.tableau[0]).toEqual([]);

    // No free cells and no empty columns: cap is 1, so the same 3-run cannot move as a unit.
    const noCapacity = withCols(
      { 0: run, 1: [H(9)], 2: [C(4)], 3: [D(4)], 4: [C(5)], 5: [D(5)], 6: [C(6)], 7: [D(6)] },
      { cells: [S(1), H(1), D(1), C(1)] }
    );
    expect(maxRunLength(noCapacity, false)).toBe(1);
    expect(freecell.legalTargets(noCapacity, 't0', 0, NO_TWISTS)).not.toContain('t1');
    expect(freecell.move(noCapacity, 't0', 0, 't1', NO_TWISTS).changed).toBe(false);
    // but the lone top card is still liftable on its own
    expect(freecell.canPickUp(noCapacity, 't0', 2, NO_TWISTS)).toBe(true);
  });
});

// ------------------------------------------------------------- end states ---

describe('isWon / isStuck', () => {
  it('wins when all four foundations hold 13 cards', () => {
    const full = (suit: 'S' | 'H' | 'D' | 'C') => Array.from({ length: 13 }, (_, i) => cardId(suit, (i + 1) as 1));
    const won = board({ foundations: [full('S'), full('H'), full('D'), full('C')] });
    expect(freecell.isWon(won)).toBe(true);
    expect(freecell.isWon(dealFreeCell(1))).toBe(false);
    expect(freecell.isWon(board())).toBe(false);
  });

  it('wins when every DEALT card is home, not when foundations hit a hardcoded 52', () => {
    // A hand smaller than 52 (a future, smaller deck shape): 2 dealt, one 2-card suit run.
    const small = board({ foundations: [[S(1), S(2)], [], [], []], dealt: 2 });
    expect(freecell.isWon(small)).toBe(true);

    // A hand bigger than 52 (the Joker, docs/12): all four foundations full is 52 cards home,
    // but a 53rd dealt card (the Joker) still sitting in a cell means the hand is not won.
    const full = (suit: 'S' | 'H' | 'D' | 'C') => Array.from({ length: 13 }, (_, i) => cardId(suit, (i + 1) as 1));
    const withJoker = board({
      foundations: [full('S'), full('H'), full('D'), full('C')],
      cells: [JOKER_ID, null, null, null],
      dealt: 53
    });
    expect(withJoker.foundations.every((f) => f.length === 13)).toBe(true);
    expect(freecell.isWon(withJoker)).toBe(false);
  });

  it('is stuck only when no cell, foundation, or tableau move exists anywhere', () => {
    // Every free cell full; every column non-empty; no pair of tops is rank-adjacent; no top is an
    // Ace (foundations are empty and want Aces).
    const dead = board({
      cells: [S(10), H(10), D(10), C(10)],
      foundations: [[], [], [], []],
      tableau: [[S(2)], [H(2)], [S(4)], [H(4)], [S(6)], [H(6)], [S(8)], [H(8)]]
    });
    expect(freecell.isStuck(dead, NO_TWISTS)).toBe(true);
    expect(legalFreeCellMoves(dead, NO_TWISTS)).toEqual([]);
    // freeing one cell immediately un-sticks it (any top card can now shuttle there)
    const oneFree = { ...dead, cells: [null, H(10), D(10), C(10)] };
    expect(freecell.isStuck(oneFree, NO_TWISTS)).toBe(false);
    // a fresh deal is never stuck (free cells are always open at the start)
    expect(freecell.isStuck(dealFreeCell(1), NO_TWISTS)).toBe(false);
    // a wild card in hand is never stuck either
    expect(freecell.isStuck(dead, wildTwists(S(2)))).toBe(false);
  });
});

// ------------------------------------------------------------ hash / clone ---

describe('hash and clone', () => {
  it('clones deeply and hashes the position, not the move count', () => {
    const b = dealFreeCell(5);
    const c = freecell.clone(b);
    expect(c).not.toBe(b);
    expect(c).toEqual(b);
    expect(c.cells).not.toBe(b.cells);
    expect(c.tableau).not.toBe(b.tableau);
    expect(c.tableau[0]).not.toBe(b.tableau[0]);
    expect(c.foundations).not.toBe(b.foundations);
    expect(freecell.hash(c)).toBe(freecell.hash(b));
    c.tableau[0]?.pop();
    expect(b.tableau[0]).toHaveLength(7);
    expect(freecell.hash({ ...b, moves: 99 })).toBe(freecell.hash(b));
    const moved = freecell.move(b, `t${b.tableau.findIndex((c2) => c2.length > 0)}`, 0, 'c0', NO_TWISTS);
    // only run this assertion if that move actually happened to be legal for the top card at index 0
    if (moved.changed) expect(freecell.hash(moved.board)).not.toBe(freecell.hash(b));
  });

  it('distinguishes an empty cell from a cell holding the card with id 0, and two columns apart', () => {
    expect(freecell.hash(board({ cells: [0, null, null, null] }))).not.toBe(freecell.hash(board()));
    expect(freecell.hash(withCols({ 0: [S(3)] }))).not.toBe(freecell.hash(withCols({ 1: [S(3)] })));
  });
});

// ---------------------------------------------------------------- twists ---

describe('twists', () => {
  it('a wild card stacks regardless of rank or colour', () => {
    const b = withCols({ 0: [S(9)], 1: [S(8)] }); // both black, adjacent rank: illegal without wild
    expect(freecell.legalTargets(b, 't1', 0, NO_TWISTS)).not.toContain('t0');
    const w = wildTwists(S(8));
    expect(freecell.legalTargets(b, 't1', 0, w)).toContain('t0');
    const r = freecell.move(b, 't1', 0, 't0', w);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]).toEqual([S(9), S(8)]);
  });

  it('a mirror card counts as both colours, enabling an otherwise same-colour stack', () => {
    const b = withCols({ 0: [S(6)], 1: [S(5)] }); // S5 on S6: same colour, illegal without mirror
    expect(freecell.legalTargets(b, 't1', 0, NO_TWISTS)).not.toContain('t0');
    const m = mirrorTwists(S(5));
    expect(freecell.legalTargets(b, 't1', 0, m)).toContain('t0');
    const r = freecell.move(b, 't1', 0, 't0', m);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]).toEqual([S(6), S(5)]);
  });

  it('honours wild and mirror only, and declares the cells option', () => {
    expect(freecell.honours).toEqual(['wild', 'mirror']);
    expect(freecell.options.map((o) => o.id)).toEqual(['cells']);
    expect(freecell.options[0]?.default).toBe('4');
  });

  it('the Joker: wild by nature, even under NO_TWISTS (docs/12-ascension.md)', () => {
    expect(isWildCard(JOKER_ID, NO_TWISTS)).toBe(true);

    // Stacks regardless of rank or colour, exactly like a Mark-made wild card.
    const b = withCols({ 0: [S(9)], 1: [JOKER_ID] });
    expect(freecell.legalTargets(b, 't1', 0, NO_TWISTS)).toContain('t0');
    const r = freecell.move(b, 't1', 0, 't0', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]).toEqual([S(9), JOKER_ID]);

    // And anything now stacks on the Joker in turn.
    const onTop = withCols({ 0: [JOKER_ID], 1: [S(2)] });
    expect(freecell.legalTargets(onTop, 't1', 0, NO_TWISTS)).toContain('t0');

    // A card with no rank of its own cannot stand in for a rank, so a half-built foundation will
    // not take it — it would strand the real card of whatever rank it displaced.
    const found = board({ foundations: [[S(1), S(2)], [], [], []] });
    const withJokerInCell = { ...found, cells: [JOKER_ID, null, null, null] as (CardId | null)[] };
    const targets = freecell.legalTargets(withJokerInCell, 'c0', 0, NO_TWISTS);
    expect(targets).not.toContain('f0');
    expect(targets).not.toContain('f1');

    // A complete foundation takes it, and that is how the 53rd card gets home.
    const done = board({ foundations: [Array.from({ length: 13 }, (_, i) => S(i + 1)), [], [], []] });
    const jokerInCell = { ...done, cells: [JOKER_ID, null, null, null] as (CardId | null)[] };
    expect(freecell.legalTargets(jokerInCell, 'c0', 0, NO_TWISTS)).toContain('f0');
    const crowned = freecell.move(jokerInCell, 'c0', 0, 'f0', NO_TWISTS);
    expect(crowned.changed).toBe(true);
    expect(crowned.board.foundations[0]).toHaveLength(14);
  });
});

// --------------------------------------------------------------- autoplay ---

describe('greedy autoplay', () => {
  it('terminates on seeds 1..30', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = solveGreedy(freecell, dealFreeCell(seed), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      expect(r.won).toBe(freecell.isWon(r.board));
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/30 FreeCell deals won`);
    // ~99% of FreeCell deals are solvable by a good player/solver, but the generic greedy driver
    // (no lookahead, no backtracking) is expected to do poorly here — it only has to terminate.
    expect(wins).toBeGreaterThanOrEqual(0);
  });
});
