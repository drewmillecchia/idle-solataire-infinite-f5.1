// Render public/favicon.svg to PNG icons for the PWA manifest.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: CHROME });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#1f3a34">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: false });
  await page.close();
}
await browser.close();
console.log('icons written');
