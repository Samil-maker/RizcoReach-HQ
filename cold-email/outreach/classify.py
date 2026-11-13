"""Reading a reply: what kind is it, is it automatic, is it a bounce, when are they back.

Labels: interested, question, not_now, opt_out, out_of_office, bounce, other.
"""
from __future__ import annotations

import html as htmllib
import re
from dataclasses import dataclass
from datetime import date, timedelta
from email.message import Message
from typing import List, Optional, Tuple

from . import clock

LABELS = {
    "interested": "interested",
    "question": "question",
    "not_now": "not now",
    "opt_out": "no / opt out",
    "out_of_office": "out of office",
    "bounce": "bounce",
    "other": "other",
}


@dataclass
class Result:
    label: str
    is_auto: bool = False
    complaint: bool = False      # mentions spam or reporting: pauses everything
    ooo_until: Optional[date] = None
    text: str = ""               # their words, without the quoted email


# ----------------------------------------------------------------------------- text

def body_text(msg: Message) -> str:
    """The plain text of an email (or its HTML turned into text)."""
    plain, html = None, None
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", "replace")
        except (LookupError, AttributeError):
            continue
        if ctype == "text/plain" and plain is None:
            plain = text
        elif ctype == "text/html" and html is None:
            html = text
    if plain is not None:
        return plain
    if html is not None:
        html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
        html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", html)
        html = re.sub(r"(?is)<blockquote\b.*?</blockquote>", "\n", html)
        return htmllib.unescape(re.sub(r"<[^>]+>", " ", html))
    return ""


QUOTE_STARTS = [
    re.compile(r"^\s*On .{0,200}?wrote:\s*$", re.I | re.M | re.S),
    re.compile(r"^\s*On .{0,120}$\n^.{0,120}wrote:\s*$", re.I | re.M),
    re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}", re.I | re.M),
    re.compile(r"^\s*_{10,}\s*$", re.M),
    re.compile(r"^\s*From:\s.*$\n(^.*$\n){0,3}^\s*(Sent|Date):\s", re.I | re.M),
    re.compile(r"^\s*Sent from my (iPhone|iPad|Android|Samsung|mobile)", re.I | re.M),
    re.compile(r"^\s*Get Outlook for", re.I | re.M),
    re.compile(r"^\s*في .{0,200}كتب", re.M),  # Arabic "On ... wrote"
]
# Lines from our own emails: if they show up without ">" the rest is our quoted email.
OUR_LINES = re.compile(
    r"^\s*(Not relevant\? Just reply no|Had a look at the .* website|I was looking up .* and couldn't find|"
    r"Saw .* just opened|I build websites for|I redesign websites for|just bringing this back up|Last one from me|"
    r"Hi there just bringing|WhatsApp \+|I was looking at .* (ads|Instagram)|I came across .* Facebook|"
    r"We run Facebook and Instagram ads|No big setup fee|We came across .* (website|Facebook)|We build websites for|"
    r"We redesign websites for|We also offer SEO and management|We also handle SEO|One last note.{0,40}If (it helps|more genuine)|"
    r"We were looking at .* (ads|Instagram)|"
    r"Hi \S+( \S+)? (just bringing this back|had another thought|one more thought|just checking in\. (Most|If)|"
    r"we know things get busy|checking in from RizcoReach|we haven't heard back so this is our last))",
    re.I | re.M,
)


