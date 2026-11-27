// BirdCam push worker — no fetch interception and no photo deletion.
// A small independent IndexedDB log makes push delivery diagnosable even when the tab is closed.
function logPush(stage, detail) {
  return new Promise(function(resolve) {
    try {
      const request = indexedDB.open("birdcam_push_diag_v1", 1);
      request.onupgradeneeded = function() {
        const db = request.result;
        if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", {keyPath:"id", autoIncrement:true});
      };
      request.onerror = function() { resolve(); };
      request.onsuccess = function() {
        const db = request.result;
        const tx = db.transaction("events", "readwrite");
        tx.objectStore("events").add({at:Date.now(), stage:stage, detail:String(detail||"").slice(0,160)});
        tx.oncomplete = function() { db.close(); resolve(); };
        tx.onerror = function() {db.close();resolve();};
        tx.onabort = function() {db.close();resolve();};
      };
    } catch (_) {resolve();}
  });
}
self.addEventListener("push", function(event) {
  event.waitUntil((async function(){
    await logPush("push-ricevuto", "Evento dal servizio push");
    try {
      await self.registration.showNotification("🐦 BirdCam · Movimento rilevato", {
        body:"È stata caricata una nuova fotografia. Tocca per aprire BirdCam.",
        data:{url:new URL("cloud-test.html",self.registration.scope).href},
        tag:"birdcam-capture-"+Date.now(),
        timestamp:Date.now()
      });
      await logPush("notifica-richiamata", "showNotification completato");
    } catch(e) {
      await logPush("errore-notifica", e && e.message || e);
      throw e;
    }
  })());
});
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url || new URL("cloud-test.html",self.registration.scope).href;
  event.waitUntil((async function(){
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        if ("navigate" in client) await client.navigate(url);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
