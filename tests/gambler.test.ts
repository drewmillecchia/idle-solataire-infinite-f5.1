/**
 * Way of the Gambler: the per-hand wager (docs/02-game-design.md §5).
 * The roll is state (`run.hand.roll`); it is APPLIED in derive and nowhere else (invariant #2).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, type GameState } from '$engine/state';
import type { GameEvent } from '$engine/types';
import { D } from '$engine/numbers';
import { derive } from '$engine/economy/derive';
import { ROLL_MAX, ROLL_MIN, dealHand, gamblerRoll, rerollSeed, winHand } from '$engine/economy/hand';
import { deserialize, serialize } from '$engine/save/serialize';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

function gamblerState(): GameState {
  const state = createInitialState(0);
  for (const card of state.cards) {
    card.awake = true;
    card.charge = 2;
  }
  state.run.way = 'gambler';
  state.prestige.waysUnlocked.push('gambler');
  state.lifetimeShuffles = D('1e6');
  return state;
}

describe('the roll', () => {
  it('always lands inside [0.5, 3]', () => {
    for (let seed = 0; seed < 500; seed++) {
      const roll = gamblerRoll(seed);
      expect(roll).toBeGreaterThanOrEqual(ROLL_MIN);
      expect(roll).toBeLessThanOrEqual(ROLL_MAX);
    }
  });

  it('is deterministic per seed', () => {
    for (const seed of [0, 1, 42, 999, 2 ** 31]) {
      expect(gamblerRoll(seed)).toBe(gamblerRoll(seed));
    }
    expect(gamblerRoll(1)).not.toBe(gamblerRoll(2));
  });

  it('is log-uniform, so halving and doubling are equally likely', () => {
    const rolls = Array.from({ length: 2000 }, (_, i) => gamblerRoll(i));
    const below = rolls.filter((r) => r < 1).length;
    // 0.5 x 6^u crosses 1 at u = log6(2) = 0.387, so ~39 % of rolls are a loss.
    expect(below / rolls.length).toBeGreaterThan(0.33);
    expect(below / rolls.length).toBeLessThan(0.45);
    const geoMean = Math.exp(rolls.reduce((a, r) => a + Math.log(r), 0) / rolls.length);
    expect(geoMean).toBeCloseTo(Math.sqrt(ROLL_MIN * ROLL_MAX), 1);
  });
});

describe('dealHand', () => {
  it('rolls the wager from the deal seed for the Gambler', () => {
    const state = gamblerState();
    const { bus } = withBus();
    dealHand(state, bus, 'klondike', 77);
    expect(state.run.hand.roll).toBe(gamblerRoll(77));
  });

  it('re-rolls every deal', () => {
    const state = gamblerState();
    const { bus } = withBus();
    dealHand(state, bus, 'klondike', 1);
    const first = state.run.hand.roll;
    dealHand(state, bus, 'klondike', 2);
    expect(state.run.hand.roll).not.toBe(first);
  });

  it('leaves every other Way on a flat 1', () => {
    for (const way of ['none', 'hand', 'dealer', 'scholar'] as const) {
      const state = gamblerState();
      state.run.way = way;
      dealHand(state, new EventBus(), 'klondike', 77);
      expect(state.run.hand.roll).toBe(1);
    }
  });
});

describe('winHand re-roll', () => {
  it('never lowers the wager', () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = gamblerState();
      const { bus } = withBus();
      dealHand(state, bus, 'klondike', seed);
      const before = state.run.hand.roll;
      winHand(state, bus, { game: 'klondike', moves: 10, seconds: 30 });
      expect(state.run.hand.roll).toBeGreaterThanOrEqual(before);
      expect(state.run.hand.roll).toBeLessThanOrEqual(ROLL_MAX);
    }
  });

  it('sometimes raises it, and takes exactly the better of the two', () => {
    let raised = 0;
    for (let seed = 0; seed < 60; seed++) {
      const state = gamblerState();
      const { bus } = withBus();
      dealHand(state, bus, 'klondike', seed);
      const before = state.run.hand.roll;
      const expected = Math.max(before, gamblerRoll(rerollSeed(state)));
      winHand(state, bus, { game: 'klondike', moves: 10, seconds: 30 });
      expect(state.run.hand.roll).toBe(expected);
      if (state.run.hand.roll > before) raised++;
    }
    expect(raised).toBeGreaterThan(0);
  });

  it('leaves the wager alone for every other Way', () => {
    const state = gamblerState();
    state.run.way = 'hand';
    const { bus } = withBus();
    dealHand(state, bus, 'klondike', 5);
    winHand(state, bus, { game: 'klondike', moves: 10, seconds: 30 });
    expect(state.run.hand.roll).toBe(1);
  });

  it('pays the burst at the roll the player was looking at, then re-rolls', () => {
    const state = gamblerState();
    const { bus } = withBus();
    dealHand(state, bus, 'klondike', 3);
    const roll = state.run.hand.roll;
    const d = derive(state);
    const burst = winHand(state, bus, { game: 'klondike', moves: 1, seconds: 1 });
    expect(burst.div(d.deckRate.times(60).times(d.burstMult)).toNumber()).toBeCloseTo(1, 9);
    // The pre-win derive already carried the wager.
    expect(d.burstMult.toNumber()).toBeCloseTo(roll, 9);
  });
});

describe('derive applies the wager (invariant #2)', () => {
  it('multiplies sparks and bursts by the roll, and nothing else', () => {
    const state = gamblerState();
    state.run.hand.roll = 1;
    const flat = derive(state);
    state.run.hand.roll = 2.5;
    const rolled = derive(state);

    expect(rolled.sparkMult.div(flat.sparkMult).toNumber()).toBeCloseTo(2.5, 9);
    expect(rolled.burstMult.div(flat.burstMult).toNumber()).toBeCloseTo(2.5, 9);
    // The idle deck is untouched: a bad roll must never stall the deck.
    expect(rolled.deckRate.eq(flat.deckRate)).toBe(true);
    expect(rolled.mults.global.eq(flat.mults.global)).toBe(true);
  });

  it('ignores the roll for every other Way', () => {
    const state = gamblerState();
    state.run.way = 'hand';
    state.run.hand.roll = 1;
    const flat = derive(state);
    state.run.hand.roll = 3;
    const rolled = derive(state);
    expect(rolled.sparkMult.eq(flat.sparkMult)).toBe(true);
    expect(rolled.burstMult.eq(flat.burstMult)).toBe(true);
  });

  it('falls back to 1 for a state whose roll is nonsense', () => {
    const state = gamblerState();
    state.run.hand.roll = 1;
    const flat = derive(state);
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      state.run.hand.roll = bad;
      expect(derive(state).burstMult.eq(flat.burstMult)).toBe(true);
    }
  });
});

describe('the wager in a save', () => {
  it('round-trips', () => {
    const state = gamblerState();
    dealHand(state, new EventBus(), 'klondike', 12);
    const roll = state.run.hand.roll;
    expect(deserialize(serialize(state)).run.hand.roll).toBeCloseTo(roll, 12);
  });

  it('clamps a hand-edited roll into the wager range (invariant #10)', () => {
    const state = gamblerState();
    state.run.hand.roll = 1e9;
    expect(deserialize(serialize(state)).run.hand.roll).toBe(ROLL_MAX);
    state.run.hand.roll = -5;
    expect(deserialize(serialize(state)).run.hand.roll).toBe(ROLL_MIN);
  });
});
