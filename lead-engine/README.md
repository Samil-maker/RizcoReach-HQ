# RizcoReach Lead Engine

Finds businesses **without a website**, keeps only their **mobile numbers**, and
puts them in a Google Sheet. From there they go into Google Contacts, and a
WhatsApp panel helps you message them.

It all lives inside one Google Sheet (Google Apps Script). There's no server and
nothing to install.

```
 Searches tab                 Leads tab                     Google Contacts
 "ladies salon" + "Al Barsha"  ─►  +971501234567  Noor Salon  ─►  "Lead - Noor Salon"
        │                          (no website, mobile only,        (label: RizcoReach Leads,
        ▼                           never duplicated)                syncs to your phone)
 Google Maps / HERE  ──────────►        │
 Import tab (any list) ────────►        ▼
                                 WhatsApp panel: opens each chat with your message typed in
```

## One-time setup (about 15 minutes)

### 1. Create the sheet and add the code

1. Sign in to the Google account whose **Contacts** the leads should go into, and
   create a new sheet at [sheets.new](https://sheets.new). Name it something like
   *RizcoReach Leads*.
2. In the sheet: **Extensions → Apps Script**.
3. In Apps Script, click **⚙ Project Settings** (left bar) and tick
   **Show "appsscript.json" manifest file in editor**.
4. Go back to the **Editor** (`< >` icon) and make three files:
   - **`appsscript.json`**: replace everything in it with
     [`apps-script/appsscript.json`](apps-script/appsscript.json). This turns on
     Google Contacts access and sets the time zone to Dubai.
   - **`Code.gs`**: replace everything in it with
     [`apps-script/Code.gs`](apps-script/Code.gs).
   - Click **+** next to *Files* → **HTML**, name it exactly **`Outreach`**, and
     replace its contents with [`apps-script/Outreach.html`](apps-script/Outreach.html).
5. Press **Ctrl/Cmd + S** to save. Then reload the Google Sheet tab. A
   **Lead Engine** menu appears after a few seconds.
6. Click **Lead Engine → Set up / repair tabs**. Google asks for permission:
   **Continue** → pick your account → *"Google hasn't verified this app"* →
   **Advanced** → **Go to … (unsafe)** → **Allow**. This warning is normal for a
   script you wrote yourself. It only runs in your account.

You now have four tabs: **Leads**, **Searches**, **Import** and **Settings**.

### 2. Get a Google Places API key

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a
   project (e.g. *RizcoReach Leads*).
2. **Billing**: link a billing account. Google asks for a card even though you
   start on the free allowance (see [Costs](#costs)).
3. **APIs & Services → Library**: search for **Places API (New)** and click **Enable**.
   Make sure it's the *(New)* one.
4. **APIs & Services → Credentials → Create credentials → API key**. Then open the
   key, set **API restrictions → Restrict key → Places API (New)**, and save.
5. Recommended: **Billing → Budgets & alerts**. Create a small budget (e.g. $10)
   so you get an email if you ever go past the free allowance.
6. Paste the key into the **Settings** tab, next to **Google Places API key**.

### 3. (Optional) HERE API key

HERE is a second business directory (it powers many car navigation systems), and
it lists mobile numbers separately. Sign up at
[platform.here.com](https://platform.here.com), create an app, generate an
**API key**, and paste it into **Settings → HERE API key**. Then set a search's
**Sources** to *HERE* or *Google Maps + HERE*.

## Daily use

### Find leads

1. In the **Searches** tab, add one row per **keyword + area**, typed the way you
   would search on Google Maps: `ladies salon` + `Al Barsha, Dubai`.
   Example rows are already there for you to edit or delete.
   - Google returns at most **60 businesses per search**, so use small areas
     (Al Barsha, JLT, Deira, Al Nahda…) rather than "Dubai". More rows means more
     leads.
2. Click **Lead Engine → Find leads now**.
3. The **Result** column shows what happened to each search, for example:
   `57 found · 20 have a website · 25 no mobile · 3 already saved · 9 new`.

A row runs once and is then marked **Done**. To run it again, clear its
**Status** cell. If you tick **Repeat daily** and turn on
**Lead Engine → Run searches every morning**, the row runs again every day at
about 9am (Dubai time) and picks up businesses that are new on Google Maps. The
morning run also copies new leads to Google Contacts.

If a run needs more than about 5 minutes (Google's limit for scripts), it
carries on by itself a minute later.

### The Leads tab

| Column | What it is |
| --- | --- |
| **Mobile** | International format (`+971501234567`). The same number is never added twice. |
| Business, Category, Address, Map | Kept so you know who you're talking to. You can hide these columns if you don't need them. |
| Found by | The search (or *Import*) that found the lead |
| In Contacts | `Yes` once the lead is in Google Contacts |
| WhatsApp | Tap **Chat** to open WhatsApp with your message already typed |
| Status | New → Messaged → Replied → Interested / Not interested / Do not contact |
| Last contacted | Filled in automatically when the status becomes *Messaged* |

What counts as **no website**: the business has no website on its listing, or
its "website" is only an Instagram, Facebook, Linktree, WhatsApp, Fresha,
Talabat or similar page. Those are good leads for a website agency. Set
**Treat Instagram / Facebook / booking pages as no website** to `NO` if you
disagree. Closed businesses are always skipped.

What counts as a **mobile**: UAE numbers starting `05`. Mobile prefixes are also
built in for Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Egypt, Jordan, Lebanon,
India, Pakistan, the UK and Australia. Many businesses list only a landline on
Google Maps, so expect a fair number of *no mobile* skips.

### Google Contacts

New leads are copied to Google Contacts automatically. You can also do it any
time with **Lead Engine → Copy new leads to Google Contacts**. Each one is saved
as **"Lead - Business name"** under the label **RizcoReach Leads**, with the
search and address in the notes. If your phone syncs this Google account's
contacts, the leads show up in your phone and in WhatsApp under those names.

- Leads marked *Do not contact* are never copied.
- One Google account can hold up to 25,000 contacts.
- To remove them all later: [contacts.google.com](https://contacts.google.com) →
  label *RizcoReach Leads* → select all → delete.

### Lists from other platforms (Import tab)

Paste any list into the **Import** tab, with a header row and one business per
row. This could be an export from another lead tool, a directory you're allowed
to use, an exhibitor list, or your own spreadsheet. Then click
**Lead Engine → Add the Import tab to Leads**. The same rules apply: no website,
mobile only, no duplicates. A **Lead Engine result** column shows what happened
to each row, and rows that already have a result are skipped next time.

Columns are recognised by their header: *phone / mobile / whatsapp / tel*,
*name / title / business / company*, *website / site*, *category*, *address*,
and *url / maps link*.

## WhatsApp outreach

**Lead Engine → WhatsApp outreach panel** opens a side panel showing the next
*New* lead, with your message ready and editable. Click **Open in WhatsApp**:
the chat opens in WhatsApp Web or Desktop with the text typed in, and you press
send. The lead is marked *Messaged*. **Skip for now** and **Do not contact** do
what they say. After the number of chats set in **WhatsApp chats per day**
(default 30), the panel warns you to stop for the day.

On your phone, open the Google Sheets app, tap **Chat** in the WhatsApp column,
send, then set the Status to *Messaged*.

To change the message, edit **Settings → WhatsApp message**. You can use the
placeholders `{name}`, `{area}`, `{keyword}` and `{category}`. Then run
**Lead Engine → Refresh WhatsApp links**.

### Why it doesn't send the messages by itself

Tools that make WhatsApp send cold messages automatically (bots driving
WhatsApp Web, "bulk sender" extensions) break WhatsApp's terms. WhatsApp detects
lots of first messages to people who haven't saved your number, and it bans the
number, often within days. The official WhatsApp Business Platform can send
automatically, but its policy only allows business-initiated messages to people
who have **opted in**. Cold numbers from Google Maps haven't. The UAE also
regulates marketing calls and messages, so honour opt-outs and keep the
*Do not contact* list. Pressing send yourself, with a daily cap, keeps your
number alive and keeps you on the right side of all of this.

Tips that help your reply rate and keep your number safe:

- Use the **WhatsApp Business app** on a separate number, with a logo, a
  description and your website filled in.
- Start with 20–40 new chats a day and increase slowly. Personalise the opening
  line.
- Keep the STOP line in the message and mark those leads *Do not contact*.
- Once someone replies, they've opted in. At that point an automated follow-up
  through the official WhatsApp Business Platform (Cloud API) is allowed, and
  it can be added to this system later.

## Costs

| Item | Cost |
| --- | --- |
| Google Sheets, Apps Script, Google Contacts | Free |
| Google Places API (Text Search with phone & website) | **1,000 requests/month free**, then about **$35 per 1,000 requests**. One request returns up to 20 businesses, so the free allowance scans up to ~20,000 businesses a month. Check the [current pricing](https://developers.google.com/maps/billing-and-pricing/pricing). |
| HERE | Has a free monthly allowance. See HERE's pricing page. |

**Settings → Max Google requests per month** (default **1,000**) pauses Google
searches when this sheet reaches that number in a calendar month. The search
rows show *Paused* until next month or until you raise the cap. Google's free
allowance is shared by everything on the same billing account. The counter only
knows about this sheet, so keep the budget alert from step 2.5 as a backstop.

## Which platforms are covered

| Source | How | Notes |
| --- | --- | --- |
| **Google Maps** | Built in, through Google's official Places API | Best coverage in the UAE |
| **HERE** | Built in, through HERE's official API | A separate directory. Good for extra coverage. |
| **Anything else** | Import tab | Exports from other tools, directories, spreadsheets |
| Instagram, Facebook, LinkedIn, Dubizzle, Yellow Pages… | Not built in | Their terms forbid scraping, they block accounts and IPs, and scrapers for them break constantly. If you buy a list from a provider, paste it into the Import tab. |

## Troubleshooting

| You see | Fix |
| --- | --- |
| No **Lead Engine** menu | Reload the sheet and wait a few seconds |
| `API key not valid` | Copy the key again into Settings, with no spaces |
| `Places API (New) has not been used in project … or it is disabled` | Enable **Places API (New)** on the same project as the key, then wait 5 minutes |
| `…requires billing to be enabled` | Link a billing account to the Cloud project |
| Search status **Paused** | The monthly Google cap was reached. See [Costs](#costs). |
| `Turn on the People API` | Redo step 1.4 (appsscript.json), or in Apps Script click **Services +** → *People API* → **Add** |
| Search status **Error** | Read the Result column. Error rows are retried on the next run. |

## For developers

- `apps-script/Code.gs`: all logic (sources, phone and website rules, Contacts,
  outreach, sheet setup)
- `apps-script/Outreach.html`: the WhatsApp side panel
- `test/run-tests.mjs`: runs `Code.gs` in Node against an in-memory sheet with
  mocked Google Places, HERE and People APIs. Run it with
  `node lead-engine/test/run-tests.mjs`. Nothing to install.

The request and response shapes for Google come from the Places API (New)
discovery document. The HERE shapes follow HERE's Geocoding & Search v7 docs.
Neither has been run against the live APIs with real keys, so check the first
real search's Result column.
