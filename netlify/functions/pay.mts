import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Client invoice payments through Ziina (pages: src/pages/pay.astro at /pay/<token>, public/invoices.html at /invoices).
 *
 * Public, per invoice (the token in the link is the secret, invoice numbers are never enough):
 * - GET  /api/pay/:token            invoice summary for the payment page
 * - POST /api/pay/:token/checkout   creates a Ziina payment intent for the stored amount, answers { url } to redirect to
 * - GET  /api/pay/:token/status     asks Ziina about this invoice's recent payment attempts; marks it paid once one is completed
 *
 * Private (the /invoices page): GET and POST /api/pay with `Authorization: Bearer <INVOICE_ADMIN_KEY>`
 * (falls back to LEAD_DESK_KEY so the Lead Desk key opens it too).
 *
 * ZIINA_API_KEY stays on the server. With ZIINA_TEST_MODE=true every payment intent is created as a test payment.
 * The amount always comes from the stored invoice, never from the browser.
 */

export type InvoiceStatus = 'unpaid' | 'paid' | 'void';
export interface Attempt {
  id: string;
  at: number;
  test: boolean;
  url: string;
}
export interface Invoice {
  id: string;
  token: string;
  number: string;
  client: string;
  clientWa: string;
  description: string;
  /** In fils (AED 425 = 42500). */
  amount: number;
  currency: 'AED';
  status: InvoiceStatus;
  createdAt: number;
  updatedAt: number;
  paidAt: number | null;
  /** True when the completed payment was a Ziina test payment (no money moved). */
  paidTest: boolean;
  paymentId: string;
  cardBrand: string;
  cardLast4: string;
  attempts: Attempt[];
}
interface Doc {
  rev: number;
  seq: number;
  invoices: Invoice[];
}
/** The subset of a Netlify Blobs store this function uses (lets tests pass an in-memory store). */
export interface PayStore {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}
export interface PayEnv {
  ziinaKey?: string;
  testMode: boolean;
  adminKey?: string;
}
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

const ZIINA = 'https://api-v2.ziina.com/api/payment_intent';
const DOC_KEY = 'invoices';
const MIN = 60_000;
const MIN_FILS = 200; // Ziina's minimum is AED 2
const MAX_FILS = 9_000_000; // AED 90,000, Ziina's per-transaction ceiling for verified accounts
const MAX_INVOICES = 2000;
const KEEP_ATTEMPTS = 20;
const CHECK_ATTEMPTS = 5;
const ATTEMPTS_PER_10_MIN = 8;
const MAX_BODY = 64 * 1024;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

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
    invoices: Array.isArray(d.invoices) ? (d.invoices as Invoice[]) : [],
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
function publicView(inv: Invoice, env: PayEnv) {
  return {
    number: inv.number,
    client: inv.client,
    description: inv.description,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    createdAt: inv.createdAt,
    paidAt: inv.paidAt,
    paidTest: inv.paidTest,
    reference: inv.status === 'paid' ? inv.paymentId : '',
    cardBrand: inv.status === 'paid' ? inv.cardBrand : '',
    cardLast4: inv.status === 'paid' ? inv.cardLast4 : '',
    testMode: env.testMode,
    payable: inv.status === 'unpaid' && !!env.ziinaKey,
  };
}

