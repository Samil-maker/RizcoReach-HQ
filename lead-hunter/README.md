# Lead Hunter (Chrome extension)

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
- **Open in WhatsApp** opens a chat with the message filled in. You press send.
  The lead is marked *Contacted* (with an undo).
- Track the rest with the status column: Follow up, Replied, Meeting booked,
  Won, Not interested, Skip. Add notes in the lead panel.
- **Export CSV** gives you everything in the current view for Google Sheets.

Pitches link to your free audit tool
(`rizcoreach.ae/tools/website-audit?url=their-site`), which runs the audit on
their site the moment they open it and captures them as a lead through your
existing email gate. Change the link in Settings.

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
- Leads are stored only in this Chrome profile. Use **Settings → Download
  backup** before removing the extension or switching computers.
- If Meta changes the Ad Library and collection stops (the corner panel stays
  at 0 while results are on screen), the parser needs an update.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Manifest V3; content scripts on `facebook.com/ads/library*` |
| `content/hook.js` | Runs in the page; mirrors the Ad Library's GraphQL responses to the extension |
| `content/adlib.js` | Collects ads (network data, embedded first page, visible cards as fallback), corner panel, auto-scroll |
| `lib/extract-ads.js` | Finds ad records in any Ad Library JSON (keys on `ad_archive_id`) |
| `lib/site-audit.js` | Website audit and contact extraction (same checks as `netlify/functions/audit.mts`, plus ad-specific ones) |
| `lib/common.js` | Phones, links, priority score, pitch templates, CSV |
| `background.js` | Lead storage, hunts, enrichment queue, Google lookups |
| `dashboard/` · `popup/` | The UI |

Tests:

```bash
node --test lead-hunter/test/lib.test.mjs   # parsers, audit, scoring, templates
node lead-hunter/test/e2e.mjs               # real Chromium + mock Ad Library and websites (needs Playwright + openssl)
```
