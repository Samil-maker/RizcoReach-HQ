// Unit tests for the shared libraries: `node --test lead-hunter/test/*.test.mjs`
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

test('priority favours steady advertisers without a website, with a phone, that are not big brands', () => {
  const base = { activeAdCount: 6, earliestStart: Date.now() - 70 * 86400000, phones: [], emails: [], pageLikes: 2000, website: null };
  const phone = { ...base, phones: [{ number: '+971501234567', source: 'whatsapp-ad' }] };
  const brand = { ...phone, pageLikes: 900000 };
  assert.ok(LH.priority(phone) > LH.priority(base));
  assert.ok(LH.priority(phone) > LH.priority(brand));
  assert.equal(LH.heat(LH.priority(phone)), 'hot');
});

/* ------------------------------------------------------------- scripts */
const S = { ...LH.DEFAULT_SETTINGS, myName: 'Samil', adsCity: 'Dubai' };
const advertiser = (o = {}) => ({ pageName: 'Gloss Garage Dubai', keywords: ['car detailing'], phones: [], emails: [], socials: {}, website: null, ...o });
const prospect = (o = {}) => ({ kind: 'prospect', pageName: 'Glossy PPF', niche: 'Car detailing studios', phones: [], emails: [], socials: {}, sources: { maps: { placeId: 'x', rating: 4.9, reviews: 312 } }, website: 'https://glossyppf.example/', adCheck: { state: 'none' }, ...o });

test('scriptFor: website script without a website, ads script without Meta ads, skipped when running ads', () => {
  const pick = (l) => [LH.scriptFor(l).script, LH.scriptFor(l).tag];
  // Website leads (Ad Library): they advertise by definition.
  assert.deepEqual(pick(advertiser()), ['website', 'No website']);
  assert.deepEqual(pick(advertiser({ website: 'https://gloss.example/' })), [null, 'Running ads']);
  // Meta ads prospects without a website get the website script whatever the ad check says.
  for (const state of ['none', 'likely', 'running', 'pending', 'unclear']) assert.deepEqual(pick(prospect({ website: null, adCheck: { state } })), ['website', 'No website'], state);
  // With a website: the ad check decides.
  assert.deepEqual(pick(prospect({ adCheck: { state: 'none' } })), ['ads', 'No Meta ads']);
  assert.deepEqual(pick(prospect({ adCheck: { state: 'likely' } })), ['ads', 'No Meta ads']);
  for (const adCheck of [{ state: 'pending' }, { state: 'queued' }, { state: 'checking' }, { state: 'unclear' }, undefined]) assert.deepEqual(pick(prospect({ adCheck })), ['ads', 'Ad check not done'], JSON.stringify(adCheck));
  assert.deepEqual(pick(prospect({ adCheck: { state: 'running' } })), [null, 'Running ads']);
  assert.deepEqual(pick(prospect({ adCheck: { state: 'running', manual: true } })), [null, 'Running ads'], '"They do run ads" skips them too');
  // A website that is down or parked counts as no working website, in both tabs.
  for (const site of [{ state: 'error' }, { state: 'ok', parked: true }]) {
    assert.deepEqual(pick(advertiser({ website: 'https://gone.example/', site })), ['website', 'Site down'], JSON.stringify(site));
    assert.deepEqual(pick(prospect({ adCheck: { state: 'running' }, site })), ['website', 'Site down'], JSON.stringify(site));
    assert.deepEqual(pick(prospect({ adCheck: { state: 'none' }, site })), ['website', 'Site down'], JSON.stringify(site));
  }
  assert.deepEqual(pick(advertiser({ website: 'https://gloss.example/', site: { state: 'blocked' } })), [null, 'Running ads'], 'a site that blocks the check is still a website');
  assert.equal(LH.sentScriptFor(prospect({ adCheck: { state: 'running' } })), 'website', 'pitching a skipped lead anyway uses the website script');
});

