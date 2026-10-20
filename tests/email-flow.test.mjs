// End to end: Lead Hunter's emails (LH.emailFor), the real email queue (email-queue.mts, in a worker thread) and the
// real Gmail sender (lead-hunter/email/sender.gs, in node:vm with a fake Gmail and a test clock).
//   node --test tests/email-flow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import vm from 'node:vm';

await import('../lead-hunter/lib/common.js');
const LH = globalThis.LH;

const SITE = 'https://www.rizcoreach.ae';
const KEY = 'k'.repeat(32);
const ME = 'samil@gmail.com';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (s) => Date.parse(s.replace(' ', 'T') + ':00+04:00'); // Dubai time
const SOURCE = readFileSync(new URL('../lead-hunter/email/sender.gs', import.meta.url), 'utf8').replaceAll('__SITE__', SITE).replaceAll('__KEY__', KEY);
const SETTINGS = { ...LH.DEFAULT_SETTINGS, myName: 'Samil' };

/** The site in a worker, called synchronously like UrlFetchApp does. */
function site() {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const out = new SharedArrayBuffer(8 << 20);
  const worker = new Worker(new URL('./email-flow-server.mjs', import.meta.url), { workerData: { key: KEY, flag: flag.buffer, out } });
  const call = (url, method, body, now) => {
    Atomics.store(flag, 0, 0);
    worker.postMessage({ url, method: method.toUpperCase(), headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body, now });
    if (Atomics.wait(flag, 0, 0, 20000) === 'timed-out') throw new Error('the site did not answer');
    const len = new DataView(out).getUint32(0);
    const { code, text } = JSON.parse(new TextDecoder().decode(new Uint8Array(out, 4, len).slice()));
    return { code, data: JSON.parse(text) };
  };
  return { call, stop: () => worker.terminate() };
}

