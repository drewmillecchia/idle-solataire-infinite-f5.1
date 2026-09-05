/**
 * Marks: placed, combinable one-sentence rules (docs/02-game-design.md §4, ADR-006). PURE.
 *
 *   placement.ts  where a mark may go, and the slot arithmetic
 *   interpret.ts  the trigger marks, as one listener on the event bus
 *   twists.ts     the rule-twist marks, as the read-only view a GameModule consults
 *
 * The passive marks live where their effect belongs: Lantern and Tithe in `economy/derive.ts`
 * (invariant #2 — one pass), Anchor in `economy/prestige.ts`.
 */
export * from './placement';
export * from './interpret';
export * from './twists';
