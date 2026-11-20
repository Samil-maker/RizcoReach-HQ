import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../netlify/functions/api.mjs';

// A stand-in for Netlify Blobs that keeps everything in memory.
function memoryStore() {
  const m = new Map();
  return {
    async get(key, opts) { const v = m.get(key); return v ? (opts?.type === 'json' ? JSON.parse(v.data) : v.data) : null; },
    async setJSON(key, value) { m.set(key, { data: JSON.stringify(value) }); },
    async set(key, data, opts) { m.set(key, { data, metadata: opts?.metadata }); },
    async getWithMetadata(key) { const v = m.get(key); return v ? { data: v.data, metadata: v.metadata } : null; },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(key) { m.delete(key); },
  };
}
const setup = (extra = {}) => {
  const store = memoryStore();
  const h = makeHandler(store, { ...extra });
  const call = async (method, path, body, token, extraHeaders = {}) => {
    const res = await h(new Request(`https://x.test/api/${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer(), type, headers: res.headers };
  };
  call.store = store;
  return call;
};
const signup = (call, extra = {}, headers = {}) => call('POST', 'signup', { name: 'Studio Layali', kind: 'interior', password: 'longenough', phone: '0581112233', ...extra }, null, headers);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('anyone can sign up with a name, a WhatsApp number and a real password', async () => {
  const call = setup();
  assert.equal((await signup(call, { password: 'short' })).status, 400);
  assert.equal((await signup(call, { phone: '' })).status, 400);
  assert.equal((await signup(call, { website: 'http://spam.example' })).status, 400);
  const ok = await signup(call);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.slug, 'studio-layali');
});

test('an interior business asks for photos and an address by default', async () => {
  const call = setup();
  await signup(call);
  const page = await call('GET', 'public/studio-layali');
  assert.equal(page.data.business.askPhotos, true);
  assert.equal(page.data.business.askAddress, true);
  assert.ok(!('pass' in page.data.business) && !('intakeKey' in page.data.business));
});

test('a client can send an enquiry with photos, and only the owner can read it', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const page = await call('GET', 'public/studio-layali');
  const sent = await call('POST', 'public/studio-layali/lead', {
    name: 'Layla', phone: '+971 50 123 4567', serviceId: page.data.business.services[0].id,
    note: 'Two bedroom villa', address: 'Al Barsha', photos: [PNG, 'not-a-photo'], source: 'instagram',
  });
  assert.equal(sent.status, 200);
  assert.equal((await call('GET', 'leads')).status, 401);
  const { data: { leads } } = await call('GET', 'leads', null, token);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].source, 'instagram');
  assert.equal(leads[0].status, 'new');
  assert.deepEqual(leads[0].photos, [0]);
  const photo = await call('GET', `photo/${leads[0].id}/0`, null, token);
  assert.equal(photo.type, 'image/png');
});

test('booking a time marks the enquiry booked and blocks that time for others', async () => {
  const call = setup();
  await signup(call);
  const when = '2030-01-05T10:00:00.000Z';
  const first = await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567', when });
  assert.equal(first.status, 200);
  const second = await call('POST', 'public/studio-layali/lead', { name: 'B', phone: '0507654321', when });
  assert.equal(second.status, 409);
  assert.deepEqual((await call('GET', 'public/studio-layali')).data.taken, [when]);
});

test('an enquiry needs a name and a phone number', async () => {
  const call = setup();
  await signup(call);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: '', phone: '0501234567' })).status, 400);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '12' })).status, 400);
});

test('one business cannot read another business\'s enquiries', async () => {
  const call = setup();
  await signup(call);
  const other = await signup(call, { name: 'Other Co' });
  await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567' });
  assert.equal((await call('GET', 'leads', null, other.data.token)).data.leads.length, 0);
});

test('signing in checks the password', async () => {
  const call = setup();
  await signup(call);
  assert.equal((await call('POST', 'login', { slug: 'studio-layali', password: 'wrong-one' })).status, 401);
  assert.equal((await call('POST', 'login', { slug: 'Studio Layali', password: 'longenough' })).status, 200);
});

test('leads from an ad form arrive through the private intake link', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const { data: { business } } = await call('GET', 'me', null, token);
  assert.equal((await call('POST', 'intake/studio-layali/wrong-key', { name: 'A', phone: '0501234567' })).status, 404);
  const ok = await call('POST', `intake/studio-layali/${business.intakeKey}`, { full_name: 'Ad Lead', phone_number: '0501234567', source: 'meta-ad' });
  assert.equal(ok.status, 200);
  const { data: { leads } } = await call('GET', 'leads', null, token);
  assert.equal(leads[0].source, 'meta-ad');
});

test('the owner can change services and opening hours', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const bad = await call('PUT', 'me', { openHour: 20, closeHour: 9 }, token);
  assert.equal(bad.status, 400);
  const ok = await call('PUT', 'me', { services: [{ name: 'Kitchen design', minutes: 60, price: 500 }, { name: '' }], openHour: 10, closeHour: 18 }, token);
  assert.equal(ok.data.business.services.length, 1);
  assert.equal(ok.data.business.services[0].name, 'Kitchen design');
});

test('a new enquiry sends a phone alert to devices the owner registered', async () => {
  const sent = [];
  const call = setup({ pushKey: 'PUBLIC', notify: async (subs, payload) => { sent.push({ subs, payload }); return []; } });
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'push', { subscription: { endpoint: 'http://not-secure', keys: {} } }, token)).status, 400);
  const reg = await call('POST', 'push', { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } } }, token);
  assert.equal(reg.data.business.alerts, 1);
  assert.ok(!('push' in reg.data.business));
  await call('POST', 'public/studio-layali/lead', { name: 'Layla', phone: '0501234567', source: 'instagram' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.title, /New enquiry: Layla/);
});

test('a dead device is forgotten, and a failing alert never loses the enquiry', async () => {
  let mode = 'dead';
  const call = setup({ notify: async (subs) => { if (mode === 'throw') throw new Error('down'); return subs.map((s) => s.endpoint); } });
  const { data: { token } } = await signup(call);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } } }, token);
  await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567' });
  assert.equal((await call('GET', 'me', null, token)).data.business.alerts, 0);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/xyz', keys: { p256dh: 'k', auth: 'a' } } }, token);
  mode = 'throw';
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'B', phone: '0507654321' })).status, 200);
  assert.equal((await call('GET', 'leads', null, token)).data.leads.length, 2);
});

test('the owner can change the password, and the old one stops working', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'password', { current: 'wrong', next: 'brand-new-pass' }, token)).status, 403);
  assert.equal((await call('POST', 'password', { current: 'longenough', next: 'short' }, token)).status, 400);
  assert.equal((await call('POST', 'password', { current: 'longenough', next: 'brand-new-pass' }, token)).status, 200);
  assert.equal((await call('POST', 'login', { slug: 'studio-layali', password: 'longenough' })).status, 401);
  assert.equal((await call('POST', 'login', { slug: 'studio-layali', password: 'brand-new-pass' })).status, 200);
});

test('the owner can add a lead that came in by phone or message', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'leads', { name: 'A', phone: '0501234567' })).status, 401);
  const ok = await call('POST', 'leads', { name: 'Walk In', phone: '0501234567', source: 'whatsapp', note: 'Asked about kitchens' }, token);
  assert.equal(ok.status, 200);
  const { data: { leads } } = await call('GET', 'leads', null, token);
  assert.equal(leads[0].source, 'whatsapp');
  assert.equal((await call('POST', 'leads', { name: 'B', phone: '0507654321', source: 'made-up' }, token)).status, 200);
  assert.equal((await call('GET', 'leads', null, token)).data.leads.find((l) => l.name === 'B').source, 'other');
});

// --- Facebook lead forms, with a stand-in for Meta's servers
import { createHmac } from 'node:crypto';
const META = { appId: 'APP1', appSecret: 'SECRET', verifyToken: 'VT', redirectUri: 'https://x.test/api/meta/callback' };
const formLead = (id, extra = []) => ({
  id, created_time: new Date().toISOString(), ad_name: 'Kitchen offer', campaign_name: 'November',
  field_data: [{ name: 'full_name', values: ['Mona Saeed'] }, { name: 'phone_number', values: ['+971501112222'] }, { name: 'email', values: ['mona@example.com'] }, ...extra],
});
function fakeMeta() {
  const calls = [];
  const graph = async (path, { method = 'GET', params = {} } = {}) => {
    calls.push({ path, method, params });
    if (path === 'oauth/access_token') return { access_token: params.fb_exchange_token ? 'LONG' : 'SHORT' };
    if (path === 'me/accounts') return { data: [{ id: '111', name: 'Layali Page', access_token: 'PAGETOKEN' }] };
    if (path === '111/subscribed_apps') return { success: true };
    if (path === '111/leadgen_forms') return { data: [{ id: 'F1' }] };
    if (path === 'F1/leads') return { data: [formLead('L1', [{ name: 'what_do_you_need', values: ['Kitchen redesign'] }]), { ...formLead('OLD'), created_time: '2020-01-01T00:00:00Z' }] };
    if (path === 'L2') return formLead('L2');
    throw new Error(`unexpected ${path}`);
  };
  return { graph, calls };
}
async function connectedBusiness(call) {
  const { data: { token } } = await signup(call);
  const start = await call('POST', 'meta/start', null, token);
  const state = new URL(start.data.url).searchParams.get('state');
  const back = await call('GET', `meta/callback?code=abc&state=${state}`);
  return { token, start, state, back };
}

test('connecting Facebook stores the page without ever showing its token', async () => {
  const fb = fakeMeta();
  const call = setup({ graph: fb.graph, meta: META });
  const { token, start, state, back } = await connectedBusiness(call);
  assert.match(start.data.url, /client_id=APP1/);
  assert.match(start.data.url, /leads_retrieval/);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/app?meta=connected');
  const { data: { business } } = await call('GET', 'me', null, token);
  assert.deepEqual(business.meta.pages, [{ id: '111', name: 'Layali Page', live: true, ig: '' }]);
  assert.doesNotMatch(start.data.url, /instagram_manage_messages/);   // messaging is only asked for once Meta has approved it
  assert.ok(!JSON.stringify(business).includes('PAGETOKEN'));
  assert.ok(fb.calls.some((c) => c.path === '111/subscribed_apps' && c.method === 'POST'));
  assert.equal((await call('GET', `meta/callback?code=abc&state=${state}`)).headers.get('location'), '/app?meta=expired');
});

test('without the app secret the connection stays off', async () => {
  const call = setup({ graph: fakeMeta().graph, meta: { ...META, appSecret: '' } });
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'meta/start', null, token)).status, 503);
  assert.equal((await call('GET', 'me', null, token)).data.business.metaAvailable, false);
});

test('checking Facebook brings in recent lead-form leads once, with their answers', async () => {
  const call = setup({ graph: fakeMeta().graph, meta: META });
  const { token } = await connectedBusiness(call);
  assert.equal((await call('POST', 'meta/sync', {}, token)).data.added, 1);
  assert.equal((await call('POST', 'meta/sync', {}, token)).data.skipped, true);
  assert.equal((await call('POST', 'meta/sync', { force: true }, token)).data.added, 0);
  const { data: { leads } } = await call('GET', 'leads', null, token);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'Mona Saeed');
  assert.equal(leads[0].source, 'meta-ad');
  assert.equal(leads[0].email, 'mona@example.com');
  assert.equal(leads[0].adName, 'Kitchen offer');
  assert.match(leads[0].note, /what do you need: Kitchen redesign/);
});

test('the Meta webhook checks its signature and adds the lead', async () => {
  const call = setup({ graph: fakeMeta().graph, meta: META });
  const { token } = await connectedBusiness(call);
  const verify = await call('GET', 'meta/webhook?hub.mode=subscribe&hub.verify_token=VT&hub.challenge=12345');
  assert.equal(Buffer.from(verify.data).toString(), '12345');
  assert.equal((await call('GET', 'meta/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status, 403);
  const payload = { object: 'page', entry: [{ id: '111', changes: [{ field: 'leadgen', value: { page_id: '111', leadgen_id: 'L2' } }] }] };
  assert.equal((await call('POST', 'meta/webhook', payload, null, { 'x-hub-signature-256': 'sha256=wrong' })).status, 403);
  const sig = `sha256=${createHmac('sha256', 'SECRET').update(JSON.stringify(payload)).digest('hex')}`;
  assert.equal((await call('POST', 'meta/webhook', payload, null, { 'x-hub-signature-256': sig })).status, 200);
  assert.equal((await call('POST', 'meta/webhook', payload, null, { 'x-hub-signature-256': sig })).status, 200);
  assert.equal((await call('GET', 'leads', null, token)).data.leads.length, 1);
});

test('disconnecting removes the page', async () => {
  const call = setup({ graph: fakeMeta().graph, meta: META });
  const { token } = await connectedBusiness(call);
  const off = await call('POST', 'meta/disconnect', null, token);
  assert.equal(off.data.business.meta, null);
});


// --- Elheen's own billing through Ziina, the paywall and the admin view
import { computeTasks, quoteTotals, DAY, fitOf } from '../netlify/lib/core.mjs';
import { morningDigest } from '../netlify/functions/daily.mjs';

function fakeZiinaPay() {
  const calls = [], intents = {};
  const ziina = async (token, path, { method = 'GET', body } = {}) => {
    calls.push({ token, path, method, body });
    if (path === 'payment_intent' && method === 'POST') { const id = `pi${calls.length}`; intents[id] = { id, status: 'requires_payment_instrument', redirect_url: `https://pay.ziina.test/${id}` }; return intents[id]; }
    if (path === 'webhook') return { success: true };
    if (path.startsWith('payment_intent/')) return intents[path.split('/')[1]];
    throw new Error(`unexpected ${path}`);
  };
  return { ziina, calls, intents };
}
const billingEnv = (z) => ({ ziina: z.ziina, billing: { token: 'ELHEEN-ZIINA', test: true }, siteUrl: 'https://x.test', ELHEEN_ADMIN_KEY: 'admin-key-0123456789' });
const ageBusiness = async (call, days) => {
  const biz = await call.store.get('biz/studio-layali', { type: 'json' });
  biz.paidUntil = Date.now() - days * DAY;
  await call.store.setJSON('biz/studio-layali', biz);
};

test('a new business gets 14 free days at AED 79 a month', async () => {
  const call = setup(billingEnv(fakeZiinaPay()));
  const { data: { token } } = await signup(call);
  const { data: { business } } = await call('GET', 'me', null, token);
  assert.equal(business.billing.state, 'trial');
  assert.equal(business.billing.price, 79);
  assert.equal(business.billing.plans.year.price, 790);
  assert.ok(Math.abs(business.billing.paidUntil - (Date.now() + 14 * DAY)) < 60e3);
  assert.ok(!JSON.stringify(business).includes('ELHEEN-ZIINA'));
  assert.ok(!('pass' in business));
});

test('paying a month or a year opens Ziina and extends the plan once', async () => {
  const z = fakeZiinaPay();
  const call = setup(billingEnv(z));
  const { data: { token } } = await signup(call);
  const before = (await call('GET', 'me', null, token)).data.business.billing.paidUntil;
  const pay = await call('POST', 'billing/pay', { option: 'year' }, token);
  const intent = z.calls.find((c) => c.path === 'payment_intent');
  assert.equal(intent.token, 'ELHEEN-ZIINA');
  assert.equal(intent.body.amount, 79000);
  assert.equal(intent.body.currency_code, 'AED');
  assert.equal(intent.body.test, true);
  const pid = new URL(intent.body.success_url).searchParams.get('billing');
  assert.equal((await call('POST', 'billing/check', { id: pid }, token)).data.status, 'pending');
  z.intents[new URL(pay.data.url).pathname.slice(1)].status = 'completed';
  const done = await call('POST', 'billing/check', { id: pid }, token);
  assert.equal(done.data.status, 'paid');
  assert.equal(done.data.billing.state, 'active');
  assert.ok(Math.abs(done.data.billing.paidUntil - (before + 360 * DAY)) < 60e3);
  assert.equal((await call('POST', 'billing/check', { id: pid }, token)).data.billing.paidUntil, done.data.billing.paidUntil);
  await call('POST', 'billing/pay', { option: 'nonsense' }, token);
  assert.equal(z.calls.filter((c) => c.path === 'payment_intent').pop().body.amount, 7900);
});

test('one business cannot check another business\'s payment', async () => {
  const call = setup(billingEnv(fakeZiinaPay()));
  const a = await signup(call);
  const b = await signup(call, { name: 'Other Co' });
  await call('POST', 'billing/pay', {}, a.data.token);
  const pid = (await call.store.list({ prefix: 'payments/' })).blobs[0].key.split('/')[1];
  assert.equal((await call('POST', 'billing/check', { id: pid }, b.data.token)).status, 404);
});

test('the Ziina webhook confirms a payment only with the right signature', async () => {
  const z = fakeZiinaPay();
  const call = setup(billingEnv(z));
  const { data: { token } } = await signup(call);
  const pay = await call('POST', 'billing/pay', {}, token);
  const intentId = new URL(pay.data.url).pathname.slice(1);
  assert.ok(z.calls.some((c) => c.path === 'webhook' && c.body.url === 'https://x.test/api/billing/webhook'));
  const payload = { event: 'payment_intent.status.updated', data: { id: intentId, status: 'completed' } };
  assert.equal((await call('POST', 'billing/webhook', payload, null, { 'x-hmac-signature': 'nope' })).status, 403);
  const { secret } = await call.store.get('platform/ziina', { type: 'json' });
  const sig = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await call('POST', 'billing/webhook', payload, null, { 'x-hmac-signature': sig, 'x-nf-client-connection-ip': '9.9.9.9' })).status, 403);
  assert.equal((await call('POST', 'billing/webhook', payload, null, { 'x-hmac-signature': sig, 'x-nf-client-connection-ip': '3.29.184.186' })).status, 200);
  assert.equal((await call('GET', 'me', null, token)).data.business.billing.state, 'active');
});

