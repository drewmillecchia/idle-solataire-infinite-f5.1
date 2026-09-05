import type { BoardView, PileView } from '$rules/module';
import { CARD_ASPECT, FAN_UP, FAN_DOWN, FAN_SIDE } from '$rules/module';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PileLayout {
  pile: PileView;
  /** Origin (top-left) of the pile slot in felt pixels. */
  x: number;
  y: number;
  /** Position of card i in felt pixels (top-left). */
  cardPos: (i: number) => { x: number; y: number };
  /** Whole occupied extent, used for drop hit-testing (lesson: never just the origin). */
  extent: Rect;
}

export interface Layout {
  cardW: number;
  cardH: number;
  gapX: number;
  gapY: number;
  offsetX: number;
  offsetY: number;
  piles: Map<string, PileLayout>;
}

/**
 * Fit a BoardView grid (cols × rows in card units) into a felt of feltW × feltH px with padding.
 * Reserves extra vertical room for fanned tableau columns.
 */
export function layoutBoard(view: BoardView, feltW: number, feltH: number, pad = 18): Layout {
  const gapRatio = 0.14; // gap as a fraction of card width
  // Tallest fanned pile in card-heights: rows already includes some fan allowance from the module.
  const unitsX = view.cols + (view.cols - 1) * gapRatio;
  const unitsY = view.rows;
  const cardWFromW = (feltW - pad * 2) / unitsX;
  const cardWFromH = (feltH - pad * 2) / unitsY * CARD_ASPECT;
  const cardW = Math.floor(Math.min(cardWFromW, cardWFromH));
  const cardH = Math.floor(cardW / CARD_ASPECT);
  const gapX = cardW * gapRatio;
  const gapY = gapX;
  const usedW = view.cols * cardW + (view.cols - 1) * gapX;
  const usedH = view.rows * cardH;
  const offsetX = Math.floor((feltW - usedW) / 2);
  const offsetY = Math.floor(Math.max(pad, (feltH - usedH) / 2));

  const piles = new Map<string, PileLayout>();
  for (const pile of view.piles) {
    const x = offsetX + pile.x * (cardW + gapX);
    const y = offsetY + pile.y * (cardH + gapY);
    const cardPos = (i: number) => {
      if (pile.fan === 'none') return { x, y };
      if (pile.fan === 'right') {
        // Show at most the top 3 fanned (draw-3 waste); earlier cards sit under the first.
        const visibleStart = Math.max(0, pile.cards.length - 3);
        const k = Math.max(0, i - visibleStart);
        return { x: x + k * cardW * FAN_SIDE, y };
      }
      // 'down' / 'down-tight': face-down cards tighter than face-up.
      let dy = 0;
      for (let j = 0; j < i; j++) {
        const c = pile.cards[j];
        dy += (c && c.faceUp ? FAN_UP : FAN_DOWN) * cardH * (pile.fan === 'down-tight' ? 0.6 : 1);
      }
      return { x, y: y + dy };
    };
    const n = pile.cards.length;
    const last = n > 0 ? cardPos(n - 1) : { x, y };
    const extent: Rect = { x, y, w: last.x + cardW - x, h: last.y + cardH - y };
    piles.set(pile.id, { pile, x, y, cardPos, extent });
  }
  return { cardW, cardH, gapX, gapY, offsetX, offsetY, piles };
}

export function rectContains(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Distance from a point to a rect (0 when inside). */
export function rectDistance(r: Rect, px: number, py: number): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}
