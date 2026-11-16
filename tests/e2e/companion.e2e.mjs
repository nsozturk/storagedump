#!/usr/bin/env node
// End-to-end test of the optional local companion with a real Native Messaging host.
//   npm run build && node tests/e2e/companion.e2e.mjs      (macOS / Linux)
//
// It registers the host for Playwright's Chromium under a temporary home, loads a
// copy of dist/ whose manifest already holds the "nativeMessaging" permission (the
// permission prompt cannot be clicked in a test), turns the setting on, and asks
// for a dump with companion/storagedump_client.py exactly as a user script would.

import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST_NAME = 'dev.lamma.storagedump';
const work = mkdtempSync(path.join(tmpdir(), 'storagedump-companion-'));
const home = path.join(work, 'home');
const dist = path.join(work, 'dist');
// With --user-data-dir Chromium reads host manifests from inside the profile folder,
// so the test touches nothing outside its temporary directory.
const manifests = [path.join(work, 'profile', 'NativeMessagingHosts', `${HOST_NAME}.json`)];

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}`);
};
const client = (...args) =>
  execFileSync('python3', [path.join(ROOT, 'companion', 'storagedump_client.py'), ...args], { env: { ...process.env, STORAGEDUMP_HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(ROOT) || !existsSync(file)) return void res.writeHead(404).end();
  const headers = { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json' };
  if (file.endsWith('index.html')) headers['set-cookie'] = ['fixtureHttpOnly=server; Path=/; HttpOnly; SameSite=Lax'];
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

let context;
try {
  cpSync(path.join(ROOT, 'dist'), dist, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  manifest.permissions.push('nativeMessaging');
  delete manifest.optional_permissions;
  writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest));

  context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  // What companion/install.py does, pointed at a temporary home
  const wrapper = path.join(work, 'host.sh');
  writeFileSync(wrapper, `#!/bin/sh\nSTORAGEDUMP_HOME='${home}' exec python3 '${path.join(ROOT, 'companion', 'storagedump_host.py')}'\n`);
  chmodSync(wrapper, 0o755);
  for (const file of manifests) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ name: HOST_NAME, description: 'StorageDump companion (test)', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }));
  }

  const site = await context.newPage();
  await site.goto(`http://localhost:${port}/tests/fixture-site/index.html`);
  await site.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Fixture ready'));

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const send = (type, payload) => page.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, payload: p })).data, [type, payload]);

  let status = await send('GET_COMPANION_STATUS');
  check('off by default: not connected, no socket', status.enabled === false && status.connected === false && !existsSync(path.join(home, 'companion.sock')), JSON.stringify(status));

  await send('SAVE_SETTINGS', { ...(await send('GET_SETTINGS')), companionEnabled: true });
  for (let i = 0; i < 40 && !existsSync(path.join(home, 'companion.sock')); i++) await page.waitForTimeout(150);
  status = await send('GET_COMPANION_STATUS');
  check('turned on: host started and connected', status.connected === true && existsSync(path.join(home, 'companion.sock')), JSON.stringify(status));

  let out = '';
  try { out = client('--ping'); } catch (error) { out = String(error.stderr || error); }
  check('client --ping reaches the extension', /^StorageDump \d+\.\d+\.\d+$/.test(out), out);

  let folder = '';
  try { folder = client(`localhost:${port}`); } catch (error) { folder = String(error.stderr || error); }
  const listed = existsSync(folder) ? readdirSync(folder, { recursive: true }).map(String).sort() : [];
  check('dump writes the export folder', ['cookies.json', 'export-report.json', 'local.json', 'manifest.json', 'for-scripts/cookie-header.txt'].every((f) => listed.includes(f)), `${folder}\n      ${listed.join(', ')}`);
  if (listed.length) {
    const header = readFileSync(path.join(folder, 'for-scripts', 'cookie-header.txt'), 'utf8');
    check('dump includes the HttpOnly cookie', header.includes('fixtureHttpOnly=server'), header);
    const local = JSON.parse(readFileSync(path.join(folder, 'local.json'), 'utf8'));
    check('long values survive chunking', (local.data ?? local).some((e) => typeof e.value === 'string' && e.value.length === 3000), 'the 3000-character value is missing');
    check('extension storage is not handed to scripts', !listed.includes('extension.json'), listed.join(', '));
  }

  const pagesBefore = context.pages().length;
  try { out = client('no-such-site.example'); } catch (error) { out = String(error.stderr || error); }
  check('unknown site: clear error, no tab opened', out.includes('No open tab for no-such-site.example') && context.pages().length === pagesBefore, out);

  const history = (await send('GET_HISTORY')).items;
  check('the request is listed in export history', history.some((h) => h.fileName === `Local companion → localhost:${port}`), JSON.stringify(history.map((h) => h.fileName)));

  await send('SAVE_SETTINGS', { ...(await send('GET_SETTINGS')), companionEnabled: false });
  for (let i = 0; i < 40 && existsSync(path.join(home, 'companion.sock')); i++) await page.waitForTimeout(150);
  status = await send('GET_COMPANION_STATUS');
  check('turned off: host stopped, socket removed', status.connected === false && !existsSync(path.join(home, 'companion.sock')), JSON.stringify(status));
} finally {
  await context?.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) && results.length > 0 ? 0 : 1);
