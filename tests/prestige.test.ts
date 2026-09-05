import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, SAVE_VERSION, type GameState } from '$engine/state';
import { cardId, type GameEvent } from '$engine/types';
import { derive } from '$engine/economy/derive';
import {
  CUT_BASE,
  CUT_EXPONENT,
  canCut,
  checkCutReveal,
  cutMultiplier,
  cutPotential,
  cutThreshold,
  cutsOnCut,
  performCut,
  runEarned
} from '$engine/economy/prestige';
import { buyNode } from '$engine/economy/constellation';
import { buyUpgrade } from '$engine/economy/upgrades';
import { D } from '$engine/numbers';
import { deserialize, serialize } from '$engine/save/serialize';
import { migrate } from '$engine/save/migrate';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

/** A state with a partly-woken, partly-charged deck and some earnings on the clock. */
function playedState(): GameState {
  const state = createInitialState(0);
  for (let i = 0; i < 20; i++) {
    const card = state.cards[i];
    if (card) {
      card.awake = true;
      card.charge = i % 7;
    }
  }
  state.lifetimeShuffles = D('1e12');
  state.shuffles = D('1e12');
  return state;
}

describe('cut threshold', () => {
  it('scales exactly with the full current multiplier (invariant #4)', () => {
    const state = playedState();
    const before = derive(state);
    const t1 = cutThreshold(state, before);
    const m1 = cutMultiplier(before);

    expect(t1.div(m1).minus(CUT_BASE).abs().div(t1.div(m1)).toNumber()).toBeLessThan(1e-9);

    buyUpgrade(state, new EventBus(), 'steadier-hands', 4);
    const after = derive(state);
    const t2 = cutThreshold(state, after);
    const m2 = cutMultiplier(after);

    expect(m2.gt(m1)).toBe(true);
    // Threshold and multiplier moved by the same factor.
    const thresholdRatio = t2.div(t1);
    const multRatio = m2.div(m1);
    expect(thresholdRatio.minus(multRatio).abs().div(multRatio).toNumber()).toBeLessThan(1e-9);
  });

  it('leaves the potential unchanged once the run has earned in proportion', () => {
    const state = playedState();
    const p1 = cutPotential(state, derive(state));
    const m1 = cutMultiplier(derive(state));

    buyUpgrade(state, new EventBus(), 'steadier-hands', 4);
    const m2 = cutMultiplier(derive(state));
    // The bigger multiplier earns proportionally faster; give the run that time.
    state.lifetimeShuffles = state.lifetimeShuffles.times(m2.div(m1));

    const p2 = cutPotential(state, derive(state));
    expect(p2.minus(p1).abs().div(p1).toNumber()).toBeLessThan(1e-9);
  });

  it('buying a multiplier alone cannot buy a cut', () => {
    const state = playedState();
    const p1 = cutPotential(state, derive(state));
    buyUpgrade(state, new EventBus(), 'steadier-hands', 4);
    expect(cutPotential(state, derive(state)).lt(p1)).toBe(true);
  });
});

describe('cut potential', () => {
  it('is zero until the run has earned something', () => {
    const state = playedState();
    state.run.earnedAtStart = state.lifetimeShuffles;
    expect(runEarned(state).eq(0)).toBe(true);
    expect(cutPotential(state, derive(state)).eq(0)).toBe(true);
    expect(canCut(state, derive(state))).toBe(false);
  });

  it('grows with runEarned along the documented exponent', () => {
    const state = playedState();
    const d = derive(state);
    const p1 = cutPotential(state, d);
    state.lifetimeShuffles = state.lifetimeShuffles.times(16);
    const p2 = cutPotential(state, derive(state));
    expect(p2.gt(p1)).toBe(true);
    const expected = p1.times(D(16).pow(CUT_EXPONENT));
    expect(p2.minus(expected).abs().div(expected).toNumber()).toBeLessThan(1e-9);
  });

  it('applies the Constellation cut-yield multiplier to the whole-cut count', () => {
    const state = playedState();
    state.lifetimeShuffles = D(CUT_BASE).times(cutMultiplier(derive(state))).times(1e4);
    const plain = cutsOnCut(state, derive(state));
    state.prestige.constellation['sharper-cut'] = 5; // 1 + 0.1*5 = 1.5x
    const yielded = cutsOnCut(state, derive(state));
    expect(yielded.gte(plain.times(1.4))).toBe(true);
  });
});

