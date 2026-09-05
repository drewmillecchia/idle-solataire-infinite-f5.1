import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { ECONOMY, FEEL, MILESTONES, UPGRADES } from '$content/index';
import { EconomySchema, UpgradesSchema, MilestonesSchema } from '$content/schemas';
import upgradesJson from '$content/upgrades.json';
import milestonesJson from '$content/milestones.json';
import economyJson from '$content/economy.json';

describe('content loads and validates at import time', () => {
  it('FEEL is already validated (existing content)', () => {
    expect(FEEL.tapMaxMs).toBeGreaterThan(0);
  });

  it('UPGRADES parses via its schema and is non-empty', () => {
    expect(() => UpgradesSchema.parse(upgradesJson)).not.toThrow();
    expect(UPGRADES.length).toBeGreaterThanOrEqual(9);
  });

  it('MILESTONES parses via its schema and is non-empty', () => {
    expect(() => MilestonesSchema.parse(milestonesJson)).not.toThrow();
    expect(MILESTONES.length).toBeGreaterThanOrEqual(10);
  });

  it('ECONOMY parses via its schema', () => {
    expect(() => EconomySchema.parse(economyJson)).not.toThrow();
  });
});

describe('economy content (invariant #9: tunables live in content JSON)', () => {
  it('matches the literals the code used before this moved to content (behaviour-preserving)', () => {
    expect(ECONOMY.winBurstSeconds).toBe(60);
    expect(ECONOMY.undoPenalty).toBe(0.7);
    expect(ECONOMY.homeSparkSeconds).toBe(0.25);
    expect(ECONOMY.tableauSparkSeconds).toBe(0.05);
    expect(ECONOMY.minSpark).toBe(1);
    expect(ECONOMY.gamblerRollMin).toBe(0.5);
    expect(ECONOMY.gamblerRollMax).toBe(3);
    expect(ECONOMY.gamblerFizzleChance).toBe(0.1);
  });

  it('rejects a malformed entry (schema fails loudly, invariant #11)', () => {
    expect(() => EconomySchema.parse({ ...economyJson, undoPenalty: 1.5 })).toThrow();
    expect(() => EconomySchema.parse({ ...economyJson, gamblerFizzleChance: -0.1 })).toThrow();
    expect(() => EconomySchema.parse({ ...economyJson, winBurstSeconds: 0 })).toThrow();
  });
});

describe('upgrades content', () => {
  it('has unique ids', () => {
    const ids = UPGRADES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has parseable baseCost decimals and growth >= 1', () => {
    for (const u of UPGRADES) {
      expect(() => new Decimal(u.baseCost)).not.toThrow();
      expect(Decimal.isNaN(new Decimal(u.baseCost))).toBe(false);
      expect(u.growth).toBeGreaterThanOrEqual(1);
    }
  });

  it('has dry, short blurbs with no exclamation marks', () => {
    for (const u of UPGRADES) {
      expect(u.blurb.includes('!')).toBe(false);
      expect(u.blurb.length).toBeLessThan(120);
    }
  });

  it('includes the documented starter set', () => {
    const ids = UPGRADES.map((u) => u.id);
    for (const expected of [
      'steadier-hands',
      'warm-hearts',
      'sharp-spades',
      'clear-diamonds',
      'green-clubs',
      'patience',
      'full-table',
      'devotion',
      'bright-finish',
      'long-evening',
      'the-dealer'
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('"Steadier Hands" is affordable within about two minutes at a few shuffles/sec', () => {
    const steadier = UPGRADES.find((u) => u.id === 'steadier-hands');
    if (!steadier) throw new Error('missing');
    const cost = new Decimal(steadier.baseCost);
    const deckRateGuess = new Decimal(3); // "a few per second"
    const secondsToAfford = cost.div(deckRateGuess).toNumber();
    expect(secondsToAfford).toBeLessThan(120);
  });
});

describe('milestones content', () => {
  it('has unique ids and parseable, ascending-friendly decimal values', () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MILESTONES) {
      expect(Decimal.isNaN(new Decimal(m.value))).toBe(false);
    }
  });

  it('includes 52! and the ledger tone has no exclamation marks', () => {
    const fifty2 = MILESTONES.find((m) => m.id === 'fifty-two-factorial');
    expect(fifty2).toBeDefined();
    expect(new Decimal(fifty2!.value).minus('8.07e67').abs().div('8.07e67').toNumber()).toBeLessThan(1e-9);
    for (const m of MILESTONES) {
      expect(m.ledger.includes('!')).toBe(false);
    }
  });
});
