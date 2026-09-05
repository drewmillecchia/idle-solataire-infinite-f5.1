import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, SAVE_VERSION, type GameState } from '$engine/state';
import { cardId, type CardId, type GameEvent } from '$engine/types';
import { derive } from '$engine/economy/derive';
import { homeCard } from '$engine/economy/cards';
import { dealHand, winHand } from '$engine/economy/hand';
import { performCut } from '$engine/economy/prestige';
import {
  attachMarks,
  availableMarks,
  canPlace,
  cardsWithMark,
  clearCard,
  hasMark,
  markSlots,
  placeMark,
  removeMark,
  TRIGGER_MARKS,
  usedSlots
} from '$engine/marks/index';
import { D } from '$engine/numbers';
import { mulberry32 } from '$engine/rng';
import { deserialize, serialize } from '$engine/save/serialize';
import { migrate } from '$engine/save/migrate';
import { ECONOMY, MARKS } from '$content/index';
import { MarksSchema } from '$content/schemas';
import marksJson from '$content/marks.json';

function withBus() {
  const events: GameEvent[] = [];
  const bus = new EventBus();
  bus.on((e) => events.push(e));
  return { bus, events };
}

/**
 * A state deep enough to place anything: 15 lifetime Cuts unlocks every mark, and the two
 * Constellation slot nodes at their real maximums give 5 + the first Cut's own slot = 6.
 */
function markState(cuts = 15): GameState {
  const state = createInitialState(0);
  state.prestige.lifetimeCuts = D(cuts);
  state.prestige.cuts = D(cuts);
  state.prestige.constellation['first-mark'] = 3;
  state.prestige.constellation['marginalia'] = 2;
  return state;
}

function place(state: GameState, bus: EventBus, mark: string, cards: CardId[]): boolean {
  return placeMark(state, bus, derive(state), mark, cards);
}

/** Wakes a card without any of the fuss (and without a home play's events). */
function wake(state: GameState, card: CardId, charge = 0): void {
  const c = state.cards[card];
  if (!c) throw new Error('bad card');
  c.awake = true;
  c.charge = charge;
}

function firedFor(events: GameEvent[], mark: string): GameEvent[] {
  return events.filter((e) => e.type === 'mark-fired' && e.mark === mark);
}

const S5 = cardId('S', 5);
const S6 = cardId('S', 6);
const S7 = cardId('S', 7);
const S4 = cardId('S', 4);
const S8 = cardId('S', 8);
const H5 = cardId('H', 5);
const D3 = cardId('D', 3);
const D9 = cardId('D', 9);
const SA = cardId('S', 1);
const HK = cardId('H', 13);

// ---- content -----------------------------------------------------------------------------

describe('marks content', () => {
  it('has unique ids', () => {
    const ids = MARKS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses via its schema and holds the fourteen documented marks', () => {
    expect(() => MarksSchema.parse(marksJson)).not.toThrow();
    expect(MARKS.map((m) => m.id).sort()).toEqual(
      [
        'anchor', 'compass', 'echo', 'ember', 'glass', 'heavy', 'kindling', 'ledger', 'lantern',
        'mirror', 'tithe', 'twin', 'wick', 'wild'
      ].sort()
    );
  });

  it('unlocks at the documented lifetime Cuts', () => {
    const at = Object.fromEntries(MARKS.map((m) => [m.id, m.unlockAtLifetimeCuts]));
    expect(at).toEqual({
      echo: 1,
      lantern: 1,
      kindling: 3,
      twin: 3,
      anchor: 6,
      wild: 6,
      mirror: 10,
      glass: 10,
      heavy: 15,
      tithe: 15,
      ember: 20,
      ledger: 24,
      compass: 28,
      wick: 32
    });
  });

  it('each mark is one glyph, one sentence, and a dry blurb', () => {
    for (const m of MARKS) {
      expect(Array.from(m.glyph)).toHaveLength(1);
      expect(m.blurb.includes('!')).toBe(false);
      expect(m.blurb.length).toBeLessThan(120);
      expect(m.rule.includes('!')).toBe(false);
      // One sentence: a single full stop, at the end.
      expect(m.rule.trim().endsWith('.')).toBe(true);
      expect(m.rule.split('.').filter((part) => part.trim().length > 0)).toHaveLength(1);
    }
    expect(MARKS.filter((m) => m.arity === 2).map((m) => m.id)).toEqual(['twin']);
  });
});

// ---- placement ---------------------------------------------------------------------------

