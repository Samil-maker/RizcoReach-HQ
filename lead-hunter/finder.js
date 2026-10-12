/* Lead Hunter: Meta-ads prospecting (loaded by background.js, shares its scope).
   1. FIND businesses on Google Maps (Places API, or the Maps page in a tab)
   2. CHECK each one in the Meta Ad Library (in a background tab)
   3. Businesses that are NOT running ads become prospects for the Meta-ads offer.
   Prospects are stored like leads (`lead:p:…`, kind: 'prospect') so the dashboard, pitches,
   phone mode, phone queue and CSV export all work on them too. */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

/* ------------------------------------------------------------- prospects */
function newProspect(id) {
  return Object.assign(newLead(id), { kind: 'prospect', pageId: null, sources: {}, adCheck: { state: 'pending' }, niche: '', area: '', avoid: false, destinationKind: null });
}

// Pure helpers live in lib/prospects.js (unit-tested).
const prospectKeys = (item) => LH.prospectKeys(item);
const matchAds = (lead, ads) => LH.matchAds(lead, ads);
const placeToItem = (p, country) => LH.placeToItem(p, country);

function mergeProspect(lead, item, ctx) {
  // The first Maps listing names the business; a second listing (a branch) only fills gaps.
  const firstMaps = item.maps && !(lead.sources.maps && lead.sources.maps.placeId);
  if (!lead.pageName || (firstMaps && lead.nameFrom !== 'maps')) {
    lead.pageName = String(item.name || '').trim().slice(0, 160);
    lead.nameFrom = item.source;
  }
  if (ctx.niche && !lead.niche) lead.niche = ctx.niche;
  if (ctx.area && !lead.area) lead.area = ctx.area;
  const kw = (ctx.keyword || '').toLowerCase();
  if (kw && !lead.keywords.includes(kw)) lead.keywords.push(kw);
  const country = ctx.country || 'AE';
  if (!lead.countries.includes(country)) lead.countries.push(country);
  if (item.category && !lead.categories.includes(item.category)) lead.categories.push(item.category);
  if (item.avatar) lead.avatar = item.avatar;
  if (item.maps) {
    const cur = lead.sources.maps;
    if (!cur || !cur.placeId || cur.placeId === item.maps.placeId) lead.sources.maps = { ...(cur || {}), ...item.maps };
    else {
      const fill = Object.fromEntries(Object.entries(item.maps).filter(([k, v]) => v != null && v !== '' && (cur[k] == null || cur[k] === '')));
      lead.sources.maps = { ...cur, ...fill, otherListings: [...new Set([...(cur.otherListings || []), item.maps.placeId])].slice(0, 5) };
    }
  }
  if (item.instagram) {
    lead.sources.instagram = { ...(lead.sources.instagram || {}), ...item.instagram };
    lead.socials.instagram = `https://www.instagram.com/${item.instagram.username}/`;
  }
  lead.pageUrl = lead.socials.instagram || (lead.sources.maps && lead.sources.maps.mapsUrl) || lead.pageUrl;

  const u = item.website ? LH.unwrapLink(item.website) : null;
  const kind = u && LH.linkKind(u);
  if (kind === 'website' && (!lead.website || lead.websiteSource !== 'manual')) {
    if (!lead.website) {
      lead.website = `${u.protocol}//${u.hostname}/`;
      lead.landingUrl = LH.cleanUrl(u);
      lead.websiteSource = item.source;
    }
  } else if (kind === 'whatsapp') {
    addPhone(lead, LH.whatsappNumber(u), item.source === 'instagram' ? 'whatsapp-ig' : 'whatsapp-site');
  } else if (kind === 'linkinbio' && !lead.socials.linkinbio) lead.socials.linkinbio = LH.cleanUrl(u);
  lead.destinationKind = lead.website ? 'website' : lead.socials.instagram ? 'instagram' : null;

  for (const n of item.whatsapp || []) addPhone(lead, n, item.source === 'instagram' ? 'whatsapp-ig' : 'whatsapp-site');
  for (const n of item.phones || []) addPhone(lead, n, item.source === 'maps' ? 'google' : 'instagram');
  lead.phones = lead.phones.slice(0, 8);
  lead.emails = [...new Set([...(lead.emails || []), ...(item.emails || []).map((e) => e.toLowerCase())])].slice(0, 5);
  const ig = lead.sources.instagram || {};
  lead.avoid = LH.AVOID_WORDS.test([lead.pageName, ...lead.categories, ig.bio || ''].join(' '));
  lead.lastSeenAt = now();
  lead.updatedAt = now();
}

