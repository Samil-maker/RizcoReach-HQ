# Lead Hunter (Chrome extension)

Finds UAE businesses with **no website, or a dead or weak one**, with their email, phone and Instagram. Two sections
on the Leads tab:

- **Email leads**: businesses that fit and have an email that passed its checks. **Export for cold email** makes the
  CSV the cold email system (`cold-email/` in this repo) imports.
- **WhatsApp & Instagram leads**: businesses that fit and have a phone or an Instagram. **Google Contacts** makes a
  file for contacts.google.com (each contact has their Instagram too), so they show by name in WhatsApp. Tap an
  @username in the list to open their Instagram.

A business fits when it has no website, or its website is down, parked ("coming soon") or weak (not secure, not
made for phones, or scoring under 80). A good modern website does not fit. Proof that a business **just opened**
puts it first and the cold email file says "new business": Google's own **Recently opened** / **Opening soon**
label on Maps, their own recent "grand opening" ad, their own Instagram post, a brand new Instagram account, or your
own say. **Strict** (Settings > Who fits) brings back the old rule: only new businesses or dead websites.

## Install (2 minutes)

1. Download this repo (GitHub → Code → Download ZIP) and unzip it, or `git pull`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `lead-hunter` folder.
5. Pin it: puzzle icon in the toolbar → pin **RizcoReach Lead Hunter**.

The dashboard opens automatically. Works in Chrome, Edge and Brave.

To update after pulling new code: `chrome://extensions` → the reload icon on
the Lead Hunter card. Your leads are kept.

## Find businesses (Find tab)

1. **Google Maps and Google.** Pick a kind of business, or **All types** (every kind, area by area), tick where to
   search, and press **Find businesses**:
   - **Google Maps**: the most businesses, with phone numbers and Google's Recently opened label.
   - **Google: business websites**: businesses found through their own website, where the email usually is.
     Directories, news, booking sites and "top 10" lists are skipped.
   - **Google: Instagram profiles with an email**: Instagram accounts whose bio (as Google shows it) has an email.
   Each search runs in a background tab at a human pace. Each kind remembers which searches have run, so the next
   run carries on from there (**Start over** resets it). There are 43 kinds built in (salons, restaurants, cafes,
   clinics, gyms, garages, interiors, home maintenance, contracting, shops, schools, events and more).
   Google allows only so many searches before it shows a captcha, so Google searches stop at **120 a day**
   (Settings). A captcha pauses Google with an alert; nothing tries to get past it.
2. **Businesses advertising their opening.** Searches the Meta Ad Library for "grand opening", "now open",
   "soft opening" and the Arabic words in a tab, and keeps the advertisers whose recent ad says so.
3. **Instagram.** Lead Hunter never searches or browses Instagram. When you come across a new business there,
   open its profile and press **+ Add to Lead Hunter**.

Then, for every business, by itself:

- **Its website is checked**: down (does not load, or errors), parked (parking, "coming soon", "launching soon",
  "site not published", default server pages), weak, or good. A website blocking the check counts as "could not be
  judged" and stays out. With no website listed but an email at a domain of their own (info@glowsalon.ae), that
  domain is checked as their website, so a business with a working site is never told it has none.
- **Its Instagram is read through Meta's official API** (Settings > Instagram): the bio (often with their email),
  the link in it, and the latest 12 posts. An opening announcement, or an account whose first post is under 90
  days old, counts as proof.
- **Its Instagram is found on Google** when nobody listed it: one Google search by its name, and only a profile whose
  name matches (or whose username spells it) is taken. Its bio's email and phone come with it.
- **Its Facebook page Intro** is read for an email, only for businesses that fit and have none yet.
- **Every email address is checked** (below).

## Email checks (fewer bounces)

1. **Cleaned** the moment it is found: `%20info@`, a phone number glued to the front, words glued to the end,
   `[at]`/`[dot]` and coded characters are fixed or the address is dropped. Typos in the ending are fixed
   (`.con` → `.com`, `gmial.com` → `gmail.com`, `hotmal.com` → `hotmail.com`). Placeholders (`you@yourdomain.com`,
   `filler@godaddy.com`, `noreply@`…) and Gmail addresses that cannot exist are dropped. A mailbox name is never
   guessed.
2. **Its domain** is looked up in public DNS (Google, then Cloudflare): a domain that does not exist, receives no
   email or is parked with a parking company's mail server fails. Free, always on.
3. **Optional: its mailbox** is checked with QuickEmailVerification, with your own key (Settings > Email check). Their free
   plan gives **100 checks a day, no card**: sign up at quickemailverification.com, open API settings, create a
   key, paste it, press **Save and test** (the test uses their free sandbox). Checks are only spent on businesses
   that fit, best address first, and stop at the first confirmed one. With a key, only **confirmed** mailboxes go
   in the file. A mailbox the check cannot confirm (a server that accepts anything, or does not answer) stays out
   unless you tick **Also export addresses the mailbox check could not confirm**. When the day's checks run out,
   they wait for the next day by themselves.
