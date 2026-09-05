/**
 * The 52! odometer (engine/permutation.ts, ADR-004). Pure bigint arithmetic: the assertions here
 * are exact, not approximate, everywhere except the documented Decimal -> bigint precision loss.
 */
import { describe, expect, it } from 'vitest';
import {
  FACT_52,
  LOG10_FACT_52,
  arrangementFromIndex,
  arrangementIndex,
  factorial,
  indexFromArrangement,
  journeyFraction
} from '$engine/permutation';
import { createInitialState } from '$engine/state';
import { D } from '$engine/numbers';
import { mulberry32, shuffle } from '$engine/rng';

const FACT_52_DIGITS = '80658175170943878571660636856403766975289505440883277824000000000000';

describe('factorial', () => {
  it('is exact for the small cases', () => {
    expect(factorial(0)).toBe(1n);
    expect(factorial(1)).toBe(1n);
    expect(factorial(5)).toBe(120n);
    expect(factorial(20)).toBe(2432902008176640000n);
  });

  it('rejects a bad argument rather than returning nonsense', () => {
    expect(() => factorial(-1)).toThrow(RangeError);
    expect(() => factorial(2.5)).toThrow(RangeError);
  });
});

describe('52!', () => {
  it('has 68 digits and starts with 8065817517094387857', () => {
    const s = FACT_52.toString();
    expect(s).toHaveLength(68);
    expect(s.startsWith('8065817517094387857')).toBe(true);
    expect(s).toBe(FACT_52_DIGITS);
  });

  it('exports log10(52!) as ~67.9066, matching the number the UI used to hardcode', () => {
    expect(LOG10_FACT_52).toBeCloseTo(67.9066, 4);
  });
});

describe('Lehmer encode/decode', () => {
  it('decodes index 0 to the identity ordering', () => {
    const ids = arrangementFromIndex(0n);
    expect(ids).toHaveLength(52);
    expect(ids).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it('decodes the last index to the fully reversed ordering', () => {
    const ids = arrangementFromIndex(FACT_52 - 1n);
    expect(ids).toEqual(Array.from({ length: 52 }, (_, i) => 51 - i));
  });

  it('round-trips 50 random permutations', () => {
    const rng = mulberry32(20260905);
    const identity = Array.from({ length: 52 }, (_, i) => i);
    for (let n = 0; n < 50; n++) {
      const cards = shuffle(identity, rng);
      const index = indexFromArrangement(cards);
      expect(index).toBeGreaterThanOrEqual(0n);
      expect(index).toBeLessThan(FACT_52);
      expect(arrangementFromIndex(index)).toEqual(cards);
    }
  });

  it('round-trips 50 random indices', () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 50; n++) {
      // A 68-digit index built from four 17-bit-ish draws, so the whole range is exercised.
      let index = 0n;
      for (let k = 0; k < 6; k++) index = index * 100000000000n + BigInt(Math.floor(rng() * 1e11));
      index %= FACT_52;
      expect(indexFromArrangement(arrangementFromIndex(index))).toBe(index);
    }
  });

  it('round-trips small decks too, so Ascension decks will work', () => {
    for (let index = 0n; index < 24n; index++) {
      expect(indexFromArrangement(arrangementFromIndex(index, 4))).toBe(index);
    }
  });

  it('rejects an ordering that is not a permutation', () => {
    expect(() => indexFromArrangement([0, 0, 1])).toThrow(RangeError);
  });
});

describe('arrangementIndex', () => {
  it('is the exact odometer reading while it fits in a double', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D(1234567);
    expect(arrangementIndex(state)).toBe(1234567n);
    state.lifetimeShuffles = D('1234567.9');
    expect(arrangementIndex(state)).toBe(1234567n);
  });

  it('is 0 for an empty or negative odometer', () => {
    const state = createInitialState(0);
    expect(arrangementIndex(state)).toBe(0n);
    state.lifetimeShuffles = D(-5);
    expect(arrangementIndex(state)).toBe(0n);
  });

  it('keeps 17 significant digits above 1e15 (documented precision loss)', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D('1.5e30');
    const v = arrangementIndex(state);
    expect(v.toString()).toHaveLength(31);
    // 17 digits are carried across; the tail is zeros, and the 17th digit carries the double's
    // own noise (1.5e30's mantissa is 1.5000000000000004). Both are flavour, per ADR-004.
    expect(v.toString().slice(0, 16)).toBe('1500000000000000');
    expect(v % 10n ** 14n).toBe(0n);
  });

  it('clamps at 52!-1 rather than running off the end of the journey', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D('1e100');
    expect(arrangementIndex(state)).toBe(FACT_52 - 1n);
    state.lifetimeShuffles = D('1e1000');
    expect(arrangementIndex(state)).toBe(FACT_52 - 1n);
  });
});

describe('journeyFraction', () => {
  it('is 0 at the start', () => {
    expect(journeyFraction(createInitialState(0))).toBe(0);
  });

  it('is ~1 at 52!', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D(FACT_52.toString());
    expect(journeyFraction(state)).toBeCloseTo(1, 6);
  });

  it('is ~1 at 1e67.9066', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D(10).pow(67.9066);
    expect(journeyFraction(state)).toBeCloseTo(1, 4);
  });

  it('rises with the odometer and never leaves 0..1', () => {
    const state = createInitialState(0);
    let last = 0;
    for (const exp of [0, 3, 6, 12, 30, 60, 67, 68, 200]) {
      state.lifetimeShuffles = D(10).pow(exp);
      const f = journeyFraction(state);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f).toBeLessThanOrEqual(1);
      last = f;
    }
    expect(last).toBe(1);
  });

  it('reads a milestone at the fraction the ledger would show', () => {
    const state = createInitialState(0);
    state.lifetimeShuffles = D('1e6');
    // A million arrangements is 6/67.9 of the way there, on a log scale.
    expect(journeyFraction(state)).toBeCloseTo(6 / LOG10_FACT_52, 4);
  });
});
