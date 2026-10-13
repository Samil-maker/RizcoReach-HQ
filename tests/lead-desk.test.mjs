// Tests for Lead Desk: the shared logic (public/desk-assets/desk-core.js) and the API (netlify/functions/lead-desk.mts).
//   node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../netlify/functions/lead-desk.mts';

await import('../public/desk-assets/desk-core.js');
const D = globalThis.DeskCore;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const dt = (s) => D.fromDubaiLocal(s);
const S = D.DEFAULT_SETTINGS;
const T0 = dt('2025-10-14T10:00'); // a Tuesday, inside working hours

/* ------------------------------------------------------------------ fixtures */
const tick = () => new Promise((r) => setImmediate(r));

/** In-memory stand-in for a Netlify Blobs store: several keys, each with real etag semantics. */
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
      const etag = `"e${++n}"`;
      docs.set(key, { json: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    peek: (key) => (docs.has(key) ? JSON.parse(docs.get(key).json) : null),
    put: (key, value) => docs.set(key, { json: JSON.stringify(value), etag: `"e${++n}"` }),
  };
}

/** Records every call; `respond` decides the answer (default 200 "ok"). */
function mockFetch(respond = () => new Response('ok')) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers || {})), body: init.body ?? null });
    return respond(String(url), init);
  };
  fn.calls = calls;
  return fn;
}

const KEY = 'k'.repeat(32);
const ORIGIN = 'https://www.rizcoreach.ae';

function setup({ now = T0, fetch = mockFetch() } = {}) {
  const store = memStore();
  const clock = { now };
  const deps = { fetch, now: () => clock.now };
  const api = async (method, body, { key = KEY, secret = KEY, query = '' } = {}) => {
    const res = await handle(
      new Request(`${ORIGIN}/api/desk${query}`, {
        method,
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      store,
      secret,
      deps,
    );
    return { status: res.status, data: await res.json() };
  };
  const ops = (...list) => api('POST', { ops: list.map((o) => ({ opId: D.uid('op'), ...o })) });
  const post = async (token, body, { type = 'application/json', secret = KEY, method = 'POST', headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      if (body instanceof FormData) init.body = body;
      else {
        init.headers['content-type'] = type;
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }
    const res = await handle(new Request(`${ORIGIN}/api/desk/in/${token}`, init), store, secret, deps);
    const text = await res.text();
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    return { status: res.status, data: text && isJson ? JSON.parse(text) : null, text, headers: res.headers };
  };
  const addClient = async (client = {}) =>
    (await ops({ type: 'client.save', client: { name: 'Glossy PPF', niche: 'car', contactName: 'Omar', contactWa: '0501112222', location: 'Al Quoz 3, Dubai', ...client } })).data.results[0].data;
  const leads = () => store.peek('leads')?.leads || [];
  return { store, fetch, clock, api, ops, post, addClient, leads };
}

const baseLead = (extra = {}) => ({
  id: 'l_test1',
  clientId: 'c_1',
  source: 'meta',
  extId: '',
  createdAt: T0,
  submittedAt: null,
  name: 'Sara Ali',
  phone: '971507654321',
  phoneType: 'mobile',
  email: '',
  answers: [],
  service: 'Full body PPF',
  ad: { campaign: '', adset: '', ad: '', form: '', platform: '' },
  verified: null,
  flags: [],
  status: 'new',
  touches: [],
  firstTouchAt: null,
  repliedAt: null,
  bookedFor: '',
  bookedAt: null,
  handedAt: null,
  outcome: null,
  outcomeAt: null,
  closedAt: null,
  lostReason: '',
  notes: '',
  dupOf: '',
  updatedAt: T0,
  ...extra,
});

/* ============================================================== desk-core */
test('normPhone handles UAE local, international, Meta CSV and junk input', () => {
  const cases = [
    ['0501234567', '971501234567', 'mobile'],
    ['050 123 4567', '971501234567', 'mobile'],
    ['+971 50 123 4567', '971501234567', 'mobile'],
    ['+971 (0)55 765 4321', '971557654321', 'mobile'],
    ['00971501234567', '971501234567', 'mobile'],
    ['p:+971501234567', '971501234567', 'mobile'],
    ['971521234567', '971521234567', 'mobile'],
    ['04 123 4567', '97141234567', 'landline'],
    ['+971 4 123 4567', '97141234567', 'landline'],
    ['501234567', '971501234567', 'mobile'],
    ['+44 7700 900123', '447700900123', 'foreign'],
    ['0044 7700 900123', '447700900123', 'foreign'],
    ['+971 11 234', '97111234', 'invalid'],
    ['12345', '12345', 'invalid'],
    ['junk', '', 'none'],
    ['', '', 'none'],
    [null, '', 'none'],
  ];
  for (const [raw, digits, type] of cases) assert.deepEqual(D.normPhone(raw), { digits, type }, String(raw));
  assert.equal(D.fmtPhone('971501234567'), '+971 50 123 4567');
  assert.equal(D.fmtPhone('97141234567'), '+971 4 123 4567');
  assert.equal(D.fmtPhone('447700900123'), '+447700900123');
  assert.equal(D.fmtPhone(''), '');
  assert.equal(D.phoneKey('0501234567'), '971501234567');
  assert.equal(D.phoneKey('+971 50 123 4567'), '971501234567');
  assert.equal(D.phoneKey('50 123 4567'), '971501234567');
  assert.ok('971501234567'.includes(D.phoneKey('050 123')));
  assert.ok('971501234567'.includes(D.phoneKey('0501 2345')));
});

test('suspicious names and numbers become flags', () => {
  for (const n of ['test', 'Testing', 'asdf', 'qwerty123', 'xxx', 'abc', 'NA', 'n/a', 'none', 'fake', 'aaaa', 'Test Lead', '12345', '...']) assert.ok(D.suspiciousName(n), n);
  for (const n of ['Sara Ali', 'Omar', 'محمد', 'Jo', '']) assert.ok(!D.suspiciousName(n), n);
  assert.ok(D.suspiciousPhone('971500000000'));
  assert.ok(D.suspiciousPhone('971501234567'));
  assert.ok(D.suspiciousPhone('971507654321'));
  assert.ok(!D.suspiciousPhone('971557651298'));
  assert.deepEqual(D.flagsFor({ name: 'Sara', phone: '97143216789', phoneType: 'landline', verified: null, source: 'meta' }), ['landline']);
  assert.deepEqual(D.flagsFor({ name: 'test', phone: '', phoneType: 'none', verified: false, source: 'test' }), ['no-phone', 'suspicious-name', 'unverified', 'test']);
  assert.deepEqual(D.flagsFor({ name: 'Sara', phone: '447700900123', phoneType: 'foreign', verified: true }), ['foreign']);
  assert.deepEqual(D.flagsFor({ name: 'Sara', phone: '12', phoneType: 'invalid' }), ['invalid-phone']);
});

test('mapIntake reads Zapier-style flat keys', () => {
  const m = D.mapIntake({
    'Full Name': 'Sara Ali',
    'Phone Number': '+971 55 765 1298',
    Email: 'sara@example.com',
    'Created Time': '2025-10-14T05:58:00+0000',
    'Campaign Name': 'PPF October',
    'Adset Name': 'Dubai 25-55',
    'Ad Name': 'Video 1',
    'Form Name': 'PPF quote',
    Platform: 'ig',
    'Form ID': '123',
    'Is Organic': false,
    ID: 'l:998877',
    'Which service are you interested in?': 'full_body_ppf',
    'What car do you drive?': 'Tesla Model 3',
    nested: { a: 1 },
    list: ['x'],
  });
  assert.equal(m.name, 'Sara Ali');
  assert.equal(m.phone, '+971 55 765 1298');
  assert.equal(m.email, 'sara@example.com');
  assert.equal(m.extId, '998877');
  assert.equal(m.submittedAt, Date.UTC(2025, 9, 14, 5, 58));
  assert.deepEqual(m.ad, { campaign: 'PPF October', adset: 'Dubai 25-55', ad: 'Video 1', form: 'PPF quote', platform: 'ig' });
  assert.deepEqual(m.answers, [
    { q: 'Which service are you interested in?', a: 'full body ppf' },
    { q: 'What car do you drive?', a: 'Tesla Model 3' },
  ]);
  assert.equal(m.service, 'full body ppf');
  assert.equal(m.source, 'meta');
  assert.equal(m.honeypot, false);
  assert.equal(m.verified, null);
});

test('mapIntake reads the Meta Graph field_data format', () => {
  const m = D.mapIntake({
    id: '1234567890',
    created_time: 1760421600,
    ad_name: 'Carousel',
    campaign_name: 'Laser Oct',
    form_id: '55',
    field_data: [
      { name: 'full_name', values: ['ahmed khan'] },
      { name: 'phone_number', values: ['+971501239876'] },
      { name: 'email', values: ['ahmed@example.com'] },
      { name: 'what_treatment_are_you_looking_for?', values: ['laser_hair_removal'] },
      { name: 'preferred_days', values: ['Saturday', 'Sunday'] },
      { name: 'phone_number_verified', values: ['false'] },
    ],
  });
  assert.equal(m.name, 'ahmed khan');
  assert.equal(m.phone, '+971501239876');
  assert.equal(m.extId, '1234567890');
  assert.equal(m.submittedAt, 1760421600000);
  assert.equal(m.ad.ad, 'Carousel');
  assert.equal(m.ad.campaign, 'Laser Oct');
  assert.equal(m.verified, false);
  assert.equal(m.service, 'laser hair removal');
  assert.deepEqual(m.answers[1], { q: 'Preferred days', a: 'Saturday, Sunday' });
  assert.equal(m.source, 'meta');
});

test('mapIntake handles website form keys, _ controls and the honeypot', () => {
  const m = D.mapIntake({ name: 'Omar', phone: '0559876543', message: 'Hi there', _service: 'Ceramic coating', _redirect: 'https://glossy.example/thanks', _source: 'website', _other: 'x', _gotcha: '' });
  assert.equal(m.name, 'Omar');
  assert.equal(m.service, 'Ceramic coating');
  assert.equal(m.redirect, 'https://glossy.example/thanks');
  assert.equal(m.source, 'website');
  assert.deepEqual(m.answers, [{ q: 'Message', a: 'Hi there' }]);
  assert.equal(m.honeypot, false);
  assert.equal(D.mapIntake({ name: 'x', _redirect: 'http://glossy.example/thanks' }).redirect, '');
  assert.equal(D.mapIntake({ name: 'x', _redirect: 'javascript:alert(1)' }).redirect, '');
  assert.equal(D.mapIntake({ name: 'Bot', phone: '0501231234', _gotcha: 'spam' }).honeypot, true);
  assert.equal(D.mapIntake({ name: 'Bot', _hp: 'x' }).honeypot, true);
  assert.equal(D.mapIntake({ name: 'Bot', _honey: 'x' }).honeypot, true);
  assert.equal(D.mapIntake({ first_name: 'Mona', last_name: 'Saeed', mobile: '0501231231' }).name, 'Mona Saeed');
  assert.equal(D.mapIntake({ name: 'A' }).source, 'website');
  assert.equal(D.mapIntake({ name: 'A', _test: 'true' }).test, true);
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`q${i}`, `a${i}`]));
  assert.equal(D.mapIntake(many).answers.length, 15);
  assert.equal(D.mapIntake(null).name, '');
  assert.deepEqual(D.mapIntake({ name: 'A', constructor: 'Yes', toString: 'x' }).answers, [{ q: 'Constructor', a: 'Yes' }, { q: 'ToString', a: 'x' }]);
});

