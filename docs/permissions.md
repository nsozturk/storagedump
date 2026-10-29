# StorageDump Permission Rationale

## Required permissions

- `activeTab`: scope actions to the current page
- `scripting`: inject the page runtime on demand
- `storage`: persist settings and export history metadata
- `downloads`: save JSON and ZIP exports
- `tabs`: resolve the active tab and open the dashboard
- `cookies`: inspect and mutate cookies when origin permission is granted

## Optional host permissions

- `<all_urls>` is a required host permission so the extension can read storage and cookies of whichever site the user inspects. It is used only when the user clicks Scan, Open dashboard or Export; no page is read in the background.

## Why this model

- Avoid broad access on first install
- Keep cookie inspection permission explicit
- Match Chrome Web Store expectations for least privilege
