/**
 * Unit tests for the tier 2 run-upgrade effect kinds (docs/02 §9 "more to buy"; CLAUDE.md invariant
 * #2 — every one of these is folded into `economy/derive.ts`'s single derivation pass, nowhere
 * else). Each test exercises the actual multiplier `derive()` produces against the exact formula
 * documented in `economy/derive.ts`'s switch cases, so a drift between the content's blurb/rule and
 * the code shows up here, not in play.
 *
 * `tests/economy.test.ts` and `tests/content.test.ts` already cover the shared upgrade machinery
 * (cost curve, buying, reveal gating, uniqueness); this file is only the eight new effect kinds.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '$engine/state';
import { derive } from '$engine/economy/derive';
import { cardId } from '$engine/types';

function fresh(): GameState {
  return createInitialState(0);
}

describe('Comeback (comebackMult)', () => {
  it('pays most with nothing awake, and nothing extra once the whole deck is up', () => {
    const state = fresh();
    state.run.upgrades['comeback'] = 1; // per = 0.5

    const asleep = derive(state).mults.global; // awakeCount 0: factor 1 + 0.5*1*(1-0) = 1.5
    for (const c of state.cards) c.awake = true;
    const allAwake = derive(state).mults.global; // awakeCount 52: factor 1 + 0.5*1*(1-1) = 1

    expect(asleep.toNumber()).toBeCloseTo(1.5, 10);
    expect(allAwake.toNumber()).toBeCloseTo(1, 10);
  });
});

describe('Long Streak (handsWonMult)', () => {
  it('scales with hands WON this run, not homed plays', () => {
    const state = fresh();
    state.run.upgrades['long-streak'] = 1; // per = 0.4
    state.run.handsWon = 9; // log10(1 + 9) = 1

    expect(derive(state).mults.global.toNumber()).toBeCloseTo(1.4, 10);

    state.run.handsWon = 0;
    expect(derive(state).mults.global.toNumber()).toBeCloseTo(1, 10);
  });
});

describe('Even Trade (sparkForBurst)', () => {
  it('trades spark down and burst up by twice as much', () => {
    const state = fresh();
    state.run.upgrades['even-trade'] = 5; // per = 0.06 -> trade 0.3

    const d = derive(state);
    expect(d.sparkMult.toNumber()).toBeCloseTo(0.7, 10);
    expect(d.burstMult.toNumber()).toBeCloseTo(1.6, 10);
  });

  it('never sends spark to zero or below, however many levels are owned', () => {
    const state = fresh();
    state.run.upgrades['even-trade'] = 15; // max level, per*level = 0.9 -> trade capped at 0.9
    expect(derive(state).sparkMult.toNumber()).toBeCloseTo(0.1, 10);
  });
});

describe('Crowned (chargeMultFace)', () => {
  it('adds its charge slope only to face cards (J/Q/K)', () => {
    const king = cardId('S', 13);
    const five = cardId('S', 5);

    const base = fresh();
    base.cards[king] = { awake: true, charge: 4, marks: [] };
    base.cards[five] = { awake: true, charge: 4, marks: [] };
    const baseD = derive(base);

    const crowned = fresh();
    crowned.cards[king] = { awake: true, charge: 4, marks: [] };
    crowned.cards[five] = { awake: true, charge: 4, marks: [] };
    crowned.run.upgrades['crowned'] = 3; // per = 0.04 -> +0.12 slope on face cards only
    const crownedD = derive(crowned);

    // King: (1 + (0.1 + 0.12)*4) / (1 + 0.1*4) = 1.88 / 1.4
    expect(crownedD.perCard[king]!.div(baseD.perCard[king]!).toNumber()).toBeCloseTo(1.88 / 1.4, 10);
    // Five: untouched — same ratio as doing nothing at all.
    expect(crownedD.perCard[five]!.div(baseD.perCard[five]!).toNumber()).toBeCloseTo(1, 10);
  });
});

describe('Underdog Suits (laggardSuitMult) and Favored Suit (topSuitMult)', () => {
  function suitState(): GameState {
    const state = fresh();
    // Spades most-played, Hearts a middling suit, Diamonds and Clubs the two laggards. No ties,
    // so the tie-break rule (SUITS' own order) never has to enter the expectations below.
    state.cards[cardId('S', 5)] = { awake: true, charge: 10, marks: [] };
    state.cards[cardId('H', 5)] = { awake: true, charge: 5, marks: [] };
    state.cards[cardId('D', 5)] = { awake: true, charge: 0, marks: [] };
    state.cards[cardId('C', 5)] = { awake: true, charge: 1, marks: [] };
    return state;
  }

  it('Underdog Suits boosts the two least-played suits only', () => {
    const base = suitState();
    const baseD = derive(base);
    const state = suitState();
    state.run.upgrades['underdog-suits'] = 1; // per = 0.15
    const d = derive(state);

    expect(d.mults.suit.D.div(baseD.mults.suit.D).toNumber()).toBeCloseTo(1.15, 10);
    expect(d.mults.suit.C.div(baseD.mults.suit.C).toNumber()).toBeCloseTo(1.15, 10);
    expect(d.mults.suit.S.div(baseD.mults.suit.S).toNumber()).toBeCloseTo(1, 10);
    expect(d.mults.suit.H.div(baseD.mults.suit.H).toNumber()).toBeCloseTo(1, 10);
  });

  it('Favored Suit boosts only the single most-played suit', () => {
    const base = suitState();
    const baseD = derive(base);
    const state = suitState();
    state.run.upgrades['favored-suit'] = 1; // per = 0.12
    const d = derive(state);

    expect(d.mults.suit.S.div(baseD.mults.suit.S).toNumber()).toBeCloseTo(1.12, 10);
    expect(d.mults.suit.H.div(baseD.mults.suit.H).toNumber()).toBeCloseTo(1, 10);
    expect(d.mults.suit.D.div(baseD.mults.suit.D).toNumber()).toBeCloseTo(1, 10);
    expect(d.mults.suit.C.div(baseD.mults.suit.C).toNumber()).toBeCloseTo(1, 10);
  });
});

describe('Big Turn (chainMult)', () => {
  it('rewards a long hand: more cards already home this hand, more global multiplier', () => {
    const state = fresh();
    state.run.upgrades['big-turn'] = 1; // per = 0.015
    state.run.hand.homedThisHand = Array.from({ length: 10 }, (_, i) => i);

    expect(derive(state).mults.global.toNumber()).toBeCloseTo(1 + 0.015 * 10, 10);

    state.run.hand.homedThisHand = [];
    expect(derive(state).mults.global.toNumber()).toBeCloseTo(1, 10);
  });
});

describe('Fresh Cards (freshCardMult)', () => {
  it('boosts only cards at or under the young-charge threshold', () => {
    const young = cardId('S', 4);
    const veteran = cardId('S', 9);

    const base = fresh();
    base.cards[young] = { awake: true, charge: 1, marks: [] };
    base.cards[veteran] = { awake: true, charge: 6, marks: [] };
    const baseD = derive(base);

    const state = fresh();
    state.cards[young] = { awake: true, charge: 1, marks: [] };
    state.cards[veteran] = { awake: true, charge: 6, marks: [] };
    state.run.upgrades['fresh-cards'] = 2; // per = 0.25 -> +0.5
    const d = derive(state);

    expect(d.perCard[young]!.div(baseD.perCard[young]!).toNumber()).toBeCloseTo(1.5, 10);
    expect(d.perCard[veteran]!.div(baseD.perCard[veteran]!).toNumber()).toBeCloseTo(1, 10);
  });
});
