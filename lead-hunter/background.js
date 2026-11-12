/* Lead Hunter: background service worker.
   - Stores leads (one storage key per business, all writes serialised here)
   - Runs hunts: walks a list of keywords through the Ad Library in one tab
   - Checks each lead's website (down, parked, working) and finds phones, emails and socials on it
   - Marks leads saved by Export for cold email (the cold email system on the Mac sends the emails)
   finder.js finds businesses on Google Maps, checks.js checks every email address, intent.js is Intent Radar. */
importScripts('lib/common.js', 'lib/emails.js', 'lib/fit.js', 'lib/site-audit.js', 'lib/prospects.js', 'lib/intent.js', 'lib/intent-db.js');
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

/* Statuses that mean the lead was messaged. The first one records when. */
const SENT_STATUSES = ['contacted', 'followup', 'replied', 'meeting', 'won'];
function markSent(lead, at, settings, via) {
  if (!lead.contactedAt) lead.contactedAt = at;
  if (via) lead.contactedVia = via;
  if (!lead.niche) lead.niche = LH.nicheOf(lead, settings) || '';
  remember(lead, lead.contactedVia || 'status', lead.contactedAt);
}
/** Back to "New": the lead counts as not contacted again. */
function unmarkSent(lead) {
  lead.contactedAt = null;
  lead.contactedVia = null;
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

/**
 * No website known, but an email address at a domain of their own (info@glowsalon.ae): that domain is their website
 * until the check says otherwise. Without this a business with a working site could be told it has none.
 */
function siteFromEmail(lead) {
  if (LH.ownWebsite(lead) || lead.websiteSource === 'manual') return false;
  const email = LH.goodEmails(lead).find((e) => !LH.isFreeMail(e));
  const domain = email ? email.split('@').pop() : '';
  if (!domain || LH.linkKind(`https://${domain}/`) !== 'website') return false;
  lead.website = `https://${domain}/`;
  lead.landingUrl = lead.website;
  lead.websiteSource = 'email';
  lead.destinationKind = 'website';
  lead.site = { state: 'queued' };
  return true;
}
/** New addresses on a lead: maybe a website to check, and the addresses themselves to check. */
async function afterEmails(id, front = false) {
  let site = false;
  await updateLead(id, (l) => (site = siteFromEmail(l)));
  if (site) enqueue([id], front);
  queueEmailChecks([id], front);
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
      for (const ad of list) {
        // An ad that started lately and announces their opening is proof they are new. So is nothing else in an ad.
        const said = ad.active && ad.start && now() - ad.start < (Number(settings.newDays) || 120) * LH.DAY ? LH.openingWords(`${ad.title || ''}. ${ad.body || ''}`) : '';
        if (said) LH.addOpenSignal(lead, { kind: 'ad', text: said, at: ad.start, openedAt: ad.start, url: LH.pageAdsUrl(pageId, country) });
        const inAd = LH.emailsInText(ad.body || '', 2);
        if (inAd.length) {
          lead.emails = [...new Set([...(lead.emails || []), ...inAd])].slice(0, 5);
          lead.emailFrom = { ...Object.fromEntries(inAd.map((e) => [e, 'ad'])), ...(lead.emailFrom || {}) };
        }
      }
      siteFromEmail(lead);
      if (!prev && LH.historyHit(lead, contactHistory)) continue; // contacted before: never added again
      if (!lead.niche) lead.niche = LH.nicheOf(lead, settings) || ''; // from the hunt keywords
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
    queueEmailChecks(Object.keys(writes).filter((k) => k.startsWith('lead:')).map((k) => k.slice(5)));
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
  await placesSpend(); // counted, so the free monthly allowance is not passed by accident (finder.js)
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
    l.emailFrom = { ...Object.fromEntries(contacts.emails.map((e) => [e, 'website'])), ...(l.emailFrom || {}) };
    l.socials = { ...contacts.socials, ...(l.socials || {}) };
    l.enrichedAt = now();
  });
  const done = await getLead(id);
  if (!done) return;
  igAuto([done], settings); // the website may have linked their Instagram
  fbEmailAuto([done], settings); // it fits and still has no email: their Facebook page next
  queueEmailChecks([id]); // the website's state is known now, so is whether a mailbox check is worth it
}

