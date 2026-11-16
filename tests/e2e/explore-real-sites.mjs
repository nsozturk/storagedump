#!/usr/bin/env node
// Exploratory run of the built extension against real public sites (no login).
// Not a pass/fail test: it records what the dashboard does with real-world data
// (timings, errors, overflow, export result) and saves a screenshot per view.
//
//   npm run build && node tests/e2e/explore-real-sites.mjs [url ...]
//
// Output: tmp-smoke-artifacts/explore/<host>/*.png and report.json

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'tmp-smoke-artifacts', 'explore');
const SITES = process.argv.slice(2).filter((a) => a.startsWith('http'));
const DEFAULT_SITES = [
  'https://www.youtube.com/',
  'https://github.com/',
  'https://excalidraw.com/',
  'https://squoosh.app/',
  'https://www.bbc.com/',
  'https://www.wikipedia.org/'
];
const CATEGORIES = ['Local Storage', 'Session Storage', 'Cookies', 'IndexedDB', 'Cache Storage', 'Service Workers', 'Extension Storage'];

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(2);
}

const profileDir = mkdtempSync(path.join(tmpdir(), 'storagedump-explore-'));
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
});
const report = [];

async function idle(page, timeout = 60000) {
  const started = Date.now();
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export all');
      return button && !button.disabled;
    },
    null,
    { timeout }
  );
  return Date.now() - started;
}

function send(page, type, payload) {
  return page.evaluate(
    async ([messageType, messagePayload]) => {
      const response = await chrome.runtime.sendMessage({ type: messageType, payload: messagePayload });
      if (!response.ok) throw new Error(response.error);
      return response.data;
    },
    [type, payload]
  );
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  for (const url of SITES.length ? SITES : DEFAULT_SITES) {
    const host = new URL(url).host;
    const dir = path.join(OUT, host);
    mkdirSync(dir, { recursive: true });
    const entry = { url, views: {}, consoleErrors: [] };
    report.push(entry);
    const site = await context.newPage();
    const dashboard = await context.newPage();
    dashboard.on('console', (m) => m.type() === 'error' && entry.consoleErrors.push(m.text().slice(0, 200)));
    dashboard.on('pageerror', (e) => entry.consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
    try {
      await site.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await site.waitForTimeout(6000);
      const tabId = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(u.slice(0, 16)))?.id, url);
      entry.frames = site.frames().length;

      const t0 = Date.now();
      await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html?sourceTabId=${tabId}`);
      try {
        await idle(dashboard);
        entry.scanMs = Date.now() - t0;
      } catch {
        entry.scanMs = 'TIMEOUT 60s';
      }
      const read = async () => ({
        error: await dashboard.locator('.sd-content > .sd-banner').allTextContents(),
        overflow: await dashboard.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        rows: await dashboard.locator('.sd-table tbody tr').count(),
        tableOverflow: await dashboard.evaluate(() => {
          const wrap = document.querySelector('.sd-table-wrap');
          return wrap ? wrap.scrollWidth - wrap.clientWidth : 0;
        }),
        pageHeight: await dashboard.evaluate(() => document.documentElement.scrollHeight)
      });
      entry.overview = {
        ...(await read()),
        metrics: await dashboard.locator('.sd-grid.cols-4 > .sd-panel').allTextContents(),
        health: await dashboard.locator('.sd-two-col .sd-category').allTextContents()
      };
      await dashboard.screenshot({ path: path.join(dir, '00-overview.png') });

      for (const [index, label] of CATEGORIES.entries()) {
        const started = Date.now();
        try {
          await dashboard.locator('.sd-sidebar .sd-nav-item', { hasText: new RegExp(`^${label}$`) }).click();
          const ms = await idle(dashboard, 45000);
          entry.views[label] = { ms, ...(await read()), warning: (await dashboard.locator('.sd-content .sd-panel .sd-subtle').first().textContent())?.slice(0, 160) };
        } catch (error) {
          entry.views[label] = { ms: Date.now() - started, failed: error.message.split('\n')[0] };
        }
        await dashboard.screenshot({ path: path.join(dir, `0${index + 1}-${label.replace(/\s+/g, '-').toLowerCase()}.png`) });
      }

      // First IndexedDB store, if any
      await dashboard.locator('.sd-sidebar .sd-nav-item', { hasText: /^IndexedDB$/ }).click();
      await idle(dashboard).catch(() => {});
      const stores = dashboard.locator('.sd-content button.sd-category');
      entry.idbStores = await stores.count();
      if (entry.idbStores > 0) {
        const started = Date.now();
        await stores.first().click();
        await idle(dashboard, 45000).catch(() => {});
        entry.views['IndexedDB store'] = { ms: Date.now() - started, ...(await read()) };
        await dashboard.screenshot({ path: path.join(dir, '08-indexeddb-store.png') });
      }

      // Export pipeline (JSON, everything) without waiting on the save dialog result
      const started = Date.now();
      try {
        const job = await send(dashboard, 'START_EXPORT', {
          selection: { categoryIds: ['local', 'session', 'cookies', 'indexeddb', 'cache', 'serviceWorkers', 'extension'] },
          options: { format: 'zip', prettyPrint: true, includeMetadata: true, includeTimestamps: true, splitLargeFiles: true, splitThresholdBytes: 2097152, skipBinaryBodies: true, maskSensitiveValues: false }
        });
        let status = job;
        for (let i = 0; i < 240 && status.state === 'running'; i++) {
          await dashboard.waitForTimeout(500);
          status = await send(dashboard, 'GET_EXPORT_STATUS', { jobId: job.id });
        }
        entry.export = {
          ms: Date.now() - started,
          state: status?.state ?? 'JOB LOST (service worker restarted?)',
          error: status?.error,
          task: status?.currentTask,
          categories: status?.manifest?.categories.map((c) => `${c.id}:${c.status}:${c.itemCount ?? '-'}`),
          bytes: status?.historyEntry?.totalSizeBytes
        };
      } catch (error) {
        entry.export = { ms: Date.now() - started, failed: error.message.split('\n')[0] };
      }
    } catch (error) {
      entry.failed = error.message.split('\n')[0];
    } finally {
      await dashboard.close().catch(() => {});
      await site.close().catch(() => {});
    }
    console.log(JSON.stringify(entry));
  }
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
}
