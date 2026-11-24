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

# Website emails, written as "we" (RizcoReach), with the question at the end from you.
# (segment, version): version A states the website price, version B describes the same offer without numbers.
# The SEO and management line never states the monthly price. That comes up in your reply when they ask.
# PLAN_LINE: the full line, and a shorter one used when a long business name would push past 80 words.
PLAN_LINE = (
    "We also offer SEO and management. That includes Google Maps updates, edits, fixes and any changes you need",
    "We also handle SEO, Google Maps and any changes you need",
)

FIRST_EMAIL: Dict[Tuple[str, str], str] = {
    ("A", "A"): """Hi {greeting_name}

Saw {business} just opened[[ in {area}]]. Congrats on the launch

People look you up before they visit. A proper website turns that into bookings

We build websites for new businesses in {in_city} for {price} AED. Nothing upfront and you only pay once you're happy with it

{plan}

Want me to send you a few examples?""",
    ("A", "B"): """Hi {greeting_name}

Saw {business} just opened[[ in {area}]]. Congrats on the launch

People look you up before they visit. A proper website turns that into bookings

We build websites for new businesses in {in_city} at a fixed price with nothing upfront. You only pay once you're happy with it

{plan}

Want me to send you a few examples?""",
    ("B", "A"): """Hi {greeting_name}

We came across {business} and couldn't find a website. Just the {found_on} page. Most people look for one before they call

We build websites for {city} businesses for {price} AED. Nothing upfront and you only pay once you're happy with it

{plan}

Want me to show you what your website could look like?""",
    ("B", "B"): """Hi {greeting_name}

We came across {business} and couldn't find a website. Just the {found_on} page. Most people look for one before they call

We build websites for {city} businesses at a fixed price with nothing upfront. You only pay once you're happy with it

{plan}

Want me to show you what your website could look like?""",
    ("C", "A"): """Hi {greeting_name}

Had a look at the {business} website. {observation}

We redesign websites for {city} businesses for {price} AED. Nothing upfront and you only pay once you're happy with the new one

{plan}

Want me to send you a few examples?""",
    ("C", "B"): """Hi {greeting_name}

Had a look at the {business} website. {observation}

We redesign websites for {city} businesses at a fixed price with nothing upfront. You only pay once you're happy with the new one

{plan}

Want me to send you a few examples?""",
}

# Meta ads campaign. Sells what makes RizcoReach different: most agencies forward every form fill (job seekers,
# suppliers, people who were never serious), our appointment setters call or WhatsApp every enquiry first to check it
# is genuine and interested, and only qualified people reach the business. The price is one time setup fee, then a
# monthly fee (ADS_SETUP_PRICE and ADS_MONTHLY_PRICE, 850 AED each by default). Nothing is free and there is no
# pay later offer. Version A states the price, version B does not.
ADS_SUBJECT = "{subject_business} enquiries"
ADS_PITCH = ("Most agencies just pass on every form fill and a lot of those aren't serious. Our appointment setters "
             "call or WhatsApp each one first to check they're genuine and interested. You only speak to real customers")
ADS_ASK = "Want me to send you a quick explanation of how it works?"
ADS_OPEN = {
    "N": "We were looking at {business}[[ in {area}]] and couldn't see any Facebook or Instagram ads running",
    "G": "We came across {business}[[ in {area}]] and had a quick question about Facebook and Instagram ads",
}
for _seg, _open in ADS_OPEN.items():
    FIRST_EMAIL[(_seg, "A")] = "Hi {greeting_name}\n\n%s\n\n%s\n\n{ads_offer}\n\n%s" % (_open, ADS_PITCH, ADS_ASK)
    FIRST_EMAIL[(_seg, "B")] = "Hi {greeting_name}\n\n%s\n\n%s\n\n%s" % (_open, ADS_PITCH, ADS_ASK)