describe('performCut', () => {
  function readyState(): GameState {
    const state = playedState();
    for (const card of state.cards) card.awake = true;
    state.cards.forEach((c, i) => { c.charge = i; });
    const d = derive(state);
    state.lifetimeShuffles = D(CUT_BASE).times(cutMultiplier(d)).times(1e4);
    return state;
  }

  it('banks cuts, resets the run, and never touches the odometer', () => {
    const state = readyState();
    const { bus, events } = withBus();
    const odometer = state.lifetimeShuffles;
    state.run.upgrades['steadier-hands'] = 3;
    const expected = cutsOnCut(state, derive(state));
    expect(expected.gte(1)).toBe(true);

    state.run.handsPlayed = 9;
    state.run.handsWon = 2;
    state.run.homedThisRun = 40;
    state.run.cutAvailableSeenAt = 1000;

    const earned = performCut(state, bus, 'dealer', 600_000);

    expect(earned.eq(expected)).toBe(true);
    expect(state.prestige.cuts.eq(expected)).toBe(true);
    expect(state.prestige.lifetimeCuts.eq(expected)).toBe(true);
    expect(state.prestige.cutsPerformed).toBe(1);
    expect(state.stats.totalCuts).toBe(1);
    expect(state.stats.fastestCutSeconds).toBe(600);

    expect(state.lifetimeShuffles.eq(odometer)).toBe(true);
    expect(state.shuffles.eq(0)).toBe(true);
    expect(state.run.upgrades).toEqual({});
    expect(state.run.handsPlayed).toBe(0);
    expect(state.run.handsWon).toBe(0);
    expect(state.run.homedThisRun).toBe(0);
    expect(state.run.undosThisHand).toBe(0);
    expect(state.run.startedAt).toBe(600_000);
    expect(state.run.cutAvailableSeenAt).toBe(null);
    expect(state.run.earnedAtStart.eq(odometer)).toBe(true);
    expect(runEarned(state).eq(0)).toBe(true);
    expect(state.run.way).toBe('dealer');

    const cutEvents = events.filter((e) => e.type === 'cut');
    expect(cutEvents).toHaveLength(1);
    expect(cutEvents[0]).toMatchObject({ type: 'cut', way: 'dealer' });
  });

  it('re-sleeps the deck except the top keepAwake cards by charge', () => {
    const state = readyState();
    state.prestige.constellation['kept-flame'] = 1; // keepAwake 2
    performCut(state, new EventBus(), 'hand', 1000);

    const awake = state.cards.map((c, i) => ({ i, ...c })).filter((c) => c.awake);
    expect(awake.map((c) => c.i)).toEqual([50, 51]); // the two highest charges
    for (const c of awake) expect(c.charge).toBe(0); // no Warm Start owned
    expect(state.cards.filter((c) => c.charge > 0)).toHaveLength(0);
  });

  it('gives surviving cards the Constellation start charge', () => {
    const state = readyState();
    state.prestige.constellation['kept-flame'] = 1;
    state.prestige.constellation['warm-start'] = 2; // startCharge 4
    performCut(state, new EventBus(), 'hand', 1000);
    const awake = state.cards.filter((c) => c.awake);
    expect(awake).toHaveLength(2);
    for (const c of awake) expect(c.charge).toBe(4);
  });

  it('sleeps the whole deck with no Kept Flame', () => {
    const state = readyState();
    performCut(state, new EventBus(), 'hand', 1000);
    expect(state.cards.some((c) => c.awake)).toBe(false);
  });

  it('falls back to the Way of the Hand when the chosen way is not unlocked', () => {
    const state = readyState();
    expect(performCut(state, new EventBus(), 'gambler', 1000).gte(1)).toBe(true);
    expect(state.run.way).toBe('hand');
  });

  it('refuses when the cut is not yet available', () => {
    const state = playedState();
    state.run.earnedAtStart = state.lifetimeShuffles;
    const { bus, events } = withBus();
    expect(performCut(state, bus, 'hand', 1000).eq(0)).toBe(true);
    expect(state.prestige.cutsPerformed).toBe(0);
    expect(events.filter((e) => e.type === 'cut')).toHaveLength(0);
  });
});

describe('cutMult reads lifetime cuts, never the balance (invariant #4)', () => {
  it('keeps the rate when Cuts are spent on the Constellation', () => {
    const state = playedState();
    state.prestige.cuts = D(20);
    state.prestige.lifetimeCuts = D(20);
    const rateBefore = derive(state).deckRate;
    expect(derive(state).mults.cut.eq(D(21).pow(1.5))).toBe(true);

    // "Long Night" only extends the offline cap, so nothing but the balance should move.
    expect(buyNode(state, new EventBus(), 'long-night')).toBe(true);
    expect(state.prestige.cuts.lt(20)).toBe(true);
    expect(state.prestige.lifetimeCuts.eq(20)).toBe(true);
    expect(derive(state).deckRate.eq(rateBefore)).toBe(true);
  });
});

