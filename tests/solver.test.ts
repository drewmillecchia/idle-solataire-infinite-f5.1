import { describe, expect, it } from 'vitest';
import { cardId, type CardId } from '$engine/types';
import { deckCardIds, JOKER_53, JOKER_ID } from '$engine/deck';
import { NO_TWISTS, type Twists } from '../src/rules/module';
import { dealKlondike, klondike, type KlondikeBoard } from '../src/rules/games/klondike';
import {
  findWinnableSeed,
  isWinnable,
  solveKlondike,
  type SolverMove
} from '../src/rules/solver/klondike';
import { handle } from '../src/rules/solver/worker';

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);
const D = (r: number) => cardId('D', r as 1);
const C = (r: number) => cardId('C', r as 1);

function board(p: Partial<KlondikeBoard> = {}): KlondikeBoard {
  return {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: Array.from({ length: 7 }, () => ({ down: [], up: [] })),
    drawCount: 1,
    redealsLeft: -1,
    moves: 0,
    glass: [],
    dealt: 52,
    ...p
  };
}

/** Replay a solver line through the REAL module. This is what keeps the solver's copied rules honest. */
function replay(start: KlondikeBoard, line: SolverMove[], twists: Twists = NO_TWISTS): KlondikeBoard {
  let b = start;
  for (const m of line) {
    const r = 'kind' in m ? klondike.draw(b, twists) : klondike.move(b, m.pile, m.index, m.to, twists);
    expect(r.changed, `illegal replay step ${JSON.stringify(m)}`).toBe(true);
    b = r.board;
  }
  return b;
}

const upTo = (suit: (r: number) => CardId, n: number): CardId[] =>
  Array.from({ length: n }, (_, i) => suit(i + 1));

describe('solveKlondike', () => {
  it('wins a nearly-won board and hands back the line', () => {
    const start = board({
      foundations: [upTo(S, 12), upTo(H, 12), upTo(D, 12), upTo(C, 12)],
      tableau: [
        { down: [], up: [S(13)] },
        { down: [], up: [H(13)] },
        { down: [], up: [D(13)] },
        { down: [], up: [C(13)] },
        { down: [], up: [] },
        { down: [], up: [] },
        { down: [], up: [] }
      ]
    });
    const r = solveKlondike(start);
    expect(r.result).toBe('won');
    expect(r.line?.length).toBe(4);
    expect(klondike.isWon(replay(start, r.line ?? []))).toBe(true);
  });

  it('proves a dead board lost, cheaply', () => {
    // Seven black cards, no ace, no king, no stock: nothing stacks, nothing goes home, nothing draws.
    const start = board({
      tableau: [S(2), S(4), S(6), S(8), S(10), C(3), C(5)].map((c) => ({ down: [], up: [c] }))
    });
    expect(klondike.isStuck(start, NO_TWISTS)).toBe(true);
    const r = solveKlondike(start);
    expect(r.result).toBe('lost');
    expect(r.nodes).toBeLessThan(10);
  });

  it('does not mutate the board it is given', () => {
    const start = dealKlondike(7);
    const before = klondike.hash(start);
    solveKlondike(start, { budgetNodes: 5_000 });
    expect(klondike.hash(start)).toBe(before);
  });

  it('returns unknown when the node budget runs out', () => {
    const r = solveKlondike(dealKlondike(1), { budgetNodes: 50 });
    expect(r.result).toBe('unknown');
    expect(r.line).toBeUndefined();
    expect(r.nodes).toBeLessThanOrEqual(50);
  });

  it('solves a real deal and the line replays to a win through the module', () => {
    const start = dealKlondike(1);
    const r = solveKlondike(start, { budgetNodes: 200_000 });
    expect(r.result).toBe('won');
    const end = replay(start, r.line ?? []);
    expect(klondike.isWon(end)).toBe(true);
    expect(end.foundations.every((f) => f.length === 13)).toBe(true);
  });

  it('honours the redeal limit and draw-three', () => {
    const cases: [Record<string, string>, number][] = [
      [{ redeals: '0' }, 1],
      [{ redeals: '3' }, 1],
      [{ draw: '3' }, 2]
    ];
    for (const [config, seed] of cases) {
      const start = dealKlondike(seed, config);
      const r = solveKlondike(start, { budgetNodes: 120_000 });
      expect(r.result, JSON.stringify(config)).toBe('won');
      expect(klondike.isWon(replay(start, r.line ?? []))).toBe(true);
    }
  });
});

