"""Keeps the code on your Mac up to date by itself, so fixes arrive without you doing anything.

Once a day, outside the sending hours, the hourly job downloads the latest version from GitHub,
installs any new packages and runs the tests. If a test fails it goes straight back to the
version that was working and tells you. Your .env, leads, database and reports are never touched.
"""
from __future__ import annotations

import os
import subprocess
import sys
from typing import List

from . import clock, config, db, launchd

BRANCH = "main"


def _repo():
    return config.ROOT.parent


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(_repo()), *args], capture_output=True, text=True, timeout=120)


def _run(cmd: List[str], timeout: int = 900) -> subprocess.CompletedProcess:
    env = dict(os.environ, OUTREACH_NO_NOTIFY="1", OUTREACH_NO_UPDATE="1")
    return subprocess.run(cmd, cwd=str(config.ROOT), capture_output=True, text=True, timeout=timeout, env=env)


def available() -> bool:
    return (_repo() / ".git").exists() and not os.environ.get("OUTREACH_NO_UPDATE")


def due(con) -> bool:
    """Once a day, and never while emails are going out (weekdays 8:30 to 16:00 Dubai)."""
    if not available():
        return False
    now = clock.now()
    if now.weekday() < 5 and clock.at(now.date(), 8, 30) <= now < clock.at(now.date(), 16):
        return False
    return db.get_state(con, "updated_on") != now.date().isoformat()


def update(con, log=print) -> str:
    if not available():
        return "Automatic updates only work in the folder the one line setup made."
    old = _git("rev-parse", "HEAD").stdout.strip()
    fetch = _git("fetch", "--quiet", "--depth", "1", "origin", BRANCH)
    db.set_state(con, "updated_on", clock.today().isoformat())
    if fetch.returncode != 0:
        return "Couldn't check for updates (no internet?). Trying again tomorrow."
    new = _git("rev-parse", "FETCH_HEAD").stdout.strip()
    if not new or new == old:
        return "Already up to date."
    _git("reset", "--quiet", "--hard", new)  # code only: .env, leads, data and reports are not in git
    pip = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check"]
    _run(pip + ["-r", "requirements.txt"])
    _run(pip + ["pytest"])
    tests = _run([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"])
    if tests.returncode != 0:
        _git("reset", "--quiet", "--hard", old)
        _run(pip + ["-r", "requirements.txt"])
        tail = (tests.stdout or tests.stderr).strip().splitlines()[-1:] or [""]
        db.log_event(con, "update_failed", "%s -> %s: %s" % (old[:7], new[:7], tail[0]))
        launchd.notify("RizcoReach: update skipped", "A new version failed its tests, so the working version was kept.")
        return "A new version failed its tests, so the working version was kept (%s)." % tail[0]
    if launchd.IS_MAC:
        launchd.install()  # refresh the job files in case they changed
    db.log_event(con, "updated", "%s -> %s" % (old[:7], new[:7]))
    return "Updated to the latest version (%s)." % new[:7]
