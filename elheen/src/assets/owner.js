// The owner's app: enquiries, pipeline, calendar and set-up.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const STATUS = { new: 'New', talking: 'Talking', booked: 'Booked', done: 'Done', lost: 'Lost' };
  const SOURCES = { instagram: 'Instagram', google: 'Google', link: 'Your link', ad: 'Ad', 'meta-ad': 'Meta ad', website: 'Website' };
  let token = null;
  try { token = localStorage.getItem('elheen-token'); } catch { /* private window */ }
  let biz = null, leads = [], filter = 'all', photoUrls = [];

  const api = async (method, path, body) => {
    const res = await fetch(`/api/${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { signOut(); throw new Error('Please sign in again.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };
  const say = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
  const dubai = (iso, opts) => new Date(iso).toLocaleString('en', { timeZone: 'Asia/Dubai', ...opts });
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  const wa = (phone, text) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '971')}?text=${encodeURIComponent(text)}`;

  // --- signing in and out
  const setToken = (t) => { token = t; try { t ? localStorage.setItem('elheen-token', t) : localStorage.removeItem('elheen-token'); } catch { /* ignore */ } };
  function signOut() { setToken(null); $('appView').hidden = true; $('signOut').hidden = true; $('authView').hidden = false; }
  document.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
    $('loginForm').hidden = b.dataset.show !== 'login'; $('signupForm').hidden = b.dataset.show !== 'signup';
  }));
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('loginError', '');
    try { setToken((await api('POST', 'login', { slug: $('loginSlug').value, password: $('loginPass').value })).token); await start(); }
    catch (err) { say('loginError', err.message); }
  });
  $('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('signupError', '');
    try {
      setToken((await api('POST', 'signup', { invite: $('suInvite').value, name: $('suName').value, kind: $('suKind').value, area: $('suArea').value, password: $('suPass').value })).token);
      await start(); showTab('settings');
    } catch (err) { say('signupError', err.message); }
  });
  $('signOut').addEventListener('click', signOut);

  // --- tabs
  function showTab(name) {
    for (const t of ['inbox', 'detail', 'board', 'calendar', 'settings']) $(`${t}Tab`).hidden = t !== name;
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === (name === 'detail' ? 'inbox' : name))));
    scrollTo(0, 0);
  }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { showTab(b.dataset.tab); if (b.dataset.tab !== 'settings') refresh(); }));
  $('backBtn').addEventListener('click', () => showTab('inbox'));

  // --- enquiries
  function drawFilters() {
    const count = (s) => leads.filter((l) => l.status === s).length;
    $('filters').replaceChildren(...[['all', 'All', leads.length], ...Object.entries(STATUS).map(([k, v]) => [k, v, count(k)])].map(([key, label, n]) => {
      const b = el('button', { className: 'chip-btn', type: 'button' }, label, el('b', {}, String(n)));
      b.setAttribute('aria-pressed', String(filter === key));
      b.addEventListener('click', () => { filter = key; drawFilters(); drawLeads(); });
      return b;
    }));
  }
  function drawLeads() {
    const shown = leads.filter((l) => filter === 'all' || l.status === filter);
    if (!shown.length) {
      $('leadList').replaceChildren(el('div', { className: 'panel empty' }, leads.length ? 'Nothing here yet.' : 'No enquiries yet. Share your link from the Set-up tab and they will appear here.'));
      return;
    }
    $('leadList').replaceChildren(...shown.map((l) => {
      const card = el('button', { className: 'lead', type: 'button' },
        el('b', {}, l.name), el('time', {}, ago(l.createdAt)),
        el('span', { className: 'meta' }, [l.service, l.when ? dubai(l.when, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null].filter(Boolean).join(' · ') || 'General enquiry'),
        el('span', {}, el('span', { className: `badge ${l.status}` }, STATUS[l.status]), ' ', el('span', { className: 'badge src' }, SOURCES[l.source] || l.source)));
      card.addEventListener('click', () => openLead(l.id));
      return card;
    }));
  }
  async function patch(id, change) {
    const { lead } = await api('PATCH', `leads/${id}`, change);
    leads = leads.map((l) => (l.id === id ? lead : l));
    drawAll(); openLead(id);
  }
  async function openLead(id) {
    const l = leads.find((x) => x.id === id);
    if (!l) return;
    photoUrls.forEach(URL.revokeObjectURL); photoUrls = [];
    const row = (label, value) => (value ? el('div', {}, el('span', {}, label), el('span', {}, value)) : '');
    const firstName = l.name.split(' ')[0];
    const greeting = `Hi ${firstName}, this is ${biz.name}. Thanks for your enquiry${l.service ? ` about ${l.service.toLowerCase()}` : ''}.`;
    const statusRow = el('div', { className: 'status-row' }, ...Object.entries(STATUS).map(([key, label]) => {
      const b = el('button', { className: 'chip-btn', type: 'button' }, label);
      b.setAttribute('aria-pressed', String(l.status === key));
      b.addEventListener('click', () => patch(l.id, { status: key }).catch((e) => alert(e.message)));
      return b;
    }));
    const when = el('input', { type: 'datetime-local' });
    if (l.when) when.value = new Date(new Date(l.when).getTime() + 4 * 36e5).toISOString().slice(0, 16);
    when.addEventListener('change', () => patch(l.id, { when: when.value ? new Date(`${when.value}:00+04:00`).toISOString() : null }).catch((e) => alert(e.message)));
    const note = el('textarea', { value: l.ownerNote || '', placeholder: 'Only you can see this.' });
    note.addEventListener('change', () => api('PATCH', `leads/${l.id}`, { ownerNote: note.value }).then(({ lead }) => { leads = leads.map((x) => (x.id === lead.id ? lead : x)); }).catch((e) => alert(e.message)));
    const gallery = el('div', { className: 'gallery' });
    for (const n of l.photos || []) {
      fetch(`/api/photo/${l.id}/${n}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.blob()).then((blob) => {
        const url = URL.createObjectURL(blob); photoUrls.push(url);
        const link = el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: `Photo ${n + 1} from ${l.name}` }));
        gallery.append(link);
      }).catch(() => {});
    }
    $('detail').replaceChildren(
      el('h2', {}, l.name),
      el('span', {}, el('span', { className: `badge ${l.status}` }, STATUS[l.status]), ' ', el('span', { className: 'badge src' }, SOURCES[l.source] || l.source)),
      el('div', { className: 'actions' },
        el('a', { className: 'btn btn-primary', href: wa(l.phone, greeting), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        el('a', { className: 'btn btn-ghost', href: `tel:${l.phone}` }, 'Call'),
        ...(l.location ? [el('a', { className: 'btn btn-ghost', href: `https://maps.google.com/?q=${l.location}`, target: '_blank', rel: 'noopener' }, 'Open map')] : [])),
      el('div', { className: 'rows' },
        row('Phone', l.phone), row('Wants', l.service), row('Price', l.price ? `AED ${l.price}` : (l.price === 0 ? 'Free' : '')),
        row('Message', l.note), row('Address', l.address), row('Received', dubai(l.createdAt, { dateStyle: 'medium', timeStyle: 'short' }))),
      ...((l.photos || []).length ? [el('p', { className: 'step-title' }, 'Photos'), gallery] : []),
      ...((l.chat || []).length ? [el('p', { className: 'step-title' }, 'Chat with the assistant'),
        el('div', { className: 'thread' }, ...l.chat.map((m) => el('div', { className: `bub ${m.role === 'assistant' ? 'us' : 'them'}` }, m.content)))] : []),
      el('p', { className: 'step-title' }, 'Where is this enquiry?'), statusRow,
      el('p', { className: 'step-title' }, 'Visit or appointment time'), when,
      el('p', { className: 'step-title' }, 'Your notes'), note);
    showTab('detail');
  }

  // --- calendar: the days ahead, in order
  function drawAgenda() {
    const upcoming = leads.filter((l) => l.when && l.status !== 'lost' && new Date(l.when).getTime() > Date.now() - 864e5).sort((a, b) => a.when.localeCompare(b.when));
    if (!upcoming.length) { $('agenda').replaceChildren(el('div', { className: 'panel empty' }, 'Nothing booked yet. Booked visits and appointments will show here by day.')); return; }
    const out = []; let day = '';
    for (const l of upcoming) {
      const d = dubai(l.when, { weekday: 'long', day: 'numeric', month: 'long' });
      if (d !== day) { day = d; out.push(el('p', { className: 'day-head' }, d)); }
      const card = el('button', { className: 'lead', type: 'button' },
        el('b', {}, `${dubai(l.when, { hour: 'numeric', minute: '2-digit' })} · ${l.name}`), el('span', { className: `badge ${l.status}` }, STATUS[l.status]),
        el('span', { className: 'meta' }, [l.service, l.address].filter(Boolean).join(' · ') || 'Appointment'));
      card.addEventListener('click', () => openLead(l.id));
      out.push(card);
    }
    $('agenda').replaceChildren(...out);
  }

  // --- set-up
  const svcRow = (s = {}) => {
    const row = el('div', { className: 'svc-row' },
      el('input', { value: s.name || '', placeholder: 'Service name', ariaLabel: 'Service name' }),
      el('input', { type: 'number', min: 5, step: 5, value: s.minutes ?? 60, ariaLabel: 'Minutes' }),
      el('input', { type: 'number', min: 0, step: 10, value: s.price ?? 0, ariaLabel: 'Price in AED' }));
    row.dataset.id = s.id || '';
    const x = el('button', { type: 'button', ariaLabel: 'Remove service' }, '×');
    x.addEventListener('click', () => row.remove());
    row.append(x); return row;
  };
  function drawSettings() {
    $('shareLink').value = `${location.origin}/b/${biz.slug}`;
    $('svcList').replaceChildren(...biz.services.map(svcRow));
    $('askPhotos').checked = biz.askPhotos; $('askAddress').checked = biz.askAddress;
    for (const id of ['openHour', 'closeHour']) {
      $(id).replaceChildren(...Array.from({ length: 25 }, (_, h) => el('option', { value: h }, `${String(h).padStart(2, '0')}:00`)));
      $(id).value = biz[id];
    }
  }
  $('addSvc').addEventListener('click', () => $('svcList').append(svcRow()));
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('shareLink').value); $('copyStatus').textContent = 'Copied.'; }
    catch { $('shareLink').select(); $('copyStatus').textContent = 'Press and hold to copy.'; }
  });
  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('settingsError', ''); $('saveStatus').textContent = '';
    const services = [...$('svcList').children].map((r) => { const [n, m, p] = r.querySelectorAll('input'); return { id: r.dataset.id, name: n.value, minutes: m.value, price: p.value }; });
    try {
      biz = (await api('PUT', 'me', { services, askPhotos: $('askPhotos').checked, askAddress: $('askAddress').checked, openHour: $('openHour').value, closeHour: $('closeHour').value })).business;
      drawSettings(); $('saveStatus').textContent = 'Saved.';
    } catch (err) { say('settingsError', err.message); }
  });

  // --- numbers at the top of the inbox
  function drawStats() {
    const day = 864e5, now = Date.now();
    const tiles = [
      ['New', leads.filter((l) => l.status === 'new').length],
      ['This week', leads.filter((l) => now - l.createdAt < 7 * day).length],
      ['Booked ahead', leads.filter((l) => l.when && l.status === 'booked' && new Date(l.when) > now).length],
      ['Booked value', `AED ${leads.filter((l) => ['booked', 'done'].includes(l.status)).reduce((n, l) => n + (l.price || 0), 0).toLocaleString('en')}`],
    ];
    $('stats').replaceChildren(...tiles.map(([label, value]) => el('div', { className: 'stat-tile' }, el('small', {}, label), el('b', {}, String(value)))));
  }

  // --- pipeline board: one column per stage
  function drawBoard() {
    $('board').replaceChildren(...Object.entries(STATUS).map(([key, label]) => {
      const inCol = leads.filter((l) => l.status === key);
      const col = el('div', { className: 'col' }, el('div', { className: 'col-head' }, el('b', {}, label), el('span', {}, String(inCol.length))));
      for (const l of inCol) {
        const card = el('button', { className: 'card-mini', type: 'button' }, el('b', {}, l.name),
          el('span', {}, [l.service, l.when ? dubai(l.when, { weekday: 'short', hour: 'numeric' }) : null].filter(Boolean).join(' · ') || 'General enquiry'),
          el('span', { className: 'badge src' }, SOURCES[l.source] || l.source));
        card.addEventListener('click', () => openLead(l.id));
        col.append(card);
      }
      if (!inCol.length) col.append(el('p', { className: 'col-empty' }, 'Nothing here'));
      return col;
    }));
  }
  function drawAll() { drawStats(); drawFilters(); drawLeads(); drawBoard(); drawAgenda(); }

  // --- phone alerts
  const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  function drawAlerts() {
    const can = 'serviceWorker' in navigator && 'PushManager' in window && biz.pushKey;
    $('alertBtn').hidden = !can;
    if (!biz.pushKey) $('alertHint').textContent = 'Phone alerts are being set up and will be available shortly.';
    else if (!can) $('alertHint').textContent = 'On an iPhone, first add Elheen to your home screen (Share, then Add to Home Screen), open it from there, and come back to this page.';
    $('alertStatus').textContent = biz.alerts ? `Alerts are on for ${biz.alerts} device${biz.alerts > 1 ? 's' : ''}.` : '';
  }
  $('alertBtn').addEventListener('click', async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') { $('alertStatus').textContent = 'Alerts are blocked for this site in your browser settings.'; return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(biz.pushKey) });
      biz = (await api('POST', 'push', { subscription: sub.toJSON() })).business;
      drawAlerts();
    } catch (err) { $('alertStatus').textContent = 'Alerts could not be turned on here. Try again from Chrome or Safari.'; }
  });

  // --- assistant
  function drawAssistant() {
    $('aiOn').checked = !!biz.aiOn; $('aiNotes').value = biz.aiNotes || '';
    $('aiOn').disabled = !biz.aiAvailable;
    if (!biz.aiAvailable) $('aiHint').textContent = 'The assistant is not switched on for your plan yet. Ask us and we will enable it.';
  }
  $('aiSave').addEventListener('click', async () => {
    try { biz = (await api('PUT', 'me', { aiOn: $('aiOn').checked, aiNotes: $('aiNotes').value })).business; drawAssistant(); $('aiStatus').textContent = 'Saved.'; }
    catch (err) { $('aiStatus').textContent = err.message; }
  });

  async function refresh() {
    leads = (await api('GET', 'leads')).leads;
    drawAll();
  }
  async function start() {
    biz = (await api('GET', 'me')).business;
    $('authView').hidden = true; $('appView').hidden = false; $('signOut').hidden = false;
    drawSettings(); drawAlerts(); drawAssistant(); await refresh();
  }
  (token ? start().catch(signOut) : Promise.resolve(signOut()));
  setInterval(() => { if (token && !$('appView').hidden && $('detailTab').hidden && $('settingsTab').hidden && document.visibilityState === 'visible') refresh().catch(() => {}); }, 30000);
})();
