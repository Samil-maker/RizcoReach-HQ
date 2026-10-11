/**
 * RizcoReach Lead Engine
 * ----------------------
 * Finds businesses that have no website, keeps only their mobile numbers,
 * saves them to the "Leads" tab, copies them to Google Contacts and gives you
 * a WhatsApp outreach panel.
 *
 * Runs inside a Google Sheet (Extensions → Apps Script).
 * Setup guide: lead-engine/README.md in the RizcoReach-HQ repo.
 */

// ─── Layout ──────────────────────────────────────────────────────────────────

const SHEET = { leads: 'Leads', searches: 'Searches', importer: 'Import', settings: 'Settings' };

const LEAD_COLUMNS = [
  { key: 'mobile', header: 'Mobile', width: 140 },
  { key: 'name', header: 'Business', width: 220 },
  { key: 'category', header: 'Category', width: 150 },
  { key: 'address', header: 'Address', width: 260 },
  { key: 'source', header: 'Source', width: 105 },
  { key: 'map', header: 'Map', width: 60 },
  { key: 'search', header: 'Found by', width: 220 },
  { key: 'added', header: 'Added', width: 100 },
  { key: 'contacts', header: 'In Contacts', width: 90 },
  { key: 'whatsapp', header: 'WhatsApp', width: 85 },
  { key: 'status', header: 'Status', width: 120 },
  { key: 'contacted', header: 'Last contacted', width: 130 },
  { key: 'notes', header: 'Notes', width: 240 },
];
const LC = indexColumns_(LEAD_COLUMNS);

const SEARCH_COLUMNS = [
  { key: 'keyword', header: 'Keyword', width: 190 },
  { key: 'location', header: 'Location', width: 210 },
  { key: 'sources', header: 'Sources', width: 150 },
  { key: 'repeat', header: 'Repeat daily', width: 95 },
  { key: 'status', header: 'Status', width: 90 },
  { key: 'lastRun', header: 'Last run', width: 130 },
  { key: 'result', header: 'Result', width: 420 },
];
const SC = indexColumns_(SEARCH_COLUMNS);

const LEAD_STATUSES = ['New', 'Messaged', 'Replied', 'Interested', 'Not interested', 'Do not contact'];
const SOURCE_OPTIONS = ['Google Maps', 'HERE', 'Google Maps + HERE'];
const IMPORT_RESULT_HEADER = 'Lead Engine result';
const BUSY_MESSAGE = 'The Lead Engine is already running (maybe the morning run). Try again in a minute.';
const FOUND_BY_SEPARATOR = ' · ';

const EXAMPLE_SEARCHES = [
  ['ladies salon', 'Al Barsha, Dubai', 'Google Maps', false],
  ['barber shop', 'Deira, Dubai', 'Google Maps', false],
  ['car repair garage', 'Al Quoz, Dubai', 'Google Maps', false],
  ['cleaning company', 'Dubai', 'Google Maps', false],
  ['landscaping company', 'Dubai', 'Google Maps', false],
  ['physiotherapy clinic', 'Sharjah', 'Google Maps', false],
];

const DEFAULT_MESSAGE =
  "Hi 👋 We came across {name} online and noticed there's no website yet. " +
  "We're RizcoReach, a Dubai web design studio. Happy to make you a free homepage mockup, no strings attached. " +
  "Interested? (Reply STOP and we won't message again.)";

const SETTINGS = [
  { key: 'googleKey', label: 'Google Places API key', def: '', emptyOk: true,
    note: 'Google Cloud → APIs & Services → Credentials. "Places API (New)" must be enabled on the project.' },
  { key: 'googleMonthlyCap', label: 'Max Google requests per month', def: 1000,
    note: "Searches pause when this sheet has made this many Google requests this month. 1,000 is Google's monthly free allowance for these lookups (1 request = up to 20 businesses). 0 = no cap." },
  { key: 'hereKey', label: 'HERE API key (optional)', def: '', emptyOk: true,
    note: 'From platform.here.com. Only needed for searches whose source includes HERE.' },
  { key: 'country', label: 'Default country', def: 'AE',
    note: 'Two-letter code used for numbers written without a country code. AE = UAE, SA = Saudi Arabia, QA, KW, BH, OM, GB, IN, PK…' },
  { key: 'language', label: 'Results language', def: 'en', note: 'en or ar' },
  { key: 'mobileOnly', label: 'Keep mobile numbers only', def: 'YES', bool: true,
    note: "YES = landlines are skipped (they can't be messaged on WhatsApp)." },
  { key: 'socialIsNoWebsite', label: 'Treat Instagram / Facebook / booking pages as no website', def: 'YES', bool: true,
    note: 'YES = a business whose only "website" is an Instagram, Facebook, Linktree, WhatsApp, Fresha… link still counts as a lead.' },
  { key: 'autoSync', label: 'Add new leads to Google Contacts automatically', def: 'YES', bool: true,
    note: 'YES = every search run also copies its new leads to your Google Contacts.' },
  { key: 'contactPrefix', label: 'Contact name prefix', def: 'Lead -', emptyOk: true,
    note: 'Contacts are saved as "<prefix> <business name>" so you can spot (and bulk-delete) them. Leave empty for no prefix.' },
  { key: 'contactLabel', label: 'Contacts label', def: 'RizcoReach Leads', emptyOk: true,
    note: 'Google Contacts label the leads are filed under. Leave empty for no label.' },
  { key: 'waMessage', label: 'WhatsApp message', def: DEFAULT_MESSAGE,
    note: 'Placeholders: {name} {area} {keyword} {category}. After editing, run Lead Engine → Refresh WhatsApp links.' },
  { key: 'dailyLimit', label: 'WhatsApp chats per day', def: 30,
    note: 'The outreach panel warns you after this many chats in a day. Lots of first messages from one number gets it restricted by WhatsApp.' },
];

