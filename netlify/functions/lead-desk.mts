import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import '../../public/desk-assets/desk-core.js';

/**
 * Lead Desk API (page: public/desk.html, shared logic: public/desk-assets/desk-core.js).
 * - /api/desk/in/:token is the public intake link per client (Make.com, Zapier or a website form posts leads here).
 * - /api/desk is the private admin API for the desk page: `Authorization: Bearer <LEAD_DESK_KEY>`.
 * Everything is off (503) until LEAD_DESK_KEY (or LEAD_QUEUE_KEY) is set in Netlify's environment variables.
 * Nothing is ever sent to leads from here: the page only prepares WhatsApp messages and the owner presses Send.
 */

export type Status = 'new' | 'contacted' | 'replied' | 'booked' | 'lost' | 'noanswer' | 'fake' | 'dup';
export interface Answer {
  q: string;
  a: string;
}
export interface AdInfo {
  campaign: string;
  adset: string;
  ad: string;
  form: string;
  platform: string;
}
export interface Lead {
  id: string;
  clientId: string;
  source: string;
  extId: string;
  createdAt: number;
  submittedAt: number | null;
  name: string;
  phone: string;
  phoneType: string;
  email: string;
  answers: Answer[];
  service: string;
  ad: AdInfo;
  verified: boolean | null;
  flags: string[];
  status: Status;
  touches: { k: string; at: number }[];
  firstTouchAt: number | null;
  repliedAt: number | null;
  bookedFor: string;
  bookedAt: number | null;
  handedAt: number | null;
  outcome: 'showed' | 'noshow' | null;
  outcomeAt: number | null;
  closedAt: number | null;
  lostReason: string;
  notes: string;
  dupOf: string;
  updatedAt: number;
}
export interface Client {
  id: string;
  name: string;
  niche: string;
  contactName: string;
  contactWa: string;
  location: string;
  mapsUrl: string;
  hours: string;
  services: string;
  notes: string;
  scripts: Record<string, string>;
  intakeToken: string;
  archived: boolean;
  color: number;
  createdAt: number;
  updatedAt: number;
}
export interface Settings {
  myName: string;
  workStart: string;
  workEnd: string;
  followup1Min: number;
  followup2At: string;
  ntfyUrl: string;
  telegramToken: string;
  telegramChatId: string;
  notifyDetails: boolean;
}
interface ConfigDoc {
  rev: number;
  clients: Client[];
  settings: Settings;
  ops: string[];
}
interface LeadsDoc {
  rev: number;
  leads: Lead[];
  ops: string[];
}
interface Mapped {
  name: string;
  phone: string;
  email: string;
  answers: Answer[];
  extId: string;
  submittedAt: number | null;
  ad: AdInfo;
  verified: boolean | null;
  service: string;
  source: string;
  honeypot: boolean;
  redirect: string;
  test: boolean;
}
/** The parts of public/desk-assets/desk-core.js this function uses. */
interface DeskCoreApi {
  NICHES: Record<string, string>;
  STEPS: { id: string; label: string }[];
  STATUSES: string[];
  CLOSED: string[];
  SOURCES: string[];
  DEFAULT_SETTINGS: Settings;
  normPhone(raw: unknown): { digits: string; type: string };
  flagsFor(lead: Lead): string[];
  firstName(name: string): string;
  httpsUrl(v: string): string;
  mapIntake(input: unknown): Mapped;
  applyUpdate(lead: Lead, upd: unknown, now: number): Lead;
  uid(prefix: string): string;
}
const D = (globalThis as unknown as { DeskCore: DeskCoreApi }).DeskCore;

