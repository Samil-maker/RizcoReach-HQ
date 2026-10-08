// End-to-end test: loads the real extension into Chromium, serves test/fake-maps.html
// at a Google Maps URL, and drives the side panel like a user would.
// Usage: node lead-finder-extension/test/e2e.mjs   (needs Playwright + Chromium)
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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
const FAKE_MAPS = readFileSync(new URL('./fake-maps.html', import.meta.url), 'utf8');
const SHOTS = process.env.SHOTS_DIR || '';

const ctx = await playwright.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lf-')), {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  await ctx.route('https://www.google.com/maps**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_MAPS }));
  await ctx.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>WhatsApp Web</h1>' }));

  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker');
  const extId = worker.url().split('/')[2];

  const maps = await ctx.newPage();
  await maps.goto('https://www.google.com/maps/search/ladies+salon+in+al+barsha/');

  const panel = await ctx.newPage();
  panel.on('pageerror', (e) => console.error('panel error:', e));
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);

  // Ready state shows the current Maps search.
  await panel.waitForSelector('#ready:not([hidden])');
  assert.equal(await panel.textContent('#query'), 'ladies salon in al barsha');
  assert.match(await panel.textContent('#empty'), /No leads yet/);
  if (SHOTS) await panel.screenshot({ path: join(SHOTS, 'panel-ready.png'), fullPage: true });

  // Collect: the panel tells the Maps tab to go through every result.
  await panel.click('#collectBtn');
  await maps.bringToFront(); // like a real user watching Maps next to the panel
  await panel.waitForSelector('#running:not([hidden])', { timeout: 10000 });
  await panel.waitForSelector('#summary:not([hidden])', { timeout: 120000 });
  const summary = (await panel.textContent('#summary')).replace(/\s+/g, ' ');
  console.log('summary:', summary);
  assert.equal(
    summary,
    'Done. "ladies salon in al barsha": 6 new leads · 12 checked · 1 closed · 2 have a website · 2 no mobile · 1 already saved'
  );
  assert.equal(await panel.isHidden('#error'), true, 'no error shown');

  const names = await panel.$$eval('#list .lead-name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names.sort(), ['Al Reem Salon', 'Fresha Booking Salon', 'Glow Beauty Lounge', 'Insta Only Salon', 'Last Salon', 'Noor Ladies Salon']);
  assert.equal(await panel.textContent('[data-filter="New"] span'), '6');
  assert.match(await panel.textContent('#list'), /\+971 50 111 1111 · Beauty salon/);
  if (SHOTS) {
    await panel.bringToFront();
    await panel.screenshot({ path: join(SHOTS, 'panel-leads.png'), fullPage: true });
  }

  // Running it again on the same search adds nothing new.
  await panel.click('#collectBtn');
  await maps.bringToFront();
  await panel.waitForFunction(() => /0 new leads/.test(document.querySelector('#summary').textContent), null, { timeout: 120000 });
  assert.match(await panel.textContent('#summary'), /^Done\. "ladies salon in al barsha": 0 new leads · 12 checked · .* 7 already saved$/);
  // The Maps address now points at the last business opened, but the panel still names the search.
  await panel.bringToFront();
  await panel.waitForFunction(() => document.querySelector('#query').textContent === 'ladies salon in al barsha');

  // WhatsApp: opens WhatsApp Web with the message typed, and marks the lead Messaged.
  // (WhatsApp Web itself can't load in the test sandbox, so record the links the panel opens.)
  await panel.bringToFront();
  await panel.evaluate(() => {
    window.__opened = [];
    ['create', 'update'].forEach((fn) => {
      const original = chrome.tabs[fn].bind(chrome.tabs);
      chrome.tabs[fn] = (...args) => {
        const props = fn === 'create' ? args[0] : args[1];
        if (props && props.url) window.__opened.push(fn + ' ' + props.url);
        return original(...args);
      };
    });
  });
  const opened = () => panel.evaluate(() => window.__opened.slice());
  await panel.locator('.lead', { hasText: 'Noor Ladies Salon' }).locator('.wa').click();
  await panel.waitForFunction(() => window.__opened.length === 1);
  const [how, first] = (await opened())[0].split(' ');
  assert.equal(how, 'create');
  const waUrl = new URL(first);
  assert.equal(waUrl.origin + waUrl.pathname, 'https://web.whatsapp.com/send');
  assert.equal(waUrl.searchParams.get('phone'), '971501111111');
  assert.match(waUrl.searchParams.get('text'), /^Hi 👋 We came across Noor Ladies Salon on Google Maps/);
  await panel.bringToFront();
  await panel.waitForFunction(() => document.querySelector('[data-filter="Messaged"] span').textContent === '1');
  assert.match(await panel.textContent('#today'), /Today: 1 \/ 30 chats/);

  // A second chat reuses the same WhatsApp tab.
  await panel.locator('.lead', { hasText: 'Glow Beauty Lounge' }).locator('.wa').click();
  await panel.waitForFunction(() => window.__opened.length === 2);
  assert.match((await opened())[1], /^update https:\/\/web\.whatsapp\.com\/send\?phone=971567777777&text=/);
  assert.equal((await opened()).filter((o) => o.startsWith('create ')).length, 1, 'no extra tab');

  // Google Contacts file.
  await panel.bringToFront();
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.click('#contactsBtn')]);
  const csv = readFileSync(await download.path(), 'utf8');
  const lines = csv.trim().split(/\r\n/);
  assert.equal(lines[0], 'Name,Given Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Notes,Group Membership');
  assert.ok(csv.includes('Lead - Noor Ladies Salon,Lead - Noor Ladies Salon,Noor Ladies Salon,Mobile,+971501111111,'));
  assert.ok(csv.includes('RizcoReach Leads ::: * myContacts'));
  assert.match(await panel.textContent('#saveHint'), /Saved 6 new lead\(s\)/);
  // Next download: nothing new, so it saves everything again.
  const [download2] = await Promise.all([panel.waitForEvent('download'), panel.click('#contactsBtn')]);
  assert.ok(readFileSync(await download2.path(), 'utf8').includes('+971509999999'));
  assert.match(await panel.textContent('#saveHint'), /No new leads since last time/);

  // Status change from the dropdown.
  await panel.click('[data-filter="All"]');
  await panel.locator('.lead', { hasText: 'Al Reem Salon' }).locator('select').selectOption('Do not contact');
  await panel.click('[data-filter="New"]');
  await panel.waitForFunction(() => document.querySelector('[data-filter="New"] span').textContent === '3');

  // Settings persist and change the message.
  await panel.click('#settingsBox summary');
  await panel.fill('#set-message', 'Salam {name}!');
  await panel.waitForTimeout(600);
  await panel.locator('.lead', { hasText: 'Last Salon' }).locator('.wa').click();
  await panel.waitForFunction(() => window.__opened.length === 3);
  assert.equal(new URL((await opened())[2].split(' ')[1]).searchParams.get('text'), 'Salam Last Salon!');
  await panel.bringToFront();

  // Delete all needs two clicks.
  await panel.click('#deleteAll');
  assert.match(await panel.textContent('#deleteAll'), /Click again to delete 6 leads/);
  await panel.click('#deleteAll');
  await panel.waitForSelector('#empty:not([hidden])');
  assert.match(await panel.textContent('#empty'), /No leads yet/);

  // Dark mode screenshot of the ready state.
  if (SHOTS) {
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.screenshot({ path: join(SHOTS, 'panel-dark.png'), fullPage: true });
  }
  console.log('e2e: all checks passed');
} finally {
  await ctx.close();
}
