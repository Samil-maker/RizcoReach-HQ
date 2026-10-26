/* Lead Hunter: Intent Radar rules (pure, unit-tested in node).
   A post goes through: keyword match -> seller filter -> (AI, Phase 6) -> dedupe by post URL and author -> score.
   Only posts from the last 14 days count. Nothing here fetches anything. */
(function (root) {
  const LH = (root.LH = root.LH || {});
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  /* Phrases that show someone wants to buy, per kind. Matched as whole words, any case. */
  LH.INTENT_KEYWORDS = {
    website: lines(`need a website
need a new website
looking for a web designer
looking for a website designer
looking for a web developer
recommend a web designer
recommend a web developer
anyone know a web designer
anyone know a good web designer
website developer
website designer
web design company
build a website
build my website
make a website
redesign my website
website redesign
fix my website
landing page
shopify developer
shopify store setup
wordpress developer
ecommerce website
e-commerce website
online store
website for my business`),
    marketing: lines(`marketing agency
digital marketing agency
social media manager
social media agency
social media marketing
manage my instagram
manage our social media
meta ads
facebook ads
instagram ads
tiktok ads
google ads
ads specialist
media buyer
performance marketing
lead generation
need more leads
seo agency
seo expert
content creator for my business
marketing help
marketing freelancer
recommend a marketing agency
anyone know a marketing agency
grow my business online`),
    pain: lines(`no customers
not getting customers
not getting clients
not getting enough customers
struggling to get customers
struggling to get clients
how do i get clients
how do you get clients
how to get more customers
business is slow
sales are slow
slow season
low sales
ads are not working
ads not working
wasted money on ads
marketing is not working
agency scammed me
bad experience with an agency
no leads
need more customers
need more clients`),
    hiring: lines(`hiring a marketing
hiring marketing
we are hiring
we're hiring
now hiring
marketing executive
marketing coordinator
marketing manager
digital marketing executive
digital marketing specialist
social media executive
social media specialist
social media coordinator
content creator
performance marketing specialist
growth marketer`),
    arabic: lines(`مصمم مواقع
تصميم موقع
تصميم مواقع
موقع إلكتروني
متجر إلكتروني
شركة تسويق
وكالة تسويق
تسويق إلكتروني
تسويق رقمي
إعلانات انستقرام
إعلانات فيسبوك
إدارة حسابات التواصل
أبحث عن مسوق
أحتاج موقع
محتاج موقع`),
  };
  /* A post with any of these is someone selling, not buying. */
  LH.SELLER_WORDS = lines(`we offer
our agency
our services
our team can
dm me
dm for
dm us
hire me
i am a freelance
i'm a freelance
i am a web designer
i'm a web designer
i am a digital marketer
i'm a digital marketer
we are a
we provide
we specialize
we specialise
contact us
check out my
my portfolio
our portfolio
available for projects
open for projects
taking new clients
accepting new clients
starting from aed
special offer
limited offer
discount
promo code
free consultation
free audit
for hire
نقدم خدمات
تواصل معنا
خصم`);
  LH.INTENT_LABELS = { website: 'Website buyer', marketing: 'Marketing buyer', pain: 'Owner pain', hiring: 'Hiring for marketing', arabic: 'Arabic' };
  const UAE = /\b(uae|u\.a\.e|dubai|abu dhabi|abudhabi|sharjah|ajman|ras al khaimah|rak|fujairah|umm al quwain|al ain|emirates)\b|الإمارات|دبي|أبوظبي|الشارقة/i;
  LH.mentionsUAE = (text) => UAE.test(String(text || ''));

  /** Your lists from Settings (one phrase per line), or the defaults. */
  LH.intentListsFor = (settings = {}) => {
    const own = settings.intentKeywords || {};
    const out = {};
    for (const [k, list] of Object.entries(LH.INTENT_KEYWORDS)) out[k] = own[k] != null ? LH.parseLines(own[k]).map((x) => x.toLowerCase()) : list;
    return { keywords: out, seller: settings.sellerWords != null ? LH.parseLines(settings.sellerWords).map((x) => x.toLowerCase()) : LH.SELLER_WORDS };
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole words in Latin text (a plural counts: "web designers"); Arabic has no \b, so a plain contains is used there.
  const has = (text, phrase) => (/[؀-ۿ]/.test(phrase) ? text.includes(phrase) : new RegExp(`(^|[^\\p{L}\\p{N}])${esc(phrase).replace(/\s+/g, '\\s+')}(?:s|es)?($|[^\\p{L}\\p{N}])`, 'iu').test(text));

  /**
   * { categories: ['website', ...], hits: ['need a website', ...], seller: 'we offer' | '' }.
   * Arabic phrases count toward the kind they name (website or marketing) as well as "arabic".
   */
  LH.intentMatch = (text, settings = {}) => {
    const t = String(text || '').toLowerCase();
    const { keywords, seller } = LH.intentListsFor(settings);
    const categories = [];
    const hits = [];
    for (const [k, list] of Object.entries(keywords)) {
      const found = list.filter((p) => has(t, p));
      if (!found.length) continue;
      hits.push(...found);
      if (k === 'arabic') {
        if (found.some((p) => /موقع|متجر/.test(p))) categories.push('website');
        if (found.some((p) => /تسويق|مسوق|إعلانات|حسابات/.test(p))) categories.push('marketing');
      }
      categories.push(k);
    }
    const sellerHit = seller.find((p) => has(t, p)) || '';
    return { categories: [...new Set(categories)], hits: [...new Set(hits)].slice(0, 8), seller: sellerHit };
  };

  /** A job title that means the company is hiring for marketing. */
  LH.isMarketingJob = (title) => /\b(marketing|social media|content creator|content manager|digital|seo|ppc|media buyer|growth|brand manager|community manager)\b|تسويق/i.test(String(title || ''));

  /**
   * "2h", "3d", "1w", "2mo", "5 days ago", "Yesterday", "Just now", "October 12", "12 Oct", an ISO date -> a time, else null.
   * Facebook and LinkedIn show ages like this. A date without a year is this year (or last year if that is in the future).
   */
  LH.parseAge = (text, now = Date.now()) => {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Date.parse(s) || null;
    if (/^(just now|now|a few seconds ago)/.test(s)) return now;
    if (/^yesterday/.test(s)) return now - 864e5;
    const rel = s.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|mos|months?|y|yr|yrs|years?)\b/);
    if (rel) {
      const n = Number(rel[1]);
      const u = rel[2];
      const unit = /^s/.test(u) ? 1e3 : /^(m|min|mins|minutes?)$/.test(u) ? 6e4 : /^h/.test(u) ? 36e5 : /^d/.test(u) ? 864e5 : /^w/.test(u) ? 6048e5 : /^mo/.test(u) ? 2592e6 : 31536e6;
      return now - n * unit;
    }
    const m = s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?/) || s.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?/);
    if (m) {
      const [month, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
      const year = m[3] ? Number(m[3]) : new Date(now).getFullYear();
      let t = Date.parse(`${day} ${month} ${year}`);
      if (!t) return null;
      if (!m[3] && t > now + 864e5) t = Date.parse(`${day} ${month} ${year - 1}`);
      return t || null;
    }
    return null;
  };

  /** Same post (crossposted, or seen twice): its address, else its author and opening words. */
  LH.intentKeys = (post) => {
    const keys = [];
    if (post.url) keys.push(`u:${String(post.url).replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()}`);
    const words = LH.normName(`${post.title || ''} ${post.text || ''}`).slice(0, 80);
    if (post.author && words) keys.push(`a:${String(post.author).toLowerCase()}|${words}`);
    return keys;
  };

  /**
   * Rules score from 0 to 100: what kind of intent, how fresh, in the UAE, asking a question.
   * Until the AI check (LH.aiRequest below) reads it, a post is marked unverified.
   */
  LH.intentScore = (post, now = Date.now()) => {
    const c = post.categories || [];
    let s = c.includes('website') || c.includes('marketing') ? 55 : c.includes('hiring') ? 45 : c.includes('pain') ? 40 : 25;
    if (c.length > 1) s += 5;
    const age = post.createdAt ? now - post.createdAt : null;
    if (age != null) s += age <= 2 * 864e5 ? 20 : age <= 7 * 864e5 ? 10 : 0;
    if (post.uae) s += 10;
    if (/\?|recommend|anyone know|suggest|looking for|need/i.test(`${post.title || ''} ${post.text || ''}`)) s += 10;
    return Math.max(0, Math.min(100, s));
  };

  /**
   * One post through the rules. Returns { keep, why, post } where why is 'nomatch' | 'seller' | 'old' | 'foreign'.
   * maxDays: only posts this new. needUae: r/smallbusiness and the like only count when the post mentions the UAE.
   */
  LH.intentProcess = (raw, settings = {}, now = Date.now(), { needUae = false } = {}) => {
    const s = { ...LH.DEFAULT_SETTINGS, ...settings };
    const text = `${raw.title || ''}\n${raw.text || ''}`;
    const m = LH.intentMatch(text, s);
    const post = { ...raw, categories: m.categories, hits: m.hits, uae: LH.mentionsUAE(text) || !needUae };
    if (raw.job) {
      // A job ad: a marketing role means the company is hiring for marketing.
      if (!LH.isMarketingJob(raw.title)) return { keep: false, why: 'nomatch', post };
      post.categories = ['hiring'];
      post.hits = [raw.title];
    } else {
      if (!m.categories.length) return { keep: false, why: 'nomatch', post };
      if (m.seller) return { keep: false, why: 'seller', post: { ...post, seller: m.seller } };
    }
    if (post.createdAt && now - post.createdAt > s.intentMaxDays * 864e5) return { keep: false, why: 'old', post };
    if (needUae && !LH.mentionsUAE(text)) return { keep: false, why: 'foreign', post };
    post.score = LH.intentScore(post, now);
    post.verified = false; // rules only until the AI checks it
    post.summary = String(raw.title || raw.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    post.keys = LH.intentKeys(post);
    return { keep: true, why: '', post };
  };

  /* ------------------------------------------------------------- AI check */
  /*
   * Claude reads a post the rules kept and says whether the person is really a buyer for what you sell. The answer
   * is JSON in a fixed shape (structured outputs), so it can be read without guessing.
   */
  LH.AI_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      is_buyer: { type: 'boolean' },
      service_needed: { type: 'string', enum: ['website', 'seo', 'marketing', 'website_and_marketing', 'other', 'none'] },
      business_type: { type: 'string' },
      location: { type: 'string' },
      urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string' },
      intent_score: { type: 'integer' },
    },
    required: ['is_buyer', 'service_needed', 'business_type', 'location', 'urgency', 'summary', 'intent_score'],
  };
  LH.AI_SYSTEM = `You screen social media posts for a one person marketing agency in the UAE. It sells Meta ads management (Facebook and Instagram ads), websites, and SEO for websites, to small owner run businesses.

For each post decide whether the person posting is a potential buyer of those services:
- A buyer is a business owner, manager or someone acting for a business who wants a website, SEO, social media or paid ads help, or more customers for their business. A company hiring a marketing or social media person counts as a buyer too, since they need marketing.
- Not a buyer: anyone selling or advertising these services (agencies, freelancers, people sharing their portfolio), job seekers, people asking for consumer recommendations (a good restaurant, a mechanic for their own car), students, spam, or posts with nothing to do with buying these services.
- The business should be in the UAE. If the post does not say where, judge from the group or subreddit it was posted in.

Fill in every field:
- service_needed: what they need, or "none" when they are not a buyer.
- business_type: the kind of business, for example "bakery" or "car detailing studio", or "unknown".
- location: the city or area in the UAE if mentioned, else "unknown".
- urgency: high when they need it now or soon, medium when they are looking around, low otherwise.
- summary: one plain sentence saying who they are and what they want.
- intent_score: 0 to 100, how likely they are to pay for these services soon. Under 30 when they are not a buyer.`;

  /** The request for one post: Claude's Messages API, called straight from the extension with your key. */
  LH.aiRequest = (post, settings = {}) => {
    const lines = [
      `Source: ${post.source}${post.place ? ` (${post.place})` : ''}`,
      post.job ? `Job ad: ${post.title} at ${post.company || 'a company'}` : '',
      post.author ? `Posted by: ${post.author}${post.headline ? `, ${post.headline}` : ''}` : '',
      post.title && !post.job ? `Title: ${post.title}` : '',
      `Text: ${String(post.text || '').slice(0, 3000) || '(no text)'}`,
    ].filter(Boolean);
    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.anthropicKey || '',
          'anthropic-version': '2026-10-21',
          'anthropic-dangerous-direct-browser-access': 'true', // a key you entered yourself, kept in this browser
        },
        body: JSON.stringify({
          model: settings.aiModel || 'claude-haiku-5-5',
          max_tokens: 2048,
          system: LH.AI_SYSTEM,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: LH.AI_SCHEMA } },
          messages: [{ role: 'user', content: lines.join('\n') }],
        }),
      },
    };
  };

  /**
   * The answer: { result } or { error, retry, stop }. retry: try again later (busy, rate limited);
   * stop: nothing will work until you fix it (wrong key, no credit), so the checks pause.
   */
  LH.aiParse = (status, data, retryAfter) => {
    const message = (data && data.error && data.error.message) || '';
    if (status === 401 || status === 403) return { error: `Claude did not accept your API key (${status})${message ? `: ${message}` : ''}`, stop: true };
    if (status === 400 && /credit|billing|balance/i.test(message)) return { error: `Claude says: ${message}`, stop: true };
    if (status === 429 || status === 529 || status >= 500) return { error: status === 429 ? 'Claude rate limit, trying again later' : `Claude is busy (${status}), trying again later`, retry: true, wait: Math.max(30, Number(retryAfter) || 60) * 1000 };
    if (status !== 200 || !data) return { error: `Claude answered ${status}${message ? `: ${message}` : ''}` };
    if (data.stop_reason === 'refusal') return { error: 'Claude declined to read this post' };
    if (data.stop_reason === 'max_tokens') return { error: 'Claude ran out of room answering' };
    const text = ((data.content || []).find((b) => b && b.type === 'text') || {}).text || '';
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return { error: 'Claude did not answer in the expected shape' };
    }
    if (typeof result.is_buyer !== 'boolean') return { error: 'Claude did not answer in the expected shape' };
    result.intent_score = Math.max(0, Math.min(100, Math.round(Number(result.intent_score) || 0)));
    return { result };
  };

  /** A post with Claude's verdict on it. Its kinds follow what Claude says they need; hiring and owner pain stay. */
  LH.aiApply = (post, result, now = Date.now()) => {
    const need = { website: ['website'], seo: ['website'], marketing: ['marketing'], website_and_marketing: ['website', 'marketing'] }[result.service_needed] || [];
    const keep = (post.categories || []).filter((c) => c === 'hiring' || c === 'pain');
    return {
      ...post,
      verified: true,
      checkedAt: now,
      ai: result,
      notBuyer: !result.is_buyer,
      score: result.intent_score,
      summary: result.summary || post.summary,
      categories: result.is_buyer && (need.length || keep.length) ? [...new Set([...need, ...keep])] : post.categories,
    };
  };

  /** Reddit's listing JSON (official API or the public .json) as posts. */
  LH.redditPosts = (json, sub) =>
    ((((json || {}).data || {}).children) || [])
      .map((c) => c && c.data)
      .filter((d) => d && d.id && !d.stickied && !d.removed_by_category)
      .map((d) => ({
        id: `reddit:${d.id}`,
        source: 'reddit',
        place: `r/${d.subreddit || sub}`,
        url: `https://www.reddit.com${d.permalink || `/r/${sub}/comments/${d.id}/`}`,
        author: d.author ? `u/${d.author}` : '',
        title: String(d.title || '').slice(0, 300),
        text: String(d.selftext || '').slice(0, 3000),
        createdAt: d.created_utc ? d.created_utc * 1000 : null,
      }));
})(typeof globalThis !== 'undefined' ? globalThis : self);
