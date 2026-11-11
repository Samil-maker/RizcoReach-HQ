"""replies.check_inbox against a fake IMAP server that answers like Gmail does."""
import re
from datetime import datetime

from conftest import ENV
from outreach import clock, config, db, mailbox, replies
from outreach.mailbox import Mailbox as RealMailbox

REAL_CHECK_INBOX = replies.check_inbox


class FakeIMAP:
    folders = {}
    appended = []

    def __init__(self, host, port, ssl_context=None, timeout=None):
        self.selected = None

    def login(self, user, password):
        return "OK", [b"logged in"]

    def logout(self):
        return "BYE", []

    def response(self, code):
        return code, [b"7"]

    def list(self):
        return "OK", [
            b'(\\HasNoChildren) "/" "INBOX"',
            b'(\\HasChildren \\Noselect) "/" "[Gmail]"',
            b'(\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"',
            b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
            b'(\\HasNoChildren \\Drafts) "/" "[Gmail]/Drafts"',
        ]

    def select(self, name, readonly=False):
        self.selected = name.strip('"')
        return ("OK", [b"1"]) if self.selected in FakeIMAP.folders else ("NO", [b"no such folder"])

    def uid(self, command, *args):
        msgs = FakeIMAP.folders.get(self.selected, [])
        if command == "SEARCH":
            crit = " ".join(a for a in args if a)
            if "TO" in crit:
                to = re.search(r'TO "([^"]+)"', crit).group(1)
                hits = [str(i + 1) for i, m in enumerate(msgs) if ("To: " + to).encode() in m]
            else:
                hits = [str(i + 1) for i in range(len(msgs))]
            return "OK", [" ".join(hits).encode()]
        if command == "FETCH":
            uids, what = args
            out = []
            for u in uids.split(","):
                raw = msgs[int(u) - 1]
                part = raw.split(b"\n\n", 1)[0] + b"\n\n" if "HEADER.FIELDS" in what else raw
                out += [(b"%s (UID %s BODY[] {%d}" % (u.encode(), u.encode(), len(part)), part), b")"]
            return "OK", out
        raise AssertionError(command)

    def append(self, folder, flags, date, data):
        FakeIMAP.appended.append((folder.strip('"'), flags, data))
        return "OK", [b"APPEND completed"]


