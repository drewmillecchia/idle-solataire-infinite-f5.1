# isi-server — cloud save API

Stage 1 of `docs/07-backend.md`: a Hono app on Node, backed by `node:sqlite`. Handlers depend only on
the `SaveStore` interface (`src/store.ts`) — no SQL, no AWS SDK — so Stage 2 swaps in a DynamoDB
implementation (`src/lambda.ts` has the stub) without touching `app.ts`.

## Run

From the repo root, Node 22 must be active first:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
```

Then, one-time install:

```bash
cd server && npm install
```

Dev server (also runnable as `npm run server` from the repo root, which proxies through `vite.config.ts`'s `/api` rule):

```bash
npm --prefix server run dev
```

Listens on `http://127.0.0.1:3001`. The SQLite file lives at `server/data/saves.db` (gitignored,
created on first run). `node:sqlite` is experimental in Node 22/24 — expect one `ExperimentalWarning`
line at startup; this is expected and not an error.

Tests and type-check:

```bash
cd server
npx vitest run
npx tsc --noEmit
```

## API

All bodies and responses are JSON. `Authorization: Bearer <token>` is required on every `/v1/save*`
route; missing or invalid tokens get `401 { error }`.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/v1/health` | no | — | `200 { ok: true }` |
| POST | `/v1/session` | no | — | `200 { playerId, token }` — mints a new anonymous player |
| GET | `/v1/save` | yes | — | `200 { version, updatedAt, schemaVersion, progress, blob }` \| `404` |
| PUT | `/v1/save` | yes | `{ baseVersion, schemaVersion, progress, blob }` | `200 { version }` on a matching `baseVersion`; `409` with the server's current save otherwise; `413` if `blob` exceeds 256 KB |
| GET | `/v1/save/history` | yes | — | `200 [{ version, updatedAt, progress }]` — last 10, newest first, blob omitted |
| GET | `/v1/save/history/:version` | yes | — | `200 { blob }` \| `404` |

`version` is a server-owned monotonic integer per player, starting at 1. The blob is opaque — the
server never parses it; `progress` (the decimal `lifetimeShuffles` string) is the only field it
compares, per ADR-012 / the conflict rule in `docs/07-backend.md`.

## Swapping in DynamoDB (Stage 2)

1. Implement `SaveStore` (`src/store.ts`) against DynamoDB in place of the `DynamoStore` stub in
   `src/lambda.ts` — partition key `playerId`, `version` as a `ConditionExpression` guard for the
   409 semantics `sqliteStore.ts` gets from `BEGIN IMMEDIATE` / read-compare-write.
2. `src/lambda.ts` already wires `handle(createApp(store))` from `hono/aws-lambda` — no route or
   handler code changes.
3. `src/node.ts` (and this README's dev instructions) stop applying once Lambda is the deployed
   target; keep it around for local dev against SQLite either way.