describe('cut reveal', () => {
  it('emits once ever, and records when the cut first became reachable each run', () => {
    const state = playedState();
    for (const card of state.cards) card.awake = true;
    state.lastSeenAt = 12_345;
    state.lifetimeShuffles = D(CUT_BASE).times(cutMultiplier(derive(state))).times(1e4);

    const { bus, events } = withBus();
    checkCutReveal(state, derive(state), bus);
    expect(state.run.cutAvailableSeenAt).toBe(12_345);
    expect(state.revealed).toContain('cut');
    expect(events.filter((e) => e.type === 'reveal')).toHaveLength(1);

    events.length = 0;
    checkCutReveal(state, derive(state), bus);
    expect(events).toHaveLength(0);

    // A later run notes its own availability time, but never re-reveals.
    performCut(state, bus, 'hand', 1000);
    expect(state.run.cutAvailableSeenAt).toBe(null);
    state.lastSeenAt = 99_999;
    state.lifetimeShuffles = state.lifetimeShuffles.times(1e6);
    for (const card of state.cards) card.awake = true;
    events.length = 0;
    checkCutReveal(state, derive(state), bus);
    expect(state.run.cutAvailableSeenAt).toBe(99_999);
    expect(events.filter((e) => e.type === 'reveal')).toHaveLength(0);
  });

  it('does nothing while the cut is out of reach', () => {
    const state = playedState();
    state.run.earnedAtStart = state.lifetimeShuffles;
    const { bus, events } = withBus();
    checkCutReveal(state, derive(state), bus);
    expect(state.run.cutAvailableSeenAt).toBe(null);
    expect(events).toHaveLength(0);
  });
});

describe('save v1 -> v2', () => {
  const V1 = JSON.stringify({
    version: 1,
    createdAt: 100,
    lastSeenAt: 200,
    shuffles: { $d: '1234' },
    lifetimeShuffles: { $d: '5678' },
    cards: Array.from({ length: 52 }, (_, i) => ({ awake: i < 3, charge: i, marks: [] })),
    numbering: 'natural',
    unlockedNumberings: ['natural'],
    run: { way: 'none', startedAt: 100, upgrades: { 'steadier-hands': 2 }, handsPlayed: 4, handsWon: 1, homedThisRun: 7, undosThisHand: 0 },
    prestige: { cuts: { $d: '0' }, lifetimeCuts: { $d: '0' }, cutsPerformed: 0, permutations: { $d: '0' }, lifetimePermutations: { $d: '0' }, reshuffles: 0, constellation: {} },
    revealed: ['steadier-hands'],
    milestones: ['thousand'],
    settings: { sound: true, haptics: true, reducedMotion: false, autoDealerDelaySeconds: 12, shuffleStyle: 'riffle' },
    stats: { totalHomed: 7, totalHands: 4, totalWins: 1, bestRate: { $d: '9' }, playSeconds: 60 },
    activeGame: 'klondike',
    gameConfig: {}
  });

  it('migrate fills the new fields', () => {
    const out = migrate(JSON.parse(V1) as Record<string, unknown>);
    expect(out.version).toBe(2);
    const run = out.run as Record<string, unknown>;
    expect(run.earnedAtStart).toBe('0');
    expect(run.cutAvailableSeenAt).toBe(null);
    expect((out.prestige as Record<string, unknown>).waysUnlocked).toEqual(['hand', 'dealer']);
    expect((out.stats as Record<string, unknown>).fastestCutSeconds).toBe(null);
    expect((out.stats as Record<string, unknown>).totalCuts).toBe(0);
  });

  it('a v1 save string deserializes into a whole v2 state', () => {
    const state = deserialize(V1);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.lifetimeShuffles.eq(5678)).toBe(true);
    expect(state.run.upgrades['steadier-hands']).toBe(2);
    // A v1 player has never cut, so their whole odometer belongs to the current run.
    expect(state.run.earnedAtStart.eq(0)).toBe(true);
    expect(runEarned(state).eq(5678)).toBe(true);
    expect(state.run.cutAvailableSeenAt).toBe(null);
    expect(state.prestige.waysUnlocked).toEqual(['hand', 'dealer']);
    expect(state.stats.fastestCutSeconds).toBe(null);
    expect(state.stats.totalCuts).toBe(0);
    expect(state.milestones).toEqual(['thousand']);
  });

  it('survives a garbled v2 payload without throwing', () => {
    const broken = JSON.parse(serialize(createInitialState(0))) as Record<string, unknown>;
    broken.run = { way: 'nonsense', earnedAtStart: 'not a number', cutAvailableSeenAt: 'soon' };
    broken.prestige = { waysUnlocked: ['hand', 'wizard', 7] };
    broken.stats = { fastestCutSeconds: 'quick', totalCuts: -4 };
    const state = deserialize(JSON.stringify(broken));
    expect(state.run.way).toBe('none');
    expect(state.run.earnedAtStart.eq(0)).toBe(true);
    expect(state.run.cutAvailableSeenAt).toBe(null);
    expect(state.prestige.waysUnlocked).toEqual(['hand']);
    expect(state.stats.fastestCutSeconds).toBe(null);
    expect(state.stats.totalCuts).toBe(0);
  });
});
