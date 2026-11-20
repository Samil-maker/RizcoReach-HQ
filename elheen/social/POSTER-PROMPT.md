I want this chat to run Instagram posting for my second business, Elheen (@getelheen), alongside RizcoReach, using the auto-poster we already built here. Keep RizcoReach exactly as it is. Add Elheen as a second account next to it.

## What Elheen is

Elheen (elheen.com, Instagram @getelheen) is software I am building in Dubai for UAE service businesses: one place for every enquiry, site visit, quote and payment, and a short list each morning of who to follow up, with the WhatsApp message already written. One plan, AED 79 a month, 14 days free with no card. It is built first for home improvement (fit-out, renovation, interior design, maintenance) but also works for salons, clinics and car care.

The Instagram page should make people think "these people are real, they know my business, and the product exists". It is not a hard-selling page. Most posts teach owners something useful or show the real product; about one in seven asks for anything.

## Where the content is

GitHub repository `Samil-maker/RizcoReach-HQ`, branch `claude/inspiring-bell-jbp4ui` (or `main` once it is merged), folder `elheen/social/`. Add the repository to this session if it is not attached, and read `elheen/social/README.md` first.

- `posts/01-hello.jpg` to `posts/09-founding-price.jpg`: the first nine posts, 1080 × 1350 JPEG, ready to publish.
- `schedule.csv`: columns `day, file, image_url, caption`. Every `image_url` is a public address on elheen.com (for example `https://elheen.com/social/01-hello.jpg`) that Instagram's publishing API can fetch directly.
- `posts.json`: the words for every post and its caption.
- `make-posts.cjs`: draws posts from `posts.json` in the Elheen design (`node social/make-posts.cjs`, run from the `elheen` folder; needs Playwright).
- `README.md`: the content plan, the weekly rhythm and topics for days 10 to 30.

## What to build

1. Add Elheen as a second account in the poster, with its own settings: Instagram user ID, access token, schedule and post log. Nothing about RizcoReach changes.
2. Elheen's Instagram account must be a professional account linked to a Facebook Page, with a token that can publish content. If you need the token or the user ID, tell me exactly where to add them, using the same secure method the RizcoReach token uses (for example an environment variable such as `ELHEEN_IG_TOKEN`). Never ask me to paste a token into this chat.
3. Post one Elheen post a day, around 7pm Dubai time, in `day` order from `schedule.csv`: day 1 first, day 9 last, so the newest sits top-left and the grid reads well. Do not post both accounts in the same minute.
4. Keep a log of what has been posted, with the Instagram post ID, so nothing is posted twice and a failed day is retried, not skipped.
5. Before anything goes live, do a dry run and show me post 1 with its caption. Publish only after I say yes.

## After post 9

Make new posts from the topics for days 10 to 30 in `README.md`, following its weekly rhythm (Sunday lesson, Monday inside Elheen, Tuesday lesson, Wednesday behind the build, Thursday lesson, Friday FAQ, Saturday offer). Add each one to `posts.json` in the same shape as the others and draw it with `make-posts.cjs`, so every post keeps the same design. Host the new images the same way the RizcoReach posts are hosted, or commit them to the repository and tell me to redeploy elheen.com so they appear under `elheen.com/social/`. Show me each week's posts before they go live, until I tell you to stop asking.

## Brand

- Colours: deep aubergine `#1F0A24`, orchid `#A31A8A` (the only accent), soft grey `#F6F6F8`, white. No pink tints, no gradients, no glows.
- Type: Plus Jakarta Sans (bold, tight headlines); Readex Arabic for Arabic.
- Logo: the rounded "e" with a dot on an orchid tile, plus the word "elheen" (files are in `elheen/src/assets/`).
- Voice: plain words, short sentences, confident and warm, no jargon. Talk to the owner as an equal.

## Rules for every post

- Never make up numbers, reviews, client names presented as real, or claims like "UAE's #1". Screenshots use an example business; say "example business shown".
- Do not claim Elheen sends WhatsApp messages by itself. It writes them, and the owner sends them from their own number in one tap.
- Do not claim Arabic pages yet.
- One idea per post. End lessons with "save this", product posts with what it saves the owner, and offers with "link in bio".
- 5 to 8 hashtags, for example #Elheen #DubaiBusiness #UAEBusiness #SmallBusinessUAE #DubaiEntrepreneur, adding #FitOutDubai #InteriorDesignDubai #RenovationDubai when the post is about home improvement.

Start by reading `elheen/social/README.md` and `schedule.csv`, then tell me in a few lines how you will add Elheen to the poster and what you need from me.
