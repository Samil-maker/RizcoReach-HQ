"""Is this email address worth sending to? Catches the addresses that bounce or reach nobody, before they're imported.

    email, fixed, problem = clean(cell)

  email    the address to use ("" when the cell has none we'd send to)
  fixed    what was corrected, for example "gmial.com to gmail.com" ("" when nothing was)
  problem  why nothing usable was found ("" when an address was found)

What it does, in order:
  1. Tidies the cell: mailto:, spaces, brackets, "info [at] shop [dot] com", leftovers from copying
     web pages (u003e, %20, invisible characters), several addresses in one cell (it takes the first good one).
  2. Fixes typos that can only mean one thing: gmial.com, hotmial.com, yahooo.com, outlok.com, shop.con
     (the domain is then still checked for MX records, so a wrong fix can't slip through).
  3. Checks the format properly: one @, nothing before or after it that mail servers refuse, a real looking domain.
  4. Leaves out addresses that never reach the business: placeholders (name@domain.com, test@), no reply and
     system addresses, image file names (logo@2x.png), website platform and app addresses (wix, sentry,
     facebook, talabat...), and info@ or sales@ at gmail.com and the like (somebody's personal inbox, not theirs).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional, Tuple
from urllib.parse import unquote

from . import config

INVISIBLE = re.compile("[​‌‍⁠﻿­]")
OBFUSCATED_AT = re.compile(r"\s*[\[\(\{<]\s*(at|@)\s*[\]\)\}>]\s*", re.I)
OBFUSCATED_DOT = re.compile(r"\s*[\[\(\{<]\s*(dot|\.)\s*[\]\)\}>]\s*", re.I)
WEB_LEFTOVERS = re.compile(r"^(\\?u003[ce]|\\?u0022|\\?x22|&lt;|&gt;|&quot;)+", re.I)
EDGE_JUNK = "<>()[]{}\"'`.,!?*:;\\/|"

LOCAL = re.compile(r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$")
LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
TLD = re.compile(r"^([a-z]{2,24}|xn--[a-z0-9-]{2,59})$")

JUNK_DOMAIN = re.compile(
    r"(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.\w+|yoursite\.\w+|mysite\.com|website\.com|"
    r"company\.com|yourcompany\.\w+|test\.com|sentry\.io|wixpress\.com|wix\.com|wixsite\.com|godaddy\.com|"
    r"secureserver\.net|squarespace\.com|weebly\.com|jimdo\.com|shopify\.com|wordpress\.(com|org)|mailchimp\.com|"
    r"sendgrid\.net|amazonses\.com|mailgun\.org|hubspot\.com|zendesk\.com|cloudflare\.com|w3\.org|schema\.org|"
    r"github\.com|gravatar\.com|facebook\.com|fb\.com|instagram\.com|google\.com|apple\.com|microsoft\.com|"
    r"linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|whatsapp\.com|amazon\.(com|ae)|booking\.com|"
    r"tripadvisor\.(com|ae)|talabat\.com|deliveroo\.(ae|com|co\.uk)|careem\.com|zomato\.com|noon\.com|"
    r"dubizzle\.com|bayut\.com|propertyfinder\.ae|yelp\.com|fresha\.com|booksy\.com|vagaro\.com|opentable\.com)$"
)
JUNK_USER = re.compile(
    r"^(filler|name|your|yourname|youremail|you|user|username|email|e-?mail|test|testing|example|sample|someone|"
    r"john\.?doe|jane\.?doe|first\.?last|firstname|no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|"
    r"postmaster|abuse|bounces?|unsubscribe|privacy|legal|dpo|webmaster|hostmaster|wordpress)$"
)
FILE_ENDING = re.compile(r"\.(png|jpe?g|gif|webp|svg|bmp|ico|css|js|json|php|html?|pdf|mp4|woff2?)$")
HASH_USER = re.compile(r"^[a-f0-9]{16,}$|[a-f0-9]{24,}")
# Shared business words that, at a personal mail provider, are somebody's own inbox and not the business you found
GENERIC_USER = re.compile(r"^(info|sales|contact|admin|support|hello|office|enquir(y|ies)|inquir(y|ies)|booking|bookings|"
                          r"reservations?|marketing|team|mail|help|service|customer\.?service)$")

# Typos of the big mailbox providers. Only these get corrected: for them it is clear what was meant.
PROVIDERS = ("gmail", "hotmail", "yahoo", "outlook", "icloud", "googlemail")
TLD_TYPOS = {"con": "com", "cmo": "com", "comm": "com", "coom": "com", "vom": "com", "xom": "com", "cpm": "com",
             "c0m": "com", "ocm": "com", "comn": "com", "cim": "com", "clm": "com", "ckm": "com",
             "nett": "net", "ogr": "org", "ea": "ae"}
PROVIDER_TLD_TYPOS = {"co", "cm", "om", "c", "cmo", "con", "comm", "cpm", "ocm"}
# Real words and services that look like a provider typo but aren't one (cloud.com is not icloud.com)
NOT_TYPOS = {"email", "mail", "cloud", "gmall", "ymail", "rmail", "fmail", "hmail", "yahoo", "outlook"}


def _distance(a: str, b: str) -> int:
    """Typing distance between two words (a swap of two neighbouring letters counts as one)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[-1][-1]


