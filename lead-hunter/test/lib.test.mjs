// Unit tests for the shared libraries: `node --test lead-hunter/test/*.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ADS, searchResponse, makeAd } from './fixtures.mjs';

await import('../lib/common.js');
await import('../lib/emails.js');
await import('../lib/fit.js');
await import('../lib/extract-ads.js');
await import('../lib/site-audit.js');
await import('../lib/prospects.js');
const LH = globalThis.LH;

test('extracts ads from a GraphQL response with for(;;) prefix and multiple JSON lines', () => {
  const text = 'for (;;);' + JSON.stringify(searchResponse(SAMPLE_ADS.slice(0, 3))) + '\n' + JSON.stringify({ label: 'x', data: { more: [SAMPLE_ADS[3]] } });
  const ads = LH.extractAdsFromText(text);
  assert.equal(ads.length, 4);
  const a = ads.find((x) => x.id === '1001');
  assert.equal(a.pageId, '501');
  assert.equal(a.pageName, 'Shine Auto Spa');
  assert.equal(a.count, 3);
  assert.equal(a.links[0], 'https://shineautospa.example/ceramic?utm_source=fb');
  assert.ok(a.start < Date.now() - 60 * 86400000);
  assert.deepEqual(a.categories, ['Car Wash']);
});

test('ignores text without ads', () => {
  assert.deepEqual(LH.extractAdsFromText('{"data":{"viewer":{}}}'), []);
});

test('phone parsing handles UAE local, international and WhatsApp links', () => {
  assert.equal(LH.normalizePhone('050 123 4567', 'AE'), '+971501234567');
  assert.equal(LH.normalizePhone('+971 4 123 4567', 'AE'), '+97141234567');
  assert.equal(LH.normalizePhone('00971501234567', 'AE'), '+971501234567');
  assert.equal(LH.normalizePhone('tel:971501234567', 'AE'), '+971501234567');
  assert.equal(LH.whatsappNumber('https://api.whatsapp.com/send?phone=971501234567&text=hi'), '+971501234567');
  assert.equal(LH.whatsappNumber('https://wa.me/971551112233'), '+971551112233');
  const found = LH.phonesInText('Call 04 123 4567 or WhatsApp +971 55 111 2233. Library ID: 1234567890123. Price AED 2024.', 'AE');
  assert.deepEqual(found.sort(), ['+97141234567', '+971551112233']);
  assert.equal(LH.formatPhone('+971501234567'), '+971 50 123 4567');
  assert.ok(LH.isLikelyMobile('+971501234567'));
  assert.ok(!LH.isLikelyMobile('+97141234567'));
});

test('link classification and unwrapping', () => {
  assert.equal(LH.unwrapLink('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.ae%2F&h=x').toString(), 'https://example.ae/');
  assert.equal(LH.linkKind('https://wa.me/971'), 'whatsapp');
  assert.equal(LH.linkKind('https://m.me/shop'), 'messenger');
  assert.equal(LH.linkKind('https://linktr.ee/shop'), 'linkinbio');
  assert.equal(LH.linkKind('https://shop.example.ae/x'), 'website');
  assert.equal(LH.cleanUrl('https://a.ae/p?utm_source=fb&fbclid=1&id=2#x'), 'https://a.ae/p?id=2');
});

const GOOD = `<!doctype html><html lang="en"><head><title>Shine Auto Spa | Ceramic Coating in Dubai</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Ceramic coating, PPF and full detailing in Al Quoz, Dubai. Book online or WhatsApp us today.">
<meta property="og:image" content="/og.jpg"><link rel="icon" href="/f.png"><script>fbq('init','123');</script>
<script type="application/ld+json">{}</script></head><body><h1>Ceramic coating</h1>${'<p>Words about detailing services here. </p>'.repeat(60)}
<a href="tel:+97141234567">Call</a><a href="https://wa.me/971501234567">WhatsApp</a><form></form><a href="mailto:hello@shineautospa.example">Email</a>
<a href="https://www.instagram.com/shineautospa/">IG</a><a href="/contact-us">Contact</a><footer>© 2026 Shine</footer></body></html>`;

const BAD = `<html><head><title>Home</title><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head>
<body><p>Welcome to our garage</p><img src="a.jpg"><img src="b.jpg"><footer>Copyright 2019 Gloss Garage. Call 050 765 4321</footer></body></html>`;