describe('mark availability', () => {
  it('opens by lifetime Cuts, and never hides again', () => {
    const state = createInitialState(0);
    expect(availableMarks(state)).toHaveLength(0);

    state.prestige.lifetimeCuts = D(1);
    expect(availableMarks(state).map((m) => m.id)).toEqual(['echo', 'lantern']);

    state.prestige.lifetimeCuts = D(3);
    expect(availableMarks(state).map((m) => m.id)).toEqual(['echo', 'lantern', 'kindling', 'twin']);

    state.prestige.lifetimeCuts = D(15);
    expect(availableMarks(state)).toHaveLength(10); // the original ten; ember/ledger/compass/wick unlock later
    state.prestige.lifetimeCuts = D(32);
    expect(availableMarks(state)).toHaveLength(MARKS.length);
  });

  it('reveals each newly available mark exactly once', () => {
    const state = createInitialState(0);
    state.prestige.lifetimeCuts = D(1);
    const { bus, events } = withBus();

    availableMarks(state, bus);
    expect(events.map((e) => (e.type === 'reveal' ? e.feature : ''))).toEqual(['mark:echo', 'mark:lantern']);
    expect(state.revealed).toContain('mark:echo');

    events.length = 0;
    availableMarks(state, bus);
    expect(events).toHaveLength(0);

    state.prestige.lifetimeCuts = D(3);
    availableMarks(state, bus);
    expect(events.map((e) => (e.type === 'reveal' ? e.feature : ''))).toEqual(['mark:kindling', 'mark:twin']);
  });

  it('announces the marks a Cut just opened', () => {
    const state = markState(0);
    state.lifetimeShuffles = D('1e12');
    state.shuffles = D('1e12');
    for (let i = 0; i < 20; i++) wake(state, i, i % 5);
    const { bus, events } = withBus();
    attachMarks(state, bus);

    const cuts = performCut(state, bus, 'hand', 1000);
    expect(cuts.gte(1)).toBe(true);
    const revealed = events.filter((e) => e.type === 'reveal').map((e) => (e.type === 'reveal' ? e.feature : ''));
    expect(revealed).toContain('mark:echo');
    expect(revealed).toContain('mark:lantern');
  });
});

describe('slots', () => {
  it('base 0; the first Cut opens one; the Constellation adds the rest', () => {
    const state = createInitialState(0);
    expect(markSlots(state, derive(state))).toBe(0);
    expect(derive(state).markSlotsTotal).toBe(0);

    state.prestige.lifetimeCuts = D(1);
    expect(markSlots(state, derive(state))).toBe(1);

    state.prestige.constellation['first-mark'] = 3;
    expect(markSlots(state, derive(state))).toBe(4);
    // derive keeps the Constellation's own count AND the total, and never confuses the two.
    expect(derive(state).markSlots).toBe(3);
    expect(derive(state).markSlotsTotal).toBe(4);
  });

  it('refuses a placement with no slot free, and a Twin pair costs one slot', () => {
    const state = createInitialState(0);
    state.prestige.lifetimeCuts = D(3);
    const { bus } = withBus();
    expect(markSlots(state, derive(state))).toBe(1);

    expect(place(state, bus, 'twin', [SA, HK])).toBe(true);
    expect(usedSlots(state)).toBe(1);
    expect(place(state, bus, 'echo', [S5])).toBe(false);
    expect(usedSlots(state)).toBe(1);
  });
});

describe('placeMark / removeMark', () => {
  it('checks arity, distinctness, and one mark per card', () => {
    const state = markState();
    const { bus, events } = withBus();

    expect(canPlace(state, derive(state), 'echo', [S5, S6])).toBe(false); // arity 1
    expect(canPlace(state, derive(state), 'twin', [S5])).toBe(false); // arity 2
    expect(canPlace(state, derive(state), 'twin', [S5, S5])).toBe(false); // distinct
    expect(canPlace(state, derive(state), 'nonesuch', [S5])).toBe(false);
    expect(canPlace(state, derive(state), 'echo', [999])).toBe(false);

    expect(place(state, bus, 'echo', [S5])).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'purchase', id: 'mark:echo', count: 1 });
    expect(state.cards[S5]?.marks).toEqual(['echo']);

    // One mark per card — except Twin, the wire, which may share a card with one other mark.
    expect(place(state, bus, 'lantern', [S5])).toBe(false);
    expect(place(state, bus, 'twin', [S5, S6])).toBe(true);
    expect(state.cards[S5]?.marks.sort()).toEqual(['echo', 'twin']);
    // ...but never two Twins on one card, and a twinned card still takes only one other mark.
    expect(canPlace(state, derive(state), 'twin', [S5, 20])).toBe(false);
    expect(canPlace(state, derive(state), 'lantern', [S6])).toBe(true);
    expect(canPlace(state, derive(state), 'lantern', [S5])).toBe(false);
  });

  it('keeps the card cache in step with the placements', () => {
    const state = markState();
    const { bus } = withBus();
    place(state, bus, 'lantern', [D3]);
    expect(cardsWithMark(state, 'lantern')).toEqual([D3]);
    expect(hasMark(state, D3, 'lantern')).toBe(true);
    expect(state.cards[D3]?.marks).toEqual(['lantern']);

    removeMark(state, 'lantern');
    expect(state.cards[D3]?.marks).toEqual([]);
    expect(usedSlots(state)).toBe(0);
  });

  it('removing either half of a Twin removes the pair', () => {
    const state = markState();
    const { bus } = withBus();
    expect(place(state, bus, 'twin', [SA, HK])).toBe(true);

    expect(removeMark(state, 'twin', SA)).toBe(true);
    expect(state.marks.placed).toEqual([]);
    expect(state.cards[SA]?.marks).toEqual([]);
    expect(state.cards[HK]?.marks).toEqual([]);

    // ...and the same from the other side, through clearCard.
    expect(place(state, bus, 'twin', [SA, HK])).toBe(true);
    expect(clearCard(state, HK)).toBe(true);
    expect(state.marks.placed).toEqual([]);
    expect(clearCard(state, HK)).toBe(false);
  });
});

