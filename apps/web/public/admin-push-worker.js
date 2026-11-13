self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    data = null;
  }
  event.waitUntil(
    self.registration.showNotification(data?.title || 'Burger Tilín', {
      body: data?.body || 'Abrí el admin para ver tus pedidos.',
      tag: data?.tag || 'tilin',
      icon: '/admin-icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const admin = windows.find((client) => new URL(client.url).pathname === '/admin');
      if (admin) {
        admin.postMessage({ type: 'show-orders' });
        return admin.focus();
      }
      return self.clients.openWindow('/admin');
    })(),
  );
});
