/* Lead Hunter: who is worth a cold email about a website (pure: background, dashboard and tests).
   A business fits when
     - there is proof it just opened (or is about to) and it has no working website, or
     - its website is down, parked or says "coming soon" (it clearly meant to have one).
   A business that simply never had a website, with no proof it is new, does not fit. Neither does one with a
   working website, however it looks. Proof is never guessed: every signal says where it was seen and what it said. */
(function (root) {
  const LH = (root.LH = root.LH || {});
  const DAY = 86400000;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH = `(${MONTHS.join('|')})[a-z]*\\.?`;
  const COUNT = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

  /* ------------------------------------------------------ Google's own label */
  /**
   * The label Google puts on a new listing: "Recently opened", "Opened 3 weeks ago", "Opened September 2026",
   * "Opening soon", "Opens Wed Nov 12". Google shows it for about 90 days after the opening date the business
   * gave, and lists businesses up to 90 days before they open.
   * Opening HOURS are not it ("Opens 9 AM", "Opens soon ⋅ 10 AM", "Closed ⋅ Opens 9 AM Wed"), nor is a review
   * that happens to use the words (those are in quotes, or long).
   * Returns { kind: 'opened', text, openedAt } or { kind: 'soon', text, opensAt }, null when it is not a label.
   */
  LH.openingLabel = (text, now = Date.now()) => {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
    if (!t || t.length > 40 || /["“”«»]/.test(t)) return null;
    if (/\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(t) || /\bopens soon\b|\bcloses?\b|\bclosed\b|\b24 hours\b/i.test(t)) return null;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    let m = t.match(/^opened (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (day|week|month)s? ago$/i);
    if (m) {
      const n = COUNT[m[1].toLowerCase()] || Number(m[1]);
      return { kind: 'opened', text: cap(m[0]), openedAt: now - n * { day: 1, week: 7, month: 30 }[m[2].toLowerCase()] * DAY };
    }
    m = t.match(new RegExp(`^opened (?:in |on )?${MONTH},? (?:(\\d{1,2}),? )?(\\d{4})$`, 'i'));
    if (m) {
      const at = new Date(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]) || 15).getTime();
      return at > now + DAY ? null : { kind: 'opened', text: cap(m[0]), openedAt: at };
    }
    if (/^recently opened$/i.test(t)) return { kind: 'opened', text: 'Recently opened', openedAt: null };
    if (/^opening soon$/i.test(t)) return { kind: 'soon', text: 'Opening soon', opensAt: null };
    m = t.match(new RegExp(`^opens (?:on )?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,? )?${MONTH} (\\d{1,2})(?:,? (\\d{4}))?$`, 'i'));
    if (m) {
      const month = MONTHS.indexOf(m[1].toLowerCase());
      let at = new Date(Number(m[3]) || new Date(now).getFullYear(), month, Number(m[2])).getTime();
      if (!m[3] && at < now - 30 * DAY) at = new Date(new Date(now).getFullYear() + 1, month, Number(m[2])).getTime();
      return { kind: 'soon', text: cap(m[0]), opensAt: at };
    }
    m = t.match(new RegExp(`^opens (?:in )?${MONTH} (\\d{4})$`, 'i'));
    if (m) return { kind: 'soon', text: cap(m[0]), opensAt: new Date(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase()), 15).getTime() };
    return null;
  };
  /** The first label among the lines of a Maps listing ("Hair salon · Recently opened" counts part by part). */
  LH.openingLabelIn = (lines, now = Date.now()) => {
    for (const line of lines || [])
      for (const part of String(line || '').split(/[·⋅•|]/)) {
        const hit = LH.openingLabel(part, now);
        if (hit) return hit;
      }
    return null;
  };

  /* ------------------------------------------- their own words about opening */
  // What a business says in its own ad, post or bio when it opens. English and Arabic.
  const OPENING = [
    /\bgrand (?:re-?)?opening\b/i,
    /\bsoft (?:opening|launch)\b/i,
    /\bnow open\b(?! for\b)/i,
    /\b(?:newly|just|recently|finally|officially) open(?:ed)?\b/i,
    /\bopening soon\b/i,
    /\bopening (?:day|week|offers?|specials?|discounts?|ceremony|party|celebration)\b/i,
    /\bwe(?:'re| are|’re) (?:now |finally |officially )?open\b(?! (?:for|from|daily|every|24|on|until|till|late|7|all|today|tomorrow|during|this|as)\b)/i,
    /\bwe (?:have |'ve |’ve )?(?:just |finally |officially |now )?opened\b/i,
    /\bdoors are (?:now |finally |officially )?open\b/i,
    /\b(?:our )?new (?:branch|location|outlet)\b/i,
    /\blaunching soon\b/i,
    /\bcoming soon to\b/i,
    /\binaugurat(?:ion|ed|ing)\b/i,
    /الافتتاح الكبير|تم الافتتاح|حفل الافتتاح|افتتحنا|نفتتح|الافتتاح قريبا|قريبا الافتتاح/,
  ];
  /** The opening phrase in a text with a few words around it ("…Grand opening this Friday in JLT…"), '' when none. */
  LH.openingWords = (text) => {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    for (const re of OPENING) {
      const m = t.match(re);
      if (!m) continue;
      const from = Math.max(0, m.index - 30);
      const to = Math.min(t.length, m.index + m[0].length + 60);
      return `${from > 0 ? '…' : ''}${t.slice(from, to).trim()}${to < t.length ? '…' : ''}`;
    }
    return '';
  };

  /* ---------------------------------------------------------------- signals */
  // Proof on its own. A bio that says "now open" is not: bios keep saying it for years.
  const STRONG = ['google', 'soon', 'ad', 'caption', 'newig', 'post'];
  const SAID = { google: 'Google says', soon: 'Google says', ad: 'Their ad says', caption: 'Their Instagram post says', post: 'Their post says', bio: 'Their Instagram bio says' };
  /**
   * Remember one sign that a business just opened: { kind, text, at, openedAt?, opensAt?, url? }.
   * kind: google (the Maps label) · soon (not open yet) · ad · caption · newig (a brand new Instagram) · post · bio.
   * The newest six are kept; the same sign seen again only refreshes its date.
   */
  LH.addOpenSignal = (lead, sig) => {
    if (!lead || !sig || !sig.kind || !sig.text) return lead;
    const clean = { kind: sig.kind, text: String(sig.text).slice(0, 160), at: sig.at || Date.now() };
    for (const k of ['openedAt', 'opensAt', 'url']) if (sig[k]) clean[k] = sig[k];
    lead.openSignals = [...(lead.openSignals || []).filter((s) => !(s.kind === clean.kind && s.text === clean.text)), clean].slice(-6);
    return lead;
  };
  /**
   * Proof that a business just opened or is about to, newest first: { kind, label, text, soon, at, url }, or null.
   * Your tick in the lead panel wins either way (ticked: new, unticked: not new). Other proof counts for
   * Settings > "Counts as just opened for" days after the opening (120 by default).
   */
  LH.opening = (lead, settings = {}, now = Date.now()) => {
    if (!lead) return null;
    if (lead.justOpened === true) return { kind: 'manual', label: 'You ticked Just opened', text: '', soon: false, at: 0, url: '' };
    if (lead.justOpened === false) return null;
    const days = Number(settings.newDays) > 0 ? Number(settings.newDays) : 120;
    let best = null;
    for (const s of lead.openSignals || []) {
      if (!STRONG.includes(s.kind)) continue;
      // When they opened: said outright, else the day it was seen. Google's plain "Recently opened" covers 90 days,
      // so it is counted as the middle of that.
      const ref = s.kind === 'soon' ? Math.max(s.opensAt || 0, s.at || 0) : s.openedAt || (s.kind === 'google' ? (s.at || 0) - 45 * DAY : s.at || 0);
      if (!ref || now - ref > days * DAY) continue;
      if (!best || ref > best.at) best = { kind: s.kind, text: s.text, at: ref, url: s.url || '', soon: s.kind === 'soon' && (!s.opensAt || s.opensAt > now) };
    }
    if (!best) return null;
    return { ...best, label: SAID[best.kind] ? `${SAID[best.kind]} "${best.text}"` : best.text };
  };
  /** A weaker hint worth showing next to the Just opened box (their bio says so), '' when none. */
  LH.openingHint = (lead) => {
    const s = ((lead && lead.openSignals) || []).filter((x) => !STRONG.includes(x.kind)).pop();
    return s ? `${SAID[s.kind] || 'It says'} "${s.text}"` : '';
  };

  /* ----------------------------------------------------------------- website */
  /** Their own website, '' when there is none: never a Facebook, Instagram, link page, WhatsApp or Google Maps address. */
  LH.ownWebsite = (lead) => {
    const u = LH.safeUrl((lead && lead.website) || '');
    return u && LH.linkKind(u) === 'website' ? u.toString() : '';
  };
  /**
   * none     no website of their own            working  it loads and is a real site
   * down     it does not load, or errors        blocked  it refused the automatic check (cannot be judged)
   * parked   a parking, "coming soon" or default page    unknown  not checked yet
   */
  LH.siteState = (lead) => {
    if (!LH.ownWebsite(lead)) return 'none';
    const s = (lead && lead.site) || {};
    if (s.state === 'error') return 'down';
    if (s.state === 'ok') return s.parked ? 'parked' : 'working';
    return s.state === 'blocked' ? 'blocked' : 'unknown';
  };

  /* --------------------------------------------------------------------- fit */
  /**
   * Does this business fit: { fit, kind: 'new' | 'parked' | 'down' | null, why, pending, site, open }.
   * pending: the website check has not finished, so it cannot be said yet.
   */
  LH.fit = (lead, settings = {}, now = Date.now()) => {
    const site = LH.siteState(lead);
    const open = LH.opening(lead, settings, now);
    const out = (fit, kind, why, pending = false) => ({ fit, kind, why, pending, site, open });
    const proof = open ? (open.soon ? 'Opening soon' : 'Just opened') : '';
    switch (site) {
      case 'working':
        return out(false, null, 'They have a working website');
      case 'blocked':
        return out(false, null, 'Their website blocked the check, so it cannot be judged');
      case 'unknown':
        return out(false, null, 'Their website has not been checked yet', true);
      case 'parked':
        return out(true, open ? 'new' : 'parked', open ? `${proof}, and their website is only a placeholder` : 'Their website is parked or says coming soon');
      case 'down':
        return out(true, open ? 'new' : 'down', open ? `${proof}, and their website is down` : 'Their website is down');
      default:
        return open ? out(true, 'new', `${proof}, and they have no website`) : out(false, null, 'No website, but no proof they just opened');
    }
  };

  /**
   * One number to sort by, 0 to 100, with what it is made of. A business that fits and has a confirmed email
   * is hot (60+); one that fits but still needs an email is warm (35+).
   */
  LH.fitScore = (lead, settings = {}, now = Date.now()) => {
    const f = LH.fit(lead, settings, now);
    const parts = [];
    const add = (id, label, points) => parts.push({ id, label, points });
    if (f.open) add('new', f.open.soon ? 'Opening soon' : 'Just opened', 40);
    if (f.site === 'parked') add('parked', 'Website parked or coming soon', 35);
    else if (f.site === 'down') add('down', 'Website down', 30);
    else if (f.site === 'none') add('none', 'No website', 10);
    const mail = LH.sendableEmail(lead, settings);
    if (mail.state === 'ok') add('email', 'Email confirmed', 30);
    else if (mail.state === 'unverified') add('email', 'Email found, mailbox not confirmed', 20);
    else if (mail.state === 'risky' || mail.why === 'waiting' || mail.why === 'risky') add('email', mail.why === 'waiting' ? 'Email found, check not finished' : 'Email could not be confirmed', 8);
    if (LH.whatsappTarget && LH.whatsappTarget(lead)) add('whatsapp', 'Has a WhatsApp number', 5);
    let score = Math.max(0, Math.min(100, parts.reduce((n, p) => n + p.points, 0)));
    if (!f.fit) score = Math.min(score, f.pending ? 30 : 20);
    return { score, parts, fit: f };
  };
  LH.fitClass = (score) => (score >= 60 ? 'hot' : score >= 35 ? 'warm' : 'cold');

  /** Row tags, for reading and filtering. */
  LH.fitTags = (lead, ctx = {}) => {
    if (!lead) return [];
    const f = LH.fit(lead, ctx.settings || {}, ctx.now);
    const tags = [];
    if (ctx.history && lead.status === 'new' && LH.historyHit(lead, ctx.history)) tags.push('Contacted before');
    if (f.open) tags.push(f.open.soon ? 'Opening soon' : 'Just opened');
    tags.push({ none: 'No website', down: 'Site down', parked: 'Parked', working: 'Working website', blocked: 'Site not checkable', unknown: 'Checking website' }[f.site]);
    const info = LH.emailInfo(lead);
    const mail = LH.sendableEmail(lead, ctx.settings || {});
    if (!info.length) tags.push('No email');
    else if (mail.state === 'ok') tags.push('Email confirmed');
    else if (mail.why === 'bad') tags.push('Email failed');
    else if (mail.why === 'risky') tags.push('Email not confirmed');
    else tags.push('Email');
    if (lead.coldEmailExportedAt) tags.push('Exported for cold email');
    return tags;
  };

  /* ---------------------------------------------------------------- Cold email */
  /**
   * Leads for the cold email system (cold-email/ in this repo, running on Samil's Mac). It imports any CSV dropped in
   * its RizcoReach Leads folder, checks every email, website and duplicate again, writes the emails and sends them.
   * Lead Hunter only picks who goes in and says where we saw them; it writes no email text.
   */
  LH.COLD_EMAIL_HEAD = ['business_name', 'first_name', 'email', 'website', 'instagram', 'phone', 'niche', 'area', 'source', 'notes', 'status'];
  // They replied, booked a meeting, signed, said no, or you skipped them: the cold email system leaves them alone.
  const COLD_CLOSED = ['replied', 'meeting', 'won', 'lost', 'skip'];
  // The old email queue (before 2.3) already emailed them. Queued but never sent counts as not emailed.
  const oldQueueSent = (l) => ((l && l.emailQueue) || {}).sent >= 1;
  const oneLine = (v) =>
    String(v == null ? '' : v)
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff\ue000-\uf8ff\ufe00-\ufe0f]|[\u{10000}-\u{10ffff}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  /** Where we actually saw them, for the email's "Just the ___ page": Google Maps, Instagram or Facebook. */
  LH.coldEmailSource = (lead) => {
    const l = lead || {};
    const src = l.sources || {};
    if (l.kind === 'prospect') return !(src.maps || {}).placeId && (src.instagram || {}).username ? 'Instagram' : 'Google Maps';
    // Ad Library: their ads ran on Facebook and Instagram. Instagram only when we know their profile.
    return LH.igHandle(l) ? 'Instagram' : 'Facebook';
  };
  /** Still open for a cold email: not closed, not on Never email, not emailed by the old queue. */
  LH.coldEmailOpen = (lead) => !!lead && !COLD_CLOSED.includes(lead.status) && !lead.doNotEmail && !oldQueueSent(lead);
  /** Worth finding and checking an email for: open, and it fits (or its website check has not finished). */
  LH.coldEmailCandidate = (lead, settings = {}, now = Date.now()) => {
    if (!LH.coldEmailOpen(lead)) return false;
    const f = LH.fit(lead, settings, now);
    return f.fit || f.pending;
  };
  /** Worth opening their Facebook page for an email: a candidate with a page and no usable email yet. */
  LH.wantsFacebookEmail = (lead, settings = {}) => !!lead && !!LH.facebookPageUrl(lead) && !LH.goodEmails(lead)[0] && !(lead.fbEmail && lead.fbEmail.at) && LH.coldEmailCandidate(lead, settings);
  /**
   * The cold email file for these leads: one row per lead that fits and has an address that passed its checks,
   * plus who was left out and why. Leads exported before stay out unless includeExported is set.
   */
  LH.coldEmailExport = (leads, settings = {}, { includeExported = false, now = Date.now() } = {}) => {
    const skipped = { closed: 0, emailedBefore: 0, exported: 0, working: 0, noProof: 0, siteUnknown: 0, noEmail: 0, badEmail: 0, waiting: 0, risky: 0 };
    const rows = [];
    const ids = [];
    const waiting = [];
    for (const l of (leads || []).filter(Boolean)) {
      const f = LH.fit(l, settings, now);
      const mail = LH.sendableEmail(l, settings);
      const why =
        COLD_CLOSED.includes(l.status) || l.doNotEmail
          ? 'closed'
          : oldQueueSent(l)
            ? 'emailedBefore'
            : l.coldEmailExportedAt && !includeExported
              ? 'exported'
              : !f.fit
                ? f.site === 'working'
                  ? 'working'
                  : f.site === 'none'
                    ? 'noProof'
                    : 'siteUnknown'
                : mail.email
                  ? ''
                  : { none: 'noEmail', bad: 'badEmail', waiting: 'waiting', risky: 'risky' }[mail.why];
      if (why) {
        skipped[why]++;
        if (why === 'waiting') waiting.push(l.id);
        continue;
      }
      ids.push(l.id);
      rows.push([
        oneLine(LH.shortName(l.pageName) || LH.igHandle(l) || LH.domainOf(l.website || '')),
        '',
        mail.email,
        LH.ownWebsite(l),
        LH.igHandle(l),
        LH.whatsappTarget(l) || (LH.bestPhone(l) || {}).number || '',
        LH.nicheOf(l, settings) || '',
        oneLine(l.area),
        LH.coldEmailSource(l),
        f.open ? 'new business' : '',
        (LH.STATUSES.find((x) => x.id === l.status) || {}).label || l.status || '',
      ]);
    }
    return { head: LH.COLD_EMAIL_HEAD, rows, ids, skipped, waiting };
  };
  /** "rizcoreach-cold-email-2026-11-08.csv" */
  LH.coldEmailFilename = (date = new Date()) => `rizcoreach-cold-email-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.csv`;
})(typeof globalThis !== 'undefined' ? globalThis : self);
