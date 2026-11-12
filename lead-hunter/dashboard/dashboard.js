/* Lead Hunter dashboard: the Leads table and lead panel, the Find tab and Settings (the Intent tab is intent.js).
   Reads chrome.storage directly and re-renders on every change; all lead writes go through the background worker
   so they never race with the website and email checks. */
const LH = globalThis.LH;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeHref = (u) => {
  try {
    const x = new URL(u);
    return ['http:', 'https:', 'tel:', 'mailto:'].includes(x.protocol) ? x.href : '#';
  } catch {
    return '#';
  }
};
const send = (m) => chrome.runtime.sendMessage(m);
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const compactNum = (n) => Intl.NumberFormat(undefined, { notation: 'compact' }).format(n || 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ALL_TYPES = 'All types';
const ROWS_STEP = 300;
const ICON = {
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
};

const S = {
  leads: new Map(),
  settings: LH.withDefaults(),
  hunt: null,
  finder: null,
  queue: [], // websites waiting for their check
  checkQ: [], // leads whose email domains are being checked
  mailQ: [], // leads waiting for a mailbox check
  verifyUsage: null,
  verifyWait: null,
  selected: new Set(),
  view: 'leads',
  openId: null,
  limit: ROWS_STEP,
  findPreset: ALL_TYPES,
  coldInclude: false, // Include already exported
  filters: { q: '', show: 'fits', status: '', niche: '', source: '', sort: 'score', exported: false, contactedBefore: false, hunt: '' },
  alerts: {}, // sources paused by a login wall, checkpoint or block: { maps: { at, text, url, hint } }
  problems: {}, // the last problems per source, newest first
  history: {}, // contacted memory
};

/* ------------------------------------------------------------------ data */
async function load() {
  const all = await chrome.storage.local.get(null);
  S.leads = new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith('lead:'))
      .map(([, v]) => [v.id, v]),
  );
  S.settings = LH.withDefaults(all.settings);
  S.hunt = all.hunt || null;
  S.finder = all.finder || null;
  S.queue = all.enrichQueue || [];
  S.checkQ = all.emailCheckQueue || [];
  S.mailQ = all.mailboxQueue || [];
  S.verifyUsage = all.verifyUsage || null;
  S.verifyWait = all.verifyWait || null;
  S.history = all.contactHistory || {};
  S.alerts = all.alerts || {};
  S.problems = all.problems || {};
}

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 250);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let settingsChanged = false;
  const plain = { hunt: 'hunt', finder: 'finder', verifyUsage: 'verifyUsage', verifyWait: 'verifyWait' };
  const lists = { enrichQueue: 'queue', emailCheckQueue: 'checkQ', mailboxQueue: 'mailQ' };
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k.startsWith('lead:')) {
      const id = k.slice(5);
      if (newValue) S.leads.set(id, newValue);
      else {
        S.leads.delete(id);
        S.selected.delete(id);
      }
    } else if (k === 'settings') {
      S.settings = LH.withDefaults(newValue);
      settingsChanged = true;
    } else if (plain[k]) S[plain[k]] = newValue || null;
    else if (lists[k]) S[lists[k]] = newValue || [];
    else if (k === 'alerts') S.alerts = newValue || {};
    else if (k === 'intentState') {
      S.intent.state = newValue || {};
      renderIntentCount();
    } else if (k === 'problems') {
      S.problems = newValue || {};
      renderProblems();
    } else if (k === 'contactHistory') {
      S.history = newValue || {};
      renderHistory();
    }
  }
  if (settingsChanged && S.view !== 'settings') fillSettings();
  if (settingsChanged) renderPresetChips();
  scheduleRender();
});

/* ---------------------------------------------------------------- one lead */
/** Where it was found, for the table and the filter. */
const foundOn = (l) => (l.kind === 'prospect' ? LH.coldEmailSource(l) : 'Ad Library');
/** New leads that match someone you contacted, exported or imported before: hidden unless asked for. */
const contactedBefore = (l) => (l.status === 'new' && !l.contactedAt ? LH.historyHit(l, S.history) : null);
/** Everything the table needs to know about a lead, worked out once per render. */
function facts(l, now = Date.now()) {
  const fs = LH.fitScore(l, S.settings, now);
  return { l, fs, fit: fs.fit, mail: LH.sendableEmail(l, S.settings), info: LH.emailInfo(l), niche: LH.nicheOf(l, S.settings) || '' };
}

