"""Bad addresses never get in, typos get fixed, every lead gets six follow ups, "not now" comes back."""
from datetime import date, datetime

import pytest

from outreach import actions, clock, dashboard, db, emailcheck, importer, replies, safety, schedule, suppression, templates
from test_flow import REPLY, add_leads, approve, run_day, write_csv


@pytest.mark.parametrize("cell,email,fixed", [
    ("Info@CedarGrill.ae", "info@cedargrill.ae", ""),
    ("mailto:hello@shop.ae?subject=Hi", "hello@shop.ae", ""),
    (" <sales@shop.ae>. ", "sales@shop.ae", ""),
    ("info [at] shop [dot] ae", "info@shop.ae", ""),
    ("u003einfo@shop.ae", "info@shop.ae", ""),
    ("%20info@shop.ae", "info@shop.ae", ""),
    ("ali＠shop.ae", "ali@shop.ae", ""),
    ("ali​@shop.ae", "ali@shop.ae", ""),
    ("email: owner@salon.ae", "owner@salon.ae", ""),
    ("bad@, owner@salon.ae", "owner@salon.ae", ""),
    ("ali@gmial.com", "ali@gmail.com", "gmial.com to gmail.com"),
    ("ali@gamil.com", "ali@gmail.com", "gamil.com to gmail.com"),
    ("ali@gmail.co", "ali@gmail.com", "gmail.co to gmail.com"),
    ("ali@gmail..com", "ali@gmail.com", "gmail..com to gmail.com"),
    ("ali@gmail.com.com", "ali@gmail.com", "gmail.com.com to gmail.com"),
    ("sara@hotmial.com", "sara@hotmail.com", "hotmial.com to hotmail.com"),
    ("x@yahooo.com", "x@yahoo.com", "yahooo.com to yahoo.com"),
    ("x@outlok.com", "x@outlook.com", "outlok.com to outlook.com"),
    ("info@cedargrill.con", "info@cedargrill.com", "cedargrill.con to cedargrill.com"),
    ("x@cloud.com", "x@cloud.com", ""),          # a real domain, not a typo of icloud.com
    ("x@mail.com", "x@mail.com", ""),
    ("ceo@yahoo.co.uk", "ceo@yahoo.co.uk", ""),
    ("ali.cedar@gmail.com", "ali.cedar@gmail.com", ""),
])
def test_addresses_are_tidied_and_typos_fixed(cell, email, fixed):
    assert emailcheck.clean(cell) == (email, fixed, "")


@pytest.mark.parametrize("cell,why", [
    ("", "no email"),
    ("not-an-email", "no email"),
    ("ali@@shop.ae", "format"),
    ("ali@shop", "format"),
    ("a@b.c", "format"),
    ("logo@2x.png", "file name"),
    ("name@domain.com", "placeholder"),
    ("noreply@shop.ae", "no reply"),
    ("filler@godaddy.com", "placeholder"),
    ("x@email.com", "platform"),
    ("support@talabat.com", "platform"),
    ("8f2a9c1e5b7d4f3a9c1e5b7d4f3a9c1e@o123.ingest.sentry.io", "platform"),
    ("3b8f2a9c1e5b7d4f3a9c1e5b7d4f3a9c@shop.ae", "code from a website"),
    ("info@gmail.com", "somebody's own inbox"),
    ("booking@hotmail.com", "somebody's own inbox"),
])
def test_addresses_that_would_bounce_or_reach_nobody_are_left_out(cell, why):
    email, fixed, problem = emailcheck.clean(cell)
    assert email == "" and why in problem


def test_upload_fixes_typos_and_says_what_it_left_out(project, con, fake_web, fake_clock):
    rows = [["Cedar Grill", "ali@gmial.com"], ["Sky Salon", "logo@2x.png"], ["Blue Cafe", "info@gmail.com"],
            ["Rose Spa", "hello@rosespa.con"], ["Ghost Co", "info@nomx-ghost.ae"], ["Lamp Shop", "sales@lampshop.ae"]]
    write_csv(project, "leads.csv", rows, ["Business", "Email"])
    result = importer.import_file(con, importer.pending_files()[0], log=lambda *a: None)
    assert result["stats"]["imported"] == 3 and result["stats"]["fixed"] == 2
    assert {r["email"] for r in con.execute("SELECT email FROM leads")} == {"ali@gmail.com", "hello@rosespa.com", "sales@lampshop.ae"}
    text = "\n".join(importer.summary_lines(result))
    assert "Fixed 2 email typos, for example gmial.com to gmail.com, rosespa.con to rosespa.com" in text
    assert "not an email (an image or file name) (1)" in text and "somebody's own inbox" in text and "no MX records" in text


