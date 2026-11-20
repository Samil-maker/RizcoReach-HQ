// Elheen's shared rules: pricing, quote maths and the daily follow-up list.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const DAY = 864e5;
export const HOUR = 36e5;

// Stages a lead moves through. Shops use a shorter set in the app.
export const STATUSES = ['new', 'talking', 'booked', 'quoted', 'won', 'done', 'lost'];
export const KINDS = ['interior', 'home', 'cleaning', 'salon', 'clinic', 'fitness', 'automotive', 'other'];
export const PROJECT_KINDS = new Set(['interior', 'home', 'cleaning', 'other']);   // site visits, quotes, staged payments
export const VISIT_KINDS = new Set(['cleaning', 'home', 'interior']);              // the team goes to the client
export const PHOTO_KINDS = new Set(['home', 'interior']);                          // property photos matter

// Screening questions on the enquiry link, so time-wasters show up before a site visit, not after.
export const BUDGETS = {
  u10: ['Under AED 10,000', 0, 10000], b10: ['AED 10,000 to 50,000', 10000, 50000],
  b50: ['AED 50,000 to 150,000', 50000, 150000], o150: ['Over AED 150,000', 150000, null], unsure: ['Not sure yet', null, null],
};
export const STARTS = { now: 'As soon as possible', m3: 'Within 3 months', m6: 'In 3 to 6 months', ideas: 'Just getting ideas' };
export const PROPERTIES = { villa: 'Villa or townhouse', apartment: 'Apartment', office: 'Office or shop', other: 'Something else' };
// 'good': a real budget at or above the owner's minimum, starting soon. 'check': below the minimum, or only getting ideas.
export function fitOf(biz, l) {
  const band = BUDGETS[l.budgetBand];
  const min = Number(biz.minJob) || 0;
  const why = [];
  if (band && band[2] != null && min && band[2] <= min) why.push('budget');
  if (l.start === 'ideas') why.push('ideas');
  if (why.length) return { fit: 'check', why };
  if (band && band[1] != null && ['now', 'm3'].includes(l.start)) return { fit: 'good', why: [] };
  return null;
}

