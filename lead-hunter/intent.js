/* Lead Hunter: Intent Radar (loaded by background.js after finder.js, shares its scope).
   Finds people asking for a website or marketing help, owners complaining business is slow, and companies hiring
   for marketing, from the last 14 days:
   - Reddit, every few hours through Reddit's API (r/dubai, r/UAE, r/abudhabi, r/sharjah, r/smallbusiness with UAE
     mentions only), a few seconds apart;
   - Facebook groups and LinkedIn posts and jobs, only when you press Scan on a page you have open yourself.
   Every post goes through LH.intentProcess (lib/intent.js) and is saved once in IndexedDB (lib/intent-db.js). */

/* --------------------------------------------------------------- badge */
/** The icon: a red ! while a source is paused, else the number of new intent posts you have not seen. */
async function refreshBadge() {
  const { alerts = {}, intentState = {} } = await store.get(['alerts', 'intentState']);
  const paused = Object.keys(alerts).length;
  const fresh = intentState.unseen || 0;
  try {
    chrome.action.setBadgeBackgroundColor({ color: paused ? '#d93025' : '#1a73e8' });
    chrome.action.setBadgeText({ text: paused ? '!' : fresh ? String(Math.min(fresh, 99)) : '' });
  } catch {}
}

/* -------------------------------------------------------------- saving */
/** Links a post to a lead you already have (same name, or their website in the post): the lead gets the heat bonus. */
async function linkIntent(posts) {
  const wanted = posts.filter((p) => p.company || /https?:\/\//.test(p.text || ''));
  if (!wanted.length) return;
  const leads = await allLeads();
  const byName = new Map(leads.map((l) => [LH.normName(l.pageName), l]).filter(([n]) => n.length > 3));
  const byDomain = new Map(leads.filter((l) => l.website).map((l) => [LH.rootDomain(l.website), l]));
  for (const p of wanted) {
    const domains = ((p.text || '').match(/https?:\/\/[^\s)]+/g) || []).map((u) => LH.rootDomain(u));
    const lead = (p.company && byName.get(LH.normName(p.company))) || domains.map((d) => byDomain.get(d)).find(Boolean);
    if (!lead) continue;
    p.leadId = lead.id;
    const at = p.createdAt || now();
    await updateLead(lead.id, (l) => {
      if (p.categories.includes('hiring')) l.hiring = { at, url: p.url, title: p.title || '' };
      else l.intent = { at, url: p.url, summary: p.summary };
    });
  }
}

/** Runs raw posts from one source through the rules, saves the new ones, and says what happened. */
async function saveIntent(raws, source, opts = {}) {
  const settings = await getSettings();
  const t = now();
  const stats = { source, at: t, seen: raws.length, saved: 0, duplicates: 0, nomatch: 0, seller: 0, old: 0, foreign: 0 };
  const kept = [];
  for (const raw of raws) {
    const r = LH.intentProcess({ ...raw, createdAt: raw.createdAt || LH.parseAge(raw.ageText, t) }, settings, t, { needUae: !!opts.needUae || !!raw.needUae });
    if (r.keep) kept.push({ ...r.post, foundAt: t, status: 'new' });
    else stats[r.why]++;
  }
  await linkIntent(kept);
  const { added, duplicates } = await LH.intentDb.add(kept);
  stats.saved = added.length;
  stats.duplicates = duplicates;
  await locked(async () => {
    const { intentState = {} } = await store.get('intentState');
    intentState.rev = (intentState.rev || 0) + 1;
    intentState.unseen = (intentState.unseen || 0) + added.length;
    intentState.runs = [stats, ...(intentState.runs || [])].slice(0, 20);
    if (source === 'reddit') intentState.lastRedditAt = t;
    await store.set({ intentState });
  });
  await refreshBadge();
  if (added.length && opts.notify) notify('New intent posts', `${added.length} new post${added.length === 1 ? '' : 's'} from people asking for help. Open the Intent tab in Lead Hunter.`);
  return stats;
}

/* -------------------------------------------------------------- Reddit */
/* With a Reddit app id (reddit.com/prefs/apps) it uses Reddit's OAuth API; without one, Reddit's public JSON for
   the same listings. Either way one request per subreddit, 4 to 12 seconds apart, every few hours. */
