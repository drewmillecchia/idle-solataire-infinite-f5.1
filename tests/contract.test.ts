/**
 * The contract test: it runs against every entry in the registry, and knows nothing about any
 * particular game. A new game passes this or it is not a GameModule.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '$engine/rng';
import { NO_TWISTS, type BoardView, type GameModule } from '../src/rules/module';
import { GAMES, gameById } from '../src/rules/registry';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function cardsIn(view: BoardView): (number | null)[] {
  return view.piles.flatMap((p) => p.cards.map((c) => c.id));
}

/** Every (pile, index) the view says can be picked up. */
function pickables(view: BoardView): { pile: string; index: number }[] {
  const out: { pile: string; index: number }[] = [];
  for (const p of view.piles) {
    if (p.pickableFrom === undefined) continue;
    for (let i = p.pickableFrom; i < p.cards.length; i++) out.push({ pile: p.id, index: i });
  }
  return out;
}

describe('registry', () => {
  it('has at least one game, with unique ids, and looks them up', () => {
    expect(GAMES.length).toBeGreaterThan(0);
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
    for (const g of GAMES) expect(gameById(g.id)).toBe(g);
    expect(gameById('no-such-game')).toBeUndefined();
  });
});

describe.each(GAMES.map((g) => [g.id, g] as [string, GameModule<unknown>]))(
  'GameModule contract: %s',
  (_id, game) => {
    it('declares sane metadata and options', () => {
      expect(game.id).toBeTruthy();
      expect(game.name).toBeTruthy();
      expect(game.blurb).toBeTruthy();
      for (const o of game.options) {
        expect(o.values.length).toBeGreaterThan(0);
        expect(o.values.map((v) => v.value)).toContain(o.default);
        expect(new Set(o.values.map((v) => v.value)).size).toBe(o.values.length);
      }
      expect(new Set(game.options.map((o) => o.id)).size).toBe(game.options.length);
    });

    it('deals 40 seeds that all satisfy the contract', () => {
      for (const seed of SEEDS) {
        const board = game.deal(mulberry32(seed), {}, NO_TWISTS);
        const view = game.view(board);

        // grid
        expect(view.cols).toBeGreaterThan(0);
        expect(view.rows).toBeGreaterThan(0);

        // piles
        const ids = view.piles.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of view.piles) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          if (p.pickableFrom !== undefined) {
            expect(p.pickableFrom).toBeGreaterThanOrEqual(0);
            expect(p.pickableFrom).toBeLessThan(p.cards.length);
          }
        }

        // a full, duplicate-free deck is on the table
        const cards = cardsIn(view);
        expect(cards).toHaveLength(52);
        expect(new Set(cards).size).toBe(52);
        expect(cards).not.toContain(null);

        // a fresh deal is not already over
        expect(game.isWon(board)).toBe(false);
        expect(game.isStuck(board, NO_TWISTS)).toBe(false);

        // hash and clone agree
        const copy = game.clone(board);
        expect(copy).not.toBe(board);
        expect(game.hash(copy)).toBe(game.hash(board));
        expect(game.view(copy)).toEqual(view);

        // targets are real piles, and every one of them actually moves
        for (const { pile, index } of pickables(view)) {
          expect(game.canPickUp(board, pile, index, NO_TWISTS)).toBe(true);
          const targets = game.legalTargets(board, pile, index, NO_TWISTS);
          expect(new Set(targets).size).toBe(targets.length);
          for (const to of targets) {
            expect(ids).toContain(to);
            expect(to).not.toBe(pile);
            const r = game.move(board, pile, index, to, NO_TWISTS);
            expect(r.changed).toBe(true);
            expect(r.board).not.toBe(board);
            expect(game.hash(r.board)).not.toBe(game.hash(board));
          }
          const auto = game.autoTarget(board, pile, index, NO_TWISTS);
          if (auto !== null) expect(targets).toContain(auto);
        }

        // the deal itself is untouched by all of that
        expect(game.hash(board)).toBe(game.hash(copy));
      }
    });

    it('refuses nonsense coordinates instead of throwing', () => {
      const board = game.deal(mulberry32(7), {}, NO_TWISTS);
      const bad: [string, number][] = [
        ['nope', 0],
        ['stock', -1],
        ['t0', 999],
        ['t0', 1.5]
      ];
      for (const [pile, index] of bad) {
        expect(game.canPickUp(board, pile, index, NO_TWISTS)).toBe(false);
        expect(game.legalTargets(board, pile, index, NO_TWISTS)).toEqual([]);
        expect(game.autoTarget(board, pile, index, NO_TWISTS)).toBeNull();
        const r = game.move(board, pile, index, 'f0', NO_TWISTS);
        expect(r.changed).toBe(false);
        expect(r.board).toBe(board);
      }
    });

    it('never mutates the board it is handed', () => {
      const board = game.deal(mulberry32(3), {}, NO_TWISTS);
      const before = game.hash(board);
      const view = game.view(board);
      for (const { pile, index } of pickables(view)) {
        for (const to of game.legalTargets(board, pile, index, NO_TWISTS)) {
          game.move(board, pile, index, to, NO_TWISTS);
        }
      }
      game.draw(board, NO_TWISTS);
      expect(game.hash(board)).toBe(before);
    });
  }
);
