/* Lead Hunter: pure helpers for businesses found on Google Maps and Instagram (used by finder.js; unit-tested in node). */
(function (root) {
  const LH = (root.LH = root.LH || {});

  /** Keys that identify the same business across sources (Maps place, Instagram handle, website domain, phone). */
  LH.prospectKeys = (item) => {
    const keys = [];
    if (item.maps && item.maps.placeId) keys.push(`m:${item.maps.placeId}`);
    if (item.instagram && item.instagram.username) keys.push(`i:${item.instagram.username.toLowerCase()}`);
    if (item.website && LH.linkKind(item.website) === 'website') keys.push(`d:${LH.rootDomain(item.website)}`);
    for (const n of [...(item.phones || []), ...(item.whatsapp || [])]) if (n) keys.push(`p:${n}`);
    return keys;
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
