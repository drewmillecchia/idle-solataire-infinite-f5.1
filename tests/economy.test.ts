import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, type GameState } from '$engine/state';
import { cardId } from '$engine/types';
import type { GameEvent } from '$engine/types';
import { derive } from '$engine/economy/derive';
import { homeCard, tableauSpark } from '$engine/economy/cards';
import { dealHand, winHand } from '$engine/economy/hand';
import {
  buyUpgrade,
  canBuy,
  maxAffordable,
  upgradeCost,
  visibleUpgrades
} from '$engine/economy/upgrades';
import { checkMilestones } from '$engine/economy/milestones';
import { D } from '$engine/numbers';
import { UPGRADES } from '$content/index';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

describe('homeCard', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
  });

  it('wakes on first play, then charges, with deckRate rising and events in the documented order', () => {
    const { bus, events } = withBus();
    const card = cardId('S', 5);

    homeCard(state, bus, card, 'foundation-s');
    expect(events.map((e) => e.type)).toEqual(['card-home', 'card-woken', 'spark']);
    expect(events[0]).toMatchObject({ type: 'card-home', first: true, card });
    const wakeSpark = events[2];
    expect(wakeSpark).toMatchObject({ type: 'spark' });
    if (wakeSpark?.type === 'spark') expect(wakeSpark.amount.eq(0)).toBe(true);
    expect(state.cards[card]?.awake).toBe(true);
    expect(state.cards[card]?.charge).toBe(0);
    expect(state.run.homedThisRun).toBe(1);
    expect(state.stats.totalHomed).toBe(1);

    const rateAfterWake = derive(state).deckRate;
    expect(rateAfterWake.gt(0)).toBe(true);

    events.length = 0;
    homeCard(state, bus, card, 'foundation-s');
    expect(events.map((e) => e.type)).toEqual(['charge-gained', 'card-home', 'spark']);
    expect(events[0]).toMatchObject({ type: 'charge-gained', card, charge: 1 });
    expect(events[1]).toMatchObject({ type: 'card-home', first: false, card });
    const chargeSpark = events[2];
    expect(chargeSpark).toMatchObject({ type: 'spark' });
    if (chargeSpark?.type === 'spark') expect(chargeSpark.amount.gte(1)).toBe(true);
    expect(state.cards[card]?.charge).toBe(1);
    expect(state.run.homedThisRun).toBe(2);
    expect(state.stats.totalHomed).toBe(2);

    const rateAfterCharge = derive(state).deckRate;
    expect(rateAfterCharge.gt(rateAfterWake)).toBe(true);
  });

  it('adds spark to both shuffles and lifetimeShuffles', () => {
    const { bus } = withBus();
    const card = cardId('H', 1);
    homeCard(state, bus, card, 'foundation-h'); // wake, 0 spark
    homeCard(state, bus, card, 'foundation-h'); // charge, >=1 spark
    expect(state.shuffles.gt(0)).toBe(true);
    expect(state.lifetimeShuffles.eq(state.shuffles)).toBe(true);
  });
});

describe('tableauSpark', () => {
  it('pays a small, floored spark and emits it', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();
    const card = cardId('C', 3);
    homeCard(state, bus, card, 'tableau');
    homeCard(state, bus, card, 'tableau');
    events.length = 0;

    tableauSpark(state, bus, card);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'spark', anchor: card });
    if (events[0]?.type === 'spark') expect(events[0].amount.gte(1)).toBe(true);
  });

  it('omits the anchor field when none is given', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();
    tableauSpark(state, bus);
    expect(events[0]).not.toHaveProperty('anchor');
  });
});

describe('hand lifecycle', () => {
  it('dealHand resets undo counter and bumps counters; winHand pays a burst', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();
    const card = cardId('D', 1);
    homeCard(state, bus, card, 'foundation-d');
    events.length = 0;

    dealHand(state, bus, 'klondike', 42);
    expect(state.run.handsPlayed).toBe(1);
    expect(state.stats.totalHands).toBe(1);
    expect(events[0]).toMatchObject({ type: 'hand-dealt', game: 'klondike', seed: 42 });

    events.length = 0;
    const rate = derive(state).deckRate;
    const burst = winHand(state, bus, { game: 'klondike', moves: 10, seconds: 30 });
    const expected = rate.times(60);
    expect(burst.minus(expected).abs().div(expected).toNumber()).toBeLessThan(1e-9);
    expect(state.run.handsWon).toBe(1);
    expect(state.stats.totalWins).toBe(1);
    expect(events[0]).toMatchObject({ type: 'hand-won' });
  });

  it('applies the undo penalty when the hand used an undo', () => {
    const state = createInitialState(0);
    const { bus } = withBus();
    const card = cardId('D', 2);
    homeCard(state, bus, card, 'foundation-d');
    dealHand(state, bus, 'klondike', 1);
    state.run.undosThisHand = 1;
    const rate = derive(state).deckRate;
    const burst = winHand(state, bus, { game: 'klondike', moves: 5, seconds: 10 });
    const expected = rate.times(60).times(0.7);
    expect(burst.minus(expected).abs().div(expected).toNumber()).toBeLessThan(1e-9);
  });
});

