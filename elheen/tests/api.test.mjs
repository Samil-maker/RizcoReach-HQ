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
  const h = makeHandler(store, { ELHEEN_INVITE: 'letmein', ...extra });
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
const signup = (call, extra = {}) => call('POST', 'signup', { invite: 'letmein', name: 'Studio Layali', kind: 'interior', password: 'longenough', ...extra });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('sign-up needs the invite code and a real password', async () => {
  const call = setup();
  assert.equal((await signup(call, { invite: 'wrong' })).status, 403);
  assert.equal((await signup(call, { password: 'short' })).status, 400);
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

test('the owner can move an enquiry through the pipeline and set a time', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567' });
  const { data: { leads: [lead] } } = await call('GET', 'leads', null, token);
  const moved = await call('PATCH', `leads/${lead.id}`, { status: 'talking' }, token);
  assert.equal(moved.data.lead.status, 'talking');
  const timed = await call('PATCH', `leads/${lead.id}`, { when: '2030-02-01T09:00:00Z' }, token);
  assert.equal(timed.data.lead.when, '2030-02-01T09:00:00.000Z');
  assert.equal((await call('PATCH', `leads/${lead.id}`, { status: 'nonsense' }, token)).data.lead.status, 'talking');
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

test('the assistant only answers when a key exists and the owner switched it on', async () => {
  const seen = [];
  const call = setup({ ask: async (system, messages) => { seen.push({ system, messages }); return 'We are open until 7.'; } });
  const { data: { token } } = await signup(call);
  const say = () => call('POST', 'public/studio-layali/chat', { messages: [{ role: 'user', content: 'When do you close?' }] });
  assert.equal((await say()).status, 404);
  assert.equal((await call('GET', 'public/studio-layali')).data.chat, false);
  await call('PUT', 'me', { aiOn: true, aiNotes: 'Parking is free.' }, token);
  const ok = await say();
  assert.equal(ok.data.reply, 'We are open until 7.');
  assert.match(seen[0].system, /Studio Layali/);
  assert.match(seen[0].system, /Parking is free/);
  assert.equal((await setup()('POST', 'public/studio-layali/chat', { messages: [] })).status, 404);
});

test('the chat is saved with the enquiry so the owner can read it', async () => {
  const call = setup();
  const { data: { token } } = await signup(call);
  await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567', chat: [{ role: 'user', content: 'Do you do villas?' }, { role: 'assistant', content: 'Yes we do.' }] });
  assert.equal((await call('GET', 'leads', null, token)).data.leads[0].chat.length, 2);
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
  assert.deepEqual(business.meta.pages, [{ id: '111', name: 'Layali Page', live: true }]);
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

// --- card deposits through each business's own Ziina account
function fakeZiina({ rejectToken = false } = {}) {
  const calls = [];
  const intents = {};
  const ziina = async (token, path, { method = 'GET', body } = {}) => {
    calls.push({ token, path, method, body });
    if (rejectToken) throw new Error('Unauthorized');
    if (path === 'payment_intent' && method === 'POST') {
      const id = `pi_${calls.length}`;
      intents[id] = { id, status: 'requires_payment_instrument', redirect_url: `https://pay.ziina.test/${id}` };
      return intents[id];
    }
    if (path === 'webhook') return { success: true };
    if (path.startsWith('payment_intent/')) return intents[path.split('/')[1]];
    throw new Error(`unexpected ${path}`);
  };
  return { ziina, calls, intents };
}
async function depositBusiness(call) {
  const { data: { token } } = await signup(call);
  const saved = await call('PUT', 'me', { ziinaToken: 'ZIINA-TOKEN', depositMode: 'percent', depositValue: 20, ziinaTest: true }, token);
  const page = await call('GET', 'public/studio-layali');
  const paid = page.data.business.services.find((s) => s.price > 0);
  const free = page.data.business.services.find((s) => !s.price);
  return { token, saved, page, paid, free };
}

test('connecting Ziina checks the token and never shows it back', async () => {
  const z = fakeZiina();
  const call = setup({ ziina: z.ziina, siteUrl: 'https://x.test' });
  const { saved, page } = await depositBusiness(call);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.business.ziina, { connected: true, test: true, webhook: true });
  assert.ok(!JSON.stringify(saved.data).includes('ZIINA-TOKEN'));
  assert.deepEqual(page.data.business.deposit, { mode: 'percent', value: 20 });
  assert.ok(z.calls.some((c) => c.path === 'webhook' && c.body.url === 'https://x.test/api/ziina/webhook/studio-layali'));
  const bad = setup({ ziina: fakeZiina({ rejectToken: true }).ziina, siteUrl: 'https://x.test' });
  const { data: { token } } = await signup(bad);
  assert.equal((await bad('PUT', 'me', { ziinaToken: 'nope' }, token)).status, 400);
});

test('booking a paid service asks for a deposit and holds the time', async () => {
  const z = fakeZiina();
  const call = setup({ ziina: z.ziina, siteUrl: 'https://x.test' });
  const { token, paid } = await depositBusiness(call);
  const when = '2030-03-01T10:00:00.000Z';
  const res = await call('POST', 'public/studio-layali/lead', { name: 'Layla', phone: '0501234567', serviceId: paid.id, when });
  assert.equal(res.data.deposit, Math.round(paid.price * 0.2));
  assert.match(res.data.payUrl, /^https:\/\/pay\.ziina\.test\//);
  const intentCall = z.calls.filter((c) => c.path === 'payment_intent' && c.method === 'POST').pop();
  assert.equal(intentCall.body.amount, Math.round(paid.price * 0.2) * 100);
  assert.equal(intentCall.body.currency_code, 'AED');
  assert.equal(intentCall.body.test, true);
  assert.match(intentCall.body.success_url, /\/b\/studio-layali\?paid=/);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'B', phone: '0507654321', when })).status, 409);
  const { data: { leads } } = await call('GET', 'leads', null, token);
  assert.equal(leads[0].deposit.status, 'pending');
  assert.ok(!('url' in leads[0].deposit) || leads[0].deposit.url);
});

test('a free service or an enquiry without a time takes no deposit', async () => {
  const call = setup({ ziina: fakeZiina().ziina, siteUrl: 'https://x.test' });
  const { paid, free } = await depositBusiness(call);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567', serviceId: free.id, when: '2030-03-02T10:00:00Z' })).data.payUrl, null);
  assert.equal((await call('POST', 'public/studio-layali/lead', { name: 'A', phone: '0501234567', serviceId: paid.id })).data.payUrl, null);
});

test('the Ziina webhook marks the deposit paid only with the right signature', async () => {
  const z = fakeZiina();
  const sent = [];
  const call = setup({ ziina: z.ziina, siteUrl: 'https://x.test', notify: async (subs, payload) => { sent.push(payload); return []; } });
  const { token, paid } = await depositBusiness(call);
  await call('POST', 'push', { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } } }, token);
  const res = await call('POST', 'public/studio-layali/lead', { name: 'Layla', phone: '0501234567', serviceId: paid.id, when: '2030-03-03T10:00:00Z' });
  const intentId = new URL(res.data.payUrl).pathname.slice(1);
  const payload = { event: 'payment_intent.status.updated', data: { id: intentId, status: 'completed' } };
  assert.equal((await call('POST', 'ziina/webhook/studio-layali', payload, null, { 'x-hmac-signature': 'nope' })).status, 403);
  assert.equal((await call('POST', 'ziina/webhook/studio-layali', payload, null, { 'x-nf-client-connection-ip': '1.2.3.4' })).status, 403);
  assert.equal((await call('GET', 'leads', null, token)).data.leads[0].deposit.status, 'pending');
  const { ziina: { secret } } = await call.store.get('biz/studio-layali', { type: 'json' });
  const sig = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await call('POST', 'ziina/webhook/studio-layali', payload, null, { 'x-hmac-signature': sig, 'x-nf-client-connection-ip': '3.29.184.186' })).status, 200);
  const lead = (await call('GET', 'leads', null, token)).data.leads[0];
  assert.equal(lead.deposit.status, 'paid');
  assert.ok(sent.some((p) => /Deposit paid: Layla/.test(p.title)));
});

test('coming back from Ziina checks the payment directly', async () => {
  const z = fakeZiina();
  const call = setup({ ziina: z.ziina, siteUrl: 'https://x.test' });
  const { token, paid } = await depositBusiness(call);
  const res = await call('POST', 'public/studio-layali/lead', { name: 'Layla', phone: '0501234567', serviceId: paid.id, when: '2030-03-04T10:00:00Z' });
  const intentId = new URL(res.data.payUrl).pathname.slice(1);
  const waiting = await call('GET', `public/studio-layali/deposit/${res.data.id}`);
  assert.equal(waiting.data.status, 'pending');
  assert.ok(waiting.data.payUrl);
  z.intents[intentId].status = 'completed';
  const done = await call('GET', `public/studio-layali/deposit/${res.data.id}`);
  assert.equal(done.data.status, 'paid');
  assert.equal(done.data.payUrl, null);
  assert.equal((await call('GET', 'leads', null, token)).data.leads[0].deposit.status, 'paid');
});
