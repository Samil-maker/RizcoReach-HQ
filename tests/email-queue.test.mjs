// Tests for the email queue endpoint (netlify/functions/email-queue.mts): `node --test tests/email-queue.test.mjs`
// Every rule runs against a controllable clock. Times are written in Dubai time (UTC+4, no daylight saving).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, addBusinessDays, capFor, dubaiDay, nextDubaiMidnight, DEFAULT_SETTINGS } from '../netlify/functions/email-queue.mts';
import { memStore } from '../lead-hunter/test/fixtures.mjs';

const KEY = 'k'.repeat(32);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GAP = 10 * MIN;
const at = (s) => Date.parse(s.replace(' ', 'T') + ':00+04:00');
const MON = at('2026-10-19 10:00'); // a Monday, inside the sending window
const WEEKDAYS = [1, 2, 3, 4, 5];

const email = (id, extra = {}) => ({
  id,
  email: `${id}@biz.example`,
  business: `Biz ${id}`,
  script: 'website',
  subject: `Website for Biz ${id}`,
  steps: [`Hello Biz ${id}`, `Follow up 1 for ${id}`, `Follow up 2 for ${id}`],
  ...extra,
});

/** A stored item, for seeding the blob directly. */
const stored = (id, extra = {}) => ({
  id,
  email: `${id}@biz.example`,
  business: `Biz ${id}`,
  script: 'website',
  fromName: 'Samil',
  subject: 'Hi',
  steps: ['one', 'two'],
  followupDays: [3, 4],
  status: 'active',
  sent: 1,
  sentAt: [MON - DAY],
  nextAt: MON + DAY,
  threadId: `t-${id}`,
  messageId: `<m-${id}@mail.gmail.com>`,
  lease: null,
  attempts: 0,
  error: '',
  addedAt: MON - 2 * DAY,
  statusAt: MON - DAY,
  ...extra,
});

function setup(now = MON) {
  const store = memStore();
  const clock = { now };
  const api = async (method, body, { key = KEY, secret = KEY } = {}) => {
    const res = await handle(
      new Request('https://site.example/api/email-queue', {
        method,
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      store,
      secret,
      () => clock.now,
    );
    return { status: res.status, headers: res.headers, data: await res.json() };
  };
  const post = async (action, extra = {}) => (await api('POST', { action, ...extra })).data;
  const t = {
    store,
    clock,
    api,
    post,
    seed: (state) => store.setJSON('state', state),
    get: async () => (await api('GET')).data,
    put: async (...items) => (await api('PUT', { items })).data,
    item: async (id) => (await t.get()).items.find((x) => x.id === id),
    claim: () => post('claim'),
    report: (job, extra = {}) => post('report', { id: job.id, step: job.step, ok: true, threadId: `t-${job.id}`, messageId: `<m-${job.id}@mail.gmail.com>`, ...extra }),
    fail: (job, extra = {}) => post('report', { id: job.id, step: job.step, ok: false, error: 'Something went wrong', ...extra }),
    /** Claims the next email, reports it sent and waits out the gap. */
    send: async () => {
      const { job, reason } = await t.claim();
      assert.ok(job, `expected a job, got ${reason}`);
      assert.deepEqual(await t.report(job), { ok: true });
      clock.now += GAP;
      return job;
    },
  };
  return t;
}

/* ------------------------------------------------------------------ auth and basics */

test('is off until LEAD_QUEUE_KEY is set, and needs the right key', async () => {
  const t = setup();
  const unset = await handle(new Request('https://site.example/api/email-queue', { headers: { authorization: `Bearer ${KEY}` } }), t.store, undefined);
  assert.equal(unset.status, 503);
  let r = await t.api('GET', undefined, { secret: '' });
  assert.equal(r.status, 503);
  assert.deepEqual(r.data, { error: 'not_configured' });
  assert.equal((await t.api('GET', undefined, { key: 'short', secret: 'short' })).status, 503);
  r = await t.api('GET', undefined, { key: null });
  assert.equal(r.status, 401);
  assert.deepEqual(r.data, { error: 'unauthorized' });
  assert.equal((await t.api('GET', undefined, { key: KEY + 'x' })).status, 401);
  assert.equal((await t.api('POST', { action: 'claim' }, { key: 'k'.repeat(31) })).status, 401);
  assert.equal(t.store.peek(), null, 'a refused claim writes nothing');

  r = await t.api('GET');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.deepEqual(r.data, {
    items: [],
    settings: DEFAULT_SETTINGS,
    stats: { today: 0, cap: 5, queued: 0, active: 0, done: 0, replied: 0, bounced: 0, optout: 0, failed: 0, cancelled: 0 },
    never: 0,
    pausedReason: '',
    pausedUntil: 0,
    firstSendDay: '',
    senderSeenAt: 0,
    now: MON,
  });
  assert.deepEqual(DEFAULT_SETTINGS, { paused: false, maxPerDay: 30, days: WEEKDAYS, startHour: 9, endHour: 18, gapMinutes: 10 });
});

test('bad bodies get 400 and unknown actions or methods get 405', async () => {
  const t = setup();
  const bad = { error: 'invalid_body' };
  for (const [method, body] of [
    ['POST', '{nope'],
    ['POST', '[1,2]'],
    ['POST', '"claim"'],
    ['PUT', { items: 'x' }],
    ['PUT', {}],
    ['POST', { action: 'cancel' }],
    ['POST', { action: 'never', emails: 'a@b.example' }],
    ['POST', { action: 'settings', settings: 'x' }],
    ['POST', { action: 'report', step: 0, ok: true }],
    ['POST', { action: 'report', id: 'a', ok: true }],
    ['POST', { action: 'events', events: {} }],
  ]) {
    const r = await t.api(method, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.data, bad);
  }
  assert.equal((await t.api('POST', 'x'.repeat(1_600_000))).status, 400, 'body limit');
  for (const [method, body] of [['POST', { action: 'explode' }], ['POST', {}], ['DELETE', {}], ['PATCH', {}]]) {
    const r = await t.api(method, body);
    assert.equal(r.status, 405, `${method} ${JSON.stringify(body)}`);
    assert.deepEqual(r.data, { error: 'method_not_allowed' });
  }
});

test('gives up with 409 when the blob keeps changing underneath', async () => {
  const store = memStore();
  const busy = { getWithMetadata: store.getWithMetadata, setJSON: async () => ({ modified: false }) };
  const res = await handle(new Request('https://site.example/api/email-queue', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: '{"action":"claim"}' }), busy, KEY, () => MON);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'conflict' });
});

