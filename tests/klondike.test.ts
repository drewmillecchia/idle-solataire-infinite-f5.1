import { describe, expect, it } from 'vitest';
import { cardId } from '$engine/types';
import type { CardId } from '$engine/types';
import { mulberry32 } from '$engine/rng';
import { NO_TWISTS, type Twists } from '../src/rules/module';
import {
  dealKlondike,
  klondike,
  legalMoves,
  type KlondikeBoard
} from '../src/rules/games/klondike';

// --- fixtures ---------------------------------------------------------------

function board(p: Partial<KlondikeBoard> = {}): KlondikeBoard {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: Array.from({ length: 7 }, () => ({ down: [] as CardId[], up: [] as CardId[] })),
    drawCount: 1,
    redealsLeft: -1,
    moves: 0,
    glass: [],
    ...p
  };
}

function cols(spec: { down?: CardId[]; up?: CardId[] }[]): KlondikeBoard['tableau'] {
  return Array.from({ length: 7 }, (_, i) => ({
    down: spec[i]?.down ?? [],
    up: spec[i]?.up ?? []
  }));
}

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);
const C = (r: number) => cardId('C', r as 1);

function twistsWith(p: Partial<Twists>): Twists {
  return { ...NO_TWISTS, ...p };
}

function pileView(b: KlondikeBoard, id: string) {
  const v = klondike.view(b).piles.find((p) => p.id === id);
  if (!v) throw new Error(`no pile ${id}`);
  return v;
}

// --- deal -------------------------------------------------------------------

describe('deal', () => {
  it('lays out 52 unique cards: columns of 1..7 with one face-up each, 24 in stock', () => {
    for (const seed of [1, 2, 7, 12345]) {
      const b = dealKlondike(seed);
      const all: CardId[] = [
        ...b.stock,
        ...b.waste,
        ...b.foundations.flat(),
        ...b.tableau.flatMap((c) => [...c.down, ...c.up])
      ];
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(b.stock).toHaveLength(24);
      expect(b.waste).toHaveLength(0);
      b.tableau.forEach((c, i) => {
        expect(c.down.length + c.up.length).toBe(i + 1);
        expect(c.up).toHaveLength(1);
      });
      expect(b.moves).toBe(0);
      expect(klondike.isWon(b)).toBe(false);
    }
  });

  it('is deterministic for a seed and honours the options', () => {
    expect(klondike.hash(dealKlondike(99))).toBe(klondike.hash(dealKlondike(99)));
    expect(klondike.hash(dealKlondike(99))).not.toBe(klondike.hash(dealKlondike(100)));

    expect(dealKlondike(1, {}).drawCount).toBe(1);
    expect(dealKlondike(1, { draw: '3' }).drawCount).toBe(3);
    expect(dealKlondike(1, { draw: 'nonsense' }).drawCount).toBe(1);
    expect(dealKlondike(1, {}).redealsLeft).toBe(-1);
    expect(dealKlondike(1, { redeals: '3' }).redealsLeft).toBe(3);
    expect(dealKlondike(1, { redeals: '0' }).redealsLeft).toBe(0);
  });

  it('deals through the module with a raw rng', () => {
    const b = klondike.deal(mulberry32(5), { draw: '3' }, NO_TWISTS);
    expect(b.drawCount).toBe(3);
    expect(b.stock).toHaveLength(24);
  });
});

// --- draw / recycle ---------------------------------------------------------

