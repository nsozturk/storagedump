#!/usr/bin/env node
// End-to-end test for the StorageDump dashboard, run against the real built
// extension in Playwright's Chromium.
//
//   npm run test:e2e              # build + run headless
//   node tests/e2e/dashboard.e2e.mjs --headed
//
// Every case runs even if an earlier one fails; failures leave a screenshot in
// tmp-smoke-artifacts/e2e/. The "layout" cases measure UI jitter: cumulative
// layout shift plus a per-frame position sampler on the shell elements while
// the user switches views, refreshes and mutates.

import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS = path.join(ROOT, 'tmp-smoke-artifacts', 'e2e');
const HEADED = process.argv.includes('--headed');

// Shell elements must not move when the user changes views; panels may resize.
const STABLE_SELECTORS = ['.sd-topbar', '.sd-sidebar', '.sd-content'];
const MAX_CLS = 0.05;

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/ not found. Run `npm run build` first (or `npm run test:e2e`).');
  process.exit(2);
}
mkdirSync(ARTIFACTS, { recursive: true });

// ─── Fixture server ──────────────────────────────────────────────────────────

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const headers = {
      'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json'
    };
    if (file.endsWith('index.html')) {
      // Cookies the page itself cannot see or set: HttpOnly, another path, partitioned.
      headers['set-cookie'] = [
        'fixtureHttpOnly=server; Path=/; HttpOnly; SameSite=Lax',
        'fixtureOtherPath=api; Path=/api; SameSite=Lax',
        'fixturePartitioned=chips; Path=/; Secure; SameSite=None; Partitioned'
      ];
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ─── Tiny runner ─────────────────────────────────────────────────────────────

const results = [];

async function test(name, page, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    const shot = path.join(ARTIFACTS, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, ms: Date.now() - started, error: error.message.split('\n')[0], shot });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  return JSON.stringify(value, (_, nested) =>
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
      : nested
  );
}

function eq(actual, expected, label) {
  assert(canonical(actual) === canonical(expected), `${label}: expected ${canonical(expected)}, got ${canonical(actual)}`);
}

// ─── Page helpers ────────────────────────────────────────────────────────────

/** Call the background exactly like the dashboard does. */
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

async function waitIdle(page) {
  // Busy state disables "Export all"; wait for it to come back.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export all');
    return button && !button.disabled;
  });
}

async function nav(page, label) {
  await page.locator('.sd-sidebar .sd-nav-item', { hasText: new RegExp(`^${label}$`) }).click();
  await waitIdle(page);
}

function errorBanner(page) {
  return page.locator('.sd-content > .sd-banner').count();
}

/** Run `action` while sampling shell element positions every animation frame. */
async function measureJitter(page, action) {
  await page.evaluate((selectors) => {
    const samples = Object.fromEntries(selectors.map((s) => [s, []]));
    window.__jitter = { samples, running: true };
    const tick = () => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const r = el.getBoundingClientRect();
          samples[selector].push([r.x, r.y, r.width]);
        }
      }
      if (window.__jitter.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, STABLE_SELECTORS);
  await action();
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    window.__jitter.running = false;
    return Object.fromEntries(
      Object.entries(window.__jitter.samples).map(([selector, list]) => {
        let max = 0;
        for (const [x, y, w] of list) {
          max = Math.max(max, Math.abs(x - list[0][0]), Math.abs(y - list[0][1]), Math.abs(w - list[0][2]));
        }
        return [selector, Math.round(max * 10) / 10];
      })
    );
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

const server = await startFixtureServer();
const port = server.address().port;
const fixtureUrl = `http://localhost:${port}/tests/fixture-site/index.html`;
const profileDir = mkdtempSync(path.join(tmpdir(), 'storagedump-e2e-'));
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: !HEADED,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
});

