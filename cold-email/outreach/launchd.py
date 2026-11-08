"""The Mac side: two background jobs, notifications, and waking the Mac up.

Job 1  ae.rizcoreach.coldemail        rizco send   Monday to Friday at 9:00 Dubai time
Job 2  ae.rizcoreach.coldemail.hourly rizco auto   every hour: new lead files, replies, report
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Tuple

from . import clock, config

LABEL = "ae.rizcoreach.coldemail"
HOURLY_LABEL = "ae.rizcoreach.coldemail.hourly"
IS_MAC = platform.system() == "Darwin"


def plist_path(label: str = LABEL) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / ("%s.plist" % label)


def _dubai_time_here(hour: int, minute: int) -> Tuple[int, int, int, bool]:
    """(hour, minute, day shift, other zone) of a Dubai clock time in this Mac's own time zone."""
    dubai = datetime.now(clock.TZ).replace(hour=hour, minute=minute, second=0, microsecond=0)
    local = dubai.astimezone()
    return local.hour, local.minute, (local.date() - dubai.date()).days, local.utcoffset() != dubai.utcoffset()


def local_start_time():
    """9:00 Dubai time in this Mac's own time zone (launchd uses the Mac's clock)."""
    h, m, _, other = _dubai_time_here(9, 0)
    return h, m, other


def day_shift() -> int:
    """-1 when 9:00 Monday in Dubai is still Sunday on this Mac (far west time zones), +1 the other way."""
    return _dubai_time_here(9, 0)[2]


def _program(python: str, root: Path, command: str, keep_awake: bool) -> str:
    args = (["/usr/bin/caffeinate", "-i"] if keep_awake else []) + [python, str(root / "run.py"), command]
    return "\n".join("        <string>%s</string>" % a for a in args)


def _plist(label: str, program: str, root: Path, schedule: str, log: str) -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
{program}
    </array>
    <key>WorkingDirectory</key>
    <string>{root}</string>
{schedule}
    <key>StandardOutPath</key>
    <string>{root}/logs/{log}</string>
    <key>StandardErrorPath</key>
    <string>{root}/logs/{log}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PYTHONUNBUFFERED</key>
        <string>1</string>
    </dict>
