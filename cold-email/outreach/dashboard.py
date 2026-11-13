"""The dashboard: a private page on your Mac at http://localhost:8321

Drop lead files in, see who replied (with the drafted answer), watch today's sending and the warm up,
add inboxes, pause and resume. It runs in the background (a launchd job) and only answers your own Mac:
it listens on 127.0.0.1, refuses other host names, and every request needs the key that is put into the
page when it loads, so other websites can't talk to it. It never shows App Passwords.
"""
from __future__ import annotations

import json
import re
import secrets
import threading
import time
import uuid
import webbrowser
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urlsplit

from . import (actions, classify, clock, config, db, importer, launchd, names, portfolio, replies, report, safety,
               schedule, sender, templates, warmup)

PORT = 8321
URL = "http://localhost:%d/" % PORT
HOSTS = {"localhost", "127.0.0.1"}
MAX_UPLOAD = 25 * 1024 * 1024
UPLOAD_TYPES = (".csv", ".xlsx", ".xlsm", ".tsv", ".txt")
STATUS_NAMES = {
    "queued": "Waiting to send", "active": "In sequence", "replied": "Replied", "done": "Finished, no reply",
    "skipped": "Skipped", "bounced": "Bounced", "opted_out": "Said no", "suppressed": "Never email", "blocked": "Needs a fix",
}


class _State:
    token = secrets.token_urlsafe(24)
    jobs: Dict[str, Dict] = {}
    lock = threading.Lock()


def settings() -> config.Settings:
    from .setup_wizard import read_env

    return config.load_settings(read_env())


def _nice_time(iso: Optional[str]) -> str:
    if not iso:
        return ""
    dt = clock.parse(iso)
    day = dt.date()
    today = clock.today()
    if day == today:
        return "today %s" % dt.strftime("%H:%M")
    if day == today - timedelta(days=1):
        return "yesterday %s" % dt.strftime("%H:%M")
    return "%s %d %s" % (dt.strftime("%a"), dt.day, dt.strftime("%b"))


# ----------------------------------------------------------------------------- read

