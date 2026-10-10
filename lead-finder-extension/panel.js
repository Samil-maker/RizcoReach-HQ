/* The Lead Finder side panel: collect from Maps, check leads, message the best, export. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAPS_PATTERNS = chrome.runtime.getManifest().content_scripts[0].matches;
  const PAGE = 40;
  const VERDICT = { hot: 'Hot', good: 'Good', low: 'Low', checking: 'Checking' };

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
      LeadChecker.stop();
      $('checkStop').disabled = true;
      $('checkStop').textContent = 'Pausing after this lead…';
    });
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
    $('contactsBtn').addEventListener('click', exportContacts);
    $('sheetsBtn').addEventListener('click', copyForSheets);
    $('csvBtn').addEventListener('click', downloadCsv);
    $('deleteAll').addEventListener('click', deleteAll);

    LeadChecker.onProgress(onCheckProgress);
    await renderCheckIdle();
    if (settings.autoCheck) LeadChecker.start(); // carries on where it left off
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
          if (settings.autoCheck && run.stats && run.stats.added) LeadChecker.start();
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
      renderLeads();
      if (!checkState.running) renderCheckIdle();
    }, 200);
  }

  // ─── 1 · Finding leads ─────────────────────────────────────────────────────

  function isMapsUrl(url) {
    return /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.google\.com\/)/.test(url || '');
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
    const tabId = collectingTabId || (mapsTab && mapsTab.id);
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
      const withSite = s.withSite ? ' (' + s.withSite + ' with a website)' : '';
      summary.append((run.phase === 'stopped' ? 'Stopped. ' : 'Done. ') + (run.query ? '"' + run.query + '": ' : ''), strong, withSite + ' · ' + parts.join(' · '));
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
    $('checkRunning').hidden = !state.running;
    $('checkIdle').hidden = state.running;
    if (state.running) {
      $('checkStop').disabled = false;
      $('checkStop').textContent = 'Pause checks';
      $('checkPhase').textContent = 'Checking ' + state.current + ' · ' + state.left + ' to go';
    } else {
      renderCheckIdle();
    }
    renderInstagramNote(state.igPausedUntil, state.waitingForInstagram);
  }

  async function renderCheckIdle() {
    if (checkState.running) return;
    const p = await LeadChecker.pending();
    const left = p.todo.length;
    $('checkBtn').hidden = !left;
    $('checkBtn').textContent = 'Check ' + left + ' lead' + (left === 1 ? '' : 's') + ' now';
    if (!leads.size) $('checkText').textContent = 'Collected leads get their website and Instagram checked here.';
    else if (!settings.checkWebsites && !settings.checkInstagram) $('checkText').textContent = 'Checks are switched off in "What makes a good lead".';
    else if (left) $('checkText').textContent = left + ' lead' + (left === 1 ? ' is' : 's are') + ' waiting to be checked.';
    else if (p.waitingForInstagram) $('checkText').textContent = 'Everything else is checked.';
    else $('checkText').textContent = 'All ' + leads.size + ' leads are checked.';
    renderInstagramNote(p.igPausedUntil, p.waitingForInstagram);
  }

  function renderInstagramNote(until, waiting) {
    const note = $('igNote');
    clearTimeout(igTimer);
    if (!until) {
      note.hidden = true;
      return;
    }
    const at = new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    note.textContent =
      'Instagram asked us to slow down, so Instagram checks are paused until ' + at + '.' +
      (waiting ? ' ' + waiting + ' lead' + (waiting === 1 ? ' is' : 's are') + ' waiting for them.' : '') +
      ' They restart by themselves while this panel is open.';
    note.hidden = false;
    igTimer = setTimeout(() => LeadChecker.start(), Math.max(1000, until - Date.now() + 2000));
  }

  // ─── 3 · Leads ─────────────────────────────────────────────────────────────

  function evaluated() {
    return Array.from(leads.values()).map((lead) => ({ lead: lead, ev: LF.evaluate(lead, settings) }));
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

  function renderLeads() {
    const all = evaluated();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.filter === filter));
      b.querySelector('span').textContent = all.filter((item) => inTab(item, b.dataset.filter)).length;
    });
    const sent = sentToday();
    $('today').textContent = 'Today: ' + sent + (settings.dailyLimit ? ' / ' + settings.dailyLimit : '') + ' chats';

    const list = all
      .filter((item) => inTab(item, filter))
      .sort((a, b) => b.ev.score - a.ev.score || String(b.lead.added).localeCompare(String(a.lead.added)));
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
    const pill = el('span', 'pill pill-' + ev.verdict, VERDICT[ev.verdict] + (ev.verdict === 'checking' ? '' : ' ' + ev.score));
    pill.title = 'Lead score ' + ev.score + '/100';
    const name = el('p', 'lead-name', lead.name || LF.formatPhone(lead.e164));
    head.append(pill, name);

    const meta = el('p', 'lead-meta');
    meta.append(el('span', 'num', LF.formatPhone(lead.e164)));
    if (lead.category) meta.append(' · ' + lead.category);

    const reasons = el('ul', 'reasons');
    ev.reasons.forEach((r) => reasons.appendChild(el('li', 'reason reason-' + r.tone, r.text)));

    const wa = el('button', 'wa', 'WhatsApp');
    wa.type = 'button';
    wa.title = 'Open the chat with your message typed in';
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

    const main = el('div', 'lead-main');
    main.append(head, meta, reasons);
    li.append(main, wa, foot);
    return li;
  }

  function link(href, text) {
    const a = el('a', null, text);
    a.href = href;
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

  async function message(rendered, button, row) {
    const lead = leads.get(rendered.e164) || rendered;
    if (settings.dailyLimit && sentToday() >= settings.dailyLimit && !button.dataset.confirmed) {
      button.dataset.confirmed = '1';
      button.textContent = 'Send anyway';
      row.appendChild(
        el('p', 'warn',
          "You've opened " + sentToday() + ' chats today. Messaging many new people from one number in a day ' +
            'is the quickest way to get it blocked by WhatsApp. Best to continue tomorrow.')
      );
      return;
    }
    const text = LF.messageFor(lead, settings);
    await openWhatsApp(LF.whatsAppUrl(lead.e164, text, settings.openIn));
    const patch = { contacted: new Date().toISOString() };
    if (lead.status === 'New') patch.status = 'Messaged';
    await updateLead(lead.e164, patch);
  }

  /** Reuses one WhatsApp tab instead of opening a new one per chat. */
  async function openWhatsApp(url) {
    const saved = (await chrome.storage.session.get('waTabId')).waTabId;
    if (saved != null) {
      try {
        const tab = await chrome.tabs.update(saved, { url: url, active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
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
    return list
      .map((lead) => ({ lead: lead, ev: LF.evaluate(lead, settings) }))
      .sort((a, b) => b.ev.score - a.ev.score)
      .map((x) => x.lead);
  }

  async function exportContacts() {
    // Hot and good leads by default; everything if there are none.
    const usable = ranked(Array.from(leads.values()).filter((l) => l.status !== 'Do not contact'));
    const best = usable.filter((l) => {
      const v = LF.evaluate(l, settings).verdict;
      return v === 'hot' || v === 'good';
    });
    const pool = best.length ? best : usable;
    const fresh = pool.filter((l) => !l.exported);
    const batch = fresh.length ? fresh : pool;
    if (!batch.length) return showHint(['No leads to save yet.']);
    const filename = 'rizcoreach-leads-contacts-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.contactsRows(batch, settings)), false);
    await chrome.storage.local.set(
      batch.reduce((acc, l) => {
        acc['lead:' + l.e164] = Object.assign({}, leads.get(l.e164) || l, { exported: true });
        return acc;
      }, {})
    );
    const which = best.length ? 'hot and good' : '';
    showHint([
      (fresh.length ? 'Saved ' + batch.length + ' new ' + which + ' lead(s)' : 'No new leads since last time, so all ' + batch.length + ' ' + which + ' leads were saved') +
        ' to ' + filename + '. Now open ',
      link('https://contacts.google.com/', 'Google Contacts'),
      ', click Import on the left, and choose that file. They appear under the label "' + (settings.contactLabel || 'Imported') + '" and sync to your phone.',
    ]);
  }

  async function copyForSheets() {
    const all = ranked(Array.from(leads.values()));
    if (!all.length) return showHint(['No leads to copy yet.']);
    try {
      await navigator.clipboard.writeText(LF.toTsv(LF.sheetRows(all, settings)));
    } catch (e) {
      return showHint(["Couldn't copy. Use Download spreadsheet (CSV) instead."]);
    }
    showHint(['Copied ' + all.length + ' leads, best first. Open ', link('https://sheets.new', 'a new Google Sheet'), ', click cell A1 and press Ctrl+V (⌘V on Mac).']);
  }

  function downloadCsv() {
    const all = ranked(Array.from(leads.values()));
    if (!all.length) return showHint(['No leads to download yet.']);
    const filename = 'rizcoreach-leads-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.sheetRows(all, settings)), true);
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
      if (turnedOn && next.autoCheck) LeadChecker.start();
      else renderCheckIdle();
    }, 400);
  }

  init();
})();
