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

test('sendableEmail: with a mailbox check key only confirmed mailboxes go out', () => {
  const key = { verifyKey: 'k' };
  const l = (emailCheck, emails = ['info@glow.ae']) => lead({ emails, emailCheck });
  // No key: the domain must at least receive email.
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'dns' } })), { email: 'info@glow.ae', state: 'unverified' });
  assert.deepEqual(LH.sendableEmail(l({})), { email: '', why: 'waiting' }, 'not looked up yet');
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'bad' } })), { email: '', why: 'bad' });
  assert.deepEqual(LH.sendableEmail(lead()), { email: '', why: 'none' });
  // With a key: confirmed only, the rest wait for the check.
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'dns' } }), key), { email: '', why: 'waiting' });
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'ok' } }), key), { email: 'info@glow.ae', state: 'ok' });
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'risky' } }), key), { email: '', why: 'risky' });
  assert.deepEqual(LH.sendableEmail(l({ 'info@glow.ae': { s: 'risky' } }), { ...key, emailRisky: true }), { email: 'info@glow.ae', state: 'risky' });
  // The confirmed one wins over an earlier address that could not be confirmed.
  assert.deepEqual(LH.sendableEmail(l({ 'a@glow.ae': { s: 'risky' }, 'b@glow.ae': { s: 'ok' } }, ['a@glow.ae', 'b@glow.ae']), key), { email: 'b@glow.ae', state: 'ok' });
});

test('emailsToCheck: nothing once one is confirmed, at most three, the mailbox check only with a key', () => {
  const l = lead({ emails: ['a@glow.ae', 'b@glow.ae', 'c@glow.ae', 'd@glow.ae', '%20x@glow.ae'], emailCheck: { 'a@glow.ae': { s: 'dns' } } });
  assert.deepEqual(LH.emailsToCheck(l).map((x) => x.email), ['b@glow.ae', 'c@glow.ae', 'd@glow.ae'], 'no key: only the ones not looked up');
  assert.deepEqual(LH.emailsToCheck(l, { verifyKey: 'k' }).map((x) => x.email), ['a@glow.ae', 'b@glow.ae', 'c@glow.ae']);
  assert.deepEqual(LH.emailsToCheck({ ...l, emailCheck: { 'b@glow.ae': { s: 'ok' } } }, { verifyKey: 'k' }), []);
});

test('does the domain receive email: reading a DNS answer', () => {
  const mx = (...data) => ({ Status: 0, Answer: data.map((d) => ({ name: 'x.', type: 15, data: d })) });
  assert.deepEqual(LH.dnsVerdict(mx('10 aspmx.l.google.com.', '20 alt1.aspmx.l.google.com.')), { s: 'dns', why: '' });
  assert.match(LH.dnsVerdict({ Status: 3 }).why, /does not exist/);
  assert.match(LH.dnsVerdict({ Status: 0 }).why, /cannot receive email/);
  assert.match(LH.dnsVerdict(mx('0 .')).why, /cannot receive email/, 'a null MX');
  assert.match(LH.dnsVerdict(mx('10 park-mx.above.com.')).why, /parked/);
  assert.match(LH.dnsVerdict({ Status: 0, Answer: [{ type: 5, data: 'x.example.' }] }).why, /cannot receive email/, 'only a CNAME');
  assert.equal(LH.dnsVerdict({ Status: 2 }), null, 'the lookup failed: try again later');
  assert.equal(LH.dnsVerdict(null), null);
});

test('the mailbox check (QuickEmailVerification): its answers in our words', () => {
  const p = (data, status = 200) => LH.verifyParse(status, data);
  assert.deepEqual(p({ result: 'valid', reason: 'accepted_email', disposable: 'false', accept_all: 'false', role: 'true', safe_to_send: 'false' }), { s: 'ok', why: '' }, 'info@ style addresses are fine');
  assert.deepEqual(p({ result: 'invalid', reason: 'rejected_email', safe_to_send: 'false', did_you_mean: '' }), { s: 'bad', why: 'The mailbox does not exist' });
  assert.match(p({ result: 'invalid', reason: 'invalid_domain', did_you_mean: 'x@gmail.com' }).why, /domain does not exist \(did they mean x@gmail\.com\?\)/);
  assert.equal(p({ result: 'valid', accept_all: 'true' }).s, 'risky');
  assert.equal(p({ result: 'valid', disposable: 'true' }).s, 'bad');
  assert.deepEqual(p({ result: 'unknown', reason: 'timeout' }), { s: 'risky', why: 'Their mail server did not answer' });
  assert.equal(p({ success: 'false', message: 'Invalid API key' }, 401).stop, true);
  assert.equal(p({}, 402).out, true);
  assert.deepEqual([p({}, 429).retry, p({}, 429).wait], [true, 60000]);
  assert.equal(p(null, 503).retry, true);
  assert.equal(LH.verifyUrl('a+b@glow.ae', 'k y'), 'https://api.quickemailverification.com/v1/verify?email=a%2Bb%40glow.ae&apikey=k%20y');
  assert.match(LH.verifyUrl('valid@example.com', 'k', true), /\/v1\/verify\/sandbox\?/);
});
