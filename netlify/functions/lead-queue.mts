import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Phone queue for the Lead Hunter Chrome extension (lead-hunter/).
 * The extension pushes leads with a ready-made WhatsApp message; the phone page
 * (public/outreach.html) lists them and opens WhatsApp with one tap, then reports
 * "sent" back so the extension can mark the lead as contacted.
 *
 * Private to the site owner: every request needs `Authorization: Bearer <LEAD_QUEUE_KEY>`.
 * Disabled (503) until LEAD_QUEUE_KEY is set in Netlify's environment variables.
 */

export type Status = 'queued' | 'sent' | 'removed';
export interface Item {
  id: string;
  name: string;
  wa: string;
  message: string;
  domain: string;
  issue: string;
  heat: string;
  priority: number;
  pageUrl: string;
  addedAt: number;
  status: Status;
  statusAt: number;
}
interface Queue {
  items: Item[];
  updatedAt: number;
}
/** The subset of a Netlify Blobs store this function uses (lets tests pass an in-memory store). */
export interface QueueStore {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}

const KEY = 'queue';
const MAX_ITEMS = 400;
const MAX_BODY = 1_500_000;
const STATUSES: Status[] = ['queued', 'sent', 'removed'];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function cleanItem(raw: unknown, now: number): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const wa = str(r.wa, 20).replace(/\D/g, '');
  // Cutting at 4000 can split an emoji; drop the dangling half so links never break.
  const message = str(r.message, 4000).replace(/[\uD800-\uDBFF]$/, '').toWellFormed();
  if (!/^[\w:.-]{1,80}$/.test(id) || !/^\d{8,15}$/.test(wa) || !message) return null;
  const pageUrl = str(r.pageUrl, 300);
  return {
    id,
    name: str(r.name, 200) || 'Unknown business',
    wa,
    message,
    domain: str(r.domain, 200),
    issue: str(r.issue, 300),
    heat: ['hot', 'warm', 'cold'].includes(r.heat as string) ? (r.heat as string) : 'cold',
    priority: Math.max(0, Math.min(100, Math.round(num(r.priority)))),
    pageUrl: /^https:\/\/([\w-]+\.)*facebook\.com\//.test(pageUrl) ? pageUrl : '',
    addedAt: now,
    status: 'queued',
    statusAt: now,
  };
}

async function readQueue(store: QueueStore): Promise<{ queue: Queue; etag?: string; exists: boolean }> {
  const res = await store.getWithMetadata(KEY, { type: 'json' });
  const data = res?.data as Queue | undefined;
  return { queue: data && Array.isArray(data.items) ? data : { items: [], updatedAt: 0 }, etag: res?.etag, exists: !!res };
}

/** Read-modify-write with optimistic concurrency, so the phone and the extension never overwrite each other. */
async function mutate(store: QueueStore, change: (q: Queue) => void): Promise<Queue> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { queue, etag, exists } = await readQueue(store);
    change(queue);
    queue.updatedAt = Date.now();
    // The local `netlify dev` Blobs server returns no ETag on reads; fall back to a plain write there.
    const res = await store.setJSON(KEY, queue, etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true });
    if (res.modified) return queue;
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

export async function handle(req: Request, store: QueueStore, secret: string | undefined): Promise<Response> {
  if (!secret || secret.length < 24) return json({ error: 'not_configured' }, 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !sameSecret(token, secret)) return json({ error: 'unauthorized' }, 401);

  try {
    if (req.method === 'GET') return json((await readQueue(store)).queue);

    const b = await body(req);
    if (!b) return json({ error: 'invalid_body' }, 400);
    const now = Date.now();

    // Extension: add or re-queue leads (a re-push replaces the message and puts it back in "to send").
    if (req.method === 'PUT') {
      if (!Array.isArray(b.items)) return json({ error: 'invalid_body' }, 400);
      const incoming = b.items.map((i) => cleanItem(i, now)).filter((i): i is Item => !!i);
      const queue = await mutate(store, (q) => {
        for (const item of incoming) {
          const at = q.items.findIndex((x) => x.id === item.id);
          if (at > -1) q.items.splice(at, 1);
          q.items.push(item);
        }
        // Keep the newest items; drop the oldest finished ones first.
        if (q.items.length > MAX_ITEMS) {
          const done = q.items.filter((x) => x.status !== 'queued').sort((x, y) => x.statusAt - y.statusAt);
          const drop = new Set(done.slice(0, q.items.length - MAX_ITEMS).map((x) => x.id));
          q.items = q.items.filter((x) => !drop.has(x.id)).slice(-MAX_ITEMS);
        }
      });
      return json({ ...queue, accepted: incoming.length, rejected: b.items.length - incoming.length });
    }

    // Phone: mark items sent / removed / back to queued.
    if (req.method === 'POST') {
      if (!Array.isArray(b.updates)) return json({ error: 'invalid_body' }, 400);
      const updates = b.updates
        .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
        .map((u) => ({ id: str(u.id, 80), status: u.status as Status, rev: num(u.rev) }))
        .filter((u) => u.id && STATUSES.includes(u.status))
        .slice(0, MAX_ITEMS);
      const queue = await mutate(store, (q) => {
        for (const u of updates) {
          const item = q.items.find((x) => x.id === u.id);
          // `rev` is the addedAt the phone saw: ignore taps on an older copy of a lead that has since been re-pushed.
          if (item && (!u.rev || u.rev === item.addedAt)) {
            item.status = u.status;
            item.statusAt = now;
          }
        }
      });
      return json(queue);
    }

    // Either side: clear finished items, or delete specific ones.
    if (req.method === 'DELETE') {
      const ids = new Set(Array.isArray(b.ids) ? b.ids.map((x) => str(x, 80)) : []);
      const queue = await mutate(store, (q) => {
        q.items = q.items.filter((x) => !ids.has(x.id) && !(b.finished === true && x.status !== 'queued'));
      });
      return json(queue);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return json({ error: (e as Error).message === 'conflict' ? 'conflict' : 'server_error' }, (e as Error).message === 'conflict' ? 409 : 500);
  }
}

export default async (req: Request) => handle(req, getStore({ name: 'lead-queue', consistency: 'strong' }), Netlify.env.get('LEAD_QUEUE_KEY'));

export const config: Config = {
  path: '/api/lead-queue',
};
