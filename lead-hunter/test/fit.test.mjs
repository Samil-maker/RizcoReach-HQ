// Who fits a cold email about a website: proof a business just opened, the state of its website, and the file the
// cold email system (cold-email/ in this repo) imports from its RizcoReach Leads folder.
//   node --test lead-hunter/test/fit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/emails.js');
await import('../lib/fit.js');
await import('../lib/site-audit.js');
await import('../lib/prospects.js');
const LH = globalThis.LH;

const DAY = 864e5;
const NOW = new Date(2026, 10, 12, 12).getTime(); // 12 Nov 2026
const S = { ...LH.DEFAULT_SETTINGS };
const WORKING = { state: 'ok', https: true, mobile: true, score: 88 };
let n = 0;
/** A Google Maps business with no website and an address whose domain receives email. */
const lead = (o = {}) => ({ id: `l${++n}`, kind: 'prospect', pageName: 'Glossy PPF', status: 'new', phones: [{ number: '+971501234567', source: 'google' }], emails: ['hi@glossy.example'], emailCheck: { 'hi@glossy.example': { s: 'dns' } }, socials: {}, sources: { maps: { placeId: `p${n}`, rating: 4.8, reviews: 4 } }, website: null, area: 'Al Quoz, Dubai', niche: 'Car', ...o });
/** The same, with Google's "Recently opened" label seen yesterday. */
const fresh = (o = {}) => lead({ openSignals: [{ kind: 'google', text: 'Recently opened', at: NOW - DAY }], ...o });
const advertiser = (o = {}) => ({ id: `a${++n}`, pageId: `10000${n}`, pageName: 'Gloss Garage', status: 'new', phones: [], emails: ['team@gloss.example'], emailCheck: { 'team@gloss.example': { s: 'dns' } }, socials: {}, website: null, keywords: ['car detailing'], ...o });
const exp = (leads, opts = {}, settings = S) => LH.coldEmailExport(leads, settings, { now: NOW, ...opts });
const col = (row, name) => row[LH.COLD_EMAIL_HEAD.indexOf(name)];

/* ------------------------------------------------------------ Google's label */
test("Google's label on a new listing, in every form it takes", () => {
  const L = (t) => LH.openingLabel(t, NOW);
  assert.deepEqual(L('Recently opened'), { kind: 'opened', text: 'Recently opened', openedAt: null });
  assert.deepEqual(L('Opened 3 weeks ago'), { kind: 'opened', text: 'Opened 3 weeks ago', openedAt: NOW - 21 * DAY });
  assert.deepEqual(L('opened a month ago'), { kind: 'opened', text: 'Opened a month ago', openedAt: NOW - 30 * DAY });
  assert.deepEqual(L('Opened September 2026'), { kind: 'opened', text: 'Opened September 2026', openedAt: new Date(2026, 8, 15).getTime() });
  assert.deepEqual(L('Opened on Oct 3, 2026'), { kind: 'opened', text: 'Opened on Oct 3, 2026', openedAt: new Date(2026, 9, 3).getTime() });
  assert.deepEqual(L('Opening soon'), { kind: 'soon', text: 'Opening soon', opensAt: null });
  assert.deepEqual(L('Opens Wed Nov 25'), { kind: 'soon', text: 'Opens Wed Nov 25', opensAt: new Date(2026, 10, 25).getTime() });
  assert.deepEqual(L('Opens Jan 9'), { kind: 'soon', text: 'Opens Jan 9', opensAt: new Date(2027, 0, 9).getTime() }, 'a month already past means next year');
  assert.deepEqual(L('Opens December 2026'), { kind: 'soon', text: 'Opens December 2026', opensAt: new Date(2026, 11, 15).getTime() });
});

