"""Daily limits, sending hours, and who is due today.

Each inbox sends up to its daily limit (50 by default, DAILY_LIMIT in .env or the dashboard), follow ups
included. A brand new inbox (added as brand new) sends no cold email in its first 14 days: it only warms
up (see warmup.py). Each lead goes out from an inbox that sends its campaign (website or Meta ads), and
only once that campaign's emails are approved.
Emails go out Monday to Friday, spread from 9:00 to 21:45 Dubai time.
"""
from __future__ import annotations

import bisect
import random
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from . import clock, config, db, suppression
from .config import Inbox, Settings

WINDOWS = [((9, 0), (22, 0))]   # Dubai time, Monday to Friday
LAST_PLANNED = (21, 45)         # the day's emails are planned to be out by then
# How the day's emails are spread: most during the working day (busiest 10 to 12 and 1 to 3, when owners read
# email), fewer in the evening. About three quarters are out by 18:00.
HOUR_WEIGHTS = {9: 1.0, 10: 1.5, 11: 1.5, 12: 1.0, 13: 1.5, 14: 1.5, 15: 1.1, 16: 1.1, 17: 1.0,
                18: 0.7, 19: 0.6, 20: 0.6, 21: 0.5}
FAST_GAP_SECONDS = 60                                 # "Send the rest now": about one email a minute
MIN_GAP_SECONDS = 180                                 # never two emails from one inbox within 3 minutes
GAP_SECONDS = (180, 540)                              # catching up after the Mac slept: 3 to 9 minutes apart
GLOBAL_GAP_SECONDS = (60, 120)                        # and never two emails within a minute of each other
FOLLOW_UP_DAYS = {1: 3, 2: 7}
WARMUP_DAYS = 14                                      # a brand new inbox only warms up for its first 14 days


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




def sent_on(con, inbox_key: str, day: date) -> int:
    row = con.execute(
        "SELECT COUNT(*) AS n FROM messages WHERE inbox=? AND sent_date=? AND status IN ('sent', 'bounced')",
        (inbox_key, day.isoformat()),
    ).fetchone()
    return row["n"]


def warmup_start(con, inbox_key: str) -> Optional[date]:
    value = db.get_state(con, "warmup_start:" + inbox_key)
    return clock.parse_date(value) if value else None


def warmup_ends(con, inbox_key: str) -> Optional[date]:
    """The first day a brand new inbox may send cold email, or None if it is not warming up."""
    start = warmup_start(con, inbox_key)
    if not start or ramp_start(con, inbox_key):
        return None
    return start + timedelta(days=WARMUP_DAYS)


def limits(con, inbox: Inbox, day: date) -> Dict:
    ends = warmup_ends(con, inbox.key)
    sent = sent_on(con, inbox.key, day)
    if ends and day < ends:
        days_in = (day - warmup_start(con, inbox.key)).days + 1
        return {"week": 0, "cap": 0, "sent": sent, "remaining": 0, "warming": True,
                "why": "warming up, day %d of %d: no cold emails until %s" % (days_in, WARMUP_DAYS, clock.nice(clock.next_weekday(ends)))}
    cap = inbox.daily_limit
    return {"week": week_number(con, inbox.key, day), "cap": cap, "sent": sent, "remaining": max(0, cap - sent),
            "why": "%d a day" % cap, "warming": False}


def cap_on(con, inbox: Inbox, day: date) -> int:
    """What this inbox may send on a future day (nothing while a brand new inbox warms up)."""
    if not is_send_day(day):
        return 0
    ends = warmup_ends(con, inbox.key)
    if ends and day < clock.next_weekday(ends):
        return 0
    return inbox.daily_limit


