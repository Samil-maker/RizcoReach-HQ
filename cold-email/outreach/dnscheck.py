"""DNS checks: MX for lead domains, and SPF, DKIM and DMARC for your sending domain."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

try:
    import dns.exception
    import dns.resolver
except ImportError:  # pragma: no cover
    raise SystemExit("Missing packages. Run:  pip install -r requirements.txt")

from .config import Inbox

_resolver = dns.resolver.Resolver()
_resolver.lifetime = 8.0
_resolver.timeout = 4.0
_mx_cache: Dict[str, str] = {}


def _txt(name: str) -> Tuple[List[str], Optional[str]]:
    """TXT records for a name, and an error word if the lookup itself failed."""
    try:
        answer = _resolver.resolve(name, "TXT")
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return [], None
    except (dns.exception.Timeout, dns.resolver.NoNameservers) as e:
        return [], type(e).__name__
    except dns.exception.DNSException as e:
        return [], type(e).__name__
    return [b"".join(r.strings).decode("utf-8", "replace") for r in answer], None


def mx_status(domain: str) -> str:
    """ok, none (no MX: the address cannot receive mail) or unchecked (DNS did not answer)."""
    domain = domain.lower().strip(".")
    if domain in _mx_cache:
        return _mx_cache[domain]
    status = "unchecked"
    for _ in range(2):
        try:
            answer = _resolver.resolve(domain, "MX")
            hosts = [str(r.exchange).rstrip(".") for r in answer]
            status = "ok" if any(h for h in hosts) else "none"  # a "null MX" (0 .) means no mail
            break
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            status = "none"
            break
        except dns.exception.DNSException:
            status = "unchecked"
    _mx_cache[domain] = status
    return status


@dataclass
class Check:
    name: str
    ok: bool
    found: str = ""
    fix: List[str] = field(default_factory=list)


@dataclass
class DomainReport:
    domain: str
    managed: bool              # a free mailbox domain: the provider runs DNS, nothing for you to add
    spf: Check = None
    dkim: Check = None
    dmarc: Check = None
    lookup_failed: bool = False

    @property
    def can_send(self) -> bool:
        return self.spf.ok and self.dkim.ok


def check_inbox(inbox: Inbox) -> DomainReport:
    domain = inbox.domain
    rep = DomainReport(domain=domain, managed=inbox.is_free)
    failures = []

    # SPF
    records, err = _txt(domain)
    if err:
        failures.append(err)
    spf = [r for r in records if r.lower().startswith("v=spf1")]
    if len(spf) > 1:
        rep.spf = Check("SPF", False, " | ".join(spf), ["You have %d SPF records. There must be exactly one: merge them into one TXT record." % len(spf)])
    elif spf:
        rec = spf[0]
        wanted = inbox.spf_includes
        mentions = not wanted or any(w in rec.lower() for w in wanted)
        if mentions:
            rep.spf = Check("SPF", True, rec)
        else:
            rep.spf = Check("SPF", False, rec, _spf_fix(inbox, existing=rec))
    else:
        rep.spf = Check("SPF", False, "", _spf_fix(inbox))

    # DKIM: look for a public key at the usual selectors
    found = None
    for sel in inbox.dkim_selectors:
        recs, err = _txt("%s._domainkey.%s" % (sel, domain))
        if err:
            failures.append(err)
        key = next((r for r in recs if "p=" in r.replace(" ", "") and "p=;" not in r.replace(" ", "")), None)
        if key:
            found = "selector %s" % sel
            break
    rep.dkim = Check("DKIM", bool(found), found or "", [] if found else _dkim_fix(inbox))

    # DMARC (recommended, does not block sending)
    recs, err = _txt("_dmarc." + domain)
    if err:
        failures.append(err)
    dmarc = next((r for r in recs if r.lower().startswith("v=dmarc1")), None)
    rep.dmarc = Check("DMARC", bool(dmarc), dmarc or "", [] if dmarc else _dmarc_fix(inbox))

    # Free mailbox domains (gmail.com and the like): Google signs every email with DKIM itself and
    # publishes the SPF and DMARC records. You cannot change them and you do not need to.
    # We only trust that once we have actually read the provider's SPF record: that proves DNS works.
    if rep.managed:
        if rep.spf.ok:
            if not rep.dkim.ok:
                rep.dkim = Check("DKIM", True, "signed by %s itself (no record for you to add)" % inbox.label)
            if not rep.dmarc.ok:
                rep.dmarc = Check("DMARC", True, "managed by %s (nothing for you to add)" % inbox.label)
        else:
            note = "could not read %s's records. Is the internet on? Try again in a minute." % domain
            rep.spf = Check("SPF", False, "", [note])
            rep.dkim = Check("DKIM", False, "", ["checked once SPF can be read"])
            rep.dmarc = Check("DMARC", False, "", [])
            failures.append("no SPF record for %s" % domain)
    rep.lookup_failed = bool(failures) and not (rep.spf.ok and rep.dkim.ok)
    return rep


def _spf_fix(inbox: Inbox, existing: str = "") -> List[str]:
    if inbox.is_google:
        include = "include:_spf.google.com"
    elif inbox.provider.startswith("zoho"):
        include = "include:zohomail.com"
    else:
        include = "include:<your provider's SPF host, ask their support>"
    if existing:
        return ["Edit your existing SPF TXT record so it includes %s, for example:" % include,
                "  " + existing.replace(" ~all", " %s ~all" % include).replace(" -all", " %s -all" % include)]
    return [
        "Add a TXT record at your domain host (where you bought %s):" % inbox.domain,
        "  Host/Name: @    Type: TXT    Value: v=spf1 %s ~all" % include,
    ]


def _dkim_fix(inbox: Inbox) -> List[str]:
    if inbox.is_google:
        return [
            "Turn on DKIM in Google Workspace:",
            "  1. admin.google.com > Apps > Google Workspace > Gmail > Authenticate email",
            "  2. Pick %s, click Generate new record (2048 bit), copy the TXT value" % inbox.domain,
            "  3. At your domain host add  Host/Name: google._domainkey   Type: TXT   Value: (the long text you copied)",
            "  4. Wait 1 hour, go back to Authenticate email and click Start authentication",
        ]
    if inbox.provider.startswith("zoho"):
        return [
            "Turn on DKIM in Zoho Mail:",
            "  1. mailadmin.zoho.com > Domains > %s > Email Configuration > DKIM > Add" % inbox.domain,
            "  2. Selector: zmail. Copy the TXT value Zoho shows",
            "  3. At your domain host add  Host/Name: zmail._domainkey   Type: TXT   Value: (what you copied)",
            "  4. Back in Zoho click Verify. Then put INBOX_DKIM_SELECTOR=zmail in .env",
        ]
    return [
        "Ask your email provider for the DKIM record, add it at your domain host, then put its",
        "selector (the part before ._domainkey) in .env as the inbox's DKIM_SELECTOR.",
    ]


def _dmarc_fix(inbox: Inbox) -> List[str]:
    return [
        "Recommended: add a DMARC record at your domain host:",
        "  Host/Name: _dmarc    Type: TXT    Value: v=DMARC1; p=none; rua=mailto:%s" % inbox.email,
    ]