// ---- triggers ----------------------------------------------------------------------------

describe('Echo', () => {
  it('pays and charges the next card of the same rank in the hand', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    wake(state, S5);
    wake(state, H5);
    for (let i = 20; i < 30; i++) wake(state, i, 3); // a deck rate worth sparking against
    expect(place(state, bus, 'echo', [S5])).toBe(true);

    dealHand(state, bus, 'klondike', 1);
    homeCard(state, bus, S5, 'foundation-s');
    // The Echo card arms its own rank and cannot pay itself off with it.
    expect(state.run.hand.echoRanks).toEqual([5]);
    expect(firedFor(events, 'echo')).toHaveLength(0);

    events.length = 0;
    const before = state.cards[H5]?.charge ?? 0;
    homeCard(state, bus, H5, 'foundation-h');

    // +1 from the home play, +1 from the Echo.
    expect(state.cards[H5]?.charge).toBe(before + 2);
    expect(state.run.hand.echoRanks).toEqual([]);
    expect(firedFor(events, 'echo')).toEqual([{ type: 'mark-fired', mark: 'echo', card: H5, depth: 0 }]);

    // Double spark: the home play's own, plus the Echo's, equal and both real.
    const sparks = events.filter((e) => e.type === 'spark');
    expect(sparks).toHaveLength(2);
    const amounts = sparks.map((e) => (e.type === 'spark' ? e.amount : D(0)));
    expect(amounts[0]?.gt(0)).toBe(true);
    expect(amounts[0]?.eq(amounts[1] ?? D(0))).toBe(true);

    // The rank was spent: a third card of the same rank gets nothing.
    events.length = 0;
    homeCard(state, bus, cardId('D', 5), 'foundation-d');
    expect(firedFor(events, 'echo')).toHaveLength(0);
  });

  it('does not reach across hands', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    wake(state, S5);
    wake(state, H5);
    place(state, bus, 'echo', [S5]);

    dealHand(state, bus, 'klondike', 1);
    homeCard(state, bus, S5, 'foundation-s');
    expect(state.run.hand.echoRanks).toEqual([5]);
    expect(state.run.hand.homedThisHand).toEqual([S5]);

    dealHand(state, bus, 'klondike', 2);
    expect(state.run.hand.echoRanks).toEqual([]);
    expect(state.run.hand.homedThisHand).toEqual([]);

    events.length = 0;
    const before = state.cards[H5]?.charge ?? 0;
    homeCard(state, bus, H5, 'foundation-h');
    expect(state.cards[H5]?.charge).toBe(before + 1); // the home play only
    expect(firedFor(events, 'echo')).toHaveLength(0);
  });
});

