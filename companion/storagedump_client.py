#!/usr/bin/env python3
"""Ask the StorageDump companion for a fresh export of a site open in Chrome.

    from storagedump_client import dump, cookie_header
    folder = dump("app.example.com")            # ~/.storagedump/dumps/app.example.com
    headers = {"Cookie": cookie_header("app.example.com")}

    python3 storagedump_client.py app.example.com        # prints the folder

Needs: Chrome running, the site open in a tab, StorageDump's "Local companion"
setting on, and companion/install.py run once. Standard library only.
The returned files are live session data: never print, log or commit them.
"""
import json
import os
import socket
import sys

HOME = os.environ.get("STORAGEDUMP_HOME") or os.path.expanduser("~/.storagedump")


class CompanionError(RuntimeError):
    pass


def request(payload, timeout=200):
    path = os.path.join(HOME, "companion.sock")
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(timeout)
    try:
        client.connect(path)
    except OSError as error:
        raise CompanionError(
            "StorageDump companion is not running. Open Chrome, turn on \"Local companion\" in "
            "StorageDump's settings and run companion/install.py once.") from error
    with client:
        client.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        reply = json.loads(client.makefile("r", encoding="utf-8").readline() or "{}")
    if not reply.get("ok"):
        raise CompanionError(reply.get("error", "The companion returned no answer."))
    return reply


def dump(host, categories=None):
    """Export `host` (as in the address bar, e.g. "app.example.com") and return the folder path."""
    reply = request({"op": "dump", "host": host, "categories": categories or []})
    if reply.get("problemCount"):
        print(f"storagedump: {reply['problemCount']} problem(s), see export-report.json", file=sys.stderr)
    return reply["dir"]


def cookie_header(host, fresh=True):
    """Cookie header for the site root; `fresh=False` reuses the last dump."""
    folder = dump(host, ["cookies"]) if fresh else os.path.join(HOME, "dumps", host)
    with open(os.path.join(folder, "for-scripts", "cookie-header.txt"), encoding="utf-8") as handle:
        return handle.read().strip()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: storagedump_client.py <host> [category ...]   |   storagedump_client.py --ping")
    try:
        if sys.argv[1] == "--ping":
            print("StorageDump", request({"op": "ping"}, timeout=10)["version"])
        else:
            print(dump(sys.argv[1], sys.argv[2:]))
    except CompanionError as error:
        sys.exit(f"error: {error}")
