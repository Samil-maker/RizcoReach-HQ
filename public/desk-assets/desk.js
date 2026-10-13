/* Lead Desk page (public/desk.html): the to-do list for confirming clients' ad leads on WhatsApp.
   Shared logic is in desk-core.js (window.DeskCore); data comes from /api/desk (netlify/functions/lead-desk.mts).
   Nothing is sent automatically: each button opens WhatsApp with the message typed, and the owner presses Send. */
(() => {
  const D = window.DeskCore;
  const API = '/api/desk';
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const POLL_MS = 20000;
  const KEY = 'desk-key';
  const CACHE = 'desk-cache';
  const PENDING = 'desk-pending';
  const PREFS = 'desk-prefs';

  const LEAD_TABS = ['todo', 'waiting', 'chatting', 'booked', 'closed'];
  const TAB_LABEL = { todo: 'To do', waiting: 'Waiting', chatting: 'Chatting', booked: 'Booked', closed: 'Closed', report: 'Report', setup: 'Setup' };
  const SOURCE = { meta: 'Meta', website: 'Website', manual: 'Manual', import: 'Import', test: 'Test' };
  const STATUS = { new: 'New', contacted: 'Messaged', replied: 'Replied', booked: 'Booked', lost: 'Not interested', noanswer: 'No answer', fake: 'Wrong number / fake', dup: 'Duplicate' };
  const FLAG = {
    landline: 'Landline: call instead',
    foreign: 'Foreign number',
    'invalid-phone': 'Check the number',
    'suspicious-phone': 'Check the number',
    'suspicious-name': 'Name looks fake',
    'no-phone': 'No phone number',
    'has-link': 'Contains a link: check before sending',
    test: 'Test lead',
  };
  const STEP_OF = { first: 'first', f1: 'f1', f2: 'f2', close: 'f2', nudge: 'nudge', confirm: 'confirm', reminder: 'reminder', handover: 'handover' };
  const SEND_LABEL = {
    first: 'WhatsApp: first message',
    f1: 'WhatsApp: follow-up',
    f2: 'WhatsApp: last follow-up',
    nudge: 'WhatsApp: check in',
    confirm: 'WhatsApp: booking confirmation',
    reminder: 'WhatsApp: reminder',
  };
  const RANGES = [
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
    ['month', 'This month'],
    ['last', 'Last month'],
  ];
  const VARS = ['first_name', 'name', 'client', 'my_name', 'service', 'booked_time', 'location', 'maps', 'hours', 'phone_display', 'email', 'answers', 'notes_line', 'wa_link', 'greeting'];
  const NOT_CONFIGURED = "Lead Desk isn't switched on yet: add LEAD_DESK_KEY in Netlify → Site configuration → Environment variables, then redeploy.";
  const BAD_LINK = "That link's key is wrong.";
  const KEY_WARN = "Lead Desk is using your phone-queue key. Set a separate LEAD_DESK_KEY in Netlify so the outreach link can't open your clients' leads.";
  const ERRORS = {
    offline: "You're offline. It will save when you're back online.",
    unauthorized: 'Wrong key.',
    not_configured: NOT_CONFIGURED,
    name_required: 'Add the business name.',
    bad_niche: 'Pick a type of business.',
    script_too_long: 'Each message script can be up to 2000 characters.',
    not_found: 'That no longer exists. It may have been deleted on another device.',
    unknown_client: 'Pick a client first.',
    no_contact_details: 'Add at least a name, a phone number or an email.',
    invalid_update: 'That change could not be saved.',
    too_many_rows: 'That file has more than 2000 rows. Export a shorter date range and import the parts one by one.',
    bad_time: 'Use times like 09:00.',
    bad_followup: 'Follow-up 1 must be between 30 and 1440 minutes.',
    bad_ntfy_url: 'The ntfy link must start with https://',
    bad_telegram_token: "That doesn't look like a bot token from @BotFather.",
    bad_telegram_chat: 'The chat id should be a number.',
    bad_token: "Telegram didn't accept that bot token. Copy it again from @BotFather.",
    no_messages: 'No messages yet. Send /start to your bot in Telegram, then press Find my chat again.',
    too_large: 'That is too much data for one upload. Try a smaller file.',
    too_many_ops: 'Too many changes at once. Try again.',
    invalid_body: "The server couldn't read that request.",
    conflict: 'The desk was busy. Try again.',
    rate_limited: 'Too many leads at once. Try again in a few minutes.',
    desk_full: 'The desk is full: close or delete old leads.',
    unknown_link: "That intake link doesn't work any more. Copy the current one from Setup.",
    client_archived: "This client is archived, so its link doesn't take leads.",
    server_error: 'Something went wrong on the server. Try again.',
  };
  const ICON = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      } catch {
        // full or blocked storage: the page keeps working from memory
      }
    },
    raw(k) {
      try {
        return localStorage.getItem(k) || '';
      } catch {
        return '';
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    },
  };

  /* ---------------------------------------------------------------- state */
  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prefs = { waMode: 'web', sound: true, notify: false, ...store.get(PREFS, {}) };
  const savePrefs = () => store.set(PREFS, prefs);

  // The key arrives in the #fragment (never sent to the server) and stays in the address bar,
  // so "Add to Home Screen" on iPhone keeps it, like /outreach. A key from a link is only a trial until the
  // server accepts it, so an old or mistyped link can't replace the key this device already has.
  const hash0 = new URLSearchParams(location.hash.slice(1));
  let key = store.raw(KEY);
  let trial = hash0.get('k') && hash0.get('k') !== key ? hash0.get('k') : '';
  let deepLink = hash0.get('lead') || '';

  const cached = store.get(CACHE, null);
  let data = fromCache(cached);
  let keySource = (cached && cached.keySource) || ''; // 'queue': the server let the phone-queue key in
  let pending = (store.get(PENDING, []) || []).filter((op) => op && op.opId && op.type);
  let leads = [];
  let byId = new Map();
  let clientMap = new Map();
  let info = [];
  let groups = { todo: [], waiting: [], chatting: [], booked: [], closed: [] };
  let todoBy = {};
  let todoAll = 0;
  let sig = '';
  let skew = Number(cached && cached.skew) || 0; // server clock minus this device's clock
  let syncedAt = 0;
  let offline = false;
  let fatal = '';
  let loading = false;
  let again = false;
  let lastLoad = 0;
  let flushing = false;
  let posted = 0;
  let seen = null;
  let older = { days: 0, at: 0, leads: null, busy: false };
  const waiters = new Map();
  const vals = new Map();
  const shown = new WeakMap();
  const ui = {
    tab: 'todo',
    client: '',
    search: '',
    menu: '',
    flash: '',
    book: {},
    edit: {},
    lost: {},
    open: {},
    answers: {},
    closedLimit: 200,
    editingClient: null,
    pairShown: false,
    report: { client: '', range: '7d' },
    reportDirty: false,
    importRows: null,
    importName: '',
  };

  function fromCache(c) {
    const d = c && typeof c === 'object' ? c : {};
    const cfg = d.config && typeof d.config === 'object' ? d.config : {};
    return {
      rev: typeof d.rev === 'string' ? d.rev : '',
      clients: Array.isArray(cfg.clients) ? cfg.clients : [],
      settings: { ...D.DEFAULT_SETTINGS, ...(cfg.settings || {}) },
      leads: Array.isArray(d.leads) ? d.leads : [],
    };
  }

  const now = () => Date.now() + skew;
  const vget = (id, f) => vals.get(`${id}|${f}`);
  const vset = (id, f, v) => vals.set(`${id}|${f}`, v);
  const vclear = (id, prefix = '') => {
    for (const k of [...vals.keys()]) if (k.startsWith(`${id}|${prefix}`)) vals.delete(k);
  };
  const clientOf = (id) => clientMap.get(id) || { id, name: 'Unknown client', niche: 'other', color: 7, contactName: '', contactWa: '', scripts: {} };
  const colorOf = (c) => `c${Math.abs(Number(c && c.color) || 0) % 8}`;
  const activeClients = () => data.clients.filter((c) => !c.archived);
  const phoneType = (l) => l.phoneType || D.normPhone(l.phone).type;
  const canWa = (l) => !!l.phone && ['mobile', 'foreign'].includes(phoneType(l));
  const waMode = () => (isTouch ? 'app' : prefs.waMode === 'app' ? 'app' : 'web');
  const label = (a, c) => a.label.replace('{client}', c.name);
  const errText = (code) => {
    if (ERRORS[code]) return ERRORS[code];
    const s = typeof code === 'string' && code.startsWith('error: ') ? code.slice(7) : '';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) + '.' : 'Something went wrong. Try again.';
  };
  const update = (id, upd) => ({ type: 'lead.update', id, upd: { at: now(), ...upd } });
  const pairUrl = () => `${location.origin}/desk#k=${encodeURIComponent(key)}`;
  const intakeUrl = (c) => `${location.origin}/api/desk/in/${encodeURIComponent(c.intakeToken || '')}`;
  const consentLine = (c) => `I agree that ${c.name} and its bookings team may contact me on WhatsApp or by phone about this enquiry.`;
  const scriptText = (step, l, c) => D.renderScript(D.scriptFor(step, c), D.varsFor(l, c, data.settings, now()));

  /* ----------------------------------------------------------------- time */
  const dayKey = (ts) => D.dubaiLocal(ts).slice(0, 10);
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short' });
  const dmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' });

  /** "at 3:40 pm", "tomorrow 10:00 am", "Sat 18 Oct, 9:00 am" (Dubai time). */
  function when(ts) {
    const t = now();
    const k = dayKey(ts);
    const clock = D.fmtClock(ts);
    if (k === dayKey(t)) return `at ${clock}`;
    if (k === dayKey(t + DAY)) return `tomorrow ${clock}`;
    if (k === dayKey(t - DAY)) return `yesterday ${clock}`;
    return `${dayFmt.format(ts)}, ${clock}`;
  }
  /** Received time: "3:40 pm" today, else with the day. */
  function stamp(ts) {
    const w = when(ts);
    return w.startsWith('at ') ? w.slice(3) : w;
  }
  function ago(ts) {
    if (!ts) return '';
    const m = Math.floor((now() - ts) / MIN);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${plural(Math.floor(h / 24), 'day')} ago`;
  }
  function dur(ms) {
    const m = Math.max(0, Math.floor(ms / MIN));
    if (m < 1) return 'under 1 min';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} d ${h % 24} h`;
  }
  const heat = (ms) => (ms < 5 * MIN ? 'g' : ms <= 15 * MIN ? 'a' : 'r');
  const dueText = (due) => (now() - due < MIN ? 'Due now' : `Due ${dur(now() - due)} ago`);

  /* ---------------------------------------------------------- derive data */
  function rebuild() {
    let list = data.leads;
    for (const op of pending) {
      if (op.type === 'lead.update') list = list.map((l) => (l.id === op.id ? D.applyUpdate(l, op.upd, op.upd.at) : l));
      else if (op.type === 'lead.delete') list = list.filter((l) => !op.ids.includes(l.id));
    }
    leads = list;
    byId = new Map(list.map((l) => [l.id, l]));
    clientMap = new Map(data.clients.map((c) => [c.id, c]));
  }

  function compute() {
    const t = now();
    const s = data.settings;
    info = leads.map((l) => ({ l, a: D.nextAction(l, s, t), st: D.stage(l, s, t) }));
    groups = { todo: [], waiting: [], chatting: [], booked: [], closed: [] };
    todoBy = {};
    todoAll = 0;
    for (const x of info) {
      if (x.st === 'todo') {
        todoAll++;
        todoBy[x.l.clientId] = (todoBy[x.l.clientId] || 0) + 1;
      }
      if (!ui.client || x.l.clientId === ui.client) groups[x.st].push(x);
    }
    const due = (x) => (x.a ? x.a.due : Infinity);
    groups.todo.sort((x, y) => (x.a.kind === 'first' ? 0 : 1) - (y.a.kind === 'first' ? 0 : 1) || due(x) - due(y));
    groups.waiting.sort((x, y) => due(x) - due(y));
    groups.chatting.sort((x, y) => (y.l.repliedAt || 0) - (x.l.repliedAt || 0));
    groups.booked.sort((x, y) => String(x.l.bookedFor).localeCompare(String(y.l.bookedFor)));
    groups.closed.sort((x, y) => (y.l.closedAt || y.l.updatedAt || 0) - (x.l.closedAt || x.l.updatedAt || 0));
    sig = info.map((x) => `${x.l.id}:${x.st}:${x.a ? x.a.kind : ''}`).join('|');
  }

  /* --------------------------------------------------------------- render */
  function render() {
    const ok = !!(key || trial) && !fatal;
    $('[data-app]').hidden = !ok;
    $('[data-pair]').hidden = ok;
    if (!ok) return renderPair();
    compute();
    renderHeader();
    renderMain();
  }

  function renderPair() {
    document.title = 'Lead Desk';
    $('[data-pair-error]').textContent = { unauthorized: 'Wrong key.', bad_link: BAD_LINK, not_configured: NOT_CONFIGURED }[fatal] || '';
  }

  function statusText() {
    const n = pending.length;
    if (offline) return n ? `Offline, ${plural(n, 'change')} waiting` : 'Offline · showing the last saved copy';
    if (!syncedAt) return data.rev ? `${todoAll} to do now · connecting…` : 'Loading…';
    return `${todoAll} to do now · ${n ? 'saving…' : `synced ${D.fmtClock(syncedAt + skew)}`}`;
  }
  function renderStatus() {
    const el = $('[data-status]');
    el.textContent = statusText();
    el.classList.toggle('off', offline);
    $('[data-key-note]').hidden = keySource !== 'queue';
  }

  function renderHeader() {
    renderStatus();
    document.title = todoAll ? `(${todoAll}) Lead Desk` : 'Lead Desk';
    const list = activeClients();
    if (ui.client && !list.some((c) => c.id === ui.client)) ui.client = '';
    const chips = $('[data-chips]');
    chips.hidden = list.length < 2;
    const chipHtml = [
      `<button type="button" class="chip" data-act="client-filter" data-cid="" aria-pressed="${!ui.client}">All</button>`,
      ...list.map(
        (c) =>
          `<button type="button" class="chip" data-act="client-filter" data-cid="${esc(c.id)}" aria-pressed="${ui.client === c.id}"><span class="dot ${colorOf(c)}"></span>${esc(c.name)}${todoBy[c.id] ? ` <span class="n" aria-label="${todoBy[c.id]} to do">${todoBy[c.id]}</span>` : ''}</button>`,
      ),
    ].join('');
    if (shown.get(chips) !== chipHtml) {
      chips.innerHTML = chipHtml;
      shown.set(chips, chipHtml);
    }
    for (const b of $$('[data-tab]')) {
      const t = b.dataset.tab;
      const n = ['todo', 'waiting', 'chatting', 'booked'].includes(t) ? groups[t].length : 0;
      const html = `${TAB_LABEL[t]}${n ? ` <span class="n">(${n})</span>` : ''}`;
      if (b.innerHTML !== html) b.innerHTML = html;
      b.setAttribute('aria-selected', String(t === ui.tab));
    }
    if (tabShown !== ui.tab) {
      tabShown = ui.tab;
      showTab($(`[data-tab="${ui.tab}"]`));
    }
    tabFade();
  }

  /** On a phone the tabs scroll sideways: keep the chosen one in full view, clear of the edge fade. */
  let tabShown = 'todo';
  function showTab(b) {
    const nav = b.parentElement;
    const n = nav.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const pad = 40;
    const dx = r.left < n.left + pad ? r.left - n.left - pad : r.right > n.right - pad ? r.right - n.right + pad : 0;
    if (dx) nav.scrollBy({ left: dx, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  /** Fades the edge of the tab row only while more tabs are hidden past it. */
  function tabFade() {
    const nav = $('[data-tabs]');
    const x = nav.scrollLeft;
    nav.classList.toggle('fade-l', x > 2);
    nav.classList.toggle('fade-r', x < nav.scrollWidth - nav.clientWidth - 2);
  }

  function renderMain() {
    if (ui.tab !== 'setup') ui.pairShown = false;
    // Before the first sync there is nothing real to show (and Setup must not offer defaults to save over real settings).
    if (!syncedAt && !data.rev) return swap($('[data-main]'), `<p class="note">${offline ? "You're offline and this device has no saved copy yet." : 'Loading…'}</p>`);
    if (ui.tab === 'setup') return renderSetup();
    if (ui.tab === 'report') return renderReport();
    swap($('[data-main]'), listView());
  }

  /** Replace an element's HTML only when it changed, keeping focus and the caret in the same field. */
  function swap(el, html) {
    if (shown.get(el) === html) return;
    const ae = document.activeElement;
    let keep = null;
    if (ae && ae !== document.body && el.contains(ae)) {
      const card = ae.closest('[data-id]');
      const sel = ae.dataset.f ? `[data-f="${ae.dataset.f}"]` : ae.dataset.act ? `[data-act="${ae.dataset.act}"]` : ae.dataset.report ? `[data-report="${ae.dataset.report}"]` : ae.matches('[data-report-text]') ? '[data-report-text]' : '';
      if (sel) keep = { id: card ? card.dataset.id : '', sel, start: ae.selectionStart, end: ae.selectionEnd, top: ae.scrollTop };
    }
    el.innerHTML = html;
    shown.set(el, html);
    for (const ta of $$('textarea[data-fit]', el)) fit(ta);
    if (!keep) return;
    const scope = keep.id ? el.querySelector(`[data-id="${CSS.escape(keep.id)}"]`) : el;
    const next = scope && scope.querySelector(keep.sel);
    if (!next) return;
    next.focus({ preventScroll: true });
    try {
      if (keep.start != null) next.setSelectionRange(keep.start, keep.end);
    } catch {
      // not a text field
    }
    next.scrollTop = keep.top;
  }

  function fit(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 520)}px`;
  }

  /* ----------------------------------------------------------- lead lists */
  function listView() {
    if (!data.clients.length && !leads.length) {
      return `<div class="empty"><h2>Add your first client in Setup</h2><p>Each client gets a private link for its Meta lead forms or website form. New leads land here.</p><button type="button" class="btn primary" data-act="go-setup">Add a client</button></div>`;
    }
    const q = ui.search.trim();
    if (q) return searchView(q);
    const list = groups[ui.tab] || [];
    if (!list.length) return emptyView();
    if (ui.tab === 'booked') {
      const t = now();
      const appt = (x) => D.fromDubaiLocal(x.l.bookedFor);
      const upcoming = list.filter((x) => !(appt(x) < t));
      const past = list.filter((x) => appt(x) < t).sort((x, y) => Number(!!x.l.outcome) - Number(!!y.l.outcome) || appt(y) - appt(x));
      return upcoming.map(card).join('') + (past.length ? `<h2 class="list-h">Past bookings</h2>${past.map(card).join('')}` : '');
    }
    if (ui.tab === 'closed') {
      const part = list.slice(0, ui.closedLimit);
      const rest = list.length - part.length;
      return part.map(card).join('') + (rest ? `<button type="button" class="btn ghost" data-act="more-closed">Show more (${rest} more)</button>` : '');
    }
    return list.map(card).join('');
  }

  function emptyView() {
    if (ui.tab === 'todo') {
      const t = now();
      const next = info
        .filter((x) => (!ui.client || x.l.clientId === ui.client) && x.a && x.st !== 'todo' && x.a.due > t)
        .sort((x, y) => x.a.due - y.a.due)[0];
      const hint = next ? `<p>Next: ${esc(label(next.a, clientOf(next.l.clientId)))} for ${esc(next.l.name || 'a lead')}, ${esc(when(next.a.due))}.</p>` : '';
      return `<div class="empty"><h2>Nothing to do right now ✅</h2>${hint}</div>`;
    }
    const text = {
      waiting: 'No leads are waiting for a follow-up.',
      chatting: 'Nobody is mid-chat. Leads you mark “They replied” show up here.',
      booked: 'No bookings yet.',
      closed: 'Nothing closed yet.',
    }[ui.tab];
    return `<div class="empty"><p>${esc(text)}</p></div>`;
  }

  function matches(l, q) {
    const s = q.toLowerCase();
    if (/^[+\d\s().-]+$/.test(s) && s.replace(/\D/g, '').length >= 3) {
      const k = D.phoneKey(s);
      return !!k && String(l.phone || '').includes(k);
    }
    return [l.name, l.email, l.service].some((v) => String(v || '').toLowerCase().includes(s));
  }

  function searchView(q) {
    const found = info.filter((x) => (!ui.client || x.l.clientId === ui.client) && matches(x.l, q)).sort((x, y) => (y.l.createdAt || 0) - (x.l.createdAt || 0));
    const list = found.slice(0, 100);
    const head = found.length ? `${found.length > 100 ? 'First 100 of ' : ''}${plural(found.length, 'lead')} match “${esc(q)}”` : `No leads match “${esc(q)}”.`;
    return `<p class="list-note">${head} <button type="button" class="link" data-act="clear-search">Clear search</button></p>${list.map(card).join('')}${
      found.length ? '' : '<p class="help">Search covers open leads and everything from the last 60 days.</p>'
    }`;
  }

  /* ----------------------------------------------------------------- card */
  function card(x) {
    const { l, st } = x;
    const c = clientOf(l.clientId);
    const name = l.name || 'No name given';
    return `<article class="card lead${ui.flash === l.id ? ' flash' : ''}" data-id="${esc(l.id)}" data-stage="${st}" aria-label="${esc(name)}">
      <div class="lead-top">
        <span class="cchip"><span class="dot ${colorOf(c)}"></span><span>${esc(c.name)}</span></span>
        <span class="src">${esc(SOURCE[l.source] || l.source)}</span>
        ${ui.search ? `<span class="src stage">${esc(TAB_LABEL[st])}</span>` : ''}
        <button type="button" class="icon-btn" data-act="menu" aria-expanded="${ui.menu === l.id}" aria-label="More actions for ${esc(name)}">${ICON.more}</button>
      </div>
      ${ui.menu === l.id ? menu(x, c) : ''}
      <h3 class="lead-name">${esc(name)}</h3>
      ${contact(l)}${flags(l)}
      <div class="meta"><b>${esc(l.service || 'No service given')}</b> · <span data-ago="${Number(l.createdAt) || 0}">${esc(ago(l.createdAt))}</span> (${esc(stamp(l.createdAt))})</div>
      ${answers(l)}
      ${l.notes ? `<p class="notes">${esc(l.notes)}</p>` : ''}
      ${ui.edit[l.id] ? editForm(l) : ''}
      ${body(x, c)}
    </article>`;
  }

  function contact(l) {
    const parts = [];
    if (l.phone) parts.push(`<span class="phone">${esc(D.fmtPhone(l.phone))}</span>${phoneType(l) === 'mobile' ? '<span class="badge">Mobile</span>' : ''}`);
    if (l.email) parts.push(`<span class="email">${esc(l.email)}</span>`);
    return parts.length ? `<div class="contact">${parts.join('')}</div>` : '';
  }

  function flags(l) {
    const out = [];
    const texts = new Set();
    for (const f of Array.isArray(l.flags) ? l.flags : []) {
      const t = FLAG[f];
      if (!t || texts.has(t)) continue;
      texts.add(t);
      out.push(`<span class="flag${f === 'test' ? ' info' : ''}">${esc(t)}</span>`);
    }
    if (l.verified === true) out.push('<span class="flag ok">✓ Number verified by Meta</span>');
    return out.length ? `<div class="flags">${out.join('')}</div>` : '';
  }

  function answers(l) {
    const list = (Array.isArray(l.answers) ? l.answers : []).filter((a) => a && (a.q || a.a));
    const ad = l.ad || {};
    const adLine = [ad.form && `Form: ${ad.form}`, ad.campaign && `Campaign: ${ad.campaign}`, ad.ad && `Ad: ${ad.ad}`].filter(Boolean).join(' · ');
    if (!list.length && !adLine) return '';
    const open = !!ui.answers[l.id];
    const more = list.length > 3 || (adLine && list.length > 0);
    const rows = (open ? list : list.slice(0, 3)).map((a) => `<div><dt>${esc(a.q)}</dt><dd>${esc(a.a)}</dd></div>`).join('');
    const extra = adLine && (open || !list.length) ? `<p class="meta">${esc(adLine)}</p>` : '';
    const toggle = more ? `<button type="button" class="link" data-act="answers" aria-expanded="${open}">${open ? 'Show less' : `Show all${list.length > 3 ? ` (${list.length})` : ''}`}</button>` : '';
    return `${rows ? `<dl class="answers">${rows}</dl>` : ''}${extra}${toggle}`;
  }

  function menu(x, c) {
    const { l, a, st } = x;
    const items = ['<button type="button" data-act="edit">Edit details</button>'];
    if (a && st !== 'closed' && a.kind !== 'outcome' && a.kind !== 'close') items.push(`<button type="button" data-act="mark">Mark “${esc(label(a, c))}” as done</button>`);
    if (l.status !== 'new') items.push('<button type="button" data-act="reopen">Reopen as new</button>');
    items.push('<button type="button" class="danger" data-act="delete">Delete lead</button>');
    return `<div class="menu" role="group" aria-label="More actions">${items.join('')}</div>`;
  }

  function body(x, c) {
    if (x.st === 'todo') return todoBody(x, c);
    if (x.st === 'waiting') return waitingBody(x, c);
    if (x.st === 'chatting') return chattingBody(x, c);
    if (x.st === 'booked') return bookedBody(x, c);
    return closedBody(x);
  }

  const btn = (act, text, cls = 'ghost') => `<button type="button" class="btn ${cls}" data-act="${act}">${esc(text)}</button>`;

  function timer(a) {
    const t = now();
    if (a.kind === 'first') return `<span class="timer ${heat(t - a.due)}" data-timer="${a.due}" data-kind="first">Waiting ${esc(dur(t - a.due))}</span>`;
    return `<span class="timer" data-timer="${a.due}">${esc(dueText(a.due))}</span>`;
  }

  /** The message being prepared for this lead: the owner's edits, or the script for the chosen step. */
  function draft(x, c) {
    const { l, a } = x;
    if (vget(l.id, 'kind') !== a.kind) {
      vclear(l.id, 'msg');
      vclear(l.id, 'step');
      vset(l.id, 'kind', a.kind);
    }
    const step = vget(l.id, 'step') || STEP_OF[a.kind] || 'first';
    const text = vget(l.id, 'msg');
    return { step, text: text == null ? scriptText(step, l, c) : text };
  }

  function waLink(digits, text, inner, extra = '') {
    return `<a ${extra} data-wa="${esc(digits)}" href="${esc(D.waUrl(digits, text, waMode()))}" target="desk-wa" rel="noopener noreferrer">${inner}</a>`;
  }

  function composer(x, c, d) {
    const { l, a } = x;
    const head =
      a.kind === 'handover'
        ? `<div class="step">Message to ${esc(c.contactName || c.name)}</div>`
        : `<label class="step"><span>Message</span><select data-f="step">${D.STEPS.filter((s) => s.id !== 'handover')
            .map((s) => `<option value="${s.id}"${s.id === d.step ? ' selected' : ''}>${esc(s.label)}</option>`)
            .join('')}</select></label>`;
    return `<div class="composer">${head}<textarea data-f="msg" data-fit rows="5" aria-label="Message for ${esc(l.name || 'this lead')}">${esc(d.text)}</textarea>${primary(x, c, d.text)}</div>`;
  }

  function primary(x, c, text) {
    const { l, a } = x;
    if (a.kind === 'handover') {
      const who = esc(c.contactName || c.name);
      if (!c.contactWa) {
        return `<button type="button" class="btn wa" disabled>${ICON.wa}<span>Send to ${who}</span></button><p class="hint">Add ${esc(c.name)}'s WhatsApp number in Setup → Clients to send this in one tap. Sent it another way? <button type="button" class="link" data-act="mark">Mark as sent</button></p>`;
      }
      return waLink(c.contactWa, text, `${ICON.wa}<span>Send to ${who}</span>`, `class="btn wa" data-act="send" data-kind="handover"`);
    }
    if (a.kind === 'close' || !canWa(l)) {
      if (!l.phone) return `<p class="hint">No phone number${l.email ? `. Email ${esc(l.email)} instead` : ''}. Done? <button type="button" class="link" data-act="mark">Mark as sent</button></p>`;
      return `<a class="btn wa call" data-act="send" data-kind="${a.kind}" href="tel:+${esc(l.phone)}">${ICON.phone}<span>Call</span></a>`;
    }
    return waLink(l.phone, text, `${ICON.wa}<span>${esc(SEND_LABEL[a.kind] || 'WhatsApp')}</span>`, `class="btn wa" data-act="send" data-kind="${a.kind}"`);
  }

  function secondary(x, text) {
    const { l, a } = x;
    const k = a.kind;
    const callFirst = k === 'close' || !canWa(l);
    const out = [];
    if (k !== 'handover' && callFirst && l.phone && (canWa(l) || phoneType(l) === 'invalid')) {
      out.push(waLink(l.phone, text, canWa(l) ? 'WhatsApp' : 'Try WhatsApp', 'class="btn ghost"'));
    }
    out.push(btn('copy-msg', 'Copy'));
    if (l.phone && !callFirst && k !== 'handover') out.push(`<a class="btn ghost" href="tel:+${esc(l.phone)}">Call</a>`);
    if (['first', 'f1', 'f2', 'close'].includes(k)) out.push(btn('replied', 'They replied'));
    out.push(btn('book', ['confirm', 'reminder', 'handover'].includes(k) ? 'Change booking' : 'Booked…'));
    if (k === 'close') out.push(btn('noanswer', 'No answer: close'));
    if (k !== 'handover') out.push(btn('lost', 'Not interested'));
    if (['first', 'f1', 'f2', 'close'].includes(k)) out.push(btn('fake', 'Wrong number / fake'));
    return out.join('');
  }

  function chatBtn(l) {
    if (canWa(l)) return waLink(l.phone, '', `${ICON.wa}<span>Open chat</span>`, 'class="btn ghost wa-o" data-act="chat"');
    return l.phone ? `<a class="btn ghost" href="tel:+${esc(l.phone)}">Call</a>` : '';
  }

  const outcomeButtons = () => `<div class="outcome">${btn('showed', 'Showed up', 'big ok')}${btn('noshow', 'No-show', 'big')}</div>`;

  function todoBody(x, c) {
    const { l, a } = x;
    if (a.kind === 'outcome') {
      return `<div class="due"><span>${esc(a.label)}</span><span class="muted">${esc(D.fmtBooked(l.bookedFor))}</span></div>
        ${outcomeButtons()}
        <div class="acts">${chatBtn(l)}${btn('book', 'Change booking')}</div>
        ${bookForm(l)}`;
    }
    const d = draft(x, c);
    // A booking logged after the visit: the outcome matters more than the confirmation steps.
    const past = l.status === 'booked' && D.fromDubaiLocal(l.bookedFor) < now() ? `<p class="hint">The appointment time has passed. Did they show up?</p>${outcomeButtons()}` : '';
    return `<div class="due"><span>${esc(label(a, c))}</span>${timer(a)}</div>
      ${past}
      ${composer(x, c, d)}
      <div class="acts">${secondary(x, d.text)}</div>
      ${bookForm(l)}${lostForm(l)}`;
  }

  function waitingBody(x, c) {
    const { l, a } = x;
    if (!a) return `<div class="next">No next step.</div><div class="acts">${btn('book', 'Booked…')}${btn('lost', 'Not interested')}</div>${bookForm(l)}${lostForm(l)}`;
    const open = !!ui.open[l.id];
    const d = open ? draft(x, c) : null;
    return `<div class="next">Next: ${esc(label(a, c))} ${esc(when(a.due))}</div>
      ${open ? composer(x, c, d) : ''}
      <div class="acts">${open ? btn('copy-msg', 'Copy') + btn('open', 'Hide message') : btn('open', 'Send now')}${btn('replied', 'They replied')}${btn('book', 'Booked…')}${btn('lost', 'Not interested')}</div>
      ${bookForm(l)}${lostForm(l)}`;
  }

  function chattingBody(x, c) {
    const { l, a } = x;
    const next = a ? ` · ${esc(label(a, c))} ${esc(when(a.due))}` : '';
    return `<div class="next">Replied ${esc(ago(l.repliedAt || l.updatedAt))}${next}</div>
      <div class="acts">${chatBtn(l)}${btn('book', 'Booked…')}${btn('lost', 'Not interested')}</div>
      ${bookForm(l)}${lostForm(l)}`;
  }

  function checks(l, c) {
    const since = l.bookedAt || 0;
    const touched = (k) => (Array.isArray(l.touches) ? l.touches : []).some((t) => t && t.k === k && t.at >= since);
    const items = [
      [touched('confirm'), 'Confirmation sent', 'Confirmation not sent'],
      [!!l.handedAt && l.handedAt >= since, `Sent to ${c.contactName || c.name}`, `Not sent to ${c.contactName || c.name} yet`],
    ];
    if (touched('reminder')) items.push([true, 'Reminder sent']);
    return `<ul class="checks">${items.map(([ok, yes, no]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${esc(ok ? yes : no)}</li>`).join('')}</ul>`;
  }

  function bookedBody(x, c) {
    const { l, a } = x;
    const appt = D.fromDubaiLocal(l.bookedFor);
    let state = '';
    if (l.outcome) state = `<div class="done-line${l.outcome === 'showed' ? '' : ' no'}">${l.outcome === 'showed' ? '✓ Showed up' : 'No-show'} <button type="button" class="link" data-act="outcome-clear">Change</button></div>`;
    else if (appt < now()) state = outcomeButtons();
    else if (a) state = `<div class="hint">Next: ${esc(label(a, c))} ${esc(when(a.due))}</div>`;
    return `<div class="appt">${esc(D.fmtBooked(l.bookedFor) || 'No time set')}</div>
      ${l.outcome ? '' : checks(l, c)}${state}
      <div class="acts">${chatBtn(l)}${btn('book', 'Change booking')}</div>
      ${bookForm(l)}`;
  }

  function closedBody(x) {
    const { l } = x;
    let extra = '';
    if (l.status === 'dup') {
      const orig = l.dupOf && byId.get(l.dupOf);
      extra = orig
        ? ` · same number as <button type="button" class="link" data-act="goto" data-goto="${esc(orig.id)}">${esc(orig.name || 'an earlier lead')}</button>`
        : ' · same number as an earlier lead';
    } else if (l.lostReason) extra = ` · ${esc(l.lostReason)}`;
    return `<p class="closed-line"><b>${esc(STATUS[l.status] || l.status)}</b>${extra}${l.closedAt ? ` <span class="muted">· ${esc(ago(l.closedAt))}</span>` : ''}</p>
      <div class="acts">${btn('reopen', 'Reopen')}</div>`;
  }

  function bookForm(l) {
    if (!ui.book[l.id]) return '';
    const cur = D.dubaiLocalValid(l.bookedFor) ? l.bookedFor : '';
    const date = vget(l.id, 'book-date') ?? (cur ? cur.slice(0, 10) : dayKey(now() + DAY));
    const time = vget(l.id, 'book-time') ?? (cur ? cur.slice(11) : '11:00');
    return `<form class="inline-form" data-form="book">
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" data-f="book-date" value="${esc(date)}" required></label>
        <label class="field"><span>Time (Dubai)</span><input type="time" data-f="book-time" value="${esc(time)}" required></label>
      </div>
      <p class="warn" data-book-warn${bookedPast(date, time) ? '' : ' hidden'}>This time has already passed. Save anyway if you're logging a past visit.</p>
      <div class="row"><button class="btn primary">Save booking</button>${btn('book-cancel', 'Cancel')}</div>
    </form>`;
  }
  const bookedPast = (date, time) => D.fromDubaiLocal(`${date}T${String(time).slice(0, 5)}`) < now();

  function lostForm(l) {
    if (!ui.lost[l.id]) return '';
    return `<form class="inline-form" data-form="lost">
      <label class="field"><span>Reason (optional)</span><input data-f="reason" maxlength="200" list="desk-reasons" value="${esc(vget(l.id, 'reason') || '')}" placeholder="e.g. Too expensive"></label>
      <div class="row"><button class="btn primary">Mark not interested</button>${btn('lost-cancel', 'Cancel')}</div>
    </form>`;
  }

  function editForm(l) {
    const v = (f, d) => vget(l.id, f) ?? d ?? '';
    return `<form class="inline-form" data-form="edit">
      <div class="grid2">
        <label class="field"><span>Name</span><input data-f="e-name" maxlength="120" value="${esc(v('e-name', l.name))}"></label>
        <label class="field"><span>Phone</span><input data-f="e-phone" type="tel" inputmode="tel" value="${esc(v('e-phone', l.phone ? D.fmtPhone(l.phone) : ''))}"></label>
        <label class="field"><span>Email</span><input data-f="e-email" type="email" maxlength="160" value="${esc(v('e-email', l.email))}"></label>
        <label class="field"><span>Service</span><input data-f="e-service" maxlength="120" value="${esc(v('e-service', l.service))}"></label>
      </div>
      <label class="field"><span>Notes</span><textarea data-f="e-notes" rows="3" maxlength="2000">${esc(v('e-notes', l.notes))}</textarea></label>
      <div class="row"><button class="btn primary">Save</button>${btn('edit-cancel', 'Cancel')}</div>
    </form>`;
  }

  /* --------------------------------------------------------------- report */
  function rangeOf(id, t) {
    const today = D.fromDubaiLocal(`${dayKey(t)}T00:00`);
    const local = dayKey(t);
    const y = Number(local.slice(0, 4));
    const m = Number(local.slice(5, 7));
    const monthStart = (yy, mm) => D.fromDubaiLocal(`${yy}-${String(mm).padStart(2, '0')}-01T00:00`);
    if (id === '30d') return { from: today - 29 * DAY, to: today + DAY };
    if (id === 'month') return { from: monthStart(y, m), to: today + DAY };
    if (id === 'last') return { from: monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), to: monthStart(y, m) };
    return { from: today - 6 * DAY, to: today + DAY };
  }
  function rangeLabels(r) {
    const a = dmFmt.formatToParts(r.from);
    const b = dmFmt.formatToParts(r.to - 1);
    const part = (p, type) => (p.find((x) => x.type === type) || {}).value;
    return part(a, 'month') === part(b, 'month') ? [part(a, 'day'), dmFmt.format(r.to - 1)] : [dmFmt.format(r.from), dmFmt.format(r.to - 1)];
  }

  /** Leads for a report range. Older ones (beyond what the page keeps) are fetched once on demand. */
  function reportLeads(range) {
    const days = Math.ceil((now() - range.from) / DAY) + 2;
    if (days <= 58) return leads;
    if (older.leads && older.days >= days && Date.now() - older.at < 5 * MIN) {
      const all = new Map(older.leads.map((l) => [l.id, l]));
      for (const l of leads) all.set(l.id, l);
      return [...all.values()];
    }
    // After a failed attempt, wait 30s before trying again (the report shows why meanwhile).
    if (!older.busy && Date.now() - (older.failedAt || 0) > 30000) fetchOlder(days + 5);
    return null;
  }
  async function fetchOlder(days) {
    older.busy = true;
    try {
      const d = await api('GET', null, `?days=${days}`);
      older = { days, at: Date.now(), leads: Array.isArray(d.leads) ? d.leads : [], busy: false };
    } catch (e) {
      older = { ...older, busy: false, failedAt: Date.now(), error: e.status ? errText(e.code) : "You're offline, so older leads can't be loaded." };
    }
    if (ui.tab === 'report') renderReport();
  }

  function renderReport() {
    const main = $('[data-main]');
    const r = ui.report;
    const range = rangeOf(r.range, now());
    const src = reportLeads(range);
    const c = r.client ? clientMap.get(r.client) : null;
    const pickers = `<div class="grid2">
      <label class="field"><span>Client</span><select data-report="client"><option value="">All clients</option>${data.clients
        .map((x) => `<option value="${esc(x.id)}"${x.id === r.client ? ' selected' : ''}>${esc(x.name)}${x.archived ? ' (archived)' : ''}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Period</span><select data-report="range">${RANGES.map(([id, text]) => `<option value="${id}"${id === r.range ? ' selected' : ''}>${text}</option>`).join('')}</select></label>
    </div>`;
    if (!src) return swap(main, `<div class="report">${pickers}<p class="note">${esc(older.busy || !older.error ? 'Loading older leads…' : older.error)}</p></div>`);
    const s = D.report(src, { clientId: r.client || undefined, from: range.from, to: range.to }, data.settings);
    const [fromLabel, toLabel] = rangeLabels(range);
    const box = main.querySelector('[data-report-text]');
    const text = ui.reportDirty && box ? box.value : D.reportText(c ? c.name : 'All clients', s, fromLabel, toLabel);
    const pct = (n) => (s.received ? `${Math.round((n / s.received) * 100)}%` : '');
    const tiles = [
      ['Leads received', s.received],
      ['Replied', s.replied, pct(s.replied)],
      ['Booked', s.booked, pct(s.booked)],
      ['Showed up', s.showed],
      ['Median first reply', s.medianReplyMin == null ? '–' : s.medianReplyMin < 1 ? '<1 min' : `${s.medianReplyMin} min`],
      ['Not interested', s.lost],
      ['No answer', s.noanswer],
      ['Fake / wrong number', s.fake],
    ];
    const funnel = [
      ['Received', s.received],
      ['Replied', s.replied],
      ['Booked', s.booked],
      ['Showed up', s.showed],
    ];
    const who = c ? esc(c.contactName || c.name) : 'client';
    const send =
      c && c.contactWa
        ? waLink(c.contactWa, text, `${ICON.wa}<span>Send to ${who}</span>`, 'class="btn wa" data-act="report-send"')
        : `<button type="button" class="btn wa" disabled>${ICON.wa}<span>Send to ${who}</span></button>`;
    const sendHint = !c ? '<p class="help">Pick one client to send them their report.</p>' : !c.contactWa ? `<p class="help">Add ${esc(c.name)}'s WhatsApp number in Setup to send this in one tap.</p>` : '';
    swap(
      main,
      `<div class="report">
        ${pickers}
        <div class="tiles">${tiles.map(([k, v, sub]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}${sub ? ` · ${esc(sub)}` : ''}</span></div>`).join('')}</div>
        <div class="panel funnel" role="img" aria-label="${esc(funnel.map(([k, v]) => `${k} ${v}`).join(', '))}">${funnel
          .map(([k, v]) => `<div class="frow"><span>${esc(k)}</span><span class="fbar"><i style="width:${s.received ? Math.round((v / s.received) * 100) : 0}%"></i></span><b>${v}</b></div>`)
          .join('')}</div>
        <div class="panel">
          <label class="field"><span>Report text for ${c ? esc(c.name) : 'all clients'}</span><textarea data-report-text data-fit rows="8">${esc(text)}</textarea></label>
          ${send}
          <div class="row">${btn('copy-report', 'Copy')}${btn('report-csv', 'Export CSV')}</div>
          ${sendHint}
        </div>
        <p class="help">Counts leads that arrived ${esc(fromLabel)}–${esc(toLabel)} (Dubai time). Test leads and duplicates aren't counted.</p>
      </div>`,
    );
  }

  function firstReplyMin(l) {
    if (!l.firstTouchAt) return '';
    return Math.max(0, Math.round((l.firstTouchAt - D.deferToHours(l.createdAt, data.settings)) / MIN));
  }
  function csvFor(list) {
    const rows = [['Client', 'Received (Dubai)', 'Name', 'Phone', 'Email', 'Service', 'Status', 'Booked for', 'Outcome', 'First reply (min)', 'Source', 'Answers']];
    for (const l of [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
      rows.push([
        clientOf(l.clientId).name,
        l.createdAt ? D.dubaiLocal(l.createdAt).replace('T', ' ') : '',
        l.name,
        l.phone ? D.fmtPhone(l.phone) : '',
        l.email,
        l.service,
        STATUS[l.status] || l.status,
        l.bookedFor ? l.bookedFor.replace('T', ' ') : '',
        l.outcome === 'showed' ? 'Showed up' : l.outcome === 'noshow' ? 'No-show' : '',
        firstReplyMin(l),
        SOURCE[l.source] || l.source,
        (Array.isArray(l.answers) ? l.answers : []).map((a) => `${a.q}: ${a.a}`).join(' | '),
      ]);
    }
    return D.toCsv(rows);
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'leads';

  /* ---------------------------------------------------------------- setup */
  const SECTIONS = ['keywarn', 'details', 'device', 'alerts', 'phone', 'clients', 'import', 'export'];

  function renderSetup(force) {
    const main = $('[data-main]');
    if (!main.querySelector('[data-setup]')) {
      main.innerHTML = `<div class="setup" data-setup>
        <div data-sec="keywarn"></div>
        <section class="panel" aria-labelledby="h-details"><h2 id="h-details">Your details</h2><div data-sec="details"></div></section>
        <section class="panel" aria-labelledby="h-alerts"><h2 id="h-alerts">Alerts</h2><div data-sec="device"></div><div data-sec="alerts"></div></section>
        <section class="panel" aria-labelledby="h-phone"><h2 id="h-phone">Phone</h2><div data-sec="phone"></div></section>
        <section class="panel" aria-labelledby="h-clients"><h2 id="h-clients">Clients</h2><div data-sec="clients"></div></section>
        <section class="panel" aria-labelledby="h-import"><h2 id="h-import">Add or import leads</h2><div data-sec="import"></div></section>
        <section class="panel" aria-labelledby="h-export"><h2 id="h-export">Export</h2><div data-sec="export"></div></section>
      </div>`;
      shown.delete(main);
      force = true;
    }
    for (const name of SECTIONS) {
      const el = main.querySelector(`[data-sec="${name}"]`);
      // Never wipe a form the owner is typing in because of a background sync.
      if (force !== true && force !== name && (el.dataset.dirty || el.contains(document.activeElement))) continue;
      delete el.dataset.dirty;
      const html = SEC[name]();
      if (shown.get(el) === html) continue;
      el.innerHTML = html;
      shown.set(el, html);
      if (name === 'phone') drawQr($('[data-qr]', el), pairUrl());
    }
  }

  const SEC = {
    keywarn() {
      if (keySource !== 'queue') return '';
      return `<div class="key-warn" role="note"><p><b>${esc(KEY_WARN)}</b></p><p class="help">Netlify → Site configuration → Environment variables, then redeploy and open the desk with the new key.</p></div>`;
    },
    details() {
      const s = data.settings;
      const radio = (v, text) => `<label class="radio"><input type="radio" name="waMode" value="${v}"${waMode() === v ? ' checked' : ''}> ${text}</label>`;
      return `<form class="form" data-form="details">
        <label class="field"><span>Your name</span><input name="myName" maxlength="60" value="${esc(s.myName)}" placeholder="e.g. Samil" autocomplete="given-name"><small>Used as {{my_name}} in messages: “This is Samil from the Glossy PPF bookings team”.</small></label>
        <div class="grid2">
          <label class="field"><span>Working hours start</span><input type="time" name="workStart" value="${esc(s.workStart)}" required></label>
          <label class="field"><span>Working hours end</span><input type="time" name="workEnd" value="${esc(s.workEnd)}" required></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Follow-up 1 after (minutes)</span><input type="number" name="followup1Min" min="30" max="1440" step="1" inputmode="numeric" value="${esc(s.followup1Min)}" required></label>
          <label class="field"><span>Last follow-up, next day at</span><input type="time" name="followup2At" value="${esc(s.followup2At)}" required></label>
        </div>
        <p class="help">Leads that arrive outside working hours wait until the next morning's start. UAE telemarketing rules limit marketing calls to 9am–6pm, so keep phone calls inside that window.</p>
        ${isTouch ? '' : `<fieldset class="field"><legend>On this computer, open WhatsApp in</legend>${radio('web', 'WhatsApp Web')}${radio('app', 'WhatsApp app')}<small>Saved on this computer only. Phones always open the WhatsApp app.</small></fieldset>`}
        <div class="row"><button class="btn primary">Save</button></div>
      </form>`;
    },
    device() {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      const on = prefs.notify && perm === 'granted';
      const blocked = perm === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings. ' : perm === 'unsupported' ? 'This browser can’t show notifications. ' : '';
      return `<div class="sub-h">On this device</div>
        <div class="row">
          <button type="button" class="btn" data-act="notify-perm"${perm === 'unsupported' || perm === 'denied' ? ' disabled' : ''}>${on ? 'Turn off browser notifications' : 'Turn on browser notifications'}</button>
          <label class="check"><input type="checkbox" data-pref="sound"${prefs.sound ? ' checked' : ''}> Sound for new leads</label>
        </div>
        <p class="help">${blocked}Sound and browser notifications only work while the desk is open in a tab. To hear about leads when it's closed, use ntfy or Telegram.</p>`;
    },
    alerts() {
      const s = data.settings;
      return `<form class="form" data-form="alerts">
        <div class="sub-h">Phone alerts with ntfy</div>
        <label class="field"><span>ntfy topic link</span><input name="ntfyUrl" type="url" inputmode="url" value="${esc(s.ntfyUrl)}" placeholder="https://ntfy.sh/your-private-topic" autocomplete="off" spellcheck="false"></label>
        <div class="row">${btn('ntfy-topic', 'Create a private topic')}</div>
        <p class="help" data-ntfy-help>${ntfyHelp(s.ntfyUrl)}</p>
        <div class="sub-h">Telegram</div>
        <label class="field"><span>Bot token</span><input name="telegramToken" value="${esc(s.telegramToken)}" placeholder="123456789:AA…" autocomplete="off" spellcheck="false"></label>
        <div class="row">${btn('tg-detect', 'Find my chat')}</div>
        <label class="field"><span>Chat id</span><input name="telegramChatId" value="${esc(s.telegramChatId)}" inputmode="numeric" autocomplete="off" spellcheck="false"></label>
        <p class="help">Create a bot with @BotFather, send it /start, then press Find my chat.</p>
        <label class="check"><input type="checkbox" name="notifyDetails"${s.notifyDetails ? ' checked' : ''}> Include the lead's first name and service in alerts</label>
        <p class="help">When this is off, alerts only say there is a new lead for the client.</p>
        <div class="row"><button class="btn primary">Save alerts</button>${btn('test-alert', 'Send test alert')}</div>
      </form>`;
    },
    phone() {
      // The link carries the desk key, so it stays hidden until asked for (screen shares, people nearby).
      if (!ui.pairShown) {
        return `<p>Open the desk on your phone with a private link. It works like a password, so only show it when nobody else can see your screen.</p>
          <div class="row">${btn('show-pair', 'Show phone link', '')}</div>`;
      }
      return `<div class="qr"><canvas data-qr role="img" aria-label="QR code that opens this desk on your phone"></canvas></div>
        <p>Scan with your phone, then Share → Add to Home Screen. Keep this link private: it opens your desk.</p>
        <div class="row">${btn('copy-pair', 'Copy link', '')}${btn('hide-pair', 'Hide')}</div>`;
    },
    clients() {
      const list = [...data.clients].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || String(a.name).localeCompare(String(b.name)));
      const ed = ui.editingClient;
      const rows = list
        .map(
          (c) =>
            `<li><button type="button" class="crow${ed === c.id ? ' on' : ''}" data-act="edit-client" data-cid="${esc(c.id)}" aria-expanded="${ed === c.id}"><span class="dot ${colorOf(c)}"></span><b>${esc(c.name)}</b>${
              c.archived ? '<span class="tag">Archived</span>' : ''
            }<span class="muted">${esc(D.NICHES[c.niche] || '')}</span></button></li>`,
        )
        .join('');
      const editing = ed === 'new' ? null : ed ? clientMap.get(ed) : undefined;
      return `${list.length ? `<ul class="clist">${rows}</ul>` : '<p class="help">No clients yet. Add one to get its private intake link.</p>'}
        <div class="row">${btn('new-client', 'Add client', '')}</div>
        ${editing !== undefined ? clientEditor(editing) : ''}`;
    },
    import() {
      const list = activeClients();
      if (!list.length) return '<p class="help">Add a client first.</p>';
      const opts = list.map((c) => `<option value="${esc(c.id)}"${ui.client === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
      const rows = ui.importRows;
      return `<form class="form" data-form="add-lead">
          <div class="sub-h">Add a lead by hand</div>
          <label class="field"><span>Client</span><select name="clientId">${opts}</select></label>
          <div class="grid2">
            <label class="field"><span>Name</span><input name="name" maxlength="120" autocomplete="off"></label>
            <label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" placeholder="050 123 4567" autocomplete="off"></label>
            <label class="field"><span>Email</span><input name="email" type="email" maxlength="160" autocomplete="off"></label>
            <label class="field"><span>Service</span><input name="service" maxlength="120" autocomplete="off"></label>
          </div>
          <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
          <div class="row"><button class="btn primary">Add lead</button></div>
        </form>
        <form class="form" data-form="import">
          <div class="sub-h">Import from Meta</div>
          <p class="help">Download leads from Meta Leads Center or Ads Manager as CSV (UTF-16 or UTF-8) and pick the file. Leads already on the desk are skipped.</p>
          <label class="field"><span>Client</span><select name="clientId">${opts}</select></label>
          <label class="field"><span>File</span><input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
          <p class="help" data-import-info>${rows ? `${esc(ui.importName)}: ${plural(rows.length, 'row')} found.` : ''}</p>
          <div class="row"><button class="btn primary"${rows ? '' : ' disabled'}>Import</button></div>
        </form>`;
    },
    export() {
      return `<p class="help">Every lead the desk holds, as a spreadsheet (CSV). Finished leads are cleared after 180 days, so download a copy if you want to keep older history.</p>
        <div class="row">${btn('export-all', 'Download all leads (CSV)', '')}</div>`;
    },
  };

  function ntfyHelp(url) {
    const m = String(url || '').match(/^https:\/\/[^/]+\/([\w-]{1,64})$/);
    return `Install the free ntfy app → + → subscribe to this topic name${m ? `: <b>${esc(m[1])}</b>` : ''}.`;
  }

  function clientEditor(c) {
    const v = c || { name: '', niche: 'car', contactName: '', contactWa: '', location: '', mapsUrl: '', hours: '', services: '', notes: '', scripts: {} };
    const scripts = v.scripts || {};
    const niches = Object.entries(D.NICHES)
      .map(([k, text]) => `<option value="${k}"${k === v.niche ? ' selected' : ''}>${esc(text)}</option>`)
      .join('');
    const steps = D.STEPS.map(
      (s) => `<div class="field">
        <label for="sc-${s.id}">${esc(s.label)}</label>
        <textarea id="sc-${s.id}" name="script-${s.id}" rows="4" maxlength="2000" placeholder="${esc(D.scriptFor(s.id, { niche: v.niche, scripts: {} }))}">${esc(scripts[s.id] || '')}</textarea>
        <button type="button" class="link" data-act="fill-default" data-step="${s.id}">Fill with default</button>
      </div>`,
    ).join('');
    return `<form class="form editor" data-form="client" data-cid="${esc(c ? c.id : '')}">
        <h3>${c ? `Edit ${esc(c.name)}` : 'New client'}</h3>
        <label class="field"><span>Business name</span><input name="name" required maxlength="80" value="${esc(v.name)}" placeholder="e.g. Glossy PPF" autocomplete="off"><small>Every message names this business, so leads know who is writing.</small></label>
        <label class="field"><span>Type of business</span><select name="niche">${niches}</select></label>
        <div class="grid2">
          <label class="field"><span>Contact name</span><input name="contactName" maxlength="80" value="${esc(v.contactName)}" placeholder="Who takes the bookings" autocomplete="off"></label>
          <label class="field"><span>Contact WhatsApp</span><input name="contactWa" type="tel" inputmode="tel" value="${esc(v.contactWa ? D.fmtPhone(v.contactWa) : '')}" placeholder="050 123 4567" autocomplete="off"><small>Confirmed bookings go to this number.</small></label>
          <label class="field"><span>Location</span><input name="location" maxlength="200" value="${esc(v.location)}" placeholder="Al Quoz 3, Dubai" autocomplete="off"></label>
          <label class="field"><span>Google Maps link</span><input name="mapsUrl" type="url" inputmode="url" maxlength="500" value="${esc(v.mapsUrl)}" placeholder="https://maps.app.goo.gl/…" autocomplete="off"></label>
        </div>
        <label class="field"><span>Opening hours</span><input name="hours" maxlength="300" value="${esc(v.hours)}" placeholder="Sat–Thu 9am–8pm" autocomplete="off"></label>
        <label class="field"><span>Services</span><textarea name="services" rows="3" maxlength="2000" placeholder="One per line">${esc(v.services)}</textarea></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000">${esc(v.notes)}</textarea></label>
        <details class="scripts"${Object.keys(scripts).length ? ' open' : ''}>
          <summary>Message scripts</summary>
          <div>
            <p class="help">Leave a box empty to use the default shown in grey. You can use ${VARS.map((x) => `<code>{{${x}}}</code>`).join(' ')}. Lines that end up empty are left out.</p>
            ${steps}
          </div>
        </details>
        <p class="err" data-client-err role="alert"></p>
        <div class="row"><button class="btn primary">${c ? 'Save' : 'Save client'}</button>${btn('close-client', 'Close')}</div>
      </form>
      ${c ? intakePanel(c) : ''}`;
  }

  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function formSnippet(c, link) {
    const service = String(c.services || '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    return [
      `<form method="POST" action="${attr(link)}">`,
      '  <input name="full_name" placeholder="Full name" required>',
      '  <input name="phone_number" type="tel" placeholder="WhatsApp number" required>',
      '  <input name="email" type="email" placeholder="Email">',
      service ? `  <input name="_service" type="hidden" value="${attr(service)}">` : '',
      '  <input name="_redirect" type="hidden" value="https://same-site-as-this-form/thank-you">',
      '  <input name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">',
      `  <label><input type="checkbox" required> ${attr(consentLine(c))}</label>`,
      '  <button>Send</button>',
      '</form>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function intakePanel(c) {
    const link = intakeUrl(c);
    const snippet = formSnippet(c, link);
    const consent = consentLine(c);
    return `<div class="intake">
      <h3>Intake for ${esc(c.name)}</h3>
      ${c.archived ? `<p class="warn">${esc(c.name)} is archived: this link doesn't take leads until you unarchive it.</p>` : ''}
      <div class="field"><span>Private intake link</span>
        <div class="copy-row"><input readonly value="${esc(link)}" aria-label="Intake link for ${esc(c.name)}" data-intake-link><button type="button" class="btn" data-act="copy" data-copy="${esc(link)}">Copy</button></div>
        <small>Anyone with this link can add leads for ${esc(c.name)}. Only paste it into Make.com, Zapier or the website form.</small>
      </div>
      <div class="sub-h">Connect Meta lead forms (Make.com)</div>
      <ol class="steps">
        <li>Create a scenario: <b>Facebook Lead Ads → Watch Leads</b> (pick ${esc(c.name)}'s Page and form).</li>
        <li>Add <b>HTTP → Make a request</b>: URL = this link, Method POST, Body type Raw, Content type JSON (application/json). Body = the lead's fields, e.g. <code>{"full_name":"{{full_name}}","phone_number":"{{phone_number}}","email":"{{email}}", …each question}</code>, or map the whole Field data.</li>
        <li>Turn it on and press <b>Send a test lead</b> below.</li>
      </ol>
      <p class="help">Same in Zapier: Facebook Lead Ads “New Lead” → Webhooks by Zapier POST, Payload type JSON, add the fields.</p>
      <div class="sub-h">Website form</div>
      <pre class="code">${esc(snippet)}</pre>
      <p class="help">Change the thank-you address to a page on their website. The thank-you page must be on the same site as the form. The hidden <code>_gotcha</code> field catches spam bots.</p>
      <div class="row"><button type="button" class="btn ghost" data-act="copy" data-copy="${esc(snippet)}">Copy form code</button></div>
      <div class="sub-h">Consent line</div>
      <p class="help">Paste this into the Instant Form's custom disclaimer (and next to the website form's checkbox):</p>
      <blockquote class="consent">${esc(consent)}</blockquote>
      <div class="row"><button type="button" class="btn ghost" data-act="copy" data-copy="${esc(consent)}">Copy consent line</button></div>
      <div class="sub-h">Check and manage</div>
      <div class="row">
        <button type="button" class="btn" data-act="test-lead" data-cid="${esc(c.id)}"${c.archived ? ' disabled' : ''}>Send a test lead</button>
        <button type="button" class="btn ghost" data-act="rotate" data-cid="${esc(c.id)}">Rotate link</button>
        <button type="button" class="btn ghost${c.archived ? '' : ' danger'}" data-act="archive" data-cid="${esc(c.id)}">${c.archived ? 'Unarchive' : 'Archive client'}</button>
      </div>
    </div>`;
  }

  /** Draws a QR code with the vendored qrcode-generator (same approach as lead-hunter/lib/qr.js). */
  function drawQr(canvas, text, cssSize = 240) {
    if (!canvas || typeof window.qrcode !== 'function') return false;
    let qr;
    try {
      qr = window.qrcode(0, 'L');
      qr.addData(String(text), 'Byte');
      qr.make();
    } catch {
      return false;
    }
    const n = qr.getModuleCount();
    const total = n + 8;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cell = Math.max(2, Math.floor((cssSize * ratio) / total));
    const px = cell * total;
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = `${Math.round(px / ratio)}px`;
    canvas.dataset.qrText = String(text);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
    return true;
  }

  /* ----------------------------------------------------------------- sync */
  async function api(method, body, query = '', k = key) {
    const res = await fetch(API + query, {
      method,
      cache: 'no-store',
      headers: { authorization: `Bearer ${k}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || `HTTP ${res.status}`), { status: res.status, code: out.error || '' });
    return out;
  }

  /** Which key the server let in ('desk' or 'queue'). Returns true when it changed. */
  function noteKeySource(d) {
    if (typeof d.keySource !== 'string' || d.keySource === keySource) return false;
    keySource = d.keySource;
    return true;
  }
  const saveCache = () => store.set(CACHE, { rev: data.rev, config: { clients: data.clients, settings: data.settings }, leads: data.leads, skew, keySource });

  function accept(d) {
    if (typeof d.now === 'number') skew = d.now - Date.now();
    noteKeySource(d);
    data = fromCache(d.config ? { rev: String(d.rev || ''), config: d.config, leads: d.leads } : null);
    saveCache();
    syncedAt = Date.now();
    offline = false;
    fatal = '';
    rebuild();
    noticeNew();
    render();
    if (deepLink) openDeepLink();
  }

  // A 503 can also be a full desk; only "not_configured" means the key isn't set up in Netlify.
  const lockedOut = (e) => e.status === 401 || (e.status === 503 && e.code === 'not_configured');

  function fail(e) {
    if (lockedOut(e)) {
      fatal = e.status === 401 ? 'unauthorized' : 'not_configured';
      if (e.status === 401) forget();
      return render();
    }
    if (!e.status) {
      offline = true;
      return renderStatus();
    }
    toast(errText(e.code), { error: true });
  }

  /** The saved key stopped working (changed in Netlify): forget it and everything this device kept with it. */
  function forget() {
    key = '';
    keySource = '';
    store.del(KEY);
    store.del(CACHE);
    store.del(PENDING);
    const dropped = pending;
    pending = [];
    for (const op of dropped) settle(op, { ok: false, error: 'unauthorized' });
    data = fromCache(null);
    older = { days: 0, at: 0, leads: null, busy: false };
    seen = null;
    rebuild();
  }

  function setHash(h) {
    const rest = h.toString();
    history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
  }
  /** Puts the working key in the address (or takes a wrong one out), so "Add to Home Screen" carries the right one. */
  function hashKey(k) {
    const h = new URLSearchParams(location.hash.slice(1));
    if (k) h.set('k', k);
    else h.delete('k');
    setHash(h);
  }

  /** Checks a key from a #k= link. It replaces the saved key only once the server accepts it. False: stop loading. */
  async function tryTrial() {
    const k = trial;
    let d;
    try {
      d = await api('GET', null, '', k);
    } catch (e) {
      if (e.status !== 401) throw e;
      if (trial === k) trial = '';
      hashKey(key);
      if (key) {
        toast(`${BAD_LINK} Still using the key saved on this device.`, { error: true });
        return true;
      }
      fatal = 'bad_link';
      render();
      return false;
    }
    if (trial !== k) return true; // a newer link arrived meanwhile: the next load checks that one
    trial = '';
    key = k;
    store.set(KEY, k);
    accept(d);
    return true;
  }

  function spin(on) {
    const b = $('[data-act="refresh"]');
    if (b) b.classList.toggle('spin', on);
  }

  async function load(force) {
    if ((!key && !trial) || fatal) return;
    if (loading) {
      again = again || !!force;
      return;
    }
    if (!force && Date.now() - lastLoad < 1500) return;
    loading = true;
    lastLoad = Date.now();
    spin(true);
    try {
      if (trial && !(await tryTrial())) return;
      await flush();
      if (fatal || !key) return;
      const before = posted;
      // The first request of each visit is a full one: it carries the server clock, used to correct this device's.
      const d = await api('GET', null, `?rev=${encodeURIComponent(syncedAt ? data.rev : '')}`);
      if (posted !== before) return; // a save landed meanwhile and already brought newer data
      if (d.unchanged) {
        syncedAt = Date.now();
        offline = false;
        if (!seen) noticeNew();
        if (noteKeySource(d)) {
          saveCache();
          render();
        } else renderStatus();
        if (deepLink) openDeepLink();
      } else accept(d);
    } catch (e) {
      fail(e);
    } finally {
      loading = false;
      spin(false);
      if (again) {
        again = false;
        load(true);
      }
    }
  }

  const savePending = () => store.set(PENDING, pending);
  function settle(op, r) {
    if (op.type === 'lead.add' && r.ok && r.data && r.data.id && seen) seen.add(r.data.id);
    const w = waiters.get(op.opId);
    if (!w) return false;
    waiters.delete(op.opId);
    w(r);
    return true;
  }

  /** Sends queued changes one by one. Network errors keep them for later; a rejected change is dropped. */
  async function flush() {
    if (flushing || !key || fatal) return;
    flushing = true;
    try {
      while (pending.length) {
        const op = pending[0];
        let d;
        try {
          d = await api('POST', { ops: [op] });
        } catch (e) {
          if (!e.status) {
            offline = true;
            for (const p of pending) settle(p, { ok: false, error: 'offline' });
            break;
          }
          if (lockedOut(e)) {
            fail(e);
            break;
          }
          if ((e.status === 409 || (e.status >= 500 && e.code !== 'desk_full')) && (op.tries || 0) < 2) {
            op.tries = (op.tries || 0) + 1;
            savePending();
            break;
          }
          pending = pending.filter((p) => p.opId !== op.opId);
          savePending();
          if (!settle(op, { ok: false, error: e.code || 'server_error' })) toast(`Not saved: ${errText(e.code)}`, { error: true });
          rebuild();
          render();
          continue;
        }
        posted++;
        pending = pending.filter((p) => p.opId !== op.opId);
        savePending();
        const r = (d.results && d.results[0]) || { ok: false, error: 'server_error' };
        if (!settle(op, r) && !r.ok) toast(`Not saved: ${errText(r.error)}`, { error: true });
        accept(d);
      }
    } finally {
      flushing = false;
      renderStatus();
    }
  }

  /** Queues a change (kept in localStorage until the server has it). Lead edits show at once. */
  function queue(op) {
    const full = { opId: D.uid('op'), ...op };
    pending.push(full);
    savePending();
    const done = new Promise((resolve) => waiters.set(full.opId, resolve));
    if (full.type === 'lead.update' || full.type === 'lead.delete') {
      rebuild();
      render();
    } else renderStatus();
    flush();
    return done;
  }

  /** For actions that only make sense live (test alert, Telegram lookup): not queued offline. */
  async function direct(op) {
    try {
      const d = await api('POST', { ops: [{ opId: D.uid('op'), ...op }] });
      posted++;
      accept(d);
      return (d.results && d.results[0]) || { ok: false, error: 'server_error' };
    } catch (e) {
      if (lockedOut(e)) fail(e);
      return { ok: false, error: e.status ? e.code || 'server_error' : 'offline' };
    }
  }

  /* ------------------------------------------------------------ new leads */
  let audio = null;
  function unlockAudio() {
    if (!prefs.sound) return;
    if (audio) {
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return;
    }
    if (!window.AudioContext) return;
    try {
      audio = new AudioContext();
    } catch {
      audio = null;
    }
  }
  function beep() {
    if (!audio || audio.state !== 'running') return;
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1320, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.34);
  }

  function noticeNew() {
    const ids = data.leads.map((l) => l.id);
    if (!seen) {
      seen = new Set(ids);
      return;
    }
    const fresh = data.leads.filter((l) => !seen.has(l.id) && l.source !== 'import' && l.status !== 'dup');
    for (const id of ids) seen.add(id);
    if (!fresh.length) return;
    if (prefs.sound) beep();
    if (!prefs.notify || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const l of fresh.slice(0, 3)) {
      try {
        const n = new Notification(`New lead · ${clientOf(l.clientId).name}`, { body: [l.name || 'No name given', l.service].filter(Boolean).join(' · '), tag: l.id });
        n.onclick = () => {
          window.focus();
          openLead(l.id);
          n.close();
        };
      } catch {
        // some mobile browsers only allow notifications from a service worker
      }
    }
  }

  /* ------------------------------------------------------------ deep link */
  function openDeepLink() {
    const id = deepLink;
    if (byId.has(id) || syncedAt) {
      deepLink = '';
      const h = new URLSearchParams(location.hash.slice(1));
      h.delete('lead');
      setHash(h);
      if (!openLead(id)) toast("That lead isn't on the desk any more.");
    }
  }

  function openLead(id) {
    const l = byId.get(id);
    if (!l) return false;
    if (ui.client && ui.client !== l.clientId) ui.client = '';
    const st = D.stage(l, data.settings, now());
    if (st === 'closed') {
      const i = groups.closed.findIndex((x) => x.l.id === id);
      if (i >= ui.closedLimit) ui.closedLimit = i + 1;
    }
    setTab(st);
    ui.flash = id;
    render();
    const el = $(`[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => {
      if (ui.flash !== id) return;
      ui.flash = '';
      const c = $(`[data-id="${CSS.escape(id)}"]`);
      if (c) c.classList.remove('flash');
      shown.delete($('[data-main]'));
    }, 2600);
    return true;
  }

  /* -------------------------------------------------------------- helpers */
  let toastTimer = 0;
  function toast(text, opts = {}) {
    const el = $('[data-toast]');
    el.innerHTML = `<span>${esc(text)}</span>${opts.undo ? '<button type="button">Undo</button>' : ''}`;
    el.classList.toggle('err', !!opts.error);
    el.hidden = false;
    if (opts.undo) {
      el.querySelector('button').onclick = () => {
        el.hidden = true;
        opts.undo();
      };
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), opts.undo ? 8000 : opts.error ? 6000 : 3000);
  }

  async function copy(text, done = 'Copied') {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    toast(ok ? done : "Couldn't copy on this device. Select the text and copy it by hand.", { error: !ok });
  }

  function busy(b, on, text) {
    if (!b) return;
    if (on) {
      b.dataset.label = b.innerHTML;
      b.disabled = true;
      if (text) b.textContent = text;
    } else if (b.dataset.label != null) {
      b.innerHTML = b.dataset.label;
      delete b.dataset.label;
      b.disabled = false;
    }
  }

  const randomId = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');

  function syncLinks(scope, text) {
    for (const a of $$('a[data-wa]', scope)) if (a.dataset.act !== 'chat') a.href = D.waUrl(a.dataset.wa, text, waMode());
  }

  function focusIn(id, sel) {
    focusSel(`[data-id="${CSS.escape(id)}"] ${sel}`);
  }
  function focusSel(sel) {
    const el = $(sel);
    if (el) el.focus();
  }

  function setTab(tab) {
    if (ui.search) {
      ui.search = '';
      $('[data-search]').value = '';
    }
    if (tab !== ui.tab) {
      // Message edits stay with the card only while you stay on this tab.
      vals.clear();
      ui.book = {};
      ui.edit = {};
      ui.lost = {};
      ui.open = {};
      ui.menu = '';
      ui.reportDirty = false;
    }
    ui.tab = tab;
    render();
    window.scrollTo(0, 0);
  }

  function setSearch(v, typed) {
    ui.search = v;
    if (!typed) $('[data-search]').value = v;
    if (v.trim() && !LEAD_TABS.includes(ui.tab)) ui.tab = 'todo';
    render();
  }

  /** Marks the step as done and offers Undo. The link itself already opened WhatsApp (or the dialler). */
  function markSent(l, kind, call) {
    const at = now();
    queue(update(l.id, { touch: kind, at }));
    toast(call ? 'Marked as called' : 'Marked as sent', { undo: () => queue(update(l.id, { untouch: at })) });
  }

  function closeLead(l, status, msg, reason) {
    const prev = { status: l.status, lostReason: l.lostReason || '' };
    const set = { status };
    if (reason != null) set.lostReason = reason;
    queue(update(l.id, { set }));
    // Re-opening a booking would reset its confirmation steps, so a closed booking is reopened by hand instead.
    toast(msg, prev.status === 'booked' ? {} : { undo: () => queue(update(l.id, { set: prev })) });
  }

  function settingsFrom(f, names) {
    const s = {};
    for (const n of names) {
      const el = f.elements[n];
      if (!el) continue;
      if (el.type === 'checkbox') s[n] = el.checked;
      else if (el.type === 'time') s[n] = el.value.slice(0, 5);
      else if (el.type === 'number') s[n] = Math.round(Number(el.value));
      else s[n] = el.value.trim();
    }
    return s;
  }

  async function saveSettings(f, s, quiet) {
    const sec = f.closest('[data-sec]');
    const b = f.querySelector('button:not([type="button"])');
    busy(b, true, 'Saving…');
    const r = await queue({ type: 'settings.save', settings: s });
    busy(b, false);
    if (r.ok) {
      if (!quiet) {
        toast('Saved');
        if (ui.tab === 'setup') renderSetup(sec.dataset.sec);
      }
    } else toast(errText(r.error), { error: r.error !== 'offline' });
    return r;
  }

  const ALERT_FIELDS = ['ntfyUrl', 'telegramToken', 'telegramChatId', 'notifyDetails'];

  /* --------------------------------------------------------------- events */
  const ACT = {
    refresh: () => load(true),
    'client-filter': ({ t }) => {
      ui.client = t.dataset.cid || '';
      render();
    },
    'clear-search': () => setSearch(''),
    'go-setup': () => {
      setTab('setup');
      ui.editingClient = 'new';
      renderSetup('clients');
      focusEditor();
    },
    menu: ({ l }) => {
      ui.menu = ui.menu === l.id ? '' : l.id;
      render();
    },
    answers: ({ l }) => {
      ui.answers[l.id] = !ui.answers[l.id];
      render();
    },
    open: ({ l }) => {
      ui.open[l.id] = !ui.open[l.id];
      render();
    },
    send: ({ t, l }) => {
      if (t.dataset.busy) return;
      t.dataset.busy = '1';
      const kind = t.dataset.kind;
      const call = (t.getAttribute('href') || '').startsWith('tel:');
      const at = now();
      // Saved at once so it survives the page being put to sleep, but shown after the link has opened.
      pending.push({ opId: D.uid('op'), type: 'lead.update', id: l.id, upd: { touch: kind, at } });
      savePending();
      setTimeout(() => {
        vclear(l.id);
        ui.open[l.id] = false;
        rebuild();
        render();
        toast(call ? 'Marked as called' : 'Marked as sent', { undo: () => queue(update(l.id, { untouch: at })) });
        flush();
      }, 400);
    },
    mark: ({ l }) => {
      const a = D.nextAction(l, data.settings, now());
      ui.menu = '';
      if (a && STEP_OF[a.kind]) markSent(l, a.kind, false);
      else render();
    },
    'copy-msg': ({ l, card }) => {
      const ta = card.querySelector('[data-f="msg"]');
      copy(ta ? ta.value : scriptText(STEP_OF[(D.nextAction(l, data.settings, now()) || {}).kind] || 'first', l, clientOf(l.clientId)), 'Message copied');
    },
    replied: ({ l }) => {
      queue(update(l.id, { set: { status: 'replied' } }));
      toast('Moved to Chatting');
    },
    book: ({ l }) => {
      ui.book[l.id] = !ui.book[l.id];
      ui.lost[l.id] = false;
      render();
      if (ui.book[l.id]) focusIn(l.id, '[data-f="book-date"]');
    },
    'book-cancel': ({ l }) => {
      ui.book[l.id] = false;
      vclear(l.id, 'book');
      render();
    },
    lost: ({ l }) => {
      ui.lost[l.id] = !ui.lost[l.id];
      ui.book[l.id] = false;
      render();
      if (ui.lost[l.id]) focusIn(l.id, '[data-f="reason"]');
    },
    'lost-cancel': ({ l }) => {
      ui.lost[l.id] = false;
      vclear(l.id, 'reason');
      render();
    },
    fake: ({ l }) => closeLead(l, 'fake', 'Marked as wrong number / fake'),
    noanswer: ({ l }) => closeLead(l, 'noanswer', 'Closed: no answer'),
    showed: ({ l }) => {
      queue(update(l.id, { set: { outcome: 'showed' } }));
      toast('Marked as showed up', { undo: () => queue(update(l.id, { set: { outcome: null } })) });
    },
    noshow: ({ l }) => {
      queue(update(l.id, { set: { outcome: 'noshow' } }));
      toast('Marked as no-show', { undo: () => queue(update(l.id, { set: { outcome: null } })) });
    },
    'outcome-clear': ({ l }) => queue(update(l.id, { set: { outcome: null } })),
    reopen: ({ l }) => {
      ui.menu = '';
      queue(update(l.id, { set: { status: 'new' } }));
      toast('Reopened as a new lead');
    },
    edit: ({ l }) => {
      ui.menu = '';
      ui.edit[l.id] = true;
      render();
      focusIn(l.id, '[data-f="e-name"]');
    },
    'edit-cancel': ({ l }) => {
      ui.edit[l.id] = false;
      vclear(l.id, 'e-');
      render();
    },
    delete: ({ l }) => {
      if (!confirm(`Delete ${l.name || 'this lead'}? This can't be undone.`)) return;
      ui.menu = '';
      queue({ type: 'lead.delete', ids: [l.id] });
      toast('Lead deleted');
    },
    goto: ({ t }) => openLead(t.dataset.goto),
    'more-closed': () => {
      ui.closedLimit += 200;
      render();
    },

    // Report
    'copy-report': () => copy(($('[data-report-text]') || {}).value || '', 'Report copied'),
    'report-csv': () => {
      const range = rangeOf(ui.report.range, now());
      const src = reportLeads(range) || leads;
      const list = src.filter((l) => l.source !== 'test' && (!ui.report.client || l.clientId === ui.report.client) && l.createdAt >= range.from && l.createdAt < range.to);
      const c = ui.report.client ? clientMap.get(ui.report.client) : null;
      download(`leads-${slug(c ? c.name : 'all-clients')}-${dayKey(range.from)}-to-${dayKey(range.to - 1)}.csv`, csvFor(list));
    },

    // Setup
    'notify-perm': async () => {
      if (!('Notification' in window)) return;
      if (prefs.notify && Notification.permission === 'granted') prefs.notify = false;
      else {
        let p = Notification.permission;
        if (p === 'default') {
          try {
            p = await Notification.requestPermission();
          } catch {
            p = 'denied';
          }
        }
        prefs.notify = p === 'granted';
        toast(prefs.notify ? 'Browser notifications are on for this device.' : 'Notifications are blocked. Allow them in the browser’s site settings.', { error: !prefs.notify });
      }
      savePrefs();
      renderSetup('device');
    },
    'ntfy-topic': async ({ t }) => {
      const f = t.closest('form');
      const url = `https://ntfy.sh/rr-desk-${randomId(20)}`;
      f.elements.ntfyUrl.value = url;
      $('[data-ntfy-help]', f).innerHTML = ntfyHelp(url);
      const r = await saveSettings(f, { ntfyUrl: url }, true);
      if (r.ok) toast('Private topic created and saved. Now subscribe to it in the ntfy app.');
    },
    'tg-detect': async ({ t }) => {
      const f = t.closest('form');
      const token = f.elements.telegramToken.value.trim();
      if (!token) return toast('Paste the bot token from @BotFather first.', { error: true });
      busy(t, true, 'Looking…');
      const r = await direct({ type: 'telegram.detect', token });
      busy(t, false);
      if (!r.ok || !r.data || !r.data.chatId) return toast(errText(r.ok ? 'server_error' : r.error), { error: true });
      // The latest chat with the bot may not be Samil's (anyone can message a bot), so he checks the name first.
      const { chatId, name } = r.data;
      if (!confirm(`Send alerts to Telegram chat "${name || chatId}"?`)) return toast('Nothing saved. Send /start to your bot from your own Telegram, then press Find my chat again.');
      f.elements.telegramChatId.value = chatId;
      const s = await saveSettings(f, { telegramToken: token, telegramChatId: chatId }, true);
      if (s.ok) toast(`Telegram alerts go to ${name || 'that chat'} now.`);
    },
    'test-alert': async ({ t }) => {
      const f = t.closest('form');
      const sec = f.closest('[data-sec]');
      busy(t, true, 'Sending…');
      if (sec.dataset.dirty) {
        const s = await saveSettings(f, settingsFrom(f, ALERT_FIELDS), true);
        if (!s.ok) return busy(t, false);
        delete sec.dataset.dirty;
      }
      const r = await direct({ type: 'notify.test' });
      busy(t, false);
      if (!r.ok) return toast(errText(r.error), { error: true });
      if (!r.data) return toast('Test alert sent. Check your phone.');
      const say = (v) => (v === 'ok' ? 'sent' : v === 'off' ? 'not set up' : `failed (${errText(v)})`);
      const bad = [r.data.ntfy, r.data.telegram].some((v) => String(v).startsWith('error'));
      toast(`Test alert: ntfy ${say(r.data.ntfy)} · Telegram ${say(r.data.telegram)}`, { error: bad });
    },
    'show-pair': () => {
      ui.pairShown = true;
      renderSetup('phone');
      focusSel('[data-act="copy-pair"]');
    },
    'hide-pair': () => {
      ui.pairShown = false;
      renderSetup('phone');
      focusSel('[data-act="show-pair"]');
    },
    'copy-pair': () => copy(pairUrl(), 'Link copied. Keep it private.'),
    copy: ({ t }) => copy(t.dataset.copy || '', 'Copied'),
    'new-client': () => openEditor('new'),
    'edit-client': ({ t }) => openEditor(ui.editingClient === t.dataset.cid ? null : t.dataset.cid),
    'close-client': () => openEditor(null),
    'fill-default': ({ t }) => {
      const f = t.closest('form');
      const ta = f.elements[`script-${t.dataset.step}`];
      ta.value = D.scriptFor(t.dataset.step, { niche: f.elements.niche.value, scripts: {} });
      f.closest('[data-sec]').dataset.dirty = '1';
      ta.focus();
    },
    'test-lead': async ({ t }) => {
      const c = clientMap.get(t.dataset.cid);
      if (!c) return;
      busy(t, true, 'Sending…');
      try {
        const res = await fetch(intakeUrl(c), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ full_name: 'Test Lead', phone_number: '+971500000000', _test: true, which_service_are_you_interested_in: 'Test' }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error('intake'), { status: res.status, code: out.error });
        toast('Test lead received. It is in To do.');
        await load(true);
      } catch (e) {
        toast(e.status ? errText(e.code) : "You're offline, so the test lead couldn't be sent.", { error: true });
      } finally {
        busy(t, false);
      }
    },
    rotate: async ({ t }) => {
      const c = clientMap.get(t.dataset.cid);
      if (!c || !confirm(`Make a new intake link for ${c.name}? The current link stops working at once, so update Make.com, Zapier and any website forms.`)) return;
      busy(t, true, 'Rotating…');
      const r = await queue({ type: 'client.rotate', id: c.id });
      busy(t, false);
      if (!r.ok) return toast(errText(r.error), { error: r.error !== 'offline' });
      toast('New link ready. Update it everywhere you used the old one.');
      renderSetup('clients');
    },
    archive: async ({ t }) => {
      const c = clientMap.get(t.dataset.cid);
      if (!c) return;
      if (!c.archived && !confirm(`Archive ${c.name}? Its intake link stops taking leads. Leads already on the desk stay.`)) return;
      const r = await queue({ type: 'client.save', client: { id: c.id, archived: !c.archived } });
      if (!r.ok) return toast(errText(r.error), { error: r.error !== 'offline' });
      toast(c.archived ? `${c.name} is active again` : `${c.name} archived`);
      renderSetup('clients');
    },
    'export-all': async ({ t }) => {
      busy(t, true, 'Preparing…');
      try {
        const d = await api('GET', null, '?days=400');
        const all = new Map((d.leads || []).map((l) => [l.id, l]));
        for (const l of leads) all.set(l.id, l);
        download(`lead-desk-${dayKey(now())}.csv`, csvFor([...all.values()]));
      } catch (e) {
        toast(e.status ? errText(e.code) : "You're offline. Connect to download everything.", { error: true });
      } finally {
        busy(t, false);
      }
    },
  };

  function openEditor(id) {
    const sec = $('[data-sec="clients"]');
    if (sec && sec.dataset.dirty && ui.editingClient && !confirm('Discard the changes you made to this client?')) return;
    ui.editingClient = id;
    renderSetup('clients');
    if (id) focusEditor();
  }
  function focusEditor() {
    const f = $('[data-form="client"]');
    if (!f) return;
    f.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    f.elements.name.focus({ preventScroll: true });
  }

  async function readImport(input) {
    const f = input.form;
    const note = $('[data-import-info]', f);
    const b = f.querySelector('button:not([type="button"])');
    const file = input.files && input.files[0];
    ui.importRows = null;
    b.disabled = true;
    note.textContent = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return (note.textContent = 'That file is too big. Export a shorter date range from Meta.');
    try {
      const rows = D.parseCsv(D.decodeBytes(new Uint8Array(await file.arrayBuffer())))
        .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => String(v).trim() !== '')))
        .filter((r) => Object.keys(r).length);
      if (!rows.length) return (note.textContent = 'No rows found. Is this the CSV from Meta Leads Center or Ads Manager?');
      if (rows.length > 2000) return (note.textContent = `${plural(rows.length, 'row')} found. Import up to 2000 at a time: export a shorter date range from Meta.`);
      const names = rows
        .slice(0, 3)
        .map((r) => D.mapIntake(r).name)
        .filter(Boolean);
      ui.importRows = rows;
      ui.importName = file.name;
      note.textContent = `${file.name}: ${plural(rows.length, 'row')} found${names.length ? `, e.g. ${names.join(', ')}` : ''}.`;
      b.disabled = false;
    } catch {
      note.textContent = "Couldn't read that file.";
    }
  }

  const FORMS = {
    pair: async (f) => {
      const k = f.elements.key.value.trim();
      if (!k) return;
      const b = f.querySelector('button');
      const err = $('[data-pair-error]');
      err.textContent = '';
      busy(b, true, 'Opening…');
      try {
        const d = await api('GET', null, '', k);
        key = k;
        trial = '';
        store.set(KEY, k);
        // On a phone, keep the key in the address so "Add to Home Screen" carries it (like the QR link).
        if (isTouch || new URLSearchParams(location.hash.slice(1)).has('k')) hashKey(k);
        f.reset();
        seen = null;
        accept(d);
        load(true);
      } catch (e) {
        if (e.status === 401) err.textContent = 'Wrong key.';
        else if (e.code === 'not_configured') err.textContent = NOT_CONFIGURED;
        else err.textContent = e.status ? errText(e.code) : "Couldn't reach the server. Check the connection and try again.";
      } finally {
        busy(b, false);
      }
    },
    book: (f, l) => {
      const date = $('[data-f="book-date"]', f).value;
      const time = $('[data-f="book-time"]', f).value.slice(0, 5);
      const bookedFor = `${date}T${time}`;
      if (!D.dubaiLocalValid(bookedFor)) return toast('Pick a date and a time.', { error: true });
      ui.book[l.id] = false;
      vclear(l.id, 'book');
      queue(update(l.id, { set: { status: 'booked', bookedFor } }));
      toast(`Booked for ${D.fmtBooked(bookedFor)}`);
    },
    lost: (f, l) => {
      const reason = $('[data-f="reason"]', f).value.trim();
      ui.lost[l.id] = false;
      vclear(l.id, 'reason');
      closeLead(l, 'lost', 'Marked as not interested', reason);
    },
    edit: (f, l) => {
      const v = (n) => $(`[data-f="${n}"]`, f).value;
      const set = { name: v('e-name'), email: v('e-email'), service: v('e-service'), notes: v('e-notes') };
      if (D.normPhone(v('e-phone')).digits !== (l.phone || '')) set.phone = v('e-phone');
      ui.edit[l.id] = false;
      vclear(l.id, 'e-');
      queue(update(l.id, { set }));
      toast('Saved');
    },
    details: (f) => saveSettings(f, settingsFrom(f, ['myName', 'workStart', 'workEnd', 'followup1Min', 'followup2At'])),
    alerts: (f) => saveSettings(f, settingsFrom(f, ALERT_FIELDS)),
    client: async (f) => {
      const g = (n) => (f.elements[n] ? f.elements[n].value : '');
      const err = $('[data-client-err]', f);
      err.textContent = '';
      const mapsUrl = g('mapsUrl').trim();
      if (mapsUrl && !/^https:\/\//i.test(mapsUrl)) return (err.textContent = 'Use the https:// link from Google Maps (Share → Copy link).');
      const scripts = {};
      for (const s of D.STEPS) scripts[s.id] = g(`script-${s.id}`);
      const client = {
        name: g('name').trim(),
        niche: g('niche'),
        contactName: g('contactName').trim(),
        contactWa: g('contactWa').trim(),
        location: g('location').trim(),
        mapsUrl,
        hours: g('hours').trim(),
        services: g('services').trim(),
        notes: g('notes').trim(),
        scripts,
      };
      if (f.dataset.cid) client.id = f.dataset.cid;
      const b = f.querySelector('button:not([type="button"])');
      busy(b, true, 'Saving…');
      const r = await queue({ type: 'client.save', client });
      busy(b, false);
      if (!r.ok && r.error !== 'offline') return (err.textContent = errText(r.error));
      delete f.closest('[data-sec]').dataset.dirty;
      if (r.ok) {
        // A save the server already had (sent again after a dropped connection) comes back without the client.
        ui.editingClient = r.data ? r.data.id : f.dataset.cid || null;
        toast(f.dataset.cid || !r.data ? 'Client saved' : 'Client added. Its intake link is below.');
      } else {
        ui.editingClient = null;
        toast(errText('offline'));
      }
      renderSetup('clients');
    },
    'add-lead': async (f) => {
      const g = (n) => f.elements[n].value.trim();
      const lead = { clientId: g('clientId'), name: g('name'), phone: g('phone'), email: g('email'), service: g('service'), notes: g('notes') };
      if (!lead.name && !lead.phone && !lead.email) return toast(ERRORS.no_contact_details, { error: true });
      const b = f.querySelector('button:not([type="button"])');
      busy(b, true, 'Adding…');
      const r = await queue({ type: 'lead.add', lead });
      busy(b, false);
      if (!r.ok) return toast(errText(r.error), { error: r.error !== 'offline' });
      f.reset();
      delete f.closest('[data-sec]').dataset.dirty;
      if (!r.data) toast('Lead added');
      else if (r.data.status === 'dup') toast('Added, but the same number came in earlier, so it is closed as a duplicate.');
      else {
        toast('Lead added');
        openLead(r.data.id);
      }
    },
    import: async (f) => {
      const rows = ui.importRows;
      if (!rows) return;
      const b = f.querySelector('button:not([type="button"])');
      busy(b, true, 'Importing…');
      const r = await queue({ type: 'lead.import', clientId: f.elements.clientId.value, rows });
      busy(b, false);
      ui.importRows = null;
      delete f.closest('[data-sec]').dataset.dirty;
      if (ui.tab === 'setup') renderSetup('import');
      if (!r.ok) return toast(errText(r.error), { error: r.error !== 'offline' });
      if (!r.data) return toast('Import done');
      const { added = 0, skipped = 0, dups = 0 } = r.data;
      toast(`Import done: added ${added} · duplicates ${dups} · skipped ${skipped}`);
    },
  };

  document.addEventListener('click', (e) => {
    unlockAudio();
    const t = e.target.closest('[data-act], [data-tab]');
    if (ui.menu && !(t && (t.dataset.act === 'menu' || t.closest('.menu')))) {
      ui.menu = '';
      // Re-render after the click finishes, so a link that was clicked still opens.
      setTimeout(render);
    }
    if (!t || t.disabled) return;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    const fn = ACT[t.dataset.act];
    if (!fn) return;
    const card = t.closest('[data-id]');
    const l = card ? byId.get(card.dataset.id) : null;
    if (card && !l) return;
    fn({ t, l, card });
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const fn = FORMS[f.dataset.form];
    if (!fn) return;
    const card = f.closest('[data-id]');
    const l = card ? byId.get(card.dataset.id) : null;
    if (card && !l) return;
    fn(f, l);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-search]')) return setSearch(t.value, true);
    if (t.name === 'waMode' || t.dataset.pref || t.dataset.report) return;
    const card = t.closest('[data-id]');
    if (card && t.dataset.f) {
      const id = card.dataset.id;
      vset(id, t.dataset.f, t.value);
      if (t.dataset.f === 'step') {
        vclear(id, 'msg');
        return render();
      }
      if (t.dataset.f === 'msg') {
        syncLinks(card, t.value);
        fit(t);
      }
      if (t.dataset.f === 'book-date' || t.dataset.f === 'book-time') {
        const w = $('[data-book-warn]', card);
        if (w) w.hidden = !bookedPast(vget(id, 'book-date') ?? $('[data-f="book-date"]', card).value, vget(id, 'book-time') ?? $('[data-f="book-time"]', card).value);
      }
      return;
    }
    if (t.matches('[data-report-text]')) {
      ui.reportDirty = true;
      syncLinks(t.closest('.report'), t.value);
      return fit(t);
    }
    const sec = t.closest('[data-sec]');
    if (sec) sec.dataset.dirty = '1';
    if (t.name === 'ntfyUrl') $('[data-ntfy-help]').innerHTML = ntfyHelp(t.value.trim());
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.report) {
      ui.report[t.dataset.report] = t.value;
      ui.reportDirty = false;
      return renderReport();
    }
    if (t.dataset.pref === 'sound') {
      prefs.sound = t.checked;
      savePrefs();
      if (prefs.sound) {
        unlockAudio();
        beep();
      }
      return;
    }
    if (t.name === 'waMode') {
      prefs.waMode = t.value;
      savePrefs();
      return toast(t.value === 'app' ? 'Links will open the WhatsApp app on this computer.' : 'Links will open WhatsApp Web on this computer.');
    }
    if (t.name === 'niche' && t.form && t.form.dataset.form === 'client') {
      const ta = t.form.elements['script-first'];
      if (ta) ta.placeholder = D.scriptFor('first', { niche: t.value, scripts: {} });
    }
    if (t.type === 'file' && t.form && t.form.dataset.form === 'import') readImport(t);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.target.matches && e.target.matches('[data-search]') && ui.search) return setSearch('');
    if (ui.menu) {
      ui.menu = '';
      render();
    }
  });

  addEventListener('hashchange', () => {
    const h = new URLSearchParams(location.hash.slice(1));
    const k = h.get('k');
    if (k && k !== key && k !== trial) {
      trial = k;
      fatal = '';
      render();
      load(true);
    }
    if (h.get('lead')) {
      deepLink = h.get('lead');
      openDeepLink();
    }
  });

  function tick() {
    if (!key || fatal) return;
    const before = sig;
    compute();
    renderHeader();
    if (sig !== before) return renderMain();
    const t = now();
    for (const el of $$('[data-timer]')) {
      const due = Number(el.dataset.timer);
      if (el.dataset.kind === 'first') {
        el.textContent = `Waiting ${dur(t - due)}`;
        el.className = `timer ${heat(t - due)}`;
      } else el.textContent = dueText(due);
    }
    for (const el of $$('[data-ago]')) el.textContent = ago(Number(el.dataset.ago));
  }

  /* ----------------------------------------------------------------- boot */
  const head = $('[data-head]');
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`);
      tabFade();
    }).observe(head);
  }
  $('[data-tabs]').addEventListener('scroll', tabFade, { passive: true });
  rebuild();
  render();
  if (deepLink && byId.has(deepLink)) openDeepLink();
  if (key || trial) load(true);
  setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
  addEventListener('focus', () => load());
  addEventListener('online', () => {
    offline = false;
    load(true);
  });
  addEventListener('offline', () => {
    offline = true;
    renderStatus();
  });
})();
