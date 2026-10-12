/* Lead Hunter: runs in the Google Maps page's own JS world at document_start (only matters in the
   tab Lead Hunter opens for a business search). Mirrors Maps' own search responses
   (/search?tbm=map…) to content/maps.js so phone numbers and websites can be read for every
   result without clicking each one. Read-only. */
(() => {
  if (window.__leadHunterMapsHook) return;
  window.__leadHunterMapsHook = true;
  const WATCH = /\/search\?.*tbm=map|\/maps\/preview\/place/;
  const relay = (url, text) => {
    if (typeof text === 'string' && text.length > 50) window.postMessage({ __leadHunterMaps: 1, url: String(url), text }, location.origin);
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
      if (WATCH.test(String(url || ''))) p.then((r) => r.clone().text()).then((t) => relay(url, t)).catch(() => {});
    } catch {}
    return p;
  };
})();
