# Cloud save

Low priority; server-side save is the *only* capability wanted now. Designed so that Stage 1 (Node +
SQLite on the LAN) and Stage 2 (Lambda + DynamoDB) share every line except a storage adapter.

## Honest purpose
1. **Backup** against iOS storage eviction. 2. **Cross-device** (iPad ↔ desktop). 3. *Not* anti-cheat:
the client computes the economy, so any save is forgeable. Leaderboards, if ever, need server-side
simulation or need to not matter.

## Shape
A save is an **opaque blob**; the server never parses it (API stable across `SAVE_VERSION` bumps).

```
POST /v1/session          -> { playerId, token }              anonymous device identity
GET  /v1/save             -> { version, updatedAt, schemaVersion, progress, blob } | 404
PUT  /v1/save  <- { baseVersion, schemaVersion, progress, blob }
               -> 200 { version } | 409 { version, updatedAt, progress, blob }
GET  /v1/save/history     -> last N versions (accidental-prestige insurance)
```

`version` is a server-owned monotonic integer. A stale `baseVersion` gets **409 with the server's
current state**, never a silent overwrite.

## Conflict rule
`lifetimeShuffles` is monotonic through every reset. So: **the save with the greater `progress`
(lifetimeShuffles as a decimal string) is the further-along one; keep it.** The client sends it beside
the blob so the server can compare without parsing. Ties are the same run; adopt the server copy.

## Stack
- **Hono** app in `server/`, handlers depend on a `SaveStore` interface only.
- Stage 1: `SqliteSaveStore` (`node:sqlite` on Node 22/24, or `better-sqlite3`), file `server/data/saves.db`,
  served by `@hono/node-server` on port 3001 (Vite proxies `/api` → 3001 so the iPad hits one origin).
- Stage 2: `DynamoSaveStore` — partition key `playerId`, `version` as a conditional-write guard
  (`ConditionExpression: version = :base`) gives 409 semantics natively. `hono/aws-lambda` handler.
- Identity: anonymous `playerId` + bearer token minted by `POST /v1/session`, stored client-side.
  Real auth (Apple/Google/email) is a later, separate decision; the schema leaves a `userId` column.

```sql
CREATE TABLE saves (
  player_id TEXT PRIMARY KEY, version INTEGER NOT NULL, schema_version INTEGER NOT NULL,
  progress TEXT NOT NULL, blob TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE save_history (player_id TEXT, version INTEGER, blob TEXT, updated_at INTEGER,
  PRIMARY KEY (player_id, version));
```

## Client
`platform/storage.ts` already tiers IndexedDB + localStorage; cloud is a third tier behind the same
interface, syncing on `visibilitychange` and the autosave timer with backoff, **never blocking play**.
A failed sync is invisible; local is truth.
