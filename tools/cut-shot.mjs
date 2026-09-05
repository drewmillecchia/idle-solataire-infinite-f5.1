// Run the Cut the Deck ceremony and screenshot it mid-way.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { window.__table.skipChoreography(); window.__cutDone = false; window.__table.cutCeremony(() => { window.__cutDone = true; }); });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/out/cut-1.png' });
await page.waitForTimeout(1800);
await page.screenshot({ path: 'tools/out/cut-2.png' });
await page.waitForFunction(() => window.__cutDone, null, { timeout: 8000 });
console.log('cut ceremony completed');
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
