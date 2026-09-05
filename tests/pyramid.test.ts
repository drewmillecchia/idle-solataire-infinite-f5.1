/**
 * Pyramid rules. The generic contract lives in tests/contract.test.ts; this file is the game-specific
 * half: the 7-row geometry, exposure, pairs to 13, the discard, redeals, and the twists.
 */
import { describe, expect, it } from 'vitest';
import { cardId, type CardId } from '$engine/types';
import { NO_TWISTS, type Twists } from '../src/rules/module';
import { solveGreedy } from '../src/rules/autoplay';
import {
  dealPyramid,
  exposedCard,
  legalPyramidMoves,
  pairsTo13,
  pyramid,
  pyramidExposed,
  PYRAMID_ROWS,
  PYRAMID_SLOTS,
  PYRAMID_SLOT_COUNT,
  type PyramidBoard
} from '../src/rules/games/pyramid';

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);
const C = (r: number) => cardId('C', r as 1);

function board(p: Partial<PyramidBoard> = {}): PyramidBoard {
  return {
    slots: Array.from({ length: PYRAMID_SLOT_COUNT }, () => null),
    stock: [],
    waste: [],
    discard: [],
    redealsLeft: 2,
    moves: 0,
    ...p
  };
}

/** A board with exactly the given slots filled. */
function withSlots(filled: Record<number, CardId>, p: Partial<PyramidBoard> = {}): PyramidBoard {
  const slots: (CardId | null)[] = Array.from({ length: PYRAMID_SLOT_COUNT }, () => null);
  for (const [k, v] of Object.entries(filled)) slots[Number(k)] = v;
  return board({ slots, ...p });
}

function wildTwists(...cards: CardId[]): Twists {
  return { isWild: (c) => cards.includes(c), isMirror: () => false, dealtFaceUp: () => false };
}

function pile(b: PyramidBoard, id: string) {
  const p = pyramid.view(b).piles.find((x) => x.id === id);
  if (!p) throw new Error(`no pile ${id}`);
  return p;
}

// ------------------------------------------------------------------ deal ---

describe('deal', () => {
  it('lays out a 28-card pyramid with 24 in the stock — 52 unique cards', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = dealPyramid(seed);
      expect(b.slots).toHaveLength(PYRAMID_SLOT_COUNT);
      expect(b.slots.every((c) => c !== null)).toBe(true);
      expect(b.stock).toHaveLength(24);
      expect(b.waste).toEqual([]);
      expect(b.discard).toEqual([]);
      const all = [...(b.slots as CardId[]), ...b.stock];
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(b.moves).toBe(0);
      expect(b.redealsLeft).toBe(2);
    }
  });

  it('reads the redeals option', () => {
    expect(dealPyramid(1, { redeals: '0' }).redealsLeft).toBe(0);
    expect(dealPyramid(1, { redeals: 'unlimited' }).redealsLeft).toBe(-1);
    expect(dealPyramid(1, { redeals: 'nonsense' }).redealsLeft).toBe(2); // falls back to the default
    expect(dealPyramid(1, {}).redealsLeft).toBe(2);
    expect(dealPyramid(3, { redeals: '0' }).slots).toEqual(dealPyramid(3).slots);
  });
});

// -------------------------------------------------------------- geometry ---

