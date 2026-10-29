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

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"
INPAGE_BUNDLE = DIST_DIR / "assets" / "inpage.js"
ARTIFACTS_DIR = ROOT / "tmp-smoke-artifacts"


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


def require_artifacts() -> None:
    if not INPAGE_BUNDLE.exists():
        raise SystemExit("dist/assets/inpage.js not found. Run `npm run build` first.")
    ARTIFACTS_DIR.mkdir(exist_ok=True)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run_test(headed: bool) -> None:
    require_artifacts()
    with fixture_server() as port:
        fixture_url = f"http://127.0.0.1:{port}/tests/fixture-site/index.html"
        bundle_url = f"http://127.0.0.1:{port}/dist/assets/inpage.js"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=not headed)
            page = browser.new_page()
            try:
                page.goto(fixture_url, wait_until="networkidle")
                page.wait_for_selector("#status")
                status_text = page.locator("#status").text_content() or ""
                assert_true("Fixture ready" in status_text, f"Fixture did not initialize correctly: {status_text}")

                page.add_script_tag(url=bundle_url, type="module")
                page.wait_for_function("() => Boolean(window.__storageDumpBridge)")

                scan = page.evaluate("() => window.__storageDumpBridge.scan()")
                categories = {category["id"]: category for category in scan["categories"]}

                required_ids = ["local", "session", "indexeddb", "cache", "serviceWorkers"]
                for category_id in required_ids:
                    assert_true(category_id in categories, f"Missing category in scan: {category_id}")

                assert_true(categories["local"]["itemCount"] >= 1, "Expected at least one Local Storage entry.")
                assert_true(categories["session"]["itemCount"] >= 1, "Expected at least one Session Storage entry.")
                assert_true(categories["indexeddb"]["detected"] is True, "IndexedDB should be detected.")
                assert_true(categories["cache"]["detected"] is True, "Cache Storage should be detected.")

                indexeddb_tree = page.evaluate("() => window.__storageDumpBridge.inspect('indexeddb')")
                store_entry = next(
                    (entry for entry in indexeddb_tree["entries"] if entry["key"] == "FixtureDB.profiles"),
                    None,
                )
                assert_true(store_entry is not None, "FixtureDB.profiles object store was not listed.")

                indexeddb_rows = page.evaluate(
                    """
                    () => window.__storageDumpBridge.inspect('indexeddb', {
                      dbName: 'FixtureDB',
                      storeName: 'profiles'
                    })
                    """
                )
                keys = [entry["key"] for entry in indexeddb_rows["entries"]]
                assert_true("user_1" in keys and "user_2" in keys, "IndexedDB fixture rows are missing.")

                page.evaluate(
                    """
                    () => window.__storageDumpBridge.mutate('local', {
                      type: 'update',
                      key: 'fixture:local:mutated',
                      value: { ok: true, from: 'playwright' }
                    })
                    """
                )
                local_after_mutation = page.evaluate("() => window.__storageDumpBridge.inspect('local')")
                mutated = next(
                    (entry for entry in local_after_mutation["entries"] if entry["key"] == 'fixture:local:mutated'),
                    None,
                )
                assert_true(mutated is not None, "Local Storage mutation did not persist.")

                screenshot = ARTIFACTS_DIR / "inpage-runtime.png"
                page.screenshot(path=str(screenshot), full_page=True)
                print("In-page runtime smoke test passed")
                print(f"Fixture URL: {fixture_url}")
                print(f"Screenshot: {screenshot}")
            finally:
                browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a live-browser smoke test for the compiled in-page runtime.")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window.")
    args = parser.parse_args()
    run_test(headed=not args.headless)


if __name__ == "__main__":
    main()