test('audit: a solid site scores high and has no critical issues', () => {
  const r = LH.auditHtml(GOOD, { finalUrl: 'https://shineautospa.example/', ttfbMs: 300, totalMs: 600, bytes: 20000, headers: {} });
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.equal(r.pixel, true);
  assert.ok(!r.issues.some((i) => i.sev === 'critical'));
  const c = LH.extractContacts(GOOD, 'https://shineautospa.example/', 'AE');
  assert.deepEqual(c.phones, ['+97141234567']);
  assert.deepEqual(c.whatsapp, ['+971501234567']);
  assert.deepEqual(c.emails, ['hello@shineautospa.example']);
  assert.equal(c.socials.instagram, 'https://www.instagram.com/shineautospa/');
  assert.deepEqual(c.contactPages, ['https://shineautospa.example/contact-us']);
});

test('audit: a weak site gets pitch-ready issues', () => {
  const r = LH.auditHtml(BAD, { finalUrl: 'http://glossgarage.example/', ttfbMs: 2100, totalMs: 5200, bytes: 9000, headers: {} });
  assert.ok(r.score < 40, `score ${r.score}`);
  const ids = r.issues.map((i) => i.id);
  for (const id of ['https', 'viewport', 'loadTime', 'pixel', 'contactLinks', 'copyright']) assert.ok(ids.includes(id), `missing ${id}`);
  assert.ok(!ids.includes('ttfb'), 'speed issue should be reported once');
  assert.equal(r.issues[0].sev, 'critical');
  assert.equal(r.copyrightYear, 2019);
  assert.match(r.issues.find((i) => i.id === 'copyright').pitch, /© 2019/);
});

test('audit: parked pages are flagged', () => {
  const r = LH.auditHtml('<html><body><h1>This domain is for sale!</h1><p>Buy this domain today.</p></body></html>', { finalUrl: 'https://x.example/', ttfbMs: 100, totalMs: 200, bytes: 300, headers: {} });
  assert.equal(r.parked, true);
  assert.equal(r.issues[0].id, 'parked');
});

test('audit: client-rendered shells are not accused of missing content', () => {
  const r = LH.auditHtml('<html><head><meta name="viewport" content="width=device-width"><title>Shop the best car care products</title></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>', { finalUrl: 'https://spa.example/', ttfbMs: 100, totalMs: 200, bytes: 300, headers: {} });
  const ids = r.issues.map((i) => i.id);
  assert.ok(!ids.includes('contactLinks') && !ids.includes('thin') && !ids.includes('h1'));
});

/* -------------------------------------------------------------- offers */
const S = { ...LH.DEFAULT_SETTINGS, adsCity: 'Dubai' };
const advertiser = (o = {}) => ({ pageName: 'Gloss Garage Dubai', keywords: ['car detailing'], phones: [], emails: [], socials: {}, website: null, ...o });
const prospect = (o = {}) => ({ kind: 'prospect', pageName: 'Glossy PPF', niche: 'Car detailing studios', phones: [], emails: [], socials: {}, sources: { maps: { placeId: 'x', rating: 4.9, reviews: 312 } }, website: 'https://glossyppf.example/', adCheck: { state: 'none' }, ...o });

test('business names read like typed by hand: no keyword tails, legal suffixes or capitals', () => {
  const cases = {
    'Dr. Smile Dental Clinic - Best Dentist in Dubai': 'Dr. Smile Dental Clinic',
    'Glossy PPF | Ceramic Coating | Car Detailing Dubai': 'Glossy PPF',
    'Glossy PPF Studio - Branch 2': 'Glossy PPF Studio',
    'Velvet Laser Lounge (JLT)': 'Velvet Laser Lounge',
    'Spa Lounge · Dubai Marina': 'Spa Lounge',
    'AL NOOR BEAUTY SALON L.L.C': 'Al Noor Beauty Salon',
    'SHINE AUTO SPA DUBAI L.L.C.': 'Shine Auto Spa',
    'BMW CAR CARE FZ-LLC': 'BMW Car Care',
    'PPF STUDIO': 'PPF Studio',
    'Prestige Car Care & Detailing LLC': 'Prestige Car Care & Detailing',
    'Car Care Est.': 'Car Care',
    'Nano Shield UAE': 'Nano Shield',
    'Smile Dental, Dubai': 'Smile Dental',
    'Glossy Dubai': 'Glossy Dubai',
    'Al-Futtaim Auto': 'Al-Futtaim Auto',
    'Mirror Finish JLT': 'Mirror Finish JLT',
    'Shield & Shine': 'Shield & Shine',
    'The Detailing Co': 'The Detailing Co',
    'عيادة الابتسامة': 'عيادة الابتسامة',
    '': '',
  };
  for (const [raw, short] of Object.entries(cases)) assert.equal(LH.shortName(raw), short, raw);
});

