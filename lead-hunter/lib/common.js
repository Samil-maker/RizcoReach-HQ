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

  /* ------------------------------------------------------------------ Niches */
  // One list for both tabs: Ad Library hunts (New hunt) and Google Maps searches (Meta ads).
  // The name is written the way it reads in a message: it becomes {{niche}} in the scripts.
  LH.DEFAULT_NICHES = [
    { name: 'Car detailing studios', keywords: ['ceramic coating', 'paint protection film', 'car detailing', 'window tinting', 'car polishing'] },
    { name: 'Aesthetic clinics', keywords: ['aesthetic clinic', 'laser hair removal', 'skin clinic', 'hydrafacial', 'botox clinic'] },
    { name: 'Dental clinics', keywords: ['cosmetic dentist', 'teeth whitening', 'dental clinic', 'invisalign', 'dental veneers'] },
    { name: 'Beauty salons', keywords: ['beauty salon', 'hair salon', 'ladies salon', 'nail salon', 'lash studio'] },
  ];
  // Niche names stored on prospects by earlier versions.
  LH.LEGACY_NICHES = {
    'Car detailing & PPF': 'Car detailing studios',
    'Aesthetic clinics': 'Aesthetic clinics',
    'Boutique fitness (Oct–Jan)': 'Fitness studios',
    'AC servicing (from late Jan)': 'AC service companies',
  };

  /** "ceramic coating, PPF\nwindow tinting" -> ['ceramic coating', 'ppf', 'window tinting'] */
  LH.parseKeywords = (v) => [
    ...new Set(
      (Array.isArray(v) ? v : String(v || '').split(/[,\n]/))
        .map((k) => String(k).trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  /** The niches in use: the ones edited in Settings, or the four defaults. */
  LH.nichesFor = (settings) => {
    const list = ((settings && Array.isArray(settings.niches) && settings.niches) || [])
      .map((n) => ({ name: String((n && n.name) || '').trim().slice(0, 80), keywords: LH.parseKeywords(n && n.keywords) }))
      .filter((n) => n.name);
    return list.length ? list : LH.DEFAULT_NICHES;
  };

  /** How a niche name reads mid-sentence: "Car detailing studios" -> "car detailing studios", "AC companies" stays. */
  LH.nicheText = (name) => {
    const s = String(name || '').trim();
    const first = s.split(/\s+/)[0];
    if (!s || (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first))) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  };

  /** A lead's niche name: its stored niche (old names mapped), else the niche its keywords belong to, else ''. */
  LH.nicheOf = (lead, settings) => {
    const niches = LH.nichesFor(settings);
    const raw = String((lead && lead.niche) || '').trim();
    if (LH.LEGACY_NICHES[raw]) return LH.LEGACY_NICHES[raw];
    const named = raw && niches.find((n) => n.name.toLowerCase() === raw.toLowerCase());
    if (named) return named.name;
    const kws = LH.parseKeywords([...((lead && lead.keywords) || []), raw]);
    const byKeyword =
      niches.find((n) => n.keywords.some((k) => kws.includes(k))) || niches.find((n) => n.keywords.some((k) => kws.some((x) => x.includes(k))));
    return byKeyword ? byKeyword.name : raw;
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
    bubbles: 3, // WhatsApp messages per pitch: 3 = greeting, body, closing · 2 = greeting with body, closing
    niches: null, // null = use LH.DEFAULT_NICHES
    scripts: null, // null = use LH.DEFAULT_SCRIPTS
  };
  // Settings from earlier versions that no longer do anything.
  const OLD_SETTINGS = ['templates', 'adTemplates', 'adsOffer'];
  /** Stored settings over the defaults, without the old keys. */
  LH.withDefaults = (stored) => {
    const s = { ...LH.DEFAULT_SETTINGS, ...(stored || {}) };
    for (const k of OLD_SETTINGS) delete s[k];
    return s;
  };
  LH.hasOldSettings = (stored) => !!stored && OLD_SETTINGS.some((k) => k in stored);

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

  /** 0–100: how worth contacting this lead is right now. Leads skipped for running ads sink to the bottom. */
  LH.priority = (lead, now = Date.now()) => {
    if (!lead) return 0;
    const p = lead.kind === 'prospect' ? LH.prospectPriority(lead) : advertiserPriority(lead, now);
    return LH.scriptFor(lead).script ? p : Math.round(p / 10);
  };
  const advertiserPriority = (lead, now) => {
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

  /* ------------------------------------------------------------------ Scripts */
  // Two scripts, picked per lead by LH.scriptFor. Written the way Samil types on his phone:
  // short lines, few commas, no dashes. Each part goes out as its own WhatsApp bubble.
  LH.DEFAULT_SCRIPTS = {
    ads: {
      name: 'Ads script',
      greeting: 'Hello {{business}}',
      body: "Are you dependent on word of mouth for appointments in {{city}}?\n\nWe help {{niche}} in {{city}} get consistent inquiries through Facebook and Instagram ads.\n\nWe personally screen each and every lead so the ones that reach you are genuine people with real interest.\n\nThere's no big setup fee. Just one flat monthly rate so there's minimal risk on your end.\n\nIf this sounds interesting I'd be happy to send you a quick explanation of how it works.",
      closing: 'Let me know',
    },
    website: {
      name: 'Website script',
      greeting: 'Hello {{business}}',
      body: "I came across {{business}} on {{found_on}} and {{website_line}}.\n\nWe build simple websites for {{niche}} in {{city}} that turn visitors into WhatsApp inquiries.\n\nIf this sounds interesting I'd be happy to send you a free mockup of how yours could look.",
      closing: 'Let me know',
    },
  };
  LH.SCRIPT_PARTS = ['greeting', 'body', 'closing'];

  /** The scripts in use: edits from Settings over the defaults, part by part. */
  LH.scriptsFor = (settings) => {
    const saved = (settings && settings.scripts) || {};
    const out = {};
    for (const [k, def] of Object.entries(LH.DEFAULT_SCRIPTS)) {
      out[k] = { ...def };
      for (const part of LH.SCRIPT_PARTS) if (saved[k] && typeof saved[k][part] === 'string') out[k][part] = saved[k][part];
    }
    return out;
  };

  /** They have a website but it is down or parked: for outreach that is no working website. */
  LH.siteDown = (lead) => !!lead && !!lead.website && ((lead.site || {}).state === 'error' || !!(lead.site || {}).parked);
  /**
   * Which script a lead gets, plus the reason as a tag:
   *   no website (either tab)                 -> 'website'  "No website"
   *   website down or parked (either tab)     -> 'website'  "Site down"
   *   website, ad check found no Meta ads     -> 'ads'      "No Meta ads"
   *   website, ad check pending or unclear    -> 'ads'      "Ad check not done"
   *   website and running ads                 -> null       "Running ads" (skipped for outreach)
   * Website leads come from the Ad Library, so they all advertise: only the ones without a working website get a script.
   */
  LH.scriptFor = (lead) => {
    if (!lead || !lead.website) return { script: 'website', tag: 'No website' };
    if (LH.siteDown(lead)) return { script: 'website', tag: 'Site down' };
    if (lead.kind !== 'prospect') return { script: null, tag: 'Running ads' };
    const ad = (lead.adCheck || {}).state;
    if (ad === 'running') return { script: null, tag: 'Running ads' };
    if (ad === 'none' || ad === 'likely') return { script: 'ads', tag: 'No Meta ads' };
    return { script: 'ads', tag: 'Ad check not done' };
  };
  /** The script a contacted lead got. "Pitch anyway" on a skipped lead uses the website script. */
  LH.sentScriptFor = (lead) => LH.scriptFor(lead).script || 'website';

  /** Google rating from Maps (Meta ads tab) or a Places lookup (website leads). */
  const googleRating = (lead) => {
    const m = ((lead && lead.sources) || {}).maps || {};
    const pl = lead && lead.places && lead.places.match ? lead.places : {};
    return { rating: m.rating || pl.rating || 0, reviews: m.reviews || pl.reviews || 0, known: !!(m.placeId || pl.match) };
  };
  /** Row tags, for sorting and filtering only (they never change the message). */
  LH.leadTags = (lead) => {
    if (!lead) return [];
    const tags = [];
    if (!lead.website) tags.push('No website');
    else if (LH.siteDown(lead)) tags.push('Site down');
    if (!LH.scriptFor(lead).script) tags.push('Running ads');
    const g = googleRating(lead);
    if (g.rating >= 4 && g.reviews >= 25) tags.push('Good reviews');
    else if (g.known && g.reviews < 25) tags.push('Growing');
    return tags;
  };
  /** The one-line summary the phone queue shows: "No website", "No Meta ads · Good reviews". */
  LH.tagLine = (lead) => [...new Set([LH.scriptFor(lead).tag, ...LH.leadTags(lead)])].join(' · ');

  /** Instagram username (no @) from where the lead was found or the profile link on their website. */
  LH.igFromUrl = (url) => {
    const u = typeof url === 'string' ? LH.safeUrl(url) : url;
    if (!u || LH.linkKind(u) !== 'instagram') return '';
    const h = u.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9._]{1,30}$/.test(h) && !/^(p|reel|reels|stories|explore|tv|accounts|direct|m)$/i.test(h) ? h : '';
  };
  LH.igHandle = (lead) => {
    const found = ((((lead && lead.sources) || {}).instagram || {}).username || '').replace(/^@/, '');
    return found || LH.igFromUrl(((lead && lead.socials) || {}).instagram);
  };

  /**
   * A business name the way you'd type it in a message. Only for {{business}}: the stored name stays as it is.
   *   "Dr. Smile Dental Clinic - Best Dentist in Dubai" -> "Dr. Smile Dental Clinic"
   *   "Glossy PPF | Ceramic Coating | Car Detailing Dubai" -> "Glossy PPF"
   *   "AL NOOR BEAUTY SALON L.L.C" -> "Al Noor Beauty Salon" · "Gloss Garage Dubai" -> "Gloss Garage"
   */
  const LEGAL_END = /[\s,]+(l\.?l\.?c\.?|fz[\s-]?llc|fzco|fze|fzc|dmcc|est\.?|ltd\.?)$/i;
  const PLACE_END = /[\s,]+(dubai|uae|abu dhabi|sharjah)$/i;
  const ACRONYM = (w) => !/[aeiouy]/i.test(w) || /^(ac|uae|ksa|vip|difc|usa|uk)$/i.test(w); // PPF, BMW, JLT stay in capitals
  LH.shortName = (name) => {
    const full = String(name || '').replace(/\s+/g, ' ').trim();
    let s = full.split(/\s[-–—·]\s|\s*\|\s*|\s\(/)[0].trim() || full;
    for (let prev = ''; prev !== s; ) {
      prev = s;
      s = s.replace(LEGAL_END, '').replace(/[\s,.]+$/, '');
      const rest = s.replace(PLACE_END, '').replace(/[\s,.]+$/, '');
      if (rest.split(' ').length >= 2) s = rest; // "Glossy Dubai" keeps its city
    }
    if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) s = s.replace(/[A-Z][A-Z']*/g, (w) => (ACRONYM(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
    return s || full;
  };

  /** Script variables. Missing data never shows up as "undefined" or {{…}}. */
  LH.scriptVars = (lead, settings = {}) => {
    const l = lead || {};
    const m = (l.sources || {}).maps || {};
    const ig = (l.sources || {}).instagram || {};
    const niche = LH.nicheOf(l, settings);
    return {
      // No name: their Instagram handle or domain. pitchFor writes "Hello there" and "your business" when there is neither.
      business: LH.shortName(l.pageName) || LH.igHandle(l) || LH.domainOf(l.website || ''),
      niche: niche ? LH.nicheText(niche) : 'businesses',
      city: settings.adsCity || 'Dubai',
      found_on: l.kind !== 'prospect' ? 'Facebook and Instagram' : ig.username && !m.placeId ? 'Instagram' : 'Google Maps',
      website_line: LH.siteDown(l) ? "your website wasn't loading when I checked" : "couldn't find a website for you",
      my_name: settings.myName || '',
      agency: settings.agency || '',
      my_phone: settings.myPhone || '',
    };
  };

  LH.render = (tpl, vars) =>
    String(tpl || '')
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? vars[k] : ''))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ ,/g, ',')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/, \./g, '.')
      .trim();

  /**
   * The message for a lead, split into WhatsApp bubbles. Nothing is ever sent from here:
   * every bubble is prefilled or copied, and Samil presses Send himself.
   *   3 bubbles: [greeting] [body] [closing] · 2 bubbles: [greeting + body] [closing]. Empty bubbles are dropped.
   * `force` = 'website' pitches a lead that is skipped for running ads anyway.
   */
  LH.pitchFor = (lead, settings = {}, force) => {
    const pick = LH.scriptFor(lead);
    const script = force && LH.DEFAULT_SCRIPTS[force] ? force : pick.script;
    if (!script) return { script: null, tag: pick.tag, bubbles: [], text: '', subject: '', email: '' };
    const t = LH.scriptsFor(settings)[script];
    const vars = LH.scriptVars(lead, settings);
    // No name at all: "Hello there", and the body says "I came across your business on…".
    const nameless = (business) => (vars.business ? vars : { ...vars, business });
    const [greeting, body, closing] = LH.SCRIPT_PARTS.map((p) => LH.render(t[p], nameless({ greeting: 'there', body: 'your business' }[p] || '')));
    const parts = Number(settings.bubbles) === 2 ? [[greeting, body].filter(Boolean).join('\n\n'), closing] : [greeting, body, closing];
    const bubbles = parts.filter(Boolean);
    const offer = script === 'ads' ? 'Meta ads' : 'website';
    return {
      script,
      tag: pick.tag,
      bubbles,
      text: bubbles.join('\n\n'),
      subject: vars.business ? `${vars.business} + ${offer}` : offer.charAt(0).toUpperCase() + offer.slice(1),
      email: [greeting, body].filter(Boolean).join('\n\n'),
    };
  };

  /* ------------------------------------------------------------------ Results */
  const REPLIED = ['replied', 'meeting', 'won'];
  LH.hasReplied = (l) => !!l && (REPLIED.includes(l.status) || !!l.repliedAt);
  LH.replyRate = (r) => (r.sent ? `${Math.round((100 * r.replied) / r.sent)}%` : '–');
  /**
   * Reply rates across all leads (both tabs), by niche and by script.
   * Sent = has contactedAt (a lead that replied was sent something too). Replied = replied, meeting, won or a recorded reply.
   */
  LH.results = (leads, settings) => {
    const scripts = LH.scriptsFor(settings);
    const total = { sent: 0, replied: 0 };
    const byNiche = new Map();
    const byScript = new Map();
    const add = (map, key, label, replied) => {
      const r = map.get(key) || { key, label, sent: 0, replied: 0 };
      r.sent++;
      if (replied) r.replied++;
      map.set(key, r);
    };
    for (const l of leads || []) {
      const replied = LH.hasReplied(l);
      if (!l || !(l.contactedAt || replied)) continue;
      total.sent++;
      if (replied) total.replied++;
      const niche = LH.nicheOf(l, settings);
      add(byNiche, niche || '', niche || 'No niche', replied);
      add(byScript, l.sentScript || '', l.sentScript && scripts[l.sentScript] ? scripts[l.sentScript].name : 'Not recorded', replied);
    }
    const list = (map) => [...map.values()].sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label)).map((r) => ({ ...r, rate: LH.replyRate(r) }));
    return { total: { ...total, rate: LH.replyRate(total) }, byNiche: list(byNiche), byScript: list(byScript) };
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
