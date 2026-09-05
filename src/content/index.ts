import feelJson from './feel.json';
import upgradesJson from './upgrades.json';
import milestonesJson from './milestones.json';
import constellationJson from './constellation.json';
import marksJson from './marks.json';
import numberingJson from './numbering.json';
import {
  FeelSchema,
  type Feel,
  UpgradesSchema,
  type UpgradeDef,
  type UpgradeEffect,
  type UpgradeRevealAfter,
  MilestonesSchema,
  type MilestoneDef,
  ConstellationSchema,
  type ConstellationNodeDef,
  type ConstellationEffect,
  type ConstellationBranch,
  MarksSchema,
  type MarkDef,
  NumberingLadderSchema,
  type NumberingLadderEntry
} from './schemas';

/** Validated at module load: a malformed entry fails loudly (ADR-008). */
export const FEEL: Feel = FeelSchema.parse(feelJson);
export const UPGRADES: UpgradeDef[] = UpgradesSchema.parse(upgradesJson);
export const MILESTONES: MilestoneDef[] = MilestonesSchema.parse(milestonesJson);
export const CONSTELLATION: ConstellationNodeDef[] = ConstellationSchema.parse(constellationJson);
export const MARKS: MarkDef[] = MarksSchema.parse(marksJson);
export const NUMBERING_LADDER: NumberingLadderEntry[] = NumberingLadderSchema.parse(numberingJson);
export type {
  Feel,
  UpgradeDef,
  UpgradeEffect,
  UpgradeRevealAfter,
  MilestoneDef,
  ConstellationNodeDef,
  ConstellationEffect,
  ConstellationBranch,
  MarkDef,
  NumberingLadderEntry
};
