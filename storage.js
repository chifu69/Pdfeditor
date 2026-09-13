const DB='pdf-editor-local';
function openDatabase() {
 return new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('sessions');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
 });
}
async function transaction(mode, action) {
 const db=await openDatabase();
 try {return await new Promise((resolve,reject)=>{
   const tx=db.transaction('sessions',mode);
   const request=action(tx.objectStore('sessions'));
   tx.oncomplete=()=>resolve(request.result);
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Guardado interrumpido'));
 });} finally {db.close();}
}
export const saveSession=session=>transaction('readwrite',store=>store.put(session,'current'));
export const loadSession=()=>transaction('readonly',store=>store.get('current'));
export const clearSession=()=>transaction('readwrite',store=>store.delete('current'));
