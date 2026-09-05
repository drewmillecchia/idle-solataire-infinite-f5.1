/**
 * Save migrations. Switch on `raw.version`; each branch upgrades the shape by one step.
 * `deserialize`'s repair pass is the safety net — migrate only needs to reshape, not validate.
 */

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

export function migrate(raw: RawSave): RawSave {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  switch (version) {
    case 1:
      return v1ToV2(raw);
    case 2:
      return raw;
    default:
      // Unknown, missing, or future version: pass through. `deserialize`'s repair pass fills
      // in anything missing from `createInitialState`, so this never throws.
      return raw;
  }
}
