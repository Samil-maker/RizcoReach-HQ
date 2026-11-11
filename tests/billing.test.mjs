// Tests for fees, emails, recurring invoices and reminders (netlify/functions/pay.mts, netlify/billing/*).
//   node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, runScheduled } from '../netlify/functions/pay.mts';
import { addDays, DEFAULT_SETTINGS, feeOn, grossUp, nextDate, priceWithFee } from '../netlify/billing/core.mts';

const tick = () => new Promise((r) => setImmediate(r));

function memStore(seed) {
  const docs = new Map();
  let n = 0;
  if (seed) docs.set('invoices', { json: JSON.stringify(seed), etag: '"seed"' });
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
    peek: () => (docs.has('invoices') ? JSON.parse(docs.get('invoices').json) : null),
  };
}

/** A fake Ziina: remembers created intents; `complete(id)` marks one paid. */
function fakeZiina() {
  const intents = new Map();
  const calls = [];
  let n = 0;
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || 'GET', body });
    const u = new URL(url);
    if ((init.method || 'GET') === 'POST') {
      const id = `pi_${++n}`;
      const intent = { id, status: 'requires_payment_instrument', amount: body.amount, currency_code: body.currency_code, redirect_url: `https://pay.ziina.com/x/${id}` };
      intents.set(id, intent);
      return new Response(JSON.stringify(intent), { status: 201 });
    }
    const m = u.pathname.match(/^\/api\/payment_intent\/(.+)$/);
    if (m && intents.has(m[1])) return new Response(JSON.stringify(intents.get(m[1])));
    return new Response('{}', { status: 404 });
  };
  fn.calls = calls;
  fn.complete = (id, extra = {}) => Object.assign(intents.get(id), { status: 'completed', card_details: { card_brand: 'VISA', card_last_four: '4242' }, ...extra });
  return fn;
}

/** A fake mailbox. `fail` makes the next sends throw. */
function fakeMail() {
  const sent = [];
  const fn = async (msg) => {
    if (fn.fail) throw new Error('Invalid login: 535 bad credentials');
    sent.push(msg);
  };
  fn.sent = sent;
  fn.fail = false;
  return fn;
}

const ADMIN = 'a'.repeat(32);
const ORIGIN = 'https://www.rizcoreach.ae';
const OWNER = 'owner@rizcoreach.example';
/** 11 November 2026, 10:00 in Dubai. */
const NOW = Date.UTC(2026, 10, 11, 6, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function setup({ env = {}, mail = fakeMail(), now = NOW, seed } = {}) {
  const store = memStore(seed);
  const fetch = fakeZiina();
  const clock = { now };
  const E = { ziinaKey: 'zk', testMode: false, adminKey: ADMIN, mailFrom: mail ? OWNER : undefined, siteUrl: ORIGIN, ...env };
  const deps = { fetch, now: () => clock.now, mail: mail || undefined };
  const call = async (path, { method = 'GET', body, auth } = {}) => {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), store, E, deps);
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, data: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
  };
  const op = (body) => call('/api/pay', { method: 'POST', auth: ADMIN, body });
  const create = async (invoice) => (await op({ op: 'create', invoice })).data.result;
  const cron = () => runScheduled(store, E, deps);
  const stored = (id) => store.peek().invoices.find((i) => i.id === id);
  return { store, clock, call, op, create, cron, stored, fetch, mail };
}

test('fee maths: what to charge so the full amount arrives', () => {
  const fee = DEFAULT_SETTINGS.fee; // 2.6% + AED 1
  assert.equal(grossUp(30000, fee), 30904);
  for (const net of [200, 999, 30000, 42500, 1234567]) {
    const charge = grossUp(net, fee);
    assert.ok(charge - feeOn(charge, fee) >= net, `AED ${net / 100} arrives in full`);
    assert.ok(charge - feeOn(charge, fee) - net <= 1, 'with no more than a fil to spare');
  }
  const flat = { mode: 'line', percentBp: 0, fixedFils: 100 };
  assert.equal(grossUp(30000, flat), 30100);
});

