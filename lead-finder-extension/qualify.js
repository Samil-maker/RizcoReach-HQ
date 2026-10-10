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
  let PAGE_TIMEOUT = 20000; // counted as "very slow" after this
  const SETTLE_MS = 1500; // let JavaScript-built pages (Wix, React…) finish drawing
  let RETRY_MS = 4000; // a site that didn't answer gets one more try after this
  let FETCH_TIMEOUT = 15000;
  const MAX_HTML = 1500000; // bytes of a page's code read by the quick request
  const IG_GAP_MS = [8000, 15000]; // random gap between Instagram lookups, like a person browsing
  const IG_BACKOFF_MIN = [15, 30, 60, 360]; // pause after Instagram pushes back: 15 min, then 30, 60, 6 h
  const IG_LOGIN_PAUSE_MIN = 30; // Instagram wants a login: wait for the user rather than retrying
  const IG_CACHE_DAYS = 7;

  let running = false;
  let stopRequested = false;
  let userPaused = false; // the user pressed Pause: nothing restarts by itself until they press Check
  let listener = () => {};
  const tried = new Set(); // leads already tried in this run (never loop on one whose result couldn't be saved)
  let tabId = null;
  let tabUses = 0; // the checker tab is replaced every so often (Chrome may freeze long-hidden tabs)
  let lastInstagramAt = 0;
  let emptyPages = 0; // Instagram pages that came back without any profile data, in a row
  let emptyFetches = 0; // quick lookups that came back empty in a row; after 3, skip them

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ─── Queue ─────────────────────────────────────────────────────────────────

  /**
   * What still needs checking for this lead. The website goes first because the
   * Instagram handle is often only linked from the website.
   * igPaused: Instagram checks are paused, so only leads with no account to look up are settled.
   */
  function needs(lead, s, igPaused) {
    const c = lead.checks || {};
    const out = [];
    const hasSite = LF.websiteKind(lead, s) === 'site';
    if (s.checkWebsites && hasSite && !c.site) out.push('site');
    if (s.checkWebsites && hasSite && s.pagespeedKey && pagespeedDue(c.pagespeed, s)) out.push('pagespeed');
    if (s.checkInstagram && instagramDue(lead) && (!igPaused || !LF.instagramOf(lead).handle)) out.push('instagram');
    return out;
  }

  /** A PageSpeed check that failed runs again once the key is changed. */
  function pagespeedDue(ps, s) {
    return !ps || (ps.state === 'error' && ps.key !== keyTag(s.pagespeedKey));
  }

  /** Not looked up yet, or saved as "none linked" but an account has turned up since (e.g. on their website). */
  function instagramDue(lead) {
    const ig = lead.checks && lead.checks.instagram;
    if (!ig) return true;
    return ig.state === 'not_found' && !ig.handle && !!LF.instagramOf(lead).handle;
  }

  /** A short fingerprint of the PageSpeed key, so results remember which key they came from. */
  function keyTag(key) {
    let h = 0;
    for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return (h >>> 0).toString(36);
  }

  /**
   * When Instagram checks may resume, and why they're paused:
   * 'slowDown' (Instagram pushed back), 'login' (Instagram wants a login) or 'dailyLimit' (the user's own limit).
   */
  async function instagramPause(s) {
    const got = await chrome.storage.local.get(['igCooldownUntil', 'igDay', 'igLoginWall']);
    let until = 0;
    let reason = '';
    if (got.igCooldownUntil > Date.now()) {
      until = got.igCooldownUntil;
      reason = got.igLoginWall ? 'login' : 'slowDown';
    }
    const day = got.igDay || {};
    if (s && s.instagramPerDay && day.date === dayKey() && day.count >= s.instagramPerDay) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      if (tomorrow.getTime() > until) {
        until = tomorrow.getTime();
        reason = 'dailyLimit';
      }
    }
    return { until: until, reason: reason };
  }

  async function instagramPausedUntil(s) {
    return (await instagramPause(s)).until;
  }

  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /** Checks that ended in "couldn't check" (bot protection, a page that couldn't be read…). */
  function failedChecks(lead) {
    const c = lead.checks || {};
    return ['site', 'instagram'].filter((n) => c[n] && c[n].state === 'error');
  }

  async function pending() {
    const s = await LF.loadSettings();
    const ig = await instagramPause(s);
    const leads = (await LF.loadLeads()).filter((l) => l.status !== 'Do not contact');
    const todo = leads.filter((l) => needs(l, s, ig.until).length).sort((a, b) => String(b.added).localeCompare(String(a.added)));
    // Only leads with an account to look up wait for Instagram; the rest are settled straight away.
    const waitingForInstagram = ig.until ? leads.filter((l) => needs(l, s, 0).indexOf('instagram') >= 0 && LF.instagramOf(l).handle).length : 0;
    const failed = leads.filter((l) => failedChecks(l).length).map((l) => l.e164);
    const tag = keyTag(s.pagespeedKey);
    const psError = s.pagespeedKey && s.checkWebsites ? leads.map((l) => l.checks && l.checks.pagespeed).find((p) => p && p.state === 'error' && p.key === tag) : null;
    return {
      s: s,
      todo: todo,
      igPausedUntil: ig.until,
      igReason: ig.reason,
      waitingForInstagram: waitingForInstagram,
      failed: failed,
      pagespeedError: psError ? psError.error : '',
    };
  }

  /** The user can restrict the extension's site access in chrome://extensions. */
  function canOpenSites() {
    return chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
  }

  /**
   * Starts working through the queue. opts.auto: started by the panel itself (on opening,
   * after collecting, when an Instagram pause ends), which never overrides the user's Pause.
   */
  async function start(opts) {
    const auto = !!(opts && opts.auto);
    if (running || (auto && userPaused)) return;
    running = true;
    userPaused = false;
    stopRequested = false;
    try {
      if (!(await canOpenSites())) {
        running = false;
        listener(Object.assign(summary(await pending()), { running: false, done: 0, needsPermission: true }));
        return;
      }
      // One checker at a time, even with the panel open in several windows (Instagram pacing and limits are shared).
      if (navigator.locks) {
        await navigator.locks.request('rr-lead-checker', { ifAvailable: true }, (lock) => (lock ? runQueue() : busyElsewhere()));
      } else {
        await runQueue();
      }
    } finally {
      running = false;
    }
  }

  async function busyElsewhere() {
    running = false;
    listener(Object.assign(summary(await pending()), { running: false, done: 0, elsewhere: true }));
  }

  function summary(p) {
    return {
      left: p.todo.length,
      current: '',
      igPausedUntil: p.igPausedUntil,
      igReason: p.igReason,
      waitingForInstagram: p.waitingForInstagram,
      failed: p.failed,
      pagespeedError: p.pagespeedError,
    };
  }

  async function runQueue() {
    let done = 0;
    let offline = false;
    tried.clear();
    await closeLeftoverTab();
    try {
      for (;;) {
        if (stopRequested) break;
        if (navigator.onLine === false) {
          offline = true;
          break;
        }
        const { s, todo, igPausedUntil, igReason } = await pending();
        const lead = todo.find((l) => !tried.has(l.e164));
        if (!lead) break;
        tried.add(lead.e164);
        listener({
          running: true,
          done: done,
          left: todo.filter((l) => !tried.has(l.e164)).length, // still to go after this one
          current: lead.name || LF.formatPhone(lead.e164),
          igPausedUntil: igPausedUntil,
          igReason: igReason,
        });
        if ((await checkLead(lead, s, igPausedUntil)) === 'offline') {
          offline = true;
          break;
        }
        done++;
      }
    } finally {
      running = false;
      await closeTab();
      listener(Object.assign(summary(await pending()), { running: false, done: done, offline: offline }));
    }
  }

  /** Stops after the current lead (e.g. before deleting leads). */
  function stop() {
    stopRequested = true;
  }

  /** The user's Pause: stops after the current lead and stays paused until they press Check. */
  function pause() {
    userPaused = true;
    stopRequested = true;
  }

  /** Returns 'offline' when this computer lost its connection (nothing is saved for the lead). */
  async function checkLead(lead, s, igPaused) {
    const steps = needs(lead, s, igPaused);
    const tasks = [];
    if (steps.indexOf('pagespeed') >= 0) {
      // PageSpeed runs on Google's side while we load the site ourselves.
      tasks.push(
        checkPagespeed(lead.website, s.pagespeedKey).then((r) => (r ? saveCheck(lead.e164, 'pagespeed', Object.assign(r, { key: keyTag(s.pagespeedKey) })) : null))
      );
    }
    try {
      if (steps.indexOf('site') >= 0) {
        const site = await checkWebsite(lead.website, s);
        // A problem on this computer (offline, a tab error): save nothing, try again later.
        if (!site) return navigator.onLine === false ? 'offline' : 'retry';
        await saveCheck(lead.e164, 'site', site);
      }
      if (steps.indexOf('instagram') >= 0 && !stopRequested) {
        const fresh = await getLead(lead.e164);
        if (!fresh) return 'gone';
        const handle = LF.instagramOf(fresh).handle;
        if (!handle) {
          // Nothing to look up. If their website later shows an account, it is checked then (see instagramDue).
          await saveCheck(lead.e164, 'instagram', { state: 'not_found', at: now() });
        } else if (!(await instagramPausedUntil(s))) {
          const ig = await checkInstagram(handle, s);
          if (ig) await saveCheck(lead.e164, 'instagram', ig);
        }
      }
      return 'done';
    } finally {
      await Promise.all(tasks);
    }
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
    e164s.forEach((e) => tried.delete(e)); // a run in progress picks them up again
  }

  /** Runs the checks that ended in "couldn't check" again. */
  async function retryFailed() {
    const leads = await LF.loadLeads();
    const patch = {};
    leads.forEach((l) => {
      const names = failedChecks(l);
      if (!names.length) return;
      const checks = Object.assign({}, l.checks);
      names.forEach((n) => delete checks[n]);
      patch['lead:' + l.e164] = Object.assign({}, l, { checks: checks });
      tried.delete(l.e164);
    });
    await chrome.storage.local.set(patch);
    return Object.keys(patch).length;
  }

  // ─── Website ───────────────────────────────────────────────────────────────

  const NET_ERRORS = [
    [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|DNS/, "the domain doesn't load (it may have expired)"],
    [/CERT|SSL/, 'browsers show a security warning'],
    [/TOO_MANY_REDIRECTS/, 'it is stuck in a redirect loop'],
    [/CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|TIMED_OUT|ADDRESS_UNREACHABLE|EMPTY_RESPONSE|CONNECTION_FAILED/, 'the server is not responding'],
  ];
  // Problems on this computer, not the website: nothing is saved and the lead is tried again later.
  const LOCAL_ERRORS = /^TAB_|INTERNET_DISCONNECTED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|PROXY|NETWORK_ACCESS_DENIED/;
  // Blocked by Chrome or another extension (e.g. an ad blocker): saved as "couldn't check".
  const BLOCKED_ERRORS = /BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR|BLOCKED_BY_RESPONSE/;

  const PLACEHOLDER_WHY = {
    parked: 'the domain only shows a "for sale"/parking page',
    suspended: 'the hosting account is suspended',
    'coming soon': 'it only shows a "coming soon" page',
    'default server page': 'it only shows a blank server page',
    'wordpress demo': 'it still shows the WordPress sample content',
  };

  /**
   * Checks one website. Returns the result to save, or null when this computer had a
   * problem (offline, a tab error) so the lead stays in the queue.
   * A site that doesn't answer at all is tried once more before it counts as down,
   * so a short Wi-Fi drop doesn't mark working sites as dead.
   */
  async function checkWebsite(url, s) {
    let result = await visitWebsite(url, s);
    if (result && result.retry) {
      await sleep(RETRY_MS);
      if (navigator.onLine === false || stopRequested) return null;
      const second = await visitWebsite(url, s);
      result = second && second.retry ? second.retry : second;
    }
    return result;
  }

  /**
   * One look at a website, two ways:
   *   1. a quick request: status, final address (HTTPS or not), server headers and
   *      the page's original code (which still has a preloader that scripts remove later);
   *   2. a real visit in the background tab: load time and the finished page.
   * If the visit is blocked (e.g. Chrome's "not secure" warning for http-only sites),
   * the quick request's findings are used on their own.
   * Returns { retry: result } when the site didn't answer at all.
   */
  async function visitWebsite(url, s) {
    const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    try {
      let fetched = await fetchPage(target);
      if (!fetched.ok && /^https:/i.test(target)) {
        const plain = await fetchPage(target.replace(/^https:/i, 'http:'));
        if (plain.ok) fetched = plain;
      }

      // The domain just forwards to Instagram, WhatsApp, Linktree, a booking page…: they have no website.
      if (fetched.ok && !LF.hasRealWebsite([fetched.finalUrl], true)) return forwards(fetched.finalUrl);
      // A file download instead of a page: never open it in the tab (Chrome would save it).
      if (fetched.ok && fetched.download) {
        return done({ reachable: false, failure: 'the link opens a file download instead of a website', url: fetched.finalUrl, https: /^https:/i.test(fetched.finalUrl) });
      }
      const raw = fetched.ok ? staticSignals(fetched) : null;

      const id = await checkerTab();
      const load = await loadInTab(id, fetched.ok ? fetched.finalUrl : target, PAGE_TIMEOUT);
      let live = null;
      let liveError = load.error || '';
      if (!load.error) {
        await sleep(SETTLE_MS);
        const p = await probe(id, {}, load.timedOut);
        live = p.result;
        if (!live) liveError = p.error || "couldn't read the page";
      }
      if (live && live.challenge) {
        // "Checking your browser…" pages usually reload into the real site after a few seconds.
        await sleep(6000);
        const again = await probe(id, {}, false);
        if (again.result && !again.result.challenge) live = again.result;
      }
      if (live && !LF.hasRealWebsite([live.url], true)) return forwards(live.url);

      if (!live && !raw) {
        const errors = liveError + ' ' + (fetched.error || '');
        if (LOCAL_ERRORS.test(liveError) || navigator.onLine === false) return null;
        if (BLOCKED_ERRORS.test(errors)) return { state: 'error', at: now(), error: 'Could not load from this computer (' + liveError + ')' };
        // It loaded, but the page couldn't be read (e.g. it never finished drawing).
        if (!load.error) return { state: 'error', at: now(), error: 'The page loaded but could not be read (' + liveError + ')' };
        const known = NET_ERRORS.find((e) => e[0].test(liveError));
        return { retry: done({ reachable: false, failure: known ? known[1] : "it doesn't load", error: liveError || fetched.error, url: target }) };
      }
      if ((live && live.challenge) || (!live && raw.challenge)) {
        return { state: 'error', at: now(), error: 'The website has bot protection (e.g. Cloudflare), so it could not be checked' };
      }

      let signals;
      if (live) {
        signals = live;
        if (load.timedOut && signals.domMs && !signals.loadMs) {
          // The page itself was ready; something on it (a chat widget, a tracker) never finished.
          signals.loadMs = signals.domMs;
          signals.neverFinished = true;
        }
        signals.timedOut = !!load.timedOut && !signals.loadMs;
        if (!signals.loadMs) signals.loadMs = load.timedOut ? PAGE_TIMEOUT : load.wallMs;
        if (raw) {
          // Things the finished page may no longer show.
          signals.preloader = signals.preloader || raw.preloader;
          signals.builder = signals.builder || raw.builder;
          signals.metaPixel = signals.metaPixel || raw.metaPixel;
          signals.analytics = signals.analytics || raw.analytics;
          if (!signals.form.found && raw.form.found) signals.form = raw.form;
          if (!signals.copyrightYear) signals.copyrightYear = raw.copyrightYear;
        }
      } else {
        signals = raw;
        signals.loadMs = fetched.ms;
        signals.measured = 'quick request';
        if (/CERT|SSL|INSECURE|HTTPS/.test(liveError)) signals.https = false;
      }
      if (fetched.ok && fetched.status >= 400) signals.status = signals.status || fetched.status;
      if (signals.status >= 400) {
        return done({
          reachable: false,
          failure: 'it shows an error page (HTTP ' + signals.status + ')',
          pitch: 'the website link on your Google listing opens an error page',
          url: signals.url,
          https: signals.https,
        });
      }
      if (signals.placeholder) return done(Object.assign(signals, { reachable: false, failure: PLACEHOLDER_WHY[signals.placeholder] }));
      signals.reachable = true;

      // Slow? Load it once more before saying so (the first visit can hit a cold server or DNS).
      const slowMs = ((s && s.slowSeconds) || 5) * 1000;
      if (live && !signals.timedOut && !signals.neverFinished && signals.loadMs > slowMs && !stopRequested) {
        const again = await loadInTab(id, signals.url, PAGE_TIMEOUT);
        if (!again.error && !again.timedOut) {
          await sleep(500);
          const timing = (await probe(id, { timingOnly: true }, false)).result;
          if (timing && timing.loadMs) signals.loadMs = Math.min(signals.loadMs, timing.loadMs);
        }
      }

      // No form on the home page? Look on the contact page.
      if (signals.form && !signals.form.found && !stopRequested) {
        const contact = await findContactForm(id, signals);
        if (contact) signals.form = contact;
      }
      return done(signals);
    } catch (err) {
      return { state: 'error', at: now(), error: (err && err.message) || String(err) };
    }

    function done(signals) {
      return { state: 'done', at: now(), signals: signals };
    }

    function forwards(to) {
      return done({ reachable: true, url: String(to).slice(0, 500), forwardsTo: LF.hostOf(to) });
    }
  }

  /** Looks for a contact form on the contact page: the linked one, else /contact-us and /contact. */
  async function findContactForm(id, signals) {
    if (signals.contactUrl && /^https?:\/\//i.test(signals.contactUrl)) {
      const load = await loadInTab(id, signals.contactUrl, 15000);
      if (!load.error) {
        await sleep(SETTLE_MS);
        const page = (await probe(id, { formOnly: true }, load.timedOut)).result;
        if (page && page.form && page.form.found) return Object.assign({}, page.form, { where: 'contact page' });
      }
      return null;
    }
    let origin;
    try {
      origin = new URL(signals.url).origin;
    } catch (e) {
      return null;
    }
    for (const path of ['/contact-us', '/contact']) {
      const page = await fetchPage(origin + path);
      if (!page.ok || page.status >= 400) continue;
      const found = staticSignals(page, { formOnly: true });
      if (found && found.form && found.form.found) return Object.assign({}, found.form, { where: 'contact page' });
    }
    return null;
  }

  /** A quick logged-out request for a page: status, final address, a few headers and the HTML. */
  async function fetchPage(url) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        credentials: 'omit',
        redirect: 'follow',
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      const type = res.headers.get('content-type') || '';
      const isPage = /html|xml|text\/plain/i.test(type) || !type;
      const download = /attachment/i.test(res.headers.get('content-disposition') || '') || !isPage;
      const html = download ? '' : await readText(res, MAX_HTML);
      if (download && res.body) res.body.cancel().catch(() => {});
      const headers = ['server', 'x-powered-by', 'x-wix-request-id', 'x-shopify-stage', 'x-generator', 'link']
        .map((h) => (res.headers.get(h) ? h + ': ' + res.headers.get(h).slice(0, 300) : ''))
        .join('\n');
      return { ok: true, status: res.status, finalUrl: res.url || url, html: html, headers: headers, download: download && res.status < 400, ms: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err && err.name === 'TimeoutError' ? 'TIMED_OUT' : (err && err.message) || 'failed' };
    }
  }

  /** Reads at most maxBytes of a response, so a huge page can't fill the panel's memory. */
  async function readText(res, maxBytes) {
    if (!res.body || !res.body.getReader) return (await res.text()).slice(0, maxBytes);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= maxBytes) {
        reader.cancel().catch(() => {});
        break;
      }
    }
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    let at = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, Math.min(chunk.length, bytes.length - at));
      bytes.set(part, at);
      at += part.length;
      if (at >= bytes.length) break;
    }
    const charset = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
    try {
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    } catch (e) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  /** Runs the website reader on a page's original code. */
  function staticSignals(page, extra) {
    if (!page.html) return null;
    const doc = new DOMParser().parseFromString(page.html, 'text/html');
    return root.rrProbeWebsite(Object.assign({ url: page.finalUrl, rawHtml: page.html, headers: page.headers }, extra || {}), doc);
  }

  /** Reads the page in the checker tab. Returns { result } or { error }. */
  async function probe(id, options, pageStillLoading) {
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const run = chrome.scripting.executeScript({
          target: { tabId: id },
          func: root.rrProbeWebsite,
          args: [options],
          injectImmediately: !!pageStillLoading,
        });
        let timer;
        const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve('timeout'), 10000)));
        const results = await Promise.race([run, timeout]);
        clearTimeout(timer);
        if (results === 'timeout') {
          lastError = 'the page did not respond';
          pageStillLoading = true; // don't wait for the page to finish next time
        } else if (results && results[0] && results[0].result) {
          return { result: results[0].result };
        }
      } catch (err) {
        lastError = (err && err.message) || String(err);
        if (/showing error page|Cannot access/i.test(lastError)) return { error: lastError };
      }
      await sleep(1500); // the page was probably still redirecting
    }
    return { error: lastError };
  }

  /** One background tab, reused for every site and closed when the queue ends. */
  async function checkerTab() {
    if (tabId != null && ++tabUses > 15) {
      await closeTab();
      tabUses = 0;
    }
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
    // Remembered so a tab left behind when the panel was closed mid-check is closed next time.
    await chrome.storage.session.set({ checkerTabId: tabId }).catch(() => {});
    try {
      // Muted, and never put to sleep by Chrome's memory saver mid-check.
      await chrome.tabs.update(tabId, { muted: true, autoDiscardable: false });
    } catch (e) {
      /* not important */
    }
    return tabId;
  }

  async function closeTab() {
    if (tabId == null) return;
    const id = tabId;
    tabId = null;
    await chrome.storage.session.remove('checkerTabId').catch(() => {});
    try {
      await chrome.tabs.remove(id);
    } catch (e) {
      /* already closed */
    }
  }

  /** Closes a checker tab left open by a panel that was closed mid-check. */
  async function closeLeftoverTab() {
    const left = ((await chrome.storage.session.get('checkerTabId').catch(() => ({}))) || {}).checkerTabId;
    if (left == null || left === tabId) return;
    await chrome.storage.session.remove('checkerTabId').catch(() => {});
    try {
      await chrome.tabs.remove(left);
    } catch (e) {
      /* already closed */
    }
  }

  /**
   * Navigates the checker tab and resolves when the new page has loaded, failed, or timed out.
   * Only events after the new page has started (committed) count, so a slow or dead site
   * can never be read as the page the tab showed before.
   */
  function loadInTab(id, url, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      let finished = false;
      let committed = null; // the new page's documentId once it has started
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.webNavigation.onCommitted.removeListener(onCommitted);
        chrome.webNavigation.onCompleted.removeListener(onCompleted);
        chrome.webNavigation.onErrorOccurred.removeListener(onError);
        resolve(Object.assign({ wallMs: Date.now() - started }, result));
      };
      const onCommitted = (d) => {
        if (d.tabId === id && d.frameId === 0 && d.url !== 'about:blank') committed = d.documentId || true;
      };
      const onCompleted = (d) => {
        if (d.tabId !== id || d.frameId !== 0 || d.url === 'about:blank' || !committed) return;
        if (committed !== true && d.documentId && d.documentId !== committed) return; // an older page finishing
        finish({ url: d.url });
      };
      const onError = (d) => {
        if (d.tabId !== id || d.frameId !== 0) return;
        if (/ERR_ABORTED/.test(d.error)) return; // replaced by a redirect; wait for the next event
        finish({ error: d.error, url: d.url });
      };
      chrome.webNavigation.onCommitted.addListener(onCommitted);
      chrome.webNavigation.onCompleted.addListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.addListener(onError);
      const timer = setTimeout(() => {
        if (committed) return finish({ timedOut: true });
        // No answer at all: clear the tab so nothing reads the previous page.
        chrome.tabs.update(id, { url: 'about:blank' }).catch(() => {});
        finish({ error: 'TIMED_OUT' });
      }, timeout);
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
      if (!res.ok) return { state: 'error', at: now(), error: String((data.error && data.error.message) || 'HTTP ' + res.status).slice(0, 300) };
      const lh = data.lighthouseResult || {};
      const score = lh.categories && lh.categories.performance && lh.categories.performance.score;
      const lcp = lh.audits && lh.audits['largest-contentful-paint'] && lh.audits['largest-contentful-paint'].numericValue;
      return { state: 'done', at: now(), performance: typeof score === 'number' ? Math.round(score * 100) : null, lcpMs: typeof lcp === 'number' ? Math.round(lcp) : null };
    } catch (err) {
      return null; // no connection: try again on the next run
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
    let r = {};
    if (emptyFetches < 3) {
      await countInstagram();
      r = await instagramFromFetch(handle);
      emptyFetches = r.followers == null && !r.missing && !r.limited && !r.error ? emptyFetches + 1 : 0;
    }
    if (r.followers == null && !r.missing && !r.limited) {
      if (emptyFetches < 3 || r.error) await sleep(2000 + Math.random() * 2000);
      await countInstagram();
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
      await chrome.storage.local.set({ [cacheKey]: result, igStrikes: 0, igLoginWall: 0 });
      return result;
    }
    if (r.loginWall) {
      // Not rate limiting: Instagram only shows profiles to logged-in visitors here. Wait for the user to log in.
      await chrome.storage.local.set({ igLoginWall: Date.now(), igCooldownUntil: Date.now() + IG_LOGIN_PAUSE_MIN * 60000 });
      return null;
    }
    if (r.tabError) return null; // the visit itself failed (no connection, a tab problem): try again later
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
    await chrome.storage.local.set({ igStrikes: strikes, igCooldownUntil: Date.now() + minutes * 60000, igLoginWall: 0 });
  }

  /** The exact count from embedded JSON, only when it sits next to this handle's username. */
  function followersIn(text, handle) {
    const userRe = new RegExp('"username"\\s*:\\s*"' + handle.replace(/[.]/g, '\\.') + '"', 'gi');
    let m;
    while ((m = userRe.exec(text))) {
      const around = text.slice(Math.max(0, m.index - 1500), m.index + 1500);
      const count = around.match(/"follower_count"\s*:\s*(\d+)/) || around.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
      if (count) return { followers: parseInt(count[1], 10), exact: true };
    }
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
      const exact = followersIn(html, handle);
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
      if (load.error) return { error: load.error, tabError: true };
      await sleep(SETTLE_MS + 500);
      let page = null;
      for (let attempt = 0; attempt < 2 && !page; attempt++) {
        try {
          const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: root.rrProbeInstagram, args: [handle] });
          page = results && results[0] && results[0].result;
        } catch (e) {
          await sleep(1500);
        }
      }
      if (!page) return { error: "Couldn't read the Instagram page" };
      if (/^\/accounts\/login/.test(page.path)) return { loginWall: true };
      if (/^\/challenge/.test(page.path) || page.path === '/') return { limited: true };
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

  // Closing the panel stops the checker; don't leave its background tab behind.
  if (root.addEventListener) {
    root.addEventListener('pagehide', () => {
      if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    });
  }

  root.LeadChecker = {
    start: start,
    stop: stop,
    pause: pause,
    isPaused: () => userPaused,
    recheck: recheck,
    retryFailed: retryFailed,
    needs: needs,
    pending: pending,
    isRunning: () => running,
    canOpenSites: canOpenSites,
    tabId: () => tabId,
    onProgress: (fn) => (listener = fn),
    // for tests
    _checkWebsite: checkWebsite,
    _probe: probe,
    _checkInstagram: checkInstagram,
    _tune: (t) => {
      PAGE_TIMEOUT = t.page || PAGE_TIMEOUT;
      RETRY_MS = t.retry || RETRY_MS;
      FETCH_TIMEOUT = t.fetch || FETCH_TIMEOUT;
    },
  };
})(globalThis);
