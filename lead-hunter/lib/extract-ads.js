/* Lead Hunter: pulls ad records out of Ad Library JSON (the GraphQL responses and
   the first page of results embedded in the HTML). Walks any JSON shape and keeps
   objects that carry an `ad_archive_id`, so it survives Meta reshuffling fields. */
(function (root) {
  const LH = (root.LH = root.LH || {});

  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const toMs = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (/^\d+$/.test(v)) return toMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  };
  const textOf = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v.text === 'string') return v.text;
    if (v.markup && typeof v.markup.__html === 'string') return v.markup.__html.replace(/<[^>]+>/g, ' ');
    return '';
  };

  function normalize(raw) {
    const snap = raw.snapshot || {};
    const cards = Array.isArray(snap.cards) ? snap.cards : [];
    const id = str(raw.ad_archive_id);
    const pageId = str(raw.page_id || snap.page_id);
    if (!id || !pageId) return null;

    const links = new Set();
    const push = (u) => {
      const v = LH.unwrapLink(str(u));
      if (v) links.add(v.toString());
    };
    push(snap.link_url);
    cards.forEach((c) => push(c && c.link_url));
    (Array.isArray(snap.extra_links) ? snap.extra_links : []).forEach(push);

    const cats = (Array.isArray(snap.page_categories) ? snap.page_categories : [])
      .map((c) => (typeof c === 'string' ? c : c && (c.name || c.category_name)))
      .filter(Boolean);

    const body = [textOf(snap.body), ...cards.map((c) => textOf(c && c.body))].filter(Boolean).join('\n').trim();
    const likes = Number(snap.page_like_count ?? raw.page_like_count);

    return {
      id,
      pageId,
      pageName: str(raw.page_name || snap.page_name || snap.current_page_name).trim(),
      pageUrl: str(snap.page_profile_uri) || `https://www.facebook.com/${pageId}`,
      avatar: str(snap.page_profile_picture_url),
      likes: Number.isFinite(likes) && likes > 0 ? likes : null,
      categories: cats,
      active: raw.is_active !== false,
      start: toMs(raw.start_date ?? raw.ad_delivery_start_time),
      end: toMs(raw.end_date ?? raw.ad_delivery_stop_time),
      platforms: Array.isArray(raw.publisher_platform) ? raw.publisher_platform.map(String) : [],
      count: Math.max(1, Number(raw.collation_count) || 1),
      cta: str(snap.cta_type),
      ctaText: str(snap.cta_text),
      caption: str(snap.caption || (cards[0] && cards[0].caption)),
      title: str(snap.title || (cards[0] && cards[0].title)),
      body: body.slice(0, 1200),
      format: str(snap.display_format),
      links: [...links],
    };
  }

  LH.extractAdsFromJson = (data) => {
    const out = [];
    const stack = [data];
    let steps = 0;
    while (stack.length && steps++ < 2_000_000) {
      const v = stack.pop();
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i] === 'object') stack.push(v[i]);
        continue;
      }
      if (v.ad_archive_id != null && (v.page_id != null || v.snapshot)) {
        const ad = normalize(v);
        if (ad) out.push(ad);
        continue;
      }
      for (const k in v) {
        const c = v[k];
        if (c && typeof c === 'object') stack.push(c);
      }
    }
    return out;
  };

  /** Facebook responses may be prefixed with `for (;;);` and hold several JSON documents, one per line. */
  LH.parseJsonChunks = (text) => {
    if (!text) return [];
    const t = String(text).replace(/^\s*for\s*\(;;\);/, '');
    try {
      return [JSON.parse(t)];
    } catch {}
    const docs = [];
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || (s[0] !== '{' && s[0] !== '[')) continue;
      try {
        docs.push(JSON.parse(s));
      } catch {}
    }
    return docs;
  };

  LH.extractAdsFromText = (text) => {
    if (!text || String(text).indexOf('ad_archive_id') === -1) return [];
    return LH.parseJsonChunks(text).flatMap((d) => LH.extractAdsFromJson(d));
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
