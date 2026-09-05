// Armed tap-to-select: a king at the bottom of a column has no auto-target but legal empty columns; tap it, then tap a target.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => {
  window.__table.skipChoreography();
  // K♠ (12) alone at the bottom of t0; t1 empty; rest empty; stock has a few cards.
  const board = { stock: [20, 21, 22], waste: [], foundations: [[], [], [], []], tableau: Array.from({ length: 7 }, (_, i) => ({ down: [], up: i === 0 ? [12] : [] })), drawCount: 1, redealsLeft: -1, moves: 0, glass: [] };
  window.__game.setBoardForTesting(board);
});
await page.waitForTimeout(300);
const auto = await page.evaluate(() => ({ auto: window.__game.module.autoTarget(window.__game.board, 't0', 0, window.__game.twists()), targets: window.__game.legalTargets('t0', 0) }));
console.log(`  · autoTarget=${auto.auto} legalTargets=${auto.targets}`);
const box = await page.locator('canvas').boundingBox();
const p0 = await page.evaluate(() => window.__table.cardPoint('t0', 0));
await page.mouse.click(box.x + p0.x, box.y + p0.y);
await page.waitForTimeout(300);
const armed = await page.evaluate(() => window.__table.armed ? { pile: window.__table.armed.pile, targets: window.__table.armed.targets } : null);
console.log(`  · armed=${JSON.stringify(armed)}`);
await page.screenshot({ path: 'tools/out/armed.png' });
const p1 = await page.evaluate(() => window.__table.targetPoint('t3', 'slot'));
await page.mouse.click(box.x + p1.x, box.y + p1.y);
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ t0: window.__game.board.tableau[0].up.length, t3: window.__game.board.tableau[3].up.length, armed: !!window.__table.armed }));
console.log(`  · after second tap: ${JSON.stringify(after)}`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (!armed || after.t3 !== 1 || after.armed) { console.error('ARM: FAILED'); process.exit(1); }
console.log('ARM: OK');
