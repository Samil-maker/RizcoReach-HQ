"""The SQLite database (data/outreach.db): leads, every email sent, every reply, and a log of events."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

from . import clock, config

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    business_name TEXT,          -- as it came in the file
    business TEXT,               -- cleaned, the way you'd type it in an email
    first_name TEXT,
    website TEXT, instagram TEXT, phone TEXT, niche TEXT, area TEXT, address TEXT,
    source TEXT, notes TEXT,
    segment TEXT,                -- A, B, C or SKIP
    segment_reason TEXT,
    observation TEXT,            -- the true line about their site (segment C)
    observation_kind TEXT,
    site_json TEXT, site_checked_at TEXT,
    mx_status TEXT,              -- ok or unchecked
    status TEXT NOT NULL DEFAULT 'queued',
        -- queued, active, done, replied, bounced, opted_out, suppressed, skipped, blocked
    variant TEXT,                -- A (shows the price) or B (no price), set at the first send
    inbox TEXT,                  -- which inbox emails this lead (set at the first send)
    next_step INTEGER DEFAULT 0, -- 0 first email, 1 follow up 1, 2 follow up 2
    next_due TEXT,               -- date the next email is due
    first_sent_at TEXT, last_sent_at TEXT,
    reply_class TEXT, replied_at TEXT,
    waiting_on_me INTEGER DEFAULT 0,
    outcome TEXT,                -- client or lost, set by you with "run.py mark"
    stop_reason TEXT,
    import_file TEXT, imported_at TEXT, raw_json TEXT
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    lead_id INTEGER,
    inbox TEXT,
    kind TEXT,                   -- campaign or test
    step INTEGER,
    to_email TEXT, subject TEXT, body TEXT,
    message_id TEXT, in_reply_to TEXT, refs TEXT,
    segment TEXT, variant TEXT,
    sent_at TEXT, sent_date TEXT,
    status TEXT,                 -- sent, bounced or failed
    error TEXT
);
CREATE INDEX IF NOT EXISTS messages_date ON messages(sent_date);
CREATE INDEX IF NOT EXISTS messages_mid ON messages(message_id);

CREATE TABLE IF NOT EXISTS inbound (
    id INTEGER PRIMARY KEY,
    message_id TEXT UNIQUE,
    lead_id INTEGER,
    inbox TEXT, folder TEXT,
    received_at TEXT, from_addr TEXT, subject TEXT, body TEXT,
    classification TEXT,         -- interested, question, not_now, opt_out, out_of_office, bounce, other
    is_auto INTEGER DEFAULT 0,
    complaint INTEGER DEFAULT 0,
    ooo_until TEXT,
    draft TEXT, draft_saved INTEGER DEFAULT 0,
    processed_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ts TEXT, type TEXT, lead_id INTEGER, inbox TEXT, detail TEXT
);

CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS warmup (
    id INTEGER PRIMARY KEY,
    thread TEXT, depth INTEGER,
    from_inbox TEXT, to_inbox TEXT,
    message_id TEXT UNIQUE, refs TEXT,
    subject TEXT, body TEXT,
    sent_at TEXT, sent_date TEXT,
    landed TEXT,
    processed_at TEXT
);
"""


def connect(path: Optional[Path] = None) -> sqlite3.Connection:
    path = Path(path or config.db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path), timeout=30, isolation_level=None)  # autocommit: every write is saved at once
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def get_state(con: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = con.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except ValueError:
        return row["value"]


def set_state(con: sqlite3.Connection, key: str, value: Any) -> None:
    con.execute("INSERT OR REPLACE INTO state(key, value) VALUES(?, ?)", (key, json.dumps(value)))


def del_state(con: sqlite3.Connection, key: str) -> None:
    con.execute("DELETE FROM state WHERE key=?", (key,))


def log_event(con: sqlite3.Connection, type_: str, detail: str = "", lead_id: Optional[int] = None, inbox: Optional[str] = None) -> None:
    con.execute(
        "INSERT INTO events(ts, type, lead_id, inbox, detail) VALUES(?, ?, ?, ?, ?)",
        (clock.iso(), type_, lead_id, inbox, detail),
    )


def lead(con: sqlite3.Connection, lead_id: int) -> Optional[sqlite3.Row]:
    return con.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()


def lead_by_email(con: sqlite3.Connection, email: str) -> Optional[sqlite3.Row]:
    return con.execute("SELECT * FROM leads WHERE email=?", (email.strip().lower(),)).fetchone()


def update_lead(con: sqlite3.Connection, lead_id: int, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join("%s=?" % k for k in fields)
    con.execute("UPDATE leads SET %s WHERE id=?" % cols, (*fields.values(), lead_id))
