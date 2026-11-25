/* Lead Hunter: addresses that bounced (loaded by background.js, shares its scope). Pasted in Settings, or the cold
   email system's bounce list: never used again, on any lead. */
/** Addresses that bounced (pasted, or the cold email system's bounce list): never used again, on any lead. */
async function importBounces(text) {
  const found = [...new Set((String(text || '').match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+/g) || []).map((x) => x.replace(/^mailto:/i, '').replace(/[.]+$/, '').toLowerCase()))];
  if (!found.length) return { found: 0, leads: 0 };
  await locked(async () => {
    const { bouncedEmails = {} } = await store.get('bouncedEmails');
    for (const e of found) bouncedEmails[e] = bouncedEmails[e] || now();
    await store.set({ bouncedEmails });
  });
  const set = new Set(found);
  let leads = 0;
  for (const l of await allLeads()) {
    const hit = (l.emails || []).map((e) => String(e).toLowerCase()).filter((e) => set.has(e) || set.has(LH.cleanEmail(e).email));
    if (!hit.length) continue;
    leads++;
    await updateLead(l.id, (x) => (x.badEmails = [...new Set([...(x.badEmails || []), ...hit, ...hit.map((e) => LH.cleanEmail(e).email).filter(Boolean)])]));
  }
  return { found: found.length, leads };
}

Object.assign(handlers, {
  'emails:bounced': async (msg) => importBounces(msg.text),
});