/* ------------------------------------------------------------------ adding, stopping, never list, settings */

test('PUT validates and cleans each email', async () => {
  const t = setup();
  const r = await t.put(
    email('a', { email: '  Owner@Biz.Example ', script: 'bogus', subject: 'Website\nfor  Biz', status: 'done', sent: 2, lease: { until: 1, step: 0 }, threadId: 'x' }),
    email('b', { script: 'ads', fromName: 'Samil K', steps: ['  Only one  '], followupDays: [0, 99, 5] }),
    email('bad id!'),
    email('x'.repeat(81)),
    email('c', { email: 'not an email' }),
    email('d', { email: 'one@biz.example, two@biz.example' }),
    email('e', { email: `${'x'.repeat(250)}@b.example` }),
    email('f', { subject: '  ' }),
    email('g', { steps: [] }),
    email('h', { steps: ['1', '2', '3', '4'] }),
    email('i', { steps: ['Hello', ''] }),
    email('j', { steps: ['Hello', 42] }),
    email('k', { steps: ['x'.repeat(6001)] }),
    email('l', { steps: 'Hello' }),
    'nope',
    null,
  );
  assert.equal(r.accepted, 2);
  assert.deepEqual(
    r.rejected,
    ['bad id!', 'x'.repeat(80), 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', '', ''].map((id) => ({ id, reason: 'invalid' })),
  );
  const [a, b] = r.items;
  assert.deepEqual(a, {
    id: 'a',
    email: 'owner@biz.example',
    business: 'Biz a',
    script: 'website',
    fromName: 'Samil',
    subject: 'Website for Biz',
    steps: ['Hello Biz a', 'Follow up 1 for a', 'Follow up 2 for a'],
    followupDays: [3, 4],
    status: 'queued',
    sent: 0,
    sentAt: [],
    nextAt: 0,
    threadId: '',
    messageId: '',
    lease: null,
    attempts: 0,
    error: '',
    addedAt: MON,
    statusAt: MON,
  });
  assert.equal(b.script, 'ads');
  assert.equal(b.fromName, 'Samil K');
  assert.deepEqual(b.steps, ['Only one']);
  assert.deepEqual(b.followupDays, [3, 30], 'clamped to 1..30, only as many as follow ups');
  assert.equal(r.stats.queued, 2);
  assert.equal(email('k', { steps: ['x'.repeat(6000)] }).steps[0].length, 6000);
  assert.equal((await t.put(email('k', { steps: ['x'.repeat(6000)] }))).accepted, 1, '6000 characters is fine');
});

test('PUT refuses the never list, duplicates and anything already sent, and replaces unsent items', async () => {
  const t = setup();
  await t.put(email('a'), email('b'));
  await t.post('never', { emails: ['C@biz.example'] });

  t.clock.now += MIN;
  let r = await t.put(email('a', { subject: 'New subject' }), email('c'), email('d', { email: 'b@biz.example' }));
  assert.equal(r.accepted, 1);
  assert.deepEqual(r.rejected, [{ id: 'c', reason: 'never' }, { id: 'd', reason: 'duplicate' }]);
  assert.deepEqual(r.items.map((x) => x.id), ['b', 'a'], 'replaced, not duplicated');
  assert.equal(r.items[1].subject, 'New subject');
  assert.equal(r.items[1].addedAt, MON + MIN);

  // Same email twice in one push: the second is a duplicate.
  r = await t.put(email('e'), email('f', { email: 'e@biz.example' }));
  assert.deepEqual(r.rejected, [{ id: 'f', reason: 'duplicate' }]);

  // Once the first email went out the id can never be pushed again.
  t.clock.now += GAP;
  const job = await t.send();
  assert.equal(job.id, 'b', 'oldest first');
  r = await t.put(email('b', { subject: 'Again' }));
  assert.deepEqual(r.rejected, [{ id: 'b', reason: 'already_sent' }]);
  assert.equal((await t.item('b')).subject, 'Website for Biz b');

  // A stopped item that never went out can be added again, and does not block its address.
  await t.post('cancel', { ids: ['a'] });
  r = await t.put(email('a', { subject: 'Back' }));
  assert.equal(r.accepted, 1);
  let a = await t.item('a');
  assert.equal(a.status, 'queued');
  assert.equal(a.subject, 'Back');
  assert.equal(a.steps.length, 3);
  await t.post('cancel', { ids: ['a'] });
  r = await t.put(email('g', { email: 'a@biz.example' }));
  assert.equal(r.accepted, 1);

  // A stopped item that did go out still blocks its address and its id.
  await t.post('cancel', { ids: ['b'] });
  assert.equal((await t.item('b')).status, 'cancelled');
  r = await t.put(email('h', { email: 'b@biz.example' }), email('b'));
  assert.deepEqual(r.rejected, [{ id: 'h', reason: 'duplicate' }, { id: 'b', reason: 'already_sent' }]);
});

test('re-adding an item that is being sent keeps the claim, so it can not go out twice', async () => {
  const t = setup();
  await t.put(email('a'));
  const { job } = await t.claim();
  await t.put(email('a', { subject: 'Edited' }));
  t.clock.now += GAP;
  assert.deepEqual(await t.claim(), { job: null, reason: 'nothing_due' }, 'still claimed');
  t.clock.now += 15 * MIN;
  const again = (await t.claim()).job;
  assert.equal(again.id, 'a');
  assert.equal(again.verify, true, 'the sender checks Sent first');
  assert.equal(job.verify, false);
});

test('cancel stops queued and active items only', async () => {
  const t = setup();
  await t.put(email('q'), email('act'), email('done', { steps: ['Only'] }));
  await t.seed({
    items: [stored('q', { status: 'queued', sent: 0, sentAt: [] }), stored('act'), stored('done', { status: 'done', steps: [] }), stored('rep', { status: 'replied', steps: [] })],
  });
  const r = await t.post('cancel', { ids: ['q', 'act', 'done', 'rep', 'nope', 42] });
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by.q.status, 'cancelled');
  assert.equal(by.act.status, 'cancelled');
  assert.deepEqual(by.act.steps, [], 'bodies dropped once finished');
  assert.equal(by.act.statusAt, MON);
  assert.equal(by.done.status, 'done');
  assert.equal(by.rep.status, 'replied');
  assert.equal(by.rep.statusAt, MON - DAY, 'others untouched');
  assert.equal(r.stats.cancelled, 2);
  assert.deepEqual(await t.claim(), { job: null, reason: 'nothing_due' });
});

