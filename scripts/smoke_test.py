#!/usr/bin/env python3
"""Smoke test for LifeOps.

Boots the image in a container with a per-run data volume, polls
HEALTH_PATH until it responds, tears down (container + volume).
Exit 0 on success, non-zero on failure.

Usage:
    ./scripts/smoke_test.py [IMAGE] [TRIES]

Environment:
    PORT    host port to bind              (default 7070)
    CPORT   port the app listens on inside (default 7070)
"""
from __future__ import annotations

import http.client
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

IMAGE = sys.argv[1] if len(sys.argv) > 1 else "lifeops:prod"
TRIES = sys.argv[2] if len(sys.argv) > 2 else "5"
PORT = os.environ.get("PORT", "7070")
CPORT = os.environ.get("CPORT", "7070")
BASE = f"http://127.0.0.1:{PORT}"

NAME = "lo-smoke"
VOLUME = f"{NAME}-{secrets.token_hex(4)}"
HEALTH_PATH = "/api/tasks"


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True)


def fail(msg: str, *, tail_logs: bool = False):
    print(f"FAILURE: {msg}", file=sys.stderr)
    if tail_logs:
        r = run("docker", "logs", NAME)
        out = (r.stdout + r.stderr).splitlines()
        print("\n".join(out[-30:]), file=sys.stderr)
    sys.exit(1)


def cleanup() -> None:
    had_container = run("docker", "rm", "-f", NAME).returncode == 0
    had_volume = run("docker", "volume", "rm", VOLUME).returncode == 0
    if had_container or had_volume:
        print("Cleaning up... DONE!")


def container_running() -> bool:
    r = run("docker", "inspect", "-f", "{{.State.Running}}", NAME)
    return r.returncode == 0 and r.stdout.strip() == "true"


def url_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except (OSError, http.client.HTTPException):
        return False


def print_config() -> None:
    rows = [
        ("IMAGE", IMAGE),
        ("NAME", NAME),
        ("VOLUME", VOLUME),
        ("PORT", PORT),
        ("CPORT", CPORT),
        ("BASE", BASE),
        ("HEALTH_PATH", HEALTH_PATH),
        ("TRIES", TRIES),
    ]
    width = max(len(k) for k, _ in rows)
    print("--- config ---")
    for k, v in rows:
        print(f"  {k:<{width}}  {v}")
    print("--------------")


def main() -> int:
    print_config()

    if not (TRIES.isascii() and TRIES.isdigit()) or int(TRIES) == 0:
        fail(f"TRIES must be a positive integer (got {TRIES!r})")
    if not (PORT.isascii() and PORT.isdigit()):
        fail(f"PORT must be a number (got {PORT!r})")
    tries = int(TRIES)

    if run("docker", "image", "inspect", "--", IMAGE).returncode != 0:
        fail(f"image {IMAGE!r} not found")

    run("docker", "rm", "-f", NAME)  # stale container from prior interrupted run

    r = run(
        "docker", "run", "-d",
        "--name", NAME,
        "-v", f"{VOLUME}:/data",
        "-p", f"127.0.0.1:{PORT}:{CPORT}",
        IMAGE,
    )
    if r.returncode != 0:
        fail(f"docker run failed: {r.stderr.strip()}")

    print(f"Booted on 127.0.0.1:{PORT} -> container:{CPORT}")

    for i in range(1, tries + 1):
        time.sleep(1)
        if not container_running():
            fail(f"container exited (attempt {i})", tail_logs=True)
        if url_ok(f"{BASE}{HEALTH_PATH}"):
            print(f"Attempt #{i}: SUCCESS!")
            return 0

    fail(f"server not ready (total attempts: {tries})", tail_logs=True)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        cleanup()
