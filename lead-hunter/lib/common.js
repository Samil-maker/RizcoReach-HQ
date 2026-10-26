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

  /* ----------------------------------------------------------------- Presets */
  // One preset per kind of business: what to search for, what to leave out, how many Google reviews a small
  // owner run business has, and where to look. Searches run as "{keyword} {area}". Used by both tabs.
  // `label` is how the preset reads mid-sentence in the scripts ({{niche}}).
  const lines = (s) => s.trim().split('\n').map((x) => x.trim()).filter(Boolean);
  LH.AREA_LISTS = {
    industrial: lines(`Al Quoz Industrial Area 1, Dubai
Al Quoz Industrial Area 2, Dubai
Al Quoz Industrial Area 3, Dubai
Al Quoz Industrial Area 4, Dubai
Ras Al Khor Industrial Area, Dubai
Al Qusais Industrial Area, Dubai
Umm Ramool, Dubai
Dubai Investments Park, Dubai
Jebel Ali Industrial Area, Dubai
Al Barsha, Dubai
Dubai Silicon Oasis, Dubai
Sharjah Industrial Area, Sharjah
Al Sajaa Industrial Area, Sharjah
Muwaileh, Sharjah
Ajman Industrial Area, Ajman
Al Jurf, Ajman
Mussafah, Abu Dhabi
Mohammed Bin Zayed City, Abu Dhabi
Ras Al Khaimah
Umm Al Quwain
Fujairah`),
    residential: lines(`Dubai Marina, Dubai
JLT, Dubai
Business Bay, Dubai
Downtown Dubai, Dubai
DIFC, Dubai
Al Barsha, Dubai
Barsha Heights, Dubai
Jumeirah, Dubai
Umm Suqeim, Dubai
Al Wasl, Dubai
Al Safa, Dubai
Al Quoz, Dubai
Dubai Hills, Dubai
Arabian Ranches, Dubai
Motor City, Dubai
Dubai Sports City, Dubai
JVC, Dubai
Al Furjan, Dubai
Damac Hills, Dubai
Town Square, Dubai
Dubai Silicon Oasis, Dubai
Mirdif, Dubai
Al Warqa, Dubai
Al Nahda, Dubai
Al Qusais, Dubai
Al Karama, Dubai
Al Majaz, Sharjah
Al Khan, Sharjah
Al Nahda, Sharjah
Al Taawun, Sharjah
Muwaileh, Sharjah
Aljada, Sharjah
Al Nuaimiya, Ajman
Al Rashidiya, Ajman
Al Reem Island, Abu Dhabi
Saadiyat Island, Abu Dhabi
Yas Island, Abu Dhabi
Al Raha, Abu Dhabi
Khalifa City, Abu Dhabi
Al Khalidiyah, Abu Dhabi
Al Mushrif, Abu Dhabi
Ras Al Khaimah
Fujairah`),
    business: lines(`Business Bay, Dubai
Deira, Dubai
Bur Dubai, Dubai
Al Karama, Dubai
Port Saeed, Dubai
Al Garhoud, Dubai
Oud Metha, Dubai
Al Barsha, Dubai
Barsha Heights, Dubai
JLT, Dubai
Al Qusais, Dubai
Dubai Silicon Oasis, Dubai
Al Majaz, Sharjah
Al Qasimia, Sharjah
Al Taawun, Sharjah
Al Khan, Sharjah
SAIF Zone, Sharjah
Al Nuaimiya, Ajman
Al Khalidiyah, Abu Dhabi
Al Zahiyah, Abu Dhabi
Hamdan Street, Abu Dhabi
Khalifa City, Abu Dhabi
Mussafah, Abu Dhabi
Ras Al Khaimah
Fujairah`),
  };
  LH.DEFAULT_PRESETS = [
    {
      name: 'Car',
      label: 'car detailing and protection studios',
      minReviews: 5,
      maxReviews: 150,
      keywords: lines(`ppf
paint protection film
ppf installation
ceramic coating
nano ceramic coating
graphene coating
car detailing studio
car detailing
auto detailing
paint correction
car polishing
window tinting
car tinting
window film
car wrap
vehicle wrapping
vinyl wrap
color change wrap
chrome delete
starlight headliner
ambient lighting car
car interior customization
car upholstery
custom car interior
car modification
off road modification
car audio installation
body kit installation`),
      // "category:" words are checked against the Google category only: many real studios are called "... Garage".
      exclude: lines(`car wash
hand wash
steam wash
laundry
tyre
tire
category: garage
mechanic
auto repair
spare parts
rent a car
car rental
recovery
towing
battery
oil change
petrol station
used cars
category: showroom`),
      areas: LH.AREA_LISTS.industrial,
    },
    {
      name: 'Fitness',
      label: 'gyms and fitness studios',
      minReviews: 5,
      maxReviews: 50,
      keywords: lines(`boxing gym
boxing club
kickboxing gym
muay thai gym
mma gym
martial arts gym
martial arts school
jiu jitsu gym
bjj academy
brazilian jiu jitsu
krav maga
self defense classes
crossfit gym
crossfit box
hyrox gym
functional training gym
strength and conditioning gym
personal training studio
private gym
ladies gym
women only gym
pilates studio
reformer pilates
yoga studio
hot yoga
aerial yoga
barre studio
spin studio
indoor cycling studio
bootcamp fitness`),
      exclude: lines(`Fitness First
GymNation
Gold's Gym
UFC Gym
Barry's
1Rebel
hotel
resort
spa
swimming
football
tennis
padel
physiotherapy
clinic
nursery`),
      areas: LH.AREA_LISTS.residential,
    },
    {
      name: 'Pets',
      label: 'pet care businesses',
      minReviews: 5,
      maxReviews: 50,
      keywords: lines(`dog trainer
dog training
puppy training
dog behaviourist
obedience training
pet boarding
dog boarding
cat boarding
pet hotel
dog hotel
dog daycare
pet daycare
pet grooming
mobile pet grooming
dog grooming
cat grooming
pet spa
pet relocation
pet transport
pet taxi`),
      exclude: lines(`veterinary
vet clinic
animal hospital
pet clinic
pet shop
pet store
pet food
pet supplies
aquarium`),
      areas: [...LH.AREA_LISTS.residential, 'Umm Ramool, Dubai', 'Dubai Investments Park, Dubai', 'Mussafah, Abu Dhabi'],
    },
    {
      name: 'Accountants',
      label: 'accounting firms',
      minReviews: 0, // small firms get few reviews
      maxReviews: 50,
      keywords: lines(`accounting firm
accounting services
accountant
chartered accountants
bookkeeping services
bookkeeping company
accounting and bookkeeping
audit firm
auditors
tax consultant
tax agent
FTA tax agent
VAT consultant
VAT registration
corporate tax consultant
corporate tax registration
e-invoicing consultant
e-invoicing services
payroll services
virtual CFO
CFO services`),
      exclude: lines(`Deloitte
PwC
EY
KPMG
Grant Thornton
BDO
RSM
Crowe
Baker Tilly
Mazars
business setup
company formation
typing
bank
exchange
insurance
real estate`),
      areas: LH.AREA_LISTS.business,
    },
    {
      name: 'Used Cars',
      label: 'used car showrooms',
      minReviews: 5,
      maxReviews: 150,
      keywords: lines(`used car showroom
used car dealer
used cars trading
motors trading
pre owned cars
second hand cars
luxury used cars
car showroom`),
      exclude: lines(`rent a car
rental
leasing
garage
spare parts
wash`),
      areas: lines(`Souq Al Haraj, Sharjah
Al Aweer, Dubai
Ras Al Khor, Dubai
Sheikh Zayed Road, Dubai
Mussafah, Abu Dhabi`),
    },
  ];
  LH.DEFAULT_NICHES = LH.DEFAULT_PRESETS;
  // Niche names stored on leads by earlier versions.
  LH.LEGACY_NICHES = {
    'Car detailing & PPF': 'Car',
    'Car detailing studios': 'Car',
    'Boutique fitness (Oct–Jan)': 'Fitness',
    'Fitness studios': 'Fitness',
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

  /** Lines from a textarea (or a list): trimmed, empty ones and repeats dropped, order kept. */
  LH.parseLines = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean))];
  const reviewBound = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Math.max(0, Math.round(Number(v))));
  /** One preset with every field in shape. Presets saved by older versions (name and keywords only) get no areas. */
  LH.cleanPreset = (n) => ({
    name: String((n && n.name) || '').trim().slice(0, 80),
    label: String((n && n.label) || '').trim().slice(0, 120),
    minReviews: reviewBound(n && n.minReviews, 0),
    maxReviews: reviewBound(n && n.maxReviews, 100000),
    keywords: LH.parseKeywords(n && n.keywords),
    exclude: LH.parseLines(n && n.exclude).slice(0, 200),
    areas: LH.parseLines(n && n.areas).slice(0, 300),
  });
  /** The presets in use: the ones edited in Settings, or the defaults. Lists saved before presets had areas are replaced by the defaults. */
  LH.nichesFor = (settings) => {
    const saved = (settings && Array.isArray(settings.niches) && settings.niches) || [];
    const list = saved.filter((n) => n && n.areas != null).map(LH.cleanPreset).filter((n) => n.name);
    return list.length ? list : LH.DEFAULT_PRESETS.map(LH.cleanPreset);
  };
  LH.presetsFor = LH.nichesFor;

  /** How a preset reads mid-sentence: its label, else its name in lower case ("AC companies" stays). */
  LH.nicheText = (name, settings) => {
    const preset = LH.nichesFor(settings || {}).find((n) => n.name === name);
    const s = String((preset && preset.label) || name || '').trim();
    const first = s.split(/\s+/)[0];
    if (!s || (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first))) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  };

  /* Exclude words match whole words, ignoring capitals: "EY" never drops "Key Motors", "spa" never drops "Spartan Gym". */
  const plain = (s) => String(s || '').replace(/[’‘`´]/g, "'");
  const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${plain(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  /** The exclude word that drops a business, or ''. A "category: word" line only looks at the Google category. */
  LH.excludeHit = (preset, name, category) => {
    for (const raw of (preset && preset.exclude) || []) {
      const only = raw.match(/^category\s*:\s*(.+)$/i);
      const word = (only ? only[1] : raw).trim();
      if (!word) continue;
      const re = wordRe(word);
      if (re.test(plain(category)) || (!only && re.test(plain(name)))) return raw;
    }
    return '';
  };
  /** Within the preset's review range? Listings with no reviews count as 0. */
  LH.reviewsOk = (preset, reviews) => {
    const n = Number(reviews) || 0;
    return !preset || (n >= (preset.minReviews || 0) && n <= (preset.maxReviews ?? Infinity));
  };

  const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'];
  /** "Al Nahda, Sharjah" -> "Sharjah", "Fujairah" -> "Fujairah", "Al Quoz" (older leads) -> the fallback. */
  LH.cityOf = (area, fallback = 'Dubai') => {
    const a = String(area || '').trim();
    const last = (a.includes(',') ? a.split(',').pop() : a).trim().toLowerCase();
    return EMIRATES.find((e) => e.toLowerCase() === last) || fallback;
  };

  /** The name a business has in every branch: "Gloss Garage - JLT Branch" and "Gloss Garage Al Quoz" both -> "gloss garage". */
  const PLACE_WORDS = () =>
    (LH._placeWords =
      LH._placeWords ||
      [...new Set([...Object.values(LH.AREA_LISTS).flat().map((a) => a.split(',')[0]), ...Object.values(LH.AREAS || {}).flat(), ...EMIRATES, 'UAE', 'branch', 'br'])]
        .map((w) => w.toLowerCase())
        .sort((a, b) => b.length - a.length));
  LH.chainKey = (name) => {
    let s = ` ${LH.shortName(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    for (const w of PLACE_WORDS()) s = s.split(` ${w.replace(/[^\p{L}\p{N}]+/gu, ' ')} `).join(' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  /** Names that appear on more than one lead, as chain keys. */
  LH.chainNames = (leads) => {
    const count = new Map();
    for (const l of leads || []) {
      const k = l && LH.chainKey(l.pageName);
      if (k && k.length > 2) count.set(k, (count.get(k) || 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  };
  /** A chain: the same name more than once, "branch" in the name, or several Maps listings merged into it. */
  LH.isChain = (lead, chains) =>
    !!lead && (/\bbranch\b|فرع/i.test(lead.pageName || '') || (((lead.sources || {}).maps || {}).otherListings || []).length > 0 || (lead.branchCount || 0) > 1 || !!(chains && chains.has(LH.chainKey(lead.pageName))));

  /** Presets as a JSON file and back. Import keeps only well formed presets and says how many it skipped. */
  LH.presetsToJson = (list) => JSON.stringify({ app: 'lead-hunter', kind: 'presets', version: 1, presets: list.map(LH.cleanPreset) }, null, 2);
  LH.presetsFromJson = (text) => {
    let data;
    try {
      data = JSON.parse(String(text || ''));
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const raw = Array.isArray(data) ? data : data && Array.isArray(data.presets) ? data.presets : null;
    if (!raw) throw new Error('No presets in that file.');
    const presets = raw.map((n) => LH.cleanPreset({ areas: [], ...n })).filter((n) => n.name && n.keywords.length);
    if (!presets.length) throw new Error('No presets with a name and keywords in that file.');
    return { presets, skipped: raw.length - presets.length };
  };

  /** A lead's niche name: its stored niche (old names mapped), else the niche its keywords belong to, else ''. */
  LH.nicheOf = (lead, settings) => {
    const niches = LH.nichesFor(settings);
    const raw = String((lead && lead.niche) || '').trim();
    const named = raw && niches.find((n) => n.name.toLowerCase() === raw.toLowerCase());
    if (named) return named.name; // a preset of that name wins over an old name it was renamed from
    if (LH.LEGACY_NICHES[raw]) return LH.LEGACY_NICHES[raw];
    const kws = LH.parseKeywords([...((lead && lead.keywords) || []), raw]);
    const byKeyword =
      niches.find((n) => n.keywords.some((k) => kws.includes(k))) || niches.find((n) => n.keywords.some((k) => kws.some((x) => x.includes(k))));
    return byKeyword ? byKeyword.name : raw;
  };

  // Searched in this order, so the established central and upscale areas come first.
  LH.AREAS = {
    Dubai: [
      'Downtown Dubai', 'Business Bay', 'DIFC', 'Dubai Marina', 'JBR', 'JLT', 'Palm Jumeirah', 'Jumeirah', 'Umm Suqeim', 'Al Wasl',
      'Al Safa', 'City Walk', 'La Mer', 'Al Barsha', 'Barsha Heights', 'Al Sufouh', 'Dubai Media City', 'Dubai Internet City',
      'Dubai Hills', 'Emirates Hills', 'Arabian Ranches', 'The Springs', 'The Meadows', 'The Greens', 'Jumeirah Islands',
      'Jumeirah Park', 'Jumeirah Golf Estates', 'Al Barari', 'Meydan', 'Nad Al Sheba', 'Dubai Creek Harbour', 'Dubai Festival City',
      'Dubai Healthcare City', 'Al Jaddaf', 'Al Garhoud', 'Mirdif', 'Al Mizhar', 'Al Khawaneej', 'Al Quoz', 'Al Khail',
      'JVC', 'JVT', 'Al Furjan', 'Discovery Gardens', 'Motor City', 'Sports City', 'Arjan', 'Damac Hills', 'Town Square',
      'Mudon', 'Silicon Oasis', 'Academic City', 'International City', 'Dubai Investment Park', 'Jebel Ali', 'Dubai South',
      'Al Karama', 'Oud Metha', 'Bur Dubai', 'Al Mankhool', 'Al Satwa', 'Deira', 'Al Rigga', 'Port Saeed', 'Al Muraqqabat',
      'Hor Al Anz', 'Al Twar', 'Al Qusais', 'Al Nahda', 'Muhaisnah', 'Al Warqa', 'Al Rashidiya', 'Nad Al Hamar', 'Ras Al Khor',
    ],
    'Abu Dhabi': [
      'Al Reem Island', 'Al Maryah Island', 'Saadiyat', 'Yas Island', 'Al Raha', 'Al Bateen', 'Corniche', 'Al Khalidiyah',
      'Al Markaziyah', 'Tourist Club Area', 'Al Nahyan', 'Al Mushrif', 'Al Karamah', 'Al Manaseer', 'Al Muroor', 'Al Wahdah',
      'Al Mina', 'Masdar City', 'Khalifa City', 'Mohammed Bin Zayed City', 'Al Shamkha', 'Al Reef', 'Al Rahba', 'Baniyas',
      'Shakhbout City', 'Al Falah', 'Musaffah', 'Al Ain',
    ],
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
    adCheckAll: false, // also check the Ad Library for businesses without a website (one name search each, slower)
    nameMatch: 0.92, // how close two names in the same area must be to count as one business (Jaro-Winkler, 0.8 to 1)
    bubbles: 3, // WhatsApp messages per pitch: 3 = greeting, body, closing · 2 = greeting with body, closing
    niches: null, // null = use LH.DEFAULT_NICHES
    scripts: null, // null = use LH.DEFAULT_SCRIPTS
    emailFromName: 'Samil',
    emailMaxPerDay: 30, // the email sender's daily limit (1 to 40), also saved on the site where the sender reads it
    emailFollowups: 2, // follow ups after the first email: 0, 1 or 2
    emailSignature: 'Samil\nCreative Marketing Director\nRizcoReach · rizcoreach.ae\n+971 56 846 1835',
    emailOptOut: "If you'd rather not hear from me just reply no thanks and I won't email again.",
    emails: null, // null = use LH.DEFAULT_EMAILS
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
      else if (dial === '971' && /^600\d{6}$/.test(d)) d = '971' + d; // UAE 600 numbers (company call centres)
      else if (dial === '971' && /^5\d{8}$/.test(d)) d = '971' + d;
    }
    if (d.length < 8 || d.length > 15) return null;
    if (/^(\d)\1+$/.test(d)) return null;
    return '+' + d;
  };

  /** UAE numbers: 05x mobile, 02 03 04 06 07 09 landline, 600 and 800 corporate. '' when it is not a UAE number. */
  LH.phoneType = (number) => {
    const d = String(number || '').replace(/\D/g, '');
    if (/^9715\d{8}$/.test(d)) return 'mobile';
    if (/^971600\d{6}$/.test(d) || /^800\d{3,8}$/.test(d) || /^971800\d+$/.test(d)) return 'corporate';
    if (/^971[234679]\d{7}$/.test(d)) return 'landline';
    return '';
  };
  /** A lead's phone type: mobile when it has a mobile number at all, else landline, else corporate. */
  LH.leadPhoneType = (lead) => {
    const types = ((lead && lead.phones) || []).map((p) => LH.phoneType(p.number));
    return ['mobile', 'landline', 'corporate'].find((t) => types.includes(t)) || '';
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
    s += ad === 'past' ? 32 : ad === 'none' ? 30 : ad === 'likely' ? 22 : ad === 'running' ? -40 : 10;
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

  // The first email is the script in one block. These are its subject and the two follow ups,
  // which go as replies in the same thread a few working days apart.
  LH.DEFAULT_EMAILS = {
    ads: {
      subject: 'Quick question for {{business}}',
      followup1: 'Hello {{business}}\n\nJust bringing this back to the top of your inbox. Would a quick explanation of how it works be useful?\n\nLet me know',
      followup2: "Hello {{business}}\n\nI'll leave it here so I don't fill up your inbox. If more appointments from Facebook and Instagram ads is ever on your list just reply and I'll send the details.",
    },
    website: {
      subject: 'Website for {{business}}',
      followup1: 'Hello {{business}}\n\nJust bringing this back to the top of your inbox. Would you like me to send the free mockup?\n\nLet me know',
      followup2: "Hello {{business}}\n\nI'll leave it here so I don't fill up your inbox. If you ever want a simple website that brings in WhatsApp inquiries just reply and I'll send a free mockup.",
    },
  };
  LH.EMAIL_PARTS = ['subject', 'followup1', 'followup2'];

  /** Edits from Settings over the defaults, part by part. */
  const withEdits = (defaults, parts, saved) => {
    const out = {};
    for (const [k, def] of Object.entries(defaults)) {
      out[k] = { ...def };
      for (const part of parts) if (saved && saved[k] && typeof saved[k][part] === 'string') out[k][part] = saved[k][part];
    }
    return out;
  };
  /** The scripts in use. */
  LH.scriptsFor = (settings) => withEdits(LH.DEFAULT_SCRIPTS, LH.SCRIPT_PARTS, settings && settings.scripts);
  /** The email subjects and follow ups in use. */
  LH.emailsFor = (settings) => withEdits(LH.DEFAULT_EMAILS, LH.EMAIL_PARTS, settings && settings.emails);

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
    if (ad === 'past') return { script: 'ads', tag: 'Ran ads before' };
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
  LH.leadTags = (lead, ctx = {}) => {
    if (!lead) return [];
    const tags = [];
    if (ctx.history && lead.status === 'new' && LH.historyHit(lead, ctx.history)) tags.push('Contacted before');
    const phone = LH.leadPhoneType(lead);
    if (phone) tags.push(phone.charAt(0).toUpperCase() + phone.slice(1));
    if (lead.kind === 'prospect' && LH.isChain(lead, ctx.chains)) tags.push('Chain');
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
      niche: niche ? LH.nicheText(niche, settings) : 'businesses',
      city: LH.cityOf(l.area, settings.adsCity || 'Dubai'),
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

  /** The lead's script (`force` = 'website' pitches a skipped lead anyway), its variables and its rendered parts. */
  const rendered = (lead, settings, force) => {
    const pick = LH.scriptFor(lead);
    const script = force && LH.DEFAULT_SCRIPTS[force] ? force : pick.script;
    if (!script) return { script: null, tag: pick.tag };
    const t = LH.scriptsFor(settings)[script];
    const vars = LH.scriptVars(lead, settings);
    // No name at all: "Hello there", and the body says "I came across your business on…".
    const nameless = (business) => (vars.business ? vars : { ...vars, business });
    const parts = LH.SCRIPT_PARTS.map((p) => LH.render(t[p], nameless({ greeting: 'there', body: 'your business' }[p] || '')));
    return { script, tag: pick.tag, vars, nameless, parts };
  };

  /**
   * The message for a lead, split into WhatsApp bubbles. WhatsApp is never sent from here:
   * every bubble is prefilled or copied, and Samil presses Send himself.
   *   3 bubbles: [greeting] [body] [closing] · 2 bubbles: [greeting + body] [closing]. Empty bubbles are dropped.
   * `subject` and `email` are the first email, the same one the email sender sends.
   */
  LH.pitchFor = (lead, settings = {}, force) => {
    const r = rendered(lead, settings, force);
    if (!r.script) return { script: null, tag: r.tag, bubbles: [], text: '', subject: '', email: '' };
    const [greeting, body, closing] = r.parts;
    const parts = Number(settings.bubbles) === 2 ? [[greeting, body].filter(Boolean).join('\n\n'), closing] : [greeting, body, closing];
    const bubbles = parts.filter(Boolean);
    const mail = LH.emailFor(lead, settings, force);
    return { script: r.script, tag: r.tag, bubbles, text: bubbles.join('\n\n'), subject: mail.subject, email: mail.steps[0] || '' };
  };

  /**
   * The emails for a lead: the script in one email, then the follow ups (Settings says how many). Each one ends
   * with the signature and the opt out line. `to` is their first address that has not bounced and is not a
   * template placeholder, '' when there is none or they are on the never email list. Leads skipped for running ads get no emails.
   */
  LH.emailFor = (lead, settings = {}, force) => {
    const r = rendered(lead, settings, force);
    const to = (lead && !lead.doNotEmail && LH.goodEmails(lead)[0]) || '';
    if (!r.script) return { script: null, tag: r.tag, to, subject: '', steps: [] };
    const D = LH.DEFAULT_SETTINGS;
    const t = LH.emailsFor(settings)[r.script];
    const end = [settings.emailSignature ?? D.emailSignature, settings.emailOptOut ?? D.emailOptOut].map((x) => LH.render(x, r.vars)).filter(Boolean);
    const count = Math.max(0, Math.min(2, Math.round(Number(settings.emailFollowups ?? D.emailFollowups)) || 0));
    const first = r.parts.filter(Boolean).join('\n\n');
    const followups = [t.followup1, t.followup2].slice(0, count).map((x) => LH.render(x, r.nameless('there')));
    const steps = first ? [first, ...followups].filter(Boolean).map((text) => [text, ...end].join('\n\n')) : [];
    // No name: "Quick question" or "Your website" instead of a subject ending in "for".
    const subject = (r.vars.business && LH.render(t.subject, r.vars)) || { ads: 'Quick question', website: 'Your website' }[r.script];
    return { script: r.script, tag: r.tag, to, subject, steps };
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

  /* ------------------------------------------------------------ Email addresses */
  // Addresses website builders put in their templates (GoDaddy's filler@godaddy.com and the like) and other
  // placeholders. They are never a real inbox, and an email to one bounces, which hurts the Gmail that sent it.
  const JUNK_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.\w+|yoursite\.\w+|mysite\.com|website\.com|test\.com|sentry\.io|wixpress\.com|wix\.com|godaddy\.com|secureserver\.net|squarespace\.com|weebly\.com|jimdo\.com|shopify\.com|wordpress\.(com|org)|mailchimp\.com)$/;
  const JUNK_USER = /^(filler|name|your|yourname|you|user|username|email|e-?mail|test|example|sample|someone|john\.?doe|jane\.?doe|no-?reply|do-?not-?reply|donotreply)$/;
  LH.isJunkEmail = (email) => {
    const [user, domain, extra] = String(email || '').trim().toLowerCase().split('@');
    return !user || !domain || extra !== undefined || /\.(png|jpe?g|gif|webp|svg|css|js)$/.test(domain) || JUNK_DOMAIN.test(domain) || JUNK_USER.test(user);
  };
  /** The addresses worth emailing: not bounced before, not a placeholder. */
  LH.goodEmails = (lead) => ((lead && lead.emails) || []).filter((e) => !((lead.badEmails || []).includes(e) || LH.isJunkEmail(e)));

  /* ------------------------------------------------------- One business, one record */
  // How two finds are recognised as the same business: same phone, same website (root domain), same Instagram
  // handle, or nearly the same name (Jaro-Winkler, 0.92 by default) in the same area.
  const NAME_SUFFIX = /\b(l\s*l\s*c|fz\s*llc|fzllc|fze|fzco|fzc|fz|llc|trading|est|establishment|co|company|services?|dubai|uae|and)\b/g;
  /** "Gloss Garage L.L.C - Dubai" -> "gloss garage" */
  LH.normName = (name) =>
    String(name || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(NAME_SUFFIX, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  /** Jaro-Winkler similarity, 0 to 1. */
  LH.jaroWinkler = (a, b) => {
    a = String(a || '');
    b = String(b || '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const am = new Array(a.length).fill(false);
    const bm = new Array(b.length).fill(false);
    let m = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
        if (bm[j] || a[i] !== b[j]) continue;
        am[i] = bm[j] = true;
        m++;
        break;
      }
    }
    if (!m) return 0;
    let t = 0;
    for (let i = 0, k = 0; i < a.length; i++) {
      if (!am[i]) continue;
      while (!bm[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
    const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
    let prefix = 0;
    while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
    return jaro + prefix * 0.1 * (1 - jaro);
  };

  // Free website builders: the subdomain is the business, so "gloss.wixsite.com" is not "wixsite.com".
  LH.FREE_BUILDERS = ['wixsite.com', 'godaddysites.com', 'square.site', 'webflow.io', 'wordpress.com', 'weebly.com', 'site123.me', 'carrd.co', 'blogspot.com', 'myshopify.com', 'business.site', 'mystrikingly.com', 'odoo.com', 'netlify.app', 'vercel.app'];
  const SECOND_LEVEL = /^(co|net|org|ac|gov|sch|mil|com|edu)\.(ae|uk|sa|qa|om|bh|kw|in|pk|au|nz|za|jp)$/;
  /** The registrable domain: "shop.gloss.ae" -> "gloss.ae", "gloss.co.ae" stays, "gloss.wixsite.com" stays. */
  LH.rootDomain = (url) => {
    const host = LH.domainOf(url);
    if (!host || LH.FREE_BUILDERS.some((b) => host === b || host.endsWith(`.${b}`))) return host;
    const parts = host.split('.');
    const n = parts.length >= 3 && SECOND_LEVEL.test(parts.slice(-2).join('.')) ? 3 : 2;
    return parts.slice(-n).join('.');
  };

  /* ------------------------------------------------------------ Contacted memory */
  /**
   * Everything that identifies a business you have contacted, as history keys: its phones, website, Instagram
   * handle, and its name in its area. A business found later with any of them is not added again.
   */
  LH.historyKeys = (lead) => {
    const l = lead || {};
    const keys = [];
    for (const p of l.phones || []) {
      // A number found in a website's text can be someone else's (the web designer, the mall): its domain matches instead.
      const n = typeof p === 'string' ? p : p && p.source !== 'website' && p.number;
      if (n) keys.push(`p:${n}`);
    }
    for (const n of l.whatsapp || []) if (n) keys.push(`p:${n}`);
    if (l.website && LH.linkKind(l.website) === 'website') keys.push(`d:${LH.rootDomain(l.website)}`);
    const ig = (((l.instagram || (l.sources || {}).instagram) || {}).username || LH.igHandle(l) || '').replace(/^@/, '').toLowerCase();
    if (ig) keys.push(`i:${ig}`);
    const name = LH.normName(l.pageName || l.name);
    if (name.length > 2 && l.area) keys.push(`n:${name}@${String(l.area).toLowerCase()}`);
    return [...new Set(keys)];
  };
  /** The history entry that matches this business, or null. An entry made from the same lead never hides it. */
  LH.historyHit = (lead, history) => {
    if (!history) return null;
    for (const key of LH.historyKeys(lead)) {
      const e = history[key];
      if (e && !(lead.id && e[2] === lead.id)) return { key, at: e[0], via: e[1] };
    }
    return null;
  };

  /* Fuzzy names, per area: { 'jlt': [['gloss garage', 'p:m:…'], …] }. */
  LH.addName = (index, lead) => {
    const name = LH.normName(lead.pageName);
    const area = String(lead.area || '').toLowerCase();
    if (name.length < 4 || !area) return;
    const list = (index[area] = index[area] || []);
    if (!list.some(([n, id]) => n === name && id === lead.id)) list.push([name, lead.id]);
  };
  /** The lead with nearly the same name in the same area (Jaro-Winkler at or above the threshold), or null. */
  LH.findByName = (index, name, area, threshold = 0.92) => {
    const n = LH.normName(name);
    const list = index && area ? index[String(area).toLowerCase()] : null;
    if (n.length < 4 || !list) return null;
    let best = null;
    let top = threshold;
    for (const [m, id] of list) {
      const score = LH.jaroWinkler(n, m);
      if (score >= top) (best = id), (top = score);
    }
    return best;
  };

  /** A CSV file as rows of cells (quotes, commas and line breaks inside quotes, a BOM at the start). */
  LH.parseCsv = (text) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && !cell) quoted = true;
      else if (c === ',' || c === ';' || c === '\t') row.push(cell), (cell = '');
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows;
  };
  /** Every UAE phone number in a CSV (your CRM sheet or a Google Contacts export), in +971 format. */
  LH.phonesInCsv = (text, country = 'AE') => {
    const out = new Set();
    for (const row of LH.parseCsv(text))
      for (const cell of row) {
        if (!/\d{6,}|\d[\d\s().+-]{7,}\d/.test(cell)) continue;
        // Google Contacts puts several numbers in one cell: "+971 50 123 4567 ::: 04 123 4567"
        for (const part of cell.split(/:::|\/|,|;|\|/)) {
          const n = LH.normalizePhone(part.trim(), country);
          if (n && /^\+\d{9,15}$/.test(n)) out.add(n);
        }
      }
    return [...out];
  };

  /* ---------------------------------------------------------- Google Contacts */
  /**
   * Leads as a Google Contacts import file (Google CSV format): the business name as the contact name, so WhatsApp
   * on your phone shows who each chat is. Leads without a phone or an email are left out. All go in one label.
   */
  LH.GOOGLE_CONTACTS_HEAD = ['Name', 'Given Name', 'Family Name', 'Organization 1 - Name', 'Phone 1 - Type', 'Phone 1 - Value', 'Phone 2 - Type', 'Phone 2 - Value', 'E-mail 1 - Type', 'E-mail 1 - Value', 'Website 1 - Type', 'Website 1 - Value', 'Address 1 - Type', 'Address 1 - Formatted', 'Notes', 'Group Membership'];
  LH.googleContactsRows = (leads, settings = {}) =>
    (leads || [])
      .filter(Boolean)
      .map((l) => {
        const main = LH.whatsappTarget(l) || (LH.bestPhone(l) || {}).number || '';
        const other = ((l.phones || []).find((p) => p.number && p.number !== main) || {}).number || '';
        const email = LH.goodEmails(l)[0] || '';
        if (!main && !email) return null;
        const name = LH.shortName(l.pageName) || LH.igHandle(l) || LH.domainOf(l.website || '') || main;
        const status = (LH.STATUSES.find((s) => s.id === l.status) || {}).label || '';
        const notes = ['RizcoReach lead', LH.nicheOf(l, settings), l.area, LH.tagLine(l), status].filter(Boolean).join(' · ');
        const address = (((l.sources || {}).maps || {}).address) || '';
        return [name, name, '', name, main ? 'Mobile' : '', main, other ? 'Work' : '', other, email ? 'Work' : '', email, l.website ? 'Work' : '', l.website || '', address ? 'Work' : '', address, notes, '* myContacts ::: RizcoReach leads'];
      })
      .filter(Boolean);

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
