/* Lead Hunter dashboard: the Meta ads tab (businesses found on Google Maps).
   Loaded after dashboard.js and shares its helpers ($, esc, S, send, toast, openDrawer…). */

S.af = { q: '', ads: '', niche: '', tag: '', heat: '', status: '', contact: '', skipped: false, mobile: false, chains: false, contactedBefore: false, sort: 'priority' };
S.areasOff = new Set();
S.finderNiche = '';

const AD_STATE = {
  past: ['past', 'Ran ads before'],
  none: ['none', 'Never ran ads'],
  likely: ['likely', 'No ads found'],
  running: ['running', 'Running ads'],
  unclear: ['unclear', "Couldn't check"],
  checking: ['unclear', 'Checking…'],
  queued: ['unclear', 'Waiting to check'],
  pending: ['unclear', 'Not checked'],
  skipped: ['unclear', 'Not needed'],
};
const monthYear = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');
/** "Ran ads before · stopped Mar 2026", "Running ads (3)". */
const adExtra = (a) => (a.state === 'running' && a.activeAds ? ` (${a.activeAds})` : a.state === 'past' && a.lastAdAt ? ` · stopped ${monthYear(a.lastAdAt)}` : '');
const compactNum = (n) => Intl.NumberFormat(undefined, { notation: 'compact' }).format(n || 0);

function prospects() {
  return [...S.leads.values()].filter((l) => l.kind === 'prospect');
}

function filteredProspects() {
  const f = S.af;
  const q = f.q.trim().toLowerCase();
  const rows = [];
  for (const l of prospects()) {
    const p = LH.priority(l);
    const ad = (l.adCheck || {}).state || 'pending';
    if (l.avoid && f.niche !== '__avoid') continue;
    // Running ads with a website and not messaged yet: skipped for outreach, shown only when asked for.
    if (skippedNew(l) && !f.skipped && f.ads !== 'running' && f.tag !== 'Running ads') continue;
    if (hideContacted(l, f) || !tagMatch(l, f.tag)) continue;
    if (f.ads === 'pending' ? !['pending', 'queued', 'checking', 'skipped'].includes(ad) : f.ads === 'none' ? !['none', 'likely'].includes(ad) : f.ads && ad !== f.ads) continue;
    if (f.niche && f.niche !== '__avoid' && LH.nicheOf(l, S.settings) !== f.niche) continue;
    if (f.heat && LH.heat(p) !== f.heat) continue;
    if (f.status === '' && l.status === 'skip') continue;
    if (f.status && f.status !== 'all' && l.status !== f.status) continue;
    if (f.contact === 'phone' && !l.phones.length) continue;
    if (f.contact === 'wa' && !LH.whatsappTarget(l)) continue;
    if (f.contact === 'nophone' && l.phones.length) continue;
    if (f.mobile && LH.leadPhoneType(l) !== 'mobile') continue;
    if (f.chains && leadTags(l).includes('Chain')) continue;
    if (q) {
      const hay = [l.pageName, l.area, l.niche, l.website, LH.igHandle(l), ...(l.emails || []), ...l.phones.map((x) => x.number), l.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ l, p });
  }
  const val = {
    priority: (r) => r.p,
    reviews: (r) => ((r.l.sources || {}).maps || {}).reviews || 0,
    newest: (r) => r.l.createdAt || 0,
  };
  if (S.af.sort === 'name') return rows.sort((a, b) => isSkipped(a.l) - isSkipped(b.l) || (a.l.pageName || '').localeCompare(b.l.pageName || ''));
  return rows.sort((a, b) => isSkipped(a.l) - isSkipped(b.l) || val[S.af.sort](b) - val[S.af.sort](a) || b.p - a.p);
}

function sourceCell(l) {
  const m = (l.sources || {}).maps;
  const ig = (l.sources || {}).instagram;
  const parts = [];
  if (m) parts.push(`<span>Maps ${m.rating ? `<b>${esc(m.rating)}★</b>` : ''} <span class="muted">(${esc(m.reviews || 0)})</span></span>`);
  if (ig) parts.push(`<span>IG <b>${esc(compactNum(ig.followers))}</b> <span class="muted">@${esc(ig.username)}</span></span>`);
  return `<div class="src">${parts.join('') || '<span class="muted">–</span>'}</div>`;
}