def overview(con, s: config.Settings) -> Dict:
    today, now = clock.today(), clock.now()
    t, monday = today.isoformat(), clock.week_start(today).isoformat()
    paused = safety.paused(con)
    approved = bool(db.get_state(con, "approved"))
    running = sender.Lock.held("send")
    inboxes = []
    for i in s.inboxes:
        lim = schedule.limits(con, i, today)
        w = warmup.summary(con, i.key)
        inboxes.append({"email": i.email, "status": lim["why"], "warming": bool(lim.get("warming")), "sent": lim["sent"],
                        "cap": lim["cap"], "warm_sent": w["sent"], "warm_spam": w["spam"], "warm_checked": w["checked"],
                        "sends": " and ".join(config.CAMPAIGNS[c] for c in i.campaigns)})
    campaigns = []
    for key, name in config.CAMPAIGNS.items():
        row = con.execute(
            "SELECT SUM(status='queued') AS queued, SUM(first_sent_at IS NOT NULL) AS emailed, "
            "SUM(reply_class IN ('interested','question','not_now','opt_out','other')) AS replied, "
            "SUM(reply_class='interested' OR outcome='client') AS interested FROM leads WHERE COALESCE(campaign,'website')=?",
            (key,)).fetchone()
        campaigns.append({"key": key, "name": name, "approved": schedule.campaign_approved(con, key),
                          "inboxes": [i.email for i in s.inboxes if key in i.campaigns],
                          **{k: row[k] or 0 for k in ("queued", "emailed", "replied", "interested")}})
    f = schedule.forecast(con, s.inboxes) if s.inboxes else {"today": 0, "reach": {}}
    one = lambda sql, *a: con.execute(sql, a).fetchone()[0] or 0  # noqa: E731
    sent_today = one("SELECT COUNT(*) FROM messages WHERE kind='campaign' AND sent_date=? AND status IN ('sent','bounced')", t)
    cap_today = sum(i["cap"] for i in inboxes) if schedule.is_send_day(today) else 0
    human = "is_auto=0 AND classification!='bounce'"
    queue = {r["segment"]: r["n"] for r in con.execute("SELECT segment, COUNT(*) AS n FROM leads WHERE status='queued' GROUP BY segment")}
    send_day = today if schedule.is_send_day(today) else clock.next_weekday(today)
    following = one("SELECT COUNT(*) FROM leads WHERE status='active'")
    due_next = one("SELECT COUNT(*) FROM leads WHERE status='active' AND next_due<=?", send_day.isoformat())
    full = f.get("full", 0)

    if paused:
        nxt = "Paused"
    elif not approved:
        nxt = "Off until a test email is approved (rizco setup)"
    elif running and schedule.fast_today(con):
        nxt = "Sending now, about one a minute"
    elif running:
        nxt = "Sending now, spread until about 21:45"
    elif schedule.is_send_day(today) and now < clock.at(today, 9):
        nxt = "Today at 9:00"
    elif schedule.is_send_day(today) and schedule.current_window_end(now) and sent_today < cap_today and sum(queue.values()):
        nxt = "Not running right now. Press Start sending to send the rest of today's emails"
    else:
        nxt = "%s at 9:00" % clock.nice(clock.next_weekday(today + timedelta(days=1)))
    return {
        "today": "%s %d %s" % (today.strftime("%A"), today.day, today.strftime("%B")),
        "paused": paused, "approved": approved, "running": running, "next": nxt,
        "can_start": bool(approved and not paused and not running and schedule.current_window_end(now) and launchd.IS_MAC),
        "problems": s.problems,
        "inboxes": inboxes,
        "campaigns": campaigns,
        "forecast": {"today": f["today"], "reach": {str(k): (clock.nice(v) if hasattr(v, "day") else v) for k, v in f["reach"].items()}},
        # Follow ups go first. When they fill most of a day, fewer new businesses fit in: time for another inbox.
        "followups": {"active": following, "due_next": due_next, "full": full, "busy": bool(full and due_next >= 0.6 * full)},
        "stats": {
            "sent_today": sent_today, "cap_today": cap_today,
            "sent_week": one("SELECT COUNT(*) FROM messages WHERE kind='campaign' AND sent_date>=? AND status IN ('sent','bounced')", monday),
            "replies_week": one("SELECT COUNT(*) FROM inbound WHERE %s AND substr(received_at,1,10)>=?" % human, monday),
            "interested_week": one("SELECT COUNT(*) FROM inbound WHERE classification='interested' AND is_auto=0 AND substr(received_at,1,10)>=?", monday),
            "bounces_week": one("SELECT COUNT(*) FROM messages WHERE status='bounced' AND sent_date>=?", monday),
            "waiting": one("SELECT COUNT(*) FROM leads WHERE waiting_on_me=1"),
            "queued": sum(queue.values()), "queue": queue,
            "active": one("SELECT COUNT(*) FROM leads WHERE status='active'"),
            "emailed": one("SELECT COUNT(*) FROM leads WHERE first_sent_at IS NOT NULL"),
            "replied": one("SELECT COUNT(*) FROM leads WHERE reply_class IN ('interested','question','not_now','opt_out','other')"),
            "interested": one("SELECT COUNT(*) FROM leads WHERE reply_class='interested' OR outcome='client'"),
            "clients": one("SELECT COUNT(*) FROM leads WHERE outcome='client'"),
        },
        "replies_checked": _nice_time(db.get_state(con, "replies_checked")),
        "settings": {"from_name": s.from_name, "whatsapp": names.format_whatsapp(s.whatsapp), "examples_link": s.examples_link,
                     "test_email_to": s.test_email_to, "daily_limit": s.daily_limit, "max_daily_limit": config.MAX_DAILY_LIMIT,
                     "website_price": s.website_price, "care_price": s.care_price},
    }


