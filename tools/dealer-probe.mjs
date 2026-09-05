// Unlock the Auto-Dealer, shorten its patience, and confirm it telegraphs then moves.
import { chromium } from 'playwright-core';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
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
// Night Watch: the dealer stops waiting for you to look away (a courtesy pause, not zero).
await page.evaluate(() => { const g = window.__game; g.state.prestige.constellation['night-watch'] = 1; g.state.settings.autoDealerDelaySeconds = 30; g.markSlow(); g.pushView(); });
await page.evaluate(() => window.__game.activity());
await page.waitForTimeout(600);
const waiting = await page.evaluate(() => ({ active: window.__game.view.dealerActive, countdown: Math.round(window.__game.view.dealerCountdown * 10) / 10 }));
await page.waitForTimeout(2600);
const nightWatch = await page.evaluate(() => ({ active: window.__game.view.dealerActive, moves: window.__game.handMoves, alwaysOn: window.__game.derived.autoDealerAlwaysOn }));
console.log(JSON.stringify({ before, hint, after, waiting, nightWatch }));
if (!nightWatch.alwaysOn) { console.error('night watch flag not derived'); process.exit(1); }
if (waiting.countdown > 1.6) { console.error(`night watch did not shorten the wait (countdown ${waiting.countdown}s of a 30s setting)`); process.exit(1); }
if (!nightWatch.active) { console.error('night watch dealer never became active'); process.exit(1); }
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (!before.unlocked) { console.error('dealer not unlocked'); process.exit(1); }
if (after.moves <= before.moves) { console.error('dealer made no moves'); process.exit(1); }
console.log('DEALER: OK');
