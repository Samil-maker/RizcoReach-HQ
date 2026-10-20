import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Email queue for the Lead Hunter Chrome extension (lead-hunter/).
 * The extension adds cold emails here (a first email and up to two follow ups). The sender
 * (lead-hunter/email/sender.gs, an Apps Script in the owner's own Google account) claims one job
 * at a time, sends it from Gmail and reports back. Every safety rule lives here: a sending window in
 * Dubai time, a slow daily ramp, a gap between emails, stop on reply, never email anyone twice,
 * a never list and an automatic pause when emails bounce.
 *
 * Private to the site owner: every request needs `Authorization: Bearer <LEAD_QUEUE_KEY>`.
 * Disabled (503) until LEAD_QUEUE_KEY is set in Netlify's environment variables.
 */

export type Status = 'queued' | 'active' | 'done' | 'replied' | 'bounced' | 'optout' | 'failed' | 'cancelled';
export interface Item {
  id: string;
  email: string;
  business: string;
  script: 'ads' | 'website';
  fromName: string;
  subject: string;
  /** Plain text bodies: the first email, then the follow ups. Emptied once the item is finished. */
  steps: string[];
  /** Sending days to wait before each follow up. */
  followupDays: number[];
  status: Status;
  sent: number;
  sentAt: number[];
  nextAt: number;
  threadId: string;
  messageId: string;
  lease: { until: number; step: number } | null;
  attempts: number;
  error: string;
  addedAt: number;
  statusAt: number;
}
export interface Settings {
  paused: boolean;
  maxPerDay: number;
  days: number[];
  startHour: number;
  endHour: number;
  gapMinutes: number;
}
export interface State {
  items: Item[];
  never: string[];
  settings: Settings;
  pausedReason: '' | 'manual' | 'bounces' | 'limit';
  pausedUntil: number;
  firstSendDay: string;
  sentByDay: Record<string, number>;
  lastSendAt: number;
  lastClaimAt: number;
  senderSeenAt: number;
  updatedAt: number;
}
export interface Job {
  id: string;
  step: number;
  to: string;
  fromName: string;
  subject: string;
  body: string;
  threadId: string;
  messageId: string;
  /** The last claim ran out without a report: the sender checks Gmail's Sent folder before sending. */
  verify: boolean;
}
/** The subset of a Netlify Blobs store this function uses (lets tests pass an in-memory store). */
export interface QueueStore {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}

const KEY = 'state';
const MAX_ITEMS = 1500;
const MAX_NEVER = 5000;
const MAX_BODY = 1_500_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const DUBAI = 4 * 60 * MIN; // UTC+4 all year, no daylight saving
const LEASE = 15 * MIN;
const KEEP_DAYS = 14;
const TERMINAL: Status[] = ['done', 'replied', 'bounced', 'optout', 'failed', 'cancelled'];
export const DEFAULT_SETTINGS: Settings = { paused: false, maxPerDay: 30, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, gapMinutes: 10 };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clip = (v: unknown, max: number) => str(v, max).replace(/[\uD800-\uDBFF]$/, '').toWellFormed();
// Subject and name go into email headers: one line only.
const oneLine = (v: unknown, max: number) => clip(typeof v === 'string' ? v.replace(/\s+/g, ' ') : '', max);
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[a-z0-9-]+\.)+[a-z]{2,}$/;
const cleanEmail = (v: unknown) => {
  const e = str(v, 300).toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : '';
};
const isOpen = (x: Item) => x.status === 'queued' || x.status === 'active';

/* Dubai time: the day, weekday and hour the sending rules use. */
const inDubai = (t: number) => new Date(t + DUBAI);
export const dubaiDay = (t: number) => inDubai(t).toISOString().slice(0, 10);
export const dubaiWeekday = (t: number) => inDubai(t).getUTCDay();
export const dubaiHour = (t: number) => inDubai(t).getUTCHours();
export const nextDubaiMidnight = (t: number) => Date.parse(dubaiDay(t)) + DAY - DUBAI;

