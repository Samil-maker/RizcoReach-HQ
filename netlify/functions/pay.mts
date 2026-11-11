import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createInvoice,
  dubaiDay,
  dubaiHour,
  invoiceFromPlan,
  isDay,
  isEmail,
  isObj,
  isOverdue,
  normalizeInvoice,
  normalizePlan,
  normalizeSettings,
  payTotal,
  reminderDue,
  savePlan,
  str,
  text,
  type Doc,
  type Invoice,
  type MailKind,
  type Settings,
} from '../billing/core.mts';
import { renderInvoicePdf } from '../billing/pdf.mts';
import { buildEmail, smtpMailer, type MailMessage, type Mailer } from '../billing/mail.mts';

/**
 * Client invoices and payments through Ziina (pages: src/pages/pay.astro at /pay/<token>, src/pages/invoices.astro at /invoices).
 * The model (fees, recurring plans, settings) is in netlify/billing/core.mts, the PDF in pdf.mts, the emails in mail.mts.
 *
 * Public, per invoice (the token in the link is the secret, invoice numbers are never enough):
 * - GET  /api/pay/:token            invoice summary for the payment page
 * - POST /api/pay/:token/checkout   creates a Ziina payment intent for the stored amount, answers { url } to redirect to
 * - GET  /api/pay/:token/status     asks Ziina about this invoice's recent payment attempts; marks it paid once one is completed
 * - GET  /api/pay/:token/pdf        the invoice (or, once paid, the receipt) as a PDF
 *
 * Private (the /invoices page): GET and POST /api/pay with `Authorization: Bearer <INVOICE_ADMIN_KEY>`
 * (falls back to LEAD_DESK_KEY so the Lead Desk key opens it too).
 *
 * ZIINA_API_KEY stays on the server. With ZIINA_TEST_MODE=true every payment intent is created as a test payment.
 * The amount always comes from the stored invoice, never from the browser.
 * Emails go out over SMTP once SMTP_USER and SMTP_PASS are set. netlify/functions/pay-cron.mts runs `runScheduled`
 * every hour: recurring invoices, reminders, queued emails, and a second look at payments that never came back.
 */

export type { Invoice, InvoiceStatus, Attempt } from '../billing/core.mts';

/** The subset of a Netlify Blobs store this function uses (lets tests pass an in-memory store). */
export interface PayStore {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}
export interface PayEnv {
  ziinaKey?: string;
  testMode: boolean;
  adminKey?: string;
  /** The address emails are sent from. Emails are off without it (and without `Deps.mail`). */
  mailFrom?: string;
  /** Where "you got paid" emails go. Defaults to `mailFrom`. */
  notifyTo?: string;
  /** The site's own address, for links in emails sent by the schedule. */
  siteUrl?: string;
}
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  mail?: Mailer;
  /** Runs work after the response has gone out (Netlify's waitUntil). Without it the work is awaited. */
  defer: (work: Promise<unknown>) => Promise<void> | void;
}
interface Ctx {
  store: PayStore;
  env: PayEnv;
  d: Deps;
  /** Origin for links: the request's own, or the site's for the schedule. */
  site: string;
}

const ZIINA = 'https://api-v2.ziina.com/api/payment_intent';
const DOC_KEY = 'invoices';
const MIN = 60_000;
const HOUR = 60 * MIN;
const KEEP_ATTEMPTS = 20;
const CHECK_ATTEMPTS = 5;
const ATTEMPTS_PER_10_MIN = 8;
const MAX_BODY = 64 * 1024;
const CLAIM_MS = 10 * MIN; // how long one run owns an email it is sending
const MAIL_TRIES = 3;
const MAIL_EXPIRY = 24 * HOUR; // a queued email that still hasn't gone by then is dropped, not sent late
const DEFAULT_SITE = 'https://www.rizcoreach.ae';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const canMail = (ctx: Ctx) => !!ctx.d.mail && isEmail(ctx.env.mailFrom);

