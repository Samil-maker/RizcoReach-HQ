/* Lead Hunter: "Add to Lead Hunter" on Instagram profiles (content script on instagram.com).
   Nothing runs by itself: the profile you are looking at is read only when you press the button,
   so Instagram sees normal browsing and your account is never at risk from it. */
(() => {
  if (window.__leadHunterIg) return;
  window.__leadHunterIg = true;

  const NOT_PROFILE = /^(p|reel|reels|stories|explore|direct|accounts|tv|about|legal|developer|web|challenge|emails|session|privacy|terms)$/i;
  const handleFromPath = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(parts[0]) && !NOT_PROFILE.test(parts[0]) ? parts[0] : '';
  };
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  const meta = (doc, sel) => ((doc.querySelector(sel) || {}).content || '').trim();
  const forHandle = (doc, handle) => new RegExp(`@${handle.replace(/\./g, '\\.')}(?![\\w.])`, 'i').test(meta(doc, 'meta[property="og:title"]') + ' ' + meta(doc, 'meta[name="description"]'));

  /* Instagram's own page description: "1,234 Followers, 56 Following, 78 Posts - Name (@user) on Instagram: "bio"". */
  function fromMeta(doc, handle) {
    const title = meta(doc, 'meta[property="og:title"]') || doc.title || '';
    const desc = meta(doc, 'meta[name="description"]') || meta(doc, 'meta[property="og:description"]');
    const name = (title.match(/^(.*?)\s*\(@/) || [])[1] || '';
    const followers = (desc.match(/([\d.,]+\s*[KkMm]?)\s+followers/i) || [])[1] || '';
    const bio = (desc.match(/on Instagram:\s*["“](.*)["”]\s*$/is) || [])[1] || '';
    return { username: handle, name: name.trim(), followers: followers.replace(/\s/g, ''), bio: bio.trim() };
  }

  async function readProfile(handle) {
    // Moving between profiles inside Instagram can leave the old profile's details in the page: load this one's once.
    let doc = document;
    if (!forHandle(document, handle)) {
      try {
        const res = await fetch(`/${handle}/`, { credentials: 'include' });
        doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      } catch {}
    }
    const profile = fromMeta(doc, handle);
    // Links in the bio (Instagram wraps them as l.instagram.com/?u=...), plus the visible bio text as a fallback.
    const header = document.querySelector('header') || document.body;
    profile.links = [...header.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => !/^https:\/\/(www\.)?instagram\.com\//.test(h)).slice(0, 10);
    if (!profile.bio) profile.bio = (header.innerText || '').slice(0, 600);
    return profile;
  }

  /* The button: bottom right, only on profile pages. */
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
      button{position:fixed;right:20px;bottom:20px;z-index:2147483647;font:600 14px/1 system-ui,sans-serif;padding:12px 16px;border-radius:999px;border:0;
        background:#111;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}
      button[disabled]{opacity:.7;cursor:default}
      button.ok{background:#1a7f37}
    </style><button type="button">+ Add to Lead Hunter</button>`;
  const btn = root.querySelector('button');
  let shownFor = '';

  btn.addEventListener('click', async () => {
    const handle = handleFromPath();
    if (!handle) return;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const res = await send({ type: 'instagram:add', profile: await readProfile(handle) });
    btn.disabled = false;
    btn.className = res && !res.error ? 'ok' : '';
    btn.textContent = !res ? 'Lead Hunter is not running. Reload this page' : res.error ? res.error : res.added ? 'Added to Lead Hunter' : res.contacted ? 'You contacted them before' : 'Already in Lead Hunter';
  });

  setInterval(() => {
    const handle = handleFromPath();
    if (handle === shownFor) return;
    shownFor = handle;
    btn.className = '';
    btn.disabled = false;
    btn.textContent = '+ Add to Lead Hunter';
    if (handle && !host.isConnected) document.documentElement.appendChild(host);
    if (!handle && host.isConnected) host.remove();
  }, 700);
})();