let page;
let dashboard;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Fixture ready'), null, {
    timeout: 15000
  });
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, fixtureUrl);

  await test('badge stays empty until the user scans', page, async () => {
    eq(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId), '', 'badge before scan');
  });

  dashboard = await context.newPage();
  await dashboard.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node;
          const name = node?.className ? `${node.tagName?.toLowerCase()}.${String(node.className).trim().split(/\s+/).join('.')}` : node?.nodeName ?? '?';
          const text = (node?.textContent ?? '').trim().slice(0, 24);
          const from = source.previousRect;
          const to = source.currentRect;
          return `${name} "${text}" (${Math.round(from.x)},${Math.round(from.y)})→(${Math.round(to.x)},${Math.round(to.y)})`;
        });
        window.__shifts.push({ value: entry.value, recent: entry.hadRecentInput, sources });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html?sourceTabId=${tabId}`);
  await dashboard.locator('.sd-sidebar .sd-nav-item', { hasText: /^Local Storage$/ }).waitFor();
  await waitIdle(dashboard);

  // ── Overview ──
  await test('overview: origin, metrics, all categories, no error', dashboard, async () => {
    const subtitle = await dashboard.locator('.sd-topbar .sd-subtle').first().textContent();
    eq(subtitle, `http://localhost:${port}`, 'origin');
    eq(await dashboard.locator('.sd-grid.cols-4 > .sd-panel').count(), 4, 'metric cards');
    const navItems = await dashboard.locator('.sd-sidebar .sd-nav-item').allTextContents();
    eq(navItems, [
      'Overview',
      'Local Storage',
      'Session Storage',
      'Cookies',
      'IndexedDB',
      'Cache Storage',
      'Service Workers',
      'Extension Storage',
      'Export history',
      'Settings'
    ], 'sidebar');
    eq(await dashboard.locator('.sd-two-col .sd-category').count(), 7, 'health rows');
    eq(await errorBanner(dashboard), 0, 'error banners');
    await dashboard.screenshot({ path: path.join(ARTIFACTS, 'overview.png') });
  });

  await test('badge shows detected category count after scan', page, async () => {
    const text = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    assert(Number(text) >= 6, `badge after scan: ${JSON.stringify(text)}`);
  });

  await test('overview: refresh keeps state and clears busy label', dashboard, async () => {
    await dashboard.getByRole('button', { name: 'Refresh' }).click();
    await waitIdle(dashboard);
    await dashboard.getByRole('button', { name: 'Refresh' }).waitFor();
    eq(await errorBanner(dashboard), 0, 'error banners');
  });

  await test('overview: debug panel toggles', dashboard, async () => {
    await dashboard.getByRole('button', { name: 'Show debug' }).click();
    await dashboard.getByRole('button', { name: 'Hide debug' }).waitFor();
    await dashboard.getByText('Debug', { exact: false }).first().waitFor();
    await dashboard.getByRole('button', { name: 'Hide debug' }).click();
    await dashboard.getByRole('button', { name: 'Show debug' }).waitFor();
  });

  // ── Categories ──
  await test('local storage: every key once, raw values preserved', dashboard, async () => {
    await nav(dashboard, 'Local Storage');
    const keys = await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents();
    eq(keys.sort(), ['fixture:bignum', 'fixture:local', 'fixture:quoted'], 'table keys (iframe must not duplicate)');
    const exported = await send(dashboard, 'LOAD_CATEGORY_DETAIL', { categoryId: 'local' });
    const byKey = Object.fromEntries(exported.entries.map((e) => [e.key, e.value]));
    eq(byKey['fixture:bignum'], '7123456789012345678', 'bignum kept as raw string');
    eq(byKey['fixture:quoted'], '"quoted"', 'JSON string keeps quotes');
    eq(byKey['fixture:local'], { theme: 'dark', flags: ['alpha'] }, 'JSON object parsed');
  });

  await test('session storage: entry listed', dashboard, async () => {
    await nav(dashboard, 'Session Storage');
    eq(await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents(), ['fixture:session'], 'keys');
  });

  await test('cookies: page, HttpOnly, other-path and partitioned cookies', dashboard, async () => {
    await nav(dashboard, 'Cookies');
    const names = (await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents()).sort();
    eq(names, ['fixtureCookie', 'fixtureHttpOnly', 'fixtureOtherPath', 'fixturePartitioned'], 'cookie names');
  });

  await test('indexeddb: database list, store drill-down, rows', dashboard, async () => {
    await nav(dashboard, 'IndexedDB');
    const stores = await dashboard.locator('.sd-content .sd-category strong').allTextContents();
    eq(stores.sort(), ['EdgeDB.numbered', 'EdgeDB.values', 'FixtureDB.profiles'], 'stores');
    const titleColor = await dashboard.locator('.sd-content .sd-category strong').first().evaluate((el) => getComputedStyle(el).color);
    assert(titleColor !== 'rgb(0, 0, 0)', `store titles are unreadable (${titleColor} on dark panel)`);
    await dashboard.locator('.sd-content .sd-category', { hasText: 'FixtureDB.profiles' }).click();
    await waitIdle(dashboard);
    eq((await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents()).sort(), ['user_1', 'user_2'], 'rows');
  });

  await test('indexeddb: Map/Set/BigInt/cyclic values export without loss or hang', dashboard, async () => {
    const detail = await send(dashboard, 'LOAD_CATEGORY_DETAIL', {
      categoryId: 'indexeddb',
      target: { dbName: 'EdgeDB', storeName: 'values' }
    });
    const byKey = Object.fromEntries(detail.entries.map((e) => [e.key, e.value]));
    eq(byKey.map, { kind: 'Map', entries: [['a', 1]] }, 'map');
    eq(byKey.set, { kind: 'Set', values: [1, 2] }, 'set');
    eq(byKey.bigint, { kind: 'BigInt', value: '10' }, 'bigint');
    eq(byKey.cycle, { name: 'loop', self: { kind: 'Circular' } }, 'cycle');
  });

  await test('cache storage: rows listed', dashboard, async () => {
    await nav(dashboard, 'Cache Storage');
    const urls = await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents();
    eq(urls.map((u) => u.split('/').pop()).sort(), ['app.js', 'cached.json', 'pixel.bin'], 'cached urls');
  });

  await test('service workers: registration listed', dashboard, async () => {
    await nav(dashboard, 'Service Workers');
    const scopes = await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents();
    eq(scopes, [`http://localhost:${port}/tests/fixture-site/`], 'scopes');
  });

  await test('extension storage: settings key listed', dashboard, async () => {
    await nav(dashboard, 'Extension Storage');
    const keys = await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents();
    assert(keys.includes('storagedump.settings'), `keys: ${keys}`);
  });

  // ── Mutations ──
  await test('mutation: create then delete a localStorage key', dashboard, async () => {
    dashboard.on('dialog', (dialog) => void dialog.accept());
    await nav(dashboard, 'Local Storage');
    await dashboard.locator('.sd-panel select').first().selectOption('create');
    await dashboard.locator('.sd-field', { hasText: 'Key' }).locator('input').fill('e2e:new');
    await dashboard.locator('.sd-field textarea').fill('{"added":true}');
    await dashboard.getByRole('button', { name: 'Apply mutation' }).click();
    await dashboard.locator('.sd-table td', { hasText: /^e2e:new$/ }).waitFor();
    eq(await page.evaluate(() => localStorage.getItem('e2e:new')), '{"added":true}', 'page value after create');

    await dashboard.locator('.sd-table tr', { hasText: 'e2e:new' }).getByRole('button', { name: 'Delete' }).click();
    await dashboard.locator('.sd-table td', { hasText: /^e2e:new$/ }).waitFor({ state: 'detached' });
    eq(await page.evaluate(() => localStorage.getItem('e2e:new')), null, 'page value after delete');
  });

  await test('mutation: delete an IndexedDB row with a numeric key', dashboard, async () => {
    await nav(dashboard, 'IndexedDB');
    await dashboard.locator('.sd-content .sd-category', { hasText: 'EdgeDB.numbered' }).click();
    await waitIdle(dashboard);
    eq((await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents()).sort(), ['1', '2'], 'rows before');
    await dashboard.locator('.sd-table tr', { hasText: /^1/ }).getByRole('button', { name: 'Delete' }).click();
    await waitIdle(dashboard);
    eq(await dashboard.locator('.sd-table tbody tr td:first-child').allTextContents(), ['2'], 'rows after');
    const remaining = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('EdgeDB');
          request.onsuccess = () => {
            const count = request.result.transaction('numbered').objectStore('numbered').count();
            count.onsuccess = () => {
              request.result.close();
              resolve(count.result);
            };
          };
        })
    );
    eq(remaining, 1, 'records left in the page');
  });

  await test('mutation: read-only categories show no console', dashboard, async () => {
    await nav(dashboard, 'Service Workers');
    await dashboard.getByText('This category is read-only in v1.').waitFor();
  });

  // ── Export + history ──
  await test('export: job completes, cache export keeps text and binary bodies', dashboard, async () => {
    if (HEADED) return;
    const options = {
      format: 'json',
      prettyPrint: false,
      includeMetadata: false,
      includeTimestamps: true,
      splitLargeFiles: false,
      splitThresholdBytes: 2 * 1024 * 1024,
      skipBinaryBodies: false,
      maskSensitiveValues: false
    };
    // Same pipeline the export job runs, without the save dialog.
    const cache = await send(dashboard, 'GET_EXPORT_PREVIEW', { selection: { categoryIds: ['cache'] } });
    eq(cache.categories.map((c) => c.id), ['cache'], 'preview categories');
    const job = await send(dashboard, 'START_EXPORT', { selection: { categoryIds: ['cache', 'local'] }, options });
    let status = job;
    for (let i = 0; i < 40 && status.state === 'running'; i++) {
      await dashboard.waitForTimeout(250);
      status = await send(dashboard, 'GET_EXPORT_STATUS', { jobId: job.id });
    }
    eq(status.state, 'completed', `job state (${status.error ?? ''})`);
    eq(status.manifest.partial, false, 'manifest partial');
    eq(status.manifest.version, '0.2.1', 'manifest version');
  });

  await test('export: cache payload has JS text and base64 binary body', dashboard, async () => {
    const payload = await page.evaluate(() => window.__storageDumpBridge.exportCategory('cache', { includeBinaryBodies: true }));
    const items = Object.fromEntries(payload['fixture-cache'].map((i) => [i.url.split('/').pop(), i]));
    eq([items['app.js'].bodyEncoding, items['app.js'].body], ['text', 'console.log(1);'], 'js body');
    eq([items['pixel.bin'].bodyEncoding, items['pixel.bin'].body], ['base64', 'AAEC/w=='], 'binary body');
    const skipped = await page.evaluate(() => window.__storageDumpBridge.exportCategory('cache'));
    eq(skipped['fixture-cache'].find((i) => i.url.endsWith('pixel.bin')).body, null, 'binary skipped by default');
  });

  // Skipped headed: chrome.downloads saveAs opens a native dialog there.
  await test('export: "Export all" button drives the pipeline to completion', dashboard, async () => {
    if (HEADED) return;
    await nav(dashboard, 'Overview');
    const before = await dashboard.locator('.sd-two-col .sd-panel', { hasText: 'Recent exports' }).locator('.sd-summary-row').count();
    await dashboard.getByRole('button', { name: 'Export all' }).click();
    const pipeline = dashboard.locator('.sd-panel', { hasText: 'Export pipeline' });
    await pipeline.locator('.sd-summary-row', { hasText: 'State' }).getByText('completed', { exact: true }).waitFor({ timeout: 15000 });
    await pipeline.locator('.sd-summary-row', { hasText: 'Progress' }).getByText('100%').waitFor();
    await dashboard.waitForFunction(
      (n) => [...document.querySelectorAll('.sd-panel')].find((p) => p.textContent.includes('Recent exports')).querySelectorAll('.sd-summary-row').length > Math.min(n, 3),
      before
    );
    eq(await errorBanner(dashboard), 0, 'error banners');
  });

  await test('history: export appears, Remove deletes it', dashboard, async () => {
    await nav(dashboard, 'Export history');
    const rows = dashboard.locator('.sd-table tbody tr');
    await rows.first().waitFor();
    const before = await rows.count();
    await rows.first().getByRole('button', { name: 'Remove' }).click();
    await dashboard.waitForFunction((n) => document.querySelectorAll('.sd-table tbody tr').length === n - 1 || (n === 1 && document.querySelector('.sd-empty')), before);
  });

  // ── Settings ──
  await test('settings: only working options, saved value survives reload', dashboard, async () => {
    await nav(dashboard, 'Settings');
    const labels = await dashboard.locator('.sd-panel .sd-field > span').allTextContents();
    assert(!labels.includes('Theme') && !labels.includes('Include timestamps'), `dead options still shown: ${labels}`);
    await dashboard.locator('.sd-field', { hasText: 'Default export format' }).locator('select').selectOption('json');
    await dashboard.getByRole('button', { name: 'Save settings' }).click();
    await waitIdle(dashboard);
    await dashboard.reload();
    await waitIdle(dashboard);
    await nav(dashboard, 'Settings');
    eq(await dashboard.locator('.sd-field', { hasText: 'Default export format' }).locator('select').inputValue(), 'json', 'format after reload');
  });

  // ── Layout stability ──
  await test('layout: no layout shift on load (CLS)', dashboard, async () => {
    await dashboard.reload();
    await waitIdle(dashboard);
    await dashboard.waitForTimeout(500);
    const shifts = await dashboard.evaluate(() => window.__shifts);
    const cls = shifts.reduce((sum, s) => sum + s.value, 0);
    const sources = [...new Set(shifts.flatMap((s) => s.sources))].join(', ');
    assert(cls <= MAX_CLS, `CLS on load ${cls.toFixed(3)} > ${MAX_CLS} (moved: ${sources})`);
  });

  await test('layout: shell does not move while switching views', dashboard, async () => {
    const jitter = await measureJitter(dashboard, async () => {
      for (const label of ['Local Storage', 'Cookies', 'IndexedDB', 'Cache Storage', 'Export history', 'Settings', 'Overview']) {
        await nav(dashboard, label);
      }
    });
    for (const [selector, px] of Object.entries(jitter)) assert(px <= 1, `${selector} moved ${px}px`);
  });

  await test('layout: shell does not move during refresh and mutation', dashboard, async () => {
    const jitter = await measureJitter(dashboard, async () => {
      await dashboard.getByRole('button', { name: 'Refresh' }).click();
      await waitIdle(dashboard);
      await nav(dashboard, 'Local Storage');
      await dashboard.getByRole('button', { name: 'Refresh' }).click();
      await waitIdle(dashboard);
    });
    for (const [selector, px] of Object.entries(jitter)) assert(px <= 1, `${selector} moved ${px}px`);
  });

  await test('layout: refresh button keeps its width while busy', dashboard, async () => {
    await nav(dashboard, 'Overview');
    const button = dashboard.locator('.sd-two-col button', { hasText: /^Refresh/ });
    const widths = await measureButton(dashboard, button);
    assert(widths.max - widths.min <= 1, `Refresh button width changed ${widths.min}→${widths.max}px`);
  });

  for (const width of [1440, 1024, 760]) {
    await test(`layout: no horizontal overflow at ${width}px`, dashboard, async () => {
      await dashboard.setViewportSize({ width, height: 900 });
      for (const label of ['Overview', 'Cookies', 'Export history']) {
        await nav(dashboard, label);
        const overflow = await dashboard.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(overflow <= 0, `${label}: page scrolls horizontally by ${overflow}px`);
      }
    });
  }
  await dashboard.setViewportSize({ width: 1440, height: 900 });

  // ── Restricted tab ──
  await test('restricted tab: dashboard degrades without crashing', dashboard, async () => {
    const restricted = await context.newPage();
    await restricted.goto('about:blank');
    const restrictedTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' }))[0].id);
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html?sourceTabId=${restrictedTabId}`);
    await dashboard.locator('.sd-sidebar .sd-nav-item', { hasText: /^Local Storage$/ }).waitFor();
    await waitIdle(dashboard);
    eq(await errorBanner(dashboard), 0, 'error banners');
    await dashboard.getByText('This tab URL cannot be scripted by the extension.').first().waitFor();
    await restricted.close();
  });
} finally {
  await context.close();
  server.close();
  rmSync(profileDir, { recursive: true, force: true });
}

async function measureButton(pageRef, button) {
  const box = await button.evaluate((el) => {
    const widths = [];
    const observer = new ResizeObserver(() => widths.push(el.getBoundingClientRect().width));
    observer.observe(el);
    window.__buttonWidths = widths;
    return el.getBoundingClientRect().width;
  });
  await button.click();
  await waitIdle(pageRef);
  const widths = [box, ...(await pageRef.evaluate(() => window.__buttonWidths))];
  return { min: Math.min(...widths), max: Math.max(...widths) };
}

// ─── Report ──────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms} ms)${r.ok ? '' : `\n      ${r.error}\n      screenshot: ${r.shot}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
