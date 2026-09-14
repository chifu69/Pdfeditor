const DB='pdf-editor-local';
const STORE='sessions';

function openDatabase() {
 return new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
 });
}

async function transaction(mode, action) {
 const db=await openDatabase();
 try {return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,mode);
   const request=action(tx.objectStore(STORE));
   tx.oncomplete=()=>resolve(request.result);
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Guardado interrumpido'));
 });} finally {db.close();}
}

function dataUrlMime(dataUrl='') {
 const match=/^data:([^;,]+)/i.exec(dataUrl);
 return match?.[1] || 'application/octet-stream';
}

function normalizeAssetRecord(value, fallbackMime) {
 if (typeof value==='string') return {dataUrl:value,mime:fallbackMime || dataUrlMime(value)};
 if (value && typeof value==='object' && typeof value.dataUrl==='string') return {...value,mime:value.mime || fallbackMime || dataUrlMime(value.dataUrl)};
 return null;
}

/**
 * Upgrade recovery data to schema v2. Image/signature payloads are stored once
 * in session.assets and page/history snapshots keep only assetId references.
 */
export function normalizeSession(input) {
 if (!input || typeof input!=='object') return input;
 const session=structuredClone(input);
 const assets={};
 const byDataUrl=new Map();
 let sequence=0;

 for (const [id,value] of Object.entries(session.assets || {})) {
   const record=normalizeAssetRecord(value);
   if (!record) continue;
   assets[id]=record;
   byDataUrl.set(record.dataUrl,id);
 }

 const assetIdFor=(dataUrl,mime,name)=>{
   if (!dataUrl) return null;
   const existing=byDataUrl.get(dataUrl);
   if (existing) return existing;
   let id;
   do {id=`asset_${(++sequence).toString(36)}`;} while (assets[id]);
   assets[id]={dataUrl,mime:mime || dataUrlMime(dataUrl),...(name?{name}:{})};
   byDataUrl.set(dataUrl,id);
   return id;
 };

 const normalizePages=pages=>{
   if (!Array.isArray(pages)) return;
   for (const page of pages) {
     if (!Array.isArray(page?.annotations)) continue;
     for (const ann of page.annotations) {
       if (!ann || typeof ann!=='object') continue;
       if (typeof ann.dataUrl==='string' && ann.dataUrl) {
         ann.assetId=ann.assetId || assetIdFor(ann.dataUrl,ann.mime,ann.name);
         delete ann.dataUrl;
       }
       if (ann.assetId && assets[ann.assetId]) {
         ann.mime ||= assets[ann.assetId].mime;
       }
     }
   }
 };

 normalizePages(session.pages);
 for (const snap of session.history || []) normalizePages(snap?.pages);
 for (const snap of session.future || []) normalizePages(snap?.pages);
 session.version=2;
 session.assets=assets;
 return session;
}

export const saveSession=session=>transaction('readwrite',store=>store.put(session,'current'));
export const loadSession=()=>transaction('readonly',store=>store.get('current'));
export const clearSession=()=>transaction('readwrite',store=>store.delete('current'));
