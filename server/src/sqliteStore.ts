import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import type { HistoryEntry, PutInput, PutResult, SaveRecord, SaveStore } from './store.ts';

const HISTORY_LIMIT = 10;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saves (
  player_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  progress TEXT NOT NULL,
  blob TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS save_history (
  player_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  blob TEXT NOT NULL,
  progress TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, version)
);
`;

/** Stage 1 `SaveStore` (docs/07-backend.md / ADR-012): `node:sqlite` on Node 22, file-backed.
 * Stage 2 swaps this module out for a `DynamoSaveStore` behind the same interface — `app.ts` and
 * every handler are untouched. */
export class SqliteStore implements SaveStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async createPlayer(): Promise<{ playerId: string; token: string }> {
    const playerId = randomBytes(16).toString('hex');
    const token = randomBytes(24).toString('hex');
    const tokenHash = hashToken(token);
    this.db
      .prepare('INSERT INTO players (player_id, token_hash, created_at) VALUES (?, ?, ?)')
      .run(playerId, tokenHash, Date.now());
    return { playerId, token };
  }

  async getPlayerIdForToken(token: string): Promise<string | null> {
    const hash = hashToken(token);
    const row = this.db.prepare('SELECT player_id FROM players WHERE token_hash = ?').get(hash) as
      | { player_id: string }
      | undefined;
    return row ? row.player_id : null;
  }

  async getSave(playerId: string): Promise<SaveRecord | null> {
    const row = this.readSaveRow(playerId);
    return row ? rowToRecord(row) : null;
  }

  async putSave(playerId: string, input: PutInput): Promise<PutResult> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const currentRow = this.readSaveRow(playerId);
      const currentVersion = currentRow?.version ?? 0;

      if (input.baseVersion !== currentVersion) {
        this.db.exec('COMMIT');
        const current = currentRow
          ? rowToRecord(currentRow)
          : { version: 0, updatedAt: 0, schemaVersion: 0, progress: '0', blob: '' };
        return { ok: false, current };
      }

      const version = currentVersion + 1;
      const updatedAt = Date.now();

      this.db
        .prepare(
          `INSERT INTO saves (player_id, version, schema_version, progress, blob, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET
             version = excluded.version,
             schema_version = excluded.schema_version,
             progress = excluded.progress,
             blob = excluded.blob,
             updated_at = excluded.updated_at`
        )
        .run(playerId, version, input.schemaVersion, input.progress, input.blob, updatedAt);

      this.db
        .prepare(
          'INSERT INTO save_history (player_id, version, blob, progress, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(playerId, version, input.blob, input.progress, updatedAt);

      this.db
        .prepare(
          `DELETE FROM save_history WHERE player_id = ? AND version NOT IN (
             SELECT version FROM save_history WHERE player_id = ? ORDER BY version DESC LIMIT ?
           )`
        )
        .run(playerId, playerId, HISTORY_LIMIT);

      this.db.exec('COMMIT');
      return { ok: true, record: { version, updatedAt, schemaVersion: input.schemaVersion, progress: input.progress, blob: input.blob } };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async getHistory(playerId: string): Promise<HistoryEntry[]> {
    const rows = this.db
      .prepare(
        'SELECT version, updated_at, progress FROM save_history WHERE player_id = ? ORDER BY version DESC LIMIT ?'
      )
      .all(playerId, HISTORY_LIMIT) as { version: number; updated_at: number; progress: string }[];
    return rows.map((r) => ({ version: r.version, updatedAt: r.updated_at, progress: r.progress }));
  }

  async getHistoryBlob(playerId: string, version: number): Promise<string | null> {
    const row = this.db
      .prepare('SELECT blob FROM save_history WHERE player_id = ? AND version = ?')
      .get(playerId, version) as { blob: string } | undefined;
    return row ? row.blob : null;
  }

  private readSaveRow(playerId: string): SaveRow | undefined {
    return this.db.prepare('SELECT * FROM saves WHERE player_id = ?').get(playerId) as
      | SaveRow
      | undefined;
  }
}

interface SaveRow {
  player_id: string;
  version: number;
  schema_version: number;
  progress: string;
  blob: string;
  updated_at: number;
}

function rowToRecord(row: SaveRow): SaveRecord {
  return {
    version: row.version,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
    progress: row.progress,
    blob: row.blob
  };
}
