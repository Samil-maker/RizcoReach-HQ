/* Lead Hunter: Bing search results reader (content script on bing.com/search).
   Only works in the tab Lead Hunter opened for a search; your own Bing searches are left alone. It reads each
   result's link, title and the text Bing shows under it, and sends them back. A "verify you are human" challenge or
   a captcha is reported as a block: Lead Hunter pauses Bing and tells you. It never tries to get past one. */
(() => {
  if (window.__leadHunterBing) return;
  window.__leadHunterBing = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  const txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/[ \t]+/g, ' ').trim();

  function blocked() {
    if (/\/(challenge|turing)\b/.test(location.pathname)) return 'Bing asked to verify you are human';
    if (document.querySelector('#b_captcha, iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #turnstile-widget')) return 'Bing showed a captcha';
    if (/verify you are (a )?human|one last step|unusual traffic|too many requests/i.test(txt(document.body).slice(0, 3000))) return 'Bing says it sees unusual traffic';
    return '';
  }
  /** Bing's own redirect links (bing.com/ck/a?…&u=a1<base64>) point to the real page. */
  function realUrl(a) {
    try {
      const u = new URL(a.href);
      if (/(^|\.)bing\.com$/.test(u.hostname)) {
        const raw = u.searchParams.get('u') || '';
        if (!/^a1/.test(raw)) return '';
        const b64 = raw.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const out = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
        return /^https?:\/\//.test(out) ? out : '';
      }
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
  }
  function read() {
    const out = [];
    const seen = new Set();
    for (const li of document.querySelectorAll('#b_results > li.b_algo')) {
      const a = li.querySelector('h2 a[href]');
      const url = a && realUrl(a);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = txt(a);
      const cap = li.querySelector('.b_caption') || li;
      const text = txt(cap).replace(title, '').slice(0, 1200);
      out.push({ url, title, text });
    }
    return out;
  }

  (async () => {
    const hello = await send({ type: 'bing:hello' });
    if (!hello || !hello.search) return; // your own search: nothing to do
    let results = [];
    let wall = '';
    for (let i = 0; i < 24; i++) {
      wall = blocked();
      if (wall) break;
      results = read();
      if (results.length || /there are no results for|no results found/i.test(txt(document.body).slice(0, 4000))) break;
      await sleep(500);
    }
    await sleep(400);
    if (!wall && results.length) results = read();
    send({ type: 'bing:results', blocked: wall, results: results.slice(0, 20) });
  })();
})();
