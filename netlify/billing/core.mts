import { randomBytes } from 'node:crypto';

/**
 * Billing model shared by the pay function, the invoice PDF and the emails:
 * types, money and date helpers, fee recovery, and recurring schedules. No network or storage here.
 *
 * All money is in fils (AED 425 = 42500). All calendar days are Dubai days written YYYY-MM-DD.
 */

export type InvoiceStatus = 'unpaid' | 'paid' | 'void';
/** How Ziina's fee is recovered: not at all, built into the prices, or as a separate line the client sees at checkout. */
export type FeeMode = 'none' | 'included' | 'line';
export type Every = 'week' | 'month' | 'quarter' | 'year';
export type MailKind = 'invoice' | 'reminder' | 'receipt' | 'owner';

export interface Item {
  description: string;
  qty: number;
  /** Price for one, in fils. Negative for a discount line. */
  rate: number;
  amount: number;
}
export interface Attempt {
  id: string;
  at: number;
  test: boolean;
  url: string;
  /** What this checkout charged, in fils (older attempts have none: the invoice amount). */
  amount?: number;
}
export interface OutboxEntry {
  kind: MailKind;
  at: number;
  /** Set while one run is sending it, so two runs never send the same email. */
  claimedAt: number;
  tries: number;
  /** Queued by the schedule (retried on failure) rather than by a button press. */
  auto: boolean;
}
export interface MailLogEntry {
  kind: MailKind;
  at: number;
  to: string;
  ok: boolean;
  error: string;
}
export interface Invoice {
  id: string;
  token: string;
  number: string;
  client: string;
  clientEmail: string;
  clientWa: string;
  clientAddress: string;
  /** One line summary (the first item, or all of them joined). */
  description: string;
  items: Item[];
  notes: string;
  /** What the client owes, in fils. With feeMode "included" the fee is already inside this. */
  amount: number;
  currency: 'AED';
  feeMode: FeeMode;
  /** feeMode "line": added on top of `amount` when paying online. */
  onlineFee: number;
  /** feeMode "included": how much was added to the prices to cover the fee (for the owner's eyes only). */
  feeCovered: number;
  issuedOn: string;
  dueOn: string;
  status: InvoiceStatus;
  createdAt: number;
  updatedAt: number;
  viewedAt: number | null;
  sentAt: number | null;
  sentTo: string;
  sendCount: number;
  reminders: number[];
  /** Reminder milestones already handled (0 = due day, 3 = three days overdue, ...). */
  remindedFor: number[];
  receiptAt: number | null;
  paidAt: number | null;
  /** True when the completed payment was a Ziina test payment (no money moved). */
  paidTest: boolean;
  paidVia: '' | 'ziina' | 'manual';
  /** What was actually collected, in fils. */
  paidAmount: number;
  /** The fee Ziina reported for the payment, in fils. Null when unknown. */
  ziinaFee: number | null;
  paymentId: string;
  cardBrand: string;
  cardLast4: string;
  planId: string;
  attempts: Attempt[];
  outbox: OutboxEntry[];
  mailLog: MailLogEntry[];
}
export interface Plan {
  id: string;
  client: string;
  clientEmail: string;
  clientWa: string;
  clientAddress: string;
  /** As entered, before any fee is added. Descriptions may use {month} and {year}. */
  items: Item[];
  notes: string;
  feeMode: FeeMode;
  every: Every;
  /** Day of the month the schedule is pinned to, so 31 Jan goes to 28 Feb and back to 31 Mar. */
  anchorDay: number;
  nextOn: string;
  endOn: string;
  dueDays: number;
  autoEmail: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunOn: string;
  count: number;
}
export interface Settings {
  business: { name: string; address: string; email: string; phone: string; website: string; bank: string };
  fee: { mode: FeeMode; percentBp: number; fixedFils: number };
  dueDays: number;
  /** Printed at the bottom of new invoices. */
  notes: string;
  reminders: { enabled: boolean; onDue: boolean; afterDays: number[] };
  /** Email the client a receipt when Ziina confirms a payment. */
  receipts: boolean;
  /** Email the owner when an invoice is paid. */
  notifyOwner: boolean;
}
export interface Doc {
  rev: number;
  seq: number;
  invoices: Invoice[];
  plans: Plan[];
  settings: Settings;
}

