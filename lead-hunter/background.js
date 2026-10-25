/* Lead Hunter: background service worker.
   - Stores leads (one storage key per advertiser, all writes serialised here)
   - Runs hunts: walks a list of keywords through the Ad Library in one tab
   - Enriches leads: audits the landing page, finds phones/emails/socials,
     optional Google Places + PageSpeed lookups
   - Sends leads to the phone queue and the email queue on the user's site, and syncs them back */
importScripts('lib/common.js', 'lib/site-audit.js', 'lib/prospects.js');
const LH = self.LH;

const DASHBOARD = chrome.runtime.getURL('dashboard/dashboard.html');
const leadKey = (id) => `lead:${id}`;
const now = () => Date.now();

/* ------------------------------------------------------------------ storage */
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}
const store = chrome.storage.local;
async function getSettings() {
  const { settings } = await store.get('settings');
  return LH.withDefaults(settings);
}
async function getLead(id) {
  return (await store.get(leadKey(id)))[leadKey(id)] || null;
}
async function allLeads() {
  const all = await store.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith('lead:'))
    .map((k) => all[k]);
}
function updateLead(id, mutate) {
  return locked(async () => {
    const lead = await getLead(id);
    if (!lead) return null;
    mutate(lead);
    lead.updatedAt = now();
    await store.set({ [leadKey(id)]: lead });
    return lead;
  });
}

/* ------------------------------------------------------------ lead building */
function newLead(pageId) {
  return {
    id: pageId,
    pageId,
    pageName: '',
    pageUrl: '',
    avatar: '',
    pageLikes: null,
    categories: [],
    keywords: [],
    countries: [],
    hunts: [],
    ads: {},
    activeAdCount: 0,
    earliestStart: null,
    latestStart: null,
    website: null,
    landingUrl: null,
    websiteSource: null,
    destinationKind: null,
    ctaTypes: [],
    phones: [],
    emails: [],
    socials: {},
    site: { state: 'pending' },
    places: null,
    status: 'new',
    notes: '',
    createdAt: now(),
    updatedAt: now(),
    lastSeenAt: now(),
  };
}

/* Statuses that mean the lead was messaged. The first one records when, with which script, and the niche (Results panel). */
const SENT_STATUSES = ['contacted', 'followup', 'replied', 'meeting', 'won'];
function markSent(lead, at, script, settings, via) {
  if (!lead.contactedAt) lead.contactedAt = at;
  if (via) lead.contactedVia = via;
  if (script || !lead.sentScript) lead.sentScript = script || LH.sentScriptFor(lead);
  if (!lead.niche) lead.niche = LH.nicheOf(lead, settings) || '';
  remember(lead, lead.contactedVia || 'status', lead.contactedAt);
}
/** Back to "New": the lead counts as not contacted again. */
function unmarkSent(lead) {
  lead.contactedAt = null;
  lead.contactedVia = null;
  lead.sentScript = null;
  lead.repliedAt = null;
  forget(lead.id);
}

/* ------------------------------------------------------------ contacted memory */
/* Every business you contacted, exported or imported, kept even after its lead is deleted, so future searches
   never bring it back: { 'p:+97150…' | 'd:gloss.ae' | 'i:handle' | 'n:name@area': [at, via, leadId, name] }.
   Changes are queued and written in one go after the current storage operation. */
let historyOps = [];
let historyFlush = null;
function remember(lead, via, at = now()) {
  historyOps.push({ keys: LH.historyKeys(lead), entry: [at || now(), via, lead.id || '', String(lead.pageName || '').slice(0, 80)] });
  return flushHistory();
}
/** Forget what this lead added (and, on a reset, everything that matches the business). */
function forget(id, keys = []) {
  historyOps.push({ forget: id, keys });
  return flushHistory();
}
function flushHistory() {
  if (!historyFlush)
    historyFlush = Promise.resolve().then(() =>
      locked(async () => {
        historyFlush = null;
        const ops = historyOps;
        historyOps = [];
        const { contactHistory = {} } = await store.get('contactHistory');
        for (const op of ops) {
          if (op.entry) {
            // A lead's own entry keeps its first date. Imports only fill gaps.
            for (const k of op.keys) if (!contactHistory[k] || (op.entry[2] && contactHistory[k][2] !== op.entry[2])) contactHistory[k] = op.entry;
          } else {
            for (const [k, e] of Object.entries(contactHistory)) if ((op.forget && e[2] === op.forget) || op.keys.includes(k)) delete contactHistory[k];
          }
        }
        await store.set({ contactHistory });
      }),
    );
  return historyFlush;
}
/** Once per version of the memory: what was contacted before it existed, and the name index for fuzzy matching. */
async function seedMemory() {
  const { memoryVersion } = await store.get('memoryVersion');
  if (memoryVersion >= 1) return;
  const leads = await allLeads();
  for (const l of leads) if (l.contactedAt) remember(l, l.contactedVia || 'status', l.contactedAt);
  await flushHistory();
  await locked(async () => {
    const prospectNames = {};
    for (const l of leads) if (l.kind === 'prospect') LH.addName(prospectNames, l);
    await store.set({ prospectNames, memoryVersion: 1 });
  });
}

/** A Google Places "website" that is really an Instagram profile is saved as their Instagram. */
function placesInstagram(lead, places) {
  const handle = places && places.match && places.website ? LH.igFromUrl(places.website) : '';
  if (handle && !lead.socials.instagram) lead.socials.instagram = `https://www.instagram.com/${handle}/`;
}

function addPhone(lead, number, source) {
  if (!number) return;
  const hit = lead.phones.find((p) => p.number === number);
  if (!hit) lead.phones.push({ number, source });
  else if (/whatsapp/.test(source) && !/whatsapp|manual/.test(hit.source)) hit.source = source;
}

function mergeAd(lead, ad, ctx) {
  if (ad.pageName) lead.pageName = ad.pageName;
  if (ad.pageUrl && (!lead.pageUrl || !/facebook\.com\/\d+\/?$/.test(ad.pageUrl))) lead.pageUrl = ad.pageUrl;
  if (ad.avatar) lead.avatar = ad.avatar;
  if (ad.likes) lead.pageLikes = Math.max(lead.pageLikes || 0, ad.likes);
  for (const c of ad.categories || []) if (!lead.categories.includes(c)) lead.categories.push(c);
  lead.ads[ad.id] = {
    id: ad.id,
    active: ad.active,
    start: ad.start,
    end: ad.end,
    count: ad.count || 1,
    cta: ad.cta,
    ctaText: ad.ctaText,
    caption: ad.caption,
    title: ad.title,
    body: (ad.body || '').slice(0, 400),
    format: ad.format,
    platforms: ad.platforms || [],
    links: (ad.links || []).slice(0, 6),
    seenAt: now(),
  };
  const kw = (ctx.keyword || '').toLowerCase();
  if (kw && !lead.keywords.includes(kw)) lead.keywords.push(kw);
  if (ctx.country && ctx.country !== 'ALL' && !lead.countries.includes(ctx.country)) lead.countries.push(ctx.country);
  lead.lastSeenAt = now();
}