function adCell(l) {
  const a = l.adCheck || {};
  const [cls, label] = AD_STATE[a.state || 'pending'] || AD_STATE.pending;
  const spin = ['checking', 'queued'].includes(a.state) ? '<span class="spin"></span>' : '';
  return `<span class="ad-state ${cls}" title="${esc(a.reason || '')}">${spin}${esc(label + adExtra(a))}</span>`;
}

function prospectRow({ l, p }) {
  const meta = [LH.nicheOf(l, S.settings), l.area || (l.sources.maps && l.sources.maps.address ? l.sources.maps.address.split(',').slice(-3, -2)[0] : '')].filter(Boolean).join(' · ');
  const dim = ['lost', 'skip', 'won'].includes(l.status) || skippedNew(l) ? ' dim' : '';
  return `<tr data-id="${esc(l.id)}" class="${S.selected.has(l.id) ? 'sel' : ''}${dim}">
    <td class="c-sel"><input type="checkbox" data-sel ${S.selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.pageName)}" /></td>
    <td><span class="heat ${LH.heat(p)}" title="Priority ${p}/100">${p}</span></td>
    <td><div class="biz">${avatar(l)}<div style="min-width:0"><div class="n">${esc(l.pageName || 'Unknown')}</div><div class="m">${esc(meta)}</div>${tagsHtml(l)}</div></div></td>
    <td>${sourceCell(l)}</td>
    <td>${adCell(l)}</td>
    <td>${l.website ? siteCell(l) : '<span class="muted">No website</span>'}</td>
    <td>${contactCell(l)}</td>
    <td>${statusCell(l)}</td>
    <td><button class="btn sm" data-open>Pitch</button></td>
  </tr>`;
}

function renderProspectKpis() {
  const all = prospects().filter((l) => !l.avoid);
  const none = all.filter((l) => ['none', 'likely', 'past'].includes((l.adCheck || {}).state)).length;
  const waiting = all.filter((l) => ['queued', 'checking'].includes((l.adCheck || {}).state)).length;
  const phone = all.filter((l) => l.phones.length).length;
  const contacted = all.filter((l) => !['new', 'skip'].includes(l.status)).length;
  $('[data-kpis]').innerHTML =
    `<span class="kpi"><b>${all.length}</b> businesses</span>` +
    `<span class="kpi hot"><b>${none}</b> not running ads</span>` +
    `<span class="kpi"><b>${phone}</b> with phone</span>` +
    `<span class="kpi"><b>${contacted}</b> contacted</span>` +
    (waiting ? `<span class="kpi"><span class="spin"></span> checking ads <b>${waiting}</b></span>` : '');
}

const finderWhat = (f) => (f.niche ? LH.nicheText(LH.LEGACY_NICHES[f.niche] || f.niche, S.settings) : `“${f.keywords[0]}” businesses`);
/** Before and after the filters: "87 found → 31 kept · 22 too many reviews · 9 already saved…". */
function runStats(f) {
  const st = f.stats;
  if (!st || !st.found) return '';
  const parts = [
    `<b>${st.found}</b> found → <b>${st.kept}</b> kept`,
    st.duplicate && `${st.duplicate} already saved`,
    st.contacted && `${st.contacted} contacted before`,
    st.fewReviews && `${st.fewReviews} under ${esc(presetNamed(f.niche) ? presetNamed(f.niche).minReviews : '')} reviews`,
    st.manyReviews && `${st.manyReviews} over ${esc(presetNamed(f.niche) ? presetNamed(f.niche).maxReviews : '')} reviews`,
    st.excluded && `${st.excluded} excluded words`,
  ];
  return `<span class="run-stats m">${parts.filter(Boolean).join(' · ')}</span>`;
}
const presetNamed = (name) => LH.presetsFor(S.settings).find((n) => n.name === name);