/** The subset of a Netlify Blobs store this function uses (lets tests pass an in-memory store). */
export interface DeskStore {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}
type Op = Record<string, unknown>;
interface OpResult {
  opId: string;
  ok: boolean;
  dup?: boolean;
  error?: string;
  data?: unknown;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MAX_INTAKE_BODY = 64 * 1024;
const MAX_ADMIN_BODY = 2 * 1024 * 1024;
const MAX_INTAKE_ITEMS = 20;
const MAX_OPS = 100;
const MAX_IMPORT_ROWS = 2000;
const KEEP_OPS = 500;
const KEEP_LEADS = 6000;
const PRUNE_AFTER = 180 * DAY;
const DUP_WINDOW = 30 * DAY;
const RATE_WINDOW = 10 * MIN;
const RATE_MAX = 60;
const MAX_NOTIFY = 3;
const SCRIPT_STEPS = ['first', 'f1', 'f2', 'nudge', 'confirm', 'reminder', 'handover'];
const CONFIG_OPS = ['client.save', 'client.rotate', 'settings.save'];
const LEAD_OPS = ['lead.update', 'lead.add', 'lead.import', 'lead.delete'];
const SIDE_OPS = ['notify.test', 'telegram.detect'];
const CORS = { 'access-control-allow-origin': '*' };

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra },
  });

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ storage */
function asConfig(data: unknown): ConfigDoc {
  const d = isObj(data) ? data : {};
  return {
    rev: typeof d.rev === 'number' ? d.rev : 0,
    clients: Array.isArray(d.clients) ? (d.clients as Client[]) : [],
    settings: { ...D.DEFAULT_SETTINGS, ...(isObj(d.settings) ? (d.settings as Partial<Settings>) : {}) },
    ops: Array.isArray(d.ops) ? (d.ops as string[]) : [],
  };
}
function asLeads(data: unknown): LeadsDoc {
  const d = isObj(data) ? data : {};
  return {
    rev: typeof d.rev === 'number' ? d.rev : 0,
    leads: Array.isArray(d.leads) ? (d.leads as Lead[]) : [],
    ops: Array.isArray(d.ops) ? (d.ops as string[]) : [],
  };
}

async function readDoc<T>(store: DeskStore, key: string, parse: (d: unknown) => T): Promise<{ doc: T; etag?: string; exists: boolean }> {
  const res = await store.getWithMetadata(key, { type: 'json' });
  return { doc: parse(res?.data), etag: res?.etag, exists: !!res };
}
const readConfig = (store: DeskStore) => readDoc(store, 'config', asConfig);
const readLeads = (store: DeskStore) => readDoc(store, 'leads', asLeads);

/**
 * Read-modify-write with optimistic concurrency (same approach as lead-queue.mts), so the page, the intake link
 * and a second device never overwrite each other. `change` returns false when nothing changed (no write).
 */
async function mutate<T extends { rev: number }>(store: DeskStore, key: string, parse: (d: unknown) => T, change: (doc: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { doc, etag, exists } = await readDoc(store, key, parse);
    if (!change(doc)) return doc;
    doc.rev += 1;
    // The local `netlify dev` Blobs server returns no ETag on reads; fall back to a plain write there.
    const res = await store.setJSON(key, doc, etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true });
    if (res.modified) return doc;
    await new Promise((r) => setTimeout(r, 40 + attempt * 60 + Math.random() * 40));
  }
  throw new HttpError(409, 'conflict');
}

/** Drop finished leads after 180 days, and keep the list under 6000 (oldest finished ones go first). */
function prune(doc: LeadsDoc, now: number) {
  const finished = (l: Lead) => D.CLOSED.includes(l.status) || (l.status === 'booked' && !!l.outcome);
  const touched = (l: Lead) => l.updatedAt || l.createdAt || 0;
  doc.leads = doc.leads.filter((l) => !(finished(l) && touched(l) < now - PRUNE_AFTER));
  if (doc.leads.length > KEEP_LEADS) {
    const order = [...doc.leads].sort((a, b) => Number(finished(b)) - Number(finished(a)) || touched(a) - touched(b));
    const drop = new Set(order.slice(0, doc.leads.length - KEEP_LEADS).map((l) => l.id));
    doc.leads = doc.leads.filter((l) => !drop.has(l.id));
  }
  if (doc.ops.length > KEEP_OPS) doc.ops = doc.ops.slice(-KEEP_OPS);
}

const mutateLeads = (store: DeskStore, now: number, change: (doc: LeadsDoc) => boolean) =>
  mutate(store, 'leads', asLeads, (doc) => {
    if (!change(doc)) return false;
    prune(doc, now);
    return true;
  });