test('without the Elheen Ziina token, paying says so instead of failing', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'billing/pay', {}, token)).status, 503);
  assert.equal((await call('GET', 'me', null, token)).data.business.billing.online, false);
});

test('an overdue business is asked to pay, but its booking page keeps taking enquiries', async () => {
  const call = setup(billingEnv(fakeZiinaPay()));
  const { data: { token } } = await signup(call);
  await ageBusiness(call, 3);
  assert.equal((await call('GET', 'leads', null, token)).status, 200);
  await ageBusiness(call, 10);
  const locked = await call('GET', 'leads', null, token);
  assert.equal(locked.status, 402);
  assert.equal(locked.data.locked, true);
  assert.equal((await call('GET', 'me', null, token)).data.business.billing.state, 'overdue');
  assert.equal((await call('POST', 'billing/pay', {}, token)).status, 200);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567' })).status, 200);
});

test('the admin view needs its key and can extend, include and reset a business', async () => {
  const call = setup(billingEnv(fakeZiinaPay()));
  await signup(call);
  assert.equal((await call('GET', 'admin/businesses', null, null, { 'x-admin-key': 'wrong-key-0123456789' })).status, 401);
  const h = { 'x-admin-key': 'admin-key-0123456789' };
  const list = await call('GET', 'admin/businesses', null, null, h);
  assert.equal(list.data.businesses[0].slug, 'studio-layali');
  assert.equal(list.data.businesses[0].quotes, 0);
  assert.equal((await call('POST', 'admin/business/studio-layali', { addMonths: 2 }, null, h)).data.billing.state, 'active');
  assert.equal((await call('POST', 'admin/business/studio-layali', { comp: true }, null, h)).data.billing.state, 'included');
  const reset = await call('POST', 'admin/business/studio-layali', { resetPassword: true }, null, h);
  assert.equal((await call('POST', 'login', { slug: 'studio-layali', password: reset.data.password })).status, 200);
  assert.equal((await setup({})('GET', 'admin/businesses', null, null, h)).status, 401);
});