describe('draw', () => {
  it('draw 1 moves the stock top to the waste', () => {
    const b = board({ stock: [S(2), S(3), S(4)] });
    const r = klondike.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.waste).toEqual([S(4)]);
    expect(r.board.stock).toEqual([S(2), S(3)]);
    expect(r.events).toEqual([{ type: 'draw', count: 1 }]);
    expect(b.stock).toHaveLength(3); // original untouched
  });

  it('draw 3 moves three, top last, and fewer when the stock is short', () => {
    const b = board({ stock: [S(2), S(3), S(4), S(5)], drawCount: 3 });
    const r = klondike.draw(b, NO_TWISTS);
    expect(r.board.waste).toEqual([S(5), S(4), S(3)]);
    expect(r.board.stock).toEqual([S(2)]);
    expect(r.events).toEqual([{ type: 'draw', count: 3 }]);

    const r2 = klondike.draw(r.board, NO_TWISTS);
    expect(r2.events).toEqual([{ type: 'draw', count: 1 }]);
    expect(r2.board.stock).toEqual([]);
  });

  it('recycles the waste back into the stock in reverse', () => {
    const b = board({ stock: [], waste: [S(2), S(3), S(4)] });
    const r = klondike.draw(b, NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.events).toEqual([{ type: 'recycle' }]);
    expect(r.board.stock).toEqual([S(4), S(3), S(2)]);
    expect(r.board.waste).toEqual([]);
    expect(r.board.redealsLeft).toBe(-1); // unlimited never decrements
  });

  it('spends and then exhausts a finite redeal allowance', () => {
    const b = board({ stock: [], waste: [S(2), S(3)], redealsLeft: 1 });
    const r = klondike.draw(b, NO_TWISTS);
    expect(r.board.redealsLeft).toBe(0);

    const emptied = board({ stock: [], waste: [S(2), S(3)], redealsLeft: 0 });
    const r2 = klondike.draw(emptied, NO_TWISTS);
    expect(r2.changed).toBe(false);
    expect(r2.board).toBe(emptied);
    expect(pileView(emptied, 'stock').blocked).toBe(true);
  });

  it('is a no-op when stock and waste are both empty', () => {
    const b = board();
    expect(klondike.draw(b, NO_TWISTS).changed).toBe(false);
    expect(pileView(b, 'stock').blocked).toBe(true);
  });

  it('leaves the stock unblocked while a recycle is available', () => {
    const b = board({ stock: [], waste: [S(2)], redealsLeft: -1 });
    expect(pileView(b, 'stock').blocked).toBeUndefined();
  });
});

// --- tableau moves ----------------------------------------------------------

describe('tableau moves', () => {
  it('accepts an alternate-colour descent and refuses a same-colour one', () => {
    const b = board({ tableau: cols([{ up: [S(5)] }, { up: [H(4)] }, { up: [C(4)] }]) });

    const ok = klondike.move(b, 't1', 0, 't0', NO_TWISTS);
    expect(ok.changed).toBe(true);
    expect(ok.board.tableau[0]?.up).toEqual([S(5), H(4)]);
    expect(ok.board.tableau[1]?.up).toEqual([]);
    expect(ok.homed).toEqual([]);
    expect(ok.won).toBe(false);
    expect(ok.board.moves).toBe(1);

    const bad = klondike.move(b, 't2', 0, 't0', NO_TWISTS);
    expect(bad.changed).toBe(false);
    expect(bad.board).toBe(b);
    expect(klondike.legalTargets(b, 't2', 0, NO_TWISTS)).not.toContain('t0');
  });

  it('refuses a wrong rank and a face-down index', () => {
    const b = board({ tableau: cols([{ up: [S(5)] }, { down: [D(9)], up: [H(2)] }]) });
    expect(klondike.move(b, 't1', 1, 't0', NO_TWISTS).changed).toBe(false);
    expect(klondike.canPickUp(b, 't1', 0, NO_TWISTS)).toBe(false); // face-down
    expect(klondike.canPickUp(b, 't1', 1, NO_TWISTS)).toBe(true);
    expect(klondike.canPickUp(b, 'stock', 0, NO_TWISTS)).toBe(false);
  });

  it('moves a whole run as a unit', () => {
    const b = board({
      tableau: cols([{ up: [S(8), H(7), C(6)] }, { up: [H(9)] }])
    });
    const r = klondike.move(b, 't0', 0, 't1', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[1]?.up).toEqual([H(9), S(8), H(7), C(6)]);
    expect(r.board.tableau[0]?.up).toEqual([]);

    // Picking up from mid-run moves only the tail.
    const tail = klondike.move(b, 't0', 2, 't1', NO_TWISTS);
    expect(tail.changed).toBe(false); // C(6) does not sit on H(9)
    expect(klondike.legalTargets(b, 't0', 1, NO_TWISTS)).toEqual([]);
  });

  it('auto-flips the newly exposed card and emits a flip event', () => {
    const b = board({ tableau: cols([{ down: [D(9), C(2)], up: [S(5)] }, { up: [H(6)] }]) });
    const r = klondike.move(b, 't0', 2, 't1', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]?.down).toEqual([D(9)]);
    expect(r.board.tableau[0]?.up).toEqual([C(2)]);
    expect(r.events).toEqual([{ type: 'flip', pile: 't0', index: 1 }]);
    expect(pileView(r.board, 't0').cards[1]).toEqual({ id: C(2), faceUp: true });
  });

  it('lets a king (and only a king) into an empty column', () => {
    const b = board({ tableau: cols([{ down: [D(9)], up: [S(13)] }, { up: [H(12)] }]) });
    expect(klondike.legalTargets(b, 't0', 1, NO_TWISTS)).toContain('t2');
    const r = klondike.move(b, 't0', 1, 't2', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[2]?.up).toEqual([S(13)]);
    expect(r.events).toEqual([{ type: 'flip', pile: 't0', index: 0 }]);

    expect(klondike.legalTargets(b, 't1', 0, NO_TWISTS)).not.toContain('t2'); // queen
  });
});

