import { describe, it, expect } from 'vitest';
import { layoutBoard } from '../src/table/layout';
import type { BoardView, BoardCardView } from '../src/rules/module';

const col = (n: number, faceUp = true): BoardCardView[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, faceUp }));

const viewWith = (n: number): BoardView => ({
  cols: 8,
  rows: 5.2,
  piles: [
    { id: 'c0', kind: 'cell', x: 0, y: 0, fan: 'none', cards: [] },
    { id: 't0', kind: 'tableau', x: 0, y: 1.25, fan: 'down', cards: col(n), pickableFrom: 0 }
  ]
});

describe('fan compression', () => {
  it('leaves a pile that fits alone', () => {
    const l = layoutBoard(viewWith(7), 1000, 620);
    const gap = l.piles.get('t0')!.cardPos(1).y - l.piles.get('t0')!.cardPos(0).y;
    expect(gap).toBeCloseTo(0.28 * l.cardH, 1);
  });

  it('tightens a pile that would run off the felt, and keeps it on the felt', () => {
    const l = layoutBoard(viewWith(24), 1000, 620);
    const p = l.piles.get('t0')!;
    const gap = p.cardPos(1).y - p.cardPos(0).y;
    expect(gap).toBeLessThan(0.28 * l.cardH);
    expect(p.cardPos(23).y + l.cardH).toBeLessThanOrEqual(620);
  });

  it('never squeezes past the readable floor', () => {
    const l = layoutBoard(viewWith(60), 1000, 620);
    const p = l.piles.get('t0')!;
    const gap = p.cardPos(1).y - p.cardPos(0).y;
    expect(gap).toBeGreaterThanOrEqual(0.28 * l.cardH * 0.28 - 0.001);
  });

  it('does not touch piles that do not fan down', () => {
    const l = layoutBoard(viewWith(24), 1000, 620);
    const c0 = l.piles.get('c0')!;
    expect(c0.cardPos(0)).toEqual({ x: c0.x, y: c0.y });
  });

  it('the extent still spans the whole occupied height after compression', () => {
    const l = layoutBoard(viewWith(24), 1000, 620);
    const p = l.piles.get('t0')!;
    const last = p.cardPos(23);
    expect(p.extent.h).toBeCloseTo(last.y + l.cardH - p.y, 5);
  });
});
