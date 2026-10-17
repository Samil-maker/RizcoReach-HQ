// Tests for the Gmail sender (lead-hunter/email/sender.gs), run in node:vm with fake Apps Script services.
// The site answers with canned JSON that follows the email queue contract (netlify/functions/email-queue.mts).
//   node --test tests/email-sender.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../lead-hunter/email/sender.gs', import.meta.url), 'utf8');
const SITE = 'https://www.rizcoreach.ae';
const KEY = 'k'.repeat(32);
const ME = 'samil@gmail.com';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.now();

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const decodeWords = (v) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
const address = (from) => (String(from).match(/<([^>]+)>/) || [, from])[1].trim().toLowerCase();

/* ------------------------------------------------------------------ fixtures */
/** The site: canned answers shaped like the email queue responses. `jobs` are handed out one per claim. */
function site({ items = [], jobs = [], code = 200 } = {}) {
  const queue = [...jobs];
  return ({ method, body }) => {
    if (code !== 200) return { code, data: { error: code === 401 ? 'unauthorized' : 'oops' } };
    if (method === 'get') {
      const stats = { today: 0, cap: 5, queued: 0, active: 0, done: 0, replied: 0, bounced: 0, optout: 0, failed: 0, cancelled: 0 };
      const settings = { paused: false, maxPerDay: 30, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, gapMinutes: 10 };
      return { code: 200, data: { items, settings, stats, never: 0, pausedReason: '', pausedUntil: 0, firstSendDay: '', senderSeenAt: NOW, now: NOW } };
    }
    if (body.action === 'claim') {
      const job = queue.shift();
      return { code: 200, data: job ? { job } : { job: null, reason: 'nothing_due' } };
    }
    if (body.action === 'report') return { code: 200, data: { ok: true } };
    if (body.action === 'events') return { code: 200, data: { ok: true } };
    return { code: 405, data: { error: 'method_not_allowed' } };
  };
}

/** A queue item as GET returns it, after its first email went out. */
const item = (id, extra = {}) => ({
  id, email: `${id}@biz.example`, business: `Biz ${id}`, script: 'ads', fromName: 'Samil', subject: `Quick question for Biz ${id}`,
  steps: ['a', 'b', 'c'], followupDays: [3, 4], status: 'active', sent: 1, sentAt: [NOW - 2 * DAY], nextAt: NOW + DAY,
  threadId: `t-${id}`, messageId: `<${id}@mail.gmail.com>`, lease: null, attempts: 0, error: '', addedAt: NOW - 3 * DAY, statusAt: NOW - 2 * DAY,
  ...extra,
});
const job = (extra = {}) => ({
  id: 'lead1', step: 0, to: 'info@glossy.ae', fromName: 'Samil', subject: 'Quick question for Glossy',
  body: 'Hello Glossy\n\nQuick one.\n\nSamil', threadId: '', messageId: '', verify: false, ...extra,
});
const mail = (extra = {}) => ({ from: 'Glossy <info@glossy.ae>', to: ME, subject: 'Re: Quick question for Glossy', date: NOW - DAY, body: 'Sounds good', headers: {}, ...extra });
const mine = (extra = {}) => mail({ from: `Samil <${ME}>`, to: 'info@glossy.ae', subject: 'Quick question for Glossy', date: NOW - 3 * DAY, body: 'Hello Glossy', ...extra });

/** Splits a raw message into decoded headers and body, checking the line endings on the way. */
function parseMime(mime) {
  assert.doesNotMatch(mime, /[^\r]\n/, 'CRLF line endings only');
  const at = mime.indexOf('\r\n\r\n');
  const headers = {};
  for (const line of mime.slice(0, at).split('\r\n')) headers[line.slice(0, line.indexOf(':'))] = line.slice(line.indexOf(':') + 1).trim();
  const lines = mime.slice(at + 4).split('\r\n');
  return { headers, lines, from: decodeWords(headers.From), subject: decodeWords(headers.Subject), text: Buffer.from(lines.join(''), 'base64').toString('utf8') };
}