def forecast(con, inboxes: List[Inbox], targets=(50, 100)) -> Dict:
    """Emails a day possible on the next sending day and when each target is reached with these inboxes."""
    today = clock.next_weekday(clock.today())
    full = sum(i.daily_limit for i in inboxes)
    out: Dict = {"today": sum(cap_on(con, i, today) for i in inboxes), "reach": {}, "full": full}
    per = max([i.daily_limit for i in inboxes] or [config.DEFAULT_DAILY_LIMIT])
    for target in targets:
        if full < target:
            more = -(-(target - full) // per)
            out["reach"][target] = "needs %d more inbox%s" % (more, "" if more == 1 else "es")
            continue
        day = today
        for _ in range(200):
            if sum(cap_on(con, i, day) for i in inboxes) >= target:
                out["reach"][target] = day
                break
            day += timedelta(days=1)
    return out


def spread_times(n: int, start: datetime, end: datetime, rng=random) -> List[datetime]:
    """n send times between start and end, spread out, with more in the busy email hours."""
    if n <= 0:
        return []
    minutes = int((end - start).total_seconds() // 60)
    if minutes <= n * 3:
        return [start + timedelta(minutes=3 * i) for i in range(n)]
    weights, total = [], 0.0
    for m in range(minutes):
        total += HOUR_WEIGHTS.get((start + timedelta(minutes=m)).hour, 0.5)
        weights.append(total)
    times = []
    for i in range(n):
        u = (i + rng.uniform(0.2, 0.8)) / n * total
        idx = bisect.bisect_left(weights, u)
        times.append(start + timedelta(minutes=idx, seconds=rng.uniform(0, 59)))
    return times


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
        "SELECT * FROM leads WHERE status='queued' AND segment IN ('A', 'B', 'C', 'N', 'G') AND COALESCE(mx_status, '')!='none' "
        "ORDER BY CASE segment WHEN 'A' THEN 0 WHEN 'N' THEN 1 WHEN 'B' THEN 2 WHEN 'G' THEN 3 ELSE 4 END, imported_at, id LIMIT ?",
        (limit,),
    ).fetchall()


def plan(con, settings: Settings, day: date, inboxes: Optional[List[Inbox]] = None, limit: Optional[int] = None,
         preview: bool = False) -> Dict:
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
    candidates = [l for l in new_leads(con, total_room * 3 + 30) if not suppression.is_suppressed(l["email"], entries)]
    approved = set(config.CAMPAIGNS) if preview else {c for c in config.CAMPAIGNS if campaign_approved(con, c)}
    order = list(room)
    placed = 0
    for lead in candidates:
        if placed >= total_room:
            break
        campaign = lead_campaign(lead)
        if campaign not in approved:
            continue  # this campaign's emails haven't been approved yet
        fits = [k for k in order if room[k] > 0 and campaign in out[k]["inbox"].campaigns]
        if not fits:
            continue  # no inbox with room sends this campaign
        key = max(fits, key=lambda k: room[k])
        out[key]["items"].append((lead, 0))
        out[key]["new"] += 1
        room[key] -= 1
        placed += 1
        order.append(order.pop(order.index(key)))  # rotate so ties take turns
    if limit is not None:  # trim follow ups too if a small --limit was asked for
        left = limit
        for v in out.values():
            v["items"] = v["items"][: max(0, left)]
            left -= len(v["items"])
    return out


def fast_today(con) -> bool:
    """True after you pressed "Send the rest now" today: the rest of today's emails go about one a minute."""
    return db.get_state(con, "fast") == clock.today().isoformat()


def set_fast(con) -> None:
    db.set_state(con, "fast", clock.today().isoformat())
    db.log_event(con, "fast", "send the rest of today's emails about one a minute")


def lead_campaign(lead) -> str:
    keys = lead.keys() if hasattr(lead, "keys") else []
    value = lead["campaign"] if "campaign" in keys else None
    return value or ("ads" if lead["segment"] in ("N", "G") else "website")


def campaign_approved(con, campaign: str) -> bool:
    """Website: the test email you approved in setup. Meta ads: the Approve button on the dashboard."""
    return bool(db.get_state(con, "approved" if campaign == "website" else "approved:" + campaign))


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
