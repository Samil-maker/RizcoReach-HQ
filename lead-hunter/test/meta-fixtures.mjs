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
  <div class="qBF1Pd">${name}</div><span class="MW4etd">${o.rating || '4.8'}</span><span class="UY7F9">(${o.reviews || 210})</span>
  <div class="W4Efsd"><span>Medical spa</span> · <span>Cluster X, JLT</span></div>
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
export function mapsPage(query) {
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
// Page view: id -> [live count, does the Ad Library know the page]
const PAGE_VIEWS = { 5550001: [0, true], 5550002: [3, true], 5550007: [0, false] };
const armorAds = [0, 1, 2].map((i) => makeAd({ id: 77000 + i, pageId: '5550002', pageName: 'Armor Shield Detailing', link: 'https://armorshield.example/ppf' }));
// Keyword searches (domain or name) -> ads returned
const KEYWORD_ADS = {
  'desertceramic.example': [makeAd({ id: 78001, pageId: '5550003', pageName: 'DCC Auto', link: 'https://desertceramic.example/offer', caption: 'desertceramic.example' })],
  'nano pro tint': [makeAd({ id: 78002, pageId: '5550099', pageName: 'Nano Pro Car Spa', link: 'https://elsewhere.example/' })],
};
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
  if (host === 'www.facebook.com' && url.pathname.startsWith('/plugins/page.php')) {
    const handle = new URL(url.searchParams.get('href')).pathname.replace(/\//g, '');
    return send(200, 'text/html', FB_IDS[handle] ? `<a href="https://www.facebook.com/${FB_IDS[handle]}?ref=embed_page">page</a>` : '<div>Page not found</div>'), true;
  }
  if (host === 'www.facebook.com' && url.pathname.startsWith('/ads/library')) {
    const id = url.searchParams.get('view_all_page_id');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (id) {
      checkLog.push(`page:${id}`);
      const [count, known] = PAGE_VIEWS[id] || [0, false];
      return send(200, 'text/html; charset=utf-8', libraryPage(id === '5550002' ? armorAds : [], count, known ? { page_name: 'x', page_is_deleted: false } : null)), true;
    }
    if (q && (KEYWORD_ADS[q] || /\.example$|clinic|studio|lounge|medspa|spa|tint|wrap|glossy|armor|desert|shiny/.test(q))) {
      checkLog.push(`q:${q}`);
      const ads = KEYWORD_ADS[q] || [];
      return send(200, 'text/html; charset=utf-8', libraryPage(ads, ads.length)), true;
    }
  }
  return false;
}
