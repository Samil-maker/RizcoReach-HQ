// Outside services: phone alerts, Meta's Graph API and Ziina payments.
export const GRAPH_VERSION = 'v26.0';

export async function pushNotify(subscriptions, payload) {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
  if (!pub || !priv || !subscriptions.length) return [];
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails('mailto:support@elheen.com', pub, priv);
  const dead = [];
  await Promise.all(subscriptions.map((sub) =>
    webpush.sendNotification(sub, JSON.stringify(payload)).catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint); })));
  return dead;
}

export async function graphFetch(path, { method = 'GET', params = {} } = {}) {
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `Facebook request failed: ${res.status}`);
  return data;
}

export async function ziinaFetch(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api-v2.ziina.com/api/${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Ziina said ${res.status}`);
  return data;
}

// Settings read from Netlify's environment.
export function envFromProcess() {
  const siteUrl = process.env.ELHEEN_URL || process.env.URL || 'https://elheen.com';
  return {
    ELHEEN_INVITE: process.env.ELHEEN_INVITE,
    ELHEEN_ADMIN_KEY: process.env.ELHEEN_ADMIN_KEY,
    siteUrl,
    ziina: ziinaFetch,
    billing: process.env.ZIINA_TOKEN ? { token: process.env.ZIINA_TOKEN, test: process.env.ZIINA_TEST === 'true' } : null,
    pushKey: process.env.VAPID_PUBLIC_KEY || null,
    notify: pushNotify,
    graph: graphFetch,
    meta: {
      appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET, verifyToken: process.env.META_VERIFY_TOKEN,
      redirectUri: `${siteUrl}/api/meta/callback`,
    },
  };
}
