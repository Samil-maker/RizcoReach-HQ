# Lead Hunter (Chrome extension)

Finds UAE businesses to sell websites and Meta ads to, and their email addresses, checks and scores each one, and
hands them over as a file. Lead Hunter writes no messages and sends nothing:

- **Export for cold email** gives the cold email system on your Mac (`cold-email/` in this repo) the businesses
  with no website or a weak one, with their email. It writes the emails, sends them on its warm up schedule from
  samilatrizcoreach@gmail.com, follows up and reads the replies. See [Export for cold email](#export-for-cold-email).
- **Google Contacts** (or a CSV) is for reaching out from your phone: import the file at contacts.google.com and
  every business shows up on your phone by name, with its heat score and top reason in the notes.

Where leads come from:

- **Meta ads** tab: businesses on Google Maps (by preset and area), or saved from Instagram with one click, each
  checked in the Meta Ad Library. See [Meta ads clients](#meta-ads-clients).
- **Website leads** (*New hunt* tab): businesses already running Meta ads, from the Ad Library. The ones without
  a working website are website leads.
- **Intent** tab: people asking for a website or marketing help on Reddit, Facebook groups and LinkedIn, each
  confirmed or ruled out by an AI check (free with a Google AI Studio key). See [Intent Radar](#intent-radar).

## Two offers, picked for you

| The lead | Offer | Tag |
| --- | --- | --- |
| No website (either tab) | Website offer | *No website* |
| Website down or parked (either tab) | Website offer | *Site down* |
| Website, ran Meta ads before but none live | Ads offer | *Ran ads before* |
| Website, the Ad Library check found no Meta ads | Ads offer | *No Meta ads* |
| Website, Ad Library check not done yet | Ads offer | *Ad check not done* |
| Working website and running ads | none: skipped | *Running ads* |

The offer decides how a lead is scored (see [Heat score](#heat-score)) and how Results groups replies. Skipped
leads are not deleted: they are hidden while they are New (tick **Show skipped (running ads)**). Leads you are
already talking to always show.

**Presets** are one list for both tabs (Settings → Presets): keywords, exclude words, a review range and areas.
The label is how the preset reads in Settings and Results (*car detailing and protection studios*).

Row tags (*No website*, *Site down*, *Weak site*, *New business*, *Followers in range*, *Running ads*,
*Contacted before*…) are for sorting and filtering.

## Install (2 minutes)

1. Download this repo (GitHub → Code → Download ZIP) and unzip it, or `git pull`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `lead-hunter` folder.
5. Pin it: puzzle icon in the toolbar → pin **RizcoReach Lead Hunter**.

The dashboard opens automatically. Works in Chrome, Edge and Brave.

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

- Both tabs are ranked by **heat score** (0 to 100). Hover the badge, or open the lead, to see what it is made of.
- Click **Open** on a row for the lead panel: the heat score and its reasons, the website weakness checks,
  Instagram followers, Google reviews, every phone number with where it came from, their Instagram, the
  **Cold email** section (the email the export uses and where it was found, whether they go in the file and why
  not, and the **Just opened / grand opening** box), and (for website leads) their live ads.
- **Export for cold email** (above the list, or on selected leads): see [below](#export-for-cold-email).
- **Google Contacts** (above the list, or on selected leads) saves them as a Google Contacts file: the business
  name as the contact name, the WhatsApp number first, and notes with the heat score, its signals and the top
  reason. Each export gets its own label, `LF-<date>`. Import it at contacts.google.com (Import) and WhatsApp
  on your phone shows each business by name. Leads without a phone or an email are left out. Everyone you
  export is remembered, so later searches skip them. The file uses the layout contacts.google.com exports
  today. If Google still says it can't import it, press **vCard** next to it: the same contacts as a .vcf file,
  which Google Contacts imports too (and a phone can open directly).
- **Full CSV** gives every field of every lead shown (40 columns). **Export CSV** is the shorter version.
- When you have contacted someone, open the lead and press **Mark contacted** with the channel (WhatsApp,
  Instagram or Email), or set the status on the row. **Replied** on the row marks a reply (press again to
  undo). Follow up, Meeting booked, Won, Not interested and Skip track the rest. Add notes in the lead panel.
- **Results** (top of both tabs) shows contacted, replied and reply rate by niche and by offer.

## Export for cold email

Lead Hunter finds the leads and their emails. The cold email system on your Mac does everything after that (see
`cold-email/README.md`). Lead Hunter's own email sender is gone, so there is only ever one sender on
samilatrizcoreach@gmail.com and its warm up limits hold.

1. On either tab press **Export for cold email** next to Export CSV. It exports the current view, or the leads you
   selected (the button in the bar that appears when you tick rows).
2. Chrome asks where to save `rizcoreach-cold-email-<date>.csv`. Pick your **RizcoReach Leads** folder (Desktop).
   Chrome remembers it, so next time it is already chosen.
3. The cold email system imports it within the hour.

Who goes in:

- **In:** businesses with no website of their own (or only Instagram, Facebook, a link page or Maps), a website
  that is down or parked, or one the website check flagged: no HTTPS, not mobile friendly, an old year in the
  footer, slow, no WhatsApp button or contact form, a free builder address, or a score under 80. A site not
  checked yet, or one that blocked the check, goes in too: the cold email system checks every site again.
- **Out:** a clearly good website (HTTPS, works on phones, scores 80 or more, nothing flagged); leads set to
  Replied, Meeting booked, Won, Not interested or Skip; leads marked **Never email** in their panel; leads Lead
  Hunter's old email queue already emailed; and leads you exported before (they get an **Exported for cold
  email** tag). Tick **Include already exported** to put those back in the file.
- Leads without a usable email are left out, and the message after the export says how many, with every other
  reason.

The file is UTF-8 CSV with these columns: `business_name`, `first_name` (empty), `email`, `website` (their own
site, never a social or Maps address), `instagram` (the handle), `phone`, `niche`, `area`, `source` (where we
saw them: Google Maps, Instagram or Facebook; the first email says "Just the ___ page", so it is always true:
Ad Library leads say Instagram only when we know their profile), `notes` and `status`. Leads are marked exported
only once the file is saved: cancel the dialog and nothing changes.

**Just opened / grand opening:** tick it in a lead's panel only when you know they just opened (a few Google
reviews is not enough, so Lead Hunter never ticks it for you). The file then says `new business` in notes and the
cold email system sends its congrats on the launch email.

### Where the emails come from

Only addresses the business publishes itself, never template placeholders (GoDaddy's filler@godaddy.com and the
like), and never one that bounced:

- **Their website** and its contact pages, read by the website check.
- **Their Instagram profile**, when you press **+ Add to Lead Hunter** on it: the email in the bio, and the public
  business email the profile shows (its Email or Contact button, or the profile's own data; an email belonging
  to a suggested account on the same page is not used).
- **Their Facebook page**, for leads with no email and no website or a weak one: the page opens in the Ad Library
  check tab, one every few seconds, and the email in its **Intro** is kept. That covers website leads (their
  advertiser page), businesses whose website links their page, and Google Maps listings that give a Facebook page
  as their website. A login wall, checkpoint or block pauses these lookups with an alert and a **Resume** button
  on the Meta ads tab; nothing tries to get past it. Turn it off in Settings > Collecting (**Look for emails on
  Facebook pages**), or press **Look on their Facebook page** in a lead's panel.

The lead panel says where its email came from.

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
   - The emails' `{{niche}}` is the preset's "In your messages" wording and
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
   offer whatever their ads, so their check is skipped ("Not needed") unless
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

| Verdict | Status in exports | What it means | Offer (with a website) |
| --- | --- | --- | --- |
| **Ran ads before** | `ran_before_inactive_now` | Ads matched to them, none live now. Shows when the last one stopped. Your warmest ads prospects: they already paid for ads once. | Ads offer |
| **Never ran ads** | `never_ran` | Their Facebook page was found and has never run ads in the UAE. Confirmed. | Ads offer |
| **No ads found** | `never_ran` (not certain) | No Facebook page to check, and nothing matched their website, phone or name. | Ads offer |
| **Running ads** | `active_now` | Live ads matched to them. Shows when the newest started. | Skipped (hidden by default) |
| **Couldn't check** | blank | The Ad Library didn't load. Press **Check again**, or open the search link and look. | Ads offer, marked *Ad check not done* |

The Meta ads CSV has `meta_ad_status` and `last_ad_date` columns.
Businesses without a working website get the website offer whatever the verdict.
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

The list is ranked by [heat score](#heat-score). If Google Maps lists an Instagram profile as their website, it
is saved as their Instagram instead. Statuses, notes, **Mark contacted** and the exports work the same as for
website leads.

The default emails never claim past clients or results. Keep it that way until you have real ones: UAE consumer
protection law bans misleading claims, and an invented result is the fastest way to lose a deal.

**Places API cost.** A Text Search that returns phone numbers and websites is
billed at Google's Enterprise rate: about 1,000 free requests a month, then
roughly $35 per 1,000 (check current pricing). Each request returns up to 20
businesses. Lead Hunter counts requests and stops at the monthly limit in
Settings (default 950). After that, remove the key to search in a tab
instead, or raise the limit.

## Intent Radar

The **Intent** tab lists people asking for what you sell, newest first. It covers website buyers, marketing
buyers, owners saying business is slow, and companies hiring for marketing, all from the last 14 days. The
extension icon shows how many new ones came in.

- **Reddit** (r/dubai, r/UAE, r/abudhabi, r/sharjah, plus r/smallbusiness posts that mention the UAE). Reddit now
  refuses to show posts to anyone not logged in, and new Reddit API apps need Reddit's approval, so Reddit is read
  in your own Reddit tab: press **Scan Reddit now** on the Intent tab, or **Scan my subreddits** at the bottom right
  of any Reddit page, while logged in to Reddit in this Chrome profile. It reads the newest posts of each subreddit,
  4 to 12 seconds apart (**Stop** ends it early). **Scan this page** reads just the posts on the page. If Reddit says
  no (usually: not logged in), it stops at once and reads the page you are on instead. If you have a Reddit app that
  Reddit approved, paste its id in Settings > Intent Radar and Reddit is scanned by itself every 3 hours instead.
- **Facebook groups and LinkedIn**: open a group, your LinkedIn feed, a LinkedIn post search or a LinkedIn jobs
  search yourself, then press **Scan for leads** at the bottom right. It reads the posts already on the page.
  **Scroll and scan** scrolls five small steps first, 4 to 12 seconds apart. Nothing runs without you pressing it.
- **Jobs**: a marketing role (social media, digital marketing, content, SEO…) in the UAE counts as a company hiring
  for marketing. If you already have that company as a lead, the post is linked to it and the lead gets the +20
  hiring bonus in its heat score. A post that names a lead's website gets the +50 intent bonus the same way.
- **The rules**: a post must contain one of your keyword phrases (English and Arabic, editable). Sellers are
  dropped ("we offer", "DM me", "our agency"…, editable). The same post seen twice (by link, or by author and
  words) is saved once. Posts older than 14 days are skipped.
- Each card shows a summary, where it was posted, how old it is, the post itself and the link, with **Mark
  contacted** and **Dismiss**. Nothing is written or sent for you.
- **AI check**: an AI reads every post the keywords catch and says whether the person is really a buyer, what
  they need (website, SEO, marketing), what business they run, where, how urgent it is, and an intent score.
  Posts it rules out are hidden (tick **Show not buyers**), and a lead linked to one loses its heat bonus. New
  posts are checked as they come in; **Check them now** checks the rest. Two ways to run it:
  - **Free: a Google AI Studio key.** aistudio.google.com → **Get API key** → **Create API key**, paste it in
    Settings > Intent Radar and press **Save and test**. It uses `gemini-flash-lite-latest`, which always points
    to Google's newest Flash-Lite model (change it in Settings, for example to `gemini-flash-latest`). The free
    tier has per-minute and daily limits: when one is reached the check waits as long as Google says (an hour for
    the daily one) and carries on by itself. On the free tier Google may use what is sent to improve its
    products; these are public posts.
  - **Or a Claude key** (console.anthropic.com > API keys, about 0.2 US cents a post). If both keys are filled
    in, Gemini is used.

  Without a key, posts stay **unverified**: keywords catch most real buyers but not all, so read the post first.
  A key that stops working, a model name Google doesn't know, or no credit left pauses the check with an alert
  and a **Resume** button. Keys stay in this browser, are only sent to Google or Anthropic, and are left out of
  backups.
- A login wall, checkpoint, captcha or block on Reddit, Facebook or LinkedIn pauses that source with an alert and
  a **Resume** button. Nothing tries to get past it.
- Facebook and LinkedIn change their pages often. If **Scan for leads** says it found no posts on a page full of
  posts, tell me and I will update how it reads them. Facebook often hides post dates in a way that can't be read;
  those posts show "date unknown" and are kept.

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
  score, its signals and the top reason. Each export gets the label `LF-<date>` (for example `LF-2026-10-26`), so
  one batch is easy to find, and to delete, in Google Contacts.
- **Full CSV**: every field of every lead shown (40 columns). It includes the name and normalized name, the phone
  in +971 format and all phones, the WhatsApp link, the website and root domain, the Instagram handle, followers
  and last post, the Facebook page id, the area and emirate, the niche and sources, the Google rating and reviews,
  the ad status and last ad date, the signals, the heat score with its reasons, the top reason, the website
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
- **Top reason.** The failed check with the most points is the lead's top reason (a good website gets one
  from its ad history instead). It goes in the Google Contacts notes and the Full CSV.
- **Instagram followers in your range** (500 to 10,000 by default). Counts come from Meta's official Instagram
  Graph API (Business Discovery) with your own token; Lead Hunter never opens Instagram for this. It can only
  see business and creator accounts: a personal account shows as not found. Set it up in Settings > Quality
  signals (the steps are written there), press **Save and test**, then use **Get Instagram followers** on
  selected businesses, or leave automatic lookups on. A token that stops working, or a rate limit, pauses the
  lookups with an alert. Profiles added with the Instagram button keep the count their page showed until the
  API gives a fresh one.
- **New business**: fewer than 10 Google reviews.

Everything above is in Settings > Quality signals: the follower range, the review limit, the weak site limit,
the PageSpeed and copyright limits, and each check's points.

## One record per business, and who you already contacted

- **No duplicates.** Two finds count as one business when they share a phone number, a website (`shop.gloss.ae` and `gloss.ae` are the same site; `gloss.wixsite.com` and `other.wixsite.com` are not), an Instagram handle, or a name that is nearly the same in the same area. Names are compared without LLC, FZE, FZCO, FZ-LLC, Trading, Est, Co, Services, Dubai and UAE, using Jaro-Winkler at 0.92 (Settings > Collecting). The second listing is added to the first record, so nothing is lost.
- **Mark contacted** in a lead's panel, with the channel: WhatsApp, Instagram or Email. Tap another channel to change it, or **Reset** to make the business new again.
- **Contacted memory.** Everyone you mark contacted or export to Google Contacts is remembered, even after you delete the lead. Searches skip them and the run shows how many ("2 contacted before").
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
instead of a score, so a "broken site" that isn't broken never scores as one.
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

- Start with the hottest leads. *Ran ads before* businesses already believe in ads; *No website* businesses
  whose ads go straight to WhatsApp are often the easiest yes for a free homepage mockup.
- WhatsApp restricts numbers that send the same text to lots of people who haven't saved them. Saving them
  through Google Contacts first helps, but keep the daily volume modest and vary the wording.
- Follow up once after 2 to 3 days, then move on. Set the status to *Follow up*.
- Mark who you contacted and who replied, and watch **Results**: if one niche or offer gets far fewer replies,
  change the angle.

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
  website and WhatsApp links in the bio, any phone or email in it, and the public business email the profile
  shows. The
  business lands in the Meta ads tab with the right offer, and its ads are
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
| `lib/common.js` | Phones, links, presets, offers, quality signals, heat score, tags, results, the exports (cold email, Google Contacts, CSV) |
| `background.js` | Lead storage, hunts, enrichment queue, Google lookups |
| `intent.js`, `lib/intent.js`, `lib/intent-db.js` | Intent Radar: Reddit scans, the rules every post goes through, the AI check (Gemini or Claude), and the IndexedDB store |
| `content/social-scan.js` | The Scan for leads button on Facebook groups and LinkedIn, Scan my subreddits on Reddit, and reading a business's Facebook page Intro for its email |
| `content/instagram.js` | The + Add to Lead Hunter button on Instagram profiles, with the profile's business email |
| `finder.js` | Meta ads tab: Google Maps search (Places API or a Maps tab), the Ad Library check queue, and the Facebook page email lookups (same tab) |
| `lib/prospects.js` | Prospect de-duplication keys, Places results, matching ads to a business |
| `content/maps-hook.js` · `content/maps.js` | Read Google Maps search results (network data plus the visible list) |
| `dashboard/prospects.js` | The Meta ads tab UI |
| `dashboard/` · `popup/` | The UI |
| `../netlify/functions/lead-queue.mts` · `../public/outreach.html` | The old phone queue and phone page. The extension no longer uses them; they can be removed from the site |
| `email/sender.gs` · `../netlify/functions/email-queue.mts` | Lead Hunter's old email sender and its queue on the site. The extension no longer uses them (the cold email system sends now); they stay in place and the site tests still run them |

Tests:

```bash
node --test lead-hunter/test/*.test.mjs   # parsers, audit, scoring, offers, presets, results, heat score, the cold email file, intent rules, AI check, Meta ads prospects
node lead-hunter/test/e2e.mjs   # real Chromium + mock Ad Library, Google Maps, Places API, websites, Instagram, Facebook pages, Reddit, Gemini and Claude (needs Playwright + openssl)
```
