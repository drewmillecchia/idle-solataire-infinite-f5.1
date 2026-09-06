/**
 * Save migrations. Switch on `raw.version`; each branch upgrades the shape by one step.
 * `deserialize`'s repair pass is the safety net — migrate only needs to reshape, not validate.
 */
import { STANDARD_52 } from '../deck';
import { SAVE_VERSION } from '../state';

/** A save payload of unknown shape and vintage, prior to migration or repair. */
export type RawSave = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...(value as Record<string, unknown>) } : {};
}

/**
 * v1 -> v2 (M3, Cut the Deck): adds `run.earnedAtStart` / `run.cutAvailableSeenAt`,
 * `prestige.waysUnlocked`, `stats.fastestCutSeconds` / `stats.totalCuts`.
 *
 * A v1 save has never cut, so its whole odometer belongs to the current run: `earnedAtStart` is 0
 * and `runEarned == lifetimeShuffles`. That is the honest reading, and it means a returning v1
 * player can take the Cut their play has already earned.
 */
function v1ToV2(raw: RawSave): RawSave {
  const run = asRecord(raw.run);
  // A plain string: the JSON reviver has already run, so `toDecimal` in the repair pass parses it.
  run.earnedAtStart = '0';
  run.cutAvailableSeenAt = null;

  const prestige = asRecord(raw.prestige);
  prestige.waysUnlocked = ['hand', 'dealer'];

  const stats = asRecord(raw.stats);
  stats.fastestCutSeconds = null;
  stats.totalCuts = 0;

  return { ...raw, version: 2, run, prestige, stats };
}

/**
 * v2 -> v3 (M4, Marks): adds `marks.placed` and the per-hand Mark scratch `run.hand`.
 *
 * A v2 save has no placed marks (the feature did not exist), and a hand in progress had no Echo
 * armed, so both new fields start empty. `cards[i].marks` already existed and was always `[]`;
 * `deserialize` rebuilds it from `marks.placed` regardless.
 */
function v2ToV3(raw: RawSave): RawSave {
  const run = asRecord(raw.run);
  run.hand = { echoRanks: [], homedThisHand: [] };
  return { ...raw, version: 3, run, marks: { placed: [] } };
}

/**
 * v3 -> v4 (M5, Reshuffle + the Gambler): adds `prestige.cutsAtCycleStart` and `run.hand.roll`.
 *
 * A v3 save has never reshuffled, so its whole Cut history belongs to the current cycle:
 * `cutsAtCycleStart` is 0 and `cycleCuts == lifetimeCuts`. That is the honest reading, and it
 * means a returning v3 player can take the Reshuffle their cuts have already earned. `roll` is 1
 * (no wager) because the Gambler could not be played before v4.
 */
function v3ToV4(raw: RawSave): RawSave {
  const prestige = asRecord(raw.prestige);
  // A plain string: the JSON reviver has already run, so `toDecimal` in the repair pass parses it.
  prestige.cutsAtCycleStart = '0';

  const run = asRecord(raw.run);
  const hand = asRecord(run.hand);
  hand.roll = 1;
  run.hand = hand;

  return { ...raw, version: 4, run, prestige };
}

/**
 * v4 -> v5 (Gambler Mark fizzle): adds `run.hand.seed` and `run.hand.fizzleSeq`.
 *
 * A v4 save's in-progress hand was dealt before the fizzle counter existed, so it starts at 0; its
 * seed (if the payload happens to carry one already, e.g. round-tripped through a partial write)
 * is kept, otherwise 0 — either way the next `dealHand` overwrites both.
 */
function v4ToV5(raw: RawSave): RawSave {
  const run = asRecord(raw.run);
  const hand = asRecord(run.hand);
  hand.seed = typeof hand.seed === 'number' ? hand.seed : 0;
  hand.fizzleSeq = 0;
  run.hand = hand;

  return { ...raw, version: 5, run };
}

/** v6 adds lifetime per-game records; older saves start them empty. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function v5ToV6(raw: RawSave): RawSave {
  const stats = asRecord(raw.stats);
  if (!isRecord(stats.perGame)) stats.perGame = {};
  raw.stats = stats;
  raw.version = 6;
  return raw;
}

/**
 * v6 -> v7 (docs/12-ascension.md's deck-shape refactor): adds `deck`, the id of the `DeckShape`
 * that sizes `cards`. A pre-v7 save has only ever known the standard 52, so it starts there.
 */
function v6ToV7(raw: RawSave): RawSave {
  if (typeof raw.deck !== 'string') raw.deck = STANDARD_52.id;
  raw.version = 7;
  return raw;
}

/**
 * Applies every migration step needed to bring a save up to `SAVE_VERSION`.
 *
 * `migrate` advances exactly ONE version per call, so calling it once on a v1 save leaves a v2 save
 * behind. Today every step only adds a field with a default, which `deserialize`'s repair pass would
 * have filled in anyway — so nothing was visibly broken. The moment a step has to *transform* data
 * (rename a field, rescale a value) the skipped steps would silently lose progress instead, which is
 * exactly what invariant #10 exists to prevent. So the chain is run to completion here, once, and the
 * loop cannot spin: a step that fails to advance the version ends it.
 */
export function migrateToCurrent(raw: RawSave): RawSave {
  let current = raw;
  for (let guard = 0; guard <= SAVE_VERSION + 1; guard++) {
    const before = typeof current.version === 'number' ? current.version : 0;
    if (before >= SAVE_VERSION) break;
    const next = migrate(current);
    const after = typeof next.version === 'number' ? next.version : 0;
    current = next;
    if (after <= before) break;
  }
  return current;
}

export function migrate(raw: RawSave): RawSave {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  switch (version) {
    case 1:
      return v1ToV2(raw);
    case 2:
      return v2ToV3(raw);
    case 3:
      return v3ToV4(raw);
    case 4:
      return v4ToV5(raw);
    case 5:
      return v5ToV6(raw);
    case 6:
      return v6ToV7(raw);
    case 7:
      return raw;
    default:
      // Unknown, missing, or future version: pass through. `deserialize`'s repair pass fills
      // in anything missing from `createInitialState`, so this never throws.
      return raw;
  }
}
