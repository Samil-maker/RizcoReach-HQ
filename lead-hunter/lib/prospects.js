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
      const p = pages.get(ad.pageId) || { pageId: ad.pageId, pageName: ad.pageName, pageUrl: ad.pageUrl, ads: 0, active: 0, reasons: new Set() };
      p.ads++;
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
      if (p.reasons.size) matches.push({ pageId: p.pageId, pageName: p.pageName, pageUrl: p.pageUrl, ads: p.active, reasons: [...p.reasons], score: Math.round(score * 100) / 100 });
    }
    return matches;
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
