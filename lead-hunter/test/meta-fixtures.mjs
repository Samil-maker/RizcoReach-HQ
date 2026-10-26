// Mock Google Places API, Google Maps results page, advertiser websites and Ad Library
// "is this business running ads?" views for the Meta-ads part of the end-to-end test.
import { makeAd } from './fixtures.mjs';

/* ---------------------------------------------------- Places API (Car detailing) */
const place = (id, name, o = {}) => ({
  id,
  displayName: { text: name },
  formattedAddress: o.address || 'Al Quoz Industrial Area 3, Dubai, United Arab Emirates',
  nationalPhoneNumber: o.phone || '',
  websiteUri: o.website || undefined,
  rating: o.rating ?? 4.6,
  userRatingCount: o.reviews ?? 80,
  googleMapsUri: `https://maps.google.com/?cid=${id.length}`,
  businessStatus: o.status || 'OPERATIONAL',
  primaryTypeDisplayName: { text: 'Car detailing service' },
});
export const PLACES_PAGE_1 = [
  place('ChIJglossy', 'Glossy PPF Studio', { website: 'https://glossyppf.example/', phone: '050 700 0001', rating: 4.9, reviews: 312 }),
  place('ChIJarmor', 'Armor Shield Detailing', { website: 'https://armorshield.example/', phone: '04 700 0002' }),
  place('ChIJdesert', 'Desert Ceramic Care', { website: 'https://desertceramic.example/', phone: '04 700 0003' }),
  place('ChIJnano', 'Nano Pro Tint', { phone: '055 700 0004', reviews: 41 }),
  place('ChIJshiny', 'Shiny Wheels Car Spa', { phone: '04 700 0005', reviews: 9, rating: 4.1 }),
  place('ChIJelite', 'Elite Renovation & Detailing', { phone: '04 700 0006' }),
];
export const PLACES_PAGE_2 = [
  place('ChIJwrap', 'Wrap Kings JLT', { website: 'https://wrapkings.example/', phone: '056 700 0007' }),
  place('ChIJglossy2', 'Glossy PPF Studio - Branch 2', { website: 'https://glossyppf.example/branch', phone: '04 700 0008' }),
  // Maps lists their Instagram as the "website": saved as their Instagram, not as a website.
  place('ChIJinsta', 'Insta Tint Bar', { website: 'https://www.instagram.com/instatintbar/', phone: '052 700 0009', reviews: 18, rating: 4.8 }),
  place('ChIJclosed', 'Closed Detailing', { status: 'CLOSED_PERMANENTLY' }),
];

