"""Every word we send. Edit the copy here.

Template rules
  {name}        is filled in from the lead (see lead_vars below)
  [[ ... ]]     an optional piece: dropped when any {name} inside it is empty,
                so "opened[[ in {area}]]." reads "opened." when we don't know the area
  [like this]   single brackets are left as they are (used in reply drafts for bits you fill in)

House style: plain text, under 80 words, one idea, one easy question at the end, minimal commas,
no semicolons, no dashes of any kind. lint() checks every email before it is sent.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from . import names
from .config import Settings

SUBJECT = "{subject_business} website"

# (segment, version): version A states the price, version B does not.
# Website emails. Version A shows both prices (the website and the monthly SEO and management plan),
# version B describes the same offer without numbers.
# The monthly plan line: the full one, and a shorter one used when a long business name would push past 80 words.
PLAN_LINE = {
    "A": ("After that it's {care_price} AED a month for SEO and management. Google Maps updates, edits, fixes and any changes you need",
          "After that it's {care_price} AED a month for SEO, Google Maps and any changes you need"),
    "B": ("After that I can handle your SEO and management every month. Google Maps updates, edits, fixes and any changes you need",
          "After that I can look after your SEO, Google Maps and any changes every month"),
}

FIRST_EMAIL: Dict[Tuple[str, str], str] = {
    ("A", "A"): """Hi {greeting_name}

Saw {business} just opened[[ in {area}]]. Congrats on the launch

People look up a new place before they visit. A proper website turns that into bookings

I build websites for new businesses in {in_city} for {price} AED. Nothing upfront and you only pay once you're happy with it

{plan}

Want me to send you a few examples?""",
    ("A", "B"): """Hi {greeting_name}

Saw {business} just opened[[ in {area}]]. Congrats on the launch

People look up a new place before they visit. A proper website turns that into bookings

I build websites for new businesses in {in_city} at a fixed price with nothing upfront. You only pay once you're happy with it

{plan}

Want me to send you a few examples?""",
    ("B", "A"): """Hi {greeting_name}

I was looking up {business} and couldn't find a website. Just the {found_on} page. Most people check for one before they call

I build websites for {city} businesses for {price} AED. Nothing upfront and you only pay once you're happy with it

{plan}

Want me to show you what yours could look like?""",
    ("B", "B"): """Hi {greeting_name}

I was looking up {business} and couldn't find a website. Just the {found_on} page. Most people check for one before they call

I build websites for {city} businesses at a fixed price with nothing upfront. You only pay once you're happy with it

{plan}

Want me to show you what yours could look like?""",
    ("C", "A"): """Hi {greeting_name}

Had a look at the {business} website. {observation}

I redesign websites for {city} businesses for {price} AED. Nothing upfront and you only pay once you're happy with the new one

{plan}

Worth sending you a couple of examples?""",
    ("C", "B"): """Hi {greeting_name}

Had a look at the {business} website. {observation}

I redesign websites for {city} businesses at a fixed price with nothing upfront. You only pay once you're happy with the new one

{plan}