/** Fake Apps Script services around a small mailbox. `threads` = { threadId: [message, ...] }. */
function world({ respond = site(), gmail = true, fill = true, lockFree = true, props = {}, threads = {}, triggers = [], sendError = '', headerError = false } = {}) {
  const log = { fetch: [], sends: [], searches: [], logs: [], released: 0 };
  const box = new Map(Object.entries(threads).map(([id, list]) => [id, list.map((m, i) => ({ id: `${id}-${i}`, ...m }))]));
  const trig = triggers.map((fn) => ({ getHandlerFunction: () => fn }));
  let n = 0;

  const wrap = (m) => ({
    getId: () => m.id,
    getFrom: () => m.from,
    getTo: () => m.to,
    getSubject: () => m.subject,
    getDate: () => new Date(m.date),
    getPlainBody: () => m.body,
    getHeader: (name) => m.headers[Object.keys(m.headers).find((h) => h.toLowerCase() === name.toLowerCase())] || '',
  });
  const thread = (id) => ({ getId: () => id, getMessages: () => box.get(id).map(wrap) });
  const fromMe = (m) => address(m.from) === ME;
  const matches = (list, term) => {
    if (term === 'in:sent') return list.some(fromMe);
    if (term === '-in:sent') return list.some((m) => !fromMe(m));
    if (term === '-in:chats') return true;
    if (term.startsWith('to:')) return list.some((m) => m.to.toLowerCase().includes(term.slice(3).toLowerCase()));
    const from = term.match(/^from:\((.*)\)$/); // from:(a OR b): any message from one of them
    if (from) return list.some((m) => from[1].toLowerCase().split(' or ').some((a) => m.from.toLowerCase().includes(a)));
    const age = term.match(/^newer_than:(\d+)d$/);
    if (age) return list.some((m) => m.date > Date.now() - age[1] * DAY);
    throw new Error(`search term the fake mailbox does not know: ${term}`);
  };
  const charset = (cs) => (cs === 'UTF_8' ? 'utf8' : 'latin1'); // a missing charset breaks non-ASCII text, like in Apps Script

  const services = {
    Logger: { log: (s) => log.logs.push(String(s)) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = String(v)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => log.released++ }) },
    ScriptApp: {
      getProjectTriggers: () => [...trig],
      deleteTrigger: (t) => trig.splice(trig.indexOf(t), 1),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (minutes) => ({ create: () => trig.push({ getHandlerFunction: () => fn, minutes }) }) }) }),
    },
    Utilities: {
      Charset: { US_ASCII: 'US_ASCII', UTF_8: 'UTF_8' },
      base64Encode: (s, cs) => Buffer.from(String(s), charset(cs)).toString('base64'),
      base64EncodeWebSafe: (s, cs) => Buffer.from(String(s), charset(cs)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
    UrlFetchApp: {
      fetch(url, o) {
        const req = { url, method: o.method, contentType: o.contentType, headers: { ...o.headers }, mute: o.muteHttpExceptions, body: o.payload === undefined ? undefined : JSON.parse(o.payload) };
        log.fetch.push(req);
        const { code, data } = respond(req);
        return { getResponseCode: () => code, getContentText: () => JSON.stringify(data) };
      },
    },
    GmailApp: {
      search(query, start = 0, max = 500) {
        log.searches.push(query);
        const terms = query.split(/\s+(?![^(]*\))/); // keeps "(a OR b)" in one term
        return [...box.keys()].filter((id) => terms.every((t) => matches(box.get(id), t))).slice(start, start + max).map(thread);
      },
      getMessageById(id) {
        if (headerError) throw new Error('Message not found');
        return wrap([...box.values()].flat().find((m) => m.id === id));
      },
    },
  };
  if (gmail) {
    // The Gmail API: stores what it sends in the mailbox, like Gmail does.
    services.Gmail = {
      Users: {
        Messages: {
          send(resource, userId) {
            if (sendError) throw new Error(sendError);
            const mime = Buffer.from(resource.raw, 'base64url').toString('utf8');
            const parsed = parseMime(mime);
            const id = `m${++n}`;
            const threadId = resource.threadId || `t${n}`;
            if (!box.has(threadId)) box.set(threadId, []);
            box.get(threadId).push({ id, from: `Samil <${ME}>`, to: parsed.headers.To, subject: parsed.subject, date: Date.now(), body: parsed.text, headers: { 'Message-ID': `<${id}@mail.gmail.com>` } });
            log.sends.push({ keys: Object.keys(resource), raw: resource.raw, threadId: resource.threadId, userId, ...parsed });
            return { id, threadId, labelIds: ['SENT'] };
          },
        },
      },
    };
  }
  // Fill in the site and key like the dashboard's "Copy sender script" button does.
  const code = fill ? SOURCE.replaceAll('__SITE__', SITE).replaceAll('__KEY__', KEY) : SOURCE;
  const ctx = vm.createContext(services);
  vm.runInContext(code, ctx, { filename: 'sender.gs' });
  return { ctx, log, box, props, triggers: trig };
}

