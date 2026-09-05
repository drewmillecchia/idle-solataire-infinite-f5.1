import { handle } from 'hono/aws-lambda';
import { createApp } from './app.ts';
import type { HistoryEntry, PutInput, PutResult, SaveRecord, SaveStore } from './store.ts';

/**
 * Stage 2 (docs/07-backend.md): same `createApp` as node.ts, swapping the storage adapter for
 * DynamoDB. Partition key `playerId`; `version` becomes a conditional-write guard
 * (`ConditionExpression: version = :base`), giving 409 semantics natively instead of an explicit
 * transaction. This file type-checks so the seam stays honest, but is not wired to run yet —
 * nothing here has been deployed or exercised against a real table.
 *
 * TODO(Stage 2): implement DynamoStore for real —
 *   - `players` item per playerId with a token hash (or move to a signed-JWT session instead of a
 *     stored-token lookup, since Dynamo has no cheap secondary index without a GSI);
 *   - `saves` item per playerId, PutItem with ConditionExpression on `version`;
 *   - `save_history` items keyed `playerId#version`, trimmed to the last 10 (a DynamoDB Stream or a
 *     scheduled cleanup, since Dynamo has no equivalent of SQLite's DELETE ... ORDER BY LIMIT).
 */
class DynamoStore implements SaveStore {
  async createPlayer(): Promise<{ playerId: string; token: string }> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }

  async getPlayerIdForToken(_token: string): Promise<string | null> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }

  async getSave(_playerId: string): Promise<SaveRecord | null> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }

  async putSave(_playerId: string, _input: PutInput): Promise<PutResult> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }

  async getHistory(_playerId: string): Promise<HistoryEntry[]> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }

  async getHistoryBlob(_playerId: string, _version: number): Promise<string | null> {
    throw new Error('DynamoStore not implemented (Stage 2 TODO)');
  }
}

const store = new DynamoStore();
const app = createApp(store);

export const handler = handle(app);
