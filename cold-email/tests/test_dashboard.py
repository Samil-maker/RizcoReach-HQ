"""The dashboard server: real HTTP requests against it, on a spare port."""
import json
import re
import threading
import time
import urllib.error
import urllib.request

import pytest

from conftest import ENV
from outreach import dashboard, db, safety


@pytest.fixture
def server(project, settings, con, fake_web, fake_clock):
    (project / ".env").write_text("".join("%s=%s\n" % kv for kv in ENV.items()))  # the dashboard reads the real .env
    srv = dashboard.make_server(0)  # any free port
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    page = urllib.request.urlopen("http://127.0.0.1:%d/" % port).read().decode()
    token = re.search(r'const TOKEN = "([^"]+)"', page).group(1)

    def call(path, body=None, raw=None, headers=None, token_ok=True, host=None):
        h = {"X-Rizco-Token": token if token_ok else "nope", **(headers or {})}
        if host:
            h["Host"] = host
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if body is not None:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=data, headers=h,
                                     method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def job(job_id):
        for _ in range(100):
            status, j = call("/api/job?id=" + job_id)
            if j.get("done"):
                return j
            time.sleep(0.05)
        raise AssertionError("job never finished")

    call.job = job
    yield call
    srv.shutdown()


def test_only_this_page_can_use_it(server):
    assert server("/api/overview", token_ok=False)[0] == 403
    assert server("/api/overview", host="evil.example:8321")[0] == 403          # another site pointing at your Mac
    assert server("/api/pause", body={}, token_ok=False)[0] == 403
    status, o = server("/api/overview")
    assert status == 200 and o["inboxes"][0]["email"] == "samilatrizcoreach@gmail.com"
    assert "abcdefghijklmnop" not in json.dumps(o)                              # App Passwords never leave the Mac


def test_drop_a_file_and_it_is_imported(server, con):
    csv = b"Business,Email,Area\nCedar Grill,hello@cedargrill.ae,Deira\nBroken,not-an-email,\n"
    status, r = server("/api/upload", raw=csv, headers={"X-Filename": "my%20leads.csv"})
    assert status == 200
    j = server.job(r["job"])
    assert j["error"] == "" and j["result"][0]["imported"] == 1 and j["result"][0]["B"] == 1
    assert db.lead_by_email(con, "hello@cedargrill.ae")["segment"] == "B"
    status, r = server("/api/upload", raw=b"x", headers={"X-Filename": "notes.pdf"})
    assert status == 400 and "CSV or Excel" in r["message"]


def test_buttons(server, con):
    con.execute("INSERT INTO leads(email, business, segment, status, waiting_on_me, reply_class, replied_at, inbox) "
                "VALUES('ali@cafe.ae', 'Ali Cafe', 'B', 'replied', 1, 'interested', '2026-11-09T10:00:00+04:00', 'inbox1')")
    status, w = server("/api/waiting")
    assert [x["business"] for x in w] == ["Ali Cafe"] and "authuser=samilatrizcoreach@gmail.com" in w[0]["gmail"]
    assert server("/api/mark", body={"email": "ali@cafe.ae", "what": "handled"})[1]["ok"]
    assert server("/api/waiting")[1] == []
    assert server("/api/mark", body={"email": "ali@cafe.ae", "what": "client"})[1]["ok"]
    assert db.lead_by_email(con, "ali@cafe.ae")["outcome"] == "client"

    assert server("/api/pause", body={})[1]["ok"] and safety.paused(con)
    assert server("/api/overview")[1]["paused"]["reason"] == "paused by you from the dashboard"
    assert server("/api/resume", body={})[1]["ok"] and not safety.paused(con)

    assert server("/api/settings", body={"whatsapp": "050 999 8877", "examples_link": "https://example.org/work"})[1]["ok"]
    o = server("/api/overview")[1]
    assert o["settings"]["whatsapp"] == "+971 50 999 8877" and o["settings"]["examples_link"] == "https://example.org/work"
    assert not server("/api/settings", body={"examples_link": "javascript:alert(1)"})[1]["ok"]

    status, leads = server("/api/leads?status=replied")
    assert leads["total"] == 1 and leads["items"][0]["outcome"] == "client"
    texts = [a["text"] for a in server("/api/activity")[1]]
    assert texts[0] == "Sending resumed" and any(t.startswith("You marked Ali Cafe: they became a client") for t in texts)
    assert "Outreach report" in server("/api/report")[1]["text"]


def test_add_inbox_from_the_dashboard_checks_first(server, monkeypatch):
    status, r = server("/api/add-inbox", body={"email": "samilatrizcoreach@gmail.com", "password": "abcdefghijklmnop", "brand_new": True})
    j = server.job(r["job"])
    assert j["result"]["ok"] is False and "already" in j["result"]["message"]
    status, r = server("/api/add-inbox", body={"email": "new.one@gmail.com", "password": "short", "brand_new": True})
    assert "16 letters" in server.job(r["job"])["result"]["message"]


def test_campaigns_on_the_dashboard(server, con):
    o = server("/api/overview")[1]
    ads = next(c for c in o["campaigns"] if c["key"] == "ads")
    assert ads["approved"] is False and ads["inboxes"] == []           # off, and no inbox sends Meta ads yet
    assert o["settings"]["daily_limit"] == 50
    preview = server("/api/preview?campaign=ads")[1]
    assert preview and all("enquiries" in e["subject"] for e in preview)  # sample emails even before any ads leads
    r = server("/api/approve-campaign", body={"campaign": "ads"})[1]
    assert r["ok"] and "add one and choose Meta ads" in r["message"]
    assert next(c for c in server("/api/overview")[1]["campaigns"] if c["key"] == "ads")["approved"]

    csv = b"Business,Email,Area\nSky Cafe,hello@skycafe.ae,Deira\n"
    j = server.job(server("/api/upload", raw=csv, headers={"X-Filename": "list.csv", "X-Campaign": "ads"})[1]["job"])
    assert j["result"][0]["campaign"] == "Meta ads" and j["result"][0]["G"] == 1

    assert server("/api/settings", body={"daily_limit": "60"})[1]["ok"]
    assert server("/api/overview")[1]["settings"]["daily_limit"] == 60
    assert not server("/api/settings", body={"daily_limit": "900"})[1]["ok"]
