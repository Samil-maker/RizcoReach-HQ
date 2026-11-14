/* Lead Hunter: Google search results reader (content script on google.com/search).
   Only works in the tab Lead Hunter opened for a search; your own Google searches are left alone. It reads each
   result's link, title and the text Google shows under it, and sends them back. A captcha, an "unusual traffic"
   page or a consent page is reported as a block: Lead Hunter pauses Google and tells you. It never tries to get
   past one. */
(() => {
  if (window.__leadHunterGoogle) return;
  window.__leadHunterGoogle = true;
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
    if (/\/sorry\//.test(location.pathname) || /consent\.google/.test(location.hostname)) return 'Google showed a "check you are not a robot" page';
    if (document.querySelector('#captcha-form, iframe[src*="recaptcha"], form[action*="consent"]')) return 'Google showed a captcha or consent page';
    if (/unusual traffic from your computer|not a robot/i.test(txt(document.body).slice(0, 3000))) return 'Google says it sees unusual traffic';
    return '';
  }
  /** Google's own redirect links (/url?q=…) point to the real page. */
  function realUrl(a) {
    try {
      const u = new URL(a.href);
      if (/google\./.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || '';
      return /google\./.test(u.hostname) ? '' : u.href;
    } catch {
      return '';
    }
  }
  function read() {
    const out = [];
    const seen = new Set();
    for (const h3 of document.querySelectorAll('#search a h3, #rso a h3, #main a h3')) {
      const a = h3.closest('a');
      const url = a && realUrl(a);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const box = a.closest('.MjjYud, .g, [data-hveid], [data-ved]') || a.parentElement;
      const title = txt(h3);
      const text = txt(box).replace(title, '').slice(0, 1200);
      out.push({ url, title, text });
    }
    return out;
  }

  (async () => {
    const hello = await send({ type: 'google:hello' });
    if (!hello || !hello.search) return; // your own search: nothing to do
    let results = [];
    let wall = '';
    for (let i = 0; i < 24; i++) {
      wall = blocked();
      if (wall) break;
      results = read();
      if (results.length || /did not match any documents|no results found/i.test(txt(document.body).slice(0, 4000))) break;
      await sleep(500);
    }
    await sleep(400);
    if (!wall && results.length) results = read();
    send({ type: 'google:results', blocked: wall, results: results.slice(0, 20) });
  })();
})();
