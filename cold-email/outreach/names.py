"""Turning messy lead data into words that read naturally in an email.

  "AL NOOR BEAUTY SALON L.L.C"                     -> "Al Noor Beauty Salon"
  "Dr. Smile Dental Clinic - Best Dentist in Dubai" -> "Dr. Smile Dental Clinic"
  "Glossy PPF | Ceramic Coating | Dubai"            -> "Glossy PPF"
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional, Tuple

DASHES = "-‐‑‒–—―−"
_DASH_RE = re.compile("[%s]" % re.escape(DASHES))

LEGAL_END = re.compile(
    r"[\s,]+(l\.?\s?l\.?\s?c\.?|fz\s?llc|fz\s?co|fzco|fze|fzc|dmcc|est\.?|establishment|ltd\.?|limited|s\.?p\.?c\.?)$",
    re.I,
)
PLACE_END = re.compile(r"[\s,]+(dubai|uae|u\.a\.e\.?|abu dhabi|sharjah|ajman)$", re.I)
SPLIT = re.compile(r"\s[%s|:·]\s|\s*\|\s*|\s\(|\s*·\s*|\s*•\s*" % re.escape(DASHES))
ACRONYMS = {"ac", "uae", "ksa", "vip", "difc", "usa", "uk", "jlt", "jbr", "jvc", "bmw", "ppf", "it", "pr", "hr", "dxb", "auh"}


def no_dashes(text: str) -> str:
    """Our emails never contain dashes, so names lose theirs: Al-Noor becomes Al Noor."""
    return re.sub(r"\s+", " ", _DASH_RE.sub(" ", text or "")).strip()


def _strip_symbols(text: str) -> str:
    """Removes emojis, trademark signs and other symbols that Instagram names are full of."""
    return "".join(ch for ch in text if not unicodedata.category(ch).startswith(("So", "Sk", "Cs", "Co", "Cn")))


def _is_acronym(word: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", word)
    return bool(letters) and (not re.search(r"[aeiouy]", letters, re.I) or letters.lower() in ACRONYMS)


def clean_business(name: str) -> str:
    full = re.sub(r"\s+", " ", _strip_symbols(name or "")).strip()
    if not full:
        return ""
    s = SPLIT.split(full)[0].strip() or full
    prev = None
    while prev != s:
        prev = s
        s = LEGAL_END.sub("", s).rstrip(" ,.")
        rest = PLACE_END.sub("", s).rstrip(" ,.")
        if len(rest.split()) >= 2:  # "Glossy Dubai" keeps its city
            s = rest
    s = no_dashes(s)
    if re.search(r"[A-Z]", s) and not re.search(r"[a-z]", s):  # ALL CAPS
        s = " ".join(w if _is_acronym(w) else w[:1] + w[1:].lower() for w in s.split())
    elif not re.search(r"[A-Z]", s):  # all lower case
        s = " ".join(w[:1].upper() + w[1:] for w in s.split())
    return s.strip(" ,.") or no_dashes(full)


def subject_name(business: str) -> str:
    """Subjects stay 2 to 4 words, so long names are cut to their first 3 words."""
    words = business.split()
    if len(words) <= 3:
        return business
    words = words[:3]
    while words and words[-1].lower() in ("&", "and", "the", "of", "for", "by", "at", "in"):
        words.pop()
    return " ".join(words) or business


NOT_NAMES = {
    "info", "admin", "sales", "team", "owner", "manager", "support", "hello", "hi", "contact", "office",
    "reception", "booking", "bookings", "marketing", "the", "customer", "service", "care", "enquiries",
    "enquiry", "inquiries", "inquiry", "management", "accounts", "account", "n", "na", "none", "unknown",
    "dear", "sir", "madam", "business", "company", "shop", "store", "general", "front", "desk",
}
TITLES = {"mr", "mrs", "ms", "miss", "mx", "eng", "engr", "mr.", "mrs.", "ms."}


def clean_first_name(raw: str, business: str = "") -> str:
    """A first name to greet, or "" (then the email says "Hi there")."""
    raw = _strip_symbols(raw or "").strip()
    if not raw or "@" in raw or re.search(r"\d", raw):
        return ""
    tokens = re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", raw)
    while tokens and tokens[0].lower().rstrip(".") in TITLES:
        tokens.pop(0)
    if not tokens:
        return ""
    doctor = tokens[0].lower().rstrip(".") == "dr"
    if doctor:
        tokens.pop(0)
        if not tokens:
            return ""
    first = tokens[0]
    if first.lower() in NOT_NAMES or len(first) < 2:
        return ""
    if first.isupper() or first.islower():
        first = first[:1].upper() + first[1:].lower()
    if business and first.lower() == business.split()[0].lower() and len(business.split()) > 1:
        return ""  # "Glossy" from "Glossy PPF" is not a person
    return ("Dr " + first) if doctor else first


# Areas we can spot inside an address when the file has no area column.
KNOWN_AREAS = [
    "Dubai Marina", "Jumeirah Lake Towers", "JLT", "JBR", "Jumeirah Beach Residence", "Business Bay", "Downtown Dubai",
    "Downtown", "DIFC", "Al Barsha", "Barsha Heights", "Tecom", "Jumeirah Village Circle", "JVC", "Jumeirah Village Triangle",
    "JVT", "Jumeirah", "Umm Suqeim", "Al Wasl", "Al Safa", "Al Quoz", "Al Satwa", "Satwa", "Karama", "Al Karama", "Oud Metha",
    "Bur Dubai", "Deira", "Al Rigga", "Al Garhoud", "Garhoud", "Al Qusais", "Al Nahda", "Muhaisnah", "Mirdif", "Al Warqa",
    "Rashidiya", "Al Mizhar", "Dubai Silicon Oasis", "Silicon Oasis", "International City", "Dubai Hills", "Arabian Ranches",
    "Motor City", "Sports City", "Dubai Sports City", "Discovery Gardens", "Al Furjan", "Jebel Ali", "Dubai South",
    "Palm Jumeirah", "The Greens", "Emirates Hills", "Meydan", "Al Jaddaf", "Culture Village", "City Walk", "La Mer",
    "Bluewaters", "Al Sufouh", "Knowledge Village", "Media City", "Internet City", "Dubai Festival City",
    "Festival City", "Ras Al Khor", "Nad Al Sheba", "Al Khawaneej", "Al Mamzar", "Hor Al Anz", "Al Muraqqabat",
    "Abu Dhabi", "Al Ain", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain",
    "Khalifa City", "Mussafah", "Yas Island", "Saadiyat", "Al Reem Island", "Reem Island",
]
_AREA_RE = re.compile(r"\b(%s)\b" % "|".join(re.escape(a) for a in sorted(KNOWN_AREAS, key=len, reverse=True)), re.I)
NON_DUBAI = re.compile(
    r"\b(abu dhabi|al ain|sharjah|ajman|ras al khaimah|rak|fujairah|umm al quwain|uaq|khalifa city|mussafah|"
    r"yas island|saadiyat|reem island|al reem)\b",
    re.I,
)


def clean_area(area: str, address: str = "") -> str:
    area = no_dashes(_strip_symbols(area or ""))
    if area:
        area = area.split(",")[0].strip()
        if area.isupper() or area.islower():
            area = " ".join(w if _is_acronym(w) else w[:1].upper() + w[1:].lower() for w in area.split())
        return area
    m = _AREA_RE.search(address or "")
    if not m:
        return ""
    found = m.group(1)
    for known in KNOWN_AREAS:  # use our spelling
        if known.lower() == found.lower():
            return known
    return found


def city_words(area: str, address: str = "") -> Tuple[str, str]:
    """("Dubai", "Dubai") for Dubai or unknown, ("the UAE", "UAE") for the other emirates.
    The first fits "businesses in ___", the second fits "___ businesses"."""
    if NON_DUBAI.search(area or "") or NON_DUBAI.search(address or ""):
        return "the UAE", "UAE"
    return "Dubai", "Dubai"


def found_on(source: str, instagram: str) -> str:
    """Where we saw them, for "Just the ___ page"."""
    s = (source or "").lower()
    if "insta" in s:
        return "Instagram"
    if "google" in s or "maps" in s or "gmb" in s:
        return "Google Maps"
    return "Instagram" if instagram else "Google Maps"


def instagram_handle(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    m = re.search(r"instagram\.com/([A-Za-z0-9._]{1,30})", value)
    handle = m.group(1) if m else value.lstrip("@")
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle) or handle.lower() in ("p", "reel", "reels", "stories", "explore"):
        return ""
    return handle


def format_whatsapp(number: str) -> str:
    """+971501234567 -> +971 50 123 4567. Spaces only, because our emails never contain dashes."""
    digits = re.sub(r"\D", "", number or "")
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 10:  # 050 123 4567
        digits = "971" + digits[1:]
    if digits.startswith("971") and len(digits) == 12:
        return "+971 %s %s %s" % (digits[3:5], digits[5:8], digits[8:])
    return "+" + digits
