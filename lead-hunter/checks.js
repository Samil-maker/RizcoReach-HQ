/* Lead Hunter: email checks (loaded by background.js, shares its scope).
   A wrong address bounces, and bounces hurt the inbox that sent them. So before an address can go into the cold
   email file it passes three checks:
     1. Its shape (lib/emails.js): typos fixed, broken and placeholder addresses dropped. Done the moment it is found.
     2. Its domain: does it exist and receive email at all? Asked from public DNS (dns.google, then Cloudflare).
        Free, no key, every address.
     3. Its mailbox: does that exact address exist? Asked from QuickEmailVerification with your own key (Settings >
        Email check; their free plan gives 100 a day). Only spent on businesses that fit, best address first.
   An address that fails is kept on the lead, crossed out with the reason, so it is never used and never checked twice. */

/* ------------------------------------------------------------------ domain */
const DNS_SERVERS = [
  (d) => [`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`, {}],
  (d) => [`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=MX`, { headers: { accept: 'application/dns-json' } }],
];
const DNS_GOOD_FOR = 21 * LH.DAY; // a domain that receives email keeps doing so
const DNS_BAD_FOR = 3 * LH.DAY; // a new business may set its email up next week
/** Does this domain receive email: { s: 'dns' } | { s: 'bad', why } | null when no DNS server answered. */
async function domainCheck(domain) {
  const { dnsCache = {} } = await store.get('dnsCache');
  const hit = dnsCache[domain];
  if (hit && now() - hit[2] < (hit[0] === 'dns' ? DNS_GOOD_FOR : DNS_BAD_FOR)) return { s: hit[0], why: hit[1] };
  let verdict = null;
  for (const make of DNS_SERVERS) {
    try {
      const [url, init] = make(domain);
      const res = await fetch(url, { ...init, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      verdict = LH.dnsVerdict(await res.json());
      if (verdict) break;
    } catch {}
  }
  if (!verdict) return null;
  await locked(async () => {
    const { dnsCache: c = {} } = await store.get('dnsCache');
    c[domain] = [verdict.s, verdict.why || '', now()];
    const keys = Object.keys(c);
    if (keys.length > 4000) for (const k of keys.sort((a, b) => c[a][2] - c[b][2]).slice(0, 1000)) delete c[k];
    await store.set({ dnsCache: c });
  });
  return verdict;
}

/* ----------------------------------------------------------------- mailbox */
const utcDay = () => new Date().toISOString().slice(0, 10);
async function verifyUsed() {
  const { verifyUsage } = await store.get('verifyUsage');
  return verifyUsage && verifyUsage.day === utcDay() ? verifyUsage : { day: utcDay(), count: 0 };
}
async function mailboxCheck(email, settings) {
  const res = await fetch(LH.verifyUrl(email, settings.verifyKey), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(45000) });
  const data = await res.json().catch(() => ({}));
  return LH.verifyParse(res.status, data);
}
/** Mailbox checks may run: a key, no alert, not waiting, and some of today's allowance left. */
async function mailboxOpen(settings) {
  if (!settings.verifyKey) return false;
  const { alerts = {}, verifyWait } = await store.get(['alerts', 'verifyWait']);
  if (alerts.verify || (verifyWait && verifyWait.until > now())) return false;
  return (await verifyUsed()).count < Math.max(0, Number(settings.verifyDailyCap) || 0);
}

/* ------------------------------------------------------------------- queue */
/* emailCheckQueue: leads whose addresses still need a look. mailboxQueue: leads that fit and wait for a mailbox
   check (there are only so many a day). Both survive the worker restarting. */
async function queueEmailChecks(ids, front = false) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return;
  await locked(async () => {
    const { emailCheckQueue = [] } = await store.get('emailCheckQueue');
    const rest = emailCheckQueue.filter((x) => !ids.includes(x));
    await store.set({ emailCheckQueue: front ? [...ids, ...rest] : [...rest, ...ids] });
  });
  runEmailChecks();
}
async function dropFrom(queue, id) {
  await locked(async () => {
    const got = await store.get(queue);
    await store.set({ [queue]: (got[queue] || []).filter((x) => x !== id) });
  });
}
const saveCheck = (id, email, v) => updateLead(id, (l) => (l.emailCheck = { ...(l.emailCheck || {}), [email]: { s: v.s, why: v.why || '', at: now() } }));

