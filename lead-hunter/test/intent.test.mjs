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
  assert.ok(!('opener' in r.post), 'no message is written for you');
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
  assert.equal(LH.intentProcess({ ...job, title: 'Accountant' }, {}, NOW, { needUae: true }).why, 'nomatch');
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

test('AI check with Gemini: picked when its key is set, the request, and every kind of answer', () => {
  const post = { id: 'reddit:a', source: 'reddit', place: 'r/dubai', author: 'u/sarah_dxb', title: 'Need a website for my bakery in JLT', text: 'Any recommendations?' };
  assert.equal(LH.aiProvider({}), '');
  assert.equal(LH.aiProvider({ anthropicKey: 'sk-ant' }), 'claude');
  assert.equal(LH.aiProvider({ anthropicKey: 'sk-ant', geminiKey: 'AIza' }), 'gemini', 'Gemini when both keys are set');
  const { provider, url, init } = LH.aiRequest(post, { geminiKey: 'AIza-test', geminiModel: 'models/gemini-flash-latest' });
  assert.equal(provider, 'gemini');
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.deepEqual([init.method, init.headers['x-goog-api-key']], ['POST', 'AIza-test']);
  assert.ok(!url.includes('key='), 'the key goes in a header, not the address');
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text, LH.AI_SYSTEM);
  assert.equal(body.contents[0].parts[0].text, 'Source: reddit (r/dubai)\nPosted by: u/sarah_dxb\nTitle: Need a website for my bakery in JLT\nText: Any recommendations?');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseJsonSchema, LH.AI_SCHEMA);
  assert.match(LH.aiRequest(post, { geminiKey: 'AIza' }).url, /models\/gemini-flash-lite-latest:generateContent$/, 'the default model');
  // Answers.
  const parse = (status, data) => LH.aiParse(status, data, null, 'gemini');
  const answer = { is_buyer: true, service_needed: 'website', business_type: 'bakery', location: 'JLT, Dubai', urgency: 'high', summary: 'A bakery owner in JLT wants a website.', intent_score: -5 };
  const ok = parse(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] });
  assert.deepEqual(ok.result, { ...answer, intent_score: 0 }, 'thoughts are skipped and the score is kept between 0 and 100');
  const badKey = parse(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } });
  assert.deepEqual([badKey.stop, /^Google did not accept your API key \(400\)/.test(badKey.error)], [true, true]);
  assert.equal(parse(403, { error: { message: 'Permission denied' } }).stop, true);
  assert.match(parse(404, { error: { message: 'models/gemini-9 is not found' } }).error, /could not find that model/);
  assert.equal(parse(404, {}).stop, true);
  assert.equal(parse(400, { error: { status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }).stop, true);
  const minute = parse(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }] } });
  assert.deepEqual([minute.retry, minute.wait, minute.stop], [true, 37000, undefined], 'waits as long as Google says');
  const day = parse(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } });
  assert.deepEqual([day.retry, day.wait, /free daily limit/.test(day.error)], [true, 3600000, true], 'the daily limit waits at least an hour');
  assert.deepEqual([parse(503, {}).retry, parse(503, {}).wait], [true, 60000]);
  assert.match(parse(200, { promptFeedback: { blockReason: 'SAFETY' } }).error, /declined to read this post \(SAFETY\)/);
  assert.match(parse(200, { candidates: [{ finishReason: 'SAFETY' }] }).error, /declined/);
  assert.match(parse(200, { candidates: [{ content: { parts: [{ text: '{"is_buyer": tr' }] }, finishReason: 'MAX_TOKENS' }] }).error, /ran out of room/);
  assert.match(parse(200, { candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }] }).error, /Gemini did not answer in the expected shape/);
  assert.equal(parse(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }).stop, undefined, 'one odd answer does not pause the checks');
});

test('AI check: the request, every kind of answer, and what it does to a post', () => {
  const post = { id: 'reddit:a', source: 'reddit', place: 'r/dubai', author: 'u/sarah_dxb', title: 'Need a website for my bakery in JLT', text: 'Any recommendations?', categories: ['website'], summary: 'Need a website for my bakery in JLT', verified: false };
  const { provider, url, init } = LH.aiRequest(post, { anthropicKey: 'sk-ant-test', aiModel: 'claude-haiku-5-5' });
  assert.equal(provider, 'claude');
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual([init.method, init.headers['x-api-key'], init.headers['anthropic-version'], init.headers['anthropic-dangerous-direct-browser-access']], ['POST', 'sk-ant-test', '2026-10-21', 'true']);
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.deepEqual(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.effort, 'low');
  assert.ok(!('temperature' in body) && !('tool_choice' in body));
  assert.deepEqual(body.output_config.format.schema.required, ['is_buyer', 'service_needed', 'business_type', 'location', 'urgency', 'summary', 'intent_score']);
  assert.equal(body.messages[0].content, 'Source: reddit (r/dubai)\nPosted by: u/sarah_dxb\nTitle: Need a website for my bakery in JLT\nText: Any recommendations?');
  assert.doesNotMatch(LH.AI_SYSTEM, /opener|write a message/i, 'Claude only judges, it writes nothing to send');
  // Answers.
  const answer = { is_buyer: true, service_needed: 'website', business_type: 'bakery', location: 'JLT, Dubai', urgency: 'high', summary: 'A bakery owner in JLT wants a website.', intent_score: 140 };
  const ok = LH.aiParse(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }] });
  assert.deepEqual(ok.result, { ...answer, intent_score: 100 }, 'the score is kept between 0 and 100');
  assert.equal(LH.aiParse(401, { error: { message: 'invalid x-api-key' } }).stop, true);
  assert.equal(LH.aiParse(400, { error: { message: 'Your credit balance is too low' } }).stop, true);
  assert.deepEqual(['retry', 'wait'].map((k) => LH.aiParse(429, {}, '120')[k]), [true, 120000]);
  assert.equal(LH.aiParse(529, {}).retry, true);
  assert.match(LH.aiParse(200, { stop_reason: 'refusal', content: [] }).error, /declined/);
  assert.match(LH.aiParse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }).error, /expected shape/);
  // Applied: a buyer, and not a buyer.
  const yes = LH.aiApply(post, ok.result, NOW);
  assert.deepEqual([yes.verified, yes.notBuyer, yes.score, yes.summary, yes.categories], [true, false, 100, 'A bakery owner in JLT wants a website.', ['website']]);
  const both = LH.aiApply({ ...post, categories: ['pain'] }, { ...answer, service_needed: 'website_and_marketing' }, NOW);
  assert.deepEqual(both.categories, ['website', 'marketing', 'pain']);
  const no = LH.aiApply(post, { ...answer, is_buyer: false, service_needed: 'none', intent_score: 10 }, NOW);
  assert.deepEqual([no.verified, no.notBuyer, no.score, no.categories], [true, true, 10, ['website']]);
});
