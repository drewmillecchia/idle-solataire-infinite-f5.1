/**
 * Synthesised card sounds (ADR-013) and haptics. Parametric: every call takes a velocity 0..1 and
 * an optional pitch 0..1 (a card's rank/52, say) so no two cards sound identical.
 * Nothing plays before the first user gesture (iOS autoplay policy) — call unlockAudio() on pointerdown.
 * Every export is a safe no-op if the AudioContext cannot be created (or hasn't been unlocked yet).
 *
 * ASMR intent (brainstorming/look-and-sound.md): every card sound is three layers mixed by
 * velocity — paper body (band-passed noise), a short edge click, and a felt thud — data-driven via
 * `SOUND_NAMES`/`layersFor` below rather than hardcoded per-call synthesis, so the mix is tunable.
 */

// ---- Layer model -----------------------------------------------------------------------------

export type LayerKind = 'noise' | 'tone' | 'thud';

/** A single scheduled sound event. `when`/`attack` are seconds; `freq` in Hz; `gain` is peak linear gain. */
export interface Layer {
  kind: LayerKind;
  freq: number;
  dur: number;
  gain: number;
  q?: number;
  attack?: number;
  when?: number;
  hp?: number;
}

// ---- Runtime state (Web Audio) ----------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let unlocked = false;

export function unlockAudio(): void {
  if (unlocked) return;
  try {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    unlocked = true;
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio: every export in this file stays a safe no-op */
  }
}

/**
 * Call on visibility/focus regain: iOS Safari suspends the AudioContext when the tab is
 * backgrounded and does not always auto-resume it. Not wired to any event by this module — the
 * host decides when to call it.
 */
export function resumeAudio(): void {
  try {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* ignore */
  }
}

export function setMasterVolume(v: number): void {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

export function isAudioReady(): boolean {
  return unlocked && ctx !== null;
}

// ---- Low-level primitives, one per layer kind --------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const jitter = (amt = 0.04) => 1 + (Math.random() * 2 - 1) * amt;

/** pitch 0..1 (0.5 = neutral) -> a frequency multiplier shifting by up to ±12%. */
function pitchMul(pitch: number): number {
  return 1 + (clamp01(pitch) - 0.5) * 0.24;
}

/** Band-passed noise burst: the paper body of a card sound, or one click in a shuffle pattern. */
function playNoise(l: Layer): void {
  if (!ctx || !master || !noiseBuf) return;
  const t0 = ctx.currentTime + (l.when ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = jitter(0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = l.freq * jitter();
  bp.Q.value = l.q ?? 1.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = l.hp ?? 300;
  const g = ctx.createGain();
  const a = l.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + l.dur);
  src.connect(bp).connect(hp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + l.dur + 0.02);
}

/** A pure sine partial: chimes, wake, milestone, bloom, the cut's resolving tone. */
function playTone(l: Layer): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (l.when ?? 0);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = l.freq * jitter(0.003);
  const g = ctx.createGain();
  const a = l.attack ?? 0.01;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + l.dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + l.dur + 0.02);
}

/** A soft low thud: the felt receiving a card (or a muted thump for an illegal drop). */
function playThud(l: Layer): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (l.when ?? 0);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(l.freq * jitter(0.08), t0);
  o.frequency.exponentialRampToValueAtTime(l.freq * 0.5, t0 + l.dur * 0.75);
  const g = ctx.createGain();
  const a = l.attack ?? 0.001;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + l.dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + l.dur + 0.02);
}

/** Schedules a full set of layers (a card sound, a shuffle pattern, a chime...) against the live context. */
export function playLayers(layers: Layer[]): void {
  if (!ctx || !master) return;
  for (const l of layers) {
    if (l.kind === 'noise') playNoise(l);
    else if (l.kind === 'tone') playTone(l);
    else playThud(l);
  }
}

// ---- The card model: paper body + edge click + felt thud, mixed by velocity --------------------

interface CardMix {
  bodyFreq: number; bodyQ: number; bodyDur: number; bodyGain: number; bodyAttack: number; bodyHp: number;
  clickFreq: number; clickQ: number; clickDur: number; clickGain: number;
  thudFreq: number; thudDur: number; thudGain: number;
}

