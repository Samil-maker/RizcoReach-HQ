/* Lead Hunter dashboard: lead table, detail drawer, hunts and settings.
   Reads chrome.storage directly and re-renders on every change; all lead writes
   go through the background worker so they never race with enrichment. */
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
const BIG_BRAND = 60000;
const ICON = {
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
};

const S = {
  leads: new Map(),
  settings: LH.withDefaults(),
  hunt: null,
  queue: [],
  selected: new Set(),
  view: 'leads',
  openId: null,
  huntNiche: '',
  email: null, // the email sender as the site sees it (Settings)
  filters: { q: '', heat: '', status: '', keyword: '', site: '', tag: '', contact: '', minDays: 0, hideBig: true, skipped: false, contactedBefore: false, sort: 'heat', hunt: '' },
  alerts: {}, // sources paused by a login wall, checkpoint or block: { adlib: { at, text, url } }
  problems: {}, // the last problems per source, newest first: { adlib: [[at, text]] }
  history: {}, // contacted memory: phones, websites, handles and names you contacted, exported or imported
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
  S.adQueue = all.adCheckQueue || [];
  S.adPaused = !!all.adCheckPaused;
  S.queue = all.enrichQueue || [];
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
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k.startsWith('lead:')) {
      const id = k.slice(5);
      S.chains = null; // names seen more than once, worked out again on the next render
      if (newValue) S.leads.set(id, newValue);
      else {
        S.leads.delete(id);
        S.selected.delete(id);
      }
    } else if (k === 'settings') {
      S.settings = LH.withDefaults(newValue);
      settingsChanged = true;
    } else if (k === 'hunt') S.hunt = newValue || null;
    else if (k === 'enrichQueue') S.queue = newValue || [];
    else if (k === 'finder') S.finder = newValue || null;
    else if (k === 'adCheckQueue') S.adQueue = newValue || [];
    else if (k === 'adCheckPaused') S.adPaused = !!newValue;
    else if (k === 'alerts') S.alerts = newValue || {};
    else if (k === 'intentState') {
      S.intent.state = newValue || {};
      renderIntentCount();
    }
    else if (k === 'problems') {
      S.problems = newValue || {};
      renderProblems();
    } else if (k === 'contactHistory') {
      S.history = newValue || {};
      renderHistory();
    }
  }
  if (settingsChanged && S.view !== 'settings') fillSettings();
  if (settingsChanged) renderNicheChips();
  scheduleRender();
});

/* --------------------------------------------------------------- filters */
const isSkipped = (l) => !LH.scriptFor(l).script; // running ads with a working website: left out (hidden, no emails)
/** Skipped leads you have not messaged. Leads already in your pipeline (contacted, replied, meeting…) always show. */
const skippedNew = (l) => isSkipped(l) && l.status === 'new' && !l.contactedAt;
/** New leads that match someone you contacted, exported or imported before: hidden unless asked for. */
const contactedBefore = (l) => l.status === 'new' && LH.historyHit(l, S.history);
const hideContacted = (l, f) => !f.contactedBefore && f.tag !== 'Contacted before' && !!contactedBefore(l);
/** Those show only when asked for: the checkbox or the "Running ads" tag. */
const skipHidden = (l, f) => skippedNew(l) && !f.skipped && f.tag !== 'Running ads';
const tagMatch = (l, tag) => !tag || leadTags(l).includes(tag);

function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const rows = [];
  for (const l of S.leads.values()) {
    if (l.kind === 'prospect') continue; // Meta-ads prospects live in their own tab
    const p = LH.priority(l, now);
    const h = LH.heatScore(l, S.settings, now);
    if (f.hunt && !(l.hunts || []).includes(f.hunt)) continue;
    if (f.hideBig && (l.pageLikes || 0) > BIG_BRAND) continue;
    if (skipHidden(l, f) || hideContacted(l, f) || !tagMatch(l, f.tag)) continue;
    if (f.heat && LH.heatClass(h.score, S.settings) !== f.heat) continue;
    if (f.status === '' && l.status === 'skip') continue;
    if (f.status && f.status !== 'all' && l.status !== f.status) continue;
    if (f.keyword && !(l.keywords || []).includes(f.keyword)) continue;
    if (f.site === 'none' && l.website) continue;
    if (f.site === 'down' && !LH.siteDown(l)) continue;
    if (f.contact === 'phone' && !l.phones.length) continue;
    if (f.contact === 'wa' && !LH.whatsappTarget(l)) continue;
    if (f.contact === 'email' && !(l.emails || []).length) continue;
    if (f.contact === 'nophone' && l.phones.length) continue;
    if (f.minDays && (LH.daysRunning(l, now) ?? -1) < f.minDays) continue;
    if (q) {
      const hay = [l.pageName, l.website, LH.igHandle(l), ...(l.keywords || []), ...(l.categories || []), ...l.phones.map((x) => x.number), ...(l.emails || []), l.notes]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ l, p, h });
  }
  const score = (l) => (l.website ? (typeof (l.site || {}).score === 'number' ? l.site.score : 101) : -1);
  const sorters = {
    heat: (a, b) => b.h.score - a.h.score,
    priority: (a, b) => b.p - a.p,
    days: (a, b) => (LH.daysRunning(b.l, now) ?? -1) - (LH.daysRunning(a.l, now) ?? -1),
    ads: (a, b) => (b.l.activeAdCount || 0) - (a.l.activeAdCount || 0),
    score: (a, b) => score(a.l) - score(b.l),
    newest: (a, b) => (b.l.createdAt || 0) - (a.l.createdAt || 0),
    name: (a, b) => (a.l.pageName || '').localeCompare(b.l.pageName || ''),
  };
  return rows.sort((a, b) => isSkipped(a.l) - isSkipped(b.l) || sorters[f.sort](a, b) || b.p - a.p);
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
const daysText = (d) => (d == null ? 'unknown' : d === 0 ? 'started today' : d === 1 ? '1 day' : `${d} days`);
const gradeOf = (s) => (s >= 80 ? 'good' : s >= 60 ? 'ok' : s >= 40 ? 'weak' : 'poor');

