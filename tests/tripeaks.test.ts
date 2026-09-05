/**
 * TriPeaks rules. The generic contract lives in tests/contract.test.ts; this file is the
 * game-specific half: geometry, exposure, matching, the stock, and the twists.
 */
import { describe, expect, it } from 'vitest';
import { cardId, type CardId } from '$engine/types';
import { NO_TWISTS, type Twists } from '../src/rules/module';
import { solveGreedy } from '../src/rules/autoplay';
import {
  dealTriPeaks,
  exposed,
  legalTriPeaksMoves,
  playableOnWaste,
  SLOT_COUNT,
  TRIPEAKS_SLOTS,
  tripeaks,
  type TriPeaksBoard
} from '../src/rules/games/tripeaks';

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);

function board(p: Partial<TriPeaksBoard> = {}): TriPeaksBoard {
  return {
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    stock: [],
    waste: [],
    moves: 0,
    glass: [],
    ...p
  };
}

/** A board with exactly the given slots filled. */
function withSlots(filled: Record<number, CardId>, p: Partial<TriPeaksBoard> = {}): TriPeaksBoard {
  const slots: (CardId | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  for (const [k, v] of Object.entries(filled)) slots[Number(k)] = v;
  return board({ slots, ...p });
}

function wildTwists(...cards: CardId[]): Twists {
  return { isWild: (c) => cards.includes(c), isMirror: () => false, dealtFaceUp: () => false };
}

function glassTwists(...cards: CardId[]): Twists {
  return { isWild: () => false, isMirror: () => false, dealtFaceUp: (c) => cards.includes(c) };
}

function view(b: TriPeaksBoard) {
  return tripeaks.view(b);
}

function pile(b: TriPeaksBoard, id: string) {
  const p = view(b).piles.find((x) => x.id === id);
  if (!p) throw new Error(`no pile ${id}`);
  return p;
}

// ------------------------------------------------------------------ deal ---

describe('deal', () => {
  it('lays out 28 tableau cards, 23 in stock and 1 on the waste — 52 unique cards', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = dealTriPeaks(seed);
      expect(b.slots).toHaveLength(28);
      expect(b.slots.every((c) => c !== null)).toBe(true);
      expect(b.stock).toHaveLength(23);
      expect(b.waste).toHaveLength(1);
      const all = [...(b.slots as CardId[]), ...b.stock, ...b.waste];
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(b.moves).toBe(0);
      expect(b.glass).toEqual([]);
    }
  });

  it('shows only the bottom row face-up', () => {
    const b = dealTriPeaks(4);
    const v = view(b);
    for (const geom of TRIPEAKS_SLOTS) {
      const p = v.piles.find((x) => x.id === `p${geom.index}`);
      expect(p?.cards[0]?.faceUp).toBe(geom.row === 3);
      expect(p?.pickableFrom).toBe(geom.row === 3 ? 0 : undefined);
      expect(p?.covered).toBe(geom.row === 3 ? undefined : true);
    }
    // stock face-down, waste face-up, and 52 cards are on the table
    expect(pile(b, 'stock').cards.every((c) => !c.faceUp)).toBe(true);
    expect(pile(b, 'waste').cards.every((c) => c.faceUp)).toBe(true);
    expect(v.piles.flatMap((p) => p.cards)).toHaveLength(52);
  });

  it('glass shows a covered card without making it pickable', () => {
    const plain = dealTriPeaks(4);
    const hidden = plain.slots[0] as CardId; // apex of the first peak, definitely covered
    const b = dealTriPeaks(4, {}, glassTwists(hidden));
    expect(b.glass).toEqual([hidden]);
    const p = pile(b, 'p0');
    expect(p.cards[0]).toEqual({ id: hidden, faceUp: true });
    expect(p.pickableFrom).toBeUndefined();
    expect(p.covered).toBe(true);
    // a face-up bottom-row card needs no glass entry
    const exposedCard = plain.slots[18] as CardId;
    expect(dealTriPeaks(4, {}, glassTwists(exposedCard)).glass).toEqual([]);
  });
});

