"""rizco setup: the whole setup as a few questions. Safe to run again: it keeps what already works."""
from __future__ import annotations

import getpass
import os
import re
import subprocess
import webbrowser
from datetime import timedelta
from pathlib import Path
from typing import Dict, Optional, Tuple

from . import clock, config, db, dnscheck, importer, launchd, mailer, names, schedule, templates

DEFAULT_SENDER = "samilatrizcoreach@gmail.com"
DEFAULT_WHATSAPP = "+971568461835"  # the WhatsApp number on rizcoreach.ae
SAMPLE_LEAD = {"segment": "B", "business": "Glossy PPF", "first_name": "", "area": "Al Quoz", "source": "Google Maps",
               "instagram": "", "observation": "", "address": "", "business_name": "Glossy PPF"}


def bold(text: str) -> None:
    print("\n\033[1m%s\033[0m" % text)


def ask(question: str, default: str = "") -> str:
    shown = " [%s]" % default if default else ""
    try:
        answer = input("%s%s: " % (question, shown)).strip()
    except EOFError:
        answer = ""
    return answer or default


def yes(question: str) -> bool:
    while True:
        a = ask(question + " (yes/no)").lower()
        if a in ("y", "yes"):
            return True
        if a in ("n", "no"):
            return False
        print("Please type yes or no.")


def read_env() -> Dict[str, str]:
    from dotenv import dotenv_values

    path = config.path(".env")
    return {k: (v or "") for k, v in dotenv_values(path).items()} if path.exists() else {}


def write_env(updates: Dict[str, str]) -> None:
    """Fills values into .env (made from .env.example the first time). Only you can read the file."""
    path = config.path(".env")
    source = path if path.exists() else config.path(".env.example")
    lines = source.read_text(encoding="utf-8").splitlines() if source.exists() else []
    done, out = set(), []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in updates:
            out.append("%s=%s" % (m.group(1), updates[m.group(1)]))
            done.add(m.group(1))
        else:
            out.append(line)
    out += ["%s=%s" % (k, v) for k, v in updates.items() if k not in done]
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def settings_from(env: Dict[str, str]) -> config.Settings:
    return config.load_settings(dict(env))


def desktop_shortcuts() -> Optional[Path]:
    """"RizcoReach Leads" and "RizcoReach Reports" on the Desktop, pointing at the real folders."""
    desk = Path.home() / "Desktop"
    ok = True
    for name, target in (("RizcoReach Leads", config.leads_inbox()), ("RizcoReach Reports", config.reports_dir())):
        target.mkdir(parents=True, exist_ok=True)
        link = desk / name
        if link.exists() or link.is_symlink():
            continue
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            # Terminal may not be allowed on the Desktop. Finder always is: ask it to make an alias.
            script = ('tell application "Finder" to set a to make new alias file at desktop to (POSIX file "%s" as alias)\n'
                      'tell application "Finder" to set name of a to "%s"' % (target, name))
            r = subprocess.run(["osascript", "-e", script], capture_output=True) if launchd.IS_MAC else None
            ok = ok and bool(r and r.returncode == 0)
    return desk / "RizcoReach Leads" if ok else None