test('the default ads script for a car detailing studio in Dubai, in 3 bubbles', () => {
  const p = LH.pitchFor(prospect(), S);
  assert.equal(p.script, 'ads');
  assert.equal(p.tag, 'No Meta ads');
  assert.equal(p.bubbles.length, 3);
  assert.equal(p.bubbles[0], 'Hello Glossy PPF');
  assert.equal(p.bubbles[2], 'Let me know');
  assert.ok(p.bubbles[1].includes('We help car detailing studios in Dubai get consistent inquiries through Facebook and Instagram ads.'), p.bubbles[1]);
  assert.match(p.bubbles[1], /^Are you dependent on word of mouth for appointments in Dubai\?/);
  assert.equal(p.text, p.bubbles.join('\n\n'));
  assert.equal(p.subject, 'Quick question for Glossy PPF');
  assert.equal(p.email, `${p.text}\n\n${S.emailSignature}\n\n${S.emailOptOut}`, 'the email is the whole script, signed');
});

test('bubbles: 2 joins greeting and body, empty parts are dropped, skipped leads get none', () => {
  const two = LH.pitchFor(prospect(), { ...S, bubbles: 2 });
  assert.equal(two.bubbles.length, 2);
  assert.match(two.bubbles[0], /^Hello Glossy PPF\n\nAre you dependent/);
  assert.equal(two.bubbles[1], 'Let me know');
  const three = LH.pitchFor(prospect(), S);
  assert.equal(two.text, three.text, 'same words either way');

  const noGreeting = LH.pitchFor(prospect(), { ...S, scripts: { ads: { greeting: '' } } });
  assert.equal(noGreeting.bubbles.length, 2);
  assert.match(noGreeting.bubbles[0], /^Are you dependent/);
  assert.equal(LH.pitchFor(prospect(), { ...S, bubbles: 2, scripts: { ads: { greeting: '', closing: '  ' } } }).bubbles.length, 1);

  const custom = LH.pitchFor(prospect(), { ...S, scripts: { ads: { closing: 'Talk soon {{my_name}}' } } });
  assert.equal(custom.bubbles[2], 'Talk soon Samil', 'edited parts replace the default, the rest stays');
  assert.match(custom.bubbles[1], /We help car detailing studios/);

  const skipped = LH.pitchFor(prospect({ adCheck: { state: 'running' } }), S);
  assert.equal(skipped.script, null);
  assert.deepEqual(skipped.bubbles, []);
  assert.equal(skipped.text, '');
  const anyway = LH.pitchFor(prospect({ adCheck: { state: 'running' } }), S, 'website');
  assert.equal(anyway.script, 'website');
  assert.equal(anyway.bubbles.length, 3);
});