/** `n` sending days after `t`, at the same time of day. */
export function addBusinessDays(t: number, n: number, days: number[]) {
  while (n > 0 && days.length) {
    t += DAY;
    if (days.includes(dubaiWeekday(t))) n--;
  }
  return t;
}

/** Today's cap: the sender (an established Gmail) starts at 15 a day, then 25 in its second week, then `maxPerDay` decides. */
export function capFor(maxPerDay: number, firstSendDay: string, now: number) {
  const age = firstSendDay ? Math.round((Date.parse(dubaiDay(now)) - Date.parse(firstSendDay)) / DAY) : 0;
  return Math.min(maxPerDay, age < 7 ? 15 : age < 14 ? 25 : 40);
}

function cleanItem(raw: unknown, now: number): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 100);
  const email = cleanEmail(r.email);
  const subject = oneLine(r.subject, 200);
  const steps = Array.isArray(r.steps) ? r.steps.map((s) => (typeof s === 'string' ? s.trim().toWellFormed() : '')) : [];
  if (!/^[\w:.-]{1,80}$/.test(id) || !email || !subject || !steps.length || steps.length > 3 || steps.some((s) => !s || s.length > 6000)) return null;
  const gaps = Array.isArray(r.followupDays) ? r.followupDays : [3, 4];
  return {
    id,
    email,
    business: oneLine(r.business, 200),
    script: r.script === 'ads' ? 'ads' : 'website',
    fromName: oneLine(r.fromName, 80) || 'Samil',
    subject,
    steps,
    followupDays: gaps.slice(0, 2).map((d) => Math.max(1, Math.min(30, Math.round(num(d)) || 3))),
    status: 'queued',
    sent: 0,
    sentAt: [],
    nextAt: 0,
    threadId: '',
    messageId: '',
    lease: null,
    attempts: 0,
    error: '',
    addedAt: now,
    statusAt: now,
  };
}

const fresh = (): State => ({
  items: [],
  never: [],
  settings: { ...DEFAULT_SETTINGS },
  pausedReason: '',
  pausedUntil: 0,
  firstSendDay: '',
  sentByDay: {},
  lastSendAt: 0,
  lastClaimAt: 0,
  senderSeenAt: 0,
  updatedAt: 0,
});

async function readState(store: QueueStore): Promise<{ state: State; etag?: string; exists: boolean }> {
  const res = await store.getWithMetadata(KEY, { type: 'json' });
  const data = res?.data as State | undefined;
  const state = data && Array.isArray(data.items) ? { ...fresh(), ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } } : fresh();
  return { state, etag: res?.etag, exists: !!res };
}

/** Keeps the blob small: the newest items (oldest finished ones go first), the never list and two weeks of counts. */
function tidy(s: State, now: number) {
  if (s.items.length > MAX_ITEMS) {
    const done = s.items.filter((x) => TERMINAL.includes(x.status)).sort((x, y) => x.statusAt - y.statusAt);
    const drop = new Set(done.slice(0, s.items.length - MAX_ITEMS));
    s.items = s.items.filter((x) => !drop.has(x)).slice(-MAX_ITEMS);
  }
  s.never = s.never.slice(-MAX_NEVER);
  const from = dubaiDay(now - (KEEP_DAYS - 1) * DAY);
  for (const day of Object.keys(s.sentByDay)) if (day < from) delete s.sentByDay[day];
}

/** Read-modify-write with optimistic concurrency, so the sender and the extension never overwrite each other. */
async function mutate(store: QueueStore, now: number, change: (s: State) => void): Promise<State> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag, exists } = await readState(store);
    change(state);
    tidy(state, now);
    state.updatedAt = now;
    // The local `netlify dev` Blobs server returns no ETag on reads; fall back to a plain write there.
    const res = await store.setJSON(KEY, state, etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true });
    if (res.modified) return state;
    await new Promise((r) => setTimeout(r, 40 + attempt * 60));
  }
  throw new Error('conflict');
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Finished items drop their bodies to keep the blob small. */
function setStatus(item: Item, status: Status, now: number) {
  if (item.status === status) return;
  item.status = status;
  item.statusAt = now;
  if (TERMINAL.includes(status)) item.steps = [];
}