let emailCheckBusy = false;
let emailCheckAgain = false; // something was queued while a run was going: run once more when it ends
async function runEmailChecks() {
  if (emailCheckBusy) return void (emailCheckAgain = true);
  emailCheckBusy = true;
  emailCheckAgain = false;
  try {
    // 1. Domains: every lead, straight away.
    for (;;) {
      const { emailCheckQueue = [], bouncedEmails = {} } = await store.get(['emailCheckQueue', 'bouncedEmails']);
      const id = emailCheckQueue[0];
      if (!id) break;
      const settings = await getSettings();
      let lead = await getLead(id);
      let failed = false;
      for (const x of lead ? LH.emailInfo(lead).filter((e) => e.state === 'unchecked') : []) {
        const v = bouncedEmails[x.email] ? { s: 'bad', why: 'It bounced before' } : await domainCheck(x.email.split('@').pop());
        if (v) await saveCheck(id, x.email, v);
        else failed = true;
      }
      await dropFrom('emailCheckQueue', id);
      if (failed) {
        // No DNS server answered (offline?): the sweep picks this lead up again later.
        await logProblem('verify', 'The domain check got no answer. It will be tried again.');
        break;
      }
      lead = await getLead(id);
      // 2. Mailboxes: only for a business that fits, so the daily allowance goes where it matters.
      if (lead && settings.verifyKey && LH.coldEmailOpen(lead) && LH.fit(lead, settings).fit && LH.emailsToCheck(lead, settings).length)
        await locked(async () => {
          const { mailboxQueue = [] } = await store.get('mailboxQueue');
          if (!mailboxQueue.includes(id)) await store.set({ mailboxQueue: [...mailboxQueue, id] });
        });
    }
    for (;;) {
      const settings = await getSettings();
      const { mailboxQueue = [] } = await store.get('mailboxQueue');
      const id = mailboxQueue[0];
      if (!id || !(await mailboxOpen(settings))) break;
      const lead = await getLead(id);
      let stopped = false;
      if (lead && LH.coldEmailOpen(lead) && LH.fit(lead, settings).fit) {
        for (const x of LH.emailsToCheck(lead, settings)) {
          if (x.state !== 'unverified') continue; // its domain has not been checked yet
          if (!(await mailboxOpen(settings))) {
            stopped = true;
            break;
          }
          const v = await mailboxCheck(x.email, settings).catch((e) => ({ retry: true, wait: 5 * 60000, error: `The email check could not be reached (${String(e.message || e).slice(0, 80)})` }));
          if (v.stop) {
            await alertSource('verify', v.error, 'https://quickemailverification.com/', 'Check the key in Settings > Email check, then press Resume there.');
            stopped = true;
            break;
          }
          if (v.out || v.retry) {
            // Out for today: wait for their new day (midnight UTC). Otherwise a short wait.
            const until = v.out ? Date.parse(`${utcDay()}T00:00:00Z`) + LH.DAY + 5 * 60000 : now() + (v.wait || 5 * 60000);
            await store.set({ verifyWait: { until, why: v.error } });
            await logProblem('verify', v.error);
            stopped = true;
            break;
          }
          await locked(async () => {
            const u = await verifyUsed();
            await store.set({ verifyUsage: { day: u.day, count: u.count + 1 } });
          });
          await saveCheck(id, x.email, v);
          await sleep(jitter(600, 1400));
          if (v.s === 'ok') break; // one confirmed address is all the file needs
        }
      }
      if (stopped) break;
      await dropFrom('mailboxQueue', id);
    }
  } finally {
    emailCheckBusy = false;
    if (emailCheckAgain) runEmailChecks();
  }
}

/** Every lead with an address still to check goes (back) into the queue. */
async function sweepEmailChecks() {
  const settings = await getSettings();
  const ids = (await allLeads()).filter((l) => LH.emailsToCheck(l, settings).length).map((l) => l.id);
  await queueEmailChecks(ids);
  return ids.length;
}

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
  'verify:status': async () => {
    const settings = await getSettings();
    const { emailCheckQueue = [], mailboxQueue = [], alerts = {}, verifyWait, bouncedEmails = {} } = await store.get(['emailCheckQueue', 'mailboxQueue', 'alerts', 'verifyWait', 'bouncedEmails']);
    return {
      key: !!settings.verifyKey,
      used: (await verifyUsed()).count,
      cap: Math.max(0, Number(settings.verifyDailyCap) || 0),
      queued: emailCheckQueue.length,
      mailboxQueued: mailboxQueue.length,
      wait: verifyWait && verifyWait.until > now() ? verifyWait : null,
      alert: alerts.verify || null,
      bounced: Object.keys(bouncedEmails).length,
    };
  },
  /** Is the key right? Asked from their sandbox, which uses none of the day's checks. */
  'verify:test': async (msg) => {
    const key = String((msg && msg.key) || (await getSettings()).verifyKey || '').trim();
    if (!key) return { error: 'Paste your key first.' };
    try {
      const res = await fetch(LH.verifyUrl('valid@example.com', key, true), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
      const data = await res.json().catch(() => ({}));
      const v = LH.verifyParse(res.status, data);
      if (v.stop || v.out || v.retry) return { error: v.error };
      return { ok: true };
    } catch (e) {
      return { error: `The email check could not be reached (${String(e.message || e).slice(0, 80)})` };
    }
  },
  'verify:resume': async () => {
    await store.remove('verifyWait');
    await clearAlert('verify');
    return { queued: await sweepEmailChecks() };
  },
  'verify:check': async (msg) => (await queueEmailChecks(msg.ids || [], true), { ok: true }),
  'emails:bounced': async (msg) => importBounces(msg.text),
});

chrome.alarms.onAlarm.addListener((a) => a.name === 'tick' && runEmailChecks());
// A new key, or mailbox checks switched on: everything that was waiting for one gets its turn.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const was = (changes.settings.oldValue || {}).verifyKey || '';
  const is = (changes.settings.newValue || {}).verifyKey || '';
  if (is && is !== was) store.remove('verifyWait').then(() => clearAlert('verify')).then(sweepEmailChecks);
});
chrome.runtime.onInstalled.addListener(() => sweepEmailChecks());
chrome.runtime.onStartup.addListener(() => runEmailChecks());
runEmailChecks();