async function redditToken(settings) {
  const { redditAuth = {} } = await store.get('redditAuth');
  if (redditAuth.token && redditAuth.exp > now() + 60000 && redditAuth.id === settings.redditClientId) return redditAuth.token;
  const device = redditAuth.device || Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => b.toString(16).padStart(2, '0')).join('');
  const body = settings.redditSecret ? 'grant_type=client_credentials' : `grant_type=${encodeURIComponent('https://oauth.reddit.com/grants/installed_client')}&device_id=${device}`;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${settings.redditClientId}:${settings.redditSecret || ''}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'omit',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw Object.assign(new Error(`Reddit did not accept your app id (${res.status}${data.error ? `: ${data.error}` : ''})`), { blocked: true });
  await store.set({ redditAuth: { token: data.access_token, exp: now() + (data.expires_in || 3600) * 1000, id: settings.redditClientId, device } });
  return data.access_token;
}
async function redditListing(sub, settings) {
  const limit = Math.max(1, Math.min(100, settings.intentCap || 100));
  const api = !!settings.redditClientId;
  const url = api ? `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/new?limit=${limit}&raw_json=1` : `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}&raw_json=1`;
  const headers = api ? { Authorization: `bearer ${await redditToken(settings)}` } : {};
  const res = await fetch(url, { headers, credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (res.status === 401 && api) await store.remove('redditAuth'); // the next run gets a new token
  if ([401, 403, 429].includes(res.status)) {
    const why = res.status === 429 ? 'Reddit says too many requests' : `Reddit refused the request (${res.status})${api ? '' : '. Adding a Reddit app id in Settings usually fixes this'}`;
    throw Object.assign(new Error(why), { blocked: true });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  // A "whoa there" or login page instead of data is a block too.
  if (!json) throw Object.assign(new Error(res.ok ? 'Reddit sent a page instead of posts (it may be blocking this browser)' : `Reddit answered ${res.status}`), { blocked: res.ok });
  return LH.redditPosts(json, sub);
}

let radarBusy = false;
/** One pass over your subreddits. manual: you pressed Scan now (runs even if the schedule is off). */
async function runRadar(manual = false) {
  if (radarBusy) return { error: 'The Intent Radar is already scanning.' };
  const settings = await getSettings();
  const { alerts = {} } = await store.get('alerts');
  if (alerts.reddit) return { error: 'Reddit is paused. Press Resume on the Intent tab first.' };
  const subs = LH.parseLines(settings.subreddits).map((s) => s.replace(/^\/?r\//i, ''));
  const uaeOnly = LH.parseLines(settings.uaeOnlySubs).map((s) => s.replace(/^\/?r\//i, ''));
  const list = [...subs.map((s) => [s, false]), ...uaeOnly.map((s) => [s, true])];
  if (!list.length) return { error: 'No subreddits in Settings > Intent Radar.' };
  radarBusy = true;
  const raws = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const [sub, needUae] = list[i];
      try {
        raws.push(...(await redditListing(sub, settings)).map((p) => ({ ...p, needUae })));
      } catch (e) {
        const text = String(e.message || e);
        if (e.blocked) {
          await alertSource('reddit', text, `https://www.reddit.com/r/${sub}/new/`, 'Open Reddit in a tab to check, then press Resume on the Intent tab.');
          break;
        }
        await logProblem('reddit', `r/${sub}: ${text}`);
      }
      if (i < list.length - 1) await sleep(jitter(4000, 12000)); // a human pace between requests
    }
  } finally {
    radarBusy = false;
  }
  const stats = await saveIntent(raws, 'reddit', { notify: !manual });
  return { stats };
}
const SOURCE_EXTRA = { reddit: 'Reddit', facebook: 'Facebook groups', linkedin: 'LinkedIn' };
Object.assign(SOURCE_NAMES, SOURCE_EXTRA);

// Every minute: is a scan due? (Every few hours by default, 0 in Settings turns it off.)
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'tick') return;
  const settings = await getSettings();
  const { intentState = {} } = await store.get('intentState');
  if (settings.radarEveryHours > 0 && now() - (intentState.lastRedditAt || 0) >= settings.radarEveryHours * 36e5) runRadar(false).catch(() => {});
});

/* ------------------------------------------------------------- messages */
Object.assign(handlers, {
  /** A Facebook group or LinkedIn page you pressed Scan on. */
  'intent:scan': async (msg) => {
    const source = msg.source === 'linkedin' ? 'linkedin' : 'facebook';
    if (msg.blocked) {
      await alertSource(source, msg.blocked, msg.url || '', 'Sort it out in that tab, then press Resume on the Intent tab.');
      return { blocked: msg.blocked };
    }
    const raws = (msg.posts || []).slice(0, 200).map((p) => ({ ...p, source, needUae: source === 'linkedin' }));
    return { stats: await saveIntent(raws, source) };
  },
  'intent:run': async () => runRadar(true),
  'intent:update': async (msg) => {
    const post = await LH.intentDb.update(msg.id, msg.patch || {});
    await locked(async () => {
      const { intentState = {} } = await store.get('intentState');
      intentState.rev = (intentState.rev || 0) + 1;
      await store.set({ intentState });
    });
    return { post };
  },
  /** You opened the Intent tab: the badge count goes. */
  'intent:seen': async () => {
    await locked(async () => {
      const { intentState = {} } = await store.get('intentState');
      intentState.unseen = 0;
      await store.set({ intentState });
    });
    await refreshBadge();
    return { ok: true };
  },
  'intent:resume': async (msg) => {
    await clearAlert(String(msg.source || ''));
    if (msg.source === 'reddit') runRadar(true).catch(() => {});
    return { ok: true };
  },
});
