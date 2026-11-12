// Unit tests for businesses found on Google Maps and Instagram: `node --test lead-hunter/test/*.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/emails.js');
await import('../lib/fit.js');
await import('../lib/prospects.js');
const LH = globalThis.LH;

const prospect = (o) => ({ kind: 'prospect', pageName: o.name, website: o.website || null, phones: (o.phones || []).map((n) => ({ number: n, source: 'google' })), countries: ['AE'], sources: o.sources || {}, keywords: [], emails: [], ...o.extra });

test('nameMatch treats plurals and company suffixes as the same name', () => {
  assert.ok(LH.nameMatch('Glow Aesthetics Clinic LLC', 'Glow Aesthetic Clinic') >= 0.85);
  assert.ok(LH.nameMatch('Glow', 'Glow Aesthetic Clinic') < 0.85, 'a one-word name alone is not enough');
});

test('prospectKeys de-duplicate across Maps, domain and phone', () => {
  const keys = LH.prospectKeys({ maps: { placeId: 'ChIJ1' }, website: 'https://www.glow.example/x', phones: ['+971501234567'] });
  assert.deepEqual(keys, ['m:ChIJ1', 'd:glow.example', 'p:+971501234567']);
  assert.deepEqual(LH.prospectKeys({ maps: { placeId: 'x' }, website: 'https://instagram.com/glow' }), ['m:x'], 'social links are not websites');
});

test('a business from Google Maps: the cold email row says Google Maps, and what its ads do no longer matters', () => {
  const settings = { ...LH.DEFAULT_SETTINGS };
  const p = prospect({ name: 'Shine PPF', website: 'https://shine.example/', phones: ['+971501234567'], sources: { maps: { placeId: 'x', reviews: 120, rating: 4.7 } }, extra: { niche: 'Car detailing & PPF', status: 'new' } });
  // No website, Google says they just opened, found on Google Maps: in the cold email file, and it says so.
  const r = LH.coldEmailExport([{ ...p, id: 'p1', website: null, emails: ['hi@shine.example'], emailCheck: { 'hi@shine.example': { s: 'dns' } }, openSignals: [{ kind: 'google', text: 'Recently opened', at: Date.now() }], adCheck: { state: 'running' } }], settings);
  const col = (name) => r.rows[0][LH.COLD_EMAIL_HEAD.indexOf(name)];
  assert.deepEqual([col('business_name'), col('email'), col('website'), col('source'), col('niche'), col('status')], ['Shine PPF', 'hi@shine.example', '', 'Google Maps', 'Car', 'New']);
});

test('a website Google Maps lists that is really an Instagram profile is not a website', () => {
  assert.equal(LH.linkKind('https://www.instagram.com/glossyppf/'), 'instagram');
  assert.equal(LH.igFromUrl(LH.unwrapLink('https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fglossyppf%2F')), 'glossyppf');
  assert.deepEqual(LH.prospectKeys({ maps: { placeId: 'x' }, website: 'https://www.instagram.com/glossyppf/' }), ['m:x']);
});

