// Screenshot a rail tab. Usage: node tools/panel-shot.mjs Deck [out.png]
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const tab = process.argv[2] ?? 'Deck';
const out = process.argv[3] ?? `tools/out/panel-${tab.toLowerCase()}.png`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { const g = window.__game; window.__table.skipChoreography(); for (let i = 0; i < 52; i += 3) { g.state.cards[i].awake = true; g.state.cards[i].charge = (i % 7); } g.markSlow(); g.pushView(); });
await page.locator('.tabs button', { hasText: tab }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
