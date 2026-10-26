// End-to-end test: real Chromium + the unpacked extension against a mock
// Ad Library (embedded first page + infinite scroll over XHR and fetch) and
// mock advertiser websites. No real Facebook traffic.
//   node lead-hunter/test/e2e.mjs [--shots <dir>]
// Needs Playwright (global or local) and openssl.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeAd, searchResponse, memStore } from './fixtures.mjs';
import { metaHandler, checkLog, metaWall, PRESET_SEARCHES } from './meta-fixtures.mjs';
import { handle as queueHandle } from '../../netlify/functions/lead-queue.mts';
import { handle as emailHandle } from '../../netlify/functions/email-queue.mts';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTREACH = path.resolve(EXT, '../public/outreach.html');
const QUEUE_KEY = 'test-key-' + 'x'.repeat(30);
const queueStore = memStore();
const emailStore = memStore();
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? process.argv[shotsArg + 1] : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-e2e-'));

/** Rows of a CSV export (quoted fields, commas and new lines inside quotes, leading byte order mark). */
function parseCsv(text) {
  const rows = [[]];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') rows[rows.length - 1].push(field), (field = '');
    else if (c === '\n') rows[rows.length - 1].push(field.replace(/\r$/, '')), (field = ''), rows.push([]);
    else field += c;
  }
  rows[rows.length - 1].push(field);
  return rows.filter((r) => r.length > 1 || r[0]);
}

/* ---------------------------------------------------------------- fixtures */
const NAMES = ['Shine Auto Spa', 'Desert Detailers', 'Gloss Garage Dubai', 'Parked Polish', 'Broken Buff', 'Fortress Car Care', 'Ceramic Kings', 'Contact Page Coaters', 'React Ride Studio', 'MegaMotors Official', 'Mirror Finish JLT', 'Wash Wizards', 'Tint Masters', 'Auto Aura', 'Prestige Paint Pros', 'Sparkle Squad', 'Velvet Wax Co', 'Nano Shield UAE', 'Pure Gloss', 'Detail District', 'Royal Rinse', 'Shield & Shine', 'Glasscoat Garage', 'Showroom Sheen', 'Luxe Lather'];
const TYPES = ['good', 'whatsapp', 'bad', 'parked', 'error', 'blocked', 'good', 'contact', 'spa', 'brand'];
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const biz = NAMES.map((name, i) => ({ name, i, pageId: String(9000 + i), type: TYPES[i % TYPES.length], host: `${slug(name)}.example` }));

