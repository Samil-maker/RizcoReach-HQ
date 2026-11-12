// Export for cold email: the file the cold email system (cold-email/ in this repo) imports from its RizcoReach Leads
// folder, and where the emails in it come from.
//   node --test lead-hunter/test/cold-email.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/emails.js');
await import('../lib/site-audit.js');
await import('../lib/prospects.js');
const LH = globalThis.LH;

const S = { ...LH.DEFAULT_SETTINGS };
const GOOD_SITE = { state: 'ok', https: true, mobile: true, score: 88, copyrightYear: new Date().getFullYear(), whatsappButton: true, contactForm: true };
let n = 0;
/** A Google Maps business with an email and no website. */
const lead = (o = {}) => ({ id: `l${++n}`, kind: 'prospect', pageName: 'Glossy PPF', status: 'new', phones: [{ number: '+971501234567', source: 'google' }], emails: ['hi@glossy.example'], socials: {}, sources: { maps: { placeId: `p${n}`, rating: 4.8, reviews: 40 } }, website: null, area: 'Al Quoz, Dubai', niche: 'Car', ...o });
/** A website lead (Ad Library advertiser). */
const advertiser = (o = {}) => ({ id: `a${++n}`, pageId: `10000${n}`, pageName: 'Gloss Garage', status: 'new', phones: [], emails: ['team@gloss.example'], socials: {}, website: null, keywords: ['car detailing'], ...o });
const exp = (leads, opts) => LH.coldEmailExport(leads, S, opts);
const col = (row, name) => row[LH.COLD_EMAIL_HEAD.indexOf(name)];

test('columns: exactly these, in this order, and the file name', () => {
  assert.deepEqual(LH.COLD_EMAIL_HEAD, ['business_name', 'first_name', 'email', 'website', 'instagram', 'phone', 'niche', 'area', 'source', 'notes', 'status']);
  const r = exp([lead({ pageName: 'GLOSSY PPF L.L.C | Ceramic Coating Dubai', website: 'https://glossyppf.example/', site: { state: 'error' }, socials: { instagram: 'https://www.instagram.com/glossyppf/' }, phones: [{ number: '+97143334444', source: 'google' }, { number: '+971559998877', source: 'whatsapp-site' }] })]);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.length, LH.COLD_EMAIL_HEAD.length);
  assert.deepEqual(
    Object.fromEntries(LH.COLD_EMAIL_HEAD.map((h) => [h, col(row, h)])),
    { business_name: 'Glossy PPF', first_name: '', email: 'hi@glossy.example', website: 'https://glossyppf.example/', instagram: 'glossyppf', phone: '+971559998877', niche: 'Car', area: 'Al Quoz, Dubai', source: 'Google Maps', notes: '', status: 'New' },
  );
  assert.equal(LH.coldEmailFilename(new Date(2026, 10, 8)), 'rizcoreach-cold-email-2026-11-08.csv');
  // A real CSV: header first, commas quoted.
  const csv = LH.toCsv([r.head, ...r.rows]).split('\r\n');
  assert.equal(csv[0], 'business_name,first_name,email,website,instagram,phone,niche,area,source,notes,status');
  assert.match(csv[1], /^Glossy PPF,,hi@glossy\.example,https:\/\/glossyppf\.example\/,glossyppf,\+971559998877,Car,"Al Quoz, Dubai",Google Maps,,New$/);
});

test('in: no website, down or parked, or a site the check flagged; unsure counts as in', () => {
  const site = (s) => lead({ website: 'https://x.example/', site: { ...GOOD_SITE, ...s } });
  const cases = {
    'no website': lead(),
    'only an Instagram as the website': lead({ website: 'https://www.instagram.com/glossyppf/' }),
    'down': lead({ website: 'https://x.example/', site: { state: 'error' } }),
    'parked': site({ parked: true }),
    'no HTTPS': site({ https: false }),
    'not mobile friendly': site({ mobile: false }),
    'old footer year': site({ copyrightYear: 2019 }),
    'slow (PageSpeed)': site({ psi: { performance: 31 } }),
    'no contact button': site({ whatsappButton: false, contactForm: false }),
    'low score': site({ score: 62 }),
    'free builder address': lead({ website: 'https://glossy.wixsite.com/home', site: GOOD_SITE }),
    'not checked yet': lead({ website: 'https://x.example/', site: { state: 'queued' } }),
    'blocked the check': lead({ website: 'https://x.example/', site: { state: 'blocked' } }),
  };
  for (const [why, l] of Object.entries(cases)) assert.equal(exp([l]).rows.length, 1, why);
  assert.equal(LH.coldEmailSite(cases.down, S), 'down');
  assert.equal(LH.coldEmailSite(cases['no website'], S), 'none');
  assert.equal(LH.coldEmailSite(cases['not checked yet'], S), 'unknown');
  assert.equal(LH.coldEmailSite(cases['old footer year'], S), 'flagged');
});