export const MIN_FILS = 200; // Ziina's minimum is AED 2
export const MAX_FILS = 9_000_000; // AED 90,000, Ziina's per-transaction ceiling for verified accounts
export const MAX_INVOICES = 2000;
export const MAX_PLANS = 200;
export const MAX_ITEMS = 20;
const DUBAI_OFFSET = 4 * 3600_000; // no daylight saving
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------------ basics */
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
/** Like `str` but keeps line breaks (addresses, notes, bank details). */
export const text = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim().replace(/[ \t]+/g, ' '))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max)
    : '';
const int = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(v);

export function toFils(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** 42500 -> "425.00", 1875050 -> "18,750.50". */
export function money(fils: number): string {
  const neg = fils < 0;
  const abs = Math.abs(Math.round(fils));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${whole}.${String(abs % 100).padStart(2, '0')}`;
}
export const aed = (fils: number) => `AED ${money(fils)}`;

/* ------------------------------------------------------------------- dates */
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const dubaiDay = (ms: number) => new Date(ms + DUBAI_OFFSET).toISOString().slice(0, 10);
export const dubaiHour = (ms: number) => new Date(ms + DUBAI_OFFSET).getUTCHours();
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(dayMs(day) + n * DAY).toISOString().slice(0, 10);
/** Whole days from `a` to `b` (positive when b is later). */
export const diffDays = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY);
/** "2026-11-18" -> "18 November 2026". */
export function fmtDay(day: string): string {
  if (!isDay(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** A timestamp as Dubai date and time: "30 October 2026 at 14:05". */
export function fmtTime(ms: number): string {
  const d = new Date(ms + DUBAI_OFFSET);
  return `${fmtDay(d.toISOString().slice(0, 10))} at ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function addMonths(day: string, months: number, anchorDay: number): string {
  const [y, m] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(clamp(anchorDay, 1, 31), last));
  return first.toISOString().slice(0, 10);
}
/** The next date on a schedule after `day`. */
export function nextDate(day: string, every: Every, anchorDay: number): string {
  if (every === 'week') return addDays(day, 7);
  return addMonths(day, every === 'month' ? 1 : every === 'quarter' ? 3 : 12, anchorDay);
}
/** {month} -> "November 2026", {year} -> "2026", for recurring invoice lines. */
export function fillTokens(s: string, day: string): string {
  const [y, m] = day.split('-').map(Number);
  return s.replace(/\{month\}/gi, `${MONTHS[m - 1]} ${y}`).replace(/\{year\}/gi, String(y));
}

/* -------------------------------------------------------------------- fees */
/** The smallest charge that still leaves `net` after a fee of percent + fixed is taken from it. */
export function grossUp(net: number, fee: Settings['fee']): number {
  const bp = clamp(fee.percentBp, 0, 2000);
  return Math.ceil(((net + Math.max(0, fee.fixedFils)) * 10_000) / (10_000 - bp));
}
/** What a fee of percent + fixed takes from a charge. */
export const feeOn = (charge: number, fee: Settings['fee']) => Math.round((charge * fee.percentBp) / 10_000) + fee.fixedFils;

export const sumItems = (items: Item[]) => items.reduce((s, i) => s + i.amount, 0);

/** Applies a fee mode to entered items: what the invoice shows, what is owed, and what checkout adds. */
export function priceWithFee(items: Item[], mode: FeeMode, fee: Settings['fee']) {
  const base = sumItems(items);
  if (mode === 'line' && base > 0) return { items, amount: base, onlineFee: grossUp(base, fee) - base, feeCovered: 0 };
  if (mode === 'included' && base > 0) {
    // Raise each price a little, rounding up, so the lines still add up on the page.
    const target = grossUp(base, fee);
    const raised = items.map((i) => {
      const rate = Math.ceil((i.rate * target) / base);
      return { ...i, rate, amount: Math.round(i.qty * rate) };
    });
    const amount = sumItems(raised);
    return { items: raised, amount, onlineFee: 0, feeCovered: amount - base };
  }
  return { items, amount: base, onlineFee: 0, feeCovered: 0 };
}

/** What the client pays online: the invoice plus the online fee line, if there is one. */
export const payTotal = (inv: Pick<Invoice, 'amount' | 'onlineFee'>) => inv.amount + inv.onlineFee;
export const isOverdue = (inv: Pick<Invoice, 'status' | 'dueOn'>, today: string) => inv.status === 'unpaid' && !!inv.dueOn && inv.dueOn < today;

/* ---------------------------------------------------------------- settings */
export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: 'RizcoReach',
    address: 'Dubai, United Arab Emirates',
    email: 'support@rizcoreach.ae',
    phone: '+971 56 846 1835',
    website: 'rizcoreach.ae',
    bank: '',
  },
  // Ziina's published rate for UAE cards. International cards cost more, which can't be known before payment.
  fee: { mode: 'included', percentBp: 260, fixedFils: 100 },
  dueDays: 7,
  notes: 'Thank you for your business.',
  reminders: { enabled: false, onDue: true, afterDays: [3, 7] },
  receipts: true,
  notifyOwner: true,
};

