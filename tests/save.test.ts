import { describe, expect, it, vi } from 'vitest';
import Decimal from 'break_eternity.js';
import { createInitialState } from '$engine/state';
import { cardId } from '$engine/types';
import {
  deserialize,
  exportString,
  importString,
  serialize
} from '$engine/save/serialize';

describe('serialize / deserialize round-trip', () => {
  it('preserves Decimals exactly, including huge and layered values', () => {
    const state = createInitialState(1000);
    state.shuffles = new Decimal('1.2345678901234e67');
    state.lifetimeShuffles = new Decimal('8.07e67');
    state.prestige.lifetimeCuts = new Decimal(42);
    state.stats.bestRate = Decimal.pow(10, new Decimal('1e50')); // layered value

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.shuffles.eq(state.shuffles)).toBe(true);
    expect(restored.lifetimeShuffles.eq(state.lifetimeShuffles)).toBe(true);
    expect(restored.prestige.lifetimeCuts.eq(state.prestige.lifetimeCuts)).toBe(true);
    expect(restored.stats.bestRate.eq(state.stats.bestRate)).toBe(true);
    expect(restored.stats.bestRate.layer).toBeGreaterThanOrEqual(2);
  });

  it('preserves plain fields and nested records', () => {
    const state = createInitialState(500);
    state.run.upgrades['steadier-hands'] = 3;
    state.numbering = 'prime';
    state.cards[cardId('S', 1)]!.awake = true;
    state.cards[cardId('S', 1)]!.charge = 4;
    state.gameConfig['klondike'] = { drawMode: '1' };

    const restored = deserialize(serialize(state));
    expect(restored.run.upgrades['steadier-hands']).toBe(3);
    expect(restored.numbering).toBe('prime');
    expect(restored.cards[cardId('S', 1)]).toEqual({ awake: true, charge: 4, marks: [] });
    expect(restored.gameConfig).toEqual({ klondike: { drawMode: '1' } });
  });
});

describe('deserialize defensiveness', () => {
  it('never throws, and falls back to a valid initial state for garbage input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => deserialize('garbage not json')).not.toThrow();
    const state = deserialize('garbage not json');
    expect(state.cards).toHaveLength(52);
    expect(state.shuffles.eq(0)).toBe(true);
    warn.mockRestore();
  });

  it('produces a valid state from "{}"', () => {
    const state = deserialize('{}');
    expect(state.cards).toHaveLength(52);
    expect(state.version).toBe(1);
    expect(state.shuffles.eq(0)).toBe(true);
    expect(state.numbering).toBe('natural');
  });

  it('repairs a cards array with the wrong length', () => {
    const short = JSON.stringify({
      version: 1,
      cards: Array.from({ length: 10 }, () => ({ awake: true, charge: 2, marks: [] }))
    });
    const state = deserialize(short);
    expect(state.cards).toHaveLength(52);
    expect(state.cards[0]).toEqual({ awake: true, charge: 2, marks: [] });
    expect(state.cards[51]).toEqual({ awake: false, charge: 0, marks: [] });
  });

  it('falls back per-field on bad types without discarding the rest', () => {
    const raw = JSON.stringify({
      version: 1,
      shuffles: { $d: '123' },
      lifetimeShuffles: 'not-a-number-either', // still parseable by Decimal? guard anyway
      numbering: 'not-a-real-system',
      run: { way: 'bogus-way', handsPlayed: 'nope', upgrades: { a: 1, b: 'x' } }
    });
    const state = deserialize(raw);
    expect(state.shuffles.eq(123)).toBe(true);
    expect(state.numbering).toBe('natural');
    expect(state.run.way).toBe('none');
    expect(state.run.handsPlayed).toBe(0);
    expect(state.run.upgrades).toEqual({ a: 1 });
  });

  it('never throws on null, arrays, or numbers as top-level input', () => {
    for (const bad of ['null', '42', '[1,2,3]', '"just a string"']) {
      expect(() => deserialize(bad)).not.toThrow();
      const state = deserialize(bad);
      expect(state.cards).toHaveLength(52);
    }
  });
});

describe('export / import strings', () => {
  it('round-trips through base64', () => {
    const state = createInitialState(10);
    state.shuffles = new Decimal('4.2e10');
    const exported = exportString(state);
    expect(typeof exported).toBe('string');
    const restored = importString(exported);
    expect(restored.shuffles.eq(state.shuffles)).toBe(true);
  });

  it('never throws on a garbage export string', () => {
    expect(() => importString('!!!not base64 or json!!!')).not.toThrow();
  });
});
