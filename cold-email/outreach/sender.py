"""rizco send: sends today's emails one at a time, inside the Dubai sending windows.

Order each day: follow ups first, then new leads. Inboxes take turns. Each inbox waits a random
3 to 9 minutes between its own emails. Replies are checked before the first email and every 20
minutes, so nobody who answered gets a follow up.
"""
from __future__ import annotations

import fcntl
import json
import os
import random
from collections import deque
from datetime import timedelta
from typing import Dict, List, Optional

from . import clock, config, db, dnscheck, mailer, replies, safety, schedule, segment, sitecheck, suppression, templates
from .config import Inbox, Settings
from .mailbox import Mailbox

REPLY_CHECK_EVERY = timedelta(minutes=20)
SITE_RECHECK_AFTER = timedelta(days=14)


def log(*parts) -> None:
    print("[%s] %s" % (clock.now().strftime("%H:%M:%S"), " ".join(str(p) for p in parts)), flush=True)


class Lock:
    """Stops two runs of the same job at once (for example the 9:00 job and you by hand)."""

    MESSAGES = {"send": "Another send is already running (maybe the 9:00 job). Let it finish, or stop it first.",
                "auto": "The hourly job is already running."}

    def __init__(self, name: str = "send"):
        self.name = name
        self.path = config.path("data", "%s.lock" % name)
        self.f = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.path, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.f.close()
            raise SystemExit(self.MESSAGES.get(self.name, "Already running."))
        self.f.write(str(os.getpid()))
        self.f.flush()
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()

    @staticmethod
    def held(name: str = "send") -> bool:
        """True while that job is running."""
        path = config.path("data", "%s.lock" % name)
        if not path.exists():
            return False
        with open(path, "a") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return True
            fcntl.flock(f, fcntl.LOCK_UN)
        return False


# ----------------------------------------------------------------------------- composing

def compose(con, settings: Settings, inbox: Inbox, lead, step: int, variant: Optional[str] = None) -> Dict:
    if step == 0:
        variant = variant or lead["variant"] or schedule.choose_variant(con, lead["segment"])
        subject, body, full = templates.first_email(lead, variant, settings)
        text, in_reply_to, refs = full, None, None
    else:
        sent = con.execute(
            "SELECT * FROM messages WHERE lead_id=? AND kind='campaign' AND status='sent' ORDER BY step, sent_at",
            (lead["id"],),
        ).fetchall()
        first = sent[0]
        variant = lead["variant"]
        body, full = templates.follow_up(lead, step, settings)
        subject = templates.reply_subject(first["subject"])
        original = first["body"]
        text = full + "\n\n" + templates.quote(original, clock.parse(first["sent_at"]), settings.from_name, inbox.email)
        refs = [m["message_id"] for m in sent if m["message_id"]]
        in_reply_to = refs[-1] if refs else None
    problems, warnings = templates.lint(subject, body, full, step)
    return {"subject": subject, "body": body, "full": full, "text": text, "variant": variant,
            "in_reply_to": in_reply_to, "refs": refs, "problems": problems, "warnings": warnings}


def recheck(con, lead) -> Optional[str]:
    """Right before a first email: re-verify what we claim. Returns a reason to skip, or None."""
    if lead["mx_status"] == "unchecked":
        status = dnscheck.mx_status(lead["email"].split("@")[1])
        db.update_lead(con, lead["id"], mx_status=status)
        if status == "none":
            db.update_lead(con, lead["id"], status="blocked", stop_reason="email domain has no MX records")
            return "email domain has no MX records"
    if lead["segment"] != "C" or not lead["website"]:
        return None
    checked = clock.parse(lead["site_checked_at"]) if lead["site_checked_at"] else None
    stale = not checked or clock.now() - checked > SITE_RECHECK_AFTER
    if not stale and lead["observation_kind"] not in ("down", "error", "slow"):
        return None
    site = sitecheck.check_site(lead["website"])
    decision = segment.decide(dict(lead), site)
    fields = dict(site_json=json.dumps(site), site_checked_at=site["checked_at"], segment=decision["segment"],
                  segment_reason=decision["segment_reason"], observation=decision.get("observation"),
                  observation_kind=decision.get("observation_kind"))
    if decision["segment"] == "SKIP":
        fields.update(status="skipped", stop_reason="site rechecked: " + decision["segment_reason"])
    db.update_lead(con, lead["id"], **fields)
    if decision["segment"] == "SKIP":
        return "site rechecked before sending: " + decision["segment_reason"]
    return None


# ----------------------------------------------------------------------------- the run