const GOOGLE_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_FIELDS = [
  'places.displayName',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
  'nextPageToken',
].join(',');
const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const HERE_GEOCODE_URL = 'https://geocode.search.hereapi.com/v1/geocode';

// Apps Script stops a run at 6 minutes; leave room to save results.
const MAX_RUN_MS = 4.5 * 60 * 1000;

// ─── Menu & triggers ─────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Lead Engine')
    .addItem('Find leads now', 'runSearches')
    .addItem('Add the Import tab to Leads', 'processImport')
    .addItem('Copy new leads to Google Contacts', 'syncContacts')
    .addSeparator()
    .addItem('WhatsApp outreach panel', 'openOutreach')
    .addItem('Refresh WhatsApp links', 'refreshWhatsAppLinks')
    .addSeparator()
    .addItem('Run searches every morning', 'enableDailyRun')
    .addItem('Stop the morning run', 'disableDailyRun')
    .addItem('Set up / repair tabs', 'setup')
    .addToUi();
}

/** Simple trigger: stamp "Last contacted" when a lead is marked Messaged by hand. */
function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sh = range.getSheet();
  if (sh.getName() !== SHEET.leads) return;
  const firstCol = range.getColumn();
  const lastCol = firstCol + range.getNumColumns() - 1;
  if (LC.status < firstCol || LC.status > lastCol) return;

  const row0 = range.getRow();
  const n = range.getNumRows();
  const statuses = sh.getRange(row0, LC.status, n, 1).getValues();
  const contacted = sh.getRange(row0, LC.contacted, n, 1).getValues();
  let changed = false;
  statuses.forEach(([status], i) => {
    if (row0 + i > 1 && status === 'Messaged' && !contacted[i][0]) {
      contacted[i][0] = new Date();
      changed = true;
    }
  });
  if (changed) sh.getRange(row0, LC.contacted, n, 1).setValues(contacted);
}

function setup() {
  guard_(() => {
    ensureSheets_(true);
    notify_(
      'Tabs are ready.\n\n1. Paste your Google Places API key into the Settings tab.\n' +
        '2. Put the keywords and areas you want in the Searches tab.\n' +
        '3. Lead Engine → Find leads now.',
      true
    );
  });
}

function runSearches() {
  guard_(() => notify_(withLock_(runSearchesLocked_) || BUSY_MESSAGE, true));
}

/** Time-based trigger handlers (must be public functions). */
function dailyRun() {
  runFromTrigger_();
}
function continueSearches() {
  runFromTrigger_();
}

function runFromTrigger_() {
  try {
    const message = withLock_(runSearchesLocked_);
    if (message === null) scheduleContinuation_(); // someone else is running it; try again shortly
    else Logger.log(message);
  } catch (err) {
    Logger.log(err && err.stack ? err.stack : err);
  }
}

function enableDailyRun() {
  guard_(() => {
    deleteTriggers_('dailyRun');
    ScriptApp.newTrigger('dailyRun').timeBased().everyDays(1).atHour(9).create();
    notify_(
      'Done. Every morning around 9am the Lead Engine runs new searches, re-runs the ones ticked ' +
        '"Repeat daily", and copies new leads to Google Contacts.',
      true
    );
  });
}

function disableDailyRun() {
  guard_(() => {
    deleteTriggers_('dailyRun');
    deleteTriggers_('continueSearches');
    notify_('The morning run is off.', true);
  });
}

function processImport() {
  guard_(() => notify_(withLock_(processImportLocked_) || BUSY_MESSAGE, true));
}

function syncContacts() {
  guard_(() => {
    const r = withLock_(syncContactsLocked_);
    if (!r) return notify_(BUSY_MESSAGE, true);
    notify_(
      r.added
        ? r.added + ' lead(s) copied to Google Contacts.' + (r.failed ? ' ' + r.failed + ' failed; run it again to retry.' : '')
        : r.failed
          ? r.failed + ' lead(s) could not be copied. Run it again to retry.'
          : 'Every lead is already in Google Contacts.',
      true
    );
  });
}

// ─── Searching ───────────────────────────────────────────────────────────────

function runSearchesLocked_() {
  const started = Date.now();
  deleteTriggers_('continueSearches');
  ensureSheets_(false);
  const s = getSettings_();
  const sh = sheet_(SHEET.searches);
  const last = sh.getLastRow();
  if (last < 2) return 'Add at least one keyword and location to the Searches tab first.';

  const rows = sh.getRange(2, 1, last - 1, SEARCH_COLUMNS.length).getValues();
  const today = dayKey_(new Date());
  const index = loadLeadIndex_(s);
  let ran = 0;
  let added = 0;
  let waiting = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const keyword = String(r[SC.keyword - 1]).trim();
    if (!keyword || !isSearchDue_(r, today)) continue;
    if (Date.now() - started > MAX_RUN_MS) {
      waiting++;
      continue;
    }

    const rowNum = i + 2;
    const location = String(r[SC.location - 1]).trim();
    const sources = String(r[SC.sources - 1]).trim() || SOURCE_OPTIONS[0];
    sh.getRange(rowNum, SC.status).setValue('Running…');
    SpreadsheetApp.flush();

    let status;
    let result;
    try {
      const out = runOneSearch_(keyword, location, sources, s, index);
      added += out.added;
      status = out.paused ? 'Paused' : 'Done';
      result = out.summary;
    } catch (err) {
      errors++;
      status = 'Error';
      result = errorText_(err);
    }
    sh.getRange(rowNum, SC.status).setValue(status);
    sh.getRange(rowNum, SC.lastRun).setValue(new Date()).setNumberFormat('d mmm yyyy HH:mm');
    sh.getRange(rowNum, SC.result).setValue(result);
    ran++;
  }

  const parts = [];
  if (!ran && !waiting) {
    parts.push('Nothing to run: every search is Done. Add new rows, tick "Repeat daily", or clear a row\'s Status to run it again.');
  } else {
    parts.push('Ran ' + ran + ' search(es): ' + added + ' new lead(s).');
    if (errors) parts.push(errors + ' had an error (see the Result column).');
  }

  if (added && s.autoSync) {
    try {
      const sync = syncContactsLocked_();
      if (sync.added) parts.push(sync.added + ' copied to Google Contacts.');
    } catch (err) {
      parts.push('Copying to Google Contacts failed: ' + errorText_(err));
    }
  }
  if (s.googleKey) {
    parts.push('Google requests this month: ' + googleCount_() + (s.googleMonthlyCap ? ' / ' + s.googleMonthlyCap : '') + '.');
  }
  if (waiting) {
    scheduleContinuation_();
    parts.push(waiting + ' search(es) left; continuing automatically in about a minute.');
  }
  return parts.join(' ');
}

