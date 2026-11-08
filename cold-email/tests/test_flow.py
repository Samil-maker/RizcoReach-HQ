"""The whole flow with a fake clock and a fake mail server: import, warm up limits, send days,
follow ups, replies, bounces, pauses and the report."""
import csv
from datetime import datetime, timedelta

from conftest import ENV, MODERN_SITE, OLD_SITE
from outreach import clock, config, db, importer, replies, report, safety, schedule, sender, suppression


def write_csv(project, name, rows, header):
    path = project / "leads" / "inbox" / name
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return path


HEADER = ["Company Name", "Contact", "E-mail", "Website", "Instagram", "Mobile", "Category", "Location", "Found on", "Notes"]


def sample_rows():
    return [
        ["Bloom Bakery", "Sara Ali", " Hello@BloomBakery.ae ", "", "@bloombakery", "0501112233", "bakery", "Al Barsha", "Instagram", "grand opening last week"],
        ["Glossy PPF L.L.C", "", "info@glossyppf.ae", "", "", "", "car detailing", "Al Quoz", "Google Maps", ""],
        ["Al Noor Tailoring", "", "info@alnoor.ae", "alnoor.ae", "", "", "tailor", "Karama", "Google Maps", ""],
        ["Glow Studio", "", "hi@glow.ae", "https://glow.ae", "", "", "salon", "JLT", "", ""],
        ["Dup Bakery", "", "sales@bloombakery.ae", "", "", "", "", "", "", ""],         # same company domain
        ["Repeat", "", "hello@bloombakery.ae", "", "", "", "", "", "", ""],            # same email
        ["No Mail", "", "not-an-email", "", "", "", "", "", "", ""],
        ["Ghost Co", "", "info@nomx-ghost.ae", "", "", "", "", "", "", ""],
        ["Placeholder", "", "filler@godaddy.com", "", "", "", "", "", "", ""],
        ["", "", "who@nobody.ae", "", "", "", "", "", "", ""],
        ["Stopped Spa", "", "owner@stopped.ae", "", "", "", "", "", "", ""],
    ]


def import_sample(project, con, fake_web):
    fake_web["alnoor.ae"] = ("http_only", OLD_SITE)
    fake_web["glow.ae"] = ("ok", MODERN_SITE)
    suppression.add(con, "owner@stopped.ae", "said no")
    write_csv(project, "leads.csv", sample_rows(), HEADER)
    files = importer.pending_files()
    assert [p.name for p in files] == ["leads.csv"]
    return importer.import_file(con, files[0], log=lambda *a: None)


def test_import_cleans_dedupes_and_segments(project, con, fake_web, fake_clock):
    result = import_sample(project, con, fake_web)
    s = result["stats"]
    assert s["imported"] == 4 and s["duplicate"] == 2 and s["suppressed"] == 1 and s["invalid"] == 4
    by = {r["email"]: r for r in con.execute("SELECT * FROM leads")}
    assert set(by) == {"hello@bloombakery.ae", "info@glossyppf.ae", "info@alnoor.ae", "hi@glow.ae"}
    assert by["hello@bloombakery.ae"]["segment"] == "A" and by["hello@bloombakery.ae"]["first_name"] == "Sara"
    assert by["info@glossyppf.ae"]["segment"] == "B" and by["info@glossyppf.ae"]["business"] == "Glossy PPF"
    assert by["info@alnoor.ae"]["segment"] == "C" and by["info@alnoor.ae"]["observation"] == "It's quite hard to use on a phone"
    assert by["hi@glow.ae"]["segment"] == "SKIP" and by["hi@glow.ae"]["status"] == "skipped"
    processed = sorted(p.name for p in (project / "leads" / "processed").iterdir())
    assert any(n.endswith("_leads.csv") for n in processed) and any(n.endswith(".rejected.csv") for n in processed)
    assert not list((project / "leads" / "inbox").iterdir())
    # importing the same people again finds only duplicates
    write_csv(project, "again.csv", sample_rows()[:4], HEADER)
    again = importer.import_file(con, importer.pending_files()[0], log=lambda *a: None)
    assert again["stats"]["imported"] == 0 and again["stats"]["duplicate"] == 4