test('service comes from _service, then the first matching question, else the niche fallback', () => {
  assert.equal(D.mapIntake({ _service: 'PPF', which_package_do_you_want: 'Gold' }).service, 'PPF');
  assert.equal(D.mapIntake({ car: 'BMW', which_package_do_you_want: 'gold_package' }).service, 'gold package');
  assert.equal(D.mapIntake({ what_are_you_looking_for: 'Tint' }).service, 'Tint');
  assert.equal(D.mapIntake({ car: 'BMW' }).service, '');
  const v = D.varsFor({ name: 'sara', service: '' }, { name: 'FitLab', niche: 'fitness' }, {}, T0);
  assert.equal(v.service, 'a trial session');
  assert.equal(v.first_name, 'Sara');
  assert.equal(v.my_name, 'the team');
  assert.equal(D.varsFor({ name: 'AHMED KHAN' }, { niche: 'ac' }, {}, T0).first_name, 'Ahmed');
  assert.equal(D.varsFor({ name: 'Mary-Jane OBrien' }, {}, {}, T0).first_name, 'Mary-Jane');
  assert.equal(D.varsFor({ name: '' }, {}, {}, T0).first_name, 'there');
  assert.equal(D.varsFor({}, { niche: 'nope' }, {}, T0).service, 'your enquiry');
  assert.equal(D.varsFor({}, {}, {}, dt('2025-10-14T08:00')).greeting, 'Good morning');
  assert.equal(D.varsFor({}, {}, {}, dt('2025-10-14T13:00')).greeting, 'Good afternoon');
  assert.equal(D.varsFor({}, {}, {}, dt('2025-10-14T19:00')).greeting, 'Good evening');
});