// -------------------------------------------------------------- geometry ---

describe('TRIPEAKS_SLOTS', () => {
  it('is three peaks: 3 / 6 / 9 / 10 cards on four half-card rows', () => {
    expect(TRIPEAKS_SLOTS).toHaveLength(28);
    const perRow = [0, 1, 2, 3].map((r) => TRIPEAKS_SLOTS.filter((s) => s.row === r).length);
    expect(perRow).toEqual([3, 6, 9, 10]);
    for (const s of TRIPEAKS_SLOTS) expect(s.y).toBeCloseTo(s.row * 0.5);
    expect(TRIPEAKS_SLOTS.filter((s) => s.row === 0).map((s) => s.x)).toEqual([1.5, 4.5, 7.5]);
    expect(TRIPEAKS_SLOTS.filter((s) => s.row === 1).map((s) => s.x)).toEqual([1, 2, 4, 5, 7, 8]);
    expect(TRIPEAKS_SLOTS.filter((s) => s.row === 3).map((s) => s.x)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9
    ]);
    // indices run row by row, top to bottom
    expect(TRIPEAKS_SLOTS.map((s) => s.index)).toEqual(TRIPEAKS_SLOTS.map((_, i) => i));
  });

  it('covers always point at the next row down, half a card either side', () => {
    for (const s of TRIPEAKS_SLOTS) {
      if (s.row === 3) {
        expect(s.covers).toEqual([]);
        continue;
      }
      expect(s.covers).toHaveLength(2);
      const [l, r] = s.covers.map((i) => TRIPEAKS_SLOTS[i]!);
      expect(l!.row).toBe(s.row + 1);
      expect(r!.row).toBe(s.row + 1);
      expect(l!.x).toBeCloseTo(s.x - 0.5);
      expect(r!.x).toBeCloseTo(s.x + 0.5);
    }
    // the three apexes, spelled out
    expect(TRIPEAKS_SLOTS[0]!.covers).toEqual([3, 4]);
    expect(TRIPEAKS_SLOTS[1]!.covers).toEqual([5, 6]);
    expect(TRIPEAKS_SLOTS[2]!.covers).toEqual([7, 8]);
    expect(TRIPEAKS_SLOTS[9]!.covers).toEqual([18, 19]);
    expect(TRIPEAKS_SLOTS[17]!.covers).toEqual([26, 27]);
  });

  it('view puts the peaks above the stock row and orders rows top-down for z-order', () => {
    const v = view(dealTriPeaks(1));
    expect(v.cols).toBe(10);
    expect(v.rows).toBeGreaterThanOrEqual(4);
    const ids = v.piles.map((p) => p.id);
    expect(ids).toEqual([
      ...Array.from({ length: 28 }, (_, i) => `p${i}`),
      'stock',
      'waste'
    ]);
    // rows are non-decreasing through the pile list, so a lower row paints over the one above
    const ys = v.piles.slice(0, 28).map((p) => p.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(pile(dealTriPeaks(1), 'stock')).toMatchObject({ x: 3.5, y: 2.7, fan: 'none' });
    expect(pile(dealTriPeaks(1), 'waste')).toMatchObject({ x: 5.5, y: 2.7, fan: 'none' });
    expect(v.piles.every((p) => p.fan === 'none')).toBe(true);
  });
});

// -------------------------------------------------------------- exposure ---

describe('exposed', () => {
  it('needs both covering slots empty', () => {
    const b = withSlots({ 0: S(5), 3: S(6), 4: S(7) });
    expect(exposed(b, 0)).toBe(false);
    expect(exposed(b, 3)).toBe(true);
    const one = { ...b, slots: b.slots.map((c, i) => (i === 3 ? null : c)) };
    expect(exposed(one, 0)).toBe(false); // p4 still there
    const none = { ...b, slots: b.slots.map((c, i) => (i === 3 || i === 4 ? null : c)) };
    expect(exposed(none, 0)).toBe(true);
  });

  it('is false for an empty slot and for nonsense indices', () => {
    const b = board();
    expect(exposed(b, 0)).toBe(false);
    expect(exposed(b, 99)).toBe(false);
    expect(exposed(b, -1)).toBe(false);
  });
});