test('opening hours and reviews are not the label', () => {
  for (const t of ['Opens 9 AM', 'Opens 9 AM Wed', 'Closed ⋅ Opens 10 AM', 'Opens soon ⋅ 9 AM', 'Opens soon', 'Open ⋅ Closes 9 PM', 'Open 24 hours', 'Opened', 'Opens Wed', '"Recently opened and already my favourite"', 'They recently opened a second branch near the mall and the staff are friendly, really great', 'Hair salon', '', null, 'Opened March 2031'])
    assert.equal(LH.openingLabel(t, NOW), null, String(t));
  // A listing's lines: the label can share a line with the category.
  assert.equal(LH.openingLabelIn(['Glow Salon', '4.9(3)', 'Hair salon · Recently opened', 'Open ⋅ Closes 9 PM'], NOW).text, 'Recently opened');
  assert.equal(LH.openingLabelIn(['Glow Salon', 'Hair salon · Al Wasl Rd', 'Closed ⋅ Opens 9 AM Wed', '"Recently opened, lovely place"'], NOW), null);
});

/* -------------------------------------------------------------- their own words */
test('what a business says when it opens, in English and Arabic', () => {
  const yes = ['GRAND OPENING this Friday in JLT!', 'Soft opening tomorrow', 'We are now open in Dubai Marina', "We're open! Come say hi", 'Now open in Al Barsha', 'Newly opened salon in Mirdif', 'We just opened our doors', 'Opening soon in Business Bay', 'Opening week offers: 30% off', 'Visit our new branch in Sharjah', 'Doors are now open', 'الافتتاح الكبير يوم الجمعة', 'تم الافتتاح بحمد الله'];
  for (const t of yes) assert.ok(LH.openingWords(t), t);
  const no = ['Opening hours: 9 to 9', 'We are open daily from 9 AM', 'We are open for bookings', 'Now open for registration', 'Best ceramic coating in Dubai', 'Job opening: receptionist', ''];
  for (const t of no) assert.equal(LH.openingWords(t), '', t);
  // The phrase with a few words around it, on one line.
  const said = LH.openingWords('Hello Dubai!\nGrand opening this Friday in JLT, 20% off every service for the first week only, book on WhatsApp now');
  assert.match(said, /^Hello Dubai! Grand opening this Friday in JLT, 20% off every service.*…$/);
  assert.ok(said.length < 110 && !said.includes('\n'));
});

/* --------------------------------------------------------------------- proof */
test('proof they just opened: strong signs count for 120 days, your tick wins, a bio alone is only a hint', () => {
  const open = (l, settings = S) => LH.opening(l, settings, NOW);
  assert.equal(open(lead()), null);
  assert.equal(open(fresh()).label, 'Google says "Recently opened"');
  assert.equal(open(lead({ openSignals: [{ kind: 'ad', text: 'Grand opening this Friday', at: NOW - 10 * DAY }] })).label, 'Their ad says "Grand opening this Friday"');
  assert.equal(open(lead({ openSignals: [{ kind: 'caption', text: 'We are now open', at: NOW - 100 * DAY, url: 'https://www.instagram.com/p/x/' }] })).url, 'https://www.instagram.com/p/x/');
  assert.equal(open(lead({ openSignals: [{ kind: 'newig', text: 'Their Instagram started 3 weeks ago', at: NOW, openedAt: NOW - 21 * DAY }] })).label, 'Their Instagram started 3 weeks ago');
  // Too long ago: not new any more. Google's plain label is counted from the middle of its 90 days.
  assert.equal(open(lead({ openSignals: [{ kind: 'ad', text: 'Grand opening', at: NOW - 130 * DAY }] })), null);
  assert.ok(open(lead({ openSignals: [{ kind: 'google', text: 'Recently opened', at: NOW - 70 * DAY }] })));
  assert.equal(open(lead({ openSignals: [{ kind: 'google', text: 'Recently opened', at: NOW - 80 * DAY }] })), null);
  assert.equal(open(lead({ openSignals: [{ kind: 'google', text: 'Opened 5 months ago', at: NOW, openedAt: NOW - 150 * DAY }] })), null);
  assert.ok(open(lead({ openSignals: [{ kind: 'ad', text: 'Grand opening', at: NOW - 130 * DAY }] }), { ...S, newDays: 180 }), 'the window is a setting');
  // Not open yet.
  const soon = open(lead({ openSignals: [{ kind: 'soon', text: 'Opens Wed Nov 25', at: NOW, opensAt: NOW + 13 * DAY }] }));
  assert.deepEqual([soon.soon, soon.label], [true, 'Google says "Opens Wed Nov 25"']);
  // The newest proof is the one shown.
  assert.equal(open(lead({ openSignals: [{ kind: 'ad', text: 'Grand opening', at: NOW - 60 * DAY }, { kind: 'caption', text: 'Now open', at: NOW - 5 * DAY }] })).kind, 'caption');
  // A bio is a hint, never proof. Your tick is, both ways.
  const bio = lead({ openSignals: [{ kind: 'bio', text: 'Now open in JLT', at: NOW }] });
  assert.equal(open(bio), null);
  assert.equal(LH.openingHint(bio), 'Their Instagram bio says "Now open in JLT"');
  assert.equal(open({ ...bio, justOpened: true }).kind, 'manual');
  assert.equal(open(fresh({ justOpened: false })), null, 'you said they are not new');
  // The same sign seen again is kept once; only the newest six are kept.
  const l = lead();
  for (let i = 0; i < 9; i++) LH.addOpenSignal(l, { kind: 'ad', text: `Ad ${i % 7}`, at: NOW + i });
  assert.deepEqual(l.openSignals.map((s) => s.text), ['Ad 3', 'Ad 4', 'Ad 5', 'Ad 6', 'Ad 0', 'Ad 1']);
});

