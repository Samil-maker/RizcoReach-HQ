// Unit tests for leads.js (phone numbers, websites, messages, exports).
// Usage: node lead-finder-extension/test/unit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['../leads.js', '../rules.js', '../qualify.js']) vm.runInContext(readFileSync(new URL(f, import.meta.url), 'utf8'), ctx, { filename: f });
const LF = ctx.LF;
const S = (over = {}) => LF.withDefaults(over);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok  ', name);
  } catch (err) {
    console.error('FAIL', name);
    console.error(err);
    process.exitCode = 1;
  }
}

test('phone numbers: UAE formats, types and other countries', () => {
  const n = (v, c = 'AE') => {
    const p = LF.normalizePhone(v, c);
    return p && `${p.e164} ${p.type}`;
  };
  assert.equal(n('+971 50 123 4567'), '+971501234567 mobile');
  assert.equal(n('050 123 4567'), '+971501234567 mobile');
  assert.equal(n('tel:+971501234567'), '+971501234567 mobile');
  assert.equal(n('00971 55 123 4567'), '+971551234567 mobile');
  assert.equal(n('971501234567'), '+971501234567 mobile');
  assert.equal(n('+971 (0)50 123 4567'), '+971501234567 mobile');
  assert.equal(n('04 123 4567'), '+97141234567 landline');
  assert.equal(n('+97144444444'), '+97144444444 landline');
  assert.equal(n('800 1234'), null);
  assert.equal(n('+966 50 123 4567'), '+966501234567 mobile');
  assert.equal(n('+44 7911 123456'), '+447911123456 mobile');
  assert.equal(n('9876543210', 'IN'), '+919876543210 mobile');
  assert.equal(n('+1 415 555 0100'), '+14155550100 unknown');
  assert.equal(n(''), null);
  assert.equal(n('Open 24 hours'), null);
});

test('pickPhone prefers a mobile and respects mobile-only', () => {
  assert.equal(LF.pickPhone(['04 123 4567 / 050 765 4321'], { country: 'AE', mobileOnly: true }).e164, '+971507654321');
  assert.equal(LF.pickPhone(['04 123 4567'], { country: 'AE', mobileOnly: true }), null);
  assert.equal(LF.pickPhone(['04 123 4567'], { country: 'AE', mobileOnly: false }).e164, '+97141234567');
  assert.equal(LF.pickPhone([''], { country: 'AE', mobileOnly: true }), null);
});

test('formatPhone keeps numbers readable and text-like', () => {
  assert.equal(LF.formatPhone('+971501234567'), '+971 50 123 4567');
  assert.equal(LF.formatPhone('+97141234567'), '+971 4 123 4567');
  assert.equal(LF.formatPhone('+447911123456'), '+44 791 112 3456');
});

test('website detection treats social and booking pages as no website', () => {
  assert.equal(LF.hasRealWebsite([''], true), false);
  assert.equal(LF.hasRealWebsite(['https://www.instagram.com/noor.salon/'], true), false);
  assert.equal(LF.hasRealWebsite(['https://www.instagram.com/noor.salon/'], false), true);
  assert.equal(LF.hasRealWebsite(['https://www.fresha.com/a/noor'], true), false);
  assert.equal(LF.hasRealWebsite(['https://noor.business.site/'], true), false);
  assert.equal(LF.hasRealWebsite(['http://www.noorsalon.ae'], true), true);
});

test('messages and WhatsApp links', () => {
  const lead = { name: 'Noor Salon | Best Salon Dubai', category: 'Beauty salon', query: 'salon in barsha' };
  assert.equal(LF.fillMessage('Hi {name}, a {category} ({search}) {other}', lead), 'Hi Noor Salon, a beauty salon (salon in barsha) {other}');
  assert.match(LF.fillMessage('', { name: '' }), /came across your business on Google Maps/);
  assert.equal(LF.fillMessage('{name}: {issues}', { name: 'X' }, { issues: 'slow' }), 'X: slow');
  assert.equal(LF.whatsAppUrl('+971501234567', 'Hi & bye', 'web'), 'https://web.whatsapp.com/send?phone=971501234567&text=Hi%20%26%20bye');
  assert.equal(LF.whatsAppUrl('+971501234567', 'Hi', 'app'), 'https://wa.me/971501234567?text=Hi');
});

