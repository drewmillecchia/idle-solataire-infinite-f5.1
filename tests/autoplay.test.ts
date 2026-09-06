import { describe, expect, it } from 'vitest';
import { cardId } from '$engine/types';
import { mulberry32 } from '$engine/rng';
import { deckCardIds, STANDARD_52 } from '$engine/deck';
import { NO_TWISTS } from '../src/rules/module';
import { GAMES } from '../src/rules/registry';
import { nextMove, solveGreedy } from '../src/rules/autoplay';
import { dealKlondike, klondike, type KlondikeBoard } from '../src/rules/games/klondike';

const STANDARD_IDS = deckCardIds(STANDARD_52);

const S = (r: number) => cardId('S', r as 1);
const H = (r: number) => cardId('H', r as 1);

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

describe('nextMove', () => {
  it('prefers a foundation over any tableau move', () => {
    const b = board({
      foundations: [[S(1)], [], [], []],
      tableau: [
        { down: [], up: [S(2)] },
        { down: [], up: [H(3)] },
        ...Array.from({ length: 5 }, () => ({ down: [] as number[], up: [] as number[] }))
      ]
    });
    expect(nextMove(klondike, b, NO_TWISTS, new Set())).toEqual({
      kind: 'move',
      pile: 't0',
      index: 0,
      to: 'f0'
    });
  });

  it('prefers a move that uncovers a face-down card over one that does not', () => {
    const b = board({
      tableau: [
        { down: [S(9)], up: [H(4)] }, // moving H4 reveals a card
        { down: [], up: [H(6)] },
        { down: [], up: [S(5)] },
        { down: [], up: [S(7)] },
        ...Array.from({ length: 3 }, () => ({ down: [] as number[], up: [] as number[] }))
      ]
    });
    // H(6) -> S(7) is legal too, but reveals nothing.
    const step = nextMove(klondike, b, NO_TWISTS, new Set());
    expect(step).toEqual({ kind: 'move', pile: 't0', index: 1, to: 't2' });
  });

  it('never takes a card back off a foundation', () => {
    const b = board({
      foundations: [[S(1), S(2)], [], [], []],
      tableau: [
        { down: [], up: [H(3)] },
        ...Array.from({ length: 6 }, () => ({ down: [] as number[], up: [] as number[] }))
      ]
    });
    // The rules allow it...
    expect(klondike.legalTargets(b, 'f0', 1, NO_TWISTS)).toContain('t0');
    // ...autoplay does not.
    expect(nextMove(klondike, b, NO_TWISTS, new Set())).toBeNull();
  });

  it('refuses a no-progress relocation into an empty pile', () => {
    const b = board({ tableau: [
      { down: [], up: [S(13), H(12)] },
      ...Array.from({ length: 6 }, () => ({ down: [] as number[], up: [] as number[] }))
    ] });
    expect(klondike.legalTargets(b, 't0', 0, NO_TWISTS)).toContain('t1');
    expect(nextMove(klondike, b, NO_TWISTS, new Set())).toBeNull();
  });

  it('falls back to a draw, and returns null when nothing is left', () => {
    const b = board({ stock: [S(9)] });
    expect(nextMove(klondike, b, NO_TWISTS, new Set())).toEqual({ kind: 'draw' });
    expect(nextMove(klondike, board(), NO_TWISTS, new Set())).toBeNull();
  });

  it('skips a candidate whose result is already seen', () => {
    const b = board({ stock: [S(9)] });
    const drawn = klondike.draw(b, NO_TWISTS).board;
    const seen = new Set([klondike.hash(drawn)]);
    expect(nextMove(klondike, b, NO_TWISTS, seen)).toBeNull();
  });
});

describe('solveGreedy', () => {
  it('terminates on every registry game across many seeds', () => {
    for (const game of GAMES) {
      for (let seed = 1; seed <= 20; seed++) {
        const b = game.deal(mulberry32(seed), {}, NO_TWISTS, STANDARD_IDS);
        const r = solveGreedy(game, b, NO_TWISTS, 2000);
        expect(r.steps).toBeLessThan(2000);
        expect(r.won).toBe(game.isWon(r.board));
      }
    }
  });

  it('respects maxSteps', () => {
    const r = solveGreedy(klondike, dealKlondike(1), NO_TWISTS, 5);
    expect(r.steps).toBeLessThanOrEqual(5);
  });

  it('does nothing on an already-won board', () => {
    const full = (suit: 'S' | 'H' | 'D' | 'C') =>
      Array.from({ length: 13 }, (_, i) => cardId(suit, (i + 1) as 1));
    const won = board({ foundations: [full('S'), full('H'), full('D'), full('C')] });
    const r = solveGreedy(klondike, won, NO_TWISTS);
    expect(r.won).toBe(true);
    expect(r.steps).toBe(0);
  });

  it('wins a fair share of draw-1 Klondike deals over seeds 1..60', () => {
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = solveGreedy(klondike, dealKlondike(seed), NO_TWISTS, 2000);
      if (r.won) wins++;
    }
    // eslint-disable-next-line no-console
    console.log(`greedy autoplay: ${wins}/60 Klondike deals won`);
    expect(wins).toBeGreaterThanOrEqual(3);
  });
});
