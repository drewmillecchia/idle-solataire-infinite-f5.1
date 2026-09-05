// Screenshot the riffle choreography mid-flight, then mid-deal.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.waitForTimeout(500);
await page.getByText('New hand').click();
await page.waitForTimeout(650);
await page.screenshot({ path: 'tools/out/riffle-mid.png' });
await page.waitForTimeout(900);
await page.screenshot({ path: 'tools/out/riffle-late.png' });
await browser.close();
console.log('ok');
