"""Connect with Google: inboxes that sign in with Google (OAuth, XOAUTH2) instead of an App Password."""
import base64
import json
from urllib.parse import parse_qs, urlsplit

from conftest import ENV
from outreach import clock, config, dashboard, db, google_oauth, mailer, setup_wizard


def id_token(email):
    payload = base64.urlsafe_b64encode(json.dumps({"email": email, "email_verified": True}).encode()).decode().rstrip("=")
    return "h." + payload + ".s"


def test_the_sign_in_link_and_what_gmail_is_sent():
    verifier, challenge = google_oauth.pkce()
    url = google_oauth.auth_url("cid.apps.googleusercontent.com", "http://127.0.0.1:8321/", "st", challenge)
    q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert q["scope"] == "https://mail.google.com/ openid email" and q["access_type"] == "offline"
    assert q["redirect_uri"] == "http://127.0.0.1:8321/" and q["code_challenge_method"] == "S256" and q["state"] == "st"
    assert "consent" in q["prompt"], "always a refresh token"
    assert google_oauth.xoauth2("a@gmail.com", "tok") == "user=a@gmail.com\x01auth=Bearer tok\x01\x01"
    assert google_oauth._email_from_id_token(id_token("New.One@gmail.com")) == "new.one@gmail.com"


def test_tokens_are_refreshed_and_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(google_oauth, "_post", lambda data: calls.append(data) or {"access_token": "good-token", "expires_in": 3600})
    google_oauth.forget("a@gmail.com")
    assert google_oauth.access_token("a@gmail.com", "refresh-1", "cid", "secret") == "good-token"
    assert google_oauth.access_token("a@gmail.com", "refresh-1", "cid", "secret") == "good-token"
    assert len(calls) == 1 and calls[0]["grant_type"] == "refresh_token" and calls[0]["refresh_token"] == "refresh-1"
    assert "revoked" in google_oauth._explain("invalid_grant", ""), "a signed out inbox says to connect again"
    google_oauth.forget("a@gmail.com")


def test_a_google_inbox_sends_with_xoauth2(project, smtp, monkeypatch):
    monkeypatch.setattr(google_oauth, "_post", lambda data: {"access_token": "good-token", "expires_in": 3600})
    env = dict(ENV, INBOX1_APP_PASSWORD="", INBOX1_REFRESH_TOKEN="refresh-1", GOOGLE_CLIENT_ID="cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET="s3cret-value")
    s = config.load_settings(env)
    inbox = s.inboxes[0]
    assert inbox.uses_google_login and inbox.can_login and not inbox.password
    assert not [p for p in s.problems if "APP_PASSWORD" in p or "GOOGLE_CLIENT" in p]
    google_oauth.forget(inbox.email)
    msg = mailer.build(inbox, "Samil", "owner@shop.ae", "Hi", "Hello", mailer.new_message_id(inbox))
    mailer.send(inbox, msg)
    assert len(smtp.outbox) == 1 and smtp.auths[0][0] == "XOAUTH2"
    assert smtp.auths[0][1] == "user=%s\x01auth=Bearer good-token\x01\x01" % inbox.email
    # No client id and secret: it can't sign in, and says why.
    s2 = config.load_settings(dict(env, GOOGLE_CLIENT_ID="", GOOGLE_CLIENT_SECRET=""))
    assert any("GOOGLE_CLIENT_ID" in p for p in s2.problems)
    google_oauth.forget(inbox.email)


def test_connect_with_google_from_the_dashboard(project, smtp, dns_pass, fake_clock, monkeypatch):
    (project / ".env").write_text("".join("%s=%s\n" % kv for kv in ENV.items()))
    monkeypatch.setattr("outreach.mailbox.login_test", lambda inbox: "ok")
    monkeypatch.setattr(dashboard.launchd, "IS_MAC", False)
    # Before the one time setup, Connect says to do it.
    r = dashboard.google_start("website", True)
    assert not r["ok"] and r["setup"]
    assert not dashboard.post("/api/google-setup", {"client_id": "nope", "client_secret": "x"}, b"", {})["ok"]
    assert dashboard.post("/api/google-setup", {"client_id": "cid.apps.googleusercontent.com", "client_secret": "s3cret-value"}, b"", {})["ok"]
    r = dashboard.google_start("booking", True)
    assert r["ok"] and "client_id=cid.apps.googleusercontent.com" in r["url"]
    seen = {}

    def exchange(cid, secret, code, redirect, verifier):
        seen.update(cid=cid, code=code, redirect=redirect, verifier=bool(verifier))
        google_oauth._cache["new.one@gmail.com"] = ("good-token", 9e12)
        return "new.one@gmail.com", "refresh-new"

    monkeypatch.setattr(google_oauth, "exchange", exchange)
    res = dashboard.google_finish({"state": r["state"], "code": "4/abc"})
    assert res["ok"], res
    assert seen == {"cid": "cid.apps.googleusercontent.com", "code": "4/abc", "redirect": dashboard.GOOGLE_REDIRECT, "verifier": True}
    assert "starts with 5 cold emails a day and rises by itself" in res["message"]
    env = setup_wizard.read_env()
    assert env["INBOX2_EMAIL"] == "new.one@gmail.com" and env["INBOX2_REFRESH_TOKEN"] == "refresh-new"
    assert env["INBOX2_CAMPAIGN"] == "booking" and not env.get("INBOX2_APP_PASSWORD")
    assert db.get_state(db.connect(), "warmup_start:inbox2") == clock.today().isoformat()
    # The same link can't be used twice, and the page Google sends you back to says what happened.
    assert "expired or was used already" in dashboard.google_finish({"state": r["state"], "code": "4/abc"})["message"]
    assert b"Inbox connected" in dashboard._google_page(res)
    # Connecting an inbox you already have: its new sign in replaces the old one.
    r2 = dashboard.google_start("website", False)
    monkeypatch.setattr(google_oauth, "exchange", lambda *a: ("new.one@gmail.com", "refresh-2"))
    res2 = dashboard.google_finish({"state": r2["state"], "code": "4/def"})
    assert res2["ok"] and res2["message"].startswith("Reconnected new.one@gmail.com")
    assert setup_wizard.read_env()["INBOX2_REFRESH_TOKEN"] == "refresh-2"
    # You said no on Google's page.
    r3 = dashboard.google_start("website", False)
    assert "access_denied" in dashboard.google_finish({"state": r3["state"], "error": "access_denied"})["message"]
    google_oauth.forget("new.one@gmail.com")
