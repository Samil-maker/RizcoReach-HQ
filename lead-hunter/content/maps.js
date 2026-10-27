/* Lead Hunter: Google Maps results reader (content script on google.com/maps).
   Used for Meta-ads business searches when no Places API key is set: the background
   opens a Maps search in a tab, this script scrolls the results list to the end and
   reads each business (name, rating, reviews, category, address, phone, website). */
(() => {
  if (window.__leadHunterMaps) return;
  window.__leadHunterMaps = true;
  const LH = globalThis.LH;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });

  /** Stable id from a place link. The "0x…:0x…" data id is always there; ChIJ… only sometimes.
      Read the raw href: some are "/maps/place/../data=…" and the URL parser drops the /place/ part. */
  function placeIdFrom(href) {
    const s = decodeURIComponent(href || '');
    const fid = s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (fid) return fid[1].toLowerCase();
    const chij = s.match(/!19s(ChI[\w-]+)/);
    if (chij) return chij[1];
    const cid = s.match(/[?&]cid=(\d+)/);
    return cid ? `cid:${cid[1]}` : '';
  }
  const cidUrl = (dataId) => {
    try {
      return /^0x[0-9a-f]+:0x[0-9a-f]+$/.test(dataId) ? `https://www.google.com/maps?cid=${BigInt('0x' + dataId.split(':0x')[1])}` : '';
    } catch {
      return '';
    }
  };

  /* Network layer: places from Maps' own search responses, keyed by data id. */
  const net = new Map();
  function readNet(text) {
    let data;
    try {
      const outer = JSON.parse(String(text).replace('/*""*/', ''));
      data = JSON.parse(String(outer.d || '').replace(/^\)\]\}'\n?/, ''));
    } catch {
      try {
        data = JSON.parse(String(text).replace(/^\)\]\}'\n?/, ''));
      } catch {
        return;
      }
    }
    // Walk instead of trusting the root path (it moved from [0][1] to [64] in 2025).
    const stack = [data];
    let steps = 0;
    while (stack.length && steps++ < 400000) {
      const a = stack.pop();
      if (!Array.isArray(a)) continue;
      if (typeof a[11] === 'string' && typeof a[10] === 'string' && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(a[10]) && (Array.isArray(a[178]) || Array.isArray(a[7]) || Array.isArray(a[4]))) {
        const at = (x, ...p) => p.reduce((v, k) => (Array.isArray(v) ? v[k] : undefined), x);
        net.set(a[10].toLowerCase(), {
          name: a[11],
          website: typeof at(a, 7, 0) === 'string' ? at(a, 7, 0) : '',
          phone: typeof at(a, 178, 0, 0) === 'string' ? at(a, 178, 0, 0) : '',
          rating: typeof at(a, 4, 7) === 'number' ? at(a, 4, 7) : null,
          reviews: typeof at(a, 4, 8) === 'number' ? at(a, 4, 8) : 0,
          category: Array.isArray(a[13]) && typeof a[13][0] === 'string' ? a[13][0] : '',
          address: typeof a[39] === 'string' ? a[39] : '',
          placeId: typeof a[78] === 'string' ? a[78] : '',
        });
        continue;
      }
      for (const v of a) if (Array.isArray(v)) stack.push(v);
    }
  }
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__leadHunterMaps === 1) readNet(e.data.text);
  });

  function readCard(a) {
    const card = a.closest('div.Nv2PK, [role="article"]') || a.parentElement;
    if (!card) return null;
    const name = (a.getAttribute('aria-label') || card.getAttribute('aria-label') || (card.querySelector('.qBF1Pd') || {}).textContent || '').trim();
    if (!name) return null;
    const text = card.innerText || '';
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let rating = null;
    let reviews = 0;
    const stars = card.querySelector('[role="img"][aria-label*="star" i]');
    const starLabel = stars ? stars.getAttribute('aria-label') : '';
    const m1 = starLabel.match(/([\d.]+)\s*stars?\s*([\d,.]+)?/i);
    const rEl = card.querySelector('span.MW4etd');
    const nEl = card.querySelector('span.UY7F9');
    const m2 = rEl ? [null, rEl.textContent, nEl ? nEl.textContent : '0'] : text.match(/(\d[.,]\d)\s*\(([\d,.]+)\)/);
    if (m1) {
      rating = Number(m1[1]);
      reviews = Number(String(m1[2] || '').replace(/\D/g, '')) || 0;
    }
    if (m2) {
      rating = rating || Number(m2[1].replace(',', '.'));
      reviews = reviews || Number(m2[2].replace(/\D/g, '')) || 0;
    }
    // Lines after the rating look like "Beauty salon · · Al Wasl Rd" and "Open · Closes 9 pm · 04 123 4567".
    const info = lines.filter((l) => l.includes('·'));
    const parts = (info[0] || '').split('·').map((x) => x.trim()).filter((x) => x && !/^[\W\d]+$/.test(x));
    const category = parts[0] && !LH.looksLikeHours(parts[0]) ? parts[0] : '';
    // The last part that is not opening hours ("Interior designer · Opens 10 AM" has no address).
    const address = parts.length > 1 ? parts.slice(1).reverse().find((x) => !LH.looksLikeHours(x)) || '' : '';
    const site = card.querySelector('a[data-value="Website"], a[aria-label^="Visit"], a.lcr4fd, div.Rwjeuc a[href]');
    const dataId = placeIdFrom(a.getAttribute('href'));
    const n = net.get(dataId) || {};
    const webRaw = n.website || (site ? site.href : '');
    let web = '';
    try {
      const u = new URL(webRaw);
      web = /google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url' ? u.searchParams.get('q') || u.searchParams.get('url') || '' : webRaw;
    } catch {}
    const phoneText = n.phone || (card.querySelector('span.UsdlK') || {}).textContent || '';
    const phones = [...LH.phonesInText(phoneText, 'AE'), ...LH.phonesInText(lines.join(' · '), 'AE')];
    if (!phones.length && phoneText) {
      const p = LH.normalizePhone(phoneText, 'AE');
      if (p) phones.push(p);
    }
    return {
      name: n.name || name,
      category: n.category || category,
      website: web ? LH.cleanUrl(web) || web : '',
      phones: [...new Set(phones)].slice(0, 2),
      maps: { placeId: dataId, gPlaceId: n.placeId || '', rating: n.rating ?? rating, reviews: n.reviews || reviews, address: n.address || address, mapsUrl: cidUrl(dataId) || a.href.split('?')[0] },
    };
  }

  async function collect() {
    const t0 = Date.now();
    let feed = null;
    while (!feed && Date.now() - t0 < 20000) {
      if (/consent\.google|\/sorry\/|recaptcha/.test(location.href) || document.querySelector('form[action*="consent"], iframe[src*="recaptcha"], #captcha-form') || /unusual traffic|not a robot/i.test((document.body && document.body.innerText) || '')) return { blocked: true, items: [] };
      feed = document.querySelector('[role="feed"]');
      // A query that matches one exact place opens it directly instead of a list.
      if (!feed && /\/maps\/place\//.test(location.pathname) && document.querySelector('h1')) {
        const h1 = document.querySelector('h1');
        const phoneBtn = document.querySelector('[data-item-id^="phone:tel:"]');
        const web = document.querySelector('a[data-item-id="authority"]');
        const addr = document.querySelector('[data-item-id="address"]');
        const stars = document.querySelector('[role="img"][aria-label*="star" i]');
        const m = stars && (stars.getAttribute('aria-label') || '').match(/([\d.]+)/);
        const rev = document.body.innerText.match(/([\d,]+)\s+reviews?/i);
        return {
          items: [
            {
              name: h1.textContent.trim(),
              category: (document.querySelector('button[jsaction*="category"]') || {}).textContent || '',
              website: web ? web.href : '',
              phones: phoneBtn ? [LH.normalizePhone(phoneBtn.getAttribute('data-item-id').replace('phone:tel:', ''), 'AE')].filter(Boolean) : [],
              maps: { placeId: placeIdFrom(location.href), rating: m ? Number(m[1]) : null, reviews: rev ? Number(rev[1].replace(/\D/g, '')) : 0, address: addr ? addr.textContent.trim() : '', mapsUrl: location.href.split('?')[0] },
            },
          ],
        };
      }
      await sleep(500);
    }
    if (!feed) return { items: [], error: 'no results list' };
    let idle = 0;
    let last = 0;
    const links = () => {
      const a = feed.querySelectorAll('a.hfpxzc');
      return a.length ? a : feed.querySelectorAll('a[href*="/maps/place/"]');
    };
    for (let i = 0; i < 40 && idle < 4; i++) {
      feed.scrollTop = feed.scrollHeight;
      await sleep(1500 + Math.random() * 1000);
      const n = links().length;
      idle = n > last ? 0 : idle + 1;
      last = n;
      if (document.querySelector('span.HlvSq') || /you.ve reached the end of the list/i.test(feed.innerText || '') || n >= 120) break;
    }
    await sleep(800); // let the last network page land
    const seen = new Set();
    const items = [];
    for (const a of links()) {
      const item = readCard(a);
      if (!item || seen.has(item.maps.placeId || item.name)) continue;
      seen.add(item.maps.placeId || item.name);
      if (!item.maps.placeId) item.maps.placeId = `name:${item.name.toLowerCase()}`;
      items.push(item);
    }
    return { items };
  }

  (async () => {
    const res = await send({ type: 'maps:hello' });
    if (!res || !res.search) return; // a normal Maps tab: do nothing
    const out = await collect();
    send({ type: 'maps:results', ...out });
  })();
})();
