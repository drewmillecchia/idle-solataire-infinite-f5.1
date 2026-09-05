/**
 * The Numbering ladder: numbering systems as a purchase (docs/02-game-design.md §3, §6). PURE.
 *
 * Systems are bought with the spendable balance `prestige.permutations`; `lifetimePermutations` is
 * never touched here, so spending can never lower the rate (CLAUDE.md invariant #4, the same rule
 * the Constellation follows for Cuts). Unlocks are PERMANENT: `unlockedNumberings` survives every
 * reset, like `revealed` and `milestones`.
 *
 * Selecting a system is free and instant. Every system is normalized to the same 13-rank total
 * (91), so a switch redistributes value across the ranks rather than adding any: which one wins
 * depends on which cards are awake, charged and marked. That is the whole point of the ladder, and
 * it is why `numberingOptions` hands the UI the shape.
 */
import type Decimal from 'break_eternity.js';
import { NUMBERING_LADDER, type NumberingLadderEntry } from '$content/index';
import { D } from '../numbers';
import { NUMBERING_ORDER, numberingLabel, rankValue } from '../numbering';
import type { EventBus } from '../events';
import type { GameState } from '../state';
import type { NumberingId, Rank } from '../types';

/** The ladder rung for `id`, or undefined for `natural` (free from the first deal) / an unknown id. */
export function numberingEntry(id: NumberingId): NumberingLadderEntry | undefined {
  return NUMBERING_LADDER.find((e) => e.id === id);
}

/** Cost in Permutations. `natural` costs nothing; it is never on the ladder. */
export function numberingCost(id: NumberingId): Decimal {
  const entry = numberingEntry(id);
  return entry ? D(entry.cost) : D(0);
}

export function isNumberingUnlocked(state: GameState, id: NumberingId): boolean {
  return id === 'natural' || state.unlockedNumberings.includes(id);
}

/** Buyable when it is on the ladder, not already owned, and the BALANCE covers it. */
export function canUnlockNumbering(state: GameState, id: NumberingId): boolean {
  const entry = numberingEntry(id);
  if (!entry) return false;
  if (isNumberingUnlocked(state, id)) return false;
  return D(entry.cost).lte(state.prestige.permutations);
}

/** Buys a system, spending the Permutations BALANCE. Returns whether the purchase happened. */
export function unlockNumbering(state: GameState, bus: EventBus, id: NumberingId): boolean {
  if (!canUnlockNumbering(state, id)) return false;
  state.prestige.permutations = state.prestige.permutations.minus(numberingCost(id));
  state.unlockedNumberings.push(id);
  bus.emit({ type: 'purchase', id: `numbering:${id}`, count: 1 });
  return true;
}

/** Switches the active system. Free, but it must be unlocked. Returns whether it switched. */
export function selectNumbering(state: GameState, id: NumberingId): boolean {
  if (!isNumberingUnlocked(state, id)) return false;
  state.numbering = id;
  return true;
}

/** Systems the player owns, in ladder order (`natural` first). */
export function unlockedNumberings(state: GameState): NumberingId[] {
  return NUMBERING_ORDER.filter((id) => isNumberingUnlocked(state, id));
}

export interface NumberingOption {
  id: NumberingId;
  name: string;
  /** Empty for `natural`, which has no ladder entry. */
  blurb: string;
  /** Cost in Permutations; 0 for `natural`. */
  cost: Decimal;
  unlocked: boolean;
  selected: boolean;
  /** Whether the balance covers it right now (false when already unlocked). */
  affordable: boolean;
  /** The 13 normalized rank values, rank 1 first. They sum to 91 for every system. */
  values: number[];
}

const NATURAL_BLURB = 'Ace is one, King is thirteen. The shape everyone starts with.';

const RANKS_1_13 = Array.from({ length: 13 }, (_, i) => (i + 1) as Rank);

/** The whole ladder for the UI: state, price and the per-rank shape of every system. */
export function numberingOptions(state: GameState): NumberingOption[] {
  return NUMBERING_ORDER.map((id) => {
    const entry = numberingEntry(id);
    const unlocked = isNumberingUnlocked(state, id);
    return {
      id,
      name: numberingLabel(id),
      blurb: entry?.blurb ?? NATURAL_BLURB,
      cost: numberingCost(id),
      unlocked,
      selected: state.numbering === id,
      affordable: canUnlockNumbering(state, id),
      values: RANKS_1_13.map((r) => rankValue(id, r).toNumber())
    };
  });
}
