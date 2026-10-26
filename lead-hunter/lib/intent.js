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
   * Without the AI (Phase 6) every post is marked unverified.
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

  /* Openers in Samil's voice: casual, few commas, no semicolons, no dashes. {name} is the poster, {topic} what they asked about. */
  LH.INTENT_OPENERS = {
    website: 'Hey {name} saw your post about the website. I build sites for small businesses here in the UAE and happy to send you a few examples if that helps',
    marketing: 'Hey {name} saw your post about marketing. We run Meta ads for small businesses here in the UAE so happy to share what works if that helps',
    pain: "Hey {name} saw your post and I get it, slow months are rough. I help businesses here get more inquiries through ads so happy to share a couple of ideas if you're open to it",
    hiring: "Hey {name} saw you're hiring for marketing. Before you take someone on full time happy to show you how we run this for other businesses here, might save you the hire",
  };
  LH.intentOpener = (post, settings = {}) => {
    const own = settings.intentOpeners || {};
    const c = post.categories || [];
    const kind = ['hiring', 'website', 'marketing', 'pain'].find((k) => c.includes(k)) || 'marketing';
    const tpl = own[kind] || LH.INTENT_OPENERS[kind];
    // A job ad's "author" is the company, not a person to greet.
    const name = post.job ? '' : String(post.author || '').replace(/^u\//, '').split(/[\s_]+/)[0];
    const first = /^[A-Za-z؀-ۿ]{2,}$/.test(name) && !/\d/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : '';
    return tpl.replace('{name}', first).replace('{topic}', LH.INTENT_LABELS[kind].toLowerCase()).replace(/\s{2,}/g, ' ').replace(/^Hey\s+saw/, 'Hey saw').trim();
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
    post.verified = false; // rules only until the AI checks it (Phase 6)
    post.summary = String(raw.title || raw.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    post.opener = LH.intentOpener(post, s);
    post.keys = LH.intentKeys(post);
    return { keep: true, why: '', post };
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