function renderFinderStatus() {
  const el = $('[data-finder-status]');
  const f = S.finder;
  const waiting = S.adQueue.length;
  if (!f && !waiting && !Object.keys(S.alerts).length) return (el.hidden = true);
  el.hidden = false;
  const parts = [];
  if (f && ['running', 'paused'].includes(f.status)) {
    const total = f.mapsQ.length || 1;
    const pct = Math.min(100, Math.round((100 * f.mapsI) / total));
    const q = f.mapsQ[Math.min(f.mapsI, total - 1)];
    parts.push(`${f.status === 'running' ? '<span class="pulse"></span>' : ''}<span class="t">${f.status === 'paused' ? 'Paused: ' : ''}${esc(f.niche)} · search ${Math.min(f.mapsI + 1, total)} of ${total}${q ? ` <span class="muted">“${esc(q.q)}”</span>` : ''}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <button class="btn sm" data-act="${f.status === 'running' ? 'finder-pause' : 'finder-resume'}">${f.status === 'running' ? 'Pause' : 'Resume'}</button>
      <button class="btn sm danger" data-act="finder-stop">Stop</button>${runStats(f)}`);
  } else if (f) {
    parts.push(`<span class="t">Last run: ${esc(f.niche || finderWhat(f))} · ${f.mapsI || 0} searches · ${esc(f.status)}</span>${runStats(f) || `<span class="m">${f.added} new businesses</span>`}`);
  }
  const notes = f && f.mapsNote && !S.alerts.maps ? [`Google Maps: ${f.mapsNote}`] : [];
  if (notes.length) parts.push(`<span class="err" style="margin:0">${esc(notes.join(' · '))}</span>`);
  // A login wall, checkpoint or block paused a source: say so and leave it to you.
  for (const [src, a] of Object.entries(S.alerts)) {
    const resume = src === 'maps' ? 'finder-resume' : 'adcheck-resume';
    parts.push(`<span class="err alert" style="margin:0" data-alert="${esc(src)}"><b>${esc(SOURCE_LABEL[src] || src)} paused:</b> ${esc(a.text)}. Open the ${src === 'maps' ? 'Google Maps' : 'Ad Library'} tab${a.url ? ` (<a href="${esc(safeHref(a.url))}" target="_blank" rel="noopener noreferrer">this search</a>)` : ''}, sort it out, then press Resume. Nothing tries to get past it.</span><button class="btn sm" data-act="${resume}">Resume</button>`);
  }
  if (waiting) parts.push(`<span class="m"><span class="spin"></span> Ad Library checks: ${waiting} left${S.adPaused ? ' (paused)' : ''}</span><button class="btn sm" data-act="${S.adPaused ? 'adcheck-resume' : 'adcheck-pause'}">${S.adPaused ? 'Resume' : 'Pause'} checks</button>`);
  el.innerHTML = parts.join('');
}

