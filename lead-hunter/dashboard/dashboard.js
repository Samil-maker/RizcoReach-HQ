/* Lead Hunter dashboard: lead table, detail drawer with pitch composer, hunts and settings.
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
  settings: { ...LH.DEFAULT_SETTINGS },
  hunt: null,
  queue: [],
  selected: new Set(),
  view: 'leads',
  openId: null,
  pitch: { id: null, angle: null, channel: 'whatsapp', dirty: false, phone: null },
  filters: { q: '', heat: '', status: '', keyword: '', site: '', contact: '', minDays: 0, hideBig: true, sort: 'priority', hunt: '' },
};

/* ------------------------------------------------------------------ data */
async function load() {
  const all = await chrome.storage.local.get(null);
  S.leads = new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith('lead:'))
      .map(([, v]) => [v.id, v]),
  );
  S.settings = { ...LH.DEFAULT_SETTINGS, ...(all.settings || {}) };
  S.hunt = all.hunt || null;
  S.finder = all.finder || null;
  S.adQueue = all.adCheckQueue || [];
  S.adPaused = !!all.adCheckPaused;
  S.queue = all.enrichQueue || [];
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
      if (newValue) S.leads.set(id, newValue);
      else {
        S.leads.delete(id);
        S.selected.delete(id);
      }
    } else if (k === 'settings') {
      S.settings = { ...LH.DEFAULT_SETTINGS, ...(newValue || {}) };
      settingsChanged = true;
    } else if (k === 'hunt') S.hunt = newValue || null;
    else if (k === 'enrichQueue') S.queue = newValue || [];
    else if (k === 'finder') S.finder = newValue || null;
    else if (k === 'adCheckQueue') S.adQueue = newValue || [];
    else if (k === 'adCheckPaused') S.adPaused = !!newValue;
  }
  if (settingsChanged && S.view !== 'settings') fillSettings();
  scheduleRender();
});

/* --------------------------------------------------------------- filters */
function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const rows = [];
  for (const l of S.leads.values()) {
    if (l.kind === 'prospect') continue; // Meta-ads prospects live in their own tab
    const p = LH.priority(l, now);
    if (f.hunt && !(l.hunts || []).includes(f.hunt)) continue;
    if (f.hideBig && (l.pageLikes || 0) > BIG_BRAND) continue;
    if (f.heat && LH.heat(p) !== f.heat) continue;
    if (f.status === '' && l.status === 'skip') continue;
    if (f.status && f.status !== 'all' && l.status !== f.status) continue;
    if (f.keyword && !(l.keywords || []).includes(f.keyword)) continue;
    const site = l.site || {};
    if (f.site === 'none' && l.website) continue;
    if (f.site === 'has' && !l.website) continue;
    if (f.site === 'broken' && !(site.state === 'error' || site.parked)) continue;
    if (f.site === 'weak' && !(typeof site.score === 'number' && site.score < 60)) continue;
    if (f.site === 'nopixel' && !(site.state === 'ok' && !site.parked && site.pixel === false)) continue;
    if (f.contact === 'phone' && !l.phones.length) continue;
    if (f.contact === 'wa' && !LH.whatsappTarget(l)) continue;
    if (f.contact === 'email' && !(l.emails || []).length) continue;
    if (f.contact === 'nophone' && l.phones.length) continue;
    if (f.minDays && (LH.daysRunning(l, now) ?? -1) < f.minDays) continue;
    if (q) {
      const hay = [l.pageName, l.website, ...(l.keywords || []), ...(l.categories || []), ...l.phones.map((x) => x.number), ...(l.emails || []), l.notes]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ l, p });
  }
  const score = (l) => (l.website ? (typeof (l.site || {}).score === 'number' ? l.site.score : 101) : -1);
  const sorters = {
    priority: (a, b) => b.p - a.p,
    days: (a, b) => (LH.daysRunning(b.l, now) ?? -1) - (LH.daysRunning(a.l, now) ?? -1),
    ads: (a, b) => (b.l.activeAdCount || 0) - (a.l.activeAdCount || 0),
    score: (a, b) => score(a.l) - score(b.l),
    newest: (a, b) => (b.l.createdAt || 0) - (a.l.createdAt || 0),
    name: (a, b) => (a.l.pageName || '').localeCompare(b.l.pageName || ''),
  };
  return rows.sort((a, b) => sorters[f.sort](a, b) || b.p - a.p);
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
  // Show the number the WhatsApp button opens, so what you see is who you message.
  const shown = wa || (best && best.number);
  if (shown)
    parts.push(
      `<div class="p"><span class="num">${esc(LH.formatPhone(shown))}</span>${wa ? `<button class="icon-btn wa" data-wa title="Open WhatsApp with your pitch" aria-label="WhatsApp ${esc(l.pageName)}">${ICON.wa}</button>` : ''}</div>`,
    );
  const extras = [];
  if ((l.emails || [])[0]) extras.push(`<span title="${esc(l.emails[0])}">${ICON.mail}</span>`);
  if ((l.socials || {}).instagram) extras.push(`<span title="Instagram">${ICON.ig}</span>`);
  if (extras.length) parts.push(`<div class="p muted" style="gap:8px">${extras.join('')}${!best && l.emails[0] ? `<span>${esc(l.emails[0])}</span>` : ''}</div>`);
  if (!parts.length) {
    const st = (l.site || {}).state;
    return ['queued', 'running'].includes(st) ? '<span class="muted">Looking…</span>' : '<span class="muted">No contact yet</span>';
  }
  if (l.phoneQueue && l.phoneQueue.state === 'queued') parts.push('<div class="p"><span class="tag phone" title="Waiting in your phone queue">On your phone</span></div>');
  return `<div class="contact">${parts.join('')}</div>`;
}

