/* Lead Hunter: website audit + contact extraction from raw HTML.
   Regex based (service workers have no DOMParser). The checks mirror the
   rizcoreach.ae website audit (netlify/functions/audit.mts), plus a few that
   matter for businesses running Meta ads (Meta Pixel, stale footer, parked pages).
   Every issue carries a `label` for the dashboard and a `pitch` phrase that reads
   naturally after "I noticed …" in an outreach message. */
(function (root) {
  const LH = (root.LH = root.LH || {});

  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
  };
  const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
  const decode = (s) =>
    String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&copy;/gi, '©')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  const metaContent = (html, key, by = 'name') => {
    for (const t of tags(html, 'meta')) if ((attr(t, by) || '').toLowerCase() === key) return decode(attr(t, 'content') || '');
    return null;
  };
  const visibleText = (html) =>
    decode(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim();

  const BUILDERS = [
    ['Wix', /static\.wixstatic\.com|wix-bolt|_wixCssImports|X-Wix-|wixsite\.com/i],
    ['Squarespace', /static1\.squarespace\.com|squarespace-cdn/i],
    ['GoDaddy builder', /img1\.wsimg\.com|GoDaddy Website Builder|websites\.godaddy/i],
    ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
    ['Webflow', /data-wf-page|webflow\.js|assets\.website-files\.com/i],
    ['Framer', /framerusercontent\.com|framer\.com\/m\//i],
    ['Hostinger builder', /zyrosite|hostinger-cdn|zyro\.com/i],
    ['Weebly', /weebly\.com|editmysite\.com/i],
    ['Site123', /site123/i],
    ['Odoo', /\/web\/assets\/|odoo/i],
    ['Elementor (WordPress)', /elementor/i],
    ['WordPress', /wp-content|wp-includes/i],
    ['Next.js', /__NEXT_DATA__|\/_next\/static/i],
    ['Carrd', /carrd\.co/i],
  ];

  const PARKED = [
    /domain (name )?(is|may be) for sale/i,
    /buy this domain/i,
    /this domain (has been|is) (registered|parked)/i,
    /parked (free|domain)/i,
    /(website|site|page) (is )?(coming soon|under construction|under maintenance)/i,
    /^\s*coming soon\s*$/i,
    /account (has been )?suspended/i,
    /index of \//i,
    /welcome to nginx/i,
    /apache2? (ubuntu|debian)? ?default page/i,
    /it works!/i,
    /default web site page/i,
    /there is no website configured at this address/i,
  ];

  /** Contacts found in a page: phone numbers, WhatsApp numbers, emails, social profiles. */
  LH.extractContacts = (html, baseUrl, countryCode = 'AE') => {
    const out = { phones: [], whatsapp: [], emails: [], socials: {}, contactPages: [] };
    if (!html) return out;
    const base = LH.safeUrl(baseUrl);
    const phones = new Set();
    const wa = new Set();
    const emails = new Set();
    for (const t of tags(html, 'a')) {
      const raw = decode(attr(t, 'href') || '');
      if (!raw) continue;
      if (/^tel:/i.test(raw)) {
        const n = LH.normalizePhone(raw, countryCode);
        if (n) phones.add(n);
        continue;
      }
      if (/^mailto:/i.test(raw)) {
        const e = raw.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
        if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !LH.isJunkEmail(e)) emails.add(e);
        continue;
      }
      const u = LH.unwrapLink(raw.startsWith('whatsapp:') ? raw : LH.safeUrl(raw, base) && LH.safeUrl(raw, base).toString());
      if (!u) continue;
      const kind = LH.linkKind(u);
      if (kind === 'whatsapp') {
        const n = LH.whatsappNumber(u);
        if (n) wa.add(n);
      } else if (['instagram', 'tiktok', 'facebook', 'youtube', 'social'].includes(kind)) {
        const path = u.pathname.split('/').filter(Boolean);
        if (!path.length || /^(sharer|share|intent|p|reel|reels|explore|watch|hashtag|plugins|tr|dialog)$/i.test(path[0])) continue;
        const key = kind === 'social' ? LH.domainOf(u).split('.')[0] : kind;
        if (!out.socials[key]) out.socials[key] = LH.cleanUrl(u);
      } else if (kind === 'website' && base && LH.domainOf(u) === LH.domainOf(base) && /contact|get-in-touch|reach-us|about|تواصل|اتصل/i.test(u.pathname + ' ' + t)) {
        out.contactPages.push(LH.cleanUrl(u));
      }
    }
    const text = visibleText(html);
    LH.phonesInText(text, countryCode).forEach((n) => phones.add(n));
    for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
      const e = m[0].toLowerCase();
      if (LH.isJunkEmail(e)) continue;
      emails.add(e);
    }
    wa.forEach((n) => phones.delete(n));
    out.phones = [...phones].slice(0, 6);
    out.whatsapp = [...wa].slice(0, 4);
    out.emails = [...emails].slice(0, 5);
    out.contactPages = [...new Set(out.contactPages)].slice(0, 3);
    return out;
  };

  const ISSUE = {
    unreachable: { label: 'Website does not load', pitch: 'the site would not load at all ({v})' },
    httpError: { label: 'Website returns an error ({v})', pitch: 'the page returned an error ({v}) instead of loading' },
    parked: { label: 'Placeholder / parked page', pitch: 'it shows a placeholder page ("{v}") instead of a real website' },
    https: { label: 'No HTTPS ("Not secure" warning)', pitch: 'the site has no HTTPS, so Chrome shows visitors a "Not secure" warning' },
    viewport: { label: 'Not mobile-friendly', pitch: 'the site is not set up for mobile, which is where almost all ad clicks come from' },
    ttfb: { label: 'Slow server ({v}s to respond)', pitch: 'the server takes about {v}s just to start loading the page' },
    loadTime: { label: 'Slow page load ({v}s)', pitch: 'the page took around {v}s to load, and most people leave after 3' },
    heavy: { label: 'Heavy page ({v} KB HTML)', pitch: 'the page is very heavy ({v} KB of HTML before images), which slows it down on mobile data' },
    blocking: { label: '{v} render-blocking scripts', pitch: 'there are {v} scripts blocking the page from showing quickly' },
    pixel: { label: 'No Meta Pixel found', pitch: 'there is no Meta Pixel on the site, so your ads cannot track who enquires or retarget visitors' },
    pixelUnsure: { label: 'Meta Pixel not visible in HTML', pitch: 'I could not see a Meta Pixel firing on the page, so ad conversions may not be tracked' },
    contactLinks: { label: 'No tap-to-call / WhatsApp button', pitch: 'there is no tap-to-call or WhatsApp button for mobile visitors' },
    leadCapture: { label: 'No enquiry form', pitch: 'there is no enquiry or booking form to capture people who are not ready to call' },
    copyright: { label: 'Outdated footer (© {v})', pitch: 'the footer still says © {v}, which makes the business look inactive' },
    title: { label: 'Missing / weak page title', pitch: 'the page title is missing or weak, which hurts how you show up on Google' },
    description: { label: 'No meta description', pitch: 'there is no meta description, so Google writes its own snippet for you' },
    h1: { label: 'No main heading (H1)', pitch: 'the page has no clear main headline' },
    thin: { label: 'Very little text ({v} words)', pitch: 'there is very little text on the page ({v} words), so Google has little to rank' },
    og: { label: 'No link preview image', pitch: 'there is no preview image when the link is shared on WhatsApp or social media' },
    favicon: { label: 'No favicon', pitch: 'the site has no favicon, a small detail that makes it look unfinished' },
    alt: { label: 'Images missing alt text ({v})', pitch: 'most images are missing alt text ({v}), which costs SEO and accessibility' },
    schema: { label: 'No business schema markup', pitch: 'there is no structured data telling Google your business details' },
    psi: { label: 'Google mobile speed score {v}/100', pitch: "Google's own speed test scores the site {v}/100 on mobile" },
  };
  const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
  const issue = (id, sev, v) => {
    const t = ISSUE[id];
    const fill = (s) => s.replace('{v}', v == null ? '' : String(v));
    return { id, sev, label: fill(t.label), pitch: fill(t.pitch) };
  };
  LH.issue = issue;

  /**
   * @param {string} html
   * @param {{finalUrl:string,status:number,headers:Record<string,string>,ttfbMs:number,totalMs:number,bytes:number}} meta
   */
  LH.auditHtml = (html, meta) => {
    const checks = []; // {id, weight, ok: 0..1}
    const issues = [];
    const add = (id, weight, ok, sev, v) => {
      checks.push({ id, weight, ok });
      if (ok < 1 && sev) issues.push(issue(id, ok === 0 ? sev : SEV[sev] < 2 ? 'medium' : 'low', v));
    };
    const finalUrl = LH.safeUrl(meta.finalUrl);
    const headers = meta.headers || {};
    const head = html.split(/<\/head>/i)[0] || html;
    const text = visibleText(html);
    const words = text ? text.split(' ').length : 0;
    const builder = (BUILDERS.find(([, re]) => re.test(html)) || [null])[0];

    // Parked / placeholder pages are a headline issue on their own.
    const parkedHit = PARKED.find((re) => re.test(words < 400 ? text : text.slice(0, 600)));
    if (parkedHit && words < 400) {
      const phrase = (text.match(parkedHit) || [''])[0].trim().slice(0, 60);
      return {
        state: 'ok',
        parked: true,
        score: 5,
        grade: 'poor',
        issues: [issue('parked', 'critical', phrase)],
        builder,
        words,
        title: '',
        pixel: false,
      };
    }

    // Trust & mobile
    add('https', 3, finalUrl && finalUrl.protocol === 'https:' ? 1 : 0, 'critical');
    const viewport = metaContent(html, 'viewport') || '';
    add('viewport', 3, /width\s*=\s*device-width/i.test(viewport) ? 1 : 0, 'critical');

    // Speed
    const ttfb = Math.round((meta.ttfbMs || 0) / 100) / 10;
    add('ttfb', 2, ttfb < 0.8 ? 1 : ttfb < 1.8 ? 0.5 : 0, 'high', ttfb);
    const load = Math.round((meta.totalMs || 0) / 100) / 10;
    add('loadTime', 2, load < 2.5 ? 1 : load < 4.5 ? 0.5 : 0, 'high', load);
    const kb = Math.round((meta.bytes || html.length) / 1024);
    add('heavy', 1, kb < 150 ? 1 : kb < 400 ? 0.5 : 0, 'medium', kb);
    const blocking = tags(head, 'script').filter((t) => attr(t, 'src') && !/\s(async|defer)\b/i.test(t) && (attr(t, 'type') || '').toLowerCase() !== 'module').length;
    add('blocking', 1, blocking <= 2 ? 1 : blocking <= 5 ? 0.5 : 0, 'low', blocking);

    // Ads & conversion
    const hasPixel = /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init|facebook\.com\/tr\?id=/i.test(html);
    const tagManager = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i.test(html);
    const shopifyPixel = builder === 'Shopify' || /web-pixels-manager/i.test(html);
    if (hasPixel) add('pixel', 3, 1);
    else if (tagManager || shopifyPixel) add('pixelUnsure', 1, 0.5, 'medium');
    else add('pixel', 3, 0, 'high');

    // Client-rendered apps ship an empty shell; skip content checks we cannot see.
    const spa = words < 60 && /<div[^>]+id=["'](root|app|__nuxt|svelte)["'][^>]*>\s*<\/div>/i.test(html);

    const anchors = tags(html, 'a').map((t) => decode(attr(t, 'href') || ''));
    const call = anchors.some((h) => /^tel:/i.test(h));
    const waLink = anchors.some((h) => /wa\.me|whatsapp\.com\/send|api\.whatsapp\.com|whatsapp:\/\//i.test(h)) || /wa\.me\/\d|whatsapp-button|wa-widget|elfsight-app.*whatsapp|getbutton\.io/i.test(html);
    const forms = (html.match(/<form\b/gi) || []).length;
    const bookingWidget = /calendly|fresha|booksy|setmore|simplybook|square\.site\/book|typeform|jotform|hsforms|wpforms|contact-form-7|gform_/i.test(html);
    if (!spa) {
      add('contactLinks', 2, call || waLink ? 1 : 0, 'high');
      add('leadCapture', 2, forms || bookingWidget ? 1 : 0, 'medium');
    }

    // Freshness
    const years = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
    const copyrightYear = years.length ? Math.max(...years) : null;
    const thisYear = new Date().getFullYear();
    if (copyrightYear && copyrightYear <= thisYear - 2) add('copyright', 1, 0, 'high', copyrightYear);

    // SEO basics
    const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    add('title', 1, title.length >= 20 && title.length <= 70 ? 1 : title ? 0.5 : 0, 'medium');
    const desc = (metaContent(html, 'description') || '').trim();
    add('description', 1, desc.length >= 50 ? 1 : desc ? 0.5 : 0, 'low');
    if (!spa) {
      const h1 = (html.match(/<h1\b/gi) || []).length;
      add('h1', 1, h1 >= 1 ? 1 : 0, 'low');
      add('thin', 1, words >= 250 ? 1 : words >= 100 ? 0.5 : 0, 'medium', words);
    }
    const imgs = tags(html, 'img');
    const withAlt = imgs.filter((t) => (attr(t, 'alt') || '').trim()).length;
    const altPct = imgs.length ? withAlt / imgs.length : 1;
    add('alt', 1, altPct >= 0.8 ? 1 : altPct >= 0.4 ? 0.5 : 0, 'low', `${imgs.length - withAlt}/${imgs.length}`);
    const og = !!metaContent(html, 'og:image', 'property') || !!metaContent(html, 'og:image');
    add('og', 1, og ? 1 : 0, 'low');
    const icon = tags(head, 'link').some((t) => /icon/i.test(attr(t, 'rel') || ''));
    add('favicon', 0.5, icon ? 1 : 0, 'low');
    const schema = /application\/ld\+json/i.test(html) || /itemtype=["']https?:\/\/schema\.org/i.test(html);
    add('schema', 0.5, schema ? 1 : 0, 'low');

    const w = checks.reduce((a, c) => a + c.weight, 0);
    const score = Math.round((100 * checks.reduce((a, c) => a + c.weight * c.ok, 0)) / w);
    // One speed complaint is enough for a pitch.
    const slowServer = issues.findIndex((i) => i.id === 'ttfb');
    if (slowServer > -1 && issues.some((i) => i.id === 'loadTime')) issues.splice(slowServer, 1);
    issues.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
    return {
      state: 'ok',
      parked: false,
      score,
      grade: score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'weak' : 'poor',
      issues,
      builder,
      words,
      title,
      pixel: hasPixel,
      tagManager,
      spa,
      copyrightYear,
      https: !!finalUrl && finalUrl.protocol === 'https:',
      whatsappButton: waLink,
      contactForm: forms > 0 || bookingWidget,
      mobile: /width\s*=\s*device-width/i.test(viewport),
      ttfb,
      load,
      kb,
      server: headers.server || '',
    };
  };

  LH.auditError = (code, detail) => {
    if (code === 'http') return { state: 'error', score: 0, grade: 'poor', issues: [issue('httpError', 'critical', detail)] };
    const why =
      { dns: 'the domain does not resolve', ssl: 'SSL certificate error', timeout: 'it timed out after 15s', network: 'connection failed' }[code] ||
      'connection failed';
    return { state: 'error', score: 0, grade: 'poor', issues: [issue('unreachable', 'critical', why)] };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
