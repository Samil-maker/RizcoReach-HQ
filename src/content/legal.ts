type Section = { h: string; p?: string[]; ul?: string[] };
type Doc = { metaTitle: string; metaDescription: string; title: string; updated: string; intro: string; sections: Section[] };

const privacyEn: Doc = {
  metaTitle: 'Privacy Policy | RizcoReach',
  metaDescription: 'How RizcoReach collects, uses and protects your personal information.',
  title: 'Privacy Policy',
  updated: 'Last updated: October 2026',
  intro:
    'RizcoReach (“we”, “us”, or “our”) operates this website and the services described within it. This Privacy Policy explains how we collect, use and protect your personal information when you use our website, our free tools or our services. We are committed to compliance with applicable UAE data protection regulations.',
  sections: [
    {
      h: '1. Information we collect',
      ul: [
        'Contact information you provide through our forms (name, email address, phone number, business details).',
        'Information about your business, website, services and marketing goals.',
        'Website addresses you submit to our free website audit tool, and the inputs you enter into our calculators when you request a detailed report.',
        'Basic technical data processed by our hosting provider to deliver and secure the website (such as IP address and browser type).',
      ],
    },
    {
      h: '2. How we use your information',
      ul: [
        'To respond to your enquiries and schedule strategy calls.',
        'To generate the audit, forecast or estimate you requested, and send you the detailed results.',
        'To deliver and manage our website development, SEO and advertising services.',
        'To send relevant follow-up communications related to your enquiry.',
        'To comply with legal obligations.',
      ],
    },
    {
      h: '3. Free tools',
      p: [
        'When you run a website audit, we fetch the public page at the address you enter to analyse it, and may use Google’s PageSpeed Insights service to measure performance. We only analyse publicly available pages.',
      ],
    },
    {
      h: '4. Third-party services',
      p: [
        'Form submissions are processed by our hosting provider, Netlify. Embedded case-study videos are provided by Wistia and only load when you press play. These providers process data on our behalf under their own data protection obligations.',
      ],
    },
    {
      h: '5. Data sharing',
      p: [
        'We do not sell, rent or trade your personal information. We only share data with trusted service providers where needed to deliver our services, and all third parties are bound by data protection obligations.',
      ],
    },
    {
      h: '6. Cookies',
      p: [
        'This website does not use advertising cookies. Third-party embeds (such as video players) may set their own cookies when you interact with them. You can control cookies through your browser settings.',
      ],
    },
    {
      h: '7. Data retention',
      p: [
        'We retain your personal information for as long as necessary to deliver our services and comply with legal requirements. You may request deletion of your data at any time by contacting us.',
      ],
    },
    {
      h: '8. Your rights',
      p: ['You have the right to access, correct or delete the personal information we hold about you. To exercise any of these rights, contact us using the details below.'],
    },
    {
      h: '9. Contact',
      p: ['RizcoReach · Latifa Tower, Sheikh Zayed Road, Dubai, UAE · support@rizcoreach.ae'],
    },
    {
      h: '10. Changes to this policy',
      p: ['We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated date.'],
    },
  ],
};

