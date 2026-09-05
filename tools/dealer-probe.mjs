// Unlock the Auto-Dealer, shorten its patience, and confirm it telegraphs then moves.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => {
  const g = window.__game;
  const id = (window.__upgrades ?? []).find?.((u) => u.effect.kind === 'autoDealer')?.id;
  g.state.run.upgrades[id ?? 'the-dealer'] = 1;
  g.state.settings.autoDealerDelaySeconds = 1;
  g.markSlow(); g.pushView();
  window.__table.skipChoreography();
});
const before = await page.evaluate(() => ({ moves: window.__game.handMoves, unlocked: window.__game.derived.autoDealerUnlocked }));
await page.waitForTimeout(1600);
const hint = await page.evaluate(() => ({ hinted: window.__table.hinted.length, target: window.__table.hintTarget, pending: !!window.__game.dealerPending }));
await page.screenshot({ path: 'tools/out/dealer-hint.png' });
await page.waitForTimeout(3500);
const after = await page.evaluate(() => ({ moves: window.__game.handMoves, active: window.__game.view.dealerActive }));
console.log(JSON.stringify({ before, hint, after }));
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (!before.unlocked) { console.error('dealer not unlocked'); process.exit(1); }
if (after.moves <= before.moves) { console.error('dealer made no moves'); process.exit(1); }
console.log('DEALER: OK');