// --- foundations ------------------------------------------------------------

describe('foundations', () => {
  it('builds up by suit from the ace and reports homed cards', () => {
    const b = board({ waste: [S(1)], tableau: cols([{ up: [S(2)] }]) });

    const ace = klondike.move(b, 'waste', 0, 'f0', NO_TWISTS);
    expect(ace.changed).toBe(true);
    expect(ace.homed).toEqual([S(1)]);
    expect(ace.board.foundations[0]).toEqual([S(1)]);

    const two = klondike.move(ace.board, 't0', 0, 'f0', NO_TWISTS);
    expect(two.changed).toBe(true);
    expect(two.homed).toEqual([S(2)]);
    expect(two.board.foundations[0]).toEqual([S(1), S(2)]);

    // wrong suit, and wrong rank
    const wrong = board({ waste: [H(2)], foundations: [[S(1)], [], [], []] });
    expect(klondike.move(wrong, 'waste', 0, 'f0', NO_TWISTS).changed).toBe(false);
    const jump = board({ waste: [S(3)], foundations: [[S(1)], [], [], []] });
    expect(klondike.move(jump, 'waste', 0, 'f0', NO_TWISTS).changed).toBe(false);
  });

  it('takes only a single card, never a run', () => {
    const b = board({ foundations: [[S(1)], [], [], []], tableau: cols([{ up: [S(2), H(1)] }]) });
    expect(klondike.legalTargets(b, 't0', 0, NO_TWISTS)).not.toContain('f0');
  });

  it('lets a card come back down to the tableau, homing nothing', () => {
    const b = board({ foundations: [[S(1), S(2)], [], [], []], tableau: cols([{ up: [H(3)] }]) });
    const r = klondike.move(b, 'f0', 1, 't0', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.homed).toEqual([]);
    expect(r.board.foundations[0]).toEqual([S(1)]);
    expect(r.board.tableau[0]?.up).toEqual([H(3), S(2)]);
    // only the top of a foundation is pickable
    expect(klondike.canPickUp(b, 'f0', 0, NO_TWISTS)).toBe(false);
    expect(klondike.canPickUp(b, 'f0', 1, NO_TWISTS)).toBe(true);
  });

  it('only the top waste card can be picked up', () => {
    const b = board({ waste: [S(1), S(2), S(3)] });
    expect(klondike.canPickUp(b, 'waste', 0, NO_TWISTS)).toBe(false);
    expect(klondike.canPickUp(b, 'waste', 1, NO_TWISTS)).toBe(false);
    expect(klondike.canPickUp(b, 'waste', 2, NO_TWISTS)).toBe(true);
    expect(pileView(b, 'waste').pickableFrom).toBe(2);
  });
});

// --- autoTarget -------------------------------------------------------------

describe('autoTarget', () => {
  it('prefers a foundation over a tableau landing', () => {
    const b = board({
      waste: [S(2)],
      foundations: [[S(1)], [], [], []],
      tableau: cols([{ up: [H(3)] }])
    });
    expect(klondike.legalTargets(b, 'waste', 0, NO_TWISTS)).toEqual(['f0', 't0']);
    expect(klondike.autoTarget(b, 'waste', 0, NO_TWISTS)).toBe('f0');
  });

  it('falls back to the first legal tableau target', () => {
    const b = board({ waste: [S(2)], tableau: cols([{}, { up: [H(3)] }]) });
    expect(klondike.autoTarget(b, 'waste', 0, NO_TWISTS)).toBe('t1');
  });

  it('returns null with nothing legal, and for an unpickable index', () => {
    const b = board({ waste: [S(2)] });
    expect(klondike.autoTarget(b, 'waste', 0, NO_TWISTS)).toBeNull();
    expect(klondike.autoTarget(b, 'stock', 0, NO_TWISTS)).toBeNull();
  });

  it('never auto-targets a no-progress king shuffle between empty columns', () => {
    const b = board({ tableau: cols([{ up: [S(13), H(12)] }]) });
    // t1..t6 are empty: legal, but it reveals nothing.
    expect(klondike.legalTargets(b, 't0', 0, NO_TWISTS)).toContain('t1');
    expect(klondike.autoTarget(b, 't0', 0, NO_TWISTS)).toBeNull();

    // With a face-down card behind it, the same move is progress.
    const worth = board({ tableau: cols([{ down: [D(4)], up: [S(13)] }]) });
    expect(klondike.autoTarget(worth, 't0', 1, NO_TWISTS)).toBe('t1');
  });
});

