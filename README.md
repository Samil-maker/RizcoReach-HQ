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

## Leads

Every lead (contact form **and** the email gates on the free tools) is sent to
the single Netlify form **`contact`**, so existing email notifications keep
working. The `lead_source` field says where it came from
(`contact-form`, `industry-page:…`, `website-audit`, `seo-calculator`,
`meta-ads-calculator`, `website-estimator`) and `tool_details` carries the
result summary (e.g. the audit score and issues).

## Lead Engine (outbound leads)

`lead-engine/` is a separate Google Sheets + Apps Script tool. It finds
businesses with no website on Google Maps (and HERE), keeps their mobile
numbers, copies them to Google Contacts and has a WhatsApp outreach panel. It
isn't part of the website build. Setup guide: [`lead-engine/README.md`](lead-engine/README.md).

## Optional: Google Lighthouse scores in the website audit

The audit works without any key. To also show Google Lighthouse scores:

1. In Google Cloud Console, enable **PageSpeed Insights API** and create an
   **API key** (APIs & Services → Credentials). A Google AI Studio / Gemini key
   will not work for this API.
2. In Netlify: Site configuration → Environment variables → add
   `PAGESPEED_API_KEY` with that key, then redeploy.

## Design system

Design decisions were generated with the UI/UX Pro Max skill, installed for
Claude Code in `.claude/skills/ui-ux-pro-max`.
