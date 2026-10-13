/* Lead Hunter: shared helpers for the background worker, content scripts and pages.
   Classic script: attaches everything to globalThis.LH so it loads via <script>,
   importScripts() and manifest content_scripts alike. */
(function (root) {
  const LH = (root.LH = root.LH || {});

  LH.COUNTRIES = [
    { code: 'AE', name: 'United Arab Emirates', dial: '971' },
    { code: 'SA', name: 'Saudi Arabia', dial: '966' },
    { code: 'QA', name: 'Qatar', dial: '974' },
    { code: 'KW', name: 'Kuwait', dial: '965' },
    { code: 'BH', name: 'Bahrain', dial: '973' },
    { code: 'OM', name: 'Oman', dial: '968' },
    { code: 'EG', name: 'Egypt', dial: '20' },
    { code: 'JO', name: 'Jordan', dial: '962' },
    { code: 'GB', name: 'United Kingdom', dial: '44' },
    { code: 'US', name: 'United States', dial: '1' },
    { code: 'CA', name: 'Canada', dial: '1' },
    { code: 'AU', name: 'Australia', dial: '61' },
    { code: 'IN', name: 'India', dial: '91' },
    { code: 'PK', name: 'Pakistan', dial: '92' },
    { code: 'ALL', name: 'All countries', dial: '' },
  ];
  LH.country = (code) => LH.COUNTRIES.find((c) => c.code === code) || LH.COUNTRIES[0];

  LH.NICHES = {
    'Car detailing': ['car detailing', 'ceramic coating', 'paint protection film', 'car polishing', 'window tinting', 'car wash'],
    'Auto repair & garages': ['car service', 'car repair', 'auto garage', 'car maintenance'],
    'Aesthetic clinics': ['aesthetic clinic', 'botox', 'laser hair removal', 'skin clinic', 'fillers'],
    'Dental clinics': ['dental clinic', 'teeth whitening', 'dental implants', 'braces'],
    'Salons & spas': ['hair salon', 'beauty salon', 'nail salon', 'spa', 'massage'],
    'Fitness': ['gym', 'personal trainer', 'pilates', 'yoga studio', 'fitness'],
    'Home services': ['cleaning services', 'deep cleaning', 'pest control', 'ac repair', 'ac maintenance', 'handyman'],
    'Movers & storage': ['movers', 'moving company', 'storage units'],
    'Interiors & fit-out': ['interior design', 'fit out', 'home renovation', 'kitchen cabinets'],
    'Restaurants & cafes': ['restaurant', 'cafe', 'catering', 'food delivery'],
    'Business setup': ['business setup', 'company formation', 'golden visa', 'pro services'],
    'Events & photography': ['event management', 'wedding planner', 'photographer', 'videographer'],
    'Education & training': ['training center', 'courses', 'tutoring', 'language school'],
  };

  /* ------------------------------------------------- Meta ads prospecting */
  // Google Maps search terms per niche, in the order the 2026 niche research recommends them:
  // short sales cycle, AED 800+ first ticket, room for a lead-confirmation step.
  LH.AD_NICHES = {
    'Car detailing & PPF': ['paint protection film', 'ceramic coating', 'car detailing', 'window tinting', 'car polishing'],
    'Aesthetic clinics': ['aesthetic clinic', 'laser hair removal', 'skin clinic', 'medical spa', 'hydrafacial'],
    'Boutique fitness (Oct–Jan)': ['reformer pilates', 'pilates studio', 'ems training', 'ladies gym', 'boutique gym'],
    'AC servicing (from late Jan)': ['ac duct cleaning', 'ac maintenance', 'ac service company'],
  };
  LH.AREAS = {
    Dubai: ['Al Quoz', 'Dubai Investment Park', 'Al Barsha', 'Dubai Marina', 'JLT', 'JBR', 'Business Bay', 'Downtown Dubai', 'DIFC', 'Jumeirah', 'Al Wasl', 'Umm Suqeim', 'Dubai Hills', 'Arabian Ranches', 'JVC', 'Motor City', 'Al Karama', 'Deira', 'Bur Dubai', 'Mirdif', 'Al Nahda', 'Silicon Oasis', 'Palm Jumeirah', 'Ras Al Khor'],
    'Abu Dhabi': ['Al Reem Island', 'Khalifa City', 'Al Raha', 'Corniche', 'Al Bateen', 'Saadiyat', 'Yas Island', 'Al Khalidiyah', 'Mohammed Bin Zayed City'],
    Sharjah: ['Al Majaz', 'Al Nahda Sharjah', 'Al Khan', 'Muwaileh', 'Al Taawun'],
  };
  // Long sales cycles, restricted ads, or poor fit for a lead-confirmation offer: skipped as Meta-ads prospects.
  LH.AVOID_WORDS =
    /\b(renovation|contractor|contracting|construction|fit[- ]?out|interior design|joinery|flooring|landscaping|swimming pool|handyman|real estate|property|developer|off[- ]?plan|golden visa|business setup|plastic surge(on|ry)|surgery cent(er|re)|rhinoplasty|liposuction|hair transplant|ozempic|mounjaro|semaglutide|weight loss injection|mobile car wash|police[- ]proof|massage|maid)\b|ترميم|تشطيبات|مقاولات|عقارات|جراحة تجميل|مساج|خادمات/i;

  const STOP_WORDS = /\b(llc|l\.l\.c|fze|fzco|fz|dmcc|est|establishment|trading|services?|company|co|the|and|uae|dubai|abu dhabi|sharjah|ltd|limited|inc|group|official)\b/g;
  const nameTokens = (s) =>
    new Set(
      String(s || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(STOP_WORDS, ' ')
        .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
        .trim()
        .split(' ')
        .filter((t) => t.length > 1)
        .map((t) => (t.length > 4 && /[^s]s$/.test(t) ? t.slice(0, -1) : t)), // "aesthetics" = "aesthetic"
    );
  /** 0..1 similarity of two business names; short generic names score lower than exact multi-word matches. */
  LH.nameMatch = (a, b) => {
    const A = nameTokens(a);
    const B = nameTokens(b);
    if (!A.size || !B.size) return 0;
    const inter = [...A].filter((t) => B.has(t)).length;
    const overlap = inter / Math.min(A.size, B.size);
    const jaccard = inter / new Set([...A, ...B]).size;
    return (overlap + jaccard) / 2;
  };

  LH.STATUSES = [
    { id: 'new', label: 'New' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'followup', label: 'Follow up' },
    { id: 'replied', label: 'Replied' },
    { id: 'meeting', label: 'Meeting booked' },
    { id: 'won', label: 'Won' },
    { id: 'lost', label: 'Not interested' },
    { id: 'skip', label: 'Skip' },
  ];

  LH.DEFAULT_SETTINGS = {
    country: 'AE',
    myName: '',
    agency: 'RizcoReach',
    myPhone: '+971 56 846 1835',
    myWebsite: 'rizcoreach.ae',
    auditLinkBase: 'https://www.rizcoreach.ae/tools/website-audit?url=',
    autoEnrich: true,
    pagespeedKey: '',
    pagespeedAuto: false,
    placesKey: '',
    placesAuto: true,
    placesMonthlyCap: 950,
    scrollDelayMs: 1800,
    queueSite: 'https://www.rizcoreach.ae',
    queueKey: '',
    queueKeyAt: 0,
    adsCity: 'Dubai',
    adsOffer: 'AED 600 to start, and the other AED 600 only after you get your first customer from the ads',
    adTemplates: null, // null = use LH.DEFAULT_AD_TEMPLATES
    templates: null, // null = use LH.DEFAULT_TEMPLATES
  };

  /* ------------------------------------------------------------- Ad Library URLs */
  LH.adLibraryUrl = ({ keyword = '', country = 'AE', activeOnly = true } = {}) => {
    const u = new URL('https://www.facebook.com/ads/library/');
    u.searchParams.set('active_status', activeOnly ? 'active' : 'all');
    u.searchParams.set('ad_type', 'all');
    u.searchParams.set('country', country || 'ALL');
    u.searchParams.set('is_targeted_country', 'false');
    u.searchParams.set('media_type', 'all');
    u.searchParams.set('q', keyword);
    u.searchParams.set('search_type', 'keyword_unordered');
    return u.toString();
  };
  LH.pageAdsUrl = (pageId, country = 'ALL', name = '') =>
    /^\d+$/.test(String(pageId))
      ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country || 'ALL')}&view_all_page_id=${encodeURIComponent(pageId)}`
      : LH.adLibraryUrl({ keyword: name, country });

  /* --------------------------------------------------------------------- Links */
  const HOST_KINDS = [
    [/(^|\.)(facebook\.com|fb\.com|fb\.me|fb\.watch)$/, 'facebook'],
    [/(^|\.)(m\.me|messenger\.com)$/, 'messenger'],
    [/(^|\.)(instagram\.com|instagr\.am|ig\.me)$/, 'instagram'],
    [/(^|\.)(wa\.me|whatsapp\.com|wa\.link)$/, 'whatsapp'],
    [/(^|\.)(tiktok\.com)$/, 'tiktok'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
    [/(^|\.)(linktr\.ee|linktree\.com|beacons\.ai|lnk\.bio|taplink\.cc|bio\.link)$/, 'linkinbio'],
    [/(^|\.)(play\.google\.com|apps\.apple\.com|itunes\.apple\.com|onelink\.me|app\.link)$/, 'app'],
    [/(^|\.)(snapchat\.com|x\.com|twitter\.com|linkedin\.com|t\.me|telegram\.me|pinterest\.com|threads\.net)$/, 'social'],
    [/(^|\.)(google\.com|goo\.gl|g\.co|g\.page)$/, 'google'],
    [/(^|\.)(calendly\.com|forms\.gle|typeform\.com|jotform\.com|tally\.so)$/, 'form'],
  ];
  const DESTINATION = {
    whatsapp: 'WhatsApp',
    messenger: 'Messenger',
    instagram: 'their Instagram',
    facebook: 'their Facebook page',
    linkinbio: 'a link-in-bio page',
    form: 'a third-party form',
    google: 'a Google page',
    app: 'an app store',
    tiktok: 'TikTok',
    social: 'a social profile',
    leadform: 'a Facebook instant form',
  };
  LH.destinationLabel = (kind) => DESTINATION[kind] || 'a social profile';

  LH.safeUrl = (raw, base) => {
    if (!raw || typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!s) return null;
    if (/^www\./i.test(s) || (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s) && !/^[a-z]+:/i.test(s))) s = 'https://' + s;
    try {
      return new URL(s, base);
    } catch {
      return null;
    }
  };

  /** Unwrap Facebook's outbound redirector (l.facebook.com/l.php?u=…). */
  LH.unwrapLink = (raw) => {
    let u = LH.safeUrl(raw);
    for (let i = 0; u && i < 3; i++) {
      if (/(^|\.)l[m]?\.(facebook|instagram|messenger)\.com$/.test(u.hostname) && u.searchParams.get('u')) {
        u = LH.safeUrl(u.searchParams.get('u'));
      } else break;
    }
    return u;
  };

  LH.linkKind = (url) => {
    const u = typeof url === 'string' ? LH.safeUrl(url) : url;
    if (!u) return null;
    if (u.protocol === 'tel:') return 'phone';
    if (u.protocol === 'mailto:') return 'email';
    if (u.protocol === 'whatsapp:') return 'whatsapp';
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'google.com' && !/^\/(maps|forms)/.test(u.pathname)) return 'google';
    for (const [re, kind] of HOST_KINDS) if (re.test(host)) return kind;
    return 'website';
  };

  const TRACKING = /^(utm_|fbclid$|gclid$|igshid$|mc_|_hs|ref$|ref_src$|campaign_id$|ad_id$|adset_id$|placement$|site_source_name$)/i;
  LH.cleanUrl = (url) => {
    const u = typeof url === 'string' ? LH.safeUrl(url) : url ? new URL(url.toString()) : null;
    if (!u) return null;
    [...u.searchParams.keys()].forEach((k) => TRACKING.test(k) && u.searchParams.delete(k));
    u.hash = '';
    return u.toString().replace(/\?$/, '');
  };
  LH.domainOf = (url) => {
    const u = typeof url === 'string' ? LH.safeUrl(url) : url;
    return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
  };

  /* -------------------------------------------------------------------- Phones */
  // High-precision patterns only: international (+ or 00) numbers, plus UAE local
  // mobile / landline / toll-free formats, which is where most of the ads run.
  const PHONE_PATTERNS = [
    /(?<![\w+])(?:\+|00)[1-9]\d{0,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?![\w])/g,
    /(?<![\w+])0(?:5[0-9]|[234679])[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
    /(?<![\w+])800[\s.-]?\d{3,4}[\s.-]?\d{0,4}(?!\d)/g,
  ];

  LH.normalizePhone = (raw, countryCode = 'AE') => {
    if (!raw) return null;
    let s = String(raw).trim();
    try {
      s = decodeURIComponent(s);
    } catch {}
    s = s.replace(/^(tel|whatsapp|callto):/i, '');
    const plus = /^\s*(\+|00)/.test(s);
    let d = s.replace(/\D/g, '');
    if (!d) return null;
    if (s.trim().startsWith('00')) d = d.slice(2);
    const dial = LH.country(countryCode).dial;
    if (!plus) {
      if (dial && d.startsWith(dial) && d.length >= dial.length + 7) {
        /* already has the country code, just without a plus */
      } else if (d.startsWith('0') && dial) d = dial + d.slice(1);
      else if (dial === '971' && /^800\d{3,8}$/.test(d)) return d; // UAE toll-free stays local
      else if (dial === '971' && /^5\d{8}$/.test(d)) d = '971' + d;
    }
    if (d.length < 8 || d.length > 15) return null;
    if (/^(\d)\1+$/.test(d)) return null;
    return '+' + d;
  };

  LH.isLikelyMobile = (e164) => {
    if (!e164) return false;
    if (e164.startsWith('+971')) return /^\+9715\d{8}$/.test(e164);
    if (e164.startsWith('+966')) return /^\+9665\d{8}$/.test(e164);
    if (e164.startsWith('+44')) return /^\+447\d{9}$/.test(e164);
    return true; // unknown: let the user decide
  };

  LH.formatPhone = (e164) => {
    if (!e164) return '';
    let m = e164.match(/^\+971(5\d)(\d{3})(\d{4})$/);
    if (m) return `+971 ${m[1]} ${m[2]} ${m[3]}`;
    m = e164.match(/^\+971([234679])(\d{3})(\d{4})$/);
    if (m) return `+971 ${m[1]} ${m[2]} ${m[3]}`;
    return e164;
  };

  LH.phonesInText = (text, countryCode = 'AE') => {
    const out = new Set();
    if (!text) return [];
    for (const re of PHONE_PATTERNS) {
      re.lastIndex = 0;
      for (const m of String(text).matchAll(re)) {
        const digits = m[0].replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15) continue;
        if (/^(19|20)\d{2}[\s.-]?\d{1,2}[\s.-]?\d{1,2}$/.test(m[0].trim())) continue; // dates
        const n = LH.normalizePhone(m[0], countryCode);
        if (n) out.add(n);
      }
    }
    return [...out];
  };

  /** wa.me click-to-chat link; opens the WhatsApp app on a phone with the message typed in. */
  LH.waLink = (number, text) => {
    const d = String(number || '').replace(/\D/g, '');
    const t = text ? String(text) : '';
    return `https://wa.me/${d}${t ? `?text=${encodeURIComponent(t.toWellFormed ? t.toWellFormed() : t)}` : ''}`;
  };

  /** Phone number from a WhatsApp click-to-chat link, if any. */
  LH.whatsappNumber = (url) => {
    const u = typeof url === 'string' ? LH.safeUrl(url) : url;
    if (!u) return null;
    const host = u.hostname.replace(/^www\./, '');
    let n = null;
    if (host === 'wa.me') n = u.pathname.split('/').filter(Boolean)[0];
    else if (/whatsapp\.com$/.test(host) || u.protocol === 'whatsapp:') n = u.searchParams.get('phone');
    if (!n || !/\d{7,}/.test(n)) return null;
    return LH.normalizePhone('+' + n.replace(/\D/g, ''));
  };

  /* --------------------------------------------------------------- Lead metrics */
  LH.DAY = 86400000;
  LH.daysRunning = (lead, now = Date.now()) => (lead && lead.earliestStart ? Math.max(0, Math.floor((now - lead.earliestStart) / LH.DAY)) : null);

  LH.bestPhone = (lead) => {
    const p = (lead && lead.phones) || [];
    const rank = { 'whatsapp-ad': 0, 'whatsapp-site': 1, 'whatsapp-ig': 1, website: 2, 'call-ad': 2, google: 3, instagram: 3, 'ad-text': 4, manual: -1 };
    return [...p].sort((a, b) => (rank[a.source] ?? 5) - (rank[b.source] ?? 5))[0] || null;
  };
  LH.whatsappTarget = (lead) => {
    const p = (lead && lead.phones) || [];
    const wa = p.find((x) => /whatsapp/.test(x.source) || x.source === 'manual') || p.find((x) => LH.isLikelyMobile(x.number));
    return wa ? wa.number : null;
  };

  /** 0–100 for Meta-ads prospects: not advertising yet, real demand, reachable, not a giant. */
  LH.prospectPriority = (p) => {
    let s = 0;
    const ad = (p.adCheck || {}).state;
    s += ad === 'none' ? 30 : ad === 'likely' ? 22 : ad === 'running' ? -40 : 10;
    const m = (p.sources || {}).maps || {};
    const ig = (p.sources || {}).instagram || {};
    const reviews = m.reviews || 0;
    s += reviews >= 300 ? 15 : reviews >= 100 ? 12 : reviews >= 30 ? 8 : reviews >= 10 ? 4 : 0;
    if (m.rating >= 4.5) s += 5;
    else if (m.rating && m.rating < 3.8) s -= 6;
    const f = ig.followers || 0;
    if (f >= 1000 && f <= 100000) s += 8;
    else if (f > 150000) s -= 12;
    if (ig.lastPostAt) s += Date.now() - ig.lastPostAt < 30 * LH.DAY ? 6 : Date.now() - ig.lastPostAt > 120 * LH.DAY ? -6 : 0;
    if (LH.whatsappTarget(p)) s += 16;
    else if ((p.phones || []).length) s += 11;
    else if ((p.emails || []).length) s += 5;
    if (p.website) s += 6;
    if (p.avoid) s -= 30;
    return Math.max(0, Math.min(100, Math.round(s + 10)));
  };

  /** 0–100: how worth contacting this advertiser is right now. */
  LH.priority = (lead, now = Date.now()) => {
    if (!lead) return 0;
    if (lead.kind === 'prospect') return LH.prospectPriority(lead);
    let s = 0;
    const ads = lead.activeAdCount || 0;
    s += Math.min(ads, 8) * 3; // up to 24: more creatives = more budget
    const days = LH.daysRunning(lead, now);
    s += days == null ? 4 : days >= 90 ? 20 : days >= 30 ? 15 : days >= 14 ? 10 : 6; // steady spenders
    const site = lead.site || {};
    if (!lead.website) s += 24;
    else if (site.state === 'error' || site.parked) s += 32;
    else if (typeof site.score === 'number') s += site.score < 45 ? 30 : site.score < 65 ? 22 : site.score < 80 ? 12 : 4;
    else s += 10;
    if (LH.bestPhone(lead)) s += 16;
    else if ((lead.emails || []).length) s += 8;
    const likes = lead.pageLikes || 0;
    if (likes > 250000) s -= 35;
    else if (likes > 60000) s -= 15;
    return Math.max(0, Math.min(100, Math.round(s)));
  };
  LH.heat = (p) => (p >= 70 ? 'hot' : p >= 48 ? 'warm' : 'cold');

  /* ----------------------------------------------------------------- Templates */
  LH.DEFAULT_TEMPLATES = {
    weakSite: {
      name: 'Website has issues',
      whatsapp:
        'Hi {{business}} team, I came across your ads on Facebook/Instagram ({{days_phrase}}). I build websites for businesses running ads, so I had a quick look at {{domain}} and noticed {{issue_1}}{{issue_2_and}}.\n\nWhen someone taps an ad, the website is the first thing they judge you on, so issues like these quietly lose leads you are already paying for.\n\nI ran a free audit of your site here: {{audit_link}}\n\nHappy to send over a few specific fixes if useful. {{my_name}}, {{agency}}',
      subject: 'Quick note about {{domain}} and your ads',
      email:
        'Hi {{business}} team,\n\nI came across your ads on Facebook/Instagram ({{days_phrase}}) and had a quick look at the page they send people to.\n\nA few things stood out on {{domain}}:\n{{issues}}\n\nWhen someone taps an ad, the website is the first thing they judge you on. Issues like these mean a share of the clicks you pay for never turn into enquiries.\n\nYou can see the full audit here: {{audit_link}}\n\nWould it be worth a 15-minute call to go through the fixes?\n\n{{my_name}}\n{{agency}} · {{my_phone}}',
    },
    noWebsite: {
      name: 'No website',
      whatsapp:
        'Hi {{business}} team, I saw your ads running on Facebook/Instagram ({{days_phrase}}). I noticed they send people straight to {{destination}} and there is no website behind them.\n\nMost people check a business online before they message, especially for {{keyword}}, so a proper website usually means more of those clicks turn into real enquiries.\n\nI build fast, mobile-first websites for businesses running ads. Happy to put together a quick free mockup of what yours could look like. {{my_name}}, {{agency}}',
      subject: 'Your {{keyword}} ads have no website behind them',
      email:
        'Hi {{business}} team,\n\nI saw your ads running on Facebook/Instagram ({{days_phrase}}). They send people straight to {{destination}}, and I could not find a website behind them.\n\nMost customers check a business online before they get in touch. Without a website, part of the budget you spend on ads is lost to people who wanted more proof before messaging.\n\nI build fast, mobile-first websites for businesses that advertise. I would be happy to put together a free mockup of your homepage so you can see the difference.\n\nInterested?\n\n{{my_name}}\n{{agency}} · {{my_phone}}',
    },
    brokenSite: {
      name: 'Website is broken',
      whatsapp:
        'Hi {{business}} team, quick heads-up: I saw your ads on Facebook/Instagram, but when I visited {{domain}} {{issue_1}}.\n\nThat means people clicking your ads right now may be hitting a dead end. I build websites for businesses running ads and can help get this fixed quickly if you want. {{my_name}}, {{agency}}',
      subject: 'Heads-up: {{domain}} is not loading properly',
      email:
        'Hi {{business}} team,\n\nI saw your ads running on Facebook/Instagram and clicked through to {{domain}}. Unfortunately {{issue_1}}.\n\nWhile the ads are live, anyone who clicks through may be hitting a dead end, which is budget going straight out of the window.\n\nI build and fix websites for businesses that run ads and can get this sorted quickly. Want me to take a look?\n\n{{my_name}}\n{{agency}} · {{my_phone}}',
    },
    goodSite: {
      name: 'Website is decent',
      whatsapp:
        'Hi {{business}} team, I came across your ads on Facebook/Instagram, nice work. I build websites for businesses running ads and had a quick look at {{domain}}. It is in decent shape, but {{issue_1}}.\n\nSmall fixes like that usually lift how many ad clicks turn into enquiries. Free audit here if you are curious: {{audit_link}}\n\n{{my_name}}, {{agency}}',
      subject: 'One quick win for {{domain}}',
      email:
        'Hi {{business}} team,\n\nI came across your ads on Facebook/Instagram and had a look at {{domain}}. It is in decent shape, but a couple of things are likely costing you enquiries:\n{{issues}}\n\nFull audit: {{audit_link}}\n\nHappy to walk you through the fixes on a quick call if useful.\n\n{{my_name}}\n{{agency}} · {{my_phone}}',
    },
  };

  // Honest by design: first person, no invented clients, results or team. Describe the offer, not a track record.
  LH.DEFAULT_AD_TEMPLATES = {
    adsProof: {
      name: 'Not advertising, strong reviews',
      whatsapp:
        "Hi {{business}} team, I came across you on {{found_on}}. {{proof_line}}, so people clearly rate you. {{ads_line}}{{competitor_line}}.\n\nI'm taking on a small number of {{niche_plural}} in {{city}} for Meta ads. The part most agencies skip: every lead gets a WhatsApp message within minutes to confirm they're serious, and only the confirmed ones are passed to you.\n\nTo keep it low-risk: {{offer}}. Open to a quick 10-minute call this week? {{my_name}}, {{agency}}",
      subject: '{{business}}: more bookings from Instagram and Facebook',
      email:
        "Hi {{business}} team,\n\nI came across you on {{found_on}}. {{proof_line}}, so people clearly rate you. {{ads_line}}{{competitor_line}}.\n\nI'm taking on a small number of {{niche_plural}} in {{city}} for Meta ads. The difference is in what happens after the ad: every lead gets a WhatsApp message within minutes to confirm they're genuine and ready to book, and only confirmed leads are passed to you, so your team spends its time on real customers.\n\nTo keep it low-risk for you: {{offer}}.\n\nWould a 10-minute call this week work?\n\n{{my_name}}\n{{agency}} · {{my_phone}}",
    },
    adsGrowing: {
      name: 'Not advertising, growing',
      whatsapp:
        "Hi {{business}} team, I found you on {{found_on}}{{followers_line}}. Looks like you're putting real work into your business. {{ads_line}}.\n\nI'm setting up Meta ads for a few {{niche_plural}} in {{city}}, with every lead confirmed on WhatsApp before it reaches you, so you only talk to people who are ready to book.\n\n{{offer}}. Worth a quick chat? {{my_name}}, {{agency}}",
      subject: 'More bookings from Instagram and Facebook',
      email:
        "Hi {{business}} team,\n\nI found you on {{found_on}}{{followers_line}}. You're clearly putting work into your business. {{ads_line}}.\n\nI'm setting up Meta ads for a few {{niche_plural}} in {{city}}. Every lead is messaged on WhatsApp within minutes to confirm they're serious, and only confirmed ones are passed to you.\n\n{{offer}}.\n\nOpen to a short call?\n\n{{my_name}}\n{{agency}} · {{my_phone}}",
    },
    adsRunning: {
      name: 'Already advertising',
      whatsapp:
        "Hi {{business}} team, I noticed you're running Facebook and Instagram ads. Quick question: is someone getting back to every lead within a few minutes? That's usually where ad budget quietly gets lost.\n\nI run Meta ads with a confirmation step: every lead is messaged on WhatsApp within minutes and only serious ones reach you. {{offer}}. Happy to share a few notes on your current ads. {{my_name}}, {{agency}}",
      subject: 'Your Meta ads and the leads they bring in',
      email:
        "Hi {{business}} team,\n\nI noticed you're running Facebook and Instagram ads. Is someone getting back to every lead within a few minutes? That's usually where most of the ad budget quietly gets lost.\n\nI run Meta ads with a confirmation step: every lead is messaged on WhatsApp within minutes, and only the ones who are serious are passed to you.\n\n{{offer}}.\n\nHappy to send a few notes on your current ads if useful.\n\n{{my_name}}\n{{agency}} · {{my_phone}}",
    },
  };

  LH.templatesFor = (lead, settings = {}) =>
    lead && lead.kind === 'prospect'
      ? { all: settings.adTemplates || LH.DEFAULT_AD_TEMPLATES, defaults: LH.DEFAULT_AD_TEMPLATES }
      : { all: settings.templates || LH.DEFAULT_TEMPLATES, defaults: LH.DEFAULT_TEMPLATES };

  LH.pitchAngle = (lead) => {
    if (lead && lead.kind === 'prospect') {
      const ad = (lead.adCheck || {}).state;
      if (ad === 'running') return 'adsRunning';
      const m = (lead.sources || {}).maps || {};
      return (m.reviews || 0) >= 25 && (m.rating || 0) >= 4 ? 'adsProof' : 'adsGrowing';
    }
    const site = (lead && lead.site) || {};
    if (!lead || !lead.website) return 'noWebsite';
    if (site.state === 'error' || site.parked) return 'brokenSite';
    if (typeof site.score === 'number' && site.score >= 80) return 'goodSite';
    return 'weakSite';
  };

  // How each niche reads inside a sentence ("a few car detailing and PPF studios in Dubai").
  LH.NICHE_PLURALS = {
    'Car detailing & PPF': 'car detailing and PPF studios',
    'Aesthetic clinics': 'aesthetic clinics',
    'Boutique fitness (Oct–Jan)': 'fitness studios',
    'AC servicing (from late Jan)': 'AC service companies',
  };
  const nichePlural = (lead) => LH.NICHE_PLURALS[lead.niche] || `${String(lead.niche || (lead.keywords || [])[0] || 'local').toLowerCase()} businesses`;
  const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
  LH.templateVars = (lead, settings = {}, now = Date.now()) => {
    if (lead && lead.kind === 'prospect') {
      const m = (lead.sources || {}).maps || {};
      const ig = (lead.sources || {}).instagram || {};
      const competitors = settings.__competitors || 0;
      return {
        business: lead.pageName || 'there',
        found_on: m.placeId && !ig.username ? 'Google Maps' : ig.username && !m.placeId ? 'Instagram' : 'Google Maps and Instagram',
        proof_line: m.reviews ? `${m.rating ? `${m.rating}★ from ` : ''}${m.reviews} Google reviews` : ig.followers ? `${compact(ig.followers)} followers on Instagram` : 'You have a great reputation',
        followers_line: ig.followers ? ` (${compact(ig.followers)} followers)` : '',
        // Only claim what was checked: a confirmed "no ads" reads differently from "couldn't find any".
        ads_line:
          (lead.adCheck || {}).state === 'none'
            ? "I checked Meta's Ad Library and you aren't running any Facebook or Instagram ads right now"
            : "I couldn't find any Facebook or Instagram ads from you in Meta's Ad Library",
        // __competitors counts advertisers seen in UAE Ad Library hunts, so say "the UAE", not the city.
        competitor_line: competitors >= 3 ? `, while ${competitors} other ${nichePlural(lead)} in the UAE are` : '',
        niche_plural: nichePlural(lead),
        rating: m.rating ? String(m.rating) : '',
        reviews: m.reviews ? String(m.reviews) : '',
        followers: ig.followers ? compact(ig.followers) : '',
        niche: (lead.niche || (lead.keywords || [])[0] || 'local').toLowerCase(),
        city: settings.adsCity || 'the UAE',
        area: lead.area || settings.adsCity || '',
        offer: settings.adsOffer || '',
        domain: LH.domainOf(lead.website || ''),
        my_name: settings.myName || '',
        agency: settings.agency || '',
        my_phone: settings.myPhone || '',
        my_website: settings.myWebsite || '',
      };
    }
    const days = LH.daysRunning(lead, now);
    const issues = ((lead.site && lead.site.issues) || []).map((i) => i.pitch || i.label);
    const domain = LH.domainOf(lead.website || '') || '';
    const ads = lead.activeAdCount || 0;
    return {
      business: lead.pageName || 'there',
      days: days == null ? '' : String(days),
      days_phrase:
        days == null
          ? 'they look great'
          : days >= 30
            ? `looks like you have been running them for ${days}+ days`
            : days >= 7
              ? 'looks like a fairly new campaign'
              : 'looks like you just launched a new campaign',
      ad_count: String(ads),
      keyword: (lead.keywords && lead.keywords[0]) || 'your service',
      domain,
      website: lead.website || '',
      landing: lead.landingUrl || lead.website || '',
      score: lead.site && typeof lead.site.score === 'number' ? String(lead.site.score) : '',
      issue_1: issues[0] || 'a few things that are probably costing you enquiries',
      issue_2: issues[1] || '',
      issue_2_and: issues[1] ? `, and ${issues[1]}` : '',
      issues: issues.length ? issues.slice(0, 4).map((i) => `- ${i.charAt(0).toUpperCase()}${i.slice(1)}`).join('\n') : '- A few quick wins on speed, mobile and conversion',
      destination: LH.destinationLabel(lead.destinationKind),
      audit_link: domain ? (settings.auditLinkBase || '') + encodeURIComponent(domain) : settings.myWebsite || '',
      my_name: settings.myName || '',
      agency: settings.agency || '',
      my_phone: settings.myPhone || '',
      my_website: settings.myWebsite || '',
    };
  };

  LH.render = (tpl, vars) =>
    String(tpl || '')
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? vars[k] : ''))
      .replace(/ ,/g, ',')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/, \./g, '.')
      .trim();

  LH.pitchFor = (lead, settings = {}, angle) => {
    const { all, defaults } = LH.templatesFor(lead, settings);
    const key = angle && (all[angle] || defaults[angle]) ? angle : LH.pitchAngle(lead);
    const t = { ...defaults[key], ...(all[key] || {}) };
    const vars = LH.templateVars(lead, settings);
    return { angle: key, whatsapp: LH.render(t.whatsapp, vars), subject: LH.render(t.subject, vars), email: LH.render(t.email, vars) };
  };

  /* ---------------------------------------------------------------------- CSV */
  LH.toCsv = (rows) =>
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? '' : String(v);
            // Neutralise spreadsheet formulas, but keep phone numbers like +971 50 … intact.
            const formula = /^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s));
            const out = formula ? `'${s}` : s;
            return formula || /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
          })
          .join(','),
      )
      .join('\r\n');
})(typeof globalThis !== 'undefined' ? globalThis : self);
