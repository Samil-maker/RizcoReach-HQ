"""Reading your inbox over IMAP. Messages are read with PEEK, so nothing is marked as read."""
from __future__ import annotations

import imaplib
import re
import socket
import time
from datetime import date
from email.message import EmailMessage
from typing import Dict, Iterable, List, Optional, Tuple

from .config import Inbox

HEADER_FIELDS = (
    "FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND "
    "PRECEDENCE X-FAILED-RECIPIENTS CONTENT-TYPE RETURN-PATH"
)
LIST_RE = re.compile(r'\((?P<flags>[^)]*)\)\s+(?P<delim>"[^"]*"|NIL)\s+(?P<name>.+)$')
FALLBACK = {
    "\\Junk": ["[Gmail]/Spam", "Spam", "Junk", "Junk E-mail", "INBOX.Spam", "INBOX.Junk"],
    "\\Sent": ["[Gmail]/Sent Mail", "Sent", "Sent Items", "Sent Messages", "INBOX.Sent"],
    "\\Drafts": ["[Gmail]/Drafts", "Drafts", "Draft", "INBOX.Drafts"],
}


class MailboxError(Exception):
    pass


def _quote(name: str) -> str:
    return '"%s"' % name.replace("\\", "\\\\").replace('"', '\\"')


def imap_date(day: date) -> str:
    return "%d-%s-%d" % (day.day, ("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())[day.month - 1], day.year)


class Mailbox:
    def __init__(self, inbox: Inbox):
        self.inbox = inbox
        self.conn: Optional[imaplib.IMAP4_SSL] = None
        self._folders: Optional[List[Tuple[str, str]]] = None

    def __enter__(self) -> "Mailbox":
        try:
            from .config import tls_context

            self.conn = imaplib.IMAP4_SSL(self.inbox.imap_host, self.inbox.imap_port, ssl_context=tls_context(), timeout=30)
        except TypeError:  # Python 3.8 has no timeout argument
            socket.setdefaulttimeout(30)
            self.conn = imaplib.IMAP4_SSL(self.inbox.imap_host, self.inbox.imap_port)
        except (OSError, imaplib.IMAP4.error) as e:
            raise MailboxError("could not reach %s:%s (%s)" % (self.inbox.imap_host, self.inbox.imap_port, e))
        try:
            self.conn.login(self.inbox.username, self.inbox.password)
        except imaplib.IMAP4.error as e:
            raise MailboxError("the IMAP server refused the login: %s" % _s(e))
        return self

    def __exit__(self, *exc) -> None:
        try:
            self.conn.logout()
        except Exception:  # noqa: BLE001
            pass

    def folders(self) -> List[Tuple[str, str]]:
        """[(name, flags)]"""
        if self._folders is None:
            typ, data = self.conn.list()
            out = []
            for raw in data or []:
                line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
                m = LIST_RE.match(line)
                if not m:
                    continue
                name = m.group("name").strip()
                if name.startswith('"') and name.endswith('"'):
                    name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
                out.append((name, m.group("flags")))
            self._folders = out
        return self._folders

    def special(self, flag: str) -> Optional[str]:
        """The folder with a special use flag (\\Junk, \\Sent, \\Drafts), else a usual name."""
        for name, flags in self.folders():
            if flag.lower() in flags.lower():
                return name
        names = {n.lower(): n for n, _ in self.folders()}
        for guess in FALLBACK.get(flag, []):
            if guess.lower() in names:
                return names[guess.lower()]
        return None

    def select(self, folder: str) -> bool:
        typ, _ = self.conn.select(_quote(folder), readonly=True)
        return typ == "OK"

    def uidvalidity(self) -> str:
        """Changes if the server renumbers the folder (then we start that folder over)."""
        try:
            _, data = self.conn.response("UIDVALIDITY")
            return (data[0].decode() if isinstance(data[0], bytes) else str(data[0])) if data and data[0] else ""
        except Exception:  # noqa: BLE001
            return ""

    def search(self, *criteria: str) -> List[bytes]:
        typ, data = self.conn.uid("SEARCH", None, *criteria)
        if typ != "OK" or not data or not data[0]:
            return []
        return data[0].split()

    def headers(self, uids: List[bytes]) -> Dict[bytes, bytes]:
        out: Dict[bytes, bytes] = {}
        for i in range(0, len(uids), 100):
            chunk = b",".join(uids[i:i + 100]).decode()
            typ, data = self.conn.uid("FETCH", chunk, "(BODY.PEEK[HEADER.FIELDS (%s)])" % HEADER_FIELDS)
            for item in data or []:
                if isinstance(item, tuple):
                    m = re.search(rb"UID (\d+)", item[0])
                    if m:
                        out[m.group(1)] = item[1]
        return out

    def full(self, uid: bytes) -> Optional[bytes]:
        typ, data = self.conn.uid("FETCH", uid.decode(), "(BODY.PEEK[])")
        for item in data or []:
            if isinstance(item, tuple):
                return item[1]
        return None

    def append(self, folder: str, msg: EmailMessage, flags: str = "") -> bool:
        typ, _ = self.conn.append(_quote(folder), flags, imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        return typ == "OK"

    def sent_to_since(self, address: str, since: date, exclude_ids: Iterable[str] = ()) -> bool:
        """True if you emailed this address yourself since that day (not counting our own emails)."""
        folder = self.special("\\Sent")
        if not folder or not self.select(folder):
            return False
        uids = self.search("SINCE", imap_date(since), "TO", _quote(address))
        if not uids:
            return False
        exclude = {e.strip() for e in exclude_ids}
        for raw in self.headers(uids).values():
            m = re.search(rb"^Message-ID:\s*(<[^>]+>)", raw, re.I | re.M)
            if not m or m.group(1).decode("utf-8", "replace") not in exclude:
                return True
        return False


def _s(e: Exception) -> str:
    v = e.args[0] if e.args else e
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def login_test(inbox: Inbox) -> str:
    with Mailbox(inbox) as mb:
        spam = mb.special("\\Junk") or "not found"
        sent = mb.special("\\Sent") or "not found"
        drafts = mb.special("\\Drafts") or "not found"
        if not mb.select("INBOX"):
            raise MailboxError("logged in but could not open INBOX")
    return "logged in to %s as %s. Folders: spam=%s, sent=%s, drafts=%s" % (inbox.imap_host, inbox.username, spam, sent, drafts)