test('the never list adds and removes emails and stops matching items', async () => {
  const t = setup();
  await t.put(email('a'), email('b'), email('c'));
  await t.send();
  let r = await t.post('never', { emails: [' A@BIZ.example', 'b@biz.example', 'b@biz.example', 'not an email', 7, 'z@biz.example'] });
  assert.equal(r.never, 3);
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by.a.status, 'optout', 'active one stopped');
  assert.equal(by.b.status, 'optout', 'queued one stopped');
  assert.deepEqual(by.b.steps, []);
  assert.equal(by.c.status, 'queued');
  assert.deepEqual(t.store.peek().never, ['a@biz.example', 'b@biz.example', 'z@biz.example']);

  assert.deepEqual((await t.put(email('z'))).rejected, [{ id: 'z', reason: 'never' }]);
  r = await t.post('never', { emails: ['Z@biz.example'], remove: true });
  assert.equal(r.never, 2);
  assert.equal(r.items.find((x) => x.id === 'a').status, 'optout', 'removing does not restart anything');
  assert.equal((await t.put(email('z'))).accepted, 1);
});

test('settings are validated and merged', async () => {
  const t = setup();
  const set = async (settings) => (await t.post('settings', { settings })).settings;
  assert.deepEqual(await set({ maxPerDay: 100, gapMinutes: 1, foo: 'bar' }), { ...DEFAULT_SETTINGS, maxPerDay: 40, gapMinutes: 5 });
  assert.equal((await set({ maxPerDay: 0 })).maxPerDay, 1);
  assert.equal((await set({ maxPerDay: 7.6, gapMinutes: 500 })).maxPerDay, 8);
  assert.equal((await set({})).gapMinutes, 120);
  assert.equal((await set({ maxPerDay: '20', gapMinutes: null })).maxPerDay, 8, 'not a number: ignored');

  assert.deepEqual((await set({ days: [5, 1, 1, 9, -1, 'x', 2.5] })).days, [1, 5]);
  assert.deepEqual((await set({ days: [] })).days, [1, 5], 'can not be empty');
  assert.deepEqual((await set({ days: [7, 8] })).days, [1, 5]);
  assert.deepEqual((await set({ days: 'all' })).days, [1, 5]);

  let s = await set({ startHour: 10, endHour: 16 });
  assert.deepEqual([s.startHour, s.endHour], [10, 16]);
  s = await set({ startHour: 17 });
  assert.deepEqual([s.startHour, s.endHour], [10, 16], 'start must be before end');
  s = await set({ endHour: 25 });
  assert.deepEqual([s.startHour, s.endHour], [10, 16]);
  s = await set({ startHour: -1, endHour: 12 });
  assert.deepEqual([s.startHour, s.endHour], [10, 16]);
  s = await set({ startHour: 9.5 });
  assert.deepEqual([s.startHour, s.endHour], [10, 16]);
  s = await set({ startHour: 0, endHour: 24 });
  assert.deepEqual([s.startHour, s.endHour], [0, 24]);
  assert.equal('foo' in s, false);

  let r = await t.post('settings', { settings: { paused: true } });
  assert.equal(r.settings.paused, true);
  assert.equal(r.pausedReason, 'manual');
  r = await t.post('settings', { settings: { paused: 'yes' } });
  assert.equal(r.settings.paused, true);
  r = await t.post('settings', { settings: { paused: false } });
  assert.equal(r.settings.paused, false);
  assert.equal(r.pausedReason, '');
  assert.equal(r.pausedUntil, 0);
});