// ----------------------------------------------------------------- moves ---

describe('move', () => {
  it('plays a rank-adjacent exposed card, homes it, and flips what it uncovered', () => {
    // p0 sits on p3 and p4; emptying both exposes p0.
    const b = withSlots({ 0: S(9), 3: S(5), 4: H(6) }, { waste: [D(6)] });
    expect(tripeaks.canPickUp(b, 'p3', 0, NO_TWISTS)).toBe(true);
    expect(tripeaks.legalTargets(b, 'p3', 0, NO_TWISTS)).toEqual(['waste']);
    expect(tripeaks.autoTarget(b, 'p3', 0, NO_TWISTS)).toBe('waste');

    const r1 = tripeaks.move(b, 'p3', 0, 'waste', NO_TWISTS);
    expect(r1.changed).toBe(true);
    expect(r1.homed).toEqual([S(5)]);
    expect(r1.board.slots[3]).toBeNull();
    expect(r1.board.waste).toEqual([D(6), S(5)]);
    expect(r1.board.moves).toBe(1);
    expect(r1.events).toEqual([]); // p0 is still covered by p4
    expect(b.slots[3]).toBe(S(5)); // the original is untouched

    // H6 was dead against the D6 that started on the waste; against the new top S5 it plays,
    // and lifting it exposes p0.
    expect(tripeaks.legalTargets(b, 'p4', 0, NO_TWISTS)).toEqual([]);
    const r2 = tripeaks.move(r1.board, 'p4', 0, 'waste', NO_TWISTS);
    expect(r2.changed).toBe(true);
    expect(r2.homed).toEqual([H(6)]);
    expect(r2.events).toEqual([{ type: 'flip', pile: 'p0', index: 0 }]);
    expect(exposed(r2.board, 0)).toBe(true);
    expect(pile(r2.board, 'p0').pickableFrom).toBe(0);
    expect(pile(r2.board, 'p0').covered).toBeUndefined();
    expect(pile(r2.board, 'p0').cards[0]?.faceUp).toBe(true);
  });

  it('emits one flip per newly exposed slot', () => {
    // p19 (row 3) is under both p9 and p10; clearing p18 and p19 exposes p9 only,
    // but clearing p19 when p18 and p20 are already gone exposes both p9 and p10.
    const b = withSlots({ 9: S(2), 10: S(3), 19: H(4) }, { waste: [H(5)] });
    const r = tripeaks.move(b, 'p19', 0, 'waste', NO_TWISTS);
    expect(r.events).toEqual([
      { type: 'flip', pile: 'p9', index: 0 },
      { type: 'flip', pile: 'p10', index: 0 }
    ]);
  });

  it('wraps King to Ace and back', () => {
    const k = withSlots({ 18: S(13) }, { waste: [H(1)] });
    expect(playableOnWaste(k, S(13), NO_TWISTS)).toBe(true);
    expect(tripeaks.move(k, 'p18', 0, 'waste', NO_TWISTS).changed).toBe(true);
    const a = withSlots({ 18: S(1) }, { waste: [H(13)] });
    expect(tripeaks.move(a, 'p18', 0, 'waste', NO_TWISTS).changed).toBe(true);
    // 2 and King are not adjacent
    const no = withSlots({ 18: S(2) }, { waste: [H(13)] });
    expect(tripeaks.legalTargets(no, 'p18', 0, NO_TWISTS)).toEqual([]);
  });

  it('is a no-op for a wrong rank, a covered card, a bad index, or a bad target', () => {
    const b = withSlots({ 0: S(9), 3: S(5), 4: H(6) }, { waste: [D(6)] });
    const cases: [string, number, string][] = [
      ['p4', 0, 'waste'], // H6 is not adjacent to D6 — same rank
      ['p0', 0, 'waste'], // covered
      ['p3', 1, 'waste'], // no such index
      ['p3', -1, 'waste'],
      ['p3', 0.5, 'waste'],
      ['p28', 0, 'waste'],
      ['nope', 0, 'waste'],
      ['stock', 0, 'waste'],
      ['waste', 0, 'waste'],
      ['p3', 0, 'p4'], // the waste is the only target there is
      ['p3', 0, 'stock']
    ];
    for (const [p, i, to] of cases) {
      const r = tripeaks.move(b, p, i, to, NO_TWISTS);
      expect(r.changed).toBe(false);
      expect(r.board).toBe(b);
      expect(r.homed).toEqual([]);
      expect(r.events).toEqual([]);
    }
    expect(tripeaks.canPickUp(b, 'p0', 0, NO_TWISTS)).toBe(false);
    expect(tripeaks.autoTarget(b, 'p4', 0, NO_TWISTS)).toBeNull();
  });

  it('nothing is playable onto an empty waste', () => {
    const b = withSlots({ 18: S(5) });
    expect(tripeaks.legalTargets(b, 'p18', 0, NO_TWISTS)).toEqual([]);
    expect(tripeaks.canPickUp(b, 'p18', 0, NO_TWISTS)).toBe(true); // exposed, just not playable
  });
});