def waiting(con, s: config.Settings) -> List[Dict]:
    actions.check_ins_due(con)
    out = []
    for lead in con.execute("SELECT * FROM leads WHERE waiting_on_me=1 ORDER BY replied_at DESC").fetchall():
        msg = con.execute("SELECT * FROM inbound WHERE lead_id=? AND is_auto=0 AND classification!='bounce' "
                          "ORDER BY received_at DESC LIMIT 1", (lead["id"],)).fetchone()
        inbox = s.inbox(lead["inbox"] or "") or (s.inboxes[0] if s.inboxes else None)
        check_in = (lead["stop_reason"] or "").startswith("check in")
        out.append({
            "business": lead["business"], "email": lead["email"], "phone": lead["phone"] or "",
            "whatsapp": report.wa_link(lead["phone"] or ""),
            "instagram": "https://www.instagram.com/%s/" % lead["instagram"] if lead["instagram"] else "",
            "segment": report.SEGMENT_NAMES.get(lead["segment"], lead["segment"]),
            "kind": "time to check in" if check_in else classify.LABELS.get(lead["reply_class"] or "", lead["reply_class"] or ""),
            "said": (msg["body"] if msg else "") or "", "when": _nice_time(msg["received_at"] if msg else lead["replied_at"]),
            "draft": templates.check_in(lead, s) if check_in else (msg["draft"] if msg else "") or "",
            "draft_saved": bool(msg and msg["draft_saved"]) and not check_in,
            "gmail": "https://mail.google.com/mail/u/?authuser=%s#%s" % (
                inbox.email if inbox else "", "drafts" if msg and msg["draft_saved"] and not check_in else "search/from%3A" + lead["email"]),
        })
    return out


def leads(con, status: str = "", q: str = "", offset: int = 0, limit: int = 100) -> Dict:
    where, args = [], []
    if status in STATUS_NAMES:
        where.append("status=?")
        args.append(status)
    if q:
        where.append("(business LIKE ? OR email LIKE ? OR area LIKE ?)")
        args += ["%" + q + "%"] * 3
    sql = " WHERE " + " AND ".join(where) if where else ""
    total = con.execute("SELECT COUNT(*) FROM leads" + sql, args).fetchone()[0]
    rows = con.execute(
        "SELECT * FROM leads%s ORDER BY COALESCE(last_sent_at, imported_at) DESC, id DESC LIMIT ? OFFSET ?" % sql,
        args + [limit, offset]).fetchall()
    counts = {r["status"]: r["n"] for r in con.execute("SELECT status, COUNT(*) AS n FROM leads GROUP BY status")}
    items = []
    for r in rows:
        note = r["observation"] if r["segment"] == "C" and r["status"] == "queued" else (r["stop_reason"] or r["segment_reason"] or "")
        if r["status"] == "active" and r["next_due"]:
            note = "follow up %d due %s" % (r["next_step"], clock.nice(clock.parse_date(r["next_due"])))
        items.append({"business": r["business"], "email": r["email"], "segment": r["segment"], "status": r["status"],
                      "status_name": STATUS_NAMES.get(r["status"], r["status"]), "note": note or "",
                      "outcome": r["outcome"] or "", "area": r["area"] or "", "website": r["website"] or ""})
    return {"total": total, "items": items, "counts": counts, "names": STATUS_NAMES}


