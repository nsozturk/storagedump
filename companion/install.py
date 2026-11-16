#!/usr/bin/env python3
"""Install (or remove) the StorageDump companion for Chrome on macOS or Linux.

    python3 companion/install.py                 # install
    python3 companion/install.py --uninstall
    python3 companion/install.py --extension-id <id>   # also allow an unpacked build

Copies the host to ~/.storagedump/ and registers it with Chrome through a
Native Messaging manifest that names the StorageDump extension as the only
caller. Then turn on "Local companion" in StorageDump's dashboard settings.
"""
import argparse
import json
import os
import shutil
import stat
import sys

NAME = "dev.lamma.storagedump"
STORE_EXTENSION_ID = "kihoghfekemdccfnpjefmggehpgnjnab"
HOME = os.environ.get("STORAGEDUMP_HOME") or os.path.expanduser("~/.storagedump")
HERE = os.path.dirname(os.path.abspath(__file__))


def manifest_dirs():
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
        return [os.path.join(base, browser, "NativeMessagingHosts")
                for browser in ("Google/Chrome", "Google/Chrome for Testing", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge")]
    if sys.platform.startswith("linux"):
        base = os.path.expanduser("~/.config")
        return [os.path.join(base, browser, "NativeMessagingHosts")
                for browser in ("google-chrome", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge")]
    sys.exit("The companion supports macOS and Linux only.")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--extension-id", action="append", default=[], help="extra extension id (unpacked build)")
    args = parser.parse_args()

    # Only browsers that are installed (their profile folder exists)
    targets = [d for d in manifest_dirs() if os.path.isdir(os.path.dirname(d))]
    if args.uninstall:
        for directory in targets:
            try:
                os.unlink(os.path.join(directory, f"{NAME}.json"))
                print("removed", os.path.join(directory, f"{NAME}.json"))
            except FileNotFoundError:
                pass
        print(f"Dumps and the host stay in {HOME}; delete that folder yourself if you no longer want them.")
        return

    os.makedirs(HOME, mode=0o700, exist_ok=True)
    host = os.path.join(HOME, "storagedump_host.py")
    shutil.copyfile(os.path.join(HERE, "storagedump_host.py"), host)
    os.chmod(host, stat.S_IRWXU)
    shutil.copyfile(os.path.join(HERE, "storagedump_client.py"), os.path.join(HOME, "storagedump_client.py"))

    manifest = {
        "name": NAME,
        "description": "StorageDump local companion",
        "path": host,
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{i}/" for i in [STORE_EXTENSION_ID, *args.extension_id]],
    }
    for directory in targets:
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{NAME}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2)
        print("registered", path)
    if not targets:
        sys.exit("No supported browser profile folder was found.")
    print(f"\nDone. In StorageDump open Dashboard > Settings and turn on \"Local companion\".\n"
          f"Then:  python3 {os.path.join(HOME, 'storagedump_client.py')} --ping")


if __name__ == "__main__":
    main()
