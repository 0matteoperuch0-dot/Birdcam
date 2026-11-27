(function () {
  "use strict";
  const settings = window.BIRDCAM_CLOUD || {};
  const base = (settings.url || "").replace(new RegExp("/$"), "");
  const key = settings.publishableKey || "";
  const enabled = /^https:\/\/.+\.supabase\.co$/.test(base) && !!key;
  const bucket = "birdcam-photos";
  const stateKey = "birdcam_cloud_session_v1";
  const doneKey = "birdcam_cloud_uploaded_v1";
  const deviceKey = "birdcam_cloud_device_v1";
  const device = localStorage.getItem(deviceKey) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  localStorage.setItem(deviceKey, device);
  let session = null, busy = false, timer = null;
  const root = document.createElement("section");
  root.className = "panel";
  root.style.marginTop = "16px";
  root.innerHTML = '<h2>☁️ Condivisione remota (beta)</h2><p class="help">Test: le foto locali non vengono cancellate; nuovi JPEG copiati nel cloud ogni 15 secondi quando Safari è attivo. Pulizia automatica e notifiche push non ancora attive.</p><div id="cloudAuth"><input id="cloudEmail" type="email" placeholder="Email" style="width:100%;margin-bottom:8px;padding:10px"><input id="cloudPassword" type="password" placeholder="Password" style="width:100%;margin-bottom:8px;padding:10px"><div class="actions"><button id="cloudLogin">Accedi</button><button id="cloudSignup">Crea account</button><button id="cloudLogout" style="display:none">Esci</button><button id="cloudSync">Invia foto in attesa</button></div></div><p id="cloudStatus" class="help" role="status"></p><div class="gallery" id="cloudGallery"></div><div class="actions"><button id="cloudRefresh">Aggiorna galleria online</button></div>';
  const main = document.querySelector("main.wrap");
  const footer = main.querySelector(".footer");
  main.insertBefore(root, footer);
  const el = id => document.getElementById(id);
  const status = text => { el("cloudStatus").textContent = text };
  function headers(token, json) {
    const h = { apikey: key, Authorization: "Bearer " + (token || key) };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }
  async function request(path, opts) {
    const r = await fetch(base + path, opts);
    if (!r.ok) {
      let msg = "";
      try { msg = (await r.json()).message || ""; } catch (_) {}
      throw Error(msg || ("HTTP " + r.status));
    }
    return r;
  }
  function saved() { try { return JSON.parse(localStorage.getItem(doneKey + "_" + session.user.id) || "{}"); } catch (_) { return {}; } }
  function updateSession(s) {
    session = s;
    if (s) localStorage.setItem(stateKey, JSON.stringify(s)); else localStorage.removeItem(stateKey);
    el("cloudLogin").style.display = s ? "none" : "";
    el("cloudSignup").style.display = s ? "none" : "";
    el("cloudLogout").style.display = s ? "" : "none";
    el("cloudEmail").style.display = s ? "none" : "";
    el("cloudPassword").style.display = s ? "none" : "";
  }
  async function ensureToken() {
    if (!session) throw Error("Accedi prima di sincronizzare.");
    if (Date.now() < session.expires_at - 60000) return session.access_token;
    const r = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: headers(null, true),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const d = await r.json();
    updateSession({ ...d, expires_at: Date.now() + d.expires_in * 1000 });
    return session.access_token;
  }
  async function login(signup) {
    if (!enabled) return status("Condivisione non configurata: serve un progetto Supabase dedicato.");
    const email = el("cloudEmail").value.trim(), password = el("cloudPassword").value;
    if (!email || !password) return status("Inserisci email e password.");
    try {
      const path = signup ? ("/auth/v1/signup?redirect_to=" + encodeURIComponent(location.origin + "/Birdcam/birdcam-beta.html")) : "/auth/v1/token?grant_type=password";
      const r = await request(path, { method: "POST", headers: headers(null, true), body: JSON.stringify({ email, password }) });
      const d = await r.json();
      if (!d.access_token) return status("Controlla la tua email per confermare l'account, poi accedi.");
      updateSession({ ...d, expires_at: Date.now() + d.expires_in * 1000 });
      el("cloudPassword").value = "";
      status("Connesso. Invio fotografie in attesa…");
      await sync();
      await gallery();
    } catch (e) { status("Accesso non riuscito: " + e.message); }
  }
  function getCaptures(sent) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("birdcam_v1", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("captures")) {
          const store = db.createObjectStore("captures", { keyPath: "id", autoIncrement: true });
          store.createIndex("date", "date");
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("captures", "readonly");
        const items = [];
        const cursor = tx.objectStore("captures").openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c || items.length >= 10) return resolve(items);
          const item = c.value;
          if (item.kind === "foto" && !sent[device + "_" + item.id]) items.push(item);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
        tx.oncomplete = () => db.close();
      };
    });
  }
  function notifiedEvents() {
    try { return JSON.parse(localStorage.getItem("birdcam_push_notified_v1_" + session.user.id) || "{}"); }
    catch (_) { return {}; }
  }
  function pendingEvents() {
    try { return JSON.parse(localStorage.getItem("birdcam_beta_push_queue_v1_" + session.user.id) || "{}"); }
    catch (_) { return {}; }
  }
  function savePending(events) { localStorage.setItem("birdcam_beta_push_queue_v1_" + session.user.id, JSON.stringify(events)); }
  function queueEvent(eventId) {
    if (!eventId || notifiedEvents()[eventId]) return;
    const pending = pendingEvents();
    if (!pending[eventId]) pending[eventId] = Date.now();
    savePending(pending);
  }
  async function flushPending(token) {
    const pending = pendingEvents();
    const ids = Object.keys(pending).sort((a,b)=>pending[a]-pending[b]).slice(0,10);
    for (const id of ids) {
      try {
        await notifyEvent(id, token);
        delete pending[id];
        savePending(pending);
      } catch(e) {
        status("Foto al sicuro nel cloud; ritenterò l'avviso push: "+e.message);
        break;
      }
    }
  }
  async function notifyEvent(eventId, token) {
    if (!eventId) return;
    const notified = notifiedEvents();
    if (notified[eventId]) return;
    const r = await request("/functions/v1/birdcam-push", {
      method: "POST", headers: headers(token, true), body: JSON.stringify({kind:"capture"})
    });
    const result = await r.json();
    // Accepted by the push endpoint (0 subscribers is valid until the Pixel opts in).
    notified[eventId] = Date.now();
    // Keep history bounded to avoid filling iPad localStorage.
    const keys = Object.keys(notified);
    if (keys.length > 500) {
      keys.sort((a,b)=>notified[a]-notified[b]);
      for (const key of keys.slice(0, keys.length-500)) delete notified[key];
    }
    localStorage.setItem("birdcam_push_notified_v1_" + session.user.id, JSON.stringify(notified));
    if (result.failed) status("Foto online; "+result.failed+" invii push non riusciti.");
  }
  async function sync() {
    if (!enabled || !session || busy || !navigator.onLine) return;
    busy = true;
    try {
      const token = await ensureToken();
      const sent = saved();
      const items = (await getCaptures(sent)).sort((a,b) => a.date - b.date);
      let count = 0;
      for (const item of items) {
        const marker = device + "_" + item.id;
        if (sent[marker]) continue;
        const path = encodeURIComponent(session.user.id) + "/" + encodeURIComponent(marker + ".jpg");
        await request("/storage/v1/object/" + bucket + "/" + path, {
          method: "POST",
          headers: { ...headers(token), "Content-Type": "image/jpeg", "x-upsert": "false" },
          body: item.blob
        }).catch(async e => { if (!/already exists|409/i.test(e.message)) throw e; });
        sent[marker] = true;
        localStorage.setItem(doneKey + "_" + session.user.id, JSON.stringify(sent));
        count++;
        if (item.eventId) queueEvent(item.eventId);
      }
      status("Archivio online sincronizzato. Nuove foto inviate: " + count + ".");
      await flushPending(token);
      // La pulizia reale del cloud è disattivata nella versione beta per proteggere le foto.
    } catch (e) { status("Invio sospeso: " + e.message + ". Le foto restano sull'iPad."); }
    finally { busy = false; }
  }

  // Quota guard for this private bucket. Storage Free quota is shared across the organization;
  // this is a BirdCam safety threshold, not an authoritative organization usage meter.
  const quotaBytes = 1024 * 1024 * 1024;
  let lastCleanup = 0;
  async function allOnline() {
    const token = await ensureToken(), files = [];
    let offset = 0;
    while (true) {
      const r = await request("/storage/v1/object/list/" + bucket, {
        method: "POST", headers: headers(token, true),
        body: JSON.stringify({prefix: session.user.id, limit: 100, offset, sortBy: {column: "created_at", order: "asc"}})
      });
      const page = await r.json();
      files.push(...page.filter(f => f.name && f.name.endsWith(".jpg")));
      if (page.length < 100) break;
      offset += 100;
      if (offset > 10000) throw Error("Troppi file da verificare: pulizia sospesa.");
    }
    return files.map(f => ({...f, path: session.user.id + "/" + f.name, bytes: Number(f.metadata?.size || 0)}));
  }
  async function favourites() {
    const token = await ensureToken();
    const r = await request("/rest/v1/birdcam_favorites?select=object_name&user_id=eq." + session.user.id, {headers: headers(token)});
    return new Set((await r.json()).map(x => x.object_name));
  }
  async function setFavourite(path, enabled) {
    const token = await ensureToken();
    if (enabled) {
      await request("/rest/v1/birdcam_favorites", {
        method: "POST", headers: {...headers(token, true), Prefer: "resolution=merge-duplicates"},
        body: JSON.stringify({user_id: session.user.id, object_name: path})
      });
    } else {
      await request("/rest/v1/birdcam_favorites?user_id=eq." + session.user.id + "&object_name=eq." + encodeURIComponent(path),
        {method: "DELETE", headers: headers(token)});
    }
  }
  async function cleanup() {
    if (!session || Date.now() - lastCleanup < 300000) return;
    lastCleanup = Date.now();
    const photos = await allOnline();
    if (photos.some(p => !p.bytes)) {status("Pulizia sospesa: dimensioni file mancanti."); return;}
    let bytesUsed = photos.reduce((sum, p) => sum + p.bytes, 0);
    if (bytesUsed < quotaBytes * .80) return;
    const keep = await favourites();
    const candidates = photos.filter(p => !keep.has(p.path)).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    const token = await ensureToken();
    let removed = 0;
    for (const photo of candidates) {
      if (bytesUsed <= quotaBytes * .70) break;
      await request("/storage/v1/object/" + bucket, {
        method: "DELETE", headers: headers(token, true), body: JSON.stringify({prefixes: [photo.path]})
      });
      bytesUsed -= photo.bytes;
      removed++;
    }
    status("Pulizia cloud: " + removed + " foto vecchie eliminate. Le preferite sono protette." + (bytesUsed > quotaBytes*.70 ? " Spazio ancora alto: controlla i preferiti." : ""));
  }

  async function gallery() {
    if (!enabled || !session) return;
    try {
      const token = await ensureToken();
      const prefix = session.user.id;
      const r = await request("/storage/v1/object/list/" + bucket, {
        method: "POST", headers: headers(token,true),
        body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: "created_at", order: "desc" } })
      });
      const photos = (await r.json()).filter(x => x.name && x.name.endsWith(".jpg"));
      const fav = await favourites();
      el("cloudGallery").replaceChildren();
      for (const p of photos) {
        const path = prefix + "/" + p.name;
        const sr = await request("/storage/v1/object/sign/" + bucket + "/" + encodeURIComponent(path).replace(/%2F/g, "/"), {
          method: "POST", headers: headers(token,true), body: JSON.stringify({ expiresIn: 600 })
        });
        const signed = await sr.json();
        const a = document.createElement("a");
        a.href = base + "/storage/v1" + signed.signedURL;
        a.target = "_blank"; a.rel = "noopener noreferrer";
        const img = document.createElement("img");
        img.className = "thumb"; img.loading = "lazy"; img.src = a.href; img.alt = p.name;
        a.appendChild(img);
        const tile = document.createElement("div");
        tile.appendChild(a);
        const favourite = document.createElement("button");
        favourite.textContent = fav.has(path) ? "★ Preferita" : "☆ Preferita";
        favourite.addEventListener("click", async () => {
          try {await setFavourite(path, !fav.has(path)); await gallery();}
          catch(e) {status("Preferito non aggiornato: " + e.message);}
        });
        tile.appendChild(favourite);
        el("cloudGallery").appendChild(tile);
      }
      status("Fotografie online: " + photos.length + " (ultime 100).");
    } catch (e) { status("Impossibile leggere la galleria: " + e.message); }
  }
  el("cloudLogin").addEventListener("click", () => login(false));
  el("cloudSignup").addEventListener("click", () => login(true));
  el("cloudLogout").addEventListener("click", () => { updateSession(null); el("cloudGallery").replaceChildren(); status("Disconnesso."); });
  el("cloudSync").addEventListener("click", sync);
  el("cloudRefresh").addEventListener("click", gallery);
  if (!enabled) {
    status("Funzione in preparazione: Supabase dedicato non ancora configurato. Nessun dato viene trasmesso.");
  } else {
    try { const old = JSON.parse(localStorage.getItem(stateKey) || "null"); if (old) updateSession(old); } catch (_) {}
    if (session) { sync(); gallery(); }
    timer = setInterval(sync, 15000);
    window.addEventListener("online", sync);
  }
})();