/* ----------------------------------------------------------------------- fit */
test('fit: no website, or a website that is down, parked or weak; a good website does not fit', () => {
  const fit = (l, settings = S) => {
    const f = LH.fit(l, settings, NOW);
    return [f.fit, f.kind, f.site];
  };
  const site = (state) => ({ website: 'https://glossy.example/', site: state });
  const WEAK = { state: 'ok', score: 45, issues: [{ id: 'https', sev: 'high', label: 'No HTTPS ("Not secure" warning)' }, { id: 'viewport', sev: 'high', label: 'Not mobile-friendly' }] };
  assert.deepEqual(fit(fresh()), [true, 'new', 'none']);
  assert.deepEqual(fit(lead()), [true, 'none', 'none'], 'no website at all');
  assert.deepEqual(fit(lead(site({ state: 'error' }))), [true, 'down', 'down']);
  assert.deepEqual(fit(lead(site({ state: 'ok', parked: true }))), [true, 'parked', 'parked']);
  assert.deepEqual(fit(fresh(site({ state: 'ok', parked: true }))), [true, 'new', 'parked']);
  assert.deepEqual(fit(lead(site(WEAK))), [true, 'weak', 'weak']);
  assert.equal(LH.fit(lead(site(WEAK)), S, NOW).why, 'Weak website: No HTTPS, Not mobile-friendly');
  assert.deepEqual(fit(lead(site({ ...WORKING, score: 70 }))), [true, 'weak', 'weak'], 'scores under 80');
  assert.deepEqual(fit(lead(site({ ...WORKING, issues: [{ id: 'https', sev: 'high', label: 'No HTTPS' }] }))), [true, 'weak', 'weak'], 'not secure, whatever its score');
  assert.deepEqual(fit(lead(site(WORKING))), [false, null, 'good']);
  assert.deepEqual(fit(fresh(site(WORKING))), [false, null, 'good'], 'new, but they already have a good website');
  assert.deepEqual(fit(lead(site({ ...WORKING, score: 70 })), { ...S, goodSiteScore: 60 }), [false, null, 'good'], 'the bar is in Settings');
  assert.deepEqual(fit(lead(site({ state: 'blocked' }))), [false, null, 'blocked']);
  assert.equal(LH.fit(lead(site({ state: 'queued' })), S, NOW).pending, true);
  // Strict: only new businesses, or dead websites.
  const strict = { ...S, strictFit: true };
  assert.deepEqual(fit(lead(), strict), [false, null, 'none']);
  assert.deepEqual(fit(lead(site(WEAK)), strict), [false, null, 'weak']);
  assert.deepEqual(fit(fresh(site(WEAK)), strict), [true, 'new', 'weak']);
  assert.deepEqual(fit(lead(site({ state: 'error' })), strict), [true, 'down', 'down']);
  // Instagram, a link page or Maps as the "website" is no website.
  for (const w of ['https://www.instagram.com/glossy/', 'https://linktr.ee/glossy', 'https://www.facebook.com/glossy', 'https://wa.me/971501234567']) assert.equal(LH.siteState(lead({ website: w })), 'none', w);
  assert.equal(LH.fit(fresh(), S, NOW).why, 'Just opened, and they have no website');
  assert.equal(LH.fit(lead(), S, NOW).why, 'No website');
});

