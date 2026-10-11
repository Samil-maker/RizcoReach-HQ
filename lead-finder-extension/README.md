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
kept.

The extension needs access to all websites so it can open and check each
business's website. An unpacked extension gets this when you load it, without a
pop-up. If you've limited its site access in chrome://extensions, the panel
shows an **Allow website checks** button.

## How it works

1. **Find businesses.** Open [Google Maps](https://www.google.com/maps?hl=en)
   and search for a type of business in an area, e.g. *ladies salon in Al
   Barsha*. Click the RizcoReach icon, then **Collect leads from this search**.
   It opens every result (you'll see Maps moving) and saves each business with
   a mobile number, plus its website, Google rating, review count, and whether
   the owner has claimed the Google listing. It takes about 3 seconds per
   business, so 5–8 minutes for 120 results.

   If Maps shows only a landline but the business has a website, the extension
   looks there for a WhatsApp or mobile number before giving up.
2. **Check them.** This starts by itself. One at a time, each website opens in
   a muted background tab, where the extension:
   - times how long the site takes to load. A slow result is measured twice
     before it counts.
   - looks for:
     - a contact form, including on the contact page. Booking widgets count;
       newsletter, search, login and blog-comment forms don't.
     - a preloader
     - phone (mobile) set-up and HTTPS
     - a WhatsApp button and tap-to-call
     - signs of an old site: the footer © year, Flash, very old jQuery,
       table layouts
     - a free address like name.wixsite.com
     - SEO basics, and Meta Pixel / Google Analytics
   - spots dead sites: a domain that doesn't load, error pages, "for sale" or
     parked domains, suspended hosting, "coming soon" pages, and WordPress
     sites still showing the sample content. A site that doesn't answer is
     tried a second time before it counts as dead.
   - treats a domain that only forwards to Instagram, WhatsApp, Linktree or a
     booking page as **no website**.
   - sites behind bot protection (e.g. Cloudflare's "Just a moment…") are
     marked **couldn't check**, never "bad". The panel counts these, and
     **Try these again** re-runs them.
   - if your internet drops, nothing is saved for the leads it was checking,
     and checking carries on when the connection is back.

   It also finds the business's Instagram and reads the follower count. The
   account can come from Maps, from links on their website, or from their
   "website" being an Instagram page. Links like "Website by @someagency" are
   ignored. If no account is found, click **Add Instagram** on the lead,
   use **Search for it** to look it up, and paste the handle.
   **Keep the panel open while it checks.** Closing it pauses checking, and
   it carries on next time you open it. The background tab closes when it's
   done. **Pause checks** stays paused until you press **Check** again.
3. **Message the best ones.** The **Hot** tab shows your best leads first,
   each with the reasons:
   > **Hot 75** Glow Beauty Lounge
   > \+ Weak website: not mobile-friendly · © 2019
   > \+ Instagram @glowlounge · 2.1K followers
   > • 4.9★ · 310 Google reviews

   Click **WhatsApp**. WhatsApp Web opens with the right message typed in
   (one message for "no website", another for "weak website" that names the
   two biggest problems). Press send. If you didn't send it, click **Undo**
   on the card to put the lead back.

   A website that couldn't be checked gets a neutral message that makes no
   claims about it. **Do not contact** leads have no WhatsApp button.
4. **Save them.** **Download for Google Contacts** saves your Hot and Good
   leads that aren't in a Contacts file yet, which you then import at
   contacts.google.com. Importing the same people twice duplicates them on
   your phone, so it only offers **Download all again** when you ask. **Copy
   for Google Sheets** copies every lead, best first, with all the details.

## What makes a good lead

You can change all of this under **What makes a good lead** in the panel. The
defaults:

| Rule | Default |
| --- | --- |
| Businesses to collect | All with a mobile number (or only without / only with a website) |
| Instagram followers | At least 1,000 |
| No Instagram linked | Allowed, but the lead can be Good, not Hot, because its followers are unknown. Tick "Mark leads Low when no Instagram is linked" to require one, or use **Add Instagram** on the lead. |
| Google reviews | Any number |
| Weak website | 2 or more of: slow (over 5 seconds), no contact form (newsletter, search and login forms don't count), no preloader, looks outdated, Google PageSpeed under 50. Or any one of: not loading, no HTTPS, not set up for phones, a free address like name.wixsite.com. |
| Chains | The same website on 3 or more of your leads counts as a chain and goes to Low |
| Also available | No WhatsApp button, no tap-to-call, weak SEO, no Meta Pixel/Analytics, built on Wix/GoDaddy/other DIY builders |

**Score (out of 100):**
- Up to 45 for the opportunity: no website, dead website, or a weak website
  (more problems = more points).
- Up to 25 for Instagram followers.
- Up to 20 for Google reviews and rating.
- 10 for a mobile number, and 4 more if the Google listing isn't claimed.

**Hot** is 70 or more, **Good** is 50 or more. A lead is **Low** if it's under
your follower or review minimum, or its website looks fine. Those Low leads
show no score, because a rule put them there, not the points. Lists and
exports go Hot, Good, To check, then Low.

A lead can't be Hot while something important is unknown: a website that
couldn't be checked, or followers when you've set a minimum.

## Good to know

- **Speed is measured on your connection.** The load time is how long the site
  takes in your Chrome, in a background tab. If a chat widget or tracker
  never finishes, the time the page itself was ready is used instead. Messages therefore say "it took
  about 7 seconds to load **when we checked**". Add a free **Google PageSpeed key** under *What makes
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
  - If Instagram only shows profiles to logged-in visitors, the panel asks you
    to log in to Instagram in this Chrome (a spare account is safest).
  - Leads with no Instagram to look up aren't held up while Instagram is
    paused.
  - A follower count is only used if it belongs to that exact account. Unknown
    is never treated as 0.
  - The safest set-up is a Chrome profile that isn't logged in to your main
    Instagram account.
  - Instagram's rules don't allow automated collection, so keep it modest.
- **Google Maps.**
  - Use Maps in English, so ratings and reviews can be read. If it isn't, the
    panel shows an **Open Maps in English** button.
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
- **UAE sending hours.** UAE telemarketing rules (2024) limit marketing
  messages to 9am–6pm and respect the Do Not Call Registry. The panel warns you
  outside those hours. Check with a lawyer how the rules apply to messaging
  businesses.
- **Preloader** is on the list because you asked for it. Google doesn't score
  preloaders, so the extension never mentions one in a message to a business;
  it only uses it to sort leads. Untick it under *What makes a good lead* if
  you change your mind.

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
| `background.js` | Opens the panel when the toolbar icon is clicked; looks for a mobile number on a business's website when Maps only shows a landline |

Tests:

- `node test/unit.mjs` tests the rules.
- `node test/e2e.mjs` loads the extension into Chromium with Playwright. It
  collects from `test/fake-maps.html` (a stand-in Google Maps page), checks
  stand-in websites served locally (fast, slow, contact-page form, not
  mobile-friendly, parked, 404) and fake Instagram profiles, then checks every
  verdict, the WhatsApp text and the exports. It also runs the checker on a
  site that never answers, a file download, a domain that forwards to
  Linktree, and with the connection offline, and runs the website reader on
  tricky pages (newsletter forms, "coming soon" in normal text, image CDN
  links, lazy-loaded form embeds).

The stand-in pages copy the Maps and Instagram markers that current scrapers
rely on (researched October 2026). They have not been run against live Google
Maps or Instagram, so check the first real run.