/** The leads the filters show. withExported: also the ones exported before (Include already exported). */
function filtered({ withExported = false } = {}) {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const rows = [];
  for (const l of S.leads.values()) {
    if (f.hunt && !(l.hunts || []).includes(f.hunt)) continue;
    if (f.status === '' && ['skip', 'lost'].includes(l.status)) continue;
    if (f.status && f.status !== 'all' && l.status !== f.status) continue;
    if (!f.exported && !withExported && l.coldEmailExportedAt && f.show !== 'all') continue;
    if (!f.contactedBefore && contactedBefore(l)) continue;
    if (f.source && foundOn(l) !== f.source) continue;
    const r = facts(l, now);
    if (f.niche && r.niche !== f.niche) continue;
    const fit = r.fit;
    const ok = {
      fits: fit.fit,
      ready: fit.fit && !!r.mail.email,
      needemail: fit.fit && !r.mail.email,
      new: !!fit.open,
      site: ['down', 'parked'].includes(fit.site),
      checking: fit.pending || (fit.fit && r.mail.why === 'waiting'),
      nofit: !fit.fit && !fit.pending,
      all: true,
    }[f.show];
    if (!ok) continue;
    if (q) {
      const hay = [l.pageName, l.website, l.area, r.niche, LH.igHandle(l), ...(l.keywords || []), ...(l.categories || []), ...l.phones.map((x) => x.number), ...(l.emails || []), l.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push(r);
  }
  const sorters = {
    score: (a, b) => b.fs.score - a.fs.score || (b.l.createdAt || 0) - (a.l.createdAt || 0),
    newest: (a, b) => (b.l.createdAt || 0) - (a.l.createdAt || 0),
    name: (a, b) => (a.l.pageName || '').localeCompare(b.l.pageName || ''),
  };
  return rows.sort(sorters[f.sort] || sorters.score);
}

/* ---------------------------------------------------------------- pieces */
const initials = (n) =>
  String(n || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
const avatar = (l) =>
  l.avatar
    ? `<img class="av" src="${esc(safeHref(l.avatar))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${esc(initials(l.pageName))}" />`
    : `<span class="av">${esc(initials(l.pageName))}</span>`;
const statusOptions = (cur) => LH.STATUSES.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
const scoreBadge = (fs) => `<span class="heat ${LH.fitClass(fs.score)}" title="${esc(`${fs.score}/100: ${fs.parts.map((x) => `${x.label} +${x.points}`).join(', ') || 'nothing yet'}`)}">${fs.score}</span>`;

const TAG_CLASS = { 'Contacted before': 'red', 'Just opened': 'green', 'Opening soon': 'green', 'Site down': 'amber', Parked: 'amber', 'Email confirmed': 'green', 'Email failed': 'red', 'Email not confirmed': 'amber', 'Exported for cold email': '' };
const ROW_TAGS = ['Contacted before', 'Just opened', 'Opening soon', 'Exported for cold email'];
function tagsHtml(l) {
  const tags = LH.fitTags(l, { settings: S.settings, history: S.history }).filter((t) => ROW_TAGS.includes(t));
  return tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag ${TAG_CLASS[t] || ''}">${esc(t)}</span>`).join('')}</div>` : '';
}

/** Why it fits, or why not, with the proof underneath. */
function whyCell({ fit }) {
  const proof = fit.open && fit.open.label ? `<div class="proof" title="${esc(fit.open.label)}">${esc(fit.open.label)}</div>` : '';
  return `<div class="why ${fit.fit ? 'yes' : fit.pending ? 'wait' : 'no'}">${esc(fit.why)}${proof}</div>`;
}

const SITE_TAG = { none: ['amber', 'No website'], down: ['red', 'Down'], parked: ['red', 'Parked'], working: ['', 'Working'], blocked: ['', 'Could not check'], unknown: ['', 'Not checked'] };
function siteCell(l, fit) {
  const st = (l.site || {}).state;
  const busy = ['queued', 'running'].includes(st);
  const own = LH.ownWebsite(l);
  if (!own) return `<div class="site">${busy ? '<span class="spin"></span>' : ''}<span class="tag amber">No website</span></div>`;
  const link = `<a href="${esc(safeHref(l.landingUrl || own))}" target="_blank" rel="noopener noreferrer" data-stop>${esc(LH.domainOf(own))}</a>`;
  if (busy) return `<div class="site"><span class="spin"></span>${link}</div>`;
  const [cls, label] = SITE_TAG[fit.site] || SITE_TAG.unknown;
  return `<div class="site">${link}<span class="tag ${cls}">${esc(label)}</span></div>`;
}

const EMAIL_STATE = { ok: 'Confirmed', unverified: 'Domain checked', unchecked: 'Checking', risky: 'Not confirmed', bad: 'Removed' };
const stateChip = (x) => `<span class="st ${x.state}" title="${esc(x.why || EMAIL_HELP[x.state])}">${EMAIL_STATE[x.state]}</span>`;
const EMAIL_HELP = {
  ok: 'The mailbox check confirmed this address exists',
  unverified: 'Its domain receives email. The mailbox itself has not been checked.',
  unchecked: 'Waiting for its check',
  risky: 'The check could not confirm this mailbox',
  bad: 'Not usable',
};
function emailCell(l, { info, mail }) {
  if (!info.length) {
    const fb = (l.fbEmail || {}).state === 'queued';
    return `<span class="muted">${fb ? 'Looking on Facebook…' : ['queued', 'running'].includes((l.site || {}).state) ? 'Looking…' : 'No email'}</span>`;
  }
  const best = info.find((x) => x.email === mail.email) || info[0];
  const rest = info.length - 1;
  return `<div class="contact"><div class="p ${best.state === 'bad' ? 'gone' : ''}"><span class="trunc" title="${esc(best.email)}">${esc(best.email)}</span></div><div class="p">${stateChip(best)}${rest ? `<span class="muted">+${rest} more</span>` : ''}</div></div>`;
}

function contactCell(l) {
  const best = LH.bestPhone(l);
  const shown = LH.whatsappTarget(l) || (best && best.number);
  const parts = [];
  if (shown) parts.push(`<div class="p"><span class="num">${esc(LH.formatPhone(shown))}</span></div>`);
  const ig = LH.igHandle(l);
  if (ig) parts.push(`<div class="p muted">${ICON.ig}<a class="trunc" href="https://www.instagram.com/${esc(encodeURIComponent(ig))}/" target="_blank" rel="noopener noreferrer" data-stop>@${esc(ig)}</a></div>`);
  return parts.length ? `<div class="contact">${parts.join('')}</div>` : '<span class="muted">–</span>';
}

function rowHtml(r) {
  const l = r.l;
  const meta = [r.niche, l.area, !l.area && (l.categories || [])[0], foundOn(l)].filter(Boolean).join(' · ');
  const dim = ['lost', 'skip', 'won'].includes(l.status) || (!r.fit.fit && !r.fit.pending) ? ' dim' : '';
  return `<tr data-id="${esc(l.id)}" class="${S.selected.has(l.id) ? 'sel' : ''}${dim}">
    <td class="c-sel"><input type="checkbox" data-sel ${S.selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.pageName)}" /></td>
    <td>${scoreBadge(r.fs)}</td>
    <td><div class="biz">${avatar(l)}<div style="min-width:0"><div class="n">${esc(l.pageName || 'Unknown')}</div><div class="m">${esc(meta)}</div>${tagsHtml(l)}</div></div></td>
    <td>${whyCell(r)}</td>
    <td>${siteCell(l, r.fit)}</td>
    <td>${emailCell(l, r)}</td>
    <td>${contactCell(l)}</td>
    <td><select class="status-sel" data-status aria-label="Status">${statusOptions(l.status)}</select></td>
    <td><button class="btn sm" data-open>Open</button></td>
  </tr>`;
}

/* ---------------------------------------------------------------- render */
function renderKpis() {
  if (S.view === 'intent') return renderIntentKpis();
  const now = Date.now();
  let fits = 0;
  let ready = 0;
  for (const l of S.leads.values()) {
    if (!LH.coldEmailOpen(l) || l.coldEmailExportedAt) continue;
    if (!LH.fit(l, S.settings, now).fit) continue;
    fits++;
    if (LH.sendableEmail(l, S.settings).email) ready++;
  }
  const exported = [...S.leads.values()].filter((l) => l.coldEmailExportedAt).length;
  $('[data-kpis]').innerHTML =
    `<span class="kpi hot" title="They fit and their email passed its checks: they go in the next Export for cold email"><b>${ready}</b> ready to export</span>` +
    `<span class="kpi" title="Just opened without a working website, or a website that is down or parked"><b>${fits}</b> fit</span>` +
    `<span class="kpi"><b>${S.leads.size}</b> found</span>` +
    `<span class="kpi"><b>${exported}</b> exported</span>`;
}

const SOURCE_LABEL = { adlib: 'Meta Ad Library', maps: 'Google Maps', instagram: 'Instagram API', fbpage: 'Facebook pages', verify: 'Email check', reddit: 'Reddit', facebook: 'Facebook groups', linkedin: 'LinkedIn', ai: 'AI check' };
const presetNamed = (name) => LH.presetsFor(S.settings).find((n) => n.name === name);
/** Before and after: "87 found → 31 new · 6 that Google says just opened · 22 already saved…". */
function runStats(f) {
  const st = f.stats;
  if (!st || !st.found) return '';
  const parts = [
    `<b>${st.found}</b> found → <b>${st.kept}</b> new`,
    `<b>${st.opened || 0}</b> that Google says just opened`,
    st.duplicate && `${st.duplicate} already saved`,
    st.contacted && `${st.contacted} contacted before`,
    st.fewReviews && `${st.fewReviews} with too few reviews`,
    st.manyReviews && `${st.manyReviews} with too many reviews`,
    st.excluded && `${st.excluded} with an exclude word`,
  ];
  return `<span class="run-stats m">${parts.filter(Boolean).join(' · ')}</span>`;
}
/** The strip under the header: what is running, what paused, and how the checks are doing. */
function renderStrip() {
  const el = $('[data-strip]');
  if (!['leads', 'find'].includes(S.view)) return (el.hidden = true);
  const lines = [];
  const f = S.finder;
  if (f && ['running', 'paused'].includes(f.status)) {
    const total = f.mapsQ.length || 1;
    const q = f.mapsQ[Math.min(f.mapsI, total - 1)];
    lines.push(`${f.status === 'running' ? '<span class="pulse"></span>' : ''}<span class="t">${f.status === 'paused' ? 'Paused: ' : ''}Google Maps · ${esc(f.niche)} · search ${Math.min(f.mapsI + 1, total)} of ${total}${q ? ` <span class="muted">“${esc(q.q)}”</span>` : ''}</span>
      <span class="bar"><i style="width:${Math.min(100, Math.round((100 * f.mapsI) / total))}%"></i></span>
      <button class="btn sm" data-act="${f.status === 'running' ? 'finder-pause' : 'finder-resume'}">${f.status === 'running' ? 'Pause' : 'Resume'}</button>
      <button class="btn sm danger" data-act="finder-stop">Stop</button>${runStats(f)}`);
  } else if (f && S.view === 'find') {
    lines.push(`<span class="t">Last Google Maps run: ${esc(f.niche)} · ${plural(f.mapsI || 0, 'search', 'searches')} · ${esc(f.status)}</span>${runStats(f) || `<span class="m">${f.added} new businesses</span>`}${f.mapsNote && !S.alerts.maps ? `<span class="err" style="margin:0">Google Maps: ${esc(f.mapsNote)}</span>` : ''}`);
  }
  const h = S.hunt;
  if (h && h.status === 'running') {
    lines.push(`<span class="pulse"></span><span class="t">Ad Library · “${esc(h.keywords[h.index] || '')}”</span>
      <span class="m">word ${h.index + 1} of ${h.keywords.length} · <b class="num">${h.collected}</b> / ${h.target} advertisers</span>
      <span class="bar"><i style="width:${Math.min(100, Math.round((100 * h.collected) / h.target))}%"></i></span>
      <button class="btn sm" data-act="show-hunt-tab">Show tab</button>
      <button class="btn sm danger" data-act="stop-hunt">Stop</button>`);
  }
  // A login wall, checkpoint or block paused a source: say so and leave it to you.
  for (const [src, a] of Object.entries(S.alerts)) {
    if (['reddit', 'facebook', 'linkedin', 'ai'].includes(src)) continue; // shown on the Intent tab
    const resume = { maps: 'finder-resume', instagram: 'ig-resume', fbpage: 'fbemail-resume', verify: 'verify-resume', adlib: 'alert-clear' }[src] || 'alert-clear';
    const link = a.url ? ` <a href="${esc(safeHref(a.url))}" target="_blank" rel="noopener noreferrer">Open it</a>.` : '';
    lines.push(`<span class="err alert" style="margin:0" data-alert="${esc(src)}"><b>${esc(SOURCE_LABEL[src] || src)} paused:</b> ${esc(a.text)}. ${esc(a.hint || 'Sort it out, then press Resume.')}${link} Nothing tries to get past it.</span><button class="btn sm" data-act="${resume}" data-source="${esc(src)}">${resume === 'alert-clear' ? 'Dismiss' : 'Resume'}</button>`);
  }
  const busy = [];
  if (S.queue.length) busy.push(`checking ${plural(S.queue.length, 'website')}`);
  if (S.checkQ.length) busy.push(`checking the email domains of ${plural(S.checkQ.length, 'business', 'businesses')}`);
  if (S.settings.verifyKey) {
    const used = S.verifyUsage && S.verifyUsage.day === new Date().toISOString().slice(0, 10) ? S.verifyUsage.count : 0;
    const waiting = S.verifyWait && S.verifyWait.until > Date.now();
    if (S.mailQ.length) busy.push(`${plural(S.mailQ.length, 'business', 'businesses')} waiting for a mailbox check${waiting ? ` (${esc(S.verifyWait.why || 'waiting')}; it carries on by itself)` : ''}`);
    if (S.mailQ.length || used) busy.push(`mailbox checks today: ${used} of ${Number(S.settings.verifyDailyCap) || 0}`);
  }
  if (busy.length) lines.push(`<span class="m">${S.queue.length || S.checkQ.length ? '<span class="spin"></span> ' : ''}${busy.join(' · ')}</span>`);
  if (S.view === 'leads' && !S.settings.verifyKey && S.leads.size)
    lines.push(`<span class="m">Mailbox checks are off, so addresses are only checked as far as their domain. <button class="linkish" data-goto="settings" data-anchor="verify">Add a free key</button> for the lowest bounce rate.</span>`);
  el.hidden = !lines.length;
  el.innerHTML = lines.map((x) => `<div class="strip-line">${x}</div>`).join('');
}

function renderFilterOptions() {
  const st = $('[data-f="status"]');
  if (!st.options.length) st.innerHTML = `<option value="">Open leads</option><option value="all">All statuses</option>` + LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  const bulk = $('[data-bulk-status]');
  if (!bulk.options.length) bulk.innerHTML = `<option value="">Set status…</option>` + LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  const count = new Map();
  for (const l of S.leads.values()) {
    const n = LH.nicheOf(l, S.settings);
    if (n) count.set(n, (count.get(n) || 0) + 1);
  }
  const sel = $('[data-f="niche"]');
  const key = [...count.entries()].map(([k, n]) => `${k}:${n}`).join('|');
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.innerHTML = `<option value="">Any kind of business</option>` + [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k)}" ${k === S.filters.niche ? 'selected' : ''}>${esc(k)} (${n})</option>`).join('');
  }
}

const EMPTY_TEXT = {
  fits: 'Nothing fits yet. A business fits when there is proof it just opened and it has no working website, or when its website is down or parked. Choose "Everything found" to see what was found.',
  ready: 'No business that fits has an email that passed its checks yet.',
  needemail: 'Every business that fits has a usable email.',
  new: 'No business with proof that it just opened yet.',
  site: 'No business with a website that is down or parked yet.',
  checking: 'Nothing is being checked right now.',
  nofit: 'Nothing here.',
  all: 'No leads match these filters.',
};
function renderTable() {
  const rows = filtered();
  const shown = rows.slice(0, S.limit);
  $('[data-rows]').innerHTML = shown.map(rowHtml).join('');
  const empty = $('[data-empty]');
  empty.hidden = rows.length > 0 || S.leads.size === 0;
  empty.textContent = EMPTY_TEXT[S.filters.show] || EMPTY_TEXT.all;
  $('[data-count]').innerHTML = S.leads.size
    ? `Showing ${shown.length} of ${rows.length}${rows.length !== S.leads.size ? ` (${S.leads.size} found in all)` : ''}.` +
      (rows.length > shown.length ? ` <button class="btn sm" data-act="more-rows">Show ${Math.min(ROWS_STEP, rows.length - shown.length)} more</button>` : '') +
      (S.filters.hunt ? ` Only one Ad Library search. <button class="btn sm ghost" data-act="clear-hunt-filter">Show all</button>` : '')
    : '';
  const ids = shown.map((r) => r.l.id);
  const all = $('[data-sel-all]');
  all.checked = ids.length > 0 && ids.every((id) => S.selected.has(id));
  all.indeterminate = !all.checked && ids.some((id) => S.selected.has(id));
  $('[data-bulk]').hidden = S.selected.size === 0;
  $('[data-bulk-count]').textContent = `${S.selected.size} selected`;
  $('[data-welcome]').hidden = S.leads.size > 0;
  $('[data-toolbar]').hidden = S.leads.size === 0;
  $('[data-table]').hidden = S.leads.size === 0;
}

function renderAll() {
  renderKpis();
  renderStrip();
  if (S.view === 'leads') {
    renderFilterOptions();
    renderTable();
  }
  if (S.view === 'find') renderLastHunt();
  if (S.view === 'settings') renderVerifyStatus();
  if (S.view === 'intent') renderIntentView();
  if (S.openId) renderDrawer();
}

/* ---------------------------------------------------------------- drawer */
function openDrawer(id) {
  const l = S.leads.get(id);
  if (!l) return;
  S.openId = id;
  renderDrawer(true);
  $('[data-scrim]').hidden = false;
  const d = $('[data-drawer]');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  d.focus();
}
function closeDrawer() {
  S.openId = null;
  $('[data-scrim]').hidden = true;
  const d = $('[data-drawer]');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
}
/** The open lead's panel. While you type in it, only the parts you are not typing in are refreshed. */
function renderDrawer(fresh = false) {
  const l = S.leads.get(S.openId);
  const d = $('[data-drawer]');
  if (!l) return closeDrawer();
  const active = document.activeElement;
  const editing = active && d.contains(active) && /TEXTAREA|INPUT/.test(active.tagName);
  if (editing && !fresh) {
    for (const [sel, html] of [['[data-fit-sec]', fitSection(l)], ['[data-email-sec]', emailSection(l)], ['[data-site-sec]', siteSection(l)], ['[data-contact-sec]', contactSection(l)]]) {
      const el = $(sel, d);
      if (el && !el.contains(active)) el.outerHTML = html;
    }
    return;
  }
  const keep = { notes: $('[data-notes]', d) && !fresh ? $('[data-notes]', d).value : null, scroll: fresh ? 0 : d.scrollTop };
  d.innerHTML = drawerHtml(l);
  if (keep.notes != null && keep.notes !== (l.notes || '')) $('[data-notes]', d).value = keep.notes;
  d.scrollTop = keep.scroll;
}

const SIGNAL_FROM = { google: 'Google Maps', soon: 'Google Maps', ad: 'Their ad', caption: 'Their Instagram post', newig: 'Their Instagram', post: 'Their post', bio: 'Their Instagram bio (a hint, not proof)' };
/** Does it fit and why, every sign that it just opened, and your own say. */
function fitSection(l) {
  const fs = LH.fitScore(l, S.settings);
  const f = fs.fit;
  const signals = [...(l.openSignals || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const list = signals
    .map((s) => `<li><b>${esc(SIGNAL_FROM[s.kind] || s.kind)}:</b> “${esc(s.text)}” <span class="muted">${esc(fmtDate(s.openedAt || s.opensAt || s.at))}</span>${s.url ? ` <a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">see it ↗</a>` : ''}</li>`)
    .join('');
  const mine = l.justOpened === true ? 'yes' : l.justOpened === false ? 'no' : '';
  return `<section class="d-sec fit-sec" data-fit-sec><h3>Does it fit?</h3>
    <p class="verdict ${f.fit ? 'yes' : f.pending ? 'wait' : 'no'}">${scoreBadge(fs)} <b>${f.fit ? 'Fits' : f.pending ? 'Not known yet' : 'Does not fit'}</b> · ${esc(f.why)}</p>
    ${list ? `<ul class="signals">${list}</ul>` : '<p class="muted">Nothing found that says they just opened.</p>'}
    <label class="field" style="margin-top:8px"><span class="lbl">Just opened? <small>your own say beats everything above</small></span>
      <select class="inp" data-just-opened>
        <option value="" ${mine === '' ? 'selected' : ''}>Go by what was found</option>
        <option value="yes" ${mine === 'yes' ? 'selected' : ''}>Yes, they just opened</option>
        <option value="no" ${mine === 'no' ? 'selected' : ''}>No, they are not new</option>
      </select></label>
  </section>`;
}

const EMAIL_FROM = { facebook: 'their Facebook page', instagram: 'their Instagram', manual: 'you', website: 'their website', ad: 'their ad' };
function coldEmailNote(l) {
  if (['replied', 'meeting', 'won', 'lost', 'skip'].includes(l.status)) return 'Their status says you are talking to them or closed them, so they stay out of the cold email file.';
  if (l.doNotEmail) return 'Never email is on, so they stay out of the cold email file.';
  if ((l.emailQueue || {}).sent >= 1) return "Lead Hunter's old email sender already emailed them, so they stay out of the cold email file.";
  const f = LH.fit(l, S.settings);
  if (!f.fit) return `${f.why}, so they stay out of the cold email file.`;
  const mail = LH.sendableEmail(l, S.settings);
  if (!mail.email) return { none: 'No email found yet', bad: 'Every address failed its check', waiting: 'Their email is still being checked', risky: 'The mailbox check could not confirm their email' }[mail.why] + ', so they stay out of the cold email file.';
  if (l.coldEmailExportedAt) return `Exported for cold email on ${fmtDate(l.coldEmailExportedAt)} with ${mail.email}. Tick Include already exported to export them again.`;
  return `They go in the next Export for cold email, with ${mail.email}.`;
}
function fbEmailRow(l) {
  if (!LH.facebookPageUrl(l) || LH.goodEmails(l)[0]) return '';
  const f = l.fbEmail || {};
  const said = f.state === 'queued' ? 'Looking on their Facebook page…' : f.state === 'none' ? `No email on their Facebook page (${fmtDate(f.at)}).` : f.state === 'error' ? `Their Facebook page did not load (${fmtDate(f.at)}).` : '';
  return `<div class="row">${said ? `<span class="muted">${esc(said)}</span>` : ''}${f.state === 'queued' ? '' : '<button class="btn sm" data-act="fb-email">Look on their Facebook page</button>'}</div>`;
}
/** Every address found, what its checks said, and whether the lead goes in the cold email file. */
function emailSection(l) {
  const info = LH.emailInfo(l);
  const rows = info
    .map((x) => {
      const said = [x.why, x.fixed && `typo fixed (${x.fixed})`, x.from && `from ${EMAIL_FROM[x.from] || x.from}`].filter(Boolean).join(' · ');
      return `<div class="email-row ${x.state}"><span class="addr">${esc(x.email)}</span>${stateChip(x)}
        <span class="muted why">${esc(said)}</span>
        <button class="btn sm ghost" data-copy="${esc(x.email)}">Copy</button>
        ${x.state === 'bad' ? '' : `<button class="btn sm ghost" data-bad-email="${esc(x.email)}" title="It bounced: never use it again">Bounced</button>`}
        <button class="btn sm ghost" data-remove-email="${esc(x.raw)}" aria-label="Remove address">✕</button></div>`;
    })
    .join('');
  return `<section class="d-sec email-sec" data-email-sec><h3>Email</h3>
    ${rows ? `<div class="emails">${rows}</div>` : '<p class="muted">No email found yet.</p>'}
    <p class="muted" data-cold-note>${esc(coldEmailNote(l))}</p>
    ${fbEmailRow(l)}
    <form class="inline-form" data-add-email><input class="inp" name="email" placeholder="Know their email? Add it here" inputmode="email" /><button class="btn sm" type="submit">Add</button></form>
    <div class="row">${info.some((x) => ['unchecked', 'unverified'].includes(x.state)) ? '<button class="btn sm" data-act="check-email">Check now</button>' : ''}<button class="linkish" data-act="never-email">${l.doNotEmail ? 'Allow email again' : 'Never email'}</button></div>
  </section>`;
}

function siteSection(l) {
  const site = l.site || {};
  const own = LH.ownWebsite(l);
  const state = LH.siteState(l);
  const setForm = `<form class="inline-form" data-set-website><input class="inp" name="website" placeholder="${own ? 'Wrong website? Paste the right one' : 'Know their website? Paste it here'}" /><button class="btn sm" type="submit">Check it</button></form>`;
  let body;
  if (!own) body = `<p>${['queued', 'running'].includes(site.state) ? '<span class="spin"></span> Looking for a website… ' : ''}No website of their own found.${l.website ? ` Their link goes to ${esc(LH.domainOf(l.website))}, which is not a website of their own.` : ''}</p>`;
  else if (['queued', 'running'].includes(site.state)) body = `<p><span class="spin"></span> Checking ${esc(LH.domainOf(own))}…</p>`;
  else {
    const said = {
      down: `It does not load${site.status ? ` (${esc(site.status)})` : ''}. They meant to have a website and it is gone.`,
      parked: 'It only shows a parking, "coming soon" or default page. They bought the name and never built the site.',
      working: 'It loads and is a real website, so they do not fit.',
      blocked: `${esc(site.note || 'The site blocked the automatic check.')} Open it and judge for yourself.`,
      unknown: 'Not checked yet.',
    }[state];
    const [cls, label] = SITE_TAG[state];
    body = `<div class="site-head"><a href="${esc(safeHref(site.finalUrl || l.landingUrl || own))}" target="_blank" rel="noopener noreferrer">${esc(LH.domainOf(site.finalUrl || own))}</a><span class="tag ${cls}">${esc(label)}</span></div>
      <p>${said}${l.websiteSource === 'email' ? ' <span class="muted">(Nobody listed this website: it is the domain of their email address.)</span>' : ''}</p>
      <div class="kv">${[site.builder && `<span>Built with <b>${esc(site.builder)}</b></span>`, site.checkedAt && `<span>Checked <b>${esc(fmtDate(site.checkedAt))}</b></span>`].filter(Boolean).join('')}</div>`;
  }
  return `<section class="d-sec" data-site-sec><h3>Website</h3>${body}${setForm}${own ? '<div class="row"><button class="btn sm" data-act="recheck">Check again</button></div>' : ''}</section>`;
}

function contactSection(l) {
  const country = LH.country(l.countries[0] || S.settings.country);
  const q = encodeURIComponent(`${l.pageName} ${l.area || (country.code !== 'ALL' ? country.name : '')}`.trim());
  const SRC = { 'whatsapp-ad': 'WhatsApp ad', 'whatsapp-site': 'WhatsApp on site', 'whatsapp-ig': 'WhatsApp on Instagram', instagram: 'Instagram', website: 'website', 'call-ad': 'call ad', google: 'Google', 'ad-text': 'ad text', manual: 'added by you' };
  const phones = l.phones.length
    ? `<div class="phones">${l.phones
        .map(
          (p) => `<div class="phone"><span class="num">${esc(LH.formatPhone(p.number))}</span><span class="src">${esc(SRC[p.source] || p.source)}</span>
          <button class="btn sm ghost" data-copy="${esc(p.number)}">Copy</button>
          <button class="btn sm ghost" data-remove-phone="${esc(p.number)}" aria-label="Remove number">✕</button></div>`,
        )
        .join('')}</div>`
    : `<p class="muted">No phone number found yet.</p>`;
  const ig = LH.igHandle(l);
  const st = l.igStats || {};
  const igReady = S.settings.igToken && S.settings.igAccountId;
  let igLine = '';
  if (ig) {
    const read = st.error
      ? 'the API could not read it (personal accounts cannot be looked up)'
      : st.at
        ? [st.followers != null && `${compactNum(st.followers)} followers`, st.media != null && plural(st.media, 'post'), st.lastPostAt && `last post ${fmtDate(st.lastPostAt)}`, st.firstPostAt && `first post ${fmtDate(st.firstPostAt)}`].filter(Boolean).join(' · ')
        : 'not read yet';
    igLine = `<p>Instagram: <a href="https://www.instagram.com/${esc(encodeURIComponent(ig))}/" target="_blank" rel="noopener noreferrer">@${esc(ig)}</a> <span class="muted">${esc(read)}</span> ${igReady ? `<button class="btn sm ghost" data-act="ig-lookup">${st.at ? 'Read again' : 'Read it'}</button>` : ''}</p>`;
  }
  const socials = Object.entries(l.socials || {})
    .filter(([k]) => !(ig && k === 'instagram'))
    .map(([k, u]) => `<a href="${esc(safeHref(u))}" target="_blank" rel="noopener noreferrer">${esc(k)}</a>`)
    .join(' · ');
  const pl = l.places;
  const places = pl && pl.match ? `<p>Google: <b>${esc(pl.name)}</b>${pl.rating ? ` · ★ ${esc(pl.rating)} (${esc(pl.reviews || 0)} reviews)` : ''}</p>` : pl && pl.error ? `<p class="err">${esc(pl.error)}</p>` : pl ? `<p class="muted">No confident match on Google Maps.</p>` : '';
  return `<section class="d-sec" data-contact-sec><h3>Contact</h3>
    ${phones}
    ${igLine}
    ${socials ? `<p>Profiles: ${socials}</p>` : ''}
    ${places}
    <form class="inline-form" data-add-phone><input class="inp" name="phone" placeholder="Add a phone / WhatsApp number" inputmode="tel" /><button class="btn sm" type="submit">Add</button></form>
    <div class="row">
      ${S.settings.placesKey && l.kind !== 'prospect' ? `<button class="btn sm" data-act="places">Look up on Google Maps</button>` : ''}
      <a class="btn sm ghost" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">Google ↗</a>
      <a class="btn sm ghost" href="https://www.google.com/maps/search/${q}" target="_blank" rel="noopener noreferrer">Maps ↗</a>
    </div>
  </section>`;
}

const VIA = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'Email', export: 'an export', 'cold-email': 'the cold email file', import: 'your imported contacts' };
/** When and how they were contacted, Mark contacted with the channel, and Reset. */
function contactedRow(l) {
  const reset = `<button class="btn sm ghost" data-act="reset-contacted" title="Make this business new again, so future searches can find it">Reset</button>`;
  const mark = ['whatsapp', 'instagram', 'email'].map((v) => `<button class="btn sm ${l.contactedVia === v ? 'on' : ''}" data-act="mark-via" data-via="${v}">${VIA[v]}</button>`).join('');
  if (l.contactedAt) return `<div class="row contacted-row"><span class="muted">Contacted ${esc(fmtDate(l.contactedAt))}${VIA[l.contactedVia] ? ` on ${esc(VIA[l.contactedVia])}` : ''}. Channel:</span>${mark}${reset}</div>`;
  const hit = contactedBefore(l);
  const before = hit ? `<span class="tag red">Contacted before${hit.at ? ` ${esc(fmtDate(hit.at))}` : ''}${VIA[hit.via] ? ` · ${esc(VIA[hit.via])}` : ''}</span>${reset}` : '';
  return `<div class="row contacted-row">${before}<span class="muted">Mark contacted yourself:</span>${mark}</div>`;
}

function drawerHtml(l) {
  const m = (l.sources || {}).maps || null;
  const ig = (l.sources || {}).instagram || null;
  const niche = LH.nicheOf(l, S.settings);
  const fb = LH.facebookPageUrl(l);
  const links = [
    m && m.mapsUrl && `<a href="${esc(safeHref(m.mapsUrl))}" target="_blank" rel="noopener noreferrer">Google Maps</a>`,
    LH.igHandle(l) && `<a href="https://www.instagram.com/${esc(encodeURIComponent(LH.igHandle(l)))}/" target="_blank" rel="noopener noreferrer">@${esc(LH.igHandle(l))}</a>`,
    fb && `<a href="${esc(safeHref(fb))}" target="_blank" rel="noopener noreferrer">Facebook page</a>`,
    l.kind !== 'prospect' && `<a href="${esc(safeHref(LH.pageAdsUrl(l.pageId, l.countries[0] || 'ALL', l.pageName)))}" target="_blank" rel="noopener noreferrer">Their ads</a>`,
    niche && `<span>${esc(niche)}</span>`,
  ].filter(Boolean);
  const ads = Object.values(l.ads || {}).sort((a, b) => Number(b.active) - Number(a.active) || (b.start || 0) - (a.start || 0));
  const about = [ig && ig.bio && `<p class="bio">${esc(ig.bio)}</p>`, m && m.address && `<p class="muted">${esc(m.address)}</p>`, m && (m.rating || m.reviews) && `<p class="muted">${m.rating ? `★ ${esc(m.rating)} · ` : ''}${esc(plural(m.reviews || 0, 'Google review'))}</p>`, (l.categories || []).length && `<p class="muted">${esc(l.categories.join(', '))}</p>`].filter(Boolean).join('');
  return `
    <header class="d-head">${avatar(l)}
      <div style="min-width:0"><h2>${esc(l.pageName || 'Unknown')}</h2><div class="links">${links.join('')}</div></div>
      <button class="btn sm ghost x" data-act="close" aria-label="Close">✕</button>
    </header>
    <section class="d-sec">
      <div class="row" style="margin-top:0">
        <label class="lbl" for="d-status">Status</label>
        <select id="d-status" class="status-sel" data-status>${statusOptions(l.status)}</select>
        <span class="muted">Found ${esc(fmtDate(l.createdAt))} on ${esc(foundOn(l))}${l.area ? ` in ${esc(l.area)}` : ''}</span>
      </div>
      ${contactedRow(l)}
    </section>
    ${fitSection(l)}
    ${emailSection(l)}
    ${siteSection(l)}
    ${contactSection(l)}
    ${about ? `<section class="d-sec"><h3>About</h3>${about}</section>` : ''}
    <section class="d-sec"><h3>Notes</h3><textarea class="inp" rows="3" data-notes placeholder="Who you spoke to, what they said…">${esc(l.notes || '')}</textarea></section>
    ${
      ads.length
        ? `<section class="d-sec"><h3>Their ads (${ads.length})</h3><div class="ads">${ads
            .slice(0, 8)
            .map(
              (a) => `<div class="ad"><div class="meta"><span class="tag ${a.active ? '' : 'red'}">${a.active ? 'Active' : 'Inactive'}</span>${a.start ? `<span>Started ${esc(fmtDate(a.start))}</span>` : ''}</div>
              ${a.body ? `<p>${esc(a.body)}</p>` : ''}
              <div class="lnk"><a href="https://www.facebook.com/ads/library/?id=${esc(encodeURIComponent(a.id))}" target="_blank" rel="noopener noreferrer">View ad ↗</a></div></div>`,
            )
            .join('')}</div></section>`
        : ''
    }
    <section class="d-sec"><div class="row" style="margin:0"><button class="btn sm danger" data-act="delete-lead">Delete</button></div></section>`;
}

/* --------------------------------------------------------------- actions */
let toastTimer = 0;
function toast(text, undo) {
  const t = $('[data-toast]');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button data-undo>Undo</button>' : ''}`;
  t.hidden = false;
  if (undo) $('[data-undo]', t).onclick = () => (undo(), (t.hidden = true));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 4200);
}
const update = (id, patch) => send({ type: 'lead:update', id, patch });
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Could not copy. Select the text and copy it manually.');
  }
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const selectedLeads = () => [...S.selected].map((id) => S.leads.get(id)).filter(Boolean);

/** Everything shown, as a spreadsheet: who they are, whether they fit and why, and what the email checks said. */
function exportCsv(leads) {
  if (!leads.length) return toast('Nothing to export.');
  const head = ['business', 'fits', 'why', 'proof_they_opened', 'score', 'website', 'website_state', 'email', 'email_check', 'other_emails', 'removed_emails', 'phone', 'whatsapp_link', 'instagram', 'instagram_followers', 'kind', 'area', 'found_on', 'google_rating', 'google_reviews', 'google_maps', 'facebook_page', 'status', 'exported_for_cold_email', 'notes', 'found'];
  const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
  const rows = leads.map((l) => {
    const r = facts(l);
    const best = LH.bestPhone(l);
    const wa = LH.whatsappTarget(l);
    const m = (l.sources || {}).maps || {};
    const main = r.info.find((x) => x.email === r.mail.email) || r.info.find((x) => x.state !== 'bad');
    return [
      l.pageName,
      r.fit.fit ? 'yes' : r.fit.pending ? 'not known yet' : 'no',
      r.fit.why,
      r.fit.open ? r.fit.open.label : '',
      r.fs.score,
      LH.ownWebsite(l),
      r.fit.site,
      main ? main.email : '',
      main ? EMAIL_STATE[main.state] : '',
      r.info.filter((x) => x !== main && x.state !== 'bad').map((x) => x.email).join('; '),
      r.info.filter((x) => x.state === 'bad').map((x) => `${x.email} (${x.why})`).join('; '),
      best ? LH.formatPhone(best.number) : '',
      wa ? LH.waLink(wa) : '',
      LH.igHandle(l) ? `https://www.instagram.com/${LH.igHandle(l)}/` : '',
      (l.igStats || {}).followers ?? '',
      r.niche,
      l.area || '',
      foundOn(l),
      m.rating || (l.places || {}).rating || '',
      m.reviews ?? (l.places || {}).reviews ?? '',
      m.mapsUrl || '',
      LH.facebookPageUrl(l) || '',
      (LH.STATUSES.find((s) => s.id === l.status) || {}).label || l.status,
      day(l.coldEmailExportedAt),
      l.notes || '',
      day(l.createdAt),
    ];
  });
  download(`lead-hunter-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + LH.toCsv([head, ...rows]), 'text/csv;charset=utf-8');
  toast(`${plural(leads.length, 'lead')} saved as a spreadsheet`);
}

/* Export for cold email: the leads for the cold email system, saved with Chrome's Save As so the file can go
   straight into the RizcoReach Leads folder (Chrome remembers the folder). Leads are marked exported once the file
   is saved; cancel the dialog and nothing is marked. */
async function exportColdEmail(list) {
  const r = LH.coldEmailExport(list, S.settings, { includeExported: S.coldInclude });
  const k = r.skipped;
  const out = [
    k.waiting && `${k.waiting} whose email is still being checked`,
    k.noEmail && `${k.noEmail} without an email`,
    k.badEmail && `${k.badEmail} whose email failed its check`,
    k.risky && `${k.risky} whose email could not be confirmed`,
    k.working && `${k.working} with a working website`,
    k.noProof && `${k.noProof} with no proof they just opened`,
    k.siteUnknown && `${k.siteUnknown} whose website could not be judged`,
    k.exported && `${k.exported} exported before`,
    k.closed && `${k.closed} replied, closed or skipped`,
    k.emailedBefore && `${k.emailedBefore} emailed by the old sender`,
  ].filter(Boolean);
  if (r.waiting.length) send({ type: 'verify:check', ids: r.waiting }); // their turn first
  if (!r.rows.length) return toast(`No leads for cold email${out.length ? `: ${out.join(', ')}` : ''}.`);
  const url = URL.createObjectURL(new Blob([`﻿${LH.toCsv([r.head, ...r.rows])}\r\n`], { type: 'text/csv;charset=utf-8' }));
  let id;
  try {
    id = await chrome.downloads.download({ url, filename: LH.coldEmailFilename(), saveAs: true, conflictAction: 'uniquify' });
  } catch (e) {
    URL.revokeObjectURL(url);
    return toast(`Could not save the file: ${e.message || e}`);
  }
  const done = async (d) => {
    if (d.id !== id || !d.state || !['complete', 'interrupted'].includes(d.state.current)) return;
    chrome.downloads.onChanged.removeListener(done);
    URL.revokeObjectURL(url);
    if (d.state.current !== 'complete') return toast('The file was not saved, so nothing was marked as exported.');
    await send({ type: 'cold:exported', ids: r.ids });
    toast(`${plural(r.rows.length, 'lead')} saved for cold email${out.length ? ` · left out: ${out.join(', ')}` : ''}`);
  };
  chrome.downloads.onChanged.addListener(done);
  toast(`${plural(r.rows.length, 'lead')} ready. Save the file in your RizcoReach Leads folder.`);
}

/* ----------------------------------------------------------------- views */
const VIEWS = ['leads', 'find', 'intent', 'settings'];
function setView(v) {
  if (S.view !== v) {
    S.selected.clear();
    scrollTo(0, 0); // a tab opens at its top, not where the last one was scrolled to
  }
  S.view = v;
  $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $$('[data-view-panel]').forEach((p) => (p.hidden = p.dataset.viewPanel !== v));
  if (v === 'settings') fillSettings();
  if (v === 'find') renderPresetProgress();
  if (v === 'intent') send({ type: 'intent:seen' }); // the badge count goes once you look
  renderAll();
  try {
    history.replaceState(null, '', `#${v}`);
  } catch {}
}

/* ------------------------------------------------------------------ Find */
function renderPresetChips() {
  const el = $('[data-find-presets]');
  if (!el) return;
  const names = [ALL_TYPES, ...LH.presetsFor(S.settings).map((n) => n.name)];
  if (!names.includes(S.findPreset)) S.findPreset = ALL_TYPES;
  el.innerHTML = names.map((n) => `<button type="button" class="chip ${n === S.findPreset ? 'on' : ''}" data-find-preset="${esc(n)}">${esc(n)}</button>`).join('');
}
function pickPreset(name) {
  const form = $('[data-finder-form]');
  const preset = presetNamed(name);
  S.findPreset = preset ? preset.name : ALL_TYPES;
  $('[data-keywords-field]').hidden = !preset;
  form.keywords.value = preset ? preset.keywords.join('\n') : '';
  $$('[data-find-preset]', form).forEach((c) => c.classList.toggle('on', c.dataset.findPreset === S.findPreset));
  const areas = LH.presetAreas(preset, S.settings);
  const own = preset && LH.parseLines(preset.areas).length;
  $('[data-find-areas]').textContent = preset
    ? `${plural(areas.length, 'area')}${own ? ', this kind\'s own list' : ' (Settings > Areas)'}, from ${areas[0] || ''}`
    : `Every kind of business, area by area: ${plural(areas.length, 'area')} (Settings > Areas), from ${areas[0] || ''}`;
  renderPresetProgress();
}
/** "Salons: 120 of 588 searches done. The next run carries on from there." */
async function renderPresetProgress() {
  const el = $('[data-preset-progress]');
  if (!el) return;
  const name = S.findPreset;
  const r = await send({ type: 'finder:progress' });
  const p = r && r.progress && r.progress[name];
  if (!p || name !== S.findPreset) return (el.textContent = '');
  el.innerHTML = p.done
    ? `${esc(name)}: <b>${p.done}</b> of ${p.total} searches done. The next run carries on from there. <button type="button" class="linkish" data-act="finder-reset">Start over</button>`
    : `${esc(name)}: ${p.total} searches, none run yet.`;
}
function renderLastHunt() {
  const el = $('[data-last-hunt]');
  const h = S.hunt;
  if (!h) return (el.hidden = true);
  const why = { target: 'target reached', keywords: 'every word searched', stopped: 'stopped', blocked: 'Facebook showed a wall', 'tab-closed': 'the tab was closed', replaced: 'replaced by a new search' }[h.finishReason] || h.status;
  el.hidden = false;
  el.innerHTML = `<p class="muted" style="margin:14px 0 6px">${h.status === 'running' ? 'Running now' : 'Last search'} · ${esc(fmtDate(h.startedAt))} · ${h.collected} advertisers · ${esc(h.status === 'running' ? 'running' : why)}</p>
    <div class="kw-list">${h.keywords.map((k, i) => `<span class="tag ${i === h.index && h.status === 'running' ? 'amber' : ''}">${esc(k)} · ${(h.perKeyword || {})[k] || 0}</span>`).join('')}</div>
    <div class="row"><button class="btn sm" data-act="filter-hunt" data-hunt="${esc(h.id)}">Show what it found</button></div>`;
}
function initFind() {
  const form = $('[data-finder-form]');
  renderPresetChips();
  pickPreset(S.findPreset);
  form.addEventListener('click', async (e) => {
    const n = e.target.closest('[data-find-preset]');
    if (n) pickPreset(n.dataset.findPreset);
    if (e.target.closest('[data-act="finder-reset"]')) {
      if (!confirm(`Forget which ${S.findPreset} searches have run? The next run starts from the first one again.`)) return;
      await send({ type: 'finder:reset', preset: S.findPreset });
      renderPresetProgress();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-finder-err]');
    err.hidden = true;
    const fail = (t) => ((err.textContent = t), (err.hidden = false));
    const preset = presetNamed(S.findPreset);
    const keywords = form.keywords.value.split('\n').map((k) => k.trim()).filter(Boolean);
    if (preset && !keywords.length) return fail('Type at least one search term.');
    const res = await send({ type: 'finder:start', config: { niche: S.findPreset, keywords: preset ? keywords : [], cap: form.cap.value } });
    if (!res || res.error) return fail((res && res.error) || 'Could not start the search.');
    toast(`Searching Google Maps ${plural(res.finder.mapsQ.length, 'time')}. Businesses show up on the Leads tab as they are found.`);
    renderPresetProgress();
  });

  const hunt = $('[data-hunt-form]');
  $$('[data-countries]').forEach((s) => (s.innerHTML = LH.COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === S.settings.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')));
  hunt.keywords.value = LH.OPENING_AD_KEYWORDS.join('\n');
  hunt.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-hunt-err]');
    err.hidden = true;
    const keywords = hunt.keywords.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    const fail = (t) => ((err.textContent = t), (err.hidden = false));
    if (!keywords.length) return fail('Add at least one search word.');
    // Only ads that started within the "just opened" window count towards the target; everyone found is saved.
    const res = await send({ type: 'hunt:start', config: { name: 'Opening ads', keywords, country: hunt.country.value, target: hunt.target.value, maxLikes: hunt.maxLikes.value, maxDays: S.settings.newDays } });
    if (!res || res.error) return fail((res && res.error) || 'Could not start the search.');
    toast('The Ad Library opened in a new tab. Advertisers show up on the Leads tab as they are found.');
  });
}

