// BirdCam client-side Push subscription UI. Only public VAPID key stored here.
(function(){
 "use strict";
 const base="https://dsvcawulshkzlalpkbnf.supabase.co";
 const apiKey="sb_publishable_p7cYRIZCdOOTrf2KhkYH8g_cqYK-aIu";
 const vapidPublic="BGm-3WML-928hitA6K80WkT6OuH12Lzv6c_1tkw4hXSafF7eHBUqNTSxiTU4i2nlbpgwBPbm2wI7yuFsyTCT_7o";
 let auth=null, working=false;
 const panel=document.createElement("section");
 panel.id="birdcamPushSettings";
 panel.innerHTML='<h3>🔔 Notifiche push sul Pixel (beta)</h3><p class="muted">Ricevi un avviso quando la fototrappola invia nuove foto al cloud, anche con questa pagina chiusa. Autorizza le notifiche del browser quando richiesto.</p><p><button id="birdcamEnablePush">Attiva notifiche</button> <button id="birdcamTestPush">Invia notifica di prova</button> <button id="birdcamDisablePush">Disattiva</button></p><p id="birdcamPushStatus" class="muted" role="status">Accedi prima a BirdCam Cloud.</p>';
 const cloud=document.getElementById("cloud");
 cloud.parentNode.insertBefore(panel,cloud.nextSibling);
 const el=id=>document.getElementById(id);
 function msg(text){el("birdcamPushStatus").textContent=text}
 function buttons(){const active=!!auth;["birdcamEnablePush","birdcamTestPush","birdcamDisablePush"].forEach(id=>el(id).disabled=!active||working);}
 function getKeys(){if(!window.Notification||!navigator.serviceWorker||!window.PushManager)throw Error("Notifiche push non supportate da questo browser. Usa Firefox o Chrome aggiornato su Android.");}
 function decode(b64){const padding="=".repeat((4-b64.length%4)%4);const s=atob((b64+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(s,c=>c.charCodeAt(0));}
 async function currentAuth(){if(!auth)throw Error("Effettua prima l'accesso a BirdCam.");return auth();}
 async function request(path,token,opts){const r=await fetch(base+path,{...opts,headers:{apikey:apiKey,Authorization:"Bearer "+token,"Content-Type":"application/json",...(opts.headers||{})}});if(!r.ok){let e="HTTP "+r.status;try{const j=await r.json();e=j.message||j.error||e}catch{}throw Error(e);}return r;}
 async function registration(){return navigator.serviceWorker.register("./birdcam-sw.js",{scope:"./"});}
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
 el("birdcamDisablePush").addEventListener("click",disable);
 window.BirdCamPush={setAuth:function(fn){auth=fn;if(!fn)msg("Accedi prima a BirdCam Cloud.");buttons();}};
 buttons();
})();
