export interface ServiceContent {
  metaTitle: string;
  metaDescription: string;
  kicker: string;
  title: string;
  sub: string;
  primary: string;
  secondary: string;
  intro: { label: string; text: string };
  included: { label: string; title: string; sub: string; items: { icon: string; t: string; d: string }[] };
  process: { label: string; title: string; steps: { t: string; d: string }[] };
  why: { label: string; title: string; items: { k: string; t: string; d: string }[] };
  tool: { label: string; title: string; d: string; cta: string };
  faq: { label: string; title: string; items: { q: string; a: string }[] };
}

export interface Service {
  slug: string;
  key: 'web' | 'seo' | 'ads';
  param: string;
  tool: string;
  en: ServiceContent;
  ar: ServiceContent;
}

export const services: Service[] = [
  {
    slug: 'website-development',
    key: 'web',
    param: 'website-development',
    tool: '/tools/website-estimator',
    en: {
      metaTitle: 'Website Development Company in Dubai | Custom Websites | RizcoReach',
      metaDescription:
        'Custom, mobile-first websites for Dubai and UAE businesses. Designed to impress, engineered to load fast, built to rank on Google and turn visitors into enquiries.',
      kicker: 'Website Development · Dubai & UAE',
      title: 'Websites that <em>work</em> as hard as you do.',
      sub: 'Custom-designed, mobile-first and engineered for speed. Every site we build is structured to rank on Google and built to turn visitors into enquiries, not just to look good.',
      primary: 'Start your website project',
      secondary: 'Estimate your project',
      intro: {
        label: 'The approach',
        text: 'Your website is the first impression, the sales pitch and the closing argument, often before you have spoken to a customer. We design it like your best salesperson: clear, credible, fast, and always one tap away from a conversation.',
      },
      included: {
        label: 'What’s included',
        title: 'Everything a website needs<br/><em>to earn its keep.</em>',
        sub: 'No templates and no shortcuts. Each build is planned around your customers, your market and the searches that bring in business.',
        items: [
          { icon: 'pen', t: 'Custom UI & UX design', d: 'A design system built for your brand, never a recycled template. Every page has a job and a clear next step.' },
          { icon: 'phoneDevice', t: 'Mobile-first development', d: 'Most of your visitors are on a phone. We design and build for the small screen first, then scale up beautifully.' },
          { icon: 'zap', t: 'Speed & Core Web Vitals', d: 'Optimised images, lean code and modern hosting so pages load fast, keep visitors around and help you rank.' },
          { icon: 'search', t: 'SEO foundations built in', d: 'Clean structure, metadata, schema and local SEO from day one, so you are not paying to fix it after launch.' },
          { icon: 'target', t: 'Conversion architecture', d: 'WhatsApp, call and enquiry forms placed exactly where people are ready to act, backed by proof that builds trust.' },
          { icon: 'globe', t: 'English & Arabic', d: 'Fully bilingual builds with proper right-to-left layouts and typography, so every customer feels at home.' },
          { icon: 'layers', t: 'Integrations', d: 'Booking, CRM, analytics, WhatsApp and the tools your team already uses, connected properly.' },
          { icon: 'refresh', t: 'Redesigns & rebuilds', d: 'Already have a site? We keep what works, fix what doesn’t, and protect your existing rankings during the move.' },
        ],
      },
      process: {
        label: 'How we build',
        title: 'From first call<br/><em>to first enquiry.</em>',
        steps: [
          { t: 'Discovery', d: 'We learn your business, customers and goals, and review your current site and search visibility.' },
          { t: 'Strategy & sitemap', d: 'We map the pages, the keywords each one targets and the path from visitor to enquiry.' },
          { t: 'Design', d: 'A custom design direction for your brand. You review and give feedback before a line of code is written.' },
          { t: 'Build', d: 'Mobile-first development, performance tuning and SEO foundations, with a staging link to review as we go.' },
          { t: 'Launch & grow', d: 'We launch, connect analytics and Search Console, and keep optimising so the site keeps improving.' },
        ],
      },
      why: {
        label: 'The difference',
        title: 'Built to be found.<br/><em>Built to convert.</em>',
        items: [
          { k: 'Fast', t: 'Engineered for speed', d: 'Lean, modern builds that load quickly on any phone, because every second of waiting costs you customers.' },
          { k: 'Found', t: 'Structured for Google', d: 'Pages planned around real searches, with technical SEO handled from the first line of code.' },
          { k: 'Chosen', t: 'Designed to win trust', d: 'Premium design, real proof and an obvious next step, so visitors pick you over the next tab.' },
        ],
      },
      tool: {
        label: 'Free tool',
        title: 'Plan your website in two minutes.',
        d: 'Choose your pages and features to see the scope and typical timeline for your project, then get a tailored quote.',
        cta: 'Open the project estimator',
      },
      faq: {
        label: 'Website FAQ',
        title: 'Website questions,<br/><em>answered.</em>',
        items: [
          { q: 'How long does a website take?', a: 'It depends on scope. A focused business website moves much faster than a large site with booking, e-commerce or custom features. You will get a clear timeline with your quote, and the project estimator gives you a typical range up front.' },
          { q: 'How much does a website cost?', a: 'Every website is quoted to its scope, so we don’t publish one-size-fits-all prices. Tell us what you need and we will send a clear quote before any work begins.' },
          { q: 'Will my website be ready for SEO?', a: 'Yes. SEO is built in from day one: page structure, metadata, schema, speed and local SEO foundations are part of every build, not an add-on.' },
          { q: 'Can you redesign my existing website?', a: 'Yes. We review what is working and what isn’t, keep what earns its place, and protect your existing rankings when we move to the new site.' },
          { q: 'Can I update the website myself?', a: 'If you want to, yes. We set up editing for the content your team needs to change, and handle the rest for you.' },
        ],
      },
    },
    ar: {
      metaTitle: 'شركة تطوير مواقع إلكترونية في دبي | مواقع مخصّصة | RizcoReach',
      metaDescription:
        'مواقع إلكترونية مخصّصة للجوال أولاً للشركات في دبي والإمارات. مصمّمة لتُبهر، ومُهندَسة لتُحمَّل بسرعة، ومبنية لتتصدّر جوجل وتحوّل الزوار إلى طلبات.',
      kicker: 'تطوير المواقع الإلكترونية · دبي والإمارات',
      title: 'مواقع <em>تعمل</em> بجدّ مثلك.',
      sub: 'تصميم مخصّص، للجوال أولاً، ومُهندَس للسرعة. كل موقع نبنيه مهيّأ ليتصدّر جوجل ومبني لتحويل الزوار إلى طلبات، لا لمجرد المظهر الجميل.',
      primary: 'ابدأ مشروع موقعك',
      secondary: 'قدّر مشروعك',
      intro: {
        label: 'منهجنا',
        text: 'موقعك هو الانطباع الأول، وعرض المبيعات، والحجة الأخيرة، غالباً قبل أن تتحدث مع العميل. لذلك نصمّمه كأفضل مندوب مبيعات لديك: واضح، موثوق، سريع، وعلى بُعد لمسة من المحادثة.',
      },
      included: {
        label: 'ما يشمله',
        title: 'كل ما يحتاجه الموقع<br/><em>ليستحق قيمته.</em>',
        sub: 'بلا قوالب ولا اختصارات. كل مشروع يُخطَّط حول عملائك وسوقك وعمليات البحث التي تجلب الأعمال.',
        items: [
          { icon: 'pen', t: 'تصميم واجهات وتجربة مستخدم مخصّص', d: 'نظام تصميم مبني لعلامتك، لا قالب معاد تدويره. لكل صفحة هدف وخطوة تالية واضحة.' },
          { icon: 'phoneDevice', t: 'تطوير للجوال أولاً', d: 'معظم زوارك على الجوال. نصمّم ونبني للشاشة الصغيرة أولاً ثم نوسّع بأناقة.' },
          { icon: 'zap', t: 'السرعة ومؤشرات أداء الويب', d: 'صور محسّنة وكود خفيف واستضافة حديثة لتُحمَّل الصفحات بسرعة وتُبقي الزوار وتدعم ترتيبك.' },
          { icon: 'search', t: 'أسس السيو مدمجة', d: 'هيكل نظيف وبيانات وصفية وسكيما وسيو محلي من اليوم الأول، فلا تدفع لإصلاحها بعد الإطلاق.' },
          { icon: 'target', t: 'هندسة التحويل', d: 'واتساب والاتصال ونماذج الطلب في المكان الذي يكون فيه الزائر جاهزاً، مع أدلة تبني الثقة.' },
          { icon: 'globe', t: 'العربية والإنجليزية', d: 'مواقع ثنائية اللغة بالكامل بتخطيط صحيح من اليمين لليسار وخطوط أنيقة، ليشعر كل عميل بالألفة.' },
          { icon: 'layers', t: 'التكاملات', d: 'الحجز وأنظمة CRM والتحليلات وواتساب والأدوات التي يستخدمها فريقك، مربوطة بشكل صحيح.' },
          { icon: 'refresh', t: 'إعادة التصميم والبناء', d: 'لديك موقع بالفعل؟ نحتفظ بما ينجح، ونصلح ما لا ينجح، ونحمي ترتيبك الحالي أثناء الانتقال.' },
        ],
      },
      process: {
        label: 'كيف نبني',
        title: 'من أول مكالمة<br/><em>إلى أول طلب.</em>',
        steps: [
          { t: 'الاستكشاف', d: 'نتعرّف على عملك وعملائك وأهدافك، ونراجع موقعك الحالي وظهورك في البحث.' },
          { t: 'الاستراتيجية وخريطة الموقع', d: 'نرسم الصفحات والكلمات المفتاحية لكل صفحة والمسار من الزائر إلى الطلب.' },
          { t: 'التصميم', d: 'اتجاه تصميم مخصّص لعلامتك. تراجع وتبدي ملاحظاتك قبل كتابة أي سطر برمجي.' },
          { t: 'البناء', d: 'تطوير للجوال أولاً وضبط للأداء وأسس السيو، مع رابط تجريبي لمتابعة التقدّم.' },
          { t: 'الإطلاق والنمو', d: 'نطلق الموقع، ونربط التحليلات وSearch Console، ونواصل التحسين ليتطوّر الموقع باستمرار.' },
        ],
      },
      why: {
        label: 'الفرق',
        title: 'مبني ليظهر.<br/><em>مبني ليحوّل.</em>',
        items: [
          { k: 'السرعة', t: 'مُهندَس للسرعة', d: 'مواقع حديثة وخفيفة تُحمَّل بسرعة على أي جوال، لأن كل ثانية انتظار تكلّفك عملاء.' },
          { k: 'الظهور', t: 'مهيّأ لجوجل', d: 'صفحات مخطّطة حول عمليات بحث حقيقية، والسيو التقني محسوم من أول سطر برمجي.' },
          { k: 'الاختيار', t: 'مصمّم لكسب الثقة', d: 'تصميم فاخر وأدلة حقيقية وخطوة تالية واضحة، ليختارك الزائر بدلاً من التبويب التالي.' },
        ],
      },
      tool: {
        label: 'أداة مجانية',
        title: 'خطّط موقعك في دقيقتين.',
        d: 'اختر صفحاتك وميزاتك لترى نطاق مشروعك والجدول الزمني المعتاد، ثم احصل على عرض سعر مخصّص.',
        cta: 'افتح مُخطِّط المشروع',
      },
      faq: {
        label: 'أسئلة المواقع',
        title: 'أسئلة المواقع،<br/><em>مُجاب عنها.</em>',
        items: [
          { q: 'كم يستغرق بناء الموقع؟', a: 'يعتمد على النطاق. موقع الأعمال المركّز أسرع بكثير من موقع كبير بحجوزات أو متجر إلكتروني أو ميزات مخصّصة. ستحصل على جدول زمني واضح مع عرض السعر، ويعطيك مُخطِّط المشروع نطاقاً تقريبياً مسبقاً.' },
          { q: 'كم تكلفة الموقع؟', a: 'كل موقع يُسعَّر حسب نطاقه، لذلك لا ننشر أسعاراً موحّدة. أخبرنا باحتياجك وسنرسل لك عرض سعر واضحاً قبل بدء أي عمل.' },
          { q: 'هل سيكون موقعي جاهزاً للسيو؟', a: 'نعم. السيو مدمج من اليوم الأول: هيكل الصفحات والبيانات الوصفية والسكيما والسرعة وأسس السيو المحلي جزء من كل مشروع، لا إضافة.' },
          { q: 'هل يمكنكم إعادة تصميم موقعي الحالي؟', a: 'نعم. نراجع ما ينجح وما لا ينجح، ونحتفظ بما يستحق، ونحمي ترتيبك الحالي عند الانتقال للموقع الجديد.' },
          { q: 'هل يمكنني تحديث الموقع بنفسي؟', a: 'إن أردت، نعم. نُعدّ إمكانية التعديل للمحتوى الذي يحتاج فريقك لتغييره، ونتولّى الباقي عنك.' },
        ],
      },
    },
  },
  {
    slug: 'seo',
    key: 'seo',
    param: 'seo',
    tool: '/tools/seo-calculator',
    en: {
      metaTitle: 'SEO Agency in Dubai | Local SEO & Google Rankings | RizcoReach',
      metaDescription:
        'SEO services for Dubai and UAE businesses: technical SEO, local SEO, Google Business Profile, keyword research and content that brings in steady, high-intent enquiries.',
      kicker: 'Search Engine Optimisation · Dubai & UAE',
      title: 'Rank where your <em>customers</em> are searching.',
      sub: 'Your customers are already searching Google for what you do. We make sure they find you, not your competitors, with rankings that compound into steady, high-intent enquiries.',
      primary: 'Book an SEO call',
      secondary: 'Calculate your SEO value',
      intro: {
        label: 'Why SEO',
        text: 'Ads stop the moment you stop paying. Rankings keep working. SEO is the compounding asset behind the most predictable businesses in Dubai: every month it builds on the last, bringing in customers who are already looking for you.',
      },
      included: {
        label: 'What’s included',
        title: 'The full SEO stack,<br/><em>done properly.</em>',
        sub: 'Technical fixes, local visibility and content, planned around the searches that turn into revenue, and reported in plain language.',
        items: [
          { icon: 'code', t: 'Technical SEO', d: 'Crawlability, indexing, site speed, schema and the fixes that stop Google from ignoring your pages.' },
          { icon: 'doc', t: 'On-page optimisation', d: 'Titles, headings, copy and internal links tuned to the keywords each page should win.' },
          { icon: 'pin', t: 'Local SEO & Google Business Profile', d: 'Show up in Google Maps and the local pack when nearby customers search for what you do.' },
          { icon: 'search', t: 'Keyword research', d: 'We find the high-intent searches your customers actually use, and the ones your competitors are winning.' },
          { icon: 'pen', t: 'Content that ranks', d: 'Service pages and content built to answer real questions and rank for the terms that bring in enquiries.' },
          { icon: 'chart', t: 'Clear reporting', d: 'Rankings, traffic and enquiries reported in plain language, so you always know where you stand.' },
        ],
      },
      process: {
        label: 'How SEO works with us',
        title: 'A system that<br/><em>compounds.</em>',
        steps: [
          { t: 'Audit', d: 'A full technical and content review of your site, rankings and Google Business Profile.' },
          { t: 'Research', d: 'Keyword and competitor research to find the searches worth winning first.' },
          { t: 'Fix', d: 'Technical issues, speed and on-page structure fixed so Google can trust your site.' },
          { t: 'Build', d: 'Local SEO, service pages and content that target the terms your customers use.' },
          { t: 'Compound', d: 'Monthly reporting and optimisation. Rankings climb, traffic grows and enquiries follow.' },
        ],
      },
      why: {
        label: 'Honest SEO',
        title: 'No shortcuts.<br/><em>No smoke.</em>',
        items: [
          { k: 'Real', t: 'Realistic timelines', d: 'Quick technical wins can show in weeks; competitive keywords take months. We tell you which is which.' },
          { k: 'Local', t: 'Built for the UAE', d: 'Local SEO for Dubai and the UAE, including Google Maps and bilingual search.' },
          { k: 'Clear', t: 'Reporting you can read', d: 'Rankings, traffic and enquiries, not vanity metrics, so you see what SEO is earning you.' },
        ],
      },
      tool: {
        label: 'Free tool',
        title: 'What is page one worth to you?',
        d: 'Model the extra visitors, leads and revenue that better rankings could bring your business.',
        cta: 'Open the SEO revenue calculator',
      },
      faq: {
        label: 'SEO FAQ',
        title: 'SEO questions,<br/><em>answered.</em>',
        items: [
          { q: 'How long does SEO take to work?', a: 'SEO compounds over time. Technical fixes and Google Business Profile improvements can show movement within weeks, while competitive keywords usually take a few months of consistent work.' },
          { q: 'Can you guarantee page one?', a: 'No honest agency can, because Google controls the rankings. What we guarantee is the work: proper technical SEO, the right keywords, strong content and clear reporting on the results.' },
          { q: 'What is local SEO?', a: 'Local SEO helps you appear in Google Maps and the local results when people nearby search for your services. For most Dubai service businesses it is the fastest SEO win available.' },
          { q: 'Do I need a new website for SEO?', a: 'Not always. Sometimes your current site just needs technical and on-page fixes. If the site is holding you back, we will tell you honestly.' },
          { q: 'What do your SEO reports include?', a: 'Rankings for your target keywords, organic traffic, and the enquiries SEO brings in, with a plain-language summary of what we did and what comes next.' },
        ],
      },
    },
    ar: {
      metaTitle: 'وكالة سيو في دبي | السيو المحلي وترتيب جوجل | RizcoReach',
      metaDescription:
        'خدمات تحسين محركات البحث للشركات في دبي والإمارات: سيو تقني ومحلي، وملف جوجل التجاري، وبحث الكلمات المفتاحية، ومحتوى يجلب طلبات ثابتة عالية النية.',
      kicker: 'تحسين محركات البحث · دبي والإمارات',
      title: 'تصدّر حيث يبحث <em>عملاؤك</em>.',
      sub: 'عملاؤك يبحثون على جوجل عمّا تقدّمه الآن. نتأكد أنهم يجدونك أنت لا منافسيك، بترتيب يتراكم ليصبح تدفّقاً ثابتاً من الطلبات عالية النية.',
      primary: 'احجز مكالمة سيو',
      secondary: 'احسب قيمة السيو',
      intro: {
        label: 'لماذا السيو',
        text: 'الإعلانات تتوقف عندما تتوقف عن الدفع، أما الترتيب فيستمر في العمل. السيو هو الأصل المتراكم وراء أكثر الأعمال استقراراً في دبي: كل شهر يبني على ما قبله، ويجلب عملاء يبحثون عنك بالفعل.',
      },
      included: {
        label: 'ما يشمله',
        title: 'منظومة السيو كاملة،<br/><em>بإتقان.</em>',
        sub: 'إصلاحات تقنية وظهور محلي ومحتوى، مخطّطة حول عمليات البحث التي تتحوّل إلى إيرادات، مع تقارير بلغة واضحة.',
        items: [
          { icon: 'code', t: 'السيو التقني', d: 'قابلية الزحف والفهرسة وسرعة الموقع والسكيما، والإصلاحات التي تمنع جوجل من تجاهل صفحاتك.' },
          { icon: 'doc', t: 'تحسين الصفحات', d: 'العناوين والنصوص والروابط الداخلية مضبوطة على الكلمات التي يجب أن تفوز بها كل صفحة.' },
          { icon: 'pin', t: 'السيو المحلي وملف جوجل التجاري', d: 'اظهر في خرائط جوجل والنتائج المحلية عندما يبحث العملاء القريبون عن خدماتك.' },
          { icon: 'search', t: 'بحث الكلمات المفتاحية', d: 'نجد عمليات البحث عالية النية التي يستخدمها عملاؤك فعلاً، وتلك التي يفوز بها منافسوك.' },
          { icon: 'pen', t: 'محتوى يتصدّر', d: 'صفحات خدمات ومحتوى يجيب عن أسئلة حقيقية ويتصدّر الكلمات التي تجلب الطلبات.' },
          { icon: 'chart', t: 'تقارير واضحة', d: 'الترتيب والزيارات والطلبات بلغة بسيطة، لتعرف موقعك دائماً.' },
        ],
      },
      process: {
        label: 'كيف نعمل في السيو',
        title: 'نظام<br/><em>يتراكم.</em>',
        steps: [
          { t: 'التدقيق', d: 'مراجعة تقنية ومحتوى شاملة لموقعك وترتيبك وملف جوجل التجاري.' },
          { t: 'البحث', d: 'بحث الكلمات والمنافسين لتحديد عمليات البحث الأجدر بالفوز أولاً.' },
          { t: 'الإصلاح', d: 'معالجة المشكلات التقنية والسرعة وهيكل الصفحات ليثق جوجل بموقعك.' },
          { t: 'البناء', d: 'سيو محلي وصفحات خدمات ومحتوى يستهدف المصطلحات التي يستخدمها عملاؤك.' },
          { t: 'التراكم', d: 'تقارير وتحسينات شهرية. يرتفع الترتيب وتزداد الزيارات وتتبعها الطلبات.' },
        ],
      },
      why: {
        label: 'سيو صادق',
        title: 'بلا اختصارات.<br/><em>بلا مبالغات.</em>',
        items: [
          { k: 'واقعي', t: 'جداول زمنية واقعية', d: 'المكاسب التقنية السريعة قد تظهر خلال أسابيع، والكلمات التنافسية تحتاج أشهراً. نخبرك بالفرق.' },
          { k: 'محلي', t: 'مبني للإمارات', d: 'سيو محلي لدبي والإمارات، يشمل خرائط جوجل والبحث باللغتين.' },
          { k: 'واضح', t: 'تقارير مفهومة', d: 'الترتيب والزيارات والطلبات، لا أرقام شكلية، لترى ما يحقّقه لك السيو.' },
        ],
      },
      tool: {
        label: 'أداة مجانية',
        title: 'كم تساوي الصفحة الأولى لك؟',
        d: 'احسب الزيارات والعملاء والإيرادات الإضافية التي قد يجلبها ترتيب أفضل لعملك.',
        cta: 'افتح حاسبة عائد السيو',
      },
      faq: {
        label: 'أسئلة السيو',
        title: 'أسئلة السيو،<br/><em>مُجاب عنها.</em>',
        items: [
          { q: 'متى تظهر نتائج السيو؟', a: 'السيو يتراكم مع الوقت. الإصلاحات التقنية وتحسين ملف جوجل التجاري قد تُظهر تقدّماً خلال أسابيع، بينما تحتاج الكلمات التنافسية عادةً بضعة أشهر من العمل المستمر.' },
          { q: 'هل تضمنون الصفحة الأولى؟', a: 'لا توجد وكالة صادقة تستطيع ذلك، لأن جوجل هو من يتحكم بالترتيب. ما نضمنه هو العمل: سيو تقني صحيح، والكلمات المناسبة، ومحتوى قوي، وتقارير واضحة بالنتائج.' },
          { q: 'ما هو السيو المحلي؟', a: 'يساعدك السيو المحلي على الظهور في خرائط جوجل والنتائج المحلية عندما يبحث القريبون عن خدماتك. وهو لمعظم شركات الخدمات في دبي أسرع مكسب متاح في السيو.' },
          { q: 'هل أحتاج موقعاً جديداً للسيو؟', a: 'ليس دائماً. أحياناً يحتاج موقعك الحالي إصلاحات تقنية وتحسينات للصفحات فقط. وإن كان الموقع يعيقك، سنخبرك بصراحة.' },
          { q: 'ماذا تتضمن تقارير السيو؟', a: 'ترتيب كلماتك المستهدفة، والزيارات العضوية، والطلبات التي يجلبها السيو، مع ملخص واضح لما أنجزناه وما هو قادم.' },
        ],
      },
    },
  },
  {
    slug: 'meta-ads',
    key: 'ads',
    param: 'meta-google-ads',
    tool: '/tools/meta-ads-calculator',
    en: {
      metaTitle: 'Meta Ads & Google Ads Agency in Dubai | Lead Generation | RizcoReach',
      metaDescription:
        'Meta (Facebook & Instagram) and Google Ads management for Dubai and UAE businesses. Lead generation campaigns, creative and lead centres that deliver qualified enquiries.',
      kicker: 'Meta & Google Ads · Dubai & UAE',
      title: 'Qualified leads. <em>This month.</em>',
      sub: 'High-converting Meta (Facebook & Instagram) and Google campaigns that deliver qualified leads, not tire-kickers. Perfect while your SEO builds, or to launch a new website with a bang.',
      primary: 'Book an ads strategy call',
      secondary: 'Forecast your leads',
      intro: {
        label: 'Why paid ads',
        text: 'SEO compounds over months. Ads work this week. We build complete acquisition systems on Meta and Google: the offer, the creative, the targeting and the lead centre that qualifies every enquiry before it reaches your team.',
      },
      included: {
        label: 'What’s included',
        title: 'A complete lead engine,<br/><em>not just ads.</em>',
        sub: 'Campaign strategy, creative, qualification and reporting, managed end to end so you only deal with the leads.',
        items: [
          { icon: 'compass', t: 'Campaign strategy', d: 'Offer, audience and campaign structure planned around your market, margins and capacity.' },
          { icon: 'image', t: 'Scroll-stopping creative', d: 'Ad creative and copy built around your niche and location, with weekly creative refreshes.' },
          { icon: 'users', t: 'Meta lead centres', d: 'Lead forms and centres that capture, qualify and deliver homeowner and business leads in real time.' },
          { icon: 'search', t: 'Google Search & Maps ads', d: 'Be the first result when high-intent customers search for exactly what you sell.' },
          { icon: 'refresh', t: 'Retargeting', d: 'Stay in front of warm visitors and past enquiries until they are ready to book.' },
          { icon: 'chart', t: 'Pipeline transparency', d: 'Weekly reporting on leads, cost per lead and what turned into revenue.' },
        ],
      },
      process: {
        label: 'How we launch',
        title: 'From strategy call<br/><em>to live campaigns.</em>',
        steps: [
          { t: 'Strategy call', d: 'We map your market, offer and the leads you actually want, and what results are realistic.' },
          { t: 'Offer & creative', d: 'We craft the angle, write the copy and produce creatives built to stop the scroll.' },
          { t: 'Launch', d: 'Campaigns, lead forms and tracking go live, with every lead delivered straight to your team.' },
          { t: 'Optimise', d: 'Weekly creative refreshes and budget shifts toward what produces qualified leads.' },
          { t: 'Scale', d: 'When the numbers work, we scale spend and expand into new audiences and channels.' },
        ],
      },
      why: {
        label: 'Why RizcoReach',
        title: 'Performance, <em>not promises.</em>',
        items: [
          { k: 'AED 5M+', t: 'UAE market expertise', d: 'We’ve invested over AED 5M in paid media across Dubai and the GCC. We know what converts in this market.' },
          { k: 'Monthly', t: 'No lock-in contracts', d: 'We work month-to-month. Our results keep you, not a contract.' },
          { k: 'Niche', t: 'Vertical specialisation', d: 'We go deep in specific industries. That focus means faster results and sharper creatives for your niche.' },
        ],
      },
      tool: {
        label: 'Free tool',
        title: 'Forecast your Meta Ads results.',
        d: 'Enter your budget and customer value to estimate leads, cost per lead, customers and return on ad spend.',
        cta: 'Open the Meta Ads calculator',
      },
      faq: {
        label: 'Ads FAQ',
        title: 'Paid ads questions,<br/><em>answered.</em>',
        items: [
          { q: 'How quickly will I see leads?', a: 'Paid campaigns can start bringing in enquiries soon after launch. The first weeks are about learning what converts; from there we optimise weekly toward qualified leads.' },
          { q: 'Meta Ads or Google Ads, which is better?', a: 'They do different jobs. Google captures people already searching for your service; Meta creates demand and works brilliantly for visual, local and high-ticket services. Many clients use both.' },
          { q: 'What ad budget do I need?', a: 'It depends on your market, your customer value and how many leads you can handle. Our Meta Ads calculator helps you model it, and we will recommend a realistic starting budget on our call.' },
          { q: 'Do you create the ads?', a: 'Yes. Strategy, copy and creative production are part of the service, with weekly creative refreshes to keep performance strong.' },
          { q: 'Are there long contracts?', a: 'No. We work month-to-month. Our results keep you, not a contract.' },
        ],
      },
    },
    ar: {
      metaTitle: 'وكالة إعلانات ميتا وجوجل في دبي | استقطاب العملاء | RizcoReach',
      metaDescription:
        'إدارة إعلانات ميتا (فيسبوك وإنستغرام) وجوجل للشركات في دبي والإمارات. حملات استقطاب عملاء وتصاميم ومراكز عملاء تجلب طلبات مؤهَّلة.',
      kicker: 'إعلانات ميتا وجوجل · دبي والإمارات',
      title: 'عملاء مؤهَّلون. <em>هذا الشهر.</em>',
      sub: 'حملات عالية التحويل على ميتا (فيسبوك وإنستغرام) وجوجل تجلب عملاء مؤهَّلين لا متصفّحين عابرين. مثالية بينما يُبنى ترتيبك في البحث، أو لإطلاق موقع جديد بقوة.',
      primary: 'احجز مكالمة استراتيجية إعلانات',
      secondary: 'توقّع عملاءك',
      intro: {
        label: 'لماذا الإعلانات المدفوعة',
        text: 'السيو يتراكم على مدى أشهر، والإعلانات تعمل هذا الأسبوع. نبني أنظمة استقطاب متكاملة على ميتا وجوجل: العرض والتصميم والاستهداف ومركز العملاء الذي يؤهّل كل طلب قبل أن يصل إلى فريقك.',
      },
      included: {
        label: 'ما يشمله',
        title: 'محرّك عملاء متكامل،<br/><em>لا مجرد إعلانات.</em>',
        sub: 'استراتيجية الحملات والتصاميم والتأهيل والتقارير، مُدارة بالكامل لتتعامل أنت مع العملاء فقط.',
        items: [
          { icon: 'compass', t: 'استراتيجية الحملات', d: 'العرض والجمهور وهيكل الحملة مخطّطة حول سوقك وهوامشك وقدرتك الاستيعابية.' },
          { icon: 'image', t: 'تصاميم تلفت الانتباه', d: 'تصاميم ونصوص إعلانية مبنية لتخصصك ومنطقتك، مع تحديث أسبوعي للتصاميم.' },
          { icon: 'users', t: 'مراكز العملاء على ميتا', d: 'نماذج ومراكز تلتقط طلبات أصحاب المنازل والشركات وتؤهّلها وتسلّمها لحظياً.' },
          { icon: 'search', t: 'إعلانات بحث وخرائط جوجل', d: 'كن النتيجة الأولى عندما يبحث العملاء عالي النية عمّا تبيعه تماماً.' },
          { icon: 'refresh', t: 'إعادة الاستهداف', d: 'ابقَ أمام الزوار المهتمين والاستفسارات السابقة حتى يصبحوا جاهزين للحجز.' },
          { icon: 'chart', t: 'شفافية مسار المبيعات', d: 'تقارير أسبوعية عن العملاء وتكلفة العميل وما تحوّل إلى إيرادات.' },
        ],
      },
      process: {
        label: 'كيف نطلق',
        title: 'من مكالمة الاستراتيجية<br/><em>إلى حملات مباشرة.</em>',
        steps: [
          { t: 'مكالمة الاستراتيجية', d: 'نرسم سوقك وعرضك والعملاء الذين تريدهم فعلاً، والنتائج الواقعية الممكنة.' },
          { t: 'العرض والتصميم', d: 'نصوغ الزاوية ونكتب النصوص وننتج تصاميم تُوقف التمرير.' },
          { t: 'الإطلاق', d: 'تنطلق الحملات والنماذج والتتبّع، ويصل كل عميل مباشرة إلى فريقك.' },
          { t: 'التحسين', d: 'تحديث أسبوعي للتصاميم وتوجيه الميزانية نحو ما يجلب عملاء مؤهَّلين.' },
          { t: 'التوسّع', d: 'عندما تنجح الأرقام، نرفع الإنفاق ونتوسّع إلى جماهير وقنوات جديدة.' },
        ],
      },
      why: {
        label: 'لماذا RizcoReach',
        title: 'أداء، <em>لا وعود.</em>',
        items: [
          { k: '+5 ملايين', t: 'خبرة في السوق الإماراتي', d: 'استثمرنا أكثر من 5 ملايين درهم في الإعلانات المدفوعة في دبي والخليج. نعرف ما الذي يحقق التحويل في هذا السوق.' },
          { k: 'شهرياً', t: 'بلا عقود ملزمة', d: 'نعمل شهراً بشهر. نتائجنا هي ما يُبقيك معنا، لا العقد.' },
          { k: 'تخصّص', t: 'التخصّص في القطاعات', d: 'نتعمّق في قطاعات محددة، وهذا التركيز يعني نتائج أسرع وتصاميم أدق لتخصصك.' },
        ],
      },
      tool: {
        label: 'أداة مجانية',
        title: 'توقّع نتائج إعلانات ميتا.',
        d: 'أدخل ميزانيتك وقيمة العميل لتقدير عدد العملاء وتكلفة العميل والعملاء الفعليين والعائد على الإنفاق الإعلاني.',
        cta: 'افتح حاسبة إعلانات ميتا',
      },
      faq: {
        label: 'أسئلة الإعلانات',
        title: 'أسئلة الإعلانات المدفوعة،<br/><em>مُجاب عنها.</em>',
        items: [
          { q: 'متى سأرى العملاء؟', a: 'يمكن أن تبدأ الحملات المدفوعة بجلب الاستفسارات بعد الإطلاق بفترة قصيرة. الأسابيع الأولى لتعلّم ما يحقق التحويل، ثم نحسّن أسبوعياً نحو العملاء المؤهَّلين.' },
          { q: 'إعلانات ميتا أم جوجل، أيهما أفضل؟', a: 'لكلٍ دوره. جوجل يلتقط من يبحث عن خدمتك بالفعل، وميتا يصنع الطلب ويتفوّق في الخدمات المرئية والمحلية وعالية القيمة. كثير من العملاء يستخدمون الاثنين.' },
          { q: 'ما الميزانية الإعلانية التي أحتاجها؟', a: 'تعتمد على سوقك وقيمة عميلك وعدد العملاء الذين تستطيع استيعابهم. تساعدك حاسبة إعلانات ميتا على تقديرها، وسنوصي بميزانية بداية واقعية في مكالمتنا.' },
          { q: 'هل تصمّمون الإعلانات؟', a: 'نعم. الاستراتيجية والنصوص وإنتاج التصاميم جزء من الخدمة، مع تحديث أسبوعي للتصاميم للحفاظ على قوة الأداء.' },
          { q: 'هل هناك عقود طويلة؟', a: 'لا. نعمل شهراً بشهر. نتائجنا هي ما يُبقيك معنا، لا العقد.' },
        ],
      },
    },
  },
];

export const serviceBySlug = (slug: string) => services.find((s) => s.slug === slug)!;