function rowHtml({ l, p }) {
  const heat = LH.heat(p);
  const days = LH.daysRunning(l);
  const meta = [l.categories && l.categories[0], l.keywords && l.keywords[0] && `“${l.keywords[0]}”`].filter(Boolean).join(' · ');
  const dim = ['lost', 'skip', 'won'].includes(l.status) ? ' dim' : '';
  return `<tr data-id="${esc(l.id)}" class="${S.selected.has(l.id) ? 'sel' : ''}${dim}">
    <td class="c-sel"><input type="checkbox" data-sel ${S.selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.pageName)}" /></td>
    <td><span class="heat ${heat}" title="Priority ${p}/100">${p}</span></td>
    <td><div class="biz">${avatar(l)}<div style="min-width:0"><div class="n">${esc(l.pageName || 'Unknown page')}</div><div class="m">${esc(meta)}</div></div></div></td>
    <td class="nowrap"><b class="num">${l.activeAdCount || 0}</b> <span class="muted">active</span><div class="muted">${esc(daysText(days))}</div></td>
    <td>${siteCell(l)}</td>
    <td>${issueCell(l)}</td>
    <td>${contactCell(l)}</td>
    <td><select class="status-sel" data-status aria-label="Status">${statusOptions(l.status)}</select></td>
    <td><button class="btn sm" data-open>Pitch</button></td>
  </tr>`;
}

/* ---------------------------------------------------------------- render */
function renderKpis() {
  if (S.view === 'ads') return renderProspectKpis();
  const leads = [...S.leads.values()].filter((l) => l.kind !== 'prospect');
  const now = Date.now();
  const hot = leads.filter((l) => l.status === 'new' && LH.heat(LH.priority(l, now)) === 'hot').length;
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
  $('[data-rows]').innerHTML = rows.map(rowHtml).join('');
  $('[data-empty]').hidden = rows.length > 0 || S.leads.size === 0;
  $('[data-count]').innerHTML = S.leads.size
    ? `Showing ${rows.length} of ${S.leads.size} leads${S.filters.hunt ? ' from one hunt' : ''}.${S.filters.hideBig ? ' Big brands hidden.' : ''}` +
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

function renderAll() {
  renderKpis();
  renderBanner();
  if (S.view === 'leads') {
    renderFilterOptions();
    renderTable();
  }
  if (S.view === 'hunt') renderLastHunt();
  if (S.view === 'ads') renderProspectsView();
  if (S.openId) renderDrawer();
}

/* ---------------------------------------------------------------- drawer */
function openDrawer(id) {
  const l = S.leads.get(id);
  if (!l) return;
  S.openId = id;
  S.pitch = { id, angle: LH.pitchAngle(l), channel: 'whatsapp', dirty: false, phone: LH.whatsappTarget(l) };
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

/* Settings for rendering a pitch; Meta-ads pitches also get how many competitors advertise. */
function pitchSettings(l) {
  return l && l.kind === 'prospect' ? { ...S.settings, __competitors: competitorCount(l) } : S.settings;
}
function currentPitch(l) {
  return LH.pitchFor(l, pitchSettings(l), S.pitch.angle);
}

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
    body: S.pitch.dirty && $('[data-pitch-body]', d) ? $('[data-pitch-body]', d).value : null,
    subject: S.pitch.dirty && $('[data-pitch-subject]', d) ? $('[data-pitch-subject]', d).value : null,
    scroll: fresh ? 0 : d.scrollTop,
  };
  d.innerHTML = drawerHtml(l);
  if (keep.notes != null && keep.notes !== (l.notes || '')) $('[data-notes]', d).value = keep.notes;
  if (keep.body != null) $('[data-pitch-body]', d).value = keep.body;
  if (keep.subject != null && $('[data-pitch-subject]', d)) $('[data-pitch-subject]', d).value = keep.subject;
  d.scrollTop = keep.scroll;
  drawPitchQr();
}

