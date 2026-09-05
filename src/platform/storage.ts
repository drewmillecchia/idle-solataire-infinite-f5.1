/**
 * Tiered local persistence: IndexedDB + localStorage mirror (ADR-009). Loading prefers the copy whose
 * `progress` (lifetimeShuffles decimal string) is greater; ties → IDB. Never throws to callers.
 */
const DB_NAME = 'isi';
const STORE = 'saves';
const KEY = 'main';
const LS_KEY = 'isi.save.v1';

export interface StoredSave {
  json: string;
  progress: string; // decimal string of lifetimeShuffles
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(): Promise<StoredSave | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredSave | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(save: StoredSave): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(save, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function lsGet(): StoredSave | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as StoredSave) : null;
  } catch {
    return null;
  }
}
function lsPut(save: StoredSave): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Compare two decimal strings that may be in scientific notation. Positive if a > b. */
function cmpProgress(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na > nb ? 1 : -1;
  // Fall back to exponent parsing for astronomically large values.
  const ea = /e([+-]?\d+)/i.exec(a)?.[1], eb = /e([+-]?\d+)/i.exec(b)?.[1];
  if (ea && eb) return Number(ea) - Number(eb);
  return a.length - b.length;
}

export async function loadSave(): Promise<StoredSave | null> {
  const [a, b] = await Promise.all([idbGet(), Promise.resolve(lsGet())]);
  if (a && b) return cmpProgress(b.progress, a.progress) > 0 ? b : a;
  return a ?? b;
}

export async function persistSave(save: StoredSave): Promise<{ idb: boolean; ls: boolean }> {
  const [idb, ls] = await Promise.all([idbPut(save), Promise.resolve(lsPut(save))]);
  return { idb, ls };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function clearSaves(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
