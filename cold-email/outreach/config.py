"""Settings from .env, folder locations and the sending inboxes.

Passwords are only ever read from .env. Nothing here prints them.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(os.environ.get("OUTREACH_ROOT") or Path(__file__).resolve().parent.parent)


def set_root(path) -> None:
    global ROOT
    ROOT = Path(path)


def path(*parts: str) -> Path:
    return ROOT.joinpath(*parts)


def db_path() -> Path:
    return path("data", "outreach.db")


def leads_inbox() -> Path:
    return path("leads", "inbox")


def leads_processed() -> Path:
    return path("leads", "processed")


def reports_dir() -> Path:
    return path("reports")


def logs_dir() -> Path:
    return path("logs")


def suppression_csv() -> Path:
    return path("suppression.csv")


DEFAULT_EXAMPLES_LINK = "https://drive.google.com/drive/folders/1n7bsLjcPoeZJls_nX_HKGQHmSDcseagz"

# Personal mailbox domains. Cold email from these is a high spam risk, so they get a hard cap.
FREE_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com",
    "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "zoho.com", "zohomail.com", "yandex.com",
    "proton.me", "protonmail.com", "gmx.com", "mail.com",
}
FREE_INBOX_CAP = 20

PROVIDERS: Dict[str, dict] = {
    "gmail": {
        "label": "Gmail", "smtp_host": "smtp.gmail.com", "smtp_port": 465,
        "imap_host": "imap.gmail.com", "imap_port": 993,
        "dkim": ["20230601", "20210112", "google"], "spf": ["_spf.google.com"],
    },
    "workspace": {
        "label": "Google Workspace", "smtp_host": "smtp.gmail.com", "smtp_port": 465,
        "imap_host": "imap.gmail.com", "imap_port": 993,
        "dkim": ["google"], "spf": ["_spf.google.com"],
    },
    "zoho": {
        "label": "Zoho Mail", "smtp_host": "smtppro.zoho.com", "smtp_port": 465,
        "imap_host": "imappro.zoho.com", "imap_port": 993,
        "dkim": ["zmail", "zoho", "default", "mail", "selector1"], "spf": ["zoho"],
    },
    "zoho-eu": {
        "label": "Zoho Mail (EU)", "smtp_host": "smtppro.zoho.eu", "smtp_port": 465,
        "imap_host": "imappro.zoho.eu", "imap_port": 993,
        "dkim": ["zmail", "zoho", "default", "mail", "selector1"], "spf": ["zoho"],
    },
    "zoho-in": {
        "label": "Zoho Mail (India)", "smtp_host": "smtppro.zoho.in", "smtp_port": 465,
        "imap_host": "imappro.zoho.in", "imap_port": 993,
        "dkim": ["zmail", "zoho", "default", "mail", "selector1"], "spf": ["zoho"],
    },
    "custom": {
        "label": "Custom SMTP/IMAP", "smtp_host": "", "smtp_port": 465, "imap_host": "", "imap_port": 993,
        "dkim": ["default", "mail", "dkim", "selector1", "selector2", "s1", "s2", "k1"], "spf": [],
    },
}


@dataclass
class Inbox:
    key: str                 # "inbox1"
    email: str
    password: str = field(repr=False)
    provider: str
    username: str
    smtp_host: str
    smtp_port: int
    imap_host: str
    imap_port: int
    cap_override: Optional[int] = None
    dkim_selector: str = ""
    save_to_sent: bool = False

    @property
    def domain(self) -> str:
        return self.email.split("@")[-1].lower()

    @property
    def is_free(self) -> bool:
        return self.domain in FREE_DOMAINS

    @property
    def is_google(self) -> bool:
        return self.provider in ("gmail", "workspace") or self.smtp_host.endswith("gmail.com")

    @property
    def label(self) -> str:
        return PROVIDERS.get(self.provider, PROVIDERS["custom"])["label"]

    @property
    def dkim_selectors(self) -> List[str]:
        own = [self.dkim_selector] if self.dkim_selector else []
        return own + [s for s in PROVIDERS.get(self.provider, PROVIDERS["custom"])["dkim"] if s not in own]

    @property
    def spf_includes(self) -> List[str]:
        return PROVIDERS.get(self.provider, PROVIDERS["custom"])["spf"]

    @property
    def has_imap(self) -> bool:
        return bool(self.imap_host and self.password)


@dataclass
class Settings:
    from_name: str = "Samil"
    company: str = "RizcoReach"
    whatsapp: str = ""
    examples_link: str = DEFAULT_EXAMPLES_LINK
    test_email_to: str = ""
    save_drafts: bool = True
    inboxes: List[Inbox] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)   # must be fixed before sending
    warnings: List[str] = field(default_factory=list)   # worth knowing

    def inbox(self, key: str) -> Optional[Inbox]:
        return next((i for i in self.inboxes if i.key == key), None)


def _int(value: Optional[str]) -> Optional[int]:
    value = (value or "").strip()
    return int(value) if value.isdigit() else None


def _yes(value: Optional[str], default: bool) -> bool:
    value = (value or "").strip().lower()
    if not value:
        return default
    return value in ("1", "yes", "y", "true", "on")


def guess_provider(email: str) -> str:
    domain = email.split("@")[-1].lower()
    if domain in ("gmail.com", "googlemail.com"):
        return "gmail"
    if domain in ("zoho.com", "zohomail.com"):
        return "zoho"
    return "custom"


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def load_settings(env: Optional[Dict[str, str]] = None) -> Settings:
    if env is None:
        try:
            from dotenv import load_dotenv
        except ImportError:  # pragma: no cover
            raise SystemExit("Missing packages. Run:  pip install -r requirements.txt")
        load_dotenv(path(".env"))
        env = dict(os.environ)
    get = lambda k, d="": (env.get(k) or d).strip()  # noqa: E731

    s = Settings(
        from_name=get("FROM_NAME", "Samil"),
        whatsapp=get("WHATSAPP_NUMBER"),
        examples_link=get("EXAMPLES_LINK", DEFAULT_EXAMPLES_LINK),
        test_email_to=get("TEST_EMAIL_TO").lower(),
        save_drafts=_yes(env.get("SAVE_DRAFTS"), True),
    )
    if not path(".env").exists() and "INBOX1_EMAIL" not in env:
        s.problems.append("There is no .env file yet. Copy .env.example to .env and fill it in (README step 3).")
    if not s.whatsapp:
        s.problems.append("WHATSAPP_NUMBER is empty in .env. It goes under your name in every email.")

    for n in range(1, 10):
        p = "INBOX%d_" % n
        email = get(p + "EMAIL").lower()
        if not email:
            continue
        key = "inbox%d" % n
        if not EMAIL_RE.match(email):
            s.problems.append("%sEMAIL (%s) does not look like an email address." % (p, email))
            continue
        provider = get(p + "PROVIDER").lower() or guess_provider(email)
        if provider not in PROVIDERS:
            s.problems.append("%sPROVIDER is %r. Use one of: %s." % (p, provider, ", ".join(PROVIDERS)))
            provider = "custom"
        preset = PROVIDERS[provider]
        password = get(p + "APP_PASSWORD") or get(p + "PASSWORD")
        if provider in ("gmail", "workspace"):
            password = password.replace(" ", "")  # Google shows App Passwords in groups of 4
        inbox = Inbox(
            key=key,
            email=email,
            password=password,
            provider=provider,
            username=get(p + "USERNAME") or email,
            smtp_host=get(p + "SMTP_HOST") or preset["smtp_host"],
            smtp_port=_int(env.get(p + "SMTP_PORT")) or preset["smtp_port"],
            imap_host=get(p + "IMAP_HOST") or preset["imap_host"],
            imap_port=_int(env.get(p + "IMAP_PORT")) or preset["imap_port"],
            cap_override=_int(env.get(p + "DAILY_CAP")),
            dkim_selector=get(p + "DKIM_SELECTOR"),
            save_to_sent=_yes(env.get(p + "SAVE_TO_SENT"), False),
        )
        if not password:
            s.problems.append("%sAPP_PASSWORD is empty for %s (README step 3 shows how to get one)." % (p, email))
        if not inbox.smtp_host or not inbox.imap_host:
            s.problems.append("%s needs %sSMTP_HOST and %sIMAP_HOST (provider is custom)." % (email, p, p))
        if provider == "gmail" and not inbox.is_free:
            s.warnings.append("%s is not an @gmail.com address. If it is Google Workspace set %sPROVIDER=workspace." % (email, p))
        if inbox.is_free:
            s.warnings.append(
                "%s is a free personal address. Cold email from free addresses is a HIGH spam risk: Gmail and "
                "Outlook trust it less and one bad week can get it locked. Best fix: buy a separate domain just for "
                "outreach (not rizcoreach.ae, so your main domain stays safe) with a Google Workspace or paid Zoho "
                "inbox. Until then this inbox is capped at %d emails a day whatever you set." % (email, FREE_INBOX_CAP)
            )
        s.inboxes.append(inbox)

    if not s.inboxes and not any("no .env" in p for p in s.problems):
        s.problems.append("No sending inbox in .env. Fill in INBOX1_EMAIL and INBOX1_APP_PASSWORD.")
    if s.test_email_to and not EMAIL_RE.match(s.test_email_to):
        s.problems.append("TEST_EMAIL_TO (%s) does not look like an email address." % s.test_email_to)
    return s


def mask(secret: str) -> str:
    """For showing that a password is set without showing it."""
    return "(set, %d characters)" % len(secret) if secret else "(empty)"