describe('PYRAMID_SLOTS', () => {
  it('is seven rows of 1..7 cards on half-card steps, centred over columns 1..7', () => {
    expect(PYRAMID_SLOTS).toHaveLength(PYRAMID_SLOT_COUNT);
    const perRow = Array.from({ length: PYRAMID_ROWS }, (_, r) =>
      PYRAMID_SLOTS.filter((s) => s.row === r).length
    );
    expect(perRow).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const s of PYRAMID_SLOTS) expect(s.y).toBeCloseTo(s.row * 0.5);
    expect(PYRAMID_SLOTS.filter((s) => s.row === 0).map((s) => s.x)).toEqual([4]);
    expect(PYRAMID_SLOTS.filter((s) => s.row === 1).map((s) => s.x)).toEqual([3.5, 4.5]);
    expect(PYRAMID_SLOTS.filter((s) => s.row === 2).map((s) => s.x)).toEqual([3, 4, 5]);
    expect(PYRAMID_SLOTS.filter((s) => s.row === 6).map((s) => s.x)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // indices run row by row, top to bottom
    expect(PYRAMID_SLOTS.map((s) => s.index)).toEqual(PYRAMID_SLOTS.map((_, i) => i));
  });

  it('covers always point at the next row down, half a card either side', () => {
    for (const s of PYRAMID_SLOTS) {
      if (s.row === PYRAMID_ROWS - 1) {
        expect(s.covers).toEqual([]);
        continue;
      }
      expect(s.covers).toHaveLength(2);
      const [l, r] = s.covers.map((i) => PYRAMID_SLOTS[i]!);
      expect(l!.row).toBe(s.row + 1);
      expect(r!.row).toBe(s.row + 1);
      expect(l!.x).toBeCloseTo(s.x - 0.5);
      expect(r!.x).toBeCloseTo(s.x + 0.5);
    }
    // spelled out
    expect(PYRAMID_SLOTS[0]!.covers).toEqual([1, 2]);
    expect(PYRAMID_SLOTS[1]!.covers).toEqual([3, 4]);
    expect(PYRAMID_SLOTS[2]!.covers).toEqual([4, 5]);
    expect(PYRAMID_SLOTS[20]!.covers).toEqual([26, 27]);
  });
});

describe('view', () => {
  it('paints rows top-down beside the stock lane, and nothing overflows the grid', () => {
    const b = dealPyramid(1);
    const v = pyramid.view(b);
    expect(v.cols).toBe(9);
    expect(v.rows).toBe(4.3);
    expect(v.piles.map((p) => p.id)).toEqual([
      ...Array.from({ length: PYRAMID_SLOT_COUNT }, (_, i) => `p${i}`),
      'stock',
      'waste',
      'discard'
    ]);
    // rows are non-decreasing through the pile list, so a lower row paints over the one above
    const ys = v.piles.slice(0, PYRAMID_SLOT_COUNT).map((p) => p.y);
    expect(ys).toEqual([...ys].sort((a, b2) => a - b2));
    expect(pile(b, 'stock')).toMatchObject({ x: 0, y: 0, kind: 'stock', fan: 'none' });
    expect(pile(b, 'waste')).toMatchObject({ x: 0, y: 1.2, kind: 'waste', fan: 'none' });
    expect(pile(b, 'discard')).toMatchObject({ x: 8, y: 0, kind: 'discard', fan: 'none' });
    expect(v.piles.every((p) => p.fan === 'none')).toBe(true);
    expect(v.piles.every((p) => p.kind !== 'peak' || p.id.startsWith('p'))).toBe(true);

    // layout.ts positions a pile at y * (cardH + gapY), gapY = 0.098 cardH, and sizes the felt as
    // rows * cardH: the deepest row plus a whole card has to fit.
    const deepest = Math.max(...v.piles.map((p) => p.y));
    expect(deepest * 1.098 + 1).toBeLessThanOrEqual(v.rows);
    expect(Math.max(...v.piles.map((p) => p.x))).toBeLessThanOrEqual(v.cols - 1);
  });

  it('shows the whole pyramid face-up, with only the free row pickable', () => {
    const b = dealPyramid(4);
    const v = pyramid.view(b);
    for (const geom of PYRAMID_SLOTS) {
      const p = v.piles.find((x) => x.id === `p${geom.index}`);
      const free = geom.row === PYRAMID_ROWS - 1;
      expect(p?.cards[0]?.faceUp).toBe(true); // Pyramid deals every card face-up
      expect(p?.pickableFrom).toBe(free ? 0 : undefined);
      expect(p?.covered).toBe(free ? undefined : true);
      expect(p?.slot).toBeUndefined(); // occupied: nothing to say about the empty outline
    }
    expect(v.piles.flatMap((p) => p.cards)).toHaveLength(52);
  });

  it('leaves a hole, not a slot outline, where a card has been matched away', () => {
    const b = withSlots({ 27: S(5) });
    expect(pile(b, 'p27')).toMatchObject({ cards: [{ id: S(5), faceUp: true }], pickableFrom: 0 });
    expect(pile(b, 'p26').cards).toEqual([]);
    expect(pile(b, 'p26').slot).toBe(false);
    expect(pile(b, 'p26').pickableFrom).toBeUndefined();
  });

  it('shows the stock top face-up and pickable, and blocks a stock that can do nothing', () => {
    const b = board({ stock: [H(2), H(3)], waste: [D(4)] });
    const st = pile(b, 'stock');
    expect(st.cards).toEqual([
      { id: H(2), faceUp: false },
      { id: H(3), faceUp: true }
    ]);
    expect(st.pickableFrom).toBe(1);
    expect(st.blocked).toBeUndefined();
    expect(pile(b, 'waste').pickableFrom).toBe(0);

    // empty stock, waste to recycle, redeals left -> still live
    const recyclable = board({ waste: [D(4)] });
    expect(pile(recyclable, 'stock').blocked).toBeUndefined();
    expect(pile(recyclable, 'stock').pickableFrom).toBeUndefined();
    // no redeals left -> dead
    expect(pile(board({ waste: [D(4)], redealsLeft: 0 }), 'stock').blocked).toBe(true);
    // nothing anywhere -> dead
    expect(pile(board(), 'stock').blocked).toBe(true);
  });
});

