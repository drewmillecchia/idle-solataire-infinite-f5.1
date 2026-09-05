/**
 * Placing and removing Marks (docs/02-game-design.md §4, ADR-006). PURE.
 *
 * `state.marks.placed` is the source of truth. `state.cards[i].marks` is a cache the renderer
 * reads; every function here that changes a placement rebuilds it with `syncMarkCache`, and the
 * save's repair pass rebuilds it too, so the cache can never drift from the truth.
 *
 * Placing is free and allowed at any moment: the host decides whether to offer it mid-hand.
 */
import { MARKS } from '$content/index';
import type { MarkDef } from '$content/index';
import type { EventBus } from '../events';
import type { GameState } from '../state';
import type { CardId } from '../types';
// Type-only (erased at compile time), so this is not a runtime import cycle with derive.
import type { Derived } from '../economy/derive';

/** Mark definition by id, or undefined for an unknown id. */
export function markDef(id: string): MarkDef | undefined {
  return MARKS.find((m) => m.id === id);
}

/** Defensive read: a save repaired from garbage can still be missing the whole branch. */
function placed(state: GameState): { mark: string; cards: CardId[] }[] {
  const list = state.marks?.placed;
  return Array.isArray(list) ? list : [];
}

/** Every card carrying `markId`, in placement order. */
export function cardsWithMark(state: GameState, markId: string): CardId[] {
  const out: CardId[] = [];
  for (const p of placed(state)) {
    if (p.mark === markId) out.push(...p.cards);
  }
  return out;
}

/** True when `card` carries `markId`. */
export function hasMark(state: GameState, card: CardId, markId: string): boolean {
  return placed(state).some((p) => p.mark === markId && p.cards.includes(card));
}

/** The mark ids on a card (at most one, but read as a list to match the renderer's cache). */
export function marksOnCard(state: GameState, card: CardId): string[] {
  return placed(state)
    .filter((p) => p.cards.includes(card))
    .map((p) => p.mark);
}

/** The first placement covering `card`, or undefined. Prefer `placementOf` when the mark is known. */
export function placementFor(state: GameState, card: CardId): { mark: string; cards: CardId[] } | undefined {
  return placed(state).find((p) => p.cards.includes(card));
}

/** The placement of a specific mark covering `card`, or undefined. */
export function placementOf(state: GameState, card: CardId, markId: string): { mark: string; cards: CardId[] } | undefined {
  return placed(state).find((p) => p.mark === markId && p.cards.includes(card));
}

/** The per-card rule (see canPlace): may `markId` join whatever `card` already carries? */
export function cardAccepts(state: GameState, card: CardId, markId: string): boolean {
  const existing = marksOnCard(state, card);
  if (existing.length === 0) return true;
  if (markId === 'twin') return !existing.includes('twin') && existing.length === 1;
  return existing.length === 1 && existing[0] === 'twin';
}

/** Rebuilds the `cards[i].marks` render cache from `state.marks.placed`. */
export function syncMarkCache(state: GameState): void {
  for (const card of state.cards) card.marks = [];
  for (const p of placed(state)) {
    for (const id of p.cards) {
      const c = state.cards[id];
      if (c) c.marks.push(p.mark);
    }
  }
}

// ---- slots -------------------------------------------------------------------------------

/**
 * Slots, from the raw Constellation count. Base 0: the first Cut opens the toy (+1), and the
 * Constellation's `markSlots` nodes add the rest. Split out so `derive` can compute the same
 * number in its one pass without building a `Derived` first.
 */
export function markSlotsFrom(state: GameState, constellationSlots: number): number {
  const opened = state.prestige.lifetimeCuts.gte(1) ? 1 : 0;
  return opened + Math.max(0, constellationSlots);
}

/** Total mark slots. Equal to `derived.markSlotsTotal`; this is where that number comes from. */
export function markSlots(state: GameState, derived: Derived): number {
  return markSlotsFrom(state, derived.markSlots);
}

/** Slots in use. A Twin pair costs ONE slot, so this counts placements, not cards. */
export function usedSlots(state: GameState): number {
  return placed(state).length;
}

// ---- availability ------------------------------------------------------------------------

/** True once lifetime Cuts have reached the mark's unlock. Availability never regresses. */
function unlocked(state: GameState, def: MarkDef): boolean {
  return state.prestige.lifetimeCuts.gte(def.unlockAtLifetimeCuts);
}

/**
 * Marks the player may place, unlock order preserved. Pass the bus to also announce any newly
 * available mark once (`reveal` with feature `mark:<id>`); `state.revealed` is the once-only guard.
 */
export function availableMarks(state: GameState, bus?: EventBus): MarkDef[] {
  const out = MARKS.filter((def) => unlocked(state, def));
  if (bus) {
    for (const def of out) {
      const feature = `mark:${def.id}`;
      if (state.revealed.includes(feature)) continue;
      state.revealed.push(feature);
      bus.emit({ type: 'reveal', feature });
    }
  }
  return out;
}

/** Announces every newly available mark. Called on `cut` by the interpreter; safe to call often. */
export function revealAvailableMarks(state: GameState, bus: EventBus): void {
  availableMarks(state, bus);
}

// ---- placing -----------------------------------------------------------------------------

/**
 * Can `markId` go on exactly these cards right now? Checks unlock, arity, distinctness, the
 * per-card rule, and that a slot is free.
 *
 * Per-card rule: a card carries at most ONE mark — except Twin, which is the wire: a Twin may share
 * a card with one other mark (so Twin + Kindling on the same card is the canonical first combo), but
 * never with a second Twin.
 */
export function canPlace(state: GameState, derived: Derived, markId: string, cards: CardId[]): boolean {
  const def = markDef(markId);
  if (!def) return false;
  if (!unlocked(state, def)) return false;
  if (cards.length !== def.arity) return false;
  if (new Set(cards).size !== cards.length) return false;
  for (const id of cards) {
    if (!Number.isInteger(id) || id < 0 || id >= state.cards.length) return false;
    if (!cardAccepts(state, id, def.id)) return false;
  }
  return usedSlots(state) + 1 <= markSlots(state, derived);
}

/**
 * Places a mark. Free, and legal at any time. Emits `purchase` with id `mark:<markId>` so the
 * ledger and sound presenters need no new event kind. Returns false and changes nothing if the
 * placement is illegal.
 */
export function placeMark(
  state: GameState,
  bus: EventBus,
  derived: Derived,
  markId: string,
  cards: CardId[]
): boolean {
  if (!canPlace(state, derived, markId, cards)) return false;
  state.marks.placed.push({ mark: markId, cards: [...cards] });
  syncMarkCache(state);
  bus.emit({ type: 'purchase', id: `mark:${markId}`, count: 1 });
  return true;
}

/**
 * Removes a placement. With `card`, removes only the placement of that mark covering that card —
 * so removing either half of a Twin removes the pair. Without it, removes every placement of the
 * mark. Returns true if anything was removed.
 */
export function removeMark(state: GameState, markId: string, card?: CardId): boolean {
  const list = state.marks.placed;
  const keep = list.filter(
    (p) => p.mark !== markId || (card !== undefined && !p.cards.includes(card))
  );
  if (keep.length === list.length) return false;
  state.marks.placed = keep;
  syncMarkCache(state);
  return true;
}

/** Removes every placement covering `card` (a Twin pair included). */
export function clearCard(state: GameState, card: CardId): boolean {
  let any = false;
  for (let guard = 0; guard < 4; guard++) {
    const p = placementFor(state, card);
    if (!p) break;
    any = removeMark(state, p.mark, card) || any;
  }
  return any;
}
