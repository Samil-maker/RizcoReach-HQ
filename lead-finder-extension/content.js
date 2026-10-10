/*
 * Runs on Google Maps. When the side panel asks, it goes through the current
 * search results one by one (like you would by hand), reads each business's
 * phone number, website, Google rating and social links, and saves the ones
 * with a mobile number. Progress is written to chrome.storage so the panel can
 * show it; the panel then checks each lead's website and Instagram.
 */
(() => {
  if (window.__rrLeadFinderLoaded) return;
  window.__rrLeadFinderLoaded = true;

  const LF = globalThis.LF;
  let running = false;
  let stopRequested = false;
  let lastQuery = '';

  const ROBOT_MESSAGE =
    'Google is asking you to prove you\'re not a robot. Solve it in the Google Maps tab, wait a few minutes, then click Collect again. The leads found so far are saved.';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pause = (min, max) => sleep(min + Math.random() * (max - min));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type === 'rr-ping') {
      const place = document.querySelector('div[role="feed"]') ? null : openPlacePanel();
      sendResponse({
        ok: true,
        running: running,
        hasList: !!document.querySelector('div[role="feed"]'),
        query: searchQuery(),
        placeName: place ? panelName(place) : '',
        english: /^en\b/i.test(document.documentElement.lang || 'en'),
      });
      return undefined;
    }
    if (msg.type === 'rr-stop') {
      stopRequested = true;
      sendResponse({ ok: true });
      return undefined;
    }
    if (msg.type === 'rr-collect') {
      if (running) {
        sendResponse({ error: 'Already collecting in this tab.' });
        return undefined;
      }
      collect().then(sendResponse, (err) => sendResponse({ error: (err && err.message) || String(err) }));
      return true; // answer later
    }
    return undefined;
  });

  async function collect() {
    running = true;
    stopRequested = false;
    const settings = await LF.loadSettings();
    const query = searchQuery();
    const stats = { checked: 0, closed: 0, filtered: 0, noMobile: 0, dupes: 0, added: 0, withSite: 0, unreadable: 0 };
    const run = { active: true, phase: 'loading', query: query, done: 0, total: 0, startedAt: Date.now(), error: '' };
    const save = () => chrome.storage.local.set({ run: Object.assign({}, run, { stats: Object.assign({}, stats), updatedAt: Date.now() }) });
    await save();

    try {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) {
        const items = await loadAllResults(feed, Number(settings.maxResults) || 120, async (n) => {
          run.total = n;
          await save();
        });
        run.phase = 'checking';
        run.total = items.length;
        await save();
        for (let i = 0; i < items.length && !stopRequested; i++) {
          if (robotCheck()) throw new Error(ROBOT_MESSAGE);
          const raw = await readListing(items[i], settings, i > 0 ? items[i - 1].name : '');
          if (raw.unreadable) stats.unreadable++;
          await keep(raw, settings, stats, query);
          run.done = i + 1;
          await save();
          if (i + 1 < items.length) await pause(800, 1500);
        }
      } else {
        // A single business is open instead of a results list.
        const panel = openPlacePanel();
        if (!panel) {
          throw new Error('No search results on this page. In Google Maps, search for a type of business and an area, e.g. "ladies salon in Al Barsha", then try again.');
        }
        run.phase = 'checking';
        run.total = 1;
        await save();
        await keep(readPanel(panel, panelName(panel), location.href), settings, stats, query);
        run.done = 1;
      }
    } catch (err) {
      run.error = (err && err.message) || String(err);
    } finally {
      run.active = false;
      run.phase = stopRequested ? 'stopped' : 'done';
      run.finishedAt = Date.now();
      await save();
      running = false;
    }
    return { ok: !run.error, error: run.error, stats: stats };
  }

  /** Decides whether a business is a lead, and saves it if it's new. */
  async function keep(raw, settings, stats, query) {
    stats.checked++;
    if (raw.closed) {
      stats.closed++;
      return;
    }
    const hasSite = LF.hasRealWebsite([raw.website], settings.socialIsNoWebsite);
    if ((settings.keep === 'noSite' && hasSite) || (settings.keep === 'site' && !hasSite)) {
      stats.filtered++;
      return;
    }
    const phone = LF.pickPhone([raw.phone], settings);
    if (!phone) {
      stats.noMobile++;
      return;
    }
    const key = 'lead:' + phone.e164;
    const existing = await chrome.storage.local.get(key);
    if (existing[key]) {
      stats.dupes++;
      return;
    }
    await chrome.storage.local.set({ [key]: LF.newLead(phone, raw, query) });
    stats.added++;
    if (hasSite) stats.withSite++;
  }

  // ─── Results list ──────────────────────────────────────────────────────────

  /** Google's "unusual traffic" / CAPTCHA page. */
  function robotCheck() {
    if (/\/sorry\//.test(location.pathname)) return true;
    if (document.querySelector('iframe[src*="recaptcha"], #captcha-form, #captcha')) return true;
    const text = (document.body && document.body.innerText ? document.body.innerText.slice(0, 3000) : '');
    return /unusual traffic|our systems have detected|not a robot|automated queries/i.test(text);
  }

  /** Scrolls the results list until Google has loaded all of them (or max). */
  async function loadAllResults(feed, max, onProgress) {
    const scroller = scrollableAncestor(feed);
    let previous = -1;
    let unchanged = 0;
    for (;;) {
      const items = listItems(feed);
      await onProgress(items.length);
      if (items.length >= max || reachedEnd(feed) || stopRequested) break;
      if (robotCheck()) throw new Error(ROBOT_MESSAGE);
      unchanged = items.length === previous ? unchanged + 1 : 0;
      if (unchanged >= 4) break;
      previous = items.length;
      if (items.length) items[items.length - 1].link.scrollIntoView({ block: 'end' });
      scroller.scrollTop = scroller.scrollHeight;
      await pause(1200, 1800);
    }
    return listItems(feed).slice(0, max);
  }

  function listItems(feed) {
    const seen = new Set();
    const items = [];
    feed.querySelectorAll('a[href*="/maps/place/"]').forEach((link) => {
      const key = link.href.split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);
      const card = link.closest('[role="article"]') || link.parentElement;
      const name = (link.getAttribute('aria-label') || (card && card.getAttribute('aria-label')) || link.textContent || '').trim();
      if (name) items.push({ link: link, card: card, name: name, href: link.href });
    });
    return items;
  }

  function reachedEnd(feed) {
    if (feed.querySelector('span.HlvSq')) return true;
    const tail = Array.from(feed.children)
      .slice(-3)
      .map((el) => el.textContent || '')
      .join(' ');
    return /reached the end of the list|وصلت إلى نهاية القائمة/i.test(tail);
  }

  function scrollableAncestor(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 10) return node;
    }
    return el;
  }

  // ─── One business ──────────────────────────────────────────────────────────

  async function readListing(item, settings, previousName) {
    // Only collecting businesses without a website? Then one the card shows a website for can be skipped unopened.
    const cardSite = cardWebsite(item.card);
    if (settings.keep === 'noSite' && cardSite && LF.hasRealWebsite([cardSite], settings.socialIsNoWebsite)) {
      return { name: item.name, website: cardSite, phone: '', mapsUrl: item.href };
    }
    if (!document.contains(item.link)) return Object.assign(fromCard(item), { unreadable: true });

    item.link.scrollIntoView({ block: 'center' });
    await sleep(120);
    item.link.click();
    const panel = await waitForPanel(item.name, 8000);
    if (!panel) return Object.assign(fromCard(item), { unreadable: true });
    // Let the details finish rendering (longer when the previous business had the same name,
    // because the panel may still be showing that one).
    await pause(700, 1000);
    if (previousName && norm(previousName) === norm(item.name)) await sleep(1800);
    const raw = readPanel(panel, item.name, item.href);
    // The card usually shows rating and review count too; use it when the panel didn't.
    if (raw.rating == null || raw.reviews == null) {
      const card = readRating(item.card);
      if (raw.rating == null) raw.rating = card.rating;
      if (raw.reviews == null) raw.reviews = card.reviews;
    }
    return raw;
  }

  /** Waits for the details panel of the business we just clicked. */
  async function waitForPanel(name, timeout) {
    const want = norm(name);
    const start = Date.now();
    let seenAt = 0;
    while (Date.now() - start < timeout) {
      const panel = findPanel(want);
      if (panel) {
        if (!seenAt) seenAt = Date.now();
        if (panel.querySelector('[data-item-id]') || Date.now() - seenAt > 2000) return panel;
      }
      await sleep(150);
    }
    return null;
  }

  function findPanel(want) {
    for (const main of document.querySelectorAll('[role="main"]')) {
      if (norm(main.getAttribute('aria-label')) === want) return main;
    }
    // Fallback: the panel's heading, then the closest block that holds its details.
    for (const h1 of document.querySelectorAll('h1')) {
      if (norm(h1.textContent) !== want) continue;
      let node = h1.parentElement;
      for (let i = 0; node && i < 12; i++, node = node.parentElement) {
        if (node.querySelector('div[role="feed"]')) break;
        if (node.querySelector('[data-item-id]')) return node;
      }
      return h1.closest('[role="main"]') || h1.parentElement;
    }
    return null;
  }

  function readPanel(panel, name, href) {
    let phone = '';
    const phoneEl = panel.querySelector('[data-item-id^="phone:tel:"]');
    if (phoneEl) phone = phoneEl.getAttribute('data-item-id').replace(/^phone:tel:/, '');
    if (!phone) {
      const labelled = panel.querySelector('[aria-label^="Phone:"], [aria-label^="Phone "]');
      if (labelled) phone = labelled.getAttribute('aria-label').replace(/^phone:?\s*/i, '');
    }

    const siteEl = panel.querySelector('a[data-item-id="authority"]') || panel.querySelector('a[aria-label^="Website:"]');
    const website = siteEl ? unwrapRedirect(siteEl.href) : '';

    const addressEl = panel.querySelector('[data-item-id="address"]');
    const address = addressEl
      ? (addressEl.getAttribute('aria-label') || addressEl.textContent || '').replace(/^\s*address:\s*/i, '').trim()
      : '';
    const categoryEl = panel.querySelector('button[jsaction*="category"]');
    const category = categoryEl ? categoryEl.textContent.trim() : '';
    const top = (panel.innerText || panel.textContent || '').slice(0, 1500);
    const closed = /permanently closed|temporarily closed|مغلق نهائي|مغلق مؤقت/i.test(top);
    const stars = readRating(panel);
    const socials = readSocials(panel, website);
    const labels = Array.from(panel.querySelectorAll('[aria-label]'))
      .slice(0, 300)
      .map((el) => el.getAttribute('aria-label'))
      .join(' ');
    const unclaimed =
      !!panel.querySelector('a[href*="claimthisbusiness"], a[href*="claimabusiness"]') ||
      /claim this business|own this business\?/i.test(top + ' ' + labels);

    return {
      name: name,
      phone: phone,
      website: website,
      address: address,
      category: category,
      closed: closed,
      mapsUrl: href,
      rating: stars.rating,
      reviews: stars.reviews,
      instagram: socials.instagram,
      facebook: socials.facebook,
      unclaimed: unclaimed,
    };
  }

  /** When the details panel can't be read, use what the result card shows. */
  function fromCard(item) {
    const stars = readRating(item.card);
    const website = cardWebsite(item.card);
    return {
      name: item.name,
      phone: cardPhone(item.card),
      website: website,
      mapsUrl: item.href,
      rating: stars.rating,
      reviews: stars.reviews,
      instagram: LF.instagramHandle(website),
    };
  }

  /**
   * Google rating and review count. Maps labels them for screen readers
   * ("4.6 stars", "1,234 reviews"); review-topic chips also say "N reviews", so
   * the count is the LARGEST one. Visible "4.6 (1,234)" text is the fallback.
   */
  function readRating(root) {
    const out = { rating: null, reviews: null };
    if (!root) return out;
    const labels = [root].concat(Array.from(root.querySelectorAll('[aria-label]')).slice(0, 400));
    let most = null;
    for (const el of labels) {
      const label = el.getAttribute && el.getAttribute('aria-label');
      if (!label) continue;
      if (out.rating == null) {
        const r = label.match(/([0-5](?:[.,]\d)?)\s*stars?\b/i);
        if (r) out.rating = parseFloat(r[1].replace(',', '.'));
      }
      const n = label.match(/(\d[\d,.\s ]*[KkMm]?)\s*reviews?\b/i);
      if (n) {
        const count = countOf(n[1]);
        if (count != null && (most == null || count > most)) most = count;
      } else if (/\bno reviews\b/i.test(label) && most == null) {
        most = 0;
      }
    }
    out.reviews = most;
    if (out.rating == null) {
      const visible = root.querySelector('span.MW4etd, div.F7nice span[aria-hidden="true"]');
      if (visible && /^[0-5][.,]\d$/.test(visible.textContent.trim())) out.rating = parseFloat(visible.textContent.trim().replace(',', '.'));
    }
    if (out.reviews == null) {
      const visible = root.querySelector('span.UY7F9');
      if (visible) out.reviews = countOf(visible.textContent);
    }
    const text = (root.innerText || root.textContent || '').slice(0, 2000);
    const m = text.match(/([0-5][.,]\d)\s*\(([\d][\d,.\s]*[KkMm]?)\)/);
    if (m) {
      if (out.rating == null) out.rating = parseFloat(m[1].replace(',', '.'));
      if (out.reviews == null) out.reviews = countOf(m[2]);
    }
    return out;
  }

  /** "1,234" / "1.234" / "1 234" → 1234; "1.2K" → 1200 */
  function countOf(text) {
    const t = String(text).trim();
    const k = t.match(/^(\d+(?:[.,]\d+)?)\s*([KkMm])$/);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * (/k/i.test(k[2]) ? 1e3 : 1e6));
    const digits = t.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  /** Instagram / Facebook links shown on the listing (or used as its "website"). */
  function readSocials(root, website) {
    let instagram = LF.instagramHandle(website);
    let facebook = /facebook\.com|fb\.com/i.test(website || '') ? website : '';
    root.querySelectorAll('a[href*="instagram.com"], a[href*="facebook.com"]').forEach((a) => {
      const href = unwrapRedirect(a.href);
      if (!instagram) instagram = LF.instagramHandle(href);
      if (!facebook && /facebook\.com/i.test(href)) facebook = href;
    });
    return { instagram: instagram, facebook: facebook };
  }

  function cardWebsite(card) {
    if (!card) return '';
    for (const a of card.querySelectorAll('a[href]')) {
      const label = [a.getAttribute('aria-label'), a.getAttribute('data-value'), a.textContent].join(' ').toLowerCase();
      if (/website|الموقع/.test(label)) return unwrapRedirect(a.href);
    }
    return '';
  }

  function cardPhone(card) {
    const text = card ? card.innerText || card.textContent || '' : '';
    const found = text.match(/(?:\+|00)?\d[\d\s-]{6,16}\d/g) || [];
    return found.join(' / ');
  }

  function unwrapRedirect(href) {
    const m = String(href || '').match(/^https?:\/\/(?:www\.)?google\.[^/]+\/url\?(.*)$/i);
    if (!m) return href || '';
    const params = new URLSearchParams(m[1]);
    return params.get('q') || params.get('url') || href;
  }

  function openPlacePanel() {
    if (location.pathname.indexOf('/maps/place/') < 0) return null;
    const h1 = document.querySelector('[role="main"] h1') || document.querySelector('h1');
    return h1 ? findPanel(norm(h1.textContent)) : null;
  }

  function panelName(panel) {
    const h1 = panel.querySelector('h1');
    return (panel.getAttribute('aria-label') || (h1 && h1.textContent) || '').trim();
  }

  /** The text in Google Maps' search box (the address changes once a result is opened). */
  function searchQuery() {
    const box = document.querySelector('input#searchboxinput, input[name="q"]');
    let query = box ? box.value.trim() : '';
    const m = location.pathname.match(/\/maps\/search\/([^/]+)/);
    if (!query && m) {
      try {
        query = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
      } catch (e) {
        query = m[1];
      }
    }
    if (query) lastQuery = query;
    return query || lastQuery;
  }
})();
