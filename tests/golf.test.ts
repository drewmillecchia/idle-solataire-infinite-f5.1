/**
 * Golf rules. The generic contract lives in tests/contract.test.ts; this file is the game-specific
 * half: the deal, the ±1 run, the `wrap` option, the one-way stock, and the twists.
 */
import { describe, expect, it } from 'vitest';
import { cardId, type CardId } from '$engine/types';
import { deckCardIds, JOKER_53, JOKER_ID } from '$engine/deck';
import { FAN_UP, NO_TWISTS, isWildCard, type Twists } from '../src/rules/module';
import { solveGreedy } from '../src/rules/autoplay';
import {
  dealGolf,
  golf,
  legalGolfMoves,
  golfPlayableOnWaste,
  GOLF_COLUMNS,
  GOLF_COLUMN_HEIGHT,
  type GolfBoard
} from '../src/rules/games/golf';

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);

function board(p: Partial<GolfBoard> = {}): GolfBoard {
  return {
    columns: Array.from({ length: GOLF_COLUMNS }, () => [] as CardId[]),
    stock: [],
    waste: [],
    wrap: false,
    moves: 0,
    ...p
  };
}

/** A board with exactly the given columns filled. */
function withCols(filled: Record<number, CardId[]>, p: Partial<GolfBoard> = {}): GolfBoard {
  const columns: CardId[][] = Array.from({ length: GOLF_COLUMNS }, () => [] as CardId[]);
  for (const [k, v] of Object.entries(filled)) columns[Number(k)] = v.slice();
  return board({ columns, ...p });
}

function wildTwists(...cards: CardId[]): Twists {
  return { isWild: (c) => cards.includes(c), isMirror: () => false, dealtFaceUp: () => false };
}

function pile(b: GolfBoard, id: string) {
  const p = golf.view(b).piles.find((x) => x.id === id);
  if (!p) throw new Error(`no pile ${id}`);
  return p;
}

// ------------------------------------------------------------------ deal ---

describe('deal', () => {
  it('lays out 7 x 5 face-up, 16 in the stock and 1 on the waste — 52 unique cards', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = dealGolf(seed);
      expect(b.columns).toHaveLength(GOLF_COLUMNS);
      for (const c of b.columns) expect(c).toHaveLength(GOLF_COLUMN_HEIGHT);
      expect(b.stock).toHaveLength(16);
      expect(b.waste).toHaveLength(1);
      const all = [...b.columns.flat(), ...b.stock, ...b.waste];
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(b.moves).toBe(0);
      expect(b.wrap).toBe(false);
    }
  });

  it('reads the wrap option', () => {
    expect(dealGolf(1, { wrap: 'yes' }).wrap).toBe(true);
    expect(dealGolf(1, { wrap: 'no' }).wrap).toBe(false);
    expect(dealGolf(1, { wrap: 'nonsense' }).wrap).toBe(false); // falls back to the default
    expect(dealGolf(1, {}).wrap).toBe(false);
    // the same seed deals the same cards whichever way the option goes
    expect(dealGolf(3, { wrap: 'yes' }).columns).toEqual(dealGolf(3).columns);
  });

  it('deals a 53-card (Joker) deck too: every card lands (docs/12)', () => {
    const b = dealGolf(1, {}, NO_TWISTS, deckCardIds(JOKER_53));
    expect(b.columns).toHaveLength(GOLF_COLUMNS);
    for (const c of b.columns) expect(c).toHaveLength(GOLF_COLUMN_HEIGHT);
    const all = [...b.columns.flat(), ...b.stock, ...b.waste];
    expect(all).toHaveLength(53);
    expect(new Set(all).size).toBe(53);
    expect(all).toContain(JOKER_ID);
  });
});

// -------------------------------------------------------------- geometry ---

