// Minimal service worker — satisfies push registration without doing anything
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(x) {}
  e.waitUntil(self.registration.showNotification(
    data.title || 'Arcgate Walkathon',
    { body: data.body || '', icon: './logo-icon.png', badge: './logo-icon.png' }
  ));
});
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('./participant.html'));
});