Worth sending you a couple of examples?""",
}

# Meta ads campaign. Sells the system, not just the ads: most agencies forward every form fill (job seekers,
# suppliers and all), RizcoReach's own team messages each enquiry on SMS or WhatsApp first and only passes on
# the genuine ones. Two offers:
#   pay_after   nothing upfront, they pay once they've had their first genuine lead (most businesses)
#   standard    one flat monthly rate, no big setup fee (home improvement businesses, see HOME_IMPROVEMENT)
# Version A has the offer line, version B does not. N only goes to businesses Lead Hunter found no Meta ads for.
ADS_SUBJECT = "{subject_business} enquiries"
ADS_PITCH = ("Most agencies just forward every form fill and a lot of those are job seekers or suppliers. Our team "
             "messages each enquiry on WhatsApp first so you only get the genuine ones")
ADS_OFFER = {
    "pay_after": "Nothing upfront. You only pay once you've had your first genuine lead",
    "standard": "One flat monthly rate and no big setup fee",
}
ADS_ASK = "Want me to send you a quick explanation of how it works?"
ADS_OPEN = {
    "N": "I was looking at {business}[[ in {area}]] and couldn't see any Facebook or Instagram ads running",
    "G": "I came across {business}[[ in {area}]] and had a quick question about Facebook and Instagram ads",
}
for _seg, _open in ADS_OPEN.items():
    FIRST_EMAIL[(_seg, "A")] = "Hi {greeting_name}\n\n%s\n\n%s\n\n{ads_offer}\n\n%s" % (_open, ADS_PITCH, ADS_ASK)
    FIRST_EMAIL[(_seg, "B")] = "Hi {greeting_name}\n\n%s\n\n%s\n\n%s" % (_open, ADS_PITCH, ADS_ASK)

# Home improvement businesses get the standard offer (no pay after first lead). Matched in the niche and business name.
HOME_IMPROVEMENT = re.compile(
    r"interior|fit ?out|renovat|refurbish|remodel|home improvement|contracting|contractor|construction|joinery|"
    r"carpent|kitchen|bathroom|flooring|parquet|painting|painter|landscap|garden|swimming pool|pool (build|construct)|"
    r"gypsum|partition|curtain|blind|wallpaper|marble|tiles|waterproof|alumin|smart home|decor",
    re.I,
)

ADS_FOLLOW_UP = {
    1: "Hi {greeting_name} just bringing this back up in case it got buried. Happy to send a quick explanation of how it works if you're interested",
    2: "Last one from me[[ {first_name}]]. If more genuine enquiries from Facebook and Instagram is ever on your list just reply yes and I'll send the details",
}
ADS_HOW = ("We set up and run Facebook and Instagram ads for {business}. Our team contacts every enquiry by SMS or WhatsApp "
           "to confirm what they need, and only the genuine ones get passed to you on WhatsApp or email, whichever you prefer.")
ADS_DRAFT_INTERESTED = {
    "pay_after": "Thanks[[ {first_name}]]. Here's how it works in short. " + ADS_HOW + " You don't pay anything upfront. "
                 "You only pay once you've had your first genuine lead.\n\n[What it costs after that]\n\n"
                 "Easiest if we chat on WhatsApp, I'm on {whatsapp}",
    "standard": "Thanks[[ {first_name}]]. Here's how it works in short. " + ADS_HOW + " It's one flat monthly rate with no "
                "big setup fee.\n\n[Your monthly rate and what's included]\n\nEasiest if we chat on WhatsApp, I'm on {whatsapp}",
}
ADS_QUESTION_ANSWERS = [
    (r"how much|price|cost|charge|fee|rate|budget|\baed\b|pay|expensive|cheap",
     "{ads_offer_sentence} [What it costs, and the ad budget they'd spend on Meta]"),
    (r"result|how many|guarantee|leads|enquir|inquir|customers|bookings|work for",
     "[What results to expect and how soon, without promising numbers you can't back up]"),
    (r"how long|when|start|timeline|setup|set up",
     "[How long setup takes before the first enquiries come in]"),
    (r"screen|qualif|genuine|fake|spam|quality|job seeker|supplier",
     "Our team contacts every enquiry by SMS or WhatsApp first to confirm what they need, so only genuine people reach you."),
    (r"who are you|company|based|where|legit|examples|clients|portfolio",
     "[A line about you and RizcoReach]"),
]


def ads_offer(lead) -> str:
    """pay_after for most businesses, standard for home improvement ones."""
    get = (lambda k: (lead[k] if k in lead.keys() else "") or "") if hasattr(lead, "keys") else (lambda k: lead.get(k) or "")
    text = " ".join([get("niche"), get("business"), get("business_name")])
    return "standard" if HOME_IMPROVEMENT.search(text) else "pay_after"


CAMPAIGN_OF_SEGMENT = {"A": "website", "B": "website", "C": "website", "N": "ads", "G": "ads"}

FOLLOW_UP = {
    # The portfolio link goes on its own line (EXAMPLES_LINK in .env). First emails never carry a link.
    1: "Hi {greeting_name} just bringing this back up in case it got buried.[[ Here are a few sites I've built so you can see the style\n\n{examples_link}]]",
    2: "Last one from me[[ {first_name}]]. If it helps I can put together a quick preview of what a homepage for {business} could look like. No cost and no commitment. Just reply yes",
}

SIGNATURE = """{sender_name}
RizcoReach
WhatsApp {whatsapp}"""

OPT_OUT = "Not relevant? Just reply no and I won't email again"

# Reply drafts. These are never sent for you: they go in the report and your Drafts folder.
DRAFT_INTERESTED = (
    "Thanks[[ {first_name}]]. Here are some sites I've built: {examples_link}\n\n"
    "If you like the style I can put together a quick preview for {business} so you can see it before deciding "
    "anything. Easiest if we chat on WhatsApp, I'm on {whatsapp}"
)

# Short answers for common questions. Anything in [brackets] is for you to fill in before sending.
QUESTION_ANSWERS = [
    (r"how much|price|cost|charge|fee|budget|\baed\b|rate|quote|expensive|cheap|pay",
     "It's {price} AED for the website with nothing upfront. You only pay once you've seen it and you're happy with it"),
    (r"maintain|maintenance|update|upkeep|seo|after it|after launch|support|changes|edit|monthly",
     "Once it's live the SEO and management plan is {care_price} AED a month. That covers your SEO, Google Maps updates, edits, fixes and any changes you need. Totally up to you"),
    (r"how long|when can|timeline|time frame|timeframe|deadline|days|weeks|ready by|quick",
     "[How long it takes, for example: a first version within X days]"),
    (r"hosting|domain|server|email address|\.com|\.ae",
     "[Domain and hosting: what's included and what they pay for]"),
    (r"include|pages|what do (i|we) get|features|booking|whatsapp button|arabic|language|shop|e ?commerce|payment",
     "[What's included: pages, booking or WhatsApp button, Arabic if they want it]"),
    (r"example|portfolio|previous|samples|work you|sites you|websites you",
     "Here are some sites I've built: {examples_link}"),
    (r"who are you|where are you|company|based|office|meet|location|trade licen[cs]e|legit",
     "[A line about you and RizcoReach]"),
]
DRAFT_QUESTION_OPEN = "Thanks[[ {first_name}]]. Good question."
DRAFT_QUESTION_FALLBACK = "[Answer their question here]"
DRAFT_QUESTION_CLOSE = (
    "If it helps I can put together a quick preview for {business} so you can see it before deciding anything. "
    "Easiest if we chat on WhatsApp, I'm on {whatsapp}"
)

# Ideas for the next version once a test has 100 sends per version (shown in the report).
NEXT_VARIANT_IDEAS = {
    "N": [
        "Name their niche: 'most salons near you are running ads right now' (only if you checked)",
        "Offer to show them 3 ads a competitor is running, as the question",
        "Shorter: the observation, the screening line and the question",
    ],
    "G": [
        "Open with a question about where their customers come from today",
        "Lead with the lead screening: 'you only talk to genuine people'",
        "Ask 'Are you open to a quick explanation of how it works?' instead",
    ],
    "A": [
        "Swap the question for the free homepage preview: 'Want me to mock up a homepage for {business}?'",
        "Cut the middle paragraph so the email is three short lines",
        "Ask 'Is anyone already building your website?' at the end",
    ],
    "B": [
        "Lead with the free preview: 'I could mock up a homepage for {business} so you can see it first'",
        "Ask 'Is a website on your list this year?' at the end",
        "Name their niche in the first line, for example 'I was looking up salons in Al Barsha'",
    ],
    "C": [
        "Shorter: just the observation and the question, price in the second line",
        "Offer a free homepage preview instead of examples",
        "Put the observation in the subject, like '{business} on phones' (only for the mobile observation)",
    ],
}


# ----------------------------------------------------------------------------- rendering

_OPTIONAL = re.compile(r"\[\[(.*?)\]\]", re.S)
_VAR = re.compile(r"\{(\w+)\}")


def render(template: str, values: Dict[str, str]) -> str:
    def optional(m: "re.Match[str]") -> str:
        inner = m.group(1)
        return inner if all(values.get(n) for n in _VAR.findall(inner)) else ""

    text = _OPTIONAL.sub(optional, template)
    return _VAR.sub(lambda m: str(values.get(m.group(1), "{%s}" % m.group(1))), text)


def lead_vars(lead, settings: Settings) -> Dict[str, str]:
    get = (lambda k: (lead[k] if k in lead.keys() else "") or "") if hasattr(lead, "keys") else (lambda k: lead.get(k) or "")
    business = get("business") or names.clean_business(get("business_name"))
    area = names.clean_area(get("area"), get("address"))
    in_city, city = names.city_words(area, get("address"))
    first = get("first_name")
    return {
        "first_name": first,
        "greeting_name": first or "there",
        "business": business,
        "subject_business": names.subject_name(business),
        "area": area,
        "in_city": in_city,
        "city": city,
        "found_on": names.found_on(get("source"), get("instagram")),
        "observation": get("observation"),
        "sender_name": settings.from_name,
        "whatsapp": names.format_whatsapp(settings.whatsapp),
        "examples_link": settings.examples_link,
        "price": "{:,}".format(settings.website_price),
        "care_price": "{:,}".format(settings.care_price),
        "ads_offer": ADS_OFFER[ads_offer(lead)],
        "ads_offer_sentence": ADS_OFFER[ads_offer(lead)] + ".",
    }


def signature(values: Dict[str, str]) -> str:
    return render(SIGNATURE, values)


def campaign_of(lead) -> str:
    keys = lead.keys() if hasattr(lead, "keys") else []
    return ("campaign" in keys and lead["campaign"]) or CAMPAIGN_OF_SEGMENT.get(lead["segment"], "website")


def first_email(lead, variant: str, settings: Settings) -> Tuple[str, str, str]:
    """(subject, body, full text). body is the part counted for the 80 word limit."""
    values = lead_vars(lead, settings)
    segment = lead["segment"]
    template = FIRST_EMAIL[(segment, variant)]
    full_plan, short_plan = PLAN_LINE[variant]
    # Under 80 words: keep their area if we can (it shows we looked), then the full plan line if it fits.
    for area, plan in ((values["area"], full_plan), (values["area"], short_plan), ("", full_plan), ("", short_plan)):
        body = render(template, dict(values, area=area, plan=render(plan, values)))
        if word_count(body) < 80:
            break
    subject = render(ADS_SUBJECT if segment in ADS_OPEN else SUBJECT, values)
    full = "%s\n\n%s\n\n%s" % (body, signature(values), OPT_OUT)
    return subject, body, full


def follow_up(lead, step: int, settings: Settings) -> Tuple[str, str]:
    """(body, full text) for follow up 1 or 2, before the quoted original."""
    values = lead_vars(lead, settings)
    body = render((ADS_FOLLOW_UP if campaign_of(lead) == "ads" else FOLLOW_UP)[step], values)
    return body, "%s\n\n%s\n\n%s" % (body, signature(values), OPT_OUT)


def quote(original_text: str, sent_at: datetime, from_name: str, from_email: str) -> str:
    """The quoted first email under a follow up, the way a mail app writes it."""
    when = "%s, %d %s %d at %s" % (sent_at.strftime("%a"), sent_at.day, sent_at.strftime("%b"), sent_at.year, sent_at.strftime("%H:%M"))
    quoted = "\n".join(("> " + line) if line else ">" for line in original_text.splitlines())
    return "On %s, %s <%s> wrote:\n\n%s" % (when, from_name, from_email, quoted)


def reply_subject(subject: str) -> str:
    return subject if re.match(r"^\s*re\s*:", subject or "", re.I) else "Re: " + (subject or "")


def draft_reply(classification: str, lead, their_text: str, settings: Settings) -> Optional[str]:
    """A reply for you to check and send yourself. Only for interested replies and questions."""
    values = lead_vars(lead, settings)
    sign = values["sender_name"]
    ads = campaign_of(lead) == "ads"
    if classification == "interested" and "?" not in (their_text or ""):
        return render(ADS_DRAFT_INTERESTED[ads_offer(lead)] if ads else DRAFT_INTERESTED, values) + "\n\n" + sign
    if classification in ("interested", "question"):
        text = (their_text or "").lower()
        answers: List[str] = []
        for pattern, answer in (ADS_QUESTION_ANSWERS if ads else QUESTION_ANSWERS):
            if re.search(pattern, text) and answer not in answers:
                answers.append(answer)
        if not answers:
            answers = [DRAFT_QUESTION_FALLBACK]
        parts = [render(DRAFT_QUESTION_OPEN, values)] + [render(a, values) for a in answers[:3]] + [render(DRAFT_QUESTION_CLOSE, values)]
        return "\n\n".join(parts) + "\n\n" + sign
    return None


# ----------------------------------------------------------------------------- checks

_URL = re.compile(r"https?://\S+|www\.\S+|\b[\w]+\.(com|ae|net|org|io|co|me|info|biz)\b", re.I)
_DASH = re.compile("[%s]" % re.escape(names.DASHES))


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9؀-ۿ']+", text or ""))


def lint(subject: str, body: str, full: str, step: int) -> Tuple[List[str], List[str]]:
    """(problems, warnings). Any problem stops that email from being sent."""
    problems: List[str] = []
    warnings: List[str] = []
    everything = body + "\n" + full
    without_urls = _URL.sub(" ", everything) if step else everything
    if _DASH.search(without_urls) or _DASH.search(subject):
        problems.append("contains a dash")
    if ";" in everything or ";" in subject:
        problems.append("contains a semicolon")
    if "{" in full or "}" in full or "[[" in full or "{" in subject:
        problems.append("a template field was not filled in")
    if not full.rstrip().endswith(OPT_OUT):
        problems.append("does not end with the opt out line")
    if step == 0:
        n = word_count(body)
        if n >= 80:
            problems.append("too long: %d words (keep it under 80)" % n)
        if _URL.search(full):
            problems.append("has a link (no links in the first email)")
        sw = len(subject.split())
        if not 2 <= sw <= 4:
            problems.append("subject has %d words (use 2 to 4)" % sw)
        if re.match(r"^\s*(re|fwd?)\s*:", subject, re.I):
            problems.append('first email subject starts with "Re:"')
        if body.count(",") > 2:
            warnings.append("%d commas (fewer reads more natural)" % body.count(","))
        last_line = body.strip().splitlines()[-1]
        if not last_line.rstrip().endswith("?"):
            warnings.append("does not end with a question")
    return problems, warnings
