// Screenshot the running app. Usage: node tools/shot.mjs [url] [out.png] [WxH]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? 'tools/out/shot.png';
const [w, h] = (process.argv[4] ?? '1180x820').split('x').map(Number);
mkdirSync(dirname(out), { recursive: true });

export const CHROME = process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out} (${w}x${h})`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
