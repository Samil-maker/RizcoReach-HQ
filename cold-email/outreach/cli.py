"""The commands behind  python run.py <command>.  Run  rizco help  for the list."""
from __future__ import annotations

import argparse
import sys
import time
from typing import List, Optional

from . import clock, config, db, dnscheck, importer, launchd, mailer, names, replies, report, safety, schedule, segment
from . import actions, sender, suppression, templates
from .config import Settings

SEG = report.SEGMENT_NAMES


def ask(question: str) -> bool:
    try:
        return input(question + " ").strip().lower() in ("y", "yes")
    except EOFError:
        return False


def settings_or_exit(require_ok: bool = False) -> Settings:
    s = config.load_settings()
    if require_ok and s.problems:
        print("Fix these in .env first:")
        for p in s.problems:
            print("  - " + p)
        sys.exit(1)
    return s


# ----------------------------------------------------------------------------- check

GMAIL_LOGIN_HELP = (
    "Gmail refused the login. Almost always this means the App Password is wrong or missing:\n"
    "      1. Your Google account must have 2-Step Verification turned on\n"
    "      2. Make an App Password at https://myaccount.google.com/apppasswords (README step 3)\n"
    "      3. Paste the 16 letters into INBOX1_APP_PASSWORD in .env (not your normal password)"
)


def cmd_check(args) -> int:
    s = config.load_settings()
    con = db.connect()
    print("Checking your setup. Nothing is sent.\n")
    print("1. Settings in .env")
    print("   From name:        %s" % s.from_name)
    print("   WhatsApp number:  %s" % (names.format_whatsapp(s.whatsapp) or "(empty)"))
    print("   Test emails go to: %s" % (s.test_email_to or "(empty: set TEST_EMAIL_TO)"))
    for i in s.inboxes:
        print("   %s: %s via %s, App Password %s" % (i.key, i.email, i.label, config.mask(i.password)))
        print("      sending: %s:%s   replies: %s:%s" % (i.smtp_host, i.smtp_port, i.imap_host, i.imap_port))
    for w in s.warnings:
        print("\n   WARNING: " + w)
    for p in s.problems:
        print("\n   PROBLEM: " + p)
    all_ok = not s.problems

    for n, inbox in enumerate(s.inboxes, start=2):
        print("\n%d. DNS for %s (SPF and DKIM must pass before anything is sent)" % (n, inbox.domain))
        rep = dnscheck.check_inbox(inbox)
        for c in (rep.spf, rep.dkim, rep.dmarc):
            status = "PASS" if c.ok else ("MISSING" if c.name == "DMARC" else "FAIL")
            print("   %-5s %-7s %s" % (c.name, status, c.found[:110]))
            for line in c.fix:
                print("            " + line)
        if rep.managed and rep.can_send:
            print("   %s is Google's own domain: Google publishes these records and signs your emails. Nothing for you to add." % inbox.domain
                  if inbox.is_google else "   %s is your provider's domain: nothing for you to add." % inbox.domain)
        if rep.lookup_failed:
            print("   Some DNS lookups did not answer. Check your internet connection and run this again.")
        if rep.can_send:
            db.set_state(con, "dns_ok:" + inbox.key, clock.today().isoformat())
        else:
            all_ok = False

        print("\n   SMTP login (sending), sends nothing:")
        if not inbox.password:
            print("   SKIPPED: no App Password yet")
            all_ok = False
        else:
            try:
                print("   PASS   " + mailer.login_test(inbox))
            except mailer.SendError as e:
                all_ok = False
                print("   FAIL   %s" % e)
                if inbox.is_google and e.kind == "auth":
                    print("      " + GMAIL_LOGIN_HELP)
                elif e.kind == "network":
                    print("      Check the server name and port, and that you are online.")
            print("\n   IMAP login (reading replies):")
            try:
                from .mailbox import login_test

                print("   PASS   " + login_test(inbox))
            except Exception as e:  # noqa: BLE001
                all_ok = False
                print("   FAIL   %s" % e)
                if "refused the login" in str(e) and inbox.is_google:
                    print("      " + GMAIL_LOGIN_HELP)
                    print("      If the password is right: Gmail > Settings > See all settings > Forwarding and POP/IMAP > Enable IMAP")
                elif "could not reach" in str(e):
                    print("      Check the server name and port, and that you are online.")

    print()
    if all_ok:
        db.set_state(con, "check_ok", clock.iso())
        print("All good. Next: drop a lead file in leads/inbox/ and run  rizco import")
    else:
        print("Fix the items above, then run  rizco check  again.")
    return 0 if all_ok else 1


