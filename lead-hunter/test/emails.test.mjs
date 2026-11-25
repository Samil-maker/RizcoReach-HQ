// Email addresses: finding them without the junk that sticks to them, cleaning them, fixing provider misspellings,
// and which address the cold email file may use. A bounce hurts the sending inbox, so doubt means out.
//   node --test lead-hunter/test/emails.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/emails.js');
await import('../lib/fit.js');
await import('../lib/site-audit.js');
const LH = globalThis.LH;

const ok = (raw, email, fixed = '') => assert.deepEqual(LH.cleanEmail(raw), { email, fixed }, raw);
const bad = (raw, why) => {
  const c = LH.cleanEmail(raw);
  assert.equal(c.email, '', raw);
  assert.match(c.bad, why, `${raw}: ${c.bad}`);
};

test('broken addresses are dropped: web link leftovers, glued phone numbers, page code, impossible shapes', () => {
  bad('%20info@glowsalon.ae', /Odd characters/);
  bad('info%40glow@x.ae', /Not an email address|Odd characters/);
  bad('u003einfo@glow.ae', /Code from the web page/);
  bad('0501234567info@glow.ae', /phone number/);
  bad('+971501234567sales@glow.ae', /Odd characters|phone number/);
  bad('a1b2c3d4e5f6a7b8c9d0e1f2@o123.ingest.sentry.io', /tracking code|placeholder/);
  bad('info..x@glow.ae', /Dots or dashes/);
  bad('info.@glow.ae', /Dots or dashes/);
  bad('info@glow-.ae', /not a real domain/);
  bad('info@glow', /not a real domain/);
  bad('info@glow.a1', /not a real domain/);
  bad('hero@2x.png', /file name/);
  bad(`${'x'.repeat(41)}@glow.ae`, /Too long/);
  bad('', /Not an email/);
  bad('not an email', /Not an email|Odd characters/);
  // A phone number that IS the mailbox name is fine: only letters after a long number are a sign of glue.
  ok('971501234567@gmail.com', '971501234567@gmail.com');
  ok('glow2024@gmail.com', 'glow2024@gmail.com');
});

test('placeholders and platform addresses are never a business inbox', () => {
  for (const e of ['filler@godaddy.com', 'info@example.com', 'email@domain.com', 'you@yourdomain.ae', 'name@company.ae', 'noreply@clinic.ae', 'no-reply@glow.ae', 'postmaster@glow.ae', 'test@glow.ae', 'support@wix.com', 'hello@elementor.com', 'x@mailinator.com'])
    bad(e, /placeholder/);
  for (const e of ['page@facebook.com', 'glow@instagram.com', 'x@google.com']) bad(e, /platform/);
  for (const e of ['info@glossy.ae', 'hello@shineautospa.example', 'bookings@eyelashsecret.com', 'salon123@gmail.com', 'admin@glow.ae', 'sales@glow.salon']) ok(e, e);
});

test('provider misspellings are fixed, and only the part after the @', () => {
  ok('GlowSalon@Gmial.com', 'glowsalon@gmail.com', 'gmial.com → gmail.com');
  ok('glowsalon@gamil.com', 'glowsalon@gmail.com', 'gamil.com → gmail.com');
  ok('glowsalon@gmai.com', 'glowsalon@gmail.com', 'gmai.com → gmail.com');
  ok('glowsalon@gmaill.com', 'glowsalon@gmail.com', 'gmaill.com → gmail.com');
  ok('glowsalon@gmail.co', 'glowsalon@gmail.com', 'gmail.co → gmail.com');
  ok('glowsalon@gmail.con', 'glowsalon@gmail.com', 'gmail.con → gmail.com');
  ok('sara@hotmai.com', 'sara@hotmail.com', 'hotmai.com → hotmail.com');
  ok('sara@hotmial.com', 'sara@hotmail.com', 'hotmial.com → hotmail.com');
  ok('x.y@yaho.com', 'x.y@yahoo.com', 'yaho.com → yahoo.com');
  ok('team@outlok.com', 'team@outlook.com', 'outlok.com → outlook.com');
  ok('sales@icloud.con', 'sales@icloud.com', 'icloud.con → icloud.com');
  ok('info@glow.con', 'info@glow.com', 'glow.con → glow.com');
  ok('info@glow.cmo', 'info@glow.com', 'glow.cmo → glow.com');
  // Real domains one letter away from a provider stay as they are: the checks decide, nothing is guessed.
  for (const e of ['a.person@mail.com', 'gail.smith@gail.com', 'info@fmail.com', 'info@ymail.com', 'info@wahoo.com', 'sara@hotmail.co.uk', 'x.y@yahoo.co.in', 'info@glow.co']) ok(e, e);
  bad('glowsalon@gmail.ae', /end in gmail\.com/);
});

test('Gmail only gives out 6 to 30 letters, numbers and dots: anything else cannot exist', () => {
  bad('glow_salon@gmail.com', /letters, numbers and dots/);
  bad('glow-salon@gmail.com', /letters, numbers and dots/);
  bad('glow@gmail.com', /at least 6/);
  bad('glowsalonbeautycenterdubaimarinajlt@gmail.com', /at most 30/);
  ok('glow.salon.dxb@gmail.com', 'glow.salon.dxb@gmail.com');
  ok('glowsalon+bookings@gmail.com', 'glowsalon+bookings@gmail.com');
  ok('glow_salon@yahoo.com', 'glow_salon@yahoo.com', ''); // other providers allow it
});

