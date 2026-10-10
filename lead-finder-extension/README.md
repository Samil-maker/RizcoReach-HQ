# RizcoReach Lead Finder (Chrome extension)

Search Google Maps and click one button. The extension collects every business
with a mobile number. It then **checks each one's website and Instagram** and
sorts them into **Hot**, **Good** and **Low**, so you message the best leads
first. Your WhatsApp message points out the real problems it found ("your
website takes about 7 seconds to load and there's no contact form").

No accounts, API keys or monthly fees.

## Install (about 2 minutes)

1. Unzip `rizcoreach-lead-finder.zip`. You get a folder called
   **rizcoreach-lead-finder**. Keep that folder somewhere safe, because the
   extension stops working if you delete it.
2. In Chrome, go to **chrome://extensions**.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and choose the **rizcoreach-lead-finder** folder.
5. Click the puzzle-piece icon in Chrome's toolbar and pin
   **RizcoReach Lead Finder**.

**Updating from version 1:** replace the files in the folder with the new ones,
then click ↻ on the extension's card in chrome://extensions. Your leads are
kept. Chrome will ask for permission to "read and change data on all websites".
The extension needs this to open and check each business's website.

## How it works

1. **Find businesses.** Open [Google Maps](https://www.google.com/maps?hl=en)
   and search for a type of business in an area, e.g. *ladies salon in Al
   Barsha*. Click the RizcoReach icon, then **Collect leads from this search**.
   It opens every result (you'll see Maps moving) and saves each business with
   a mobile number, plus its website, Google rating, review count, and whether
   the owner has claimed the Google listing.
2. **Check them.** This starts by itself. One at a time, each website opens in
   a muted background tab, where the extension:
   - times how long the site takes to load;
   - looks for a contact form (on the contact page too), a preloader, phone
     (mobile) set-up, HTTPS, a WhatsApp button, tap-to-call, the © year in the
     footer, SEO basics, and Meta Pixel / Google Analytics;
   - spots dead sites: domain not loading, error pages, "for sale"/parked
     domains, suspended hosting, "coming soon" pages.

   It also finds the business's Instagram (from Maps, from their website, or
   when their "website" *is* their Instagram) and reads the follower count.
   The background tab closes when it's done. If you close the panel, checking
   pauses and carries on next time you open it.
3. **Message the best ones.** The **Hot** tab shows your best leads first,
   each with the reasons:
   > **Hot 75** Glow Beauty Lounge
   > \+ Weak website: not mobile-friendly · © 2019
   > \+ Instagram @glowlounge · 2.1K followers
   > • 4.9★ · 310 Google reviews

   Click **WhatsApp**. WhatsApp Web opens with the right message typed in
   (one message for "no website", another for "weak website" that names the
   two biggest problems). Press send.
4. **Save them.** **Download for Google Contacts** saves your Hot and Good
   leads, which you then import at contacts.google.com. **Copy for Google
   Sheets** copies every lead, best first, with all the details.

## What makes a good lead

You can change all of this under **What makes a good lead** in the panel. The
defaults:

| Rule | Default |
| --- | --- |
| Businesses to collect | All with a mobile number (or only without / only with a website) |
| Instagram followers | At least 1,000, when we can find their Instagram |
| No Instagram found | Allowed (tick "Skip businesses with no Instagram" to require one) |
| Google reviews | Any number |
| Weak website | 2 or more of: slow (over 4 seconds), no contact form, no preloader, old © year, Google PageSpeed under 50. Or any one of: not loading, no HTTPS, not set up for phones. |
| Also available | No WhatsApp button, no tap-to-call, weak SEO, no Meta Pixel/Analytics, built on Wix/GoDaddy/other DIY builders |

**Score (out of 100):**
- Up to 45 for the opportunity: no website, dead website, or a weak website
  (more problems = more points).
- Up to 25 for Instagram followers.
- Up to 20 for Google reviews and rating.
- 10 for a mobile number, and 4 more if the Google listing isn't claimed.

**Hot** is 70 or more, **Good** is 50 or more. A lead is **Low** if it's under
your follower or review minimum, or its website looks fine.

## Good to know

- **Speed is measured on your connection.** The load time is how long the site
  takes in your Chrome. Add a free **Google PageSpeed key** under *What makes
  a good lead* to also get Google's official mobile speed score. That's a
  strong number to quote to a prospect. To get a key, go to Google Cloud,
  enable "PageSpeed Insights API" and create an API key. No card is needed.
- **Instagram.** The extension first tries a quick logged-out lookup. If
  Instagram returns nothing, it opens the profile in the background tab like a
  visit. If you're logged in to Instagram in this Chrome, that is your account
  viewing the profile.
  - Lookups are spaced 8–15 seconds apart, with a daily limit (150 by default).
  - If Instagram pushes back, Instagram checks pause for 15 minutes to 6 hours
    while websites keep being checked.
  - The safest set-up is a Chrome profile that isn't logged in to your main
    Instagram account.
  - Instagram's rules don't allow automated collection, so keep it modest.
- **Google Maps.**
  - Use Maps in English (the panel warns you if it isn't), so ratings and
    reviews can be read.
  - Google's terms don't allow automated collection. Run a few searches at a
    time. If Google shows a "not a robot" check, the collection stops, your
    leads so far are kept, and you can continue after solving it.
- **If Google or Instagram change their pages**, parts of the collection or
  the checks can stop working. The panel says when it couldn't read
  something. Send a screenshot and it can be updated.
- **Your leads stay in this Chrome profile.** Nothing is uploaded anywhere.
  Use the export buttons to keep a copy.
- **It doesn't press send for you.** WhatsApp bans numbers that send automated
  messages to people who haven't saved them. Aim for 20–40 new chats a day.
  The panel warns you at 30.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Chrome extension manifest (MV3, side panel) |
| `content.js` | Runs on Google Maps. It scrolls the results feed, opens each `/maps/place/` result, and reads the details panel (`data-item-id` phone, `authority` website, address), rating and review aria-labels, social links and the "claim this business" link. |
| `leads.js` | Shared basics: settings, phone parsing and mobile detection, website and Instagram link rules |
| `rules.js` | Website issues, the lead score and verdict, the WhatsApp messages, exports |
| `qualify.js` | The checker queue, run from the panel. It drives the background tab (webNavigation + scripting), PageSpeed, and the Instagram lookup with pacing and back-off. |
| `probe.js` | Functions injected into a business website / Instagram profile to read what's on the page |
| `panel.html/.css/.js` | The side panel |
| `background.js` | Opens the panel when the toolbar icon is clicked |

Tests:

- `node test/unit.mjs` tests the rules.
- `node test/e2e.mjs` loads the extension into Chromium with Playwright. It
  collects from `test/fake-maps.html` (a stand-in Google Maps page), checks
  stand-in websites served locally (fast, slow, contact-page form, not
  mobile-friendly, parked, 404) and fake Instagram profiles, then checks every
  verdict, the WhatsApp text and the exports.

The stand-in pages copy the Maps and Instagram markers that current scrapers
rely on (researched October 2026). They have not been run against live Google
Maps or Instagram, so check the first real run.