describe('Kindling', () => {
  it('charges the rank-neighbours in the same suit', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    wake(state, S6);
    place(state, bus, 'kindling', [S6]);

    homeCard(state, bus, S6, 'foundation-s'); // charge-gained at depth 0
    expect(state.cards[S5]?.charge).toBe(1);
    expect(state.cards[S7]?.charge).toBe(1);
    expect(state.cards[cardId('H', 5)]?.charge).toBe(0); // same rank, other suit: untouched
    expect(firedFor(events, 'kindling')).toHaveLength(1);
  });

  it('chains stop at the depth cap', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    wake(state, S6);
    expect(place(state, bus, 'kindling', [S5])).toBe(true);
    expect(place(state, bus, 'kindling', [S6])).toBe(true);
    expect(place(state, bus, 'kindling', [S7])).toBe(true);

    homeCard(state, bus, S6, 'foundation-s');

    // The chain is finite and exactly this: 5S/6S/7S at 3 charges each, the outer 4S/8S at 1.
    // The bound: one depth-0 effect branching by 2 for at most DEPTH_CAP=3 levels is
    // 1 + 2 + 4 + 8 = 15 charge events; this arrangement produces 11.
    const total = state.cards.reduce((n, c) => n + c.charge, 0);
    expect(total).toBe(11);
    expect(total).toBeLessThanOrEqual(15);
    expect(state.cards[S4]?.charge).toBe(1);
    expect(state.cards[S5]?.charge).toBe(3);
    expect(state.cards[S6]?.charge).toBe(3);
    expect(state.cards[S7]?.charge).toBe(3);
    expect(state.cards[S8]?.charge).toBe(1);
    expect(state.cards[cardId('S', 3)]?.charge).toBe(0);

    // No effect was ever emitted beyond the cap.
    const depths = events
      .filter((e) => e.type === 'charge-gained')
      .map((e) => (e.type === 'charge-gained' ? (e.depth ?? 0) : 0));
    expect(Math.max(...depths)).toBe(3);
  });
});

describe('Twin', () => {
  it('propagates a wake, then a charge, and never loops', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'twin', [SA, HK])).toBe(true);

    homeCard(state, bus, SA, 'foundation-s'); // wakes SA
    expect(state.cards[SA]?.awake).toBe(true);
    expect(state.cards[HK]?.awake).toBe(true); // the partner woke with it
    // The partner's wake rings back once as a charge, and then stops.
    expect(state.cards[SA]?.charge).toBe(1);
    expect(state.cards[HK]?.charge).toBe(0);

    events.length = 0;
    state.run.hand.homedThisHand = []; // a new hand: a card pays once per hand
    homeCard(state, bus, SA, 'foundation-s'); // charge-gained at depth 0
    expect(state.cards[HK]?.charge).toBe(1);
    expect(state.cards[SA]?.charge).toBe(3); // +1 home, +1 the ring-back
    expect(firedFor(events, 'twin').length).toBeLessThanOrEqual(2);
    expect(events.length).toBeLessThan(20);
  });
});

describe('Heavy', () => {
  it('charges on a tableau move, and does not wake', () => {
    const state = markState();
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'heavy', [S7])).toBe(true);

    bus.emit({ type: 'card-moved', card: S7, from: 'tableau-1', to: 'tableau-3' });
    expect(state.cards[S7]?.charge).toBe(1);
    expect(state.cards[S7]?.awake).toBe(false);
    expect(firedFor(events, 'heavy')).toEqual([{ type: 'mark-fired', mark: 'heavy', card: S7, depth: 0 }]);
    const charge = events.find((e) => e.type === 'charge-gained');
    expect(charge).toMatchObject({ source: 'mark', depth: 1 });

    // An unmarked card's move does nothing.
    events.length = 0;
    bus.emit({ type: 'card-moved', card: S6, from: 'tableau-1', to: 'tableau-3' });
    expect(state.cards[S6]?.charge).toBe(0);
    expect(events.filter((e) => e.type === 'mark-fired')).toHaveLength(0);
  });
});

describe('Ember', () => {
  it('charges the last card that came home before this one wakes', () => {
    const state = markState(32);
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'ember', [H5])).toBe(true);

    dealHand(state, bus, 'klondike', 1);
    homeCard(state, bus, S5, 'foundation-s'); // first home this hand: nothing came before it
    expect(state.run.hand.homedThisHand).toEqual([S5]);

    events.length = 0;
    const before = state.cards[S5]?.charge ?? 0;
    homeCard(state, bus, H5, 'foundation-h'); // wakes the Ember card: S5 (the last home) gains a charge
    expect(state.cards[S5]?.charge).toBe(before + 1);
    expect(firedFor(events, 'ember')).toEqual([{ type: 'mark-fired', mark: 'ember', card: H5, depth: 0 }]);
  });

  it('does nothing for the first card home in a hand', () => {
    const state = markState(32);
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'ember', [S5])).toBe(true);
    dealHand(state, bus, 'klondike', 1);
    homeCard(state, bus, S5, 'foundation-s'); // nothing came home before this one
    expect(firedFor(events, 'ember')).toHaveLength(0);
  });

  it('also answers a mark-driven wake, crediting whichever card is last in the hand ledger', () => {
    const state = markState(32);
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'ember', [S7])).toBe(true);
    dealHand(state, bus, 'klondike', 1);
    homeCard(state, bus, S5, 'foundation-s');

    events.length = 0;
    const before = state.cards[S5]?.charge ?? 0;
    bus.emit({ type: 'card-woken', card: S7, depth: 0 }); // e.g. a Twin-driven wake
    expect(state.cards[S5]?.charge).toBe(before + 1);
    expect(firedFor(events, 'ember')).toEqual([{ type: 'mark-fired', mark: 'ember', card: S7, depth: 0 }]);
  });
});