// How a business's booking page looks. Every value is checked, so a page can never break.
export const PAGE_BG = ['light', 'dark', 'tint'];
export const PAGE_RADIUS = ['round', 'soft', 'square'];
export const PAGE_FONT = ['modern', 'elegant', 'rounded'];
export const DEFAULT_PAGE = { accent: '#A31A8A', bg: 'light', radius: 'round', font: 'modern', tagline: '', about: '', instagram: '', website: '', logo: 0, cover: 0 };
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : null);
export function cleanPage(input = {}, before = DEFAULT_PAGE) {
  const p = { ...DEFAULT_PAGE, ...before };
  if ('accent' in input) p.accent = hex(input.accent) || p.accent;
  if (PAGE_BG.includes(input.bg)) p.bg = input.bg;
  if (PAGE_RADIUS.includes(input.radius)) p.radius = input.radius;
  if (PAGE_FONT.includes(input.font)) p.font = input.font;
  if ('tagline' in input) p.tagline = cleanLine(input.tagline, 90);
  if ('about' in input) p.about = clean(input.about, 400);
  if ('instagram' in input) p.instagram = cleanLine(input.instagram, 40).replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  if ('website' in input) { const w = cleanLine(input.website, 200); p.website = /^https?:\/\/[^\s]+$/i.test(w) ? w : (w && /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(w) ? `https://${w}` : ''); }
  return p;
}
// The colours a website uses most, ignoring greys, black and white.
export function paletteFromCss(text) {
  const counts = new Map();
  for (const m of String(text).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 40 || max < 40 || min > 225) continue;   // grey, near black or near white
    counts.set(`#${h.toUpperCase()}`, (counts.get(`#${h.toUpperCase()}`) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
}

// Elheen's own price, paid into the Elheen Ziina account. One plan, everything included.
export const PLANS = {
  month: { name: 'Monthly', price: 79, months: 1 },
  year: { name: 'Yearly', price: 790, months: 12 },
};
export const MONTHLY_PRICE = PLANS.month.price;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
export const MONTH_MS = 30 * DAY;
export const VAT_RATE = 0.05;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
export const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
export const cleanLine = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const id = (bytes = 9) => randomBytes(bytes).toString('base64url');
export const slugify = (name) => cleanLine(name, 60).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const aedText = (n) => { const v = money(n); return `AED ${v.toLocaleString('en', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`; };

export const hashPassword = (password, salt = randomBytes(16).toString('hex')) =>
  `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
export const checkPassword = (password, stored) => {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const sameSecret = (given, wanted) => {
  const a = Buffer.from(String(given || '')), b = Buffer.from(String(wanted || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

export const billingOf = (b, now = Date.now()) => {
  const paidUntil = b.paidUntil || (b.createdAt || now) + TRIAL_DAYS * DAY;
  const state = b.comp ? 'included' : now <= paidUntil ? (b.paidOnce ? 'active' : 'trial') : now <= paidUntil + GRACE_DAYS * DAY ? 'due' : 'overdue';
  return { price: MONTHLY_PRICE, paidUntil, state };
};

export const defaultServices = (kind) => ({
  interior: [['First consultation', 45, 0], ['Site measurement', 60, 300], ['Full design package', 60, 0]],
  home: [['Site visit and quote', 60, 0], ['Kitchen renovation', 60, 0], ['Bathroom renovation', 60, 0]],
  cleaning: [['Home cleaning', 180, 200], ['Deep cleaning', 300, 600]],
  salon: [['Haircut', 45, 120], ['Hair colour', 90, 450], ['Manicure', 45, 140]],
  clinic: [['Consultation', 30, 0], ['Treatment session', 45, 600]],
  fitness: [['Trial class', 60, 0], ['Personal training', 60, 250]],
  automotive: [['Full detailing', 180, 600], ['Interior clean', 90, 250]],
  other: [['Consultation', 30, 0]],
}[kind] || []).map(([name, minutes, price]) => ({ id: id(4), name, minutes, price }));

// Quote maths. Amounts are AED with two decimals; VAT only when the business is registered.
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 60).map((it) => ({
    desc: clean(it.desc, 300),
    qty: Math.min(100000, Math.max(0, money(it.qty))),
    unit: cleanLine(it.unit, 12),
    price: Math.min(10_000_000, Math.max(0, money(it.price))),
  })).filter((it) => it.desc && it.qty > 0);
}
// The business's own prices, so a quote takes two minutes. Kept in Elheen, so it is worth staying.
export function cleanPriceBook(list) {
  return (Array.isArray(list) ? list : []).slice(0, 300).map((it) => ({
    id: cleanLine(it.id, 12) || id(4), name: cleanLine(it.name, 120), unit: cleanLine(it.unit, 12),
    price: Math.min(10_000_000, Math.max(0, money(it.price))),
  })).filter((it) => it.name);
}
export function cleanTemplates(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((t) => ({
    id: cleanLine(t.id, 12) || id(4), name: cleanLine(t.name, 60), title: cleanLine(t.title, 120),
    items: cleanItems(t.items), notes: clean(t.notes, 3000),
  })).filter((t) => t.name && t.items.length);
}
export function quoteTotals(quote, vatRegistered) {
  const subtotal = money((quote.items || []).reduce((n, it) => n + it.qty * it.price, 0));
  const discount = Math.min(subtotal, Math.max(0, money(quote.discount)));
  const taxable = money(subtotal - discount);
  const vat = vatRegistered && quote.vat ? money(taxable * VAT_RATE) : 0;
  return { subtotal, discount, vat, total: money(taxable + vat) };
}
export const quoteState = (q, now = Date.now()) => (q.status === 'sent' && q.validUntil && q.validUntil < now ? 'expired' : q.status);

// Payments a won job is split into, by default.
export function defaultMilestones(kind, total) {
  const split = PROJECT_KINDS.has(kind) ? [['Deposit', 50], ['Progress payment', 40], ['On handover', 10]] : [['Payment', 100]];
  let left = money(total);
  return split.map(([label, pct], i) => {
    const amount = i === split.length - 1 ? left : money((total * pct) / 100);
    left = money(left - amount);
    return { id: id(4), label, amount, paidAt: null };
  });
}

// When a sent quote is chased: days after sending.
export const QUOTE_FOLLOW_DAYS = [2, 5, 10];

// Management by exception: only what has gone off track, or is about to, oldest first.
// Everything that is on track stays out of the owner's way.
export function computeTasks(biz, leads, quotes, now = Date.now()) {
  const tasks = [];
  const byLead = new Map(leads.map((l) => [l.id, l]));
  const sentFor = new Set(quotes.filter((q) => q.status !== 'draft').map((q) => q.leadId));
  const snoozed = (x) => x.snoozeUntil && x.snoozeUntil > now;
  for (const l of leads) {
    if (snoozed(l) || l.status === 'lost') continue;
    const touched = l.lastTouch || l.createdAt;
    if (l.status === 'new') {
      tasks.push({ type: 'reply', leadId: l.id, dueAt: l.createdAt, fit: fitOf(biz, l)?.fit || null, title: `Reply to ${l.name}`, detail: l.service || 'New enquiry' });
    } else if (l.status === 'talking' && now - touched >= 3 * DAY) {
      tasks.push({ type: 'checkin', leadId: l.id, dueAt: touched + 3 * DAY, title: `Check in with ${l.name}`, detail: 'No contact for 3 days' });
    }
    const t = l.when ? Date.parse(l.when) : 0;
    const soon = t > now && t - now <= 26 * HOUR;
    if (l.when && ['booked', 'quoted', 'won'].includes(l.status) && !l.remindedAt && soon) {
      tasks.push({ type: 'visit', leadId: l.id, dueAt: t - 24 * HOUR, when: l.when, title: `Confirm tomorrow with ${l.name}`, detail: l.service || 'Booked' });
    } else if (l.status === 'booked' && !l.lastTouch && t > now) {
      // booked through the enquiry link and nobody has said hello yet
      tasks.push({ type: 'reply', leadId: l.id, dueAt: l.createdAt, when: l.when, title: `Confirm the booking with ${l.name}`, detail: l.service || 'Booked through your link' });
    }
    // the site visit happened, but no quote has gone out
    if (PROJECT_KINDS.has(biz.kind) && l.status === 'booked' && t && t < now - 2 * HOUR && !sentFor.has(l.id) && !l.quoteHandled) {
      tasks.push({ type: 'toquote', leadId: l.id, dueAt: t + 2 * HOUR, when: l.when, title: `Send ${l.name} their quote`, detail: l.service || 'After the site visit' });
    }
    // a client wrote again on Instagram, Facebook or WhatsApp
    if (l.unread && l.status !== 'new' && l.lastInboundAt) {
      const last = (l.messages || []).filter((m) => m.from === 'them').slice(-1)[0];
      tasks.push({ type: 'message', leadId: l.id, dueAt: l.lastInboundAt, title: `New message from ${l.name}`, detail: last ? last.text.slice(0, 120) : 'Tap to read it' });
    }
    // a finished job is the best moment to ask for a review
    if (l.status === 'done' && biz.reviewLink && !l.reviewAsked) {
      tasks.push({ type: 'review', leadId: l.id, dueAt: touched, title: `Ask ${l.name} for a review`, detail: l.service || 'Job finished' });
    }
    // money owed: the deposit once a job is won, and anything left once it is finished
    const unpaid = (l.milestones || []).find((m) => !m.paidAt);
    if (l.status === 'won' && unpaid && unpaid === l.milestones[0] && l.wonAt && now - Math.max(l.wonAt, touched) >= 2 * DAY) {
      tasks.push({ type: 'deposit', leadId: l.id, dueAt: Math.max(l.wonAt, touched) + 2 * DAY, amount: unpaid.amount, label: unpaid.label, title: `Collect the ${unpaid.label.toLowerCase()} from ${l.name}`, detail: aedText(unpaid.amount) });
    } else if (l.status === 'done' && unpaid && now - touched >= 2 * DAY) {
      const owed = money(l.milestones.filter((m) => !m.paidAt).reduce((n, m) => n + m.amount, 0));
      tasks.push({ type: 'deposit', final: true, leadId: l.id, dueAt: touched + 2 * DAY, amount: owed, label: unpaid.label, title: `Collect what ${l.name} still owes`, detail: `Job finished · ${aedText(owed)} unpaid` });
    }
  }
  for (const q of quotes) {
    if (q.status !== 'sent' || snoozed(q) || !q.sentAt) continue;
    const l = byLead.get(q.leadId);
    // extra work on a won job is chased too: it must be approved before the work starts
    if (!l || l.status === 'lost' || (['won', 'done'].includes(l.status) && !q.variation)) continue;
    const step = (q.followUps || []).length;
    if (step >= QUOTE_FOLLOW_DAYS.length) continue;
    // opened but no answer after a day is the best moment to call, so the first chase comes early
    const dueAt = step === 0 && q.viewedAt ? Math.min(q.sentAt + QUOTE_FOLLOW_DAYS[0] * DAY, q.viewedAt + DAY) : q.sentAt + QUOTE_FOLLOW_DAYS[step] * DAY;
    if (now < dueAt) continue;
    const days = Math.floor((now - q.sentAt) / DAY);
    tasks.push({
      type: 'quote', leadId: l.id, quoteId: q.id, dueAt, step: step + 1, number: q.number, total: q.totals.total, publicKey: q.publicKey, viewed: !!q.viewedAt, external: !!q.external, variation: !!q.variation, title2: q.title,
      title: `Follow up ${q.number} with ${l.name}`, detail: `${aedText(q.totals.total)} · sent ${days} day${days === 1 ? '' : 's'} ago${q.viewedAt ? ' · opened' : q.external ? '' : ' · not opened yet'}`,
    });
  }
  return tasks.sort((a, b) => a.dueAt - b.dueAt);
}
