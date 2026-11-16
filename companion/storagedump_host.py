#!/usr/bin/env python3
"""StorageDump local companion: the Native Messaging host.

Chrome starts this program when the StorageDump extension connects (setting
"Local companion" on). It listens on a Unix socket that only your user can
open and relays requests from local scripts to the extension:

    script --socket--> this host --stdout--> extension
    script <--socket-- this host <--stdin--- extension (files, then "done")

A dump lands in  <home>/dumps/<host>/  where <home> is $STORAGEDUMP_HOME or
~/.storagedump. Files there are live session data: treat them as passwords.
Python standard library only. macOS and Linux.
"""
import json
import os
import shutil
import socket
import struct
import sys
import threading
import uuid

HOME = os.environ.get("STORAGEDUMP_HOME") or os.path.expanduser("~/.storagedump")
SOCKET_PATH = os.path.join(HOME, "companion.sock")
DUMPS = os.path.join(HOME, "dumps")
REQUEST_TIMEOUT_S = 180

_stdout_lock = threading.Lock()
_pending = {}  # request id -> {"event", "result", "dir", "files"}
_pending_lock = threading.Lock()


def send_to_extension(message):
    data = json.dumps(message).encode("utf-8")
    with _stdout_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()


def read_from_extension():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None  # Chrome closed the pipe: the extension disconnected
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def safe_host(host):
    return "".join(c if c.isalnum() or c in ".-" else "_" for c in host)


def handle_extension_message(message):
    with _pending_lock:
        entry = _pending.get(message.get("id"))
    if entry is None:
        return
    if "file" in message:
        # Paths come from the extension; still refuse anything outside the dump folder.
        target = os.path.normpath(os.path.join(entry["dir"], message["file"]))
        if not target.startswith(entry["dir"] + os.sep):
            return
        os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
        handle = entry["files"].get(target)
        if handle is None:
            handle = entry["files"][target] = os.fdopen(
                os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8")
        handle.write(message.get("data", ""))
        if message.get("last"):
            handle.close()
            del entry["files"][target]
        return
    entry["result"] = message
    entry["event"].set()


def serve_client(connection):
    with connection:
        try:
            request = json.loads(connection.makefile("r", encoding="utf-8").readline() or "{}")
        except ValueError:
            request = {}
        request_id = uuid.uuid4().hex
        host = str(request.get("host", ""))
        final_dir = os.path.join(DUMPS, safe_host(host)) if host else None
        work_dir = f"{final_dir}.part-{request_id}" if final_dir else os.path.join(DUMPS, f".ping-{request_id}")
        entry = {"event": threading.Event(), "result": None, "dir": work_dir, "files": {}}
        with _pending_lock:
            _pending[request_id] = entry
        try:
            send_to_extension({**request, "id": request_id})
            if not entry["event"].wait(REQUEST_TIMEOUT_S):
                reply = {"ok": False, "error": "The extension did not answer in time."}
            else:
                reply = dict(entry["result"])
                reply.pop("id", None)
                if reply.get("ok") and reply.get("done") and final_dir:
                    # Replace the previous dump only once the new one is complete
                    shutil.rmtree(final_dir, ignore_errors=True)
                    os.replace(work_dir, final_dir)
                    reply["dir"] = final_dir
        finally:
            with _pending_lock:
                _pending.pop(request_id, None)
            for handle in entry["files"].values():
                handle.close()
            shutil.rmtree(work_dir, ignore_errors=True)
        try:
            connection.sendall((json.dumps(reply) + "\n").encode("utf-8"))
        except OSError:
            pass  # the script went away


def socket_server():
    os.makedirs(DUMPS, mode=0o700, exist_ok=True)
    os.chmod(HOME, 0o700)
    try:
        os.unlink(SOCKET_PATH)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old_umask = os.umask(0o177)  # socket readable and writable by the owner only
    try:
        server.bind(SOCKET_PATH)
    finally:
        os.umask(old_umask)
    server.listen(8)
    while True:
        connection, _ = server.accept()
        threading.Thread(target=serve_client, args=(connection,), daemon=True).start()


def main():
    threading.Thread(target=socket_server, daemon=True).start()
    try:
        while True:
            message = read_from_extension()
            if message is None:
                break
            handle_extension_message(message)
    finally:
        try:
            os.unlink(SOCKET_PATH)
        except OSError:
            pass


if __name__ == "__main__":
    main()
