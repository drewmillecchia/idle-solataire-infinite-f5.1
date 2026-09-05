/**
 * The Numbering ladder: numbering systems bought with Permutations (docs/02-game-design.md §3).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, type GameState } from '$engine/state';
import type { GameEvent } from '$engine/types';
import { D } from '$engine/numbers';
import { NUMBERING_ORDER } from '$engine/numbering';
import { derive } from '$engine/economy/derive';
import { NUMBERING_LADDER } from '$content/index';
import {
  canUnlockNumbering,
  isNumberingUnlocked,
  numberingCost,
  numberingEntry,
  numberingOptions,
  selectNumbering,
  unlockNumbering,
  unlockedNumberings
} from '$engine/economy/numberingLadder';
import { deserialize, serialize } from '$engine/save/serialize';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

function withPermutations(n: number): GameState {
  const state = createInitialState(0);
  state.prestige.permutations = D(n);
  state.prestige.lifetimePermutations = D(n);
  return state;
}

describe('the ladder content', () => {
  it('is the six systems past natural, in NUMBERING_ORDER, at rising prices', () => {
    expect(NUMBERING_LADDER.map((e) => e.id)).toEqual(NUMBERING_ORDER.slice(1));
    for (let i = 1; i < NUMBERING_LADDER.length; i++) {
      const prev = NUMBERING_LADDER[i - 1];
      const here = NUMBERING_LADDER[i];
      expect(D(here?.cost ?? '0').gt(D(prev?.cost ?? '0'))).toBe(true);
    }
  });

  it('has no entry for natural, which is free from the first deal', () => {
    expect(numberingEntry('natural')).toBeUndefined();
    expect(numberingCost('natural').toNumber()).toBe(0);
    expect(isNumberingUnlocked(createInitialState(0), 'natural')).toBe(true);
  });
});

describe('unlocking', () => {
  it('needs the balance to cover the cost', () => {
    const state = withPermutations(0);
    expect(canUnlockNumbering(state, 'prime')).toBe(false);
    expect(unlockNumbering(state, new EventBus(), 'prime')).toBe(false);
    expect(state.unlockedNumberings).toEqual(['natural']);

    state.prestige.permutations = numberingCost('prime');
    expect(canUnlockNumbering(state, 'prime')).toBe(true);
  });

  it('spends the balance and never the lifetime (invariant #4)', () => {
    const state = withPermutations(50);
    const { bus, events } = withBus();
    const cost = numberingCost('fibonacci');

    expect(unlockNumbering(state, bus, 'fibonacci')).toBe(true);

    expect(state.prestige.permutations.eq(D(50).minus(cost))).toBe(true);
    expect(state.prestige.lifetimePermutations.toNumber()).toBe(50);
    expect(state.unlockedNumberings).toContain('fibonacci');
    expect(events).toContainEqual({ type: 'purchase', id: 'numbering:fibonacci', count: 1 });
  });

  it('cannot be bought twice, or refunded by re-buying', () => {
    const state = withPermutations(50);
    const { bus } = withBus();
    unlockNumbering(state, bus, 'prime');
    const after = state.prestige.permutations;
    expect(canUnlockNumbering(state, 'prime')).toBe(false);
    expect(unlockNumbering(state, bus, 'prime')).toBe(false);
    expect(state.prestige.permutations.eq(after)).toBe(true);
    expect(state.unlockedNumberings.filter((n) => n === 'prime')).toHaveLength(1);
  });

  it('never sells natural', () => {
    const state = withPermutations(50);
    expect(canUnlockNumbering(state, 'natural')).toBe(false);
    expect(unlockNumbering(state, new EventBus(), 'natural')).toBe(false);
    expect(state.prestige.permutations.toNumber()).toBe(50);
  });

  it('survives a save round-trip, because unlocks are permanent', () => {
    const state = withPermutations(50);
    unlockNumbering(state, new EventBus(), 'powers');
    selectNumbering(state, 'powers');
    const restored = deserialize(serialize(state));
    expect(restored.unlockedNumberings).toContain('powers');
    expect(restored.numbering).toBe('powers');
  });
});

describe('selecting', () => {
  it('requires the system to be unlocked, and is free', () => {
    const state = withPermutations(50);
    expect(selectNumbering(state, 'tetration')).toBe(false);
    expect(state.numbering).toBe('natural');

    unlockNumbering(state, new EventBus(), 'tetration');
    const balance = state.prestige.permutations;
    expect(selectNumbering(state, 'tetration')).toBe(true);
    expect(state.numbering).toBe('tetration');
    expect(state.prestige.permutations.eq(balance)).toBe(true);
  });

  it('redistributes the deck rather than inflating it', () => {
    const state = withPermutations(50);
    for (const card of state.cards) card.awake = true;
    const naturalRate = derive(state).deckRate;
    unlockNumbering(state, new EventBus(), 'powers');
    selectNumbering(state, 'powers');
    // Every system is normalized to the same 13-rank total, so a flat, uncharged deck earns the
    // same under all of them. Switching only pays once charge and marks are uneven.
    expect(derive(state).deckRate.div(naturalRate).toNumber()).toBeCloseTo(1, 6);
  });

  it('lists what is owned in ladder order', () => {
    const state = withPermutations(50);
    unlockNumbering(state, new EventBus(), 'fibonacci');
    unlockNumbering(state, new EventBus(), 'prime');
    expect(unlockedNumberings(state)).toEqual(['natural', 'prime', 'fibonacci']);
  });
});

describe('numberingOptions (what the UI draws)', () => {
  it('offers all seven systems with state, price and shape', () => {
    const state = withPermutations(3);
    const opts = numberingOptions(state);
    expect(opts.map((o) => o.id)).toEqual([...NUMBERING_ORDER]);

    const natural = opts[0];
    expect(natural?.unlocked).toBe(true);
    expect(natural?.selected).toBe(true);
    expect(natural?.cost.toNumber()).toBe(0);

    const prime = opts.find((o) => o.id === 'prime');
    expect(prime?.unlocked).toBe(false);
    expect(prime?.affordable).toBe(true);
    expect(prime?.blurb.length).toBeGreaterThan(0);

    const tetration = opts.find((o) => o.id === 'tetration');
    expect(tetration?.affordable).toBe(false);
  });

  it('normalizes every shape to 91, so switching redistributes value', () => {
    for (const opt of numberingOptions(createInitialState(0))) {
      expect(opt.values).toHaveLength(13);
      const total = opt.values.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(91, 4);
      for (const v of opt.values) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws natural as the straight line and tetration as one spike', () => {
    const opts = numberingOptions(createInitialState(0));
    const natural = opts.find((o) => o.id === 'natural');
    expect(natural?.values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

    const tetration = opts.find((o) => o.id === 'tetration');
    expect(tetration?.values[12]).toBeCloseTo(91, 4);
    expect(tetration?.values[0]).toBeLessThan(1e-6);
  });

  it('tracks the selection', () => {
    const state = withPermutations(50);
    unlockNumbering(state, new EventBus(), 'triangular');
    selectNumbering(state, 'triangular');
    const opts = numberingOptions(state);
    expect(opts.filter((o) => o.selected).map((o) => o.id)).toEqual(['triangular']);
    expect(opts.find((o) => o.id === 'triangular')?.unlocked).toBe(true);
  });
});