const feeMode = (v: unknown, fallback: FeeMode): FeeMode => (v === 'none' || v === 'included' || v === 'line' ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function normalizeSettings(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const b = isObj(r.business) ? r.business : {};
  const f = isObj(r.fee) ? r.fee : {};
  const rem = isObj(r.reminders) ? r.reminders : {};
  const D = DEFAULT_SETTINGS;
  const afterDays = Array.isArray(rem.afterDays)
    ? [...new Set(rem.afterDays.map((n) => int(n, -1)).filter((n) => n >= 1 && n <= 90))].sort((a, b) => a - b).slice(0, 4)
    : D.reminders.afterDays;
  return {
    business: {
      name: str(b.name, 80) || D.business.name,
      address: typeof b.address === 'string' ? text(b.address, 300) : D.business.address,
      email: typeof b.email === 'string' ? str(b.email, 120) : D.business.email,
      phone: typeof b.phone === 'string' ? str(b.phone, 40) : D.business.phone,
      website: typeof b.website === 'string' ? str(b.website, 80) : D.business.website,
      bank: text(b.bank, 500),
    },
    fee: {
      mode: feeMode(f.mode, D.fee.mode),
      percentBp: clamp(int(f.percentBp, D.fee.percentBp), 0, 1000),
      fixedFils: clamp(int(f.fixedFils, D.fee.fixedFils), 0, 2000),
    },
    dueDays: clamp(int(r.dueDays, D.dueDays), 0, 120),
    notes: typeof r.notes === 'string' ? text(r.notes, 500) : D.notes,
    reminders: { enabled: bool(rem.enabled, D.reminders.enabled), onDue: bool(rem.onDue, D.reminders.onDue), afterDays },
    receipts: bool(r.receipts, D.receipts),
    notifyOwner: bool(r.notifyOwner, D.notifyOwner),
  };
}

/* ------------------------------------------------------------------- items */
/** Reads invoice lines from `items`, or from the single `amountAed` + `description` of the simple form. */
export function parseItems(raw: Record<string, unknown>): Item[] | string {
  const list = Array.isArray(raw.items) ? raw.items.filter(isObj) : [];
  if (!list.length) {
    const amount = toFils(raw.amountAed);
    if (!Number.isInteger(amount)) return 'amount_too_small';
    return [{ description: str(raw.description, 300), qty: 1, rate: amount, amount }];
  }
  if (list.length > MAX_ITEMS) return 'too_many_items';
  const items: Item[] = [];
  for (const it of list) {
    const rate = toFils(it.rateAed ?? it.amountAed);
    const qtyRaw = it.qty === undefined || it.qty === '' ? 1 : Number(it.qty);
    if (!Number.isInteger(rate) || Math.abs(rate) > MAX_FILS) return 'invalid_item';
    if (!Number.isFinite(qtyRaw) || qtyRaw <= 0 || qtyRaw > 10_000) return 'invalid_item';
    const qty = Math.round(qtyRaw * 100) / 100;
    const description = str(it.description, 200);
    if (!description && !rate) continue; // an empty row in the form
    items.push({ description, qty, rate, amount: Math.round(qty * rate) });
  }
  return items.length ? items : 'amount_too_small';
}

const normalizeItem = (raw: unknown): Item => {
  const r = isObj(raw) ? raw : {};
  const qty = typeof r.qty === 'number' && r.qty > 0 ? r.qty : 1;
  const rate = int(r.rate);
  return { description: str(r.description, 300), qty, rate, amount: int(r.amount, Math.round(qty * rate)) };
};

/* ---------------------------------------------------------------- invoices */
/** Fills in everything newer than the first version of the invoice record, so old invoices keep working. */
export function normalizeInvoice(raw: unknown): Invoice {
  const r = isObj(raw) ? raw : {};
  const amount = int(r.amount);
  const description = typeof r.description === 'string' ? r.description : '';
  const createdAt = int(r.createdAt);
  const status: InvoiceStatus = r.status === 'paid' || r.status === 'void' ? r.status : 'unpaid';
  const paymentId = typeof r.paymentId === 'string' ? r.paymentId : '';
  const items = Array.isArray(r.items) && r.items.length ? r.items.map(normalizeItem) : [{ description, qty: 1, rate: amount, amount }];
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []);
  return {
    id: String(r.id ?? ''),
    token: String(r.token ?? ''),
    number: String(r.number ?? ''),
    client: String(r.client ?? ''),
    clientEmail: typeof r.clientEmail === 'string' ? r.clientEmail : '',
    clientWa: typeof r.clientWa === 'string' ? r.clientWa : '',
    clientAddress: typeof r.clientAddress === 'string' ? r.clientAddress : '',
    description,
    items,
    notes: typeof r.notes === 'string' ? r.notes : '',
    amount,
    currency: 'AED',
    feeMode: feeMode(r.feeMode, 'none'),
    onlineFee: Math.max(0, int(r.onlineFee)),
    feeCovered: Math.max(0, int(r.feeCovered)),
    issuedOn: isDay(r.issuedOn) ? r.issuedOn : dubaiDay(createdAt),
    dueOn: isDay(r.dueOn) ? r.dueOn : '',
    status,
    createdAt,
    updatedAt: int(r.updatedAt, createdAt),
    viewedAt: typeof r.viewedAt === 'number' ? r.viewedAt : null,
    sentAt: typeof r.sentAt === 'number' ? r.sentAt : null,
    sentTo: typeof r.sentTo === 'string' ? r.sentTo : '',
    sendCount: int(r.sendCount),
    reminders: nums(r.reminders),
    remindedFor: nums(r.remindedFor),
    receiptAt: typeof r.receiptAt === 'number' ? r.receiptAt : null,
    paidAt: typeof r.paidAt === 'number' ? r.paidAt : null,
    paidTest: r.paidTest === true,
    paidVia: r.paidVia === 'ziina' || r.paidVia === 'manual' ? r.paidVia : status === 'paid' ? (paymentId === 'manual' ? 'manual' : 'ziina') : '',
    paidAmount: int(r.paidAmount, status === 'paid' ? amount : 0),
    ziinaFee: typeof r.ziinaFee === 'number' ? r.ziinaFee : null,
    paymentId,
    cardBrand: typeof r.cardBrand === 'string' ? r.cardBrand : '',
    cardLast4: typeof r.cardLast4 === 'string' ? r.cardLast4 : '',
    planId: typeof r.planId === 'string' ? r.planId : '',
    attempts: Array.isArray(r.attempts) ? (r.attempts as Attempt[]) : [],
    outbox: Array.isArray(r.outbox) ? (r.outbox as OutboxEntry[]) : [],
    mailLog: Array.isArray(r.mailLog) ? (r.mailLog as MailLogEntry[]) : [],
  };
}

