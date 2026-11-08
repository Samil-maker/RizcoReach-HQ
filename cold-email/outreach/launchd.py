"""The macOS launchd job that runs  python run.py send  at 9:00 Monday to Friday."""
from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import List

from . import config

LABEL = "ae.rizcoreach.coldemail"


def plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / ("%s.plist" % LABEL)


def local_start_time():
    """9:00 Dubai time in this Mac's own time zone (launchd uses the Mac's clock)."""
    from datetime import datetime

    from . import clock

    dubai_nine = datetime.now(clock.TZ).replace(hour=9, minute=0, second=0, microsecond=0)
    local = dubai_nine.astimezone()
    return local.hour, local.minute, local.utcoffset() != dubai_nine.utcoffset()


def day_shift() -> int:
    """-1 when 9:00 Monday in Dubai is still Sunday on this Mac (far west time zones), +1 the other way."""
    from datetime import datetime

    from . import clock

    dubai_nine = datetime.now(clock.TZ).replace(hour=9, minute=0, second=0, microsecond=0)
    return (dubai_nine.astimezone().date() - dubai_nine.date()).days


def plist(python: str = "", root: Path = None, hour: int = None, minute: int = None) -> str:
    if hour is None or minute is None:
        hour, minute, _ = local_start_time()
    python = python or sys.executable
    root = Path(root or config.ROOT)
    logs = root / "logs"
    days = "\n".join(
        "        <dict><key>Weekday</key><integer>%d</integer><key>Hour</key><integer>%d</integer>"
        "<key>Minute</key><integer>%d</integer></dict>" % (d, hour, minute)
        for d in sorted(((d + day_shift()) % 7) for d in range(1, 6))
    )
    return """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <!-- caffeinate -i keeps the Mac from falling asleep while the send runs -->
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-i</string>
        <string>{python}</string>
        <string>{root}/run.py</string>
        <string>send</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{root}</string>
    <!-- 9:00 Dubai time on Monday to Friday, written in your Mac's own clock: {hour:02d}:{minute:02d} -->
    <key>StartCalendarInterval</key>
    <array>
{days}
    </array>
    <key>StandardOutPath</key>
    <string>{logs}/send.log</string>
    <key>StandardErrorPath</key>
    <string>{logs}/send.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PYTHONUNBUFFERED</key>
        <string>1</string>
    </dict>
</dict>
</plist>
""".format(label=LABEL, python=python, root=root, logs=logs, days=days, hour=hour, minute=minute)


def warnings() -> List[str]:
    out = []
    home = Path.home()
    root = Path(config.ROOT).resolve()
    for protected in ("Documents", "Desktop", "Downloads", "Library/Mobile Documents"):
        try:
            root.relative_to(home / protected)
            out.append(
                "This folder is inside ~/%s. macOS blocks background jobs from reading that folder unless you give "
                "Python Full Disk Access. Easiest fix: move the RizcoReach-HQ folder straight into your home folder "
                "(%s), then run this again." % (protected, home)
            )
        except ValueError:
            pass
    if ".venv" not in sys.executable and "venv" not in sys.executable:
        out.append("You are not running the virtual environment's Python. Run  source .venv/bin/activate  first, "
                   "so the job uses the Python that has the packages installed.")
    return out


def _launchctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def install() -> str:
    if platform.system() != "Darwin":
        return "This only works on a Mac. Here is the job file so you can see it:\n\n" + plist()
    config.logs_dir().mkdir(parents=True, exist_ok=True)
    path = plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    uid = str(os.getuid())
    _launchctl("bootout", "gui/%s/%s" % (uid, LABEL))  # remove an older copy first, if any
    path.write_text(plist(), encoding="utf-8")
    r = _launchctl("bootstrap", "gui/%s" % uid, str(path))
    if r.returncode != 0:
        r = _launchctl("load", "-w", str(path))
    if r.returncode != 0:
        return "Wrote %s but launchctl said: %s" % (path, (r.stderr or r.stdout).strip())
    hour, minute, other_zone = local_start_time()
    note = ""
    if other_zone:
        note = ("\nYour Mac is not on Dubai time, so the job is set to %02d:%02d your time, which is 9:00 in Dubai. "
                "If you change time zone, run  python run.py launchd install  again." % (hour, minute))
    return "Installed. Every Monday to Friday at 9:00 Dubai time your Mac runs the send by itself.%s\nJob file: %s\nLog: %s" % (
        note, path, config.logs_dir() / "send.log")


def uninstall() -> str:
    if platform.system() != "Darwin":
        return "This only works on a Mac."
    _launchctl("bootout", "gui/%s/%s" % (os.getuid(), LABEL))
    _launchctl("unload", str(plist_path()))
    if plist_path().exists():
        plist_path().unlink()
    return "Removed. Nothing runs by itself any more."


def status() -> str:
    if platform.system() != "Darwin":
        return "Not a Mac."
    r = _launchctl("print", "gui/%s/%s" % (os.getuid(), LABEL))
    if r.returncode != 0:
        return "Not installed. Run:  python run.py launchd install"
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith(("state", "last exit code", "runs"))]
    return "Installed (%s).\n%s" % (plist_path(), "\n".join(lines))
