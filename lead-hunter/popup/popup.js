/* Lead Hunter toolbar popup: how many leads are ready, what is running, and the way into the dashboard. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const open = (hash) => chrome.runtime.sendMessage({ type: 'open:dashboard', hash }).then(() => window.close());

function renderStats(s) {
  $('[data-stats]').innerHTML =
    `<div><b>${s.ready || 0}</b><span>ready to export</span></div>` +
    `<div><b>${s.fits || 0}</b><span>fit</span></div>` +
    `<div><b>${(s.queued || 0) + (s.checking || 0)}</b><span>being checked</span></div>`;
}
function renderRunning(s) {
  const box = $('[data-hunt]');
  const f = s.finder && s.finder.status === 'running' ? s.finder : null;
  const h = s.hunt && s.hunt.status === 'running' ? s.hunt : null;
  box.hidden = !f && !h;
  if (box.hidden) return;
  const line = f
    ? `<b>Google Maps · ${esc(f.niche)}</b> <span class="muted">search ${Math.min(f.mapsI + 1, f.mapsQ.length)} of ${f.mapsQ.length} · ${f.added} new</span>`
    : `<b>Ad Library · “${esc(h.keywords[h.index])}”</b> <span class="muted">${h.collected} / ${h.target}</span>`;
  const pct = f ? Math.round((100 * f.mapsI) / (f.mapsQ.length || 1)) : Math.round((100 * h.collected) / h.target);
  box.innerHTML = `<div>${line}</div><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span>`;
}

(async () => {
  $('[data-dash]').onclick = () => open('#leads');
  $('[data-leads]').onclick = () => open('#leads');
  $('[data-find]').onclick = () => open('#find');
  const refresh = async () => {
    const s = (await chrome.runtime.sendMessage({ type: 'stats' })) || {};
    renderStats(s);
    renderRunning(s);
  };
  await refresh();
  let timer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 800);
  });
})();