/* ------------------------------------------------------------------ claiming */

test('claim checks paused, the sending window in Dubai time, the daily cap and the gap, in that order', async () => {
  const t = setup();
  const reason = async () => (await t.claim()).reason;
  assert.equal(await reason(), 'nothing_due');
  assert.equal((await t.get()).senderSeenAt, MON, 'every claim marks the sender as seen');

  // Paused beats everything, even outside the window.
  await t.post('settings', { settings: { paused: true } });
  t.clock.now = at('2026-10-24 10:00'); // Saturday
  assert.equal(await reason(), 'paused');
  assert.equal((await t.get()).senderSeenAt, t.clock.now);
  await t.post('settings', { settings: { paused: false } });

  // The window: Monday to Friday, 9 to 6, Dubai time.
  const window = {
    '2026-10-24 10:00': 'outside_hours', // Saturday
    '2026-10-25 10:00': 'outside_hours', // Sunday
    '2026-10-19 08:59': 'outside_hours',
    '2026-10-19 09:00': 'nothing_due', // 05:00 in UTC
    '2026-10-19 17:59': 'nothing_due',
    '2026-10-19 18:00': 'outside_hours',
    '2026-10-23 12:00': 'nothing_due', // Friday
  };
  for (const [time, want] of Object.entries(window)) {
    t.clock.now = at(time);
    assert.equal(await reason(), want, time);
  }
  // The weekday is the Dubai one: Tuesday 01:00 in Dubai is still Monday in UTC.
  await t.post('settings', { settings: { days: [2], startHour: 0, endHour: 24 } });
  t.clock.now = at('2026-10-20 01:00');
  assert.equal(await reason(), 'nothing_due');
  t.clock.now = at('2026-10-19 23:00');
  assert.equal(await reason(), 'outside_hours');

  // The window beats the cap, the cap beats the gap, the gap beats nothing to send.
  const day = { sentByDay: { '2026-10-19': 5 }, lastSendAt: MON - MIN, firstSendDay: '2026-10-19' };
  await t.seed({ items: [stored('q', { status: 'queued', sent: 0, sentAt: [] })], ...day });
  t.clock.now = at('2026-10-24 10:00');
  assert.equal(await reason(), 'outside_hours');
  t.clock.now = MON;
  assert.equal(await reason(), 'daily_cap');
  await t.seed({ items: [], ...day, sentByDay: { '2026-10-19': 4 } });
  assert.equal(await reason(), 'spacing');
  t.clock.now = MON - MIN + GAP;
  assert.equal(await reason(), 'nothing_due');
  await t.post('settings', { settings: { gapMinutes: 30 } });
  assert.equal(await reason(), 'spacing', 'the gap follows the setting');
});