/* -------------------------------------------------------------- lead helpers */
function newLead(m: Mapped, clientId: string, source: string, createdAt: number, now: number, taken: Set<string>): Lead {
  const p = D.normPhone(m.phone);
  let id = D.uid('l');
  while (taken.has(id)) id = D.uid('l');
  taken.add(id);
  const lead: Lead = {
    id,
    clientId,
    source,
    extId: m.extId,
    createdAt,
    submittedAt: m.submittedAt,
    name: m.name,
    phone: p.digits,
    phoneType: p.type,
    email: m.email,
    answers: m.answers.slice(0, 15),
    service: m.service,
    ad: m.ad,
    verified: m.verified,
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
    updatedAt: now,
  };
  lead.flags = D.flagsFor(lead);
  return lead;
}

/**
 * Same phone for the same client within 30 days: keep the lead but close it as a duplicate of the earlier one.
 * Test leads are left out both ways, so "Send a test lead" always lands in To do.
 */
function markIfDuplicate(lead: Lead, leads: Lead[], now: number) {
  if (!lead.phone || lead.source === 'test') return;
  const same = leads.filter(
    (l) => l.id !== lead.id && l.clientId === lead.clientId && l.phone === lead.phone && l.source !== 'test' && Math.abs(lead.createdAt - l.createdAt) <= DUP_WINDOW,
  );
  if (!same.length) return;
  const original = same.filter((l) => l.status !== 'dup').sort((a, b) => b.createdAt - a.createdAt)[0];
  lead.status = 'dup';
  lead.dupOf = original ? original.id : same[0].dupOf || same[0].id;
  lead.closedAt = now;
}

const hasContact = (m: Mapped) => !!(m.name || D.normPhone(m.phone).digits || m.email);

function leadsView(leads: Lead[], days: number, now: number) {
  const since = now - days * DAY;
  return leads.filter(
    (l) => ['new', 'contacted', 'replied'].includes(l.status) || (l.status === 'booked' && !l.outcome) || Math.max(l.updatedAt || 0, l.createdAt || 0) >= since,
  );
}

const daysParam = (url: URL) => {
  const n = Math.round(Number(url.searchParams.get('days')));
  return n > 0 ? Math.min(400, n) : 60;
};

