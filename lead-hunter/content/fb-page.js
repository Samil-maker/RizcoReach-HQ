/* Lead Hunter: a business's Facebook page, opened by Lead Hunter in its check tab to find their email (content script).
   It reads the email shown in the page's Intro and any email links, and reports them, or the wall it hit, then does
   nothing else. Any other Facebook page you open is left alone. On a login wall, checkpoint, captcha or "temporarily
   blocked" page it tells Lead Hunter, which pauses Facebook page lookups and alerts you. It never tries to get past one. */
(() => {
  if (window.__leadHunterFbPage) return;
  window.__leadHunterFbPage = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+\n/g, '\n').trim();
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });

  /* A wall instead of the page. Text is only read when the page did not load: a page can say "log in" too. */
  function wall(found) {
    const p = location.pathname;
    if (/\/checkpoint\//.test(p) || /captcha/i.test(location.href)) return 'Facebook showed a security check';
    if (/^\/login/.test(p)) return 'Facebook asked you to log in';
    if (found) return '';
    const body = txt(document.body).slice(0, 4000);
    if (/temporarily blocked|you['’]re temporarily|temporarily restricted|unusual activity/i.test(body)) return 'Facebook says this account is temporarily restricted';
    if (/security check|confirm (that )?you['’]?re (a )?human|captcha|not a robot/i.test(body)) return 'Facebook showed a security check';
    if (/log in to (see|continue)|you must log in/i.test(body)) return 'Facebook asked you to log in';
    return '';
  }
  /* The Intro card, or (when there is no Intro) only the top of the page, so comments further down are left out. */
  function introText() {
    const main = document.querySelector('[role="main"]') || document.body;
    const head = [...main.querySelectorAll('h2, h3, span')].find((el) => /^intro$/i.test((el.textContent || '').trim()));
    let box = head;
    while (box && box !== main && txt(box).length < 60) box = box.parentElement;
    return box && box !== main ? txt(box).slice(0, 4000) : txt(main).slice(0, 3000);
  }

  send({ type: 'fbpage:hello' }).then(async (r) => {
    if (!r || !r.read) return;
    let main = '';
    for (let i = 0; i < 12; i++) {
      // Up to about 12 seconds for Facebook to draw the page.
      main = txt(document.querySelector('[role="main"]'));
      if (main.length > 300 && i >= 2) break;
      await sleep(1000);
    }
    const blocked = wall(main.length > 300);
    if (blocked) return send({ type: 'fbpage:result', id: r.id, blocked });
    const links = [...document.querySelectorAll('[role="main"] a[href^="mailto:"]')].map((a) => {
      try {
        return decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]);
      } catch {
        return '';
      }
    });
    send({ type: 'fbpage:result', id: r.id, loaded: main.length > 0, emails: links.filter(Boolean), text: introText() });
  });
})();