test('the daily cap ramps up 5, 10, 20, then follows the daily limit', async () => {
  const first = '2026-10-01';
  assert.equal(capFor(30, '', MON), 5, 'no send yet counts as day 0');
  assert.equal(capFor(30, first, at('2026-10-01 10:00')), 5);
  assert.equal(capFor(30, first, at('2026-10-07 23:59')), 5, 'day 6');
  assert.equal(capFor(30, first, at('2026-10-08 00:00')), 10, 'day 7 starts at midnight in Dubai');
  assert.equal(capFor(30, first, at('2026-10-14 18:00')), 10, 'day 13');
  assert.equal(capFor(30, first, at('2026-10-15 09:00')), 20, 'day 14');
  assert.equal(capFor(30, first, at('2026-10-21 09:00')), 20, 'day 20');
  assert.equal(capFor(30, first, at('2026-10-22 09:00')), 30, 'day 21: the daily limit decides');
  assert.equal(capFor(40, first, at('2026-12-01 09:00')), 40);
  assert.equal(capFor(3, first, at('2026-10-01 09:00')), 3, 'a lower limit always wins');
  assert.equal(capFor(8, first, at('2026-10-09 09:00')), 8);

  // Through the API: 5 on the first day, then the cap stops it until tomorrow.
  const t = setup();
  await t.put(...'abcdefg'.split('').map((id) => email(id)));
  for (let i = 0; i < 5; i++) await t.send();
  assert.equal((await t.claim()).reason, 'daily_cap');
  let g = await t.get();
  assert.deepEqual([g.stats.today, g.stats.cap, g.firstSendDay], [5, 5, '2026-10-19']);
  t.clock.now = at('2026-10-20 09:00');
  assert.equal((await t.claim()).job.id, 'f');
  g = await t.get();
  assert.deepEqual([g.stats.today, g.stats.cap], [0, 5]);

  // A week later the cap is 10, three weeks later the daily limit.
  await t.seed({ ...t.store.peek(), firstSendDay: '2026-10-13' });
  assert.equal((await t.get()).stats.cap, 10);
  await t.seed({ ...t.store.peek(), firstSendDay: '2026-09-01' });
  assert.equal((await t.get()).stats.cap, 30);
  await t.post('settings', { settings: { maxPerDay: 12 } });
  assert.equal((await t.get()).stats.cap, 12);
});

test('claim picks an unreported claim first, then a due follow up, then the oldest new email', async () => {
  const t = setup();
  await t.put(email('a'));
  t.clock.now += MIN;
  await t.put(email('b'));
  t.clock.now += MIN;
  await t.put(email('c'));

  t.clock.now = at('2026-10-19 10:12');
  let { job } = await t.claim();
  assert.deepEqual(job, {
    id: 'a',
    step: 0,
    to: 'a@biz.example',
    fromName: 'Samil',
    subject: 'Website for Biz a',
    body: 'Hello Biz a',
    threadId: '',
    messageId: '',
    verify: false,
  });
  assert.deepEqual((await t.item('a')).lease, { until: at('2026-10-19 10:27'), step: 0 });
  await t.report(job);

  // b is claimed but the sender never reports (it may have crashed after sending).
  t.clock.now = at('2026-10-19 10:22');
  assert.equal((await t.claim()).job.id, 'b');
  // While b's claim runs it is skipped.
  t.clock.now = at('2026-10-19 10:32');
  job = (await t.claim()).job;
  assert.equal(job.id, 'c');
  await t.report(job);

  // Thursday: a and c have a follow up due, b's claim ran out long ago and d is new.
  t.clock.now = at('2026-10-22 10:40');
  await t.put(email('d'));
  job = (await t.claim()).job;
  assert.deepEqual([job.id, job.step, job.verify], ['b', 0, true], 'the unreported one comes first and is checked in Sent');
  await t.report(job);

  t.clock.now += GAP;
  job = (await t.claim()).job;
  assert.deepEqual(job, {
    id: 'a',
    step: 1,
    to: 'a@biz.example',
    fromName: 'Samil',
    subject: 'Website for Biz a',
    body: 'Follow up 1 for a',
    threadId: 't-a',
    messageId: '<m-a@mail.gmail.com>',
    verify: false,
  });
  await t.report(job);
  t.clock.now += GAP;
  job = (await t.claim()).job;
  assert.deepEqual([job.id, job.step], ['c', 1]);
  await t.report(job);
  t.clock.now += GAP;
  job = (await t.claim()).job;
  assert.deepEqual([job.id, job.step], ['d', 0]);
  t.clock.now += GAP;
  assert.deepEqual(await t.claim(), { job: null, reason: 'nothing_due' }, 'd is claimed, the rest wait for their follow up day');
});

test('two claims at the same moment never hand out two jobs', async () => {
  const t = setup();
  await t.put(email('a'), email('b'));
  const [x, y] = await Promise.all([t.claim(), t.claim()]);
  assert.deepEqual([x, y].map((r) => r.job?.id || r.reason).sort(), ['a', 'spacing']);
});

/* ------------------------------------------------------------------ reports */

