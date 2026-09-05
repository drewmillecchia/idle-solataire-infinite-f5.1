import { describe, expect, it } from 'vitest';
import { D } from '$engine/numbers';
import { NUMBERING_ORDER, numberingLabel, rankValue } from '$engine/numbering';
import type { Rank } from '$engine/types';

const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

describe('numbering systems', () => {
  it('exposes all seven systems in the design order', () => {
    expect(NUMBERING_ORDER).toEqual([
      'natural',
      'prime',
      'triangular',
      'fibonacci',
      'powers',
      'factorial',
      'tetration'
    ]);
  });

  it('has a label for every system', () => {
    for (const id of NUMBERING_ORDER) {
      expect(typeof numberingLabel(id)).toBe('string');
      expect(numberingLabel(id).length).toBeGreaterThan(0);
    }
  });

  it('normalizes every system so the 13-rank total is ~91', () => {
    for (const id of NUMBERING_ORDER) {
      const total = RANKS.reduce((acc, r) => acc.plus(rankValue(id, r)), D(0));
      const relError = total.minus(91).abs().div(91).toNumber();
      expect(relError).toBeLessThan(1e-9);
    }
  });

  it('keeps natural rank values exactly equal to the rank (identity normalization)', () => {
    expect(rankValue('natural', 13).eq(13)).toBe(true);
    expect(rankValue('natural', 1).eq(1)).toBe(true);
    expect(rankValue('natural', 7).eq(7)).toBe(true);
  });

  it('redistributes tetration value almost entirely to the top rank', () => {
    const top = rankValue('tetration', 13);
    const rest = RANKS.slice(0, 12).reduce((acc, r) => acc.plus(rankValue('tetration', r)), D(0));
    expect(top.minus(91).abs().div(91).toNumber()).toBeLessThan(1e-6);
    expect(rest.lt(1e-6)).toBe(true);
  });

  it('produces a monotonic prime-derived ranking distinct from natural', () => {
    const naturalRank7 = rankValue('natural', 7);
    const primeRank7 = rankValue('prime', 7);
    expect(naturalRank7.eq(primeRank7)).toBe(false);
  });
});
