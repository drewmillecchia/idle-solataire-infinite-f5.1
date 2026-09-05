import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { D, formatDuration, formatNumber, formatRate } from '$engine/numbers';

describe('formatNumber', () => {
  it('formats small integers plainly', () => {
    expect(formatNumber(D(0))).toBe('0');
    expect(formatNumber(D(5))).toBe('5');
    expect(formatNumber(D(999))).toBe('999');
  });

  it('shows one decimal below 10 when non-integer', () => {
    expect(formatNumber(D(4.567))).toBe('4.6');
    expect(formatNumber(D(9.95))).toBe('9.9');
  });

  it('rounds non-integers at or above 10 to an integer', () => {
    expect(formatNumber(D(45.67))).toBe('46');
    expect(formatNumber(D(999.4))).toBe('999');
  });

  it('uses short-scale suffixes with three significant figures', () => {
    expect(formatNumber(D(1230000))).toBe('1.23M');
    expect(formatNumber(D(45.6e9))).toBe('45.6B');
    expect(formatNumber(D(789e12))).toBe('789T');
    expect(formatNumber(D(1000))).toBe('1.00K');
    expect(formatNumber(D(999e33))).toBe('999Dc');
  });

  it('covers every suffix tier boundary', () => {
    const suffixes = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    suffixes.forEach((suffix, i) => {
      const exp = 3 * (i + 1);
      const value = D(`1.5e${exp}`);
      expect(formatNumber(value)).toBe(`1.50${suffix}`);
    });
  });

  it('switches to scientific notation at 1e36', () => {
    expect(formatNumber(D('1.234e45'))).toBe('1.23e45');
    expect(formatNumber(D('1e36'))).toBe('1.00e36');
  });

  it('uses layered form once break_eternity layer reaches 2', () => {
    const layered = Decimal.pow(10, D('1e45')); // layer 2ish
    expect(layered.layer).toBeGreaterThanOrEqual(2);
    const formatted = formatNumber(layered);
    expect(formatted.startsWith('e')).toBe(true);
    expect(formatted.slice(1)).toContain('e');
  });

  it('handles negative numbers', () => {
    expect(formatNumber(D(-45.67))).toBe('-46');
    expect(formatNumber(D(-1230000))).toBe('-1.23M');
  });
});

describe('formatRate', () => {
  it('appends /s', () => {
    expect(formatRate(D(5))).toBe('5/s');
    expect(formatRate(D(1230000))).toBe('1.23M/s');
  });
});

describe('formatDuration', () => {
  it('formats seconds only under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes and seconds under an hour', () => {
    expect(formatDuration(4 * 60 + 12)).toBe('4m 12s');
    expect(formatDuration(60)).toBe('1m 00s');
  });

  it('formats hours and padded minutes under a day', () => {
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2h 05m');
    expect(formatDuration(3600)).toBe('1h 00m');
  });

  it('formats days and hours at or beyond a day', () => {
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe('3d 4h');
    expect(formatDuration(86400)).toBe('1d 0h');
  });
});