test('Google Contacts and spreadsheet exports', () => {
  const lead = LF.newLead({ e164: '+971501234567', type: 'mobile' }, { name: 'Noor, "The" Salon', category: 'Beauty salon', address: 'Al Barsha 1', mapsUrl: 'https://maps/x' }, 'salon');
  const s = S({ checkInstagram: false });
  const csv = LF.toCsv(LF.contactsRows([lead], s));
  const [header, row] = csv.split('\r\n');
  assert.equal(header, 'Name,Given Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Notes,Group Membership');
  assert.ok(row.startsWith('"Lead - Noor, ""The"" Salon","Lead - Noor, ""The"" Salon","Noor, ""The"" Salon",Mobile,+971501234567,"Good lead (65/100): No website; Google reviews couldn\'t be read'), row);
  assert.ok(csv.includes('Google Maps search: salon\nBeauty salon\nAl Barsha 1\nhttps://maps/x",RizcoReach Leads ::: * myContacts\r\n'));
  const tsv = LF.toTsv(LF.sheetRows([lead], s)).split('\n');
  assert.equal(tsv.length, 2);
  const cols = tsv[0].split('\t');
  const vals = tsv[1].split('\t');
  assert.equal(vals[cols.indexOf('Mobile')], '+971 50 123 4567');
  assert.equal(vals[cols.indexOf('Verdict')], 'Good');
  assert.equal(vals[cols.indexOf('Score')], '65');
});

test('settings: defaults, criteria merge and version 1 migration', () => {
  const s = S({ message: 'Old {name}', criteria: { noPreloader: false } });
  assert.equal(s.messageNoSite, 'Old {name}');
  assert.equal(s.criteria.noPreloader, false);
  assert.equal(s.criteria.noForm, true);
  assert.equal(s.minFollowers, 1000);
  assert.equal(S({ messageNoSite: 'New' , message: 'Old' }).messageNoSite, 'New');
});

test('Instagram handles from links', () => {
  const h = LF.instagramHandle;
  assert.equal(h('https://www.instagram.com/noor.salon/'), 'noor.salon');
  assert.equal(h('https://instagram.com/Noor_Salon?igsh=abc123'), 'noor_salon');
  assert.equal(h('instagram.com/noorsalon'), 'noorsalon');
  assert.equal(h('https://www.instagram.com/@noorsalon'), 'noorsalon');
  assert.equal(h('https://instagr.am/noorsalon/'), 'noorsalon');
  assert.equal(h('https://l.instagram.com/?u=https%3A%2F%2Fwww.instagram.com%2Fnoorsalon%2F&e=x'), 'noorsalon');
  assert.equal(h('https://www.instagram.com/p/C1234abc/'), '');
  assert.equal(h('https://www.instagram.com/reel/C1234abc/'), '');
  assert.equal(h('https://www.instagram.com/explore/tags/salon/'), '');
  assert.equal(h('https://www.instagram.com/'), '');
  assert.equal(h('https://www.facebook.com/noorsalon'), '');
  assert.equal(h('https://notinstagram.com/noorsalon'), '');
});

test('follower counts from Instagram page text', () => {
  const f = LF.parseFollowers;
  assert.equal(f('1,234 Followers, 56 Following, 78 Posts - See Instagram photos and videos from Noor (@noor)'), 1234);
  assert.equal(f('12.5K Followers, 300 Following, 1,024 Posts'), 12500);
  assert.equal(f('1.2M Followers, 3 Following'), 1200000);
  assert.equal(f('987 Followers, 1 Following'), 987);
  assert.equal(f('1.234 Followers'), 1234);
  assert.equal(f('12,5K Followers'), 12500);
  assert.equal(f('See Instagram photos and videos'), null);
  assert.equal(LF.formatCount(5234), '5.2K');
  assert.equal(LF.formatCount(25400), '25K');
  assert.equal(LF.formatCount(1250000), '1.3M');
  assert.equal(LF.formatCount(830), '830');
});