function addNever(s: State, email: string) {
  if (email && !s.never.includes(email)) s.never.push(email);
}

/** A pause for Gmail's own daily limit ends by itself at midnight in Dubai. */
function resume(s: State, now: number) {
  if (s.pausedUntil && s.pausedUntil <= now) {
    s.pausedUntil = 0;
    if (s.pausedReason === 'limit') s.pausedReason = '';
  }
}

/** `lite` leaves out the email texts (the sender and the sync only need where each email stands) and says how many there are. */
function view(s: State, now: number, lite = false) {
  resume(s, now);
  const counts = { queued: 0, active: 0, done: 0, replied: 0, bounced: 0, optout: 0, failed: 0, cancelled: 0 };
  for (const x of s.items) counts[x.status]++;
  return {
    items: lite ? s.items.map(({ steps, ...x }) => ({ ...x, total: steps.length || x.sent })) : s.items,
    settings: s.settings,
    stats: { today: s.sentByDay[dubaiDay(now)] || 0, cap: capFor(s.settings.maxPerDay, s.firstSendDay, now), ...counts },
    never: s.never.length,
    pausedReason: s.pausedReason,
    pausedUntil: s.pausedUntil,
    firstSendDay: s.firstSendDay,
    senderSeenAt: s.senderSeenAt,
    now,
  };
}

function refusal(s: State, item: Item) {
  if (s.never.includes(item.email)) return 'never';
  // Never email anyone twice: another item for the address blocks it, unless that one was stopped before anything went out.
  if (s.items.some((x) => x.id !== item.id && x.email === item.email && (x.status !== 'cancelled' || x.sent > 0))) return 'duplicate';
  if (s.items.some((x) => x.id === item.id && x.sent > 0)) return 'already_sent';
  return '';
}

function add(s: State, list: unknown[], now: number) {
  const rejected: { id: string; reason: string }[] = [];
  let accepted = 0;
  for (const raw of list) {
    const item = cleanItem(raw, now);
    const reason = item ? refusal(s, item) : 'invalid';
    if (!item || reason) {
      rejected.push({ id: item?.id || (raw && typeof raw === 'object' ? str((raw as Record<string, unknown>).id, 80) : ''), reason });
      continue;
    }
    // Adding an unsent item again replaces it. A running claim is kept so the sender can never send it twice.
    const old = s.items.findIndex((x) => x.id === item.id);
    if (old > -1) item.lease = s.items.splice(old, 1)[0].lease;
    s.items.push(item);
    accepted++;
  }
  return { accepted, rejected };
}

function applySettings(s: State, v: Record<string, unknown>) {
  const cur = s.settings;
  const clamp = (x: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(num(x))));
  if (v.paused === true && !cur.paused) s.pausedReason = 'manual';
  if (v.paused === false) {
    s.pausedReason = '';
    s.pausedUntil = 0;
  }
  if (typeof v.paused === 'boolean') cur.paused = v.paused;
  if (typeof v.maxPerDay === 'number') cur.maxPerDay = clamp(v.maxPerDay, 1, 40);
  if (typeof v.gapMinutes === 'number') cur.gapMinutes = clamp(v.gapMinutes, 5, 120);
  const list = v.days;
  if (Array.isArray(list)) {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => list.includes(d));
    if (days.length) cur.days = days;
  }
  const start = v.startHour ?? cur.startHour;
  const end = v.endHour ?? cur.endHour;
  if (Number.isInteger(start) && Number.isInteger(end) && (start as number) >= 0 && (end as number) <= 24 && (start as number) < (end as number)) {
    cur.startHour = start as number;
    cur.endHour = end as number;
  }
}

