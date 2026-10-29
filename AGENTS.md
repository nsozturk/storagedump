# AGENTS.md — StorageDump

Contract for coding agents (Claude Code, Codex, Gemini CLI, Cursor, Antigravity, OpenCode) working in this repo.

## What this is
A Chrome Manifest V3 extension (React 19 + TypeScript + Vite) that inspects and exports a site's
cookies, localStorage, sessionStorage, IndexedDB, Cache Storage and service workers. No server.

## Commands (all non-interactive)
| Command | Does | Exit code |
|---|---|---|
| `npm install` | Install dependencies | 0 ok |
| `npm run typecheck` | `tsc --noEmit` | non-zero on type errors |
| `npm test` | Vitest unit tests | non-zero on failure |
| `npm run build` | Typecheck + Vite build to `dist/` | non-zero on failure |
| `npm run test:e2e` | Build, then 29-case Playwright dashboard test incl. layout-stability checks | 1 if any case fails, 2 if `dist/` is missing |
| `npm run pack` | Production build + `storagedump.zip` for the Chrome Web Store | non-zero on failure |

`npm run test:e2e` needs `npx playwright install chromium` once. Failure screenshots land in
`tmp-smoke-artifacts/e2e/`. Add `--headed` (via `node tests/e2e/dashboard.e2e.mjs --headed`) to watch it.

## Layout
- `src/runtime/inpage.ts` — injected into the inspected tab (MAIN world) on demand; exposes `window.__storageDumpBridge`.
- `src/background/index.ts` — service worker: message handlers, cookies, all-frames storage, export, badge.
- `src/shared/` — types, message map, serialization helpers (used by both layers).
- `src/ui/` — popup, dashboard, options (React).
- `tests/fixture-site/` — page that seeds every storage type, including edge cases.

## Operational truths (learned the hard way)
- Exports must be lossless. `safeJsonParse` only returns parsed JSON when it round-trips exactly;
  big integers and JSON-encoded strings stay raw strings.
- Frame origin is `self.origin`, not `location.origin` (`about:blank` frames report `"null"` but share the parent's storage).
- IndexedDB values go through `normalizeForTransport`: Map/Set/BigInt are tagged with `kind`, cycles become `{ kind: 'Circular' }`.
  IndexedDB deletes must use the real `primaryKey`, never its string form.
- Cookies: list every cookie for the host (any Path), host-only cookies exact-match only, plus partitioned cookies.
- Never read pages in the background. The badge is set only after a user-started scan (store listing promise).
- Any dashboard/UI change: run `npm run test:e2e`; the layout cases fail on CLS > 0.05 or shell movement > 1 px.

## Do not
- Do not add telemetry, remote calls or a server.
- Do not submit to the Chrome Web Store or push without the maintainer's explicit go-ahead.
