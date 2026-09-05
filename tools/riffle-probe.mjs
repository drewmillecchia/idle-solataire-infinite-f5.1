// The Idle Riffle toy: hold the deck, cards move and a trickle accrues; release and they square up.
import { chromium } from 'playwright-core';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
const step = (m) => console.log(`  · ${m}`);
await page.goto(process.argv[2] ?? 'http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.table);
await page.evaluate(() => { const g = window.__game; window.__table.skipChoreography(); for (let i = 0; i < 12; i++) { g.state.cards[i].awake = true; g.state.cards[i].charge = 4; } g.markSlow(); g.pushView(); });
await page.waitForTimeout(300);
const box = await page.locator('canvas').boundingBox();
const p = await page.evaluate(() => window.__table.targetPoint('stock'));
const before = await page.evaluate(() => ({ sh: window.__game.state.shuffles.toString(), stock: window.__game.board.stock.length }));
await page.mouse.move(box.x + p.x, box.y + p.y);
await page.mouse.down();
await page.waitForTimeout(1600); // past longPressMs, into the loop
const during = await page.evaluate(() => ({ riffling: !!window.__table.idle, spread: (() => { const t = window.__table; const xs = [...t.sprites.values()].filter((s) => s.pile === 'stock').map((s) => s.pos.x.target); return Math.max(...xs) - Math.min(...xs); })(), sh: window.__game.state.shuffles.toString() }));
step(`holding: riffling=${during.riffling} packet spread=${during.spread.toFixed(0)}px shuffles ${before.sh} -> ${during.sh}`);
await page.mouse.up();
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ riffling: !!window.__table.idle, stock: window.__game.board.stock.length, spread: (() => { const t = window.__table; const xs = [...t.sprites.values()].filter((s) => s.pile === 'stock').map((s) => s.pos.x.target); return Math.max(...xs) - Math.min(...xs); })() }));
step(`released: riffling=${after.riffling} spread=${after.spread.toFixed(1)}px stock=${after.stock}`);
if (!during.riffling) fail('holding the deck did not start a riffle');
if (during.spread < 20) fail('cards did not split into packets');
if (Number(during.sh) <= Number(before.sh)) fail('no trickle while riffling');
if (after.riffling) fail('riffle did not stop on release');
if (after.spread > 2) fail('cards did not square up after release');
if (after.stock !== before.stock) fail('the hold drew a card instead of riffling');
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'RIFFLE: FAILED' : 'RIFFLE: OK');