test('website script: found on, niche and subject', () => {
  const ad = LH.pitchFor(advertiser({ niche: '' }), S);
  assert.equal(ad.script, 'website');
  assert.equal(ad.bubbles[0], 'Hello Gloss Garage', 'the city at the end of the page name is left out');
  assert.match(ad.bubbles[1], /^I came across Gloss Garage on Facebook and Instagram and couldn't find a website for you\./);
  assert.match(ad.bubbles[1], /We build simple websites for car detailing studios in Dubai that turn visitors into WhatsApp inquiries\./, 'niche from the hunt keyword');
  assert.equal(ad.subject, 'Website for Gloss Garage');
  assert.match(LH.pitchFor(prospect({ website: null }), S).bubbles[1], /on Google Maps and/);
  assert.match(LH.pitchFor(prospect({ website: null, sources: { instagram: { username: 'glossyppf' } } }), S).bubbles[1], /on Instagram and/);
  assert.match(LH.pitchFor(advertiser({ keywords: ['pest control'] }), S).bubbles[1], /websites for businesses in Dubai/, 'no matching niche');
  assert.match(LH.pitchFor(advertiser(), { ...S, adsCity: 'Abu Dhabi' }).bubbles[1], /studios in Abu Dhabi/);
});

test('website script for a site that is down: "your website wasn\'t loading when I checked"', () => {
  assert.equal(
    LH.DEFAULT_SCRIPTS.website.body,
    "I came across {{business}} on {{found_on}} and {{website_line}}.\n\nWe build simple websites for {{niche}} in {{city}} that turn visitors into WhatsApp inquiries.\n\nIf this sounds interesting I'd be happy to send you a free mockup of how yours could look.",
  );
  for (const site of [{ state: 'error', status: 500 }, { state: 'ok', parked: true }]) {
    const down = LH.pitchFor(advertiser({ website: 'https://gloss.example/', site }), S);
    assert.equal(down.script, 'website');
    assert.equal(down.tag, 'Site down');
    assert.match(down.bubbles[1], /^I came across Gloss Garage on Facebook and Instagram and your website wasn't loading when I checked\.\n\nWe build simple websites/);
  }
  assert.equal(LH.scriptVars(advertiser(), S).website_line, "couldn't find a website for you");
  // Pitched anyway with a working website: the line still says no website (the drawer warns about it).
  assert.match(LH.pitchFor(advertiser({ website: 'https://gloss.example/', site: { state: 'ok', score: 70 } }), S, 'website').bubbles[1], /and couldn't find a website for you\./);
});

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
  const p = LH.pitchFor(prospect({ pageName: 'Dr. Smile Dental Clinic - Best Dentist in Dubai', niche: 'Dental clinics', website: null }), S);
  assert.equal(p.bubbles[0], 'Hello Dr. Smile Dental Clinic');
  assert.match(p.bubbles[1], /^I came across Dr\. Smile Dental Clinic on Google Maps and/);
  assert.equal(p.subject, 'Website for Dr. Smile Dental Clinic');
});

test('a lead with no name: their Instagram handle or domain, else "Hello there" and "your business"', () => {
  const p = LH.pitchFor(advertiser({ pageName: '' }), S);
  assert.equal(p.bubbles[0], 'Hello there');
  assert.match(p.bubbles[1], /^I came across your business on Facebook and Instagram and couldn't find a website for you\./);
  assert.equal(p.subject, 'Your website');
  assert.equal(LH.pitchFor(prospect({ pageName: '', website: null }), S).subject, 'Your website');
  assert.equal(LH.pitchFor(prospect({ pageName: '' }), S).subject, 'Quick question for glossyppf.example', 'their domain stands in for the name');
  const ig = LH.pitchFor(prospect({ pageName: '', website: null, sources: { instagram: { username: 'glossyppf' } } }), S);
  assert.equal(ig.bubbles[0], 'Hello glossyppf');
  assert.match(ig.bubbles[1], /^I came across glossyppf on Instagram and/);
  const site = LH.pitchFor(prospect({ pageName: '  ', website: 'https://www.glossyppf.ae/home', site: { state: 'error' } }), S);
  assert.equal(site.bubbles[0], 'Hello glossyppf.ae');
  assert.match(site.bubbles[1], /^I came across glossyppf\.ae on Google Maps and your website wasn't loading/);
  assert.equal(LH.pitchFor(advertiser({ pageName: '' }), { ...S, scripts: { website: { closing: 'Thanks {{business}}' } } }).bubbles[2], 'Thanks', 'no "there" outside the greeting');
});

test('style: default scripts read like Samil typed them, with nothing invented', () => {
  const empty = [{}, { kind: 'prospect', website: 'https://x.example/', adCheck: { state: 'none' } }, { kind: 'prospect' }];
  for (const [key, t] of Object.entries(LH.DEFAULT_SCRIPTS)) {
    const raw = LH.SCRIPT_PARTS.map((p) => t[p]).join('\n');
    assert.doesNotMatch(raw, /[\u2013\u2014]/, `${key}: no en or em dash`);
    assert.doesNotMatch(raw, / - /, `${key}: no hyphen used as a dash`);
    assert.doesNotMatch(raw, /;/, `${key}: no semicolons`);
    assert.doesNotMatch(raw, /google ads/i, `${key}: no Google Ads`);
    assert.doesNotMatch(raw, /\d/, `${key}: no invented numbers`);
    assert.doesNotMatch(raw, /\b(our clients|clients like|we've helped|we have helped|case stud|guarantee|results in)\b/i, `${key}: no invented clients or results`);
  }
  assert.ok((LH.DEFAULT_SCRIPTS.ads.body.match(/,/g) || []).length <= 6, 'at most 6 commas in the ads body');
  for (const [key, t] of Object.entries(LH.DEFAULT_EMAILS)) {
    const raw = [...LH.EMAIL_PARTS.map((p) => t[p]), LH.DEFAULT_SETTINGS.emailOptOut].join('\n');
    assert.doesNotMatch(raw, /[–—;]| - |\d/, `${key} emails: no dashes, semicolons or numbers`);
    assert.ok((raw.match(/,/g) || []).length === 0, `${key} emails: no commas`);
  }
  // Rendered with missing data, in 3 and 2 bubbles, for both scripts.
  for (const lead of empty)
    for (const bubbles of [3, 2])
      for (const force of [undefined, 'website', 'ads']) {
        const p = LH.pitchFor(lead, { ...LH.DEFAULT_SETTINGS, bubbles, adsCity: '' }, force);
        assert.equal(p.bubbles.length, bubbles);
        for (const b of [...p.bubbles, p.subject, p.email]) {
          assert.doesNotMatch(b, /\{\{|\}\}|undefined|null|NaN/, b);
          assert.doesNotMatch(b, /[\u2013\u2014;]/, b);
          assert.doesNotMatch(b, / {2}| ,| \./, `no gaps left by missing data: ${JSON.stringify(b)}`);
        }
      }
});

/* -------------------------------------------------------------- emails */
const END = `${S.emailSignature}\n\n${S.emailOptOut}`;
const mailLead = (o = {}) => prospect({ emails: ['hello@glossyppf.example'], ...o });

test('emailFor: the script in one email, then two follow ups, each signed with the opt out line', () => {
  const e = LH.emailFor(mailLead(), S);
  const p = LH.pitchFor(mailLead(), S);
  assert.equal(e.script, 'ads');
  assert.equal(e.tag, 'No Meta ads');
  assert.equal(e.to, 'hello@glossyppf.example');
  assert.equal(e.subject, 'Quick question for Glossy PPF');
  assert.equal(e.steps.length, 3);
  assert.equal(e.steps[0], `${p.bubbles.join('\n\n')}\n\n${END}`, 'greeting, body and closing, then the signature');
  assert.equal(e.steps[1], `Hello Glossy PPF\n\nJust bringing this back to the top of your inbox. Would a quick explanation of how it works be useful?\n\nLet me know\n\n${END}`);
  assert.match(e.steps[2], /^Hello Glossy PPF\n\nI'll leave it here so I don't fill up your inbox\./);
  assert.ok(e.steps[2].endsWith(END));
  assert.match(e.steps[0], /\n\nSamil\nCreative Marketing Director\nRizcoReach · rizcoreach\.ae\n\+971 56 846 1835\n\nIf you'd rather not hear from me just reply no thanks and I won't email again\.$/);
  // The manual email tab sends the same first email.
  assert.equal(p.email, e.steps[0]);
  assert.equal(p.subject, e.subject);
  assert.equal(LH.emailFor(mailLead(), { ...S, bubbles: 2 }).steps[0], e.steps[0], 'bubbles only change WhatsApp');
});

test('emailFor: follow up count, edits from Settings and an empty signature', () => {
  for (const n of [0, 1, 2]) assert.equal(LH.emailFor(mailLead(), { ...S, emailFollowups: n }).steps.length, n + 1, `${n} follow ups`);
  assert.equal(LH.emailFor(mailLead(), { ...S, emailFollowups: '1' }).steps.length, 2, 'a select gives a string');
  assert.equal(LH.emailFor(mailLead(), {}).steps.length, 3, 'defaults when settings are missing');
  const edited = LH.emailFor(mailLead(), { ...S, emails: { ads: { subject: 'Hi {{business}} from {{my_name}}', followup2: '  ' } } });
  assert.equal(edited.subject, 'Hi Glossy PPF from Samil');
  assert.equal(edited.steps.length, 2, 'an empty follow up is left out');
  assert.match(edited.steps[1], /^Hello Glossy PPF\n\nJust bringing this back/, 'parts not edited keep the default');
  assert.equal(LH.emailsFor({ emails: { website: { subject: 'Hey' } } }).website.followup1, LH.DEFAULT_EMAILS.website.followup1);
  assert.equal(LH.emailsFor({ emails: { website: { subject: 'Hey' } } }).website.subject, 'Hey');
  const bare = LH.emailFor(mailLead(), { ...S, emailSignature: '', emailOptOut: '' });
  assert.equal(bare.steps[0], LH.pitchFor(mailLead(), S).text, 'no signature or opt out line when both are empty');
  const signed = LH.emailFor(mailLead(), { ...S, emailSignature: '{{my_name}}\n{{agency}}', emailOptOut: '' });
  assert.ok(signed.steps[0].endsWith('\n\nSamil\nRizcoReach'), 'the signature takes variables too');
});

test('emailFor: who it goes to', () => {
  assert.equal(LH.emailFor(mailLead({ emails: ['old@x.example', 'new@x.example'], badEmails: ['old@x.example'] }), S).to, 'new@x.example', 'a bounced address is skipped');
  assert.equal(LH.emailFor(mailLead({ badEmails: ['hello@glossyppf.example'] }), S).to, '');
  assert.equal(LH.emailFor(mailLead({ doNotEmail: true }), S).to, '', 'never email');
  const none = LH.emailFor(mailLead({ emails: [] }), S);
  assert.equal(none.to, '');
  assert.equal(none.steps.length, 3, 'still written out so it can be copied');
});

test('emailFor: website script, and a lead with no name', () => {
  const w = LH.emailFor(advertiser({ emails: ['a@gloss.example'] }), S);
  assert.equal(w.script, 'website');
  assert.equal(w.subject, 'Website for Gloss Garage');
  assert.match(w.steps[0], /^Hello Gloss Garage\n\nI came across Gloss Garage on Facebook and Instagram and couldn't find a website for you\./);
  assert.match(w.steps[0], /\n\nLet me know\n\nSamil\n/);
  assert.match(w.steps[1], /^Hello Gloss Garage\n\nJust bringing this back to the top of your inbox\. Would you like me to send the free mockup\?/);
  assert.match(w.steps[2], /simple website that brings in WhatsApp inquiries/);
  const nameless = LH.emailFor(advertiser({ pageName: '' }), S);
  assert.equal(nameless.subject, 'Your website');
  assert.match(nameless.steps[0], /^Hello there\n\nI came across your business on/);
  assert.match(nameless.steps[1], /^Hello there\n\nJust bringing/);
  assert.equal(LH.emailFor({}, S, 'ads').subject, 'Quick question');
  assert.equal(LH.emailFor(prospect({ pageName: '' }), S).subject, 'Quick question for glossyppf.example', 'their domain stands in for the name');
});

test('emailFor: running ads gives no emails, pitching anyway gives the website emails', () => {
  const running = mailLead({ adCheck: { state: 'running' } });
  assert.deepEqual(LH.emailFor(running, S), { script: null, tag: 'Running ads', to: 'hello@glossyppf.example', subject: '', steps: [] });
  assert.equal(LH.pitchFor(running, S).email, '');
  const anyway = LH.emailFor(running, S, 'website');
  assert.equal(anyway.script, 'website');
  assert.equal(anyway.subject, 'Website for Glossy PPF');
  assert.equal(anyway.steps.length, 3);
});

/* -------------------------------------------------------------- niches */
test('niche names read naturally mid-sentence', () => {
  assert.equal(LH.nicheText('Car detailing studios'), 'car detailing studios');
  assert.equal(LH.nicheText('Aesthetic clinics'), 'aesthetic clinics');
  assert.equal(LH.nicheText('pet groomers'), 'pet groomers');
  assert.equal(LH.nicheText('AC service companies'), 'AC service companies', 'acronyms stay');
  assert.equal(LH.nicheText('PPF STUDIOS'), 'PPF STUDIOS', 'all caps stays');
  assert.equal(LH.nicheText(''), '');
});

test('legacy niche names map to how they read in a message', () => {
  const text = (niche) => LH.scriptVars({ kind: 'prospect', niche }, S).niche;
  assert.equal(text('Car detailing & PPF'), 'car detailing studios');
  assert.equal(text('Aesthetic clinics'), 'aesthetic clinics');
  assert.equal(text('Boutique fitness (Oct–Jan)'), 'fitness studios');
  assert.equal(text('AC servicing (from late Jan)'), 'AC service companies');
  assert.equal(text(''), 'businesses');
});

test('nichesFor: four defaults, or the list from Settings; website leads get their niche from keywords', () => {
  assert.deepEqual(LH.nichesFor({}).map((n) => n.name), ['Car detailing studios', 'Aesthetic clinics', 'Dental clinics', 'Beauty salons']);
  assert.deepEqual(LH.nichesFor({ niches: null }), LH.DEFAULT_NICHES);
  assert.deepEqual(LH.nichesFor({ niches: [] }), LH.DEFAULT_NICHES, 'an empty list means the defaults');
  const custom = { niches: [{ name: ' Pet groomers ', keywords: 'Dog Grooming, pet salon\ncat grooming' }, { name: '', keywords: ['x'] }] };
  assert.deepEqual(LH.nichesFor(custom), [{ name: 'Pet groomers', keywords: ['dog grooming', 'pet salon', 'cat grooming'] }]);
  assert.equal(LH.nicheOf({ keywords: ['dog grooming'] }, custom), 'Pet groomers');
  assert.equal(LH.scriptVars({ keywords: ['dog grooming'] }, custom).niche, 'pet groomers');
  assert.equal(LH.nicheOf({ keywords: ['invisalign'] }, {}), 'Dental clinics');
  assert.equal(LH.nicheOf({ keywords: ['ceramic coating dubai'] }, {}), 'Car detailing studios', 'a longer search term still matches');
  assert.equal(LH.nicheOf({ keywords: ['pest control'] }, {}), '');
  assert.equal(LH.nicheOf({ niche: 'Yacht charters' }, {}), 'Yacht charters', 'a niche stored on a prospect is kept');
  assert.deepEqual(LH.parseKeywords('a, B\n\nc,a'), ['a', 'b', 'c']);
});

test('old settings keys are dropped', () => {
  const s = LH.withDefaults({ templates: { x: 1 }, adTemplates: {}, adsOffer: 'AED 600', myName: 'Samil' });
  assert.equal(s.myName, 'Samil');
  assert.equal(s.bubbles, 3);
  for (const k of ['templates', 'adTemplates', 'adsOffer']) assert.ok(!(k in s), k);
  assert.ok(LH.hasOldSettings({ adsOffer: '' }));
  assert.ok(!LH.hasOldSettings(s));
});

/* ---------------------------------------------------------- tags, results */
test('tags and priority: running-ads leads sink to the bottom', () => {
  assert.deepEqual(LH.leadTags(prospect()), ['Good reviews']);
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 4.8, reviews: 12 } } })), ['Growing']);
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.6, reviews: 90 } } })), [], 'many reviews, low rating: not growing');
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.5, reviews: 300 } } })), []);
  assert.equal(LH.tagLine(prospect({ sources: { maps: { placeId: 'x', rating: 3.5, reviews: 300 } } })), 'No Meta ads');
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.2, reviews: 7 } } })), ['Growing'], 'few reviews');
  assert.deepEqual(LH.leadTags(advertiser({ website: 'https://gone.example/', site: { state: 'error' } })), ['Site down'], 'a site that is down');
  assert.deepEqual(LH.leadTags(prospect({ site: { state: 'ok', parked: true } })), ['Site down', 'Good reviews'], 'a parked domain');
  assert.equal(LH.tagLine(advertiser({ website: 'https://gone.example/', site: { state: 'error' } })), 'Site down');
  assert.deepEqual(LH.leadTags(prospect({ website: null })), ['No website', 'Good reviews']);
  assert.deepEqual(LH.leadTags(prospect({ adCheck: { state: 'running' } })), ['Running ads', 'Good reviews']);
  assert.deepEqual(LH.leadTags(advertiser({ website: 'https://gloss.example/' })), ['Running ads']);
  assert.deepEqual(LH.leadTags(advertiser({ places: { match: true, rating: 4.5, reviews: 80 } })), ['No website', 'Good reviews']);
  assert.equal(LH.tagLine(prospect()), 'No Meta ads · Good reviews');
  assert.equal(LH.tagLine(advertiser()), 'No website');
  assert.equal(LH.tagLine(prospect({ adCheck: { state: 'pending' } })), 'Ad check not done · Good reviews');

  const base = { activeAdCount: 4, earliestStart: Date.now() - 70 * 86400000, phones: [{ number: '+971501234567', source: 'website' }], emails: [], pageLikes: 2000 };
  const noSite = LH.priority({ ...base, website: null });
  const withSite = LH.priority({ ...base, website: 'https://a.example/', site: { state: 'ok', score: 20 } });
  assert.ok(noSite > withSite && withSite <= 10, `${noSite} ${withSite}`);
  assert.ok(LH.priority(prospect({ adCheck: { state: 'running' } })) < LH.priority(prospect({ adCheck: { state: 'pending' }, sources: {} })));
});

