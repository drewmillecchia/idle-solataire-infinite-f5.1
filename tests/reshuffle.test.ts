/**
 * Layer 2: Reshuffle -> Permutations (engine/economy/reshuffle.ts, docs/02-game-design.md §6).
 * The two anti-divergence invariants (CLAUDE.md #4) are asserted here the same way
 * tests/prestige.test.ts asserts them for the Cut.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { SAVE_VERSION, createInitialState, type GameState } from '$engine/state';
import { cardId, type GameEvent } from '$engine/types';
import { D } from '$engine/numbers';
import { derive } from '$engine/economy/derive';
import { step } from '$engine/tick';
import { buyNode } from '$engine/economy/constellation';
import { placeMark } from '$engine/marks/placement';
import { deserialize, serialize } from '$engine/save/serialize';
import { migrate } from '$engine/save/migrate';
import {
  RESHUFFLE_BASE,
  RESHUFFLE_EXPONENT,
  RESHUFFLE_REVEAL_CUTS,
  canReshuffle,
  checkReshuffleReveal,
  cycleCuts,
  cycleSeed,
  performReshuffle,
  permutationsOnReshuffle,
  reshufflePotential,
  reshuffleThreshold
} from '$engine/economy/reshuffle';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

/** A state mid-cycle: a woken, charged deck and some Cuts banked this cycle. */
function cycledState(cuts = 100): GameState {
  const state = createInitialState(0);
  for (let i = 0; i < 30; i++) {
    const card = state.cards[i];
    if (card) {
      card.awake = true;
      card.charge = 3 + (i % 5);
    }
  }
  state.lifetimeShuffles = D('1e18');
  state.shuffles = D('1e17');
  state.run.way = 'hand';
  state.prestige.cuts = D(cuts);
  state.prestige.lifetimeCuts = D(cuts);
  state.prestige.cutsAtCycleStart = D(0);
  return state;
}

describe('cycleCuts', () => {
  it('measures the cycle, not the lifetime', () => {
    const state = cycledState(100);
    expect(cycleCuts(state).toNumber()).toBe(100);
    state.prestige.cutsAtCycleStart = D(40);
    expect(cycleCuts(state).toNumber()).toBe(60);
  });

  it('never goes negative, whatever a repaired save holds', () => {
    const state = cycledState(5);
    state.prestige.cutsAtCycleStart = D(500);
    expect(cycleCuts(state).toNumber()).toBe(0);
    expect(canReshuffle(state, derive(state))).toBe(false);
  });
});

describe('reshuffle threshold (invariant #4, layer 2)', () => {
  it('scales exactly with the permutation multiplier', () => {
    const state = cycledState();
    const t1 = reshuffleThreshold(state, derive(state));
    expect(t1.div(derive(state).mults.permutation).toNumber()).toBeCloseTo(RESHUFFLE_BASE, 9);

    state.prestige.lifetimePermutations = D(7);
    const after = derive(state);
    const t2 = reshuffleThreshold(state, after);
    expect(after.mults.permutation.gt(1)).toBe(true);
    expect(t2.div(t1).minus(after.mults.permutation).abs().toNumber()).toBeLessThan(1e-9);
  });

  it('reads lifetime permutations, never the balance (invariant #4)', () => {
    const state = cycledState();
    state.prestige.lifetimePermutations = D(7);
    state.prestige.permutations = D(7);
    const before = permutationsOnReshuffle(state, derive(state));
    // Spending the balance on a Numbering system must not move the layer's own arithmetic.
    state.prestige.permutations = D(0);
    expect(permutationsOnReshuffle(state, derive(state)).eq(before)).toBe(true);
  });
});