function scheduleContinuation_() {
  deleteTriggers_('continueSearches');
  ScriptApp.newTrigger('continueSearches').timeBased().after(60 * 1000).create();
}

function isSearchDue_(row, today) {
  const status = String(row[SC.status - 1]).trim();
  if (!status || status === 'Running…' || status === 'Error' || status === 'Paused') return true;
  const lastRun = row[SC.lastRun - 1];
  return isYes_(row[SC.repeat - 1]) && (!isDate_(lastRun) || dayKey_(lastRun) !== today);
}

function runOneSearch_(keyword, location, sources, s, index) {
  const wantHere = /here/i.test(sources);
  const wantGoogle = /google/i.test(sources) || !wantHere;
  const state = { capped: false };
  let places = [];
  if (wantGoogle) places = places.concat(searchGoogle_(keyword, location, s, state));
  if (wantHere) places = places.concat(searchHere_(keyword, location, s));

  const lead = { keyword: keyword, area: location, search: [keyword, location].filter(Boolean).join(FOUND_BY_SEPARATOR) };
  const stats = addPlaces_(places, lead, s, index);
  const summary = [
    stats.found + ' found',
    stats.website + ' have a website',
    stats.noPhone + (s.mobileOnly ? ' no mobile' : ' no phone'),
    stats.dupes + ' already saved',
    stats.added + ' new',
  ];
  if (stats.closed) summary.splice(1, 0, stats.closed + ' closed');
  if (state.capped) summary.push('Google monthly cap reached (see Settings)');
  return { added: stats.added, paused: state.capped, summary: summary.join(' · ') };
}

/** Filters places down to new, website-less mobile leads and appends them to Leads. */
function addPlaces_(places, context, s, index) {
  const stats = { found: places.length, closed: 0, website: 0, noPhone: 0, dupes: 0, added: 0 };
  const rows = [];
  places.forEach((p) => {
    if (p.closed) {
      stats.closed++;
      return;
    }
    if (hasRealWebsite_(p.websites, s.socialIsNoWebsite)) {
      stats.website++;
      return;
    }
    const phone = pickPhone_(p.phones, s);
    if (!phone) {
      stats.noPhone++;
    } else if (index[phone.e164]) {
      stats.dupes++;
    } else {
      index[phone.e164] = true;
      rows.push(leadRow_(Object.assign({}, p, context, { mobile: phone.e164 }), s));
      stats.added++;
    }
  });
  appendLeads_(rows);
  return stats;
}

function searchGoogle_(keyword, location, s, state) {
  if (!s.googleKey) throw new Error('Paste your Google Places API key into the Settings tab first.');
  const textQuery = location ? keyword + ' in ' + location : keyword;
  const places = [];
  let pageToken = '';
  // Google returns at most 3 pages of 20 per query; split big areas into smaller ones for more.
  for (let page = 0; page < 3; page++) {
    if (s.googleMonthlyCap && googleCount_() >= s.googleMonthlyCap) {
      state.capped = true;
      break;
    }
    const body = { textQuery: textQuery, pageSize: 20, languageCode: s.language, includePureServiceAreaBusinesses: true };
    if (/^[A-Z]{2}$/.test(s.country)) body.regionCode = s.country;
    if (pageToken) body.pageToken = pageToken;
    bumpGoogleCount_();
    const res = fetchJson_(
      GOOGLE_SEARCH_URL,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        headers: { 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': GOOGLE_FIELDS },
      },
      'Google Places'
    );
    (res.places || []).forEach((p) => places.push(fromGooglePlace_(p)));
    pageToken = res.nextPageToken || '';
    if (!pageToken) break;
  }
  return places;
}

function fromGooglePlace_(p) {
  return {
    name: (p.displayName && p.displayName.text) || '',
    phones: [p.internationalPhoneNumber, p.nationalPhoneNumber].filter(Boolean),
    websites: p.websiteUri ? [p.websiteUri] : [],
    category: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
    address: p.formattedAddress || '',
    link: p.googleMapsUri || '',
    source: 'Google Maps',
    closed: p.businessStatus === 'CLOSED_PERMANENTLY' || p.businessStatus === 'CLOSED_TEMPORARILY',
  };
}

function searchHere_(keyword, location, s) {
  if (!s.hereKey) throw new Error('This search uses HERE: paste a HERE API key into Settings, or switch the row to Google Maps.');
  if (!location) throw new Error('HERE searches need a location, e.g. "Al Barsha, Dubai".');
  const at = hereGeocode_(location, s);
  const url = HERE_DISCOVER_URL + '?' + query_({ q: keyword, at: at.lat + ',' + at.lng, limit: 100, lang: s.language, apiKey: s.hereKey });
  const res = fetchJson_(url, { method: 'get' }, 'HERE');
  return (res.items || []).filter((it) => !it.resultType || it.resultType === 'place').map(fromHerePlace_);
}

