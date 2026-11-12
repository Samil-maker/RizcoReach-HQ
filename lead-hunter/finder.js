/* Lead Hunter: businesses from Google Maps and Instagram (loaded by background.js, shares its scope).
   1. FIND businesses on Google Maps: preset keywords x areas, read from the results list in a Maps tab. The list
      shows Google's own "Recently opened" / "Opening soon" label, which is the best proof a business is new.
   2. Their website is checked (down, parked, working), their Instagram is read through Meta's official API
      (bio email, recent posts, how new the account is), and their Facebook page Intro is read for an email.
   Businesses are stored like leads (`lead:p:…`, kind: 'prospect') so the dashboard and the exports work on them. */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

/* ------------------------------------------------------------- prospects */
function newProspect(id) {
  return Object.assign(newLead(id), { kind: 'prospect', pageId: null, sources: {}, niche: '', area: '', destinationKind: null });
}

// Pure helpers live in lib/prospects.js (unit-tested).
const prospectKeys = (item) => LH.prospectKeys(item);

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
  if (item.maps && item.maps.open) {
    // Google's own label on the listing: the proof they just opened (or are about to).
    const o = item.maps.open;
    LH.addOpenSignal(lead, { kind: o.kind === 'soon' ? 'soon' : 'google', text: o.text, at: now(), openedAt: o.openedAt, opensAt: o.opensAt, url: item.maps.mapsUrl });
    item = { ...item, maps: { ...item.maps } };
    delete item.maps.open;
  }
  // Their Instagram bio saying "now open" is a hint for you, not proof: bios say it for years.
  if (item.instagram && LH.openingWords(item.instagram.bio)) LH.addOpenSignal(lead, { kind: 'bio', text: LH.openingWords(item.instagram.bio), at: now() });
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
  else if (kind === 'facebook' && !lead.socials.facebook) lead.socials.facebook = LH.cleanUrl(u);
  lead.destinationKind = lead.website ? 'website' : lead.socials.instagram ? 'instagram' : null;

  for (const n of item.whatsapp || []) addPhone(lead, n, item.source === 'instagram' ? 'whatsapp-ig' : 'whatsapp-site');
  for (const n of item.phones || []) addPhone(lead, n, item.source === 'maps' ? 'google' : 'instagram');
  lead.phones = lead.phones.slice(0, 8);
  lead.emails = [...new Set([...(lead.emails || []), ...(item.emails || []).map((e) => e.toLowerCase())])].slice(0, 5);
  if (item.emailFrom) lead.emailFrom = { ...item.emailFrom, ...(lead.emailFrom || {}) }; // where each email was found
  lead.lastSeenAt = now();
  lead.updatedAt = now();
}

/**
 * Add or merge found businesses. Returns the ids of the new ones.
 * In a preset search a new business must pass the preset first: its Google review count (read from the results
 * list) and its exclude words. What was dropped and why is counted on the run.
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
        // A listing Google marks as new has few reviews by nature: the lower limit never drops it.
        const isNewListing = !!(item.maps && item.maps.open);
        const why = reviews < preset.minReviews && !isNewListing ? 'fewReviews' : reviews > preset.maxReviews ? 'manyReviews' : LH.excludeHit(preset, item.name, item.category) ? 'excluded' : '';
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
    const counted = fresh;
    if (run && ['running', 'paused'].includes(run.status)) {
      run.added += counted.length;
      run.found += (items || []).length;
      stats.kept += counted.length;
      stats.opened = (stats.opened || 0) + counted.filter((id) => LH.opening(touched.get(id), settings)).length;
      run.lastActivity = now();
      writes.finder = run;
    }
    for (const id of counted) {
      const l = touched.get(id);
      if (LH.ownWebsite(l)) l.site = { state: 'queued' };
    }
    await store.set(writes);
    const websites = counted.filter((id) => LH.ownWebsite(touched.get(id)));
    return { added: counted.length, ids: counted, websites, contacted, leads: counted.map((id) => touched.get(id)) };
  });
  igAuto(result.leads, settings);
  queueEmailChecks(result.ids);
  // No website: nothing else will find an email, so their Facebook page is next. With a website, after its check.
  fbEmailAuto(result.leads.filter((l) => !LH.ownWebsite(l)), settings);
  if (result.websites.length) enqueue(result.websites);
  return result;
}

/* -------------------------------------------------------------- check tab */
// One background tab for pages Lead Hunter opens on Facebook (a business's page, for the email in its Intro).
/** One page at a time in the check tab. */
let checkTabChain = Promise.resolve();
function withCheckTab(fn) {
  const run = checkTabChain.then(fn, fn);
  checkTabChain = run.catch(() => {});
  return run;
}