EVENT_TEXT = {
    "sent": lambda e: "Sent %s to %s" % ("the first email" if e["detail"] == "step 0" else "follow up " + e["detail"][-1:], e["who"]),
    "reply": lambda e: "%s replied: %s" % (e["who"], classify.LABELS.get(e["detail"], e["detail"])),
    "bounce": lambda e: "Email to %s bounced" % e["who"],
    "auto_reply": lambda e: "%s: automatic reply (%s)" % (e["who"], e["detail"].strip()),
    "import": lambda e: "Imported %s" % e["detail"],
    "marked": lambda e: "You marked %s: %s" % (e["who"], actions.MARKS.get(e["detail"], e["detail"])),
    "you_replied": lambda e: "You answered %s" % e["who"],
    "paused": lambda e: "Sending paused: %s" % e["detail"],
    "resumed": lambda e: "Sending resumed",
    "approved": lambda e: "Meta ads emails approved" if "Meta ads" in e["detail"] else "Test email approved, sending switched on",
    "fast": lambda e: "You pressed Send the rest now: about one a minute for the rest of today",
    "test_email": lambda e: "Test email sent to %s" % e["detail"],
    "updated": lambda e: "Updated to the latest version",
    "update_failed": lambda e: "An update failed its tests and was skipped",
    "suppressed": lambda e: "Never email again: %s" % e["detail"],
    "fixed": lambda e: "Fixed an email typo before sending: %s" % e["detail"],
    "check_in": lambda e: "%s said not now a while ago: time to check in (it's on your Reply to these list)" % e["who"],
}


def activity(con, limit: int = 40) -> List[Dict]:
    out = []
    for e in con.execute("SELECT e.*, l.business, l.email FROM events e LEFT JOIN leads l ON l.id=e.lead_id "
                         "ORDER BY e.id DESC LIMIT ?", (limit,)).fetchall():
        e = dict(e, who=e["business"] or e["email"] or "", detail=e["detail"] or "")
        fn = EVENT_TEXT.get(e["type"])
        if fn:
            out.append({"when": _nice_time(e["ts"]), "type": e["type"], "text": fn(e)})
    return out


def preview(con, s: config.Settings, campaign: str = "") -> List[Dict]:
    out = []
    for seg in report.SEGMENTS:
        if campaign and templates.CAMPAIGN_OF_SEGMENT[seg] != campaign:
            continue
        rows = con.execute("SELECT * FROM leads WHERE segment=? AND status='queued' ORDER BY id LIMIT 3", (seg,)).fetchall()
        for n, lead in enumerate(rows):
            subject, body, full = templates.first_email(lead, "AB"[n % 2], s)
            out.append({"segment": report.SEGMENT_NAMES[seg], "to": lead["email"], "subject": subject, "text": full,
                        "version": "AB"[n % 2]})
    if campaign == "ads" and not out:  # nothing imported yet: show what the emails look like for a made up business
        for seg in ("N", "G"):
            for v in "AB":
                sample = {"segment": seg, "campaign": "ads", "business": "Glossy PPF", "first_name": "", "area": "Al Quoz",
                          "observation": "", "source": "", "instagram": "", "address": ""}
                subject, body, full = templates.first_email(sample, v, s)
                out.append({"segment": report.SEGMENT_NAMES[seg], "to": "example (a made up business)", "subject": subject,
                            "text": full, "version": v})
    return out


# ----------------------------------------------------------------------------- background jobs

def _job(fn, *args) -> str:
    job_id = uuid.uuid4().hex[:12]
    _State.jobs[job_id] = {"done": False, "lines": [], "result": None, "error": ""}

    def run():
        lines = _State.jobs[job_id]["lines"]
        try:
            _State.jobs[job_id]["result"] = fn(lambda *m: lines.append(" ".join(str(x) for x in m).strip()), *args)
        except Exception as e:  # noqa: BLE001
            _State.jobs[job_id]["error"] = str(e) or e.__class__.__name__
        _State.jobs[job_id]["done"] = True

    threading.Thread(target=run, daemon=True).start()
    for old in list(_State.jobs)[:-50]:
        _State.jobs.pop(old, None)
    return job_id