class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ storage */
function asDoc(data: unknown): Doc {
  const d = isObj(data) ? data : {};
  return {
    rev: typeof d.rev === 'number' ? d.rev : 0,
    seq: typeof d.seq === 'number' ? d.seq : 0,
    invoices: Array.isArray(d.invoices) ? d.invoices.map(normalizeInvoice) : [],
    plans: Array.isArray(d.plans) ? d.plans.map(normalizePlan) : [],
    settings: normalizeSettings(d.settings),
  };
}

async function read(store: PayStore) {
  const res = await store.getWithMetadata(DOC_KEY, { type: 'json' });
  return { doc: asDoc(res?.data), etag: res?.etag, exists: !!res };
}

/** Read-modify-write with optimistic concurrency (same approach as lead-desk.mts). `change` returns false for no write. */
async function mutate(store: PayStore, change: (doc: Doc) => boolean): Promise<Doc> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { doc, etag, exists } = await read(store);
    if (!change(doc)) return doc;
    doc.rev += 1;
    const res = await store.setJSON(DOC_KEY, doc, etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true });
    if (res.modified) return doc;
    await new Promise((r) => setTimeout(r, 40 + attempt * 60 + Math.random() * 40));
  }
  throw new HttpError(409, 'conflict');
}

function findByToken(invoices: Invoice[], token: string): Invoice | null {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  const want = digest(token);
  let found: Invoice | null = null;
  // Compare against every invoice so the time taken does not depend on which one matched.
  for (const inv of invoices) if (timingSafeEqual(digest(inv.token), want) && !found) found = inv;
  return found;
}

/** What the client's payment page may see. */
function publicView(inv: Invoice, env: PayEnv, today: string) {
  return {
    number: inv.number,
    client: inv.client,
    description: inv.description,
    items: inv.items,
    notes: inv.notes,
    amount: inv.amount,
    onlineFee: inv.onlineFee,
    payTotal: payTotal(inv),
    currency: inv.currency,
    status: inv.status,
    createdAt: inv.createdAt,
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    overdue: isOverdue(inv, today),
    paidAt: inv.paidAt,
    paidAmount: inv.status === 'paid' ? inv.paidAmount : 0,
    paidTest: inv.paidTest,
    reference: inv.status === 'paid' ? inv.paymentId : '',
    cardBrand: inv.status === 'paid' ? inv.cardBrand : '',
    cardLast4: inv.status === 'paid' ? inv.cardLast4 : '',
    testMode: env.testMode,
    payable: inv.status === 'unpaid' && !!env.ziinaKey,
  };
}

function adminView(inv: Invoice) {
  const { attempts, ...rest } = inv;
  return { ...rest, payTotal: payTotal(inv), attemptCount: attempts.length, lastAttemptAt: attempts.length ? attempts[attempts.length - 1].at : null };
}

function listBody(doc: Doc, ctx: Ctx) {
  return {
    invoices: [...doc.invoices].sort((a, b) => b.createdAt - a.createdAt).map(adminView),
    plans: [...doc.plans].sort((a, b) => Number(b.active) - Number(a.active) || a.nextOn.localeCompare(b.nextOn)),
    settings: doc.settings,
    today: dubaiDay(ctx.d.now()),
    testMode: ctx.env.testMode,
    ziinaReady: !!ctx.env.ziinaKey,
    mailReady: canMail(ctx),
    mailFrom: ctx.env.mailFrom || '',
  };
}

/* -------------------------------------------------------------------- ziina */
interface Intent {
  id: string;
  status: string;
  amount: number;
  currency_code: string;
  /** What Ziina kept from this payment, in fils. */
  fee_amount?: number | null;
  redirect_url?: string;
  card_details?: { card_brand?: string; card_last_four?: string } | null;
}

