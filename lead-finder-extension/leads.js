/*
 * Shared rules for the Lead Finder: phone numbers, websites, messages and exports.
 * Loaded by the side panel and by the Google Maps content script (as globalThis.LF).
 */
(function (root) {
  'use strict';

  const DEFAULT_MESSAGE =
    "Hi 👋 We came across {name} on Google Maps and noticed there's no website yet. " +
    "We're RizcoReach, a Dubai web design studio. Happy to make you a free homepage mockup, no strings attached. " +
    "Interested? (Reply STOP and we won't message again.)";

  const DEFAULT_SETTINGS = {
    country: 'AE',
    mobileOnly: true,
    socialIsNoWebsite: true,
    message: DEFAULT_MESSAGE,
    contactPrefix: 'Lead -',
    contactLabel: 'RizcoReach Leads',
    dailyLimit: 30,
    openIn: 'web', // 'web' = WhatsApp Web, 'app' = wa.me link (opens the WhatsApp app)
    maxResults: 120,
  };

  const STATUSES = ['New', 'Messaged', 'Replied', 'Interested', 'Not interested', 'Do not contact'];

  // ─── Phone numbers ─────────────────────────────────────────────────────────

  /**
   * cc: country calling code · len: allowed national number lengths ·
   * mobile: national numbers that are mobiles (null = can't tell from the number).
   */
  const PHONE_RULES = {
    AE: { cc: '971', len: [8, 9], mobile: /^5\d{8}$/, name: 'United Arab Emirates' },
    SA: { cc: '966', len: [8, 9], mobile: /^5\d{8}$/, name: 'Saudi Arabia' },
    QA: { cc: '974', len: [8, 8], mobile: /^[3567]\d{7}$/, name: 'Qatar' },
    KW: { cc: '965', len: [8, 8], mobile: /^[4569]\d{7}$/, name: 'Kuwait' },
    BH: { cc: '973', len: [8, 8], mobile: /^(3\d{7}|6[3-9]\d{6})$/, name: 'Bahrain' },
    OM: { cc: '968', len: [8, 8], mobile: /^(7[1-9]\d{6}|9\d{7})$/, name: 'Oman' },
    EG: { cc: '20', len: [8, 10], mobile: /^1[0125]\d{8}$/, name: 'Egypt' },
    JO: { cc: '962', len: [8, 9], mobile: /^7[789]\d{7}$/, name: 'Jordan' },
    LB: { cc: '961', len: [7, 8], mobile: /^(3\d{6}|7[01689]\d{6}|81\d{6})$/, name: 'Lebanon' },
    IN: { cc: '91', len: [10, 10], mobile: /^[6-9]\d{9}$/, name: 'India' },
    PK: { cc: '92', len: [9, 10], mobile: /^3\d{9}$/, name: 'Pakistan' },
    GB: { cc: '44', len: [9, 10], mobile: /^7[1-57-9]\d{8}$/, name: 'United Kingdom' },
    AU: { cc: '61', len: [9, 9], mobile: /^4\d{8}$/, name: 'Australia' },
    US: { cc: '1', len: [10, 10], mobile: null, name: 'United States / Canada' },
  };
  const CALLING_CODES = Object.keys(PHONE_RULES).reduce((m, iso) => {
    m[PHONE_RULES[iso].cc] = iso;
    return m;
  }, {});

  /**
   * Parses a phone number written any common way ("050 123 4567", "+971501234567",
   * "00971 50…", "971501234567", "tel:+97150…") into { e164, type, country }.
   * type is mobile, landline or unknown. Returns null when it can't be a valid number.
   */
  function normalizePhone(raw, defaultCountry) {
    const text = String(raw == null ? '' : raw)
      .replace(/^\s*tel:/i, '')
      .replace(/(?:ext\.?|extension|x)\s*\d+\s*$/i, '')
      .trim();
    let digits = text.replace(/\D/g, '');
    if (!digits) return null;

    let international = text.charAt(0) === '+';
    if (!international && digits.indexOf('00') === 0) {
      digits = digits.slice(2);
      international = true;
    }

    let iso = null;
    let national = '';
    if (international) {
      for (let n = 3; n >= 1 && !iso; n--) {
        if (CALLING_CODES[digits.slice(0, n)]) {
          iso = CALLING_CODES[digits.slice(0, n)];
          national = digits.slice(n);
        }
      }
      if (!iso) return digits.length >= 8 && digits.length <= 15 ? { e164: '+' + digits, type: 'unknown', country: '' } : null;
    } else {
      iso = String(defaultCountry || '').toUpperCase();
      const def = PHONE_RULES[iso];
      if (!def) return null;
      const withoutCc = digits.slice(def.cc.length);
      national = digits.indexOf(def.cc) === 0 && fitsLength(def, withoutCc.replace(/^0+/, '').length) ? withoutCc : digits;
    }

    national = national.replace(/^0+/, ''); // trunk prefix, and "+971 (0)50…"
    const rule = PHONE_RULES[iso];
    if (!fitsLength(rule, national.length)) return null;
    const type = rule.mobile ? (rule.mobile.test(national) ? 'mobile' : 'landline') : 'unknown';
    return { e164: '+' + rule.cc + national, type: type, country: iso };
  }

  function fitsLength(rule, n) {
    return n >= rule.len[0] && n <= rule.len[1];
  }

  /** "050 123 4567 / 04 123 4567" → two numbers. */
  function splitPhones(raw) {
    return String(raw == null ? '' : raw)
      .split(/[,;|\/\n]+|\s+or\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /** First mobile among the numbers (or the first valid number if mobiles-only is off). */
  function pickPhone(phones, s) {
    let fallback = null;
    for (const raw of phones || []) {
      for (const part of splitPhones(raw)) {
        const p = normalizePhone(part, s.country);
        if (!p) continue;
        if (p.type === 'mobile') return p;
        if (!fallback) fallback = p;
      }
    }
    return s.mobileOnly ? null : fallback;
  }

  /** "+971501234567" → "+971 50 123 4567" (also keeps spreadsheets from treating it as a number). */
  function formatPhone(e164) {
    const digits = String(e164 || '').replace(/\D/g, '');
    let cc = '';
    for (let n = 3; n >= 1 && !cc; n--) if (CALLING_CODES[digits.slice(0, n)]) cc = digits.slice(0, n);
    if (!cc) return e164;
    const nat = digits.slice(cc.length);
    const last4 = nat.slice(-4);
    const mid = nat.slice(-7, -4);
    const head = nat.slice(0, -7);
    return '+' + cc + ' ' + [head, mid, last4].filter(Boolean).join(' ');
  }

  // ─── Websites ──────────────────────────────────────────────────────────────

  /** Links that don't count as the business having its own website. */
  const NOT_A_WEBSITE = [
    'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'wa.me', 'whatsapp.com', 'linktr.ee', 'tiktok.com',
    'twitter.com', 'x.com', 'snapchat.com', 'youtube.com', 'youtu.be', 'linkedin.com', 't.me', 'pinterest.com',
    'business.site', 'g.page', 'goo.gl', 'maps.google.com', 'g.co', 'bit.ly', 'beacons.ai', 'taplink.cc', 'linkin.bio',
    'fresha.com', 'booksy.com', 'vagaro.com', 'setmore.com', 'calendly.com', 'talabat.com', 'deliveroo.ae',
    'careemnow.com', 'noon.com', 'zomato.com', 'tripadvisor.com', 'booking.com', 'dubizzle.com', 'yellowpages.ae',
  ];

  function hostOf(url) {
    const m = String(url || '')
      .trim()
      .match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/?#]*@)?([^\/?#:\s]+)/i);
    if (!m || m[1].indexOf('.') < 0) return '';
    return m[1].toLowerCase().replace(/^www\./, '');
  }

  function hasRealWebsite(urls, socialIsNoWebsite) {
    return (urls || []).some((url) => {
      const host = hostOf(url);
      if (!host) return false;
      if (!socialIsNoWebsite) return true;
      return !NOT_A_WEBSITE.some((d) => host === d || host.slice(-(d.length + 1)) === '.' + d);
    });
  }

  // ─── Leads & messages ──────────────────────────────────────────────────────

  function newLead(e164, raw, query) {
    return {
      e164: e164,
      name: String(raw.name || '').trim(),
      category: String(raw.category || '').trim(),
      address: String(raw.address || '').trim(),
      mapsUrl: raw.mapsUrl || '',
      website: raw.website || '',
      query: query || '',
      added: new Date().toISOString(),
      status: 'New',
      contacted: null,
      exported: false,
    };
  }

  /** "Al Noor Salon | Best Ladies Salon in Dubai" → "Al Noor Salon" */
  function cleanName(name) {
    return String(name || '').split('|')[0].replace(/\s+/g, ' ').trim();
  }

  function fillMessage(template, lead) {
    const values = {
      name: cleanName(lead.name) || 'your business',
      category: (lead.category || 'business').toLowerCase(),
      search: lead.query || '',
    };
    return String(template || DEFAULT_MESSAGE)
      .replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? values[key.toLowerCase()] : match))
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function whatsAppUrl(e164, text, openIn) {
    const phone = String(e164).replace(/\D/g, '');
    const t = encodeURIComponent(text || '');
    return openIn === 'app'
      ? 'https://wa.me/' + phone + (text ? '?text=' + t : '')
      : 'https://web.whatsapp.com/send?phone=' + phone + (text ? '&text=' + t : '');
  }

  // ─── Exports ───────────────────────────────────────────────────────────────

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
  }

  function toTsv(rows) {
    return rows.map((r) => r.map((v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  /** Google Contacts "Google CSV" import format. */
  function contactsRows(leads, s) {
    const rows = [['Name', 'Given Name', 'Organization 1 - Name', 'Phone 1 - Type', 'Phone 1 - Value', 'Notes', 'Group Membership']];
    leads.forEach((l) => {
      const display = [s.contactPrefix, cleanName(l.name) || formatPhone(l.e164)].filter(Boolean).join(' ');
      const notes = [l.query ? 'Google Maps search: ' + l.query : 'From Google Maps', l.category, l.address, l.mapsUrl].filter(Boolean).join('\n');
      const groups = s.contactLabel ? s.contactLabel + ' ::: * myContacts' : '* myContacts';
      rows.push([display, display, cleanName(l.name), 'Mobile', l.e164, notes, groups]);
    });
    return rows;
  }

  function sheetRows(leads) {
    const rows = [['Mobile', 'Business', 'Category', 'Address', 'Status', 'Added', 'Last contacted', 'Google Maps', 'Search']];
    leads.forEach((l) => {
      rows.push([
        formatPhone(l.e164),
        l.name,
        l.category,
        l.address,
        l.status,
        (l.added || '').slice(0, 10),
        (l.contacted || '').slice(0, 10),
        l.mapsUrl,
        l.query,
      ]);
    });
    return rows;
  }

  // ─── Storage helpers (extension only) ──────────────────────────────────────

  async function loadSettings() {
    const got = await chrome.storage.local.get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, got.settings || {});
  }

  async function loadLeads() {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all)
      .filter((k) => k.indexOf('lead:') === 0)
      .map((k) => all[k]);
  }

  root.LF = {
    DEFAULT_MESSAGE,
    DEFAULT_SETTINGS,
    STATUSES,
    PHONE_RULES,
    normalizePhone,
    splitPhones,
    pickPhone,
    formatPhone,
    hostOf,
    hasRealWebsite,
    newLead,
    cleanName,
    fillMessage,
    whatsAppUrl,
    toCsv,
    toTsv,
    contactsRows,
    sheetRows,
    loadSettings,
    loadLeads,
  };
})(globalThis);
