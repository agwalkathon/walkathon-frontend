// Arcgate Walkathon 2026 - Push Notification Service Worker
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'Arcgate Walkathon', body: event.data ? event.data.text() : '' }; }
  var title   = data.title || 'Arcgate Walkathon 2026';
  var options = {
    body:    data.body || '',
    icon:    '/agwalk/logo-icon.png',
    badge:   '/agwalk/logo-icon.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || 'https://agwalkathon.github.io/agwalk/participant.html' },
    actions: [{ action: 'open', title: 'View' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://agwalkathon.github.io/agwalk/participant.html';
  event.waitUntil(clients.openWindow(url));
});
