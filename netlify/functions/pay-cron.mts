import type { Config } from '@netlify/functions';
import { runScheduled, runtime } from './pay.mts';

/**
 * Every hour: create the invoices that recurring plans are due for, queue payment reminders, send queued
 * emails, and take a second look at payments that never came back to the receipt page.
 * The work is `runScheduled` in pay.mts. Netlify only runs scheduled functions on the live site.
 */
export default async () => {
  const { env, mail, store } = runtime();
  const done = await runScheduled(store, env, { mail });
  console.log(`pay-cron: ${done.invoices} recurring, ${done.reminders} reminders, ${done.paid} paid, ${done.emails} emails`);
};

export const config: Config = {
  schedule: '5 * * * *',
};