def connect(inbox: config.Inbox) -> bool:
    """Gets a working App Password for this inbox (keeps one that already works) and saves it in .env."""
    if inbox.password:
        try:
            mailer.login_test(inbox)
            print("Connected: the App Password you gave before still works.")
            return True
        except mailer.SendError as e:
            if e.kind == "network":
                print("No internet connection right now (%s). Connect to the internet and try again." % e)
                return False
    if inbox.is_google:
        url = "https://myaccount.google.com/apppasswords?authuser=%s" % inbox.email
        print("This is the one thing only you can do: give this program an App Password for %s." % inbox.email)
        print("An App Password is a separate 16 letter password that only works for email. Your real password stays private.\n")
        print("I'm opening the page in your browser now. On that page:")
        print("  1. Check the top right shows %s. If not, click the round picture and switch to it." % inbox.email)
        print("  2. If it says App Passwords are not available, turn on 2-Step Verification first:")
        print("     https://myaccount.google.com/signinoptions/twosv?authuser=%s  then open the first page again." % inbox.email)
        print("  3. Type RizcoReach as the name and click Create.")
        print("  4. Copy the 16 letters Google shows, come back to this window and paste them below.\n")
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            print("Open this page yourself: " + url)
    else:
        print("Paste the password for %s. With two factor sign in that is an App Password from your email provider's "
              "security settings (Zoho: accounts.zoho.com > Security > App Passwords)." % inbox.email)
    for _ in range(6):
        pw = re.sub(r"\s", "", getpass.getpass("Paste the App Password and press Enter (nothing shows while you paste, that's normal): "))
        if not pw:
            continue
        if inbox.is_google and not re.fullmatch(r"[a-zA-Z]{16}", pw):
            print("That's not it: an App Password is exactly 16 letters (Google shows them in 4 groups of 4). Try again.")
            continue
        inbox.password = pw
        try:
            mailer.login_test(inbox)
        except mailer.SendError as e:
            if e.kind == "auth":
                print("It wasn't accepted. Make sure you made it while signed in as %s, then paste it again." % inbox.email)
                continue
            print("Couldn't reach the mail server (%s). Check the internet connection and try again." % e)
            continue
        write_env({"%s_APP_PASSWORD" % inbox.key.upper(): pw})
        print("Connected. The App Password works.")
        return True
    print("\nStopping here for now. Run this again once you have the App Password.")
    return False


def add_inbox_from_form(email: str, password: str, brand_new: bool, provider: str = "") -> Tuple[bool, str]:
    """The dashboard's "Add inbox" form: checks everything first and only saves an inbox that works."""
    con = db.connect()
    env = read_env()
    email = (email or "").strip().lower()
    password = re.sub(r"\s", "", password or "")
    if not config.EMAIL_RE.match(email):
        return False, "That doesn't look like an email address."
    if email in {i.email for i in settings_from(env).inboxes}:
        return False, "%s is already one of your sending inboxes." % email
    if email == env.get("TEST_EMAIL_TO", "").lower():
        return False, "That's your test address. Use a separate account for sending."
    slot = next((n for n in range(1, 10) if not env.get("INBOX%d_EMAIL" % n)), None)
    if slot is None:
        return False, "All 9 inbox slots are used."
    provider = (provider or config.guess_provider(email)).lower()
    if provider == "custom":
        provider = "workspace"
    if provider not in config.PROVIDERS:
        return False, "Unknown provider %r." % provider
    key = "INBOX%d" % slot
    trial = dict(env, **{key + "_EMAIL": email, key + "_PROVIDER": provider, key + "_APP_PASSWORD": password})
    inbox = settings_from(trial).inbox("inbox%d" % slot)
    if inbox.is_google and not re.fullmatch(r"[a-zA-Z]{16}", password):
        return False, "An App Password is exactly 16 letters (Google shows them in 4 groups of 4)."
    try:
        mailer.login_test(inbox)
    except mailer.SendError as e:
        if e.kind == "auth":
            return False, "Gmail didn't accept that App Password. Make sure you created it while signed in as %s." % email
        return False, "Couldn't reach the mail server: %s" % e
    try:
        from .mailbox import login_test

        login_test(inbox)
    except Exception as e:  # noqa: BLE001
        return False, "Sending works but reading replies didn't: %s" % e
    rep = dnscheck.check_inbox(inbox)
    write_env({key + "_EMAIL": email, key + "_PROVIDER": provider, key + "_APP_PASSWORD": password})
    note = ""
    if not rep.can_send:
        note = " Its domain doesn't pass SPF and DKIM yet, so it won't send until it does (run rizco check for the records)."
    if brand_new:
        db.set_state(con, "warmup_start:inbox%d" % slot, clock.today().isoformat())
        ends = clock.next_weekday(clock.today() + timedelta(days=schedule.WARMUP_DAYS))
        return True, "Added %s. It warms up for 14 days, then cold emails start on %s at 5 a day.%s" % (email, clock.nice(ends), note)
    return True, "Added %s. Cold emails start on the next weekday at 5 a day.%s" % (email, note)


