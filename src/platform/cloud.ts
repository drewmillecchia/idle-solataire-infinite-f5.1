/**
 * Cloud tier (ADR-012 / docs/07-backend.md). A third tier behind the same shape as `storage.ts`'s
 * local tiers — the orchestrator wires this into the sync loop; this module never blocks play and
 * never throws. A failed sync is invisible; local is truth.
 */
import { cmpProgress } from './storage';

const SESSION_KEY = 'isi.cloud.session';
const VERSION_KEY = 'isi.cloud.version';
const TIMEOUT_MS = 8000;

export interface CloudSave {
  version: number;
  updatedAt: number;
  schemaVersion: number;
  progress: string;
  blob: string;
}

export interface CloudClient {
  enabled: boolean;
  pull(): Promise<CloudSave | null>;
  push(local: {
    blob: string;
    progress: string;
    schemaVersion: number;
  }): Promise<{ ok: true; version: number } | { ok: false; conflict: CloudSave } | { ok: false; error: string }>;
}

interface Session {
  playerId: string;
  token: string;
}

function readSession(storage: Storage): Session | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.playerId === 'string' && typeof parsed.token === 'string') {
      return { playerId: parsed.playerId, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSession(storage: Storage, session: Session): void {
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore — a failed sync is invisible, local is truth */
  }
}

function readVersion(storage: Storage): number {
  try {
    const raw = storage.getItem(VERSION_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeVersion(storage: Storage, version: number): void {
  try {
    storage.setItem(VERSION_KEY, String(version));
  } catch {
    /* ignore */
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** docs/07's conflict rule: the save with the greater `progress` (lifetimeShuffles as a decimal
 * string) is the further-along one and wins; a tie is the same run, so adopt the server copy. */
export function resolveConflict(
  localProgress: string,
  server: CloudSave,
  cmp: (a: string, b: string) => number = cmpProgress
): 'push' | 'adopt' {
  return cmp(localProgress, server.progress) > 0 ? 'push' : 'adopt';
}

export function createCloudClient(opts: { baseUrl?: string; storage?: Storage } = {}): CloudClient {
  const baseUrl = opts.baseUrl ?? '/api';
  const maybeStorage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);

  if (!maybeStorage) {
    // No usable storage (e.g. SSR, or storage disabled) — cloud tier is inert.
    return {
      enabled: false,
      async pull() {
        return null;
      },
      async push() {
        return { ok: false, error: 'no storage available' };
      }
    };
  }

  // Narrowed to a plain local so closures below don't widen back to `Storage | undefined`.
  const storage: Storage = maybeStorage;

  let sessionPromise: Promise<Session | null> | null = null;

  async function mintSession(): Promise<Session | null> {
    try {
      const res = await withTimeout((signal) =>
        fetch(`${baseUrl}/v1/session`, { method: 'POST', signal })
      );
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<Session>;
      if (typeof body.playerId !== 'string' || typeof body.token !== 'string') return null;
      const session: Session = { playerId: body.playerId, token: body.token };
      writeSession(storage, session);
      return session;
    } catch {
      return null;
    }
  }

  async function getSession(): Promise<Session | null> {
    const existing = readSession(storage);
    if (existing) return existing;
    if (!sessionPromise) sessionPromise = mintSession();
    const minted = await sessionPromise;
    sessionPromise = null;
    return minted;
  }

  return {
    enabled: true,

    async pull(): Promise<CloudSave | null> {
      try {
        const session = await getSession();
        if (!session) return null;
        const res = await withTimeout((signal) =>
          fetch(`${baseUrl}/v1/save`, {
            headers: { authorization: `Bearer ${session.token}` },
            signal
          })
        );
        if (res.status === 404) return null;
        if (!res.ok) return null;
        const save = (await res.json()) as CloudSave;
        writeVersion(storage, save.version);
        return save;
      } catch {
        return null;
      }
    },

    async push(local) {
      try {
        const session = await getSession();
        if (!session) return { ok: false, error: 'no session' };
        const baseVersion = readVersion(storage);

        const res = await withTimeout((signal) =>
          fetch(`${baseUrl}/v1/save`, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${session.token}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              baseVersion,
              schemaVersion: local.schemaVersion,
              progress: local.progress,
              blob: local.blob
            }),
            signal
          })
        );

        if (res.status === 409) {
          const conflict = (await res.json()) as CloudSave;
          writeVersion(storage, conflict.version);
          return { ok: false, conflict };
        }

        if (!res.ok) {
          return { ok: false, error: `push failed with status ${res.status}` };
        }

        const body = (await res.json()) as { version: number };
        writeVersion(storage, body.version);
        return { ok: true, version: body.version };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
      }
    }
  };
}