/* -------------------------------------------------------------- niches */
test('presets: every kind of business is built in; yours are added, your edits win, the ones you removed stay away', () => {
  const D = LH.DEFAULT_PRESETS.map(LH.cleanPreset);
  assert.ok(D.length >= 40, 'a preset for every common kind of business');
  assert.deepEqual(D.slice(0, 6).map((n) => n.name), ['Car', 'Fitness', 'Pets', 'Accountants', 'Used Cars', 'New openings']);
  assert.equal(new Set(D.map((n) => n.name.toLowerCase())).size, D.length, 'no name twice');
  for (const p of D) {
    assert.ok(p.keywords.length >= 3, `${p.name} has search terms`);
    assert.equal(p.minReviews, 0, `${p.name}: a business that just opened has no reviews yet`);
  }
  assert.deepEqual(LH.nichesFor({}), D);
  assert.deepEqual(LH.nichesFor({ niches: null }), D);
  assert.deepEqual(LH.nichesFor({ niches: [] }), D, 'an empty list means the built in ones');
  assert.deepEqual(LH.nichesFor({ niches: [{ name: 'Car detailing studios', keywords: ['ppf'] }] }), D, 'niches saved before presets had areas are dropped');
  const custom = { niches: [{ name: ' Pet groomers ', label: 'pet groomers', keywords: 'Dog Grooming, pet salon\ncat grooming', exclude: 'vet\n\nvet', minReviews: '3', maxReviews: '', areas: 'JLT, Dubai\nAl Barsha, Dubai' }, { name: '', keywords: ['x'], areas: [] }] };
  const mine = { name: 'Pet groomers', label: 'pet groomers', minReviews: 3, maxReviews: 100000, keywords: ['dog grooming', 'pet salon', 'cat grooming'], exclude: ['vet'], areas: ['JLT, Dubai', 'Al Barsha, Dubai'] };
  assert.deepEqual(LH.nichesFor(custom), [...D, mine], 'yours come after the built in ones');
  // Your copy of a built in kind takes its place; one you removed stays away.
  const edited = LH.nichesFor({ niches: [{ name: 'salons', keywords: ['henna salon'], areas: [] }], hiddenPresets: ['Car', 'used cars'] });
  assert.equal(edited.length, D.length - 2);
  assert.ok(!edited.some((p) => ['Car', 'Used Cars'].includes(p.name)));
  assert.deepEqual(edited.find((p) => p.name.toLowerCase() === 'salons').keywords, ['henna salon']);
  // Areas: a kind's own list, else your shared list, else the built in one.
  assert.ok(LH.DEFAULT_AREAS.length >= 120 && new Set(LH.DEFAULT_AREAS.map((a) => a.toLowerCase())).size === LH.DEFAULT_AREAS.length, 'many areas, none twice');
  assert.deepEqual(LH.presetAreas(mine, {}), ['JLT, Dubai', 'Al Barsha, Dubai']);
  assert.deepEqual(LH.presetAreas(D.find((p) => p.name === 'Salons'), { areas: 'Mirdif, Dubai\n\nJVC, Dubai' }), ['Mirdif, Dubai', 'JVC, Dubai']);
  assert.deepEqual(LH.presetAreas(null, {}), LH.DEFAULT_AREAS);
  assert.ok(LH.OPENING_AD_KEYWORDS.includes('grand opening'));
  assert.equal(LH.nicheOf({ keywords: ['dog grooming'] }, custom), 'Pets', 'a built in kind with that search term comes first');
  assert.equal(LH.nicheOf({ keywords: ['cat grooming at home'] }, { niches: [{ name: 'Cat people', keywords: ['cat grooming at home'], areas: [] }] }), 'Cat people');
  assert.equal(LH.nicheOf({ keywords: ['vat consultant'] }, {}), 'Accountants');
  assert.equal(LH.nicheOf({ keywords: ['ceramic coating dubai'] }, {}), 'Car', 'a longer search term still matches');
  assert.equal(LH.nicheOf({ keywords: ['zeppelin rides'] }, {}), '');
  assert.equal(LH.nicheOf({ niche: 'Yacht charters' }, {}), 'Yacht charters', 'a niche stored on a prospect is kept');
  assert.deepEqual(LH.parseKeywords('a, B\n\nc,a'), ['a', 'b', 'c']);
});