function hereGeocode_(location, s) {
  const cache = CacheService.getScriptCache();
  const key = 'here-geo:' + location.toLowerCase().slice(0, 200);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = fetchJson_(HERE_GEOCODE_URL + '?' + query_({ q: location, limit: 1, apiKey: s.hereKey }), { method: 'get' }, 'HERE');
  const item = (res.items || [])[0];
  if (!item || !item.position) throw new Error('HERE could not find the location "' + location + '".');
  cache.put(key, JSON.stringify(item.position), 6 * 60 * 60);
  return item.position;
}

function fromHerePlace_(it) {
  const contacts = it.contacts || [];
  const pick = (type) => {
    const out = [];
    contacts.forEach((c) => (c[type] || []).forEach((x) => x && x.value && out.push(x.value)));
    return out;
  };
  const categories = it.categories || [];
  const primary = categories.filter((c) => c.primary)[0] || categories[0];
  const address = (it.address && it.address.label) || '';
  return {
    name: it.title || '',
    phones: pick('mobile').concat(pick('phone')),
    websites: pick('www'),
    category: primary ? primary.name : '',
    address: address,
    link: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([it.title, address].filter(Boolean).join(', ')),
    source: 'HERE',
    closed: false,
  };
}

// ─── Import tab (lists from anywhere else) ───────────────────────────────────

function processImportLocked_() {
  ensureSheets_(false);
  const s = getSettings_();
  const sh = sheet_(SHEET.importer);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return 'Paste a list into the Import tab first: a header row, then one business per row, with a phone column.';

  const data = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0].map((h) => String(h).trim());
  let resultCol = headers.indexOf(IMPORT_RESULT_HEADER) + 1;
  if (!resultCol) {
    resultCol = lastCol + 1;
    sh.getRange(1, resultCol).setValue(IMPORT_RESULT_HEADER).setFontWeight('bold');
  }
  const cols = detectImportColumns_(headers, resultCol - 1);
  if (!cols.phones.length) return 'Could not find a phone column in the Import tab. Name its header "Phone" or "Mobile" and try again.';

  const index = loadLeadIndex_(s);
  const cell = (row, i) => (i >= 0 ? String(row[i]).trim() : '');
  const leads = [];
  const results = [];
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const previous = resultCol <= lastCol ? cell(row, resultCol - 1) : '';
    if (previous || row.every((v) => v === '' || v === null)) {
      results.push([previous]);
      continue;
    }
    const phones = cols.phones.map((c) => cell(row, c)).filter(Boolean);
    let result;
    if (hasRealWebsite_([cell(row, cols.website)], s.socialIsNoWebsite)) {
      result = 'Skipped: has a website';
    } else if (!phones.length) {
      result = 'Skipped: no phone';
    } else {
      const phone = pickPhone_(phones, s);
      if (!phone) result = s.mobileOnly ? 'Skipped: not a mobile' : 'Skipped: invalid number';
      else if (index[phone.e164]) result = 'Already in Leads';
      else {
        index[phone.e164] = true;
        leads.push(
          leadRow_(
            {
              mobile: phone.e164,
              name: cell(row, cols.name),
              category: cell(row, cols.category),
              address: cell(row, cols.address),
              link: /^https?:\/\//i.test(cell(row, cols.link)) ? cell(row, cols.link) : '',
              source: 'Import',
              search: 'Import',
            },
            s
          )
        );
        result = 'Added';
      }
    }
    counts[result] = (counts[result] || 0) + 1;
    results.push([result]);
  }

  appendLeads_(leads);
  sh.getRange(2, resultCol, results.length, 1).setValues(results);
  const summary = Object.keys(counts).map((k) => counts[k] + ' × ' + k);
  return summary.length ? 'Import done: ' + summary.join(', ') + '.' : 'Nothing new to import.';
}

function detectImportColumns_(headers, ignoreIndex) {
  const usable = (i) => i !== ignoreIndex;
  const all = (re) => headers.map((h, i) => (usable(i) && re.test(h) ? i : -1)).filter((i) => i >= 0);
  const first = (re, exclude) => {
    const found = all(re).filter((i) => !(exclude || []).includes(i));
    return found.length ? found[0] : -1;
  };
  const phones = all(/phone|mobile|whats ?app|telephone|^tel\b|cell|contact ?number|^number$/i);
  const website = first(/website|web ?site|^site$|homepage|domain/i, phones);
  const link = first(/maps|^url$|^link$|place ?url/i, phones.concat([website]));
  let name = first(/^(name|title|business|business ?name|company|company ?name|place|place ?name)$/i, phones);
  if (name < 0) name = headers.findIndex((h, i) => usable(i) && /name|title/i.test(h) && !/categor|user|owner|first|last/i.test(h) && !phones.includes(i));
  return {
    phones: phones,
    website: website,
    link: link,
    name: name,
    category: first(/categor|industry|^type$/i, phones),
    address: first(/address|location|area|city|street/i, phones.concat([link])),
  };
}

// ─── Leads tab ───────────────────────────────────────────────────────────────

function leadRow_(lead, s) {
  const row = new Array(LEAD_COLUMNS.length).fill('');
  row[LC.mobile - 1] = lead.mobile;
  row[LC.name - 1] = lead.name || '';
  row[LC.category - 1] = lead.category || '';
  row[LC.address - 1] = lead.address || '';
  row[LC.source - 1] = lead.source || '';
  row[LC.map - 1] = lead.link ? hyperlink_(lead.link, 'Open') : '';
  row[LC.search - 1] = lead.search || '';
  row[LC.added - 1] = new Date();
  row[LC.whatsapp - 1] = hyperlink_(whatsAppUrl_(lead.mobile, fillMessage_(s.waMessage, lead)), 'Chat');
  row[LC.status - 1] = 'New';
  return row;
}