// ------------------------------------------------------------------ draw ---

describe('draw', () => {
  it('turns exactly one card and homes nothing', () => {
    const b = withSlots({ 18: S(5) }, { stock: [H(2), H(3)], waste: [D(9)] });
    const r = tripeaks.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([]);
    expect(r.events).toEqual([{ type: 'draw', count: 1 }]);
    expect(r.board.waste).toEqual([D(9), H(3)]);
    expect(r.board.stock).toEqual([H(2)]);
    expect(r.board.moves).toBe(1);
    expect(b.stock).toEqual([H(2), H(3)]);
  });

  it('is a no-op with an empty stock — TriPeaks never recycles', () => {
    const b = withSlots({ 18: S(5) }, { waste: [D(9), H(3)] });
    const r = tripeaks.draw(b, NO_TWISTS);
    expect(r.changed).toBe(false);
    expect(r.board).toBe(b);
    expect(pile(b, 'stock').blocked).toBe(true);
    expect(pile(dealTriPeaks(1), 'stock').blocked).toBeUndefined();
  });
});

// ------------------------------------------------------------- end states ---

describe('isWon / isStuck', () => {
  it('wins when every slot is empty', () => {
    expect(tripeaks.isWon(board({ stock: [S(2)], waste: [S(3)] }))).toBe(true);
    expect(tripeaks.isWon(withSlots({ 27: S(2) }))).toBe(false);
    expect(tripeaks.isWon(dealTriPeaks(1))).toBe(false);
    // the winning move reports it
    const b = withSlots({ 18: S(5) }, { waste: [D(6)] });
    const r = tripeaks.move(b, 'p18', 0, 'waste', NO_TWISTS);
    expect(r.won).toBe(true);
    expect(tripeaks.isWon(r.board)).toBe(true);
  });

  it('is stuck only when nothing plays and the stock is spent', () => {
    const dead = withSlots({ 18: S(5) }, { waste: [D(9)] });
    expect(tripeaks.isStuck(dead, NO_TWISTS)).toBe(true);
    expect(tripeaks.isStuck({ ...dead, stock: [H(2)] }, NO_TWISTS)).toBe(false);
    const live = withSlots({ 18: S(5) }, { waste: [D(6)] });
    expect(tripeaks.isStuck(live, NO_TWISTS)).toBe(false);
    // a wild card in hand is never stuck
    expect(tripeaks.isStuck(dead, wildTwists(S(5)))).toBe(false);
    // a fresh deal has a full stock
    expect(tripeaks.isStuck(dealTriPeaks(1), NO_TWISTS)).toBe(false);
    // a won board is not "stuck"
    expect(tripeaks.isStuck(board(), NO_TWISTS)).toBe(false);
  });

  it('legalTriPeaksMoves lists only exposed, playable cards', () => {
    const b = withSlots({ 0: S(2), 3: S(5), 4: S(9), 18: H(7) }, { waste: [D(6)] });
    expect(legalTriPeaksMoves(b)).toEqual([
      { pile: 'p3', index: 0, to: 'waste' },
      { pile: 'p18', index: 0, to: 'waste' }
    ]);
  });
});

