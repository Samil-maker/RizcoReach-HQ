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
- **Google Contacts** saves the same leads as a Google Contacts file: the
  business name as the contact name, the WhatsApp number first, all in a
  *RizcoReach leads* label. Import it at contacts.google.com (Import) and
  WhatsApp on your phone shows each business by name. Leads without a phone
  or an email are left out.

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
- It starts at 15 a day in the first week and 25 in the second. After that
  your daily limit decides (default 30, at most 40). This pace suits a Gmail
  account that has been in normal use for a while.
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

1. **Finds businesses on Google Maps** for a **preset** (Car, Fitness, Pets,
   Accountants, Used Cars, or your own). Each preset has keywords, exclude
   words, a Google review range and an area list, all edited in Settings (one
   item per line) and importable or exportable as JSON. A run works through
   every keyword × area pair in order, searched as "{keyword} {area}" (for
   example "ppf Al Quoz Industrial Area 3, Dubai"), one at a time:
   - **Searches this run** caps a run (100 by default). Pause, Resume and
     Stop are on the progress bar. Finished pairs are remembered per preset,
     so the next run carries on where the last one stopped (**Start over**
     forgets them).
   - **Filters while it searches:** the review count is read from the results
     list, so a listing outside the preset's range is never opened or saved.
     A business whose name or Google category has an exclude word is dropped
     too (whole words only; a `category: word` line only checks the
     category). The progress bar shows the before and after of every run:
     *"8 found → 3 kept · 1 under 5 reviews · 1 over 150 reviews · 3 excluded
     words"*.
   - **Tags on every lead:** Mobile, Landline or Corporate (600 and 800
     numbers) from its phone, and Chain when the same name appears more than
     once, the name says "branch", or Maps lists it more than once. **Mobile
     only** and **Hide chains** filter them.
   - The script's `{{niche}}` is the preset's "In your messages" wording and
     `{{city}}` comes from the lead's area ("Al Nahda, Sharjah" reads as
     Sharjah).
   - with a **Places API key** (Settings) the search runs in the background,
     up to 60 businesses per search term and area;
   - **without a key**, Lead Hunter opens Google Maps in a tab, scrolls the
     results list and reads every listing (name, rating, reviews, phone,
     website). Keep that tab open while it runs.
2. **Checks each website** with the same audit as website leads, which also
   finds their Facebook page, WhatsApp number and email.
3. **Checks the Meta Ad Library for each business with a website**, in a
   background tab, one business every few seconds. It searches the UAE
   (country AE) for live **and** past ads, so a business that stopped
   advertising shows up too. Businesses without a website get the website
   script whatever their ads, so their check is skipped ("Not needed") unless
   you tick **Check the Ad Library for businesses without a website too** in
   Settings > Collecting, or press **Check again** on one:
   1. every ad their Facebook page ran (found through the link on their
      website);
   2. a search for their website address, which catches ads run from a
      different page;
   3. a search for their name. A page with a merely similar name does not
      count; it needs the same website, phone number or (almost) exactly the
      same name.

   Only the first ads of a long history load. When none of those is live but
   there are more, the check asks for the live ones on their own before it
   says "ran before".

| Verdict | Status in exports | What it means | Script (with a website) |
| --- | --- | --- | --- |
| **Ran ads before** | `ran_before_inactive_now` | Ads matched to them, none live now. Shows when the last one stopped. Your warmest ads prospects: they already paid for ads once. | Ads script |
| **Never ran ads** | `never_ran` | Their Facebook page was found and has never run ads in the UAE. Confirmed. | Ads script |
| **No ads found** | `never_ran` (not certain) | No Facebook page to check, and nothing matched their website, phone or name. | Ads script |
| **Running ads** | `active_now` | Live ads matched to them. Shows when the newest started. | Skipped (hidden by default) |
| **Couldn't check** | blank | The Ad Library didn't load. Press **Check again**, or open the search link and look. | Ads script, marked *Ad check not done* |

The Meta ads CSV has `meta_ad_status` and `last_ad_date` columns.
Businesses without a working website get the Website script whatever the verdict.
You can overrule any verdict in the lead panel (**They never ran ads** /
**They ran ads before** / **They do run ads**).

**Login walls and blocks.** If the Ad Library asks you to log in, or shows a
checkpoint, a captcha or a "temporarily blocked" page, the checks pause at
that business, the extension icon shows a red **!**, Chrome shows a
notification, and the Meta ads tab says what happened. Nothing tries to get past
it. Sort it out in the tab yourself, then press **Resume**. Google Maps works the
same way: a consent or "unusual traffic" page pauses the search, and Resume
carries on from the same search. Every problem is listed per site in
Settings > Your data > Problems by source.

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

## Heat score

Every lead gets one score from 0 to 100 and both tabs are ranked by it (highest first). The badge on each row
shows it; hover it, or open the lead, to see what it is made of.

| Ads offer (a business with a website) | Points | Website offer (no working website) | Points |
| --- | --- | --- | --- |
| Ran Meta ads before, none live | +30 | No website | +35 |
| Never ran Meta ads | +15 | Weak website | +25 |
| Running Meta ads now | −25 | New business | +15 |
| Instagram followers in range | +15 | Running Meta ads now | +10 |
| New business | +10 | Active Instagram (a post in the last 30 days) | +5 |
| One of your target niches | +10 | | |
| Has a WhatsApp mobile | +10 | | |
| Weak website | +5 | | |

