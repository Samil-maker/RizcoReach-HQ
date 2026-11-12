// The mock world for the end-to-end test: Google Maps result pages (with Google's "Recently opened" label), the
// businesses' websites, public DNS, the mailbox checker, the Instagram Graph API, a Facebook page, Instagram
// profile pages and the Meta Ad Library. Nothing here talks to a real service.
import { makeAd, searchResponse } from './fixtures.mjs';

export const VERIFY_KEY = 'qev-test-key';
export const IG = { token: 'ig-test-token', account: '17841400000000001' };
export const calls = { dns: [], verify: [], sandbox: [], ig: [], maps: [], fbPages: [] };
export const world = { mapsWall: false, adWall: false, verifyOut: false };

/* ------------------------------------------------------------ Google Maps */
// label: Google's own line on a new listing. hours: opening hours, which must never be read as that label.
// net: the label only arrives in Maps' network data, not on the card.
export const BUSINESSES = {
  bloom: { name: 'Bloom Beauty Lounge', label: 'Recently opened', phone: '050 111 2201', reviews: 3, website: 'https://www.instagram.com/bloombeautydxb/' },
  velvet: { name: 'Velvet Hair Studio', label: 'Opened 3 weeks ago', phone: '04 111 2202', reviews: 1, website: 'https://velvethair.example/' },
  glam: { name: 'Glam Corner Salon', phone: '04 111 2203', reviews: 85, website: 'https://glamcorner.example/' },
  oldtown: { name: 'Old Town Salon', phone: '04 111 2204', reviews: 40 },
  rose: { name: 'Rose Petal Spa', phone: '055 111 2205', reviews: 22, website: 'https://rosepetal.example/' },
  owl: { name: 'Night Owl Salon', phone: '04 111 2206', reviews: 12, hours: 'Closed ⋅ Opens 10 AM Wed', extra: 'Opens soon ⋅ 10 AM' },
  henna: { name: 'Henna House', label: 'Recently opened', reviews: 0, website: 'https://www.facebook.com/hennahousedxb' },
  gloss: { name: 'Gloss Garage', phone: '050 111 2208', reviews: 30, website: 'https://glossgarage.example/', category: 'Car detailing service' },
  soon: { name: 'Soon Cafe', net: 'Opening soon', reviews: 0, category: 'Cafe' },
  shield: { name: 'Shield PPF Center', label: 'Recently opened', phone: '056 111 2210', reviews: 2, category: 'Car detailing service' },
  chain: { name: 'Mega Detailing Hub', reviews: 980, category: 'Car detailing service', website: 'https://megadetailing.example/' },
};
export const SEARCHES = {
  'ladies salon JLT, Dubai': ['bloom', 'velvet', 'glam', 'oldtown', 'rose', 'owl', 'henna'],
  'ladies salon Al Quoz, Dubai': ['gloss', 'bloom', 'soon'],
  'ppf JLT, Dubai': ['shield', 'chain'],
};
const keys = Object.keys(BUSINESSES);
const dataId = (key) => `0x3e5f43${(keys.indexOf(key) + 1).toString(16)}:0x${(4096 + keys.indexOf(key)).toString(16)}`;
function card(key, area) {
  const b = BUSINESSES[key];
  const rating = b.reviews ? `<span class="MW4etd">4.8</span><span class="UY7F9">(${b.reviews})</span>` : '<span>No reviews</span>';
  return `<div class="Nv2PK" role="article" aria-label="${b.name}">
  <a class="hfpxzc" aria-label="${b.name}" href="/maps/place/${encodeURIComponent(b.name)}/data=!4m7!3m6!1s${dataId(key)}!8m2!3d25.07!4d55.14!16s%2Fg%2F11x?authuser=0&amp;hl=en"></a>
  <div class="qBF1Pd">${b.name}</div>${rating}
  <div class="W4Efsd"><span>${b.category || 'Beauty salon'}</span> · <span>${area}</span></div>
  ${b.label ? `<div class="W4Efsd"><span>${b.label}</span></div>` : ''}
  <div class="W4Efsd">${b.hours || 'Open ⋅ Closes 9 PM'}${b.phone ? ` · <span class="UsdlK">${b.phone}</span>` : ''}</div>
  ${b.extra ? `<div class="W4Efsd">${b.extra}</div>` : ''}
  ${b.website ? `<a data-value="Website" href="${b.website}">Website</a>` : ''}
</div>`;
}
function mapsPage(query) {
  const list = SEARCHES[query] || [];
  const area = query.split(' ').slice(-2).join(' ');
  const needNet = list.some((k) => BUSINESSES[k].net);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${query} - Google Maps</title></head><body>
<div role="feed" aria-label="Results for ${query}" style="height:500px;overflow:auto"><div id="cards">
${list.map((k) => card(k, area)).join('\n')}
</div><span class="HlvSq">You\u2019ve reached the end of the list.</span></div>
${needNet ? `<script>fetch('/search?tbm=map&lhq=' + encodeURIComponent(${JSON.stringify(query)})).then((r) => r.text());</script>` : ''}
</body></html>`;
}
/** Maps' own search data: each place is a long array, with the label somewhere inside it. */
function mapsXhr(query) {
  const places = (SEARCHES[query] || []).map((k) => {
    const b = BUSINESSES[k];
    const a = [];
    a[4] = [null, null, null, null, null, null, null, b.reviews ? 4.8 : null, b.reviews || 0];
    a[7] = b.website ? [b.website, b.website.replace(/^https?:\/\//, '')] : null;
    a[10] = dataId(k);
    a[11] = b.name;
    a[13] = [b.category || 'Beauty salon'];
    a[39] = 'Cluster Y, JLT, Dubai';
    a[78] = `ChIJ${k}`;
    a[178] = b.phone ? [[b.phone, []]] : null;
    a[203] = [null, [null, [b.net || b.label || 'Open ⋅ Closes 9 PM', 'A lovely place, recently opened and already busy with regulars']]];
    return [null, a];
  });
  const data = [];
  data[64] = places;
  return JSON.stringify({ c: 0, d: ")]}'\n" + JSON.stringify(data) }) + '/*""*/';
}

/* ---------------------------------------------------------------- websites */
const REAL = (name, email) => `<!doctype html><html lang="en"><head><title>${name} | Dubai</title><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${name} in Dubai. Book today and get a quote on WhatsApp in minutes."></head>
<body><h1>${name}</h1>${'<p>Cuts, colour, nails and lashes for the whole neighbourhood, seven days a week. </p>'.repeat(40)}
<a href="tel:+97141112203">Call</a><a href="mailto:${email}">Email us</a><form></form><footer>© 2026</footer></body></html>`;
const SITES = {
  // "Coming soon" with their address on it: they bought the name and never built the site.
  'velvethair.example': () => [200, '<!doctype html><html><head><title>Velvet Hair Studio</title></head><body><h1>Velvet Hair Studio</h1><p>Our new website is coming soon.</p><a href="mailto:hello@velvethair.example">hello@velvethair.example</a></body></html>'],
  'glamcorner.example': () => [200, REAL('Glam Corner Salon', 'hello@glamcorner.example')],
  'megadetailing.example': () => [200, REAL('Mega Detailing Hub', 'info@megadetailing.example')],
  'rosepetal.example': () => [500, 'Internal Server Error'],
  // A parked page with every kind of broken address on it: a phone number glued on, a web link's %20, a typo in
  // the ending, a typo in "gmail", a placeholder, and one good address at a domain that turns out not to exist.
  'glossgarage.example': () => [
    200,
    `<!doctype html><html><head><title>Gloss Garage</title></head><body><h1>This domain is parked free</h1>
     <p>Call 0501112208owner@glossgarage.example or write to <a href="mailto:%20bookings@glossgarage.example">bookings</a>, sales@glossgarage.con, gloss.garage.dxb@gmial.com, you@yourdomain.com</p></body></html>`,
  ],
  // The domain behind an email address found on Instagram: a real, working website nobody had listed.
  'newcafedxb.example': () => [200, REAL('New Cafe DXB', 'hello@newcafedxb.example')],
};

/* --------------------------------------------------------------------- DNS */
// What public DNS says about each domain's mail servers. Status 3 = the domain does not exist.
const mx = (host) => ({ Status: 0, Answer: [{ name: 'x', type: 15, TTL: 300, data: `10 ${host}.` }] });
const DNS = {
  'gmail.com': mx('gmail-smtp-in.l.google.com'),
  'velvethair.example': mx('mx.zoho.com'),
  'glossgarage.example': { Status: 3 },
  'glossgarage.com': { Status: 0 }, // exists, receives no email
  'freshbites.example': mx('aspmx.l.google.com'),
  'newcafedxb.example': mx('mx1.titan.email'),
  'parkedmail.example': mx('park-mx.above.com'),
};

/* ----------------------------------------------------------- mailbox check */
// QuickEmailVerification's answers, as its documentation shows them (booleans as strings).
const VERIFY = {
  'bloom.beauty.dxb@gmail.com': { result: 'valid', reason: 'accepted_email', disposable: 'false', accept_all: 'false', safe_to_send: 'true' },
  'hello@velvethair.example': { result: 'valid', reason: 'accepted_email', disposable: 'false', accept_all: 'true', safe_to_send: 'false' },
  'hennahouse.dxb@gmail.com': { result: 'invalid', reason: 'rejected_email', disposable: 'false', accept_all: 'false', safe_to_send: 'false' },
  'gloss.garage.dxb@gmail.com': { result: 'valid', reason: 'accepted_email', disposable: 'false', accept_all: 'false', safe_to_send: 'true' },
  'hello@freshbites.example': { result: 'unknown', reason: 'timeout', disposable: 'false', accept_all: 'false', safe_to_send: 'false' },
};

/* --------------------------------------------------- Instagram (official API) */
const igTime = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().replace(/\.\d+Z$/, '+0000'); // Instagram's own format
const post = (id, daysAgo, caption) => ({ id: String(id), caption, timestamp: igTime(daysAgo), permalink: `https://www.instagram.com/p/${id}/` });
const IG_ACCOUNTS = {
  rizcoreach: { followers_count: 1200, media_count: 80, name: 'RizcoReach', biography: 'Websites and ads in Dubai', media: [post('r1', 2, 'Client work')] },
  // Five posts in all, the oldest three weeks old: a brand new account, and a post announcing the opening.
  bloombeautydxb: {
    followers_count: 212,
    media_count: 5,
    name: 'Bloom Beauty Lounge',
    biography: 'Ladies salon in JLT 💅 Bookings: bloom.beauty.dxb@gmail.com',
    media: [post('b5', 2, 'Lash lifts all week'), post('b4', 6, 'GRAND OPENING this Friday in JLT Cluster X! 20% off every service for the first week'), post('b3', 12, 'Almost there'), post('b2', 18, 'Painting day'), post('b1', 21, 'Keys in hand')],
  },
  // Three posts, the first ten days ago, and they say so themselves.
  'newcafe.dxb': {
    followers_count: 96,
    media_count: 3,
    name: 'New Cafe DXB',
    biography: 'Specialty coffee, JLT',
    website: 'https://linktr.ee/newcafedxb',
    media: [post('n3', 1, 'Flat whites all day'), post('n2', 4, 'We are finally open! Come say hi'), post('n1', 10, 'Machine is in')],
  },
};

/* --------------------------------------------------------- Instagram pages */
const IG_PROFILES = {
  'newcafe.dxb': { name: 'New Cafe DXB', bio: 'Specialty coffee in JLT ☕ Now open! hello@newcafedxb.example', links: ['https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fnewcafedxb&e=AT0'] },
};
function instagramHtml(handle) {
  const p = IG_PROFILES[handle];
  if (!p) return '<html><head><title>Instagram</title></head><body><main>Explore</main></body></html>';
  const title = `${p.name} (@${handle}) • Instagram photos and videos`;
  const desc = `96 Followers, 20 Following, 3 Posts - ${p.name} (@${handle}) on Instagram: "${p.bio}"`.replace(/"/g, '&quot;');
  return `<html><head><title>${title}</title><meta property="og:title" content="${title}"><meta name="description" content="${desc}"></head>
    <body><main><header><h2>${handle}</h2>${p.links.map((h) => `<a href="${h}">link</a>`).join('')}</header></main></body></html>`;
}

/* ---------------------------------------------------------- Meta Ad Library */
const ADS = {
  'grand opening': [
    // Their ad says so, it started five days ago, and it sends people to WhatsApp: a new business with no website.
    makeAd({ id: 91001, pageId: 7001, pageName: 'Fresh Bites Cafe', daysAgo: 5, likes: 310, cta: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message', link: 'https://api.whatsapp.com/send?phone=971501117001', body: 'Grand opening this Saturday in Business Bay! Tables: hello@freshbites.example' }),
    // The same words on an ad that has run for most of a year: not new.
    makeAd({ id: 91002, pageId: 7002, pageName: 'Old Mall Outlet', daysAgo: 300, likes: 900, cta: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message', link: 'https://api.whatsapp.com/send?phone=971501117002', body: 'Grand opening prices all year round' }),
    // A brand with a huge page opening one more branch.
    makeAd({ id: 91003, pageId: 7003, pageName: 'MegaMart Official', daysAgo: 3, likes: 900000, cta: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message', link: 'https://api.whatsapp.com/send?phone=971501117003', body: 'Now open in Dubai Hills Mall' }),
  ],
};
function adLibraryHtml(kw) {
  const ads = ADS[kw] || [];
  const embedded = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_AdLibrarySearchPaginationQueryRelayPreloader_1', { __bbox: { complete: true, result: searchResponse(ads, { hasNext: false }) } }]]] } }]]] };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ad Library</title></head>
<body><div id="list">${ads.map((a) => `<div style="height:320px">${a.page_name} · Library ID: ${a.ad_archive_id}</div>`).join('')}</div>
<script type="application/json" data-content-len="1" data-sjs>${JSON.stringify(embedded).replace(/</g, '\\u003c')}</script></body></html>`;
}

/** Answers the request when it belongs to this world. Returns true when it did. */
export function worldHandler(req, res, url, host) {
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
    return true;
  };
  const json = (code, o) => send(code, 'application/json', JSON.stringify(o));
  const html = (code, body) => send(code, 'text/html; charset=utf-8', body);

  if (host === 'www.google.com') {
    if (url.pathname.startsWith('/maps/search/')) {
      const query = decodeURIComponent(url.pathname.split('/')[3] || '');
      calls.maps.push(query);
      if (world.mapsWall) return html(200, '<!doctype html><html><body><form action="https://consent.google.com/save"><h1>Before you continue to Google</h1></form></body></html>');
      return html(200, mapsPage(query));
    }
    if (url.pathname === '/search' && url.searchParams.get('lhq')) return send(200, 'application/json; charset=utf-8', mapsXhr(url.searchParams.get('lhq')));
  }
  if (host === 'dns.google' && url.pathname === '/resolve') {
    const name = String(url.searchParams.get('name') || '').toLowerCase();
    calls.dns.push(name);
    return json(200, DNS[name] || mx(`mail.${name}`));
  }
  if (host === 'api.quickemailverification.com') {
    const email = url.searchParams.get('email');
    const sandbox = url.pathname === '/v1/verify/sandbox';
    if (url.searchParams.get('apikey') !== VERIFY_KEY) return json(401, { success: 'false', message: 'Invalid API key' });
    if (sandbox) return calls.sandbox.push(email), json(200, { result: 'valid', reason: 'accepted_email', disposable: 'false', accept_all: 'false', email, success: 'true', message: '' });
    if (world.verifyOut) return json(402, { success: 'false', message: 'Low credit' });
    calls.verify.push(email);
    return json(200, { ...(VERIFY[email] || { result: 'invalid', reason: 'rejected_email', disposable: 'false', accept_all: 'false' }), email, role: 'false', did_you_mean: '', success: 'true', message: '' });
  }
  if (host === 'graph.facebook.com') {
    const fields = url.searchParams.get('fields') || '';
    calls.ig.push(fields);
    if (url.searchParams.get('access_token') !== IG.token) return json(400, { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } });
    const m = fields.match(/^business_discovery\.username\(([^)]+)\)\{(.*)\}$/);
    if (!m) return json(200, { id: IG.account, username: 'rizcoreach', followers_count: 1200 });
    const acc = IG_ACCOUNTS[m[1]];
    if (!acc) return json(400, { error: { message: 'Invalid user id', code: 110, error_subcode: 2207013 } });
    const { media, ...rest } = acc;
    return json(200, { id: IG.account, business_discovery: { id: '9', username: m[1], ...rest, media: { data: media } } });
  }
  if (host === 'www.instagram.com') return html(200, instagramHtml(url.pathname.split('/').filter(Boolean)[0] || ''));
  if (host === 'www.facebook.com') {
    if (url.pathname === '/hennahousedxb') {
      calls.fbPages.push(url.pathname);
      return html(
        200,
        `<!doctype html><html><head><meta charset="utf-8"><title>Henna House | Facebook</title></head><body><div role="main">
        <div class="intro"><h2><span>Intro</span></h2><div>Henna and bridal mehndi in JLT, now open. Email hennahouse.dxb&#64;gmail.com or call 050 111 2207.</div></div>
        <div role="article"><div>${'Bridal henna for a wedding in Mirdif this week. '.repeat(8)} Hiring: send your CV to jobs@otherco.example</div></div>
      </div></body></html>`,
      );
    }
    if (url.pathname.startsWith('/ads/library')) {
      if (world.adWall) return html(200, '<!doctype html><html><body><div id="AdLibraryFoundationRoot">You must log in to continue.</div></body></html>');
      return html(200, adLibraryHtml((url.searchParams.get('q') || '').toLowerCase()));
    }
  }
  if (host === 'wa.me') return html(200, 'whatsapp stub');
  if (SITES[host]) {
    const [code, body] = SITES[host]();
    return html(code, body);
  }
  return false;
}
