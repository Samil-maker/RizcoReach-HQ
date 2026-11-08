"""Website checks, segments, and reading replies."""
from datetime import date
from email import message_from_string, policy

from conftest import MODERN_SITE, OLD_SITE
from outreach import classify, segment, sitecheck


def test_social_links_are_not_websites():
    assert sitecheck.normalize_website("https://instagram.com/glossyppf") == ("", "glossyppf")
    assert sitecheck.normalize_website("linktr.ee/x") == ("", "")
    assert sitecheck.normalize_website("glossy.ae")[0] == "http://glossy.ae"
    assert sitecheck.normalize_website("n/a") == ("", "")


def test_old_site_observations():
    info = sitecheck.analyse_html(OLD_SITE, "http://alnoor.ae/", 1.0, this_year=2026)
    assert info["mobile"] is False and info["https"] is False and info["copyright_year"] == 2017
    kind, line, _ = segment.observation(dict(info, state="ok"), this_year=2026)
    assert kind == "mobile" and line == "It's quite hard to use on a phone"
    # with a viewport and https the next true thing is the old year
    fixed = OLD_SITE.replace("<head>", '<head><meta name="viewport" content="width=device-width">')
    info = sitecheck.analyse_html(fixed, "https://alnoor.ae/", 1.0, this_year=2026)
    kind, line, _ = segment.observation(dict(info, state="ok"), this_year=2026)
    assert line == "The site still says 2017 at the bottom"


def test_modern_site_is_skipped():
    info = sitecheck.analyse_html(MODERN_SITE, "https://glow.ae/", 0.9, this_year=2026)
    assert info["mobile"] and info["https"] and info["has_contact"] and info["year_is_dynamic"]
    assert segment.observation(dict(info, state="ok"), this_year=2026)[0] is None


def test_javascript_year_is_never_claimed():
    html = MODERN_SITE.replace('&copy; <span id="y"></span>', "&copy; 2018")
    info = sitecheck.analyse_html(html, "https://glow.ae/", 0.9, this_year=2026)
    assert info["copyright_year"] == 2018 and info["year_is_dynamic"]
    assert segment.observation(dict(info, state="ok"), this_year=2026)[0] is None


def test_year_ranges_use_the_latest_year():
    html = MODERN_SITE.replace('&copy; <span id="y"></span>', "&copy; 2015 - 2026").replace("new Date().getFullYear()", "''")
    assert sitecheck.analyse_html(html, "https://x.ae/", 1, this_year=2026)["copyright_year"] == 2026


def test_parked_page():
    info = sitecheck.analyse_html("<html><body><h1>This domain is for sale</h1> Buy this domain today</body></html>", "https://x.ae/", 1)
    assert segment.observation(dict(info, state="ok"))[0] == "parked"


def test_no_contact_option():
    html = MODERN_SITE.replace('<a href="/book">Book now</a> <a href="https://wa.me/971501112233">WhatsApp</a>', '<a href="/about">About</a>')
    info = sitecheck.analyse_html(html, "https://glow.ae/", 0.9)
    assert segment.observation(dict(info, state="ok"))[0] == "contact"


def test_check_site_http_only(fake_web, fake_clock):
    fixed = OLD_SITE.replace("<head>", '<head><meta name="viewport" content="width=device-width">')
    fake_web["alnoor.ae"] = ("http_only", fixed)
    site = sitecheck.check_site("alnoor.ae")
    assert site["state"] == "ok" and site["https"] is False
    assert segment.observation(site)[1] == "Chrome marks it as not secure because it has no HTTPS"


def test_check_site_down_blocked_slow(fake_web, fake_clock):
    fake_web["down.ae"] = ("down",)
    assert segment.observation(sitecheck.check_site("down.ae"))[0] == "down"
    fake_web["cf.ae"] = ("status", 403)
    site = sitecheck.check_site("cf.ae")
    assert site["state"] == "blocked" and segment.observation(site)[0] is None  # we never guess
    fake_web["slow.ae"] = ("ok", MODERN_SITE, 7.4)
    kind, line, _ = segment.observation(sitecheck.check_site("slow.ae"))
    assert line == "It took about 7 seconds to load when I opened it"
    # tries www. when the bare domain does not resolve
    fake_web["www.onlywww.ae"] = ("ok", MODERN_SITE)
    assert sitecheck.check_site("onlywww.ae")["state"] == "ok"


def test_segments():
    assert segment.decide({"source": "Instagram grand opening", "website": "x"})["segment"] == "A"
    assert segment.decide({"notes": "New branch in Marina"})["segment"] == "A"
    assert segment.decide({"notes": "new lead from maps", "website": ""})["segment"] == "B"  # "new lead" is not a new business
    assert segment.decide({"website": ""})["segment"] == "B"
    assert segment.decide({"website": "x.ae"}, {"state": "blocked", "status": 403})["segment"] == "SKIP"
    assert segment.decide({"website": "x.ae", "segment": "c"}, {"state": "blocked"})["observation_kind"] == "generic"


# ----------------------------------------------------------------------------- replies

def msg(body, subject="Re: Glossy PPF website", headers=""):
    return message_from_string("From: Ali <ali@glossy.ae>\nSubject: %s\n%s\n%s" % (subject, headers, body), policy=policy.default)