test('built into the price: the lines are raised and still add up', () => {
  const items = [
    { description: 'A', qty: 3, rate: 10000, amount: 30000 },
    { description: 'B', qty: 1, rate: 12550, amount: 12550 },
  ];
  const p = priceWithFee(items, 'included', DEFAULT_SETTINGS.fee);
  assert.equal(p.onlineFee, 0);
  assert.equal(p.amount, p.items.reduce((s, i) => s + i.amount, 0));
  for (const i of p.items) assert.equal(i.amount, Math.round(i.qty * i.rate));
  assert.ok(p.amount >= grossUp(42550, DEFAULT_SETTINGS.fee));
  assert.ok(p.amount - grossUp(42550, DEFAULT_SETTINGS.fee) <= 5, 'rounding adds a few fils at most');
  assert.equal(p.feeCovered, p.amount - 42550);
});

test('an invoice with the fee built in charges the raised total', async () => {
  const { create, call, fetch } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 300, description: 'Meta ads management', feeMode: 'included' });
  assert.equal(inv.amount, 30904);
  assert.equal(inv.feeCovered, 904);
  assert.equal(inv.onlineFee, 0);
  assert.equal(inv.payTotal, 30904);
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  assert.equal(fetch.calls.at(-1).body.amount, 30904);
  const pub = (await call(`/api/pay/${inv.token}`)).data.invoice;
  assert.equal(pub.amount, 30904);
  assert.equal(pub.onlineFee, 0);
  assert.equal(pub.feeCovered, undefined, 'the client only sees a price');
});

test('an invoice with the fee as a line charges invoice + fee, and records what Ziina kept', async () => {
  const { create, call, fetch, stored } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 300, feeMode: 'line' });
  assert.equal(inv.amount, 30000);
  assert.equal(inv.onlineFee, 904);
  const pub = (await call(`/api/pay/${inv.token}`)).data.invoice;
  assert.equal(pub.payTotal, 30904);
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  assert.equal(fetch.calls.at(-1).body.amount, 30904);

  fetch.complete('pi_1', { amount: 30000 }); // the invoice amount alone is not enough
  assert.equal((await call(`/api/pay/${inv.token}/status`)).data.invoice.status, 'unpaid');
  fetch.complete('pi_1', { amount: 30904, fee_amount: 904 });
  const paid = (await call(`/api/pay/${inv.token}/status`)).data.invoice;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paidAmount, 30904);
  assert.equal(stored(inv.id).ziinaFee, 904);
  assert.equal(stored(inv.id).paidVia, 'ziina');
});

test('line items, quantities, a discount and a due date', async () => {
  const { create, op } = setup();
  const inv = await create({
    client: 'X',
    items: [
      { description: 'Website build', qty: 1, rateAed: 4500 },
      { description: 'Care plan', qty: 3, rateAed: 249 },
      { description: 'Discount', rateAed: -250 },
      { description: '', rateAed: '' },
    ],
    dueDays: 7,
  });
  assert.equal(inv.items.length, 3);
  assert.equal(inv.amount, 450000 + 74700 - 25000);
  assert.equal(inv.description, 'Website build, Care plan, Discount');
  assert.equal(inv.issuedOn, '2026-11-11');
  assert.equal(inv.dueOn, '2026-11-18');
  assert.equal((await op({ op: 'create', invoice: { client: 'X', items: [{ description: 'Free', rateAed: 1 }] } })).data.error, 'amount_too_small');
  assert.equal((await op({ op: 'create', invoice: { client: 'X', amountAed: 50, clientEmail: 'nope' } })).data.error, 'invalid_email');
  assert.equal((await op({ op: 'create', invoice: { client: 'X', amountAed: 50, dueOn: '2026-11-01' } })).data.error, 'due_in_past');
  assert.equal((await op({ op: 'create', invoice: { client: 'X', amountAed: 89000, feeMode: 'line' } })).data.error, 'amount_too_large');
});