ADS_FOLLOW_UP = {
    1: "Hi {greeting_name} just bringing this back up in case it got buried. Happy to send a quick explanation of how it works if you're interested",
    2: "Hi {greeting_name} one more thought. Enquiries from ads go cold fast and a lot of them aren't serious. Our "
       "appointment setters call or WhatsApp every one straight away so you only speak to people who are genuinely "
       "interested. Want me to send the details?",
    3: "Hi {greeting_name} just checking in. If getting more customers from Facebook and Instagram is on your mind we'd be "
       "happy to show you how we'd set it up for {business}. Want me to send it over?",
    4: "Hi {greeting_name} we know things get busy so we'll keep this one short. Are more enquiries for {business} something "
       "you're focused on in the next few months? A quick yes or not yet is perfect",
    5: "Hi {greeting_name} checking in from RizcoReach. We'd still love to run Facebook and Instagram ads for {business} "
       "with our appointment setters qualifying every enquiry. {ads_offer_sentence} Want me to send over how it would work?",
    6: "Hi {greeting_name} we haven't heard back so this is our last email for now. If more genuine enquiries for "
       "{business} ever become a priority just reply here and we'll pick it up from there. Wishing you all the best",
}
ADS_HOW = ("We set up and run Facebook and Instagram ads for {business}. Our appointment setters call or WhatsApp every "
           "enquiry to check they're genuine and interested, and only the qualified ones get passed to you on WhatsApp "
           "or email, whichever you prefer.")
ADS_DRAFT_INTERESTED = ("Thanks[[ {first_name}]]. Here's how it works in short. " + ADS_HOW + " It's a one time setup "
                        "fee of {ads_setup} AED and then {ads_monthly} AED a month.\n\n[What's included and how soon the "
                        "first leads come in]\n\nEasiest to chat on WhatsApp. Our number is {whatsapp}")
ADS_QUESTION_ANSWERS = [
    (r"how much|price|cost|charge|fee|rate|budget|\baed\b|pay|expensive|cheap",
     "It's a one time setup fee of {ads_setup} AED and then {ads_monthly} AED a month. [Plus the ad budget they'd spend on Meta]"),
    (r"result|how many|guarantee|leads|enquir|inquir|customers|bookings|work for",
     "[What results to expect and how soon, without promising numbers you can't back up]"),
    (r"how long|when|start|timeline|setup|set up",
     "[How long setup takes before the first enquiries come in]"),
    (r"screen|qualif|genuine|fake|spam|quality|job seeker|supplier",
     "Our appointment setters call or WhatsApp every enquiry first to check they're genuine and interested, so only qualified people reach you."),
    (r"who are you|company|based|where|legit|examples|clients|portfolio",
     "[A line about you and RizcoReach]"),
]


# Elheen campaign: the booking system, for service businesses. Sent from its own inbox and signed Elheen, never
# mixed into a RizcoReach email. One segment (K). Version A names the problem (bookings coming in from everywhere),
# version B asks how they handle bookings today. No price and no features we haven't confirmed: those go in your reply.
BOOKING_SUBJECT = "{subject_business} bookings"
FIRST_EMAIL[("K", "A")] = """Hi {greeting_name}

Quick question about how {business}[[ in {area}]] takes bookings. For most service businesses here they come in on WhatsApp, calls and Instagram all at once and some slip through

{brand} puts all your bookings and enquiries in one place so nothing gets missed and everything is easy to manage

Want me to show you how it works?"""
FIRST_EMAIL[("K", "B")] = """Hi {greeting_name}

We came across {business}[[ in {area}]] and wanted to ask how you keep track of bookings today

{brand} brings every booking and enquiry into one simple place whether it comes from WhatsApp, a call or Instagram. It's built for service businesses in the UAE

Would a quick walkthrough be helpful?"""
BOOKING_FOLLOW_UP = {
    1: "Hi {greeting_name} just bringing this back up in case it got buried. Happy to send a quick walkthrough of how "
       "{brand} works. Just reply yes",
    2: "Hi {greeting_name} one more thought. When bookings come in from WhatsApp, calls and Instagram at the same time "
       "it's easy for a few to slip through. {brand} keeps them all in one place. Want me to show you?",
    3: "Hi {greeting_name} just checking in. If managing bookings and enquiries for {business} takes more time than it "
       "should we'd love to show you how {brand} makes it simpler. Is this worth a quick look?",
    4: "Hi {greeting_name} we know things get busy so we'll keep this one short. Is making bookings easier to manage "
       "something {business} is looking at in the next few months? A quick yes or not yet is perfect",
    5: "Hi {greeting_name} checking in from {brand}. Happy to walk you through it for {business} whenever suits you. "
       "Want me to send the details?",
    6: "Hi {greeting_name} we haven't heard back so this is our last email for now. If managing bookings for {business} "
       "ever becomes a headache just reply here and we'll pick it up from there. Wishing you all the best",
}
BOOKING_DRAFT_INTERESTED = (
    "Thanks[[ {first_name}]]. Here's how it works in short. [What {brand} does for them: where their bookings and "
    "enquiries show up and what they can do with them]\n\n[Price, or how to start a free trial]\n\n"
    "Easiest to chat on WhatsApp. Our number is {whatsapp}"
)
BOOKING_QUESTION_ANSWERS = [
    (r"how much|price|cost|charge|fee|rate|\baed\b|pay|expensive|cheap|trial|free",
     "[What it costs, and whether there's a free trial]"),
    (r"whatsapp|instagram|call|phone|integrat|connect|calendar|google",
     "[How it connects to WhatsApp, Instagram, calls and their calendar]"),
    (r"how long|setup|set up|start|onboard|learn|easy|difficult|staff|team",
     "[How setup works and how long it takes]"),
    (r"who are you|company|based|where|legit|clients|examples|demo|walkthrough|video",
     "[A line about you and {brand}, or a time for a quick walkthrough]"),
]
BOOKING_DRAFT_QUESTION_CLOSE = "Happy to show you a quick walkthrough for {business}. Easiest to chat on WhatsApp. Our number is {whatsapp}"

