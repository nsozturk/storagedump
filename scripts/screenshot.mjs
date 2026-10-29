/**
 * Takes Chrome Web Store screenshots of the StorageDump extension
 * running on eksisozluk.com.
 *
 * Usage:  npm run screenshot
 * Prereq: npm run build:prod  (dist/ must exist)
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distPath   = join(__dirname, '..', 'dist');
const outDir     = join(__dirname, '..', 'store', 'screenshots');

mkdirSync(outDir, { recursive: true });

if (!existsSync(distPath)) {
  console.error('dist/ not found — run: npm run build:prod');
  process.exit(1);
}

const SITE = 'https://eksisozluk.com';
const W = 1280, H = 800;

// ─── Launch ──────────────────────────────────────────────────────────────────

const userDataDir = join(tmpdir(), 'storagedump-ss-profile');
try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
mkdirSync(userDataDir, { recursive: true });

console.log('Launching Chrome with extension…');

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  channel: 'chrome',
  args: [
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

// ─── Get extension ID from chrome://extensions shadow DOM ────────────────────

async function findExtensionId(timeoutMs = 20000) {
  const extPage = await ctx.newPage();
  try {
    await extPage.goto('chrome://extensions', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1500));

    // Enable developer mode so extension IDs are visible
    await extPage.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      const toolbar = manager?.shadowRoot?.querySelector('extensions-toolbar');
      const toggle  = toolbar?.shadowRoot?.querySelector('cr-toggle#devMode');
      if (toggle && !toggle.checked) toggle.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 600));

    // Traverse shadow DOM to find StorageDump
    const id = await extPage.evaluate(() => {
      function getShadow(el, sel) {
        return el?.shadowRoot?.querySelector(sel) ?? null;
      }
      const manager  = document.querySelector('extensions-manager');
      const itemList = getShadow(manager, 'extensions-item-list');
      const items    = Array.from(itemList?.shadowRoot?.querySelectorAll('extensions-item') ?? []);
      for (const item of items) {
        const nameEl = getShadow(item, '#name');
        if (nameEl?.textContent?.trim() === 'StorageDump') return item.id;
      }
      // Fallback: search all extension-item elements anywhere in shadow DOM
      const all = Array.from(document.querySelectorAll('extensions-manager'));
      for (const mgr of all) {
        const il = mgr.shadowRoot?.querySelector('extensions-item-list');
        for (const item of il?.shadowRoot?.querySelectorAll('extensions-item') ?? []) {
          const txt = item?.shadowRoot?.querySelector('#name')?.textContent ?? '';
          if (txt.includes('StorageDump')) return item.id;
        }
      }
      return null;
    });

    if (id) return id;

    // Last resort: dump all extension IDs and pick the one that's ours
    const allIds = await extPage.evaluate(() => {
      const manager  = document.querySelector('extensions-manager');
      const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
      return Array.from(itemList?.shadowRoot?.querySelectorAll('extensions-item') ?? []).map(i => ({
        id: i.id,
        name: i?.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '?',
      }));
    });
    console.log('All extensions:', allIds);
    throw new Error('StorageDump not found in chrome://extensions');
  } finally {
    await extPage.close();
  }
}

console.log('Getting extension ID from chrome://extensions…');
const extensionId = await findExtensionId();
console.log(`Extension ID: ${extensionId}`);

// ─── Open site ───────────────────────────────────────────────────────────────

const sitePage = await ctx.newPage();
await sitePage.setViewportSize({ width: W, height: H });
console.log(`Opening ${SITE}…`);
await sitePage.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 4000));

// ─── Get site tab ID ──────────────────────────────────────────────────────────

const helperPage = await ctx.newPage();
await helperPage.goto(`chrome-extension://${extensionId}/popup.html`);
await new Promise(r => setTimeout(r, 1500));

const siteTabId = await helperPage.evaluate(async (origin) => {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: origin + '/*' }, (tabs) => resolve(tabs[0]?.id ?? null));
  });
}, new URL(SITE).origin);

console.log(`Site tab ID: ${siteTabId}`);
await helperPage.close();

// ─── Dark background CSS injected into every extension page ──────────────────

const DARK_BG = `
  html, body {
    margin: 0;
    width: ${W}px; height: ${H}px;
    background:
      radial-gradient(circle at 18% 22%, rgba(37,99,235,0.22), transparent 38%),
      radial-gradient(circle at 82% 78%, rgba(16,185,129,0.13), transparent 30%),
      linear-gradient(160deg, #050c18 0%, #0c1829 100%);
    display: flex; align-items: center; justify-content: center;
  }
  .sd-popup {
    width: 400px !important;
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 56px 100px rgba(0,0,0,.75), 0 0 0 1px rgba(148,163,184,.1);
  }
`;

async function openExtPage(path) {
  const url = siteTabId
    ? `chrome-extension://${extensionId}/${path}?sourceTabId=${siteTabId}`
    : `chrome-extension://${extensionId}/${path}`;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  await page.goto(url);
  await page.addStyleTag({ content: DARK_BG });
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.sd-pill').length >= 2,
      { timeout: 22000 }
    );
  } catch {
    console.log('  (scan wait timed out — continuing)');
  }
  await new Promise(r => setTimeout(r, 1500));
  return page;
}

// ─── Screenshot 1 – Popup: categories list ───────────────────────────────────

console.log('\nShot 1 — popup (categories)…');
const p1 = await openExtPage('popup.html');
await p1.screenshot({ path: join(outDir, '1-popup.png') });
console.log('  ✓  1-popup.png');

// ─── Screenshot 2 – Popup: export result ─────────────────────────────────────

console.log('Shot 2 — popup (after Export all)…');
try {
  await p1.click('button.primary', { timeout: 3000 });
  await new Promise(r => setTimeout(r, 4000));
  await p1.screenshot({ path: join(outDir, '2-popup-export.png') });
  console.log('  ✓  2-popup-export.png');
} catch {
  console.log('  (export click skipped)');
}
await p1.close();

// ─── Screenshot 3 – Site page (badge in toolbar) ─────────────────────────────

console.log('Shot 3 — site page…');
await sitePage.bringToFront();
await new Promise(r => setTimeout(r, 800));
await sitePage.screenshot({ path: join(outDir, '3-site-badge.png') });
console.log('  ✓  3-site-badge.png');

// ─── Screenshot 4 – Dashboard ────────────────────────────────────────────────

console.log('Shot 4 — dashboard…');
const p4 = await openExtPage('dashboard.html');
await p4.screenshot({ path: join(outDir, '4-dashboard.png') });
console.log('  ✓  4-dashboard.png');
await p4.close();

// ─── Done ─────────────────────────────────────────────────────────────────────

console.log(`\n✓  All screenshots → store/screenshots/`);
await ctx.close();