function renderProspectsView() {
  renderFinderStatus();
  const niches = [...new Set(prospects().map((l) => LH.nicheOf(l, S.settings)).filter(Boolean))];
  const ns = $('[data-af="niche"]');
  ns.innerHTML = `<option value="">Any niche</option>${niches.map((n) => `<option ${n === S.af.niche ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__avoid" ${S.af.niche === '__avoid' ? 'selected' : ''}>Skipped (long sales cycle)</option>`;
  const st = $('[data-af="status"]');
  if (!st.options.length) st.innerHTML = `<option value="">Open</option><option value="all">All statuses</option>${LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}`;
  const bulk = $('[data-ads-bulk-status]');
  if (!bulk.options.length) bulk.innerHTML = `<option value="">Set status…</option>${LH.STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}`;
  const rows = filteredProspects();
  $('[data-ads-rows]').innerHTML = rows.map(prospectRow).join('');
  const total = prospects().length;
  const skipped = S.af.skipped ? 0 : prospects().filter((l) => !l.avoid && skippedNew(l)).length;
  const empty = $('[data-ads-empty]');
  empty.hidden = rows.length > 0;
  empty.textContent = total ? 'No businesses match these filters.' : 'No businesses yet. Pick a niche above and press Find businesses.';
  const before = S.af.contactedBefore ? 0 : prospects().filter((l) => contactedBefore(l)).length;
  $('[data-ads-count]').textContent = total ? `Showing ${rows.length} of ${total} businesses.${skipped ? ` ${skipped} skipped (running ads).` : ''}${before ? ` ${before} contacted before (hidden).` : ''}` : '';
  const ids = rows.map((r) => r.l.id);
  const all = $('[data-ads-sel-all]');
  all.checked = ids.length > 0 && ids.every((id) => S.selected.has(id));
  all.indeterminate = !all.checked && ids.some((id) => S.selected.has(id));
  $('[data-ads-bulk]').hidden = S.selected.size === 0;
  $('[data-ads-bulk-count]').textContent = `${S.selected.size} selected`;
}

/** Short facts for phone mode and the phone queue. */
function prospectHighlights(l) {
  const m = (l.sources || {}).maps || {};
  const ig = (l.sources || {}).instagram || {};
  const a = (l.adCheck || {}).state;
  return [
    a === 'past' ? 'Ran Meta ads before, none live now' : a === 'none' ? 'Never ran Meta ads' : a === 'likely' ? 'No Meta ads found' : a === 'running' ? 'Already running Meta ads' : 'Meta ads not checked yet',
    m.reviews ? `${m.rating ? `${m.rating}★ · ` : ''}${m.reviews} Google reviews` : '',
    ig.followers ? `${compactNum(ig.followers)} Instagram followers` : '',
  ].filter(Boolean);
}

/* ------------------------------------------------------------------ drawer */
function prospectDrawerHtml(l) {
  const p = LH.priority(l);
  const m = (l.sources || {}).maps || null;
  const ig = (l.sources || {}).instagram || null;
  const a = l.adCheck || {};
  const [cls, label] = AD_STATE[a.state || 'pending'] || AD_STATE.pending;
  const links = [
    LH.igHandle(l) && `<a href="https://www.instagram.com/${esc(encodeURIComponent(LH.igHandle(l)))}/" target="_blank" rel="noopener noreferrer">@${esc(LH.igHandle(l))}</a>`,
    m && m.mapsUrl && `<a href="${esc(safeHref(m.mapsUrl))}" target="_blank" rel="noopener noreferrer">Google Maps</a>`,
    a.searchUrl && `<a href="${esc(safeHref(a.searchUrl))}" target="_blank" rel="noopener noreferrer">Ad Library search</a>`,
  ].filter(Boolean);
  const matches = (a.matches || [])
    .map((x) => `<li><b>${esc(x.pageName)}</b> · ${esc(x.ads)} live ad${x.ads === 1 ? '' : 's'}${x.total > x.ads ? ` of ${esc(x.total)} in all` : ''} · matched by ${esc(x.reasons.join(', '))}${x.pageId ? ` · <a href="${esc(safeHref(LH.pageAdsUrl(x.pageId, 'ALL', x.pageName)))}" target="_blank" rel="noopener noreferrer">see ads</a>` : ''}</li>`)
    .join('');
  const when = a.lastAdAt ? fmtDate(a.lastAdAt) : '';
  const adText = {
    past: `They ran Meta ads in the UAE before but nothing is live now.${when ? ` The last one stopped ${when}.` : ''}${a.totalAds ? ` ${a.totalAds} ad${a.totalAds === 1 ? '' : 's'} in the Ad Library.` : ''}`,
    none: a.evidence || 'Their Facebook page has never run ads in the UAE.',
    likely: a.evidence || 'No ads found, but their Facebook page could not be checked directly.',
    running: `They are running ads right now${a.activeAds ? ` (${a.activeAds} live)` : ''}.${when ? ` The newest started ${when}.` : ''}`,
    unclear: `Couldn't check automatically${a.reason ? `: ${a.reason}` : ''}. Open the Ad Library search to look yourself.`,
    checking: 'Checking the Ad Library now…',
    queued: 'Waiting for its turn in the Ad Library check.',
    pending: 'Not checked yet.',
    skipped: 'Not checked: without a website they get the website script either way. Use Check ads again if you want to know.',
  }[a.state || 'pending'];
  return `
    <header class="d-head">${avatar(l)}
      <div style="min-width:0"><h2>${esc(l.pageName || 'Unknown')}</h2>
        <div class="links"><span class="heat ${LH.heat(p)}">${p}</span>${links.join('')}${LH.nicheOf(l, S.settings) ? `<span>${esc(LH.nicheOf(l, S.settings))}</span>` : ''}</div></div>
      <button class="btn sm ghost x" data-act="close" aria-label="Close">✕</button>
    </header>
    <section class="d-sec">
      <div class="facts">
        <div class="fact"><b class="ad-state ${cls}" style="font-size:15px">${esc(label)}</b><span>Meta ads</span></div>
        <div class="fact"><b>${m && m.rating ? `${esc(m.rating)}★` : '–'}</b><span>${m ? `${esc(m.reviews || 0)} Google reviews` : 'Google rating'}</span></div>
        <div class="fact"><b>${typeof (l.site || {}).score === 'number' ? esc(l.site.score) : '–'}</b><span>${l.website ? 'Website score' : 'No website'}</span></div>
        <div class="fact"><b>${l.phones.length || '–'}</b><span>${LH.whatsappTarget(l) ? 'Phones · has mobile' : 'Phone numbers'}</span></div>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="lbl" for="d-status">Status</label>
        <select id="d-status" class="status-sel" data-status>${statusOptions(l.status)}</select>
        <span class="muted">Found ${esc(fmtDate(l.createdAt))}${l.area ? ` in ${esc(l.area)}` : ''}</span>
      </div>
      ${contactedRow(l)}
    </section>
    <section class="d-sec"><h3>Meta Ad Library check</h3>
      <p>${esc(adText)}</p>
      ${matches ? `<ul class="matches">${matches}</ul>` : ''}
      <div class="row">
        <button class="btn sm" data-act="adcheck-one">Check again</button>
        <button class="btn sm ghost" data-act="adcheck-set" data-state="none">They never ran ads</button>
        <button class="btn sm ghost" data-act="adcheck-set" data-state="past">They ran ads before</button>
        <button class="btn sm ghost" data-act="adcheck-set" data-state="running">They do run ads</button>
      </div>
    </section>
    ${pitchSection(l)}
    ${l.website ? siteSection(l) : `<section class="d-sec" data-site-sec><h3>Website</h3><p class="muted">No website listed on Google Maps.</p>
      <form class="inline-form" data-set-website><input class="inp" name="website" placeholder="Know their website? Paste it here" /><button class="btn sm" type="submit">Check it</button></form></section>`}
    ${contactSection(l)}
    <section class="d-sec"><h3>About</h3>
      ${ig && ig.bio ? `<p class="bio">${esc(ig.bio)}</p>` : ''}
      ${m && m.address ? `<p class="muted">${esc(m.address)}</p>` : ''}
      ${l.categories.length ? `<p class="muted">${esc(l.categories.join(', '))}</p>` : ''}
    </section>
    <section class="d-sec"><h3>Notes</h3><textarea class="inp" rows="3" data-notes placeholder="Who you spoke to, what they said, when to follow up…">${esc(l.notes || '')}</textarea></section>
    <section class="d-sec"><div class="row" style="margin:0"><button class="btn sm danger" data-act="delete-lead">Delete</button></div></section>`;
}

/* --------------------------------------------------------------------- csv */
function exportProspectsCsv(list) {
  const head = ['priority', 'business', 'niche', 'area', 'meta_ads', 'meta_ad_status', 'active_ads', 'last_ad_date', 'ad_library_search', 'google_rating', 'google_reviews', 'google_maps', 'website', 'website_score', 'tags', 'phone', 'whatsapp_link', 'whatsapp_message_link', 'email', 'instagram', 'address', 'status', 'notes', 'found_on'];
  const rows = list.map((l) => {
    const m = (l.sources || {}).maps || {};
    const a = l.adCheck || {};
    const best = LH.bestPhone(l);
    const wa = LH.whatsappTarget(l);
    return [
      LH.priority(l),
      l.pageName,
      LH.nicheOf(l, S.settings),
      l.area,
      (AD_STATE[a.state || 'pending'] || AD_STATE.pending)[1],
      LH.adStatus(l).status || '',
      a.activeAds || '',
      a.lastAdAt ? new Date(a.lastAdAt).toISOString().slice(0, 10) : '',
      a.searchUrl || '',
      m.rating || '',
      m.reviews || '',
      m.mapsUrl || '',
      l.website || '',
      typeof (l.site || {}).score === 'number' ? l.site.score : '',
      LH.leadTags(l).join('; '),
      best ? LH.formatPhone(best.number) : '',
      wa ? LH.waLink(wa) : '',
      wa && !isSkipped(l) ? LH.waLink(wa, LH.pitchFor(l, S.settings).text) : '',
      (l.emails || [])[0] || '',
      igUrl(l),
      m.address || '',
      (LH.STATUSES.find((s) => s.id === l.status) || {}).label || l.status,
      l.notes || '',
      l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : '',
    ];
  });
  download(`meta-ads-prospects-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + LH.toCsv([head, ...rows]), 'text/csv;charset=utf-8');
}

/* ------------------------------------------------------------------ finder */
function renderAreas() {
  const preset = presetNamed(S.finderNiche);
  $('[data-ad-areas]').innerHTML = ((preset && preset.areas) || [])
    .map((a) => `<button type="button" class="chip ${S.areasOff.has(a) ? 'off' : 'on'}" data-area="${esc(a)}" aria-pressed="${!S.areasOff.has(a)}">${esc(a)}</button>`)
    .join('');
}
/** "Car: 120 of 588 searches done. The next run carries on from there." */
async function renderPresetProgress() {
  const el = $('[data-preset-progress]');
  const r = await send({ type: 'finder:progress' });
  const p = r && r.progress && r.progress[S.finderNiche];
  if (!p) return (el.textContent = '');
  el.innerHTML = p.done
    ? `${esc(S.finderNiche)}: <b>${p.done}</b> of ${p.total} searches done. The next run carries on from there. <button type="button" class="linkish" data-act="finder-reset">Start over</button>`
    : `${esc(S.finderNiche)}: ${p.total} searches (keywords × areas), none run yet.`;
}
function pickPreset(name) {
  const preset = presetNamed(name) || LH.presetsFor(S.settings)[0];
  S.finderNiche = preset.name;
  const form = $('[data-finder-form]');
  form.keywords.value = preset.keywords.join('\n');
  $$('[data-ad-niche]', form).forEach((c) => c.classList.toggle('on', c.dataset.adNiche === preset.name));
  S.areasOff.clear();
  renderAreas();
  renderPresetProgress();
}

function initProspects() {
  const form = $('[data-finder-form]');
  renderNicheChips();
  pickPreset(S.finderNiche);
  $('[data-maps-mode]').textContent = S.settings.placesKey ? '(Places API)' : '(in a tab)';

  form.addEventListener('click', async (e) => {
    const n = e.target.closest('[data-ad-niche]');
    if (n) pickPreset(n.dataset.adNiche);
    if (e.target.closest('[data-act="finder-reset"]')) {
      if (!confirm(`Forget which ${S.finderNiche} searches have run? The next run starts from its first keyword again.`)) return;
      await send({ type: 'finder:reset', preset: S.finderNiche });
      renderPresetProgress();
    }
    const a = e.target.closest('[data-area]');
    if (a) {
      S.areasOff.has(a.dataset.area) ? S.areasOff.delete(a.dataset.area) : S.areasOff.add(a.dataset.area);
      renderAreas();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-finder-err]');
    err.hidden = true;
    const keywords = form.keywords.value.split('\n').map((k) => k.trim()).filter(Boolean);
    const areas = ((presetNamed(S.finderNiche) || {}).areas || []).filter((a) => !S.areasOff.has(a));
    const fail = (t) => ((err.textContent = t), (err.hidden = false));
    if (!keywords.length) return fail('Pick a preset or type a search term.');
    if (!areas.length) return fail('Leave at least one area switched on.');
    const res = await send({ type: 'finder:start', config: { niche: S.finderNiche, keywords, areas, cap: form.cap.value } });
    if (!res || res.error) return fail((res && res.error) || 'Could not start the search.');
    toast(`Searching ${res.finder.mapsQ.length} keyword and area pairs. Businesses appear below as they are found.`);
    renderPresetProgress();
  });

  // Filters, table and bulk actions.
  $$('[data-af]').forEach((el) =>
    el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
      S.af[el.dataset.af] = el.type === 'checkbox' ? el.checked : el.value;
      renderProspectsView();
    }),
  );
  const tbody = $('[data-ads-rows]');
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    const l = tr && S.leads.get(tr.dataset.id);
    if (!l) return;
    if (e.target.closest('[data-sel]')) {
      e.target.checked ? S.selected.add(l.id) : S.selected.delete(l.id);
      return renderProspectsView();
    }
    if (e.target.closest('[data-wa]')) return quickWhatsApp(l);
    if (e.target.closest('[data-replied]')) return toggleReplied(l);
    if (e.target.closest('a, select, [data-stop]')) return;
    openDrawer(l.id);
  });
  tbody.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-status]');
    if (sel) update(sel.closest('tr').dataset.id, { status: sel.value });
  });
  $('[data-ads-sel-all]').addEventListener('change', (e) => {
    filteredProspects().forEach((r) => (e.target.checked ? S.selected.add(r.l.id) : S.selected.delete(r.l.id)));
    renderProspectsView();
  });
  $('[data-ads-bulk-status]').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const ids = [...S.selected];
    for (const id of ids) await update(id, { status: e.target.value });
    toast(`Updated ${ids.length} businesses`);
    e.target.value = '';
  });
}

/** Clicks for the Meta ads tab. Returns true when handled. */
async function prospectAction(act, b, l) {
  const selected = () => filteredProspects().map((r) => r.l.id).filter((id) => S.selected.has(id));
  switch (act) {
    case 'toggle-finder': {
      const card = $('[data-finder]');
      const collapsed = card.classList.toggle('collapsed');
      b.textContent = collapsed ? 'Show' : 'Hide';
      b.setAttribute('aria-expanded', String(!collapsed));
      return true;
    }
    case 'finder-stop':
      await send({ type: 'finder:stop' });
      toast('Search stopped. The searches that ran are remembered, so the next run carries on from there.');
      renderPresetProgress();
      return true;
    case 'finder-pause':
      await send({ type: 'finder:pause' });
      toast('Paused after the current search. Press Resume to carry on.');
      return true;
    case 'finder-resume':
      await send({ type: 'finder:resume' });
      return true;
    case 'adcheck-pause':
    case 'adcheck-resume':
      await send({ type: act === 'adcheck-pause' ? 'adcheck:pause' : 'adcheck:resume' });
      return true;
    case 'adcheck-one':
      if (!l) return true;
      await send({ type: 'adcheck:recheck', ids: [l.id] });
      toast('Checking the Ad Library again');
      return true;
    case 'adcheck-set':
      if (!l) return true;
      await send({ type: 'adcheck:set', id: l.id, state: b.dataset.state });
      return true;
    case 'ads-phone-mode':
      openPhoneMode(filteredProspects().map((r) => r.l.id));
      return true;
    case 'ads-bulk-phone-mode':
      openPhoneMode(selected());
      return true;
    case 'ads-bulk-queue':
      await queueLeads(selected(), b);
      return true;
    case 'ads-bulk-email':
      await emailLeads(selected(), b);
      return true;
    case 'ads-bulk-recheck':
      await send({ type: 'adcheck:recheck', ids: selected() });
      toast(`Re-checking ${S.selected.size} businesses in the Ad Library`);
      return true;
    case 'ads-export':
      exportProspectsCsv(filteredProspects().map((r) => r.l));
      return true;
    case 'ads-bulk-export':
      exportProspectsCsv(selected().map((id) => S.leads.get(id)));
      return true;
    case 'ads-contacts':
      exportContacts(filteredProspects().map((r) => r.l));
      return true;
    case 'ads-bulk-contacts':
      exportContacts(selected().map((id) => S.leads.get(id)));
      return true;
    case 'ads-bulk-delete': {
      const ids = selected();
      if (!confirm(`Delete ${ids.length} businesses? They may be found again in a later search.`)) return true;
      await send({ type: 'lead:delete', ids });
      S.selected.clear();
      toast(`Deleted ${ids.length}`);
      return true;
    }
  }
  return false;
}