test('old settings keys are dropped', () => {
  const s = LH.withDefaults({ templates: { x: 1 }, adTemplates: {}, adsOffer: 'AED 600', myName: 'Samil', bubbles: 3, scripts: null, intentOpeners: {}, country: 'SA' });
  assert.equal(s.country, 'SA', 'settings that still work are kept');
  for (const k of ['templates', 'adTemplates', 'adsOffer', 'bubbles', 'scripts', 'intentOpeners', 'myName']) assert.ok(!(k in s), k);
  // 2.3: Lead Hunter's own email sender, its texts and your signature are gone.
  const old = LH.withDefaults({ emails: { ads: { body: 'x' } }, emailFromName: 'Samil', emailMaxPerDay: 30, emailFollowups: 2, emailSignature: 's', emailOptOut: 'o', queueSite: 'https://x.example', queueKey: 'k', queueKeyAt: 1, agency: 'A', myPhone: '1', myWebsite: 'w' });
  for (const k of ['emails', 'emailFromName', 'emailMaxPerDay', 'emailFollowups', 'emailSignature', 'emailOptOut', 'queueSite', 'queueKey', 'queueKeyAt', 'agency', 'myPhone', 'myWebsite']) assert.ok(!(k in old), k);
  assert.ok(LH.hasOldSettings({ queueKey: 'k' }));
  assert.ok(LH.hasOldSettings({ bubbles: 3 }));
  assert.ok(LH.hasOldSettings({ adsOffer: '' }));
  assert.ok(!LH.hasOldSettings(s));
  // 3.0: the Meta ads client finder, the heat score, the quality signals and PageSpeed are gone.
  const v2 = LH.withDefaults({ heatWeights: { ads: {} }, heatHot: 70, weakChecks: [], pagespeedKey: 'k', adCheckAll: true, followerMin: 1, targetNiches: ['Car'], igToken: 't', verifyKey: 'q' });
  for (const k of ['heatWeights', 'heatHot', 'weakChecks', 'pagespeedKey', 'adCheckAll', 'followerMin', 'targetNiches']) assert.ok(!(k in v2), k);
  assert.deepEqual([v2.igToken, v2.verifyKey, v2.newDays, v2.verifyDailyCap, v2.emailRisky], ['t', 'q', 120, 100, false], 'what still works is kept, new settings get their defaults');
});

/* ---------------------------------------------------------- tags, results */
test('Instagram handles from where the lead was found or their profile link', () => {
  assert.equal(LH.igHandle({ sources: { instagram: { username: 'glossyppf' } } }), 'glossyppf');
  assert.equal(LH.igHandle({ socials: { instagram: 'https://www.instagram.com/shine.auto_spa/?hl=en' } }), 'shine.auto_spa');
  assert.equal(LH.igHandle({ socials: { instagram: 'https://www.instagram.com/p/C123/' } }), '', 'a post is not a profile');
  assert.equal(LH.igHandle({ socials: {} }), '');
  assert.equal(LH.igFromUrl('https://example.ae/'), '');
});

test('csv escapes formulas but keeps phone numbers', () => {
  const csv = LH.toCsv([
    ['a', '=HYPERLINK("x")', '+971 50 123 4567', 'b,c', 'say "hi"'],
  ]);
  assert.equal(csv, `a,"'=HYPERLINK(""x"")",+971 50 123 4567,"b,c","say ""hi"""`);
});

test('template placeholder emails are never used: GoDaddy filler and the like', () => {
  for (const e of ['filler@godaddy.com', 'info@example.com', 'email@domain.com', 'you@yourdomain.ae', 'name@company.ae', 'abc123@sentry.io', 'x@sentry-next.wixpress.com', 'noreply@clinic.ae', 'logo@2x.png'])
    assert.equal(LH.isJunkEmail(e), true, e);
  for (const e of ['info@glossy.ae', 'hello@shineautospa.example', 'bookings@eyelashsecret.com', 'salon123@gmail.com']) assert.equal(LH.isJunkEmail(e), false, e);
  const html = '<a href="mailto:filler@godaddy.com">Email us</a><p>Write to filler@godaddy.com or book@eyelashsecret.com</p>';
  assert.deepEqual(LH.extractContacts(html, 'https://eyelashsecret.com/', 'AE').emails, ['book@eyelashsecret.com']);
  // Leads saved before this: the placeholder is skipped in the exports.
  const old = prospect({ emails: ['filler@godaddy.com', 'book@eyelashsecret.com'] });
  assert.deepEqual(LH.goodEmails(old), ['book@eyelashsecret.com']);
  assert.deepEqual(LH.goodEmails(prospect({ emails: ['filler@godaddy.com'] })), [], 'only a placeholder: nothing to email');
});