def test_xlsx_and_missing_columns(project, con, fake_web):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Business", "Email Address", "Phone"])
    ws.append(["Sky Cafe", "hello@skycafe.ae", 971501234567])
    path = project / "leads" / "inbox" / "list.xlsx"
    wb.save(path)
    r = importer.import_file(con, path, log=lambda *a: None)
    assert r["stats"]["imported"] == 1
    assert db.lead_by_email(con, "hello@skycafe.ae")["phone"] == "971501234567"
    write_csv(project, "bad.csv", [["x", "y"]], ["Shop", "Contact"])
    try:
        importer.import_file(con, project / "leads" / "inbox" / "bad.csv", log=lambda *a: None)
        assert False, "should ask for the email column"
    except ValueError as e:
        assert "--map email=" in str(e)


def test_warm_up_limits(project, con, settings):
    inbox = settings.inboxes[0]
    assert inbox.is_free
    day = datetime(2026, 11, 9).date()
    assert schedule.limits(con, inbox, day)["cap"] == 5
    con.execute("INSERT INTO messages(inbox, kind, step, status, sent_date, to_email) VALUES('inbox1','campaign',0,'sent','2026-10-01','x@y.ae')")
    assert schedule.week_number(con, "inbox1", day) == 6
    assert schedule.limits(con, inbox, day)["cap"] == 20  # 30 in week 5+, but a free gmail never goes over 20
    workspace = config.load_settings(dict(ENV, INBOX1_EMAIL="samil@rizcoreach-mail.com", INBOX1_PROVIDER="workspace"))
    assert schedule.limits(con, workspace.inboxes[0], day)["cap"] == 30
    asks_more = config.load_settings(dict(ENV, INBOX1_DAILY_CAP="200")).inboxes[0]
    lim = schedule.limits(con, asks_more, datetime(2026, 10, 2).date())
    assert lim["cap"] == 5 and "warm up limit wins" in lim["why"]


def run_day(con, settings, fake_clock, when):
    fake_clock.set(when)
    return sender.SendRun(con, settings).run()


def approve(con):
    db.set_state(con, "approved", {"at": clock.iso()})


def add_leads(con, n, segment="B"):
    for i in range(n):
        con.execute(
            "INSERT INTO leads(email, business_name, business, segment, status, next_step, next_due, imported_at, mx_status, source)"
            " VALUES(?,?,?,?, 'queued', 0, '2026-11-01', ?, 'ok', 'Google Maps')",
            ("owner%d@shop%d.ae" % (i, i), "Shop %d" % i, "Shop %d" % i, segment, "2026-11-01T10:00:%02d+04:00" % i),
        )


def test_send_day_respects_limits_windows_and_gaps(project, con, settings, smtp, dns_pass, fake_clock, no_network_mail):
    add_leads(con, 12)
    sent = run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert sent == 0, "nothing is sent before approval"
    approve(con)
    sent = run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert sent == 5 and len(smtp.outbox) == 5  # week 1
    assert len(no_network_mail) >= 2  # replies were checked before sending and at the end of the day
    times = [clock.parse(r["sent_at"]) for r in con.execute("SELECT sent_at FROM messages ORDER BY id")]
    assert all(clock.at(times[0].date(), 9) <= t <= clock.at(times[0].date(), 17, 46) for t in times)
    gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
    assert all(g >= 180 for g in gaps), gaps
    assert (times[-1] - times[0]).total_seconds() > 4 * 3600  # spread over the day, not a morning burst
    m = smtp.outbox[0]
    assert m["From"] == "Samil <samilatrizcoreach@gmail.com>" and m["Subject"] == "Shop 0 website"
    assert m.get_content_type() == "text/plain" and not m.is_multipart()
    body = m.get_content()
    assert "http" not in body and body.rstrip().endswith("Just reply no and I won't email again")
    # a second run the same day sends nothing more
    assert run_day(con, settings, fake_clock, datetime(2026, 11, 9, 10, 30, tzinfo=clock.TZ)) == 0
    # weekends: nothing
    assert run_day(con, settings, fake_clock, datetime(2026, 11, 14, 9, 0, tzinfo=clock.TZ)) == 0
    # after the windows: nothing
    assert run_day(con, settings, fake_clock, datetime(2026, 11, 10, 18, 30, tzinfo=clock.TZ)) == 0
    variants = [r[0] for r in con.execute("SELECT variant FROM messages WHERE step=0")]
    assert abs(variants.count("A") - variants.count("B")) <= 1