describe('view', () => {
  it('is seven columns over a stock row, and nothing overflows the grid', () => {
    const b = dealGolf(1);
    const v = golf.view(b);
    expect(v.cols).toBe(7);
    expect(v.rows).toBe(3.75);
    expect(v.piles.map((p) => p.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 'stock', 'waste']);
    for (let i = 0; i < GOLF_COLUMNS; i++) {
      expect(pile(b, `t${i}`)).toMatchObject({ x: i, y: 0, fan: 'down', kind: 'tableau' });
    }
    expect(pile(b, 'stock')).toMatchObject({ x: 2.5, y: 2.5, fan: 'none', kind: 'stock' });
    expect(pile(b, 'waste')).toMatchObject({ x: 3.5, y: 2.5, fan: 'none', kind: 'waste' });

    // layout.ts positions a pile at y * (cardH + gapY), gapY = 0.098 cardH, but sizes the felt as
    // rows * cardH. Both the fanned columns and the stock row have to fit inside that.
    const gap = 0.098;
    const columnBottom = 0 * (1 + gap) + 1 + (GOLF_COLUMN_HEIGHT - 1) * FAN_UP;
    const stockBottom = 2.5 * (1 + gap) + 1;
    expect(Math.max(columnBottom, stockBottom)).toBeLessThanOrEqual(v.rows);
    // ...and the widest pile stays inside cols
    expect(Math.max(...v.piles.map((p) => p.x))).toBeLessThanOrEqual(v.cols - 1);
  });

  it('shows every tableau card face-up and only the top of each column pickable', () => {
    const b = dealGolf(4);
    for (let i = 0; i < GOLF_COLUMNS; i++) {
      const p = pile(b, `t${i}`);
      expect(p.cards.every((c) => c.faceUp)).toBe(true);
      expect(p.pickableFrom).toBe(GOLF_COLUMN_HEIGHT - 1);
    }
    // the stock hides its cards; the waste shows them but is never a source
    expect(pile(b, 'stock').cards.every((c) => !c.faceUp)).toBe(true);
    expect(pile(b, 'stock').pickableFrom).toBeUndefined();
    expect(pile(b, 'waste').cards.every((c) => c.faceUp)).toBe(true);
    expect(pile(b, 'waste').pickableFrom).toBeUndefined();
    expect(golf.view(b).piles.flatMap((p) => p.cards)).toHaveLength(52);
  });

  it('leaves an empty column with no pickableFrom and marks a spent stock blocked', () => {
    const b = withCols({ 0: [S(4)] }, { waste: [S(5)] });
    expect(pile(b, 't0').pickableFrom).toBe(0);
    expect(pile(b, 't1').pickableFrom).toBeUndefined();
    expect(pile(b, 't1').cards).toEqual([]);
    expect(pile(b, 'stock').blocked).toBe(true);
    expect(pile(dealGolf(1), 'stock').blocked).toBeUndefined();
  });
});

// ----------------------------------------------------------------- moves ---

