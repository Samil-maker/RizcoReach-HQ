import type { Config } from '@netlify/functions';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Free website audit: fetches a public page server-side and runs on-page SEO,
 * performance, mobile/conversion and trust checks. No API key required.
 * Returns facts + pass/warn/fail per check; the browser renders the copy.
 */

type Status = 'pass' | 'warn' | 'fail';
interface Check {
  id: string;
  cat: 'seo' | 'speed' | 'mobile' | 'trust';
  status: Status;
  value?: string | number;
  weight?: number;
}

const UA = 'Mozilla/5.0 (compatible; RizcoReachAudit/1.0; +https://www.rizcoreach.ae/tools/website-audit)';
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/* ---------------------------------------------------------- SSRF guards */
function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function assertPublic(u: URL) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('unsupported_protocol');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('unsupported_port');
  if (u.username || u.password) throw new Error('credentials_not_allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private_host');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private_host');
    return;
  }
  if (!host.includes('.')) throw new Error('invalid_host');
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private_host');
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, buf.length - off)), off);
    off += c.byteLength;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/** fetch with manual, re-validated redirects. */
async function safeFetch(start: URL, timeoutMs: number, method = 'GET') {
  let url = start;
  const t0 = performance.now();
  let ttfb = 0;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublic(url);
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en,ar;q=0.8' },
    });
    if (!ttfb) ttfb = performance.now() - t0;
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      try {
        await res.body?.cancel();
      } catch {}
      continue;
    }
    return { res, url, redirects: i, ttfb: Math.round(ttfb) };
  }
  throw new Error('too_many_redirects');
}

/* ------------------------------------------------------------ Parsing */
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
};
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const metaContent = (html: string, key: string, by = 'name') => {
  for (const t of tags(html, 'meta')) {
    if ((attr(t, by) || '').toLowerCase() === key) return decode(attr(t, 'content') ?? '');
  }
  return null;
};

