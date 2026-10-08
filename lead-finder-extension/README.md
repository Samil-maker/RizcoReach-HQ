# RizcoReach Lead Finder (Chrome extension)

Search Google Maps, click one button, and get the **mobile numbers of businesses
that have no website**. Message them on WhatsApp from the same panel, and save
them to Google Contacts or Google Sheets. No accounts, API keys or setup.

## Install (about 2 minutes)

1. Unzip `rizcoreach-lead-finder.zip`. You get a folder called
   **rizcoreach-lead-finder**. Keep that folder somewhere safe, because the
   extension stops working if you delete it.
2. In Chrome, go to **chrome://extensions**.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and choose the **rizcoreach-lead-finder** folder.
5. Click the puzzle-piece icon in Chrome's toolbar and pin
   **RizcoReach Lead Finder**.

## Use it

1. Open [Google Maps](https://www.google.com/maps) and search for a type of
   business in an area, e.g. **ladies salon in Al Barsha**.
2. Click the RizcoReach icon in the toolbar. The Lead Finder opens on the
   right-hand side.
3. Click **Collect leads from this search**. It opens each result in turn
   (you'll see Maps moving) and keeps the ones with no website and a mobile
   number. A search takes about a minute. Keep the Maps tab open while it runs.
4. Do another search (another area or business type) and collect again.
   Numbers you already have are skipped.
5. Click **WhatsApp** next to a lead. WhatsApp Web opens with your message
   already typed in. Press send. The lead moves to *Messaged*.
6. Save your leads:
   - **Download for Google Contacts**, then on
     [contacts.google.com](https://contacts.google.com) click **Import** and
     choose the file. The leads appear as "Lead - Business name" under the
     label *RizcoReach Leads* and sync to your phone. Each download only
     includes leads you haven't downloaded before.
   - **Copy for Google Sheets**, then open [sheets.new](https://sheets.new),
     click cell A1 and paste.
   - **Download spreadsheet (CSV)** for Excel or anything else.

Change the WhatsApp message, the daily chat limit and the other options under
**Settings** at the bottom of the panel.

## Good to know

- **What counts as a lead.** A business counts if its Google Maps listing has
  no website, or the "website" is only an Instagram, Facebook, Linktree,
  WhatsApp, Fresha or similar page. It also needs a mobile number: in the UAE
  that's 05…, and other countries can be picked in Settings. Closed businesses
  are skipped.
- **It reads the page you're looking at.** The extension goes through Google
  Maps the way you would by hand, one listing at a time. Google's terms don't
  allow automated collection, so use it at a normal pace: a few searches at a
  time, not hundreds in a row. Google may now and then ask you to prove you're
  not a robot.
- **If Google changes its Maps page**, collecting can stop working. The panel
  will say it couldn't read the businesses. Send a screenshot and it can be
  updated.
- **Your leads live in this Chrome profile.** Nothing is uploaded anywhere.
  Use the export buttons to keep a copy.
- **It doesn't press send for you.** WhatsApp bans numbers that send automated
  messages to people who haven't saved them. Opening each chat ready to go and
  pressing send yourself keeps your number safe. Keep to 20–40 new chats a day.
  The panel warns you at 30.

## Updating to a new version

Replace the files in the **rizcoreach-lead-finder** folder with the new ones.
Then click the ↻ reload icon on the extension's card in **chrome://extensions**.
Your leads are kept.

## For developers

| File | What it does |
| --- | --- |
| `manifest.json` | Chrome extension manifest (MV3, side panel) |
| `content.js` | Runs on Google Maps. It scrolls the results feed (`div[role=feed]`), opens each `/maps/place/` result, reads the details panel (`data-item-id="phone:tel:…"`, `"authority"`, `"address"`) and saves leads to `chrome.storage.local`. |
| `leads.js` | Shared rules: phone parsing and mobile detection, website rules, message and export formats |
| `panel.html/.css/.js` | The side panel |
| `background.js` | Opens the panel when the toolbar icon is clicked |

Tests:

- `node test/unit.mjs` tests the rules in `leads.js`.
- `node test/e2e.mjs` loads the extension into Chromium with Playwright and
  runs it against `test/fake-maps.html`, a stand-in Google Maps page served at
  a Maps URL.

The fake page copies the Maps page markers the content script relies on. It
has not been run against live Google Maps, so check the first real collection.