const summary = (items: Item[]) =>
  items
    .map((i) => i.description)
    .filter(Boolean)
    .join(', ')
    .slice(0, 300);

/** Adds an invoice to the document. Returns the invoice, or an error code. */
export function createInvoice(doc: Doc, raw: unknown, now: number): Invoice | string {
  if (!isObj(raw)) return 'invalid_invoice';
  const client = str(raw.client, 120);
  if (!client) return 'client_required';
  const entered = parseItems(raw);
  if (typeof entered === 'string') return entered;
  const priced = priceWithFee(entered, feeMode(raw.feeMode, 'none'), doc.settings.fee);
  if (!Number.isInteger(priced.amount) || priced.amount < MIN_FILS) return 'amount_too_small';
  if (priced.amount + priced.onlineFee > MAX_FILS) return 'amount_too_large';
  const clientEmail = str(raw.clientEmail, 200).toLowerCase();
  if (clientEmail && !isEmail(clientEmail)) return 'invalid_email';
  if (doc.invoices.length >= MAX_INVOICES) return 'too_many_invoices';
  let number = str(raw.number, 40).replace(/[^\w.\/-]/g, '');
  if (number && doc.invoices.some((x) => x.number.toLowerCase() === number.toLowerCase())) return 'number_taken';
  doc.seq += 1;
  if (!number) {
    const year = dubaiDay(now).slice(0, 4);
    do number = `RR-${year}-${String(doc.seq).padStart(4, '0')}`;
    while (doc.invoices.some((x) => x.number === number) && ++doc.seq);
  }
  const issuedOn = dubaiDay(now);
  const dueDays = raw.dueDays === undefined || raw.dueDays === '' ? NaN : Number(raw.dueDays);
  const dueOn = isDay(raw.dueOn) ? raw.dueOn : Number.isFinite(dueDays) ? addDays(issuedOn, clamp(Math.round(dueDays), 0, 365)) : '';
  if (dueOn && dueOn < issuedOn) return 'due_in_past';
  const wa = str(raw.clientWa, 30).replace(/\D/g, '');
  const inv: Invoice = {
    ...normalizeInvoice({}),
    id: `inv_${randomBytes(8).toString('hex')}`,
    token: randomBytes(18).toString('base64url'),
    number,
    client,
    clientEmail,
    clientWa: wa.startsWith('0') ? `971${wa.slice(1)}` : wa,
    clientAddress: text(raw.clientAddress, 300),
    description: summary(priced.items),
    items: priced.items,
    notes: typeof raw.notes === 'string' ? text(raw.notes, 500) : '',
    amount: priced.amount,
    feeMode: priced.onlineFee ? 'line' : priced.feeCovered ? 'included' : 'none',
    onlineFee: priced.onlineFee,
    feeCovered: priced.feeCovered,
    issuedOn,
    dueOn,
    createdAt: now,
    updatedAt: now,
    planId: str(raw.planId, 40),
  };
  doc.invoices.push(inv);
  return inv;
}