describe('upgrades', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
  });

  it('sums a geometric cost series', () => {
    const def = UPGRADES.find((u) => u.id === 'steadier-hands');
    if (!def) throw new Error('missing steadier-hands in content');
    const base = Number(def.baseCost);
    const growth = def.growth;
    let manual = 0;
    for (let i = 0; i < 3; i++) manual += base * Math.pow(growth, i);

    const cost = upgradeCost(state, 'steadier-hands', 3);
    expect(cost.minus(manual).abs().div(manual).toNumber()).toBeLessThan(1e-9);
  });

  it('buyUpgrade deducts the cost and records the level; refuses when unaffordable', () => {
    state.shuffles = D(0);
    expect(canBuy(state, 'steadier-hands', 1)).toBe(false);
    expect(buyUpgrade(state, new EventBus(), 'steadier-hands', 1)).toBe(false);

    state.shuffles = D(1000);
    const { bus, events } = withBus();
    const cost = upgradeCost(state, 'steadier-hands', 1);
    const bought = buyUpgrade(state, bus, 'steadier-hands', 1);
    expect(bought).toBe(true);
    expect(state.run.upgrades['steadier-hands']).toBe(1);
    expect(state.shuffles.plus(cost).minus(1000).abs().lt(1e-9)).toBe(true);
    expect(events[0]).toMatchObject({ type: 'purchase', id: 'steadier-hands', count: 1 });
  });

  it('respects a level cap (max)', () => {
    state.shuffles = D('1e30');
    const bus = new EventBus();
    expect(buyUpgrade(state, bus, 'the-dealer', 1)).toBe(true);
    expect(canBuy(state, 'the-dealer', 1)).toBe(false);
    expect(buyUpgrade(state, bus, 'the-dealer', 1)).toBe(false);
    expect(state.run.upgrades['the-dealer']).toBe(1);
  });

  it('maxAffordable finds the largest affordable count within budget', () => {
    state.shuffles = D(5000);
    const n = maxAffordable(state, 'steadier-hands');
    expect(upgradeCost(state, 'steadier-hands', n).lte(state.shuffles)).toBe(true);
    expect(upgradeCost(state, 'steadier-hands', n + 1).gt(state.shuffles)).toBe(true);
  });

  it('visibleUpgrades honours revealAfter gates and never re-hides once shown', () => {
    const initial = visibleUpgrades(state);
    const initialIds = initial.map((u) => u.id);
    expect(initialIds).toContain('steadier-hands');
    expect(initialIds).not.toContain('warm-hearts');

    const bus = new EventBus();
    state.cards[cardId('H', 1)]!.awake = true;
    state.cards[cardId('H', 2)]!.awake = true; // awakeCount = 2, meets warm-hearts gate
    const afterWake = visibleUpgrades(state);
    expect(afterWake.map((u) => u.id)).toContain('warm-hearts');
    expect(state.revealed).toContain('warm-hearts');

    // Simulate the gating condition becoming false again (e.g. a reset elsewhere); the
    // upgrade must stay visible because it is already recorded as revealed.
    state.cards[cardId('H', 1)]!.awake = false;
    state.cards[cardId('H', 2)]!.awake = false;
    const afterReset = visibleUpgrades(state);
    expect(afterReset.map((u) => u.id)).toContain('warm-hearts');
    void bus;
  });
});

describe('milestones', () => {
  it('fires each newly-passed milestone exactly once', () => {
    const state = createInitialState(0);
    const { bus, events } = withBus();

    state.lifetimeShuffles = D(1000);
    checkMilestones(state, bus);
    const thousandEvents = events.filter((e) => e.type === 'milestone' && e.id === 'thousand');
    expect(thousandEvents).toHaveLength(1);
    expect(state.milestones).toContain('thousand');

    events.length = 0;
    checkMilestones(state, bus);
    expect(events).toHaveLength(0);

    state.lifetimeShuffles = D('1e9');
    checkMilestones(state, bus);
    const ids = events.filter((e) => e.type === 'milestone').map((e) => (e.type === 'milestone' ? e.id : ''));
    expect(ids).toContain('million');
    expect(ids).toContain('billion');
    expect(ids).not.toContain('thousand');
  });
});
