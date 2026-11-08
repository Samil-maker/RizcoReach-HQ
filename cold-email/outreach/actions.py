"""Things you can do to a lead, shared by the dashboard buttons and  rizco mark."""
from __future__ import annotations

from typing import Optional, Tuple

from . import clock, db, names, segment, suppression

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
        db.update_lead(con, lead["id"], status="replied", reply_class="not_now", waiting_on_me=0,
                       replied_at=lead["replied_at"] or clock.iso(), stop_reason="not now (marked by you)", **stopped)
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
        elif lead["segment"] not in ("A", "B", "C"):
            if not lead["website"]:
                fields.update(segment="B", segment_reason="requeued by you")
            else:
                fields.update(segment="C", observation=segment.OBSERVATIONS["generic"], observation_kind="generic",
                              segment_reason="requeued by you (general line, no specific claim)")
        if fields.get("segment", lead["segment"]) == "C" and not (fields.get("observation") or lead["observation"]):
            fields.update(observation=segment.OBSERVATIONS["generic"], observation_kind="generic")
        db.update_lead(con, lead["id"], **fields)
        lead = db.lead(con, lead["id"])
        if lead["segment"] == "C":
            extra = '\nIt will say: "Had a look at the %s website. %s"' % (lead["business"], lead["observation"])
    db.log_event(con, "marked", what, lead["id"])
    return True, "%s: %s%s" % (lead["email"], MARKS[what], extra)