const site = (signals, extra = {}) => ({ checks: { site: { state: 'done', signals }, ...extra } });
const GOOD_SITE = { reachable: true, https: true, loadMs: 1800, viewport: true, preloader: true, form: { found: true }, whatsapp: true, tel: true, copyrightYear: new Date().getFullYear(), title: 'Noor', metaDescription: true, h1: 1, metaPixel: true, analytics: true, builder: 'WordPress' };

test('website issues respect the criteria switches', () => {
  const s = S();
  assert.deepEqual([...LF.websiteIssues(GOOD_SITE, s)].map((i) => i.id), []);
  const bad = { ...GOOD_SITE, loadMs: 7200, preloader: false, form: { found: false }, copyrightYear: 2019, https: false, whatsapp: false };
  assert.deepEqual([...LF.websiteIssues(bad, s)].map((i) => i.id), ['slow', 'noForm', 'noHttps', 'noPreloader', 'outdated']);
  assert.deepEqual([...LF.websiteIssues(bad, S({ criteria: { noPreloader: false, noWhatsApp: true } }))].map((i) => i.id), ['slow', 'noForm', 'noHttps', 'noWhatsApp', 'outdated']);
  assert.equal(LF.websiteIssues(bad, s)[0].chip, 'slow (7.2s)');
  assert.equal(LF.websiteIssues(bad, S({ slowSeconds: 8 }))[0].id, 'noForm');
  // A site that doesn't load only reports that.
  assert.deepEqual([...LF.websiteIssues({ reachable: false, failure: 'dns' }, s)].map((i) => i.id), ['down']);
  assert.equal(LF.websiteIssues({ ...GOOD_SITE, timedOut: true, loadMs: 0 }, s)[0].chip, 'very slow (20s+)');
  assert.equal(LF.websiteIssues(GOOD_SITE, s, { performance: 31 })[0].chip, 'PageSpeed 31/100');
  assert.equal(LF.websiteIssues({ ...GOOD_SITE, builder: 'Wix' }, S({ criteria: { diyBuilder: true } }))[0].chip, 'built on Wix');
});

test('evaluate: no website, weak website, good website', () => {
  const s = S();
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', rating: 4.7, reviews: 230 };
  const ig = (followers, handle = 'noor') => ({ instagram: { state: 'done', handle, followers } });

  const noSite = LF.evaluate({ ...base, website: '', checks: ig(5200) }, s);
  assert.equal(noSite.opportunity, 'noSite');
  assert.equal(noSite.verdict, 'hot');
  assert.equal(noSite.score, 45 + 21 + 20 + 10);
  assert.deepEqual([...noSite.reasons].map((r) => r.text), ['No website', 'Instagram @noor · 5.2K followers', '4.7★ · 230 Google reviews']);

  const social = LF.evaluate({ ...base, website: 'https://instagram.com/noor', checks: ig(1500) }, s);
  assert.equal(social.opportunity, 'social');
  assert.equal(social.reasons[0].text, 'Only an Instagram page, no website');

  const weak = LF.evaluate({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, loadMs: 6100, form: { found: false } }, ig(2400)) }, s);
  assert.equal(weak.opportunity, 'weak');
  assert.equal(weak.verdict, 'hot');
  assert.equal(weak.reasons[0].text, 'Weak website: slow (6.1s) · no contact form');

  const oneIssue = LF.evaluate({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, preloader: false }, ig(2400)) }, s);
  assert.equal(oneIssue.opportunity, 'ok');
  assert.equal(oneIssue.verdict, 'low');
  assert.equal(oneIssue.reasons[0].text, 'Website looks fine (only no preloader)');

  const critical = LF.evaluate({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, viewport: false }, ig(2400)) }, s);
  assert.equal(critical.opportunity, 'weak', 'one critical issue is enough');

  const down = LF.evaluate({ ...base, website: 'https://noor.ae', ...site({ reachable: false, failure: "the domain doesn't load (it may have expired)" }, ig(2400)) }, s);
  assert.equal(down.opportunity, 'broken');
  assert.equal(down.reasons[0].text, 'Website not working: domain not loading');
  assert.match(LF.messageFor({ ...base, website: 'https://noor.ae', ...site({ reachable: false, failure: 'the domain only shows a "for sale"/parking page' }) }, s),
    /noticed the domain only shows a "for sale"\/parking page\./);
});

