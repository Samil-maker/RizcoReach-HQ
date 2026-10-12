/* Lead Hunter: runs in the page's own JS world at document_start. Mirrors the
   Ad Library's search responses to the extension's content script via
   postMessage. It only reads responses; nothing is changed or blocked. */
(() => {
  if (window.__leadHunterHooked) return;
  window.__leadHunterHooked = true;

  const WATCH = /\/api\/graphql|\/ads\/library\/async/;
  const relay = (url, text) => {
    // Ads, or an Ad Library search answer with no ads in it (needed to tell "no ads" from "not loaded").
    if (typeof text !== 'string' || (text.indexOf('ad_archive_id') === -1 && text.indexOf('search_results_connection') === -1)) return;
    window.postMessage({ __leadHunter: 1, kind: 'payload', url: String(url), text }, location.origin);
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__lhUrl = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (WATCH.test(String(this.__lhUrl || ''))) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') relay(this.__lhUrl, this.responseText);
          else if (this.responseType === 'json' && this.response) relay(this.__lhUrl, JSON.stringify(this.response));
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input) {
    const p = nativeFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      if (WATCH.test(String(url || ''))) {
        p.then((r) => r.clone().text())
          .then((t) => relay(url, t))
          .catch(() => {});
      }
    } catch {}
    return p;
  };
})();
