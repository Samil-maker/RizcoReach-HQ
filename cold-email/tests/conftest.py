"""Test helpers: a temporary project folder, a fake clock, fake DNS and a fake SMTP server.
Nothing in the tests touches the network or sends a real email."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from email import message_from_bytes, policy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("OUTREACH_NO_NOTIFY", "1")
os.environ.setdefault("OUTREACH_NO_UPDATE", "1")

from outreach import clock, config, db, dnscheck, mailer, sitecheck  # noqa: E402


class FakeClock:
    def __init__(self, start: datetime):
        self.t = start
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += timedelta(seconds=seconds)

    def set(self, dt):
        self.t = dt


@pytest.fixture
def project(tmp_path, monkeypatch):
    config.set_root(tmp_path)
    for d in ("data", "leads/inbox", "leads/processed", "reports", "logs"):
        (tmp_path / d).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(dnscheck, "mx_status", lambda domain: "none" if "nomx" in domain else "ok")
    yield tmp_path
    config.set_root(ROOT)


@pytest.fixture
def fake_clock():
    c = FakeClock(datetime(2026, 11, 9, 8, 59, tzinfo=clock.TZ))  # a Monday
    clock.set_fake(c.now, c.sleep)
    yield c
    clock.set_fake(None, None)


@pytest.fixture
def con(project):
    c = db.connect()
    yield c
    c.close()


ENV = {
    "FROM_NAME": "Samil",
    "WHATSAPP_NUMBER": "+971501234567",
    "TEST_EMAIL_TO": "me@example.org",
    "SAVE_DRAFTS": "no",
    "INBOX1_EMAIL": "samilatrizcoreach@gmail.com",
    "INBOX1_PROVIDER": "gmail",
    "INBOX1_APP_PASSWORD": "abcd efgh ijkl mnop",
}


@pytest.fixture
def settings(project):
    (project / ".env").write_text("# test\n")
    return config.load_settings(dict(ENV))


class FakeSMTP:
    """Stands in for smtplib.SMTP_SSL. Collects every message."""

    outbox = []
    refuse = {}       # address -> (code, text): that recipient is refused
    fail_data = None  # (code, text): the server refuses everything

    def __init__(self, *a, **k):
        pass

    def login(self, user, password):
        if password != "abcdefghijklmnop":
            import smtplib

            raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")

    def send_message(self, msg):
        import smtplib

        if FakeSMTP.fail_data:
            raise smtplib.SMTPDataError(*FakeSMTP.fail_data)
        to = msg["To"]
        if to in FakeSMTP.refuse:
            raise smtplib.SMTPRecipientsRefused({to: FakeSMTP.refuse[to]})
        FakeSMTP.outbox.append(message_from_bytes(msg.as_bytes(), policy=policy.default))
        return {}

    def quit(self):
        pass


class NoMailbox:
    """Any attempt to open a real IMAP connection in a test fails loudly."""

    def __init__(self, *a, **k):
        raise AssertionError("a test tried to open a real IMAP connection")


@pytest.fixture(autouse=True)
def no_network_mail(monkeypatch):
    from outreach import mailbox, replies

    monkeypatch.setattr(mailbox, "Mailbox", NoMailbox)
    monkeypatch.setattr(replies, "Mailbox", NoMailbox)
    calls = []
    monkeypatch.setattr(replies, "check_inbox", lambda con, s, inbox, log=print: calls.append(inbox.key) or [])
    return calls


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.outbox = []
    FakeSMTP.refuse = {}
    FakeSMTP.fail_data = None
    monkeypatch.setattr(mailer, "_connect", lambda inbox, timeout=30: FakeSMTP())
    return FakeSMTP


@pytest.fixture
def dns_pass(monkeypatch):
    def fake(inbox):
        ok = dnscheck.Check("SPF", True, "v=spf1 redirect=_spf.google.com")
        return dnscheck.DomainReport(inbox.domain, True, ok, dnscheck.Check("DKIM", True, "selector 20230601"),
                                     dnscheck.Check("DMARC", True, "v=DMARC1; p=none"))
    monkeypatch.setattr(dnscheck, "check_inbox", fake)


OLD_SITE = """<html><head><title>Al Noor Tailoring</title></head>
<body><table width="800"><tr><td><font face="Arial">Welcome to Al Noor Tailoring. We make suits, kandura and
abayas in Karama since 1998. Visit our shop near the metro for a fitting. Our tailors have many years of experience
with all fabrics and styles, and we deliver across Dubai. Call us on 04 123 4567 for an appointment or visit us
any day from 9 in the morning until 10 at night. We also do alterations and repairs while you wait. Please ask our
team about wedding packages and group orders for companies and schools. We look forward to seeing you soon.</font>
<p><a href="tel:+97141234567">Call</a></p><p>Copyright &copy; 2017 Al Noor Tailoring. All rights reserved.</p>
</td></tr></table></body></html>"""

MODERN_SITE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glow Studio | Nails and Lashes in JLT</title><meta name="description" content="Nails, lashes and brows in JLT. Book online in a minute.">
<meta property="og:image" content="/og.jpg"><link rel="icon" href="/favicon.ico"></head>
<body><header><a href="/book">Book now</a> <a href="https://wa.me/971501112233">WhatsApp</a></header>
<h1>Nails, lashes and brows in JLT</h1><p>""" + ("Beautiful nails done by friendly experts. " * 30) + """</p>
<footer>&copy; <span id="y"></span> Glow Studio <script>document.getElementById('y').textContent=new Date().getFullYear()</script></footer>
</body></html>"""


@pytest.fixture
def fake_web(monkeypatch):
    """Websites by host: ('ok', html, seconds) or ('down',) or ('status', code)."""
    sites = {}

    def fetch(url, timeout=15.0):
        from urllib.parse import urlparse

        u = urlparse(url)
        site = sites.get(u.hostname)
        if site is None:
            return {"status": None, "error": "dns", "seconds": 0.1}
        kind = site[0]
        if kind == "down":
            return {"status": None, "error": "timeout", "seconds": 15}
        if kind == "status":
            return {"status": site[1], "final_url": url, "html": "error", "bytes": 5, "seconds": 0.3, "headers": {}, "error": None}
        if kind == "http_only" and u.scheme == "https":
            return {"status": None, "error": "connection", "seconds": 0.2}
        html, seconds = site[1], site[2] if len(site) > 2 else 0.8
        return {"status": 200, "final_url": url, "html": html, "bytes": len(html), "seconds": seconds, "headers": {}, "error": None}

    monkeypatch.setattr(sitecheck, "fetch", fetch)
    return sites
