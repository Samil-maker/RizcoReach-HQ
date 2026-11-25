"""Automatic pauses. While paused nothing is sent until you run:  rizco resume

Each inbox looks after itself: when 3 of its emails bounce in one day (BOUNCE_PAUSE_AT in .env), a reply to it
mentions spam or reporting, or its mail server refuses the login or our emails, only that inbox pauses. The others
carry on. Resume it on the dashboard (Inboxes). Pause sending on the dashboard, or rizco resume, is for everything.
"""
from __future__ import annotations

from typing import Optional

from . import clock, db

BOUNCE_LIMIT = 0.03          # shown in the report: over 3% of a day's emails is a lot
BOUNCE_PAUSE_AT = 3          # bounces in one day that pause sending


def paused(con) -> Optional[dict]:
    return db.get_state(con, "paused")


def pause(con, reason: str, detail: str = "", log=print) -> None:
    if paused(con):
        return
    db.set_state(con, "paused", {"reason": reason, "detail": detail, "at": clock.iso()})
    db.log_event(con, "paused", "%s %s" % (reason, detail))
    log("\n*** SENDING PAUSED: %s" % reason)
    if detail:
        log("    %s" % detail)
    log("    Nothing more is sent until you have looked into it and run:  rizco resume\n")
    from . import launchd

    launchd.notify("RizcoReach: sending paused", reason)


def inbox_paused(con, key: str) -> Optional[dict]:
    return db.get_state(con, "inbox_paused:" + key)


def pause_inbox(con, inbox, reason: str, detail: str = "", log=print) -> None:
    """Stops one inbox until you resume it. The other inboxes keep sending."""
    if inbox_paused(con, inbox.key):
        return
    db.set_state(con, "inbox_paused:" + inbox.key, {"reason": reason, "detail": detail, "at": clock.iso()})
    db.log_event(con, "inbox_paused", "%s %s" % (reason, detail), None, inbox.key)
    log("\n*** %s PAUSED: %s" % (inbox.email, reason))
    if detail:
        log("    %s" % detail)
    log("    The other inboxes carry on. Resume this one on the dashboard (Inboxes) once you have looked into it.\n")
    from . import launchd

    launchd.notify("RizcoReach: %s paused" % inbox.email, reason)


def resume_inbox(con, key: str) -> Optional[dict]:
    p = inbox_paused(con, key)
    if p:
        db.del_state(con, "inbox_paused:" + key)
        db.log_event(con, "inbox_resumed", p.get("reason", ""), None, key)
    return p


def sendable(con, inboxes) -> list:
    """The inboxes that can sign in and are not paused."""
    return [i for i in inboxes if i.can_login and not inbox_paused(con, i.key)]


def resume(con) -> Optional[dict]:
    p = paused(con)
    if p:
        db.del_state(con, "paused")
        db.log_event(con, "resumed", p.get("reason", ""))
    return p


def note_planned(con, day: str, total: int) -> None:
    """The sender records how many emails the day holds, so a bounce early in the morning is counted against
    the whole day (1 in 50 is 2%, fine) instead of only the few sent so far (1 in 5 would be 20%)."""
    key = "planned:" + day
    if total > (db.get_state(con, key) or 0):
        db.set_state(con, key, total)


def bounce_rate(con, sent_date: str):
    """(bounced, emails that day, rate) for the campaign emails of one day: over 3% of the day's emails pauses."""
    row = con.execute(
        "SELECT SUM(status='bounced') AS b, COUNT(*) AS n FROM messages "
        "WHERE sent_date=? AND kind='campaign' AND status IN ('sent', 'bounced')",
        (sent_date,),
    ).fetchone()
    bounced, sent = row["b"] or 0, row["n"] or 0
    day_total = max(sent, db.get_state(con, "planned:" + sent_date) or 0)
    return bounced, day_total, (bounced / day_total if day_total else 0.0)


def pause_at() -> int:
    import os

    try:
        return max(1, int(os.environ.get("BOUNCE_PAUSE_AT") or BOUNCE_PAUSE_AT))
    except ValueError:
        return BOUNCE_PAUSE_AT


def after_bounce(con, sent_date: str, log=print, inbox=None) -> None:
    """Called each time a new bounce is recorded. The inbox that sent it pauses once it has had 3 bounces that day
    (BOUNCE_PAUSE_AT); the others carry on. Without an inbox, all sending pauses after 3 bounces that day."""
    if inbox is not None:
        row = con.execute("SELECT SUM(status='bounced') AS b, COUNT(*) AS n FROM messages WHERE sent_date=? AND inbox=? "
                          "AND kind='campaign' AND status IN ('sent', 'bounced')", (sent_date, inbox.key)).fetchone()
        bounced, sent = row["b"] or 0, row["n"] or 0
        key = "bounces_ok:%s:%s" % (sent_date, inbox.key)
        resumed_at = db.get_state(con, key) or 0
        if bounced - resumed_at >= pause_at():
            db.set_state(con, key, bounced)
            pause_inbox(con, inbox, "%d of its emails bounced on %s (%d of %d)" % (bounced - resumed_at, sent_date, bounced, sent),
                        "Look at the bounced addresses in the report. If they came from one lead file, remove its unsent "
                        "leads, then press Resume next to this inbox.", log)
        return
    bounced, sent, rate = bounce_rate(con, sent_date)
    limit = pause_at()
    # Once you resume, the count starts again from what has bounced so far.
    resumed_at = db.get_state(con, "bounces_ok:" + sent_date) or 0
    if bounced - resumed_at >= limit:
        db.set_state(con, "bounces_ok:" + sent_date, bounced)
        pause(
            con,
            "%d emails bounced on %s (%d of %d)" % (bounced - resumed_at, sent_date, bounced, sent),
            "Look at the bounced addresses in the report. If they came from one lead file, remove its unsent leads, "
            "then press Resume sending and it carries on.",
            log,
        )
