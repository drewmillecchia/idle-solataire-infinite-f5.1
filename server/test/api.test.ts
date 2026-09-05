import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/memoryStore.ts';
import type { HistoryEntry, SaveRecord } from '../src/store.ts';

function makeApp() {
  return createApp(new MemoryStore());
}

async function mintSession(app: ReturnType<typeof makeApp>) {
  const res = await app.request('/v1/session', { method: 'POST' });
  expect(res.status).toBe(200);
  return (await res.json()) as { playerId: string; token: string };
}

describe('health', () => {
  it('reports ok', async () => {
    const app = makeApp();
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('session', () => {
  it('mints a playerId and token', async () => {
    const app = makeApp();
    const { playerId, token } = await mintSession(app);
    expect(typeof playerId).toBe('string');
    expect(playerId.length).toBeGreaterThan(0);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });
});

describe('auth', () => {
  it('401s GET /v1/save without a token', async () => {
    const app = makeApp();
    const res = await app.request('/v1/save');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('401s with an invalid token', async () => {
    const app = makeApp();
    const res = await app.request('/v1/save', { headers: { authorization: 'Bearer nonsense' } });
    expect(res.status).toBe(401);
  });
});

describe('save lifecycle', () => {
  it('404s before any save exists', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const res = await app.request('/v1/save', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });

  it('creates version 1 with baseVersion 0, then reads it back', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const putRes = await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '1000', blob: 'abc' })
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ version: 1 });

    const getRes = await app.request('/v1/save', { headers: { authorization: `Bearer ${token}` } });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as SaveRecord;
    expect(body.version).toBe(1);
    expect(body.schemaVersion).toBe(4);
    expect(body.progress).toBe('1000');
    expect(body.blob).toBe('abc');
    expect(typeof body.updatedAt).toBe('number');
  });

  it('409s on a stale baseVersion, returning the server current state', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '1000', blob: 'abc' })
    });

    const staleRes = await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '2000', blob: 'def' })
    });
    expect(staleRes.status).toBe(409);
    const conflict = (await staleRes.json()) as SaveRecord;
    expect(conflict.version).toBe(1);
    expect(conflict.progress).toBe('1000');
    expect(conflict.blob).toBe('abc');
  });

  it('accepts the correct baseVersion, advancing to version 2', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '1000', blob: 'abc' })
    });

    const res = await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 1, schemaVersion: 4, progress: '2000', blob: 'def' })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 2 });
  });
});

describe('history', () => {
  it('lists newest-first and serves a historical blob', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '1000', blob: 'v1-blob' })
    });
    await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 1, schemaVersion: 4, progress: '2000', blob: 'v2-blob' })
    });

    const historyRes = await app.request('/v1/save/history', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as HistoryEntry[];
    expect(history).toHaveLength(2);
    expect(history[0]?.version).toBe(2);
    expect(history[1]?.version).toBe(1);
    expect((history[0] as unknown as { blob?: string } | undefined)?.blob).toBeUndefined();

    const blobRes = await app.request('/v1/save/history/1', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(blobRes.status).toBe(200);
    expect(await blobRes.json()).toEqual({ blob: 'v1-blob' });
  });
});

describe('blob size limit', () => {
  it('rejects a blob over 256 KB with 413', async () => {
    const app = makeApp();
    const { token } = await mintSession(app);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const oversized = 'x'.repeat(256 * 1024 + 1);

    const res = await app.request('/v1/save', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ baseVersion: 0, schemaVersion: 4, progress: '1000', blob: oversized })
    });
    expect(res.status).toBe(413);
  });
});
