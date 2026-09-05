/**
 * Save migrations. Switch on `raw.version`; each branch upgrades the shape by one step.
 * `deserialize`'s repair pass is the safety net — migrate only needs to reshape, not validate.
 */

/** A save payload of unknown shape and vintage, prior to migration or repair. */
export type RawSave = Record<string, unknown>;

export function migrate(raw: RawSave): RawSave {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  switch (version) {
    case 1:
      return raw;
    default:
      // Unknown, missing, or future version: pass through. `deserialize`'s repair pass fills
      // in anything missing from `createInitialState`, so this never throws.
      return raw;
  }
}
