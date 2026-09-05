/**
 * iPad readiness: production build, iPad-landscape viewport, REAL touch events (the gesture suite
 * uses mouse events, which take a different path through Pixi's EventSystem).
 * Usage: node tools/ipad-probe.mjs [url]
 */
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://127.0.0.1:5200/?test=1';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;

const errors = [];
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
const step = (m) => console.log(`  · ${m}`);

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__table && window.__game.table, null, { timeout: 20000 });
await page.waitForTimeout(1200);

// 1. The boot placeholder must be gone (no permanent overlay swallowing touches).
const boot = await page.evaluate(() => !!document.getElementById('boot'));
if (boot) fail('boot placeholder still in the DOM'); else step('boot placeholder cleared');

// 2. Service worker + manifest (only meaningful on the preview build).
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? 'registered' : 'none';
});
const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null);
step(`service worker: ${sw}; manifest: ${manifest ?? 'missing'}`);
if (!manifest) fail('no manifest link');

// 3. The page must not scroll: a table is not a document.
const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
if (scrollable) fail('document scrolls vertically'); else step('no page scroll');

const box = await page.locator('canvas').boundingBox();
const client = await context.newCDPSession(page);
const touch = async (type, x, y) => client.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }]
});
const at = async (pile, index) => {
  const p = await page.evaluate(
    ({ pile, index }) => (index === undefined ? window.__table.targetPoint(pile) : window.__table.cardPoint(pile, index)),
    { pile, index }
  );
  if (!p) throw new Error(`no point for ${pile}`);
  return { x: box.x + p.x, y: box.y + p.y };
};
const hash = () => page.evaluate(() => window.__game.module.hash(window.__game.board));

// 4. A touch tap on the stock draws.
{
  const before = await page.evaluate(() => window.__game.board.stock.length);
  const p = await at('stock');
  await touch('touchStart', p.x, p.y);
  await page.waitForTimeout(60);
  await touch('touchEnd', p.x, p.y);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__game.board.stock.length);
  if (after >= before) fail(`touch tap did not draw (${before} -> ${after})`); else step(`touch tap draws: ${before} -> ${after}`);
}

// 5. A touch DRAG makes a legal move.
{
  const mv = await page.evaluate(() => {
    const g = window.__game;
    const t = g.twists();
    const v = g.module.view(g.board);
    for (const p of v.piles) {
      if (!p.id.startsWith('t') || p.pickableFrom === undefined) continue;
      for (let i = p.pickableFrom; i < p.cards.length; i++) {
        const targets = g.module.legalTargets(g.board, p.id, i, t).filter((x) => x !== p.id);
        if (targets.length) return { pile: p.id, index: i, to: targets[0] };
      }
    }
    return null;
  });
  if (!mv) step('no drag candidate on this deal; skipped');
  else {
    const from = await at(mv.pile, mv.index);
    const to = await at(mv.to);
    const before = await hash();
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', to.x, to.y);
    await page.waitForTimeout(500);
    if ((await hash()) === before) fail(`touch drag ${mv.pile}[${mv.index}] -> ${mv.to} did nothing`);
    else step(`touch drag ${mv.pile}[${mv.index}] -> ${mv.to} registered`);
  }
}

// 6. A cancelled touch must not strand the drag (the iPadOS system-gesture case).
{
  const p = await at('stock');
  await touch('touchStart', p.x, p.y);
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(3400); // past the drag watchdog
  const stuck = await page.evaluate(() => !!window.__table.drag);
  if (stuck) fail('a cancelled touch left the drag stuck'); else step('cancelled touch recovers');
  // and the table still responds
  const before = await page.evaluate(() => window.__game.board.stock.length);
  await touch('touchStart', p.x, p.y);
  await page.waitForTimeout(50);
  await touch('touchEnd', p.x, p.y);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__game.board.stock.length);
  if (after === before) fail('table unresponsive after a cancelled touch'); else step('table still responsive');
}

// 7. Cost of our own work per frame. The headless FPS number is bounded by SwiftShader's pixel fill
// (4-5 fps at 2x density vs 15 at 1x) and says nothing about a real GPU, so measure CPU cost instead.
{
  await page.evaluate(() => window.__game.newHand());
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => {
    const T = window.__table, G = window.__game;
    const view = G.module.view(G.board);
    let t0 = performance.now(); for (let i = 0; i < 20; i++) T.setBoard(view); const setBoard = (performance.now() - t0) / 20;
    t0 = performance.now(); for (let i = 0; i < 20; i++) T.app.renderer.render(T.app.stage); const render = (performance.now() - t0) / 20;
    return { setBoard, render, fps: T.app.ticker.FPS };
  });
  step(`cpu per board push ${t.setBoard.toFixed(2)} ms, per render ${t.render.toFixed(2)} ms (headless fps ${t.fps.toFixed(1)} is software fill, ignore)`);
  if (t.setBoard > 4) fail(`board push costs ${t.setBoard.toFixed(1)} ms — something is redrawing that should not be`);
}

await page.screenshot({ path: 'tools/out/ipad.png' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'IPAD: FAILED' : 'IPAD: OK');
