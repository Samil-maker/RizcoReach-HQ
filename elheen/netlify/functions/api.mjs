// Elheen API. One function serves everything under /api/.
// Data lives in Netlify Blobs: businesses, leads, photos and sign-in sessions.
import { getStore } from '@netlify/blobs';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const STATUSES = ['new', 'talking', 'booked', 'done', 'lost'];
const KINDS = ['salon', 'clinic', 'fitness', 'automotive', 'cleaning', 'home', 'interior', 'other'];
const VISIT_KINDS = new Set(['cleaning', 'home', 'interior']);   // the team goes to the client
const PHOTO_KINDS = new Set(['home', 'interior']);               // property photos matter
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 900_000;
const SESSION_DAYS = 30;
const GRAPH_VERSION = 'v26.0';
const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval';
const META_LOOKBACK_DAYS = 30;   // on first connect, bring in lead-form leads from the last month

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const id = (bytes = 9) => randomBytes(bytes).toString('base64url');
const slugify = (name) => clean(name, 60).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const hashPassword = (password, salt = randomBytes(16).toString('hex')) =>
  `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const checkPassword = (password, stored) => {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
};

const defaultServices = (kind) => ({
  salon: [['Haircut', 45, 120], ['Hair colour', 90, 450], ['Manicure', 45, 140]],
  clinic: [['Consultation', 30, 0], ['Treatment session', 45, 600]],
  fitness: [['Trial class', 60, 0], ['Personal training', 60, 250]],
  automotive: [['Full detailing', 180, 600], ['Interior clean', 90, 250]],
  cleaning: [['Home cleaning', 180, 200], ['Deep cleaning', 300, 600]],
  home: [['Site visit and quote', 60, 0], ['AC service', 60, 180]],
  interior: [['First consultation', 45, 0], ['Site measurement', 60, 300]],
  other: [['Consultation', 30, 0]],
}[kind] || []).map(([name, minutes, price]) => ({ id: id(4), name, minutes, price }));

const publicBusiness = (b) => ({
  slug: b.slug, name: b.name, kind: b.kind, area: b.area, services: b.services,
  askPhotos: b.askPhotos, askAddress: b.askAddress, openHour: b.openHour, closeHour: b.closeHour, closedDays: b.closedDays,
});

const MAX_CHAT_TURNS = 12;
const assistantBrief = (b) => `You are the front desk for ${b.name}${b.area ? `, in ${b.area}` : ''}, a ${b.kind} business in the UAE. You reply to people enquiring on its booking page.