class SendRun:
    def __init__(self, con, settings: Settings, dry_run: bool = False, limit: Optional[int] = None):
        self.con = con
        self.s = settings
        self.dry = dry_run
        self.limit = limit
        self.sent = 0
        self.last_reply_check = None

    # -- checks before anything is sent
    def ready_inboxes(self) -> List[Inbox]:
        con, ok = self.con, []
        for inbox in self.s.inboxes:
            if not inbox.password:
                log("%s: no App Password in .env, skipping this inbox" % inbox.email)
                continue
            cached = db.get_state(con, "dns_ok:" + inbox.key)
            if cached == clock.today().isoformat():
                ok.append(inbox)
                continue
            rep = dnscheck.check_inbox(inbox)
            if rep.can_send:
                db.set_state(con, "dns_ok:" + inbox.key, clock.today().isoformat())
                ok.append(inbox)
            else:
                bad = [c.name for c in (rep.spf, rep.dkim) if not c.ok]
                log("%s: not sending, %s %s not pass%s. Run  rizco check  to see how to fix it."
                    % (inbox.email, " and ".join(bad), "does" if len(bad) == 1 else "do",
                       " (the DNS lookup failed: is the internet on?)" if rep.lookup_failed else ""))
        return ok

    def check_replies(self, why: str = "") -> None:
        if self.dry or not any(i.has_imap for i in self.s.inboxes):
            return
        log("Checking replies%s..." % (" (" + why + ")" if why else ""))
        try:
            replies.check_all(self.con, self.s, log=lambda m: log(m.strip()))
        except Exception as e:  # noqa: BLE001 - sending carries on, replies are checked again later
            log("Could not check replies: %s" % e)
        self.last_reply_check = clock.now()

    def eligible(self, lead_id: int, step: int, inbox_key: str):
        lead = db.lead(self.con, lead_id)
        if not lead:
            return None
        if suppression.is_suppressed(lead["email"], suppression.load()):
            return None
        if step == 0:
            return lead if lead["status"] == "queued" else None
        ok = lead["status"] == "active" and lead["next_step"] == step and lead["inbox"] == inbox_key \
            and lead["next_due"] and lead["next_due"] <= clock.today().isoformat()
        return lead if ok else None

    # -- one email
    def send_one(self, inbox: Inbox, lead_id: int, step: int) -> str:
        """Returns sent, skipped, stop_inbox or stop_all."""
        con = self.con
        lead = self.eligible(lead_id, step, inbox.key)
        if not lead:
            return "skipped"
        if step == 0:
            reason = recheck(con, lead)
            if reason:
                log("Skipping %s: %s" % (lead["email"], reason))
                return "skipped"
            lead = db.lead(con, lead_id)
        c = compose(con, self.s, inbox, lead, step)
        if c["problems"]:
            db.update_lead(con, lead_id, status="blocked", stop_reason="email failed checks: " + "; ".join(c["problems"]))
            log("Not sending to %s: the email failed checks (%s). See the report." % (lead["email"], ", ".join(c["problems"])))
            return "skipped"
        message_id = mailer.new_message_id(inbox)
        msg = mailer.build(inbox, self.s.from_name, lead["email"], c["subject"], c["text"], message_id, c["in_reply_to"], c["refs"])
        now = clock.now()
        row = dict(lead_id=lead_id, inbox=inbox.key, kind="campaign", step=step, to_email=lead["email"],
                   subject=c["subject"], body=c["text"], message_id=message_id, in_reply_to=c["in_reply_to"],
                   refs=" ".join(c["refs"] or []), segment=lead["segment"], variant=c["variant"],
                   sent_at=clock.iso(now), sent_date=now.date().isoformat())
        attempts = 0
        while True:
            try:
                mailer.send(inbox, msg)
                break
            except mailer.SendError as e:
                attempts += 1
                if e.kind == "network" and attempts < 3:
                    log("No connection to %s, trying again in a minute (%s)" % (inbox.smtp_host, e))
                    clock.sleep(60)
                    continue
                if e.kind == "network":
                    log("%s: still no connection after 3 tries. Stopping this inbox for today." % inbox.email)
                    return "stop_inbox"
                if e.kind == "recipient":
                    self._record(row, status="bounced", error=str(e))
                    db.update_lead(con, lead_id, status="bounced", reply_class="bounce", next_due=None,
                                   stop_reason="address refused by the server: %s" % e)
                    suppression.add(con, lead["email"], "hard bounce")
                    log("%s was refused (%s). Marked as a bounce." % (lead["email"], e))
                    safety.after_bounce(con, row["sent_date"], log)
                    return "stop_all" if safety.paused(con) else "skipped"
                self._record(row, status="failed", error=str(e))
                what = {"auth": "the mail server refused the login", "temporary": "the mail server is refusing mail for now",
                        "policy": "the mail server refused our email"}.get(e.kind, "sending failed")
                safety.pause(con, "%s (%s)" % (what, inbox.email), str(e)[:300], log)
                return "stop_all"
        self._record(row, status="sent")
        first_date = clock.parse(lead["first_sent_at"]).date() if lead["first_sent_at"] else now.date()
        due = schedule.next_due_after(step, first_date, now.date())
        fields = dict(last_sent_at=row["sent_at"], next_due=due)
        if step == 0:
            fields.update(status="active", inbox=inbox.key, variant=c["variant"], first_sent_at=row["sent_at"], next_step=1)
        elif step == 1:
            fields.update(next_step=2)
        else:
            fields.update(status="done", next_step=None, stop_reason="sequence finished, no reply")
        db.update_lead(con, lead_id, **fields)
        db.log_event(con, "sent", "step %d" % step, lead_id, inbox.key)
        if inbox.save_to_sent and inbox.has_imap:
            try:
                with Mailbox(inbox) as mb:
                    folder = mb.special("\\Sent")
                    if folder:
                        mb.append(folder, msg, "(\\Seen)")
            except Exception:  # noqa: BLE001
                pass
        self.sent += 1
        kind = "first email" if step == 0 else "follow up %d" % step
        log("Sent %s to %s (%s, segment %s, version %s) from %s" % (kind, lead["email"], lead["business"], lead["segment"], c["variant"], inbox.email))
        return "sent"

    def _record(self, row: Dict, status: str, error: str = "") -> None:
        cols = list(row) + ["status", "error"]
        self.con.execute("INSERT INTO messages(%s) VALUES(%s)" % (", ".join(cols), ", ".join("?" * len(cols))),
                         (*row.values(), status, error))

    def sleep_until(self, when) -> None:
        while True:
            left = (when - clock.now()).total_seconds()
            if left <= 0:
                return
            clock.sleep(min(left, 60))

    # -- the whole day
    def run(self) -> int:
        con, s = self.con, self.s
        today = clock.today()
        p = safety.paused(con)
        if p and not self.dry:
            log("Sending is paused: %s" % p["reason"])
            if p.get("detail"):
                log(p["detail"])
            log("When you have looked into it, run:  rizco resume")
            return 0
        if s.problems:
            for problem in s.problems:
                log("Fix .env first: " + problem)
            if not self.dry:
                return 0
        if not self.dry and not db.get_state(con, "approved"):
            log("Sending has not been approved yet. First run  rizco test-email  then  rizco approve")
            return 0
        if not schedule.is_send_day(today):
            if not self.dry:
                log("It's %s in Dubai. No emails on Saturdays or Sundays." % today.strftime("%A"))
                return 0
        if not self.dry and not schedule.current_window_end(clock.now()) and not schedule.next_window_start(clock.now()):
            log("Today's sending windows (9:00 to 11:30 and 14:00 to 15:30 Dubai time) are over. Nothing sent.")
            return 0

        if not self.dry:  # lead files you dropped in since yesterday
            from . import importer

            for result in importer.import_pending(con, log=lambda *m: log(" ".join(str(x) for x in m).strip())):
                for line in importer.summary_lines(result):
                    log(line.strip())
        inboxes = s.inboxes if self.dry else self.ready_inboxes()
        if not inboxes:
            log("No inbox is ready to send.")
            return 0
        self.check_replies("before sending")
        if safety.paused(con) and not self.dry:
            return 0

        day = today if schedule.is_send_day(today) else clock.next_weekday(today)
        plan = schedule.plan(con, s, day, inboxes, self.limit)
        if self.dry:
            return self.print_plan(plan, day)

        queues = {k: deque((l["id"], step) for l, step in v["items"]) for k, v in plan.items()}
        for k, v in plan.items():
            lim = v["limits"]
            log("%s: %s. Already sent today: %d. Plan: %d follow ups, %d new."
                % (v["inbox"].email, lim["why"], lim["sent"], len(v["items"]) - v["new"], v["new"]))
        if not any(queues.values()):
            log("Nothing to send today: no follow ups due and no new leads (or today's limit is reached).")
            self.finish()
            return 0

        start = clock.now()
        next_ok = {k: start + timedelta(seconds=random.uniform(0, 180)) for k in queues}
        last_send = None
        last_gap = 0.0
        while any(queues.values()):
            if safety.paused(con):
                break
            now = clock.now()
            window_end = schedule.current_window_end(now)
            if window_end is None:
                nxt = schedule.next_window_start(now)
                if nxt is None:
                    left = sum(len(q) for q in queues.values())
                    log("Today's sending windows are over. %d emails move to the next weekday." % left)
                    break
                log("Waiting for the next sending window at %s (leave this running)." % nxt.strftime("%H:%M"))
                self.sleep_until(nxt + timedelta(seconds=random.uniform(0, 240)))
                continue
            busy = [k for k, q in queues.items() if q]
            ready = [k for k in busy if next_ok[k] <= now]
            wake = min(next_ok[k] for k in busy)
            if last_send is not None:
                wake = max(wake, last_send + timedelta(seconds=last_gap))
                if ready and now < last_send + timedelta(seconds=last_gap):
                    ready = []
            if not ready:
                self.sleep_until(min(wake, window_end))
                continue
            key = min(ready, key=lambda k: next_ok[k])
            lead_id, step = queues[key].popleft()
            if step > 0 and (self.last_reply_check is None or clock.now() - self.last_reply_check > timedelta(minutes=10)):
                self.check_replies("before a follow up")
            elif self.last_reply_check and clock.now() - self.last_reply_check > REPLY_CHECK_EVERY:
                self.check_replies()
            if safety.paused(con):
                break
            inbox = s.inbox(key)
            result = self.send_one(inbox, lead_id, step)
            if result == "stop_all":
                break
            if result == "stop_inbox":
                queues[key].clear()
                continue
            if result == "sent":
                last_send = clock.now()
                last_gap = schedule.global_gap()
                next_ok[key] = last_send + timedelta(seconds=schedule.gap())
        log("Done for today: %d emails sent." % self.sent)
        self.finish()
        return self.sent

    def finish(self) -> None:
        """After the last send: one more reply check, then today's report."""
        self.check_replies("end of day")
        from . import report

        path = report.write(self.con, self.s)
        log("Report written: %s" % path)
        from . import launchd

        waiting = self.con.execute("SELECT COUNT(*) FROM leads WHERE waiting_on_me=1").fetchone()[0]
        if self.sent or waiting:
            msg = "%d emails sent today." % self.sent
            if waiting:
                msg += " %d %s waiting for your reply (drafts are in Gmail Drafts)." % (waiting, "person is" if waiting == 1 else "people are")
            launchd.notify("RizcoReach", msg)

    # -- dry run
    def print_plan(self, plan: Dict, day) -> int:
        con, s = self.con, self.s
        today = clock.today()
        print()
        if day != today:
            print("Today is %s in Dubai, and nothing is sent on weekends. This is what %s would send:"
                  % (today.strftime("%A"), clock.nice(day)))
        else:
            print("Plan for today, %s (Dubai time). Nothing is being sent: this is a dry run." % clock.nice(day))
        print("Emails go out one at a time between 9:00 and 11:30 (then 14:00 to 15:30 if needed),")
        print("with a random 3 to 9 minute gap per inbox. Follow ups first, then new leads.")
        p = safety.paused(con)
        if p:
            print("\nNOTE: sending is paused right now (%s). Run  rizco resume  when ready." % p["reason"])
        if not db.get_state(con, "approved"):
            print("\nNOTE: real sending starts only after  rizco test-email  and  rizco approve")
        total = 0
        for key, v in plan.items():
            lim = v["limits"]
            print("\n%s (%s): %s. Sent today: %d. Today: %d follow ups and %d new leads."
                  % (v["inbox"].email, key, lim["why"], lim["sent"], len(v["items"]) - v["new"], v["new"]))
            if v["follow_ups_due"] > len(v["items"]) - v["new"]:
                print("  %d follow ups are due but over today's limit: they go first next time." % (v["follow_ups_due"] - (len(v["items"]) - v["new"])))
            for lead, step in v["items"]:
                total += 1
                c = compose(con, s, v["inbox"], lead, step, variant=lead["variant"] or "A")
                kind = "FIRST EMAIL" if step == 0 else "FOLLOW UP %d" % step
                version = ("version %s" % (lead["variant"] or "A or B (picked when sent, 50/50)")) if step == 0 else "version %s" % lead["variant"]
                print("\n" + "=" * 72)
                print("%d. %s to %s (%s), segment %s, %s" % (total, kind, lead["email"], lead["business"], lead["segment"], version))
                if lead["segment"] == "C" and step == 0:
                    print("   Why segment C: " + (lead["segment_reason"] or ""))
                print("Subject: %s\n" % c["subject"])
                print(c["full"])
                if c["problems"]:
                    print("\n   !! Would NOT be sent: " + ", ".join(c["problems"]))
                if c["warnings"]:
                    print("   (style note: %s)" % ", ".join(c["warnings"]))
        print("\n" + "=" * 72)
        queued = con.execute("SELECT COUNT(*) FROM leads WHERE status='queued'").fetchone()[0]
        print("%d emails planned. %d new leads waiting in the queue in total." % (total, queued))
        return 0