def add_inbox() -> int:
    """rizco add-inbox: one more sending inbox. Brand new ones warm up for 14 days first."""
    con = db.connect()
    env = read_env()
    s = settings_from(env)
    taken = {i.email for i in s.inboxes}
    slot = next((n for n in range(1, 10) if not env.get("INBOX%d_EMAIL" % n)), None)
    if slot is None:
        print("All 9 inbox slots in .env are used.")
        return 1
    bold("Add a sending inbox")
    print("Each extra inbox adds up to %d emails a day (30 with your own domain), after its warm up." % config.FREE_INBOX_CAP)
    while True:
        email = ask("The new email address").lower()
        if config.EMAIL_RE.match(email) and email not in taken and email != env.get("TEST_EMAIL_TO", "").lower():
            break
        print("Use a new address that isn't already sending (and isn't your test address).")
    provider = config.guess_provider(email)
    if provider == "custom":
        while True:
            provider = ask("Which provider is it? workspace (Google), zoho, zoho-eu or zoho-in", "workspace").lower()
            if provider in config.PROVIDERS:
                break
    key = "INBOX%d" % slot
    write_env({key + "_EMAIL": email, key + "_PROVIDER": provider})
    inbox = settings_from(read_env()).inbox("inbox%d" % slot)
    if not connect(inbox):
        write_env({key + "_EMAIL": "", key + "_PROVIDER": "", key + "_APP_PASSWORD": ""})
        return 1
    inbox = settings_from(read_env()).inbox("inbox%d" % slot)
    try:
        from .mailbox import login_test

        login_test(inbox)
    except Exception as e:  # noqa: BLE001
        print("Reading its replies didn't work (%s). Run  rizco add-inbox  again in a minute." % e)
        write_env({key + "_EMAIL": "", key + "_PROVIDER": "", key + "_APP_PASSWORD": ""})
        return 1
    rep = dnscheck.check_inbox(inbox)
    if not rep.can_send:
        print("Saved, but its domain doesn't pass SPF and DKIM yet, so it won't send until it does:")
        for c in (rep.spf, rep.dkim):
            for line in c.fix:
                print("  " + line)
    new = yes("Is this a brand new account (made in the last month)?")
    if new:
        db.set_state(con, "warmup_start:inbox%d" % slot, clock.today().isoformat())
        ends = clock.next_weekday(clock.today() + timedelta(days=schedule.WARMUP_DAYS))
        print("\nAdded. %s warms up for 14 days: it swaps a few normal emails a day with your other inboxes." % email)
        print("Cold emails from it start on %s at 5 a day and grow to %d over 4 weeks." % (clock.nice(ends), schedule._cap_for_week(inbox, 99)))
    else:
        print("\nAdded. %s starts cold emails on the next weekday at 5 a day, growing to %d over 4 weeks." % (email, schedule._cap_for_week(inbox, 99)))
    s = settings_from(read_env())
    f = schedule.forecast(con, s.inboxes)
    print("\nAll your inboxes together:")
    for target, when in f["reach"].items():
        print("  %d a day: %s" % (target, clock.nice(when) if hasattr(when, "day") else when))
    return 0


def _open_dashboard_soon() -> None:
    """Puts a RizcoReach Dashboard icon on the Desktop and opens the page once the background job is up."""
    if not launchd.IS_MAC:
        return
    import time

    from . import dashboard

    dashboard.desktop_shortcut()
    for _ in range(15):
        if dashboard.running():
            webbrowser.open(dashboard.URL)
            print("Your dashboard is open in the browser: %s (there's an icon for it on your Desktop)." % dashboard.URL)
            return
        time.sleep(1)
    print("Your dashboard: %s" % dashboard.URL)


def already_set_up(con, env: Dict[str, str]) -> bool:
    """True when setup was finished before and Gmail still accepts the App Password."""
    if not (env.get("INBOX1_APP_PASSWORD") and env.get("TEST_EMAIL_TO") and db.get_state(con, "approved")):
        return False
    try:
        mailer.login_test(settings_from(env).inboxes[0])
        return True
    except Exception:  # noqa: BLE001
        return False