// --- leads: stages, team bookings, payments and deleting
const newLead = async (call, extra = {}) => {
  await call('POST', 'public/studio-layali/lead', { name: 'Layla Ahmed', phone: '0501234567', ...extra });
  const signedIn = await call('POST', 'login', { slug: 'studio-layali', password: 'longenough' });
  const { data: { leads } } = await call('GET', 'leads', null, signedIn.data.token);
  return leads.find((l) => l.name === (extra.name || 'Layla Ahmed'));
};

test('the owner moves a lead through the stages and the history records it', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  assert.equal((await call('PATCH', `leads/${lead.id}`, { status: 'talking' }, token)).data.lead.status, 'talking');
  const won = await call('PATCH', `leads/${lead.id}`, { status: 'won' }, token);
  assert.ok(won.data.lead.wonAt);
  assert.equal((await call('PATCH', `leads/${lead.id}`, { status: 'nonsense' }, token)).data.lead.status, 'won');
  assert.match(won.data.lead.history.map((h) => h.text).join('|'), /Moved to talking\|Moved to won/);
});

test('two visits at the same time are only allowed for different team members', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  await call('PUT', 'me', { team: ['Omar', 'Sara', 'Omar', ''] }, token);
  assert.deepEqual((await call('GET', 'me', null, token)).data.business.team, ['Omar', 'Sara']);
  const a = await newLead(call, { name: 'A' });
  const b = await newLead(call, { name: 'B' });
  const when = '2030-05-01T06:00:00.000Z';
  await call('PATCH', `leads/${a.id}`, { assignee: 'Omar', when }, token);
  assert.equal((await call('PATCH', `leads/${b.id}`, { assignee: 'Omar', when }, token)).status, 409);
  const ok = await call('PATCH', `leads/${b.id}`, { assignee: 'Sara', when }, token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.lead.status, 'booked');
});

