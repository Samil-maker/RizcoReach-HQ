/* Lead Hunter toolbar popup: quick stats, hunt progress, and a one-line hunt launcher. */
const LH = globalThis.LH;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stats = { total: 0, hot: 0, queued: 0 };

function renderStats() {
  $('[data-stats]').innerHTML =
    `<div><b>${stats.total}</b><span>leads</span></div>` +
    `<div><b>${stats.hot}</b><span>hot to contact</span></div>` +
    `<div><b>${stats.queued}</b><span>sites checking</span></div>`;
}

function renderHunt(h) {
  const box = $('[data-hunt]');
  box.hidden = !(h && h.status === 'running');
  if (box.hidden) return;
  const pct = Math.min(100, Math.round((100 * h.collected) / h.target));
  box.innerHTML = `<div><b>Hunting “${esc(h.keywords[h.index])}”</b> <span class="muted">(${h.index + 1}/${h.keywords.length})</span></div>
    <span class="bar"><i style="width:${pct}%"></i></span>
    <div class="p-row"><span class="muted">${h.collected} / ${h.target} new leads</span><button class="btn sm danger" data-stop>Stop</button></div>`;
  $('[data-stop]').onclick = () => chrome.runtime.sendMessage({ type: 'hunt:stop' });
}

(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const country = (settings && settings.country) || 'AE';
  $('[data-countries]').innerHTML = LH.COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === country ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $('[data-dash]').onclick = () => chrome.runtime.sendMessage({ type: 'open:dashboard' }).then(() => window.close());
  const form = $('[data-form]');
  const keywords = () => form.keywords.value.split(',').map((k) => k.trim()).filter(Boolean);
  $('[data-browse]').onclick = () => {
    chrome.tabs.create({ url: LH.adLibraryUrl({ keyword: keywords()[0] || '', country: form.country.value }) });
    window.close();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!keywords().length) return;
    await chrome.runtime.sendMessage({ type: 'hunt:start', config: { keywords: keywords(), country: form.country.value, target: form.target.value, maxLikes: 60000 } });
    window.close();
  };

  // Full counts once; afterwards only the cheap keys are watched.
  Object.assign(stats, (await chrome.runtime.sendMessage({ type: 'stats' })) || {});
  renderStats();
  renderHunt(stats.hunt);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.hunt) renderHunt(changes.hunt.newValue);
    if (changes.enrichQueue) {
      stats.queued = (changes.enrichQueue.newValue || []).length;
      renderStats();
    }
    const added = Object.keys(changes).filter((k) => k.startsWith('lead:') && !changes[k].oldValue && changes[k].newValue).length;
    if (added) {
      stats.total += added;
      renderStats();
    }
  });
})();
