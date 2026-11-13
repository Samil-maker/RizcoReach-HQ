"""Things you can do to a lead, shared by the dashboard buttons and  rizco mark."""
from __future__ import annotations

from datetime import timedelta
from typing import Optional, Tuple

from . import clock, db, names, schedule, segment, suppression

MARKS = {
    "interested": "they are interested (waiting for your reply)",
    "question": "they asked a question (waiting for your reply)",
    "not-now": "they said not now",
    "no": "they said no: stop and add to the suppression list",
    "handled": "you have answered them",
    "client": "they became a client",
    "lost": "the deal is off",
    "skip": "never email this lead",
    "requeue": "put a skipped or blocked lead back in the queue",
}


def mark(con, email: str, what: str, note: Optional[str] = None) -> Tuple[bool, str]:
    """(done, message for you)."""
    lead = db.lead_by_email(con, email or "")
    what = (what or "").lower()
    if not lead:
        return False, "No lead with the email %s" % email
    if what not in MARKS:
        return False, "Use one of: " + ", ".join(MARKS)
    stopped = dict(next_due=None)
    extra = ""
    if what in ("interested", "question"):
        db.update_lead(con, lead["id"], status="replied", reply_class=what, waiting_on_me=1,
                       replied_at=lead["replied_at"] or clock.iso(), stop_reason="replied (marked by you)", **stopped)
    elif what == "not-now":
        check_in = (clock.today() + timedelta(days=schedule.NOT_NOW_CHECK_IN_DAYS)).isoformat()
        db.update_lead(con, lead["id"], status="replied", reply_class="not_now", waiting_on_me=0,
                       replied_at=lead["replied_at"] or clock.iso(), stop_reason="not now (marked by you)", next_due=check_in)
    elif what == "no":
        db.update_lead(con, lead["id"], status="opted_out", reply_class="opt_out", waiting_on_me=0,
                       stop_reason="said no (marked by you)", **stopped)
        suppression.add(con, lead["email"], "said no")
    elif what == "handled":
        db.update_lead(con, lead["id"], waiting_on_me=0)
    elif what in ("client", "lost"):
        db.update_lead(con, lead["id"], outcome=what, waiting_on_me=0)
    elif what == "skip":
        db.update_lead(con, lead["id"], status="skipped", stop_reason="skipped by you", **stopped)
    elif what == "requeue":
        if lead["first_sent_at"]:
            return False, "This lead has already been emailed, so it can't go back to the start."
        if suppression.is_suppressed(lead["email"], suppression.load()):
            return False, "This address is on the suppression list. Remove it from suppression.csv first if that was a mistake."
        fields = dict(status="queued", next_step=0, next_due=clock.today().isoformat(), stop_reason=None)
        if note:  # a true line about their site that you checked yourself
            fields.update(segment="C" if lead["website"] else lead["segment"],
                          observation=names.no_dashes(note.strip().rstrip(".")), observation_kind="yours",
                          segment_reason="requeued by you with your own observation")
        elif lead["segment"] not in ("A", "B", "C", "N", "G") and (lead["campaign"] or "website") == "ads":
            fields.update(segment="G", segment_reason="requeued by you (general Meta ads email)")
        elif lead["segment"] not in ("A", "B", "C", "N", "G"):
            if not lead["website"]:
                fields.update(segment="B", segment_reason="requeued by you")
            else:
                fields.update(segment="C", observation=segment.OBSERVATIONS["generic"], observation_kind="generic",
                              segment_reason="requeued by you (general line, no specific claim)")
        if note and (lead["campaign"] or "website") == "ads":
            fields.update(segment=lead["segment"] if lead["segment"] in ("N", "G") else "G", observation=None,
                          observation_kind=None, segment_reason="requeued by you")
        if fields.get("segment", lead["segment"]) == "C" and not (fields.get("observation") or lead["observation"]):
            fields.update(observation=segment.OBSERVATIONS["generic"], observation_kind="generic")
        db.update_lead(con, lead["id"], **fields)
        lead = db.lead(con, lead["id"])
        if lead["segment"] == "C":
            extra = '\nIt will say: "Had a look at the %s website. %s"' % (lead["business"], lead["observation"])
    db.log_event(con, "marked", what, lead["id"])
    return True, "%s: %s%s" % (lead["email"], MARKS[what], extra)


def check_ins_due(con) -> int:
    """People who said "not now" a while ago go back on your Reply to these list, with a check in drafted for you.
    Never sent for you. Returns how many came back."""
    rows = con.execute(
        "SELECT id FROM leads WHERE status='replied' AND reply_class='not_now' AND next_due IS NOT NULL AND next_due<=? "
        "AND outcome IS NULL AND waiting_on_me=0", (clock.today().isoformat(),)).fetchall()
    for r in rows:
        db.update_lead(con, r["id"], waiting_on_me=1, next_due=None, stop_reason="check in: they said not now")
        db.log_event(con, "check_in", "", r["id"])
    return len(rows)