describe('Wick', () => {
  it('adds a charge on every hand won, and stops once charge reaches five', () => {
    const state = markState(32);
    const { bus, events } = withBus();
    attachMarks(state, bus);
    expect(place(state, bus, 'wick', [S5])).toBe(true);

    for (let i = 0; i < 7; i++) {
      dealHand(state, bus, 'klondike', i);
      winHand(state, bus, { game: 'klondike', moves: 1, seconds: 10 });
    }
    expect(state.cards[S5]?.charge).toBe(5);
    expect(firedFor(events, 'wick').length).toBeGreaterThanOrEqual(5);

    // A hand won past the cap fires nothing further for this card.
    events.length = 0;
    dealHand(state, bus, 'klondike', 99);
    winHand(state, bus, { game: 'klondike', moves: 1, seconds: 10 });
    expect(state.cards[S5]?.charge).toBe(5);
    expect(firedFor(events, 'wick')).toHaveLength(0);
  });
});

// ---- passives ----------------------------------------------------------------------------

describe('Lantern', () => {
  it('lifts its suit x1.5 only while awake, and stacks multiplicatively', () => {
    const state = markState();
    const { bus } = withBus();
    wake(state, D3, 2);
    wake(state, D9, 2);
    wake(state, S5, 2);
    const base = derive(state);
    const baseD9 = base.perCard[D9] ?? D(0);
    const baseS5 = base.perCard[S5] ?? D(0);

    expect(place(state, bus, 'lantern', [D3])).toBe(true);
    const lit = derive(state);
    expect((lit.perCard[D9] ?? D(0)).div(baseD9).toNumber()).toBeCloseTo(1.5, 10);
    expect((lit.perCard[S5] ?? D(0)).eq(baseS5)).toBe(true); // other suits untouched
    expect(lit.mults.suit.D.toNumber()).toBeCloseTo(1.5, 10);

    // A second Lantern in the suit stacks.
    expect(place(state, bus, 'lantern', [cardId('D', 7)])).toBe(true);
    wake(state, cardId('D', 7));
    expect((derive(state).perCard[D9] ?? D(0)).div(baseD9).toNumber()).toBeCloseTo(2.25, 10);

    // Asleep, a Lantern lights nothing.
    const sleeping = state.cards[D3];
    const sleeping7 = state.cards[cardId('D', 7)];
    if (sleeping) sleeping.awake = false;
    if (sleeping7) sleeping7.awake = false;
    expect((derive(state).perCard[D9] ?? D(0)).eq(baseD9)).toBe(true);
  });
});

describe('Tithe', () => {
  it('zeroes its own output and lifts every other card of its suit x1.25', () => {
    const state = markState();
    const { bus } = withBus();
    wake(state, D3, 2);
    wake(state, D9, 2);
    wake(state, S5, 2);
    const base = derive(state);
    const baseD3 = base.perCard[D3] ?? D(0);
    const baseD9 = base.perCard[D9] ?? D(0);
    expect(baseD3.gt(0)).toBe(true);

    expect(place(state, bus, 'tithe', [D3])).toBe(true);
    const tithed = derive(state);
    expect((tithed.perCard[D3] ?? D(1)).eq(0)).toBe(true);
    expect((tithed.perCard[D9] ?? D(0)).div(baseD9).toNumber()).toBeCloseTo(1.25, 10);
    expect((tithed.perCard[S5] ?? D(0)).eq(base.perCard[S5] ?? D(0))).toBe(true);
  });
});

describe('Ledger', () => {
  it("counts its own charge twice toward the Devotion upgrade's count", () => {
    const state = markState(32);
    const { bus } = withBus();
    state.run.upgrades['devotion'] = 1; // per = 0.4
    state.run.homedThisRun = 10;
    wake(state, S5, 3);

    const base = derive(state).mults.devotion;
    expect(place(state, bus, 'ledger', [S5])).toBe(true);
    const withLedger = derive(state).mults.devotion;

    const expectedBase = 1 + 0.4 * Math.log10(1 + 10);
    const expectedWithLedger = 1 + 0.4 * Math.log10(1 + 10 + 3); // +charge, counted a second time
    expect(base.toNumber()).toBeCloseTo(expectedBase, 10);
    expect(withLedger.toNumber()).toBeCloseTo(expectedWithLedger, 10);
  });
});

