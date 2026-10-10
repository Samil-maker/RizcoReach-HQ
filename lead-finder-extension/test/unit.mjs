// Unit tests for leads.js (phone numbers, websites, messages, exports).
// Usage: node lead-finder-extension/test/unit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['../leads.js', '../rules.js']) vm.runInContext(readFileSync(new URL(f, import.meta.url), 'utf8'), ctx, { filename: f });
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
  assert.ok(row.startsWith('"Lead - Noor, ""The"" Salon","Lead - Noor, ""The"" Salon","Noor, ""The"" Salon",Mobile,+971501234567,"Good lead (65/100): No website; No Google reviews'), row);
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

  const down = LF.evaluate({ ...base, website: 'https://noor.ae', ...site({ reachable: false, failure: 'dns' }, ig(2400)) }, s);
  assert.equal(down.opportunity, 'broken');
  assert.equal(down.reasons[0].text, 'Website not loading');
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

test('messages pick the right template and mention real issues', () => {
  const s = S();
  const base = { e164: '+971501111111', phoneType: 'mobile', name: 'Noor Salon', reviews: 40, rating: 4.5 };
  assert.match(LF.messageFor({ ...base, website: '' }, s), /came across Noor Salon on Google Maps and noticed there's no website/);
  const msg = LF.messageFor({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, loadMs: 6600, form: { found: false }, preloader: false }) }, s);
  assert.match(msg, /^Hi 👋 We had a look at Noor Salon's website and noticed it takes about 7 seconds to load and there's no contact form for enquiries\./);
  const onlyPreloader = LF.messageFor({ ...base, website: 'https://noor.ae', ...site({ ...GOOD_SITE, preloader: false, whatsapp: false }) }, S({ criteria: { noWhatsApp: true } }));
  assert.match(onlyPreloader, /noticed there's no WhatsApp button\./);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