/** Builds the three layers for one card interaction. Pure — no ctx touched. */
function cardLayers(mix: CardMix, v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  return [
    {
      kind: 'noise', freq: mix.bodyFreq * pm, q: mix.bodyQ, dur: mix.bodyDur,
      gain: mix.bodyGain * (0.4 + v * 0.6), attack: mix.bodyAttack, hp: mix.bodyHp
    },
    {
      kind: 'noise', freq: mix.clickFreq * pm, q: mix.clickQ, dur: mix.clickDur,
      gain: mix.clickGain * (0.3 + v * 0.7), attack: 0.002, hp: mix.clickFreq * 0.6
    },
    { kind: 'thud', freq: mix.thudFreq, dur: mix.thudDur, gain: mix.thudGain * (0.2 + v * 0.8) }
  ];
}

type CardSoundName = 'pick' | 'slide' | 'place' | 'slideBack' | 'flip' | 'deal' | 'toss' | 'tossLand';

/** name -> body/click/thud mix. Every card sound is data here; tune by editing this table. */
const CARD_MIX: Record<CardSoundName, CardMix> = {
  pick: {
    bodyFreq: 1800, bodyQ: 1.0, bodyDur: 0.05, bodyGain: 0.05, bodyAttack: 0.004, bodyHp: 900,
    clickFreq: 7000, clickQ: 5, clickDur: 0.012, clickGain: 0.015,
    thudFreq: 130, thudDur: 0.05, thudGain: 0.01
  },
  slide: {
    bodyFreq: 1800, bodyQ: 0.8, bodyDur: 0.12, bodyGain: 0.07, bodyAttack: 0.02, bodyHp: 700,
    clickFreq: 6500, clickQ: 5, clickDur: 0.015, clickGain: 0.012,
    thudFreq: 120, thudDur: 0.04, thudGain: 0.008
  },
  place: {
    bodyFreq: 2600, bodyQ: 1.4, bodyDur: 0.07, bodyGain: 0.14, bodyAttack: 0.003, bodyHp: 1200,
    clickFreq: 7500, clickQ: 6, clickDur: 0.018, clickGain: 0.05,
    thudFreq: 130, thudDur: 0.08, thudGain: 0.16
  },
  slideBack: {
    bodyFreq: 1500, bodyQ: 0.7, bodyDur: 0.16, bodyGain: 0.055, bodyAttack: 0.03, bodyHp: 600,
    clickFreq: 6000, clickQ: 5, clickDur: 0.014, clickGain: 0.01,
    thudFreq: 110, thudDur: 0.05, thudGain: 0.012
  },
  flip: {
    bodyFreq: 1900, bodyQ: 1.0, bodyDur: 0.08, bodyGain: 0.06, bodyAttack: 0.006, bodyHp: 900,
    clickFreq: 8200, clickQ: 6, clickDur: 0.02, clickGain: 0.09,
    thudFreq: 130, thudDur: 0.04, thudGain: 0.015
  },
  deal: {
    bodyFreq: 2400, bodyQ: 1.2, bodyDur: 0.06, bodyGain: 0.07, bodyAttack: 0.003, bodyHp: 1100,
    clickFreq: 7200, clickQ: 6, clickDur: 0.015, clickGain: 0.04,
    thudFreq: 130, thudDur: 0.06, thudGain: 0.06
  },
  toss: {
    bodyFreq: 2000, bodyQ: 0.6, bodyDur: 0.18, bodyGain: 0.06, bodyAttack: 0.04, bodyHp: 700,
    clickFreq: 6800, clickQ: 5, clickDur: 0.016, clickGain: 0.02,
    thudFreq: 120, thudDur: 0.04, thudGain: 0.008
  },
  // A card landing after a throw: more thud, less click, than `place`.
  tossLand: {
    bodyFreq: 2200, bodyQ: 1.0, bodyDur: 0.07, bodyGain: 0.09, bodyAttack: 0.003, bodyHp: 1000,
    clickFreq: 6500, clickQ: 5, clickDur: 0.014, clickGain: 0.02,
    thudFreq: 130, thudDur: 0.11, thudGain: 0.22
  }
};

// ---- Composite / ceremonial sounds: built from the same primitives, patterned over time --------

