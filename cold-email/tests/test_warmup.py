"""The warm up between your own inboxes, against a fake Gmail that holds several accounts."""
import itertools
from datetime import datetime
from email import message_from_bytes, policy

from conftest import ENV, FakeSMTP
from outreach import clock, config, db, mailbox, schedule, warmup
from outreach.mailbox import Mailbox as RealMailbox

_uid = itertools.count(1)


class Gmail:
    """Mailboxes by account: {email: {folder: [{"uid", "raw", "flags"}]}}"""

    boxes = {}

    @classmethod
    def deliver(cls, to, raw, folder="INBOX"):
        cls.account(to)[folder].append({"uid": next(_uid), "raw": raw, "flags": set()})

    @classmethod
    def account(cls, email):
        return cls.boxes.setdefault(email, {"INBOX": [], "[Gmail]/Spam": [], "[Gmail]/Sent Mail": [], "[Gmail]/Drafts": []})


class FakeIMAP:
    def __init__(self, host, port, ssl_context=None, timeout=None):
        self.box, self.sel = None, None

    def login(self, user, password):
        self.box = Gmail.account(user)
        return "OK", [b"ok"]

    def logout(self):
        return "BYE", []

    def response(self, code):
        return code, [b"1"]

    def list(self):
        flag = {"[Gmail]/Spam": "\\Junk", "[Gmail]/Sent Mail": "\\Sent", "[Gmail]/Drafts": "\\Drafts"}
        return "OK", [('(\\HasNoChildren %s) "/" "%s"' % (flag.get(n, ""), n)).encode() for n in self.box]

    def create(self, name):
        self.box.setdefault(name.strip('"'), [])
        return "OK", [b"created"]

    def select(self, name, readonly=False):
        self.sel = name.strip('"')
        return ("OK", [b"1"]) if self.sel in self.box else ("NO", [b"missing"])

    def _find(self, uid):
        return next(m for m in self.box[self.sel] if m["uid"] == int(uid))

    def uid(self, command, *args):
        msgs = self.box[self.sel]
        if command == "SEARCH":
            return "OK", [" ".join(str(m["uid"]) for m in msgs).encode()]
        if command == "FETCH":
            uids, what = args
            out = []
            for u in uids.split(","):
                raw = self._find(u)["raw"]
                part = raw.split(b"\n\n", 1)[0] + b"\n\n" if "HEADER" in what else raw
                out += [(b"%s (UID %s BODY[] {%d}" % (u.encode(), u.encode(), len(part)), part), b")"]
            return "OK", out
        if command == "STORE":
            uid, how, flags = args
            self._find(uid)["flags"].update(flags.strip("()").split())
            return "OK", [b"stored"]
        if command == "MOVE":
            uid, folder = args
            m = self._find(uid)
            msgs.remove(m)
            self.box.setdefault(folder.strip('"'), []).append(m)
            return "OK", [b"moved"]
        raise AssertionError(command)

    def expunge(self):
        return "OK", []


class Dice:
    """A predictable random: always replies, stars and marks important; picks the first choice."""

    def random(self):
        return 0.1

    def uniform(self, a, b):
        return a

    def choice(self, seq):
        return seq[0]


def deliver_outbox(spam_first=False):
    for n, m in enumerate(FakeSMTP.outbox):
        Gmail.deliver(m["To"], m.as_bytes().replace(b"\r\n", b"\n"), "[Gmail]/Spam" if spam_first and n == 0 else "INBOX")
    FakeSMTP.outbox.clear()


def test_warm_up_between_two_inboxes(project, con, smtp, fake_clock, monkeypatch):
    monkeypatch.setattr(mailbox.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setattr(warmup, "Mailbox", RealMailbox)
    Gmail.boxes = {}
    (project / ".env").write_text("# test\n")
    s = config.load_settings(dict(ENV, INBOX2_EMAIL="rizco.two@gmail.com", INBOX2_APP_PASSWORD="abcdefghijklmnop"))
    db.set_state(con, "warmup_start:inbox2", "2026-11-09")
    assert schedule.limits(con, s.inbox("inbox2"), datetime(2026, 11, 9).date())["cap"] == 0  # no cold email yet

    fake_clock.set(datetime(2026, 11, 9, 10, 0, tzinfo=clock.TZ))
    stats = warmup.run(con, s, log=lambda *a: None, rng=Dice())
    assert stats["sent"] == 2  # one new conversation from each inbox so far today
    senders = sorted(m["From"] for m in FakeSMTP.outbox)
    assert senders == ["Samil <rizco.two@gmail.com>", "Samil <samilatrizcoreach@gmail.com>"]
    body = FakeSMTP.outbox[0].get_content()
    assert "http" not in body and FakeSMTP.outbox[0]["To"] != FakeSMTP.outbox[0]["From"]
    deliver_outbox(spam_first=True)

    fake_clock.set(datetime(2026, 11, 9, 11, 0, tzinfo=clock.TZ))
    stats = warmup.run(con, s, log=lambda *a: None, rng=Dice())
    assert stats["received"] == 2 and stats["spam"] == 1
    for email in ("samilatrizcoreach@gmail.com", "rizco.two@gmail.com"):
        box = Gmail.boxes[email]
        assert box["INBOX"] == [] and box["[Gmail]/Spam"] == []          # out of Spam, inbox kept clean
        filed = box[warmup.FOLDER]
        assert filed and all("\\Seen" in m["flags"] for m in filed)      # opened
    rows = con.execute("SELECT * FROM warmup ORDER BY id").fetchall()
    assert [r["landed"] for r in rows[:2]].count("spam") == 1
    replies = [m for m in FakeSMTP.outbox if m["Subject"].startswith("Re: ")]
    assert len(replies) == 2 and all(m["In-Reply-To"] for m in replies)  # both answered, in the same thread
    first_ids = {r["message_id"] for r in rows[:2]}
    assert {m["In-Reply-To"] for m in replies} == first_ids

    # evenings: nothing new is sent, but what arrived is still opened and filed
    deliver_outbox()
    fake_clock.set(datetime(2026, 11, 9, 20, 0, tzinfo=clock.TZ))
    stats = warmup.run(con, s, log=lambda *a: None, rng=Dice())
    assert stats["sent"] == 0 and stats["received"] >= 2
    assert warmup.summary(con, "inbox1")["spam"] + warmup.summary(con, "inbox2")["spam"] == 1


def test_one_inbox_does_nothing(project, con, settings, smtp, fake_clock):
    fake_clock.set(datetime(2026, 11, 9, 10, 0, tzinfo=clock.TZ))
    assert warmup.run(con, settings, log=lambda *a: None)["sent"] == 0 and FakeSMTP.outbox == []


def test_daily_amounts(project, con, fake_clock):
    (project / ".env").write_text("# test\n")
    s = config.load_settings(dict(ENV, INBOX2_EMAIL="rizco.two@gmail.com", INBOX2_APP_PASSWORD="x"))
    db.set_state(con, "warmup_start:inbox2", "2026-11-09")
    two, one = s.inbox("inbox2"), s.inbox("inbox1")
    assert warmup.daily_target(con, two, datetime(2026, 11, 9).date()) == 3
    assert warmup.daily_target(con, two, datetime(2026, 11, 19).date()) == 13
    assert warmup.daily_target(con, two, datetime(2026, 11, 14).date()) == 4      # Saturday: half
    assert warmup.daily_target(con, two, datetime(2026, 11, 24).date()) == 4      # after warm up: 4 a day
    assert warmup.daily_target(con, one, datetime(2026, 11, 10).date()) == 4
