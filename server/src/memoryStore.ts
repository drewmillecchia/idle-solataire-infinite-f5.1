import { randomBytes, createHash } from 'node:crypto';
import type { HistoryEntry, PutInput, PutResult, SaveRecord, SaveStore } from './store.ts';

const HISTORY_LIMIT = 10;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface Player {
  playerId: string;
  tokenHash: string;
}

/** In-memory `SaveStore` for tests — same read-compare-write semantics as the SQLite store, no disk. */
export class MemoryStore implements SaveStore {
  private players: Player[] = [];
  private saves = new Map<string, SaveRecord>();
  private history = new Map<string, HistoryEntry[]>();
  private historyBlobs = new Map<string, string>();

  async createPlayer(): Promise<{ playerId: string; token: string }> {
    const playerId = randomBytes(16).toString('hex');
    const token = randomBytes(24).toString('hex');
    this.players.push({ playerId, tokenHash: hashToken(token) });
    return { playerId, token };
  }

  async getPlayerIdForToken(token: string): Promise<string | null> {
    const hash = hashToken(token);
    const player = this.players.find((p) => p.tokenHash === hash);
    return player ? player.playerId : null;
  }

  async getSave(playerId: string): Promise<SaveRecord | null> {
    return this.saves.get(playerId) ?? null;
  }

  async putSave(playerId: string, input: PutInput): Promise<PutResult> {
    const current = this.saves.get(playerId) ?? null;
    const currentVersion = current?.version ?? 0;
    if (input.baseVersion !== currentVersion) {
      // `current` is non-null whenever this fires with a real save in play (baseVersion 0 always
      // matches an absent save, so a mismatch here means a save exists). The virtual all-zero
      // record below only surfaces for a malformed baseVersion sent before any save ever existed.
      return {
        ok: false,
        current: current ?? { version: 0, updatedAt: 0, schemaVersion: 0, progress: '0', blob: '' }
      };
    }
    const record: SaveRecord = {
      version: currentVersion + 1,
      updatedAt: Date.now(),
      schemaVersion: input.schemaVersion,
      progress: input.progress,
      blob: input.blob
    };
    this.saves.set(playerId, record);

    const key = `${playerId}`;
    const list = this.history.get(key) ?? [];
    list.unshift({ version: record.version, updatedAt: record.updatedAt, progress: record.progress });
    this.historyBlobs.set(`${playerId}:${record.version}`, record.blob);
    while (list.length > HISTORY_LIMIT) {
      const dropped = list.pop();
      if (dropped) this.historyBlobs.delete(`${playerId}:${dropped.version}`);
    }
    this.history.set(key, list);

    return { ok: true, record };
  }

  async getHistory(playerId: string): Promise<HistoryEntry[]> {
    return [...(this.history.get(playerId) ?? [])];
  }

  async getHistoryBlob(playerId: string, version: number): Promise<string | null> {
    return this.historyBlobs.get(`${playerId}:${version}`) ?? null;
  }
}
