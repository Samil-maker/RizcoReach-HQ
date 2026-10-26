// Unit tests for the Intent Radar rules: `node --test lead-hunter/test/*.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../lib/common.js');
await import('../lib/intent.js');
const LH = globalThis.LH;
const NOW = Date.UTC(2026, 9, 26, 12);
const H = 36e5;

test('intent keywords: buyers, owner pain, hiring, Arabic, and sellers', () => {
  assert.deepEqual(LH.intentMatch('Need a website for my bakery in JLT, any recommendations?').categories, ['website']);
  assert.deepEqual(LH.intentMatch('Can anyone recommend web designers? We need a landing pages too').categories, ['website']);
  assert.deepEqual(LH.intentMatch('Looking for someone to run Facebook ads and Instagram ads for my salon').categories, ['marketing']);
  assert.deepEqual(LH.intentMatch('Business is slow this summer, ads not working at all').categories, ['pain']);
  assert.deepEqual(LH.intentMatch("We're hiring a Social Media Executive in Dubai").categories, ['hiring']);
  assert.deepEqual(LH.intentMatch('أحتاج موقع لمطعمي في دبي').categories, ['website', 'arabic']);
  assert.deepEqual(LH.intentMatch('أبحث عن مسوق لإدارة حسابات التواصل').categories, ['marketing', 'arabic']);
  assert.deepEqual(LH.intentMatch('Best shawarma in Dubai?').categories, []);
  assert.equal(LH.intentMatch('Need a website? We offer web design from AED 999, DM me').seller, 'we offer');
  assert.equal(LH.intentMatch('Need a website for my shop').seller, '');
  assert.deepEqual(LH.intentMatch('the websitebuilder is down').categories, [], 'whole words only');
  // Your own lists from Settings.
  assert.deepEqual(LH.intentMatch('need a logo', { intentKeywords: { website: 'need a logo' } }).categories, ['website']);
  assert.equal(LH.intentMatch('dm me', { sellerWords: 'nothing here' }).seller, '');
  assert.ok(LH.mentionsUAE('my shop in Sharjah') && LH.mentionsUAE('في دبي') && !LH.mentionsUAE('my shop in Ohio'));
  assert.ok(LH.isMarketingJob('Social Media Executive') && LH.isMarketingJob('Digital Marketing Specialist') && !LH.isMarketingJob('Accountant'));
});

test('post ages from Facebook and LinkedIn', () => {
  assert.deepEqual(['2h', '3d', '1w', '2mo', '5 days ago', '45 mins', 'Just now', 'Yesterday at 3:15 PM'].map((s) => (NOW - LH.parseAge(s, NOW)) / H), [2, 72, 168, 1440, 120, 0.75, 0, 24]);
  assert.equal(new Date(LH.parseAge('October 12', NOW)).getUTCDate(), 12);
  assert.equal(new Date(LH.parseAge('12 Oct', NOW)).getUTCMonth(), 9);
  assert.equal(new Date(LH.parseAge('December 20', NOW)).getUTCFullYear(), 2025, 'a date later this year is last year');
  assert.equal(LH.parseAge('2026-10-20', NOW), Date.UTC(2026, 9, 20));
  assert.equal(LH.parseAge('Sponsored', NOW), null);
  assert.equal(LH.parseAge('', NOW), null);
});

test('one post through the rules: keep, seller, too old, not UAE, unknown date', () => {
  const buyer = { id: 'reddit:a', source: 'reddit', url: 'https://www.reddit.com/r/dubai/comments/a/x/', author: 'u/sarah_dxb', title: 'Need a website for my bakery in JLT, any recommendations?', text: '', createdAt: NOW - 3 * H };
  const r = LH.intentProcess(buyer, {}, NOW);
  assert.equal(r.keep, true);
  assert.deepEqual([r.post.categories, r.post.verified, r.post.score], [['website'], false, 95]);
  assert.equal(r.post.opener, 'Hey Sarah saw your post about the website. I build sites for small businesses here in the UAE and happy to send you a few examples if that helps');
  assert.ok(!/[;—–]| - /.test(r.post.opener), 'no semicolons or dashes');
  assert.deepEqual(r.post.keys, ['u:https://www.reddit.com/r/dubai/comments/a/x', 'a:u/sarah_dxb|need a website for my bakery in jlt any recommendations']);
  assert.equal(LH.intentProcess({ ...buyer, text: 'We offer websites, DM me' }, {}, NOW).why, 'seller');
  assert.equal(LH.intentProcess({ ...buyer, createdAt: NOW - 15 * 864e5 }, {}, NOW).why, 'old');
  assert.equal(LH.intentProcess({ ...buyer, createdAt: NOW - 15 * 864e5 }, { intentMaxDays: 30 }, NOW).keep, true);
  assert.equal(LH.intentProcess({ ...buyer, title: 'Need a website for my shop in Ohio' }, {}, NOW, { needUae: true }).why, 'foreign');
  assert.equal(LH.intentProcess({ ...buyer, title: 'Need a website for my shop in Ajman' }, {}, NOW, { needUae: true }).keep, true);
  assert.equal(LH.intentProcess({ ...buyer, title: 'Best shawarma?' }, {}, NOW).why, 'nomatch');
  const undated = LH.intentProcess({ ...buyer, createdAt: null }, {}, NOW);
  assert.deepEqual([undated.keep, undated.post.score], [true, 75], 'kept, without the freshness points');
  // A job ad: only marketing roles count, as hiring.
  const job = { id: 'linkedin:job:1', source: 'linkedin', job: true, title: 'Social Media Executive', company: 'Gloss Garage', author: 'Gloss Garage', text: 'Gloss Garage · Dubai, United Arab Emirates', createdAt: NOW - 48 * H };
  const j = LH.intentProcess(job, {}, NOW, { needUae: true });
  assert.deepEqual([j.keep, j.post.categories, j.post.hits], [true, ['hiring'], ['Social Media Executive']]);
  assert.match(j.post.opener, /^Hey saw you're hiring for marketing/);
  assert.equal(LH.intentProcess({ ...job, title: 'Accountant' }, {}, NOW, { needUae: true }).why, 'nomatch');
  // Your own openers.
  assert.equal(LH.intentProcess(buyer, { intentOpeners: { website: 'Hi {name}, quick one' } }, NOW).post.opener, 'Hi Sarah, quick one');
});

test('Reddit listings: posts with their age and link, pinned and removed ones left out', () => {
  const json = {
    data: {
      children: [
        { data: { id: 'a1', subreddit: 'dubai', permalink: '/r/dubai/comments/a1/need_a_website/', author: 'sarah_dxb', title: 'Need a website', selftext: 'For my bakery', created_utc: NOW / 1000 - 3600 } },
        { data: { id: 'a2', subreddit: 'dubai', permalink: '/r/dubai/comments/a2/rules/', author: 'mod', title: 'Rules', stickied: true, created_utc: NOW / 1000 } },
        { data: { id: 'a3', subreddit: 'dubai', permalink: '/r/dubai/comments/a3/x/', author: '[deleted]', title: 'x', removed_by_category: 'moderator', created_utc: NOW / 1000 } },
      ],
    },
  };
  assert.deepEqual(LH.redditPosts(json, 'dubai'), [
    { id: 'reddit:a1', source: 'reddit', place: 'r/dubai', url: 'https://www.reddit.com/r/dubai/comments/a1/need_a_website/', author: 'u/sarah_dxb', title: 'Need a website', text: 'For my bakery', createdAt: NOW - 3600e3 },
  ]);
  assert.deepEqual(LH.redditPosts(null, 'dubai'), []);
});
