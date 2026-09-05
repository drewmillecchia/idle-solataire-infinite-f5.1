import feelJson from './feel.json';
import upgradesJson from './upgrades.json';
import milestonesJson from './milestones.json';
import {
  FeelSchema,
  type Feel,
  UpgradesSchema,
  type UpgradeDef,
  type UpgradeEffect,
  type UpgradeRevealAfter,
  MilestonesSchema,
  type MilestoneDef
} from './schemas';

/** Validated at module load: a malformed entry fails loudly (ADR-008). */
export const FEEL: Feel = FeelSchema.parse(feelJson);
export const UPGRADES: UpgradeDef[] = UpgradesSchema.parse(upgradesJson);
export const MILESTONES: MilestoneDef[] = MilestonesSchema.parse(milestonesJson);
export type { Feel, UpgradeDef, UpgradeEffect, UpgradeRevealAfter, MilestoneDef };
