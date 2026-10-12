/* Lead Hunter: content script for facebook.com/ads/library.
   Collects advertisers from the results you load (network responses, embedded
   page data, and the visible cards as a fallback), sends them to the extension,
   shows a small control panel, and auto-scrolls during a hunt. */
(() => {
  if (window.__leadHunterContent) return;
  window.__leadHunterContent = true;
  const LH = globalThis.LH;

  const state = {
    seenAds: new Set(),
    pages: new Set(),
    jsonAds: 0,
    newLeads: 0,
    queue: [],
    running: false,
    stopRequested: false,
    hunt: null,
    dead: false,
    status: 'Watching results. Scroll or press Auto-collect.',
  };

  /* ----------------------------------------------------------- messaging */
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        });
      } catch {
        state.dead = true;
        setStatus('Lead Hunter was updated. Reload this page to keep collecting.');
        resolve(null);
      }
    });

  const context = () => {
    const p = new URLSearchParams(location.search);
    return {
      keyword: (p.get('q') || '').trim(),
      country: p.get('country') || '',
      viewPage: p.get('view_all_page_id') || '',
      url: location.href,
    };
  };

  /* -------------------------------------------------------------- intake */
  function take(ads, fromJson) {
    let fresh = 0;
    for (const ad of ads) {
      if (!ad || state.seenAds.has(ad.id)) continue;
      state.seenAds.add(ad.id);
      state.pages.add(ad.pageId);
      state.queue.push(ad);
      fresh++;
    }
    if (fromJson) state.jsonAds += fresh;
    if (fresh) render();
    return fresh;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__leadHunter !== 1 || e.data.kind !== 'payload') return;
    try {
      take(LH.extractAdsFromText(e.data.text), true);
    } catch {}
  });

  const scanned = new WeakSet();
  function scanEmbedded() {
    document.querySelectorAll('script[type="application/json"]').forEach((el) => {
      if (scanned.has(el)) return;
      scanned.add(el);
      const t = el.textContent || '';
      if (t.indexOf('ad_archive_id') === -1) return;
      try {
        take(LH.extractAdsFromText(t), true);
      } catch {}
    });
  }

  /* Fallback for when Meta changes its data format: read the visible cards. */
  const domSeen = new Set();
  function scanDom() {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/Library ID/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const ads = [];
    for (let n; (n = walker.nextNode()); ) {
      const host = n.parentElement && n.parentElement.parentElement;
      const m = ((host && host.textContent) || n.nodeValue).match(/Library ID:?\s*(\d{6,})/i);
      if (!m || domSeen.has(m[1]) || state.seenAds.has(m[1])) continue;
      let card = null;
      for (let el = n.parentElement, i = 0; el && i < 16; i++, el = el.parentElement) {
        if (/Started running/i.test(el.textContent) && el.querySelector('a[href*="facebook.com/"]')) {
          card = el;
          break;
        }
      }
      if (!card) continue;
      const pageA = [...card.querySelectorAll('a[href]')].find(
        (a) => /^https:\/\/(www|web)\.facebook\.com\/[^/?#]+\/?(\?|$)/.test(a.href) && !/\/ads\/|l\.php/.test(a.href) && a.textContent.trim(),
      );
      if (!pageA) continue;
      domSeen.add(m[1]);
      const text = card.innerText || card.textContent || '';
      const slug = new URL(pageA.href).pathname.split('/').filter(Boolean)[0];
      const started = text.match(/Started running on\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i);
      const links = [...card.querySelectorAll('a[href]')]
        .map((a) => LH.unwrapLink(a.href))
        .filter((u) => u && !['facebook', null].includes(LH.linkKind(u)))
        .map(String);
      const count = text.match(/(\d+)\s+ads?\s+use\s+this/i);
      ads.push({
        id: m[1],
        pageId: /^\d+$/.test(slug) ? slug : `slug:${slug.toLowerCase()}`,
        pageName: pageA.textContent.trim(),
        pageUrl: pageA.href.split('?')[0],
        avatar: (card.querySelector('img') || {}).src || '',
        likes: null,
        categories: [],
        active: !/\bInactive\b/.test(text),
        start: started ? Date.parse(started[1]) || null : null,
        end: null,
        platforms: [],
        count: count ? Number(count[1]) : 1,
        cta: '',
        ctaText: '',
        caption: '',
        title: '',
        body: (text.split(/\bSponsored\b/)[1] || '').trim().slice(0, 600),
        format: '',
        links: [...new Set(links)],
      });
    }
    take(ads, false);
  }

  async function flush() {
    if (!state.queue.length || state.dead) return;
    const ads = state.queue.splice(0, 200);
    const res = await send({ type: 'ads', ads, ctx: context() });
    if (!res) {
      if (!state.dead) state.queue.unshift(...ads); // worker was waking up; retry next tick
      return;
    }
    state.newLeads += res.added || 0;
    if (res.hunt) state.hunt = res.hunt;
    if (res.stop) state.stopRequested = true;
    render();
  }

  /* --------------------------------------------------------- auto-collect */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function autoCollect() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    render();
    let settings = {};
    try {
      settings = (await chrome.storage.local.get('settings')).settings || {};
    } catch {}
    const base = Math.max(900, Number(settings.scrollDelayMs) || 1800);
    let idle = 0;
    let lastAds = state.seenAds.size;
    let lastHeight = 0;
    let rounds = 0;
    while (state.running && !state.stopRequested && rounds++ < 600) {
      const h = document.documentElement.scrollHeight;
      window.scrollTo({ top: h, behavior: 'smooth' });
      setStatus(`Scrolling for more results… (${state.pages.size} advertisers so far)`);
      await sleep(base + Math.random() * base * 0.6);
      scanEmbedded();
      if (state.jsonAds === 0) scanDom();
      await flush();
      const grew = state.seenAds.size > lastAds || document.documentElement.scrollHeight > lastHeight + 40;
      idle = grew ? 0 : idle + 1;
      lastAds = state.seenAds.size;
      lastHeight = document.documentElement.scrollHeight;
      if (idle === 3) window.scrollBy(0, -600); // nudge the infinite loader
      if (idle >= 7) break;
    }
    const reason = state.stopRequested ? 'target' : !state.running ? 'stopped' : 'end';
    state.running = false;
    await flush();
    setStatus(
      reason === 'target'
        ? 'Hunt target reached.'
        : reason === 'stopped'
          ? 'Stopped.'
          : `Reached the end of the results (${state.pages.size} advertisers).`,
    );
    if (state.hunt && state.hunt.onThisTab) await send({ type: 'hunt:keywordDone', reason });
  }

  /* ----------------------------------------------------------------- HUD */
  let ui = null;
  function setStatus(s) {
    state.status = s;
    render();
  }
  function mountHud() {
    if (ui || !document.body) return;
    const host = document.createElement('div');
    host.id = 'lead-hunter-hud';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `
      <style>
        :host{all:initial}
        .box{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4f4f1;background:#0b0b0b;border:1px solid rgba(255,255,255,.16);
          border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);width:300px;overflow:hidden}
        .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.09);cursor:pointer}
        .dot{width:8px;height:8px;border-radius:50%;background:#5f5f5b}
        .dot.on{background:#7ee08a;box-shadow:0 0 0 4px rgba(126,224,138,.15)}
        .ttl{font-weight:600;letter-spacing:.01em;flex:1}
        .chev{color:#8d8d88;font-size:11px}
        .bd{padding:12px;display:grid;gap:10px}
        .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .st{background:#151515;border-radius:10px;padding:8px 10px}
        .st b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
        .st span{color:#8d8d88;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
        .msg{color:#b8b8b3;font-size:12px;min-height:16px}
        .hunt{font-size:12px;color:#f4f4f1;background:#1c1c1c;border-radius:8px;padding:6px 8px}
        .row{display:flex;gap:8px}
        button{all:unset;cursor:pointer;flex:1;text-align:center;padding:8px 10px;border-radius:9px;font-weight:600;font-size:12.5px;
          background:#1c1c1c;color:#f4f4f1;border:1px solid rgba(255,255,255,.12)}
        button.pri{background:#f4f4f1;color:#0b0b0b;border-color:#f4f4f1}
        button:focus-visible{outline:2px solid #fff;outline-offset:2px}
        .min .bd{display:none}
      </style>
      <div class="box" part="box">
        <div class="hd" data-toggle><span class="dot"></span><span class="ttl">Lead Hunter</span><span class="chev">▾</span></div>
        <div class="bd">
          <div class="stats">
            <div class="st"><b data-pages>0</b><span>Advertisers here</span></div>
            <div class="st"><b data-new>0</b><span>New leads</span></div>
          </div>
          <div class="hunt" data-hunt hidden></div>
          <div class="msg" data-msg></div>
          <div class="row">
            <button class="pri" data-run>Auto-collect</button>
            <button data-dash>Dashboard</button>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    const $ = (s) => sh.querySelector(s);
    ui = { box: $('.box'), dot: $('.dot'), pages: $('[data-pages]'), fresh: $('[data-new]'), msg: $('[data-msg]'), run: $('[data-run]'), hunt: $('[data-hunt]'), chev: $('.chev') };
    $('[data-toggle]').addEventListener('click', () => {
      ui.box.classList.toggle('min');
      ui.chev.textContent = ui.box.classList.contains('min') ? '▸' : '▾';
    });
    ui.run.addEventListener('click', () => {
      if (state.running) {
        state.running = false;
        if (state.hunt && state.hunt.onThisTab) send({ type: 'hunt:stop' });
      } else autoCollect();
      render();
    });
    $('[data-dash]').addEventListener('click', () => send({ type: 'open:dashboard' }));
    render();
  }
  function render() {
    if (!ui) return;
    ui.pages.textContent = state.pages.size;
    ui.fresh.textContent = state.newLeads;
    ui.msg.textContent = state.status;
    ui.run.textContent = state.running ? 'Stop' : 'Auto-collect';
    ui.dot.classList.toggle('on', state.running);
    const h = state.hunt;
    ui.hunt.hidden = !(h && h.onThisTab);
    if (h && h.onThisTab) ui.hunt.textContent = `Hunt · “${h.keyword}” (${h.index + 1}/${h.total}) · ${h.collected}/${h.target} leads`;
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    mountHud();
    scanEmbedded();
    setInterval(() => {
      scanEmbedded();
      flush();
    }, 1200);
    // DOM fallback only kicks in if no structured data has arrived.
    setInterval(() => state.jsonAds === 0 && scanDom(), 4000);
    const res = await send({ type: 'hello', ctx: context() });
    if (res && res.hunt && res.hunt.onThisTab) {
      state.hunt = res.hunt;
      setStatus(`Hunting “${res.hunt.keyword}”… starting in a moment.`);
      await sleep(3500);
      autoCollect();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
