self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action = event.action || 'open';
    const payload = event.notification.data || {};

    event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        if (allClients.length > 0) {
            const client = allClients[0];
            client.focus();
            client.postMessage({
                type: 'notification-action',
                action,
                payload
            });
            return;
        }

        const openUrl = new URL('./', self.location.origin);
        if (action && action !== 'open') {
            openUrl.searchParams.set('notificationAction', action);
        }
        await self.clients.openWindow(openUrl.toString());
    })());
});
