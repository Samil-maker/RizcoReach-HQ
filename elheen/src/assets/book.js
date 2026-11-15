// The client's enquiry page: choose a service, give details, add photos, pick a time.
(() => {
  const $ = (id) => document.getElementById(id);
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('b') || '');
  const source = new URLSearchParams(location.search).get('src') || (document.referrer.includes('instagram') ? 'instagram' : document.referrer.includes('google') ? 'google' : 'link');
  const state = { serviceId: null, when: null, location: null, photos: [], chat: [] };
  const DUBAI = 4; // hours ahead of UTC, all year

  const showError = (text) => { $('error').textContent = text; $('error').hidden = !text; };
  const press = (list, on) => list.forEach((b) => b.setAttribute('aria-pressed', String(b === on)));

  fetch(`/api/public/${encodeURIComponent(slug)}`).then((r) => r.ok ? r.json() : Promise.reject()).then(({ business: b, taken, chat }) => {
    $('chatBlock').hidden = !chat;
    document.title = `${b.name} | Book`;
    $('initial').textContent = b.name[0].toUpperCase();
    $('bizName').textContent = b.name;
    $('bizArea').textContent = b.area || '';
    $('addressBlock').hidden = !b.askAddress;
    $('photoBlock').hidden = !b.askPhotos;
    if (b.askAddress) $('timeTitle').textContent = 'Pick a visit time';

    const price = (s) => (s.price ? `AED ${s.price}` : 'Free');
    $('services').replaceChildren(...b.services.map((s) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'choice'; btn.setAttribute('aria-pressed', 'false');
      const small = document.createElement('small'); small.textContent = `${s.minutes} min · ${price(s)}`;
      btn.append(s.name, small);
      btn.addEventListener('click', () => { state.serviceId = s.id; press([...$('services').children], btn); });
      return btn;
    }));

    // Next 14 open days, in Dubai time.
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
        const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - DUBAI));
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'slot-btn'; btn.setAttribute('aria-pressed', 'false');
        btn.textContent = `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
        btn.disabled = at.getTime() < now + 36e5 || takenSet.has(at.toISOString());
        btn.addEventListener('click', () => {
          const off = state.when === at.toISOString();
          state.when = off ? null : at.toISOString();
          press(buttons, off ? null : btn);
        });
        buttons.push(btn);
      }
      state.when = null;
      $('slots').replaceChildren(...buttons);
    };
    const dayButtons = days.map((d, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'day'; btn.setAttribute('aria-pressed', 'false');
      const small = document.createElement('small');
      small.textContent = i === 0 && d.getUTCDate() === new Date(now + DUBAI * 36e5).getUTCDate() ? 'Today' : d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' });
      btn.append(small, String(d.getUTCDate()));
      btn.addEventListener('click', () => { press(dayButtons, btn); showSlots(d); });
      return btn;
    });
    $('days').replaceChildren(...dayButtons);
    if (dayButtons[0]) dayButtons[0].click();

    $('loading').hidden = true; $('form').hidden = false;
  }).catch(() => { $('loading').hidden = true; $('missing').hidden = false; });

  // Questions: the assistant answers from the business's own details.
  const addBubble = (role, text) => {
    const d = document.createElement('div'); d.className = `bub ${role === 'assistant' ? 'them' : 'us'}`; d.textContent = text;
    $('thread').append(d); d.scrollIntoView({ block: 'nearest' }); return d;
  };
  const ask = async () => {
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = ''; $('chatSend').disabled = true;
    state.chat.push({ role: 'user', content: text }); addBubble('user', text);
    const waiting = addBubble('assistant', '…');
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: state.chat }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      waiting.textContent = data.reply; state.chat.push({ role: 'assistant', content: data.reply });
    } catch (err) { waiting.textContent = err.message || 'Please send your enquiry below and we will reply.'; }
    $('chatSend').disabled = false; $('chatInput').focus();
  };
  $('chatSend').addEventListener('click', ask);
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });

  // Location: one tap, shared only if the client agrees.
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) { $('locStatus').textContent = 'Your phone cannot share a location here. Please type the address.'; return; }
    $('locStatus').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (p) => { state.location = `${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`; $('locStatus').textContent = 'Location added.'; },
      () => { $('locStatus').textContent = 'We could not get your location. Please type the address.'; },
      { timeout: 10000 }
    );
  });

  // Photos: shrunk on the phone before sending, so uploads are quick.
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
      const d = document.createElement('div'); d.className = 'ph';
      const img = document.createElement('img'); img.src = src; img.alt = `Photo ${i + 1}`;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', `Remove photo ${i + 1}`);
      x.addEventListener('click', () => { state.photos.splice(i, 1); drawPhotos(); });
      d.append(img, x); return d;
    });
    $('addPhoto').hidden = state.photos.length >= 4;
    $('photos').replaceChildren(...tiles, $('addPhoto'));
  };
  $('addPhoto').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', async (e) => {
    for (const file of [...e.target.files].slice(0, 4 - state.photos.length)) {
      try { state.photos.push(await shrink(file)); } catch { showError('One photo could not be read. Try another.'); }
    }
    e.target.value = ''; drawPhotos();
  });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const name = $('name').value.trim(), phone = $('phone').value.trim();
    if (!name) { showError('Please add your name.'); $('name').focus(); return; }
    if (phone.replace(/\D/g, '').length < 7) { showError('Please add your WhatsApp number.'); $('phone').focus(); return; }
    $('send').disabled = true; $('send').textContent = 'Sending…';
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/lead`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, note: $('note').value, address: $('address').value, location: state.location, serviceId: state.serviceId, when: state.when, photos: state.photos, chat: state.chat, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      $('form').hidden = true; $('done').hidden = false;
      if (data.when) {
        const t = new Date(data.when);
        $('doneTitle').textContent = 'Booked.';
        $('doneText').textContent = `See you ${t.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })} at ${t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })}. We will message you on WhatsApp.`;
      } else {
        $('doneText').textContent = 'We have your enquiry and will message you on WhatsApp shortly.';
      }
      scrollTo(0, 0);
    } catch (err) {
      showError(err.message);
      $('send').disabled = false; $('send').textContent = 'Send enquiry';
    }
  });
})();