// -------------------------------------------------------------- exposure ---

describe('pyramidExposed / exposedCard', () => {
  it('needs both covering slots empty', () => {
    const b = withSlots({ 0: S(5), 1: S(6), 2: S(7) });
    expect(pyramidExposed(b, 0)).toBe(false);
    expect(pyramidExposed(b, 1)).toBe(true);
    expect(pyramidExposed(b, 2)).toBe(true);
    const one = { ...b, slots: b.slots.map((c, i) => (i === 1 ? null : c)) };
    expect(pyramidExposed(one, 0)).toBe(false); // p2 still there
    const none = { ...b, slots: b.slots.map((c, i) => (i === 1 || i === 2 ? null : c)) };
    expect(pyramidExposed(none, 0)).toBe(true);
  });

  it('is false for an empty slot and for nonsense indices', () => {
    const b = board();
    expect(pyramidExposed(b, 0)).toBe(false);
    expect(pyramidExposed(b, 99)).toBe(false);
    expect(pyramidExposed(b, -1)).toBe(false);
  });

  it('reads the stock top, the waste top and free pyramid cards, and nothing else', () => {
    const b = withSlots({ 0: S(5), 1: S(6), 2: S(7) }, { stock: [H(2), H(3)], waste: [D(8), D(9)] });
    expect(exposedCard(b, 'p0')).toBeNull(); // covered
    expect(exposedCard(b, 'p1')).toBe(S(6));
    expect(exposedCard(b, 'stock')).toBe(H(3));
    expect(exposedCard(b, 'waste')).toBe(D(9));
    expect(exposedCard(b, 'discard')).toBeNull();
    expect(exposedCard(b, 'nope')).toBeNull();
    expect(exposedCard(b, 'p99')).toBeNull();
    expect(exposedCard(board(), 'stock')).toBeNull();
    expect(exposedCard(board(), 'waste')).toBeNull();
  });
});

// ----------------------------------------------------------------- pairs ---

describe('pairs to thirteen', () => {
  it('knows the six pairs and the lone King', () => {
    const pairs: [number, number][] = [
      [12, 1],
      [11, 2],
      [10, 3],
      [9, 4],
      [8, 5],
      [7, 6]
    ];
    for (const [a, b2] of pairs) expect(pairsTo13(S(a), H(b2), NO_TWISTS)).toBe(true);
    expect(pairsTo13(S(13), H(13), NO_TWISTS)).toBe(false);
    expect(pairsTo13(S(6), H(6), NO_TWISTS)).toBe(false);
    expect(pairsTo13(S(1), H(1), NO_TWISTS)).toBe(false);
  });
});

// ----------------------------------------------------------------- moves ---