/** Add or merge found businesses. Returns ids of new prospects (worth an ad check). */
async function ingestProspects(items, ctx = {}) {
  const result = await locked(async () => {
    const { prospectIndex = {}, finder } = await store.get(['prospectIndex', 'finder']);
    const touched = new Map();
    const fresh = [];
    for (const item of items || []) {
      if (!item || !item.name) continue;
      const keys = prospectKeys(item);
      if (!keys.length) continue;
      let id = keys.map((k) => prospectIndex[k]).find(Boolean);
      let lead = id ? touched.get(id) || (await getLead(id)) : null;
      const isNew = !lead;
      if (isNew) {
        id = item.maps && item.maps.placeId ? `p:m:${item.maps.placeId}` : `p:i:${item.instagram.username.toLowerCase()}`;
        lead = touched.get(id) || (await getLead(id)) || newProspect(id);
      }
      mergeProspect(lead, item, ctx);
      for (const k of prospectKeys({ ...item, website: lead.website, phones: lead.phones.map((p) => p.number) })) prospectIndex[k] = id;
      touched.set(id, lead);
      if (isNew && !fresh.includes(id)) fresh.push(id);
    }
    const writes = { prospectIndex };
    for (const [id, l] of touched) writes[leadKey(id)] = l;
    const counted = fresh.filter((id) => !touched.get(id).avoid);
    if (finder && finder.status === 'running' && ctx.finderId === finder.id) {
      finder.added += counted.length;
      finder.found += (items || []).length;
      finder.lastActivity = now();
      writes.finder = finder;
    }
    for (const id of counted) {
      const l = touched.get(id);
      l.adCheck = { state: 'queued' };
      if (l.website) l.site = { state: 'queued' };
    }
    await store.set(writes);
    return { added: counted.length, ids: counted, websites: counted.filter((id) => touched.get(id).website) };
  });
  if (result.ids.length) queueAdChecks(result.ids);
  if (result.websites.length) enqueue(result.websites);
  return result;
}

/* -------------------------------------------------------------- ad check */
// For each prospect: search the Ad Library in a background tab and decide whether they run ads.
let adCheckBusy = false;
let pendingCheck = null; // { id, tabId, resolve }

async function queueAdChecks(ids, front = false) {
  await locked(async () => {
    const { adCheckQueue = [] } = await store.get('adCheckQueue');
    const rest = adCheckQueue.filter((x) => !ids.includes(x));
    await store.set({ adCheckQueue: front ? [...ids, ...rest] : [...rest, ...ids] });
  });
  runAdChecks();
}

async function adCheckTab() {
  const { adCheckTabId } = await store.get('adCheckTabId');
  if (adCheckTabId) {
    try {
      const t = await chrome.tabs.get(adCheckTabId);
      if (t) return t.id;
    } catch {}
  }
  const t = await chrome.tabs.create({ url: 'about:blank', active: false });
  await store.set({ adCheckTabId: t.id });
  return t.id;
}

/* Ad Library views used by the check. The page view is the reliable one: it lists exactly the
   ads a Facebook page is running. Keyword search does NOT look at page names, so a name search
   that finds nothing is never proof that a business isn't advertising. */
