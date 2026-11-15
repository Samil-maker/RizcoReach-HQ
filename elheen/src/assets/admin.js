// The Elheen owner's admin view: every business, its plan and payments.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const STATE = { trial: 'Free trial', active: 'Paid', due: 'Payment due', overdue: 'Overdue', included: 'Included' };
  const BADGE = { trial: 'new', active: 'booked', due: 'lost', overdue: 'lost', included: 'booked' };
  const date = (ms) => new Date(ms).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
  let key = ''; try { key = sessionStorage.getItem('elheen-admin') || ''; } catch { /* private window */ }
  let rows = [], filter = 'all';
  const notes = {};   // a message per business that survives redrawing

  const api = async (method, path, body) => {
    const res = await fetch(`/api/admin/${path}`, { method, headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  };

  function draw() {
    const count = (s) => rows.filter((r) => r.billing.state === s).length;
    const monthly = rows.filter((r) => r.billing.state === 'active').reduce((n, r) => n + r.billing.price, 0);
    $('summary').replaceChildren(...[['Businesses', rows.length], ['Paying', count('active')], ['On trial', count('trial')], ['Monthly income', `AED ${monthly.toLocaleString('en')}`]]
      .map(([label, value]) => el('div', { className: 'stat-tile' }, el('small', {}, label), el('b', {}, String(value)))));
    $('adminFilters').replaceChildren(...[['all', 'All', rows.length], ...Object.entries(STATE).map(([k, v]) => [k, v, count(k)])].map(([k, label, n]) => {
      const b = el('button', { className: 'chip-btn', type: 'button' }, label, el('b', {}, String(n)));
      b.setAttribute('aria-pressed', String(filter === k));
      b.addEventListener('click', () => { filter = k; draw(); });
      return b;
    }));
    const shown = rows.filter((r) => filter === 'all' || r.billing.state === filter);
    $('bizList').replaceChildren(...(shown.length ? shown.map(card) : [el('div', { className: 'panel empty' }, 'No businesses here.')]));
  }

  function card(r) {
    const status = el('p', { className: 'hint', role: 'status' }, notes[r.slug] || '');
    const act = async (change, message) => {
      status.textContent = 'Saving…';
      try {
        const res = await api('POST', `business/${r.slug}`, change);
        Object.assign(r, { billing: res.billing, comp: res.comp });
        notes[r.slug] = message ? message(res) : 'Saved.';
      } catch (err) { notes[r.slug] = err.message; }
      draw();
    };
    const plan = el('select', { ariaLabel: `Plan for ${r.name}` }, el('option', { value: 'start' }, 'Start · AED 149'), el('option', { value: 'grow' }, 'Grow · AED 349'));
    plan.value = r.billing.plan;
    plan.addEventListener('change', () => act({ plan: plan.value }));
    const last = r.payments[0];
    return el('div', { className: 'panel admin-card' },
      el('div', { className: 'admin-top' },
        el('div', {}, el('b', { className: 'admin-name' }, r.name), el('span', { className: 'hint' }, ` · ${r.kind}${r.area ? ` · ${r.area}` : ''}`)),
        el('span', { className: `badge ${BADGE[r.billing.state]}` }, STATE[r.billing.state])),
      el('div', { className: 'rows' },
        el('div', {}, el('span', {}, 'Paid until'), el('span', {}, r.billing.state === 'included' ? 'Included' : date(r.billing.paidUntil))),
        el('div', {}, el('span', {}, 'Last payment'), el('span', {}, last ? `${date(last.at)} · ${last.amount ? `AED ${last.amount}` : 'added by you'}` : 'None yet')),
        el('div', {}, el('span', {}, 'Enquiries'), el('span', {}, `${r.leads}${r.aiOn ? ' · assistant on' : ''}${r.facebook ? ' · Facebook connected' : ''}`)),
        el('div', {}, el('span', {}, 'Joined'), el('span', {}, date(r.createdAt)))),
      el('div', { className: 'admin-actions' },
        el('label', {}, 'Plan', plan),
        btn('+1 month', () => act({ addMonths: 1 })),
        btn('−1 month', () => act({ addMonths: -1 })),
        btn(r.comp ? 'Stop including' : 'Mark as included', () => act({ comp: !r.comp })),
        btn('Reset password', () => {
          if (!confirm(`Give ${r.name} a new password?`)) return;
          act({ resetPassword: true }, (res) => `New password: ${res.password} (business name: ${r.slug}). Send it to the owner and ask them to change it.`);
        }),
        el('a', { className: 'btn btn-ghost btn-sm', href: `/b/${r.slug}`, target: '_blank', rel: 'noopener' }, 'Open page')),
      status);
  }
  const btn = (label, onClick) => { const b = el('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, label); b.addEventListener('click', onClick); return b; };

  async function open() {
    rows = (await api('GET', 'businesses')).businesses;
    $('keyForm').hidden = true; $('adminView').hidden = false;
    draw();
  }
  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('keyError').hidden = true;
    key = $('adminKey').value.trim();
    try { await open(); try { sessionStorage.setItem('elheen-admin', key); } catch { /* ignore */ } }
    catch (err) { $('keyError').textContent = err.message; $('keyError').hidden = false; }
  });
  $('adminOut').addEventListener('click', () => { try { sessionStorage.removeItem('elheen-admin'); } catch { /* ignore */ } location.reload(); });
  if (key) open().catch(() => { $('keyForm').hidden = false; });
})();