function adsFor(b, n = 0) {
  const base = { id: 100000 + b.i * 10 + n, pageId: b.pageId, pageName: b.name, daysAgo: 5 + ((b.i * 17) % 120), likes: b.type === 'brand' ? 900000 : 800 + b.i * 50 };
  if (b.type === 'whatsapp') return makeAd({ ...base, cta: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message', link: `https://api.whatsapp.com/send?phone=97150${String(1000000 + b.i).slice(-7)}`, body: 'Full detail from AED 299. WhatsApp now!' });
  const scheme = b.type === 'bad' ? 'http' : 'https';
  return makeAd({ ...base, link: `https://l.facebook.com/l.php?u=${encodeURIComponent(`${scheme}://${b.host}/offer?utm_source=fb`)}`, caption: b.host, count: 1 + (b.i % 3) });
}
// keyword -> pages of ads. "ceramic coating" overlaps with "car detailing" to test de-duplication.
const KEYWORDS = {
  'car detailing': [biz.slice(0, 8), biz.slice(8, 14), biz.slice(14, 18)],
  'ceramic coating': [biz.slice(4, 10), biz.slice(18, 25)],
};
const pageFor = (kw, i) => (KEYWORDS[kw] || [])[i] || [];

function adLibraryHtml(kw) {
  const first = pageFor(kw, 0).map((b) => adsFor(b));
  const embedded = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_AdLibrarySearchPaginationQueryRelayPreloader_1', { __bbox: { complete: true, result: searchResponse(first) } }]]] } }]]] };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ad Library</title>
<style>body{margin:0;font:14px sans-serif;background:#f0f2f5}.card{height:320px;margin:12px;background:#fff;border-radius:8px;padding:12px}</style></head>
<body><div id="list"></div>
<script type="application/json" data-content-len="1" data-sjs>${JSON.stringify(embedded).replace(/</g, '\\u003c')}</script>
<script>
  const kw = new URLSearchParams(location.search).get('q') || '';
  let page = 1, loading = false, done = false;
  const list = document.getElementById('list');
  const add = (ads) => ads.forEach((a) => { const d = document.createElement('div'); d.className = 'card'; d.textContent = a.page_name + ' · Library ID: ' + a.ad_archive_id; list.appendChild(d); });
  add(${JSON.stringify(first)});
  async function more() {
    if (loading || done) return;
    loading = true;
    const body = 'q=' + encodeURIComponent(kw) + '&page=' + page;
    let text;
    if (page % 2 === 1) {
      text = await new Promise((res) => { const x = new XMLHttpRequest(); x.open('POST', '/api/graphql/'); x.onload = () => res(x.responseText); x.send(body); });
    } else {
      text = await (await fetch('/api/graphql/', { method: 'POST', body })).text();
    }
    const data = JSON.parse(text.replace('for (;;);', ''));
    const conn = data.data.ad_library_main.search_results_connection;
    add(conn.edges.map((e) => e.node.collated_results[0]));
    done = !conn.page_info.has_next_page;
    page++;
    loading = false;
  }
  addEventListener('scroll', () => { if (innerHeight + scrollY >= document.body.scrollHeight - 400) more(); });
</script></body></html>`;
}

const GOOD = (b) => `<!doctype html><html lang="en"><head><title>${b.name} | Ceramic Coating & Detailing in Dubai</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Ceramic coating, PPF and full detailing in Al Quoz, Dubai. Book online or WhatsApp us today for a quote.">
<meta property="og:image" content="/og.jpg"><link rel="icon" href="/f.png"><script>fbq('init','123');</script><script type="application/ld+json">{}</script></head>
<body><h1>${b.name}</h1>${'<p>We look after cars across Dubai with care and detail. </p>'.repeat(50)}
<a href="tel:+9714${String(2000000 + b.i).slice(-7)}">Call</a><a href="https://wa.me/97155${String(3000000 + b.i).slice(-7)}">WhatsApp</a><form></form>
<a href="mailto:hello@${b.host}">Email</a><a href="https://www.instagram.com/${slug(b.name)}/">Instagram</a><footer>© 2026</footer></body></html>`;
const BAD = (b) => `<html><head><title>Home</title><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head>
<body><p>Welcome to ${b.name}</p><img src="a.jpg"><footer>Copyright 2019 ${b.name}. Call 050 765 4321</footer></body></html>`;

function site(b, url, res) {
  const html = (code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  };
  switch (b.type) {
    case 'good':
    case 'brand':
      return html(200, GOOD(b));
    case 'bad':
      return setTimeout(() => html(200, BAD(b)), 1900);
    case 'parked':
      return html(200, '<html><body><h1>This domain is for sale!</h1><p>Buy this domain today.</p></body></html>');
    case 'error':
      return html(500, 'Internal Server Error');
    case 'blocked':
      return html(403, '<title>Just a moment...</title>', { server: 'cloudflare' });
    case 'contact':
      if (url.pathname.startsWith('/contact')) return html(200, `<html><body><p>Reach us on +971 4 555 0101 or info@${b.host}</p></body></html>`);
      return html(200, GOOD(b).replace(/<a href="tel:[^>]+>Call<\/a><a href="https:\/\/wa\.me[^>]+>WhatsApp<\/a>/, '<a href="/contact-us">Contact us</a>'));
    case 'spa':
      return html(200, '<html><head><meta name="viewport" content="width=device-width"><title>React Ride Studio | Premium detailing</title></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>');
  }
  html(404, 'not found');
}

/* Instagram profile pages the way instagram.com serves them: the profile in the meta tags, bio links wrapped in l.instagram.com. */
const IG_PROFILES = {
  'glossy.tint_bar': { name: 'Glossy Tint Bar', bio: 'Ceramic coating and window tint in Al Quoz. Call 050 765 4321 or book@glossytint.example', links: ['https://l.instagram.com/?u=https%3A%2F%2Fglossytint.example%2Fbook&e=AT0', 'https://wa.me/971551112233'] },
  'luxe.lash.dxb': { name: 'Luxe Lash Studio', bio: 'Lash studio in JLT. WhatsApp +971 52 444 5566', links: [] },
};
function instagramHtml(handle) {
  const p = IG_PROFILES[handle];
  if (!p) return '<html><head><title>Instagram</title></head><body><main>Explore</main></body></html>';
  const title = `${p.name} (@${handle}) • Instagram photos and videos`;
  const desc = `2,345 Followers, 120 Following, 310 Posts - ${p.name} (@${handle}) on Instagram: "${p.bio}"`.replace(/"/g, '&quot;');
  return `<html><head><title>${title}</title><meta property="og:title" content="${title}"><meta name="description" content="${desc}"></head>
    <body><main><header><h2>${handle}</h2>${p.links.map((h) => `<a href="${h}">link</a>`).join('')}<a href="https://www.instagram.com/${handle}/followers/">followers</a></header></main></body></html>`;
}

function handler(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
  if (metaHandler(req, res, url, host)) return;
  if (host === 'www.instagram.com') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(instagramHtml(url.pathname.split('/').filter(Boolean)[0] || ''));
  }
  if (host === 'www.facebook.com') {
    if (url.pathname.startsWith('/ads/library')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(adLibraryHtml(url.searchParams.get('q') || ''));
    }
    if (url.pathname.startsWith('/api/graphql')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const p = new URLSearchParams(body);
        const kw = p.get('q');
        const i = Number(p.get('page'));
        const ads = pageFor(kw, i).map((b) => adsFor(b, 1));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('for (;;);' + JSON.stringify(searchResponse(ads, { cursor: 'c' + i, hasNext: !!pageFor(kw, i + 1).length })));
      });
      return;
    }
  }
  if (host === 'www.rizcoreach.ae') {
    if (url.pathname === '/outreach' || url.pathname === '/outreach.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(OUTREACH));
    }
    // The real phone queue and email queue handlers, with in-memory stores.
    const api = { '/api/lead-queue': [queueHandle, queueStore], '/api/email-queue': [emailHandle, emailStore] }[url.pathname];
    if (api) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const r = await api[0](new Request(url, { method: req.method, headers: req.headers, body: body.length ? body : undefined }), api[1], QUEUE_KEY);
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(await r.text());
      });
      return;
    }
  }
  if (host === 'wa.me') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('whatsapp stub');
  }
  const b = biz.find((x) => x.host === host);
  if (b) return site(b, url, res);
  res.writeHead(404);
  res.end();
}

/* ------------------------------------------------------------------ server */
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/key.pem -out ${tmp}/cert.pem -days 2 -subj "/CN=localhost" 2>/dev/null`);
const httpsServer = https.createServer({ key: fs.readFileSync(`${tmp}/key.pem`), cert: fs.readFileSync(`${tmp}/cert.pem`) }, handler);
const httpServer = http.createServer(handler);
// One port for both schemes: peek at the first byte (0x16 = TLS handshake).
const mux = net.createServer((sock) =>
  sock.once('data', (buf) => {
    sock.pause();
    sock.unshift(buf);
    (buf[0] === 0x16 ? httpsServer : httpServer).emit('connection', sock);
    process.nextTick(() => sock.resume());
  }),
);
await new Promise((r) => mux.listen(0, '127.0.0.1', r));
const PORT = mux.address().port;

/* ----------------------------------------------------------------- browser */
const ctx = await pw.chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP www.facebook.com 127.0.0.1:${PORT}, MAP *.example 127.0.0.1:${PORT}, MAP wa.me 127.0.0.1:${PORT}, MAP www.rizcoreach.ae 127.0.0.1:${PORT}, MAP www.google.com 127.0.0.1:${PORT}, MAP places.googleapis.com 127.0.0.1:${PORT}, MAP www.instagram.com 127.0.0.1:${PORT}`,
    '--ignore-certificate-errors',
    '--no-proxy-server',
  ],
});
const fail = async (e) => {
  console.error('E2E FAILED:', e);
  await ctx.close().catch(() => {});
  mux.close();
  process.exit(1);
};
process.on('unhandledRejection', fail);

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const dashUrl = `chrome-extension://${extId}/dashboard/dashboard.html`;
  const storage = (key) => sw.evaluate((k) => chrome.storage.local.get(k), key);
  // The number a lead's WhatsApp bubbles go to (WhatsApp sources first), as digits.
  const LHwa = (l) => (l.phones.find((p) => /whatsapp/.test(p.source)) || l.phones[0]).number.replace(/\D/g, '');
  const waitFor = async (fn, ms = 90000, label = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Timed out waiting for ' + label);
  };

  // First run opens the dashboard with the welcome panel.
  const dash = await waitFor(async () => ctx.pages().find((p) => p.url().startsWith(dashUrl)), 10000, 'welcome tab');
  await dash.waitForSelector('[data-welcome]:not([hidden])');
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/1-welcome.png` });

  // Settings: name, faster scrolling for the test, and a new niche.
  await dash.click('[data-view="settings"]');
  await dash.fill('[name="myName"]', 'Samil');
  await dash.fill('[name="scrollDelayMs"]', '900');
  assert.equal(await dash.$$eval('[data-niche-row]', (r) => r.length), 5, 'the 5 default presets');
  assert.equal(await dash.$$eval('[data-script-card]', (r) => r.length), 2, 'two scripts');
  assert.equal(await dash.inputValue('[name="bubbles"]'), '3');
  assert.ok(await dash.isVisible('[data-email-nokey]'), 'the email sender needs the queue key first');
  assert.equal(await dash.$$eval('[data-email-card]', (c) => c.length), 2, 'subject and follow ups for both scripts');
  // "Reset to default" brings back the default website script, with {{website_line}}.
  const webBody = '[data-script="website.body"]';
  await dash.fill(webBody, 'Something else');
  await dash.click('[data-script-card="website"] [data-act="reset-script"]');
  assert.equal(
    await dash.inputValue(webBody),
    "I came across {{business}} on {{found_on}} and {{website_line}}.\n\nWe build simple websites for {{niche}} in {{city}} that turn visitors into WhatsApp inquiries.\n\nIf this sounds interesting I'd be happy to send you a free mockup of how yours could look.",
  );
  await dash.click('[data-act="add-niche"]');
  const newPreset = '[data-niche-row]:last-child';
  await dash.fill(`${newPreset} [data-niche-name]`, 'Pet groomers');
  await dash.fill(`${newPreset} [data-niche-label]`, 'pet groomers');
  await dash.fill(`${newPreset} [data-niche-min]`, '3');
  await dash.fill(`${newPreset} [data-niche-kw]`, 'dog grooming\nPet Salon\n\n');
  await dash.fill(`${newPreset} [data-niche-ex]`, 'vet clinic');
  await dash.fill(`${newPreset} [data-niche-areas]`, 'Al Barsha, Dubai\nJLT, Dubai');
  await dash.click('[data-settings-form] button[type="submit"]');
  await waitFor(async () => (await storage('settings')).settings.myName === 'Samil', 5000, 'settings saved');
  const saved = (await storage('settings')).settings;
  assert.equal(saved.niches.length, 6, 'the 5 presets and the new one');
  assert.deepEqual(saved.niches[5], { name: 'Pet groomers', label: 'pet groomers', minReviews: 3, maxReviews: 100000, keywords: ['dog grooming', 'pet salon'], exclude: ['vet clinic'], areas: ['Al Barsha, Dubai', 'JLT, Dubai'] });
  // Export presets: the same list as a JSON file.
  const [presetsDl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="export-presets"]')]);
  const exported = JSON.parse(fs.readFileSync(await presetsDl.path(), 'utf8'));
  assert.deepEqual(exported.presets.map((x) => x.name), ['Car', 'Fitness', 'Pets', 'Accountants', 'Used Cars', 'Pet groomers']);
  assert.ok(!('adsOffer' in saved) && !('templates' in saved) && !('adTemplates' in saved), 'old settings are gone');
  if (SHOTS) {
    await dash.$eval('#outreach', (el) => el.scrollIntoView());
    await dash.screenshot({ path: `${SHOTS}/12-settings-niches.png` });
  }
  // The new niche shows up in both niche pickers, and fills in its keywords.
  await dash.click('[data-view="ads"]');
  await dash.click('[data-ad-niche="Pet groomers"]');
  assert.equal(await dash.inputValue('[data-finder-form] [name="keywords"]'), 'dog grooming\npet salon');
  assert.deepEqual(await dash.$$eval('[data-ad-niche]', (c) => c.map((x) => x.textContent)), ['Car', 'Fitness', 'Pets', 'Accountants', 'Used Cars', 'Pet groomers']);
  assert.deepEqual(await dash.$$eval('[data-ad-areas] [data-area]', (c) => c.map((x) => x.textContent)), ['Al Barsha, Dubai', 'JLT, Dubai'], 'the preset areas');
  await dash.click('[data-view="hunt"]');
  assert.ok(await dash.$('[data-preset="Pet groomers"]'), 'New hunt chips too');
  // The rest of this test was written for two filter free niches: put them first, ahead of the 5 presets.
  const open = { exclude: [], minReviews: 0, maxReviews: 100000 };
  await sw.evaluate(async (extra) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, niches: [...extra, ...settings.niches] } });
  }, [
    { name: 'Car detailing studios', label: 'car detailing studios', keywords: ['ceramic coating', 'paint protection film', 'car detailing', 'window tinting', 'car polishing'], areas: ['Al Quoz'], ...open },
    { name: 'Aesthetic clinics', label: 'aesthetic clinics', keywords: ['aesthetic clinic', 'laser hair removal'], areas: ['JLT'], ...open },
  ]);
  await dash.waitForSelector('[data-preset="Accountants"]');
  await dash.click('[data-preset="Accountants"]');
  assert.match(await dash.inputValue('[data-hunt-form] [name="keywords"]'), /^accounting firm\naccounting services/);

  // Start a hunt from the dashboard.
  await dash.fill('[data-hunt-form] [name="keywords"]', 'car detailing\nceramic coating');
  await dash.selectOption('[data-hunt-form] [name="country"]', 'AE');
  await dash.fill('[data-hunt-form] [name="target"]', '50');
  await dash.fill('[data-hunt-form] [name="maxLikes"]', '60000');
  const [huntPage] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-hunt-form] button[type="submit"]')]);
  await huntPage.waitForURL(/ads\/library/);
  await huntPage.waitForSelector('#lead-hunter-hud');
  await new Promise((r) => setTimeout(r, 6000));
  if (SHOTS) await huntPage.screenshot({ path: `${SHOTS}/2-adlibrary-hud.png` });

  const { hunt } = await waitFor(async () => {
    const s = await storage('hunt');
    return s.hunt && s.hunt.status !== 'running' ? s : null;
  }, 180000, 'hunt to finish');
  console.log('hunt:', hunt.status, hunt.finishReason, 'collected', hunt.collected, hunt.perKeyword);
  assert.equal(hunt.status, 'done');
  assert.equal(hunt.finishReason, 'keywords');
  assert.equal(hunt.collected, 23, 'every unique advertiser except the two big brands counts towards the target');
  await dash.bringToFront(); // the hunt tab is in front; background tabs don't run the drawer's slide-in

  await waitFor(async () => {
    const s = await storage('enrichQueue');
    return !(s.enrichQueue || []).length;
  }, 120000, 'enrichment to finish');

  const all = await storage(null);
  const leads = Object.entries(all).filter(([k]) => k.startsWith('lead:')).map(([, v]) => v);
  const by = (name) => leads.find((l) => l.pageName === name);
  const lead = async (id) => (await storage('lead:' + id))['lead:' + id];
  assert.equal(leads.length, 25, 'one lead per advertiser across overlapping keywords');
  assert.deepEqual(by('Fortress Car Care').keywords.sort(), ['car detailing', 'ceramic coating']);
  assert.ok(leads.every((l) => l.niche === 'Car detailing studios'), 'website leads get their niche from the hunt keywords');

  const good = by('Shine Auto Spa');
  assert.equal(good.website, 'https://shineautospa.example/');
  assert.equal(good.landingUrl, 'https://shineautospa.example/offer');
  assert.equal(good.site.state, 'ok');
  assert.ok(good.site.score >= 85, 'good site score ' + good.site.score);
  assert.ok(good.phones.some((p) => p.source === 'whatsapp-site'));
  assert.ok(good.emails.includes('hello@shineautospa.example'));
  assert.equal(good.socials.instagram, 'https://www.instagram.com/shineautospa/');

  const wa = by('Desert Detailers');
  assert.equal(wa.website, null);
  assert.equal(wa.destinationKind, 'whatsapp');
  assert.equal(wa.phones[0].source, 'whatsapp-ad');
  assert.equal(wa.site.state, 'none');

  const bad = by('Gloss Garage Dubai');
  assert.ok(bad.site.score < 45, 'bad score ' + bad.site.score);
  assert.ok(bad.site.issues.some((i) => i.id === 'https'));
  assert.ok(bad.site.issues.some((i) => i.id === 'copyright'));
  assert.ok(bad.phones.some((p) => p.number === '+971507654321'));

  assert.equal(by('Parked Polish').site.parked, true);
  assert.equal(by('Broken Buff').site.state, 'error');
  assert.equal(by('Fortress Car Care').site.state, 'blocked');
  assert.ok(by('Contact Page Coaters').phones.some((p) => p.number === '+97145550101'), 'phone found on the contact page');
  assert.ok(!by('React Ride Studio').site.issues.some((i) => i.id === 'contactLinks'));
  assert.equal(by('MegaMotors Official').pageLikes, 900000);

  // Website leads: advertisers with a working website are skipped (running ads). The 3 without one show,
  // and so do the 6 whose website is parked or down: they get the website script, tagged "Site down".
  await dash.click('[data-view="leads"]');
  await dash.click('[data-act="clear-hunt-filter"]').catch(() => {});
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 9);
  const shown = await dash.$$eval('[data-rows] tr .biz .n', (n) => n.map((x) => x.textContent).sort());
  assert.deepEqual(shown, ['Auto Aura', 'Broken Buff', 'Desert Detailers', 'Luxe Lather', 'Parked Polish', 'Prestige Paint Pros', 'Shield & Shine', 'Showroom Sheen', 'Wash Wizards']);
  assert.match(await dash.textContent('[data-count]'), /16 skipped \(running ads with a website\)/);
  assert.equal(await dash.textContent(`tr[data-id="${by('Parked Polish').id}"] .tags`), 'Site down');
  assert.equal(await dash.textContent(`tr[data-id="${by('Broken Buff').id}"] .tags`), 'Site down');
  assert.deepEqual(await dash.$$eval(`tr[data-id="${wa.id}"] .tags .tag`, (t) => t.map((x) => x.textContent)), ['Mobile', 'No website'], 'phone type first');
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/3-leads.png` });
  // The website filter: no website, or a site that is down. Nothing else (those would only match skipped leads).
  assert.deepEqual(await dash.$$eval('[data-f="site"] option', (o) => o.map((x) => x.value)), ['', 'none', 'down']);
  await dash.selectOption('[data-f="site"]', 'none');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 3);
  await dash.selectOption('[data-f="site"]', 'down');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 6);
  await dash.selectOption('[data-f="site"]', '');
  await dash.selectOption('[data-f="tag"]', 'Site down');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 6);
  await dash.selectOption('[data-f="tag"]', '');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 9);
  // A site that is down: the website script says it wasn't loading.
  await dash.click(`tr[data-id="${by('Broken Buff').id}"] [data-open]`);
  await dash.waitForFunction(() => document.querySelectorAll('.drawer.open [data-bubble]').length === 3);
  assert.equal(await dash.inputValue('[data-bubble="0"]'), 'Hello Broken Buff');
  assert.match(await dash.inputValue('[data-bubble="1"]'), /^I came across Broken Buff on Facebook and Instagram and your website wasn't loading when I checked\.\n\nWe build simple websites/);
  assert.match(await dash.textContent('.drawer .pitch h3'), /Website script\s*Site down/);
  assert.equal(await dash.$$eval('.drawer .pitch .note', (n) => n.length), 0);
  if (SHOTS) {
    await dash.waitForTimeout(500); // let the drawer finish sliding in
    await dash.screenshot({ path: `${SHOTS}/3c-site-down-drawer.png` });
  }
  await dash.click('[data-act="close"]');
  await dash.check('[data-f="skipped"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 23);
  const lastRow = await dash.$eval('[data-rows] tr:last-child', (tr) => tr.querySelector('.tags').textContent);
  assert.match(lastRow, /Running ads/, 'skipped leads sink to the bottom');
  assert.match(await dash.textContent(`tr[data-id="${good.id}"]`), /@shineautospa/);
  assert.match(await dash.textContent(`tr[data-id="${good.id}"]`), /hello@shineautospa\.example/);
  if (SHOTS) {
    await dash.waitForTimeout(400); // let the drawer finish sliding out
    await dash.screenshot({ path: `${SHOTS}/3b-leads-skipped.png` });
  }
  // CSV export of the current view (skipped shown): instagram and email columns.
  const [dl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="export-csv"]')]);
  const [csvHead, ...csvRows] = parseCsv(fs.readFileSync(await dl.path(), 'utf8'));
  assert.deepEqual(csvHead.slice(0, 3), ['priority', 'heat', 'business']);
  assert.ok(csvHead.includes('instagram') && csvHead.includes('email'));
  assert.equal(csvRows.length, 23, 'the 23 visible leads');
  const shineRow = csvRows.find((r) => r[2] === 'Shine Auto Spa');
  assert.equal(shineRow[csvHead.indexOf('instagram')], 'https://www.instagram.com/shineautospa/');
  assert.equal(shineRow[csvHead.indexOf('email')], 'hello@shineautospa.example');
  // Google Contacts file: the business name as the contact name, only leads you can reach.
  const [gdl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="export-contacts"]')]);
  assert.match(gdl.suggestedFilename(), /^google-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  const [gHead, ...gRows] = parseCsv(fs.readFileSync(await gdl.path(), 'utf8'));
  assert.deepEqual(gHead.slice(0, 2), ['Name', 'Given Name']);
  const shineContact = gRows.find((r) => r[0] === 'Shine Auto Spa');
  assert.ok(shineContact, 'Shine Auto Spa is a contact');
  assert.match(shineContact[gHead.indexOf('Phone 1 - Value')] || shineContact[gHead.indexOf('E-mail 1 - Value')], /^\+971|@/);
  assert.equal(shineContact[gHead.indexOf('Group Membership')], '* myContacts ::: RizcoReach leads');
  assert.ok(gRows.every((r) => r[gHead.indexOf('Phone 1 - Value')] || r[gHead.indexOf('E-mail 1 - Value')]), 'every contact has a phone or an email');

  // A skipped lead: no message, unless you pitch it anyway with the website script.
  await dash.click(`tr[data-id="${bad.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open .skip-box');
  assert.match(await dash.textContent('.drawer .skip-box'), /Skipped: running ads/);
  assert.equal(await dash.$$eval('.drawer [data-bubble]', (b) => b.length), 0);
  await dash.click('[data-act="pitch-anyway"]');
  await dash.waitForFunction(() => document.querySelectorAll('.drawer [data-bubble]').length === 3);
  assert.equal(await dash.inputValue('[data-bubble="0"]'), 'Hello Gloss Garage', 'the city at the end of the page name is left out');
  assert.match(await dash.inputValue('[data-bubble="1"]'), /^I came across Gloss Garage on Facebook and Instagram/);
  assert.match(await dash.inputValue('[data-bubble="1"]'), /and couldn't find a website for you\./);
  assert.equal(await dash.textContent('.drawer .pitch .note'), 'Bubble 2 says they have no website. Edit that line before you send.');
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/3d-pitch-anyway.png` });
  await dash.click('[data-channel="email"]');
  assert.equal(await dash.inputValue('[data-email-subject]'), 'Website for Gloss Garage');
  assert.match(await dash.inputValue('[data-email-step="0"]'), /^Hello Gloss Garage\n\nI came across/);
  assert.equal(await dash.$$eval('.drawer [data-email-step]', (x) => x.length), 3, 'the first email and 2 follow ups');
  assert.ok(!(await dash.$('.drawer [data-act="email-queue"]')), 'a skipped lead is only pitched by hand');
  await dash.click('[data-act="close"]');
  await dash.uncheck('[data-f="skipped"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 9);

  /* ------------------------------------------ the drawer: one WhatsApp bubble at a time */
  const desert = wa;
  await dash.click(`tr[data-id="${desert.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-bubble]');
  const bubbles = await dash.$$eval('.drawer [data-bubble]', (b) => b.map((x) => x.value));
  assert.equal(bubbles.length, 3, 'three bubbles');
  assert.equal(bubbles[0], 'Hello Desert Detailers');
  assert.match(bubbles[1], /^I came across Desert Detailers on Facebook and Instagram and couldn't find a website for you\.\n\nWe build simple websites for car detailing studios in Dubai that turn visitors into WhatsApp inquiries\./);
  assert.equal(bubbles[2], 'Let me know');
  assert.doesNotMatch(bubbles.join(' '), /\{\{|undefined/);
  if (SHOTS) {
    await dash.waitForTimeout(500); // let the drawer finish sliding in
    await dash.screenshot({ path: `${SHOTS}/4-drawer.png` });
  }
  // One WhatsApp tab: bubble 1 opens it and bubble 2 loads in it. Bubble 3 opens a new one because that tab was closed.
  const typedIn = (u) => {
    const x = new URL(u);
    return x.origin + x.pathname === 'https://wa.me/971501000001' ? x.searchParams.get('text') : null;
  };
  const [waTab] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-act="open-bubble"][data-i="0"]')]);
  await waTab.waitForURL((u) => typedIn(u) === bubbles[0]);
  const tabsOpen = ctx.pages().length;
  await dash.bringToFront(); // back to the dashboard for the next bubble
  await dash.waitForSelector('.bubble:nth-child(1) .tick');
  assert.equal((await lead(desert.id)).status, 'new', 'not contacted before the last bubble');
  await dash.click('[data-act="open-bubble"][data-i="1"]');
  await waTab.waitForURL((u) => typedIn(u) === bubbles[1]);
  assert.equal(ctx.pages().length, tabsOpen, 'bubble 2 loads in the same WhatsApp tab');
  await dash.waitForSelector('.bubble:nth-child(2) .tick');
  assert.equal((await lead(desert.id)).status, 'new', 'not contacted before the last bubble');
  await waTab.close();
  await dash.bringToFront();
  const [waTab2] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-act="open-bubble"][data-i="2"]')]);
  await waTab2.waitForURL((u) => typedIn(u) === bubbles[2]);
  await waTab2.close();
  await dash.bringToFront();
  await waitFor(async () => (await lead(desert.id)).status === 'contacted', 5000, 'contacted after the last bubble');
  assert.match(await dash.textContent('[data-toast]'), /Marked “Desert Detailers” as contacted/);
  const d1 = await lead(desert.id);
  assert.equal(d1.sentScript, 'website');
  assert.ok(d1.contactedAt > 0);
  await dash.click('[data-act="close"]');

  // QR per bubble, edits update the code, and "Mark as sent".
  const qrText = (sel) => dash.$eval(sel, (c) => c.dataset.qrText);
  const wash = by('Wash Wizards');
  const washNum = LHwa(wash);
  await dash.click(`tr[data-id="${wash.id}"] [data-open]`);
  await dash.waitForSelector('[data-pitch-qr]');
  const wb = await dash.$$eval('.drawer [data-bubble]', (b) => b.map((x) => x.value));
  assert.equal(await qrText('[data-pitch-qr]'), `https://wa.me/${washNum}?text=${encodeURIComponent(wb[0])}`, 'the QR shows bubble 1');
  await dash.click('[data-qr-i="1"]');
  assert.equal(await qrText('[data-pitch-qr]'), `https://wa.me/${washNum}?text=${encodeURIComponent(wb[1])}`, 'toggle 2 shows bubble 2');
  await dash.fill('[data-bubble="1"]', 'Edited message');
  await dash.waitForFunction(() => document.querySelector('[data-pitch-qr]').dataset.qrText.endsWith('?text=Edited%20message'));
  if (SHOTS) {
    await dash.$eval('.qr-wrap', (el) => el.scrollIntoView({ block: 'end' }));
    await dash.waitForTimeout(400);
    await dash.screenshot({ path: `${SHOTS}/6-drawer-qr.png` });
  }
  await dash.click('[data-act="mark-sent"]');
  await waitFor(async () => (await lead(wash.id)).status === 'contacted', 5000, 'marked as sent from the drawer');
  assert.equal((await lead(wash.id)).sentScript, 'website');
  await dash.click('[data-act="close"]');

  // Phone mode: one QR per bubble. Enter = next bubble, after the last one the lead is contacted.
  await dash.click('[data-act="phone-mode"]');
  await dash.waitForSelector('[data-pm-qr]');
  const pmName = () => dash.$eval('.pm-info h2', (h) => h.firstChild.textContent.trim());
  const pmFirst = await pmName();
  assert.equal(pmFirst, 'Shield & Shine', 'leads not contacted yet come first');
  const shield = by(pmFirst);
  const shieldNum = LHwa(shield);
  assert.equal(await dash.textContent('[data-pm-step]'), 'Bubble 1 of 3');
  assert.equal(await qrText('[data-pm-qr]'), `https://wa.me/${shieldNum}?text=${encodeURIComponent('Hello Shield & Shine')}`);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/7-phone-mode.png` });
  await dash.keyboard.press('Enter');
  await dash.waitForFunction(() => document.querySelector('[data-pm-step]').textContent === 'Bubble 2 of 3');
  assert.match(await qrText('[data-pm-qr]'), /\?text=I%20came%20across%20Shield/);
  await dash.keyboard.press('Shift+Enter');
  await dash.waitForFunction(() => document.querySelector('[data-pm-step]').textContent === 'Bubble 1 of 3');
  await dash.keyboard.press('Enter');
  await dash.keyboard.press('Enter');
  await dash.waitForFunction(() => document.querySelector('[data-pm-step]').textContent === 'Bubble 3 of 3');
  assert.equal((await lead(shield.id)).status, 'new');
  await dash.keyboard.press('Enter');
  await dash.waitForFunction((n) => document.querySelector('.pm-info h2').firstChild.textContent.trim() !== n, pmFirst);
  await waitFor(async () => (await lead(shield.id)).status === 'contacted', 5000, 'phone mode marks contacted after the last bubble');
  assert.equal((await lead(shield.id)).sentScript, 'website');
  await dash.keyboard.press('ArrowRight'); // skip a lead
  await dash.keyboard.press('Escape');
  assert.ok(await dash.$eval('[data-pm]', (el) => el.hidden));

  // Phone queue: pair.
  await dash.click('[data-view="settings"]');
  await dash.click('[data-act="gen-key"]');
  await dash.fill('[name="queueKey"]', QUEUE_KEY);
  await dash.click('[data-act="test-queue"]');
  await dash.waitForFunction(() => /Connected\. 0 leads waiting/.test(document.querySelector('[data-queue-status]').textContent));
  const pairUrl = await qrText('[data-pair-canvas]');
  assert.match(pairUrl, new RegExp(`^https://www\\.rizcoreach\\.ae/outreach#k=${encodeURIComponent(QUEUE_KEY)}&t=\\d{13}$`));
  if (SHOTS) {
    await dash.$eval('#phone', (el) => el.scrollIntoView());
    await dash.screenshot({ path: `${SHOTS}/8-settings-phone.png` });
  }

  /* ------------------------------------------- Meta ads: Google Places mode */
  const setKey = (k) =>
    sw.evaluate(async (key) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, placesKey: key } });
    }, k);
  const finderDone = (label) =>
    waitFor(async () => {
      const { finder } = await storage('finder');
      return finder && finder.status !== 'running' ? finder : null;
    }, 90000, label);
  const checksDone = (label) => waitFor(async () => !((await storage('adCheckQueue')).adCheckQueue || []).length, 300000, label);
  const prospectsNow = async () => Object.entries(await storage(null)).filter(([k, v]) => k.startsWith('lead:') && v.kind === 'prospect').map(([, v]) => v);

  await setKey('test-places-key');
  await sw.evaluate(() => startFinder({ niche: 'Car detailing studios', keywords: ['ppf'], areas: ['Al Quoz'], city: 'Dubai', target: 6 }));
  const f1 = await finderDone('Places search');
  assert.equal(f1.added, 7, 'seven new businesses (avoid-list and closed ones not counted)');
  assert.equal((await storage('placesUsage')).placesUsage.count, 2, 'two Places requests counted this month');
  await checksDone('ad checks (Places run)');
  let ps = await prospectsNow();
  const pn = (n) => ps.find((p) => p.pageName === n);
  assert.equal(ps.filter((p) => p.website === 'https://glossyppf.example/').length, 1, 'branch listing merged into one business');
  assert.ok(!pn('Closed Detailing'), 'closed businesses are dropped');
  assert.equal(pn('Elite Renovation & Detailing').avoid, true);
  const states = Object.fromEntries(['Glossy PPF Studio', 'Armor Shield Detailing', 'Desert Ceramic Care', 'Nano Pro Tint', 'Shiny Wheels Car Spa', 'Wrap Kings JLT'].map((n) => [n, pn(n).adCheck.state]));
  assert.deepEqual(states, {
    'Glossy PPF Studio': 'none', // their Facebook page never ran ads in the UAE (confirmed)
    'Armor Shield Detailing': 'running', // their Facebook page: 3 live ads, found after the first load showed only old ones
    'Desert Ceramic Care': 'running', // found by website domain
    'Nano Pro Tint': 'skipped', // no website: the website script either way, so no Ad Library check
    'Shiny Wheels Car Spa': 'skipped',
    'Wrap Kings JLT': 'likely', // page unknown to the Ad Library
  });
  const armor = pn('Armor Shield Detailing').adCheck;
  assert.deepEqual([armor.activeAds, armor.totalAds], [3, 5]);
  assert.ok(Math.abs(armor.lastAdAt - (Date.now() - 10 * 864e5)) < 864e5, 'the date the newest live ad started');
  assert.ok(checkLog.includes('page:5550002') && checkLog.includes('page:5550002:live'), 'no live ad in the first load: the live ones are asked for');
  assert.match(pn('Glossy PPF Studio').adCheck.searchUrl, /active_status=all&.*country=AE&/, 'UAE, live and past ads');
  assert.deepEqual([pn('Glossy PPF Studio').adCheck.totalAds, pn('Wrap Kings JLT').adCheck.state], [0, 'likely']);
  assert.ok(checkLog.includes('page:5550001') && !checkLog.includes('q:glossyppf.example'), 'a confirmed page check needs no further searches');
  const glossyPhones = pn('Glossy PPF Studio').phones.map((p) => p.number);
  assert.equal(glossyPhones[0], '+971507000001', 'the main listing phone comes first');
  assert.ok(glossyPhones.includes('+97147000008'), 'the second branch phone is kept on the same record');
  const insta = pn('Insta Tint Bar');
  assert.equal(insta.website, null, 'an Instagram link from Maps is not a website');
  assert.equal(insta.socials.instagram, 'https://www.instagram.com/instatintbar/');
  assert.equal(pn('Glossy PPF Studio').niche, 'Car detailing studios');

  /* ------------------------------------- Meta ads: Google Maps tab (no key) */
  await setKey('');
  await sw.evaluate(() => startFinder({ niche: 'Aesthetic clinics', keywords: ['aesthetic clinic'], areas: ['JLT'], city: 'Dubai', target: 10 }));
  const f2 = await finderDone('Maps tab search');
  assert.equal(f2.mapsMode, 'browser');
  assert.equal(f2.added, 4, 'two cards from the page + two from the network data');
  await checksDone('ad checks (Maps run)');
  await dash.bringToFront(); // the Maps and Ad Library tabs were in front; background tabs don't run the drawer's slide-in
  ps = await prospectsNow();
  const pure = pn('Pure Derma Studio');
  // Ran ads before: two old ads link to their website, nothing live. The last one stopped 45 days ago.
  const pureAd = pure.adCheck;
  console.log('ad history:', JSON.stringify(Object.fromEntries(ps.filter((l) => l.adCheck.state !== 'skipped').map((l) => [l.pageName, [l.adCheck.state, l.adCheck.lastAdAt ? new Date(l.adCheck.lastAdAt).toISOString().slice(0, 10) : null]]))));
  assert.deepEqual([pureAd.state, pureAd.activeAds, pureAd.totalAds], ['past', 0, 2]);
  assert.ok(Math.abs(pureAd.lastAdAt - (Date.now() - 45 * 864e5)) < 864e5, 'the date the last ad stopped');
  assert.deepEqual(await sw.evaluate((l) => LH.adStatus(l), pure), { status: 'ran_before_inactive_now', sure: true, lastAdAt: pureAd.lastAdAt });
  // A login wall: the checks pause and say so, and nothing tries to get past it. Resume carries on.
  metaWall.body = 'You must log in to continue.';
  await sw.evaluate((id) => handlers['adcheck:recheck']({ ids: [id] }), pure.id);
  await waitFor(async () => (await storage('adCheckPaused')).adCheckPaused === true, 60000, 'checks paused at the wall');
  assert.equal((await storage('alerts')).alerts.adlib.text, 'Facebook asked you to log in');
  assert.equal((await lead(pure.id)).adCheck.state, 'queued', 'waits its turn again');
  assert.deepEqual((await storage('adCheckQueue')).adCheckQueue, [pure.id]);
  assert.equal((await storage('problems')).problems.adlib[0][1], 'Facebook asked you to log in');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '!');
  await dash.click('[data-view="ads"]');
  await dash.waitForSelector('[data-alert="adlib"]');
  assert.match(await dash.textContent('[data-alert="adlib"]'), /Meta Ad Library paused: Facebook asked you to log in\. Open the Ad Library tab/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/20-adlib-paused.png` });
  metaWall.body = '';
  await dash.click('[data-act="adcheck-resume"]');
  await checksDone('ad check after resume');
  assert.equal((await lead(pure.id)).adCheck.state, 'past');
  assert.ok(!(await storage('alerts')).alerts.adlib);
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');
  await dash.waitForFunction(() => !document.querySelector('[data-alert]'));
  assert.equal(pure.website, 'https://purederma.example/', 'website read from Maps network data');
  assert.equal(pure.phones[0].number, '+971553334443', 'phone read from Maps network data');
  assert.equal(pure.sources.maps.reviews, 95);
  assert.equal(pn('Velvet Laser Lounge').phones[0].number, '+971503334442');
  assert.match(pn('Glow Skin Clinic JLT').sources.maps.mapsUrl, /^https:\/\/www\.google\.com\/maps\?cid=\d+$/);

  // Meta ads tab: businesses running ads (with a website) are hidden by default and show with the filter.
  await dash.click('[data-view="ads"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 9);
  assert.ok(!(await dash.$(`tr[data-id="${pn('Armor Shield Detailing').id}"]`)), 'running ads: hidden');
  assert.match(await dash.textContent(`tr[data-id="${insta.id}"]`), /@instatintbar/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/10-meta-ads.png` });
  await dash.check('[data-af="skipped"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 11);
  assert.match(await dash.textContent(`tr[data-id="${pn('Armor Shield Detailing').id}"] .tags`), /Running ads/);
  await dash.uncheck('[data-af="skipped"]');
  await dash.selectOption('[data-af="ads"]', 'running');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 2);
  await dash.selectOption('[data-af="ads"]', 'past');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 1);
  assert.match(await dash.textContent(`tr[data-id="${pure.id}"]`), /Ran ads before · stopped/);
  await dash.selectOption('[data-af="ads"]', '');
  await dash.selectOption('[data-af="tag"]', 'No website');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 5);
  await dash.selectOption('[data-af="tag"]', '');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 9);

  // Ads script for a business with a website and no Meta ads.
  await dash.click(`tr[data-id="${pn('Glossy PPF Studio').id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-bubble]');
  const gb = await dash.$$eval('.drawer [data-bubble]', (b) => b.map((x) => x.value));
  assert.equal(gb[0], 'Hello Glossy PPF Studio');
  assert.ok(gb[1].includes('We help car detailing studios in Dubai get consistent inquiries through Facebook and Instagram ads.'));
  assert.equal(gb[2], 'Let me know');
  assert.match(await dash.textContent('.drawer .pitch h3'), /Ads script/);
  if (SHOTS) {
    await dash.waitForTimeout(500);
    await dash.screenshot({ path: `${SHOTS}/11-meta-ads-drawer.png` });
  }
  await dash.click('[data-channel="instagram"]');
  assert.equal(await dash.$$eval('.drawer [data-act="open-bubble"]', (b) => b.length), 0, 'Instagram: copy only');
  assert.equal(await dash.$$eval('.drawer [data-act="copy-bubble"]', (b) => b.length), 3);
  await dash.click('[data-act="close"]');
  // Website script for one without a website, with a link to their Instagram.
  await dash.click(`tr[data-id="${insta.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-bubble]');
  assert.match(await dash.inputValue('[data-bubble="1"]'), /^I came across Insta Tint Bar on Google Maps and couldn't find a website for you\./);
  await dash.click('[data-channel="instagram"]');
  assert.equal(await dash.getAttribute('.drawer .send-to a', 'href'), 'https://www.instagram.com/instatintbar/');
  await dash.click('[data-act="close"]');
  // 2 bubbles: greeting and body together.
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, bubbles: 2 } });
  });
  await dash.click(`tr[data-id="${pn('Nano Pro Tint').id}"] [data-open]`);
  await dash.waitForFunction(() => document.querySelectorAll('.drawer.open [data-bubble]').length === 2);
  assert.match(await dash.inputValue('[data-bubble="0"]'), /^Hello Nano Pro Tint\n\nI came across Nano Pro Tint/);
  await dash.click('[data-act="close"]');
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, bubbles: 3 } });
  });
  const [dl2] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="ads-export"]')]);
  const [head2, ...rows2] = parseCsv(fs.readFileSync(await dl2.path(), 'utf8'));
  assert.deepEqual(head2.slice(0, 5), ['priority', 'business', 'niche', 'area', 'meta_ads']);
  assert.ok(head2.includes('instagram') && head2.includes('email'));
  assert.equal(rows2.length, 9, '9 prospects');
  assert.equal(rows2.find((r) => r[1] === 'Insta Tint Bar')[head2.indexOf('instagram')], 'https://www.instagram.com/instatintbar/');
  assert.equal(rows2.find((r) => r[1] === 'Glossy PPF Studio')[head2.indexOf('niche')], 'Car detailing studios');
  const pureRow = rows2.find((r) => r[1] === 'Pure Derma Studio');
  assert.deepEqual([pureRow[head2.indexOf('meta_ads')], pureRow[head2.indexOf('meta_ad_status')], pureRow[head2.indexOf('last_ad_date')]], ['Ran ads before', 'ran_before_inactive_now', new Date(pure.adCheck.lastAdAt || Date.now() - 45 * 864e5).toISOString().slice(0, 10)]);

  /* ------------------------------- phone queue: one button per bubble, synced back */
  await dash.selectOption('[data-af="status"]', 'new');
  await dash.selectOption('[data-af="contact"]', 'phone');
  const ids = await dash.$$eval('[data-ads-rows] tr', (trs) => trs.slice(0, 3).map((t) => t.dataset.id));
  assert.equal(ids.length, 3);
  for (const id of ids) await dash.click(`tr[data-id="${id}"] [data-sel]`);
  await dash.click('[data-act="ads-bulk-queue"]');
  await waitFor(async () => (queueStore.peek() || { items: [] }).items.length === 3, 10000, 'queue to receive 3 leads');
  await dash.waitForFunction(() => document.querySelectorAll('.tag.phone').length === 3);
  const queued = queueStore.peek().items;
  assert.ok(queued.every((i) => i.parts.length === 3 && i.message === i.parts.join('\n\n')), 'each lead goes to the phone as 3 bubbles');
  assert.ok(queued.every((i) => /^(No website|No Meta ads|Ran ads before)/.test(i.issue)), 'the tag line: ' + queued.map((i) => i.issue).join(' | '));
  await dash.click('[data-ads-bulk] [data-act="bulk-clear"]');

  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(pairUrl);
  await phone.waitForFunction(() => document.querySelectorAll('[data-list] .card').length === 3);
  const firstCard = await phone.$eval('[data-list] .card', (c) => c.dataset.id);
  const fc = queued.find((i) => i.id === firstCard);
  const card = `[data-list] .card[data-id="${firstCard}"]`;
  const labels = await phone.$$eval(`${card} [data-act="part"]`, (a) => a.map((x) => x.textContent.trim()));
  assert.deepEqual(labels, [`1 · ${fc.parts[0]}`, '2 · Message', '3 · Let me know'], 'one button per bubble');
  assert.equal(await phone.$eval(`${card} [data-act="part"]`, (a) => a.href), `https://wa.me/${fc.wa}?text=${encodeURIComponent(fc.parts[0])}`);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/9-phone-queue.png` });
  for (let k = 0; k < 3; k++) {
    const [tab] = await Promise.all([ctx.waitForEvent('page'), phone.click(`${card} [data-act="part"][data-k="${k}"]`)]);
    await tab.close();
    if (k < 2) {
      await phone.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel).classList.contains('ticked'), `${card} [data-act="part"][data-k="${k}"]`);
      assert.equal(queueStore.peek().items.find((i) => i.id === firstCard).status, 'queued', 'still to send until the last bubble');
    }
  }
  await waitFor(async () => queueStore.peek().items.find((i) => i.id === firstCard).status === 'sent', 10000, 'last bubble files the lead under Sent');
  await phone.waitForFunction(() => /2 to send · 1 sent/.test(document.querySelector('[data-sub]').textContent));
  if (SHOTS) {
    await phone.click('[data-tab="sent"]');
    await phone.screenshot({ path: `${SHOTS}/9b-phone-queue-sent.png` });
    await phone.click('[data-tab="queued"]');
  }

  // The extension picks up "sent" and marks the lead as contacted, with the script it got.
  await sw.evaluate(() => syncQueue());
  const synced = await lead(firstCard);
  assert.equal(synced.status, 'contacted');
  assert.equal(synced.phoneQueue.state, 'sent');
  assert.equal(synced.queuedScript, synced.website ? 'ads' : 'website', 'the script its bubbles came from');
  assert.equal(synced.sentScript, synced.queuedScript);
  assert.ok(synced.contactedAt > 0 && synced.niche);
  // A status set by hand afterwards survives later syncs.
  await dash.selectOption('[data-af="status"]', 'all');
  await dash.waitForSelector(`tr[data-id="${firstCard}"]`);
  await dash.selectOption(`tr[data-id="${firstCard}"] [data-status]`, 'followup');
  await waitFor(async () => (await lead(firstCard)).status === 'followup', 5000, 'manual follow-up');
  await sw.evaluate(() => syncQueue());
  assert.equal((await lead(firstCard)).status, 'followup', 'sync must not override a manual status');

  // Marking a queued lead as contacted on the computer ticks it off on the phone too.
  const second = ids.find((id) => id !== firstCard);
  await dash.selectOption(`tr[data-id="${second}"] [data-status]`, 'contacted');
  await waitFor(async () => queueStore.peek().items.find((i) => i.id === second).status === 'sent', 10000, 'computer status to reach the phone queue');
  assert.ok((await lead(second)).contactedAt > 0 && (await lead(second)).sentScript, 'a status change records the contact too');
  await phone.click('[data-refresh]');
  await phone.waitForFunction(() => /1 to send · 2 sent/.test(document.querySelector('[data-sub]').textContent));

  // A long name ends in … on a 390px phone instead of pushing the page sideways, and bubble 1 still reads "Hello …".
  const queueCall = (method, body) =>
    queueHandle(new Request('https://www.rizcoreach.ae/api/lead-queue', { method, headers: { authorization: `Bearer ${QUEUE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), queueStore, QUEUE_KEY);
  const longName = 'Dr. Smile Dental Clinic - Best Dentist in Dubai Marina';
  const longParts = [`Hello ${longName}`, 'Line one\n\nLine two', 'Let me know'];
  await queueCall('PUT', { items: [{ id: 'long-name', name: longName, wa: '971500000099', message: longParts.join('\n\n'), parts: longParts }] });
  await phone.click('[data-refresh]');
  await phone.waitForSelector('[data-id="long-name"]');
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scrolling at 390px');
  assert.deepEqual(await phone.$$eval('[data-id="long-name"] [data-act="part"]', (a) => a.map((x) => x.textContent.trim())), [`1 · Hello ${longName}`, '2 · Message', '3 · Let me know']);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/9c-phone-queue-long-name.png`, fullPage: true });
  await queueCall('DELETE', { ids: ['long-name'] });

  /* ------------------------------------------------------ Replied + Results */
  const replied = `tr[data-id="${firstCard}"] [data-replied]`;
  await dash.click(replied);
  await waitFor(async () => (await lead(firstCard)).status === 'replied', 5000, 'Replied button');
  assert.ok((await lead(firstCard)).repliedAt > 0);
  await dash.waitForFunction((sel) => document.querySelector(sel).getAttribute('aria-pressed') === 'true', replied);
  await dash.click(replied);
  await waitFor(async () => (await lead(firstCard)).status === 'contacted', 5000, 'Replied tapped again undoes it');
  assert.equal((await lead(firstCard)).repliedAt, null);
  await dash.waitForFunction((sel) => document.querySelector(sel).getAttribute('aria-pressed') === 'false', replied);
  await dash.click(replied);
  await waitFor(async () => (await lead(firstCard)).status === 'replied', 5000, 'Replied again');

  // Results count every lead in both tabs: 3 website leads + 2 prospects sent, 1 replied.
  const everyLead = Object.entries(await storage(null)).filter(([k]) => k.startsWith('lead:')).map(([, v]) => v);
  const sentLeads = everyLead.filter((l) => l.contactedAt);
  const repliedLeads = everyLead.filter((l) => ['replied', 'meeting', 'won'].includes(l.status) || l.repliedAt);
  assert.equal(sentLeads.length, 5);
  assert.equal(repliedLeads.length, 1);
  await dash.click('[data-view-panel="ads"] [data-results] summary');
  await dash.waitForFunction(() => /^5 sent · 1 replied · 20% reply rate$/.test(document.querySelector('[data-view-panel="ads"] [data-results-sum]').textContent));
  const rows = await dash.$$eval('[data-view-panel="ads"] [data-results-body] table', (ts) =>
    ts.map((t) => [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent).join('|'))),
  );
  const webSent = sentLeads.filter((l) => l.sentScript === 'website').length;
  const webReplied = repliedLeads.filter((l) => l.sentScript === 'website').length;
  assert.ok(rows[1].includes(`Website script|${webSent}|${webReplied}|${Math.round((100 * webReplied) / webSent)}%`), JSON.stringify(rows));
  assert.ok(rows[0].some((r) => r.startsWith('Car detailing studios|')), JSON.stringify(rows));
  assert.equal(sentLeads.filter((l) => l.niche === 'Car detailing studios').length + sentLeads.filter((l) => l.niche === 'Aesthetic clinics').length, 5);
  if (SHOTS) {
    await dash.evaluate(() => scrollTo(0, 0));
    await dash.screenshot({ path: `${SHOTS}/13-results.png` });
  }
  // The same panel on the Website leads tab, open too.
  await dash.click('[data-view="leads"]');
  assert.equal(await dash.textContent('[data-view-panel="leads"] [data-results-sum]'), '5 sent · 1 replied · 20% reply rate');
  assert.ok(await dash.$eval('[data-view-panel="leads"] [data-results]', (d) => d.open));

  /* --------------------------------- leads you are talking to stay in view */
  // A skipped lead (website and running ads) that is in your pipeline shows with the default filters, and by its status.
  const rowShown = (id) => dash.$(`[data-rows] tr[data-id="${id}"]`).then(Boolean);
  assert.ok(!(await rowShown(bad.id)), 'skipped and new: hidden');
  await dash.evaluate((id) => update(id, { status: 'meeting' }), bad.id);
  await waitFor(async () => (await lead(bad.id)).status === 'meeting', 5000, 'meeting booked');
  await dash.waitForSelector(`[data-rows] tr[data-id="${bad.id}"]`);
  await dash.selectOption('[data-f="status"]', 'meeting');
  await dash.waitForFunction((id) => [...document.querySelectorAll('[data-rows] tr')].map((t) => t.dataset.id).join() === id, bad.id);
  await dash.selectOption('[data-f="status"]', '');

  // A "sent" from the phone records the script that was queued, even if an ad check changes the lead in between.
  const adsId = await sw.evaluate(async () =>
    (Object.values(await chrome.storage.local.get(null)).find((x) => x && x.kind === 'prospect' && x.status === 'new' && x.phones.length && LH.scriptFor(x).script === 'ads') || {}).id,
  );
  assert.ok(adsId, 'a new prospect that gets the ads script');
  await sw.evaluate((id) => pushToQueue([id]), adsId);
  assert.equal((await lead(adsId)).queuedScript, 'ads');
  await sw.evaluate(async (id) => {
    const k = `lead:${id}`;
    const { [k]: l } = await chrome.storage.local.get(k);
    await chrome.storage.local.set({ [k]: { ...l, adCheck: { ...l.adCheck, state: 'running' } } }); // now skipped: no script
  }, adsId);
  await queueCall('POST', { updates: [{ id: adsId, status: 'sent', rev: queueStore.peek().items.find((i) => i.id === adsId).addedAt }] });
  await sw.evaluate(() => syncQueue());
  const late = await lead(adsId);
  assert.equal(late.status, 'contacted');
  assert.equal(late.sentScript, 'ads', 'the script that was sent, not the one the lead would get now');
  // It runs ads now, but you messaged it: it stays in the Meta ads list.
  await dash.click('[data-view="ads"]');
  await dash.selectOption('[data-af="status"]', '');
  await dash.waitForSelector(`[data-ads-rows] tr[data-id="${adsId}"]`);
  assert.match(await dash.textContent(`[data-ads-rows] tr[data-id="${adsId}"] .tags`), /Running ads/);

  /* ------------------------------- email queue: sent by the sender in Gmail, synced back */
  // The sender (lead-hunter/email/sender.gs) talks to the real handler; `at` is its clock.
  const emailCall = async (body, at = Date.now()) =>
    (await emailHandle(new Request('https://www.rizcoreach.ae/api/email-queue', { method: 'POST', headers: { authorization: `Bearer ${QUEUE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), emailStore, QUEUE_KEY, () => at)).json();
  const emailStatus = () => dash.textContent('[data-email-status]');
  await dash.click('[data-view="settings"]');
  assert.ok(await dash.isHidden('[data-email-nokey]'));
  await dash.waitForFunction(() => /Not set up yet/.test(document.querySelector('[data-email-status]').textContent));
  assert.match(await emailStatus(), /Sent today 0 of 15 · 0 queued · 0 replied · 0 bounced/, 'a new sender starts at 15 a day');
  assert.equal(await dash.$$eval('[data-email-on] .steps li', (li) => li.length), 6, 'six setup steps');
  assert.equal((await emailCall({ action: 'claim' })).job, null, 'nothing to send yet');
  await dash.click('[data-view="leads"]');
  await dash.click('[data-view="settings"]');
  await dash.waitForFunction(() => /Running, last check just now/.test(document.querySelector('[data-email-status]').textContent));
  // Copy sender script: the site and key are filled in.
  await dash.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { value: async (t) => (window.copied = t) }));
  await dash.click('[data-act="copy-sender"]');
  const senderScript = await (await dash.waitForFunction(() => window.copied)).jsonValue();
  assert.match(senderScript, /^var SITE = 'https:\/\/www\.rizcoreach\.ae';/m);
  assert.ok(senderScript.includes(`var KEY = '${QUEUE_KEY}';`));
  assert.ok(senderScript.includes('function tick()'), 'the whole script');
  // The daily limit goes to the site, where the sender reads it. Pause and resume.
  await dash.fill('[name="emailMaxPerDay"]', '20');
  await dash.click('[data-settings-form] button[type="submit"]');
  await waitFor(async () => emailStore.peek().settings.maxPerDay === 20, 5000, 'daily limit saved on the site');
  assert.equal((await storage('settings')).settings.emailMaxPerDay, 20);
  await dash.click('[data-act="email-pause"]');
  await dash.waitForFunction(() => /Paused: you paused it/.test(document.querySelector('[data-email-status]').textContent));
  assert.equal(emailStore.peek().settings.paused, true);
  if (SHOTS) {
    await dash.$eval('#email', (el) => el.scrollIntoView());
    await dash.screenshot({ path: `${SHOTS}/14-settings-email.png` });
  }
  await dash.click('[data-act="email-pause"]');
  await dash.waitForFunction(() => !/Paused/.test(document.querySelector('[data-email-status]').textContent));
  assert.equal(emailStore.peek().settings.paused, false);

  // Send to email queue: only leads with an address go in, as the first email and 2 follow ups.
  const parked = by('Parked Polish');
  const broken = by('Broken Buff');
  await dash.evaluate((id) => update(id, { addEmail: 'Owner@ParkedPolish.example' }), parked.id);
  await waitFor(async () => (await lead(parked.id)).emails.length === 1, 5000, 'email added');
  await dash.click('[data-view="leads"]');
  for (const id of [parked.id, broken.id, desert.id]) await dash.click(`tr[data-id="${id}"] [data-sel]`);
  await dash.click('[data-act="bulk-email"]');
  await dash.waitForFunction(() => document.querySelector('[data-toast]').textContent === '1 added to the email queue · 2 have no email');
  const mail = emailStore.peek().items[0];
  assert.equal(emailStore.peek().items.length, 1);
  assert.deepEqual([mail.id, mail.email, mail.subject, mail.script, mail.fromName, mail.status], [parked.id, 'owner@parkedpolish.example', 'Website for Parked Polish', 'website', 'Samil', 'queued']);
  assert.equal(mail.steps.length, 3);
  assert.match(mail.steps[0], /^Hello Parked Polish\n\nI came across Parked Polish on Facebook and Instagram and your website wasn't loading when I checked\./);
  assert.match(mail.steps[1], /^Hello Parked Polish\n\nJust bringing this back to the top of your inbox\./);
  assert.ok(mail.steps.every((t) => t.endsWith("\n\nIf you'd rather not hear from me just reply no thanks and I won't email again.")), 'every email has the opt out line');
  await dash.waitForFunction((id) => (document.querySelector(`tr[data-id="${id}"] .tag.green`) || {}).textContent === 'Email queued', parked.id);
  await dash.click('[data-act="bulk-email"]');
  await dash.waitForFunction(() => document.querySelector('[data-toast]').textContent === '0 added to the email queue · 2 have no email · 1 already emailed');
  await dash.click('[data-bulk] [data-act="bulk-clear"]');

  // The sender sends the first email on a Monday morning in Dubai: the lead is contacted, with the script it got.
  const dubai = new Date(Date.now() + 4 * 3600e3);
  const monday = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate() + ((8 - dubai.getUTCDay()) % 7 || 7), 6); // 10:00 in Dubai
  const { job } = await emailCall({ action: 'claim' }, monday);
  assert.deepEqual([job.id, job.step, job.to, job.subject, job.body], [parked.id, 0, 'owner@parkedpolish.example', 'Website for Parked Polish', mail.steps[0]]);
  assert.deepEqual(await emailCall({ action: 'report', id: job.id, step: 0, ok: true, threadId: 't1', messageId: '<m1@mail.gmail.com>' }, monday), { ok: true });
  await sw.evaluate(() => syncEmail());
  const emailed = await lead(parked.id);
  assert.deepEqual([emailed.status, emailed.contactedAt, emailed.sentScript], ['contacted', monday, 'website']);
  assert.deepEqual(emailed.statusHistory.at(-1), { status: 'contacted', at: monday, via: 'email' });
  await dash.waitForFunction((id) => (document.querySelector(`tr[data-id="${id}"] .tag.green`) || {}).textContent === 'Emailed', parked.id);
  // The lead panel shows every email and where they stand.
  await dash.click(`tr[data-id="${parked.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-bubble]');
  await dash.click('[data-channel="email"]');
  assert.equal(await dash.textContent('.drawer .email-to'), 'To owner@parkedpolish.example');
  assert.equal(await dash.inputValue('[data-email-subject]'), 'Website for Parked Polish');
  assert.deepEqual(await dash.$$eval('.drawer [data-email-step]', (x) => x.map((t) => t.value)), mail.steps);
  const nextAt = emailStore.peek().items[0].nextAt;
  assert.equal(new Date(nextAt + 4 * 3600e3).getUTCDay(), 4, 'follow up 1 goes 3 working days later, on Thursday');
  const thu = await dash.evaluate((t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short' }), nextAt);
  assert.equal(await dash.textContent('[data-email-state]'), `Sent 1 of 3 · next follow up ${thu}`);
  assert.ok(await dash.$('.drawer [data-act="email-stop"]'), 'Stop emails while follow ups are due');
  if (SHOTS) {
    await dash.waitForTimeout(500);
    await dash.screenshot({ path: `${SHOTS}/15-drawer-email.png` });
  }
  // They reply: the sender finds it in the inbox and the lead is marked replied.
  assert.deepEqual(await emailCall({ action: 'events', events: [{ id: parked.id, type: 'replied' }] }, monday + 3600e3), { ok: true });
  await sw.evaluate(() => syncEmail());
  const answered = await lead(parked.id);
  assert.deepEqual([answered.status, answered.repliedAt, answered.emailQueue.state], ['replied', monday + 3600e3, 'replied']);
  await dash.waitForFunction(() => (document.querySelector('[data-email-state]') || {}).textContent === 'Replied');
  assert.ok(!(await dash.$('.drawer [data-act="email-stop"]')));
  await dash.click('[data-act="close"]');

  // Add to email queue from the lead panel, Stop emails, and a status set by hand also stops them.
  await dash.evaluate((id) => update(id, { addEmail: 'hi@brokenbuff.example' }), broken.id);
  await waitFor(async () => (await lead(broken.id)).emails.length === 1, 5000, 'email added');
  await dash.click(`tr[data-id="${broken.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-bubble]');
  await dash.click('[data-channel="email"]');
  await dash.click('.drawer [data-act="email-queue"]');
  await dash.waitForFunction(() => (document.querySelector('[data-email-state]') || {}).textContent === 'Queued');
  const brokenItem = () => emailStore.peek().items.find((i) => i.id === broken.id);
  assert.equal(brokenItem().status, 'queued');
  await dash.click('.drawer [data-act="email-stop"]');
  await waitFor(async () => brokenItem().status === 'cancelled', 5000, 'Stop emails reaches the site');
  await dash.waitForSelector('.drawer [data-act="email-queue"]'); // nothing went out, so it can be queued again
  await dash.click('.drawer [data-act="email-queue"]');
  await waitFor(async () => brokenItem().status === 'queued', 5000, 'queued again');
  await dash.selectOption('#d-status', 'lost');
  await waitFor(async () => brokenItem().status === 'cancelled', 5000, '"Not interested" stops the emails');
  await dash.click('[data-act="close"]');
  // A business already messaged on WhatsApp is not emailed as well: one channel per business.
  const washed = by('Wash Wizards');
  assert.ok((await lead(washed.id)).contactedAt, 'messaged on WhatsApp earlier');
  await dash.evaluate((id) => update(id, { addEmail: 'team@washwizards.example' }), washed.id);
  await waitFor(async () => (await lead(washed.id)).emails.includes('team@washwizards.example'), 5000, 'email added');
  await dash.click(`tr[data-id="${washed.id}"] [data-sel]`);
  await dash.click('[data-act="bulk-email"]');
  await dash.waitForFunction(() => document.querySelector('[data-toast]').textContent === '0 added to the email queue · 1 already messaged on WhatsApp');
  assert.ok(!emailStore.peek().items.some((i) => i.id === washed.id));
  await dash.click('[data-bulk] [data-act="bulk-clear"]');

  // "No thanks": the lead is marked not interested and never emailed again.
  const desertLead = by('Desert Detailers');
  await dash.evaluate((id) => update(id, { status: 'new', addEmail: 'book@desertdetailers.example' }), desertLead.id);
  await waitFor(async () => (await lead(desertLead.id)).emails.includes('book@desertdetailers.example'), 5000, 'email added');
  await dash.click(`tr[data-id="${desertLead.id}"] [data-sel]`);
  await dash.click('[data-act="bulk-email"]');
  await dash.waitForFunction(() => /^1 added to the email queue/.test(document.querySelector('[data-toast]').textContent));
  await dash.click('[data-bulk] [data-act="bulk-clear"]');
  const tuesday = monday + 24 * 3600e3;
  const optJob = (await emailCall({ action: 'claim' }, tuesday)).job;
  assert.equal(optJob.id, desertLead.id);
  await emailCall({ action: 'report', id: optJob.id, step: 0, ok: true, threadId: 't2', messageId: '<m2@mail.gmail.com>' }, tuesday);
  await emailCall({ action: 'events', events: [{ id: optJob.id, type: 'optout' }] }, tuesday + 3600e3);
  await sw.evaluate(() => syncEmail());
  const declined = await lead(desertLead.id);
  assert.deepEqual([declined.status, declined.doNotEmail, declined.repliedAt, declined.emailQueue.state], ['lost', true, tuesday + 3600e3, 'optout']);
  assert.ok(emailStore.peek().never.includes('book@desertdetailers.example'), 'on the never list');
  assert.equal((await emailCall({ action: 'claim' }, tuesday + 7 * 24 * 3600e3)).job, null, 'no follow up after a no thanks');

  // The Meta ads tab has it too, and a business running ads is never emailed.
  await dash.evaluate((id) => update(id, { addEmail: 'hello@runsads.example' }), adsId);
  await waitFor(async () => (await lead(adsId)).emails.includes('hello@runsads.example'), 5000, 'email added');
  await dash.click('[data-view="ads"]');
  await dash.click(`[data-ads-rows] tr[data-id="${adsId}"] [data-sel]`);
  await dash.click('[data-act="ads-bulk-email"]');
  await dash.waitForFunction(() => document.querySelector('[data-toast]').textContent === '0 added to the email queue · 1 runs ads');
  assert.ok(!emailStore.peek().items.some((i) => i.id === adsId));
  await dash.click('[data-ads-bulk] [data-act="bulk-clear"]');

  /* ----------------------- Presets: the four searches from the brief, before and after the filters */
  // Meta ads tab, no Places key: each search reads the Maps results list only; failing listings are never opened.
  const runPreset = async (niche, keyword, area, cap = 100) => {
    const r = await sw.evaluate((c) => startFinder(c).then((f) => ({ id: f.id })).catch((e) => ({ error: e.message })), { niche, keywords: [keyword], areas: [area], cap });
    if (r.error) return r;
    return waitFor(async () => {
      const { finder } = await storage('finder');
      return finder && finder.id === r.id && !['running', 'paused'].includes(finder.status) ? finder : null;
    }, 90000, `${niche} search`);
  };
  const briefStats = {};
  const briefRuns = [['Car', 'ppf', 'Al Quoz Industrial Area 3, Dubai'], ['Fitness', 'boxing gym', 'Al Nahda, Sharjah'], ['Pets', 'dog trainer', 'Al Barsha, Dubai'], ['Accountants', 'accounting firm', 'Business Bay, Dubai']];
  for (const [niche, kw, area] of briefRuns) {
    const f = await runPreset(niche, kw, area);
    const { found, kept, fewReviews, manyReviews, excluded, duplicate } = f.stats;
    briefStats[`${kw} ${area}`] = { found, kept, fewReviews, manyReviews, excluded, duplicate };
  }
  console.log('preset searches (found -> kept):', JSON.stringify(briefStats));
  assert.deepEqual(briefStats, {
    'ppf Al Quoz Industrial Area 3, Dubai': { found: 8, kept: 3, fewReviews: 1, manyReviews: 1, excluded: 3, duplicate: 0 },
    'boxing gym Al Nahda, Sharjah': { found: 5, kept: 2, fewReviews: 0, manyReviews: 1, excluded: 2, duplicate: 0 },
    'dog trainer Al Barsha, Dubai': { found: 4, kept: 1, fewReviews: 1, manyReviews: 0, excluded: 2, duplicate: 0 },
    'accounting firm Business Bay, Dubai': { found: 5, kept: 2, fewReviews: 0, manyReviews: 1, excluded: 2, duplicate: 0 },
  });
  const keptNames = (await prospectsNow()).filter((l) => ['Car', 'Fitness', 'Pets', 'Accountants'].includes(l.niche)).map((l) => l.pageName).sort();
  assert.deepEqual(keptNames, ['Al Noor Accounting', 'Gloss Garage', 'Gloss Garage - JLT Branch', 'Happy Paws Training', 'Iron Fist Boxing', 'Key Ledger Bookkeeping', 'Shield PPF Center', 'Spartan Boxing Sharjah']);
  for (const kept of keptNames) assert.ok(Object.values(PRESET_SEARCHES).flat().some(([n]) => n === kept));
  const gp = (await prospectsNow()).find((l) => l.pageName === 'Gloss Garage');
  assert.deepEqual([gp.area, gp.sources.maps.reviews, gp.adCheck.state], ['Al Quoz Industrial Area 3, Dubai', 42, 'skipped']);
  // Tags on the Meta ads tab: phone type and chains. Mobile only and Hide chains filter them.
  await dash.bringToFront();
  await dash.click('[data-view="ads"]');
  await dash.selectOption('[data-af="niche"]', 'Car');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 3);
  const tagsOf = (name) => dash.$$eval('[data-ads-rows] tr', (rows, n) => [...rows.find((r) => r.querySelector('.n').textContent === n).querySelectorAll('.tag')].map((t) => t.textContent), name);
  assert.deepEqual((await tagsOf('Gloss Garage')).slice(0, 2), ['Mobile', 'Chain']);
  assert.deepEqual((await tagsOf('Gloss Garage - JLT Branch')).slice(0, 2), ['Landline', 'Chain']);
  assert.deepEqual((await tagsOf('Shield PPF Center')).slice(0, 1), ['Corporate']);
  assert.match(await dash.textContent('[data-ads-rows]'), /\(150\)/, 'the review count shows on the lead');
  await dash.check('[data-af="mobile"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 1);
  await dash.uncheck('[data-af="mobile"]');
  await dash.check('[data-af="chains"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 1);
  assert.match(await dash.textContent('[data-ads-rows]'), /Shield PPF Center/);
  await dash.uncheck('[data-af="chains"]');
  await dash.selectOption('[data-af="niche"]', '');
  // The finder panel shows the last run's before and after.
  assert.match(await dash.textContent('[data-finder-status]'), /5 found → 2 kept · 1 over 50 reviews · 2 excluded words/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/17-presets-run.png` });
  // Finished searches are remembered: running the same one again says so, a new pair runs, and Start over forgets.
  assert.match((await runPreset('Car', 'ppf', 'Al Quoz Industrial Area 3, Dubai')).error, /Every search of Car has been run/);
  const progress = await sw.evaluate(() => handlers['finder:progress']({}));
  assert.deepEqual(progress.progress.Car, { total: 588, done: 1 });
  // A capped run: 2 pairs left, cap 1, so it runs 1 and the next run carries on with the other.
  const pausedRun = await sw.evaluate(() => startFinder({ niche: 'Car', keywords: ['ppf', 'ceramic coating'], areas: ['Al Quoz Industrial Area 3, Dubai', 'Al Barsha, Dubai'], cap: 1 }));
  assert.deepEqual(pausedRun.mapsQ.map((q) => q.q), ['ppf Al Barsha, Dubai'], 'finished pairs are skipped, keywords first, then areas, up to the cap');
  await sw.evaluate(() => handlers['finder:pause']({}));
  assert.equal((await storage('finder')).finder.status, 'paused');
  await sw.evaluate(() => handlers['finder:resume']({}));
  await waitFor(async () => (await storage('finder')).finder.status === 'done', 90000, 'capped run');
  assert.deepEqual((await sw.evaluate(() => handlers['finder:progress']({}))).progress.Car, { total: 588, done: 2 });
  await sw.evaluate(() => handlers['finder:reset']({ preset: 'Car' }));
  assert.deepEqual((await sw.evaluate(() => handlers['finder:progress']({}))).progress.Car, { total: 588, done: 0 });

  /* ------------------------- One record per business, and a memory of everyone you contacted */
  // Exports to Google Contacts were remembered earlier on.
  const memory = async () => (await storage('contactHistory')).contactHistory || {};
  assert.deepEqual((await memory())['d:shineautospa.example'].slice(1, 3), ['export', '9000'], 'Shine Auto Spa went to Google Contacts');
  // Import a sheet of numbers you already messaged (any CSV with phones, like a Google Contacts export).
  await dash.click('[data-view="settings"]');
  const sheet = 'Name,Phone 1 - Value\nWax Lab,050 777 8801\nIron Fist,"+971 52 222 3301 ::: 04 999 0000"\n';
  await dash.setInputFiles('[data-import-history]', { name: 'contacted.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet) });
  await dash.waitForFunction(() => document.querySelector('[data-toast]').textContent === '3 phone numbers found, 3 new. Future searches skip them.');
  assert.match(await dash.textContent('[data-history-count]'), /^Remembering \d+ phone numbers and \d+ websites/);
  // A search: "Glos Garage LLC" is Gloss Garage (same area, Jaro-Winkler 0.98) and Wax Lab is in the imported contacts.
  const memRun = await runPreset('Car', 'ceramic coating', 'Al Quoz Industrial Area 3, Dubai');
  const pick = ({ found, kept, duplicate, contacted }) => ({ found, kept, duplicate, contacted });
  console.log('contacted memory search:', JSON.stringify(pick(memRun.stats)));
  assert.deepEqual(pick(memRun.stats), { found: 3, kept: 1, duplicate: 1, contacted: 1 });
  const gloss = await lead(gp.id);
  assert.deepEqual([gloss.pageName, gloss.sources.maps.otherListings.length], ['Gloss Garage', 1], 'one record, both listings');
  assert.ok(gloss.phones.some((x) => x.number === '+971501112299'), 'with the second listing phone');
  const names = (await prospectsNow()).map((l) => l.pageName);
  assert.ok(names.includes('Shine Bay Detailing') && !names.includes('Glos Garage LLC') && !names.includes('Wax Lab Detailing'));
  await dash.click('[data-view="ads"]');
  await dash.waitForFunction(() => /3 found → 1 kept · 1 already saved · 1 contacted before/.test(document.querySelector('[data-finder-status]').textContent));
  // Iron Fist Boxing was already saved, and its number is in the sheet: hidden until you ask for it.
  await dash.selectOption('[data-af="status"]', '');
  await dash.selectOption('[data-af="niche"]', 'Fitness');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 1);
  await dash.check('[data-af="contactedBefore"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 2);
  assert.deepEqual((await tagsOf('Iron Fist Boxing')).slice(0, 1), ['Contacted before']);
  const iron = (await prospectsNow()).find((l) => l.pageName === 'Iron Fist Boxing');
  await dash.click(`[data-ads-rows] tr[data-id="${iron.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open .contacted-row .tag');
  assert.match(await dash.textContent('.drawer .contacted-row'), /Contacted before .*· your imported contacts/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/18-contacted-before.png` });
  // Reset: new again and findable. The sheet's other numbers stay remembered.
  await dash.click('.drawer [data-act="reset-contacted"]');
  await waitFor(async () => !(await memory())['p:+971522223301'], 5000, 'reset forgets the business');
  assert.ok((await memory())['p:+971507778801'] && (await memory())['p:+97149990000']);
  await dash.click('[data-act="close"]');
  await dash.uncheck('[data-af="contactedBefore"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-ads-rows] tr').length === 2);
  // Mark contacted with the channel, change the channel, then delete the lead: searches still skip it.
  await dash.selectOption('[data-af="niche"]', 'Car');
  const shine = (await prospectsNow()).find((l) => l.pageName === 'Shine Bay Detailing');
  await dash.click(`[data-ads-rows] tr[data-id="${shine.id}"] [data-open]`);
  await dash.click('.drawer.open [data-act="mark-via"][data-via="whatsapp"]');
  await waitFor(async () => (await lead(shine.id)).contactedVia === 'whatsapp', 5000, 'marked contacted on WhatsApp');
  assert.equal((await lead(shine.id)).status, 'contacted');
  await waitFor(async () => ((await memory())['p:+971567778802'] || [])[1] === 'whatsapp', 5000, 'remembered');
  assert.deepEqual((await memory())['n:shine bay detailing@al quoz industrial area 3, dubai'].slice(1, 3), ['whatsapp', shine.id]);
  await dash.waitForSelector('.drawer.open [data-act="mark-via"][data-via="whatsapp"].on');
  await dash.click('.drawer.open [data-act="mark-via"][data-via="instagram"]');
  await waitFor(async () => (await lead(shine.id)).contactedVia === 'instagram', 5000, 'channel changed');
  assert.equal((await lead(shine.id)).status, 'contacted');
  await dash.waitForFunction(() => / on Instagram\. Channel:/.test(document.querySelector('.drawer .contacted-row').textContent));
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/19-mark-contacted.png` });
  await dash.click('[data-act="close"]');
  await sw.evaluate((id) => handlers['lead:delete']({ ids: [id] }), shine.id);
  await sw.evaluate(() => handlers['finder:reset']({ preset: 'Car' }));
  const again = await runPreset('Car', 'ceramic coating', 'Al Quoz Industrial Area 3, Dubai');
  assert.deepEqual(pick(again.stats), { found: 3, kept: 0, duplicate: 1, contacted: 2 }, 'deleted, still remembered');
  assert.ok(!(await lead(shine.id)), 'not added back');
  // Reset on a contacted lead: back to New, and its own memory goes.
  const paws = (await prospectsNow()).find((l) => l.pageName === 'Happy Paws Training');
  await sw.evaluate((id) => handlers['lead:update']({ id, patch: { status: 'contacted', via: 'email' } }), paws.id);
  await waitFor(async () => ((await memory())['p:+971553334401'] || [])[1] === 'email', 5000, 'remembered by email');
  await sw.evaluate((id) => handlers['lead:reset']({ id }), paws.id);
  const pawsNow = await lead(paws.id);
  assert.deepEqual([pawsNow.status, pawsNow.contactedAt, pawsNow.contactedVia], ['new', null, null]);
  await waitFor(async () => !Object.values(await memory()).some((e) => e[2] === paws.id), 5000, 'its memory is gone');
  // Ad Library hunts skip a new page whose website you contacted (Shine Auto Spa went to Google Contacts).
  await sw.evaluate(() => store.remove('lead:9000'));
  const adIn = await sw.evaluate(() => ingest([{ id: '99001', pageId: '99000', pageName: 'Shine Auto Spa Two', active: true, links: ['https://shineautospa.example/offer'] }], { keyword: 'car wash' }));
  assert.equal(adIn.added, 0);
  assert.ok(!(await lead('99000')), 'not saved');
  // Leads contacted before the memory existed are added once, when the extension updates.
  await sw.evaluate(() => store.set({ contactHistory: {}, memoryVersion: 0 }));
  await sw.evaluate(() => seedMemory());
  assert.ok(Object.values(await memory()).some((e) => e[2] === by('Wash Wizards').id), 'contacted leads are seeded');
  assert.ok((await storage('prospectNames')).prospectNames['al quoz industrial area 3, dubai'].some(([n]) => n === 'gloss garage'));
  await dash.selectOption('[data-af="niche"]', '');

  /* ------------------------------------- Instagram: Add to Lead Hunter on a profile */
  const ig = await ctx.newPage();
  await ig.goto('https://www.instagram.com/glossy.tint_bar/');
  const igBtn = ig.locator('button'); // the only button on the page: ours
  await ig.locator('button', { hasText: 'Add to Lead Hunter' }).waitFor();
  await igBtn.click();
  await ig.locator('button', { hasText: 'Added to Lead Hunter' }).waitFor();
  const igLead = await lead('p:i:glossy.tint_bar');
  assert.deepEqual([igLead.kind, igLead.pageName, igLead.niche, igLead.socials.instagram], ['prospect', 'Glossy Tint Bar', 'Car detailing studios', 'https://www.instagram.com/glossy.tint_bar/']);
  assert.equal(igLead.website, 'https://glossytint.example/', 'the website from the bio link');
  const igPhones = igLead.phones.map((x) => [x.number, x.source]);
  assert.ok(igPhones.some(([n, src]) => n === '+971551112233' && src === 'whatsapp-ig'), 'WhatsApp from the bio link');
  assert.ok(igPhones.some(([n]) => n === '+971507654321'), 'the phone in the bio');
  assert.deepEqual(igLead.emails, ['book@glossytint.example']);
  assert.equal(igLead.sources.instagram.followers, '2,345');
  assert.notEqual(igLead.adCheck.state, 'skipped', 'it has a website, so its ads are checked');
  await igBtn.click();
  await ig.locator('button', { hasText: 'Already in Lead Hunter' }).waitFor();
  // Moving to another profile inside Instagram: the button reads that profile, not the stale page details.
  await ig.evaluate(() => {
    history.pushState({}, '', '/luxe.lash.dxb/');
    document.querySelector('header').innerHTML = '<h2>luxe.lash.dxb</h2>';
  });
  await ig.locator('button', { hasText: 'Add to Lead Hunter' }).waitFor(); // reset for the new profile
  await igBtn.click();
  await ig.locator('button', { hasText: 'Added to Lead Hunter' }).waitFor();
  const lash = await lead('p:i:luxe.lash.dxb');
  assert.deepEqual([lash.pageName, lash.niche, lash.website, lash.adCheck.state], ['Luxe Lash Studio', '', null, 'skipped'], 'no preset covers lash studios');
  assert.ok(lash.phones.some((x) => x.number === '+971524445566'));
  // Not a profile: no button.
  await ig.evaluate(() => history.pushState({}, '', '/explore/'));
  await igBtn.waitFor({ state: 'detached' });
  if (SHOTS) await ig.screenshot({ path: `${SHOTS}/16-instagram.png` });
  await ig.close();

  // Popup renders stats.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 460 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => /[1-9]\d*\s*leads/.test(document.querySelector('[data-stats]').textContent));
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/5-popup.png` });

  console.log('E2E PASSED:', leads.length, 'leads');
  await ctx.close();
  mux.close();
  process.exit(0);
} catch (e) {
  await fail(e);
}