/* ------------------------------------------------------------- notifications */
function asciiHeader(value: string) {
  const plain = value.replace(/·/g, '-');
  // ntfy reads RFC 2047 encoded words, so names in Arabic still arrive intact.
  return /^[\x20-\x7e]*$/.test(plain) ? plain : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

interface Alert {
  title: string;
  body: string;
  click: string;
}

async function sendNtfy(d: Deps, settings: Settings, a: Alert): Promise<string> {
  if (!settings.ntfyUrl.startsWith('https://')) return 'off';
  try {
    const res = await d.fetch(settings.ntfyUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8', Title: asciiHeader(a.title), ...(a.click ? { Click: a.click } : {}), Tags: 'bell', Priority: 'high' },
      body: a.body,
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? 'ok' : `error: ntfy answered ${res.status}`;
  } catch (e) {
    return `error: ${(e as Error).name === 'TimeoutError' ? 'timed out' : 'could not reach ntfy'}`;
  }
}

async function sendTelegram(d: Deps, settings: Settings, a: Alert): Promise<string> {
  if (!settings.telegramToken || !settings.telegramChatId) return 'off';
  try {
    const res = await d.fetch(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text: `${a.title}\n${a.body}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return 'ok';
    const data = (await res.json().catch(() => null)) as { description?: string } | null;
    return `error: ${str(data?.description, 120) || `Telegram answered ${res.status}`}`;
  } catch (e) {
    return `error: ${(e as Error).name === 'TimeoutError' ? 'timed out' : 'could not reach Telegram'}`;
  }
}

/** Alerts carry only the client name plus the lead's first name and service (or nothing personal when turned off). */
function leadAlert(lead: Lead, client: Client, settings: Settings, origin: string): Alert {
  const click = `${origin}/desk#lead=${lead.id}`;
  const body = settings.notifyDetails
    ? `${D.firstName(lead.name) || 'No name given'} · ${lead.service || 'no service given'}\nReply within 5 minutes: ${click}`
    : `Open Lead Desk: ${click}`;
  return { title: `New lead · ${client.name}`, body, click };
}

async function notifyAll(d: Deps, settings: Settings, alerts: Alert[]) {
  await Promise.all(alerts.slice(0, MAX_NOTIFY).flatMap((a) => [sendNtfy(d, settings, a), sendTelegram(d, settings, a)])).catch(() => {});
}

/* ------------------------------------------------------------------- intake */
async function readLimited(req: Request, max: number): Promise<ArrayBuffer> {
  if (Number(req.headers.get('content-length') || 0) > max) throw new HttpError(413, 'too_large');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(413, 'too_large');
  return buf;
}

/** Form fields as one object; a repeated field (checkboxes) keeps every value. Files are ignored. */
const collect = (pairs: Iterable<[string, unknown]>) => {
  const m = new Map<string, string>();
  for (const [k, v] of pairs) if (typeof v === 'string') m.set(k, m.has(k) ? `${m.get(k)}, ${v}` : v);
  return Object.fromEntries(m);
};

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Returns the posted items, and whether it was a browser form post (those may redirect). */
async function intakeItems(req: Request): Promise<{ items: unknown[]; wrapper: Record<string, unknown>; form: boolean }> {
  const buf = await readLimited(req, MAX_INTAKE_BODY);
  const type = (req.headers.get('content-type') || '').toLowerCase();
  const text = () => new TextDecoder().decode(buf);
  let body: unknown;
  let form = false;
  if (type.includes('multipart/form-data')) {
    const fd = await new Response(buf, { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData().catch(() => null);
    if (!fd) throw new HttpError(400, 'invalid_body');
    body = collect(fd);
    form = true;
  } else if (type.includes('application/x-www-form-urlencoded')) {
    body = collect(new URLSearchParams(text()));
    form = true;
  } else if (type.includes('application/json')) {
    body = parseJsonBody(text());
  } else {
    const t = text();
    body = parseJsonBody(t);
    if (body === undefined && /^[^=&\s]+=/.test(t.trim())) body = collect(new URLSearchParams(t.trim()));
  }
  if (Array.isArray(body)) return { items: body, wrapper: {}, form };
  if (isObj(body)) return Array.isArray(body.leads) ? { items: body.leads, wrapper: body, form } : { items: [body], wrapper: {}, form };
  throw new HttpError(400, 'invalid_body');
}

function findClient(clients: Client[], token: string): Client | null {
  const want = digest(token);
  let found: Client | null = null;
  // Compare against every client so the time taken does not depend on which one matched.
  for (const c of clients) if (typeof c.intakeToken === 'string' && timingSafeEqual(digest(c.intakeToken), want) && !found) found = c;
  return found;
}

async function intake(req: Request, store: DeskStore, secret: string | undefined, d: Deps, token: string): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
    });
  }
  const out = (data: unknown, status = 200) => json(data, status, CORS);
  if (!secret || secret.length < 24) return out({ error: 'not_configured' }, 503);
  if (req.method !== 'GET' && req.method !== 'POST') return out({ error: 'method_not_allowed' }, 405);

  const { doc: config } = await readConfig(store);
  const client = /^[\w-]{16,100}$/.test(token) ? findClient(config.clients, token) : null;
  if (!client) return out({ error: 'unknown_link' }, 404);
  if (client.archived) return out({ error: 'client_archived' }, 410);
  if (req.method === 'GET') return out({ ok: true, client: client.name, message: 'This link is working. Send leads with POST.' });

  const { items, wrapper, form } = await intakeItems(req);
  if (items.length > MAX_INTAKE_ITEMS) return out({ error: 'too_many_leads' }, 400);
  const wrapperTest = wrapper._test === true || wrapper._test === 'true';
  const now = d.now();
  const mapped = items.map((i) => (isObj(i) ? D.mapIntake(i) : null));
  const redirect = (typeof wrapper._redirect === 'string' ? D.httpsUrl(wrapper._redirect) : '') || mapped.find((m) => m?.redirect)?.redirect || '';

  let ids: string[] = [];
  let created: Lead[] = [];
  let duplicates = 0;
  let rejected = 0;
  let honeypots = 0;
  await mutateLeads(store, now, (doc) => {
    ids = [];
    created = [];
    duplicates = 0;
    rejected = 0;
    honeypots = 0;
    const taken = new Set(doc.leads.map((l) => l.id));
    const fresh: Lead[] = [];
    for (const m of mapped) {
      if (!m) {
        rejected++;
        continue;
      }
      if (m.honeypot) {
        honeypots++;
        continue;
      }
      if (!hasContact(m)) {
        rejected++;
        continue;
      }
      // Make/Zapier retry the same Meta lead: store it once.
      if (m.extId && [...doc.leads, ...fresh].some((l) => l.clientId === client.id && l.extId === m.extId)) {
        duplicates++;
        continue;
      }
      const source = m.test || wrapperTest ? 'test' : m.source;
      const lead = newLead(m, client.id, source, now, now, taken);
      markIfDuplicate(lead, [...doc.leads, ...fresh], now);
      fresh.push(lead);
    }
    if (!fresh.length) return false;
    const recent = doc.leads.filter((l) => l.clientId === client.id && l.createdAt > now - RATE_WINDOW).length;
    if (recent + fresh.length > RATE_MAX) throw new HttpError(429, 'rate_limited');
    doc.leads.push(...fresh);
    ids = fresh.map((l) => l.id);
    created = fresh;
    return true;
  });

  if (!ids.length && !duplicates && !honeypots && rejected) return out({ error: 'no_contact_details' }, 400);

  const { settings } = config;
  const origin = new URL(req.url).origin;
  await notifyAll(d, settings, created.filter((l) => l.status !== 'dup').map((l) => leadAlert(l, client, settings, origin)));

  if (form && redirect) return new Response(null, { status: 303, headers: { ...CORS, location: redirect, 'cache-control': 'no-store' } });
  return out({ ok: true, ids, duplicates, rejected });
}

/* -------------------------------------------------------------- admin ops */
const opIdOf = (op: Op) => str(op.opId, 100);

function cleanScripts(raw: unknown, current: Record<string, string>): Record<string, string> | string {
  if (raw === undefined) return current;
  if (!isObj(raw)) return 'bad_scripts';
  const out: Record<string, string> = {};
  for (const step of SCRIPT_STEPS) {
    const v = raw[step];
    if (typeof v !== 'string') continue;
    if (v.length > 2000) return 'script_too_long';
    if (v.trim()) out[step] = v.replace(/\r\n?/g, '\n');
  }
  return out;
}

const cleanMaps = (v: unknown) => {
  const s = str(v, 500);
  return s ? D.httpsUrl(s) : '';
};

function saveClient(doc: ConfigDoc, raw: unknown, now: number): Client | string {
  if (!isObj(raw)) return 'invalid_client';
  const id = str(raw.id, 40);
  const existing = id ? doc.clients.find((c) => c.id === id) : undefined;
  if (id && !existing) return 'not_found';
  const has = (k: string) => k in raw;
  const name = str(raw.name, 80);
  if ((!existing || has('name')) && !name) return 'name_required';
  if (has('niche') && !(typeof raw.niche === 'string' && Object.hasOwn(D.NICHES, raw.niche))) return 'bad_niche';
  const scripts = cleanScripts(raw.scripts, existing?.scripts || {});
  if (typeof scripts === 'string') return scripts;

  const c: Client = existing
    ? { ...existing }
    : {
        id: '',
        name: '',
        niche: 'other',
        contactName: '',
        contactWa: '',
        location: '',
        mapsUrl: '',
        hours: '',
        services: '',
        notes: '',
        scripts: {},
        intakeToken: '',
        archived: false,
        color: doc.clients.length % 8,
        createdAt: now,
        updatedAt: now,
      };
  if (!existing) {
    const taken = new Set(doc.clients.map((x) => x.id));
    do {
      c.id = 'c_' + Array.from(randomBytes(10), (b) => (b % 36).toString(36)).join('');
    } while (taken.has(c.id));
    c.intakeToken = randomBytes(24).toString('base64url');
  }
  if (name) c.name = name;
  if (has('niche')) c.niche = raw.niche as string;
  if (has('contactName')) c.contactName = str(raw.contactName, 80);
  if (has('contactWa')) c.contactWa = D.normPhone(str(raw.contactWa, 40)).digits;
  if (has('location')) c.location = str(raw.location, 200);
  if (has('mapsUrl')) c.mapsUrl = cleanMaps(raw.mapsUrl);
  if (has('hours')) c.hours = str(raw.hours, 300);
  if (has('services')) c.services = str(raw.services, 2000);
  if (has('notes')) c.notes = str(raw.notes, 2000);
  if (has('archived')) c.archived = raw.archived === true;
  c.scripts = scripts;
  c.updatedAt = now;
  if (existing) doc.clients[doc.clients.indexOf(existing)] = c;
  else doc.clients.push(c);
  return c;
}

function saveSettings(doc: ConfigDoc, raw: unknown): string | null {
  if (!isObj(raw)) return 'invalid_settings';
  const s: Settings = { ...doc.settings };
  const has = (k: string) => k in raw;
  if (has('myName')) s.myName = str(raw.myName, 60);
  for (const k of ['workStart', 'workEnd', 'followup2At'] as const) {
    if (!has(k)) continue;
    const v = str(raw[k], 5);
    if (!HHMM.test(v)) return 'bad_time';
    s[k] = v;
  }
  if (has('followup1Min')) {
    const n = Number(raw.followup1Min);
    if (!Number.isInteger(n) || n < 30 || n > 1440) return 'bad_followup';
    s.followup1Min = n;
  }
  if (has('ntfyUrl')) {
    const v = str(raw.ntfyUrl, 300);
    if (v && (!D.httpsUrl(v) || !v.startsWith('https://'))) return 'bad_ntfy_url';
    s.ntfyUrl = v;
  }
  if (has('telegramToken')) {
    const v = str(raw.telegramToken, 100);
    if (v && !/^\d{3,20}:[\w-]{20,80}$/.test(v)) return 'bad_telegram_token';
    s.telegramToken = v;
  }
  if (has('telegramChatId')) {
    const v = typeof raw.telegramChatId === 'number' ? String(raw.telegramChatId) : str(raw.telegramChatId, 40);
    if (v && !/^(-?\d{1,20}|@\w{4,32})$/.test(v)) return 'bad_telegram_chat';
    s.telegramChatId = v;
  }
  if (has('notifyDetails')) s.notifyDetails = raw.notifyDetails !== false;
  doc.settings = s;
  return null;
}

function applyConfigOp(doc: ConfigDoc, op: Op, now: number): OpResult {
  const opId = opIdOf(op);
  switch (op.type) {
    case 'client.save': {
      const r = saveClient(doc, op.client, now);
      return typeof r === 'string' ? { opId, ok: false, error: r } : { opId, ok: true, data: r };
    }
    case 'client.rotate': {
      const c = doc.clients.find((x) => x.id === op.id);
      if (!c) return { opId, ok: false, error: 'not_found' };
      c.intakeToken = randomBytes(24).toString('base64url');
      c.updatedAt = now;
      return { opId, ok: true, data: c };
    }
    case 'settings.save': {
      const err = saveSettings(doc, op.settings);
      return err ? { opId, ok: false, error: err } : { opId, ok: true, data: doc.settings };
    }
  }
  return { opId, ok: false, error: 'unknown_op' };
}

function applyLeadOp(doc: LeadsDoc, config: ConfigDoc, op: Op, now: number): OpResult {
  const opId = opIdOf(op);
  const clientExists = (id: unknown) => config.clients.some((c) => c.id === id);
  switch (op.type) {
    case 'lead.update': {
      const i = doc.leads.findIndex((l) => l.id === op.id);
      if (i < 0) return { opId, ok: false, error: 'not_found' };
      if (!isObj(op.upd)) return { opId, ok: false, error: 'invalid_update' };
      doc.leads[i] = D.applyUpdate(doc.leads[i], op.upd, now);
      return { opId, ok: true };
    }
    case 'lead.add': {
      const raw = isObj(op.lead) ? op.lead : {};
      const clientId = str(raw.clientId, 40);
      if (!clientExists(clientId)) return { opId, ok: false, error: 'unknown_client' };
      const m = D.mapIntake({
        full_name: str(raw.name, 120),
        phone_number: str(raw.phone, 40),
        email: str(raw.email, 160),
        _service: str(raw.service, 120),
      });
      if (Array.isArray(raw.answers)) {
        m.answers = raw.answers
          .filter(isObj)
          .map((a) => ({ q: str(a.q, 120), a: str(a.a, 500) }))
          .filter((a) => a.q || a.a)
          .slice(0, 15);
      }
      if (!hasContact(m)) return { opId, ok: false, error: 'no_contact_details' };
      const lead = newLead(m, clientId, 'manual', now, now, new Set(doc.leads.map((l) => l.id)));
      lead.notes = str(raw.notes, 2000);
      markIfDuplicate(lead, doc.leads, now);
      doc.leads.push(lead);
      return { opId, ok: true, data: { id: lead.id, status: lead.status, dupOf: lead.dupOf } };
    }
    case 'lead.import': {
      const clientId = str(op.clientId, 40);
      if (!clientExists(clientId)) return { opId, ok: false, error: 'unknown_client' };
      if (!Array.isArray(op.rows)) return { opId, ok: false, error: 'invalid_rows' };
      if (op.rows.length > MAX_IMPORT_ROWS) return { opId, ok: false, error: 'too_many_rows' };
      let added = 0;
      let skipped = 0;
      let dups = 0;
      const taken = new Set(doc.leads.map((l) => l.id));
      // Oldest first, so a repeat enquiry is marked as the duplicate rather than the original.
      const rows = op.rows
        .map((r) => (isObj(r) ? D.mapIntake(r) : null))
        .map((m) => ({ m, at: m?.submittedAt ?? now }))
        .sort((a, b) => a.at - b.at);
      for (const { m, at } of rows) {
        if (!m || !hasContact(m) || (m.extId && doc.leads.some((l) => l.clientId === clientId && l.extId === m.extId))) {
          skipped++;
          continue;
        }
        const lead = newLead(m, clientId, 'import', Math.min(at, now), now, taken);
        markIfDuplicate(lead, doc.leads, now);
        if (lead.status === 'dup') dups++;
        doc.leads.push(lead);
        added++;
      }
      return { opId, ok: true, data: { added, skipped, dups } };
    }
    case 'lead.delete': {
      const ids = new Set(Array.isArray(op.ids) ? op.ids.map((x) => str(x, 80)) : []);
      const before = doc.leads.length;
      doc.leads = doc.leads.filter((l) => !ids.has(l.id));
      return { opId, ok: true, data: { deleted: before - doc.leads.length } };
    }
  }
  return { opId, ok: false, error: 'unknown_op' };
}

async function telegramDetect(d: Deps, token: string): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  if (!/^\d{3,20}:[\w-]{20,80}$/.test(token)) return { ok: false, error: 'bad_token' };
  let data: { ok?: boolean; description?: string; result?: unknown[] } | null;
  try {
    const res = await d.fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(5000) });
    data = (await res.json().catch(() => null)) as typeof data;
    if (res.status === 401 || res.status === 404) return { ok: false, error: 'bad_token' };
    if (!res.ok || !data?.ok) return { ok: false, error: `error: ${str(data?.description, 120) || `Telegram answered ${res.status}`}` };
  } catch {
    return { ok: false, error: 'error: could not reach Telegram' };
  }
  const updates = Array.isArray(data.result) ? data.result : [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = isObj(updates[i]) ? (updates[i] as Record<string, unknown>) : {};
    const msg = [u.message, u.edited_message, u.my_chat_member].find(isObj);
    const chat = msg && isObj(msg.chat) ? msg.chat : null;
    if (chat && chat.type === 'private' && (typeof chat.id === 'number' || typeof chat.id === 'string')) {
      const name = [chat.first_name, chat.last_name].filter((x) => typeof x === 'string' && x).join(' ') || (typeof chat.username === 'string' ? chat.username : '');
      return { ok: true, data: { chatId: String(chat.id), name: str(name, 80) } };
    }
  }
  return { ok: false, error: 'no_messages' };
}

