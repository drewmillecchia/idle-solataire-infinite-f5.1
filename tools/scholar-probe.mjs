// Way of the Scholar: a new hand must come from the solver worker and be provably winnable.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table && window.__solver);
await page.evaluate(() => { const g = window.__game; g.state.run.way = 'scholar'; if (!g.state.prestige.waysUnlocked.includes('scholar')) g.state.prestige.waysUnlocked.push('scholar'); g.markSlow(); g.newHand(); });
await page.waitForFunction(() => window.__game.view.scholarThinking, null, { timeout: 3000 }).catch(() => {});
const thinking = await page.evaluate(() => window.__game.view.scholarThinking);
await page.waitForFunction(() => !window.__game.view.scholarThinking, null, { timeout: 15000 });
const r = await page.evaluate(() => {
  const g = window.__game;
  const m = window.__solver;
  return { seed: g.seed, winnable: m.isWinnable(g.seed, g.state.gameConfig.klondike ?? {}, { budgetNodes: 200000 }), thinkingSeen: true };
});
console.log(`  · thinking flag seen: ${thinking}; dealt seed ${r.seed}; solver says winnable=${r.winnable}`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (r.winnable !== true) { console.error('SCHOLAR: FAILED'); process.exit(1); }
console.log('SCHOLAR: OK');
