# RizcoReach cold email

Books website clients by email. You drop lead lists in a folder. Your Mac checks and segments every lead,
writes a short personal email for each one, sends them slowly on a safe schedule from
samilatrizcoreach@gmail.com, follows up twice, reads the replies, and tells you who is interested with a
drafted answer waiting in Gmail Drafts. **You always send the replies yourself.**

Everything runs on your Mac. Your leads, the database and your password never leave it.

---

## Get it running (once, about 10 minutes)

**1. Open Terminal.** Press Cmd+Space, type `Terminal`, press Enter.

**2. Paste this line and press Enter:**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Samil-maker/RizcoReach-HQ/main/cold-email/setup.sh)"
```

If a window asks to install "command line developer tools", click **Install** and wait. The setup carries on by itself.

**3. Answer the questions.** It asks for:

- your WhatsApp number (press Enter to keep the one from rizcoreach.ae)
- your own email address, for one test email
- a **Gmail App Password**: it opens the right Google page and tells you what to click
  (sign in as samilatrizcoreach@gmail.com, turn on 2-Step Verification if asked, name it RizcoReach, copy the 16 letters, paste)
- whether the test email landed in your **Inbox** (not Spam) and reads right
- whether your Mac should wake itself at 8:55 on weekdays (it asks for your Mac password)

That's it. It updates itself once a day (outside sending hours, and only to a version whose tests pass).
Pasting the same line again also updates it right away, without asking the questions again.

## Your part after that

- **Leads:** drop CSV or Excel files into the **RizcoReach Leads** folder on your Desktop. Can't find it? Open
  a new Terminal window and type `rizco leads`: it opens the folder (it lives in
  `~/RizcoReach-Outreach/cold-email/leads/inbox`) and puts the shortcut back on your Desktop. Lead Hunter exports
  work as they are. Files are imported within the hour.
- **Replies:** when your Mac shows "... replied", open samilatrizcoreach@gmail.com, go to **Drafts**, check the
  drafted answer (fill in anything in [brackets]) and press Send. Tip: add that account to the Gmail app on your
  phone so you see replies the moment they arrive.
- **The Mac:** on, plugged in, lid open 9:00 to 18:00 on weekdays (you can use it as normal). If it sleeps, sending
  pauses and catches up when it wakes. Whatever doesn't fit before 18:00 goes first the next weekday.
- **More emails a day:** make a new Gmail account, then type `rizco add-inbox` and follow the questions. Each
  inbox adds up to 20 a day once it's warmed up. The report shows the date you'll reach 50 and 100 a day.
- **If it ever says "sending paused":** read why in the report (RizcoReach Reports folder on your Desktop), fix
  it, then paste: `rizco resume`

## What happens by itself

| When | What |
|---|---|
| Once a day, evenings or weekends | Updates itself to the latest version, if its tests pass |
| Every hour | New lead files are imported, cleaned and segmented. Replies are checked (All Mail and Spam), sequences stop for anyone who replied, answers are drafted into Gmail Drafts, the report is updated, and you get a notification for interested people |
| Mon to Fri 9:00 to 18:00 Dubai time | The day's emails go out one at a time, spread over the day (more between 10 and 12 and between 1 and 3, when owners read email), inboxes taking turns, follow ups first |
| Every hour, 9:00 to 18:00 | Warm up: your inboxes swap a few normal emails, open them, rescue any from Spam, reply, and file them in a "RizcoReach Warmup" folder |
| Every send | SPF and DKIM must pass, the email must pass the style checks, and the daily warm up limit must have room |
| Fridays | The report adds a weekly review: what's working, what isn't, what to change |

---

## Reference

### Shortcut commands

Type these in any Terminal window (the setup added the `rizco` command).

```bash
rizco report
```
Writes today's report now (it also updates every hour by itself).

| Command | What it does |
|---|---|
| `rizco add-inbox` | adds another sending inbox (brand new ones warm up for 14 days first) |
| `rizco leads` | opens the folder where you drop lead files |
| `rizco reports` | opens the folder with the daily reports |
| `rizco status` | limits, queue, pause state at a glance |
| `rizco send --dry-run` | shows exactly what the next send would email, sends nothing |
| `rizco preview` | every segment with 3 sample emails each, plus the follow ups |
| `rizco replies` | checks replies now instead of waiting for the hour |
| `rizco resume` | starts sending again after an automatic pause |
| `rizco mark their@email.com handled` | you answered them on WhatsApp instead of email |
| `rizco mark their@email.com client` | they became a client (counted in the report) |
| `rizco mark their@email.com interested` | fix a reply that was put in the wrong group (also question, not-now, no) |
| `rizco suppress their@email.com` | never email them again (also `@domain.com` for a whole company) |
| `rizco mark their@email.com requeue "It's quite hard to use on a phone"` | email a skipped lead, with a line you checked yourself |
| `rizco update` | gets the latest version now (it also does this by itself daily) |
| `rizco setup --again` | the setup questions again |
| `rizco help` | everything else |

(In a Terminal window that was already open during setup, type the full path instead: `~/RizcoReach-Outreach/cold-email/rizco report`.)

### How leads are segmented

- **A, new business:** the source or notes say grand opening, soft opening, just opened, new branch and so on.
- **B, no website:** no website, or the "website" is only Instagram, Linktree, WhatsApp or Google Maps.
- **C, outdated website:** the homepage was checked and has a real, confirmed problem, and the email names one:
  no mobile layout ("It's quite hard to use on a phone"), no HTTPS, a copyright year 3 or more years old
  ("The site still says 2019 at the bottom"), over 5 seconds to load (measured twice), broken or parked, or no
  way to call or book. Weaker signs of an old site get a general line ("I think a fresh modern version could
  bring you a lot more enquiries"). It never claims anything it didn't see.
- **Skip:** a good modern website, or a site that blocks automated visits (it can't check, so it doesn't guess).

The import also trims spaces, lowercases emails, drops duplicates (including two addresses at one company and
anyone imported before), drops anyone in `suppression.csv` or marked Replied, Meeting booked, Won, Not
interested or Skip in Lead Hunter, and checks every email's syntax and MX records. Each imported file moves to
`leads/processed/` with a `.rejected.csv` saying why each skipped row was skipped.

Columns are matched by name (`Company`, `E-mail`, `Mobile`, `Location`, and so on). Useful ones: business_name,
email (both needed), first_name, website, instagram, phone, niche, area, source, notes, segment (forces A, B, C or SKIP).
There is an empty template in `leads/sample/lead-template.csv`.

### The rules it always follows

- **Warm up per inbox**, follow ups included: week 1: 5 a day, week 2: 10, week 3: 18, week 4: 25, then 30.
  A free @gmail.com address never goes above 20. `DAILY_CAP` in `.env` can lower this, never raise it.
  More a day means more inboxes: leads are shared and each keeps its own limits.
- **Brand new inboxes** only warm up for their first 14 days, then start cold email at 5 a day. Every inbox keeps
  a little warm up going (about 4 a day) once there are two or more.
- **Monday to Friday only, Dubai time:** spread from 9:00 to 17:45, never two emails from one inbox within 3
  minutes or two from any inbox within a minute. Follow ups first, then new leads (new businesses first, since
  "just opened" goes stale).
- **Sequence:** day 0, day 3 follow up, day 7 follow up, then stop. Follow ups reply in the same thread. Any real
  reply, bounce or opt out stops that lead. Out of office replies push the next email to the day after they're back.
- **Copy:** plain text, no images, no tracking, no links in the first email (follow up 1 carries your portfolio
  link), first emails under 80 words, no dashes or semicolons, ends with the
  opt out line. All wording lives in `outreach/templates.py`.
- **A/B test:** half of each segment gets version A (shows 480 AED), half version B (no price). After 100 sends
  each, the report names the winner and suggests the next test.
- **Automatic pause** (until `rizco resume`): bounces over 3% of a day's emails, a reply that mentions spam or
  reporting, or Gmail refusing our mail or login. At 5 a day one bounce is 20%, so in week 1 any bounce pauses.
- **suppression.csv:** everyone who said no, every hard bounce, anyone you add. Never emailed again.
- **Never:** the care plan in a cold email, demo sites called client work, made up clients or numbers, or a reply sent for you.

### About sending from free @gmail.com addresses

Cold email from a free Gmail is a high spam risk: filters trust personal addresses less for this, and a few spam
reports can get the account limited. That's why each one is capped at 20 a day. Google's rules for free Gmail
also don't allow bulk unsolicited email or using several accounts to get around sending limits, so the more free
accounts you add, the bigger the chance one gets suspended. Keep each one at its limit, give each its own
recovery details, and keep things you can't lose (like your portfolio folder) out of them.

The cheap way past this: a separate domain only for outreach (about $10 a year, not rizcoreach.ae, so your main
domain is never at risk) with Zoho Mail Lite inboxes (about $1 an inbox a month; the free Zoho plan has no
SMTP or IMAP), 30 a day each. Add each with `rizco add-inbox`; it prints the exact SPF, DKIM and DMARC records
to add at your domain host.

- **Google Workspace:** App Password the same way (signed in as that account), `INBOX2_PROVIDER=workspace`.
- **Zoho Mail (paid plans only, the free plan has no SMTP or IMAP):** Settings > Mail Accounts > IMAP Access on,
  an App Password from accounts.zoho.com > Security > App Passwords, `INBOX2_PROVIDER=zoho` (or `zoho-eu`,
  `zoho-in` if you sign in at zoho.eu or zoho.in).

### Where things are

Everything lives in `~/RizcoReach-Outreach/cold-email/`:

| Path | What |
|---|---|
| `.env` | settings and App Password (only your user can read it, never uploaded) |
| `leads/inbox/` | the RizcoReach Leads folder on your Desktop points here |
| `reports/` | the RizcoReach Reports folder on your Desktop points here |
| `data/outreach.db` | every lead, email and reply |
| `suppression.csv` | never email these again |
| `logs/` | what the background jobs did |
| `outreach/templates.py` | all email wording |

Your data folders are never uploaded to GitHub. Time Machine backs them up.

### Tests

```bash
cd ~/RizcoReach-Outreach/cold-email && .venv/bin/pip install pytest && .venv/bin/python -m pytest
```

They run full sending days against a fake mail server and a fake clock, and never send a real email.