test('payments on a job record when each part was received', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  const set = await call('PATCH', `leads/${lead.id}`, { milestones: [{ label: 'Deposit', amount: 5000, paid: true }, { label: 'Handover', amount: 5000 }] }, token);
  const [dep, hand] = set.data.lead.milestones;
  assert.ok(dep.paidAt);
  assert.equal(hand.paidAt, null);
  const again = await call('PATCH', `leads/${lead.id}`, { milestones: [{ ...dep, paid: true }, { ...hand, paid: false }] }, token);
  assert.equal(again.data.lead.milestones[0].paidAt, dep.paidAt);
  assert.match(again.data.lead.history.map((h) => h.text).join('|'), /Received Deposit \(AED 5,000\)/);
});

test('deleting a lead removes its quotes and photos too', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const lead = await newLead(call, { photos: [PNG] });
  const q = (await call('POST', 'quotes', { leadId: lead.id, items: [{ desc: 'Design', qty: 1, price: 100 }] }, token)).data.quote;
  assert.equal((await call('DELETE', `leads/${lead.id}`, null, token)).status, 200);
  assert.equal((await call('GET', 'leads', null, token)).data.leads.length, 0);
  assert.equal((await call.store.list({ prefix: 'photos/' })).blobs.length, 0);
  assert.equal((await call('GET', `quote/${q.publicKey}`)).status, 404);
});

// --- quotes
const ITEMS = [{ desc: 'Living room design', qty: 1, price: 12000 }, { desc: 'Custom joinery', qty: 3, price: 2500.5 }, { desc: '', qty: 1, price: 9 }];

