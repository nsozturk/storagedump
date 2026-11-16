#!/usr/bin/env node
// Generates the Chrome Web Store images from the real built extension:
//
//   store/screenshots/01..05-*.png   1280x800 screenshots
//   store/promo-small-440x280.png    small promo tile
//   store/promo-marquee-1400x560.png marquee promo tile
//
//   npm run store-assets            (builds first)
//
// The extension runs against tests/demo-site ("Acme Notes", made-up data) served
// over HTTPS as https://notes.acme.example, so no real site or account appears.
// Raw UI captures are composed into tiles by an HTML template rendered in the
// same browser, then flattened to 24-bit PNG (the Store rejects alpha) with PIL.

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE_DIR = path.join(ROOT, 'tests', 'demo-site');
const OUT = path.join(ROOT, 'store');
const SHOTS = path.join(OUT, 'screenshots');
const HOST = 'notes.acme.example';
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8')).version;

if (!existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/ not found. Run `npm run build` first (or `npm run store-assets`).');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'storagedump-assets-'));

// ─── Demo site over HTTPS (service workers and Cache Storage need a secure origin) ───

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${HOST}`, '-keyout', path.join(work, 'key.pem'), '-out', path.join(work, 'cert.pem')], { stdio: 'ignore' });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = https.createServer({ key: readFileSync(path.join(work, 'key.pem')), cert: readFileSync(path.join(work, 'cert.pem')) }, (req, res) => {
  const pathname = new URL(req.url, `https://${HOST}`).pathname;
  const file = path.join(SITE_DIR, path.normalize(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(SITE_DIR) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size };
  if (file.endsWith('index.html')) {
    headers['set-cookie'] = [
      'acme_session=demo_sess_c1f4a9e27b3d48f6a05e; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600',
      'acme_refresh=demo_rfr_9e0b7c5d1a2f4e68; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000',
      'acme_csrf=demo_csrf_5b2e8d; Path=/; Secure; SameSite=Lax',
      'acme_embed=widget-v3; Path=/; Secure; SameSite=None; Partitioned'
    ];
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${server.address().port}`,
    '--ignore-certificate-errors'
  ]
});

const raw = {};
const shot = async (page, name, options = {}) => {
  raw[name] = `data:image/png;base64,${(await page.screenshot(options)).toString('base64')}`;
};

async function idle(page) {
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export all');
    return button && !button.disabled;
  });
}

async function nav(page, label) {
  await page.locator('.sd-sidebar .sd-nav-item', { hasText: new RegExp(`^${label}$`) }).click();
  await idle(page);
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  const site = await context.newPage();
  await site.goto(`https://${HOST}/`);
  await site.waitForFunction(() => document.getElementById('status')?.textContent !== 'loading', null, { timeout: 20000 });
  const status = await site.locator('#status').textContent();
  if (status !== 'ready') throw new Error(`Demo site did not seed: ${status}`);
  const tabId = await worker.evaluate(async (host) => (await chrome.tabs.query({})).find((t) => t.url?.includes(host)).id, HOST);

  // ── Popup (same window, so it scans the demo tab) ──
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 720 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByText('Local Storage').waitFor();
  await idle(popup);
  await shot(popup, 'popup');
  await popup.getByRole('button', { name: 'Export all' }).click();
  await popup.getByText('Export completed').waitFor({ timeout: 20000 });
  await popup.evaluate(() => window.scrollTo(0, 0));
  await shot(popup, 'popupExported');
  await popup.close();

  // ── Dashboard ──
  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html?sourceTabId=${tabId}`);
  await dashboard.locator('.sd-two-col .sd-category').first().waitFor();
  await idle(dashboard);
  await shot(dashboard, 'overview');

  await nav(dashboard, 'Cookies');
  await dashboard.locator('.sd-table tbody tr.sd-row', { hasText: 'acme_session' }).click();
  await shot(dashboard, 'cookies');

  await nav(dashboard, 'IndexedDB');
  await dashboard.locator('.sd-content button.sd-category', { hasText: 'acme-notes.notes' }).click();
  await idle(dashboard);
  await dashboard.getByRole('button', { name: 'Load all' }).click();
  await idle(dashboard);
  await dashboard.locator('.sd-filter').fill('roadmap');
  await dashboard.locator('.sd-table tbody tr.sd-row').first().click();
  await shot(dashboard, 'indexeddb');

  // Narrower window for the marquee, so the whole dashboard width fits beside the headline
  await dashboard.setViewportSize({ width: 1040, height: 700 });
  await nav(dashboard, 'Overview');
  await shot(dashboard, 'overviewNarrow');
  await dashboard.close();

  // ── Compose ──
  const icon = `data:image/png;base64,${readFileSync(path.join(ROOT, 'public', 'icons', 'icon-128.png')).toString('base64')}`;
  const css = `
    * { box-sizing: border-box; margin: 0; }
    body { font-family: Inter, "SF Pro Display", "Segoe UI", system-ui, sans-serif; color: #e5eef8; overflow: hidden;
      background:
        radial-gradient(circle at 12% 0%, rgba(59,130,246,.30), transparent 42%),
        radial-gradient(circle at 100% 100%, rgba(16,185,129,.14), transparent 38%),
        linear-gradient(160deg, #0a1018 0%, #111827 100%); }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 22px; letter-spacing: .01em; }
    .brand img { width: 40px; height: 40px; border-radius: 10px; }
    .eyebrow { color: #60a5fa; font-weight: 700; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; }
    h1 { font-weight: 800; letter-spacing: -.02em; line-height: 1.08; }
    p { color: #a8b6c9; line-height: 1.45; }
    .frame { border-radius: 16px; overflow: hidden; border: 1px solid rgba(148,163,184,.22); box-shadow: 0 40px 90px rgba(2,6,23,.6); background: #0b111b; }
    .frame img { display: block; width: 100%; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .chip { border: 1px solid rgba(148,163,184,.24); background: rgba(15,23,42,.7); border-radius: 999px; padding: 9px 16px; font-size: 17px; color: #dbe7f5; }
    .files { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 17px; line-height: 1.9; color: #cbd5e1; }
    .files b { color: #93c5fd; font-weight: 600; }
    .files span { color: #64748b; }
  `;
  const side = ({ eyebrow, title, text, image, extra = '' }) => `
    <body style="width:1280px;height:800px;display:flex;align-items:center;gap:56px;padding:0 72px">
      <div style="flex:1;display:flex;flex-direction:column;gap:22px">
        <div class="brand"><img src="${icon}">StorageDump</div>
        <div class="eyebrow" style="margin-top:18px">${eyebrow}</div>
        <h1 style="font-size:58px">${title}</h1>
        <p style="font-size:23px;max-width:560px">${text}</p>
        ${extra}
      </div>
      <div class="frame" style="width:400px;flex-shrink:0"><img src="${image}"></div>
    </body>`;
  const wide = ({ eyebrow, title, text, image }) => `
    <body style="width:1280px;height:800px;padding:44px 60px 0;display:flex;flex-direction:column;gap:26px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="eyebrow">${eyebrow}</div>
          <h1 style="font-size:42px;max-width:760px">${title}</h1>
        </div>
        <p style="font-size:19px;max-width:360px;text-align:right">${text}</p>
      </div>
      <div class="frame" style="border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom:none"><img src="${image}"></div>
    </body>`;

  const tiles = {
    'screenshots/01-scan.png': [1280, 800, side({
      eyebrow: `Chrome extension · v${VERSION}`,
      title: 'Everything a site stores, in one scan.',
      text: 'Open a site, press Scan and see what it keeps in your browser. Nothing is read until you click, and nothing leaves your device.',
      image: raw.popup,
      extra: '<div class="chips"><span class="chip">No account</span><span class="chip">No server</span><span class="chip">Open source</span></div>'
    })],
    'screenshots/02-dashboard.png': [1280, 800, wide({
      eyebrow: 'Dashboard',
      title: 'One dashboard for all of a site’s data.',
      text: 'Counts, sizes and read status for every storage type, side by side.',
      image: raw.overview
    })],
    'screenshots/03-cookies.png': [1280, 800, wide({
      eyebrow: 'Cookies',
      title: 'Every cookie, including the ones scripts can’t read.',
      text: 'HttpOnly and partitioned cookies on every path, with all their flags.',
      image: raw.cookies
    })],
    'screenshots/04-records.png': [1280, 800, wide({
      eyebrow: 'IndexedDB',
      title: 'Open any record. Filter, copy, edit or delete.',
      text: 'Drill into a database, find an entry and read its full value.',
      image: raw.indexeddb
    })],
    'screenshots/05-export.png': [1280, 800, side({
      eyebrow: 'Export',
      title: 'One click to a ZIP or JSON, exactly as stored.',
      text: 'A manifest plus one file per storage type, saved to your Downloads folder.',
      image: raw.popupExported,
      extra: `<div class="frame files" style="padding:18px 24px;max-width:520px"><b>storagedump_${HOST}.zip</b><br>
        ├─ manifest.json <span>what was exported</span><br>├─ cookies.json<br>├─ local.json · session.json<br>├─ indexeddb.json<br>├─ cache.json<br>└─ serviceWorkers.json</div>`
    })],
    'promo-small-440x280.png': [440, 280, `
      <body style="width:440px;height:280px;padding:34px 36px;display:flex;flex-direction:column;justify-content:space-between">
        <div class="brand" style="font-size:30px"><img src="${icon}" style="width:52px;height:52px;border-radius:13px">StorageDump</div>
        <div><h1 style="font-size:27px">See and export what a site stores</h1>
        <p style="font-size:15px;margin-top:8px">Cookies, storage, IndexedDB and caches</p></div>
        <div class="eyebrow" style="font-size:12px">Free · Open source · 100% local</div>
      </body>`],
    'promo-marquee-1400x560.png': [1400, 560, `
      <body style="width:1400px;height:560px;display:flex;align-items:center;gap:60px;padding-left:80px">
        <div style="width:520px;flex-shrink:0;display:flex;flex-direction:column;gap:20px">
          <div class="brand" style="font-size:26px"><img src="${icon}" style="width:46px;height:46px">StorageDump</div>
          <h1 style="font-size:56px;margin-top:10px">Every byte a site stores, in one export.</h1>
          <p style="font-size:21px">Inspect, edit and export cookies, storage, IndexedDB and caches. Free, open source, 100% local.</p>
        </div>
        <div class="frame" style="width:700px;flex-shrink:0;align-self:flex-start;margin-top:56px;border-bottom-left-radius:0;border-bottom-right-radius:0"><img src="${raw.overviewNarrow}"></div>
      </body>`]
  };

  const composer = await context.newPage();
  for (const [file, [width, height, body]] of Object.entries(tiles)) {
    await composer.setViewportSize({ width, height });
    await composer.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>${body}</html>`);
    await composer.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    writeFileSync(path.join(OUT, file), await composer.screenshot({ scale: 'css' }));
  }

  // 24-bit RGB, exact size: the Store rejects PNGs with an alpha channel
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
for path, w, h in zip(sys.argv[1::3], sys.argv[2::3], sys.argv[3::3]):
    im = Image.open(path).convert('RGB')
    assert im.size == (int(w), int(h)), (path, im.size)
    im.save(path, optimize=True)
    print(f'{path}  {im.size[0]}x{im.size[1]}  {im.mode}')
`, ...Object.entries(tiles).flatMap(([file, [w, h]]) => [path.join(OUT, file), String(w), String(h)])], { stdio: 'inherit' });
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
