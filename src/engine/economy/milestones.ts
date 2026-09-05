/**
 * Lifetime-shuffle milestones: the ledger (docs/02-game-design.md §1, brainstorming/milestones.md).
 * PURE.
 */
import { MILESTONES, type MilestoneDef } from '$content/index';
import { D } from '../numbers';
import type { EventBus } from '../events';
import type { GameState } from '../state';

const SORTED: readonly MilestoneDef[] = [...MILESTONES].sort((a, b) => D(a.value).cmp(D(b.value)));

/** Emits `milestone` for each newly-passed milestone, in ascending order, exactly once ever. */
export function checkMilestones(state: GameState, bus: EventBus): void {
  for (const m of SORTED) {
    if (state.milestones.includes(m.id)) continue;
    if (state.lifetimeShuffles.gte(m.value)) {
      state.milestones.push(m.id);
      bus.emit({ type: 'milestone', id: m.id, value: m.value });
    }
  }
}

/** The smallest not-yet-passed milestone, or undefined once all are passed. */
export function nextMilestone(state: GameState): MilestoneDef | undefined {
  return SORTED.find((m) => !state.milestones.includes(m.id));
}
