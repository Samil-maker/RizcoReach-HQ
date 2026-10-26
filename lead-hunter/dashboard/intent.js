/* Lead Hunter dashboard: the Intent tab (people asking for help on Reddit, Facebook groups and LinkedIn).
   Loaded after dashboard.js and prospects.js and shares their helpers ($, esc, S, send, toast, copy…).
   Posts live in IndexedDB (lib/intent-db.js); the background bumps intentState.rev when they change. */

S.intent = { posts: [], f: { kind: '', source: '', status: 'new' }, state: {} };
const INTENT_SOURCES = { reddit: 'Reddit', facebook: 'Facebook group', linkedin: 'LinkedIn' };
const INTENT_STATUS = { new: 'New', contacted: 'Contacted', dismissed: 'Dismissed' };

async function loadIntent() {
  try {
    S.intent.posts = await LH.intentDb.all();
  } catch {
    S.intent.posts = [];
  }
  const { intentState = {} } = await chrome.storage.local.get('intentState');
  S.intent.state = intentState;
  renderIntentCount();
}
const postTime = (p) => p.createdAt || p.foundAt || 0;
function ago(t) {
  if (!t) return 'date unknown';
  const m = Math.max(0, Math.round((Date.now() - t) / 6e4));
  if (m < 60) return `${m || 1}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function filteredIntent() {
  const f = S.intent.f;
  return S.intent.posts
    .filter((p) => (f.status === 'all' ? true : (p.status || 'new') === f.status))
    .filter((p) => !f.kind || (p.categories || []).includes(f.kind))
    .filter((p) => !f.source || p.source === f.source)
    .sort((a, b) => postTime(b) - postTime(a)); // newest first
}

function renderIntentCount() {
  const el = $('[data-intent-count]');
  if (!el) return;
  const n = (S.intent.state || {}).unseen || 0;
  el.textContent = n ? String(n) : '';
  el.hidden = !n;
}

function intentCard(p) {
  const kinds = (p.categories || []).filter((c) => c !== 'arabic');
  const lead = p.leadId && S.leads.get(p.leadId);
  const status = p.status || 'new';
  return `<article class="intent-card ${status}" data-intent-id="${esc(p.id)}">
    <header>
      <span class="heat ${LH.heatClass(p.score || 0, { heatHot: 70, heatWarm: 50 })}" title="Intent score">${esc(p.score || 0)}</span>
      <span class="src">${esc(INTENT_SOURCES[p.source] || p.source)}${p.place ? ` · ${esc(p.place)}` : ''}</span>
      <span class="muted">${esc(ago(p.createdAt))}${p.author ? ` · ${esc(p.author)}` : ''}</span>
      ${kinds.map((k) => `<span class="tag ${k === 'hiring' ? 'amber' : 'green'}">${esc(LH.INTENT_LABELS[k] || k)}</span>`).join('')}
      ${p.verified ? '' : '<span class="tag" title="Matched by keywords only. The AI check (Phase 6) confirms it is a real buyer">unverified</span>'}
      ${status !== 'new' ? `<span class="tag">${esc(INTENT_STATUS[status])}</span>` : ''}
    </header>
    <p class="sum">${esc(p.summary || p.title || '')}</p>
    ${p.hits && p.hits.length ? `<p class="muted hits">Matched: ${esc(p.hits.slice(0, 4).join(', '))}</p>` : ''}
    ${lead ? `<p class="muted">Linked to your lead <button class="linkish" data-act="intent-lead" data-id="${esc(lead.id)}">${esc(lead.pageName)}</button>, which gets the heat bonus</p>` : ''}
    <label class="opener"><span class="lbl">Opener</span><textarea class="inp" rows="2" data-intent-opener>${esc(p.opener || '')}</textarea></label>
    <div class="row">
      ${p.url ? `<a class="btn sm" href="${esc(safeHref(p.url))}" target="_blank" rel="noopener noreferrer">Open post</a>` : '<span class="muted">No link to this post</span>'}
      <button class="btn sm" data-act="intent-copy">Copy opener</button>
      ${status === 'contacted' ? '' : '<button class="btn sm pri" data-act="intent-contacted">Mark contacted</button>'}
      ${status === 'dismissed' ? '<button class="btn sm ghost" data-act="intent-restore">Restore</button>' : '<button class="btn sm ghost" data-act="intent-dismiss">Dismiss</button>'}
    </div>
  </article>`;
}

function renderIntentStatus() {
  const el = $('[data-intent-status]');
  const st = S.intent.state || {};
  const runs = st.runs || [];
  const parts = [];
  for (const src of ['reddit', 'facebook', 'linkedin']) {
    const a = S.alerts[src];
    if (a) parts.push(`<span class="err alert" style="margin:0" data-alert="${src}"><b>${esc(INTENT_SOURCES[src])} paused:</b> ${esc(a.text)}. ${a.url ? `<a href="${esc(safeHref(a.url))}" target="_blank" rel="noopener noreferrer">Open it</a>, sort` : 'Sort'} it out, then press Resume. Nothing tries to get past it.</span><button class="btn sm" data-act="intent-resume" data-source="${src}">Resume</button>`);
  }
  const last = runs[0];
  if (last) {
    const skipped = [last.seller && `${last.seller} sellers`, last.old && `${last.old} too old`, last.foreign && `${last.foreign} not UAE`, last.duplicates && `${last.duplicates} already saved`].filter(Boolean);
    parts.push(`<span class="m">Last scan: ${esc(INTENT_SOURCES[last.source] || last.source)} ${esc(ago(last.at))} · read ${esc(last.seen)} · saved ${esc(last.saved)}${skipped.length ? ` · ${esc(skipped.join(' · '))}` : ''}</span>`);
  }
  const every = S.settings.radarEveryHours;
  parts.push(`<span class="m">${every > 0 ? `Reddit is scanned every ${esc(every)} hour${every === 1 ? '' : 's'}${st.lastRedditAt ? `, last ${esc(ago(st.lastRedditAt))}` : ''}.` : 'Automatic Reddit scans are off (Settings > Intent Radar).'} Facebook groups and LinkedIn: open one and press Scan for leads.</span>`);
  el.innerHTML = parts.join('');
}

function renderIntentView() {
  renderIntentStatus();
  const rows = filteredIntent();
  $('[data-intent-rows]').innerHTML = rows.map(intentCard).join('');
  const total = S.intent.posts.length;
  const empty = $('[data-intent-empty]');
  empty.hidden = rows.length > 0;
  empty.textContent = total ? 'No posts match these filters.' : 'No posts yet. Press Scan Reddit now, or open a Facebook group or LinkedIn and press Scan for leads.';
  $('[data-intent-count-line]').textContent = total ? `Showing ${rows.length} of ${total} posts, newest first.` : '';
}
function renderIntentKpis() {
  const posts = S.intent.posts;
  const week = posts.filter((p) => postTime(p) > Date.now() - 7 * 864e5).length;
  const fresh = posts.filter((p) => (p.status || 'new') === 'new').length;
  const done = posts.filter((p) => p.status === 'contacted').length;
  $('[data-kpis]').innerHTML = `<span class="kpi hot"><b>${fresh}</b> new</span><span class="kpi"><b>${week}</b> this week</span><span class="kpi"><b>${done}</b> contacted</span>`;
}

async function setIntent(id, patch, undoTo) {
  await send({ type: 'intent:update', id, patch });
  if (undoTo) toast(patch.status === 'dismissed' ? 'Dismissed' : 'Marked as contacted', () => send({ type: 'intent:update', id, patch: { status: undoTo } }));
}

/** Clicks on the Intent tab. Returns true when handled. */
async function intentAction(act, b) {
  const card = b.closest('[data-intent-id]');
  const id = card && card.dataset.intentId;
  const post = id && S.intent.posts.find((p) => p.id === id);
  switch (act) {
    case 'intent-run': {
      b.disabled = true;
      b.textContent = 'Scanning Reddit…';
      const r = await send({ type: 'intent:run' });
      b.disabled = false;
      b.textContent = 'Scan Reddit now';
      if (!r || r.error) toast((r && r.error) || 'Lead Hunter did not answer. Reload the extension.');
      else toast(`Read ${r.stats.seen} Reddit posts, ${r.stats.saved} new for you`);
      return true;
    }
    case 'intent-copy':
      if (card) await copy($('[data-intent-opener]', card).value);
      return true;
    case 'intent-contacted':
      if (post) await setIntent(id, { status: 'contacted', contactedAt: Date.now(), opener: $('[data-intent-opener]', card).value }, post.status || 'new');
      return true;
    case 'intent-dismiss':
      if (post) await setIntent(id, { status: 'dismissed' }, post.status || 'new');
      return true;
    case 'intent-restore':
      if (post) await setIntent(id, { status: 'new' });
      return true;
    case 'intent-resume':
      await send({ type: 'intent:resume', source: b.dataset.source });
      toast(`${INTENT_SOURCES[b.dataset.source] || 'Source'} resumed`);
      return true;
    case 'intent-lead':
      openDrawer(b.dataset.id);
      return true;
  }
  return false;
}

function initIntent() {
  $$('[data-intent-f]').forEach((el) =>
    el.addEventListener('change', () => {
      S.intent.f[el.dataset.intentF] = el.value;
      renderIntentView();
    }),
  );
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.intentState) return;
    await loadIntent();
    if (S.view === 'intent') {
      renderIntentView();
      renderIntentKpis();
    }
  });
  loadIntent().then(() => S.view === 'intent' && renderAll());
}
