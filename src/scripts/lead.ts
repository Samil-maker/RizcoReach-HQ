/**
 * Every lead (contact form + tool email gates) is posted to the single Netlify
 * form "contact", so all submissions arrive through the same notification.
 * `lead_source` tells you where it came from.
 */
export async function submitLead(fields: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({ 'form-name': 'contact', ...fields });
  body.set('language', document.documentElement.lang || 'en');
  body.set('page', location.pathname);
  const res = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Form submission failed (${res.status})`);
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function normalizeUrl(v: string): string | null {
  let s = v.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