def strip_quoted(text: str) -> str:
    text = (text or "").replace("\r\n", "\n")
    cut = len(text)
    for rx in QUOTE_STARTS + [OUR_LINES]:
        m = rx.search(text)
        if m and m.start() < cut:
            cut = m.start()
    text = text[:cut]
    lines = [l for l in text.split("\n") if not l.lstrip().startswith(">")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# ----------------------------------------------------------------------------- bounces

def is_bounce(msg: Message) -> bool:
    sender = (msg.get("From") or "") + " " + (msg.get("Return-Path") or "")
    ctype = (msg.get("Content-Type") or "").lower()
    return bool(
        re.search(r"mailer-daemon|postmaster|mail delivery (subsystem|system)", sender, re.I)
        or ("multipart/report" in ctype and "delivery-status" in ctype)
    )


def bounce_details(msg: Message, raw: bytes) -> Tuple[List[str], str, List[str]]:
    """(failed addresses, "hard" / "soft" / "delay", original Message-IDs found)."""
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
    addresses = []
    for h in msg.get_all("X-Failed-Recipients") or []:
        addresses += [a.strip().lower() for a in str(h).split(",") if "@" in a]
    for m in re.finditer(r"^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?", text, re.I | re.M):
        addresses.append(m.group(1).lower())
    actions = [a.lower() for a in re.findall(r"^Action:\s*(\w+)", text, re.I | re.M)]
    statuses = re.findall(r"^Status:\s*([245])\.\d{1,3}\.\d{1,3}", text, re.I | re.M)
    subject = (msg.get("Subject") or "").lower()
    if actions and all(a in ("delayed", "relayed", "delivered", "expanded") for a in actions):
        kind = "delay"
    elif re.search(r"\bdelay(ed)?\b|will (retry|try again)|not yet been delivered|temporar", subject + " " + text[:3000].lower()) and "5" not in statuses:
        kind = "delay"
    elif "5" in statuses or not statuses:
        kind = "hard"
    else:
        kind = "soft"  # gave up after temporary errors
    ids = re.findall(r"^Message-ID:\s*(<[^>]+>)", text, re.I | re.M)
    return list(dict.fromkeys(addresses)), kind, ids


# ----------------------------------------------------------------------------- automatic replies

AUTO_SUBJECT = re.compile(
    r"^\s*(auto(matic)?[\s_]*(reply|response|answer)|autoreply|auto:|out of (the )?office|ooo\b|away from|"
    r"on (annual )?leave|on vacation|on holiday|absence|abwesenheit|réponse automatique|"
    r"automatische antwort|رد تلقائي)",
    re.I,
)
OOO_TEXT = re.compile(
    r"out of (the )?office|on (annual |sick |maternity |paternity |medical )?leave|on vacation|on holiday|"
    r"away (from (the )?office|until|till|on)|limited access to (my )?(e-?mail|emails)|"
    r"(will|i'll|i will) (be )?(back|return|returning)|returning (on|to the office)|back in the office|"
    r"currently (travel(l)?ing|away|out)|i am (currently )?away|i'm (currently )?away|"
    r"خارج المكتب|إجازة",
    re.I,
)
AUTO_ACK = re.compile(
    r"(thank(s| you) for (contacting|reaching|your (email|message|enquiry|inquiry)|getting in touch)|"
    r"we (have )?received your (email|message|enquiry|inquiry)|this is an automated|do not reply to this|"
    r"our team will (get back|respond|contact)|we will get back to you (shortly|soon|within))",
    re.I,
)


def is_auto(msg: Message) -> bool:
    auto = (msg.get("Auto-Submitted") or "").strip().lower()
    if auto and auto != "no":
        return True
    if msg.get("X-Autoreply") or msg.get("X-Autorespond"):
        return True
    if (msg.get("Precedence") or "").strip().lower() in ("auto_reply", "bulk", "junk"):
        return True
    return bool(AUTO_SUBJECT.search(msg.get("Subject") or ""))


def return_date(text: str, today: Optional[date] = None) -> Optional[date]:
    """When an out of office says they are back. None if no clear date."""
    try:
        from dateutil import parser as dparser
    except ImportError:  # pragma: no cover
        return None
    today = today or clock.today()
    rx = re.compile(
        r"\b(?:back|return(?:ing|s)?|until|till|through|reopen(?:ing|s)?|resum(?:e|ing))\b(?:\s+(?:on|in the office on|to the office on|to work on|by))?"
        r"\s+(?P<d>[^\n.;!?]{3,40})",
        re.I,
    )
    for m in rx.finditer(text or ""):
        chunk = re.sub(r"\b(the|of|on)\b", " ", m.group("d"))
        chunk = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", chunk)
        words = chunk.split()
        for n in range(min(5, len(words)), 0, -1):
            piece = " ".join(words[:n])
            if not re.search(r"\d", piece):
                continue
            try:
                d = dparser.parse(piece, dayfirst=True, fuzzy=True, default=clock.at(today, 0).replace(tzinfo=None)).date()
            except (ValueError, OverflowError):
                continue
            if d < today and d.replace(year=d.year + 1) <= today + timedelta(days=120):
                d = d.replace(year=d.year + 1)  # "back on 3 January" written in December
            if today <= d <= today + timedelta(days=120):
                return d
    return None


# ----------------------------------------------------------------------------- human replies

# Spam talk. Any of these pauses all sending until you look. The strong ones also put them on the opt out list.
COMPLAINT = re.compile(r"\bspam\w*|\bunsolicited\b|\babuse\b|\bharass\w*|\blegal action\b|report (you|this|your)|\bTRA\b", re.I)
REPORT_MENTION = re.compile(r"\breport(s|ed|ing)?\b", re.I)
HARD_STOP = re.compile(
    r"\bunsubscribe\b|\bremove (me|us|my|our)\b|take (me|us) off|\bstop (emailing|sending|contacting|messaging|this)\b|"
    r"^\W*stop\W*$|do not (email|contact|message|send)|don'?t (email|contact|message|send)|please don'?t",
    re.I | re.M,
)
SAYS_NO = re.compile(
    r"not interested|no longer interested|^\W*no\W*$|^\W*no\W+thank|^\W*no\s*,?\s*thanks|no thank you|\bnope\b|"
    r"^\W*not relevant|\u063a\u064a\u0631 \u0645\u0647\u062a\u0645|\u0644\u0627 \u0634\u0643\u0631\u0627",
    re.I | re.M,
)
SOFT_NO = re.compile(
    r"already have (a |an |our |the )?(website|site|web ?designer|developer|agency|company|someone|team|guy)|"
    r"we('re| are) (good|fine|all set|sorted|ok|okay)\b|\bnot needed\b|we don'?t need|\bno need\b|not looking|"
    r"not for us|no requirement|we have (one|a website|our own)|happy with (our|the|my) (current )?(website|site)",
    re.I,
)
NOT_NOW = re.compile(
    r"not (right )?now|not at the moment|not at this (time|stage|point)|maybe later|later (this|next) (year|month)|"
    r"next (month|year|quarter)|in a (few|couple of) (weeks|months)|after (ramadan|eid|the summer|summer|"
    r"new year|the holidays)|busy (right now|at the moment|these days)|not the right time|bad time|circle back|"
    r"get back to you|reach out (again )?(later|in|next)|few months|some ?time later|in the future|not yet\b|"
    r"maybe in\b|still (setting up|opening|building)|keep (me|us) in mind|لاحقا",
    re.I,
)
INTERESTED = re.compile(
    r"^\W*(yes|yeah|yep|yup|sure|ok(ay)?|please|definitely|absolutely|of course|go ahead|sounds good|why not|"
    r"interested|y)\b|send (me |us |them |over |across )?(the |some |a few |few |your )?(examples?|samples?|"
    r"portfolio|work|designs?|preview|it|them|details|info|more)|(please|pls|plz|kindly) (send|share)|"
    r"share (the |some |your )?(examples?|samples?|portfolio|work|details)|(i'?m|i am|we'?re|we are) interested|"
    r"let'?s (talk|chat|do it|discuss|connect|go)|call me|whatsapp me|message me|text me|contact me|reach me|"
    r"(can|could) you (call|whatsapp|message)|(can|could|shall) we (talk|chat|meet|speak)|would (love|like) (to|a|some)|happy to (see|look|have)|\bkeen\b|"
    r"tell me more|more (info|information|details)|نعم|مهتم|ارسل|أرسل",
    re.I | re.M,
)
QUESTION_WORDS = re.compile(
    r"\?|؟|^\W*(how|what|when|where|why|who|which|is it|are you|do you|does it|can you|could you|will it)\b|"
    r"how much|price|cost|what'?s included|hosting|domain|how long",
    re.I | re.M,
)
WEAK_YES = re.compile(r"\b(sure|ok|okay|yes|interested|sounds (good|great|interesting)|great|perfect|go for it)\b", re.I)


def classify_text(text: str) -> Tuple[str, bool]:
    """(label, complaint) for a human reply, from their own words only."""
    t = (text or "").strip()
    if not t:
        return "other", False
    complaint = bool(COMPLAINT.search(t) or REPORT_MENTION.search(t))
    if COMPLAINT.search(t) or HARD_STOP.search(t):
        return "opt_out", complaint
    strong_yes = INTERESTED.search(t)
    has_question = QUESTION_WORDS.search(t)
    if NOT_NOW.search(t) and not strong_yes:
        return "not_now", complaint
    if SAYS_NO.search(t):
        return "opt_out", complaint
    if strong_yes and not (SOFT_NO.search(t) and not has_question):
        return "interested", complaint
    if has_question:
        return "question", complaint
    if SOFT_NO.search(t):
        return "opt_out", complaint
    if WEAK_YES.search(t):
        return "interested", complaint
    return "other", complaint


def classify(msg: Message, raw: bytes = b"") -> Result:
    if is_bounce(msg):
        return Result("bounce", is_auto=True)
    full_text = body_text(msg)
    their = strip_quoted(full_text)
    subject = msg.get("Subject") or ""
    if is_auto(msg) or (OOO_TEXT.search(subject) and OOO_TEXT.search(their)):
        if OOO_TEXT.search(subject) or OOO_TEXT.search(their):
            return Result("out_of_office", is_auto=True, ooo_until=return_date(their), text=their)
        return Result("other", is_auto=True, text=their)
    if AUTO_ACK.search(their) and len(their.split()) < 120:
        return Result("other", is_auto=True, text=their)
    label, complaint = classify_text(their)
    return Result(label, complaint=complaint, text=their)