test('out: a clearly good site, closed statuses, the old email queue, exported before, never email', () => {
  const good = lead({ website: 'https://good.example/', site: GOOD_SITE });
  assert.equal(LH.coldEmailSite(good, S), 'good');
  const closed = ['replied', 'meeting', 'won', 'lost', 'skip'].map((status) => lead({ status }));
  const queued = [{ state: 'done', sent: 3 }, { state: 'active', sent: 1 }, { state: 'replied', sent: 1 }].map((emailQueue) => lead({ emailQueue }));
  const exported = lead({ coldEmailExportedAt: Date.now() - 864e5 });
  const never = lead({ doNotEmail: true });
  const r = exp([good, ...closed, ...queued, exported, never]);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.skipped, { closed: 6, emailedBefore: 3, exported: 1, goodSite: 1, noEmail: 0 });
  // Include already exported: they go in again. A queue entry that never sent anything is not "emailed": the old
  // sender is gone, so it never will be.
  assert.equal(exp([exported], { includeExported: true }).rows.length, 1);
  for (const state of ['cancelled', 'queued']) assert.equal(exp([lead({ emailQueue: { state, sent: 0 } })]).rows.length, 1, state);
  // Still talking to them by another channel, or following up: in, with their status.
  const open = exp(['new', 'contacted', 'followup'].map((status) => lead({ status })));
  assert.deepEqual(open.rows.map((row) => col(row, 'status')), ['New', 'Contacted', 'Follow up']);
});

test('source: where we actually saw them', () => {
  const src = (l) => col(exp([l]).rows[0], 'source');
  assert.equal(src(lead()), 'Google Maps');
  assert.equal(src(lead({ socials: { instagram: 'https://www.instagram.com/glossyppf/' } })), 'Google Maps', 'found on Maps, Instagram known too');
  assert.equal(src(lead({ sources: { instagram: { username: 'glossyppf' } } })), 'Instagram', 'saved from Instagram');
  assert.equal(src(advertiser()), 'Facebook', 'Ad Library, Instagram not known');
  assert.equal(src(advertiser({ socials: { instagram: 'https://instagram.com/glossgarage' } })), 'Instagram', 'Ad Library, their Instagram known');
  assert.ok(exp([lead(), advertiser()]).rows.every((row) => ['Google Maps', 'Instagram', 'Facebook'].includes(col(row, 'source'))));
});

test('notes: "new business" only when you ticked Just opened, never from few reviews', () => {
  assert.equal(col(exp([lead({ justOpened: true })]).rows[0], 'notes'), 'new business');
  const fresh = lead({ sources: { maps: { placeId: 'new1', rating: 5, reviews: 2 } } });
  assert.equal(LH.quality(fresh, S).newBusiness, true, 'Lead Hunter calls it a new business');
  assert.equal(col(exp([fresh]).rows[0], 'notes'), '', 'but the file only says so when you ticked it');
  assert.ok(LH.leadTags(lead({ justOpened: true })).includes('Just opened'));
});

test('no usable email: left out and counted', () => {
  const r = exp([lead({ emails: [] }), lead({ emails: ['filler@godaddy.com'] }), lead({ emails: ['old@x.example'], badEmails: ['old@x.example'] }), lead({ emails: ['old@x.example', 'new@x.example'], badEmails: ['old@x.example'] })]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.noEmail, 3);
  assert.equal(col(r.rows[0], 'email'), 'new@x.example', 'a bounced address is skipped, the next one used');
  // Every row of any file has an email.
  assert.ok(exp([lead(), advertiser(), lead({ emails: [] })]).rows.every((row) => col(row, 'email')));
});

