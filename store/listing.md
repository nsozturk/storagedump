# Chrome Web Store Listing — StorageDump

## Extension Name
StorageDump

## Short Description (132 chars max)
See what a website keeps in your browser and save it to a file in one click. Runs locally; nothing leaves your device.

## Detailed Description

StorageDump shows you, in one place, what the site in your current tab has saved in your browser: its cookies, local and session storage, IndexedDB databases, cached files and service workers. You can look through it, change or remove entries, and save a complete copy to a file.

How it works
Open the site, click the StorageDump icon and press Scan. You get a summary of what the site uses. Press Export all to save a ZIP or JSON file to your Downloads folder, or open the dashboard to browse each part in detail.

What you can do
- Review a site's data in a full-page dashboard, down to individual database records.
- Edit or delete entries to test how a site behaves with different data.
- Save an exact copy: values are written as stored, and large exports are split automatically.
- Include cookies that page scripts cannot see, such as HttpOnly cookies.
- Hide values that look like passwords or tokens before you share an export.
- Keep a short history of your exports with a checksum for each file.

Who it is for
Web developers debugging their own apps, QA engineers capturing test state, and anyone checking what a site keeps after logging out or clearing consent.

Privacy
StorageDump reads a site only when you press Scan or Export; nothing is read in the background. There is no server, no account and no analytics. Exported files go only to your Downloads folder. The source code is open (MIT) on GitHub.

> Rejected 2026-10-29 (Spam and Placement, "Yellow Argon") for listing the storage types repeatedly. Keep each storage type named once, in prose; no keyword lists.

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
