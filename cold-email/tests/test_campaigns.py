"""Two campaigns side by side: website and Meta ads."""
import re
from datetime import datetime

from conftest import ENV
from outreach import clock, config, db, importer, replies, schedule, sender, templates

LEAD_HUNTER_ADS_EXPORT = (
    "priority,business,niche,area,meta_ads,active_ads,ad_library_search,google_rating,google_reviews,google_maps,website,"
    "website_score,tags,phone,whatsapp_link,whatsapp_message_link,email,instagram,address,status,notes,found_on\n"
    "80,Glow Dental Clinic,Dental clinics,Al Barsha,Not running ads,,,4.8,120,,https://glowdental.ae,70,No Meta ads,"
    "+971 50 111 2233,,,info@glowdental.ae,,,New,,2026-11-08\n"
    "70,Busy Gym,Gyms,JLT,Running ads,4,,4.5,300,,https://busygym.ae,80,Running ads,,,,hello@busygym.ae,,,New,,2026-11-08\n"
    "60,Quiet Spa,Spas,Jumeirah,Not checked,,,4.2,40,,https://quietspa.ae,60,Ad check not done,,,,book@quietspa.ae,,,New,,2026-11-08\n"
)


def two_inbox_settings(project):
    (project / ".env").write_text("# test\n")
    return config.load_settings(dict(ENV, INBOX2_EMAIL="rizco.ads@gmail.com", INBOX2_APP_PASSWORD="abcdefghijklmnop",
                                     INBOX2_CAMPAIGN="ads"))


def test_lead_hunter_meta_ads_export_becomes_the_ads_campaign(project, con, fake_web):
    (project / "leads" / "inbox" / "meta-ads-prospects-2026-11-08.csv").write_text(LEAD_HUNTER_ADS_EXPORT)
    r = importer.import_pending(con, log=lambda *a: None)[0]
    assert r["campaign"] == "ads" and r["stats"]["imported"] == 3
    by = {l["email"]: l for l in con.execute("SELECT * FROM leads")}
    assert by["info@glowdental.ae"]["campaign"] == "ads" and by["info@glowdental.ae"]["segment"] == "N"
    assert by["hello@busygym.ae"]["segment"] == "SKIP" and by["hello@busygym.ae"]["status"] == "skipped"
    assert by["book@quietspa.ae"]["segment"] == "G"
    assert by["info@glowdental.ae"]["site_json"] is None  # no website checks for Meta ads leads


def test_choosing_the_campaign_by_hand(project, con, fake_web):
    (project / "leads" / "inbox" / "list.csv").write_text("business,email,area\nSky Cafe,hello@skycafe.ae,Deira\n")
    r = importer.import_pending(con, log=lambda *a: None, campaign="ads")[0]
    lead = db.lead_by_email(con, "hello@skycafe.ae")
    assert r["campaign"] == "ads" and lead["campaign"] == "ads" and lead["segment"] == "G"


