# Elheen on Instagram (@getelheen)

The goal of the page is trust, not hard selling: anyone who lands on it should
think "these people are real, they know my business, and the product exists".
So most posts teach owners something useful or show the real product, and only
a few ask for anything (Hormozi: give, give, give, then ask).

## What is here

| Path | What it is |
|---|---|
| `posts/` | Finished posts, 1080 × 1350 JPEG (Instagram portrait), numbered in posting order. Also live at `https://elheen.com/social/<file>` |
| `posts.json` | The words for every post and its caption. Edit here, then redraw |
| `schedule.csv` | Day, image file, public image URL and caption for each post, for an auto-poster |
| `POSTER-PROMPT.md` | The prompt that hands daily posting to the auto-poster chat |
| `screens/` | Real app screenshots used in posts (example business, made-up names) |
| `make-posts.cjs` | Redraws every post from `posts.json` |

Redraw after editing `posts.json`: `node social/make-posts.cjs` (from the
`elheen` folder; needs Playwright).

Post 1 first and 9 last, so the newest sits top-left and the grid reads well.

## Four kinds of post

1. **Owner lesson** (3 a week): one practical idea for service businesses. Broad
   enough for any trade, with home improvement examples. Never fake numbers.
2. **Inside Elheen** (1 to 2 a week): one real screen and what it saves the owner.
   Say "example business shown".
3. **Behind the build** (1 a week): what shipped, what owners asked for, and
   who is building it. A face and a voice are the strongest trust signal.
4. **Offer or FAQ** (1 a week): free trial, founding price, honest answers.

## Weekly rhythm

| Day | Post |
|---|---|
| Sunday | Owner lesson |
| Monday | Inside Elheen |
| Tuesday | Owner lesson |
| Wednesday | Behind the build |
| Thursday | Owner lesson |
| Friday | FAQ or a question to the audience |
| Saturday | Offer |

## Days 1 to 9 (done, in `posts/`)

1. Hello: Elheen means now
2. Most jobs are not lost on price
3. Inside: Today, only what needs you
4. The 2 · 5 · 10 rule for quotes
5. Inside: a quote your client accepts with one tap
6. Ask 4 things before a free site visit
7. Built in Dubai, AED 79, no commission
8. Get extra work approved in writing
9. Founding price: first 100 keep AED 79

## Days 10 to 30 (topics to make next)

10. Lesson: reply within the hour; the first business to reply usually gets the visit
11. Inside: the enquiry link (use `screens/enquiry.png`)
12. Lesson: never send a price without a valid-until date
13. Build: what we shipped this week
14. Lesson: split every job into deposit, progress and handover
15. FAQ: do my clients need an app? (no)
16. Offer: 14 days free, no card, ready in five minutes
17. Lesson: the polite way to say "that is below our minimum"
18. Inside: every lead and job by stage (use `screens/leads.png`)
19. Lesson: confirm every site visit the day before
20. Build: why I am building Elheen (a short talking video works best)
21. Lesson: photos first, price second
22. FAQ: does it send WhatsApp messages by itself? (honest: it writes them, you tap send from your own number)
23. Offer: founding price reminder
24. Lesson: ask for the review on handover day
25. Inside: what every job has paid and still owes
26. Lesson: your Instagram bio should do one job, sending people to your enquiry form
27. Build: a feature an owner asked for, and how it works now
28. Lesson: three numbers to check every Monday (new leads, quotes out, money owed)
29. FAQ: what does it cost? (everything for AED 79, whole team)
30. Offer: everything Elheen does, as a carousel

## Rules for every post

- Plain words, short sentences. Same voice as the website (`BRAND.md`).
- No made-up numbers, reviews or client names presented as real.
- One idea per post. If it needs two, make two posts.
- End lessons with "save this", Inside posts with what it saves, offers with "link in bio".
