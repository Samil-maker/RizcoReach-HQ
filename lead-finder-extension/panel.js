/* The Lead Finder side panel: start a collection, message leads, export them. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAPS_PATTERNS = chrome.runtime.getManifest().host_permissions;
  const PAGE = 50;

  let settings = Object.assign({}, LF.DEFAULT_SETTINGS);
  const leads = new Map(); // e164 → lead
  let run = null;
  let mapsTab = null;
  let collectingTabId = null;
  let filter = 'New';
  let shown = PAGE;
  let deleteArmed = null;

  // ─── Start-up ──────────────────────────────────────────────────────────────

  async function init() {
    settings = await LF.loadSettings();
    (await LF.loadLeads()).forEach((l) => leads.set(l.e164, l));
    run = (await chrome.storage.local.get('run')).run || null;

    fillSettingsForm();
    renderLeads();
    renderRun();
    await refreshTab();

    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.tabs.onActivated.addListener(refreshTab);
    chrome.tabs.onUpdated.addListener((_id, info) => {
      if (info.url || info.status === 'complete') refreshTab();
    });
    chrome.tabs.onRemoved.addListener(refreshTab);
    setInterval(renderRun, 4000); // notices a collection that died with its tab

    $('collectBtn').addEventListener('click', startCollect);
    $('stopBtn').addEventListener('click', stopCollect);
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
      } else if (key === 'settings') {
        settings = Object.assign({}, LF.DEFAULT_SETTINGS, changes[key].newValue || {});
      }
    });
    if (leadsChanged) scheduleRenderLeads();
  }

  let renderTimer = null;
  function scheduleRenderLeads() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderLeads, 150);
  }

  // ─── Finding leads ─────────────────────────────────────────────────────────

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
    if (mapsTab) {
      label = queryFromUrl(mapsTab.url);
      try {
        const page = await chrome.tabs.sendMessage(mapsTab.id, { type: 'rr-ping' });
        if (page && page.hasList) label = page.query || 'The results list on Google Maps';
        else if (page && page.placeName) label = 'One business: ' + page.placeName;
        else if (page) label = '';
      } catch (e) {
        // Content script not there yet (tab opened before install); the address is good enough.
      }
    }
    $('query').textContent = label || 'Search Google Maps for a type of business first';
    renderRun();
  }

  function queryFromUrl(url) {
    const m = String(url || '').match(/\/maps\/search\/([^/?]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1].replace(/\+/g, ' '));
      } catch (e) {
        return m[1];
      }
    }
    return '';
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
          : 'Checking ' + run.done + ' of ' + run.total + ' · ' + (s.added || 0) + ' new lead' + (s.added === 1 ? '' : 's');
      $('meterBar').style.width = run.phase === 'loading' || !run.total ? '6%' : Math.round((100 * run.done) / run.total) + '%';
    }

    const summary = $('summary');
    if (run && run.stats && !active && run.startedAt) {
      const s = run.stats;
      const parts = [s.checked + ' checked', s.website + ' have a website', s.noMobile + ' no mobile', s.dupes + ' already saved'];
      if (s.closed) parts.splice(1, 0, s.closed + ' closed');
      summary.textContent = '';
      const lead = document.createElement('b');
      lead.textContent = s.added + ' new lead' + (s.added === 1 ? '' : 's');
      summary.append(
        (run.phase === 'stopped' ? 'Stopped. ' : 'Done. ') + (run.query ? '"' + run.query + '": ' : ''),
        lead,
        ' · ' + parts.join(' · ')
      );
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

  // ─── Leads list ────────────────────────────────────────────────────────────

  function sortedLeads() {
    return Array.from(leads.values()).sort((a, b) => String(b.added).localeCompare(String(a.added)));
  }

  function matches(lead, f) {
    if (f === 'New') return lead.status === 'New';
    if (f === 'Messaged') return lead.status === 'Messaged';
    if (f === 'Replied') return lead.status === 'Replied' || lead.status === 'Interested';
    return true;
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
    const all = sortedLeads();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.filter === filter));
      b.querySelector('span').textContent = all.filter((l) => matches(l, b.dataset.filter)).length;
    });
    const sent = sentToday();
    $('today').textContent = 'Today: ' + sent + (settings.dailyLimit ? ' / ' + settings.dailyLimit : '') + ' chats';

    const list = all.filter((l) => matches(l, filter));
    const ul = $('list');
    ul.textContent = '';
    list.slice(0, shown).forEach((lead) => ul.appendChild(leadRow(lead)));
    $('more').hidden = list.length <= shown;

    const empty = $('empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = leads.size
        ? 'Nothing here. Try the All tab.'
        : 'No leads yet. Search Google Maps, then click "Collect leads from this search".';
    }
  }

  function leadRow(lead) {
    const li = document.createElement('li');
    li.className = 'lead';

    const main = document.createElement('div');
    const name = document.createElement('p');
    name.className = 'lead-name';
    name.textContent = lead.name || LF.formatPhone(lead.e164);
    const meta = document.createElement('p');
    meta.className = 'lead-meta';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = LF.formatPhone(lead.e164);
    meta.append(num, lead.category ? ' · ' + lead.category : '');
    main.append(name, meta);

    const wa = document.createElement('button');
    wa.type = 'button';
    wa.className = 'wa';
    wa.textContent = 'WhatsApp';
    wa.title = 'Open the chat with your message typed in';
    wa.addEventListener('click', () => message(lead, wa, li));

    const foot = document.createElement('div');
    foot.className = 'lead-foot';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Status for ' + (lead.name || lead.e164));
    LF.STATUSES.forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      o.selected = s === lead.status;
      select.appendChild(o);
    });
    select.addEventListener('change', () => {
      const patch = { status: select.value };
      if (select.value === 'Messaged' && !lead.contacted) patch.contacted = new Date().toISOString();
      updateLead(lead.e164, patch);
    });
    foot.appendChild(select);
    if (lead.mapsUrl) {
      const a = document.createElement('a');
      a.href = lead.mapsUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Maps';
      foot.appendChild(a);
    }
    if (lead.contacted) {
      const when = document.createElement('span');
      when.textContent = 'Last chat ' + new Date(lead.contacted).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      foot.appendChild(when);
    }

    li.append(main, wa, foot);
    return li;
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
      const warn = document.createElement('p');
      warn.className = 'warn';
      warn.textContent =
        "You've opened " + sentToday() + ' chats today. Messaging many new people from one number in a day ' +
        'is the quickest way to get it blocked by WhatsApp. Best to continue tomorrow.';
      row.appendChild(warn);
      return;
    }
    await openWhatsApp(LF.whatsAppUrl(lead.e164, LF.fillMessage(settings.message, lead), settings.openIn));
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

  // ─── Saving ────────────────────────────────────────────────────────────────

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

  function link(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    return a;
  }

  async function exportContacts() {
    const usable = sortedLeads().filter((l) => l.status !== 'Do not contact');
    const fresh = usable.filter((l) => !l.exported);
    const batch = fresh.length ? fresh : usable;
    if (!batch.length) return showHint(['No leads to save yet.']);
    const filename = 'rizcoreach-leads-contacts-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.contactsRows(batch, settings)), false);
    await chrome.storage.local.set(
      batch.reduce((acc, l) => {
        acc['lead:' + l.e164] = Object.assign({}, l, { exported: true });
        return acc;
      }, {})
    );
    showHint([
      (fresh.length ? 'Saved ' + batch.length + ' new lead(s)' : 'No new leads since last time, so all ' + batch.length + ' were saved') +
        ' to ' + filename + '. Now open ',
      link('https://contacts.google.com/', 'Google Contacts'),
      ', click Import on the left, and choose that file. They appear under the label "' + (settings.contactLabel || 'Imported') + '" and sync to your phone.',
    ]);
  }

  async function copyForSheets() {
    const all = sortedLeads();
    if (!all.length) return showHint(['No leads to copy yet.']);
    try {
      await navigator.clipboard.writeText(LF.toTsv(LF.sheetRows(all)));
    } catch (e) {
      return showHint(["Couldn't copy. Use Download spreadsheet (CSV) instead."]);
    }
    showHint(['Copied ' + all.length + ' leads. Open ', link('https://sheets.new', 'a new Google Sheet'), ', click cell A1 and press Ctrl+V (⌘V on Mac).']);
  }

  function downloadCsv() {
    const all = sortedLeads();
    if (!all.length) return showHint(['No leads to download yet.']);
    const filename = 'rizcoreach-leads-' + stamp() + '.csv';
    download(filename, LF.toCsv(LF.sheetRows(all)), true);
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
    await chrome.storage.local.remove(Array.from(leads.keys()).map((e) => 'lead:' + e).concat(['run']));
    button.textContent = 'Delete all leads';
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  function fillSettingsForm() {
    const country = $('set-country');
    Object.keys(LF.PHONE_RULES).forEach((iso) => {
      const o = document.createElement('option');
      o.value = iso;
      o.textContent = LF.PHONE_RULES[iso].name + ' (+' + LF.PHONE_RULES[iso].cc + ')';
      country.appendChild(o);
    });
    const fields = ['message', 'openIn', 'dailyLimit', 'country', 'mobileOnly', 'socialIsNoWebsite', 'contactPrefix', 'contactLabel', 'maxResults'];
    fields.forEach((key) => {
      const el = $('set-' + key);
      if (el.type === 'checkbox') el.checked = !!settings[key];
      else el.value = settings[key];
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', saveSettings);
    });
  }

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const next = Object.assign({}, settings, {
        message: $('set-message').value.trim() || LF.DEFAULT_MESSAGE,
        openIn: $('set-openIn').value,
        dailyLimit: Math.max(0, parseInt($('set-dailyLimit').value, 10) || 0),
        country: $('set-country').value,
        mobileOnly: $('set-mobileOnly').checked,
        socialIsNoWebsite: $('set-socialIsNoWebsite').checked,
        contactPrefix: $('set-contactPrefix').value.trim(),
        contactLabel: $('set-contactLabel').value.trim(),
        maxResults: Math.min(500, Math.max(10, parseInt($('set-maxResults').value, 10) || LF.DEFAULT_SETTINGS.maxResults)),
      });
      settings = next;
      await chrome.storage.local.set({ settings: next });
      renderLeads();
    }, 300);
  }

  init();
})();
