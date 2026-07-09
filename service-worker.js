/* Agreement Studio — service worker.
   Caches the app shell so it installs and launches like an app.
   IMPORTANT: never caches your Supabase API responses (those stay live). */
const VERSION = "athena-agreements-v39";
const SHELL = [
  "./", "./index.html", "./studio.html", "./manifest.webmanifest",
  "./app.js", "./logo.js", "./docgen.js", "./agreement.js", "./config.js",
  "./modules/_shared.js", "./modules/governance.js", "./modules/dashboard.js", "./modules/access.js", "./modules/approvals.js",
  "./modules/library.js", "./modules/negotiate.js", "./modules/manual.js",
  "./icons/athena-mark.svg"
];
// static CDN libraries are safe to cache; the live DB host is NOT.
const CACHE_HOSTS = ["cdn.jsdelivr.net","cdnjs.cloudflare.com","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL).catch(()=>{})).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const req=e.request; if(req.method!=="GET") return;
  const url=new URL(req.url);

  // never intercept Supabase (auth/data/storage) — always go to network
  if(url.hostname.endsWith("supabase.co")) return;

  // app navigations (incl. the Studio iframe): network-first, fall back to the right cached shell
  if(req.mode==="navigate"){
    e.respondWith((async()=>{
      try{ return await fetch(req); }
      catch(_){
        const isStudio = new URL(req.url).pathname.indexOf("studio.html")>=0;
        return (await caches.match(isStudio?"./studio.html":"./index.html")) || Response.error();
      }
    })());
    return;
  }
  // CDN libs/fonts: cache-first
  if(CACHE_HOSTS.includes(url.hostname)){
    e.respondWith(caches.open(VERSION).then(async c=>{ const hit=await c.match(req);
      const net=fetch(req).then(r=>{ if(r&&(r.ok||r.type==="opaque")) c.put(req,r.clone()); return r; }).catch(()=>hit);
      return hit||net; })); return;
  }
  // same-origin static files: NETWORK-FIRST so a deploy shows up on a normal refresh
  // (cache is only a fallback when offline). Keeps installable/offline behaviour intact.
  if(url.origin===self.location.origin){
    e.respondWith((async()=>{
      try{
        const r = await fetch(req);
        if(r && r.ok){ const cp=r.clone(); caches.open(VERSION).then(c=>c.put(req,cp)); }
        return r;
      }catch(_){
        const cached = await caches.match(req);
        return cached || new Response("Offline", {status:503, statusText:"Offline"});
      }
    })());
  }
});
