/**
 * The live tick and its offline twin (docs/02-game-design.md §8; CLAUDE.md invariant #3).
 * `applyOffline` slices time and calls this same `step` — never a parallel formula.
 */
import type Decimal from 'break_eternity.js';
import { D } from './numbers';
import { derive } from './economy/derive';
import { checkMilestones } from './economy/milestones';
import { checkCutReveal } from './economy/prestige';
import type { EventBus } from './events';
import type { GameState } from './state';

export const TICK_HZ = 20;

/** Maximum number of equal slices `applyOffline` will split a gap into. */
const MAX_OFFLINE_STEPS = 600;

/** Advances the economy by `dtSeconds`. Never clamps `dtSeconds` — the host loop does that. */
export function step(state: GameState, dtSeconds: number, bus: EventBus): void {
  const d = derive(state);
  const delta = d.deckRate.times(dtSeconds);
  state.shuffles = state.shuffles.plus(delta);
  state.lifetimeShuffles = state.lifetimeShuffles.plus(delta);
  state.stats.playSeconds += dtSeconds;
  if (d.deckRate.gt(state.stats.bestRate)) {
    state.stats.bestRate = d.deckRate;
  }
  checkMilestones(state, bus);
  checkCutReveal(state, d, bus);
}

export interface OfflineResult {
  /** Seconds actually applied, after the offline cap. */
  seconds: number;
  /** Shuffles earned (lifetimeShuffles delta) over that span. */
  earned: Decimal;
}

/**
 * Applies an offline gap: caps it to the current offline cap, then replays it as up to
 * `MAX_OFFLINE_STEPS` equal calls to `step` (the same function the live loop uses).
 */
export function applyOffline(state: GameState, elapsedSeconds: number, bus: EventBus): OfflineResult {
  const cap = derive(state).offlineCapSeconds;
  const seconds = Math.max(0, Math.min(elapsedSeconds, cap));
  if (seconds <= 0) {
    return { seconds: 0, earned: D(0) };
  }

  const before = state.lifetimeShuffles;
  const stepCount = Math.min(MAX_OFFLINE_STEPS, Math.max(1, Math.ceil(seconds * TICK_HZ)));
  const dt = seconds / stepCount;
  for (let i = 0; i < stepCount; i++) {
    step(state, dt, bus);
  }
  const earned = state.lifetimeShuffles.minus(before);
  return { seconds, earned };
}