def test_leads_imported_earlier_are_checked_again_before_sending(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    for email in ("ali@gmial.com", "info@gmail.com"):
        con.execute("INSERT INTO leads(email, business, segment, status, next_step, imported_at, mx_status) "
                    "VALUES(?, 'Shop', 'B', 'queued', 0, '2026-11-02', 'ok')", (email,))
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    assert [m["To"] for m in smtp.outbox] == ["ali@gmail.com"]
    assert db.lead_by_email(con, "ali@gmail.com")["status"] == "active"
    blocked = db.lead_by_email(con, "info@gmail.com")
    assert blocked["status"] == "blocked" and "somebody's own inbox" in blocked["stop_reason"]


def test_follow_up_dates():
    first = date(2026, 11, 9)
    due = schedule.next_due_after
    assert due(0, first, first) == "2026-11-12"                    # day 3
    assert due(1, first, date(2026, 11, 12)) == "2026-11-16"       # day 7
    assert due(2, first, date(2026, 11, 16)) == "2026-11-23"       # day 14
    assert due(3, first, date(2026, 11, 23)) == "2026-12-09"       # day 30
    assert due(4, first, date(2026, 12, 9)) == "2027-01-08"        # day 60
    assert due(5, first, date(2027, 1, 8)) == "2027-02-07"         # day 90
    assert due(6, first, date(2027, 2, 8)) is None                 # done
    assert due(3, first, date(2026, 12, 5)) == "2026-12-13"        # a late one keeps half the usual gap before the next
    assert set(templates.FOLLOW_UP) == set(templates.ADS_FOLLOW_UP) == set(schedule.FOLLOW_UP_DAYS)


def test_every_follow_up_is_different_and_passes_the_checks():
    from outreach import config

    s = config.Settings(whatsapp="0501234567")
    lead = {"segment": "B", "business": "Glossy PPF", "first_name": "Sara"}
    bodies = [templates.follow_up(lead, step, s) for step in sorted(schedule.FOLLOW_UP_DAYS)]
    assert len({b for b, _ in bodies}) == 6
    for step, (body, full) in enumerate(bodies, 1):
        assert templates.lint("Re: Glossy PPF website", body, full, step)[0] == []
        assert body.startswith("Hi Sara ") and full.endswith(templates.OPT_OUT)
        assert templates.word_count(body) < 60
        assert "http" not in body                                  # no links: the work goes inside the reply


def test_leads_that_finished_the_old_short_sequence_carry_on(project, fake_clock):
    fake_clock.set(datetime(2026, 11, 20, 8, 0, tzinfo=clock.TZ))
    con = db.connect()
    con.execute("INSERT INTO leads(email, business, segment, status, next_step, first_sent_at, stop_reason, inbox) VALUES"
                "('a@shop.ae', 'Shop', 'B', 'done', NULL, '2026-11-02T10:00:00+04:00', 'sequence finished, no reply', 'inbox1'),"
                "('b@shop2.ae', 'Shop 2', 'B', 'done', NULL, '2026-11-09T10:00:00+04:00', 'sequence finished, no reply', 'inbox1'),"
                "('c@shop3.ae', 'Shop 3', 'B', 'replied', NULL, '2026-11-02T10:00:00+04:00', 'replied: interested', 'inbox1')")
    db.del_state(con, "six_follow_ups")
    con = db.connect()
    a, b, c = (db.lead_by_email(con, e) for e in ("a@shop.ae", "b@shop2.ae", "c@shop3.ae"))
    assert a["status"] == "active" and a["next_step"] == 3 and a["next_due"] == "2026-11-20"   # day 14 was the 16th: today
    assert b["status"] == "active" and b["next_due"] == "2026-11-23"                            # day 14
    assert c["status"] == "replied"
    db.update_lead(con, a["id"], status="done")
    assert db.connect() and db.lead_by_email(con, "a@shop.ae")["status"] == "done"            # only once


def test_not_now_comes_back_to_check_in(project, con, settings, smtp, dns_pass, fake_clock):
    approve(con)
    add_leads(con, 1)
    run_day(con, settings, fake_clock, datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    mid = con.execute("SELECT message_id FROM messages").fetchone()[0]
    raw = REPLY.format(mid=mid).replace("Yes please send me some examples", "Not right now, maybe in a few months")
    assert replies.process(con, settings, settings.inboxes[0], raw.encode())["label"] == "not_now"
    lead = db.lead_by_email(con, "owner0@shop0.ae")
    assert lead["status"] == "replied" and lead["waiting_on_me"] == 0 and lead["next_due"] == "2027-01-09"
    fake_clock.set(datetime(2027, 1, 8, 10, 0, tzinfo=clock.TZ))
    assert actions.check_ins_due(con) == 0
    fake_clock.set(datetime(2027, 1, 11, 10, 0, tzinfo=clock.TZ))
    w = dashboard.waiting(con, settings)
    assert len(w) == 1 and w[0]["kind"] == "time to check in"
    assert w[0]["draft"].startswith("Hi. A while back you mentioned it wasn't the right time for a website for Shop 0")
    assert "free preview" in w[0]["draft"] and w[0]["draft"].endswith("Samil")
    assert actions.mark(con, "owner0@shop0.ae", "handled")[0]
    assert dashboard.waiting(con, settings) == [] and actions.check_ins_due(con) == 0               # once, not every hour


def test_a_bounce_counts_against_the_whole_day(project, con, settings, fake_clock):
    fake_clock.set(datetime(2026, 11, 9, 10, 0, tzinfo=clock.TZ))
    for i in range(5):
        con.execute("INSERT INTO messages(lead_id, inbox, kind, step, to_email, status, sent_date, sent_at) "
                    "VALUES(?, 'inbox1', 'campaign', 0, ?, ?, '2026-11-09', '2026-11-09T09:30:00+04:00')",
                    (i, "x%d@shop.ae" % i, "bounced" if i == 0 else "sent"))
    safety.note_planned(con, "2026-11-09", 50)
    safety.after_bounce(con, "2026-11-09", log=lambda *a: None)
    assert not safety.paused(con)                                   # 1 of the day's 50 is 2%: carries on
    con.execute("UPDATE messages SET status='bounced' WHERE to_email='x1@shop.ae'")
    safety.after_bounce(con, "2026-11-09", log=lambda *a: None)
    assert "2 of the 50 emails" in safety.paused(con)["reason"]      # 2 of 50 is 4%: pauses
