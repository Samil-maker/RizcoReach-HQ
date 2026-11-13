"""Your portfolio pictures: made email sized, shown on the dashboard, put inside the Gmail draft."""
import email
import io
from datetime import datetime
from email import policy

import pytest

from outreach import clock, dashboard, db, portfolio, replies, templates
from test_flow import REPLY, add_leads, approve, run_day

PIL = pytest.importorskip("PIL.Image")


def picture(width, height, fmt="PNG", color=(30, 90, 160)):
    buf = io.BytesIO()
    PIL.new("RGB", (width, height), color).save(buf, fmt)
    return buf.getvalue()


def test_pictures_are_made_email_sized(project):
    ok, message = portfolio.add("Restaurant website.png", picture(2880, 1800))
    assert ok and "Added Restaurant website" in message
    ok, _ = portfolio.add("Screenshot 2026-11-13 at 10.22.33.png", picture(1440, 9000))   # a full page screenshot
    assert ok
    first, tall = portfolio.pictures()
    assert first.name == "01_Restaurant website.jpg" and portfolio.label(first) == "Restaurant website"
    assert portfolio.label(tall) == ""                                       # a screenshot's own name says nothing
    assert PIL.open(first).size == (1200, 750)
    assert PIL.open(tall).size == (1200, 1500)                              # trimmed to the top part
    assert all(p.stat().st_size < 400_000 for p in portfolio.pictures())


def test_only_pictures_and_at_most_six(project):
    assert not portfolio.add("menu.pdf", b"%PDF")[0]
    for i in range(6):
        assert portfolio.add("site %d.jpg" % i, picture(800, 600, "JPEG"))[0]
    ok, message = portfolio.add("one more.jpg", picture(800, 600, "JPEG"))
    assert not ok and "Remove one first" in message
    listing = portfolio.listing()
    assert [p["in_email"] for p in listing] == [True] * 4 + [False] * 2
    assert listing[0]["preview"].startswith("data:image/jpeg;base64,")
    assert portfolio.remove(listing[0]["name"])[0] and len(portfolio.pictures()) == 5
    assert not portfolio.remove("../../.env")[0]                              # only pictures in portfolio/


def test_without_the_image_library_small_pictures_still_work(project, monkeypatch):
    monkeypatch.setattr(portfolio, "_with_pillow", lambda data: None)
    monkeypatch.setattr(portfolio, "_with_sips", lambda data, ext: None)
    assert portfolio.add("Cafe.png", picture(600, 400))[0]
    assert portfolio.pictures()[0].suffix == ".png"
    ok, message = portfolio.add("huge.webp", picture(600, 400, "WEBP"))
    assert not ok and "JPG under 1.5 MB" in message


class FakeMailbox:
    def __init__(self):
        self.appended = []

    def special(self, flag):
        return "[Gmail]/Drafts" if flag == "\\Drafts" else None

    def append(self, folder, msg, flags=""):
        self.appended.append((folder, msg))
        return True


def test_the_reply_draft_shows_your_work_inside_the_email(project, con, settings, smtp, dns_pass, fake_clock):
    for name in ("Restaurant website.png", "Salon website.png", "Clinic website.png", "Gym website.png", "Spare.png"):
        portfolio.add(name, picture(1600, 1000))
    approve(con)
    add_leads(con, 1)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages").fetchone()[0]
    mb = FakeMailbox()
    settings.save_drafts = True
    info = replies.process(con, settings, settings.inboxes[0], REPLY.format(mid=mid).encode(), mailbox=mb)
    assert info["label"] == "interested" and info["draft_saved"]
    folder, msg = mb.appended[0]
    msg = email.message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert folder == "[Gmail]/Drafts" and msg["In-Reply-To"] == "<reply1@shop0.ae>"
    html = msg.get_body(("html",)).get_content()
    images = [p for p in msg.walk() if p.get_content_type() == "image/jpeg"]
    assert len(images) == 4                                                  # the first 4
    assert all('src="cid:%s"' % p["Content-ID"][1:-1] in html for p in images)
    assert "Restaurant website" in html and "Spare" not in html
    assert "Here are a few websites we've built so you can see the style" in html and "drive.google" not in html
    assert "Cedar" not in html and "Shop 0" in html
    plain = msg.get_body(("plain",)).get_content()
    assert "<<" not in plain and "drive.google.com" in plain                 # mail apps without pictures get the link
    w = dashboard.waiting(con, settings)
    assert "[4 pictures of your work, already in the Gmail draft]" in w[0]["draft"] and w[0]["draft_saved"]


def test_without_a_gmail_draft_the_reply_uses_the_link(project, con, settings, smtp, dns_pass, fake_clock):
    portfolio.add("Restaurant website.png", picture(1600, 1000))
    approve(con)
    add_leads(con, 1)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages").fetchone()[0]
    info = replies.process(con, settings, settings.inboxes[0], REPLY.format(mid=mid).encode(), mailbox=None)
    assert "drive.google.com" in info["draft"] and templates.PICTURES not in info["draft"]


def test_pictures_on_the_dashboard(project, settings):
    import threading
    import urllib.request
    import json
    import re

    from conftest import ENV

    (project / ".env").write_text("".join("%s=%s\n" % kv for kv in ENV.items()))
    srv = dashboard.make_server(0)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port
    token = re.search(r'const TOKEN = "([^"]+)"', urllib.request.urlopen(base + "/").read().decode()).group(1)

    def call(path, data=None, headers=None):
        req = urllib.request.Request(base + path, data=data, headers={"X-Rizco-Token": token, **(headers or {})},
                                     method="POST" if data is not None else "GET")
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    try:
        r = call("/api/portfolio", picture(1600, 1000), {"X-Filename": "Caf%C3%A9%20website.png"})
        assert r["ok"] and "Café website" in r["message"]
        listing = call("/api/portfolio")
        assert [p["label"] for p in listing] == ["Café website"]
        assert not call("/api/portfolio", b"not a picture", {"X-Filename": "notes.txt"})["ok"]
        assert call("/api/portfolio-remove", json.dumps({"name": listing[0]["name"]}).encode(),
                    {"Content-Type": "application/json"})["ok"]
        assert call("/api/portfolio") == []
    finally:
        srv.shutdown()
