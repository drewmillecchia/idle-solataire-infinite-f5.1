import { describe, it, expect } from 'vitest';
import { layoutBoard, rectContains, rectDistance } from '../src/table/layout';
import type { BoardView } from '../src/rules/module';

const view: BoardView = {
  cols: 7,
  rows: 4.6,
  piles: [
    { id: 'stock', kind: 'stock', x: 0, y: 0, fan: 'none', cards: [{ id: 1, faceUp: false }, { id: 2, faceUp: false }] },
    { id: 't0', kind: 'tableau', x: 0, y: 1.25, fan: 'down', cards: [{ id: 3, faceUp: false }, { id: 4, faceUp: false }, { id: 5, faceUp: true }, { id: 6, faceUp: true }], pickableFrom: 2 },
    { id: 'f0', kind: 'foundation', x: 3, y: 0, fan: 'none', cards: [] }
  ]
};

describe('layoutBoard', () => {
  it('fits the grid inside the felt with the card aspect preserved', () => {
    const l = layoutBoard(view, 900, 620);
    expect(l.cardW).toBeGreaterThan(50);
    expect(Math.abs(l.cardW / l.cardH - 0.7)).toBeLessThan(0.02);
    const right = l.offsetX + 7 * l.cardW + 6 * l.gapX;
    expect(right).toBeLessThanOrEqual(900);
    expect(l.offsetY + 4.6 * l.cardH).toBeLessThanOrEqual(620 + 1);
  });
  it('fanned pile extent spans the whole occupied height (not just the origin)', () => {
    const l = layoutBoard(view, 900, 620);
    const t0 = l.piles.get('t0')!;
    expect(t0.extent.h).toBeGreaterThan(l.cardH * 1.5);
    const last = t0.cardPos(3);
    expect(rectContains(t0.extent, last.x + 5, last.y + l.cardH - 5)).toBe(true);
    // face-down cards are tighter than face-up ones
    const d01 = t0.cardPos(1).y - t0.cardPos(0).y;
    const d23 = t0.cardPos(3).y - t0.cardPos(2).y;
    expect(d23).toBeGreaterThan(d01);
  });
  it('empty pile extent is one card', () => {
    const l = layoutBoard(view, 900, 620);
    const f0 = l.piles.get('f0')!;
    expect(f0.extent.w).toBe(l.cardW);
    expect(f0.extent.h).toBe(l.cardH);
    expect(rectDistance(f0.extent, f0.x - 10, f0.y)).toBeCloseTo(10);
  });
  it('is wider-limited on a wide felt and height-limited on a short one', () => {
    const wide = layoutBoard(view, 2000, 400);
    const tall = layoutBoard(view, 500, 2000);
    expect(wide.offsetY).toBeLessThan(40);
    expect(tall.offsetX).toBeLessThan(40);
  });
});