test('website: their own site only, never a social, link page, WhatsApp or Maps address', () => {
  for (const w of ['https://www.facebook.com/glossy', 'https://www.instagram.com/glossy/', 'https://linktr.ee/glossy', 'https://maps.app.goo.gl/abc', 'https://www.google.com/maps/place/x', 'https://wa.me/971501234567']) {
    const row = exp([lead({ website: w })]).rows[0];
    assert.equal(col(row, 'website'), '', w);
  }
  assert.equal(col(exp([lead({ website: 'https://glossy.ae/', site: { state: 'error' } })]).rows[0], 'website'), 'https://glossy.ae/');
});

test('business names: as you would type them, plain letters', () => {
  assert.equal(col(exp([lead({ pageName: '𝐃𝐢𝐠𝐢𝐜𝐫𝐚𝐟𝐭 𝐈𝐧𝐭𝐞𝐫𝐢𝐨𝐫 𝐃𝐞𝐬𝐢𝐠𝐧' })]).rows[0], 'business_name'), 'Digicraft Interior Design');
  assert.equal(col(exp([lead({ pageName: 'AR Tech Interior 🛠️' })]).rows[0], 'business_name'), 'AR Tech Interior');
  assert.equal(col(exp([lead({ pageName: '', sources: { instagram: { username: 'glossyppf' } } })]).rows[0], 'business_name'), 'glossyppf', 'no name: their handle');
});

test('exported leads get a tag', () => {
  assert.ok(LH.leadTags(lead({ coldEmailExportedAt: Date.now() })).includes('Exported for cold email'));
  assert.ok(!LH.leadTags(lead()).includes('Exported for cold email'));
});

/* ------------------------------------------------ where the emails come from */
test('emails on a Facebook or Instagram page: escaped forms count, platform addresses and placeholders do not', () => {
  assert.deepEqual(LH.emailsInPage('Intro · info\\u0040glow.ae · Book: hello&#64;glow.ae · noreply@facebook.com · logo@2x.png · filler@godaddy.com · sales@glow.ae.'), ['info@glow.ae', 'hello@glow.ae', 'sales@glow.ae']);
  assert.deepEqual(LH.emailsInPage(''), []);
  assert.deepEqual(LH.emailsInPage('a@b.example a@b.example'), ['a@b.example'], 'once each');
});

test('their Facebook page: from the website or Maps link, or the advertiser page; not a share link or a group', () => {
  const fb = (url) => LH.facebookPageUrl({ kind: 'prospect', socials: { facebook: url } });
  assert.equal(fb('https://facebook.com/GlossyPPF/'), 'https://www.facebook.com/GlossyPPF');
  assert.equal(fb('https://m.facebook.com/glossy?ref=page'), 'https://www.facebook.com/glossy');
  assert.equal(fb('https://www.facebook.com/profile.php?id=100012345678'), 'https://www.facebook.com/profile.php?id=100012345678');
  for (const bad of ['https://www.facebook.com/sharer/sharer.php?u=x', 'https://www.facebook.com/groups/dubaibiz', 'https://www.facebook.com/profile.php', 'https://www.instagram.com/glossy/']) assert.equal(fb(bad), '', bad);
  assert.equal(LH.facebookPageUrl(advertiser({ pageId: '123456789' })), 'https://www.facebook.com/123456789');
  assert.equal(LH.facebookPageUrl(lead()), '');
});

test('who gets their Facebook page read: no email, a page, and no website or a weak one', () => {
  const page = { socials: { facebook: 'https://www.facebook.com/glossy' } };
  assert.equal(LH.wantsFacebookEmail(lead({ ...page, emails: [] }), S), true);
  assert.equal(LH.wantsFacebookEmail(lead({ ...page }), S), false, 'already has an email');
  assert.equal(LH.wantsFacebookEmail(lead({ emails: [] }), S), false, 'no page to read');
  assert.equal(LH.wantsFacebookEmail(lead({ ...page, emails: [], website: 'https://good.example/', site: GOOD_SITE }), S), false, 'a good website: not a cold email lead');
  assert.equal(LH.wantsFacebookEmail(lead({ ...page, emails: [], status: 'won' }), S), false, 'closed');
  assert.equal(LH.wantsFacebookEmail(lead({ ...page, emails: [], fbEmail: { state: 'none', at: Date.now() } }), S), false, 'read once already');
  assert.equal(LH.wantsFacebookEmail(advertiser({ emails: [] }), S), true, 'website leads have their advertiser page');
});
