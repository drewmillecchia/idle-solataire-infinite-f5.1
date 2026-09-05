// Force a nearly-won Klondike board, play the last card, screenshot the celebration.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const f = (s) => Array.from({ length: 13 }, (_, i) => s * 13 + i);
  const board = { stock: [], waste: [51], foundations: [f(0), f(1), f(2), f(3).slice(0, 12)], tableau: Array.from({ length: 7 }, () => ({ down: [], up: [] })), drawCount: 1, redealsLeft: -1, moves: 0, glass: [] };
  window.__game.setBoardForTesting(board);
});
await page.waitForTimeout(400);
const before = await page.evaluate(() => ({ wins: window.__game.state.stats.totalWins, sh: window.__game.state.shuffles.toString() }));
const box = await page.locator('canvas').boundingBox();
const p = await page.evaluate(() => window.__table.targetPoint('waste'));
await page.mouse.click(box.x + p.x, box.y + p.y);
await page.waitForTimeout(700);
await page.screenshot({ path: 'tools/out/win-mid.png' });
const after = await page.evaluate(() => ({ wins: window.__game.state.stats.totalWins, sh: window.__game.state.shuffles.toString(), won: window.__game.view.won, banner: window.__game.view.wonBanner }));
console.log(JSON.stringify({ before, after }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tools/out/win-after.png' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (after.wins !== before.wins + 1) { console.error('win did not register'); process.exit(1); }
console.log('WIN: OK');
