/**
 * engine/deck.ts: the deck-shape refactor (docs/12-ascension.md, "Sequencing" step 1). Exactly
 * one shape exists — the standard 52 — and everything reads it. These tests are the "no
 * behaviour change" contract: every value here must match what the engine produced before the
 * refactor.
 */
import { describe, expect, it } from 'vitest';
import { D } from '$engine/numbers';
import { NUMBERING_ORDER, rankValue } from '$engine/numbering';
import { cardDef, STANDARD_DECK } from '$engine/types';
import type { NumberingId, Rank } from '$engine/types';
import {
  DECK_SHAPES,
  STANDARD_52,
  cardDefIn,
  deckCards,
  deckShape,
  deckSize
} from '$engine/deck';
import { FACT_52, deckFactorial } from '$engine/permutation';
import { deserialize } from '$engine/save/serialize';
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