test('results: sent, replied and reply rate by niche and by script, across both tabs', () => {
  const day = 86400000;
  const leads = [
    prospect({ contactedAt: 1, sentScript: 'ads', status: 'replied', repliedAt: 2 }),
    prospect({ contactedAt: 1, sentScript: 'ads', status: 'contacted' }),
    prospect({ contactedAt: 1, sentScript: 'website', status: 'meeting', website: null, niche: 'Aesthetic clinics' }),
    prospect({ contactedAt: 1, sentScript: 'ads', status: 'followup', repliedAt: 3, niche: 'Car detailing & PPF' }),
    advertiser({ contactedAt: day, sentScript: 'website', status: 'won' }),
    advertiser({ contactedAt: day, status: 'contacted', keywords: ['pest control'] }),
    advertiser({ status: 'new' }),
    prospect({ status: 'lost' }),
  ];
  const r = LH.results(leads, S);
  assert.deepEqual(r.total, { sent: 6, replied: 4, rate: '67%' });
  const niche = Object.fromEntries(r.byNiche.map((x) => [x.label, [x.sent, x.replied, x.rate]]));
  assert.deepEqual(niche, { 'Car detailing studios': [4, 3, '75%'], 'Aesthetic clinics': [1, 1, '100%'], 'No niche': [1, 0, '0%'] });
  const script = Object.fromEntries(r.byScript.map((x) => [x.label, [x.sent, x.replied, x.rate]]));
  assert.deepEqual(script, { 'Ads script': [3, 2, '67%'], 'Website script': [2, 2, '100%'], 'Not recorded': [1, 0, '0%'] });
  assert.deepEqual(LH.results([advertiser()], S).total, { sent: 0, replied: 0, rate: '–' }, 'a dash when nothing was sent');
});

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