describe('reshuffle potential', () => {
  it('is zero before the cycle has banked anything', () => {
    const state = cycledState(0);
    expect(reshufflePotential(state, derive(state)).toNumber()).toBe(0);
    expect(canReshuffle(state, derive(state))).toBe(false);
  });

  it('grows with the cuts the cycle has banked', () => {
    const state = cycledState(0);
    let last = -1;
    for (const cuts of [10, 40, 100, 400]) {
      state.prestige.lifetimeCuts = D(cuts);
      const p = reshufflePotential(state, derive(state)).toNumber();
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  it('is exactly (cycleCuts / threshold)^EXPONENT', () => {
    const state = cycledState(96);
    const d = derive(state);
    const ratio = cycleCuts(state).div(reshuffleThreshold(state, d));
    expect(reshufflePotential(state, d).toNumber()).toBeCloseTo(
      Math.pow(ratio.toNumber(), RESHUFFLE_EXPONENT),
      9
    );
  });

  it('becomes available at exactly one whole permutation', () => {
    const state = cycledState(RESHUFFLE_BASE - 1);
    expect(canReshuffle(state, derive(state))).toBe(false);
    state.prestige.lifetimeCuts = D(RESHUFFLE_BASE);
    expect(permutationsOnReshuffle(state, derive(state)).toNumber()).toBe(1);
    expect(canReshuffle(state, derive(state))).toBe(true);
  });
});

describe('performReshuffle', () => {
  it('banks permutations and reseeds the cut layer', () => {
    const state = cycledState(200);
    const { bus, events } = withBus();
    const expected = permutationsOnReshuffle(state, derive(state));
    expect(expected.gte(1)).toBe(true);

    const earned = performReshuffle(state, bus, 5000);

    expect(earned.eq(expected)).toBe(true);
    expect(state.prestige.permutations.eq(expected)).toBe(true);
    expect(state.prestige.lifetimePermutations.eq(expected)).toBe(true);
    expect(state.prestige.reshuffles).toBe(1);

    const seed = cycleSeed(1);
    expect(state.prestige.cuts.eq(seed)).toBe(true);
    expect(state.prestige.lifetimeCuts.eq(seed)).toBe(true);
    expect(state.prestige.cutsAtCycleStart.eq(seed)).toBe(true);
    expect(cycleCuts(state).toNumber()).toBe(0);

    expect(events.some((e) => e.type === 'reshuffle' && e.permutations.eq(expected))).toBe(true);
  });

  it('does nothing when it is not available', () => {
    const state = cycledState(1);
    const { bus, events } = withBus();
    const before = { ...state.prestige };
    expect(performReshuffle(state, bus, 1).toNumber()).toBe(0);
    expect(state.prestige.lifetimeCuts.eq(before.lifetimeCuts)).toBe(true);
    expect(state.prestige.reshuffles).toBe(0);
    expect(events.some((e) => e.type === 'reshuffle')).toBe(false);
  });

  it('never touches the odometer (invariant #5)', () => {
    const state = cycledState(200);
    const odometer = state.lifetimeShuffles;
    performReshuffle(state, new EventBus(), 5000);
    expect(state.lifetimeShuffles.eq(odometer)).toBe(true);
    expect(state.shuffles.toNumber()).toBe(0);
    expect(state.run.earnedAtStart.eq(odometer)).toBe(true);
  });

  it('keeps the Constellation, the reveals and the numbering ladder', () => {
    const state = cycledState(200);
    const { bus } = withBus();
    buyNode(state, bus, 'steady-hand');
    buyNode(state, bus, 'kept-flame');
    state.revealed.push('cut', 'reshuffle');
    state.unlockedNumberings.push('prime');
    state.numbering = 'prime';
    state.milestones.push('million');

    performReshuffle(state, bus, 5000);

    expect(state.prestige.constellation['steady-hand']).toBe(1);
    expect(state.prestige.constellation['kept-flame']).toBe(1);
    expect(state.revealed).toContain('reshuffle');
    expect(state.unlockedNumberings).toContain('prime');
    expect(state.numbering).toBe('prime');
    expect(state.milestones).toContain('million');
  });

  it('re-sleeps the deck, keeping Kept Flame cards and every Anchor', () => {
    const state = cycledState(200);
    const { bus } = withBus();
    // Kept Flame keeps the two highest-charge cards; the Anchor keeps its card outright.
    buyNode(state, bus, 'kept-flame');
    const anchored = cardId('C', 2);
    const card = state.cards[anchored];
    expect(card).toBeDefined();
    if (card) {
      card.awake = true;
      card.charge = 11;
    }
    expect(placeMark(state, bus, derive(state), 'anchor', [anchored])).toBe(true);

    const before = state.cards.map((c) => ({ awake: c.awake, charge: c.charge }));
    performReshuffle(state, bus, 5000);

    expect(state.cards[anchored]?.awake).toBe(true);
    expect(state.cards[anchored]?.charge).toBe(11);
    const awake = state.cards.filter((c) => c.awake).length;
    // Two Kept Flame survivors plus the Anchor; everything else is asleep at zero charge.
    expect(awake).toBeLessThanOrEqual(3);
    expect(awake).toBeLessThan(before.filter((c) => c.awake).length);
    expect(state.marks.placed).toHaveLength(1);
  });

  it('keeps the current Way and starts a fresh run', () => {
    const state = cycledState(200);
    state.run.way = 'dealer';
    state.run.upgrades['steadier-hands'] = 4;
    state.run.handsWon = 9;
    state.run.homedThisRun = 30;

    performReshuffle(state, new EventBus(), 7000);

    expect(state.run.way).toBe('dealer');
    expect(state.run.upgrades).toEqual({});
    expect(state.run.handsWon).toBe(0);
    expect(state.run.homedThisRun).toBe(0);
    expect(state.run.startedAt).toBe(7000);
    expect(state.run.hand.roll).toBe(1);
  });

  it('seeds each cycle a little harder than the last', () => {
    expect(cycleSeed(1).lt(cycleSeed(2))).toBe(true);
    const state = cycledState(400);
    const { bus } = withBus();
    performReshuffle(state, bus, 1000);
    expect(state.prestige.cuts.eq(cycleSeed(1))).toBe(true);
    state.prestige.lifetimeCuts = state.prestige.lifetimeCuts.plus(400);
    performReshuffle(state, bus, 2000);
    expect(state.prestige.cuts.eq(cycleSeed(2))).toBe(true);
    expect(state.prestige.reshuffles).toBe(2);
  });
});

describe('reveal', () => {
  it('appears at 12 cuts performed, and only then', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();
    state.prestige.cutsPerformed = RESHUFFLE_REVEAL_CUTS - 1;
    checkReshuffleReveal(state, bus);
    expect(state.revealed).not.toContain('reshuffle');

    state.prestige.cutsPerformed = RESHUFFLE_REVEAL_CUTS;
    checkReshuffleReveal(state, bus);
    expect(state.revealed).toContain('reshuffle');
    expect(events.filter((e) => e.type === 'reveal' && e.feature === 'reshuffle')).toHaveLength(1);
  });

  it('fires once, from the tick, and is never re-hidden', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();
    state.prestige.cutsPerformed = 20;
    for (let i = 0; i < 5; i++) step(state, 0.05, bus);
    expect(events.filter((e) => e.type === 'reveal' && e.feature === 'reshuffle')).toHaveLength(1);
    expect(state.revealed.filter((f) => f === 'reshuffle')).toHaveLength(1);
  });
});

describe('save v4', () => {
  it('migrates a v3 save: a never-reshuffled player keeps every cut in the cycle', () => {
    const state = cycledState(30);
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    // Roll the payload back to what a v3 writer produced.
    raw.version = 3;
    const prestige = raw.prestige as Record<string, unknown>;
    delete prestige.cutsAtCycleStart;
    const run = raw.run as Record<string, unknown>;
    delete (run.hand as Record<string, unknown>).roll;

    const migrated = migrate(raw) as Record<string, unknown>;
    expect(migrated.version).toBe(4);
    expect((migrated.prestige as Record<string, unknown>).cutsAtCycleStart).toBe('0');
    expect(((migrated.run as Record<string, unknown>).hand as Record<string, unknown>).roll).toBe(1);

    const restored = deserialize(JSON.stringify(raw));
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.prestige.cutsAtCycleStart.toNumber()).toBe(0);
    expect(cycleCuts(restored).toNumber()).toBe(30);
    expect(restored.run.hand.roll).toBe(1);
  });

  it('round-trips a mid-cycle state', () => {
    const state = cycledState(200);
    performReshuffle(state, new EventBus(), 1000);
    state.prestige.lifetimeCuts = state.prestige.lifetimeCuts.plus(17);

    const restored = deserialize(serialize(state));
    expect(restored.prestige.cutsAtCycleStart.eq(state.prestige.cutsAtCycleStart)).toBe(true);
    expect(restored.prestige.lifetimePermutations.eq(state.prestige.lifetimePermutations)).toBe(true);
    expect(restored.prestige.reshuffles).toBe(1);
    expect(cycleCuts(restored).toNumber()).toBe(17);
  });

  it('repairs a garbage cycle start rather than minting permutations from it', () => {
    const state = cycledState(20);
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    const prestige = raw.prestige as Record<string, unknown>;

    prestige.cutsAtCycleStart = 'banana';
    expect(deserialize(JSON.stringify(raw)).prestige.cutsAtCycleStart.toNumber()).toBe(0);

    // Beyond the lifetime, which would make `cycleCuts` negative.
    prestige.cutsAtCycleStart = { $d: '1e9' };
    const clamped = deserialize(JSON.stringify(raw));
    expect(clamped.prestige.cutsAtCycleStart.toNumber()).toBe(20);
    expect(cycleCuts(clamped).toNumber()).toBe(0);

    // Negative, which would mint cycle cuts out of nothing.
    prestige.cutsAtCycleStart = { $d: '-500' };
    const floored = deserialize(JSON.stringify(raw));
    expect(floored.prestige.cutsAtCycleStart.toNumber()).toBe(0);
    expect(cycleCuts(floored).toNumber()).toBe(20);
  });

  it('survives a save with no prestige block at all', () => {
    const restored = deserialize('{"version":3,"prestige":"nope","run":42}');
    expect(restored.prestige.cutsAtCycleStart.toNumber()).toBe(0);
    expect(restored.run.hand.roll).toBe(1);
    expect(restored.version).toBe(SAVE_VERSION);
  });
});
