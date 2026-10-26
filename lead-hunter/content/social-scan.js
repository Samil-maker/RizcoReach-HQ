/* Lead Hunter: "Scan for leads" on Facebook groups and LinkedIn (content script).
   Nothing runs by itself. The button reads the posts already on the page you have open, and only when you press it.
   "Scroll and scan" scrolls a few small steps first, 4 to 12 seconds apart, like a person reading.
   On a login wall, checkpoint, captcha or "temporarily blocked" page it stops and tells Lead Hunter, which pauses
   that source and alerts you. It never tries to get past one. */
(() => {
  if (window.__leadHunterSocial) return;
  window.__leadHunterSocial = true;

  const site = /linkedin\.com$/.test(location.hostname) ? 'linkedin' : 'facebook';
  /** What this page is: a Facebook group, LinkedIn posts (feed or search), LinkedIn jobs, or nothing to scan. */
  const kind = () => {
    const p = location.pathname;
    if (site === 'facebook') return /^\/groups\/[^/]+/.test(p) ? 'group' : '';
    if (/^\/(feed|search\/results\/(content|all))/.test(p)) return 'posts';
    if (/^\/jobs\//.test(p)) return 'jobs';
    return '';
  };
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+\n/g, '\n').trim();
  const pick = (root, sels) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el && txt(el)) return el;
    }
    return null;
  };
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };

  /* A wall instead of posts. Text is only read when no post was found: a post can say "log in" too. */
  function wall(found) {
    const p = location.pathname;
    if (/\/checkpoint\//.test(p) || /captcha/i.test(location.href)) return `${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} showed a security check`;
    if (/^\/(login|authwall|uas\/login)/.test(p)) return `${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} asked you to log in`;
    if (found) return '';
    const body = txt(document.body).slice(0, 4000);
    if (/temporarily blocked|you['’]re temporarily|temporarily restricted|unusual activity/i.test(body)) return `${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} says this account is temporarily restricted`;
    if (/security check|confirm (that )?you['’]?re (a )?human|captcha|not a robot/i.test(body)) return `${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} showed a security check`;
    if (/join linkedin|sign in to (see|view)|log in to (see|continue)|you must log in/i.test(body)) return `${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} asked you to log in`;
    return '';
  }

  /* -------------------------------------------------------------- readers */
  function facebookPosts() {
    const group = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*Facebook$/, '').trim();
    const out = [];
    for (const art of document.querySelectorAll('[role="article"]')) {
      if (art.parentElement && art.parentElement.closest('[role="article"]')) continue; // comments are articles inside a post
      const link = [...art.querySelectorAll('a[href]')].find((a) => /\/groups\/[^/]+\/(posts|permalink)\/\d+|[?&]story_fbid=\d+|\/permalink\.php/.test(a.href));
      const body = pick(art, ['[data-ad-preview="message"]', '[data-ad-comet-preview="message"]', '[dir="auto"][style*="text-align"]']) || art;
      const text = txt(body).slice(0, 3000);
      if (text.length < 15) continue;
      const author = txt(pick(art, ['h2 a', 'h3 a', 'h4 a', 'strong a', 'h2', 'h3'])).split('\n')[0].slice(0, 80);
      const url = link ? link.href.split('?')[0] : '';
      const postId = (url.match(/\/(?:posts|permalink)\/(\d+)/) || [])[1] || hash(author + text.slice(0, 200));
      out.push({ id: `facebook:${postId}`, place: group, url, author, text, ageText: link ? link.getAttribute('aria-label') || txt(link) : '' });
    }
    return out;
  }
  function linkedinPosts() {
    const out = [];
    for (const el of document.querySelectorAll('[data-urn*="urn:li:activity:"], .feed-shared-update-v2')) {
      if (el.parentElement && el.parentElement.closest('[data-urn*="urn:li:activity:"]')) continue;
      const urn = ((el.getAttribute('data-urn') || (el.querySelector('[data-urn*="urn:li:activity:"]') || { getAttribute: () => '' }).getAttribute('data-urn')).match(/urn:li:activity:\d+/) || [])[0];
      const text = txt(pick(el, ['.update-components-text', '.feed-shared-update-v2__description', '.feed-shared-text', '.break-words'])).slice(0, 3000);
      if (text.length < 15) continue;
      const author = txt(pick(el, ['.update-components-actor__title span[aria-hidden="true"]', '.update-components-actor__name span[aria-hidden="true"]', '.update-components-actor__name', '.feed-shared-actor__name'])).split('\n')[0];
      const headline = txt(pick(el, ['.update-components-actor__description span[aria-hidden="true"]', '.update-components-actor__description', '.feed-shared-actor__description'])).split('\n')[0];
      const age = txt(pick(el, ['.update-components-actor__sub-description span[aria-hidden="true"]', '.update-components-actor__sub-description', '.feed-shared-actor__sub-description'])).split(/•|·/)[0].trim();
      // "Founder at Gloss Garage" -> the company, so the post can be linked to a lead you already have.
      const company = (headline.match(/\b(?:at|@)\s+([^|•,]+)/i) || [])[1] || '';
      out.push({ id: `linkedin:${urn || hash(author + text.slice(0, 200))}`, place: 'LinkedIn posts', url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '', author, headline, company: company.trim(), text, ageText: age });
    }
    return out;
  }
  function linkedinJobs() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[data-job-id], [data-occludable-job-id]')) {
      const id = el.getAttribute('data-job-id') || el.getAttribute('data-occludable-job-id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const title = txt(pick(el, ['.job-card-list__title strong', '.job-card-list__title', 'a[href*="/jobs/view/"] strong', 'a[href*="/jobs/view/"]'])).split('\n')[0];
      if (!title) continue;
      const company = txt(pick(el, ['.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description', '.job-card-container__company-name'])).split('\n')[0];
      const where = txt(pick(el, ['.artdeco-entity-lockup__caption', '.job-card-container__metadata-item', '.job-card-container__metadata-wrapper']));
      const time = el.querySelector('time');
      out.push({ id: `linkedin:job:${id}`, place: 'LinkedIn jobs', url: `https://www.linkedin.com/jobs/view/${id}/`, author: company, company, title, text: `${company} · ${where}`, ageText: time ? time.getAttribute('datetime') || txt(time) : '', job: true });
    }
    return out;
  }
  const read = () => (kind() === 'group' ? facebookPosts() : kind() === 'jobs' ? linkedinJobs() : kind() === 'posts' ? linkedinPosts() : []);

  /* ---------------------------------------------------------------- button */
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
      .box{position:fixed;right:20px;bottom:20px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:6px;font:600 13px/1.3 system-ui,sans-serif}
      button{font:inherit;padding:10px 14px;border-radius:999px;border:0;background:#111;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      button.ghost{background:#fff;color:#111;border:1px solid #ccc;box-shadow:none;padding:6px 12px}
      button[disabled]{opacity:.7;cursor:default}
      .msg{max-width:300px;background:#fff;color:#111;border:1px solid #ddd;border-radius:10px;padding:8px 10px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.12)}
      .msg:empty{display:none}
    </style><div class="box"><div class="msg" data-msg></div><button type="button" class="ghost" data-scroll>Scroll and scan</button><button type="button" data-scan>Scan for leads</button></div>`;
  const msgEl = root.querySelector('[data-msg]');
  const scanBtn = root.querySelector('[data-scan]');
  const scrollBtn = root.querySelector('[data-scroll]');
  let busy = false;
  let stop = false;

  async function scan() {
    const posts = read();
    const blocked = wall(posts.length > 0);
    if (blocked) {
      await send({ type: 'intent:scan', source: site, blocked, url: location.href });
      msgEl.textContent = `${blocked}. Lead Hunter paused ${site === 'linkedin' ? 'LinkedIn' : 'Facebook'} scans. Sort it out here, then press Resume on the Intent tab.`;
      return;
    }
    if (!posts.length) {
      msgEl.textContent = 'No posts found on this part of the page. Scroll down a little and try again.';
      return;
    }
    const res = await send({ type: 'intent:scan', source: site, posts, url: location.href });
    if (!res) return (msgEl.textContent = 'Lead Hunter is not running. Reload this page.');
    const s = res.stats || {};
    const skipped = [s.seller && `${s.seller} sellers`, s.old && `${s.old} older than 14 days`, s.duplicates && `${s.duplicates} already saved`, s.foreign && `${s.foreign} not in the UAE`].filter(Boolean);
    msgEl.textContent = `Read ${s.seen} ${kind() === 'jobs' ? 'jobs' : 'posts'} · ${s.saved} saved to the Intent tab${skipped.length ? ` · ${skipped.join(' · ')}` : ''}`;
  }

  scanBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    scanBtn.disabled = true;
    await scan();
    scanBtn.disabled = false;
    busy = false;
  });
  // A few small scrolls, a human pace apart, then one scan. Press again to stop.
  scrollBtn.addEventListener('click', async () => {
    if (busy) return (stop = true);
    busy = true;
    stop = false;
    scanBtn.disabled = true;
    scrollBtn.textContent = 'Stop';
    const steps = 5;
    for (let i = 0; i < steps && !stop; i++) {
      if (wall(read().length > 0)) break;
      window.scrollBy({ top: 500 + Math.random() * 600, behavior: 'smooth' });
      const wait = 4000 + Math.random() * 8000;
      msgEl.textContent = `Scrolling ${i + 1} of ${steps}…`;
      for (let t = 0; t < wait && !stop; t += 250) await sleep(250);
    }
    await scan();
    scrollBtn.textContent = 'Scroll and scan';
    scanBtn.disabled = false;
    busy = false;
  });

  let shownFor = null;
  setInterval(() => {
    const k = kind();
    const at = k ? location.pathname : '';
    if (at === shownFor) return;
    shownFor = at;
    msgEl.textContent = '';
    if (k && !host.isConnected) document.documentElement.appendChild(host);
    if (!k && host.isConnected) host.remove();
  }, 700);
})();