# ----------------------------------------------------------------------------- import and preview

def parse_maps(values: Optional[List[str]]) -> dict:
    out = {}
    for v in values or []:
        if "=" not in v:
            raise SystemExit('--map needs field="Column name", for example --map email="Contact Email"')
        k, h = v.split("=", 1)
        k = k.strip().lower()
        if k not in importer.FIELDS:
            raise SystemExit("--map: unknown field %r. Fields: %s" % (k, ", ".join(importer.FIELDS)))
        out[k] = h.strip().strip('"')
    return out


def cmd_import(args) -> int:
    con = db.connect()
    if not importer.pending_files():
        print("No files in your RizcoReach Leads folder (%s)." % config.leads_inbox())
        print("Put a .csv or .xlsx file there and run this again. If you just dropped one in, the hourly job may")
        print("have imported it already: rizco status shows how many leads are waiting.")
        return 0
    overrides = parse_maps(args.map)
    results = importer.import_pending(con, log=print, overrides=overrides, check_sites=not args.no_site_check,
                                      campaign=args.campaign)
    for result in results:
        for line in importer.summary_lines(result):
            print(line)
    if not results:
        print("The hourly job imported those files a moment ago. rizco status shows how many leads are waiting.")
    print("\nNext: look at the segments and sample emails with  rizco preview")
    return 0


def cmd_preview(args) -> int:
    s = config.load_settings()
    con = db.connect()
    segments = [args.segment.upper()] if args.segment else list(report.SEGMENTS)
    shown_followups = False
    for seg in segments:
        leads = con.execute("SELECT * FROM leads WHERE segment=? AND status='queued' ORDER BY id", (seg,)).fetchall()
        print("\n" + "#" * 72)
        print("Segment %s: %d leads waiting" % (SEG[seg], len(leads)))
        for l in leads[:12]:
            print("  - %-28s %-32s %s" % (l["business"][:28], l["email"][:32], l["segment_reason"] or ""))
        if len(leads) > 12:
            print("  ... and %d more" % (len(leads) - 12))
        for n, lead in enumerate(leads[: args.count]):
            variant = "AB"[n % 2]
            subject, body, full = templates.first_email(lead, variant, s)
            problems, warnings = templates.lint(subject, body, full, 0)
            print("\n" + "-" * 72)
            print("Sample %d, version %s (%s), to %s, %d words" % (n + 1, variant, "with price" if variant == "A" else "no price",
                                                                  lead["email"], templates.word_count(body)))
            print("Subject: %s\n" % subject)
            print(full)
            if problems:
                print("\n  !! would not be sent: " + ", ".join(problems))
            if warnings:
                print("  (style note: %s)" % ", ".join(warnings))
        if leads and not shown_followups:
            shown_followups = True
            lead = leads[0]
            for step in (1, 2):
                body, full = templates.follow_up(lead, step, s)
                print("\n" + "-" * 72)
                print("Follow up %d (day %d, same thread, subject Re: ...), for %s" % (step, schedule.FOLLOW_UP_DAYS[step], lead["business"]))
                print(full)
                print("\n(the first email is quoted underneath, like a normal reply)")
    skipped = con.execute("SELECT * FROM leads WHERE segment='SKIP' ORDER BY id DESC LIMIT 15").fetchall()
    if skipped and not args.segment:
        print("\n" + "#" * 72)
        print("Skipped (not emailed):")
        for l in skipped:
            print("  - %-28s %-30s %s" % (l["business"][:28], (l["website"] or "")[:30], l["segment_reason"]))
        print("  To email one anyway:  rizco mark their@email.com requeue")
        print('  or with a line you checked yourself:  rizco mark their@email.com requeue "The site still says 2016 at the bottom"')
    if s.problems:
        print("\nNote: " + " ".join(s.problems))
    return 0


# ----------------------------------------------------------------------------- test email and approval

SAMPLE_LEAD = {"segment": "B", "business": "Glossy PPF", "first_name": "", "area": "Al Quoz", "source": "Google Maps",
               "instagram": "", "observation": "", "address": "", "business_name": "Glossy PPF"}


