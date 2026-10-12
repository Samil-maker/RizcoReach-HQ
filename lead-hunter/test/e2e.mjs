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
import { handle as queueHandle } from '../../netlify/functions/lead-queue.mts';

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
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? process.argv[shotsArg + 1] : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-e2e-'));

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

function handler(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
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
    if (url.pathname === '/api/lead-queue') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const r = await queueHandle(new Request(url, { method: req.method, headers: req.headers, body: body.length ? body : undefined }), queueStore, QUEUE_KEY);
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
    `--host-resolver-rules=MAP www.facebook.com 127.0.0.1:${PORT}, MAP *.example 127.0.0.1:${PORT}, MAP wa.me 127.0.0.1:${PORT}, MAP www.rizcoreach.ae 127.0.0.1:${PORT}`,
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

  // Settings: name + faster scrolling for the test.
  await dash.click('[data-view="settings"]');
  await dash.fill('[name="myName"]', 'Samil');
  await dash.fill('[name="scrollDelayMs"]', '900');
  await dash.click('[data-settings-form] button[type="submit"]');
  await waitFor(async () => (await storage('settings')).settings.myName === 'Samil', 5000, 'settings saved');

  // Start a hunt from the dashboard.
  await dash.click('[data-view="hunt"]');
  await dash.fill('[name="keywords"]', 'car detailing\nceramic coating');
  await dash.selectOption('[data-hunt-form] [name="country"]', 'AE');
  await dash.fill('[name="target"]', '50');
  await dash.fill('[name="maxLikes"]', '60000');
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

  await waitFor(async () => {
    const s = await storage('enrichQueue');
    return !(s.enrichQueue || []).length;
  }, 120000, 'enrichment to finish');

  const all = await storage(null);
  const leads = Object.entries(all).filter(([k]) => k.startsWith('lead:')).map(([, v]) => v);
  const by = (name) => leads.find((l) => l.pageName === name);
  assert.equal(leads.length, 25, 'one lead per advertiser across overlapping keywords');
  assert.deepEqual(by('Fortress Car Care').keywords.sort(), ['car detailing', 'ceramic coating']);

  const good = by('Shine Auto Spa');
  assert.equal(good.website, 'https://shineautospa.example/');
  assert.equal(good.landingUrl, 'https://shineautospa.example/offer');
  assert.equal(good.site.state, 'ok');
  assert.ok(good.site.score >= 85, 'good site score ' + good.site.score);
  assert.ok(good.phones.some((p) => p.source === 'whatsapp-site'));
  assert.ok(good.emails.includes('hello@shineautospa.example'));
  assert.ok(good.socials.instagram);

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

  // Dashboard renders the leads, big brand hidden by default.
  await dash.click('[data-view="leads"]');
  await dash.click('[data-act="clear-hunt-filter"]').catch(() => {});
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 23);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/3-leads.png` });

  // Open a lead, check the pitch, send on WhatsApp.
  await dash.click(`tr[data-id="${bad.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open');
  const pitch = await dash.inputValue('[data-pitch-body]');
  assert.match(pitch, /^Hi Gloss Garage Dubai team/);
  assert.match(pitch, /Samil, RizcoReach$/);
  assert.doesNotMatch(pitch, /\{\{|undefined/);
  if (SHOTS) {
    await dash.waitForTimeout(500); // let the drawer finish sliding in
    await dash.screenshot({ path: `${SHOTS}/4-drawer.png` });
  }
  const [waTab] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-act="send-wa"]')]);
  await waTab.waitForLoadState();
  assert.match(waTab.url(), /^https:\/\/wa\.me\/971507654321\?text=Hi%20Gloss/);
  await waTab.close();
  await waitFor(async () => (await storage('lead:' + bad.id))['lead:' + bad.id].status === 'contacted', 5000, 'status contacted');

  // Email angle for the parked page uses the broken-site template.
  await dash.click('[data-act="close"]');
  await dash.click(`tr[data-id="${by('Parked Polish').id}"] [data-open]`);
  await dash.click('[data-channel="email"]');
  assert.match(await dash.inputValue('[data-pitch-subject]'), /parkedpolish\.example is not loading properly/);
  await dash.click('[data-act="close"]');

  // Filters + CSV export.
  await dash.selectOption('[data-f="site"]', 'none');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 3);
  await dash.selectOption('[data-f="site"]', '');
  const [dl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="export-csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(csv.split('\n')[0], /priority,heat,business/);
  assert.equal(csv.trim().split('\n').length, 24, 'header + the 23 visible leads');
  assert.match(csv, /Gloss Garage Dubai/);

  /* ---------------------------------------------------- send from phone */
  const qrText = (sel) => dash.$eval(sel, (c) => c.dataset.qrText);
  const desert = by('Desert Detailers'); // WhatsApp-ad lead, still "new"
  await dash.click(`tr[data-id="${desert.id}"] [data-open]`);
  await dash.waitForSelector('[data-pitch-qr]');
  const body1 = await dash.inputValue('[data-pitch-body]');
  assert.equal(await qrText('[data-pitch-qr]'), `https://wa.me/971501000001?text=${encodeURIComponent(body1)}`);
  await dash.fill('[data-pitch-body]', 'Edited message');
  await dash.waitForFunction(() => document.querySelector('[data-pitch-qr]').dataset.qrText.endsWith('?text=Edited%20message'));
  if (SHOTS) {
    await dash.waitForTimeout(400);
    await dash.screenshot({ path: `${SHOTS}/6-drawer-qr.png` });
  }
  await dash.click('[data-act="mark-contacted"]');
  await waitFor(async () => (await storage('lead:' + desert.id))['lead:' + desert.id].status === 'contacted', 5000, 'marked contacted from QR panel');
  await dash.click('[data-act="close"]');

  // Phone mode: one QR per lead, Enter = sent & next.
  await dash.click('[data-act="phone-mode"]');
  await dash.waitForSelector('[data-pm-qr]');
  const pmFirst = await dash.$eval('.pm-info h2', (h) => h.firstChild.textContent.trim());
  assert.match(await qrText('[data-pm-qr]'), /^https:\/\/wa\.me\/\d+\?text=Hi%20/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/7-phone-mode.png` });
  await dash.keyboard.press('Enter');
  await dash.waitForFunction((n) => document.querySelector('.pm-info h2').firstChild.textContent.trim() !== n, pmFirst);
  const firstLead = leads.find((l) => l.pageName === pmFirst);
  await waitFor(async () => (await storage('lead:' + firstLead.id))['lead:' + firstLead.id].status === 'contacted', 5000, 'phone mode marks contacted');
  await dash.keyboard.press('ArrowRight'); // skip
  await dash.keyboard.press('Escape');
  assert.ok(await dash.$eval('[data-pm]', (el) => el.hidden));

  // Phone queue: pair, push three leads, tap one on the phone, sync back.
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

  await dash.click('[data-view="leads"]');
  await dash.selectOption('[data-f="status"]', 'new');
  await dash.selectOption('[data-f="contact"]', 'phone');
  const ids = await dash.$$eval('[data-rows] tr', (trs) => trs.slice(0, 3).map((t) => t.dataset.id));
  assert.equal(ids.length, 3);
  for (const id of ids) await dash.click(`tr[data-id="${id}"] [data-sel]`);
  await dash.click('[data-act="bulk-queue"]');
  await waitFor(async () => (queueStore.peek() || { items: [] }).items.length === 3, 10000, 'queue to receive 3 leads');
  await dash.waitForFunction(() => document.querySelectorAll('.tag.phone').length === 3);

  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(pairUrl);
  await phone.waitForFunction(() => document.querySelectorAll('[data-list] .card').length === 3);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/9-phone-queue.png` });
  const firstCard = await phone.$eval('[data-list] .card', (c) => c.dataset.id);
  const href = await phone.$eval('[data-list] .card [data-act="wa"]', (a) => a.href);
  assert.match(href, /^https:\/\/wa\.me\/\d+\?text=Hi%20/);
  const [waTab2] = await Promise.all([ctx.waitForEvent('page'), phone.click('[data-list] .card [data-act="wa"]')]);
  await waTab2.close();
  await waitFor(async () => queueStore.peek().items.find((i) => i.id === firstCard).status === 'sent', 10000, 'phone tap to reach the server');
  await phone.waitForFunction(() => /2 to send · 1 sent/.test(document.querySelector('[data-sub]').textContent));

  // The extension picks up "sent" and marks the lead as contacted.
  await sw.evaluate(() => syncQueue());
  const synced = (await storage('lead:' + firstCard))['lead:' + firstCard];
  assert.equal(synced.status, 'contacted');
  assert.equal(synced.phoneQueue.state, 'sent');
  // A status set by hand afterwards survives later syncs.
  await dash.selectOption('[data-f="status"]', 'all');
  await dash.waitForSelector(`tr[data-id="${firstCard}"]`);
  await dash.selectOption(`tr[data-id="${firstCard}"] [data-status]`, 'followup');
  await waitFor(async () => (await storage('lead:' + firstCard))['lead:' + firstCard].status === 'followup', 5000, 'manual follow-up');
  await sw.evaluate(() => syncQueue());
  assert.equal((await storage('lead:' + firstCard))['lead:' + firstCard].status, 'followup', 'sync must not override a manual status');

  // Marking a queued lead as contacted on the computer ticks it off on the phone too.
  const second = ids.find((id) => id !== firstCard);
  await dash.selectOption(`tr[data-id="${second}"] [data-status]`, 'contacted');
  await waitFor(async () => queueStore.peek().items.find((i) => i.id === second).status === 'sent', 10000, 'computer status to reach the phone queue');
  await phone.click('[data-refresh]');
  await phone.waitForFunction(() => /1 to send · 2 sent/.test(document.querySelector('[data-sub]').textContent));

  // Popup renders stats.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 460 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => /25/.test(document.querySelector('[data-stats]').textContent));
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/5-popup.png` });

  console.log('E2E PASSED:', leads.length, 'leads');
  await ctx.close();
  mux.close();
  process.exit(0);
} catch (e) {
  await fail(e);
}
