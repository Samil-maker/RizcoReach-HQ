"""rizco replies: reads your inbox, matches replies to leads, stops their emails, drafts answers.

Drafts are never sent. They go in the report and (if SAVE_DRAFTS=yes) in your mailbox's Drafts folder.
"""
from __future__ import annotations

import email
import re
from datetime import timedelta
from email import policy
from email.message import Message
from email.utils import getaddresses, parsedate_to_datetime
from typing import Dict, List, Optional

from . import classify, clock, config, db, mailer, portfolio, safety, schedule, suppression, templates
from .config import Inbox, Settings
from .mailbox import Mailbox, MailboxError, imap_date

LOOKBACK_DAYS = 30


def _addr(value: str) -> str:
    pairs = getaddresses([value or ""])
    return pairs[0][1].strip().lower() if pairs else ""


def _ids(value: str) -> List[str]:
    return re.findall(r"<[^>]+>", value or "")


def _received(msg: Message):
    try:
        dt = parsedate_to_datetime(msg.get("Date"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=clock.TZ)
        return dt.astimezone(clock.TZ)
    except (TypeError, ValueError, IndexError):
        return clock.now()


class Matcher:
    """Knows every Message-ID we sent and every address we emailed."""

    def __init__(self, con):
        self.by_mid: Dict[str, int] = {}
        self.by_email: Dict[str, int] = {}
        self.by_domain: Dict[str, List[int]] = {}
        for r in con.execute("SELECT message_id, lead_id, to_email FROM messages WHERE kind='campaign' AND lead_id IS NOT NULL"):
            if r["message_id"]:
                self.by_mid[r["message_id"].strip()] = r["lead_id"]
            self.by_email[r["to_email"]] = r["lead_id"]
            domain = r["to_email"].split("@")[-1]
            if domain not in config.FREE_DOMAINS:
                ids = self.by_domain.setdefault(domain, [])
                if r["lead_id"] not in ids:
                    ids.append(r["lead_id"])
        self.our_ids = set(self.by_mid)

    def lead_for(self, msg: Message) -> Optional[int]:
        for mid in _ids(msg.get("In-Reply-To")) + _ids(msg.get("References")):
            if mid in self.by_mid:
                return self.by_mid[mid]
        sender = _addr(msg.get("From"))
        if sender in self.by_email:
            return self.by_email[sender]
        ids = self.by_domain.get(sender.split("@")[-1], [])
        return ids[0] if len(ids) == 1 else None  # someone else at the same company

    def might_match(self, headers: Message) -> bool:
        if classify.is_bounce(headers):
            return True
        return self.lead_for(headers) is not None


def process(con, settings: Settings, inbox: Inbox, raw: bytes, folder: str = "INBOX",
            mailbox: Optional[Mailbox] = None, matcher: Optional[Matcher] = None, log=print) -> Optional[Dict]:
    """Handles one incoming email. Returns what happened, or None if it is not about our leads."""
    msg = email.message_from_bytes(raw, policy=policy.default)
    mid = (msg.get("Message-ID") or "").strip() or "<no-id-%s>" % hash(raw)
    if con.execute("SELECT 1 FROM inbound WHERE message_id=?", (mid,)).fetchone():
        return None
    matcher = matcher or Matcher(con)
    received = _received(msg)

    if classify.is_bounce(msg):
        return _process_bounce(con, msg, raw, mid, inbox, folder, received, matcher, log)

    lead_id = matcher.lead_for(msg)
    if not lead_id:
        return None
    lead = db.lead(con, lead_id)
    if not lead or not lead["first_sent_at"] or received < clock.parse(lead["first_sent_at"]) - timedelta(minutes=5):
        return None  # older than our first email: not a reply to us

    result = classify.classify(msg, raw)
    sender = _addr(msg.get("From"))
    subject = str(msg.get("Subject") or "")
    info = {"lead": lead["email"], "business": lead["business"], "label": result.label, "auto": result.is_auto}
    draft = None

    if result.label == "out_of_office" or (result.label == "other" and result.is_auto):
        if result.ooo_until and lead["status"] == "active":
            pushed = (result.ooo_until + timedelta(days=1)).isoformat()
            if not lead["next_due"] or pushed > lead["next_due"]:
                db.update_lead(con, lead_id, next_due=pushed)
                info["pushed_to"] = pushed
        db.log_event(con, "auto_reply", "%s %s" % (result.label, info.get("pushed_to", "")), lead_id, inbox.key)
    else:
        stop = {"status": "replied", "reply_class": result.label, "replied_at": clock.iso(received),
                "next_due": None, "stop_reason": "replied: " + classify.LABELS[result.label]}
        if result.label == "opt_out":
            stop.update(status="opted_out", waiting_on_me=0)
            db.update_lead(con, lead_id, **stop)
            suppression.add(con, lead["email"], "said no" if not result.complaint else "complained")
            if sender and sender != lead["email"]:
                suppression.add(con, sender, "said no (replied for %s)" % lead["email"])
        elif result.label == "not_now":  # back on your Reply to these list in 60 days, to check in
            stop.update(waiting_on_me=0, next_due=(received.date() + timedelta(days=schedule.NOT_NOW_CHECK_IN_DAYS)).isoformat())
            db.update_lead(con, lead_id, **stop)
        else:
            stop.update(waiting_on_me=1)
            db.update_lead(con, lead_id, **stop)
            pictures = bool(settings.save_drafts and mailbox is not None and portfolio.pictures())
            draft = templates.draft_reply(result.label, lead, result.text, settings, pictures=pictures)
        db.log_event(con, "reply", result.label, lead_id, inbox.key)
        if result.complaint:
            safety.pause(con, "a reply from %s mentions spam or reporting" % sender,
                         'They wrote: "%s". Read it in your inbox before you resume.' % result.text[:200].replace("\n", " "), log)

    saved = bool(draft and settings.save_drafts and mailbox is not None and _save_draft(mailbox, inbox, settings, msg, lead, draft))
    if draft and templates.PICTURES in draft:
        if saved:  # what you see on the dashboard: the pictures themselves are in the Gmail draft
            n = min(len(portfolio.pictures()), portfolio.IN_EMAIL)
            draft = draft.replace(templates.PICTURES, "[%d pictures of your work, already in the Gmail draft]" % n)
        else:  # no Gmail draft, so no pictures: the version with your portfolio link
            draft = templates.draft_reply(result.label, lead, result.text, settings)
    con.execute(
        "INSERT INTO inbound(message_id, lead_id, inbox, folder, received_at, from_addr, subject, body, classification, "
        "is_auto, complaint, ooo_until, draft, draft_saved, processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (mid, lead_id, inbox.key, folder, clock.iso(received), sender, subject, result.text[:5000], result.label,
         int(result.is_auto), int(result.complaint), result.ooo_until.isoformat() if result.ooo_until else None,
         draft, int(saved), clock.iso()),
    )
    if saved:
        info["draft_saved"] = True
    info["draft"] = draft
    return info


