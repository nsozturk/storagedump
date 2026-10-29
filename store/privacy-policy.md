# Privacy Policy — StorageDump

> Canonical version: https://storagedump.lamma.dev/privacy

**Last updated: March 2025**

## Overview

StorageDump is a developer tool that reads and displays browser storage data (cookies, localStorage, sessionStorage, IndexedDB, Cache API) for the tab you are currently viewing. This policy explains what data the extension accesses and what it does — and does not — do with that data.

## Data Collection

**StorageDump does not collect, transmit, or store any data on external servers.**

All data processed by StorageDump stays entirely on your device:

- Storage data (cookies, localStorage, etc.) is read directly from your browser and displayed in the extension popup or dashboard.
- When you use the Export feature, data is saved as a file on your local computer only.
- No data is uploaded to any server, cloud service, or third party.
- No analytics, telemetry, or crash-reporting libraries are included.

## Permissions Used

| Permission | Why it's needed |
|---|---|
| `cookies` + `<all_urls>` | To read cookies for any site you visit, on demand |
| `scripting` | To inject a script that reads localStorage, sessionStorage, IndexedDB, and Cache API from the page context |
| `tabs` | To identify the active tab and to clear its badge counter when the tab navigates |
| `storage` | To save your preferences (export format, export options) and export history metadata locally |
| `downloads` | To save exported files to your computer |

StorageDump only reads storage data when you actively open the popup, open the dashboard, or trigger an export. It does not run persistent background jobs that monitor your browsing.

## Data Sharing

StorageDump does not share any data with third parties. There are no advertising networks, analytics providers, or data brokers involved.

## Local Preferences

Your extension preferences (chosen export format, auto-scan setting) are saved via `chrome.storage`, which stores them in your Chrome profile. If you are signed in to Chrome, these preferences may sync across your devices via Google's sync infrastructure, subject to Google's privacy policy. StorageDump has no control over this sync behavior.

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top of this page will change. Continued use of the extension after any changes constitutes acceptance of the updated policy.

## Contact

If you have questions about this privacy policy, please open an issue in the project repository.