// --- twists -----------------------------------------------------------------

describe('twists', () => {
  it('wild: places on a same-colour card, and accepts anything on top', () => {
    const wild = C(9);
    const t = twistsWith({ isWild: (c) => c === wild });
    const b = board({ waste: [wild], tableau: cols([{ up: [S(5)] }]) });

    expect(klondike.move(b, 'waste', 0, 't0', NO_TWISTS).changed).toBe(false);
    const r = klondike.move(b, 'waste', 0, 't0', t);
    expect(r.changed).toBe(true);
    expect(r.board.tableau[0]?.up).toEqual([S(5), wild]);

    // anything lands on a wild card
    const onTop = board({ waste: [S(7)], tableau: cols([{ up: [wild] }]) });
    expect(klondike.move(onTop, 'waste', 0, 't0', t).changed).toBe(true);

    // and a wild may start or continue any foundation
    const found = board({ waste: [wild], foundations: [[], [H(1), H(2)], [], []] });
    expect(klondike.legalTargets(found, 'waste', 0, t)).toEqual(
      expect.arrayContaining(['f0', 'f1'])
    );
    // an empty column takes a wild that is not a king
    expect(klondike.legalTargets(b, 'waste', 0, t)).toContain('t1');
  });

  it('mirror: counts as both colours, either way round', () => {
    const mirror = C(4);
    const t = twistsWith({ isMirror: (c) => c === mirror });
    const onBlack = board({ waste: [mirror], tableau: cols([{ up: [S(5)] }]) });
    expect(klondike.move(onBlack, 'waste', 0, 't0', NO_TWISTS).changed).toBe(false);
    expect(klondike.move(onBlack, 'waste', 0, 't0', t).changed).toBe(true);

    const onMirror = board({ waste: [C(3)], tableau: cols([{ up: [mirror] }]) });
    expect(klondike.move(onMirror, 'waste', 0, 't0', NO_TWISTS).changed).toBe(false);
    expect(klondike.move(onMirror, 'waste', 0, 't0', t).changed).toBe(true);
  });

  it('glass: dealt-face-up cards stay visible while face-down in the tableau', () => {
    const all = twistsWith({ dealtFaceUp: () => true });
    const b = klondike.deal(mulberry32(3), {}, all);
    expect(b.glass).toHaveLength(21); // every face-down tableau card
    expect(new Set(b.glass).size).toBe(21);

    const t6 = pileView(b, 't6');
    expect(t6.cards).toHaveLength(7);
    expect(t6.cards.every((c) => c.faceUp)).toBe(true);
    expect(t6.cards.map((c) => c.id)).toEqual([...(b.tableau[6]?.down ?? []), ...(b.tableau[6]?.up ?? [])]);
    expect(t6.pickableFrom).toBe(6); // still only the real face-up card is pickable

    // Without the twist the same positions read as face-down.
    const plain = klondike.deal(mulberry32(3), {}, NO_TWISTS);
    expect(plain.glass).toEqual([]);
    expect(pileView(plain, 't6').cards.filter((c) => c.faceUp)).toHaveLength(1);

    // A glass card stops being glass once it is genuinely flipped.
    const one = board({ tableau: cols([{ down: [D(9)], up: [S(5)] }, { up: [H(6)] }]), glass: [D(9)] });
    expect(pileView(one, 't0').cards[0]).toEqual({ id: D(9), faceUp: true });
    const r = klondike.move(one, 't0', 1, 't1', NO_TWISTS);
    expect(r.board.glass).toEqual([]);
    expect(r.board.tableau[0]?.up).toEqual([D(9)]);
  });
});

// --- view -------------------------------------------------------------------

describe('view', () => {
  it('lays the grid out as the renderer expects', () => {
    const b = dealKlondike(4, { draw: '3' });
    const v = klondike.view(b);
    expect(v.cols).toBe(7);
    expect(v.rows).toBe(4.6);
    expect(v.piles.map((p) => p.id)).toEqual([
      'stock', 'waste', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'
    ]);
    expect(pileView(b, 'stock')).toMatchObject({ kind: 'stock', x: 0, y: 0, fan: 'none' });
    expect(pileView(b, 'waste')).toMatchObject({ kind: 'waste', x: 1, y: 0, fan: 'right' });
    expect(pileView(dealKlondike(4), 'waste').fan).toBe('none');
    [0, 1, 2, 3].forEach((i) =>
      expect(pileView(b, `f${i}`)).toMatchObject({ kind: 'foundation', x: 3 + i, y: 0, fan: 'none' })
    );
    for (let i = 0; i < 7; i++) {
      const p = pileView(b, `t${i}`);
      expect(p).toMatchObject({ kind: 'tableau', x: i, y: 1.25, fan: 'down' });
      expect(p.pickableFrom).toBe(i);
      expect(p.cards).toHaveLength(i + 1);
    }
  });

  it('omits pickableFrom on empty piles', () => {
    const b = board();
    expect(pileView(b, 'waste').pickableFrom).toBeUndefined();
    expect(pileView(b, 'f0').pickableFrom).toBeUndefined();
    expect(pileView(b, 't0').pickableFrom).toBeUndefined();
  });
});

