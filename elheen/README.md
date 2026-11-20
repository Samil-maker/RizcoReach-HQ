# Elheen

The Elheen website, brand files and plan. This folder is separate from the
rizcoreach.ae site: nothing here is built or deployed by the main site.

| Path | What it is |
|---|---|
| `src/pages/` | The marketing pages, plus the app (`app`), enquiry page (`b`), quote page (`q`) and admin |
| `src/partials/` | Header, footer and the founding-place form, shared by every page |
| `src/assets/` | Styles, script, fonts, logo mark, link-preview image |
| `brand/` | Logo mark and the Instagram profile picture |
| `social/` | Instagram posts, captions, schedule and content plan for @getelheen |
| `build.mjs` | Puts the pages together into `dist/` |
| `BRAND.md` | Name, voice, logo, colours, type |
| `PLAN.md` | Stage-by-stage plan from 2026 to 2036 |

## Preview on your computer

```
cd elheen
node build.mjs
npx serve dist
```

Open the address it prints. Opening the files directly also works, but the
fonts only load through a local server.

## Putting it live

The site is live on Netlify (site `elheen`) at elheen.com. Turn on email
notifications for the form `elheen-founders` in Netlify to hear about every
set-up request.

## Editing

- Change wording in `src/pages/*.html`.
- The first line of each page holds its title and description.
- Header, footer and form live once in `src/partials/`.
- Colours and sizes are the variables at the top of `src/assets/styles.css`.

## The app

The software lives in the same site as the marketing pages.

| Address | What it is |
|---|---|
| `/app` | The owner's app: Today, Leads, Quotes, Calendar, Set-up |
| `/b/<business-name>` | That business's public enquiry page |
| `/q/<link>` | A client's quote: accept, decline, ask on WhatsApp, save as PDF |
| `/admin` | Every business, its plan and payments (needs the admin key) |
| `/api/...` | The server, in `netlify/functions/api.mjs` |

Shared rules (prices, quote maths, the daily follow-up list) are in
`netlify/lib/core.mjs`. A scheduled function, `netlify/functions/daily.mjs`,
sends each owner their follow-up count at 9am Dubai time.

Data is stored in Netlify Blobs (store `elheen`). Anyone can start a 14-day trial at `/app?new`; a hidden field and a limit of
five sign-ups a day per connection keep bots out.

Leads from an ad form or another system can be posted to
`/api/intake/<business-name>/<intake key>`. The key is shown to the owner's
account as `intakeKey`.

Test it on your computer:

```
npm install
npm test                      # server tests
node build.mjs && node tests/local-server.mjs   # full app at localhost:8770
```

## Billing (Elheen's own price)

One plan with everything: AED 79 a month or AED 790 a year, paid by card into
the Elheen Ziina account. New businesses get 14 days free. Ziina has no
subscriptions, so each payment buys one or twelve months; the app shows a
banner 5 days before the end. After a 7-day grace period the app asks for
payment before showing leads again; the enquiry page keeps taking enquiries.

Netlify settings: `ZIINA_TOKEN` (the Elheen Ziina access token, secret),
`ZIINA_TEST` (`true` while testing) and `ELHEEN_URL` (`https://elheen.com`).
Payments are confirmed by a signed Ziina webhook at `/api/billing/webhook` and
again when the owner returns to the app.

## Connections

Facebook and Instagram lead ads, Instagram and Facebook messages, WhatsApp and
Google Ads lead forms. What the owner must set up at Meta is in `META-SETUP.md`.
Netlify settings: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`,
`META_MESSAGING` (`on` once Meta approves messaging) and `META_WA_CONFIG_ID`
(the WhatsApp Embedded Signup configuration). Google Ads lead forms post to
`/api/google/<business>` with the business's key, shown in Set-up.

## The booking page

Each business designs its page in Set-up › Your booking page, with a live phone
preview: logo, cover photo, colour (suggested from the logo or the website),
light, tinted or dark, corner style, heading style, headline, about text,
Instagram and website. "Import" reads the business's website for its colours,
icon, cover image and description. Instagram import works once Facebook and
Instagram are connected.

## Team logins

The owner creates a login per person in Set-up. "Full access" sees everything
except the plan, logins and connections; "Their visits only" sees just the
leads given to them and can add site notes. Removing a login signs that person
out everywhere.

## Admin

`/admin` lists every business with its plan, payments, leads and quotes, and
can add or remove months (for cash or bank payments), mark a business as
included (done-for-you clients), and reset a password. It needs the key in the
Netlify setting `ELHEEN_ADMIN_KEY`.