/** The sender asks for one email to send. Every rule is checked here, in this order. */
function claim(s: State, now: number): { job: Job | null; reason?: string } {
  resume(s, now);
  const { paused, days, startHour, endHour, gapMinutes, maxPerDay } = s.settings;
  const hour = dubaiHour(now);
  if (paused || s.pausedUntil > now) return { job: null, reason: 'paused' };
  if (!days.includes(dubaiWeekday(now)) || hour < startHour || hour >= endHour) return { job: null, reason: 'outside_hours' };
  if ((s.sentByDay[dubaiDay(now)] || 0) >= capFor(maxPerDay, s.firstSendDay, now)) return { job: null, reason: 'daily_cap' };
  if (now - Math.max(s.lastSendAt, s.lastClaimAt) < gapMinutes * MIN) return { job: null, reason: 'spacing' };

  // First a claim that ran out without a report (it may have gone out), then a due follow up, then the oldest new email.
  const open = s.items.filter(isOpen);
  const oldest = (list: Item[], key: (x: Item) => number) => list.sort((x, y) => key(x) - key(y))[0];
  const item =
    oldest(open.filter((x) => x.lease && x.lease.until <= now), (x) => x.lease?.until ?? 0) ||
    oldest(open.filter((x) => !x.lease && x.status === 'active' && x.nextAt <= now), (x) => x.nextAt) ||
    oldest(open.filter((x) => !x.lease && x.status === 'queued'), (x) => x.addedAt);
  if (!item) return { job: null, reason: 'nothing_due' };
  const verify = !!item.lease;
  item.lease = { until: now + LEASE, step: item.sent };
  s.lastClaimAt = now;
  const { id, sent: step, email: to, fromName, subject, threadId, messageId } = item;
  return { job: { id, step, to, fromName, subject, body: item.steps[step], threadId, messageId, verify } };
}

/** The sender's answer for one job. Returns false when the report changes nothing (a duplicate or an old one). */
function report(s: State, b: Record<string, unknown>, now: number) {
  const item = s.items.find((x) => x.id === b.id);
  if (!item || b.step !== item.sent) return false;
  const finished = TERMINAL.includes(item.status);
  if (b.ok !== true) {
    if (finished) return false;
    item.lease = null;
    if (b.limit === true) {
      // Gmail's own daily limit: pause until midnight in Dubai and try this email again then.
      if (!s.settings.paused) s.pausedReason = 'limit';
      s.pausedUntil = nextDubaiMidnight(now);
      return true;
    }
    item.error = str(b.error, 300);
    if (b.permanent === true) addNever(s, item.email);
    if (b.permanent === true || ++item.attempts >= 3) setStatus(item, 'failed', now);
    return true;
  }
  // An email that went out just as it was stopped still counts, so it is never sent again.
  if (finished && !item.lease) return false;
  const today = dubaiDay(now);
  item.sent++;
  item.sentAt.push(now);
  item.threadId ||= str(b.threadId, 100).replace(/[^\w-]/g, '');
  item.messageId ||= str(b.messageId, 300).replace(/\s/g, '');
  item.lease = null;
  item.attempts = 0;
  item.error = '';
  s.sentByDay[today] = (s.sentByDay[today] || 0) + 1;
  s.lastSendAt = now;
  s.firstSendDay ||= today;
  if (finished) return true;
  if (item.sent < item.steps.length) {
    setStatus(item, 'active', now);
    item.nextAt = addBusinessDays(now, item.followupDays[item.sent - 1] ?? 3, s.settings.days);
  } else setStatus(item, 'done', now);
  return true;
}

type InboxEvent = { id: string; type: 'replied' | 'bounced' | 'optout' };
/** Replies, bounces and opt outs the sender found in the inbox. */
function applyEvents(s: State, events: InboxEvent[], now: number) {
  let bounced = false;
  for (const e of events) {
    const item = s.items.find((x) => x.id === e.id);
    if (!item) continue;
    // An opt out wins over everything else.
    if (e.type === 'optout' || (e.type === 'bounced' && item.status !== 'optout')) {
      bounced ||= e.type === 'bounced' && item.status !== 'bounced';
      setStatus(item, e.type, now);
      addNever(s, item.email);
    } else if (e.type === 'replied' && (!TERMINAL.includes(item.status) || item.status === 'done' || (item.status === 'cancelled' && item.sent > 0))) {
      setStatus(item, 'replied', now);
    }
  }
  // Bounces hurt the Gmail account: 3 among the last 30 first emails pause sending until the owner looks.
  if (bounced) {
    const recent = s.items.filter((x) => x.sentAt.length).sort((x, y) => y.sentAt[0] - x.sentAt[0]).slice(0, 30);
    if (recent.filter((x) => x.status === 'bounced').length >= 3) {
      s.settings.paused = true;
      s.pausedReason = 'bounces';
    }
  }
}