test('follow ups are scheduled on sending days, skipping the weekend', async () => {
  assert.equal(addBusinessDays(at('2026-10-22 17:30'), 3, WEEKDAYS), at('2026-10-27 17:30'), 'Thursday + 3 is Tuesday');
  assert.equal(addBusinessDays(at('2026-10-23 10:00'), 1, WEEKDAYS), at('2026-10-26 10:00'), 'Friday + 1 is Monday');
  assert.equal(addBusinessDays(at('2026-10-24 10:00'), 1, WEEKDAYS), at('2026-10-26 10:00'), 'Saturday + 1 is Monday');
  assert.equal(addBusinessDays(at('2026-10-22 10:00'), 1, [0, 1, 2, 3, 4]), at('2026-10-25 10:00'), 'Sunday to Thursday week');
  assert.equal(addBusinessDays(MON, 0, WEEKDAYS), MON);
  assert.equal(dubaiDay(at('2026-10-20 01:00')), '2026-10-20');
  assert.equal(nextDubaiMidnight(at('2026-10-19 23:59')), at('2026-10-20 00:00'));
  assert.equal(nextDubaiMidnight(at('2026-10-20 00:00')), at('2026-10-21 00:00'));

  const t = setup(at('2026-10-22 10:00')); // Thursday
  await t.put(email('a', { followupDays: [3, 4] }));
  await t.send();
  let a = await t.item('a');
  assert.equal(a.status, 'active');
  assert.equal(a.sent, 1);
  assert.deepEqual(a.sentAt, [at('2026-10-22 10:00')]);
  assert.equal(a.nextAt, at('2026-10-27 10:00'));
  assert.deepEqual([a.threadId, a.messageId, a.lease], ['t-a', '<m-a@mail.gmail.com>', null]);
  assert.equal(a.steps.length, 3);

  t.clock.now = at('2026-10-27 09:59');
  assert.equal((await t.claim()).reason, 'nothing_due');
  t.clock.now = at('2026-10-27 10:00');
  let { job } = await t.claim();
  assert.equal(job.step, 1);
  await t.report(job, { threadId: 'other', messageId: '<other@x>' });
  a = await t.item('a');
  assert.deepEqual([a.threadId, a.messageId], ['t-a', '<m-a@mail.gmail.com>'], 'the first email keeps the thread');
  assert.equal(a.nextAt, at('2026-11-02 10:00'), 'Tuesday + 4 is Monday');

  t.clock.now = at('2026-11-02 10:00');
  job = (await t.claim()).job;
  assert.deepEqual([job.step, job.body], [2, 'Follow up 2 for a']);
  await t.report(job);
  a = await t.item('a');
  assert.equal(a.status, 'done');
  assert.equal(a.sent, 3);
  assert.equal(a.sentAt.length, 3);
  assert.deepEqual(a.steps, [], 'bodies dropped once done');
  assert.equal(a.statusAt, at('2026-11-02 10:00'));

  // A missing gap falls back to 3 sending days. One step means done straight away.
  await t.put(email('b', { followupDays: [2] }), email('c', { steps: ['Only'] }));
  t.clock.now += GAP;
  await t.send();
  t.clock.now += GAP;
  await t.send();
  assert.equal((await t.item('b')).nextAt, at('2026-11-04 10:10'));
  assert.equal((await t.item('c')).status, 'done');
});

test('duplicate and old reports are ignored', async () => {
  const t = setup();
  await t.put(email('a'));
  const { job } = await t.claim();
  assert.deepEqual(await t.report(job), { ok: true });
  assert.deepEqual(await t.report(job), { ok: true, ignored: true });
  assert.deepEqual(await t.fail(job), { ok: true, ignored: true });
  assert.deepEqual(await t.report({ id: 'nope', step: 0 }), { ok: true, ignored: true });
  assert.deepEqual(await t.report({ id: 'a', step: 2 }), { ok: true, ignored: true });
  const g = await t.get();
  assert.equal(g.stats.today, 1, 'counted once');
  assert.deepEqual([g.items[0].sent, g.items[0].attempts, g.items[0].error], [1, 0, '']);

  // A finished item ignores reports.
  await t.seed({ items: [stored('d', { status: 'done', sent: 2, steps: [] })] });
  assert.deepEqual(await t.report({ id: 'd', step: 2 }), { ok: true, ignored: true });
});

test('ids from Gmail are cleaned before the sender puts them in headers', async () => {
  const t = setup();
  await t.put(email('a'));
  const { job } = await t.claim();
  await t.report(job, { threadId: '18a2b<script>', messageId: '<abc@mail.gmail.com>\r\nBcc: x@evil.example' });
  const a = await t.item('a');
  assert.equal(a.threadId, '18a2bscript');
  assert.equal(a.messageId.includes('\n'), false);
});

test('an email that went out while being stopped is still recorded', async () => {
  const t = setup();
  await t.put(email('a'));
  const { job } = await t.claim();
  await t.post('cancel', { ids: ['a'] });
  assert.deepEqual(await t.report(job), { ok: true });
  const g = await t.get();
  const a = g.items[0];
  assert.equal(a.status, 'cancelled', 'stays stopped');
  assert.deepEqual([a.sent, a.sentAt, a.threadId, a.lease], [1, [MON], 't-a', null]);
  assert.equal(g.stats.today, 1);
  assert.equal(g.firstSendDay, '2026-10-19');
  assert.deepEqual(await t.report(job), { ok: true, ignored: true });
  t.clock.now += GAP;
  assert.equal((await t.claim()).reason, 'nothing_due');
  // It counts as emailed: no second email to the same address.
  assert.deepEqual((await t.put(email('a'), email('b', { email: 'a@biz.example' }))).rejected, [
    { id: 'a', reason: 'already_sent' },
    { id: 'b', reason: 'duplicate' },
  ]);
  // A stopped item without a claim ignores reports.
  await t.put(email('c'));
  await t.post('cancel', { ids: ['c'] });
  assert.deepEqual(await t.report({ id: 'c', step: 0 }), { ok: true, ignored: true });
});

