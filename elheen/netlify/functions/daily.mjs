// Every morning at 9:00 Dubai time, tell each owner how many follow-ups are waiting.
import { getStore } from '@netlify/blobs';
import { billingOf, quoteTotals, computeTasks } from '../lib/core.mjs';
import { pushNotify } from '../lib/services.mjs';

export async function morningDigest(store, notify, now = Date.now()) {
  const list = async (prefix) => {
    const { blobs } = await store.list({ prefix });
    return (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  };
  let sent = 0;
  for (const biz of await list('biz/')) {
    if (!(biz.push || []).length || billingOf(biz, now).state === 'overdue') continue;
    const [leads, quotes] = await Promise.all([list(`leads/${biz.slug}/`), list(`quotes/${biz.slug}/`)]);
    const tasks = computeTasks(biz, leads, quotes.map((q) => ({ ...q, totals: quoteTotals(q, !!biz.vatRegistered) })), now);
    if (!tasks.length) continue;
    const quotesDue = tasks.filter((t) => t.type === 'quote').length;
    await notify(biz.push, {
      title: `${tasks.length} follow-up${tasks.length > 1 ? 's' : ''} today`,
      body: quotesDue ? `${quotesDue} quote${quotesDue > 1 ? 's' : ''} waiting for an answer. ${tasks[0].title}.` : `${tasks[0].title}.`,
      url: '/app',
    });
    sent++;
  }
  return sent;
}

export default async () => {
  const sent = await morningDigest(getStore({ name: 'elheen', consistency: 'strong' }), pushNotify);
  return new Response(`sent ${sent}`);
};
export const config = { schedule: '0 5 * * *' };
