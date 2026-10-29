# Chrome Web Store Listing — StorageDump

## Extension Name
StorageDump

## Short Description (132 chars max)
Inspect and export all browser storage for any site — cookies, localStorage, sessionStorage, IndexedDB, and more.

## Detailed Description

**StorageDump** gives you a complete view of everything a website stores in your browser — cookies, localStorage, sessionStorage, IndexedDB, Cache API, and Web SQL — all in one place.

**Key Features**

• **One-click scan** — open the popup and instantly see every storage category detected for the active tab
• **Badge** — after you scan, the extension icon shows how many storage categories the site is using
• **Full export** — download all storage data as a structured ZIP or combined JSON with a single click
• **Dashboard view** — drill into each category with a full-page inspector that shows raw keys and values
• **Cookie support** — reads both standard and partitioned (CHIPS) cookies using Chrome's native cookies API
• **Auto-refresh** — switches context automatically when you change tabs

**Use Cases**

→ Debugging web apps and checking what data a site persists
→ Security and privacy audits — see exactly what cookies and storage a site sets
→ Data export for testing or migration
→ Verifying that GDPR / cookie-consent flows actually clear storage

**Supported Storage Types**
- Cookies (including partitioned / CHIPS)
- localStorage
- sessionStorage
- IndexedDB
- Cache API (Service Worker caches)
- Web SQL

---

*StorageDump reads and exports your browser's storage data for the active tab. It does not send any data to external servers.*

## Category
Developer Tools

## Language
English

## Version
0.2.1

---

## Permission Justifications (for CWS review form)

**cookies + <all_urls>**
Required to read cookies for any site the user navigates to. Without `<all_urls>` host permission, `chrome.cookies.getAll` only returns cookies for the few domains explicitly listed, making the extension useless for arbitrary sites. The extension only reads cookies when the user actively opens the popup or requests an export — it does not run in the background continuously.

**tabs**
Required to identify which tab is currently active and to clear the badge count when that tab navigates. No page is read in the background.

**scripting**
Required to inject the in-page bridge script that reads localStorage, sessionStorage, IndexedDB, and Cache API data from the page's JavaScript context. These APIs are not accessible from the background service worker.

**storage**
Required to persist user preferences (export format, auto-scan setting) across browser sessions using `chrome.storage.sync`.

**downloads**
Required to trigger file downloads when the user exports storage data as ZIP or JSON.
