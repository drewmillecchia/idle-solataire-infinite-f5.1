/**
 * Synthesised card sounds (ADR-013) and haptics. Parametric: every call takes a velocity 0..1.
 * Nothing plays before the first user gesture (iOS autoplay policy) — call unlockAudio() on pointerdown.
 */
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
    /* no audio */
  }
}

export function setMasterVolume(v: number): void {
  if (master) master.gain.value = v;
}

const jitter = (amt = 0.04) => 1 + (Math.random() * 2 - 1) * amt;

/** A short band-passed noise burst: the body of every paper sound. */
function burst(opts: { dur: number; freq: number; q: number; gain: number; attack?: number; hp?: number; when?: number }): void {
  if (!ctx || !master || !noiseBuf) return;
  const t0 = ctx.currentTime + (opts.when ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = jitter(0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = opts.freq * jitter();
  bp.Q.value = opts.q;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = opts.hp ?? 300;
  const g = ctx.createGain();
  const a = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(bp).connect(hp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

/** A soft low thud: the felt receiving a card. */
function thud(gain: number, when = 0): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140 * jitter(0.08), t0);
  o.frequency.exponentialRampToValueAtTime(70, t0 + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.1);
}

function tone(freq: number, dur: number, gain: number, when = 0, type: OscillatorType = 'sine'): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq * jitter(0.003);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function sound(name: string, velocity = 0.5): void {
  if (!unlocked || !ctx) return;
  const v = Math.max(0, Math.min(1, velocity));
  switch (name) {
    case 'pick':
      burst({ dur: 0.05, freq: 2600, q: 1.2, gain: 0.05 + v * 0.05 });
      break;
    case 'slide':
      burst({ dur: 0.12, freq: 1800, q: 0.8, gain: 0.04 + v * 0.06, attack: 0.02 });
      break;
    case 'place':
      burst({ dur: 0.06, freq: 3200 * (0.8 + v * 0.4), q: 1.5, gain: 0.08 + v * 0.12 });
      thud(0.10 + v * 0.18);
      break;
    case 'slideBack':
      burst({ dur: 0.16, freq: 1500, q: 0.7, gain: 0.05, attack: 0.03 });
      break;
    case 'flip':
      burst({ dur: 0.045, freq: 4200, q: 2.5, gain: 0.10 + v * 0.08 });
      burst({ dur: 0.08, freq: 1600, q: 1.0, gain: 0.05, when: 0.02 });
      break;
    case 'deal':
      burst({ dur: 0.05, freq: 2800, q: 1.4, gain: 0.05 + v * 0.06 });
      thud(0.06, 0.01);
      break;
    case 'toss':
      burst({ dur: 0.18, freq: 2200, q: 0.6, gain: 0.04 + v * 0.05, attack: 0.04 });
      break;
    case 'riffle': {
      // Two interleaving streams of clicks.
      const n = 26;
      for (let i = 0; i < n; i++) {
        const t = 0.05 + (i / n) * 0.75 + Math.random() * 0.012;
        burst({ dur: 0.03, freq: 3600 * jitter(0.15), q: 3, gain: 0.05 + v * 0.05, when: t });
        burst({ dur: 0.03, freq: 2900 * jitter(0.15), q: 3, gain: 0.04 + v * 0.04, when: t + 0.014 });
      }
      // The bridge: a descending flutter.
      for (let i = 0; i < 10; i++) burst({ dur: 0.04, freq: 3000 - i * 150, q: 2, gain: 0.05, when: 0.86 + i * 0.022 });
      thud(0.12, 1.1);
      break;
    }
    case 'square':
      thud(0.08); thud(0.08, 0.09); thud(0.10, 0.18);
      break;
    case 'tick':
      burst({ dur: 0.02, freq: 5000 * (0.9 + v * 0.3), q: 4, gain: 0.05 + v * 0.05 });
      break;
    case 'chime':
      tone(880, 0.5, 0.05 * v + 0.02); tone(1320, 0.6, 0.03 * v + 0.01, 0.03);
      break;
    case 'bloom':
      tone(523.25, 0.9, 0.05); tone(659.25, 0.9, 0.04, 0.08); tone(783.99, 1.1, 0.04, 0.16); tone(1046.5, 1.4, 0.03, 0.26);
      break;
    default:
      break;
  }
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