test('in page text: escaped forms are read, glued words are cut off, doubtful ones are dropped', () => {
  const find = (t) => LH.emailsInText(t);
  assert.deepEqual(find('Email: info@glow.aeCall us on 050 123 4567'), ['info@glow.ae']);
  assert.deepEqual(find('contact glow.salon@gmail.comWhatsApp 050'), ['glow.salon@gmail.com']);
  assert.deepEqual(find('write to info@glow.ae.We are open daily'), ['info@glow.ae']);
  assert.deepEqual(find('info@glow.com.call us now'), ['info@glow.com']);
  assert.deepEqual(find('info@glow.ae.www.glow.ae'), ['info@glow.ae']);
  assert.deepEqual(find('<a href="mailto:%20book@glowsalon.ae">'), ['book@glowsalon.ae']);
  assert.deepEqual(find('mail us info&#64;glow.ae or sales%40glow.ae'), ['info@glow.ae', 'sales@glow.ae']);
  assert.deepEqual(find('info [at] glow [dot] ae · sales(at)glow(dot)ae'), ['info@glow.ae', 'sales@glow.ae']);
  assert.deepEqual(find('{"email":"\\u003einfo@glow.ae\\u003c"}'), ['info@glow.ae']);
  assert.deepEqual(find('INFO@GLOW.AE'), ['info@glow.ae']);
  assert.deepEqual(find('Tel:0501234567Email:hello@glow.ae'), ['hello@glow.ae']);
  assert.deepEqual(find('0501234567info@glow.ae'), [], 'a phone number glued on: dropped, never guessed');
  assert.deepEqual(find('info@glow.community'), ['info@glow.community'], 'a real ending is kept whole');
  assert.deepEqual(find('a@b.example a@b.example A@B.example'), ['a@b.example'], 'once each');
  assert.deepEqual(find('logo@2x.png filler@godaddy.com noreply@facebook.com'), []);
  assert.deepEqual(find(''), []);
  assert.equal(LH.emailsInPage('a@x.example b@x.example c@x.example d@x.example').length, 3);
});

test('a website page: the mailto link with %20 and the visible text give clean addresses', () => {
  const html = '<a href="mailto:%20Book@EyelashSecret.com?subject=Hi">Email us</a><a href="mailto:filler@godaddy.com">x</a><p>Or info@eyelashsecret.comCall 050 123 4567</p><script>var e="spam@tracker.example"</script>';
  assert.deepEqual(LH.extractContacts(html, 'https://eyelashsecret.com/', 'AE').emails, ['book@eyelashsecret.com', 'info@eyelashsecret.com']);
});

/* ----------------------------------------------------------- states and the export */
const lead = (o = {}) => ({ id: 'x', kind: 'prospect', emails: [], website: null, ...o });

test('emailInfo: cleaned, deduped, best first, with what each check said', () => {
  const l = lead({
    emails: ['%20junk@glow.ae', 'Team@Glow.ae', 'team@glow.ae', 'glowsalon@gmial.com', 'old@glow.ae', 'maybe@other.example'],
    badEmails: ['old@glow.ae'],
    emailCheck: { 'glowsalon@gmail.com': { s: 'ok', at: 5 }, 'team@glow.ae': { s: 'dns' }, 'maybe@other.example': { s: 'risky', why: 'Their domain accepts any address' } },
    emailFrom: { 'glowsalon@gmial.com': 'instagram' },
  });
  const info = LH.emailInfo(l);
  assert.deepEqual(info.map((x) => [x.email, x.state]), [['glowsalon@gmail.com', 'ok'], ['team@glow.ae', 'unverified'], ['maybe@other.example', 'risky'], ['%20junk@glow.ae', 'bad'], ['old@glow.ae', 'bad']]);
  assert.equal(info[0].fixed, 'gmial.com → gmail.com');
  assert.equal(info[0].from, 'instagram', 'where it was found survives the fix');
  assert.equal(info[4].why, 'It bounced before');
  assert.deepEqual(LH.goodEmails(l), ['glowsalon@gmail.com', 'team@glow.ae', 'maybe@other.example']);
  assert.deepEqual(LH.goodEmails(lead()), []);
  assert.deepEqual(LH.goodEmails(null), []);
});

test('which address goes first: their own domain while the site works, a free mailbox once it is down', () => {
  const emails = ['glow.salon@gmail.com', 'info@glow.ae', 'x@agency.example'];
  assert.deepEqual(LH.goodEmails(lead({ emails, website: 'https://www.glow.ae/', site: { state: 'ok' } })), ['info@glow.ae', 'glow.salon@gmail.com', 'x@agency.example']);
  assert.deepEqual(LH.goodEmails(lead({ emails })), ['glow.salon@gmail.com', 'info@glow.ae', 'x@agency.example'], 'no website known');
});

test('sendableEmail: the best address that is not broken or bounced', () => {
  const l = (emails = ['info@glow.ae'], extra = {}) => lead({ emails, website: 'https://glow.ae/', ...extra });
  assert.deepEqual(LH.sendableEmail(l()), { email: 'info@glow.ae', state: 'unchecked' });
  assert.deepEqual(LH.sendableEmail(l(['glow.dxb@gmail.com', 'info@glow.ae'])).email, 'info@glow.ae', 'their own domain first');
  assert.deepEqual(LH.sendableEmail(l(['info@glow.ae'], { badEmails: ['info@glow.ae'] })), { email: '', why: 'bad' }, 'bounced before');
  assert.deepEqual(LH.sendableEmail(l(['info@glow.ae', 'glow.dxb@gmail.com'], { badEmails: ['info@glow.ae'] })).email, 'glow.dxb@gmail.com');
  assert.deepEqual(LH.sendableEmail(lead()), { email: '', why: 'none' });
});