// ------------------------------------------------------------ hash / clone ---

describe('hash and clone', () => {
  it('clones deeply and hashes the position, not the move count', () => {
    const b = dealTriPeaks(5);
    const c = tripeaks.clone(b);
    expect(c).not.toBe(b);
    expect(c).toEqual(b);
    expect(c.slots).not.toBe(b.slots);
    expect(c.stock).not.toBe(b.stock);
    expect(c.waste).not.toBe(b.waste);
    expect(c.glass).not.toBe(b.glass);
    expect(tripeaks.hash(c)).toBe(tripeaks.hash(b));
    // mutating the clone cannot reach the original
    c.slots[0] = null;
    expect(b.slots[0]).not.toBeNull();
    // moves is excluded from the hash
    expect(tripeaks.hash({ ...b, moves: 99 })).toBe(tripeaks.hash(b));
    // everything else is in it
    expect(tripeaks.hash({ ...b, glass: [b.slots[0] as CardId] })).not.toBe(tripeaks.hash(b));
    expect(tripeaks.hash(tripeaks.draw(b, NO_TWISTS).board)).not.toBe(tripeaks.hash(b));
  });

  it('distinguishes an empty slot from a card with id 0', () => {
    expect(tripeaks.hash(withSlots({ 0: 0 }))).not.toBe(tripeaks.hash(board()));
  });
});

// ---------------------------------------------------------------- twists ---

describe('twists', () => {
  it('a wild card plays regardless of rank, and anything plays onto a wild waste top', () => {
    const b = withSlots({ 18: S(5), 19: H(9) }, { waste: [D(2)] });
    expect(tripeaks.legalTargets(b, 'p18', 0, NO_TWISTS)).toEqual([]);
    const w = wildTwists(S(5));
    expect(tripeaks.legalTargets(b, 'p18', 0, w)).toEqual(['waste']);
    const r = tripeaks.move(b, 'p18', 0, 'waste', w);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([S(5)]);
    // ...and now the wild is the waste top, so H9 goes too
    expect(tripeaks.legalTargets(r.board, 'p19', 0, w)).toEqual(['waste']);
    expect(tripeaks.move(r.board, 'p19', 0, 'waste', w).changed).toBe(true);
    // a wild card still has to be exposed
    const covered = withSlots({ 0: S(5), 3: H(2), 4: H(3) }, { waste: [D(2)] });
    expect(tripeaks.legalTargets(covered, 'p0', 0, wildTwists(S(5)))).toEqual([]);
  });

  it('honours wild and glass only', () => {
    expect(tripeaks.honours).toEqual(['wild', 'glass']);
    expect(tripeaks.options).toEqual([]);
  });

  it('drops a card from glass once it is exposed or played', () => {
    const b = withSlots({ 0: S(9), 3: S(5), 4: H(6) }, { waste: [D(6)], glass: [S(9), S(5)] });
    const r1 = tripeaks.move(b, 'p3', 0, 'waste', NO_TWISTS);
    expect(r1.board.glass).toEqual([S(9)]); // the played card left
    const r2 = tripeaks.move(r1.board, 'p4', 0, 'waste', NO_TWISTS);
    expect(r2.board.glass).toEqual([]); // p0 is exposed now; it needs no glass
  });
});

// --------------------------------------------------------------- autoplay ---

describe('greedy autoplay', () => {
  it('terminates on seeds 1..40 and wins a decent share', () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = solveGreedy(tripeaks, dealTriPeaks(seed), NO_TWISTS, 2000);
      expect(r.steps).toBeLessThan(2000);
      expect(r.won).toBe(tripeaks.isWon(r.board));
      if (!r.won) expect(tripeaks.isStuck(r.board, NO_TWISTS) || r.steps > 0).toBe(true);
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/40 TriPeaks deals won`);
    expect(wins).toBeGreaterThanOrEqual(4);
  });
});