def _import_job(log, campaign="auto"):
    con = db.connect()
    results = importer.import_pending(con, log=log, campaign=campaign)
    out = []
    for r in results:
        st = r["stats"]
        reasons: Dict[str, int] = {}
        for _, why in r["rejected"]:
            reasons[why] = reasons.get(why, 0) + 1
        out.append({"file": r["file"], "imported": st["imported"], "rows": st["rows"], "A": st["seg_A"], "B": st["seg_B"],
                    "C": st["seg_C"], "N": st["seg_N"], "G": st["seg_G"], "skip": st["seg_SKIP"],
                    "campaign": config.CAMPAIGNS[r.get("campaign", "website")], "duplicate": st["duplicate"], "invalid": st["invalid"],
                    "suppressed": st["suppressed"], "handled": st["handled"], "fixed": st["fixed"], "fixes": r.get("fixes", [])[:3],
                    "reasons": sorted(reasons.items(), key=lambda kv: -kv[1])[:6]})
    return out


def _replies_job(log):
    found = replies.check_all(db.connect(), settings(), log=log, quiet=True)
    return {"found": len(found), "hot": sum(1 for r in found if r["label"] in ("interested", "question"))}


def _add_inbox_job(log, email, password, brand_new, campaign="website"):
    from .setup_wizard import add_inbox_from_form

    ok, message = add_inbox_from_form(email, password, brand_new, campaign=campaign)
    if ok and launchd.IS_MAC:
        launchd.install()
    return {"ok": ok, "message": message}


def save_upload(name: str, data: bytes) -> Path:
    name = Path(name or "leads.csv").name
    stem, suffix = Path(name).stem, Path(name).suffix.lower()
    if suffix not in UPLOAD_TYPES:
        raise ValueError("Only CSV or Excel (.xlsx) files. Export it as one of those and drop it in again.")
    stem = re.sub(r"[^\w .()+&@-]", "_", stem).strip() or "leads"
    folder = config.leads_inbox()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (stem + suffix)
    if path.exists():
        path = folder / ("%s_%s%s" % (stem, clock.now().strftime("%H%M%S"), suffix))
    path.write_bytes(data)
    return path


# ----------------------------------------------------------------------------- write