Services and prices:
${b.services.map((s) => `- ${s.name}: ${s.minutes} minutes, ${s.price ? `AED ${s.price}` : 'free'}`).join('\n')}
Open ${b.openHour}:00 to ${b.closeHour}:00.
${b.aiNotes ? `Notes from the owner:\n${b.aiNotes}\n` : ''}
How to reply:
- Write like a friendly person on WhatsApp: one to three short sentences, plain words, no lists, no emoji.
- Reply in the language the person writes in (Arabic or English).
- Answer only from the facts above. If you do not know, say the team will confirm, and never invent a price, a time or a promise.
- Find out what they need${b.askPhotos ? ', and ask them to add photos of the space in the form' : ''}.
- When they are ready, tell them to fill in their name and number below and pick a time, then press Send enquiry.
- Never say you are an AI unless asked directly; if asked, say you are the assistant for ${b.name}.`;

export function makeHandler(store, env = {}) {
  const getJSON = (key) => store.get(key, { type: 'json' });
  const setJSON = (key, value) => store.setJSON(key, value);

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
  async function listLeads(slug) {
    const { blobs } = await store.list({ prefix: `leads/${slug}/` });
    const leads = (await Promise.all(blobs.map((b) => getJSON(b.key)))).filter(Boolean);
    return leads.sort((a, b) => b.createdAt - a.createdAt);
  }
  async function takenTimes(slug) {
    return (await listLeads(slug)).filter((l) => l.when && l.status !== 'lost').map((l) => l.when);
  }

  async function saveLead(biz, body, source, opts = {}) {
    const name = clean(body.name, 80);
    const phone = clean(body.phone, 30).replace(/[^\d+]/g, '');
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
    const lead = {
      id: leadId, name, phone, serviceId: service?.id || null, service: service?.name || clean(body.service, 80) || null,
      price: service?.price ?? null, note: clean(body.note, 1000), address: clean(body.address, 300),
      location: /^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/.test(body.location || '') ? body.location : null,
      chat: (Array.isArray(body.chat) ? body.chat : []).slice(-2 * MAX_CHAT_TURNS)
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clean(m.content, 600) })).filter((m) => m.content),
      email: clean(body.email, 120), adName: clean(body.adName, 120), campaign: clean(body.campaign, 120),
      photos, source: clean(source, 30) || 'link', status: when ? 'booked' : 'new', when, createdAt: opts.createdAt || Date.now(),
      history: [{ at: Date.now(), text: when ? 'Booked through the enquiry page' : 'Enquiry received' }],
    };
    await setJSON(`leads/${biz.slug}/${leadId}`, lead);
    if (env.notify && (biz.push || []).length) {
      try {
        const dead = await env.notify(biz.push, {
          title: when ? `New booking: ${name}` : `New enquiry: ${name}`,
          body: [lead.service, lead.source !== 'link' ? `from ${lead.source}` : null].filter(Boolean).join(' · ') || 'Tap to open',
          url: '/app',
        });
        if (dead && dead.length) { biz.push = biz.push.filter((p) => !dead.includes(p.endpoint)); await setJSON(`biz/${biz.slug}`, biz); }
      } catch { /* an alert failing must never lose the enquiry */ }
    }
    return json({ ok: true, id: leadId, when });
  }

  // --- Facebook and Instagram lead forms
  const metaReady = () => !!(env.meta?.appId && env.meta?.appSecret && env.graph);
  async function fetchLead(leadId, token) {
    try { return await env.graph(String(leadId), { params: { access_token: token, fields: 'id,created_time,field_data,ad_name,campaign_name' } }); }
    catch { return env.graph(String(leadId), { params: { access_token: token, fields: 'id,created_time,field_data' } }); }
  }
  async function importMetaLead(biz, lead) {
    const seenKey = `metalead/${clean(lead.id, 40)}`;
    if (!lead.id || await getJSON(seenKey)) return false;
    const fields = Object.fromEntries((lead.field_data || []).map((f) => [String(f.name || '').toLowerCase(), (f.values || []).join(', ')]));
    const pick = (...keys) => keys.map((k) => fields[k]).find(Boolean) || '';
    const name = pick('full_name', 'name') || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || 'Facebook lead';
    const known = new Set(['full_name', 'name', 'first_name', 'last_name', 'phone_number', 'phone', 'email']);
    const note = Object.entries(fields).filter(([k, v]) => !known.has(k) && v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    const res = await saveLead(biz, { name, phone: pick('phone_number', 'phone'), email: pick('email'), note, adName: lead.ad_name, campaign: lead.campaign_name },
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
      const st = clean(url.searchParams.get('state'), 40);
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
        const pages = (accounts.data || []).filter((p) => p.access_token).map((p) => ({ id: String(p.id), name: clean(p.name, 80), token: p.access_token }));
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
              const index = await getJSON(`metapage/${clean(pageId, 40)}`);
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
    if (parts[0] === 'signup' && method === 'POST') {
      if (!env.ELHEEN_INVITE) return fail(503, 'Sign-up is not open yet.');
      if (clean(body.invite, 80) !== env.ELHEEN_INVITE) return fail(403, 'That invite code is not right.');
      const name = clean(body.name, 60);
      const kind = KINDS.includes(body.kind) ? body.kind : 'other';
      const password = String(body.password || '');
      if (!name || password.length < 8) return fail(400, 'Give a business name and a password of at least 8 characters.');
      let slug = slugify(name) || `b-${id(4).toLowerCase()}`;
      if (await getJSON(`biz/${slug}`)) slug = `${slug}-${id(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
      const biz = {
        slug, name, kind, area: clean(body.area, 60), phone: clean(body.phone, 30).replace(/[^\d+]/g, ''),
        services: defaultServices(kind), askPhotos: PHOTO_KINDS.has(kind), askAddress: VISIT_KINDS.has(kind),
        openHour: 9, closeHour: 19, closedDays: [], intakeKey: id(12), pass: hashPassword(password), createdAt: Date.now(),
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
      if (method === 'GET' && !parts[2]) return json({ business: publicBusiness(biz), taken: await takenTimes(biz.slug), chat: !!(env.ask && biz.aiOn) });
      if (method === 'POST' && parts[2] === 'chat') {
        if (!env.ask || !biz.aiOn) return fail(404, 'Chat is not available.');
        const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-2 * MAX_CHAT_TURNS)
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clean(m.content, 600) })).filter((m) => m.content);
        if (!messages.length || messages[messages.length - 1].role !== 'user') return fail(400, 'Say something first.');
        if (messages.filter((m) => m.role === 'user').length > MAX_CHAT_TURNS) return json({ reply: 'Thanks. Please fill in your details below and the team will take it from here.' });
        try { return json({ reply: await env.ask(assistantBrief(biz), messages) }); }
        catch (e) { console.error('assistant failed:', e.message); return fail(502, 'The assistant is not available right now. Please send your enquiry below.'); }
      }
      if (method === 'POST' && parts[2] === 'lead') return saveLead(biz, body, body.source || url.searchParams.get('src'));
    }

    // --- leads sent in by another system, such as an ad form
    if (parts[0] === 'intake' && parts[1] && parts[2] && method === 'POST') {
      const biz = await getJSON(`biz/${slugify(parts[1])}`);
      if (!biz || parts[2] !== biz.intakeKey) return fail(404, 'This link is not valid.');
      return saveLead(biz, {
        name: body.name || body.full_name, phone: body.phone || body.phone_number,
        service: body.service, note: body.note || body.message, address: body.address,
      }, body.source || 'ad');
    }

    // --- everything below needs the owner to be signed in
    const biz = await auth(req);
    if (!biz) return fail(401, 'Please sign in.');

    const safeBiz = () => {
      const { pass, push, meta, ...safe } = biz;
      return {
        ...safe, alerts: (push || []).length, aiAvailable: !!env.ask, pushKey: env.pushKey || null, metaAvailable: metaReady(),
        meta: meta ? { pages: meta.pages.map((p) => ({ id: p.id, name: p.name, live: !!p.live })), lastSync: meta.lastSync || 0, error: meta.error || null } : null,
      };
    };
    if (parts[0] === 'ai-check' && method === 'GET') {
      if (!env.ask) return json({ ok: false, reason: 'No AI key is set.' });
      try { await env.ask('Reply with the single word: ready', [{ role: 'user', content: 'Are you there?' }]); return json({ ok: true }); }
      catch (e) { return json({ ok: false, reason: clean(e.message, 300) }); }
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
      await setJSON(`biz/${biz.slug}`, biz);
      let added = 0;
      try { added = await syncMeta(biz); biz.meta.error = null; }
      catch (e) { biz.meta.error = clean(e.message, 200) || 'Facebook did not answer.'; }
      await setJSON(`biz/${biz.slug}`, biz);
      return json({ added, business: safeBiz() });
    }
    if (parts[0] === 'meta' && parts[1] === 'disconnect' && method === 'POST') {
      for (const p of biz.meta?.pages || []) await store.delete(`metapage/${p.id}`);
      biz.meta = null;
      await setJSON(`biz/${biz.slug}`, biz);
      return json({ business: safeBiz() });
    }
    if (parts[0] === 'me' && method === 'GET') return json({ business: safeBiz() });
    if (parts[0] === 'password' && method === 'POST') {
      if (!checkPassword(String(body.current || ''), biz.pass)) return fail(403, 'Your current password is not right.');
      if (String(body.next || '').length < 8) return fail(400, 'The new password needs at least 8 characters.');
      biz.pass = hashPassword(String(body.next));
      await setJSON(`biz/${biz.slug}`, biz);
      return json({ ok: true });
    }
    if (parts[0] === 'push' && method === 'POST') {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return fail(400, 'That device could not be registered.');
      biz.push = [...(biz.push || []).filter((p) => p.endpoint !== sub.endpoint), { endpoint: sub.endpoint.slice(0, 600), keys: { p256dh: clean(sub.keys.p256dh, 200), auth: clean(sub.keys.auth, 100) } }].slice(-5);
      await setJSON(`biz/${biz.slug}`, biz);
      return json({ business: safeBiz() });
    }
    if (parts[0] === 'me' && method === 'PUT') {
      if (body.name) biz.name = clean(body.name, 60);
      if ('area' in body) biz.area = clean(body.area, 60);
      if ('phone' in body) biz.phone = clean(body.phone, 30).replace(/[^\d+]/g, '');
      if ('askPhotos' in body) biz.askPhotos = !!body.askPhotos;
      if ('askAddress' in body) biz.askAddress = !!body.askAddress;
      if ('aiOn' in body) biz.aiOn = !!body.aiOn;
      if ('aiNotes' in body) biz.aiNotes = clean(body.aiNotes, 1500);
      for (const k of ['openHour', 'closeHour']) {
        if (k in body) biz[k] = Math.min(24, Math.max(0, Number(body[k]) | 0));
      }
      if (biz.closeHour <= biz.openHour) return fail(400, 'Closing time must be after opening time.');
      if (Array.isArray(body.closedDays)) biz.closedDays = body.closedDays.map(Number).filter((d) => d >= 0 && d <= 6);
      if (Array.isArray(body.services)) {
        biz.services = body.services.slice(0, 30).map((s) => ({
          id: clean(s.id, 12) || id(4), name: clean(s.name, 60),
          minutes: Math.min(600, Math.max(5, Number(s.minutes) | 0)), price: Math.max(0, Number(s.price) || 0),
        })).filter((s) => s.name);
      }
      await setJSON(`biz/${biz.slug}`, biz);
      return json({ business: safeBiz() });
    }
    if (parts[0] === 'leads' && method === 'POST' && !parts[1]) {
      const src = ['instagram-dm', 'whatsapp', 'call', 'walk-in', 'referral', 'other'].includes(body.source) ? body.source : 'other';
      return saveLead(biz, body, src);
    }
    if (parts[0] === 'leads' && method === 'GET' && !parts[1]) return json({ leads: await listLeads(biz.slug) });
    if (parts[0] === 'leads' && parts[1] && method === 'PATCH') {
      const key = `leads/${biz.slug}/${clean(parts[1], 20)}`;
      const lead = await getJSON(key);
      if (!lead) return fail(404, 'That enquiry was not found.');
      if (body.status && STATUSES.includes(body.status) && body.status !== lead.status) {
        lead.history.push({ at: Date.now(), text: `Moved to ${body.status}` });
        lead.status = body.status;
      }
      if ('when' in body) {
        const t = body.when ? new Date(body.when) : null;
        if (t && Number.isNaN(t.getTime())) return fail(400, 'That time is not valid.');
        lead.when = t ? t.toISOString() : null;
        lead.history.push({ at: Date.now(), text: t ? 'Time set' : 'Time cleared' });
        if (t && lead.status === 'new') lead.status = 'booked';
      }
      if ('ownerNote' in body) lead.ownerNote = clean(body.ownerNote, 1000);
      await setJSON(key, lead);
      return json({ lead });
    }
    if (parts[0] === 'photo' && parts[1] && parts[2] && method === 'GET') {
      const key = `photos/${biz.slug}/${clean(parts[1], 20)}/${Number(parts[2]) | 0}`;
      const found = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!found) return fail(404, 'That photo was not found.');
      return new Response(found.data, { headers: { 'content-type': found.metadata?.type || 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
    }
    return fail(404, 'Not found.');
  };
}

