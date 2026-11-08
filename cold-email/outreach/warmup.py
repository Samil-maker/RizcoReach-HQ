"""Free warm up: your own inboxes email each other the way people do.

A brand new inbox spends its first 14 days only warming up, then starts cold email at 5 a day, and
keeps a little warm up going after that. Every inbox takes part once you have two or more.

Every hour (the hourly job), between 9:00 and 18:00 Dubai time:
  - each inbox starts a few short conversations with your other inboxes
  - each inbox opens the warm up emails it received, pulls any out of Spam (which tells Gmail
    "not spam"), stars or marks some as important, replies to most, and files them in a
    "RizcoReach Warmup" folder so your inbox stays clean

Warm up emails only ever go between your own inboxes. They don't count towards the cold email limits.
Honest note: paid warm up tools do the same thing with thousands of strangers' inboxes, which counts
for more. This gives each new inbox weeks of normal two way email and an early warning if your emails
start landing in Spam (see the report).
"""
from __future__ import annotations

import imaplib
import math
import random
from datetime import timedelta
from email import message_from_bytes, policy
from typing import Dict, List, Optional

from . import clock, db, mailer, safety, schedule, templates
from .config import Inbox, Settings
from .mailbox import Mailbox, MailboxError, imap_date

FOLDER = "RizcoReach Warmup"
DAY_START, DAY_END = 9, 18
MAX_NEW_PER_RUN = 2
REPLY_CHANCE = 0.65
MAX_DEPTH = 2  # a conversation is at most 3 emails

SCHEMA = """
CREATE TABLE IF NOT EXISTS warmup (
    id INTEGER PRIMARY KEY,
    thread TEXT, depth INTEGER,
    from_inbox TEXT, to_inbox TEXT,
    message_id TEXT UNIQUE, refs TEXT,
    subject TEXT, body TEXT,
    sent_at TEXT, sent_date TEXT,
    landed TEXT,          -- inbox or spam, as the receiving inbox found it
    processed_at TEXT
);
"""

SUBJECTS = [
    "quick one", "tomorrow", "photos from yesterday", "the menu draft", "Thursday?", "small update", "that supplier",
    "notes from the call", "the shop sign", "invoice question", "weekend", "new opening hours", "logo files",
    "can you check this", "price list", "delivery time", "meeting moved", "catching up", "about the order",
    "small change", "Monday", "the booking", "lunch next week", "parking", "brochure text", "team dinner",
    "banner colours", "stock count", "the new chairs", "samples", "flyers", "the event", "printing",
]
BODIES = [
    "Did you get a chance to look at the photos from yesterday? I think the second set came out better but tell me what you think.",
    "Are we still on for Thursday? I can do any time after 4.",
    "The supplier called back and said the delivery will be a day late. Not a big deal but wanted you to know.",
    "I made the small changes to the menu we talked about. Can you have a look when you're free?",
    "Quick question. Do you remember which printer we used last time for the flyers?",
    "Just checking in. How did the meeting go this morning?",
    "I moved our call to Monday at 11 since Sunday got busy. Hope that works for you.",
    "Can you send me the logo files again? I can't find the ones with the white background.",
    "I've been thinking about the opening hours. Maybe we start at 10 on weekdays instead of 9?",
    "The banner colours look good to me. Maybe a little darker on the green.",
    "Do you have the invoice number for last month's order? The accountant is asking.",
    "Thanks for sorting out the booking yesterday. Everything went smoothly.",
    "Lunch next week? I'm free Tuesday and Wednesday.",
    "I wrote a first version of the brochure text. It's a bit long so feel free to cut whatever you want.",
    "We need to do a stock count before the weekend. Can you help Friday morning?",
    "Parking near the venue was a nightmare last time. Should we tell people to come by metro?",
    "Small change on the price list. The large size is now 45 instead of 40.",
    "Did the new chairs arrive? They said Monday or Tuesday.",
    "Got your message. I'll call you after 6 if that's ok.",
    "The client liked the samples. They want to see two more colours before they decide.",
    "Can we push the team dinner to next Friday? A few people can't make it this week.",
    "I found a cheaper place for the printing. Same quality from what I can see.",
    "How many people are coming on Saturday? I need a rough number for the food.",
    "The sign people want to come and measure on Wednesday morning. Will someone be there?",
    "I sent the order this morning. They said it should be with us by Sunday.",
    "Do you still have the number of the guy who fixed the AC last summer?",
    "Just saw the reviews from last week. Mostly really good, a couple about waiting times.",
    "I'll be a bit late tomorrow, around 10. Can you open up?",
    "Have you tried the new coffee place near the office? Worth it.",
    "Remind me what we decided about the delivery fee. Was it free above 100?",
    "The photographer can do the 18th or the 20th. Which one is better for you?",
    "I printed the flyers. They look great, much better than the last batch.",
    "Are you around this afternoon for ten minutes? Want to run something by you.",
]
GREETINGS = ["Hi", "Hey", "Hi there", "Hello", ""]
SIGNOFFS = ["Thanks", "Cheers", "Talk soon", "See you", "Thanks a lot", ""]
REPLIES = [
    "Sounds good, thanks!", "Yes that works. See you then.", "Got it, thanks for letting me know.",
    "Looks good to me. Maybe one small change but we can talk tomorrow.", "Sure, I'll send them tonight.",
    "Good idea, let's do that.", "No problem. I'll check and get back to you.", "Tuesday is perfect.",
    "Thanks! Will have a look later today.", "Agreed.", "Perfect, thank you.", "I'll call you in a bit.",
    "Yes I remember, it was the one near the mall.", "Great news, thanks for the update.",
    "Ok, Friday morning works for me.", "Ha yes, it was really bad. Metro is better.",
    "Around 30 people I think. I'll confirm tomorrow.", "I'll be there, no worries.",
    "Let me check and send it over.", "The 20th is better for me.", "Nice, they look great.",
    "Yes, free above 100.", "Sure, call me any time after 3.", "Thanks, I'll take a look.",
]