Both offers also get **+50** when the business asked for help in the last 7 days and **+20** when it is hiring
for marketing (the Intent Radar fills these in). 60 or more is hot, 35 or more is warm. Every number, the hot and
warm limits, your target niches and the active Instagram window are in Settings > Heat score. Businesses running
ads with a working website stay hidden unless you tick **Show skipped**.

**Exports**

- **Google Contacts**: the business name as the contact name, the WhatsApp number first, and notes with the heat
  score, its signals and the pitch line. Each export gets the label `LF-<date>` (for example `LF-2026-10-26`), so
  one batch is easy to find, and to delete, in Google Contacts.
- **Full CSV**: every field of every lead shown (40 columns). It includes the name and normalized name, the phone
  in +971 format and all phones, the WhatsApp link, the website and root domain, the Instagram handle, followers
  and last post, the Facebook page id, the area and emirate, the niche and sources, the Google rating and reviews,
  the ad status and last ad date, the signals, the heat score with its reasons, the pitch line, the website
  weakness, and the contacted status, channel and date, plus first seen and last updated.

## Quality signals

Every lead panel has a **Quality signals** section, and the Meta ads CSV has the same columns.

- **Website weakness score (0 to 100).** Each failed check adds its points and is saved as a reason:

  | Check | Points |
  | --- | --- |
  | Site down, 404 or parked | 40 |
  | No HTTPS or an SSL error | 15 |
  | PageSpeed mobile score under 50 | 15 |
  | Not set up for phones (no viewport tag) | 15 |
  | No WhatsApp button and no contact form | 15 |
  | On a free builder address (wixsite.com, godaddysites.com…) | 15 |
  | Copyright year 2 or more years old | 10 |

  30 or more is a **Weak site** (a tag you can filter on). A business with no website, or only an Instagram,
  Facebook or link page, is saved as that reason instead. The PageSpeed check only runs when PageSpeed is set
  up in Settings > Enrichment; until then it shows as not checked and adds nothing.
- **Pitch line.** The failed check with the most points gives the lead one line, written casually with no
  semicolons or dashes, for example "I noticed your site shows a Not secure warning in the browser and that puts
  people off before they even look". A good website gets a line from its ad history instead. Copy it from the
  panel, or use `{{pitch}}` in your scripts.
- **Instagram followers in your range** (500 to 10,000 by default). Counts come from Meta's official Instagram
  Graph API (Business Discovery) with your own token; Lead Hunter never opens Instagram for this. It can only
  see business and creator accounts: a personal account shows as not found. Set it up in Settings > Quality
  signals (the steps are written there), press **Save and test**, then use **Get Instagram followers** on
  selected businesses, or leave automatic lookups on. A token that stops working, or a rate limit, pauses the
  lookups with an alert. Profiles added with the Instagram button keep the count their page showed until the
  API gives a fresh one.
- **New business**: fewer than 10 Google reviews.

Everything above is in Settings > Quality signals: the follower range, the review limit, the weak site limit,
the PageSpeed and copyright limits, and each check's points and pitch line.

## One record per business, and who you already contacted

- **No duplicates.** Two finds count as one business when they share a phone number, a website (`shop.gloss.ae` and `gloss.ae` are the same site; `gloss.wixsite.com` and `other.wixsite.com` are not), an Instagram handle, or a name that is nearly the same in the same area. Names are compared without LLC, FZE, FZCO, FZ-LLC, Trading, Est, Co, Services, Dubai and UAE, using Jaro-Winkler at 0.92 (Settings > Collecting). The second listing is added to the first record, so nothing is lost.
- **Mark contacted** in a lead's panel, with the channel: WhatsApp, Instagram or Email. Tap another channel to change it, or **Reset** to make the business new again.
- **Contacted memory.** Everyone you mark contacted, send from the phone queue, email, or export to Google Contacts is remembered, even after you delete the lead. Searches skip them and the run shows how many ("2 contacted before").
- **Import your own list** in Settings > Your data: any CSV with phone numbers, like your sheet of contacted numbers or Google Contacts > Export > Google CSV. Leads already saved that match are tagged **Contacted before** and hidden until you tick **Show contacted before**.
- A number found in a website's text is not used for this (it can be the web designer's or the mall's); the website itself is.
- The Facebook advertisers list and the Meta ads list stay separate records, because each list works differently. The memory covers both: contact a business in one and it shows as contacted before in the other.

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
  for it.
- **Instagram**: Lead Hunter never crawls Instagram by itself, because
  automated Instagram searching gets accounts blocked. Instead, open a
  business profile on instagram.com as you normally would (from a hashtag,
  a location or the search) and press **+ Add to Lead Hunter** at the bottom
  right. It saves the profile you are looking at: name, bio, followers, the
  website and WhatsApp links in the bio, and any phone or email in it. The
  business lands in the Meta ads tab with the right script, and its ads are
  checked if it has a website.
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