test('free addresses, old technology and dead-site labels', () => {
  const s = S();
  const ids = (sig) => [...LF.websiteIssues({ ...GOOD_SITE, ...sig }, s)].map((i) => i.chip);
  assert.deepEqual(ids({ freeDomain: 'noorsalon.wixsite.com' }), ['free address noorsalon.wixsite.com']);
  assert.deepEqual(ids({ flash: true }), ['uses Flash']);
  assert.deepEqual(ids({ jquery: '1.11.3' }), ['outdated code (2016 or older)']);
  assert.deepEqual(ids({ jquery: '3.7.1' }), []);
  assert.deepEqual(ids({ tableLayout: true }), ['old-fashioned layout']);
  assert.deepEqual(ids({ copyrightYear: 2018, flash: true }), ['© 2018']);
  const chip = (failure) => LF.websiteIssues({ reachable: false, failure }, s)[0].chip;
  assert.equal(chip('it shows an error page (HTTP 404)'), 'error page (HTTP 404)');
  assert.equal(chip('the hosting account is suspended'), 'hosting suspended');
  assert.equal(chip('it still shows the WordPress sample content'), 'WordPress demo content');
  assert.equal(chip('browsers show a security warning'), 'security warning');
  assert.equal(chip('it only shows a "coming soon" page'), 'coming-soon page');
  // One free-address problem is enough to call the website weak.
  const ev = LF.evaluate({ e164: '+971501111111', phoneType: 'mobile', name: 'Noor', website: 'https://noor.wixsite.com', reviews: 50, rating: 4.5,
    ...site({ ...GOOD_SITE, freeDomain: 'noor.wixsite.com' }) }, S({ checkInstagram: false }));
  assert.equal(ev.opportunity, 'weak');
});

test('evaluate: follower and review thresholds, pending checks', () => {
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor', website: '', rating: 4.2, reviews: 12 };
  const small = LF.evaluate({ ...base, checks: { instagram: { state: 'done', handle: 'noor', followers: 430 } } }, S());
  assert.equal(small.verdict, 'low');
  assert.deepEqual([...small.blockers], ['followers']);
  assert.equal(small.reasons[1].tone, 'bad');
  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'done', handle: 'noor', followers: 430 } } }, S({ minFollowers: 0 })).verdict, 'good');

  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'not_found' } } }, S()).verdict, 'good');
  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'not_found' } } }, S({ requireInstagram: true })).verdict, 'low');
  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'not_found' } } }, S({ minReviews: 20 })).verdict, 'low');

  const pending = LF.evaluate({ ...base, website: 'https://noor.ae', checks: {} }, S());
  assert.equal(pending.verdict, 'checking');
  assert.equal(pending.opportunity, 'pending');
  assert.equal(LF.evaluate({ ...base, website: 'https://noor.ae', checks: {} }, S({ checkWebsites: false, checkInstagram: false })).verdict, 'low');
});

test('a lead whose website could not be checked is never Hot', () => {
  const lead = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor', website: 'https://noor.ae', rating: 4.8, reviews: 400,
    checks: { site: { state: 'error', error: 'offline' }, instagram: { state: 'done', handle: 'noor', followers: 20000 } } };
  const ev = LF.evaluate(lead, S());
  assert.equal(ev.score, 22 + 25 + 20 + 10);
  assert.equal(ev.verdict, 'good');
});

test('spreadsheet export neutralises formula-like text', () => {
  const lead = LF.newLead({ e164: '+971501234567', type: 'mobile' }, { name: '=HYPERLINK("http://x","click")', category: '+cat', address: '@home' }, 'q');
  const row = LF.sheetRows([lead], S({ checkInstagram: false }))[1];
  assert.equal(row[0], '+971 50 123 4567');
  assert.equal(row[1], '\'=HYPERLINK("http://x","click")');
  assert.equal(row[11], "'+cat");
  assert.equal(row[12], "'@home");
});