const privacyAr: Doc = {
  metaTitle: 'سياسة الخصوصية | RizcoReach',
  metaDescription: 'كيف تجمع RizcoReach معلوماتك الشخصية وتستخدمها وتحميها.',
  title: 'سياسة الخصوصية',
  updated: 'آخر تحديث: أكتوبر 2026',
  intro:
    'تدير RizcoReach ("نحن") هذا الموقع والخدمات الموضّحة فيه. توضّح سياسة الخصوصية هذه كيف نجمع معلوماتك الشخصية ونستخدمها ونحميها عند استخدامك لموقعنا أو أدواتنا المجانية أو خدماتنا. نلتزم بالامتثال لأنظمة حماية البيانات المعمول بها في دولة الإمارات.',
  sections: [
    {
      h: '1. المعلومات التي نجمعها',
      ul: [
        'معلومات التواصل التي تقدّمها عبر نماذجنا (الاسم، البريد الإلكتروني، رقم الهاتف، تفاصيل العمل).',
        'معلومات عن عملك وموقعك وخدماتك وأهدافك التسويقية.',
        'عناوين المواقع التي تُدخلها في أداة فحص المواقع المجانية، والقيم التي تُدخلها في الحاسبات عند طلب تقرير مفصّل.',
        'بيانات تقنية أساسية يعالجها مزوّد الاستضافة لتشغيل الموقع وحمايته (مثل عنوان IP ونوع المتصفح).',
      ],
    },
    {
      h: '2. كيف نستخدم معلوماتك',
      ul: [
        'للرد على استفساراتك وتحديد مواعيد المكالمات الاستراتيجية.',
        'لإنشاء الفحص أو التوقّع أو التقدير الذي طلبته وإرسال النتائج المفصّلة إليك.',
        'لتقديم وإدارة خدمات تطوير المواقع والسيو والإعلانات.',
        'لإرسال رسائل متابعة ذات صلة بطلبك.',
        'للامتثال للالتزامات القانونية.',
      ],
    },
    {
      h: '3. الأدوات المجانية',
      p: ['عند تشغيل فحص الموقع، نجلب الصفحة العامة على العنوان الذي تُدخله لتحليلها، وقد نستخدم خدمة PageSpeed Insights من جوجل لقياس الأداء. نحلّل الصفحات المتاحة للعموم فقط.'],
    },
    {
      h: '4. خدمات الأطراف الثالثة',
      p: ['تتم معالجة النماذج عبر مزوّد الاستضافة Netlify. ويتم تقديم فيديوهات دراسات الحالة عبر Wistia ولا تُحمَّل إلا عند الضغط على تشغيل. يعالج هؤلاء المزوّدون البيانات نيابة عنا وفق التزاماتهم الخاصة بحماية البيانات.'],
    },
    {
      h: '5. مشاركة البيانات',
      p: ['لا نبيع معلوماتك الشخصية أو نؤجّرها أو نتاجر بها. نشارك البيانات فقط مع مزوّدي خدمات موثوقين عند الحاجة لتقديم خدماتنا، وجميعهم ملزمون بحماية البيانات.'],
    },
    {
      h: '6. ملفات تعريف الارتباط',
      p: ['لا يستخدم هذا الموقع ملفات تعريف ارتباط إعلانية. قد تضع العناصر المضمّنة من أطراف ثالثة (مثل مشغّلات الفيديو) ملفاتها الخاصة عند التفاعل معها. يمكنك التحكم بها من إعدادات المتصفح.'],
    },
    {
      h: '7. الاحتفاظ بالبيانات',
      p: ['نحتفظ بمعلوماتك الشخصية طالما كان ذلك ضرورياً لتقديم خدماتنا والامتثال للمتطلبات القانونية. يمكنك طلب حذف بياناتك في أي وقت بالتواصل معنا.'],
    },
    {
      h: '8. حقوقك',
      p: ['يحق لك الاطلاع على معلوماتك الشخصية التي نحتفظ بها أو تصحيحها أو حذفها. لممارسة أي من هذه الحقوق، تواصل معنا عبر التفاصيل أدناه.'],
    },
    {
      h: '9. التواصل',
      p: ['RizcoReach · برج لطيفة، شارع الشيخ زايد، دبي، الإمارات · support@rizcoreach.ae'],
    },
    {
      h: '10. التغييرات على هذه السياسة',
      p: ['قد نحدّث سياسة الخصوصية من وقت لآخر، وسيتم نشر أي تغييرات في هذه الصفحة مع تاريخ التحديث.'],
    },
  ],
};