def test_follow_ups_go_first_and_thread(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 5)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))   # Mon: 5 first emails
    add_leads_more = [("late%d@later%d.ae" % (i, i)) for i in range(5)]
    for i, e in enumerate(add_leads_more):
        con.execute("INSERT INTO leads(email, business, segment, status, next_step, imported_at, mx_status) "
                    "VALUES(?, ?, 'B', 'queued', 0, '2026-11-02', 'ok')", (e, "Later %d" % i))
    smtp.outbox.clear()
    run_day(con, settings, fake_clock, datetime(2026, 11, 12, 9, 0, tzinfo=clock.TZ))  # Thu, day 3: follow ups due
    subjects = [m["Subject"] for m in smtp.outbox]
    assert len(subjects) == 5 and all(s.startswith("Re: Shop") for s in subjects), subjects  # follow ups use the whole limit
    fu = smtp.outbox[0]
    first = con.execute("SELECT message_id FROM messages WHERE step=0 AND to_email=?", (fu["To"],)).fetchone()[0]
    assert fu["In-Reply-To"] == first and first in fu["References"]
    text = fu.get_content()
    assert "just bringing this back up" in text and "wrote:\n\n> Hi there" in text
    lead = db.lead_by_email(con, fu["To"])
    assert lead["next_step"] == 2 and lead["next_due"] == "2026-11-16"   # day 7 is Monday the 16th
    smtp.outbox.clear()
    run_day(con, settings, fake_clock, datetime(2026, 11, 16, 9, 0, tzinfo=clock.TZ))  # day 7: follow up 2
    texts = [m.get_content() for m in smtp.outbox if m["Subject"].startswith("Re:")]
    assert texts and all("Last one from me" in t for t in texts)
    assert con.execute("SELECT COUNT(*) FROM leads WHERE status='done'").fetchone()[0] == len(texts)


REPLY = """From: Shop Owner <owner0@shop0.ae>
To: samilatrizcoreach@gmail.com
Subject: Re: Shop 0 website
Message-ID: <reply1@shop0.ae>
In-Reply-To: {mid}
Date: Tue, 10 Nov 2026 10:00:00 +0400
Content-Type: text/plain

Yes please send me some examples

On Mon, 9 Nov 2026 at 09:01, Samil <samilatrizcoreach@gmail.com> wrote:
> Hi there
"""


def test_reply_stops_sequence_and_drafts(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 2)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages WHERE to_email='owner0@shop0.ae'").fetchone()[0]
    fake_clock.set(datetime(2026, 11, 10, 11, 0, tzinfo=clock.TZ))
    info = replies.process(con, settings, settings.inboxes[0], REPLY.format(mid=mid).encode())
    assert info["label"] == "interested" and "Here are some sites I've built" in info["draft"]
    lead = db.lead_by_email(con, "owner0@shop0.ae")
    assert lead["status"] == "replied" and lead["waiting_on_me"] == 1 and lead["next_due"] is None
    assert replies.process(con, settings, settings.inboxes[0], REPLY.format(mid=mid).encode()) is None  # once only
    smtp.outbox.clear()
    run_day(con, settings, fake_clock, datetime(2026, 11, 12, 9, 0, tzinfo=clock.TZ))
    assert [m["To"] for m in smtp.outbox] == ["owner1@shop1.ae"]  # no follow up for the one who replied
    text = report.build(con, settings)
    top = text.index("## Interested: reply to these first")
    assert top < text.index("## Sent") and "owner0@shop0.ae" in text and "Here are some sites I've built" in text


def test_out_of_office_pushes_the_next_email(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 1)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages").fetchone()[0]
    ooo = REPLY.format(mid=mid).replace("Yes please send me some examples", "I am on annual leave until 20 November 2026.") \
        .replace("Subject: Re: Shop 0 website", "Subject: Out of Office: Shop 0 website\nAuto-Submitted: auto-replied")
    info = replies.process(con, settings, settings.inboxes[0], ooo.encode())
    assert info["label"] == "out_of_office" and info["pushed_to"] == "2026-11-21"
    lead = db.lead_by_email(con, "owner0@shop0.ae")
    assert lead["status"] == "active" and lead["next_due"] == "2026-11-21"


