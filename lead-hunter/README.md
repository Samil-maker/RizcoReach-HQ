# Lead Hunter (Chrome extension)

Two lead finders in one extension:

- **Website leads** (*New hunt* tab): businesses already running Meta ads
  whose website is losing them the leads. Described first, below.
- **Meta ads clients** (*Meta ads* tab): businesses on Google Maps that are
  **not** running Meta ads, to sell ad management to. See
  [Meta ads clients](#meta-ads-clients).

## Website leads

Finds businesses that are **running Meta ads right now**, checks the website
those ads send people to, finds a phone number, scores how worth contacting
each one is, and writes a personalised WhatsApp or email pitch.

The pitch angle: *"You're paying for ads, but the page they land on is losing
you the leads."* Every lead comes with real evidence for that sentence: no
HTTPS, not mobile-friendly, slow, no Meta Pixel, no WhatsApp button, a © 2019
footer, a parked page, or no website at all.

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

1. Dashboard → **New hunt** → click a niche preset (for example *Car detailing*),
   or type your own keywords, one per line.
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
- Click a row to open the lead. You get the website score and issue list,
  every phone number with where it came from, their live ads, and the pitch.
- Pick **WhatsApp**, **Email** or **Instagram DM**. The template is chosen for
  you (website has issues, no website, website broken, website decent); you
  can switch it and edit the text before sending.
- To send from **your phone**, see the next section. **WhatsApp on this
  computer** opens WhatsApp Web or the WhatsApp desktop app instead. Either
  way the lead is marked *Contacted* (with an undo).
- Track the rest with the status column: Follow up, Replied, Meeting booked,
  Won, Not interested, Skip. Add notes in the lead panel.
- **Export CSV** gives you everything in the current view for Google Sheets.

Pitches link to your free audit tool
(`rizcoreach.ae/tools/website-audit?url=their-site`), which runs the audit on
their site the moment they open it and captures them as a lead through your
existing email gate. Change the link in Settings.

## Sending from your phone

Three ways, from no setup to most powerful:

1. **Scan a QR code.** Every lead with a number has a QR code under its
   WhatsApp pitch. Point your phone's camera at it and tap the link:
   WhatsApp opens **on your phone** with their number and your message
   already typed. Press send, then press **I sent it** on the computer.
   Click the code to make it bigger. Editing the message updates the code.
2. **Phone mode.** Press **Phone mode** above the lead list (or select
   leads first). It shows one lead at a time with a big QR code: scan, send
   on your phone, press **Enter** for the next one. 30 leads take a few
   minutes. Arrow keys skip or go back, Esc closes.
3. **Phone queue.** Select leads, press **Send to phone queue**, and they
   appear on a private page on your phone (`rizcoreach.ae/outreach`). Work
   through them anywhere: one tap opens WhatsApp with the message ready,
   and "sent" syncs back to the dashboard and marks the lead *Contacted*
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

| Verdict | What it means | The pitch says |
| --- | --- | --- |
| **Not running ads** | Their Facebook page was found and has 0 live ads. Confirmed. | "I checked Meta's Ad Library and you aren't running any Facebook or Instagram ads right now" |
| **No ads found** | No Facebook page to check, and nothing matched their website, phone or name. Very likely not advertising, not certain. | "I couldn't find any Facebook or Instagram ads from you in Meta's Ad Library" |
| **Running ads** | Live ads matched to them. Hidden by default. | The *Already advertising* angle, or skip them |
| **Couldn't check** | The Ad Library didn't load or asked you to log in. | Press **Check again**, or open the search link and look |

You can overrule any verdict in the lead panel (**They don't run ads** /
**They do run ads**).

The list shows *Not running ads* and *No ads found* by default, sorted by
priority: not advertising, plenty of Google reviews and a good rating (proof
of demand), a mobile or WhatsApp number, and a website all push it up.

**Niches built in:** Car detailing & PPF (the main one), Aesthetic clinics,
Boutique fitness (best October to January) and AC servicing (from late
January). Businesses with long sales cycles or restricted ads (renovation,
fit-out, real estate, plastic surgery, weight-loss injections, mobile car
wash and so on) are left out of the list; find them under **Niche → Skipped
(long sales cycle)**.

**Pitches.** Three templates: *Not advertising, strong reviews*, *Not
advertising, growing* and *Already advertising*. They only state things Lead
Hunter checked: the Google rating, the Ad Library result, and how many
businesses in the same niche you have seen advertising in your UAE website
hunts (mentioned only when it is 3 or more). Set your city and your offer in
**Settings → Meta ads offer**; you can edit the templates there too. They are
written in the first person and never claim past clients or results. Keep it
that way until you have real ones: UAE consumer protection law bans
misleading claims, and an invented result is the fastest way to lose a deal.

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
  so keep the daily volume modest and vary the wording.
- Lead with the one or two issues that cost them money (no HTTPS, not mobile,
  no WhatsApp button, no Pixel), not the full list.
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
| `lib/common.js` | Phones, links, priority score, pitch templates, CSV |
| `background.js` | Lead storage, hunts, enrichment queue, Google lookups |
| `finder.js` | Meta ads tab: Google Maps search (Places API or a Maps tab) and the Ad Library check queue |
| `lib/prospects.js` | Prospect de-duplication keys, Places results, matching ads to a business |
| `content/maps-hook.js` · `content/maps.js` | Read Google Maps search results (network data plus the visible list) |
| `dashboard/prospects.js` | The Meta ads tab UI |
| `dashboard/` · `popup/` | The UI |
| `lib/qr.js` · `lib/vendor/qrcode.js` | QR codes (vendored qrcode-generator, MIT) |
| `../netlify/functions/lead-queue.mts` | Phone queue API on the site (`/api/lead-queue`, Netlify Blobs) |
| `../public/outreach.html` | The phone page (`/outreach`) |

Tests:

```bash
node --test lead-hunter/test/*.test.mjs   # parsers, audit, scoring, templates, phone queue API, Meta ads prospects
node lead-hunter/test/e2e.mjs   # real Chromium + mock Ad Library, Google Maps, Places API, websites and phone page (needs Playwright + openssl)
```
