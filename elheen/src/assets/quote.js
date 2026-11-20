// The client's quote: read it, accept it with their name, decline it, or ask a question on WhatsApp.
(() => {
  const $ = (id) => document.getElementById(id);
  const key = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('k') || '');
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const aed = (n) => `AED ${money(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n) => money(n).toLocaleString('en', { maximumFractionDigits: 2 });
  const amt = (n) => money(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });
  const td = (text, cls) => { const c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; };
  const line = (label, value, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; const a = document.createElement('span'); a.textContent = label; const b = document.createElement('span'); b.textContent = value; d.append(a, b); return d; };
  const waNumber = (phone) => {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = `971${d.slice(1)}`;
    if (/^5\d{8}$/.test(d)) d = `971${d}`;
    return d;
  };
  let data = null;

  function draw() {
    const { business: b, quote: q, client } = data;
    document.title = `${q.number} from ${b.name}`;
    $('bizName').textContent = b.name;
    $('bizLine').textContent = [b.area, b.trn ? `TRN ${b.trn}` : ''].filter(Boolean).join(' · ');
    $('qNumber').textContent = `${q.variation ? 'Extra work' : 'Quote'} ${q.number}`;
    $('qDate').textContent = q.sentAt ? date(q.sentAt) : '';
    $('qValid').textContent = q.validUntil ? `Valid until ${date(q.validUntil)}` : '';
    $('client').textContent = client || 'You';
    $('qTitle').textContent = q.title || '';
    $('lines').replaceChildren(...q.items.map((it) => {
      const tr = document.createElement('tr');
      tr.append(td(it.desc, 'desc'), td(`${num(it.qty)}${it.unit ? ` ${it.unit}` : ''}`, 'num'), td(amt(it.price), 'num unit'), td(amt(it.qty * it.price), 'num'));
      return tr;
    }));
    const t = q.totals;
    $('totals').replaceChildren(
      line('Subtotal', aed(t.subtotal)),
      ...(t.discount ? [line('Discount', `− ${aed(t.discount)}`)] : []),
      ...(q.vat ? [line('VAT 5%', aed(t.vat))] : []),
      line(q.vat ? 'Total incl. VAT' : 'Total', aed(t.total), 'grand'));
    const notes = [['Notes', q.notes], ['Terms', q.terms]].filter(([, v]) => v);
    $('notes').replaceChildren(...notes.map(([h, v]) => {
      const d = document.createElement('div'); const hh = document.createElement('h3'); hh.textContent = h; const p = document.createElement('p'); p.textContent = v;
      d.append(hh, p); return d;
    }));

    const open = q.state === 'sent';
    $('acceptForm').hidden = !open; $('declineShow').hidden = !open; $('declineForm').hidden = true;
    $('acceptNote').textContent = !open ? '' : q.variation
      ? `By approving, you agree to this extra work and its price before it starts. It is added to your existing job with ${b.name}.`
      : `By accepting, you agree to the price and terms above. ${b.name} will be told straight away.`;
    $('acceptTitle').textContent = q.variation ? 'Approve this extra work?' : 'Happy with this quote?';
    $('acceptBtn').textContent = q.variation ? 'Approve extra work' : 'Accept quote';
    const msg = {
      accepted: `${q.variation ? 'Approved' : 'Accepted'} by ${q.acceptedBy} on ${date(q.acceptedAt)}. ${b.name} has been told and will be in touch about the next steps.`,
      declined: `You declined this quote. If you change your mind, message ${b.name} for an updated one.`,
      expired: `This quote expired on ${date(q.validUntil)}. Message ${b.name} for an updated one.`,
    }[q.state];
    $('status').hidden = !msg; $('status').textContent = msg || ''; $('status').className = `doc-status ${q.state}`;
    if (b.phone) {
      $('askBtn').hidden = false;
      $('askBtn').href = `https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(`Hi ${b.name}, I have a question about quote ${q.number}.`)}`;
      $('askBtn').textContent = open ? 'Ask a question on WhatsApp' : `Message ${b.name} on WhatsApp`;
    }
    $('loading').hidden = true; $('paper').hidden = false; $('actions').hidden = false;
  }

  fetch(`/api/quote/${encodeURIComponent(key)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { data = d; draw(); })
    .catch(() => { $('loading').hidden = true; $('missing').hidden = false; });

  async function post(path, body) {
    const res = await fetch(`/api/quote/${encodeURIComponent(key)}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
    return out;
  }
  $('acceptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('acceptError').hidden = true;
    const name = $('acceptName').value.trim();
    if (!name) return;
    $('acceptBtn').disabled = true; $('acceptBtn').textContent = 'Accepting…';
    try { data = await post('accept', { name }); draw(); scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (err) { $('acceptError').textContent = err.message; $('acceptError').hidden = false; }
    $('acceptBtn').disabled = false; $('acceptBtn').textContent = data?.quote?.variation ? 'Approve extra work' : 'Accept quote';
  });
  $('declineShow').addEventListener('click', () => { $('declineForm').hidden = false; $('declineShow').hidden = true; $('declineReason').focus(); });
  $('declineCancel').addEventListener('click', () => { $('declineForm').hidden = true; $('declineShow').hidden = false; });
  $('declineForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { data = await post('decline', { reason: $('declineReason').value }); draw(); }
    catch (err) { alert(err.message); }
  });
  $('printBtn').addEventListener('click', () => print());
})();
