/**
 * Run upgrades: cost curve, purchase, and reveal gating. PURE.
 */
import Decimal from 'break_eternity.js';
import { UPGRADES, type UpgradeDef } from '$content/index';
import { D } from '../numbers';
import type { EventBus } from '../events';
import type { GameState } from '../state';

function getUpgradeDef(id: string): UpgradeDef {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new RangeError(`unknown upgrade ${id}`);
  return def;
}

/** Sum of baseCost*growth^(owned..owned+count-1), the geometric series closed form. */
function costForRange(def: UpgradeDef, owned: number, count: number): Decimal {
  if (count <= 0) return D(0);
  const base = D(def.baseCost);
  const growth = def.growth;
  if (Math.abs(growth - 1) < 1e-12) {
    return base.times(count).times(Math.pow(growth, owned));
  }
  const g = D(growth);
  const startFactor = g.pow(owned);
  const seriesFactor = g.pow(count).minus(1).div(g.minus(1));
  return base.times(startFactor).times(seriesFactor);
}

/** Cost to buy `count` more levels of `id`, starting from the currently-owned level. */
export function upgradeCost(state: GameState, id: string, count = 1): Decimal {
  const def = getUpgradeDef(id);
  const owned = state.run.upgrades[id] ?? 0;
  return costForRange(def, owned, count);
}

function remainingCap(def: UpgradeDef, owned: number): number {
  return def.max == null ? Number.POSITIVE_INFINITY : Math.max(0, def.max - owned);
}

export function canBuy(state: GameState, id: string, count = 1): boolean {
  if (count <= 0) return false;
  const def = getUpgradeDef(id);
  const owned = state.run.upgrades[id] ?? 0;
  if (count > remainingCap(def, owned)) return false;
  return upgradeCost(state, id, count).lte(state.shuffles);
}

/** Buys `count` levels if affordable and within `max`. Returns whether the purchase happened. */
export function buyUpgrade(state: GameState, bus: EventBus, id: string, count = 1): boolean {
  if (!canBuy(state, id, count)) return false;
  const cost = upgradeCost(state, id, count);
  state.shuffles = state.shuffles.minus(cost);
  state.run.upgrades[id] = (state.run.upgrades[id] ?? 0) + count;
  bus.emit({ type: 'purchase', id, count });
  return true;
}

/** Largest count of `id` affordable right now, capped by `max`. */
export function maxAffordable(state: GameState, id: string): number {
  const def = getUpgradeDef(id);
  const owned = state.run.upgrades[id] ?? 0;
  const cap = remainingCap(def, owned);
  if (cap <= 0) return 0;
  if (!upgradeCost(state, id, 1).lte(state.shuffles)) return 0;

  const searchCap = Number.isFinite(cap) ? cap : 1_000_000;
  let lo = 1;
  let hi = 1;
  while (hi < searchCap && costForRange(def, owned, hi * 2).lte(state.shuffles)) {
    hi *= 2;
  }
  hi = Math.min(hi * 2, searchCap);

  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (costForRange(def, owned, mid).lte(state.shuffles)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Upgrades currently visible: already-revealed ones, plus any whose gate now passes (which are
 * recorded into `state.revealed` so they never hide again).
 *
 * Pass `bus` to have first visibility emit `{ type: 'reveal', feature: 'upgrade:<id>' }` — that is
 * what the "reveals in the first minute" pacing budget counts (docs/02-game-design.md 9).
 */
export function visibleUpgrades(state: GameState, bus?: EventBus): UpgradeDef[] {
  const awakeCount = state.cards.reduce((n, c) => (c.awake ? n + 1 : n), 0);
  const result: UpgradeDef[] = [];

  for (const def of UPGRADES) {
    if (state.revealed.includes(def.id)) {
      result.push(def);
      continue;
    }
    const gate = def.revealAfter;
    let unlocked = true;
    if (gate) {
      if (gate.awake != null && awakeCount < gate.awake) unlocked = false;
      if (gate.homed != null && state.run.homedThisRun < gate.homed) unlocked = false;
      if (gate.lifetimeShuffles != null && state.lifetimeShuffles.lt(gate.lifetimeShuffles)) {
        unlocked = false;
      }
    }
    if (unlocked) {
      state.revealed.push(def.id);
      bus?.emit({ type: 'reveal', feature: `upgrade:${def.id}` });
      result.push(def);
    }
  }
  return result;
}