CAMPAIGN_OF_SEGMENT = {"A": "website", "B": "website", "C": "website", "N": "ads", "G": "ads", "K": "booking"}

# Follow ups: same thread, each one short and from a different angle, so a lead hears from us regularly
# without reading the same email twice. Days are in schedule.FOLLOW_UP_DAYS (3, 7, 14, 30, 60, 90).
# No links in any cold email: people don't click links from someone they don't know. When they ask to see
# your work, the reply drafted for them has your portfolio pictures inside the email (see portfolio.py).
FOLLOW_UP = {
    # day 3: a gentle bump, and your work is one "yes" away
    1: "Hi {greeting_name} just bringing this back up in case it got buried. Happy to send over a few websites we've "
       "built so you can see the style. Just reply yes",
    # day 7: something free to say yes to
    2: "Hi {greeting_name} had another thought. If it helps we can put together a quick preview of what a homepage for "
       "{business} could look like. No cost and no commitment. Just reply yes and we'll get started",
    # day 14: why it matters
    3: "Hi {greeting_name} just checking in. Most customers look a business up online before they get in touch "
       "and the website is usually where they decide. We'd love to help {business} make a great first impression. "
       "Is this something you'd like to look at?",
    # day 30: an easy yes or no
    4: "Hi {greeting_name} we know things get busy so we'll keep this one short. Is a website for {business} on your "
       "list for the next few months? A quick yes or not yet is perfect",
    # day 60: the offer again
    5: "Hi {greeting_name} checking in from RizcoReach. Our offer for {business} is still open. Nothing upfront and you "
       "only pay once you're happy with the website. Want me to send you a free preview?",
    # day 90: a friendly close, the door left open
    6: "Hi {greeting_name} we haven't heard back so this is our last email for now. If a website for {business} ever "
       "comes up just reply here and we'll pick it up from there. Wishing you all the best with the business",
}

SIGNATURE = """{sender_name}
{company}
WhatsApp {whatsapp}"""

OPT_OUT = "Not relevant? Just reply no and we won't email again"

# Reply drafts. These are never sent for you: they go in the report and your Drafts folder.
# PICTURES marks where your portfolio pictures go in the Gmail draft. Without pictures the portfolio link is used.
PICTURES = "<<your portfolio pictures>>"
DRAFT_INTERESTED_PICTURES = (
    "Thanks[[ {first_name}]]. Here are a few websites we've built so you can see the style\n\n" + PICTURES + "\n\n"
    "If you like the style we can put together a quick preview for {business} so you can see it before deciding "
    "anything. Easiest to chat on WhatsApp. Our number is {whatsapp}"
)
EXAMPLES_PICTURES = "Here are a few websites we've built so you can see the style\n\n" + PICTURES
DRAFT_INTERESTED = (
    "Thanks[[ {first_name}]]. Here are some sites we've built: {examples_link}\n\n"
    "If you like the style we can put together a quick preview for {business} so you can see it before deciding "
    "anything. Easiest to chat on WhatsApp. Our number is {whatsapp}"
)

