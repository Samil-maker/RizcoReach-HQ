/* Lead Hunter: email addresses (pure, no network: used by the background, the dashboard and the tests).
   - finding them in page text without the junk that sticks to them ("%20info@…", "…@x.comCall us")
   - cleaning each one: strict shape, placeholders, the provider misspellings people make on their own pages
   - what the checks said about each address, and which one the cold email file may use
   A bounce hurts the Gmail that sent it, so the rule everywhere is: when in doubt, leave the address out.
   Nothing here ever guesses a mailbox name: only the part after the @ is ever corrected. */
(function (root) {
  const LH = (root.LH = root.LH || {});

  /* ------------------------------------------------------------ placeholders */
  // Addresses website builders put in their templates (GoDaddy's filler@godaddy.com and the like), other
  // placeholders, and the platforms' own addresses. They are never the business's inbox.
  const JUNK_DOMAIN =
    /(^|\.)(example\.(com|org|net)|domain\.(com|ae)|email\.(com|ae)|yourdomain\.\w+|yoursite\.\w+|yourcompany\.\w+|yourbusiness\.\w+|mysite\.com|mydomain\.com|website\.com|company\.com|test\.(com|ae)|sample\.com|name\.com|abc\.com|xyz\.com|sentry\.io|wixpress\.com|wix\.com|godaddy\.com|secureserver\.net|squarespace\.com|weebly\.com|jimdo\.com|shopify\.com|wordpress\.(com|org)|mailchimp\.com|elementor\.com|wpengine\.com|themeforest\.net|envato\.com|bootstrapmade\.com|colorlib\.com|templatemo\.com|w3schools\.com|mailinator\.com|yopmail\.com|guerrillamail\.com|10minutemail\.com|tempmail\.\w+)$/;
  const JUNK_USER =
    /^(filler|name|your|yourname|youremail|your-?email|myemail|you|user|username|email|e-?mail|emailaddress|test|testing|example|sample|someone|somebody|john\.?doe|jane\.?doe|first\.?last|firstname\.?lastname|no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|bounces?|unsubscribe|null|none|xxx+|asdf+)$/;
  const PLATFORM_DOMAIN =
    /(^|\.)(facebook\.com|fb\.com|fbcdn\.net|meta\.com|instagram\.com|cdninstagram\.com|whatsapp\.com|messenger\.com|tiktok\.com|w3\.org|schema\.org|google\.com|gstatic\.com|googleapis\.com|apple\.com|microsoft\.com|cloudflare\.com)$/;
  /** A template placeholder or a file name, not an inbox. (The narrow test: LH.cleanEmail is the full one.) */
  LH.isJunkEmail = (email) => {
    const [user, domain, extra] = String(email || '').trim().toLowerCase().split('@');
    return !user || !domain || extra !== undefined || /\.(png|jpe?g|gif|webp|svg|css|js)$/.test(domain) || JUNK_DOMAIN.test(domain) || JUNK_USER.test(user);
  };

  /* ----------------------------------------------------------------- endings */
  const GTLDS = new Set(
    `com net org info biz co io me app online store shop site xyz tech live club agency studio design digital group global world services solutions company
     business center clinic dental salon cafe restaurant fitness events media marketing pro travel tours realty properties estate auto cars care health beauty
     fashion life today top vip asia cloud dev ai edu gov mil int name mobi tel jobs website space fun art style luxury academy education school training
     consulting legal law finance capital ventures holdings international homes house rent build contractors construction engineering repair cleaning plumbing
     kitchen furniture flowers gift gifts photography photos video film music games sport yoga spa hair skin makeup boutique jewelry coffee pizza bar catering
     delivery express taxi limo flights holiday hotel villas land city town dubai abudhabi africa arab email link click network systems software technology
     support tools works zone plus one ltd llc inc community foundation institute management partners team expert guru page blog news wiki`
      .split(/\s+/)
      .filter(Boolean),
  );
  // Every two letter ending counts as a country (close enough: the domain is looked up before anything is sent).
  const knownTld = (t) => /^[a-z]{2}$/.test(t) || GTLDS.has(t);
  // Endings that do not exist and what the business meant.
  const TLD_TYPOS = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', coom: 'com', cim: 'com', cpm: 'com', comn: 'com', coml: 'com', ccom: 'com', nte: 'net', ogr: 'org', orgg: 'org', aee: 'ae' };
  // Real country endings that, after a big provider's name, are a slip for .com ("gmail.co", "hotmail.cm").
  const PROVIDER_TLD_SLIPS = new Set(['co', 'cm', 'om']);
  const PROVIDERS = ['gmail', 'hotmail', 'yahoo', 'outlook', 'icloud'];
  const NOT_A_TYPO = new Set(['gail']); // one letter from a provider, but a real name

  /** Damerau-Levenshtein distance, capped: 0, 1 or 2 (2 = two or more). */
  function typoDistance(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    return Math.min(2, d[a.length][b.length]);
  }

  /** Gmail only gives out names of 6 to 30 letters, numbers and dots. Anything else cannot exist. */
  function gmailProblem(local) {
    const name = local.split('+')[0];
    if (!/^[a-z0-9.]+$/.test(name)) return 'Gmail addresses only have letters, numbers and dots';
    if (name.length < 6) return 'Gmail addresses have at least 6 characters before the @';
    if (name.replace(/\./g, '').length > 30) return 'Gmail addresses have at most 30 characters before the @';
    return '';
  }

  /**
   * One address, cleaned: { email, fixed } or { bad: why }. `fixed` says what was corrected ("gmial.com → gmail.com").
   * Only the part after the @ is ever corrected, and only when the slip is obvious. A mailbox name is never guessed.
   */
  LH.cleanEmail = (raw) => {
    const bad = (why) => ({ email: '', bad: why });
    let e = String(raw == null ? '' : raw).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    e = e.replace(/^[<("'[\s]+|[>)"'\].,;:\s]+$/g, '');
    const at = e.lastIndexOf('@');
    if (at < 1 || e.indexOf('@') !== at || at === e.length - 1) return bad('Not an email address');
    const local = e.slice(0, at);
    let domain = e.slice(at + 1);
    if (/^u00[0-9a-f]{2}/.test(local)) return bad('Code from the web page is stuck to the front of it');
    if (!/^[a-z0-9][a-z0-9._+-]*$/.test(local)) return bad('Odd characters in it (often left over from a web link)');
    if (/\.\./.test(local) || /[._+-]$/.test(local)) return bad('Dots or dashes in the wrong place');
    if (local.length > 40) return bad('Too long to be a real mailbox');
    if (/^\+?\d{7,}[a-z]/.test(local)) return bad('A phone number is stuck to the front of it');
    if (/^[a-f0-9]{20,}$/.test(local)) return bad('A tracking code, not a mailbox');
    const labels = domain.split('.');
    if (labels.length < 2 || labels.some((l) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l)) || domain.length > 253) return bad('The part after the @ is not a real domain');
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(domain)) return bad('A file name, not an email address');
    let tld = labels[labels.length - 1];
    if (!/^[a-z]{2,24}$/.test(tld)) return bad('The part after the @ is not a real domain');
    const was = domain;
    if (TLD_TYPOS[tld]) tld = labels[labels.length - 1] = TLD_TYPOS[tld];
    // The big mailbox providers, misspelt: "gmial.com", "gmail.co", "hotmai.com", "yaho.com".
    if (labels.length === 2) {
      let name = labels[0];
      if (PROVIDERS.includes(name) && PROVIDER_TLD_SLIPS.has(tld)) tld = labels[1] = 'com';
      if (tld === 'com' && !PROVIDERS.includes(name) && !NOT_A_TYPO.has(name) && name.length >= 4) {
        const meant = PROVIDERS.find((p) => p[0] === name[0] && typoDistance(name, p) === 1);
        if (meant) name = labels[0] = meant;
      }
      if (name === 'gmail' && tld !== 'com') return bad('Gmail addresses end in gmail.com');
    }
    domain = labels.join('.');
    if (JUNK_DOMAIN.test(domain) || JUNK_USER.test(local)) return bad('A placeholder, not a real mailbox');
    if (PLATFORM_DOMAIN.test(domain)) return bad('Belongs to a platform, not to the business');
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      const why = gmailProblem(local);
      if (why) return bad(why);
    }
    return { email: `${local}@${domain}`, fixed: domain !== was ? `${was} → ${domain}` : '' };
  };

  /* ------------------------------------------------------- finding them in text */
  // What often follows an address with no space: the next label or sentence of the page.
  const GLUE_WORDS = /^(call|phone|tel|mob|mobile|whatsapp|website|web|www|email|e-mail|mail|address|location|fax|visit|follow|instagram|facebook|working|timings?|hours|open|contact|for|or|and|po)/;
  const COMMON_TLD = /^(com|net|org|ae|co|info|biz|me|io)$/;

  /** Entities, %XX, \uXXXX and "name [at] domain [dot] com" as plain characters, so nothing sticks to an address. */
  function plainForEmails(text) {
    const chr = (n) => (n > 31 && n < 127 ? String.fromCharCode(n) : ' ');
    return String(text == null ? '' : text)
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => chr(parseInt(h, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_, h) => chr(parseInt(h, 16)))
      .replace(/\\[nrt/]/g, ' ')
      .replace(/&#x([0-9a-f]{1,4});/gi, (_, h) => chr(parseInt(h, 16)))
      .replace(/&#(\d{1,5});/g, (_, n) => chr(Number(n)))
      .replace(/&commat;/gi, '@')
      .replace(/&period;/gi, '.')
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, ' ')
      .replace(/%([0-9a-f]{2})/gi, (_, h) => chr(parseInt(h, 16)))
      .replace(/\s*[[({]\s*(?:at|@)\s*[\])}]\s*/gi, '@')
      .replace(/\s*[[({]\s*(?:dot|\.)\s*[\])}]\s*/gi, '.');
  }

  /** One address as it stood in the text (capitals kept), with whatever was stuck to its end cut off. */
  function trimGlue(found) {
    const at = found.lastIndexOf('@');
    const local = found.slice(0, at);
    let labels = found.slice(at + 1).replace(/-+$/, '').split('.');
    // "info@glow.ae.www.glow.ae": the website followed straight on.
    const www = labels.findIndex((l, i) => i > 1 && l.toLowerCase() === 'www');
    if (www > 0) labels = labels.slice(0, www);
    // "info@glow.ae.We are open" and "info@glow.com.call us": a sentence followed straight on.
    for (;;) {
      const last = labels[labels.length - 1] || '';
      const prev = (labels[labels.length - 2] || '').toLowerCase();
      const sentence = /^[A-Z][a-z]*$/.test(last) && labels.slice(0, -1).join('.') === labels.slice(0, -1).join('.').toLowerCase();
      const word = !knownTld(last.toLowerCase()) && GLUE_WORDS.test(last.toLowerCase());
      if (labels.length > 2 && knownTld(prev) && (sentence || word)) labels.pop();
      else break;
    }
    // "info@glow.comCall us" and "info@glow.aewhatsapp": the next word is stuck to the ending.
    const tld = labels[labels.length - 1] || '';
    if (!knownTld(tld.toLowerCase()))
      for (let i = tld.length - 1; i >= 2; i--) {
        const head = tld.slice(0, i);
        const rest = tld.slice(i);
        const capital = /^[A-Z]/.test(rest) && head === head.toLowerCase();
        if (knownTld(head.toLowerCase()) && (capital || (COMMON_TLD.test(head.toLowerCase()) && GLUE_WORDS.test(rest.toLowerCase())))) {
          labels[labels.length - 1] = head;
          break;
        }
      }
    return `${local}@${labels.join('.')}`;
  }

  /**
   * Every usable address in a piece of page text, cleaned, each one once. Escaped forms count ("info&#64;x.com",
   * "info%40x.com", "info [at] x [dot] com"); junk stuck to an address is cut off or the address is dropped.
   */
  LH.emailsInText = (text, max = 5) => {
    const out = [];
    for (const m of plainForEmails(text).matchAll(/(?<![a-z0-9._+-])[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
      const c = LH.cleanEmail(trimGlue(m[0]));
      if (c.email && !out.includes(c.email)) out.push(c.email);
      if (out.length >= max) break;
    }
    return out;
  };
  /** The same, for a Facebook or Instagram page (at most 3). */
  LH.emailsInPage = (text) => LH.emailsInText(text, 3);

  /* ------------------------------------------------------ what the checks said */
  const FREE_MAIL = new Set(
    `gmail.com googlemail.com hotmail.com outlook.com live.com msn.com yahoo.com ymail.com rocketmail.com icloud.com me.com mac.com aol.com proton.me
     protonmail.com pm.me zoho.com zohomail.com gmx.com mail.com yandex.com emirates.net.ae eim.ae hotmail.co.uk yahoo.co.uk yahoo.co.in yahoo.in live.co.uk outlook.sa`
      .split(/\s+/)
      .filter(Boolean),
  );
  LH.isFreeMail = (email) => FREE_MAIL.has(String(email || '').split('@').pop());

  /**
   * A lead's addresses, best first, each with its state:
   *   ok          a mailbox check confirmed it exists
   *   unverified  the domain receives email, the mailbox itself was not checked
   *   unchecked   nothing checked yet
   *   risky       the check could not confirm it (the domain accepts anything, or did not answer)
   *   bad         broken, a placeholder, bounced before, or the check says it does not exist
   * Checks are stored on the lead as emailCheck[address] = { s: 'ok' | 'dns' | 'risky' | 'bad', why, at }.
   */
  LH.emailInfo = (lead) => {
    const l = lead || {};
    const down = LH.siteState ? ['down', 'parked'].includes(LH.siteState(l)) : false;
    const own = l.website && LH.rootDomain ? LH.rootDomain(l.website) : '';
    const bounced = new Set((l.badEmails || []).map((x) => String(x).toLowerCase()));
    const seen = new Set();
    const out = [];
    (l.emails || []).forEach((raw, i) => {
      const c = LH.cleanEmail(raw);
      const email = c.email || String(raw).trim().toLowerCase();
      if (!email || seen.has(email)) return;
      seen.add(email);
      const chk = (l.emailCheck || {})[email] || {};
      const from = (l.emailFrom || {})[email] || (l.emailFrom || {})[raw] || '';
      let state = { ok: 'ok', risky: 'risky', dns: 'unverified', bad: 'bad' }[chk.s] || 'unchecked';
      let why = chk.why || '';
      if (c.bad) [state, why] = ['bad', c.bad];
      else if (bounced.has(email) || bounced.has(String(raw).toLowerCase())) [state, why] = ['bad', 'It bounced before'];
      // Their own domain is the best address while their site works, and the riskiest once the site is down.
      const domain = email.split('@').pop();
      const kind = own && (domain === own || domain.endsWith(`.${own}`)) ? (down ? 2 : 0) : LH.isFreeMail(email) ? 1 : 3;
      out.push({ email, raw, state, why, fixed: c.fixed || '', from, at: chk.at || 0, order: [{ ok: 0, unverified: 1, unchecked: 2, risky: 3, bad: 9 }[state], kind, i] });
    });
    return out.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]).map(({ order, ...x }) => x);
  };
  /** The addresses worth keeping, best first: cleaned, never one that is broken, bounced or failed a check. */
  LH.goodEmails = (lead) => LH.emailInfo(lead).filter((x) => x.state !== 'bad').map((x) => x.email);

  /**
   * The address the cold email file may use: { email, state }, or { email: '', why }:
   *   none     no address at all            bad     every address is broken or failed its check
   *   waiting  the check has not run yet    risky   the check could not confirm any of them
   * With a mailbox check key in Settings only confirmed mailboxes go out. Without one, the domain must at least
   * receive email. "Also send the ones the check could not confirm" (Settings) lets risky ones through.
   */
  LH.sendableEmail = (lead, settings = {}) => {
    const info = LH.emailInfo(lead);
    const strict = !!settings.verifyKey;
    const by = (s) => info.find((x) => x.state === s);
    const pick = by('ok') || (!strict && by('unverified')) || (settings.emailRisky && by('risky')) || null;
    if (pick) return { email: pick.email, state: pick.state };
    if (!info.length) return { email: '', why: 'none' };
    if (info.every((x) => x.state === 'bad')) return { email: '', why: 'bad' };
    if (by('unchecked') || (strict && by('unverified'))) return { email: '', why: 'waiting' };
    return { email: '', why: 'risky' };
  };
  /** The addresses a check should still look at, best first. Nothing once one is confirmed. */
  LH.emailsToCheck = (lead, settings = {}) => {
    const info = LH.emailInfo(lead);
    if (info.some((x) => x.state === 'ok')) return [];
    return info.filter((x) => x.state === 'unchecked' || (settings.verifyKey && x.state === 'unverified')).slice(0, 3);
  };

  /* --------------------------------------------- reading the checks' answers */
  // Mail servers of domain parking services: the domain "receives email" and nobody ever reads it.
  const PARKED_MX = /(^|\.)(above\.com|sedoparking\.com|parkingcrew\.net|bodis\.com|parklogic\.com|dan\.com|afternic\.com|hugedomains\.com|undeveloped\.com|uniregistry\.com)$|parking|parked/;
  /**
   * Does the domain receive email? From a DNS over HTTPS answer for its MX records (dns.google, cloudflare-dns.com):
   * { s: 'dns' } yes · { s: 'bad', why } no · null when the lookup itself failed (try again later).
   */
  LH.dnsVerdict = (json) => {
    if (!json || typeof json.Status !== 'number') return null;
    if (json.Status === 3) return { s: 'bad', why: 'Its domain does not exist' };
    if (json.Status !== 0) return null;
    const hosts = (json.Answer || []).filter((a) => a && a.type === 15).map((a) => String(a.data || '').trim().split(/\s+/).pop().replace(/\.$/, '').toLowerCase());
    if (!hosts.length || hosts.every((h) => !h)) return { s: 'bad', why: 'Its domain cannot receive email' };
    if (hosts.every((h) => PARKED_MX.test(h))) return { s: 'bad', why: 'Its domain is parked, so nobody reads the email' };
    return { s: 'dns', why: '' };
  };

  // QuickEmailVerification: 100 free mailbox checks a day. Their reasons, in plain words.
  const VERIFY_REASONS = {
    rejected_email: 'The mailbox does not exist',
    invalid_email: 'Not a valid address',
    invalid_domain: 'Its domain does not exist',
    no_mx_record: 'Its domain cannot receive email',
    exceeded_storage: 'The mailbox is full',
    timeout: 'Their mail server did not answer',
    no_connect: 'Their mail server could not be reached',
    unavailable_smtp: 'Their mail server was not available',
    unexpected_error: 'Their mail server gave an odd answer',
    temporarily_blocked: 'Their mail server asked to try later',
  };
  LH.verifyUrl = (email, key, sandbox = false) => `https://api.quickemailverification.com/v1/verify${sandbox ? '/sandbox' : ''}?email=${encodeURIComponent(email)}&apikey=${encodeURIComponent(key || '')}`;
  /**
   * The mailbox check's answer: { s: 'ok' | 'bad' | 'risky', why } for the address, or what stopped the check:
   * { stop, error } the key is wrong · { out, error } today's checks are used up · { retry, wait, error } try later.
   */
  LH.verifyParse = (status, data) => {
    const d = data || {};
    const yes = (v) => v === true || v === 'true';
    const said = d.message ? `: ${String(d.message).slice(0, 120)}` : '';
    if (status === 401 || status === 403) return { stop: true, error: `The email check did not accept your key (${status})${said}` };
    if (status === 402) return { out: true, error: "Today's email checks are used up" };
    if (status === 429) return { retry: true, wait: 60000, error: 'The email check asked to slow down' };
    if (status !== 200 || !d.result) return { retry: true, wait: 5 * 60000, error: `The email check answered ${status}${said}` };
    const result = String(d.result).toLowerCase();
    const reason = VERIFY_REASONS[String(d.reason || '').toLowerCase()] || '';
    const hint = d.did_you_mean ? ` (did they mean ${String(d.did_you_mean).slice(0, 80)}?)` : '';
    if (result === 'invalid') return { s: 'bad', why: `${reason || 'The mailbox does not exist'}${hint}` };
    if (result === 'valid') {
      if (yes(d.disposable)) return { s: 'bad', why: 'A throwaway address' };
      if (yes(d.accept_all)) return { s: 'risky', why: 'Their domain accepts any address, so the mailbox could not be confirmed' };
      return { s: 'ok', why: '' };
    }
    return { s: 'risky', why: `${reason || 'The mailbox could not be confirmed'}${hint}` };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