describe('Compass', () => {
  it("gives the lowest-charged awake card of its suit this card's own charge", () => {
    const state = markState(32);
    const { bus } = withBus();
    wake(state, D3, 5); // the Compass card
    wake(state, D9, 0); // the lowest-charged awake card of suit D
    wake(state, cardId('D', 5), 2);
    const base = derive(state);
    const baseD9 = base.perCard[D9] ?? D(0);
    const baseD3 = base.perCard[D3] ?? D(0);

    expect(place(state, bus, 'compass', [D3])).toBe(true);
    const after = derive(state);
    // D9 now earns as though its charge were 5 (D3's), not 0: (1 + 0.1*5) / (1 + 0.1*0) = 1.5.
    expect((after.perCard[D9] ?? D(0)).div(baseD9).toNumber()).toBeCloseTo(1.5, 10);
    // The Compass card is not the lowest-charged of its suit, so its own output is untouched.
    expect((after.perCard[D3] ?? D(0)).eq(baseD3)).toBe(true);
  });

  it('does nothing while the Compass card itself is asleep', () => {
    const state = markState(32);
    const { bus } = withBus();
    wake(state, D9, 0);
    const withoutCompass = derive(state).perCard[D9] ?? D(0);

    wake(state, D3, 5);
    const compassCard = state.cards[D3];
    if (compassCard) compassCard.awake = false; // placed, but asleep
    expect(place(state, bus, 'compass', [D3])).toBe(true);
    expect((derive(state).perCard[D9] ?? D(0)).eq(withoutCompass)).toBe(true);
  });
});

describe('Anchor', () => {
  it('keeps wake and charge through a Cut while everything else resets', () => {
    const state = markState(6);
    const { bus } = withBus();
    for (let i = 0; i < 20; i++) wake(state, i, 4);
    wake(state, HK, 9);
    expect(place(state, bus, 'anchor', [HK])).toBe(true);
    state.lifetimeShuffles = D('1e12');
    state.shuffles = D('1e12');

    const cuts = performCut(state, bus, 'hand', 60_000);
    expect(cuts.gte(1)).toBe(true);
    expect(state.cards[HK]?.awake).toBe(true);
    expect(state.cards[HK]?.charge).toBe(9);
    expect(state.cards[0]?.awake).toBe(false);
    expect(state.cards[0]?.charge).toBe(0);
    // The placement itself survives the Cut, and so does the per-hand scratch's reset.
    expect(state.marks.placed).toEqual([{ mark: 'anchor', cards: [HK] }]);
    expect(state.run.hand).toEqual({ echoRanks: [], homedThisHand: [], roll: 1, seed: 0, fizzleSeq: 0 });
  });
});

// ---- save --------------------------------------------------------------------------------

describe('save round-trip', () => {
  it('round-trips placements and rebuilds the card cache', () => {
    const state = markState();
    const { bus } = withBus();
    place(state, bus, 'twin', [SA, HK]);
    place(state, bus, 'lantern', [D3]);
    state.run.hand = { echoRanks: [5, 9], homedThisHand: [SA], roll: 1, seed: 7, fizzleSeq: 2 };

    const restored = deserialize(serialize(state));
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.marks.placed).toEqual([
      { mark: 'twin', cards: [SA, HK] },
      { mark: 'lantern', cards: [D3] }
    ]);
    expect(restored.cards[SA]?.marks).toEqual(['twin']);
    expect(restored.cards[HK]?.marks).toEqual(['twin']);
    expect(restored.cards[D3]?.marks).toEqual(['lantern']);
    expect(restored.run.hand).toEqual({ echoRanks: [5, 9], homedThisHand: [SA], roll: 1, seed: 7, fizzleSeq: 2 });
  });

  it('migrates v2 -> v3 with empty marks and an empty hand', () => {
    const v2 = {
      version: 2,
      run: { way: 'hand', handsPlayed: 3 },
      prestige: { waysUnlocked: ['hand'] }
    };
    const out = migrate(v2 as Record<string, unknown>);
    expect(out.version).toBe(3);
    expect(out.marks).toEqual({ placed: [] });
    expect((out.run as Record<string, unknown>).hand).toEqual({ echoRanks: [], homedThisHand: [] });
  });

  it('a v2 save string deserializes into a whole v3 state', () => {
    const base = markState();
    const v2json = serialize(base).replace('"version":3', '"version":2');
    const restored = deserialize(v2json);
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.marks.placed).toEqual([]);
    expect(restored.run.hand).toEqual({ echoRanks: [], homedThisHand: [], roll: 1, seed: 0, fizzleSeq: 0 });
  });

  it('repairs garbage marks without throwing or losing the rest of the save', () => {
    const raw = JSON.stringify({
      version: 3,
      shuffles: { $d: '500' },
      marks: {
        placed: [
          { mark: 'not-a-mark', cards: [1] }, // unknown id
          { mark: 'echo', cards: [1, 2] }, // wrong arity
          { mark: 'twin', cards: [3, 3] }, // the same card twice
          { mark: 'twin', cards: [4, 999] }, // a card off the deck
          { mark: 'lantern', cards: ['nine'] }, // not a card id
          { mark: 'kindling', cards: [7] }, // good
          { mark: 'heavy', cards: [7] }, // that card is taken
          'nonsense',
          null
        ]
      },
      run: { hand: { echoRanks: [5, 'x', 99], homedThisHand: [3, 'y'] } }
    });

    expect(() => deserialize(raw)).not.toThrow();
    const state = deserialize(raw);
    expect(state.shuffles.eq(500)).toBe(true);
    expect(state.marks.placed).toEqual([{ mark: 'kindling', cards: [7] }]);
    expect(state.cards[7]?.marks).toEqual(['kindling']);
    expect(state.cards[1]?.marks).toEqual([]);
    expect(state.run.hand).toEqual({ echoRanks: [5], homedThisHand: [3], roll: 1, seed: 0, fizzleSeq: 0 });
  });

  it('survives marks that are not even an object', () => {
    for (const bad of ['{"version":3,"marks":42}', '{"version":3,"marks":{"placed":"nope"}}']) {
      const state = deserialize(bad);
      expect(state.marks.placed).toEqual([]);
      expect(state.cards).toHaveLength(52);
    }
  });
});

