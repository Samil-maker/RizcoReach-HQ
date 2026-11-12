// End-to-end test: real Chromium + the unpacked extension against a mock world (test/world.mjs): Google Maps with
// Google's "Recently opened" label, the businesses' websites, public DNS, the mailbox checker, the Instagram API, a
// Facebook page, Instagram profiles and the Meta Ad Library; Reddit, LinkedIn and the AI check come from
// test/meta-fixtures.mjs. No real traffic leaves the machine.
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
import { worldHandler, world, calls, VERIFY_KEY, IG } from './world.mjs';
import { metaHandler, CLAUDE, GEMINI, redditCalls, redditMode } from './meta-fixtures.mjs';

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
const HOSTS = ['www.facebook.com', '*.example', 'wa.me', 'www.google.com', 'www.instagram.com', 'graph.facebook.com', 'www.reddit.com', 'www.linkedin.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'dns.google', 'cloudflare-dns.com', 'api.quickemailverification.com'];

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
  assert.deepEqual(await dash.$$eval('.tabs [data-view]', (b) => b.map((x) => x.dataset.view)), ['leads', 'find', 'intent', 'settings'], 'four tabs');

  /* ---------------------------------------------------------------- Settings */
  await dash.click('[data-view="settings"]');
  // Gone: the Meta ads client finder, heat score, quality signals, PageSpeed and the Google Contacts export.
  assert.equal(await dash.$$eval('[name="heatHot"], [data-heat-weights], [data-weak-checks], [name="pagespeedKey"], [name="adCheckAll"], [name="followerMin"], [data-act="export-contacts"], [data-act="export-vcard"], [data-view="ads"], [data-view="hunt"]', (n) => n.length), 0, 'removed features stay removed');
  const builtIn = await dash.$$eval('[data-niche-row]', (r) => r.length);
  assert.ok(builtIn >= 40, `built in kinds of business (${builtIn})`);
  await dash.fill('[name="scrollDelayMs"]', '900');
  await dash.fill('[name="radarEveryHours"]', '0');
  await dash.fill('[name="igAccountId"]', IG.account);
  await dash.fill('[name="igToken"]', IG.token);
  await dash.fill('[data-areas]', 'JLT, Dubai\nAl Quoz, Dubai');
  // Remove one built in kind: it stays away, and nothing else is stored.
  await dash.$$eval('[data-niche-row]', (rows) => rows.find((r) => r.querySelector('[data-niche-name]').value === 'Used Cars').querySelector('[data-act="del-niche"]').click());
  // The mailbox check: a wrong key is reported, the right one is tested on the free sandbox.
  await dash.fill('[name="verifyKey"]', 'wrong-key');
  await dash.click('[data-act="verify-test"]');
  await dash.waitForFunction(() => /^Not working: The email check did not accept your key \(401\)/.test(document.querySelector('[data-verify-test]').textContent));
  await dash.fill('[name="verifyKey"]', VERIFY_KEY);
  await dash.click('[data-act="verify-test"]');
  await dash.waitForFunction(() => /^Working\. Mailbox checks are on/.test(document.querySelector('[data-verify-test]').textContent));
  assert.deepEqual([calls.sandbox.length, calls.verify.length], [1, 0], 'the test used the sandbox, none of the day’s checks');
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/4-settings.png` });
  await dash.click('[data-settings-form] button[type="submit"]');
  await waitFor(async () => (await storage('settings')).settings.scrollDelayMs === 900, 5000, 'settings saved');
  const saved = (await storage('settings')).settings;
  assert.deepEqual([saved.areas, saved.niches, saved.hiddenPresets, saved.verifyKey, saved.verifyDailyCap, saved.emailRisky], ['JLT, Dubai\nAl Quoz, Dubai', null, ['Used Cars'], VERIFY_KEY, 100, false]);
  for (const k of ['heatWeights', 'weakChecks', 'pagespeedKey', 'adCheckAll', 'auditLinkBase']) assert.ok(!(k in saved), `${k} is gone`);

  /* ------------------------------------------------------- Find: Google Maps */
  await dash.click('[data-view="find"]');
  const chips = await dash.$$eval('[data-find-preset]', (c) => c.map((x) => x.textContent));
  assert.equal(chips[0], 'All types');
  assert.ok(chips.includes('Salons') && !chips.includes('Used Cars'), 'the one you removed is gone');
  assert.ok(await dash.isHidden('[data-keywords-field]'), 'All types has no search terms of its own');
  await dash.click('[data-find-preset="Salons"]');
  assert.match(await dash.inputValue('[data-finder-form] [name="keywords"]'), /^ladies salon\n/);
  assert.match(await dash.textContent('[data-find-areas]'), /^2 areas \(Settings > Areas\), from JLT, Dubai/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/3-find.png`, fullPage: true });
  await dash.fill('[data-finder-form] [name="keywords"]', 'ladies salon');
  await dash.fill('[data-finder-form] [name="cap"]', '10');
  await dash.click('[data-finder-form] button[type="submit"]');
  await waitFor(async () => ((await storage('finder')).finder || {}).status === 'done', 90000, 'Google Maps run').catch(async (e) => {
    for (const pg of ctx.pages()) console.log('page', pg.url(), await pg.evaluate(() => [document.readyState, !!document.querySelector('[role=feed]'), document.visibilityState]).catch((x) => String(x)));
    console.log('finder:', JSON.stringify((await storage('finder')).finder), 'maps calls:', calls.maps, 'problems:', JSON.stringify((await storage('problems')).problems), 'err:', await dash.textContent('[data-finder-err]'));
    throw e;
  });
  assert.deepEqual(calls.maps, ['ladies salon JLT, Dubai', 'ladies salon Al Quoz, Dubai']);
  const run1 = (await storage('finder')).finder;
  console.log('Maps run:', JSON.stringify(run1.stats));
  assert.deepEqual([run1.stats.found, run1.stats.kept, run1.stats.duplicate, run1.stats.opened], [10, 9, 1, 4], 'Bloom is in both searches; four say they just opened or open soon');
  // A kind with its own filters: too many reviews is dropped, a new listing with two is kept.
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Car', keywords: ['ppf'], areas: ['JLT, Dubai'], cap: 5 } }));
  await waitFor(async () => {
    const f = (await storage('finder')).finder;
    return f.niche === 'Car' && f.status === 'done';
  }, 60000, 'ppf run');
  const run2 = (await storage('finder')).finder;
  assert.deepEqual([run2.stats.found, run2.stats.kept, run2.stats.manyReviews, run2.stats.opened], [2, 1, 1, 1]);
  await settled('every check after the Maps runs');

  /* -------------------------------------- what Lead Hunter made of each business */
  const v = {};
  for (const n of ['Bloom Beauty Lounge', 'Velvet Hair Studio', 'Glam Corner Salon', 'Old Town Salon', 'Rose Petal Spa', 'Night Owl Salon', 'Henna House', 'Gloss Garage', 'Soon Cafe', 'Shield PPF Center']) v[n] = await verdict(n);
  console.log('verdicts:', JSON.stringify(v, null, 1));
  // Google's label on the card, Instagram's own posts, and a brand new account.
  const bloom = await byName('Bloom Beauty Lounge');
  assert.deepEqual([...new Set(bloom.openSignals.map((s) => s.kind))].sort(), ['caption', 'google', 'newig']);
  assert.match(bloom.openSignals.find((s) => s.kind === 'caption').text, /GRAND OPENING this Friday in JLT/);
  assert.deepEqual([v['Bloom Beauty Lounge'].fit, v['Bloom Beauty Lounge'].kind, v['Bloom Beauty Lounge'].mail], [true, 'new', { email: 'bloom.beauty.dxb@gmail.com', state: 'ok' }]);
  assert.deepEqual(bloom.emailFrom, { 'bloom.beauty.dxb@gmail.com': 'instagram' });
  // "Opened 3 weeks ago", and a "coming soon" page: fits. The mailbox check could not confirm the address.
  const velvet = await byName('Velvet Hair Studio');
  const opened = velvet.openSignals.find((s) => s.kind === 'google');
  assert.equal(opened.text, 'Opened 3 weeks ago');
  assert.ok(Math.abs(opened.openedAt - (Date.now() - 21 * 864e5)) < 864e5);
  assert.deepEqual([v['Velvet Hair Studio'].fit, v['Velvet Hair Studio'].site, v['Velvet Hair Studio'].mail.why], [true, 'parked', 'risky']);
  // A working website, an old business with no website, opening HOURS: none of them fit.
  assert.deepEqual([v['Glam Corner Salon'].fit, v['Glam Corner Salon'].why], [false, 'They have a working website']);
  assert.deepEqual([v['Old Town Salon'].fit, v['Old Town Salon'].why], [false, 'No website, but no proof they just opened']);
  assert.deepEqual([v['Night Owl Salon'].fit, (await byName('Night Owl Salon')).openSignals], [false, undefined], '"Opens soon ⋅ 10 AM" is opening hours, not an opening');
  // A website that is down fits without proof; there is no email to send to.
  assert.deepEqual([v['Rose Petal Spa'].fit, v['Rose Petal Spa'].kind, v['Rose Petal Spa'].mail.why], [true, 'down', 'none']);
  // Henna House: its Facebook page Intro gave an email (not the CV address in a post), and the mailbox does not exist.
  const henna = await byName('Henna House');
  assert.deepEqual([henna.fbEmail.state, henna.emails], ['found', ['hennahouse.dxb@gmail.com']]);
  assert.deepEqual(v['Henna House'].emails, [['hennahouse.dxb@gmail.com', 'bad', 'The mailbox does not exist']]);
  // Gloss Garage: a parked page full of broken addresses. Only the one that passes every check is used.
  assert.deepEqual([v['Gloss Garage'].fit, v['Gloss Garage'].kind, v['Gloss Garage'].mail], [true, 'parked', { email: 'gloss.garage.dxb@gmail.com', state: 'ok' }]);
  const gstates = Object.fromEntries(v['Gloss Garage'].emails.map(([e, s]) => [e, s]));
  assert.equal(gstates['bookings@glossgarage.example'], 'bad', 'its domain does not exist');
  assert.equal(gstates['sales@glossgarage.com'], 'bad', '.con fixed to .com, which receives no email');
  assert.ok(!Object.keys(gstates).some((e) => /yourdomain|%|^\d/.test(e)), 'no placeholder, no %20, no phone number glued on');
  // The label that only arrives in Maps' own data: "Opening soon".
  assert.deepEqual([v['Soon Cafe'].fit, v['Soon Cafe'].open], [true, 'soon']);
  assert.deepEqual([v['Shield PPF Center'].fit, v['Shield PPF Center'].kind], [true, 'new']);
  assert.ok(calls.verify.length <= 4, `mailbox checks only for businesses that fit (${calls.verify.join(', ')})`);
  assert.ok(!calls.verify.includes('hello@glamcorner.example'), 'no mailbox check spent on a business that does not fit');

  /* ---------------------------------------------------------------- Leads tab */
  await dash.click('[data-view="leads"]');
  await dash.waitForSelector('[data-rows] tr');
  const rowNames = () => dash.$$eval('[data-rows] tr .biz .n', (n) => n.map((x) => x.textContent));
  const fits = await rowNames();
  assert.deepEqual(new Set(fits), new Set(['Bloom Beauty Lounge', 'Velvet Hair Studio', 'Rose Petal Spa', 'Henna House', 'Gloss Garage', 'Soon Cafe', 'Shield PPF Center']), 'only the ones that fit');
  assert.ok(fits.indexOf('Bloom Beauty Lounge') < fits.indexOf('Rose Petal Spa'), 'best first');
  await dash.selectOption('[data-f="show"]', 'nofit');
  await dash.waitForFunction(() => document.querySelectorAll('[data-rows] tr').length === 3);
  assert.deepEqual(new Set(await rowNames()), new Set(['Glam Corner Salon', 'Old Town Salon', 'Night Owl Salon']));
  await dash.selectOption('[data-f="show"]', 'fits');
  assert.match(await dash.textContent('[data-kpis]'), /2 ready to export/);
  // The lead panel: why it fits, the proof, and what each email check said.
  await dash.click(`tr[data-id="${bloom.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-fit-sec]');
  assert.match(await dash.textContent('[data-fit-sec]'), /Fits · Just opened, and they have no website/);
  assert.match(await dash.textContent('[data-fit-sec]'), /Google Maps: “Recently opened”[\s\S]*Their Instagram post: “/);
  assert.match(await dash.textContent('[data-email-sec]'), /bloom\.beauty\.dxb@gmail\.com\s*Confirmed/);
  assert.match(await dash.textContent('[data-cold-note]'), /They go in the next Export for cold email, with bloom\.beauty\.dxb@gmail\.com/);
  if (SHOTS) await dash.waitForTimeout(500), await dash.screenshot({ path: `${SHOTS}/2-drawer.png` });
  await dash.click('.drawer [data-act="close"]');
  const gloss = await byName('Gloss Garage');
  await dash.click(`tr[data-id="${gloss.id}"] [data-open]`);
  await dash.waitForSelector('.drawer.open [data-email-sec] .email-row');
  const gtext = await dash.textContent('[data-email-sec]');
  assert.match(gtext, /gloss\.garage\.dxb@gmail\.com\s*Confirmed/);
  assert.match(gtext, /sales@glossgarage\.com\s*Removed\s*Its domain cannot receive email/);
  assert.match(gtext, /bookings@glossgarage\.example\s*Removed\s*Its domain does not exist/);
  // An address you type is cleaned and checked like any other.
  await dash.fill('[data-add-email] [name="email"]', 'Owner@GlossGarage.con');
  await dash.press('[data-add-email] [name="email"]', 'Enter');
  await waitFor(async () => ((await lead(gloss.id)).emails || []).includes('owner@glossgarage.com'), 5000, 'typed email added');
  await waitFor(async () => (((await lead(gloss.id)).emailCheck || {})['owner@glossgarage.com'] || {}).s === 'bad', 20000, 'typed email checked');
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
  assert.deepEqual(f1.head, ['business_name', 'first_name', 'email', 'website', 'instagram', 'phone', 'niche', 'area', 'source', 'notes', 'status']);
  assert.deepEqual(Object.keys(f1.byName).sort(), ['Bloom Beauty Lounge', 'Gloss Garage']);
  assert.deepEqual(f1.byName['Bloom Beauty Lounge'], { business_name: 'Bloom Beauty Lounge', first_name: '', email: 'bloom.beauty.dxb@gmail.com', website: '', instagram: 'bloombeautydxb', phone: '+971501112201', niche: 'Salons', area: 'JLT, Dubai', source: 'Google Maps', notes: 'new business', status: 'New' });
  assert.deepEqual([f1.byName['Gloss Garage'].email, f1.byName['Gloss Garage'].website, f1.byName['Gloss Garage'].notes], ['gloss.garage.dxb@gmail.com', 'https://glossgarage.example/', '']);
  await dash.waitForFunction(() => /2 leads saved for cold email · left out: /.test(document.querySelector('[data-toast]').textContent));
  const left = await toastText();
  console.log('export toast:', left);
  assert.match(left, /1 whose email could not be confirmed/);
  assert.match(left, /3 without an email/);
  assert.match(left, /1 whose email failed its check/);
  await waitFor(async () => !!(await byName('Bloom Beauty Lounge')).coldEmailExportedAt, 5000, 'marked exported');
  const hist = (await storage('contactHistory')).contactHistory;
  assert.equal(hist['p:+971501112201'][1], 'cold-email', 'remembered, so a later search never brings them back');
  // The ones the mailbox check could not confirm go in only when you say so.
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, emailRisky: true } });
  });
  const f2 = await coldFile('export-cold');
  assert.deepEqual(Object.keys(f2.byName), ['Velvet Hair Studio'], 'exported ones stay out, the unconfirmed one goes in');
  assert.equal(f2.byName['Velvet Hair Studio'].notes, 'new business');
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, emailRisky: false } });
  });
  // An address that bounced: never used again, on any lead.
  await dash.click('[data-view="settings"]');
  await dash.fill('[data-bounces]', 'Delivery failed for <gloss.garage.dxb@gmail.com>: mailbox unavailable');
  await dash.click('[data-act="bounces-add"]');
  await dash.waitForFunction(() => /^1 address remembered, found on 1 lead here/.test(document.querySelector('[data-bounces-out]').textContent));
  assert.deepEqual((await verdict('Gloss Garage')).mail, { email: '', why: 'bad' });
  await dash.click('[data-view="leads"]');
  await dash.check('[data-cold-include]');
  const f3 = await coldFile('export-cold');
  assert.deepEqual(Object.keys(f3.byName), ['Bloom Beauty Lounge'], 'Gloss Garage is out: its only good address bounced. Velvet is out: not confirmed');
  await dash.uncheck('[data-cold-include]');

  /* --------------------------------------- Find: businesses advertising their opening */
  await dash.click('[data-view="find"]');
  assert.match(await dash.inputValue('[data-hunt-form] [name="keywords"]'), /^grand opening\nnow open\n/);
  await dash.fill('[data-hunt-form] [name="keywords"]', 'grand opening\nsoft opening');
  await dash.fill('[data-hunt-form] [name="target"]', '5');
  const [adTab] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-hunt-form] button[type="submit"]')]);
  await waitFor(async () => ((await storage('hunt')).hunt || {}).status === 'done', 90000, 'Ad Library search');
  await adTab.close();
  await settled('every check after the Ad Library search');
  const fresh = await verdict('Fresh Bites Cafe');
  console.log('Fresh Bites:', JSON.stringify(fresh));
  const freshLead = await byName('Fresh Bites Cafe');
  assert.match(freshLead.openSignals[0].text, /Grand opening this Saturday in Business Bay/);
  assert.deepEqual([freshLead.emailFrom['hello@freshbites.example'], freshLead.websiteSource], ['ad', 'email'], 'the email in their ad, and its domain checked as their website');
  assert.deepEqual([fresh.fit, fresh.kind, fresh.mail.why], [true, 'new', 'risky']);
  assert.deepEqual([(await verdict('Old Mall Outlet')).fit, (await byName('Old Mall Outlet')).openSignals], [false, undefined], 'the same words on an ad that ran for most of a year');
  assert.deepEqual(await verdict('MegaMart Official').then((x) => [x.fit, x.why]), [false, 'An established brand, not a new business']);
  // A login wall in the Ad Library stops the search and says so. Nothing tries to get past it.
  world.adWall = true;
  const [wallTab] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-hunt-form] button[type="submit"]')]);
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
  await sw.evaluate(() => handlers['finder:start']({ config: { niche: 'Salons', keywords: ['nail salon'], areas: ['JLT, Dubai'], cap: 5 } }));
  await waitFor(async () => ((await storage('alerts')).alerts || {}).maps, 60000, 'Maps alert');
  assert.equal((await storage('finder')).finder.status, 'paused');
  await dash.waitForSelector('[data-strip] [data-alert="maps"]');
  assert.match(await dash.textContent('[data-strip] [data-alert="maps"]'), /Google Maps paused: Google Maps showed a consent or verification page/);
  world.mapsWall = false;
  await dash.click('[data-strip] [data-act="finder-resume"]');
  await waitFor(async () => (await storage('finder')).finder.status === 'done', 60000, 'resumed run');
  assert.deepEqual(calls.maps.slice(-2), ['nail salon JLT, Dubai', 'nail salon JLT, Dubai'], 'the same search again, nothing skipped');
  assert.ok(!((await storage('alerts')).alerts || {}).maps);

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
  assert.deepEqual([cafe.website, cafe.websiteSource, (await verdict('New Cafe DXB')).why], ['https://newcafedxb.example/', 'email', 'They have a working website']);
  assert.ok(calls.ig.some((f) => /business_discovery\.username\(newcafe\.dxb\)\{.*biography.*media\.limit\(12\)\{caption,timestamp,permalink\}/.test(f)), 'the official API, with posts');

  /* ---------------------------------------------------------- the popup */
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 360 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => /ready to export/.test(document.querySelector('[data-stats]').textContent));
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/5-popup.png` });
  await popup.close();
  await dash.bringToFront();

  /* ------------------------------ Intent Radar: Reddit, a Facebook group, LinkedIn jobs */
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, subreddits: 'dubai\nUAE', uaeOnlySubs: 'smallbusiness' } });
  });
  // Without an approved Reddit app id nothing is read in the background: Reddit refuses anyone not logged in.
  assert.equal((await sw.evaluate(() => handlers['intent:run']({}))).tab, true);
  assert.deepEqual(redditCalls, [], 'no background Reddit requests without an app id');
  // Scan Reddit now opens a Reddit tab (where you are logged in) and reads your subreddits there.
  const rd = await ctx.newPage();
  await rd.goto('https://www.reddit.com/r/dubai/new/#lead-hunter-scan');
  await rd.locator('.msg', { hasText: 'Read 8 posts' }).waitFor({ timeout: 45000 });
  assert.equal(await rd.textContent('.msg'), 'Read 8 posts from 3 subreddits · 3 saved to the Intent tab · 1 sellers · 1 older than 14 days · 1 already saved · 1 not in the UAE');
  assert.ok(!rd.url().includes('#lead-hunter-scan'), 'the start marker is removed');
  assert.deepEqual(redditCalls, ['dubai?100', 'UAE?100', 'smallbusiness?100'], 'one request per subreddit, through the Reddit tab');
  const runStats = ({ seen, saved, duplicates, nomatch, seller, old, foreign }) => ({ seen, saved, duplicates, nomatch, seller, old, foreign });
  const radarRun = (await storage('intentState')).intentState.runs[0];
  console.log('Reddit scan:', JSON.stringify(runStats(radarRun)));
  assert.deepEqual(runStats(radarRun), { seen: 8, saved: 3, duplicates: 1, nomatch: 1, seller: 1, old: 1, foreign: 1 });
  // Scan this page: the posts on the page (one already saved, one too old).
  await rd.locator('button', { hasText: 'Scan this page' }).click();
  await rd.locator('.msg', { hasText: 'Read 2 posts' }).waitFor();
  assert.equal(await rd.textContent('.msg'), 'Read 2 posts · 0 saved to the Intent tab · 1 older than 14 days · 1 already saved');
  // Reddit refusing (not logged in): it stops at once and reads the page instead. No alert for that.
  redditMode.refuse = true;
  await rd.locator('button', { hasText: 'Scan my subreddits' }).click();
  await rd.locator('.msg', { hasText: 'From this page' }).waitFor();
  assert.equal(await rd.textContent('.msg'), 'Reddit did not let Lead Hunter read your subreddits (403). If you are not logged in to Reddit, log in and try again. From this page: Read 2 posts · 0 saved to the Intent tab · 1 older than 14 days · 1 already saved');
  assert.equal(redditCalls.length, 4, 'one refused request, then it stopped');
  redditMode.refuse = false;
  assert.ok(!((await storage('alerts')).alerts || {}).reddit);
  // A Reddit block page pauses Reddit with an alert; nothing tries to get past it.
  await rd.goto('https://www.reddit.com/r/blocked/new/');
  await rd.locator('button', { hasText: 'Scan this page' }).click();
  await rd.locator('.msg', { hasText: 'paused Reddit' }).waitFor();
  assert.equal((await storage('alerts')).alerts.reddit.text, 'Reddit blocked this browser (log in to Reddit in this tab)');
  await rd.locator('button', { hasText: 'Scan my subreddits' }).click();
  await rd.locator('.msg', { hasText: 'Reddit scans are paused' }).waitFor();
  assert.equal(redditCalls.length, 4, 'paused: no requests');
  await sw.evaluate(() => handlers['intent:resume']({ source: 'reddit' }));
  await rd.close();
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '3', 'new posts on the icon');
  await dash.bringToFront();
  await dash.click('[data-view="intent"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 3);
  const sums = await dash.$$eval('.intent-card .sum', (p) => p.map((x) => x.textContent));
  assert.deepEqual(sums, ['Need a website for my bakery in JLT, any recommendations?', 'Business is slow, ads not working', 'How do I get clients for my cleaning company in Sharjah?'], 'newest first');
  await waitFor(async () => (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '', 5000, 'the badge clears once you look');
  const first = await dash.textContent('.intent-card');
  assert.match(first, /Reddit · r\/dubai\s*3h ago · u\/sarah_dxb\s*Website buyer\s*unverified/);
  assert.ok(!(await dash.$('.intent-card [data-intent-opener], .intent-card [data-act="intent-copy"]')), 'no opener: you write your own');
  assert.match(await dash.textContent('[data-intent-status]'), /AI check is off: add a free Google AI Studio key/);
  assert.match(await dash.textContent('[data-intent-status]'), /Reddit: press Scan Reddit now \(it opens Reddit, where you need to be logged in\), last scan/);
  const [redditTab] = await Promise.all([ctx.waitForEvent('page'), dash.click('[data-act="intent-run"]')]);
  await redditTab.waitForLoadState('domcontentloaded');
  assert.match(redditTab.url(), /^https:\/\/www\.reddit\.com\/r\/dubai\/new\//, 'opens your first subreddit');
  await redditTab.close();
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/22-intent.png` });
  const firstId = await dash.getAttribute('.intent-card', 'data-intent-id');
  await dash.click('.intent-card [data-act="intent-contacted"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 2);
  assert.equal((await dash.evaluate((id) => LH.intentDb.get(id), firstId)).status, 'contacted');
  await dash.click('.intent-card [data-act="intent-dismiss"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 1);
  await dash.selectOption('[data-intent-f="status"]', 'all');
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 3);
  await dash.selectOption('[data-intent-f="status"]', 'new');
  // A Facebook group you opened yourself: press Scan for leads.
  const fbg = await ctx.newPage();
  await fbg.goto('https://www.facebook.com/groups/dubaibiz/');
  await fbg.locator('button', { hasText: 'Scan for leads' }).click();
  await fbg.locator('.msg', { hasText: 'Read 3 posts' }).waitFor();
  assert.equal(await fbg.textContent('.msg'), 'Read 3 posts · 1 saved to the Intent tab · 1 sellers · 1 older than 14 days');
  const fbPost = await dash.evaluate(() => LH.intentDb.get('facebook:111'));
  assert.deepEqual([fbPost.place, fbPost.author, fbPost.categories, fbPost.url], ['Dubai Business Owners', 'Sarah Khan', ['marketing'], 'https://www.facebook.com/groups/dubaibiz/posts/111/']);
  assert.ok(Math.abs(fbPost.createdAt - (Date.now() - 2 * 36e5)) < 6e4, '"2h" read as two hours ago');
  await fbg.close();
  // LinkedIn jobs: a marketing role in the UAE is a company hiring for marketing, linked to your lead.
  const lij = await ctx.newPage();
  await lij.goto('https://www.linkedin.com/jobs/search/?keywords=marketing');
  await lij.locator('button', { hasText: 'Scan for leads' }).click();
  await lij.locator('.msg', { hasText: 'Read 3 jobs' }).waitFor();
  assert.equal(await lij.textContent('.msg'), 'Read 3 jobs · 1 saved to the Intent tab · 1 not in the UAE');
  const hire = await dash.evaluate(() => LH.intentDb.get('linkedin:job:901'));
  assert.deepEqual([hire.categories, hire.title, hire.company], [['hiring'], 'Social Media Executive', 'Gloss Garage']);
  const hiredLead = await lead(hire.leadId);
  assert.equal(await sw.evaluate((n) => LH.normName(n), hiredLead.pageName), 'gloss garage');
  assert.equal(hiredLead.hiring.url, 'https://www.linkedin.com/jobs/view/901/');
  // A security check on LinkedIn: that source pauses and says so. Nothing tries to get past it.
  await lij.goto('https://www.linkedin.com/feed/');
  await lij.locator('button', { hasText: 'Scan for leads' }).click();
  await lij.locator('.msg', { hasText: 'security check' }).waitFor();
  assert.equal((await storage('alerts')).alerts.linkedin.text, 'LinkedIn showed a security check');
  await dash.bringToFront();
  await dash.waitForSelector('[data-intent-status] [data-alert="linkedin"]');
  assert.match(await dash.textContent('[data-alert="linkedin"]'), /LinkedIn paused: LinkedIn showed a security check/);
  await dash.click('[data-act="intent-resume"][data-source="linkedin"]');
  await waitFor(async () => !(await storage('alerts')).alerts.linkedin, 5000, 'LinkedIn resumed');
  await lij.close();
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 3, null, { timeout: 5000 });

  /* --------------------------------- AI check: Gemini (or Claude) confirms or rules out each post */
  await dash.click('[data-view="settings"]');
  // Claude works too, when it is the only key.
  await dash.fill('[name="anthropicKey"]', 'sk-ant-wrong');
  await dash.click('[data-act="ai-test"]');
  await dash.waitForFunction(() => /^Not working: Claude did not accept your API key \(401\)/.test(document.querySelector('[data-ai-test]').textContent));
  await dash.fill('[name="anthropicKey"]', CLAUDE.key);
  await dash.click('[data-act="ai-test"]');
  await dash.waitForFunction(() => document.querySelector('[data-ai-test]').textContent === 'Working. Claude read a test post: a buyer, needs website, score 90.');
  const call = CLAUDE.calls.at(-1);
  assert.deepEqual([call.version, call.browser, call.model, call.effort, call.format], ['2026-10-21', 'true', 'claude-haiku-5-5', 'low', 'json_schema']);
  // The free Google AI Studio key: used whenever it is filled in.
  await dash.fill('[name="geminiKey"]', 'AIza-wrong');
  await dash.click('[data-act="ai-test"]');
  await dash.waitForFunction(() => /^Not working: Google did not accept your API key \(400\)/.test(document.querySelector('[data-ai-test]').textContent));
  await dash.fill('[name="geminiKey"]', GEMINI.key);
  await dash.click('[data-act="ai-test"]');
  await dash.waitForFunction(() => document.querySelector('[data-ai-test]').textContent === 'Working. Gemini read a test post: a buyer, needs website, score 90.');
  const gcall = GEMINI.calls.at(-1);
  assert.deepEqual([gcall.key, gcall.inUrl, gcall.model, gcall.mime, gcall.schema, gcall.system], [GEMINI.key, false, 'gemini-flash-lite-latest', 'application/json', true, true]);
  // Every post the keywords caught, read by Gemini.
  await dash.click('[data-view="intent"]');
  await dash.waitForSelector('[data-act="intent-ai-all"]');
  assert.match(await dash.textContent('[data-intent-status]'), /AI check \(Gemini\) is on: 5 posts not checked yet/);
  const before = GEMINI.calls.length;
  const claudeBefore = CLAUDE.calls.length;
  await dash.click('[data-act="intent-ai-all"]');
  await waitFor(async () => (await dash.evaluate(() => LH.intentDb.all())).every((p) => p.verified), 30000, 'every post checked by the AI');
  assert.equal(GEMINI.calls.length - before, 5, 'one call per post');
  assert.equal(CLAUDE.calls.length, claudeBefore, 'Gemini is used when both keys are set');
  // Keys never go into a backup file.
  await dash.click('[data-view="settings"]');
  const [backupDl] = await Promise.all([dash.waitForEvent('download'), dash.click('[data-act="backup"]')]);
  const backup = JSON.parse(fs.readFileSync(await backupDl.path(), 'utf8'));
  assert.deepEqual(['geminiKey', 'anthropicKey', 'igToken', 'verifyKey'].map((k) => backup.settings[k]), ['', '', '', '']);
  assert.ok(!('queueKey' in backup.settings), 'the old site key is gone');
  assert.ok(backup.leads.length > 0);
  await dash.click('[data-view="intent"]');
  const checked = Object.fromEntries((await dash.evaluate(() => LH.intentDb.all())).map((p) => [p.id, p]));
  console.log('AI check:', JSON.stringify(Object.values(checked).map((p) => [p.id, p.notBuyer ? 'not a buyer' : 'buyer', p.score, p.summary])));
  assert.deepEqual([checked['reddit:d1'].ai.business_type, checked['reddit:d1'].score, checked['reddit:d1'].summary], ['bakery', 90, 'A bakery owner in JLT wants a website.']);
  assert.equal(checked['reddit:s1'].notBuyer, true, 'asking in general, not hiring anyone');
  // Not buyers are hidden unless you ask for them.
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 2);
  assert.match(await dash.textContent('[data-intent-rows]'), /AI: buyer, urgent[\s\S]*A salon owner in Al Barsha needs a social media manager\./);
  assert.match(await dash.textContent('[data-intent-rows]'), /salon · Al Barsha, Dubai · needs marketing/);
  await dash.check('[data-intent-f="notBuyers"]');
  await dash.waitForFunction(() => document.querySelectorAll('[data-intent-rows] .intent-card').length === 3);
  assert.match(await dash.textContent('[data-intent-rows]'), /AI: not a buyer/);
  if (SHOTS) await dash.screenshot({ path: `${SHOTS}/23-intent-ai.png` });
  await dash.uncheck('[data-intent-f="notBuyers"]');
  // New posts are checked as they come in.
  await sw.evaluate(() => saveIntent([{ id: 'reddit:g1', source: 'reddit', place: 'r/dubai', url: 'https://www.reddit.com/r/dubai/comments/g1/x/', author: 'u/omar_fit', title: 'Need a website for my gym in Al Quoz', text: '', createdAt: Date.now() - 36e5 }], 'reddit'));
  await waitFor(async () => (await dash.evaluate(() => LH.intentDb.get('reddit:g1'))).verified, 20000, 'the new post checked by itself');
  // A wrong key pauses the checks with an alert. Nothing else runs until you fix it.
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, geminiKey: 'AIza-expired' } });
  });
  await sw.evaluate(() => handlers['ai:check']({ ids: ['reddit:d1'] }));
  await waitFor(async () => !!((await storage('alerts')).alerts || {}).ai, 20000, 'AI check paused');
  await dash.waitForSelector('[data-intent-status] [data-alert="ai"]');
  assert.match(await dash.textContent('[data-alert="ai"]'), /AI check paused: Google did not accept your API key \(400\)/);
  await sw.evaluate(async (key) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, geminiKey: key } });
  }, GEMINI.key);
  await dash.click('[data-act="intent-resume"][data-source="ai"]');
  await waitFor(async () => !((await storage('alerts')).alerts || {}).ai && !((await storage('aiQueue')).aiQueue || []).length, 20000, 'AI check resumed');

  // An owner announcing their own opening is a buyer of a website, even with "discount" in the post.
  await sw.evaluate(() => saveIntent([{ id: 'reddit:o1', source: 'reddit', place: 'r/dubai', url: 'https://www.reddit.com/r/dubai/comments/o1/x/', author: 'u/lina_nails', title: 'Soft opening of my new nail studio in JLT next week!', text: '20% discount for the first clients', createdAt: Date.now() - 36e5 }], 'reddit'));
  const openingPost = await waitFor(async () => dash.evaluate(() => LH.intentDb.get('reddit:o1')), 10000, 'opening post saved');
  assert.ok(openingPost.categories.includes('opening'), JSON.stringify(openingPost.categories));

  console.log('E2E PASSED:', (await leads()).length, 'leads');
  await ctx.close();
  mux.close();
  process.exit(0);
} catch (e) {
  await fail(e);
}
