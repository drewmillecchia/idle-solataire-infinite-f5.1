import { z } from 'zod';

export const FeelSchema = z.object({
  $comment: z.string().optional(),
  tapMaxMs: z.number().positive(),
  dragThresholdPx: z.number().positive(),
  doubleTapMs: z.number().positive(),
  longPressMs: z.number().positive(),
  liftScale: z.number().min(1),
  liftResponse: z.number().positive(),
  liftDamping: z.number().positive(),
  shadowLiftPx: z.number().min(0),
  shadowBaseAlpha: z.number().min(0).max(1),
  runLagMs: z.number().min(0),
  followResponse: z.number().positive(),
  followDamping: z.number().positive(),
  tiltGain: z.number().min(0),
  tiltMaxRad: z.number().min(0),
  tiltResponse: z.number().positive(),
  tiltDamping: z.number().positive(),
  targetGlowAlpha: z.number().min(0).max(1),
  magnetRadiusPx: z.number().min(0),
  targetMagnetScale: z.number().min(1),
  placeResponse: z.number().positive(),
  placeDamping: z.number().positive(),
  returnResponse: z.number().positive(),
  returnDamping: z.number().positive(),
  illegalShakePx: z.number().min(0),
  throwMinPxPerS: z.number().positive(),
  throwMaxPxPerS: z.number().positive(),
  throwFriction: z.number().min(0.9).max(1),
  throwCatchRadiusPx: z.number().min(0),
  catchResponse: z.number().positive(),
  throwSpinGain: z.number().min(0),
  autoMoveResponse: z.number().positive(),
  autoMoveDamping: z.number().positive(),
  arcHeightPx: z.number().min(0),
  flipResponse: z.number().positive(),
  flipLift: z.number().min(1),
  dealIntervalMs: z.number().min(0),
  dealResponse: z.number().positive(),
  dealDamping: z.number().positive(),
  riffleDurationMs: z.number().positive(),
  overhandDurationMs: z.number().positive(),
  btnPressScale: z.number().positive().max(1),
  btnPressResponse: z.number().positive(),
  btnReleaseDamping: z.number().positive(),
  holdInitialMs: z.number().min(0),
  holdStartHz: z.number().positive(),
  holdMaxHz: z.number().positive(),
  holdRampMs: z.number().positive(),
  toggleResponse: z.number().positive(),
  toggleDamping: z.number().positive(),
  pitchJitter: z.number().min(0),
  haptics: z.record(z.string(), z.array(z.number().min(0))),
  reducedMotionResponseScale: z.number().positive().max(1)
});
export type Feel = z.infer<typeof FeelSchema>;

/** Decimal strings are validated leniently here; the engine parses them with break_eternity. */
const decimalString = z.string().min(1);

export const UpgradeEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('globalMult'), per: z.number() }),
  z.object({ kind: z.literal('suitMult'), suit: z.enum(['S', 'H', 'D', 'C']), per: z.number() }),
  z.object({ kind: z.literal('chargeMult'), per: z.number() }),
  z.object({ kind: z.literal('burstMult'), per: z.number() }),
  z.object({ kind: z.literal('sparkMult'), per: z.number() }),
  z.object({ kind: z.literal('awakeMult'), per: z.number() }),
  z.object({ kind: z.literal('devotionMult'), per: z.number() }),
  z.object({ kind: z.literal('offlineHours'), add: z.number() }),
  z.object({ kind: z.literal('autoDealer') }),
  /** Tier 2 (docs/02 §9 "more to buy"). Pays more the FEWER cards are awake: 1 + per*level*(1 - awake/52). */
  z.object({ kind: z.literal('comebackMult'), per: z.number() }),
  /** Scales with hands WON this run (not homed plays): 1 + per*level*log10(1+handsWon). */
  z.object({ kind: z.literal('handsWonMult'), per: z.number() }),
  /** A trade, not a pure gain: spark down by per*level, burst up by 2*per*level. */
  z.object({ kind: z.literal('sparkForBurst'), per: z.number() }),
  /** Extra chargeMult slope, face cards (J/Q/K) only. */
  z.object({ kind: z.literal('chargeMultFace'), per: z.number() }),
  /** Boosts the two suits with the least total charge (the ones you've played least). */
  z.object({ kind: z.literal('laggardSuitMult'), per: z.number() }),
  /** Boosts the single suit with the most total charge (specialisation; tension with laggardSuitMult). */
  z.object({ kind: z.literal('topSuitMult'), per: z.number() }),
  /** Rewards a long turn: global lifted by how many cards have already come home THIS hand. */
  z.object({ kind: z.literal('chainMult'), per: z.number() }),
  /** Boosts cards still under the charge threshold (young cards); tension with Patience. */
  z.object({ kind: z.literal('freshCardMult'), per: z.number() })
]);
export type UpgradeEffect = z.infer<typeof UpgradeEffectSchema>;

export const UpgradeRevealAfterSchema = z
  .object({
    awake: z.number().int().min(0).optional(),
    lifetimeShuffles: decimalString.optional(),
    homed: z.number().int().min(0).optional()
  })
  .strict();
export type UpgradeRevealAfter = z.infer<typeof UpgradeRevealAfterSchema>;

export const UpgradeDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  baseCost: decimalString,
  growth: z.number().min(1),
  max: z.number().int().positive().nullable(),
  effect: UpgradeEffectSchema,
  revealAfter: UpgradeRevealAfterSchema.optional()
});
export type UpgradeDef = z.infer<typeof UpgradeDefSchema>;

export const UpgradesSchema = z.array(UpgradeDefSchema);

// ---- Constellation (permanent tree, bought with Cuts; docs/02-game-design.md 6) --------------