def post(path: str, body: Dict, raw: bytes, headers) -> Dict:
    con = db.connect()
    if path == "/api/upload":
        from urllib.parse import unquote

        campaign = (headers.get("X-Campaign") or "auto").lower()
        save_upload(unquote(headers.get("X-Filename") or ""), raw)
        return {"job": _job(_import_job, campaign if campaign in config.CAMPAIGNS else "auto")}
    if path == "/api/portfolio":
        from urllib.parse import unquote

        ok, message = portfolio.add(unquote(headers.get("X-Filename") or ""), raw)
        return {"ok": ok, "message": message}
    if path == "/api/portfolio-remove":
        ok, message = portfolio.remove(body.get("name", ""))
        return {"ok": ok, "message": message}
    if path == "/api/approve-campaign":
        if body.get("campaign") != "ads":
            return {"ok": False, "message": "The website emails were approved with your test email in setup."}
        db.set_state(con, "approved:ads", {"at": clock.iso()})
        db.log_event(con, "approved", "Meta ads emails approved on the dashboard")
        has_inbox = any("ads" in i.campaigns for i in settings().inboxes)
        return {"ok": True, "message": "Meta ads emails approved." + ("" if has_inbox else
                " They start once an inbox sends Meta ads: add one and choose Meta ads (or Both).")}
    if path == "/api/mark":
        ok, message = actions.mark(con, body.get("email", ""), body.get("what", ""), body.get("note") or None)
        return {"ok": ok, "message": message}
    if path == "/api/pause":
        safety.pause(con, "paused by you from the dashboard", "", log=lambda *a: None)
        return {"ok": True, "message": "Sending paused. Nothing goes out until you press Resume."}
    if path == "/api/resume":
        safety.resume(con)
        return {"ok": True, "message": "Sending resumed."}
    if path == "/api/check-replies":
        return {"job": _job(_replies_job)}
    if path == "/api/send-fast":
        s = settings()
        now = clock.now()
        if safety.paused(con):
            return {"ok": False, "message": "Sending is paused. Resume it first."}
        if not db.get_state(con, "approved"):
            return {"ok": False, "message": "Sending isn't approved yet (run the setup line once more)."}
        if not schedule.is_send_day(now.date()) or not schedule.current_window_end(now):
            return {"ok": False, "message": "Emails only go out 9:00 to 22:00, Monday to Friday. Try again then."}
        left = sum(len(v["items"]) for v in schedule.plan(con, s, now.date(), [i for i in s.inboxes if i.password]).values())
        if not left:
            return {"ok": False, "message": "Nothing left to send today: no new leads waiting, or today's limit is used up."}
        schedule.set_fast(con)
        if not sender.Lock.held("send"):
            launchd.start_now()
        done = now + timedelta(minutes=left + 2)
        return {"ok": True, "message": "Sending %d email%s now, about one a minute. Done by about %s."
                % (left, "" if left == 1 else "s", done.strftime("%H:%M"))}
    if path == "/api/start":
        ov = overview(con, settings())
        if not ov["can_start"]:
            return {"ok": False, "message": "Can't start now: %s" % ov["next"]}
        return {"ok": launchd.start_now(), "message": "Started. Today's emails go out slowly in the background."}
    if path == "/api/settings":
        from .setup_wizard import write_env

        updates = {}
        wa = re.sub(r"\D", "", body.get("whatsapp", ""))
        if wa:
            if len(wa) < 9:
                return {"ok": False, "message": "That WhatsApp number looks too short."}
            updates["WHATSAPP_NUMBER"] = "+" + re.sub(r"\D", "", names.format_whatsapp(wa))
        link = (body.get("examples_link") or "").strip()
        if link:
            if not re.match(r"^https://\S+$", link) or names.DASHES[1:] and any(c in link for c in names.DASHES[1:]):
                return {"ok": False, "message": "The portfolio link must start with https:// (and have no long dashes)."}
            updates["EXAMPLES_LINK"] = link
        for field, key, low, high in (("website_price", "WEBSITE_PRICE", 100, 100000), ("care_price", "CARE_PLAN_PRICE", 50, 50000)):
            value = re.sub(r"[^\d]", "", str(body.get(field) or ""))
            if value:
                if not low <= int(value) <= high:
                    return {"ok": False, "message": "That price looks wrong (%s)." % body.get(field)}
                updates[key] = value
        limit = str(body.get("daily_limit") or "").strip()
        if limit:
            if not limit.isdigit() or not 1 <= int(limit) <= config.MAX_DAILY_LIMIT:
                return {"ok": False, "message": "Emails a day per inbox must be between 1 and %d." % config.MAX_DAILY_LIMIT}
            updates["DAILY_LIMIT"] = str(int(limit))
        if updates:
            write_env(updates)
        return {"ok": True, "message": "Saved."}
    if path == "/api/add-inbox":
        campaign = body.get("campaign") if body.get("campaign") in ("website", "ads", "both") else "website"
        return {"job": _job(_add_inbox_job, body.get("email", ""), body.get("password", ""), bool(body.get("brand_new")), campaign)}
    raise KeyError(path)


