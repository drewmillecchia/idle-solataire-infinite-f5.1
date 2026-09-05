// Build, serve preview on 5200, run gestures, tear down.
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const API_PORT = '3002'; // a throwaway save server, separate from the dev one on 3001
execSync('npx vite build', { stdio: 'inherit' });
const server = spawn('node_modules/.bin/vite', ['preview', '--port', '5200', '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', env: { ...process.env, ISI_API_PORT: API_PORT } });
// The save server too, so the cloud probe runs through the preview proxy. Uses a throwaway database.
const api = spawn('node_modules/.bin/tsx', ['src/node.ts'], { stdio: 'ignore', cwd: 'server', env: { ...process.env, ISI_DB: 'data/test-saves.db', PORT: API_PORT } });
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(250);
    try { const r = await fetch('http://127.0.0.1:5200/'); up = r.ok; } catch { /* retry */ }
  }
  if (!up) throw new Error('preview did not start');
  execSync('node tools/gestures.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
  execSync('node tools/cut-flow.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
  execSync('node tools/marks-flow.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
  execSync('node tools/reshuffle-flow.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
  execSync('node tools/cloud-probe.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
} finally {
  server.kill();
  api.kill();
}
