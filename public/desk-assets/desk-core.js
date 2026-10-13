/* Lead Desk: shared logic for the desk page (public/desk.html) and its API (netlify/functions/lead-desk.mts).
   Pure functions: no DOM, no network. Classic script that also imports as an ES module for its side effect:
   everything is attached to globalThis.DeskCore. */
(function (root) {
  const D = {};
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const OFFSET = 4 * HOUR; // Dubai is UTC+4 all year (no DST)
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const str = (v) => (v == null ? '' : String(v));

  /* ------------------------------------------------------------ constants */
  D.NICHES = { car: 'Car detailing & PPF', clinic: 'Aesthetic clinic', fitness: 'Fitness studio', ac: 'AC servicing', other: 'Other' };
  D.STEPS = [
    { id: 'first', label: 'First message' },
    { id: 'f1', label: 'Follow-up 1' },
    { id: 'f2', label: 'Last follow-up' },
    { id: 'nudge', label: 'Check in' },
    { id: 'confirm', label: 'Booking confirmation' },
    { id: 'reminder', label: 'Reminder' },
    { id: 'handover', label: 'Send to client' },
  ];
  D.STATUSES = ['new', 'contacted', 'replied', 'booked', 'lost', 'noanswer', 'fake', 'dup'];
  D.CLOSED = ['lost', 'noanswer', 'fake', 'dup'];
  D.SOURCES = ['meta', 'website', 'manual', 'import', 'test'];
  D.TOUCH_KINDS = ['first', 'f1', 'f2', 'nudge', 'confirm', 'reminder', 'handover', 'call', 'other'];
  D.DEFAULT_SETTINGS = {
    myName: '',
    workStart: '09:00',
    workEnd: '21:00',
    followup1Min: 120,
    followup2At: '10:00',
    ntfyUrl: '',
    telegramToken: '',
    telegramChatId: '',
    notifyDetails: true,
  };
  D.DEFAULT_SCRIPTS = {
    first: {
      car: 'Hi {{first_name}} 👋 This is {{my_name}} from the {{client}} bookings team. Thanks for your enquiry about {{service}}!\n\nSo we can give you an exact price, what car is it (make, model and year)? And which day suits you best to bring it in?',
      clinic: 'Hi {{first_name}}, this is {{my_name}} from the {{client}} bookings team 😊 Thank you for your enquiry about {{service}}.\n\nIs this your first time having this treatment? And which day and time would suit you for a consultation?',
      fitness: 'Hi {{first_name}} 👋 This is {{my_name}} from the {{client}} bookings team. Thanks for your interest in {{service}}!\n\nWould you like to book a trial session? Which days and times usually work for you?',
      ac: 'Hi {{first_name}}, this is {{my_name}} from the {{client}} bookings team. Thanks for your enquiry about {{service}}.\n\nIs it an apartment or a villa, and how many AC units? And when would suit you for a visit?',
      other: "Hi {{first_name}}, this is {{my_name}} from the {{client}} bookings team. Thanks for your enquiry about {{service}}!\n\nWhen would be a good time for you? I'll find you a slot.",
    },
    f1: 'Hi {{first_name}}, just checking you saw my message about {{service}} at {{client}}. Happy to find you a time that suits you, even later this week 🙂',
    f2: "Hi {{first_name}}, {{my_name}} from {{client}} again. I don't want to keep messaging, so this is my last one. If you'd still like {{service}}, just reply here and I'll sort out a time for you.",
    nudge: 'Hi {{first_name}}, did you get a chance to think about a day for your {{service}}? I can hold a slot for you at {{client}} this week.',
    confirm: "You're booked ✅\n\n📅 {{booked_time}}\n📍 {{client}}{{location_line}}\n{{maps}}\n\nIf anything changes, just message me here. See you then!",
    reminder: 'Hi {{first_name}}, a quick reminder of your appointment at {{client}} on {{booked_time}}.\n📍 {{maps}}\n\nIf you need to change the time, just reply here.',
    handover: 'New confirmed booking ✅\n\nName: {{name}}\nPhone: {{phone_display}}\nFor: {{service}}\nWhen: {{booked_time}}\n{{answers}}\n{{notes_line}}\nWhatsApp them: {{wa_link}}',
  };
  const SERVICE_FALLBACK = { car: 'detailing', clinic: 'your treatment', fitness: 'a trial session', ac: 'AC servicing', other: 'your enquiry' };

  D.isClosed = (lead) => !!lead && D.CLOSED.includes(lead.status);

  /* --------------------------------------------------------- text helpers */
  // A web link in form text: a scheme, "www." or a bare domain with a common ending.
  const LINK = /[a-z][a-z\d+.-]*:\/\/|\bwww\.|\b[a-z\d-]+\.(?:com|net|org|info|biz|io|co|me|ly|gl|ae|uk|ru|cn|xyz|top|site|online|link|app|shop|store|click|live)\b/i;
  D.hasLink = (s) => LINK.test(str(s));
  /** Drops every word that looks like a link, so untrusted form text never carries one into messages or alerts. */
  D.stripLinks = (s) =>
    str(s)
      .split(/\s+/)
      .filter((w) => w && !LINK.test(w))
      .join(' ');

  D.scriptFor = (step, client) => {
    const custom = client && client.scripts && typeof client.scripts[step] === 'string' ? client.scripts[step] : '';
    if (custom.trim()) return custom;
    if (step === 'first') return D.DEFAULT_SCRIPTS.first[client && own(D.DEFAULT_SCRIPTS.first, client.niche) ? client.niche : 'other'];
    return own(D.DEFAULT_SCRIPTS, step) ? D.DEFAULT_SCRIPTS[step] : '';
  };

  /** First word of a name (links skipped), Title Cased when the whole name is typed in one case. '' when there is no usable name. */
  D.firstName = (name) => {
    const full = D.stripLinks(name);
    const word = (full.split(' ')[0] || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (!word) return '';
    if (full === full.toUpperCase() || full === full.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    return word;
  };

  /** "Ceramic coating" reads "ceramic coating" mid-sentence; PPF, AC, iPhone, HydraFacial and Title Case names stay as typed. */
  const midSentence = (s) => {
    const words = s.split(' ');
    const plain = /^\p{Lu}\p{Ll}+(?:[-'’]\p{Ll}+)*$/u.test(words[0]) && !words.slice(1).some((w) => /^\p{Lu}\p{Ll}/u.test(w));
    return plain ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  };

  D.varsFor = (lead, client, settings, now) => {
    const l = lead || {};
    const c = client || {};
    const s = settings || {};
    const niche = own(SERVICE_FALLBACK, c.niche) ? c.niche : 'other';
    const location = str(c.location).trim();
    const notes = str(l.notes).trim();
    const phone = str(l.phone).replace(/\D/g, '');
    const hour = Math.floor((((Number(now) || 0) + OFFSET) % DAY) / HOUR);
    const service = D.stripLinks(l.service);
    return {
      first_name: D.firstName(l.name) || 'there',
      name: D.stripLinks(l.name) || '(no name)',
      client: str(c.name).trim(),
      my_name: str(s.myName).trim() || 'the team',
      service: service ? midSentence(service) : SERVICE_FALLBACK[niche],
      booked_time: l.bookedFor ? D.fmtBooked(l.bookedFor) : '',
      location,
      location_line: location ? ', ' + location : '',
      maps: str(c.mapsUrl).trim(),
      hours: str(c.hours).trim(),
      phone,
      phone_display: D.fmtPhone(phone),
      email: str(l.email).trim(),
      answers: (Array.isArray(l.answers) ? l.answers : []).filter((x) => x && (x.q || x.a)).map((x) => `• ${str(x.q)}: ${str(x.a)}`).join('\n'),
      notes_line: notes ? 'Notes: ' + notes : '',
      wa_link: phone ? `https://wa.me/${phone}` : '',
      greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening',
    };
  };

  const VAR = /\{\{\s*([\w.-]*)\s*\}\}/g;
  const HAS_TEXT = /[\p{L}\p{N}]/u;
  D.renderScript = (text, vars) => {
    const v = vars || {};
    const value = (k) => (own(v, k) && v[k] != null ? String(v[k]) : '');
    const lines = [];
    for (const line of str(text).replace(/\r\n?/g, '\n').split('\n')) {
      const rendered = line.replace(VAR, (_, k) => value(k));
      const onlyVars = line.replace(VAR, '') !== line && !HAS_TEXT.test(line.replace(VAR, ''));
      // A line like "📍 {{maps}}" disappears when the variable is empty instead of leaving a stray pin.
      if (onlyVars && !HAS_TEXT.test(rendered)) continue;
      lines.push(rendered);
    }
    return lines
      .join('\n')
      .replace(/\{\{+/g, '{')
      .replace(/\}\}+/g, '}')
      .split('\n')
      .map((l) => l.replace(/[ \t\u00a0]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  /* ------------------------------------------------------------ phones */
  D.normPhone = (raw) => {
    const s = str(raw).trim().replace(/^p:\s*/i, '');
    const intl = /^[(\s]*(\+|00)/.test(s);
    let d = s.replace(/\D/g, '').replace(/^00/, '');
    if (/^9710\d{8,9}$/.test(d) || (intl && d.startsWith('9710'))) d = '971' + d.slice(4);
    if (!intl) {
      let m;
      if (/^971\d{9}$/.test(d)) {
        // already international
      } else if ((m = d.match(/^0([2-9]\d{7,8})$/))) d = '971' + m[1];
      else if (/^5\d{8}$/.test(d) || /^[2-9]\d{7}$/.test(d)) d = '971' + d;
    }
    let type;
    if (!d) type = 'none';
    else if (/^9715[024568]\d{7}$/.test(d)) type = 'mobile';
    else if (/^971[234679]\d{7}$/.test(d)) type = 'landline';
    else if (d.startsWith('971')) type = 'invalid';
    else if (d.length >= 8 && d.length <= 15) type = 'foreign';
    else type = 'invalid';
    return { digits: d, type };
  };

  D.fmtPhone = (digits) => {
    const d = str(digits).replace(/\D/g, '');
    if (!d) return '';
    if (/^9715[024568]\d{7}$/.test(d)) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    if (/^971[234679]\d{7}$/.test(d)) return `+971 ${d.slice(3, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    return '+' + d;
  };

  /** Digits for search and de-duplication; partial local input ("050 12") still matches stored numbers. */
  D.phoneKey = (input) => {
    const p = D.normPhone(input);
    if (p.type === 'mobile' || p.type === 'landline') return p.digits;
    const raw = str(input).trim().replace(/^p:\s*/i, '');
    const d = raw.replace(/\D/g, '');
    return /^[(\s]*(\+|00)/.test(raw) ? d.replace(/^00/, '') : d.replace(/^0(?=\d)/, '');
  };

  const JUNK_WORD = /^(test(s|er|ing)?\d*|asdf\w*|qwerty\w*|xx+|abc|na|n\/a|none|fake|null|undefined)$/;
  const FILLER_WORD = /^(lead|user|name|sample|no)$/;
  /** True for names like "test", "asdf", "N/A", "aaa", "Test User", or anything with no letters at all. */
  D.suspiciousName = (name) => {
    const s = str(name).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return false;
    if (!/\p{L}/u.test(s)) return true;
    if (/^(.)\1{2,}$/.test(s.replace(/[\s.]/g, ''))) return true;
    const words = s.split(' ');
    return words.every((w) => JUNK_WORD.test(w) || FILLER_WORD.test(w)) && words.some((w) => JUNK_WORD.test(w));
  };

  D.suspiciousPhone = (digits) => {
    const d = str(digits).replace(/\D/g, '');
    return /(\d)\1{6,}/.test(d) || d.includes('1234567') || d.includes('7654321');
  };

  D.flagsFor = (lead) => {
    const l = lead || {};
    const type = l.phoneType || D.normPhone(l.phone).type;
    const f = [];
    if (type === 'landline') f.push('landline');
    if (type === 'foreign') f.push('foreign');
    if (type === 'none') f.push('no-phone');
    if (type === 'invalid') f.push('invalid-phone');
    if (D.suspiciousName(l.name)) f.push('suspicious-name');
    if (D.hasLink(l.name)) f.push('has-link');
    if (l.phone && D.suspiciousPhone(l.phone)) f.push('suspicious-phone');
    if (l.verified === false) f.push('unverified');
    if (l.source === 'test') f.push('test');
    return f;
  };

  /* ------------------------------------------------------------- intake */
  const normKey = (k) => str(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  const KEYS = {
    name: ['fullname', 'name', 'yourname', 'customername', 'contactname', 'leadname'],
    first: ['firstname'],
    last: ['lastname'],
    phone: ['phonenumber', 'phone', 'mobile', 'mobilenumber', 'mobilephone', 'whatsapp', 'whatsappnumber', 'tel', 'telephone', 'contactnumber', 'number', 'phoneno'],
    email: ['email', 'emailaddress', 'mail', 'youremail'],
    extId: ['id', 'leadid', 'leadgenid'],
    submittedAt: ['createdtime', 'createdat', 'submittedat', 'timestamp', 'date'],
    campaign: ['campaignname'],
    adset: ['adsetname'],
    ad: ['adname'],
    form: ['formname'],
    platform: ['platform'],
    verified: ['phonenumberverified', 'phoneverified'],
  };
  const FIELD_OF = {};
  for (const [field, keys] of Object.entries(KEYS)) for (const k of keys) FIELD_OF[k] = field;
  const IGNORED = new Set(['adid', 'adsetid', 'campaignid', 'formid', 'pageid', 'isorganic', 'leadstatus', 'customdisclaimerresponses', 'inboxurl', 'partnername', 'retailerid']);
  const META_FIELDS = new Set(['extId', 'campaign', 'adset', 'ad', 'form', 'platform', 'verified']);
  // Too vague to be sure of: used only when no more specific key was posted.
  const GENERIC = new Set(['number', 'date']);
  const SERVICE_FIRST = /^(which|what)\b.*(service|treatment|package|are you interested)/i;
  const SERVICE_Q = /service|treatment|interest|looking for|package|which .*(want|need|like)|what .*(need|want|like)/i;
  const MAX_ANSWERS = 15;
  const MAX_ANSWERS_TEXT = 3000;

  /** Form text without control characters (C0/C1); line breaks are kept only when `multiline` is set. */
  const cleanText = (v, multiline) => {
    const s = str(v)
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
    return multiline ? s : s.replace(/\s+/g, ' ');
  };
  const cut = (s, max) => (s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, '') + '…');

  /** At most 15 answers and about 3000 characters in all, so one lead can't bloat the desk. */
  D.capAnswers = (list) => {
    const out = [];
    let left = MAX_ANSWERS_TEXT;
    for (const x of Array.isArray(list) ? list : []) {
      if (out.length >= MAX_ANSWERS || left <= 0) break;
      if (!x) continue;
      const q = cut(str(x.q), left);
      const a = cut(str(x.a), left - q.length);
      out.push({ q, a });
      left -= q.length + a.length;
    }
    return out;
  };

  const phoneType = (c) => D.normPhone(c.value).type;
  /** Which of the values posted for one field is used; the others stay as answers. */
  const pickField = (field, list) => {
    const specific = list.filter((c) => own(FIELD_OF, c.nk) && !GENERIC.has(c.nk));
    const generic = list.filter((c) => GENERIC.has(c.nk));
    if (field === 'phone') {
      const valid = (c) => phoneType(c) !== 'invalid' && phoneType(c) !== 'none';
      return (
        list.find((c) => c.nk.includes('whatsapp') && (phoneType(c) === 'mobile' || phoneType(c) === 'foreign')) ||
        specific.find(valid) ||
        specific[0] ||
        generic.find(valid)
      );
    }
    if (field === 'submittedAt') {
      const parses = (c) => D.parseTime(c.value) != null;
      return specific.length ? specific.find(parses) : generic.find(parses);
    }
    return list[0];
  };

  /** A service needs a real answer: not yes/no/maybe, and at least 3 letters. */
  const usableService = (a) => {
    const letters = str(a).replace(/[^\p{L}]/gu, '');
    return letters.length >= 3 && !/^(yes|no|true|false|maybe)$/i.test(letters);
  };

  D.humanizeKey = (key) => {
    const s = str(key).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/\?{2,}$/, '?');
    return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 120);
  };
  D.humanizeValue = (value) => {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    const s = str(value).trim();
    return (/^[a-z0-9_]+$/i.test(s) && s.includes('_') ? s.replace(/_/g, ' ') : s).slice(0, 500);
  };

  /** Epoch ms from ISO strings, "YYYY-MM-DD HH:mm(:ss)" (taken as Dubai time), unix seconds or ms. */
  D.parseTime = (v) => {
    let ms = NaN;
    if (typeof v === 'number') ms = v > 1e12 ? v : v * 1000;
    else if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{9,13}$/.test(s)) ms = s.length > 11 ? Number(s) : Number(s) * 1000;
      else {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (m) ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - OFFSET;
        else if (s) ms = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      }
    }
    return Number.isFinite(ms) && ms > 946684800000 && ms < 4102444800000 ? Math.round(ms) : null;
  };

  const httpsUrl = (v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && v.length <= 500 ? u.href : '';
    } catch {
      return '';
    }
  };
  D.httpsUrl = httpsUrl;
  const scalar = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

  D.mapIntake = (input) => {
    const out = {
      name: '',
      phone: '',
      email: '',
      answers: [],
      extId: '',
      submittedAt: null,
      ad: { campaign: '', adset: '', ad: '', form: '', platform: '' },
      verified: null,
      service: '',
      source: '',
      honeypot: false,
      redirect: '',
      test: false,
      flags: [],
    };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    const entries = [];
    let meta = false;
    for (const [k, value] of Object.entries(input)) {
      let v = value;
      if (k === 'field_data' && typeof v === 'string' && v.trim().startsWith('[')) {
        try {
          v = JSON.parse(v);
        } catch {
          // not JSON: kept as an answer below
        }
      }
      if (k === 'field_data' && Array.isArray(v)) {
        meta = true;
        for (const f of v) {
          if (!f || typeof f !== 'object' || typeof f.name !== 'string') continue;
          const vals = Array.isArray(f.values) ? f.values.filter(scalar) : scalar(f.value) ? [f.value] : [];
          entries.push([f.name, vals.map(str).join(', ')]);
        }
      } else entries.push([k, v]);
    }
    const rows = []; // everything posted, in order; the values not used for a field become answers
    const cands = {};
    let sourceIn = '';
    for (const [rawKey, raw] of entries) {
      if (!scalar(raw)) continue;
      const key = cleanText(rawKey).trim();
      const value = typeof raw === 'string' ? cleanText(raw, true).trim() : raw;
      if (key.startsWith('_')) {
        const c = key.toLowerCase();
        const v = cleanText(value).trim();
        if (c === '_gotcha' || c === '_hp' || c === '_honey') out.honeypot = out.honeypot || (raw !== false && v !== '');
        else if (c === '_redirect') out.redirect = httpsUrl(v) || out.redirect;
        else if (c === '_source') sourceIn = v.toLowerCase();
        else if (c === '_service') out.service = v.slice(0, 120);
        else if (c === '_test') out.test = value === true || v.toLowerCase() === 'true';
        continue;
      }
      if (value === '') continue;
      const nk = normKey(key);
      if (IGNORED.has(nk)) continue;
      // Any "WhatsApp ..." question may hold the number to message.
      const field = own(FIELD_OF, nk) ? FIELD_OF[nk] : nk.includes('whatsapp') ? 'phone' : null;
      const row = { key, nk, value, used: false };
      rows.push(row);
      if (!field) continue;
      if (META_FIELDS.has(field)) meta = true;
      if (!own(cands, field)) cands[field] = [];
      cands[field].push(row);
    }
    const found = {};
    for (const field of Object.keys(cands)) {
      const row = pickField(field, cands[field]);
      if (!row) continue;
      row.used = true;
      found[field] = row.value;
    }
    out.answers = D.capAnswers(rows.filter((r) => !r.used).map((r) => ({ q: D.humanizeKey(r.key), a: D.humanizeValue(r.value) })));
    const text = (f, max) => (own(found, f) ? cleanText(found[f]).trim().slice(0, max) : '');
    out.name = (text('name', 120) || [text('first', 60), text('last', 60)].filter(Boolean).join(' ')).slice(0, 120);
    out.phone = text('phone', 40);
    out.email = text('email', 160);
    out.extId = text('extId', 80).replace(/^[a-z]{1,3}:/i, ''); // Meta's CSV export writes ids as "l:123..."
    out.submittedAt = own(found, 'submittedAt') ? D.parseTime(found.submittedAt) : null;
    for (const f of ['campaign', 'adset', 'ad', 'form', 'platform']) out.ad[f] = text(f, 200);
    if (own(found, 'verified')) {
      const v = str(found.verified).toLowerCase();
      out.verified = v === 'true' ? true : v === 'false' ? false : null;
    }
    if (!out.service) {
      const usable = out.answers.filter((x) => usableService(x.a));
      const a = usable.find((x) => SERVICE_FIRST.test(x.q)) || usable.find((x) => SERVICE_Q.test(x.q));
      if (a) out.service = cleanText(a.a).trim().slice(0, 120);
    }
    // A link in the name or service is spam or a trick: flag it, and keep it out of the service used in messages.
    if (D.hasLink(out.name) || D.hasLink(out.service)) out.flags.push('has-link');
    if (D.hasLink(out.service)) out.service = '';
    out.source = D.SOURCES.includes(sourceIn) ? sourceIn : meta ? 'meta' : 'website';
    return out;
  };

  /** RFC 4180-ish CSV/TSV parser: quotes, "" escapes, CRLF, BOM. Returns one object per row, keyed by header. */
  D.parseCsv = (text) => {
    const s = str(text).replace(/^\uFEFF/, '');
    const firstLine = s.slice(0, s.search(/\r?\n/) > -1 ? s.search(/\r?\n/) : s.length);
    const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === sep) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const data = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (!data.length) return [];
    const seen = {};
    const header = data[0].map((h) => {
      let k = h.trim();
      if (own(seen, k)) k = `${k} ${++seen[k]}`;
      else seen[k] = 1;
      return k;
    });
    return data.slice(1).map((r) => {
      const o = {};
      header.forEach((h, i) => {
        if (h) o[h] = r[i] == null ? '' : r[i];
      });
      return o;
    });
  };

  D.decodeBytes = (bytes) => {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b.length >= 4 && b[0] && !b[1] && b[2] && !b[3]) return new TextDecoder('utf-16le').decode(b);
    return new TextDecoder('utf-8').decode(b);
  };

  /* --------------------------------------------------------- Dubai time */
  const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  const hm = (s, fallback) => {
    const m = str(s).match(/^(\d{1,2}):(\d{2})$/);
    return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : fallback;
  };
  const dayStart = (ts) => Math.floor((ts + OFFSET) / DAY) * DAY - OFFSET;

  D.dubaiLocal = (ts) => new Date(ts + OFFSET).toISOString().slice(0, 16);
  /** Epoch ms for a Dubai wall-clock 'YYYY-MM-DDTHH:mm', or NaN when it isn't a real date and time. */
  D.fromDubaiLocal = (s) => {
    const m = str(s).match(LOCAL_RE);
    if (!m || +m[1] < 1970) return NaN;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return new Date(ms).toISOString().slice(0, 16) === s ? ms - OFFSET : NaN;
  };
  D.dubaiLocalValid = (s) => Number.isFinite(D.fromDubaiLocal(s));

  let dateFmt;
  D.fmtBooked = (s) => {
    const ms = D.fromDubaiLocal(s);
    if (!Number.isFinite(ms)) return '';
    dateFmt = dateFmt || new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'short' });
    return `${dateFmt.format(ms)}, ${D.fmtClock(ms)}`;
  };
  /** "3:40 pm" in Dubai time. */
  D.fmtClock = (ts) => {
    const local = D.dubaiLocal(ts);
    const h = +local.slice(11, 13);
    return `${h % 12 || 12}:${local.slice(14, 16)} ${h < 12 ? 'am' : 'pm'}`;
  };

  D.deferToHours = (ts, settings) => {
    const s = settings || {};
    const start = hm(s.workStart, 540);
    const end = hm(s.workEnd, 1260);
    if (end <= start) return ts;
    const day = dayStart(ts);
    const m = (ts - day) / MIN;
    if (m < start) return day + start * MIN;
    if (m >= end) return day + DAY + start * MIN;
    return ts;
  };

  D.atLocalTime = (dayTs, time) => dayStart(dayTs) + hm(time, 0) * MIN;

  /* ----------------------------------------------------- workflow logic */
  const touchesOf = (lead) => (Array.isArray(lead.touches) ? lead.touches : []);
  const lastTouch = (lead, k, since = -Infinity) => touchesOf(lead).reduce((acc, t) => (t && t.k === k && t.at >= since && (acc == null || t.at > acc) ? t.at : acc), null);
  const touchedSince = (lead, k, since) => touchesOf(lead).some((t) => t && t.k === k && t.at >= since);

  D.nextAction = (lead, settings, now) => {
    if (!lead || D.isClosed(lead)) return null;
    const s = { ...D.DEFAULT_SETTINGS, ...(settings || {}) };
    const defer = (ts) => D.deferToHours(ts, s);
    const fallback = lead.updatedAt || lead.createdAt || now;
    switch (lead.status) {
      case 'new':
        return { kind: 'first', due: defer(lead.createdAt || now), label: 'Send first message' };
      case 'contacted': {
        // A reopened lead starts over from its latest first message (firstTouchAt stays the earliest, for reports).
        const first = lastTouch(lead, 'first');
        const since = first != null ? first : -Infinity;
        const f2 = lastTouch(lead, 'f2', since);
        if (f2 != null) return { kind: 'close', due: defer(f2 + DAY), label: 'Call or close' };
        const f1 = lastTouch(lead, 'f1', since);
        if (f1 != null) return { kind: 'f2', due: defer(D.atLocalTime(f1 + DAY, s.followup2At)), label: 'Last follow-up' };
        const mins = Number(s.followup1Min) > 0 ? Number(s.followup1Min) : 120;
        return { kind: 'f1', due: defer((first != null ? first : lead.firstTouchAt || fallback) + mins * MIN), label: 'Follow-up 1' };
      }
      case 'replied': {
        const since = lead.repliedAt || fallback;
        if (touchedSince(lead, 'nudge', since)) return null;
        return { kind: 'nudge', due: defer(since + DAY), label: 'Check in' };
      }
      case 'booked': {
        if (lead.outcome) return null;
        const bookedAt = lead.bookedAt || fallback;
        const appt = D.fromDubaiLocal(lead.bookedFor);
        if (!touchedSince(lead, 'confirm', bookedAt)) return { kind: 'confirm', due: bookedAt, label: 'Send booking confirmation' };
        // A changed booking (new bookedAt) goes to the client again.
        if (!lead.handedAt || lead.handedAt < bookedAt) return { kind: 'handover', due: bookedAt, label: 'Send to {client}' };
        if (Number.isFinite(appt) && !touchedSince(lead, 'reminder', bookedAt)) {
          // The evening before, but only when that is at least 2 hours after the booking was made and still before the appointment.
          const due = defer(D.atLocalTime(appt - DAY, '17:00'));
          if (due >= bookedAt + 2 * HOUR && due < appt) return { kind: 'reminder', due, label: 'Send reminder' };
        }
        return { kind: 'outcome', due: Number.isFinite(appt) ? appt + 2 * HOUR : bookedAt, label: 'Did they show up?' };
      }
    }
    return null;
  };

  const LIMITS = { name: 120, email: 160, notes: 2000, service: 120, lostReason: 200 };

  /** Shared reducer: returns a new lead with `upd` applied (server and page optimistic updates). */
  D.applyUpdate = (lead, upd, now) => {
    const l = { ...lead, touches: touchesOf(lead).map((t) => ({ ...t })), flags: Array.isArray(lead.flags) ? [...lead.flags] : [] };
    const u = upd && typeof upd === 'object' ? upd : {};
    const at = typeof u.at === 'number' && Number.isFinite(u.at) && Math.abs(u.at - now) <= 36 * HOUR ? u.at : now;

    const kind = u.touch === 'close' ? 'call' : u.touch;
    if (typeof kind === 'string' && D.TOUCH_KINDS.includes(kind)) {
      l.touches.push({ k: kind, at });
      if (l.touches.length > 40) l.touches = l.touches.slice(-40);
      if (kind === 'first') {
        if (l.firstTouchAt == null) l.firstTouchAt = at;
        if (l.status === 'new') l.status = 'contacted';
      }
      if (kind === 'handover') l.handedAt = at;
    }

    if (typeof u.untouch === 'number') {
      const i = l.touches.findIndex((t) => t.at === u.untouch);
      if (i > -1) {
        l.touches.splice(i, 1);
        const firsts = l.touches.filter((t) => t.k === 'first').map((t) => t.at);
        const handovers = l.touches.filter((t) => t.k === 'handover').map((t) => t.at);
        l.firstTouchAt = firsts.length ? Math.min(...firsts) : null;
        l.handedAt = handovers.length ? Math.max(...handovers) : null;
        if (!firsts.length && l.status === 'contacted') l.status = 'new';
      }
    }

    const s = u.set && typeof u.set === 'object' ? u.set : null;
    if (s) {
      let touchedContact = false;
      for (const [k, max] of Object.entries(LIMITS)) {
        if (typeof s[k] === 'string') {
          l[k] = s[k].trim().slice(0, max);
          if (k === 'name') touchedContact = true;
        }
      }
      if (own(s, 'phone') && (typeof s.phone === 'string' || typeof s.phone === 'number')) {
        const p = D.normPhone(s.phone);
        l.phone = p.digits;
        l.phoneType = p.type;
        touchedContact = true;
      }

      let booked = l.bookedFor || '';
      if (typeof s.bookedFor === 'string' && (s.bookedFor === '' || D.dubaiLocalValid(s.bookedFor))) booked = s.bookedFor;
      let status = D.STATUSES.includes(s.status) ? s.status : null;
      if ((status || l.status) === 'booked' && !D.dubaiLocalValid(booked)) {
        // A booking needs a valid time: ignore the change rather than leave a booked lead without one.
        if (status === 'booked' && l.status !== 'booked') status = null;
        booked = l.bookedFor || '';
      }
      const bookedChanged = booked !== (l.bookedFor || '');
      if (bookedChanged && l.status === 'booked' && !status) status = 'booked';
      if (status === 'booked' && (l.status !== 'booked' || bookedChanged)) {
        l.bookedAt = at;
        if (bookedChanged) {
          l.outcome = null;
          l.outcomeAt = null;
        }
      }
      l.bookedFor = booked;
      if (status) {
        // Each new reply (e.g. after a reopen) restarts the check-in timer.
        if (status === 'replied' && l.status !== 'replied') l.repliedAt = at;
        l.status = status;
        if (status === 'contacted' && l.firstTouchAt == null) l.firstTouchAt = at;
        l.closedAt = D.CLOSED.includes(status) ? at : null;
      }

      if (own(s, 'outcome')) {
        if (s.outcome === 'showed' || s.outcome === 'noshow') {
          l.outcome = s.outcome;
          l.outcomeAt = at;
        } else if (s.outcome === null || s.outcome === '') {
          l.outcome = null;
          l.outcomeAt = null;
        }
      }
      if (touchedContact) l.flags = D.flagsFor(l);
    }

    l.updatedAt = now;
    return l;
  };

  D.stage = (lead, settings, now) => {
    if (D.isClosed(lead)) return 'closed';
    const a = D.nextAction(lead, settings, now);
    if (a && a.due <= now) return 'todo';
    if (lead.status === 'replied') return 'chatting';
    if (lead.status === 'booked') return 'booked';
    return 'waiting';
  };

  /* ---------------------------------------------------- reports & links */
  D.report = (leads, opts, settings) => {
    const o = opts || {};
    const from = typeof o.from === 'number' ? o.from : -Infinity;
    const to = typeof o.to === 'number' ? o.to : Infinity;
    const all = (Array.isArray(leads) ? leads : []).filter(
      (l) => l && (!o.clientId || l.clientId === o.clientId) && l.createdAt >= from && l.createdAt < to && l.source !== 'test',
    );
    const real = all.filter((l) => l.status !== 'dup');
    const count = (fn) => real.filter(fn).length;
    const contacted = real.filter((l) => l.firstTouchAt != null);
    const mins = contacted
      .map((l) => Math.max(0, (l.firstTouchAt - D.deferToHours(l.createdAt, settings)) / MIN))
      .sort((a, b) => a - b);
    const mid = mins.length >> 1;
    const median = !mins.length ? null : Math.round(mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2);
    return {
      received: real.length,
      fake: count((l) => l.status === 'fake'),
      dup: all.length - real.length,
      contacted: contacted.length,
      medianReplyMin: median,
      replied: count((l) => l.repliedAt != null || l.status === 'replied' || l.status === 'booked'),
      booked: count((l) => l.status === 'booked' || l.bookedAt != null),
      showed: count((l) => l.outcome === 'showed'),
      noshow: count((l) => l.outcome === 'noshow'),
      lost: count((l) => l.status === 'lost'),
      noanswer: count((l) => l.status === 'noanswer'),
      open: count((l) => l.status === 'new' || l.status === 'contacted' || l.status === 'replied'),
    };
  };

  const minutesText = (m) => (m < 1 ? 'under 1 min' : m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
  D.reportText = (clientName, stats, fromLabel, toLabel) => {
    const s = stats || {};
    const n = (k) => Number(s[k]) || 0;
    const range = [fromLabel, toLabel].filter(Boolean).join('–');
    const head = [str(clientName).trim(), range].filter(Boolean).join(' · ');
    const lines = [head, ''];
    lines.push(`${n('received')} ${n('received') === 1 ? 'lead' : 'leads'} from your ads`);
    lines.push(`${n('replied')} replied${n('received') ? ` (${Math.round((n('replied') / n('received')) * 100)}%)` : ''}`);
    lines.push(`${n('booked')} booked`);
    if (n('showed') + n('noshow') > 0) lines.push(`${n('showed')} showed up`);
    const extra = [];
    if (s.medianReplyMin != null && Number.isFinite(Number(s.medianReplyMin))) extra.push(`Median time to first reply: ${minutesText(Math.round(Number(s.medianReplyMin)))}`);
    const closed = [['Not interested', 'lost'], ['No answer', 'noanswer'], ['Wrong numbers', 'fake']].filter(([, k]) => n(k) > 0).map(([label, k]) => `${label}: ${n(k)}`);
    if (closed.length) extra.push(closed.join(' · '));
    if (extra.length) lines.push('', ...extra);
    return lines.join('\n').trim();
  };

  /** Lone surrogates (e.g. half an emoji) make encodeURIComponent throw; swap them for U+FFFD. */
  const wellFormed = (t) => {
    if (typeof t.toWellFormed === 'function') return t.toWellFormed();
    let out = '';
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && (t.charCodeAt(i + 1) & 0xfc00) === 0xdc00) out += t[i] + t[++i];
      else out += c >= 0xd800 && c <= 0xdfff ? '\ufffd' : t[i];
    }
    return out;
  };
  D.waUrl = (digits, text, mode) => {
    const d = str(digits).replace(/\D/g, '');
    const t = text ? encodeURIComponent(wellFormed(String(text))) : '';
    if (mode === 'web') return `https://web.whatsapp.com/send?phone=${d}${t ? `&text=${t}` : ''}`;
    return `https://wa.me/${d}${t ? `?text=${t}` : ''}`;
  };

  /** CSV from an array of arrays (first row = header) or of objects (keys of the first object = header). */
  D.toCsv = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    let table = list;
    if (list.length && !Array.isArray(list[0])) {
      const keys = Object.keys(list[0] || {});
      table = [keys, ...list.map((r) => keys.map((k) => (r ? r[k] : '')))];
    }
    const cell = (v) => {
      let s = str(v);
      // Stop spreadsheet apps from running a cell that came from a public form as a formula (plain numbers and phones stay as they are).
      if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = "'" + s;
      return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return table.map((r) => (Array.isArray(r) ? r : []).map(cell).join(',')).join('\r\n') + (table.length ? '\r\n' : '');
  };

  D.uid = (prefix) => {
    const p = prefix ? str(prefix).replace(/_?$/, '_') : '';
    let rand = '';
    const c = root.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const b = c.getRandomValues(new Uint8Array(4));
      for (const x of b) rand += (x % 36).toString(36);
    } else for (let i = 0; i < 4; i++) rand += Math.floor(Math.random() * 36).toString(36);
    return p + Date.now().toString(36) + rand;
  };

  root.DeskCore = D;
})(typeof globalThis !== 'undefined' ? globalThis : self);
