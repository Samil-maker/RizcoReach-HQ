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
  } else if (kind === 'instagram') {
    // Maps lists an Instagram profile as the "website": keep it as their Instagram, not a website.
    if (!lead.socials.instagram && LH.igFromUrl(u)) lead.socials.instagram = `https://www.instagram.com/${LH.igFromUrl(u)}/`;
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

/**
 * Add or merge found businesses. Returns ids of new prospects (worth an ad check).
 * In a preset search a new business must pass the preset first: its Google review count (read from the results
 * list, so a listing that fails is never opened or checked) and its exclude words. What was dropped and why is
 * counted on the run, so every run shows its before and after.
 */
async function ingestProspects(items, ctx = {}) {
  const settings = await getSettings();
  const preset = ctx.finderId ? LH.presetsFor(settings).find((n) => n.name === ctx.niche) : null;
  const result = await locked(async () => {
    const { prospectIndex = {}, prospectNames = {}, contactHistory = {}, finder } = await store.get(['prospectIndex', 'prospectNames', 'contactHistory', 'finder']);
    const run = finder && ctx.finderId === finder.id ? finder : null;
    const stats = run ? (run.stats = { found: 0, duplicate: 0, contacted: 0, fewReviews: 0, manyReviews: 0, excluded: 0, kept: 0, ...(run.stats || {}) }) : null;
    const touched = new Map();
    const fresh = [];
    let contacted = 0;
    for (const item of items || []) {
      if (!item || !item.name) continue;
      const keys = prospectKeys(item);
      if (!keys.length) continue;
      // Same phone, website, Instagram or Maps listing, else nearly the same name in the same area.
      let id = keys.map((k) => prospectIndex[k]).find(Boolean) || LH.findByName(prospectNames, item.name, ctx.area, settings.nameMatch);
      let lead = id ? touched.get(id) || (await getLead(id)) : null;
      const isNew = !lead;
      if (stats) stats.found++;
      if (!isNew && stats) stats.duplicate++;
      // Contacted, exported or in your imported contacts before: never added again (Reset on the lead undoes it).
      if (isNew && LH.historyHit({ pageName: item.name, area: ctx.area, phones: [...(item.phones || []), ...(item.whatsapp || [])], website: item.website, sources: item.instagram ? { instagram: item.instagram } : {} }, contactHistory)) {
        if (stats) stats.contacted++;
        contacted++;
        continue;
      }
      if (isNew && preset) {
        const reviews = (item.maps && item.maps.reviews) || 0;
        const why = reviews < preset.minReviews ? 'fewReviews' : reviews > preset.maxReviews ? 'manyReviews' : LH.excludeHit(preset, item.name, item.category) ? 'excluded' : '';
        if (why) {
          stats[why]++;
          continue;
        }
      }
      if (isNew) {
        id = item.maps && item.maps.placeId ? `p:m:${item.maps.placeId}` : `p:i:${item.instagram.username.toLowerCase()}`;
        lead = touched.get(id) || (await getLead(id)) || newProspect(id);
      }
      mergeProspect(lead, item, ctx);
      for (const k of prospectKeys({ ...item, website: lead.website, phones: lead.phones.map((p) => p.number) })) prospectIndex[k] = id;
      LH.addName(prospectNames, lead);
      touched.set(id, lead);
      if (isNew && !fresh.includes(id)) fresh.push(id);
    }
    const writes = { prospectIndex, prospectNames };
    for (const [id, l] of touched) writes[leadKey(id)] = l;
    const counted = fresh.filter((id) => !touched.get(id).avoid);
    if (run && ['running', 'paused'].includes(run.status)) {
      run.added += counted.length;
      run.found += (items || []).length;
      stats.kept += counted.length;
      stats.excluded += fresh.length - counted.length; // the built in "long sales cycle" words
      run.lastActivity = now();
      writes.finder = run;
    }
    // Without a website they get the website script whatever their ads, so their Ad Library check is skipped
    // unless Settings asks for it (Phase 4 scores "running ads" on website leads too).
    for (const id of counted) {
      const l = touched.get(id);
      l.adCheck = { state: l.website || settings.adCheckAll ? 'queued' : 'skipped' };
      if (l.website) l.site = { state: 'queued' };
    }
    await store.set(writes);
    const websites = counted.filter((id) => touched.get(id).website);
    const checks = counted.filter((id) => touched.get(id).adCheck.state === 'queued');
    return { added: counted.length, ids: counted, websites, checks, contacted, leads: counted.map((id) => touched.get(id)) };
  });
  if (result.checks.length) queueAdChecks(result.checks);
  igAuto(result.leads, settings);
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

/* Ad Library views used by the check, UAE only, live and past ads ("all") so a business that stopped advertising
   shows up too. The page view is the reliable one: it lists exactly the ads a Facebook page ran. Keyword search
   does NOT look at page names, so a name search that finds nothing is never proof that a business never advertised. */
const LIBRARY = 'https://www.facebook.com/ads/library/';
const pageViewUrl = (pageId, country = 'AE', liveOnly = false) =>
  `${LIBRARY}?active_status=${liveOnly ? 'active' : 'all'}&ad_type=all&country=${country}&is_targeted_country=false&media_type=all&search_type=page&view_all_page_id=${encodeURIComponent(pageId)}`;
const searchUrl = (q, country = 'AE', liveOnly = false) =>
  `${LIBRARY}?active_status=${liveOnly ? 'active' : 'all'}&ad_type=all&country=${country}&is_targeted_country=false&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

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
    // A login or checkpoint page has no Ad Library script to answer: the tab's address says it.
    if (res.timeout) {
      const at = await chrome.tabs.get(tabId).then((t) => t.url || '').catch(() => '');
      if (/facebook\.com\/(login|checkpoint)/.test(at)) return { blocked: true, reason: /checkpoint/.test(at) ? 'Facebook showed a security check' : 'Facebook asked you to log in' };
    }
    // About 1 load in 4 arrives without the results; one retry fixes most of them.
    if (res.loaded) return res;
    await sleep(jitter(2500, 4500));
  }
  return { loaded: false };
}

/**
 * Verdicts: running (live ads now) · past (ran ads before, none live) · none (their Facebook page never ran ads in
 * the UAE: confirmed) · likely (no ads found by website or name, but their page could not be checked) · unclear.
 * With the newest ad's date (lastAdAt): when it started if live, when the last one stopped if past.
 * A login wall, checkpoint or block stops the check: { blocked } pauses all checks until you look.
 */
async function checkOne(lead) {
  const country = lead.countries[0] && lead.countries[0] !== 'ALL' ? lead.countries[0] : 'AE';
  const base = { checkedAt: now(), v: 2 }; // v2: live and past ads (before 1.8 only live ads were looked at)
  const steps = [];
  const blocked = (r, url) => ({ ...base, blocked: true, reason: r.reason || 'Facebook asked to log in or blocked the search', searchUrl: url });
  // Only the first ads load. When none of them is live but there are more, load the live ones on their own.
  // mine: which ads are theirs (all of them on their page view, the matching ones in a search).
  const addLive = async (h, url, mine) => {
    const r = await loadView(lead, url);
    if (r.blocked) return { blocked: r };
    const ads = r.loaded ? (r.ads || []).filter((a) => a.active !== false && mine(a)) : [];
    return ads.length ? { ...h, active: ads.length, lastStart: Math.max(h.lastStart || 0, LH.adHistory(ads).lastStart || 0) || null } : h;
  };

  // 1. Their Facebook page (from the website): every ad it ran in the UAE.
  const pageId = await resolvePageId(lead);
  if (pageId) {
    const url = pageViewUrl(pageId, country);
    const r = await loadView(lead, url);
    if (r.blocked) return blocked(r, url);
    if (r.loaded && r.pageInfo !== false) {
      const ads = r.ads || [];
      const count = typeof r.count === 'number' ? r.count : ads.length;
      if (count > 0 && !ads.length) return { ...base, state: 'unclear', reason: 'Facebook showed an ad count but no ads (it may be slowing searches down)', searchUrl: url, pageId };
      if (!count) return { ...base, state: 'none', pageId, searchUrl: url, totalAds: 0, evidence: 'Their Facebook page has never run ads in the UAE (Ad Library, live and past ads).' };
      let h = { ...LH.adHistory(ads), total: count };
      if (!h.active && count > ads.length) {
        h = await addLive(h, pageViewUrl(pageId, country, true), () => true);
        if (h.blocked) return blocked(h.blocked, url);
      }
      const v = LH.adVerdict(h);
      return { ...base, ...v, pageId, searchUrl: url, matches: [{ pageId, pageName: ads[0].pageName || lead.pageName, ads: v.activeAds, total: count, reasons: ['their Facebook page'] }] };
    }
    steps.push(r.loaded ? 'page not in the Ad Library' : 'page view did not load');
  }

  // 2. Their website domain, then 3. their name (weakest: finds ads that mention the business, absence proves little).
  const domain = lead.website ? LH.domainOf(lead.website) : '';
  const searches = [domain && [domain, 'no ads link to their website'], [lead.pageName, 'no ads mention their name']].filter(Boolean);
  let url = '';
  let r = {};
  for (const [q, none] of searches) {
    url = searchUrl(q, country);
    r = await loadView(lead, url);
    if (r.blocked) return blocked(r, url);
    if (r.loaded) {
      const m = matchAds(lead, r.ads);
      if (m.length) {
        let h = LH.sumHistory(m);
        if (!h.active && (r.count || 0) > (r.ads || []).length) {
          h = await addLive(h, searchUrl(q, country, true), (a) => matchAds(lead, [a]).length > 0);
          if (h.blocked) return blocked(h.blocked, url);
        }
        return { ...base, ...LH.adVerdict(h), matches: m.slice(0, 3).map(({ pageId: id, pageName, ads, total, reasons }) => ({ pageId: id, pageName, ads, total, reasons })), searchUrl: url };
      }
      steps.push(none);
    }
    if (q === domain) await sleep(jitter(2000, 4000));
  }
  if (r.loaded) return { ...base, state: 'likely', searchUrl: url, resultsSeen: (r.ads || []).length, evidence: `No ads found, live or past (${steps.join(', ')}). Their Facebook page could not be checked directly, so this is not certain.` };
  return { ...base, state: 'unclear', searchUrl: url, reason: 'The Ad Library did not load' };
}

/* ----------------------------------------------------- per source problems */
/* Every problem a source hits, newest first (Settings > Your data), and a pause with an alert when a site shows a
   login wall, checkpoint, captcha or block. Nothing tries to get past it. */
async function logProblem(source, text) {
  await locked(async () => {
    const { problems = {} } = await store.get('problems');
    problems[source] = [[now(), String(text).slice(0, 300)], ...(problems[source] || [])].slice(0, 20);
    await store.set({ problems });
  });
}
const SOURCE_NAMES = { adlib: 'Meta Ad Library', maps: 'Google Maps', instagram: 'Instagram API' };
async function alertSource(source, text, url, hint = 'Open the tab, sort it out, then press Resume in Lead Hunter.') {
  await logProblem(source, text);
  await locked(async () => {
    const { alerts = {} } = await store.get('alerts');
    alerts[source] = { at: now(), text, url: url || '' };
    await store.set({ alerts });
  });
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: '!' });
  } catch {}
  notify(`${SOURCE_NAMES[source] || source} paused`, `${text}. ${hint}`);
}
async function clearAlert(source) {
  await locked(async () => {
    const { alerts = {} } = await store.get('alerts');
    delete alerts[source];
    await store.set({ alerts });
    if (!Object.keys(alerts).length)
      try {
        chrome.action.setBadgeText({ text: '' });
      } catch {}
  });
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
        if (result.blocked) {
          // Stop here: this business stays first in the queue and every check waits until you press Resume.
          await updateLead(id, (l) => (l.adCheck = { ...(l.adCheck || {}), state: 'queued' }));
          await store.set({ adCheckPaused: true });
          await alertSource('adlib', result.reason, result.searchUrl);
          break;
        }
        if (result.state === 'unclear') logProblem('adlib', `${lead.pageName}: ${result.reason}`);
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

/* ---------------------------------------------------- Instagram followers */
/* Follower counts from Meta's official Instagram Graph API (Business Discovery), with your own token: nothing is
   read from instagram.com. It only sees business and creator accounts. A personal account, or a handle that does
   not exist, is saved as not found. A bad token, a missing permission or a rate limit pauses the lookups. */
async function igApi(settings, path, fields) {
  const u = new URL(`https://graph.facebook.com/${settings.igApiVersion || 'v23.0'}/${encodeURIComponent(path)}`);
  u.searchParams.set('fields', fields);
  u.searchParams.set('access_token', settings.igToken);
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (data && data.error) return { error: data.error.message || 'Instagram API error', code: data.error.code, sub: data.error.error_subcode };
  if (!res.ok) return { error: `Instagram API answered ${res.status}` };
  return data;
}
// Token expired or wrong (190, 102), no permission (10, 200), rate limits (4, 17, 32, 613, 80002), your account id unknown (100/33).
const igStop = (r) => [190, 102, 10, 200, 4, 17, 32, 613, 80002].includes(r.code) || (r.code === 100 && r.sub === 33);
async function igLookup(handle, settings) {
  const r = await igApi(settings, settings.igAccountId, `business_discovery.username(${handle}){followers_count,media_count,username}`);
  if (r.error) return r;
  const b = r.business_discovery || {};
  return { followers: typeof b.followers_count === 'number' ? b.followers_count : null, media: typeof b.media_count === 'number' ? b.media_count : null };
}
const igReady = (settings) => !!(settings.igToken && settings.igAccountId);

async function queueIg(ids) {
  if (!ids.length) return;
  await locked(async () => {
    const { igQueue = [] } = await store.get('igQueue');
    await store.set({ igQueue: [...new Set([...igQueue, ...ids])] });
  });
  runIg();
}
/** New businesses with an Instagram handle and no count yet, when the API is set up and Look up automatically is on. */
function igAuto(leads, settings) {
  if (!igReady(settings) || !settings.igAuto) return;
  queueIg((leads || []).filter((l) => l && l.kind === 'prospect' && LH.igHandle(l) && !l.igStats).map((l) => l.id));
}
let igBusy = false;
async function runIg() {
  if (igBusy) return;
  igBusy = true;
  try {
    for (;;) {
      const settings = await getSettings();
      const { igQueue = [], igPaused } = await store.get(['igQueue', 'igPaused']);
      if (!igQueue.length || igPaused || !igReady(settings)) break;
      const id = igQueue[0];
      const lead = await getLead(id);
      const handle = lead && LH.igHandle(lead).toLowerCase();
      if (handle) {
        const r = await igLookup(handle, settings).catch((e) => ({ error: String(e.message || e) }));
        if (r.error && igStop(r)) {
          await store.set({ igPaused: true });
          await alertSource('instagram', `Instagram API: ${r.error}`, '', 'Check the token and account id in Settings, then press Resume.');
          break;
        }
        if (r.error) logProblem('instagram', `@${handle}: ${r.error}`);
        await updateLead(id, (l) => (l.igStats = r.error ? { handle, error: r.error, at: now() } : { handle, followers: r.followers, media: r.media, at: now(), from: 'api' }));
      }
      await locked(async () => {
        const { igQueue: q = [] } = await store.get('igQueue');
        await store.set({ igQueue: q.filter((x) => x !== id) });
      });
      await sleep(jitter(1500, 3000));
    }
  } finally {
    igBusy = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => a.name === 'tick' && runIg());

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

/* A run works through a preset's keyword x area searches in order ("ppf Al Quoz Industrial Area 3, Dubai"), at most
   `cap` searches per run. Finished searches are remembered per preset (`searchDone`), so the next run carries on
   where the last one stopped. */
const comboKey = (keyword, area) => `${keyword.toLowerCase()}|${area.toLowerCase()}`;
async function searchesDone(preset) {
  const { searchDone = {} } = await store.get('searchDone');
  return searchDone[preset] || {};
}
async function markSearchDone(preset, q) {
  if (!preset) return;
  await locked(async () => {
    const { searchDone = {} } = await store.get('searchDone');
    searchDone[preset] = { ...(searchDone[preset] || {}), [comboKey(q.keyword, q.area)]: now() };
    await store.set({ searchDone });
  });
}
/** What is left of a preset: its searches in order, minus the finished ones. */
async function presetQueue(preset, keywords, areas) {
  const done = await searchesDone(preset.name);
  const all = keywords.flatMap((keyword) => areas.map((area) => ({ q: `${keyword} ${area}`, keyword, area })));
  return { all: all.length, left: all.filter((x) => !done[comboKey(x.keyword, x.area)]) };
}

async function startFinder(cfg) {
  const settings = await getSettings();
  const presets = LH.presetsFor(settings);
  const preset = presets.find((n) => n.name === cfg.niche) || presets[0];
  const keywords = LH.parseKeywords(cfg.keywords && cfg.keywords.length ? cfg.keywords : preset.keywords);
  if (!keywords.length) throw new Error('Pick a preset or add keywords.');
  const areas = LH.parseLines(cfg.areas && cfg.areas.length ? cfg.areas : preset.areas).slice(0, 300);
  if (!areas.length) throw new Error('This preset has no areas. Add some in Settings.');
  const { all, left } = await presetQueue(preset, keywords, areas);
  if (!left.length) throw new Error(`Every search of ${preset.name} has been run. Press Start over to run them again.`);
  const cap = Math.max(1, Math.min(1000, Math.round(Number(cfg.cap)) || 100));
  const finder = {
    id: `f${now().toString(36)}`,
    status: 'running',
    niche: preset.name,
    keywords,
    city: LH.cityOf(areas[0], settings.adsCity || 'Dubai'),
    country: 'AE',
    cap,
    sources: { maps: true },
    mapsMode: settings.placesKey ? 'api' : 'browser',
    mapsQ: left.slice(0, cap),
    mapsI: 0,
    mapsToken: null,
    mapsDone: false,
    mapsNote: '',
    planned: all,
    leftBefore: left.length,
    found: 0,
    added: 0,
    // What happened to everything found: the before and after of the filters.
    stats: { found: 0, duplicate: 0, fewReviews: 0, manyReviews: 0, excluded: 0, kept: 0 },
    startedAt: now(),
    lastActivity: now(),
  };
  await locked(() => store.set({ finder }));
  runFinder();
  return finder;
}

/** Forget a preset's finished searches, so the next run starts from its first keyword again. */
async function resetPreset(name) {
  await locked(async () => {
    const { searchDone = {} } = await store.get('searchDone');
    delete searchDone[name];
    await store.set({ searchDone });
  });
}

async function patchFinder(id, patch) {
  return locked(async () => {
    const { finder } = await store.get('finder');
    if (!finder || finder.id !== id) return null;
    Object.assign(finder, typeof patch === 'function' ? patch(finder) || {} : patch);
    finder.lastActivity = now();
    if (finder.status === 'running' && (finder.mapsDone || (finder.target && finder.added >= finder.target))) {
      finder.status = 'done';
      finder.finishedAt = now();
      notify('Business search finished', `${finder.added} new businesses kept from ${(finder.stats || {}).found || finder.found} found. Ad checks continue in the background.`);
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
    if (!f || f.id !== fid || f.mapsDone || (f.target && f.added >= f.target)) return;
    const q = f.mapsQ[f.mapsI];
    if (!q) return patchFinder(fid, { mapsDone: true });
    const ctx = { finderId: fid, niche: f.niche, keyword: q.keyword, area: q.area, country: f.country };
    try {
      if (f.mapsMode === 'api') {
        const settings = await getSettings();
        const data = await placesSearch(q.q, settings.placesKey, f.mapsToken);
        await ingestProspects((data.places || []).map((p) => placeToItem(p, f.country)).filter(Boolean), ctx);
        if (!data.nextPageToken) await markSearchDone(f.niche, q);
        await patchFinder(fid, (x) => (data.nextPageToken ? { mapsToken: data.nextPageToken } : { mapsToken: null, mapsI: x.mapsI + 1 }));
        await sleep(data.nextPageToken ? 1200 : 400);
      } else {
        const items = await mapsBrowserSearch(q.q);
        await ingestProspects(items, ctx);
        await markSearchDone(f.niche, q);
        await patchFinder(fid, (x) => ({ mapsI: x.mapsI + 1 }));
        await sleep(jitter(2500, 5000)); // one search at a time, a human pace between them
      }
    } catch (e) {
      const text = String(e.message || e);
      if (e.blocked) {
        // Paused, not stopped: Resume carries on from this search once the page is sorted out.
        await patchFinder(fid, { status: 'paused', mapsNote: text });
        await alertSource('maps', text);
      } else {
        await patchFinder(fid, { mapsDone: true, mapsNote: text });
        await logProblem('maps', `${q.q}: ${text}`);
      }
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
  if (res.blocked) throw Object.assign(new Error('Google Maps showed a consent or verification page'), { blocked: true });
  return (res.items || []).map((x) => ({ ...x, source: 'maps' }));
}

/* ---------------------------------------------------------- Instagram */
/* A profile saved with the "Add to Lead Hunter" button on instagram.com. The page is read only when Samil presses
   the button, so nothing crawls Instagram. Phones, WhatsApp and emails come from the bio and its links. */
const escHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function addFromInstagram(p) {
  const username = String((p && p.username) || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return { error: 'This is not an Instagram profile' };
  const bio = String(p.bio || '').slice(0, 1000);
  const links = (Array.isArray(p.links) ? p.links : []).map(String).slice(0, 10);
  const contacts = LH.extractContacts(`<p>${escHtml(bio)}</p>${links.map((h) => `<a href="${escHtml(h)}">link</a>`).join('')}`, `https://www.instagram.com/${username}/`, 'AE');
  const site = links.map((h) => LH.unwrapLink(h)).find((u) => u && LH.linkKind(u) === 'website');
  const name = String(p.name || '').trim().slice(0, 160) || username;
  const item = {
    name,
    source: 'instagram',
    instagram: { username, fullName: name, bio, followers: String(p.followers || '').slice(0, 20) },
    website: site ? site.toString() : (links.map((h) => LH.unwrapLink(h)).find((u) => u && ['whatsapp', 'linkinbio'].includes(LH.linkKind(u))) || '').toString(),
    phones: contacts.phones,
    whatsapp: contacts.whatsapp,
    emails: contacts.emails,
  };
  const settings = await getSettings();
  const niche = LH.nicheOf({ keywords: [`${name} ${bio}`.toLowerCase()] }, settings);
  const r = await ingestProspects([item], { niche, country: 'AE' });
  return { added: r.added, ids: r.ids, contacted: r.contacted };
}

/* ------------------------------------------------------------- messages */
Object.assign(handlers, {
  'instagram:add': (msg) => addFromInstagram(msg.profile),
  'finder:start': async (msg) => ({ finder: await startFinder(msg.config || {}) }),
  'finder:stop': async () => {
    const { finder: f } = await store.get('finder');
    if (f && ['running', 'paused'].includes(f.status)) await patchFinder(f.id, { status: 'stopped', finishedAt: now() });
    return { ok: true };
  },
  'finder:pause': async () => {
    const f = await currentFinder();
    if (f) await patchFinder(f.id, { status: 'paused' });
    return { ok: true };
  },
  'finder:resume': async () => {
    const { finder: f } = await store.get('finder');
    if (f && f.status === 'paused') {
      await patchFinder(f.id, { status: 'running', mapsNote: null });
      await clearAlert('maps');
      runFinder();
    }
    return { ok: true };
  },
  'finder:reset': async (msg) => (await resetPreset(String(msg.preset || '')), { ok: true }),
  /** How far each preset has got: searches in total and finished. */
  'finder:progress': async () => {
    const settings = await getSettings();
    const out = {};
    for (const p of LH.presetsFor(settings)) {
      const { all, left } = await presetQueue(p, p.keywords, p.areas);
      out[p.name] = { total: all, done: all - left.length };
    }
    return { progress: out };
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
    const state = ['running', 'past', 'none'].includes(msg.state) ? msg.state : 'none';
    await updateLead(msg.id, (l) => (l.adCheck = { ...(l.adCheck || {}), state, manual: true, checkedAt: now() }));
    return { ok: true };
  },
  'ig:lookup': async (msg) => {
    const settings = await getSettings();
    if (!igReady(settings)) return { error: 'Add your Instagram account id and token in Settings > Quality signals first.' };
    const got = await store.get((msg.ids || []).map(leadKey));
    const ids = Object.values(got).filter((l) => LH.igHandle(l)).map((l) => l.id);
    await queueIg(ids);
    return { queued: ids.length, noHandle: (msg.ids || []).length - ids.length };
  },
  'ig:test': async () => {
    const settings = await getSettings();
    if (!igReady(settings)) return { error: 'Add your Instagram account id and token first, then Save.' };
    const r = await igApi(settings, settings.igAccountId, 'username,followers_count').catch((e) => ({ error: String(e.message || e) }));
    return r.error ? { error: r.error } : { username: r.username, followers: r.followers_count };
  },
  'ig:resume': async () => {
    await store.set({ igPaused: false });
    await clearAlert('instagram');
    runIg();
    return { ok: true };
  },
  'adcheck:pause': async () => (await store.set({ adCheckPaused: true }), { ok: true }),
  'adcheck:resume': async () => {
    await store.set({ adCheckPaused: false });
    await clearAlert('adlib');
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
