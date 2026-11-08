// Unit tests for the shared libraries: `node --test lead-hunter/test/*.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ADS, searchResponse, makeAd } from './fixtures.mjs';

await import('../lib/common.js');
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
  assert.equal(LH.sentScriptFor(prospect({ adCheck: { state: 'running' } })), 'website', 'a skipped lead contacted anyway counts under the website offer');
});

const first = (lead, settings = S) => LH.emailFor(lead, settings).steps[0] || '';
const paras = (lead, settings = S) => first(lead, settings).split('\n\n');

test('the default ads email for a car detailing studio in Dubai', () => {
  const e = LH.emailFor(prospect(), S);
  assert.deepEqual([e.script, e.tag, e.subject], ['ads', 'No Meta ads', 'Quick question for Glossy PPF']);
  const p = paras(prospect());
  assert.equal(p[0], 'Hello Glossy PPF');
  assert.equal(p[1], 'Are you dependent on word of mouth for appointments in Dubai?');
  assert.ok(first(prospect()).includes('We help car detailing and protection studios in Dubai get consistent inquiries through Facebook and Instagram ads.'));
  assert.ok(first(prospect()).includes('\n\nLet me know\n\nSamil\n'), 'closing, then the signature');
});

test('your email edits, and script edits from before 1.12 carried into the first email', () => {
  const custom = { ...S, emails: { ads: { body: 'Hello {{business}}\n\nShort one from {{my_name}}\n\nTalk soon' } } };
  assert.deepEqual(paras(prospect(), custom).slice(0, 3), ['Hello Glossy PPF', 'Short one from Samil', 'Talk soon']);
  // Old WhatsApp script edits become the first email, part by part.
  const old = LH.withDefaults({ myName: 'Samil', scripts: { ads: { closing: 'Talk soon {{my_name}}' }, website: { greeting: '' } }, bubbles: 2 });
  assert.ok(!('scripts' in old) && !('bubbles' in old));
  assert.match(old.emails.ads.body, /^Hello \{\{business\}\}\n\nAre you dependent/);
  assert.ok(old.emails.ads.body.endsWith('\n\nTalk soon {{my_name}}'));
  assert.ok(first(prospect(), old).includes('\n\nTalk soon Samil\n\n'));
  assert.match(old.emails.website.body, /^I came across \{\{business\}\}/, 'an empty greeting is dropped');
  // A body you already edited is not overwritten by old script edits.
  assert.equal(LH.foldScripts({ ads: { body: 'Mine' } }, { ads: { closing: 'x' } }).ads.body, 'Mine');
});

test('website email: found on, niche and subject', () => {
  const ad = LH.emailFor(advertiser({ niche: '' }), S);
  assert.equal(ad.script, 'website');
  const p = paras(advertiser({ niche: '' }));
  assert.equal(p[0], 'Hello Gloss Garage', 'the city at the end of the page name is left out');
  assert.equal(p[1], "I came across Gloss Garage on Facebook and Instagram and couldn't find a website for you.");
  assert.equal(p[2], 'We build simple websites for car detailing and protection studios in Dubai that turn visitors into WhatsApp inquiries.', 'niche from the hunt keyword');
  assert.equal(ad.subject, 'Website for Gloss Garage');
  assert.match(first(prospect({ website: null })), /on Google Maps and/);
  assert.match(first(prospect({ website: null, sources: { instagram: { username: 'glossyppf' } } })), /on Instagram and/);
  assert.match(first(advertiser({ keywords: ['pest control'] })), /websites for businesses in Dubai/, 'no matching niche');
  assert.match(first(advertiser(), { ...S, adsCity: 'Abu Dhabi' }), /studios in Abu Dhabi/);
});