/** Turns a Leads row back into the fields message placeholders use. */
function leadFromRow_(row) {
  const source = String(row[LC.source - 1]);
  const foundBy = source === 'Import' ? [] : String(row[LC.search - 1]).split(FOUND_BY_SEPARATOR);
  return {
    mobile: String(row[LC.mobile - 1]).trim(),
    name: String(row[LC.name - 1]).trim(),
    category: String(row[LC.category - 1]).trim(),
    keyword: (foundBy[0] || '').trim(),
    area: foundBy.slice(1).join(FOUND_BY_SEPARATOR).trim(),
  };
}

function appendLeads_(rows) {
  if (!rows.length) return;
  const sh = sheet_(SHEET.leads);
  const start = sh.getLastRow() + 1;
  const end = start + rows.length - 1;
  if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end - sh.getMaxRows());
  sh.getRange(start, LC.mobile, rows.length, 1).setNumberFormat('@');
  sh.getRange(start, LC.added, rows.length, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(start, LC.contacted, rows.length, 1).setNumberFormat('d mmm yyyy HH:mm');
  sh.getRange(start, LC.status, rows.length, 1).setDataValidation(listRule_(LEAD_STATUSES));
  sh.getRange(start, 1, rows.length, LEAD_COLUMNS.length).setValues(rows);
}

/** Every mobile already in Leads, so nothing gets added twice. */
function loadLeadIndex_(s) {
  const sh = sheet_(SHEET.leads);
  const index = {};
  const n = sh.getLastRow() - 1;
  if (n < 1) return index;
  sh.getRange(2, LC.mobile, n, 1)
    .getValues()
    .forEach(([v]) => {
      const p = normalizePhone_(v, s.country);
      const key = p ? p.e164 : String(v).trim();
      if (key) index[key] = true;
    });
  return index;
}

function refreshWhatsAppLinks() {
  guard_(() => {
    const s = getSettings_();
    const sh = sheet_(SHEET.leads);
    const n = sh.getLastRow() - 1;
    if (n < 1) return notify_('No leads yet.', true);
    const links = sh
      .getRange(2, 1, n, LEAD_COLUMNS.length)
      .getValues()
      .map((r) => {
        const lead = leadFromRow_(r);
        return [lead.mobile ? hyperlink_(whatsAppUrl_(lead.mobile, fillMessage_(s.waMessage, lead)), 'Chat') : ''];
      });
    sh.getRange(2, LC.whatsapp, n, 1).setValues(links);
    notify_('WhatsApp links now use your current message.', true);
  });
}

// ─── Google Contacts ─────────────────────────────────────────────────────────

/** Copies leads that aren't in Google Contacts yet. Returns { added, failed }. */
function syncContactsLocked_() {
  if (typeof People === 'undefined') {
    throw new Error('Turn on the People API: Apps Script editor → Services (+) → People API → Add, then try again.');
  }
  const s = getSettings_();
  const sh = sheet_(SHEET.leads);
  const n = sh.getLastRow() - 1;
  if (n < 1) return { added: 0, failed: 0 };

  const values = sh.getRange(2, 1, n, LEAD_COLUMNS.length).getValues();
  const todo = [];
  values.forEach((r, i) => {
    const mobile = String(r[LC.mobile - 1]).trim();
    if (mobile && !String(r[LC.contacts - 1]).trim() && r[LC.status - 1] !== 'Do not contact') todo.push(i);
  });
  if (!todo.length) return { added: 0, failed: 0 };

  const group = s.contactLabel ? contactGroup_(s.contactLabel) : '';
  const flags = values.map((r) => [r[LC.contacts - 1]]);
  let added = 0;
  // batchCreateContacts takes up to 200 contacts per call.
  for (let k = 0; k < todo.length; k += 200) {
    const chunk = todo.slice(k, k + 200);
    const res = People.People.batchCreateContacts({
      contacts: chunk.map((i) => ({ contactPerson: contactFor_(values[i], s) })),
      readMask: 'names,phoneNumbers',
    });
    const createdPhones = {};
    const resourceNames = [];
    ((res && res.createdPeople) || []).forEach((cp) => {
      const person = cp.person;
      if (!person || !person.resourceName) return;
      resourceNames.push(person.resourceName);
      (person.phoneNumbers || []).forEach((ph) => {
        const p = normalizePhone_(ph.canonicalForm || ph.value, s.country);
        if (p) createdPhones[p.e164] = true;
      });
    });
    chunk.forEach((i) => {
      const p = normalizePhone_(values[i][LC.mobile - 1], s.country);
      if (p && createdPhones[p.e164]) {
        flags[i][0] = 'Yes';
        added++;
      }
    });
    if (group && resourceNames.length) addToContactGroup_(group, resourceNames, s.contactLabel);
    sh.getRange(2, LC.contacts, n, 1).setValues(flags);
    if (k + 200 < todo.length) Utilities.sleep(1000);
  }
  return { added: added, failed: todo.length - added };
}

function contactFor_(row, s) {
  const name = String(row[LC.name - 1]).trim();
  const mobile = String(row[LC.mobile - 1]).trim();
  const notes = [
    'Lead from ' + (row[LC.source - 1] || 'Lead Engine'),
    row[LC.search - 1] && row[LC.search - 1] !== 'Import' ? 'Search: ' + row[LC.search - 1] : '',
    row[LC.category - 1],
    row[LC.address - 1],
  ].filter(Boolean);
  const person = {
    names: [{ givenName: [s.contactPrefix, name || mobile].filter(Boolean).join(' ') }],
    phoneNumbers: [{ value: mobile, type: 'mobile' }],
    biographies: [{ value: notes.join('\n'), contentType: 'TEXT_PLAIN' }],
  };
  if (name) person.organizations = [{ name: name }];
  return person;
}

