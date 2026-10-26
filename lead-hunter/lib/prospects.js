/* Lead Hunter: pure helpers for Meta-ads prospects (used by finder.js; unit-tested in node). */
(function (root) {
  const LH = (root.LH = root.LH || {});

  /** Keys that identify the same business across sources (Maps place, Instagram handle, website domain, phone). */
  LH.prospectKeys = (item) => {
    const keys = [];
    if (item.maps && item.maps.placeId) keys.push(`m:${item.maps.placeId}`);
    if (item.instagram && item.instagram.username) keys.push(`i:${item.instagram.username.toLowerCase()}`);
    if (item.website && LH.linkKind(item.website) === 'website') keys.push(`d:${LH.rootDomain(item.website)}`);
    for (const n of [...(item.phones || []), ...(item.whatsapp || [])]) if (n) keys.push(`p:${n}`);
    return keys;
  };

  /**
   * Which of the ads an Ad Library search returned belong to this business.
   * Strong evidence: same website, same Instagram, same phone. A name alone only counts
   * when it is (nearly) the same name: "Skin Lab Dubai" must not match "Skin Lab Pharmacy".
   */
  LH.matchAds = (lead, ads) => {
    const domain = lead.website ? LH.domainOf(lead.website) : '';
    const ig = (((lead.sources || {}).instagram || {}).username || '').toLowerCase();
    const country = (lead.countries || [])[0] || 'AE';
    const digits = (lead.phones || []).map((p) => p.number.replace(/\D/g, '')).filter((d) => d.length >= 9);
    const pages = new Map();
    for (const ad of ads || []) {
      const p = pages.get(ad.pageId) || { pageId: ad.pageId, pageName: ad.pageName, pageUrl: ad.pageUrl, ads: 0, active: 0, list: [], reasons: new Set() };
      p.ads++;
      p.list.push(ad);
      if (ad.active !== false) p.active++;
      const links = (ad.links || []).map((l) => LH.safeUrl(l)).filter(Boolean);
      const caption = String(ad.caption || '').toLowerCase().replace(/^www\./, '');
      if (domain && (links.some((u) => LH.domainOf(u) === domain) || caption === domain)) p.reasons.add('same website');
      if (ig && ((ad.pageUrl || '').toLowerCase().includes(`instagram.com/${ig}`) || (ad.body || '').toLowerCase().includes(`@${ig}`))) p.reasons.add('same Instagram');
      const adDigits = [...links.map((u) => LH.whatsappNumber(u) || ''), ...LH.phonesInText(ad.body || '', country)].map((n) => String(n).replace(/\D/g, ''));
      if (digits.some((d) => adDigits.includes(d))) p.reasons.add('same phone number');
      pages.set(ad.pageId, p);
    }
    const matches = [];
    for (const p of pages.values()) {
      const score = LH.nameMatch(lead.pageName, p.pageName);
      if (score >= 0.85) p.reasons.add('same name');
      if (p.reasons.size) matches.push({ pageId: p.pageId, pageName: p.pageName, pageUrl: p.pageUrl, ads: p.active, total: p.ads, ...LH.adHistory(p.list), reasons: [...p.reasons], score: Math.round(score * 100) / 100 });
    }
    return matches;
  };

  /**
   * What Ad Library ads (live and past) say about a business: how many are live, how many in all, when the
   * newest one started and when the last finished one stopped.
   */
  LH.adHistory = (ads) => {
    let active = 0;
    let total = 0;
    let lastStart = 0;
    let lastEnd = 0;
    for (const a of ads || []) {
      total++;
      if (a.active !== false) active++;
      else lastEnd = Math.max(lastEnd, a.end || a.start || 0);
      lastStart = Math.max(lastStart, a.start || 0);
    }
    return { active, total, lastStart: lastStart || null, lastEnd: lastEnd || null };
  };
  /** Several matched pages as one history. */
  LH.sumHistory = (list) =>
    (list || []).reduce(
      (h, x) => ({ active: h.active + (x.active ?? x.ads ?? 0), total: h.total + (x.total || 0), lastStart: Math.max(h.lastStart || 0, x.lastStart || 0) || null, lastEnd: Math.max(h.lastEnd || 0, x.lastEnd || 0) || null }),
      { active: 0, total: 0, lastStart: null, lastEnd: null },
    );
  /**
   * The ad check verdict from a history: running (live ads now, with the date the newest started) or
   * past (ran ads before, none live, with the date the last one stopped). Null when there were no ads.
   */
  LH.adVerdict = (h) => {
    if (!h || !h.total) return null;
    if (h.active) return { state: 'running', activeAds: h.active, totalAds: h.total, lastAdAt: h.lastStart };
    return { state: 'past', activeAds: 0, totalAds: h.total, lastAdAt: h.lastEnd || h.lastStart };
  };

  /* Meta ad status, in the words of the brief. "likely" is never_ran without proof (their page could not be checked). */
  LH.AD_STATUS = { running: 'active_now', past: 'ran_before_inactive_now', none: 'never_ran', likely: 'never_ran' };
  /** A "no ads" verdict from before 1.8, when only live ads were looked at: it says nothing about past ads. */
  LH.oldAdCheck = (a) => !!a && ['none', 'likely'].includes(a.state) && !a.v && !a.manual;
  /** { status, sure, lastAdAt } for any lead. Facebook advertisers come from their ads, so their ads answer it. */
  LH.adStatus = (lead) => {
    if (!lead) return { status: null, sure: false, lastAdAt: null };
    if (lead.kind !== 'prospect') {
      const v = LH.adVerdict(LH.adHistory(Object.values(lead.ads || {})));
      return v ? { status: LH.AD_STATUS[v.state], sure: true, lastAdAt: v.lastAdAt || null } : { status: null, sure: false, lastAdAt: null };
    }
    const a = lead.adCheck || {};
    if (LH.oldAdCheck(a)) return { status: null, sure: false, lastAdAt: null };
    const status = LH.AD_STATUS[a.state] || null;
    return { status, sure: !!status && a.state !== 'likely', lastAdAt: a.lastAdAt || null };
  };

  /** A Google Places (New) result as a prospect item; closed businesses are dropped. */
  LH.placeToItem = (p, country = 'AE') => {
    if (!p || !p.id || (p.businessStatus && p.businessStatus !== 'OPERATIONAL')) return null;
    const phone = LH.normalizePhone(p.internationalPhoneNumber || p.nationalPhoneNumber || '', country);
    return {
      source: 'maps',
      name: (p.displayName && p.displayName.text) || '',
      category: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
      website: p.websiteUri || '',
      phones: phone ? [phone] : [],
      maps: { placeId: p.id, rating: p.rating ?? null, reviews: p.userRatingCount ?? 0, address: p.formattedAddress || '', mapsUrl: p.googleMapsUri || '' },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