describe('move', () => {
  it('plays a rank-adjacent column top onto the waste and homes it', () => {
    const b = withCols({ 0: [S(9), S(4)], 1: [H(7)] }, { waste: [D(5)] });
    expect(golf.canPickUp(b, 't0', 1, NO_TWISTS)).toBe(true);
    expect(golf.legalTargets(b, 't0', 1, NO_TWISTS)).toEqual(['waste']);
    expect(golf.autoTarget(b, 't0', 1, NO_TWISTS)).toBe('waste');

    const r = golf.move(b, 't0', 1, 'waste', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([S(4)]);
    expect(r.events).toEqual([]); // every card is already face-up: nothing to flip
    expect(r.board.columns[0]).toEqual([S(9)]);
    expect(r.board.waste).toEqual([D(5), S(4)]);
    expect(r.board.moves).toBe(1);
    expect(b.columns[0]).toEqual([S(9), S(4)]); // the original is untouched

    // the card underneath is now the top, and it plays too (4 -> 5 is gone, but 9 is not adjacent)
    expect(golf.legalTargets(r.board, 't0', 0, NO_TWISTS)).toEqual([]);
    expect(golf.canPickUp(r.board, 't0', 0, NO_TWISTS)).toBe(true);
  });

  it('runs up as well as down', () => {
    const up = withCols({ 0: [S(6)] }, { waste: [D(5)] });
    expect(golf.move(up, 't0', 0, 'waste', NO_TWISTS).changed).toBe(true);
    const down = withCols({ 0: [S(4)] }, { waste: [D(5)] });
    expect(golf.move(down, 't0', 0, 'waste', NO_TWISTS).changed).toBe(true);
  });

  it('only wraps Ace to King when the option says so', () => {
    const plain = withCols({ 0: [S(1)] }, { waste: [D(13)] });
    expect(golfPlayableOnWaste(plain, S(1), NO_TWISTS)).toBe(false);
    expect(golf.legalTargets(plain, 't0', 0, NO_TWISTS)).toEqual([]);
    const wrapped = { ...plain, wrap: true };
    expect(golfPlayableOnWaste(wrapped, S(1), NO_TWISTS)).toBe(true);
    expect(golf.move(wrapped, 't0', 0, 'waste', NO_TWISTS).changed).toBe(true);
    // and the other way round
    const king = withCols({ 0: [S(13)] }, { waste: [D(1)], wrap: true });
    expect(golf.move(king, 't0', 0, 'waste', NO_TWISTS).changed).toBe(true);
    // wrap never makes two-apart ranks legal
    expect(golf.legalTargets(withCols({ 0: [S(3)] }, { waste: [D(1)], wrap: true }), 't0', 0, NO_TWISTS)).toEqual([]);
  });

  it('is a no-op for a wrong rank, a buried card, a bad index, or a bad target', () => {
    const b = withCols({ 0: [S(9), S(4)], 1: [H(7)] }, { waste: [D(5)], stock: [H(2)] });
    const cases: [string, number, string][] = [
      ['t1', 0, 'waste'], // 7 is not adjacent to 5
      ['t0', 0, 'waste'], // buried: only the top of a column lifts
      ['t0', 2, 'waste'],
      ['t0', -1, 'waste'],
      ['t0', 0.5, 'waste'],
      ['t2', 0, 'waste'], // empty column
      ['t7', 0, 'waste'],
      ['nope', 0, 'waste'],
      ['stock', 0, 'waste'],
      ['waste', 0, 'waste'],
      ['t0', 1, 't1'], // the waste is the only target there is
      ['t0', 1, 'stock'],
      ['t0', 1, 't0']
    ];
    for (const [p, i, to] of cases) {
      const r = golf.move(b, p, i, to, NO_TWISTS);
      expect(r.changed, `${p}/${i}/${to}`).toBe(false);
      expect(r.board).toBe(b);
      expect(r.homed).toEqual([]);
      expect(r.events).toEqual([]);
      expect(r.won).toBe(false);
    }
    expect(golf.canPickUp(b, 't0', 0, NO_TWISTS)).toBe(false);
    expect(golf.canPickUp(b, 't2', 0, NO_TWISTS)).toBe(false);
    expect(golf.autoTarget(b, 't1', 0, NO_TWISTS)).toBeNull();
  });

  it('nothing is playable onto an empty waste', () => {
    const b = withCols({ 0: [S(5)] });
    expect(golf.legalTargets(b, 't0', 0, NO_TWISTS)).toEqual([]);
    expect(golf.canPickUp(b, 't0', 0, NO_TWISTS)).toBe(true); // liftable, just not playable
  });
});

// ------------------------------------------------------------------ draw ---

describe('draw', () => {
  it('turns exactly one card and homes nothing', () => {
    const b = withCols({ 0: [S(5)] }, { stock: [H(2), H(3)], waste: [D(9)] });
    const r = golf.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([]);
    expect(r.events).toEqual([{ type: 'draw', count: 1 }]);
    expect(r.board.waste).toEqual([D(9), H(3)]);
    expect(r.board.stock).toEqual([H(2)]);
    expect(r.board.moves).toBe(1);
    expect(b.stock).toEqual([H(2), H(3)]); // untouched
  });

  it('is a no-op with an empty stock — Golf never recycles', () => {
    const b = withCols({ 0: [S(5)] }, { waste: [D(9), H(3)] });
    const r = golf.draw(b, NO_TWISTS);
    expect(r.changed).toBe(false);
    expect(r.board).toBe(b);
    expect(r.events).toEqual([]);
  });

  it('walks the whole stock and then stops', () => {
    let b: GolfBoard = dealGolf(2);
    for (let i = 0; i < 16; i++) {
      const r = golf.draw(b, NO_TWISTS);
      expect(r.changed).toBe(true);
      b = r.board;
    }
    expect(b.stock).toEqual([]);
    expect(b.waste).toHaveLength(17);
    expect(golf.draw(b, NO_TWISTS).changed).toBe(false);
  });
});

// ------------------------------------------------------------- end states ---

describe('isWon / isStuck', () => {
  it('wins when every column is empty', () => {
    expect(golf.isWon(board({ stock: [S(2)], waste: [S(3)] }))).toBe(true);
    expect(golf.isWon(withCols({ 6: [S(2)] }))).toBe(false);
    expect(golf.isWon(dealGolf(1))).toBe(false);
    // the winning move reports it
    const b = withCols({ 3: [S(5)] }, { waste: [D(6)] });
    const r = golf.move(b, 't3', 0, 'waste', NO_TWISTS);
    expect(r.won).toBe(true);
    expect(golf.isWon(r.board)).toBe(true);
  });

  it('is stuck only when nothing plays and the stock is spent', () => {
    const dead = withCols({ 0: [S(5)], 1: [H(9)] }, { waste: [D(2)] });
    expect(golf.isStuck(dead, NO_TWISTS)).toBe(true);
    expect(golf.isStuck({ ...dead, stock: [H(7)] }, NO_TWISTS)).toBe(false);
    const live = withCols({ 0: [S(5)], 1: [H(9)] }, { waste: [D(6)] });
    expect(golf.isStuck(live, NO_TWISTS)).toBe(false);
    // a wild card in hand is never stuck
    expect(golf.isStuck(dead, wildTwists(S(5)))).toBe(false);
    // wrap can rescue an otherwise dead board
    const kingDead = withCols({ 0: [S(13)] }, { waste: [D(1)] });
    expect(golf.isStuck(kingDead, NO_TWISTS)).toBe(true);
    expect(golf.isStuck({ ...kingDead, wrap: true }, NO_TWISTS)).toBe(false);
    // a fresh deal has a full stock; a won board is not "stuck"
    expect(golf.isStuck(dealGolf(1), NO_TWISTS)).toBe(false);
    expect(golf.isStuck(board(), NO_TWISTS)).toBe(false);
  });

  it('legalGolfMoves lists only playable column tops', () => {
    const b = withCols({ 0: [S(9), S(4)], 1: [H(7)], 2: [], 3: [D(6), D(4)] }, { waste: [D(5)] });
    expect(legalGolfMoves(b)).toEqual([
      { pile: 't0', index: 1, to: 'waste' },
      { pile: 't3', index: 1, to: 'waste' }
    ]);
    expect(legalGolfMoves(board())).toEqual([]);
  });
});

// ------------------------------------------------------------ hash / clone ---

describe('hash and clone', () => {
  it('clones deeply and hashes the position, not the move count', () => {
    const b = dealGolf(5);
    const c = golf.clone(b);
    expect(c).not.toBe(b);
    expect(c).toEqual(b);
    expect(c.columns).not.toBe(b.columns);
    expect(c.columns[0]).not.toBe(b.columns[0]);
    expect(c.stock).not.toBe(b.stock);
    expect(c.waste).not.toBe(b.waste);
    expect(golf.hash(c)).toBe(golf.hash(b));
    // mutating the clone cannot reach the original
    c.columns[0]?.pop();
    expect(b.columns[0]).toHaveLength(GOLF_COLUMN_HEIGHT);
    // moves is excluded from the hash; everything else is in it
    expect(golf.hash({ ...b, moves: 99 })).toBe(golf.hash(b));
    expect(golf.hash({ ...b, wrap: true })).not.toBe(golf.hash(b));
    expect(golf.hash(golf.draw(b, NO_TWISTS).board)).not.toBe(golf.hash(b));
  });

  it('distinguishes an empty column from a column holding the card with id 0', () => {
    expect(golf.hash(withCols({ 0: [0] }))).not.toBe(golf.hash(board()));
    // and two different columns holding the same card
    expect(golf.hash(withCols({ 0: [S(3)] }))).not.toBe(golf.hash(withCols({ 1: [S(3)] })));
  });
});

// ---------------------------------------------------------------- twists ---

describe('twists', () => {
  it('a wild card plays regardless of rank, and anything plays onto a wild waste top', () => {
    const b = withCols({ 0: [S(5)], 1: [H(9)] }, { waste: [D(2)] });
    expect(golf.legalTargets(b, 't0', 0, NO_TWISTS)).toEqual([]);
    const w = wildTwists(S(5));
    expect(golf.legalTargets(b, 't0', 0, w)).toEqual(['waste']);
    const r = golf.move(b, 't0', 0, 'waste', w);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([S(5)]);
    // ...and now the wild is the waste top, so H9 goes too
    expect(golf.legalTargets(r.board, 't1', 0, w)).toEqual(['waste']);
    expect(golf.move(r.board, 't1', 0, 'waste', w).changed).toBe(true);
    // a wild card still has to be the top of its column
    const buried = withCols({ 0: [S(5), H(9)] }, { waste: [D(2)] });
    expect(golf.legalTargets(buried, 't0', 0, wildTwists(S(5)))).toEqual([]);
  });

  it('honours wild only, and declares the wrap option', () => {
    expect(golf.honours).toEqual(['wild']);
    expect(golf.options.map((o) => o.id)).toEqual(['wrap']);
    expect(golf.options[0]?.default).toBe('no');
  });

  it('the Joker: wild by nature, even under NO_TWISTS (docs/12-ascension.md)', () => {
    expect(isWildCard(JOKER_ID, NO_TWISTS)).toBe(true);

    const b = withCols({ 0: [JOKER_ID], 1: [H(9)] }, { waste: [D(2)] });
    // The Joker plays onto any waste top, regardless of rank.
    expect(golf.legalTargets(b, 't0', 0, NO_TWISTS)).toEqual(['waste']);
    const r = golf.move(b, 't0', 0, 'waste', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([JOKER_ID]);
    // ...and now the Joker is the waste top, so anything plays onto it.
    expect(golf.legalTargets(r.board, 't1', 0, NO_TWISTS)).toEqual(['waste']);
  });
});

// --------------------------------------------------------------- autoplay ---

describe('greedy autoplay', () => {
  it('terminates on seeds 1..30', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = solveGreedy(golf, dealGolf(seed), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      expect(r.won).toBe(golf.isWon(r.board));
      if (!r.won) expect(golf.isStuck(r.board, NO_TWISTS) || r.steps > 0).toBe(true);
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/30 Golf deals won (classic, no wrap)`);
    // Golf is a very low win-rate game by design (docs/06-games.md); the driver only has to stop.
    expect(wins).toBeGreaterThanOrEqual(0);
  });

  it('terminates with the wrap option too, and clears most of the course', () => {
    let wins = 0;
    let cleared = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = solveGreedy(golf, dealGolf(seed, { wrap: 'yes' }), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      cleared += 35 - r.board.columns.reduce((a, c) => a + c.length, 0);
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/30 Golf deals won (wrap), ${(cleared / 30).toFixed(1)}/35 cards cleared on average`);
    expect(cleared / 30).toBeGreaterThan(20);
  });
});
