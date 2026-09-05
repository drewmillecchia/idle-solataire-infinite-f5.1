import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './sqliteStore.ts';

const PORT = Number(process.env.PORT ?? 3001);
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ISI_DB ? join(here, '..', process.env.ISI_DB) : join(here, '..', 'data', 'saves.db');

mkdirSync(dirname(dbPath), { recursive: true });

const store = new SqliteStore(dbPath);
const app = createApp(store);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`isi-server listening on http://127.0.0.1:${info.port} (db: ${dbPath})`);
});