def cmd_test_email(args) -> int:
    s = settings_or_exit(require_ok=True)
    con = db.connect()
    inbox = s.inbox(args.inbox) if args.inbox else s.inboxes[0]
    if not inbox:
        print("No inbox called %s in .env" % args.inbox)
        return 1
    to = (args.to or s.test_email_to).strip().lower()
    if not to:
        print("Put your own address in TEST_EMAIL_TO in .env (or use --to you@example.com).")
        return 1
    rep = dnscheck.check_inbox(inbox)
    if not rep.can_send:
        print("SPF and DKIM must pass before anything is sent. Run  rizco check  to see what to fix.")
        return 1
    lead = con.execute("SELECT * FROM leads WHERE status='queued' AND segment IN ('A','B','C') ORDER BY "
                       "CASE segment WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, id LIMIT 1").fetchone()
    subject, body, full = templates.first_email(lead or SAMPLE_LEAD, "A", s)
    problems, _ = templates.lint(subject, body, full, 0)
    if problems:
        print("The sample email fails its checks: " + ", ".join(problems))
        return 1
    print("This is the test email. It is a real first email%s, sent only to you.\n"
          % (" for %s" % lead["business"] if lead else " for a made up business"))
    print("From: %s <%s>\nTo: %s\nSubject: %s\n" % (s.from_name, inbox.email, to, subject))
    print(full)
    print()
    if not ask("Send this ONE real email from %s to %s? Type yes to send:" % (inbox.email, to)):
        print("Not sent.")
        return 0
    mid = mailer.new_message_id(inbox)
    msg = mailer.build(inbox, s.from_name, to, subject, full, mid)
    try:
        mailer.send(inbox, msg)
    except mailer.SendError as e:
        print("Sending failed: %s" % e)
        if inbox.is_google and e.kind == "auth":
            print(GMAIL_LOGIN_HELP)
        return 1
    now = clock.now()
    con.execute(
        "INSERT INTO messages(lead_id, inbox, kind, step, to_email, subject, body, message_id, sent_at, sent_date, status) "
        "VALUES(NULL, ?, 'test', 0, ?, ?, ?, ?, ?, ?, 'sent')",
        (inbox.key, to, subject, full, mid, clock.iso(now), now.date().isoformat()),
    )
    db.set_state(con, "test_email", {"at": clock.iso(now), "to": to, "inbox": inbox.key, "message_id": mid})
    db.log_event(con, "test_email", to, inbox=inbox.key)
    print("\nSent. Now check it:")
    print("  1. Open %s and find the email. Is it in the Inbox, or in Spam or Promotions?" % to)
    print("  2. In Gmail open it, click the three dots at the top right, then Show original.")
    print("     SPF, DKIM and DMARC should each say PASS. (In other apps look for 'View source'.)")
    print("  3. Read it like a stranger would. Does it look like a quick personal email?")
    own = next((i for i in s.inboxes if i.email == to and i.has_imap), None)
    if own:
        print("\nLooking for it in %s (this takes about 20 seconds)..." % to)
        time.sleep(20)
        print("  " + _find_test(own, mid))
    print("\nIf it all looks right, run:  rizco approve")
    return 0


def _find_test(inbox, message_id: str) -> str:
    import email
    from email import policy

    from .mailbox import Mailbox

    try:
        with Mailbox(inbox) as mb:
            for folder in ["INBOX"] + [f for f in [mb.special("\\Junk")] if f]:
                if not mb.select(folder):
                    continue
                uids = mb.search("HEADER", "Message-ID", '"%s"' % message_id)
                if uids:
                    raw = mb.full(uids[-1]) or b""
                    msg = email.message_from_bytes(raw, policy=policy.default)
                    auth = " ".join(str(msg.get("Authentication-Results") or "").split())
                    where = "the Inbox" if folder == "INBOX" else "SPAM (%s)" % folder
                    return "Found it in %s.%s" % (where, (" Authentication: " + auth[:300]) if auth else
                                                  " (No authentication details: normal when you email yourself. Check Show original.)")
    except Exception as e:  # noqa: BLE001
        return "Could not look for it automatically (%s). Check by hand." % e
    return "Not found yet. Give it a minute and look by hand."


