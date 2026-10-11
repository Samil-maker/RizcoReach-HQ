/* The Lead Finder side panel: collect from Maps, check leads, message the best, export. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAPS_PATTERNS = chrome.runtime.getManifest().content_scripts[0].matches;
  const PAGE = 40;
  const VERDICT = { hot: 'Hot', good: 'Good', low: 'Low', checking: 'To check' };
  // e.g. "https://www.google.com/maps*" → "www.google.com"
  const MAPS_HOSTS = MAPS_PATTERNS.map((p) => new URL(p.replace(/\*$/, '')).host);

  let settings = LF.withDefaults({});
  const leads = new Map(); // e164 → lead
  let run = null;
  let lastFinishedRun = 0;
  let mapsTab = null;
  let collectingTabId = null;
  let filter = 'hot';
  let shown = PAGE;
  let deleteArmed = null;
  let checkState = { running: false, done: 0, left: 0, current: '' };
  let igTimer = null;
  const confirmed = new Set(); // leads whose "Send anyway" warning was shown (kept across re-renders)
  const justSent = new Map(); // e164 → status/contacted before the chat was opened, for Undo
  let listDirty = false; // the list needs redrawing once the user stops interacting with it
  let pointerInList = false;

  // ─── Start-up ──────────────────────────────────────────────────────────────

  async function init() {
    settings = await LF.loadSettings();
    (await LF.loadLeads()).forEach((l) => leads.set(l.e164, l));
    run = (await chrome.storage.local.get('run')).run || null;
    lastFinishedRun = (run && run.finishedAt) || 0;

    fillSettingsForm();
    renderLeads();
    renderRun();
    await refreshTab();

    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.tabs.onActivated.addListener(refreshTab);
    chrome.tabs.onUpdated.addListener((id, info) => {
      if (id === LeadChecker.tabId()) return; // the checker tab changes all the time
      if (info.url || info.status === 'complete') refreshTab();
    });
    chrome.tabs.onRemoved.addListener(refreshTab);
    setInterval(renderRun, 4000); // notices a collection that died with its tab

    $('collectBtn').addEventListener('click', startCollect);
    $('stopBtn').addEventListener('click', stopCollect);
    $('checkBtn').addEventListener('click', () => LeadChecker.start());
    $('checkStop').addEventListener('click', () => {
      LeadChecker.pause();
      $('checkStop').disabled = true;
      $('checkStop').textContent = 'Pausing after this lead…';
    });
    $('retryBtn').addEventListener('click', async () => {
      await LeadChecker.retryFailed();
      LeadChecker.start();
    });
    $('englishBtn').addEventListener('click', openMapsInEnglish);
    window.addEventListener('online', () => LeadChecker.start({ auto: true }));
    // Don't redraw the list under the user's mouse or while they pick a status (cards would jump).
    const list = $('list');
    list.addEventListener('mouseenter', () => (pointerInList = true));
    list.addEventListener('mouseleave', () => {
      pointerInList = false;
      if (listDirty) renderLeads();
    });
    list.addEventListener('focusout', () => setTimeout(() => listDirty && !listBusy() && renderLeads(), 0));
    $('more').addEventListener('click', () => {
      shown += PAGE;
      renderLeads();
    });
    document.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        filter = b.dataset.filter;
        shown = PAGE;
        renderLeads();
      })
    );
    $('contactsBtn').addEventListener('click', () => exportContacts());
    $('sheetsBtn').addEventListener('click', copyForSheets);
    $('csvBtn').addEventListener('click', downloadCsv);
    $('deleteAll').addEventListener('click', deleteAll);

    $('permBtn').addEventListener('click', () => {
      // Must be called straight from the click for Chrome to show its prompt.
      chrome.permissions.request({ origins: ['<all_urls>'] }).then((granted) => {
        if (granted) {
          $('permNote').hidden = true;
          LeadChecker.start();
        }
      });
    });
    LeadChecker.onProgress(onCheckProgress);
    await renderCheckIdle();
    if (settings.autoCheck) LeadChecker.start({ auto: true }); // carries on where it left off
  }

  function onStorageChange(changes, area) {
    if (area !== 'local') return;
    let leadsChanged = false;
    Object.keys(changes).forEach((key) => {
      if (key.indexOf('lead:') === 0) {
        const value = changes[key].newValue;
        if (value) leads.set(value.e164, value);
        else leads.delete(key.slice(5));
        leadsChanged = true;
      } else if (key === 'run') {
        run = changes[key].newValue || null;
        renderRun();
        // A collection just finished: check the new leads.
        if (run && !run.active && run.finishedAt && run.finishedAt !== lastFinishedRun) {
          lastFinishedRun = run.finishedAt;
          if (settings.autoCheck && run.stats && run.stats.added) LeadChecker.start({ auto: true });
          else renderCheckIdle();
        }
      } else if (key === 'settings') {
        settings = LF.withDefaults(changes[key].newValue);
        leadsChanged = true;
      }
    });
    if (leadsChanged) scheduleRender();
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderLeads({ soft: true });
      if (!checkState.running) renderCheckIdle();
    }, 200);
  }

  /** The user is choosing a status, typing an Instagram handle, or has the mouse over the list. */
  function listBusy() {
    const a = document.activeElement;
    return pointerInList || !!(a && $('list').contains(a) && /^(SELECT|INPUT)$/.test(a.tagName));
  }

  // ─── 1 · Finding leads ─────────────────────────────────────────────────────

  function isMapsUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && MAPS_HOSTS.indexOf(u.host) >= 0 && (u.host === 'maps.google.com' || /^\/maps(\/|$)/.test(u.pathname));
    } catch (e) {
      return false;
    }
  }

  async function openMapsInEnglish() {
    if (!mapsTab) return;
    try {
      const u = new URL(mapsTab.url);
      u.searchParams.set('hl', 'en');
      await chrome.tabs.update(mapsTab.id, { url: u.href, active: true });
    } catch (e) {
      showError("Couldn't switch the Maps tab to English. Change the language in Google Maps' menu instead.");
    }
  }

  async function findMapsTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && isMapsUrl(active.url)) return active;
    const tabs = await chrome.tabs.query({ url: MAPS_PATTERNS });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] || null;
  }

  async function refreshTab() {
    try {
      mapsTab = await findMapsTab();
    } catch (e) {
      mapsTab = null;
    }
    let label = '';
    let english = true;
    if (mapsTab) {
      label = queryFromUrl(mapsTab.url);
      try {
        const page = await chrome.tabs.sendMessage(mapsTab.id, { type: 'rr-ping' });
        if (page && page.english === false) english = false;
        if (page && page.hasList) label = page.query || 'The results list on Google Maps';
        else if (page && page.placeName) label = 'One business: ' + page.placeName;
        else if (page) label = '';
      } catch (e) {
        // Content script not there yet (tab opened before install); the address is good enough.
      }
    }
    $('query').textContent = label || 'Search Google Maps for a type of business first';
    $('langNote').hidden = english;
    renderRun();
  }

  function queryFromUrl(url) {
    const m = String(url || '').match(/\/maps\/search\/([^/?]+)/);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch (e) {
      return m[1];
    }
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'rr-ping' });
    } catch (e) {
      // The tab was open before the extension was installed.
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['leads.js', 'content.js'] });
    }
  }

  async function startCollect() {
    showError('');
    const tab = await findMapsTab();
    if (!tab) return showError('Open Google Maps and search for something first.');
    try {
      await ensureContentScript(tab.id);
    } catch (e) {
      return showError("Couldn't connect to the Google Maps tab. Reload that tab and try again.");
    }
    collectingTabId = tab.id;
    chrome.storage.session.set({ collectingTabId: tab.id }).catch(() => {});
    $('collectBtn').disabled = true;
    chrome.tabs
      .sendMessage(tab.id, { type: 'rr-collect' })
      .then((res) => {
        if (res && res.error) showError(res.error);
      })
      .catch(() => showError('The Google Maps tab stopped responding. Reload it and try again.'))
      .finally(() => {
        $('collectBtn').disabled = false;
      });
  }

  async function stopCollect() {
    // The tab that is collecting, even if the panel was closed and reopened since.
    const saved = ((await chrome.storage.session.get('collectingTabId').catch(() => ({}))) || {}).collectingTabId;
    const tabId = collectingTabId || saved || (mapsTab && mapsTab.id);
    if (tabId == null) return;
    $('stopBtn').disabled = true;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'rr-stop' });
    } catch (e) {
      // Tab is gone; renderRun will notice.
    }
  }

  function renderRun() {
    const active = !!(run && run.active && Date.now() - (run.updatedAt || 0) < 30000);
    // The Maps tab was closed or reloaded mid-collection: treat it as stopped, and check what it found.
    const died = !!(run && run.active && !active);
    if (died && run.startedAt !== lastFinishedRun) {
      lastFinishedRun = run.startedAt;
      if (settings.autoCheck && run.stats && run.stats.added) LeadChecker.start({ auto: true });
    }
    $('running').hidden = !active;
    $('ready').hidden = active || !mapsTab;
    $('noMaps').hidden = active || !!mapsTab;
    if (!active) $('stopBtn').disabled = false;

    if (active) {
      const s = run.stats || {};
      $('phase').textContent =
        run.phase === 'loading'
          ? 'Loading the results… ' + run.total + ' so far'
          : 'Opening ' + run.done + ' of ' + run.total + ' · ' + (s.added || 0) + ' new lead' + (s.added === 1 ? '' : 's');
      $('meterBar').style.width = run.phase === 'loading' || !run.total ? '6%' : Math.round((100 * run.done) / run.total) + '%';
    }

    const summary = $('summary');
    if (run && run.stats && !active && run.startedAt) {
      const s = run.stats;
      const parts = [s.checked + ' opened'];
      if (s.closed) parts.push(s.closed + ' closed');
      parts.push((s.noMobile || 0) + ' no mobile', (s.dupes || 0) + ' already saved');
      if (s.filtered) parts.push(s.filtered + ' skipped by your settings');
      summary.textContent = '';
      const strong = document.createElement('b');
      strong.textContent = s.added + ' new lead' + (s.added === 1 ? '' : 's');
      const withSite =
        (s.withSite ? ' (' + s.withSite + ' with a website' : '') +
        (s.fromWebsite ? (s.withSite ? ', ' : ' (') + s.fromWebsite + ' mobile' + (s.fromWebsite === 1 ? '' : 's') + ' found on their website' : '') +
        (s.withSite || s.fromWebsite ? ')' : '');
      const early = run.error || died;
      const head =
        run.phase === 'stopped'
          ? 'Stopped. '
          : early
            ? 'Stopped early' + (run.total ? ' (after ' + run.done + ' of ' + run.total + ')' : '') + '. '
            : 'Done. ';
      summary.append(head + (run.query ? '"' + run.query + '": ' : ''), strong, withSite + ' · ' + parts.join(' · '));
      summary.hidden = false;
      if (run.error) showError(run.error);
      else if (s.unreadable >= 3 && s.unreadable > s.checked / 2) {
        showError("Couldn't read most of these businesses. Google Maps may have changed its page. Send RizcoReach a screenshot of the Maps tab.");
      }
    } else {
      summary.hidden = true;
    }
  }

  function showError(message) {
    $('error').textContent = message;
    $('error').hidden = !message;
  }

  // ─── 2 · Checking leads ────────────────────────────────────────────────────

  function onCheckProgress(state) {
    checkState = state;
    $('permNote').hidden = !state.needsPermission;
    $('checkRunning').hidden = !state.running;
    $('checkIdle').hidden = state.running;
    if (state.running) {
      $('checkStop').disabled = false;
      $('checkStop').textContent = 'Pause checks';
      $('checkPhase').textContent = 'Checking ' + state.current + (state.left ? ' · ' + state.left + ' more after this' : '');
      renderInstagramNote(state.igPausedUntil, state.waitingForInstagram, state.igReason);
    } else {
      renderCheckIdle();
    }
  }

  async function renderCheckIdle() {
    if (checkState.running) return;
    const last = checkState; // how the last run ended (offline, running in another window…)
    const p = await LeadChecker.pending();
    const left = p.todo.length;
    const failed = p.failed.length;
    $('checkBtn').hidden = !left;
    $('checkBtn').textContent = 'Check ' + left + ' lead' + (left === 1 ? '' : 's') + ' now';
    const plural = (n, one, many) => n + ' lead' + (n === 1 ? one : many);
    let text;
    if (!leads.size) text = 'Collected leads get their website and Instagram checked here.';
    else if (!settings.checkWebsites && !settings.checkInstagram) text = 'Checks are switched off in "What makes a good lead".';
    else if (left) text = plural(left, ' is', 's are') + ' waiting to be checked.' + (LeadChecker.isPaused() ? ' Checks are paused.' : '');
    else if (p.waitingForInstagram) text = 'Everything else is checked.';
    else if (failed) text = 'The other leads are checked.';
    else text = 'All ' + leads.size + ' leads are checked.';
    $('checkText').textContent = text;

    $('failedNote').hidden = !failed;
    $('failedText').textContent = failed
      ? plural(failed, '', 's') + " couldn't be fully checked (e.g. bot protection or a page that wouldn't open). They're marked on each card."
      : '';

    const notes = [];
    if (last && last.offline) notes.push("This computer seems to be offline. Checks carry on when it's back.");
    if (last && last.elsewhere) notes.push('Checks are already running in the Lead Finder panel of another Chrome window.');
    if (p.pagespeedError) notes.push('Google PageSpeed refused the key: "' + p.pagespeedError + '" Check the key under What makes a good lead.');
    $('checkNote').textContent = notes.join(' ');
    $('checkNote').hidden = !notes.length;
    renderInstagramNote(p.igPausedUntil, p.waitingForInstagram, p.igReason);
  }

  function renderInstagramNote(until, waiting, reason) {
    const note = $('igNote');
    clearTimeout(igTimer);
    if (!until) {
      note.hidden = true;
      return;
    }
    const when = new Date(until);
    const tomorrow = when.toDateString() !== new Date().toDateString();
    const at = (tomorrow ? 'tomorrow ' : '') + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const restarts = settings.autoCheck && !LeadChecker.isPaused();
    const waitingText = waiting ? ' ' + waiting + ' lead' + (waiting === 1 ? ' is' : 's are') + ' waiting for it.' : '';
    if (reason === 'dailyLimit') {
      note.textContent =
        "You've looked at " + settings.instagramPerDay + ' Instagram profiles today (your daily limit), so Instagram checks continue tomorrow.' +
        waitingText + ' To do more today, raise "Instagram profiles to look at per day" under What makes a good lead.';
    } else if (reason === 'login') {
      note.textContent =
        'Instagram only shows profiles to logged-in visitors right now. Open instagram.com in this Chrome and log in ' +
        '(a spare account is safest), then press Check.' + waitingText;
    } else {
      note.textContent =
        'Instagram asked us to slow down, so Instagram checks are paused until ' + at + '.' + waitingText +
        (restarts ? ' They restart by themselves while this panel is open.' : ' Press Check after that time.');
    }
    note.hidden = false;
    if (restarts) igTimer = setTimeout(() => LeadChecker.start({ auto: true }), Math.max(1000, Math.min(until - Date.now() + 2000, 2147483000)));
  }

  // ─── 3 · Leads ─────────────────────────────────────────────────────────────

  /** Facts across all leads that scoring needs (e.g. the same website on several listings). */
  function context() {
    return { siteCounts: LF.siteCounts(Array.from(leads.values())) };
  }

  function evaluated() {
    const c = context();
    return Array.from(leads.values()).map((lead) => ({ lead: lead, ev: LF.evaluate(lead, settings, c) }));
  }

  function inTab(item, f) {
    const status = item.lead.status;
    const fresh = status === 'New';
    if (f === 'contacted') return status !== 'New' && status !== 'Do not contact';
    if (f === 'all') return true;
    return fresh && item.ev.verdict === f;
  }

  function todayKey(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function sentToday() {
    const today = todayKey();
    let n = 0;
    leads.forEach((l) => {
      if (l.contacted && todayKey(l.contacted) === today) n++;
    });
    return n;
  }

  /** soft: a background update, which waits while the user is using the list. */
  function renderLeads(opts) {
    const all = evaluated();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.filter === filter));
      b.querySelector('span').textContent = all.filter((item) => inTab(item, b.dataset.filter)).length;
    });
    const sent = sentToday();
    $('today').textContent = 'Today: ' + sent + (settings.dailyLimit ? ' / ' + settings.dailyLimit : '') + ' chats';

    const list = all
      .filter((item) => inTab(item, filter))
      .sort((a, b) => LF.byVerdict(a.ev, b.ev) || String(b.lead.added).localeCompare(String(a.lead.added)));
    if (opts && opts.soft && listBusy()) {
      listDirty = true;
      return;
    }
    listDirty = false;
    const ul = $('list');
    ul.textContent = '';
    list.slice(0, shown).forEach((item) => ul.appendChild(leadCard(item.lead, item.ev)));
    $('more').hidden = list.length <= shown;

    const empty = $('empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = !leads.size
        ? 'No leads yet. Search Google Maps, then click "Collect leads from this search".'
        : {
            hot: 'No hot leads yet. Check the Good and Checking tabs, or loosen "What makes a good lead".',
            good: 'No good leads here yet.',
            checking: 'Nothing is waiting for checks.',
            low: 'No low-scoring leads.',
            contacted: 'Leads you message show up here.',
            all: '',
          }[filter];
    }
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function leadCard(lead, ev) {
    const li = el('li', 'lead');

    const head = el('div', 'lead-head');
    // A lead that's Low because of a rule (e.g. under your follower minimum) shows no score: its reasons say why.
    const showScore = ev.verdict !== 'checking' && !ev.blockers.length;
    const pill = el('span', 'pill pill-' + ev.verdict, VERDICT[ev.verdict] + (showScore ? ' ' + ev.score : ''));
    pill.title = 'Lead score ' + ev.score + '/100';
    const name = el('p', 'lead-name', lead.name || LF.formatPhone(lead.e164));
    head.append(pill, name);

    const meta = el('p', 'lead-meta');
    const num = el('span', 'num', LF.formatPhone(lead.e164));
    if (lead.phoneSource) num.title = 'From the ' + lead.phoneSource;
    meta.append(num);
    if (lead.phoneSource) meta.append(' (from their website)');
    if (lead.category) meta.append(' · ' + lead.category);

    const reasons = el('ul', 'reasons');
    ev.reasons.forEach((r) => reasons.appendChild(el('li', 'reason reason-' + r.tone, r.text)));

    const wa = el('button', 'wa', confirmed.has(lead.e164) ? 'Send anyway' : 'WhatsApp');
    wa.type = 'button';
    wa.title = 'Open the chat with your message typed in';
    if (lead.status === 'Do not contact') {
      wa.disabled = true;
      wa.title = 'Marked "Do not contact"';
    }
    wa.addEventListener('click', () => message(lead, wa, li));

    const foot = el('div', 'lead-foot');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Status for ' + (lead.name || lead.e164));
    LF.STATUSES.forEach((s) => {
      const o = el('option', null, s);
      o.value = s;
      o.selected = s === lead.status;
      select.appendChild(o);
    });
    select.addEventListener('change', () => {
      justSent.delete(lead.e164);
      const patch = { status: select.value };
      if (select.value === 'Messaged' && !lead.contacted) patch.contacted = new Date().toISOString();
      updateLead(lead.e164, patch);
    });
    foot.appendChild(select);
    const links = el('span', 'links');
    if (lead.mapsUrl) links.appendChild(link(lead.mapsUrl, 'Maps'));
    if (lead.website) links.appendChild(link(/^https?:/i.test(lead.website) ? lead.website : 'https://' + lead.website, 'Website'));
    if (ev.handle) links.appendChild(link('https://www.instagram.com/' + ev.handle + '/', 'Instagram'));
    foot.appendChild(links);
    const again = el('button', 'linkish', 'Recheck');
    again.type = 'button';
    again.title = 'Check the website and Instagram again';
    again.addEventListener('click', async () => {
      await LeadChecker.recheck([lead.e164], ['site', 'pagespeed', 'instagram']);
      LeadChecker.start();
    });
    foot.appendChild(again);

    // No Instagram found? Let the user look it up and add it.
    if (!ev.handle && settings.checkInstagram) {
      const add = el('button', 'linkish', 'Add Instagram');
      add.type = 'button';
      add.addEventListener('click', () => {
        add.hidden = true;
        const form = el('form', 'ig-form');
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '@handle or instagram.com/…';
        input.setAttribute('aria-label', 'Instagram for ' + (lead.name || lead.e164));
        const save = el('button', 'btn', 'Save');
        save.type = 'submit';
        const search = link(
          'https://www.google.com/search?q=' + encodeURIComponent((lead.name || '') + ' ' + (lead.address || '').split(/[-,]/)[0] + ' instagram'),
          'Search for it'
        );
        form.append(input, save, search);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const raw = input.value.trim();
          const handle = LF.instagramHandle(/instagr/i.test(raw) ? raw : 'instagram.com/' + raw.replace(/^@/, ''));
          if (!handle) {
            input.setCustomValidity('That doesn\'t look like an Instagram account');
            input.reportValidity();
            return;
          }
          const current = leads.get(lead.e164) || lead;
          const checks = Object.assign({}, current.checks || {});
          delete checks.instagram;
          await updateLead(lead.e164, { socials: Object.assign({}, current.socials || {}, { instagram: handle }), checks: checks });
          LeadChecker.start();
        });
        input.addEventListener('input', () => input.setCustomValidity(''));
        li.appendChild(form);
        input.focus();
      });
      foot.appendChild(add);
    }

    const main = el('div', 'lead-main');
    main.append(head, meta, reasons);
    li.append(main, wa, foot);
    if (confirmed.has(lead.e164)) sendWarnings().forEach((w) => li.appendChild(el('p', 'warn', w)));
    if (justSent.has(lead.e164)) {
      const sent = el('p', 'sent', 'Chat opened. Didn\'t send it?');
      const undo = el('button', 'linkish', 'Undo');
      undo.type = 'button';
      undo.addEventListener('click', async () => {
        const before = justSent.get(lead.e164);
        justSent.delete(lead.e164);
        await updateLead(lead.e164, before);
      });
      sent.append(' ', undo);
      li.appendChild(sent);
    }
    return li;
  }

  function link(href, text) {
    const a = el('a', null, text);
    a.href = /^https?:\/\//i.test(href) ? href : 'about:blank';
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  async function updateLead(e164, patch) {
    const key = 'lead:' + e164;
    const current = (await chrome.storage.local.get(key))[key];
    if (!current) return;
    await chrome.storage.local.set({ [key]: Object.assign({}, current, patch) });
  }

  // ─── WhatsApp ──────────────────────────────────────────────────────────────

  /** Reasons to think twice before opening another chat now. */
  function sendWarnings() {
    const warnings = [];
    if (settings.dailyLimit && sentToday() >= settings.dailyLimit) {
      warnings.push(
        "You've opened " + sentToday() + ' chats today. Messaging many new people from one number in a day ' +
          'is the quickest way to get it blocked by WhatsApp. Best to continue tomorrow.'
      );
    }
    const hour = new Date().getHours();
    if (settings.country === 'AE' && (hour < 9 || hour >= 18)) {
      warnings.push("It's outside 9am–6pm. UAE telemarketing rules limit marketing messages to those hours.");
    }
    return warnings;
  }

  async function message(rendered, button, row) {
    const lead = leads.get(rendered.e164) || rendered;
    if (lead.status === 'Do not contact') return;
    if (!confirmed.has(lead.e164)) {
      const warnings = sendWarnings();
      if (warnings.length) {
        confirmed.add(lead.e164);
        button.textContent = 'Send anyway';
        warnings.forEach((w) => row.appendChild(el('p', 'warn', w)));
        return;
      }
    }
    confirmed.delete(lead.e164);
    const text = LF.messageFor(lead, settings, LF.evaluate(lead, settings, context()));
    await openWhatsApp(LF.whatsAppUrl(lead.e164, text, settings.openIn));
    justSent.set(lead.e164, { status: lead.status, contacted: lead.contacted || '' });
    const patch = { contacted: new Date().toISOString() };
    if (lead.status === 'New') patch.status = 'Messaged';
    await updateLead(lead.e164, patch);
  }

  /** Reuses one WhatsApp tab instead of opening a new one per chat (only while it still shows WhatsApp). */
  async function openWhatsApp(url) {
    const saved = (await chrome.storage.session.get('waTabId')).waTabId;
    if (saved != null) {
      try {
        const current = await chrome.tabs.get(saved);
        if (/^https:\/\/([a-z]+\.)?(whatsapp\.com|wa\.me)\//.test(current.url || current.pendingUrl || '')) {
          const tab = await chrome.tabs.update(saved, { url: url, active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return;
        }
      } catch (e) {
        // The tab was closed.
      }
    }
    const tab = await chrome.tabs.create({ url: url, active: true });
    await chrome.storage.session.set({ waTabId: tab.id });
  }

  // ─── 4 · Saving ────────────────────────────────────────────────────────────

  function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function download(filename, text, bom) {
    const blob = new Blob([(bom ? '﻿' : '') + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showHint(nodes) {
    const hint = $('saveHint');
    hint.textContent = '';
    hint.append.apply(hint, nodes);
    hint.hidden = false;
  }

  /** Leads in score order, best first. */
  function ranked(list) {
    const c = context();
    return list
      .map((lead) => ({ lead: lead, ev: LF.evaluate(lead, settings, c) }))
      .sort((a, b) => LF.byVerdict(a.ev, b.ev))
      .map((x) => x.lead);
  }

  /** Hot and good leads that haven't been saved for Google Contacts yet (again: all of them). */
  async function exportContacts(again) {
    const c = context();
    const best = ranked(Array.from(leads.values()).filter((l) => l.status !== 'Do not contact')).filter((l) => {
      const v = LF.evaluate(l, settings, c).verdict;
      return v === 'hot' || v === 'good';
    });
    if (!best.length) {
      return showHint(['No hot or good leads yet. Wait for the checks to finish, or use Download spreadsheet (CSV) for every lead.']);
    }
    const batch = again === true ? best : best.filter((l) => !l.exported);
    if (!batch.length) {
      // Importing the same people twice creates duplicate contacts on the phone.
      const all = el('button', 'linkish', 'Download all ' + best.length + ' again');
      all.type = 'button';
      all.addEventListener('click', () => exportContacts(true));
      return showHint(['All your hot and good leads are already in a Contacts file you downloaded. ', all]);
    }
    const filename = 'rizcoreach-leads-contacts-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.contactsRows(batch, settings, c)), false);
    await chrome.storage.local.set(
      batch.reduce((acc, l) => {
        acc['lead:' + l.e164] = Object.assign({}, leads.get(l.e164) || l, { exported: true });
        return acc;
      }, {})
    );
    showHint([
      (again === true ? 'Saved all ' + batch.length + ' hot and good leads' : 'Saved ' + batch.length + ' new hot and good lead(s)') +
        ' to ' + filename + '. Now open ',
      link('https://contacts.google.com/', 'Google Contacts'),
      ', click Import on the left, and choose that file. They appear under the label "' + (settings.contactLabel || 'Imported') + '" and sync to your phone.' +
        (again === true ? ' Contacts you imported before will be duplicated.' : ''),
    ]);
  }

  async function copyForSheets() {
    const all = ranked(Array.from(leads.values()));
    if (!all.length) return showHint(['No leads to copy yet.']);
    try {
      await navigator.clipboard.writeText(LF.toTsv(LF.sheetRows(all, settings, context())));
    } catch (e) {
      return showHint(["Couldn't copy. Use Download spreadsheet (CSV) instead."]);
    }
    showHint(['Copied ' + all.length + ' leads, best first. Open ', link('https://sheets.new', 'a new Google Sheet'), ', click cell A1 and press Ctrl+V (⌘V on Mac).']);
  }

  function downloadCsv() {
    const all = ranked(Array.from(leads.values()));
    if (!all.length) return showHint(['No leads to download yet.']);
    const filename = 'rizcoreach-leads-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.sheetRows(all, settings, context())), true);
    showHint(['Saved ' + filename + '. Open it with Google Sheets (File → Import) or Excel.']);
  }

  async function deleteAll() {
    const button = $('deleteAll');
    if (!deleteArmed) {
      button.textContent = 'Click again to delete ' + leads.size + ' leads';
      deleteArmed = setTimeout(() => {
        deleteArmed = null;
        button.textContent = 'Delete all leads';
      }, 4000);
      return;
    }
    clearTimeout(deleteArmed);
    deleteArmed = null;
    LeadChecker.stop();
    await chrome.storage.local.remove(Array.from(leads.keys()).map((e) => 'lead:' + e).concat(['run']));
    button.textContent = 'Delete all leads';
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  const TEXT_FIELDS = ['messageNoSite', 'messageWeakSite', 'contactPrefix', 'contactLabel', 'pagespeedKey'];
  const NUMBER_FIELDS = {
    dailyLimit: [0, 500],
    maxResults: [10, 500],
    slowSeconds: [1, 20],
    minFollowers: [0, 1e9],
    minReviews: [0, 1e6],
    weakAt: [1, 5],
    instagramPerDay: [10, 500],
  };
  const CHECK_FIELDS = ['mobileOnly', 'socialIsNoWebsite', 'requireInstagram', 'checkWebsites', 'checkInstagram', 'autoCheck'];
  const SELECT_FIELDS = ['openIn', 'country', 'keep'];

  function fillSettingsForm() {
    const country = $('set-country');
    Object.keys(LF.PHONE_RULES).forEach((iso) => {
      const o = el('option', null, LF.PHONE_RULES[iso].name + ' (+' + LF.PHONE_RULES[iso].cc + ')');
      o.value = iso;
      country.appendChild(o);
    });

    const box = $('criteriaList');
    LF.ISSUES.forEach((issue) => {
      const label = el('label', 'check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'crit-' + issue.id;
      input.checked = !!settings.criteria[issue.id];
      input.addEventListener('change', saveSettings);
      label.append(input, ' ' + issue.label);
      box.appendChild(label);
    });

    if (!settings.messageWeakSite) settings.messageWeakSite = LF.DEFAULT_WEAK_MESSAGE;
    TEXT_FIELDS.concat(Object.keys(NUMBER_FIELDS), SELECT_FIELDS).forEach((key) => {
      const input = $('set-' + key);
      input.value = settings[key] == null ? '' : settings[key];
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', saveSettings);
      if (NUMBER_FIELDS[key] && input.tagName === 'INPUT') {
        // When the user leaves the field, show the value actually used (e.g. 1000 → the 500 maximum).
        input.addEventListener('change', () => {
          const [min, max] = NUMBER_FIELDS[key];
          const value = parseFloat(input.value);
          input.value = isNaN(value) ? LF.DEFAULT_SETTINGS[key] : Math.min(max, Math.max(min, value));
        });
      }
    });
    CHECK_FIELDS.forEach((key) => {
      const input = $('set-' + key);
      input.checked = !!settings[key];
      input.addEventListener('change', saveSettings);
    });
  }

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const before = settings;
      const next = Object.assign({}, settings);
      TEXT_FIELDS.forEach((key) => (next[key] = $('set-' + key).value.trim()));
      if (!next.messageNoSite) next.messageNoSite = LF.DEFAULT_MESSAGE;
      if (!next.messageWeakSite) next.messageWeakSite = LF.DEFAULT_WEAK_MESSAGE;
      Object.keys(NUMBER_FIELDS).forEach((key) => {
        const [min, max] = NUMBER_FIELDS[key];
        const value = parseFloat($('set-' + key).value);
        next[key] = isNaN(value) ? LF.DEFAULT_SETTINGS[key] : Math.min(max, Math.max(min, value));
      });
      SELECT_FIELDS.forEach((key) => (next[key] = $('set-' + key).value));
      CHECK_FIELDS.forEach((key) => (next[key] = $('set-' + key).checked));
      next.criteria = {};
      LF.ISSUES.forEach((issue) => (next.criteria[issue.id] = $('crit-' + issue.id).checked));
      settings = next;
      await chrome.storage.local.set({ settings: next });
      renderLeads();
      // Newly switched-on checks (or a new PageSpeed key) start right away.
      const turnedOn =
        (next.checkWebsites && !before.checkWebsites) ||
        (next.checkInstagram && !before.checkInstagram) ||
        (next.pagespeedKey && next.pagespeedKey !== before.pagespeedKey);
      if (turnedOn && next.autoCheck) LeadChecker.start({ auto: true });
      else renderCheckIdle();
    }, 400);
  }

  init();
})();
