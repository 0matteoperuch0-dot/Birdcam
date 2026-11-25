(function () {
  "use strict";
  const settings = window.BIRDCAM_CLOUD || {};
  const base = (settings.url || "").replace(/\\/$/, "");
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
  root.innerHTML = '<h2>☁️ Condivisione remota (beta)</h2><p class="help">Le foto rimangono nell’archivio locale; gli originali vengono copiati in un archivio privato quando la connessione è disponibile. Safari deve restare attivo.</p><div id="cloudAuth"><input id="cloudEmail" type="email" placeholder="Email" style="width:100%;margin-bottom:8px;padding:10px"><input id="cloudPassword" type="password" placeholder="Password" style="width:100%;margin-bottom:8px;padding:10px"><div class="actions"><button id="cloudLogin">Accedi</button><button id="cloudSignup">Crea account</button><button id="cloudLogout" style="display:none">Esci</button><button id="cloudSync">Invia foto in attesa</button></div></div><p id="cloudStatus" class="help" role="status"></p><div class="gallery" id="cloudGallery"></div><div class="actions"><button id="cloudRefresh">Aggiorna galleria online</button></div>';
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
  function saved() { try { return JSON.parse(localStorage.getItem(doneKey) || "{}"); } catch (_) { return {}; } }
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
      const path = signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
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
  function getCaptures() {
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
        const get = tx.objectStore("captures").getAll();
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
      };
    });
  }
  async function sync() {
    if (!enabled || !session || busy || !navigator.onLine) return;
    busy = true;
    try {
      const token = await ensureToken();
      const sent = saved();
      const items = (await getCaptures()).filter(x => x.kind === "foto").sort((a,b) => a.date - b.date);
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
        localStorage.setItem(doneKey, JSON.stringify(sent));
        count++;
      }
      status("Archivio online sincronizzato. Nuove foto inviate: " + count + ".");
    } catch (e) { status("Invio sospeso: " + e.message + ". Le foto restano sull'iPad."); }
    finally { busy = false; }
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
        a.appendChild(img); el("cloudGallery").appendChild(a);
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