test('Google Contacts file: the business name as the contact, WhatsApp number first, one label, no phone and no email left out', () => {
  const rows = LH.googleContactsRows(
    [
      prospect({ pageName: 'GLOSSY PPF | Ceramic Coating Dubai', phones: [{ number: '+97142345678', source: 'google' }, { number: '+971501234567', source: 'whatsapp-site' }], emails: ['bad@glossy.example', 'hi@glossy.example'], badEmails: ['bad@glossy.example'], area: 'Al Quoz' }),
      prospect({ pageName: 'No Contact Spa', phones: [], emails: [] }),
      prospect({ pageName: 'Mail Only', phones: [], emails: ['team@mailonly.example'], website: null }),
    ],
    S,
  );
  assert.equal(LH.GOOGLE_CONTACTS_HEAD.length, rows[0].length);
  const col = (r, name) => r[LH.GOOGLE_CONTACTS_HEAD.indexOf(name)];
  assert.equal(rows.length, 2, 'a lead with no phone and no email is left out');
  assert.equal(col(rows[0], 'Name'), 'Glossy PPF');
  assert.equal(col(rows[0], 'Organization 1 - Name'), 'Glossy PPF');
  assert.deepEqual([col(rows[0], 'Phone 1 - Type'), col(rows[0], 'Phone 1 - Value')], ['Mobile', '+971501234567'], 'the WhatsApp number comes first');
  assert.deepEqual([col(rows[0], 'Phone 2 - Type'), col(rows[0], 'Phone 2 - Value')], ['Work', '+97142345678']);
  assert.equal(col(rows[0], 'E-mail 1 - Value'), 'hi@glossy.example', 'a bounced email is skipped');
  assert.equal(col(rows[0], 'Website 1 - Value'), 'https://glossyppf.example/');
  assert.match(col(rows[0], 'Notes'), /^RizcoReach lead · Car detailing studios · Al Quoz/);
  assert.equal(col(rows[0], 'Group Membership'), '* myContacts ::: RizcoReach leads');
  assert.deepEqual([col(rows[1], 'Name'), col(rows[1], 'Phone 1 - Value'), col(rows[1], 'E-mail 1 - Value')], ['Mail Only', '', 'team@mailonly.example']);
  // Phone numbers stay numbers in the file (no formula guard quote).
  assert.match(LH.toCsv([rows[0]]), /,Mobile,\+971501234567,/);
});