const CTA_DESTINATION = {
  WHATSAPP_MESSAGE: 'whatsapp',
  MESSAGE_PAGE: 'messenger',
  SEND_MESSAGE: 'messenger',
  INSTAGRAM_MESSAGE: 'instagram',
  CALL_NOW: 'phone',
  SIGN_UP: 'leadform',
  APPLY_NOW: 'leadform',
  GET_QUOTE: 'leadform',
  SUBSCRIBE: 'leadform',
};

function derive(lead, country) {
  let ads = Object.values(lead.ads);
  if (ads.length > 20) {
    ads.sort((a, b) => Number(b.active) - Number(a.active) || (b.start || 0) - (a.start || 0));
    lead.ads = Object.fromEntries(ads.slice(0, 20).map((a) => [a.id, a]));
    ads = ads.slice(0, 20);
  }
  const active = ads.filter((a) => a.active);
  lead.activeAdCount = active.reduce((s, a) => s + (a.count || 1), 0);
  const starts = (active.length ? active : ads).map((a) => a.start).filter(Boolean);
  lead.earliestStart = starts.length ? Math.min(...starts) : null;
  lead.latestStart = starts.length ? Math.max(...starts) : null;
  lead.ctaTypes = [...new Set(ads.map((a) => a.cta).filter(Boolean))];

  // Where the ads send people.
  const sites = new Map();
  const kinds = new Map();
  for (const a of ads) {
    for (const raw of a.links || []) {
      const u = LH.safeUrl(raw);
      const kind = LH.linkKind(u);
      if (!kind) continue;
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
      if (kind === 'website') {
        const clean = LH.cleanUrl(u);
        const origin = `${u.protocol}//${u.hostname}/`;
        const s = sites.get(origin) || { n: 0, landings: new Map() };
        s.n++;
        s.landings.set(clean, (s.landings.get(clean) || 0) + 1);
        sites.set(origin, s);
      }
      if (kind === 'whatsapp') addPhone(lead, LH.whatsappNumber(u), 'whatsapp-ad');
      if (kind === 'phone') addPhone(lead, LH.normalizePhone(raw, country), 'call-ad');
    }
    for (const m of (a.body || '').matchAll(/wa\.me\/(\d{8,15})/g)) addPhone(lead, LH.normalizePhone('+' + m[1]), 'whatsapp-ad');
    for (const n of LH.phonesInText(a.body, country)) addPhone(lead, n, 'ad-text');
  }
  if (sites.size) {
    const [origin, s] = [...sites.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (lead.websiteSource !== 'manual') {
      lead.website = origin;
      lead.landingUrl = [...s.landings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      lead.websiteSource = 'ad';
    }
  } else if (!lead.website) {
    // The ad's display caption is often the bare domain ("XYZCARCARE.AE").
    const cap = ads.map((a) => (a.caption || '').trim().toLowerCase()).find((c) => /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(c));
    if (cap && LH.linkKind('https://' + cap) === 'website') {
      lead.website = `https://${cap.replace(/^www\./, '')}/`;
      lead.landingUrl = lead.website;
      lead.websiteSource = 'caption';
    }
  }
  if (!lead.website) {
    const ctaKind = lead.ctaTypes.map((c) => CTA_DESTINATION[c]).find(Boolean);
    const linkKind = [...kinds.entries()].filter(([k]) => k !== 'website').sort((a, b) => b[1] - a[1])[0];
    lead.destinationKind = (linkKind && linkKind[0]) || ctaKind || 'facebook';
  } else lead.destinationKind = 'website';
}

function qualifies(lead, hunt) {
  const days = LH.daysRunning(lead);
  if (hunt.minDays && (days == null || days < hunt.minDays)) return false;
  if (hunt.maxDays && days != null && days > hunt.maxDays) return false;
  if (hunt.maxLikes && lead.pageLikes && lead.pageLikes > hunt.maxLikes) return false;
  if (hunt.requireActive && !lead.activeAdCount) return false;
  return true;
}

/* -------------------------------------------------------------------- intake */
async function ingest(ads, ctx = {}, tabId) {
  return locked(async () => {
    const settings = await getSettings();
    const country = ctx.country && ctx.country !== 'ALL' ? ctx.country : settings.country;
    const byPage = new Map();
    for (const ad of ads || []) {
      if (!ad || !ad.pageId || !ad.id) continue;
      if (!byPage.has(ad.pageId)) byPage.set(ad.pageId, []);
      byPage.get(ad.pageId).push(ad);
    }
    if (!byPage.size) return { added: 0 };
    const existing = await store.get([...byPage.keys()].map(leadKey));
    const { hunt, contactHistory } = await store.get(['hunt', 'contactHistory']);
    const huntTab = !!(hunt && hunt.status === 'running' && hunt.tabId === tabId);
    const writes = {};
    const enrich = [];
    let added = 0;

    for (const [pageId, list] of byPage) {
      const prev = existing[leadKey(pageId)];
      const lead = prev || newLead(pageId);
      const hadSite = lead.website;
      list.forEach((ad) => mergeAd(lead, ad, ctx));
      derive(lead, country);
      if (!prev && LH.historyHit(lead, contactHistory)) continue; // contacted before: never added again
      if (!lead.niche) lead.niche = LH.nicheOf(lead, settings) || ''; // from the hunt keywords, for the Results panel
      if (!prev) added++;
      if (huntTab && !lead.hunts.includes(hunt.id)) {
        lead.hunts.push(hunt.id);
        if (!prev && qualifies(lead, hunt)) {
          hunt.collected++;
          hunt.perKeyword[ctx.keyword] = (hunt.perKeyword[ctx.keyword] || 0) + 1;
        }
      }
      if (!prev || lead.website !== hadSite) {
        if (settings.autoEnrich) {
          lead.site = { state: 'queued' };
          enrich.push(pageId);
        } else lead.site = { state: 'pending' };
      }
      lead.updatedAt = now();
      writes[leadKey(pageId)] = lead;
    }
    let stop = false;
    if (huntTab) {
      hunt.lastActivity = now();
      stop = hunt.collected >= hunt.target;
      writes.hunt = hunt;
    }
    await store.set(writes);
    if (enrich.length) enqueue(enrich);
    return { added, stop, hunt: huntTab ? huntInfo(hunt) : null };
  });
}

/* --------------------------------------------------------------------- hunts */
const huntInfo = (h) => ({ onThisTab: true, keyword: h.keywords[h.index], index: h.index, total: h.keywords.length, collected: h.collected, target: h.target });

async function startHunt(cfg) {
  const settings = await getSettings();
  const keywords = [...new Set((cfg.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
  if (!keywords.length) throw new Error('Add at least one keyword');
  await stopHunt('replaced');
  const hunt = {
    id: `h${now().toString(36)}`,
    name: cfg.name || keywords[0],
    status: 'running',
    keywords,
    index: 0,
    country: cfg.country || settings.country,
    target: Math.max(1, Math.min(2000, Number(cfg.target) || 150)),
    minDays: Number(cfg.minDays) || 0,
    maxDays: Number(cfg.maxDays) || 0,
    maxLikes: Number(cfg.maxLikes) || 0,
    requireActive: true,
    collected: 0,
    perKeyword: {},
    startedAt: now(),
    lastActivity: now(),
    tabId: null,
  };
  // Register the tab before it loads so the content script recognises it as the hunt tab.
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  hunt.tabId = tab.id;
  await locked(() => store.set({ hunt }));
  await chrome.tabs.update(tab.id, { url: LH.adLibraryUrl({ keyword: keywords[0], country: hunt.country }) });
  return hunt;
}

async function nextKeyword(reason) {
  return locked(async () => {
    const { hunt } = await store.get('hunt');
    if (!hunt || hunt.status !== 'running') return;
    hunt.index++;
    hunt.lastActivity = now();
    if (hunt.collected >= hunt.target || hunt.index >= hunt.keywords.length) {
      hunt.status = 'done';
      hunt.finishedAt = now();
      hunt.finishReason = hunt.collected >= hunt.target ? 'target' : 'keywords';
      await store.set({ hunt });
      notify('Hunt finished', `${hunt.collected} new leads for “${hunt.name}”. Open the dashboard to review them.`);
      return;
    }
    await store.set({ hunt });
    try {
      await chrome.tabs.update(hunt.tabId, { url: LH.adLibraryUrl({ keyword: hunt.keywords[hunt.index], country: hunt.country }) });
    } catch {
      hunt.status = 'stopped';
      hunt.finishReason = 'tab-closed';
      await store.set({ hunt });
    }
  });
}

async function stopHunt(reason = 'stopped') {
  return locked(async () => {
    const { hunt } = await store.get('hunt');
    if (!hunt || hunt.status !== 'running') return;
    hunt.status = 'stopped';
    hunt.finishReason = reason;
    hunt.finishedAt = now();
    await store.set({ hunt });
  });
}

function notify(title, message) {
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title, message, priority: 1 });
  } catch {}
}

/* ---------------------------------------------------------------- enrichment */
const MAX_PARALLEL = 4;
const running = new Set();

async function enqueue(ids, front = false) {
  await locked(async () => {
    const { enrichQueue = [] } = await store.get('enrichQueue');
    const rest = enrichQueue.filter((id) => !ids.includes(id));
    await store.set({ enrichQueue: front ? [...ids, ...rest] : [...rest, ...ids] });
  });
  pump();
}

async function pump() {
  const { enrichQueue = [] } = await store.get('enrichQueue');
  for (const id of enrichQueue) {
    if (running.size >= MAX_PARALLEL) break;
    if (running.has(id)) continue;
    running.add(id);
    enrichOne(id)
      .catch((e) => console.warn('enrich failed', id, e))
      .finally(async () => {
        running.delete(id);
        await locked(async () => {
          const { enrichQueue: q = [] } = await store.get('enrichQueue');
          await store.set({ enrichQueue: q.filter((x) => x !== id) });
        });
        pump();
      });
  }
}

async function readCapped(res, max = 3_000_000) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  const buf = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, n), off);
    off += n;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function fetchPage(url, { timeout = 15000, allowHttpFallback = true } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    });
  } catch (e) {
    if (allowHttpFallback && /^https:/i.test(url)) {
      const r = await fetchPage(url.replace(/^https:/i, 'http:'), { timeout: 10000, allowHttpFallback: false });
      if (!r.error) return r; // site only works over plain http; the audit flags it
    }
    return { error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  const ttfbMs = performance.now() - t0;
  const server = res.headers.get('server') || '';
  if (!res.ok) {
    res.body && res.body.cancel().catch(() => {});
    // Bot walls (Cloudflare etc.) are not the site being broken, so do not pitch them as errors.
    const cf = /cloudflare|akamai|sucuri|imperva/i.test(server) || res.headers.get('cf-mitigated');
    if ([401, 403, 429].includes(res.status) || (res.status === 503 && cf)) return { error: 'blocked', status: res.status };
    return { error: 'http', status: res.status };
  }
  const type = res.headers.get('content-type') || '';
  if (type && !/html|xml|text\/plain/i.test(type)) {
    res.body && res.body.cancel().catch(() => {});
    return { error: 'http', status: `not a web page (${type.split(';')[0]})` };
  }
  const html = await readCapped(res);
  return {
    html,
    finalUrl: res.url || url,
    meta: {
      finalUrl: res.url || url,
      status: res.status,
      headers: { server },
      ttfbMs,
      totalMs: performance.now() - t0,
      bytes: new TextEncoder().encode(html).byteLength,
    },
  };
}

const nameMatch = (a, b) => LH.nameMatch(a, b);

async function placesLookup(lead, key, country) {
  const c = LH.country(country);
  const used = await placesBudget();
  const settings = await getSettings();
  if (used.count >= (Number(settings.placesMonthlyCap) || 950)) return { error: 'Monthly Google Places limit reached (see Settings).' };
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
      'x-goog-fieldmask':
        'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus',
    },
    body: JSON.stringify({ textQuery: `${lead.pageName}${c.code !== 'ALL' ? ', ' + c.name : ''}`, pageSize: 5, ...(c.code !== 'ALL' ? { regionCode: c.code } : {}) }),
  });
  await placesSpend(); // counts towards the same monthly limit as business searches (finder.js)
  if (!res.ok) return { error: `Google Places error ${res.status}` };
  const data = await res.json();
  const leadDomain = LH.domainOf(lead.website || '');
  const scored = (data.places || []).map((p) => {
    const name = (p.displayName && p.displayName.text) || '';
    let s = nameMatch(lead.pageName, name);
    if (leadDomain && p.websiteUri && LH.domainOf(p.websiteUri) === leadDomain) s += 1;
    return { p, name, s };
  });
  const best = scored.sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < 0.6) return { match: false, checkedAt: now() };
  const p = best.p;
  return {
    match: true,
    name: best.name,
    address: p.formattedAddress || '',
    phone: LH.normalizePhone(p.internationalPhoneNumber || p.nationalPhoneNumber || '', country),
    website: p.websiteUri || '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? null,
    mapsUrl: p.googleMapsUri || '',
    status: p.businessStatus || '',
    checkedAt: now(),
  };
}

