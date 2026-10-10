/*
 * The lead checker. Runs from the side panel, one lead at a time:
 *   1. Website: loads it in a muted background tab, times the load, and reads
 *      the page with probe.js (contact form, preloader, phone friendliness…).
 *      If the home page has no form, it also opens the contact page.
 *   2. Google PageSpeed score, when a PageSpeed key is set.
 *   3. Instagram: finds the handle (Maps, the website, or the website field)
 *      and reads the follower count from the public profile.
 * Results are saved on each lead (lead.checks) so closing the panel only
 * pauses the queue.
 */
(function (root) {
  'use strict';

  const LF = root.LF;
  const PAGE_TIMEOUT = 20000; // counted as "very slow" after this
  const SETTLE_MS = 1500; // let JavaScript-built pages (Wix, React…) finish drawing
  const IG_GAP_MS = [8000, 15000]; // random gap between Instagram lookups, like a person browsing
  const IG_BACKOFF_MIN = [15, 30, 60, 360]; // pause after Instagram pushes back: 15 min, then 30, 60, 6 h
  const IG_CACHE_DAYS = 7;

  let running = false;
  let stopRequested = false;
  let listener = () => {};
  let tabId = null;
  let lastInstagramAt = 0;
  let emptyPages = 0; // Instagram pages that came back without any profile data, in a row

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ─── Queue ─────────────────────────────────────────────────────────────────

  /**
   * What still needs checking for this lead. The website goes first because the
   * Instagram handle is often only linked from the website.
   * igPaused: Instagram asked us to slow down, so skip it for now.
   */
  function needs(lead, s, igPaused) {
    const c = lead.checks || {};
    const out = [];
    const hasSite = LF.websiteKind(lead, s) === 'site';
    if (s.checkWebsites && hasSite && !c.site) out.push('site');
    if (s.checkWebsites && hasSite && s.pagespeedKey && !c.pagespeed) out.push('pagespeed');
    if (s.checkInstagram && !c.instagram && !igPaused) out.push('instagram');
    return out;
  }

  /** When Instagram checks may resume: after a push-back pause, or tomorrow once today's limit is used. */
  async function instagramPausedUntil(s) {
    const got = await chrome.storage.local.get(['igCooldownUntil', 'igDay']);
    let until = got.igCooldownUntil > Date.now() ? got.igCooldownUntil : 0;
    const day = got.igDay || {};
    if (s && s.instagramPerDay && day.date === dayKey() && day.count >= s.instagramPerDay) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      until = Math.max(until, tomorrow.getTime());
    }
    return until;
  }

  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  async function pending() {
    const s = await LF.loadSettings();
    const igPausedUntil = await instagramPausedUntil(s);
    const leads = (await LF.loadLeads()).filter((l) => l.status !== 'Do not contact');
    const todo = leads.filter((l) => needs(l, s, igPausedUntil).length).sort((a, b) => String(b.added).localeCompare(String(a.added)));
    const waitingForInstagram = igPausedUntil ? leads.filter((l) => needs(l, s, false).indexOf('instagram') >= 0).length : 0;
    return { s: s, todo: todo, igPausedUntil: igPausedUntil, waitingForInstagram: waitingForInstagram };
  }

  async function start() {
    if (running) return;
    running = true;
    stopRequested = false;
    let done = 0;
    const tried = new Set(); // never loop on a lead whose result couldn't be saved
    try {
      for (;;) {
        if (stopRequested) break;
        const { s, todo, igPausedUntil } = await pending();
        const lead = todo.find((l) => !tried.has(l.e164));
        if (!lead) break;
        tried.add(lead.e164);
        listener({ running: true, done: done, left: todo.length, current: lead.name || LF.formatPhone(lead.e164), igPausedUntil: igPausedUntil });
        await checkLead(lead, s, igPausedUntil);
        done++;
      }
    } finally {
      running = false;
      await closeTab();
      const p = await pending();
      listener({ running: false, done: done, left: p.todo.length, current: '', igPausedUntil: p.igPausedUntil, waitingForInstagram: p.waitingForInstagram });
    }
  }

  function stop() {
    stopRequested = true;
  }

  async function checkLead(lead, s, igPaused) {
    const steps = needs(lead, s, igPaused);
    const tasks = [];
    if (steps.indexOf('pagespeed') >= 0) {
      // PageSpeed runs on Google's side while we load the site ourselves.
      tasks.push(checkPagespeed(lead.website, s.pagespeedKey).then((r) => saveCheck(lead.e164, 'pagespeed', r)));
    }
    if (steps.indexOf('site') >= 0) {
      const site = await checkWebsite(lead.website);
      await saveCheck(lead.e164, 'site', site);
    }
    if (steps.indexOf('instagram') >= 0 && !stopRequested && !(await instagramPausedUntil(s))) {
      const fresh = await getLead(lead.e164);
      const handle = fresh ? LF.instagramOf(fresh).handle : '';
      const ig = handle ? await checkInstagram(handle, s) : { state: 'not_found', at: now() };
      if (ig) await saveCheck(lead.e164, 'instagram', ig);
    }
    await Promise.all(tasks);
  }

  async function getLead(e164) {
    const key = 'lead:' + e164;
    return (await chrome.storage.local.get(key))[key] || null;
  }

  /** Saves one check result without touching anything else on the lead (status edits made meanwhile survive). */
  async function saveCheck(e164, name, result) {
    const lead = await getLead(e164);
    if (!lead) return;
    const checks = Object.assign({}, lead.checks || {});
    checks[name] = result;
    await chrome.storage.local.set({ ['lead:' + e164]: Object.assign({}, lead, { checks: checks }) });
  }

  /** Clears check results so they run again (e.g. after the user fixes a setting). */
  async function recheck(e164s, names) {
    const all = await chrome.storage.local.get(e164s.map((e) => 'lead:' + e));
    const patch = {};
    const forget = [];
    Object.keys(all).forEach((key) => {
      const handle = LF.instagramOf(all[key]).handle;
      if (handle && names.indexOf('instagram') >= 0) forget.push('ig:' + handle);
      const checks = Object.assign({}, all[key].checks || {});
      names.forEach((n) => delete checks[n]);
      patch[key] = Object.assign({}, all[key], { checks: checks });
    });
    if (forget.length) await chrome.storage.local.remove(forget);
    await chrome.storage.local.set(patch);
  }

  // ─── Website ───────────────────────────────────────────────────────────────

  const NET_ERRORS = [
    [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|DNS/, "the domain doesn't load (it may have expired)"],
    [/CERT|SSL/, 'browsers show a security warning'],
    [/TOO_MANY_REDIRECTS/, 'it is stuck in a redirect loop'],
    [/CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|TIMED_OUT|ADDRESS_UNREACHABLE|EMPTY_RESPONSE|CONNECTION_FAILED/, 'the server is not responding'],
  ];

  async function checkWebsite(url) {
    const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    try {
      const id = await checkerTab();
      const load = await loadInTab(id, target, PAGE_TIMEOUT);
      if (load.error) {
        if (/BLOCKED_BY_CLIENT|ERR_ABORTED|INTERNET_DISCONNECTED|NETWORK_CHANGED|PROXY/.test(load.error)) {
          return { state: 'error', at: now(), error: 'Could not load from this computer (' + load.error + ')' };
        }
        const known = NET_ERRORS.find((e) => e[0].test(load.error));
        return done({ reachable: false, failure: known ? known[1] : "it doesn't load", error: load.error, url: target });
      }
      await sleep(SETTLE_MS);
      let signals = await probe(id, {});
      if (!signals) return { state: 'error', at: now(), error: "Couldn't read the page" };
      signals.timedOut = !!load.timedOut;
      if (!signals.loadMs) signals.loadMs = load.timedOut ? PAGE_TIMEOUT : load.wallMs;
      if (signals.status >= 400) {
        return done({ reachable: false, failure: 'it shows an error page (HTTP ' + signals.status + ')', url: signals.url, https: signals.https });
      }
      if (signals.placeholder) {
        const why = {
          parked: 'the domain only shows a "for sale"/parking page',
          suspended: 'the hosting account is suspended',
          'coming soon': 'it only shows a "coming soon" page',
          'default server page': 'it only shows a blank server page',
        }[signals.placeholder];
        return done(Object.assign(signals, { reachable: false, failure: why }));
      }
      signals.reachable = true;
      // No form on the home page? Look on the contact page.
      if (signals.form && !signals.form.found && signals.contactUrl) {
        const contact = await loadInTab(id, signals.contactUrl, 15000);
        if (!contact.error) {
          await sleep(SETTLE_MS);
          const page = await probe(id, { formOnly: true });
          if (page && page.form && page.form.found) signals.form = Object.assign({}, page.form, { where: 'contact page' });
        }
      }
      return done(signals);
    } catch (err) {
      return { state: 'error', at: now(), error: (err && err.message) || String(err) };
    }

    function done(signals) {
      return { state: 'done', at: now(), signals: signals };
    }
  }

  async function probe(id, options) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: root.rrProbeWebsite, args: [options] });
        if (results && results[0] && results[0].result) return results[0].result;
      } catch (err) {
        // The page was still redirecting; give it a moment.
      }
      await sleep(1500);
    }
    return null;
  }

  /** One background tab, reused for every site and closed when the queue ends. */
  async function checkerTab() {
    if (tabId != null) {
      try {
        await chrome.tabs.get(tabId);
        return tabId;
      } catch (e) {
        tabId = null;
      }
    }
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    tabId = tab.id;
    try {
      await chrome.tabs.update(tabId, { muted: true });
    } catch (e) {
      /* not important */
    }
    return tabId;
  }

  async function closeTab() {
    if (tabId == null) return;
    const id = tabId;
    tabId = null;
    try {
      await chrome.tabs.remove(id);
    } catch (e) {
      /* already closed */
    }
  }

  /** Navigates the checker tab and resolves when the page has loaded, failed, or timed out. */
  function loadInTab(id, url, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.webNavigation.onCompleted.removeListener(onCompleted);
        chrome.webNavigation.onErrorOccurred.removeListener(onError);
        resolve(Object.assign({ wallMs: Date.now() - started }, result));
      };
      const onCompleted = (d) => {
        if (d.tabId === id && d.frameId === 0 && d.url !== 'about:blank') finish({ url: d.url });
      };
      const onError = (d) => {
        if (d.tabId !== id || d.frameId !== 0) return;
        if (/ERR_ABORTED/.test(d.error)) return; // replaced by a redirect; wait for the next event
        finish({ error: d.error, url: d.url });
      };
      chrome.webNavigation.onCompleted.addListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.addListener(onError);
      const timer = setTimeout(() => finish({ timedOut: true }), timeout);
      chrome.tabs.update(id, { url: url }).catch((err) => finish({ error: 'TAB_' + ((err && err.message) || 'ERROR') }));
    });
  }

  // ─── PageSpeed ─────────────────────────────────────────────────────────────

  async function checkPagespeed(url, key) {
    const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    api.searchParams.set('url', /^https?:\/\//i.test(url) ? url : 'https://' + url);
    api.searchParams.set('strategy', 'mobile');
    api.searchParams.set('category', 'performance');
    api.searchParams.set('fields', 'lighthouseResult/categories/performance/score,lighthouseResult/audits/largest-contentful-paint/numericValue');
    api.searchParams.set('key', key);
    try {
      const res = await fetch(api.toString(), { credentials: 'omit' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { state: 'error', at: now(), error: (data.error && data.error.message) || 'HTTP ' + res.status };
      const lh = data.lighthouseResult || {};
      const score = lh.categories && lh.categories.performance && lh.categories.performance.score;
      const lcp = lh.audits && lh.audits['largest-contentful-paint'] && lh.audits['largest-contentful-paint'].numericValue;
      return { state: 'done', at: now(), performance: typeof score === 'number' ? Math.round(score * 100) : null, lcpMs: typeof lcp === 'number' ? Math.round(lcp) : null };
    } catch (err) {
      return { state: 'error', at: now(), error: (err && err.message) || String(err) };
    }
  }

  // ─── Instagram ─────────────────────────────────────────────────────────────

  /**
   * Follower count for a handle. Returns null when Instagram is limiting us
   * (the lead then stays in the queue for later), never a made-up 0.
   *   1. A quick logged-out request for the profile page.
   *   2. If that comes back empty (it often does now), the profile opened in the
   *      checker tab like a visitor would, then read from the page.
   */
  async function checkInstagram(handle, s) {
    if (await instagramPausedUntil(s)) return null;
    const cacheKey = 'ig:' + handle;
    const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
    if (cached && Date.now() - Date.parse(cached.at) < IG_CACHE_DAYS * 864e5) return cached;

    await paceInstagram();
    let r = await instagramFromFetch(handle);
    if (r.followers == null && !r.missing && !r.limited) {
      await countInstagram();
      await sleep(2000 + Math.random() * 2000);
      r = await instagramFromTab(handle);
    }

    let result = null;
    if (r.followers != null) {
      result = { state: 'done', at: now(), handle: handle, followers: r.followers, exact: !!r.exact, source: r.source };
    } else if (r.missing) {
      result = { state: 'not_found', at: now(), handle: handle, note: 'No Instagram account @' + handle };
    }
    if (result) {
      emptyPages = 0;
      await chrome.storage.local.set({ [cacheKey]: result, igStrikes: 0 });
      return result;
    }
    if (r.empty) emptyPages++;
    if (r.limited || emptyPages >= 2) {
      emptyPages = 0;
      await pauseInstagram();
      return null;
    }
    if (r.empty) return null; // one empty page can be a fluke: try again on the next run
    return { state: 'error', at: now(), handle: handle, error: r.error || 'no follower count' };
  }

  async function paceInstagram() {
    const gap = IG_GAP_MS[0] + Math.random() * (IG_GAP_MS[1] - IG_GAP_MS[0]);
    const wait = lastInstagramAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastInstagramAt = Date.now();
    await countInstagram();
  }

  async function countInstagram() {
    const day = (await chrome.storage.local.get('igDay')).igDay || {};
    const today = dayKey();
    await chrome.storage.local.set({ igDay: { date: today, count: (day.date === today ? day.count : 0) + 1 } });
  }

  /** Instagram pushed back: pause Instagram checks for 15 min, then 30, 60, and 6 hours. Websites keep going. */
  async function pauseInstagram() {
    const strikes = ((await chrome.storage.local.get('igStrikes')).igStrikes || 0) + 1;
    const minutes = IG_BACKOFF_MIN[Math.min(strikes, IG_BACKOFF_MIN.length) - 1];
    await chrome.storage.local.set({ igStrikes: strikes, igCooldownUntil: Date.now() + minutes * 60000 });
  }

  function followersIn(text) {
    const json = String(text).match(/"follower_count":\s*(\d+)/) || String(text).match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/);
    if (json) return { followers: parseInt(json[1], 10), exact: true };
    return null;
  }

  async function instagramFromFetch(handle) {
    try {
      const res = await fetch('https://www.instagram.com/' + encodeURIComponent(handle) + '/?hl=en', {
        credentials: 'omit',
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (res.status === 404) return { missing: true };
      if (res.status === 429) return { limited: true };
      if (!res.ok) return { error: 'HTTP ' + res.status };
      const html = await res.text();
      const exact = followersIn(html);
      if (exact) return Object.assign(exact, { source: 'profile page' });
      const meta =
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const followers = meta ? LF.parseFollowers(decodeEntities(meta[1])) : null;
      if (followers != null) return { followers: followers, source: 'profile page' };
      return {}; // the logged-out app shell, or a login wall: try a real page visit
    } catch (err) {
      return { error: (err && err.message) || String(err) };
    }
  }

  async function instagramFromTab(handle) {
    try {
      const id = await checkerTab();
      const load = await loadInTab(id, 'https://www.instagram.com/' + encodeURIComponent(handle) + '/?hl=en', PAGE_TIMEOUT);
      if (load.error) return { error: load.error };
      await sleep(SETTLE_MS + 500);
      let page = null;
      for (let attempt = 0; attempt < 2 && !page; attempt++) {
        try {
          const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: root.rrProbeInstagram });
          page = results && results[0] && results[0].result;
        } catch (e) {
          await sleep(1500);
        }
      }
      if (!page) return { error: "Couldn't read the Instagram page" };
      if (/^\/(accounts\/login|challenge)/.test(page.path) || page.path === '/') return { limited: true };
      if (page.notFound) return { missing: true };
      if (page.followers != null) return { followers: page.followers, exact: true, source: 'profile' };
      const followers = [page.og, page.description, page.header].map(LF.parseFollowers).find((n) => n != null);
      if (followers != null) return { followers: followers, source: 'profile' };
      return { empty: true };
    } catch (err) {
      return { error: (err && err.message) || String(err) };
    }
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function now() {
    return new Date().toISOString();
  }

  root.LeadChecker = {
    start: start,
    stop: stop,
    recheck: recheck,
    needs: needs,
    pending: pending,
    isRunning: () => running,
    tabId: () => tabId,
    onProgress: (fn) => (listener = fn),
    // for tests
    _checkWebsite: checkWebsite,
    _checkInstagram: checkInstagram,
  };
})(globalThis);
