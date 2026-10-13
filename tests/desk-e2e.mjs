// End-to-end test of the Lead Desk page (/desk) in real Chromium against the real API handler
// (netlify/functions/lead-desk.mts) with an in-memory store. No real network: WhatsApp, ntfy, Telegram and a
// client's website are served by a local stub, and the server's alerts go to a fetch that only records them.
//   node tests/desk-e2e.mjs [--shots <dir>]
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
import { handle } from '../netlify/functions/lead-desk.mts';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const KEY = 'desk-e2e-key-' + 'x'.repeat(24);
const ORIGIN = 'https://www.rizcoreach.ae';
const SITE = 'https://glossy-ppf.example';
const HOSTS = ['www.rizcoreach.ae', 'wa.me', 'web.whatsapp.com', 'ntfy.sh', 'api.telegram.org', 'glossy-ppf.example'];
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? process.argv[shotsArg + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-e2e-'));

/* -------------------------------------------------------------------- time */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Dubai is UTC+4 all year.
const dubaiDate = (ts) => new Date(ts + 4 * HOUR).toISOString().slice(0, 10);
const dubaiTs = (date, time) => Date.parse(`${date}T${time}:00+04:00`);
const clock = (ts) => {
  const d = new Date(ts + 4 * HOUR);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'short' });
// The server clock starts at 11:00 today (Dubai) and runs in real time, so the run doesn't depend on the hour
// (a lead that arrives outside working hours would wait for the morning instead of showing in To do).
const base = dubaiTs(dubaiDate(Date.now()), '11:00');
const started = Date.now();
const serverNow = () => base + (Date.now() - started);
const today = dubaiDate(base);
const tomorrow = dubaiDate(base + DAY);
const yesterday = dubaiDate(base - DAY);

/* ------------------------------------------------------------------- store */
const tick = () => new Promise((r) => setImmediate(r));
/** In-memory stand-in for the Netlify Blobs store: several keys, each with real etag semantics. */
function memStore() {
  const docs = new Map();
  let n = 0;
  return {
    async getWithMetadata(key) {
      await tick();
      const d = docs.get(key);
      return d ? { data: JSON.parse(d.json), etag: d.etag } : null;
    },
    async setJSON(key, value, o = {}) {
      await tick();
      const cur = docs.get(key);
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      if (o.onlyIfNew && cur) return { modified: false };
      const etag = `"e${++n}"`;
      docs.set(key, { json: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    peek: (key) => (docs.has(key) ? JSON.parse(docs.get(key).json) : null),
  };
}
const store = memStore();
const leadsNow = () => store.peek('leads')?.leads || [];
const configNow = () => store.peek('config') || { clients: [], settings: {} };
const leadNamed = (name) => leadsNow().find((l) => l.name === name);

// What the server sent to ntfy / Telegram. Nothing leaves this machine.
const alerts = [];
const serverFetch = async (url, init = {}) => {
  alerts.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers || {})), body: typeof init.body === 'string' ? init.body : '' });
  if (String(url).includes('/getUpdates')) return Response.json({ ok: true, result: [] });
  return new Response('ok');
};

/* ------------------------------------------------------------------ server */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const STUB = '<!doctype html><meta charset="utf-8"><title>WhatsApp stub</title><p>whatsapp stub</p>';
let siteForm = ''; // the client's website, built from the form code the desk gives out
const browserHits = []; // the page itself must never call ntfy or Telegram