test('fit score: new and dead websites first, an email makes it hot, a good website sinks', () => {
  const score = (l, settings = S) => LH.fitScore(l, settings, NOW).score;
  const confirmed = fresh({ emailCheck: { 'hi@glossy.example': { s: 'ok' } } });
  assert.equal(LH.fitClass(score(confirmed)), 'hot');
  assert.equal(LH.fitClass(score(fresh())), 'hot', 'no check key: a domain that receives email is enough');
  assert.equal(LH.fitClass(score(lead())), 'warm', 'no website, with an email');
  assert.ok(score(confirmed) > score(fresh()) && score(fresh()) > score(lead()) && score(lead()) > score(lead({ emails: [] })));
  assert.equal(LH.fitClass(score(lead({ website: 'https://x.example/', site: WORKING, emailCheck: { 'hi@glossy.example': { s: 'ok' } } }))), 'cold');
  assert.deepEqual(LH.fitScore(confirmed, S, NOW).parts.map((p) => p.label), ['Just opened', 'No website', 'Email confirmed', 'Has a WhatsApp number']);
});

test('tags say why at a glance', () => {
  const tags = (l, settings = S) => LH.fitTags(l, { settings, now: NOW });
  assert.deepEqual(tags(fresh()), ['Just opened', 'No website', 'Email']);
  assert.deepEqual(tags(fresh({ emailCheck: { 'hi@glossy.example': { s: 'ok' } }, coldEmailExportedAt: NOW })), ['Just opened', 'No website', 'Email confirmed', 'Exported for cold email']);
  assert.deepEqual(tags(lead({ website: 'https://x.example/', site: { state: 'ok', parked: true }, emails: [] })), ['Parked', 'No email']);
  assert.deepEqual(tags(lead({ website: 'https://x.example/', site: { state: 'error' }, emailCheck: { 'hi@glossy.example': { s: 'bad' } } })), ['Site down', 'Email failed']);
  assert.deepEqual(tags(lead({ openSignals: [{ kind: 'soon', text: 'Opening soon', at: NOW }] })).slice(0, 1), ['Opening soon']);
  assert.deepEqual(tags(lead({ website: 'https://x.example/', site: WORKING })).slice(0, 1), ['Good website']);
  assert.deepEqual(tags(lead({ website: 'https://x.example/', site: { ...WORKING, score: 50 } })).slice(0, 1), ['Weak website']);
});