def _process_bounce(con, msg, raw, mid, inbox, folder, received, matcher, log) -> Optional[Dict]:
    addresses, kind, ids = classify.bounce_details(msg, raw)
    lead_id = next((matcher.by_mid[i] for i in ids if i in matcher.by_mid), None)
    if lead_id is None:
        lead_id = next((matcher.by_email[a] for a in addresses if a in matcher.by_email), None)
    if lead_id is None:
        body = raw.decode("utf-8", "replace").lower()
        lead_id = next((lid for addr, lid in matcher.by_email.items() if addr in body), None)
    if lead_id is None:
        return None
    lead = db.lead(con, lead_id)
    if kind == "delay":
        con.execute(
            "INSERT INTO inbound(message_id, lead_id, inbox, folder, received_at, from_addr, subject, classification, "
            "is_auto, processed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (mid, lead_id, inbox.key, folder, clock.iso(received), _addr(msg.get("From")), str(msg.get("Subject") or ""),
             "other", 1, clock.iso()),
        )
        return {"lead": lead["email"], "label": "delay notice (still trying, nothing to do)"}
    sent = con.execute(
        "SELECT * FROM messages WHERE lead_id=? AND kind='campaign' AND status='sent' AND sent_at<=? ORDER BY sent_at DESC LIMIT 1",
        (lead_id, clock.iso(received + timedelta(minutes=5))),
    ).fetchone()
    if sent:
        con.execute("UPDATE messages SET status='bounced', error=? WHERE id=?", ("bounced (%s)" % kind, sent["id"]))
    db.update_lead(con, lead_id, status="bounced", reply_class="bounce", next_due=None, waiting_on_me=0,
                   stop_reason="bounced (%s)" % kind)
    if kind == "hard":
        suppression.add(con, lead["email"], "hard bounce")
    con.execute(
        "INSERT INTO inbound(message_id, lead_id, inbox, folder, received_at, from_addr, subject, classification, "
        "is_auto, processed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (mid, lead_id, inbox.key, folder, clock.iso(received), _addr(msg.get("From")), str(msg.get("Subject") or ""),
         "bounce", 1, clock.iso()),
    )
    db.log_event(con, "bounce", kind, lead_id, inbox.key)
    if sent:
        safety.after_bounce(con, sent["sent_date"], log)
    return {"lead": lead["email"], "business": lead["business"], "label": "bounce (%s)" % kind}


