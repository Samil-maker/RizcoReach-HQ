"""The email copy: names, templates, the house style checks."""
import itertools

import pytest

from outreach import config, names, templates

S = config.Settings(whatsapp="0501234567")


@pytest.mark.parametrize("raw,clean", [
    ("AL NOOR BEAUTY SALON L.L.C", "Al Noor Beauty Salon"),
    ("Dr. Smile Dental Clinic - Best Dentist in Dubai", "Dr. Smile Dental Clinic"),
    ("Glossy PPF | Ceramic Coating | Dubai", "Glossy PPF"),
    ("Gloss Garage Dubai", "Gloss Garage"),
    ("Glossy Dubai", "Glossy Dubai"),
    ("Al-Noor Cafe", "Al Noor Cafe"),
    ("✨ Lash Lounge ✨", "Lash Lounge"),
    ("the coffee spot", "The Coffee Spot"),
    ("JBR BURGER CO FZ LLC", "JBR Burger Co"),
])
def test_clean_business(raw, clean):
    assert names.clean_business(raw) == clean


@pytest.mark.parametrize("raw,first", [
    ("Ahmed Khan", "Ahmed"), ("MARIA", "Maria"), ("info", ""), ("Dr Sara Ali", "Dr Sara"), ("Mr. John Smith", "John"),
    ("", ""), ("Sales Team", ""), ("jean-luc", "Jean"), ("0501234567", ""),
])
def test_first_name(raw, first):
    assert names.clean_first_name(raw) == first


def test_whatsapp_format_has_no_dashes():
    assert names.format_whatsapp("050-123-4567") == "+971 50 123 4567"
    assert names.format_whatsapp("+971 56 846 1835") == "+971 56 846 1835"
    assert names.format_whatsapp("00971501234567") == "+971 50 123 4567"


def test_city_words():
    assert names.city_words("Al Barsha") == ("Dubai", "Dubai")
    assert names.city_words("Khalifa City") == ("the UAE", "UAE")
    assert names.clean_area("", "Shop 4, Al Barsha 1, Dubai") == "Al Barsha"


def lead(segment, first="", area="", business="Glossy PPF", obs="The site still says 2017 at the bottom", source="", ig=""):
    return {"segment": segment, "business": business, "first_name": first, "area": area, "observation": obs,
            "source": source, "instagram": ig, "address": ""}


CASES = list(itertools.product("ABC", "AB", ["", "Ahmed"], ["", "Jumeirah Lake Towers"],
                               ["Glossy PPF", "Al Noor Beauty Salon And Spa"]))


@pytest.mark.parametrize("seg,variant,first,area,business", CASES)
def test_every_first_email_passes_the_house_style(seg, variant, first, area, business):
    subject, body, full = templates.first_email(lead(seg, first, area, business), variant, S)
    problems, _ = templates.lint(subject, body, full, 0)
    assert problems == []
    assert templates.word_count(body) < 80
    assert 2 <= len(subject.split()) <= 4
    assert full.endswith(templates.OPT_OUT)
    assert "Samil\nRizcoReach\nWhatsApp +971 50 123 4567" in full
    assert ("1,500 AED" in body) == (variant == "A")
    assert "480" not in full and "care" not in full.lower()  # the care and SEO plan is never in a cold email
    assert body.startswith("Hi %s\n" % (first or "there"))


def test_missing_area_reads_naturally():
    _, body, _ = templates.first_email(lead("A", area=""), "A", S)
    assert "Saw Glossy PPF just opened. Congrats on the launch" in body
    _, body, _ = templates.first_email(lead("A", area="Al Quoz"), "A", S)
    assert "just opened in Al Quoz. Congrats" in body


def test_found_on_and_city():
    _, body, _ = templates.first_email(lead("B", source="Instagram"), "A", S)
    assert "Just the Instagram page" in body
    _, body, _ = templates.first_email(lead("B", source="google maps", area="Abu Dhabi"), "A", S)
    assert "Just the Google Maps page" in body and "UAE businesses" in body


def test_follow_ups():
    b1, f1 = templates.follow_up(lead("B"), 1, S)
    assert b1.startswith("Hi there just bringing this back up")
    b2, f2 = templates.follow_up(lead("B", first="Sara"), 2, S)
    assert b2.startswith("Last one from me Sara. If it helps")
    b2, _ = templates.follow_up(lead("B"), 2, S)
    assert b2.startswith("Last one from me. If it helps")
    for b, f in ((b1, f1), (b2, f2)):
        assert templates.lint("Re: Glossy PPF website", b, f, 1)[0] == []


