# Lead Hunter (Chrome extension)

Finds UAE businesses with **no website, or a dead or weak one**. Two tabs, two jobs, kept apart:

- **Email leads**: businesses that fit and have an email. Press **Find** on this tab and it only hunts for that:
  businesses whose website is missing or bad, and their email. One whose email can't be found never shows here.
  **Export for cold email** makes the CSV the cold email system (`cold-email/` in this repo) imports.
- **WhatsApp leads**: businesses that fit and have a WhatsApp or mobile number. Their Instagram is found and read so
  you can see whether they are real and active before you message them. **Google Contacts** makes a file for
  contacts.google.com (each contact has their Instagram too), so they show by name in WhatsApp.

A business fits when it has no website, or its website is down, parked ("coming soon") or weak (not secure, not
made for phones, or scoring under 80). A good modern website does not fit. Proof that a business **just opened**
puts it first and the cold email file says "new business": Google's own **Recently opened** / **Opening soon**
label on Maps, their own recent "grand opening" ad, their own Instagram post, a brand new Instagram account, or your
own say. **Strict** (Settings > Who fits) brings back the old rule: only new businesses or dead websites.

## Install (2 minutes)

1. Unzip `lead-hunter-extension-4.1.0.zip` (or download this repo and use the `lead-hunter` folder).
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the folder.
5. Pin it: puzzle icon in the toolbar → pin **RizcoReach Lead Hunter**.

To update: remove the old one (your leads stay only if you keep the same folder, so download a backup first in
Settings > Your data), or replace the folder's files and press the reload icon on the Lead Hunter card.

## Find (at the top of each tab)

Pick a kind of business, or **All types** (every kind, area by area), tick where to search, and press **Find**.
Each search runs in a background tab at a human pace. Each kind remembers which searches have run, so the next run
carries on from there (**Start over** resets it); the email tab and the WhatsApp tab each keep their own list, and
what each tab's Find finds shows only in that tab. 50 kinds are built in, each with about 100 search terms (salons,
restaurants, cafes, catering, clinics, gyms, garages, interiors, home maintenance, contracting, trading companies,
spare parts, MEP and AC, logistics, workshops, shops, schools, events and more; no spas, massage or groceries), and
230 areas across every emirate: Dubai, Sharjah, Abu Dhabi, Ajman, Al Ain, Ras Al Khaimah, Umm Al Quwain, Fujairah
and Al Dhafra (Settings > Areas).

**Email leads** searches:

- **Google Maps**: every business in the area; their website is then read for an email.
- **Google: business websites**: businesses found through their own website, where the email usually is.
  Directories, news, booking sites and "top 10" lists are skipped.
- **Google: emails in search results**: any result that shows a Gmail, Hotmail, Yahoo or Outlook address next to
  the business: their own site, their **Facebook page**, or a **directory listing** (Yellow Pages UAE, Connect.ae
  and the like). These are mostly small businesses with no real website, which is who you want. The directory's
  own address is never taken, and a page listing many businesses is skipped.
- **Bing**: a second search engine with different results, for business websites and for emails in results.
- **Google: Instagram profiles with an email** in their bio.
- **Meta Ad Library: businesses advertising their opening**: starts by itself at the start of a run, in its own tab
  (keep it on screen), with the opening words ("grand opening", "now open", "soft opening", the Arabic words…). It
  runs at most every 12 hours (Settings), so pressing Find again does not search the same ads twice.

**WhatsApp leads** searches Google Maps (phone numbers), Instagram profiles whose bio shows a WhatsApp number, and
the Ad Library.

Searches a day: **Google 120, Bing 300** (Settings). Google is the scarce one: an email run only spends a Google
search on a business's Instagram when it still has no email. When one engine's limit is reached its searches wait for the
next run and the others carry on. A captcha or "verify you are human" page pauses that engine with an alert at the
top; nothing tries to get past it.

**Instagram.** Lead Hunter never searches or browses Instagram itself. When you come across a business there, open
its profile and press **+ Add to Lead Hunter**.

Then, for every business, by itself:

- **Its website is checked**: down, parked ("coming soon", default server pages), weak, or good. With no website
  listed but an email at a domain of their own (info@glowsalon.ae), that domain is checked as their website, so a
  business with a working site is never told it has none.
- **Its Instagram is found on Google** when nobody listed it (only a profile whose name matches), and **read through
  Meta's official API**: the bio (often with their email or WhatsApp), the link in it, and the latest 12 posts.
- **Its Facebook page Intro** is read for an email, for businesses that fit and have none yet.

## Instagram API (once)