async function checkTab() {
  const { checkTabId } = await store.get('checkTabId');
  if (checkTabId) {
    try {
      const t = await chrome.tabs.get(checkTabId);
      if (t) return t.id;
    } catch {}
  }
  const t = await chrome.tabs.create({ url: 'about:blank', active: false });
  await store.set({ checkTabId: t.id });
  return t.id;
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
const SOURCE_NAMES = { adlib: 'Meta Ad Library', maps: 'Google Maps', instagram: 'Instagram API', fbpage: 'Facebook pages', verify: 'Email check' };
async function alertSource(source, text, url, hint = 'Open the tab, sort it out, then press Resume in Lead Hunter.') {
  await logProblem(source, text);
  await locked(async () => {
    const { alerts = {} } = await store.get('alerts');
    alerts[source] = { at: now(), text, url: url || '', hint };
    await store.set({ alerts });
  });
  await refreshBadge();
  notify(`${SOURCE_NAMES[source] || source} paused`, `${text}. ${hint}`);
}
async function clearAlert(source) {
  await locked(async () => {
    const { alerts = {} } = await store.get('alerts');
    delete alerts[source];
    await store.set({ alerts });
  });
  await refreshBadge();
}

/* -------------------------------------------------------- Instagram (API) */
/* Meta's official Instagram Graph API (Business Discovery), with your own token: nothing is read from
   instagram.com. For a business or creator account it gives followers, the bio (often with their email), the link
   in the bio and their latest posts, which say whether they just opened. A personal account, or a handle that does
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
// Business Discovery (other accounts' followers) needs more than reading your own account does.
const IG_PERMS = 'instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement and business_management';
/** What to do about a stopping error, in words. */
function igHint(r) {
  if ([10, 200].includes(r.code)) return `Your token is missing a permission. In the Graph API Explorer make a new token with ${IG_PERMS}, extend it, paste it in Settings > Instagram, then press Resume.`;
  if ([190, 102].includes(r.code)) return 'Your token has expired or was changed. Make a new one (Settings > Instagram has the steps), then press Resume.';
  if (r.code === 100) return 'Check your Instagram business account id in Settings > Instagram, then press Resume.';
  return 'Meta is limiting requests for now. Wait an hour, then press Resume.';
}
const igTime = (t) => Date.parse(String(t || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) || null; // "2026-10-20T10:00:00+0000"
async function igLookup(handle, settings) {
  const r = await igApi(settings, settings.igAccountId, `business_discovery.username(${handle}){followers_count,media_count,username,name,biography,website,media.limit(12){caption,timestamp,permalink}}`);
  if (r.error) return r;
  const b = r.business_discovery || {};
  const posts = (((b.media || {}).data) || []).map((m) => ({ caption: String(m.caption || '').slice(0, 600), at: igTime(m.timestamp), url: String(m.permalink || '') })).filter((m) => m.at);
  const media = typeof b.media_count === 'number' ? b.media_count : null;
  return {
    followers: typeof b.followers_count === 'number' ? b.followers_count : null,
    media,
    lastPostAt: posts.length ? Math.max(...posts.map((m) => m.at)) : null,
    // Every post they ever made came back: the oldest one is when the account started.
    firstPostAt: posts.length && media != null && media <= posts.length ? Math.min(...posts.map((m) => m.at)) : null,
    bio: String(b.biography || '').slice(0, 1000),
    link: String(b.website || ''),
    posts,
  };
}
/** What the lookup says, onto the lead: emails in the bio, the link, and proof of an opening. */
function applyIg(l, handle, r) {
  l.igStats = { handle, followers: r.followers, media: r.media, lastPostAt: r.lastPostAt, firstPostAt: r.firstPostAt, at: now(), from: 'api' };
  if (r.bio) l.sources = { ...(l.sources || {}), instagram: { username: handle, ...((l.sources || {}).instagram || {}), bio: r.bio } };
  const found = LH.emailsInText(r.bio);
  if (found.length) {
    l.emails = [...new Set([...(l.emails || []), ...found])].slice(0, 5);
    l.emailFrom = { ...Object.fromEntries(found.map((e) => [e, 'instagram'])), ...(l.emailFrom || {}) };
  }
  const u = r.link ? LH.unwrapLink(r.link) : null;
  const kind = u && LH.linkKind(u);
  let newSite = false;
  if (kind === 'website' && !l.website) {
    l.website = `${u.protocol}//${u.hostname}/`;
    l.landingUrl = LH.cleanUrl(u);
    l.websiteSource = 'instagram';
    l.destinationKind = 'website';
    l.site = { state: 'queued' };
    newSite = true;
  } else if (kind === 'whatsapp') addPhone(l, LH.whatsappNumber(u), 'whatsapp-ig');
  else if (kind === 'linkinbio' && !(l.socials || {}).linkinbio) l.socials = { ...(l.socials || {}), linkinbio: LH.cleanUrl(u) };
  // Their own words in a recent post, and a brand new account, are proof. The bio alone is only a hint.
  for (const m of r.posts) {
    const said = now() - m.at < 120 * LH.DAY ? LH.openingWords(m.caption) : '';
    if (said) LH.addOpenSignal(l, { kind: 'caption', text: said, at: m.at, openedAt: m.at, url: m.url });
  }
  if (r.firstPostAt && now() - r.firstPostAt < 90 * LH.DAY) {
    const days = Math.max(1, Math.round((now() - r.firstPostAt) / LH.DAY));
    LH.addOpenSignal(l, { kind: 'newig', text: `Their Instagram started ${days < 14 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(days / 7)} weeks`} ago`, at: now(), openedAt: r.firstPostAt });
  }
  if (LH.openingWords(r.bio)) LH.addOpenSignal(l, { kind: 'bio', text: LH.openingWords(r.bio), at: now() });
  return newSite;
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
/** New businesses with an Instagram handle and no lookup yet, when the API is set up and Look up automatically is on. */
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
          await alertSource('instagram', `Instagram API: ${r.error}`, '', igHint(r));
          break;
        }
        if (r.error) logProblem('instagram', `@${handle}: ${r.error}`);
        let newSite = false;
        const after = await updateLead(id, (l) => {
          if (r.error) l.igStats = { handle, error: r.error, at: now() };
          else newSite = applyIg(l, handle, r);
        });
        if (newSite) enqueue([id]);
        if (after && !r.error) {
          queueEmailChecks([id]);
          fbEmailAuto([after], settings);
        }
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

/* ------------------------------------------------ emails on Facebook pages */
/* Leads with no email, and no website or a weak one: their Facebook page opens in the check tab, the way you would
   open it yourself, and an email shown on it (its Intro) is kept. One page every few seconds. A login wall,
   checkpoint or block pauses these lookups with an alert: nothing tries to get past it. */
let fbBusy = false;
let pendingFb = null; // { id, tabId, resolve }
async function queueFbEmails(ids, front = false) {
  if (!ids.length) return;
  for (const id of ids) await updateLead(id, (l) => (l.fbEmail = { state: 'queued' }));
  await locked(async () => {
    const { fbEmailQueue = [] } = await store.get('fbEmailQueue');
    const rest = fbEmailQueue.filter((x) => !ids.includes(x));
    await store.set({ fbEmailQueue: front ? [...ids, ...rest] : [...rest, ...ids] });
  });
  runFbEmails();
}
/** New or newly checked leads worth a look, when Look for emails on Facebook pages is on. */
function fbEmailAuto(leads, settings) {
  if (!settings.fbEmailAuto) return;
  queueFbEmails((leads || []).filter((l) => LH.wantsFacebookEmail(l, settings)).map((l) => l.id));
}
/** Open their page in the check tab and wait for the content script (content/social-scan.js) to read it. */
async function readFacebookPage(lead, url) {
  const tabId = await checkTab();
  const res = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 40000);
    pendingFb = { id: lead.id, tabId, resolve: (r) => (clearTimeout(timer), resolve(r)) };
    chrome.tabs.update(tabId, { url }).catch(() => resolve({ error: 'tab' }));
  });
  pendingFb = null;
  if (res.timeout || res.error) {
    // A login or checkpoint page may never run the reader: the tab's address says it.
    const at = await chrome.tabs.get(tabId).then((t) => t.url || '').catch(() => '');
    if (/facebook\.com\/(login|checkpoint)/.test(at)) return { blocked: /checkpoint/.test(at) ? 'Facebook showed a security check' : 'Facebook asked you to log in' };
    return { loaded: false };
  }
  return res;
}
async function runFbEmails() {
  if (fbBusy) return;
  fbBusy = true;
  try {
    for (;;) {
      const { fbEmailQueue = [], alerts = {} } = await store.get(['fbEmailQueue', 'alerts']);
      if (!fbEmailQueue.length || alerts.fbpage) break;
      const id = fbEmailQueue[0];
      const lead = await getLead(id);
      const url = lead && LH.facebookPageUrl(lead);
      if (url && !LH.goodEmails(lead)[0]) {
        const r = await withCheckTab(() => readFacebookPage(lead, url)).catch((e) => ({ loaded: false, error: String(e.message || e) }));
        if (r.blocked) {
          // This lead stays first in the queue and the lookups wait until you press Resume.
          await alertSource('fbpage', r.blocked, url, 'Sort it out in the tab Lead Hunter opened, then press Resume on the Leads tab.');
          break;
        }
        const emails = LH.emailsInPage((r.emails || []).join(' ') + ' ' + (r.text || ''));
        if (!r.loaded) logProblem('fbpage', `${lead.pageName || url}: the page did not load`);
        await updateLead(id, (l) => {
          l.fbEmail = { state: emails.length ? 'found' : r.loaded ? 'none' : 'error', at: now(), url };
          if (!emails.length) return;
          l.emails = [...new Set([...(l.emails || []), ...emails])].slice(0, 5);
          l.emailFrom = { ...Object.fromEntries(emails.map((e) => [e, 'facebook'])), ...(l.emailFrom || {}) };
        });
        if (emails.length) queueEmailChecks([id]);
        await sleep(jitter(4000, 9000)); // human pace on Facebook
      } else if (lead && (lead.fbEmail || {}).state === 'queued') await updateLead(id, (l) => delete l.fbEmail);
      await locked(async () => {
        const { fbEmailQueue: q = [] } = await store.get('fbEmailQueue');
        await store.set({ fbEmailQueue: q.filter((x) => x !== id) });
      });
    }
  } finally {
    fbBusy = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => a.name === 'tick' && runFbEmails());

/* ---------------------------------------------------------- Google Maps */
/* Searches run in a Google Maps tab and the results list is read: it is the only place that shows Google's
   "Recently opened" label. (The Places API key in Settings is only used to look single businesses up.)
   Those lookups count towards a monthly limit so the free allowance is not passed by accident. */
async function placesBudget() {
  const month = new Date().toISOString().slice(0, 7);
  const { placesUsage } = await store.get('placesUsage');
  return placesUsage && placesUsage.month === month ? placesUsage : { month, count: 0 };
}
async function placesSpend() {
  const u = await placesBudget();
  await store.set({ placesUsage: { month: u.month, count: u.count + 1 } });
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
  const all = keywords.flatMap((keyword) => areas.map((area) => ({ q: `${keyword} ${area}`, keyword, area, niche: preset.name })));
  return { all: all.length, left: all.filter((x) => !done[comboKey(x.keyword, x.area)]) };
}
/* "All types": area by area, the main keyword of every preset, then their second keyword. Each search is
   remembered under its own preset, so running that preset later carries on from here. */
const ALL_TYPES = 'All types';
async function mixQueue(presets, settings) {
  const { searchDone = {} } = await store.get('searchDone');
  const areas = LH.presetAreas(null, settings);
  const all = [];
  for (let round = 0; round < 2; round++)
    for (const area of areas)
      for (const p of presets) if (p.keywords[round]) all.push({ q: `${p.keywords[round]} ${area}`, keyword: p.keywords[round], area, niche: p.name });
  return { all: all.length, left: all.filter((x) => !(searchDone[x.niche] || {})[comboKey(x.keyword, x.area)]) };
}

async function startFinder(cfg) {
  const settings = await getSettings();
  const presets = LH.presetsFor(settings);
  const mix = cfg.niche === ALL_TYPES;
  const preset = presets.find((n) => n.name === cfg.niche) || presets[0];
  let queue;
  if (mix) queue = await mixQueue(presets, settings);
  else {
    const keywords = LH.parseKeywords(cfg.keywords && cfg.keywords.length ? cfg.keywords : preset.keywords);
    if (!keywords.length) throw new Error('Pick a preset or add keywords.');
    queue = await presetQueue(preset, keywords, cfg.areas && cfg.areas.length ? LH.parseLines(cfg.areas).slice(0, 300) : LH.presetAreas(preset, settings));
  }
  const { all, left } = queue;
  if (!all) throw new Error('No areas to search. Add some in Settings.');
  if (!left.length) throw new Error(`Every search of ${mix ? ALL_TYPES : preset.name} has been run. Press Start over to run them again.`);
  const cap = Math.max(1, Math.min(1000, Math.round(Number(cfg.cap)) || 100));
  const finder = {
    id: `f${now().toString(36)}`,
    status: 'running',
    niche: mix ? ALL_TYPES : preset.name,
    city: LH.cityOf(left[0].area, settings.adsCity || 'Dubai'),
    country: 'AE',
    cap,
    mapsQ: left.slice(0, cap),
    mapsI: 0,
    mapsDone: false,
    mapsNote: '',
    planned: all,
    leftBefore: left.length,
    found: 0,
    added: 0,
    // What happened to everything found: the before and after of the filters, and how many Google says just opened.
    stats: { found: 0, duplicate: 0, fewReviews: 0, manyReviews: 0, excluded: 0, kept: 0, opened: 0 },
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
    if (name === ALL_TYPES) await store.set({ searchDone: {} });
    else {
      delete searchDone[name];
      await store.set({ searchDone });
    }
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
      notify('Business search finished', `${finder.added} new businesses from ${(finder.stats || {}).found || finder.found} found, ${(finder.stats || {}).opened || 0} that Google says just opened. Their websites and emails are being checked.`);
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
    const niche = q.niche || f.niche;
    const ctx = { finderId: fid, niche, keyword: q.keyword, area: q.area, country: f.country };
    try {
      const items = await mapsBrowserSearch(q.q);
      await ingestProspects(items, ctx);
      await markSearchDone(niche, q);
      await patchFinder(fid, (x) => ({ mapsI: x.mapsI + 1 }));
      await sleep(jitter(2500, 5000)); // one search at a time, a human pace between them
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

/* Run the search in a Google Maps tab and read the results list. */
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
  // The public business email on the profile (its Email or Contact button, or the profile's own data).
  const shown = LH.emailsInPage((Array.isArray(p.emails) ? p.emails : []).map(String).join(' '));
  const site = links.map((h) => LH.unwrapLink(h)).find((u) => u && LH.linkKind(u) === 'website');
  const name = String(p.name || '').trim().slice(0, 160) || username;
  const item = {
    name,
    source: 'instagram',
    instagram: { username, fullName: name, bio, followers: String(p.followers || '').slice(0, 20) },
    website: site ? site.toString() : (links.map((h) => LH.unwrapLink(h)).find((u) => u && ['whatsapp', 'linkinbio'].includes(LH.linkKind(u))) || '').toString(),
    phones: contacts.phones,
    whatsapp: contacts.whatsapp,
    emails: [...new Set([...shown, ...contacts.emails])],
    emailFrom: Object.fromEntries(shown.map((e) => [e, 'instagram'])),
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
    const presets = LH.presetsFor(settings);
    for (const p of presets) {
      const { all, left } = await presetQueue(p, p.keywords, LH.presetAreas(p, settings));
      out[p.name] = { total: all, done: all - left.length };
    }
    const mix = await mixQueue(presets, settings);
    out[ALL_TYPES] = { total: mix.all, done: mix.all - mix.left.length };
    return { progress: out };
  },
  'maps:hello': async (msg, sender) => ({ search: pendingMaps && sender.tab && sender.tab.id === pendingMaps.tabId ? pendingMaps.query : null }),
  'maps:results': async (msg, sender) => {
    if (pendingMaps && sender.tab && sender.tab.id === pendingMaps.tabId) pendingMaps.resolve(msg);
    return { ok: true };
  },
  'ig:lookup': async (msg) => {
    const settings = await getSettings();
    if (!igReady(settings)) return { error: 'Add your Instagram account id and token in Settings > Instagram first.' };
    const got = await store.get((msg.ids || []).map(leadKey));
    const ids = Object.values(got).filter((l) => LH.igHandle(l)).map((l) => l.id);
    await queueIg(ids);
    return { queued: ids.length, noHandle: (msg.ids || []).length - ids.length };
  },
  'ig:test': async () => {
    const settings = await getSettings();
    if (!igReady(settings)) return { error: 'Add your Instagram account id and token first, then Save.' };
    const r = await igApi(settings, settings.igAccountId, 'username,followers_count').catch((e) => ({ error: String(e.message || e) }));
    if (r.error) return { error: igStop(r) ? `${r.error}. ${igHint(r)}` : r.error };
    // A real lookup, as on any business (your own account works too): it needs more permissions than the read above.
    const d = await igLookup(String(r.username || '').toLowerCase(), settings).catch((e) => ({ error: String(e.message || e) }));
    if (d.error) return { error: `Your account reads fine, but looking up other businesses failed: ${d.error}. ${igStop(d) ? igHint(d) : ''}`.trim() };
    return { username: r.username, followers: r.followers_count };
  },
  /** The check tab loaded a Facebook page: is it one Lead Hunter asked for? */
  'fbpage:hello': async (msg, sender) => ({ read: !!(pendingFb && sender.tab && sender.tab.id === pendingFb.tabId), id: pendingFb && pendingFb.id }),
  'fbpage:result': async (msg, sender) => {
    if (pendingFb && sender.tab && sender.tab.id === pendingFb.tabId && msg.id === pendingFb.id) pendingFb.resolve(msg);
    return { ok: true };
  },
  /** Look on these leads' Facebook pages now (the lead panel button). */
  'fbemail:check': async (msg) => {
    const ids = [];
    for (const id of msg.ids || []) {
      const l = await getLead(id);
      if (l && LH.facebookPageUrl(l)) ids.push(id);
    }
    if (!ids.length) return { error: 'No Facebook page known for them.' };
    for (const id of ids) await updateLead(id, (l) => delete l.fbEmail);
    await queueFbEmails(ids, true);
    return { queued: ids.length };
  },
  'fbemail:resume': async () => {
    await clearAlert('fbpage');
    runFbEmails();
    return { ok: true };
  },
  /** Dismiss an alert that has no queue of its own to resume (the Ad Library search stopped at a wall). */
  'alert:clear': async (msg) => (await clearAlert(String(msg.source || '')), { ok: true }),
  'ig:resume': async () => {
    await store.set({ igPaused: false });
    await clearAlert('instagram');
    runIg();
    return { ok: true };
  },
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { checkTabId, mapsTabId } = await store.get(['checkTabId', 'mapsTabId']);
  if (tabId === checkTabId) await store.remove('checkTabId');
  if (tabId === mapsTabId) await store.remove('mapsTabId');
});

// Resume after the worker restarts (Chrome stops idle service workers).
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'tick') return;
  if (await currentFinder()) runFinder();
});
runFinder();
