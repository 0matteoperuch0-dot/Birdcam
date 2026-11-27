// BirdCam client-side Push subscription UI. Only public VAPID key stored here.
(function(){
 "use strict";
 const base="https://dsvcawulshkzlalpkbnf.supabase.co";
 const apiKey="sb_publishable_p7cYRIZCdOOTrf2KhkYH8g_cqYK-aIu";
 const vapidPublic="BGm-3WML-928hitA6K80WkT6OuH12Lzv6c_1tkw4hXSafF7eHBUqNTSxiTU4i2nlbpgwBPbm2wI7yuFsyTCT_7o";
 let auth=null, working=false;
 const panel=document.createElement("section");
 panel.id="birdcamPushSettings";
 panel.innerHTML='<h3>🔔 Notifiche push sul Pixel (beta)</h3><p class="muted">Ricevi un avviso quando la fototrappola invia nuove foto al cloud, anche con questa pagina chiusa. Autorizza le notifiche del browser quando richiesto.</p><p><button id="birdcamEnablePush">Attiva notifiche</button> <button id="birdcamTestPush">Invia notifica di prova</button> <button id="birdcamLocalPush">Prova notifica sul telefono</button> <button id="birdcamPushDiag">Diagnostica</button> <button id="birdcamDisablePush">Disattiva</button></p><p id="birdcamPushStatus" class="muted" role="status">Accedi prima a BirdCam Cloud.</p>';
 const cloud=document.getElementById("cloud");
 cloud.parentNode.insertBefore(panel,cloud.nextSibling);
 const el=id=>document.getElementById(id);
 function msg(text){el("birdcamPushStatus").textContent=text}
 function buttons(){const active=!!auth;["birdcamEnablePush","birdcamTestPush","birdcamLocalPush","birdcamPushDiag","birdcamDisablePush"].forEach(id=>el(id).disabled=!active||working);}
 function getKeys(){if(!window.Notification||!navigator.serviceWorker||!window.PushManager)throw Error("Notifiche push non supportate da questo browser. Usa Firefox o Chrome aggiornato su Android.");}
 function decode(b64){const padding="=".repeat((4-b64.length%4)%4);const s=atob((b64+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(s,c=>c.charCodeAt(0));}
 async function currentAuth(){if(!auth)throw Error("Effettua prima l'accesso a BirdCam.");return auth();}
 async function request(path,token,opts){const r=await fetch(base+path,{...opts,headers:{apikey:apiKey,Authorization:"Bearer "+token,"Content-Type":"application/json",...(opts.headers||{})}});if(!r.ok){let e="HTTP "+r.status;try{const j=await r.json();e=j.message||j.error||e}catch{}throw Error(e);}return r;}
 async function registration(){return navigator.serviceWorker.register("./birdcam-sw.js?v=2",{scope:"./"});}
 async function enable(){
  if(working)return;
  try{
   getKeys();
   // Android permission prompt must happen directly after the user clicks.
   let permission=Notification.permission;
   if(permission==="default") permission=await Notification.requestPermission();
   if(permission!=="granted")throw Error("Notifiche non consentite. Attivale dalle impostazioni del browser.");
   working=true;buttons();msg("Registrazione del dispositivo in corso...");
   const cred=await currentAuth();
   const reg=await registration();
   let sub=await reg.pushManager.getSubscription();
   if(sub&&sub.options&&sub.options.applicationServerKey){
     const stored=new Uint8Array(sub.options.applicationServerKey);
     const expected=decode(vapidPublic);
     if(stored.length!==expected.length||stored.some((b,i)=>b!==expected[i])){await sub.unsubscribe();sub=null;}
   }
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(vapidPublic)});
   const details=sub.toJSON();
   if(!details.keys||!details.keys.p256dh||!details.keys.auth)throw Error("Dati di iscrizione incompleti");
   await request("/rest/v1/birdcam_push_subscriptions",cred.token,{
      method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({endpoint:sub.endpoint,user_id:cred.userId,p256dh:details.keys.p256dh,auth:details.keys.auth,updated_at:new Date().toISOString()})
   });
   msg("✅ Notifiche attivate su questo browser. Premi «Invia notifica di prova» per verificare.");
  }catch(e){msg("Attivazione: "+e.message)}finally{working=false;buttons()}
 }
 async function testPush(){
  if(working)return;working=true;buttons();msg("Invio notifica di prova...");
  try{
   const cred=await currentAuth();
   const r=await request("/functions/v1/birdcam-push",cred.token,{method:"POST",body:JSON.stringify({kind:"test"})});
   const result=await r.json();
   if(result.sent>0)msg("Push inviati ai servizi di notifica: "+result.sent+". Controlla gli avvisi del telefono."+(result.failed?" Invii falliti: "+result.failed:""));
   else msg("Nessuna notifica consegnata. Iscrizioni: "+result.subscribed+"; errori: "+result.failed+". "+JSON.stringify(result.detail||[]));
  }catch(e){msg("Test push: "+e.message)}finally{working=false;buttons()}
 }
 async function testLocalNotification(){
  if(working)return;working=true;buttons();
  try{
    getKeys();
    if(Notification.permission!=="granted")throw Error("Autorizza prima le notifiche con «Attiva notifiche».");
    const reg=await registration();
    await navigator.serviceWorker.ready;
    await reg.showNotification("🔔 BirdCam · Test sul telefono",{
       body:"Questo avviso è stato creato direttamente da Firefox, senza Supabase.",
       tag:"birdcam-local-"+Date.now(),
       data:{url:new URL("cloud-test.html",location.href).href}
    });
    msg("Il browser ha richiesto la notifica locale. Se non la vedi, controlla il pannello notifiche Android e le autorizzazioni dell'app Firefox.");
  }catch(e){msg("Notifica locale: "+e.message)}
  finally{working=false;buttons();}
 }
 function readPushLog(){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open("birdcam_push_diag_v1",1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("events"))db.createObjectStore("events",{keyPath:"id",autoIncrement:true})};
      req.onerror=()=>resolve([]);
      req.onsuccess=()=>{
        const db=req.result;const tx=db.transaction("events","readonly");
        const cur=tx.objectStore("events").openCursor(null,"prev");const output=[];
        cur.onsuccess=()=>{const c=cur.result;if(!c||output.length>=6)return resolve(output);output.push(c.value);c.continue();};
        cur.onerror=()=>resolve(output);
        tx.oncomplete=()=>db.close();
      };
    }catch(e){resolve([]);}
  });
 }
 async function diagnostics(){
  if(working)return;working=true;buttons();
  try{
    getKeys();const reg=await registration();await reg.update();
    const sub=await reg.pushManager.getSubscription();
    const history=await readPushLog();
    const events=history.map(x=>new Date(x.at).toLocaleTimeString("it-IT")+": "+x.stage).join(" | ");
    msg("Permesso Firefox: "+Notification.permission+
        ". Worker: "+(reg.active?"attivo":"in attesa")+
        ". Iscrizione push: "+(sub?"presente":"assente")+
        ". Eventi ricevuti su questo telefono: "+(events||"nessuno registrato")+
        ". Se vedi nessun evento dopo l'invio, il problema è nella consegna da Mozilla a Firefox.");
  }catch(e){msg("Diagnostica: "+e.message)}
  finally{working=false;buttons();}
 }
 async function disable(){
  if(working)return;working=true;buttons();
  try{
   getKeys();const cred=await currentAuth();const reg=await registration();const sub=await reg.pushManager.getSubscription();
   if(sub){
    await request("/rest/v1/birdcam_push_subscriptions?endpoint=eq."+encodeURIComponent(sub.endpoint),cred.token,{method:"DELETE"});
    await sub.unsubscribe();
   }
   msg("Notifiche disattivate su questo browser.");
  }catch(e){msg("Disattivazione: "+e.message)}finally{working=false;buttons()}
 }
 el("birdcamEnablePush").addEventListener("click",enable);
 el("birdcamTestPush").addEventListener("click",testPush);
 el("birdcamLocalPush").addEventListener("click",testLocalNotification);
 el("birdcamPushDiag").addEventListener("click",diagnostics);
 el("birdcamDisablePush").addEventListener("click",disable);
 window.BirdCamPush={setAuth:function(fn){auth=fn;if(!fn)msg("Accedi prima a BirdCam Cloud.");buttons();}};
 buttons();
})();
