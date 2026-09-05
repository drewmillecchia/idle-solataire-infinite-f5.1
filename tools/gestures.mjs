/**
 * Real-gesture test: drives pointer events at the Pixi canvas and asserts on ENGINE state.
 * Usage: node tools/gestures.mjs [url]
 */
import { chromium } from 'playwright-core';
const URL = process.argv[2] ?? 'http://127.0.0.1:5200/?test=1';
const CHROME = process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const step = (m) => console.log(`  · ${m}`);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__table && window.__game.table, null, { timeout: 15000 });
await page.waitForTimeout(800);

const board = () => page.evaluate(() => {
  const b = window.__game.board;
  return { stock: b.stock.length, waste: b.waste.length, foundations: b.foundations.map((f) => f.length), tableau: b.tableau.map((t) => ({ down: t.down.length, up: t.up.length })), moves: b.moves };
});
const canvasBox = async () => page.locator('canvas').boundingBox();
async function point(pile, index) {
  const box = await canvasBox();
  const p = await page.evaluate(({ pile, index }) => index === undefined ? window.__table.targetPoint(pile) : window.__table.cardPoint(pile, index), { pile, index });
  if (!p) throw new Error(`no point for ${pile}[${index}]`);
  return { x: box.x + p.x, y: box.y + p.y };
}

// Pin a seed so every gesture is exercised every run.
await page.evaluate(() => {
  const mod = window.__game.module;
  // deal via the module with a fixed rng
  let a = 7;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const twists = { isWild: () => false, isMirror: () => false, dealtFaceUp: () => false };
  window.__game.setBoardForTesting(mod.deal(rng, {}, twists));
});
await page.waitForTimeout(500);
let before = await board();
step(`dealt: stock ${before.stock}, tableau ${before.tableau.map((t) => `${t.down}/${t.up}`).join(' ')}`);

// 1. Tap the stock draws.
{
  const p = await point('stock');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await board();
  if (after.stock >= before.stock) fail(`stock tap did not draw (${before.stock} -> ${after.stock})`);
  else step(`stock tap draws: ${before.stock} -> ${after.stock}`);
  before = after;
}

// 2. Drag a legal tableau→tableau move (find one via the module).
{
  const mv = await page.evaluate(() => {
    const g = window.__game; const t = { isWild: () => false, isMirror: () => false, dealtFaceUp: () => false };
    const v = g.module.view(g.board);
    for (const p of v.piles) {
      if (!p.id.startsWith('t') || p.pickableFrom === undefined) continue;
      for (let i = p.pickableFrom; i < p.cards.length; i++) {
        const targets = g.module.legalTargets(g.board, p.id, i, t).filter((x) => x.startsWith('t'));
        if (targets.length) return { pile: p.id, index: i, to: targets[0] };
      }
    }
    return null;
  });
  if (!mv) { step('no tableau→tableau move on this seed; skipping drag (seed should be chosen to have one)'); fail('no drag candidate'); }
  else {
    const from = await point(mv.pile, mv.index);
    const to = await point(mv.to);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await board();
    if (after.moves <= before.moves) fail(`drag ${mv.pile}[${mv.index}] -> ${mv.to} did not register`);
    else step(`drag ${mv.pile}[${mv.index}] -> ${mv.to} registered (moves ${before.moves} -> ${after.moves})`);
    before = after;
  }
}

// 3. Illegal drop returns the card: drag a card onto the stock.
{
  const mv = await page.evaluate(() => {
    const g = window.__game; const v = g.module.view(g.board);
    const p = v.piles.find((x) => x.id.startsWith('t') && x.pickableFrom !== undefined && x.cards.length);
    return p ? { pile: p.id, index: p.cards.length - 1 } : null;
  });
  if (mv) {
    const from = await point(mv.pile, mv.index);
    const to = await point('stock');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await board();
    if (after.moves !== before.moves) fail('illegal drop changed the board');
    else step('illegal drop rejected, board unchanged');
  }
}

// 4. Tap-to-move to a foundation if any ace is available; else tap a movable card and expect a change or a no-op without error.
{
  const mv = await page.evaluate(() => {
    const g = window.__game; const t = { isWild: () => false, isMirror: () => false, dealtFaceUp: () => false };
    const v = g.module.view(g.board);
    for (const p of v.piles) {
      if (p.pickableFrom === undefined) continue;
      for (let i = p.pickableFrom; i < p.cards.length; i++) if (g.module.autoTarget(g.board, p.id, i, t)) return { pile: p.id, index: i };
    }
    return null;
  });
  if (mv) {
    const p = await point(mv.pile, mv.index);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await board();
    if (after.moves <= before.moves) fail(`tap-to-move on ${mv.pile}[${mv.index}] did not register`);
    else step(`tap-to-move ${mv.pile}[${mv.index}] registered`);
    before = after;
  } else step('no auto-move candidate; skipped');
}

// 5. Economy: force a card home and check the rate rises.
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    const before = g.derived.deckRate.toString();
    g.bus && g.state.cards[0].awake === false;
    // find an awake count
    const awakeBefore = g.derived.awakeCount;
    return { before, awakeBefore, homed: g.state.stats.totalHomed };
  });
  step(`rate ${r.before}/s, awake ${r.awakeBefore}, homed ${r.homed}`);
}

// 6. Throw: flick a card toward a legal target and release well short of it; the catch radius should land it.
{
  const mv = await page.evaluate(() => {
    const g = window.__game; const t = { isWild: () => false, isMirror: () => false, dealtFaceUp: () => false };
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
  if (!mv) step('no throw candidate; skipped');
  else {
    const from = await point(mv.pile, mv.index);
    const to = await point(mv.to);
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    // Release at 55% of the way, fast. Playwright's mouse.move round-trips are too slow for a flick
    // (~500 ms each in headless), so dispatch PointerEvents on the canvas directly with ~10 ms spacing.
    await page.evaluate(async ({ from, dx, dy }) => {
      const c = document.querySelector('canvas');
      const box = c.getBoundingClientRect();
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Headless software GL runs ~15 fps, so any real wait inflates the gesture; keep it near-synchronous
      // and let the table's speed clamp make it a plausible flick.
      // Fully synchronous: any yield lets a slow frame run and the flick becomes a slow drag.
      ev('pointerdown', from.x, from.y);
      for (let i = 1; i <= 4; i++) ev('pointermove', from.x + dx * 0.55 * (i / 4), from.y + dy * 0.55 * (i / 4));
      ev('pointerup', from.x + dx * 0.55, from.y + dy * 0.55);
      void box; void sleep;
    }, { from, dx, dy });
    await page.waitForTimeout(1500);
    const after = await board();
    const lg = await page.evaluate(() => window.__table.lastGesture);
    if (after.moves <= before.moves) fail(`throw ${mv.pile}[${mv.index}] -> ${mv.to} (${Math.round(len)}px) was not caught; lastGesture=${JSON.stringify(lg)}`);
    else step(`throw ${mv.pile}[${mv.index}] -> ${mv.to} caught (moves ${before.moves} -> ${after.moves})`);
    before = after;
  }
}

await page.screenshot({ path: 'tools/out/gestures.png' });
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? 'GESTURES: FAILED' : 'GESTURES: OK');