function handler(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };
  if (host === 'www.rizcoreach.ae') {
    if (url.pathname === '/api/desk' || url.pathname.startsWith('/api/desk/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: body.length ? body : undefined }), store, KEY, { fetch: serverFetch, now: serverNow });
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      });
      return;
    }
    const file = url.pathname === '/desk' ? path.join(PUB, 'desk.html') : path.join(PUB, path.normalize(decodeURIComponent(url.pathname)));
    if (file.startsWith(PUB + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  }
  if (host === 'wa.me' || host === 'web.whatsapp.com') return send(200, 'text/html; charset=utf-8', STUB);
  if (host === 'glossy-ppf.example') {
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', siteForm);
    if (url.pathname === '/thank-you') return send(200, 'text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><title>Thank you</title><p>Thanks, we got your enquiry.</p>');
  }
  if (host === 'ntfy.sh' || host === 'api.telegram.org') browserHits.push(url.href);
  send(404, 'text/plain', 'not found');
}

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
const browser = await pw.chromium.launch({
  headless: true,
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(', ')}`, '--ignore-certificate-errors'],
  // The test hosts are all served by the local mux, so they bypass any proxy from the environment (an HTTPS_PROXY
  // would otherwise tunnel them away). Every other host goes to a dead proxy: a stray real request fails the run.
  proxy: { server: 'http://127.0.0.1:9', bypass: HOSTS.join(',') },
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
const errors = [];
const watch = (p) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(`${p.url()}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on('dialog', (d) => {
    errors.push(`unexpected dialog: ${d.message()}`);
    d.dismiss();
  });
};
ctx.on('page', watch);
const page = await ctx.newPage();

const fail = async (e) => {
  console.error('DESK E2E FAILED:', e);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
  await browser.close().catch(() => {});
  mux.close();
  process.exit(1);
};
process.on('unhandledRejection', fail);
setTimeout(() => fail(new Error('timed out after 3 minutes')), 180_000).unref();

const step = (s) => console.log('·', s);
const waitFor = async (fn, label, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for ' + label);
};
const exact = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const cards = (p = page) => p.locator('[data-main] article.card');
const cardOf = (name, p = page) => cards(p).filter({ has: p.locator('.lead-name', { hasText: exact(name) }) });
const toastText = () => page.locator('[data-toast]').textContent();
const tab = (t, p = page) => p.click(`[data-tab="${t}"]`);