const pageViewUrl = (pageId) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&is_targeted_country=false&media_type=all&search_type=page&view_all_page_id=${encodeURIComponent(pageId)}`;
const searchUrl = (q, country = 'ALL') =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&is_targeted_country=false&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

/** The business's Facebook page id, from the Facebook link on its website (if any). */
async function resolvePageId(lead) {
  const fb = (lead.socials || {}).facebook;
  const u = fb && LH.safeUrl(fb);
  if (!u || LH.linkKind(u) !== 'facebook') return null;
  const inUrl = u.pathname.match(/(?:^|\/)(?:pages\/[^/]+\/|people\/[^/]+\/|p\/[^/]*-)?(\d{6,})\/?$/) || (u.searchParams.get('id') || '').match(/^(\d{6,})$/);
  if (inUrl) return inUrl[1];
  const handle = u.pathname.split('/').filter(Boolean)[0];
  if (!handle || /^(sharer|share|plugins|tr|dialog|groups|events|watch|profile\.php)$/i.test(handle)) return null;
  try {
    // Facebook's public page plugin shows the numeric id for a vanity URL.
    const res = await fetch(`https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(`https://www.facebook.com/${handle}`)}`, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const m = html.match(/facebook\.com\/(\d{6,})\?ref=embed_page/) || html.match(/"pageID":"(\d{6,})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Open one Ad Library view in the check tab and wait for the content script's report. */
async function loadView(lead, url) {
  const tabId = await adCheckTab();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 45000);
      pendingCheck = { id: lead.id, tabId, resolve: (r) => (clearTimeout(timer), resolve(r)) };
      chrome.tabs.update(tabId, { url }).catch(() => resolve({ error: 'tab' }));
    });
    pendingCheck = null;
    if (res.blocked) return res;
    // About 1 load in 4 arrives without the results; one retry fixes most of them.
    if (res.loaded) return res;
    await sleep(jitter(2500, 4500));
  }
  return { loaded: false };
}

/**
 * Verdicts: running · none (their Facebook page has no live ads: confirmed) ·
 * likely (no ads found by website or name, but their page could not be checked) · unclear.
 */
async function checkOne(lead) {
  const country = lead.countries[0] && lead.countries[0] !== 'ALL' ? lead.countries[0] : 'AE';
  const base = { checkedAt: now() };
  const steps = [];
  let blocked = false;

  // 1. Their Facebook page (from the website): an exact live-ad count.
  const pageId = await resolvePageId(lead);
  if (pageId) {
    const url = pageViewUrl(pageId);
    const r = await loadView(lead, url);
    blocked = blocked || !!r.blocked;
    if (r.loaded && r.pageInfo !== false) {
      const count = typeof r.count === 'number' ? r.count : (r.ads || []).length;
      if (count > 0 && !(r.ads || []).length) return { ...base, state: 'unclear', reason: 'Facebook showed an ad count but no ads (it may be slowing searches down)', searchUrl: url, pageId };
      if (count > 0) return { ...base, state: 'running', activeAds: count, pageId, searchUrl: url, matches: [{ pageId, pageName: (r.ads[0] || {}).pageName || lead.pageName, ads: count, reasons: ['their Facebook page'] }] };
      return { ...base, state: 'none', pageId, searchUrl: url, evidence: 'Their Facebook page has no active ads in the Ad Library.' };
    }
    steps.push(r.loaded ? 'page not in the Ad Library' : 'page view did not load');
  }

  // 2. Their website domain: ads show where they link to, so this finds advertisers even without a page id.
  const domain = lead.website ? LH.domainOf(lead.website) : '';
  if (domain) {
    const url = searchUrl(domain, 'ALL');
    const r = await loadView(lead, url);
    blocked = blocked || !!r.blocked;
    if (r.loaded) {
      const m = matchAds(lead, r.ads);
      if (m.length) return { ...base, state: 'running', activeAds: m.reduce((s, x) => s + x.ads, 0), matches: m.slice(0, 3), searchUrl: url };
      steps.push('no ads link to their website');
    }
    await sleep(jitter(2000, 4000));
  }

  // 3. Their name (weakest: finds ads that mention the business, but absence proves little).
  const url = searchUrl(lead.pageName, country);
  const r = await loadView(lead, url);
  blocked = blocked || !!r.blocked;
  if (r.loaded) {
    const m = matchAds(lead, r.ads);
    if (m.length) return { ...base, state: 'running', activeAds: m.reduce((s, x) => s + x.ads, 0), matches: m.slice(0, 3), searchUrl: url };
    steps.push('no ads mention their name');
    return { ...base, state: 'likely', searchUrl: url, resultsSeen: (r.ads || []).length, evidence: `No ads found (${steps.join(', ')}). Their Facebook page could not be checked directly, so this is not certain.` };
  }
  return { ...base, state: 'unclear', searchUrl: url, reason: blocked ? 'Facebook asked to log in or blocked the search' : 'The Ad Library did not load' };
}

async function runAdChecks() {
  if (adCheckBusy) return;
  adCheckBusy = true;
  try {
    for (;;) {
      const { adCheckQueue = [], adCheckPaused } = await store.get(['adCheckQueue', 'adCheckPaused']);
      if (!adCheckQueue.length || adCheckPaused) break;
      // Wait for a website check to finish first: it finds the Facebook page link the check relies on.
      let id = null;
      for (const x of adCheckQueue) {
        const l = await getLead(x);
        const siteBusy = l && l.website && ['queued', 'running', 'pending'].includes((l.site || {}).state);
        if (!siteBusy || now() - (l.createdAt || 0) > 4 * 60000) {
          id = x;
          break;
        }
      }
      if (!id) {
        await sleep(3000);
        continue;
      }
      const lead = await getLead(id);
      if (lead && lead.kind === 'prospect') {
        await updateLead(id, (l) => (l.adCheck = { ...(l.adCheck || {}), state: 'checking' }));
        const result = await checkOne(lead).catch((e) => ({ state: 'unclear', reason: String(e.message || e), checkedAt: now() }));
        await updateLead(id, (l) => (l.adCheck = result));
      }
      await locked(async () => {
        const { adCheckQueue: q = [] } = await store.get('adCheckQueue');
        await store.set({ adCheckQueue: q.filter((x) => x !== id) });
      });
      await sleep(jitter(2500, 6000)); // human pace on Facebook
    }
  } finally {
    adCheckBusy = false;
  }
}

/* ---------------------------------------------------------- Google Maps */
const PLACES_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

/* Phone, website and rating put each search in Google's "Text Search Enterprise" tier:
   1,000 free requests a month (up to ~20,000 places), then about $35 per 1,000.
   A monthly counter stops before the free allowance runs out unless the user raises the cap. */
const PLACES_ERRORS = {
  SERVICE_DISABLED: 'Turn on "Places API (New)" for your key in Google Cloud Console.',
  BILLING_DISABLED: 'Google needs a billing account on your Cloud project before Places searches work (the monthly free allowance still applies).',
  API_KEY_INVALID: 'The Google Places API key in Settings is not valid.',
};
async function placesBudget() {
  const month = new Date().toISOString().slice(0, 7);
  const { placesUsage } = await store.get('placesUsage');
  return placesUsage && placesUsage.month === month ? placesUsage : { month, count: 0 };
}
async function placesSpend() {
  const u = await placesBudget();
  await store.set({ placesUsage: { month: u.month, count: u.count + 1 } });
}

async function placesSearch(query, key, pageToken) {
  const settings = await getSettings();
  const used = await placesBudget();
  const cap = Number(settings.placesMonthlyCap) || 950;
  if (used.count >= cap) throw new Error(`Used ${used.count} of your ${cap} Google Places searches this month. Raise the limit in Settings if you are fine paying past Google's free allowance.`);
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACES_FIELDS },
    // Keep the body identical across pages (Google rejects a changed body with a page token).
    body: JSON.stringify({ textQuery: query, regionCode: 'AE', languageCode: 'en', pageSize: 20, includePureServiceAreaBusinesses: true, ...(pageToken ? { pageToken } : {}) }),
  });
  await placesSpend();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = ((((data.error || {}).details || []).find((d) => d && d.reason) || {}).reason) || '';
    throw new Error(PLACES_ERRORS[reason] || (data.error && data.error.message) || `Google Places error ${res.status}`);
  }
  return data;
}