async function runOps(store: DeskStore, d: Deps, ops: Op[], now: number): Promise<{ results: OpResult[]; config: ConfigDoc; leads: LeadsDoc }> {
  const results: OpResult[] = ops.map((op) => ({ opId: opIdOf(op), ok: false, error: 'unknown_op' }));
  const pick = (types: string[]) => ops.map((op, i) => ({ op, i })).filter(({ op }) => types.includes(op.type as string));
  // Config changes run first so a client created in this batch can take leads in the same batch.
  const cfgOps = pick(CONFIG_OPS);
  const config = cfgOps.length
    ? await mutate(store, 'config', asConfig, (doc) => {
        let changed = false;
        for (const { op, i } of cfgOps) {
          const opId = opIdOf(op);
          if (opId && doc.ops.includes(opId)) {
            results[i] = { opId, ok: true, dup: true };
            continue;
          }
          results[i] = applyConfigOp(doc, op, now);
          if (results[i].ok) {
            changed = true;
            if (opId) doc.ops.push(opId);
          }
        }
        if (doc.ops.length > KEEP_OPS) doc.ops = doc.ops.slice(-KEEP_OPS);
        return changed;
      })
    : (await readConfig(store)).doc;

  const leadOps = pick(LEAD_OPS);
  const leads = leadOps.length
    ? await mutateLeads(store, now, (doc) => {
        let changed = false;
        for (const { op, i } of leadOps) {
          const opId = opIdOf(op);
          if (opId && doc.ops.includes(opId)) {
            results[i] = { opId, ok: true, dup: true };
            continue;
          }
          results[i] = applyLeadOp(doc, config, op, now);
          if (results[i].ok) {
            changed = true;
            if (opId) doc.ops.push(opId);
          }
        }
        return changed;
      })
    : (await readLeads(store)).doc;

  for (const { op, i } of pick(SIDE_OPS)) {
    const opId = opIdOf(op);
    if (op.type === 'notify.test') {
      const alert = { title: 'Lead Desk', body: 'Test alert from Lead Desk', click: '' };
      const [ntfy, telegram] = await Promise.all([sendNtfy(d, config.settings, alert), sendTelegram(d, config.settings, alert)]);
      results[i] = { opId, ok: true, data: { ntfy, telegram } };
    } else {
      const r = await telegramDetect(d, str(op.token, 100) || config.settings.telegramToken);
      results[i] = { opId, ...r };
    }
  }
  return { results, config, leads };
}

