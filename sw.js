self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  e.waitUntil(
    self.registration.showNotification('This Week', {
      body: "Time to check your tasks!",
      tag: 'checklist-reminder',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const appUrl = 'https://aravmanchanda15.github.io/checklist-app/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(appUrl) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(appUrl);
    })
  );
});
