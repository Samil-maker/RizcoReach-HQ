# RizcoReach — www.rizcoreach.ae

Website development, SEO & Meta Ads agency site. English + Arabic (RTL).

Built with [Astro](https://astro.build) (static output) and deployed on Netlify.

## Run locally

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
```

## Deploying

Netlify builds automatically from `main` using `netlify.toml`
(`npm run build`, publish `dist/`, Node 22). Every pull request gets a
deploy preview.

## Where things live

| What | Where |
| --- | --- |
| Page copy (EN + AR) | `src/content/*.ts` (home, services, industries, contact, tools, legal) |
| Navigation & footer strings | `src/i18n/ui.ts` |
| Contact details, socials, address | `src/i18n/utils.ts` (`SITE`) |
| Pages / routes | `src/pages/[...lang]/…` (one file serves both `/` and `/ar`) |
| Design tokens & global styles | `src/styles/global.css` |
| Liquid chrome hero (WebGL) | `src/scripts/liquid-chrome.ts` |
| Website audit API | `netlify/functions/audit.mts` (`/api/audit`) |
| Lighthouse scores (optional) | `netlify/functions/pagespeed.mts` (`/api/pagespeed`) |
| Estimator timelines | top of `src/scripts/tools/estimator.ts` |
| Meta Ads CPL benchmarks | `src/content/tools.ts` (`ads.industries`) |
| Lead Hunter Chrome extension (website leads from the Meta Ad Library, Meta ads clients from Google Maps; not deployed) | `lead-hunter/` (see its README) |
| Lead Hunter phone queue (private) | `netlify/functions/lead-queue.mts` (`/api/lead-queue`) + `public/outreach.html` (`/outreach`) |
| Lead Desk: confirm clients' ad leads on one WhatsApp number (private) | `netlify/functions/lead-desk.mts` (`/api/desk`, `/api/desk/in/<token>`) + `public/desk.html` and `public/desk-assets/` (`/desk`) |

## Leads

Every lead (contact form **and** the email gates on the free tools) is sent to
the single Netlify form **`contact`**, so existing email notifications keep
working. The `lead_source` field says where it came from
(`contact-form`, `industry-page:…`, `website-audit`, `seo-calculator`,
`meta-ads-calculator`, `website-estimator`) and `tool_details` carries the
result summary (e.g. the audit score and issues).

## Optional: Google Lighthouse scores in the website audit

The audit works without any key. To also show Google Lighthouse scores:

1. In Google Cloud Console, enable **PageSpeed Insights API** and create an
   **API key** (APIs & Services → Credentials). A Google AI Studio / Gemini key
   will not work for this API.
2. In Netlify: Site configuration → Environment variables → add
   `PAGESPEED_API_KEY` with that key, then redeploy.

## Optional: Lead Hunter phone queue

Lets the Lead Hunter extension send leads to a private page on your phone
(`/outreach`). Off until you set it up:

1. In the extension: Settings → Phone queue → Generate a key → Copy key.
2. In Netlify: Site configuration → Environment variables → add
   `LEAD_QUEUE_KEY` with that key, then redeploy.

Data is stored in Netlify Blobs (store `lead-queue`). Every request needs the
key; without `LEAD_QUEUE_KEY` the endpoint answers 503.

## Optional: Lead Desk

A private page (`/desk`) for confirming your clients' ad leads on one
WhatsApp number. Each client gets a private intake link; Make.com or Zapier
(Facebook Lead Ads → HTTP POST) or a website form posts leads to it. The desk
alerts you (ntfy and/or Telegram), lists each lead's next step with the
client's script ready, and opens WhatsApp with the message typed: you press
Send. It tracks follow-ups, bookings, reminders, hand-over to the client and
show-ups, and builds a per-client report. Nothing is sent automatically.

1. Netlify: Site configuration → Environment variables → add `LEAD_DESK_KEY`
   (a random string of 24+ characters), then redeploy. Without it the desk
   falls back to `LEAD_QUEUE_KEY`; a separate key is better.
2. Open `/desk`, paste the key, then follow Setup (your details, alerts,
   phone link, clients).

Data is stored in Netlify Blobs (store `lead-desk`). The admin API needs the
key; intake links are per-client secrets that only add leads.

Tests: `npm test` (unit) and `node tests/desk-e2e.mjs` (Playwright, real
Chromium against the real handler).

## Design system

Design decisions were generated with the UI/UX Pro Max skill, installed for
Claude Code in `.claude/skills/ui-ux-pro-max`.
