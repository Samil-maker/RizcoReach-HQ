// The owner's app: today's follow-ups, leads, quotes, payments, calendar and set-up.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (/^(aria-|data-)/.test(k) || ['role', 'for', 'list'].includes(k)) n.setAttribute(k, v === true ? '' : String(v));
      else n[k] = v;
    }
    n.append(...kids.flat(Infinity).filter((x) => x != null && x !== false && x !== ''));
    return n;
  };
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false && x !== ''));
  const ICONS = {
    reply: '<path d="M21 12a8.500 8.500 0 0 1-12.300 7.600L3 21l1.500-5.300A8.500 8.500 0 1 1 21 12z"/>',
    checkin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    visit: '<path d="M12 21s-7-6.100-7-11.500a7 7 0 0 1 14 0C19 14.900 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
    deposit: '<rect x="2.500" y="6" width="19" height="13" rx="2"/><path d="M2.500 10h19M6.500 15h3"/>',
    quote: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  };
  const icon = (name) => { const s = el('span', { class: 'task-ico', 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.reply}</svg>`; return s; };

  // --- words
  const STAGES = { new: 'New', talking: 'Talking', booked: 'Visit booked', quoted: 'Quote sent', won: 'Won', done: 'Finished', lost: 'Lost' };
  const SHOP_STAGES = { new: 'New', talking: 'Talking', booked: 'Booked', quoted: 'Quote sent', won: 'Won', done: 'Done', lost: 'Lost' };
  const SOURCES = { instagram: 'Instagram', google: 'Google', link: 'Enquiry link', ad: 'Ad', 'meta-ad': 'Facebook ad', website: 'Website', 'instagram-dm': 'Instagram message', whatsapp: 'WhatsApp', call: 'Phone call', 'walk-in': 'Walk-in', referral: 'Referral', other: 'Other' };
  const QSTATE = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const stageWords = () => (biz.project ? STAGES : SHOP_STAGES);
  const stageList = () => {
    const base = biz.project ? ['new', 'talking', 'booked', 'quoted', 'won', 'done', 'lost'] : ['new', 'talking', 'booked', 'done', 'lost'];
    const extra = ['quoted', 'won'].filter((s) => !base.includes(s) && leads.some((l) => l.status === s));
    return [...base.slice(0, 3), ...extra, ...base.slice(3)];
  };
  const stageBadge = (s) => el('span', { class: `badge ${s}` }, stageWords()[s] || s);
  const visitWord = () => (biz.project ? 'site visit' : 'appointment');

  // --- money, time and WhatsApp
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const aed = (n) => { const v = money(n); return `AED ${v.toLocaleString('en', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`; };
  const TZ = 'Asia/Dubai', DUBAI = 4 * 36e5, DAY = 864e5;
  const fmt = (t, opts) => new Date(t).toLocaleString('en-GB', { timeZone: TZ, ...opts });
  const timeOf = (t) => fmt(t, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ');
  const dateOf = (t, year) => fmt(t, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  const dayStart = (t = Date.now()) => { const d = new Date(t + DUBAI); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - DUBAI; };
  const monthStart = () => { const d = new Date(Date.now() + DUBAI); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - DUBAI; };
  const ago = (t) => {
    const m = Math.max(0, Math.round((Date.now() - t) / 6e4));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
    const d = Math.round(h / 24); return `${d} day${d > 1 ? 's' : ''} ago`;
  };
  const whenText = (iso) => {
    const t = Date.parse(iso), d0 = dayStart();
    const day = t >= d0 && t < d0 + DAY ? 'Today' : t >= d0 + DAY && t < d0 + 2 * DAY ? 'Tomorrow' : fmt(t, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day}, ${timeOf(t)}`;
  };
  const toInput = (iso) => (iso ? new Date(Date.parse(iso) + DUBAI).toISOString().slice(0, 16) : '');
  const fromInput = (v) => (v ? new Date(`${v}:00+04:00`).toISOString() : null);
  const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
  const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
  const waNumber = (phone) => {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = `971${d.slice(1)}`;
    if (/^5\d{8}$/.test(d)) d = `971${d}`;
    return d;
  };
  const wa = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

  // --- state
  let token = null;
  try { token = localStorage.getItem('elheen-token'); } catch { /* private window */ }
  let biz = null, leads = [], quotes = [], tasks = [], siteUrl = location.origin, locked = false;
  let current = { name: '', arg: '' }, prevHash = '', leadView = 'list', leadFilter = 'all', quoteFilter = 'all', calFilter = 'all';
  let photoUrls = [], qState = null, chosenOption = 'month', asked = new Set();
  const leadById = (id) => leads.find((l) => l.id === id);

  const api = async (method, path, body) => {
    const res = await fetch(`/api/${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !['login', 'signup', 'password'].includes(path)) { signOut(); throw new Error('Please sign in again.'); }
    if (res.status === 402 && data.locked) { setLocked(true); const e = new Error(data.error); e.locked = true; throw e; }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong. Please try again.'); e.status = res.status; e.data = data; throw e; }
    return data;
  };
  const say = (id, text) => { $(id).textContent = text || ''; $(id).hidden = !text; };
  let toastTimer;
  const toast = (text) => { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); };
  const oops = (err) => { if (!err.locked) toast(err.message); };
  async function copy(text, fallbackInput) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { if (fallbackInput) { fallbackInput.hidden = false; fallbackInput.value = text; fallbackInput.select(); } return false; }
  }
  function openOut(url) {
    const w = window.open(url, '_blank');
    if (w) w.opener = null; else location.href = url;
  }

  // --- signing in and out
  const setToken = (t) => { token = t; try { t ? localStorage.setItem('elheen-token', t) : localStorage.removeItem('elheen-token'); } catch { /* ignore */ } };
  function signOut() {
    setToken(null); biz = null; leads = []; quotes = []; tasks = [];
    $('appView').hidden = true; $('authView').hidden = false;
    document.title = 'Sign in | Elheen';
  }
  document.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
    $('loginForm').hidden = b.dataset.show !== 'login'; $('signupForm').hidden = b.dataset.show !== 'signup';
    ($('loginForm').hidden ? $('suName') : $('loginSlug')).focus();
  }));
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('loginError', '');
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { setToken((await api('POST', 'login', { slug: $('loginSlug').value, password: $('loginPass').value })).token); await start(); }
    catch (err) { say('loginError', err.message); }
    if (btn) btn.disabled = false;
  });
  $('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('signupError', '');
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      setToken((await api('POST', 'signup', { name: $('suName').value, phone: $('suPhone').value, kind: $('suKind').value, area: $('suArea').value, password: $('suPass').value, website: $('suWebsite').value })).token);
      history.replaceState(null, '', '/app#today');
      await start();
      toast('Your account is ready. Five quick steps and you are live.');
    } catch (err) { say('signupError', err.message); }
    if (btn) btn.disabled = false;
  });
  $('signOut').addEventListener('click', () => { signOut(); history.replaceState(null, '', '/app'); });
  if (new URLSearchParams(location.search).get('new') !== null) { $('loginForm').hidden = true; $('signupForm').hidden = false; }

  // --- data
  async function loadAll() {
    try {
      const [l, q, t] = await Promise.all([api('GET', 'leads'), api('GET', 'quotes'), api('GET', 'today')]);
      leads = l.leads; quotes = q.quotes; tasks = t.tasks; siteUrl = t.siteUrl || siteUrl;
      setLocked(false);
    } catch (err) { if (!err.locked) throw err; }
    drawCounts();
  }
  function setLocked(on) {
    if (locked === on) return;
    locked = on;
    if (biz) render();
  }
  function drawCounts() {
    const n = tasks.length;
    for (const id of ['todayCount', 'todayCountBar']) { $(id).textContent = String(n); $(id).hidden = !n || locked; }
  }

  // --- routes: #today, #leads, #lead/<id>, #quotes, #quote/<id>, #newquote/<leadId>, #calendar, #setup
  const TITLES = { today: 'Today', leads: 'Leads', quotes: 'Quotes', calendar: 'Calendar', setup: 'Set-up' };
  function parse() {
    const [name, arg = ''] = location.hash.replace(/^#/, '').split('/');
    return { name: ['today', 'leads', 'lead', 'quotes', 'quote', 'newquote', 'calendar', 'setup'].includes(name) ? name : 'today', arg: decodeURIComponent(arg) };
  }
  function route() {
    const next = parse();
    const leavingEditor = ['quote', 'newquote'].includes(current.name) && !(next.name === current.name && next.arg === current.arg);
    if (leavingEditor && qState?.dirty && !confirm('Leave this quote without saving your changes?')) { history.replaceState(null, '', prevHash); return; }
    if (leavingEditor) qState = null;
    current = next; prevHash = location.hash || '#today';
    render();
    scrollTo(0, 0);
    if (biz && ['today', 'leads', 'quotes', 'calendar', 'lead'].includes(next.name)) {
      const at = location.hash;
      loadAll().then(() => { if (location.hash === at && !(next.name === 'lead' && document.activeElement?.closest?.('#view-lead'))) render(); }).catch(() => {});
    }
  }
  window.addEventListener('hashchange', route);

  function render() {
    if (!biz) return;
    photoUrls.forEach(URL.revokeObjectURL); photoUrls = [];
    const { name, arg } = current;
    const tab = { lead: 'leads', quote: 'quotes', newquote: 'quotes' }[name] || name;
    document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
    fill($('headActions'), );
    $('backBtn').hidden = true;
    $('sideBiz').textContent = biz.name;
    drawBanner();
    if (locked && name !== 'setup') { $('viewTitle').textContent = 'Plan ended'; $('view-locked').hidden = false; document.title = 'Elheen'; return; }
    $('viewTitle').textContent = TITLES[name] || '';
    if (name === 'today') drawToday();
    else if (name === 'leads') drawLeads();
    else if (name === 'lead') drawLead(arg);
    else if (name === 'quotes') drawQuotes();
    else if (name === 'quote' || name === 'newquote') drawQuoteEditor(name, arg);
    else if (name === 'calendar') drawCalendar();
    else if (name === 'setup') drawSetup();
    document.title = `${$('viewTitle').textContent} | Elheen`;
  }
  const back = (href) => { $('backBtn').href = href; $('backBtn').hidden = false; };

  function drawBanner() {
    const b = biz.billing, days = Math.ceil((b.paidUntil - Date.now()) / DAY);
    const warn = ['due', 'overdue'].includes(b.state) || (['trial', 'active'].includes(b.state) && days <= 5);
    $('planBanner').hidden = !warn || current.name === 'setup';
    $('planBannerText').textContent = b.state === 'overdue' ? 'Your Elheen plan has ended. Your enquiry page still works.'
      : b.state === 'due' ? 'Your Elheen payment is due. Pay within 7 days to keep everything open.'
        : `Your ${b.state === 'trial' ? 'free trial' : 'plan'} ends in ${days} day${days === 1 ? '' : 's'}.`;
  }

  // ---------- today ----------
  function stats() {
    const now = Date.now(), m0 = monthStart(), week = now - 7 * DAY;
    const open = quotes.filter((q) => q.state === 'sent');
    const tile = (label, value, sub) => el('div', { class: 'kpi' }, el('small', {}, label), el('b', {}, value), sub ? el('span', {}, sub) : null);
    const newWeek = leads.filter((l) => l.createdAt >= week).length;
    if (biz.project) {
      const won = leads.filter((l) => l.wonAt && l.wonAt >= m0);
      const toCollect = leads.filter((l) => ['won', 'done'].includes(l.status)).flatMap((l) => l.milestones || []).filter((x) => !x.paidAt).reduce((n, x) => n + x.amount, 0);
      return [
        tile('New leads', String(newWeek), 'last 7 days'),
        tile('Quotes out', aed(open.reduce((n, q) => n + q.totals.total, 0)), `${open.length} waiting for an answer`),
        tile('Won this month', aed(won.reduce((n, l) => n + (l.value || 0), 0)), `${won.length} job${won.length === 1 ? '' : 's'}`),
        tile('To collect', aed(toCollect), 'unpaid on won jobs'),
      ];
    }
    const ahead = leads.filter((l) => l.when && Date.parse(l.when) > now && !['lost', 'done'].includes(l.status));
    const month = leads.filter((l) => l.when && Date.parse(l.when) >= m0 && Date.parse(l.when) < now + 31 * DAY && ['booked', 'done', 'won'].includes(l.status));
    return [
      tile('New leads', String(newWeek), 'last 7 days'),
      tile('Coming up', String(ahead.length), 'booked ahead'),
      tile('Booked this month', aed(month.reduce((n, l) => n + (l.value || l.price || 0), 0))),
      tile('Quotes out', String(open.length), aed(open.reduce((n, q) => n + q.totals.total, 0))),
    ];
  }
  function taskMessage(t, l) {
    const hi = `Hi ${first(l.name)}`;
    const link = t.publicKey ? `${siteUrl}/q/${t.publicKey}` : '';
    const at = t.when ? whenText(t.when).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase()) : '';
    if (t.type === 'reply' && t.when) return `${hi}, this is ${biz.name}. Thank you for booking. Your ${visitWord()} is confirmed for ${at}${l.address && biz.project ? ` at ${l.address}` : ''}. Reply here if anything changes. See you then.`;
    if (t.type === 'reply') return `${hi}, this is ${biz.name}. Thank you for your enquiry${l.service ? ` about ${lower(l.service)}` : ''}. ${biz.project ? 'When would suit you for a quick call, or for us to come and see the space?' : 'Which day and time suit you best?'}`;
    if (t.type === 'checkin') return `${hi}, ${biz.name} here. Just checking in${l.service ? ` about your ${lower(l.service)}` : ''}. Is there anything I can help with?`;
    if (t.type === 'visit') return `${hi}, this is ${biz.name} confirming your ${visitWord()} ${at}${l.address && biz.project ? ` at ${l.address}` : ''}. Reply here if anything changes. See you then.`;
    if (t.type === 'deposit') return `${hi}, thank you for choosing ${biz.name}. To lock in your start date, the ${lower(t.label)} is ${aed(t.amount)}. Shall I send you the bank details or a card payment link?`;
    if (t.type === 'quote') {
      if (t.step === 1) return `${hi}, did you get a chance to look at your quote from ${biz.name}? Here it is again: ${link}\n\nHappy to answer any questions.`;
      if (t.step === 2) return `${hi}, following up on quote ${t.number}. Would you like to change anything, or shall we book a start date?\n\n${link}`;
      return `${hi}, your quote ${t.number} is still open: ${link}\n\nIf the timing is not right, no problem. Just let me know and I will close it.`;
    }
    return hi;
  }
  const dueText = (t, l) => {
    if (t.type === 'reply' && t.when) return `Booked for ${whenText(t.when)} · came in ${ago(l.createdAt)}`;
    if (t.type === 'reply') return `Came in ${ago(l.createdAt)}${l.source ? ` · ${SOURCES[l.source] || l.source}` : ''}`;
    if (t.type === 'visit') return whenText(t.when);
    if (t.type === 'quote') return `Follow-up ${t.step} of 3`;
    return '';
  };
  async function finishTask(t, kind, days) {
    try {
      await api('POST', `today/${kind}`, { type: t.type, leadId: t.leadId, quoteId: t.quoteId, days });
      asked.delete(`${t.type}:${t.leadId}:${t.quoteId || ''}`);
      await loadAll(); render();
      toast(kind === 'done' ? 'Done.' : 'Moved to tomorrow.');
    } catch (err) { oops(err); }
  }
  function taskCard(t) {
    const l = leadById(t.leadId);
    if (!l) return null;
    const key = `${t.type}:${t.leadId}:${t.quoteId || ''}`;
    const acts = el('div', { class: 'task-acts' });
    const card = el('div', { class: `task ${t.type}` },
      el('div', { class: 'task-top' }, icon(t.type),
        el('div', { class: 'task-text' }, el('b', {}, t.title), el('span', {}, t.detail), dueText(t, l) ? el('span', {}, dueText(t, l)) : null)),
      acts);
    const drawActs = () => {
      if (asked.has(key)) {
        fill(acts, el('div', { class: 'task-ask' }, 'Did you send it?',
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => finishTask(t, 'done') } }, 'Yes, mark done'),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { asked.delete(key); drawActs(); } } }, 'Not yet')));
        return;
      }
      fill(acts, 
        el('a', { class: 'btn btn-wa btn-sm', href: wa(l.phone, taskMessage(t, l)), target: '_blank', rel: 'noopener', on: { click: () => { asked.add(key); setTimeout(drawActs, 400); } } }, 'WhatsApp'),
        l.phone ? el('a', { class: 'btn btn-ghost btn-sm', href: `tel:${l.phone}` }, 'Call') : null,
        el('a', { class: 'btn btn-ghost btn-sm', href: `/app#lead/${l.id}` }, 'Open'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => finishTask(t, 'snooze', 1) } }, 'Tomorrow'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => finishTask(t, 'done') } }, 'Done'));
    };
    drawActs();
    return card;
  }
  // five steps that replace a set-up call; each ticks itself off
  function checklist() {
    const steps = [
      [!!biz.phone, 'Add your WhatsApp number', 'It goes on your quotes so clients can reply to you.', 'Add it', '/app#setup/details'],
      [!!biz.servicesSaved, 'Check your services and prices', 'We filled in common ones for your trade. Change them to match what you sell.', 'Check them', '/app#setup/services'],
      [!!biz.linkShared, 'Put your enquiry link in your Instagram bio', 'Also in your WhatsApp Business profile and your Google listing.', 'Copy my link', 'copy'],
      [!!biz.alerts, 'Turn on phone alerts', 'Know the second a lead comes in or a quote is accepted.', 'Turn on', '/app#setup/alerts'],
      [leads.length > 0, 'Send yourself a test enquiry', 'See exactly what your clients see, then delete it.', 'Open my page', `/b/${biz.slug}`],
    ];
    const done = steps.filter(([ok]) => ok).length;
    if (biz.checklistHidden || done === steps.length) return null;
    return el('div', { class: 'box setup-list' },
      el('div', { class: 'box-head' }, el('h2', {}, 'Get ready in five minutes'), el('span', { class: 'muted small' }, `${done} of ${steps.length} done`)),
      el('div', { class: 'progress', role: 'img', 'aria-label': `${done} of ${steps.length} done` }, el('i', { style: `width:${(done / steps.length) * 100}%` })),
      el('ol', {}, ...steps.map(([ok, title, text, label, href]) => el('li', { class: ok ? 'ok' : '' },
        el('span', { class: 'tick', 'aria-hidden': 'true' }, ok ? '✓' : ''),
        el('div', {}, el('b', {}, title), el('span', {}, ok ? 'Done.' : text)),
        ok ? null : href === 'copy'
          ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: copyMyLink } }, label)
          : el('a', { class: 'btn btn-ghost btn-sm', href, ...(href.startsWith('/b/') ? { target: '_blank', rel: 'noopener' } : {}) }, label)))),
      el('button', { class: 'link', type: 'button', on: { click: () => api('PUT', 'me', { checklistHidden: true }).then((r) => { biz = r.business; render(); }).catch(oops) } }, 'Hide this list'));
  }
  async function copyMyLink() {
    const link = `${location.origin}/b/${biz.slug}`;
    const ok = await copy(link);
    toast(ok ? 'Link copied. Paste it in your Instagram bio.' : `Your link: ${link}`);
    if (!biz.linkShared) { try { biz = (await api('PUT', 'me', { linkShared: true })).business; if (current.name === 'today') render(); } catch { /* not important */ } }
    return ok;
  }

  function drawToday() {
    $('view-today').hidden = false;
    const setupBox = checklist();
    $('setupSlot').hidden = !setupBox;
    fill($('setupSlot'), setupBox);
    const h = new Date(Date.now() + DUBAI).getUTCHours();
    $('greet').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}. ${fmt(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}.`;
    fill($('stats'), ...stats());
    const groups = [
      ['Reply first', tasks.filter((t) => t.type === 'reply')],
      ['Confirm tomorrow', tasks.filter((t) => t.type === 'visit')],
      ['Chase quotes', tasks.filter((t) => t.type === 'quote')],
      ['Collect payments', tasks.filter((t) => t.type === 'deposit')],
      ['Check in', tasks.filter((t) => t.type === 'checkin')],
    ].filter(([, list]) => list.length);
    if (!groups.length) {
      fill($('tasks'), el('div', { class: 'all-clear' },
        el('b', {}, leads.length ? 'All caught up.' : 'Your first lead is one link away.'),
        el('p', {}, leads.length ? 'Nothing to chase right now. New enquiries, quotes to follow up and visits to confirm will show up here on their own.'
          : 'Share your enquiry link on Instagram, WhatsApp and Google. Every enquiry lands in Leads and shows up here until you reply.'),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: copyMyLink } }, 'Copy my enquiry link')));
      return;
    }
    fill($('tasks'), groups.flatMap(([title, list]) => [el('h2', { class: 'section-title' }, `${title} · ${list.length}`), ...list.map(taskCard)]));
  }

  // ---------- leads ----------
  function leadMeta(l) {
    return [l.service, l.when ? whenText(l.when) : null, l.address || null].filter(Boolean).join(' · ') || 'General enquiry';
  }
  function leadRow(l) {
    return el('button', { class: 'row', type: 'button', on: { click: () => { location.hash = `#lead/${l.id}`; } } },
      el('b', {}, l.name), el('span', { class: 'side-val' }, ago(l.createdAt)),
      el('span', { class: 'meta' }, leadMeta(l)), l.value ? el('span', { class: 'amount' }, aed(l.value)) : el('span'),
      el('span', { class: 'tags' }, stageBadge(l.status), el('span', { class: 'badge src' }, SOURCES[l.source] || l.source),
        (l.photos || []).length ? el('span', { class: 'badge src' }, `${l.photos.length} photo${l.photos.length > 1 ? 's' : ''}`) : null,
        l.assignee ? el('span', { class: 'badge src' }, l.assignee) : null));
  }
  function searched() {
    const q = $('leadSearch').value.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => [l.name, l.phone, l.address, l.service, l.email, l.assignee].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  function drawLeads() {
    $('view-leads').hidden = false;
    fill($('headActions'), el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => { $('addLeadForm').hidden = false; $('alName').focus(); } } }, 'Add lead'));
    const list = searched();
    const count = (s) => list.filter((l) => l.status === s).length;
    const chips = [['all', 'All', list.length], ...stageList().map((s) => [s, stageWords()[s], count(s)])];
    $('leadFilters').hidden = leadView === 'board';
    fill($('leadFilters'), ...chips.map(([key, label, n]) => el('button', {
      class: 'chip-btn', type: 'button', 'aria-pressed': String(leadFilter === key), on: { click: () => { leadFilter = key; drawLeads(); } },
    }, label, el('b', {}, String(n)))));
    document.querySelectorAll('[data-leadview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.leadview === leadView)));
    $('leadList').hidden = leadView !== 'list'; $('leadBoard').hidden = leadView !== 'board';
    if (leadView === 'list') {
      const shown = list.filter((l) => leadFilter === 'all' || l.status === leadFilter);
      fill($('leadList'), ...(shown.length ? shown.map(leadRow) : [el('div', { class: 'empty' },
        el('b', {}, leads.length ? 'No leads here.' : 'No leads yet.'),
        leads.length ? 'Try another stage or search.' : 'Share your enquiry link, or add a lead that came by phone or WhatsApp.',
        leads.length ? null : el('br'), leads.length ? null : el('a', { class: 'btn btn-ghost btn-sm', href: '/app#setup' }, 'Get my link'))]));
    } else {
      fill($('leadBoard'), ...stageList().map((s) => {
        const inCol = list.filter((l) => l.status === s);
        return el('div', { class: 'col' }, el('div', { class: 'col-head' }, el('b', {}, stageWords()[s]), el('span', {}, String(inCol.length))),
          ...(inCol.length ? inCol.map((l) => el('button', { class: 'card-mini', type: 'button', on: { click: () => { location.hash = `#lead/${l.id}`; } } },
            el('b', {}, l.name), el('span', {}, leadMeta(l)), l.value ? el('span', {}, aed(l.value)) : null)) : [el('p', { class: 'col-empty' }, 'Nothing here')]));
      }));
    }
  }
  $('leadSearch').addEventListener('input', () => drawLeads());
  document.querySelectorAll('[data-leadview]').forEach((b) => b.addEventListener('click', () => { leadView = b.dataset.leadview; drawLeads(); }));
  $('alCancel').addEventListener('click', () => { $('addLeadForm').hidden = true; $('addLeadForm').reset(); say('alError', ''); });
  $('addLeadForm').addEventListener('submit', async (e) => {
    e.preventDefault(); say('alError', '');
    try {
      const { id } = await api('POST', 'leads', { name: $('alName').value, phone: $('alPhone').value, source: $('alSource').value, service: $('alService').value, address: $('alAddress').value, note: $('alNote').value });
      e.target.reset(); $('addLeadForm').hidden = true;
      await loadAll(); location.hash = `#lead/${id}`;
      toast('Lead saved.');
    } catch (err) { say('alError', err.message); }
  });

  // ---------- one lead ----------
  async function patchLead(id, change, quiet) {
    const { lead } = await api('PATCH', `leads/${id}`, change);
    leads = leads.map((l) => (l.id === id ? lead : l));
    if (!quiet) { const t = await api('GET', 'today').catch(() => null); if (t) tasks = t.tasks; drawCounts(); render(); }
    return lead;
  }
  function box(title, ...kids) { return el('div', { class: 'box' }, title ? el('div', { class: 'box-head' }, el('h2', {}, title)) : null, ...kids); }
  function drawLead(id) {
    const l = leadById(id);
    back('/app#leads');
    $('view-lead').hidden = false;
    if (!l) { $('viewTitle').textContent = 'Lead'; fill($('view-lead'), el('div', { class: 'empty' }, el('b', {}, 'This lead was not found.'), 'It may have been deleted.')); return; }
    $('viewTitle').textContent = l.name;
    const greeting = `Hi ${first(l.name)}, this is ${biz.name}. Thank you for your enquiry${l.service ? ` about ${lower(l.service)}` : ''}.`;
    const map = l.location ? `https://maps.google.com/?q=${l.location}` : (l.address ? `https://maps.google.com/?q=${encodeURIComponent(l.address)}` : null);

    // stage
    const stages = el('div', { class: 'stages' }, ...stageList().map((s) => el('button', {
      class: 'chip-btn', type: 'button', 'aria-pressed': String(l.status === s),
      on: { click: () => { if (s !== l.status) patchLead(l.id, { status: s }).then(() => toast(`Moved to ${stageWords()[s]}.`)).catch(oops); } },
    }, stageWords()[s])));

    // visit time and who goes
    const when = el('input', { type: 'datetime-local', value: toInput(l.when), step: 900 });
    const who = el('select', { 'aria-label': 'Who goes' }, el('option', { value: '' }, 'No one yet'), ...(biz.team || []).map((t) => el('option', { value: t, selected: l.assignee === t }, t)));
    const saveWhen = async (force) => {
      try {
        await patchLead(l.id, { when: fromInput(when.value), assignee: who.value, ...(force ? { force: true } : {}) });
        toast(when.value ? `${visitWord().charAt(0).toUpperCase() + visitWord().slice(1)} saved.` : 'Time cleared.');
      } catch (err) {
        if (err.status === 409 && err.data?.clash && confirm(`${err.message} Book this one at the same time anyway?`)) return saveWhen(true);
        oops(err);
      }
    };
    const whenBox = box(biz.project ? 'Site visit' : 'Appointment',
      el('div', { class: 'when-row' },
        el('label', {}, 'Date and time', when),
        (biz.team || []).length ? el('label', {}, 'Who goes', who) : el('span'),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => saveWhen(false) } }, 'Save time')),
      l.when ? el('p', { class: 'muted small' }, `${whenText(l.when)}${l.assignee ? ` · ${l.assignee}` : ''}. `, el('button', { class: 'link', type: 'button', on: { click: () => { when.value = ''; saveWhen(false); } } }, 'Clear the time')) : null,
      !(biz.team || []).length && biz.project ? el('p', { class: 'muted small' }, 'Add your team in Set-up to give visits to someone.') : null);

    // quotes for this lead
    const mine = quotes.filter((q) => q.leadId === l.id);
    const quotesBox = box('Quotes',
      mine.length ? el('div', { class: 'mini-list' }, ...mine.map((q) => el('button', { type: 'button', on: { click: () => { location.hash = `#quote/${q.id}`; } } },
        el('div', {}, el('b', {}, `${q.number} · ${q.title}`), el('br'), el('span', {}, q.sentAt ? `Sent ${dateOf(q.sentAt)}${q.viewedAt ? ' · opened' : ''}` : `Made ${dateOf(q.createdAt)}`)),
        el('div', {}, el('b', {}, aed(q.totals.total)), ' ', el('span', { class: `badge ${q.state}` }, QSTATE[q.state]))))) : el('p', { class: 'muted small' }, biz.project ? 'Price the job and send it on WhatsApp. The client opens a proper quote, accepts it with one tap, and you get told.' : 'Send a priced quote for packages or bigger jobs.'),
      el('div', { class: 'row-actions' }, el('a', { class: `btn ${biz.project ? 'btn-primary' : 'btn-ghost'} btn-sm`, href: `/app#newquote/${l.id}` }, 'New quote')));

    // payments on a won job
    const showPay = ['won', 'done'].includes(l.status) || (l.milestones || []).length || l.value;
    let payBox = null;
    if (showPay) {
      let lines = (l.milestones || []).map((x) => ({ ...x, paid: !!x.paidAt }));
      const value = el('input', { type: 'number', min: 0, step: 'any', value: l.value || '', inputMode: 'decimal', placeholder: '0' });
      const list = el('div');
      const sum = el('div');
      const savePay = async (msg) => {
        try { await patchLead(l.id, { value: value.value, milestones: lines }); toast(msg || 'Payments saved.'); } catch (err) { oops(err); }
      };
      const drawLines = () => {
        fill(list, ...lines.map((x, i) => el('div', { class: 'pay-line' },
          el('input', { type: 'checkbox', checked: x.paid, 'aria-label': `${x.label} received`, on: { change: (e) => { x.paid = e.target.checked; savePay(x.paid ? `${x.label} marked as received.` : 'Marked as not received.'); } } }),
          el('input', { type: 'text', value: x.label, 'aria-label': 'Payment name', on: { input: (e) => { x.label = e.target.value; } } }),
          el('input', { type: 'number', min: 0, step: 'any', value: x.amount, inputMode: 'decimal', 'aria-label': 'Amount in AED', on: { input: (e) => { x.amount = money(e.target.value); drawSum(); } } }),
          el('button', { class: 'x', type: 'button', 'aria-label': 'Remove payment', on: { click: () => { lines.splice(i, 1); drawLines(); } } }, '×'))));
        drawSum();
      };
      const drawSum = () => {
        const total = lines.reduce((n, x) => n + money(x.amount), 0), got = lines.filter((x) => x.paid).reduce((n, x) => n + money(x.amount), 0);
        const of = Number(value.value) || total;
        fill(sum, 
          el('div', { class: 'progress', role: 'img', 'aria-label': `${aed(got)} of ${aed(of)} received` }, el('i', { style: `width:${of ? Math.min(100, (got / of) * 100) : 0}%` })),
          el('div', { class: 'pay-sum' }, el('span', {}, `${aed(got)} received`), el('span', { class: 'muted' }, `${aed(Math.max(0, of - got))} to collect`)));
      };
      const split = () => {
        const total = money(value.value);
        if (!total) { toast('Add the job value first.'); value.focus(); return; }
        const parts = biz.project ? [['Deposit', 50], ['Progress payment', 40], ['On handover', 10]] : [['Payment', 100]];
        let left = total;
        lines = parts.map(([label, pct], i) => { const amount = i === parts.length - 1 ? left : money((total * pct) / 100); left = money(left - amount); return { id: '', label, amount, paid: false }; });
        drawLines();
      };
      drawLines();
      payBox = box('Payments',
        el('label', {}, 'Job value (AED)', value),
        lines.length ? null : el('p', { class: 'muted small' }, 'Split the job into a deposit and stage payments, tick each one when it comes in, and Today reminds you to collect the deposit.'),
        list, sum,
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { lines.push({ id: '', label: 'Payment', amount: 0, paid: false }); drawLines(); } } }, 'Add a payment'),
          lines.length ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: split } }, biz.project ? 'Split 50 / 40 / 10' : 'One payment'),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => savePay() } }, 'Save payments')));
    }

    // details, editable
    const row = (label, value) => (value ? el('div', {}, el('span', {}, label), el('span', {}, value)) : null);
    const facts = el('div', { class: 'facts' },
      row('Phone', l.phone), row('Email', l.email), row('Wants', l.service), row('Budget', l.budget), row('Price', l.price ? aed(l.price) : null),
      row('Address', l.address), row('Message', l.note), row('Ad', [l.adName, l.campaign].filter(Boolean).join(' · ')),
      row('Came from', SOURCES[l.source] || l.source), row('Received', fmt(l.createdAt, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })));
    const fields = [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['service', 'What they want'], ['budget', 'Budget'], ['address', 'Address']];
    const inputs = Object.fromEntries(fields.map(([k]) => [k, el('input', { value: l[k] || '', ...(k === 'phone' ? { type: 'tel', inputMode: 'tel' } : {}), ...(k === 'service' ? { list: 'serviceList' } : {}) })]));
    const editForm = el('form', { class: 'grid-2', hidden: true, on: { submit: async (e) => {
      e.preventDefault();
      try { await patchLead(l.id, Object.fromEntries(fields.map(([k]) => [k, inputs[k].value]))); toast('Details saved.'); } catch (err) { oops(err); }
    } } }, ...fields.map(([k, label]) => el('label', {}, label, inputs[k])),
    el('div', { class: 'row-actions' }, el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Save details'), el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { editForm.hidden = true; facts.hidden = false; editBtn.hidden = false; } } }, 'Cancel')));
    const editBtn = el('button', { class: 'link', type: 'button', on: { click: () => { editForm.hidden = false; facts.hidden = true; editBtn.hidden = true; } } }, 'Edit');
    const detailsBox = el('div', { class: 'box' }, el('div', { class: 'box-head' }, el('h2', {}, 'Details'), editBtn), facts, editForm);

    // photos
    let photosBox = null;
    if ((l.photos || []).length) {
      const gallery = el('div', { class: 'gallery' });
      for (const n of l.photos) {
        fetch(`/api/photo/${l.id}/${n}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.blob() : Promise.reject())).then((blob) => {
          const url = URL.createObjectURL(blob); photoUrls.push(url);
          gallery.append(el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: `Photo ${n + 1} from ${l.name}` })));
        }).catch(() => {});
      }
      photosBox = box(`Photos · ${l.photos.length}`, gallery);
    }

    // notes and history
    const note = el('textarea', { value: l.ownerNote || '', placeholder: 'Measurements, materials, what they liked, gate code. Only you see this.', rows: 4 });
    const noteStatus = el('p', { class: 'muted small', role: 'status' });
    note.addEventListener('change', () => patchLead(l.id, { ownerNote: note.value }, true).then(() => { noteStatus.textContent = 'Saved.'; }).catch(oops));
    const hist = (l.history || []).slice().reverse().slice(0, 30);

    fill($('view-lead'), 
      el('div', { class: 'lead-top' }, stageBadge(l.status), el('span', { class: 'badge src' }, SOURCES[l.source] || l.source), el('span', { class: 'badge src' }, `Came in ${ago(l.createdAt)}`)),
      el('div', { class: 'contact' },
        el('a', { class: 'btn btn-wa', href: wa(l.phone, greeting), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        l.phone ? el('a', { class: 'btn btn-ghost', href: `tel:${l.phone}` }, 'Call') : null,
        l.email ? el('a', { class: 'btn btn-ghost', href: `mailto:${l.email}` }, 'Email') : null,
        map ? el('a', { class: 'btn btn-ghost', href: map, target: '_blank', rel: 'noopener' }, 'Map') : null),
      box('Stage', stages),
      whenBox,
      biz.project ? quotesBox : null,
      payBox,
      detailsBox,
      photosBox,
      biz.project ? null : quotesBox,
      box('Your notes', note, noteStatus),
      hist.length ? box('History', el('div', { class: 'history' }, ...hist.map((h) => el('div', {}, el('time', {}, fmt(h.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })), el('span', {}, h.text))))) : null,
      el('div', { class: 'row-actions', style: 'margin-top:14px' }, el('button', { class: 'btn btn-danger btn-sm', type: 'button', on: { click: async () => {
        if (!confirm(`Delete ${l.name} and everything with them, including quotes and photos? This cannot be undone.`)) return;
        try { await api('DELETE', `leads/${l.id}`); await loadAll(); location.hash = '#leads'; toast('Lead deleted.'); } catch (err) { oops(err); }
      } } }, 'Delete lead')));
  }

  // ---------- quotes ----------
  function drawQuotes() {
    $('view-quotes').hidden = false;
    const m0 = monthStart();
    const open = quotes.filter((q) => q.state === 'sent');
    const accepted = quotes.filter((q) => q.state === 'accepted');
    const decided = quotes.filter((q) => ['accepted', 'declined', 'expired'].includes(q.state)).length;
    const tile = (label, value, sub) => el('div', { class: 'kpi' }, el('small', {}, label), el('b', {}, value), sub ? el('span', {}, sub) : null);
    fill($('quoteStats'), 
      tile('Waiting', aed(open.reduce((n, q) => n + q.totals.total, 0)), `${open.length} quote${open.length === 1 ? '' : 's'} out`),
      tile('Accepted this month', aed(accepted.filter((q) => q.acceptedAt >= m0).reduce((n, q) => n + q.totals.total, 0))),
      tile('Win rate', decided ? `${Math.round((accepted.length / decided) * 100)}%` : '–', decided ? `${accepted.length} of ${decided} decided` : 'after your first answers'),
      tile('Drafts', String(quotes.filter((q) => q.state === 'draft').length)));
    const count = (s) => quotes.filter((q) => q.state === s).length;
    fill($('quoteFilters'), ...[['all', 'All', quotes.length], ...Object.entries(QSTATE).map(([k, v]) => [k, v, count(k)])].map(([key, label, n]) => el('button', {
      class: 'chip-btn', type: 'button', 'aria-pressed': String(quoteFilter === key), on: { click: () => { quoteFilter = key; drawQuotes(); } },
    }, label, el('b', {}, String(n)))));
    const shown = quotes.filter((q) => quoteFilter === 'all' || q.state === quoteFilter);
    fill($('quoteList'), ...(shown.length ? shown.map((q) => {
      const l = leadById(q.leadId);
      return el('button', { class: 'row', type: 'button', on: { click: () => { location.hash = `#quote/${q.id}`; } } },
        el('b', {}, `${l ? l.name : 'Client'} · ${q.title}`), el('span', { class: 'amount' }, aed(q.totals.total)),
        el('span', { class: 'meta' }, `${q.number} · ${q.state === 'accepted' ? `accepted ${dateOf(q.acceptedAt)}` : q.sentAt ? `sent ${dateOf(q.sentAt)}` : `made ${dateOf(q.createdAt)}`}`), el('span'),
        el('span', { class: 'tags' }, el('span', { class: `badge ${q.state}` }, QSTATE[q.state]), q.state === 'sent' ? el('span', { class: 'badge src' }, q.viewedAt ? 'Opened' : 'Not opened yet') : null));
    }) : [el('div', { class: 'empty' }, el('b', {}, quotes.length ? 'No quotes here.' : 'No quotes yet.'), quotes.length ? 'Try another filter.' : 'Open a lead and press New quote. Quotes you send are chased for you on day 2, 5 and 10.')]));
  }

  // the quote editor works on a copy, saved only when the owner says so
  const blankItem = () => ({ desc: '', qty: 1, price: 0 });
  const grow = (t) => { t.style.height = 'auto'; t.style.height = `${Math.max(48, t.scrollHeight + 3)}px`; };
  const totalsOf = (s) => {
    const subtotal = money(s.items.filter((it) => it.desc.trim() && Number(it.qty) > 0).reduce((n, it) => n + money(it.qty) * money(it.price), 0));
    const discount = Math.min(subtotal, Math.max(0, money(s.discount)));
    const taxable = money(subtotal - discount);
    const vat = biz.vatRegistered && s.vat ? money(taxable * 0.05) : 0;
    return { subtotal, discount, vat, total: money(taxable + vat) };
  };
  const quoteBody = (s, withValid) => ({
    title: s.title, items: s.items.filter((it) => it.desc.trim()).map((it) => ({ desc: it.desc, qty: money(it.qty), price: money(it.price) })),
    discount: money(s.discount), vat: !!s.vat, notes: s.notes, terms: s.terms,
    ...(withValid || (s.validChanged && s.validDays) ? { validDays: Number(s.validDays) || biz.quoteValidDays || 14 } : {}),
  });
  async function saveQuote(send) {
    const s = qState;
    if (send && !s.items.some((it) => it.desc.trim() && Number(it.qty) > 0)) throw new Error('Add at least one line with a description before sending.');
    let q;
    if (!s.id) {
      q = (await api('POST', 'quotes', { leadId: s.leadId, ...quoteBody(s, true) })).quote;
      s.id = q.id;
      if (send) q = (await api('PATCH', `quotes/${q.id}`, { send: true })).quote;
    } else {
      const editable = s.state !== 'accepted';
      q = (await api('PATCH', `quotes/${s.id}`, { ...(editable ? quoteBody(s, send && ['expired', 'declined'].includes(s.state)) : {}), ...(send ? { send: true } : {}) })).quote;
    }
    quotes = [q, ...quotes.filter((x) => x.id !== q.id)];
    s.dirty = false; s.validChanged = false; s.state = q.state;
    history.replaceState(null, '', `#quote/${q.id}`);
    current = { name: 'quote', arg: q.id }; prevHash = location.hash;
    const t = await api('GET', 'today').catch(() => null); if (t) { tasks = t.tasks; drawCounts(); }
    const l = await api('GET', 'leads').catch(() => null); if (l) leads = l.leads;
    return q;
  }
  const quoteMessage = (q, l) => `Hi ${first(l?.name)}, here is your quote from ${biz.name}${q.title ? ` for ${lower(q.title)}` : ''}: ${aed(q.totals.total)}${q.totals.vat ? ' including VAT' : ''}.\n\nYou can see the details and accept it here:\n${q.link}\n\nAny questions, just reply to this message.`;

  function drawQuoteEditor(kind, arg) {
    $('view-quote').hidden = false;
    let existing = null;
    if (kind === 'quote') {
      existing = quotes.find((q) => q.id === arg);
      if (!existing) { back('/app#quotes'); $('viewTitle').textContent = 'Quote'; fill($('view-quote'), el('div', { class: 'empty' }, el('b', {}, 'This quote was not found.'))); return; }
    }
    const leadId = existing ? existing.leadId : arg;
    const l = leadById(leadId);
    if (!l && !existing) { back('/app#quotes'); $('viewTitle').textContent = 'Quote'; fill($('view-quote'), el('div', { class: 'empty' }, el('b', {}, 'This lead was not found.'))); return; }
    if (!qState || (existing && qState.id !== existing.id) || (!existing && (qState.id || qState.leadId !== leadId))) {
      qState = existing ? {
        id: existing.id, leadId, state: existing.state, title: existing.title, items: existing.items.map((it) => ({ ...it })), discount: existing.discount || 0,
        vat: !!existing.vat, notes: existing.notes || '', terms: existing.terms || '', validDays: existing.state === 'sent' ? '' : (biz.quoteValidDays || 14), validChanged: false, dirty: false,
      } : {
        id: null, leadId, state: 'draft', title: l.service || '', vat: !!biz.vatRegistered, discount: 0, notes: '', terms: biz.quoteTerms || '',
        validDays: biz.quoteValidDays || 14, validChanged: false, dirty: false,
        items: l.price ? [{ desc: l.service, qty: 1, price: l.price }] : [blankItem()],
      };
    }
    const s = qState, q = existing, ro = s.state === 'accepted';
    back(l ? `/app#lead/${l.id}` : '/app#quotes');
    $('viewTitle').textContent = q ? `${q.number}${l ? ` · ${l.name}` : ''}` : `New quote${l ? ` · ${l.name}` : ''}`;
    const dirty = () => { s.dirty = true; drawTotals(); };

    // state line
    const stateLine = q ? el('div', { class: `q-state ${q.state}` }, {
      draft: 'Draft. Only you can see it until you send it.',
      sent: `Sent ${dateOf(q.sentAt)}. ${q.viewedAt ? `Opened by the client ${ago(q.viewedAt)}.` : 'Not opened yet.'} Valid until ${dateOf(q.validUntil, true)}.`,
      accepted: `Accepted by ${q.acceptedBy} on ${dateOf(q.acceptedAt, true)}. The lead is now Won.`,
      declined: `Declined ${q.declinedAt ? dateOf(q.declinedAt) : ''}${q.declineReason ? `: “${q.declineReason}”` : '.'} You can change it and send it again.`,
      expired: `Expired on ${dateOf(q.validUntil, true)}. Choose how long it is valid for and send it again.`,
    }[q.state]) : null;

    // lines
    const items = el('div', { class: 'items' });
    const drawItems = () => {
      fill(items, el('div', { class: 'item-head', 'aria-hidden': 'true' }, el('span', {}, 'Description'), el('span', {}, 'Qty'), el('span', {}, 'Unit AED'), el('span')),
        ...s.items.map((it, i) => {
          const lt = el('span', { class: 'line-total' }, aed(money(it.qty) * money(it.price)));
          return el('div', { class: 'item' },
            el('textarea', { value: it.desc, rows: 1, disabled: ro, placeholder: 'e.g. Supply and fit kitchen cabinets', 'aria-label': `Line ${i + 1} description`, on: { input: (e) => { it.desc = e.target.value; grow(e.target); dirty(); } } }),
            el('input', { type: 'number', min: 0, step: 'any', inputMode: 'decimal', value: it.qty, disabled: ro, placeholder: 'Qty', 'aria-label': `Line ${i + 1} quantity`, on: { input: (e) => { it.qty = e.target.value; lt.textContent = aed(money(it.qty) * money(it.price)); dirty(); } } }),
            el('input', { type: 'number', min: 0, step: 'any', inputMode: 'decimal', value: it.price, disabled: ro, placeholder: 'Unit price', 'aria-label': `Line ${i + 1} unit price`, on: { input: (e) => { it.price = e.target.value; lt.textContent = aed(money(it.qty) * money(it.price)); dirty(); } } }),
            ro ? el('span') : el('button', { class: 'x', type: 'button', 'aria-label': `Remove line ${i + 1}`, on: { click: () => { s.items.splice(i, 1); if (!s.items.length) s.items.push(blankItem()); drawItems(); dirty(); } } }, '×'),
            lt);
        }));
    };
    drawItems();
    requestAnimationFrame(() => items.querySelectorAll('textarea').forEach(grow));
    const fromServices = el('select', { 'aria-label': 'Add one of your services', disabled: ro, on: { change: (e) => {
      const svc = biz.services.find((x) => x.id === e.target.value);
      if (svc) {
        const blank = s.items.findIndex((it) => !it.desc.trim());
        const line = { desc: svc.name, qty: 1, price: svc.price || 0 };
        if (blank >= 0) s.items[blank] = line; else s.items.push(line);
        drawItems(); dirty();
        requestAnimationFrame(() => items.querySelectorAll('textarea').forEach(grow));
      }
      e.target.value = '';
    } } }, el('option', { value: '' }, 'Add one of your services…'), ...biz.services.map((x) => el('option', { value: x.id }, `${x.name}${x.price ? ` · ${aed(x.price)}` : ''}`)));

    // extras
    const title = el('input', { value: s.title, disabled: ro, placeholder: 'Kitchen renovation, villa 12', on: { input: (e) => { s.title = e.target.value; dirty(); } } });
    const discount = el('input', { type: 'number', min: 0, step: 'any', inputMode: 'decimal', value: s.discount || '', placeholder: '0', disabled: ro, on: { input: (e) => { s.discount = e.target.value; dirty(); } } });
    const vat = el('input', { type: 'checkbox', checked: s.vat, disabled: ro, on: { change: (e) => { s.vat = e.target.checked; dirty(); } } });
    const keep = q && q.state === 'sent';
    const valid = el('select', { disabled: ro, on: { change: (e) => { s.validDays = e.target.value; s.validChanged = true; s.dirty = true; } } },
      keep ? el('option', { value: '', selected: !s.validDays }, `Keep until ${dateOf(q.validUntil, true)}`) : null,
      ...[7, 14, 30, 60].map((d) => el('option', { value: d, selected: Number(s.validDays) === d }, keep ? `${d} days from today` : `${d} days`)));
    const notes = el('textarea', { value: s.notes, rows: 3, disabled: ro, placeholder: 'What is included, materials, brands, how long the work takes.', on: { input: (e) => { s.notes = e.target.value; dirty(); } } });
    const terms = el('textarea', { value: s.terms, rows: 3, disabled: ro, on: { input: (e) => { s.terms = e.target.value; dirty(); } } });

    // totals
    const totals = el('div', { class: 'totals', 'aria-live': 'polite' });
    function drawTotals() {
      const t = totalsOf(s);
      fill(totals, 
        el('div', {}, el('span', {}, 'Subtotal'), el('span', {}, aed(t.subtotal))),
        t.discount ? el('div', {}, el('span', {}, 'Discount'), el('span', {}, `− ${aed(t.discount)}`)) : null,
        biz.vatRegistered && s.vat ? el('div', {}, el('span', {}, 'VAT 5%'), el('span', {}, aed(t.vat))) : null,
        el('div', { class: 'grand' }, el('span', {}, 'Total'), el('span', {}, aed(t.total))));
    }
    drawTotals();

    // actions
    const linkBox = el('input', { readOnly: true, hidden: true, 'aria-label': 'Quote link' });
    const busy = (btn, on) => { btn.disabled = on; };
    const saveBtn = el('button', { class: 'btn btn-ghost', type: 'button', on: { click: async () => {
      busy(saveBtn, true);
      try { await saveQuote(false); render(); toast(s.state === 'draft' ? 'Draft saved.' : 'Changes saved. The client sees them on the same link.'); } catch (err) { oops(err); }
      busy(saveBtn, false);
    } } }, s.state === 'draft' ? 'Save draft' : 'Save changes');
    const sendBtn = el('button', { class: 'btn btn-wa', type: 'button', on: { click: async () => {
      busy(sendBtn, true);
      try {
        const saved = await saveQuote(true);
        openOut(wa(l?.phone, quoteMessage(saved, l)));
        render();
        toast('Quote sent. Elheen will remind you to follow up.');
      } catch (err) { oops(err); busy(sendBtn, false); }
    } } }, s.state === 'draft' ? 'Send on WhatsApp' : s.state === 'sent' ? 'Send again on WhatsApp' : 'Send updated quote');
    const copyBtn = el('button', { class: 'btn btn-ghost', type: 'button', on: { click: async () => {
      busy(copyBtn, true);
      try {
        const saved = s.state === 'accepted' ? q : await saveQuote(s.state === 'draft' || s.dirty || ['expired', 'declined'].includes(s.state));
        const ok = await copy(saved.link, linkBox);
        render();
        toast(ok ? 'Link copied. Paste it anywhere: email, Instagram or SMS.' : 'Copy the link below.');
      } catch (err) { oops(err); busy(copyBtn, false); }
    } } }, s.state === 'draft' ? 'Copy link and mark sent' : 'Copy link');
    const viewBtn = q && q.state !== 'draft' ? el('a', { class: 'btn btn-ghost', href: `/q/${q.publicKey}`, target: '_blank', rel: 'noopener' }, 'Client view') : null;
    const delBtn = q && q.state !== 'accepted' ? el('button', { class: 'btn btn-danger', type: 'button', on: { click: async () => {
      if (!confirm(`Delete quote ${q.number}?${q.state === 'sent' ? ' The client will no longer be able to open it.' : ''}`)) return;
      try { await api('DELETE', `quotes/${q.id}`); quotes = quotes.filter((x) => x.id !== q.id); s.dirty = false; location.hash = l ? `#lead/${l.id}` : '#quotes'; toast('Quote deleted.'); } catch (err) { oops(err); }
    } } }, 'Delete') : null;

    fill($('view-quote'), 
      stateLine,
      el('div', { class: 'box' },
        el('label', {}, 'What the quote is for', title),
        el('h3', {}, 'Lines'), items,
        ro ? null : el('div', { class: 'row-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { s.items.push(blankItem()); drawItems(); dirty(); items.querySelector('.item:last-of-type textarea')?.focus(); } } }, 'Add a line'),
          biz.services.length ? fromServices : null)),
      el('div', { class: 'box' },
        el('div', { class: 'grid-2' },
          el('label', {}, 'Discount (AED)', discount),
          el('label', {}, 'Valid for', valid)),
        biz.vatRegistered ? el('label', { class: 'check' }, vat, 'Add 5% VAT') : el('p', { class: 'muted small' }, 'VAT is off. If you are VAT registered, switch it on in Set-up.'),
        el('label', {}, el('span', {}, 'Notes for the client ', el('span', { class: 'optional' }, 'optional')), notes),
        el('label', {}, 'Terms', terms)),
      totals,
      el('div', { class: 'sticky-acts' }, ro ? null : sendBtn, ro ? null : saveBtn, copyBtn, viewBtn, delBtn),
      linkBox);
    if (ro) linkBox.after(el('p', { class: 'muted small', style: 'margin-top:12px' }, 'An accepted quote cannot be changed. Make a new quote for extra work.'));
  }

  // ---------- calendar ----------
  function drawCalendar() {
    $('view-calendar').hidden = false;
    const team = biz.team || [];
    const d0 = dayStart();
    const all = leads.filter((l) => l.when && !['lost'].includes(l.status) && Date.parse(l.when) >= d0).sort((a, b) => a.when.localeCompare(b.when));
    $('calFilters').hidden = !team.length;
    if (team.length) {
      fill($('calFilters'), ...[['all', 'Everyone'], ...team.map((t) => [t, t]), ['', 'Not given to anyone']].map(([key, label]) => el('button', {
        class: 'chip-btn', type: 'button', 'aria-pressed': String(calFilter === key), on: { click: () => { calFilter = key; drawCalendar(); } },
      }, label, el('b', {}, String(key === 'all' ? all.length : all.filter((l) => (l.assignee || '') === key).length)))));
    }
    const shown = all.filter((l) => calFilter === 'all' || (l.assignee || '') === calFilter);
    if (!shown.length) {
      fill($('agenda'), el('div', { class: 'empty' }, el('b', {}, 'Nothing booked ahead.'), `Booked ${visitWord()}s show here by day. Clients pick a time on your enquiry link, or you set one on a lead.`));
      return;
    }
    const out = []; let day = '';
    for (const l of shown) {
      const t = Date.parse(l.when);
      const label = fmt(t, { weekday: 'long', day: 'numeric', month: 'long' });
      if (label !== day) {
        day = label;
        const rel = t < d0 + DAY ? 'Today' : t < d0 + 2 * DAY ? 'Tomorrow' : '';
        out.push(el('h2', { class: 'day-head' }, rel ? el('em', {}, `${rel} · `) : null, label));
      }
      out.push(el('button', { class: 'agenda-item', type: 'button', on: { click: () => { location.hash = `#lead/${l.id}`; } } },
        el('time', {}, timeOf(t)),
        el('div', {}, el('b', {}, l.name), el('span', {}, [l.service, biz.project ? l.address : null].filter(Boolean).join(' · ') || (biz.project ? 'Site visit' : 'Appointment')),
          el('span', {}, [stageWords()[l.status], l.assignee].filter(Boolean).join(' · ')))));
    }
    fill($('agenda'), ...out);
  }

  // ---------- set-up ----------
  function drawSetup() {
    $('view-setup').hidden = false;
    document.querySelectorAll('#view-setup .unlocked').forEach((n) => { n.hidden = locked; });
    drawPlan();
    if (locked) return;
    $('shareLink').value = `${location.origin}/b/${biz.slug}`;
    $('openLink').href = `/b/${biz.slug}`;
    $('sName').value = biz.name; $('sArea').value = biz.area || ''; $('sPhone').value = biz.phone || '';
    $('sVat').checked = !!biz.vatRegistered; $('sTrn').value = biz.trn || ''; $('trnRow').hidden = !biz.vatRegistered;
    $('sValid').value = String([7, 14, 30, 60].includes(biz.quoteValidDays) ? biz.quoteValidDays : 14);
    $('sTerms').value = biz.quoteTerms || '';
    fill($('teamList'), ...(biz.team || []).map(teamRow));
    fill($('svcList'), ...biz.services.map(svcRow));
    $('askPhotos').checked = !!biz.askPhotos; $('askAddress').checked = !!biz.askAddress;
    for (const id of ['openHour', 'closeHour']) {
      $(id).replaceChildren(...Array.from({ length: 25 }, (_, h) => el('option', { value: h }, h === 24 ? 'Midnight' : `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`)));
      $(id).value = String(biz[id]);
    }
    fill($('closedDays'), ...DAYS.map((d, i) => el('button', {
      class: 'chip-btn', type: 'button', 'aria-pressed': String((biz.closedDays || []).includes(i)), 'data-day': i,
      on: { click: (e) => e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')) },
    }, d)));
    drawAlerts(); drawMeta();
    const target = { details: 'detailsForm', services: 'servicesForm', alerts: 'alertBox', link: 'linkBox' }[current.arg];
    if (target) setTimeout(() => { $(target).scrollIntoView({ behavior: 'smooth', block: 'start' }); $(target).classList.add('flash'); setTimeout(() => $(target).classList.remove('flash'), 1600); }, 60);
  }
  const teamRow = (name = '') => {
    const row = el('div', { class: 'team-row' }, el('input', { value: name, placeholder: 'Name', 'aria-label': 'Team member name' }));
    row.append(el('button', { type: 'button', 'aria-label': 'Remove person', on: { click: () => row.remove() } }, '×'));
    return row;
  };
  const svcRow = (sv = {}) => {
    const row = el('div', { class: 'svc-row', 'data-id': sv.id || '' },
      el('input', { value: sv.name || '', placeholder: 'Service name', 'aria-label': 'Service name' }),
      el('input', { type: 'number', min: 5, step: 5, value: sv.minutes ?? 60, 'aria-label': 'Minutes' }),
      el('input', { type: 'number', min: 0, step: 'any', value: sv.price ?? 0, 'aria-label': 'Price in AED' }));
    row.append(el('button', { type: 'button', 'aria-label': 'Remove service', on: { click: () => row.remove() } }, '×'));
    return row;
  };
  $('addTeam').addEventListener('click', () => { const r = teamRow(); $('teamList').append(r); r.querySelector('input').focus(); });
  $('addSvc').addEventListener('click', () => { const r = svcRow({ minutes: 60, price: 0 }); $('svcList').append(r); r.querySelector('input').focus(); });
  $('sVat').addEventListener('change', () => { $('trnRow').hidden = !$('sVat').checked; });
  $('copyLink').addEventListener('click', async () => {
    $('copyStatus').textContent = (await copy($('shareLink').value, $('shareLink'))) ? 'Copied. Paste it in your Instagram bio and WhatsApp profile.' : 'Press and hold the link to copy it.';
    if (!biz.linkShared) api('PUT', 'me', { linkShared: true }).then((r) => { biz = r.business; }).catch(() => {});
  });
  const saveMe = async (body, errId, statusId) => {
    say(errId, ''); $(statusId).textContent = '';
    try { biz = (await api('PUT', 'me', body)).business; fillLists(); $(statusId).textContent = 'Saved.'; $('sideBiz').textContent = biz.name; } catch (err) { if (!err.locked) say(errId, err.message); }
  };
  $('detailsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveMe({
      name: $('sName').value, area: $('sArea').value, phone: $('sPhone').value, vatRegistered: $('sVat').checked, trn: $('sTrn').value,
      quoteValidDays: $('sValid').value, quoteTerms: $('sTerms').value, team: [...$('teamList').querySelectorAll('input')].map((i) => i.value),
    }, 'detailsError', 'detailsStatus');
  });
  $('servicesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const services = [...$('svcList').children].map((r) => { const [n, m, p] = r.querySelectorAll('input'); return { id: r.dataset.id, name: n.value, minutes: m.value, price: p.value }; });
    saveMe({
      services, askPhotos: $('askPhotos').checked, askAddress: $('askAddress').checked, openHour: $('openHour').value, closeHour: $('closeHour').value,
      closedDays: [...$('closedDays').children].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.day)),
    }, 'servicesError', 'servicesStatus');
  });
  function fillLists() { fill($('serviceList'), ...biz.services.map((s) => el('option', { value: s.name }))); }

  // the business's own Elheen plan
  function drawPlan() {
    const b = biz.billing;
    const until = dateOf(b.paidUntil, true);
    const words = { trial: 'Free trial', active: 'Paid', due: 'Payment due', overdue: 'Ended', included: 'Included' };
    $('planBadge').className = `badge ${b.state}`; $('planBadge').textContent = words[b.state];
    $('planText').textContent = {
      trial: `Everything is included. Your free trial runs until ${until}. After that it is AED ${b.plans.month.price} a month, or AED ${b.plans.year.price} for a year.`,
      active: `Everything is included. Paid until ${until}.`,
      due: `Your payment was due on ${until}. Pay within 7 days of that date to keep your leads open.`,
      overdue: `Your plan ended on ${until}. Your enquiry page still takes enquiries. Pay to open your leads again.`,
      included: 'Your plan is included in your service with us. Nothing to pay.',
    }[b.state];
    const canPay = b.state !== 'included' && b.online;
    $('planPick').hidden = !canPay; $('planPay').hidden = !canPay;
    const opts = { month: ['Monthly', `AED ${b.plans.month.price} for 1 month`], year: ['Yearly', `AED ${b.plans.year.price} for 12 months · 2 months free`] };
    fill($('planPick'), ...Object.entries(opts).map(([key, [name, sub]]) => el('button', {
      class: 'plan-opt', type: 'button', role: 'radio', 'aria-checked': String(chosenOption === key), on: { click: () => { chosenOption = key; drawPlan(); } },
    }, el('b', {}, name), el('span', {}, sub))));
    $('planPay').textContent = `Pay AED ${b.plans[chosenOption].price} by card`;
    if (b.state !== 'included' && !b.online && !$('planStatus').dataset.keep) $('planStatus').textContent = 'Card payment opens soon. To pay now by bank transfer, message us on Instagram and we will add it to your account.';
    const hist = (biz.payments || []).slice(0, 6);
    fill($('planHistory'), ...(hist.length ? [el('h3', {}, 'Payments'),
      ...hist.map((p) => el('div', { class: 'pay-row' }, el('span', {}, dateOf(p.at, true)), el('span', {}, `${p.months} month${p.months > 1 ? 's' : ''}`), el('b', {}, p.amount ? aed(p.amount) : 'Added by us')))] : []));
  }
  $('planPay').addEventListener('click', async () => {
    $('planPay').disabled = true; $('planStatus').textContent = 'Opening the secure payment page…';
    try { location.href = (await api('POST', 'billing/pay', { option: chosenOption })).url; }
    catch (err) { $('planStatus').textContent = err.message; $('planPay').disabled = false; }
  });

  // phone alerts
  const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  function drawAlerts() {
    const can = 'serviceWorker' in navigator && 'PushManager' in window && biz.pushKey;
    $('alertBtn').hidden = !can;
    if (!biz.pushKey) $('alertHint').textContent = 'Phone alerts are being switched on and will be ready shortly.';
    else if (!can) $('alertHint').textContent = 'On an iPhone, first add Elheen to your home screen: tap Share, then Add to Home Screen. Open it from there and come back to this page.';
    $('alertStatus').textContent = biz.alerts ? `Alerts are on for ${biz.alerts} device${biz.alerts > 1 ? 's' : ''}.` : '';
  }
  $('alertBtn').addEventListener('click', async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') { $('alertStatus').textContent = 'Alerts are blocked for this site. Allow notifications in your browser settings and try again.'; return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(biz.pushKey) });
      biz = (await api('POST', 'push', { subscription: sub.toJSON() })).business;
      drawAlerts();
    } catch { $('alertStatus').textContent = 'Alerts could not be turned on here. Try again in Chrome or Safari.'; }
  });

  // Facebook lead ads, shown only once the connection is set up
  function drawMeta() {
    const m = biz.meta, on = !!(m && m.pages.length);
    $('metaPanel').hidden = !biz.metaAvailable && !on;
    $('metaConnect').hidden = !biz.metaAvailable || on;
    $('metaSync').hidden = !on; $('metaOff').hidden = !on; $('metaPages').hidden = !on;
    if (!on) $('metaHint').textContent = 'Connect the Facebook page your ads run from. Every lead from your Facebook and Instagram lead forms lands in Leads on its own.';
    else {
      $('metaHint').textContent = 'Leads from your Facebook and Instagram lead forms arrive in Leads on their own.';
      $('metaPages').textContent = `Connected: ${m.pages.map((p) => p.name).join(', ')}`;
      if (!$('metaStatus').dataset.keep) $('metaStatus').textContent = m.error ? `The last check did not work: ${m.error}` : (m.lastSync ? `Last checked ${timeOf(m.lastSync)}.` : 'Checking for the first time…');
    }
  }
  $('metaConnect').addEventListener('click', async () => {
    try { $('metaConnect').disabled = true; location.href = (await api('POST', 'meta/start')).url; }
    catch (err) { $('metaStatus').textContent = err.message; $('metaConnect').disabled = false; }
  });
  $('metaSync').addEventListener('click', async () => {
    $('metaStatus').textContent = 'Checking…'; delete $('metaStatus').dataset.keep;
    try {
      const r = await api('POST', 'meta/sync', { force: true });
      if (r.business) biz = r.business;
      drawMeta();
      if (!biz.meta?.error) $('metaStatus').textContent = r.added ? `${r.added} new lead${r.added > 1 ? 's' : ''} added.` : 'No new leads.';
      if (r.added) await loadAll();
    } catch (err) { $('metaStatus').textContent = err.message; }
  });
  $('metaOff').addEventListener('click', async () => {
    if (!confirm('Stop bringing in leads from Facebook? Leads already in Elheen stay.')) return;
    try { biz = (await api('POST', 'meta/disconnect')).business; $('metaStatus').textContent = 'Disconnected.'; drawMeta(); }
    catch (err) { $('metaStatus').textContent = err.message; }
  });

  // all leads as a spreadsheet, made on the phone itself
  $('exportBtn').addEventListener('click', () => {
    const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Name', 'Phone', 'Email', 'Stage', 'Came from', 'Wants', 'Address', 'Budget', 'Visit or appointment', 'Team member', 'Job value (AED)', 'Paid (AED)', 'Quotes', 'Received', 'Message', 'Your notes'];
    const rows = leads.map((l) => {
      const paid = (l.milestones || []).filter((m) => m.paidAt).reduce((n, m) => n + m.amount, 0);
      return [l.name, l.phone, l.email, stageWords()[l.status], SOURCES[l.source] || l.source, l.service, l.address, l.budget,
        l.when ? fmt(l.when, { dateStyle: 'medium', timeStyle: 'short' }) : '', l.assignee, l.value || '', paid || '',
        quotes.filter((q) => q.leadId === l.id).map((q) => `${q.number} ${QSTATE[q.state]} ${q.totals.total}`).join('; '),
        fmt(l.createdAt, { dateStyle: 'medium' }), l.note, l.ownerNote];
    });
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `elheen-leads-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  $('passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', 'password', { current: $('passCurrent').value, next: $('passNext').value }); e.target.reset(); $('passStatus').textContent = 'Password changed.'; }
    catch (err) { $('passStatus').textContent = err.message; }
  });

  // ---------- start ----------
  async function returnFromPayment(pid) {
    location.hash = '#setup';
    $('planStatus').dataset.keep = '1';
    if (pid === 'cancelled') { $('planStatus').textContent = 'The payment was not completed. Nothing was charged.'; return; }
    $('planStatus').textContent = 'Confirming your payment…';
    for (let i = 0; i < 6; i++) {
      const r = await api('POST', 'billing/check', { id: pid }).catch(() => null);
      if (r && r.status === 'paid') {
        biz = (await api('GET', 'me')).business;
        await loadAll(); render();
        $('planStatus').textContent = `Payment received. Thank you. Paid until ${dateOf(biz.billing.paidUntil, true)}.`;
        return;
      }
      if (r && r.status === 'failed') { $('planStatus').textContent = 'The payment did not go through. Nothing was charged.'; return; }
      await new Promise((res) => setTimeout(res, 2000));
    }
    $('planStatus').textContent = 'We are still confirming your payment. Refresh this page in a minute.';
  }
  async function start() {
    const params = new URLSearchParams(location.search);
    biz = (await api('GET', 'me')).business;
    fillLists();
    $('authView').hidden = true; $('appView').hidden = false;
    await loadAll();
    current = parse(); prevHash = location.hash || '#today';
    render();
    if (params.get('billing') || params.get('meta')) history.replaceState(null, '', `/app${location.hash}`);
    if (params.get('billing')) await returnFromPayment(params.get('billing'));
    const result = params.get('meta');
    if (result) {
      location.hash = '#setup';
      $('metaStatus').dataset.keep = '1';
      $('metaStatus').textContent = {
        connected: 'Facebook is connected. Lead-form leads from the last 30 days are coming in now.',
        cancelled: 'The Facebook connection was cancelled. Nothing was changed.',
        nopages: 'No Facebook page was shared. Connect again and tick the page your ads run from.',
        expired: 'That took too long. Please press Connect Facebook again.',
      }[result] || 'The Facebook connection did not work. Please try again.';
      if (result === 'connected') api('POST', 'meta/sync', { force: true }).then(async (r) => { if (r.business) biz = r.business; if (r.added) await loadAll(); render(); }).catch(() => {});
    }
  }
  if (token) start().catch((err) => { signOut(); if (err.message !== 'Please sign in again.') say('loginError', 'Your account could not be loaded. Check your connection and sign in again.'); }); else signOut();

  // Keep lists fresh while the app is open, without touching a form the owner is filling in.
  let syncing = false;
  setInterval(async () => {
    if (!token || !biz || document.visibilityState !== 'visible' || syncing) return;
    if (!['today', 'leads', 'quotes', 'calendar'].includes(current.name)) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (!$('addLeadForm').hidden) return;
    syncing = true;
    try {
      if (biz.meta?.pages?.length) { const r = await api('POST', 'meta/sync').catch(() => null); if (r?.business) biz = r.business; }
      await loadAll();
      if (['today', 'leads', 'quotes', 'calendar'].includes(current.name)) render();
    } catch { /* try again next time */ }
    syncing = false;
  }, 45000);
})();
