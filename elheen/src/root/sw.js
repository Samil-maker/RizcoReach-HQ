// Elheen service worker: shows a phone alert when a new enquiry arrives.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'New enquiry', body: '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'New enquiry', {
    body: data.body || '', icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', data: { url: data.url || '/app' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const open = list.find((c) => c.url.includes('/app'));
    return open ? open.focus() : self.clients.openWindow(e.notification.data.url);
  }));
});
