/*
 * Runs on Google Maps. When the side panel asks, it goes through the current
 * search results one by one (like you would by hand), reads each business's
 * phone number and website, and saves the ones with no website and a mobile
 * number. Progress is written to chrome.storage so the panel can show it.
 */
(() => {
  if (window.__rrLeadFinderLoaded) return;
  window.__rrLeadFinderLoaded = true;

  const LF = globalThis.LF;
  let running = false;
  let stopRequested = false;
  let lastQuery = '';

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
    const stats = { checked: 0, closed: 0, website: 0, noMobile: 0, dupes: 0, added: 0, unreadable: 0 };
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
          const raw = await readListing(items[i], settings);
          if (raw.unreadable) stats.unreadable++;
          await keep(raw, settings, stats, query);
          run.done = i + 1;
          await save();
          if (i + 1 < items.length) await pause(450, 950);
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
    if (LF.hasRealWebsite([raw.website], settings.socialIsNoWebsite)) {
      stats.website++;
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
    await chrome.storage.local.set({ [key]: LF.newLead(phone.e164, raw, query) });
    stats.added++;
  }

  // ─── Results list ──────────────────────────────────────────────────────────

  /** Scrolls the results list until Google has loaded all of them (or max). */
  async function loadAllResults(feed, max, onProgress) {
    const scroller = scrollableAncestor(feed);
    let previous = -1;
    let unchanged = 0;
    for (;;) {
      const items = listItems(feed);
      await onProgress(items.length);
      if (items.length >= max || reachedEnd(feed) || stopRequested) break;
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

  async function readListing(item, settings) {
    // If the result card already shows a real website, there's no need to open it.
    const cardSite = cardWebsite(item.card);
    if (cardSite && LF.hasRealWebsite([cardSite], settings.socialIsNoWebsite)) {
      return { name: item.name, website: cardSite, phone: '', mapsUrl: item.href };
    }
    if (!document.contains(item.link)) return Object.assign(fromCard(item), { unreadable: true });

    item.link.scrollIntoView({ block: 'center' });
    await sleep(120);
    item.link.click();
    const panel = await waitForPanel(item.name, 8000);
    if (!panel) return Object.assign(fromCard(item), { unreadable: true });
    await pause(300, 600); // let the details finish rendering
    return readPanel(panel, item.name, item.href);
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

    return { name: name, phone: phone, website: website, address: address, category: category, closed: closed, mapsUrl: href };
  }

  /** When the details panel can't be read, use what the result card shows. */
  function fromCard(item) {
    return { name: item.name, phone: cardPhone(item.card), website: cardWebsite(item.card), mapsUrl: item.href };
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
