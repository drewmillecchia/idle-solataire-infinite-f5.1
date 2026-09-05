// Enable cloud save in the running app and confirm a push lands on the server via the Vite proxy.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { window.__table.skipChoreography(); window.__game.state.lifetimeShuffles = window.__game.state.lifetimeShuffles.plus(1234); window.__game.setCloud(true); });
await page.waitForFunction(() => /synced/.test(window.__game.view.cloud.status), null, { timeout: 10000 }).catch(() => {});
const status = await page.evaluate(() => window.__game.view.cloud.status);
const server = await page.evaluate(async () => { const s = JSON.parse(localStorage.getItem('isi.cloud.session')); const r = await fetch('/api/v1/save', { headers: { authorization: `Bearer ${s.token}` } }); return r.ok ? await r.json() : { status: r.status }; });
console.log(`  · status: ${status}`);
console.log(`  · server: version ${server.version}, progress ${server.progress}, blob ${server.blob?.length} chars`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (!/synced/.test(status) || Number(server.progress) < 1234) { console.error('CLOUD: FAILED'); process.exit(1); }
console.log('CLOUD: OK');
