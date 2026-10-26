/* Lead Hunter: Intent Radar (loaded by background.js after finder.js, shares its scope).
   Finds people asking for a website or marketing help, owners complaining business is slow, and companies hiring
   for marketing, from the last 14 days:
   - Reddit, every few hours through Reddit's API (r/dubai, r/UAE, r/abudhabi, r/sharjah, r/smallbusiness with UAE
     mentions only), a few seconds apart;
   - Facebook groups and LinkedIn posts and jobs, only when you press Scan on a page you have open yourself.
   Every post goes through LH.intentProcess (lib/intent.js) and is saved once in IndexedDB (lib/intent-db.js).
   With a Gemini (free) or Claude key, the AI then reads each new post and says whether it is a real buyer (the AI check). */

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
  if (added.length && aiReady(settings) && settings.aiAuto) queueAi(added.map((p) => p.id));
  if (added.length && opts.notify) notify('New intent posts', `${added.length} new post${added.length === 1 ? '' : 's'} from people asking for help. Open the Intent tab in Lead Hunter.`);
  return stats;
}

/* ------------------------------------------------------------- AI check */
const aiReady = (settings) => !!LH.aiProvider(settings);
async function bumpIntent() {
  await locked(async () => {
    const { intentState = {} } = await store.get('intentState');
    intentState.rev = (intentState.rev || 0) + 1;
    await store.set({ intentState });
  });
}
async function queueAi(ids) {
  if (!ids.length) return;
  await locked(async () => {
    const { aiQueue = [] } = await store.get('aiQueue');
    await store.set({ aiQueue: [...new Set([...aiQueue, ...ids])] });
  });
  runAi();
}
/** One post to the AI (Gemini or Claude). Returns what LH.aiParse says. */
async function aiCheckOne(post, settings) {
  const { provider, url, init } = LH.aiRequest(post, settings);
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    return { error: `Could not reach ${LH.AI_NAMES[provider]} (${String(e.message || e)})`, retry: true, wait: 60000 };
  }
  const data = await res.json().catch(() => null);
  return LH.aiParse(res.status, data, res.headers.get('retry-after'), provider);
}
let aiBusy = false;
async function runAi() {
  if (aiBusy) return;
  aiBusy = true;
  try {
    for (;;) {
      const settings = await getSettings();
      const { aiQueue = [], alerts = {}, aiWaitUntil = 0 } = await store.get(['aiQueue', 'alerts', 'aiWaitUntil']);
      if (!aiQueue.length || alerts.ai || !aiReady(settings) || now() < aiWaitUntil) break;
      const id = aiQueue[0];
      const post = await LH.intentDb.get(id);
      if (post) {
        const r = await aiCheckOne(post, settings);
        if (r.stop) {
          await alertSource('ai', r.error, '', 'Check your AI key and model in Settings > Intent Radar, then press Resume on the Intent tab.');
          break;
        }
        if (r.retry) {
          // Busy or rate limited: this post stays first and the checks carry on later (the minute tick restarts them).
          await store.set({ aiWaitUntil: now() + r.wait });
          await logProblem('ai', r.error);
          break;
        }
        if (r.error) {
          await logProblem('ai', `${post.summary.slice(0, 60)}: ${r.error}`);
          await LH.intentDb.update(id, { aiError: r.error, checkedAt: now() });
        } else {
          const next = LH.aiApply(post, r.result);
          await LH.intentDb.update(id, { ...next, aiError: null });
          // Not a buyer after all: a lead it was linked to loses the bonus.
          if (next.notBuyer && post.leadId)
            await updateLead(post.leadId, (l) => {
              if (l.hiring && l.hiring.url === post.url) l.hiring = null;
              if (l.intent && l.intent.url === post.url) l.intent = null;
            });
        }
        await bumpIntent();
      }
      await locked(async () => {
        const { aiQueue: q = [] } = await store.get('aiQueue');
        await store.set({ aiQueue: q.filter((x) => x !== id) });
      });
      await sleep(400);
    }
  } finally {
    aiBusy = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => a.name === 'tick' && runAi());

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
const SOURCE_EXTRA = { reddit: 'Reddit', facebook: 'Facebook groups', linkedin: 'LinkedIn', ai: 'AI check' };
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
    await bumpIntent();
    return { post };
  },
  /** Check posts with the AI now: the ones you pick, or every post not checked yet. */
  'ai:check': async (msg) => {
    const settings = await getSettings();
    if (!aiReady(settings)) return { error: 'Add a Google AI Studio key (free) or a Claude key in Settings > Intent Radar first.' };
    const ids = msg.ids && msg.ids.length ? msg.ids : (await LH.intentDb.all()).filter((p) => !p.verified).map((p) => p.id);
    await store.set({ aiWaitUntil: 0 });
    await queueAi(ids);
    return { queued: ids.length };
  },
  /** One tiny request with your key: does it work? */
  'ai:test': async () => {
    const settings = await getSettings();
    if (!aiReady(settings)) return { error: 'Add a Google AI Studio key or a Claude key first, then Save.' };
    const r = await aiCheckOne({ source: 'reddit', place: 'r/dubai', author: 'u/test', title: 'Need a website for my bakery in JLT, any recommendations?', text: '' }, settings);
    const name = LH.AI_NAMES[LH.aiProvider(settings)];
    return r.error ? { error: r.error, name } : { result: r.result, name };
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
    if (msg.source === 'ai') runAi();
    return { ok: true };
  },
});
