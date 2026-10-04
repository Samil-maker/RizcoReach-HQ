export interface IndustryContent {
  name: string;
  short: string;
  audience: string;
  metaTitle: string;
  metaDescription: string;
  kicker: string;
  title: string;
  sub: string;
  quote: string;
  author: string;
  role: string;
  result: string;
  niches: string[];
  mistakes: { t: string; d: string }[];
  expect: string[];
}

export interface Industry {
  slug: string;
  code: string;
  en: IndustryContent;
  ar: IndustryContent;
}

export const industries: Industry[] = [
  {
    slug: 'construction-home-improvement',
    code: 'BUILD',
    en: {
      name: 'Construction & Home Improvement',
      short: 'More high-value projects, fewer tire-kickers',
      audience: 'homeowners',
      metaTitle: 'Construction & Home Improvement Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and Meta Ads for construction, fit-out and home improvement companies in Dubai. Win high-value projects without underbidding on price.',
      kicker: 'Construction & Home Improvement · Dubai & UAE',
      title: 'Win more <em>high-value</em> projects',
      sub: 'Without underbidding on price, chasing time-wasters, or losing jobs to louder competitors.',
      quote:
        'Real leads, real projects. The quality of inquiries we get now is night and day compared to what we were doing before.',
      author: 'Construction Client',
      role: 'Home Improvement Business · Dubai',
      result: 'High-value residential project pipeline built within 60 days',
      niches: [
        'Fit-out & interior contractors',
        'Kitchen specialists',
        'Roofing & waterproofing',
        'Window & door installers',
        'Joinery & carpentry',
        'Fencing & gates',
        'Awning & shading',
        'Flooring specialists',
        'MEP contractors',
        'Renovation companies',
        'Swimming pool builders',
        'Facade & cladding',
      ],
      mistakes: [
        {
          t: 'Generic content that looks like everyone else',
          d: 'Most builders show the same polished renders and generic taglines. There’s no emotional hook, nothing that makes a homeowner feel you understand their project.',
        },
        {
          t: 'Leads who ghost or low-ball',
          d: 'Generating volume without qualification leads to wasted quotes. You need a system that filters and pre-sells before the first call.',
        },
        {
          t: 'Relying on referrals alone',
          d: 'Word-of-mouth is unpredictable. Without a paid acquisition engine, your pipeline dries up the moment referrals slow down.',
        },
      ],
      expect: [
        'Steady flow of qualified homeowner leads',
        'Pre-vetted prospects who have a real budget',
        'Ad creatives built around your niche and location',
        'Weekly reporting with clear ROI metrics',
      ],
    },
    ar: {
      name: 'المقاولات وتحسين المنازل',
      short: 'مشاريع أعلى قيمة، وعملاء أكثر جدية',
      audience: 'أصحاب المنازل',
      metaTitle: 'وكالة تسويق لشركات المقاولات وتحسين المنازل · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وإعلانات ميتا لشركات المقاولات والتشطيبات وتحسين المنازل في دبي. احصل على مشاريع عالية القيمة دون خفض أسعارك.',
      kicker: 'المقاولات وتحسين المنازل · دبي والإمارات',
      title: 'اربح مشاريع <em>أعلى قيمة</em>',
      sub: 'دون أن تخفّض أسعارك، أو تطارد عملاء غير جادين، أو تخسر المشاريع لمنافسين أعلى صوتاً.',
      quote: 'عملاء حقيقيون ومشاريع حقيقية. جودة الاستفسارات التي تصلنا اليوم مختلفة تماماً عمّا كنّا نحصل عليه من قبل.',
      author: 'عميل في قطاع المقاولات',
      role: 'شركة تحسين منازل · دبي',
      result: 'قائمة مشاريع سكنية عالية القيمة خلال 60 يوماً',
      niches: [
        'مقاولو التشطيبات والديكور الداخلي',
        'متخصصو المطابخ',
        'الأسطح والعزل المائي',
        'تركيب النوافذ والأبواب',
        'النجارة والأعمال الخشبية',
        'الأسوار والبوابات',
        'المظلات والتظليل',
        'متخصصو الأرضيات',
        'مقاولو الأعمال الكهروميكانيكية',
        'شركات الترميم',
        'بناء المسابح',
        'الواجهات والكسوات',
      ],
      mistakes: [
        {
          t: 'محتوى عام يشبه الجميع',
          d: 'يعرض معظم المقاولين الصور المجسّمة نفسها والشعارات المكررة. لا يوجد ما يلامس صاحب المنزل أو يُشعره بأنك تفهم مشروعه.',
        },
        {
          t: 'عملاء يختفون أو يفاوضون على أقل سعر',
          d: 'جلب أعداد كبيرة دون تأهيل يعني عروض أسعار ضائعة. تحتاج إلى نظام يفرز العملاء ويقنعهم قبل أول مكالمة.',
        },
        {
          t: 'الاعتماد على التوصيات فقط',
          d: 'التوصيات الشفهية غير مضمونة. دون محرك استقطاب مدفوع، تجفّ قائمة مشاريعك بمجرد أن تتباطأ التوصيات.',
        },
      ],
      expect: [
        'تدفّق مستمر من أصحاب المنازل المؤهَّلين',
        'عملاء مُفحوصون مسبقاً لديهم ميزانية حقيقية',
        'إعلانات مصمّمة لتخصصك ومنطقتك',
        'تقارير أسبوعية بمؤشرات عائد واضحة',
      ],
    },
  },
  {
    slug: 'it-software',
    code: 'TECH',
    en: {
      name: 'IT & Software',
      short: 'Qualified B2B leads that convert to enterprise deals',
      audience: 'IT buyers',
      metaTitle: 'IT & Software Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and paid campaigns for IT, SaaS and software companies in Dubai. Get in front of the SME owners and IT managers who need your solution.',
      kicker: 'IT & Software Marketing · Dubai & UAE',
      title: 'Attract <em>decision-makers</em> who are ready to buy',
      sub: 'Cut through the noise in a saturated tech market and get in front of the exact SME owners and IT managers who need your solution.',
      quote:
        'We had tried ads before and wasted our budget. RizcoReach was different, they actually understood our buyers and built campaigns that hit the right people.',
      author: 'IT Solutions Client',
      role: 'Software Company · Dubai',
      result: 'Qualified decision-maker leads within 30 days of launch',
      niches: [
        'SaaS & software companies',
        'IT support & managed services',
        'Cybersecurity firms',
        'Custom software developers',
        'Cloud solution providers',
        'ERP & CRM implementors',
        'Web & mobile app agencies',
        'IT infrastructure suppliers',
        'Digital transformation consultants',
        'Hardware & networking suppliers',
        'Data & analytics companies',
        'AI solution providers',
      ],
      mistakes: [
        {
          t: 'Talking features, not outcomes',
          d: 'Tech buyers don’t care about your stack, they care about what problem it solves. Lead with the outcome, not the spec sheet.',
        },
        {
          t: 'Targeting too broadly',
          d: 'Spending budget on audiences that will never buy. You need laser-targeted campaigns aimed at the exact company size and role that converts.',
        },
        {
          t: 'No nurture after the first touch',
          d: 'Most IT leads need multiple touchpoints before they commit. Without retargeting and follow-up sequences, you’re leaving money on the table.',
        },
      ],
      expect: [
        'Quality B2B leads from relevant decision-makers',
        'Industry-specific ad copy that resonates with IT buyers',
        'LinkedIn and Meta campaigns working in tandem',
        'CRM-ready lead data delivered on day one',
      ],
    },
    ar: {
      name: 'تقنية المعلومات والبرمجيات',
      short: 'عملاء شركات مؤهَّلون يتحوّلون إلى صفقات كبرى',
      audience: 'مشتري الحلول التقنية',
      metaTitle: 'وكالة تسويق لشركات تقنية المعلومات والبرمجيات · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وحملات مدفوعة لشركات تقنية المعلومات والبرمجيات في دبي. اصل إلى أصحاب الشركات ومديري التقنية الذين يحتاجون حلولك.',
      kicker: 'تسويق تقنية المعلومات والبرمجيات · دبي والإمارات',
      title: 'استقطب <em>صنّاع القرار</em> الجاهزين للشراء',
      sub: 'تميّز في سوق تقني مزدحم، وكن أمام أصحاب الشركات الصغيرة والمتوسطة ومديري تقنية المعلومات الذين يحتاجون حلّك تحديداً.',
      quote:
        'جرّبنا الإعلانات من قبل وأهدرنا ميزانيتنا. كانت RizcoReach مختلفة، فهموا عملاءنا فعلاً وبنوا حملات تصل إلى الأشخاص المناسبين.',
      author: 'عميل في حلول تقنية المعلومات',
      role: 'شركة برمجيات · دبي',
      result: 'عملاء مؤهَّلون من صنّاع القرار خلال 30 يوماً من الإطلاق',
      niches: [
        'شركات البرمجيات وSaaS',
        'الدعم الفني والخدمات المُدارة',
        'شركات الأمن السيبراني',
        'مطوّرو البرمجيات المخصّصة',
        'مزوّدو الحلول السحابية',
        'منفّذو أنظمة ERP وCRM',
        'وكالات تطبيقات الويب والجوال',
        'مورّدو البنية التحتية التقنية',
        'مستشارو التحوّل الرقمي',
        'مورّدو الأجهزة والشبكات',
        'شركات البيانات والتحليلات',
        'مزوّدو حلول الذكاء الاصطناعي',
      ],
      mistakes: [
        {
          t: 'الحديث عن الميزات لا النتائج',
          d: 'لا يهتم المشتري التقني بالتقنيات التي تستخدمها، بل بالمشكلة التي تحلّها. ابدأ بالنتيجة لا بالمواصفات.',
        },
        {
          t: 'استهداف واسع جداً',
          d: 'إنفاق الميزانية على جمهور لن يشتري أبداً. تحتاج حملات دقيقة تستهدف حجم الشركة والمنصب الذي يحقق التحويل.',
        },
        {
          t: 'غياب المتابعة بعد أول تواصل',
          d: 'معظم عملاء التقنية يحتاجون عدة نقاط تواصل قبل الالتزام. دون إعادة استهداف ومتابعة، تترك أرباحاً على الطاولة.',
        },
      ],
      expect: [
        'عملاء شركات ذوو جودة من صنّاع القرار المعنيين',
        'نصوص إعلانية متخصصة تخاطب مشتري التقنية',
        'حملات لينكدإن وميتا تعمل بتناغم',
        'بيانات عملاء جاهزة لنظام CRM من اليوم الأول',
      ],
    },
  },
  {
    slug: 'landscaping-agriculture',
    code: 'GROW',
    en: {
      name: 'Landscaping & Agriculture',
      short: 'Premium outdoor project leads on repeat',
      audience: 'homeowners',
      metaTitle: 'Landscaping & Agriculture Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and Meta Ads for landscaping and agriculture businesses in Dubai. Keep your crew fully booked year-round with qualified homeowner leads.',
      kicker: 'Landscaping & Agriculture Marketing · Dubai & UAE',
      title: 'Keep your crew <em>fully booked</em> year-round',
      sub: 'Stop chasing seasonal slowdowns. We build the lead pipeline that keeps your landscaping business busy every single month.',
      quote:
        'The lead centre they built for us completely changed how we handle inquiries. We went from chasing up cold contacts to having homeowners come to us ready to talk.',
      author: 'Landscaping Client',
      role: 'Landscaping Business · Dubai',
      result: '100+ qualified homeowner leads per month, consistent year-round',
      niches: [
        'Residential landscaping companies',
        'Soft & hard landscaping contractors',
        'Garden design & maintenance',
        'Irrigation & drainage specialists',
        'Turf & grass suppliers',
        'Tree surgery & pruning',
        'Outdoor lighting companies',
        'Swimming pool landscaping',
        'Rooftop & vertical gardens',
        'Agricultural consulting',
        'Farm management services',
        'Hydroponics & controlled growing',
      ],
      mistakes: [
        {
          t: 'Seasonal mindset, not a system',
          d: 'Waiting for the busy season to ramp up ads means you’re always reacting. A year-round pipeline strategy smooths out the peaks and troughs.',
        },
        {
          t: 'Photos that don’t convert',
          d: 'Beautiful garden shots don’t sell by themselves. You need copy and creative that speaks to the homeowner’s desire, not just their eye.',
        },
        {
          t: 'No follow-up on enquiries',
          d: 'Landscaping leads often require multiple touches. Without a structured follow-up sequence, you lose half your leads before they ever book.',
        },
      ],
      expect: [
        'Consistent monthly enquiries from local homeowners',
        'Ad campaigns tailored to UAE climate and outdoor trends',
        'Pre-qualified leads ready for site visits',
        'Clear ROI tracking from first click to signed job',
      ],
    },
    ar: {
      name: 'تنسيق الحدائق والزراعة',
      short: 'طلبات متكررة لمشاريع خارجية فاخرة',
      audience: 'أصحاب المنازل',
      metaTitle: 'وكالة تسويق لشركات تنسيق الحدائق والزراعة · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وإعلانات ميتا لشركات تنسيق الحدائق والزراعة في دبي. أبقِ فريقك محجوزاً طوال العام بطلبات مؤهَّلة.',
      kicker: 'تسويق تنسيق الحدائق والزراعة · دبي والإمارات',
      title: 'أبقِ فريقك <em>محجوزاً بالكامل</em> طوال العام',
      sub: 'توقّف عن مطاردة المواسم الهادئة. نبني لك قناة طلبات تُبقي أعمالك مشغولة كل شهر.',
      quote:
        'مركز العملاء الذي بنوه لنا غيّر طريقة تعاملنا مع الاستفسارات بالكامل. انتقلنا من ملاحقة جهات اتصال باردة إلى أصحاب منازل يأتون إلينا وهم جاهزون للحديث.',
      author: 'عميل في تنسيق الحدائق',
      role: 'شركة تنسيق حدائق · دبي',
      result: 'أكثر من 100 طلب مؤهَّل شهرياً من أصحاب المنازل، طوال العام',
      niches: [
        'شركات تنسيق الحدائق السكنية',
        'مقاولو التنسيق النباتي والإنشائي',
        'تصميم الحدائق وصيانتها',
        'متخصصو الري والتصريف',
        'مورّدو العشب والنجيل',
        'تقليم الأشجار ورعايتها',
        'شركات الإضاءة الخارجية',
        'تنسيق محيط المسابح',
        'حدائق الأسطح والحدائق العمودية',
        'الاستشارات الزراعية',
        'خدمات إدارة المزارع',
        'الزراعة المائية والزراعة المحمية',
      ],
      mistakes: [
        {
          t: 'عقلية موسمية بدلاً من نظام',
          d: 'انتظار موسم الذروة لزيادة الإعلانات يعني أنك دائماً في موقع ردّ الفعل. استراتيجية على مدار العام توازن الصعود والهبوط.',
        },
        {
          t: 'صور لا تحقق التحويل',
          d: 'صور الحدائق الجميلة لا تبيع وحدها. تحتاج نصوصاً وتصاميم تخاطب رغبة صاحب المنزل، لا عينه فقط.',
        },
        {
          t: 'غياب متابعة الاستفسارات',
          d: 'عملاء تنسيق الحدائق يحتاجون غالباً عدة نقاط تواصل. دون متابعة منظّمة، تخسر نصف طلباتك قبل أن يحجزوا.',
        },
      ],
      expect: [
        'استفسارات شهرية منتظمة من أصحاب المنازل المحليين',
        'حملات مصمّمة لمناخ الإمارات واتجاهات المساحات الخارجية',
        'عملاء مؤهَّلون جاهزون لزيارة الموقع',
        'تتبّع واضح للعائد من أول نقرة حتى توقيع العقد',
      ],
    },
  },
  {
    slug: 'permanent-makeup-aesthetics',
    code: 'GLOW',
    en: {
      name: 'Permanent Makeup & Aesthetics',
      short: 'Fully booked appointment calendars',
      audience: 'clients',
      metaTitle: 'Permanent Makeup & Aesthetics Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and Meta Ads for permanent makeup studios and aesthetics clinics in Dubai. Fill your appointment book with premium clients.',
      kicker: 'Permanent Makeup & Aesthetics Marketing · Dubai & UAE',
      title: 'Fill your appointment book with <em>premium</em> clients',
      sub: 'Stop relying on Instagram DMs and walk-ins. We build a paid acquisition system that brings high-value aesthetics clients directly to your chair.',
      quote:
        'I used to spend hours on Instagram hoping someone would book. Now I have a consistent flow of clients coming in who are already sold on the treatment before they arrive.',
      author: 'Aesthetics Client',
      role: 'Permanent Makeup Studio · Dubai',
      result: 'Appointment book consistently full within 6 weeks of launch',
      niches: [
        'Permanent makeup artists',
        'Microblading & brow studios',
        'Lip blush specialists',
        'Aesthetic skin clinics',
        'Non-surgical aesthetics',
        'Laser hair removal studios',
        'Anti-ageing treatment centres',
        'IV drip & wellness lounges',
        'Semi-permanent tattoo artists',
        'Lash extension & brow bars',
        'Botox & filler clinics',
        'Medical aesthetics practitioners',
      ],
      mistakes: [
        {
          t: 'Only relying on organic content',
          d: 'Instagram posts reach a fraction of your followers. Without paid promotion, you’re invisible to the thousands of potential clients searching for your service right now.',
        },
        {
          t: 'Attracting bargain hunters',
          d: 'Poorly targeted ads bring in price-sensitive clients who ghost at the first mention of cost. You need campaigns that pre-qualify on budget and intent.',
        },
        {
          t: 'No booking funnel',
          d: 'Sending traffic to your Instagram bio or a generic website loses the lead. You need a fast, frictionless path from ad to booked appointment.',
        },
      ],
      expect: [
        'Premium clients who value your work and pay full price',
        'Ad creatives designed for aesthetics and beauty audiences',
        'A booking funnel that converts clicks into confirmed appointments',
        'Retargeting that keeps past enquiries warm',
      ],
    },
    ar: {
      name: 'المكياج الدائم والتجميل',
      short: 'جداول مواعيد محجوزة بالكامل',
      audience: 'العملاء',
      metaTitle: 'وكالة تسويق للمكياج الدائم والتجميل · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وإعلانات ميتا لاستوديوهات المكياج الدائم وعيادات التجميل في دبي. املأ جدول مواعيدك بعملاء مميزين.',
      kicker: 'تسويق المكياج الدائم والتجميل · دبي والإمارات',
      title: 'املأ جدول مواعيدك بعملاء <em>مميزين</em>',
      sub: 'توقّف عن الاعتماد على رسائل إنستغرام والزيارات العابرة. نبني لك نظام استقطاب مدفوع يجلب عملاء التجميل ذوي القيمة العالية مباشرة إليك.',
      quote:
        'كنت أقضي ساعات على إنستغرام على أمل أن يحجز أحدهم. الآن لدي تدفّق ثابت من العملاء المقتنعين بالعلاج قبل أن يصلوا.',
      author: 'عميلة في قطاع التجميل',
      role: 'استوديو مكياج دائم · دبي',
      result: 'جدول مواعيد ممتلئ باستمرار خلال 6 أسابيع من الإطلاق',
      niches: [
        'خبيرات المكياج الدائم',
        'استوديوهات المايكروبليدنغ والحواجب',
        'متخصصات تلوين الشفاه',
        'عيادات العناية بالبشرة',
        'التجميل غير الجراحي',
        'استوديوهات إزالة الشعر بالليزر',
        'مراكز علاجات مكافحة الشيخوخة',
        'صالات المحاليل الوريدية والعافية',
        'فنانو الوشم شبه الدائم',
        'صالونات الرموش والحواجب',
        'عيادات البوتوكس والفيلر',
        'ممارسو التجميل الطبي',
      ],
      mistakes: [
        {
          t: 'الاعتماد على المحتوى المجاني فقط',
          d: 'منشورات إنستغرام تصل إلى جزء صغير من متابعيك. دون ترويج مدفوع، أنت غير مرئي لآلاف العملاء الذين يبحثون عن خدمتك الآن.',
        },
        {
          t: 'جذب الباحثين عن الأرخص',
          d: 'الإعلانات ضعيفة الاستهداف تجلب عملاء حساسين للسعر يختفون عند أول ذكر للتكلفة. تحتاج حملات تؤهّل العملاء حسب الميزانية والنية.',
        },
        {
          t: 'غياب مسار الحجز',
          d: 'توجيه الزوار إلى حسابك على إنستغرام أو موقع عام يضيّع العميل. تحتاج مساراً سريعاً وسلساً من الإعلان إلى الموعد المؤكَّد.',
        },
      ],
      expect: [
        'عملاء مميزون يقدّرون عملك ويدفعون السعر الكامل',
        'إعلانات مصمّمة لجمهور التجميل والعناية',
        'مسار حجز يحوّل النقرات إلى مواعيد مؤكَّدة',
        'إعادة استهداف تُبقي الاستفسارات السابقة دافئة',
      ],
    },
  },
  {
    slug: 'healthcare-clinics',
    code: 'CARE',
    en: {
      name: 'Healthcare & Clinics',
      short: 'Qualified patient bookings, not window shoppers',
      audience: 'patients',
      metaTitle: 'Healthcare & Clinics Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and compliant paid campaigns for clinics and healthcare providers in Dubai. Attract the right patients with trust-led marketing.',
      kicker: 'Healthcare & Clinics Marketing · Dubai & UAE',
      title: 'Grow your <em>patient base</em> with confidence',
      sub: 'Attract the right patients to your clinic with compliant, trust-led campaigns, without chasing reviews or relying on referrals.',
      quote:
        'We were nervous about paid advertising after hearing horror stories. RizcoReach made the whole process straightforward, compliant, and genuinely effective.',
      author: 'Healthcare Client',
      role: 'Private Clinic · Dubai',
      result: 'New patient bookings increased within the first month',
      niches: [
        'Private GP & family clinics',
        'Dental & orthodontics practices',
        'Physiotherapy clinics',
        'Dermatology & skin clinics',
        'Optical & vision centres',
        'Specialist medical clinics',
        'Diagnostic & imaging centres',
        'Mental health & wellness practices',
        'Fertility & IVF clinics',
        'Chiropractic & osteopathy',
        'Nutrition & dietetics clinics',
        'Paediatric healthcare providers',
      ],
      mistakes: [
        {
          t: 'Generic health messaging that builds no trust',
          d: 'Patients choose a healthcare provider based on trust and expertise. Bland, generic ads don’t differentiate you from the clinic down the road.',
        },
        {
          t: 'Targeting the wrong demographic',
          d: 'Wasted ad spend on audiences who aren’t your patient profile. Precise demographic and location targeting is essential in healthcare.',
        },
        {
          t: 'No social proof in the funnel',
          d: 'Healthcare is high-trust. Without testimonials, credentials and proof front-and-centre, conversion rates suffer.',
        },
      ],
      expect: [
        'Compliant campaigns that meet UAE healthcare regulations',
        'Patient acquisition from high-intent local audiences',
        'Trust-led creative that builds authority and credibility',
        'Transparent reporting on cost-per-appointment and ROI',
      ],
    },
    ar: {
      name: 'الرعاية الصحية والعيادات',
      short: 'حجوزات مرضى مؤهَّلين، لا متصفّحين عابرين',
      audience: 'المرضى',
      metaTitle: 'وكالة تسويق للرعاية الصحية والعيادات · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وحملات مدفوعة متوافقة مع الأنظمة للعيادات ومقدّمي الرعاية الصحية في دبي. استقطب المرضى المناسبين بتسويق قائم على الثقة.',
      kicker: 'تسويق الرعاية الصحية والعيادات · دبي والإمارات',
      title: 'نمِّ <em>قاعدة مرضاك</em> بثقة',
      sub: 'استقطب المرضى المناسبين إلى عيادتك عبر حملات متوافقة مع الأنظمة وقائمة على الثقة، دون ملاحقة التقييمات أو الاعتماد على التوصيات.',
      quote:
        'كنا متخوّفين من الإعلانات المدفوعة بعد ما سمعناه من تجارب سيئة. جعلت RizcoReach العملية واضحة ومتوافقة مع الأنظمة وفعّالة حقاً.',
      author: 'عميل في قطاع الرعاية الصحية',
      role: 'عيادة خاصة · دبي',
      result: 'ارتفاع حجوزات المرضى الجدد خلال الشهر الأول',
      niches: [
        'عيادات الطب العام والأسرة',
        'عيادات الأسنان وتقويمها',
        'عيادات العلاج الطبيعي',
        'عيادات الجلدية والبشرة',
        'مراكز البصريات والنظر',
        'العيادات التخصصية',
        'مراكز التشخيص والأشعة',
        'عيادات الصحة النفسية والعافية',
        'عيادات الخصوبة وأطفال الأنابيب',
        'العلاج اليدوي وتقويم العظام',
        'عيادات التغذية والحميات',
        'مقدّمو رعاية الأطفال',
      ],
      mistakes: [
        {
          t: 'رسائل صحية عامة لا تبني الثقة',
          d: 'يختار المرضى مقدّم الرعاية بناءً على الثقة والخبرة. الإعلانات العامة الباهتة لا تميّزك عن العيادة المجاورة.',
        },
        {
          t: 'استهداف الفئة الخطأ',
          d: 'ميزانية مهدرة على جمهور لا يطابق ملف مرضاك. الاستهداف الدقيق حسب الفئة والموقع أساسي في الرعاية الصحية.',
        },
        {
          t: 'غياب الدليل الاجتماعي',
          d: 'الرعاية الصحية قطاع يقوم على الثقة. دون شهادات واعتمادات وأدلة واضحة، تنخفض معدلات التحويل.',
        },
      ],
      expect: [
        'حملات متوافقة مع أنظمة الرعاية الصحية في الإمارات',
        'استقطاب مرضى من جمهور محلي عالي النية',
        'محتوى إبداعي يبني السلطة والمصداقية',
        'تقارير شفافة عن تكلفة الموعد والعائد',
      ],
    },
  },
  {
    slug: 'corporate-services-accounting',
    code: 'CORP',
    en: {
      name: 'Corporate Services & Accounting',
      short: 'High-value corporate client acquisition',
      audience: 'business owners',
      metaTitle: 'Corporate Services & Accounting Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and paid campaigns for accounting, business setup and corporate services firms in Dubai. Win more retainer clients every month.',
      kicker: 'Corporate Services & Accounting Marketing · Dubai & UAE',
      title: 'Win more <em>retainer clients</em> for your firm',
      sub: 'Stop depending on word-of-mouth to grow your accounting or corporate services firm. We build the lead engine that brings you qualified business owners every month.',
      quote:
        'We had been relying on referrals for years. RizcoReach built us a proper acquisition funnel and now we have a genuine pipeline of new business every single month.',
      author: 'Corporate Services Client',
      role: 'Accounting Firm · Dubai',
      result: 'Consistent new retainer client pipeline built within 45 days',
      niches: [
        'Accounting & bookkeeping firms',
        'Audit & assurance practices',
        'Tax consultants',
        'Business setup & company formation',
        'PRO services & government liaison',
        'VAT & compliance consultants',
        'CFO advisory services',
        'Payroll management companies',
        'Corporate secretarial services',
        'Business consulting firms',
        'Mergers & acquisition advisors',
        'Financial planning practices',
      ],
      mistakes: [
        {
          t: 'Relying entirely on referrals',
          d: 'Referral-dependent firms hit a growth ceiling. Without active acquisition, you’re at the mercy of your existing clients’ networks.',
        },
        {
          t: 'Messaging that sounds like everyone else',
          d: 'Every firm says “reliable, professional, experienced.” You need positioning that cuts through and gives business owners a real reason to choose you.',
        },
        {
          t: 'Targeting founders who aren’t ready to buy',
          d: 'Broad campaigns waste budget. We build audiences based on business stage, company size and intent signals so you speak to decision-makers who need you now.',
        },
      ],
      expect: [
        'Qualified SME and startup founders in your CRM each month',
        'Messaging that reflects your firm’s positioning and niche',
        'Campaigns targeting business owners at the right stage of growth',
        'Cost-per-lead reporting with full transparency',
      ],
    },
    ar: {
      name: 'خدمات الشركات والمحاسبة',
      short: 'استقطاب عملاء شركات ذوي قيمة عالية',
      audience: 'أصحاب الأعمال',
      metaTitle: 'وكالة تسويق لخدمات الشركات والمحاسبة · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وحملات مدفوعة لشركات المحاسبة وتأسيس الأعمال وخدمات الشركات في دبي. اكسب مزيداً من عملاء العقود الشهرية.',
      kicker: 'تسويق خدمات الشركات والمحاسبة · دبي والإمارات',
      title: 'اكسب مزيداً من <em>عملاء العقود الدائمة</em>',
      sub: 'توقّف عن الاعتماد على التوصيات لتنمية شركتك. نبني لك محرّك عملاء يجلب أصحاب أعمال مؤهَّلين كل شهر.',
      quote:
        'اعتمدنا على التوصيات لسنوات. بنت لنا RizcoReach مساراً حقيقياً للاستقطاب، والآن لدينا تدفّق فعلي من الأعمال الجديدة كل شهر.',
      author: 'عميل في خدمات الشركات',
      role: 'شركة محاسبة · دبي',
      result: 'قناة ثابتة لعملاء العقود الجدد خلال 45 يوماً',
      niches: [
        'شركات المحاسبة ومسك الدفاتر',
        'مكاتب التدقيق والمراجعة',
        'مستشارو الضرائب',
        'تأسيس الأعمال والشركات',
        'خدمات المندوب والتعقيب الحكومي',
        'مستشارو ضريبة القيمة المضافة والامتثال',
        'خدمات المدير المالي الاستشارية',
        'شركات إدارة الرواتب',
        'خدمات سكرتارية الشركات',
        'شركات الاستشارات الإدارية',
        'مستشارو الاندماج والاستحواذ',
        'مكاتب التخطيط المالي',
      ],
      mistakes: [
        {
          t: 'الاعتماد الكامل على التوصيات',
          d: 'الشركات المعتمدة على التوصيات تصطدم بسقف للنمو. دون استقطاب فعّال، تبقى رهينة لشبكات عملائك الحاليين.',
        },
        {
          t: 'رسائل تشبه الجميع',
          d: 'كل شركة تقول "موثوقون، محترفون، ذوو خبرة". تحتاج تموضعاً يميّزك ويمنح أصحاب الأعمال سبباً حقيقياً لاختيارك.',
        },
        {
          t: 'استهداف مؤسسين غير جاهزين',
          d: 'الحملات الواسعة تهدر الميزانية. نبني الجمهور حسب مرحلة العمل وحجم الشركة وإشارات النية لتخاطب صنّاع القرار الذين يحتاجونك الآن.',
        },
      ],
      expect: [
        'مؤسسو شركات ناشئة وصغيرة مؤهَّلون في نظامك كل شهر',
        'رسائل تعكس تموضع شركتك وتخصصها',
        'حملات تستهدف أصحاب الأعمال في المرحلة المناسبة',
        'تقارير تكلفة العميل بشفافية كاملة',
      ],
    },
  },
  {
    slug: 'fitness-sports-pilates',
    code: 'FIT',
    en: {
      name: 'Fitness, Sports & Pilates',
      short: 'Membership and class bookings that stick',
      audience: 'members',
      metaTitle: 'Fitness, Sports & Pilates Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and Meta Ads for pilates studios, gyms and sports academies in Dubai. Pack your classes with members who stay and pay.',
      kicker: 'Fitness, Sports & Pilates Marketing · Dubai & UAE',
      title: 'Pack your <em>classes</em> and memberships',
      sub: 'Stop relying on free trials and Instagram growth hacks. We build acquisition systems that fill your studio with clients who stay and pay.',
      quote:
        'We used to run promotions and hope for the best. Now we have a system that brings in qualified leads who are already excited about what we do before they even visit.',
      author: 'Fitness Studio Client',
      role: 'Pilates Studio · Dubai',
      result: 'Consistent new member bookings month-on-month',
      niches: [
        'Pilates & reformer studios',
        'Personal training studios',
        'Yoga & meditation centres',
        'CrossFit & functional fitness gyms',
        'Boxing & martial arts gyms',
        'Group fitness studios',
        'Sports performance centres',
        'Swimming academies',
        'Sports injury rehab clinics',
        'Kids & youth sports academies',
        'Outdoor fitness & bootcamps',
        'Nutrition & fitness coaching',
      ],
      mistakes: [
        {
          t: 'Over-relying on “free trial” offers',
          d: 'Free offers attract the wrong crowd. People who join for free rarely convert to paid members. You need creative that pre-sells the value before they walk in.',
        },
        {
          t: 'Seasonal spikes with no strategy',
          d: 'New Year surges and summer slowdowns don’t have to define your business. A consistent acquisition engine smooths out the calendar.',
        },
        {
          t: 'Not retargeting warm leads',
          d: 'Most people who click your ad won’t book on the first visit. Without a retargeting strategy, you lose most of your potential clients to inaction.',
        },
      ],
      expect: [
        'A steady stream of new member enquiries every week',
        'Creative that positions your studio as premium, not promotional',
        'Campaigns designed for your specific format and location',
        'Retargeting that converts hesitant leads into committed members',
      ],
    },
    ar: {
      name: 'اللياقة والرياضة والبيلاتس',
      short: 'اشتراكات وحجوزات حصص تدوم',
      audience: 'المشتركين',
      metaTitle: 'وكالة تسويق للياقة والرياضة والبيلاتس · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وإعلانات ميتا لاستوديوهات البيلاتس والصالات الرياضية والأكاديميات في دبي. املأ حصصك بمشتركين يلتزمون ويدفعون.',
      kicker: 'تسويق اللياقة والرياضة والبيلاتس · دبي والإمارات',
      title: 'املأ <em>حصصك</em> واشتراكاتك',
      sub: 'توقّف عن الاعتماد على التجارب المجانية وحيل النمو على إنستغرام. نبني أنظمة استقطاب تملأ الاستوديو بعملاء يلتزمون ويدفعون.',
      quote:
        'كنا نطلق العروض ونأمل الأفضل. الآن لدينا نظام يجلب عملاء مؤهَّلين متحمّسين لما نقدّمه قبل أن يزورونا.',
      author: 'عميل في استوديو لياقة',
      role: 'استوديو بيلاتس · دبي',
      result: 'حجوزات مشتركين جدد ثابتة شهراً بعد شهر',
      niches: [
        'استوديوهات البيلاتس والريفورمر',
        'استوديوهات التدريب الشخصي',
        'مراكز اليوغا والتأمل',
        'صالات كروس فت واللياقة الوظيفية',
        'صالات الملاكمة والفنون القتالية',
        'استوديوهات اللياقة الجماعية',
        'مراكز الأداء الرياضي',
        'أكاديميات السباحة',
        'عيادات تأهيل الإصابات الرياضية',
        'أكاديميات رياضة الأطفال والناشئين',
        'اللياقة الخارجية والمعسكرات',
        'تدريب التغذية واللياقة',
      ],
      mistakes: [
        {
          t: 'الإفراط في عروض التجربة المجانية',
          d: 'العروض المجانية تجذب الجمهور الخطأ، ونادراً ما يتحوّل المشتركون المجانيون إلى مدفوعين. تحتاج محتوى يبيع القيمة قبل أن يدخلوا.',
        },
        {
          t: 'مواسم ذروة بلا استراتيجية',
          d: 'ذروة بداية العام وهدوء الصيف لا يجب أن تحدد مسار عملك. محرّك استقطاب ثابت يوازن التقويم.',
        },
        {
          t: 'عدم إعادة استهداف المهتمين',
          d: 'معظم من ينقرون إعلانك لن يحجزوا من الزيارة الأولى. دون إعادة استهداف، تخسر معظم عملائك المحتملين.',
        },
      ],
      expect: [
        'تدفّق مستمر من استفسارات المشتركين الجدد كل أسبوع',
        'محتوى يضع الاستوديو في مكانة فاخرة لا ترويجية',
        'حملات مصمّمة لنوع نشاطك وموقعك',
        'إعادة استهداف تحوّل المترددين إلى مشتركين ملتزمين',
      ],
    },
  },
  {
    slug: 'professional-b2b-services',
    code: 'PRO',
    en: {
      name: 'Professional & B2B Services',
      short: 'Decision-maker leads, not gatekeeper calls',
      audience: 'decision-makers',
      metaTitle: 'Professional & B2B Services Marketing Agency · Dubai, UAE | RizcoReach',
      metaDescription:
        'Websites, SEO and paid campaigns for law firms, consultancies and B2B service firms in Dubai. Turn your expertise into a predictable pipeline.',
      kicker: 'Professional & B2B Services Marketing · Dubai & UAE',
      title: 'Turn your expertise into a <em>predictable</em> pipeline',
      sub: 'Stop waiting for referrals and word-of-mouth. We build B2B acquisition systems that put your firm in front of the right decision-makers every day.',
      quote:
        'As a professional services firm we were sceptical about paid ads. RizcoReach understood our market, built the right message, and delivered clients we actually wanted to work with.',
      author: 'Professional Services Client',
      role: 'B2B Services Firm · Dubai',
      result: 'Qualified B2B client enquiries within the first 30 days',
      niches: [
        'Legal & law firms',
        'HR & recruitment agencies',
        'PR & communications agencies',
        'Management consultancies',
        'Training & coaching companies',
        'Event management firms',
        'Translation & interpretation',
        'Research & market intelligence',
        'Brand strategy consultancies',
        'Photography & video production',
        'Architecture & interior design firms',
        'Engineering consultancies',
      ],
      mistakes: [
        {
          t: 'Invisible to your ideal clients',
          d: 'If your firm isn’t visible where buyers look, you’re invisible to the business owners and executives actively searching for your service today.',
        },
        {
          t: 'Pitching too early, too hard',
          d: 'B2B service buyers need to trust you before they engage. Heavy-sell ads repel the very clients you want. Authority-first creative converts far better.',
        },
        {
          t: 'No nurture after the first touch',
          d: 'B2B decisions take time. Without a retargeting and follow-up strategy, you lose warm leads to competitors who stay in front of them.',
        },
      ],
      expect: [
        'Regular enquiries from the right type of business client',
        'Authority-positioning creative that builds trust before the first call',
        'Multi-channel campaigns across LinkedIn and Meta',
        'Qualified lead data in your CRM from day one',
      ],
    },
    ar: {
      name: 'الخدمات المهنية وخدمات الشركات',
      short: 'عملاء من صنّاع القرار، لا من حرّاس البوابات',
      audience: 'صنّاع القرار',
      metaTitle: 'وكالة تسويق للخدمات المهنية وخدمات الشركات · دبي، الإمارات | RizcoReach',
      metaDescription:
        'مواقع إلكترونية وتحسين محركات البحث وحملات مدفوعة لمكاتب المحاماة والاستشارات وشركات الخدمات في دبي. حوّل خبرتك إلى قناة عملاء يمكن التنبؤ بها.',
      kicker: 'تسويق الخدمات المهنية وخدمات الشركات · دبي والإمارات',
      title: 'حوّل خبرتك إلى قناة عملاء <em>يمكن التنبؤ بها</em>',
      sub: 'توقّف عن انتظار التوصيات. نبني أنظمة استقطاب تضع شركتك أمام صنّاع القرار المناسبين كل يوم.',
      quote:
        'كشركة خدمات مهنية كنا متشككين في الإعلانات المدفوعة. فهمت RizcoReach سوقنا، وصاغت الرسالة الصحيحة، وجلبت لنا عملاء أردنا العمل معهم فعلاً.',
      author: 'عميل في الخدمات المهنية',
      role: 'شركة خدمات أعمال · دبي',
      result: 'استفسارات مؤهَّلة من الشركات خلال أول 30 يوماً',
      niches: [
        'مكاتب المحاماة والاستشارات القانونية',
        'وكالات الموارد البشرية والتوظيف',
        'وكالات العلاقات العامة والاتصال',
        'شركات الاستشارات الإدارية',
        'شركات التدريب والكوتشينغ',
        'شركات إدارة الفعاليات',
        'الترجمة التحريرية والفورية',
        'الأبحاث ودراسات السوق',
        'استشارات استراتيجية العلامة التجارية',
        'إنتاج الصور والفيديو',
        'مكاتب العمارة والتصميم الداخلي',
        'الاستشارات الهندسية',
      ],
      mistakes: [
        {
          t: 'غير مرئي لعملائك المثاليين',
          d: 'إن لم تكن شركتك ظاهرة حيث يبحث المشترون، فأنت غير مرئي لأصحاب الأعمال والتنفيذيين الذين يبحثون عن خدمتك اليوم.',
        },
        {
          t: 'عرض مبكر جداً وبإلحاح زائد',
          d: 'مشترو خدمات الشركات يحتاجون للثقة قبل التفاعل. الإعلانات البيعية المُلحّة تنفّر العملاء الذين تريدهم، والمحتوى القائم على الخبرة يحقق تحويلاً أفضل بكثير.',
        },
        {
          t: 'غياب المتابعة بعد أول تواصل',
          d: 'قرارات الشركات تستغرق وقتاً. دون إعادة استهداف ومتابعة، تخسر العملاء المهتمين لمنافسين يبقون أمامهم.',
        },
      ],
      expect: [
        'استفسارات منتظمة من النوع الصحيح من عملاء الشركات',
        'محتوى يرسّخ مكانتك ويبني الثقة قبل أول مكالمة',
        'حملات متعددة القنوات عبر لينكدإن وميتا',
        'بيانات عملاء مؤهَّلين في نظامك من اليوم الأول',
      ],
    },
  },
];

export const industryBySlug = (slug: string) => industries.find((i) => i.slug === slug);
