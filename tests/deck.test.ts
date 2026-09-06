/**
 * engine/deck.ts: deck shapes (docs/12-ascension.md). The first half of this file is the "no
 * behaviour change" contract from step 1 — every value must match what the engine produced before
 * the deck became data. The second half covers step 2: the card universe every shape is a prefix
 * of, the Joker shape, and what a card with no suit and no rank does to the economy.
 */
import { describe, expect, it } from 'vitest';
import { D } from '$engine/numbers';
import { NUMBERING_ORDER, rankValue } from '$engine/numbering';
import { cardDef, cardId, STANDARD_DECK } from '$engine/types';
import type { NumberingId, Rank } from '$engine/types';
import {
  ALL_CARDS,
  DECK_LADDER,
  DECK_SHAPES,
  JOKER_53,
  JOKER_ID,
  STANDARD_52,
  cardDefAnywhere,
  cardDefIn,
  deckCardIds,
  deckCards,
  deckShape,
  deckSize,
  isJoker,
  type DeckShape
} from '$engine/deck';
import { FACT_52, deckFactorial } from '$engine/permutation';
import { deserialize } from '$engine/save/serialize';
import { SAVE_VERSION } from '$engine/state';
import { derive } from '$engine/economy/derive';
import { pruneMarksForShape } from '$engine/marks/placement';
import { migrate } from '$engine/save/migrate';

describe('STANDARD_52 shape', () => {
  it('has 4 suits, 13 ranks, no extras, and a size of 52', () => {
    expect(STANDARD_52.suits).toHaveLength(4);
    expect(STANDARD_52.ranks).toHaveLength(13);
    expect(STANDARD_52.extras).toHaveLength(0);
    expect(deckSize(STANDARD_52)).toBe(52);
  });

  it('is registered in DECK_SHAPES under its own id', () => {
    expect(DECK_SHAPES[STANDARD_52.id]).toBe(STANDARD_52);
  });
});

describe('deckCards', () => {
  it('produces 52 unique ids matching STANDARD_DECK element for element', () => {
    const cards = deckCards(STANDARD_52);
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((c) => c.id)).size).toBe(52);
    expect(cards).toEqual(STANDARD_DECK);
  });
});

describe('cardDefIn', () => {
  it('agrees with the standard-deck-only cardDef for every id 0..51', () => {
    for (let id = 0; id < 52; id++) {
      expect(cardDefIn(STANDARD_52, id)).toEqual(cardDef(id));
    }
  });

  it('throws RangeError for an id outside the shape', () => {
    expect(() => cardDefIn(STANDARD_52, 52)).toThrow(RangeError);
    expect(() => cardDefIn(STANDARD_52, -1)).toThrow(RangeError);
  });
});

describe('deckShape', () => {
  it('returns the standard 52 for an unknown or missing id (defensive, invariant #10)', () => {
    expect(deckShape('nonsense')).toBe(STANDARD_52);
    expect(deckShape('')).toBe(STANDARD_52);
  });

  it('returns the registered shape for a known id', () => {
    expect(deckShape('standard-52')).toBe(STANDARD_52);
  });
});

describe('numbering is unchanged for the standard deck', () => {
  // Expected raw sequences, computed independently of engine/numbering.ts, so this catches any
  // drift introduced by generalizing the old 13/91 literals into shape-derived values.
  const RANKS_1_13 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const PRIMES_13 = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];

  function fibonacci13(): number[] {
    const out: number[] = [];
    let a = 1;
    let b = 2;
    for (let i = 0; i < 13; i++) {
      out.push(a);
      const next = a + b;
      a = b;
      b = next;
    }
    return out;
  }

  function factorials13(): number[] {
    const out: number[] = [];
    let acc = 1;
    for (let r = 1; r <= 13; r++) {
      acc *= r;
      out.push(acc);
    }
    return out;
  }

  // tetration is excluded: by design it collapses to "the whole 91 lands on rank 13" once the
  // sequence's dynamic range overruns float precision — numbering.test.ts already covers that
  // case, and literal-sum comparison doesn't apply to it.
  const RAW_SEQUENCES: Record<string, number[]> = {
    natural: RANKS_1_13,
    prime: PRIMES_13,
    triangular: RANKS_1_13.map((r) => (r * (r + 1)) / 2),
    fibonacci: fibonacci13(),
    powers: RANKS_1_13.map((r) => 2 ** (r - 1)),
    factorial: factorials13()
  };

  it('matches an independently computed normalization for six of the seven systems', () => {
    for (const [id, raw] of Object.entries(RAW_SEQUENCES)) {
      const sum = raw.reduce((a, b) => a + b, 0);
      for (let i = 0; i < 13; i++) {
        const rawValue = raw[i] as number;
        const expected = rawValue * (91 / sum);
        const actual = rankValue(id as NumberingId, (i + 1) as Rank).toNumber();
        expect(actual).toBeCloseTo(expected, 6);
      }
    }
  });

  it('every system in NUMBERING_ORDER sums to the literal 91 per suit (13 ranks)', () => {
    for (const id of NUMBERING_ORDER) {
      const total = RANKS_1_13.reduce((acc, r) => acc.plus(rankValue(id, r as Rank)), D(0));
      const relError = total.minus(91).abs().div(91).toNumber();
      expect(relError).toBeLessThan(1e-9);
    }
  });

  it('keeps natural values exactly equal to the rank, as before', () => {
    expect(rankValue('natural', 1).eq(1)).toBe(true);
    expect(rankValue('natural', 13).eq(13)).toBe(true);
  });
});