def test_lint_catches_problems():
    problems, _ = templates.lint("Quick question about your amazing website today", "Hi there - great site; really", "x", 0)
    assert any("dash" in p for p in problems)
    assert any("semicolon" in p for p in problems)
    assert any("subject" in p for p in problems)
    assert any("opt out" in p for p in problems)
    full = "Hi there\n\nSee www.example.com\n\n" + templates.OPT_OUT
    assert any("link" in p for p in templates.lint("Glossy website", "Hi there See www.example.com", full, 0)[0])
    assert any("Re:" in p for p in templates.lint("Re: Glossy website", "Hi there", "Hi\n\n" + templates.OPT_OUT, 0)[0])


def test_drafts():
    d = templates.draft_reply("interested", lead("B", first="Ali"), "Yes please send", S)
    assert d.startswith("Thanks Ali. Here are some sites I've built: https://drive.google.com/")
    assert "+971 50 123 4567" in d and "480" not in d
    d = templates.draft_reply("question", lead("B"), "How much is it and do you do updates later?", S)
    assert "1,500 AED" in d and "care and SEO plan for 480 AED a month" in d
    d = templates.draft_reply("question", lead("B"), "Who are you?", S)
    assert "[A line about you and RizcoReach]" in d
    assert templates.draft_reply("not_now", lead("B"), "later", S) is None
    for cls, text in (("interested", "yes"), ("question", "how much and how long?")):
        assert not templates._DASH.search(templates._URL.sub(" ", templates.draft_reply(cls, lead("C"), text, S)))


def test_found_on_never_names_a_page_we_did_not_see():
    assert names.found_on("Facebook and Instagram", "") == "Facebook"        # Lead Hunter Ad Library lead
    assert names.found_on("Facebook and Instagram", "glossyppf") == "Instagram"
    assert names.found_on("Google Maps", "glossyppf") == "Google Maps"
    assert names.found_on("Instagram", "") == "Instagram"
    assert names.found_on("", "") == "Google Maps"


def test_follow_up_1_carries_the_portfolio_link():
    body, full = templates.follow_up(lead("B"), 1, S)
    assert body == ("Hi there just bringing this back up in case it got buried. Here are a few sites I've built so you "
                    "can see the style\n\n" + config.DEFAULT_EXAMPLES_LINK)
    assert templates.lint("Re: Glossy PPF website", body, full, 1)[0] == []
    assert full.endswith(templates.OPT_OUT)
    for seg in "ABC":  # the first email still has no link
        subject, b, f = templates.first_email(lead(seg), "A", S)
        assert "http" not in f and templates.lint(subject, b, f, 0)[0] == []
    no_link = config.Settings(whatsapp="0501234567", examples_link="")
    assert templates.follow_up(lead("B"), 1, no_link)[0] == "Hi there just bringing this back up in case it got buried."


def test_prices_come_from_settings():
    s = config.Settings(whatsapp="0501234567", website_price=1950, care_price=600)
    _, body, _ = templates.first_email(lead("B"), "A", s)
    assert "for 1,950 AED" in body
    d = templates.draft_reply("question", lead("B"), "how much, and do you do SEO after?", s)
    assert "1,950 AED" in d and "600 AED a month" in d
    env_s = config.load_settings({"WHATSAPP_NUMBER": "1", "WEBSITE_PRICE": "2,000", "CARE_PLAN_PRICE": "450"})
    assert env_s.website_price == 2000 and env_s.care_price == 450


def test_meta_ads_offer_by_niche():
    s = config.Settings(whatsapp="0501234567")
    def ads(niche, business="Glow"):
        return {"segment": "N", "campaign": "ads", "business": business, "niche": niche, "first_name": "", "area": "",
                "observation": "", "source": "", "instagram": "", "address": ""}
    clinic = templates.first_email(ads("Dental clinics"), "A", s)[1]
    assert "Nothing upfront. You only pay once you've had your first genuine lead" in clinic
    assert "job seekers or suppliers" in clinic and "WhatsApp first" in clinic   # selling the screening system
    for home in (ads("Interior designers"), ads("", "Luxe Interiors"), ads("Renovation companies"), ads("Landscaping")):
        body = templates.first_email(home, "A", s)[1]
        assert "One flat monthly rate" in body and "Nothing upfront" not in body
    assert "Nothing upfront" not in templates.first_email(ads("Dental clinics"), "B", s)[1]  # B has no offer line
    assert "first genuine lead" in templates.draft_reply("interested", ads("Gyms"), "yes", s)
    assert "[Your monthly rate" in templates.draft_reply("interested", ads("Interior designers"), "yes", s)