test('website email for a site that is down: "your website wasn\'t loading when I checked"', () => {
  for (const site of [{ state: 'error', status: 500 }, { state: 'ok', parked: true }]) {
    const down = LH.emailFor(advertiser({ website: 'https://gloss.example/', site }), S);
    assert.deepEqual([down.script, down.tag], ['website', 'Site down']);
    assert.match(down.steps[0], /^Hello Gloss Garage\n\nI came across Gloss Garage on Facebook and Instagram and your website wasn't loading when I checked\.\n\nWe build simple websites/);
  }
  assert.equal(LH.scriptVars(advertiser(), S).website_line, "couldn't find a website for you");
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
  const lead = prospect({ pageName: 'Dr. Smile Dental Clinic - Best Dentist in Dubai', niche: 'Dental clinics', website: null });
  assert.deepEqual(paras(lead).slice(0, 2), ['Hello Dr. Smile Dental Clinic', "I came across Dr. Smile Dental Clinic on Google Maps and couldn't find a website for you."]);
  assert.equal(LH.emailFor(lead, S).subject, 'Website for Dr. Smile Dental Clinic');
});

test('a lead with no name: their Instagram handle or domain, else "Hello there" and "your business"', () => {
  assert.deepEqual(paras(advertiser({ pageName: '' })).slice(0, 2), ['Hello there', "I came across your business on Facebook and Instagram and couldn't find a website for you."]);
  assert.equal(LH.emailFor(advertiser({ pageName: '' }), S).subject, 'Your website');
  assert.equal(LH.emailFor(prospect({ pageName: '', website: null }), S).subject, 'Your website');
  assert.equal(LH.emailFor(prospect({ pageName: '' }), S).subject, 'Quick question for glossyppf.example', 'their domain stands in for the name');
  assert.deepEqual(paras(prospect({ pageName: '', website: null, sources: { instagram: { username: 'glossyppf' } } })).slice(0, 2), ['Hello glossyppf', "I came across glossyppf on Instagram and couldn't find a website for you."]);
  assert.match(first(prospect({ pageName: '  ', website: 'https://www.glossyppf.ae/home', site: { state: 'error' } })), /^Hello glossyppf\.ae\n\nI came across glossyppf\.ae on Google Maps and your website wasn't loading/);
  const thanks = { ...S, emails: { website: { body: 'Hello {{business}}\n\nThanks {{business}}' } } };
  assert.match(first(advertiser({ pageName: '' }), thanks), /^Hello there\n\nThanks your business/, 'only the greeting says "there"');
});

test('style: the default emails read like Samil wrote them, with nothing invented', () => {
  for (const [key, t] of Object.entries(LH.DEFAULT_EMAILS)) {
    const raw = [...LH.EMAIL_PARTS.map((p) => t[p]), LH.DEFAULT_SETTINGS.emailOptOut].join('\n');
    assert.doesNotMatch(raw, /[–—;]| - |\d/, `${key} emails: no dashes, semicolons or numbers`);
    assert.doesNotMatch(raw, /google ads/i, `${key}: no Google Ads`);
    assert.doesNotMatch(raw, /\b(our clients|clients like|we've helped|we have helped|case stud|guarantee|results in)\b/i, `${key}: no invented clients or results`);
    const followups = [t.subject, t.followup1, t.followup2, LH.DEFAULT_SETTINGS.emailOptOut].join('\n');
    assert.ok((followups.match(/,/g) || []).length === 0, `${key} follow ups: no commas`);
  }
  assert.ok((LH.DEFAULT_EMAILS.ads.body.match(/,/g) || []).length <= 6, 'at most 6 commas in the ads email');
  // Rendered with missing data, for both offers.
  for (const lead of [{}, { kind: 'prospect', website: 'https://x.example/', adCheck: { state: 'none' } }, { kind: 'prospect' }]) {
    const e = LH.emailFor(lead, { ...LH.DEFAULT_SETTINGS, adsCity: '' });
    for (const b of [e.subject, ...e.steps]) {
      assert.doesNotMatch(b, /\{\{|\}\}|undefined|null|NaN/, b);
      assert.doesNotMatch(b, /[–—;]/, b);
      assert.doesNotMatch(b, / {2}| ,| \./, `no gaps left by missing data: ${JSON.stringify(b)}`);
    }
  }
});

/* -------------------------------------------------------------- emails */
const END = `${S.emailSignature}\n\n${S.emailOptOut}`;
const mailLead = (o = {}) => prospect({ emails: ['hello@glossyppf.example'], ...o });

test('emailFor: the first email, then two follow ups, each signed with the opt out line', () => {
  const e = LH.emailFor(mailLead(), S);
  assert.equal(e.script, 'ads');
  assert.equal(e.tag, 'No Meta ads');
  assert.equal(e.to, 'hello@glossyppf.example');
  assert.equal(e.subject, 'Quick question for Glossy PPF');
  assert.equal(e.steps.length, 3);
  assert.equal(e.steps[0], `${LH.render(LH.DEFAULT_EMAILS.ads.body, LH.scriptVars(mailLead(), S))}\n\n${END}`, 'the first email, then the signature');
  assert.equal(e.steps[1], `Hello Glossy PPF\n\nJust bringing this back to the top of your inbox. Would a quick explanation of how it works be useful?\n\nLet me know\n\n${END}`);
  assert.match(e.steps[2], /^Hello Glossy PPF\n\nI'll leave it here so I don't fill up your inbox\./);
  assert.ok(e.steps[2].endsWith(END));
  assert.match(e.steps[0], /\n\nSamil\nCreative Marketing Director\nRizcoReach · rizcoreach\.ae\n\+971 56 846 1835\n\nIf you'd rather not hear from me just reply no thanks and I won't email again\.$/);
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
  assert.ok(bare.steps[0].endsWith('it works.\n\nLet me know'), 'no signature or opt out line when both are empty');
  const signed = LH.emailFor(mailLead(), { ...S, emailSignature: '{{my_name}}\n{{agency}}', emailOptOut: '' });
  assert.ok(signed.steps[0].endsWith('\n\nSamil\nRizcoReach'), 'the signature takes variables too');
});

test('emailFor: who it goes to', () => {
  assert.equal(LH.emailFor(mailLead({ emails: ['old@x.example', 'new@x.example'], badEmails: ['old@x.example'] }), S).to, 'new@x.example', 'a bounced address is skipped');
  assert.equal(LH.emailFor(mailLead({ badEmails: ['hello@glossyppf.example'] }), S).to, '');
  assert.equal(LH.emailFor(mailLead({ doNotEmail: true }), S).to, '', 'never email');
  const none = LH.emailFor(mailLead({ emails: [] }), S);
  assert.equal(none.to, '');
  assert.equal(none.steps.length, 3, 'still written out, to show what they would get');
});

test('emailFor: the website offer, and a lead with no name', () => {
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
  assert.equal(LH.emailFor({ kind: 'prospect', website: 'https://x.example/', adCheck: { state: 'none' } }, S).subject, 'Quick question for x.example');
  assert.equal(LH.emailFor(prospect({ pageName: '' }), S).subject, 'Quick question for glossyppf.example', 'their domain stands in for the name');
});

test('emailFor: running ads with a working website gives no emails', () => {
  const running = mailLead({ adCheck: { state: 'running' } });
  assert.deepEqual(LH.emailFor(running, S), { script: null, tag: 'Running ads', to: 'hello@glossyppf.example', subject: '', steps: [] });
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
  assert.equal(text('Car detailing & PPF'), 'car detailing and protection studios');
  assert.equal(text('Car detailing studios'), 'car detailing and protection studios');
  assert.equal(text('Aesthetic clinics'), 'aesthetic clinics');
  assert.equal(text('Boutique fitness (Oct–Jan)'), 'gyms and fitness studios');
  assert.equal(text('AC servicing (from late Jan)'), 'AC service companies');
  assert.equal(text(''), 'businesses');
});

test('presets: five defaults, or the list from Settings; website leads get their niche from keywords', () => {
  const D = LH.DEFAULT_PRESETS.map(LH.cleanPreset);
  assert.deepEqual(LH.nichesFor({}).map((n) => n.name), ['Car', 'Fitness', 'Pets', 'Accountants', 'Used Cars']);
  assert.deepEqual(LH.nichesFor({ niches: null }), D);
  assert.deepEqual(LH.nichesFor({ niches: [] }), D, 'an empty list means the defaults');
  assert.deepEqual(LH.nichesFor({ niches: [{ name: 'Car detailing studios', keywords: ['ppf'] }] }), D, 'niches saved before presets had areas give way to the defaults');
  const custom = { niches: [{ name: ' Pet groomers ', label: 'pet groomers', keywords: 'Dog Grooming, pet salon\ncat grooming', exclude: 'vet\n\nvet', minReviews: '3', maxReviews: '', areas: 'JLT, Dubai\nAl Barsha, Dubai' }, { name: '', keywords: ['x'], areas: [] }] };
  assert.deepEqual(LH.nichesFor(custom), [{ name: 'Pet groomers', label: 'pet groomers', minReviews: 3, maxReviews: 100000, keywords: ['dog grooming', 'pet salon', 'cat grooming'], exclude: ['vet'], areas: ['JLT, Dubai', 'Al Barsha, Dubai'] }]);
  assert.equal(LH.nicheOf({ keywords: ['dog grooming'] }, custom), 'Pet groomers');
  assert.equal(LH.scriptVars({ keywords: ['dog grooming'] }, custom).niche, 'pet groomers');
  assert.equal(LH.nicheOf({ keywords: ['vat consultant'] }, {}), 'Accountants');
  assert.equal(LH.nicheOf({ keywords: ['ceramic coating dubai'] }, {}), 'Car', 'a longer search term still matches');
  assert.equal(LH.nicheOf({ keywords: ['pest control'] }, {}), '');
  assert.equal(LH.nicheOf({ niche: 'Yacht charters' }, {}), 'Yacht charters', 'a niche stored on a prospect is kept');
  assert.deepEqual(LH.parseKeywords('a, B\n\nc,a'), ['a', 'b', 'c']);
});

test('old settings keys are dropped', () => {
  const s = LH.withDefaults({ templates: { x: 1 }, adTemplates: {}, adsOffer: 'AED 600', myName: 'Samil', bubbles: 3, scripts: null, intentOpeners: {} });
  assert.equal(s.myName, 'Samil');
  for (const k of ['templates', 'adTemplates', 'adsOffer', 'bubbles', 'scripts', 'intentOpeners']) assert.ok(!(k in s), k);
  assert.ok(LH.hasOldSettings({ bubbles: 3 }));
  assert.ok(LH.hasOldSettings({ adsOffer: '' }));
  assert.ok(!LH.hasOldSettings(s));
});

/* ---------------------------------------------------------- tags, results */
test('tags and priority: running-ads leads sink to the bottom', () => {
  assert.deepEqual(LH.leadTags(prospect()), ['Good reviews']);
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 4.8, reviews: 12 } } })), ['Growing']);
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.6, reviews: 90 } } })), [], 'many reviews, low rating: not growing');
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.5, reviews: 300 } } })), []);
  assert.deepEqual(LH.leadTags(prospect({ sources: { maps: { placeId: 'x', rating: 3.2, reviews: 7 } } })), ['New business'], 'under 10 reviews');
  assert.deepEqual(LH.leadTags(advertiser({ website: 'https://gone.example/', site: { state: 'error' } })), ['Site down'], 'a site that is down');
  assert.deepEqual(LH.leadTags(prospect({ site: { state: 'ok', parked: true } })), ['Site down', 'Good reviews'], 'a parked domain');
  assert.deepEqual(LH.leadTags(prospect({ website: null })), ['No website', 'Good reviews']);
  assert.deepEqual(LH.leadTags(prospect({ adCheck: { state: 'running' } })), ['Running ads', 'Good reviews']);
  assert.deepEqual(LH.leadTags(advertiser({ website: 'https://gloss.example/' })), ['Running ads']);
  assert.deepEqual(LH.leadTags(advertiser({ places: { match: true, rating: 4.5, reviews: 80 } })), ['No website', 'Good reviews']);

  const base = { activeAdCount: 4, earliestStart: Date.now() - 70 * 86400000, phones: [{ number: '+971501234567', source: 'website' }], emails: [], pageLikes: 2000 };
  const noSite = LH.priority({ ...base, website: null });
  const withSite = LH.priority({ ...base, website: 'https://a.example/', site: { state: 'ok', score: 20 } });
  assert.ok(noSite > withSite && withSite <= 10, `${noSite} ${withSite}`);
  assert.ok(LH.priority(prospect({ adCheck: { state: 'running' } })) < LH.priority(prospect({ adCheck: { state: 'pending' }, sources: {} })));
});