def cmd_approve(args) -> int:
    con = db.connect()
    test = db.get_state(con, "test_email")
    if not test:
        print("Send the test email first:  rizco test-email")
        return 1
    if db.get_state(con, "approved"):
        print("Already approved on %s." % db.get_state(con, "approved")["at"][:10])
        return 0
    print("The test email went to %s on %s." % (test["to"], test["at"][:16].replace("T", " at ")))
    if not ask("Did it land in the Inbox (not Spam), with SPF and DKIM showing PASS? (yes/no)"):
        print("\nThen don't start yet. If it went to Spam: mark it 'Not spam', wait a day, and send another test.")
        print("A free @gmail.com address often lands in spam for cold email. A separate domain with its own inbox fixes this.")
        return 1
    if not ask("Does the email read right, and is your WhatsApp number correct? (yes/no)"):
        print("Change the wording in outreach/templates.py or your details in .env, then send another test.")
        return 1
    db.set_state(con, "approved", {"at": clock.iso(), "test": test})
    db.log_event(con, "approved", "campaign approved after test email to %s" % test["to"])
    s = config.load_settings()
    print("\nApproved. Real sending is switched on:")
    for i in s.inboxes:
        lim = schedule.limits(con, i, clock.today())
        print("  %s: %s" % (i.email, lim["why"]))
    print("\nPreview the first day:   rizco send --dry-run")
    print("Start sending:           rizco send   (or let the 9:00 job do it, see README step 7)")
    return 0


# ----------------------------------------------------------------------------- daily commands

def cmd_send(args) -> int:
    s = config.load_settings()
    con = db.connect()
    run = sender.SendRun(con, s, dry_run=args.dry_run, limit=args.limit)
    if args.dry_run:
        run.run()
        return 0
    if args.limit is not None:
        print("Sending at most %d emails today (the daily limit still applies)." % args.limit)
    with sender.Lock():
        sender.log("Send started. Leave this window open, or let the 9:00 job run it. Ctrl+C stops it safely.")
        try:
            run.run()
        except KeyboardInterrupt:
            sender.log("Stopped by you. %d emails were sent. Run send again any time today to carry on." % run.sent)
    return 0


def cmd_replies(args) -> int:
    s = config.load_settings()
    con = db.connect()
    if not any(i.has_imap for i in s.inboxes):
        print("No inbox with an App Password in .env yet.")
        return 1
    print("Checking replies (Inbox and Spam)...")
    found = replies.check_all(con, s)
    if not found:
        print("  No new replies.")
    waiting = con.execute("SELECT * FROM leads WHERE waiting_on_me=1 ORDER BY replied_at").fetchall()
    if waiting:
        print("\nWaiting for your reply:")
        for l in waiting:
            print("  - %-10s %s (%s) %s" % (l["reply_class"], l["business"], l["email"], l["phone"] or ""))
        print("\nThe full replies and drafted answers are in the report:  rizco report")
    p = safety.paused(con)
    if p:
        print("\nSENDING IS PAUSED: %s" % p["reason"])
    return 0


def cmd_report(args) -> int:
    s = config.load_settings()
    con = db.connect()
    path = report.write(con, s, weekly=True if args.weekly else None)
    waiting = con.execute("SELECT reply_class, COUNT(*) AS n FROM leads WHERE waiting_on_me=1 GROUP BY reply_class").fetchall()
    print("Report written: %s" % path)
    if waiting:
        print("Waiting for your reply: " + ", ".join("%d %s" % (r["n"], r["reply_class"]) for r in waiting))
    else:
        print("Nobody is waiting for your reply.")
    return 0


def cmd_status(args) -> int:
    s = config.load_settings()
    con = db.connect()
    today = clock.today()
    p = safety.paused(con)
    print("Sending: %s" % ("PAUSED, %s" % p["reason"] if p else "approved" if db.get_state(con, "approved") else
                           "not approved yet (test-email, then approve)"))
    for i in s.inboxes:
        lim = schedule.limits(con, i, today)
        print("%s: %s. Sent today %d." % (i.email, lim["why"], lim["sent"]))
    f = schedule.forecast(con, s.inboxes)
    print("Together: up to %d a day. %s" % (f["today"], ", ".join(
        "%d a day: %s" % (t, clock.nice(d) if hasattr(d, "day") else d) for t, d in f["reach"].items())))
    for row in con.execute("SELECT status, COUNT(*) AS n FROM leads GROUP BY status ORDER BY n DESC"):
        print("  %-11s %d" % (row["status"], row["n"]))
    checked = db.get_state(con, "replies_checked")
    print("Replies last checked: %s" % (checked[:16].replace("T", " ") if checked else "never"))
    print("Daily job: " + launchd.status().splitlines()[0])
    return 0


def cmd_resume(args) -> int:
    con = db.connect()
    p = safety.paused(con)
    if not p:
        print("Sending is not paused.")
        return 0
    print("Paused since %s because: %s" % (p["at"][:16].replace("T", " "), p["reason"]))
    if p.get("detail"):
        print(p["detail"])
    if not ask("\nHave you looked into it and want to start sending again? Type yes:"):
        print("Still paused.")
        return 0
    safety.resume(con)
    print("Resumed. The next send run carries on where it left off.")
    return 0