test('a quote adds up its items, discount and VAT only when the business is VAT registered', async () => {
  assert.deepEqual(quoteTotals({ items: [{ qty: 2, price: 100 }], discount: 50, vat: true }, true), { subtotal: 200, discount: 50, vat: 7.5, total: 157.5 });
  assert.deepEqual(quoteTotals({ items: [{ qty: 2, price: 100 }], discount: 50, vat: true }, false), { subtotal: 200, discount: 50, vat: 0, total: 150 });
  assert.equal(quoteTotals({ items: [{ qty: 1, price: 10 }], discount: 99 }, false).total, 0);
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  await call('PUT', 'me', { vatRegistered: true, trn: '100123456700003' }, token);
  const lead = await newLead(call);
  const res = await call('POST', 'quotes', { leadId: lead.id, title: 'Villa living room', items: ITEMS, discount: 1000 }, token);
  const q = res.data.quote;
  assert.equal(q.number, 'Q-0001');
  assert.equal(q.items.length, 2);
  assert.deepEqual(q.totals, { subtotal: 19501.5, discount: 1000, vat: 925.08, total: 19426.58 });
  assert.equal(q.state, 'draft');
  assert.match(q.link, /^https:\/\/x\.test\/q\//);
  assert.equal((await call('POST', 'quotes', { leadId: lead.id, items: ITEMS }, token)).data.quote.number, 'Q-0002');
});

test('a draft quote is private; sending it makes it public and moves the lead to quoted', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  const q = (await call('POST', 'quotes', { leadId: lead.id, items: [] }, token)).data.quote;
  assert.equal((await call('GET', `quote/${q.publicKey}`)).status, 404);
  assert.equal((await call('PATCH', `quotes/${q.id}`, { send: true }, token)).status, 400);
  const sent = await call('PATCH', `quotes/${q.id}`, { items: ITEMS, send: true }, token);
  assert.equal(sent.data.quote.state, 'sent');
  assert.ok(sent.data.quote.sentAt);
  const view = await call('GET', `quote/${q.publicKey}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.client, 'Layla Ahmed');
  assert.equal(view.data.quote.totals.total, 19501.5);
  assert.ok(!JSON.stringify(view.data).includes('0501234567'));
  const after = (await call('GET', 'leads', null, token)).data.leads[0];
  assert.equal(after.status, 'quoted');
});

test('opening and accepting a quote tells the owner and wins the job with a payment plan', async () => {
  const sent = [];
  const call = setup({ siteUrl: 'https://x.test', notify: async (subs, payload) => { sent.push(payload.title); return []; } });
  const { data: { token } } = await signup(call);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } } }, token);
  const lead = await newLead(call);
  const q = (await call('PATCH', `quotes/${(await call('POST', 'quotes', { leadId: lead.id, items: [{ desc: 'Kitchen', qty: 1, price: 30000 }] }, token)).data.quote.id}`, { send: true }, token)).data.quote;
  await call('GET', `quote/${q.publicKey}`);
  await call('GET', `quote/${q.publicKey}`);
  assert.equal(sent.filter((t) => t.startsWith('Quote opened')).length, 1);
  assert.equal((await call('POST', `quote/${q.publicKey}/accept`, { name: '' })).status, 400);
  const ok = await call('POST', `quote/${q.publicKey}/accept`, { name: 'Layla Ahmed' });
  assert.equal(ok.data.quote.state, 'accepted');
  assert.ok(sent.includes('Quote accepted: Q-0001'));
  const won = (await call('GET', 'leads', null, token)).data.leads[0];
  assert.equal(won.status, 'won');
  assert.equal(won.value, 30000);
  assert.deepEqual(won.milestones.map((m) => [m.label, m.amount]), [['Deposit', 15000], ['Progress payment', 12000], ['On handover', 3000]]);
  assert.equal((await call('PATCH', `quotes/${q.id}`, { items: [] }, token)).status, 409);
  assert.equal((await call('DELETE', `quotes/${q.id}`, null, token)).status, 409);
  assert.equal((await call('POST', `quote/${q.publicKey}/decline`, {})).status, 409);
});

test('a client can decline, and an expired quote cannot be accepted', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  const make = async () => (await call('PATCH', `quotes/${(await call('POST', 'quotes', { leadId: lead.id, items: ITEMS }, token)).data.quote.id}`, { send: true }, token)).data.quote;
  const a = await make();
  const no = await call('POST', `quote/${a.publicKey}/decline`, { reason: 'Too expensive' });
  assert.equal(no.data.quote.state, 'declined');
  assert.match((await call('GET', 'leads', null, token)).data.leads[0].history.map((h) => h.text).join('|'), /Declined quote Q-0001: Too expensive/);
  const b = await make();
  const stored = await call.store.get(`quotes/studio-layali/${b.id}`, { type: 'json' });
  stored.validUntil = Date.now() - 1000;
  await call.store.setJSON(`quotes/studio-layali/${b.id}`, stored);
  const late = await call('POST', `quote/${b.publicKey}/accept`, { name: 'Layla' });
  assert.equal(late.status, 409);
  assert.match(late.data.error, /expired/);
});

// --- today's follow-ups
const T0 = Date.UTC(2030, 0, 10, 6);
const lead0 = (extra = {}) => ({ id: 'L1', name: 'Layla', status: 'talking', createdAt: T0 - 10 * DAY, lastTouch: T0, history: [], milestones: [], ...extra });
const quote0 = (extra = {}) => ({ id: 'Q1', leadId: 'L1', number: 'Q-0001', status: 'sent', sentAt: T0, followUps: [], totals: { total: 20000 }, publicKey: 'pk', ...extra });

test('a sent quote is chased after 2, 5 and 10 days, then left alone', () => {
  const at = (days, followUps = 0) => computeTasks({}, [lead0()], [quote0({ followUps: Array(followUps).fill({ at: T0 }) })], T0 + days * DAY).filter((t) => t.type === 'quote');
  assert.equal(at(1).length, 0);
  assert.equal(at(2).length, 1);
  assert.equal(at(2)[0].step, 1);
  assert.equal(at(3, 1).length, 0);
  assert.equal(at(5, 1)[0].step, 2);
  assert.equal(at(10, 2)[0].step, 3);
  assert.equal(at(30, 3).length, 0);
  assert.equal(computeTasks({}, [lead0({ status: 'won' })], [quote0()], T0 + 3 * DAY).filter((t) => t.type === 'quote').length, 0);
  assert.equal(computeTasks({}, [lead0()], [quote0({ snoozeUntil: T0 + 4 * DAY })], T0 + 3 * DAY).filter((t) => t.type === 'quote').length, 0);
});

test('new enquiries, quiet leads, tomorrow\'s visits and unpaid deposits all appear', () => {
  const tasks = computeTasks({}, [
    lead0({ id: 'A', name: 'New', status: 'new', createdAt: T0 - 3600e3 }),
    lead0({ id: 'B', name: 'Quiet', status: 'talking', lastTouch: T0 - 4 * DAY }),
    lead0({ id: 'C', name: 'Visit', status: 'booked', when: new Date(T0 + 20 * 3600e3).toISOString() }),
    lead0({ id: 'D', name: 'Paid later', status: 'won', wonAt: T0 - 3 * DAY, lastTouch: T0 - 3 * DAY, milestones: [{ label: 'Deposit', amount: 5000, paidAt: null }] }),
    lead0({ id: 'E', name: 'Lost', status: 'lost' }),
  ], [], T0);
  assert.deepEqual(tasks.map((t) => t.type).sort(), ['checkin', 'deposit', 'reply', 'visit']);
});

test('a booking from the enquiry link asks the owner to confirm it, once', () => {
  const booked = (extra) => lead0({ id: 'K', name: 'Booked', status: 'booked', lastTouch: null, when: new Date(T0 + 3 * DAY).toISOString(), ...extra });
  const t = computeTasks({}, [booked()], [], T0);
  assert.equal(t.length, 1);
  assert.equal(t[0].type, 'reply');
  assert.match(t[0].title, /Confirm the booking/);
  assert.equal(computeTasks({}, [booked({ lastTouch: T0 })], [], T0).length, 0);
  // within a day of the visit, only the day-before reminder shows
  assert.deepEqual(computeTasks({}, [booked({ when: new Date(T0 + 20 * 3600e3).toISOString() })], [], T0).map((x) => x.type), ['visit']);
});

test('leads the owner adds start as talking, with no alert and nothing to chase yet', async () => {
  const sent = [];
  const call = setup({ pushKey: 'PUBLIC', notify: async (subs, p) => { sent.push(p); return []; } });
  const { data: { token } } = await signup(call);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } } }, token);
  await call('POST', 'leads', { name: 'From a call', phone: '0501112222', source: 'call' }, token);
  const [l] = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(l.status, 'talking');
  assert.ok(l.lastTouch);
  assert.equal(sent.length, 0);
  assert.equal((await call('GET', 'today', null, token)).data.tasks.length, 0);
});

test('one connection can only open a few accounts a day', async () => {
  const call = setup();
  const ip = { 'x-nf-client-connection-ip': '203.0.113.9' };
  for (let i = 0; i < 5; i++) assert.equal((await signup(call, { name: `Shop ${i}` }, ip)).status, 200);
  assert.equal((await signup(call, { name: 'Shop 6' }, ip)).status, 429);
  assert.equal((await signup(call, { name: 'Shop 7' }, { 'x-nf-client-connection-ip': '203.0.113.10' })).status, 200);
});

test('the set-up checklist remembers what the owner has done', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  let me = (await call('GET', 'me', null, token)).data.business;
  assert.equal(me.phone, '0581112233');
  assert.ok(!me.servicesSaved && !me.linkShared);
  me = (await call('PUT', 'me', { services: me.services, linkShared: true }, token)).data.business;
  assert.ok(me.servicesSaved && me.linkShared);
});

test('only exceptions show: a visit with no quote, a finished job still owed money, a quote opened but unanswered', () => {
  const project = { kind: 'interior' };
  const visited = lead0({ id: 'V', name: 'Visited', status: 'booked', when: new Date(T0 - 5 * 3600e3).toISOString() });
  assert.deepEqual(computeTasks(project, [visited], [], T0).map((t) => t.type), ['toquote']);
  assert.equal(computeTasks(project, [visited], [quote0({ leadId: 'V' })], T0).filter((t) => t.type === 'toquote').length, 0);
  assert.equal(computeTasks(project, [{ ...visited, quoteHandled: true }], [], T0).length, 0);
  assert.equal(computeTasks({ kind: 'salon' }, [visited], [], T0).length, 0);   // appointment businesses do not quote after a visit

  const finished = lead0({ id: 'F', name: 'Finished', status: 'done', lastTouch: T0 - 3 * DAY,
    milestones: [{ label: 'Deposit', amount: 5000, paidAt: T0 - 9 * DAY }, { label: 'On handover', amount: 1200, paidAt: null }, { label: 'Snag list', amount: 300, paidAt: null }] });
  const [owed] = computeTasks(project, [finished], [], T0);
  assert.equal(owed.type, 'deposit');
  assert.ok(owed.final);
  assert.equal(owed.amount, 1500);
  assert.equal(computeTasks(project, [{ ...finished, lastTouch: T0 - DAY }], [], T0).length, 0);   // just asked: wait two days

  const opened = (days) => computeTasks({}, [lead0()], [quote0({ viewedAt: T0 + 2 * 3600e3 })], T0 + days * DAY).filter((t) => t.type === 'quote');
  assert.equal(opened(0.5).length, 0);
  assert.equal(opened(1.2).length, 1);
});

test('a quote already sent some other way is added and chased at once', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  assert.equal((await call('POST', 'quotes/existing', { name: 'Hessa', amount: 0 }, token)).status, 400);
  const r = await call('POST', 'quotes/existing', { name: 'Hessa', phone: '0507778888', title: 'Kitchen renovation', amount: 45000, sentDaysAgo: 6 }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.quote.state, 'sent');
  assert.equal(r.data.quote.totals.total, 45000);
  assert.ok(r.data.quote.external);
  const [lead] = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(lead.status, 'quoted');
  assert.equal(lead.value, 45000);
  const tasks = (await call('GET', 'today', null, token)).data.tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].type, 'quote');
  assert.ok(tasks[0].external);
  assert.equal((await call('GET', `quote/${r.data.quote.publicKey}`)).status, 200);
});

test('screening questions mark each enquiry as a good fit or one to check', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const me = (await call('GET', 'me', null, token)).data.business;
  assert.equal(me.askBudget, true);   // on by default for interior design
  await call('PUT', 'me', { minJob: 20000 }, token);
  const pub = (await call('GET', 'public/studio-layali')).data.business;
  assert.equal(pub.askBudget, true);
  assert.equal(pub.minJob, 20000);
  const send = (name, extra) => call('POST', 'public/studio-layali/lead', { name, phone: '0501234567', ...extra });
  await send('Serious', { budgetBand: 'b50', start: 'now', property: 'villa' });
  await send('Too small', { budgetBand: 'u10', start: 'now' });
  await send('Dreaming', { budgetBand: 'o150', start: 'ideas' });
  await send('Unknown', { budgetBand: 'made-up', start: 'whenever' });
  const leads = Object.fromEntries((await call('GET', 'leads', null, token)).data.leads.map((l) => [l.name, l]));
  assert.equal(leads.Serious.fit.fit, 'good');
  assert.equal(leads.Serious.property, 'villa');
  assert.deepEqual(leads['Too small'].fit, { fit: 'check', why: ['budget'] });
  assert.deepEqual(leads.Dreaming.fit, { fit: 'check', why: ['ideas'] });
  assert.equal(leads.Unknown.fit, null);
  assert.equal(leads.Unknown.budgetBand, null);
  const reply = (await call('GET', 'today', null, token)).data.tasks.find((t) => t.leadId === leads.Serious.id);
  assert.equal(reply.fit, 'good');
  assert.equal(fitOf({ minJob: 0 }, { budgetBand: 'u10', start: 'm3' }).fit, 'good');   // no minimum set: any real budget can be a good fit
});

test('extra work on a won job is approved in writing and adds to the job, never replacing it', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  const send = async (items) => (await call('PATCH', `quotes/${(await call('POST', 'quotes', { leadId: lead.id, items }, token)).data.quote.id}`, { send: true }, token)).data.quote;
  const first = await send([{ desc: 'Kitchen', qty: 1, price: 30000 }]);
  assert.ok(!first.variation);
  await call('POST', `quote/${first.publicKey}/accept`, { name: 'Layla' });
  const extra = await send([{ desc: 'Move the sink to the island', qty: 1, price: 4000 }]);
  assert.ok(extra.variation);
  assert.equal(extra.title, 'Extra work');
  assert.ok((await call('GET', `quote/${extra.publicKey}`)).data.quote.variation);
  const chase = computeTasks({}, (await call('GET', 'leads', null, token)).data.leads, [{ ...extra, sentAt: Date.now() - 3 * DAY }], Date.now());
  assert.equal(chase.filter((t) => t.type === 'quote' && t.variation).length, 1);   // chased even though the job is won
  await call('POST', `quote/${extra.publicKey}/accept`, { name: 'Layla' });
  const [l] = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(l.status, 'won');
  assert.equal(l.value, 34000);
  assert.equal(l.milestones.length, 4);
  assert.deepEqual(l.milestones.map((m) => m.amount), [15000, 12000, 3000, 4000]);
  assert.match(l.milestones[3].label, /Extra work Q-0002/);
});

test('the price list and quote templates are kept clean, and quote lines keep their unit', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const me = (await call('PUT', 'me', {
    priceBook: [{ name: 'Gypsum ceiling', unit: 'sqm', price: 45 }, { name: '', price: 9 }, { name: 'Painting', unit: 'sqm', price: -5 }],
    templates: [{ name: 'Standard kitchen', title: 'Kitchen renovation', items: [{ desc: 'Cabinets', qty: 6, unit: 'm', price: 2300 }] }, { name: 'Empty', items: [] }],
  }, token)).data.business;
  assert.equal(me.priceBook.length, 2);
  assert.ok(me.priceBook[0].id);
  assert.equal(me.priceBook[1].price, 0);
  assert.equal(me.templates.length, 1);
  assert.equal(me.templates[0].items[0].unit, 'm');
  const lead = await newLead(call);
  const q = (await call('POST', 'quotes', { leadId: lead.id, items: [{ desc: 'Gypsum ceiling', qty: 32, unit: 'sqm', price: 45 }] }, token)).data.quote;
  assert.equal(q.items[0].unit, 'sqm');
  assert.equal(q.totals.subtotal, 1440);
  const sent = (await call('PATCH', `quotes/${q.id}`, { send: true }, token)).data.quote;
  assert.equal((await call('GET', `quote/${sent.publicKey}`)).data.quote.items[0].unit, 'sqm');
});

test('a finished job asks for a review once, only when the review link is set', async () => {
  const done = lead0({ id: 'R', name: 'Happy', status: 'done', lastTouch: T0 - 3600e3 });
  assert.equal(computeTasks({}, [done], [], T0).filter((t) => t.type === 'review').length, 0);
  const biz = { reviewLink: 'https://g.page/r/example/review' };
  assert.equal(computeTasks(biz, [done], [], T0).filter((t) => t.type === 'review').length, 1);
  assert.equal(computeTasks(biz, [{ ...done, reviewAsked: T0 }], [], T0).length, 0);
  const call = setup();
  const { data: { token } } = await signup(call);
  assert.equal((await call('PUT', 'me', { reviewLink: 'not a link' }, token)).status, 400);
  assert.equal((await call('PUT', 'me', { reviewLink: 'https://g.page/r/abc/review' }, token)).status, 200);
  const lead = await newLead(call);
  await call('PATCH', `leads/${lead.id}`, { status: 'done' }, token);
  const t = (await call('GET', 'today', null, token)).data.tasks.find((x) => x.type === 'review');
  assert.ok(t);
  await call('POST', 'today/done', { type: 'review', leadId: lead.id }, token);
  assert.equal((await call('GET', 'today', null, token)).data.tasks.filter((x) => x.type === 'review').length, 0);
});

test('lead sources from tracked links are kept short and plain', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  await call('POST', 'public/studio-layali/lead?src=Instagram', { name: 'A', phone: '0501234567' });
  await call('POST', 'public/studio-layali/lead', { name: 'B', phone: '0501234567', source: 'van <script>' });
  const sources = (await call('GET', 'leads', null, token)).data.leads.map((l) => l.source).sort();
  assert.deepEqual(sources, ['instagram', 'vanscript']);
});

test('team members sign in with their own password and only see what their role allows', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token: owner } } = await signup(call);
  assert.equal((await call('POST', 'team', { name: '' }, owner)).status, 400);
  const sara = (await call('POST', 'team', { name: 'Sara', role: 'full' }, owner)).data;
  const ahmed = (await call('POST', 'team', { name: 'Ahmed', role: 'visits' }, owner)).data;
  assert.ok(sara.password.length >= 8 && !('pass' in sara.user));
  assert.equal((await call('POST', 'team', { name: 'sara' }, owner)).status, 409);
  const me = (await call('GET', 'me', null, owner)).data.business;
  assert.deepEqual(me.team.sort(), ['Ahmed', 'Sara']);
  assert.ok(me.users.every((u) => !('pass' in u)));

  const login = async (password) => (await call('POST', 'login', { slug: 'studio-layali', password })).data.token;
  const s = await login(sara.password), a = await login(ahmed.password);
  assert.ok(s && a);
  assert.equal((await call('GET', 'me', null, a)).data.business.you.role, 'visits');
  assert.equal((await call('GET', 'me', null, a)).data.business.users.length, 0);

  // one lead for Ahmed, one for nobody
  await call('POST', 'public/studio-layali/lead', { name: 'Given', phone: '0501234567' });
  await call('POST', 'public/studio-layali/lead', { name: 'Other', phone: '0501234567' });
  const all = (await call('GET', 'leads', null, s)).data.leads;
  assert.equal(all.length, 2);   // full access sees everything
  const given = all.find((l) => l.name === 'Given');
  await call('PATCH', `leads/${given.id}`, { assignee: 'Ahmed', when: new Date(Date.now() + 20 * 3600e3).toISOString() }, s);
  assert.match((await call('GET', 'leads', null, owner)).data.leads.find((l) => l.id === given.id).history.map((h) => h.text).join('|'), /Time set \(Sara\)/);
  const mine = (await call('GET', 'leads', null, a)).data.leads;
  assert.deepEqual(mine.map((l) => l.name), ['Given']);
  assert.equal((await call('PATCH', `leads/${all.find((l) => l.name === 'Other').id}`, { ownerNote: 'x' }, a)).status, 404);
  const noted = (await call('PATCH', `leads/${given.id}`, { status: 'lost', siteNote: 'Measured the kitchen, 4.2 m wall' }, a)).data.lead;
  assert.equal(noted.status, 'booked');   // the visits role cannot move the stage
  assert.match(noted.history.at(-1).text, /Ahmed: Measured the kitchen/);
  assert.deepEqual((await call('GET', 'quotes', null, a)).data.quotes, []);
  assert.equal((await call('POST', 'quotes', { leadId: given.id, items: ITEMS }, a)).status, 403);
  assert.equal((await call('POST', 'leads', { name: 'X' }, a)).status, 403);
  assert.equal((await call('PUT', 'me', { name: 'Hacked' }, a)).status, 403);
  assert.ok((await call('GET', 'today', null, a)).data.tasks.every((t) => t.type === 'visit'));
  // only the owner manages billing, logins and connections
  assert.equal((await call('POST', 'billing/pay', { option: 'month' }, s)).status, 403);
  assert.equal((await call('GET', 'team', null, s)).status, 403);
  assert.equal((await call('PUT', 'me', { area: 'Al Quoz' }, s)).status, 200);
  // a member changes their own password, never to one already in use
  assert.equal((await call('POST', 'password', { current: ahmed.password, next: sara.password }, a)).status, 400);
  assert.equal((await call('POST', 'password', { current: ahmed.password, next: 'ahmed-new-pass' }, a)).status, 200);
  assert.ok(await login('ahmed-new-pass'));
  assert.ok(await login('longenough'));   // the owner is untouched
  // removing a login signs that person out everywhere
  await call('DELETE', `team/${ahmed.user.id}`, null, owner);
  assert.equal((await call('GET', 'leads', null, a)).status, 401);
  const reset = (await call('PATCH', `team/${sara.user.id}`, { resetPassword: true, role: 'visits' }, owner)).data;
  assert.equal(reset.user.role, 'visits');
  assert.ok(await login(reset.password));
});

test('Google Ads lead forms land as leads, once, only with the right key', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  const key = (await call('GET', 'me', null, token)).data.business.googleKey;
  assert.ok(key);
  const lead = { lead_id: 'G-1', api_version: '1.0', form_id: 9, campaign_id: 77, gcl_id: 'EAIaIQ-test', google_key: key,
    user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Noor Hassan' }, { column_id: 'PHONE_NUMBER', string_value: '+971 50 123 4567' },
      { column_id: 'EMAIL', string_value: 'noor@example.com' }, { column_name: 'What do you need?', column_id: 'what_do_you_need', string_value: 'Villa painting' }] };
  assert.equal((await call('POST', 'google/studio-layali', { ...lead, google_key: 'wrong' })).status, 403);
  assert.equal((await call('POST', 'google/studio-layali', lead)).status, 200);
  assert.equal((await call('POST', 'google/studio-layali', lead)).status, 200);   // Google may send it again
  const leads = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'Noor Hassan');
  assert.equal(leads[0].source, 'google-ads');
  assert.equal(leads[0].gclid, 'EAIaIQ-test');
  assert.match(leads[0].note, /What do you need\?: Villa painting/);
  await call('POST', 'google/studio-layali', { google_key: key, is_test: true, user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Sample' }] });
  assert.ok((await call('GET', 'leads', null, token)).data.leads.some((l) => l.name === 'Test: Sample'));
});

test('Instagram, Facebook and WhatsApp messages become leads, and a reply goes back the same way', async () => {
  const sent = [];
  const fb = fakeMeta();
  const graph = async (path, opts = {}) => {
    if (path === '111' && opts.params?.fields?.includes('instagram')) return { instagram_business_account: { id: 'IG9', username: 'layali.studio' } };
    if (path === 'IGSID1') return { name: 'Reem Khalid' };
    if (path === '111/messages' || path === 'PHONE7/messages') { sent.push({ path, body: opts.body }); return { message_id: 'm1' }; }
    if (path === 'oauth/access_token' && opts.params?.code === 'WACODE') return { access_token: 'WATOKEN' };
    if (path === 'WABA1/subscribed_apps') return { success: true };
    if (path === 'PHONE7') return { display_phone_number: '+971 50 000 0000' };
    return fb.graph(path, opts);
  };
  const call = setup({ graph, meta: { ...META, messaging: true, waConfigId: 'CFG' } });
  const { token } = await connectedBusiness(call);
  assert.ok(fb.calls.some((c) => c.path === '111/subscribed_apps' && c.params.subscribed_fields === 'leadgen,messages'));
  const signedPost = async (payload) => {
    const sig = `sha256=${createHmac('sha256', 'SECRET').update(JSON.stringify(payload)).digest('hex')}`;
    return call('POST', 'meta/webhook', payload, null, { 'x-hub-signature-256': sig });
  };
  const dm = (mid, text) => ({ object: 'instagram', entry: [{ id: 'IG9', messaging: [{ sender: { id: 'IGSID1' }, recipient: { id: 'IG9' }, timestamp: Date.now(), message: { mid, text } }] }] });
  await signedPost(dm('mid.1', 'Hi, how much for a majlis design?'));
  await signedPost(dm('mid.1', 'Hi, how much for a majlis design?'));   // delivered twice
  await signedPost({ object: 'instagram', entry: [{ id: 'IG9', messaging: [{ sender: { id: 'IG9' }, recipient: { id: 'IGSID1' }, message: { mid: 'mid.echo', text: 'ours', is_echo: true } }] }] });
  let leads = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, 'Reem Khalid');
  assert.equal(leads[0].source, 'instagram-dm');
  assert.equal(leads[0].messages.length, 1);
  // reply from Elheen, then a second message continues the same lead
  const replied = (await call('POST', `leads/${leads[0].id}/reply`, { text: 'Hi Reem, happy to help. When can we call?' }, token)).data.lead;
  assert.equal(replied.status, 'talking');
  assert.deepEqual(sent[0], { path: '111/messages', body: { recipient: { id: 'IGSID1' }, message: { text: 'Hi Reem, happy to help. When can we call?' }, messaging_type: 'RESPONSE' } });
  await signedPost(dm('mid.2', 'Tomorrow at 4 works'));
  leads = (await call('GET', 'leads', null, token)).data.leads;
  assert.equal(leads.length, 1);
  assert.deepEqual(leads[0].messages.map((m) => m.from), ['them', 'us', 'them']);
  const tasks = (await call('GET', 'today', null, token)).data.tasks;
  assert.ok(tasks.some((t) => t.type === 'message' && /Tomorrow at 4/.test(t.detail)));

  // WhatsApp: connect through Meta's sign-up window, then a message arrives
  assert.equal((await call('POST', 'whatsapp/connect', { code: 'WACODE', phone_number_id: 'PHONE7', waba_id: 'WABA1' }, token)).data.business.whatsapp.display, '+971 50 000 0000');
  await signedPost({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PHONE7' },
    contacts: [{ wa_id: '971501112222', profile: { name: 'Omar' } }], messages: [{ from: '971501112222', id: 'wamid.1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Need a deep clean on Saturday' } }] } }] }] });
  const wa = (await call('GET', 'leads', null, token)).data.leads.find((l) => l.source === 'whatsapp');
  assert.equal(wa.name, 'Omar');
  assert.equal(wa.phone, '971501112222');
  await call('POST', `leads/${wa.id}/reply`, { text: 'Yes, Saturday 10am works.' }, token);
  assert.deepEqual(sent[1], { path: 'PHONE7/messages', body: { messaging_product: 'whatsapp', to: '971501112222', type: 'text', text: { body: 'Yes, Saturday 10am works.' } } });
  // after 24 hours the platforms only allow replies from their own apps
  const stored = await call.store.get(`leads/studio-layali/${wa.id}`, { type: 'json' });
  stored.lastInboundAt = Date.now() - 25 * 3600e3;
  await call.store.setJSON(`leads/studio-layali/${wa.id}`, stored);
  assert.equal((await call('POST', `leads/${wa.id}/reply`, { text: 'Late' }, token)).status, 409);
});

test('marking a follow-up done or snoozing it takes it off today\'s list', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  const lead = await newLead(call);
  let today = (await call('GET', 'today', null, token)).data.tasks;
  assert.equal(today[0].type, 'reply');
  await call('POST', 'today/done', { type: 'reply', leadId: lead.id }, token);
  today = (await call('GET', 'today', null, token)).data.tasks;
  assert.equal(today.length, 0);
  assert.equal((await call('GET', 'leads', null, token)).data.leads[0].status, 'talking');
  const q = (await call('PATCH', `quotes/${(await call('POST', 'quotes', { leadId: lead.id, items: ITEMS }, token)).data.quote.id}`, { send: true }, token)).data.quote;
  const stored = await call.store.get(`quotes/studio-layali/${q.id}`, { type: 'json' });
  stored.sentAt = Date.now() - 3 * DAY;
  await call.store.setJSON(`quotes/studio-layali/${q.id}`, stored);
  today = (await call('GET', 'today', null, token)).data.tasks;
  assert.equal(today[0].type, 'quote');
  await call('POST', 'today/snooze', { type: 'quote', leadId: lead.id, quoteId: q.id, days: 1 }, token);
  assert.equal((await call('GET', 'today', null, token)).data.tasks.length, 0);
  await call('POST', 'today/done', { type: 'quote', leadId: lead.id, quoteId: 'not-it' }, token).then((r) => assert.equal(r.status, 404));
});

test('the morning reminder goes only to businesses with follow-ups and alerts switched on', async () => {
  const call = setup({ siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(call);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } } }, token);
  await signup(call, { name: 'Quiet Co' });
  const sent = [];
  const notify = async (subs, payload) => { sent.push(payload); return []; };
  assert.equal(await morningDigest(call.store, notify), 0);
  await newLead(call);
  assert.equal(await morningDigest(call.store, notify), 1);
  assert.equal(sent[0].title, '1 follow-up today');
  assert.match(sent[0].body, /Reply to Layla Ahmed/);
});
