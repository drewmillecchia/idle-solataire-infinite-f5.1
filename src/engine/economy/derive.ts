/**
 * THE one derivation pass (CLAUDE.md invariant #2). Every multiplier the economy uses is
 * assembled here, and nowhere else. Callers read the result; they never multiply on their own.
 */
import Decimal from 'break_eternity.js';
import { UPGRADES } from '$content/index';
import { D } from '../numbers';
import { rankValue } from '../numbering';
import { cardDef } from '../types';
import type { Suit } from '../types';
import type { GameState } from '../state';

export interface DerivedMults {
  global: Decimal;
  suit: Record<Suit, Decimal>;
  awake: Decimal;
  devotion: Decimal;
  cut: Decimal;
  permutation: Decimal;
  /** Reserved for Way effects that multiply per-card output directly (currently always 1). */
  way: Decimal;
}

export interface Derived {
  /** Per-card shuffles/second, index = CardId. 0 while asleep. */
  perCard: Decimal[];
  /** Sum of perCard: total shuffles/second. */
  deckRate: Decimal;
  awakeCount: number;
  mults: DerivedMults;
  /** Coefficient in perCard's `(1 + chargeSlope * charge)` factor. */
  chargeSlope: number;
  burstMult: Decimal;
  sparkMult: Decimal;
  offlineCapSeconds: number;
  autoDealerUnlocked: boolean;
}

const BASE_OFFLINE_HOURS = 8;
const BASE_CHARGE_SLOPE = 0.1;

export function derive(state: GameState): Derived {
  let global = D(1);
  const suit: Record<Suit, Decimal> = { S: D(1), H: D(1), D: D(1), C: D(1) };
  let awake = D(1);
  let devotion = D(1);
  let burstMult = D(1);
  let sparkMult = D(1);
  let chargeSlope = BASE_CHARGE_SLOPE;
  let offlineHours = 0;
  let autoDealerUnlocked = false;

  const cardStates = state.cards;
  const awakeCount = cardStates.reduce((n, c) => (c.awake ? n + 1 : n), 0);
  const homedThisRun = state.run.homedThisRun;

  for (const def of UPGRADES) {
    const level = state.run.upgrades[def.id] ?? 0;
    if (level <= 0) continue;
    const effect = def.effect;
    switch (effect.kind) {
      case 'globalMult':
        global = global.times(1 + effect.per * level);
        break;
      case 'suitMult':
        suit[effect.suit] = suit[effect.suit].times(1 + effect.per * level);
        break;
      case 'chargeMult':
        chargeSlope += effect.per * level;
        break;
      case 'burstMult':
        burstMult = burstMult.times(1 + effect.per * level);
        break;
      case 'sparkMult':
        sparkMult = sparkMult.times(1 + effect.per * level);
        break;
      case 'awakeMult':
        awake = awake.times(1 + effect.per * level * (awakeCount / 52));
        break;
      case 'devotionMult':
        devotion = devotion.times(1 + effect.per * level * Math.log10(1 + homedThisRun));
        break;
      case 'offlineHours':
        offlineHours += effect.add * level;
        break;
      case 'autoDealer':
        autoDealerUnlocked = true;
        break;
    }
  }

  switch (state.run.way) {
    case 'hand':
      sparkMult = sparkMult.times(3);
      burstMult = burstMult.times(2);
      break;
    case 'dealer':
      global = global.times(1.5);
      sparkMult = sparkMult.times(0.5);
      break;
    default:
      // 'none', 'gambler', 'scholar': no adjustment in this slice.
      break;
  }

  const cut = D(1).plus(state.prestige.lifetimeCuts).pow(1.5);
  const permutation = D(1).plus(state.prestige.lifetimePermutations).pow(1.2);
  const way = D(1);

  const mults: DerivedMults = { global, suit, awake, devotion, cut, permutation, way };

  const perCard: Decimal[] = cardStates.map((card, id) => {
    if (!card.awake) return D(0);
    const { suit: cardSuit, rank } = cardDef(id);
    const base = rankValue(state.numbering, rank);
    return base
      .times(suit[cardSuit])
      .times(1 + chargeSlope * card.charge)
      .times(global)
      .times(awake)
      .times(devotion)
      .times(cut)
      .times(permutation)
      .times(way);
  });

  const deckRate = perCard.reduce((acc, v) => acc.plus(v), D(0));
  const offlineCapSeconds = (BASE_OFFLINE_HOURS + offlineHours) * 3600;

  return {
    perCard,
    deckRate,
    awakeCount,
    mults,
    chargeSlope,
    burstMult,
    sparkMult,
    offlineCapSeconds,
    autoDealerUnlocked
  };
}