test('overdue shows on the client page, and opening the link is recorded once', async () => {
  const { create, call, clock, stored } = setup();
  const inv = await create({ client: 'X', amountAed: 50, dueDays: 2 });
  assert.equal((await call(`/api/pay/${inv.token}?preview=1`)).data.invoice.overdue, false);
  assert.equal(stored(inv.id).viewedAt, null, "the owner's own preview does not count as viewed");
  clock.now += HOUR;
  await call(`/api/pay/${inv.token}`);
  assert.equal(stored(inv.id).viewedAt, NOW + HOUR);
  clock.now += 3 * DAY;
  const later = (await call(`/api/pay/${inv.token}`)).data.invoice;
  assert.equal(later.overdue, true);
  assert.equal(stored(inv.id).viewedAt, NOW + HOUR);
});

test('emailing an invoice sends it from the owner with the PDF attached', async () => {
  const { create, op, mail } = setup();
  const inv = await create({ client: 'Art Services LLC', clientEmail: 'Accounts@ArtServices.example', amountAed: 300, description: 'Meta ads management', feeMode: 'included', dueDays: 7 });
  assert.equal(inv.clientEmail, 'accounts@artservices.example');
  const res = await op({ op: 'send', id: inv.id });
  assert.deepEqual(res.data.mail, { ok: true, error: '' });
  assert.equal(res.data.result.sentAt, NOW);
  assert.equal(res.data.result.sentTo, 'accounts@artservices.example');
  assert.equal(res.data.result.outbox.length, 0);
  assert.equal(mail.sent.length, 1);
  const msg = mail.sent[0];
  assert.equal(msg.to, 'accounts@artservices.example');
  assert.equal(msg.fromName, 'RizcoReach');
  assert.equal(msg.subject, `Invoice ${inv.number} from RizcoReach (AED 309.04)`);
  assert.match(msg.text, /due 18 November 2026/);
  assert.match(msg.html, new RegExp(`${ORIGIN}/pay/${inv.token}`));
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].filename, `RizcoReach-invoice-${inv.number}.pdf`);
  assert.equal(Buffer.from(msg.attachments[0].content.slice(0, 5)).toString(), '%PDF-');
  for (const part of [msg.subject, msg.text, msg.html]) assert.doesNotMatch(part, /[–—]/, 'no dashes in the copy');
});

test('create and email in one step; an address can be added when sending', async () => {
  const { op, create, mail } = setup();
  const made = await op({ op: 'create', invoice: { client: 'A', clientEmail: 'a@a.example', amountAed: 50, send: true } });
  assert.equal(made.data.mail.ok, true);
  assert.equal(made.data.result.sendCount, 1);
  assert.equal((await op({ op: 'create', invoice: { client: 'B', amountAed: 50, send: true } })).data.error, 'email_required');

  const b = await create({ client: 'B', amountAed: 50 });
  assert.equal((await op({ op: 'send', id: b.id })).data.error, 'email_required');
  assert.equal((await op({ op: 'send', id: b.id, email: 'not an email' })).data.error, 'invalid_email');
  const sent = await op({ op: 'send', id: b.id, email: 'b@b.example' });
  assert.equal(sent.data.result.clientEmail, 'b@b.example');
  assert.equal(mail.sent.at(-1).to, 'b@b.example');
});

test('without SMTP set up nothing is queued, and a failed send is reported, not retried', async () => {
  const off = setup({ mail: null });
  const a = await off.create({ client: 'A', clientEmail: 'a@a.example', amountAed: 50 });
  const res = await off.op({ op: 'send', id: a.id });
  assert.deepEqual(res.data.mail, { ok: false, error: 'email_not_configured' });
  assert.equal(res.data.mailReady, false);
  assert.equal(off.stored(a.id).outbox.length, 0);

  const { create, op, mail, stored } = setup();
  const b = await create({ client: 'B', clientEmail: 'b@b.example', amountAed: 50 });
  mail.fail = true;
  const bad = await op({ op: 'send', id: b.id });
  assert.equal(bad.data.mail.ok, false);
  assert.match(bad.data.mail.error, /535/);
  assert.equal(stored(b.id).outbox.length, 0);
  assert.equal(stored(b.id).sentAt, null);
  assert.equal(stored(b.id).mailLog.at(-1).ok, false);
});