/* -------------------------------------------------------------- the cold email file */
test('columns: exactly these, in this order, and the file name', () => {
  assert.deepEqual(LH.COLD_EMAIL_HEAD, ['business_name', 'first_name', 'email', 'website', 'instagram', 'phone', 'niche', 'area', 'source', 'notes', 'status']);
  const r = exp([fresh({ pageName: 'GLOSSY PPF L.L.C | Ceramic Coating Dubai', socials: { instagram: 'https://www.instagram.com/glossyppf/' }, phones: [{ number: '+97143334444', source: 'google' }, { number: '+971559998877', source: 'whatsapp-site' }] })]);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(
    Object.fromEntries(LH.COLD_EMAIL_HEAD.map((h) => [h, col(r.rows[0], h)])),
    { business_name: 'Glossy PPF', first_name: '', email: 'hi@glossy.example', website: '', instagram: 'glossyppf', phone: '+971559998877', niche: 'Car', area: 'Al Quoz, Dubai', source: 'Google Maps', notes: 'new business', status: 'New' },
  );
  assert.equal(LH.coldEmailFilename(new Date(2026, 10, 8)), 'rizcoreach-cold-email-2026-11-08.csv');
  const csv = LH.toCsv([r.head, ...r.rows]).split('\r\n');
  assert.equal(csv[0], 'business_name,first_name,email,website,instagram,phone,niche,area,source,notes,status');
  assert.match(csv[1], /^Glossy PPF,,hi@glossy\.example,,glossyppf,\+971559998877,Car,"Al Quoz, Dubai",Google Maps,new business,New$/);
});

test('who goes in: no website, or one that is down, parked or weak, with an email; who stays out, and why', () => {
  const down = lead({ website: 'https://old.example/', site: { state: 'error' } });
  const parked = lead({ website: 'https://soon.example/', site: { state: 'ok', parked: true } });
  const r = exp([
    fresh(),
    down,
    parked,
    lead(), // no website, not new
    lead({ website: 'https://weak.example/', site: { ...WORKING, score: 40 } }),
    lead({ website: 'https://good.example/', site: WORKING }),
    fresh({ website: 'https://good.example/', site: WORKING }),
    lead({ website: 'https://x.example/', site: { state: 'queued' } }),
    lead({ website: 'https://x.example/', site: { state: 'blocked' } }),
    ...['replied', 'meeting', 'won', 'lost', 'skip'].map((status) => fresh({ status })),
    fresh({ doNotEmail: true }),
    fresh({ emailQueue: { state: 'done', sent: 3 } }),
    fresh({ coldEmailExportedAt: NOW - DAY }),
  ]);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows.map((row) => [col(row, 'website'), col(row, 'notes')]), [['', 'new business'], ['https://old.example/', ''], ['https://soon.example/', ''], ['', ''], ['https://weak.example/', '']]);
  assert.deepEqual(r.skipped, { closed: 6, emailedBefore: 1, exported: 1, goodSite: 2, noProof: 0, siteUnknown: 2, noEmail: 0, badEmail: 0, waiting: 0, risky: 0 });
  assert.equal(exp([lead()], {}, { ...S, strictFit: true }).skipped.noProof, 1, 'strict: not new, no dead website');
  // Include already exported puts them back. A queue entry that never sent anything is not "emailed".
  assert.equal(exp([fresh({ coldEmailExportedAt: NOW - DAY })], { includeExported: true }).rows.length, 1);
  assert.equal(exp([fresh({ emailQueue: { state: 'queued', sent: 0 } })]).rows.length, 1);
  // Still talking to them another way: in, with their status.
  assert.deepEqual(exp(['new', 'contacted', 'followup'].map((status) => fresh({ status }))).rows.map((row) => col(row, 'status')), ['New', 'Contacted', 'Follow up']);
});

