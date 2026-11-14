/* Lead Hunter: pure helpers for businesses found on Google Maps and Instagram (used by finder.js; unit-tested in node). */
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

  /* ------------------------------------------------------------ Google search */
  // Sites that are never a small business's own website: directories, marketplaces, social networks, news, maps.
  const NOT_A_BUSINESS = /(^|\.)(google\.[a-z.]+|youtube\.com|facebook\.com|fb\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.[a-z.]+|snapchat\.com|threads\.net|wikipedia\.org|reddit\.com|quora\.com|yelp\.[a-z.]+|tripadvisor\.[a-z.]+|foursquare\.com|yellowpages[-a-z]*\.[a-z.]+|connect\.ae|dubaibizdirectory\.com|dubai-online\.com|bayut\.com|propertyfinder\.ae|dubizzle\.com|zomato\.com|talabat\.com|deliveroo\.[a-z.]+|careem\.com|noon\.com|amazon\.[a-z.]+|booking\.com|agoda\.com|expedia\.[a-z.]+|fresha\.com|treatwell\.[a-z.]+|vagaro\.com|booksy\.com|servicemarket\.com|justlife\.com|gulfnews\.com|khaleejtimes\.com|thenationalnews\.com|timeoutdubai\.com|whatson\.ae|lovindubai\.com|gov\.ae|dubai\.ae|apple\.com|waze\.com|wa\.me|whatsapp\.com|linktr\.ee|indeed\.com|bayt\.com|glassdoor\.[a-z.]+|naukrigulf\.com|justdial\.com|cylex[-a-z]*\.[a-z.]+|hotfrog\.[a-z.]+|2gis\.[a-z.]+|uae-business[-a-z]*\.[a-z.]+|helloworld[-a-z]*\.[a-z.]+)$/i;
  LH.notABusinessSite = (host) => NOT_A_BUSINESS.test(String(host || '').toLowerCase().replace(/^www\./, ''));
  /** "Bloom Beauty Lounge (@bloombeautydxb) • Instagram photos and videos" -> "Bloom Beauty Lounge". */
  LH.igNameFromTitle = (title, handle = '') => {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.*?)\s*\(@[A-Za-z0-9._]+\)/);
    const name = (m ? m[1] : t.split(/\s+[•|·–-]\s+/)[0]).replace(/\s*on Instagram.*$/i, '').trim();
    return /^instagram$/i.test(name) || !name ? handle : name;
  };
  /** A website result's business name: the title before " | " or " - ", unless the page is a list ("Top 10 salons…"). */
  LH.webNameFromTitle = (title) => {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t || /^(top|best|the best|\d+|list of|how to|why|what|where|near me)\b/i.test(t) || /\bnear me\b|\btop \d+|\b\d+ best\b/i.test(t)) return '';
    const name = t.split(/\s+[|–—-]\s+|\s*\|\s*|:\s+/)[0].trim();
    return name.length >= 3 && name.length <= 80 && !/^(home|homepage|welcome|contact us|about us)$/i.test(name) ? name : '';
  };
  /**
   * What a Google results page says, as businesses to add: Instagram profiles (with the email and phone in the bio
   * Google shows) and, for a business search, websites of businesses (never directories, news or social sites).
   * results: [{ url, title, text }] from content/google.js. kind: 'web' or 'ig'.
   */
  LH.googleItems = (results, kind = 'web', country = 'AE') => {
    const out = [];
    const seen = new Set();
    for (const r of results || []) {
      const u = LH.safeUrl(r && r.url);
      if (!u) continue;
      const text = String(r.text || '').slice(0, 1200);
      const handle = LH.igFromUrl(u);
      if (handle) {
        if (seen.has(`i:${handle.toLowerCase()}`)) continue;
        seen.add(`i:${handle.toLowerCase()}`);
        const emails = LH.emailsInText(text, 3);
        const name = LH.igNameFromTitle(r.title, handle);
        out.push({ name, source: 'google', instagram: { username: handle, fullName: name, bio: text.slice(0, 600) }, emails, emailFrom: Object.fromEntries(emails.map((e) => [e, 'instagram'])), phones: LH.phonesInText(text, country).slice(0, 2), google: { url: u.toString(), title: String(r.title || '').slice(0, 200) } });
        continue;
      }
      if (kind !== 'web' || LH.linkKind(u) !== 'website' || LH.notABusinessSite(u.hostname)) continue;
      const name = LH.webNameFromTitle(r.title);
      const domain = LH.rootDomain(u.toString());
      if (!name || seen.has(`d:${domain}`)) continue;
      seen.add(`d:${domain}`);
      // Only an email at their own domain is theirs: a snippet can quote anyone.
      const emails = LH.emailsInText(text, 3).filter((e) => LH.rootDomain(`https://${e.split('@').pop()}/`) === domain);
      out.push({ name, source: 'google', website: `${u.protocol}//${u.hostname}/`, emails, emailFrom: Object.fromEntries(emails.map((e) => [e, 'google'])), phones: LH.phonesInText(text, country).slice(0, 2), google: { url: u.toString(), title: String(r.title || '').slice(0, 200) } });
    }
    return out;
  };
  /** The Instagram result that is this business: the name matches, or the handle spells it. */
  LH.pickInstagram = (results, name) => {
    const want = LH.normName(name).replace(/[^a-z0-9]/g, '');
    for (const r of results || []) {
      const handle = LH.igFromUrl(LH.safeUrl(r && r.url));
      if (!handle) continue;
      const title = LH.igNameFromTitle(r.title, handle);
      const flat = handle.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (LH.nameMatch(title, name) >= 0.85 || (want.length >= 6 && flat.includes(want))) return { handle, title, text: String(r.text || '').slice(0, 600) };
    }
    return null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