test('the same website on 3+ listings is a chain', () => {
  const lead = (n) => ({ e164: '+97150000000' + n, phoneType: 'mobile', name: 'Branch ' + n, website: 'https://bigchain.ae/branch' + n, reviews: 80, rating: 4.4,
    checks: { site: { state: 'done', signals: { ...GOOD_SITE, loadMs: 9000, form: { found: false } } } } });
  const leads = [lead(1), lead(2), lead(3), { e164: '+971509999999', website: 'https://solo.ae' }];
  const ctx = { siteCounts: LF.siteCounts(leads) };
  assert.equal(ctx.siteCounts['bigchain.ae'], 3);
  const ev = LF.evaluate(leads[0], S({ checkInstagram: false }), ctx);
  assert.equal(ev.verdict, 'low');
  assert.ok(ev.reasons.some((r) => r.text === 'Same website as 2 other listings (likely a chain)'));
  assert.notEqual(LF.evaluate(leads[0], S({ checkInstagram: false })).verdict, 'low', 'without context it is not treated as a chain');
  const google = LF.siteCounts(['a', 'b', 'c'].map((x) => ({ website: 'https://sites.google.com/view/salon-' + x + '/home' })));
  assert.deepEqual(Object.values(google), [1, 1, 1], 'sites.google.com pages belong to different businesses');
});

test('messages pick the right template and mention real issues', () => {
  const s = S();
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', reviews: 40, rating: 4.5 };
  assert.match(LF.messageFor({ ...base, website: '' }, s), /came across Noor Salon on Google Maps and noticed there's no website/);
  const msg = LF.messageFor({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, loadMs: 6600, form: { found: false }, preloader: false }) }, s);
  assert.match(msg, /^Hi 👋 We had a look at Noor Salon's website and noticed it took about 7 seconds to load when we checked and there's no contact form for enquiries\./);
  const onlyPreloader = LF.messageFor({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, preloader: false, whatsapp: false }) }, S({ criteria: { noWhatsApp: true } }));
  assert.match(onlyPreloader, /noticed there's no WhatsApp button\./);
});

test('dead sites: friendly pitch, and switching the rule off never calls them fine', () => {
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', website: 'https://noor.ae', reviews: 40, rating: 4.5 };
  const err = site({ reachable: false, failure: 'it shows an error page (HTTP 503)' });
  assert.match(LF.messageFor({ ...base, ...err }, S()), /noticed the website link on your Google listing opens an error page\./);
  assert.doesNotMatch(LF.messageFor({ ...base, ...err }, S()), /HTTP/);
  const off = LF.evaluate({ ...base, ...err }, S({ criteria: { down: false } }));
  assert.equal(off.verdict, 'low');
  assert.match(off.reasons[0].text, /^Website not working: error page \(HTTP 503\) \(not counted/);
  assert.ok(!off.reasons.some((r) => /looks fine/.test(r.text)));
  const file = LF.websiteIssues({ reachable: false, failure: 'the link opens a file download instead of a website' }, S())[0];
  assert.equal(file.chip, 'opens a file, not a site');
});

test('a domain that only forwards to Instagram counts as no website', () => {
  const lead = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', website: 'https://noorsalon.ae', reviews: 40, rating: 4.5,
    ...site({ reachable: true, url: 'https://www.instagram.com/noor.salon/', forwardsTo: 'instagram.com' }) };
  const ev = LF.evaluate(lead, S({ checkInstagram: false }));
  assert.equal(ev.opportunity, 'social');
  assert.equal(ev.reasons[0].text, 'Website just opens an Instagram page');
  assert.equal(LF.instagramOf(lead).handle, 'noor.salon');
  assert.match(LF.messageFor(lead, S({ checkInstagram: false }), ev), /noticed there's no website/);
});

test('Instagram from the website: generic name words and short handles are not matches', () => {
  const lead = (list, name = 'Glam Beauty Lounge Dubai') => ({ name, checks: { site: { state: 'done', signals: { instagram: list } } } });
  assert.equal(LF.instagramOf(lead(['gbl.official', 'dubaiwebstudio'])).handle, 'gbl.official');
  assert.equal(LF.instagramOf(lead(['dubaiwebstudio', 'glam.lounge'])).handle, 'glam.lounge');
  assert.equal(LF.instagramOf(lead(['v'])).handle, '');
});

test('no Instagram, unread reviews, and sorting by verdict', () => {
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor', website: '', rating: 4.8, reviews: 400 };
  const none = LF.evaluate({ ...base, checks: { instagram: { state: 'not_found' } } }, S());
  assert.equal(none.score, 45 + 6 + 20 + 10);
  assert.equal(none.verdict, 'good', 'followers unknown: Good, not Hot, while there is a follower minimum');
  assert.equal(none.reasons[1].text, 'No Instagram linked on Maps or their website, so followers unknown');
  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'not_found' } } }, S({ minFollowers: 0 })).verdict, 'hot');
  assert.equal(LF.evaluate({ ...base, checks: { instagram: { state: 'not_found', handle: 'ghost' } } }, S()).reasons[1].text, "Instagram @ghost doesn't exist, so followers unknown");

  const unread = LF.evaluate({ ...base, reviews: null, rating: null, checks: { instagram: { state: 'not_found' } } }, S({ minReviews: 20 }));
  assert.ok(unread.reasons.some((r) => r.text === "Google reviews couldn't be read" && r.tone === 'neutral'));
  assert.ok(!unread.blockers.includes('reviews'));
  assert.ok(LF.evaluate({ ...base, reviews: 0, checks: { instagram: { state: 'not_found' } } }, S({ minReviews: 20 })).blockers.includes('reviews'));

  const evs = [
    { verdict: 'low', score: 80 },
    { verdict: 'hot', score: 72 },
    { verdict: 'checking', score: 60 },
    { verdict: 'good', score: 55 },
    { verdict: 'hot', score: 90 },
  ].sort(LF.byVerdict);
  assert.deepEqual(evs.map((e) => e.verdict + e.score), ['hot90', 'hot72', 'good55', 'checking60', 'low80']);
});