test("Gmail's daily limit pauses until midnight in Dubai, then sending resumes by itself", async () => {
  const t = setup(at('2026-10-19 15:00'));
  await t.put(email('a'));
  let { job } = await t.claim();
  assert.deepEqual(await t.fail(job, { limit: true, error: 'Service invoked too many times: email' }), { ok: true });
  let g = await t.get();
  assert.equal(g.pausedReason, 'limit');
  assert.equal(g.pausedUntil, at('2026-10-20 00:00'));
  assert.equal(g.settings.paused, false);
  const a = g.items[0];
  assert.deepEqual([a.status, a.sent, a.lease, a.attempts, a.steps.length], ['queued', 0, null, 0, 3], 'kept for later');

  t.clock.now = at('2026-10-19 17:00');
  assert.equal((await t.claim()).reason, 'paused');
  t.clock.now = at('2026-10-20 00:00');
  g = await t.get();
  assert.deepEqual([g.pausedReason, g.pausedUntil], ['', 0]);
  t.clock.now = at('2026-10-20 09:00');
  job = (await t.claim()).job;
  assert.deepEqual([job.id, job.step, job.verify], ['a', 0, false]);
  assert.deepEqual([t.store.peek().pausedReason, t.store.peek().pausedUntil], ['', 0]);

  // Hitting the limit while paused by hand keeps the manual pause.
  await t.post('settings', { settings: { paused: true } });
  await t.fail(job, { limit: true });
  g = await t.get();
  assert.equal(g.pausedReason, 'manual');
  t.clock.now = at('2026-10-21 10:00');
  assert.equal((await t.claim()).reason, 'paused');
});

test('a permanent failure puts the address on the never list', async () => {
  const t = setup();
  await t.put(email('a'));
  const { job } = await t.claim();
  await t.fail(job, { permanent: true, error: 'Invalid To header' });
  const g = await t.get();
  const a = g.items[0];
  assert.deepEqual([a.status, a.error, a.steps, a.lease], ['failed', 'Invalid To header', [], null]);
  assert.equal(g.never, 1);
  assert.equal(g.stats.today, 0);
  assert.deepEqual((await t.put(email('b', { email: 'a@biz.example' }))).rejected, [{ id: 'b', reason: 'never' }]);
});

test('3 failed tries in a row mark the email failed', async () => {
  const t = setup();
  await t.put(email('a'), email('b'));
  let { job } = await t.claim();
  await t.fail(job, { error: 'x'.repeat(400) });
  let a = await t.item('a');
  assert.deepEqual([a.status, a.attempts, a.lease, a.error.length], ['queued', 1, null, 300]);
  t.clock.now += GAP;
  job = (await t.claim()).job;
  assert.deepEqual([job.id, job.verify], ['a', false], 'tried again after the gap');
  await t.fail(job);
  t.clock.now += GAP;
  job = (await t.claim()).job;
  await t.fail(job, { error: 'Server busy' });
  a = await t.item('a');
  assert.deepEqual([a.status, a.attempts, a.error, a.steps], ['failed', 3, 'Server busy', []]);
  assert.equal((await t.get()).never, 0, 'not on the never list');

  // A success after a failure clears the count.
  t.clock.now += GAP;
  job = (await t.claim()).job;
  assert.equal(job.id, 'b');
  await t.fail(job);
  t.clock.now += GAP;
  await t.send();
  const b = await t.item('b');
  assert.deepEqual([b.status, b.attempts, b.error], ['active', 0, '']);
});

/* ------------------------------------------------------------------ inbox events */

