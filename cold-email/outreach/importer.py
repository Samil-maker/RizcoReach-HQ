"""Lead import: CSV or XLSX files in leads/inbox/ become clean leads in the database.

Cleaning: tidy and check every email address and fix obvious typos (emailcheck.py), check MX records
(the domain can receive email), drop duplicates (in the
file and against everyone already imported, including two addresses at the same company), drop
anyone on the suppression list. Then each lead gets its segment. The original file moves to
leads/processed/, next to a .rejected.csv that says why each skipped row was skipped.
"""
from __future__ import annotations

import csv
import fcntl
import io
import json
import re
import shutil
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import clock, config, db, dnscheck, emailcheck, names, segment, sitecheck, suppression

FIELDS: Dict[str, List[str]] = {
    "business_name": ["business name", "business", "company name", "company", "page name", "place name", "brand",
                      "brand name", "store name", "shop name", "account name", "organization", "organisation",
                      "organization 1 name", "title", "business title"],
    "first_name": ["first name", "firstname", "given name", "contact first name", "owner first name", "first"],
    "full_name": ["contact name", "contact person", "contact", "owner name", "owner", "full name", "person",
                  "manager name", "manager", "decision maker"],
    "email": ["email", "e mail", "email address", "e mail address", "mail", "emails", "contact email",
              "business email", "email 1", "e mail 1 value", "work email", "email id"],
    "website": ["website", "web site", "site", "url", "website url", "web", "domain", "homepage", "landing page"],
    "instagram": ["instagram", "ig", "insta", "instagram url", "instagram handle", "instagram profile", "instagram link"],
    "phone": ["phone", "mobile", "whatsapp", "phone number", "mobile number", "whatsapp number", "telephone", "tel",
              "contact number", "number", "phone 1 value", "best phone"],
    "niche": ["niche", "category", "industry", "business type", "type", "sector", "categories"],
    "area": ["area", "neighbourhood", "neighborhood", "district", "community", "location", "city"],
    "address": ["address", "full address", "street address", "formatted address", "address 1 formatted"],
    "source": ["source", "found on", "lead source", "origin", "platform", "channel"],
    "notes": ["notes", "note", "comments", "comment", "remarks"],
    "segment": ["segment"],
    "status": ["status", "lead status", "stage"],
    "meta_ads": ["meta ads", "meta ads status", "running meta ads", "facebook ads"],
    "tags": ["tags", "labels"],
    "campaign": ["campaign"],
}
# Rows already handled in Lead Hunter (or a CRM export) are left out: they replied, said no, or are clients.
HANDLED_STATUS = re.compile(r"^(replied|meeting booked|meeting|won|client|customer|not interested|lost|skip|do not contact|dnc)$", re.I)
FUZZY = {"email": "email", "website": "website", "instagram": "instagram", "phone": "phone"}

# Email address checks and typo fixes live in emailcheck.py


def norm_header(h) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(h or "").lower()).strip()


