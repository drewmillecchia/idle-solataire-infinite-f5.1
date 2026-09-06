/**
 * THE one derivation pass (CLAUDE.md invariant #2). Every multiplier the economy uses is
 * assembled here, and nowhere else. Callers read the result; they never multiply on their own.
 */
import Decimal from 'break_eternity.js';
import { CONSTELLATION, UPGRADES } from '$content/index';
import { deckShape, deckSize } from '../deck';
import { D } from '../numbers';
import { rankValue } from '../numbering';
import { cardDef, SUITS } from '../types';
import type { Suit } from '../types';
import type { GameState } from '../state';
import { cardsWithMark, markSlotsFrom } from '../marks/placement';

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
  /** Cuts awarded by a Cut are multiplied by this (Constellation "Sharper Cut"). */
  cutYieldMult: Decimal;
  /** How many cards keep their wake through a Cut (the highest-charge ones). */
  keepAwake: number;
  /** Charge those surviving cards start the next run with. */
  startCharge: number;
  /**
   * Fraction of its own charge a surviving card keeps through a Cut, floored at `startCharge`.
   * Reserved: no Constellation node grants it yet (the Anchor mark will, in M4).
   */
  keepCharge: number;
  /** Mark slots granted by the Constellation alone. */
  markSlots: number;
  /** Every mark slot the player has: the first Cut's slot plus the Constellation's. */
  markSlotsTotal: number;
  /** Seconds between Auto-Dealer moves. */
  dealerBeatSeconds: number;
  /** Constellation rule-twist: the Auto-Dealer plays even while the player is at the table. */
  autoDealerAlwaysOn: boolean;
}