/** Clicks a WhatsApp link and returns where the new tab went (the stub stands in for WhatsApp). */
async function openWhatsApp(link) {
  const [popup] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
  await popup.waitForURL(/^https:\/\/(wa\.me|web\.whatsapp\.com)\//);
  const u = new URL(popup.url());
  await popup.close();
  return { host: u.hostname, phone: u.searchParams.get('phone') || u.pathname.slice(1), text: u.searchParams.get('text') || '' };
}

try {
  /* 1. Pair */
  step('1. pair with the desk key');
  await page.goto(`${ORIGIN}/desk`);
  await page.waitForSelector('[data-pair]:not([hidden])');
  await page.fill('[data-pair] input[name="key"]', KEY);
  await page.click('[data-pair] button.primary');
  await page.waitForSelector('[data-app]:not([hidden])');
  await page.waitForSelector('text=Add your first client in Setup');
  assert.equal(await page.evaluate(() => localStorage.getItem('desk-key')), KEY);

  /* 2. My name and an ntfy topic */
  step('2. my name and a private ntfy topic');
  await tab('setup');
  await page.fill('[data-form="details"] [name="myName"]', 'Samil');
  await page.click('[data-form="details"] button.primary');
  await waitFor(() => configNow().settings.myName === 'Samil', 'name saved');
  await page.click('[data-act="ntfy-topic"]');
  const ntfyUrl = await waitFor(() => /^https:\/\/ntfy\.sh\/rr-desk-[a-z0-9]{20}$/.test(configNow().settings.ntfyUrl || '') && configNow().settings.ntfyUrl, 'ntfy topic saved');
  assert.equal(await page.inputValue('[name="ntfyUrl"]'), ntfyUrl);
  assert.ok((await page.locator('[data-ntfy-help]').textContent()).includes(ntfyUrl.split('/').pop()), 'help names the topic');

  /* 3. Client */
  step('3. add client Glossy PPF and copy its intake link');
  await page.click('[data-act="new-client"]');
  const form = page.locator('[data-form="client"]');
  await form.locator('[name="name"]').fill('Glossy PPF');
  await form.locator('[name="niche"]').selectOption('car');
  await form.locator('[name="contactName"]').fill('Omar');
  await form.locator('[name="contactWa"]').fill('0501112222');
  await form.locator('[name="location"]').fill('Al Quoz 3, Dubai');
  await form.locator('[name="mapsUrl"]').fill('https://maps.app.goo.gl/glossyppf');
  await form.locator('[name="services"]').fill('Full body PPF\nCeramic coating');
  await form.locator('button.primary').click();
  await page.waitForSelector('[data-intake-link]');
  const client = configNow().clients.find((c) => c.name === 'Glossy PPF');
  assert.ok(client, 'client stored');
  assert.equal(client.niche, 'car');
  assert.equal(client.contactName, 'Omar');
  assert.equal(client.contactWa, '971501112222');
  const link = `${ORIGIN}/api/desk/in/${client.intakeToken}`;
  assert.equal(await page.inputValue('[data-intake-link]'), link);
  await page.click('.copy-row [data-act="copy"]');
  await waitFor(async () => (await toastText()).includes('Copied'), 'copy toast');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  const check = await page.evaluate(async (u) => (await fetch(u)).json(), link);
  assert.equal(check.client, 'Glossy PPF');
  const snippet = await page.locator('.intake .code').textContent();
  assert.ok(snippet.includes(`action="${link}"`), snippet);
  assert.match(await page.locator('.intake .consent').textContent(), /^I agree that Glossy PPF and its bookings team may contact me on WhatsApp/);

  /* 4. Leads arrive */
  step('4. a Meta lead (JSON) and a website form post');
  const meta = await page.evaluate(async (u) => {
    const res = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '900100200',
        created_time: new Date().toISOString(),
        campaign_name: 'PPF October',
        form_name: 'PPF quote',
        phone_number_verified: true,
        field_data: [
          { name: 'full_name', values: ['SARA AHMED'] },
          { name: 'phone_number', values: ['+971558765439'] },
          { name: 'email', values: ['sara@example.com'] },
          { name: 'which_service_are_you_interested_in?', values: ['Full body PPF'] },
          { name: 'what_car_do_you_drive?', values: ['Tesla Model 3 <b>2024</b>'] },
          { name: 'when_suits_you?', values: ['this_weekend'] },
          { name: 'anything_else?', values: ['<img src=x onerror=alert(1)>'] },
        ],
      }),
    });
    return { status: res.status, body: await res.json() };
  }, link);
  assert.equal(meta.status, 200, JSON.stringify(meta));
  assert.equal(meta.body.ids.length, 1);
  // The client's website uses the form code from Setup, with their own thank-you page.
  siteForm = `<!doctype html><meta charset="utf-8"><title>Glossy PPF</title>${snippet.replace('https://their-site/thank-you', `${SITE}/thank-you`)}`;
  const site = await ctx.newPage();
  await site.goto(`${SITE}/`);
  await site.fill('[name="full_name"]', 'John Smith');
  await site.fill('[name="phone_number"]', '052 987 6543');
  await site.check('input[type="checkbox"]');
  const [landed] = await Promise.all([site.waitForResponse((r) => r.url() === `${SITE}/thank-you`), site.click('button')]);
  await site.waitForURL(`${SITE}/thank-you`);
  const post = landed.request().redirectedFrom();
  assert.ok(post && post.method() === 'POST' && post.url() === link, 'the form posted to the intake link');
  assert.equal((await post.response()).status(), 303);
  assert.match(await site.textContent('body'), /Thanks, we got your enquiry/);
  await site.close();
  assert.equal(leadsNow().length, 2);
  assert.equal(leadNamed('John Smith').source, 'website');
  assert.equal(leadNamed('John Smith').service, 'Full body PPF');

  /* 5. To do */
  step('5. To do cards after refresh, and the ntfy alert');
  await tab('todo');
  await page.click('[data-act="refresh"]');
  await waitFor(async () => (await cards().count()) === 2, '2 cards in To do');
  assert.match(await page.locator('[data-tab="todo"]').textContent(), /^To do \(2\)$/);
  assert.match(await page.locator('[data-status]').textContent(), /^2 to do now · synced \d{1,2}:\d\d (am|pm)$/);
  const sara = cardOf('SARA AHMED');
  const saraText = await sara.innerText();
  for (const s of ['Glossy PPF', 'Meta', '+971 55 876 5439', 'Full body PPF', 'Send first message', 'Number verified by Meta']) assert.ok(saraText.includes(s), `card shows ${s}:\n${saraText}`);
  const timer = sara.locator('.timer');
  assert.match(await timer.textContent(), /^Waiting (under 1 min|[1-4] min)$/);
  assert.match(await timer.getAttribute('class'), /\bg\b/, 'timer is green under 5 minutes');
  // Lead answers are untrusted public input: shown as text, never as HTML.
  await sara.locator('[data-act="answers"]').click();
  assert.ok((await cardOf('SARA AHMED').innerText()).includes('<img src=x onerror=alert(1)>'));
  assert.ok((await cardOf('SARA AHMED').innerText()).includes('Tesla Model 3 <b>2024</b>'));
  assert.equal(await page.locator('[data-main] img, [data-main] b:text("2024")').count(), 0);
  const saraMsg = await sara.locator('[data-f="msg"]').inputValue();
  assert.match(saraMsg, /^Hi Sara 👋 This is Samil from the Glossy PPF bookings team\. Thanks for your enquiry about Full body PPF!/);
  const saraId = leadNamed('SARA AHMED').id;
  const ntfy = alerts.filter((a) => a.url === ntfyUrl);
  assert.equal(ntfy.length, 2, 'one alert per lead');
  const saraAlert = ntfy.find((a) => a.body.startsWith('Sara ·'));
  assert.ok(saraAlert, JSON.stringify(ntfy));
  assert.match(saraAlert.headers.title, /Glossy PPF/);
  assert.equal(saraAlert.headers.click, `${ORIGIN}/desk#lead=${saraId}`);
  assert.equal(saraAlert.body, `Sara · Full body PPF\nReply within 5 minutes: ${ORIGIN}/desk#lead=${saraId}`);
  // The alert's link opens the desk on that lead.
  const fromAlert = await ctx.newPage();
  await fromAlert.goto(saraAlert.headers.click);
  await fromAlert.waitForSelector(`[data-id="${saraId}"].flash`);
  assert.equal(await fromAlert.getAttribute('[data-tab="todo"]', 'aria-selected'), 'true');
  await fromAlert.close();

  /* 6. First message */
  step('6. WhatsApp: first message, Undo, send again');
  const wa1 = await openWhatsApp(sara.locator('a[data-act="send"]'));
  assert.equal(wa1.host, 'web.whatsapp.com');
  assert.equal(wa1.phone, '971558765439');
  for (const s of ['Glossy PPF bookings team', 'Samil', 'Sara']) assert.ok(wa1.text.includes(s), `message has ${s}: ${wa1.text}`);
  assert.equal(wa1.text, saraMsg);
  await waitFor(async () => (await cardOf('SARA AHMED').count()) === 0, 'card leaves To do');
  await waitFor(async () => (await toastText()).includes('Marked as sent'), 'Marked as sent toast');
  await waitFor(() => leadNamed('SARA AHMED').status === 'contacted', 'saved as messaged');
  await page.click('[data-toast] button');
  await waitFor(async () => (await cardOf('SARA AHMED').count()) === 1, 'Undo puts the card back');
  await waitFor(() => leadNamed('SARA AHMED').status === 'new' && !leadNamed('SARA AHMED').firstTouchAt, 'Undo saved');
  const wa2 = await openWhatsApp(cardOf('SARA AHMED').locator('a[data-act="send"]'));
  assert.equal(wa2.text, saraMsg);
  await waitFor(async () => (await cardOf('SARA AHMED').count()) === 0, 'card leaves To do again');
  const firstAt = await waitFor(() => leadNamed('SARA AHMED').firstTouchAt, 'sent again');
  await tab('waiting');
  await waitFor(async () => (await cardOf('SARA AHMED').innerText()).includes(`Next: Follow-up 1 at ${clock(firstAt + 120 * MIN)}`), 'Waiting shows when follow-up 1 is due');

  /* 7. Replied, booked, confirmation, handover */
  step('7. they replied, booked tomorrow 11:00, confirmation and handover');
  await cardOf('SARA AHMED').locator('[data-act="replied"]').click();
  await tab('chatting');
  await waitFor(async () => (await cardOf('SARA AHMED').count()) === 1, 'card in Chatting');
  const chat = cardOf('SARA AHMED');
  await chat.locator('[data-act="book"]').click();
  assert.equal(await chat.locator('[data-f="book-date"]').inputValue(), tomorrow);
  assert.equal(await chat.locator('[data-f="book-time"]').inputValue(), '11:00');
  assert.ok(await chat.locator('[data-book-warn]').isHidden());
  await chat.locator('[data-form="book"] button.primary').click();
  await waitFor(() => leadNamed('SARA AHMED').status === 'booked' && leadNamed('SARA AHMED').bookedFor === `${tomorrow}T11:00`, 'booking saved');
  const booked = `${dayFmt.format(dubaiTs(tomorrow, '11:00'))}, 11:00 am`;
  await tab('todo');
  await waitFor(async () => (await cardOf('SARA AHMED').innerText()).includes('Send booking confirmation'), 'confirmation due');
  const confirmMsg = await cardOf('SARA AHMED').locator('[data-f="msg"]').inputValue();
  for (const s of [booked, 'Glossy PPF, Al Quoz 3, Dubai', 'https://maps.app.goo.gl/glossyppf']) assert.ok(confirmMsg.includes(s), `confirmation has ${s}:\n${confirmMsg}`);
  assert.match(await cardOf('SARA AHMED').locator('a[data-act="send"]').innerText(), /WhatsApp: booking confirmation/);
  const wa3 = await openWhatsApp(cardOf('SARA AHMED').locator('a[data-act="send"]'));
  assert.equal(wa3.phone, '971558765439');
  assert.equal(wa3.text, confirmMsg);
  await waitFor(async () => (await cardOf('SARA AHMED').innerText()).includes('Send to Glossy PPF'), 'handover due');
  assert.match(await cardOf('SARA AHMED').locator('a[data-act="send"]').innerText(), /Send to Omar/);
  const wa4 = await openWhatsApp(cardOf('SARA AHMED').locator('a[data-act="send"]'));
  assert.equal(wa4.phone, '971501112222');
  for (const s of ['SARA AHMED', '+971 55 876 5439', 'Full body PPF', booked, 'https://wa.me/971558765439']) assert.ok(wa4.text.includes(s), `handover has ${s}:\n${wa4.text}`);
  await waitFor(() => leadNamed('SARA AHMED').handedAt, 'handover saved');
  await waitFor(async () => (await cardOf('SARA AHMED').count()) === 0, 'card leaves To do after the handover');
  await tab('booked');
  const bookedText = await cardOf('SARA AHMED').innerText();
  for (const s of [booked, 'Confirmation sent', 'Sent to Omar', 'Next: Send reminder']) assert.ok(bookedText.includes(s), `Booked card shows ${s}:\n${bookedText}`);

  /* 8. A booking in the past */
  step('8. a past booking asks for the outcome');
  await tab('todo');
  const john = cardOf('John Smith');
  await john.locator('[data-act="book"]').click();
  await john.locator('[data-f="book-date"]').fill(yesterday);
  await john.locator('[data-f="book-time"]').fill('10:00');
  await waitFor(() => john.locator('[data-book-warn]').isVisible(), 'past-time warning');
  await john.locator('[data-form="book"] button.primary').click();
  await waitFor(async () => (await cardOf('John Smith').locator('[data-act="showed"]').count()) === 1, 'outcome buttons');
  await cardOf('John Smith').locator('[data-act="showed"]').click();
  await waitFor(() => leadNamed('John Smith').outcome === 'showed', 'outcome saved');
  await tab('booked');
  await waitFor(async () => (await cardOf('John Smith').innerText()).includes('Showed up'), 'Booked card shows the outcome');

  /* 9. Import Meta's CSV */
  step('9. import a UTF-16LE, tab-separated Meta CSV');
  const rows = [
    ['id', 'created_time', 'ad_id', 'ad_name', 'adset_name', 'campaign_name', 'form_name', 'is_organic', 'platform', 'which_service_are_you_interested_in?', 'full_name', 'phone_number', 'lead_status'],
    ['l:777001', `${yesterday} 10:30:00`, 'ag:120200001', 'PPF video', 'Dubai 25-55', 'PPF October', 'PPF quote', 'false', 'ig', 'Ceramic coating', 'Ali Khan', 'p:+971501119988', 'CREATED'],
    ['l:777002', `${today} 10:15:00`, 'ag:120200001', 'PPF video', 'Dubai 25-55', 'PPF October', 'PPF quote', 'false', 'fb', 'Full body PPF', 'Sara Ahmed', 'p:+971558765439', 'CREATED'],
  ];
  const csvPath = path.join(tmp, 'Meta leads.csv');
  fs.writeFileSync(csvPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rows.map((r) => r.join('\t')).join('\r\n') + '\r\n', 'utf16le')]));
  await tab('setup');
  await page.setInputFiles('[data-form="import"] input[type="file"]', csvPath);
  await waitFor(async () => /2 rows found/.test(await page.locator('[data-import-info]').textContent()), 'rows found');
  await page.click('[data-form="import"] button.primary');
  await waitFor(async () => (await toastText()).includes('Import done: added 2 · duplicates 1 · skipped 0'), 'import toast');
  const ali = leadNamed('Ali Khan');
  assert.equal(ali.source, 'import');
  assert.equal(ali.phone, '971501119988');
  assert.equal(ali.createdAt, dubaiTs(yesterday, '10:30'));
  assert.equal(leadNamed('Sara Ahmed').status, 'dup');
  assert.equal(leadNamed('Sara Ahmed').dupOf, saraId);

  /* 10. Search by a local number */
  step('10. search by phone in local format');
  await page.fill('[data-search]', '050 111 9988');
  await waitFor(async () => /^1 lead match/.test(await page.locator('.list-note').textContent()), 'search result');
  assert.equal(await cards().count(), 1);
  assert.equal(await cardOf('Ali Khan').count(), 1);
  await page.fill('[data-search]', '0558765439');
  await waitFor(async () => /^2 leads match/.test(await page.locator('.list-note').textContent()), 'original and duplicate');
  assert.equal(await cardOf('SARA AHMED').count(), 1);
  await page.fill('[data-search]', '');

  /* 11. Report */
  step('11. report for Glossy PPF');
  await tab('report');
  await page.selectOption('[data-report="client"]', client.id);
  await waitFor(async () => (await page.inputValue('[data-report-text]')).startsWith('Glossy PPF · '), 'report for the client');
  const tiles = Object.fromEntries(await page.$$eval('.tile', (els) => els.map((e) => [e.querySelector('span').textContent.split(' · ')[0], e.querySelector('b').textContent])));
  // Sara (booked), John (booked, showed up) and Ali (imported, not contacted yet). The duplicate row isn't counted.
  assert.equal(tiles['Leads received'], '3', JSON.stringify(tiles));
  assert.equal(tiles['Replied'], '2', JSON.stringify(tiles));
  assert.equal(tiles['Booked'], '2', JSON.stringify(tiles));
  assert.equal(tiles['Showed up'], '1', JSON.stringify(tiles));
  const reportText = await page.inputValue('[data-report-text]');
  for (const s of ['3 leads from your ads', '2 replied (67%)', '2 booked', '1 showed up']) assert.ok(reportText.split('\n').includes(s), `report has "${s}":\n${reportText}`);
  assert.ok(!/undefined|null|NaN|\{\{/.test(reportText), reportText);
  const reportLink = await page.getAttribute('a[data-act="report-send"]', 'href');
  assert.ok(reportLink.startsWith('https://web.whatsapp.com/send?phone=971501112222&text='), reportLink);
  assert.equal(new URL(reportLink).searchParams.get('text'), reportText);

  /* 12. Landline */
  step('12. a landline lead gets Call, not WhatsApp');
  await tab('setup');
  const add = page.locator('[data-form="add-lead"]');
  await add.locator('[name="name"]').fill('Fatima Noor');
  await add.locator('[name="phone"]').fill('04 345 6789');
  await add.locator('[name="service"]').fill('Window tint');
  await add.locator('button.primary').click();
  await waitFor(async () => (await cardOf('Fatima Noor').count()) === 1, 'manual lead opens in To do');
  const fatima = cardOf('Fatima Noor');
  const fatimaText = await fatima.innerText();
  for (const s of ['+971 4 345 6789', 'Landline: call instead', 'Manual']) assert.ok(fatimaText.includes(s), `card shows ${s}:\n${fatimaText}`);
  assert.equal(await fatima.locator('a[data-act="send"]').getAttribute('href'), 'tel:+97143456789');
  assert.equal((await fatima.locator('a[data-act="send"]').innerText()).trim(), 'Call');
  assert.equal(await fatima.locator('a[href*="whatsapp"], a[href*="wa.me"]').count(), 0, 'no WhatsApp link for a landline');

  /* 13. Phone and computer layouts */
  step('13. layout on a computer (1440×900) and a phone (390×844), with screenshots');
  // Full-page shots draw the sticky header and the toast where the viewport is, so start at the top.
  const shot = async (p, name, fullPage = true) => {
    if (!SHOTS) return;
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
  };
  const openEditor = async (p) => {
    const row = p.locator(`[data-act="edit-client"][data-cid="${client.id}"]`);
    // The editor stays open after saving; clicking the client again would close it.
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
    await p.waitForSelector('[data-intake-link]');
  };
  await page.waitForSelector('[data-toast]', { state: 'hidden' });
  for (const t of ['todo', 'booked', 'report']) {
    await tab(t);
    await shot(page, `desktop-${t}`);
  }
  await tab('setup');
  await openEditor(page);
  // Side-by-side fields line up even when only one of them has a hint underneath.
  const [nameBox, waBox] = await Promise.all(['contactName', 'contactWa'].map((n) => page.locator(`[data-form="client"] [name="${n}"]`).boundingBox()));
  assert.deepEqual([nameBox.y, nameBox.height], [waBox.y, waBox.height], 'contact fields line up');
  await shot(page, 'desktop-setup');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  phone.on('page', watch);
  const m = await phone.newPage();
  await m.goto(`${ORIGIN}/desk#k=${encodeURIComponent(KEY)}`);
  await m.waitForSelector('[data-main] article.card');
  const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await cards(m).count(), 2, 'Ali and Fatima are to do');
  assert.match(await cardOf('Ali Khan', m).locator('a[data-act="send"]').getAttribute('href'), /^https:\/\/wa\.me\/971501119988\?text=Hi%20Ali/, 'phones open the WhatsApp app');
  assert.equal(await overflow(), 0, 'no sideways scrolling on To do');
  await shot(m, 'phone-todo', false);
  await shot(m, 'phone-todo-full');
  await tab('setup', m);
  await openEditor(m);
  assert.equal(await overflow(), 0, 'no sideways scrolling on Setup');
  await shot(m, 'phone-setup', false);
  await shot(m, 'phone-setup-full');
  for (const t of ['booked', 'report']) {
    await tab(t, m);
    assert.equal(await overflow(), 0, `no sideways scrolling on ${t}`);
    await shot(m, `phone-${t}-full`);
  }
  await phone.close();

  /* 14. No console errors */
  step('14. no console errors');
  assert.deepEqual(browserHits, [], 'the page never calls ntfy or Telegram itself');
  assert.deepEqual(errors, [], 'console errors:\n' + errors.join('\n'));

  console.log('DESK E2E PASSED:', leadsNow().length, 'leads,', alerts.length, 'alerts');
  await browser.close();
  mux.close();
  process.exit(0);
} catch (e) {
  await fail(e);
}
