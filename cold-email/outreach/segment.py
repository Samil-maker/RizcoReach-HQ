"""Every lead gets exactly one segment, and segment C leads get one true observation.

Website campaign:
A  new business      the file's source or notes say grand opening, just opened, new branch and so on
B  no website        no website, or the "website" is only Instagram, a link page or Google Maps
C  outdated website  we confirmed a real problem on their homepage (or clear signs of an old site)
SKIP                 a good modern website, or a site we could not check (we never guess)

Meta ads campaign (from Lead Hunter's Meta ads export, or files you mark as Meta ads):
N  no Meta ads       Lead Hunter checked the Ad Library and found none, so the email can say so
G  general           not checked: the email makes no claim about their ads
SKIP                 already running Meta ads
"""
from __future__ import annotations

import re
from typing import Dict, Optional, Tuple

from . import clock

NEW_BUSINESS = re.compile(
    r"grand opening|soft opening|now open\b|just opened|newly opened|recently opened|new opening|"
    r"newly launched|just launched|recently launched|\bnewly\b|opened (last|this|recently|in|on)\b|"
    r"\bnew\s+(business|opening|listing|place|shop|store|branch|restaurant|cafe|café|salon|clinic|spa|gym|"
    r"outlet|location|brand|venture|concept|kitchen|studio|boutique)\b|^\s*new\s*$",
    re.I,
)

OBSERVATIONS = {
    "down": "It wasn't loading when I tried to open it",
    "error": "It showed an error page when I tried to open it",
    "parked": "Right now it just shows a placeholder page",
    "coming_soon": "Right now it just shows a coming soon page",
    "mobile": "It's quite hard to use on a phone",
    "https": "Chrome marks it as not secure because it has no HTTPS",
    "copyright": "The site still says {year} at the bottom",
    "slow": "It took about {seconds} seconds to load when I opened it",
    "contact": "I couldn't see an easy way to call or book from the homepage",
    "generic": "I think a fresh modern version could bring you a lot more enquiries",
}


def is_new_business(source: str, notes: str) -> bool:
    return bool(NEW_BUSINESS.search(source or "") or NEW_BUSINESS.search(notes or ""))


def observation(site: Dict, this_year: Optional[int] = None) -> Tuple[Optional[str], Optional[str], str]:
    """(kind, sentence, reason). kind None means skip: nothing true and useful to say."""
    this_year = this_year or clock.today().year
    state = site.get("state")
    if state == "down":
        return "down", OBSERVATIONS["down"], "site did not load (%s), twice" % site.get("error")
    if state == "error":
        return "error", OBSERVATIONS["error"], "site answered HTTP %s, twice" % site.get("status")
    if state == "blocked":
        return None, None, "could not check: the site blocks automated visits (HTTP %s). Check it by hand" % site.get("status")
    if state != "ok":
        return None, None, "could not check the site (%s)" % state
    if site.get("coming_soon"):
        return "coming_soon", OBSERVATIONS["coming_soon"], "placeholder page: %r" % site.get("parked")
    if site.get("parked"):
        return "parked", OBSERVATIONS["parked"], "placeholder page: %r" % site.get("parked")
    if not site.get("mobile"):
        return "mobile", OBSERVATIONS["mobile"], "no mobile viewport tag"
    if not site.get("https"):
        return "https", OBSERVATIONS["https"], "no HTTPS"
    year = site.get("copyright_year")
    if year and year <= this_year - 3 and not site.get("year_is_dynamic"):
        return "copyright", OBSERVATIONS["copyright"].format(year=year), "copyright year %s" % year
    seconds = site.get("seconds") or 0
    if seconds >= 5:
        return "slow", OBSERVATIONS["slow"].format(seconds=int(seconds)), "took %.1fs to load, twice" % seconds
    if not site.get("has_contact") and not site.get("spa") and site.get("words", 0) >= 80:
        return "contact", OBSERVATIONS["contact"], "no call, WhatsApp, booking or contact link or form"
    old, weak = site.get("old_tech") or [], site.get("weak") or []
    if old or len(weak) >= 3:
        return "generic", OBSERVATIONS["generic"], "signs of an old site: " + ", ".join(old + weak)
    return None, None, "good modern website"


def decide(lead: Dict, site: Optional[Dict] = None) -> Dict:
    """Segment for one cleaned lead. `site` is the result of sitecheck.check_site for its website."""
    forced = (lead.get("segment") or "").strip().upper()
    forced = {"SKIP": "SKIP", "A": "A", "B": "B", "C": "C"}.get(forced)
    if forced == "A" or (not forced and is_new_business(lead.get("source", ""), lead.get("notes", ""))):
        return {"segment": "A", "segment_reason": "new business (from the file's source or notes)" if not forced else "set in the file"}
    if forced == "B" or (not forced and not lead.get("website")):
        return {"segment": "B", "segment_reason": "no website" if not forced else "set in the file"}
    if forced == "SKIP":
        return {"segment": "SKIP", "segment_reason": "set in the file"}
    kind, line, reason = observation(site or {"state": "unchecked"})
    if forced == "C" and not kind:
        kind, line = "generic", OBSERVATIONS["generic"]
        reason = "set in the file (" + reason + ")"
    if not kind:
        return {"segment": "SKIP", "segment_reason": reason}
    return {"segment": "C", "segment_reason": reason, "observation": line, "observation_kind": kind}


ADS_NONE = re.compile(r"not running ads|no ads found|no meta ads|^\s*(none|no|false|0)\s*$", re.I)
ADS_RUNNING = re.compile(r"running ads|^\s*(running|yes|true)\s*$", re.I)


def decide_ads(lead: Dict) -> Dict:
    """Segment for a Meta ads lead, from what Lead Hunter found in the Ad Library."""
    forced = {"N": "N", "G": "G", "SKIP": "SKIP"}.get((lead.get("segment") or "").strip().upper())
    if forced:
        return {"segment": forced, "segment_reason": "set in the file"}
    meta, tags = lead.get("meta_ads") or "", lead.get("tags") or ""
    if ADS_NONE.search(meta) or re.search(r"no meta ads", tags, re.I):
        return {"segment": "N", "segment_reason": "no Meta ads found in the Ad Library"}
    if ADS_RUNNING.search(meta) or re.search(r"running ads", tags, re.I):
        return {"segment": "SKIP", "segment_reason": "already running Meta ads"}
    return {"segment": "G", "segment_reason": "Meta ads not checked, so the email makes no claim about them"}