def test_bounce_over_3_percent_pauses(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 5)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    from test_checks import BOUNCE

    mid = con.execute("SELECT message_id FROM messages WHERE to_email='owner2@shop2.ae'").fetchone()[0]
    raw = BOUNCE.replace("gone@oldsalon.ae", "owner2@shop2.ae").replace("<abc123@gmail.com>", mid)
    info = replies.process(con, settings, settings.inboxes[0], raw.encode())
    assert info["label"] == "bounce (hard)"
    assert db.lead_by_email(con, "owner2@shop2.ae")["status"] == "bounced"
    assert "owner2@shop2.ae" in suppression.load()
    p = safety.paused(con)
    assert p and "1 of 5" in p["reason"]
    assert run_day(con, settings, fake_clock, datetime(2026, 11, 10, 9, 0, tzinfo=clock.TZ)) == 0
    safety.resume(con)
    assert not safety.paused(con)


def test_spam_complaint_pauses_and_suppresses(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 1)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages").fetchone()[0]
    raw = REPLY.format(mid=mid).replace("Yes please send me some examples", "Stop spamming me or I will report you")
    info = replies.process(con, settings, settings.inboxes[0], raw.encode())
    assert info["label"] == "opt_out"
    assert safety.paused(con) and "owner0@shop0.ae" in suppression.load()


def test_smtp_rejection_pauses(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 3)
    smtp.fail_data = (550, b"5.4.5 Daily user sending limit exceeded")
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert len(smtp.outbox) == 0 and "refused" in safety.paused(con)["reason"]


def test_refused_address_is_a_bounce(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 3)
    smtp.refuse["owner0@shop0.ae"] = (550, b"5.1.1 The email account that you tried to reach does not exist")
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert db.lead_by_email(con, "owner0@shop0.ae")["status"] == "bounced"
    assert safety.paused(con)  # 1 of 1 sent that day bounced: over 3%