test('only addresses that passed their checks go in the file', () => {
  const at = (emails, emailCheck) => fresh({ emails, emailCheck });
  const r = exp([
    at([], {}),
    at(['%20info@glow.ae'], {}), // broken
    at(['glow_salon@gmail.com'], {}), // cannot exist
    at(['info@dead.example'], { 'info@dead.example': { s: 'bad', why: 'Its domain cannot receive email' } }),
    at(['new@glow.example'], {}), // not looked up yet
    at(['glowsalon@gmial.com'], { 'glowsalon@gmail.com': { s: 'dns' } }), // fixed
    at(['old@x.example', 'new@x.example'], { 'new@x.example': { s: 'dns' } }),
  ]);
  assert.deepEqual(r.rows.map((row) => col(row, 'email')), ['glowsalon@gmail.com', 'new@x.example']);
  assert.deepEqual([r.skipped.noEmail, r.skipped.badEmail, r.skipped.waiting], [1, 3, 1]);
  assert.equal(r.waiting.length, 1, 'the ones to check next');
  // With a mailbox check key: only confirmed mailboxes.
  const key = { ...S, verifyKey: 'k' };
  const strict = exp([at(['a@x.example'], { 'a@x.example': { s: 'dns' } }), at(['b@x.example'], { 'b@x.example': { s: 'ok' } }), at(['c@x.example'], { 'c@x.example': { s: 'risky' } })], {}, key);
  assert.deepEqual(strict.rows.map((row) => col(row, 'email')), ['b@x.example']);
  assert.deepEqual([strict.skipped.waiting, strict.skipped.risky], [1, 1]);
  assert.equal(exp([at(['c@x.example'], { 'c@x.example': { s: 'risky' } })], {}, { ...key, emailRisky: true }).rows.length, 1);
});

test('source: where we actually saw them', () => {
  const src = (l) => col(exp([l]).rows[0], 'source');
  assert.equal(src(fresh()), 'Google Maps');
  assert.equal(src(fresh({ socials: { instagram: 'https://www.instagram.com/glossyppf/' } })), 'Google Maps', 'found on Maps, Instagram known too');
  assert.equal(src(fresh({ sources: { instagram: { username: 'glossyppf' } } })), 'Instagram', 'saved from Instagram');
  const opening = { openSignals: [{ kind: 'ad', text: 'Grand opening', at: NOW - DAY }] };
  assert.equal(src(advertiser(opening)), 'Facebook', 'Ad Library, Instagram not known');
  assert.equal(src(advertiser({ ...opening, socials: { instagram: 'https://instagram.com/glossgarage' } })), 'Instagram', 'Ad Library, their Instagram known');
});

test('business names in the file: as you would type them, plain letters', () => {
  const name = (pageName, o = {}) => col(exp([fresh({ pageName, ...o })]).rows[0], 'business_name');
  assert.equal(name('AL NOOR BEAUTY SALON L.L.C'), 'Al Noor Beauty Salon');
  assert.equal(name('\u{1D403}\u{1D422}\u{1D420}\u{1D422} Interior'), 'Digi Interior', 'fancy bold letters become plain ones');
  assert.equal(name('', { sources: { instagram: { username: 'glossyppf' } } }), 'glossyppf', 'no name: their handle');
});

test('who gets their Facebook page read: no email, a page, and they fit', () => {
  const page = { socials: { facebook: 'https://www.facebook.com/glossy' } };
  const none = { emails: [], emailCheck: {} };
  const wants = (l) => LH.wantsFacebookEmail(l, S);
  const NOW_REAL = Date.now();
  const tagged = { openSignals: [{ kind: 'google', text: 'Recently opened', at: NOW_REAL }] };
  assert.equal(wants(lead({ ...page, ...none, ...tagged })), true);
  assert.equal(wants(lead({ ...page, ...tagged })), false, 'already has an email');
  assert.equal(wants(lead({ ...none, ...tagged })), false, 'no page to read');
  assert.equal(wants(lead({ ...page, ...none })), true, 'no website, not new: still a lead');
  assert.equal(wants(lead({ ...page, ...none, website: 'https://good.example/', site: WORKING })), false, 'a good website');
  assert.equal(wants(lead({ ...page, ...none, website: 'https://x.example/', site: { state: 'error' } })), true, 'site down');
  assert.equal(wants(lead({ ...page, ...none, ...tagged, status: 'won' })), false, 'closed');
  assert.equal(wants(lead({ ...page, ...none, ...tagged, fbEmail: { state: 'none', at: NOW_REAL } })), false, 'read once already');
  assert.equal(wants(advertiser({ ...none, pageId: '123456789', website: 'https://x.example/', site: { state: 'ok', parked: true } })), true, 'website leads have their advertiser page');
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
