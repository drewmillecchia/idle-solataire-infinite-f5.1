// Render public/favicon.svg to the PNG icons the manifest and iOS need.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`;
const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: CHROME });
for (const [size, pad] of [[192, 0], [512, 0], [180, 0], [512, 0.1]]) {
  const name = size === 512 && pad ? 'icon-maskable-512' : `icon-${size}`;
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#1f3a34;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`
  );
  await page.screenshot({ path: `public/${name}.png` });
  await page.close();
}
await browser.close();
console.log('icons written');
