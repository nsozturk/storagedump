# StorageDump

> Inspect and export browser storage for the current site.

## Overview

StorageDump is a Chrome extension for developers, QA engineers, security researchers, and advanced users who want to inspect and export browser-side application data for the current site.

It is built to make Chrome DevTools **Application** data easier to review, easier to understand, and easier to export locally.

Instead of manually digging through multiple storage areas one by one, StorageDump brings them together in a single workflow.

## What StorageDump does

StorageDump scans the current site and helps the user:

- detect available storage categories
- inspect readable data
- understand what is only partially accessible
- see what is restricted by browser boundaries
- export selected data locally
- export all readable categories in one shot
- review limitations honestly before export

## Why this exists

Modern websites store data across multiple browser-managed systems, including:

- Local Storage
- Session Storage
- Cookies
- IndexedDB
- Cache Storage
- Service Workers
- Extension Storage
- other browser-managed storage surfaces where available

Today, users usually inspect these areas separately inside DevTools. That process is fragmented, noisy, and slow.

StorageDump is meant to turn that into a clear, deliberate flow.

## Target users

StorageDump is designed for:

- frontend and full-stack developers
- QA engineers
- security researchers
- reverse engineers
- technical founders
- advanced browser users

This is not meant to feel like a consumer app. It should feel like a serious utility.

## Core use cases

### 1. Save current site state
A user wants to preserve browser-side state before logging out, clearing storage, switching accounts, or changing environments.

### 2. Debug broken application behavior
A developer wants to inspect what a web app stored in Local Storage, IndexedDB, cookies, or cache layers.

### 3. Review persistence strategy
A researcher or QA engineer wants to understand where a site stores tokens, session values, feature flags, cached payloads, or offline data.

### 4. Export data for offline analysis
A user wants JSON or ZIP exports for later inspection on their machine.

### 5. Compare snapshots
A developer wants before/after exports or environment comparisons such as staging versus production.

## Product principles

### Local-first
Processing should happen locally in the browser unless the user explicitly saves files to disk.

### Honest limits
The extension must clearly show when data is readable, partially readable, restricted, unavailable, or failed.

### Clear scope
Users should always know which origin or site context is being inspected.

### Review before export
The product should encourage preview and understanding before generating files.

### Technical clarity
This tool should feel sharp and dependable, not magical.

## MVP scope

The first version should support the following.

### Detection
- detect current site origin
- scan storage categories
- identify which categories are present
- show item counts where possible
- estimate sizes where possible
- show access state per category

### Inspection
- list each category in a clean summary view
- allow expansion into category details
- preview key-value data where readable
- preview IndexedDB databases and object stores where readable
- preview cache entries and metadata where readable
- preview accessible cookies
- show restrictions and warnings clearly

### Export
- export selected categories
- export all readable categories
- support JSON export
- support ZIP bundle export
- include export metadata:
  - origin
  - timestamp
  - category names
  - export status
  - warning messages
- support pretty-printed JSON

### UX
- popup quick view
- advanced tab-based dashboard
- export progress flow
- completion summary
- warning and partial-export states
- settings page

## Non-goals for v1

These should stay out of scope for the first release:

- remote sync
- cloud uploads
- collaboration features
- cross-browser sync
- browser security bypasses
- pretending restricted data is accessible when it is not
- “forensic-grade” claims that the platform cannot guarantee

## Supported storage categories

### 1. Local Storage
Read and export key-value pairs for the current origin.

### 2. Session Storage
Read and export session-scoped data where accessible.

### 3. Cookies
Export readable cookies and clearly label context limitations.

### 4. IndexedDB
Detect databases, object stores, and records where available.

### 5. Cache Storage
List cache names, requests, response metadata, and readable bodies where possible.

### 6. Service Workers
Show registrations, lifecycle state, and relevant context where available.

### 7. Extension Storage
Support extension-managed storage where applicable and keep it visually distinct from site storage.

## Access states

Every storage category should map to one of these states:

- **Readable** — fully readable in the current context
- **Partial** — some data is readable, but not everything
- **Restricted** — blocked by browser, permission, or security boundaries
- **Unavailable** — not present for the current site
- **Failed** — attempted read returned an error

## Export formats

### JSON
Best for direct inspection, scripting, diffs, and debugging.

### ZIP bundle
Best for grouped exports with metadata and multiple category files.

Example structure:

```text
export/
  manifest.json
  local-storage.json
  session-storage.json
  cookies.json
  indexeddb/
    db-name/
      store-name.json
  cache-storage/
    cache-name.json
  warnings.json
```

## Key screens

### 1. Popup
A quick current-site view showing:

- site origin
- scan state
- storage categories
- counts and size estimates
- export all action
- advanced dashboard entry point

