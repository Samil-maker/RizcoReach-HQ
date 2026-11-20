// Elheen API. One function serves everything under /api/.
// Data lives in Netlify Blobs: businesses, leads, quotes, photos and sign-in sessions.
import { getStore } from '@netlify/blobs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  STATUSES, KINDS, PROJECT_KINDS, VISIT_KINDS, PHOTO_KINDS, PLANS, TRIAL_DAYS, MONTH_MS,
  json, fail, clean, cleanLine, id, slugify, money, aedText, hashPassword, checkPassword, sameSecret,
  billingOf, defaultServices, cleanItems, quoteTotals, quoteState, defaultMilestones, computeTasks,
} from '../lib/core.mjs';
import { GRAPH_VERSION, envFromProcess } from '../lib/services.mjs';

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 900_000;
const SESSION_DAYS = 30;
const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval';
const META_LOOKBACK_DAYS = 30;
const ZIINA_IPS = ['3.29.184.186', '3.29.190.95', '20.233.47.127', '13.202.161.181'];
const SIGNUPS_PER_DAY = 5;
const OWNER_SOURCES = ['instagram-dm', 'whatsapp', 'call', 'walk-in', 'referral', 'other'];

const publicBusiness = (b) => ({
  slug: b.slug, name: b.name, kind: b.kind, area: b.area, services: b.services,
  askPhotos: b.askPhotos, askAddress: b.askAddress, openHour: b.openHour, closeHour: b.closeHour, closedDays: b.closedDays,
});