test('scripts pick the client override or the niche default', () => {
  assert.match(D.scriptFor('first', { niche: 'clinic' }), /consultation/);
  assert.match(D.scriptFor('first', { niche: 'unknown' }), /I'll find you a slot/);
  assert.equal(D.scriptFor('f1', { niche: 'car', scripts: { f1: '  ' } }), D.DEFAULT_SCRIPTS.f1);
  assert.equal(D.scriptFor('f1', { niche: 'car', scripts: { f1: 'Custom' } }), 'Custom');
  assert.equal(D.scriptFor('nope', {}), '');
  assert.deepEqual(D.STEPS.map((s) => s.id), ['first', 'f1', 'f2', 'nudge', 'confirm', 'reminder', 'handover']);
});

test('renderScript fills variables and cleans up empty lines', () => {
  assert.equal(D.renderScript('Hi {{first_name}}\n\n\n\n{{ missing }}\n📍 {{maps}}\nBye {{ name }}  ', { first_name: 'Sara', maps: null, name: undefined }), 'Hi Sara\n\nBye');
  const client = { name: 'Glossy PPF', niche: 'car', location: '', mapsUrl: '' };
  const lead = { name: 'Sara Ali', phone: '971557651298', service: 'Full body PPF', bookedFor: '2025-10-18T11:00', answers: [], notes: '' };
  const vars = D.varsFor(lead, client, { myName: 'Samil' }, T0);
  const confirm = D.renderScript(D.scriptFor('confirm', client), vars);
  assert.equal(confirm, "You're booked ✅\n\n📅 Saturday 18 Oct, 11:00 am\n📍 Glossy PPF\n\nIf anything changes, just message me here. See you then!");
  const reminder = D.renderScript(D.scriptFor('reminder', client), vars);
  assert.ok(!reminder.includes('📍'), 'pin line without a maps link is dropped');
  const handover = D.renderScript(D.scriptFor('handover', client), vars);
  assert.equal(handover, 'New confirmed booking ✅\n\nName: Sara Ali\nPhone: +971 55 765 1298\nFor: full body PPF\nWhen: Saturday 18 Oct, 11:00 am\nWhatsApp them: https://wa.me/971557651298');
  const withMore = D.renderScript(D.scriptFor('handover', client), D.varsFor({ ...lead, answers: [{ q: 'Car', a: 'BMW X5' }], notes: 'Prefers mornings' }, client, {}, T0));
  assert.match(withMore, /\n• Car: BMW X5\nNotes: Prefers mornings\nWhatsApp them:/);
  const first = D.renderScript(D.scriptFor('first', client), vars);
  assert.match(first, /^Hi Sara 👋 This is Samil from the Glossy PPF bookings team\./);
  for (const step of D.STEPS.map((s) => s.id)) {
    const out = D.renderScript(D.scriptFor(step, { niche: 'car' }), D.varsFor({}, {}, {}, T0));
    assert.ok(!/\{\{|undefined|null/.test(out), step);
  }
  assert.equal(D.renderScript('{{a}} {{ x', { a: 'y' }), 'y { x');
});

test('Dubai time helpers', () => {
  assert.equal(T0, Date.UTC(2025, 9, 14, 6, 0));
  assert.equal(D.dubaiLocal(T0), '2025-10-14T10:00');
  assert.equal(D.dubaiLocal(Date.UTC(2025, 9, 14, 21, 30)), '2025-10-15T01:30');
  assert.ok(Number.isNaN(D.fromDubaiLocal('2025-02-30T10:00')));
  assert.ok(Number.isNaN(D.fromDubaiLocal('soon')));
  assert.equal(D.fmtBooked('2025-10-18T11:00'), 'Saturday 18 Oct, 11:00 am');
  assert.equal(D.fmtBooked('2025-10-18T15:30'), 'Saturday 18 Oct, 3:30 pm');
  assert.equal(D.fmtBooked('2025-10-18T00:05'), 'Saturday 18 Oct, 12:05 am');
  assert.equal(D.fmtBooked('nope'), '');
  assert.equal(D.atLocalTime(dt('2025-10-14T23:59'), '10:00'), dt('2025-10-14T10:00'));
  assert.equal(D.parseTime('2025-10-14 10:00:00'), T0);
  assert.equal(D.parseTime(String(T0)), T0);
  assert.equal(D.parseTime('2025-10-14T06:00:00Z'), T0);
  assert.equal(D.parseTime('later'), null);
});

test('deferToHours moves times outside working hours to the next start', () => {
  assert.equal(D.deferToHours(dt('2025-10-14T08:59'), S), dt('2025-10-14T09:00'));
  assert.equal(D.deferToHours(dt('2025-10-14T00:30'), S), dt('2025-10-14T09:00'));
  assert.equal(D.deferToHours(dt('2025-10-14T09:00'), S), dt('2025-10-14T09:00'));
  assert.equal(D.deferToHours(dt('2025-10-14T20:59'), S), dt('2025-10-14T20:59'));
  assert.equal(D.deferToHours(dt('2025-10-14T21:00'), S), dt('2025-10-15T09:00'));
  assert.equal(D.deferToHours(dt('2025-10-14T23:45'), S), dt('2025-10-15T09:00'));
  assert.equal(D.deferToHours(dt('2025-10-14T23:45'), { workStart: '08:00', workEnd: '08:00' }), dt('2025-10-14T23:45'));
  assert.equal(D.deferToHours(dt('2025-10-14T03:00'), { workStart: '22:00', workEnd: '06:00' }), dt('2025-10-14T03:00'));
});

test('nextAction walks the whole lead lifecycle', () => {
  const na = (l, now) => D.nextAction(l, S, now);
  let lead = baseLead({ createdAt: dt('2025-10-14T22:30') });
  assert.deepEqual(na(lead, lead.createdAt), { kind: 'first', due: dt('2025-10-15T09:00'), label: 'Send first message' });

  let t = dt('2025-10-15T09:03');
  lead = D.applyUpdate(lead, { touch: 'first', at: t }, t);
  assert.equal(lead.status, 'contacted');
  assert.deepEqual(na(lead, t), { kind: 'f1', due: t + 120 * MIN, label: 'Follow-up 1' });

  t = dt('2025-10-15T20:30');
  lead = D.applyUpdate(lead, { touch: 'f1', at: t }, t);
  assert.deepEqual(na(lead, t), { kind: 'f2', due: dt('2025-10-16T10:00'), label: 'Last follow-up' });

  t = dt('2025-10-16T10:02');
  lead = D.applyUpdate(lead, { touch: 'f2', at: t }, t);
  assert.deepEqual(na(lead, t), { kind: 'close', due: t + DAY, label: 'Call or close' });

  t = dt('2025-10-16T12:00');
  lead = D.applyUpdate(lead, { set: { status: 'replied' }, at: t }, t);
  assert.equal(lead.repliedAt, t);
  assert.deepEqual(na(lead, t), { kind: 'nudge', due: dt('2025-10-17T12:00'), label: 'Check in' });
  const nudged = D.applyUpdate(lead, { touch: 'nudge', at: t + DAY }, t + DAY);
  assert.equal(na(nudged, t + DAY), null);

  t = dt('2025-10-16T12:30');
  lead = D.applyUpdate(lead, { set: { status: 'booked', bookedFor: '2025-10-18T11:00' }, at: t }, t);
  assert.equal(lead.bookedAt, t);
  assert.deepEqual(na(lead, t), { kind: 'confirm', due: t, label: 'Send booking confirmation' });
  lead = D.applyUpdate(lead, { touch: 'confirm', at: t + MIN }, t + MIN);
  assert.deepEqual(na(lead, t), { kind: 'handover', due: t, label: 'Send to {client}' });
  lead = D.applyUpdate(lead, { touch: 'handover', at: t + 2 * MIN }, t + 2 * MIN);
  assert.equal(lead.handedAt, t + 2 * MIN);
  assert.deepEqual(na(lead, t), { kind: 'reminder', due: dt('2025-10-17T17:00'), label: 'Send reminder' });
  lead = D.applyUpdate(lead, { touch: 'reminder', at: dt('2025-10-17T17:05') }, dt('2025-10-17T17:05'));
  assert.deepEqual(na(lead, t), { kind: 'outcome', due: dt('2025-10-18T13:00'), label: 'Did they show up?' });
  lead = D.applyUpdate(lead, { set: { outcome: 'showed' } }, dt('2025-10-18T13:30'));
  assert.equal(na(lead, dt('2025-10-18T13:30')), null);

  // Booked less than 20 hours ahead: no reminder step.
  t = dt('2025-10-17T20:00');
  let late = D.applyUpdate(baseLead({ status: 'replied', repliedAt: t }), { set: { status: 'booked', bookedFor: '2025-10-18T11:00' }, at: t }, t);
  late = D.applyUpdate(late, { touch: 'confirm', at: t }, t);
  late = D.applyUpdate(late, { touch: 'handover', at: t }, t);
  assert.equal(na(late, t).kind, 'outcome');

  // The reminder would only be due after the appointment (short working hours): skipped.
  const early = { ...late, bookedAt: dt('2025-10-16T10:00'), bookedFor: '2025-10-18T09:00', touches: [{ k: 'confirm', at: dt('2025-10-16T10:00') }], handedAt: dt('2025-10-16T10:01') };
  assert.equal(D.nextAction(early, { ...S, workEnd: '16:00' }, t).kind, 'outcome');
  assert.equal(D.nextAction(early, S, t).kind, 'reminder');

  // A changed booking goes to the client again.
  const moved = D.applyUpdate(lead, { set: { bookedFor: '2025-10-20T11:00' } }, dt('2025-10-18T14:00'));
  assert.equal(moved.outcome, null);
  assert.equal(na(moved, dt('2025-10-18T14:00')).kind, 'confirm');

  for (const status of D.CLOSED) assert.equal(na(baseLead({ status }), T0), null, status);
});

test('applyUpdate is a pure reducer with undo, validation and derived fields', () => {
  const lead = baseLead();
  const frozen = JSON.parse(JSON.stringify(lead));
  const t = T0 + 5 * MIN;
  const sent = D.applyUpdate(lead, { touch: 'first', at: t }, t);
  assert.deepEqual(lead, frozen, 'input not mutated');
  assert.equal(sent.status, 'contacted');
  assert.equal(sent.firstTouchAt, t);
  assert.deepEqual(sent.touches, [{ k: 'first', at: t }]);
  assert.equal(sent.updatedAt, t);

  const undone = D.applyUpdate(sent, { untouch: t }, t + MIN);
  assert.equal(undone.status, 'new');
  assert.equal(undone.firstTouchAt, null);
  assert.deepEqual(undone.touches, []);

  const handed = D.applyUpdate(sent, { touch: 'handover', at: t + MIN }, t + MIN);
  assert.equal(handed.handedAt, t + MIN);
  const unhanded = D.applyUpdate(handed, { untouch: t + MIN }, t + 2 * MIN);
  assert.equal(unhanded.handedAt, null);
  assert.equal(unhanded.status, 'contacted', 'first touch still there');

  // A client clock far off is replaced by the server time.
  assert.equal(D.applyUpdate(lead, { touch: 'first', at: T0 - 3 * DAY }, T0).touches[0].at, T0);
  assert.equal(D.applyUpdate(lead, { touch: 'bogus' }, T0).touches.length, 0);
  assert.equal(D.applyUpdate(lead, { touch: 'close' }, T0).touches[0].k, 'call');

  // Booking needs a valid date and time.
  assert.equal(D.applyUpdate(lead, { set: { status: 'booked' } }, T0).status, 'new');
  assert.equal(D.applyUpdate(lead, { set: { status: 'booked', bookedFor: '2025-13-01T10:00' } }, T0).status, 'new');
  assert.equal(D.applyUpdate(lead, { set: { status: 'bogus' } }, T0).status, 'new');
  const booked = D.applyUpdate(lead, { set: { status: 'booked', bookedFor: '2025-10-18T11:00' } }, T0);
  assert.equal(booked.status, 'booked');
  assert.equal(booked.bookedAt, T0);
  const showed = D.applyUpdate(booked, { set: { outcome: 'showed' } }, T0 + DAY);
  assert.equal(showed.outcomeAt, T0 + DAY);
  assert.equal(D.applyUpdate(showed, { set: { status: 'booked', bookedFor: '2025-10-18T11:00' } }, T0 + DAY).outcome, 'showed', 'same booking keeps the outcome');
  assert.equal(D.applyUpdate(showed, { set: { status: 'booked', bookedFor: '2025-10-25T11:00' } }, T0 + DAY).outcome, null, 'new booking clears it');
  assert.equal(D.applyUpdate(showed, { set: { bookedFor: '' } }, T0 + DAY).bookedFor, '2025-10-18T11:00', 'a booked lead keeps its time');

  const lost = D.applyUpdate(lead, { set: { status: 'lost', lostReason: '  Too expensive ' } }, T0);
  assert.equal(lost.closedAt, T0);
  assert.equal(lost.lostReason, 'Too expensive');
  const reopened = D.applyUpdate(lost, { set: { status: 'new' } }, T0 + MIN);
  assert.equal(reopened.closedAt, null);
  assert.equal(D.applyUpdate(lead, { set: { status: 'contacted' } }, T0).firstTouchAt, T0);

  const edited = D.applyUpdate(lead, { set: { phone: '04 123 4567', name: 'x'.repeat(300), notes: ' hi ' } }, T0);
  assert.equal(edited.phone, '97141234567');
  assert.equal(edited.phoneType, 'landline');
  assert.ok(edited.flags.includes('landline'));
  assert.equal(edited.name.length, 120);
  assert.equal(edited.notes, 'hi');

  let many = lead;
  for (let i = 0; i < 45; i++) many = D.applyUpdate(many, { touch: 'other', at: T0 + i }, T0 + i);
  assert.equal(many.touches.length, 40);
});

test('stage sorts leads into the page tabs', () => {
  const now = T0;
  assert.equal(D.stage(baseLead({ createdAt: now - 10 * MIN }), S, now), 'todo');
  assert.equal(D.stage(baseLead({ createdAt: dt('2025-10-14T22:00') }), S, dt('2025-10-14T22:05')), 'waiting');
  const contacted = baseLead({ status: 'contacted', firstTouchAt: now - 10 * MIN, touches: [{ k: 'first', at: now - 10 * MIN }] });
  assert.equal(D.stage(contacted, S, now), 'waiting');
  assert.equal(D.stage(contacted, S, now + 3 * HOUR), 'todo');
  assert.equal(D.stage(baseLead({ status: 'replied', repliedAt: now - HOUR }), S, now), 'chatting');
  assert.equal(D.stage(baseLead({ status: 'replied', repliedAt: now - 2 * DAY }), S, now), 'todo');
  const booked = baseLead({ status: 'booked', bookedFor: '2025-10-18T11:00', bookedAt: now, handedAt: now + 1, touches: [{ k: 'confirm', at: now }] });
  assert.equal(D.stage(booked, S, now), 'booked');
  assert.equal(D.stage({ ...booked, handedAt: null }, S, now), 'todo');
  assert.equal(D.stage({ ...booked, outcome: 'showed' }, S, now + 9 * DAY), 'booked');
  assert.equal(D.stage(baseLead({ status: 'lost' }), S, now), 'closed');
  assert.equal(D.stage(baseLead({ status: 'dup' }), S, now), 'closed');
});

test('report counts the funnel and the median time to first reply', () => {
  const at = (s) => dt(s);
  const leads = [
    baseLead({ id: 'a', createdAt: at('2025-10-14T10:00'), firstTouchAt: at('2025-10-14T10:04'), repliedAt: at('2025-10-14T11:00'), status: 'booked', bookedAt: at('2025-10-14T12:00'), outcome: 'showed' }),
    baseLead({ id: 'b', createdAt: at('2025-10-14T11:00'), firstTouchAt: at('2025-10-14T11:10'), status: 'booked', bookedAt: at('2025-10-14T12:00'), outcome: 'noshow' }),
    baseLead({ id: 'c', createdAt: at('2025-10-14T12:00'), firstTouchAt: at('2025-10-14T12:02'), status: 'lost' }),
    baseLead({ id: 'd', createdAt: at('2025-10-14T23:00'), firstTouchAt: at('2025-10-15T09:07'), status: 'replied', repliedAt: at('2025-10-15T10:00') }),
    baseLead({ id: 'e', createdAt: at('2025-10-15T10:00'), firstTouchAt: at('2025-10-15T10:06'), status: 'fake' }),
    baseLead({ id: 'f', createdAt: at('2025-10-15T10:00') }),
    baseLead({ id: 'g', createdAt: at('2025-10-15T11:00'), status: 'noanswer', firstTouchAt: at('2025-10-15T10:59') }),
    baseLead({ id: 'h', createdAt: at('2025-10-15T12:00'), status: 'dup' }),
    baseLead({ id: 'i', createdAt: at('2025-10-15T12:00'), source: 'test' }),
    baseLead({ id: 'j', createdAt: at('2025-10-15T12:00'), clientId: 'c_other' }),
    baseLead({ id: 'k', createdAt: at('2025-10-30T12:00') }),
  ];
  const r = D.report(leads, { clientId: 'c_1', from: at('2025-10-13T00:00'), to: at('2025-10-20T00:00') }, S);
  assert.deepEqual(r, { received: 7, fake: 1, dup: 1, contacted: 6, medianReplyMin: 5, replied: 3, booked: 2, showed: 1, noshow: 1, lost: 1, noanswer: 1, open: 2 });
  // Replies measured from the start of working hours, never negative: [0, 2, 4, 6, 7, 10] -> 5
  assert.equal(D.report([], {}, S).medianReplyMin, null);
  assert.equal(D.report(leads, { from: 0, to: Infinity }, S).received, 9);
});

test('reportText is short and only shows real numbers', () => {
  const full = { received: 42, replied: 31, booked: 14, showed: 11, noshow: 2, medianReplyMin: 4, lost: 6, noanswer: 5, fake: 3 };
  assert.equal(
    D.reportText('Glossy PPF', full, '6', '12 Oct'),
    'Glossy PPF · 6–12 Oct\n\n42 leads from your ads\n31 replied (74%)\n14 booked\n11 showed up\n\nMedian time to first reply: 4 min\nNot interested: 6 · No answer: 5 · Wrong numbers: 3',
  );
  assert.equal(D.reportText('Glossy PPF', { received: 0, replied: 0, booked: 0, medianReplyMin: null }, '1 Oct', '31 Oct'), 'Glossy PPF · 1 Oct–31 Oct\n\n0 leads from your ads\n0 replied\n0 booked');
  const partial = D.reportText('FitLab', { received: 1, replied: 1, booked: 1, showed: 0, noshow: 0, medianReplyMin: 0, lost: 0, noanswer: 2, fake: 0 }, '1', '7 Oct');
  assert.equal(partial, 'FitLab · 1–7 Oct\n\n1 lead from your ads\n1 replied (100%)\n1 booked\n\nMedian time to first reply: under 1 min\nNo answer: 2');
  assert.ok(!partial.includes('showed up'));
});

test('parseCsv handles quotes, escaped quotes, CRLF, tabs and a BOM', () => {
  const rows = D.parseCsv('name,phone,note\r\n"Doe, Jane",050 123 4567,"said ""hi""\nthen left"\r\n\r\nOmar,,\r\n');
  assert.deepEqual(rows, [
    { name: 'Doe, Jane', phone: '050 123 4567', note: 'said "hi"\nthen left' },
    { name: 'Omar', phone: '', note: '' },
  ]);
  const tsv = D.parseCsv('﻿id\tfull_name\tphone_number\tcity, area\nl:1\tSara\tp:+971501234567\tDubai, Marina');
  assert.deepEqual(tsv, [{ id: 'l:1', full_name: 'Sara', phone_number: 'p:+971501234567', 'city, area': 'Dubai, Marina' }]);
  assert.deepEqual(D.parseCsv(''), []);
});

test('decodeBytes reads UTF-16LE, UTF-16BE and UTF-8 exports', () => {
  const text = 'id\tfull_name\nl:1\tمحمد 👋\n';
  assert.equal(D.decodeBytes(new Uint8Array(Buffer.from('﻿' + text, 'utf16le'))), text);
  const be = Buffer.from('﻿' + text, 'utf16le').swap16();
  assert.equal(D.decodeBytes(new Uint8Array(be)), text);
  assert.equal(D.decodeBytes(new Uint8Array(Buffer.from('﻿' + text, 'utf8'))), text);
  assert.equal(D.decodeBytes(new Uint8Array(Buffer.from(text, 'utf8'))), text);
  assert.equal(D.decodeBytes(new Uint8Array(Buffer.from('\uFEFF' + text, 'utf16le')).buffer), text, 'ArrayBuffer input');
});

test('waUrl builds app and web links, CSV and ids', () => {
  assert.equal(D.waUrl('971501234567', 'Hi 👋 & bye', 'app'), 'https://wa.me/971501234567?text=Hi%20%F0%9F%91%8B%20%26%20bye');
  assert.equal(D.waUrl('+971 50 123 4567', 'Hi', 'web'), 'https://web.whatsapp.com/send?phone=971501234567&text=Hi');
  assert.equal(D.waUrl('971501234567', '', 'app'), 'https://wa.me/971501234567');
  assert.equal(D.waUrl('971501234567', '', 'web'), 'https://web.whatsapp.com/send?phone=971501234567');
  assert.equal(D.waUrl('971501234567', 'a\uD83D', 'app'), 'https://wa.me/971501234567?text=a%EF%BF%BD');
  assert.equal(D.toCsv([['name', 'note'], ['Sara, Ali', 'said "hi"'], ['=1+1', '+971 50 123 4567']]), 'name,note\r\n"Sara, Ali","said ""hi"""\r\n\'=1+1,+971 50 123 4567\r\n');
  assert.equal(D.toCsv([{ a: 1, b: 'x\ny' }]), 'a,b\r\n1,"x\ny"\r\n');
  assert.match(D.uid('l'), /^l_[a-z0-9]{12,}$/);
  assert.match(D.uid('op_'), /^op_[a-z0-9]{12,}$/);
});

test('nextAction: the reminder is never due before the booking, nor within 2 hours of it', () => {
  const ready = (bookedAt, bookedFor) => baseLead({ status: 'booked', bookedAt, bookedFor, touches: [{ k: 'confirm', at: bookedAt }], handedAt: bookedAt + 1 });
  // Booked at 18:00 for 15:00 tomorrow (21 hours ahead): 17:00 today is already behind us.
  assert.equal(D.nextAction(ready(dt('2025-10-17T18:00'), '2025-10-18T15:00'), S, dt('2025-10-17T18:05')).kind, 'outcome');
  // Booked at 15:30 for tomorrow morning: 17:00 would be only 90 minutes after the booking.
  assert.equal(D.nextAction(ready(dt('2025-10-17T15:30'), '2025-10-18T09:00'), S, dt('2025-10-17T15:35')).kind, 'outcome');
  // Exactly 2 hours after the booking is fine.
  assert.deepEqual(D.nextAction(ready(dt('2025-10-17T15:00'), '2025-10-18T09:00'), S, dt('2025-10-17T15:05')), { kind: 'reminder', due: dt('2025-10-17T17:00'), label: 'Send reminder' });
  // Booked days ahead: the evening before, as always.
  assert.equal(D.nextAction(ready(dt('2025-10-14T10:00'), '2025-10-18T11:00'), S, T0).due, dt('2025-10-17T17:00'));
});

test('nextAction: a reopened lead starts over from its latest first message, and a new reply restarts the check-in', () => {
  let lead = D.applyUpdate(baseLead(), { touch: 'first', at: T0 }, T0);
  lead = D.applyUpdate(lead, { touch: 'f1', at: T0 + 3 * HOUR }, T0 + 3 * HOUR);
  lead = D.applyUpdate(lead, { touch: 'f2', at: T0 + DAY }, T0 + DAY);
  lead = D.applyUpdate(lead, { set: { status: 'noanswer' } }, T0 + 2 * DAY);
  const t = T0 + 10 * DAY;
  lead = D.applyUpdate(lead, { set: { status: 'new' } }, t);
  assert.equal(D.nextAction(lead, S, t).kind, 'first');
  lead = D.applyUpdate(lead, { touch: 'first', at: t }, t);
  assert.equal(lead.status, 'contacted');
  assert.equal(lead.firstTouchAt, T0, 'reports keep the very first message');
  assert.deepEqual(D.nextAction(lead, S, t), { kind: 'f1', due: t + 120 * MIN, label: 'Follow-up 1' });
  lead = D.applyUpdate(lead, { touch: 'f1', at: t + 2 * HOUR }, t + 2 * HOUR);
  assert.equal(D.nextAction(lead, S, t + 2 * HOUR).kind, 'f2');

  let chat = D.applyUpdate(baseLead({ status: 'contacted' }), { set: { status: 'replied' } }, T0);
  assert.equal(chat.repliedAt, T0);
  chat = D.applyUpdate(chat, { touch: 'nudge', at: T0 + DAY }, T0 + DAY);
  assert.equal(D.nextAction(chat, S, T0 + DAY), null);
  chat = D.applyUpdate(chat, { set: { status: 'lost' } }, T0 + 2 * DAY);
  chat = D.applyUpdate(chat, { set: { status: 'replied' } }, T0 + 5 * DAY);
  assert.equal(chat.repliedAt, T0 + 5 * DAY);
  assert.deepEqual(D.nextAction(chat, S, T0 + 5 * DAY), { kind: 'nudge', due: T0 + 6 * DAY, label: 'Check in' });
  assert.equal(D.applyUpdate(chat, { set: { status: 'replied' } }, T0 + 6 * DAY).repliedAt, T0 + 5 * DAY, 'already replied: unchanged');
});

test('mapIntake keeps extra values as answers and picks the best phone number', () => {
  const two = D.mapIntake({ full_name: 'Sara Ali', name: 'Sara', phone: '0501234567', mobile: '0559876543', email: 'a@example.com', 'E-mail': 'b@example.com' });
  assert.deepEqual([two.name, two.phone, two.email], ['Sara Ali', '0501234567', 'a@example.com']);
  assert.deepEqual(two.answers, [{ q: 'Name', a: 'Sara' }, { q: 'Mobile', a: '0559876543' }, { q: 'E-mail', a: 'b@example.com' }]);

  // A WhatsApp key wins when it holds a mobile or foreign number, even one the key list doesn't know.
  const wa = D.mapIntake({ phone_number: '04 123 4567', whatsapp_number: '050 123 4567' });
  assert.equal(wa.phone, '050 123 4567');
  assert.deepEqual(wa.answers, [{ q: 'Phone number', a: '04 123 4567' }]);
  const waOther = D.mapIntake({ phone: '0501234567', 'WhatsApp (if different)': '+44 7700 900123' });
  assert.equal(waOther.phone, '+44 7700 900123');
  assert.deepEqual(waOther.answers, [{ q: 'Phone', a: '0501234567' }]);
  const waNo = D.mapIntake({ phone: '0501234567', do_you_use_whatsapp: 'yes' });
  assert.equal(waNo.phone, '0501234567');
  assert.deepEqual(waNo.answers, [{ q: 'Do you use whatsapp', a: 'yes' }]);

  // Otherwise the first key holding a usable number; a bad one is still kept (and flagged) when it's all there is.
  const junkFirst = D.mapIntake({ phone: 'n/a', mobile: '0501234567' });
  assert.equal(junkFirst.phone, '0501234567');
  assert.deepEqual(junkFirst.answers, [{ q: 'Phone', a: 'n/a' }]);
  assert.equal(D.mapIntake({ name: 'Omar', phone: '12' }).phone, '12');

  // Generic "number" and "date" only count when nothing more specific was posted.
  const units = D.mapIntake({ name: 'Omar', phone: '0501234567', number: '3' });
  assert.equal(units.phone, '0501234567');
  assert.deepEqual(units.answers, [{ q: 'Number', a: '3' }]);
  assert.equal(D.mapIntake({ name: 'Omar', number: '050 123 4567' }).phone, '050 123 4567');
  const notPhone = D.mapIntake({ name: 'Omar', number: '2' });
  assert.equal(notPhone.phone, '');
  assert.deepEqual(notPhone.answers, [{ q: 'Number', a: '2' }]);
  const dated = D.mapIntake({ name: 'Omar', created_time: '2025-10-14T06:00:00Z', date: '2025-10-20' });
  assert.equal(dated.submittedAt, T0);
  assert.deepEqual(dated.answers, [{ q: 'Date', a: '2025-10-20' }]);
  assert.equal(D.mapIntake({ name: 'Omar', date: '2025-10-14 10:00:00' }).submittedAt, T0);
});

test('service skips yes/no answers, prefers "which/what service" questions, and reads well mid-sentence', () => {
  assert.equal(D.mapIntake({ are_you_interested_in_a_free_inspection: 'Yes', which_treatment_would_you_like: 'Botox' }).service, 'Botox');
  assert.equal(D.mapIntake({ interested_in_weekend_slots: 'Saturday please', 'What service do you need?': 'Window tint' }).service, 'Window tint');
  assert.equal(D.mapIntake({ are_you_interested: 'Yes', looking_for: 'Ceramic coating' }).service, 'Ceramic coating');
  for (const [q, a] of [['interested', 'true'], ['service', 'no'], ['service', 'Maybe.'], ['which_service', 'AC'], ['which_package', '2']]) {
    assert.equal(D.mapIntake({ [q]: a }).service, '', `${q}: ${a}`);
  }
  const svc = (service) => D.varsFor({ service }, { niche: 'car' }, {}, T0).service;
  assert.equal(svc('Ceramic coating'), 'ceramic coating');
  assert.equal(svc('Window tint'), 'window tint');
  assert.equal(svc('Full body PPF'), 'full body PPF');
  assert.equal(svc('Full-body wrap'), 'full-body wrap');
  for (const kept of ['PPF', 'AC deep clean', 'iPhone screen', 'HydraFacial', 'Laser Hair Removal', 'ceramic coating']) assert.equal(svc(kept), kept);
  assert.equal(svc(''), 'detailing');
  const first = D.renderScript(D.scriptFor('first', { niche: 'car' }), D.varsFor({ name: 'Omar', service: 'Ceramic coating' }, { name: 'Glossy PPF', niche: 'car' }, {}, T0));
  assert.match(first, /enquiry about ceramic coating!/);
});

test('mapIntake strips control characters, keeps one-line fields on one line, caps answers and flags links', () => {
  const m = D.mapIntake({
    'full\u0000_name': ' Sa\u0007ra\n Ali\u0085 ',
    phone: '050\u0000 123 4567',
    email: 'sara@example.com\r\n',
    campaign_name: 'PPF\nOctober',
    _service: 'Ceramic\r\ncoating',
    'Message\u001b': 'line one\r\nline two\u009b\tend',
  });
  assert.deepEqual([m.name, m.phone, m.email, m.ad.campaign, m.service], ['Sara Ali', '050 123 4567', 'sara@example.com', 'PPF October', 'Ceramic coating']);
  assert.deepEqual(m.answers, [{ q: 'Message', a: 'line one\nline two end' }]);
  assert.deepEqual(m.flags, []);

  const big = D.mapIntake(Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`question_${i}`, 'x'.repeat(500)])));
  const total = big.answers.reduce((n, a) => n + a.q.length + a.a.length, 0);
  assert.ok(total <= 3000, `answers text is ${total}`);
  assert.equal(big.answers.length, 6);
  assert.ok(big.answers[5].a.endsWith('…'));
  assert.equal(D.capAnswers([{ q: 'Car', a: 'BMW' }]).length, 1);

  const spam = D.mapIntake({ full_name: 'Win cash www.spam.example', phone: '0501234567', _service: 'Visit https://spam.example/now' });
  assert.deepEqual(spam.flags, ['has-link']);
  assert.equal(spam.service, '', 'a service with a link is dropped');
  const linkName = D.mapIntake({ full_name: 'Sara https://x.example', phone: '0501234567', which_service: 'Tint' });
  assert.deepEqual([linkName.flags, linkName.service], [['has-link'], 'Tint']);
  assert.equal(D.mapIntake({ name: 'Omar', which_service_do_you_need: 'see bit.ly/abc' }).service, '');
  assert.ok(D.flagsFor({ name: 'Omar www.x.example', phone: '971501112223', phoneType: 'mobile' }).includes('has-link'));
  assert.ok(!D.hasLink('Sara Ali') && !D.hasLink('Dr. Mona') && !D.hasLink('Full body PPF'));
  const v = D.varsFor({ name: 'www.spam.example Sara Ali', service: 'Tint http://spam.example' }, { niche: 'car' }, {}, T0);
  assert.deepEqual([v.first_name, v.name, v.service], ['Sara', 'Sara Ali', 'tint']);
});