test('a payment emails the client a receipt and tells the owner, once', async () => {
  const { create, call, fetch, mail, cron } = setup();
  const inv = await create({ client: 'Art Services LLC', clientEmail: 'accounts@artservices.example', amountAed: 425 });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  fetch.complete('pi_1', { fee_amount: 1205 });
  await call(`/api/pay/${inv.token}/status`);
  await call(`/api/pay/${inv.token}/status`);
  await cron();
  assert.equal(mail.sent.length, 2);
  const receipt = mail.sent.find((m) => m.to === 'accounts@artservices.example');
  assert.equal(receipt.subject, `Receipt for invoice ${inv.number} (AED 425.00 paid)`);
  assert.equal(receipt.attachments[0].filename, `RizcoReach-receipt-${inv.number}.pdf`);
  const note = mail.sent.find((m) => m.to === OWNER);
  assert.equal(note.subject, `Paid: ${inv.number}, AED 425.00 from Art Services LLC`);
  assert.match(note.text, /Ziina fee: AED 12\.05/);
  assert.match(note.text, /You receive: AED 412\.95/);
  assert.equal(note.attachments, undefined);
});

test('the schedule finds a payment the client never came back from', async () => {
  const { create, call, fetch, cron, stored } = setup();
  const inv = await create({ client: 'X', amountAed: 50 });
  await call(`/api/pay/${inv.token}/checkout`, { method: 'POST' });
  assert.equal((await cron()).paid, 0);
  fetch.complete('pi_1');
  assert.equal((await cron()).paid, 1);
  assert.equal(stored(inv.id).status, 'paid');
  assert.equal((await cron()).paid, 0);
});

