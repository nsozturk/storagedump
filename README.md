<p align="center">
  <img src="assets/banner.png" alt="StorageDump — every byte a site stores, in one export" width="100%">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/storagedump/kihoghfekemdccfnpjefmggehpgnjnab"><img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/kihoghfekemdccfnpjefmggehpgnjnab?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest_V3_·_120%2B-4285F4?logo=googlechrome&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="No server, no telemetry" src="https://img.shields.io/badge/data-100%25_local-3fb950">
  <a href="AGENTS.md"><img alt="AI Agent: Native Ready" src="https://img.shields.io/badge/AI_Agent-Native_Ready-8b5cf6"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Chrome_·_Edge_·_Brave-black">
</p>

<p align="center">
  <code>chrome-extension</code> <code>cookies</code> <code>httponly-cookies</code> <code>localstorage</code> <code>indexeddb</code>
  <code>cache-storage</code> <code>browser-storage</code> <code>devtools</code> <code>export-cookies</code> <code>privacy</code>
</p>

# StorageDump

StorageDump is a free, open-source Chrome extension that inspects and exports everything a website stores in your browser — cookies (including HttpOnly and partitioned), localStorage, sessionStorage, IndexedDB, Cache Storage and service workers — as lossless JSON or ZIP, entirely on your machine.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/storagedump/kihoghfekemdccfnpjefmggehpgnjnab)** · [Docs](https://nsozturk.github.io/storagedump/) · [Website](https://storagedump.lamma.dev)

## Screenshots

<p align="center">
  <img src="docs/assets/screenshots/02-dashboard.png" alt="StorageDump dashboard: counts, sizes and read status for every storage type of a site" width="100%">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/01-scan.png" alt="StorageDump popup after a scan, listing the storage categories of the current site" width="100%"></td>
    <td width="50%"><img src="docs/assets/screenshots/03-cookies.png" alt="Cookie table with an HttpOnly cookie expanded to its full value and flags" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/04-records.png" alt="An IndexedDB store filtered to matching records, with one record opened" width="100%"></td>
    <td width="50%"><img src="docs/assets/screenshots/05-export.png" alt="Finished export and the files inside it, including the script-ready files" width="100%"></td>
  </tr>
</table>

Generated from the real extension against a made-up demo site: `npm run store-assets`.

## What it does

| Storage | What you get |
|---|---|
| Cookies | Every cookie for the host, any `Path`, including **HttpOnly** and **partitioned (CHIPS)** cookies, with all flags |
| localStorage / sessionStorage | All frames of the tab, including cross-origin iframes; values exported byte-for-byte (no lossy JSON re-parsing) |
| IndexedDB | Every database and object store; `Map`, `Set`, `BigInt`, dates and cyclic records preserved |
| Cache Storage | Every cached request with status and headers; text bodies, binary bodies as base64 (optional) |
| Service Workers | Registrations, scopes and worker states |
| Extension storage | `chrome.storage.local` / `sync` of StorageDump itself, kept separate |

- **One-click export** — a ZIP, a single JSON file, or an unzipped folder (`Downloads/storagedump/<site>/`, replaced on every export so scripts always read the same path).
- **Script-ready files** — every export adds `for-scripts/`: `cookie-header.txt`, Netscape `cookies.txt` (curl, wget, yt-dlp), `curl.txt` and `playwright-storage-state.json` (`browser.newContext({ storageState })`).
- **Nothing fails silently** — `export-report.json` lists the entries written per category and every read that failed or came back short.
- **Dashboard** — browse each category, drill into IndexedDB stores, edit or delete entries, review export history (with SHA-256 checksums).
- **Optional masking** of keys that look like tokens, sessions or passwords.
- **On demand only** — nothing is read until you click Scan (unless you turn on the optional local companion below). No server, no analytics; exports go to your Downloads folder.

## Install

**Chrome Web Store:** [StorageDump](https://chromewebstore.google.com/detail/storagedump/kihoghfekemdccfnpjefmggehpgnjnab)

**From source:**

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and choose `dist/`.

## Usage

1. Open the site you want to inspect.
2. Click the StorageDump icon → **Scan**.
3. **Export all**, or **Open dashboard** to browse, edit and export single categories.

## Local companion (optional, off by default)

For people who feed exports to their own scripts: a small local program lets a script ask for a
fresh export of a site you have open in Chrome, without clicking.

```bash
python3 companion/install.py                      # once (macOS / Linux)
# StorageDump → Dashboard → Settings → "Turn on local companion"
python3 ~/.storagedump/storagedump_client.py app.example.com   # prints ~/.storagedump/dumps/app.example.com
```

```python
import os, sys; sys.path.insert(0, os.path.expanduser("~/.storagedump"))
from storagedump_client import dump, cookie_header
headers = {"Cookie": cookie_header("app.example.com")}
```

How it stays safe: it uses Chrome's Native Messaging, so there is no network port; Chrome starts the
program and only the StorageDump extension may talk to it; the socket and the dump folder are readable
by your user only; it exports only sites already open in a tab and never opens one; every request is
listed in Export history. The `nativeMessaging` permission is optional and asked for only when you turn
the setting on. Dumps are live session data: treat `~/.storagedump/dumps/` like a password store.

## Permissions

| Permission | Why |
|---|---|
| `<all_urls>`, `scripting`, `activeTab` | Read the storage of the site you are inspecting — only when you click |
| `cookies` | List cookies, including HttpOnly ones the page itself cannot see |
| `downloads` | Save the export to your Downloads folder |
| `storage` | Settings and export history (metadata only) |
| `tabs` | Find the tab you are inspecting; clear its badge when it navigates |
| `nativeMessaging` (optional) | Only if you turn on the local companion: talk to the program you installed |

Details: [Privacy policy](https://storagedump.lamma.dev/privacy) · [docs/permissions.md](docs/permissions.md) · [docs/privacy.md](docs/privacy.md)

## Development

```bash
npm run typecheck
npm test            # unit tests (Vitest)
npm run test:e2e    # dashboard end-to-end + layout-stability test
npm run pack        # production build + Chrome Web Store zip (storagedump.zip)
```

### Dashboard E2E test

`tests/e2e/dashboard.e2e.mjs` loads the built extension into Playwright's Chromium
(`npx playwright install chromium` once), opens the fixture site and drives the
dashboard: every category view, IndexedDB drill-down, mutations, export,
history, settings, a restricted tab and the badge. It also checks for UI jitter:
layout shift on load (CLS ≤ 0.05), shell elements sampled every frame while
switching views/refreshing (≤ 1 px movement), button widths in busy state, and
horizontal overflow at 1440/1024/760 px. Run it after every dashboard change;
`--headed` shows the browser (the two export cases are skipped there, since
`saveAs` opens a native dialog); failures leave screenshots in
`tmp-smoke-artifacts/e2e/`.

### Architecture

React 19 + TypeScript + Vite, Manifest V3.

- `src/runtime/inpage.ts` — injected into the inspected tab on demand; reads localStorage, sessionStorage, IndexedDB, Cache Storage and service workers.
- `src/background/index.ts` — service worker: cookies, all-frames storage, export (JSON/ZIP), settings, history, badge.
- `src/ui/` — popup, dashboard and options pages.

Product notes: [README-StorageDump.md](README-StorageDump.md). Agent contract: [AGENTS.md](AGENTS.md).

## FAQ

### How do I export all cookies, including HttpOnly ones, from Chrome?
Open the site, click StorageDump → **Scan** → **Export all** (or export only the Cookies category from the dashboard). HttpOnly and partitioned cookies are read through the extension cookies API, so they are included.

### How do I export localStorage and IndexedDB for a site?
Scan the site and export. localStorage values are kept exactly as stored, and IndexedDB records keep `Map`, `Set`, `BigInt` and cyclic structures instead of silently flattening them.

### Does StorageDump send my data anywhere?
No. There is no StorageDump server and no analytics. Exports are written locally through the Chrome downloads API.

### Why does it need access to all sites?
Because you can inspect any site you visit. Storage is read only when you click Scan in the popup or dashboard — never in the background, unless you turn on the optional local companion and one of your own scripts asks for an export.

### Is StorageDump an alternative to EditThisCookie or Get cookies.txt LOCALLY?
Yes, for inspecting and exporting cookies — and it also covers localStorage, sessionStorage, IndexedDB, Cache Storage and service workers in the same export.

## Alternatives / compared with

| Tool | Covers |
|---|---|
| Chrome DevTools → Application panel | Inspect all storage, one category at a time; no single export |
| EditThisCookie, Cookie-Editor | Cookies only |
| Get cookies.txt LOCALLY | Cookie export in Netscape format only |
| **StorageDump** | All of the above storage types, inspected together and exported in one JSON/ZIP |

## License

[MIT](LICENSE) © 2026 Enes Öztürk