async function ziina(d: Deps, key: string, path: string, init: RequestInit = {}): Promise<Intent> {
  let res: Response;
  try {
    res = await d.fetch(`${ZIINA}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'ziina_unreachable');
  }
  const data = (await res.json().catch(() => null)) as Intent | null;
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'ziina_key_rejected');
  if (!res.ok || !data || typeof data.id !== 'string') throw new HttpError(502, 'ziina_error');
  return data;
}

/* -------------------------------------------------------------------- email */
/** Puts an email in an invoice's outbox, replacing one of the same kind that is still waiting. */
function queue(inv: Invoice, kind: MailKind, now: number, auto: boolean) {
  inv.outbox = [...inv.outbox.filter((e) => e.kind !== kind), { kind, at: now, claimedAt: 0, tries: 0, auto }];
}

async function compose(ctx: Ctx, kind: MailKind, inv: Invoice, settings: Settings): Promise<MailMessage> {
  const now = ctx.d.now();
  const payUrl = `${ctx.site}/pay/${inv.token}`;
  const test = inv.status === 'paid' ? inv.paidTest : ctx.env.testMode;
  const mail = buildEmail(kind, inv, { settings, payUrl, site: ctx.site, test, today: dubaiDay(now) });
  const to = kind === 'owner' ? ctx.env.notifyTo || ctx.env.mailFrom || '' : inv.clientEmail;
  if (!isEmail(to)) throw new Error('no_email_address');
  const msg: MailMessage = { to, fromName: settings.business.name, ...mail };
  if (kind !== 'owner') {
    const pdf = await renderInvoicePdf(inv, { settings, payUrl, test, now });
    const name = `${settings.business.name}-${inv.status === 'paid' ? 'receipt' : 'invoice'}-${inv.number}`.replace(/[^\w.-]+/g, '-');
    msg.attachments = [{ filename: `${name}.pdf`, content: pdf, contentType: 'application/pdf' }];
  }
  return msg;
}

/**
 * Sends one queued email. The outbox entry is claimed first, so two runs at the same moment
 * (a button press and the hourly schedule, say) never send it twice.
 */
async function deliver(ctx: Ctx, id: string, kind: MailKind): Promise<{ ok: boolean; error: string }> {
  const { store, d } = ctx;
  if (!canMail(ctx)) return { ok: false, error: 'email_not_configured' };
  const now = d.now();
  let claimed: Invoice | null = null;
  let settings: Settings | null = null;
  await mutate(store, (doc) => {
    claimed = null;
    const inv = doc.invoices.find((x) => x.id === id);
    const entry = inv?.outbox.find((e) => e.kind === kind && e.claimedAt <= now - CLAIM_MS);
    if (!inv || !entry) return false;
    entry.claimedAt = now;
    claimed = structuredClone(inv);
    settings = doc.settings;
    return true;
  });
  if (!claimed || !settings) return { ok: false, error: 'nothing_to_send' };

  let error = '';
  let to = '';
  try {
    const msg = await compose(ctx, kind, claimed, settings);
    to = msg.to;
    await (d.mail as Mailer)(msg);
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200) || 'send_failed';
  }

  await mutate(store, (doc) => {
    const inv = doc.invoices.find((x) => x.id === id);
    if (!inv) return false;
    const entry = inv.outbox.find((e) => e.kind === kind);
    const retry = !!error && !!entry && entry.auto && entry.tries + 1 < MAIL_TRIES;
    if (entry && retry) {
      entry.tries += 1;
      entry.claimedAt = 0;
    } else inv.outbox = inv.outbox.filter((e) => e.kind !== kind);
    inv.mailLog = [...inv.mailLog, { kind, at: now, to, ok: !error, error }].slice(-12);
    if (!error) {
      if (kind === 'invoice') {
        inv.sentAt = now;
        inv.sentTo = to;
        inv.sendCount += 1;
      } else if (kind === 'reminder') inv.reminders = [...inv.reminders, now].slice(-12);
      else if (kind === 'receipt') inv.receiptAt = now;
    }
    return true;
  });
  return { ok: !error, error };
}

/** Sends what is waiting in the outboxes, oldest first. Returns how many went out. */
async function flushOutbox(ctx: Ctx, limit: number, deadline = Infinity): Promise<number> {
  const now = ctx.d.now();
  const { doc } = await read(ctx.store);
  const stale = (at: number) => at < now - MAIL_EXPIRY;
  if (doc.invoices.some((inv) => inv.outbox.some((e) => stale(e.at)))) {
    await mutate(ctx.store, (fresh) => {
      for (const inv of fresh.invoices) inv.outbox = inv.outbox.filter((e) => !stale(e.at));
      return true;
    });
  }
  if (!canMail(ctx)) return 0;
  const due = doc.invoices
    .flatMap((inv) => inv.outbox.filter((e) => !stale(e.at) && e.claimedAt <= now - CLAIM_MS).map((e) => ({ id: inv.id, kind: e.kind, at: e.at })))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
  let sent = 0;
  for (const job of due) {
    if (Date.now() > deadline) break;
    if ((await deliver(ctx, job.id, job.kind)).ok) sent += 1;
  }
  return sent;
}

/* ------------------------------------------------------------- public routes */
async function checkout(ctx: Ctx, token: string): Promise<Response> {
  const { store, env, d } = ctx;
  if (!env.ziinaKey) return json({ error: 'not_configured' }, 503);
  const now = d.now();
  const { doc } = await read(store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  if (inv.status === 'paid') return json({ error: 'already_paid' }, 409);
  if (inv.status === 'void') return json({ error: 'void' }, 410);
  if (inv.attempts.filter((a) => a.at > now - 10 * MIN).length >= ATTEMPTS_PER_10_MIN) return json({ error: 'rate_limited' }, 429);

  const back = `${ctx.site}/pay/${inv.token}`;
  const amount = payTotal(inv);
  const intent = await ziina(d, env.ziinaKey, '', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      currency_code: inv.currency,
      message: `RizcoReach invoice ${inv.number}`,
      success_url: `${back}?r=success`,
      cancel_url: `${back}?r=cancel`,
      failure_url: `${back}?r=failure`,
      test: env.testMode,
      allow_tips: false,
    }),
  });
  if (!intent.redirect_url || !/^https:\/\//.test(intent.redirect_url)) throw new HttpError(502, 'ziina_error');

  await mutate(store, (fresh) => {
    const cur = fresh.invoices.find((x) => x.id === inv.id);
    if (!cur) return false;
    cur.attempts = [...cur.attempts, { id: intent.id, at: now, test: env.testMode, url: intent.redirect_url as string, amount }].slice(-KEEP_ATTEMPTS);
    cur.updatedAt = now;
    return true;
  });
  return json({ url: intent.redirect_url });
}

/**
 * Checks an unpaid invoice's newest attempts with Ziina and marks it paid when one completed for the amount that
 * checkout charged. Queues the receipt and the owner's notice.
 */
async function checkPaid(ctx: Ctx, inv: Invoice): Promise<{ inv: Invoice; last: string; paidNow: boolean }> {
  const { store, env, d } = ctx;
  if (inv.status !== 'unpaid' || !env.ziinaKey || !inv.attempts.length) return { inv, last: '', paidNow: false };

  let last = '';
  let failure: unknown = null;
  let paid: { intent: Intent; test: boolean } | null = null;
  for (const a of [...inv.attempts].reverse().slice(0, CHECK_ATTEMPTS)) {
    let intent: Intent;
    try {
      intent = await ziina(d, env.ziinaKey, `/${encodeURIComponent(a.id)}`);
    } catch (e) {
      failure ??= e;
      continue;
    }
    if (!last) last = intent.status;
    if (intent.status === 'completed' && intent.amount === (a.amount ?? inv.amount) && intent.currency_code === inv.currency) {
      paid = { intent, test: a.test };
      break;
    }
  }
  if (!paid) {
    // Every lookup failed: say so instead of showing "not paid yet".
    if (!last && failure) throw failure;
    return { inv, last, paidNow: false };
  }

  const now = d.now();
  const { intent, test } = paid;
  let paidNow = false;
  const updated = await mutate(store, (fresh) => {
    paidNow = false;
    const cur = fresh.invoices.find((x) => x.id === inv.id);
    if (!cur || cur.status === 'paid') return false;
    cur.status = 'paid';
    cur.paidAt = now;
    cur.paidTest = test;
    cur.paidVia = 'ziina';
    cur.paidAmount = intent.amount;
    cur.ziinaFee = typeof intent.fee_amount === 'number' && intent.fee_amount >= 0 ? Math.round(intent.fee_amount) : null;
    cur.paymentId = intent.id;
    cur.cardBrand = str(intent.card_details?.card_brand, 30);
    cur.cardLast4 = str(intent.card_details?.card_last_four, 4).replace(/\D/g, '');
    cur.outbox = cur.outbox.filter((e) => e.kind !== 'invoice' && e.kind !== 'reminder');
    if (canMail(ctx)) {
      if (fresh.settings.receipts && isEmail(cur.clientEmail)) queue(cur, 'receipt', now, true);
      if (fresh.settings.notifyOwner) queue(cur, 'owner', now, true);
    }
    cur.updatedAt = now;
    paidNow = true;
    return true;
  });
  return { inv: updated.invoices.find((x) => x.id === inv.id) || inv, last: 'completed', paidNow };
}

async function status(ctx: Ctx, token: string): Promise<Response> {
  const { doc } = await read(ctx.store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  const r = await checkPaid(ctx, inv);
  if (r.paidNow) await ctx.d.defer(flushOutbox(ctx, 4).catch(() => 0));
  return json({ invoice: publicView(r.inv, ctx.env, dubaiDay(ctx.d.now())), last: r.last });
}

async function summary(ctx: Ctx, token: string, preview: boolean): Promise<Response> {
  const now = ctx.d.now();
  const { doc } = await read(ctx.store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  if (!preview && inv.status === 'unpaid' && !inv.viewedAt) {
    // First time the client opens the link. The owner's own "Open" button passes preview=1.
    inv.viewedAt = now;
    await mutate(ctx.store, (fresh) => {
      const cur = fresh.invoices.find((x) => x.id === inv.id);
      if (!cur || cur.viewedAt) return false;
      cur.viewedAt = now;
      return true;
    }).catch(() => null);
  }
  return json({ invoice: publicView(inv, ctx.env, dubaiDay(now)) });
}

async function pdf(ctx: Ctx, token: string): Promise<Response> {
  const { doc } = await read(ctx.store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  const test = inv.status === 'paid' ? inv.paidTest : ctx.env.testMode;
  const bytes = await renderInvoicePdf(inv, { settings: doc.settings, payUrl: `${ctx.site}/pay/${inv.token}`, test, now: ctx.d.now() });
  const name = `${doc.settings.business.name}-${inv.status === 'paid' ? 'receipt' : 'invoice'}-${inv.number}`.replace(/[^\w.-]+/g, '-');
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}.pdf"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

/* -------------------------------------------------------------- admin routes */
interface Outcome {
  write: boolean;
  result?: unknown;
  error?: string;
  /** An email to send straight after the write. */
  send?: { id: string; kind: MailKind };
  /** Why an email that was asked for could not be queued. */
  mailError?: string;
  /** The invoice `result` should be refreshed from after sending. */
  id?: string;
}

/** Applies one admin action to the document. Pure: `mutate` may run it again on a fresh copy. */
function applyOp(doc: Doc, body: Record<string, unknown>, now: number, mailOn: boolean): Outcome {
  const op = body.op;
  const today = dubaiDay(now);
  const emailFor = (inv: Invoice, kind: MailKind): Outcome => {
    if (!isEmail(inv.clientEmail)) return { write: false, error: 'email_required' };
    if (!mailOn) return { write: true, result: adminView(inv), mailError: 'email_not_configured', id: inv.id };
    queue(inv, kind, now, false);
    return { write: true, result: adminView(inv), send: { id: inv.id, kind }, id: inv.id };
  };

  if (op === 'create') {
    const raw = body.invoice;
    const inv = createInvoice(doc, raw, now);
    if (typeof inv === 'string') return { write: false, error: inv };
    if (isObj(raw) && raw.send === true) return emailFor(inv, 'invoice');
    return { write: true, result: adminView(inv), id: inv.id };
  }
  if (op === 'settings') {
    doc.settings = normalizeSettings(body.settings);
    return { write: true, result: doc.settings };
  }
  if (op === 'planSave') {
    const plan = savePlan(doc, body.plan, now);
    return typeof plan === 'string' ? { write: false, error: plan } : { write: true, result: plan };
  }
  if (op === 'planToggle' || op === 'planDelete' || op === 'planRun') {
    const plan = doc.plans.find((p) => p.id === str(body.id, 40));
    if (!plan) return { write: false, error: 'not_found' };
    if (op === 'planDelete') {
      doc.plans = doc.plans.filter((p) => p !== plan);
      return { write: true, result: { deleted: true } };
    }
    if (op === 'planToggle') {
      plan.active = body.active === true;
      // A plan switched back on after its date passed starts again from today instead of billing for the gap.
      if (plan.active && plan.nextOn < today) plan.nextOn = today;
      if (plan.active && plan.endOn && plan.endOn < plan.nextOn) plan.endOn = '';
      plan.updatedAt = now;
      return { write: true, result: plan };
    }
    const inv = invoiceFromPlan(doc, plan, today, now);
    if (typeof inv === 'string') return { write: false, error: inv };
    if (plan.autoEmail && isEmail(inv.clientEmail)) return emailFor(inv, 'invoice');
    return { write: true, result: adminView(inv), id: inv.id };
  }

  const inv = doc.invoices.find((x) => x.id === str(body.id, 40));
  if (!inv) return { write: false, error: 'not_found' };
  if (op === 'void' || op === 'unvoid') {
    if (inv.status === 'paid') return { write: false, error: 'already_paid' };
    inv.status = op === 'void' ? 'void' : 'unpaid';
    if (op === 'void') inv.outbox = [];
  } else if (op === 'markPaid') {
    // For payments received some other way (bank transfer, cash).
    if (inv.status === 'paid') return { write: false };
    inv.status = 'paid';
    inv.paidAt = now;
    inv.paidTest = false;
    inv.paidVia = 'manual';
    inv.paidAmount = inv.amount;
    inv.ziinaFee = null;
    inv.paymentId = 'manual';
    inv.outbox = inv.outbox.filter((e) => e.kind !== 'invoice' && e.kind !== 'reminder');
  } else if (op === 'delete') {
    if (inv.status === 'paid' && !inv.paidTest) return { write: false, error: 'cannot_delete_paid' };
    doc.invoices = doc.invoices.filter((x) => x !== inv);
    return { write: true, result: { deleted: true } };
  } else if (op === 'update') {
    const patch = isObj(body.patch) ? body.patch : {};
    if (typeof patch.clientEmail === 'string') {
      const email = str(patch.clientEmail, 200).toLowerCase();
      if (email && !isEmail(email)) return { write: false, error: 'invalid_email' };
      inv.clientEmail = email;
    }
    if (typeof patch.clientWa === 'string') {
      const wa = str(patch.clientWa, 30).replace(/\D/g, '');
      inv.clientWa = wa.startsWith('0') ? `971${wa.slice(1)}` : wa;
    }
    if (typeof patch.clientAddress === 'string') inv.clientAddress = text(patch.clientAddress, 300);
    if (typeof patch.notes === 'string') inv.notes = text(patch.notes, 500);
    if (patch.dueOn !== undefined && inv.status !== 'paid') {
      if (patch.dueOn !== '' && !isDay(patch.dueOn)) return { write: false, error: 'invalid_date' };
      inv.dueOn = patch.dueOn as string;
      inv.remindedFor = [];
    }
  } else if (op === 'send' || op === 'remind' || op === 'receipt') {
    if (op === 'receipt' ? inv.status !== 'paid' : inv.status !== 'unpaid') return { write: false, error: op === 'receipt' ? 'not_paid' : inv.status === 'paid' ? 'already_paid' : 'void' };
    if (typeof body.email === 'string' && body.email.trim()) {
      const email = str(body.email, 200).toLowerCase();
      if (!isEmail(email)) return { write: false, error: 'invalid_email' };
      inv.clientEmail = email;
    }
    inv.updatedAt = now;
    return emailFor(inv, op === 'send' ? 'invoice' : op === 'remind' ? 'reminder' : 'receipt');
  } else return { write: false, error: 'unknown_op' };
  inv.updatedAt = now;
  return { write: true, result: adminView(inv), id: inv.id };
}

async function admin(req: Request, ctx: Ctx): Promise<Response> {
  const { store, env, d } = ctx;
  if (!env.adminKey || env.adminKey.length < 24) return json({ error: 'not_configured' }, 503);
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!given || !sameSecret(given, env.adminKey)) return json({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') return json(listBody((await read(store)).doc, ctx));
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'too_large' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!isObj(body)) return json({ error: 'invalid_body' }, 400);
  const now = d.now();

  if (body.op === 'sync') {
    // Ask Ziina again about payments that never came back to the receipt page.
    const paid = await reconcile(ctx, 8, Date.now() + 15_000);
    await flushOutbox(ctx, 4, Date.now() + 8_000);
    return json({ ...listBody((await read(store)).doc, ctx), result: { paid } });
  }
  if (body.op === 'testEmail') {
    if (!canMail(ctx)) return json({ error: 'email_not_configured' }, 400);
    const to = env.notifyTo || env.mailFrom || '';
    let error = '';
    try {
      await (d.mail as Mailer)({
        to,
        fromName: (await read(store)).doc.settings.business.name,
        subject: 'Invoice emails are connected',
        text: `This is a test from your invoices page. Invoices, reminders and receipts will be sent from ${env.mailFrom}.`,
        html: `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#0a0a0a;">This is a test from your invoices page. Invoices, reminders and receipts will be sent from <b>${env.mailFrom}</b>.</p>`,
      });
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200) || 'send_failed';
    }
    return json({ ...listBody((await read(store)).doc, ctx), result: { to }, mail: { ok: !error, error } });
  }

  let out: Outcome = { write: false };
  let doc = await mutate(store, (fresh) => {
    out = applyOp(fresh, body, now, canMail(ctx));
    return out.write;
  });
  if (out.error) return json({ error: out.error }, 400);
  let mail: { ok: boolean; error: string } | null = out.mailError ? { ok: false, error: out.mailError } : null;
  if (out.send) {
    mail = await deliver(ctx, out.send.id, out.send.kind);
    doc = (await read(store)).doc;
  }
  const after = out.id ? doc.invoices.find((x) => x.id === out.id) : null;
  return json({ ...listBody(doc, ctx), result: after ? adminView(after) : (out.result ?? null), mail });
}