function contactGroup_(label) {
  const props = PropertiesService.getScriptProperties();
  const key = 'contactGroup:' + label;
  const cached = props.getProperty(key);
  if (cached) return cached;

  let found = '';
  let pageToken = '';
  do {
    const args = { pageSize: 1000 };
    if (pageToken) args.pageToken = pageToken;
    const res = People.ContactGroups.list(args);
    (res.contactGroups || []).forEach((g) => {
      if (!found && g.groupType === 'USER_CONTACT_GROUP' && g.name === label) found = g.resourceName;
    });
    pageToken = res.nextPageToken || '';
  } while (pageToken && !found);
  if (!found) found = People.ContactGroups.create({ contactGroup: { name: label } }).resourceName;
  props.setProperty(key, found);
  return found;
}

function addToContactGroup_(group, resourceNames, label) {
  try {
    People.ContactGroups.Members.modify({ resourceNamesToAdd: resourceNames }, group);
  } catch (err) {
    // The label was probably deleted in Google Contacts; make it again once.
    PropertiesService.getScriptProperties().deleteProperty('contactGroup:' + label);
    People.ContactGroups.Members.modify({ resourceNamesToAdd: resourceNames }, contactGroup_(label));
  }
}

// ─── WhatsApp outreach panel ─────────────────────────────────────────────────

function openOutreach() {
  guard_(() => {
    const html = HtmlService.createHtmlOutputFromFile('Outreach').setTitle('WhatsApp outreach');
    SpreadsheetApp.getUi().showSidebar(html);
  });
}

/** Called by the panel: today's count and the next lead with status New. */
function outreachNext(skip) {
  const s = getSettings_();
  const sh = sheet_(SHEET.leads);
  const n = sh.getLastRow() - 1;
  const today = dayKey_(new Date());
  const skipped = {};
  (skip || []).forEach((m) => (skipped[m] = true));

  let sentToday = 0;
  let queue = 0;
  let next = null;
  if (n > 0) {
    sh.getRange(2, 1, n, LEAD_COLUMNS.length)
      .getValues()
      .forEach((r) => {
        const contacted = r[LC.contacted - 1];
        if (isDate_(contacted) && dayKey_(contacted) === today) sentToday++;
        const status = String(r[LC.status - 1]).trim();
        const mobile = String(r[LC.mobile - 1]).trim();
        if (mobile && (!status || status === 'New')) {
          queue++;
          if (!next && !skipped[mobile]) next = r;
        }
      });
  }

  let lead = null;
  if (next) {
    const l = leadFromRow_(next);
    lead = { mobile: l.mobile, name: l.name, category: l.category, area: l.area, message: fillMessage_(s.waMessage, l) };
  }
  return { sentToday: sentToday, limit: s.dailyLimit, queue: queue, lead: lead };
}

/** Called by the panel: set a lead's status (and contact time), then return the next lead. */
function outreachMark(mobile, status, skip) {
  if (LEAD_STATUSES.indexOf(status) < 0) throw new Error('Unknown status: ' + status);
  const sh = sheet_(SHEET.leads);
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const mobiles = sh.getRange(2, LC.mobile, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      if (String(mobiles[i][0]).trim() !== mobile) continue;
      sh.getRange(i + 2, LC.status).setValue(status);
      if (status === 'Messaged') sh.getRange(i + 2, LC.contacted).setValue(new Date());
      break;
    }
  }
  return outreachNext(skip);
}