export const ConstellationEffectSchema = z.discriminatedUnion('kind', [
  /** Permanent 1 + per*level, folded into `derived.mults.global`. */
  z.object({ kind: z.literal('globalMult'), per: z.number() }),
  /** Cards that keep their wake through a Cut (the highest-charge ones). */
  z.object({ kind: z.literal('keepAwake'), add: z.number().int().min(0) }),
  /** Charge that surviving awake cards start a run with. */
  z.object({ kind: z.literal('startCharge'), add: z.number().int().min(0) }),
  z.object({ kind: z.literal('offlineHours'), add: z.number() }),
  /** Cuts awarded are multiplied by 1 + per*level. */
  z.object({ kind: z.literal('cutYield'), per: z.number() }),
  /** Auto-Dealer available without the run upgrade. */
  z.object({ kind: z.literal('dealerUnlock') }),
  /** Dealer beat shortened: beat = base / (1 + per*level). */
  z.object({ kind: z.literal('dealerSpeed'), per: z.number() }),
  z.object({ kind: z.literal('burstMult'), per: z.number() }),
  z.object({ kind: z.literal('sparkMult'), per: z.number() }),
  /** Adds a Way to `prestige.waysUnlocked` on purchase. */
  z.object({ kind: z.literal('wayUnlock'), way: z.enum(['gambler', 'scholar']) }),
  /** Mark slots, stored on `derived.markSlots` for M4. No other effect yet. */
  z.object({ kind: z.literal('markSlots'), add: z.number().int().min(0) }),
  /** A RULE twist, not a number: the Auto-Dealer keeps playing even while the player is watching. */
  z.object({ kind: z.literal('dealerAlwaysOn') })
]);
export type ConstellationEffect = z.infer<typeof ConstellationEffectSchema>;

export const ConstellationBranchSchema = z.enum(['trunk', 'hand', 'dealer', 'gambler', 'scholar']);
export type ConstellationBranch = z.infer<typeof ConstellationBranchSchema>;

export const ConstellationNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  branch: ConstellationBranchSchema,
  /** Cost of the first level, in Cuts. Level n costs cost * growth^n. */
  cost: decimalString,
  growth: z.number().min(1),
  max: z.number().int().positive(),
  /** Node ids that must be owned at level >= 1 before this one is visible or buyable. */
  requires: z.array(z.string().min(1)),
  effect: ConstellationEffectSchema
});
export type ConstellationNodeDef = z.infer<typeof ConstellationNodeSchema>;

export const ConstellationSchema = z.array(ConstellationNodeSchema);

export const MilestoneDefSchema = z.object({
  id: z.string().min(1),
  value: decimalString,
  label: z.string().min(1),
  ledger: z.string().min(1)
});
export type MilestoneDef = z.infer<typeof MilestoneDefSchema>;

export const MilestonesSchema = z.array(MilestoneDefSchema);

// ---- Marks (placed rules over the event bus; docs/02-game-design.md 4, ADR-006) --------------

/** A Mark is one sentence. `arity` 2 means one placement covers two cards (Twin) in one slot. */
export const MarkDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Exactly one ink-drawable character, stamped on the card face. */
  glyph: z.string().refine((s) => Array.from(s).length === 1, 'glyph must be one character'),
  blurb: z.string().min(1),
  /** The exact mechanic, in one sentence. */
  rule: z.string().min(1),
  /** Cards one placement covers. 1 for every mark but Twin. */
  arity: z.union([z.literal(1), z.literal(2)]),
  /** `trigger` fires on events, `passive` is read by derive/performCut, `twist` is read by rules. */
  kind: z.enum(['trigger', 'passive', 'twist']),
  unlockAtLifetimeCuts: z.number().int().min(0)
});
export type MarkDef = z.infer<typeof MarkDefSchema>;

export const MarksSchema = z.array(MarkDefSchema);

// ---- Numbering ladder (bought with Permutations; docs/02-game-design.md 3, 6) ----------------

/**
 * One rung of the Numbering ladder. `natural` is not here: it is owned from the first deal, so the
 * ladder lists only what Permutations buy, in the order it is listed.
 */
export const NumberingLadderEntrySchema = z.object({
  id: z.enum(['prime', 'triangular', 'fibonacci', 'powers', 'factorial', 'tetration']),
  name: z.string().min(1),
  blurb: z.string().min(1),
  /** Cost in Permutations (the spendable balance, never lifetime). */
  cost: decimalString
});
export type NumberingLadderEntry = z.infer<typeof NumberingLadderEntrySchema>;

export const NumberingLadderSchema = z.array(NumberingLadderEntrySchema);

// ---- Economy (payout tunables; docs/02-game-design.md §2, §5, §10; CLAUDE.md invariant #9) ---

export const EconomySchema = z.object({
  $comment: z.string().optional(),
  /** Win burst length in seconds of deckRate (docs/02 §2, §10). */
  winBurstSeconds: z.number().positive(),
  /** Multiplier applied to the win burst when the hand used an undo (docs/02 §10), 0..1. */
  undoPenalty: z.number().min(0).max(1),
  /** Seconds of deckRate paid when a card comes home again (docs/02 §2, §10). */
  homeSparkSeconds: z.number().positive(),
  /** Seconds of deckRate paid for a tableau move (docs/02 §2, §10). */
  tableauSparkSeconds: z.number().positive(),
  /** Floor every spark is clamped above. */
  minSpark: z.number().positive(),
  /** Way of the Gambler's roll range (docs/02 §5). */
  gamblerRollMin: z.number().positive(),
  gamblerRollMax: z.number().positive(),
  /** Way of the Gambler's Mark fizzle chance (docs/02 §5), 0..1. */
  gamblerFizzleChance: z.number().min(0).max(1)
});
export type Economy = z.infer<typeof EconomySchema>;