export function analyse(html: string, finalUrl: URL, headers: Headers, ttfb: number, bytes: number) {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const head = html.split(/<\/head>/i)[0] ?? html;
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

  // --- SEO
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  add({ id: 'title', cat: 'seo', weight: 2, value: title.length, status: !title ? 'fail' : title.length >= 25 && title.length <= 65 ? 'pass' : 'warn' });

  const desc = (metaContent(html, 'description') ?? '').trim();
  add({ id: 'description', cat: 'seo', weight: 2, value: desc.length, status: !desc ? 'fail' : desc.length >= 70 && desc.length <= 165 ? 'pass' : 'warn' });

  const h1s = (html.match(/<h1\b[\s\S]*?<\/h1>/gi) ?? []).length;
  add({ id: 'h1', cat: 'seo', weight: 2, value: h1s, status: h1s === 1 ? 'pass' : h1s === 0 ? 'fail' : 'warn' });

  const h2s = (html.match(/<h2\b/gi) ?? []).length;
  add({ id: 'headings', cat: 'seo', value: h2s, status: h2s >= 2 ? 'pass' : h2s === 1 ? 'warn' : 'fail' });

  const canonical = tags(head, 'link').find((t) => (attr(t, 'rel') || '').toLowerCase() === 'canonical');
  add({ id: 'canonical', cat: 'seo', status: canonical ? 'pass' : 'warn' });

  const robots = (metaContent(html, 'robots') ?? '').toLowerCase();
  const xRobots = (headers.get('x-robots-tag') ?? '').toLowerCase();
  add({ id: 'indexable', cat: 'seo', weight: 3, status: robots.includes('noindex') || xRobots.includes('noindex') ? 'fail' : 'pass' });

  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang');
  add({ id: 'lang', cat: 'seo', value: lang ?? '', status: lang ? 'pass' : 'warn' });

  const hasSchema = /<script[^>]+application\/ld\+json/i.test(html) || /itemtype=["']https?:\/\/schema\.org/i.test(html);
  add({ id: 'schema', cat: 'seo', status: hasSchema ? 'pass' : 'warn' });

  const imgs = tags(html, 'img');
  const withAlt = imgs.filter((t) => attr(t, 'alt') !== null).length;
  const altPct = imgs.length ? Math.round((withAlt / imgs.length) * 100) : 100;
  add({ id: 'alt', cat: 'seo', value: imgs.length ? `${withAlt}/${imgs.length}` : '0', status: altPct >= 90 ? 'pass' : altPct >= 60 ? 'warn' : 'fail' });

  const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  add({ id: 'content', cat: 'seo', value: words, status: words >= 300 ? 'pass' : words >= 120 ? 'warn' : 'fail' });

  const anchors = tags(html, 'a').map((t) => attr(t, 'href') ?? '');
  const internal = anchors.filter((href) => {
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return false;
    try {
      return new URL(href, finalUrl).hostname === finalUrl.hostname;
    } catch {
      return false;
    }
  }).length;
  add({ id: 'links', cat: 'seo', value: internal, status: internal >= 5 ? 'pass' : internal >= 2 ? 'warn' : 'fail' });

  // --- Speed (static signals)
  add({ id: 'ttfb', cat: 'speed', weight: 2, value: ttfb, status: ttfb < 800 ? 'pass' : ttfb < 1800 ? 'warn' : 'fail' });
  const kb = Math.round(bytes / 1024);
  add({ id: 'htmlSize', cat: 'speed', value: kb, status: kb < 120 ? 'pass' : kb < 350 ? 'warn' : 'fail' });

  const enc = (headers.get('content-encoding') ?? '').toLowerCase();
  add({ id: 'compression', cat: 'speed', value: enc || 'none', status: /br|gzip|zstd|deflate/.test(enc) ? 'pass' : 'warn' });

  const blocking = tags(head, 'script').filter((t) => attr(t, 'src') && !/\s(async|defer)\b/i.test(t) && (attr(t, 'type') ?? '').toLowerCase() !== 'module').length;
  add({ id: 'renderBlocking', cat: 'speed', weight: 2, value: blocking, status: blocking === 0 ? 'pass' : blocking <= 3 ? 'warn' : 'fail' });

  const css = tags(head, 'link').filter((t) => (attr(t, 'rel') || '').toLowerCase() === 'stylesheet').length;
  add({ id: 'stylesheets', cat: 'speed', value: css, status: css <= 4 ? 'pass' : css <= 9 ? 'warn' : 'fail' });

  const lazy = imgs.filter((t) => (attr(t, 'loading') ?? '').toLowerCase() === 'lazy').length;
  add({
    id: 'lazy',
    cat: 'speed',
    value: imgs.length ? `${lazy}/${imgs.length}` : '0',
    status: imgs.length <= 4 || lazy / imgs.length >= 0.4 ? 'pass' : lazy > 0 ? 'warn' : 'fail',
  });

  const sources = [
    ...imgs.flatMap((t) => [attr(t, 'src') ?? '', attr(t, 'srcset') ?? '']),
    ...tags(html, 'source').map((t) => `${attr(t, 'srcset') ?? ''} ${attr(t, 'type') ?? ''}`),
  ].join(' ');
  const modern = /\.(webp|avif)\b|image\/(webp|avif)|[?&](fm|format|f)=(webp|avif|auto)/i.test(sources) || /\/_next\/image|\/_vercel\/image|\/\.netlify\/images|cdn-cgi\/image/i.test(sources);
  add({ id: 'modernImages', cat: 'speed', status: imgs.length === 0 || modern ? 'pass' : 'warn' });

  // --- Mobile & conversion
  const viewport = metaContent(html, 'viewport') ?? '';
  add({ id: 'viewport', cat: 'mobile', weight: 3, status: /width\s*=\s*device-width/i.test(viewport) ? 'pass' : 'fail' });
  add({ id: 'zoom', cat: 'mobile', status: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport) ? 'warn' : 'pass' });

  const hasCall = anchors.some((h) => /^tel:/i.test(h));
  const hasWa = anchors.some((h) => /wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(h));
  add({ id: 'contactLinks', cat: 'mobile', weight: 2, value: [hasCall && 'tel', hasWa && 'whatsapp'].filter(Boolean).join(',') || 'none', status: hasCall || hasWa ? 'pass' : 'fail' });

  const forms = (html.match(/<form\b/gi) ?? []).length;
  const emailLink = anchors.some((h) => /^mailto:/i.test(h));
  add({ id: 'leadCapture', cat: 'mobile', weight: 2, value: forms, status: forms > 0 ? 'pass' : emailLink ? 'warn' : 'fail' });

  const icon = tags(head, 'link').some((t) => /icon/i.test(attr(t, 'rel') ?? ''));
  add({ id: 'favicon', cat: 'mobile', status: icon ? 'pass' : 'warn' });

  // --- Trust & security
  add({ id: 'https', cat: 'trust', weight: 3, status: finalUrl.protocol === 'https:' ? 'pass' : 'fail' });
  const hsts = !!headers.get('strict-transport-security');
  add({ id: 'hsts', cat: 'trust', status: hsts ? 'pass' : 'warn' });
  const mixed = finalUrl.protocol === 'https:' && /\s(src|href)=["']http:\/\/(?!www\.w3\.org)/i.test(html.replace(/<a\b[^>]*>/gi, ''));
  add({ id: 'mixedContent', cat: 'trust', status: mixed ? 'warn' : 'pass' });
  const og = !!metaContent(html, 'og:title', 'property') && !!metaContent(html, 'og:image', 'property');
  add({ id: 'social', cat: 'trust', status: og ? 'pass' : 'warn' });

  return { checks, title, description: desc, words };
}

async function probe(url: URL, timeout = 3500) {
  try {
    const { res } = await safeFetch(url, timeout);
    const ok = res.ok;
    const text = ok ? (await readCapped(res)).slice(0, 20000) : '';
    if (!ok) await res.body?.cancel().catch(() => {});
    return { ok, text };
  } catch {
    return { ok: false, text: '' };
  }
}

export default async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const raw = (new URL(req.url).searchParams.get('url') ?? '').trim();
  if (!raw || raw.length > 2048) return json({ error: 'invalid_url' }, 400);

  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return json({ error: 'invalid_url' }, 400);
  }

  const started = performance.now();
  let page;
  try {
    page = await safeFetch(target, 8000);
  } catch (e) {
    const msg = (e as Error).message;
    if (/private|unsupported|credentials|invalid_host/.test(msg)) return json({ error: 'invalid_url' }, 400);
    // Retry over http if https failed outright (some small sites still lack TLS).
    if (target.protocol === 'https:' && !/^https:\/\//i.test(raw)) {
      try {
        target = new URL(target.toString().replace(/^https:/, 'http:'));
        page = await safeFetch(target, 6000);
      } catch {
        return json({ error: 'unreachable' }, 502);
      }
    } else return json({ error: 'unreachable' }, 502);
  }

  const { res, url: finalUrl, redirects, ttfb } = page;
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return json({ error: 'http_error', status: res.status }, 502);
  }
  if (!/html/i.test(type)) {
    await res.body?.cancel().catch(() => {});
    return json({ error: 'not_html' }, 422);
  }
  const html = await readCapped(res);
  const bytes = new TextEncoder().encode(html).byteLength;
  const result = analyse(html, finalUrl, res.headers, ttfb, bytes);

  const origin = new URL(finalUrl.origin);
  const [robotsTxt, sitemapDefault, httpRedirect] = await Promise.all([
    probe(new URL('/robots.txt', origin)),
    probe(new URL('/sitemap.xml', origin)),
    finalUrl.protocol === 'https:'
      ? safeFetch(new URL(finalUrl.toString().replace(/^https:/, 'http:')), 3500, 'HEAD')
          .then(({ url }) => url.protocol === 'https:')
          .catch(() => null)
      : Promise.resolve(false),
  ]);
  const sitemapInRobots = /^\s*sitemap\s*:/im.test(robotsTxt.text);
  result.checks.push({ id: 'robotsTxt', cat: 'seo', status: robotsTxt.ok ? 'pass' : 'warn' });
  result.checks.push({
    id: 'sitemap',
    cat: 'seo',
    status: sitemapInRobots || (sitemapDefault.ok && /<(urlset|sitemapindex)/i.test(sitemapDefault.text)) ? 'pass' : 'warn',
  });
  if (httpRedirect !== null) result.checks.push({ id: 'httpRedirect', cat: 'trust', status: httpRedirect ? 'pass' : 'warn' });

  return json({
    url: target.toString(),
    finalUrl: finalUrl.toString(),
    redirects,
    status: res.status,
    ttfb,
    durationMs: Math.round(performance.now() - started),
    bytes,
    title: result.title,
    description: result.description,
    words: result.words,
    checks: result.checks,
    pagespeed: !!Netlify.env.get('PAGESPEED_API_KEY'),
  });
};

export const config: Config = {
  path: '/api/audit',
};
