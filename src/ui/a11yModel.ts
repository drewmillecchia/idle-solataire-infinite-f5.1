/**
 * Pure, Svelte-free helpers that turn a `BoardView` into words for the screen-reader layer
 * (`A11y.svelte`). No DOM, no host, no Svelte — testable in plain Node (see tests/a11y.test.ts).
 * Table accessibility per docs/03-decisions.md ADR-003: the canvas has none, so this text layer
 * is the whole of it.
 */
import type { CardId, Suit } from '$engine/types';
import { cardDef } from '$engine/types';
import type { BoardView, PileKind, PileView } from '$rules/module';

function suitName(suit: Suit): string {
  switch (suit) {
    case 'S': return 'spades';
    case 'H': return 'hearts';
    case 'D': return 'diamonds';
    case 'C': return 'clubs';
    default: return suit;
  }
}

function rankName(rank: number): string {
  switch (rank) {
    case 1: return 'Ace';
    case 11: return 'Jack';
    case 12: return 'Queen';
    case 13: return 'King';
    default: return String(rank);
  }
}

/** "Ace of spades", "King of clubs". */
export function describeCard(id: CardId): string {
  const def = cardDef(id);
  return `${rankName(def.rank)} of ${suitName(def.suit)}`;
}

function kindLabel(kind: PileKind): string {
  switch (kind) {
    case 'stock': return 'Stock';
    case 'waste': return 'Waste';
    case 'foundation': return 'Foundation';
    case 'tableau': return 'Column';
    case 'cell': return 'Cell';
    case 'peak': return 'Peak';
    case 'discard': return 'Discard';
    default: return 'Pile';
  }
}

function groupByKind(view: BoardView): Map<PileKind, PileView[]> {
  const groups = new Map<PileKind, PileView[]>();
  for (const p of view.piles) {
    const arr = groups.get(p.kind);
    if (arr) arr.push(p);
    else groups.set(p.kind, [p]);
  }
  return groups;
}

/** "Column 2" (or plain "Stock" when there is only one pile of that kind). Used for headings. */
export function pileLabel(view: BoardView, pileId: string): string {
  const groups = groupByKind(view);
  for (const piles of groups.values()) {
    const idx = piles.findIndex((p) => p.id === pileId);
    if (idx >= 0) return piles.length > 1 ? `${kindLabel(piles[0]!.kind)} ${idx + 1}` : kindLabel(piles[0]!.kind);
  }
  return pileId;
}

/**
 * One pile's contents in words: "empty", "24 cards face down", "1 card, King of spades",
 * "2 cards, 1 face down, 5 of hearts".
 */
export function describePile(pile: PileView): string {
  const total = pile.cards.length;
  if (total === 0) return 'empty';
  const faceDown = pile.cards.filter((c) => !c.faceUp).length;
  if (faceDown === total) return `${total} card${total === 1 ? '' : 's'} face down`;
  const parts: string[] = [`${total} card${total === 1 ? '' : 's'}`];
  if (faceDown > 0) parts.push(`${faceDown} face down`);
  const faceUp = pile.cards.filter((c) => c.faceUp);
  const top = faceUp[faceUp.length - 1];
  if (top && top.id !== null) parts.push(describeCard(top.id));
  return parts.join(', ');
}

/** A full deck's worth of foundation cards; "complete" once every pile reaches it. */
const FULL_SUIT = 13;

function describeFoundations(piles: PileView[]): string {
  if (piles.every((p) => p.cards.length >= FULL_SUIT)) return 'Foundations: complete.';
  const filled: string[] = [];
  let emptyCount = 0;
  for (const p of piles) {
    if (p.cards.length === 0) { emptyCount++; continue; }
    const top = p.cards[p.cards.length - 1];
    if (!top || top.id === null) { emptyCount++; continue; }
    const def = cardDef(top.id);
    filled.push(`${suitName(def.suit)} to ${rankName(def.rank)}`);
  }
  if (filled.length === 0) return 'Foundations: empty.';
  if (emptyCount > 0) return `Foundations: ${filled.join(', ')}, others empty.`;
  return `Foundations: ${filled.join(', ')}.`;
}

/**
 * One terse paragraph a screen reader can read start to finish: the game name, the stock and
 * waste, the foundations (grouped), then every other pile (columns, cells, peaks…) in board order.
 */
export function describeBoard(view: BoardView, gameName: string): string {
  const groups = groupByKind(view);
  const sentences: string[] = [`${gameName}.`];

  for (const p of groups.get('stock') ?? []) sentences.push(`${pileLabel(view, p.id)}: ${describePile(p)}.`);
  for (const p of groups.get('waste') ?? []) sentences.push(`${pileLabel(view, p.id)}: ${describePile(p)}.`);

  const foundations = groups.get('foundation') ?? [];
  if (foundations.length > 0) sentences.push(describeFoundations(foundations));

  for (const kind of ['tableau', 'cell', 'peak', 'discard'] as PileKind[]) {
    for (const p of groups.get(kind) ?? []) sentences.push(`${pileLabel(view, p.id)}: ${describePile(p)}.`);
  }

  return sentences.join(' ');
}
