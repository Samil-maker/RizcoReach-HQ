import type { Config } from '@netlify/functions';

/**
 * Optional Google Lighthouse scores via the PageSpeed Insights API.
 * Enabled only when the PAGESPEED_API_KEY environment variable is set in Netlify
 * (a Google Cloud API key with "PageSpeed Insights API" enabled). The key never
 * reaches the browser.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const FIELDS = [
  'lighthouseResult/categories/*/score',
  'lighthouseResult/audits/largest-contentful-paint/numericValue',
  'lighthouseResult/audits/cumulative-layout-shift/numericValue',
  'lighthouseResult/audits/total-blocking-time/numericValue',
  'lighthouseResult/audits/first-contentful-paint/numericValue',
  'lighthouseResult/audits/speed-index/numericValue',
].join(',');

export default async (req: Request) => {
  const key = Netlify.env.get('PAGESPEED_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 503);

  const raw = (new URL(req.url).searchParams.get('url') ?? '').trim();
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(target.protocol) || !target.hostname.includes('.')) throw new Error();
  } catch {
    return json({ error: 'invalid_url' }, 400);
  }

  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', target.toString());
  api.searchParams.set('strategy', 'mobile');
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) api.searchParams.append('category', c);
  api.searchParams.set('fields', FIELDS);
  api.searchParams.set('key', key);

  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(24000) });
    if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);
    const data = (await res.json()) as any;
    const cats = data?.lighthouseResult?.categories ?? {};
    const audits = data?.lighthouseResult?.audits ?? {};
    const score = (k: string) => (typeof cats[k]?.score === 'number' ? Math.round(cats[k].score * 100) : null);
    const num = (k: string) => (typeof audits[k]?.numericValue === 'number' ? audits[k].numericValue : null);
    return json({
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
      lcp: num('largest-contentful-paint'),
      cls: num('cumulative-layout-shift'),
      tbt: num('total-blocking-time'),
      fcp: num('first-contentful-paint'),
      si: num('speed-index'),
    });
  } catch {
    return json({ error: 'timeout' }, 504);
  }
};

export const config: Config = {
  path: '/api/pagespeed',
};
