// BirdCam Web Push, test viewer. Does not cache or intercept app requests.
self.addEventListener("push", function(event) {
  event.waitUntil(self.registration.showNotification("🐦 BirdCam · Movimento rilevato", {
    body: "È stata caricata una nuova fotografia. Tocca per aprire BirdCam.",
    data: { url: new URL("cloud-test.html", self.registration.scope).href },
    timestamp: Date.now()
  }));
});
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url || new URL("cloud-test.html", self.registration.scope).href;
  event.waitUntil((async function(){
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        if ("navigate" in client) await client.navigate(url);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