// ---- Gambler Mark fizzle (docs/02-game-design.md 5) ---------------------------------------

function firstSeedWhere(predicate: (u: number) => boolean): number {
  for (let s = 0; s < 100_000; s++) {
    if (predicate(mulberry32(s)())) return s;
  }
  throw new Error('no seed found in range');
}

/** A guaranteed-to-fizzle seed: `rollFizzle` reads `mulberry32(hand.seed ^ 0)()` on the first opportunity. */
function firstFizzleSeed(): number {
  return firstSeedWhere((u) => u < ECONOMY.gamblerFizzleChance);
}

/** A guaranteed-NOT-to-fizzle seed, same reasoning. */
function firstNonFizzleSeed(): number {
  return firstSeedWhere((u) => u >= ECONOMY.gamblerFizzleChance);
}

/** A Heavy card in the Gambler, dealt with `seed`, ready for repeated `card-moved` opportunities. */
function heavyGamblerState(seed: number): { state: GameState; bus: EventBus; events: GameEvent[] } {
  const state = markState();
  const { bus, events } = withBus();
  attachMarks(state, bus);
  expect(place(state, bus, 'heavy', [S7])).toBe(true);
  state.run.way = 'gambler';
  state.prestige.waysUnlocked.push('gambler');
  dealHand(state, bus, 'klondike', seed);
  events.length = 0;
  return { state, bus, events };
}

function moveS7(bus: EventBus): void {
  bus.emit({ type: 'card-moved', card: S7, from: 'tableau-1', to: 'tableau-2' });
}