/* -------------------------------------------------------------------- ziina */
interface Intent {
  id: string;
  status: string;
  amount: number;
  currency_code: string;
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

/* ------------------------------------------------------------- public routes */
async function checkout(req: Request, store: PayStore, env: PayEnv, d: Deps, token: string): Promise<Response> {
  if (!env.ziinaKey) return json({ error: 'not_configured' }, 503);
  const now = d.now();
  const { doc } = await read(store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  if (inv.status === 'paid') return json({ error: 'already_paid' }, 409);
  if (inv.status === 'void') return json({ error: 'void' }, 410);
  if (inv.attempts.filter((a) => a.at > now - 10 * MIN).length >= ATTEMPTS_PER_10_MIN) return json({ error: 'rate_limited' }, 429);

  const back = `${new URL(req.url).origin}/pay/${inv.token}`;
  const intent = await ziina(d, env.ziinaKey, '', {
    method: 'POST',
    body: JSON.stringify({
      amount: inv.amount,
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
    cur.attempts = [...cur.attempts, { id: intent.id, at: now, test: env.testMode, url: intent.redirect_url as string }].slice(-KEEP_ATTEMPTS);
    cur.updatedAt = now;
    return true;
  });
  return json({ url: intent.redirect_url });
}

/** Checks the newest attempts with Ziina and marks the invoice paid when one completed for the right amount. */
async function status(store: PayStore, env: PayEnv, d: Deps, token: string): Promise<Response> {
  const { doc } = await read(store);
  const inv = findByToken(doc.invoices, token);
  if (!inv) return json({ error: 'not_found' }, 404);
  if (inv.status !== 'unpaid' || !env.ziinaKey || !inv.attempts.length) return json({ invoice: publicView(inv, env), last: '' });

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
    if (intent.status === 'completed' && intent.amount === inv.amount && intent.currency_code === inv.currency) {
      paid = { intent, test: a.test };
      break;
    }
  }
  if (!paid) {
    // Every lookup failed: say so instead of showing "not paid yet".
    if (!last && failure) throw failure;
    return json({ invoice: publicView(inv, env), last });
  }

  const now = d.now();
  const { intent, test } = paid;
  const updated = await mutate(store, (fresh) => {
    const cur = fresh.invoices.find((x) => x.id === inv.id);
    if (!cur || cur.status === 'paid') return false;
    cur.status = 'paid';
    cur.paidAt = now;
    cur.paidTest = test;
    cur.paymentId = intent.id;
    cur.cardBrand = str(intent.card_details?.card_brand, 30);
    cur.cardLast4 = str(intent.card_details?.card_last_four, 4).replace(/\D/g, '');
    cur.updatedAt = now;
    return true;
  });
  const done = updated.invoices.find((x) => x.id === inv.id) || inv;
  return json({ invoice: publicView(done, env), last: 'completed' });
}

/* -------------------------------------------------------------- admin routes */
function adminView(inv: Invoice) {
  const { attempts, ...rest } = inv;
  return { ...rest, attemptCount: attempts.length, lastAttemptAt: attempts.length ? attempts[attempts.length - 1].at : null };
}

function toFils(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function createInvoice(doc: Doc, raw: unknown, now: number): Invoice | string {
  if (!isObj(raw)) return 'invalid_invoice';
  const client = str(raw.client, 120);
  if (!client) return 'client_required';
  const amount = toFils(raw.amountAed);
  if (!Number.isInteger(amount) || amount < MIN_FILS) return 'amount_too_small';
  if (amount > MAX_FILS) return 'amount_too_large';
  if (doc.invoices.length >= MAX_INVOICES) return 'too_many_invoices';
  let number = str(raw.number, 40).replace(/[^\w.\/-]/g, '');
  if (number && doc.invoices.some((x) => x.number.toLowerCase() === number.toLowerCase())) return 'number_taken';
  doc.seq += 1;
  if (!number) {
    const year = new Date(now + 4 * 3600_000).getUTCFullYear(); // Dubai time
    do number = `RR-${year}-${String(doc.seq).padStart(4, '0')}`;
    while (doc.invoices.some((x) => x.number === number) && ++doc.seq);
  }
  const wa = str(raw.clientWa, 30).replace(/\D/g, '');
  const inv: Invoice = {
    id: `inv_${randomBytes(8).toString('hex')}`,
    token: randomBytes(18).toString('base64url'),
    number,
    client,
    clientWa: wa.startsWith('0') ? `971${wa.slice(1)}` : wa,
    description: str(raw.description, 300),
    amount,
    currency: 'AED',
    status: 'unpaid',
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    paidTest: false,
    paymentId: '',
    cardBrand: '',
    cardLast4: '',
    attempts: [],
  };
  doc.invoices.push(inv);
  return inv;
}

async function admin(req: Request, store: PayStore, env: PayEnv, d: Deps): Promise<Response> {
  if (!env.adminKey || env.adminKey.length < 24) return json({ error: 'not_configured' }, 503);
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!given || !sameSecret(given, env.adminKey)) return json({ error: 'unauthorized' }, 401);

  const list = (doc: Doc) =>
    json({
      invoices: [...doc.invoices].sort((a, b) => b.createdAt - a.createdAt).map(adminView),
      testMode: env.testMode,
      ziinaReady: !!env.ziinaKey,
    });

  if (req.method === 'GET') return list((await read(store)).doc);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'too_large' }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!isObj(body)) return json({ error: 'invalid_body' }, 400);

  const now = d.now();
  let result: unknown = null;
  let error = '';
  const doc = await mutate(store, (fresh) => {
    result = null;
    error = '';
    if (body.op === 'create') {
      const r = createInvoice(fresh, body.invoice, now);
      if (typeof r === 'string') {
        error = r;
        return false;
      }
      result = adminView(r);
      return true;
    }
    const inv = fresh.invoices.find((x) => x.id === str(body.id, 40));
    if (!inv) {
      error = 'not_found';
      return false;
    }
    if (body.op === 'void' || body.op === 'unvoid') {
      if (inv.status === 'paid') {
        error = 'already_paid';
        return false;
      }
      inv.status = body.op === 'void' ? 'void' : 'unpaid';
    } else if (body.op === 'markPaid') {
      // For payments received some other way (bank transfer, cash).
      if (inv.status === 'paid') return false;
      inv.status = 'paid';
      inv.paidAt = now;
      inv.paidTest = false;
      inv.paymentId = 'manual';
    } else if (body.op === 'delete') {
      if (inv.status === 'paid' && !inv.paidTest) {
        error = 'cannot_delete_paid';
        return false;
      }
      fresh.invoices = fresh.invoices.filter((x) => x !== inv);
      result = { deleted: true };
      return true;
    } else {
      error = 'unknown_op';
      return false;
    }
    inv.updatedAt = now;
    result = adminView(inv);
    return true;
  });
  if (error) return json({ error }, 400);
  const res = await list(doc).json();
  return json({ ...res, result });
}

/* -------------------------------------------------------------------- entry */
export async function handle(req: Request, store: PayStore, env: PayEnv, deps: Partial<Deps> = {}): Promise<Response> {
  const d: Deps = { fetch: deps.fetch || globalThis.fetch, now: deps.now || (() => Date.now()) };
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/pay(?:\/([^/]+))?(?:\/(checkout|status))?\/?$/);
  try {
    if (!m) return json({ error: 'not_found' }, 404);
    const [, token, action] = m;
    if (!token) return await admin(req, store, env, d);
    if (action === 'checkout') {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return await checkout(req, store, env, d, token);
    }
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (action === 'status') return await status(store, env, d, token);
    const inv = findByToken((await read(store)).doc.invoices, token);
    return inv ? json({ invoice: publicView(inv, env) }) : json({ error: 'not_found' }, 404);
  } catch (e) {
    const code = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof HttpError ? e.message : 'server_error' }, code);
  }
}

export default async (req: Request) => {
  const env: PayEnv = {
    ziinaKey: Netlify.env.get('ZIINA_API_KEY') || undefined,
    testMode: (Netlify.env.get('ZIINA_TEST_MODE') || '').toLowerCase() === 'true',
    adminKey: Netlify.env.get('INVOICE_ADMIN_KEY') || Netlify.env.get('LEAD_DESK_KEY') || undefined,
  };
  return handle(req, getStore({ name: 'invoices', consistency: 'strong' }), env);
};

export const config: Config = {
  path: ['/api/pay', '/api/pay/:token', '/api/pay/:token/:action'],
};
