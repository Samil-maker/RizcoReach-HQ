"""Connect with Google: Gmail inboxes without App Passwords.

New Gmail accounts often can't make an App Password. Instead the inbox signs in with Google the way mail apps do
(OAuth 2.0, XOAUTH2 for SMTP and IMAP). You make one free Google Cloud "app" for yourself once (README, "Connect with
Google"), paste its client id and secret on the dashboard, then each inbox is one click: Connect with Google, pick the
account, Allow. Google keeps a refresh token for it, saved in your .env like a password; this module turns it into a
short lived access token when the inbox sends or reads mail.

The app stays unverified (it's yours, used by you): Google shows "Google hasn't verified this app", you press
Advanced, then continue. Publish it ("In production"), or Google signs the inbox out every 7 days.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional, Tuple

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://mail.google.com/ openid email"   # sending and reading mail over SMTP and IMAP, and which account it is


class OAuthError(Exception):
    pass


def client(env: Optional[Dict[str, str]] = None) -> Tuple[str, str]:
    env = env if env is not None else os.environ
    return (env.get("GOOGLE_CLIENT_ID") or "").strip(), (env.get("GOOGLE_CLIENT_SECRET") or "").strip()


def configured(env: Optional[Dict[str, str]] = None) -> bool:
    cid, secret = client(env)
    return bool(cid and secret)


def pkce() -> Tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def auth_url(client_id: str, redirect_uri: str, state: str, challenge: str, login_hint: str = "") -> str:
    q = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent select_account",   # always a refresh token, and always the account picker
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if login_hint:
        q["login_hint"] = login_hint
    return AUTH_URL + "?" + urllib.parse.urlencode(q)


def _post(data: Dict[str, str]) -> Dict:
    req = urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode(data).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            body = {}
        raise OAuthError(_explain(body.get("error", ""), body.get("error_description", "") or str(e)))
    except (urllib.error.URLError, OSError) as e:
        raise OAuthError("couldn't reach Google (%s)" % e)


def _explain(error: str, detail: str) -> str:
    if error == "invalid_grant":
        return ("Google signed this inbox out (the sign in was revoked or expired). Press Connect with Google again for it. "
                "If this happens every week, your Google Cloud app is still in Testing: publish it (README)")
    if error in ("invalid_client", "unauthorized_client"):
        return "Google didn't accept the client id or secret. Check them on the dashboard (Connect with Google setup)"
    return "Google said %s%s" % (error or "no", ": %s" % detail if detail else "")


def _email_from_id_token(id_token: str) -> str:
    """The account's address, from the id token Google just sent us over HTTPS (no need to verify its signature)."""
    try:
        payload = id_token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode())
        return str(data.get("email") or "").lower() if data.get("email_verified", True) else ""
    except Exception:  # noqa: BLE001
        return ""


def exchange(client_id: str, client_secret: str, code: str, redirect_uri: str, verifier: str) -> Tuple[str, str]:
    """The code Google sent back -> (email, refresh token)."""
    data = _post({"client_id": client_id, "client_secret": client_secret, "code": code, "code_verifier": verifier,
                  "grant_type": "authorization_code", "redirect_uri": redirect_uri})
    refresh = data.get("refresh_token") or ""
    email = _email_from_id_token(data.get("id_token") or "")
    if not refresh:
        raise OAuthError("Google didn't give a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again")
    if not email:
        raise OAuthError("Google didn't say which account this is")
    if data.get("access_token"):
        _cache[email] = (data["access_token"], time.time() + int(data.get("expires_in") or 3600) - 120)
    return email, refresh


_cache: Dict[str, Tuple[str, float]] = {}
_lock = threading.Lock()


def access_token(email: str, refresh_token: str, cid: str, secret: str) -> str:
    """A working access token for this inbox: the cached one, or a fresh one from its refresh token."""
    with _lock:
        hit = _cache.get(email)
        if hit and hit[1] > time.time():
            return hit[0]
        if not (cid and secret):
            raise OAuthError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing from .env (Connect with Google setup)")
        data = _post({"client_id": cid, "client_secret": secret, "refresh_token": refresh_token, "grant_type": "refresh_token"})
        token = data.get("access_token") or ""
        if not token:
            raise OAuthError("Google gave no access token")
        _cache[email] = (token, time.time() + int(data.get("expires_in") or 3600) - 120)
        return token


def forget(email: str) -> None:
    _cache.pop(email, None)


def token_for(inbox) -> str:
    cid, secret = inbox.oauth_client
    return access_token(inbox.email, inbox.refresh_token, cid, secret)


def login_smtp(server, inbox) -> None:
    """Signs an smtplib connection in with the inbox's Google sign in. A refused token is retried once with a fresh one."""
    import smtplib

    for attempt in range(2):
        token = token_for(inbox)
        try:
            server.auth("XOAUTH2", lambda challenge=None: xoauth2(inbox.username, token), initial_response_ok=True)
            return
        except smtplib.SMTPAuthenticationError:
            forget(inbox.email)
            if attempt:
                raise


def login_imap(conn, inbox) -> None:
    token = token_for(inbox)
    conn.authenticate("XOAUTH2", lambda _: xoauth2(inbox.username, token).encode())


def xoauth2(email: str, token: str) -> str:
    """The SASL XOAUTH2 string Gmail's SMTP and IMAP servers take instead of a password."""
    return "user=%s\x01auth=Bearer %s\x01\x01" % (email, token)
