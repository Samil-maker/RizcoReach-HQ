"""The setup questions, the hourly job, and Lead Hunter exports."""
import shutil
from pathlib import Path

import pytest

from outreach import cli, clock, config, db, importer, launchd, setup_wizard


@pytest.fixture
def wizard(project, monkeypatch, smtp, dns_pass, fake_clock):
    shutil.copy(Path(__file__).resolve().parent.parent / ".env.example", project / ".env.example")
    answers = []
    monkeypatch.setattr("builtins.input", lambda q="": answers.pop(0))
    pw = []
    monkeypatch.setattr(setup_wizard.getpass, "getpass", lambda q="": pw.pop(0))
    monkeypatch.setattr(setup_wizard.webbrowser, "open", lambda url: True)
    monkeypatch.setattr("outreach.mailbox.login_test", lambda inbox: "ok")
    installed = []
    monkeypatch.setattr(launchd, "install", lambda: installed.append(1) or "installed")
    monkeypatch.setattr(launchd, "IS_MAC", False)
    monkeypatch.setattr(setup_wizard, "desktop_shortcuts", lambda: None)
    return answers, pw, installed


def test_setup_from_nothing_to_approved(project, wizard, smtp, capsys):
    answers, pw, installed = wizard
    answers += [
        "",                      # WhatsApp: keep the number from rizcoreach.ae
        "samil@example.org",     # where the test email goes
        "yes",                   # send the test email
        "yes",                   # it is in the inbox
        "yes",                   # it reads right
    ]
    pw += ["wrong", "abcd efgh ijkl mnop"]  # a typo first, then the real App Password
    assert setup_wizard.run() == 0
    env = setup_wizard.read_env()
    assert env["INBOX1_EMAIL"] == "samilatrizcoreach@gmail.com" and env["INBOX1_APP_PASSWORD"] == "abcdefghijklmnop"
    assert env["WHATSAPP_NUMBER"] == "+971568461835" and env["TEST_EMAIL_TO"] == "samil@example.org"
    assert oct((project / ".env").stat().st_mode)[-3:] == "600"
    assert [m["To"] for m in smtp.outbox] == ["samil@example.org"]
    con = db.connect()
    assert db.get_state(con, "approved") and installed == [1]
    out = capsys.readouterr().out
    assert "exactly 16 letters" in out and "Approved" in out


def test_setup_again_keeps_what_works(project, wizard, smtp):
    answers, pw, _ = wizard
    answers += ["", "samil@example.org", "yes", "yes", "yes"]
    pw += ["abcdefghijklmnop"]
    setup_wizard.run()
    smtp.outbox.clear()
    answers += ["", ""]  # Enter, Enter: everything is kept, no new App Password, no new test email
    assert setup_wizard.run() == 0
    assert smtp.outbox == [] and pw == []


def test_spam_test_keeps_sending_off(project, wizard, smtp):
    answers, pw, _ = wizard
    answers += ["", "samil@example.org", "yes", "no"]
    pw += ["abcdefghijklmnop"]
    setup_wizard.run()
    assert not db.get_state(db.connect(), "approved")


def test_lead_hunter_export(project, con, fake_web):
    path = project / "leads" / "inbox" / "lead-hunter-2026-11-08.csv"
    path.write_text(
        "priority,heat,business,facebook_page,website,phone,email,instagram,status,notes,found_on\n"
        "80,hot,Glossy PPF,,,+971 55 999 8877,info@glossyppf.ae,glossyppf,New,,Meta Ad Library\n"
        "70,hot,Old Friend Cafe,,,,hi@oldfriend.ae,,Not interested,,Google Maps\n"
        "60,warm,Talking Salon,,,,hi@talking.ae,,Replied,,Google Maps\n"
        "55,warm,No Email Spa,,,,,,New,,Google Maps\n"
    )
    r = importer.import_pending(con, log=lambda *a: None)[0]
    assert r["stats"]["imported"] == 1 and r["stats"]["handled"] == 2
    lead = db.lead_by_email(con, "info@glossyppf.ae")
    assert lead["segment"] == "B" and lead["phone"] == "+971 55 999 8877"


def test_hourly_job(project, con, settings, smtp, fake_clock, monkeypatch, no_network_mail):
    sent = []
    monkeypatch.setattr(launchd, "notify", lambda title, msg: sent.append(title))
    (project / "leads" / "inbox" / "new.csv").write_text("business,email\nSky Cafe,hello@skycafe.ae\n")
    monkeypatch.setattr(config, "load_settings", lambda env=None: settings)
    cli.main(["auto"])
    assert db.lead_by_email(db.connect(), "hello@skycafe.ae") and sent == ["RizcoReach: 1 new leads imported"]
    assert no_network_mail == ["inbox1"]  # replies were checked
    assert (project / "reports" / ("%s.md" % clock.today())).exists()


def test_bad_file_is_moved_aside(project, con, monkeypatch):
    seen = []
    monkeypatch.setattr(launchd, "notify", lambda title, msg: seen.append(msg))
    (project / "leads" / "inbox" / "people.csv").write_text("name,phone\nAli,050\n")
    importer.import_pending(con, log=lambda *a: None)
    assert not importer.pending_files() and (project / "leads" / "processed" / "could-not-import_people.csv").exists()
    assert seen and "people.csv" in seen[0]


def test_wake_and_schedule_commands():
    cmd = launchd.wake_command()
    assert cmd[:4] == ["sudo", "pmset", "repeat", "wakeorpoweron"] and len(cmd[4]) == 5
    assert "<string>auto</string>" in launchd.hourly_plist() and "StartInterval" in launchd.hourly_plist()
    assert "<string>send</string>" in launchd.plist() and "caffeinate" in launchd.plist()


def test_add_inbox(project, wizard, smtp, capsys):
    answers, pw, _ = wizard
    answers += ["", "samil@example.org", "yes", "yes", "yes"]
    pw += ["abcdefghijklmnop"]
    setup_wizard.run()
    answers += ["samilatrizcoreach@gmail.com",   # already sending: refused
                "rizco.two@gmail.com",           # the new one
                "",                              # sends website emails (the default)
                "yes"]                           # brand new account
    pw += ["abcdefghijklmnop"]
    assert setup_wizard.add_inbox() == 0
    env = setup_wizard.read_env()
    assert env["INBOX2_EMAIL"] == "rizco.two@gmail.com" and env["INBOX2_PROVIDER"] == "gmail"
    assert env["INBOX2_APP_PASSWORD"] == "abcdefghijklmnop" and env["INBOX1_APP_PASSWORD"] == "abcdefghijklmnop"
    assert db.get_state(db.connect(), "warmup_start:inbox2") == clock.today().isoformat()
    out = capsys.readouterr().out
    assert "warms up for 14 days" in out and "100 a day: Monday 23 November" in out
    assert env["INBOX2_CAMPAIGN"] == "website"


def test_two_imports_at_once_take_turns(project, con, fake_web):
    import threading

    (project / "leads" / "inbox" / "list.csv").write_text("business,email\nSky Cafe,hello@skycafe.ae\nBlue Spa,hi@bluespa.ae\n")
    results, errors = [], []

    def run():
        try:
            results.append(importer.import_pending(db.connect(), log=lambda *a: None))
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert sorted(len(r) for r in results) == [0, 1]   # one imported the file, the other found nothing left
    assert con.execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 2