function fillMessage_(template, lead) {
  const values = {
    name: cleanBusinessName_(lead.name) || 'your business',
    area: lead.area || 'your area',
    keyword: lead.keyword || 'business',
    category: lead.category || lead.keyword || 'business',
  };
  return String(template || DEFAULT_MESSAGE)
    .replace(/\{(\w+)\}/g, (match, key) => (values.hasOwnProperty(key.toLowerCase()) ? values[key.toLowerCase()] : match))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function whatsAppUrl_(e164, text) {
  return 'https://wa.me/' + String(e164).replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
}

/** "Al Noor Salon | Best Ladies Salon in Dubai" → "Al Noor Salon" */
function cleanBusinessName_(name) {
  return String(name || '').split('|')[0].replace(/\s+/g, ' ').trim();
}

// ─── Phone numbers ───────────────────────────────────────────────────────────

/**
 * cc: country calling code · len: allowed national number lengths ·
 * mobile: national numbers that are mobiles (null = can't tell from the number).
 */
const PHONE_RULES = {
  AE: { cc: '971', len: [8, 9], mobile: /^5\d{8}$/ },
  SA: { cc: '966', len: [8, 9], mobile: /^5\d{8}$/ },
  QA: { cc: '974', len: [8, 8], mobile: /^[3567]\d{7}$/ },
  KW: { cc: '965', len: [8, 8], mobile: /^[4569]\d{7}$/ },
  BH: { cc: '973', len: [8, 8], mobile: /^(3\d{7}|6[3-9]\d{6})$/ },
  OM: { cc: '968', len: [8, 8], mobile: /^(7[1-9]\d{6}|9\d{7})$/ },
  EG: { cc: '20', len: [8, 10], mobile: /^1[0125]\d{8}$/ },
  JO: { cc: '962', len: [8, 9], mobile: /^7[789]\d{7}$/ },
  LB: { cc: '961', len: [7, 8], mobile: /^(3\d{6}|7[01689]\d{6}|81\d{6})$/ },
  IN: { cc: '91', len: [10, 10], mobile: /^[6-9]\d{9}$/ },
  PK: { cc: '92', len: [9, 10], mobile: /^3\d{9}$/ },
  GB: { cc: '44', len: [9, 10], mobile: /^7[1-57-9]\d{8}$/ },
  AU: { cc: '61', len: [9, 9], mobile: /^4\d{8}$/ },
  US: { cc: '1', len: [10, 10], mobile: null },
};
const CALLING_CODES = Object.keys(PHONE_RULES).reduce((m, iso) => {
  m[PHONE_RULES[iso].cc] = iso;
  return m;
}, {});

/**
 * Parses a phone number written any common way ("050 123 4567", "+971501234567",
 * "00971 50…", "971501234567") into { e164, type: mobile|landline|unknown, country }.
 * Returns null when it can't be a valid number.
 */
function normalizePhone_(raw, defaultCountry) {
  const text = String(raw == null ? '' : raw)
    .replace(/(?:ext\.?|extension|x)\s*\d+\s*$/i, '')
    .trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  let international = text.charAt(0) === '+';
  if (!international && digits.indexOf('00') === 0) {
    digits = digits.slice(2);
    international = true;
  }

  let iso = null;
  let national = '';
  if (international) {
    for (let n = 3; n >= 1 && !iso; n--) {
      if (CALLING_CODES[digits.slice(0, n)]) {
        iso = CALLING_CODES[digits.slice(0, n)];
        national = digits.slice(n);
      }
    }
    if (!iso) return digits.length >= 8 && digits.length <= 15 ? { e164: '+' + digits, type: 'unknown', country: '' } : null;
  } else {
    iso = String(defaultCountry || '').toUpperCase();
    const def = PHONE_RULES[iso];
    if (!def) return null;
    const withoutCc = digits.slice(def.cc.length);
    national = digits.indexOf(def.cc) === 0 && fitsLength_(def, withoutCc.replace(/^0+/, '').length) ? withoutCc : digits;
  }

  national = national.replace(/^0+/, ''); // trunk prefix, and "+971 (0)50…"
  const rule = PHONE_RULES[iso];
  if (!fitsLength_(rule, national.length)) return null;
  const type = rule.mobile ? (rule.mobile.test(national) ? 'mobile' : 'landline') : 'unknown';
  return { e164: '+' + rule.cc + national, type: type, country: iso };
}

function fitsLength_(rule, n) {
  return n >= rule.len[0] && n <= rule.len[1];
}

/** "050 123 4567 / 04 123 4567" → two numbers. */
function splitPhones_(raw) {
  return String(raw == null ? '' : raw)
    .split(/[,;|\/\n]+|\s+or\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** First mobile among the numbers (or the first valid number if mobiles-only is off). */
function pickPhone_(phones, s) {
  let fallback = null;
  for (let i = 0; i < (phones || []).length; i++) {
    const parts = splitPhones_(phones[i]);
    for (let j = 0; j < parts.length; j++) {
      const p = normalizePhone_(parts[j], s.country);
      if (!p) continue;
      if (p.type === 'mobile') return p;
      if (!fallback) fallback = p;
    }
  }
  return s.mobileOnly ? null : fallback;
}

// ─── Websites ────────────────────────────────────────────────────────────────

/** Links that don't count as the business having its own website. */
const NOT_A_WEBSITE = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'wa.me', 'whatsapp.com', 'linktr.ee', 'tiktok.com',
  'twitter.com', 'x.com', 'snapchat.com', 'youtube.com', 'youtu.be', 'linkedin.com', 't.me', 'pinterest.com',
  'business.site', 'g.page', 'goo.gl', 'maps.google.com', 'g.co', 'bit.ly', 'beacons.ai', 'taplink.cc', 'linkin.bio',
  'fresha.com', 'booksy.com', 'vagaro.com', 'setmore.com', 'calendly.com', 'talabat.com', 'deliveroo.ae',
  'careemnow.com', 'noon.com', 'zomato.com', 'tripadvisor.com', 'booking.com', 'dubizzle.com', 'yellowpages.ae',
];

function hasRealWebsite_(urls, socialIsNoWebsite) {
  return (urls || []).some((url) => {
    const host = hostOf_(url);
    if (!host) return false;
    if (!socialIsNoWebsite) return true;
    return !NOT_A_WEBSITE.some((d) => host === d || host.slice(-(d.length + 1)) === '.' + d);
  });
}

function hostOf_(url) {
  const m = String(url || '')
    .trim()
    .match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/?#]*@)?([^\/?#:\s]+)/i);
  if (!m || m[1].indexOf('.') < 0) return '';
  return m[1].toLowerCase().replace(/^www\./, '');
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

function ensureSheets_(full) {
  const ss = SpreadsheetApp.getActive();
  const leads = ensureTable_(ss, SHEET.leads, LEAD_COLUMNS);
  const searches = ensureTable_(ss, SHEET.searches, SEARCH_COLUMNS);
  const importer = ss.getSheetByName(SHEET.importer) || ss.insertSheet(SHEET.importer);
  const settings = ensureSettings_(ss);
  if (!full) return;

  // Leads
  const rows = Math.max(leads.getMaxRows() - 1, 1);
  leads.getRange(2, LC.mobile, rows, 1).setNumberFormat('@');
  leads.getRange(2, LC.added, rows, 1).setNumberFormat('d mmm yyyy');
  leads.getRange(2, LC.contacted, rows, 1).setNumberFormat('d mmm yyyy HH:mm');
  leads.getRange(2, LC.status, rows, 1).setDataValidation(listRule_(LEAD_STATUSES));
  leads.setTabColor('#25D366');

  // Searches
  if (searches.getLastRow() < 2) {
    searches.getRange(2, 1, EXAMPLE_SEARCHES.length, 4).setValues(EXAMPLE_SEARCHES);
  }
  const searchRows = Math.max(searches.getMaxRows() - 1, 1);
  searches.getRange(2, SC.sources, searchRows, 1).setDataValidation(listRule_(SOURCE_OPTIONS));
  searches.getRange(2, SC.repeat, searchRows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  searches.getRange(1, SC.keyword).setNote('What to search for, as you would type it into Google Maps: "ladies salon", "AC repair", "pilates studio"…');
  searches.getRange(1, SC.location).setNote(
    'Google returns at most 60 businesses per search, so use small areas (Al Barsha, JLT, Deira…) rather than a whole city.'
  );
  searches.getRange(1, SC.status).setNote('Rows run when Status is empty. Clear it to run a row again.');

  // Import
  importer.getRange(1, 1).setNote(
    'Paste a list here (an export from another lead tool, a directory, a spreadsheet…) with a header row ' +
      'and a phone column. Then: Lead Engine → Add the Import tab to Leads.'
  );

  // Tab order: Leads, Searches, Import, Settings
  [leads, searches, importer, settings].forEach((sh, i) => {
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && blank.getLastColumn() === 0) ss.deleteSheet(blank);
  ss.setActiveSheet(settings);
}

function ensureTable_(ss, name, columns) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, columns.length)
      .setValues([columns.map((c) => c.header)])
      .setFontWeight('bold')
      .setBackground('#f1f3f4');
    sh.setFrozenRows(1);
    columns.forEach((c, i) => sh.setColumnWidth(i + 1, c.width));
  }
  return sh;
}

function ensureSettings_(ss) {
  const sh = ss.getSheetByName(SHEET.settings) || ss.insertSheet(SHEET.settings);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it does']]).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 330);
    sh.setColumnWidth(2, 380);
    sh.setColumnWidth(3, 460);
  }
  const present = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1)
      .getValues()
      .forEach(([label]) => (present[String(label).trim().toLowerCase()] = true));
  }
  SETTINGS.forEach((d) => {
    if (present[d.label.toLowerCase()]) return;
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 3).setValues([[d.label, d.def, d.note]]).setVerticalAlignment('top').setWrap(true);
    if (d.bool) sh.getRange(row, 2).setDataValidation(listRule_(['YES', 'NO']));
  });
  return sh;
}

