/**
 * Numbering systems: the rank -> value map (docs/02-game-design.md §3). PURE.
 * Every system is normalized so its rank total (one term per rank of the active deck shape)
 * equals the shape's natural total (sum 1..n — 91 for the standard 52's 13 ranks), so switching
 * systems redistributes value rather than adding it. The rank count and total are read from
 * `STANDARD_52` (docs/12-ascension.md's deck-shape refactor) rather than typed in as 13 and 91;
 * for the one shape that exists today the numbers are identical to what they always were.
 */
import Decimal from 'break_eternity.js';
import { STANDARD_52 } from './deck';
import { D } from './numbers';
import type { NumberingId, Rank } from './types';

export const NUMBERING_ORDER: readonly NumberingId[] = [
  'natural',
  'prime',
  'triangular',
  'fibonacci',
  'powers',
  'factorial',
  'tetration'
];

const LABELS: Record<NumberingId, string> = {
  natural: 'Natural',
  prime: 'Prime',
  triangular: 'Triangular',
  fibonacci: 'Fibonacci',
  powers: 'Powers of Two',
  factorial: 'Factorial',
  tetration: 'Tetration'
};

export function numberingLabel(id: NumberingId): string {
  return LABELS[id];
}

// Tied to the standard deck's 13 ranks (docs/12-ascension.md: a shape with a different rank
// count needs its own prime table — not needed until Ascension actually ships one).
const FIRST_13_PRIMES: readonly number[] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];

function rawSequence(id: NumberingId): Decimal[] {
  switch (id) {
    case 'natural':
      return RANKS_1_N.map((r) => D(r));
    case 'prime':
      return FIRST_13_PRIMES.map((p) => D(p));
    case 'triangular':
      return RANKS_1_N.map((r) => D((r * (r + 1)) / 2));
    case 'fibonacci': {
      const out: Decimal[] = [];
      let a = D(1);
      let b = D(2);
      for (let i = 0; i < RANK_COUNT; i++) {
        out.push(a);
        const next = a.plus(b);
        a = b;
        b = next;
      }
      return out;
    }
    case 'powers':
      return RANKS_1_N.map((r) => Decimal.pow(2, r - 1));
    case 'factorial': {
      const out: Decimal[] = [];
      let acc = D(1);
      for (let r = 1; r <= RANK_COUNT; r++) {
        acc = acc.times(r);
        out.push(acc);
      }
      return out;
    }
    case 'tetration': {
      const out: Decimal[] = [];
      let acc = D(1);
      for (let r = 1; r <= RANK_COUNT; r++) {
        out.push(acc);
        acc = Decimal.pow(2, acc);
      }
      return out;
    }
  }
}

// Read from the deck shape rather than typed in: `RANK_COUNT` is 13 and `NATURAL_TOTAL` is 91
// for the standard 52 today, exactly as before — but they are now a consequence of the shape,
// not a pair of literals someone has to remember to change together.
const RANKS_1_N = STANDARD_52.ranks;
const RANK_COUNT = RANKS_1_N.length;
const NATURAL_TOTAL = D((RANK_COUNT * (RANK_COUNT + 1)) / 2);

interface NormalizedSystem {
  values: Decimal[]; // index 0 -> rank 1 ... index 12 -> rank 13
}

const CACHE = new Map<NumberingId, NormalizedSystem>();

function normalized(id: NumberingId): NormalizedSystem {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const raw = rawSequence(id);
  const sum = raw.reduce((acc, v) => acc.plus(v), D(0));
  const ratio = NATURAL_TOTAL.div(sum);
  const values = raw.map((v) => v.times(ratio));

  // For extreme, doubly-exponential sequences (tetration), one term dwarfs the sum so
  // completely that dividing 91 into it and multiplying back loses the factor of 91 entirely
  // in floating point (91/HUGE rounds to 1/HUGE, and HUGE * 1/HUGE round-trips to exactly 1,
  // not 91). break_eternity itself calls the mantissa "irrelevant" once a value's layer is 2+
  // (see its `m` getter) — there is no more precision left to carry a finite correction
  // factor. When that collapse is detected, assign the dominant rank the full total directly;
  // the rest are already correctly ~0, matching the intended "extreme redistribution".
  const total = values.reduce((acc, v) => acc.plus(v), D(0));
  const relError = total.eq(0) ? 1 : total.minus(NATURAL_TOTAL).abs().div(NATURAL_TOTAL).toNumber();
  if (!(relError < 1e-6)) {
    let topIndex = 0;
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i];
      const b = raw[topIndex];
      if (a && b && a.gt(b)) topIndex = i;
    }
    values[topIndex] = NATURAL_TOTAL;
  }

  const result: NormalizedSystem = { values };
  CACHE.set(id, result);
  return result;
}

/** Value of a rank (1..13) under a numbering system, normalized so the 13-rank total is 91. */
export function rankValue(system: NumberingId, rank: Rank): Decimal {
  const sys = normalized(system);
  const v = sys.values[rank - 1];
  if (!v) throw new RangeError(`bad rank ${rank}`);
  return v;
}