def run(again: bool = False) -> int:
    con = db.connect()
    if not again and already_set_up(con, read_env()):
        print(launchd.install())
        shortcut = desktop_shortcuts()
        print("\nUpdated. Everything was already set up and is still running.")
        print("Your leads folder: %s" % (shortcut or config.leads_inbox()))
        _open_dashboard_soon()
        print("To answer the setup questions again:  rizco setup --again")
        return 0
    print("\nRizcoReach cold email setup. About 5 minutes. Press Enter to accept anything shown in [brackets].")

    # ------------------------------------------------------------------ 1. details
    bold("1 of 5  Your details")
    env = read_env()
    sender_email = env.get("INBOX1_EMAIL") or DEFAULT_SENDER
    print("Emails are sent from %s." % sender_email)
    while True:
        wa = ask("Your WhatsApp number, shown under your name in every email", names.format_whatsapp(env.get("WHATSAPP_NUMBER") or DEFAULT_WHATSAPP))
        if len(re.sub(r"\D", "", wa)) >= 9:
            break
        print("That doesn't look like a phone number. Try again, for example +971501234567.")
    while True:
        test_to = ask("Your own email address, so I can send you ONE test email (not %s)" % sender_email, env.get("TEST_EMAIL_TO", "")).lower()
        if config.EMAIL_RE.match(test_to) and test_to != sender_email:
            break
        print("Use a different address that you can check, like your everyday Gmail.")
    updates = {
        "FROM_NAME": env.get("FROM_NAME") or "Samil",
        "WHATSAPP_NUMBER": "+" + re.sub(r"\D", "", names.format_whatsapp(wa)),
        "TEST_EMAIL_TO": test_to,
        "INBOX1_EMAIL": sender_email,
        "INBOX1_PROVIDER": env.get("INBOX1_PROVIDER") or config.guess_provider(sender_email),
        "SAVE_DRAFTS": env.get("SAVE_DRAFTS") or "yes",
    }
    write_env(updates)
    env = read_env()

    # ------------------------------------------------------------------ 2. App Password
    bold("2 of 5  Connect %s" % sender_email)
    s = settings_from(env)
    if not connect(s.inboxes[0]):
        return 1
    env = read_env()
    s = settings_from(env)
    inbox = s.inboxes[0]

    # ------------------------------------------------------------------ 3. safety checks
    bold("3 of 5  Safety checks")
    rep = dnscheck.check_inbox(inbox)
    if not rep.can_send:
        print("The domain checks did not pass, so nothing will be sent:")
        for c in (rep.spf, rep.dkim):
            if not c.ok:
                print("  %s: %s" % (c.name, " ".join(c.fix)))
        print("Run setup again in a few minutes. If it keeps failing, send Claude the text above.")
        return 1
    db.set_state(con, "dns_ok:" + inbox.key, clock.today().isoformat())
    print("SPF and DKIM pass%s." % (" (Google runs these for gmail.com, nothing for you to add)" if inbox.is_free else ""))
    try:
        from .mailbox import login_test

        login_test(inbox)
        print("Reading replies works (Inbox, Spam and Drafts found).")
    except Exception as e:  # noqa: BLE001
        print("Reading replies did not work: %s" % e)
        print("Run setup again in a minute. If it keeps failing, send Claude the line above.")
        return 1
    if inbox.is_free:
        print("Note: %s is a free Gmail, which spam filters trust less for cold email, so it never sends more than "
              "%d a day. It starts at 5 a day and grows over 4 weeks." % (sender_email, config.FREE_INBOX_CAP))

    # ------------------------------------------------------------------ 4. leads and the test email
    bold("4 of 5  Leads and the test email")
    shortcut = desktop_shortcuts()
    for result in importer.import_pending(con, log=lambda *a: None):
        print("Imported %s:" % result["file"])
        for line in importer.summary_lines(result):
            print(line)
    queued = con.execute("SELECT COUNT(*) FROM leads WHERE status='queued'").fetchone()[0]
    where = shortcut or config.leads_inbox()
    if queued:
        print("%d leads are ready to email." % queued)
    else:
        print("No leads yet. That's fine.")
    print("Whenever you have leads, drop the CSV or Excel file into the \"%s\" folder%s." % (
        where.name, " on your Desktop" if shortcut else " (%s)" % where))
    print("They are picked up within the hour. A Lead Hunter export works as it is.")

    approved = db.get_state(con, "approved")
    if approved:
        print("The test email was already approved on %s." % approved["at"][:10])
    else:
        lead = con.execute("SELECT * FROM leads WHERE status='queued' AND segment IN ('A','B','C') ORDER BY "
                           "CASE segment WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, id LIMIT 1").fetchone()
        subject, body, full = templates.first_email(lead or SAMPLE_LEAD, "A", s)
        print("\nBefore anything goes to a real business, you get one test email to see what they will get:\n")
        print("    Subject: " + subject + "\n")
        print("\n".join("    " + l for l in full.splitlines()))
        print()
        if yes("Send this test email to %s now?" % test_to):
            mid = mailer.new_message_id(inbox)
            try:
                mailer.send(inbox, mailer.build(inbox, s.from_name, test_to, subject, full, mid))
            except mailer.SendError as e:
                print("Sending failed: %s. Run setup again in a minute." % e)
                return 1
            now = clock.now()
            con.execute(
                "INSERT INTO messages(lead_id, inbox, kind, step, to_email, subject, body, message_id, sent_at, sent_date, status) "
                "VALUES(NULL, ?, 'test', 0, ?, ?, ?, ?, ?, ?, 'sent')",
                (inbox.key, test_to, subject, full, mid, clock.iso(now), now.date().isoformat()),
            )
            db.set_state(con, "test_email", {"at": clock.iso(now), "to": test_to, "inbox": inbox.key, "message_id": mid})
            print("\nSent. Open %s now (give it a minute) and find the email \"%s\"." % (test_to, subject))
            if not yes("Is it in your Inbox? (Answer no if it's in Spam or Promotions)"):
                print("Then we wait before emailing businesses. Open the email in Spam, click 'Not spam', and run setup again "
                      "tomorrow to send a new test. If it keeps landing in Spam, the fix is a separate domain for outreach.")
            elif not yes("Does it read right, and is your WhatsApp number correct?"):
                print("Tell Claude what to change. Nothing is sent to businesses until you approve a test.")
            else:
                db.set_state(con, "approved", {"at": clock.iso(), "test": db.get_state(con, "test_email")})
                db.log_event(con, "approved", "approved in setup after test email to %s" % test_to)
                approved = True
                print("Approved. Real sending is switched on: 5 emails a day in week 1.")
        else:
            print("No test sent. Nothing goes to businesses until you send one and approve it (run setup again).")

    # ------------------------------------------------------------------ 5. automatic jobs
    bold("5 of 5  Automatic sending")
    print(launchd.install())
    if launchd.IS_MAC and yes("Should your Mac wake itself at 8:55 on weekdays, so it never misses 9:00? "
                              "It will ask for your Mac login password"):
        r = subprocess.run(launchd.wake_command())
        print("Done: your Mac wakes at 8:55 Dubai time on weekdays." if r.returncode == 0 else
              "That didn't work. It's optional: just keep the Mac on and awake at 9:00 on weekdays.")

    today, now = clock.today(), clock.now()
    in_hours = schedule.is_send_day(today) and bool(schedule.current_window_end(now) or schedule.next_window_start(now))
    started = False
    if approved and queued and in_hours and now >= clock.at(today, 9) and launchd.IS_MAC \
            and yes("Start today's emails now instead of waiting for the next 9:00?"):
        started = launchd.start_now()
        print("Started. Emails go out slowly in the background, a few minutes apart." if started else
              "Couldn't start it. It runs by itself at the next 9:00.")
    first_run = today if schedule.is_send_day(today) and now < clock.at(today, 9) else clock.next_weekday(today + timedelta(days=1))

    bold("All set")
    print("What happens by itself:")
    print("  Mon to Fri from 9:00 Dubai time: the day's emails go out slowly, follow ups included.")
    print("  Every hour: new lead files are imported and replies are checked. When someone is interested,")
    print("  your Mac shows a notification and a drafted answer appears in Gmail Drafts for %s." % sender_email)
    print("  The daily report is in the \"RizcoReach Reports\" folder on your Desktop.")
    if not approved:
        print("\nSending to businesses is still OFF until a test email is approved. Run this setup again for that.")
    elif not queued:
        print("\nNext: drop your first lead file into the RizcoReach Leads folder. The first emails go out on the next weekday at 9:00.")
    else:
        print("\nEmails are going out now." if started else
              "\nFirst emails go out %s at 9:00." % ("today" if first_run == today else clock.nice(first_run)))
    print("\nYour part: drop lead files into the dashboard, answer the interested people, and keep the Mac on.")
    _open_dashboard_soon()
    return 0
