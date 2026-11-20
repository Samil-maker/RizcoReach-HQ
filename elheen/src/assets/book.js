// The client's booking page: the business's own look, then four calm steps.
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || params.get('b') || '');
  const preview = params.get('preview') === '1';
  // ad click IDs, so a won job can be reported back to Google Ads or Meta
  const clicks = { gclid: params.get('gclid') || '', fbclid: params.get('fbclid') || '', campaign: params.get('utm_campaign') || '' };
  const source = params.get('src') || (clicks.gclid ? 'google-ads' : '') || (document.referrer.includes('instagram') ? 'instagram' : document.referrer.includes('google') ? 'google' : 'link');
  const state = { serviceId: null, serviceName: '', when: null, location: null, photos: [], budgetBand: null, start: null, property: null };
  const MAX_PHOTOS = 6;
  const DUBAI = 4; // hours ahead of UTC, all year
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ASK = {
    budgets: ['budgetBand', [['u10', 'Under AED 10,000'], ['b10', 'AED 10,000 to 50,000'], ['b50', 'AED 50,000 to 150,000'], ['o150', 'Over AED 150,000'], ['unsure', 'Not sure yet']]],
    starts: ['start', [['now', 'As soon as possible'], ['m3', 'Within 3 months'], ['m6', 'In 3 to 6 months'], ['ideas', 'Just getting ideas']]],
    properties: ['property', [['villa', 'Villa or townhouse'], ['apartment', 'Apartment'], ['office', 'Office or shop'], ['other', 'Something else']]],
  };
  const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const press = (list, on) => list.forEach((b) => { b.setAttribute('aria-pressed', String(b === on)); if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', String(b === on)); });
  const showError = (text) => { $('error').textContent = text; $('error').hidden = !text; if (text && !reduce) { $('error').classList.remove('shake'); void $('error').offsetWidth; $('error').classList.add('shake'); } };
  let biz = null;

  // --- the business's look
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  const ink = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#141414' : '#FFFFFF'; };
  function applyTheme(page) {
    const p = { accent: '#A31A8A', bg: 'light', radius: 'round', font: 'modern', ...page };
    const accent = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#A31A8A';
    const dark = p.bg === 'dark';
    const v = {
      '--bk-accent': accent, '--bk-accent-ink': ink(accent), '--bk-accent-soft': `${accent}1F`, '--bk-accent-deep': mix(accent, '#000000', 0.35),
      '--bk-bg': dark ? '#0E0E11' : p.bg === 'tint' ? mix(accent, '#FFFFFF', 0.92) : '#F5F5F7',
      '--bk-surface': dark ? '#18181D' : '#FFFFFF', '--bk-raise': dark ? '#222228' : '#F4F4F6',
      '--bk-text': dark ? '#F2F2F5' : '#16141A', '--bk-muted': dark ? '#A3A3AE' : '#62626C', '--bk-line': dark ? '#2B2B33' : '#E6E6EB',
      '--bk-r': { round: '22px', soft: '14px', square: '6px' }[p.radius] || '22px', '--bk-rs': { round: '14px', soft: '10px', square: '4px' }[p.radius] || '14px',
      '--bk-head': { modern: 'var(--font)', elegant: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif', rounded: 'ui-rounded,"SF Pro Rounded","Nunito",var(--font)' }[p.font] || 'var(--font)',
    };
    for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val);
    document.documentElement.dataset.bkFont = p.font;
    document.body.classList.toggle('bk-dark', dark);
    const mark = document.querySelector('.bk-powered img');
    if (mark) mark.src = dark ? 'assets/logo-on-dark.svg' : 'assets/logo.svg';
    let tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.content = dark ? '#0E0E11' : accent;
    // header: cover photo, or the brand colour
    const cover = $('cover');
    cover.style.backgroundImage = p.cover ? `linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,.35)), url("/api/public/${encodeURIComponent(slug)}/cover?v=${p.cover}")`
      : `radial-gradient(120% 140% at 0% 0%, ${mix(accent, '#FFFFFF', 0.25)} 0%, ${accent} 45%, ${mix(accent, '#000000', 0.45)} 100%)`;
    const logo = $('logo');
    logo.querySelector('img')?.remove();
    if (p.logo) { const img = make('img'); img.src = `/api/public/${encodeURIComponent(slug)}/logo?v=${p.logo}`; img.alt = ''; logo.append(img); }
    logo.classList.toggle('has-img', !!p.logo);
    $('tagline').textContent = p.tagline || ''; $('tagline').hidden = !p.tagline;
    $('about').textContent = p.about || ''; $('about').hidden = !p.about;
    // links: WhatsApp, Instagram, website
    const links = [];
    const link = (href, label, icon) => { const a = make('a', 'bk-chip'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.innerHTML = icon; a.append(label); links.push(a); };
    const waNum = String(biz?.phone || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '971');
    if (waNum) link(`https://wa.me/${waNum}`, 'WhatsApp', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.800 13.500L3 21l4.600-1.200A9 9 0 1 0 12 3z"/></svg>');
    if (p.instagram) link(`https://instagram.com/${p.instagram}`, `@${p.instagram}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.500" y="3.500" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.300" cy="6.700" r=".600"/></svg>');
    if (p.website) { let host = p.website; try { host = new URL(p.website).hostname.replace(/^www\./, ''); } catch { /* keep */ } link(p.website, host, '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.500 3 14.500 0 18M12 3c-3 3.500-3 14.500 0 18"/></svg>'); }
    $('links').replaceChildren(...links);
  }
  // Set-up shows this page in a phone frame and sends every change here as it is made
  if (preview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'elheen-page' || !biz) return;
      applyTheme(e.data.page);
      if (e.data.name) $('bizName').textContent = e.data.name;
    });
  }

  // --- steps
  let steps = [], at = 0;
  function show(i, dir = 1) {
    const all = [...document.querySelectorAll('.bk-step')];
    all.forEach((s) => { s.hidden = !steps.includes(s.dataset.step); s.classList.remove('on', 'from-left', 'from-right'); });
    const cur = document.querySelector(`.bk-step[data-step="${steps[i]}"]`);
    cur.classList.add('on', dir > 0 ? 'from-right' : 'from-left');
    at = i;
    $('progress').style.width = `${((i + 1) / steps.length) * 100}%`;
    $('stepOf').textContent = `Step ${i + 1} of ${steps.length}`;
    $('back').hidden = i === 0;
    const last = i === steps.length - 1;
    $('next').textContent = preview && last ? 'Preview only' : last ? (state.when ? 'Book now' : 'Send my request') : 'Continue';
    $('next').disabled = preview && last;
    if (steps[i] === 'details') drawSummary();
    showError('');
    if (i > 0 || dir < 0) $('form').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  function drawSummary() {
    const rows = [];
    if (state.serviceName) rows.push(['For', state.serviceName]);
    if (state.when) { const t = new Date(state.when); rows.push(['When', `${t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}, ${t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })}`]); }
    if (state.photos.length) rows.push(['Photos', `${state.photos.length} added`]);
    $('summary').replaceChildren(...rows.map(([k, v]) => { const d = make('div'); d.append(make('span', '', k), make('b', '', v)); return d; }));
    $('summary').hidden = !rows.length;
  }
  $('back').addEventListener('click', () => show(Math.max(0, at - 1), -1));

  fetch(`/api/public/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(({ business: b, taken }) => {
    biz = b;
    document.title = `${b.name} | Book`;
    $('initial').textContent = b.name[0].toUpperCase();
    $('bizName').textContent = b.name;
    $('bizArea').textContent = b.area || ''; $('bizArea').hidden = !b.area;
    applyTheme(b.page);

    // step 1: services, plus "something else"
    const price = (s) => (s.price ? `AED ${Number(s.price).toLocaleString('en')}` : 'Free');
    const choices = [...b.services.map((s) => [s.id, s.name, `${s.minutes} min · ${price(s)}`]), [null, 'Something else', 'Tell us in the next step']];
    const svcButtons = choices.map(([id, name, meta]) => {
      const btn = make('button', 'bk-choice'); btn.type = 'button'; btn.setAttribute('role', 'radio'); btn.setAttribute('aria-checked', 'false');
      btn.append(make('span', 'bk-radio'), make('b', '', name), make('small', '', meta));
      btn.addEventListener('click', () => { state.serviceId = id; state.serviceName = name; state.picked = true; press(svcButtons, btn); showError(''); if (!reduce) setTimeout(() => show(at + 1, 1), 260); else show(at + 1, 1); });
      return btn;
    });
    $('services').replaceChildren(...svcButtons);

    // step 2: about the job
    $('addressBlock').hidden = !b.askAddress;
    $('photoBlock').hidden = !b.askPhotos;
    $('qualifyBlock').hidden = !b.askBudget;
    if (b.minJob) { $('minNote').hidden = false; $('minNote').textContent = `Our projects usually start from AED ${Number(b.minJob).toLocaleString('en')}.`; }
    for (const [box, [field, options]] of Object.entries(ASK)) {
      const buttons = options.map(([value, label]) => {
        const btn = make('button', 'bk-pill', label); btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => { state[field] = state[field] === value ? null : value; press(buttons, state[field] ? btn : null); });
        return btn;
      });
      $(box).replaceChildren(...buttons);
    }
    if (b.askAddress) { $('timeTitle').textContent = 'Pick a visit time'; $('aboutTitle').textContent = b.askPhotos ? 'Tell us about the space' : 'Where are we going?'; }

    // step 3: the next 14 open days, in Dubai time
    const takenSet = new Set(taken);
    const now = Date.now();
    const days = [];
    for (let i = 0; days.length < 14 && i < 30; i++) {
      const d = new Date(now + DUBAI * 36e5 + i * 864e5);
      if (!(b.closedDays || []).includes(d.getUTCDay())) days.push(d);
    }
    const showSlots = (d) => {
      const buttons = [];
      for (let h = b.openHour; h < b.closeHour; h++) {
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - DUBAI));
        const btn = make('button', 'bk-slot', `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`); btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
        btn.disabled = t.getTime() < now + 36e5 || takenSet.has(t.toISOString());
        btn.addEventListener('click', () => { const off = state.when === t.toISOString(); state.when = off ? null : t.toISOString(); press(buttons, off ? null : btn); });
        buttons.push(btn);
      }
      state.when = null;
      $('slots').replaceChildren(...buttons);
      if (!buttons.some((x) => !x.disabled)) $('slots').replaceChildren(make('p', 'bk-hint', 'Fully booked this day. Try another.'));
    };
    const today = new Date(now + DUBAI * 36e5).getUTCDate();
    const dayButtons = days.map((d, i) => {
      const btn = make('button', 'bk-day'); btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
      btn.append(make('small', '', i === 0 && d.getUTCDate() === today ? 'Today' : d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })), make('b', '', String(d.getUTCDate())), make('span', '', d.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })));
      btn.addEventListener('click', () => { press(dayButtons, btn); showSlots(d); });
      return btn;
    });
    $('days').replaceChildren(...dayButtons);
    if (dayButtons[0]) dayButtons[0].click();

    steps = ['service', 'about', 'time', 'details'];
    show(0, 1);
    $('loading').hidden = true; $('page').hidden = false;
    requestAnimationFrame(() => document.body.classList.add('bk-ready'));
  }).catch(() => { $('loading').hidden = true; $('missing').hidden = false; });

  // location: one tap, shared only if the client agrees
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) { $('locStatus').textContent = 'Your phone cannot share a location here. Please type the address.'; return; }
    $('locStatus').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (p) => { state.location = `${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`; $('locStatus').textContent = 'Location added.'; $('locate').textContent = 'Location added ✓'; },
      () => { $('locStatus').textContent = 'We could not get your location. Please type the address.'; },
      { timeout: 10000 }
    );
  });

  // photos: shrunk on the phone before sending, so uploads are quick
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
  const drawPhotos = () => {
    const tiles = state.photos.map((src, i) => {
      const d = make('div', 'bk-ph');
      const img = make('img'); img.src = src; img.alt = `Photo ${i + 1}`;
      const x = make('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', `Remove photo ${i + 1}`);
      x.addEventListener('click', () => { state.photos.splice(i, 1); drawPhotos(); });
      d.append(img, x); return d;
    });
    $('addPhoto').hidden = state.photos.length >= MAX_PHOTOS;
    $('photos').replaceChildren(...tiles, $('addPhoto'));
  };
  $('addPhoto').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', async (e) => {
    for (const file of [...e.target.files].slice(0, MAX_PHOTOS - state.photos.length)) {
      try { state.photos.push(await shrink(file)); } catch { showError('One photo could not be read. Try another.'); }
    }
    e.target.value = ''; drawPhotos();
  });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (steps[at] === 'service' && !state.picked) { showError('Choose what you need, or "Something else".'); return; }
    if (at < steps.length - 1) { show(at + 1, 1); return; }
    if (preview) return;
    const name = $('name').value.trim(), phone = $('phone').value.trim();
    if (!name) { showError('Please add your name.'); $('name').focus(); return; }
    if (phone.replace(/\D/g, '').length < 7) { showError('Please add your WhatsApp number.'); $('phone').focus(); return; }
    $('next').disabled = true; $('next').classList.add('busy'); $('next').textContent = 'Sending';
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/lead`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, note: $('note').value, address: $('address').value, location: state.location, serviceId: state.serviceId, when: state.when, photos: state.photos, budgetBand: state.budgetBand, start: state.start, property: state.property, source, ...clicks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      $('form').hidden = true; $('done').hidden = false;
      if (data.when) {
        const t = new Date(data.when);
        $('doneTitle').textContent = 'You are booked.';
        $('doneText').textContent = `See you ${t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })} at ${t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })}. ${biz.name} will message you on WhatsApp.`;
      } else {
        $('doneTitle').textContent = 'Request sent.';
        $('doneText').textContent = `${biz.name} has your details and will message you on WhatsApp shortly.`;
      }
      const waNum = String(biz.phone || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '971');
      if (waNum) { $('doneWa').hidden = false; $('doneWa').href = `https://wa.me/${waNum}?text=${encodeURIComponent(`Hi ${biz.name}, I just sent a request through your booking page. My name is ${name}.`)}`; }
      $('page').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    } catch (err) {
      showError(err.message);
      $('next').disabled = false; $('next').classList.remove('busy'); $('next').textContent = state.when ? 'Book now' : 'Send my request';
    }
  });
})();
