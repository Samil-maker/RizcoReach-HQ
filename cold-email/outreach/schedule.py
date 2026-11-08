"""Warm up limits, sending windows, and who is due today.

Limits per inbox (follow ups count too). The week is counted from that inbox's first cold email.
    week 1: 5 a day    week 2: 10    week 3: 18    week 4: 25    week 5 on: 30
A free address like @gmail.com never goes above 20 a day.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from . import clock, config, db, suppression
from .config import Inbox, Settings

RAMP = {1: 5, 2: 10, 3: 18, 4: 25}
RAMP_LATER = 30
WINDOWS = [((9, 0), (11, 30)), ((14, 0), (15, 30))]   # Dubai time, Monday to Friday
GAP_SECONDS = (180, 540)                              # 3 to 9 minutes between two emails from one inbox
GLOBAL_GAP_SECONDS = (60, 120)                        # and never two emails within a minute of each other
FOLLOW_UP_DAYS = {1: 3, 2: 7}


def ramp_start(con, inbox_key: str) -> Optional[date]:
    row = con.execute(
        "SELECT MIN(sent_date) AS d FROM messages WHERE inbox=? AND kind='campaign' AND status IN ('sent', 'bounced')",
        (inbox_key,),
    ).fetchone()
    return clock.parse_date(row["d"]) if row and row["d"] else None


def week_number(con, inbox_key: str, day: date) -> int:
    start = ramp_start(con, inbox_key)
    if not start or day < start:
        return 1
    return (day - start).days // 7 + 1


def ramp_cap(week: int) -> int:
    return RAMP.get(week, RAMP_LATER)


def sent_on(con, inbox_key: str, day: date) -> int:
    row = con.execute(
        "SELECT COUNT(*) AS n FROM messages WHERE inbox=? AND sent_date=? AND status IN ('sent', 'bounced')",
        (inbox_key, day.isoformat()),
    ).fetchone()
    return row["n"]


def limits(con, inbox: Inbox, day: date) -> Dict:
    week = week_number(con, inbox.key, day)
    cap = ramp_cap(week)
    why = "week %d of warm up: %d a day" % (week, cap)
    if inbox.is_free and cap > config.FREE_INBOX_CAP:
        cap = config.FREE_INBOX_CAP
        why += ", capped at %d because it is a free address" % cap
    if inbox.cap_override is not None and inbox.cap_override < cap:
        cap = inbox.cap_override
        why += ", lowered to %d by DAILY_CAP in .env" % cap
    elif inbox.cap_override is not None and inbox.cap_override > cap:
        why += (" (DAILY_CAP in .env says %d, but the warm up limit wins: sending more than this before the inbox "
                "has a track record is the quickest way to land in spam or get the account locked)" % inbox.cap_override)
    sent = sent_on(con, inbox.key, day)
    return {"week": week, "cap": cap, "sent": sent, "remaining": max(0, cap - sent), "why": why}


def is_send_day(day: date) -> bool:
    return day.weekday() < 5


def windows(day: date) -> List[Tuple[datetime, datetime]]:
    return [(clock.at(day, *a), clock.at(day, *b)) for a, b in WINDOWS]


def current_window_end(now: datetime) -> Optional[datetime]:
    if not is_send_day(now.date()):
        return None
    for start, end in windows(now.date()):
        if start <= now < end:
            return end
    return None


def next_window_start(now: datetime) -> Optional[datetime]:
    """The next window start later today, or None when today's windows are over."""
    if not is_send_day(now.date()):
        return None
    for start, _ in windows(now.date()):
        if now < start:
            return start
    return None


def due_follow_ups(con, inbox_key: str, day: date) -> List:
    return con.execute(
        "SELECT * FROM leads WHERE status='active' AND inbox=? AND next_step IN (1, 2) AND next_due<=? "
        "ORDER BY next_due, first_sent_at",
        (inbox_key, day.isoformat()),
    ).fetchall()


def new_leads(con, limit: int) -> List:
    if limit <= 0:
        return []
    return con.execute(
        "SELECT * FROM leads WHERE status='queued' AND segment IN ('A', 'B', 'C') AND COALESCE(mx_status, '')!='none' "
        "ORDER BY CASE segment WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, imported_at, id LIMIT ?",
        (limit,),
    ).fetchall()


def plan(con, settings: Settings, day: date, inboxes: Optional[List[Inbox]] = None, limit: Optional[int] = None) -> Dict:
    """What each inbox would send on `day`: follow ups first, then new leads shared across inboxes."""
    inboxes = inboxes if inboxes is not None else settings.inboxes
    entries = suppression.load()
    out: Dict[str, Dict] = {}
    for inbox in inboxes:
        lim = limits(con, inbox, day)
        follow = [l for l in due_follow_ups(con, inbox.key, day) if not suppression.is_suppressed(l["email"], entries)]
        take = follow[: lim["remaining"]]
        out[inbox.key] = {"inbox": inbox, "limits": lim, "items": [(l, l["next_step"]) for l in take],
                          "follow_ups_due": len(follow), "new": 0}
    room = {k: v["limits"]["remaining"] - len(v["items"]) for k, v in out.items()}
    total_room = sum(max(0, r) for r in room.values())
    if limit is not None:
        used = sum(len(v["items"]) for v in out.values())
        total_room = max(0, min(total_room, limit - used))
    candidates = [l for l in new_leads(con, total_room * 2 + 10) if not suppression.is_suppressed(l["email"], entries)]
    order = list(room)
    for lead in candidates[:total_room]:
        key = max(order, key=lambda k: room[k]) if order else None
        if key is None or room[key] <= 0:
            break
        out[key]["items"].append((lead, 0))
        out[key]["new"] += 1
        room[key] -= 1
        order.append(order.pop(order.index(key)))  # rotate so ties take turns
    if limit is not None:  # trim follow ups too if a small --limit was asked for
        left = limit
        for v in out.values():
            v["items"] = v["items"][: max(0, left)]
            left -= len(v["items"])
    return out


def next_due_after(step_sent: int, first_sent: date, today: date) -> Optional[str]:
    """Due date of the next email after sending `step_sent` today."""
    if step_sent == 0:
        return (today + timedelta(days=FOLLOW_UP_DAYS[1])).isoformat()
    if step_sent == 1:
        return max(first_sent + timedelta(days=FOLLOW_UP_DAYS[2]), today + timedelta(days=3)).isoformat()
    return None


def gap() -> float:
    return random.uniform(*GAP_SECONDS)


def global_gap() -> float:
    return random.uniform(*GLOBAL_GAP_SECONDS)


def choose_variant(con, segment: str) -> str:
    """Keeps versions A and B at 50/50 within each segment."""
    rows = dict(
        con.execute(
            "SELECT variant, COUNT(*) FROM messages WHERE kind='campaign' AND step=0 AND segment=? "
            "AND status IN ('sent', 'bounced') GROUP BY variant",
            (segment,),
        ).fetchall()
    )
    a, b = rows.get("A", 0), rows.get("B", 0)
    if a == b:
        return random.choice("AB")
    return "A" if a < b else "B"