const BASE_OFFLINE_HOURS = 8;
const BASE_CHARGE_SLOPE = 0.1;
const BASE_DEALER_BEAT_SECONDS = 0.9;
/** "Fresh Cards" (tier 2): a card counts as young at or below this charge. */
const FRESH_CHARGE_THRESHOLD = 2;

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
  let cutYieldMult = D(1);
  let keepAwake = 0;
  let startCharge = 0;
  let markSlots = 0;
  let dealerSpeed = 0;
  let autoDealerAlwaysOn = false;
  /** Tier 2: extra chargeMult slope for face cards only (Crowned). */
  let chargeSlopeFace = 0;
  /** Tier 2: extra output for cards at or under FRESH_CHARGE_THRESHOLD (Fresh Cards). */
  let freshBoost = 0;

  const cardStates = state.cards;
  const deckN = deckSize(deckShape(state.deck));
  const awakeCount = cardStates.reduce((n, c) => (c.awake ? n + 1 : n), 0);
  const homedThisRun = state.run.homedThisRun;
  /** How many cards have already come home THIS hand (Big Turn). */
  const homedThisHandCount = state.run.hand?.homedThisHand?.length ?? 0;

  // Ledger (passive): this card's charge counts twice toward the Devotion upgrade's log-count —
  // computed here, once, so 'devotionMult' below reads the SAME effective count every level.
  let devotionCount = homedThisRun;
  for (const id of cardsWithMark(state, 'ledger')) {
    devotionCount += cardStates[id]?.charge ?? 0;
  }

  // Per-suit total charge (a proxy for "how much you've played this suit"), used by the tier 2
  // suit-specialisation upgrades below. Ties break on SUITS' own order (stable sort).
  const suitChargeSum: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  cardStates.forEach((c, id) => {
    suitChargeSum[cardDef(id).suit] += c.charge;
  });
  const suitsByCharge = [...SUITS].sort((a, b) => suitChargeSum[a] - suitChargeSum[b]);
  const laggardSuits = new Set(suitsByCharge.slice(0, 2));
  const topSuit = suitsByCharge[suitsByCharge.length - 1] ?? 'S';

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
        awake = awake.times(1 + effect.per * level * (awakeCount / deckN));
        break;
      case 'devotionMult':
        devotion = devotion.times(1 + effect.per * level * Math.log10(1 + devotionCount));
        break;
      case 'offlineHours':
        offlineHours += effect.add * level;
        break;
      case 'autoDealer':
        autoDealerUnlocked = true;
        break;
      case 'comebackMult':
        // Pays MORE the fewer cards are awake: a comeback lever, strongest at the start of a run.
        global = global.times(1 + effect.per * level * (1 - awakeCount / deckN));
        break;
      case 'handsWonMult':
        global = global.times(1 + effect.per * level * Math.log10(1 + state.run.handsWon));
        break;
      case 'sparkForBurst': {
        // A trade, not a pure gain: spark falls, burst rises by twice as much.
        const trade = Math.min(0.9, effect.per * level);
        sparkMult = sparkMult.times(1 - trade);
        burstMult = burstMult.times(1 + effect.per * level * 2);
        break;
      }
      case 'chargeMultFace':
        chargeSlopeFace += effect.per * level;
        break;
      case 'laggardSuitMult':
        for (const s of laggardSuits) suit[s] = suit[s].times(1 + effect.per * level);
        break;
      case 'topSuitMult':
        suit[topSuit] = suit[topSuit].times(1 + effect.per * level);
        break;
      case 'chainMult':
        global = global.times(1 + effect.per * level * homedThisHandCount);
        break;
      case 'freshCardMult':
        freshBoost += effect.per * level;
        break;
    }
  }

  // Constellation: permanent, bought with Cuts. Folded into the SAME pass (invariant #2).
  // Note its `globalMult` lands in `global`, so `cutThreshold`'s multiplier already includes it.
  for (const node of CONSTELLATION) {
    const level = state.prestige.constellation[node.id] ?? 0;
    if (level <= 0) continue;
    const effect = node.effect;
    switch (effect.kind) {
      case 'globalMult':
        global = global.times(1 + effect.per * level);
        break;
      case 'keepAwake':
        keepAwake += effect.add * level;
        break;
      case 'startCharge':
        startCharge += effect.add * level;
        break;
      case 'offlineHours':
        offlineHours += effect.add * level;
        break;
      case 'cutYield':
        cutYieldMult = cutYieldMult.times(1 + effect.per * level);
        break;
      case 'dealerUnlock':
        autoDealerUnlocked = true;
        break;
      case 'dealerSpeed':
        dealerSpeed += effect.per * level;
        break;
      case 'burstMult':
        burstMult = burstMult.times(1 + effect.per * level);
        break;
      case 'sparkMult':
        sparkMult = sparkMult.times(1 + effect.per * level);
        break;
      case 'markSlots':
        markSlots += effect.add * level;
        break;
      case 'wayUnlock':
        // Applied at purchase (prestige.waysUnlocked); nothing to derive.
        break;
      case 'dealerAlwaysOn':
        // A RULE twist (docs/02 §9): the Auto-Dealer keeps dealing even while the player watches,
        // not only through the idle wait. The host loop reads this flag; derive only carries it.
        autoDealerAlwaysOn = true;
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
      autoDealerUnlocked = true;
      break;
    case 'scholar':
      // Deals are always winnable and undo is free; in exchange each charge is worth less.
      chargeSlope *= 0.7;
      break;
    case 'gambler': {
      // The wager `dealHand` rolled for this hand (docs/02-game-design.md §5). It is applied HERE
      // and nowhere else (invariant #2), and it moves the two payouts the player feels move —
      // sparks and the win burst — not the idle deck rate, so a bad roll never stalls the deck.
      // A state that has never met the Gambler carries roll 1, so this is a no-op for everyone else.
      const raw = state.run.hand?.roll;
      const roll = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
      sparkMult = sparkMult.times(roll);
      burstMult = burstMult.times(roll);
      break;
    }
    default:
      // 'none', 'scholar': no adjustment in this slice.
      break;
  }

  const cut = D(1).plus(state.prestige.lifetimeCuts).pow(1.5);
  const permutation = D(1).plus(state.prestige.lifetimePermutations).pow(1.2);
  const way = D(1);

  // Marks that are pure multipliers land in the SAME pass (invariant #2), folded into the suit
  // multiplier, which is deliberately outside `cutMultiplier`: they are card-side play progress.
  //   Lantern - while AWAKE, its suit x1.5, stacking multiplicatively.
  //   Tithe   - its own output is 0 (below) and its suit x1.25 per tithe, awake or not: the card
  //             gives up its earnings by being marked, so the suit is lifted from the moment the
  //             mark is placed.
  for (const id of cardsWithMark(state, 'lantern')) {
    if (!cardStates[id]?.awake) continue;
    const s = cardDef(id).suit;
    suit[s] = suit[s].times(1.5);
  }
  const titheCards = new Set(cardsWithMark(state, 'tithe'));
  for (const id of titheCards) {
    const s = cardDef(id).suit;
    suit[s] = suit[s].times(1.25);
  }

  // Compass (passive): while awake, the lowest-charged awake card of its suit earns as if it had
  // the Compass card's own charge. Built as an override map so the perCard pass below (the ONE
  // place charge turns into a multiplier) is still the only place that reads a card's charge.
  const chargeOverride = new Map<number, number>();
  for (const id of cardsWithMark(state, 'compass')) {
    const compassCard = cardStates[id];
    if (!compassCard?.awake) continue;
    const compassSuit = cardDef(id).suit;
    let lowestId = -1;
    let lowestCharge = Infinity;
    cardStates.forEach((c, cid) => {
      if (!c.awake || cardDef(cid).suit !== compassSuit) return;
      if (c.charge < lowestCharge) {
        lowestCharge = c.charge;
        lowestId = cid;
      }
    });
    if (lowestId >= 0) chargeOverride.set(lowestId, compassCard.charge);
  }

  const mults: DerivedMults = { global, suit, awake, devotion, cut, permutation, way };

  const perCard: Decimal[] = cardStates.map((card, id) => {
    if (!card.awake) return D(0);
    if (titheCards.has(id)) return D(0);
    const { suit: cardSuit, rank } = cardDef(id);
    const base = rankValue(state.numbering, rank);
    const effCharge = chargeOverride.get(id) ?? card.charge;
    const slope = chargeSlope + (rank >= 11 ? chargeSlopeFace : 0);
    const fresh = effCharge <= FRESH_CHARGE_THRESHOLD ? 1 + freshBoost : 1;
    return base
      .times(suit[cardSuit])
      .times(1 + slope * effCharge)
      .times(fresh)
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
    autoDealerUnlocked,
    cutYieldMult,
    keepAwake: Math.min(deckN, keepAwake),
    startCharge,
    keepCharge: 0,
    markSlots,
    markSlotsTotal: markSlotsFrom(state, markSlots),
    dealerBeatSeconds: BASE_DEALER_BEAT_SECONDS / (1 + dealerSpeed),
    autoDealerAlwaysOn
  };
}