# For someone who said "not now": back on your Reply to these list after 60 days with this drafted. You send it.
CHECK_IN = {
    "website": "Hi[[ {first_name}]]. A while back you mentioned it wasn't the right time for a website for {business}. "
               "Just checking in to see if now is any better. Happy to put together a free preview whenever you're ready",
    "ads": "Hi[[ {first_name}]]. A while back you mentioned it wasn't the right time for Facebook and Instagram ads for "
           "{business}. Just checking in to see if now is any better. Happy to walk you through how it works whenever you're ready",
    "booking": "Hi[[ {first_name}]]. A while back you mentioned it wasn't the right time to look at bookings for "
               "{business}. Just checking in to see if now is any better. Happy to show you how {brand} works whenever you're ready",
}

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
     "Here are some sites we've built: {examples_link}"),
    (r"who are you|where are you|company|based|office|meet|location|trade licen[cs]e|legit",
     "[A line about you and RizcoReach]"),
]
DRAFT_QUESTION_OPEN = "Thanks[[ {first_name}]]. Good question."
DRAFT_QUESTION_FALLBACK = "[Answer their question here]"
DRAFT_QUESTION_CLOSE = (
    "If it helps we can put together a quick preview for {business} so you can see it before deciding anything. "
    "Easiest to chat on WhatsApp. Our number is {whatsapp}"
)

# Ideas for the next version once a test has 100 sends per version (shown in the report).
NEXT_VARIANT_IDEAS = {
    "K": [
        "Name their niche: 'most salons we talk to take bookings on WhatsApp'",
        "Ask 'Do bookings ever get missed when it's busy?' as the whole question",
        "Shorter: the question about bookings and one line about {brand}",
    ],
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
        "Lead with the free preview: 'We could mock up a homepage for {business} so you can see it first'",
        "Ask 'Is a website on your list this year?' at the end",
        "Name their niche in the first line, for example 'We were looking up salons in Al Barsha'",
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


# Leads imported before the emails said "we" have the old "I" wording saved with them. Brought up to date when sent.
_OLD_OBSERVATION = [
    (re.compile(r"\bwhen I (tried|opened)\b"), r"when we \1"),
    (re.compile(r"^I couldn't see an easy way"), "We couldn't see an easy way"),
    (re.compile(r"^I think a fresh modern version"), "We think a fresh modern version"),
]


def _we(observation: str) -> str:
    for rx, new in _OLD_OBSERVATION:
        observation = rx.sub(new, observation)
    return observation


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
        "observation": _we(get("observation")),
        "sender_name": settings.from_name,
        "whatsapp": names.format_whatsapp(settings.whatsapp),
        "examples_link": settings.examples_link,
        "price": "{:,}".format(settings.website_price),
        "care_price": "{:,}".format(settings.care_price),
        "ads_setup": "{:,}".format(settings.ads_setup_price),
        "ads_monthly": "{:,}".format(settings.ads_monthly_price),
        "ads_offer": "It's a one time setup fee and then {:,} AED a month".format(settings.ads_monthly_price),
        "ads_offer_sentence": "It's a one time setup fee and then {:,} AED a month.".format(settings.ads_monthly_price),
        "brand": settings.booking_brand,
        # The name under the sender's: the booking system's for its emails, RizcoReach for the rest.
        "company": settings.booking_brand if campaign_of_values(lead) == "booking" else settings.company,
    }


def signature(values: Dict[str, str]) -> str:
    return render(SIGNATURE, values)


def campaign_of_values(lead) -> str:
    """campaign_of for a lead row or a plain dict (lead_vars takes both)."""
    try:
        return campaign_of(lead)
    except (KeyError, IndexError, TypeError):
        return "website"