</dict>
</plist>
""".format(label=label, program=program, root=root, schedule=schedule, log=log)


def plist(python: str = "", root: Path = None, hour: int = None, minute: int = None) -> str:
    """The 9:00 send job. caffeinate keeps the Mac awake while it sends."""
    if hour is None or minute is None:
        hour, minute, _ = local_start_time()
    python = python or sys.executable
    root = Path(root or config.ROOT)
    days = "\n".join(
        "        <dict><key>Weekday</key><integer>%d</integer><key>Hour</key><integer>%d</integer>"
        "<key>Minute</key><integer>%d</integer></dict>" % (d, hour, minute)
        for d in sorted(((d + day_shift()) % 7) for d in range(1, 6))
    )
    schedule = ("    <!-- 9:00 Dubai time on Monday to Friday, written in your Mac's own clock: %02d:%02d -->\n"
                "    <key>StartCalendarInterval</key>\n    <array>\n%s\n    </array>" % (hour, minute, days))
    return _plist(LABEL, _program(python, root, "send", True), root, schedule, "send.log")


def hourly_plist(python: str = "", root: Path = None) -> str:
    """Every hour: imports new lead files, checks replies, writes the report, notifies you."""
    python = python or sys.executable
    root = Path(root or config.ROOT)
    schedule = "    <key>StartInterval</key>\n    <integer>3600</integer>\n    <key>RunAtLoad</key>\n    <true/>"
    return _plist(HOURLY_LABEL, _program(python, root, "auto", False), root, schedule, "hourly.log")


def warnings() -> List[str]:
    out = []
    home = Path.home()
    root = Path(config.ROOT).resolve()
    for protected in ("Documents", "Desktop", "Downloads", "Library/Mobile Documents"):
        try:
            root.relative_to(home / protected)
            out.append(
                "This folder is inside ~/%s. macOS blocks background jobs from reading that folder. Run the "
                "one line setup from the README instead: it puts everything in ~/RizcoReach-Outreach." % protected
            )
        except ValueError:
            pass
    if ".venv" not in sys.executable and "venv" not in sys.executable:
        out.append("You are not running the project's own Python (.venv). Use the one line setup from the README.")
    return out


def _launchctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def _load(label: str, text: str) -> str:
    path = plist_path(label)
    path.parent.mkdir(parents=True, exist_ok=True)
    uid = str(os.getuid())
    _launchctl("bootout", "gui/%s/%s" % (uid, label))  # remove an older copy first, if any
    path.write_text(text, encoding="utf-8")
    r = _launchctl("bootstrap", "gui/%s" % uid, str(path))
    if r.returncode != 0:
        r = _launchctl("load", "-w", str(path))
    return "" if r.returncode == 0 else (r.stderr or r.stdout).strip()


def install() -> str:
    if not IS_MAC:
        return "This only works on a Mac. Here is the job file so you can see it:\n\n" + plist()
    config.logs_dir().mkdir(parents=True, exist_ok=True)
    problems = [p for p in (_load(LABEL, plist()), _load(HOURLY_LABEL, hourly_plist())) if p]
    if problems:
        return "The jobs could not be loaded: " + "; ".join(problems)
    hour, minute, other_zone = local_start_time()
    note = ""
    if other_zone:
        note = ("\nYour Mac is not on Dubai time, so the job is set to %02d:%02d your time, which is 9:00 in Dubai. "
                "If you change time zone, run the setup again." % (hour, minute))
    return ("Installed. Monday to Friday at 9:00 Dubai time your Mac sends the day's emails, and every hour it picks up "
            "new lead files and checks replies.%s\nLogs: %s" % (note, config.logs_dir()))


def uninstall() -> str:
    if not IS_MAC:
        return "This only works on a Mac."
    for label in (LABEL, HOURLY_LABEL):
        _launchctl("bootout", "gui/%s/%s" % (os.getuid(), label))
        _launchctl("unload", str(plist_path(label)))
        if plist_path(label).exists():
            plist_path(label).unlink()
    return "Removed. Nothing runs by itself any more."


def status() -> str:
    if not IS_MAC:
        return "Not a Mac."
    r = _launchctl("print", "gui/%s/%s" % (os.getuid(), LABEL))
    if r.returncode != 0:
        return "Not installed. Run the setup again (README)."
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith(("state", "last exit code", "runs"))]
    return "Installed (%s).\n%s" % (plist_path(), "\n".join(lines))


def start_now() -> bool:
    """Runs the send job right away (it still only sends inside the Dubai windows)."""
    if not IS_MAC:
        return False
    return _launchctl("kickstart", "gui/%s/%s" % (os.getuid(), LABEL)).returncode == 0


def wake_command() -> List[str]:
    """pmset command that wakes the Mac at 8:55 Dubai time on weekdays."""
    hour, minute, shift, _ = _dubai_time_here(8, 55)
    letters = "MTWRFSU"  # Monday ... Sunday
    days = "".join(letters[(d + shift) % 7] for d in range(5))
    days = "".join(l for l in letters if l in days)
    return ["sudo", "pmset", "repeat", "wakeorpoweron", days, "%02d:%02d:00" % (hour, minute)]


def notify(title: str, message: str) -> None:
    """A Mac notification in the top right corner. Does nothing elsewhere."""
    if not IS_MAC or os.environ.get("OUTREACH_NO_NOTIFY"):
        return
    script = "display notification %s with title %s" % (json.dumps(message, ensure_ascii=False), json.dumps(title, ensure_ascii=False))
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=10)
    except Exception:  # noqa: BLE001 - a missed notification is not worth failing over
        pass