/* QR code for the pitch: scan with a phone and WhatsApp opens there with the message ready. */
function drawPitchQr() {
  const canvas = $('[data-pitch-qr]');
  if (!canvas) return;
  const phone = ($('[data-pitch-phone]') || {}).value;
  const text = ($('[data-pitch-body]') || {}).value || '';
  const ok = phone && LH.drawQr(canvas, LH.waLink(phone, text), 232);
  canvas.hidden = !ok;
  $('[data-qr-err]').hidden = !!ok;
}

function zoomQr(text) {
  const el = document.createElement('div');
  el.className = 'qr-zoom';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'QR code, click to close');
  const c = document.createElement('canvas');
  el.appendChild(c);
  document.body.appendChild(el);
  LH.drawQr(c, text, Math.min(innerWidth, innerHeight) * 0.92);
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  el.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
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
    body = `<p>No website found. The ads send people to <b>${esc(LH.destinationLabel(l.destinationKind))}</b>. That is your pitch: a proper landing page converts better than a chat window for most people who are still comparing options.</p>
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
          <a class="icon-btn wa" href="https://wa.me/${esc(p.number.replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer" title="Open chat" aria-label="WhatsApp ${esc(p.number)}">${ICON.wa}</a>
          <a class="btn sm ghost" href="tel:${esc(p.number)}">Call</a>
          <button class="btn sm ghost" data-copy="${esc(p.number)}">Copy</button>
          <button class="btn sm ghost" data-remove-phone="${esc(p.number)}" aria-label="Remove number">✕</button></div>`,
        )
        .join('')}</div>`
    : `<p class="muted">No phone number found yet.</p>`;
  const emails = (l.emails || []).map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(' · ');
  const socials = Object.entries(l.socials || {})
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

function pitchSection(l) {
  const p = currentPitch(l);
  const { all, defaults } = LH.templatesFor(l, S.settings);
  const angles = Object.keys(defaults)
    .map((k) => `<button class="chip ${k === p.angle ? 'on' : ''}" data-angle="${k}">${esc((all[k] || defaults[k]).name)}</button>`)
    .join('');
  const channels = [
    ['whatsapp', 'WhatsApp'],
    ['email', 'Email'],
    ['dm', 'Instagram DM'],
  ]
    .map(([k, n]) => `<button class="chip ${k === S.pitch.channel ? 'on' : ''}" data-channel="${k}">${n}</button>`)
    .join('');
  const waNumbers = l.phones.map((x) => x.number);
  const waSel = S.pitch.phone && waNumbers.includes(S.pitch.phone) ? S.pitch.phone : LH.whatsappTarget(l) || waNumbers[0] || '';
  const body = S.pitch.channel === 'email' ? p.email : p.whatsapp;
  let send = '';
  if (S.pitch.channel === 'whatsapp') {
    send = waNumbers.length
      ? `<select class="inp" data-pitch-phone aria-label="Send to">${waNumbers.map((n) => `<option value="${esc(n)}" ${n === waSel ? 'selected' : ''}>${esc(LH.formatPhone(n))}</option>`).join('')}</select>
         <button class="btn" data-act="send-wa" title="Opens WhatsApp Web or the WhatsApp desktop app">${ICON.wa.replace('<svg', '<svg width="16" height="16"')} WhatsApp on this computer</button>`
      : `<span class="muted">Add a number below to send on WhatsApp.</span>`;
  } else if (S.pitch.channel === 'email') {
    send = (l.emails || []).length ? `<button class="btn pri" data-act="send-email">Open email to ${esc(l.emails[0])}</button>` : `<span class="muted">No email found. Copy the text instead.</span>`;
  } else {
    send = (l.socials || {}).instagram
      ? `<button class="btn pri" data-act="send-dm">Copy &amp; open Instagram</button>`
      : `<a class="btn" href="${esc(safeHref(l.pageUrl))}" target="_blank" rel="noopener noreferrer" data-act="copy-open">Copy &amp; open Facebook page</a>`;
  }
  return `<section class="d-sec pitch"><h3>Pitch <span class="tag">${esc((all[p.angle] || defaults[p.angle]).name)} angle</span></h3>
    <div class="pitch-tabs">${channels}</div>
    <div class="pitch-tabs">${angles}</div>
    ${S.pitch.channel === 'email' ? `<input class="inp" data-pitch-subject value="${esc(p.subject)}" aria-label="Email subject" style="margin-bottom:8px" />` : ''}
    <textarea class="inp" data-pitch-body aria-label="Message">${esc(body)}</textarea>
    <div class="row">${send}<button class="btn" data-act="copy-pitch">Copy</button></div>
    ${S.pitch.channel === 'whatsapp' && waNumbers.length ? phoneBlock() : ''}
    <p class="hint">Opening WhatsApp or email here marks the lead as contacted. Edit the message freely; edits are not saved to the template.</p>
  </section>`;
}

function phoneBlock() {
  const queueOn = S.settings.queueKey && S.settings.queueSite;
  return `<div class="qr-wrap">
      <canvas data-pitch-qr title="Click to enlarge" aria-label="QR code that opens this WhatsApp message on your phone"></canvas>
      <div><b>Send from your phone</b>
        <p>Point your phone's camera at the code. WhatsApp opens on your phone with this number and message ready; just press send. Click the code to make it bigger.</p>
        <p class="qr-err" data-qr-err hidden>This message is too long for one QR code. Shorten it a little.</p>
        <div class="row" style="margin-top:0">
          <button class="btn sm pri" data-act="mark-contacted">I sent it</button>
          ${queueOn ? '<button class="btn sm" data-act="queue-one">Send to phone queue</button>' : '<button class="btn sm ghost" data-goto="settings" data-anchor="phone">Set up phone queue</button>'}
        </div>
      </div>
    </div>`;
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
        <div class="links"><span class="heat ${LH.heat(p)}">${p}</span>
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
        ${l.contactedAt ? `<span class="muted">Contacted ${esc(fmtDate(l.contactedAt))}</span>` : ''}
        <span class="muted">Found ${esc(fmtDate(l.createdAt))} via ${esc((l.keywords || []).join(', ') || 'browsing')}</span>
      </div>
    </section>
    ${pitchSection(l)}
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
function markContacted(l) {
  if (l.status !== 'new') return;
  update(l.id, { status: 'contacted' });
  toast(`Marked “${l.pageName}” as contacted`, () => update(l.id, { status: 'new' }));
}
function openTab(url) {
  chrome.tabs.create({ url });
}
function quickWhatsApp(l) {
  const n = LH.whatsappTarget(l);
  if (!n) return;
  const p = LH.pitchFor(l, S.settings);
  openTab(`https://wa.me/${n.replace(/\D/g, '')}?text=${encodeURIComponent(p.whatsapp)}`);
  markContacted(l);
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
function exportCsv(leads) {
  if (leads.length && leads.every((l) => l.kind === 'prospect')) return exportProspectsCsv(leads);
  const now = Date.now();
  const head = ['priority', 'heat', 'business', 'facebook_page', 'all_ads', 'keywords', 'category', 'page_likes', 'active_ads', 'days_running', 'first_ad_started', 'website', 'landing_page', 'website_score', 'website_status', 'builder', 'meta_pixel', 'top_issues', 'phone', 'whatsapp_link', 'whatsapp_message_link', 'other_phones', 'email', 'instagram', 'google_rating', 'google_reviews', 'status', 'notes', 'found_on'];
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
      best ? LH.formatPhone(best.number) : '',
      wa ? LH.waLink(wa) : '',
      wa ? LH.waLink(wa, LH.pitchFor(l, S.settings).whatsapp) : '',
      l.phones.filter((x) => !best || x.number !== best.number).map((x) => LH.formatPhone(x.number)).join('; '),
      (l.emails || [])[0] || '',
      (l.socials || {}).instagram || '',
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
  if (S.view !== v) S.selected.clear();
  S.view = v;
  $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $$('[data-view-panel]').forEach((p) => (p.hidden = p.dataset.viewPanel !== v));
  if (v === 'settings') fillSettings();
  if (v === 'hunt') renderLastHunt();
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

function initHuntForm() {
  const form = $('[data-hunt-form]');
  $('[data-presets]').innerHTML = Object.keys(LH.NICHES)
    .map((n) => `<button type="button" class="chip" data-preset="${esc(n)}">${esc(n)}</button>`)
    .join('');
  $$('[data-countries]').forEach((s) => (s.innerHTML = countryOptions(S.settings.country)));
  let preset = '';
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    preset = b.dataset.preset;
    form.keywords.value = LH.NICHES[preset].join('\n');
    $$('[data-preset]', form).forEach((c) => c.classList.toggle('on', c === b));
  });
  form.keywords.addEventListener('input', () => {
    preset = '';
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
        name: preset || keywords[0],
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

function templateEditor(tpls, defaults = LH.DEFAULT_TEMPLATES, attr = 'data-tpl') {
  return Object.entries(defaults)
    .map(([k, def]) => {
      const t = { ...def, ...((tpls || {})[k] || {}) };
      return `<div class="tpl"><h4>${esc(def.name)}</h4>
      <label class="field"><span class="lbl">WhatsApp / DM</span><textarea class="inp" rows="6" ${attr}="${k}.whatsapp">${esc(t.whatsapp)}</textarea></label>
      <label class="field"><span class="lbl">Email subject</span><input class="inp" ${attr}="${k}.subject" value="${esc(t.subject)}" /></label>
      <label class="field"><span class="lbl">Email body</span><textarea class="inp" rows="7" ${attr}="${k}.email">${esc(t.email)}</textarea></label></div>`;
    })
    .join('');
}
function readTemplates(f, attr, defaults) {
  const out = {};
  $$(`[${attr}]`, f).forEach((el) => {
    const [k, field] = el.getAttribute(attr).split('.');
    out[k] = out[k] || { name: defaults[k].name };
    out[k][field] = el.value;
  });
  const same = Object.entries(out).every(([k, t]) => ['whatsapp', 'subject', 'email'].every((x) => t[x] === defaults[k][x]));
  return same ? null : out;
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
  $('[data-templates]').innerHTML = templateEditor(s.templates);
  $('[data-ad-templates]').innerHTML = templateEditor(s.adTemplates, LH.DEFAULT_AD_TEMPLATES, 'data-adtpl');
  renderPairQr();
}
function renderPairQr() {
  const box = $('[data-pair]');
  const { queueKey, queueSite } = S.settings;
  let url = '';
  try {
    url = queueKey && queueSite ? `${new URL('/outreach', queueSite)}#k=${encodeURIComponent(queueKey)}&t=${S.settings.queueKeyAt || 0}` : '';
  } catch {}
  box.hidden = !url;
  if (url) LH.drawQr($('[data-pair-canvas]'), url, 200);
}

async function saveSettings() {
  const f = $('[data-settings-form]');
  const next = { ...S.settings };
  for (const el of f.elements) {
    if (!el.name || !(el.name in LH.DEFAULT_SETTINGS)) continue;
    next[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || LH.DEFAULT_SETTINGS[el.name] : el.value.trim();
  }
  next.templates = readTemplates(f, 'data-tpl', LH.DEFAULT_TEMPLATES);
  next.adTemplates = readTemplates(f, 'data-adtpl', LH.DEFAULT_AD_TEMPLATES);
  if (next.queueKey !== S.settings.queueKey) next.queueKeyAt = Date.now();
  if (next.queueSite && !/^https?:\/\//i.test(next.queueSite)) next.queueSite = `https://${next.queueSite}`;
  next.queueSite = (next.queueSite || '').replace(/\/+$/, '');
  await chrome.storage.local.set({ settings: next });
  S.settings = next;
  renderPairQr();
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
}

async function queueLeads(ids, b) {
  if (!S.settings.queueKey) {
    toast('Set up the phone queue in Settings first (takes 2 minutes).');
    return setView('settings');
  }
  const overrides = {};
  for (const id of ids) {
    const l = S.leads.get(id);
    if (l) overrides[id] = { message: LH.pitchFor(l, pitchSettings(l)).whatsapp };
  }
  if (b) b.disabled = true;
  const r = await send({ type: 'queue:push', ids, overrides });
  if (b) b.disabled = false;
  if (r && r.error) return toast(r.error);
  return toast(`Sent ${r.queued} to your phone${r.skipped.length ? ` · ${r.skipped.length} skipped (no phone number)` : ''}`);
}

/* ------------------------------------------------------------ phone mode */
// One lead at a time with a big QR: scan with the phone, send in WhatsApp, press Enter for the next.
const PM = { ids: [], i: 0, sent: 0, edits: {}, phones: {} };
const pmLead = () => S.leads.get(PM.ids[PM.i]);
const pmText = (l) => PM.edits[l.id] ?? LH.pitchFor(l, pitchSettings(l)).whatsapp;
function pmPhone(l) {
  const nums = l.phones.map((p) => p.number);
  return PM.phones[l.id] && nums.includes(PM.phones[l.id]) ? PM.phones[l.id] : LH.whatsappTarget(l) || nums[0];
}

function openPhoneMode(ids) {
  const list = ids.map((id) => S.leads.get(id)).filter((l) => l && l.phones.length && !['won', 'lost', 'skip'].includes(l.status));
  if (!list.length) return toast('None of these leads has a phone number yet.');
  // Leads you have not contacted yet come first; otherwise keep the current sort order.
  list.sort((a, b) => Number(a.status !== 'new') - Number(b.status !== 'new'));
  Object.assign(PM, { ids: list.map((l) => l.id), i: 0, sent: 0, edits: {}, phones: {} });
  closeDrawer();
  $('[data-pm]').hidden = false;
  renderPm();
}
function closePhoneMode() {
  $('[data-pm]').hidden = true;
  if (PM.sent) toast(`${PM.sent} lead${PM.sent === 1 ? '' : 's'} marked as contacted`);
}

function drawPmQr() {
  const l = pmLead();
  const c = $('[data-pm-qr]');
  if (!l || !c) return;
  const ok = LH.drawQr(c, LH.waLink(pmPhone(l), pmText(l)), Math.max(260, Math.min(440, innerHeight - 250)));
  c.hidden = !ok;
  $('[data-pm-qr-err]').hidden = ok;
}

function renderPm() {
  const box = $('[data-pm-box]');
  const total = PM.ids.length;
  const head = (extra = '') => `<header class="pm-head"><b>Phone mode</b>${extra}<button class="btn sm ghost x" data-pm="close" aria-label="Close phone mode">✕</button></header>`;
  if (PM.i >= total) {
    box.innerHTML = `${head()}<div class="pm-done"><h2>All done</h2><p class="muted">You went through ${total} lead${total === 1 ? '' : 's'} and marked ${PM.sent} as contacted.</p><button class="btn pri" data-pm="close">Back to leads</button></div>`;
    box.focus();
    return;
  }
  const l = pmLead();
  if (!l) {
    PM.ids.splice(PM.i, 1);
    return renderPm();
  }
  const p = LH.priority(l);
  const days = LH.daysRunning(l);
  const issues = l.kind === 'prospect' ? prospectHighlights(l) : !l.website ? [`No website: ads go to ${LH.destinationLabel(l.destinationKind)}`] : ((l.site || {}).issues || []).slice(0, 3).map((i) => i.label);
  const nums = l.phones.map((x) => x.number);
  const cur = pmPhone(l);
  const st = LH.STATUSES.find((x) => x.id === l.status);
  box.innerHTML = `${head(`<span class="muted num">${PM.i + 1} of ${total} · ${PM.sent} sent</span><span class="pm-prog"><i style="width:${Math.round((100 * PM.i) / total)}%"></i></span>`)}
    <div class="pm-body">
      <div class="pm-qr">
        <canvas data-pm-qr title="Click to enlarge" aria-label="QR code: opens WhatsApp on your phone with this message"></canvas>
        <p class="qr-err" data-pm-qr-err hidden>Message too long for one QR code. Shorten it a little.</p>
        <p>Scan with your phone's camera. WhatsApp opens with the number and message ready; press send, then <b>Enter</b> here for the next lead. Click the code to make it bigger.</p>
      </div>
      <div class="pm-info">
        <h2>${esc(l.pageName || 'Unknown page')} <span class="heat ${LH.heat(p)}">${p}</span>${l.status !== 'new' ? `<span class="tag">${esc(st ? st.label : l.status)}</span>` : ''}</h2>
        <div class="muted">${esc(l.kind === 'prospect' ? [l.niche, l.area, LH.domainOf(l.website || '') || 'No website'].filter(Boolean).join(' · ') : [LH.domainOf(l.website || '') || 'No website', `${l.activeAdCount || 0} active ads`, days == null ? '' : `${days} days advertising`].filter(Boolean).join(' · '))}</div>
        ${issues.length ? `<ul class="issues">${issues.map((i) => `<li><span class="sev high"></span><span>${esc(i)}</span></li>`).join('')}</ul>` : ''}
        <div class="row"><label class="lbl" for="pm-phone">Send to</label>
          <select id="pm-phone" class="inp" data-pm-phone style="width:auto">${nums.map((n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(LH.formatPhone(n))}</option>`).join('')}</select></div>
        <textarea class="inp" data-pm-msg aria-label="Message">${esc(pmText(l))}</textarea>
        <div class="row">
          <button class="btn pri" data-pm="sent">Sent, next</button>
          <button class="btn" data-pm="skip">Skip</button>
          <button class="btn ghost" data-pm="back" ${PM.i === 0 ? 'disabled' : ''}>Back</button>
          <button class="btn ghost danger" data-pm="notfit">Not a fit</button>
        </div>
        <div class="pm-keys"><kbd>Enter</kbd> sent &amp; next · <kbd>→</kbd> skip · <kbd>←</kbd> back · <kbd>Esc</kbd> close · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> while typing</div>
      </div>
    </div>`;
  drawPmQr();
  box.focus();
}

function pmAct(act) {
  const l = pmLead();
  if (act === 'close') return closePhoneMode();
  if (act === 'back') PM.i = Math.max(0, PM.i - 1);
  else if (!l) return;
  else if (act === 'sent') {
    if (['new', 'followup'].includes(l.status)) update(l.id, { status: 'contacted' });
    PM.sent++;
    PM.i++;
  } else if (act === 'notfit') {
    update(l.id, { status: 'skip' });
    PM.i++;
  } else if (act === 'skip') PM.i++;
  renderPm();
}

function phoneModeKey(e) {
  if (document.querySelector('.qr-zoom')) return;
  const tag = (e.target && e.target.tagName) || '';
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(tag);
  if (e.key === 'Escape') return pmAct('close');
  if (e.key === 'Enter' && /^(BUTTON|A)$/.test(tag) && !e.ctrlKey && !e.metaKey) return; // let the focused button act
  if (e.key === 'Enter' && (!typing || e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    return pmAct(PM.i >= PM.ids.length ? 'close' : 'sent');
  }
  if (typing) return;
  if (e.key === 'ArrowRight') pmAct('skip');
  if (e.key === 'ArrowLeft') pmAct('back');
}

function bindPhoneMode() {
  const pm = $('[data-pm]');
  let t = 0;
  pm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pm]');
    if (b && b !== pm) return pmAct(b.dataset.pm);
    if (e.target === pm) return closePhoneMode();
    const c = e.target.closest('[data-pm-qr]');
    if (c && c.dataset.qrText) zoomQr(c.dataset.qrText);
  });
  pm.addEventListener('input', (e) => {
    if (!e.target.matches('[data-pm-msg]')) return;
    const l = pmLead();
    if (l) PM.edits[l.id] = e.target.value;
    clearTimeout(t);
    t = setTimeout(drawPmQr, 200);
  });
  pm.addEventListener('change', (e) => {
    if (!e.target.matches('[data-pm-phone]')) return;
    const l = pmLead();
    if (l) PM.phones[l.id] = e.target.value;
    drawPmQr();
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
    if (e.target.closest('[data-wa]')) return quickWhatsApp(l);
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
    const b = e.target.closest('[data-act], [data-goto], [data-angle], [data-channel], [data-copy], [data-remove-phone]');
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
    if (b.dataset.angle) {
      S.pitch.angle = b.dataset.angle;
      S.pitch.dirty = false;
      return renderDrawer(true);
    }
    if (b.dataset.channel) {
      S.pitch.channel = b.dataset.channel;
      S.pitch.dirty = false;
      const top = $('[data-drawer]').scrollTop;
      renderDrawer(true);
      $('[data-drawer]').scrollTop = top;
      return;
    }
    if (b.dataset.copy) return copy(b.dataset.copy);
    if (b.dataset.removePhone && l) return update(l.id, { removePhone: b.dataset.removePhone });
    const act = b.dataset.act;
    const body = () => ($('[data-pitch-body]') || {}).value || '';
    if (await prospectAction(act, b, l, e)) return;
    switch (act) {
      case 'close':
        return closeDrawer();
      case 'export-csv':
        return exportCsv(filtered().map((r) => r.l));
      case 'bulk-export':
        return exportCsv([...S.selected].map((id) => S.leads.get(id)).filter(Boolean));
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
      case 'reset-templates':
        $('[data-templates]').innerHTML = templateEditor(null);
        $('[data-ad-templates]').innerHTML = templateEditor(null, LH.DEFAULT_AD_TEMPLATES, 'data-adtpl');
        return toast('Templates reset. Save to keep them.');
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
      case 'copy-pitch': {
        const subj = $('[data-pitch-subject]');
        return copy(subj ? `Subject: ${subj.value}\n\n${body()}` : body());
      }
      case 'send-wa': {
        if (!l) return;
        const n = ($('[data-pitch-phone]') || {}).value;
        if (!n) return;
        openTab(`https://wa.me/${n.replace(/\D/g, '')}?text=${encodeURIComponent(body())}`);
        return markContacted(l);
      }
      case 'send-email': {
        if (!l) return;
        const subj = ($('[data-pitch-subject]') || {}).value || '';
        openTab(`mailto:${encodeURIComponent(l.emails[0]).replace('%40', '@')}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body())}`);
        return markContacted(l);
      }
      case 'send-dm':
        if (!l) return;
        await copy(body());
        openTab(l.socials.instagram);
        toast('Message copied. Paste it into their Instagram DMs.');
        return markContacted(l);
      case 'copy-open':
        e.preventDefault();
        if (!l) return;
        await copy(body());
        openTab(l.pageUrl);
        return markContacted(l);
      case 'mark-contacted':
        if (!l) return;
        if (!['new', 'followup'].includes(l.status)) return toast(`Already marked as ${(LH.STATUSES.find((x) => x.id === l.status) || {}).label || l.status}`);
        update(l.id, { status: 'contacted' });
        return toast(`Marked “${l.pageName}” as contacted`, () => update(l.id, { status: l.status }));
      case 'queue-one': {
        if (!l) return;
        const phone = ($('[data-pitch-phone]') || {}).value;
        const r = await send({ type: 'queue:push', ids: [l.id], overrides: { [l.id]: { message: body(), phone } } });
        return toast(r && r.error ? r.error : r.queued ? `Sent “${l.pageName}” to your phone` : 'This lead has no phone number yet');
      }
      case 'bulk-queue': {
        const ids = filtered().map((r) => r.l.id).filter((id) => S.selected.has(id));
        if (!S.settings.queueKey) {
          toast('Set up the phone queue in Settings first (takes 2 minutes).');
          return setView('settings');
        }
        return queueLeads(ids, b);
      }
      case 'phone-mode':
        return openPhoneMode(filtered().map((r) => r.l.id));
      case 'bulk-phone-mode':
        return openPhoneMode(filtered().map((r) => r.l.id).filter((id) => S.selected.has(id)));
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
        const r = await send({ type: 'queue:test' });
        out.textContent = r && r.error ? r.error : `Connected. ${r.waiting} lead${r.waiting === 1 ? '' : 's'} waiting on your phone.`;
        out.style.color = r && r.error ? 'var(--poor)' : 'var(--good)';
        return;
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
  let qrTimer = 0;
  drawer.addEventListener('input', (e) => {
    if (e.target.matches('[data-pitch-body], [data-pitch-subject]')) {
      S.pitch.dirty = true;
      clearTimeout(qrTimer);
      qrTimer = setTimeout(drawPitchQr, 200);
    }
    if (e.target.matches('[data-notes]')) {
      clearTimeout(notesTimer);
      const id = S.openId;
      const v = e.target.value;
      notesTimer = setTimeout(() => update(id, { notes: v }), 600);
    }
  });
  drawer.addEventListener('change', (e) => {
    if (e.target.matches('[data-status]') && S.openId) update(S.openId, { status: e.target.value });
    if (e.target.matches('[data-pitch-phone]')) {
      S.pitch.phone = e.target.value;
      drawPitchQr();
    }
  });
  drawer.addEventListener('click', (e) => {
    const c = e.target.closest('[data-pitch-qr]');
    if (c && c.dataset.qrText) zoomQr(c.dataset.qrText);
  });
  bindPhoneMode();
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
  document.addEventListener('keydown', (e) => {
    if (!$('[data-pm]').hidden) return phoneModeKey(e);
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
  fillSettings();
  const hash = location.hash.replace('#', '');
  setView(['leads', 'hunt', 'settings', 'ads'].includes(hash) ? hash : 'leads');
  if (S.settings.queueKey) send({ type: 'queue:sync' }).catch(() => {});
})();