function getSettings_() {
  const s = {};
  SETTINGS.forEach((d) => (s[d.key] = d.def));
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.settings);
  if (sh && sh.getLastRow() > 1) {
    const byLabel = {};
    SETTINGS.forEach((d) => (byLabel[d.label.toLowerCase()] = d));
    sh.getRange(2, 1, sh.getLastRow() - 1, 2)
      .getValues()
      .forEach(([label, value]) => {
        const d = byLabel[String(label).trim().toLowerCase()];
        const text = value === null || value === undefined ? '' : String(value).trim();
        if (d && (text !== '' || d.emptyOk)) s[d.key] = value;
      });
  }
  SETTINGS.forEach((d) => {
    if (d.bool) s[d.key] = isYes_(s[d.key]);
    else if (typeof d.def === 'number') s[d.key] = Math.max(0, Number(s[d.key]) || 0);
    else s[d.key] = String(s[d.key]).trim();
  });
  s.country = s.country.toUpperCase();
  return s;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run Lead Engine → Set up / repair tabs.');
  return sh;
}

function listRule_(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
}

function hyperlink_(url, label) {
  return '=HYPERLINK("' + String(url).replace(/"/g, '""') + '","' + label + '")';
}

function indexColumns_(columns) {
  const map = {};
  columns.forEach((c, i) => (map[c.key] = i + 1));
  return map;
}

// ─── Plumbing ────────────────────────────────────────────────────────────────

function fetchJson_(url, options, label) {
  const opts = Object.assign({ muteHttpExceptions: true }, options);
  for (let attempt = 0; ; attempt++) {
    const res = UrlFetchApp.fetch(url, opts);
    const code = res.getResponseCode();
    if ((code === 429 || code >= 500) && attempt < 2) {
      Utilities.sleep(2000 * (attempt + 1));
      continue;
    }
    const text = res.getContentText();
    let body = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      body = null;
    }
    if (code >= 200 && code < 300 && body) return body;
    throw new Error(label + ' error ' + code + ': ' + apiErrorMessage_(body, text));
  }
}

function apiErrorMessage_(body, text) {
  if (body) {
    if (body.error && body.error.message) return body.error.message;
    if (body.title) return body.title + (body.cause ? ' (' + body.cause + ')' : '');
    if (body.error_description) return body.error_description;
    if (typeof body.error === 'string') return body.error;
  }
  return String(text || 'no details').slice(0, 300);
}

function query_(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

function googleCountKey_() {
  return 'googleRequests:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function googleCount_() {
  return Number(PropertiesService.getScriptProperties().getProperty(googleCountKey_())) || 0;
}

function bumpGoogleCount_() {
  PropertiesService.getScriptProperties().setProperty(googleCountKey_(), String(googleCount_() + 1));
}

function dayKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function isYes_(v) {
  return v === true || /^(y|yes|true|1|on)$/i.test(String(v).trim());
}

function deleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

/** Runs fn while holding the script lock; returns null if another run holds it. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return null;
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Runs a menu action and shows errors as a message instead of a stack trace. */
function guard_(fn) {
  try {
    return fn();
  } catch (err) {
    Logger.log(err && err.stack ? err.stack : err);
    notify_('Something went wrong: ' + errorText_(err), true);
  }
}

function errorText_(err) {
  return String((err && err.message) || err);
}

/** Alert when someone is looking at the sheet; toast/log when running from a trigger. */
function notify_(message, alert) {
  Logger.log(message);
  if (alert) {
    try {
      SpreadsheetApp.getUi().alert('Lead Engine', message, SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    } catch (e) {
      // No UI when running from a trigger.
    }
  }
  try {
    SpreadsheetApp.getActive().toast(message, 'Lead Engine', 10);
  } catch (e) {
    // Nothing else to do.
  }
}