/* ------------------------------------------------------------- the finder */
let finderBusy = false;

async function startFinder(cfg) {
  const settings = await getSettings();
  const niche = cfg.niche || '';
  const keywords = [...new Set((cfg.keywords || LH.AD_NICHES[niche] || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
  if (!keywords.length) throw new Error('Pick a niche or add keywords.');
  const city = cfg.city || settings.adsCity || 'Dubai';
  const areas = (cfg.areas && cfg.areas.length ? cfg.areas : LH.AREAS[city] || [city]).slice(0, 40);
  const sources = { maps: true };
  const mapsMode = settings.placesKey ? 'api' : 'browser';
  const mapsQ = [];
  for (const area of areas) for (const keyword of keywords) mapsQ.push({ q: `${keyword} in ${area}, ${city}`, keyword, area });
  const finder = {
    id: `f${now().toString(36)}`,
    status: 'running',
    niche,
    keywords,
    city,
    country: 'AE',
    target: Math.max(1, Math.min(1000, Number(cfg.target) || 100)),
    sources,
    mapsMode,
    mapsQ,
    mapsI: 0,
    mapsToken: null,
    mapsDone: false,
    mapsNote: '',
    found: 0,
    added: 0,
    startedAt: now(),
    lastActivity: now(),
  };
  await locked(() => store.set({ finder }));
  runFinder();
  return finder;
}

async function patchFinder(id, patch) {
  return locked(async () => {
    const { finder } = await store.get('finder');
    if (!finder || finder.id !== id) return null;
    Object.assign(finder, typeof patch === 'function' ? patch(finder) || {} : patch);
    finder.lastActivity = now();
    if (finder.status === 'running' && (finder.mapsDone || finder.added >= finder.target)) {
      finder.status = 'done';
      finder.finishedAt = now();
      notify('Business search finished', `${finder.added} new businesses found. Ad checks continue in the background.`);
    }
    await store.set({ finder });
    return finder;
  });
}

async function currentFinder() {
  const { finder } = await store.get('finder');
  return finder && finder.status === 'running' ? finder : null;
}

async function runFinder() {
  if (finderBusy) return;
  finderBusy = true;
  try {
    const f = await currentFinder();
    if (!f) return;
    if (!f.mapsDone) await runMaps(f.id);
  } finally {
    finderBusy = false;
  }
}

async function runMaps(fid) {
  for (;;) {
    const f = await currentFinder();
    if (!f || f.id !== fid || f.mapsDone || f.added >= f.target) return;
    const q = f.mapsQ[f.mapsI];
    if (!q) return patchFinder(fid, { mapsDone: true });
    const ctx = { finderId: fid, niche: f.niche, keyword: q.keyword, area: q.area, country: f.country };
    try {
      if (f.mapsMode === 'api') {
        const settings = await getSettings();
        const data = await placesSearch(q.q, settings.placesKey, f.mapsToken);
        await ingestProspects((data.places || []).map((p) => placeToItem(p, f.country)).filter(Boolean), ctx);
        await patchFinder(fid, (x) => (data.nextPageToken ? { mapsToken: data.nextPageToken } : { mapsToken: null, mapsI: x.mapsI + 1 }));
        await sleep(data.nextPageToken ? 1200 : 400);
      } else {
        const items = await mapsBrowserSearch(q.q);
        await ingestProspects(items, ctx);
        await patchFinder(fid, (x) => ({ mapsI: x.mapsI + 1 }));
        await sleep(jitter(2000, 4000));
      }
    } catch (e) {
      await patchFinder(fid, { mapsDone: true, mapsNote: String(e.message || e) });
      return;
    }
  }
}

/* Maps without an API key: run the search in a Google Maps tab and read the results list. */
let pendingMaps = null;
async function mapsTab() {
  const { mapsTabId } = await store.get('mapsTabId');
  if (mapsTabId) {
    try {
      return (await chrome.tabs.get(mapsTabId)).id;
    } catch {}
  }
  const t = await chrome.tabs.create({ url: 'about:blank', active: false });
  await store.set({ mapsTabId: t.id });
  return t.id;
}
async function mapsBrowserSearch(query) {
  const tabId = await mapsTab();
  const res = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true, items: [] }), 120000);
    pendingMaps = { tabId, query, resolve: (r) => (clearTimeout(timer), resolve(r)) };
    // hl=en keeps labels in English even when the Google account is set to Arabic.
    chrome.tabs.update(tabId, { url: `https://www.google.com/maps/search/${encodeURIComponent(query)}/?hl=en` }).catch(() => resolve({ error: 'tab', items: [] }));
  });
  pendingMaps = null;
  if (res.blocked) throw new Error('Google Maps showed a consent or verification page. Open the Maps tab, accept it, then start again.');
  return (res.items || []).map((x) => ({ ...x, source: 'maps' }));
}