/* -------------------------------------------- Google Maps page (Aesthetic clinics) */
const card = (dataId, name, o = {}) => `<div class="Nv2PK" role="article" aria-label="${name}">
  <a class="hfpxzc" aria-label="${name}" href="/maps/place/${encodeURIComponent(name)}/data=!4m7!3m6!1s${dataId}!8m2!3d25.07!4d55.14!16s%2Fg%2F11x!19sChIJ${dataId.slice(-3)}?authuser=0&amp;hl=en"></a>
  <div class="qBF1Pd">${name}</div><span class="MW4etd">${o.rating || '4.8'}</span><span class="UY7F9">(${o.reviews ?? 210})</span>
  <div class="W4Efsd"><span>${o.category || 'Medical spa'}</span> · <span>${o.street || 'Cluster X, JLT'}</span></div>
  <div class="W4Efsd">Open · Closes 9 pm${o.phone ? ` · <span class="UsdlK">${o.phone}</span>` : ''}</div>
  ${o.website ? `<a data-value="Website" href="${o.website}">Website</a>` : ''}
</div>`;
function placeArray(dataId, name, o) {
  const a = [];
  a[4] = [null, null, null, null, null, null, null, o.rating, o.reviews];
  a[7] = o.website ? [o.website, o.website.replace(/^https?:\/\//, '')] : null;
  a[10] = dataId;
  a[11] = name;
  a[13] = ['Medical spa'];
  a[39] = 'Cluster Y, JLT, Dubai';
  a[78] = `ChIJ${dataId.slice(-3)}`;
  a[178] = o.phone ? [[o.phone, []]] : null;
  return a;
}
/* The four searches from the brief, each with businesses every filter should keep or drop. */
export const PRESET_SEARCHES = {
  'ppf Al Quoz Industrial Area 3, Dubai': [
    ['Gloss Garage', { category: 'Car detailing service', reviews: 42, phone: '050 111 2201' }], // kept · mobile · chain
    ['Gloss Garage - JLT Branch', { category: 'Car detailing service', reviews: 18, phone: '04 111 2202' }], // kept · landline · chain
    ['Speedy Car Wash & Polish', { category: 'Car wash', reviews: 60 }], // excluded: car wash
    ['Al Quoz Tyres', { category: 'Tire shop', reviews: 30 }], // excluded: tyre
    ['Joe Auto Garage', { category: 'Garage', reviews: 25 }], // excluded: category garage
    ['Mega Detailing Hub', { category: 'Car detailing service', reviews: 980 }], // too many reviews
    ['New Tint Studio', { category: 'Window tinting service', reviews: 2 }], // too few
    ['Shield PPF Center', { category: 'Car detailing service', reviews: 150, phone: '600 52 2222' }], // kept · corporate
  ],
  'boxing gym Al Nahda, Sharjah': [
    ['Iron Fist Boxing', { category: 'Boxing gym', reviews: 23, phone: '052 222 3301' }], // kept
    ['Fitness First Sahara Centre', { category: 'Gym', reviews: 40 }], // excluded: brand
    ['Knockout Club', { category: 'Boxing gym', reviews: 310 }], // too many
    ['Spartan Boxing Sharjah', { category: 'Gym', reviews: 12, phone: '06 555 1234' }], // kept: "spa" is not "Spartan"
    ['Al Nahda Swimming Academy', { category: 'Swimming school', reviews: 15 }], // excluded: swimming
  ],
  'dog trainer Al Barsha, Dubai': [
    ['Happy Paws Training', { category: 'Dog trainer', reviews: 14, phone: '055 333 4401' }], // kept
    ['Barsha Vet Clinic', { category: 'Veterinarian', reviews: 40 }], // excluded: vet clinic
    ['Pet Corner Pet Shop', { category: 'Pet store', reviews: 25 }], // excluded: pet shop
    ['K9 Academy', { category: 'Dog trainer', reviews: 3 }], // too few
  ],
  // Phase 1: the same business under another spelling, someone in your imported contacts, and one new business.
  'ceramic coating Al Quoz Industrial Area 3, Dubai': [
    ['Glos Garage LLC', { category: 'Car detailing service', reviews: 40, phone: '050 111 2299' }], // the same as Gloss Garage
    ['Wax Lab Detailing', { category: 'Car detailing service', reviews: 20, phone: '050 777 8801' }], // in the imported contacts
    ['Shine Bay Detailing', { category: 'Car detailing service', reviews: 20, phone: '056 777 8802' }], // new
  ],
  'accounting firm Business Bay, Dubai': [
    ['Al Noor Accounting', { category: 'Accountant', reviews: 0, phone: '058 444 5501' }], // kept: no minimum
    ['KPMG Lower Gulf', { category: 'Accountant', reviews: 45 }], // excluded: brand
    ['Key Ledger Bookkeeping', { category: 'Bookkeeping service', reviews: 12, phone: '04 444 5502' }], // kept: "EY" is not "Key"
    ['Swift Business Setup', { category: 'Business management consultant', reviews: 30 }], // excluded: business setup
    ['Prime Audit Partners', { category: 'Accountant', reviews: 120 }], // too many
  ],
};
function presetMapsPage(query) {
  const list = PRESET_SEARCHES[query];
  const id = (i) => `0x${(Object.keys(PRESET_SEARCHES).indexOf(query) + 7).toString(16)}${i}:0xb${i}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${query} - Google Maps</title></head><body>
<div role="feed" aria-label="Results for ${query}" style="height:500px;overflow:auto"><div id="cards">
${list.map(([name, o], i) => card(id(i), name, { street: query.split(' ').slice(-3).join(' '), ...o })).join('\n')}
</div><span class="HlvSq">You\u2019ve reached the end of the list.</span></div></body></html>`;
}

export function mapsPage(query) {
  if (PRESET_SEARCHES[query]) return presetMapsPage(query);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${query} - Google Maps</title></head><body>
<div role="feed" aria-label="Results for ${query}" style="height:500px;overflow:auto">
  <div id="cards">
    ${card('0x3e5f1:0xa1', 'Glow Skin Clinic JLT', { phone: '04 333 4441', website: 'https://glowskin.example/' })}
    ${card('0x3e5f2:0xa2', 'Velvet Laser Lounge', { phone: '050 333 4442' })}
    <div style="height:1200px"></div>
  </div>
</div>
<script>
  const feed = document.querySelector('[role="feed"]');
  let more = false;
  feed.addEventListener('scroll', async () => {
    if (more || feed.scrollTop + feed.clientHeight < feed.scrollHeight - 60) return;
    more = true;
    await (await fetch('/search?tbm=map&q=' + encodeURIComponent(${JSON.stringify(query)}) + '&page=2')).text();
    // The list shows the new cards without phone or website; those only arrive in the network data.
    document.getElementById('cards').insertAdjacentHTML('beforeend', ${JSON.stringify(card('0x3e5f3:0xa3', 'Pure Derma Studio', { reviews: 95 }) + card('0x3e5f4:0xa4', 'Radiance Medspa', { reviews: 57 }))} + '<span class="HlvSq">You\\u2019ve reached the end of the list.</span>');
  });
</script></body></html>`;
}
export function mapsXhr() {
  const data = [];
  data[64] = [
    [null, placeArray('0x3e5f3:0xa3', 'Pure Derma Studio', { rating: 4.7, reviews: 95, phone: '055 333 4443', website: 'https://purederma.example/' })],
    [null, placeArray('0x3e5f4:0xa4', 'Radiance Medspa', { rating: 4.5, reviews: 57, phone: '04 333 4444' })],
  ];
  return JSON.stringify({ c: 0, d: ")]}'\n" + JSON.stringify(data) }) + '/*""*/';
}

/* -------------------------------------------------------- advertiser websites */
const site = (name, fb) => `<!doctype html><html lang="en"><head><title>${name} | Dubai</title><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${name} in Dubai. Book today and get a quote on WhatsApp in minutes."></head>
<body><h1>${name}</h1>${'<p>We look after cars and customers across Dubai. </p>'.repeat(40)}${fb ? `<a href="${fb}">Facebook</a>` : ''}<a href="tel:+97147000000">Call</a><form></form></body></html>`;
export const SITES = {
  'glossyppf.example': site('Glossy PPF Studio', 'https://www.facebook.com/glossyppf'),
  'armorshield.example': site('Armor Shield Detailing', 'https://www.facebook.com/armorshield/'),
  'desertceramic.example': site('Desert Ceramic Care', ''),
  'wrapkings.example': site('Wrap Kings JLT', 'https://www.facebook.com/profile.php?id=5550007'),
  'glowskin.example': site('Glow Skin Clinic JLT', ''),
  'purederma.example': site('Pure Derma Studio', ''),
};

/* --------------------------------------------- Ad Library views used by the check */
const FB_IDS = { glossyppf: '5550001', armorshield: '5550002' };
// Page view: id -> [ads in all (live and past), does the Ad Library know the page]
const PAGE_VIEWS = { 5550001: [0, true], 5550002: [5, true], 5550007: [0, false] };
// Armor Shield: 3 live ads and 2 old ones. The first load of all their ads only shows the 2 old ones, so the check
// has to ask for the live ones on their own before it can say "ran before".
const armorAds = [0, 1, 2].map((i) => makeAd({ id: 77000 + i, pageId: '5550002', pageName: 'Armor Shield Detailing', link: 'https://armorshield.example/ppf', daysAgo: 10 + i }));
const armorOld = [3, 4].map((i) => makeAd({ id: 77000 + i, pageId: '5550002', pageName: 'Armor Shield Detailing', link: 'https://armorshield.example/ppf', active: false, daysAgo: 300, endedDaysAgo: 200 }));
// Keyword searches (domain or name) -> ads returned
const KEYWORD_ADS = {
  'desertceramic.example': [makeAd({ id: 78001, pageId: '5550003', pageName: 'DCC Auto', link: 'https://desertceramic.example/offer', caption: 'desertceramic.example' })],
  'nano pro tint': [makeAd({ id: 78002, pageId: '5550099', pageName: 'Nano Pro Car Spa', link: 'https://elsewhere.example/' })],
  // Ran ads before, none live: two old ads link to their site. The newest one stopped 45 days ago.
  'purederma.example': [
    makeAd({ id: 78003, pageId: '5550004', pageName: 'Pure Derma Studio', link: 'https://purederma.example/laser', active: false, daysAgo: 120, endedDaysAgo: 45 }),
    makeAd({ id: 78004, pageId: '5550004', pageName: 'Pure Derma Studio', link: 'https://purederma.example/facial', active: false, daysAgo: 200, endedDaysAgo: 150 }),
  ],
};
// Instagram Graph API (Business Discovery): business and creator accounts only.
export const IG_API = { token: 'ig-test-token', account: '17841400000000001', followers: { instatintbar: 640, 'glossy.tint_bar': 2345 }, calls: [] };
/* ---------------------------------------- Intent Radar: Reddit, a Facebook group, LinkedIn */
const hoursAgo = (h) => Math.floor(Date.now() / 1000 - h * 3600);
const rp = (id, sub, author, title, selftext, h, extra = {}) => ({ data: { id, subreddit: sub, permalink: `/r/${sub}/comments/${id}/post/`, author, title, selftext, created_utc: hoursAgo(h), ...extra } });
export const REDDIT = {
  dubai: [
    rp('d1', 'dubai', 'sarah_dxb', 'Need a website for my bakery in JLT, any recommendations?', '', 3), // website buyer
    rp('d2', 'dubai', 'webpro_ae', 'Need a website? AED 999', 'We offer websites for small businesses, DM me', 5), // a seller using buyer words
    rp('d3', 'dubai', 'foodie', 'Best shawarma in Dubai?', '', 6), // nothing to do with us
    rp('d4', 'dubai', 'old_post', 'Looking for a marketing agency', 'Anyone know a marketing agency?', 20 * 24), // 20 days old
    rp('d5', 'dubai', 'mod', 'Weekly thread', '', 1, { stickied: true }), // pinned: left out
  ],
  UAE: [
    rp('u1', 'UAE', 'owner_ae', 'Business is slow, ads not working', 'What do you guys do to get more customers?', 26), // owner pain
    rp('u2', 'UAE', 'sarah_dxb', 'Need a website for my bakery in JLT, any recommendations?', '', 2), // the same post again
  ],
  smallbusiness: [
    rp('s1', 'smallbusiness', 'clean_co', 'How do I get clients for my cleaning company in Sharjah?', '', 30), // owner pain, in the UAE
    rp('s2', 'smallbusiness', 'ohio_shop', 'Need a website for my shop', 'In Ohio', 4), // not in the UAE
  ],
};
export const redditCalls = [];
const fbPost = (who, id, age, text, inner = '') =>
  `<div role="article"><h3><a href="/${who.toLowerCase().replace(/\s/g, '.')}">${who}</a></h3><a href="https://www.facebook.com/groups/dubaibiz/posts/${id}/" aria-label="${age}">${age}</a><div data-ad-preview="message">${text}</div>${inner}</div>`;
const FB_GROUP = `<!doctype html><html><head><meta charset="utf-8"><title>(3) Dubai Business Owners | Facebook</title></head><body><div role="feed">
${fbPost('Sarah Khan', 111, '2h', 'Can anyone recommend a social media manager for my salon in Al Barsha? Our Instagram is dead', '<div role="article"><div>We offer social media management, DM me</div></div>')}
${fbPost('Ali Agency', 222, '5h', 'Our agency offers Facebook ads management, DM us for a free audit')}
${fbPost('Omar', 333, '3w', 'Looking for a web developer for our restaurant')}
</div></body></html>`;
const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const job = (id, title, company, where, d) =>
  `<li data-occludable-job-id="${id}"><div data-job-id="${id}"><a class="job-card-list__title" href="/jobs/view/${id}/"><strong>${title}</strong></a><div class="artdeco-entity-lockup__subtitle">${company}</div><div class="artdeco-entity-lockup__caption">${where}</div><time datetime="${day(d)}">${d} days ago</time></div></li>`;
const LI_JOBS = `<!doctype html><html><head><meta charset="utf-8"><title>Marketing jobs | LinkedIn</title></head><body><ul>
${job(901, 'Social Media Executive', 'Gloss Garage', 'Dubai, United Arab Emirates', 2)}
${job(902, 'Accountant', 'Prime Audit', 'Dubai, United Arab Emirates', 1)}
${job(903, 'Digital Marketing Specialist', 'Acme Corp', 'London, United Kingdom', 3)}
</ul></body></html>`;
const LI_WALL = `<!doctype html><html><head><title>Security Verification | LinkedIn</title></head><body><main><h1>Let's do a quick security check</h1></main></body></html>`;

/* Claude's Messages API: a verdict per post, picked by what the post says. */
export const CLAUDE = { key: 'sk-ant-test-key', calls: [] };
const VERDICTS = [
  [/bakery/, { is_buyer: true, service_needed: 'website', business_type: 'bakery', location: 'JLT, Dubai', urgency: 'high', summary: 'A bakery owner in JLT wants a website.', intent_score: 90 }],
  [/Business is slow/, { is_buyer: true, service_needed: 'marketing', business_type: 'unknown', location: 'unknown', urgency: 'medium', summary: 'A business owner says sales are slow and their ads are not working.', intent_score: 70 }],
  [/cleaning company/, { is_buyer: false, service_needed: 'none', business_type: 'cleaning company', location: 'Sharjah', urgency: 'low', summary: 'Someone asking in general how cleaning companies find clients, not looking to hire anyone.', intent_score: 15 }],
  [/Social Media Executive/, { is_buyer: true, service_needed: 'marketing', business_type: 'car detailing studio', location: 'Dubai', urgency: 'medium', summary: 'Gloss Garage is hiring a social media executive.', intent_score: 65 }],
  [/salon/, { is_buyer: true, service_needed: 'marketing', business_type: 'salon', location: 'Al Barsha, Dubai', urgency: 'high', summary: 'A salon owner in Al Barsha needs a social media manager.', intent_score: 85 }],
  [/gym/, { is_buyer: true, service_needed: 'website', business_type: 'gym', location: 'Al Quoz, Dubai', urgency: 'high', summary: 'A gym owner in Al Quoz wants a web developer.', intent_score: 80 }],
];
// Set to a page body to answer every Ad Library request with it (a login wall, a block).
export const metaWall = { body: '' };
function libraryPage(ads, count, pageInfo) {
  const result = { data: { ad_library_main: { search_results_connection: { count, edges: ads.map((a) => ({ node: { collated_results: [a] } })), page_info: { end_cursor: null, has_next_page: false } } }, ...(pageInfo === undefined ? {} : { ad_library_page_info: { page_info: pageInfo } }) } };
  const blob = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_AdLibraryFoundationRootQueryRelayPreloader_1', { __bbox: { complete: true, result } }]]] } }]]] };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ad Library</title></head><body><div id="AdLibraryFoundationRoot">${ads.length ? ads.map((a) => `<div>${a.page_name} · Library ID: ${a.ad_archive_id}</div>`).join('') : 'No ads match your search criteria'}</div>
<script type="application/json" data-sjs>${JSON.stringify(blob).replace(/</g, '\\u003c')}</script></body></html>`;
}
export const checkLog = [];

/** Returns true when the request was one of ours. */
export function metaHandler(req, res, url, host) {
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };
  if (host === 'places.googleapis.com' && url.pathname === '/v1/places:searchText') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!req.headers['x-goog-api-key'] || !String(req.headers['x-goog-fieldmask'] || '').includes('nextPageToken')) return send(400, 'application/json', JSON.stringify({ error: { code: 400, message: 'bad request' } }));
      send(200, 'application/json', JSON.stringify(b.pageToken ? { places: PLACES_PAGE_2 } : { places: PLACES_PAGE_1, nextPageToken: 'page-2' }));
    });
    return true;
  }
  if (host === 'www.google.com') {
    if (url.pathname.startsWith('/maps/search/')) return send(200, 'text/html; charset=utf-8', mapsPage(decodeURIComponent(url.pathname.split('/')[3] || ''))), true;
    if (url.pathname === '/search' && url.searchParams.get('tbm') === 'map') return send(200, 'application/json; charset=utf-8', mapsXhr()), true;
  }
  if (SITES[host]) return send(200, 'text/html; charset=utf-8', SITES[host]), true;
  if (host === 'api.anthropic.com' && url.pathname === '/v1/messages') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const h = req.headers;
      CLAUDE.calls.push({ key: h['x-api-key'], version: h['anthropic-version'], browser: h['anthropic-dangerous-direct-browser-access'], model: body.model, effort: (body.output_config || {}).effort, format: ((body.output_config || {}).format || {}).type, text: body.messages[0].content });
      const json = (code, o) => send(code, 'application/json', JSON.stringify(o));
      if (h['x-api-key'] !== CLAUDE.key) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      const verdict = (VERDICTS.find(([re]) => re.test(body.messages[0].content)) || [null, VERDICTS[0][1]])[1];
      json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(verdict) }], usage: { input_tokens: 600, output_tokens: 90 } });
    });
    return true;
  }
  if (host === 'www.reddit.com') {
    const sub = (url.pathname.match(/^\/r\/([^/]+)\/new\.json$/) || [])[1];
    if (!sub) return send(404, 'text/plain', 'not found'), true;
    redditCalls.push(`${sub}?${url.searchParams.get('limit')}`);
    return send(200, 'application/json', JSON.stringify({ kind: 'Listing', data: { children: REDDIT[sub] || [] } })), true;
  }
  if (host === 'www.facebook.com' && url.pathname.startsWith('/groups/')) return send(200, 'text/html; charset=utf-8', FB_GROUP), true;
  if (host === 'www.linkedin.com') {
    if (url.pathname.startsWith('/jobs/')) return send(200, 'text/html; charset=utf-8', LI_JOBS), true;
    if (url.pathname.startsWith('/feed')) return send(200, 'text/html; charset=utf-8', LI_WALL), true;
  }
  if (host === 'graph.facebook.com') {
    const json = (code, o) => (send(code, 'application/json', JSON.stringify(o)), true);
    const fields = url.searchParams.get('fields') || '';
    IG_API.calls.push(fields);
    if (url.searchParams.get('access_token') !== IG_API.token) return json(400, { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } });
    if (url.pathname !== `/v23.0/${IG_API.account}`) return json(400, { error: { message: 'Unsupported get request', code: 100, error_subcode: 33 } });
    const m = fields.match(/^business_discovery\.username\(([^)]+)\)/);
    if (!m) return json(200, { id: IG_API.account, username: 'rizcoreach', followers_count: 1200 });
    const n = IG_API.followers[m[1]];
    if (n == null) return json(400, { error: { message: 'Invalid user id', code: 110, error_subcode: 2207013 } });
    const posted = new Date(Date.now() - 3 * 864e5).toISOString().replace(/\.\d+Z$/, '+0000'); // Instagram's own format
    return json(200, { id: IG_API.account, business_discovery: { id: '9', username: m[1], followers_count: n, media_count: 40, media: { data: [{ timestamp: posted, id: '1' }] } } });
  }
  if (host === 'www.facebook.com' && url.pathname.startsWith('/plugins/page.php')) {
    const handle = new URL(url.searchParams.get('href')).pathname.replace(/\//g, '');
    return send(200, 'text/html', FB_IDS[handle] ? `<a href="https://www.facebook.com/${FB_IDS[handle]}?ref=embed_page">page</a>` : '<div>Page not found</div>'), true;
  }
  if (host === 'www.facebook.com' && url.pathname.startsWith('/ads/library')) {
    const id = url.searchParams.get('view_all_page_id');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const live = url.searchParams.get('active_status') === 'active';
    checkLog.push(`country:${url.searchParams.get('country')}`);
    if (metaWall.body) {
      checkLog.push('wall');
      return send(200, 'text/html; charset=utf-8', `<!doctype html><html><body><div id="AdLibraryFoundationRoot">${metaWall.body}</div></body></html>`), true;
    }
    if (id) {
      checkLog.push(`page:${id}${live ? ':live' : ''}`);
      const [count, known] = PAGE_VIEWS[id] || [0, false];
      const ads = id === '5550002' ? (live ? armorAds : armorOld) : [];
      return send(200, 'text/html; charset=utf-8', libraryPage(ads, live ? ads.length : count, known ? { page_name: 'x', page_is_deleted: false } : null)), true;
    }
    if (q && (KEYWORD_ADS[q] || /\.example$|clinic|studio|lounge|medspa|spa|tint|wrap|glossy|armor|desert|shiny/.test(q))) {
      checkLog.push(`q:${q}${live ? ':live' : ''}`);
      const ads = (KEYWORD_ADS[q] || []).filter((a) => !live || a.is_active);
      return send(200, 'text/html; charset=utf-8', libraryPage(ads, ads.length)), true;
    }
  }
  return false;
}
