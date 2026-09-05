import type { Feel } from './index';

/**
 * Starting points for tuning (docs/05-feel.md). Each preset is a *partial* override applied over the
 * defaults in feel.json, so a preset only says what it changes and new keys keep working.
 */
export interface FeelPreset {
  id: string;
  name: string;
  blurb: string;
  values: Partial<Feel>;
}

export const FEEL_PRESETS: FeelPreset[] = [
  {
    id: 'default',
    name: 'The desk',
    blurb: 'The tuned default: paper with a little weight.',
    values: {}
  },
  {
    id: 'crisp',
    name: 'Crisp',
    blurb: 'Cards snap to the finger and settle fast. Least lag, least drama.',
    values: {
      followResponse: 0.025,
      placeResponse: 0.12,
      placeDamping: 0.95,
      returnResponse: 0.2,
      liftResponse: 0.08,
      liftScale: 1.04,
      tiltGain: 0.0005,
      tiltMaxRad: 0.1,
      dealIntervalMs: 26,
      dealResponse: 0.2
    }
  },
  {
    id: 'heavy',
    name: 'Heavy stock',
    blurb: 'Thicker card, more trail, a landing you can feel.',
    values: {
      followResponse: 0.075,
      runLagMs: 22,
      placeResponse: 0.24,
      placeDamping: 0.72,
      liftScale: 1.09,
      shadowLiftPx: 20,
      tiltGain: 0.0013,
      tiltMaxRad: 0.24,
      throwFriction: 0.978
    }
  },
  {
    id: 'playful',
    name: 'Playful',
    blurb: 'Leans hard into throws: light cards, wide catch, plenty of bounce.',
    values: {
      throwMinPxPerS: 650,
      throwCatchRadiusPx: 110,
      throwFriction: 0.99,
      throwSpinGain: 0.0009,
      placeDamping: 0.62,
      tiltGain: 0.0016,
      tiltMaxRad: 0.3,
      magnetRadiusPx: 90
    }
  },
  {
    id: 'calm',
    name: 'Calm',
    blurb: 'Slower everything. For playing in bed with the lamp low.',
    values: {
      followResponse: 0.06,
      placeResponse: 0.3,
      placeDamping: 0.9,
      returnResponse: 0.4,
      liftResponse: 0.2,
      dealIntervalMs: 55,
      dealResponse: 0.34,
      riffleDurationMs: 1500,
      holdStartHz: 2,
      holdMaxHz: 12
    }
  }
];