### 2. Category selection
A focused view where the user selects which categories to export.

### 3. Advanced dashboard
A larger interface with:

- overview
- category navigation
- preview explorer
- export settings
- permissions and limitations
- scan/activity log

### 4. Export progress
A step-by-step progress view showing what is being read, serialized, and packaged.

### 5. Export summary
A completion screen showing:

- file name
- exported categories
- partial categories
- failed categories
- warning count

### 6. Settings
A place for defaults and behavior such as:

- export format
- metadata inclusion
- pretty-print JSON
- mask sensitive values
- auto-scan on open
- retain export history
- debug logging

## Trust and privacy

StorageDump must communicate these points clearly:

- processing happens locally
- nothing is uploaded automatically
- the user chooses what gets exported
- some browser-managed data may be restricted
- security boundaries are respected
- exported files may contain sensitive data and should be stored carefully

## Technical reality

StorageDump must not fake completeness.

Examples:

- `HttpOnly` cookies may not be readable from normal page context
- some cache bodies may be binary or too large
- some service worker-related data may be limited by browser behavior
- large IndexedDB datasets may require chunking or partial export
- some records may not serialize cleanly without custom handling

These constraints should be visible in both the UI and exported manifest.

## Proposed architecture

### Extension surfaces
- popup UI
- options/settings page
- advanced dashboard tab
- background service worker
- content scripts only where needed
- export utilities
- storage adapters per category

### Suggested modules
- `scanner/` — detects storage categories and summary stats
- `inspectors/` — reads and normalizes category data
- `exporters/` — JSON and ZIP generation
- `permissions/` — permission and access-state reporting
- `ui/` — popup, dashboard, tables, progress, warnings
- `models/` — category summaries, export manifests, option types
- `utils/` — size formatting, timestamps, serializers, error normalization

## Suggested data model

```ts
type AccessState = "readable" | "partial" | "restricted" | "unavailable" | "failed";

type StorageCategorySummary = {
  id: string;
  name: string;
  accessState: AccessState;
  detected: boolean;
  itemCount?: number;
  estimatedSizeBytes?: number;
  warningMessages?: string[];
};

type ExportManifest = {
  origin: string;
  exportedAt: string;
  format: "json" | "zip";
  categories: {
    id: string;
    status: AccessState | "exported";
    itemCount?: number;
    estimatedSizeBytes?: number;
    warnings?: string[];
  }[];
};
```

## Development phases

### Phase 1 — skeleton
- set up extension structure
- build popup shell
- detect current origin
- list storage categories with status

### Phase 2 — basic readable categories
- Local Storage support
- Session Storage support
- accessible cookie support
- basic JSON export

### Phase 3 — advanced storage support
- IndexedDB inspection
- Cache Storage inspection
- service worker visibility
- richer previews and warnings

### Phase 4 — advanced UX
- dashboard
- export settings
- progress flow
- completion summaries
- history and diagnostics

### Phase 5 — hardening
- edge case coverage
- large dataset handling
- serializer improvements
- copy/privacy polish
- Chrome Web Store packaging

## Success criteria

The MVP succeeds if a user can:

1. open the extension on a site
2. scan current storage surfaces
3. inspect readable data
4. understand restricted areas
5. export selected data locally
6. finish with a clear success, partial, or failure summary

## Risks

### Technical risks
- permission boundaries
- inconsistent API behavior
- very large datasets
- binary cache handling
- serialization failures
- extension context limitations

### UX risks
- overwhelming the user with technical detail
- giving false confidence about completeness
- making export feel opaque or unsafe

## Positioning

Suggested short description:

**Inspect and export browser storage for the current site.**

Alternative description:

**A developer tool for reviewing and exporting Local Storage, IndexedDB, cookies, cache, and more.**

## Working identity

**Name:** StorageDump

Why it works:

- direct
- technical
- memorable
- utility-like
- honest about what the tool does

It feels more like a real developer tool than a polished marketing shell.

## Next implementation checklist

- [ ] finalize branding and icon
- [ ] define permission model
- [ ] design popup
- [ ] design advanced dashboard
- [ ] implement scan pipeline
- [ ] implement Local Storage export
- [ ] implement Session Storage export
- [ ] implement Cookies export
- [ ] implement IndexedDB inspection
- [ ] implement Cache Storage inspection
- [ ] implement export manifest
- [ ] implement JSON export
- [ ] implement ZIP export
- [ ] implement warnings and partial states
- [ ] implement settings page
- [ ] test across multiple sites
- [ ] prepare Chrome Web Store assets

## Final note

StorageDump should win on clarity.

No fake superpowers.
No vague claims.
No mystery.

Just a sharp tool that tells the user what exists, what is readable, what is restricted, and what got exported.