// Sends a phone alert to every device the owner has switched alerts on for.
async function pushNotify(subscriptions, payload) {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
  if (!pub || !priv || !subscriptions.length) return [];
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails('mailto:support@elheen.com', pub, priv);
  const dead = [];
  await Promise.all(subscriptions.map((sub) =>
    webpush.sendNotification(sub, JSON.stringify(payload)).catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint); })));
  return dead;
}

// Calls Meta's Graph API.
async function graphFetch(path, { method = 'GET', params = {} } = {}) {
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `Facebook request failed: ${res.status}`);
  return data;
}

// Asks Claude for the assistant's next reply.
async function askClaude(system, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ELHEEN_AI_MODEL || 'claude-haiku-5-5', max_tokens: 300, system, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The AI service said ${res.status}: ${data.error?.message || 'no reason given'}`);
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

export default (req) => makeHandler(getStore({ name: 'elheen', consistency: 'strong' }), {
  ELHEEN_INVITE: process.env.ELHEEN_INVITE,
  pushKey: process.env.VAPID_PUBLIC_KEY || null,
  notify: pushNotify,
  ask: process.env.ANTHROPIC_API_KEY ? askClaude : null,
  graph: graphFetch,
  meta: {
    appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET, verifyToken: process.env.META_VERIFY_TOKEN,
    redirectUri: `${process.env.ELHEEN_URL || process.env.URL || 'https://elheen.netlify.app'}/api/meta/callback`,
  },
})(req);
export const config = { path: '/api/*' };