describe('twists', () => {
  // Foundations hold ♠A-9 and all of hearts, diamonds and clubs. The last four spades are stacked so
  // that ♠10 — the only card the spade foundation will take — is buried under ♠J, and ♠J has nowhere
  // to go: it is not a king, so no empty column will have it.
  const stuckBoard = () =>
    board({
      foundations: [upTo(S, 9), upTo(H, 13), upTo(D, 13), upTo(C, 13)],
      tableau: [
        { down: [S(12)], up: [S(13)] },
        { down: [S(10)], up: [S(11)] },
        { down: [], up: [] },
        { down: [], up: [] },
        { down: [], up: [] },
        { down: [], up: [] },
        { down: [], up: [] }
      ]
    });

  const wildJack: Twists = {
    isWild: (c) => c === S(11),
    isMirror: () => false,
    dealtFaceUp: () => false
  };

  it('a board with no way out is lost', () => {
    expect(solveKlondike(stuckBoard()).result).toBe('lost');
  });

  it('a Wild card makes the same board winnable', () => {
    const start = stuckBoard();
    const r = solveKlondike(start, { twists: wildJack });
    expect(r.result).toBe('won');
    expect(klondike.isWon(replay(start, r.line ?? [], wildJack))).toBe(true);
  });
});

describe('a deck with a rankless card', () => {
  it('solves a 53-card deal and replays it to a real win, the Joker crowning a finished pile', () => {
    // Seed 10 is a deal the solver cracks in a few milliseconds; the point is not the seed but
    // that the whole 53-card loop closes — deal, rules, solver, replay, win check — and that the
    // winning position is 14/13/13/13, i.e. every card home with the Joker on top of a complete
    // foundation. Before that rule existed, four foundations held 52 places for 53 cards and this
    // was unwinnable by construction (docs/12-ascension.md).
    const start = dealKlondike(10, {}, NO_TWISTS, deckCardIds(JOKER_53));
    expect(start.dealt).toBe(53);
    const r = solveKlondike(start, { budgetNodes: 300_000 });
    expect(r.result).toBe('won');
    const end = replay(start, r.line ?? []);
    expect(klondike.isWon(end)).toBe(true);
    expect(end.foundations.map((f) => f.length).sort((a, b) => b - a)).toEqual([14, 13, 13, 13]);
    expect(end.foundations.flat()).toContain(JOKER_ID);
  });
});

describe('isWinnable / findWinnableSeed', () => {
  it('proves a deal winnable', () => {
    expect(isWinnable(1, {}, { budgetNodes: 200_000 })).toBe(true);
  });

  it('returns null when the budget is too small to decide', () => {
    expect(isWinnable(1, {}, { budgetNodes: 50 })).toBeNull();
  });

  it('finds a proven-winnable seed and its line wins the deal', () => {
    const found = findWinnableSeed(1);
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.seed).toBeGreaterThanOrEqual(1);
    expect(found.tries).toBeGreaterThanOrEqual(1);
    expect(found.line.length).toBeGreaterThan(0);
    expect(klondike.isWon(replay(dealKlondike(found.seed), found.line))).toBe(true);
  });

  it('walks forward from the start seed', () => {
    for (const start of [1, 500, 1234]) {
      const found = findWinnableSeed(start, {}, { maxTries: 25, budgetNodes: 60_000 });
      expect(found).not.toBeNull();
      if (!found) continue;
      expect(found.seed).toBeGreaterThanOrEqual(start);
      expect(found.seed).toBeLessThan(start + 25);
      expect(klondike.isWon(replay(dealKlondike(found.seed), found.line))).toBe(true);
    }
  });

  it('gives up rather than hanging when nothing can be proven', () => {
    expect(findWinnableSeed(1, {}, { maxTries: 2, budgetNodes: 20 })).toBeNull();
  });
});

describe('worker handler', () => {
  it('answers a request with a winnable seed and its line', () => {
    const res = handle({ id: 9, seed: 1, opts: { maxTries: 5, budgetNodes: 60_000 } });
    expect(res.id).toBe(9);
    expect(res.seed).not.toBeNull();
    expect(res.line.length).toBeGreaterThan(0);
    expect(klondike.isWon(replay(dealKlondike(res.seed as number), res.line))).toBe(true);
  });

  it('reports a null seed rather than throwing when it cannot prove one', () => {
    const res = handle({ id: 10, seed: 1, opts: { maxTries: 1, budgetNodes: 20 } });
    expect(res.seed).toBeNull();
    expect(res.line).toEqual([]);
  });
});
