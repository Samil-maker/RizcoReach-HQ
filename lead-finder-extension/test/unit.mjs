// Unit tests for leads.js (phone numbers, websites, messages, exports).
// Usage: node lead-finder-extension/test/unit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../leads.js', import.meta.url), 'utf8'), ctx);
const LF = ctx.LF;

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
  assert.equal(LF.whatsAppUrl('+971501234567', 'Hi & bye', 'web'), 'https://web.whatsapp.com/send?phone=971501234567&text=Hi%20%26%20bye');
  assert.equal(LF.whatsAppUrl('+971501234567', 'Hi', 'app'), 'https://wa.me/971501234567?text=Hi');
});

test('Google Contacts and spreadsheet exports', () => {
  const lead = LF.newLead('+971501234567', { name: 'Noor, "The" Salon', category: 'Beauty salon', address: 'Al Barsha 1', mapsUrl: 'https://maps/x' }, 'salon');
  const csv = LF.toCsv(LF.contactsRows([lead], LF.DEFAULT_SETTINGS));
  assert.equal(
    csv,
    'Name,Given Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Notes,Group Membership\r\n' +
      '"Lead - Noor, ""The"" Salon","Lead - Noor, ""The"" Salon","Noor, ""The"" Salon",Mobile,+971501234567,' +
      '"Google Maps search: salon\nBeauty salon\nAl Barsha 1\nhttps://maps/x",RizcoReach Leads ::: * myContacts\r\n'
  );
  const tsv = LF.toTsv(LF.sheetRows([lead]));
  assert.equal(tsv.split('\n')[1].split('\t')[0], '+971 50 123 4567');
  assert.equal(tsv.split('\n').length, 2);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
