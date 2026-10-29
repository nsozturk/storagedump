#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import tempfile
import time
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import Page, sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"
ARTIFACTS_DIR = ROOT / "tmp-smoke-artifacts"


def require_build() -> None:
    if not DIST_DIR.exists():
        raise SystemExit("dist/ not found. Run `npm run build` first.")
    ARTIFACTS_DIR.mkdir(exist_ok=True)


def resolve_extension_id(context) -> str:
    deadline = time.time() + 15
    while time.time() < deadline:
        service_workers = context.service_workers
        if service_workers:
            extension_worker = next(
                (worker for worker in service_workers if worker.url.startswith("chrome-extension://")),
                None,
            )
            if extension_worker:
                return extension_worker.url.split("/")[2]
        time.sleep(0.25)
    raise RuntimeError("Extension service worker did not appear.")


def wait_for_site(page: Page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        page.wait_for_timeout(3_000)


def page_probe(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """
        async () => {
          const cookies = document.cookie
            ? document.cookie.split(';').map((item) => item.trim()).filter(Boolean)
            : [];

          let indexedDbCount = null;
          let indexedDbError = null;
          try {
            if (typeof indexedDB.databases === 'function') {
              const databases = await indexedDB.databases();
              indexedDbCount = databases.length;
            }
          } catch (error) {
            indexedDbError = error instanceof Error ? error.message : String(error);
          }

          let cacheCount = null;
          let cacheError = null;
          try {
            if ('caches' in window) {
              const keys = await caches.keys();
              cacheCount = keys.length;
            }
          } catch (error) {
            cacheError = error instanceof Error ? error.message : String(error);
          }

          let swCount = null;
          let swError = null;
          try {
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              swCount = regs.length;
            }
          } catch (error) {
            swError = error instanceof Error ? error.message : String(error);
          }

          return {
            href: location.href,
            origin: location.origin,
            title: document.title,
            documentCookieCount: cookies.length,
            documentCookieSample: cookies.slice(0, 20),
            localStorageCount: window.localStorage.length,
            sessionStorageCount: window.sessionStorage.length,
            indexedDbCount,
            indexedDbError,
            cacheCount,
            cacheError,
            serviceWorkerCount: swCount,
            serviceWorkerError: swError
          };
        }
        """
    )


def send_extension_message(extension_page: Page, message_type: str, payload: Any = None) -> Any:
    response = extension_page.evaluate(
        """
        async ({ messageType, payload }) => {
          const response = await chrome.runtime.sendMessage({
            type: messageType,
            payload
          });
          return response;
        }
        """,
        {"messageType": message_type, "payload": payload},
    )

    if not response.get("ok"):
        raise RuntimeError(response.get("error") or f"Extension message failed: {message_type}")
    return response["data"]


def try_extension_message(extension_page: Page, message_type: str, payload: Any = None) -> dict[str, Any]:
    try:
        return {
            "ok": True,
            "data": send_extension_message(extension_page, message_type, payload),
        }
    except Exception as error:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(error),
        }


def write_json(path: pathlib.Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2))


def run_probe(url: str, headed: bool, settle_seconds: int) -> None:
    require_build()
    with tempfile.TemporaryDirectory(prefix="storagedump-probe-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=not headed,
                args=[
                    f"--disable-extensions-except={DIST_DIR}",
                    f"--load-extension={DIST_DIR}",
                ],
            )
            try:
                for existing in list(context.pages):
                    if existing.url == "about:blank":
                        existing.close()

                site_page = context.new_page()
                site_page.goto(url, wait_until="domcontentloaded")
                wait_for_site(site_page)
                site_page.bring_to_front()

                if settle_seconds > 0:
                    print(f"Waiting {settle_seconds}s for manual interaction on {url} ...")
                    site_page.wait_for_timeout(settle_seconds * 1000)

                extension_id = resolve_extension_id(context)
                popup_page = context.new_page()
                popup_page.goto(f"chrome-extension://{extension_id}/popup.html", wait_until="domcontentloaded")

                active_context_from_popup = send_extension_message(popup_page, "GET_ACTIVE_CONTEXT", None)
                source_tab_id = active_context_from_popup["tabId"]

                dashboard_page = context.new_page()
                dashboard_page.goto(
                    f"chrome-extension://{extension_id}/dashboard.html?sourceTabId={source_tab_id}",
                    wait_until="domcontentloaded",
                )
                dashboard_page.wait_for_timeout(1500)

                site_snapshot = page_probe(site_page)
                active_context = try_extension_message(dashboard_page, "GET_ACTIVE_CONTEXT", None)
                debug_snapshot = try_extension_message(dashboard_page, "GET_DEBUG_SNAPSHOT", None)
                scan_result = try_extension_message(dashboard_page, "SCAN_ACTIVE_SITE", None)

                timestamp = int(time.time())
                site_name = pathlib.Path(url.split("://", 1)[-1].replace("/", "_")).name or "site"
                prefix = f"{site_name}-{timestamp}"

                site_page.screenshot(path=str(ARTIFACTS_DIR / f"{prefix}-site.png"), full_page=True)
                popup_page.screenshot(path=str(ARTIFACTS_DIR / f"{prefix}-popup.png"), full_page=True)
                dashboard_page.screenshot(path=str(ARTIFACTS_DIR / f"{prefix}-dashboard.png"), full_page=True)

                report = {
                    "requestedUrl": url,
                    "extensionId": extension_id,
                    "siteSnapshot": site_snapshot,
                    "activeContext": active_context,
                    "debugSnapshot": debug_snapshot,
                    "scanResult": scan_result,
                }
                report_path = ARTIFACTS_DIR / f"{prefix}-report.json"
                write_json(report_path, report)

                print("Real-site probe completed")
                print(f"URL: {url}")
                print(f"Extension ID: {extension_id}")
                print(f"Report: {report_path}")
                print(f"Artifacts: {ARTIFACTS_DIR}")
            finally:
                context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe a real site with the StorageDump extension in Playwright Chromium.")
    parser.add_argument("--url", default="https://eksisozluk.com/", help="Target site to open.")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window.")
    parser.add_argument(
        "--settle-seconds",
        type=int,
        default=15,
        help="Seconds to keep the site open before collecting diagnostics so you can log in or interact manually.",
    )
    args = parser.parse_args()
    run_probe(url=args.url, headed=not args.headless, settle_seconds=max(args.settle_seconds, 0))


if __name__ == "__main__":
    main()