MARKS = actions.MARKS


def cmd_mark(args) -> int:
    con = db.connect()
    ok, message = actions.mark(con, args.email, args.what, args.note)
    print(message)
    return 0 if ok else 1


def cmd_suppress(args) -> int:
    con = db.connect()
    new = suppression.add(con, args.email, args.reason or "added by you")
    print("%s %s the suppression list." % (args.email, "added to" if new else "was already on"))
    return 0


def cmd_launchd(args) -> int:
    if args.action == "show":
        print(launchd.plist())
        return 0
    if args.action == "status":
        print(launchd.status())
        return 0
    if args.action == "uninstall":
        print(launchd.uninstall())
        return 0
    for w in launchd.warnings():
        print("WARNING: " + w + "\n")
    print(launchd.install())
    print("\nImportant: the job only runs if your Mac is on and awake at 9:00 (if it was asleep, it runs as soon as it")
    print("wakes, and sends whatever fits in what is left of the windows). Keep it plugged in with the lid open.")
    print("To make the Mac wake itself at 8:55 on weekdays, run once:")
    print("  sudo pmset repeat wakeorpoweron MTWRF 08:55:00")
    return 0


def cmd_setup(args) -> int:
    from . import setup_wizard

    try:
        return setup_wizard.run(again=getattr(args, "again", False))
    except KeyboardInterrupt:
        print("\nStopped. Run the same setup line again any time: it keeps what is already done.")
        return 1


def cmd_auto(args) -> int:
    """The hourly job: new lead files, replies, report, notifications. Quiet when there is nothing new."""
    s = config.load_settings()
    con = db.connect()
    try:
        lock = sender.Lock("auto")
        lock.__enter__()
    except SystemExit:
        return 0
    try:
        sender.log("Hourly check")
        for result in importer.import_pending(con, log=sender.log):
            st = result["stats"]
            for line in importer.summary_lines(result):
                sender.log(line.strip())
            if st["imported"]:
                launchd.notify("RizcoReach: %d new leads imported" % st["imported"],
                               "A %d, B %d, C %d, skipped %d. They go out from the next 9:00 run."
                               % (st["seg_A"], st["seg_B"], st["seg_C"], st["seg_SKIP"]))
        from . import warmup

        try:
            warmup.run(con, s, log=sender.log)
        except Exception as e:  # noqa: BLE001 - the warm up never stops replies or imports
            sender.log("Warm up skipped this hour: %s" % e)
        if s.problems or not any(i.has_imap for i in s.inboxes):
            sender.log("Settings incomplete, not checking replies: " + " ".join(s.problems))
        elif sender.Lock.held("send"):
            sender.log("The 9:00 send is running and checks replies itself.")
        else:
            found = replies.check_all(con, s, log=sender.log)
            hot = [r for r in found if r["label"] in ("interested", "question")]
            if hot:
                who = ", ".join(r.get("business") or r["lead"] for r in hot[:3])
                more = " and %d more" % (len(hot) - 3) if len(hot) > 3 else ""
                launchd.notify("RizcoReach: %s%s replied" % (who, more),
                               "Your drafted answer is in Gmail Drafts. Check it and press Send.")
        report.write(con, s)
        from . import updater

        if updater.due(con) and not sender.Lock.held("send"):
            sender.log(updater.update(con, log=sender.log))
    finally:
        lock.__exit__(None, None, None)
    return 0


def _open_folder(path, name: str) -> int:
    import subprocess

    from . import setup_wizard

    path.mkdir(parents=True, exist_ok=True)
    setup_wizard.desktop_shortcuts()
    print("%s: %s" % (name, path))
    if launchd.IS_MAC:
        subprocess.run(["open", str(path)])
        print("It's open in Finder now. Tip: drag that folder into the Finder sidebar for one click access.")
    return 0


def cmd_leads(args) -> int:
    print("Drop CSV or Excel lead files in here. They are imported within the hour.")
    return _open_folder(config.leads_inbox(), "Your leads folder")


def cmd_reports(args) -> int:
    return _open_folder(config.reports_dir(), "Your reports folder")


def cmd_add_inbox(args) -> int:
    from . import setup_wizard

    try:
        return setup_wizard.add_inbox()
    except KeyboardInterrupt:
        print("\nStopped. Nothing was added.")
        return 1


