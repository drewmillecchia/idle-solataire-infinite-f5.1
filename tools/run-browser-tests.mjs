// Build, serve preview on 5200, run gestures, tear down.
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

execSync('npx vite build', { stdio: 'inherit' });
const server = spawn('npx', ['vite', 'preview', '--port', '5200', '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(250);
    try { const r = await fetch('http://127.0.0.1:5200/'); up = r.ok; } catch { /* retry */ }
  }
  if (!up) throw new Error('preview did not start');
  execSync('node tools/gestures.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
  execSync('node tools/cut-flow.mjs http://127.0.0.1:5200/?test=1', { stdio: 'inherit' });
} finally {
  server.kill();
}