def ensure_schema(con) -> None:
    con.executescript(SCHEMA)


def compose_new(name: str, rng=random):
    greeting, sign = rng.choice(GREETINGS), rng.choice(SIGNOFFS)
    lines = ([greeting] if greeting else []) + [rng.choice(BODIES)] + (["%s\n%s" % (sign, name)] if sign else [name])
    return rng.choice(SUBJECTS), "\n\n".join(lines)


def compose_reply(name: str, rng=random) -> str:
    return "%s\n\n%s" % (rng.choice(REPLIES), name)


def daily_target(con, inbox: Inbox, day) -> int:
    """Warm up emails this inbox sends on a day: 3 rising to 15 while warming up, then 4 a day."""
    ends = schedule.warmup_ends(con, inbox.key)
    if ends and day < ends:
        n = min(3 + (day - schedule.warmup_start(con, inbox.key)).days, 15)
    else:
        n = 4
    return max(1, n // 2) if day.weekday() >= 5 else n


def sent_today(con, inbox_key: str, day) -> int:
    return con.execute("SELECT COUNT(*) FROM warmup WHERE from_inbox=? AND sent_date=?", (inbox_key, day.isoformat())).fetchone()[0]


def _send(con, s: Settings, frm: Inbox, to: Inbox, subject: str, body: str, thread: str, depth: int,
          refs: Optional[List[str]] = None, log=print) -> bool:
    mid = mailer.new_message_id(frm)
    msg = mailer.build(frm, s.from_name, to.email, subject, body, mid,
                       in_reply_to=refs[-1] if refs else None, references=refs)
    try:
        mailer.send(frm, msg)
    except mailer.SendError as e:
        log("Warm up: %s could not send (%s)" % (frm.email, e))
        return False
    now = clock.now()
    con.execute(
        "INSERT INTO warmup(thread, depth, from_inbox, to_inbox, message_id, refs, subject, body, sent_at, sent_date) "
        "VALUES(?,?,?,?,?,?,?,?,?,?)",
        (thread, depth, frm.key, to.key, mid, " ".join((refs or []) + [mid]), subject, body, clock.iso(now), now.date().isoformat()),
    )
    return True


def receive(con, inbox: Inbox, rng=random) -> List:
    """Opens, rescues and files the warm up emails this inbox received. Returns them."""
    got = []
    since = clock.today() - timedelta(days=3)
    with Mailbox(inbox) as mb:
        junk = mb.special("\\Junk")
        target = mb.ensure_folder(FOLDER)
        for folder in ["INBOX"] + ([junk] if junk else []):
            if not mb.select(folder, readonly=False):
                continue
            for uid, raw in mb.headers(mb.search("SINCE", imap_date(since))).items():
                mid = (message_from_bytes(raw, policy=policy.default).get("Message-ID") or "").strip()
                row = con.execute("SELECT * FROM warmup WHERE message_id=? AND to_inbox=? AND processed_at IS NULL",
                                  (mid, inbox.key)).fetchone()
                if not row:
                    continue
                mb.add_flags(uid, "\\Seen")
                if rng.random() < 0.25:
                    mb.add_flags(uid, "\\Flagged")
                if rng.random() < 0.35:
                    mb.mark_important(uid)
                mb.move(uid, target)
                landed = "spam" if folder == junk else "inbox"
                con.execute("UPDATE warmup SET landed=?, processed_at=? WHERE id=?", (landed, clock.iso(), row["id"]))
                got.append(dict(row, landed=landed))
    return got


def run(con, s: Settings, log=print, rng=random) -> Dict:
    ensure_schema(con)
    inboxes = [i for i in s.inboxes if i.password and i.imap_host]
    stats = {"sent": 0, "received": 0, "spam": 0}
    if len(inboxes) < 2:
        return stats
    received = []
    for inbox in inboxes:
        try:
            received += receive(con, inbox, rng)
        except (MailboxError, OSError, imaplib.IMAP4.error) as e:
            log("Warm up: could not read %s (%s)" % (inbox.email, e))
    stats["received"] = len(received)
    stats["spam"] = sum(1 for r in received if r["landed"] == "spam")
    if stats["spam"]:
        log("Warm up: %d of %d warm up emails had landed in Spam and were moved out." % (stats["spam"], len(received)))

    now = clock.now()
    today = now.date()
    if not DAY_START <= now.hour < DAY_END or safety.paused(con):
        return stats
    by_key = {i.key: i for i in inboxes}

    # Replies first, like a person working through their inbox
    for row in received:
        frm, to = by_key.get(row["to_inbox"]), by_key.get(row["from_inbox"])
        if not frm or not to or row["depth"] >= MAX_DEPTH or rng.random() > REPLY_CHANCE:
            continue
        if sent_today(con, frm.key, today) >= daily_target(con, frm, today) + 2:
            continue
        refs = (row["refs"] or row["message_id"]).split()
        if _send(con, s, frm, to, templates.reply_subject(row["subject"]), compose_reply(s.from_name, rng),
                 row["thread"], row["depth"] + 1, refs, log):
            stats["sent"] += 1

    # New conversations, spread over the day
    share = min(1.0, (now - clock.at(today, DAY_START)).total_seconds() / ((DAY_END - DAY_START) * 3600) + 1 / 9)
    for inbox in inboxes:
        due = math.ceil(daily_target(con, inbox, today) * share) - sent_today(con, inbox.key, today)
        for _ in range(min(due, MAX_NEW_PER_RUN)):
            peer = rng.choice([i for i in inboxes if i.key != inbox.key])
            subject, body = compose_new(s.from_name, rng)
            thread = mailer.new_message_id(inbox)
            if not _send(con, s, inbox, peer, subject, body, thread, 0, None, log):
                break
            stats["sent"] += 1
            clock.sleep(rng.uniform(20, 90))
    if stats["sent"]:
        log("Warm up: %d emails sent between your inboxes." % stats["sent"])
    return stats


def summary(con, inbox_key: str, days: int = 7) -> Dict:
    """Warm up numbers for the report: sent, received, and how many landed in Spam."""
    ensure_schema(con)
    since = (clock.today() - timedelta(days=days - 1)).isoformat()
    sent = con.execute("SELECT COUNT(*) FROM warmup WHERE from_inbox=? AND sent_date>=?", (inbox_key, since)).fetchone()[0]
    rows = con.execute("SELECT landed FROM warmup WHERE from_inbox=? AND sent_date>=? AND landed IS NOT NULL",
                       (inbox_key, since)).fetchall()
    spam = sum(1 for r in rows if r["landed"] == "spam")
    return {"sent": sent, "checked": len(rows), "spam": spam}
