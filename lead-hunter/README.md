# Lead Hunter (Chrome extension)

Two lead finders in one extension:

- **Website leads** (*New hunt* tab): businesses already running Meta ads.
  The ones **without a website** get the Website script. Described first, below.
- **Meta ads clients** (*Meta ads* tab): businesses on Google Maps, each
  checked in the Meta Ad Library. The ones with a website and **no** Meta ads
  get the Ads script. See [Meta ads clients](#meta-ads-clients).

WhatsApp is never sent for you. Every bubble is typed in for you (or copied),
and you press Send. Email can be sent for you, from your own Gmail and slowly:
see [Email sender](#email-sender).

## Two scripts, picked for you

| The lead | Script | Tag |
| --- | --- | --- |
| No website (either tab) | Website script | *No website* |
| Website down or parked (either tab) | Website script, saying their site wasn't loading | *Site down* |
| Website, and the Ad Library check found no Meta ads | Ads script | *No Meta ads* |
| Website, Ad Library check not done yet | Ads script, with a note in the lead panel | *Ad check not done* |
| Working website and running ads (every website lead with one, or a Meta ads business the check found advertising) | none: skipped | *Running ads* |

Skipped leads are not deleted. They are left out of phone mode and the phone
queue, and hidden from the list while they are New; tick **Show skipped
(running ads)** to see them. Leads you are already talking to (contacted,
replied, meeting booked…) always show. In the lead panel, **Pitch anyway
(website script)** is the one override; the panel then reminds you to edit
the line that says they have no website.

`{{business}}` is the name the way you'd type it: *Dr. Smile Dental Clinic -
Best Dentist in Dubai* becomes *Dr. Smile Dental Clinic*, and *AL NOOR SALON
L.L.C* becomes *Al Noor Salon*. The saved name is not changed. With no name
it uses their Instagram handle or domain, else *Hello there* and "your business".

Each script has three parts, sent as three WhatsApp bubbles: greeting
(*Hello Glossy PPF*), the message, and the closing (*Let me know*). Set
**Settings → Message bubbles** to 2 to send the greeting and the message
together. Edit both scripts in **Settings → Scripts**. Variables:
`{{business}}`, `{{niche}}`, `{{city}}`, `{{found_on}}` (Google Maps,
Instagram, or Facebook and Instagram), `{{website_line}}` ("couldn't find a
website for you", or "your website wasn't loading when I checked" when it is
down), `{{my_name}}`, `{{agency}}`, `{{my_phone}}`.

**Niches** are one list for both tabs (Settings → Niches): a name and its
search keywords. Write the name the way it reads in a message (*Car detailing
studios* becomes "We help car detailing studios in Dubai…"). Website leads
get their niche from the keywords they were found with.

Row tags (*No website*, *Site down*, *Good reviews* for 4.0★ and 25+ Google
reviews, *Growing* for fewer reviews, *Running ads*) are for sorting and filtering; they never change the
message.

## Install (2 minutes)

1. Download this repo (GitHub → Code → Download ZIP) and unzip it, or `git pull`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `lead-hunter` folder.
5. Pin it: puzzle icon in the toolbar → pin **RizcoReach Lead Hunter**.

The dashboard opens automatically. Go to **Settings** and add your name so it
appears in your pitches. Works in Chrome, Edge and Brave.

To update after pulling new code: `chrome://extensions` → the reload icon on
the Lead Hunter card. Your leads are kept.

## Your first hunt

1. Dashboard → **New hunt** → click a niche (for example *Car detailing
   studios*), or type your own keywords, one per line.
2. Pick the country and how many **new** leads you want (default 150).
3. Optional filters:
   - *Ads running at least 30 days*: steady spenders with budget.
   - *Ads running at most 14 days*: businesses that just started advertising.
   - *Skip pages with more than 60,000 likes*: leaves out big brands.
4. Click **Start hunt**. A Facebook Ad Library tab opens and scrolls through
   every keyword by itself. **Keep that tab on screen**; Chrome slows down
   background tabs. A small panel in the corner shows progress.
5. Leads appear in the dashboard live. Each website is checked automatically.

You can also just browse the Ad Library yourself: every result you scroll past
is saved, with no hunt running.

## Working the leads

- **Sort by priority** (default). Priority is 0 to 100: more active ads, ads
  running longer, a worse (or missing) website, a phone number found, and not
  a big brand all push it up. Hot is 70+.
- Click a row to open the lead. You get the bubbles, every phone number with
  where it came from, their Instagram and email, and their live ads.
- **WhatsApp**: one box per bubble. **Open bubble 1 in WhatsApp** opens
  WhatsApp (Web or the desktop app) with just that bubble typed in; press
  Send there, then open bubble 2, then 3. Every bubble of a lead loads in the
  same WhatsApp tab. After the last one the lead is marked *Contacted* (with
  an undo). **Mark as sent** does the same by hand.
- **Instagram**: the same bubbles with Copy buttons, and a link to their
  profile when Lead Hunter found one. **Email**: the first email and the
  follow ups, with **Add to email queue** (see [Email sender](#email-sender))
  or **Open in Gmail** to send it yourself.
- When they answer, press **Replied** on the row (press again to undo). Track
  the rest with the status column: Follow up, Meeting booked, Won, Not
  interested, Skip. Add notes in the lead panel.
- **Results** (top of both tabs) shows sent, replied and reply rate by niche
  and by script, across every lead.
- **Export CSV** gives you everything in the current view for Google Sheets,
  including Instagram and email.

## Sending from your phone

Three ways, from no setup to most powerful:

1. **Scan a QR code.** Every lead with a number has a QR code under its
   bubbles, with 1 / 2 / 3 buttons to pick the bubble. Point your phone's
   camera at it and tap the link: WhatsApp opens **on your phone** with
   their number and that bubble typed in. Press send, switch to the next
   bubble, then press **Mark as sent**. Click the code to make it bigger.
2. **Phone mode.** Press **Phone mode** above the lead list (or select
   leads first). One lead at a time, one big QR code per bubble: scan, send
   on your phone, press **Enter** for the next bubble. After the last
   bubble the lead is marked *Contacted* and the next lead comes up.
   Shift+Enter goes back a bubble, the arrow keys skip leads, Esc closes.
3. **Phone queue.** Select leads, press **Send to phone queue**, and they
   appear on a private page on your phone (`rizcoreach.ae/outreach`) with
   one button per bubble. Tap 1, send, come back, tap 2, and so on; each
   tapped bubble gets a tick. Tapping the last bubble files the lead under
   *Sent*, which syncs back to the dashboard and marks it *Contacted*
   (within a minute). Marking a lead contacted on the computer ticks it off
   on the phone too.

### Setting up the phone queue (once, about 2 minutes)

The queue lives on your own Netlify site, so the latest site code must be
deployed first (it adds `/api/lead-queue` and `/outreach`).

1. Lead Hunter → **Settings** → **Phone queue** → **Generate a key** →
   **Copy key**.
2. Netlify → your site → **Site configuration → Environment variables** →
   add `LEAD_QUEUE_KEY` with that key. Then **Deploys → Trigger deploy**.
3. Back in Settings, press **Save & test connection**. It should say
   *Connected*.
4. Scan the pairing QR code that appears with your phone and open the link.
   On iPhone tap **Share → Add to Home Screen** (on Android: menu → **Add to
   Home screen**) so it opens like an app.

The key is the only thing protecting the queue: keep it private, and
generate a new one (and update Netlify) if it ever leaks. The page is not
indexed by Google and the key never leaves your devices except to talk to
your own site.

**Tip:** if you have both WhatsApp and WhatsApp Business on your phone,
check which one opens on your first send. Android usually asks; on iPhone
the link may go to the app you don't send from.

## Email sender

Lead Hunter can send your cold emails for you, for free, from the Gmail you
already have. It is slow on purpose so your Gmail stays in good standing.

Select leads and press **Send to email queue** (or **Add to email queue** in a
lead's Email tab). A small script in your own Google account picks them up
from your site every 5 minutes and sends one email at a time. Chrome does not
need to be open.

Each lead gets up to 3 emails:

1. The first email: the lead's script in one message.
2. Follow up 1, three working days later, as a reply in the same thread.
3. Follow up 2, four working days after that.

Every email ends with your signature and a line saying they can reply no
thanks. Change the subjects, the follow ups, the signature and how many follow
ups in **Settings → Email sender**. The first email always matches the script.

### Setting up the email sender (once, about 5 minutes)

It uses the same key as the phone queue, so [set that up](#setting-up-the-phone-queue-once-about-2-minutes) first.

1. Lead Hunter → **Settings** → **Email sender** → **Copy sender script**.
   It has your site and key filled in, so keep it private.
2. Open **script.google.com** and sign in with the Gmail you want to send from.
3. Click **New project**.
4. Delete what's there and paste the script.
5. Click **+** next to Services, pick **Gmail API**, then **Add**.
6. Pick **setup** at the top and press **Run**, then **Allow**. Google warns
   the app isn't verified because it's your own script: click **Advanced**,
   then **Go to**.

The status in Settings then says *Running*. To stop sending press **Pause
sending** in Settings, or pick **stop** in the script and press **Run**.

### Limits

- Only Monday to Friday, 9 to 6 Dubai time, and at least 10 minutes apart.
- A new sender starts slow: 5 a day in the first week, 10 in the second, 20
  in the third. After that your daily limit decides (default 30, at most 40).
  Free Gmail allows about 500 a day. Staying far below that is the point.

### Safety rules

- Plain text emails with no tracking.
- A reply stops the follow ups and marks the lead *Replied*. A reply that says
  stop, unsubscribe, no thanks or not interested also puts them on the never
  email list.
- Nobody is emailed twice, and nobody on the never email list is emailed at
  all (people who opted out, bounced addresses and leads you marked **Never
  email**).
- A bounced address is marked on the lead and never used again. If 3 of the
  last 30 first emails bounce, sending pauses until you press **Resume
  sending**.
- If Gmail says you hit its daily limit, sending pauses until midnight Dubai time.
- Setting a lead to Replied, Meeting booked, Won, Not interested or Skip stops
  its follow ups. So does **Stop emails** in the lead's Email tab.
- Leads skipped for running ads are never emailed.

## Meta ads clients

The **Meta ads** tab finds businesses to sell Meta ads to. It does not start
from the Ad Library on purpose: a business that is already advertising will
just say "I already run ads". Instead it works in three steps.

1. **Finds businesses on Google Maps** for a niche and the areas you tick
   (for example "ceramic coating in Al Quoz, Dubai"):
   - with a **Places API key** (Settings) the search runs in the background,
     up to 60 businesses per search term and area;
   - **without a key**, Lead Hunter opens Google Maps in a tab, scrolls the
     results list and reads every listing (name, rating, reviews, phone,
     website). Keep that tab open while it runs.
2. **Checks each website** with the same audit as website leads, which also
   finds their Facebook page, WhatsApp number and email.
3. **Checks the Meta Ad Library for each business**, in a background tab,
   one business every few seconds:
   1. the live ads on their Facebook page (found through the link on their
      website);
   2. a search for their website address, which catches ads run from a
      different page;
   3. a search for their name. A page with a merely similar name does not
      count; it needs the same website, phone number or (almost) exactly the
      same name.

| Verdict | What it means | Script (with a website) |
| --- | --- | --- |
| **Not running ads** | Their Facebook page was found and has 0 live ads. Confirmed. | Ads script |
| **No ads found** | No Facebook page to check, and nothing matched their website, phone or name. Very likely not advertising, not certain. | Ads script |
| **Running ads** | Live ads matched to them. | Skipped (hidden by default) |
| **Couldn't check** | The Ad Library didn't load or asked you to log in. Press **Check again**, or open the search link and look. | Ads script, marked *Ad check not done* |

Businesses without a working website get the Website script whatever the verdict.
You can overrule any verdict in the lead panel (**They don't run ads** /
**They do run ads**).

The list is sorted by priority: not advertising, plenty of Google reviews and
a good rating (proof of demand), a mobile or WhatsApp number, and a website
all push it up.

**Niches built in:** Car detailing studios, Aesthetic clinics, Dental clinics
and Beauty salons. Add or change them in **Settings → Niches**. Businesses
with long sales cycles or restricted ads (renovation, fit-out, real estate,
plastic surgery, weight-loss injections, mobile car wash and so on) are left
out of the list; find them under **Niche → Skipped (long sales cycle)**.

The scripts never claim past clients or results. Keep it that way until you
have real ones: UAE consumer protection law bans misleading claims, and an
invented result is the fastest way to lose a deal. If Google Maps lists an
Instagram profile as their website, it is saved as their Instagram instead.

Phone mode, the phone queue, QR codes, statuses, notes and **Export CSV**
work the same as for website leads.

**Places API cost.** A Text Search that returns phone numbers and websites is
billed at Google's Enterprise rate: about 1,000 free requests a month, then
roughly $35 per 1,000 (check current pricing). Each request returns up to 20
businesses. Lead Hunter counts requests and stops at the monthly limit in
Settings (default 950). After that, remove the key to search in a tab
instead, or raise the limit.

## Where phone numbers come from

In order of how reliable they are:

1. **WhatsApp ads**: the number the "Send WhatsApp message" button goes to.
2. **The website**: tap-to-call and WhatsApp buttons, then any number in the
   page text, then the homepage and contact page if the landing page has none.
3. **Google Maps** (optional, needs a Places API key): matched by business
   name, only used when the name is a confident match.
4. **The ad text**: numbers written in the ad copy.

You can always add a number by hand in the lead panel.

## What the website check looks at

HTTPS, mobile viewport, server response and load time, page weight,
render-blocking scripts, Meta Pixel, Google Tag Manager, tap-to-call /
WhatsApp buttons, enquiry or booking form, copyright year, title, meta
description, H1, amount of text, image alt text, link preview image, favicon,
schema markup, parked / "coming soon" pages, and which builder the site uses
(Wix, WordPress, Shopify, GoDaddy and so on).

It checks the exact page the ads link to, because that is what people who
click see. Sites behind a bot wall (Cloudflare and similar) show a grey **?**
instead of a score, so you never pitch a "broken site" that isn't broken.
Some sites load the Meta Pixel through Google Tag Manager, where it can't be
seen in the page code; those are marked "not visible (GTM)" instead of
"missing".

## Optional Google keys

PageSpeed Insights is free. Places is part of Google Maps Platform: it needs a
billing account on the Google Cloud project and comes with a monthly free
allowance, so check current pricing before heavy use.

- **Places API (New)**: finds phone numbers and websites on Google Maps, plus
  the star rating and review count.
- **PageSpeed Insights API**: adds Google's own mobile speed score (slow:
  20 to 60 seconds per site, so it is off by default and available per lead
  as a button).

Google Cloud Console → APIs & Services → enable the API → Credentials →
Create API key. Paste it in Settings. Keys stay in this browser and are left
out of backups.

## Outreach tips

- Send by hand, with a real edit or two per message. WhatsApp restricts
  numbers that send the same text to lots of people who haven't saved them,
  so keep the daily volume modest and vary the wording. This is also why
  WhatsApp has no auto send: you press Send on every bubble.
- Watch **Results**: if one niche or script gets far fewer replies, change
  that script and compare.
- Follow up once after 2 to 3 days, then move on. Set the status to *Follow up*.
- Leads with **no website** and ads going straight to WhatsApp are often the
  easiest yes: offer a free homepage mockup.

## Good to know

- Lead Hunter only reads the public Ad Library pages you load and the public
  websites of advertisers. Meta's terms restrict automated collection, so the
  auto-scroll runs at a human pace (adjustable in Settings). A few hunts a day
  is plenty; using a separate Chrome profile keeps your main account clear of
  any rate limits.
- The Meta ads tab reads Google Maps and the Ad Library in normal browser
  tabs, at a human pace. Google's and Meta's terms also restrict automated
  collection, so search a few niches and areas a day rather than whole
  cities at once, and use a separate Chrome profile (and Facebook account)
  for it. Lead Hunter does not search Instagram automatically.
- Leads are stored only in this Chrome profile. Use **Settings → Download
  backup** before removing the extension or switching computers.
- If Meta changes the Ad Library and collection stops (the corner panel stays
  at 0 while results are on screen), the parser needs an update.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Manifest V3; content scripts on `facebook.com/ads/library*` and `google.com/maps*` |
| `content/hook.js` | Runs in the page; mirrors the Ad Library's GraphQL responses to the extension |
| `content/adlib.js` | Collects ads (network data, embedded first page, visible cards as fallback), corner panel, auto-scroll |
| `lib/extract-ads.js` | Finds ad records in any Ad Library JSON (keys on `ad_archive_id`) |
| `lib/site-audit.js` | Website audit and contact extraction (same checks as `netlify/functions/audit.mts`, plus ad-specific ones) |
| `lib/common.js` | Phones, links, priority score, niches, scripts and bubbles, tags, results, CSV |
| `background.js` | Lead storage, hunts, enrichment queue, Google lookups |
| `finder.js` | Meta ads tab: Google Maps search (Places API or a Maps tab) and the Ad Library check queue |
| `lib/prospects.js` | Prospect de-duplication keys, Places results, matching ads to a business |
| `content/maps-hook.js` · `content/maps.js` | Read Google Maps search results (network data plus the visible list) |
| `dashboard/prospects.js` | The Meta ads tab UI |
| `dashboard/` · `popup/` | The UI |
| `lib/qr.js` · `lib/vendor/qrcode.js` | QR codes (vendored qrcode-generator, MIT) |
| `../netlify/functions/lead-queue.mts` | Phone queue API on the site (`/api/lead-queue`, Netlify Blobs) |
| `email/sender.gs` | The email sender: an Apps Script that runs in your Google account (copied from Settings) |
| `../netlify/functions/email-queue.mts` | Email queue API on the site (`/api/email-queue`): every sending rule lives here |
| `../public/outreach.html` | The phone page (`/outreach`) |

Tests:

```bash
node --test lead-hunter/test/*.test.mjs   # parsers, audit, scoring, scripts, bubbles and emails, niches, results, phone queue API, Meta ads prospects
node lead-hunter/test/e2e.mjs   # real Chromium + mock Ad Library, Google Maps, Places API, websites, phone page and email queue (needs Playwright + openssl)
```