def campaign_of(lead) -> str:
    keys = lead.keys() if hasattr(lead, "keys") else []
    return ("campaign" in keys and lead["campaign"]) or CAMPAIGN_OF_SEGMENT.get(lead["segment"], "website")


def first_email(lead, variant: str, settings: Settings) -> Tuple[str, str, str]:
    """(subject, body, full text). body is the part counted for the 80 word limit."""
    values = lead_vars(lead, settings)
    segment = lead["segment"]
    template = FIRST_EMAIL[(segment, variant)]
    full_plan, short_plan = PLAN_LINE
    # Under 80 words: keep their area if we can (it shows we looked), then the full plan line if it fits.
    for area, plan in ((values["area"], full_plan), (values["area"], short_plan), ("", full_plan), ("", short_plan)):
        body = render(template, dict(values, area=area, plan=render(plan, values)))
        if word_count(body) < 80:
            break
    subject = render(ADS_SUBJECT if segment in ADS_OPEN else BOOKING_SUBJECT if segment == "K" else SUBJECT, values)
    full = "%s\n\n%s\n\n%s" % (body, signature(values), OPT_OUT)
    return subject, body, full


def follow_up(lead, step: int, settings: Settings) -> Tuple[str, str]:
    """(body, full text) for follow up 1 or 2, before the quoted original."""
    values = lead_vars(lead, settings)
    campaign = campaign_of(lead)
    body = render((ADS_FOLLOW_UP if campaign == "ads" else BOOKING_FOLLOW_UP if campaign == "booking" else FOLLOW_UP)[step], values)
    return body, "%s\n\n%s\n\n%s" % (body, signature(values), OPT_OUT)


def quote(original_text: str, sent_at: datetime, from_name: str, from_email: str) -> str:
    """The quoted first email under a follow up, the way a mail app writes it."""
    when = "%s, %d %s %d at %s" % (sent_at.strftime("%a"), sent_at.day, sent_at.strftime("%b"), sent_at.year, sent_at.strftime("%H:%M"))
    quoted = "\n".join(("> " + line) if line else ">" for line in original_text.splitlines())
    return "On %s, %s <%s> wrote:\n\n%s" % (when, from_name, from_email, quoted)


def reply_subject(subject: str) -> str:
    return subject if re.match(r"^\s*re\s*:", subject or "", re.I) else "Re: " + (subject or "")


def check_in(lead, settings: Settings) -> str:
    """The check in for someone who said not now, signed with your name."""
    campaign = campaign_of(lead)
    return render(CHECK_IN[campaign if campaign in CHECK_IN else "website"], lead_vars(lead, settings)) + "\n\n" + settings.from_name


def draft_reply(classification: str, lead, their_text: str, settings: Settings, pictures: bool = False) -> Optional[str]:
    """A reply for you to check and send yourself. Only for interested replies and questions.

    pictures: your portfolio pictures go in the email (the PICTURES mark shows where) instead of the link."""
    values = lead_vars(lead, settings)
    sign = values["sender_name"]
    ads = campaign_of(lead) == "ads"
    booking = campaign_of(lead) == "booking"
    if classification == "interested" and "?" not in (their_text or ""):
        if booking:
            return render(BOOKING_DRAFT_INTERESTED, values) + "\n\n" + sign
        if ads:
            return render(ADS_DRAFT_INTERESTED, values) + "\n\n" + sign
        return render(DRAFT_INTERESTED_PICTURES if pictures else DRAFT_INTERESTED, values) + "\n\n" + sign
    if classification in ("interested", "question"):
        text = (their_text or "").lower()
        answers: List[str] = []
        for pattern, answer in (BOOKING_QUESTION_ANSWERS if booking else ADS_QUESTION_ANSWERS if ads else QUESTION_ANSWERS):
            if re.search(pattern, text) and answer not in answers:
                answers.append(EXAMPLES_PICTURES if pictures and "{examples_link}" in answer else answer)
        if not answers:
            answers = [DRAFT_QUESTION_FALLBACK]
        close = BOOKING_DRAFT_QUESTION_CLOSE if booking else DRAFT_QUESTION_CLOSE
        parts = [render(DRAFT_QUESTION_OPEN, values)] + [render(a, values) for a in answers[:3]] + [render(close, values)]
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
