/**
 * The Constellation: the permanent tree bought with Cuts (docs/02-game-design.md 6). PURE.
 *
 * Nodes are bought with the spendable balance `prestige.cuts`. `prestige.lifetimeCuts` is never
 * touched here, so spending can never lower the rate (CLAUDE.md invariant #4). Node effects are
 * applied in derive.ts and nowhere else (invariant #2); the one exception is `wayUnlock`, which is
 * a state change at purchase time rather than a multiplier.
 */
import type Decimal from 'break_eternity.js';
import { CONSTELLATION, type ConstellationNodeDef } from '$content/index';
import { D } from '../numbers';
import type { EventBus } from '../events';
import type { GameState } from '../state';

function getNodeDef(id: string): ConstellationNodeDef {
  const def = CONSTELLATION.find((n) => n.id === id);
  if (!def) throw new RangeError(`unknown constellation node ${id}`);
  return def;
}

export function nodeLevel(state: GameState, id: string): number {
  return state.prestige.constellation[id] ?? 0;
}

/**
 * Cost of the NEXT level of `id`: `ceil(cost * growth^level)`. Cuts are whole (`cutsOnCut` floors),
 * so node prices are whole too — and the ceiling also keeps float drift from making a node the
 * player can exactly afford cost 8.000000001.
 */
export function nodeCost(state: GameState, id: string): Decimal {
  const def = getNodeDef(id);
  return D(def.cost).times(Math.pow(def.growth, nodeLevel(state, id))).ceil();
}

/** Whether every prerequisite node is owned at level >= 1. */
export function requirementsMet(state: GameState, id: string): boolean {
  return getNodeDef(id).requires.every((req) => nodeLevel(state, req) >= 1);
}

export function canBuyNode(state: GameState, id: string): boolean {
  const def = getNodeDef(id);
  const level = nodeLevel(state, id);
  if (level >= def.max) return false;
  if (!requirementsMet(state, id)) return false;
  return nodeCost(state, id).lte(state.prestige.cuts);
}

/** Buys one level, spending the Cuts BALANCE. Returns whether the purchase happened. */
export function buyNode(state: GameState, bus: EventBus, id: string): boolean {
  if (!canBuyNode(state, id)) return false;
  const def = getNodeDef(id);
  const cost = nodeCost(state, id);
  state.prestige.cuts = state.prestige.cuts.minus(cost);
  state.prestige.constellation[id] = nodeLevel(state, id) + 1;
  if (def.effect.kind === 'wayUnlock' && !state.prestige.waysUnlocked.includes(def.effect.way)) {
    state.prestige.waysUnlocked.push(def.effect.way);
  }
  bus.emit({ type: 'purchase', id, count: 1 });
  return true;
}

/** Nodes whose prerequisites are met, plus any already owned. Nothing is ever re-hidden. */
export function visibleNodes(state: GameState): ConstellationNodeDef[] {
  return CONSTELLATION.filter((n) => nodeLevel(state, n.id) > 0 || requirementsMet(state, n.id));
}

/** Every node, for a tree view that greys out what is not yet reachable. */
export function allNodes(): ConstellationNodeDef[] {
  return CONSTELLATION;
}
