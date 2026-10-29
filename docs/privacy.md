# StorageDump Privacy

StorageDump processes site storage locally inside the browser extension.

## What the extension stores

- User settings in extension storage
- Export history metadata such as file name, timestamp, origin, checksum, warning count, and size

## What the extension does not do

- No automatic upload
- No remote sync
- No background transmission of inspected site data

## What leaves the browser

Nothing unless the user explicitly exports a file via the Chrome download flow.

## Sensitive data handling

- Exported files may contain tokens, cookies, or session data
- Optional masking can be enabled in settings
- History intentionally excludes exported payload contents