/* ----------------------------------------------------------------- schedule */
/** A second look at unpaid invoices with a recent checkout, for clients who paid and closed the tab. */
async function reconcile(ctx: Ctx, limit: number, deadline = Infinity): Promise<number> {
  const now = ctx.d.now();
  const { doc } = await read(ctx.store);
  const lastAt = (inv: Invoice) => inv.attempts[inv.attempts.length - 1]?.at ?? 0;
  const recent = doc.invoices
    .filter((inv) => inv.status === 'unpaid' && lastAt(inv) > now - 72 * HOUR)
    .sort((a, b) => lastAt(b) - lastAt(a))
    .slice(0, limit);
  let paid = 0;
  for (const inv of recent) {
    if (Date.now() > deadline) break;
    try {
      if ((await checkPaid(ctx, inv)).paidNow) paid += 1;
    } catch {
      /* Ziina was unreachable: the next run tries again */
    }
  }
  return paid;
}

/**
 * The hourly run (netlify/functions/pay-cron.mts). From 9:00 Dubai time it creates the invoices recurring plans are
 * due for and queues reminders; every hour it re-checks recent payments and sends queued emails.
 */
export async function runScheduled(store: PayStore, env: PayEnv, deps: Partial<Deps> = {}) {
  const ctx: Ctx = { store, env, d: fullDeps(deps), site: env.siteUrl || DEFAULT_SITE };
  const now = ctx.d.now();
  const today = dubaiDay(now);
  const deadline = Date.now() + 20_000;
  const out = { invoices: 0, reminders: 0, paid: 0, emails: 0 };

  if (dubaiHour(now) >= 9) {
    await mutate(store, (doc) => {
      out.invoices = 0;
      out.reminders = 0;
      let changed = false;
      for (const plan of doc.plans) {
        if (!plan.active || !plan.nextOn || plan.nextOn > today) continue;
        changed = true;
        if (plan.endOn && plan.nextOn > plan.endOn) {
          plan.active = false;
          continue;
        }
        const inv = invoiceFromPlan(doc, plan, today, now);
        if (typeof inv === 'string') {
          // Can't bill (the invoice list is full, say): pause rather than fail every hour.
          plan.active = false;
          continue;
        }
        if (plan.autoEmail && canMail(ctx) && isEmail(inv.clientEmail)) queue(inv, 'invoice', now, true);
        out.invoices += 1;
      }
      if (canMail(ctx))
        for (const inv of doc.invoices) {
          const mark = reminderDue(inv, doc.settings, today);
          if (mark === null) continue;
          const marks = [0, ...doc.settings.reminders.afterDays].filter((m) => m <= mark);
          inv.remindedFor = [...new Set([...inv.remindedFor, ...marks])];
          queue(inv, 'reminder', now, true);
          out.reminders += 1;
          changed = true;
        }
      return changed;
    });
  }
  out.paid = await reconcile(ctx, 6, deadline);
  out.emails = await flushOutbox(ctx, 8, deadline);
  return out;
}

