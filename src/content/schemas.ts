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
  z.object({ kind: z.literal('autoDealer') })
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

export const MilestoneDefSchema = z.object({
  id: z.string().min(1),
  value: decimalString,
  label: z.string().min(1),
  ledger: z.string().min(1)
});
export type MilestoneDef = z.infer<typeof MilestoneDefSchema>;

export const MilestonesSchema = z.array(MilestoneDefSchema);
