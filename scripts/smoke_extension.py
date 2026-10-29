#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import http.server
import os
import pathlib
import socketserver
import tempfile
import threading
import time
from urllib.request import urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"
SCREENSHOT_DIR = ROOT / "tmp-smoke-artifacts"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return


@contextlib.contextmanager
def fixture_server():
    previous_cwd = os.getcwd()
    os.chdir(ROOT)
    try:
        with socketserver.TCPServer(("127.0.0.1", 0), QuietHandler) as httpd:
            port = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                yield port
            finally:
                httpd.shutdown()
                thread.join(timeout=3)
    finally:
        os.chdir(previous_cwd)


def require_build() -> None:
    if not DIST_DIR.exists():
        raise SystemExit("dist/ not found. Run `npm run build` first.")
    SCREENSHOT_DIR.mkdir(exist_ok=True)


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


def screenshot_path(name: str) -> pathlib.Path:
    return SCREENSHOT_DIR / f"{name}.png"


def assert_contains(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise RuntimeError(f"Missing expected text for {label}: {needle}")


def smoke_popup(context, extension_id: str, fixture_host: str) -> None:
    popup = context.new_page()
    popup.goto(f"chrome-extension://{extension_id}/popup.html", wait_until="domcontentloaded")
    popup.get_by_role("button", name="Scan").click()
    popup.wait_for_timeout(2200)
    popup.wait_for_selector("text=Storage categories")
    popup_text = popup.locator("body").text_content() or ""
    if "Cannot access contents of url" in popup_text:
        popup.screenshot(path=str(screenshot_path("popup-permission-blocked")), full_page=True)
        raise RuntimeError(
            "Extension UI smoke test is blocked by Chrome site-access permissions. "
            "Grant the unpacked extension access to the fixture host and rerun."
        )
    popup.wait_for_selector("text=Local Storage")
    popup.wait_for_selector("text=IndexedDB")
    popup.wait_for_selector("text=Cache Storage")
    popup.wait_for_selector("text=Extension Storage")

    assert_contains(popup_text, "StorageDump", "popup title")
    assert_contains(popup_text, "Local Storage", "popup local storage")
    assert_contains(popup_text, "IndexedDB", "popup indexeddb")
    assert_contains(popup_text, "Cache Storage", "popup cache storage")
    popup.screenshot(path=str(screenshot_path("popup")), full_page=True)
    popup.close()


def smoke_dashboard(context, extension_id: str, fixture_host: str) -> None:
    dashboard = context.new_page()
    dashboard.goto(f"chrome-extension://{extension_id}/dashboard.html", wait_until="domcontentloaded")
    dashboard.get_by_role("button", name="Refresh").click()
    dashboard.wait_for_timeout(2200)
    dashboard.wait_for_selector("text=Storage health")
    dashboard.wait_for_selector("text=Local Storage")
    dashboard.wait_for_selector("text=Session Storage")
    dashboard.wait_for_selector("text=IndexedDB")
    dashboard.wait_for_selector("text=Cache Storage")
    dashboard.wait_for_selector("text=Service Workers")
    dashboard.wait_for_selector("text=Extension Storage")

    body_text = dashboard.locator("body").text_content() or ""
    assert_contains(body_text, fixture_host, "dashboard origin")
    assert_contains(body_text, "Local Storage", "dashboard local storage")
    assert_contains(body_text, "IndexedDB", "dashboard indexeddb")
    assert_contains(body_text, "Cache Storage", "dashboard cache storage")

    dashboard.get_by_role("button", name="IndexedDB").click()
    dashboard.wait_for_timeout(1000)
    dashboard.wait_for_selector("text=FixtureDB.profiles")
    dashboard.get_by_role("button", name="FixtureDB.profiles").click()
    dashboard.wait_for_timeout(1000)
    dashboard.wait_for_selector("text=user_1")
    dashboard.wait_for_selector("text=user_2")

    dashboard.screenshot(path=str(screenshot_path("dashboard")), full_page=True)
    dashboard.close()


def run_smoke_test(headed: bool) -> None:
    require_build()
    with fixture_server() as port, tempfile.TemporaryDirectory(prefix="storagedump-profile-") as profile_dir:
        fixture_url = f"http://127.0.0.1:{port}/tests/fixture-site/index.html"
        fixture_host = f"127.0.0.1:{port}"
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
                page = context.new_page()
                page.goto(fixture_url, wait_until="networkidle")
                page.wait_for_selector("#status")
                status_text = page.locator("#status").text_content() or ""
                if "Fixture ready" not in status_text:
                    raise RuntimeError(f"Fixture failed to seed storage: {status_text}")

                with urlopen(f"http://127.0.0.1:{port}/tests/fixture-site/cached.json") as response:
                    response.read()

                extension_id = resolve_extension_id(context)
                smoke_popup(context, extension_id, fixture_host)
                smoke_dashboard(context, extension_id, fixture_host)
                print("Smoke test passed")
                print(f"Fixture URL: {fixture_url}")
                print(f"Extension ID: {extension_id}")
                print(f"Artifacts: {SCREENSHOT_DIR}")
            except PlaywrightTimeoutError as error:
                if context.pages:
                    context.pages[-1].screenshot(path=str(screenshot_path("failure-timeout")), full_page=True)
                raise RuntimeError(f"Timed out while waiting for dashboard state: {error}") from error
            except Exception:
                if context.pages:
                    context.pages[-1].screenshot(path=str(screenshot_path("failure-generic")), full_page=True)
                raise
            finally:
                context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a live-browser smoke test for the StorageDump extension.")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window.")
    args = parser.parse_args()
    run_smoke_test(headed=not args.headless)


if __name__ == "__main__":
    main()