/* -------------------------------------------------------------------- entry */
const publicConfig = (c: ConfigDoc) => ({ clients: c.clients, settings: c.settings });

export async function handle(req: Request, store: DeskStore, secret: string | undefined, deps: Partial<Deps> = {}): Promise<Response> {
  const d: Deps = { fetch: deps.fetch || globalThis.fetch, now: deps.now || (() => Date.now()) };
  const url = new URL(req.url);
  const intakeMatch = url.pathname.match(/^\/api\/desk\/in\/([^/]*)\/?$/);
  try {
    if (intakeMatch) {
      let token = '';
      try {
        token = decodeURIComponent(intakeMatch[1]);
      } catch {
        // malformed escape: treated as an unknown link
      }
      return await intake(req, store, secret, d, token);
    }

    if (!secret || secret.length < 24) return json({ error: 'not_configured' }, 503);
    const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!key || !sameSecret(key, secret)) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const [{ doc: config }, { doc: leads }] = await Promise.all([readConfig(store), readLeads(store)]);
      const rev = `${config.rev}.${leads.rev}`;
      if (url.searchParams.get('rev') === rev) return json({ unchanged: true, rev });
      const now = d.now();
      return json({ rev, config: publicConfig(config), leads: leadsView(leads.leads, daysParam(url), now), now });
    }

    if (req.method === 'POST') {
      const text = new TextDecoder().decode(await readLimited(req, MAX_ADMIN_BODY));
      const body = parseJsonBody(text);
      if (!isObj(body) || !Array.isArray(body.ops)) return json({ error: 'invalid_body' }, 400);
      if (body.ops.length > MAX_OPS) return json({ error: 'too_many_ops' }, 400);
      const ops = body.ops.map((op) => (isObj(op) ? op : {}));
      const now = d.now();
      const { results, config, leads } = await runOps(store, d, ops, now);
      return json({ results, rev: `${config.rev}.${leads.rev}`, config: publicConfig(config), leads: leadsView(leads.leads, daysParam(url), now), now });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const error = e instanceof HttpError ? e.message : 'server_error';
    return json({ error }, status, intakeMatch ? CORS : {});
  }
}

export default async (req: Request) =>
  handle(req, getStore({ name: 'lead-desk', consistency: 'strong' }), Netlify.env.get('LEAD_DESK_KEY') || Netlify.env.get('LEAD_QUEUE_KEY'));

export const config: Config = {
  path: ['/api/desk', '/api/desk/in/:token'],
};
