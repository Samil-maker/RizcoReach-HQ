// Runs the Apps Script code in Node against an in-memory Google Sheet and
// mocked Google Places / HERE / People APIs.  Usage: node lead-engine/test/run-tests.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

// ─── Fake Apps Script services ───────────────────────────────────────────────

/** Any method you don't define returns the same chainable stub (formatting calls etc.). */
function chain(target = {}) {
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = []; // cells[r][c], 0-based
    this.maxRows = 1000;
    this.validations = {};
    this.self = chain(this);
    return this.self;
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if ((this.cells[r] || []).some((v) => v !== '' && v != null)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) => row && row.forEach((v, c) => { if (v !== '' && v != null) max = Math.max(max, c + 1); }));
    return max;
  }
  get(r, c) { return (this.cells[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) {
    if (r > this.maxRows) throw new Error(`Row ${r} is outside the sheet (${this.maxRows} rows)`);
    this.cells[r - 1] = this.cells[r - 1] || [];
    this.cells[r - 1][c - 1] = v;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (typeof row === 'string') throw new Error('A1 notation not supported in fake');
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Bad range ${row},${col},${numRows},${numCols}`);
    if (row + numRows - 1 > this.maxRows) throw new Error(`Range ends at row ${row + numRows - 1}, sheet has ${this.maxRows}`);
    const sheet = this;
    const range = chain({
      getSheet: () => sheet.self,
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => sheet.get(row + i, col + j))),
      getValue: () => sheet.get(row, col),
      setValues(values) {
        assert.equal(values.length, numRows, 'setValues row count');
        values.forEach((r, i) => {
          assert.equal(r.length, numCols, 'setValues column count');
          r.forEach((v, j) => sheet.set(row + i, col + j, v));
        });
        return range;
      },
      setValue(v) { sheet.set(row, col, v); return range; },
      setDataValidation(rule) { sheet.validations[`${row}:${col}:${numRows}`] = rule; return range; },
    });
    return range;
  }
}

function makeEnv() {
  const sheets = new Map();
  const triggers = [];
  const props = new Map();
  const alerts = [];
  const fetches = [];
  const people = { created: [], groups: [], members: [] };
  let fetchHandler = () => { throw new Error('unexpected fetch'); };

  const spreadsheet = chain({
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.getName()),
    toast: (msg) => alerts.push(msg),
  });

  const ctx = {
    console,
    SpreadsheetApp: chain({
      getActive: () => spreadsheet,
      flush: () => {},
      newDataValidation: () => chain({ build: () => ({ rule: true }) }),
      getUi: () => chain({ alert: (_t, msg) => alerts.push(msg), ButtonSet: { OK: 'OK' } }),
    }),
    UrlFetchApp: {
      fetch(url, opts) {
        fetches.push({ url, opts });
        const { code = 200, body } = fetchHandler(url, opts);
        return { getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) };
      },
    },
    Utilities: {
      sleep: () => {},
      formatDate(d, tz, pattern) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(d)
            .map((p) => [p.type, p.value])
        );
        if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
        if (pattern === 'yyyy-MM') return `${parts.year}-${parts.month}`;
        throw new Error('pattern ' + pattern);
      },
    },
    Session: { getScriptTimeZone: () => 'Asia/Dubai' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    CacheService: { getScriptCache: () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, put: (k, v) => m.set(k, v) }; } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(handler) {
        const t = { handler, getHandlerFunction: () => handler };
        const b = chain({ create: () => { triggers.push(t); return t; } });
        return b;
      },
    },
    HtmlService: chain(),
    Logger: { log: () => {} },
    People: {
      People: {
        batchCreateContacts(req) {
          assert.ok(req.readMask, 'readMask required');
          assert.ok(req.contacts.length <= 200, 'max 200 per batch');
          return {
            createdPeople: req.contacts.map(({ contactPerson }) => {
              const resourceName = 'people/c' + (people.created.length + 1);
              people.created.push(Object.assign({ resourceName }, contactPerson));
              return { person: { resourceName, phoneNumbers: contactPerson.phoneNumbers.map((p) => ({ value: p.value, canonicalForm: p.value })) } };
            }),
          };
        },
      },
      ContactGroups: {
        list: () => ({ contactGroups: [{ resourceName: 'contactGroups/myContacts', name: 'myContacts', groupType: 'SYSTEM_CONTACT_GROUP' }, ...people.groups] }),
        create: ({ contactGroup }) => {
          const g = { resourceName: 'contactGroups/g' + (people.groups.length + 1), name: contactGroup.name, groupType: 'USER_CONTACT_GROUP' };
          people.groups.push(g);
          return g;
        },
        Members: { modify: (body, group) => people.members.push({ group, names: body.resourceNamesToAdd }) },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  return {
    ctx, sheets, triggers, props, alerts, fetches, people,
    onFetch: (fn) => { fetchHandler = fn; },
    sheet: (n) => sheets.get(n),
  };
}

const settingsSet = (env, label, value) => {
  const sh = env.sheet('Settings');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.get(r, 1) === label) return sh.set(r, 2, value);
  throw new Error('no setting ' + label);
};
const rows = (sh) => sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

// ─── Tests ───────────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok  ', name);
  } catch (err) {
    console.error('FAIL', name);
    console.error(err);
    process.exitCode = 1;
  }
}

test('phone numbers: UAE formats, types and other countries', () => {
  const { ctx } = makeEnv();
  const n = (v, c = 'AE') => {
    const p = ctx.normalizePhone_(v, c);
    return p && `${p.e164} ${p.type}`;
  };
  assert.equal(n('+971 50 123 4567'), '+971501234567 mobile');
  assert.equal(n('050 123 4567'), '+971501234567 mobile');
  assert.equal(n('050-123-4567'), '+971501234567 mobile');
  assert.equal(n('00971 55 123 4567'), '+971551234567 mobile');
  assert.equal(n('971501234567'), '+971501234567 mobile');
  assert.equal(n(501234567), '+971501234567 mobile'); // number cell that lost its leading 0
  assert.equal(n('+971 (0)50 123 4567'), '+971501234567 mobile');
  assert.equal(n('04 123 4567'), '+97141234567 landline');
  assert.equal(n('+971 4 123 4567'), '+97141234567 landline');
  assert.equal(n('600 52 2222'), '+971600522222 landline');
  assert.equal(n('800 1234'), null);
  assert.equal(n('+966 50 123 4567'), '+966501234567 mobile');
  assert.equal(n('+974 3312 3456'), '+97433123456 mobile');
  assert.equal(n('+44 7911 123456'), '+447911123456 mobile');
  assert.equal(n('+44 20 7946 0958'), '+442079460958 landline');
  assert.equal(n('+91 98765 43210'), '+919876543210 mobile');
  assert.equal(n('9876543210', 'IN'), '+919876543210 mobile');
  assert.equal(n('+1 415 555 0100'), '+14155550100 unknown');
  assert.equal(n('+7 912 345 67 89'), '+79123456789 unknown');
  assert.equal(n('050 123 4567 ext. 12'), '+971501234567 mobile');
  assert.equal(n(''), null);
  assert.equal(n('n/a'), null);
  assert.equal(n('0501234567', 'ZZ'), null);
});

test('pickPhone_ prefers a mobile and respects mobile-only', () => {
  const { ctx } = makeEnv();
  assert.equal(ctx.pickPhone_(['04 123 4567 / 050 765 4321'], { country: 'AE', mobileOnly: true }).e164, '+971507654321');
  assert.equal(ctx.pickPhone_(['04 123 4567'], { country: 'AE', mobileOnly: true }), null);
  assert.equal(ctx.pickPhone_(['04 123 4567'], { country: 'AE', mobileOnly: false }).e164, '+97141234567');
  assert.equal(ctx.pickPhone_([], { country: 'AE', mobileOnly: true }), null);
});

test('website detection treats social and booking pages as no website', () => {
  const { ctx } = makeEnv();
  assert.equal(ctx.hasRealWebsite_([], true), false);
  assert.equal(ctx.hasRealWebsite_([''], true), false);
  assert.equal(ctx.hasRealWebsite_(['https://www.instagram.com/noor.salon/'], true), false);
  assert.equal(ctx.hasRealWebsite_(['https://www.instagram.com/noor.salon/'], false), true);
  assert.equal(ctx.hasRealWebsite_(['https://noor-salon.business.site/'], true), false);
  assert.equal(ctx.hasRealWebsite_(['https://www.fresha.com/a/noor-salon'], true), false);
  assert.equal(ctx.hasRealWebsite_(['wa.me/971501234567'], true), false);
  assert.equal(ctx.hasRealWebsite_(['http://www.noorsalon.ae'], true), true);
  assert.equal(ctx.hasRealWebsite_(['noorsalon.com'], true), true);
  assert.equal(ctx.hasRealWebsite_(['https://mysite.com/instagram.com'], true), true);
  assert.equal(ctx.hasRealWebsite_(['N/A'], true), false);
});

test('WhatsApp message and link', () => {
  const { ctx } = makeEnv();
  const msg = ctx.fillMessage_('Hi {name} in {area} ({keyword}) {unknown}', { name: 'Noor Salon | Best Salon Dubai', area: 'Al Barsha', keyword: 'ladies salon' });
  assert.equal(msg, 'Hi Noor Salon in Al Barsha (ladies salon) {unknown}');
  assert.match(ctx.fillMessage_('', { name: '' }), /came across your business online/);
  assert.equal(ctx.whatsAppUrl_('+971501234567', 'Hi & bye'), 'https://wa.me/971501234567?text=Hi%20%26%20bye');
  assert.equal(ctx.hyperlink_('https://x.com/?q="a"', 'Chat'), '=HYPERLINK("https://x.com/?q=""a""","Chat")');
});

test('setup builds the tabs and settings', () => {
  const env = makeEnv();
  env.ctx.setup();
  assert.deepEqual([...env.sheets.keys()].sort(), ['Import', 'Leads', 'Searches', 'Settings']);
  assert.equal(env.sheet('Leads').get(1, 1), 'Mobile');
  assert.equal(env.sheet('Searches').getLastRow(), 7); // header + 6 examples
  const s = env.ctx.getSettings_();
  assert.equal(s.country, 'AE');
  assert.equal(s.mobileOnly, true);
  assert.equal(s.googleMonthlyCap, 1000);
  assert.equal(s.contactPrefix, 'Lead -');
  // Running setup again doesn't duplicate anything.
  env.ctx.setup();
  assert.equal(env.sheet('Settings').getLastRow(), 13);
  assert.equal(env.sheet('Searches').getLastRow(), 7);
  // Empty values fall back to defaults except where empty means "none".
  settingsSet(env, 'Max Google requests per month', '');
  settingsSet(env, 'Contact name prefix', '');
  settingsSet(env, 'Keep mobile numbers only', 'NO');
  const s2 = env.ctx.getSettings_();
  assert.equal(s2.googleMonthlyCap, 1000);
  assert.equal(s2.contactPrefix, '');
  assert.equal(s2.mobileOnly, false);
});

const googlePlace = (name, phone, extra = {}) => ({
  displayName: { text: name, languageCode: 'en' },
  internationalPhoneNumber: phone,
  googleMapsUri: 'https://maps.google.com/?cid=' + name.length,
  formattedAddress: 'Al Barsha 1, Dubai',
  primaryTypeDisplayName: { text: 'Beauty salon' },
  businessStatus: 'OPERATIONAL',
  ...extra,
});

function googleFixture(env) {
  const pages = {
    '': {
      places: [
        googlePlace('Noor Ladies Salon', '+971 50 111 1111'),
        googlePlace('Has Website Salon', '+971 50 222 2222', { websiteUri: 'https://hassite.ae/' }),
        googlePlace('Insta Only Salon', '+971 55 333 3333', { websiteUri: 'https://instagram.com/insta' }),
        googlePlace('Landline Salon', '+971 4 444 4444'),
        googlePlace('Closed Salon', '+971 50 555 5555', { businessStatus: 'CLOSED_PERMANENTLY' }),
        googlePlace('No Phone Salon', undefined),
      ],
      nextPageToken: 'page2',
    },
    page2: { places: [googlePlace('Second Page Salon', '+971 56 666 6666'), googlePlace('Noor Ladies Salon Branch', '+971501111111')] },
  };
  env.onFetch((url, opts) => {
    assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(opts.method, 'post');
    assert.equal(opts.headers['X-Goog-Api-Key'], 'test-key');
    assert.match(opts.headers['X-Goog-FieldMask'], /places\.websiteUri/);
    assert.match(opts.headers['X-Goog-FieldMask'], /nextPageToken/);
    const body = JSON.parse(opts.payload);
    assert.equal(body.textQuery, 'ladies salon in Al Barsha, Dubai');
    assert.equal(body.regionCode, 'AE');
    return { body: pages[body.pageToken || ''] };
  });
}

function oneSearch(env, keyword = 'ladies salon', location = 'Al Barsha, Dubai', sources = 'Google Maps') {
  const sh = env.sheet('Searches');
  for (let r = sh.getLastRow(); r >= 2; r--) for (let c = 1; c <= 7; c++) sh.set(r, c, '');
  sh.getRange(2, 1, 1, 4).setValues([[keyword, location, sources, false]]);
}

test('Google search → Leads, deduped, then Contacts', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'Google Places API key', 'test-key');
  oneSearch(env);
  googleFixture(env);
  env.ctx.runSearches();

  const leads = rows(env.sheet('Leads'));
  assert.deepEqual(leads.map((r) => r[0]), ['+971501111111', '+971553333333', '+971566666666']);
  assert.deepEqual(leads.map((r) => r[1]), ['Noor Ladies Salon', 'Insta Only Salon', 'Second Page Salon']);
  assert.equal(leads[0][4], 'Google Maps');
  assert.equal(leads[0][6], 'ladies salon · Al Barsha, Dubai');
  assert.match(leads[0][9], /^=HYPERLINK\("https:\/\/wa\.me\/971501111111\?text=Hi%20/);
  assert.equal(leads[0][10], 'New');
  assert.deepEqual(leads.map((r) => r[8]), ['Yes', 'Yes', 'Yes'], 'auto-synced to Contacts');

  const search = env.sheet('Searches');
  assert.equal(search.get(2, 5), 'Done');
  assert.equal(search.get(2, 7), '8 found · 1 closed · 1 have a website · 2 no mobile · 1 already saved · 3 new');
  assert.equal(env.ctx.googleCount_(), 2);

  assert.equal(env.people.created.length, 3);
  assert.equal(env.people.created[0].names[0].givenName, 'Lead - Noor Ladies Salon');
  assert.equal(env.people.created[0].phoneNumbers[0].value, '+971501111111');
  assert.equal(env.people.groups.length, 1);
  assert.equal(env.people.groups[0].name, 'RizcoReach Leads');
  assert.deepEqual([...env.people.members[0].names], ['people/c1', 'people/c2', 'people/c3']);
  assert.match(env.alerts.at(-1), /Ran 1 search\(es\): 3 new lead\(s\)\. 3 copied to Google Contacts\. Google requests this month: 2 \/ 1000\./);

  // A second run does nothing (row is Done)...
  env.ctx.runSearches();
  assert.equal(env.sheet('Leads').getLastRow(), 4);
  assert.match(env.alerts.at(-1), /Nothing to run/);
  // ...and re-running the row finds no new leads.
  search.set(2, 5, '');
  env.ctx.runSearches();
  assert.equal(env.sheet('Leads').getLastRow(), 4);
  assert.match(search.get(2, 7), /4 already saved · 0 new$/);
  assert.equal(env.people.created.length, 3, 'no duplicate contacts');
});

test('monthly Google cap pauses searches', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'Google Places API key', 'test-key');
  settingsSet(env, 'Max Google requests per month', 1);
  oneSearch(env);
  googleFixture(env);
  env.ctx.runSearches();
  assert.equal(env.fetches.length, 1, 'stopped after the first page');
  assert.equal(env.sheet('Searches').get(2, 5), 'Paused');
  assert.match(env.sheet('Searches').get(2, 7), /Google monthly cap reached/);
});

test('API errors show on the search row', () => {
  const env = makeEnv();
  env.ctx.setup();
  oneSearch(env);
  env.ctx.runSearches();
  assert.equal(env.sheet('Searches').get(2, 5), 'Error');
  assert.match(env.sheet('Searches').get(2, 7), /Google Places API key/);

  settingsSet(env, 'Google Places API key', 'test-key');
  env.onFetch(() => ({ code: 403, body: { error: { code: 403, message: 'Places API (New) has not been used in project 123 before or it is disabled.' } } }));
  env.ctx.runSearches(); // Error rows are retried
  assert.match(env.sheet('Searches').get(2, 7), /^Google Places error 403: Places API \(New\) has not been used/);
});

test('HERE search uses mobile contacts and geocodes the area', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'HERE API key (optional)', 'here-key');
  settingsSet(env, 'Add new leads to Google Contacts automatically', 'NO');
  oneSearch(env, 'barber', 'Deira, Dubai', 'HERE');
  env.onFetch((url) => {
    if (url.startsWith('https://geocode.search.hereapi.com/v1/geocode?')) {
      assert.match(url, /q=Deira%2C%20Dubai/);
      return { body: { items: [{ title: 'Deira, Dubai', position: { lat: 25.27, lng: 55.32 } }] } };
    }
    assert.match(url, /^https:\/\/discover\.search\.hereapi\.com\/v1\/discover\?q=barber&at=25\.27%2C55\.32&limit=100&lang=en&apiKey=here-key$/);
    return {
      body: {
        items: [
          { title: 'Classic Barber', resultType: 'place', address: { label: 'Classic Barber, Deira, Dubai' }, categories: [{ name: 'Barber', primary: true }],
            contacts: [{ phone: [{ value: '+97142222222' }], mobile: [{ value: '+971509999999' }] }] },
          { title: 'Web Barber', resultType: 'place', contacts: [{ mobile: [{ value: '+971508888888' }], www: [{ value: 'https://webbarber.ae' }] }] },
          { title: 'Deira', resultType: 'locality' },
        ],
      },
    };
  });
  env.ctx.runSearches();
  const leads = rows(env.sheet('Leads'));
  assert.equal(leads.length, 1);
  assert.equal(leads[0][0], '+971509999999');
  assert.equal(leads[0][1], 'Classic Barber');
  assert.equal(leads[0][2], 'Barber');
  assert.equal(leads[0][4], 'HERE');
  assert.equal(leads[0][8], '', 'auto-sync off');
  assert.equal(env.people.created.length, 0);
});

test('Import tab: detects columns, filters, dedupes, records results', () => {
  const env = makeEnv();
  env.ctx.setup();
  const imp = env.sheet('Import');
  const data = [
    ['title', 'categoryName', 'address', 'phone', 'website', 'url'],
    ['Alpha Garage', 'Car repair', 'Al Quoz', '+971 50 123 0001', '', 'https://maps.google.com/?cid=1'],
    ['Beta Garage', 'Car repair', 'Al Quoz', '04 321 0000', '', ''],
    ['Gamma Garage', 'Car repair', 'Al Quoz', '055 123 0003', 'https://gamma.ae', ''],
    ['Delta Garage', 'Car repair', 'Al Quoz', 971501230004, 'https://facebook.com/delta', ''],
    ['Alpha Again', 'Car repair', 'Al Quoz', '0501230001', '', ''],
    ['No Phone', '', '', '', '', ''],
  ];
  data.forEach((r, i) => r.forEach((v, j) => imp.set(i + 1, j + 1, v)));
  env.ctx.processImport();

  assert.equal(imp.get(1, 7), 'Lead Engine result');
  assert.deepEqual([2, 3, 4, 5, 6, 7].map((r) => imp.get(r, 7)), [
    'Added', 'Skipped: not a mobile', 'Skipped: has a website', 'Added', 'Already in Leads', 'Skipped: no phone',
  ]);
  const leads = rows(env.sheet('Leads'));
  assert.deepEqual(leads.map((r) => [r[0], r[1], r[2], r[4], r[6]]), [
    ['+971501230001', 'Alpha Garage', 'Car repair', 'Import', 'Import'],
    ['+971501230004', 'Delta Garage', 'Car repair', 'Import', 'Import'],
  ]);
  assert.match(leads[0][5], /^=HYPERLINK\("https:\/\/maps\.google\.com/);
  assert.match(env.alerts.at(-1), /^Import done: 2 × Added/);

  // Processing again skips rows that already have a result.
  env.ctx.processImport();
  assert.equal(env.sheet('Leads').getLastRow(), 3);
});

test('outreach panel queue, marking and daily count', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'Google Places API key', 'test-key');
  settingsSet(env, 'WhatsApp message', 'Hi {name} in {area}!');
  oneSearch(env);
  googleFixture(env);
  env.ctx.runSearches();

  let d = env.ctx.outreachNext([]);
  assert.equal(d.queue, 3);
  assert.equal(d.sentToday, 0);
  assert.equal(d.limit, 30);
  assert.deepEqual({ ...d.lead }, { mobile: '+971501111111', name: 'Noor Ladies Salon', category: 'Beauty salon', area: 'Al Barsha, Dubai', message: 'Hi Noor Ladies Salon in Al Barsha, Dubai!' });

  d = env.ctx.outreachNext(['+971501111111']);
  assert.equal(d.lead.mobile, '+971553333333', 'skip moves on');

  d = env.ctx.outreachMark('+971501111111', 'Messaged', []);
  assert.equal(d.sentToday, 1);
  assert.equal(d.queue, 2);
  assert.equal(d.lead.mobile, '+971553333333');
  const lead = rows(env.sheet('Leads'))[0];
  assert.equal(lead[10], 'Messaged');
  assert.ok(env.ctx.isDate_(lead[11]));

  d = env.ctx.outreachMark('+971553333333', 'Do not contact', []);
  assert.equal(d.sentToday, 1);
  assert.equal(d.lead.mobile, '+971566666666');
  assert.throws(() => env.ctx.outreachMark('+971566666666', 'Bogus', []));
  assert.doesNotThrow(() => JSON.stringify(d), 'panel data must be plain JSON');
});

test('refreshWhatsAppLinks uses the edited message', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'Google Places API key', 'test-key');
  oneSearch(env);
  googleFixture(env);
  env.ctx.runSearches();
  settingsSet(env, 'WhatsApp message', 'Salam {name}');
  env.ctx.refreshWhatsAppLinks();
  assert.equal(env.sheet('Leads').get(2, 10), '=HYPERLINK("https://wa.me/971501111111?text=Salam%20Noor%20Ladies%20Salon","Chat")');
});

test('onEdit stamps Last contacted when status set to Messaged', () => {
  const env = makeEnv();
  env.ctx.setup();
  const leads = env.sheet('Leads');
  leads.set(2, 1, '+971501111111');
  leads.set(2, 11, 'Messaged');
  env.ctx.onEdit({ range: leads.getRange(2, 11) });
  assert.ok(env.ctx.isDate_(leads.get(2, 12)));
  leads.set(3, 1, '+971502222222');
  leads.set(3, 11, 'Replied');
  env.ctx.onEdit({ range: leads.getRange(3, 11) });
  assert.equal(leads.get(3, 12), '');
});

test('runs out of time → schedules a continuation', () => {
  const env = makeEnv();
  env.ctx.setup();
  settingsSet(env, 'Google Places API key', 'test-key');
  googleFixture(env);
  oneSearch(env);
  vm.runInContext('Date.now = (() => { let t = 0; return () => (t += 5 * 60 * 1000); })();', env.ctx);
  env.ctx.runSearches();
  assert.equal(env.triggers.filter((t) => t.handler === 'continueSearches').length, 1);
  assert.match(env.alerts.at(-1), /continuing automatically/);
});

test('appending past the end of the sheet adds rows', () => {
  const env = makeEnv();
  env.ctx.setup();
  env.sheet('Leads').maxRows = 3;
  const s = env.ctx.getSettings_();
  const lead = (m) => env.ctx.leadRow_({ mobile: m, name: 'X', search: 'x' }, s);
  env.ctx.appendLeads_([lead('+971500000001'), lead('+971500000002'), lead('+971500000003'), lead('+971500000004')]);
  assert.equal(env.sheet('Leads').getLastRow(), 5);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
