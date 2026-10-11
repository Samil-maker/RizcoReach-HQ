// End-to-end test: loads the real extension into Chromium, serves test/fake-maps.html
// at a Google Maps URL, serves stand-in business websites from a local server and
// fake Instagram profiles, and drives the side panel like a user would.
// Usage: node lead-finder-extension/test/e2e.mjs   (needs Playwright + Chromium)
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const EXT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS_DIR || '';
const YEAR = new Date().getFullYear();

// ─── Stand-in business websites ──────────────────────────────────────────────
const page = (body, { viewport = true, title = 'Salon', head = '' } = {}) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
  (viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : '') +
  `<meta name="description" content="A salon in Dubai">${head}</head><body><h1>${title}</h1>${body}</body></html>`;
const FORM = '<form action="/send"><input name="name" placeholder="Your name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>';
const SITES = {
  '/good/': page(
    `<div id="preloader"></div><a href="tel:+971502222222">Call</a><a href="https://wa.me/971502222222">WhatsApp</a>${FORM}` +
      `<footer>© ${YEAR} Good Salon · <a href="https://www.instagram.com/goodsalon/">Instagram</a></footer>`,
    { title: 'Good Salon' }
  ),
  '/slow/': page(`<p>Welcome</p><footer>© ${YEAR} Slow Salon</footer>`, { title: 'Slow Salon' }),
  '/glow/': page(
    `<div class="page-loader"></div><a href="/glow/contact">Contact us</a><footer>Copyright © 2019 Glow · <a href="https://instagram.com/glowlounge">IG</a></footer>`,
    { viewport: false, title: 'Glow Beauty Lounge' }
  ),
  '/glow/contact': page(FORM, { viewport: false, title: 'Contact Glow' }),
  '/landline/': page(`<p>Book now</p><a href="https://wa.me/971551234567?text=Hi">WhatsApp us</a><footer>© ${YEAR} Landline Spa</footer>`, { title: 'Landline Spa' }),
  '/parked/': page('<p>This domain is for sale! Buy this domain today.</p>', { title: 'parked-salon.ae' }),
  '/ig-profile/':
    '<html><head><title>Noor (@noorsalon) • Instagram photos and videos</title>' +
    '<meta property="og:description" content="5,200 Followers, 10 Following, 99 Posts - See Instagram photos and videos from Noor (@noorsalon)">' +
    '</head><body><script type="application/json">{"viewer":{"username":"someone_else","follower_count":999}}</script>' +
    '<script type="application/json">{"require":[["x",{"__bbox":{"result":{"data":{"user":{"username":"noorsalon","follower_count":5213}}}}}]]}</script></body></html>',
  '/probe/comment/': page(
    '<form role="search"><input type="search" name="s"><button>Search</button></form>' +
      '<form class="mc4wp-form"><input type="email" name="EMAIL"><button>Subscribe</button></form>' +
      '<form id="commentform" action="/wp-comments-post.php"><input name="author"><input type="email" name="email"><textarea name="comment"></textarea><button>Post Comment</button></form>'
  ),
  '/probe/cf7/': page(
    '<div class="swiper"><div class="swiper-lazy-preloader"></div></div>' +
      '<div class="wpcf7"><form class="wpcf7-form"><input name="your-name"><input type="email" name="your-email"><textarea name="your-message"></textarea><span class="wpcf7-spinner"></span></form></div>'
  ),
  '/probe/elementor/': page('<e-preloader></e-preloader><div class="joinchat joinchat--btn"><div class="joinchat__button"></div></div>'),
  '/probe/removed/': page('<div id="preloader"></div><p>Hi</p><script>window.addEventListener("load", () => document.getElementById("preloader").remove())</script>'),
  '/probe/wpdemo/': page('<nav><a href="/sample-page/">Sample Page</a></nav><h2>Hello world!</h2><p>Welcome to WordPress.</p>', { title: 'My Site – Just another WordPress site' }),
  '/probe/challenge/': page('<div id="challenge-stage"></div>', { title: 'Just a moment...' }),
  '/probe/wix/': page('<div><input type="email" placeholder="Email"><textarea placeholder="Message"></textarea><button>Send</button></div>', {
    head: '<meta name="generator" content="Wix.com Website Builder">',
  }),
  '/probe/booking/': page('<iframe src="https://calendly.com/noor/30min"></iframe>'),
  '/probe/godaddy-wp/': page('<link rel="stylesheet" href="/wp-content/themes/x/style.css"><img src="https://img1.wsimg.com/logo.png">'),
  '/probe/instagram-links/': page(
    '<script src="https://www.instagram.com/embed.js"></script>' +
      '<footer><a href="https://www.instagram.com/realsalon/">Follow us</a> · <span>Website by <a href="https://instagram.com/bigagency">BigAgency</a></span></footer>' +
      '<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https://www.instagram.com/realsalon_ae"]}</script>'
  ),
  '/probe/godaddy/': page('', { head: '<meta name="generator" content="Starfield Technologies; Go Daddy Website Builder 8.0.0000">' }),
  // Working sites that only mention "coming soon" / "how it works" are not placeholders.
  '/probe/branch/': page('<p>Our new JLT branch is coming soon! Book at Al Barsha meanwhile.</p>', { title: 'Noor Salon' }),
  '/probe/howitworks/': page("<h2>Here's how it works!</h2><p>Pick a service and book.</p>", { title: 'Noor Salon' }),
  '/probe/soon/': page('<p>We are launching soon.</p>', { title: 'Coming Soon' }),
  '/probe/cdn-ig/': page(
    '<a href="https://scontent.cdninstagram.com/v/t51.2885-15/abc.jpg">photo</a><a href="https://www.instagram.com/realone/">Instagram</a>'
  ),
  '/probe/quote-footer/': page(
    '<blockquote><p>Lovely salon!</p><footer class="blockquote-footer">Sara</footer></blockquote><footer>Copyright © 2019 Noor Salon</footer>'
  ),
  '/probe/newsletter/': page(
    '<div class="elementor-widget-form"><form class="elementor-form"><input type="email" name="form_fields[email]" placeholder="Email"><button>Subscribe</button></form></div>' +
      '<form><input name="first_name" placeholder="First name"><input type="email" name="email"><button>Submit</button><p>Join our mailing list</p></form>'
  ),
  '/probe/lazy-form/': page('<iframe src="about:blank" data-lazy-src="https://form.jotform.com/123456"></iframe>'),
  '/ig-missing/': "<html><head><title>Page not found • Instagram</title></head><body><h2>Sorry, this page isn't available.</h2></body></html>",
};
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/hang/') return; // a dead host that accepts the connection and never answers
  if (path === '/file/') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="menu.pdf"' });
    return res.end('%PDF-1.4');
  }
  if (path === '/to-links/') {
    // A domain that only forwards to a link-in-bio page (linktr.ee resolves to this server in the test).
    res.writeHead(302, { location: `http://linktr.ee:${server.address().port}/noorsalon` });
    return res.end();
  }
  if (path === '/noorsalon') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page('<a href="https://www.instagram.com/noorsalon/">Instagram</a>', { title: 'Noor | Linktree' }));
  }
  const send = () => {
    if (SITES[path]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SITES[path]);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not Found</h1>');
    }
  };
  if (path === '/slow/') setTimeout(send, 6000);
  else send();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// Hostnames like good.test all resolve to this server (see --host-resolver-rules below).