/* ------------------------------------------------------------- messages */
Object.assign(handlers, {
  'finder:start': async (msg) => ({ finder: await startFinder(msg.config || {}) }),
  'finder:stop': async () => {
    const f = await currentFinder();
    if (f) await patchFinder(f.id, { status: 'stopped', finishedAt: now() });
    return { ok: true };
  },
  'adcheck:result': async (msg, sender) => {
    if (pendingCheck && sender.tab && sender.tab.id === pendingCheck.tabId && msg.id === pendingCheck.id) pendingCheck.resolve(msg);
    return { ok: true };
  },
  'maps:hello': async (msg, sender) => ({ search: pendingMaps && sender.tab && sender.tab.id === pendingMaps.tabId ? pendingMaps.query : null }),
  'maps:results': async (msg, sender) => {
    if (pendingMaps && sender.tab && sender.tab.id === pendingMaps.tabId) pendingMaps.resolve(msg);
    return { ok: true };
  },
  'adcheck:recheck': async (msg) => {
    for (const id of msg.ids || []) await updateLead(id, (l) => (l.adCheck = { ...(l.adCheck || {}), state: 'queued' }));
    await queueAdChecks(msg.ids || [], true);
    return { ok: true };
  },
  'adcheck:set': async (msg) => {
    await updateLead(msg.id, (l) => (l.adCheck = { ...(l.adCheck || {}), state: msg.state === 'running' ? 'running' : 'none', manual: true, checkedAt: now() }));
    return { ok: true };
  },
  'adcheck:pause': async () => (await store.set({ adCheckPaused: true }), { ok: true }),
  'adcheck:resume': async () => {
    await store.set({ adCheckPaused: false });
    runAdChecks();
    return { ok: true };
  },
});

// The Ad Library tab doing checks says hello like any Ad Library tab; tell it which business to check.
const baseHello = handlers.hello;
handlers.hello = async (msg, sender) => {
  if (pendingCheck && sender.tab && sender.tab.id === pendingCheck.tabId) {
    const lead = await getLead(pendingCheck.id);
    return { check: { id: pendingCheck.id, name: lead ? lead.pageName : '' } };
  }
  return baseHello(msg, sender);
};

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { adCheckTabId, mapsTabId } = await store.get(['adCheckTabId', 'mapsTabId']);
  if (tabId === adCheckTabId) await store.remove('adCheckTabId');
  if (tabId === mapsTabId) await store.remove('mapsTabId');
});

// Resume after the worker restarts (Chrome stops idle service workers).
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'tick') return;
  if (await currentFinder()) runFinder();
  runAdChecks();
});
runAdChecks();
runFinder();
