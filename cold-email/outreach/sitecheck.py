"""Checks a lead's homepage and finds true, specific things to say about it.

We only ever claim what we saw: no HTTPS, no mobile viewport, an old copyright year, a slow load,
a broken or parked page, or no way to call or book. If nothing is confirmed, we say nothing specific.
"""
from __future__ import annotations

import html as htmllib
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import clock

try:
    import requests
except ImportError:  # pragma: no cover
    raise SystemExit("Missing packages. Run:  pip install -r requirements.txt")

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
MAX_BYTES = 3 * 1024 * 1024
SLOW_SECONDS = 5.0

# A "website" that is really a social profile, a link page or a map: the lead has no website of its own.
NOT_A_WEBSITE = re.compile(
    r"(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|m\.me|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com|"
    r"twitter\.com|x\.com|linkedin\.com|youtube\.com|youtu\.be|snapchat\.com|t\.me|google\.com|goo\.gl|g\.page|"
    r"g\.co|business\.site|bio\.link|beacons\.ai|taplink\.cc|linkin\.bio|lnk\.bio|campsite\.bio|bit\.ly|"
    r"talabat\.com|deliveroo\.ae|noon\.com|careem\.com|fresha\.com|booksy\.com|tripadvisor\.com|zomato\.com)$",
    re.I,
)

PARKED = [
    re.compile(p, re.I)
    for p in [
        r"domain (name )?(is|may be) for sale", r"buy this domain", r"this domain (has been|is) (registered|parked)",
        r"parked (free|domain)", r"(website|site|page) (is )?(coming soon|under construction|under maintenance)",
        r"^\s*coming soon\s*$", r"account (has been )?suspended", r"index of /", r"welcome to nginx",
        r"apache2? (ubuntu|debian)? ?default page", r"it works!", r"default web site page",
        r"there is no website configured at this address", r"future home of something quite cool",
        r"this site can.t be reached", r"website expired", r"hosting (has )?expired",
    ]
]
BLOCK_MARKERS = re.compile(r"just a moment|attention required|cf-browser-verification|captcha|access denied|are you a robot", re.I)


def normalize_website(raw: str) -> Tuple[str, str]:
    """Returns (website, instagram_handle). Social links are not websites."""
    raw = (raw or "").strip().strip("/")
    if not raw or raw.lower() in ("n/a", "na", "none", "-", "no", "no website"):
        return "", ""
    url = raw if re.match(r"^https?://", raw, re.I) else "http://" + raw
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return "", ""
    if not host or "." not in host:
        return "", ""
    if NOT_A_WEBSITE.search(host):
        ig = ""
        m = re.search(r"instagram\.com/([A-Za-z0-9._]{1,30})", url, re.I)
        if m and m.group(1).lower() not in ("p", "reel", "reels", "stories", "explore"):
            ig = m.group(1)
        return "", ig
    return url, ""


def host_of(url: str) -> str:
    try:
        return (urlparse(url if "//" in url else "http://" + url).hostname or "").lower()
    except ValueError:
        return ""


def _error_kind(exc: Exception) -> str:
    text = repr(exc)
    if isinstance(exc, requests.exceptions.SSLError):
        return "ssl"
    if isinstance(exc, (requests.exceptions.ConnectTimeout, requests.exceptions.ReadTimeout, requests.exceptions.Timeout)):
        return "timeout"
    if isinstance(exc, requests.exceptions.TooManyRedirects):
        return "redirects"
    if re.search(r"NameResolution|Name or service not known|nodename nor servname|getaddrinfo failed|Failed to resolve|No address associated", text):
        return "dns"
    if isinstance(exc, requests.exceptions.ConnectionError):
        return "connection"
    return "other"