export function makeHandler(store, env = {}) {
  const getJSON = (key) => store.get(key, { type: 'json' });
  const setJSON = (key, value) => store.setJSON(key, value);
  const listJSON = async (prefix) => {
    const { blobs } = await store.list({ prefix });
    return (await Promise.all(blobs.map((b) => getJSON(b.key)))).filter(Boolean);
  };

  async function auth(req) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token.length > 80) return null;
    const session = await getJSON(`sessions/${token}`);
    if (!session || Date.now() - session.at > SESSION_DAYS * 864e5) return null;
    return getJSON(`biz/${session.slug}`);
  }
  async function newSession(slug) {
    const token = id(24);
    await setJSON(`sessions/${token}`, { slug, at: Date.now() });
    return token;
  }
  const listLeads = async (slug) => (await listJSON(`leads/${slug}/`)).sort((a, b) => b.createdAt - a.createdAt);
  const listQuotes = async (slug) => (await listJSON(`quotes/${slug}/`)).sort((a, b) => b.createdAt - a.createdAt);
  async function takenTimes(slug) {
    return (await listLeads(slug)).filter((l) => l.when && !['lost', 'done'].includes(l.status)).map((l) => l.when);
  }
  async function alertOwner(biz, payload) {
    if (!env.notify || !(biz.push || []).length) return;
    try {
      const dead = await env.notify(biz.push, { url: '/app', ...payload });
      if (dead && dead.length) {
        const fresh = (await getJSON(`biz/${biz.slug}`)) || biz;
        fresh.push = (fresh.push || []).filter((p) => !dead.includes(p.endpoint));
        await setJSON(`biz/${biz.slug}`, fresh);
      }
    } catch { /* an alert failing must never lose the enquiry */ }
  }
  const note = (lead, text) => { lead.history = [...(lead.history || []), { at: Date.now(), text }].slice(-100); };

  async function saveLead(biz, body, source, opts = {}) {
    const name = cleanLine(body.name, 80);
    const phone = cleanLine(body.phone, 30).replace(/[^\d+]/g, '');
    const requirePhone = opts.requirePhone !== false;
    if (!name || (requirePhone && phone.replace(/\D/g, '').length < 7)) return fail(400, 'Please give a name and a phone number.');
    const service = biz.services.find((s) => s.id === body.serviceId);
    let when = null;
    if (body.when) {
      const t = new Date(body.when);
      if (Number.isNaN(t.getTime())) return fail(400, 'That time is not valid.');
      when = t.toISOString();
      if ((await takenTimes(biz.slug)).includes(when)) return fail(409, 'That time was just taken. Please pick another.');
    }
    const leadId = id();
    const photos = [];
    for (const [i, dataUrl] of (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_PHOTOS).entries()) {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
      if (!m) continue;
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > MAX_PHOTO_BYTES) continue;
      await store.set(`photos/${biz.slug}/${leadId}/${i}`, bytes, { metadata: { type: `image/${m[1]}` } });
      photos.push(i);
    }
    const now = opts.createdAt || Date.now();
    const lead = {
      id: leadId, name, phone, serviceId: service?.id || null, service: service?.name || cleanLine(body.service, 80) || null,
      price: service?.price ?? null, note: clean(body.note, 2000), address: cleanLine(body.address, 300),
      location: /^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/.test(body.location || '') ? body.location : null,
      budget: cleanLine(body.budget, 60), email: cleanLine(body.email, 120), adName: cleanLine(body.adName, 120), campaign: cleanLine(body.campaign, 120),
      photos, source: cleanLine(source, 30) || 'link', status: when ? 'booked' : (opts.byOwner ? 'talking' : 'new'), when, createdAt: now, lastTouch: opts.byOwner ? now : null,
      assignee: '', milestones: [], history: [{ at: now, text: opts.byOwner ? 'Added by you' : when ? 'Booked through the enquiry page' : 'Enquiry received' }],
    };
    await setJSON(`leads/${biz.slug}/${leadId}`, lead);
    if (!opts.byOwner) await alertOwner(biz, {
      title: when ? `New booking: ${name}` : `New enquiry: ${name}`,
      body: [lead.service, photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : null, lead.source !== 'link' ? `from ${lead.source}` : null].filter(Boolean).join(' · ') || 'Tap to open',
    });
    return json({ ok: true, id: leadId, when });
  }

  // --- Facebook and Instagram lead forms (works once the Meta app is set up)
  const metaReady = () => !!(env.meta?.appId && env.meta?.appSecret && env.graph);
  async function fetchLead(leadId, token) {
    try { return await env.graph(String(leadId), { params: { access_token: token, fields: 'id,created_time,field_data,ad_name,campaign_name' } }); }
    catch { return env.graph(String(leadId), { params: { access_token: token, fields: 'id,created_time,field_data' } }); }
  }
  async function importMetaLead(biz, lead) {
    const seenKey = `metalead/${cleanLine(lead.id, 40)}`;
    if (!lead.id || await getJSON(seenKey)) return false;
    const fields = Object.fromEntries((lead.field_data || []).map((f) => [String(f.name || '').toLowerCase(), (f.values || []).join(', ')]));
    const pick = (...keys) => keys.map((k) => fields[k]).find(Boolean) || '';
    const name = pick('full_name', 'name') || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || 'Facebook lead';
    const known = new Set(['full_name', 'name', 'first_name', 'last_name', 'phone_number', 'phone', 'email']);
    const text = Object.entries(fields).filter(([k, v]) => !known.has(k) && v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    const res = await saveLead(biz, { name, phone: pick('phone_number', 'phone'), email: pick('email'), note: text, adName: lead.ad_name, campaign: lead.campaign_name },
      'meta-ad', { requirePhone: false, createdAt: Date.parse(lead.created_time) || Date.now() });
    if (res.status !== 200) return false;
    await setJSON(seenKey, { slug: biz.slug, at: Date.now() });
    return true;
  }
  async function syncMeta(biz) {
    let added = 0;
    const since = Math.max(Date.now(), biz.meta.connectedAt || 0) - META_LOOKBACK_DAYS * 864e5;
    for (const page of biz.meta.pages) {
      const forms = await env.graph(`${page.id}/leadgen_forms`, { params: { access_token: page.token, fields: 'id,name', limit: 50 } });
      for (const form of forms.data || []) {
        let leads;
        try { leads = await env.graph(`${form.id}/leads`, { params: { access_token: page.token, fields: 'id,created_time,field_data,ad_name,campaign_name', limit: 50 } }); }
        catch { leads = await env.graph(`${form.id}/leads`, { params: { access_token: page.token, fields: 'id,created_time,field_data', limit: 50 } }); }
        for (const lead of leads.data || []) {
          if ((Date.parse(lead.created_time) || 0) < since) continue;
          if (await importMetaLead(biz, lead)) added++;
        }
      }
    }
    return added;
  }

  // --- Elheen's own billing, paid by card through Ziina
  async function applyPayment(pid, ziinaStatus) {
    const rec = await getJSON(`payments/${pid}`);
    if (!rec || rec.status === 'paid') return rec;
    if (ziinaStatus !== 'completed') {
      if (['failed', 'canceled'].includes(ziinaStatus)) { rec.status = 'failed'; await setJSON(`payments/${pid}`, rec); }
      return rec;
    }
    rec.status = 'paid'; rec.paidAt = Date.now();
    await setJSON(`payments/${pid}`, rec);
    const b = await getJSON(`biz/${rec.slug}`);
    if (b) {
      b.paidUntil = Math.max(Date.now(), billingOf(b).paidUntil) + rec.months * MONTH_MS;
      b.paidOnce = true;
      b.payments = [{ at: rec.paidAt, option: rec.option, amount: rec.amount, months: rec.months }, ...(b.payments || [])].slice(0, 24);
      await setJSON(`biz/${b.slug}`, b);
    }
    return rec;
  }
  async function ensureBillingWebhook() {
    const url = `${env.siteUrl}/api/billing/webhook`;
    const rec = await getJSON('platform/ziina');
    if (rec?.webhook && rec.url === url) return;
    const secret = rec?.secret || id(24);
    let webhook = false;
    try { await env.ziina(env.billing.token, 'webhook', { method: 'POST', body: { url, secret } }); webhook = true; }
    catch { /* payments are still confirmed when the owner comes back to the app */ }
    await setJSON('platform/ziina', { secret, webhook, url });
  }

  // --- quotes
  const quoteLink = (q) => `${env.siteUrl}/q/${q.publicKey}`;
  const readQuote = (q, biz) => ({ ...q, state: quoteState(q), link: quoteLink(q), totals: quoteTotals(q, !!biz.vatRegistered) });
  async function quoteFromKey(key) {
    const index = await getJSON(`quotepub/${cleanLine(key, 40)}`);
    if (!index) return {};
    const [biz, quote] = await Promise.all([getJSON(`biz/${index.slug}`), getJSON(`quotes/${index.slug}/${index.id}`)]);
    return biz && quote ? { biz, quote } : {};
  }
  async function moveLead(slug, leadId, change) {
    const key = `leads/${slug}/${leadId}`;
    const lead = await getJSON(key);
    if (!lead) return null;
    change(lead);
    await setJSON(key, lead);
    return lead;
  }

  return async function handler(req) {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const method = req.method;
    let body = {}, raw = '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      raw = await req.text();
      if (raw) { try { body = JSON.parse(raw); } catch { return fail(400, 'The request could not be read.'); } }
    }

    // --- Facebook sends the owner back here after they approve the connection
    if (parts[0] === 'meta' && parts[1] === 'callback' && method === 'GET') {
      const back = (result) => new Response(null, { status: 302, headers: { location: `/app?meta=${result}` } });
      const st = cleanLine(url.searchParams.get('state'), 40);
      const state = st ? await getJSON(`metastate/${st}`) : null;
      if (!state || Date.now() - state.at > 15 * 6e4) return back('expired');
      await store.delete(`metastate/${st}`);
      if (url.searchParams.get('error') || !url.searchParams.get('code')) return back('cancelled');
      const b = await getJSON(`biz/${state.slug}`);
      if (!b || !metaReady()) return back('error');
      try {
        const m = env.meta;
        const short = await env.graph('oauth/access_token', { params: { client_id: m.appId, client_secret: m.appSecret, redirect_uri: m.redirectUri, code: url.searchParams.get('code') } });
        const long = await env.graph('oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: m.appId, client_secret: m.appSecret, fb_exchange_token: short.access_token } });
        const accounts = await env.graph('me/accounts', { params: { access_token: long.access_token, fields: 'id,name,access_token', limit: 100 } });
        const pages = (accounts.data || []).filter((p) => p.access_token).map((p) => ({ id: String(p.id), name: cleanLine(p.name, 80), token: p.access_token }));
        if (!pages.length) return back('nopages');
        for (const p of pages) {
          try { await env.graph(`${p.id}/subscribed_apps`, { method: 'POST', params: { subscribed_fields: 'leadgen', access_token: p.token } }); p.live = true; }
          catch { p.live = false; }
          await setJSON(`metapage/${p.id}`, { slug: b.slug });
        }
        for (const old of b.meta?.pages || []) if (!pages.some((p) => p.id === old.id)) await store.delete(`metapage/${old.id}`);
        b.meta = { pages, connectedAt: Date.now(), lastSync: 0, error: null };
        await setJSON(`biz/${b.slug}`, b);
        return back('connected');
      } catch { return back('error'); }
    }

    // --- Meta tells us about each new lead-form lead
    if (parts[0] === 'meta' && parts[1] === 'webhook') {
      if (method === 'GET') {
        const ok = env.meta?.verifyToken && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.meta.verifyToken;
        return ok ? new Response(url.searchParams.get('hub.challenge') || '', { headers: { 'content-type': 'text/plain' } }) : fail(403, 'Not allowed.');
      }
      if (method === 'POST') {
        if (!metaReady()) return fail(503, 'Not set up.');
        const sig = req.headers.get('x-hub-signature-256') || '';
        const expected = `sha256=${createHmac('sha256', env.meta.appSecret).update(raw).digest('hex')}`;
        if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return fail(403, 'Bad signature.');
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field !== 'leadgen' || !change.value) continue;
            try {
              const pageId = String(change.value.page_id);
              const index = await getJSON(`metapage/${cleanLine(pageId, 40)}`);
              const b = index && await getJSON(`biz/${index.slug}`);
              const page = b?.meta?.pages?.find((p) => p.id === pageId);
              if (page) await importMetaLead(b, await fetchLead(change.value.leadgen_id, page.token));
            } catch { /* the regular check picks up anything missed here */ }
          }
        }
        return json({ ok: true });
      }
    }

    // --- sign up and sign in
    // Anyone can start a free trial. A hidden field catches bots, and one connection can make a few accounts a day.
    if (parts[0] === 'signup' && method === 'POST') {
      if (cleanLine(body.website, 200)) return fail(400, 'Please try again.');
      const name = cleanLine(body.name, 60);
      const kind = KINDS.includes(body.kind) ? body.kind : 'other';
      const password = String(body.password || '');
      const phone = cleanLine(body.phone, 30).replace(/[^\d+]/g, '');
      if (!name || password.length < 8) return fail(400, 'Give a business name and a password of at least 8 characters.');
      if (phone.replace(/\D/g, '').length < 7) return fail(400, 'Add the WhatsApp number your clients reach you on.');
      const ip = cleanLine(req.headers.get('x-nf-client-connection-ip'), 60);
      if (ip) {
        const key = `signupip/${ip}/${new Date().toISOString().slice(0, 10)}`;
        const seen = (await getJSON(key)) || { n: 0 };
        if (seen.n >= SIGNUPS_PER_DAY) return fail(429, 'Too many new accounts from this connection today. Please try again tomorrow.');
        await setJSON(key, { n: seen.n + 1 });
      }
      let slug = slugify(name) || `b-${id(4).toLowerCase()}`;
      if (await getJSON(`biz/${slug}`)) slug = `${slug}-${id(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
      const biz = {
        slug, name, kind, area: cleanLine(body.area, 60), phone,
        services: defaultServices(kind), askPhotos: PHOTO_KINDS.has(kind), askAddress: VISIT_KINDS.has(kind),
        openHour: 9, closeHour: 19, closedDays: [5], intakeKey: id(12), pass: hashPassword(password), createdAt: Date.now(),
        paidUntil: Date.now() + TRIAL_DAYS * 864e5, team: [], vatRegistered: false, trn: '',
        quoteTerms: 'Prices are valid until the date shown. Work starts once the deposit is received.', quoteValidDays: 14, quoteCounter: 0,
      };
      await setJSON(`biz/${slug}`, biz);
      return json({ token: await newSession(slug), slug });
    }
    if (parts[0] === 'login' && method === 'POST') {
      const biz = await getJSON(`biz/${slugify(body.slug)}`);
      if (!biz || !checkPassword(String(body.password || ''), biz.pass)) return fail(401, 'The business name or password is not right.');
      return json({ token: await newSession(biz.slug), slug: biz.slug });
    }

    // --- public enquiry page
    if (parts[0] === 'public' && parts[1]) {
      const biz = await getJSON(`biz/${slugify(parts[1])}`);
      if (!biz) return fail(404, 'This page does not exist.');
      if (method === 'GET' && !parts[2]) return json({ business: publicBusiness(biz), taken: await takenTimes(biz.slug) });
      if (method === 'POST' && parts[2] === 'lead') return saveLead(biz, body, body.source || url.searchParams.get('src'));
    }

    // --- a client opens, accepts or declines a quote
    if (parts[0] === 'quote' && parts[1]) {
      const { biz, quote } = await quoteFromKey(parts[1]);
      if (!quote || quote.status === 'draft') return fail(404, 'This quote does not exist.');
      const lead = await getJSON(`leads/${biz.slug}/${quote.leadId}`);
      const view = () => ({
        business: { name: biz.name, area: biz.area, phone: biz.phone, trn: biz.vatRegistered ? biz.trn : '' },
        client: lead ? lead.name : '',
        quote: {
          number: quote.number, title: quote.title, items: quote.items, notes: quote.notes, terms: quote.terms, vat: !!(biz.vatRegistered && quote.vat),
          validUntil: quote.validUntil, sentAt: quote.sentAt, state: quoteState(quote), acceptedAt: quote.acceptedAt, acceptedBy: quote.acceptedBy,
          totals: quoteTotals(quote, !!biz.vatRegistered),
        },
      });
      const save = () => setJSON(`quotes/${biz.slug}/${quote.id}`, quote);
      if (method === 'GET' && !parts[2]) {
        if (quote.status === 'sent' && !quote.viewedAt) {
          quote.viewedAt = Date.now();
          await save();
          if (lead) await moveLead(biz.slug, lead.id, (l) => note(l, `Opened quote ${quote.number}`));
          await alertOwner(biz, { title: `Quote opened: ${quote.number}`, body: `${lead?.name || 'Your client'} is looking at it now` });
        }
        return json(view());
      }
      if (method === 'POST' && parts[2] === 'accept') {
        const state = quoteState(quote);
        if (state === 'accepted') return json(view());
        if (state !== 'sent') return fail(409, state === 'expired' ? 'This quote has expired. Please ask for an updated one.' : 'This quote can no longer be accepted.');
        const by = cleanLine(body.name, 80);
        if (!by) return fail(400, 'Please type your name to accept.');
        quote.status = 'accepted'; quote.acceptedAt = Date.now(); quote.acceptedBy = by;
        await save();
        const total = quoteTotals(quote, !!biz.vatRegistered).total;
        if (lead) {
          await moveLead(biz.slug, lead.id, (l) => {
            l.status = 'won'; l.wonAt = Date.now(); l.value = total;
            if (!(l.milestones || []).length) l.milestones = defaultMilestones(biz.kind, total);
            note(l, `Accepted quote ${quote.number} (${aedText(total)}), signed by ${by}`);
          });
        }
        await alertOwner(biz, { title: `Quote accepted: ${quote.number}`, body: `${by} accepted ${aedText(total)}` });
        return json(view());
      }
      if (method === 'POST' && parts[2] === 'decline') {
        if (quoteState(quote) !== 'sent') return fail(409, 'This quote can no longer be declined.');
        quote.status = 'declined'; quote.declinedAt = Date.now(); quote.declineReason = clean(body.reason, 500);
        await save();
        if (lead) await moveLead(biz.slug, lead.id, (l) => note(l, `Declined quote ${quote.number}${quote.declineReason ? `: ${quote.declineReason}` : ''}`));
        await alertOwner(biz, { title: `Quote declined: ${quote.number}`, body: quote.declineReason || 'Tap to see it' });
        return json(view());
      }
      return fail(404, 'Not found.');
    }

    // --- Ziina tells us when a business has paid for Elheen
    if (parts[0] === 'billing' && parts[1] === 'webhook' && method === 'POST') {
      const ip = req.headers.get('x-nf-client-connection-ip');
      if (ip && !ZIINA_IPS.includes(ip)) return fail(403, 'Not allowed.');
      const rec = await getJSON('platform/ziina');
      if (!rec?.secret) return fail(404, 'Not found.');
      const sig = req.headers.get('x-hmac-signature') || '';
      const expected = createHmac('sha256', rec.secret).update(raw).digest('hex');
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return fail(403, 'Bad signature.');
      if (body.event === 'payment_intent.status.updated' && body.data?.id) {
        const index = await getJSON(`ziinapay/${cleanLine(body.data.id, 60)}`);
        if (index) await applyPayment(index.pid, body.data.status);
      }
      return json({ ok: true });
    }

    // --- the Elheen owner's admin view, protected by a separate key
    if (parts[0] === 'admin') {
      const want = env.ELHEEN_ADMIN_KEY || '';
      if (want.length < 16 || !sameSecret(req.headers.get('x-admin-key'), want)) return fail(401, 'Wrong admin key.');
      if (parts[1] === 'businesses' && method === 'GET') {
        const all = await listJSON('biz/');
        const rows = await Promise.all(all.map(async (b) => ({
          slug: b.slug, name: b.name, kind: b.kind, area: b.area, createdAt: b.createdAt, comp: !!b.comp,
          billing: billingOf(b), payments: b.payments || [], facebook: !!b.meta?.pages?.length,
          leads: (await store.list({ prefix: `leads/${b.slug}/` })).blobs.length,
          quotes: (await store.list({ prefix: `quotes/${b.slug}/` })).blobs.length,
        })));
        return json({ businesses: rows.sort((a, b) => b.createdAt - a.createdAt) });
      }
      if (parts[1] === 'business' && parts[2] && method === 'POST') {
        const b = await getJSON(`biz/${slugify(parts[2])}`);
        if (!b) return fail(404, 'That business was not found.');
        let password = null;
        if ('comp' in body) b.comp = !!body.comp;
        if (Number(body.addMonths)) {
          const months = Math.max(-12, Math.min(24, Number(body.addMonths) | 0));
          b.paidUntil = Math.max(Date.now(), billingOf(b).paidUntil) + months * MONTH_MS;
          if (months > 0) {
            b.paidOnce = true;
            b.payments = [{ at: Date.now(), amount: 0, months, manual: true }, ...(b.payments || [])].slice(0, 24);
          }
        }
        if (body.resetPassword) { password = id(6).replace(/[^a-zA-Z0-9]/g, 'x'); b.pass = hashPassword(password); }
        await setJSON(`biz/${b.slug}`, b);
        return json({ billing: billingOf(b), comp: !!b.comp, password });
      }
      return fail(404, 'Not found.');
    }

    // --- leads sent in by another system, such as an ad form
    if (parts[0] === 'intake' && parts[1] && parts[2] && method === 'POST') {
      const biz = await getJSON(`biz/${slugify(parts[1])}`);
      if (!biz || !sameSecret(parts[2], biz.intakeKey)) return fail(404, 'This link is not valid.');
      return saveLead(biz, {
        name: body.name || body.full_name, phone: body.phone || body.phone_number, email: body.email,
        service: body.service, note: body.note || body.message, address: body.address,
      }, body.source || 'ad');
    }

    // --- everything below needs the owner to be signed in
    const biz = await auth(req);
    if (!biz) return fail(401, 'Please sign in.');
    const saveBiz = () => setJSON(`biz/${biz.slug}`, biz);

    const safeBiz = () => {
      const { pass, push, meta, ...safe } = biz;
      return {
        ...safe, team: biz.team || [], alerts: (push || []).length, pushKey: env.pushKey || null, metaAvailable: metaReady(),
        project: PROJECT_KINDS.has(biz.kind), billing: { ...billingOf(biz), online: !!env.billing?.token, plans: PLANS }, payments: biz.payments || [],
        meta: meta ? { pages: meta.pages.map((p) => ({ id: p.id, name: p.name, live: !!p.live })), lastSync: meta.lastSync || 0, error: meta.error || null } : null,
      };
    };

    // Paying, signing in on another device and changing the password always work.
    if (parts[0] === 'me' && method === 'GET') return json({ business: safeBiz() });
    if (parts[0] === 'billing' && parts[1] === 'pay' && method === 'POST') {
      if (!env.billing?.token || !env.ziina) return fail(503, 'Card payment is not switched on yet. Message us on WhatsApp to pay.');
      const option = PLANS[body.option] ? body.option : 'month';
      const plan = PLANS[option];
      await ensureBillingWebhook();
      const pid = id();
      let intent;
      try {
        intent = await env.ziina(env.billing.token, 'payment_intent', { method: 'POST', body: {
          amount: plan.price * 100, currency_code: 'AED', message: `Elheen, ${plan.months === 12 ? '12 months' : '1 month'}, for ${biz.name}`,
          success_url: `${env.siteUrl}/app?billing=${pid}`, cancel_url: `${env.siteUrl}/app?billing=cancelled`, failure_url: `${env.siteUrl}/app?billing=cancelled`,
          test: !!env.billing.test,
        } });
      } catch (e) { return fail(502, `The payment page could not be opened: ${cleanLine(e.message, 120)}`); }
      await setJSON(`payments/${pid}`, { slug: biz.slug, option, months: plan.months, amount: plan.price, intentId: String(intent.id), status: 'pending', test: !!env.billing.test, createdAt: Date.now() });
      await setJSON(`ziinapay/${intent.id}`, { pid });
      return json({ url: intent.redirect_url });
    }
    if (parts[0] === 'billing' && parts[1] === 'check' && method === 'POST') {
      const pid = cleanLine(body.id, 20);
      let rec = await getJSON(`payments/${pid}`);
      if (!rec || rec.slug !== biz.slug) return fail(404, 'That payment was not found.');
      if (rec.status === 'pending' && env.billing?.token && env.ziina) {
        try { rec = await applyPayment(pid, (await env.ziina(env.billing.token, `payment_intent/${rec.intentId}`)).status); }
        catch { /* keep what we know */ }
      }
      const fresh = await getJSON(`biz/${biz.slug}`);
      return json({ status: rec.status, billing: billingOf(fresh || biz) });
    }
    if (parts[0] === 'password' && method === 'POST') {
      if (!checkPassword(String(body.current || ''), biz.pass)) return fail(403, 'Your current password is not right.');
      if (String(body.next || '').length < 8) return fail(400, 'The new password needs at least 8 characters.');
      biz.pass = hashPassword(String(body.next));
      await saveBiz();
      return json({ ok: true });
    }
    if (parts[0] === 'push' && method === 'POST') {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return fail(400, 'That device could not be registered.');
      biz.push = [...(biz.push || []).filter((p) => p.endpoint !== sub.endpoint), { endpoint: sub.endpoint.slice(0, 600), keys: { p256dh: cleanLine(sub.keys.p256dh, 200), auth: cleanLine(sub.keys.auth, 100) } }].slice(-5);
      await saveBiz();
      return json({ business: safeBiz() });
    }

    // After the grace period, the app waits for payment. The booking page keeps taking enquiries.
    if (billingOf(biz).state === 'overdue') return fail(402, 'Your Elheen plan has ended. Pay to see your leads again; nothing has been lost.', { locked: true });

    if (parts[0] === 'me' && method === 'PUT') {
      if (body.name) biz.name = cleanLine(body.name, 60);
      for (const k of ['area', 'trn']) if (k in body) biz[k] = cleanLine(body[k], 60);
      if ('phone' in body) biz.phone = cleanLine(body.phone, 30).replace(/[^\d+]/g, '');
      for (const k of ['askPhotos', 'askAddress', 'vatRegistered', 'linkShared', 'checklistHidden']) if (k in body) biz[k] = !!body[k];
      if ('quoteTerms' in body) biz.quoteTerms = clean(body.quoteTerms, 2000);
      if ('quoteValidDays' in body) biz.quoteValidDays = Math.min(180, Math.max(1, Number(body.quoteValidDays) | 0));
      if (Array.isArray(body.team)) biz.team = [...new Set(body.team.map((t) => cleanLine(t, 40)).filter(Boolean))].slice(0, 30);
      for (const k of ['openHour', 'closeHour']) if (k in body) biz[k] = Math.min(24, Math.max(0, Number(body[k]) | 0));
      if (biz.closeHour <= biz.openHour) return fail(400, 'Closing time must be after opening time.');
      if (Array.isArray(body.closedDays)) biz.closedDays = [...new Set(body.closedDays.map(Number).filter((d) => d >= 0 && d <= 6))];
      if (Array.isArray(body.services)) {
        biz.services = body.services.slice(0, 40).map((s) => ({
          id: cleanLine(s.id, 12) || id(4), name: cleanLine(s.name, 60),
          minutes: Math.min(600, Math.max(5, Number(s.minutes) | 0)), price: Math.max(0, Number(s.price) || 0),
        })).filter((s) => s.name);
        biz.servicesSaved = true;
      }
      await saveBiz();
      return json({ business: safeBiz() });
    }

    if (parts[0] === 'meta' && parts[1] === 'start' && method === 'POST') {
      if (!metaReady()) return fail(503, 'The Facebook connection is not set up yet.');
      const st = id(18);
      await setJSON(`metastate/${st}`, { slug: biz.slug, at: Date.now() });
      const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
      for (const [k, v] of Object.entries({ client_id: env.meta.appId, redirect_uri: env.meta.redirectUri, state: st, scope: META_SCOPES, response_type: 'code' })) u.searchParams.set(k, v);
      return json({ url: u.toString() });
    }
    if (parts[0] === 'meta' && parts[1] === 'sync' && method === 'POST') {
      if (!metaReady() || !biz.meta?.pages?.length) return json({ added: 0 });
      if (!body.force && Date.now() - (biz.meta.lastSync || 0) < 3 * 6e4) return json({ added: 0, skipped: true });
      biz.meta.lastSync = Date.now();
      await saveBiz();
      let added = 0;
      try { added = await syncMeta(biz); biz.meta.error = null; }
      catch (e) { biz.meta.error = cleanLine(e.message, 200) || 'Facebook did not answer.'; }
      await saveBiz();
      return json({ added, business: safeBiz() });
    }
    if (parts[0] === 'meta' && parts[1] === 'disconnect' && method === 'POST') {
      for (const p of biz.meta?.pages || []) await store.delete(`metapage/${p.id}`);
      biz.meta = null;
      await saveBiz();
      return json({ business: safeBiz() });
    }

    // --- leads
    if (parts[0] === 'leads' && !parts[1] && method === 'POST') {
      return saveLead(biz, body, OWNER_SOURCES.includes(body.source) ? body.source : 'other', { requirePhone: false, byOwner: true });
    }
    if (parts[0] === 'leads' && !parts[1] && method === 'GET') return json({ leads: await listLeads(biz.slug) });
    if (parts[0] === 'leads' && parts[1] && method === 'PATCH') {
      const key = `leads/${biz.slug}/${cleanLine(parts[1], 20)}`;
      const lead = await getJSON(key);
      if (!lead) return fail(404, 'That lead was not found.');
      if (body.status && STATUSES.includes(body.status) && body.status !== lead.status) {
        note(lead, `Moved to ${body.status}`);
        lead.status = body.status;
        lead.lastTouch = Date.now();
        if (body.status === 'won' && !lead.wonAt) lead.wonAt = Date.now();
      }
      for (const k of ['name', 'address', 'email', 'service', 'budget', 'assignee']) if (k in body) lead[k] = cleanLine(body[k], k === 'address' ? 300 : 80);
      if ('phone' in body) lead.phone = cleanLine(body.phone, 30).replace(/[^\d+]/g, '');
      if ('when' in body) {
        const t = body.when ? new Date(body.when) : null;
        if (t && Number.isNaN(t.getTime())) return fail(400, 'That time is not valid.');
        const iso = t ? t.toISOString() : null;
        if (iso && iso !== lead.when && !body.force) {
          const clash = (await listLeads(biz.slug)).find((l) => l.id !== lead.id && l.when === iso && !['lost', 'done'].includes(l.status)
            && (!lead.assignee || !l.assignee || l.assignee === lead.assignee));
          if (clash) return fail(409, `${clash.name} is already booked at that time.`, { clash: clash.name });
        }
        lead.when = iso;
        lead.remindedAt = null;
        note(lead, t ? 'Time set' : 'Time cleared');
        if (t && ['new', 'talking'].includes(lead.status)) lead.status = 'booked';
      }
      if ('ownerNote' in body) lead.ownerNote = clean(body.ownerNote, 3000);
      if ('value' in body) lead.value = Math.max(0, money(body.value));
      if (Array.isArray(body.milestones)) {
        const before = new Map((lead.milestones || []).map((m) => [m.id, m]));
        lead.milestones = body.milestones.slice(0, 12).map((m) => {
          const old = before.get(m.id);
          const paid = !!m.paid;
          if (paid && !old?.paidAt) note(lead, `Received ${cleanLine(m.label, 60) || 'a payment'} (${aedText(money(m.amount))})`);
          return { id: cleanLine(m.id, 12) || id(4), label: cleanLine(m.label, 60) || 'Payment', amount: Math.max(0, money(m.amount)), paidAt: paid ? (old?.paidAt || Date.now()) : null };
        });
      }
      await setJSON(key, lead);
      return json({ lead });
    }
    if (parts[0] === 'leads' && parts[1] && method === 'DELETE') {
      const leadId = cleanLine(parts[1], 20);
      if (!await getJSON(`leads/${biz.slug}/${leadId}`)) return fail(404, 'That lead was not found.');
      for (const q of (await listQuotes(biz.slug)).filter((x) => x.leadId === leadId)) {
        await store.delete(`quotes/${biz.slug}/${q.id}`);
        await store.delete(`quotepub/${q.publicKey}`);
      }
      for (const { key } of (await store.list({ prefix: `photos/${biz.slug}/${leadId}/` })).blobs) await store.delete(key);
      await store.delete(`leads/${biz.slug}/${leadId}`);
      return json({ ok: true });
    }
    if (parts[0] === 'photo' && parts[1] && parts[2] && method === 'GET') {
      const key = `photos/${biz.slug}/${cleanLine(parts[1], 20)}/${Number(parts[2]) | 0}`;
      const found = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!found) return fail(404, 'That photo was not found.');
      return new Response(found.data, { headers: { 'content-type': found.metadata?.type || 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
    }

    // --- quotes
    if (parts[0] === 'quotes' && !parts[1] && method === 'GET') return json({ quotes: (await listQuotes(biz.slug)).map((q) => readQuote(q, biz)) });
    // A quote already sent some other way (PDF, email, in person). Elheen starts chasing it straight away.
    if (parts[0] === 'quotes' && parts[1] === 'existing' && method === 'POST') {
      const amount = money(body.amount);
      const title = cleanLine(body.title, 120) || 'Quote';
      if (!cleanLine(body.name, 80) || !(amount > 0)) return fail(400, 'Add the client\'s name and the amount you quoted.');
      const days = Math.min(90, Math.max(0, Number(body.sentDaysAgo) | 0));
      const sentAt = Date.now() - days * 864e5;
      const made = await saveLead(biz, { name: body.name, phone: body.phone, service: title }, 'other', { requirePhone: false, byOwner: true, createdAt: sentAt });
      if (made.status !== 200) return made;
      const { id: leadId } = await made.json();
      biz.quoteCounter = (biz.quoteCounter || 0) + 1;
      await saveBiz();
      const q = {
        id: id(), publicKey: id(15), number: `Q-${String(biz.quoteCounter).padStart(4, '0')}`, leadId, title, items: [{ desc: title, qty: 1, price: amount }],
        discount: 0, vat: false, notes: '', terms: biz.quoteTerms || '', external: true,
        validUntil: Date.now() + (biz.quoteValidDays || 14) * 864e5, status: 'sent', sentAt, followUps: [], createdAt: sentAt, updatedAt: Date.now(),
      };
      await setJSON(`quotes/${biz.slug}/${q.id}`, q);
      await setJSON(`quotepub/${q.publicKey}`, { slug: biz.slug, id: q.id });
      await moveLead(biz.slug, leadId, (l) => { l.status = 'quoted'; l.value = amount; l.lastTouch = sentAt; note(l, `Quote of ${aedText(amount)} sent ${days ? `${days} day${days > 1 ? 's' : ''} ago` : 'today'}, added to Elheen to follow up`); });
      return json({ quote: readQuote(q, biz), leadId });
    }
    if (parts[0] === 'quotes' && !parts[1] && method === 'POST') {
      const lead = await getJSON(`leads/${biz.slug}/${cleanLine(body.leadId, 20)}`);
      if (!lead) return fail(404, 'That lead was not found.');
      biz.quoteCounter = (biz.quoteCounter || 0) + 1;
      await saveBiz();
      const q = {
        id: id(), publicKey: id(15), number: `Q-${String(biz.quoteCounter).padStart(4, '0')}`, leadId: lead.id,
        title: cleanLine(body.title, 120) || lead.service || 'Quote', items: cleanItems(body.items), discount: Math.max(0, money(body.discount)),
        vat: body.vat === undefined ? !!biz.vatRegistered : !!body.vat, notes: clean(body.notes, 3000), terms: clean(body.terms ?? biz.quoteTerms, 3000),
        validUntil: Date.now() + Math.min(180, Math.max(1, Number(body.validDays) || biz.quoteValidDays || 14)) * 864e5,
        status: 'draft', followUps: [], createdAt: Date.now(), updatedAt: Date.now(),
      };
      await setJSON(`quotes/${biz.slug}/${q.id}`, q);
      await setJSON(`quotepub/${q.publicKey}`, { slug: biz.slug, id: q.id });
      return json({ quote: readQuote(q, biz) });
    }
    if (parts[0] === 'quotes' && parts[1] && (method === 'PATCH' || method === 'DELETE')) {
      const key = `quotes/${biz.slug}/${cleanLine(parts[1], 20)}`;
      const q = await getJSON(key);
      if (!q) return fail(404, 'That quote was not found.');
      if (method === 'DELETE') {
        if (q.status === 'accepted') return fail(409, 'An accepted quote cannot be deleted.');
        await store.delete(key);
        await store.delete(`quotepub/${q.publicKey}`);
        return json({ ok: true });
      }
      const editing = ['title', 'items', 'discount', 'vat', 'notes', 'terms', 'validDays'].some((k) => k in body);
      if (editing && q.status === 'accepted') return fail(409, 'This quote is already accepted. Make a new quote for changes.');
      if ('title' in body) q.title = cleanLine(body.title, 120) || q.title;
      if ('items' in body) q.items = cleanItems(body.items);
      if ('discount' in body) q.discount = Math.max(0, money(body.discount));
      if ('vat' in body) q.vat = !!body.vat;
      if ('notes' in body) q.notes = clean(body.notes, 3000);
      if ('terms' in body) q.terms = clean(body.terms, 3000);
      if ('validDays' in body) q.validUntil = Date.now() + Math.min(180, Math.max(1, Number(body.validDays) | 0)) * 864e5;
      if (body.send && q.status !== 'accepted') {
        if (!q.items.length) return fail(400, 'Add at least one item before sending.');
        const fresh = q.status !== 'sent' || editing;
        if (fresh) { q.status = 'sent'; q.sentAt = Date.now(); q.followUps = []; q.viewedAt = null; q.snoozeUntil = null; }
        await moveLead(biz.slug, q.leadId, (l) => {
          if (['new', 'talking', 'booked'].includes(l.status)) l.status = 'quoted';
          l.lastTouch = Date.now();
          if (fresh) note(l, `Sent quote ${q.number} (${aedText(quoteTotals(q, !!biz.vatRegistered).total)})`);
        });
      }
      q.updatedAt = Date.now();
      await setJSON(key, q);
      return json({ quote: readQuote(q, biz) });
    }

    // --- today: everything that needs a follow-up
    if (parts[0] === 'today' && !parts[1] && method === 'GET') {
      const [leads, quotes] = await Promise.all([listLeads(biz.slug), listQuotes(biz.slug)]);
      return json({ tasks: computeTasks(biz, leads, quotes.map((q) => ({ ...q, totals: quoteTotals(q, !!biz.vatRegistered) }))), siteUrl: env.siteUrl });
    }
    if (parts[0] === 'today' && (parts[1] === 'done' || parts[1] === 'snooze') && method === 'POST') {
      const leadId = cleanLine(body.leadId, 20);
      const lead = await getJSON(`leads/${biz.slug}/${leadId}`);
      if (!lead) return fail(404, 'That lead was not found.');
      const until = Date.now() + Math.min(14, Math.max(1, Number(body.days) || 1)) * 864e5;
      if (body.type === 'quote') {
        const key = `quotes/${biz.slug}/${cleanLine(body.quoteId, 20)}`;
        const q = await getJSON(key);
        if (!q || q.leadId !== leadId) return fail(404, 'That quote was not found.');
        if (parts[1] === 'done') q.followUps = [...(q.followUps || []), { at: Date.now() }];
        else q.snoozeUntil = until;
        await setJSON(key, q);
        if (parts[1] === 'done') await moveLead(biz.slug, leadId, (l) => { l.lastTouch = Date.now(); note(l, `Followed up on quote ${q.number}`); });
        return json({ ok: true });
      }
      await moveLead(biz.slug, leadId, (l) => {
        if (parts[1] === 'snooze') { l.snoozeUntil = until; return; }
        l.lastTouch = Date.now();
        if (body.type === 'reply' && l.status === 'new') { l.status = 'talking'; note(l, 'Replied'); }
        else if (body.type === 'visit') { l.remindedAt = Date.now(); note(l, 'Confirmed the time with the client'); }
        else if (body.type === 'reply') note(l, 'Confirmed the booking');
        else if (body.type === 'toquote') { l.quoteHandled = true; note(l, 'Quote handled outside Elheen'); }
        else if (body.type === 'deposit') note(l, 'Asked for the payment');
        else note(l, 'Checked in');
      });
      return json({ ok: true });
    }

    return fail(404, 'Not found.');
  };
}

export default (req) => makeHandler(getStore({ name: 'elheen', consistency: 'strong' }), envFromProcess())(req);
export const config = { path: '/api/*' };
