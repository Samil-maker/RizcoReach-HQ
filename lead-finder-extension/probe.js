/*
 * Reads a business website. Runs two ways:
 *   - injected with chrome.scripting into the checker tab (the finished page), or
 *   - from the side panel on the page's original code (staticDoc, parsed with
 *     DOMParser from a quick request), which still contains things like a
 *     preloader that the page's own scripts remove once it has loaded.
 * Must stay self-contained: no outside variables, only plain data returned.
 */
// eslint-disable-next-line no-unused-vars
function rrProbeWebsite(options, staticDoc) {
  const opts = options || {};
  const doc = staticDoc || document;
  const live = !staticDoc;
  const pageUrl = live ? location.href : opts.url || '';
  let host = '';
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    host = '';
  }
  const all = (sel, root) => Array.from((root || doc).querySelectorAll(sel));
  const textOf = (el) => (el ? el.innerText || el.textContent || '' : '');
  const html = (opts.rawHtml || (doc.documentElement ? doc.documentElement.outerHTML : '')).slice(0, 2000000);
  const lowerHtml = html.toLowerCase();
  const nav = live ? (performance.getEntriesByType('navigation') || [])[0] || {} : {};
  const resources = live ? performance.getEntriesByType('resource') || [] : [];
  const resourceNames = resources.map((r) => r.name).join('\n').toLowerCase();
  const bodyText = textOf(doc.body);
  const title = (doc.title || '').trim();
  const headers = String(opts.headers || '').toLowerCase();

  // ── Bot protection walls (can't judge the site behind them) ────────────────
  const challenge =
    /^(just a moment|attention required|access denied|ddos-guard|please wait while we verify)/i.test(title) ||
    !!doc.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification, #challenge-stage') ||
    /cdn-cgi\/challenge-platform|cf-chl-/.test(lowerHtml.slice(0, 40000));

  // ── Contact forms ──────────────────────────────────────────────────────────
  const FIELDS =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="checkbox"])' +
    ':not([type="radio"]):not([type="search"]):not([type="reset"]), textarea, select';
  const fieldWords = (i) => [i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.getAttribute('autocomplete')].join(' ');
  const SEND_WORDS = /send|submit|contact|message|enquir|inquir|quote|book|appointment|call ?back|get in touch|أرسل|إرسال|تواصل|اتصل|استفسار|احجز/i;

  /** contact | newsletter | search | account | comment | other */
  function formKind(form) {
    const marker = [form.id, form.className, form.getAttribute('action'), form.getAttribute('name')].join(' ').toLowerCase();
    if (
      form.getAttribute('role') === 'search' ||
      form.querySelector('input[type="search"], input[name="s"], input[name="q"], input[name="query"], input[name="search"], input[name="keyword"]') ||
      /search|[?&]s=/.test(marker)
    ) return 'search';
    if (form.querySelector('input[type="password"]') || /login|signin|sign-in|register|woocommerce-(form-login|cart-form)|\bcart\b|checkout|coupon/.test(marker)) return 'account';
    if (form.id === 'commentform' || /comment-form|wp-comments-post/.test(marker)) return 'comment';
    if (form.querySelector('input[name="form_type"][value="contact"]')) return 'contact';
    if (
      /mc4wp|mailchimp|list-manage\.com|mailpoet|tnp-subscription|sib-form|klaviyo|newsletter|subscribe/.test(marker) ||
      form.querySelector('input[name="form_type"][value="customer"]')
    ) return 'newsletter';
    const fields = all(FIELDS, form);
    const email = fields.some((i) => i.type === 'email' || /e-?mail|بريد/i.test(fieldWords(i)));
    const tel = fields.some((i) => i.type === 'tel' || /phone|mobile|\btel\b|whatsapp|رقم|هاتف|جوال/i.test(fieldWords(i)));
    const textarea = !!form.querySelector('textarea');
    if (textarea && (email || tel)) return 'contact';
    if (fields.length === 1 && email) return 'newsletter';
    const words = textOf(form) + ' ' + all('button, input[type="submit"]', form).map((b) => b.value || b.textContent).join(' ');
    // Only a name and an email, and it says subscribe/join: a mailing-list sign-up.
    const nameOrEmail = fields.every((i) => i.type === 'email' || /e-?mail|name|بريد|اسم/i.test(fieldWords(i)));
    if (!textarea && !tel && nameOrEmail && /subscribe|sign ?up|join|newsletter|mailing list|اشترك/i.test(words)) return 'newsletter';
    if (fields.length >= 2 && (email || tel) && SEND_WORDS.test(words)) return 'contact';
    if (/subscribe|sign ?up|join|newsletter|اشترك/i.test(words)) return 'newsletter';
    return 'other';
  }

  const FORM_PLUGINS =
    '.wpcf7, .wpforms-container, .gform_wrapper, .nf-form-cont, .fluentform, .frm_forms, .elementor-widget-form, ' +
    'form.elementor-form, .et_pb_contact_form, form.fusion-form, .wp-block-jetpack-contact-form, .forminator-custom-form, ' +
    '.everest-form, .kb-form, .uagb-forms__form, .brxe-form, .w-form, .sqs-block-form, .wsite-form-container, .dmform, ' +
    '.hbspt-form, .hs-form-frame, form.hs-form, [data-tf-widget], [data-tf-popup], [data-tf-live], [data-tf-slider], ' +
    '.caldera-grid, .happyforms-form';
  const FORM_HOSTS =
    /typeform\.com|jotform|forms\.gle|docs\.google\.com\/forms|hsforms|tally\.so|formstack|cognitoforms|wufoo|zoho\.(com|eu|in)\/forms|forms\.zohopublic|123formbuilder|paperform|fillout\.com|formsite|formspree|forms\.office\.com/i;
  const BOOKING_HOSTS = /calendly\.com|fresha\.com|booksy\.com|simplybook\.(me|it)|setmore\.com|squareup\.com\/appointments|vagaro\.com|mindbodyonline|zenoti|acuityscheduling/i;

  function findForm() {
    const forms = all('form').map(formKind);
    if (forms.indexOf('contact') >= 0) return { found: true, kind: 'form' };
    // A form plugin counts unless the form inside it is a newsletter, search, login or comment form.
    const plugin = all(FORM_PLUGINS).find((el) => {
      if (el.closest('.sqs-block-newsletter, .newsletter-form, .mc4wp-form')) return false;
      const inner = el.matches('form') ? el : el.querySelector('form');
      return !inner || ['contact', 'other'].indexOf(formKind(inner)) >= 0;
    });
    if (plugin) return { found: true, kind: 'plugin' };
    // Lazy-loaders park the real address in data-* attributes (and don't run in a background tab).
    const LAZY = ['src', 'data-src', 'data-lazy-src', 'data-rocket-src', 'data-litespeed-src', 'data-tally-src'];
    const embedded = [];
    all('iframe, script[src]').forEach((el) => LAZY.forEach((a) => el.getAttribute(a) && embedded.push(el.getAttribute(a))));
    if (embedded.some((src) => FORM_HOSTS.test(src))) return { found: true, kind: 'embedded form' };
    if (all('a[href]').some((a) => /forms\.gle\/|typeform\.com\/to\/|tally\.so\/r\/|form\.jotform\.com\//i.test(a.href || a.getAttribute('href') || ''))) {
      return { found: true, kind: 'form link' };
    }
    if (embedded.some((src) => BOOKING_HOSTS.test(src))) return { found: true, kind: 'booking widget' };
    // Forms built without a <form> tag (common on Wix and React sites): a message box next to an email/phone field.
    const loose = all('textarea').some((t) => {
      if (t.closest('form')) return false;
      let box = t.parentElement;
      for (let i = 0; box && i < 5; i++, box = box.parentElement) {
        if (box.querySelector('input[type="email"], input[type="tel"], input[name*="mail" i], input[name*="phone" i]')) return true;
      }
      return false;
    });
    return loose ? { found: true, kind: 'form' } : { found: false, kind: '' };
  }

  if (opts.formOnly) return { form: findForm(), url: pageUrl.slice(0, 500), challenge: challenge };
  if (opts.timingOnly) return { loadMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null, status: nav.responseStatus || 0 };

  // ── Links ──────────────────────────────────────────────────────────────────
  const anchors = all('a[href]');
  const hrefs = anchors.map((a) => (a.getAttribute('href') || '').trim());
  const absolute = anchors.map((a) => {
    try {
      return new URL(a.getAttribute('href') || '', pageUrl || undefined).href;
    } catch (e) {
      return a.getAttribute('href') || '';
    }
  });

  let contactUrl = '';
  for (let i = 0; i < anchors.length && !contactUrl; i++) {
    const a = anchors[i];
    const label = (textOf(a) + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '') + ' ' + hrefs[i]).toLowerCase();
    if (!/contact|get-?in-?touch|reach-?us|enquir|inquir|book an appointment|اتصل|تواصل/.test(label)) continue;
    if (/^(mailto|tel|javascript|whatsapp|#)/i.test(hrefs[i])) continue;
    try {
      const u = new URL(absolute[i]);
      if (/^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, '') === host && u.href.split('#')[0] !== pageUrl.split('#')[0]) {
        contactUrl = u.href.split('#')[0].slice(0, 500);
      }
    } catch (e) {
      /* ignore bad links */
    }
  }

  const linkish = absolute.concat(all('[data-href], [data-url], [onclick]').map((el) => (el.getAttribute('data-href') || '') + ' ' + (el.getAttribute('data-url') || '') + ' ' + (el.getAttribute('onclick') || '')));
  const whatsapp =
    linkish.some((h) => /(\/\/|^|\s)(wa\.me\/|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send|wa\.link\/)|whatsapp:\/\/send/i.test(h)) ||
    /joinchat|wptwa-container|creame-whatsapp-me|ht-ctc|ctc_chat|qlwapp|wp-whatsapp-chat|click-to-chat-for-whatsapp|getbutton\.io|wati-integration|app\.interakt\.ai|whatsapp-(button|float|widget|chat)|(float|floating)-whatsapp|wa-(float|chat|widget)/.test(lowerHtml);
  const tel = hrefs.some((h) => /^(tel|callto):/i.test(h));
  const mailto = hrefs.some((h) => /^mailto:/i.test(h));

  // Instagram accounts the site links to (links and JSON-LD "sameAs" only, not scripts like
  // instagram.com/embed.js). Skips "website by @designer" credits and platform accounts.
  const instagram = [];
  // The host must start at a boundary, so CDN addresses like scontent.cdninstagram.com/v/… don't count.
  const igRe = /(?:^|\/\/|[\s"'(]|\bwww\.|\bm\.)(?:instagram\.com|instagr\.am)\/(?:_u\/)?@?([a-z0-9._]{1,30})(?=[/?#"'\s]|$)/gi;
  const reserved = /^(p|reel|reels|tv|stories|explore|accounts|about|legal|developer|direct|web|challenge|graphql|api|ajax|static|emails|oauth|oembed|embed|privacy|terms|press|help|s|share|invites|ar|session|nametag|qr|directory|lite|create|locations|popular|v|_u|_n|rsrc\.php|favicon\.ico)$/;
  const PLATFORM = /^(instagram|meta|facebook|envato|themeforest|elementor|wordpress|wix|squarespace|shopify|godaddy|hostinger|webflow|canva)$/;
  const CREDIT = /designed|developed|powered|made by|website by|site by|theme by|crafted by|built by|created by|تصميم|تطوير/i;
  const addHandle = (raw) => {
    const h = String(raw).toLowerCase().replace(/\.+$/, '');
    if (h.length < 2 || reserved.test(h) || PLATFORM.test(h) || /\.(js|css|png|jpe?g|svg|gif|webp|php|html?|ico)$/.test(h) || /^\.|\.\./.test(h)) return;
    if (instagram.indexOf(h) < 0 && instagram.length < 3) instagram.push(h);
  };
  anchors.forEach((a, i) => {
    // "Website by <a>…</a>": the words right before the link, or on the link itself.
    const before = ((a.previousSibling && a.previousSibling.textContent) || '').slice(-40);
    const own = textOf(a) + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '');
    if (CREDIT.test(before + ' ' + own)) return;
    let m;
    igRe.lastIndex = 0;
    while ((m = igRe.exec(absolute[i]))) addHandle(m[1]);
  });
  all('script[type="application/ld+json"]').forEach((el) => {
    let m;
    const text = el.textContent || '';
    igRe.lastIndex = 0;
    while ((m = igRe.exec(text))) addHandle(m[1]);
  });
  const facebook = absolute.some((h) => /facebook\.com\/(?!sharer|share|plugins|dialog|tr\b)/i.test(h));

  // ── Preloader ──────────────────────────────────────────────────────────────
  const LOADER_NAME =
    /(^|[\s_-])(pre-?loader|preloading|page-?loader|site-?loader|loader-?(wrap|wrapper|overlay|container|bg)|loading-?(screen|overlay|page|wrap|wrapper|mask)|page-?(loading|transition)|splash-?screen|se-pre-con|loftloader-wrapper)($|[\s_-])/i;
  const NOT_A_PAGE_LOADER =
    'form, button, iframe, .wpcf7, .wpforms-container, .gform_wrapper, .nf-form-cont, .swiper, .slick-slider, .owl-carousel, ' +
    'rs-module-wrap, .rev_slider_wrapper, .mfp-wrap, .fancybox-container, .pswp, .elementor-lightbox, .blockUI, #sb_instagram';
  const className = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const named = all('[id], [class]')
    .slice(0, 5000)
    .filter((el) => LOADER_NAME.test(el.id || '') || LOADER_NAME.test(className(el)))
    .filter((el) => !/^(link|script|style|img|source|meta|svg|path|use)$/i.test(el.tagName))
    .filter((el) => !el.closest(NOT_A_PAGE_LOADER) && !/wpcf7-spinner|lazy-?preloader|img-?preload|image-?preload/i.test(className(el) + ' ' + (el.id || '')));
  // Short names like #loader are only a page loader when they cover the screen.
  const covering = live
    ? all('#loader, #loading, #preloader, .preloader, #status, .loader, .loading').some((el) => {
        if (el.closest(NOT_A_PAGE_LOADER)) return false;
        const cs = getComputedStyle(el);
        return cs.position === 'fixed' && (parseInt(cs.zIndex, 10) || 0) >= 100;
      })
    : false;
  const assetUrls = all('script[src], link[href]')
    .map((el) => el.getAttribute('src') || el.getAttribute('href') || '')
    .join('\n')
    .toLowerCase();
  const preloaderLib =
    !!doc.querySelector('e-preloader, e-page-transition, div.pace, #nprogress, #loftloader-wrapper, body.pace-done, body.pace-running') ||
    /pace(\.min)?\.js|nprogress(\.min)?\.js|\/wp-content\/plugins\/[^/"'\n]{0,60}(pre-?loader|loader|page-?transition)[^/"'\n]{0,60}\//.test(resourceNames + '\n' + assetUrls);
  const preloader = named.length > 0 || covering || preloaderLib;

  // ── Footer copyright year ──────────────────────────────────────────────────
  // The page's own footer: the last one that isn't part of a post, quote or sidebar.
  const footers = all('footer, [role="contentinfo"], #footer, .footer, .site-footer').filter((el) => !el.closest('article, blockquote, aside, figure'));
  const footer = footers[footers.length - 1];
  const footerText = textOf(footer) + '\n' + bodyText.slice(-3000);
  let copyrightYear = null;
  const yearRe = /(?:©|&copy;|\(c\)|copyright)[^0-9\n]{0,40}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let ym;
  while ((ym = yearRe.exec(footerText))) {
    const year = parseInt(ym[2] || ym[1], 10);
    if (year <= new Date().getFullYear() + 1 && (!copyrightYear || year > copyrightYear)) copyrightYear = year;
  }

  // ── Old technology ─────────────────────────────────────────────────────────
  const flash = !!doc.querySelector('object[type="application/x-shockwave-flash"], embed[src$=".swf"], param[value*=".swf"]');
  let jquery = '';
  const jq = (resourceNames + '\n' + lowerHtml).match(/jquery[-.](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js|ajax\/libs\/jquery\/(\d+\.\d+(?:\.\d+)?)\//);
  if (jq) jquery = jq[1] || jq[2];
  const tableLayout = !!doc.querySelector('body > table, table table') || !!doc.querySelector('font, center, marquee, frameset, bgsound');

  // ── Platform & tracking ────────────────────────────────────────────────────
  const generator = (((doc.querySelector('meta[name="generator" i]') || {}).content || '') + '').toLowerCase();
  const sig = lowerHtml + '\n' + resourceNames + '\n' + generator + '\n' + headers;
  const BUILDERS = [
    ['Wix', /wix\.com website builder|static\.parastorage\.com|wixstatic\.com|x-wix-|wixbisession/],
    ['Squarespace', /squarespace|static1\.squarespace|sqs-block/],
    ['Webflow', /data-wf-site|website-files\.com|webflow\.(com|io)/],
    ['Shopify', /cdn\.shopify\.com|shopify\.theme|myshopify\.com|x-shopify/],
    ['Duda', /dudaone|cdn-website\.com|multiscreensite|irp\.cdn-website/],
    ['Hostinger', /zyrosite|zyro\.com|hostinger/],
    ['Google Sites', /sites\.google\.com|gstatic\.com\/atari/],
    ['Jimdo', /jimdo/],
    ['Site123', /site123/],
    ['Strikingly', /strikingly/],
    ['Weebly', /weebly\.com|editmysite\.com/],
    ['GoDaddy', /go daddy website builder|starfield technologies|img1\.wsimg\.com\/isteam|godaddysites\.com/],
    ['WordPress', /wp-content|wp-includes|generator[^>]*wordpress|api\.w\.org/],
  ];
  const builderMatch = BUILDERS.find((b) => b[1].test(sig));
  const builder = builderMatch ? builderMatch[0] : '';
  const freeDomainMatch = host.match(
    /\.(wixsite\.com|wixstudio\.io|godaddysites\.com|webflow\.io|weebly\.com|square\.site|site123\.me|mystrikingly\.com|strikingly\.com|zyrosite\.com|hostingersite\.com|wordpress\.com|blogspot\.com|business\.site|negocio\.site|carrd\.co|jimdosite\.com|yolasite\.com|webnode\.[a-z]+|framer\.website|myshopify\.com|odoo\.com|ueniweb\.com)$/
  );
  const freeDomain = freeDomainMatch ? host : '';
  const metaPixel = /connect\.facebook\.[a-z]+\/[^"'\s]{0,200}\/fbevents\.js|fbq\(\s*['"]init|facebook\.com\/tr\?id=|connect\.facebook\.net\/signals\/config/.test(sig);
  const ga4 = /googletagmanager\.com\/(gtag\/js|gtm\.js)|google-analytics\.com\/g\/collect|gtag\(\s*['"]config['"]\s*,\s*['"](g|aw)-|\bgtm-[a-z0-9]{4,9}\b/.test(sig);
  const uaOnly = !ga4 && /google-analytics\.com\/(analytics|ga|urchin)\.js|\bua-\d{4,10}-\d{1,4}\b/.test(sig);
  const analytics = ga4;

  // ── Placeholder / parked / suspended / unfinished pages ────────────────────
  // Only whole-page signs count (the title, the main heading, or a nearly empty page), so a
  // working site that mentions "our new branch is coming soon" is never called unfinished.
  const top = (title + ' ' + bodyText.slice(0, 1500)).toLowerCase();
  const lowTitle = title.toLowerCase();
  const heading = textOf(doc.querySelector('h1')).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
  const shortText = bodyText.replace(/\s+/g, ' ').trim();
  const tiny = shortText.length < 300;
  const SOON = /coming soon|under construction|launching soon|under maintenance/;
  // "Coming soon", "We're launching soon", "Site under construction"… as the whole message, not "our new branch is coming soon".
  const SOON_START = /^(?:(?:we(?:'re| are)|this (?:site|website) is|(?:site|website|page)(?: is)?)\s+)?(?:coming soon|launching soon|under construction|under maintenance)/;
  const headings = all('h1, h2, h3').slice(0, 6).map((h) => textOf(h).replace(/\s+/g, ' ').trim().toLowerCase());
  let placeholder = '';
  if (/domain (is|may be) for sale|buy this domain|this domain is for sale|parked free|this web page is parked|sedoparking|hugedomains|domain has expired|this domain has expired|parkingcrew|bodis\.com|wsimg\.com\/parking-lander/.test(top + ' ' + lowerHtml.slice(0, 20000))) {
    placeholder = 'parked';
  } else if (/account (has been )?suspended|suspendedpage|this account has been suspended|website is suspended/.test(lowTitle + ' ' + heading) || (tiny && /(account|website|site|hosting)( has been| is)? suspended/.test(top))) {
    placeholder = 'suspended';
  } else if (
    (SOON.test(lowTitle) && lowTitle.length < 80) ||
    (shortText.length < 1500 && headings.some((h) => SOON_START.test(h))) ||
    (tiny && SOON_START.test(shortText.toLowerCase()))
  ) {
    placeholder = 'coming soon';
  } else if (
    /^(apache2 (ubuntu|debian) default page|welcome to nginx!?|it works!?|iis windows server|index of \/)/.test(lowTitle) ||
    /^(it works!?|welcome to nginx!?)$/.test(heading) ||
    (tiny && /^(it works!|welcome to nginx)/i.test(shortText))
  ) {
    placeholder = 'default server page';
  } else if (/hello world!.{0,400}sample page|sample page.{0,400}hello world!/.test(top.replace(/\s+/g, ' ')) || (/just another wordpress site/.test(top) && shortText.length < 800)) {
    placeholder = 'wordpress demo';
  }

  // ── SEO basics & page weight ───────────────────────────────────────────────
  const viewportContent = (((doc.querySelector('meta[name="viewport" i]') || {}).content || '') + '').toLowerCase();
  const description = (((doc.querySelector('meta[name="description" i]') || {}).content || '') + '').trim();
  let bytes = nav.transferSize || 0;
  resources.forEach((r) => (bytes += r.transferSize || 0));

  return {
    url: pageUrl.slice(0, 500),
    https: /^https:/i.test(pageUrl),
    status: nav.responseStatus || 0,
    ttfbMs: nav.responseStart ? Math.round(nav.responseStart) : null,
    domMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
    bytes: bytes,
    requests: live ? resources.length + 1 : null,
    viewport: /width\s*=\s*device-width/.test(viewportContent),
    title: title.slice(0, 200),
    metaDescription: description.length > 0,
    h1: doc.querySelectorAll('h1').length,
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
    flash: flash,
    jquery: jquery,
    tableLayout: tableLayout,
    builder: builder,
    freeDomain: freeDomain,
    metaPixel: metaPixel,
    analytics: analytics,
    uaOnly: uaOnly,
    placeholder: placeholder,
    challenge: challenge,
  };
}

/*
 * Runs inside an Instagram profile page in the checker tab. Prefers the exact
 * follower_count in the page's embedded JSON; the description tag
 * ("1,234 Followers, …") is the fallback, parsed in the panel.
 */
// eslint-disable-next-line no-unused-vars
function rrProbeInstagram(handle) {
  const meta = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('content') || '' : '';
  };
  const want = String(handle || '').toLowerCase();
  let followers = null;
  // The page can also hold other accounts (suggestions, the viewer's own), so only take
  // a follower_count that sits next to this profile's username.
  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (let i = 0; i < scripts.length && followers == null && want; i++) {
    const text = scripts[i].textContent || '';
    const userRe = new RegExp('"username"\\s*:\\s*"' + want.replace(/[.]/g, '\\.') + '"', 'gi');
    let m;
    while (followers == null && (m = userRe.exec(text))) {
      const around = text.slice(Math.max(0, m.index - 1500), m.index + 1500);
      const count = around.match(/"follower_count"\s*:\s*(\d+)/) || around.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
      if (count) followers = parseInt(count[1], 10);
    }
  }
  // Logged-in pages draw the header after load: this profile's followers link holds the exact count in a tooltip.
  if (followers == null && want) {
    const tip = document.querySelector('a[href*="/' + want + '/followers"] [title]');
    const exact = tip && (tip.getAttribute('title') || '').replace(/[^\d]/g, '');
    if (exact) followers = parseInt(exact, 10);
  }
  const header = document.querySelector('header');
  const headerText = header ? (header.innerText || '').replace(/\s+/g, ' ').slice(0, 500) : '';
  const visible = document.title + ' ' + (document.body ? (document.body.innerText || '').slice(0, 3000) : '');
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
