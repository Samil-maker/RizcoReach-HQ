// Tests for client invoice payments (netlify/functions/pay.mts).
//   node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../netlify/functions/pay.mts';

const tick = () => new Promise((r) => setImmediate(r));

/** In-memory stand-in for a Netlify Blobs store with real etag semantics. */
function memStore() {
  const docs = new Map();
  let n = 0;
  return {
    async getWithMetadata(key) {
      await tick();
      const d = docs.get(key);
      return d ? { data: JSON.parse(d.json), etag: d.etag } : null;
    },
    async setJSON(key, value, o = {}) {
      await tick();
      const cur = docs.get(key);
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      if (o.onlyIfNew && cur) return { modified: false };
      docs.set(key, { json: JSON.stringify(value), etag: `"e${++n}"` });
      return { modified: true };
    },
    peek: (key) => (docs.has(key) ? JSON.parse(docs.get(key).json) : null),
  };
}

/** A fake Ziina: remembers created intents; `complete(id)` marks one paid. */
function fakeZiina({ keyOk = true } = {}) {
  const intents = new Map();
  const calls = [];
  let n = 0;
  const fn = async (url, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers || {}));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || 'GET', headers, body });
    if (!keyOk) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    const u = new URL(url);
    if ((init.method || 'GET') === 'POST' && u.pathname === '/api/payment_intent') {
      const id = `pi_${++n}`;
      const intent = { id, status: 'requires_payment_instrument', amount: body.amount, currency_code: body.currency_code, redirect_url: `https://pay.ziina.com/x/${id}`, test: body.test };
      intents.set(id, intent);
      return new Response(JSON.stringify(intent), { status: 201 });
    }
    const m = u.pathname.match(/^\/api\/payment_intent\/(.+)$/);
    if (m && intents.has(m[1])) return new Response(JSON.stringify(intents.get(m[1])));
    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  };
  fn.calls = calls;
  fn.complete = (id, extra = {}) => Object.assign(intents.get(id), { status: 'completed', card_details: { card_brand: 'VISA', card_last_four: '4242' }, ...extra });
  return fn;
}

const ADMIN = 'a'.repeat(32);
const ORIGIN = 'https://www.rizcoreach.ae';

function setup({ env = {}, fetch = fakeZiina(), now = 1_790_000_000_000 } = {}) {
  const store = memStore();
  const clock = { now };
  const E = { ziinaKey: 'zk', testMode: true, adminKey: ADMIN, ...env };
  const call = async (path, { method = 'GET', body, auth } = {}) => {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), store, E, { fetch, now: () => clock.now });
    return { status: res.status, data: await res.json() };
  };
  const create = async (invoice) => (await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'create', invoice } })).data.result;
  return { store, clock, call, create, fetch };
}

test('admin API needs the key', async () => {
  const { call } = setup();
  assert.equal((await call('/api/pay')).status, 401);
  assert.equal((await call('/api/pay', { auth: 'wrong'.repeat(8) })).status, 401);
  const ok = await call('/api/pay', { auth: ADMIN });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.invoices, []);
  assert.equal(ok.data.testMode, true);
});

test('admin API is off without a key', async () => {
  const { call } = setup({ env: { adminKey: undefined } });
  assert.equal((await call('/api/pay', { auth: ADMIN })).status, 503);
});

test('creating an invoice stores the amount in fils and a private token', async () => {
  const { create, store } = setup();
  const inv = await create({ client: 'Art Services LLC', description: 'Meta ads management, month 1 (upfront)', amountAed: '425', number: 'A20250933', clientWa: '056 605 6054' });
  assert.equal(inv.amount, 42500);
  assert.equal(inv.number, 'A20250933');
  assert.equal(inv.clientWa, '971566056054');
  assert.equal(inv.status, 'unpaid');
  assert.match(inv.token, /^[\w-]{24}$/);
  assert.equal(store.peek('invoices').invoices.length, 1);
});

test('invoice validation', async () => {
  const { call } = setup();
  const post = (invoice) => call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'create', invoice } });
  assert.equal((await post({ amountAed: 100 })).data.error, 'client_required');
  assert.equal((await post({ client: 'X', amountAed: 1 })).data.error, 'amount_too_small');
  assert.equal((await post({ client: 'X', amountAed: 'abc' })).data.error, 'amount_too_small');
  assert.equal((await post({ client: 'X', amountAed: 100000 })).data.error, 'amount_too_large');
  await post({ client: 'X', amountAed: 10, number: 'A1' });
  assert.equal((await post({ client: 'Y', amountAed: 10, number: 'a1' })).data.error, 'number_taken');
});

test('automatic invoice numbers', async () => {
  const { create } = setup();
  const a = await create({ client: 'A', amountAed: 10 });
  const b = await create({ client: 'B', amountAed: 10 });
  assert.match(a.number, /^RR-\d{4}-0001$/);
  assert.match(b.number, /^RR-\d{4}-0002$/);
});

