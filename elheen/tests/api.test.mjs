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
  };
}
const setup = (extra = {}) => {
  const h = makeHandler(memoryStore(), { ELHEEN_INVITE: 'letmein', ...extra });
  const call = async (method, path, body, token) => {
    const res = await h(new Request(`https://x.test/api/${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer(), type };
  };
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
