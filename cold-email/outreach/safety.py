"""Automatic pauses. While paused nothing is sent until you run:  rizco resume

Pauses happen when bounces go over 3% of a day's emails, when a reply mentions spam or reporting,
or when the mail server starts refusing our emails or the login.
"""
from __future__ import annotations

from typing import Optional

from . import clock, db

BOUNCE_LIMIT = 0.03


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


def resume(con) -> Optional[dict]:
    p = paused(con)
    if p:
        db.del_state(con, "paused")
        db.log_event(con, "resumed", p.get("reason", ""))
    return p


def bounce_rate(con, sent_date: str):
    """(bounced, sent, rate) for the campaign emails sent on one day."""
    row = con.execute(
        "SELECT SUM(status='bounced') AS b, COUNT(*) AS n FROM messages "
        "WHERE sent_date=? AND kind='campaign' AND status IN ('sent', 'bounced')",
        (sent_date,),
    ).fetchone()
    bounced, sent = row["b"] or 0, row["n"] or 0
    return bounced, sent, (bounced / sent if sent else 0.0)


def after_bounce(con, sent_date: str, log=print) -> None:
    """Called each time a new bounce is recorded. Pauses if that day is over the limit."""
    bounced, sent, rate = bounce_rate(con, sent_date)
    if sent and rate > BOUNCE_LIMIT:
        pause(
            con,
            "bounces are over 3%% (%d of %d emails sent on %s bounced)" % (bounced, sent, sent_date),
            "Bounces hurt your inbox's reputation fast. Look at the bounced addresses in the report: if they "
            "came from one lead file, that list is bad, so remove its unsent leads before resuming. At 50 emails "
            "a day 2 bounces is already 4%, so this pauses quickly. That is on purpose.",
            log,
        )
