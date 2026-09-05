/**
 * Decimal helpers: construction and display. PURE. See CLAUDE.md invariants.
 */
import Decimal from 'break_eternity.js';
import type { DecimalSource } from 'break_eternity.js';

/** Shorthand constructor, mirrors the `D()` convention used across the incremental-genre. */
export function D(x: DecimalSource): Decimal {
  return new Decimal(x);
}

/** Short-scale suffixes, index i covers [10^(3i), 10^(3i+3)). Index 0 (bare number) is unused here. */
const SUFFIXES: readonly string[] = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
/** One past the top suffix tier (Dc = 1e33..1e36). Beyond this, switch to scientific notation. */
const EXPONENTIAL_THRESHOLD_EXP = 36;

export interface FormatOptions {
  /** Significant figures used in the exponential (>=1e36) branch. Default 3. */
  precision?: number;
}

/** Formats a small (< 1000) nonnegative, finite Decimal using a plain JS number. */
function formatSmall(value: number): string {
  if (value < 10 && !Number.isInteger(value)) {
    return value.toFixed(1);
  }
  return Math.round(value).toString();
}

/** Formats a 1-1000-ish mantissa (post suffix-tier scaling) to ~3 significant figures. */
function formatTieredMantissa(scaled: number): string {
  if (scaled >= 100) return Math.round(scaled).toString();
  if (scaled >= 10) return scaled.toFixed(1);
  return scaled.toFixed(2);
}

/**
 * Formats a Decimal for display.
 * - < 1000: integer, or 1 decimal place when < 10 and non-integer.
 * - [1000, 1e36): short-scale suffix (K..Dc) with ~3 significant figures ("1.23M", "45.6B", "789T").
 * - >= 1e36 (layer < 2): scientific notation ("1.23e45").
 * - layer >= 2: break_eternity layered form, one "e" per layer beyond the first ("e1.23e45").
 */
export function formatNumber(d: Decimal, opts?: FormatOptions): string {
  if (Number.isNaN(d.sign) || Number.isNaN(d.mag) || Number.isNaN(d.layer)) return 'NaN';
  if (!Decimal.isFinite(d)) return d.sign < 0 ? '-Infinity' : 'Infinity';
  if (d.sign === 0) return '0';
  if (d.sign < 0) return '-' + formatNumber(d.neg(), opts);

  const precision = Math.max(1, opts?.precision ?? 3);

  if (d.layer >= 2) {
    // The exponent of d (log10(d)) has layer-1, one fewer layer. Recurse with a single "e" prefix.
    return 'e' + formatNumber(d.log10(), opts);
  }

  const exp = d.e; // safe finite integer for layer 0/1 in our working range
  if (exp < 3) {
    return formatSmall(d.toNumber());
  }
  if (exp < EXPONENTIAL_THRESHOLD_EXP) {
    const tier = Math.floor(exp / 3);
    const offset = exp - tier * 3;
    const scaled = d.m * Math.pow(10, offset);
    const suffix = SUFFIXES[tier] ?? '';
    return formatTieredMantissa(scaled) + suffix;
  }
  return d.m.toFixed(precision - 1) + 'e' + exp;
}

export function formatRate(d: Decimal): string {
  return formatNumber(d) + '/s';
}

/** Formats a non-negative duration in seconds as e.g. "4m 12s", "2h 05m", "3d 4h". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  if (total < 86400) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  return `${d}d ${h}h`;
}