def test_ads_emails_wait_for_approval_and_go_from_the_ads_inbox(project, con, smtp, dns_pass, fake_clock, fake_web):
    s = two_inbox_settings(project)
    assert s.inbox("inbox1").campaigns == ("website",) and s.inbox("inbox2").campaigns == ("ads",)
    db.set_state(con, "approved", {"at": clock.iso()})  # website approved, Meta ads not yet
    (project / "leads" / "inbox" / "meta-ads-prospects.csv").write_text(LEAD_HUNTER_ADS_EXPORT)
    (project / "leads" / "inbox" / "web.csv").write_text("business,email\nBlue Bakery,hi@bluebakery.ae\n")
    importer.import_pending(con, log=lambda *a: None)

    fake_clock.set(datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    assert [(m["From"], m["To"]) for m in smtp.outbox] == [("Samil <samilatrizcoreach@gmail.com>", "hi@bluebakery.ae")]

    db.set_state(con, "approved:ads", {"at": clock.iso()})
    smtp.outbox.clear()
    fake_clock.set(datetime(2026, 11, 10, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    sent = {m["To"]: m for m in smtp.outbox}
    assert set(sent) == {"info@glowdental.ae", "book@quietspa.ae"}  # the gym already runs ads: skipped
    glow = sent["info@glowdental.ae"]
    assert glow["From"] == "Samil <rizco.ads@gmail.com>" and glow["Subject"] == "Glow Dental Clinic enquiries"
    assert "couldn't see any Facebook or Instagram ads running" in glow.get_content()
    assert "couldn't see any" not in sent["book@quietspa.ae"].get_content()  # not checked: no claim


def test_ads_reply_gets_an_ads_draft(project, con, smtp, dns_pass, fake_clock, fake_web):
    s = two_inbox_settings(project)
    db.set_state(con, "approved", {"at": clock.iso()})
    db.set_state(con, "approved:ads", {"at": clock.iso()})
    (project / "leads" / "inbox" / "meta-ads-prospects.csv").write_text(LEAD_HUNTER_ADS_EXPORT)
    importer.import_pending(con, log=lambda *a: None)
    fake_clock.set(datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    mid = con.execute("SELECT message_id FROM messages WHERE to_email='info@glowdental.ae'").fetchone()[0]
    raw = ("From: Dr Glow <info@glowdental.ae>\nTo: rizco.ads@gmail.com\nSubject: Re: Glow Dental Clinic enquiries\n"
           "Message-ID: <r9@glow>\nIn-Reply-To: %s\nDate: Tue, 10 Nov 2026 10:00:00 +0400\n\nYes please send the details\n" % mid)
    fake_clock.set(datetime(2026, 11, 10, 11, 0, tzinfo=clock.TZ))
    info = replies.process(con, s, s.inbox("inbox2"), raw.encode())
    assert info["label"] == "interested" and "Facebook and Instagram ads for Glow Dental Clinic" in info["draft"]
    assert "drive.google.com" not in info["draft"]  # the website portfolio is not for ads replies


def test_ads_follow_ups(project):
    s = config.Settings(whatsapp="0501234567")
    lead = {"segment": "N", "campaign": "ads", "business": "Glow Dental", "first_name": "", "area": "", "observation": "",
            "source": "", "instagram": "", "address": ""}
    bodies = []
    for step in sorted(schedule.FOLLOW_UP_DAYS):
        body, full = templates.follow_up(lead, step, s)
        assert re.search(r"Facebook and Instagram|how it works|enquiries|WhatsApp|genuine lead", body), body
        assert "website" not in body.lower()                             # Meta ads leads never get the website pitch
        assert templates.lint("Re: Glow Dental enquiries", body, full, step)[0] == []
        bodies.append(body)
    assert len(set(bodies)) == len(bodies)
    assert "It's a one time setup fee and then 850 AED a month." in bodies[4]   # the offer again
    assert "appointment setters call or WhatsApp" in bodies[1]


# ----------------------------------------------------------------------------- Elheen (the booking system)

def booking_settings(project):
    (project / ".env").write_text("# test\n")
    return config.load_settings(dict(ENV, INBOX2_EMAIL="elheen.com@gmail.com", INBOX2_APP_PASSWORD="abcdefghijklmnop",
                                     INBOX2_CAMPAIGN="booking"))


def test_inbox_campaign_settings():
    assert config.campaigns_from("both") == ("website", "ads")          # "both" stays the two RizcoReach campaigns
    assert config.campaigns_from("booking") == ("booking",)
    assert config.campaigns_from("Elheen") == ("booking",)
    assert config.campaigns_from("website,booking") == ("website", "booking")
    assert config.campaigns_from("nonsense") == ("website",)


def test_elheen_file_becomes_the_booking_campaign(project, con, fake_web):
    (project / "leads" / "inbox" / "elheen-salons.csv").write_text(
        "business,email,area,website\nRose Salon,book@rosesalon.ae,JLT,https://rosesalon.ae\nQuiet Spa,hi@quietspa.ae,Jumeirah,\n")
    r = importer.import_pending(con, log=lambda *a: None)[0]
    assert r["campaign"] == "booking" and r["stats"]["imported"] == 2 and r["stats"]["seg_K"] == 2
    lead = db.lead_by_email(con, "book@rosesalon.ae")
    assert lead["campaign"] == "booking" and lead["segment"] == "K" and lead["site_json"] is None  # no website check


def test_elheen_emails_wait_for_approval_and_go_from_the_elheen_inbox(project, con, smtp, dns_pass, fake_clock, fake_web):
    s = booking_settings(project)
    assert s.inbox("inbox2").campaigns == ("booking",)
    db.set_state(con, "approved", {"at": clock.iso()})  # website approved, Elheen not yet
    (project / "leads" / "inbox" / "list.csv").write_text("business,email,area\nRose Salon,book@rosesalon.ae,JLT\n")
    importer.import_pending(con, log=lambda *a: None, campaign="booking")
    (project / "leads" / "inbox" / "web.csv").write_text("business,email\nBlue Bakery,hi@bluebakery.ae\n")
    importer.import_pending(con, log=lambda *a: None)

    fake_clock.set(datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    assert [m["To"] for m in smtp.outbox] == ["hi@bluebakery.ae"]
    assert "RizcoReach" in smtp.outbox[0].get_content() and "Elheen" not in smtp.outbox[0].get_content()

    db.set_state(con, "approved:booking", {"at": clock.iso()})
    smtp.outbox.clear()
    fake_clock.set(datetime(2026, 11, 10, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    [rose] = smtp.outbox
    assert rose["From"] == "Samil <elheen.com@gmail.com>" and rose["Subject"] == "Rose Salon bookings"
    text = rose.get_content()
    assert "Elheen" in text and "RizcoReach" not in text and "website" not in text.lower()


def test_elheen_reply_gets_an_elheen_draft(project, con, smtp, dns_pass, fake_clock, fake_web):
    s = booking_settings(project)
    db.set_state(con, "approved", {"at": clock.iso()})
    db.set_state(con, "approved:booking", {"at": clock.iso()})
    (project / "leads" / "inbox" / "elheen.csv").write_text("business,email\nRose Salon,book@rosesalon.ae\n")
    importer.import_pending(con, log=lambda *a: None)
    fake_clock.set(datetime(2026, 11, 9, 9, 0, tzinfo=clock.TZ))
    sender.SendRun(con, s).run()
    mid = con.execute("SELECT message_id FROM messages WHERE to_email='book@rosesalon.ae'").fetchone()[0]
    raw = ("From: Rose <book@rosesalon.ae>\nTo: elheen.com@gmail.com\nSubject: Re: Rose Salon bookings\n"
           "Message-ID: <r9@rose>\nIn-Reply-To: %s\nDate: Tue, 10 Nov 2026 10:00:00 +0400\n\nHow much is it?\n" % mid)
    fake_clock.set(datetime(2026, 11, 10, 11, 0, tzinfo=clock.TZ))
    info = replies.process(con, s, s.inbox("inbox2"), raw.encode())
    assert info["label"] in ("interested", "question")
    assert "free trial" in info["draft"] and "walkthrough for Rose Salon" in info["draft"] and "website" not in info["draft"].lower()


def test_elheen_follow_ups(project):
    s = config.Settings(whatsapp="0501234567")
    lead = {"segment": "K", "campaign": "booking", "business": "Rose Salon", "first_name": "", "area": "", "observation": "",
            "source": "", "instagram": "", "address": ""}
    bodies = []
    for step in sorted(schedule.FOLLOW_UP_DAYS):
        body, full = templates.follow_up(lead, step, s)
        assert "website" not in body.lower() and "RizcoReach" not in full    # never the website pitch, never RizcoReach
        assert full.splitlines()[-4] == "Elheen" or "Elheen" in full
        assert templates.lint("Re: Rose Salon bookings", body, full, step)[0] == []
        bodies.append(body)
    assert len(set(bodies)) == len(bodies)
    for v in "AB":
        subject, body, full = templates.first_email(dict(lead, area="Jumeirah Lake Towers"), v, s)
        assert templates.lint(subject, body, full, 0)[0] == [] and templates.word_count(body) < 80
