"""Sending over SMTP: builds a plain text email and sends it from one inbox."""
from __future__ import annotations

import re
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, make_msgid
from typing import List, Optional

from . import clock
from .config import Inbox


class SendError(Exception):
    """kind: auth, recipient (that one address was refused), policy (the server is refusing our mail),
    temporary (try later), network (no connection)."""

    def __init__(self, kind: str, message: str, code: Optional[int] = None):
        super().__init__(message)
        self.kind = kind
        self.code = code


def new_message_id(inbox: Inbox) -> str:
    return make_msgid(domain=inbox.domain)


def build(inbox: Inbox, from_name: str, to: str, subject: str, text: str, message_id: str,
          in_reply_to: Optional[str] = None, references: Optional[List[str]] = None) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, inbox.email))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = format_datetime(clock.now())
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = " ".join(references or [in_reply_to])
    msg.set_content(text, charset="utf-8")
    return msg


def _connect(inbox: Inbox, timeout: int = 30) -> smtplib.SMTP:
    from .config import tls_context

    context = tls_context()
    if inbox.smtp_port == 465:
        server = smtplib.SMTP_SSL(inbox.smtp_host, inbox.smtp_port, timeout=timeout, context=context)
    else:
        server = smtplib.SMTP(inbox.smtp_host, inbox.smtp_port, timeout=timeout)
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
    return server


def _classify(code: Optional[int], text: str) -> str:
    t = (text or "").lower()
    if code in (535, 534, 530) or "authentication" in t or "username and password not accepted" in t or "application-specific password" in t:
        return "auth"
    if any(w in t for w in ("daily user sending limit", "sending limit exceeded", "rate limit", "too many", "quota",
                            "unsolicited", "spam", "blocked", "blacklist", "policy", "reputation", "suspended")):
        return "policy"
    if code and 400 <= code < 500:
        return "temporary"
    return "policy"


BAD_ADDRESS = re.compile(
    r"\b5\.1\.\d\b|does not exist|no such user|user unknown|unknown user|mailbox unavailable|mailbox not found|"
    r"recipient address rejected|invalid recipient|address rejected|no mailbox|unrouteable|account.*(disabled|inactive)",
    re.I,
)


def _recipient_kind(code: Optional[int], text: str) -> str:
    """One address refused: a bad address is a hard bounce, a policy refusal means stop everything."""
    if BAD_ADDRESS.search(text or ""):
        return "recipient"
    kind = _classify(code, text)
    if kind == "policy" and not re.search(r"spam|unsolicited|blocked|blacklist|policy|reputation|limit|quota", text or "", re.I):
        return "recipient"
    return kind


def send(inbox: Inbox, msg: EmailMessage) -> None:
    """Sends one email. Raises SendError with a kind that says what to do next."""
    try:
        server = _connect(inbox)
    except (socket.gaierror, socket.timeout, ConnectionError, OSError) as e:
        raise SendError("network", "could not reach %s: %s" % (inbox.smtp_host, e))
    try:
        try:
            server.login(inbox.username, inbox.password)
        except smtplib.SMTPAuthenticationError as e:
            raise SendError("auth", "the server refused the login: %s" % _text(e.smtp_error), e.smtp_code)
        try:
            refused = server.send_message(msg)
        except smtplib.SMTPRecipientsRefused as e:
            code, err = next(iter(e.recipients.values()))
            text = _text(err)
            raise SendError(_recipient_kind(code, text), "%s %s" % (code, text), code)
        except smtplib.SMTPSenderRefused as e:
            raise SendError(_classify(e.smtp_code, _text(e.smtp_error)), "%s %s" % (e.smtp_code, _text(e.smtp_error)), e.smtp_code)
        except smtplib.SMTPDataError as e:
            text = _text(e.smtp_error)
            raise SendError(_classify(e.smtp_code, text), "%s %s" % (e.smtp_code, text), e.smtp_code)
        except (smtplib.SMTPServerDisconnected, socket.timeout, ConnectionError) as e:
            raise SendError("network", "the connection dropped while sending: %s" % e)
        if refused:
            code, err = next(iter(refused.values()))
            raise SendError(_recipient_kind(code, _text(err)), "%s %s" % (code, _text(err)), code)
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001
            pass


def login_test(inbox: Inbox) -> str:
    """Connects and logs in, then logs out. Sends nothing."""
    try:
        server = _connect(inbox, timeout=20)
    except (socket.gaierror, socket.timeout, ConnectionError, OSError) as e:
        raise SendError("network", "could not reach %s:%s (%s)" % (inbox.smtp_host, inbox.smtp_port, e))
    try:
        server.login(inbox.username, inbox.password)
    except smtplib.SMTPAuthenticationError as e:
        raise SendError("auth", _text(e.smtp_error), e.smtp_code)
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001
            pass
    return "logged in to %s:%s as %s" % (inbox.smtp_host, inbox.smtp_port, inbox.username)


def _text(value) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    return " ".join(str(value or "").split())