def map_columns(headers: List[str], overrides: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Which file column feeds which field. overrides: {"email": "Contact Email"} from --map."""
    normalized = {h: norm_header(h) for h in headers if h is not None and str(h).strip()}
    used, mapping = set(), {}
    for field, header in (overrides or {}).items():
        match = next((h for h in normalized if h == header or normalized[h] == norm_header(header)), None)
        if match is None:
            raise ValueError('--map %s="%s": the file has no column called "%s"' % (field, header, header))
        mapping[field] = match
        used.add(match)
    for field, synonyms in FIELDS.items():
        if field in mapping:
            continue
        for syn in synonyms:
            match = next((h for h, n in normalized.items() if n == syn and h not in used), None)
            if match:
                mapping[field] = match
                used.add(match)
                break
    if "name" in normalized.values():
        h = next(h for h, n in normalized.items() if n == "name")
        if h not in used:
            mapping.setdefault("business_name" if "business_name" not in mapping else "full_name", h)
            used.add(h)
    for field, word in FUZZY.items():
        if field not in mapping:
            match = next((h for h, n in normalized.items() if word in n.split() and h not in used and "link" not in n), None)
            if match:
                mapping[field] = match
                used.add(match)
    return mapping


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value)).strip()


def read_rows(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(str(path), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = [[_cell(v) for v in r] for r in ws.iter_rows(values_only=True)]
        wb.close()
    elif path.suffix.lower() in (".csv", ".txt", ".tsv"):
        raw = path.read_bytes()
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = [[_cell(v) for v in r] for r in csv.reader(io.StringIO(text), dialect)]
    else:
        raise ValueError("%s: only .csv and .xlsx files can be imported. Save it as one of those." % path.name)
    start = next((i for i, r in enumerate(rows) if sum(1 for v in r if v) >= 2), None)
    if start is None:
        return [], []
    headers = [h or "column %d" % (i + 1) for i, h in enumerate(rows[start])]
    out = []
    for r in rows[start + 1:]:
        if not any(r):
            continue
        out.append({headers[i]: (r[i] if i < len(r) else "") for i in range(len(headers))})
    return headers, out


def pick_email(value: str) -> Tuple[str, str, str]:
    """(email, fixed, problem). Takes the first usable address from a cell that may hold several."""
    return emailcheck.clean(value)


def business_key(email: str, website: str) -> List[str]:
    """Keys that mean "the same business": a company email domain, a website host."""
    keys = []
    domain = email.split("@")[-1]
    if domain and domain not in config.FREE_DOMAINS:
        keys.append("domain:" + domain)
    host = sitecheck.host_of(website) if website else ""
    if host:
        keys.append("domain:" + (host[4:] if host.startswith("www.") else host))
    return keys


def clean_row(row: Dict[str, str], mapping: Dict[str, str]) -> Tuple[Optional[Dict], str]:
    get = lambda f: _cell(row.get(mapping[f], "")) if f in mapping else ""  # noqa: E731
    if HANDLED_STATUS.match(get("status")):
        return None, "already handled (status: %s)" % get("status")
    email, fixed, problem = pick_email(get("email"))
    if not email:
        return None, problem
    business_name = get("business_name")
    business = names.clean_business(business_name)
    if not business:
        return None, "no business name"
    website, ig_from_site = sitecheck.normalize_website(get("website"))
    instagram = names.instagram_handle(get("instagram")) or ig_from_site
    first = names.clean_first_name(get("first_name") or get("full_name"), business)
    lead = {
        "email": email,
        "email_fixed": fixed,
        "business_name": business_name,
        "business": business,
        "first_name": first,
        "website": website,
        "instagram": instagram,
        "phone": get("phone"),
        "niche": get("niche"),
        "area": names.clean_area(get("area"), get("address")),
        "address": get("address"),
        "source": get("source"),
        "notes": get("notes"),
        "segment": get("segment"),
        "meta_ads": get("meta_ads"),
        "tags": get("tags"),
        "campaign": get("campaign"),
        "raw_json": json.dumps(row, ensure_ascii=False),
    }
    return lead, ""


def _existing_keys(con) -> Tuple[set, set]:
    emails, keys = set(), set()
    for r in con.execute("SELECT email, website FROM leads"):
        emails.add(r["email"])
        keys.update(business_key(r["email"], r["website"] or ""))
    return emails, keys


def file_campaign(path: Path, mapping: Dict[str, str], chosen: str = "auto") -> str:
    """website or ads. "auto": Lead Hunter's Meta ads export (a meta_ads column or a meta-ads file name) is ads."""
    if chosen in config.CAMPAIGNS:
        return chosen
    if "meta_ads" in mapping or re.search(r"meta.?ads", path.name, re.I):
        return "ads"
    return "website"


def row_campaign(value: str, default: str) -> str:
    v = (value or "").strip().lower()
    if v in ("ads", "meta", "meta ads", "facebook ads", "facebook"):
        return "ads"
    if v in ("website", "web", "site"):
        return "website"
    return default


def import_file(con, path: Path, overrides: Optional[Dict[str, str]] = None, check_sites: bool = True,
                log=print, move: bool = True, campaign: str = "auto") -> Dict:
    headers, rows = read_rows(path)
    if not rows:
        raise ValueError("%s has no rows (or no header row)." % path.name)
    mapping = map_columns(headers, overrides)
    default_campaign = file_campaign(path, mapping, campaign)
    missing = [f for f in ("email", "business_name") if f not in mapping]
    if missing:
        nice = {"email": "email address", "business_name": "business name"}
        raise ValueError(
            "%s: I can't find a column for the %s.\n  Columns in the file: %s\n  Tell me which one it is, for example:\n"
            '    rizco import --map %s="Your Column Name"'
            % (path.name, " and the ".join(nice[m] for m in missing), ", ".join(h for h in headers if h), missing[0])
        )
    log("\n%s: %d rows (%s campaign)" % (path.name, len(rows), config.CAMPAIGNS[default_campaign]))
    log("  Columns used: " + ", ".join("%s <- %s" % (f, h) for f, h in mapping.items()))

    stats = Counter()
    rejected: List[Tuple[Dict, str]] = []
    suppressed = suppression.load()
    seen_emails, seen_keys = _existing_keys(con)
    leads: List[Dict] = []
    fixes: List[str] = []
    for row in rows:
        lead, problem = clean_row(row, mapping)
        if not lead and problem.startswith("already handled"):
            stats["handled"] += 1
            rejected.append((row, problem))
            continue
        if not lead:
            stats["invalid"] += 1
            rejected.append((row, problem))
            continue
        if suppression.is_suppressed(lead["email"], suppressed):
            stats["suppressed"] += 1
            rejected.append((row, "on the suppression list"))
            continue
        keys = business_key(lead["email"], lead["website"])
        if lead["email"] in seen_emails or any(k in seen_keys for k in keys):
            stats["duplicate"] += 1
            rejected.append((row, "duplicate (same email or same company domain already imported)"))
            continue
        seen_emails.add(lead["email"])
        seen_keys.update(keys)
        if lead["email_fixed"]:
            fixes.append(lead["email_fixed"])
        lead["campaign"] = row_campaign(lead["campaign"], default_campaign)
        leads.append(lead)

    # MX records, many domains at once
    domains = sorted({l["email"].split("@")[1] for l in leads})
    if domains:
        log("  Checking MX records for %d email domains..." % len(domains))
        with ThreadPoolExecutor(max_workers=16) as pool:
            mx = dict(zip(domains, pool.map(dnscheck.mx_status, domains)))
    else:
        mx = {}
    kept = []
    for lead in leads:
        status = mx.get(lead["email"].split("@")[1], "unchecked")
        if status == "none":
            stats["invalid"] += 1
            rejected.append((json.loads(lead["raw_json"]), "email domain has no MX records (cannot receive email)"))
            continue
        lead["mx_status"] = status
        stats["mx_unchecked"] += status == "unchecked"
        kept.append(lead)

    # Website checks for leads that might be segment C
    to_check = [l for l in kept if l["campaign"] == "website" and l["website"]
                and (l["segment"] or "").upper() not in ("A", "B", "SKIP") and not segment.is_new_business(l["source"], l["notes"])]
    sites: Dict[str, Dict] = {}
    if to_check and check_sites:
        log("  Checking %d websites (about %d seconds)..." % (len(to_check), max(5, len(to_check) * 2)))
        with ThreadPoolExecutor(max_workers=8) as pool:
            for lead, site in zip(to_check, pool.map(lambda l: sitecheck.check_site(l["website"]), to_check)):
                sites[lead["email"]] = site

    now = clock.iso()
    for lead in kept:
        site = sites.get(lead["email"])
        if lead["campaign"] == "ads":
            decision = segment.decide_ads(lead)
        else:
            decision = segment.decide(lead, site if site else ({"state": "unchecked"} if lead["website"] else None))
        lead.update(decision)
        stats["seg_" + lead["segment"]] += 1
        if lead["segment"] == "SKIP":
            stats["skip:" + lead["segment_reason"].split(":")[0]] += 1
        con.execute(
            """INSERT OR IGNORE INTO leads(email, business_name, business, first_name, website, instagram, phone, niche, area,
                   address, source, notes, segment, segment_reason, observation, observation_kind, site_json,
                   site_checked_at, mx_status, status, next_step, next_due, import_file, imported_at, raw_json, campaign)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (lead["email"], lead["business_name"], lead["business"], lead["first_name"], lead["website"],
             lead["instagram"], lead["phone"], lead["niche"], lead["area"], lead["address"], lead["source"],
             lead["notes"], lead["segment"], lead["segment_reason"], lead.get("observation"),
             lead.get("observation_kind"), json.dumps(site) if site else None, site["checked_at"] if site else None,
             lead["mx_status"], "skipped" if lead["segment"] == "SKIP" else "queued", 0,
             clock.today().isoformat(), path.name, now, lead["raw_json"], lead["campaign"]),
        )
    stats["imported"] = len(kept)
    db.log_event(con, "import", "%s: %d imported" % (path.name, len(kept)))

    if move:
        dest_dir = config.leads_processed()
        dest_dir.mkdir(parents=True, exist_ok=True)
        stamp = clock.now().strftime("%Y%m%d_%H%M%S")
        dest = dest_dir / ("%s_%s" % (stamp, path.name))
        shutil.move(str(path), str(dest))
        if rejected:
            with (dest_dir / ("%s_%s.rejected.csv" % (stamp, path.stem))).open("w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["why skipped"] + headers)
                for row, why in rejected:
                    w.writerow([why] + [row.get(h, "") for h in headers])
    stats["rows"] = len(rows)
    stats["fixed"] = len(fixes)
    return {"file": path.name, "stats": stats, "rejected": rejected, "campaign": default_campaign, "fixes": fixes}


def summary_lines(result: Dict) -> List[str]:
    s = result["stats"]
    lines = [
        "  Imported: %d   Skipped: %d duplicates, %d on the suppression list, %d invalid%s"
        % (s["imported"], s["duplicate"], s["suppressed"], s["invalid"],
           ", %d already handled in Lead Hunter" % s["handled"] if s["handled"] else ""),
        ("  Segments: A new business %d | B no website %d | C outdated website %d | Skip %d"
         % (s["seg_A"], s["seg_B"], s["seg_C"], s["seg_SKIP"])) if result.get("campaign") != "ads" else
        ("  Meta ads: no ads running %d | not checked %d | already running ads, skipped %d" % (s["seg_N"], s["seg_G"], s["seg_SKIP"])),
    ]
    skips = [(k[5:], v) for k, v in s.items() if k.startswith("skip:")]
    if skips:
        lines.append("  Skipped because: " + ", ".join("%s (%d)" % kv for kv in sorted(skips, key=lambda kv: -kv[1])))
    if result.get("fixes"):
        lines.append("  Fixed %d email typo%s, for example %s" % (len(result["fixes"]), "" if len(result["fixes"]) == 1 else "s",
                                                              ", ".join(result["fixes"][:3])))
    if s["mx_unchecked"]:
        lines.append("  %d email domains did not answer the MX check. They are checked again before sending." % s["mx_unchecked"])
    if result["rejected"]:
        why = Counter(w for _, w in result["rejected"])
        lines.append("  Rows not imported: " + ", ".join("%s (%d)" % kv for kv in why.most_common()))
        lines.append("  The file and a .rejected.csv with every skipped row are in leads/processed/")
    return lines


@contextmanager
def import_lock():
    """One import at a time: the hourly job, the 9:00 send and you by hand take turns (waiting, not failing)."""
    path = config.path("data", "import.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def import_pending(con, log=print, overrides: Optional[Dict[str, str]] = None, check_sites: bool = True,
                   campaign: str = "auto") -> List[Dict]:
    """Imports every file waiting in leads/inbox/. Used by the daily jobs, so you only drop files in."""
    with import_lock():
        return _import_pending(con, log, overrides, check_sites, campaign)


def _import_pending(con, log, overrides, check_sites, campaign="auto") -> List[Dict]:
    results = []
    for path in pending_files():
        try:
            results.append(import_file(con, path, overrides, check_sites=check_sites, log=log, campaign=campaign))
        except ValueError as e:
            log(str(e))
            bad = config.leads_processed() / ("could-not-import_" + path.name)
            bad.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(bad))  # out of the way, so it doesn't fail every hour
            from . import launchd

            launchd.notify("RizcoReach: a lead file could not be imported", "%s: no email or business name column" % path.name)
    return results


def pending_files() -> List[Path]:
    folder = config.leads_inbox()
    folder.mkdir(parents=True, exist_ok=True)
    return sorted(p for p in folder.iterdir() if p.is_file() and not p.name.startswith((".", "~$")))
