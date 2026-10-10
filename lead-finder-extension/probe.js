/*
 * Runs inside a business's website (injected with chrome.scripting into the
 * checker tab) and reports what it finds. Must stay self-contained: no
 * outside variables, only plain data in the return value.
 */
// eslint-disable-next-line no-unused-vars
function rrProbeWebsite(options) {
  const opts = options || {};
  const MAX_HTML = 2000000;
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const html = (document.documentElement ? document.documentElement.outerHTML : '').slice(0, MAX_HTML);
  const lowerHtml = html.toLowerCase();
  const nav = (performance.getEntriesByType('navigation') || [])[0] || {};
  const resources = performance.getEntriesByType('resource') || [];
  const resourceNames = resources.map((r) => r.name).join('\n').toLowerCase();
  const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';

  // ── Contact forms ──────────────────────────────────────────────────────────
  const FORM_PLUGINS =
    '.wpcf7, .wpcf7-form, .wpforms-container, .wpforms-form, .elementor-form, .gform_wrapper, .nf-form-cont, ' +
    '.fluentform, .frm_forms, .hs-form, [data-hs-forms-root], .hbspt-form, .w-form, .sqs-block-form, .form-block, ' +
    '[data-testid="form-block"], .wixui-form, [data-hook="form"], .forminator-custom-form, .caldera-grid, .everest-form, ' +
    '.happyforms-form, .ff-el-group, .kb-form, .wsb-contact-form, [data-aid*="CONTACT_FORM"], [data-ux="Form"]';
  const FORM_EMBEDS = /typeform\.com|jotform|forms\.gle|docs\.google\.com\/forms|hsforms|hubspot|tally\.so|formstack|cognitoforms|wufoo|zoho\.(com|eu|in)\/forms|forms\.zohopublic|123formbuilder|paperform|fillout\.com|formsite|formspree|getform|basin|airtable\.com\/embed/i;

  function isSearchOrNewsletter(form) {
    const marker = [form.id, form.className, form.getAttribute('action'), form.getAttribute('role'), form.getAttribute('name')]
      .join(' ')
      .toLowerCase();
    if (form.getAttribute('role') === 'search' || /search|newsletter|subscribe|mailchimp|klaviyo|mc4wp|login|signin|sign-in|register|cart|checkout|coupon/.test(marker)) return true;
    const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter(
      (el) => !/^(hidden|submit|button|reset|image|checkbox|radio)$/i.test(el.type || '')
    );
    if (!fields.length) return true;
    if (fields.every((el) => el.type === 'search' || /^(q|s|search|query)$/i.test(el.name || ''))) return true;
    if (fields.length === 1 && (fields[0].type === 'email' || /email/i.test(fields[0].name || ''))) return true; // newsletter
    return false;
  }

  function hasContactFields(form) {
    if (form.querySelector('textarea')) return true;
    const named = (re) => form.querySelector('input[name], input[id], input[placeholder]') && Array.from(form.querySelectorAll('input')).some((i) => re.test([i.name, i.id, i.placeholder, i.getAttribute('aria-label')].join(' ')));
    const email = form.querySelector('input[type="email"]') || named(/e-?mail/i);
    const phone = form.querySelector('input[type="tel"]') || named(/phone|mobile|tel\b|whatsapp|رقم|هاتف/i);
    const name = named(/name|اسم/i);
    const message = named(/message|enquir|inquir|comment|details|رسالة/i);
    return !!((email || phone) && (name || message || (email && phone)));
  }

  function findForm() {
    const native = all('form').filter((f) => !isSearchOrNewsletter(f) && hasContactFields(f));
    if (native.length) return { found: true, kind: 'form' };
    const plugin = document.querySelector(FORM_PLUGINS);
    if (plugin) return { found: true, kind: 'plugin' };
    const embed = all('iframe[src], iframe[data-src], script[src]').find((el) => FORM_EMBEDS.test(el.getAttribute('src') || el.getAttribute('data-src') || ''));
    if (embed) return { found: true, kind: 'embed' };
    // Forms built without a <form> tag (common on Wix and some page builders).
    const loose = all('textarea').some((t) => {
      const box = t.closest('section, div') || document.body;
      return !!box.querySelector('input[type="email"], input[type="tel"], input[name*="mail" i], input[name*="phone" i]');
    });
    return loose ? { found: true, kind: 'fields' } : { found: false, kind: '' };
  }

  if (opts.formOnly) return { form: findForm(), url: location.href };

  // ── Links ──────────────────────────────────────────────────────────────────
  const anchors = all('a[href]');
  const hrefs = anchors.map((a) => a.getAttribute('href') || '');
  const absolute = anchors.map((a) => a.href || '');

  let contactUrl = '';
  for (const a of anchors) {
    const label = ((a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('href') || '')).toLowerCase();
    if (!/contact|get in touch|enquir|inquir|book an appointment|اتصل|تواصل/.test(label)) continue;
    if (/^(mailto|tel|javascript|whatsapp):/i.test(a.getAttribute('href') || '')) continue;
    try {
      const u = new URL(a.href);
      if (u.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '') && u.href.split('#')[0] !== location.href.split('#')[0]) {
        contactUrl = u.href.split('#')[0];
        break;
      }
    } catch (e) {
      /* ignore bad links */
    }
  }

  const whatsapp =
    absolute.some((h) => /wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|^whatsapp:/i.test(h)) ||
    /joinchat|ht-ctc|ht_ctc|qlwapp|wa-chat|whatsapp-button|whatsapp-float|wa-float|float-whatsapp|getbutton\.io|elfsight-app.*whatsapp|wp-whatsapp|wpsupportplus-whatsapp|click-to-chat|chaty-widget/.test(lowerHtml);
  const tel = hrefs.some((h) => /^tel:/i.test(h.trim()));
  const mailto = hrefs.some((h) => /^mailto:/i.test(h.trim()));

  const instagram = [];
  const igRe = /(?:instagram\.com|instagr\.am)\/(?:#!\/)?@?([a-z0-9._]{1,30})/gi;
  const reserved = /^(p|reel|reels|tv|stories|explore|accounts|about|legal|developer|direct|web|challenge|graphql|api|emails|oauth|privacy|terms|s|share|invites|ar|session)$/;
  absolute.concat([html.slice(0, 600000)]).forEach((text) => {
    let m;
    igRe.lastIndex = 0;
    while ((m = igRe.exec(text))) {
      const h = m[1].toLowerCase().replace(/\.+$/, '');
      if (!reserved.test(h) && !/^\.|\.\./.test(h) && instagram.indexOf(h) < 0) instagram.push(h);
      if (instagram.length >= 3) return;
    }
  });
  const facebook = absolute.some((h) => /facebook\.com\/(?!sharer|share|plugins|dialog|tr\b)/i.test(h));

  // ── Preloader ──────────────────────────────────────────────────────────────
  const PRELOADER_SEL =
    '[id*="preload" i]:not(link):not(script), [class*="preloader" i], [class*="pre-loader" i], [id*="pre-loader" i], ' +
    '[id*="page-loader" i], [class*="page-loader" i], [id*="pageloader" i], [class*="pageloader" i], ' +
    '[id*="loader-wrap" i], [class*="loader-wrap" i], [id*="loading-screen" i], [class*="loading-screen" i], ' +
    '[id*="loading-overlay" i], [class*="loading-overlay" i], [id="loader"], [id="loading"], .pace, #nprogress, ' +
    '[class*="site-loader" i], [id*="site-loader" i], [class*="spinner-wrap" i], [id*="spinner-wrap" i], ' +
    '.et_pb_preloader, .elementor-preloader, .avada-preloader, #qode-page-loading-effect, .mkdf-smooth-transition-loader, ' +
    '.qodef-page-loader, .edgtf-smooth-transition-loader, .loftloader-wrapper, #loftloader-wrapper';
  const loaderEls = all(PRELOADER_SEL).filter(
    (el) => !el.closest('button, form, input, select, [role="button"], img') && !/^(link|script|style|img|source|meta)$/i.test(el.tagName)
  );
  const preloaderLib = /pace(\.min)?\.js|nprogress|preloader|loftloader|page-loading/.test(resourceNames);
  // Many themes remove the loader once the page is ready, so also look for its styles and scripts.
  const preloaderCss = /[#.](preloader|pre-loader|page-loader|pageloader|loader-wrapper|loading-screen|site-loader)\b/.test(lowerHtml);
  const preloader = loaderEls.length > 0 || preloaderLib || preloaderCss;

  // ── Footer copyright year ──────────────────────────────────────────────────
  const footer = document.querySelector('footer, [role="contentinfo"], #footer, .footer, .site-footer');
  const footerText = ((footer && (footer.innerText || footer.textContent)) || bodyText.slice(-3000)) + '';
  let copyrightYear = null;
  const yearRe = /(?:©|&copy;|\(c\)|copyright)\s*(?:[^\d\n]{0,30})?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let ym;
  while ((ym = yearRe.exec(footerText))) {
    const year = parseInt(ym[2] || ym[1], 10);
    if (year <= new Date().getFullYear() + 1 && (!copyrightYear || year > copyrightYear)) copyrightYear = year;
  }

  // ── Platform & tracking ────────────────────────────────────────────────────
  const generator = ((document.querySelector('meta[name="generator" i]') || {}).content || '').toLowerCase();
  const sig = lowerHtml + '\n' + resourceNames + '\n' + generator;
  const BUILDERS = [
    ['Wix', /wix\.com|wixstatic\.com|_wixcidx|wix-thunderbolt/],
    ['Squarespace', /squarespace\.com|static1\.squarespace|squarespace-cdn/],
    ['GoDaddy', /img1\.wsimg\.com|godaddy website builder|websites\.godaddy|secureserver\.net\/.*builder/],
    ['Weebly', /weebly\.com|editmysite\.com/],
    ['Webflow', /webflow\.com|data-wf-page|data-wf-site/],
    ['Shopify', /cdn\.shopify\.com|shopify\.theme|myshopify\.com/],
    ['Duda', /dudaone|cdn-website\.com|multiscreensite|irp\.cdn-website/],
    ['Hostinger', /zyrosite|zyro\.com|hostinger(website)?builder|hostinger\.com\/.*builder|userapp\.zyrosite/],
    ['Google Sites', /sites\.google\.com|gstatic\.com\/atari/],
    ['Jimdo', /jimdo/],
    ['Site123', /site123/],
    ['Strikingly', /strikingly|mystrikingly/],
    ['WordPress', /wp-content|wp-includes|wordpress/],
  ];
  const builderMatch = BUILDERS.find((b) => b[1].test(sig));
  const builder = builderMatch ? builderMatch[0] : '';
  const metaPixel = /connect\.facebook\.net\/[^"'\s]*\/fbevents\.js|fbq\(\s*['"]init/.test(sig);
  const analytics = /googletagmanager\.com\/(gtag\/js|gtm\.js)|google-analytics\.com\/(analytics|ga)\.js|gtag\(\s*['"]config/.test(sig);

  // ── Placeholder / parked / suspended pages ─────────────────────────────────
  const head = (document.title + ' ' + bodyText.slice(0, 1500)).toLowerCase();
  let placeholder = '';
  if (/domain (is|may be) for sale|buy this domain|this domain is for sale|parked free|sedoparking|hugedomains|domain has expired|this domain has expired|parkingcrew|bodis\.com/.test(head + lowerHtml.slice(0, 20000))) placeholder = 'parked';
  else if (/account (has been )?suspended|suspendedpage|this account has been suspended|website is suspended/.test(head)) placeholder = 'suspended';
  else if (/coming soon|under construction|launching soon|site is under maintenance|website under maintenance/.test(head) && bodyText.length < 2500) placeholder = 'coming soon';
  else if (/apache2 (ubuntu|debian) default page|welcome to nginx|it works!|default web site page|index of \//.test(head)) placeholder = 'default server page';

  // ── SEO basics & page weight ───────────────────────────────────────────────
  const viewportContent = ((document.querySelector('meta[name="viewport" i]') || {}).content || '').toLowerCase();
  const description = ((document.querySelector('meta[name="description" i]') || {}).content || '').trim();
  let bytes = nav.transferSize || 0;
  resources.forEach((r) => (bytes += r.transferSize || 0));

  return {
    url: location.href,
    https: location.protocol === 'https:',
    status: nav.responseStatus || 0,
    ttfbMs: nav.responseStart ? Math.round(nav.responseStart) : null,
    domMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
    bytes: bytes,
    requests: resources.length + 1,
    viewport: /width\s*=\s*device-width/.test(viewportContent),
    title: (document.title || '').trim(),
    metaDescription: description.length > 0,
    h1: document.querySelectorAll('h1').length,
    words: bodyText.split(/\s+/).filter(Boolean).length,
    form: findForm(),
    contactUrl: contactUrl,
    whatsapp: whatsapp,
    tel: tel,
    mailto: mailto,
    instagram: instagram,
    facebook: facebook,
    preloader: preloader,
    copyrightYear: copyrightYear,
    builder: builder,
    metaPixel: metaPixel,
    analytics: analytics,
    placeholder: placeholder,
  };
}

/*
 * Runs inside an Instagram profile page in the checker tab. Prefers the exact
 * follower_count in the page's embedded JSON; the description tag
 * ("1,234 Followers, …") is the fallback, parsed in the panel.
 */
// eslint-disable-next-line no-unused-vars
function rrProbeInstagram() {
  const meta = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('content') || '' : '';
  };
  let followers = null;
  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (let i = 0; i < scripts.length && followers == null; i++) {
    const text = scripts[i].textContent || '';
    const m = text.match(/"follower_count":\s*(\d+)/) || text.match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/);
    if (m) followers = parseInt(m[1], 10);
  }
  // Logged-in pages draw the header after load: the followers link holds the exact count in a tooltip.
  if (followers == null) {
    const tip = document.querySelector('a[href*="/followers"] span[title], a[href*="/followers"] [title]');
    const exact = tip && (tip.getAttribute('title') || '').replace(/[^\d]/g, '');
    if (exact) followers = parseInt(exact, 10);
  }
  const header = document.querySelector('header');
  const headerText = header ? (header.innerText || '').replace(/\s+/g, ' ').slice(0, 500) : '';
  const visible = (document.title + ' ' + (document.body ? (document.body.innerText || '').slice(0, 3000) : ''));
  return {
    header: headerText,
    path: location.pathname,
    title: document.title,
    og: meta('meta[property="og:description"]'),
    description: meta('meta[name="description"]'),
    followers: followers,
    notFound: /Sorry, this page isn.t available|Page not found/i.test(visible),
  };
}