function siteCell(l) {
  const site = l.site || {};
  if (!l.website) {
    if (['queued', 'running'].includes(site.state)) return `<div class="site"><span class="spin"></span><span class="muted">Searching…</span></div>`;
    return `<div class="site"><span class="tag amber">No website</span><span class="muted nowrap">→ ${esc(shortDest(l.destinationKind))}</span></div>`;
  }
  const domain = LH.domainOf(l.website);
  const link = `<a href="${esc(safeHref(l.landingUrl || l.website))}" target="_blank" rel="noopener noreferrer" data-stop>${esc(domain)}</a>`;
  if (['queued', 'running', 'pending'].includes(site.state)) return `<div class="site"><span class="${site.state === 'pending' ? 'score na' : 'spin'}">${site.state === 'pending' ? '–' : ''}</span>${link}</div>`;
  if (site.state === 'error') return `<div class="site"><span class="score poor">0</span>${link}<span class="tag red">Down</span></div>`;
  if (site.parked) return `<div class="site"><span class="score poor">5</span>${link}<span class="tag red">Parked</span></div>`;
  if (site.state === 'blocked') return `<div class="site"><span class="score na" title="Site blocked the automatic check">?</span>${link}</div>`;
  if (typeof site.score === 'number') return `<div class="site"><span class="score ${gradeOf(site.score)}">${site.score}</span>${link}</div>`;
  return `<div class="site">${link}</div>`;
}
const shortDest = (k) => ({ whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram', facebook: 'Facebook', leadform: 'Instant form', linkinbio: 'Link in bio', phone: 'Calls', form: 'Form', app: 'App', google: 'Google' })[k] || 'Facebook';

function issueCell(l) {
  const site = l.site || {};
  if (!l.website) return `<div class="issue">Ads send people to ${esc(LH.destinationLabel(l.destinationKind))}, no website behind them</div>`;
  if (site.state === 'blocked') return `<div class="issue muted">Site blocks automatic checks. Open it to review.</div>`;
  const iss = site.issues || [];
  if (!iss.length) return site.state === 'ok' ? `<div class="issue muted">No major issues</div>` : '<span class="muted">…</span>';
  return `<div class="issue">${esc(iss[0].label)}${iss.length > 1 ? ` <span class="more">+${iss.length - 1} more</span>` : ''}</div>`;
}

function contactCell(l) {
  const best = LH.bestPhone(l);
  const wa = LH.whatsappTarget(l);
  const parts = [];
  // The WhatsApp number first: the one that goes to Google Contacts as their mobile.
  const shown = wa || (best && best.number);
  if (shown) parts.push(`<div class="p"><span class="num">${esc(LH.formatPhone(shown))}</span></div>`);
  const ig = LH.igHandle(l);
  const email = (l.emails || [])[0];
  if (ig) parts.push(`<div class="p muted">${ICON.ig}<a class="trunc" href="https://www.instagram.com/${esc(encodeURIComponent(ig))}/" target="_blank" rel="noopener noreferrer" data-stop>@${esc(ig)}</a></div>`);
  if (email) parts.push(`<div class="p muted">${ICON.mail}<span class="trunc" title="${esc(email)}">${esc(email)}</span></div>`);
  if (!parts.length) {
    const st = (l.site || {}).state;
    return ['queued', 'running'].includes(st) ? '<span class="muted">Looking…</span>' : '<span class="muted">No contact yet</span>';
  }
  const eq = l.emailQueue;
  if (eq && (eq.state === 'queued' || eq.sent)) parts.push(`<div class="p"><span class="tag green" title="${eq.sent ? 'Sent by the email sender' : 'Waiting in your email queue'}">${eq.sent ? 'Emailed' : 'Email queued'}</span></div>`);
  return `<div class="contact">${parts.join('')}</div>`;
}

/* Heat score (Phase 4): the badge on every row and in the lead panel, with what it is made of. */
const heatParts = (h) => h.parts.map((x) => `${x.label} ${x.points > 0 ? '+' : ''}${x.points}`).join(', ');
const heatBadge = (h) => `<span class="heat ${LH.heatClass(h.score, S.settings)}" title="${esc(`Heat ${h.score}/100, ${LH.HEAT_GROUPS[h.profile]}: ${heatParts(h) || 'no signals yet'}`)}">${h.score}</span>`;
/* Row tags are for sorting and filtering only: the script never changes because of them. */
const TAG_CLASS = { 'Contacted before': 'red', 'Weak site': 'amber', 'New business': 'green', 'Followers in range': 'green', 'No website': 'amber', 'Site down': 'amber', 'Running ads': 'red', 'Good reviews': 'green', Mobile: 'green', Landline: 'amber', Corporate: 'red', Chain: 'red' };
/** Tags need to know which business names appear more than once (chains). */
const leadTags = (l) => LH.leadTags(l, { settings: S.settings, history: S.history, chains: S.chains || (S.chains = LH.chainNames([...S.leads.values()].filter((x) => x.kind === 'prospect'))) });
const tagsHtml = (l) => {
  const tags = leadTags(l);
  return tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag ${TAG_CLASS[t] || ''}">${esc(t)}</span>`).join('')}</div>` : '';
};
/** One tap: they replied. Tap again to undo (back to contacted). Meeting booked and Won are past it. */
function repliedButton(l) {
  const on = LH.hasReplied(l);
  const past = ['meeting', 'won'].includes(l.status);
  return `<button class="btn sm reply ${on ? 'on' : ''}" data-replied aria-pressed="${on}" ${past ? 'disabled' : ''} title="${on ? 'They replied. Tap again to undo' : 'Mark that they replied'}">${on ? '✓ Replied' : 'Replied'}</button>`;
}
const statusCell = (l) => `<div class="status-cell"><select class="status-sel" data-status aria-label="Status">${statusOptions(l.status)}</select>${repliedButton(l)}</div>`;
function toggleReplied(l) {
  if (LH.hasReplied(l)) update(l.id, { status: 'contacted', repliedAt: null });
  else update(l.id, { status: 'replied' });
}

function rowHtml({ l, h }) {
  const days = LH.daysRunning(l);
  const meta = [l.categories && l.categories[0], l.keywords && l.keywords[0] && `“${l.keywords[0]}”`].filter(Boolean).join(' · ');
  const dim = ['lost', 'skip', 'won'].includes(l.status) || skippedNew(l) ? ' dim' : '';
  return `<tr data-id="${esc(l.id)}" class="${S.selected.has(l.id) ? 'sel' : ''}${dim}">
    <td class="c-sel"><input type="checkbox" data-sel ${S.selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.pageName)}" /></td>
    <td>${heatBadge(h)}</td>
    <td><div class="biz">${avatar(l)}<div style="min-width:0"><div class="n">${esc(l.pageName || 'Unknown page')}</div><div class="m">${esc(meta)}</div>${tagsHtml(l)}</div></div></td>
    <td class="nowrap"><b class="num">${l.activeAdCount || 0}</b> <span class="muted">active</span><div class="muted">${esc(daysText(days))}</div></td>
    <td>${siteCell(l)}</td>
    <td>${issueCell(l)}</td>
    <td>${contactCell(l)}</td>
    <td>${statusCell(l)}</td>
    <td><button class="btn sm" data-open>Open</button></td>
  </tr>`;
}

/* ---------------------------------------------------------------- render */
function renderKpis() {
  if (S.view === 'ads') return renderProspectKpis();
  if (S.view === 'intent') return renderIntentKpis();
  const leads = [...S.leads.values()].filter((l) => l.kind !== 'prospect');
  const now = Date.now();
  const hot = leads.filter((l) => l.status === 'new' && LH.heatClass(LH.heatScore(l, S.settings, now).score, S.settings) === 'hot').length;
  const phone = leads.filter((l) => l.phones.length).length;
  const contacted = leads.filter((l) => !['new', 'skip'].includes(l.status)).length;
  $('[data-kpis]').innerHTML =
    `<span class="kpi"><b>${leads.length}</b> leads</span>` +
    `<span class="kpi hot"><b>${hot}</b> hot to contact</span>` +
    `<span class="kpi"><b>${phone}</b> with phone</span>` +
    `<span class="kpi"><b>${contacted}</b> contacted</span>` +
    (S.queue.length ? `<span class="kpi"><span class="spin"></span> checking <b>${S.queue.length}</b> sites</span>` : '');
}

function renderBanner() {
  const el = $('[data-hunt-banner]');
  const h = S.hunt;
  let dismissed = '';
  try {
    dismissed = localStorage.getItem('lh-dismissed-hunt') || '';
  } catch {}
  if (!h || (h.status !== 'running' && (dismissed === h.id || Date.now() - (h.finishedAt || 0) > 6 * 3600e3))) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const pct = Math.min(100, Math.round((100 * h.collected) / h.target));
  if (h.status === 'running') {
    el.innerHTML = `<span class="pulse"></span>
      <span class="t">Hunting “${esc(h.keywords[h.index] || '')}”</span>
      <span class="m">keyword ${h.index + 1} of ${h.keywords.length} · <b class="num">${h.collected}</b> / ${h.target} new leads</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <button class="btn sm" data-act="show-hunt-tab">Show tab</button>
      <button class="btn sm danger" data-act="stop-hunt">Stop</button>`;
  } else {
    const why = { target: 'target reached', keywords: 'all keywords searched', stopped: 'stopped', 'tab-closed': 'tab was closed', replaced: 'replaced by a new hunt' }[h.finishReason] || h.status;
    el.innerHTML = `<span class="t">Hunt “${esc(h.name)}” finished</span>
      <span class="m">${h.collected} new leads · ${esc(why)}</span>
      <button class="btn sm pri" data-act="filter-hunt" data-hunt="${esc(h.id)}">Show these leads</button>
      <button class="btn sm ghost" data-act="dismiss-hunt" data-hunt="${esc(h.id)}">Dismiss</button>`;
  }
}

function renderFilterOptions() {
  const kw = new Map();
  for (const l of S.leads.values()) for (const k of l.keywords || []) kw.set(k, (kw.get(k) || 0) + 1);
  const sel = $('[data-f="keyword"]');
  const cur = S.filters.keyword;
  sel.innerHTML =
    `<option value="">Any keyword</option>` +
    [...kw.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(k)} (${n})</option>`)
      .join('') +
    (S.filters.hunt ? `<option value="" disabled>— filtered to one hunt —</option>` : '');
  const st = $('[data-f="status"]');
  if (!st.options.length) {
    st.innerHTML = `<option value="">Open leads</option><option value="all">All statuses</option>` + LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  }
  const bulk = $('[data-bulk-status]');
  if (!bulk.options.length) bulk.innerHTML = `<option value="">Set status…</option>` + LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
}

function renderTable() {
  const rows = filtered();
  const website = [...S.leads.values()].filter((l) => l.kind !== 'prospect');
  const skipped = S.filters.skipped ? 0 : website.filter(skippedNew).length;
  $('[data-rows]').innerHTML = rows.map(rowHtml).join('');
  $('[data-empty]').hidden = rows.length > 0 || website.length === 0;
  $('[data-empty]').textContent = skipped && !rows.length ? 'No leads to message here. The rest run ads and already have a website: tick "Show skipped" to see them.' : 'No leads match these filters.';
  $('[data-count]').innerHTML = website.length
    ? `Showing ${rows.length} of ${website.length} leads${S.filters.hunt ? ' from one hunt' : ''}.${skipped ? ` ${skipped} skipped (running ads with a website).` : ''}${S.filters.hideBig ? ' Big brands hidden.' : ''}` +
      (S.filters.hunt ? ` <button class="btn sm ghost" data-act="clear-hunt-filter">Show all leads</button>` : '')
    : '';
  const ids = rows.map((r) => r.l.id);
  const all = $('[data-sel-all]');
  all.checked = ids.length > 0 && ids.every((id) => S.selected.has(id));
  all.indeterminate = !all.checked && ids.some((id) => S.selected.has(id));
  $('[data-bulk]').hidden = S.selected.size === 0;
  $('[data-bulk-count]').textContent = `${S.selected.size} selected`;
  const pending = [...S.leads.values()].filter((l) => (l.site || {}).state === 'pending').length;
  const btn = $('[data-act="enrich-pending"]');
  btn.hidden = !pending;
  btn.textContent = `Check ${pending} websites`;
  $('[data-welcome]').hidden = S.leads.size > 0;
  $('.toolbar').hidden = S.leads.size === 0;
  $('.table-wrap').hidden = S.leads.size === 0;
}

/* Results: reply rates across every lead in both tabs, by niche and by script. */
function renderResults() {
  const r = LH.results([...S.leads.values()], S.settings);
  const table = (title, list) =>
    `<table class="mini"><thead><tr><th>${title}</th><th>Sent</th><th>Replied</th><th>Reply rate</th></tr></thead><tbody>${list
      .map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.sent}</td><td class="num">${x.replied}</td><td class="num">${esc(x.rate)}</td></tr>`)
      .join('')}</tbody></table>`;
  const sum = `${r.total.sent} sent · ${r.total.replied} replied · ${r.total.rate} reply rate`;
  const body = r.total.sent ? `${table('By niche', r.byNiche)}${table('By script', r.byScript)}` : '<p class="muted">Nothing sent yet. Leads you message show up here, with who replied.</p>';
  $$('[data-results]').forEach((el) => {
    el.hidden = S.leads.size === 0;
    $('[data-results-sum]', el).textContent = sum;
    $('[data-results-body]', el).innerHTML = body;
  });
}

function renderAll() {
  renderKpis();
  renderBanner();
  renderResults();
  if (S.view === 'leads') {
    renderFilterOptions();
    renderTable();
  }
  if (S.view === 'hunt') renderLastHunt();
  if (S.view === 'ads') renderProspectsView();
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

/** The open lead's panel. */
function renderDrawer(fresh = false) {
  const l = S.leads.get(S.openId);
  const d = $('[data-drawer]');
  if (!l) return closeDrawer();
  // Keep whatever the user is typing.
  const active = document.activeElement;
  const editing = active && d.contains(active) && /TEXTAREA|INPUT/.test(active.tagName);
  if (editing && !fresh) {
    renderDrawerFacts(l);
    return;
  }
  const keep = {
    notes: $('[data-notes]', d) && !fresh ? $('[data-notes]', d).value : null,
    scroll: fresh ? 0 : d.scrollTop,
  };
  d.innerHTML = drawerHtml(l);
  if (keep.notes != null && keep.notes !== (l.notes || '')) $('[data-notes]', d).value = keep.notes;
  d.scrollTop = keep.scroll;
}

/** Re-render the open drawer where it is scrolled to (after a click inside it). */
function redrawDrawer() {
  const top = $('[data-drawer]').scrollTop;
  renderDrawer(true);
  $('[data-drawer]').scrollTop = top;
}

function renderDrawerFacts(l) {
  const el = $('[data-site-sec]');
  if (el) el.outerHTML = siteSection(l);
  const c = $('[data-contact-sec]');
  if (c && !c.contains(document.activeElement)) c.outerHTML = contactSection(l);
}

function siteSection(l) {
  const site = l.site || {};
  let body;
  if (!l.website) {
    body = `<p>No website found. The ads send people to <b>${esc(LH.destinationLabel(l.destinationKind))}</b>. That is the gap: a proper landing page converts better than a chat window for most people who are still comparing options.</p>
      <form class="inline-form" data-set-website><input class="inp" name="website" placeholder="Know their website? Paste it here" /><button class="btn sm" type="submit">Check it</button></form>`;
    if (['queued', 'running'].includes(site.state)) body = `<p><span class="spin"></span> Looking for a website on Google…</p>` + body;
  } else if (['queued', 'running'].includes(site.state)) {
    body = `<p><span class="spin"></span> Checking ${esc(LH.domainOf(l.website))}…</p>`;
  } else if (site.state === 'pending') {
    body = `<p class="muted">Not checked yet.</p><button class="btn sm" data-act="recheck">Check website</button>`;
  } else if (site.state === 'blocked') {
    body = `<p>${esc(site.note || 'The site blocked the automatic check.')} (HTTP ${esc(site.status)})</p>`;
  } else {
    const score = typeof site.score === 'number' ? site.score : null;
    const kv = [
      site.builder && `<span>Built with <b>${esc(site.builder)}</b></span>`,
      site.load && `<span>HTML load <b>${esc(site.load)}s</b></span>`,
      site.state === 'ok' && !site.parked && `<span>Meta Pixel <b>${site.pixel ? 'found' : site.tagManager ? 'not visible (GTM)' : 'missing'}</b></span>`,
      site.copyrightYear && `<span>Footer <b>© ${esc(site.copyrightYear)}</b></span>`,
      site.psi && typeof site.psi.performance === 'number' && `<span>Google mobile speed <b>${site.psi.performance}/100</b></span>`,
      `<span>Checked <b>${esc(fmtDate(site.checkedAt))}</b></span>`,
    ].filter(Boolean);
    body = `<div class="site-head">${score != null ? `<span class="score ${gradeOf(score)}">${score}</span>` : ''}
        <a href="${esc(safeHref(site.finalUrl || l.landingUrl || l.website))}" target="_blank" rel="noopener noreferrer">${esc(LH.domainOf(site.finalUrl || l.website))}</a>
        ${site.state === 'error' ? '<span class="tag red">Not loading</span>' : ''}${site.parked ? '<span class="tag red">Parked page</span>' : ''}
        ${l.websiteSource === 'google' ? '<span class="tag">found via Google</span>' : ''}</div>
      <div class="kv">${kv.join('')}</div>
      ${(site.issues || []).length ? `<ul class="issues">${site.issues.map((i) => `<li><span class="sev ${esc(i.sev)}" title="${esc(i.sev)}"></span><span>${esc(i.label)}</span></li>`).join('')}</ul>` : '<p class="muted">No major issues found.</p>'}
      ${site.psiError ? `<p class="err">${esc(site.psiError)}</p>` : ''}`;
  }
  const domain = LH.domainOf(l.website || '');
  const actions = l.website
    ? `<div class="row">
        <button class="btn sm" data-act="recheck">Re-check</button>
        ${site.state === 'ok' && !site.parked ? `<button class="btn sm" data-act="psi">Run Google speed test</button>` : ''}
        ${S.settings.auditLinkBase ? `<a class="btn sm" href="${esc(safeHref(S.settings.auditLinkBase + encodeURIComponent(domain)))}" target="_blank" rel="noopener noreferrer">Full audit on your site ↗</a>` : ''}
      </div>`
    : '';
  return `<section class="d-sec" data-site-sec><h3>Website</h3>${body}${actions}</section>`;
}

function contactSection(l) {
  const country = LH.country(l.countries[0] || S.settings.country);
  const q = encodeURIComponent(`${l.pageName} ${country.code !== 'ALL' ? country.name : ''}`.trim());
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
  const emails = (l.emails || []).map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(' · ');
  const ig = LH.igHandle(l);
  const socials = Object.entries(l.socials || {})
    .filter(([k]) => !(ig && k === 'instagram'))
    .map(([k, u]) => `<a href="${esc(safeHref(u))}" target="_blank" rel="noopener noreferrer">${esc(k)}</a>`)
    .join(' · ');
  const pl = l.places;
  const places =
    pl && pl.match
      ? `<p>Google: <b>${esc(pl.name)}</b>${pl.rating ? ` · ★ ${esc(pl.rating)} (${esc(pl.reviews || 0)} reviews)` : ''}${pl.mapsUrl ? ` · <a href="${esc(safeHref(pl.mapsUrl))}" target="_blank" rel="noopener noreferrer">Maps</a>` : ''}</p>`
      : pl && pl.error
        ? `<p class="err">${esc(pl.error)}</p>`
        : pl
          ? `<p class="muted">No confident match on Google Maps.</p>`
          : '';
  return `<section class="d-sec" data-contact-sec><h3>Contact</h3>
    ${phones}
    ${ig ? `<p>Instagram: <a href="https://www.instagram.com/${esc(encodeURIComponent(ig))}/" target="_blank" rel="noopener noreferrer">@${esc(ig)}</a></p>` : ''}
    ${emails ? `<p>Email: ${emails}</p>` : ''}
    ${socials ? `<p>Profiles: ${socials}</p>` : ''}
    ${places}
    <form class="inline-form" data-add-phone><input class="inp" name="phone" placeholder="Add a phone / WhatsApp number" inputmode="tel" /><button class="btn sm" type="submit">Add</button></form>
    <div class="row">
      ${S.settings.placesKey ? `<button class="btn sm" data-act="places">Look up on Google Maps</button>` : ''}
      <a class="btn sm ghost" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">Google ↗</a>
      <a class="btn sm ghost" href="https://www.google.com/maps/search/${q}" target="_blank" rel="noopener noreferrer">Maps ↗</a>
      ${l.kind === 'prospect' ? '' : `<a class="btn sm ghost" href="${esc(safeHref(l.pageUrl))}" target="_blank" rel="noopener noreferrer">Facebook page ↗</a>`}
    </div>
  </section>`;
}

const bubbleRows = (t) => Math.min(12, Math.max(1, (String(t).match(/\n/g) || []).length + Math.ceil(String(t).length / 64)));

/* The emails the email sender sends (read only: the wording is edited in Settings), where they stand, and manual sending. */
const STEP_NAMES = ['First email', 'Follow up 1', 'Follow up 2'];
const EMAIL_STATE = { queued: 'Queued', replied: 'Replied', bounced: 'Bounced', optout: 'On the never email list', failed: 'Could not send', cancelled: 'Stopped' };
function emailState(q) {
  if (q.state === 'active') return `Sent ${q.sent} of ${q.total} · next follow up ${q.nextAt > Date.now() ? new Date(q.nextAt).toLocaleDateString(undefined, { weekday: 'short' }) : 'soon'}`;
  if (q.state === 'done') return `Sent ${q.sent} of ${q.total}`;
  return EMAIL_STATE[q.state] || q.state;
}
function emailQueueRow(l, e) {
  const q = l.emailQueue;
  if (q && (q.sent || q.state !== 'cancelled')) {
    const cls = { replied: 'green', bounced: 'red', failed: 'red', optout: 'red' }[q.state] || '';
    return `<span class="tag ${cls}" data-email-state>${esc(emailState(q))}</span>${['queued', 'active'].includes(q.state) ? '<button class="btn sm" data-act="email-stop">Stop emails</button>' : ''}`;
  }
  if (!e.to || !e.script) return ''; // skipped for running ads: left out of the emails
  if (l.contactedAt) return ''; // already contacted another way: one channel per business
  if (!S.settings.queueKey) return '<button class="btn sm ghost" data-goto="settings" data-anchor="email">Set up the email sender</button>';
  return '<button class="btn sm pri" data-act="email-queue">Add to email queue</button>';
}
/** The Email section of a lead: what the email sender will send them, where it stands, and the queue buttons. */
function emailSection(l) {
  const e = LH.emailFor(l, S.settings);
  if (!e.script)
    return `<section class="d-sec email-sec"><h3>Email</h3><p class="muted">They run ads and have a working website, so they are left out of the emails.</p></section>`;
  return `<section class="d-sec email-sec"><h3>Email <span class="tag">${esc(LH.OFFER_NAMES[e.script])}</span></h3>${emailBlock(l, e)}
    <p class="hint">The email sender sends these from your own Gmail, slowly, and stops when they reply. Change the wording in Settings > Email sender.</p></section>`;
}
function emailBlock(l, e) {
  const steps = e.steps
    .map((t, i) => `<div class="bubble"><div class="bubble-head"><span class="lbl">${STEP_NAMES[i]}</span></div><textarea class="inp" readonly data-email-step="${i}" rows="${bubbleRows(t)}" aria-label="${STEP_NAMES[i]}">${esc(t)}</textarea></div>`)
    .join('');
  const queue = emailQueueRow(l, e);
  const none = l.doNotEmail ? 'Never email is on for them.' : (l.emails || []).length ? 'Their email bounced.' : 'No email found.';
  return `<p class="email-to">${e.to ? `To <b>${esc(e.to)}</b>` : `<span class="muted">${none}</span>`}</p>
    ${queue ? `<div class="row email-queue">${queue}</div>` : ''}
    <details class="email-preview"><summary>What they get</summary>
      <input class="inp" readonly data-email-subject value="${esc(e.subject)}" aria-label="Email subject" style="margin-bottom:8px" />
      <div class="bubbles">${steps}</div></details>
    ${(l.emails || []).length && !l.doNotEmail ? '<div class="row"><button class="linkish" data-act="email-never">Never email</button></div>' : ''}`;
}

function drawerHtml(l) {
  if (l.kind === 'prospect') return prospectDrawerHtml(l);
  const days = LH.daysRunning(l);
  const p = LH.priority(l);
  const ads = Object.values(l.ads || {}).sort((a, b) => Number(b.active) - Number(a.active) || (b.start || 0) - (a.start || 0));
  const country = l.countries[0] || 'ALL';
  return `
    <header class="d-head">${avatar(l)}
      <div style="min-width:0"><h2>${esc(l.pageName || 'Unknown page')}</h2>
        <div class="links">${heatBadge(LH.heatScore(l, S.settings))}
          <a href="${esc(safeHref(l.pageUrl))}" target="_blank" rel="noopener noreferrer">Facebook page</a>
          <a href="${esc(safeHref(LH.pageAdsUrl(l.pageId, country, l.pageName)))}" target="_blank" rel="noopener noreferrer">All their ads</a>
          ${l.categories.length ? `<span>${esc(l.categories.slice(0, 2).join(', '))}</span>` : ''}</div></div>
      <button class="btn sm ghost x" data-act="close" aria-label="Close">✕</button>
    </header>
    <section class="d-sec">
      <div class="facts">
        <div class="fact"><b>${l.activeAdCount || 0}</b><span>active ads seen</span></div>
        <div class="fact"><b>${days == null ? '–' : days}</b><span>days advertising</span></div>
        <div class="fact"><b>${l.pageLikes ? Intl.NumberFormat(undefined, { notation: 'compact' }).format(l.pageLikes) : '–'}</b><span>page likes</span></div>
        <div class="fact"><b>${esc(l.destinationKind === 'website' ? 'Website' : shortDest(l.destinationKind))}</b><span>ads send to</span></div>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="lbl" for="d-status">Status</label>
        <select id="d-status" class="status-sel" data-status>${statusOptions(l.status)}</select>
        <span class="muted">Found ${esc(fmtDate(l.createdAt))} via ${esc((l.keywords || []).join(', ') || 'browsing')}</span>
      </div>
      ${contactedRow(l)}
    </section>
    ${qualitySection(l)}
    ${emailSection(l)}
    ${siteSection(l)}
    ${contactSection(l)}
    <section class="d-sec"><h3>Notes</h3><textarea class="inp" rows="3" data-notes placeholder="Who you spoke to, what they said, when to follow up…">${esc(l.notes || '')}</textarea></section>
    <section class="d-sec"><h3>Their ads (${ads.length})</h3><div class="ads">${ads
      .slice(0, 12)
      .map(
        (a) => `<div class="ad"><div class="meta"><span class="tag ${a.active ? '' : 'red'}">${a.active ? 'Active' : 'Inactive'}</span>
        ${a.start ? `<span>Started ${esc(fmtDate(a.start))}</span>` : ''}${a.count > 1 ? `<span>${a.count} versions</span>` : ''}${a.ctaText ? `<span>CTA: ${esc(a.ctaText)}</span>` : ''}
        ${(a.platforms || []).length ? `<span>${esc(a.platforms.map((x) => x.toLowerCase()).join(', '))}</span>` : ''}</div>
        ${a.body ? `<p>${esc(a.body)}</p>` : ''}
        <div class="lnk"><a href="https://www.facebook.com/ads/library/?id=${esc(encodeURIComponent(a.id))}" target="_blank" rel="noopener noreferrer">View ad ↗</a>
        ${(a.links || [])
          .slice(0, 2)
          .map((u) => `<a href="${esc(safeHref(u))}" target="_blank" rel="noopener noreferrer">${esc(LH.domainOf(u) || u)}</a>`)
          .join('')}</div></div>`,
      )
      .join('')}</div></section>
    <section class="d-sec"><div class="row" style="margin:0"><button class="btn sm danger" data-act="delete-lead">Delete lead</button></div></section>`;
}

/* --------------------------------------------------------------- actions */
let toastTimer = 0;
function toast(text, undo) {
  const t = $('[data-toast]');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button data-undo>Undo</button>' : ''}`;
  t.hidden = false;
  if (undo) $('[data-undo]', t).onclick = () => (undo(), (t.hidden = true));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 2600);
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
/** Contacted, with the script that was sent and the channel, and an undo. Returns false when the lead is past "contacted". */
function markContacted(l, script, via) {
  if (!['new', 'followup'].includes(l.status)) return false;
  const prev = l.status;
  update(l.id, { status: 'contacted', sentScript: script || undefined, via: via || undefined });
  toast(`Marked “${l.pageName}” as contacted${via ? ` on ${VIA[via]}` : ''}`, () => update(l.id, { status: prev }));
  return true;
}
/* Quality signals (Phase 3): the website weakness score and its reasons, Instagram followers, new business, top reason. */
const CHECK_HINT = { slow_mobile: 'needs PageSpeed (Settings > Enrichment)', no_contact: 'the site loads its content with scripts, so this could not be read' };
function qualitySection(l) {
  const s = S.settings;
  const q = LH.quality(l, s);
  const w = q.website;
  const checks = LH.weakChecksFor(s);
  const name = (id) => (checks.find((c) => c.id === id) || {}).label || id;
  let site;
  if (w.noSite) site = `<li class="bad">✗ ${esc(w.reasons[0].label)}</li>`;
  else {
    const waiting = ['queued', 'running', 'pending'].includes((l.site || {}).state);
    site = [
      ...w.reasons.map((r) => `<li class="bad">✗ ${esc(r.label)} <span class="muted">+${esc(r.points)}</span></li>`),
      ...w.passed.map((id) => `<li class="ok">✓ ${esc(name(id))}</li>`),
      ...w.unknown.map((id) => `<li class="muted">· ${esc(name(id))}: ${esc(waiting ? 'website check not done yet' : CHECK_HINT[id] || 'not checked')}</li>`),
    ].join('');
  }
  const score = w.noSite ? '<b>No website</b>' : w.score == null ? '<b>Not checked yet</b>' : `<b>${esc(w.score)}/100</b> ${q.weak ? '<span class="tag amber">Weak site</span>' : '<span class="muted">not weak</span>'}`;
  const handle = LH.igHandle(l);
  const st = l.igStats || {};
  const igReady = s.igToken && s.igAccountId;
  let ig;
  if (q.followers != null)
    ig = `${esc(compactNum(q.followers))} followers <span class="muted">(${st.from === 'api' ? `official API, ${esc(fmtDate(st.at))}` : 'from their profile page'})</span> ${q.inBand ? `<span class="tag green">In range ${esc(compactNum(s.followerMin))} to ${esc(compactNum(s.followerMax))}</span>` : '<span class="muted">outside your range</span>'}`;
  else if (!handle) ig = '<span class="muted">No Instagram found</span>';
  else if (st.error) ig = `<span class="muted">@${esc(handle)}: not found by the API. Personal accounts can't be looked up, only business and creator accounts.</span>`;
  else ig = `<span class="muted">@${esc(handle)}: not looked up yet</span>`;
  const igBtn = handle && igReady ? `<button class="btn sm ghost" data-act="ig-lookup">${st.at ? 'Look up again' : 'Look up followers'}</button>` : handle ? '<span class="muted">Set up the Instagram API in Settings to look up followers</span>' : '';
  const reviews = q.reviews == null ? '<span class="muted">No Google listing</span>' : `${esc(q.reviews)} Google reviews ${q.newBusiness ? `<span class="tag green">New business</span>` : '<span class="muted">not new</span>'}`;
  const h = LH.heatScore(l, s);
  const heat = `<div class="q-row heat-row"><span class="lbl">Heat score</span>${heatBadge(h)} <span class="muted">${esc(LH.HEAT_GROUPS[h.profile])}</span></div>
    <ul class="checks">${h.parts.map((x) => `<li class="${x.points < 0 ? 'bad' : 'ok'}">${x.points > 0 ? '+' : ''}${esc(x.points)} ${esc(x.label)}</li>`).join('') || '<li class="muted">No signals yet</li>'}</ul>`;
  return `<section class="d-sec quality" data-quality-sec><h3>Quality signals</h3>
    ${heat}
    ${q.topReason ? `<div class="q-row"><span class="lbl">Top reason</span><b>${esc(q.topReason)}</b></div>` : ''}
    <div class="q-row"><span class="lbl">Website weakness</span>${score}</div>
    <ul class="checks">${site}</ul>
    <div class="q-row"><span class="lbl">Instagram</span>${ig} ${igBtn}</div>
    <div class="q-row"><span class="lbl">Google</span>${reviews}</div>
  </section>`;
}
const VIA = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'Email', export: 'Google Contacts export', import: 'your imported contacts' };
/** In the drawer: when and how they were contacted, Mark contacted with the channel, and Reset. */
function contactedRow(l) {
  const reset = `<button class="btn sm ghost" data-act="reset-contacted" title="Make this business new again, so future searches can find it">Reset</button>`;
  const mark = ['whatsapp', 'instagram', 'email'].map((v) => `<button class="btn sm ${l.contactedVia === v ? 'on' : ''}" data-act="mark-via" data-via="${v}">${VIA[v]}</button>`).join('');
  if (l.contactedAt) return `<div class="row contacted-row"><span class="muted">Contacted ${esc(fmtDate(l.contactedAt))}${VIA[l.contactedVia] ? ` on ${esc(VIA[l.contactedVia])}` : ''}. Channel:</span>${mark}${reset}</div>`;
  const hit = contactedBefore(l);
  const before = hit ? `<span class="tag red">Contacted before${hit.at ? ` ${esc(fmtDate(hit.at))}` : ''}${VIA[hit.via] ? ` · ${esc(VIA[hit.via])}` : ''}</span>${reset}` : '';
  return `<div class="row contacted-row">${before}<span class="muted">Mark contacted:</span>${mark}</div>`;
}
function openTab(url) {
  chrome.tabs.create({ url });
}
/* Google Contacts: import the file at contacts.google.com (Import), then WhatsApp shows each business by name. */
function exportContacts(list) {
  const rows = LH.googleContactsRows(list, S.settings);
  if (!rows.length) return toast('None of these leads has a phone number or an email yet.');
  download(`google-contacts-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + LH.toCsv([LH.GOOGLE_CONTACTS_HEAD, ...rows]), 'text/csv;charset=utf-8');
  // Saved on your phone from now on: future searches skip these businesses.
  send({ type: 'history:add', ids: list.filter((l) => l.phones.length || (l.emails || []).length).map((l) => l.id), via: 'export' });
  toast(`${rows.length} contact${rows.length === 1 ? '' : 's'} saved. Import the file at contacts.google.com`);
}

/** Every field of every lead (the full record), for a spreadsheet or another tool. */
function exportFull(list) {
  if (!list.length) return toast('No leads to export.');
  download(`lead-finder-full-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + LH.toCsv([LH.FULL_CSV_HEAD, ...LH.fullCsvRows(list, S.settings, S.history)]), 'text/csv;charset=utf-8');
  toast(`${list.length} lead${list.length === 1 ? '' : 's'} exported with every field`);
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
const igUrl = (l) => (LH.igHandle(l) ? `https://www.instagram.com/${LH.igHandle(l)}/` : '');
function exportCsv(leads) {
  if (leads.length && leads.every((l) => l.kind === 'prospect')) return exportProspectsCsv(leads);
  const now = Date.now();
  const head = ['priority', 'heat', 'business', 'facebook_page', 'all_ads', 'keywords', 'category', 'page_likes', 'active_ads', 'days_running', 'first_ad_started', 'website', 'landing_page', 'website_score', 'website_status', 'builder', 'meta_pixel', 'top_issues', 'tags', 'phone', 'whatsapp_link', 'other_phones', 'email', 'instagram', 'google_rating', 'google_reviews', 'status', 'notes', 'found_on'];
  const rows = leads.map((l) => {
    const p = LH.priority(l, now);
    const site = l.site || {};
    const best = LH.bestPhone(l);
    const wa = LH.whatsappTarget(l);
    return [
      p,
      LH.heat(p),
      l.pageName,
      l.pageUrl,
      LH.pageAdsUrl(l.pageId, l.countries[0] || 'ALL', l.pageName),
      (l.keywords || []).join('; '),
      (l.categories || [])[0] || '',
      l.pageLikes || '',
      l.activeAdCount || 0,
      LH.daysRunning(l, now) ?? '',
      l.earliestStart ? new Date(l.earliestStart).toISOString().slice(0, 10) : '',
      l.website || '',
      l.landingUrl || '',
      typeof site.score === 'number' ? site.score : '',
      !l.website ? 'no website' : site.parked ? 'parked' : site.state || '',
      site.builder || '',
      site.state === 'ok' && !site.parked ? (site.pixel ? 'yes' : 'no') : '',
      (site.issues || []).slice(0, 4).map((i) => i.label).join('; '),
      LH.leadTags(l).join('; '),
      best ? LH.formatPhone(best.number) : '',
      wa ? LH.waLink(wa) : '',
      l.phones.filter((x) => !best || x.number !== best.number).map((x) => LH.formatPhone(x.number)).join('; '),
      (l.emails || [])[0] || '',
      igUrl(l),
      (l.places && l.places.rating) || '',
      (l.places && l.places.reviews) || '',
      (LH.STATUSES.find((s) => s.id === l.status) || {}).label || l.status,
      l.notes || '',
      l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : '',
    ];
  });
  download(`lead-hunter-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + LH.toCsv([head, ...rows]), 'text/csv;charset=utf-8');
}

/* ----------------------------------------------------------------- views */
function setView(v) {
  if (S.view !== v) {
    S.selected.clear();
    scrollTo(0, 0); // a tab opens at its top, not where the last one was scrolled to
  }
  S.view = v;
  $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $$('[data-view-panel]').forEach((p) => (p.hidden = p.dataset.viewPanel !== v));
  if (v === 'settings') {
    fillSettings();
    loadEmailStatus();
  }
  if (v === 'hunt') renderLastHunt();
  if (v === 'intent') send({ type: 'intent:seen' }); // the badge count goes once you look
  renderAll();
  try {
    history.replaceState(null, '', `#${v}`);
  } catch {}
}

function countryOptions(sel) {
  return LH.COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function renderLastHunt() {
  const el = $('[data-last-hunt]');
  const h = S.hunt;
  if (!h) return (el.hidden = true);
  el.hidden = false;
  el.innerHTML = `<h2>${h.status === 'running' ? 'Current' : 'Last'} hunt: ${esc(h.name)}</h2>
    <p class="muted">${esc(LH.country(h.country).name)} · target ${h.target} · ${h.collected} new leads · ${esc(h.status)}${h.finishReason ? ` (${esc(h.finishReason)})` : ''} · started ${esc(fmtDate(h.startedAt))}</p>
    <div class="kw-list">${h.keywords.map((k, i) => `<span class="tag ${i === h.index && h.status === 'running' ? 'amber' : ''}">${esc(k)} · ${(h.perKeyword || {})[k] || 0}</span>`).join('')}</div>
    <div class="row"><button class="btn sm" data-act="filter-hunt" data-hunt="${esc(h.id)}">Show these leads</button>
    ${h.status === 'running' ? '<button class="btn sm danger" data-act="stop-hunt">Stop hunt</button>' : ''}</div>`;
}

/** Niche chips on New hunt and on the Meta ads finder: one list, edited in Settings. */
function renderNicheChips() {
  const niches = LH.nichesFor(S.settings);
  const chip = (attr, n, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${esc(n.name)}">${esc(n.name)}</button>`;
  $('[data-presets]').innerHTML = niches.map((n) => chip('data-preset', n, n.name === S.huntNiche)).join('');
  $('[data-ad-niches]').innerHTML = niches.map((n) => chip('data-ad-niche', n, n.name === S.finderNiche)).join('');
}
const nicheNamed = (name) => LH.nichesFor(S.settings).find((n) => n.name === name);

function initHuntForm() {
  const form = $('[data-hunt-form]');
  renderNicheChips();
  $$('[data-countries]').forEach((s) => (s.innerHTML = countryOptions(S.settings.country)));
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    const niche = b && nicheNamed(b.dataset.preset);
    if (!niche) return;
    S.huntNiche = niche.name;
    form.keywords.value = niche.keywords.join('\n');
    $$('[data-preset]', form).forEach((c) => c.classList.toggle('on', c === b));
  });
  form.keywords.addEventListener('input', () => {
    S.huntNiche = '';
    $$('[data-preset]', form).forEach((c) => c.classList.remove('on'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-hunt-err]');
    err.hidden = true;
    const keywords = form.keywords.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    if (!keywords.length) {
      err.textContent = 'Add at least one keyword.';
      err.hidden = false;
      return;
    }
    const res = await send({
      type: 'hunt:start',
      config: {
        name: S.huntNiche || keywords[0],
        keywords,
        country: form.country.value,
        target: form.target.value,
        minDays: form.minDays.value,
        maxDays: form.maxDays.value,
        maxLikes: form.maxLikes.value,
      },
    });
    if (!res || res.error) {
      err.textContent = (res && res.error) || 'Could not start the hunt.';
      err.hidden = false;
      return;
    }
    toast('Hunt started. Leads will appear here as they are found.');
    S.filters.hunt = res.hunt.id;
    setView('leads');
  });
}

/* Settings: presets (one list for both tabs) and the two scripts. */
function nicheRow(n = LH.cleanPreset({})) {
  const list = (attr, label, items, rows) =>
    `<label class="field"><span class="lbl">${label} <small>${items.length} · one per line</small></span><textarea class="inp" ${attr} rows="${rows}">${esc(items.join('\n'))}</textarea></label>`;
  return `<details class="tpl preset" data-niche-row ${n.name ? '' : 'open'}>
    <summary><b>${esc(n.name || 'New preset')}</b> <span class="muted">${n.keywords.length} keywords · ${n.areas.length} areas · ${n.minReviews} to ${n.maxReviews >= 100000 ? 'any' : n.maxReviews} reviews</span></summary>
    <div class="grid2">
      <label class="field"><span class="lbl">Name</span><input class="inp" data-niche-name value="${esc(n.name)}" placeholder="Pets" /></label>
      <label class="field"><span class="lbl">In your messages <small>{{niche}}: "We help ___ in Dubai"</small></span><input class="inp" data-niche-label value="${esc(n.label)}" placeholder="pet care businesses" /></label>
      <label class="field"><span class="lbl">Min Google reviews</span><input class="inp" type="number" min="0" data-niche-min value="${esc(n.minReviews)}" /></label>
      <label class="field"><span class="lbl">Max Google reviews</span><input class="inp" type="number" min="0" data-niche-max value="${n.maxReviews >= 100000 ? '' : esc(n.maxReviews)}" placeholder="no limit" /></label>
    </div>
    <div class="grid3">${list('data-niche-kw', 'Keywords', n.keywords, 8)}${list('data-niche-ex', 'Exclude words', n.exclude, 8)}${list('data-niche-areas', 'Areas', n.areas, 8)}</div>
    <div class="row" style="margin:0"><button type="button" class="btn sm ghost danger" data-act="del-niche">Delete preset</button></div>
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
/** null when the list is the defaults (or empty), so later default changes reach it. */
function readNiches(f) {
  const list = readPresetRows(f);
  const D = LH.DEFAULT_PRESETS.map(LH.cleanPreset);
  return !list.length || JSON.stringify(list) === JSON.stringify(D) ? null : list;
}

function emailCard(key, t) {
  const field = (part, label, rows) =>
    `<label class="field"><span class="lbl">${label}</span>${rows ? `<textarea class="inp" rows="${rows}" data-email="${key}.${part}">${esc(t[part])}</textarea>` : `<input class="inp" data-email="${key}.${part}" value="${esc(t[part])}" />`}</label>`;
  return `<div class="tpl" data-email-card="${key}"><div class="tpl-head"><h4>${esc(LH.OFFER_NAMES[key])} emails</h4><button type="button" class="btn sm ghost" data-act="reset-email" data-key="${key}">Reset to default</button></div>
    ${field('subject', 'Subject', 0)}${field('body', 'First email', 12)}${field('followup1', 'Follow up 1', 5)}${field('followup2', 'Follow up 2', 5)}</div>`;
}
function renderEmailsEditor(saved) {
  $('[data-emails]').innerHTML = Object.entries(LH.emailsFor({ emails: saved }))
    .map(([k, t]) => emailCard(k, t))
    .join('');
}
/** Only the parts that differ from the defaults are stored; null when nothing was changed. */
function readEdits(f, attr, defaults) {
  const out = {};
  $$(`[data-${attr}]`, f).forEach((el) => {
    const [k, part] = el.dataset[attr].split('.');
    const v = el.value.trim();
    if (defaults[k] && v !== defaults[k][part]) (out[k] = out[k] || {})[part] = v;
  });
  return Object.keys(out).length ? out : null;
}

/* Email sender status, as the site sees it: sent today, paused or not, and when the sender last checked in. */
const emailPaused = (e) => !!e && !e.error && (e.settings.paused || e.pausedUntil > e.now);
const PAUSED_WHY = { bounces: '3 emails bounced. Check your list then resume', limit: "Gmail's daily limit. It starts again tomorrow" };
async function loadEmailStatus() {
  if (S.settings.queueKey) {
    const r = await send({ type: 'email:status' });
    S.email = r && !r.error ? r : { error: (r && r.error) || 'Could not reach your site.' };
  }
  renderEmailSender();
}
function renderEmailSender() {
  const on = !!S.settings.queueKey;
  $('[data-email-nokey]').hidden = on;
  $('[data-email-on]').hidden = !on;
  const el = $('[data-email-status]');
  const e = S.email;
  if (!on) return;
  if (!e) return (el.textContent = 'Checking…');
  if (e.error) return (el.innerHTML = `<span class="err">${esc(e.error)}</span>`);
  const mins = Math.max(0, Math.round((e.now - e.senderSeenAt) / 60000));
  const seen = new Date(e.senderSeenAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const sender = !e.senderSeenAt ? 'Not set up yet' : mins < 15 ? `Running, last check ${mins ? `${mins} min ago` : 'just now'}` : `Not running since ${seen}`;
  const s = e.stats;
  el.innerHTML = `<div><b>${esc(sender)}</b>${emailPaused(e) ? ` <span class="tag amber">Paused: ${esc(PAUSED_WHY[e.pausedReason] || 'you paused it')}</span>` : ''}</div>
    <div class="muted">Sent today ${s.today} of ${s.cap} · ${s.queued} queued · ${s.replied} replied · ${s.bounced} bounced</div>`;
  $('[data-act="email-pause"]').textContent = emailPaused(e) ? 'Resume sending' : 'Pause sending';
}
async function emailSettings(settings) {
  const r = await send({ type: 'email:settings', settings });
  if (r && r.error) return toast(r.error);
  S.email = r;
  renderEmailSender();
}

function fillSettings() {
  const f = $('[data-settings-form]');
  const s = S.settings;
  $$('[data-ad-cities]', f).forEach((el) => (el.innerHTML = Object.keys(LH.AREAS).map((c) => `<option>${esc(c)}</option>`).join('')));
  for (const el of f.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = s[el.name] ?? '';
  }
  renderNicheEditor(LH.nichesFor(s));
  const il = LH.intentListsFor(s);
  $('[data-intent-lists]', f).innerHTML = Object.entries(il.keywords)
    .map(([k, list]) => `<label class="field"><span class="lbl">${esc(LH.INTENT_LABELS[k])} <small>one phrase per line</small></span><textarea class="inp" rows="5" data-intent-kw="${k}">${esc(list.join('\n'))}</textarea></label>`)
    .join('');
  $('[data-seller-words]', f).value = il.seller.join('\n');
  const hw = LH.heatWeightsFor(s);
  $('[data-heat-weights]', f).innerHTML = Object.entries(hw)
    .map(([group, w]) => `<div class="heat-group"><h4>${esc(LH.HEAT_GROUPS[group])}</h4>${Object.entries(w).map(([id, n]) => `<label class="heat-w"><span>${esc(LH.HEAT_LABELS[id])}</span><input class="inp" type="number" min="-100" max="100" data-heat-group="${group}" data-heat-id="${id}" value="${esc(n)}" /></label>`).join('')}</div>`)
    .join('');
  const targets = Array.isArray(s.targetNiches) ? s.targetNiches : null;
  $('[data-target-niches]', f).innerHTML = LH.presetsFor(s)
    .map((p) => `<label class="chk inline"><input type="checkbox" data-target-niche value="${esc(p.name)}" ${!targets || targets.includes(p.name) ? 'checked' : ''} /> ${esc(p.label || p.name)}</label>`)
    .join('');
  $('[data-weak-checks]', f).innerHTML = LH.weakChecksFor(s)
    .map((c) => `<div class="weak-row" data-weak-id="${esc(c.id)}"><span>${esc(c.label)}</span><input class="inp" type="number" min="0" max="100" data-weak-points value="${esc(c.points)}" aria-label="Points" /></div>`)
    .join('');
  renderEmailsEditor(s.emails);
  renderEmailSender();
  renderHistory();
  renderProblems();
}
const SOURCE_LABEL = { adlib: 'Meta Ad Library', maps: 'Google Maps', instagram: 'Instagram API', reddit: 'Reddit', facebook: 'Facebook groups', linkedin: 'LinkedIn' };
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
  el.textContent = keys.length ? `Remembering ${phones} phone number${phones === 1 ? '' : 's'} and ${keys.length - phones} websites, Instagram handles and names.` : 'Nothing remembered yet.';
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
  next.emailFollowups = Math.max(0, Math.min(2, Math.round(Number(next.emailFollowups)) || 0));
  next.emailMaxPerDay = Math.max(1, Math.min(40, Math.round(next.emailMaxPerDay)));
  next.nameMatch = Math.max(0.8, Math.min(1, Number(next.nameMatch) || LH.DEFAULT_SETTINGS.nameMatch));
  // Website checks: only what differs from the defaults is kept, so later improvements to the defaults still arrive.
  const edits = $$('[data-weak-id]', f)
    .map((row) => {
      const def = LH.WEAK_CHECKS.find((c) => c.id === row.dataset.weakId);
      const points = Number($('[data-weak-points]', row).value);
      const out = { id: def.id };
      if (Number.isFinite(points) && points !== def.points) out.points = Math.max(0, Math.min(100, Math.round(points)));
      return Object.keys(out).length > 1 ? out : null;
    })
    .filter(Boolean);
  next.weakChecks = edits.length ? edits : null;
  // Intent Radar lists: only the ones you changed are kept.
  const lists = {};
  for (const el of $$('[data-intent-kw]', f)) if (el.value.trim() !== (LH.INTENT_KEYWORDS[el.dataset.intentKw] || []).join('\n')) lists[el.dataset.intentKw] = el.value.trim();
  next.intentKeywords = Object.keys(lists).length ? lists : null;
  const sellerEl = $('[data-seller-words]', f);
  next.sellerWords = sellerEl.value.trim() === LH.SELLER_WORDS.join('\n') ? null : sellerEl.value.trim();
  // Heat weights: only what differs from the defaults is kept.
  const heat = {};
  for (const el of $$('[data-heat-id]', f)) {
    const def = LH.HEAT_WEIGHTS[el.dataset.heatGroup][el.dataset.heatId];
    const v = Number(el.value);
    if (el.value !== '' && Number.isFinite(v) && v !== def) (heat[el.dataset.heatGroup] = heat[el.dataset.heatGroup] || {})[el.dataset.heatId] = Math.max(-100, Math.min(100, Math.round(v)));
  }
  next.heatWeights = Object.keys(heat).length ? heat : null;
  if (next.heatWarm > next.heatHot) [next.heatWarm, next.heatHot] = [next.heatHot, next.heatWarm];
  const niches = $$('[data-target-niche]', f);
  next.targetNiches = niches.every((el) => el.checked) ? null : niches.filter((el) => el.checked).map((el) => el.value);
  if (next.followerMax < next.followerMin) [next.followerMin, next.followerMax] = [next.followerMax, next.followerMin];
  next.niches = readNiches(f);
  next.emails = readEdits(f, 'email', LH.DEFAULT_EMAILS);
  if (next.queueKey !== S.settings.queueKey) next.queueKeyAt = Date.now();
  if (next.queueSite && !/^https?:\/\//i.test(next.queueSite)) next.queueSite = `https://${next.queueSite}`;
  next.queueSite = (next.queueSite || '').replace(/\/+$/, '');
  // The daily limit lives on the site too, where the sender reads it.
  const siteMax = S.email && S.email.settings ? S.email.settings.maxPerDay : S.settings.emailMaxPerDay;
  await chrome.storage.local.set({ settings: next });
  S.settings = next;
  renderNicheChips();
  renderEmailSender();
  if (next.queueKey && next.emailMaxPerDay !== siteMax) await emailSettings({ maxPerDay: next.emailMaxPerDay });
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
  // Contacted memory: any CSV with phone numbers (your sheet, or Google Contacts > Export > Google CSV).
  $('[data-import-history]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const r = await send({ type: 'history:import', text: await file.text(), via: 'import' });
    if (!r || r.error) return toast((r && r.error) || 'Could not read that file.');
    toast(r.found ? `${r.found} phone numbers found, ${r.added} new. Future searches skip them.` : 'No UAE phone numbers found in that file.');
  });
  // Import presets: same name replaces a preset, new names are added. Nothing is kept until Save.
  $('[data-import-presets]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { presets, skipped } = LH.presetsFromJson(await file.text());
      const names = new Set(presets.map((p) => p.name.toLowerCase()));
      renderNicheEditor([...readPresetRows(f).filter((p) => !names.has(p.name.toLowerCase())), ...presets]);
      toast(`Imported ${presets.length} preset${presets.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} without a name or keywords` : ''}. Press Save settings to keep them.`);
    } catch (err) {
      toast(err.message);
    }
  });
}

async function emailLeads(ids, b) {
  if (!S.settings.queueKey) {
    toast('Add your site and key in Settings > Your site first.');
    return setView('settings');
  }
  if (b) b.disabled = true;
  const r = await send({ type: 'email:push', ids });
  if (b) b.disabled = false;
  if (!r || r.error) return toast((r && r.error) || 'Could not reach the email queue.');
  const k = r.skipped;
  const n = (reasons) => r.rejected.filter((x) => reasons.includes(x.reason)).length;
  const already = k.already.length + n(['duplicate', 'already_sent']);
  const other = r.rejected.length - n(['duplicate', 'already_sent', 'never']);
  const parts = [
    `${r.queued} added to the email queue`,
    k.noEmail.length && `${k.noEmail.length} ${k.noEmail.length === 1 ? 'has' : 'have'} no email`,
    k.runningAds.length && `${k.runningAds.length} ${k.runningAds.length === 1 ? 'runs' : 'run'} ads`,
    already && `${already} already emailed`,
    k.closed.length && `${k.closed.length} replied or closed`,
    (k.contacted || []).length && `${k.contacted.length} already contacted`,
    n(['never']) && `${n(['never'])} on the never email list`,
    other && `${other} could not be added`,
  ];
  return toast(parts.filter(Boolean).join(' · '));
}

/* ------------------------------------------------------------- listeners */
function bind() {
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // Filters
  $$('[data-f]').forEach((el) =>
    el.addEventListener(el.type === 'search' || el.type === 'number' ? 'input' : 'change', () => {
      const k = el.dataset.f;
      S.filters[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : el.value;
      if (k === 'keyword' && el.value) S.filters.hunt = '';
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
      tr.classList.toggle('sel', e.target.checked);
      renderTable();
      return;
    }
    if (e.target.closest('[data-replied]')) return toggleReplied(l);
    if (e.target.closest('a, select, [data-stop]')) return;
    openDrawer(l.id);
  });
  tbody.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    update(sel.closest('tr').dataset.id, { status: sel.value });
  });
  $('[data-sel-all]').addEventListener('change', (e) => {
    const ids = filtered().map((r) => r.l.id);
    ids.forEach((id) => (e.target.checked ? S.selected.add(id) : S.selected.delete(id)));
    renderTable();
  });
  $('[data-bulk-status]').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const ids = [...S.selected];
    for (const id of ids) await update(id, { status: e.target.value });
    toast(`Updated ${ids.length} leads`);
    e.target.value = '';
  });

  // Global actions
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act], [data-goto], [data-copy], [data-remove-phone]');
    if (!b) return;
    const l = S.openId ? S.leads.get(S.openId) : null;
    if (b.dataset.goto) {
      setView(b.dataset.goto);
      if (b.dataset.anchor) {
        closeDrawer();
        const t = document.getElementById(b.dataset.anchor);
        if (t) t.scrollIntoView({ block: 'start' });
      }
      return;
    }
    if (b.dataset.copy) return copy(b.dataset.copy);
    if (b.dataset.removePhone && l) return update(l.id, { removePhone: b.dataset.removePhone });
    const act = b.dataset.act;
    if (await intentAction(act, b)) return;
    if (await prospectAction(act, b, l, e)) return;
    switch (act) {
      case 'close':
        return closeDrawer();
      case 'export-csv':
        return exportCsv(filtered().map((r) => r.l));
      case 'bulk-export':
        return exportCsv([...S.selected].map((id) => S.leads.get(id)).filter(Boolean));
      case 'export-full':
        return exportFull(filtered().map((r) => r.l));
      case 'export-contacts':
        return exportContacts(filtered().map((r) => r.l));
      case 'bulk-contacts':
        return exportContacts([...S.selected].map((id) => S.leads.get(id)).filter(Boolean));
      case 'bulk-recheck':
        await send({ type: 'lead:recheck', ids: [...S.selected] });
        return toast(`Re-checking ${S.selected.size} websites`);
      case 'bulk-delete': {
        const ids = [...S.selected];
        if (!confirm(`Delete ${ids.length} leads? They may come back if you hunt the same keywords again.`)) return;
        await send({ type: 'lead:delete', ids });
        S.selected.clear();
        return toast(`Deleted ${ids.length} leads`);
      }
      case 'bulk-clear':
        S.selected.clear();
        return renderTable();
      case 'enrich-pending': {
        const ids = [...S.leads.values()].filter((x) => (x.site || {}).state === 'pending').map((x) => x.id);
        await send({ type: 'lead:recheck', ids });
        return toast(`Checking ${ids.length} websites`);
      }
      case 'stop-hunt':
        await send({ type: 'hunt:stop' });
        return toast('Hunt stopped');
      case 'show-hunt-tab':
        if (S.hunt && S.hunt.tabId) chrome.tabs.update(S.hunt.tabId, { active: true }).catch(() => toast('The hunt tab is closed'));
        return;
      case 'filter-hunt':
        S.filters.hunt = b.dataset.hunt;
        S.filters.keyword = '';
        S.filters.status = '';
        $('[data-f="status"]').value = '';
        return setView('leads');
      case 'clear-hunt-filter':
        S.filters.hunt = '';
        return renderAll();
      case 'dismiss-hunt':
        try {
          localStorage.setItem('lh-dismissed-hunt', b.dataset.hunt);
        } catch {}
        S.filters.hunt = '';
        return renderAll();
      case 'manual-search': {
        const f = $('[data-hunt-form]');
        const kw = f.keywords.value.split('\n')[0].trim();
        return openTab(LH.adLibraryUrl({ keyword: kw, country: f.country.value }));
      }
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
        return toast('Back to the 5 default presets. Save to keep them.');
      case 'reset-email':
        b.closest('[data-email-card]').outerHTML = emailCard(b.dataset.key, LH.DEFAULT_EMAILS[b.dataset.key]);
        return toast('Emails reset. Save to keep them.');
      case 'email-pause':
        return emailSettings({ paused: !emailPaused(S.email) });
      case 'copy-sender': {
        // The sender script with your site and key filled into its first two lines.
        const { queueSite, queueKey } = await saveSettings();
        if (!queueKey || !queueSite) return toast('Add your site and key under Your site first');
        const text = await (await fetch(chrome.runtime.getURL('email/sender.gs'))).text();
        const js = (v) => `'${String(v).replace(/[\\']/g, '\\$&')}'`;
        return copy(text.replace(/var SITE = '__SITE__'/, () => `var SITE = ${js(queueSite)}`).replace(/var KEY = '__KEY__'/, () => `var KEY = ${js(queueKey)}`));
      }
      case 'backup': {
        const settings = { ...S.settings, pagespeedKey: '', placesKey: '', queueKey: '' }; // keep keys out of backups
        return download(`lead-hunter-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, leads: [...S.leads.values()] }), 'application/json');
      }
      case 'wipe':
        if (!confirm(`Delete all ${S.leads.size} leads? Download a backup first if you might need them.`)) return;
        await send({ type: 'lead:delete', ids: [...S.leads.keys()] });
        return toast('All leads deleted');
      // Drawer actions
      case 'recheck':
        if (!l) return;
        await send({ type: 'lead:recheck', ids: [l.id] });
        return toast('Re-checking website');
      case 'psi': {
        if (!l) return;
        b.disabled = true;
        b.textContent = 'Running Google speed test… (up to a minute)';
        const r = await send({ type: 'lead:psi', id: l.id });
        if (r && r.error) toast(r.error);
        else toast(`Google mobile speed: ${r.psi.performance}/100`);
        return;
      }
      case 'places': {
        if (!l) return;
        b.disabled = true;
        b.textContent = 'Searching Google…';
        const r = await send({ type: 'lead:places', id: l.id });
        if (r && r.error) toast(r.error);
        else toast(r.places && r.places.match ? 'Found on Google Maps' : 'No confident match on Google Maps');
        return;
      }
      case 'email-queue':
        if (l) await emailLeads([l.id], b);
        return;
      case 'email-stop': {
        if (!l) return;
        const r = await send({ type: 'email:cancel', ids: [l.id] });
        return toast(r && r.error ? `${r.error} Lead Hunter keeps trying.` : `No more emails to “${l.pageName}”`);
      }
      case 'email-never': {
        if (!l) return;
        const r = await send({ type: 'email:never', id: l.id });
        if (r && r.error) return toast(r.error);
        return toast(`Lead Hunter will never email “${l.pageName}”`, () => send({ type: 'email:never', id: l.id, remove: true }));
      }
      case 'ig-lookup': {
        if (!l) return;
        const r = await send({ type: 'ig:lookup', ids: [l.id] });
        return toast(r && r.error ? r.error : 'Looking up their followers with the Instagram API');
      }
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
        out.textContent = 'Asking Claude…';
        out.className = 'hint';
        const r = await send({ type: 'ai:test' });
        out.textContent = !r ? 'Lead Hunter did not answer. Reload the extension.' : r.error ? `Not working: ${r.error}` : `Working. Claude read a test post: ${r.result.is_buyer ? 'a buyer' : 'not a buyer'}, needs ${r.result.service_needed.replace(/_/g, ' ')}, score ${r.result.intent_score}.`;
        out.className = `hint ${r && !r.error ? 'ok' : 'err'}`;
        return;
      }
      case 'ig-resume':
        await send({ type: 'ig:resume' });
        return toast('Instagram lookups resumed');
      case 'mark-via':
        if (!l) return;
        if (!markContacted(l, null, b.dataset.via)) {
          update(l.id, { via: b.dataset.via });
          toast(`Saved: contacted on ${VIA[b.dataset.via]}`);
        }
        return;
      case 'reset-contacted':
        if (!l) return;
        await send({ type: 'lead:reset', id: l.id });
        return toast(`“${l.pageName}” is new again. Future searches can find it.`);
      case 'history-clear': {
        const n = Object.keys(S.history).length;
        if (!n || !confirm(`Forget all ${n} remembered contacts? Searches can then find businesses you already contacted.`)) return;
        await send({ type: 'history:clear' });
        return toast('Contacted memory cleared.');
      }
      case 'bulk-email':
        return emailLeads(filtered().map((r) => r.l.id).filter((id) => S.selected.has(id)), b);
      case 'gen-key': {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const input = $('[data-settings-form] [name="queueKey"]');
        input.value = k;
        input.type = 'text';
        return toast('New key made. Copy it into Netlify, then press Save & test.');
      }
      case 'copy-key': {
        const k = $('[data-settings-form] [name="queueKey"]').value.trim();
        return k ? copy(k) : toast('Generate a key first');
      }
      case 'test-queue': {
        const out = $('[data-queue-status]');
        await saveSettings();
        if (!S.settings.queueKey) return (out.textContent = 'Add a key first.');
        out.textContent = 'Testing…';
        const r = await send({ type: 'email:status' });
        out.textContent = r && r.error ? r.error : 'Connected to your site.';
        out.style.color = r && r.error ? 'var(--poor)' : 'var(--good)';
        return loadEmailStatus();
      }
      case 'delete-lead':
        if (!l || !confirm(`Delete ${l.pageName}?`)) return;
        await send({ type: 'lead:delete', ids: [l.id] });
        closeDrawer();
        return toast('Lead deleted');
    }
  });

  // Drawer inputs
  const drawer = $('[data-drawer]');
  let notesTimer = 0;
  drawer.addEventListener('input', (e) => {
    if (e.target.matches('[data-notes]')) {
      clearTimeout(notesTimer);
      const id = S.openId;
      const v = e.target.value;
      notesTimer = setTimeout(() => update(id, { notes: v }), 600);
    }
  });
  drawer.addEventListener('change', (e) => {
    if (e.target.matches('[data-status]') && S.openId) update(S.openId, { status: e.target.value });
  });
  drawer.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (!S.openId) return;
    if (f.matches('[data-add-phone]') && f.phone.value.trim()) {
      update(S.openId, { addPhone: f.phone.value.trim() });
      f.phone.value = '';
    }
    if (f.matches('[data-set-website]') && f.website.value.trim()) {
      update(S.openId, { website: f.website.value.trim() });
      toast('Checking that website');
    }
  });
  $('[data-scrim]').addEventListener('click', closeDrawer);
  // Results panels (one per tab) open and close together, and remember it.
  $$('[data-results]').forEach((el) => {
    try {
      el.open = localStorage.getItem('lh-results-open') === '1';
    } catch {}
    el.addEventListener('toggle', () => {
      try {
        localStorage.setItem('lh-results-open', el.open ? '1' : '0');
      } catch {}
      $$('[data-results]').forEach((x) => x.open !== el.open && (x.open = el.open));
    });
  });
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
      toast(`Restored ${r.imported} leads`);
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
  initHuntForm();
  initSettings();
  initProspects();
  initIntent();
  fillSettings();
  const hash = location.hash.replace('#', '');
  setView(['leads', 'hunt', 'settings', 'ads', 'intent'].includes(hash) ? hash : 'leads');
  if (S.settings.queueKey) send({ type: 'queue:sync' }).catch(() => {});
})();
