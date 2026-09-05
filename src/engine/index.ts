/**
 * Public engine API. PURE: no DOM, no Svelte, no Pixi. See CLAUDE.md invariants.
 */

// Core types and helpers.
export * from './types';
export * from './events';
export * from './rng';
export * from './numbers';
export * from './numbering';
export * from './state';

// Economy.
export * from './economy/derive';
export * from './economy/cards';
export * from './economy/hand';
export * from './economy/upgrades';
export * from './economy/milestones';
export * from './economy/prestige';
export * from './economy/constellation';

// Marks.
export * from './marks/index';

// Tick and offline.
export * from './tick';

// Save.
export * from './save/serialize';
export * from './save/migrate';