function riffleLayers(v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  const layers: Layer[] = [];
  const n = 26; // two interleaving streams of clicks
  for (let i = 0; i < n; i++) {
    const t = 0.05 + (i / n) * 0.75 + Math.random() * 0.012;
    layers.push({ kind: 'noise', freq: 3600 * pm * jitter(0.15), q: 3, dur: 0.03, gain: 0.05 + v * 0.05, when: t, hp: 1500 });
    layers.push({ kind: 'noise', freq: 2900 * pm * jitter(0.15), q: 3, dur: 0.03, gain: 0.04 + v * 0.04, when: t + 0.014, hp: 1200 });
  }
  for (let i = 0; i < 10; i++) {
    layers.push({ kind: 'noise', freq: (3000 - i * 150) * pm, q: 2, dur: 0.04, gain: 0.05, when: 0.86 + i * 0.022, hp: 1200 });
  }
  layers.push({ kind: 'thud', freq: 130, dur: 0.12, gain: 0.12, when: 1.1 });
  return layers;
}

function cutLayers(v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  const layers: Layer[] = [];
  const n = 30; // a slower, heavier riffle for the ceremony
  for (let i = 0; i < n; i++) {
    const t = 0.05 + (i / n) * 1.35 + Math.random() * 0.015;
    layers.push({ kind: 'noise', freq: 3200 * pm * jitter(0.15), q: 3, dur: 0.035, gain: 0.05 + v * 0.05, when: t, hp: 1400 });
    layers.push({ kind: 'noise', freq: 2500 * pm * jitter(0.15), q: 3, dur: 0.035, gain: 0.04 + v * 0.04, when: t + 0.02, hp: 1100 });
  }
  layers.push({ kind: 'tone', freq: 130.81 * pm, dur: 1.8, gain: 0.03, when: 0.1 });
  layers.push({ kind: 'tone', freq: 196.0 * pm, dur: 1.6, gain: 0.02, when: 0.6 });
  layers.push({ kind: 'thud', freq: 130, dur: 0.14, gain: 0.14, when: 1.5 });
  return layers;
}

/** Squaring the deck: three soft taps. */
function squareLayers(): Layer[] {
  return [
    { kind: 'thud', freq: 140, dur: 0.08, gain: 0.08 },
    { kind: 'thud', freq: 140, dur: 0.08, gain: 0.08, when: 0.09 },
    { kind: 'thud', freq: 140, dur: 0.1, gain: 0.1, when: 0.18 }
  ];
}

function tickLayers(v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  return [{ kind: 'noise', freq: 5000 * (0.9 + v * 0.3) * pm, q: 4, dur: 0.02, gain: 0.05 + v * 0.05, hp: 2500 }];
}

function chimeLayers(v: number): Layer[] {
  return [
    { kind: 'tone', freq: 880, dur: 0.5, gain: 0.05 * v + 0.02 },
    { kind: 'tone', freq: 1320, dur: 0.6, gain: 0.03 * v + 0.01, when: 0.03 }
  ];
}

function bloomLayers(): Layer[] {
  return [
    { kind: 'tone', freq: 523.25, dur: 0.9, gain: 0.05 },
    { kind: 'tone', freq: 659.25, dur: 0.9, gain: 0.04, when: 0.08 },
    { kind: 'tone', freq: 783.99, dur: 1.1, gain: 0.04, when: 0.16 },
    { kind: 'tone', freq: 1046.5, dur: 1.4, gain: 0.03, when: 0.26 }
  ];
}

/** Chunks falling from the top hand to the bottom: slower and heavier than the riffle. */
function shuffleOverhandLayers(v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  const layers: Layer[] = [];
  const chunks = 5 + Math.floor(Math.random() * 3); // 5..7
  let t = 0.04;
  for (let c = 0; c < chunks; c++) {
    const clicksInChunk = 3 + Math.floor(Math.random() * 4); // 3..6
    for (let i = 0; i < clicksInChunk; i++) {
      layers.push({ kind: 'noise', freq: 2600 * pm * jitter(0.18), q: 2.5, dur: 0.045, gain: 0.05 + v * 0.05, when: t, hp: 1000 });
      t += 0.035 + Math.random() * 0.02;
    }
    layers.push({ kind: 'thud', freq: 110, dur: 0.09, gain: 0.09 + v * 0.05, when: t });
    t += 0.16 + Math.random() * 0.08;
  }
  return layers;
}

