import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { SaveStore } from './store.ts';

const MAX_BLOB_BYTES = 256 * 1024;

interface Env {
  Variables: { playerId: string };
}

/** Builds the Hono app against a `SaveStore` — no SQL, no AWS SDK here (docs/07-backend.md). Same
 * factory runs on Node (`node.ts`, node:sqlite) and on Lambda (`lambda.ts`, DynamoDB later). */
export function createApp(store: SaveStore) {
  const app = new Hono<Env>();

  app.use('*', cors({ origin: '*' }));

  app.get('/v1/health', (c) => c.json({ ok: true }));

  app.post('/v1/session', async (c) => {
    const { playerId, token } = await store.createPlayer();
    return c.json({ playerId, token });
  });

  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization');
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return c.json({ error: 'missing bearer token' }, 401);
    const playerId = await store.getPlayerIdForToken(token);
    if (!playerId) return c.json({ error: 'invalid token' }, 401);
    c.set('playerId', playerId);
    await next();
  };

  app.use('/v1/save', auth);
  app.use('/v1/save/*', auth);

  app.get('/v1/save', async (c) => {
    const playerId = c.get('playerId');
    const record = await store.getSave(playerId);
    if (!record) return c.json({ error: 'not found' }, 404);
    return c.json(record);
  });

  app.put('/v1/save', async (c) => {
    const playerId = c.get('playerId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (!isPutBody(body)) {
      return c.json({ error: 'expected { baseVersion, schemaVersion, progress, blob }' }, 400);
    }

    const blobBytes = Buffer.byteLength(body.blob, 'utf8');
    if (blobBytes > MAX_BLOB_BYTES) {
      return c.json({ error: `blob exceeds ${MAX_BLOB_BYTES} bytes` }, 413);
    }

    const result = await store.putSave(playerId, {
      baseVersion: body.baseVersion,
      schemaVersion: body.schemaVersion,
      progress: body.progress,
      blob: body.blob
    });

    if (!result.ok) return c.json(result.current, 409);
    return c.json({ version: result.record.version });
  });

  app.get('/v1/save/history', async (c) => {
    const playerId = c.get('playerId');
    const history = await store.getHistory(playerId);
    return c.json(history);
  });

  app.get('/v1/save/history/:version', async (c) => {
    const playerId = c.get('playerId');
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version) || version < 1) {
      return c.json({ error: 'invalid version' }, 400);
    }
    const blob = await store.getHistoryBlob(playerId, version);
    if (blob === null) return c.json({ error: 'not found' }, 404);
    return c.json({ blob });
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  return app;
}

function isPutBody(
  body: unknown
): body is { baseVersion: number; schemaVersion: number; progress: string; blob: string } {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.baseVersion === 'number' &&
    Number.isInteger(b.baseVersion) &&
    typeof b.schemaVersion === 'number' &&
    Number.isInteger(b.schemaVersion) &&
    typeof b.progress === 'string' &&
    typeof b.blob === 'string'
  );
}