test('presets: exclude words match whole words, "category:" only checks the category', () => {
  const [car, fit, , acc] = LH.presetsFor({});
  assert.equal(LH.excludeHit(car, 'Gloss Garage', 'Car detailing service'), '', 'a studio called Garage stays');
  assert.equal(LH.excludeHit(car, 'Joe Garage', 'Garage'), 'category: garage');
  assert.equal(LH.excludeHit(car, 'Speedy Car Wash & PPF', 'Car detailing service'), 'car wash');
  assert.equal(LH.excludeHit(car, 'Prime Tyres', 'Tire shop'), 'tire');
  assert.equal(LH.excludeHit(acc, 'Key Accounting', 'Accountant'), '', '"EY" is not part of "Key"');
  assert.equal(LH.excludeHit(acc, 'EY Middle East', 'Accountant'), 'EY');
  assert.equal(LH.excludeHit(fit, 'Spartan Gym', 'Gym'), '', '"spa" is not part of "Spartan"');
  assert.equal(LH.excludeHit(fit, 'Barry’s JLT', 'Gym'), "Barry's", 'curly and straight apostrophes match');
  assert.equal(LH.excludeHit(fit, 'GOLD\'S GYM Al Barsha', 'Gym'), "Gold's Gym", 'capitals do not matter');
  assert.equal(LH.looksLikeHours('Opens 10 AM'), true);
  assert.equal(LH.looksLikeHours('Al Wasl Rd'), false);
});

test('the city comes from the lead area', () => {
  assert.equal(LH.cityOf('Al Nahda, Sharjah'), 'Sharjah');
  assert.equal(LH.cityOf('Ras Al Khaimah'), 'Ras Al Khaimah');
  assert.equal(LH.cityOf('Al Quoz', 'Dubai'), 'Dubai', 'older leads keep the setting');
});

test('presets JSON: export and import round trip, bad files explain themselves', () => {
  const list = LH.presetsFor({});
  const back = LH.presetsFromJson(LH.presetsToJson(list));
  assert.deepEqual(back.presets, list);
  assert.equal(back.skipped, 0);
  const mixed = LH.presetsFromJson(JSON.stringify([{ name: 'Yachts', keywords: ['yacht charter'], areas: 'Dubai Marina, Dubai' }, { name: 'No keywords' }]));
  assert.deepEqual([mixed.presets.map((p) => p.name), mixed.presets[0].areas, mixed.skipped], [['Yachts'], ['Dubai Marina, Dubai'], 1]);
  assert.throws(() => LH.presetsFromJson('{oops'), /not valid JSON/);
  assert.throws(() => LH.presetsFromJson('{"a":1}'), /No presets/);
});

test('business names are cleaned before they are compared', () => {
  assert.deepEqual(
    ['Gloss Garage L.L.C - Dubai', 'AL NOOR TRADING EST.', 'Prime FZ-LLC Services', 'Spartan & Co.', 'Spartan and Co', 'Fit Hub FZCO', 'Fit Hub FZE UAE', 'مطعم الريم'].map(LH.normName),
    ['gloss garage', 'al noor', 'prime', 'spartan', 'spartan', 'fit hub', 'fit hub', 'مطعم الريم'],
  );
});

test('Jaro-Winkler: near spellings match at 0.92, different businesses do not', () => {
  assert.equal(LH.jaroWinkler('martha', 'marhta').toFixed(4), '0.9611'); // the textbook value
  assert.equal(LH.jaroWinkler('abc', 'abc'), 1);
  assert.equal(LH.jaroWinkler('', 'abc'), 0);
  assert.ok(LH.jaroWinkler('gloss garage', 'glos garage') >= 0.92);
  assert.ok(LH.jaroWinkler('iron fist boxing', 'iron box') < 0.92);
  assert.ok(LH.jaroWinkler('paws and claws', 'pure pets') < 0.92);
});