/* ------------------------------------------------------------------- plans */
const everyOf = (v: unknown): Every | null => (v === 'week' || v === 'month' || v === 'quarter' || v === 'year' ? v : null);

export function normalizePlan(raw: unknown): Plan {
  const r = isObj(raw) ? raw : {};
  const nextOn = isDay(r.nextOn) ? r.nextOn : '';
  return {
    id: String(r.id ?? ''),
    client: String(r.client ?? ''),
    clientEmail: typeof r.clientEmail === 'string' ? r.clientEmail : '',
    clientWa: typeof r.clientWa === 'string' ? r.clientWa : '',
    clientAddress: typeof r.clientAddress === 'string' ? r.clientAddress : '',
    items: Array.isArray(r.items) ? r.items.map(normalizeItem) : [],
    notes: typeof r.notes === 'string' ? r.notes : '',
    feeMode: feeMode(r.feeMode, 'none'),
    every: everyOf(r.every) ?? 'month',
    anchorDay: clamp(int(r.anchorDay, nextOn ? Number(nextOn.slice(8)) : 1), 1, 31),
    nextOn,
    endOn: isDay(r.endOn) ? r.endOn : '',
    dueDays: clamp(int(r.dueDays, 7), 0, 365),
    autoEmail: r.autoEmail === true,
    active: r.active !== false,
    createdAt: int(r.createdAt),
    updatedAt: int(r.updatedAt),
    lastRunOn: isDay(r.lastRunOn) ? r.lastRunOn : '',
    count: int(r.count),
  };
}

