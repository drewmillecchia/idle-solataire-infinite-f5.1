/**
 * Generic greedy autoplay. Knows no game: it reads only the GameModule contract and BoardView, so
 * every registry entry gets autoplay for free. PURE — no DOM, no timers, no engine state.
 *
 * Priority: foundation > a move that uncovers a face-down card > any other move > draw.
 * Candidates whose resulting board hash is already in `seen` are skipped, which is what keeps the
 * driver out of A→B→A shuffles and guarantees termination.
 *
 * Two candidates are refused outright, both read off BoardView so they stay game-agnostic:
 *  - anything picked up off a foundation — autoplay never un-homes a card;
 *  - a whole face-up stack with nothing face-down beneath it moved into an empty pile — legal, but it
 *    reveals nothing and only feeds the shuffle.
 * Without them the driver drowns in reversible tableau shuffles: on Klondike seeds 1-60 it wins
 * 0/60 and burns the step budget on 46 of them; with them, 22/60 in ~250 steps.
 */
import type { GameModule, Twists } from './module';

export interface AutoMove {
  kind: 'move';
  pile: string;
  index: number;
  to: string;
}
export interface AutoDraw {
  kind: 'draw';
}
export type AutoStep = AutoMove | AutoDraw;

/** Lower sorts first. */
const PRI_FOUNDATION = 0;
const PRI_FLIP = 1;
const PRI_OTHER = 2;

export function nextMove<B>(
  module: GameModule<B>,
  board: B,
  twists: Twists,
  seen: Set<string>
): AutoStep | null {
  const view = module.view(board);
  const kindOf = new Map(view.piles.map((p) => [p.id, p.kind]));
  const sizeOf = new Map(view.piles.map((p) => [p.id, p.cards.length]));

  const candidates: { pri: number; pile: string; index: number; to: string }[] = [];
  for (const p of view.piles) {
    const from = p.pickableFrom;
    if (from === undefined) continue;
    if (p.kind === 'foundation') continue; // never take a card back off home
    const buried = p.kind === 'tableau' && p.cards.slice(0, from).some((c) => !c.faceUp);
    for (let i = from; i < p.cards.length; i++) {
      if (!module.canPickUp(board, p.id, i, twists)) continue;
      const whole = i === from;
      for (const to of module.legalTargets(board, p.id, i, twists)) {
        if (to === p.id) continue;
        const toFoundation = kindOf.get(to) === 'foundation';
        const uncovers = buried && whole;
        // Relocating a whole naked stack into an empty pile changes the picture without improving it.
        if (!toFoundation && p.kind === 'tableau' && whole && !buried && sizeOf.get(to) === 0) continue;
        const pri = toFoundation ? PRI_FOUNDATION : uncovers ? PRI_FLIP : PRI_OTHER;
        candidates.push({ pri, pile: p.id, index: i, to });
      }
    }
  }
  candidates.sort((a, b) => a.pri - b.pri);

  for (const c of candidates) {
    const r = module.move(board, c.pile, c.index, c.to, twists);
    if (!r.changed) continue;
    if (seen.has(module.hash(r.board))) continue;
    return { kind: 'move', pile: c.pile, index: c.index, to: c.to };
  }

  const d = module.draw(board, twists);
  if (d.changed && !seen.has(module.hash(d.board))) return { kind: 'draw' };

  return null;
}

export interface SolveResult<B> {
  won: boolean;
  steps: number;
  board: B;
}

/**
 * Play the greedy line until the hand is won, nothing new is reachable, or `maxSteps` is spent.
 * Terminates: every accepted step adds an unseen hash to `seen`, and `seen` only grows.
 */
export function solveGreedy<B>(
  module: GameModule<B>,
  board: B,
  twists: Twists,
  maxSteps = 2000
): SolveResult<B> {
  const seen = new Set<string>([module.hash(board)]);
  let current = board;
  let steps = 0;

  while (steps < maxSteps && !module.isWon(current)) {
    const step = nextMove(module, current, twists, seen);
    if (!step) break;
    const r =
      step.kind === 'draw'
        ? module.draw(current, twists)
        : module.move(current, step.pile, step.index, step.to, twists);
    if (!r.changed) break;
    const h = module.hash(r.board);
    if (seen.has(h)) break; // nextMove promised otherwise; refuse to loop regardless
    seen.add(h);
    current = r.board;
    steps++;
  }

  return { won: module.isWon(current), steps, board: current };
}
