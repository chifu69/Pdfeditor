importScripts('./offline-assets.js');
const CACHE=`pdf-editor-pwa-${self.OFFLINE_VERSION}`;
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Installation succeeds only if the complete app is usable offline.
  // Batches avoid exhausting mobile connections when precaching CMaps/fonts.
  for(let i=0;i<self.OFFLINE_ASSETS.length;i+=12)await cache.addAll(self.OFFLINE_ASSETS.slice(i,i+12));
 })());
});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('pdf-editor-pwa-') && key!==CACHE)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(event.request,{ignoreSearch:true});
  if(cached)return cached;
  try {return await fetch(event.request);}
  catch {if(event.request.mode==='navigate')return await cache.match('./index.html');return Response.error();}
 })());
});
