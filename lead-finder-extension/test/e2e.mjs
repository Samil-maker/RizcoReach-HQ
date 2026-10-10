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
  '/parked/': page('<p>This domain is for sale! Buy this domain today.</p>', { title: 'parked-salon.ae' }),
  '/ig-profile/':
    '<html><head><title>Noor (@noorsalon) • Instagram photos and videos</title>' +
    '<meta property="og:description" content="5,200 Followers, 10 Following, 99 Posts - See Instagram photos and videos from Noor (@noorsalon)">' +
    '</head><body><script type="application/json">{"require":[["x",{"__bbox":{"result":{"data":{"user":{"follower_count":5213}}}}}]]}</script></body></html>',
  '/ig-missing/': "<html><head><title>Page not found • Instagram</title></head><body><h2>Sorry, this page isn't available.</h2></body></html>",
};
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  const send = () => {
    if (SITES[path]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SITES[path]);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not Found</h1>');
    }
  };
  if (path === '/slow/') setTimeout(send, 5000);
  else send();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ─── Fake Instagram profiles ─────────────────────────────────────────────────
const INSTAGRAM = { noorsalon: '5,200', goodsalon: '12K', instaonly: '800', glowlounge: '2,100' };
const igLookups = [];

const ctx = await playwright.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lf-')), {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
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
  assert.equal(summary, 'Done. "ladies salon in al barsha": 8 new leads (5 with a website) · 12 opened · 1 closed · 2 no mobile · 1 already saved');

  // 2 · Checks start by themselves and finish.
  await panel.waitForFunction(() => /All 8 leads are checked/.test(document.querySelector('#checkText').textContent), null, { timeout: 240000 });
  console.log('instagram lookups:', igLookups.join(', '));
  assert.deepEqual(igLookups.sort(), ['glowlounge', 'goodsalon', 'instaonly', 'noorsalon']);

  const leads = await panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith('lead:')).map((k) => all[k]);
  });
  const byName = Object.fromEntries(leads.map((l) => [l.name, l]));
  const sig = (name) => byName[name].checks.site.signals;
  console.log('slow load ms:', sig('Slow Salon').loadMs, '| good load ms:', sig('Has Website Salon').loadMs);
  assert.ok(sig('Slow Salon').loadMs >= 5000, 'slow site measured as slow');
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
  assert.deepEqual(good.map((l) => [l.name, l.pill]), [['Last Salon', 'Good 67'], ['Error Salon', 'Good 67'], ['Parked Salon', 'Good 61'], ['Slow Salon', 'Good 59']]);
  assert.ok(good.find((l) => l.name === 'Last Salon').reasons.includes('Google listing not claimed by the owner'));
  assert.match(good.find((l) => l.name === 'Slow Salon').reasons[0], /^Weak website: slow \(5(\.\d)?s\) · no contact form · no preloader$/);
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
  await tab('good');
  await panel.locator('.lead', { hasText: 'Slow Salon' }).locator('.wa').click();
  await panel.waitForFunction(() => window.__opened.length === 1);
  const text = new URL(await panel.evaluate(() => window.__opened[0])).searchParams.get('text');
  console.log('message:', text);
  assert.match(text, /^Hi 👋 We had a look at Slow Salon's website and noticed it takes about 5 seconds to load and there's no contact form for enquiries\./);
  await tab('hot');
  await panel.locator('.lead', { hasText: 'Noor Ladies Salon' }).locator('.wa').click();
  await panel.waitForFunction(() => window.__opened.length === 2);
  assert.match(new URL(await panel.evaluate(() => window.__opened[1])).searchParams.get('text'), /came across Noor Ladies Salon on Google Maps and noticed there's no website/);
  await panel.bringToFront();
  await panel.waitForFunction(() => document.querySelector('[data-filter="contacted"] span').textContent === '2');

  // 5 · Google Contacts file: hot and good leads, best first.
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.click('#contactsBtn')]);
  const csv = readFileSync(await download.path(), 'utf8');
  assert.ok(csv.startsWith('Name,Given Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Notes,Group Membership\r\nLead - Noor Ladies Salon,'), 'best lead first');
  assert.ok(csv.includes('Hot lead (96/100): No website'));
  assert.ok(!csv.includes('Has Website Salon'), 'low leads are left out');
  assert.match(await panel.textContent('#saveHint'), /Saved 6 new hot and good lead\(s\)/);

  // The Instagram page reader (used when the quick lookup comes back empty) on stand-in pages.
  const probeSource = readFileSync(new URL('../probe.js', import.meta.url), 'utf8');
  const igPage = await ctx.newPage();
  await igPage.goto(`${SITE}/ig-profile/`);
  await igPage.addScriptTag({ content: probeSource });
  assert.deepEqual(await igPage.evaluate(() => rrProbeInstagram()), {
    path: '/ig-profile/', title: 'Noor (@noorsalon) • Instagram photos and videos',
    og: '5,200 Followers, 10 Following, 99 Posts - See Instagram photos and videos from Noor (@noorsalon)',
    header: '', description: '', followers: 5213, notFound: false,
  });
  await igPage.goto(`${SITE}/ig-missing/`);
  await igPage.addScriptTag({ content: probeSource });
  assert.equal((await igPage.evaluate(() => rrProbeInstagram())).notFound, true);
  await igPage.close();

  // Recheck runs again for one lead.
  const before = igLookups.length;
  await tab('all');
  await panel.locator('.lead', { hasText: 'Insta Only Salon' }).locator('.linkish').click();
  for (let waited = 0; igLookups.length === before && waited < 60000; waited += 250) await new Promise((r) => setTimeout(r, 250));
  assert.equal(igLookups.length, before + 1);
  assert.equal(igLookups[igLookups.length - 1], 'instaonly');

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
  server.close();
}
