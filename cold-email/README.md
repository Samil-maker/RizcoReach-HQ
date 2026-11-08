# RizcoReach cold email

A small Python program that books website clients by email. You drop a lead list in a folder.
It checks and segments every lead, writes a short personal email for each one, sends them slowly
on a safe daily schedule from your own inbox, follows up twice, reads the replies, and tells you who
is interested, with a drafted answer waiting in your Drafts folder. **You always send the replies yourself.**

It runs on your Mac. Your leads, the database and your passwords never leave it.

```
leads/inbox/*.csv ─▶ import ─▶ data/outreach.db ─▶ send (9:00 to 11:30, 14:00 to 15:30 Dubai)
                                                   │
          reports/YYYY-MM-DD.md ◀─ report ◀─ replies (Inbox and Spam, drafts for you)
```

**Contents:** [1. Python](#step-1-check-python) · [2. Install](#step-2-get-the-code-and-install-it) ·
[3. .env and App Password](#step-3-fill-in-env) · [4. Check](#step-4-run-the-check) ·
[5. Import](#step-5-import-a-small-test-file) · [6. Test email](#step-6-send-one-test-email-to-yourself) ·
[7. Daily job](#step-7-the-automatic-900-job) · [Every day](#every-day-three-commands) ·
[Rules](#the-rules-it-always-follows) · [When something happens](#when-something-happens)

---

## Step 1: check Python

Open **Terminal** (press Cmd+Space, type `Terminal`, press Enter). Type this and press Enter:

```bash
python3 --version
```

You need **3.9 or newer**. If a window pops up offering to install "command line developer tools",
click Install, wait, and run the command again. (Anything that starts with `$` or sits in a grey box
in this guide is something you type into Terminal.)

## Step 2: get the code and install it

Put the project straight in your home folder, **not** in Documents, Desktop or Downloads. macOS blocks
background jobs from those folders, and the 9:00 job (step 7) is a background job.

If you have never downloaded this repository to your Mac:

```bash
cd ~
git clone https://github.com/Samil-maker/RizcoReach-HQ.git
```

Then go into the cold email folder and install (copy one line at a time):

```bash
cd ~/RizcoReach-HQ/cold-email
```

```bash
python3 -m venv .venv
```

```bash
source .venv/bin/activate
```

```bash
pip install -r requirements.txt
```

`.venv` is a private box of Python packages just for this project. **Every time you open a new
Terminal window**, step into the project first:

```bash
cd ~/RizcoReach-HQ/cold-email && source .venv/bin/activate
```

You will see `(.venv)` at the start of the line. That means you are in.

## Step 3: fill in .env

`.env` is the one file that holds your settings and password. It is listed in `.gitignore`, so it is
never uploaded to GitHub. Never paste its contents into a chat or an email.

```bash
cp .env.example .env
```

```bash
open -e .env
```

That opens it in TextEdit. Fill in:

- `WHATSAPP_NUMBER`: your WhatsApp number, for example `+971501234567`. It goes under your name in every email.
- `TEST_EMAIL_TO`: a **different** address you own (your everyday Gmail). The test email goes there, so you can see whether it lands in Inbox or Spam.
- `INBOX1_EMAIL` is already `samilatrizcoreach@gmail.com` and `INBOX1_PROVIDER` is `gmail`.
- `INBOX1_APP_PASSWORD`: see below.

Save (Cmd+S) and close.

### Getting a Gmail App Password (for samilatrizcoreach@gmail.com)

Gmail does not let programs use your normal password. You make a separate 16-letter "App Password"
just for this program. It only works for email, and you can delete it any time.

1. In Chrome, sign in to **samilatrizcoreach@gmail.com** (check the top right corner shows that account).
2. Open <https://myaccount.google.com/security>. Under "How you sign in to Google" click
   **2-Step Verification** and turn it on (it asks for your phone). App Passwords only exist once this is on.
3. Open <https://myaccount.google.com/apppasswords>. Type a name like `RizcoReach outreach` and click **Create**.
4. Google shows 16 letters in four groups. Copy them into `.env` after `INBOX1_APP_PASSWORD=`
   (spaces are fine). Google shows them only once. If you lose them, delete that App Password and make a new one.
5. IMAP (how the program reads replies) is always on for Gmail now. If your Gmail settings still have a
   "Forwarding and POP/IMAP" tab, make sure IMAP is set to **Enable**.

You don't need to type any server names for Gmail. They are filled in for you:
`smtp.gmail.com` port 465 for sending, `imap.gmail.com` port 993 for reading.

If the App Passwords page says the setting "is not available", 2-Step Verification is off, or the account
only uses security keys, or (for work accounts) your admin switched it off.

### ⚠️ About sending from a free @gmail.com address

Cold email from a free Gmail address is a **high spam risk**. Gmail and Outlook trust personal addresses
less for this, a few spam reports can get the account limited, and every email you send says "gmail.com"
rather than a business name. So this program caps a free address at **20 emails a day, whatever you set**.

The fix when you are ready: buy a separate domain only for outreach (something like `getrizcoreach.com`,
not `rizcoreach.ae`, so your main domain's reputation is never at risk) and put a Google Workspace or
paid Zoho Mail inbox on it. Then fill in `INBOX2_...` (or replace inbox 1) and run the check again. It
tells you exactly which DNS records to add.

### If you later use Google Workspace or Zoho Mail

- **Google Workspace** (your own domain): the same App Password steps, signed in as the Workspace
  account. Set `INBOX2_PROVIDER=workspace`. If the App Passwords page is missing, an admin has to allow
  2-Step Verification at admin.google.com > Security > Authentication.
- **Zoho Mail**: only **paid** plans have SMTP and IMAP. The free plan does not, and won't work.
  1. Zoho Mail > Settings (gear) > Mail Accounts > your address > **IMAP Access**: tick it on.
  2. If you use two-factor sign in: accounts.zoho.com > Security > **App Passwords** > Generate New Password.
     Use that as the App Password. Without two-factor, your normal Zoho password works.
  3. Set `INBOX2_PROVIDER=zoho` (servers `smtppro.zoho.com` 465 and `imappro.zoho.com` 993). If you sign in at
     zoho.eu or zoho.in, use `zoho-eu` or `zoho-in`. The exact server names are shown in Zoho Mail >
     Settings > Mail Accounts > SMTP and IMAP. If they differ, put them in `INBOX2_SMTP_HOST` and `INBOX2_IMAP_HOST`.
  4. Zoho may not keep a copy of emails sent this way in Sent. If you want them there, add `INBOX2_SAVE_TO_SENT=yes`.

## Step 4: run the check

```bash
python run.py check
```

It sends nothing. It checks four things and tells you in plain words what to fix:

1. `.env` is filled in (and warns you about the free Gmail).
2. **DNS for your sending domain.** These are public records that prove to other mail servers that your
   emails are really from you:
   - **SPF** lists the servers allowed to send for your domain.
   - **DKIM** is a digital signature on every email.
   - **DMARC** tells receivers what to do with emails that fail those two.

   **Nothing is ever sent until SPF and DKIM pass.** For `gmail.com` Google runs all three, so they pass
   and there is nothing for you to add. With your own domain later, the check prints the exact records to
   add at your domain host (Host, Type, Value), plus the steps in Google Workspace or Zoho to turn on DKIM.
3. **SMTP login**: logs in to Gmail's sending server and logs out again.
4. **IMAP login**: logs in to read replies and finds your Spam, Sent and Drafts folders.

When it ends with `All good`, go on.

## Step 5: import a small test file

Make a CSV or Excel file with 5 to 15 **real** leads (so the email and website checks are real). The column
names don't need to match exactly. Common names are recognised (`Company`, `E-mail`, `Mobile`, `Location`
and so on), and Lead Hunter exports work as they are. There is an empty template in `leads/sample/lead-template.csv`.

| Column | Needed? | Used for |
|---|---|---|
| business_name | yes | the subject and the email |
| email | yes | where it goes (info@ is fine) |
| first_name | no | "Hi Sara" instead of "Hi there" |
| website | no | no website means segment B; a website gets checked |
| instagram | no | "Just the Instagram page" |
| phone | no | shown in the report next to interested leads |
| area | no | "just opened in Al Barsha" |
| source, notes | no | "grand opening", "soft opening", "new branch" and similar make it segment A |
| niche | no | kept for your reference |
| segment | no | force A, B, C or SKIP for a row |

Put the file in `leads/inbox/` (in Finder: Go > Home > RizcoReach-HQ > cold-email > leads > inbox), then:

```bash
python run.py import
```

It trims spaces, lowercases emails, drops duplicates (also two addresses at the same company, and anyone
already imported), drops anyone in `suppression.csv`, checks each email's syntax and that its domain can
receive mail (MX records), and checks every website. The original file moves to `leads/processed/` with a
`.rejected.csv` next to it saying why each skipped row was skipped. You get a short summary.

If it can't find the email or business name column it tells you the column names it sees, and you say
which one it is: `python run.py import --map email="Contact Email"`

Then look at the result:

```bash
python run.py preview
```

It shows every segment with its leads and 3 sample emails each (version A with the price, version B
without), plus the two follow ups, and the skipped leads with the reason.

**How the segments are decided**

- **A, new business**: the source or notes say grand opening, soft opening, just opened, new branch...
- **B, no website**: no website, or the "website" is only Instagram, Linktree, WhatsApp or Google Maps.
- **C, outdated website**: the homepage was fetched and has a real, confirmed problem. The email names
  one: no mobile layout ("It's quite hard to use on a phone"), no HTTPS, a copyright year 3 or more years
  old ("The site still says 2019 at the bottom"), more than 5 seconds to load (measured twice), broken or
  parked, or no way to call or book. Only weaker signs of an old site get the general line ("I think a
  fresh modern version could bring you a lot more enquiries"). It never says anything it didn't see.
- **Skip**: a good modern website, or a site that blocks automated visits (it can't check, so it doesn't
  guess). To email a skipped lead anyway with a line you checked yourself:
  `python run.py mark their@email.com requeue "The site still says 2016 at the bottom"`

## Step 6: send one test email to yourself

```bash
python run.py test-email
```

It shows you the exact email (a real first email for one of your leads), then asks you to type `yes`.
That is the **only** email sent before you approve. It goes to `TEST_EMAIL_TO`, not to the lead.

Then check it:

1. Did it land in **Inbox**, or in Spam or Promotions?
2. In Gmail open it, click the three dots (⋮) at the top right, then **Show original**. SPF, DKIM and
   DMARC should each say **PASS**.
3. Read it like a stranger. Does it look like a quick personal email? Is your WhatsApp number right?

If all is well:

```bash
python run.py approve
```

This starts **week 1 of the warm up**: up to 5 emails a day. See exactly what the first day sends:

```bash
python run.py send --dry-run
```

## Step 7: the automatic 9:00 job

```bash
python run.py launchd install
```

From now on your Mac runs `python run.py send` every Monday to Friday at 9:00 Dubai time. It sends
inside the windows, waits for 14:00 if there is overflow, checks replies along the way, and writes the
day's report when it finishes. The output goes to `logs/send.log`.

**Your Mac has to be on and awake.** The job uses `caffeinate` so the Mac doesn't nap while it sends,
but it can't wake a sleeping Mac. If the Mac is asleep at 9:00, the job runs as soon as it wakes and
sends whatever fits in what is left of the windows (nothing after 15:30). Closing a MacBook's lid
puts it to sleep. To make it wake itself at 8:55 on weekdays (run once, it asks for your Mac password):

```bash
sudo pmset repeat wakeorpoweron MTWRF 08:55:00
```

Check on the job with `python run.py launchd status`, and remove it with `python run.py launchd uninstall`.

---

## Every day: three commands

Open Terminal, step in (`cd ~/RizcoReach-HQ/cold-email && source .venv/bin/activate`), then:

```bash
python run.py send
```
Sends today's emails (the 9:00 job does this for you). Add `--dry-run` to see the plan without sending.

```bash
python run.py replies
```
Reads Inbox and Spam, matches replies to leads, stops their follow ups, puts drafted answers in your
Drafts folder, and lists who is waiting for you.

```bash
python run.py report
```
Writes `reports/YYYY-MM-DD.md` (open it in any text editor, or drag it into Chrome). Interested people
are at the top with their email, phone, segment, what they wrote and your drafted reply. Below that:
sent today and this week per inbox, replies, bounces, reply rate by segment and by A/B version, the
queue. On Fridays (or `--weekly`) it adds a weekly review: what's working, what isn't, what to change.

Handy extras: `python run.py status` (limits, queue, pause) and `python run.py help`.

## The rules it always follows

- **Warm up per inbox**, follow ups included: week 1: 5 a day, week 2: 10, week 3: 18, week 4: 25,
  then 30. A free @gmail.com address never goes above 20. `DAILY_CAP` in `.env` can lower this but never
  raise it. If you ask for more in a hurry it still says no and explains why: sending more before an
  inbox has a track record is the quickest way into spam. 50 a day means two inboxes. Leads are shared
  between them and each keeps its own warm up.
- **Monday to Friday only, Dubai time.** 9:00 to 11:30, overflow 14:00 to 15:30. One email at a time,
  3 to 9 random minutes apart per inbox, inboxes taking turns. Follow ups go first, then new leads
  (new businesses first, since "just opened" goes stale).
- **Sequence:** day 0 first email, day 3 follow up 1, day 7 follow up 2, then it stops. Follow ups are
  replies in the same thread. Any real reply, bounce or opt out stops that lead at once. Out of office
  replies don't stop it: the next email moves to the day after they're back.
- **Copy:** plain text, no links, no images, no tracking, under 80 words, no dashes or semicolons, ending
  with the opt out line. Every email is checked before sending, and one that fails isn't sent.
- **A/B test:** in each segment half get version A (shows 480 AED) and half version B (no price). After
  100 sends each, the report says which wins and suggests the next idea to test.
- **Automatic pause** (nothing more is sent until you run `python run.py resume`): bounces over 3% of a
  day's emails, any reply mentioning spam or reporting, or the mail server refusing our mail or login.
  At 5 emails a day a single bounce is 20%, so in week 1 any bounce pauses. That's on purpose.
- **suppression.csv:** anyone who says no, stop, unsubscribe or not interested, every hard bounce, and
  anyone you add. Never emailed again. You can open it in Numbers or Excel and add rows yourself. A row
  like `@domain.com` blocks a whole company.
- **Never:** the care plan in cold emails, demo sites called client work, made up clients or numbers,
  or a reply sent for you.

## When something happens

| It says or you see | Do this |
|---|---|
| `SENDING PAUSED: ...` | Read the reason in the report or with `python run.py status`. Fix it (often a bad lead file), then `python run.py resume` |
| Someone is interested | Open the report, check the draft in your Drafts folder, fill in any [brackets], send it yourself |
| You answered on WhatsApp instead | `python run.py mark their@email.com handled` |
| They became a client | `python run.py mark their@email.com client` |
| A reply was put in the wrong group | `python run.py mark their@email.com interested` (or question, not-now, no) |
| Someone asks you to stop by phone | `python run.py suppress their@email.com` |
| You want different wording | Edit `outreach/templates.py` (or ask Claude), then `python run.py preview` |
| Another send is already running | The 9:00 job is still going. Let it finish |
| `It's Saturday in Dubai` | Correct: no weekend emails |

## Where things are

| Path | What |
|---|---|
| `run.py` | every command starts here |
| `.env` | your settings and App Password (never committed) |
| `leads/inbox/` | drop new lead files here |
| `leads/processed/` | imported files, plus why rows were skipped |
| `data/outreach.db` | the database: leads, every email, every reply (SQLite) |
| `suppression.csv` | never email these again |
| `reports/` | daily reports |
| `logs/send.log` | what the 9:00 job did |
| `outreach/templates.py` | all email wording |
| `outreach/` | the rest of the program, one file per job |

`data/`, `leads/`, `reports/`, `logs/` and `suppression.csv` stay on your Mac only (they are in `.gitignore`).
Time Machine backs them up. If you move to a new Mac, copy the whole `cold-email` folder.

## Tests

```bash
pip install pytest && python -m pytest
```

The tests run full sending days against a fake mail server and a fake clock. They never send a real email.
