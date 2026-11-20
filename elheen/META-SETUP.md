# Connecting Meta and Google to Elheen: what Samil does

Elheen's code for Facebook and Instagram lead ads, Instagram messages, Facebook
messages, WhatsApp and Google Ads lead forms is built and tested. What is left
is set-up that only the owner of the Meta app and business can do. Never paste
secrets into a chat: add them in Netlify yourself.

## Works today: Google Ads lead forms

Nothing to approve. Each business opens Set-up › Google Ads lead forms in
Elheen, copies the webhook URL and key into their Google Ads lead form
(Export leads › Webhook integration) and presses "Send test data".

## Step 1, now (no trade licence needed)

1. **App secret.** In the Meta app (developers.facebook.com › your app ›
   App settings › Basic), copy the App secret. In Netlify › elheen › Site
   configuration › Environment variables, add `META_APP_SECRET` with it.
2. **Basic settings**, same page:
   - App domains: `elheen.com`
   - Privacy policy URL: `https://elheen.com/privacy.html`
   - Terms of service URL: `https://elheen.com/terms.html`
   - User data deletion › Data deletion instructions URL: `https://elheen.com/privacy.html#delete`
   - App icon (use `brand/elheen-mark.svg` exported as 1024 × 1024 PNG) and category Business.
3. **Facebook Login for Business** product › Settings › Valid OAuth redirect URI:
   `https://elheen.com/api/meta/callback`
4. **Webhooks** product. Callback URL `https://elheen.com/api/meta/webhook`,
   verify token: the value of `META_VERIFY_TOKEN` in Netlify. Subscribe:
   - Page: `leadgen`, `messages`
   - Instagram: `messages`
   - WhatsApp Business Account: `messages`
5. **Test on your own accounts** while the app is in development mode (it
   works for anyone with a role on the app):
   - Connect your own Facebook page in Elheen › Set-up, then send a test lead
     with Meta's Lead Ads Testing Tool. It should appear in Leads.
   - Tell Claude to switch on messaging for testing (`META_MESSAGING=on`),
     reconnect Facebook, turn on Instagram › Settings › Messages › Connected
     tools › Allow access to messages, and send yourself a DM from another account.

## Step 2, after the trade licence (16 December)

6. **Business portfolio** at business.facebook.com, with the legal name exactly
   as on the trade licence.
7. **Verify the domain** elheen.com in the portfolio (Brand safety › Domains).
   Claude can add the DNS record or meta tag for you.
8. **Business verification** (Security Center › Start verification), uploading
   the trade licence. This can take from a few days to a few weeks.
9. **Link the app** to the portfolio (App settings › Basic › Business portfolio)
   and complete **Access verification** as a Tech Provider, because Elheen
   connects other businesses' accounts.
10. **App Review › Permissions and features.** Request Advanced Access for
    `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
    `pages_manage_ads`, `leads_retrieval`, `pages_messaging`,
    `instagram_basic`, `instagram_manage_messages`,
    `whatsapp_business_management` and `whatsapp_business_messaging`.
    Each needs a short screen recording of the feature working in Elheen and a
    sentence on why it is needed. Claude can write these and set up a demo account.
11. **Switch the app to Live.**
12. **WhatsApp Embedded Signup.** In the app's WhatsApp product, create the
    Embedded Signup configuration (Facebook Login for Business configuration for
    WhatsApp), with WhatsApp Business app onboarding (coexistence) enabled, so
    businesses keep using the WhatsApp Business app on the same number. Add its
    Configuration ID in Netlify as `META_WA_CONFIG_ID`.
13. **Switch everything on:** add `META_MESSAGING` = `on` in Netlify and redeploy.
    The WhatsApp panel and Instagram messages then appear for every business.

## Good to know

- Replies sent from Elheen within 24 hours of a client's last message are
  "service" messages. Under Meta's current pricing these are free; check Meta's
  WhatsApp pricing page before launch, as it changes. Elheen only lets owners
  reply inside that window, and shows why when it has passed.
- Every business must turn on "Allow access to messages" in Instagram for its
  DMs to reach Elheen. Elheen tells them in Set-up.
- Meta's app review is strict about screen recordings. Record each permission
  being used, start to finish, on the live site.
