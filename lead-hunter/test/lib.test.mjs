// Unit tests for the shared libraries: `node --test lead-hunter/test/`
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ADS, searchResponse, makeAd } from './fixtures.mjs';

await import('../lib/common.js');
await import('../lib/extract-ads.js');
await import('../lib/site-audit.js');
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

test('priority favours steady advertisers with weak sites and a phone', () => {
  const base = { activeAdCount: 4, earliestStart: Date.now() - 70 * 86400000, phones: [], emails: [], pageLikes: 2000 };
  const weak = { ...base, website: 'https://a.example/', site: { state: 'ok', score: 35 }, phones: [{ number: '+971501234567', source: 'website' }] };
  const strong = { ...base, website: 'https://b.example/', site: { state: 'ok', score: 92 } };
  const brand = { ...weak, pageLikes: 900000 };
  assert.ok(LH.priority(weak) > LH.priority(strong));
  assert.ok(LH.priority(weak) > LH.priority(brand));
  assert.equal(LH.heat(LH.priority(weak)), 'hot');
});

test('pitch picks the right angle and fills variables', () => {
  const lead = {
    pageName: 'Gloss Garage Dubai',
    website: 'http://glossgarage.example/',
    earliestStart: Date.now() - 45 * 86400000,
    activeAdCount: 3,
    keywords: ['car detailing'],
    phones: [],
    site: LH.auditHtml(BAD, { finalUrl: 'http://glossgarage.example/', ttfbMs: 2100, totalMs: 5200, bytes: 9000, headers: {} }),
  };
  const p = LH.pitchFor(lead, { ...LH.DEFAULT_SETTINGS, myName: 'Samil' });
  assert.equal(p.angle, 'weakSite');
  assert.match(p.whatsapp, /^Hi Gloss Garage Dubai team/);
  assert.match(p.whatsapp, /45\+ days/);
  assert.match(p.whatsapp, /glossgarage\.example/);
  assert.match(p.whatsapp, /website-audit\?url=glossgarage\.example/);
  assert.match(p.whatsapp, /Samil, RizcoReach$/);
  assert.doesNotMatch(p.whatsapp + p.email + p.subject, /\{\{|undefined|null/);
  const none = LH.pitchFor({ ...lead, website: null, site: { state: 'none' }, destinationKind: 'whatsapp' }, LH.DEFAULT_SETTINGS);
  assert.equal(none.angle, 'noWebsite');
  assert.match(none.whatsapp, /straight to WhatsApp/);
});

test('csv escapes formulas but keeps phone numbers', () => {
  const csv = LH.toCsv([
    ['a', '=HYPERLINK("x")', '+971 50 123 4567', 'b,c', 'say "hi"'],
  ]);
  assert.equal(csv, `a,"'=HYPERLINK(""x"")",+971 50 123 4567,"b,c","say ""hi"""`);
});