test('results: sent, replied and reply rate by niche and by offer, across both tabs', () => {
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
  assert.deepEqual(niche, { Car: [4, 3, '75%'], 'Aesthetic clinics': [1, 1, '100%'], 'No niche': [1, 0, '0%'] });
  const script = Object.fromEntries(r.byScript.map((x) => [x.label, [x.sent, x.replied, x.rate]]));
  assert.deepEqual(script, { 'Ads offer': [3, 2, '67%'], 'Website offer': [2, 2, '100%'], 'Not recorded': [1, 0, '0%'] });
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
    new Date(2026, 9, 26),
  );
  assert.equal(LH.GOOGLE_CONTACTS_HEAD.length, rows[0].length);
  const col = (r, name) => r[LH.GOOGLE_CONTACTS_HEAD.indexOf(name)];
  assert.equal(rows.length, 2, 'a lead with no phone and no email is left out');
  // Google's current layout (contacts.google.com exports these headers today).
  assert.deepEqual(LH.GOOGLE_CONTACTS_HEAD.slice(0, 5), ['First Name', 'Last Name', 'Organization Name', 'Notes', 'Labels']);
  assert.equal(col(rows[0], 'First Name'), 'Glossy PPF');
  assert.equal(col(rows[0], 'Organization Name'), 'Glossy PPF');
  assert.deepEqual([col(rows[0], 'Phone 1 - Label'), col(rows[0], 'Phone 1 - Value')], ['Mobile', '+971501234567'], 'the WhatsApp number comes first');
  assert.deepEqual([col(rows[0], 'Phone 2 - Label'), col(rows[0], 'Phone 2 - Value')], ['Work', '+97142345678']);
  assert.equal(col(rows[0], 'E-mail 1 - Value'), 'hi@glossy.example', 'a bounced email is skipped');
  assert.equal(col(rows[0], 'Website 1 - Value'), 'https://glossyppf.example/');
  // Notes: the heat score, its signals and the top reason. One label per export day.
  assert.match(col(rows[0], 'Notes'), /^Heat \d+ \(ads offer\) · .*Has a WhatsApp mobile · Car · Al Quoz$/);
  assert.equal(col(rows[0], 'Labels'), 'LF-2026-10-26');
  assert.deepEqual([col(rows[1], 'First Name'), col(rows[1], 'Phone 1 - Value'), col(rows[1], 'E-mail 1 - Value')], ['Mail Only', '', 'team@mailonly.example']);
  // Phone numbers stay numbers in the file (no formula guard quote).
  assert.match(LH.toCsv([rows[0]]), /,Mobile,\+971501234567,/);
  // Control and invisible characters (a pasted name, a line break in an address) never reach the file.
  const odd = LH.googleContactsRows([prospect({ pageName: 'Shine\u200b Studio', phones: [{ number: '+971501112222', source: 'google' }], sources: { maps: { address: 'Shop 3\nJLT' } } })], S)[0];
  assert.deepEqual([col(odd, 'First Name'), col(odd, 'Address 1 - Formatted')], ['Shine Studio', 'Shop 3 JLT']);
  // From a real export Google refused: "fancy" bold letters, an emoji, a Google Maps icon glyph, opening hours as the address.
  const real = (pageName, address) => LH.googleContactsRows([prospect({ pageName, phones: [{ number: '+971501112222', source: 'google' }], sources: { maps: { address } } })], S)[0];
  assert.equal(col(real('𝐃𝐢𝐠𝐢𝐜𝐫𝐚𝐟𝐭 𝐈𝐧𝐭𝐞𝐫𝐢𝐨𝐫 𝐃𝐞𝐬𝐢𝐠𝐧', ''), 'First Name'), 'Digicraft Interior Design');
  assert.equal(col(real('AR Tech Interior 🛠️', ''), 'First Name'), 'AR Tech Interior');
  assert.equal(col(real('Gloss', '\ue0c8CPG9+WWQ - Al Falah - Abu Dhabi'), 'Address 1 - Formatted'), 'CPG9+WWQ - Al Falah - Abu Dhabi');
  assert.equal(col(real('Gloss', 'Opens 10\u202fAM'), 'Address 1 - Formatted'), '', 'opening hours are not an address');
  assert.equal(col(real('🛠️', ''), 'First Name'), 'glossyppf.example', 'a name of only emoji falls back to the website');
  assert.deepEqual(['Opens 10\u202fAM', 'Closed', 'Open 24 hours', 'Closes 9 pm', 'Al Wasl Rd', 'Shop 7, Street 10'].map(LH.looksLikeHours), [true, true, true, true, false, false]);
});

