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
  // owner run business has, and where to look. Searches run as "{keyword} {area}".
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
      minReviews: 0,
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
      minReviews: 0,
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
      minReviews: 0,
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
      minReviews: 0,
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
  // Any business can need a website, so there is a preset for every common kind. They search the shared area list
  // (Settings > Areas) and keep every listing whatever its review count.
  const MORE_PRESETS = [
    ['New openings', 'new businesses', 'newly opened|recently opened|opening soon|grand opening|new restaurant|new cafe|new salon|new clinic|new gym|new shop', ''],
    ['Restaurants', 'restaurants', 'restaurant|cafeteria|shawarma|burger|pizza|grill restaurant|biryani|indian restaurant|arabic restaurant|asian restaurant', 'mcdonald\'s|kfc|pizza hut|subway|hardee\'s|burger king|domino\'s'],
    ['Cafes', 'cafes', 'cafe|coffee shop|specialty coffee|karak|tea house|juice bar|dessert cafe', 'starbucks|costa|tim hortons|dunkin|caribou'],
    ['Bakeries and sweets', 'bakeries and sweet shops', 'bakery|cake shop|sweets shop|pastry shop|chocolate shop|dessert shop|kunafa', ''],
    ['Catering and cloud kitchens', 'catering companies', 'catering|cloud kitchen|meal prep|healthy meals|home bakery', ''],
    ['Salons', 'beauty salons', 'ladies salon|beauty salon|hair salon|beauty center|makeup studio|bridal salon', ''],
    ['Barbers', 'barber shops', 'barber shop|gents salon|barbershop|mens grooming', ''],
    ['Nails and lashes', 'nail and lash studios', 'nail salon|nail studio|lash studio|brow bar|lash extensions', ''],
    ['Spas and massage', 'spas', 'spa|massage center|moroccan bath|wellness center|hammam', 'hotel|resort'],
    ['Aesthetic and skin clinics', 'aesthetic clinics', 'aesthetic clinic|skin clinic|laser clinic|dermatology clinic|slimming center|hair transplant clinic', 'hospital'],
    ['Dental clinics', 'dental clinics', 'dental clinic|dentist|orthodontist|dental center', 'hospital'],
    ['Medical and physio', 'medical centers', 'medical center|polyclinic|physiotherapy|chiropractor|optical shop|home healthcare|diagnostic center', 'hospital|pharmacy'],
    ['Vets and pet services', 'pet businesses', 'veterinary clinic|pet grooming|pet shop|dog training|pet boarding|pet daycare', ''],
    ['Gyms and studios', 'gyms and fitness studios', 'gym|fitness studio|pilates studio|yoga studio|crossfit|boxing gym|ems training|personal trainer|ladies gym', 'fitness first|gymnation|gold\'s gym'],
    ['Sports and kids activities', 'sports academies', 'swimming academy|football academy|martial arts|dance studio|kids play area|gymnastics|padel court', ''],
    ['Garages', 'car garages', 'car garage|auto repair|car service center|car workshop|tyre shop|car ac repair|auto electrician|car body shop', ''],
    ['Car wash and accessories', 'car care businesses', 'car wash|car accessories|car tinting|car upholstery|car polish', ''],
    ['Car rental', 'car rental companies', 'rent a car|car rental|luxury car rental|bike rental|motorcycle shop', 'hertz|avis|budget|thrifty|europcar'],
    ['Interior and fit-out', 'interior and fit-out companies', 'interior design company|fit out company|villa renovation|home renovation company|kitchen cabinets|joinery|gypsum works', ''],
    ['Home maintenance', 'home maintenance companies', 'home maintenance company|handyman|ac repair|plumber|electrician|painting company|technical services', ''],
    ['Cleaning and pest control', 'cleaning companies', 'cleaning company|deep cleaning|pest control|sofa cleaning|water tank cleaning|maid service', ''],
    ['Landscaping and pools', 'landscaping companies', 'landscaping company|swimming pool contractor|pergola|artificial grass|garden maintenance', ''],
    ['Curtains, furniture and decor', 'furniture and decor shops', 'curtains|blinds|furniture shop|upholstery|carpet shop|lighting shop|home decor|mattress shop', 'ikea|home centre|pan emirates|danube'],
    ['Movers and storage', 'moving companies', 'movers and packers|moving company|self storage|furniture movers', ''],
    ['Laundry', 'laundries', 'laundry|dry cleaners|laundry service|shoe laundry', ''],
    ['Fashion and tailoring', 'fashion boutiques', 'abaya shop|boutique|tailoring|ladies tailor|gents tailor|kandora|bridal shop|kids wear', ''],
    ['Perfumes, flowers and gifts', 'perfume and gift shops', 'perfume shop|oud|flower shop|gift shop|balloon shop|chocolate gifts', ''],
    ['Jewellery and watches', 'jewellery shops', 'jewellery shop|gold shop|watch shop|watch repair', ''],
    ['Phones and electronics', 'phone and electronics shops', 'mobile phone shop|mobile repair|computer repair|electronics shop|gaming shop|cctv installation', 'sharaf dg|jumbo|emax|etisalat|du '],
    ['Grocery and specialty food', 'food shops', 'grocery|mini mart|roastery|butchery|organic shop|dates shop|spices shop|fish market', 'carrefour|lulu|spinneys|waitrose|choithrams|union coop'],
    ['Typing and business setup', 'business services', 'typing center|business setup|document clearing|pro services|tax consultant|accounting firm|auditing|translation services', ''],
    ['Real estate', 'real estate brokers', 'real estate broker|real estate agency|property management|holiday homes', 'emaar|damac|nakheel|sobha'],
    ['Travel and tourism', 'travel companies', 'travel agency|tours|desert safari|yacht rental|visa services|umrah', ''],
    ['Events and photography', 'event companies', 'event planner|wedding planner|photography studio|party supplies|kids party|event rentals|videographer', ''],
    ['Education and nurseries', 'training centres', 'nursery|training institute|tutoring center|language institute|music school|art classes|coding classes|driving school', 'university'],
    ['Printing and signage', 'printing companies', 'printing press|signage company|advertising gifts|digital printing|sticker shop', ''],
    ['Legal and consultancy', 'consultancies', 'law firm|legal consultant|hr consultancy|recruitment agency|management consultancy|insurance broker', ''],
    ['Building and contracting', 'contractors', 'building contractor|contracting company|building materials|steel fabrication|aluminium and glass|scaffolding', ''],
  ];
  LH.DEFAULT_PRESETS.push(...MORE_PRESETS.map(([name, label, kw, ex]) => ({ name, label, minReviews: 0, maxReviews: 100000, keywords: kw.split('|'), exclude: ex ? ex.split('|') : [], areas: [] })));
  // Where every preset without its own areas searches, in this order.
  LH.DEFAULT_AREAS = (
    'Al Quoz Industrial Area 1, Dubai|' +
    'Al Quoz Industrial Area 2, Dubai|' +
    'Al Quoz Industrial Area 3, Dubai|' +
    'Al Quoz Industrial Area 4, Dubai|' +
    'Al Quoz, Dubai|' +
    'Business Bay, Dubai|' +
    'Dubai Design District, Dubai|' +
    'JLT, Dubai|' +
    'Al Barsha, Dubai|' +
    'Barsha Heights, Dubai|' +
    'Deira, Dubai|' +
    'Bur Dubai, Dubai|' +
    'Al Karama, Dubai|' +
    'Oud Metha, Dubai|' +
    'Port Saeed, Dubai|' +
    'Al Garhoud, Dubai|' +
    'Al Qusais, Dubai|' +
    'Al Qusais Industrial Area, Dubai|' +
    'Ras Al Khor Industrial Area, Dubai|' +
    'Umm Ramool, Dubai|' +
    'Dubai Investments Park, Dubai|' +
    'Jebel Ali Industrial Area, Dubai|' +
    'Dubai Silicon Oasis, Dubai|' +
    'Al Nahda, Dubai|' +
    'Al Rigga, Dubai|' +
    'Al Muraqqabat, Dubai|' +
    'Hor Al Anz, Dubai|' +
    'Al Twar, Dubai|' +
    'Muhaisnah, Dubai|' +
    'Al Satwa, Dubai|' +
    'Al Mankhool, Dubai|' +
    'Downtown Dubai, Dubai|' +
    'DIFC, Dubai|' +
    'Al Sufouh, Dubai|' +
    'Dubai Media City, Dubai|' +
    'Dubai Internet City, Dubai|' +
    'Al Jaddaf, Dubai|' +
    'Dubai Festival City, Dubai|' +
    'International City, Dubai|' +
    'Jumeirah, Dubai|' +
    'Umm Suqeim, Dubai|' +
    'Al Wasl, Dubai|' +
    'Al Safa, Dubai|' +
    'Al Manara, Dubai|' +
    'Palm Jumeirah, Dubai|' +
    'Dubai Marina, Dubai|' +
    'JBR, Dubai|' +
    'Emirates Hills, Dubai|' +
    'Jumeirah Islands, Dubai|' +
    'Jumeirah Park, Dubai|' +
    'Jumeirah Golf Estates, Dubai|' +
    'The Springs, Dubai|' +
    'The Meadows, Dubai|' +
    'The Greens, Dubai|' +
    'The Lakes, Dubai|' +
    'Arabian Ranches, Dubai|' +
    'Arabian Ranches 2, Dubai|' +
    'Dubai Hills, Dubai|' +
    'Al Barari, Dubai|' +
    'Meydan, Dubai|' +
    'Nad Al Sheba, Dubai|' +
    'Damac Hills, Dubai|' +
    'Damac Hills 2, Dubai|' +
    'Town Square, Dubai|' +
    'Mudon, Dubai|' +
    'Tilal Al Ghaf, Dubai|' +
    'Motor City, Dubai|' +
    'Dubai Sports City, Dubai|' +
    'JVC, Dubai|' +
    'JVT, Dubai|' +
    'Al Furjan, Dubai|' +
    'Discovery Gardens, Dubai|' +
    'Arjan, Dubai|' +
    'Al Barsha South, Dubai|' +
    'Mirdif, Dubai|' +
    'Al Mizhar, Dubai|' +
    'Al Khawaneej, Dubai|' +
    'Al Warqa, Dubai|' +
    'Al Rashidiya, Dubai|' +
    'Nad Al Hamar, Dubai|' +
    'Dubai Creek Harbour, Dubai|' +
    'Dubai South, Dubai|' +
    'Jebel Ali Village, Dubai|' +
    'Mussafah, Abu Dhabi|' +
    'Mohammed Bin Zayed City, Abu Dhabi|' +
    'Khalifa City, Abu Dhabi|' +
    'Al Shamkha, Abu Dhabi|' +
    'Al Reef, Abu Dhabi|' +
    'Al Raha, Abu Dhabi|' +
    'Al Raha Beach, Abu Dhabi|' +
    'Yas Island, Abu Dhabi|' +
    'Saadiyat Island, Abu Dhabi|' +
    'Al Reem Island, Abu Dhabi|' +
    'Al Maryah Island, Abu Dhabi|' +
    'Al Khalidiyah, Abu Dhabi|' +
    'Al Bateen, Abu Dhabi|' +
    'Corniche, Abu Dhabi|' +
    'Al Markaziyah, Abu Dhabi|' +
    'Al Zahiyah, Abu Dhabi|' +
    'Hamdan Street, Abu Dhabi|' +
    'Electra Street, Abu Dhabi|' +
    'Al Nahyan, Abu Dhabi|' +
    'Al Mushrif, Abu Dhabi|' +
    'Al Karamah, Abu Dhabi|' +
    'Al Manaseer, Abu Dhabi|' +
    'Al Muroor, Abu Dhabi|' +
    'Al Wahdah, Abu Dhabi|' +
    'Al Mina, Abu Dhabi|' +
    'Masdar City, Abu Dhabi|' +
    'Shakhbout City, Abu Dhabi|' +
    'Baniyas, Abu Dhabi|' +
    'Al Falah, Abu Dhabi|' +
    'Al Rahba, Abu Dhabi|' +
    'Al Ain|' +
    'Al Ain Industrial Area, Al Ain|' +
    'Al Jimi, Al Ain|' +
    'Al Muwaiji, Al Ain|' +
    'Al Towayya, Al Ain|' +
    'Sharjah Industrial Area, Sharjah|' +
    'Al Sajaa Industrial Area, Sharjah|' +
    'Al Majaz, Sharjah|' +
    'Al Khan, Sharjah|' +
    'Al Taawun, Sharjah|' +
    'Al Nahda, Sharjah|' +
    'Al Qasimia, Sharjah|' +
    'Al Qasba, Sharjah|' +
    'Muwaileh, Sharjah|' +
    'University City, Sharjah|' +
    'Aljada, Sharjah|' +
    'Al Zahia, Sharjah|' +
    'Tilal City, Sharjah|' +
    'Maryam Island, Sharjah|' +
    'Al Yarmook, Sharjah|' +
    'Rolla, Sharjah|' +
    'Abu Shagara, Sharjah|' +
    'Al Rahmaniya, Sharjah|' +
    'Ajman Industrial Area, Ajman|' +
    'Al Jurf, Ajman|' +
    'Al Nuaimiya, Ajman|' +
    'Al Rashidiya, Ajman|' +
    'Al Rawda, Ajman|' +
    'Al Mowaihat, Ajman|' +
    'Emirates City, Ajman|' +
    'Ajman Corniche, Ajman|' +
    'Al Nakheel, Ras Al Khaimah|' +
    'Al Hamra Village, Ras Al Khaimah|' +
    'Mina Al Arab, Ras Al Khaimah|' +
    'Al Marjan Island, Ras Al Khaimah|' +
    'Al Dhait, Ras Al Khaimah|' +
    'Khuzam, Ras Al Khaimah|' +
    'Al Qusaidat, Ras Al Khaimah|' +
    'Al Jazeera Al Hamra, Ras Al Khaimah|' +
    'Umm Al Quwain|' +
    'Umm Al Quwain Industrial Area, Umm Al Quwain|' +
    'Fujairah City, Fujairah|' +
    'Fujairah Industrial Area, Fujairah|' +
    'Dibba, Fujairah'
  ).split('|');
  /** The areas a preset searches: its own, else the shared list from Settings (the built in one when that is empty). */
  LH.presetAreas = (preset, settings) => {
    const own = LH.parseLines(preset && preset.areas);
    if (own.length) return own.slice(0, 300);
    const shared = LH.parseLines(settings && settings.areas);
    return (shared.length ? shared : LH.DEFAULT_AREAS).slice(0, 300);
  };
  // Ad Library searches that find businesses advertising their own opening.
  LH.OPENING_AD_KEYWORDS = ['grand opening', 'now open', 'newly opened', 'soft opening', 'opening soon', 'we are open', 'new branch', 'الافتتاح الكبير', 'افتتاح'];
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
    const s = settings || {};
    const saved = (Array.isArray(s.niches) ? s.niches : []).filter((n) => n && n.areas != null).map(LH.cleanPreset).filter((n) => n.name);
    const hidden = new Set((Array.isArray(s.hiddenPresets) ? s.hiddenPresets : []).map((x) => String(x).toLowerCase()));
    const mine = new Map(saved.map((p) => [p.name.toLowerCase(), p]));
    const builtIn = LH.DEFAULT_PRESETS.map(LH.cleanPreset);
    const names = new Set(builtIn.map((p) => p.name.toLowerCase()));
    // The built in ones (your edited copy when you changed one, none you removed), then the ones you added.
    return [...builtIn.filter((p) => !hidden.has(p.name.toLowerCase())).map((p) => mine.get(p.name.toLowerCase()) || p), ...saved.filter((p) => !names.has(p.name.toLowerCase()))];
  };
  LH.presetsFor = LH.nichesFor;

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
  const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'];
  /** "Al Nahda, Sharjah" -> "Sharjah", "Fujairah" -> "Fujairah", "Al Quoz" (older leads) -> the fallback. */
  LH.cityOf = (area, fallback = 'Dubai') => {
    const a = String(area || '').trim();
    const last = (a.includes(',') ? a.split(',').pop() : a).trim().toLowerCase();
    return EMIRATES.find((e) => e.toLowerCase() === last) || fallback;
  };

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
    autoEnrich: true,
    placesKey: '',
    placesAuto: true,
    placesMonthlyCap: 950,
    scrollDelayMs: 1800,
    adsCity: 'Dubai',
    // Instagram Graph API (Business Discovery): bio, link and latest posts. Your own token, from your own Meta app.
    igAccountId: '',
    igToken: '',
    igApiVersion: 'v23.0',
    igAuto: true, // read the Instagram of new businesses that have one
    areas: null, // the shared area list as text, null = LH.DEFAULT_AREAS
    hiddenPresets: null, // built in presets you removed
    newDays: 120, // proof that a business opened counts as "just opened" for this many days
    // Email check: the domain is always looked up. With a QuickEmailVerification key the mailbox itself is too.
    verifyKey: '',
    verifyDailyCap: 100, // mailbox checks a day (their free plan gives 100)
    emailRisky: false, // also export addresses the mailbox check could not confirm
    fbEmailAuto: true, // read the email on the Facebook page of leads that fit and have none, in the check tab
    // Intent Radar (Phase 5)
    radarEveryHours: 3, // scan Reddit every this many hours, 0 = only when you press Scan now
    intentMaxDays: 14, // only posts this new
    intentCap: 100, // posts read per subreddit per scan (Reddit's maximum is 100)
    subreddits: 'dubai\nUAE\nabudhabi\nsharjah',
    uaeOnlySubs: 'smallbusiness', // these count only when the post mentions the UAE
    redditClientId: '', // optional: an app from reddit.com/prefs/apps (installed app: the id is enough)
    redditSecret: '',
    intentKeywords: null, // { website, marketing, pain, hiring, arabic } as text, null = defaults (LH.INTENT_KEYWORDS)
    sellerWords: null, // null = LH.SELLER_WORDS
    // Intent AI check (Phase 6): an AI reads each new post and says whether it is a real buyer.
    // Gemini when geminiKey is filled in, else Claude when anthropicKey is.
    geminiKey: '', // a Google AI Studio key (free tier), kept in this browser only
    geminiModel: 'gemini-flash-lite-latest',
    anthropicKey: '', // your Claude API key, kept in this browser only
    aiModel: 'claude-haiku-5-5',
    aiAuto: true, // check new posts as they come in
    nameMatch: 0.92, // how close two names in the same area must be to count as one business (Jaro-Winkler, 0.8 to 1)
    niches: null, // the kinds of business you changed or added (the built in ones are LH.DEFAULT_PRESETS)
  };
  // Settings from earlier versions that no longer do anything.
  // (1.12: pitching from the dashboard and the phone queue were removed. 2.3: Lead Hunter no longer writes or sends
  // emails; the cold email system in cold-email/ does, so the email sender, its texts and your signature went.
  // 3.0: the Meta ads client finder, the heat score, the quality signals and PageSpeed went.)
  const OLD_SETTINGS = ['templates', 'adTemplates', 'adsOffer', 'scripts', 'bubbles', 'intentOpeners', 'emails', 'emailFromName', 'emailMaxPerDay', 'emailFollowups', 'emailSignature', 'emailOptOut', 'queueSite', 'queueKey', 'queueKeyAt', 'myName', 'agency', 'myPhone', 'myWebsite', 'auditLinkBase', 'pagespeedKey', 'pagespeedAuto', 'followerMin', 'followerMax', 'newBusinessReviews', 'weakSiteMin', 'psiMin', 'copyrightYears', 'weakChecks', 'heatWeights', 'heatHot', 'heatWarm', 'targetNiches', 'igActiveDays', 'adCheckAll'];
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
   * A business name the way you'd type it, for the exports. The stored name stays as it is.
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

  /* ------------------------------------------------------------- Facebook pages */
  // (Email addresses live in lib/emails.js.)
  /**
   * The business's own Facebook page: the one their website or Google Maps links to, or for website leads the
   * advertiser's page. '' when there is none (a share link, a group or a post is not a page).
   */
  LH.facebookPageUrl = (lead) => {
    const l = lead || {};
    const u = LH.safeUrl((l.socials || {}).facebook || '');
    if (u && LH.linkKind(u) === 'facebook') {
      const first = u.pathname.split('/').filter(Boolean)[0] || '';
      const id = u.searchParams.get('id') || '';
      if (first === 'profile.php') return /^\d{5,}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : '';
      if (first && !/^(sharer|share|plugins|tr|dialog|groups|events|watch|login|hashtag|photo\.php|story\.php|permalink\.php|ads|reel|marketplace|gaming)$/i.test(first)) return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}`;
    }
    if (l.kind !== 'prospect' && /^\d{5,}$/.test(String(l.pageId || ''))) return `https://www.facebook.com/${l.pageId}`;
    return '';
  };

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

  /* ------------------------------------------------------------ Opening hours */
  /** "Opens 10 AM", "Closed", "Open 24 hours": opening hours, which Google Maps lists show where an address can be. */
  LH.looksLikeHours = (s) => /^(open|opens|opening|closed|closes|closing|temporarily closed|permanently closed)\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|24 hours/i.test(String(s || '').trim());

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
