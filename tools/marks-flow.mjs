// Marks at the seam: unlock slots, place Twin + Kindling via the host, home a card, watch the chain; Wild changes legal targets.
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://127.0.0.1:3000/';
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
const step = (m) => console.log(`  · ${m}`);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { window.__table.skipChoreography(); });
// Pretend we have cut enough for slots and unlocks.
await page.evaluate(() => { const g = window.__game; g.state.prestige.lifetimeCuts = g.state.prestige.lifetimeCuts.plus(6); g.state.prestige.constellation['first-mark'] = 2; g.markSlow(); g.pushView(); });
const m0 = await page.evaluate(() => window.__game.view.marks);
step(`slots ${m0.used}/${m0.slots}, available: ${m0.available.map((x) => x.id).join(',')}`);
if (m0.slots < 3) fail(`expected ≥3 slots, got ${m0.slots}`);
if (!m0.available.some((x) => x.id === 'twin')) fail('twin not available at 6 lifetime cuts');

// Twin on 5♠ (id 4) and 5♥ (id 17); Kindling on 5♠ too (Twin is the wire and may share a card).
const placed = await page.evaluate(() => {
  const g = window.__game;
  g.pickMark('twin'); g.tapDeckCard(4); g.tapDeckCard(17); g.placePickedMark();
  g.pickMark('kindling'); g.tapDeckCard(4); g.placePickedMark();
  return { placed: g.state.marks.placed, glyph4: g.glyphFor(g.state.cards[4].marks), glyph17: g.glyphFor(g.state.cards[17].marks) };
});
if (placed.placed.length !== 2) fail(`expected 2 placements, got ${JSON.stringify(placed.placed)}`);
step(`placed: ${placed.placed.map((p) => p.mark + '[' + p.cards + ']').join(' ')} glyphs ${placed.glyph4} ${placed.glyph17}`);
// Home 5♠ twice via the engine seam the host uses (homeCard through the bus): use a constructed board where 5♠ is playable to a foundation.
const chain = await page.evaluate(() => {
  const g = window.__game;
  const f = (s, n) => Array.from({ length: n }, (_, i) => s * 13 + i);
  // Spades foundation A..4 built; 5♠ (id 4) on the waste; tap it home.
  const board = { stock: [], waste: [4], foundations: [f(0, 4), [], [], []], tableau: Array.from({ length: 7 }, () => ({ down: [], up: [] })), drawCount: 1, redealsLeft: -1, moves: 0, glass: [], dealt: 52 };
  window.__game.setBoardForTesting(board);
  g.tap('waste', 0); // first home: 5♠ wakes; Twin wakes 5♥
  // Second home: put 5♠ back on the waste with the foundation at A..4 again (a fresh constructed board).
  const board2 = { stock: [], waste: [4], foundations: [f(0, 4), [], [], []], tableau: Array.from({ length: 7 }, () => ({ down: [], up: [] })), drawCount: 1, redealsLeft: -1, moves: 0, glass: [], dealt: 52 };
  window.__game.setBoardForTesting(board2);
  g.tap('waste', 0); // 5♠ +1 charge → Kindling charges 4♠/6♠ → Twin charges 5♥
  const c = (i) => ({ ...g.state.cards[i] });
  return { s5: c(4), s4: c(3), s6: c(5), h5: c(17) };
});
step(`after homing 5♠ twice: 5♠ ${JSON.stringify(chain.s5)} 4♠ ${JSON.stringify(chain.s4)} 6♠ ${JSON.stringify(chain.s6)} 5♥ ${JSON.stringify(chain.h5)}`);
if (!chain.s5.awake || chain.s5.charge < 1) fail('5♠ did not wake and charge');
if (!chain.h5.awake) fail('Twin did not wake 5♥');
if (chain.h5.charge < 1) fail('Twin did not pass the charge to 5♥');
if (chain.s4.charge < 1 || chain.s6.charge < 1) fail('Kindling did not charge the neighbours');
// Wild: place on 2♣ (id 40), verify a same-colour tableau placement becomes legal.
const wild = await page.evaluate(() => {
  const g = window.__game;
  g.pickMark('wild'); g.tapDeckCard(40); g.placePickedMark();
  const board = { stock: [], waste: [40], foundations: [[], [], [], []], tableau: Array.from({ length: 7 }, (_, i) => ({ down: [], up: i === 0 ? [41] : [] })), drawCount: 1, redealsLeft: -1, moves: 0, glass: [], dealt: 52 }; // 3♣ on t0: same colour
  g.setBoardForTesting(board);
  return g.legalTargets('waste', 0);
});
step(`wild 2♣ legal targets: ${wild.join(',')}`);
if (!wild.includes('t0')) fail('Wild did not allow a same-colour placement');
await page.locator('.tabs button', { hasText: 'Deck' }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: 'tools/out/marks-panel.png' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'MARKS FLOW: FAILED' : 'MARKS FLOW: OK');