def cmd_dashboard(args) -> int:
    from . import dashboard

    if args.serve:
        dashboard.serve()
        return 0
    return dashboard.open_dashboard()


def cmd_update(args) -> int:
    from . import updater

    print(updater.update(db.connect()))
    return 0


# ----------------------------------------------------------------------------- entry

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="rizco", description="RizcoReach cold email. Everyday commands: send, replies, report.")
    sub = p.add_subparsers(dest="command")
    sp = sub.add_parser("setup", help="the one time setup, as a few questions (safe to run again)")
    sp.add_argument("--again", action="store_true", help="ask the questions again even if everything works")
    sp = sub.add_parser("dashboard", help="open the dashboard in your browser (http://localhost:8321)")
    sp.add_argument("--serve", action="store_true", help="run the dashboard service (the background job does this)")
    sub.add_parser("add-inbox", help="add another sending inbox (new ones warm up for 14 days first)")
    sub.add_parser("leads", help="open the folder where you drop lead files")
    sub.add_parser("reports", help="open the folder with the daily reports")
    sub.add_parser("update", help="get the latest version now (it also updates itself once a day)")
    sub.add_parser("auto", help="what the hourly job runs: new lead files, replies, report")
    sub.add_parser("check", help="check .env, DNS (SPF/DKIM/DMARC) and the SMTP and IMAP logins. Sends nothing")
    sp = sub.add_parser("import", help="import the lead files in leads/inbox/")
    sp.add_argument("--map", action="append", metavar='FIELD="Column"', help='say which column is which, e.g. --map email="Contact Email"')
    sp.add_argument("--no-site-check", action="store_true", help="skip the website checks (leads with a website become Skip)")
    sp.add_argument("--campaign", choices=["auto", "website", "ads"], default="auto",
                    help="website or ads (Meta ads). auto: Lead Hunter's Meta ads export is ads, the rest website")
    sp = sub.add_parser("preview", help="show the segments and sample emails")
    sp.add_argument("--segment", choices=["A", "B", "C", "N", "G", "a", "b", "c", "n", "g"])
    sp.add_argument("--count", type=int, default=3)
    sp = sub.add_parser("test-email", help="send ONE real test email to yourself (asks first)")
    sp.add_argument("--to")
    sp.add_argument("--inbox", help="inbox1, inbox2...")
    sub.add_parser("approve", help="after the test email looked right: allow real sending")
    sp = sub.add_parser("send", help="send today's emails slowly (use --dry-run to preview)")
    sp.add_argument("--dry-run", action="store_true", help="show exactly what would be sent today, send nothing")
    sp.add_argument("--limit", type=int, help="send fewer than the daily limit today")
    sub.add_parser("replies", help="check the inbox for replies, stop sequences, draft answers")
    sp = sub.add_parser("report", help="write today's report to reports/")
    sp.add_argument("--weekly", action="store_true", help="include the weekly review (added on Fridays anyway)")
    sub.add_parser("status", help="limits, queue and pause state at a glance")
    sub.add_parser("resume", help="start sending again after an automatic pause")
    sp = sub.add_parser("mark", help="record what happened with a lead: " + ", ".join(MARKS))
    sp.add_argument("email")
    sp.add_argument("what", help=", ".join(MARKS))
    sp.add_argument("note", nargs="?", help='with requeue: your own true line about their site, in quotes')
    sp = sub.add_parser("suppress", help="never email this address (or @domain.com) again")
    sp.add_argument("email")
    sp.add_argument("reason", nargs="?")
    sp = sub.add_parser("launchd", help="the Mac job that sends at 9:00 on weekdays: install, uninstall, status, show")
    sp.add_argument("action", choices=["install", "uninstall", "status", "show"])
    sub.add_parser("help")
    return p


COMMANDS = {
    "setup": cmd_setup, "auto": cmd_auto, "add-inbox": cmd_add_inbox, "dashboard": cmd_dashboard, "leads": cmd_leads, "reports": cmd_reports, "update": cmd_update,
    "check": cmd_check, "import": cmd_import, "preview": cmd_preview, "test-email": cmd_test_email,
    "approve": cmd_approve, "send": cmd_send, "replies": cmd_replies, "report": cmd_report, "status": cmd_status,
    "resume": cmd_resume, "mark": cmd_mark, "suppress": cmd_suppress, "launchd": cmd_launchd,
}


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command or args.command == "help":
        parser.print_help()
        print("\nEvery day:  rizco send   rizco replies   rizco report")
        return 0
    return COMMANDS[args.command](args) or 0