def _decode(body: bytes, content_type: str) -> str:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    enc = m.group(1) if m else None
    if not enc:
        m = re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", body[:4096], re.I)
        enc = m.group(1).decode("ascii", "ignore") if m else "utf-8"
    try:
        return body.decode(enc, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def fetch(url: str, timeout: float = 15.0) -> Dict:
    """One GET. Returns status, final URL, html, seconds, headers, or an error kind."""
    t0 = time.monotonic()
    try:
        with requests.get(url, headers=HEADERS, timeout=(8, timeout), allow_redirects=True, stream=True) as r:
            chunks, size = [], 0
            for chunk in r.iter_content(65536):
                chunks.append(chunk)
                size += len(chunk)
                if size >= MAX_BYTES:
                    break
            body = b"".join(chunks)
            return {
                "status": r.status_code,
                "final_url": r.url,
                "html": _decode(body, r.headers.get("content-type", "")),
                "bytes": size,
                "seconds": round(time.monotonic() - t0, 2),
                "headers": {k.lower(): v for k, v in r.headers.items()},
                "error": None,
            }
    except Exception as e:  # noqa: BLE001 - every failure is a result here
        return {"status": None, "error": _error_kind(e), "seconds": round(time.monotonic() - t0, 2), "detail": str(e)[:200]}


def _attr(tag: str, name: str) -> Optional[str]:
    m = re.search(r"\s%s\s*=\s*(\"([^\"]*)\"|'([^']*)'|([^\s>]+))" % name, tag, re.I)
    if not m:
        return None
    return htmllib.unescape(m.group(2) if m.group(2) is not None else m.group(3) if m.group(3) is not None else m.group(4) or "").strip()


def _tags(html: str, name: str) -> List[str]:
    return re.findall(r"<%s\b[^>]*>" % name, html, re.I)


def visible_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|template|svg)\b.*?</\1>", " ", html)
    html = re.sub(r"(?s)<!--.*?-->", " ", html)
    text = htmllib.unescape(re.sub(r"<[^>]+>", " ", html))
    return re.sub(r"\s+", " ", text).strip()


COPYRIGHT_RE = re.compile(
    r"(?:©|&copy;|\(c\)|copyright)(?:\s|©|&copy;|\(c\)|:)*((?:19|20)\d{2})(?:\s*(?:-|–|—|to|/)\s*((?:19|20)\d{2}))?",
    re.I,
)
OLD_TECH = [
    ("font tags", re.compile(r"<font\b", re.I)),
    ("center tags", re.compile(r"<center\b", re.I)),
    ("marquee", re.compile(r"<marquee\b", re.I)),
    ("frames", re.compile(r"<frameset\b", re.I)),
    ("flash", re.compile(r"\.swf\b|shockwave-flash", re.I)),
    ("old jquery", re.compile(r"jquery[-.]?1\.[0-8]\.\d|jquery/1\.[0-8]\.", re.I)),
]
OLD_BUILDERS = re.compile(r"weebly\.com|editmysite\.com|site123|jimdo|homestead\.com|yola|moonfruit|webs\.com|frontpage", re.I)
CONTACT_HREF = re.compile(r"^(tel:|mailto:|sms:|whatsapp:)|wa\.me|api\.whatsapp\.com|whatsapp\.com/send", re.I)
CONTACT_WORDS = re.compile(
    r"contact|book|booking|reserve|reservation|appointment|enquir|inquir|get in touch|call us|call now|whatsapp|"
    r"order now|quote|تواصل|اتصل|احجز",
    re.I,
)
BOOKING_WIDGETS = re.compile(
    r"calendly|fresha|booksy|setmore|simplybook|square\.site|squareup\.com/appointments|typeform|jotform|hsforms|"
    r"wpforms|contact-form-7|wpcf7|gform_|opentable|sevenrooms|eat app|eatapp|tablecheck|zenchef|vagaro|mindbody|"
    r"elfsight|getbutton|wa-widget|whatsapp-button|tidio|intercom|crisp\.chat|tawk\.to|livechat",
    re.I,
)