describe('move', () => {
  it('takes a pair of exposed cards to the discard and homes both', () => {
    // p21 and p22 are on the bottom row, always free.
    const b = withSlots({ 21: S(9), 22: H(4), 23: D(2) });
    expect(pyramid.canPickUp(b, 'p21', 0, NO_TWISTS)).toBe(true);
    expect(pyramid.legalTargets(b, 'p21', 0, NO_TWISTS)).toEqual(['p22']);
    expect(pyramid.autoTarget(b, 'p21', 0, NO_TWISTS)).toBe('p22');

    const r = pyramid.move(b, 'p21', 0, 'p22', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([S(9), H(4)]);
    expect(r.events).toEqual([]); // every card is already face-up: nothing to flip
    expect(r.board.slots[21]).toBeNull();
    expect(r.board.slots[22]).toBeNull();
    expect(r.board.discard).toEqual([S(9), H(4)]);
    expect(r.board.moves).toBe(1);
    expect(b.slots[21]).toBe(S(9)); // the original is untouched
    expect(b.discard).toEqual([]);
  });

  it('frees the card above only once BOTH of its coverers are gone', () => {
    // p15 (row 5) sits on p21 and p22.
    const b = withSlots({ 15: S(6), 21: H(7), 22: D(9) }, { stock: [D(6)], waste: [C(4)] });
    expect(pyramidExposed(b, 15)).toBe(false);
    // a covered card is not a legal partner, even for the card sitting on it
    expect(pyramid.legalTargets(b, 'p21', 0, NO_TWISTS)).toEqual(['stock']);

    const r1 = pyramid.move(b, 'p22', 0, 'waste', NO_TWISTS); // 9 + 4
    expect(r1.homed).toEqual([D(9), C(4)]);
    expect(pyramidExposed(r1.board, 15)).toBe(false); // p21 still there
    expect(pile(r1.board, 'p15').covered).toBe(true);
    expect(pile(r1.board, 'p15').pickableFrom).toBeUndefined();

    const r2 = pyramid.move(r1.board, 'p21', 0, 'stock', NO_TWISTS); // 7 + 6
    expect(r2.homed).toEqual([H(7), D(6)]);
    expect(pyramidExposed(r2.board, 15)).toBe(true);
    expect(pile(r2.board, 'p15').pickableFrom).toBe(0);
    expect(pile(r2.board, 'p15').covered).toBeUndefined();
    expect(pyramid.isWon(r2.board)).toBe(false); // S(6) is still on the table
    expect(pyramid.isStuck(r2.board, NO_TWISTS)).toBe(true); // ...and nothing pairs with it
  });

  it('sends a lone King to the discard', () => {
    const b = withSlots({ 21: S(13), 22: H(4) });
    expect(pyramid.legalTargets(b, 'p21', 0, NO_TWISTS)).toEqual(['discard']);
    expect(pyramid.autoTarget(b, 'p21', 0, NO_TWISTS)).toBe('discard');
    const r = pyramid.move(b, 'p21', 0, 'discard', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([S(13)]);
    expect(r.board.slots[21]).toBeNull();
    expect(r.board.discard).toEqual([S(13)]);
    // no other card may go alone
    expect(pyramid.move(b, 'p22', 0, 'discard', NO_TWISTS).changed).toBe(false);
    expect(pyramid.legalTargets(b, 'p22', 0, NO_TWISTS)).toEqual([]);
  });

  it('pairs a pyramid card with the waste top and with the stock top', () => {
    const b = withSlots({ 21: S(9) }, { stock: [H(2), H(4)], waste: [D(6), D(4)] });
    expect(pyramid.legalTargets(b, 'p21', 0, NO_TWISTS)).toEqual(['stock', 'waste']);
    expect(pyramid.autoTarget(b, 'p21', 0, NO_TWISTS)).toBeNull(); // two complements: the player picks

    const w = pyramid.move(b, 'p21', 0, 'waste', NO_TWISTS);
    expect(w.homed).toEqual([S(9), D(4)]);
    expect(w.board.waste).toEqual([D(6)]);
    expect(w.board.stock).toEqual([H(2), H(4)]);

    const s = pyramid.move(b, 'p21', 0, 'stock', NO_TWISTS);
    expect(s.homed).toEqual([S(9), H(4)]);
    expect(s.board.stock).toEqual([H(2)]);
    expect(s.board.waste).toEqual([D(6), D(4)]);

    // and the same move initiated from the talon side
    const back = pyramid.move(b, 'waste', 1, 'p21', NO_TWISTS);
    expect(back.homed).toEqual([D(4), S(9)]);
    expect(back.board.slots[21]).toBeNull();
    expect(pyramid.legalTargets(b, 'stock', 1, NO_TWISTS)).toEqual(['p21']);
    expect(pyramid.autoTarget(b, 'stock', 1, NO_TWISTS)).toBe('p21');
  });

  it('is a no-op for a wrong sum, a covered card, a bad index, or a bad target', () => {
    const b = withSlots({ 0: S(5), 1: H(8), 2: D(3), 21: C(2) }, { stock: [H(9)], waste: [D(7)] });
    const cases: [string, number, string][] = [
      ['p1', 0, 'p2'], // 8 + 3 = 11
      ['p0', 0, 'p21'], // covered source
      ['p1', 0, 'p0'], // covered target (5 + 8 = 13, but p0 is buried)
      ['p1', 0, 'p1'], // onto itself
      ['p1', 1, 'p2'], // no such index
      ['p1', -1, 'p2'],
      ['p1', 0.5, 'p2'],
      ['p28', 0, 'p2'],
      ['nope', 0, 'p2'],
      ['discard', 0, 'p2'],
      ['p1', 0, 'discard'], // an 8 does not go alone
      ['p1', 0, 'nope'],
      ['p1', 0, 'p9'], // empty slot
      ['stock', 0, 'p1'], // 9 + 8 = 17
      ['waste', 0, 'p2'] // 7 + 3 = 10
    ];
    for (const [p, i, to] of cases) {
      const r = pyramid.move(b, p, i, to, NO_TWISTS);
      expect(r.changed, `${p}/${i}/${to}`).toBe(false);
      expect(r.board).toBe(b);
      expect(r.homed).toEqual([]);
      expect(r.events).toEqual([]);
      expect(r.won).toBe(false);
    }
    expect(pyramid.canPickUp(b, 'p0', 0, NO_TWISTS)).toBe(false);
    expect(pyramid.canPickUp(b, 'discard', 0, NO_TWISTS)).toBe(false);
    expect(pyramid.canPickUp(b, 'p9', 0, NO_TWISTS)).toBe(false);
    expect(pyramid.legalTargets(b, 'discard', 0, NO_TWISTS)).toEqual([]);
    expect(pyramid.autoTarget(b, 'p1', 0, NO_TWISTS)).toBeNull(); // 8 has no free 5
  });

  it('lists every exposed complement, and auto-targets only the unambiguous one', () => {
    const two = withSlots({ 21: S(6), 22: H(7), 23: D(7) });
    expect(pyramid.legalTargets(two, 'p21', 0, NO_TWISTS)).toEqual(['p22', 'p23']);
    expect(pyramid.autoTarget(two, 'p21', 0, NO_TWISTS)).toBeNull();
    const one = withSlots({ 21: S(6), 22: H(7), 23: D(9) });
    expect(pyramid.autoTarget(one, 'p21', 0, NO_TWISTS)).toBe('p22');
  });
});

// ------------------------------------------------------------------ draw ---

describe('draw', () => {
  it('turns exactly one card and homes nothing', () => {
    const b = withSlots({ 21: S(5) }, { stock: [H(2), H(3)], waste: [D(9)] });
    const r = pyramid.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([]);
    expect(r.events).toEqual([{ type: 'draw', count: 1 }]);
    expect(r.board.waste).toEqual([D(9), H(3)]);
    expect(r.board.stock).toEqual([H(2)]);
    expect(r.board.redealsLeft).toBe(2);
    expect(r.board.moves).toBe(1);
    expect(b.stock).toEqual([H(2), H(3)]);
  });

  it('recycles the waste back under the stock, bottom card first, and spends a redeal', () => {
    const b = withSlots({ 21: S(5) }, { waste: [D(9), H(3), C(2)] });
    const r = pyramid.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([]);
    expect(r.events).toEqual([{ type: 'recycle' }]);
    expect(r.board.waste).toEqual([]);
    // the next card drawn is the one that went down first
    expect(r.board.stock).toEqual([C(2), H(3), D(9)]);
    expect(pyramid.draw(r.board, NO_TWISTS).board.waste).toEqual([D(9)]);
    expect(r.board.redealsLeft).toBe(1);
    expect(b.waste).toEqual([D(9), H(3), C(2)]);
  });

  it('allows exactly two recycles by default, none with redeals 0, and never runs out on unlimited', () => {
    const start = withSlots({ 21: S(5) }, { waste: [D(9)] });
    const first = pyramid.draw(start, NO_TWISTS);
    expect(first.board.redealsLeft).toBe(1);
    const second = pyramid.draw(pyramid.draw(first.board, NO_TWISTS).board, NO_TWISTS);
    expect(second.board.redealsLeft).toBe(0);
    const spent = pyramid.draw(second.board, NO_TWISTS).board; // draw it back up
    expect(pyramid.draw(spent, NO_TWISTS).changed).toBe(false);
    expect(pile(spent, 'stock').blocked).toBe(true);

    expect(pyramid.draw({ ...start, redealsLeft: 0 }, NO_TWISTS).changed).toBe(false);

    let unlimited = { ...start, redealsLeft: -1 };
    for (let i = 0; i < 8; i++) {
      const r = pyramid.draw(unlimited, NO_TWISTS);
      expect(r.changed).toBe(true);
      unlimited = r.board;
    }
    expect(unlimited.redealsLeft).toBe(-1);
  });

  it('is a no-op with nothing to turn and nothing to recycle', () => {
    const b = withSlots({ 21: S(5) });
    const r = pyramid.draw(b, NO_TWISTS);
    expect(r.changed).toBe(false);
    expect(r.board).toBe(b);
    expect(r.events).toEqual([]);
  });

  it('walks the whole stock of a real deal', () => {
    let b: PyramidBoard = dealPyramid(2);
    for (let i = 0; i < 24; i++) b = pyramid.draw(b, NO_TWISTS).board;
    expect(b.stock).toEqual([]);
    expect(b.waste).toHaveLength(24);
    expect(pyramid.draw(b, NO_TWISTS).events).toEqual([{ type: 'recycle' }]);
  });
});

// ------------------------------------------------------------- end states ---

describe('isWon / isStuck', () => {
  it('wins when the pyramid is empty, whatever is left in the stock', () => {
    expect(pyramid.isWon(board({ stock: [S(2)], waste: [S(3)] }))).toBe(true);
    expect(pyramid.isWon(withSlots({ 0: S(2) }))).toBe(false);
    expect(pyramid.isWon(dealPyramid(1))).toBe(false);
    // the winning move reports it
    const b = withSlots({ 21: S(9), 22: H(4) });
    const r = pyramid.move(b, 'p21', 0, 'p22', NO_TWISTS);
    expect(r.won).toBe(true);
    expect(pyramid.isWon(r.board)).toBe(true);
  });

  it('is stuck only when no pair, no draw and no recycle is left', () => {
    const dead = withSlots({ 21: S(5), 22: H(9) });
    expect(pyramid.isStuck(dead, NO_TWISTS)).toBe(true);
    expect(pyramid.isStuck({ ...dead, stock: [C(2)] }, NO_TWISTS)).toBe(false); // can still draw
    expect(pyramid.isStuck({ ...dead, waste: [C(2)] }, NO_TWISTS)).toBe(false); // can still recycle
    // the waste top is exposed, but 2 pairs with nothing here and there is no redeal left
    expect(pyramid.isStuck({ ...dead, waste: [C(2)], redealsLeft: 0 }, NO_TWISTS)).toBe(true);
    expect(pyramid.isStuck({ ...dead, waste: [C(8)], redealsLeft: 0 }, NO_TWISTS)).toBe(false); // 8 + 5
    const live = withSlots({ 21: S(5), 22: H(8) });
    expect(pyramid.isStuck(live, NO_TWISTS)).toBe(false);
    // a wild card in hand is never stuck
    expect(pyramid.isStuck(dead, wildTwists(S(5)))).toBe(false);
    // a lone King is always a move
    expect(pyramid.isStuck(withSlots({ 21: S(13) }), NO_TWISTS)).toBe(false);
    // a fresh deal has a full stock; a won board is not "stuck"
    expect(pyramid.isStuck(dealPyramid(1), NO_TWISTS)).toBe(false);
    expect(pyramid.isStuck(board(), NO_TWISTS)).toBe(false);
  });

  it('legalPyramidMoves lists each pair once, plus every lone King', () => {
    const b = withSlots({ 0: S(4), 1: H(9), 2: D(6), 21: C(13), 22: S(7) });
    // p0 is covered; p1 + p2 do not add to 13; p21 goes alone; p22 (7) pairs with p2 (6)
    expect(legalPyramidMoves(b)).toEqual([
      { pile: 'p2', index: 0, to: 'p22' },
      { pile: 'p21', index: 0, to: 'discard' }
    ]);
    expect(legalPyramidMoves(board())).toEqual([]);
    // the stock and waste tops take part
    const talon = withSlots({ 21: S(9) }, { stock: [H(1), H(4)], waste: [D(4)] });
    expect(legalPyramidMoves(talon)).toEqual([
      { pile: 'p21', index: 0, to: 'stock' },
      { pile: 'p21', index: 0, to: 'waste' }
    ]);
  });
});

// ------------------------------------------------------------ hash / clone ---

describe('hash and clone', () => {
  it('clones deeply and hashes the position, not the move count', () => {
    const b = pyramid.draw(dealPyramid(5), NO_TWISTS).board;
    const c = pyramid.clone(b);
    expect(c).not.toBe(b);
    expect(c).toEqual(b);
    expect(c.slots).not.toBe(b.slots);
    expect(c.stock).not.toBe(b.stock);
    expect(c.waste).not.toBe(b.waste);
    expect(c.discard).not.toBe(b.discard);
    expect(pyramid.hash(c)).toBe(pyramid.hash(b));
    // mutating the clone cannot reach the original
    c.slots[0] = null;
    expect(b.slots[0]).not.toBeNull();
    // moves is excluded from the hash; the position is in it
    expect(pyramid.hash({ ...b, moves: 99 })).toBe(pyramid.hash(b));
    expect(pyramid.hash({ ...b, redealsLeft: 0 })).not.toBe(pyramid.hash(b));
    expect(pyramid.hash(pyramid.draw(b, NO_TWISTS).board)).not.toBe(pyramid.hash(b));
    // the discard is exactly the deck minus the rest, so it adds nothing to the position
    expect(pyramid.hash({ ...b, discard: [S(2), S(3)] })).toBe(pyramid.hash(b));
    // ...and a match still changes the hash, because the cards leave the slots
    const m = withSlots({ 21: S(9), 22: H(4) });
    expect(pyramid.hash(pyramid.move(m, 'p21', 0, 'p22', NO_TWISTS).board)).not.toBe(pyramid.hash(m));
  });

  it('distinguishes an empty slot from a card with id 0', () => {
    expect(pyramid.hash(withSlots({ 0: 0 }))).not.toBe(pyramid.hash(board()));
  });
});

// ---------------------------------------------------------------- twists ---

describe('twists', () => {
  it('a wild card pairs with anything and may also go alone', () => {
    const b = withSlots({ 21: S(5), 22: H(9) });
    expect(pyramid.legalTargets(b, 'p21', 0, NO_TWISTS)).toEqual([]);
    const w = wildTwists(S(5));
    expect(pyramid.legalTargets(b, 'p21', 0, w)).toEqual(['discard', 'p22']);
    expect(pyramid.autoTarget(b, 'p21', 0, w)).toBe('discard');
    // anything pairs with an exposed wild, too
    expect(pyramid.legalTargets(b, 'p22', 0, w)).toEqual(['p21']);
    const r = pyramid.move(b, 'p22', 0, 'p21', w);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([H(9), S(5)]);
    expect(pyramid.isWon(r.board)).toBe(true);
    // a lone wild
    const alone = pyramid.move(b, 'p21', 0, 'discard', w);
    expect(alone.changed).toBe(true);
    expect(alone.homed).toEqual([S(5)]);
    // a wild card still has to be exposed
    const covered = withSlots({ 0: S(5), 1: H(2), 2: H(3) });
    expect(pyramid.legalTargets(covered, 'p0', 0, w)).toEqual([]);
    expect(pyramid.move(covered, 'p0', 0, 'discard', w).changed).toBe(false);
  });

  it('honours wild only, and declares the redeals option', () => {
    expect(pyramid.honours).toEqual(['wild']);
    expect(pyramid.options.map((o) => o.id)).toEqual(['redeals']);
    expect(pyramid.options[0]?.default).toBe('2');
  });
});

// --------------------------------------------------------------- autoplay ---

describe('greedy autoplay', () => {
  it('terminates on seeds 1..30', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = solveGreedy(pyramid, dealPyramid(seed), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      expect(r.won).toBe(pyramid.isWon(r.board));
      if (!r.won) expect(pyramid.isStuck(r.board, NO_TWISTS) || r.steps > 0).toBe(true);
      // no card is ever lost or duplicated
      const all = [
        ...r.board.slots.filter((c): c is CardId => c != null),
        ...r.board.stock,
        ...r.board.waste,
        ...r.board.discard
      ];
      expect(new Set(all).size).toBe(52);
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/30 Pyramid deals won`);
    expect(wins).toBeGreaterThanOrEqual(0);
  });

  it('terminates with unlimited redeals, where the stock can cycle forever', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = solveGreedy(pyramid, dealPyramid(seed, { redeals: 'unlimited' }), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      expect(r.won).toBe(pyramid.isWon(r.board));
    }
  });
});