# ----------------------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    server_version = "RizcoReach"

    def log_message(self, fmt, *args):  # keep the log quiet
        pass

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in HOSTS

    def _reply(self, code: int, payload, ctype: str = "application/json; charset=utf-8") -> None:
        data = payload if isinstance(payload, bytes) else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if ctype.startswith("text/html"):
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                             "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self) -> bool:
        return secrets.compare_digest(self.headers.get("X-Rizco-Token") or "", _State.token)

    def do_GET(self):
        if not self._host_ok():
            return self._reply(403, {"error": "forbidden"})
        url = urlsplit(self.path)
        if url.path == "/health":
            return self._reply(200, {"ok": True, "app": "rizcoreach"})
        if url.path == "/":
            page = (Path(__file__).with_name("dashboard.html")).read_text(encoding="utf-8")
            return self._reply(200, page.replace("__TOKEN__", _State.token).encode(), "text/html; charset=utf-8")
        if not url.path.startswith("/api/") or not self._authorised():
            return self._reply(403, {"error": "forbidden"})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            con, s = db.connect(), settings()
            if url.path == "/api/overview":
                return self._reply(200, overview(con, s))
            if url.path == "/api/waiting":
                return self._reply(200, waiting(con, s))
            if url.path == "/api/leads":
                return self._reply(200, leads(con, q.get("status", ""), q.get("q", "").strip(), int(q.get("offset", 0) or 0)))
            if url.path == "/api/activity":
                return self._reply(200, activity(con))
            if url.path == "/api/preview":
                return self._reply(200, preview(con, s, q.get("campaign", "")))
            if url.path == "/api/report":
                return self._reply(200, {"text": report.write(con, s).read_text(encoding="utf-8")})
            if url.path == "/api/portfolio":
                return self._reply(200, portfolio.listing())
            if url.path == "/api/job":
                job = _State.jobs.get(q.get("id", ""))
                return self._reply(200 if job else 404, job or {"error": "unknown job"})
        except Exception as e:  # noqa: BLE001
            return self._reply(500, {"error": str(e)})
        return self._reply(404, {"error": "not found"})

    def do_POST(self):
        if not self._host_ok() or not self._authorised():
            return self._reply(403, {"error": "forbidden"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            return self._reply(413, {"ok": False, "message": "That file is too big (25 MB at most)."})
        raw = self.rfile.read(length) if length else b""
        path = urlsplit(self.path).path
        body = {}
        if path not in ("/api/upload", "/api/portfolio") and raw:
            try:
                body = json.loads(raw.decode("utf-8"))
            except ValueError:
                return self._reply(400, {"ok": False, "message": "bad request"})
        try:
            return self._reply(200, post(path, body, raw, self.headers))
        except KeyError:
            return self._reply(404, {"error": "not found"})
        except ValueError as e:
            return self._reply(400, {"ok": False, "message": str(e)})
        except Exception as e:  # noqa: BLE001
            return self._reply(500, {"ok": False, "message": str(e)})


def running(port: int = PORT) -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=2) as r:
            return b"rizcoreach" in r.read()
    except Exception:  # noqa: BLE001
        return False


def make_server(port: int = PORT) -> ThreadingHTTPServer:
    _State.token = secrets.token_urlsafe(24)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def serve(port: int = PORT) -> None:
    server = make_server(port)
    print("[%s] Dashboard running at http://localhost:%d/" % (clock.now().strftime("%H:%M:%S"), port), flush=True)
    server.serve_forever()


def desktop_shortcut() -> Optional[Path]:
    """A "RizcoReach Dashboard" icon on the Desktop that opens the page."""
    path = Path.home() / "Desktop" / "RizcoReach Dashboard.webloc"
    if path.exists():
        return path
    try:
        path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
                        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key>'
                        '<string>%s</string></dict></plist>\n' % URL, encoding="utf-8")
        return path
    except OSError:
        return None


def open_dashboard() -> int:
    """rizco dashboard: opens the page (and starts it here if the background job isn't running)."""
    shortcut = desktop_shortcut() if launchd.IS_MAC else None
    if running():
        print("Opening %s" % URL)
        if shortcut:
            print("There's a RizcoReach Dashboard icon on your Desktop for next time.")
        webbrowser.open(URL)
        return 0
    print("Starting the dashboard at %s (keep this window open, or run setup again to run it in the background)." % URL)
    threading.Timer(1.0, lambda: webbrowser.open(URL)).start()
    try:
        serve()
    except KeyboardInterrupt:
        pass
    return 0