test('public page shows the invoice by token only, never internals', async () => {
  const { create, call } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 425 });
  const res = await call(`/api/pay/${inv.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.invoice.amount, 42500);
  assert.equal(res.data.invoice.payable, true);
  assert.equal(res.data.invoice.testMode, true);
  assert.equal(res.data.invoice.token, undefined);
  assert.equal(res.data.invoice.attempts, undefined);
  assert.equal((await call('/api/pay/not-a-real-token-123456')).status, 404);
  assert.equal((await call('/api/pay/short')).status, 404);
});

test('checkout creates a Ziina payment intent for the stored amount, in test mode', async () => {
  const { create, call, fetch, store } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 425, number: 'A20250933' });
  const res = await call(`/api/pay/${inv.token}/checkout`, { method: 'POST', body: { amount: 1 } });
  assert.equal(res.status, 200);
  assert.equal(res.data.url, 'https://pay.ziina.com/x/pi_1');
  const sent = fetch.calls.at(-1);
  assert.equal(sent.url, 'https://api-v2.ziina.com/api/payment_intent');
  assert.equal(sent.headers.authorization, 'Bearer zk');
  assert.equal(sent.body.amount, 42500);
  assert.equal(sent.body.currency_code, 'AED');
  assert.equal(sent.body.test, true);
  assert.equal(sent.body.success_url, `${ORIGIN}/pay/${inv.token}?r=success`);
  assert.equal(sent.body.cancel_url, `${ORIGIN}/pay/${inv.token}?r=cancel`);
  assert.match(sent.body.message, /A20250933/);
  assert.equal(store.peek('invoices').invoices[0].attempts.length, 1);
});

test('live mode sends test: false', async () => {
  const { create, call, fetch } = setup({ env: { testMode: false } });
  const inv = await create({ client: 'X', amountAed: 50 });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  assert.equal(fetch.calls.at(-1).body.test, false);
});

test('checkout is refused without a Ziina key, for void invoices and when hammered', async () => {
  const off = setup({ env: { ziinaKey: undefined } });
  const a = await off.create({ client: 'X', amountAed: 50 });
  assert.equal((await off.call(`/api/pay/${a.token}/checkout`, { method: 'POST' })).status, 503);
  assert.equal((await off.call(`/api/pay/${a.token}`)).data.invoice.payable, false);

  const { create, call } = setup();
  const b = await create({ client: 'Y', amountAed: 50 });
  await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'void', id: b.id } });
  assert.equal((await call(`/api/pay/${b.token}/checkout`, { method: 'POST' })).status, 410);

  const c = await create({ client: 'Z', amountAed: 50 });
  for (let i = 0; i < 8; i++) assert.equal((await call(`/api/pay/${c.token}/checkout`, { method: 'POST' })).status, 200);
  assert.equal((await call(`/api/pay/${c.token}/checkout`, { method: 'POST' })).status, 429);
});

test('a rejected Ziina key is reported plainly', async () => {
  const { create, call } = setup({ fetch: fakeZiina({ keyOk: false }) });
  const inv = await create({ client: 'X', amountAed: 50 });
  const res = await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  assert.equal(res.status, 502);
  assert.equal(res.data.error, 'ziina_key_rejected');
});

test('status marks the invoice paid only when Ziina says completed for the right amount', async () => {
  const { create, call, fetch, store } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 425 });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });

  let s = await call(`/api/pay/${inv.token}/status`);
  assert.equal(s.data.invoice.status, 'unpaid');
  assert.equal(s.data.last, 'requires_payment_instrument');

  fetch.complete('pi_1', { amount: 100 }); // wrong amount: not accepted
  s = await call(`/api/pay/${inv.token}/status`);
  assert.equal(s.data.invoice.status, 'unpaid');

  fetch.complete('pi_1', { amount: 42500 });
  s = await call(`/api/pay/${inv.token}/status`);
  assert.equal(s.data.invoice.status, 'paid');
  assert.equal(s.data.invoice.paidTest, true);
  assert.equal(s.data.invoice.reference, 'pi_1');
  assert.equal(s.data.invoice.cardLast4, '4242');
  assert.equal(s.data.invoice.payable, false);
  assert.equal(store.peek('invoices').invoices[0].status, 'paid');

  assert.equal((await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' })).status, 409);
});

test('an earlier attempt that completed still counts', async () => {
  const { create, call, fetch } = setup();
  const inv = await create({ client: 'X', amountAed: 50 });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  fetch.complete('pi_1');
  const s = await call(`/api/pay/${inv.token}/status`);
  assert.equal(s.data.invoice.status, 'paid');
  assert.equal(s.data.invoice.reference, 'pi_1');
});

test('admin can mark paid, void and delete', async () => {
  const { create, call } = setup();
  const a = await create({ client: 'A', amountAed: 50 });
  const r = await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'markPaid', id: a.id } });
  assert.equal(r.data.result.status, 'paid');
  assert.equal((await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'void', id: a.id } })).data.error, 'already_paid');
  assert.equal((await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'delete', id: a.id } })).data.error, 'cannot_delete_paid');
  const b = await create({ client: 'B', amountAed: 50 });
  const d = await call('/api/pay', { method: 'POST', auth: ADMIN, body: { op: 'delete', id: b.id } });
  assert.equal(d.data.invoices.length, 1);
});