/** Gmail and the other Apps Script services the sender uses, around one mailbox and a clock. */
function gmail(server, clock) {
  const box = []; // { id, threadId, from, to, subject, date, body, headers }
  const sends = [];
  let n = 0;
  const wrap = (m) => ({
    getId: () => m.id,
    getFrom: () => m.from,
    getSubject: () => m.subject,
    getDate: () => new Date(m.date),
    getPlainBody: () => m.body,
    getHeader: (h) => m.headers[h] || '',
  });
  const mine = (m) => m.from.includes(ME);
  const thread = (id) => ({ getId: () => id, getMessages: () => box.filter((m) => m.threadId === id).map(wrap) });
  const matches = (list, term) => {
    const age = term.match(/^newer_than:(\d+)d$/);
    if (age) return list.some((m) => m.date > clock.now - age[1] * DAY);
    if (term === 'in:sent') return list.some(mine);
    if (term === '-in:sent') return list.some((m) => !mine(m));
    if (term === '-in:chats') return true;
    if (term.startsWith('to:')) return list.some((m) => m.to.includes(term.slice(3)));
    const from = term.match(/^from:\((.*)\)$/);
    if (from) return list.some((m) => from[1].split(' OR ').some((a) => m.from.toLowerCase().includes(a.toLowerCase())));
    throw new Error(`unknown search term ${term}`);
  };
  const decode = (raw) => {
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    const [head, body] = mime.split('\r\n\r\n');
    const headers = Object.fromEntries(head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    const words = (v) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
    return { headers, subject: words(headers.Subject), text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
  };
  class FakeDate extends Date {
    constructor(...a) {
      super(...(a.length ? a : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  }
  const props = {};
  const services = {
    Date: FakeDate,
    Logger: { log: () => {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = String(v)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(String(s), 'utf8').toString('base64url'),
    },
    UrlFetchApp: {
      fetch(url, o) {
        const { code, data } = server.call(url, o.method, o.payload, clock.now);
        return { getResponseCode: () => code, getContentText: () => JSON.stringify(data) };
      },
    },
    GmailApp: {
      search(q, start = 0, max = 500) {
        const terms = q.split(/\s+(?![^(]*\))/);
        const ids = [...new Set(box.map((m) => m.threadId))].filter((id) => terms.every((t) => matches(box.filter((m) => m.threadId === id), t)));
        return ids.slice(start, start + max).map(thread);
      },
      getMessageById: (id) => wrap(box.find((m) => m.id === id)),
    },
    Gmail: {
      Users: {
        Messages: {
          send(resource) {
            const { headers, subject, text } = decode(resource.raw);
            const id = `m${++n}`;
            const msg = { id, threadId: resource.threadId || `t${n}`, from: `Samil <${ME}>`, to: headers.To, subject, date: clock.now, body: text, headers: { 'Message-ID': `<${id}@mail.gmail.com>` } };
            box.push(msg);
            sends.push({ ...msg, inReplyTo: headers['In-Reply-To'] || '' });
            return { id, threadId: msg.threadId };
          },
        },
      },
    },
  };
  const ctx = vm.createContext(services);
  vm.runInContext(SOURCE, ctx, { filename: 'sender.gs' });
  /** Someone writes to Samil, in a thread or not. */
  const receive = (m) => box.push({ id: `in${++n}`, headers: {}, to: ME, date: clock.now, ...m });
  return { ctx, box, sends, receive };
}

/** What Lead Hunter's "Send to email queue" puts on the site for a lead. */
const queueItem = (lead) => {
  const e = LH.emailFor(lead, SETTINGS);
  return { id: lead.id, email: e.to, business: lead.pageName, script: e.script, fromName: SETTINGS.emailFromName, subject: e.subject, steps: e.steps, followupDays: [3, 4] };
};
const prospect = (i) => ({ id: `lead${i}`, kind: 'prospect', pageName: `Glossy ${i}`, phones: [], emails: [`info@glossy${i}.example`], socials: {}, sources: {}, website: `https://glossy${i}.example/`, adCheck: { state: 'none' } });

test('one lead from queue to reply: first email, a threaded follow up, then the reply stops the rest', () => {
  const clock = { now: at('2026-10-19 08:50') }; // Monday, before the window opens
  const server = site();
  try {
    const g = gmail(server, clock);
    const put = server.call(`${SITE}/api/email-queue`, 'put', JSON.stringify({ items: [queueItem(prospect(1))] }), clock.now);
    assert.equal(put.data.accepted, 1);
    const item = () => server.call(`${SITE}/api/email-queue`, 'get', undefined, clock.now).data.items[0];

    g.ctx.setup(); // 08:50: checks the site, starts the timer and ticks once
    assert.equal(g.sends.length, 0, 'nothing before 9 in Dubai');

    clock.now = at('2026-10-19 09:00');
    g.ctx.tick();
    assert.equal(g.sends.length, 1);
    const first = g.sends[0];
    assert.equal(first.to, 'info@glossy1.example');
    assert.equal(first.subject, 'Quick question for Glossy 1');
    assert.equal(first.body, LH.emailFor(prospect(1), SETTINGS).steps[0]);
    assert.equal(first.inReplyTo, '');
    assert.deepEqual([item().status, item().sent, item().threadId, item().messageId], ['active', 1, first.threadId, `<${first.id}@mail.gmail.com>`]);
    assert.equal(item().nextAt, at('2026-10-22 09:00'), 'follow up 1 three working days later');

    clock.now = at('2026-10-21 15:00');
    g.ctx.tick();
    assert.equal(g.sends.length, 1, 'not due yet');

    clock.now = at('2026-10-22 09:05');
    g.ctx.tick();
    assert.equal(g.sends.length, 2);
    const follow = g.sends[1];
    assert.deepEqual([follow.threadId, follow.subject, follow.inReplyTo], [first.threadId, 'Re: Quick question for Glossy 1', `<${first.id}@mail.gmail.com>`]);
    assert.match(follow.body, /^Hello Glossy 1\n\nJust bringing this back to the top of your inbox\./);
    assert.equal(item().nextAt, at('2026-10-28 09:05'), 'follow up 2 four working days later');

    clock.now = at('2026-10-23 11:00');
    g.receive({ threadId: first.threadId, from: 'Glossy 1 <info@glossy1.example>', subject: 'Re: Quick question for Glossy 1', body: 'Yes please send the details' });
    clock.now = at('2026-10-23 11:20');
    g.ctx.tick();
    assert.equal(item().status, 'replied');

    clock.now = at('2026-10-29 10:00');
    g.ctx.tick();
    assert.equal(g.sends.length, 2, 'no follow up after a reply');
  } finally {
    server.stop();
  }
});

test('a new sender sends 15 a day, 10 minutes apart at least, only Monday to Friday 9 to 6 in Dubai', () => {
  const clock = { now: at('2026-10-23 07:00') }; // a Friday
  const server = site();
  try {
    const g = gmail(server, clock);
    const items = Array.from({ length: 20 }, (_, i) => queueItem(prospect(i + 1)));
    assert.equal(server.call(`${SITE}/api/email-queue`, 'put', JSON.stringify({ items }), clock.now).data.accepted, 20);
    // A tick every 5 minutes from Friday 07:00 to Monday 20:00.
    for (; clock.now <= at('2026-10-26 20:00'); clock.now += 5 * MIN) g.ctx.tick();
    const firsts = g.sends.filter((s) => !s.inReplyTo);
    const day = (t) => new Date(t + 4 * 60 * MIN).toISOString().slice(0, 10);
    const perDay = {};
    for (const s of firsts) perDay[day(s.date)] = (perDay[day(s.date)] || 0) + 1;
    assert.deepEqual(perDay, { '2026-10-23': 15, '2026-10-26': 5 }, 'nothing on the weekend');
    for (const s of g.sends) {
      const h = new Date(s.date + 4 * 60 * MIN).getUTCHours();
      assert.ok(h >= 9 && h < 18, `sent at ${h}:00 Dubai time`);
    }
    for (let i = 1; i < g.sends.length; i++) assert.ok(g.sends[i].date - g.sends[i - 1].date >= 10 * MIN, 'at least 10 minutes apart');
    assert.equal(new Set(g.sends.map((s) => s.to)).size, g.sends.length, 'nobody got two first emails');
  } finally {
    server.stop();
  }
});

test('bounces pause the sender, and a "no thanks" puts the address on the never list', () => {
  const clock = { now: at('2026-10-19 09:00') };
  const server = site();
  try {
    const g = gmail(server, clock);
    const items = Array.from({ length: 5 }, (_, i) => queueItem(prospect(i + 1)));
    server.call(`${SITE}/api/email-queue`, 'put', JSON.stringify({ items }), clock.now);
    for (; g.sends.length < 5; clock.now += 5 * MIN) g.ctx.tick();
    // Three addresses bounce, one says no thanks.
    for (const s of g.sends.slice(0, 3)) g.receive({ threadId: s.threadId, from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', body: `Address not found: ${s.to}` });
    g.receive({ threadId: g.sends[3].threadId, from: `Glossy 4 <${g.sends[3].to}>`, subject: 'Re: hi', body: 'No thanks we are fully booked' });
    clock.now += 15 * MIN;
    g.ctx.tick();
    const state = server.call(`${SITE}/api/email-queue`, 'get', undefined, clock.now).data;
    assert.deepEqual(state.items.map((x) => x.status), ['bounced', 'bounced', 'bounced', 'optout', 'active']);
    assert.equal(state.pausedReason, 'bounces');
    assert.equal(state.never, 4);
    // Paused: the last one's follow up waits until Samil looks and resumes.
    clock.now = at('2026-10-23 10:00');
    g.ctx.tick();
    assert.equal(g.sends.length, 5);
    // Adding the "no thanks" address again is refused.
    const again = server.call(`${SITE}/api/email-queue`, 'put', JSON.stringify({ items: [{ ...queueItem(prospect(4)), id: 'other' }] }), clock.now).data;
    assert.deepEqual(again.rejected, [{ id: 'other', reason: 'never' }]);
  } finally {
    server.stop();
  }
});