/* -------------------------------------------------------------- Settings */
function nicheRow(n = LH.cleanPreset({})) {
  const list = (attr, label, items, hint) =>
    `<label class="field"><span class="lbl">${label} <small>${items.length ? `${items.length} · ` : ''}${hint}</small></span><textarea class="inp" ${attr} rows="6">${esc(items.join('\n'))}</textarea></label>`;
  return `<details class="tpl preset" data-niche-row ${n.name ? '' : 'open'}>
    <summary><b>${esc(n.name || 'New kind of business')}</b> <span class="muted">${plural(n.keywords.length, 'search term')}${n.areas.length ? ` · ${plural(n.areas.length, 'own area')}` : ''}</span></summary>
    <div class="grid3">
      <label class="field"><span class="lbl">Name</span><input class="inp" data-niche-name value="${esc(n.name)}" placeholder="Florists" /><input type="hidden" data-niche-label value="${esc(n.label)}" /></label>
      <label class="field"><span class="lbl">Min Google reviews</span><input class="inp" type="number" min="0" data-niche-min value="${esc(n.minReviews)}" /></label>
      <label class="field"><span class="lbl">Max Google reviews</span><input class="inp" type="number" min="0" data-niche-max value="${n.maxReviews >= 100000 ? '' : esc(n.maxReviews)}" placeholder="no limit" /></label>
    </div>
    <div class="grid3">${list('data-niche-kw', 'Search terms', n.keywords, 'one per line')}${list('data-niche-ex', 'Exclude words', n.exclude, 'one per line')}${list('data-niche-areas', 'Own areas', n.areas, 'empty = the shared list')}</div>
    <div class="row" style="margin:0"><button type="button" class="btn sm ghost danger" data-act="del-niche">Remove</button></div>
  </details>`;
}
function renderNicheEditor(list) {
  $('[data-niches]').innerHTML = list.map((n) => nicheRow(n)).join('');
}
function readPresetRows(f) {
  return $$('[data-niche-row]', f)
    .map((r) =>
      LH.cleanPreset({
        name: $('[data-niche-name]', r).value,
        label: $('[data-niche-label]', r).value,
        minReviews: $('[data-niche-min]', r).value,
        maxReviews: $('[data-niche-max]', r).value,
        keywords: $('[data-niche-kw]', r).value,
        exclude: $('[data-niche-ex]', r).value,
        areas: $('[data-niche-areas]', r).value,
      }),
    )
    .filter((n) => n.name);
}
/** What to store: only the kinds you changed or added, and the built in ones you removed. */
function readNiches(f) {
  const rows = readPresetRows(f);
  const builtIn = new Map(LH.DEFAULT_PRESETS.map(LH.cleanPreset).map((p) => [p.name.toLowerCase(), p]));
  const names = new Set(rows.map((p) => p.name.toLowerCase()));
  const mine = rows.filter((p) => JSON.stringify(builtIn.get(p.name.toLowerCase()) || null) !== JSON.stringify(p));
  const hidden = [...builtIn.values()].filter((p) => !names.has(p.name.toLowerCase())).map((p) => p.name);
  return { niches: mine.length ? mine : null, hiddenPresets: hidden.length ? hidden : null };
}