export async function handle(req: Request, store: QueueStore, secret: string | undefined, nowFn = Date.now): Promise<Response> {
  if (!secret || secret.length < 24) return json({ error: 'not_configured' }, 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !sameSecret(token, secret)) return json({ error: 'unauthorized' }, 401);

  try {
    const now = nowFn();
    if (req.method === 'GET') return json(view((await readState(store)).state, now, new URL(req.url).searchParams.get('lite') === '1'));
    if (req.method !== 'PUT' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const b = await body(req);
    if (!b) return json({ error: 'invalid_body' }, 400);
    const bad = () => json({ error: 'invalid_body' }, 400);

    // Extension: add emails to send.
    if (req.method === 'PUT') {
      if (!Array.isArray(b.items)) return bad();
      const list = b.items.slice(0, MAX_ITEMS);
      let result = { accepted: 0, rejected: [] as { id: string; reason: string }[] };
      const state = await mutate(store, now, (s) => (result = add(s, list, now)));
      return json({ ...view(state, now), ...result });
    }

    const { action } = b;
    // Extension: stop emails, edit the never list, change settings.
    if (action === 'cancel' || action === 'never' || action === 'settings') {
      if (action === 'cancel' && !Array.isArray(b.ids)) return bad();
      if (action === 'never' && !Array.isArray(b.emails)) return bad();
      if (action === 'settings' && (!b.settings || typeof b.settings !== 'object')) return bad();
      const state = await mutate(store, now, (s) => {
        if (action === 'cancel') {
          const ids = new Set((b.ids as unknown[]).map((x) => str(x, 80)));
          for (const x of s.items) if (ids.has(x.id) && isOpen(x)) setStatus(x, 'cancelled', now);
        } else if (action === 'never') {
          const emails = (b.emails as unknown[]).slice(0, MAX_NEVER).map(cleanEmail).filter(Boolean);
          if (b.remove === true) s.never = s.never.filter((e) => !emails.includes(e));
          else
            for (const e of emails) {
              addNever(s, e);
              for (const x of s.items) if (x.email === e && isOpen(x)) setStatus(x, 'optout', now);
            }
        } else applySettings(s, b.settings as Record<string, unknown>);
      });
      return json(view(state, now));
    }

    // Sender: ask for the next email.
    if (action === 'claim') {
      let out: ReturnType<typeof claim> = { job: null, reason: 'nothing_due' };
      await mutate(store, now, (s) => {
        s.senderSeenAt = now;
        out = claim(s, now);
      });
      return json(out);
    }

    // Sender: how a send went.
    if (action === 'report') {
      if (typeof b.id !== 'string' || typeof b.step !== 'number') return bad();
      let changed = false;
      await mutate(store, now, (s) => (changed = report(s, b, now)));
      return json(changed ? { ok: true } : { ok: true, ignored: true });
    }

    // Sender: what it found in the inbox.
    if (action === 'events') {
      if (!Array.isArray(b.events)) return bad();
      const events = b.events
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({ id: str(e.id, 80), type: e.type }) as InboxEvent)
        .filter((e) => e.id && ['replied', 'bounced', 'optout'].includes(e.type))
        .slice(0, MAX_ITEMS);
      await mutate(store, now, (s) => applyEvents(s, events, now));
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return json({ error: (e as Error).message === 'conflict' ? 'conflict' : 'server_error' }, (e as Error).message === 'conflict' ? 409 : 500);
  }
}

export default async (req: Request) => handle(req, getStore({ name: 'email-queue', consistency: 'strong' }), Netlify.env.get('LEAD_QUEUE_KEY'));

export const config: Config = {
  path: '/api/email-queue',
};