test('unchecked websites get a message that claims nothing about them', () => {
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', website: 'https://noor.ae', reviews: 40, rating: 4.5 };
  for (const checks of [{}, { site: { state: 'error', error: 'bot protection' } }]) {
    const msg = LF.messageFor({ ...base, checks }, S());
    assert.match(msg, /^Hi 👋 We came across Noor Salon on Google Maps\./);
    assert.doesNotMatch(msg, /had a look|noticed/);
  }
});

test('Google Contacts export neutralises formula-like text too', () => {
  const lead = LF.newLead({ e164: '+971501234567', type: 'mobile' }, { name: '=cmd|x', category: 'Salon' }, 'q');
  const row = LF.contactsRows([lead], S({ checkInstagram: false, contactPrefix: '' }))[1];
  assert.match(row[0], /^'=cmd/);
  assert.match(row[2], /^'=cmd/);
  assert.equal(row[4], '+971501234567', 'the phone number stays as it is');
});

test('checker queue: Instagram pauses, new handles and PageSpeed key changes', () => {
  const needs = (lead, s, paused = 0) => [...ctx.LeadChecker.needs(lead, S(s), paused)];
  const noSite = { e164: '+971501111111', website: '', checks: {} };
  // While Instagram is paused, a lead with no account to look up is settled anyway.
  assert.deepEqual(needs(noSite, {}, Date.now() + 60000), ['instagram']);
  assert.deepEqual(needs({ ...noSite, socials: { instagram: 'noor' } }, {}, Date.now() + 60000), []);
  // Saved as "none linked", then the website check finds one: look it up.
  const later = { ...noSite, website: 'https://noor.ae', checks: { instagram: { state: 'not_found' }, site: { state: 'done', signals: { instagram: ['noor.salon'] } } } };
  assert.deepEqual(needs(later, {}), ['instagram']);
  assert.deepEqual(needs({ ...later, checks: { ...later.checks, instagram: { state: 'not_found', handle: 'noor.salon' } } }, {}), []);
  const ev = LF.evaluate(later, S());
  assert.equal(ev.handle, 'noor.salon');
  assert.ok(ev.reasons.some((r) => r.text === 'Instagram not checked yet'));
  // A PageSpeed error is retried only with a different key.
  const ps = (key) => ({ ...noSite, website: 'https://noor.ae', checks: { site: { state: 'done', signals: {} }, instagram: { state: 'not_found' }, pagespeed: { state: 'error', key } } });
  const tagged = needs(ps('x'), { pagespeedKey: 'abc' });
  assert.deepEqual(tagged, ['pagespeed']);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