function fillSettings() {
  const f = $('[data-settings-form]');
  const s = S.settings;
  for (const el of f.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = s[el.name] ?? '';
  }
  const areas = LH.presetAreas(null, s);
  $('[data-areas]', f).value = areas.join('\n');
  $('[data-areas-count]', f).textContent = `${areas.length} · one per line`;
  renderNicheEditor(LH.presetsFor(s));
  const il = LH.intentListsFor(s);
  $('[data-intent-lists]', f).innerHTML = Object.entries(il.keywords)
    .map(([k, list]) => `<label class="field"><span class="lbl">${esc(LH.INTENT_LABELS[k])} <small>one phrase per line</small></span><textarea class="inp" rows="5" data-intent-kw="${k}">${esc(list.join('\n'))}</textarea></label>`)
    .join('');
  $('[data-seller-words]', f).value = il.seller.join('\n');
  renderHistory();
  renderProblems();
  renderVerifyStatus();
}
/** Settings > Email check: how today's mailbox checks are going. */
async function renderVerifyStatus() {
  const el = $('[data-verify-status]');
  if (!el) return;
  const r = await send({ type: 'verify:status' });
  if (!r) return;
  const parts = [
    r.key ? `Mailbox checks today: ${r.used} of ${r.cap}.` : 'No key yet: addresses are checked as far as their domain.',
    r.mailboxQueued ? `${plural(r.mailboxQueued, 'business', 'businesses')} waiting for a mailbox check.` : '',
    r.wait ? `${r.wait.why}. It carries on by itself.` : '',
    r.alert ? `Paused: ${r.alert.text}.` : '',
    r.bounced ? `${plural(r.bounced, 'bounced address', 'bounced addresses')} remembered.` : '',
  ];
  el.textContent = parts.filter(Boolean).join(' ');
}
/** Settings > Your data: the last problems each source hit. */
function renderProblems() {
  const el = $('[data-problems]');
  if (!el) return;
  const rows = Object.entries(S.problems).filter(([, list]) => list.length);
  el.innerHTML = rows.length
    ? rows.map(([src, list]) => `<div class="problems"><b>${esc(SOURCE_LABEL[src] || src)}</b><ul>${list.slice(0, 5).map(([at, text]) => `<li><span class="muted">${esc(fmtDate(at))}</span> ${esc(text)}</li>`).join('')}</ul></div>`).join('')
    : '<p class="hint">No problems so far.</p>';
}
/** Settings > Your data: how much the contacted memory holds. */
function renderHistory() {
  const el = $('[data-history-count]');
  if (!el) return;
  const keys = Object.keys(S.history);
  const phones = keys.filter((k) => k.startsWith('p:')).length;
  el.textContent = keys.length ? `Remembering ${plural(phones, 'phone number')} and ${keys.length - phones} websites, Instagram handles and names.` : 'Nothing remembered yet.';
}
async function saveSettings() {
  const f = $('[data-settings-form]');
  const next = { ...S.settings };
  for (const el of f.elements) {
    if (!el.name || !(el.name in LH.DEFAULT_SETTINGS)) continue;
    // A number box: empty or not a number keeps the default, 0 is kept (it can mean "off").
    const n = Number(el.value);
    next[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value.trim() === '' || !Number.isFinite(n) ? LH.DEFAULT_SETTINGS[el.name] : n) : el.value.trim();
  }
  next.nameMatch = Math.max(0.8, Math.min(1, Number(next.nameMatch) || LH.DEFAULT_SETTINGS.nameMatch));
  next.newDays = Math.max(14, Math.min(365, Math.round(Number(next.newDays)) || LH.DEFAULT_SETTINGS.newDays));
  // The shared areas: null while it is the built in list, so later additions to that list still arrive.
  const areas = LH.parseLines($('[data-areas]', f).value);
  next.areas = !areas.length || areas.join('\n') === LH.DEFAULT_AREAS.join('\n') ? null : areas.join('\n');
  // Intent Radar lists: only the ones you changed are kept.
  const lists = {};
  for (const el of $$('[data-intent-kw]', f)) if (el.value.trim() !== (LH.INTENT_KEYWORDS[el.dataset.intentKw] || []).join('\n')) lists[el.dataset.intentKw] = el.value.trim();
  next.intentKeywords = Object.keys(lists).length ? lists : null;
  const sellerEl = $('[data-seller-words]', f);
  next.sellerWords = sellerEl.value.trim() === LH.SELLER_WORDS.join('\n') ? null : sellerEl.value.trim();
  Object.assign(next, readNiches(f));
  await chrome.storage.local.set({ settings: next });
  S.settings = next;
  renderPresetChips();
  pickPreset(S.findPreset);
  return next;
}