test('areas: Dubai and Abu Dhabi cover the whole city, no area twice', () => {
  for (const [city, list] of Object.entries(LH.AREAS)) assert.equal(new Set(list).size, list.length, `${city} has no repeats`);
  assert.ok(LH.AREAS.Dubai.length >= 70 && LH.AREAS['Abu Dhabi'].length >= 25);
  assert.deepEqual(LH.AREAS.Dubai.slice(0, 3), ['Downtown Dubai', 'Business Bay', 'DIFC'], 'central areas first');
});

test('template placeholder emails are never used: GoDaddy filler and the like', () => {
  for (const e of ['filler@godaddy.com', 'info@example.com', 'email@domain.com', 'you@yourdomain.ae', 'name@company.ae', 'abc123@sentry.io', 'x@sentry-next.wixpress.com', 'noreply@clinic.ae', 'logo@2x.png'])
    assert.equal(LH.isJunkEmail(e), true, e);
  for (const e of ['info@glossy.ae', 'hello@shineautospa.example', 'bookings@eyelashsecret.com', 'salon123@gmail.com']) assert.equal(LH.isJunkEmail(e), false, e);
  const html = '<a href="mailto:filler@godaddy.com">Email us</a><p>Write to filler@godaddy.com or book@eyelashsecret.com</p>';
  assert.deepEqual(LH.extractContacts(html, 'https://eyelashsecret.com/', 'AE').emails, ['book@eyelashsecret.com']);
  // Leads saved before this: the placeholder is skipped when emailing and in the Google Contacts file.
  const old = mailLead({ emails: ['filler@godaddy.com', 'book@eyelashsecret.com'] });
  assert.equal(LH.emailFor(old, S).to, 'book@eyelashsecret.com');
  assert.equal(LH.emailFor(mailLead({ emails: ['filler@godaddy.com'] }), S).to, '', 'only a placeholder: nothing to email');
  assert.deepEqual(LH.goodEmails(old), ['book@eyelashsecret.com']);
});
