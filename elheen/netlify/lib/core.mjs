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
    price: Math.min(10_000_000, Math.max(0, money(it.price))),
  })).filter((it) => it.desc && it.qty > 0);
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

// Everything that needs the owner's attention today, oldest first.
export function computeTasks(biz, leads, quotes, now = Date.now()) {
  const tasks = [];
  const byLead = new Map(leads.map((l) => [l.id, l]));
  const snoozed = (x) => x.snoozeUntil && x.snoozeUntil > now;
  for (const l of leads) {
    if (snoozed(l) || l.status === 'lost') continue;
    const touched = l.lastTouch || l.createdAt;
    if (l.status === 'new') {
      tasks.push({ type: 'reply', leadId: l.id, dueAt: l.createdAt, title: `Reply to ${l.name}`, detail: l.service || 'New enquiry' });
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
    const unpaid = (l.milestones || []).find((m) => !m.paidAt);
    if (l.status === 'won' && unpaid && unpaid === l.milestones[0] && l.wonAt && now - Math.max(l.wonAt, touched) >= 2 * DAY) {
      tasks.push({ type: 'deposit', leadId: l.id, dueAt: Math.max(l.wonAt, touched) + 2 * DAY, amount: unpaid.amount, label: unpaid.label, title: `Collect the ${unpaid.label.toLowerCase()} from ${l.name}`, detail: aedText(unpaid.amount) });
    }
  }
  for (const q of quotes) {
    if (q.status !== 'sent' || snoozed(q) || !q.sentAt) continue;
    const l = byLead.get(q.leadId);
    if (!l || l.status === 'lost' || l.status === 'won') continue;
    const step = (q.followUps || []).length;
    if (step >= QUOTE_FOLLOW_DAYS.length) continue;
    const dueAt = q.sentAt + QUOTE_FOLLOW_DAYS[step] * DAY;
    if (now < dueAt) continue;
    const days = Math.floor((now - q.sentAt) / DAY);
    tasks.push({
      type: 'quote', leadId: l.id, quoteId: q.id, dueAt, step: step + 1, number: q.number, total: q.totals.total, publicKey: q.publicKey, viewed: !!q.viewedAt,
      title: `Follow up ${q.number} with ${l.name}`, detail: `${aedText(q.totals.total)} · sent ${days} day${days === 1 ? '' : 's'} ago${q.viewedAt ? ' · opened' : ' · not opened yet'}`,
    });
  }
  return tasks.sort((a, b) => a.dueAt - b.dueAt);
}