def analyse_html(html: str, final_url: str, seconds: float, this_year: Optional[int] = None) -> Dict:
    """Everything we can say about one homepage, from its HTML alone."""
    this_year = this_year or clock.today().year
    text = visible_text(html)
    words = len(text.split()) if text else 0
    head = re.split(r"</head>", html, maxsplit=1, flags=re.I)[0]
    out: Dict = {"words": words, "final_url": final_url, "seconds": seconds}

    out["https"] = final_url.lower().startswith("https://")

    viewport = next((_attr(t, "content") or "" for t in _tags(html, "meta") if (_attr(t, "name") or "").lower() == "viewport"), None)
    out["viewport"] = viewport
    out["mobile"] = bool(viewport and re.search(r"width\s*=\s*device-width", viewport, re.I))

    parked = None
    if words < 400:
        sample = text if words < 120 else text[:800]
        for p in PARKED:
            m = p.search(sample)
            if m:
                parked = m.group(0).strip()[:60]
                break
    out["parked"] = parked
    out["coming_soon"] = bool(parked and re.search(r"coming soon|under construction|under maintenance", parked, re.I))

    out["spa"] = words < 60 and bool(re.search(r"<div[^>]+id=[\"'](root|app|__next|__nuxt|svelte)[\"'][^>]*>\s*</div>", html, re.I))

    # Copyright year. Skipped when the page fills the year in with JavaScript (the visitor sees this year).
    years = []
    for m in COPYRIGHT_RE.finditer(text):
        years += [int(y) for y in m.groups() if y]
    out["copyright_year"] = max(years) if years else None
    out["year_is_dynamic"] = bool(re.search(r"getFullYear|new Date\(\)\.getYear|date\(['\"]Y", html))

    # A way to call, message or book.
    anchors = []
    for t in _tags(html, "a"):
        anchors.append(_attr(t, "href") or "")
    link_texts = re.findall(r"<a\b[^>]*>(.*?)</a>", html, re.I | re.S)
    has_contact = (
        any(CONTACT_HREF.search(h) for h in anchors)
        or any(CONTACT_WORDS.search(h) for h in anchors)
        or any(CONTACT_WORDS.search(visible_text(t)) for t in link_texts)
        or bool(re.search(r"<form\b", html, re.I))
        or bool(BOOKING_WIDGETS.search(html))
        or bool(re.search(r"<button\b[^>]*>[^<]*(book|call|contact|whatsapp|enquire|reserve)", html, re.I))
    )
    out["has_contact"] = has_contact

    # Small signs of an old or neglected site. None of these is ever named in an email.
    old = [name for name, rx in OLD_TECH if rx.search(html)]
    if OLD_BUILDERS.search(html):
        old.append("old site builder")
    out["old_tech"] = old
    weak = []
    meta_desc = next((_attr(t, "content") for t in _tags(html, "meta") if (_attr(t, "name") or "").lower() == "description"), None)
    if not meta_desc:
        weak.append("no meta description")
    if not any((_attr(t, "property") or _attr(t, "name") or "").lower() == "og:image" for t in _tags(html, "meta")):
        weak.append("no share image")
    if not any("icon" in (_attr(t, "rel") or "").lower() for t in _tags(head, "link")):
        weak.append("no favicon")
    if not out["spa"] and not re.search(r"<h1\b", html, re.I):
        weak.append("no main heading")
    if not re.search(r"<title[^>]*>\s*\S", html, re.I):
        weak.append("no page title")
    if 3.0 <= seconds < SLOW_SECONDS:
        weak.append("a bit slow")
    if len(html) > 500_000:
        weak.append("very heavy page")
    out["weak"] = weak
    return out


def check_site(url: str, timeout: float = 15.0) -> Dict:
    """Fetches the homepage (https first, then http) and analyses it. Never raises."""
    host = host_of(url)
    result: Dict = {"url": url, "host": host, "checked_at": clock.iso()}
    if not host:
        result.update(state="invalid")
        return result

    def attempt(h: str, t: float) -> Tuple[Dict, Optional[str]]:
        r = fetch("https://%s/" % h, t)
        https_error = None
        if r["status"] is None:
            https_error = r["error"]
            r2 = fetch("http://%s/" % h, t)
            if r2["status"] is not None or r2["error"] != "dns":
                r = r2 if r2["status"] is not None else r
        return r, https_error

    r, https_error = attempt(host, timeout)
    if r["status"] is None and r["error"] == "dns":  # try with or without www.
        alt = host[4:] if host.startswith("www.") else "www." + host
        r2, e2 = attempt(alt, timeout)
        if r2["status"] is not None:
            r, https_error, host = r2, e2, alt
    if r["status"] is None or (r["status"] >= 500 or r["status"] in (404, 410)):
        clock.sleep(3)  # one more try before we ever say a site is down
        r2, e2 = attempt(host, timeout + 10)
        if r2["status"] is not None and (r["status"] is None or r2["status"] < r["status"]):
            r, https_error = r2, e2
        elif r["status"] is None and r2["status"] is None:
            r = r2

    result["https_error"] = https_error
    if r["status"] is None:
        result.update(state="down", error=r["error"], detail=r.get("detail", ""))
        return result

    status = r["status"]
    result.update(status=status, final_url=r["final_url"], server=r["headers"].get("server", ""))
    blocked = status in (401, 403, 406, 429) or (
        status in (503, 520, 521, 522, 523, 525) and ("cf-ray" in r["headers"] or BLOCK_MARKERS.search(r["html"][:5000] or ""))
    )
    if blocked:
        result.update(state="blocked")  # a bot wall: we cannot see the site, so we claim nothing
        return result
    if status >= 400:
        result.update(state="error")
        return result

    seconds = r["seconds"]
    if seconds >= SLOW_SECONDS:  # measure again: we only call it slow if it is slow twice
        again = fetch(r["final_url"], timeout)
        if again["status"] and again["status"] < 400:
            seconds = min(seconds, again["seconds"])
    info = analyse_html(r["html"], r["final_url"], seconds)
    if info["https"] is False and https_error == "ssl":
        info["cert_problem"] = True
    result.update(state="ok", **info)
    return result
