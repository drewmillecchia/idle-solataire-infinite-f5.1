import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, type GameState } from '$engine/state';
import type { GameEvent } from '$engine/types';
import { CONSTELLATION } from '$content/index';
import { derive } from '$engine/economy/derive';
import {
  buyNode,
  canBuyNode,
  nodeCost,
  nodeLevel,
  requirementsMet,
  visibleNodes
} from '$engine/economy/constellation';
import { D } from '$engine/numbers';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

describe('constellation content', () => {
  it('has unique ids and only refers to nodes that exist', () => {
    const ids = CONSTELLATION.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of CONSTELLATION) {
      for (const req of node.requires) expect(ids).toContain(req);
      expect(node.requires).not.toContain(node.id);
    }
  });

  it('has at least one root node per branch reachable from a root', () => {
    const roots = CONSTELLATION.filter((n) => n.requires.length === 0);
    expect(roots.length).toBeGreaterThan(0);
    // Every node is reachable from the roots (no orphan cycles).
    const reachable = new Set(roots.map((n) => n.id));
    for (let i = 0; i < CONSTELLATION.length; i++) {
      for (const n of CONSTELLATION) {
        if (n.requires.every((r) => reachable.has(r))) reachable.add(n.id);
      }
    }
    expect(reachable.size).toBe(CONSTELLATION.length);
  });

  it('keeps the ledger tone: short, dry, no exclamation marks', () => {
    for (const node of CONSTELLATION) {
      expect(node.blurb).not.toContain('!');
      expect(node.blurb.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('node costs', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
  });

  it('is a whole ceil(cost * growth^level)', () => {
    expect(nodeCost(state, 'kept-flame').eq(1)).toBe(true);
    state.prestige.constellation['kept-flame'] = 3;
    expect(nodeCost(state, 'kept-flame').eq(8)).toBe(true); // ceil(1 * 2^3)

    expect(nodeCost(state, 'sharper-cut').eq(2)).toBe(true);
    state.prestige.constellation['sharper-cut'] = 2;
    expect(nodeCost(state, 'sharper-cut').eq(6)).toBe(true); // ceil(2 * 1.6^2) = ceil(5.12)
  });

  it('throws loudly on an unknown node', () => {
    expect(() => nodeCost(state, 'nope')).toThrow(RangeError);
  });
});

describe('buying nodes', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
    state.prestige.cuts = D(50);
    state.prestige.lifetimeCuts = D(50);
  });

  it('spends the balance and never the lifetime total', () => {
    const { bus, events } = withBus();
    expect(buyNode(state, bus, 'kept-flame')).toBe(true);
    expect(state.prestige.cuts.eq(49)).toBe(true);
    expect(state.prestige.lifetimeCuts.eq(50)).toBe(true);
    expect(nodeLevel(state, 'kept-flame')).toBe(1);
    expect(events[0]).toMatchObject({ type: 'purchase', id: 'kept-flame', count: 1 });
    expect(derive(state).keepAwake).toBe(2);
  });

  it('refuses an unaffordable node', () => {
    state.prestige.cuts = D(0);
    expect(canBuyNode(state, 'kept-flame')).toBe(false);
    expect(buyNode(state, new EventBus(), 'kept-flame')).toBe(false);
    expect(nodeLevel(state, 'kept-flame')).toBe(0);
  });

  it('gates on requirements and never re-hides a visible node', () => {
    expect(requirementsMet(state, 'warm-start')).toBe(false);
    expect(canBuyNode(state, 'warm-start')).toBe(false);
    expect(buyNode(state, new EventBus(), 'warm-start')).toBe(false);
    expect(visibleNodes(state).map((n) => n.id)).not.toContain('warm-start');

    buyNode(state, new EventBus(), 'kept-flame');
    expect(requirementsMet(state, 'warm-start')).toBe(true);
    expect(visibleNodes(state).map((n) => n.id)).toContain('warm-start');
    expect(buyNode(state, new EventBus(), 'warm-start')).toBe(true);
    expect(derive(state).startCharge).toBe(2);
  });

  it('respects the level cap', () => {
    state.prestige.cuts = D('1e6');
    const def = CONSTELLATION.find((n) => n.id === 'kept-flame');
    if (!def) throw new Error('missing kept-flame');
    for (let i = 0; i < def.max; i++) expect(buyNode(state, new EventBus(), 'kept-flame')).toBe(true);
    expect(nodeLevel(state, 'kept-flame')).toBe(def.max);
    expect(canBuyNode(state, 'kept-flame')).toBe(false);
    expect(buyNode(state, new EventBus(), 'kept-flame')).toBe(false);
    expect(derive(state).keepAwake).toBe(12);
  });

  it('wayUnlock pushes the Way into prestige.waysUnlocked, once', () => {
    state.prestige.cuts = D('1e6');
    expect(state.prestige.waysUnlocked).toEqual(['hand', 'dealer']);
    buyNode(state, new EventBus(), 'sharper-cut');
    expect(buyNode(state, new EventBus(), 'gamblers-way')).toBe(true);
    expect(state.prestige.waysUnlocked).toEqual(['hand', 'dealer', 'gambler']);
    // The node is capped at one level, so it cannot push a duplicate.
    expect(buyNode(state, new EventBus(), 'gamblers-way')).toBe(false);
    expect(buyNode(state, new EventBus(), 'scholars-way')).toBe(true);
    expect(state.prestige.waysUnlocked).toEqual(['hand', 'dealer', 'gambler', 'scholar']);
  });
});

