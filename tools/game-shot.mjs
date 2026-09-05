// Switch to a game and screenshot it dealt. Usage: node tools/game-shot.mjs tripeaks [out.png]
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const game = process.argv[2] ?? 'tripeaks';
const out = process.argv[3] ?? `tools/out/${game}.png`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate((g) => { window.__game.switchGame(g); window.__table.skipChoreography(); }, game);
await page.waitForTimeout(900);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