/** Creates a recurring plan, or updates the one with the same id. Returns the plan, or an error code. */
export function savePlan(doc: Doc, raw: unknown, now: number): Plan | string {
  if (!isObj(raw)) return 'invalid_plan';
  const client = str(raw.client, 120);
  if (!client) return 'client_required';
  const items = parseItems(raw);
  if (typeof items === 'string') return items;
  const mode = feeMode(raw.feeMode, 'none');
  const priced = priceWithFee(items, mode, doc.settings.fee);
  if (priced.amount < MIN_FILS) return 'amount_too_small';
  if (priced.amount + priced.onlineFee > MAX_FILS) return 'amount_too_large';
  const every = everyOf(raw.every);
  if (!every) return 'invalid_schedule';
  if (!isDay(raw.nextOn)) return 'invalid_date';
  const clientEmail = str(raw.clientEmail, 200).toLowerCase();
  if (clientEmail && !isEmail(clientEmail)) return 'invalid_email';
  const autoEmail = raw.autoEmail === true;
  if (autoEmail && !clientEmail) return 'email_required';
  const endOn = isDay(raw.endOn) ? raw.endOn : '';
  if (endOn && endOn < raw.nextOn) return 'invalid_date';
  const wa = str(raw.clientWa, 30).replace(/\D/g, '');
  const existing = doc.plans.find((p) => p.id === str(raw.id, 40));
  if (!existing && raw.nextOn < dubaiDay(now)) return 'date_in_past';
  if (!existing && doc.plans.length >= MAX_PLANS) return 'too_many_plans';
  const plan: Plan = {
    ...(existing ?? normalizePlan({ id: `plan_${randomBytes(8).toString('hex')}`, createdAt: now })),
    client,
    clientEmail,
    clientWa: wa.startsWith('0') ? `971${wa.slice(1)}` : wa,
    clientAddress: text(raw.clientAddress, 300),
    items,
    notes: typeof raw.notes === 'string' ? text(raw.notes, 500) : '',
    feeMode: mode,
    every,
    anchorDay: Number(raw.nextOn.slice(8)),
    nextOn: raw.nextOn,
    endOn,
    dueDays: clamp(int(Number(raw.dueDays), doc.settings.dueDays), 0, 365),
    autoEmail,
    active: raw.active !== false,
    updatedAt: now,
  };
  if (existing) Object.assign(existing, plan);
  else doc.plans.push(plan);
  return existing ?? plan;
}

/**
 * Creates this cycle's invoice for a plan and moves the plan to its next date after `today`.
 * A plan that fell behind makes one invoice, not one for every date it missed.
 */
export function invoiceFromPlan(doc: Doc, plan: Plan, today: string, now: number): Invoice | string {
  const inv = createInvoice(
    doc,
    {
      client: plan.client,
      clientEmail: plan.clientEmail,
      clientWa: plan.clientWa,
      clientAddress: plan.clientAddress,
      items: plan.items.map((i) => ({ description: fillTokens(i.description, today), qty: i.qty, rateAed: i.rate / 100 })),
      notes: plan.notes,
      feeMode: plan.feeMode,
      dueDays: plan.dueDays,
      planId: plan.id,
    },
    now,
  );
  if (typeof inv === 'string') return inv;
  plan.count += 1;
  plan.lastRunOn = today;
  plan.updatedAt = now;
  while (plan.nextOn <= today) plan.nextOn = nextDate(plan.nextOn, plan.every, plan.anchorDay);
  if (plan.endOn && plan.nextOn > plan.endOn) plan.active = false;
  return inv;
}

/** Which reminder is due for an invoice today, if any: 0 on the due day, or a number of days overdue. */
export function reminderDue(inv: Invoice, settings: Settings, today: string): number | null {
  if (!settings.reminders.enabled || inv.status !== 'unpaid' || !inv.dueOn || !isEmail(inv.clientEmail)) return null;
  const late = diffDays(inv.dueOn, today);
  const marks = [...(settings.reminders.onDue ? [0] : []), ...settings.reminders.afterDays].filter((m) => m <= late && !inv.remindedFor.includes(m));
  return marks.length ? Math.max(...marks) : null;
}