def _save_draft(mb: Mailbox, inbox: Inbox, settings: Settings, their: Message, lead, draft: str) -> bool:
    folder = mb.special("\\Drafts")
    if not folder:
        return False
    their_id = (their.get("Message-ID") or "").strip()
    refs = _ids(their.get("References")) + ([their_id] if their_id else [])
    reply_to = _addr(their.get("Reply-To")) or _addr(their.get("From")) or lead["email"]
    msg = mailer.build(inbox, settings.from_name, reply_to, templates.reply_subject(str(their.get("Subject") or "")),
                       draft, mailer.new_message_id(inbox), in_reply_to=their_id or None, references=refs or None)
    if templates.PICTURES in draft:  # your portfolio pictures inside the email, where the mark is
        portfolio.add_to_email(msg, draft, templates.PICTURES, plain_instead=settings.examples_link or "")
    try:
        return mb.append(folder, msg, "(\\Draft)")
    except Exception:  # noqa: BLE001 - a draft that could not be saved is still in the report
        return False


def check_inbox(con, settings: Settings, inbox: Inbox, log=print) -> List[Dict]:
    """One inbox: Inbox and Spam folders, plus "did you reply yourself" for leads waiting on you."""
    matcher = Matcher(con)
    results: List[Dict] = []
    earliest = con.execute("SELECT MIN(sent_date) AS d FROM messages WHERE inbox=? AND kind='campaign'", (inbox.key,)).fetchone()["d"]
    if not earliest:
        return results
    since = max(clock.parse_date(earliest), clock.today() - timedelta(days=LOOKBACK_DAYS)) - timedelta(days=1)
    with Mailbox(inbox) as mb:
        # Gmail: All Mail, so replies you already archived are found too. Plus Spam everywhere.
        junk = mb.special("\\Junk")
        folders = [mb.special("\\All") or "INBOX"] + [f for f in [junk] if f]
        for folder in folders:
            if not mb.select(folder):
                continue
            seen_key = "imap_uid:%s:%s" % (inbox.key, folder)
            seen = db.get_state(con, seen_key) or {}
            validity = mb.uidvalidity()
            if seen.get("validity") == validity and seen.get("last"):
                uids = [u for u in mb.search("UID", "%d:*" % (seen["last"] + 1)) if int(u) > seen["last"]]
            else:
                uids = mb.search("SINCE", imap_date(since))
            heads = mb.headers(uids)
            for uid, raw_head in heads.items():
                head = email.message_from_bytes(raw_head, policy=policy.default)
                mid = (head.get("Message-ID") or "").strip()
                if mid and (mid in matcher.our_ids or con.execute("SELECT 1 FROM inbound WHERE message_id=?", (mid,)).fetchone()):
                    continue
                if _addr(head.get("From")) == inbox.email:
                    continue
                if not matcher.might_match(head):
                    continue
                raw = mb.full(uid)
                if not raw:
                    continue
                info = process(con, settings, inbox, raw, folder, mb, matcher, log)
                if info:
                    info["folder"] = folder
                    info["spam"] = folder == junk
                    results.append(info)
            if uids:
                db.set_state(con, seen_key, {"validity": validity, "last": max(int(u) for u in uids)})
        # Leads waiting on you: did you answer them yourself (from this mailbox) since they replied?
        waiting = con.execute("SELECT * FROM leads WHERE waiting_on_me=1 AND inbox=?", (inbox.key,)).fetchall()
        for lead in waiting:
            replied = clock.parse(lead["replied_at"]).date() if lead["replied_at"] else since
            if mb.sent_to_since(lead["email"], replied, matcher.our_ids):
                db.update_lead(con, lead["id"], waiting_on_me=0)
                db.log_event(con, "you_replied", "", lead["id"], inbox.key)
    return results


def check_all(con, settings: Settings, log=print, quiet: bool = False) -> List[Dict]:
    """Every inbox. One check at a time: the others wait for it instead of reading the same emails twice."""
    import fcntl

    path = config.path("data", "replies.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            return _check_all(con, settings, log, quiet)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _check_all(con, settings: Settings, log=print, quiet: bool = False) -> List[Dict]:
    out: List[Dict] = []
    for inbox in settings.inboxes:
        if not inbox.has_imap:
            continue
        try:
            found = check_inbox(con, settings, inbox, log)
        except (MailboxError, OSError) as e:
            log("  %s: could not check replies (%s)" % (inbox.email, e))
            continue
        db.set_state(con, "replies_checked:" + inbox.key, clock.iso())
        out += found
    if not quiet:
        for r in out:
            extra = ""
            if r.get("pushed_to"):
                extra = ", next email moved to %s" % r["pushed_to"]
            if r.get("draft_saved"):
                extra += ", reply drafted in your Drafts folder"
            elif r.get("draft"):
                extra += ", reply drafted in the report"
            where = " (found in Spam)" if r.get("spam") else ""
            log("  %s: %s%s%s" % (r["lead"], classify.LABELS.get(r["label"], r["label"]), where, extra))
    db.set_state(con, "replies_checked", clock.iso())
    return out