const SITE = `http://test:${server.address().port}`;
const site = (name, path) => SITE.replace('://', '://' + name + '.') + path;

// ─── Fake Instagram profiles ─────────────────────────────────────────────────
const INSTAGRAM = { noorsalon: '5,200', goodsalon: '12K', instaonly: '800', glowlounge: '2,100', lastsalon: '3,400' };
const igLookups = [];

const ctx = await playwright.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lf-')), {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP *.test 127.0.0.1, MAP test 127.0.0.1, MAP linktr.ee 127.0.0.1'],
});

try {
  const FAKE_MAPS = readFileSync(new URL('./fake-maps.html', import.meta.url), 'utf8').replace(/__SITE__/g, SITE);
  await ctx.route('https://www.google.com/maps**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_MAPS }));
  await ctx.route('https://www.instagram.com/**', (r) => {
    const handle = new URL(r.request().url()).pathname.split('/')[1];
    igLookups.push(handle);
    if (!INSTAGRAM[handle]) return r.fulfill({ status: 404, contentType: 'text/html', body: 'Page Not Found' });
    return r.fulfill({
      contentType: 'text/html',
      body: `<html><head><meta property="og:description" content="${INSTAGRAM[handle]} Followers, 10 Following, 99 Posts - See Instagram photos and videos from X (&#064;${handle})"></head></html>`,
    });
  });

  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker');
  const extId = worker.url().split('/')[2];

  const maps = await ctx.newPage();
  await maps.goto('https://www.google.com/maps/search/ladies+salon+in+al+barsha/');

  const panel = await ctx.newPage();
  const pageErrors = [];
  panel.on('pageerror', (e) => pageErrors.push(e.message));
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  // Local test sites are plain http, so leave the HTTPS rule out of this run.
  await panel.evaluate(() => chrome.storage.local.set({ settings: { criteria: { noHttps: false } } }));
  await panel.reload();

  await panel.waitForSelector('#ready:not([hidden])');
  assert.equal(await panel.textContent('#query'), 'ladies salon in al barsha');
  assert.equal(await panel.isChecked('#crit-noHttps'), false);
  assert.equal(await panel.isChecked('#crit-noForm'), true);

  // 1 · Collect. Businesses with websites are kept now.
  await panel.click('#collectBtn');
  await maps.bringToFront();
  await panel.waitForSelector('#summary:not([hidden])', { timeout: 120000 });
  const summary = (await panel.textContent('#summary')).replace(/\s+/g, ' ');
  console.log('collect:', summary);
  assert.equal(
    summary,
    'Done. "ladies salon in al barsha": 9 new leads (6 with a website, 1 mobile found on their website) · 13 opened · 1 closed · 2 no mobile · 1 already saved'
  );

  // 2 · Checks start by themselves and finish.
  await panel.waitForFunction(() => /All 9 leads are checked/.test(document.querySelector('#checkText').textContent), null, { timeout: 300000 });
  console.log('instagram lookups:', igLookups.join(', '));
  assert.deepEqual(igLookups.sort(), ['glowlounge', 'goodsalon', 'instaonly', 'noorsalon']);

  const leads = await panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith('lead:')).map((k) => all[k]);
  });
  const byName = Object.fromEntries(leads.map((l) => [l.name, l]));
  const sig = (name) => byName[name].checks.site.signals;
  console.log('slow load ms:', sig('Slow Salon').loadMs, '| good load ms:', sig('Has Website Salon').loadMs);
  assert.ok(sig('Slow Salon').loadMs >= 6000, 'slow site measured as slow');
  assert.ok(sig('Has Website Salon').loadMs < 4000, 'fast site measured as fast');
  assert.deepEqual({ ...sig('Has Website Salon').form }, { found: true, kind: 'form' });
  assert.equal(sig('Has Website Salon').preloader, true);
  assert.equal(sig('Has Website Salon').whatsapp, true);
  assert.equal(sig('Has Website Salon').tel, true);
  assert.deepEqual([...sig('Has Website Salon').instagram], ['goodsalon']);
  assert.equal(sig('Glow Beauty Lounge').form.where, 'contact page', 'form found on the contact page');
  assert.equal(sig('Glow Beauty Lounge').viewport, false);
  assert.equal(sig('Glow Beauty Lounge').copyrightYear, 2019);
  assert.equal(sig('Slow Salon').preloader, false);
  assert.equal(sig('Slow Salon').form.found, false);
  assert.equal(sig('Parked Salon').reachable, false);
  assert.match(sig('Parked Salon').failure, /for sale/);
  assert.equal(sig('Error Salon').reachable, false);
  assert.match(sig('Error Salon').failure, /HTTP 404/);
  assert.equal(byName['Noor Ladies Salon'].rating, 4.7);
  assert.equal(byName['Noor Ladies Salon'].reviews, 230);
  assert.equal(byName['Noor Ladies Salon'].socials.instagram, 'noorsalon');
  assert.equal(byName['Noor Ladies Salon'].checks.instagram.followers, 5200);
  assert.equal(byName['Last Salon'].checks.instagram.state, 'not_found');
  assert.equal(byName['Landline Spa'].e164, '+971551234567', 'mobile taken from the WhatsApp link on their website');
  assert.equal(byName['Landline Spa'].phoneSource, 'WhatsApp link on their website');
  assert.equal(byName['Last Salon'].unclaimed, true);
  assert.equal(byName['Noor Ladies Salon'].unclaimed, false);

  // 3 · Verdicts.
  await panel.bringToFront();
  const tab = async (f) => {
    await panel.click(`[data-filter="${f}"]`);
    return panel.$$eval('#list .lead', (els) =>
      els.map((e) => ({ name: e.querySelector('.lead-name').textContent, pill: e.querySelector('.pill').textContent, reasons: [...e.querySelectorAll('.reason')].map((r) => r.textContent) }))
    );
  };
  const hot = await tab('hot');
  console.log('hot:', JSON.stringify(hot));
  assert.deepEqual(hot.map((l) => [l.name, l.pill]), [['Noor Ladies Salon', 'Hot 96'], ['Glow Beauty Lounge', 'Hot 75']]);
  assert.deepEqual(hot[1].reasons, ['Weak website: not mobile-friendly · © 2019', 'Instagram @glowlounge · 2.1K followers', '4.9★ · 310 Google reviews']);
  const good = await tab('good');
  console.log('good:', JSON.stringify(good.map((l) => [l.name, l.pill])));
  assert.deepEqual(good.map((l) => [l.name, l.pill]), [
    ['Last Salon', 'Good 67'],
    ['Error Salon', 'Good 67'],
    ['Parked Salon', 'Good 61'],
    ['Slow Salon', 'Good 59'],
    ['Landline Spa', 'Good 53'],
  ]);
  assert.match(await panel.locator('.lead', { hasText: 'Landline Spa' }).locator('.lead-meta').textContent(), /\+971 55 123 4567 \(from their website\) · Spa/);
  assert.ok(good.find((l) => l.name === 'Last Salon').reasons.includes('Google listing not claimed by the owner'));
  assert.match(good.find((l) => l.name === 'Slow Salon').reasons[0], /^Weak website: slow \(6(\.\d)?s\) · no contact form · no preloader$/);
  const low = await tab('low');
  assert.deepEqual(low.map((l) => l.name).sort(), ['Has Website Salon', 'Insta Only Salon']);
  assert.match(low.find((l) => l.name === 'Has Website Salon').reasons[0], /^Website looks fine/);
  assert.equal(low.find((l) => l.name === 'Insta Only Salon').reasons[1], 'Instagram @instaonly · 800 followers');
  if (SHOTS) await panel.screenshot({ path: join(SHOTS, 'v2-panel.png'), fullPage: true });

  // Changing the criteria re-sorts instantly, without checking again.
  await panel.click('#criteriaBox summary');
  await panel.selectOption('#set-minFollowers', '0');
  await panel.waitForFunction(() => document.querySelector('[data-filter="low"] span').textContent === '1');
  await panel.selectOption('#set-minFollowers', '1000');
  await panel.waitForFunction(() => document.querySelector('[data-filter="low"] span').textContent === '2');

  // 4 · WhatsApp message mentions the real problems.
  await panel.evaluate(() => {
    window.__opened = [];
    ['create', 'update'].forEach((fn) => {
      const original = chrome.tabs[fn].bind(chrome.tabs);
      chrome.tabs[fn] = (...args) => {
        const props = fn === 'create' ? args[0] : args[1];
        if (props && props.url && /whatsapp/.test(props.url)) window.__opened.push(props.url);
        return original(...args);
      };
    });
  });
  // Outside 9am–6pm (UAE) the first click only warns; a second click sends.
  const sendWhatsApp = async (name, count) => {
    const button = panel.locator('.lead', { hasText: name }).locator('.wa');
    await button.click();
    if ((await button.textContent()) === 'Send anyway') await button.click();
    await panel.waitForFunction((n) => window.__opened.length === n, count);
  };
  await tab('good');
  await sendWhatsApp('Slow Salon', 1);
  const text = new URL(await panel.evaluate(() => window.__opened[0])).searchParams.get('text');
  console.log('message:', text);
  assert.match(text, /^Hi 👋 We had a look at Slow Salon's website and noticed it took about 6 seconds to load when we checked and there's no contact form for enquiries\./);
  await tab('hot');
  await sendWhatsApp('Noor Ladies Salon', 2);
  assert.match(new URL(await panel.evaluate(() => window.__opened[1])).searchParams.get('text'), /came across Noor Ladies Salon on Google Maps and noticed there's no website/);
  await panel.bringToFront();
  await panel.waitForFunction(() => document.querySelector('[data-filter="contacted"] span').textContent === '2');

  // 5 · Google Contacts file: hot and good leads, best first.
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.click('#contactsBtn')]);
  const csv = readFileSync(await download.path(), 'utf8');
  assert.ok(csv.startsWith('Name,Given Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Notes,Group Membership\r\nLead - Noor Ladies Salon,'), 'best lead first');
  assert.ok(csv.includes('Hot lead (96/100): No website'));
  assert.ok(!csv.includes('Has Website Salon'), 'low leads are left out');
  assert.match(await panel.textContent('#saveHint'), /Saved 7 new hot and good lead\(s\)/);

  // The Instagram page reader (used when the quick lookup comes back empty) on stand-in pages.
  const probeSource = readFileSync(new URL('../probe.js', import.meta.url), 'utf8');
  const igPage = await ctx.newPage();
  await igPage.goto(`${SITE}/ig-profile/`);
  assert.deepEqual(await igPage.evaluate(`(() => { ${probeSource}\n return rrProbeInstagram('noorsalon'); })()`), {
    path: '/ig-profile/', title: 'Noor (@noorsalon) • Instagram photos and videos',
    og: '5,200 Followers, 10 Following, 99 Posts - See Instagram photos and videos from Noor (@noorsalon)',
    header: '', description: '', followers: 5213, notFound: false,
  });
  await igPage.goto(`${SITE}/ig-missing/`);
  assert.equal((await igPage.evaluate(`(() => { ${probeSource}\n return rrProbeInstagram('ghost'); })()`)).notFound, true);
  // Without a username match, the other account's count is never used.
  await igPage.goto(`${SITE}/ig-profile/`);
  assert.equal((await igPage.evaluate(`(() => { ${probeSource}\n return rrProbeInstagram('someone'); })()`)).followers, null);
  await igPage.close();

  // The website reader on tricky stand-in pages (research-backed false positives/negatives).
  const reader = await ctx.newPage();
  // Like chrome.scripting does: run the reader without adding a <script> tag to the page.
  const runReader = (pg, call) => pg.evaluate(`(() => { ${probeSource}\n return ${call}; })()`);
  const readSite = async (path) => {
    await reader.goto(`${SITE}${path}`);
    return runReader(reader, 'rrProbeWebsite({})');
  };
  const comment = await readSite('/probe/comment/');
  assert.equal(comment.form.found, false, 'comment, newsletter and search forms are not contact forms');
  const cf7 = await readSite('/probe/cf7/');
  assert.equal(cf7.form.found, true, 'Contact Form 7 counts');
  assert.equal(cf7.preloader, false, 'CF7 spinner and slider loaders are not page preloaders');
  const elementor = await readSite('/probe/elementor/');
  assert.equal(elementor.preloader, true, 'Elementor <e-preloader>');
  assert.equal(elementor.whatsapp, true, 'Joinchat widget');
  const removed = await readSite('/probe/removed/');
  assert.equal(removed.preloader, false, 'the finished page no longer has the preloader…');
  const fromSource = await runReader(
    reader,
    `fetch(location.href).then((r) => r.text()).then((html) => rrProbeWebsite({ url: location.href, rawHtml: html }, new DOMParser().parseFromString(html, 'text/html')).preloader)`
  );
  assert.equal(fromSource, true, '…but its original code does');
  assert.equal((await readSite('/probe/wpdemo/')).placeholder, 'wordpress demo');
  assert.equal((await readSite('/probe/challenge/')).challenge, true);
  const wix = await readSite('/probe/wix/');
  assert.deepEqual([wix.form.found, wix.builder], [true, 'Wix'], 'form without a <form> tag on a Wix site');
  const booking = await readSite('/probe/booking/');
  assert.deepEqual({ ...booking.form }, { found: true, kind: 'booking widget' });
  assert.equal((await readSite('/probe/godaddy-wp/')).builder, 'WordPress', 'WordPress hosted at GoDaddy is WordPress');
  assert.equal((await readSite('/probe/godaddy/')).builder, 'GoDaddy');
  assert.deepEqual([...(await readSite('/probe/instagram-links/')).instagram], ['realsalon', 'realsalon_ae'], 'no embed.js, no designer credit');
  assert.equal((await readSite('/probe/branch/')).placeholder, '', '"our new branch is coming soon" is a working site');
  assert.equal((await readSite('/probe/howitworks/')).placeholder, '', '"how it works!" is not a server page');
  assert.equal((await readSite('/probe/soon/')).placeholder, 'coming soon');
  assert.deepEqual([...(await readSite('/probe/cdn-ig/')).instagram], ['realone'], 'Instagram image CDN links are not accounts');
  assert.equal((await readSite('/probe/quote-footer/')).copyrightYear, 2019, 'the page footer, not a testimonial footer');
  assert.equal((await readSite('/probe/newsletter/')).form.found, false, 'newsletter sign-ups (plugin or plain) are not contact forms');
  assert.deepEqual({ ...(await readSite('/probe/lazy-form/')).form }, { found: true, kind: 'embedded form' }, 'lazy-loaded form embed');
  await reader.close();

  // Adding an Instagram account by hand checks it straight away.
  await tab('good');
  const last = panel.locator('.lead', { hasText: 'Last Salon' });
  await last.getByRole('button', { name: 'Add Instagram' }).click();
  await last.locator('.ig-form input').fill('@LastSalon');
  await last.locator('.ig-form button').click();
  await panel.waitForFunction(() => [...document.querySelectorAll('#list .lead, .lead')].length && document.querySelector('[data-filter="hot"] span').textContent === '2', null, { timeout: 60000 });
  await tab('hot');
  assert.deepEqual(
    (await tab('hot')).find((l) => l.name === 'Last Salon').reasons.slice(0, 2),
    ['No website', 'Instagram @lastsalon · 3.4K followers']
  );

  // Recheck runs again for one lead.
  const before = igLookups.length;
  await tab('all');
  await panel.locator('.lead', { hasText: 'Insta Only Salon' }).locator('.linkish').click();
  for (let waited = 0; igLookups.length === before && waited < 60000; waited += 250) await new Promise((r) => setTimeout(r, 250));
  assert.equal(igLookups.length, before + 1);
  assert.equal(igLookups[igLookups.length - 1], 'instaonly');

  // The checker on sites that hang, download a file, forward to Instagram, or while offline.
  const check = (url) =>
    panel.evaluate(async (u) => {
      LeadChecker._tune({ page: 3000, fetch: 2000, retry: 300 });
      return LeadChecker._checkWebsite(u, LF.withDefaults({}));
    }, url);
  const fine = await check(site('good', '/good/'));
  assert.equal(fine.signals.reachable, true);
  // The tab still shows the good site: a hanging site must never be read as that page.
  const hang = await check(site('hang', '/hang/'));
  assert.equal(hang.state, 'done');
  assert.equal(hang.signals.reachable, false, 'a site that never answers is down…');
  assert.equal(hang.signals.failure, 'the server is not responding');
  assert.ok(!hang.signals.form, '…and gets nothing from the page shown before');
  const file = await check(site('file', '/file/'));
  assert.equal(file.signals.failure, 'the link opens a file download instead of a website');
  const forwards = await check(site('redirect', '/to-links/'));
  assert.equal(forwards.signals.forwardsTo, 'linktr.ee', 'a domain that forwards to Linktree is not a website');
  await ctx.setOffline(true);
  assert.equal(await check(site('good', '/good/')), null, 'offline: nothing is saved, the lead stays in the queue');
  await ctx.setOffline(false);
  await panel.evaluate(() => LeadChecker._tune({ page: 20000, fetch: 15000, retry: 4000 }));

  if (SHOTS) {
    await panel.click('#criteriaBox summary');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.click('[data-filter="hot"]');
    await panel.screenshot({ path: join(SHOTS, 'v2-panel-dark.png'), fullPage: true });
  }
  assert.deepEqual(pageErrors, [], 'no errors in the panel');
  console.log('e2e: all checks passed');
} finally {
  await ctx.close();
  server.closeAllConnections();
  server.close();
}