def test_reply_labels():
    cases = {
        "Yes please send examples": "interested",
        "Sure, go ahead": "interested",
        "How much for 5 pages?": "question",
        "Not interested": "opt_out",
        "no": "opt_out",
        "Please remove me from your list": "opt_out",
        "We already have a website thanks": "opt_out",
        "Not right now, maybe after Ramadan": "not_now",
        "Thanks": "other",
    }
    for text, label in cases.items():
        assert classify.classify_text(text)[0] == label, text


def test_spam_mention_is_a_complaint():
    assert classify.classify_text("This is spam. I will report you") == ("opt_out", True)
    assert classify.classify_text("Can you send me a report of what is wrong?")[1] is True  # pauses, you decide


def test_quoted_email_is_ignored():
    body = (
        "Yes please, send them over\n\nOn Mon, 9 Nov 2026 at 09:14, Samil <samilatrizcoreach@gmail.com> wrote:\n"
        "> Hi there\n> Not relevant? Just reply no and I won't email again\n"
    )
    r = classify.classify(msg(body))
    assert r.label == "interested" and r.text == "Yes please, send them over"
    # Outlook style: our text pasted under theirs without ">"
    body = "Interested, call me\n\nHad a look at the Glossy PPF website. It's quite hard to use on a phone\nNot relevant? Just reply no"
    assert classify.classify(msg(body)).label == "interested"


def test_out_of_office_with_return_date(fake_clock):
    m = msg("I am out of the office on annual leave and will be back on 16 November 2026 with limited access to email.",
            subject="Automatic reply: Glossy PPF website", headers="Auto-Submitted: auto-replied")
    r = classify.classify(m)
    assert r.label == "out_of_office" and r.is_auto and r.ooo_until == date(2026, 11, 16)
    assert classify.return_date("I'm away until 3rd December", date(2026, 11, 9)) == date(2026, 12, 3)
    assert classify.return_date("Back on 4 January", date(2026, 12, 20)) == date(2027, 1, 4)
    assert classify.return_date("I'm away for a bit", date(2026, 11, 9)) is None


def test_auto_acknowledgement_is_not_a_reply():
    r = classify.classify(msg("Thank you for contacting us. Our team will get back to you shortly."))
    assert r.label == "other" and r.is_auto


BOUNCE = """From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
To: samilatrizcoreach@gmail.com
Subject: Delivery Status Notification (Failure)
X-Failed-Recipients: gone@oldsalon.ae
Content-Type: multipart/report; report-type=delivery-status; boundary="b1"

--b1
Content-Type: text/plain

Address not found. Your message wasn't delivered to gone@oldsalon.ae because the address couldn't be found.

--b1
Content-Type: message/delivery-status

Reporting-MTA: dns; googlemail.com

Final-Recipient: rfc822; gone@oldsalon.ae
Action: failed
Status: 5.1.1

--b1
Content-Type: text/rfc822-headers

Message-ID: <abc123@gmail.com>
Subject: Old Salon website

--b1--
"""


def test_bounce_parsing():
    m = message_from_string(BOUNCE, policy=policy.default)
    assert classify.is_bounce(m)
    addrs, kind, ids = classify.bounce_details(m, BOUNCE.encode())
    assert addrs == ["gone@oldsalon.ae"] and kind == "hard" and ids == ["<abc123@gmail.com>"]
    delay = BOUNCE.replace("Action: failed", "Action: delayed").replace("Status: 5.1.1", "Status: 4.4.1")
    assert classify.bounce_details(message_from_string(delay, policy=policy.default), delay.encode())[1] == "delay"


def test_dns_check_for_gmail(monkeypatch):
    from conftest import ENV
    from outreach import config, dnscheck

    inbox = config.load_settings(dict(ENV)).inboxes[0]
    records = {
        "gmail.com": ["v=spf1 redirect=_spf.google.com", "globalsign-smime-dv=abc"],
        "20230601._domainkey.gmail.com": ["v=DKIM1; k=rsa; p=MIIBIjANBgkq"],
        "_dmarc.gmail.com": ["v=DMARC1; p=none; sp=quarantine"],
    }
    monkeypatch.setattr(dnscheck, "_txt", lambda name: (records.get(name, []), None))
    rep = dnscheck.check_inbox(inbox)
    assert rep.can_send and rep.dkim.found == "selector 20230601" and rep.dmarc.ok
    # when DNS gives nothing at all we do not pretend it passed
    monkeypatch.setattr(dnscheck, "_txt", lambda name: ([], None))
    rep = dnscheck.check_inbox(inbox)
    assert not rep.can_send and rep.lookup_failed


def test_dns_check_for_own_domain(monkeypatch):
    from conftest import ENV
    from outreach import config, dnscheck

    inbox = config.load_settings(dict(ENV, INBOX1_EMAIL="samil@getrizco.com", INBOX1_PROVIDER="workspace")).inboxes[0]
    records = {"getrizco.com": ["v=spf1 include:zohomail.com ~all"]}
    monkeypatch.setattr(dnscheck, "_txt", lambda name: (records.get(name, []), None))
    rep = dnscheck.check_inbox(inbox)
    assert not rep.can_send and not rep.spf.ok and not rep.dkim.ok and not rep.dmarc.ok
    assert "include:_spf.google.com" in " ".join(rep.spf.fix)
    assert any("google._domainkey" in l for l in rep.dkim.fix)
    records.update({"getrizco.com": ["v=spf1 include:_spf.google.com ~all"], "google._domainkey.getrizco.com": ["v=DKIM1; p=MIIB"]})
    assert dnscheck.check_inbox(inbox).can_send
