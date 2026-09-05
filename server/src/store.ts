/**
 * Storage-adapter seam (ADR-012 / docs/07-backend.md). Handlers in app.ts depend only on this
 * interface — no SQL, no AWS SDK. `sqliteStore.ts` implements it for Stage 1 (Node + node:sqlite);
 * `memoryStore.ts` implements it for tests; a `DynamoSaveStore` implements it for Stage 2 (Lambda),
 * with `version` as a conditional-write guard giving 409 semantics natively.
 */

export interface SaveRecord {
  version: number;
  updatedAt: number;
  schemaVersion: number;
  progress: string;
  blob: string;
}

export interface HistoryEntry {
  version: number;
  updatedAt: number;
  progress: string;
}

export interface PutInput {
  baseVersion: number;
  schemaVersion: number;
  progress: string;
  blob: string;
}

/** `ok: true` on a successful write (new current version). `ok: false` on a stale `baseVersion` —
 * `current` is the server's present save (never absent in that case: an absent save only accepts
 * `baseVersion` 0, which always succeeds). */
export type PutResult = { ok: true; record: SaveRecord } | { ok: false; current: SaveRecord };

export interface SaveStore {
  /** Mints a new anonymous player + bearer token. The store is responsible for persisting only a
   * hash of the token, never the token itself. */
  createPlayer(): Promise<{ playerId: string; token: string }>;

  /** Resolves a bearer token to a playerId, or null if unknown/invalid. */
  getPlayerIdForToken(token: string): Promise<string | null>;

  getSave(playerId: string): Promise<SaveRecord | null>;

  /** Read-compare-write against the current version. Also appends to history, keeping only the
   * last 10 entries per player. */
  putSave(playerId: string, input: PutInput): Promise<PutResult>;

  /** Last 10 versions, newest first, blob omitted. */
  getHistory(playerId: string): Promise<HistoryEntry[]>;

  /** The blob for one historical version, or null if not present (evicted or never existed). */
  getHistoryBlob(playerId: string, version: number): Promise<string | null>;
}