// --- winning and stuck ------------------------------------------------------

describe('winning', () => {
  const full = (suit: 'S' | 'H' | 'D' | 'C') =>
    Array.from({ length: 13 }, (_, i) => cardId(suit, (i + 1) as 1));

  it('detects the win as the last king goes home', () => {
    const b = board({
      foundations: [full('S'), full('H'), full('D'), full('C').slice(0, 12)],
      waste: [C(13)]
    });
    expect(klondike.isWon(b)).toBe(false);
    const r = klondike.move(b, 'waste', 0, 'f3', NO_TWISTS);
    expect(r.changed).toBe(true);
    expect(r.won).toBe(true);
    expect(r.homed).toEqual([C(13)]);
    expect(klondike.isWon(r.board)).toBe(true);
  });

  it('knows when it is stuck', () => {
    const dead = board({ tableau: cols([{ up: [S(5)] }, { up: [C(9)] }]) });
    expect(legalMoves(dead)).toEqual([]);
    expect(klondike.isStuck(dead, NO_TWISTS)).toBe(true);

    expect(klondike.isStuck(board({ stock: [S(5)] }), NO_TWISTS)).toBe(false); // can draw
    expect(klondike.isStuck(board({ waste: [S(5)] }), NO_TWISTS)).toBe(false); // can recycle
    expect(klondike.isStuck(board({ waste: [S(5)], redealsLeft: 0 }), NO_TWISTS)).toBe(true);
    expect(klondike.isStuck(dealKlondike(1), NO_TWISTS)).toBe(false);
  });
});

// --- clone and hash ---------------------------------------------------------

describe('clone and hash', () => {
  it('clones deeply and independently', () => {
    const b = dealKlondike(11, { draw: '3', redeals: '3' }, twistsWith({ dealtFaceUp: () => true }));
    const c = klondike.clone(b);
    expect(c).toEqual(b);
    expect(c).not.toBe(b);

    c.stock.push(999);
    c.waste.push(998);
    c.foundations[0]?.push(997);
    c.tableau[0]?.up.push(996);
    c.tableau[0]?.down.push(995);
    c.glass.push(994);
    c.moves = 42;

    expect(b.stock).not.toContain(999);
    expect(b.waste).toHaveLength(0);
    expect(b.foundations[0]).toEqual([]);
    expect(b.tableau[0]?.up).not.toContain(996);
    expect(b.tableau[0]?.down).not.toContain(995);
    expect(b.glass).not.toContain(994);
    expect(b.moves).toBe(0);
  });

  it('hashes the position, not the move counter', () => {
    const b = dealKlondike(21);
    expect(klondike.hash(b)).toBe(klondike.hash(klondike.clone(b)));
    expect(klondike.hash(b)).toBe(klondike.hash({ ...klondike.clone(b), moves: 77 }));

    const drawn = klondike.draw(b, NO_TWISTS);
    expect(klondike.hash(drawn.board)).not.toBe(klondike.hash(b));

    // Options are part of the position.
    expect(klondike.hash({ ...klondike.clone(b), drawCount: 3 })).not.toBe(klondike.hash(b));
    expect(klondike.hash({ ...klondike.clone(b), redealsLeft: 3 })).not.toBe(klondike.hash(b));
  });
});

// --- legalMoves helper ------------------------------------------------------

describe('legalMoves', () => {
  it('enumerates every non-draw move on the board', () => {
    const b = board({
      waste: [S(1)],
      foundations: [[], [], [], []],
      tableau: cols([{ up: [S(5)] }, { up: [H(4)] }])
    });
    const moves = legalMoves(b);
    expect(moves).toEqual(
      expect.arrayContaining([
        { pile: 'waste', index: 0, to: 'f0' },
        { pile: 't1', index: 0, to: 't0' }
      ])
    );
    // every enumerated move actually applies
    for (const m of moves) {
      expect(klondike.move(b, m.pile, m.index, m.to, NO_TWISTS).changed).toBe(true);
    }
  });
});
