// Tests for the phone queue endpoint (netlify/functions/lead-queue.mts): `node --test lead-hunter/test/`
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../netlify/functions/lead-queue.mts';
import { memStore } from './fixtures.mjs';

const KEY = 'k'.repeat(32);

const call = async (store, method, body, key = KEY, secret = KEY) => {
  const req = new Request('https://site.example/api/lead-queue', {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handle(req, store, secret);
  return { status: res.status, data: await res.json() };
};
const item = (id, extra = {}) => ({ id, name: `Biz ${id}`, wa: '971501234567', message: `Hi ${id}`, priority: 70, heat: 'hot', pageUrl: 'https://www.facebook.com/biz/', ...extra });

test('is off until LEAD_QUEUE_KEY is set, and needs the right key', async () => {
  const s = memStore();
  assert.equal((await call(s, 'GET', undefined, KEY, '')).status, 503);
  assert.equal((await call(s, 'GET', undefined, 'short', 'short')).status, 503);
  assert.equal((await call(s, 'GET', undefined, null)).status, 401);
  assert.equal((await call(s, 'GET', undefined, KEY + 'x')).status, 401);
  const ok = await call(s, 'GET');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.items, []);
});

test('PUT adds valid items, rejects invalid ones and sanitises fields', async () => {
  const s = memStore();
  const r = await call(s, 'PUT', {
    items: [
      item('1', { wa: '+971 50 123 4567', pageUrl: 'javascript:alert(1)', heat: 'nuclear' }),
      item('2'),
      { id: 'bad id!', wa: '971501234567', message: 'x' },
      { id: '3', wa: '12', message: 'x' },
      { id: '4', wa: '971501234567', message: '' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.accepted, 2);
  assert.equal(r.data.rejected, 3);
  const one = r.data.items.find((i) => i.id === '1');
  assert.equal(one.wa, '971501234567');
  assert.equal(one.pageUrl, '');
  assert.equal(one.heat, 'cold');
  assert.equal(one.status, 'queued');
});

test('phone updates use the revision so stale taps are ignored', async () => {
  const s = memStore();
  const first = (await call(s, 'PUT', { items: [item('1'), item('2')] })).data.items;
  const rev1 = first.find((i) => i.id === '1').addedAt;
  let r = await call(s, 'POST', { updates: [{ id: '1', status: 'sent', rev: rev1 }, { id: '2', status: 'removed' }, { id: '9', status: 'sent' }, { id: '2', status: 'bogus' }] });
  assert.equal(r.data.items.find((i) => i.id === '1').status, 'sent');
  assert.equal(r.data.items.find((i) => i.id === '2').status, 'removed');

  // Re-push lead 1 (a follow-up): back to "queued" with the new message and a new revision.
  await new Promise((res) => setTimeout(res, 5));
  r = await call(s, 'PUT', { items: [item('1', { message: 'Follow up' })] });
  const again = r.data.items.find((i) => i.id === '1');
  assert.equal(again.status, 'queued');
  assert.equal(again.message, 'Follow up');
  assert.ok(again.addedAt > rev1);
  assert.equal(r.data.items.length, 2, 'no duplicates');

  // An offline phone replaying the old tap must not mark the follow-up as sent.
  r = await call(s, 'POST', { updates: [{ id: '1', status: 'sent', rev: rev1 }] });
  assert.equal(r.data.items.find((i) => i.id === '1').status, 'queued');
});

test('DELETE clears finished items or specific ids', async () => {
  const s = memStore();
  await call(s, 'PUT', { items: [item('1'), item('2'), item('3')] });
  await call(s, 'POST', { updates: [{ id: '1', status: 'sent' }] });
  let r = await call(s, 'DELETE', { finished: true });
  assert.deepEqual(r.data.items.map((i) => i.id).sort(), ['2', '3']);
  r = await call(s, 'DELETE', { ids: ['2'] });
  assert.deepEqual(r.data.items.map((i) => i.id), ['3']);
});

test('concurrent writes from the phone and the extension both land', async () => {
  const s = memStore();
  await call(s, 'PUT', { items: [item('1')] });
  const results = await Promise.all([
    call(s, 'POST', { updates: [{ id: '1', status: 'sent' }] }),
    call(s, 'PUT', { items: [item('2')] }),
    call(s, 'PUT', { items: [item('3')] }),
  ]);
  results.forEach((r) => assert.equal(r.status, 200));
  const final = s.peek().items;
  assert.deepEqual(final.map((i) => i.id).sort(), ['1', '2', '3']);
  assert.equal(final.find((i) => i.id === '1').status, 'sent');
});

test('rejects bad bodies and unknown methods', async () => {
  const s = memStore();
  assert.equal((await call(s, 'PUT', 'not json')).status, 400);
  assert.equal((await call(s, 'PUT', { items: 'x' })).status, 400);
  assert.equal((await call(s, 'POST', [])).status, 400);
  assert.equal((await call(s, 'PUT', { items: [item('1', { message: 'x'.repeat(2_000_000) })] })).status, 400);
  assert.equal((await call(s, 'PATCH', {})).status, 405);
});

test('keeps at most 400 items, dropping the oldest finished ones first', async () => {
  const s = memStore();
  await call(s, 'PUT', { items: Array.from({ length: 300 }, (_, i) => item(`a${i}`)) });
  await call(s, 'POST', { updates: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, status: 'sent' })) });
  const r = await call(s, 'PUT', { items: Array.from({ length: 150 }, (_, i) => item(`b${i}`)) });
  assert.equal(r.data.items.length, 400);
  assert.ok(!r.data.items.some((i) => i.id === 'a0'), 'oldest sent item dropped');
  assert.ok(r.data.items.some((i) => i.id === 'a299'));
  assert.ok(r.data.items.some((i) => i.id === 'b149'));
});
