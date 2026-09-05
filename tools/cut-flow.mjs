// Prestige flow at the seam: make a cut reachable, open the Cut panel, cut via the button, assert engine state.
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://127.0.0.1:3000/';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { window.__table.skipChoreography(); });
// Before: no Cut tab.
const tabsBefore = await page.locator('.tabs button').allTextContents();
if (tabsBefore.some((t) => /cut/i.test(t))) fail('Cut tab visible before reveal');
// Make a cut reachable: wake a few cards, then pretend this run earned a lot.
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) { g.state.cards[i].awake = true; g.state.cards[i].charge = 3; }
  g.state.lifetimeShuffles = g.state.lifetimeShuffles.plus(4e7);
  g.state.shuffles = g.state.shuffles.plus(4e7);
  g.state.run.earnedAtStart = g.state.lifetimeShuffles.minus(4e7);
});
await page.waitForTimeout(700); // a few ticks: checkCutReveal fires
const v = await page.evaluate(() => window.__game.view.cut);
if (!v.revealed) fail(`cut not revealed: ${JSON.stringify(v)}`);
if (!v.canCut) fail(`cut not available: ${JSON.stringify(v)}`);
console.log(`  · cut reachable: on cut ${v.cutsOnCut}, run ${v.runEarned}, threshold ${v.threshold}`);
await page.locator('.tabs button', { hasText: 'Cut' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/out/cut-panel.png' });
await page.locator('.way', { hasText: 'Dealer' }).click();
const before = await page.evaluate(() => ({ life: window.__game.state.lifetimeShuffles.toString(), awake: window.__game.derived.awakeCount }));
await page.locator('button.go').click();
await page.waitForFunction(() => window.__game.state.prestige.cutsPerformed > 0, null, { timeout: 15000 });
await page.waitForTimeout(600);
const after = await page.evaluate(() => { const g = window.__game; return { cuts: g.state.prestige.lifetimeCuts.toString(), performed: g.state.prestige.cutsPerformed, way: g.state.run.way, awake: g.derived.awakeCount, shuffles: g.state.shuffles.toString(), life: g.state.lifetimeShuffles.toString(), upgrades: Object.keys(g.state.run.upgrades).length, tabs: [...document.querySelectorAll('.tabs button')].map((b) => b.textContent) }; });
console.log(`  · after cut: ${JSON.stringify(after)}`);
if (after.performed !== 1) fail('cut not performed');
if (Number(after.cuts) < 1) fail('no cuts earned');
if (after.way !== 'dealer') fail('way not applied');
if (after.awake !== 0) fail(`cards did not re-sleep (awake ${after.awake})`);
if (Number(after.life) < Number(before.life)) fail('lifetime decreased');
if (!after.tabs.some((t) => /cut/i.test(t))) fail('Cut tab hidden after cut (nothing revealed is re-hidden)');
// Buy a Constellation node.
await page.locator('.tabs button', { hasText: 'Stars' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/out/stars-panel.png' });
const bought = await page.evaluate(() => { const g = window.__game; const n = g.view.constellation.find((x) => x.affordable); if (!n) return null; g.buyNode(n.id); return { id: n.id, level: g.state.prestige.constellation[n.id], cuts: g.state.prestige.cuts.toString() }; });
if (!bought) fail('no affordable node after a cut'); else console.log(`  · bought ${bought.id} → level ${bought.level}, cuts left ${bought.cuts}`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'CUT FLOW: FAILED' : 'CUT FLOW: OK');