describe('deckFactorial / log10DeckFactorial', () => {
  it('deckFactorial(STANDARD_52) equals FACT_52', () => {
    expect(deckFactorial(STANDARD_52)).toBe(FACT_52);
  });
});

describe('save migration and repair read the deck shape', () => {
  it('v6 -> v7 migration adds deck: "standard-52" when missing', () => {
    const migrated = migrate({ version: 6, stats: { perGame: {} } });
    expect(migrated.version).toBe(7);
    expect(migrated.deck).toBe('standard-52');
  });

  it('leaves an existing deck id alone through the v6 -> v7 step', () => {
    const migrated = migrate({ version: 6, deck: 'standard-52', stats: { perGame: {} } });
    expect(migrated.deck).toBe('standard-52');
  });

  it('deserialize repairs a save with no deck field at all', () => {
    const state = deserialize('{}');
    expect(state.deck).toBe('standard-52');
  });

  it('deserialize repairs an unknown deck id to standard-52', () => {
    const state = deserialize(JSON.stringify({ version: 7, deck: 'nonsense-deck' }));
    expect(state.deck).toBe('standard-52');
  });

  it('pads a too-short cards array (10) to the shape size (52)', () => {
    const raw = JSON.stringify({
      version: 7,
      deck: 'standard-52',
      cards: Array.from({ length: 10 }, () => ({ awake: true, charge: 2, marks: [] }))
    });
    const state = deserialize(raw);
    expect(state.cards).toHaveLength(52);
    expect(state.cards[0]).toEqual({ awake: true, charge: 2, marks: [] });
    expect(state.cards[51]).toEqual({ awake: false, charge: 0, marks: [] });
  });

  it('truncates a too-long cards array (60) to the shape size (52)', () => {
    const raw = JSON.stringify({
      version: 7,
      deck: 'standard-52',
      cards: Array.from({ length: 60 }, (_, i) => ({ awake: true, charge: i, marks: [] }))
    });
    const state = deserialize(raw);
    expect(state.cards).toHaveLength(52);
    expect(state.cards[51]).toEqual({ awake: true, charge: 51, marks: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// Step 2 (docs/12-ascension.md): the Joker shape, and the universe every shape is a prefix of.
// ---------------------------------------------------------------------------------------------

describe('the card universe', () => {
  it('numbers the first 52 cards exactly as the game always has: S,H,D,C x A..K', () => {
    // This is a SAVE COMPATIBILITY test, not a style one. Every placed Mark, every homed-this-hand
    // entry and every constellation payload in a live save is a card id. Reordering the universe
    // would move all of them onto different cards, silently.
    const suits = ['S', 'H', 'D', 'C'] as const;
    ALL_CARDS.slice(0, 52).forEach((card, i) => {
      expect(card.id).toBe(i);
      expect(card.suit).toBe(suits[Math.floor(i / 13)]);
      expect(card.rank).toBe((i % 13) + 1);
    });
  });

  it('makes every shape a prefix of the next, so a card id means one card in all of them', () => {
    for (let i = 1; i < DECK_LADDER.length; i++) {
      const smaller = DECK_LADDER[i - 1] as DeckShape;
      const bigger = DECK_LADDER[i] as DeckShape;
      expect(deckSize(bigger)).toBeGreaterThan(deckSize(smaller));
      expect(deckCards(bigger).slice(0, deckSize(smaller))).toEqual(deckCards(smaller));
    }
  });
});

describe('JOKER_53', () => {
  it('is the standard 52 plus one card at id 52', () => {
    expect(deckSize(JOKER_53)).toBe(53);
    expect(JOKER_ID).toBe(52);
    expect(cardDefIn(JOKER_53, JOKER_ID)).toEqual({ id: 52, suit: 'J', rank: 0 });
    expect(deckCardIds(JOKER_53)).toHaveLength(53);
  });

  it('holds the one card that is wild by nature, and no other', () => {
    expect(isJoker(JOKER_ID)).toBe(true);
    for (let id = 0; id < 52; id++) expect(isJoker(id)).toBe(false);
  });

  it('is not in the standard deck, though the universe still knows it', () => {
    expect(() => cardDefIn(STANDARD_52, JOKER_ID)).toThrow(RangeError);
    expect(cardDefAnywhere(JOKER_ID).suit).toBe('J');
    expect(deckShape('joker-53')).toBe(JOKER_53);
  });

  it('has 53! as its journey target', () => {
    let expected = 1n;
    for (let i = 2n; i <= 53n; i++) expected *= i;
    expect(deckFactorial(JOKER_53)).toBe(expected);
    expect(deckFactorial(JOKER_53)).toBe(deckFactorial(STANDARD_52) * 53n);
  });
});

describe('a card with no rank of its own', () => {
  it('is worth the average rank under every numbering system, exactly', () => {
    // 91 / 13 = 7. The point is that it is the SAME 7 under tetration, where rank 13 holds the
    // whole 91 — a Joker that copied the top rank would double the deck's output on arrival.
    for (const id of NUMBERING_ORDER) {
      expect(rankValue(id, 0).toNumber()).toBeCloseTo(7, 9);
    }
  });

  it('leaves every real rank value untouched', () => {
    expect(rankValue('natural', 13).eq(13)).toBe(true);
    expect(rankValue('natural', 1).eq(1)).toBe(true);
  });
});

describe('a card with no suit', () => {
  function jokerState() {
    // Through the save path, so the repair pass is what sizes the deck to 53 — the same route a
    // real Ascension save would take.
    const st = deserialize(JSON.stringify({ version: SAVE_VERSION, deck: 'joker-53' }));
    for (const c of st.cards) c.awake = true;
    return st;
  }

  it('deserializes to a 53-card deck', () => {
    const st = jokerState();
    expect(st.deck).toBe('joker-53');
    expect(st.cards).toHaveLength(53);
  });

  it('earns exactly what an average rank earns — the same as the seven, under Natural', () => {
    const st = jokerState();
    const d = derive(st);
    expect(d.perCard[JOKER_ID]?.toNumber()).toBeCloseTo(d.perCard[cardId('S', 7)]?.toNumber() ?? 0, 9);
  });

  it('takes no suit multiplier: a Lantern on it lifts nothing', () => {
    const plain = derive(jokerState()).deckRate;

    const onJoker = jokerState();
    onJoker.marks.placed = [{ mark: 'lantern', cards: [JOKER_ID] }];
    expect(derive(onJoker).deckRate.eq(plain)).toBe(true);

    // ... whereas the same Lantern on a suited card lifts that whole suit, which is what makes the
    // assertion above a real one rather than a Lantern that never works.
    const onSpade = jokerState();
    onSpade.marks.placed = [{ mark: 'lantern', cards: [cardId('S', 7)] }];
    expect(derive(onSpade).deckRate.gt(plain)).toBe(true);
  });

  it('is never the favored or a laggard suit, however much charge it carries', () => {
    const st = jokerState();
    const joker = st.cards[JOKER_ID];
    if (joker) joker.charge = 10_000;
    // Favored/laggard suits are chosen from the four suits; an unsuited card contributes to no
    // suit total, so a Joker with all the charge in the deck cannot tip that choice.
    const withCharge = derive(st);
    const without = derive(jokerState());
    expect(withCharge.mults.suit).toEqual(without.mults.suit);
  });
});

describe('marks across a change of shape', () => {
  it('keeps a mark on the Joker while the deck holds it', () => {
    const raw = JSON.stringify({
      version: SAVE_VERSION,
      deck: 'joker-53',
      marks: { placed: [{ mark: 'lantern', cards: [JOKER_ID] }] }
    });
    const st = deserialize(raw);
    expect(st.marks.placed).toEqual([{ mark: 'lantern', cards: [JOKER_ID] }]);
    expect(st.cards[JOKER_ID]?.marks).toEqual(['lantern']);
  });

  it('drops that same mark when the save is read against a deck without the card', () => {
    const raw = JSON.stringify({
      version: SAVE_VERSION,
      deck: 'standard-52',
      marks: { placed: [{ mark: 'lantern', cards: [JOKER_ID] }, { mark: 'tithe', cards: [3] }] }
    });
    const st = deserialize(raw);
    expect(st.marks.placed).toEqual([{ mark: 'tithe', cards: [3] }]);
  });

  it('prunes a Twin whole rather than leaving half a wire', () => {
    const st = deserialize(JSON.stringify({ version: SAVE_VERSION, deck: 'joker-53' }));
    st.marks.placed = [
      { mark: 'twin', cards: [3, JOKER_ID] },
      { mark: 'lantern', cards: [4] }
    ];
    st.deck = 'standard-52';
    expect(pruneMarksForShape(st)).toBe(1);
    expect(st.marks.placed).toEqual([{ mark: 'lantern', cards: [4] }]);
    expect(st.cards[3]?.marks).toEqual([]);
  });

  it('prunes nothing when every marked card is still in the deck', () => {
    const st = deserialize(JSON.stringify({ version: SAVE_VERSION, deck: 'standard-52' }));
    st.marks.placed = [{ mark: 'lantern', cards: [4] }];
    expect(pruneMarksForShape(st)).toBe(0);
  });
});
