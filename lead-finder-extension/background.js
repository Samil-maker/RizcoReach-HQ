// Clicking the toolbar icon opens the Lead Finder side panel.
importScripts('leads.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// The Maps collector asks this when a business only lists a landline: many show
// a WhatsApp or mobile number on their own website instead.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'rr-find-mobile') return undefined;
  findMobileOnWebsite(msg.url, msg.country).then(sendResponse, () => sendResponse(null));
  return true;
});

async function findMobileOnWebsite(url, country) {
  const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const res = await fetch(target, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 1500000);
  const candidates = [];
  let m;
  const whatsapp = /(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=|whatsapp:\/\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=)\+?(\d{8,15})/gi;
  while ((m = whatsapp.exec(html))) candidates.push({ raw: '+' + m[1], source: 'WhatsApp link on their website' });
  const tel = /href\s*=\s*["']\s*tel:([^"']+)["']/gi;
  while ((m = tel.exec(html))) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* keep as is */
    }
    candidates.push({ raw: raw, source: 'phone link on their website' });
  }
  for (const c of candidates) {
    const p = LF.normalizePhone(c.raw, country);
    if (p && p.type === 'mobile') return { e164: p.e164, type: p.type, country: p.country, source: c.source };
  }
  return null;
}