async function pagespeed(url, key) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', 'mobile');
  ['performance', 'seo', 'accessibility', 'best-practices'].forEach((c) => api.searchParams.append('category', c));
  if (key) api.searchParams.set('key', key);
  const res = await fetch(api, { signal: AbortSignal.timeout(70000) });
  if (!res.ok) return { error: `PageSpeed error ${res.status}` };
  const d = await res.json();
  const cats = (d.lighthouseResult && d.lighthouseResult.categories) || {};
  const audits = (d.lighthouseResult && d.lighthouseResult.audits) || {};
  const sc = (k) => (cats[k] && typeof cats[k].score === 'number' ? Math.round(cats[k].score * 100) : null);
  const num = (k) => (audits[k] && typeof audits[k].numericValue === 'number' ? audits[k].numericValue : null);
  return {
    performance: sc('performance'),
    seo: sc('seo'),
    accessibility: sc('accessibility'),
    bestPractices: sc('best-practices'),
    lcp: num('largest-contentful-paint'),
    cls: num('cumulative-layout-shift'),
    checkedAt: now(),
  };
}

function applyPsi(site, psi) {
  site.psi = psi;
  site.issues = (site.issues || []).filter((i) => i.id !== 'psi');
  if (typeof psi.performance === 'number' && psi.performance < 60) {
    site.issues.push(LH.issue('psi', psi.performance < 35 ? 'high' : 'medium', psi.performance));
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    site.issues.sort((a, b) => rank[a.sev] - rank[b.sev]);
  }
}

