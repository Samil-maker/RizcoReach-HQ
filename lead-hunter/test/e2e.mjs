// End-to-end test: real Chromium + the unpacked extension against a mock world (test/world.mjs): Google Maps with
// Google's "Recently opened" label, Google and Bing results, the businesses' websites, the Instagram API, a
// Facebook page, Instagram profiles and the Meta Ad Library. No real traffic leaves the machine.
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
import { worldHandler, world, calls, IG } from './world.mjs';
import { metaHandler } from './meta-fixtures.mjs';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? process.argv[shotsArg + 1] : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-e2e-'));

/** Rows of a CSV export (quoted fields, commas and new lines inside quotes, leading byte order mark). */
function parseCsv(text) {
  const rows = [[]];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
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

function handler(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
  if (worldHandler(req, res, url, host)) return;
  if (metaHandler(req, res, url, host)) return;
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('not found');
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
const HOSTS = ['www.facebook.com', '*.example', 'wa.me', 'www.google.com', 'www.instagram.com', 'graph.facebook.com', 'www.reddit.com', 'www.linkedin.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'dns.google', 'cloudflare-dns.com', 'api.quickemailverification.com', 'www.bing.com'];

/* ----------------------------------------------------------------- browser */
const ctx = await pw.chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`, '--ignore-certificate-errors', '--no-proxy-server'],
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
  ctx.on('page', (pg) => {
    pg.on('console', (m) => m.type() === 'error' && console.log('[page console]', pg.url().slice(0, 80), m.text().slice(0, 300)));
    pg.on('pageerror', (e) => console.log('[page error]', pg.url().slice(0, 80), String(e).slice(0, 300)));
  });
  const lead = async (id) => (await storage('lead:' + id))['lead:' + id];
  const leads = () => sw.evaluate(() => allLeads());
  const byName = async (name) => (await leads()).find((l) => l.pageName === name);
  /** What Lead Hunter says about a lead, worked out in the extension itself. */
  const verdict = (name) =>
    sw.evaluate(async (n) => {
      const l = (await allLeads()).find((x) => x.pageName === n);
      const s = await getSettings();
      const f = LH.fit(l, s);
      return { fit: f.fit, kind: f.kind, why: f.why, site: f.site, open: f.open && f.open.kind, mail: LH.sendableEmail(l, s), emails: LH.emailInfo(l).map((x) => [x.email, x.state, x.why]) };
    }, name);
  /** Nothing left to check: websites, Instagram, Facebook pages, email domains and mailboxes. */
  const settled = (label, ms = 120000) =>
    waitFor(
      async () => {
        const q = await storage(['enrichQueue', 'igQueue', 'fbEmailQueue', 'emailCheckQueue', 'mailboxQueue']);
        const busy = (await leads()).some((l) => ['queued', 'running'].includes((l.site || {}).state) || (l.fbEmail || {}).state === 'queued');
        return !busy && ['enrichQueue', 'igQueue', 'fbEmailQueue', 'emailCheckQueue', 'mailboxQueue'].every((k) => !(q[k] || []).length);
      },
      ms,
      label,
    );

  // First run opens the dashboard with the welcome panel.
  const dash = await waitFor(async () => ctx.pages().find((p) => p.url().startsWith(dashUrl)), 10000, 'welcome tab');
  await dash.waitForSelector('[data-welcome]:not([hidden])');
  assert.deepEqual(await dash.$$eval('.tabs [data-view]', (b) => b.map((x) => `${x.dataset.view}${x.dataset.sec ? `:${x.dataset.sec}` : ''}`)), ['leads:email', 'leads:contact', 'settings'], 'Email leads, WhatsApp leads, Settings');
  assert.equal(await dash.$$eval('[data-view="intent"], [data-view="find"], [name="verifyKey"], [data-act="bulk-emails"], [name="subreddits"]', (n) => n.length), 0, 'Intent Radar and the email check are gone');

  /* ---------------------------------------------------------------- Settings */
  await dash.click('[data-view="settings"]');
  // Gone: the Meta ads client finder, heat score, quality signals and PageSpeed.
  assert.equal(await dash.$$eval('[name="heatHot"], [data-heat-weights], [data-weak-checks], [name="pagespeedKey"], [name="adCheckAll"], [name="followerMin"], [data-view="ads"], [data-view="hunt"]', (n) => n.length), 0, 'removed features stay removed');
  const builtIn = await dash.$$eval('[data-niche-row]', (r) => r.length);
  assert.ok(builtIn >= 40, `built in kinds of business (${builtIn})`);
  await dash.fill('[name="scrollDelayMs"]', '900');
  await dash.fill('[name="igToken"]', IG.token);
  await dash.fill('[data-areas]', 'JLT, Dubai\nAl Quoz, Dubai');
  // Remove one built in kind: it stays away, and nothing else is stored.
  await dash.$$eval('[data-niche-row]', (rows) => rows.find((r) => r.querySelector('[data-niche-name]').value === 'Used Cars').querySelector('[data-act="del-niche"]').click());
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/4-settings.png` });
  await dash.click('[data-settings-form] button[type="submit"]');
  await waitFor(async () => (await storage('settings')).settings.scrollDelayMs === 900, 5000, 'settings saved');
  const saved = (await storage('settings')).settings;
  assert.deepEqual([saved.areas, saved.niches, saved.hiddenPresets], ['JLT, Dubai\nAl Quoz, Dubai', null, ['Used Cars']]);
  assert.ok(!(await dash.$$eval('[data-niche-name]', (n) => n.map((x) => x.value))).some((n) => /\bspas?\b|massage|grocery/i.test(n)), 'no spas, massage or grocery');
  // Instagram: the token alone. Connect finds the business account linked to your Facebook page.
  await dash.click('[data-act="ig-test"]');
  await dash.waitForFunction(() => /^Connected|^Not working/.test(document.querySelector('[data-ig-test]').textContent), null, { timeout: 15000 });
  assert.match(await dash.textContent('[data-ig-test]'), /^Connected: @rizcoreach, 1200 followers/);
  assert.equal((await storage('settings')).settings.igAccountId, IG.account);
  assert.equal(await dash.inputValue('[name="igAccountId"]'), IG.account, 'shown in Settings');
  for (const k of ['heatWeights', 'weakChecks', 'pagespeedKey', 'adCheckAll', 'auditLinkBase']) assert.ok(!(k in saved), `${k} is gone`);

  await sw.evaluate(() => chrome.storage.local.set({ googlePace: [200, 400] })); // Google searches without the human pause
  /* ------------------------------------------------------- Find: Google Maps */
  await dash.click('[data-view="leads"][data-sec="email"]');
  assert.ok(await dash.isVisible('[data-finder] [data-only="email"] [value="mail"]') && (await dash.isHidden('[data-finder] [data-only="contact"] [value="igwa"]')), 'the email Find');
  await dash.uncheck('[data-finder] [data-only="email"] [value="adlib"]'); // the Ad Library has its own test below
  const chips = await dash.$$eval('[data-find-preset]', (c) => c.map((x) => x.textContent));
  assert.equal(chips[0], 'All types');
  assert.ok(chips.includes('Salons') && !chips.includes('Used Cars'), 'the one you removed is gone');
  assert.ok(await dash.isHidden('[data-keywords-field]'), 'All types has no search terms of its own');
  await dash.click('[data-find-preset="Salons"]');
  assert.match(await dash.inputValue('[data-finder-form] [name="keywords"]'), /^ladies salon\n/);
  assert.match(await dash.textContent('[data-find-areas]'), /^2 areas \(Settings > Areas\), from JLT, Dubai/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/3-find.png`, fullPage: true });
  await dash.fill('[data-finder-form] [name="keywords"]', 'ladies salon');
  await dash.fill('[data-finder-form] [name="cap"]', '20');
  await dash.click('[data-finder-form] button[type="submit"]');
  await waitFor(async () => ((await storage('finder')).finder || {}).status === 'done', 90000, 'Google Maps run').catch(async (e) => {
    for (const pg of ctx.pages()) console.log('page', pg.url(), await pg.evaluate(() => [document.readyState, !!document.querySelector('[role=feed]'), document.visibilityState]).catch((x) => String(x)));
    console.log('finder:', JSON.stringify((await storage('finder')).finder), 'maps calls:', calls.maps, 'problems:', JSON.stringify((await storage('problems')).problems), 'err:', await dash.textContent('[data-finder-err]'));
    throw e;
  });
  assert.deepEqual(calls.maps, ['ladies salon JLT, Dubai', 'ladies salon Al Quoz, Dubai']);
  const run1 = (await storage('finder')).finder;
  console.log('Maps run:', JSON.stringify(run1.stats), 'bing:', JSON.stringify(calls.bing));
  assert.equal(run1.mode, 'email');
  assert.deepEqual(run1.sources, ['maps', 'web', 'mail', 'bing', 'ig']);
  assert.deepEqual([run1.stats.found, run1.stats.kept, run1.stats.duplicate, run1.stats.opened], [17, 14, 3, 4], '10 on Maps, 5 on Google, 2 on Bing; Bloom, Velvet and Glow twice; four say they just opened or open soon');
  for (const q of ['ladies salon JLT, Dubai', '"ladies salon" JLT Dubai ("@gmail.com" OR "@hotmail.com" OR "@yahoo.com" OR "@outlook.com")']) assert.ok(calls.bing.includes(q), `Bing: ${q}`);
  assert.ok(calls.google.includes('site:facebook.com "ladies salon" "Dubai" ("@gmail.com" OR "@hotmail.com" OR "@yahoo.com" OR "@outlook.com")'), 'Facebook pages that show an email');
  for (const q of ['ladies salon JLT, Dubai', 'ladies salon Al Quoz, Dubai', 'site:instagram.com "ladies salon" "Dubai" ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "@yahoo.com" OR "email")', 'site:instagram.com "ladies salon" "Dubai" ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "@yahoo.com" OR "email") #10']) assert.ok(calls.google.includes(q), q);
  // A kind with its own filters: too many reviews is dropped, a new listing with two is kept.
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Car', keywords: ['ppf'], areas: ['JLT, Dubai'], cap: 5, sources: ['maps', 'web', 'ig'] } }));
  await waitFor(async () => {
    const f = (await storage('finder')).finder;
    return f.niche === 'Car' && f.status === 'done';
  }, 60000, 'ppf run');
  const run2 = (await storage('finder')).finder;
  assert.deepEqual([run2.stats.found, run2.stats.kept, run2.stats.manyReviews, run2.stats.opened], [2, 1, 1, 1]);
  await settled('every check after the Maps runs');

  /* -------------------------------------- what Lead Hunter made of each business */
  console.log('google calls:', JSON.stringify(calls.google));
  console.log('all leads:', JSON.stringify(await sw.evaluate(async () => { const s = await getSettings(); return (await allLeads()).map((l) => { const f = LH.fit(l, s); return [l.pageName, f.fit, f.kind, f.site, (l.site || {}).score, LH.sendableEmail(l, s).email || LH.sendableEmail(l, s).why, LH.igHandle(l), (l.phones[0] || {}).number]; }); })));
  const v = {};
  for (const n of ['Bloom Beauty Lounge', 'Velvet Hair Studio', 'Glam Corner Salon', 'Old Town Salon', 'Rose Petal Spa', 'Night Owl Salon', 'Henna House', 'Gloss Garage', 'Soon Cafe', 'Shield PPF Center', 'Glow Salon', 'Nails by Rana']) v[n] = await verdict(n);
  const LH_ig = (l) => ((l.sources || {}).instagram || {}).username || ((l.socials || {}).instagram || '').split('/')[3] || '';
  console.log('verdicts:', JSON.stringify(v, null, 1));
  // Google's label on the card, Instagram's own posts, and a brand new account.
  const bloom = await byName('Bloom Beauty Lounge');
  assert.deepEqual([...new Set(bloom.openSignals.map((s) => s.kind))].sort(), ['caption', 'google', 'newig']);
  assert.match(bloom.openSignals.find((s) => s.kind === 'caption').text, /GRAND OPENING this Friday in JLT/);
  assert.deepEqual([v['Bloom Beauty Lounge'].fit, v['Bloom Beauty Lounge'].kind, v['Bloom Beauty Lounge'].mail], [true, 'new', { email: 'bloom.beauty.dxb@gmail.com', state: 'unchecked' }]);
  assert.deepEqual(bloom.emailFrom, { 'bloom.beauty.dxb@gmail.com': 'instagram' });
  // "Opened 3 weeks ago", and a "coming soon" page: fits, with the address on that page.
  const velvet = await byName('Velvet Hair Studio');
  const opened = velvet.openSignals.find((s) => s.kind === 'google');
  assert.equal(opened.text, 'Opened 3 weeks ago');
  assert.ok(Math.abs(opened.openedAt - (Date.now() - 21 * 864e5)) < 864e5);
  assert.deepEqual([v['Velvet Hair Studio'].fit, v['Velvet Hair Studio'].site, v['Velvet Hair Studio'].mail.email], [true, 'parked', 'hello@velvethair.example']);
  // A good website does not fit. No website fits, new or not; opening HOURS are not an opening.
  assert.deepEqual([v['Glam Corner Salon'].fit, v['Glam Corner Salon'].why, v['Glam Corner Salon'].site], [false, 'They have a good website', 'good']);
  assert.deepEqual([v['Old Town Salon'].fit, v['Old Town Salon'].why], [true, 'No website']);
  assert.deepEqual([v['Night Owl Salon'].fit, v['Night Owl Salon'].kind, (await byName('Night Owl Salon')).openSignals], [true, 'none', undefined], '"Opens soon ⋅ 10 AM" is opening hours, not an opening');
  // Old Town's Instagram, found on Google by its name, with the email in its bio. Night Owl has none to find.
  const oldTown = await byName('Old Town Salon');
  assert.deepEqual([LH_ig(oldTown), oldTown.igFind.state, v['Old Town Salon'].mail], ['oldtownsalon.dxb', 'found', { email: 'oldtownsalon@gmail.com', state: 'unchecked' }]);
  assert.equal((await byName('Night Owl Salon')).igFind.state, 'none');
  assert.ok(!calls.google.includes('site:instagram.com "Glam Corner Salon" Dubai'), 'no Instagram search for a business that does not fit');
  // Google: a weak website with an email, and an Instagram profile whose bio shows one.
  assert.deepEqual([v['Glow Salon'].fit, v['Glow Salon'].kind, v['Glow Salon'].mail.email], [true, 'weak', 'info@glowsalon.example']);
  assert.match(v['Glow Salon'].why, /^Weak website/);
  const rana = await byName('Nails by Rana');
  assert.deepEqual([LH_ig(rana), rana.phones[0].number, v['Nails by Rana'].mail.email], ['nailsbyrana', '+971523339911', 'ranas.nails@gmail.com']);
  assert.ok(!(await byName('Ladies Salons in JLT')) && !(await byName('The 10 best salons in Dubai')), 'no directories or lists');
  // A website that is down fits without proof; there is no email to send to.
  assert.deepEqual([v['Rose Petal Spa'].fit, v['Rose Petal Spa'].kind, v['Rose Petal Spa'].mail.why], [true, 'down', 'none']);
  // Henna House: its Facebook page Intro gave an email (not the CV address in a post).
  const henna = await byName('Henna House');
  assert.deepEqual([henna.fbEmail.state, henna.emails, v['Henna House'].mail.email], ['found', ['hennahouse.dxb@gmail.com'], 'hennahouse.dxb@gmail.com']);
  // Gloss Garage: a parked page full of broken addresses. The parked domain's own addresses go last.
  assert.deepEqual([v['Gloss Garage'].fit, v['Gloss Garage'].kind, v['Gloss Garage'].mail.email], [true, 'parked', 'gloss.garage.dxb@gmail.com']);
  const gstates = Object.fromEntries(v['Gloss Garage'].emails.map(([e, s]) => [e, s]));
  assert.ok('sales@glossgarage.com' in gstates, '.con fixed to .com');
  assert.ok(!Object.keys(gstates).some((e) => /yourdomain|%|^\d/.test(e)), 'no placeholder, no %20, no phone number glued on');
  // The label that only arrives in Maps' own data: "Opening soon".
  assert.deepEqual([v['Soon Cafe'].fit, v['Soon Cafe'].open], [true, 'soon']);
  assert.deepEqual([v['Shield PPF Center'].fit, v['Shield PPF Center'].kind], [true, 'new']);
  // Found by their email alone: a Facebook page, a directory listing, and a Facebook page on Bing. No website of their own.
  for (const [n, e, ph] of [['Pearl Ladies Salon', 'pearl.salon.jlt@gmail.com', '+971584441209'], ['Lotus Beauty Centre', 'lotusbeauty@hotmail.com', undefined], ['Coral Nails & Beauty', 'coralnails@yahoo.com', '+971567771203']]) {
    const x = await verdict(n);
    assert.deepEqual([x.fit, x.site, x.mail.email, ((await byName(n)).phones[0] || {}).number], [true, 'none', e, ph], n);
  }
  assert.equal((await byName('Pearl Ladies Salon')).socials.facebook, 'https://www.facebook.com/pearlladiessalon/', 'their Facebook page');
  assert.ok(!(await leads()).some((l) => (l.emails || []).some((e) => /yellowpages|^[abc]\.salon@/.test(e))), "never the directory's own address, never a list of businesses");
  assert.equal(calls.verify.length + calls.dns.length, 0, 'no email checks any more');

  /* ---------------------------------------------------------------- Leads tab */
  await dash.click('[data-view="leads"][data-sec="email"]');
  await dash.waitForSelector('[data-rows] tr');
  const rowNames = () => dash.$$eval('[data-rows] tr .biz .n', (n) => n.map((x) => x.textContent));
  // Email leads: the ones that fit and have an email. One without an email never shows here.
  const EMAIL_LEADS = ['Bloom Beauty Lounge', 'Velvet Hair Studio', 'Old Town Salon', 'Henna House', 'Gloss Garage', 'Glow Salon', 'Nails by Rana', 'Pearl Ladies Salon', 'Lotus Beauty Centre', 'Coral Nails & Beauty'];
  const ready = await rowNames();
  assert.deepEqual(new Set(ready), new Set(EMAIL_LEADS), 'email leads');
  assert.ok(ready.indexOf('Bloom Beauty Lounge') < ready.indexOf('Glow Salon'), 'new first, weak websites after');
  assert.match(await dash.textContent('[data-kpis]'), /10 to email[\s\S]*0 to WhatsApp/, 'an email Find never fills the WhatsApp tab');
  assert.equal(await dash.textContent('[data-sec-count="email"]'), '10');
  await dash.selectOption('[data-f="show"]', 'none');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 7);
  assert.deepEqual(new Set(await rowNames()), new Set(['Bloom Beauty Lounge', 'Nails by Rana', 'Old Town Salon', 'Henna House', 'Pearl Ladies Salon', 'Lotus Beauty Centre', 'Coral Nails & Beauty']), 'no website, with an email: never Night Owl, which has none');
  await dash.selectOption('[data-f="show"]', 'nofit');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 1);
  assert.deepEqual(await rowNames(), ['Glam Corner Salon']);
  await dash.selectOption('[data-f="show"]', 'ready');
  assert.ok(await dash.isHidden('[data-act="export-contacts"]') && (await dash.isVisible('[data-act="export-cold"]')), 'email section: the cold email button');
  // The lead panel: why it fits, the proof, and what each email check said.
  await dash.click(`tr[data-id="${bloom.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-fit-sec]');
  assert.match(await dash.textContent('[data-fit-sec]'), /Fits · Just opened, and they have no website/);
  assert.match(await dash.textContent('[data-fit-sec]'), /Google Maps: “Recently opened”[\s\S]*Their Instagram post: “/);
  assert.match(await dash.textContent('[data-email-sec]'), /bloom\.beauty\.dxb@gmail\.com\s*Ready/);
  assert.match(await dash.textContent('[data-cold-note]'), /They go in the next Export for cold email, with bloom\.beauty\.dxb@gmail\.com/);
  if (SHOTS) await dash.waitForTimeout(500), await dash.screenshot({ path: `${SHOTS}/2-drawer.png` });
  await dash.click('.drawer [data-act="close"]');
  const gloss = await byName('Gloss Garage');
  await dash.click(`tr[data-id="${gloss.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-email-sec] .email-row');
  const gtext = await dash.textContent('[data-email-sec]');
  assert.match(gtext, /gloss\.garage\.dxb@gmail\.com\s*Ready/);
  assert.ok(!/Check now/.test(gtext), 'no email check button');
  // An address you type is cleaned like any other.
  await dash.fill('[data-add-email] [name="email"]', 'Owner@GlossGarage.con');
  await dash.press('[data-add-email] [name="email"]', 'Enter');
  await waitFor(async () => ((await lead(gloss.id)).emails || []).includes('owner@glossgarage.com'), 5000, 'typed email added');
  await dash.click('.drawer [data-act="close"]');
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/1-leads.png` });

  /* ------------------------------------------------- Export for cold email */
  // Chrome's Save As dialog is answered by the test: it records what was asked and says when the file is saved.
  await dash.evaluate(() => {
    window.__downloads = [];
    let listener = null;
    chrome.downloads.download = async (opts) => (window.__downloads.push(opts), window.__downloads.length);
    chrome.downloads.onChanged.addListener = (fn) => (listener = fn);
    chrome.downloads.onChanged.removeListener = () => (listener = null);
    window.__saveAs = (id, state) => listener && listener({ id, state: { current: state } });
  });
  const coldFile = async (act, saved = 'complete') => {
    const before = await dash.evaluate(() => window.__downloads.length);
    await dash.click(`[data-act="${act}"]`);
    await dash.waitForFunction((n) => window.__downloads.length > n, before);
    const opts = await dash.evaluate(() => window.__downloads.at(-1));
    const text = await dash.evaluate(async (url) => (await fetch(url)).text(), opts.url);
    await dash.evaluate(([id, st]) => window.__saveAs(id, st), [before + 1, saved]);
    const [head, ...rows] = parseCsv(text);
    return { opts, head, rows, byName: Object.fromEntries(rows.map((r) => [r[0], Object.fromEntries(head.map((h, i) => [h, r[i]]))])) };
  };
  const toastText = () => dash.textContent('[data-toast]');
  // Cancel the dialog: nothing is marked.
  await coldFile('export-cold', 'interrupted');
  await dash.waitForFunction(() => /nothing was marked/.test(document.querySelector('[data-toast]').textContent));
  const f1 = await coldFile('export-cold');
  assert.match(f1.opts.filename, /^rizcoreach-cold-email-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(f1.opts.saveAs, true);
  assert.deepEqual(f1.head, ['business_name', 'first_name', 'email', 'website', 'instagram', 'phone', 'niche', 'area', 'source', 'notes', 'status', 'segment']);
  assert.deepEqual(Object.keys(f1.byName).sort(), [...EMAIL_LEADS].sort());
  assert.deepEqual(f1.byName['Bloom Beauty Lounge'], { business_name: 'Bloom Beauty Lounge', first_name: '', email: 'bloom.beauty.dxb@gmail.com', website: '', instagram: 'bloombeautydxb', phone: '+971501112201', niche: 'Salons', area: 'JLT, Dubai', source: 'Google Maps', notes: 'new business', status: 'New', segment: 'A' });
  assert.deepEqual([f1.byName['Gloss Garage'].email, f1.byName['Gloss Garage'].website, f1.byName['Gloss Garage'].notes], ['gloss.garage.dxb@gmail.com', 'https://glossgarage.example/', '']);
  await dash.waitForFunction(() => /^10 leads saved for cold email/.test(document.querySelector('[data-toast]').textContent));
  assert.deepEqual([f1.byName['Pearl Ladies Salon'].email, f1.byName['Pearl Ladies Salon'].website], ['pearl.salon.jlt@gmail.com', '']);
  assert.deepEqual([f1.byName['Nails by Rana'].source, f1.byName['Nails by Rana'].instagram, f1.byName['Glow Salon'].source, f1.byName['Glow Salon'].website], ['Instagram', 'nailsbyrana', 'Google', 'https://glowsalon.example/']);
  await waitFor(async () => !!(await byName('Bloom Beauty Lounge')).coldEmailExportedAt, 5000, 'marked exported');
  const hist = (await storage('contactHistory')).contactHistory;
  assert.equal(hist['p:+971501112201'][1], 'cold-email', 'remembered, so a later search never brings them back');
  // An address that bounced: never used again, on any lead.
  await dash.click('[data-view="settings"]');
  await dash.fill('[data-bounces]', 'Delivery failed for <gloss.garage.dxb@gmail.com>: mailbox unavailable');
  await dash.click('[data-act="bounces-add"]');
  await dash.waitForFunction(() => /^1 address remembered, found on 1 lead here/.test(document.querySelector('[data-bounces-out]').textContent));
  assert.equal((await verdict('Gloss Garage')).mail.email, 'bookings@glossgarage.example', 'the bounced one is never used: the next address goes');
  await dash.click('[data-view="leads"][data-sec="email"]');
  await dash.check('[data-cold-include]');
  const f3 = await coldFile('export-cold');
  assert.equal(f3.byName['Gloss Garage'].email, 'bookings@glossgarage.example', 'Gloss Garage: its Gmail bounced, so the next address goes');
  assert.equal(Object.keys(f3.byName).length, 10);
  await dash.uncheck('[data-cold-include]');

  /* ------------------------------------------ WhatsApp leads: Google Contacts */
  // The WhatsApp tab's own Find: the same searches again (its own list of finished searches), for numbers.
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', keywords: ['ladies salon'], cap: 20, sources: ['maps'], mode: 'contact' } }));
  await waitFor(async () => {
    const f = (await storage('finder')).finder;
    return f.mode === 'contact' && f.status === 'done';
  }, 90000, 'WhatsApp Find');
  await settled('every check after the WhatsApp Find');
  console.log('contact tab:', JSON.stringify((await leads()).filter((l) => (l.foundFor || []).includes('contact')).map((l) => l.pageName)));
  await dash.click('[data-view="leads"][data-sec="contact"]');
  assert.equal(await dash.$eval('[data-finder]', (d) => d.open), false, 'Find starts closed once there are leads');
  await dash.click('[data-finder] > summary');
  assert.ok(await dash.isVisible('[data-finder] [data-only="contact"] [value="igwa"]') && (await dash.isHidden('[data-finder] [data-only="email"] [value="mail"]')), 'the WhatsApp Find');
  // Only what the WhatsApp Find found: never the email Find's Facebook pages, directories or Instagram profiles.
  const WA_LEADS = ['Bloom Beauty Lounge', 'Velvet Hair Studio', 'Old Town Salon', 'Rose Petal Spa', 'Night Owl Salon', 'Gloss Garage'];
  await dash.waitForFunction((n) => document.querySelectorAll('[data-rows] tr').length === n, WA_LEADS.length, { timeout: 10000 }).catch(() => {});
  assert.deepEqual(new Set(await rowNames()), new Set(WA_LEADS), 'a WhatsApp or phone number, found by the WhatsApp Find');
  assert.match(await dash.textContent(`tr[data-id="${bloom.id}"]`), /@bloombeautydxb/);
  assert.match(await dash.textContent(`tr[data-id="${(await byName('Night Owl Salon')).id}"]`), /No Instagram found/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/6-contact-section.png` });
  const [contactsDl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="export-contacts"]')]);
  assert.match(contactsDl.suggestedFilename(), /^google-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  const [chead, ...crows] = parseCsv(fs.readFileSync(await contactsDl.path(), 'utf8'));
  assert.equal(crows.length, WA_LEADS.length);
  const crow = (name) => Object.fromEntries(chead.map((h, i) => [h, crows.find((r) => r[0] === name)[i]]));
  assert.deepEqual([crow('Bloom Beauty Lounge')['Phone 1 - Value'], crow('Bloom Beauty Lounge')['Website 2 - Label'], crow('Bloom Beauty Lounge')['Website 2 - Value']], ['+971501112201', 'Instagram', 'https://www.instagram.com/bloombeautydxb/']);
  assert.match(crow('Rose Petal Spa')['Notes'], /^Their website is down/);
  await dash.waitForFunction(() => /^6 contacts saved, \d with their Instagram/.test(document.querySelector('[data-toast]').textContent));
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 0);
  assert.ok((await byName('Rose Petal Spa')).contactsExportedAt, 'exported ones leave the list');
  await dash.click('[data-view="leads"][data-sec="email"]');
  await dash.uncheck('[data-cold-include]');

  /* --------------------------------------- Businesses advertising their opening */
  const [adTab] = await Promise.all([ctx.waitForEvent('page'), sw.evaluate(() => handlers['hunt:start']({ config: { name: 'Opening ads', keywords: ['grand opening', 'soft opening'], country: 'AE', target: 5, maxLikes: 60000, maxDays: 120 } }))]);
  await waitFor(async () => ((await storage('hunt')).hunt || {}).status === 'done', 90000, 'Ad Library search');
  await adTab.close();
  await settled('every check after the Ad Library search');
  const fresh = await verdict('Fresh Bites Cafe');
  console.log('Fresh Bites:', JSON.stringify(fresh));
  const freshLead = await byName('Fresh Bites Cafe');
  assert.match(freshLead.openSignals[0].text, /Grand opening this Saturday in Business Bay/);
  assert.deepEqual([freshLead.emailFrom['hello@freshbites.example'], freshLead.websiteSource], ['ad', 'email'], 'the email in their ad, and its domain checked as their website');
  assert.deepEqual([fresh.fit, fresh.kind, fresh.mail.email], [true, 'new', 'hello@freshbites.example']);
  // Find with the Ad Library ticked: it runs by itself, with the opening words, at most every 12 hours.
  const tooSoon = await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', sources: ['adlib'] } }).then(() => 'started', (e) => e.message));
  assert.match(tooSoon, /searched less than 12 hours ago/);
  await sw.evaluate(async () => {
    const { hunt } = await chrome.storage.local.get('hunt');
    await chrome.storage.local.set({ hunt: { ...hunt, startedAt: hunt.startedAt - 13 * 3600e3 } });
  });
  const [autoTab, autoRun] = await Promise.all([ctx.waitForEvent('page'), sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', sources: ['adlib'] } }))]);
  assert.ok(autoRun.finder.adlib, 'the Ad Library opened');
  assert.deepEqual((await storage('hunt')).hunt.keywords, await sw.evaluate(() => LH.OPENING_AD_KEYWORDS.map((k) => k.toLowerCase())));
  await sw.evaluate(() => handlers['hunt:stop']({}));
  await autoTab.close();
  assert.deepEqual([(await verdict('Old Mall Outlet')).kind, (await byName('Old Mall Outlet')).openSignals], ['none', undefined], 'the same words on an ad that ran for most of a year: no proof it is new');
  assert.deepEqual(await verdict('MegaMart Official').then((x) => [x.fit, x.why]), [false, 'An established brand, not a new business']);
  // A login wall in the Ad Library stops the search and says so. Nothing tries to get past it.
  world.adWall = true;
  const [wallTab] = await Promise.all([ctx.waitForEvent('page'), sw.evaluate(() => handlers['hunt:start']({ config: { name: 'Opening ads', keywords: ['grand opening'], country: 'AE', target: 5 } }))]);
  await waitFor(async () => ((await storage('alerts')).alerts || {}).adlib, 30000, 'Ad Library alert');
  assert.deepEqual([(await storage('hunt')).hunt.status, (await storage('hunt')).hunt.finishReason, (await storage('alerts')).alerts.adlib.text], ['stopped', 'blocked', 'Facebook asked you to log in']);
  await wallTab.close();
  world.adWall = false;
  await dash.bringToFront();
  await dash.waitForSelector('[data-strip] [data-alert="adlib"]');
  await dash.click('[data-strip] [data-act="alert-clear"][data-source="adlib"]');
  await waitFor(async () => !((await storage('alerts')).alerts || {}).adlib, 5000, 'alert dismissed');

  /* ------------------------------------- Google Maps shows a consent page: pause */
  world.mapsWall = true;
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', keywords: ['nail salon'], areas: ['JLT, Dubai'], cap: 5, sources: ['maps'] } }));
  await waitFor(async () => ((await storage('alerts')).alerts || {}).maps, 60000, 'Maps alert');
  assert.equal((await storage('finder')).finder.status, 'paused');
  await dash.waitForSelector('[data-strip] [data-alert="maps"]');
  assert.match(await dash.textContent('[data-strip] [data-alert="maps"]'), /Google Maps paused: Google Maps showed a consent or verification page/);
  world.mapsWall = false;
  await dash.click('[data-strip] [data-act="finder-resume"]');
  await waitFor(async () => (await storage('finder')).finder.status === 'done', 60000, 'resumed run');
  assert.deepEqual(calls.maps.slice(-2), ['nail salon JLT, Dubai', 'nail salon JLT, Dubai'], 'the same search again, nothing skipped');
  assert.ok(!((await storage('alerts')).alerts || {}).maps);

  /* ------------------------------- Bing asks to prove you are human: Bing pauses, the rest carry on */
  world.bingWall = true;
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', keywords: ['nail studio'], areas: ['JLT, Dubai'], cap: 5, sources: ['maps', 'bing'] } }));
  await waitFor(async () => ((await storage('alerts')).alerts || {}).bing, 60000, 'Bing alert');
  await waitFor(async () => (await storage('finder')).finder.status === 'done', 60000, 'the run carried on without Bing');
  assert.ok(calls.maps.includes('nail studio JLT, Dubai'), 'Google Maps still searched');
  assert.equal((await storage('alerts')).alerts.bing.text, 'Bing says it sees unusual traffic');
  world.bingWall = false;
  await dash.waitForSelector('[data-strip] [data-alert="bing"]');
  await dash.click('[data-strip] [data-act="bing-resume"]');
  await waitFor(async () => !((await storage('alerts')).alerts || {}).bing, 5000, 'Bing resumed');

  /* ------------------------------------------- Instagram: + Add to Lead Hunter */
  const ig = await ctx.newPage();
  await ig.goto('https://www.instagram.com/newcafe.dxb/');
  await ig.locator('button', { hasText: '+ Add to Lead Hunter' }).click();
  await ig.locator('button', { hasText: 'Added to Lead Hunter' }).waitFor();
  await ig.close();
  await settled('the Instagram business checked');
  const cafe = await lead('p:i:newcafe.dxb');
  assert.deepEqual([...new Set(cafe.openSignals.map((s) => s.kind))].sort(), ['bio', 'caption', 'newig']);
  // Their email's domain is a real, working website nobody had listed: so they are not a lead for a website.
  assert.deepEqual([cafe.website, cafe.websiteSource, (await verdict('New Cafe DXB')).why], ['https://newcafedxb.example/', 'email', 'They have a good website']);
  assert.ok(calls.ig.some((f) => /business_discovery\.username\(newcafe\.dxb\)\{.*biography.*media\.limit\(12\)\{caption,timestamp,permalink\}/.test(f)), 'the official API, with posts');

  /* ---------------------------------------------------------- the popup */
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 360 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => /ready to export/.test(document.querySelector('[data-stats]').textContent));
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/5-popup.png` });
  await popup.close();
  await dash.bringToFront();

  console.log('E2E PASSED:', (await leads()).length, 'leads');
  await ctx.close();
  mux.close();
  process.exit(0);
} catch (e) {
  await fail(e);
}
