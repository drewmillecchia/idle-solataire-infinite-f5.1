import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState } from '$engine/state';
import { cardId } from '$engine/types';
import { homeCard } from '$engine/economy/cards';
import { derive } from '$engine/economy/derive';
import { applyOffline, step, TICK_HZ } from '$engine/tick';
import { D } from '$engine/numbers';

function primedState() {
  const state = createInitialState(0);
  const bus = new EventBus();
  // Wake a handful of cards so deckRate is nonzero and stable across the test.
  for (const suit of ['S', 'H', 'D', 'C'] as const) {
    for (let rank = 1; rank <= 3; rank++) {
      homeCard(state, bus, cardId(suit, rank as 1 | 2 | 3), 'setup');
    }
  }
  return state;
}

describe('step', () => {
  it('accumulates shuffles at deckRate * dt and never clamps dt', () => {
    const state = primedState();
    const bus = new EventBus();
    const rate = derive(state).deckRate;
    const before = state.lifetimeShuffles;

    const hugeDt = 999; // step must not clamp this itself
    step(state, hugeDt, bus);

    const delta = state.lifetimeShuffles.minus(before);
    const expected = rate.times(hugeDt);
    expect(delta.minus(expected).abs().div(expected).toNumber()).toBeLessThan(1e-9);
    expect(state.stats.playSeconds).toBeCloseTo(hugeDt, 6);
  });

  it('tracks the best rate seen', () => {
    const state = primedState();
    const bus = new EventBus();
    const rate = derive(state).deckRate;
    step(state, 1, bus);
    expect(state.stats.bestRate.eq(rate)).toBe(true);
  });
});

describe('applyOffline', () => {
  it('matches live 20Hz stepping within 1e-9 relative, for the same elapsed time', () => {
    const live = primedState();
    const offline = primedState();
    const bus = new EventBus();

    const seconds = 100;
    const liveBefore = live.lifetimeShuffles;
    const liveSteps = seconds * TICK_HZ;
    for (let i = 0; i < liveSteps; i++) {
      step(live, 1 / TICK_HZ, bus);
    }
    const liveEarned = live.lifetimeShuffles.minus(liveBefore);

    const result = applyOffline(offline, seconds, bus);

    expect(result.seconds).toBeCloseTo(seconds, 9);
    const relError = result.earned.minus(liveEarned).abs().div(liveEarned).toNumber();
    expect(relError).toBeLessThan(1e-9);
  });

  it('caps elapsed time to the offline cap', () => {
    const state = primedState();
    const bus = new EventBus();
    const cap = derive(state).offlineCapSeconds;

    const result = applyOffline(state, cap * 10, bus);
    expect(result.seconds).toBeCloseTo(cap, 6);
  });

  it('returns zero for a non-positive gap', () => {
    const state = primedState();
    const bus = new EventBus();
    const result = applyOffline(state, 0, bus);
    expect(result.seconds).toBe(0);
    expect(result.earned.eq(0)).toBe(true);
  });

  it('reuses step and so also checks milestones', () => {
    const state = primedState();
    // Force lifetimeShuffles close to a milestone so a short offline period crosses it.
    state.lifetimeShuffles = D(999);
    state.shuffles = D(999);
    const bus = new EventBus();
    const events: string[] = [];
    bus.on((e) => {
      if (e.type === 'milestone') events.push(e.id);
    });
    applyOffline(state, 3600, bus);
    expect(events).toContain('thousand');
    expect(state.milestones).toContain('thousand');
  });
});