async function enrichOne(id, opts = {}) {
  const lead = await getLead(id);
  if (!lead) return;
  const settings = await getSettings();
  const country = lead.countries[0] || (settings.country !== 'ALL' ? settings.country : 'AE');
  await updateLead(id, (l) => (l.site = { ...(l.site || {}), state: 'running' }));

  let places = lead.places;
  let website = lead.website;
  let websiteSource = lead.websiteSource;
  const wantPlaces = settings.placesKey && (settings.placesAuto || opts.places);
  if (wantPlaces && !website && !(places && places.checkedAt)) {
    places = await placesLookup(lead, settings.placesKey, country).catch((e) => ({ error: String(e.message || e) }));
    if (places && places.match && places.website && LH.linkKind(places.website) === 'website') {
      website = new URL(places.website).origin + '/';
      websiteSource = 'google';
    }
  }

  let site = { state: 'none', checkedAt: now() };
  const contacts = { phones: [], whatsapp: [], emails: [], socials: {} };
  const mergeContacts = (c) => {
    contacts.phones.push(...c.phones);
    contacts.whatsapp.push(...c.whatsapp);
    contacts.emails.push(...c.emails);
    for (const [k, v] of Object.entries(c.socials)) contacts.socials[k] = contacts.socials[k] || v;
  };

  if (website) {
    const target = (websiteSource === 'ad' && lead.landingUrl) || website;
    const page = await fetchPage(target);
    if (page.error === 'blocked') {
      site = { state: 'blocked', status: page.status, issues: [], note: 'The site blocked the automatic check. Open it to review manually.' };
    } else if (page.error) {
      site = LH.auditError(page.error, page.status);
    } else {
      site = LH.auditHtml(page.html, page.meta);
      site.finalUrl = page.finalUrl;
      const first = LH.extractContacts(page.html, page.finalUrl, country);
      mergeContacts(first);
      // No phone or no email on the landing page: try the homepage, then any contact pages.
      const found = () => (contacts.phones.length || contacts.whatsapp.length) && contacts.emails.length;
      const todo = [new URL(page.finalUrl).origin + '/', ...first.contactPages];
      const tried = new Set([LH.cleanUrl(page.finalUrl)]);
      while (todo.length && tried.size < 4 && !found()) {
        const u = todo.shift();
        if (tried.has(LH.cleanUrl(u))) continue;
        tried.add(LH.cleanUrl(u));
        const p = await fetchPage(u, { timeout: 10000, allowHttpFallback: false });
        if (p.error) continue;
        const c = LH.extractContacts(p.html, p.finalUrl, country);
        mergeContacts(c);
        todo.push(...c.contactPages);
      }
    }
    site.checkedAt = now();
  }

  const hasPhone = lead.phones.length || contacts.phones.length || contacts.whatsapp.length;
  if (wantPlaces && !hasPhone && !(places && places.checkedAt)) {
    places = await placesLookup({ ...lead, website }, settings.placesKey, country).catch((e) => ({ error: String(e.message || e) }));
  }

  if ((settings.pagespeedAuto || opts.psi) && site.state === 'ok' && !site.parked) {
    const psi = await pagespeed(site.finalUrl || website, settings.pagespeedKey).catch((e) => ({ error: String(e.message || e) }));
    if (psi && !psi.error) applyPsi(site, psi);
    else site.psiError = psi && psi.error;
  }

  await updateLead(id, (l) => {
    if (website && !l.website) {
      l.website = website;
      l.landingUrl = website;
      l.websiteSource = websiteSource;
      l.destinationKind = 'website';
    }
    l.site = site;
    if (places) l.places = places;
    placesInstagram(l, places);
    contacts.whatsapp.forEach((n) => addPhone(l, n, 'whatsapp-site'));
    contacts.phones.forEach((n) => addPhone(l, n, 'website'));
    if (places && places.match && places.phone) addPhone(l, places.phone, 'google');
    l.phones = l.phones.slice(0, 8);
    l.emails = [...new Set([...(l.emails || []), ...contacts.emails])].slice(0, 5);
    l.socials = { ...contacts.socials, ...(l.socials || {}) };
    l.enrichedAt = now();
  });
}