/* ---------------------------------------------------------------- cold email */
// Lead Hunter no longer sends email. The cold email system (cold-email/, on the Mac) imports the file from
// Export for cold email and writes, sends and follows up itself. Leads emailed by the old email queue keep their
// emailQueue record, so they stay out of that file. The Netlify function is left on the site, unused.

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
  /** The Ad Library showed a login page, a security check or a block: stop there and say so. */
  'hunt:blocked': async (msg, sender) => {
    const { hunt } = await store.get('hunt');
    if (!hunt || hunt.status !== 'running' || !sender.tab || hunt.tabId !== sender.tab.id) return { ok: false };
    await stopHunt('blocked');
    await alertSource('adlib', String(msg.reason || 'Facebook showed a wall').slice(0, 120), String(msg.url || ''), 'Sort it out in that tab, then start the hunt again from the Find tab.');
    return { ok: true };
  },
  'hunt:start': async (msg) => (await clearAlert('adlib'), { hunt: await startHunt(msg.config) }),
  'hunt:stop': async () => (await stopHunt('stopped'), { ok: true }),
  'open:dashboard': async (msg) => (await openDashboard(msg.hash), { ok: true }),
  'lead:update': async (msg) => {
    const settings = await getSettings();
    const lead = await updateLead(msg.id, (l) => {
      const p = msg.patch || {};
      if (p.status && p.status !== l.status) {
        l.statusHistory = [...(l.statusHistory || []), { status: p.status, at: now() }].slice(-20);
        if (SENT_STATUSES.includes(p.status)) markSent(l, now(), settings, p.via);
        if (p.status === 'replied' && !l.repliedAt) l.repliedAt = now();
        if (p.status === 'new') unmarkSent(l);
      }
      else if (p.via && SENT_STATUSES.includes(l.status)) markSent(l, l.contactedAt, settings, p.via); // the channel, set afterwards
      if ('repliedAt' in p && !p.repliedAt) l.repliedAt = null; // "Replied" tapped again
      for (const k of ['status', 'notes', 'pageName', 'followUpAt']) if (k in p) l[k] = p[k];
      // Just opened, your own call: true = new, false = not new whatever was found, null = go by what was found.
      if ('justOpened' in p) {
        if (p.justOpened == null) delete l.justOpened;
        else l.justOpened = !!p.justOpened;
      }
      // Never email: keeps them out of the cold email file.
      if ('doNotEmail' in p) l.doNotEmail = !!p.doNotEmail;
      if (p.addPhone) addPhone(l, LH.normalizePhone(p.addPhone, l.countries[0] || 'AE'), 'manual');
      if (p.removePhone) l.phones = l.phones.filter((x) => x.number !== p.removePhone);
      if (p.addEmail) {
        // Typed by you: cleaned like any other (a typo in the ending is fixed), and checked like any other.
        const c = LH.cleanEmail(p.addEmail);
        const added = c.email || String(p.addEmail).trim().toLowerCase();
        l.emails = [...new Set([...(l.emails || []), added])];
        l.emailFrom = { ...(l.emailFrom || {}), [added]: 'manual' };
        l.badEmails = (l.badEmails || []).filter((x) => x !== added);
      }
      if (p.removeEmail) {
        const gone = String(p.removeEmail).toLowerCase();
        l.emails = (l.emails || []).filter((x) => String(x).toLowerCase() !== gone && LH.cleanEmail(x).email !== gone);
      }
      // It bounced: never used again for this lead.
      if (p.badEmail) l.badEmails = [...new Set([...(l.badEmails || []), String(p.badEmail).toLowerCase()])];
      if ('website' in p) {
        const u = LH.safeUrl(p.website);
        l.website = u ? u.origin + '/' : null;
        l.landingUrl = u ? LH.cleanUrl(u) : null;
        l.websiteSource = u ? 'manual' : null;
        l.destinationKind = u ? 'website' : l.destinationKind;
      }
    });
    if (msg.patch && 'website' in msg.patch) enqueue([msg.id], true);
    if (msg.patch && msg.patch.addEmail) await afterEmails(msg.id, true);
    else if (msg.patch && 'justOpened' in msg.patch) queueEmailChecks([msg.id], true);
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
  /** Remember these as contacted, so future searches never bring them back. */
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
  /** Saved by Export for cold email: they stay out of the next file unless Include already exported is ticked. */
  'cold:exported': async (msg) => {
    const t = now();
    for (const id of msg.ids || []) {
      const l = await updateLead(id, (x) => (x.coldEmailExportedAt = t));
      if (l) remember(l, 'cold-email', t); // a later search never brings them back, even after the lead is deleted
    }
    await flushHistory();
    return { ok: true };
  },
  stats: async () => {
    const leads = await allLeads();
    const settings = await getSettings();
    const { hunt, finder, enrichQueue = [], emailCheckQueue = [], mailboxQueue = [] } = await store.get(['hunt', 'finder', 'enrichQueue', 'emailCheckQueue', 'mailboxQueue']);
    const open = leads.filter((l) => LH.coldEmailOpen(l) && !l.coldEmailExportedAt);
    const fits = open.filter((l) => LH.fit(l, settings).fit);
    return {
      total: leads.length,
      fits: fits.length,
      ready: fits.filter((l) => LH.sendableEmail(l, settings).email).length, // would go into the cold email file now
      queued: enrichQueue.length,
      checking: emailCheckQueue.length + mailboxQueue.length,
      hunt,
      finder,
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
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await store.get('settings');
  if (!settings) await store.set({ settings: LH.DEFAULT_SETTINGS });
  else if (LH.hasOldSettings(settings)) await store.set({ settings: LH.withDefaults(settings) }); // old templates and offer
  if (reason === 'install') openDashboard('#welcome');
  await store.remove(['phoneQueueIds', 'queuePending', 'phoneQueueSyncedAt']); // the phone queue is gone (1.12)
  await store.remove(['emailQueueIds', 'emailCancel', 'emailSyncedAt']); // so is the email sender (2.3)
  await store.remove(['adCheckQueue', 'adCheckPaused', 'adCheckTabId']); // and the Meta ads check (3.0)
  await seedMemory();
});
chrome.runtime.onStartup.addListener(() => pump());
pump();

// Businesses from Google Maps and Instagram.
importScripts('finder.js');
// Email checks: the domain of every address, the mailbox of the ones that matter.
importScripts('checks.js');
// Intent Radar: people asking for help on Reddit, Facebook groups and LinkedIn.
importScripts('intent.js');