def test_two_inboxes_share_leads(project, con, smtp, dns_pass, fake_clock):
    (project / ".env").write_text("# test\n")
    env = dict(ENV, INBOX2_EMAIL="samil@rizcoreach-mail.com", INBOX2_PROVIDER="workspace", INBOX2_APP_PASSWORD="abcdefghijklmnop")
    s = config.load_settings(env)
    approve(con)
    add_leads(con, 20)
    run_day(con, s, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    by_inbox = dict(con.execute("SELECT inbox, COUNT(*) FROM messages GROUP BY inbox").fetchall())
    assert by_inbox == {"inbox1": 5, "inbox2": 5}
    senders = [m["From"] for m in smtp.outbox]
    assert senders[0] != senders[1]  # they take turns


def test_dry_run_sends_nothing(project, con, settings, smtp, fake_clock, capsys):
    add_leads(con, 3)
    fake_clock.set(datetime(2026, 11, 8, 12, 0, tzinfo=clock.TZ))  # a Sunday
    sender.SendRun(con, settings, dry_run=True).run()
    out = capsys.readouterr().out
    assert "This is what Monday 9 November would send" in out and "Subject: Shop 0 website" in out
    assert smtp.outbox == [] and con.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0


def test_weekly_report(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 5)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    fake_clock.set(datetime(2026, 11, 13, 17, 0, tzinfo=clock.TZ))  # Friday
    path = report.write(con, settings)
    text = path.read_text()
    assert path.name == "2026-11-13.md" and "## Weekly review" in text and "Too early to judge" in text
    assert "| samilatrizcoreach@gmail.com |" in text


def test_fifty_a_day_across_three_inboxes_all_go_out_by_6pm(project, con, smtp, dns_pass, fake_clock):
    (project / ".env").write_text("# test\n")
    env = dict(ENV, INBOX2_EMAIL="rizco.two@gmail.com", INBOX2_APP_PASSWORD="abcdefghijklmnop",
               INBOX3_EMAIL="rizco.three@gmail.com", INBOX3_APP_PASSWORD="abcdefghijklmnop")
    s = config.load_settings(env)
    for key in ("inbox1", "inbox2", "inbox3"):  # all three past their warm up: 20 a day each
        con.execute("INSERT INTO messages(inbox, kind, step, status, sent_date, to_email) VALUES(?, 'campaign', 0, 'sent', '2026-10-01', 'x@y.ae')", (key,))
    approve(con)
    add_leads(con, 70)
    sent = run_day(con, s, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert sent == 60
    rows = con.execute("SELECT inbox, sent_at FROM messages WHERE sent_date='2026-11-09' ORDER BY sent_at").fetchall()
    times = [clock.parse(r["sent_at"]) for r in rows]
    assert times[-1] <= clock.at(times[0].date(), 18) and times[0] >= clock.at(times[0].date(), 9)
    assert all((b - a).total_seconds() >= 60 for a, b in zip(times, times[1:]))  # never two at once
    busy = sum(1 for t in times if 10 <= t.hour < 12 or 13 <= t.hour < 15)
    assert busy > len(times) / 2  # most go out in the sweet spots
    by_inbox = {}
    for r in rows:
        by_inbox.setdefault(r["inbox"], []).append(clock.parse(r["sent_at"]))
    for key, ts in by_inbox.items():
        assert len(ts) == 20 and all((b - a).total_seconds() >= 180 for a, b in zip(ts, ts[1:])), key


def test_late_start_catches_up_without_bursts(project, con, settings, smtp, dns_pass, fake_clock):
    con.execute("INSERT INTO messages(inbox, kind, step, status, sent_date, to_email) VALUES('inbox1', 'campaign', 0, 'sent', '2026-10-01', 'x@y.ae')")
    approve(con)
    add_leads(con, 25)
    sent = run_day(con, settings, fake_clock, datetime(2026, 11, 9, 16, 30, tzinfo=clock.TZ))  # Mac woke at 16:30
    times = [clock.parse(r[0]) for r in con.execute("SELECT sent_at FROM messages WHERE sent_date='2026-11-09' ORDER BY sent_at")]
    assert 0 < sent < 20 and times[-1] < clock.at(times[0].date(), 18)
    assert all((b - a).total_seconds() >= 180 for a, b in zip(times, times[1:]))
    assert con.execute("SELECT COUNT(*) FROM leads WHERE status='queued'").fetchone()[0] == 25 - sent  # the rest wait


def test_warming_inbox_sends_no_cold_email_and_forecast(project, con, fake_clock):
    (project / ".env").write_text("# test\n")
    s = config.load_settings(dict(ENV, INBOX2_EMAIL="rizco.two@gmail.com", INBOX2_APP_PASSWORD="abcdefghijklmnop"))
    one, two = s.inboxes
    fake_clock.set(datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    db.set_state(con, "warmup_start:inbox2", "2026-11-09")
    assert schedule.limits(con, two, clock.today())["cap"] == 0
    assert "warming up, day 1 of 14" in schedule.limits(con, two, clock.today())["why"]
    assert schedule.cap_on(con, two, datetime(2026, 11, 23).date()) == 5    # first weekday after 14 days
    assert schedule.cap_on(con, one, datetime(2026, 11, 9).date()) == 5
    f = schedule.forecast(con, [one, two])
    assert f["today"] == 5 and f["full"] == 40 and f["reach"][100] == "needs 3 more inboxes"
    assert f["reach"][50] == "needs 1 more inbox"
    s3 = config.load_settings(dict(ENV, INBOX2_EMAIL="rizco.two@gmail.com", INBOX2_APP_PASSWORD="x",
                                   INBOX3_EMAIL="rizco.three@gmail.com", INBOX3_APP_PASSWORD="x"))
    db.set_state(con, "warmup_start:inbox3", "2026-11-09")
    f = schedule.forecast(con, s3.inboxes)
    assert f["reach"][50] == datetime(2026, 12, 7).date()   # inbox 1 at 20, inboxes 2 and 3 at 18 in week 3
    assert f["reach"][100] == "needs 2 more inboxes"