/* --------------------------------------------------------------- phone queue */
// Talks to /api/lead-queue (netlify/functions/lead-queue.mts) or /api/email-queue (email-queue.mts) on the user's site.
// Both use the same key.
const QUEUE_ERRORS = {
  401: 'The queue key does not match LEAD_QUEUE_KEY on your site.',
  404: 'Your site does not have the phone queue yet. Deploy the latest site code first.',
  503: 'The phone queue is not switched on yet: add LEAD_QUEUE_KEY in Netlify, then redeploy.',
};
const EMAIL_ERRORS = {
  ...QUEUE_ERRORS,
  404: 'Your site does not have the email sender yet. Deploy the latest site code first.',
  503: 'The email sender is not switched on yet: add LEAD_QUEUE_KEY in Netlify, then redeploy.',
};
async function queueApi(method, body, path = '/api/lead-queue') {
  const email = path.startsWith('/api/email-queue');
  const s = await getSettings();
  if (!s.queueKey || !s.queueSite) throw new Error('Set up the phone queue in Settings first.');
  let url;
  try {
    url = new URL(path, s.queueSite).toString();
  } catch {
    throw new Error('The site address in Settings is not a valid URL.');
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${s.queueKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Could not reach ${new URL(url).host}.`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((email ? EMAIL_ERRORS : QUEUE_ERRORS)[res.status] || (data && data.error) || `${email ? 'Email sender' : 'Phone queue'} error (HTTP ${res.status}).`);
  return data;
}
// Reads leave out the email texts: Lead Hunter writes them itself and only needs where each one stands.
const emailApi = (method, body) => queueApi(method, body, method === 'GET' ? '/api/email-queue?lite=1' : '/api/email-queue');

/** Mirror the server queue onto leads: "sent" on the phone marks the lead as contacted. */
async function applyQueue(items) {
  const byId = new Map((items || []).map((i) => [i.id, i]));
  const settings = await getSettings();
  return locked(async () => {
    const { phoneQueueIds = [] } = await store.get('phoneQueueIds');
    const ids = [...new Set([...phoneQueueIds, ...byId.keys()])];
    const got = await store.get(ids.map(leadKey));
    const writes = {};
    let contacted = 0;
    for (const id of ids) {
      const lead = got[leadKey(id)];
      if (!lead) continue;
      const item = byId.get(id);
      const before = JSON.stringify([lead.phoneQueue, lead.status]);
      const prev = lead.phoneQueue || null;
      if (!item) lead.phoneQueue = null;
      else {
        // Each phone "sent" is applied once, so later syncs never override a status set by hand.
        const seen = prev && prev.state === item.status && prev.at === item.statusAt && prev.rev === item.addedAt;
        lead.phoneQueue = { state: item.status, at: item.statusAt, rev: item.addedAt, by: seen ? prev.by : undefined, from: seen ? prev.from : undefined };
        if (!seen && item.status === 'sent' && ['new', 'followup'].includes(lead.status)) {
          lead.phoneQueue.by = 'phone';
          lead.phoneQueue.from = lead.status;
          lead.status = 'contacted';
          markSent(lead, item.statusAt, lead.queuedScript || null, settings, 'whatsapp');
          lead.statusHistory = [...(lead.statusHistory || []), { status: 'contacted', at: item.statusAt, via: 'phone' }].slice(-20);
          contacted++;
        }
        // Undo on the phone (back to "To send" or removed) reverts a "contacted" that the phone caused.
        if (!seen && item.status !== 'sent' && prev && prev.by === 'phone' && lead.status === 'contacted') {
          lead.status = prev.from || 'new';
          if (lead.status === 'new') unmarkSent(lead);
          lead.statusHistory = [...(lead.statusHistory || []), { status: lead.status, at: now(), via: 'phone-undo' }].slice(-20);
        }
      }
      if (JSON.stringify([lead.phoneQueue, lead.status]) !== before) {
        lead.updatedAt = now();
        writes[leadKey(id)] = lead;
      }
    }
    // Only leads still waiting on the phone need watching.
    writes.phoneQueueIds = ids.filter((id) => byId.get(id) && byId.get(id).status === 'queued');
    writes.phoneQueueSyncedAt = now();
    await store.set(writes);
    return { contacted, waiting: writes.phoneQueueIds.length };
  });
}

/* Status changes made on the computer for leads waiting on the phone are batched and retried until they land. */
let mirrorTimer = 0;
async function mirrorToPhone(update) {
  await locked(async () => {
    const { queuePending = [] } = await store.get('queuePending');
    await store.set({ queuePending: [...queuePending.filter((u) => u.id !== update.id), update] });
  });
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => flushMirror().catch(() => {}), 400);
}
async function flushMirror() {
  const { queuePending = [] } = await store.get('queuePending');
  if (!queuePending.length) return null;
  const q = await queueApi('POST', { updates: queuePending }); // throws: entries stay for the next try
  await locked(async () => {
    const { queuePending: now_ = [] } = await store.get('queuePending');
    const sent = (u) => queuePending.some((x) => x.id === u.id && x.status === u.status && x.rev === u.rev);
    await store.set({ queuePending: now_.filter((u) => !sent(u)) });
  });
  return q;
}

const FINISHED_KEEP_MS = 3 * LH.DAY;
async function syncQueue() {
  await flushMirror().catch(() => {});
  const q = await queueApi('GET');
  const result = await applyQueue(q.items);
  // Only the extension cleans up the server, and only items it has just applied, so no "sent" is ever lost.
  const old = q.items.filter((i) => i.status !== 'queued' && now() - i.statusAt > FINISHED_KEEP_MS).map((i) => i.id);
  if (old.length) await queueApi('DELETE', { ids: old }).catch(() => {});
  return result;
}

/* Each lead goes to the phone as its bubbles (`parts`) plus the whole text (`message`). The phone page only
   prefills WhatsApp; Samil presses Send himself. Leads skipped for running ads stay off the phone. */
async function pushToQueue(ids, overrides = {}) {
  const settings = await getSettings();
  const got = await store.get(ids.map(leadKey));
  const items = [];
  const skipped = [];
  const runningAds = [];
  const scripts = {};
  for (const id of ids) {
    const lead = got[leadKey(id)];
    if (!lead) continue;
    const o = overrides[id] || {};
    const number = o.phone || LH.whatsappTarget(lead) || (LH.bestPhone(lead) || {}).number;
    if (!number) {
      skipped.push(lead.pageName || id);
      continue;
    }
    const pitch = LH.pitchFor(lead, settings);
    const given = Array.isArray(o.parts) && o.parts.length ? o.parts : o.message ? [o.message] : pitch.bubbles;
    const parts = given.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
    if (!parts.length) {
      runningAds.push(lead.pageName || id);
      continue;
    }
    scripts[lead.id] = o.script || pitch.script || LH.sentScriptFor(lead);
    const p = LH.priority(lead);
    items.push({
      id: lead.id,
      name: lead.pageName,
      wa: number.replace(/\D/g, ''),
      message: parts.join('\n\n'),
      parts,
      domain: LH.domainOf(lead.website || ''),
      issue: LH.tagLine(lead),
      heat: LH.heat(p),
      priority: p,
      pageUrl: lead.pageUrl,
    });
  }
  if (!items.length) return { queued: 0, skipped, runningAds };
  const q = await queueApi('PUT', { items });
  await locked(async () => {
    const { phoneQueueIds = [] } = await store.get('phoneQueueIds');
    // Which script each lead's bubbles came from: a "sent" on the phone records that one, even if the lead changes meanwhile.
    const fresh = await store.get(items.map((i) => leadKey(i.id)));
    const writes = { phoneQueueIds: [...new Set([...phoneQueueIds, ...items.map((i) => i.id)])] };
    for (const i of items) if (fresh[leadKey(i.id)]) writes[leadKey(i.id)] = { ...fresh[leadKey(i.id)], queuedScript: scripts[i.id] };
    await store.set(writes);
  });
  await applyQueue(q.items);
  return { queued: items.length, skipped, runningAds };
}

/* --------------------------------------------------------------- email queue */
// Cold emails go out from Samil's own Gmail through lead-hunter/email/sender.gs, an Apps Script in his Google account,
// one at a time and slowly. Every sending rule lives on the site; the extension adds emails and mirrors what happened.
const STOP_EMAILS = ['replied', 'meeting', 'won', 'lost', 'skip']; // statuses that end a lead's follow ups
const EMAIL_SYNC_MS = 5 * 60000;
const EMAIL_WATCH_MS = 21 * LH.DAY; // the sender still picks up replies to finished emails this long
const emailInfo = (q) => ({ stats: q.stats, settings: q.settings, senderSeenAt: q.senderSeenAt, pausedReason: q.pausedReason, pausedUntil: q.pausedUntil, now: q.now });

/** Mirror the email queue onto leads: the first email marks the lead contacted, a reply marks it replied. */
async function applyEmail(items) {
  const settings = await getSettings();
  return locked(async () => {
    const { emailQueueIds = [] } = await store.get('emailQueueIds');
    const list = (items || []).filter((i) => emailQueueIds.includes(i.id));
    const got = await store.get(list.map((i) => leadKey(i.id)));
    const writes = {};
    for (const item of list) {
      const lead = got[leadKey(item.id)];
      if (!lead) continue;
      const before = JSON.stringify([lead.emailQueue, lead.status, lead.badEmails, lead.doNotEmail]);
      const prev = lead.emailQueue || {};
      const total = (item.steps && item.steps.length) || item.total || prev.total || item.sent;
      lead.emailQueue = { state: item.status, sent: item.sent, total, nextAt: item.nextAt, at: item.statusAt, email: item.email };
      // Each change is applied once, so later syncs never override a status set by hand.
      if (item.sent >= 1 && !(prev.sent >= 1) && ['new', 'followup'].includes(lead.status)) {
        lead.status = 'contacted';
        markSent(lead, item.sentAt[0], item.script, settings, 'email');
        lead.statusHistory = [...(lead.statusHistory || []), { status: 'contacted', at: item.sentAt[0], via: 'email' }].slice(-20);
      }
      if (item.status === 'replied' && prev.state !== 'replied' && ['new', 'contacted', 'followup'].includes(lead.status)) {
        lead.status = 'replied';
        lead.repliedAt = lead.repliedAt || item.statusAt;
        lead.statusHistory = [...(lead.statusHistory || []), { status: 'replied', at: item.statusAt, via: 'email' }].slice(-20);
      }
      if (item.status === 'bounced' && prev.state !== 'bounced') lead.badEmails = [...new Set([...(lead.badEmails || []), item.email])];
      // "No thanks" is a reply too: the lead is not interested and is never emailed again.
      if (item.status === 'optout' && prev.state !== 'optout') {
        lead.doNotEmail = true;
        if (['new', 'contacted', 'followup'].includes(lead.status)) {
          lead.status = 'lost';
          lead.repliedAt = lead.repliedAt || item.statusAt;
          lead.statusHistory = [...(lead.statusHistory || []), { status: 'lost', at: item.statusAt, via: 'email' }].slice(-20);
        }
      }
      if (JSON.stringify([lead.emailQueue, lead.status, lead.badEmails, lead.doNotEmail]) !== before) {
        lead.updatedAt = now();
        writes[leadKey(item.id)] = lead;
      }
    }
    // Only emails still going out, or finished recently enough for a reply to come in, need watching.
    const watch = (i) => got[leadKey(i.id)] && (['queued', 'active'].includes(i.status) || (i.status === 'done' && now() - i.statusAt < EMAIL_WATCH_MS));
    writes.emailQueueIds = list.filter(watch).map((i) => i.id);
    writes.emailSyncedAt = now();
    await store.set(writes);
    return { waiting: writes.emailQueueIds.length };
  });
}

/* Stopping a lead's emails is kept and retried every minute until the site has it, so no follow up goes out by mistake. */
async function cancelEmails(ids) {
  await locked(async () => {
    const { emailCancel = [] } = await store.get('emailCancel');
    await store.set({ emailCancel: [...new Set([...emailCancel, ...ids])] });
  });
  const q = await flushEmailCancel();
  await applyEmail(q.items);
  return q;
}
async function flushEmailCancel() {
  const { emailCancel = [] } = await store.get('emailCancel');
  if (!emailCancel.length) return null;
  const q = await emailApi('POST', { action: 'cancel', ids: emailCancel }); // throws: the ids stay for the next try
  await locked(async () => {
    const { emailCancel: cur = [] } = await store.get('emailCancel');
    await store.set({ emailCancel: cur.filter((id) => !emailCancel.includes(id)) });
  });
  return q;
}

async function syncEmail() {
  const q = (await flushEmailCancel().catch(() => null)) || (await emailApi('GET'));
  await applyEmail(q.items);
  // Emails queued before Lead Hunter knew an address was a template placeholder: stop them before they bounce.
  const junk = q.items.filter((i) => i.status === 'queued' && LH.isJunkEmail(i.email)).map((i) => i.id);
  return junk.length ? cancelEmails(junk) : q;
}

/* Each lead goes in as its first email and follow ups. Leads skipped for running ads, leads without an address
   to send to, leads emailed before, leads already messaged another way and leads you are talking to stay out. */
async function pushToEmail(ids) {
  const settings = await getSettings();
  const got = await store.get(ids.map(leadKey));
  const items = [];
  const names = {};
  const skipped = { noEmail: [], runningAds: [], already: [], contacted: [], closed: [] };
  for (const id of ids) {
    const lead = got[leadKey(id)];
    if (!lead) continue;
    const name = lead.pageName || id;
    const mail = LH.emailFor(lead, settings);
    const q = lead.emailQueue;
    if (!mail.to) skipped.noEmail.push(name);
    else if (!mail.script) skipped.runningAds.push(name);
    else if (q && (q.sent >= 1 || q.state !== 'cancelled')) skipped.already.push(name);
    else if (STOP_EMAILS.includes(lead.status)) skipped.closed.push(name);
    else if (lead.contactedAt) skipped.contacted.push(name); // already messaged on WhatsApp: one channel per business
    else {
      names[id] = name;
      items.push({ id, email: mail.to, business: lead.pageName, script: mail.script, fromName: settings.emailFromName, subject: mail.subject, steps: mail.steps, followupDays: [3, 4] });
    }
  }
  if (!items.length) return { queued: 0, rejected: [], skipped };
  const q = await emailApi('PUT', { items });
  await locked(async () => {
    const { emailQueueIds = [] } = await store.get('emailQueueIds');
    await store.set({ emailQueueIds: [...new Set([...emailQueueIds, ...items.map((i) => i.id)])] });
  });
  await applyEmail(q.items);
  return { queued: q.accepted, rejected: q.rejected.map((r) => ({ name: names[r.id] || r.id, reason: r.reason })), skipped };
}

/* ------------------------------------------------------------------ messages */
async function openDashboard(hash = '') {
  const tabs = await chrome.tabs.query({ url: DASHBOARD + '*' });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true, ...(hash ? { url: DASHBOARD + hash } : {}) });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url: DASHBOARD + hash });
}

async function huntForTab(tabId) {
  const { hunt } = await store.get('hunt');
  return hunt && hunt.status === 'running' && hunt.tabId === tabId ? huntInfo(hunt) : null;
}

const handlers = {
  hello: async (msg, sender) => ({ hunt: await huntForTab(sender.tab && sender.tab.id) }),
  ads: (msg, sender) => ingest(msg.ads, msg.ctx, sender.tab && sender.tab.id),
  'hunt:keywordDone': async (msg, sender) => {
    const { hunt } = await store.get('hunt');
    if (hunt && hunt.status === 'running' && sender.tab && hunt.tabId === sender.tab.id) await nextKeyword(msg.reason);
    return { ok: true };
  },
  'hunt:start': async (msg) => ({ hunt: await startHunt(msg.config) }),
  'hunt:stop': async () => (await stopHunt('stopped'), { ok: true }),
  'open:dashboard': async (msg) => (await openDashboard(msg.hash), { ok: true }),
  'lead:update': async (msg) => {
    const settings = await getSettings();
    const lead = await updateLead(msg.id, (l) => {
      const p = msg.patch || {};
      if (p.status && p.status !== l.status) {
        l.statusHistory = [...(l.statusHistory || []), { status: p.status, at: now() }].slice(-20);
        if (SENT_STATUSES.includes(p.status)) markSent(l, now(), p.sentScript, settings, p.via);
        if (p.status === 'replied' && !l.repliedAt) l.repliedAt = now();
        if (p.status === 'new') unmarkSent(l);
      }
      else if (p.via && SENT_STATUSES.includes(l.status)) markSent(l, l.contactedAt, null, settings, p.via); // the channel, set afterwards
      if ('repliedAt' in p && !p.repliedAt) l.repliedAt = null; // "Replied" tapped again
      for (const k of ['status', 'notes', 'pageName', 'followUpAt']) if (k in p) l[k] = p[k];
      if (p.addPhone) addPhone(l, LH.normalizePhone(p.addPhone, l.countries[0] || 'AE'), 'manual');
      if (p.removePhone) l.phones = l.phones.filter((x) => x.number !== p.removePhone);
      if (p.addEmail) l.emails = [...new Set([...(l.emails || []), String(p.addEmail).trim().toLowerCase()])];
      if ('website' in p) {
        const u = LH.safeUrl(p.website);
        l.website = u ? u.origin + '/' : null;
        l.landingUrl = u ? LH.cleanUrl(u) : null;
        l.websiteSource = u ? 'manual' : null;
        l.destinationKind = u ? 'website' : l.destinationKind;
      }
    });
    if (msg.patch && 'website' in msg.patch) enqueue([msg.id], true);
    const pq = lead && lead.phoneQueue;
    if (pq && pq.state === 'queued' && ['contacted', 'replied', 'meeting', 'won', 'lost', 'skip'].includes(msg.patch && msg.patch.status)) {
      mirrorToPhone({ id: msg.id, status: msg.patch.status === 'contacted' ? 'sent' : 'removed', rev: pq.rev });
    }
    const eq = lead && lead.emailQueue;
    if (eq && ['queued', 'active'].includes(eq.state) && STOP_EMAILS.includes(msg.patch && msg.patch.status)) cancelEmails([msg.id]).catch(() => {});
    return { lead };
  },
  /* Contacted memory. Reset: the business is new again and future searches can find it. */
  'lead:reset': async (msg) => {
    const lead = await updateLead(msg.id, (l) => {
      if (l.status !== 'new') l.statusHistory = [...(l.statusHistory || []), { status: 'new', at: now(), via: 'reset' }].slice(-20);
      l.status = 'new';
      unmarkSent(l);
    });
    if (lead) await forget(lead.id, LH.historyKeys(lead));
    return { lead };
  },
  /** Exported to Google Contacts: saved on your phone, so treated as contacted from now on. */
  'history:add': async (msg) => {
    const got = await store.get((msg.ids || []).map(leadKey));
    for (const l of Object.values(got)) remember(l, msg.via || 'export');
    await flushHistory();
    return { ok: true };
  },
  /** Phone numbers from a CSV (your sheet of contacted numbers, or a Google Contacts export). */
  'history:import': async (msg) => {
    const settings = await getSettings();
    const phones = LH.phonesInCsv(msg.text, settings.country || 'AE');
    const { contactHistory = {} } = await store.get('contactHistory');
    const fresh = phones.filter((n) => !contactHistory[`p:${n}`]);
    for (const n of fresh) remember({ phones: [n] }, msg.via || 'import');
    await flushHistory();
    return { found: phones.length, added: fresh.length };
  },
  'history:clear': async () => {
    await locked(() => store.set({ contactHistory: {} }));
    return { ok: true };
  },
  'lead:delete': async (msg) => {
    await locked(() => store.remove((msg.ids || []).map(leadKey)));
    return { ok: true };
  },
  'lead:recheck': async (msg) => {
    for (const id of msg.ids || []) await updateLead(id, (l) => (l.site = { ...(l.site || {}), state: 'queued' }));
    await enqueue(msg.ids || [], true);
    return { ok: true };
  },
  'lead:places': async (msg) => {
    const settings = await getSettings();
    if (!settings.placesKey) return { error: 'Add a Google Places API key in Settings first.' };
    const lead = await getLead(msg.id);
    const places = await placesLookup(lead, settings.placesKey, lead.countries[0] || settings.country).catch((e) => ({ error: String(e.message || e) }));
    const updated = await updateLead(msg.id, (l) => {
      l.places = places;
      if (places.match && places.phone) addPhone(l, places.phone, 'google');
      placesInstagram(l, places);
      if (places.match && places.website && !l.website && LH.linkKind(places.website) === 'website') {
        l.website = new URL(places.website).origin + '/';
        l.landingUrl = l.website;
        l.websiteSource = 'google';
        l.destinationKind = 'website';
      }
    });
    if (updated && updated.websiteSource === 'google' && (!lead.website || lead.website !== updated.website)) enqueue([msg.id], true);
    return { places };
  },
  'lead:psi': async (msg) => {
    const settings = await getSettings();
    const lead = await getLead(msg.id);
    if (!lead || !lead.website) return { error: 'No website to test.' };
    const psi = await pagespeed((lead.site && lead.site.finalUrl) || lead.website, settings.pagespeedKey).catch((e) => ({ error: String(e.message || e) }));
    if (psi.error) return psi;
    await updateLead(msg.id, (l) => l.site && l.site.state === 'ok' && applyPsi(l.site, psi));
    return { psi };
  },
  'leads:import': async (msg) => {
    let n = 0;
    await locked(async () => {
      const writes = {};
      for (const l of msg.leads || []) {
        if (!l || !l.id) continue;
        writes[leadKey(l.id)] = l;
        n++;
      }
      await store.set(writes);
    });
    return { imported: n };
  },
  'queue:push': (msg) => pushToQueue(msg.ids || [], msg.overrides || {}),
  'queue:sync': () => syncQueue(),
  'queue:test': async () => {
    const q = await queueApi('GET');
    await applyQueue(q.items);
    return { ok: true, total: q.items.length, waiting: q.items.filter((i) => i.status === 'queued').length };
  },
  'queue:clear': async () => {
    await flushMirror().catch(() => {});
    const q = await queueApi('GET');
    const result = await applyQueue(q.items);
    const done = q.items.filter((i) => i.status !== 'queued').map((i) => i.id);
    if (done.length) await queueApi('DELETE', { ids: done });
    return result;
  },
  'email:push': (msg) => pushToEmail(msg.ids || []),
  'email:sync': async () => emailInfo(await syncEmail()),
  'email:status': async () => emailInfo(await syncEmail()),
  'email:settings': async (msg) => emailInfo(await emailApi('POST', { action: 'settings', settings: msg.settings || {} })),
  'email:cancel': async (msg) => emailInfo(await cancelEmails(msg.ids || [])),
  // Never email this lead (remove: allow it again). The site's never list also stops emails already queued.
  'email:never': async (msg) => {
    const lead = await updateLead(msg.id, (l) => (l.doNotEmail = !msg.remove));
    const emails = ((lead && lead.emails) || []).filter((e) => !(msg.remove && (lead.badEmails || []).includes(e)));
    if (!emails.length || !(await getSettings()).queueKey) return { ok: true };
    const q = await emailApi('POST', { action: 'never', emails, remove: !!msg.remove });
    await applyEmail(q.items);
    return { ok: true };
  },
  stats: async () => {
    const leads = await allLeads();
    const { hunt, enrichQueue = [] } = await store.get(['hunt', 'enrichQueue']);
    return {
      total: leads.length,
      hot: leads.filter((l) => LH.heat(LH.priority(l)) === 'hot' && l.status === 'new').length,
      withPhone: leads.filter((l) => l.phones.length).length,
      queued: enrichQueue.length,
      hunt,
    };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender))
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

/* ------------------------------------------------------- lifecycle & timers */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { hunt } = await store.get('hunt');
  if (hunt && hunt.status === 'running' && hunt.tabId === tabId) stopHunt('tab-closed');
});

chrome.alarms.get('tick', (a) => {
  if (!a) chrome.alarms.create('tick', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'tick') return;
  pump();
  // Watchdog: a hunt tab that has gone quiet (login wall, crash) moves on.
  const { hunt } = await store.get('hunt');
  if (hunt && hunt.status === 'running' && now() - hunt.lastActivity > 150000) nextKeyword('stalled');
  const { phoneQueueIds = [], queuePending = [], emailQueueIds = [], emailCancel = [], emailSyncedAt = 0 } = await store.get(['phoneQueueIds', 'queuePending', 'emailQueueIds', 'emailCancel', 'emailSyncedAt']);
  if (phoneQueueIds.length || queuePending.length) syncQueue().catch(() => {});
  if (emailCancel.length || (emailQueueIds.length && now() - emailSyncedAt >= EMAIL_SYNC_MS)) syncEmail().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await store.get('settings');
  if (!settings) await store.set({ settings: LH.DEFAULT_SETTINGS });
  else if (LH.hasOldSettings(settings)) await store.set({ settings: LH.withDefaults(settings) }); // old templates and offer
  if (reason === 'install') openDashboard('#welcome');
  await seedMemory();
});
chrome.runtime.onStartup.addListener(() => pump());
pump();

// Meta-ads prospecting (Google Maps / Instagram finder + Ad Library checks).
importScripts('finder.js');