describe('Gambler Mark fizzle', () => {
  it('is a trigger-mark-only concept: exactly echo, kindling, twin, heavy, ember, wick', () => {
    expect(TRIGGER_MARKS.slice().sort()).toEqual(['echo', 'ember', 'heavy', 'kindling', 'twin', 'wick']);
  });

  it('is deterministic: the same hand seed reproduces the same fizzle sequence exactly', () => {
    function runSequence(seed: number): boolean[] {
      const { bus, events } = heavyGamblerState(seed);
      const out: boolean[] = [];
      for (let i = 0; i < 50; i++) {
        events.length = 0;
        moveS7(bus);
        const fired = events.find((e) => e.type === 'mark-fired');
        out.push(fired?.type === 'mark-fired' ? Boolean(fired.fizzled) : false);
      }
      return out;
    }
    const a = runSequence(123);
    const b = runSequence(123);
    expect(a).toEqual(b);
    // The 50-opportunity run should exercise both a fizzle and a real fire, or the test proves nothing.
    expect(a.some(Boolean)).toBe(true);
    expect(a.some((x) => !x)).toBe(true);
  });

  it('a different hand seed gives a different fizzle sequence', () => {
    function runSequence(seed: number): boolean[] {
      const { bus, events } = heavyGamblerState(seed);
      const out: boolean[] = [];
      for (let i = 0; i < 50; i++) {
        events.length = 0;
        moveS7(bus);
        const fired = events.find((e) => e.type === 'mark-fired');
        out.push(fired?.type === 'mark-fired' ? Boolean(fired.fizzled) : false);
      }
      return out;
    }
    expect(runSequence(1)).not.toEqual(runSequence(2));
  });

  it('fizzles about 10% of the time over 200 deterministic trigger opportunities (within 0.05)', () => {
    const { state, bus, events } = heavyGamblerState(999);
    let fizzles = 0;
    for (let i = 0; i < 200; i++) {
      events.length = 0;
      moveS7(bus);
      const fired = events.find((e) => e.type === 'mark-fired');
      if (fired?.type === 'mark-fired' && fired.fizzled) fizzles++;
    }
    expect(state.run.hand.fizzleSeq).toBe(200);
    const rate = fizzles / 200;
    expect(Math.abs(rate - ECONOMY.gamblerFizzleChance)).toBeLessThan(0.05);
  });

  it('a fizzled mark emits fizzled: true, and applies no charge', () => {
    const seed = firstFizzleSeed();
    const { state, bus, events } = heavyGamblerState(seed);
    const before = state.cards[S7]?.charge ?? 0;
    moveS7(bus);
    expect(events.filter((e) => e.type === 'mark-fired')).toEqual([
      { type: 'mark-fired', mark: 'heavy', card: S7, depth: 0, fizzled: true }
    ]);
    expect(events.some((e) => e.type === 'charge-gained')).toBe(false);
    expect(state.cards[S7]?.charge).toBe(before);
  });

  it('a non-fizzled mark fires exactly as before, with no fizzled field', () => {
    const seed = firstNonFizzleSeed();
    const { state, bus, events } = heavyGamblerState(seed);
    const before = state.cards[S7]?.charge ?? 0;
    moveS7(bus);
    const fired = events.find((e) => e.type === 'mark-fired');
    expect(fired).toEqual({ type: 'mark-fired', mark: 'heavy', card: S7, depth: 0 });
    expect(state.cards[S7]?.charge).toBe(before + 1);
  });

  it('outside the Gambler, nothing ever fizzles', () => {
    for (const way of ['none', 'hand', 'dealer', 'scholar'] as const) {
      const state = markState();
      const { bus, events } = withBus();
      attachMarks(state, bus);
      expect(place(state, bus, 'heavy', [S7])).toBe(true);
      state.run.way = way;
      dealHand(state, bus, 'klondike', 42);
      events.length = 0;

      for (let i = 0; i < 200; i++) moveS7(bus);

      const fired = events.filter((e) => e.type === 'mark-fired');
      expect(fired).toHaveLength(200);
      expect(fired.every((e) => e.type === 'mark-fired' && !e.fizzled)).toBe(true);
      expect(state.cards[S7]?.charge).toBe(200);
    }
  });

  it('leaves passives (Lantern) and twists (unlock list) unaffected in the Gambler', () => {
    const state = markState();
    const { bus } = withBus();
    wake(state, D3, 2);
    wake(state, D9, 2);
    const base = derive(state);
    const baseD9 = base.perCard[D9] ?? D(0);
    expect(place(state, bus, 'lantern', [D3])).toBe(true);
    state.run.way = 'gambler';

    const lit = derive(state);
    expect((lit.perCard[D9] ?? D(0)).div(baseD9).toNumber()).toBeCloseTo(1.5, 10);
    // Twists are not events at all; the interpreter never touches them, fizzle or not.
    expect(MARKS.filter((m) => m.kind === 'twist').map((m) => m.id).sort()).toEqual(['glass', 'mirror', 'wild']);
  });
});

// ---- save v5 (Gambler Mark fizzle: run.hand.seed, run.hand.fizzleSeq) ----------------------

describe('save v5', () => {
  it('migrates a v4 save: fills seed and fizzleSeq defensively', () => {
    const state = markState();
    dealHand(state, new EventBus(), 'klondike', 55);
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    raw.version = 4;
    const run = raw.run as Record<string, unknown>;
    const hand = run.hand as Record<string, unknown>;
    delete hand.seed;
    delete hand.fizzleSeq;

    // `migrate` advances one version per call; this asserts the 4 -> 5 step, not the whole chain.
    const migrated = migrate(raw) as Record<string, unknown>;
    expect(migrated.version).toBe(5);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(5);
    const migratedHand = (migrated.run as Record<string, unknown>).hand as Record<string, unknown>;
    expect(migratedHand.seed).toBe(0);
    expect(migratedHand.fizzleSeq).toBe(0);

    const restored = deserialize(JSON.stringify(raw));
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.run.hand.seed).toBe(0);
    expect(restored.run.hand.fizzleSeq).toBe(0);
  });

  it('a v4 save string (predating seed/fizzleSeq entirely) still loads', () => {
    const raw = {
      version: 4,
      run: { way: 'gambler', hand: { echoRanks: [], homedThisHand: [], roll: 1.4 } }
    };
    expect(() => deserialize(JSON.stringify(raw))).not.toThrow();
    const state = deserialize(JSON.stringify(raw));
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.cards).toHaveLength(52);
    expect(state.run.hand.seed).toBe(0);
    expect(state.run.hand.fizzleSeq).toBe(0);
    expect(state.run.hand.roll).toBeCloseTo(1.4, 9);
  });
});