/* -------------------------------------------------------------------- entry */
function fullDeps(deps: Partial<Deps>): Deps {
  return {
    fetch: deps.fetch || globalThis.fetch,
    now: deps.now || (() => Date.now()),
    mail: deps.mail,
    defer: deps.defer || (async (work) => void (await work)),
  };
}

export async function handle(req: Request, store: PayStore, env: PayEnv, deps: Partial<Deps> = {}): Promise<Response> {
  const url = new URL(req.url);
  const ctx: Ctx = { store, env, d: fullDeps(deps), site: url.origin };
  const m = url.pathname.match(/^\/api\/pay(?:\/([^/]+))?(?:\/(checkout|status|pdf))?\/?$/);
  try {
    if (!m) return json({ error: 'not_found' }, 404);
    const [, token, action] = m;
    if (!token) return await admin(req, ctx);
    if (action === 'checkout') {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await checkout(ctx, token);
    }
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (action === 'status') return await status(ctx, token);
    if (action === 'pdf') return await pdf(ctx, token);
    return await summary(ctx, token, url.searchParams.get('preview') === '1');
  } catch (e) {
    const code = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof HttpError ? e.message : 'server_error' }, code);
  }
}

/** Environment, store and mailer as Netlify provides them. Shared with pay-cron.mts. */
export function runtime() {
  const get = (name: string) => (Netlify.env.get(name) || '').trim();
  const user = get('SMTP_USER');
  // Google shows app passwords in four spaced groups; they work without the spaces.
  const pass = /^([a-z]{4} ){3}[a-z]{4}$/.test(get('SMTP_PASS')) ? get('SMTP_PASS').replace(/ /g, '') : get('SMTP_PASS');
  const from = get('SMTP_FROM') || user;
  const env: PayEnv = {
    ziinaKey: get('ZIINA_API_KEY') || undefined,
    testMode: get('ZIINA_TEST_MODE').toLowerCase() === 'true',
    adminKey: get('INVOICE_ADMIN_KEY') || get('LEAD_DESK_KEY') || undefined,
    mailFrom: user && pass && isEmail(from) ? from : undefined,
    notifyTo: isEmail(get('INVOICE_NOTIFY_EMAIL')) ? get('INVOICE_NOTIFY_EMAIL') : undefined,
    siteUrl: get('URL') || undefined,
  };
  const mail = env.mailFrom ? smtpMailer({ host: get('SMTP_HOST') || 'smtp.gmail.com', port: Number(get('SMTP_PORT')) || 465, user, pass, from }) : undefined;
  return { env, mail, store: getStore({ name: 'invoices', consistency: 'strong' }) };
}

export default async (req: Request, context: Context) => {
  const { env, mail, store } = runtime();
  return handle(req, store, env, { mail, defer: (work) => context.waitUntil(work) });
};

export const config: Config = {
  path: ['/api/pay', '/api/pay/:token', '/api/pay/:token/:action'],
};
