# Elheen

The Elheen website, brand files and plan. This folder is separate from the
rizcoreach.ae site: nothing here is built or deployed by the main site.

| Path | What it is |
|---|---|
| `src/pages/` | The pages: home, product, who it's for, founding offer, about, thanks |
| `src/partials/` | Header, footer and the founding-place form, shared by every page |
| `src/assets/` | Styles, script, fonts, logo mark, link-preview image |
| `brand/` | Logo mark and the Instagram profile picture |
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

1. Buy elheen.com.
2. In Netlify, add a new site from this repository and set **Base directory** to `elheen`.
   The build command and publish folder are read from `netlify.toml`.
3. Add elheen.com as the site's domain.
4. In Netlify, turn on email notifications for the form `elheen-founders`.

## Editing

- Change wording in `src/pages/*.html`.
- The first line of each page holds its title and description.
- Header, footer and form live once in `src/partials/`.
- Colours and sizes are the variables at the top of `src/assets/styles.css`.

## The app

The software lives in the same site as the marketing pages.

| Address | What it is |
|---|---|
| `/app` | The owner's app: enquiries, calendar, set-up |
| `/b/<business-name>` | That business's public enquiry page |
| `/api/...` | The server, in `netlify/functions/api.mjs` |

Data is stored in Netlify Blobs (store `elheen`). New businesses can only be
created with the invite code held in the Netlify setting `ELHEEN_INVITE`.

Leads from an ad form or another system can be posted to
`/api/intake/<business-name>/<intake key>`. The key is shown to the owner's
account as `intakeKey`.

Test it on your computer:

```
npm install
npm test                      # server tests
node build.mjs && node tests/local-server.mjs   # full app at localhost:8770, invite code "letmein"
```
