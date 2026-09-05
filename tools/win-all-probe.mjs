/**
 * Every game must pay a burst AND run a celebration when it is won — not only the ones with
 * foundations. Plays each game through the HOST (the same path a player takes) with the greedy
 * driver, dealing again when a deal goes nowhere.
 */
import { chromium } from 'playwright-core';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
await page.goto(process.argv[2] ?? 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table && window.__autoplay);
await page.evaluate(() => {
  const g = window.__game;
  window.__table.skipChoreography();
  g.dismissFirstRun();
  g.dealerEnabled = false; // the probe drives the board, not the dealer
  for (let i = 0; i < 52; i++) { g.state.cards[i].awake = true; g.state.cards[i].charge = 2; }
  g.markSlow(); g.pushView();
});

/**
 * Golf (~0.5 %) and FreeCell (0/30) are far beyond a no-lookahead greedy driver, so those two get a
 * board one legal move from won. The move itself still goes through the host, which is the point.
 */
const NEARLY_WON = {
  golf: () => {
    // One card left in a column, one rank below the waste top. 5C (id 43) onto 6C (id 44).
    const columns = Array.from({ length: 7 }, () => []);
    columns[0] = [43];
    return { columns, stock: [], waste: [44], wrap: false, moves: 0 };
  },
  freecell: () => {
    // Every foundation to the queen; the four kings sit in the free cells.
    const f = (suit) => Array.from({ length: 12 }, (_, i) => suit * 13 + i);
    return {
      cells: [12, 25, 38, 51],
      foundations: [f(0), f(1), f(2), f(3)],
      tableau: Array.from({ length: 8 }, () => []),
      moves: 0
    };
  }
};

for (const game of ['klondike', 'tripeaks', 'golf', 'pyramid', 'freecell']) {
  const r = await page.evaluate(async ({ game, nearly }) => {
    const g = window.__game;
    const { nextMove } = window.__autoplay;
    g.switchGame(game);
    window.__table.skipChoreography();
    const winsBefore = g.state.stats.totalWins;
    let celebrated = 0;
    let deals = 0;
    if (nearly) {
      g.setBoardForTesting(nearly);
      // Play every remaining move through the host, exactly as a player would.
      for (let step = 0; step < 200 && !g.module.isWon(g.board); step++) {
        const mv = nextMove(g.module, g.board, g.twists(), new Set());
        if (!mv) break;
        if (mv.kind === 'draw') g.tap('stock', 0);
        else g.tryMove(mv.pile, mv.index, mv.to);
        if (window.__table.celebration) celebrated = window.__table.celebration.sprites.length || 1;
      }
    }
    for (; !nearly && deals < 60 && g.state.stats.totalWins === winsBefore; deals++) {
      const seen = new Set();
      for (let step = 0; step < 4000; step++) {
        if (g.module.isWon(g.board)) break;
        const mv = nextMove(g.module, g.board, g.twists(), seen);
        if (!mv) break;
        seen.add(g.module.hash(g.board));
        if (mv.kind === 'draw') g.tap('stock', 0);
        else g.tryMove(mv.pile, mv.index, mv.to);
        if (window.__table.celebration) celebrated = window.__table.celebration.sprites.length || 1;
      }
      if (g.state.stats.totalWins > winsBefore) break;
      g.newHand(true);
      window.__table.skipChoreography();
    }
    // celebrate() stages its sprites over the first frames, so give it one.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (window.__table.celebration) celebrated = Math.max(celebrated, window.__table.celebration.sprites.length || 1);
    return {
      won: g.state.stats.totalWins > winsBefore,
      deals,
      banner: !!g.view.wonBanner,
      celebration: window.__table.celebration !== null,
      celebrated,
      perGameWins: g.state.stats.perGame[game]?.wins ?? 0
    };
  }, { game, nearly: NEARLY_WON[game] ? NEARLY_WON[game]() : null });
  const how = NEARLY_WON[game] ? 'from a near-won board' : `after ${r.deals} deal(s)`;
  console.log(`  · ${game}: won=${r.won} ${how}, banner=${r.banner}, celebration=${r.celebration}, record=${r.perGameWins}`);
  if (!r.won) { fail(`${game} never won`); continue; }
  if (!r.banner) fail(`${game} won without a banner`);
  if (!r.celebration) fail(`${game} won without a celebration`);
  if (r.perGameWins < 1) fail(`${game} win was not recorded`);
}
await page.screenshot({ path: 'tools/out/win-all.png' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'WIN ALL: FAILED' : 'WIN ALL: OK');