def fix_domain(domain: str) -> str:
    """The domain with obvious typos corrected (unchanged when there are none)."""
    domain = re.sub(r"\.{2,}", ".", domain).strip(".-")
    if domain in config.FREE_DOMAINS:
        return domain
    labels = domain.split(".")
    if len(labels) >= 2 and labels[-1] in TLD_TYPOS:
        labels[-1] = TLD_TYPOS[labels[-1]]
    if len(labels) == 3 and labels[-2:] == ["com", "com"]:   # gmail.com.com
        labels = labels[:2]
    if len(labels) == 2:
        name, tld = labels
        if name not in PROVIDERS and name not in NOT_TYPOS and not JUNK_DOMAIN.search(domain) \
                and ("%s.%s" % (name, tld)) not in config.FREE_DOMAINS:
            best = min(PROVIDERS, key=lambda p: _distance(name, p))
            allowed = 2 if len(best) >= 7 else 1
            if _distance(name, best) <= allowed and len(name) >= 4:
                name = best
        if name in PROVIDERS and tld in PROVIDER_TLD_TYPOS:
            tld = "com"
        labels = [name, tld]
    return ".".join(labels)


def _well_formed(email: str) -> bool:
    if email.count("@") != 1 or len(email) > 254:
        return False
    user, domain = email.split("@")
    if not 1 <= len(user) <= 64 or not LOCAL.match(user):
        return False
    labels = domain.split(".")
    return len(labels) >= 2 and all(LABEL.match(l) for l in labels) and bool(TLD.match(labels[-1]))


def why_not(email: str) -> Optional[str]:
    """Why a well formed address should still not be emailed, or None when it's fine."""
    user, domain = email.split("@")
    if FILE_ENDING.search(domain):
        return "not an email (an image or file name)"
    if JUNK_USER.match(user):
        return "placeholder or no reply address"
    if JUNK_DOMAIN.search(domain):
        return "a website platform or app address, not the business"
    if HASH_USER.search(user):
        return "not a person or business (a code from a website)"
    if domain in config.FREE_DOMAINS and GENERIC_USER.match(user):
        return "%s at %s is somebody's own inbox, not the business" % (user, domain)
    return None


def _tidy(cell: str) -> str:
    text = unicodedata.normalize("NFKC", cell or "")
    text = INVISIBLE.sub("", text).replace(" ", " ").lower()
    if "%" in text:
        text = unquote(text)
    text = OBFUSCATED_AT.sub("@", text)
    text = OBFUSCATED_DOT.sub(".", text)
    text = re.sub(r"mailto:", " ", text)
    text = re.sub(r"\?(subject|body|cc|bcc)=\S*", " ", text)
    text = re.sub(r"\s*@\s*", "@", text)  # "info @ shop.com"
    return text


def clean(cell: str) -> Tuple[str, str, str]:
    """(email, fixed, problem). See the top of this file."""
    candidates = [c for c in re.split(r"[\s,;|]+|(?<=\w)/(?=\w+@)", _tidy(cell)) if "@" in c]
    if not candidates:
        return "", "", "no email"
    problem = "email format is broken (typo or missing part)"
    for raw in candidates:
        c = raw.strip(EDGE_JUNK)
        c = WEB_LEFTOVERS.sub("", c).strip(EDGE_JUNK)
        if ":" in c:
            c = c.rsplit(":", 1)[1]  # "email:info@shop.com"
        if c.count("@") != 1:
            continue
        user, domain = c.split("@")
        user = user.strip(EDGE_JUNK)
        fixed_domain = fix_domain(domain.strip(EDGE_JUNK))
        email = "%s@%s" % (user, fixed_domain)
        if not _well_formed(email):
            continue
        reason = why_not(email)
        if reason:
            problem = reason
            continue
        fixed = "%s to %s" % (domain, fixed_domain) if fixed_domain != domain.strip(EDGE_JUNK) else ""
        return email, fixed, ""
    return "", "", problem
