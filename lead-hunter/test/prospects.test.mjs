// Unit tests for Meta-ads prospects: `node --test lead-hunter/test/*.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/prospects.js');
const LH = globalThis.LH;

const ad = (o) => ({ id: String(Math.random()), pageId: o.pageId || '1', pageName: o.pageName, active: true, links: o.links || [], body: o.body || '', caption: o.caption || '', pageUrl: '' });
const prospect = (o) => ({ kind: 'prospect', pageName: o.name, website: o.website || null, phones: (o.phones || []).map((n) => ({ number: n, source: 'google' })), countries: ['AE'], sources: o.sources || {}, adCheck: o.adCheck || { state: 'pending' }, keywords: [], emails: [], ...o.extra });

test('matchAds: website, phone and exact name are evidence; similar names are not', () => {
  const p = prospect({ name: 'Skin Lab Dubai', website: 'https://skinlab.example/', phones: ['+971501112222'] });
  assert.deepEqual(LH.matchAds(p, [ad({ pageName: 'Skin Lab Pharmacy Abu Dhabi' })]), [], 'decoy with a similar name must not match');
  const byDomain = LH.matchAds(p, [ad({ pageId: '7', pageName: 'SL Clinic', links: ['https://skinlab.example/offer?utm_source=fb'] })]);
  assert.equal(byDomain.length, 1);
  assert.deepEqual(byDomain[0].reasons, ['same website']);
  const byCaption = LH.matchAds(p, [ad({ pageId: '8', pageName: 'Other', caption: 'SKINLAB.EXAMPLE' })]);
  assert.deepEqual(byCaption[0].reasons, ['same website']);
  const byPhone = LH.matchAds(p, [ad({ pageId: '9', pageName: 'Promo Page', body: 'Book now on 050 111 2222' })]);
  assert.deepEqual(byPhone[0].reasons, ['same phone number']);
  const byName = LH.matchAds(p, [ad({ pageId: '10', pageName: 'Skin Lab Dubai' })]);
  assert.deepEqual(byName[0].reasons, ['same name']);
});

test('nameMatch treats plurals and company suffixes as the same name', () => {
  assert.ok(LH.nameMatch('Glow Aesthetics Clinic LLC', 'Glow Aesthetic Clinic') >= 0.85);
  assert.ok(LH.nameMatch('Glow', 'Glow Aesthetic Clinic') < 0.85, 'a one-word name alone is not enough');
});

test('prospectKeys de-duplicate across Maps, domain and phone', () => {
  const keys = LH.prospectKeys({ maps: { placeId: 'ChIJ1' }, website: 'https://www.glow.example/x', phones: ['+971501234567'] });
  assert.deepEqual(keys, ['m:ChIJ1', 'd:glow.example', 'p:+971501234567']);
  assert.deepEqual(LH.prospectKeys({ maps: { placeId: 'x' }, website: 'https://instagram.com/glow' }), ['m:x'], 'social links are not websites');
});

test('placeToItem keeps open businesses and normalises phones', () => {
  const item = LH.placeToItem({ id: 'ChIJ9', displayName: { text: 'Shine PPF' }, nationalPhoneNumber: '04 123 4567', websiteUri: 'https://shine.example/', rating: 4.7, userRatingCount: 120, businessStatus: 'OPERATIONAL', primaryTypeDisplayName: { text: 'Car detailing service' } });
  assert.equal(item.name, 'Shine PPF');
  assert.deepEqual(item.phones, ['+97141234567']);
  assert.equal(item.maps.reviews, 120);
  assert.equal(LH.placeToItem({ id: 'z', businessStatus: 'CLOSED_PERMANENTLY' }), null);
});

test('prospect priority: confirmed no-ads > unconfirmed > running', () => {
  const base = { phones: [{ number: '+971501234567', source: 'google' }], website: 'https://x.example/', sources: { maps: { reviews: 150, rating: 4.7 } } };
  const none = LH.prospectPriority(prospect({ name: 'A', extra: { ...base, adCheck: { state: 'none' } } }));
  const likely = LH.prospectPriority(prospect({ name: 'A', extra: { ...base, adCheck: { state: 'likely' } } }));
  const running = LH.prospectPriority(prospect({ name: 'A', extra: { ...base, adCheck: { state: 'running' } } }));
  assert.ok(none > likely && likely > running, `${none} ${likely} ${running}`);
  assert.equal(LH.heat(none), 'hot');
});

test('Meta ads prospects: the script follows the website and the ad check, and claims nothing', () => {
  const settings = { ...LH.DEFAULT_SETTINGS, myName: 'Samil', adsCity: 'Dubai' };
  const p = prospect({ name: 'Shine PPF', website: 'https://shine.example/', phones: ['+971501234567'], sources: { maps: { placeId: 'x', reviews: 120, rating: 4.7 } }, extra: { niche: 'Car detailing & PPF' } });
  for (const state of ['none', 'likely', 'pending', 'unclear', 'running']) {
    for (const lead of [{ ...p, adCheck: { state } }, { ...p, website: null, adCheck: { state } }]) {
      const pitch = LH.pitchFor(lead, settings);
      const all = [...pitch.bubbles, pitch.subject, pitch.email].join('\n');
      assert.doesNotMatch(all, /\{\{|undefined|null/);
      assert.doesNotMatch(all, /\b(our team|our clients|clients like|we've helped)\b|★|\d/i, `nothing invented (${state})`);
      assert.doesNotMatch(all, /&|ppf businesses/i, 'niche reads naturally');
    }
  }
  const none = LH.pitchFor({ ...p, adCheck: { state: 'none' } }, settings);
  assert.equal(none.script, 'ads');
  assert.match(none.bubbles[1], /We help car detailing studios in Dubai/);
  assert.equal(LH.pitchFor({ ...p, adCheck: { state: 'unclear' } }, settings).tag, 'Ad check not done');
  assert.equal(LH.pitchFor({ ...p, adCheck: { state: 'running' } }, settings).script, null, 'running ads with a website: skipped');
  const noSite = LH.pitchFor({ ...p, website: null, adCheck: { state: 'running' } }, settings);
  assert.equal(noSite.script, 'website');
  assert.match(noSite.bubbles[1], /^I came across Shine PPF on Google Maps and couldn't find a website for you\./);
});

test('a website Google Maps lists that is really an Instagram profile is not a website', () => {
  assert.equal(LH.linkKind('https://www.instagram.com/glossyppf/'), 'instagram');
  assert.equal(LH.igFromUrl(LH.unwrapLink('https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fglossyppf%2F')), 'glossyppf');
  assert.deepEqual(LH.prospectKeys({ maps: { placeId: 'x' }, website: 'https://www.instagram.com/glossyppf/' }), ['m:x']);
});

test('avoid list catches long-cycle and restricted businesses', () => {
  for (const s of ['Elite Renovation LLC', 'Mounjaro weight loss clinic', 'Hair Transplant Center', 'Mobile Car Wash Dubai', 'شركة مقاولات']) assert.ok(LH.AVOID_WORDS.test(s), s);
  for (const s of ['Shine PPF Studio', 'Glow Aesthetic Clinic', 'Reformer Pilates JLT']) assert.ok(!LH.AVOID_WORDS.test(s), s);
});