test('replies, bounces and opt outs from the inbox', async () => {
  const t = setup();
  await t.seed({
    items: [
      stored('act'),
      stored('done', { status: 'done', sent: 2, steps: [] }),
      stored('canSent', { status: 'cancelled', steps: [] }),
      stored('canNone', { status: 'cancelled', sent: 0, sentAt: [], steps: [] }),
      stored('bnc', { status: 'bounced', steps: [] }),
      stored('bo'),
      stored('opt1'),
      stored('opt2'),
      stored('opt3'),
      stored('opt4', { status: 'optout', steps: [] }),
    ],
    never: ['opt4@biz.example'],
  });
  const ev = (id, type) => ({ id, type });
  const r = await t.post('events', {
    events: [
      ev('act', 'replied'),
      ev('done', 'replied'),
      ev('canSent', 'replied'),
      ev('canNone', 'replied'),
      ev('bnc', 'replied'),
      ev('bo', 'bounced'),
      ev('opt1', 'optout'),
      ev('opt2', 'replied'),
      ev('opt2', 'optout'),
      ev('opt3', 'optout'),
      ev('opt3', 'replied'),
      ev('opt4', 'bounced'),
      ev('nope', 'replied'),
      ev('act', 'clicked'),
      'junk',
    ],
  });
  assert.deepEqual(r, { ok: true });
  const g = await t.get();
  const status = Object.fromEntries(g.items.map((x) => [x.id, x.status]));
  assert.deepEqual(status, {
    act: 'replied',
    done: 'replied',
    canSent: 'replied',
    canNone: 'cancelled',
    bnc: 'bounced',
    bo: 'bounced',
    opt1: 'optout',
    opt2: 'optout',
    opt3: 'optout',
    opt4: 'optout',
  });
  assert.deepEqual(g.items.find((x) => x.id === 'act').steps, [], 'bodies dropped once finished');
  assert.equal(g.items.find((x) => x.id === 'act').statusAt, MON);
  assert.deepEqual(t.store.peek().never.sort(), ['bo', 'opt1', 'opt2', 'opt3', 'opt4'].map((id) => `${id}@biz.example`));
  assert.equal(g.settings.paused, false, 'one bounce is not enough to pause');
  assert.equal((await t.claim()).reason, 'nothing_due', 'nothing is followed up');
});

test('3 bounces among the last 30 first emails pause sending', async () => {
  const t = setup();
  // 40 sent items, newest first in the list. The 3 oldest bounced long ago and are outside the last 30.
  const items = Array.from({ length: 40 }, (_, i) => stored(`n${i}`, { status: i >= 37 ? 'bounced' : 'done', steps: [], sentAt: [MON - (i + 1) * HOUR] }));
  await t.seed({ items: [...items, stored('q', { status: 'queued', sent: 0, sentAt: [] })] });
  const bounce = (id) => t.post('events', { events: [{ id, type: 'bounced' }] });
  const paused = async () => (await t.get()).settings.paused;

  await bounce('n0');
  await bounce('n1');
  assert.equal(await paused(), false, '2 in the last 30');
  await bounce('n2');
  let g = await t.get();
  assert.deepEqual([g.settings.paused, g.pausedReason], [true, 'bounces']);
  assert.equal((await t.claim()).reason, 'paused');

  // The owner resumes. Old bounces or other events do not pause it again, a new bounce does.
  await t.post('settings', { settings: { paused: false } });
  await bounce('n0');
  await t.post('events', { events: [{ id: 'n3', type: 'replied' }] });
  assert.equal(await paused(), false);
  assert.equal((await t.claim()).job.id, 'q');
  await bounce('n4');
  g = await t.get();
  assert.deepEqual([g.settings.paused, g.pausedReason], [true, 'bounces']);
});

/* ------------------------------------------------------------------ keeping the blob small */

test('keeps at most 1500 items, dropping the oldest finished ones first', async () => {
  const t = setup();
  const done = Array.from({ length: 1200 }, (_, i) => stored(`old${i}`, { status: 'done', steps: [], statusAt: MON - DAY + i }));
  const queued = Array.from({ length: 299 }, (_, i) => stored(`q${i}`, { status: 'queued', sent: 0, sentAt: [], addedAt: MON - 3 * DAY }));
  // Shuffle the finished ones so the order in the list does not decide.
  await t.seed({ items: [...done.slice(600), ...queued, ...done.slice(0, 600)] });
  const r = await t.put(email('a'), email('b'), email('c'));
  assert.equal(r.accepted, 3);
  assert.equal(r.items.length, 1500);
  const ids = new Set(r.items.map((x) => x.id));
  assert.equal(ids.has('old0') || ids.has('old1'), false, 'the two oldest finished items are gone');
  assert.ok(ids.has('old2'));
  assert.ok(['a', 'b', 'c', 'q0', 'q298'].every((id) => ids.has(id)));
  assert.equal(r.stats.queued, 302);
});

test('the never list keeps at most 5000 addresses', async () => {
  const t = setup();
  await t.seed({ items: [], never: Array.from({ length: 5000 }, (_, i) => `n${i}@x.example`) });
  const r = await t.post('never', { emails: ['new@x.example'] });
  assert.equal(r.never, 5000);
  const never = t.store.peek().never;
  assert.deepEqual([never[0], never.at(-1)], ['n1@x.example', 'new@x.example']);
});

test('sent counts are kept for the last 14 days', async () => {
  const t = setup();
  const sentByDay = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, 1]));
  await t.seed({ items: [stored('q', { status: 'queued', sent: 0, sentAt: [] })], sentByDay, firstSendDay: '2026-09-01' });
  await t.send();
  const days = t.store.peek().sentByDay;
  assert.deepEqual(Object.keys(days).sort(), Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 6).padStart(2, '0')}`));
  assert.equal(days['2026-10-19'], 2);
  assert.equal((await t.get()).stats.today, 2);
});