4. **Bounces you report** (Settings > Email check, or **Bounced** next to an address in a lead's panel) are never
   used again, on any lead. Paste your cold email system's bounce report there.

Each address in a lead's panel shows what happened to it: Confirmed, Domain checked, Not confirmed or Removed, with
the reason and where it was found.

## Export for cold email (Email leads)

The Email leads section shows **Has an email** by default, best first. **Export for cold email** saves every business shown that fits
and has an address that passed its checks, as `rizcoreach-cold-email-YYYY-MM-DD.csv` with Chrome's Save As: save it
in your **RizcoReach Leads** folder and the cold email system imports it. Columns: business_name, first_name,
email, website, instagram, phone, niche, area, source, notes, status. `notes` says `new business` when there is
proof they just opened.

Left out, and the toast says how many of each: no email, an email that failed or could not be confirmed, a check
still running (its turn comes first), a good website, replied / meeting / won / not
interested / skipped, **Never email**, and anyone exported before (tick **Include already exported** to export them
again). Exported businesses are remembered, so later searches never bring them back.

## Intent Radar

The **Intent** tab lists people asking for what you sell, newest first. It covers website buyers, owners announcing a
business they are opening, marketing buyers, owners saying business is slow, and companies hiring for marketing, all from the last 14 days. The
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
  for marketing. If you already have that company as a lead, the post is linked to it.
- **The rules**: a post must contain one of your keyword phrases (English and Arabic, editable). An owner
  announcing their own opening ("soft opening of my salon") is kept even when it mentions a discount. Sellers are
  dropped ("we offer", "DM me", "our agency"…, editable). The same post seen twice (by link, or by author and
  words) is saved once. Posts older than 14 days are skipped.
- Each card shows a summary, where it was posted, how old it is, the post itself and the link, with **Mark
  contacted** and **Dismiss**. Nothing is written or sent for you.
- **AI check**: an AI reads every post the keywords catch and says whether the person is really a buyer, what
  they need (website, SEO, marketing), what business they run, where, how urgent it is, and an intent score.
  Posts it rules out are hidden (tick **Show not buyers**). New
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

## One record per business, and who you already contacted

- **No duplicates.** Two finds count as one business when they share a phone number, a website (`shop.gloss.ae` and `gloss.ae` are the same site; `gloss.wixsite.com` and `other.wixsite.com` are not), an Instagram handle, or a name that is nearly the same in the same area. Names are compared without LLC, FZE, FZCO, FZ-LLC, Trading, Est, Co, Services, Dubai and UAE, using Jaro-Winkler at 0.92 (Settings > Checking businesses). The second listing is added to the first record, so nothing is lost.
- **Mark contacted** in a lead's panel, with the channel: WhatsApp, Instagram or Email. Tap another channel to change it, or **Reset** to make the business new again.
- **Contacted memory.** Everyone you mark contacted or export for cold email is remembered, even after you delete the lead. Searches skip them and the run shows how many ("2 contacted before").
- **Import your own list** in Settings > Your data: any CSV with phone numbers, like your sheet of contacted numbers. Leads already saved that match are tagged **Contacted before** and hidden until you tick **Show contacted before**.
- A number found in a website's text is not used for this (it can be the web designer's or the mall's); the website itself is.

## Good to know

- **Volume.** Most emails come from Google: businesses' own websites and Instagram bios. Maps gives phones. Run
  **All types** with all three sources ticked, and more areas (Settings > Areas), to keep the cold email system fed.
  The 120 Google searches a day are shared by the business searches and the Instagram lookups.
- Google Maps and the Ad Library are read in normal tabs at a human pace, a few seconds between searches. Google's
  and Meta's terms restrict automated collection, so run a sensible number of searches a day, ideally in a separate
  Chrome profile. A consent page, login wall, checkpoint, captcha or block pauses that source with an alert at the
  top of the Leads and Find tabs. Nothing tries to get past it.
- Google's label, Instagram's API fields and the Facebook page reader were built from their documentation and
  tested against mock pages. If Google changes how the label shows, or a reader stops finding things, tell me.
- Leads are stored only in this Chrome profile. Use **Settings → Download backup** before removing the extension.
  Keys are left out of backups.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Manifest V3; content scripts on the Ad Library, Google Maps, Instagram, Facebook, LinkedIn and Reddit |
| `background.js` | Lead storage, Ad Library hunts, website checks, contacted memory |
| `finder.js` | Google Maps and Google searches in tabs, Instagram found on Google, the Instagram API, Facebook page emails |
| `content/google.js` | Reading Google search results, in the tab Lead Hunter opened only |
| `checks.js` | Email checks: DNS for every address, QuickEmailVerification mailbox checks with a daily cap, bounces |
| `lib/emails.js` | Cleaning addresses, typo fixes, check states, which address may be sent, reading the checks' answers |
| `lib/fit.js` | Google's opening label, opening words, who fits and why, the score, the cold email file, Google Contacts |
| `lib/common.js` | Phones, links, the 43 built in kinds of business, areas, settings, contacted memory, CSV |
| `lib/site-audit.js` | Website check (down, parked, working) and contact extraction |
| `lib/prospects.js` | De-duplication keys, Google results as businesses, picking a business's Instagram from results |
| `lib/extract-ads.js` · `content/hook.js` · `content/adlib.js` | Reading the Ad Library |
| `content/maps-hook.js` · `content/maps.js` | Reading Google Maps results (network data plus the visible list), with the opening label |
| `content/instagram.js` | The + Add to Lead Hunter button |
| `content/social-scan.js` | Scan for leads on Facebook groups and LinkedIn, Scan my subreddits on Reddit, a Facebook page's Intro |
| `intent.js`, `lib/intent.js`, `lib/intent-db.js` | Intent Radar |
| `dashboard/` · `popup/` | The UI |

Tests:

```bash
npm test                         # unit tests: email cleaning, checks, opening label, fit rule, the cold email file, presets, intent rules
node lead-hunter/test/e2e.mjs    # real Chromium + a mock world (test/world.mjs): Google Maps, websites, DNS, the mailbox check, the Instagram API, Facebook, the Ad Library, Reddit, LinkedIn, Gemini and Claude
```