/** A spread: a long ascending flutter. */
function fanLayers(v: number, pitch: number): Layer[] {
  const pm = pitchMul(pitch);
  const layers: Layer[] = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 0.55 + Math.random() * 0.006;
    const freq = (1800 + (i / n) * 3200) * pm;
    layers.push({ kind: 'noise', freq, q: 2.5, dur: 0.03, gain: 0.03 + v * 0.04, when: t, hp: 900 });
  }
  return layers;
}

/** Warmer than `chime`: two soft partials a fifth apart with a slow attack. */
function wakeLayers(v: number): Layer[] {
  return [
    { kind: 'tone', freq: 660, dur: 0.9, gain: 0.03 * v + 0.015, attack: 0.12 },
    { kind: 'tone', freq: 990, dur: 1.0, gain: 0.02 * v + 0.01, attack: 0.16, when: 0.05 }
  ];
}

/** A three-note rising figure, quieter than `bloom`. */
function milestoneLayers(): Layer[] {
  return [
    { kind: 'tone', freq: 523.25, dur: 0.35, gain: 0.03 },
    { kind: 'tone', freq: 659.25, dur: 0.35, gain: 0.025, when: 0.1 },
    { kind: 'tone', freq: 783.99, dur: 0.45, gain: 0.025, when: 0.2 }
  ];
}

/** A very soft muted thump for an illegal drop. Low, short, gentle attack — never harsh or beepy. */
function errorLayers(): Layer[] {
  return [{ kind: 'thud', freq: 90, dur: 0.09, gain: 0.05, attack: 0.01 }];
}

// ---- The table: name -> (velocity, pitch) -> layers ---------------------------------------------

type Builder = (v: number, pitch: number) => Layer[];

const SOUND_TABLE: Record<string, Builder> = {
  pick: (v, p) => cardLayers(CARD_MIX.pick, v, p),
  slide: (v, p) => cardLayers(CARD_MIX.slide, v, p),
  place: (v, p) => cardLayers(CARD_MIX.place, v, p),
  slideBack: (v, p) => cardLayers(CARD_MIX.slideBack, v, p),
  flip: (v, p) => cardLayers(CARD_MIX.flip, v, p),
  deal: (v, p) => cardLayers(CARD_MIX.deal, v, p),
  toss: (v, p) => cardLayers(CARD_MIX.toss, v, p),
  tossLand: (v, p) => cardLayers(CARD_MIX.tossLand, v, p),
  riffle: riffleLayers,
  cut: cutLayers,
  square: () => squareLayers(),
  tick: tickLayers,
  chime: (v) => chimeLayers(v),
  bloom: () => bloomLayers(),
  shuffleOverhand: shuffleOverhandLayers,
  fan: fanLayers,
  wake: (v) => wakeLayers(v),
  milestone: () => milestoneLayers(),
  error: () => errorLayers()
};

/** Every sound name the presenter handles. Drives the Settings "test sounds" row (see soundLab.ts). */
export const SOUND_NAMES: string[] = Object.keys(SOUND_TABLE);

/** Pure: resolves a sound name + velocity/pitch into its layer stack. No ctx touched — testable in Node. */
export function layersFor(name: string, velocity = 0.5, pitch = 0.5): Layer[] {
  const build = SOUND_TABLE[name];
  if (!build) return [];
  return build(clamp01(velocity), clamp01(pitch));
}

// ---- Public API --------------------------------------------------------------------------------

export function sound(name: string, velocity = 0.5, opts?: { pitch?: number }): void {
  if (!unlocked || !ctx) return;
  playLayers(layersFor(name, velocity, opts?.pitch ?? 0.5));
}

const PATTERNS: Record<string, number[]> = { tick: [8], soft: [15], thud: [25], success: [10, 40, 15] };
export function haptic(name: string): void {
  try {
    const p = PATTERNS[name];
    if (p && 'vibrate' in navigator) navigator.vibrate(p);
  } catch {
    /* ignore */
  }
}