test('root domains: subdomains fold, free builders and two part endings stay', () => {
  assert.deepEqual(
    ['https://shop.gloss.ae/x', 'https://www.gloss.co.ae', 'https://book.gloss.co.ae/', 'https://gloss.wixsite.com/home', 'https://other.wixsite.com/', 'http://www.example.com', 'https://my-shop.myshopify.com'].map(LH.rootDomain),
    ['gloss.ae', 'gloss.co.ae', 'gloss.co.ae', 'gloss.wixsite.com', 'other.wixsite.com', 'example.com', 'my-shop.myshopify.com'],
  );
  assert.equal(LH.prospectKeys({ website: 'https://booking.gloss.ae/' }).join(), LH.prospectKeys({ website: 'https://gloss.ae/' }).join());
});

test('fuzzy names only match inside the same area', () => {
  const index = {};
  LH.addName(index, { id: 'a', pageName: 'Gloss Garage LLC', area: 'Al Quoz' });
  LH.addName(index, { id: 'b', pageName: 'Iron Fist Boxing', area: 'JLT' });
  LH.addName(index, { id: 'a', pageName: 'Gloss Garage LLC', area: 'Al Quoz' }); // once
  assert.equal(index['al quoz'].length, 1);
  assert.equal(LH.findByName(index, 'Glos Garage', 'Al Quoz'), 'a');
  assert.equal(LH.findByName(index, 'Gloss Garage', 'JLT'), null);
  assert.equal(LH.findByName(index, 'Iron Box', 'JLT'), null);
  assert.equal(LH.findByName(index, 'Glos Garage', 'Al Quoz', 1), null); // threshold 1: exact names only
  assert.equal(LH.findByName(index, 'Gloss Garage', ''), null);
});

test('contacted memory: keys, hits, and a lead never hides itself', () => {
  const lead = { id: 'p:m:1', pageName: 'Gloss Garage', area: 'JLT', phones: [{ number: '+971501234567' }], website: 'https://www.gloss.ae/', socials: { instagram: 'https://www.instagram.com/Gloss.Dxb/' } };
  assert.deepEqual(LH.historyKeys(lead), ['p:+971501234567', 'd:gloss.ae', 'i:gloss.dxb', 'n:gloss garage@jlt']);
  assert.deepEqual(LH.historyKeys({ website: 'https://linktr.ee/gloss', phones: [] }), []); // a link page is not their website
  assert.deepEqual(LH.historyKeys({ phones: [{ number: '+97147000000', source: 'website' }, { number: '+971557000001', source: 'whatsapp-site' }] }), ['p:+971557000001']);
  const history = { 'p:+971501234567': [1000, 'whatsapp', 'p:m:1', 'Gloss Garage'] };
  assert.equal(LH.historyHit(lead, history), null);
  assert.deepEqual(LH.historyHit({ ...lead, id: 'p:m:2' }, history), { key: 'p:+971501234567', at: 1000, via: 'whatsapp' });
  assert.deepEqual(LH.historyHit({ pageName: 'Gloss Garage LLC', area: 'jlt', phones: ['+97143334444'] }, { 'n:gloss garage@jlt': [5, 'export', 'x', ''] }).via, 'export');
  assert.equal(LH.historyHit(lead, null), null);
  // Tagged only while the lead is still new: a lead you are working stays in view.
  const other = { ...lead, id: 'p:m:2', status: 'new', kind: 'prospect' };
  assert.ok(LH.fitTags(other, { history }).includes('Contacted before'));
  assert.ok(!LH.fitTags({ ...other, status: 'contacted' }, { history }).includes('Contacted before'));
});

test('phone numbers from a contacted sheet or a Google Contacts export', () => {
  const sheet = 'Name,Phone,Notes\nA,050 123 4567,"called, no answer"\nB,"+971 4 333 4444 ::: 055-765-4321",\nC,(04) 222 1111,\nD,not a number,\n';
  assert.deepEqual(LH.phonesInCsv(sheet), ['+971501234567', '+97143334444', '+971557654321', '+97142221111']);
  const google = '﻿Name,Given Name,Group Membership,Phone 1 - Type,Phone 1 - Value\r\nGloss Garage,Gloss Garage,* myContacts ::: LF-2026-10-20,Mobile,+971 56 846 1835\r\n';
  assert.deepEqual(LH.phonesInCsv(google), ['+971568461835']);
  assert.deepEqual(LH.parseCsv('a,"b ""q"" c",d\n\n"multi\nline",x'), [['a', 'b "q" c', 'd'], ['multi\nline', 'x']]);
  assert.deepEqual(LH.phonesInCsv('2026-10-20,LF-2026-10-20'), []); // dates are not phones
});