const termsEn: Doc = {
  metaTitle: 'Terms & Conditions | RizcoReach',
  metaDescription: 'The terms and conditions for using the RizcoReach website.',
  title: 'Terms & Conditions',
  updated: 'Last updated: October 2026',
  intro:
    'By accessing or using the RizcoReach website (www.rizcoreach.ae), you agree to be bound by these Terms and Conditions. Please read them carefully before proceeding.',
  sections: [
    {
      h: 'Services',
      p: [
        'RizcoReach provides website design and development, search engine optimisation (SEO), and paid digital advertising and lead generation services (including Meta and Google Ads) to businesses in the UAE. All service engagements are governed by a separate service agreement signed between RizcoReach and the client.',
      ],
    },
    {
      h: 'Free tools',
      p: [
        'Our website audit, calculators and estimator provide indicative information only. Results are estimates based on the data you enter, public information and industry benchmarks, and are not a guarantee or a formal quote.',
      ],
    },
    {
      h: 'Intellectual property',
      p: ['All content on this website, including text, graphics, logos and ad creatives, is the property of RizcoReach and may not be reproduced, distributed or used without prior written permission.'],
    },
    {
      h: 'No guarantees',
      p: [
        'While we work hard to deliver results for our clients, RizcoReach does not guarantee specific outcomes, search engine rankings, website traffic, lead volumes or revenue figures. Results vary based on industry, budget, market conditions and other factors outside our control.',
      ],
    },
    {
      h: 'Limitation of liability',
      p: ['To the maximum extent permitted by UAE law, RizcoReach shall not be liable for any indirect, incidental or consequential damages arising from the use of our services or website.'],
    },
    {
      h: 'Governing law',
      p: ['These Terms are governed by the laws of the United Arab Emirates. Any disputes shall be subject to the exclusive jurisdiction of the courts of Dubai, UAE.'],
    },
    {
      h: 'Changes to terms',
      p: ['We reserve the right to update these Terms at any time. Continued use of the website constitutes acceptance of any revised Terms.'],
    },
    { h: 'Contact', p: ['For any questions, contact us at support@rizcoreach.ae.'] },
  ],
};

const termsAr: Doc = {
  metaTitle: 'الشروط والأحكام | RizcoReach',
  metaDescription: 'الشروط والأحكام الخاصة باستخدام موقع RizcoReach.',
  title: 'الشروط والأحكام',
  updated: 'آخر تحديث: أكتوبر 2026',
  intro: 'باستخدامك لموقع RizcoReach ‏(www.rizcoreach.ae)، فإنك توافق على الالتزام بهذه الشروط والأحكام. يرجى قراءتها بعناية قبل المتابعة.',
  sections: [
    {
      h: 'الخدمات',
      p: ['تقدّم RizcoReach خدمات تصميم وتطوير المواقع، وتحسين محركات البحث (SEO)، والإعلانات الرقمية المدفوعة واستقطاب العملاء (بما في ذلك إعلانات ميتا وجوجل) للشركات في الإمارات. تخضع جميع الخدمات لاتفاقية خدمة منفصلة موقّعة بين RizcoReach والعميل.'],
    },
    {
      h: 'الأدوات المجانية',
      p: ['يقدّم فحص المواقع والحاسبات والمُخطِّط معلومات تقديرية فقط. النتائج تقديرات مبنية على البيانات التي تُدخلها والمعلومات العامة ومعايير القطاع، وليست ضماناً أو عرض سعر رسمي.'],
    },
    {
      h: 'الملكية الفكرية',
      p: ['جميع محتويات هذا الموقع، بما فيها النصوص والرسومات والشعارات والتصاميم الإعلانية، ملك لـ RizcoReach ولا يجوز نسخها أو توزيعها أو استخدامها دون إذن كتابي مسبق.'],
    },
    {
      h: 'عدم الضمان',
      p: ['رغم حرصنا على تحقيق النتائج لعملائنا، لا تضمن RizcoReach نتائج محددة أو ترتيباً في محركات البحث أو حجم زيارات أو عدد عملاء أو أرقام إيرادات. تختلف النتائج حسب القطاع والميزانية وظروف السوق وعوامل أخرى خارجة عن سيطرتنا.'],
    },
    {
      h: 'حدود المسؤولية',
      p: ['إلى أقصى حد يسمح به قانون دولة الإمارات، لا تتحمّل RizcoReach المسؤولية عن أي أضرار غير مباشرة أو عرضية أو تبعية ناتجة عن استخدام خدماتنا أو موقعنا.'],
    },
    {
      h: 'القانون الحاكم',
      p: ['تخضع هذه الشروط لقوانين دولة الإمارات العربية المتحدة، وتختص محاكم دبي حصرياً بالنظر في أي نزاع.'],
    },
    {
      h: 'تعديل الشروط',
      p: ['نحتفظ بحق تحديث هذه الشروط في أي وقت، ويُعدّ استمرارك في استخدام الموقع قبولاً للشروط المعدّلة.'],
    },
    { h: 'التواصل', p: ['لأي استفسار، راسلنا على support@rizcoreach.ae.'] },
  ],
};

export const legal = {
  privacy: { en: privacyEn, ar: privacyAr },
  terms: { en: termsEn, ar: termsAr },
};
