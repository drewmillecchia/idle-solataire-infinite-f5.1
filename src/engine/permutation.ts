/**
 * The 52! odometer (docs/02-game-design.md §1, ADR-004). PURE, and deliberately `bigint`-only:
 * the arrangement index is an EXACT integer and is kept isolated from the `Decimal` economy. It
 * never feeds the multiplier chain — it is flavour, milestones and the sky.
 *
 * `lifetimeShuffles` is the count of arrangements witnessed, so it doubles as a position in the
 * lexicographic ordering of the 52! permutations: index 0 is the identity ordering (0..51), index
 * 52!-1 is the last. `arrangementFromIndex` decodes a position into that ordering via its Lehmer
 * code, and `indexFromArrangement` encodes it back.
 *
 * PRECISION: `lifetimeShuffles` is a `Decimal`, which carries ~17 significant digits, while a 52!
 * index needs 68. Above 1e15 the conversion therefore keeps the leading 17 digits and pads the
 * rest with zeros. The card ordering it decodes to is exact for the value it was handed; the value
 * itself has already lost its tail. Per ADR-004 that is acceptable: the odometer is flavour.
 */
import Decimal from 'break_eternity.js';
import { deckShape, deckSize, type DeckShape } from './deck';
import type { GameState } from './state';
import type { CardId } from './types';

/** Significant decimal digits carried across the Decimal -> bigint boundary. */
const SIG_DIGITS = 17;

const FACT_CACHE: bigint[] = [1n];