function initSettings() {
  const f = $('[data-settings-form]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
    const ok = $('[data-saved]');
    ok.hidden = false;
    setTimeout(() => (ok.hidden = true), 1800);
  });
  // Contacted memory: any CSV with phone numbers.
  $('[data-import-history]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const r = await send({ type: 'history:import', text: await file.text(), via: 'import' });
    if (!r || r.error) return toast((r && r.error) || 'Could not read that file.');
    toast(r.found ? `${r.found} phone numbers found, ${r.added} new. Future searches skip them.` : 'No UAE phone numbers found in that file.');
  });
  // Import: same name replaces a kind, new names are added. Nothing is kept until Save.
  $('[data-import-presets]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { presets, skipped } = LH.presetsFromJson(await file.text());
      const names = new Set(presets.map((p) => p.name.toLowerCase()));
      renderNicheEditor([...readPresetRows(f).filter((p) => !names.has(p.name.toLowerCase())), ...presets]);
      toast(`Imported ${presets.length}${skipped ? `, skipped ${skipped} without a name or search terms` : ''}. Press Save settings to keep them.`);
    } catch (err) {
      toast(err.message);
    }
  });
}

/* ------------------------------------------------------------- listeners */
function bind() {
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // Filters
  $$('[data-f]').forEach((el) =>
    el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
      S.filters[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      S.limit = ROWS_STEP;
      renderTable();
    }),
  );

  // Table
  const tbody = $('[data-rows]');
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const l = S.leads.get(tr.dataset.id);
    if (!l) return;
    if (e.target.closest('[data-sel]')) {
      if (e.target.checked) S.selected.add(l.id);
      else S.selected.delete(l.id);
      return renderTable();
    }
    if (e.target.closest('a, select, [data-stop]')) return;
    openDrawer(l.id);
  });
  tbody.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-status]');
    if (sel) update(sel.closest('tr').dataset.id, { status: sel.value });
  });
  $('[data-sel-all]').addEventListener('change', (e) => {
    filtered()
      .slice(0, S.limit)
      .forEach((r) => (e.target.checked ? S.selected.add(r.l.id) : S.selected.delete(r.l.id)));
    renderTable();
  });
  $('[data-bulk-status]').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const ids = [...S.selected];
    for (const id of ids) await update(id, { status: e.target.value });
    toast(`Updated ${plural(ids.length, 'lead')}`);
    e.target.value = '';
  });
  $$('[data-cold-include]').forEach((el) => el.addEventListener('change', () => (S.coldInclude = el.checked)));

  // Every button
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act], [data-goto], [data-copy], [data-remove-phone], [data-remove-email], [data-bad-email]');
    if (!b) return;
    const l = S.openId ? S.leads.get(S.openId) : null;
    if (b.dataset.goto) {
      closeDrawer();
      setView(b.dataset.goto);
      const t = b.dataset.anchor && document.getElementById(b.dataset.anchor);
      if (t) t.scrollIntoView({ block: 'start' });
      return;
    }
    if (b.dataset.copy) return copy(b.dataset.copy);
    if (b.dataset.removePhone && l) return update(l.id, { removePhone: b.dataset.removePhone });
    if (b.dataset.removeEmail && l) return update(l.id, { removeEmail: b.dataset.removeEmail });
    if (b.dataset.badEmail && l) {
      await update(l.id, { badEmail: b.dataset.badEmail });
      await send({ type: 'emails:bounced', text: b.dataset.badEmail });
      return toast(`${b.dataset.badEmail} will never be used again`);
    }
    const act = b.dataset.act;
    if (await intentAction(act, b)) return;
    switch (act) {
      case 'close':
        return closeDrawer();
      case 'more-rows':
        S.limit += ROWS_STEP;
        return renderTable();
      case 'export-cold':
        return exportColdEmail(filtered({ withExported: S.coldInclude }).map((r) => r.l));
      case 'bulk-cold':
        return exportColdEmail(selectedLeads());
      case 'export-csv':
        return exportCsv(filtered().map((r) => r.l));
      case 'bulk-export':
        return exportCsv(selectedLeads());
      case 'bulk-recheck':
        await send({ type: 'lead:recheck', ids: [...S.selected] });
        return toast(`Checking ${plural(S.selected.size, 'website')} again`);
      case 'bulk-emails':
        await send({ type: 'verify:check', ids: [...S.selected] });
        return toast(`Checking the emails of ${plural(S.selected.size, 'lead')}`);
      case 'bulk-ig': {
        const r = await send({ type: 'ig:lookup', ids: [...S.selected] });
        return toast(r && r.error ? r.error : `Reading ${plural(r.queued, 'Instagram account')}${r.noHandle ? `. ${r.noHandle} have no Instagram` : ''}`);
      }
      case 'bulk-delete': {
        const ids = [...S.selected];
        if (!confirm(`Delete ${plural(ids.length, 'lead')}? They may be found again in a later search.`)) return;
        await send({ type: 'lead:delete', ids });
        S.selected.clear();
        return toast(`Deleted ${plural(ids.length, 'lead')}`);
      }
      case 'bulk-clear':
        S.selected.clear();
        return renderTable();
      // What is running
      case 'finder-stop':
        await send({ type: 'finder:stop' });
        toast('Stopped. The searches that ran are remembered, so the next run carries on from there.');
        return renderPresetProgress();
      case 'finder-pause':
        await send({ type: 'finder:pause' });
        return toast('Paused after the current search. Press Resume to carry on.');
      case 'finder-resume':
        return send({ type: 'finder:resume' });
      case 'stop-hunt':
        await send({ type: 'hunt:stop' });
        return toast('Ad Library search stopped');
      case 'show-hunt-tab':
        if (S.hunt && S.hunt.tabId) chrome.tabs.update(S.hunt.tabId, { active: true }).catch(() => toast('That tab is closed'));
        return;
      case 'filter-hunt':
        S.filters.hunt = b.dataset.hunt;
        S.filters.show = 'all';
        $('[data-f="show"]').value = 'all';
        return setView('leads');
      case 'clear-hunt-filter':
        S.filters.hunt = '';
        return renderAll();
      case 'hunt-words':
        $('[data-hunt-form]').keywords.value = LH.OPENING_AD_KEYWORDS.join('\n');
        return;
      case 'ig-resume':
        await send({ type: 'ig:resume' });
        return toast('Instagram lookups resumed');
      case 'fbemail-resume':
        await send({ type: 'fbemail:resume' });
        return toast('Facebook page lookups resumed');
      case 'alert-clear':
        return send({ type: 'alert:clear', source: b.dataset.source });
      // Settings
      case 'verify-test': {
        const out = $('[data-verify-test]');
        out.textContent = 'Asking QuickEmailVerification…';
        out.className = 'hint';
        await saveSettings();
        const r = await send({ type: 'verify:test' });
        out.textContent = !r ? 'Lead Hunter did not answer. Reload the extension.' : r.error ? `Not working: ${r.error}` : 'Working. Mailbox checks are on, and only confirmed addresses go into the cold email file.';
        out.className = `hint ${r && !r.error ? 'ok' : 'err'}`;
        return renderVerifyStatus();
      }
      case 'verify-resume': {
        const r = await send({ type: 'verify:resume' });
        toast(r && r.queued ? `Checking the emails of ${plural(r.queued, 'lead')}` : 'No email is waiting for a check');
        return renderVerifyStatus();
      }
      case 'bounces-add': {
        const box = $('[data-bounces]');
        const r = await send({ type: 'emails:bounced', text: box.value });
        $('[data-bounces-out]').textContent = !r || !r.found ? 'No email address found in that text.' : `${plural(r.found, 'address', 'addresses')} remembered${r.leads ? `, found on ${plural(r.leads, 'lead')} here` : ''}. They will never be exported.`;
        if (r && r.found) box.value = '';
        return renderVerifyStatus();
      }
      case 'areas-reset':
        $('[data-areas]').value = LH.DEFAULT_AREAS.join('\n');
        return toast('Back to the built in areas. Save to keep them.');
      case 'add-niche': {
        $('[data-niches]').insertAdjacentHTML('beforeend', nicheRow());
        const rows = $$('[data-niche-row]');
        return $('[data-niche-name]', rows[rows.length - 1]).focus();
      }
      case 'del-niche':
        return b.closest('[data-niche-row]').remove();
      case 'export-presets':
        return download(`lead-hunter-presets-${new Date().toISOString().slice(0, 10)}.json`, LH.presetsToJson(readPresetRows($('[data-settings-form]'))), 'application/json');
      case 'reset-niches':
        renderNicheEditor(LH.DEFAULT_PRESETS.map(LH.cleanPreset));
        return toast(`Back to the ${LH.DEFAULT_PRESETS.length} built in kinds. Save to keep them.`);
      case 'ig-test': {
        await saveSettings();
        const r = await send({ type: 'ig:test' });
        const out = $('[data-ig-test]');
        out.textContent = !r ? 'Lead Hunter did not answer. Reload the extension.' : r.error ? `Not working: ${r.error}` : `Working: @${r.username}, ${r.followers} followers.`;
        out.className = `hint ${r && !r.error ? 'ok' : 'err'}`;
        return;
      }
      case 'ai-test': {
        await saveSettings();
        const out = $('[data-ai-test]');
        out.textContent = 'Asking the AI…';
        out.className = 'hint';
        const r = await send({ type: 'ai:test' });
        out.textContent = !r ? 'Lead Hunter did not answer. Reload the extension.' : r.error ? `Not working: ${r.error}` : `Working. ${r.name} read a test post: ${r.result.is_buyer ? 'a buyer' : 'not a buyer'}, needs ${r.result.service_needed.replace(/_/g, ' ')}, score ${r.result.intent_score}.`;
        out.className = `hint ${r && !r.error ? 'ok' : 'err'}`;
        return;
      }
      case 'backup': {
        const settings = { ...S.settings, placesKey: '', geminiKey: '', anthropicKey: '', igToken: '', redditSecret: '', verifyKey: '' }; // keys stay out of backups
        return download(`lead-hunter-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, leads: [...S.leads.values()] }), 'application/json');
      }
      case 'wipe-nofit': {
        const now = Date.now();
        const ids = [...S.leads.values()]
          .filter((x) => x.status === 'new' && !x.contactedAt && !x.coldEmailExportedAt && !x.notes)
          .filter((x) => {
            const f = LH.fit(x, S.settings, now);
            return !f.fit && !f.pending;
          })
          .map((x) => x.id);
        if (!ids.length) return toast('Every business here either fits or is still being checked.');
        if (!confirm(`Delete ${plural(ids.length, 'business', 'businesses')} that do not fit? Ones you contacted, exported or wrote notes on are kept. A later search may find them again.`)) return;
        await send({ type: 'lead:delete', ids });
        return toast(`Deleted ${ids.length}`);
      }
      case 'wipe':
        if (!confirm(`Delete all ${S.leads.size} leads? Download a backup first if you might need them.`)) return;
        await send({ type: 'lead:delete', ids: [...S.leads.keys()] });
        return toast('All leads deleted');
      case 'history-clear': {
        const n = Object.keys(S.history).length;
        if (!n || !confirm(`Forget all ${n} remembered contacts? Searches can then find businesses you already contacted.`)) return;
        await send({ type: 'history:clear' });
        return toast('Contacted memory cleared.');
      }
      // The open lead
      case 'recheck':
        if (!l) return;
        await send({ type: 'lead:recheck', ids: [l.id] });
        return toast('Checking their website again');
      case 'check-email':
        if (!l) return;
        await send({ type: 'verify:check', ids: [l.id] });
        return toast('Checking their email now');
      case 'places': {
        if (!l) return;
        b.disabled = true;
        b.textContent = 'Searching Google…';
        const r = await send({ type: 'lead:places', id: l.id });
        return toast(r && r.error ? r.error : r.places && r.places.match ? 'Found on Google Maps' : 'No confident match on Google Maps');
      }
      case 'fb-email': {
        if (!l) return;
        const r = await send({ type: 'fbemail:check', ids: [l.id] });
        return toast(r && r.error ? r.error : 'Looking for an email on their Facebook page');
      }
      case 'never-email':
        if (!l) return;
        await update(l.id, { doNotEmail: !l.doNotEmail });
        return toast(l.doNotEmail ? `“${l.pageName}” can go in the cold email file again` : `“${l.pageName}” stays out of the cold email file`);
      case 'ig-lookup': {
        if (!l) return;
        const r = await send({ type: 'ig:lookup', ids: [l.id] });
        return toast(r && r.error ? r.error : 'Reading their Instagram through the Instagram API');
      }
      case 'mark-via': {
        if (!l) return;
        const prev = l.status;
        if (['new', 'followup'].includes(prev)) {
          update(l.id, { status: 'contacted', via: b.dataset.via });
          return toast(`Marked “${l.pageName}” as contacted on ${VIA[b.dataset.via]}`, () => update(l.id, { status: prev }));
        }
        update(l.id, { via: b.dataset.via });
        return toast(`Saved: contacted on ${VIA[b.dataset.via]}`);
      }
      case 'reset-contacted':
        if (!l) return;
        await send({ type: 'lead:reset', id: l.id });
        return toast(`“${l.pageName}” is new again. Future searches can find it.`);
      case 'delete-lead':
        if (!l || !confirm(`Delete ${l.pageName}?`)) return;
        await send({ type: 'lead:delete', ids: [l.id] });
        closeDrawer();
        return toast('Lead deleted');
    }
  });

  // The lead panel's own inputs
  const drawer = $('[data-drawer]');
  let notesTimer = 0;
  drawer.addEventListener('input', (e) => {
    if (!e.target.matches('[data-notes]')) return;
    clearTimeout(notesTimer);
    const id = S.openId;
    const v = e.target.value;
    notesTimer = setTimeout(() => update(id, { notes: v }), 600);
  });
  drawer.addEventListener('change', (e) => {
    if (!S.openId) return;
    if (e.target.matches('[data-status]')) update(S.openId, { status: e.target.value });
    if (e.target.matches('[data-just-opened]')) update(S.openId, { justOpened: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null });
  });
  drawer.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (!S.openId) return;
    if (f.matches('[data-add-phone]') && f.phone.value.trim()) {
      update(S.openId, { addPhone: f.phone.value.trim() });
      f.phone.value = '';
    }
    if (f.matches('[data-add-email]') && f.email.value.trim()) {
      const c = LH.cleanEmail(f.email.value);
      if (!c.email) return toast(`That address will not work: ${c.bad || 'it is not an email address'}.`);
      update(S.openId, { addEmail: c.email });
      toast(c.fixed ? `Added, with the typo fixed (${c.fixed}). Checking it now.` : 'Added. Checking it now.');
      f.email.value = '';
    }
    if (f.matches('[data-set-website]') && f.website.value.trim()) {
      update(S.openId, { website: f.website.value.trim() });
      toast('Checking that website');
    }
  });
  $('[data-scrim]').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.openId) closeDrawer();
  });
  // Facebook avatar URLs expire; fall back to initials.
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG' || !img.classList.contains('av')) return;
      const span = document.createElement('span');
      span.className = 'av';
      span.textContent = img.dataset.initials || '?';
      img.replaceWith(span);
    },
    true,
  );
  $('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const leads = Array.isArray(data) ? data : data.leads;
      const r = await send({ type: 'leads:import', leads });
      toast(`Restored ${plural(r.imported, 'lead')}`);
    } catch {
      toast('That file is not a Lead Hunter backup');
    }
    e.target.value = '';
  });
}

/* ------------------------------------------------------------------ boot */
(async function boot() {
  await load();
  bind();
  initFind();
  initSettings();
  initIntent();
  fillSettings();
  const hash = location.hash.replace('#', '');
  setView(VIEWS.includes(hash) ? hash : 'leads');
})();