const posts = (w, action) => w.log.fetch.filter((r) => r.body && r.body.action === action).map((r) => r.body);

/* ------------------------------------------------------------------ sending */
test('the first email is plain UTF-8 text from your Gmail, reported with its thread and Message-ID', () => {
  const w = world();
  const body = 'مرحبا Glossy 👋\n\nWe help car detailing studios get more bookings from Instagram. ' + 'Long line '.repeat(30) + '\n\nSamil\nRizcoReach · rizcoreach.ae';
  w.ctx.sendJob(job({ fromName: 'Samil سامل', subject: 'Quick question for جلوسي ✨', body }));

  assert.equal(w.log.sends.length, 1);
  const s = w.log.sends[0];
  assert.equal(s.userId, 'me');
  assert.deepEqual(s.keys, ['raw'], 'no threadId on a first email');
  assert.match(s.raw, /^[\w-]+=*$/, 'web safe base64');
  assert.equal(s.headers.From, `=?UTF-8?B?${b64('Samil سامل')}?= <${ME}>`);
  assert.equal(s.from, `Samil سامل <${ME}>`);
  assert.equal(s.headers.To, 'info@glossy.ae');
  assert.equal(s.headers.Subject, `=?UTF-8?B?${b64('Quick question for جلوسي ✨')}?=`);
  assert.equal(s.subject, 'Quick question for جلوسي ✨');
  assert.equal(s.headers['MIME-Version'], '1.0');
  assert.equal(s.headers['Content-Type'], 'text/plain; charset=UTF-8');
  assert.equal(s.headers['Content-Transfer-Encoding'], 'base64');
  assert.equal(s.headers['In-Reply-To'], undefined);
  assert.equal(s.headers.References, undefined);
  assert.equal(s.text, body, 'the body decodes to the exact text');
  assert.ok(s.lines.length > 1 && s.lines.every((l) => l.length <= 76), 'body wrapped at 76 characters');

  assert.deepEqual(posts(w, 'report'), [{ action: 'report', id: 'lead1', step: 0, ok: true, threadId: 't1', messageId: '<m1@mail.gmail.com>' }]);
  const r = w.log.fetch[0];
  assert.equal(r.url, `${SITE}/api/email-queue`);
  assert.equal(r.method, 'post');
  assert.equal(r.contentType, 'application/json');
  assert.equal(r.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(r.mute, true);
});

test('follow ups reply in the same thread with Re: and the threading headers', () => {
  const w = world({ threads: { t7: [mine()] } });
  w.ctx.sendJob(job({ step: 1, threadId: 't7', messageId: '<orig@mail.gmail.com>', body: 'Hello Glossy\n\nJust bringing this back up 🙂' }));

  const s = w.log.sends[0];
  assert.deepEqual(s.keys.sort(), ['raw', 'threadId']);
  assert.equal(s.threadId, 't7');
  assert.equal(s.subject, 'Re: Quick question for Glossy');
  assert.equal(s.headers['In-Reply-To'], '<orig@mail.gmail.com>');
  assert.equal(s.headers.References, '<orig@mail.gmail.com>');
  assert.equal(s.text, 'Hello Glossy\n\nJust bringing this back up 🙂');
  // The site keeps the first email's ids, the sender just passes them along.
  assert.deepEqual(posts(w, 'report'), [{ action: 'report', id: 'lead1', step: 1, ok: true, threadId: 't7', messageId: '<orig@mail.gmail.com>' }]);
  assert.equal(w.box.get('t7').length, 2);
});

test('a follow up still threads when the first Message-ID is unknown, and header text cannot break lines', () => {
  const w = world({ threads: { t7: [mine()] } });
  w.ctx.sendJob(job({ step: 2, threadId: 't7', messageId: '', to: 'info@glossy.ae\r\nBcc: x@evil.example' }));
  const s = w.log.sends[0];
  assert.equal(s.threadId, 't7');
  assert.equal(s.headers['In-Reply-To'], undefined);
  assert.equal(s.headers.References, undefined);
  assert.equal(s.headers.Bcc, undefined);
  assert.equal(s.headers.To, 'info@glossy.ae Bcc: x@evil.example');
});

test('a missing Message-ID after a send is never treated as a failure', () => {
  const w = world({ headerError: true });
  w.ctx.sendJob(job());
  assert.equal(w.log.sends.length, 1);
  assert.deepEqual(posts(w, 'report'), [{ action: 'report', id: 'lead1', step: 0, ok: true, threadId: 't1', messageId: '' }]);
});

test('verify finds an email that was already sent and reports it without sending again', () => {
  const sent = mine({ date: NOW - 20 * MIN, headers: { 'Message-ID': '<orig@mail.gmail.com>' } });
  const w = world({ threads: { t9: [sent] } });
  w.ctx.sendJob(job({ verify: true }));
  assert.equal(w.log.sends.length, 0);
  assert.match(w.log.searches[0], /^in:sent to:info@glossy\.ae newer_than:\d+d$/);
  assert.deepEqual(posts(w, 'report'), [{ action: 'report', id: 'lead1', step: 0, ok: true, threadId: 't9', messageId: '<orig@mail.gmail.com>' }]);

  // Follow up 1 already in the thread: reported, not sent.
  const followed = world({ threads: { t9: [sent, mine({ subject: 'Re: Quick question for Glossy', date: NOW - 20 * MIN })] } });
  followed.ctx.sendJob(job({ step: 1, threadId: 't9', messageId: '<orig@mail.gmail.com>', verify: true }));
  assert.equal(followed.log.sends.length, 0);
  assert.deepEqual(posts(followed, 'report'), [{ action: 'report', id: 'lead1', step: 1, ok: true, threadId: 't9', messageId: '<orig@mail.gmail.com>' }]);
});

test('verify sends when the email is not in Sent yet', () => {
  // Nothing sent at all.
  const empty = world();
  empty.ctx.sendJob(job({ verify: true }));
  assert.equal(empty.log.sends.length, 1);

  // Follow up 2: the thread has the first email, follow up 1 and a reply from them, but not follow up 2.
  const thread = [mine(), mine({ subject: 'Re: Quick question for Glossy', date: NOW - DAY }), mail({ date: NOW - 2 * MIN })];
  const w = world({ threads: { t9: thread, other: [mine({ subject: 'Re: Quick question for Glossy' }), mine({ subject: 'Re: Quick question for Glossy' })] } });
  w.ctx.sendJob(job({ step: 2, threadId: 't9', messageId: '<orig@mail.gmail.com>', verify: true }));
  assert.equal(w.log.sends.length, 1);
  assert.equal(w.log.sends[0].threadId, 't9');
  assert.equal(posts(w, 'report')[0].ok, true);

  // Sending twice for the same step is what verify prevents: a second verify run finds it.
  w.ctx.sendJob(job({ step: 2, threadId: 't9', messageId: '<orig@mail.gmail.com>', verify: true }));
  assert.equal(w.log.sends.length, 1);
});

test('send errors are reported as limit, permanent or a retry', () => {
  for (const [error, flags] of [
    ['API call to gmail.users.messages.send failed with error: User-rate limit exceeded', { limit: true }],
    ['Service invoked too many times for one day: gmail.', { limit: true }],
    ['Quota exceeded for quota metric', { limit: true }],
    ['API call to gmail.users.messages.send failed with error: Invalid To header', { permanent: true }],
    ['550 5.1.1 Recipient address rejected: user unknown', { permanent: true }],
    ['Invalid address: info@@glossy', { permanent: true }],
    ['Empty response', {}],
    ['API call to gmail.users.messages.send failed with error: Backend Error', {}],
  ]) {
    const w = world({ sendError: error });
    w.ctx.sendJob(job());
    assert.deepEqual(posts(w, 'report'), [{ action: 'report', id: 'lead1', step: 0, ok: false, error, ...flags }], error);
    assert.equal(w.box.size, 0);
  }
  const long = world({ sendError: 'x'.repeat(500) });
  long.ctx.sendJob(job());
  assert.equal(posts(long, 'report')[0].error.length, 300);
});

/* ------------------------------------------------------------------ inbox */
test('checkInbox reports replies, opt outs and bounces once, and ignores auto replies and your own emails', () => {
  const items = [
    item('reply'),
    item('optout'),
    item('auto'),
    item('bounce'),
    item('lostbounce'),
    item('quoted'),
    item('twice'),
    item('quiet'),
    item('olddone', { status: 'done', sent: 3, sentAt: [NOW - 30 * DAY, NOW - 26 * DAY, NOW - 22 * DAY] }),
    item('done', { status: 'done', sent: 3, sentAt: [NOW - 12 * DAY, NOW - 9 * DAY, NOW - 5 * DAY] }),
    item('cancelled', { status: 'cancelled' }),
    item('queued', { status: 'queued', sent: 0, sentAt: [], threadId: '', messageId: '' }),
  ];
  const first = (id) => mine({ to: `${id}@biz.example`, subject: `Quick question for Biz ${id}`, date: NOW - 2 * DAY - MIN });
  const from = (id) => `Biz ${id} <${id}@biz.example>`;
  const daemon = 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>';
  const threads = {
    't-reply': [first('reply'), mail({ from: from('reply'), body: 'Yes please send the details' })],
    't-optout': [first('optout'), mail({ from: from('optout'), body: 'No thanks, we are good.' })],
    't-auto': [
      first('auto'),
      mail({ from: from('auto'), subject: 'Automatic reply: Quick question', body: 'I am away. Do not email this address.', headers: { 'Auto-Submitted': 'auto-replied' } }),
      mail({ from: from('auto'), subject: 'Out of Office', body: 'Back Monday' }),
      mail({ from: from('auto'), subject: 'Away', body: 'Back Monday', headers: { 'auto-submitted': 'auto-generated' } }),
    ],
    // Gmail threads its own bounces and marks them Auto-Submitted, they still count as bounces.
    't-bounce': [first('bounce'), mail({ from: daemon, subject: 'Delivery Status Notification (Failure)', body: 'Your message could not be delivered.', headers: { 'Auto-Submitted': 'auto-replied' } })],
    't-quoted': [
      first('quoted'),
      mail({
        from: from('quoted'),
        body: 'Sounds good, send the mockup\r\n\r\nOn Tue, 14 Oct 2025 at 10:00, Samil <\r\nsamil@gmail.com> wrote:\r\n\r\n> Hello\r\n> If you\'d rather not hear from me just reply no thanks and I won\'t email again.',
      }),
    ],
    't-twice': [first('twice'), mail({ from: from('twice'), body: 'Call me' }), mail({ from: from('twice'), body: 'Hello?', date: NOW - 2 * 60 * MIN })],
    't-quiet': [
      mail({ from: from('quiet'), subject: 'Hello', body: 'An older email, before ours', date: NOW - 2 * DAY - 5 * MIN }),
      first('quiet'),
      mine({ to: 'quiet@biz.example', subject: 'Re: Quick question for Biz quiet', date: NOW - DAY }),
    ],
    't-olddone': [mine({ date: NOW - 30 * DAY }), mail({ from: from('olddone') })],
    't-done': [mine({ date: NOW - 12 * DAY }), mail({ from: from('done'), body: 'Is this still on?' })],
    't-cancelled': [first('cancelled'), mail({ from: from('cancelled') })],
    // Bounces Gmail did not thread, matched by the address in the text.
    't-ndr': [
      mail({ from: 'postmaster@biz.example', subject: 'Undeliverable', body: 'Delivery to LostBounce@biz.example and nobody@biz.example failed.' }),
      mail({ from: 'Ali <ali@friend.example>', subject: 'Re: Undeliverable', body: 'Did you also email quiet@biz.example?' }),
    ],
    't-ndr2': [mail({ from: daemon, subject: 'Undeliverable', body: 'Address not found: LOSTBOUNCE@BIZ.EXAMPLE' })],
    't-oldndr': [mail({ from: daemon, subject: 'Undeliverable', body: 'quiet@biz.example failed', date: NOW - 2 * DAY - 2 * MIN })],
  };
  const w = world({ respond: site({ items }), threads });
  w.ctx.checkInbox();

  const watched = ['reply', 'optout', 'auto', 'bounce', 'lostbounce', 'quoted', 'twice', 'quiet', 'done', 'cancelled'].map((id) => `${id}@biz.example`);
  assert.deepEqual(w.log.searches, [
    'newer_than:3d -in:sent -in:chats',
    `newer_than:3d -in:sent -in:chats from:(${watched.join(' OR ')})`,
    'from:(mailer-daemon OR postmaster) newer_than:3d',
  ]);
  const sent = posts(w, 'events');
  assert.equal(sent.length, 1, 'one events call');
  const byId = (a, b) => a.id.localeCompare(b.id);
  assert.deepEqual([...sent[0].events].sort(byId), [
    { id: 'bounce', type: 'bounced' },
    { id: 'cancelled', type: 'replied' }, // stopped by hand, but a reply is still a reply
    { id: 'done', type: 'replied' },
    { id: 'lostbounce', type: 'bounced' },
    { id: 'optout', type: 'optout' },
    { id: 'quoted', type: 'replied' },
    { id: 'reply', type: 'replied' },
    { id: 'twice', type: 'replied' },
  ]);
});

test('a bounce found both in its thread and by address is reported once', () => {
  const bounce = mail({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', body: 'Your message to a@biz.example could not be delivered.' });
  const w = world({ respond: site({ items: [item('a')] }), threads: { 't-a': [mine(), bounce] } });
  w.ctx.checkInbox();
  assert.deepEqual(posts(w, 'events'), [{ action: 'events', events: [{ id: 'a', type: 'bounced' }] }]);
});

test('a "delivery delayed" notice is not a bounce', () => {
  const daemon = 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>';
  const delay = mail({ from: daemon, subject: 'Delivery Status Notification (Delay)', body: 'Delivery incomplete. There was a temporary problem delivering your message to a@biz.example. Gmail will retry for 47 more hours.' });
  const w = world({ respond: site({ items: [item('a')] }), threads: { 't-a': [mine(), delay], 't-x': [{ ...delay, subject: 'Delayed Mail (still being retried)' }] } });
  w.ctx.checkInbox();
  assert.deepEqual(posts(w, 'events'), [], 'nothing reported');
});

test('a reply that starts a new email still counts', () => {
  const w = world({ respond: site({ items: [item('a')] }), threads: { 't-a': [mine()], 't-new': [mail({ from: 'Biz A <A@biz.example>', subject: 'Your ads offer', body: 'Can you call me?' })] } });
  w.ctx.checkInbox();
  assert.deepEqual(posts(w, 'events'), [{ action: 'events', events: [{ id: 'a', type: 'replied' }] }]);
});

test('reads ask for the light list without the email texts', () => {
  const w = world({ respond: site({ items: [] }) });
  w.ctx.checkInbox();
  assert.equal(w.log.fetch[0].url, `${SITE}/api/email-queue?lite=1`);
});

test('opt out wording is read from the reply only', () => {
  const cases = [
    ['Please remove me from your list', 'optout'],
    ['unsubscribe', 'optout'],
    ['STOP', 'optout'],
    ['Stop.', 'optout'],
    ['Please stop emailing me', 'optout'],
    ['Yes interested\n\nAhmed\nOne Stop Auto Care', 'replied'],
    ['We stopped using ads last year, tell me more', 'replied'],
    ['Not interested sorry', 'optout'],
    ['Please don’t email me again', 'optout'],
    ['No thank you', 'optout'],
    ['How much is it?\n\n-----Original Message-----\nFrom: Samil\nreply no thanks and I won\'t email again', 'replied'],
    ['Call me tomorrow\n\nFrom: Samil <samil@gmail.com>\nSent: Tuesday\n\nreply no thanks', 'replied'],
    ['Ok\n> just reply no thanks', 'replied'],
    ['Sounds good ' + 'really '.repeat(100) + 'stop', 'replied'],
  ];
  for (const [body, type] of cases) {
    const w = world({ respond: site({ items: [item('a')] }), threads: { 't-a': [mail({ from: 'a@biz.example', body })] } });
    w.ctx.checkInbox();
    assert.deepEqual(posts(w, 'events')[0].events, [{ id: 'a', type }], body);
  }
});

test('checkInbox posts nothing when nothing happened', () => {
  const w = world({ respond: site({ items: [item('a')] }), threads: { 't-a': [mine()] } });
  assert.deepEqual([...w.ctx.checkInbox()], []);
  assert.deepEqual(posts(w, 'events'), []);
  assert.equal(w.log.fetch.length, 1);
  assert.equal(w.log.fetch[0].method, 'get');
  assert.equal(w.log.fetch[0].body, undefined, 'GET has no body');
});

/* ------------------------------------------------------------------ setup, stop, tick */
test('setup explains what is missing before it starts anything', () => {
  const noGmail = world({ gmail: false });
  assert.throws(() => noGmail.ctx.setup(), { message: 'Add the Gmail service first: click the + next to Services on the left, pick Gmail API, then Add.' });
  const notFilled = world({ fill: false });
  assert.throws(() => notFilled.ctx.setup(), /site or key is missing/);
  const wrongKey = world({ respond: site({ code: 401 }) });
  assert.throws(() => wrongKey.ctx.setup(), /key does not match/);
  const oldSite = world({ respond: site({ code: 404 }) });
  assert.throws(() => oldSite.ctx.setup(), /does not have the email sender yet/);
  for (const w of [noGmail, notFilled, wrongKey, oldSite]) assert.equal(w.triggers.length, 0);
  assert.equal(noGmail.log.fetch.length + notFilled.log.fetch.length, 0);
});

test('setup replaces old timers with exactly one 5 minute timer and runs once, stop removes it', () => {
  const w = world({ triggers: ['tick', 'tick', 'somethingElse'] });
  w.ctx.setup();
  const ticks = () => w.triggers.filter((t) => t.getHandlerFunction() === 'tick');
  assert.equal(ticks().length, 1);
  assert.equal(ticks()[0].minutes, 5);
  assert.equal(w.triggers.length, 2, 'other timers are left alone');
  assert.equal(posts(w, 'claim').length, 1, 'ran once');
  assert.ok(w.log.logs.some((l) => l.startsWith('Email sender is running')));

  w.ctx.setup();
  assert.equal(ticks().length, 1, 'running setup again keeps one timer');

  w.ctx.stop();
  assert.equal(ticks().length, 0);
  assert.equal(w.triggers.length, 1);
});

test('tick waits for the lock, checks the inbox every 10 minutes and sends one email', () => {
  const busy = world({ lockFree: false, respond: site({ jobs: [job()] }) });
  busy.ctx.tick();
  assert.equal(busy.log.fetch.length, 0);
  assert.equal(busy.log.sends.length, 0);

  const recent = world({ props: { lastInboxCheck: String(NOW - 5 * MIN) }, respond: site({ jobs: [job(), job({ id: 'lead2' })] }) });
  recent.ctx.tick();
  assert.deepEqual(recent.log.fetch.map((r) => r.body && r.body.action), ['claim', 'report']);
  assert.equal(recent.log.searches.length, 0);
  assert.equal(recent.log.sends.length, 1, 'one email per run');
  assert.equal(recent.props.lastInboxCheck, String(NOW - 5 * MIN));
  assert.equal(recent.log.released, 1);

  const due = world({ props: { lastInboxCheck: String(NOW - 11 * MIN) }, respond: site({ items: [item('a')], jobs: [job()] }), threads: { 't-a': [mail({ from: 'a@biz.example' })] } });
  due.ctx.tick();
  assert.deepEqual(due.log.fetch.map((r) => (r.body ? r.body.action : r.method)), ['get', 'events', 'claim', 'report']);
  assert.ok(Number(due.props.lastInboxCheck) >= NOW);

  const idle = world();
  idle.ctx.tick();
  assert.equal(idle.log.sends.length, 0);
  assert.ok(idle.log.logs.includes('Nothing to send now (nothing_due)'));
});

test('tick logs errors instead of throwing, and sends nothing when the inbox check fails', () => {
  const w = world({ respond: site({ code: 500 }) });
  assert.doesNotThrow(() => w.ctx.tick());
  assert.deepEqual(w.log.fetch.map((r) => r.method), ['get'], 'no claim without a fresh inbox check');
  assert.equal(w.props.lastInboxCheck, undefined, 'tried again next run');
  assert.ok(w.log.logs.some((l) => l.includes('500')));
  assert.equal(w.log.released, 1);

  const wrongKey = world({ respond: site({ code: 401 }), props: { lastInboxCheck: String(NOW) } });
  wrongKey.ctx.tick();
  assert.ok(wrongKey.log.logs.some((l) => l.includes('The key does not match your site')));
});