test('schedule dates: weeks, months pinned to a day, quarters and years', () => {
  assert.equal(nextDate('2026-11-11', 'week', 11), '2026-11-18');
  assert.equal(nextDate('2026-11-11', 'month', 11), '2026-12-11');
  assert.equal(nextDate('2026-12-11', 'month', 11), '2027-01-11');
  assert.equal(nextDate('2027-01-31', 'month', 31), '2027-02-28');
  assert.equal(nextDate('2027-02-28', 'month', 31), '2027-03-31');
  assert.equal(nextDate('2026-11-30', 'quarter', 30), '2027-02-28');
  assert.equal(nextDate('2028-02-29', 'year', 29), '2029-02-28');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('a recurring plan bills on its day from 9:00 Dubai time, emails the invoice and moves on a month', async () => {
  const { op, cron, clock, store, mail } = setup({ now: Date.UTC(2026, 10, 11, 3, 0) }); // 07:00 in Dubai
  const saved = await op({
    op: 'planSave',
    plan: { client: 'Art Services LLC', clientEmail: 'accounts@artservices.example', items: [{ description: 'Meta ads management, {month}', rateAed: 300 }], feeMode: 'included', every: 'month', nextOn: '2026-11-11', dueDays: 5, autoEmail: true },
  });
  const plan = saved.data.result;
  assert.equal(plan.active, true);
  assert.equal(saved.data.plans.length, 1);

  assert.equal((await cron()).invoices, 0, 'too early in the day');
  clock.now = NOW;
  const run = await cron();
  assert.equal(run.invoices, 1);
  assert.equal(run.emails, 1);
  const doc = store.peek();
  const inv = doc.invoices[0];
  assert.equal(inv.planId, plan.id);
  assert.equal(inv.description, 'Meta ads management, November 2026');
  assert.equal(inv.amount, 30904);
  assert.equal(inv.dueOn, '2026-11-16');
  assert.equal(inv.sentAt, NOW);
  assert.equal(doc.plans[0].nextOn, '2026-12-11');
  assert.equal(doc.plans[0].count, 1);
  assert.equal(mail.sent[0].to, 'accounts@artservices.example');

  clock.now += HOUR;
  assert.equal((await cron()).invoices, 0, 'one invoice per cycle');
  assert.equal(store.peek().invoices.length, 1);

  clock.now = Date.UTC(2027, 1, 20, 6, 0); // the site was down for months: one invoice, not three
  assert.equal((await cron()).invoices, 1);
  assert.equal(store.peek().plans[0].nextOn, '2027-03-11');
  assert.equal(store.peek().invoices.at(-1).description, 'Meta ads management, February 2027');
});

test('plans can be paused, run by hand, ended and deleted', async () => {
  const { op, cron, store } = setup();
  const bad = (plan) => op({ op: 'planSave', plan }).then((r) => r.data.error);
  const base = { client: 'X', items: [{ description: 'Retainer', rateAed: 500 }], every: 'month', nextOn: '2026-11-20' };
  assert.equal(await bad({ ...base, nextOn: '2026-11-01' }), 'date_in_past');
  assert.equal(await bad({ ...base, every: 'daily' }), 'invalid_schedule');
  assert.equal(await bad({ ...base, autoEmail: true }), 'email_required');
  const plan = (await op({ op: 'planSave', plan: { ...base, endOn: '2026-12-25' } })).data.result;

  const now = await op({ op: 'planRun', id: plan.id });
  assert.equal(now.data.result.planId, plan.id);
  assert.equal(now.data.plans[0].nextOn, '2026-11-20', 'running early leaves the schedule alone');

  await op({ op: 'planToggle', id: plan.id, active: false });
  assert.equal(store.peek().plans[0].active, false);
  const edited = await op({ op: 'planSave', plan: { ...base, id: plan.id, items: [{ description: 'Retainer', rateAed: 650 }], active: true, endOn: '2026-12-25' } });
  assert.equal(edited.data.plans.length, 1);
  assert.equal(edited.data.plans[0].items[0].rate, 65000);
  assert.equal(edited.data.plans[0].count, 1);

  assert.equal((await cron()).invoices, 0);
  const del = await op({ op: 'planDelete', id: plan.id });
  assert.equal(del.data.plans.length, 0);
  assert.equal(del.data.invoices.length, 1, 'its invoices stay');
});

test('a plan stops after its end date', async () => {
  const { op, cron, clock, store } = setup();
  await op({ op: 'planSave', plan: { client: 'X', items: [{ description: 'Retainer', rateAed: 500 }], every: 'week', nextOn: '2026-11-11', endOn: '2026-11-18' } });
  assert.equal((await cron()).invoices, 1);
  clock.now += 7 * DAY;
  assert.equal((await cron()).invoices, 1);
  assert.equal(store.peek().plans[0].active, false);
  clock.now += 7 * DAY;
  assert.equal((await cron()).invoices, 0);
});

test('reminders: off by default; when on, one on the due day and one per overdue step', async () => {
  const { create, op, cron, clock, mail, stored } = setup();
  const inv = await create({ client: 'Art Services LLC', clientEmail: 'accounts@artservices.example', amountAed: 300, dueDays: 2 });
  clock.now += 2 * DAY;
  assert.equal((await cron()).reminders, 0);

  const s = await op({ op: 'settings', settings: { reminders: { enabled: true, onDue: true, afterDays: [7, 3, 3, 400] } } });
  assert.deepEqual(s.data.settings.reminders.afterDays, [3, 7]);
  assert.equal(s.data.settings.business.name, 'RizcoReach', 'other settings keep their defaults');

  assert.equal((await cron()).reminders, 1);
  assert.equal(mail.sent.at(-1).subject, `Reminder: invoice ${inv.number} is due today`);
  clock.now += HOUR;
  assert.equal((await cron()).reminders, 0);
  clock.now += 2 * DAY;
  assert.equal((await cron()).reminders, 0, 'two days overdue: not a step');
  clock.now += DAY;
  assert.equal((await cron()).reminders, 1);
  assert.equal(mail.sent.at(-1).subject, `Reminder: invoice ${inv.number} is 3 days overdue`);
  assert.equal(stored(inv.id).reminders.length, 2);

  await op({ op: 'markPaid', id: inv.id });
  clock.now += 10 * DAY;
  assert.equal((await cron()).reminders, 0, 'paid invoices are left alone');
  assert.equal(mail.sent.length, 2);
});

test('a scheduled email that fails is tried three times, then dropped', async () => {
  const { op, cron, clock, mail, store } = setup();
  await op({ op: 'planSave', plan: { client: 'X', clientEmail: 'x@x.example', items: [{ description: 'Retainer', rateAed: 500 }], every: 'month', nextOn: '2026-11-11', autoEmail: true } });
  mail.fail = true;
  await cron();
  assert.equal(store.peek().invoices[0].outbox[0].tries, 1);
  clock.now += HOUR;
  await cron();
  clock.now += HOUR;
  await cron();
  const inv = store.peek().invoices[0];
  assert.equal(inv.outbox.length, 0);
  assert.equal(inv.mailLog.length, 3);
  assert.equal(inv.sentAt, null);
  mail.fail = false;
  clock.now += HOUR;
  assert.equal((await cron()).emails, 0);
});

test('the PDF is served by token, as the invoice and then as the receipt', async () => {
  const { create, call, op } = setup();
  const inv = await create({ client: 'Art Services LLC', amountAed: 425, description: 'Meta ads management' });
  const res = await call(`/api/pay/${inv.token}/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.type, 'application/pdf');
  assert.equal(Buffer.from(res.data.slice(0, 5)).toString(), '%PDF-');
  assert.ok(res.data.length > 20_000);
  assert.equal((await call('/api/pay/not-a-real-token-123456/pdf')).status, 404);
  await op({ op: 'markPaid', id: inv.id });
  assert.equal((await call(`/api/pay/${inv.token}/pdf`)).status, 200);
});

test('invoices saved before these features still load, pay and print', async () => {
  const old = { id: 'inv_old', token: 'oldtokenoldtokenoldtoken', number: 'RR-2026-0001', client: 'Old Client', clientWa: '', description: 'Website', amount: 74900, currency: 'AED', status: 'unpaid', createdAt: NOW - DAY, updatedAt: NOW - DAY, paidAt: null, paidTest: false, paymentId: '', cardBrand: '', cardLast4: '', attempts: [] };
  const paidOld = { ...old, id: 'inv_old2', token: 'oldtoken2oldtoken2oldtok', number: 'RR-2026-0002', status: 'paid', paidAt: NOW - HOUR, paymentId: 'pi_x', cardBrand: 'VISA', cardLast4: '4242' };
  const { call, fetch, stored } = setup({ seed: { rev: 3, seq: 2, invoices: [old, paidOld] } });
  const pub = (await call(`/api/pay/${old.token}`)).data.invoice;
  assert.equal(pub.amount, 74900);
  assert.equal(pub.payTotal, 74900);
  assert.deepEqual(pub.items, [{ description: 'Website', qty: 1, rate: 74900, amount: 74900 }]);
  assert.equal(pub.issuedOn, '2026-11-10');
  await call(`/api/pay/${old.token}/checkout`, { method: 'POST' });
  assert.equal(fetch.calls.at(-1).body.amount, 74900);
  fetch.complete('pi_1');
  assert.equal((await call(`/api/pay/${old.token}/status`)).data.invoice.status, 'paid');
  assert.equal(stored('inv_old2').paidAmount, 74900);
  assert.equal(stored('inv_old2').paidVia, 'ziina');
  assert.equal((await call(`/api/pay/${paidOld.token}/pdf`)).status, 200);
  const list = await call('/api/pay', { auth: ADMIN });
  assert.equal(list.data.invoices.length, 2);
  assert.equal(list.data.settings.fee.percentBp, 260);
  assert.equal(list.data.today, '2026-11-11');
});

test('details can be corrected on an unpaid invoice', async () => {
  const { create, op } = setup();
  const inv = await create({ client: 'X', amountAed: 50 });
  const r = await op({ op: 'update', id: inv.id, patch: { clientEmail: 'X@x.example', dueOn: '2026-12-01', notes: 'Line one\n\n\n\nLine two', clientWa: '050 123 4567' } });
  assert.equal(r.data.result.clientEmail, 'x@x.example');
  assert.equal(r.data.result.dueOn, '2026-12-01');
  assert.equal(r.data.result.notes, 'Line one\n\nLine two');
  assert.equal(r.data.result.clientWa, '971501234567');
  assert.equal((await op({ op: 'update', id: inv.id, patch: { dueOn: 'soon' } })).data.error, 'invalid_date');
});