test('toCsv neutralises formulas but leaves plain numbers and phones alone', () => {
  const row = ['=SUM(A1)', '+cmd|x', '-2+3', '@me', '\tTab', '\rCR', '+971 50 123 4567', '-5', '(050) 123-4567', '+1 (555) 010-9999', 'Sara'];
  assert.equal(D.toCsv([row]), `'=SUM(A1),'+cmd|x,'-2+3,'@me,'\tTab,"'\rCR",+971 50 123 4567,-5,(050) 123-4567,+1 (555) 010-9999,Sara\r\n`);
});

/* ================================================================== server */
test('admin API is off without a key, needs the right key, and starts empty', async () => {
  const { api } = setup();
  assert.equal((await api('GET', undefined, { secret: '' })).status, 503);
  assert.equal((await api('GET', undefined, { secret: null })).status, 503);
  assert.equal((await api('GET', undefined, { secret: 'short', key: 'short' })).status, 503);
  assert.equal((await api('GET', undefined, { key: null })).status, 401);
  assert.equal((await api('GET', undefined, { key: KEY + 'x' })).status, 401);
  const r = await api('GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { rev: '0.0', config: { clients: [], settings: D.DEFAULT_SETTINGS }, leads: [], now: T0, keySource: 'desk' });
  assert.equal((await api('PUT', {})).status, 405);
  assert.equal((await api('POST', 'not json')).status, 400);
  assert.equal((await api('POST', { ops: 'x' })).status, 400);
  assert.equal((await api('POST', { ops: Array.from({ length: 101 }, () => ({ type: 'x' })) })).status, 400);
  const unknown = await api('POST', { ops: [{ opId: 'o1', type: 'lead.fly' }] });
  assert.deepEqual(unknown.data.results, [{ opId: 'o1', ok: false, error: 'unknown_op' }]);
});

test('client.save creates and updates clients; the intake token cannot be set', async () => {
  const { ops, addClient, store } = setup();
  const c = await addClient({ mapsUrl: 'http://maps.example/x' });
  assert.match(c.id, /^c_[a-z0-9]{10}$/);
  assert.match(c.intakeToken, /^[\w-]{32}$/);
  assert.equal(c.color, 0);
  assert.equal(c.contactWa, '971501112222');
  assert.equal(c.mapsUrl, '');
  assert.equal(c.archived, false);
  assert.equal(c.createdAt, T0);

  const r = await ops({ type: 'client.save', client: { id: c.id, name: '  Glossy PPF Dubai ', intakeToken: 'hacked', color: 5, mapsUrl: 'https://maps.app.goo.gl/abc', scripts: { first: 'Hi {{first_name}}', bogus: 'x', f1: '' } } });
  const u = r.data.results[0].data;
  assert.equal(u.name, 'Glossy PPF Dubai');
  assert.equal(u.intakeToken, c.intakeToken);
  assert.equal(u.color, 0);
  assert.equal(u.niche, 'car', 'fields not sent are kept');
  assert.equal(u.mapsUrl, 'https://maps.app.goo.gl/abc');
  assert.deepEqual(u.scripts, { first: 'Hi {{first_name}}' });
  assert.equal(r.data.config.clients.length, 1);

  const errors = await ops(
    { type: 'client.save', client: { niche: 'car' } },
    { type: 'client.save', client: { name: 'Boats', niche: 'boats' } },
    { type: 'client.save', client: { name: 'Long', scripts: { first: 'x'.repeat(2001) } } },
    { type: 'client.save', client: { id: 'c_missing', name: 'X' } },
  );
  assert.deepEqual(errors.data.results.map((x) => x.error), ['name_required', 'bad_niche', 'script_too_long', 'not_found']);
  const second = await addClient({ name: 'FitLab', niche: 'fitness' });
  assert.equal(second.color, 1);
  assert.notEqual(second.intakeToken, c.intakeToken);

  const rotated = (await ops({ type: 'client.rotate', id: c.id })).data.results[0].data;
  assert.notEqual(rotated.intakeToken, c.intakeToken);
  assert.equal(store.peek('config').rev, 4);
});

test('intake: unknown links, working links, CORS preflight and the 503 switch', async () => {
  const { post, addClient } = setup();
  const c = await addClient();
  const unknown = await post('x'.repeat(32), { full_name: 'Sara', phone_number: '0501234567' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.error, 'unknown_link');
  assert.equal(unknown.headers.get('access-control-allow-origin'), '*');
  assert.equal((await post('short', undefined, { method: 'GET' })).status, 404);

  const ok = await post(c.intakeToken, undefined, { method: 'GET' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { ok: true, client: 'Glossy PPF', message: 'This link is working. Send leads with POST.' });

  const pre = await post(c.intakeToken, undefined, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(pre.headers.get('access-control-max-age'), '86400');

  assert.equal((await post(c.intakeToken, { full_name: 'Sara' }, { secret: '' })).status, 503);
  assert.equal((await post(c.intakeToken, { full_name: 'Sara' }, { secret: 'too-short' })).data.error, 'not_configured');
  assert.equal((await post(c.intakeToken, undefined, { method: 'DELETE' })).status, 405);
});

test('intake: JSON leads are stored once, normalized and flagged; repeats become duplicates', async () => {
  const { post, addClient, leads, api } = setup();
  const c = await addClient();
  const meta = { id: 'meta-1', full_name: 'Sara Ali', phone_number: '050 765 1298', email: 'sara@example.com', 'which_service_are_you_interested_in?': 'Full body PPF', campaign_name: 'PPF Oct' };
  const r = await post(c.intakeToken, meta);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.data.ok, true);
  assert.equal(r.data.ids.length, 1);
  assert.deepEqual([r.data.duplicates, r.data.rejected], [0, 0]);
  const [lead] = leads();
  assert.equal(lead.id, r.data.ids[0]);
  assert.match(lead.id, /^l_[a-z0-9]+$/);
  assert.equal(lead.clientId, c.id);
  assert.equal(lead.phone, '971507651298');
  assert.equal(lead.phoneType, 'mobile');
  assert.deepEqual(lead.flags, []);
  assert.equal(lead.source, 'meta');
  assert.equal(lead.status, 'new');
  assert.equal(lead.service, 'Full body PPF');
  assert.equal(lead.createdAt, T0);
  assert.equal(lead.extId, 'meta-1');
  assert.equal(lead.ad.campaign, 'PPF Oct');

  // Make/Zapier retry with the same Meta lead id: stored once.
  const again = await post(c.intakeToken, meta);
  assert.deepEqual(again.data, { ok: true, ids: [], duplicates: 1, rejected: 0 });
  assert.equal(leads().length, 1);

  // Same phone again (another form): kept, but closed as a duplicate.
  const dup = await post(c.intakeToken, { full_name: 'Sara', phone_number: '+971507651298' });
  const stored = leads().find((l) => l.id === dup.data.ids[0]);
  assert.equal(stored.status, 'dup');
  assert.equal(stored.dupOf, lead.id);
  assert.equal(stored.closedAt, T0);

  // A landline and a website lead.
  const land = await post(c.intakeToken, { name: 'Office', phone: '04 123 4567', _source: 'website' });
  const landLead = leads().find((l) => l.id === land.data.ids[0]);
  assert.deepEqual(landLead.flags, ['landline', 'suspicious-phone']);
  assert.equal(landLead.source, 'website');

  // Test leads, wrappers, text/plain JSON and arrays.
  const t = await post(c.intakeToken, { full_name: 'Test Lead', phone_number: '+971500000000', _test: true, which_service_are_you_interested_in: 'Test' });
  const testLead = leads().find((l) => l.id === t.data.ids[0]);
  assert.equal(testLead.source, 'test');
  assert.ok(testLead.flags.includes('test'));
  const t2 = await post(c.intakeToken, { full_name: 'Test Lead', phone_number: '+971500000000', _test: 'true' });
  assert.equal(leads().find((l) => l.id === t2.data.ids[0]).status, 'new', 'test leads are never duplicates');
  const wrapped = await post(c.intakeToken, { leads: [{ name: 'A1', phone: '0551110001' }, { name: 'A2', phone: '0551110002' }, { note: 'no contact' }] });
  assert.equal(wrapped.data.ids.length, 2);
  assert.equal(wrapped.data.rejected, 1);
  const plain = await post(c.intakeToken, JSON.stringify([{ name: 'B1', email: 'b1@example.com' }]), { type: 'text/plain;charset=UTF-8' });
  assert.equal(plain.data.ids.length, 1);
  assert.equal((await post(c.intakeToken, Array.from({ length: 21 }, (_, i) => ({ name: `N${i}` })))).status, 400);
  assert.equal((await post(c.intakeToken, 'not json')).data.error, 'invalid_body');
  const none = await post(c.intakeToken, { message: 'hello' });
  assert.equal(none.status, 400);
  assert.equal(none.data.error, 'no_contact_details');

  const view = await api('GET');
  assert.equal(view.data.leads.length, leads().length);
});

test('intake: honeypot, form posts with redirect, multipart and size limit', async () => {
  const { post, addClient, leads } = setup();
  const c = await addClient();
  const bot = await post(c.intakeToken, { full_name: 'Bot', phone_number: '0501231234', _gotcha: 'http://spam' });
  assert.equal(bot.status, 200);
  assert.deepEqual(bot.data.ids, []);
  assert.equal(leads().length, 0);

  const form = 'full_name=Omar+Saeed&phone_number=055+123+4321&_service=Ceramic+coating&_redirect=https%3A%2F%2Fglossy.example%2Fthanks&_gotcha=';
  const r = await post(c.intakeToken, form, { type: 'application/x-www-form-urlencoded', headers: { origin: 'https://glossy.example' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'https://glossy.example/thanks');
  const omar = leads()[0];
  assert.equal(omar.name, 'Omar Saeed');
  assert.equal(omar.phone, '971551234321');
  assert.equal(omar.service, 'Ceramic coating');
  assert.equal(omar.source, 'website');

  const noRedirect = await post(c.intakeToken, 'name=Lina&phone=0559990001&_redirect=http%3A%2F%2Finsecure.example', { type: 'application/x-www-form-urlencoded' });
  assert.equal(noRedirect.status, 200);
  assert.match(noRedirect.headers.get('content-type'), /^text\/html/);
  assert.ok(leads().some((l) => l.name === 'Lina'));

  const fd = new FormData();
  fd.append('add_ons', 'Wax');
  fd.append('add_ons', 'Tint');
  fd.append('full_name', 'Hana');
  fd.append('phone_number', '0558887766');
  fd.append('what_package_do_you_need', 'Gold');
  fd.append('photo', new Blob(['binary']), 'car.jpg');
  const multi = await post(c.intakeToken, fd);
  assert.equal(multi.status, 200);
  const hana = leads().find((l) => l.name === 'Hana');
  assert.equal(hana.name, 'Hana');
  assert.equal(hana.service, 'Gold');
  assert.deepEqual(hana.answers, [{ q: 'Add ons', a: 'Wax, Tint' }, { q: 'What package do you need', a: 'Gold' }]);

  const big = await post(c.intakeToken, { full_name: 'Big', note: 'x'.repeat(70 * 1024) });
  assert.equal(big.status, 413);
  assert.equal(big.headers.get('access-control-allow-origin'), '*');
});

test('intake: rate limit per client and archived clients', async () => {
  const { post, addClient, ops, clock } = setup();
  const c = await addClient();
  const batch = (n) => Array.from({ length: 20 }, (_, i) => ({ full_name: `Lead ${n}-${i}`, phone_number: `05581${String(n * 100 + i).padStart(5, '0')}` }));
  // No IP headers here, so only the per-client cap (120 per 10 minutes) applies.
  for (let n = 0; n < 6; n++) assert.equal((await post(c.intakeToken, batch(n))).status, 200, `batch ${n}`);
  const limited = await post(c.intakeToken, batch(6));
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error, 'rate_limited');
  clock.now += 11 * MIN;
  assert.equal((await post(c.intakeToken, batch(7))).status, 200);

  await ops({ type: 'client.save', client: { id: c.id, archived: true } });
  const gone = await post(c.intakeToken, { full_name: 'Late', phone_number: '0551234000' });
  assert.equal(gone.status, 410);
  assert.equal(gone.data.error, 'client_archived');
  assert.equal((await post(c.intakeToken, undefined, { method: 'GET' })).status, 410);
});

test('intake notifies ntfy and Telegram with minimal details, and never fails because of them', async () => {
  const fetch = mockFetch();
  const { post, addClient, ops, leads } = setup({ fetch });
  const c = await addClient();
  const saved = await ops({ type: 'settings.save', settings: { ntfyUrl: 'https://ntfy.sh/rr-desk-abc123', telegramToken: '123456:ABCdefGhIJKlmnoPQRstuVWxyz12345', telegramChatId: 987654 } });
  assert.equal(saved.data.results[0].ok, true);

  const r = await post(c.intakeToken, { full_name: 'sara ali', phone_number: '0507651298', email: 'sara@example.com', _service: 'Full body PPF' });
  const id = r.data.ids[0];
  assert.equal(fetch.calls.length, 2);
  const ntfy = fetch.calls.find((x) => x.url.startsWith('https://ntfy.sh/'));
  assert.equal(ntfy.url, 'https://ntfy.sh/rr-desk-abc123');
  assert.equal(ntfy.method, 'POST');
  assert.equal(ntfy.headers.title, 'New lead - Glossy PPF');
  assert.equal(ntfy.headers.click, `${ORIGIN}/desk#lead=${id}`);
  assert.equal(ntfy.headers.tags, 'bell');
  assert.equal(ntfy.headers.priority, 'high');
  assert.equal(ntfy.body, `Reply within 5 minutes: ${ORIGIN}/desk#lead=${id}\nSara · Full body PPF`);
  assert.ok(!ntfy.body.includes('0507651298') && !ntfy.body.includes('sara@example.com'), 'no phone or email in alerts');
  const tg = fetch.calls.find((x) => x.url.startsWith('https://api.telegram.org/'));
  assert.equal(tg.url, 'https://api.telegram.org/bot123456:ABCdefGhIJKlmnoPQRstuVWxyz12345/sendMessage');
  assert.deepEqual(JSON.parse(tg.body), { chat_id: '987654', text: `New lead · Glossy PPF\nReply within 5 minutes: ${ORIGIN}/desk#lead=${id}\nSara · Full body PPF`, disable_web_page_preview: true });

  // Duplicates are not announced; at most 3 alerts per request.
  fetch.calls.length = 0;
  await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' });
  assert.equal(fetch.calls.length, 0);
  await post(c.intakeToken, Array.from({ length: 5 }, (_, i) => ({ full_name: `P${i}`, phone_number: `05570000${i}1` })));
  assert.equal(fetch.calls.filter((x) => x.url.startsWith('https://ntfy.sh/')).length, 3);

  // Details off: nothing about the lead.
  await ops({ type: 'settings.save', settings: { notifyDetails: false, telegramToken: '' } });
  fetch.calls.length = 0;
  const quiet = await post(c.intakeToken, { full_name: 'Mona', phone_number: '0507000001', _service: 'Tint' });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].body, `Open Lead Desk: ${ORIGIN}/desk#lead=${quiet.data.ids[0]}`);
  assert.equal(fetch.calls[0].headers.title, 'New lead - Glossy PPF');

  // Non-ASCII client names are encoded for the header.
  const ar = await addClient({ name: 'لمعة' });
  fetch.calls.length = 0;
  await post(ar.intakeToken, { full_name: 'Ali', phone_number: '0507000002' });
  const encoded = fetch.calls[0].headers.title;
  assert.match(encoded, /^=\?UTF-8\?B\?.+\?=$/);
  assert.equal(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8'), 'New lead · لمعة');

  // A broken notification service must not lose the lead.
  const broken = setup({ fetch: async () => { throw new Error('network down'); } });
  const bc = await broken.addClient();
  await broken.ops({ type: 'settings.save', settings: { ntfyUrl: 'https://ntfy.sh/x', telegramToken: '123456:ABCdefGhIJKlmnoPQRstuVWxyz12345', telegramChatId: '1' } });
  const saved2 = await broken.post(bc.intakeToken, { full_name: 'Sara', phone_number: '0507651298' });
  assert.equal(saved2.status, 200);
  assert.equal(broken.leads().length, 1);
  const test = await broken.ops({ type: 'notify.test' });
  assert.deepEqual(test.data.results[0].data, { ntfy: 'error: could not reach ntfy', telegram: 'error: could not reach Telegram' });
  assert.ok(leads().length >= 7);
});

test('notify.test reports each channel', async () => {
  const fetch = mockFetch((url) => (url.includes('telegram') ? Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }) : new Response('ok')));
  const { ops } = setup({ fetch });
  let r = await ops({ type: 'notify.test' });
  assert.deepEqual(r.data.results[0], { opId: r.data.results[0].opId, ok: true, data: { ntfy: 'off', telegram: 'off' } });
  await ops({ type: 'settings.save', settings: { ntfyUrl: 'https://ntfy.sh/rr-desk-x', telegramToken: '123456:ABCdefGhIJKlmnoPQRstuVWxyz12345', telegramChatId: '42' } });
  r = await ops({ type: 'notify.test' });
  assert.deepEqual(r.data.results[0].data, { ntfy: 'ok', telegram: 'error: Bad Request: chat not found' });
  assert.equal(fetch.calls[0].body, 'Test alert from Lead Desk');
});

test('GET answers "unchanged" when the revision matches', async () => {
  const { api, addClient, post } = setup();
  const first = await api('GET');
  assert.deepEqual(await api('GET', undefined, { query: `?rev=${first.data.rev}` }).then((r) => r.data), { unchanged: true, rev: '0.0', keySource: 'desk' });
  const c = await addClient();
  const second = await api('GET', undefined, { query: '?rev=0.0' });
  assert.equal(second.data.rev, '1.0');
  assert.equal(second.data.config.clients[0].id, c.id);
  await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' });
  const third = await api('GET', undefined, { query: '?rev=1.0' });
  assert.equal(third.data.rev, '1.1');
  assert.equal(third.data.leads.length, 1);
  assert.deepEqual((await api('GET', undefined, { query: '?rev=1.1' })).data, { unchanged: true, rev: '1.1', keySource: 'desk' });
});

test('GET and POST only send open leads plus recent finished ones', async () => {
  const { api, store, clock } = setup();
  store.put('leads', {
    rev: 3,
    ops: [],
    leads: [
      baseLead({ id: 'open-old', createdAt: T0 - 300 * DAY, updatedAt: T0 - 300 * DAY }),
      baseLead({ id: 'booked-old', status: 'booked', bookedFor: '2025-01-01T10:00', createdAt: T0 - 300 * DAY, updatedAt: T0 - 300 * DAY }),
      baseLead({ id: 'lost-90', status: 'lost', createdAt: T0 - 90 * DAY, updatedAt: T0 - 90 * DAY }),
      baseLead({ id: 'showed-10', status: 'booked', outcome: 'showed', createdAt: T0 - 20 * DAY, updatedAt: T0 - 10 * DAY }),
    ],
  });
  clock.now = T0;
  const ids = (r) => r.data.leads.map((l) => l.id).sort();
  assert.deepEqual(ids(await api('GET')), ['booked-old', 'open-old', 'showed-10']);
  assert.deepEqual(ids(await api('GET', undefined, { query: '?days=120' })), ['booked-old', 'lost-90', 'open-old', 'showed-10']);
  assert.deepEqual(ids(await api('POST', { ops: [] }, { query: '?days=5' })), ['booked-old', 'open-old']);
});

test('lead ops: update is idempotent by opId; add and delete', async () => {
  const { ops, post, addClient, leads } = setup();
  const c = await addClient();
  const id = (await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' })).data.ids[0];
  const op = { opId: 'op-touch-1', type: 'lead.update', id, upd: { touch: 'first', at: T0 + 1000 } };
  const r1 = await ops(op);
  assert.deepEqual(r1.data.results, [{ opId: 'op-touch-1', ok: true }]);
  const r2 = await ops(op);
  assert.deepEqual(r2.data.results, [{ opId: 'op-touch-1', ok: true, dup: true }]);
  assert.equal(r2.data.rev, r1.data.rev, 'no write for a replayed op');
  const lead = leads().find((l) => l.id === id);
  assert.equal(lead.touches.length, 1);
  assert.equal(lead.status, 'contacted');
  assert.equal(r1.data.leads.find((l) => l.id === id).status, 'contacted');

  const bad = await ops({ type: 'lead.update', id: 'l_missing', upd: {} }, { type: 'lead.update', id, upd: 'x' });
  assert.deepEqual(bad.data.results.map((x) => x.error), ['not_found', 'invalid_update']);

  const added = await ops(
    { type: 'lead.add', lead: { clientId: c.id, name: 'Walk-in Omar', phone: '055 222 3333', service: 'Tint', notes: 'Called the shop', answers: [{ q: 'Car', a: 'Lexus' }] } },
    { type: 'lead.add', lead: { clientId: c.id, name: 'Sara again', phone: '0507651298' } },
    { type: 'lead.add', lead: { clientId: 'c_nope', name: 'X' } },
    { type: 'lead.add', lead: { clientId: c.id, notes: 'nothing' } },
  );
  const [a, b, x, y] = added.data.results;
  assert.equal(a.ok, true);
  const manual = leads().find((l) => l.id === a.data.id);
  assert.deepEqual([manual.source, manual.phone, manual.service, manual.notes, manual.answers[0].a], ['manual', '971552223333', 'Tint', 'Called the shop', 'Lexus']);
  assert.deepEqual(b.data, { id: b.data.id, status: 'dup', dupOf: id });
  assert.equal(x.error, 'unknown_client');
  assert.equal(y.error, 'no_contact_details');

  const del = await ops({ type: 'lead.delete', ids: [a.data.id, b.data.id] });
  assert.deepEqual(del.data.results[0].data, { deleted: 2 });
  assert.deepEqual(leads().map((l) => l.id), [id]);
});

test('lead.import takes Meta CSV rows: p: phones, ids, duplicates and no alerts', async () => {
  const fetch = mockFetch();
  const { ops, post, addClient, leads } = setup({ fetch });
  const c = await addClient();
  await ops({ type: 'settings.save', settings: { ntfyUrl: 'https://ntfy.sh/rr-desk-x' } });
  const existing = (await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' })).data.ids[0];
  fetch.calls.length = 0;

  const header = ['id', 'created_time', 'ad_id', 'ad_name', 'adset_name', 'campaign_name', 'form_name', 'is_organic', 'platform', 'what_service_do_you_need?', 'full_name', 'phone_number', 'email'];
  const lines = [
    ['l:111', '2025-10-12T18:30:00+04:00', 'ag:1', 'Video', 'Dubai', 'PPF Oct', 'PPF form', 'false', 'ig', 'full_front_ppf', 'Mona Saeed', 'p:+971501230001', 'mona@example.com'],
    ['l:222', '2025-10-13T09:15:00+04:00', 'ag:1', 'Video', 'Dubai', 'PPF Oct', 'PPF form', 'false', 'fb', 'ceramic_coating', 'Khalid', 'p:+971501230002', ''],
    ['l:111', '2025-10-12T18:30:00+04:00', 'ag:1', 'Video', 'Dubai', 'PPF Oct', 'PPF form', 'false', 'ig', 'full_front_ppf', 'Mona Saeed', 'p:+971501230001', 'mona@example.com'],
    ['l:333', '2025-10-13T20:00:00+04:00', 'ag:2', 'Image', 'Dubai', 'PPF Oct', 'PPF form', 'false', 'fb', 'tint', 'Sara A', 'p:+971507651298', ''],
    ['l:444', '2025-10-13T21:00:00+04:00', 'ag:2', 'Image', 'Dubai', 'PPF Oct', 'PPF form', 'false', 'fb', 'tint', '', '', ''],
  ];
  const csv = [header, ...lines].map((r) => r.join('\t')).join('\n') + '\n';
  const rows = D.parseCsv(D.decodeBytes(new Uint8Array(Buffer.from('﻿' + csv, 'utf16le'))));
  assert.equal(rows.length, 5);
  const r = await ops({ type: 'lead.import', clientId: c.id, rows });
  assert.deepEqual(r.data.results[0].data, { added: 3, skipped: 2, dups: 1 });
  assert.equal(fetch.calls.length, 0, 'imports do not send alerts');
  const mona = leads().find((l) => l.extId === '111');
  assert.equal(mona.source, 'import');
  assert.equal(mona.phone, '971501230001');
  assert.equal(mona.createdAt, Date.UTC(2025, 9, 12, 14, 30));
  assert.equal(mona.service, 'full front ppf');
  assert.equal(mona.ad.form, 'PPF form');
  assert.equal(mona.status, 'new');
  const sara = leads().find((l) => l.extId === '333');
  assert.equal(sara.status, 'dup');
  assert.equal(sara.dupOf, existing);

  const again = await ops({ type: 'lead.import', clientId: c.id, rows });
  assert.deepEqual(again.data.results[0].data, { added: 0, skipped: 5, dups: 0 });
  const tooMany = await ops({ type: 'lead.import', clientId: c.id, rows: Array.from({ length: 2001 }, () => ({})) });
  assert.equal(tooMany.data.results[0].error, 'too_many_rows');
});

test('settings.save validates and caps values', async () => {
  const { ops, store } = setup();
  const r = await ops(
    { type: 'settings.save', settings: { workStart: '9am' } },
    { type: 'settings.save', settings: { followup1Min: 10 } },
    { type: 'settings.save', settings: { followup1Min: 2000 } },
    { type: 'settings.save', settings: { ntfyUrl: 'http://ntfy.sh/x' } },
    { type: 'settings.save', settings: { telegramToken: 'nope' } },
    { type: 'settings.save', settings: { followup2At: '24:00' } },
  );
  assert.deepEqual(r.data.results.map((x) => x.error), ['bad_time', 'bad_followup', 'bad_followup', 'bad_ntfy_url', 'bad_telegram_token', 'bad_time']);
  assert.equal(store.peek('config'), null, 'nothing written');
  const ok = await ops({ type: 'settings.save', settings: { myName: '  Samil '.padEnd(200, 'x'), workStart: '08:30', workEnd: '20:00', followup1Min: 90, followup2At: '11:00', ntfyUrl: 'https://ntfy.sh/rr-desk-abc', notifyDetails: false, extra: 'ignored' } });
  const s = ok.data.config.settings;
  assert.equal(s.myName.length, 60);
  assert.ok(s.myName.startsWith('Samil'));
  assert.deepEqual([s.workStart, s.workEnd, s.followup1Min, s.followup2At, s.ntfyUrl, s.notifyDetails], ['08:30', '20:00', 90, '11:00', 'https://ntfy.sh/rr-desk-abc', false]);
  assert.ok(!('extra' in s));
  const partial = await ops({ type: 'settings.save', settings: { myName: 'Samil' } });
  assert.equal(partial.data.config.settings.workStart, '08:30', 'unsent fields are kept');
});

test('telegram.detect finds the latest private chat', async () => {
  const token = '123456:ABCdefGhIJKlmnoPQRstuVWxyz12345';
  const updates = [
    { update_id: 1, message: { chat: { id: 111, type: 'private', first_name: 'Old' } } },
    { update_id: 2, message: { chat: { id: 555, type: 'private', first_name: 'Samil', last_name: 'K' } } },
    { update_id: 3, message: { chat: { id: -100200, type: 'group', title: 'Team' } } },
  ];
  const fetch = mockFetch((url) => {
    if (url.includes('bot999999:')) return Response.json({ ok: false, description: 'Unauthorized' }, { status: 401 });
    if (url.includes('bot222222:')) return Response.json({ ok: true, result: [] });
    return Response.json({ ok: true, result: updates });
  });
  const { ops } = setup({ fetch });
  const r = await ops({ type: 'telegram.detect', token });
  assert.deepEqual(r.data.results[0].data, { chatId: '555', name: 'Samil K' });
  assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${token}/getUpdates`);
  assert.equal((await ops({ type: 'telegram.detect', token: '222222:ABCdefGhIJKlmnoPQRstuVWxyz12345' })).data.results[0].error, 'no_messages');
  assert.equal((await ops({ type: 'telegram.detect', token: '999999:ABCdefGhIJKlmnoPQRstuVWxyz12345' })).data.results[0].error, 'bad_token');
  assert.equal((await ops({ type: 'telegram.detect', token: 'x/../../evil' })).data.results[0].error, 'bad_token');
  assert.equal(fetch.calls.length, 3, 'a malformed token is never sent anywhere');
});

test('writes prune old finished leads and cap the list', async () => {
  const { ops, store, addClient, leads } = setup();
  const c = await addClient();
  store.put('leads', {
    rev: 7,
    ops: Array.from({ length: 600 }, (_, i) => `old-op-${i}`),
    leads: [
      baseLead({ id: 'lost-old', clientId: c.id, status: 'lost', createdAt: T0 - 200 * DAY, updatedAt: T0 - 181 * DAY }),
      baseLead({ id: 'showed-old', clientId: c.id, status: 'booked', outcome: 'showed', createdAt: T0 - 200 * DAY, updatedAt: T0 - 181 * DAY }),
      baseLead({ id: 'new-old', clientId: c.id, createdAt: T0 - 300 * DAY, updatedAt: T0 - 300 * DAY }),
      baseLead({ id: 'lost-recent', clientId: c.id, status: 'lost', createdAt: T0 - 100 * DAY, updatedAt: T0 - 100 * DAY }),
    ],
  });
  await ops({ type: 'lead.add', lead: { clientId: c.id, name: 'Fresh', phone: '0559991111' } });
  const doc = store.peek('leads');
  assert.equal(doc.rev, 8);
  assert.equal(doc.ops.length, 500);
  assert.deepEqual(leads().map((l) => l.id).slice(0, 2), ['new-old', 'lost-recent']);
  assert.equal(leads().length, 3);

  const many = Array.from({ length: 5995 }, (_, i) => baseLead({ id: `open-${i}`, clientId: c.id, phone: '', createdAt: T0 - i * MIN, updatedAt: T0 - i * MIN }));
  const closed = Array.from({ length: 10 }, (_, i) => baseLead({ id: `closed-${i}`, clientId: c.id, status: 'noanswer', phone: '', createdAt: T0 - DAY, updatedAt: T0 - (10 - i) * HOUR }));
  store.put('leads', { rev: 9, ops: [], leads: [...many, ...closed] });
  await ops({ type: 'lead.add', lead: { clientId: c.id, name: 'One more', phone: '0559992222' } });
  const after = leads();
  assert.equal(after.length, 6000);
  assert.deepEqual(after.filter((l) => l.status === 'noanswer').map((l) => l.id), ['closed-6', 'closed-7', 'closed-8', 'closed-9']);
  assert.equal(after.filter((l) => l.id.startsWith('open-')).length, 5995);
});

test('concurrent writes from two devices and the intake link all land', async () => {
  const { ops, post, addClient, leads, store } = setup();
  const c = await addClient();
  const id = (await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' })).data.ids[0];
  const results = await Promise.all([
    ops({ type: 'lead.update', id, upd: { set: { status: 'replied' } } }),
    ops({ type: 'lead.add', lead: { clientId: c.id, name: 'Walk-in', phone: '0552223333' } }, { type: 'settings.save', settings: { myName: 'Samil' } }),
    post(c.intakeToken, { full_name: 'Mona', phone_number: '0501230001' }),
    post(c.intakeToken, { full_name: 'Khalid', phone_number: '0501230002' }),
  ]);
  results.forEach((r) => assert.equal(r.status, 200));
  const final = leads();
  assert.equal(final.length, 4);
  assert.equal(final.find((l) => l.id === id).status, 'replied');
  assert.deepEqual(final.map((l) => l.name).sort(), ['Khalid', 'Mona', 'Sara', 'Walk-in']);
  assert.equal(store.peek('config').settings.myName, 'Samil');
  assert.equal(store.peek('leads').rev, 5);
});

test('pruning never drops open leads; intake refuses with desk_full while admin ops keep working', async () => {
  const { ops, post, store, addClient, leads } = setup();
  const c = await addClient();
  const open = Array.from({ length: 6000 }, (_, i) => baseLead({ id: `open-${i}`, clientId: c.id, phone: '', createdAt: T0 - DAY - i * MIN, updatedAt: T0 - DAY - i * MIN }));
  const lost = baseLead({ id: 'lost-1', clientId: c.id, status: 'lost', phone: '', createdAt: T0 - 2 * DAY, updatedAt: T0 - 2 * DAY });
  store.put('leads', { rev: 1, ops: [], leads: [...open, lost] });

  const full = await post(c.intakeToken, { full_name: 'Late lead', phone_number: '0551234000' });
  assert.equal(full.status, 503);
  assert.equal(full.data.error, 'desk_full');
  assert.equal(full.headers.get('access-control-allow-origin'), '*');
  assert.equal(store.peek('leads').rev, 1, 'nothing written');

  const upd = await ops({ type: 'lead.update', id: 'open-0', upd: { touch: 'first' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.results[0].ok, true);
  assert.equal(leads().length, 6000, 'only the finished lead was pruned');
  assert.ok(!leads().some((l) => l.id === 'lost-1'));
  const add = await ops({ type: 'lead.add', lead: { clientId: c.id, name: 'Walk-in', phone: '0552223333' } });
  assert.equal(add.data.results[0].ok, true);
  assert.equal(leads().length, 6001, 'open leads are never pruned, even over the cap');
  assert.equal((await post(c.intakeToken, { full_name: 'Late lead', phone_number: '0551234000' })).data.error, 'desk_full');

  // Size counts too: the oldest finished leads go first, and a desk of open leads alone refuses intake.
  const heavy = setup();
  const hc = await heavy.addClient();
  const notes = 'x'.repeat(9000);
  heavy.store.put('leads', {
    rev: 1,
    ops: [],
    leads: [
      ...Array.from({ length: 300 }, (_, i) => baseLead({ id: `open-${i}`, clientId: hc.id, phone: '', notes, createdAt: T0 - DAY })),
      ...Array.from({ length: 100 }, (_, i) => baseLead({ id: `done-${i}`, clientId: hc.id, status: 'lost', phone: '', notes, createdAt: T0 - 5 * DAY, updatedAt: T0 - (100 - i) * HOUR })),
    ],
  });
  assert.equal((await heavy.post(hc.intakeToken, { full_name: 'Sara', phone_number: '0507651298' })).status, 200);
  const kept = heavy.leads();
  assert.ok(Buffer.byteLength(JSON.stringify(heavy.store.peek('leads'))) <= 3_500_000);
  assert.equal(kept.filter((l) => l.id.startsWith('open-')).length, 300);
  assert.ok(!kept.some((l) => l.id === 'done-0') && kept.some((l) => l.id === 'done-99'), 'oldest finished leads dropped first');
  heavy.store.put('leads', { rev: 5, ops: [], leads: Array.from({ length: 400 }, (_, i) => baseLead({ id: `open-${i}`, clientId: hc.id, phone: '', notes, createdAt: T0 - DAY })) });
  const tooBig = await heavy.post(hc.intakeToken, { full_name: 'Mona', phone_number: '0501230001' });
  assert.deepEqual([tooBig.status, tooBig.data.error], [503, 'desk_full']);
});

test('intake: per-sender rate limit keyed by a hash of the IP, which is all that is stored', async () => {
  const { post, addClient, leads, clock } = setup();
  const a = await addClient();
  const b = await addClient({ name: 'FitLab', niche: 'fitness' });
  const ip = (addr) => ({ headers: { 'x-nf-client-connection-ip': addr } });
  const batch = (n, size) => Array.from({ length: size }, (_, i) => ({ full_name: `Lead ${n}-${i}`, phone_number: `05582${String(n * 100 + i).padStart(5, '0')}` }));
  assert.equal((await post(a.intakeToken, batch(0, 15), ip('203.0.113.7'))).status, 200);
  // The same sender on another client's link is still the same sender: 15 + 6 > 20.
  const limited = await post(b.intakeToken, batch(1, 6), ip('203.0.113.7'));
  assert.deepEqual([limited.status, limited.data.error], [429, 'rate_limited']);
  assert.equal((await post(b.intakeToken, batch(1, 5), ip('203.0.113.7'))).status, 200);
  const viaXff = await post(b.intakeToken, batch(2, 1), { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  assert.equal(viaXff.status, 429, 'x-forwarded-for (first IP) is the fallback');
  assert.equal((await post(b.intakeToken, batch(2, 1), ip('198.51.100.9'))).status, 200, 'another sender');
  assert.equal((await post(b.intakeToken, batch(3, 1))).status, 200, 'no IP header: only the per-client cap applies');

  const stored = leads();
  assert.equal(new Set(stored.map((l) => l.ipHash)).size, 3, 'two senders plus one without an IP');
  for (const l of stored) if (l.ipHash) assert.match(l.ipHash, /^[\w-]{16}$/);
  assert.equal(stored.find((l) => l.name === 'Lead 3-0').ipHash, undefined);
  assert.ok(!JSON.stringify(stored).includes('203.0.113.7') && !JSON.stringify(stored).includes('198.51.100.9'), 'the IP itself is never stored');
  clock.now += 11 * MIN;
  assert.equal((await post(a.intakeToken, batch(4, 20), ip('203.0.113.7'))).status, 200);
});

test('alerts put the desk link first and strip links from the lead\'s own words', async () => {
  const fetch = mockFetch();
  const { post, addClient, ops, leads } = setup({ fetch });
  const c = await addClient();
  await ops({ type: 'settings.save', settings: { ntfyUrl: 'https://ntfy.sh/rr-desk-abc123', telegramToken: '123456:ABCdefGhIJKlmnoPQRstuVWxyz12345', telegramChatId: '42' } });
  const r = await post(c.intakeToken, { full_name: 'https://evil.example/login Sara', phone_number: '0507651298', which_service: 'PPF www.evil.example' });
  const id = r.data.ids[0];
  const link = `Reply within 5 minutes: ${ORIGIN}/desk#lead=${id}`;
  assert.equal(fetch.calls.find((x) => x.url.startsWith('https://ntfy.sh/')).body, `${link}\nSara · no service given`);
  assert.equal(JSON.parse(fetch.calls.find((x) => x.url.includes('telegram')).body).text, `New lead · Glossy PPF\n${link}\nSara · no service given`);
  const lead = leads().find((l) => l.id === id);
  assert.ok(lead.flags.includes('has-link'));
  assert.equal(lead.service, '');

  fetch.calls.length = 0;
  const r2 = await post(c.intakeToken, { full_name: 'www.evil.example', phone_number: '0507651299', _service: 'Tint' });
  assert.equal(fetch.calls[0].body, `Reply within 5 minutes: ${ORIGIN}/desk#lead=${r2.data.ids[0]}\nNo name given · Tint`);
  for (const call of fetch.calls) assert.ok(!String(call.body).includes('evil'));
});

test('intake: _redirect only goes back to the site the form was on; otherwise a built-in thank-you page', async () => {
  const { post, addClient, leads } = setup();
  const c = await addClient();
  const type = 'application/x-www-form-urlencoded';
  const form = (extra = '') => `full_name=Omar&phone_number=0551234321&_redirect=https%3A%2F%2Fglossy.example%2Fthanks${extra}`;

  const same = await post(c.intakeToken, form(), { type, headers: { origin: 'https://glossy.example' } });
  assert.equal(same.status, 303);
  assert.equal(same.headers.get('location'), 'https://glossy.example/thanks');
  assert.equal((await post(c.intakeToken, form(), { type, headers: { referer: 'https://glossy.example/contact?x=1' } })).status, 303, 'Referer when there is no Origin');

  const others = [{ origin: 'https://evil.example' }, { origin: 'null' }, { referer: 'https://evil.example/' }, {}, { origin: 'https://evil.example', referer: 'https://glossy.example/' }];
  for (const headers of others) {
    const r = await post(c.intakeToken, form(), { type, headers });
    assert.equal(r.status, 200, JSON.stringify(headers));
    assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(r.text, /Thanks, we got your details\. We'll be in touch shortly\./);
  }
  assert.equal(leads().length, 2 + others.length, 'every one was stored');

  // Honeypot posts get the same answer and store nothing.
  const bot = await post(c.intakeToken, form('&_gotcha=spam'), { type, headers: { origin: 'https://glossy.example' } });
  assert.equal(bot.status, 303);
  const bot2 = await post(c.intakeToken, form('&_gotcha=spam'), { type, headers: { origin: 'https://evil.example' } });
  assert.equal(bot2.status, 200);
  assert.match(bot2.text, /Thanks, we got your details/);
  assert.equal(leads().length, 2 + others.length);

  // JSON posts still get JSON, and errors stay JSON.
  const json = await post(c.intakeToken, { full_name: 'Mona', phone_number: '0551234322', _redirect: 'https://glossy.example/thanks' }, { headers: { origin: 'https://glossy.example' } });
  assert.deepEqual([json.status, json.data.ok], [200, true]);
  const empty = await post(c.intakeToken, 'message=hi', { type, headers: { origin: 'https://glossy.example' } });
  assert.deepEqual([empty.status, empty.data.error], [400, 'no_contact_details']);
});

test('admin responses say which env var the key came from', async () => {
  const { api, post, addClient } = setup();
  const queue = { secret: KEY, keySource: 'queue' };
  assert.equal((await api('GET')).data.keySource, 'desk', 'a plain string is LEAD_DESK_KEY');
  assert.equal((await api('GET', undefined, { secret: { secret: KEY, keySource: 'desk' } })).data.keySource, 'desk');
  const got = await api('GET', undefined, { secret: queue });
  assert.equal(got.data.keySource, 'queue');
  assert.equal((await api('POST', { ops: [] }, { secret: queue })).data.keySource, 'queue');
  assert.deepEqual((await api('GET', undefined, { secret: queue, query: `?rev=${got.data.rev}` })).data, { unchanged: true, rev: '0.0', keySource: 'queue' });
  assert.deepEqual(await api('GET', undefined, { secret: { secret: undefined, keySource: 'queue' } }), { status: 503, data: { error: 'not_configured' } });
  assert.deepEqual(await api('GET', undefined, { secret: queue, key: 'q'.repeat(32) }), { status: 401, data: { error: 'unauthorized' } });
  const c = await addClient();
  assert.equal((await post(c.intakeToken, { full_name: 'Sara', phone_number: '0507651298' }, { secret: queue })).status, 200, 'intake works with either key');
});

test('replayed ops answer dup with the data the page needs', async () => {
  const { api, leads } = setup();
  const send = async (op) => (await api('POST', { ops: [op] })).data;

  const create = { opId: 'op-client-1', type: 'client.save', client: { name: 'Glossy PPF', niche: 'car' } };
  const made = (await send(create)).results[0];
  const again = await send(create);
  assert.deepEqual(again.results[0], { opId: 'op-client-1', ok: true, dup: true, data: made.data });
  assert.equal(again.config.clients.length, 1, 'not created twice');
  const edit = { opId: 'op-client-2', type: 'client.save', client: { id: made.data.id, location: 'Al Quoz' } };
  await send(edit);
  assert.equal((await send(edit)).results[0].data.location, 'Al Quoz');
  const rotate = { opId: 'op-rotate-1', type: 'client.rotate', id: made.data.id };
  const token = (await send(rotate)).results[0].data.intakeToken;
  assert.equal((await send(rotate)).results[0].data.intakeToken, token, 'rotated once');
  const settings = { opId: 'op-set-1', type: 'settings.save', settings: { myName: 'Samil' } };
  await send(settings);
  assert.equal((await send(settings)).results[0].data.myName, 'Samil');

  const add = { opId: 'op-add-1', type: 'lead.add', lead: { clientId: made.data.id, name: 'Walk-in Omar', phone: '055 222 3333' } };
  const added = (await send(add)).results[0];
  assert.deepEqual((await send(add)).results[0], { opId: 'op-add-1', ok: true, dup: true, data: added.data });
  assert.equal(leads().length, 1);
  const upd = { opId: 'op-upd-1', type: 'lead.update', id: added.data.id, upd: { touch: 'first' } };
  await send(upd);
  assert.deepEqual((await send(upd)).results[0], { opId: 'op-upd-1', ok: true, dup: true });
  await send({ opId: 'op-del-1', type: 'lead.delete', ids: [added.data.id] });
  assert.deepEqual((await send(add)).results[0], { opId: 'op-add-1', ok: true, dup: true }, 'gone: nothing to report');
});