test('vCard: the same contacts, escaped, one label, phones first', () => {
  const vcf = LH.contactsVcf(
    [
      prospect({ pageName: 'Glow; Studio, Dubai', phones: [{ number: '+97142345678', source: 'google' }, { number: '+971501234567', source: 'whatsapp-site' }], emails: ['hi@glow.example'], area: 'JLT', sources: { maps: { address: 'Shop 3, JLT; Dubai' } } }),
      prospect({ pageName: 'No Contact Spa', phones: [], emails: [] }),
    ],
    S,
    new Date(2026, 9, 26),
  );
  const cards = vcf.split('END:VCARD\r\n').filter(Boolean);
  assert.equal(cards.length, 1, 'no phone and no email: left out');
  const lines = cards[0].split('\r\n');
  assert.deepEqual(lines.slice(0, 5), ['BEGIN:VCARD', 'VERSION:3.0', 'N:;Glow\\; Studio;;;', 'FN:Glow\\; Studio', 'ORG:Glow\\; Studio']);
  assert.ok(lines.includes('TEL;TYPE=CELL:+971501234567') && lines.includes('TEL;TYPE=WORK:+97142345678'), 'the WhatsApp number as the mobile');
  assert.ok(lines.includes('EMAIL;TYPE=INTERNET,WORK:hi@glow.example'));
  assert.ok(lines.includes('ADR;TYPE=WORK:;;Shop 3\\, JLT\\; Dubai;;;;'));
  assert.ok(lines.includes('CATEGORIES:LF-2026-10-26'));
  assert.ok(lines.some((x) => /^NOTE:Heat \d+ \(ads offer\)/.test(x)));
  assert.ok(vcf.endsWith('\r\n') && !vcf.includes('\n\n'));
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

test('presets: exclude words match whole words, "category:" only checks the category, review range', () => {
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
  assert.ok(LH.reviewsOk(car, 5) && LH.reviewsOk(car, 150) && !LH.reviewsOk(car, 4) && !LH.reviewsOk(car, 151));
  assert.ok(LH.reviewsOk(acc, 0) && LH.reviewsOk(acc, undefined), 'no reviews count as 0');
});

test('phone types: UAE mobile, landline and corporate (600 and 800)', () => {
  assert.equal(LH.phoneType('+971501234567'), 'mobile');
  for (const n of ['+97143334444', '+97126667777', '+97165556666', '+97172223333', '+97192224444', '+97137778888']) assert.equal(LH.phoneType(n), 'landline', n);
  assert.equal(LH.normalizePhone('600 52 2222'), '+971600522222', '600 numbers are UAE numbers');
  assert.equal(LH.phoneType(LH.normalizePhone('600 52 2222')), 'corporate');
  assert.equal(LH.phoneType(LH.normalizePhone('800 4357')), 'corporate');
  assert.equal(LH.phoneType('+447911123456'), '');
  assert.equal(LH.leadPhoneType({ phones: [{ number: '+97143334444' }, { number: '+971559998877' }] }), 'mobile', 'a mobile anywhere wins');
  assert.deepEqual(LH.leadTags({ kind: 'prospect', pageName: 'X', phones: [{ number: '+97143334444' }], website: 'https://x.example/', adCheck: { state: 'none' } }).slice(0, 1), ['Landline']);
});

test('chains: the same name twice, "branch" in the name, or merged Maps listings', () => {
  assert.equal(LH.chainKey('Gloss Garage - JLT Branch'), 'gloss garage');
  assert.equal(LH.chainKey('GLOSS GARAGE Al Quoz Industrial Area 3'), 'gloss garage');
  const leads = [{ pageName: 'Gloss Garage JLT' }, { pageName: 'Gloss Garage Al Quoz' }, { pageName: 'Shine Studio' }];
  const chains = LH.chainNames(leads);
  assert.deepEqual([...chains], ['gloss garage']);
  assert.ok(LH.isChain(leads[0], chains) && !LH.isChain(leads[2], chains));
  assert.ok(LH.isChain({ pageName: 'Fit Box Branch 2' }, new Set()), '"branch" in the name');
  assert.ok(LH.isChain({ pageName: 'Detail Hub', sources: { maps: { otherListings: ['0x1:0x2'] } } }, new Set()), 'two Maps listings merged');
  assert.ok(LH.leadTags({ kind: 'prospect', pageName: 'Gloss Garage JLT', phones: [] }, { chains }).includes('Chain'));
});

test('the email city comes from the lead area', () => {
  assert.equal(LH.cityOf('Al Nahda, Sharjah'), 'Sharjah');
  assert.equal(LH.cityOf('Ras Al Khaimah'), 'Ras Al Khaimah');
  assert.equal(LH.cityOf('Al Quoz', 'Dubai'), 'Dubai', 'older leads keep the setting');
  assert.match(LH.emailFor(prospect({ area: 'Al Nahda, Sharjah', niche: 'Fitness', pageName: 'Iron Box' }), S).steps[0], /We help gyms and fitness studios in Sharjah get consistent inquiries/);
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
  assert.ok(LH.leadTags(other, { history }).includes('Contacted before'));
  assert.ok(!LH.leadTags({ ...other, status: 'contacted' }, { history }).includes('Contacted before'));
});

test('phone numbers from a contacted sheet or a Google Contacts export', () => {
  const sheet = 'Name,Phone,Notes\nA,050 123 4567,"called, no answer"\nB,"+971 4 333 4444 ::: 055-765-4321",\nC,(04) 222 1111,\nD,not a number,\n';
  assert.deepEqual(LH.phonesInCsv(sheet), ['+971501234567', '+97143334444', '+971557654321', '+97142221111']);
  const google = '﻿Name,Given Name,Group Membership,Phone 1 - Type,Phone 1 - Value\r\nGloss Garage,Gloss Garage,* myContacts ::: LF-2026-10-20,Mobile,+971 56 846 1835\r\n';
  assert.deepEqual(LH.phonesInCsv(google), ['+971568461835']);
  assert.deepEqual(LH.parseCsv('a,"b ""q"" c",d\n\n"multi\nline",x'), [['a', 'b "q" c', 'd'], ['multi\nline', 'x']]);
  assert.deepEqual(LH.phonesInCsv('2026-10-20,LF-2026-10-20'), []); // dates are not phones
});

test('ad history: live now, ran before, never, with the newest dates', () => {
  const day = 864e5;
  const t = Date.now();
  const ads = [
    { active: false, start: t - 300 * day, end: t - 200 * day },
    { active: false, start: t - 120 * day, end: t - 45 * day },
  ];
  assert.deepEqual(LH.adHistory(ads), { active: 0, total: 2, lastStart: t - 120 * day, lastEnd: t - 45 * day });
  assert.deepEqual(LH.adVerdict(LH.adHistory(ads)), { state: 'past', activeAds: 0, totalAds: 2, lastAdAt: t - 45 * day });
  const live = LH.adVerdict(LH.adHistory([...ads, { active: true, start: t - 10 * day, end: null }]));
  assert.deepEqual(live, { state: 'running', activeAds: 1, totalAds: 3, lastAdAt: t - 10 * day });
  assert.equal(LH.adVerdict(LH.adHistory([])), null);
  assert.deepEqual(LH.sumHistory([{ active: 0, total: 2, lastStart: 5, lastEnd: 9 }, { active: 1, total: 1, lastStart: 7, lastEnd: null }]), { active: 1, total: 3, lastStart: 7, lastEnd: 9 });
  // Matched pages carry their history.
  const m = LH.matchAds({ pageName: 'Pure Derma Studio', website: 'https://purederma.example/', phones: [] }, [
    { pageId: '1', pageName: 'Pure Derma Studio', links: ['https://purederma.example/laser'], active: false, start: t - 120 * day, end: t - 45 * day },
    { pageId: '2', pageName: 'Someone Else', links: ['https://other.example/'], active: true, start: t },
  ]);
  assert.deepEqual([m.length, m[0].ads, m[0].total, m[0].lastEnd], [1, 0, 1, t - 45 * day]);
});

test('ad status names for every kind of lead', () => {
  const p = (state, extra = {}) => ({ kind: 'prospect', adCheck: { state, ...extra } });
  assert.deepEqual(LH.adStatus(p('past', { lastAdAt: 9, v: 2 })), { status: 'ran_before_inactive_now', sure: true, lastAdAt: 9 });
  assert.deepEqual(LH.adStatus(p('none', { v: 2 })), { status: 'never_ran', sure: true, lastAdAt: null });
  assert.deepEqual(LH.adStatus(p('likely', { v: 2 })), { status: 'never_ran', sure: false, lastAdAt: null });
  // Before 1.8 only live ads were looked at: "no ads" then says nothing about the past. Your own verdict counts.
  assert.deepEqual(LH.adStatus(p('none')), { status: null, sure: false, lastAdAt: null });
  assert.equal(LH.adStatus(p('none', { manual: true })).status, 'never_ran');
  assert.equal(LH.adStatus(p('running')).status, 'active_now');
  assert.equal(LH.adStatus(p('skipped')).status, null);
  // Facebook advertisers: from their own ads.
  assert.deepEqual(LH.adStatus({ kind: 'advertiser', ads: { a: { active: true, start: 5 }, b: { active: false, start: 1, end: 2 } } }), { status: 'active_now', sure: true, lastAdAt: 5 });
  assert.equal(LH.adStatus({ kind: 'advertiser', ads: { b: { active: false, start: 1, end: 2 } } }).status, 'ran_before_inactive_now');
  // Ran before gets the ads script, ahead of never ran.
  const lead = { kind: 'prospect', website: 'https://x.example/', site: { state: 'done', score: 80 }, adCheck: { state: 'past' } };
  assert.deepEqual(LH.scriptFor(lead), { script: 'ads', tag: 'Ran ads before' });
  assert.ok(LH.prospectPriority(lead) > LH.prospectPriority({ ...lead, adCheck: { state: 'none' } }));
});

test('quality: website weakness score, one reason per failed check, the strongest is the top reason', () => {
  const year = new Date().getFullYear();
  const okSite = { state: 'ok', parked: false, https: true, mobile: true, copyrightYear: year, whatsappButton: true, contactForm: false, psi: { performance: 80 }, issues: [] };
  const lead = (site, extra = {}) => ({ kind: 'prospect', website: 'https://gloss.ae/', site, phones: [], socials: {}, sources: {}, ...extra });
  const good = LH.quality(lead(okSite));
  assert.deepEqual([good.website.score, good.weak, good.website.reasons, good.website.unknown], [0, false, [], []]);
  assert.equal(good.website.passed.length, 7);

  const bad = LH.quality(lead({ ...okSite, https: false, mobile: false, copyrightYear: year - 3, whatsappButton: false, psi: { performance: 31 } }, { website: 'https://gloss.wixsite.com/home' }));
  assert.deepEqual(bad.website.reasons.map((r) => [r.id, r.points]), [['no_https', 15], ['slow_mobile', 15], ['no_viewport', 15], ['no_contact', 15], ['free_builder', 15], ['old_copyright', 10]]);
  assert.equal(bad.website.score, 85);
  assert.ok(bad.weak && bad.signals.includes('weak_site'));
  assert.equal(bad.website.reasons.find((r) => r.id === 'slow_mobile').label, 'PageSpeed mobile 31/100 (under 50)');
  assert.equal(bad.website.reasons.find((r) => r.id === 'old_copyright').label, `Copyright still says © ${year - 3}`);
  assert.equal(bad.topReason, 'No HTTPS or an SSL error');

  // Down, parked or an error page is the strongest reason. An SSL error counts as no HTTPS.
  assert.deepEqual(LH.quality(lead({ state: 'error', issues: [{ id: 'httpError', label: 'Website returns an error (404)' }] })).website.reasons.map((r) => r.id), ['site_down']);
  assert.deepEqual(LH.quality(lead({ state: 'ok', parked: true, issues: [] })).website.reasons.map((r) => r.id), ['site_down']);
  assert.deepEqual(LH.quality(lead({ state: 'error', issues: [{ id: 'unreachable', label: 'Website does not load: SSL certificate error' }] })).website.reasons.map((r) => r.id), ['no_https']);
  // Not checked yet: no score, only what the address shows.
  const waiting = LH.quality(lead({ state: 'queued' }, { website: 'https://shop.godaddysites.com/' }));
  assert.deepEqual([waiting.website.score, waiting.website.reasons.map((r) => r.id), waiting.website.unknown.length], [15, ['free_builder'], 6]);
  assert.equal(LH.quality(lead({ state: 'queued' })).website.score, null);
  // No PageSpeed run: the speed check is not counted either way.
  assert.ok(LH.quality(lead({ ...okSite, psi: undefined })).website.unknown.includes('slow_mobile'));
  // Older checks: "no call or WhatsApp" and "no form" together mean no contact.
  const old = { state: 'ok', https: true, mobile: true, issues: [{ id: 'contactLinks' }, { id: 'leadCapture' }] };
  assert.ok(LH.quality(lead(old)).website.reasons.some((r) => r.id === 'no_contact'));
  // Your points from Settings, and the weak site limit.
  const mine = { weakChecks: [{ id: 'no_https', points: 50 }], weakSiteMin: 60 };
  const edited = LH.quality(lead({ ...okSite, https: false }), mine);
  assert.deepEqual([edited.website.score, edited.weak, edited.topReason], [50, false, 'No HTTPS or an SSL error']);
  assert.equal(LH.quality(lead({ ...okSite, https: false }), { ...mine, weakSiteMin: 50 }).weak, true);
});

test('quality: no website, followers band, new business, and the top reason for a good site', () => {
  const q = LH.quality({ kind: 'prospect', website: null, socials: { instagram: 'https://www.instagram.com/gloss.dxb/' }, phones: [], sources: { maps: { placeId: 'x', reviews: 6 } }, igStats: { followers: 2400, from: 'api' } });
  assert.deepEqual([q.website.noSite, q.website.reasons[0].label, q.topReason], [true, 'No website, only Instagram', 'No website, only Instagram']);
  assert.deepEqual([q.followers, q.inBand, q.reviews, q.newBusiness], [2400, true, 6, true]);
  assert.deepEqual(q.signals, ['no_website', 'follower_band', 'new_business']);
  assert.equal(LH.quality({ website: null, socials: {}, phones: [] }).topReason, 'No website');
  // Outside the band, a count from the profile page, an editable band and review limit.
  const page = { kind: 'prospect', website: null, socials: {}, phones: [], sources: { instagram: { username: 'big', followers: '12.5K' }, maps: { placeId: 'y', reviews: 10 } } };
  assert.deepEqual([LH.quality(page).followers, LH.quality(page).inBand, LH.quality(page).newBusiness], [12500, false, false]);
  assert.deepEqual([LH.quality(page, { followerMax: 20000 }).inBand, LH.quality(page, { newBusinessReviews: 11 }).newBusiness], [true, true]);
  assert.deepEqual(['2,345', '1.2M', '840', 'n/a', 77].map(LH.parseCount), [2345, 1200000, 840, null, 77]);
  // A good site: the ad history is the reason.
  const site = { state: 'ok', https: true, mobile: true, whatsappButton: true, contactForm: true, issues: [] };
  assert.equal(LH.quality({ kind: 'prospect', website: 'https://a.ae/', site, phones: [], adCheck: { state: 'past', v: 2 } }).topReason, 'Ran Meta ads before, none live');
  // The tags.
  const tags = LH.leadTags({ kind: 'prospect', website: 'https://a.ae/', site: { ...site, https: false, mobile: false }, phones: [], sources: { maps: { placeId: 'z', reviews: 3 } }, igStats: { followers: 900 }, adCheck: { state: 'none', v: 2 } });
  assert.deepEqual(tags, ['Weak site', 'New business', 'Followers in range']);
});

test('heat score: the ads and website offers, shared bonuses, your weights', () => {
  const now = Date.now();
  const site = { state: 'ok', https: true, mobile: true, whatsappButton: true, contactForm: true, issues: [], score: 90 };
  const ads = {
    kind: 'prospect', niche: 'Car', website: 'https://gloss.ae/', site, adCheck: { state: 'past', v: 2 },
    phones: [{ number: '+971501234567', source: 'google' }], socials: {}, sources: { maps: { placeId: 'x', reviews: 6 } }, igStats: { followers: 2000 },
  };
  const h = LH.heatScore(ads, {}, now);
  assert.equal(h.profile, 'ads');
  assert.deepEqual(h.parts.map((x) => [x.id, x.points]), [['ran_before', 30], ['follower_band', 15], ['new_business', 10], ['target_niche', 10], ['whatsapp_mobile', 10]]);
  assert.equal(h.score, 75);
  assert.equal(LH.heatClass(h.score), 'hot');
  // Never ran, running now (and hidden as skipped), weak site.
  assert.equal(LH.heatScore({ ...ads, adCheck: { state: 'none', v: 2 } }, {}, now).score, 60);
  const running = LH.heatScore({ ...ads, adCheck: { state: 'running', v: 2 } }, {}, now);
  assert.deepEqual([running.parts[0].id, running.score], ['active_now', 20]);
  assert.ok(LH.heatScore({ ...ads, site: { ...site, https: false, mobile: false } }, {}, now).parts.some((x) => x.id === 'weak_site' && x.points === 5));
  // The website offer: no website, new business, running ads, active Instagram.
  const web = { ...ads, website: null, site: null, adCheck: { state: 'running', v: 2 }, igStats: { followers: 300, lastPostAt: now - 5 * 864e5 } };
  const w = LH.heatScore(web, {}, now);
  assert.equal(w.profile, 'website');
  assert.deepEqual(w.parts.map((x) => [x.id, x.points]), [['no_website', 35], ['new_business', 15], ['running_ads', 10], ['active_instagram', 5]]);
  assert.equal(w.score, 65);
  assert.ok(!LH.heatScore({ ...web, igStats: { lastPostAt: now - 60 * 864e5 } }, {}, now).parts.some((x) => x.id === 'active_instagram'), 'last post two months ago');
  // Shared bonuses, capped at 100.
  const intent = LH.heatScore({ ...ads, intent: { at: now - 2 * 864e5 }, hiring: { at: now - 864e5 } }, {}, now);
  assert.deepEqual([intent.parts.slice(-2).map((x) => x.id), intent.score], [['intent_7d', 'hiring_marketing'], 100]);
  assert.ok(!LH.heatScore({ ...ads, intent: { at: now - 9 * 864e5 } }, {}, now).parts.some((x) => x.id === 'intent_7d'), 'older than 7 days');
  // Your weights, thresholds and target niches.
  const mine = { heatWeights: { ads: { ran_before: 50, whatsapp_mobile: 0 } }, heatHot: 90, targetNiches: ['Pets'] };
  const m = LH.heatScore(ads, mine, now);
  assert.deepEqual([m.score, m.parts.map((x) => x.id)], [75, ['ran_before', 'follower_band', 'new_business']]);
  assert.equal(LH.heatClass(m.score, mine), 'warm');
  assert.deepEqual(LH.heatWeightsFor({ heatWeights: { shared: { intent_7d: '' } } }).shared.intent_7d, 50, 'an empty box keeps the default');
});

test('full CSV: every field of the record, one row per lead', () => {
  const lead = {
    id: 'p:m:1', kind: 'prospect', pageName: 'Gloss Garage L.L.C', area: 'Al Barsha, Dubai', niche: 'Car', status: 'contacted', contactedVia: 'whatsapp', contactedAt: Date.UTC(2026, 9, 20),
    createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 21), website: 'https://shop.gloss.ae/', site: { state: 'ok', https: false, mobile: true, issues: [] },
    phones: [{ number: '+971501234567', source: 'google' }, { number: '+97142223333', source: 'website' }], emails: ['hi@gloss.ae'], socials: { instagram: 'https://www.instagram.com/gloss.dxb/' },
    sources: { maps: { placeId: 'x', rating: 4.6, reviews: 8, mapsUrl: 'https://maps.example/x' } }, igStats: { followers: 1500, lastPostAt: Date.UTC(2026, 9, 18) },
    adCheck: { state: 'past', v: 2, lastAdAt: Date.UTC(2026, 6, 1), pageId: '555' }, notes: 'call after 5',
  };
  const [row] = LH.fullCsvRows([lead], {});
  const col = (name) => row[LH.FULL_CSV_HEAD.indexOf(name)];
  assert.equal(row.length, LH.FULL_CSV_HEAD.length);
  assert.deepEqual(
    ['business', 'normalized_name', 'phone_e164', 'all_phones', 'whatsapp_link', 'root_domain', 'instagram_handle', 'instagram_followers', 'instagram_last_post', 'facebook_page_id', 'emirate', 'sources', 'google_reviews', 'ad_status', 'ad_status_certain', 'last_ad_date', 'heat_offer', 'website_weakness', 'contacted_channel', 'contacted_date', 'first_seen', 'notes'].map(col),
    ['Gloss Garage L.L.C', 'gloss garage', '+971501234567', '+971501234567; +97142223333', 'https://wa.me/971501234567', 'gloss.ae', 'gloss.dxb', 1500, '2026-10-18', '555', 'Dubai', 'google_maps', 8, 'ran_before_inactive_now', 'yes', '2026-07-01', 'ads', 15, 'whatsapp', '2026-10-20', '2026-10-01', 'call after 5'],
  );
  assert.match(col('heat_reasons'), /^Ran Meta ads before, none live \+30; Instagram followers in range \+15; New business \+10; One of your target niches \+10; Has a WhatsApp mobile \+10/);
  assert.match(col('signals'), /follower_band/);
  assert.equal(col('top_reason'), 'No HTTPS or an SSL error');
});
