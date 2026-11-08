"""rizco report: writes reports/YYYY-MM-DD.md. Interested people first, then the numbers.

Fridays (or with --weekly) it adds a weekly review in plain words.
"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Dict, List, Optional

from . import clock, config, db, names, safety, schedule, templates
from .classify import LABELS
from .config import Settings

SEGMENT_NAMES = {"A": "A new business", "B": "B no website", "C": "C outdated website", "SKIP": "Skip"}
HUMAN = ("interested", "question", "not_now", "opt_out", "other")


def pct(a: int, b: int) -> str:
    return "%.1f%%" % (100.0 * a / b) if b else "n/a"


def wa_link(phone: str) -> str:
    digits = names.format_whatsapp(phone).replace("+", "").replace(" ", "")
    return "https://wa.me/%s" % digits if len(digits) >= 9 else ""


def _rows(con, sql, *args):
    return con.execute(sql, args).fetchall()


def segment_stats(con) -> List[Dict]:
    out = []
    for seg in ("A", "B", "C"):
        r = con.execute(
            "SELECT COUNT(*) AS emailed, SUM(reply_class IN %s) AS replied, "
            "SUM(reply_class='interested' OR outcome='client') AS interested, SUM(outcome='client') AS clients, "
            "SUM(status='bounced') AS bounced FROM leads WHERE first_sent_at IS NOT NULL AND segment=?" % (HUMAN,),
            (seg,),
        ).fetchone()
        out.append({"segment": seg, **{k: (r[k] or 0) for k in r.keys()}})
    return out


def variant_stats(con) -> List[Dict]:
    out = []
    for seg in ("A", "B", "C"):
        for var in ("A", "B"):
            r = con.execute(
                "SELECT COUNT(*) AS sent, SUM(reply_class IN %s) AS replied, "
                "SUM(reply_class='interested' OR outcome='client') AS interested "
                "FROM leads WHERE first_sent_at IS NOT NULL AND segment=? AND variant=?" % (HUMAN,),
                (seg, var),
            ).fetchone()
            out.append({"segment": seg, "variant": var, "sent": r["sent"] or 0, "replied": r["replied"] or 0,
                        "interested": r["interested"] or 0})
    return out


def reply_step(con, lead) -> Optional[int]:
    """Which email they answered: 0 first email, 1 or 2 a follow up."""
    if not lead["replied_at"]:
        return None
    r = con.execute(
        "SELECT MAX(step) AS s FROM messages WHERE lead_id=? AND kind='campaign' AND sent_at<=?",
        (lead["id"], lead["replied_at"]),
    ).fetchone()
    return r["s"]


def _reply_block(con, lead, settings: Settings) -> List[str]:
    inbound = con.execute(
        "SELECT * FROM inbound WHERE lead_id=? AND is_auto=0 AND classification!='bounce' ORDER BY received_at DESC LIMIT 1",
        (lead["id"],),
    ).fetchone()
    lines = ["### %s" % lead["business"], ""]
    lines.append("- Email: %s" % lead["email"])
    if lead["phone"]:
        link = wa_link(lead["phone"])
        lines.append("- Phone: %s%s" % (lead["phone"], "  (WhatsApp: %s)" % link if link else ""))
    if lead["instagram"]:
        lines.append("- Instagram: https://www.instagram.com/%s/" % lead["instagram"])
    lines.append("- Segment: %s, version %s%s" % (SEGMENT_NAMES.get(lead["segment"], lead["segment"]), lead["variant"] or "?",
                                                   ", %s" % lead["area"] if lead["area"] else ""))
    if inbound:
        when = clock.parse(inbound["received_at"])
        lines.append("- They wrote on %s at %s:" % (clock.nice(when.date()), when.strftime("%H:%M")))
        lines.append("")
        for l in (inbound["body"] or "(no text)").strip().splitlines()[:15]:
            lines.append("  > " + l)
        if inbound["draft"]:
            where = "saved in your Drafts folder, check it and press Send" if inbound["draft_saved"] else "copy it into your reply"
            lines += ["", "  Drafted reply (%s):" % where, "", "  ```"] + ["  " + l for l in inbound["draft"].splitlines()] + ["  ```"]
            if "[" in inbound["draft"]:
                lines.append("  Fill in the [brackets] before you send it.")
    lines.append("")
    return lines


def build(con, settings: Settings, weekly: Optional[bool] = None) -> str:
    today = clock.today()
    t = today.isoformat()
    monday = clock.week_start(today).isoformat()
    weekly = today.weekday() == 4 if weekly is None else weekly
    L: List[str] = ["# Outreach report: %s %d" % (clock.nice(today), today.year), ""]

    p = safety.paused(con)
    if p:
        L += ["> **Sending is PAUSED** since %s: %s" % (p["at"][:16].replace("T", " "), p["reason"]),
              "> " + (p.get("detail") or ""), "> When you have looked into it run `rizco resume`.", ""]

    # 1. People waiting on you
    waiting = _rows(con, "SELECT * FROM leads WHERE waiting_on_me=1 ORDER BY replied_at")
    groups = [("interested", "Interested: reply to these first"), ("question", "Questions waiting for your answer"),
              ("other", "Other replies waiting on you")]
    if not waiting:
        L += ["## Interested", "", "Nobody is waiting for a reply from you right now.", ""]
    for cls, title in groups:
        leads = [l for l in waiting if l["reply_class"] == cls]
        if leads:
            L += ["## %s (%d)" % (title, len(leads)), ""]
            for lead in leads:
                L += _reply_block(con, lead, settings)
    if waiting:
        L += ["When you have answered someone (email or WhatsApp) the next `replies` run notices if you emailed them. "
              "If you answered on WhatsApp run `rizco mark their@email.com handled`. "
              "When someone becomes a client run `rizco mark their@email.com client`.", ""]

    # 2. Today and this week per inbox
    L += ["## Sent", "", "| Inbox | Today | Today's limit | This week |", "|---|---|---|---|"]
    for inbox in settings.inboxes:
        lim = schedule.limits(con, inbox, today)
        week = con.execute(
            "SELECT COUNT(*) FROM messages WHERE inbox=? AND sent_date>=? AND status IN ('sent','bounced')",
            (inbox.key, monday)).fetchone()[0]
        L.append("| %s | %d | %d (week %d of warm up) | %d |" % (inbox.email, lim["sent"], lim["cap"], lim["week"], week))
    L.append("")

    def replies_since(day: str) -> Dict[str, int]:
        counts = {k: 0 for k in HUMAN}
        for r in _rows(con, "SELECT classification, COUNT(*) AS n FROM inbound WHERE is_auto=0 AND classification!='bounce' "
                            "AND substr(received_at, 1, 10)>=? GROUP BY classification", day):
            counts[r["classification"]] = r["n"]
        return counts

    def bounces_since(day: str) -> int:
        return con.execute("SELECT COUNT(*) FROM inbound WHERE classification='bounce' AND substr(received_at,1,10)>=?", (day,)).fetchone()[0] \
            + con.execute("SELECT COUNT(*) FROM messages WHERE status='bounced' AND error LIKE 'address refused%' AND sent_date>=?", (day,)).fetchone()[0]

    L += ["## Replies", "", "| | Today | This week |", "|---|---|---|"]
    rt, rw = replies_since(t), replies_since(monday)
    L.append("| Replies | %d | %d |" % (sum(rt.values()), sum(rw.values())))
    for k in HUMAN:
        L.append("| &nbsp;&nbsp;%s | %d | %d |" % (LABELS[k], rt[k], rw[k]))
    ooo_t = con.execute("SELECT COUNT(*) FROM inbound WHERE classification='out_of_office' AND substr(received_at,1,10)>=?", (t,)).fetchone()[0]
    ooo_w = con.execute("SELECT COUNT(*) FROM inbound WHERE classification='out_of_office' AND substr(received_at,1,10)>=?", (monday,)).fetchone()[0]
    L.append("| Out of office (sequence keeps going) | %d | %d |" % (ooo_t, ooo_w))
    L.append("| Bounces | %d | %d |" % (bounces_since(t), bounces_since(monday)))
    last_day = con.execute("SELECT MAX(sent_date) FROM messages WHERE kind='campaign'").fetchone()[0]
    if last_day:
        b, n, r = safety.bounce_rate(con, last_day)
        L += ["", "Bounce rate for %s: %d of %d (%s). The limit is 3%%." % (last_day, b, n, pct(b, n))]
    L.append("")

    # 3. Reply rates
    L += ["## Reply rate by segment (all time)", "",
          "| Segment | Emailed | Replied | Reply rate | Interested | Clients |", "|---|---|---|---|---|---|"]
    for r in segment_stats(con):
        L.append("| %s | %d | %d | %s | %d | %d |" % (SEGMENT_NAMES[r["segment"]], r["emailed"], r["replied"],
                                                       pct(r["replied"], r["emailed"]), r["interested"], r["clients"]))
    L += ["", "## Reply rate by version (A shows the 480 AED price, B does not)", "",
          "| Segment | Version | Sent | Replied | Reply rate | Interested |", "|---|---|---|---|---|---|"]
    vs = variant_stats(con)
    for r in vs:
        L.append("| %s | %s | %d | %d | %s | %d |" % (SEGMENT_NAMES[r["segment"]], r["variant"], r["sent"], r["replied"],
                                                       pct(r["replied"], r["sent"]), r["interested"]))
    L.append("")
    L += ab_suggestions(vs)

    # 4. Funnel
    f = con.execute(
        "SELECT COUNT(*) AS emailed, SUM(reply_class IN %s) AS replied, SUM(reply_class='interested' OR outcome='client') AS interested, "
        "SUM(outcome='client') AS clients FROM leads WHERE first_sent_at IS NOT NULL" % (HUMAN,)).fetchone()
    L += ["## Funnel (all time)", "",
          "Emailed %d > replied %d (%s) > interested %d (%s) > clients %d" % (
              f["emailed"] or 0, f["replied"] or 0, pct(f["replied"] or 0, f["emailed"] or 0), f["interested"] or 0,
              pct(f["interested"] or 0, f["emailed"] or 0), f["clients"] or 0), ""]

    # 5. Not now, bounces, opt outs
    later = _rows(con, "SELECT * FROM leads WHERE reply_class='not_now' AND outcome IS NULL ORDER BY replied_at DESC LIMIT 30")
    if later:
        L += ["## Said not now (worth a message in a month or two)", ""]
        L += ["- %s, %s, replied %s" % (l["business"], l["email"], (l["replied_at"] or "")[:10]) for l in later]
        L.append("")
    gone = _rows(con, "SELECT * FROM leads WHERE status IN ('bounced','opted_out') AND substr(COALESCE(replied_at, last_sent_at),1,10)>=? "
                      "ORDER BY status", monday)
    if gone:
        L += ["## Bounces and opt outs this week (all on the suppression list)", ""]
        L += ["- %s: %s (%s)" % (l["status"].replace("_", " "), l["email"], l["stop_reason"] or "") for l in gone]
        L.append("")

    # 6. Queue
    q = {r["segment"]: r["n"] for r in _rows(con, "SELECT segment, COUNT(*) AS n FROM leads WHERE status='queued' GROUP BY segment")}
    active = con.execute("SELECT COUNT(*) FROM leads WHERE status='active'").fetchone()[0]
    nxt = clock.next_weekday(today + timedelta(days=1))
    due = con.execute("SELECT COUNT(*) FROM leads WHERE status='active' AND next_due<=?", (nxt.isoformat(),)).fetchone()[0]
    L += ["## Queue", "",
          "- New leads waiting: %d (A %d, B %d, C %d)" % (sum(q.values()), q.get("A", 0), q.get("B", 0), q.get("C", 0)),
          "- In a sequence: %d (%d follow ups due by %s)" % (active, due, clock.nice(nxt)), ""]
    blocked = _rows(con, "SELECT * FROM leads WHERE status='blocked' ORDER BY id DESC LIMIT 20")
    if blocked:
        L += ["Not sent because the email failed a check (fix the lead data, then run `rizco mark <email> requeue`):", ""]
        L += ["- %s: %s" % (l["email"], l["stop_reason"]) for l in blocked]
        L.append("")

    if weekly:
        L += weekly_review(con, settings)
    return "\n".join(L).rstrip() + "\n"


def ab_suggestions(vs: List[Dict]) -> List[str]:
    out: List[str] = []
    for seg in ("A", "B", "C"):
        a = next(r for r in vs if r["segment"] == seg and r["variant"] == "A")
        b = next(r for r in vs if r["segment"] == seg and r["variant"] == "B")
        if a["sent"] >= 100 and b["sent"] >= 100:
            ra, rb = a["replied"] / a["sent"], b["replied"] / b["sent"]
            if abs(ra - rb) < 0.01:
                verdict = "Both versions of segment %s reply about the same (%s vs %s). The price line makes no difference, keep A (it filters out people who would never pay 480 AED)." % (seg, pct(a["replied"], a["sent"]), pct(b["replied"], b["sent"]))
                loser = "B"
            else:
                win, lose = ("A", "B") if ra > rb else ("B", "A")
                verdict = "Segment %s: version %s wins (%s replies vs %s, on %d and %d sends). Keep %s and replace %s with a new idea:" % (
                    seg, win, pct(a["replied"] if win == "A" else b["replied"], a["sent"] if win == "A" else b["sent"]),
                    pct(b["replied"] if win == "A" else a["replied"], b["sent"] if win == "A" else a["sent"]), a["sent"], b["sent"], win, lose)
                loser = lose
            out += ["### Time for a new test in segment %s" % seg, "", verdict, ""]
            out += ["- " + idea for idea in templates.NEXT_VARIANT_IDEAS[seg]]
            out += ["", "To change version %s, edit FIRST_EMAIL[(\"%s\", \"%s\")] in outreach/templates.py (or ask Claude to)." % (loser, seg, loser), ""]
    return out


def weekly_review(con, settings: Settings) -> List[str]:
    """What's working, what isn't, what to change. Plain words, honest about small numbers."""
    today = clock.today()
    since = (today - timedelta(days=7)).isoformat()
    L = ["## Weekly review", ""]
    sent_week = con.execute("SELECT COUNT(*) FROM messages WHERE kind='campaign' AND status IN ('sent','bounced') AND sent_date>=?", (since,)).fetchone()[0]
    firsts = con.execute("SELECT COUNT(*) FROM messages WHERE kind='campaign' AND step=0 AND status IN ('sent','bounced') AND sent_date>=?", (since,)).fetchone()[0]
    replies = _rows(con, "SELECT * FROM leads WHERE reply_class IN %s AND substr(replied_at,1,10)>=?" % (HUMAN,), since)
    interested = [l for l in replies if l["reply_class"] == "interested"]
    L.append("- This week: %d emails sent (%d first emails), %d replies, %d interested." % (sent_week, firsts, len(replies), len(interested)))

    segs = [r for r in segment_stats(con) if r["emailed"]]
    total = sum(r["emailed"] for r in segs)
    if total < 30:
        L.append("- Too early to judge: only %d leads emailed so far. Patterns start to mean something after about 100 per segment. Keep going." % total)
    if len(segs) >= 2:
        best = max(segs, key=lambda r: r["replied"] / r["emailed"])
        worst = min(segs, key=lambda r: r["replied"] / r["emailed"])
        if best["segment"] != worst["segment"] and best["emailed"] >= 20 and worst["emailed"] >= 20:
            L.append("- Working best: %s (%s reply rate on %d leads). Weakest: %s (%s on %d). Put more of your lead hunting into %s."
                     % (SEGMENT_NAMES[best["segment"]], pct(best["replied"], best["emailed"]), best["emailed"],
                        SEGMENT_NAMES[worst["segment"]], pct(worst["replied"], worst["emailed"]), worst["emailed"],
                        SEGMENT_NAMES[best["segment"]].split(" ", 1)[1]))
    for seg in segs:
        if seg["emailed"] >= 40 and seg["replied"] == 0:
            L.append("- %s has %d emails and no replies. Change something there: the first line or the question." % (SEGMENT_NAMES[seg["segment"]], seg["emailed"]))

    vs = variant_stats(con)
    a = sum(r["sent"] for r in vs if r["variant"] == "A"), sum(r["replied"] for r in vs if r["variant"] == "A")
    b = sum(r["sent"] for r in vs if r["variant"] == "B"), sum(r["replied"] for r in vs if r["variant"] == "B")
    if a[0] >= 30 and b[0] >= 30:
        L.append("- Price or no price: with the price %s reply (%d sent), without it %s (%d sent).%s"
                 % (pct(a[1], a[0]), a[0], pct(b[1], b[0]), b[0],
                    "" if min(a[0], b[0]) >= 100 else " Not enough sends to be sure yet (aim for 100 each)."))

    all_replied = _rows(con, "SELECT * FROM leads WHERE reply_class IN %s" % (HUMAN,))
    steps = [reply_step(con, l) for l in all_replied]
    after_fu = sum(1 for s in steps if s and s > 0)
    if len(steps) >= 5:
        L.append("- Follow ups: %d of %d replies (%s) came after a follow up.%s" % (
            after_fu, len(steps), pct(after_fu, len(steps)),
            " Keep them." if after_fu else " So far the first email does the work. Keep the follow ups anyway, they are cheap."))

    b_week = con.execute("SELECT COUNT(*) FROM messages WHERE kind='campaign' AND status='bounced' AND sent_date>=?", (since,)).fetchone()[0]
    if sent_week:
        rate = b_week / sent_week
        if rate > 0.03:
            L.append("- Bounces: %s this week, too high. Lists are the problem, not the copy. Prefer emails you saw on their own website or Google listing." % pct(b_week, sent_week))
        else:
            L.append("- Bounces: %s this week. Fine." % pct(b_week, sent_week))
    opt = sum(1 for l in replies if l["reply_class"] == "opt_out")
    if replies and opt / len(replies) > 0.5 and len(replies) >= 6:
        L.append("- Most replies this week were no. That's normal in cold email, but if it keeps up look at who you're emailing: smaller owner run businesses say yes more often than chains.")

    clients = con.execute("SELECT COUNT(*) FROM leads WHERE outcome='client'").fetchone()[0]
    inter_all = con.execute("SELECT COUNT(*) FROM leads WHERE reply_class='interested' OR outcome='client'").fetchone()[0]
    if inter_all >= 4 and clients == 0:
        L.append("- %d interested replies and no clients yet. The drop is after the reply: answer within an hour, send examples, then move to WhatsApp and offer the free preview." % inter_all)
    slow = con.execute("SELECT COUNT(*) FROM leads WHERE waiting_on_me=1 AND replied_at<?", (clock.iso(clock.now() - timedelta(days=1)),)).fetchone()[0]
    if slow:
        L.append("- %d people have waited more than a day for your reply. Those go cold fast." % slow)
    L.append("- Subject lines: every email uses \"{business} website\". Once you have 200 or more sends, a good next test is \"website for {business}\" in one version.")
    L.append("")
    return L


def write(con, settings: Settings, weekly: Optional[bool] = None) -> Path:
    folder = config.reports_dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / ("%s.md" % clock.today().isoformat())
    path.write_text(build(con, settings, weekly), encoding="utf-8")
    return path