describe('constellation effects land in the one derivation pass', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
    for (const card of state.cards) card.awake = true;
  });

  it('folds globalMult into mults.global, so the cut threshold already includes it', () => {
    const before = derive(state).mults.global;
    state.prestige.constellation['steady-hand'] = 4; // 1 + 0.25*4 = 2x
    const after = derive(state).mults.global;
    expect(after.div(before).eq(2)).toBe(true);
  });

  it('unlocks the Auto-Dealer, shortens its beat, and extends the offline cap', () => {
    expect(derive(state).autoDealerUnlocked).toBe(false);
    expect(derive(state).dealerBeatSeconds).toBeCloseTo(0.9, 10);
    state.prestige.constellation['night-shift'] = 1;
    state.prestige.constellation['practised-dealer'] = 5;
    const d = derive(state);
    expect(d.autoDealerUnlocked).toBe(true);
    expect(d.dealerBeatSeconds).toBeCloseTo(0.9 / 1.5, 10);

    const base = derive(state).offlineCapSeconds;
    state.prestige.constellation['long-night'] = 4; // +16 h
    expect(derive(state).offlineCapSeconds).toBe(base + 16 * 3600);
  });

  it('carries mark slots for M4 without changing anything else yet', () => {
    const before = derive(state);
    state.prestige.constellation['sharper-cut'] = 1;
    state.prestige.constellation['first-mark'] = 2;
    const after = derive(state);
    expect(after.markSlots).toBe(2);
    expect(after.deckRate.eq(before.deckRate)).toBe(true);
  });

  it('multiplies burst and spark from the branch nodes', () => {
    state.prestige.constellation['quick-hands'] = 2; // spark 1 + 0.5*2 = 2x
    state.prestige.constellation['last-light'] = 2; // burst 2x
    const d = derive(state);
    expect(d.sparkMult.eq(2)).toBe(true);
    expect(d.burstMult.eq(2)).toBe(true);
  });
});

// ---- the eight new nodes (docs/02 §9 "more to buy": deeper branches, one rule twist) ---------

describe('new constellation nodes', () => {
  let state: GameState;
  beforeEach(() => {
    state = createInitialState(0);
    for (const card of state.cards) card.awake = true;
  });

  it('requires every new node to a real, already-existing branch node', () => {
    const newIds = [
      'long-memory', 'measured-cut', 'steady-rhythm', 'second-wind',
      'night-watch', 'quiet-hours', 'stacked-odds', 'second-reading'
    ];
    for (const id of newIds) {
      const def = CONSTELLATION.find((n) => n.id === id);
      if (!def) throw new Error(`missing ${id}`);
      expect(def.requires.length).toBeGreaterThan(0);
      for (const req of def.requires) expect(CONSTELLATION.map((n) => n.id)).toContain(req);
    }
  });

  it('Long Memory deepens startCharge past Warm Start', () => {
    state.prestige.constellation['long-memory'] = 3; // add 1 per level
    expect(derive(state).startCharge).toBe(3);
  });

  it('Measured Cut deepens cutYield past Sharper Cut', () => {
    const before = derive(state).cutYieldMult;
    state.prestige.constellation['measured-cut'] = 2; // per 0.08
    const after = derive(state).cutYieldMult;
    expect(after.div(before).toNumber()).toBeCloseTo(1.16, 10);
  });

  it('Steady Rhythm and Second Wind deepen the Hand branch past Quick Hands/Last Light', () => {
    state.prestige.constellation['steady-rhythm'] = 1; // spark per 0.3
    state.prestige.constellation['second-wind'] = 1; // burst per 0.4
    const d = derive(state);
    expect(d.sparkMult.toNumber()).toBeCloseTo(1.3, 10);
    expect(d.burstMult.toNumber()).toBeCloseTo(1.4, 10);
  });

  it('Quiet Hours deepens dealerSpeed past Practised Dealer', () => {
    state.prestige.constellation['night-shift'] = 1;
    const before = derive(state).dealerBeatSeconds;
    state.prestige.constellation['quiet-hours'] = 2; // per 0.08
    const after = derive(state).dealerBeatSeconds;
    expect(after).toBeCloseTo(0.9 / 1.16, 10);
    expect(after).toBeLessThan(before);
  });

  it('Stacked Odds deepens the Gambler branch with a plain globalMult', () => {
    const before = derive(state).mults.global;
    state.prestige.constellation['stacked-odds'] = 2; // per 0.12
    const after = derive(state).mults.global;
    expect(after.div(before).toNumber()).toBeCloseTo(1.24, 10);
  });

  it('Second Reading deepens Scholar mark slots past Marginalia', () => {
    state.prestige.constellation['second-reading'] = 2;
    expect(derive(state).markSlots).toBe(2);
  });

  it('Night Watch is a RULE twist, not a number: it flips autoDealerAlwaysOn and nothing else', () => {
    const before = derive(state);
    expect(before.autoDealerAlwaysOn).toBe(false);

    state.prestige.constellation['night-watch'] = 1;
    const after = derive(state);
    expect(after.autoDealerAlwaysOn).toBe(true);
    // Nothing numeric moves: the deck rate is exactly what it was before the twist.
    expect(after.deckRate.eq(before.deckRate)).toBe(true);
    expect(after.autoDealerUnlocked).toBe(before.autoDealerUnlocked);
  });
});
