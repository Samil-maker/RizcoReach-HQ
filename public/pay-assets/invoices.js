/* Invoices page: create client payment links and see which are paid. API: /api/pay (netlify/functions/pay.mts). */
(() => {
  const KEY_STORE = 'rr-invoices-key';
  const $ = (s, el = document) => el.querySelector(s);
  const state = { key: '', invoices: [], testMode: false, ziinaReady: true };

  const store = {
    get() {
      try {
        return localStorage.getItem(KEY_STORE) || '';
      } catch {
        return '';
      }
    },
    set(v) {
      try {
        if (v) localStorage.setItem(KEY_STORE, v);
        else localStorage.removeItem(KEY_STORE);
      } catch {
        /* private mode: the key just won't be remembered */
      }
    },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (fils) => (fils / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const link = (inv) => `${location.origin}/pay/${inv.token}`;

  let toastTimer;
  function toast(text, bad = false) {
    const el = $('[data-toast]');
    el.textContent = text;
    el.classList.toggle('err', bad);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  const ERRORS = {
    client_required: 'Add the client name.',
    amount_too_small: 'Enter an amount of at least AED 2.',
    amount_too_large: 'That amount is above AED 90,000.',
    number_taken: 'That invoice number is already used.',
    already_paid: 'This invoice is already paid.',
    cannot_delete_paid: "Paid invoices can't be deleted.",
    not_found: 'That invoice no longer exists.',
  };

  async function api(method, body) {
    const res = await fetch('/api/pay', {
      method,
      cache: 'no-store',
      headers: { authorization: `Bearer ${state.key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      store.set('');
      showPair('That key is not right.');
      throw new Error('unauthorized');
    }
    if (res.status === 503) {
      showPair('This page is off until LEAD_DESK_KEY (or INVOICE_ADMIN_KEY) is set in Netlify.');
      throw new Error('not_configured');
    }
    if (!res.ok) throw new Error(data.error || 'server_error');
    state.invoices = data.invoices || [];
    state.testMode = !!data.testMode;
    state.ziinaReady = !!data.ziinaReady;
    return data;
  }

  function showPair(msg = '') {
    $('[data-app]').hidden = true;
    $('[data-pair]').hidden = false;
    $('[data-pair-error]').textContent = msg;
  }

  function statusTag(inv) {
    if (inv.status === 'paid') return inv.paidTest ? '<span class="st test">Paid (test)</span>' : '<span class="st paid">Paid</span>';
    if (inv.status === 'void') return '<span class="st void">Cancelled</span>';
    return '<span class="st">Unpaid</span>';
  }

  function waText(inv) {
    return `Hello, here is the secure payment link for invoice ${inv.number} (AED ${money(inv.amount)}):\n${link(inv)}\n\nYou can pay by card or Apple Pay. Thank you.`;
  }

  function render() {
    $('[data-app]').hidden = false;
    $('[data-pair]').hidden = true;
    const paid = state.invoices.filter((i) => i.status === 'paid' && !i.paidTest);
    const open = state.invoices.filter((i) => i.status === 'unpaid');
    $('[data-status]').textContent = `${open.length} unpaid · AED ${money(paid.reduce((s, i) => s + i.amount, 0))} received`;

    const banner = $('[data-banner]');
    banner.classList.toggle('bad', !state.ziinaReady);
    banner.textContent = !state.ziinaReady
      ? 'Ziina is not connected: set ZIINA_API_KEY in Netlify, then redeploy.'
      : state.testMode
        ? 'Test mode is on: payments are not real. Set ZIINA_TEST_MODE to false in Netlify and redeploy before sending links to clients.'
        : '';
    banner.hidden = !banner.textContent;

    const list = $('[data-list]');
    if (!state.invoices.length) {
      list.innerHTML = '<p class="empty-list">No invoices yet. Create the first payment link above.</p>';
      return;
    }
    list.innerHTML = state.invoices
      .map((inv) => {
        const wa = `https://wa.me/${inv.clientWa || ''}?text=${encodeURIComponent(waText(inv))}`;
        const unpaid = inv.status === 'unpaid';
        return `<article class="card" data-id="${esc(inv.id)}">
          <div class="inv-top"><div class="inv-client">${esc(inv.client)}</div><div class="inv-amt">AED ${money(inv.amount)}</div></div>
          <div class="row">${statusTag(inv)}<span class="meta"><b>${esc(inv.number)}</b> · created ${when(inv.createdAt)}${inv.paidAt ? ` · paid ${when(inv.paidAt)}` : ''}${inv.attemptCount && unpaid ? ` · opened checkout ${inv.attemptCount}×` : ''}</span></div>
          ${inv.description ? `<p class="meta">${esc(inv.description)}</p>` : ''}
          <div class="actions">
            ${inv.status !== 'void' ? `<button type="button" class="btn" data-act="copy">Copy link</button>` : ''}
            ${unpaid ? `<a class="btn wa-o" href="${esc(wa)}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ''}
            ${inv.status !== 'void' ? `<a class="btn ghost" href="${esc(link(inv))}" target="_blank" rel="noopener">Open</a>` : ''}
            ${unpaid ? `<button type="button" class="btn ghost" data-act="markPaid">Mark paid</button>` : ''}
            ${unpaid ? `<button type="button" class="btn ghost" data-act="void">Cancel</button>` : ''}
            ${inv.status === 'void' ? `<button type="button" class="btn ghost" data-act="unvoid">Restore</button>` : ''}
            ${inv.status !== 'paid' || inv.paidTest ? `<button type="button" class="btn ghost danger" data-act="delete">Delete</button>` : ''}
          </div>
        </article>`;
      })
      .join('');
  }

  async function load() {
    $('[data-status]').textContent = 'Loading…';
    try {
      await api('GET');
      render();
    } catch (e) {
      if (!['unauthorized', 'not_configured'].includes(e.message)) toast("Couldn't load invoices. Check your connection.", true);
    }
  }

  $('[data-form="pair"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    state.key = e.target.key.value.trim();
    store.set(state.key);
    await load();
  });

  $('[data-act="refresh"]').addEventListener('click', load);

  $('[data-form="create"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('[data-create-error]');
    err.textContent = '';
    const invoice = Object.fromEntries(['client', 'description', 'amountAed', 'number', 'clientWa'].map((k) => [k, f[k].value.trim()]));
    const btn = $('button', f);
    btn.disabled = true;
    try {
      const data = await api('POST', { op: 'create', invoice });
      f.reset();
      render();
      const inv = data.result;
      try {
        await navigator.clipboard.writeText(link(inv));
        toast(`Link for ${inv.number} created and copied`);
      } catch {
        toast(`Link for ${inv.number} created`);
      }
    } catch (ex) {
      if (!['unauthorized', 'not_configured'].includes(ex.message)) err.textContent = ERRORS[ex.message] || "Couldn't create the invoice. Try again.";
    } finally {
      btn.disabled = false;
    }
  });

  $('[data-list]').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const inv = state.invoices.find((i) => i.id === card.dataset.id);
    if (!inv) return;
    const act = btn.dataset.act;
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(link(inv));
        toast('Link copied');
      } catch {
        window.prompt('Copy this link', link(inv));
      }
      return;
    }
    if (act === 'markPaid' && !window.confirm(`Mark ${inv.number} as paid? Only do this for money received another way (bank transfer or cash).`)) return;
    if (act === 'delete' && !window.confirm(`Delete ${inv.number}? Its link will stop working.`)) return;
    btn.disabled = true;
    try {
      await api('POST', { op: act, id: inv.id });
      render();
      toast({ markPaid: 'Marked as paid', void: 'Invoice cancelled', unvoid: 'Invoice restored', delete: 'Invoice deleted' }[act]);
    } catch (ex) {
      btn.disabled = false;
      if (!['unauthorized', 'not_configured'].includes(ex.message)) toast(ERRORS[ex.message] || 'Something went wrong. Try again.', true);
    }
  });

  state.key = store.get();
  if (state.key) load();
  else showPair();
})();