Settings > Instagram: make a token in the Graph API Explorer (the steps are on the page), paste it, press
**Connect**. Lead Hunter finds your Instagram business account id itself. Add your Meta app id and secret and press
Connect again to make the token last about 60 days instead of an hour.

## Emails

Every address is **cleaned** the moment it is found: `%20info@`, a phone number glued to the front, `[at]`/`[dot]`
and coded characters are fixed or the address is dropped; typos in the ending are fixed (`.con` → `.com`,
`gmial.com` → `gmail.com`); placeholders (`you@yourdomain.com`, `noreply@`…) and Gmail addresses that cannot exist
are dropped. There is no separate email check any more: the cold email system checks each domain itself when it
imports the file. **Bounces you report** (Settings > Cold email, or **Bounced** next to an address in a lead's
panel) are never used again, on any lead.

## Export for cold email (Email leads)

**Export for cold email** saves every business shown that fits and has an email, as
`rizcoreach-cold-email-YYYY-MM-DD.csv` with Chrome's Save As: save it in your **RizcoReach Leads** folder and the
cold email system imports it. Columns: business_name, first_name, email, website, instagram, phone, niche, area,
source, notes, status, segment. `notes` says `new business` when there is proof they just opened. `segment` is
Lead Hunter's verdict (A just opened, B no website, C a website that is down, parked or weak): the cold email
system takes it as it is instead of judging the website again, so every lead in the file gets its emails. **Export for Elheen** makes
the file for the Elheen booking campaign.

Left out, and the toast says how many of each: no email, a broken or bounced email, a good website, replied /
meeting / won / not interested / skipped, **Never email**, and anyone exported before (tick **Include already
exported** to export them again). Exported businesses are remembered, so later searches never bring them back.

## One record per business, and who you already contacted

- **No duplicates.** Two finds count as one business when they share a phone number, an email, a website, an
  Instagram handle, or a name that is nearly the same in the same area.
- **Mark contacted** in a lead's panel, with the channel: WhatsApp, Instagram or Email.
- **Contacted memory.** Everyone you mark contacted or export is remembered, even after you delete the lead.
  Searches skip them. **Import your own list** in Settings > Your data: any CSV with phone numbers.

## Good to know

- **Volume.** Run **All types** on the Email leads tab with every source ticked, and more areas (Settings > Areas).
  Maps gives the most businesses; the email searches give the most emails.
- Google Maps, Google, Bing and the Ad Library are read in normal tabs at a human pace. Their terms restrict
  automated collection, so run a sensible number of searches a day, ideally in a separate Chrome profile. A consent
  page, login wall, checkpoint, captcha or block pauses that source with an alert. Nothing tries to get past it.
- Bing's results page and the email search results were built from how those pages look and tested against mock
  pages. If a source stops finding things, tell me.
- Leads are stored only in this Chrome profile. Use **Settings → Download backup** before removing the extension.
  Keys are left out of backups.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Manifest V3; content scripts on the Ad Library, Google Maps, Google, Bing, Instagram and Facebook pages |
| `background.js` | Lead storage, Ad Library hunts, website checks, contacted memory |
| `finder.js` | The Find runs (email and WhatsApp), Google and Bing in tabs, Instagram found on Google, the Instagram API, Facebook page emails |
| `bounces.js` | Addresses that bounced |
| `content/google.js` · `content/bing.js` | Reading Google and Bing results, in the tab Lead Hunter opened only |
| `content/fb-page.js` | A business's Facebook page Intro, in the check tab only |
| `lib/emails.js` | Cleaning addresses, typo fixes, which address goes in the file |
| `lib/fit.js` | Google's opening label, opening words, who fits and why, the score, the cold email file, Google Contacts |
| `lib/common.js` | Phones, links, the built in kinds of business, areas, settings, contacted memory, CSV |
| `lib/site-audit.js` | Website check (down, parked, working) and contact extraction |
| `lib/prospects.js` | De-duplication keys, search results as businesses (websites, Instagram, emails in results) |
| `lib/extract-ads.js` · `content/hook.js` · `content/adlib.js` | Reading the Ad Library |
| `content/maps-hook.js` · `content/maps.js` | Reading Google Maps results, with the opening label |
| `content/instagram.js` | The + Add to Lead Hunter button |
| `dashboard/` · `popup/` | The UI |

Tests:

```bash
npm test                         # unit tests: email cleaning, opening label, fit rule, the cold email file, presets, search results
node lead-hunter/test/e2e.mjs    # real Chromium + a mock world (test/world.mjs): Google Maps, Google, Bing, websites, the Instagram API, Facebook, the Ad Library
```
