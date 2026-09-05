import { describe, expect, it } from 'vitest';
import {
  haptic,
  isAudioReady,
  layersFor,
  resumeAudio,
  setMasterVolume,
  sound,
  unlockAudio,
  SOUND_NAMES as PRESENTER_SOUND_NAMES
} from '../src/audio/presenters';
import { SOUND_NAMES } from '../src/audio/soundLab';

// There is no AudioContext in the Node test environment — that's the point. Every export here must
// degrade to a safe no-op rather than throw when audio has never been unlocked.

describe('audio presenters — no AudioContext in Node', () => {
  it('never throws when unlocked before unlockAudio() has ever succeeded', () => {
    expect(() => sound('place')).not.toThrow();
    expect(() => haptic('tick')).not.toThrow();
    expect(() => setMasterVolume(0.5)).not.toThrow();
    expect(() => resumeAudio()).not.toThrow();
  });

  it('reports not ready when there is no AudioContext', () => {
    expect(isAudioReady()).toBe(false);
  });

  it('is a no-op for an unknown sound name too', () => {
    expect(() => sound('not-a-real-sound')).not.toThrow();
  });

  it('unlockAudio() itself never throws even with no AudioContext global (there is none in Node)', () => {
    expect(() => unlockAudio()).not.toThrow();
    // Node has no `window`/AudioContext, so unlock cannot actually succeed here.
    expect(isAudioReady()).toBe(false);
  });
});

describe('SOUND_NAMES', () => {
  it('re-exports the same list from soundLab.ts as presenters.ts', () => {
    expect(SOUND_NAMES).toEqual(PRESENTER_SOUND_NAMES);
  });

  it('contains every name the presenter handles, and every one of those produces layers', () => {
    expect(SOUND_NAMES.length).toBeGreaterThan(0);
    for (const name of SOUND_NAMES) {
      const layers = layersFor(name, 0.6);
      expect(layers.length).toBeGreaterThan(0);
    }
  });

  it('includes the documented sound hooks plus the new ASMR additions', () => {
    const expected = [
      'pick', 'slide', 'place', 'slideBack', 'flip', 'deal', 'toss', 'riffle', 'square', 'tick',
      'chime', 'bloom', 'cut',
      'tossLand', 'shuffleOverhand', 'fan', 'wake', 'milestone', 'error'
    ];
    for (const name of expected) {
      expect(SOUND_NAMES).toContain(name);
    }
  });

  it('has no unknown extras beyond the documented + new set', () => {
    const expected = new Set([
      'pick', 'slide', 'place', 'slideBack', 'flip', 'deal', 'toss', 'riffle', 'square', 'tick',
      'chime', 'bloom', 'cut',
      'tossLand', 'shuffleOverhand', 'fan', 'wake', 'milestone', 'error'
    ]);
    for (const name of SOUND_NAMES) {
      expect(expected.has(name)).toBe(true);
    }
  });
});

describe('layersFor — pure layer-building helper', () => {
  it('builds exactly three layers (body, click, thud) for a simple card sound', () => {
    const layers = layersFor('place', 0.5, 0.5);
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.kind).sort()).toEqual(['noise', 'noise', 'thud']);
  });

  it('builds the same three-layer shape for every basic card interaction', () => {
    for (const name of ['pick', 'slide', 'place', 'slideBack', 'flip', 'deal', 'toss', 'tossLand']) {
      const layers = layersFor(name, 0.6, 0.3);
      expect(layers).toHaveLength(3);
      expect(layers.map((l) => l.kind).sort()).toEqual(['noise', 'noise', 'thud']);
    }
  });

  it('scales gain up with velocity for a card sound', () => {
    const quiet = layersFor('place', 0, 0.5);
    const loud = layersFor('place', 1, 0.5);
    expect(loud[0]!.gain).toBeGreaterThan(quiet[0]!.gain);
    expect(loud[1]!.gain).toBeGreaterThan(quiet[1]!.gain);
    expect(loud[2]!.gain).toBeGreaterThan(quiet[2]!.gain);
  });

  it('shifts body/click frequency with pitch by up to ±12%', () => {
    const low = layersFor('place', 0.5, 0);
    const neutral = layersFor('place', 0.5, 0.5);
    const high = layersFor('place', 0.5, 1);
    expect(low[0]!.freq).toBeLessThan(neutral[0]!.freq);
    expect(high[0]!.freq).toBeGreaterThan(neutral[0]!.freq);
    const ratio = high[0]!.freq / low[0]!.freq;
    // ~1.12 / ~0.88 ≈ 1.27; give it slack for the two layers' independent randomised freqs? No —
    // layersFor is pure and takes no random jitter itself, so this ratio is exact.
    expect(ratio).toBeCloseTo(1.12 / 0.88, 1);
  });

  it('tossLand carries more thud and less click than place (a heavier landing)', () => {
    const land = layersFor('tossLand', 0.6, 0.5);
    const place = layersFor('place', 0.6, 0.5);
    const clickOf = (layers: ReturnType<typeof layersFor>) => layers[1]!.gain;
    const thudOf = (layers: ReturnType<typeof layersFor>) => layers[2]!.gain;
    expect(thudOf(land)).toBeGreaterThan(thudOf(place));
    expect(clickOf(land)).toBeLessThan(clickOf(place));
  });

  it('builds a many-layer pattern for the riffle (a controlled waterfall of clicks)', () => {
    const layers = layersFor('riffle', 0.6);
    expect(layers.length).toBeGreaterThan(30);
    expect(layers.every((l) => l.kind === 'noise' || l.kind === 'thud')).toBe(true);
  });

  it('builds a heavier, chunkier pattern for shuffleOverhand than a single card sound', () => {
    const layers = layersFor('shuffleOverhand', 0.6);
    expect(layers.length).toBeGreaterThan(10);
  });

  it('keeps error soft and low — no bright click layer, a gentle attack, quiet gain', () => {
    const layers = layersFor('error', 0.6);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.kind).toBe('thud');
    expect(layers[0]!.freq).toBeLessThan(200);
    expect(layers[0]!.gain).toBeLessThan(0.1);
  });

  it('returns an empty array for an unknown name', () => {
    expect(layersFor('nope-not-a-sound')).toEqual([]);
  });
});
