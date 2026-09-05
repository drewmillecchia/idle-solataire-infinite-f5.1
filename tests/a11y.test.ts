import { describe, expect, it } from 'vitest';
import { NO_TWISTS } from '../src/rules/module';
import { dealKlondike, klondike } from '../src/rules/games/klondike';
import { describeBoard, describeCard, describePile } from '../src/ui/a11yModel';
import type { BoardView, PileView } from '../src/rules/module';

function emptyPile(kind: PileView['kind'], id = 'p'): PileView {
  return { id, kind, x: 0, y: 0, fan: 'none', cards: [] };
}

describe('describeCard', () => {
  it('names the first and last card of the deck', () => {
    expect(describeCard(0)).toBe('Ace of spades');
    expect(describeCard(51)).toBe('King of clubs');
  });
  it('names a middle card', () => {
    // id 13 = suit index 1 (H) * 13 + (rank 1 - 1) => Ace of hearts
    expect(describeCard(13)).toBe('Ace of hearts');
  });
});

describe('describePile', () => {
  it('reads "empty" for an empty pile', () => {
    expect(describePile(emptyPile('tableau'))).toBe('empty');
    expect(describePile(emptyPile('foundation'))).toBe('empty');
  });
  it('describes an all-face-down pile as N cards face down', () => {
    const p: PileView = { id: 'stock', kind: 'stock', x: 0, y: 0, fan: 'none', cards: Array.from({ length: 24 }, (_, i) => ({ id: i, faceUp: false })) };
    expect(describePile(p)).toBe('24 cards face down');
  });
  it('describes a pile with a face-up top card', () => {
    const p: PileView = { id: 't0', kind: 'tableau', x: 0, y: 0, fan: 'down', cards: [{ id: 12, faceUp: true }] };
    expect(describePile(p)).toBe('1 card, King of spades');
  });
});

describe('describeBoard', () => {
  const board = dealKlondike(7, {}, NO_TWISTS);
  const view: BoardView = klondike.view(board);

  it('mentions the game name', () => {
    expect(describeBoard(view, 'Klondike')).toMatch(/^Klondike\./);
  });

  it('mentions the stock count', () => {
    const desc = describeBoard(view, 'Klondike');
    expect(desc).toMatch(/Stock: \d+ cards? face down\./);
  });

  it('mentions every tableau column', () => {
    const desc = describeBoard(view, 'Klondike');
    for (let i = 1; i <= 7; i++) expect(desc).toContain(`Column ${i}:`);
  });

  it('describes a freshly dealt board as having empty foundations', () => {
    const desc = describeBoard(view, 'Klondike');
    expect(desc).toContain('Foundations: empty.');
  });

  it('says the foundations are complete on a won board', () => {
    const won: BoardView = {
      cols: 7,
      rows: 4,
      piles: [
        emptyPile('stock', 'stock'),
        emptyPile('waste', 'waste'),
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `f${i}`,
          kind: 'foundation' as const,
          x: i,
          y: 0,
          fan: 'none' as const,
          cards: Array.from({ length: 13 }, (_, r) => ({ id: i * 13 + r, faceUp: true }))
        })),
        ...Array.from({ length: 7 }, (_, i) => emptyPile('tableau', `t${i}`))
      ]
    };
    const desc = describeBoard(won, 'Klondike');
    expect(desc.toLowerCase()).toContain('complete');
  });
});