/** `n!` as an exact bigint. Memoized; `n` must be a non-negative integer. */
export function factorial(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bad factorial ${n}`);
  while (FACT_CACHE.length <= n) {
    const prev = FACT_CACHE[FACT_CACHE.length - 1] as bigint;
    FACT_CACHE.push(prev * BigInt(FACT_CACHE.length));
  }
  return FACT_CACHE[n] as bigint;
}

/** 52! = 80658175170943878571660636856403766975289505440883277824000000000000 (68 digits). */
export const FACT_52: bigint = factorial(52);

/** log10 of a positive bigint, to double precision, via its digit string. */
function log10OfBigInt(v: bigint): number {
  if (v <= 0n) return -Infinity;
  const s = v.toString();
  const lead = s.slice(0, SIG_DIGITS);
  return s.length - lead.length + Math.log10(Number(lead));
}

/**
 * log10(52!) ~ 67.9066, computed from the bigint rather than typed in. THE one definition: the
 * journey bar, the sky and any future ledger copy all read it from here so they cannot disagree.
 */
export const LOG10_FACT_52: number = log10OfBigInt(FACT_52);

const DECK_FACT_CACHE = new Map<string, bigint>();

/** `deckSize(shape)!` as an exact bigint, memoised per shape id. For the standard 52 this is `FACT_52`. */
export function deckFactorial(shape: DeckShape): bigint {
  let v = DECK_FACT_CACHE.get(shape.id);
  if (v === undefined) {
    v = factorial(deckSize(shape));
    DECK_FACT_CACHE.set(shape.id, v);
  }
  return v;
}

const DECK_LOG10_FACT_CACHE = new Map<string, number>();

/** `log10(deckFactorial(shape))`, memoised per shape id. For the standard 52 this is `LOG10_FACT_52`. */
export function log10DeckFactorial(shape: DeckShape): number {
  let v = DECK_LOG10_FACT_CACHE.get(shape.id);
  if (v === undefined) {
    v = log10OfBigInt(deckFactorial(shape));
    DECK_LOG10_FACT_CACHE.set(shape.id, v);
  }
  return v;
}

const DECK_FACT_DECIMAL_CACHE = new Map<string, Decimal>();

function deckFactorialDecimal(shape: DeckShape): Decimal {
  let v = DECK_FACT_DECIMAL_CACHE.get(shape.id);
  if (!v) {
    v = new Decimal(deckFactorial(shape).toString());
    DECK_FACT_DECIMAL_CACHE.set(shape.id, v);
  }
  return v;
}

/**
 * Floor of a finite, non-negative Decimal as a bigint, keeping `SIG_DIGITS` significant digits.
 * Values below 1e15 round-trip exactly through `Number`; larger ones lose their tail (see header).
 */
function decimalToBigInt(d: Decimal): bigint {
  if (d.sign <= 0) return 0n;
  if (d.lt(1)) return 0n;
  if (d.lt(1e15)) return BigInt(Math.floor(d.toNumber()));
  const e = d.e;
  const m = d.m;
  if (!Number.isFinite(e) || !Number.isFinite(m)) return 0n;
  const digits = BigInt(Math.round(m * Math.pow(10, SIG_DIGITS - 1)));
  const scale = e - (SIG_DIGITS - 1);
  if (scale >= 0) return digits * 10n ** BigInt(scale);
  return digits / 10n ** BigInt(-scale);
}

/**
 * The deck's position on the journey: `floor(lifetimeShuffles)` clamped to [0, 52!-1]. A save that
 * somehow carries a NaN or an infinity clamps rather than throwing (invariant #10).
 */
export function arrangementIndex(state: GameState): bigint {
  const shape = deckShape(state.deck);
  const fact = deckFactorial(shape);
  const factDecimal = deckFactorialDecimal(shape);
  const d = state.lifetimeShuffles;
  if (Number.isNaN(d.sign) || Number.isNaN(d.mag) || Number.isNaN(d.layer)) return 0n;
  if (d.sign <= 0) return 0n;
  if (!Decimal.isFinite(d)) return fact - 1n;
  if (d.gte(factDecimal)) return fact - 1n;
  const v = decimalToBigInt(d.floor());
  if (v < 0n) return 0n;
  return v >= fact ? fact - 1n : v;
}

/**
 * Decodes a position into the card ordering it names (Lehmer code, lexicographic). Index 0 is the
 * identity ordering `[0, 1, ... n-1]`. Out-of-range indices wrap modulo `n!`.
 */
export function arrangementFromIndex(index: bigint, n = 52): CardId[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bad deck size ${n}`);
  const total = factorial(n);
  let rest = total === 0n ? 0n : index % total;
  if (rest < 0n) rest += total;
  const pool: number[] = Array.from({ length: n }, (_, k) => k);
  const out: CardId[] = [];
  for (let k = n; k >= 1; k--) {
    const f = factorial(k - 1);
    const digit = Number(rest / f);
    rest %= f;
    const picked = pool.splice(digit, 1)[0];
    out.push(picked as CardId);
  }
  return out;
}

/** Encodes an ordering back to its position. Inverse of `arrangementFromIndex`. */
export function indexFromArrangement(cards: readonly CardId[]): bigint {
  const n = cards.length;
  const pool: number[] = Array.from({ length: n }, (_, k) => k);
  let index = 0n;
  for (let k = 0; k < n; k++) {
    const card = cards[k];
    const digit = card === undefined ? -1 : pool.indexOf(card);
    if (digit < 0) throw new RangeError(`arrangement is not a permutation of 0..${n - 1}`);
    pool.splice(digit, 1);
    index += BigInt(digit) * factorial(n - 1 - k);
  }
  return index;
}

/**
 * How far along the journey to 52! the odometer stands, 0..1, on a LOG scale (a linear fraction
 * would be 0 for the whole game). THE one definition — the UI's journey bar and the sky read this
 * so they cannot drift apart.
 */
export function journeyFraction(state: GameState): number {
  const log10Fact = log10DeckFactorial(deckShape(state.deck));
  const d = state.lifetimeShuffles;
  if (Number.isNaN(d.sign) || Number.isNaN(d.mag) || Number.isNaN(d.layer)) return 0;
  if (d.sign <= 0) return 0;
  if (!Decimal.isFinite(d)) return 1;
  const l = d.plus(1).log10().toNumber();
  if (!Number.isFinite(l)) return l > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, l / log10Fact));
}