def test_check_inbox_finds_replies_bounces_and_spam(project, con, monkeypatch, fake_clock):
    monkeypatch.setattr(replies, "Mailbox", RealMailbox)
    monkeypatch.setattr(replies, "check_inbox", REAL_CHECK_INBOX)
    monkeypatch.setattr(mailbox.imaplib, "IMAP4_SSL", FakeIMAP)
    (project / ".env").write_text("#\n")
    settings = config.load_settings(dict(ENV, SAVE_DRAFTS="yes"))
    inbox = settings.inboxes[0]

    # three leads emailed on Monday
    for i, email in enumerate(["ali@cafe.ae", "gone@salon.ae", "zed@gym.ae"]):
        con.execute("INSERT INTO leads(email, business, segment, status, variant, inbox, next_step, next_due, first_sent_at) "
                    "VALUES(?, ?, 'B', 'active', 'A', 'inbox1', 1, '2026-11-12', '2026-11-09T09:05:00+04:00')",
                    (email, "Biz %d" % i))
        con.execute("INSERT INTO messages(lead_id, inbox, kind, step, to_email, subject, message_id, sent_at, sent_date, status, segment, variant) "
                    "VALUES(?, 'inbox1', 'campaign', 0, ?, 'Biz website', ?, '2026-11-09T09:05:00+04:00', '2026-11-09', 'sent', 'B', 'A')",
                    (i + 1, email, "<m%d@gmail.com>" % i))

    reply = (b"From: Ali <ali@cafe.ae>\nTo: samilatrizcoreach@gmail.com\nSubject: Re: Biz website\n"
             b"Message-ID: <r1@cafe.ae>\nIn-Reply-To: <m0@gmail.com>\nDate: Tue, 10 Nov 2026 10:00:00 +0400\n\n"
             b"How much would it cost?\n")
    newsletter = (b"From: News <news@shop.com>\nTo: samilatrizcoreach@gmail.com\nSubject: Sale\nMessage-ID: <n1@shop.com>\n"
                  b"Date: Tue, 10 Nov 2026 10:00:00 +0400\n\nBuy now\n")
    bounce = (b"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\nTo: samilatrizcoreach@gmail.com\n"
              b"Subject: Delivery Status Notification (Failure)\nMessage-ID: <b1@google.com>\nX-Failed-Recipients: gone@salon.ae\n"
              b"Date: Mon, 9 Nov 2026 09:06:00 +0400\n\nAddress not found\nStatus: 5.1.1\n")
    spam_reply = (b"From: Zed <zed@gym.ae>\nTo: samilatrizcoreach@gmail.com\nSubject: Re: Biz website\nMessage-ID: <z1@gym.ae>\n"
                  b"Date: Tue, 10 Nov 2026 12:00:00 +0400\n\nNot right now, maybe next year\n")
    FakeIMAP.folders = {"INBOX": [reply, newsletter, bounce], "[Gmail]/Spam": [spam_reply], "[Gmail]/Sent Mail": [],
                        "[Gmail]/Drafts": []}
    FakeIMAP.appended = []
    fake_clock.set(datetime(2026, 11, 10, 13, 0, tzinfo=clock.TZ))

    found = replies.check_all(con, settings, log=lambda *a: None)
    labels = {r["lead"]: r["label"] for r in found}
    assert labels == {"ali@cafe.ae": "question", "gone@salon.ae": "bounce (hard)", "zed@gym.ae": "not_now"}
    assert [r["folder"] for r in found if r["lead"] == "zed@gym.ae"] == ["[Gmail]/Spam"]
    assert [r["spam"] for r in found if r["lead"] == "zed@gym.ae"] == [True]

    ali = db.lead_by_email(con, "ali@cafe.ae")
    assert ali["status"] == "replied" and ali["waiting_on_me"] == 1
    folder, flags, data = FakeIMAP.appended[0]
    assert folder == "[Gmail]/Drafts" and flags == "(\\Draft)"
    assert b"In-Reply-To: <r1@cafe.ae>" in data and b"Subject: Re: Biz website" in data and b"749 AED" in data
    assert db.lead_by_email(con, "gone@salon.ae")["status"] == "bounced"

    # running again finds nothing new
    assert replies.check_all(con, settings, log=lambda *a: None) == []

    # a new reply arriving later is picked up (only new message numbers are fetched now)
    late = (b"From: Bo <bo@cafe.ae>\nTo: samilatrizcoreach@gmail.com\nSubject: Re: Biz website\nMessage-ID: <late@cafe.ae>\n"
            b"In-Reply-To: <m0@gmail.com>\nDate: Tue, 10 Nov 2026 14:00:00 +0400\n\nAlso, do you do Arabic?\n")
    FakeIMAP.folders["INBOX"].append(late)
    assert [r["lead"] for r in replies.check_all(con, settings, log=lambda *a: None)] == ["ali@cafe.ae"]
    assert db.get_state(con, "imap_uid:inbox1:INBOX") == {"validity": "7", "last": 4}

    # you answer Ali yourself from Gmail: the next check notices and Ali stops waiting
    FakeIMAP.folders["[Gmail]/Sent Mail"] = [
        b"From: Samil <samilatrizcoreach@gmail.com>\nTo: ali@cafe.ae\nSubject: Re: Biz website\nMessage-ID: <mine@gmail.com>\n\nIt's 480"
    ]
    replies.check_all(con, settings, log=lambda *a: None)
    assert db.lead_by_email(con, "ali@cafe.ae")["waiting_on_me"] == 0


def test_gmail_all_mail_is_searched(project, con, monkeypatch, fake_clock):
    class GmailIMAP(FakeIMAP):
        def list(self):
            return "OK", FakeIMAP.list(self)[1] + [b'(\\HasNoChildren \\All) "/" "[Gmail]/All Mail"']

    monkeypatch.setattr(mailbox.imaplib, "IMAP4_SSL", GmailIMAP)
    inbox = config.load_settings(dict(ENV)).inboxes[0]
    with RealMailbox(inbox) as mb:
        assert mb.special("\\All") == "[Gmail]/All Mail"


def test_special_folders(monkeypatch):
    monkeypatch.setattr(mailbox.imaplib, "IMAP4_SSL", FakeIMAP)
    FakeIMAP.folders = {"INBOX": []}
    inbox = config.load_settings(dict(ENV)).inboxes[0]
    with RealMailbox(inbox) as mb:
        assert mb.special("\\Junk") == "[Gmail]/Spam"
        assert mb.special("\\Sent") == "[Gmail]/Sent Mail"
        assert mb.special("\\Drafts") == "[Gmail]/Drafts"
