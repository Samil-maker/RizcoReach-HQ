"""suppression.csv: people who are never emailed again.

One row per address. A row can also be a whole domain written as @domain.com.
You can add rows by hand in any spreadsheet app. Keep the header row: email,reason,date
"""
from __future__ import annotations

import csv
from typing import Set

from . import clock, config, db

HEADER = ["email", "reason", "date"]


def load() -> Set[str]:
    path = config.suppression_csv()
    if not path.exists():
        return set()
    out = set()
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row:
                continue
            value = row[0].strip().lower()
            if value and value != "email":
                out.add(value)
    return out


def is_suppressed(email: str, entries: Set[str]) -> bool:
    email = (email or "").strip().lower()
    return email in entries or ("@" + email.split("@")[-1]) in entries


def add(con, email: str, reason: str) -> bool:
    """Adds an address (once) and stops anything still planned for it. Returns True if it was new."""
    email = (email or "").strip().lower()
    if not email:
        return False
    entries = load()
    if email in entries:
        new = False
    else:
        path = config.suppression_csv()
        fresh = not path.exists() or path.stat().st_size == 0
        with path.open("a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if fresh:
                w.writerow(HEADER)
            w.writerow([email, reason, clock.today().isoformat()])
        new = True
    if con is not None:
        con.execute(
            "UPDATE leads SET status='suppressed', stop_reason=?, next_due=NULL "
            "WHERE (email=? OR (? LIKE '@%' AND email LIKE '%' || ?)) AND status IN ('queued', 'active', 'blocked')",
            ("suppressed: " + reason, email, email, email),
        )
        if new:
            db.log_event(con, "suppressed", "%s (%s)" % (email, reason))
    return new
