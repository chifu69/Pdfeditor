import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const engines=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine=process.env.TEST_BROWSER || 'chromium';
const browser=await engines[engine].launch({headless:true,...(engine==='chromium' && process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const base=process.env.TEST_URL || 'http://127.0.0.1:8080';
const output=process.env.TEST_OUTPUT || 'test-results';
await mkdir(output,{recursive:true});
let passed=0;
const pass=message=>{console.log(`PASS ${++passed}: ${message}`);};
async function ready(page){await page.goto(base);await page.evaluate(()=>import('./app.js'));}
async function open(page,file){await page.locator('#pdfInput').setInputFiles(file);await page.locator('#documentView').waitFor({state:'visible'});await page.locator('.loading-cover').waitFor({state:'detached'});}
async function apply(page,text){await page.locator('#editTextValue').fill(text);await page.getByRole('button',{name:'Aplicar',exact:true}).click();assert.equal(await page.locator('#modalBackdrop').isVisible(),false,await page.locator('#editError').textContent());}
async function tap(page,locator){await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);}
async function saved(page){await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent==='Guardado en este dispositivo');return page.evaluate(async()=> (await import('./storage.js')).loadSession());}
async function download(page,name){const promise=page.waitForEvent('download');await page.locator('#exportBtn').click();const d=await promise;await d.saveAs(`${output}/${name}.pdf`);return readFile(`${output}/${name}.pdf`);}
async function inspect(page,bytes){return page.evaluate(async data=>{
 const pdf=await import('./vendor/pdfjs/pdf.mjs');const task=pdf.getDocument({data:new Uint8Array(data)});const doc=await task.promise;
 const pages=[];for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i);pages.push({rotation:p.rotate,items:(await p.getTextContent()).items.filter(i=>i.str)});}await task.destroy();return pages;
},Array.from(bytes));}
try {
 console.log(`Browser: ${browser.version()}`);
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const external=[];page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await ready(page);
 await open(page,new URL('../test-sample.pdf',import.meta.url).pathname);
 await page.locator('[data-tool="editText"]').tap();await page.locator('.text-hit').first().waitFor();
 assert.equal(await page.locator('.text-hit').count(),3);pass('sample PDF produces three correctly separated blocks');
 const first=page.locator('.text-hit').first();
 await tap(page,first);await apply(page,'Texto corregido');
 await tap(page,first);assert.equal(await page.locator('#editTextValue').inputValue(),'Texto corregido');
 await apply(page,'Segunda edición');
 let session=await saved(page);assert.equal(session.pages[0].annotations.length,1);assert.equal(session.pages[0].annotations[0].text,'Segunda edición');pass('touch edits and reopens same block without stacking replacements');
 await page.locator('#undoBtn').tap();await saved(page);await tap(page,first);assert.equal(await page.locator('#editTextValue').inputValue(),'Texto corregido');await page.locator('#modalCloseBtn').click();
 await page.locator('#redoBtn').tap();await saved(page);await tap(page,first);assert.equal(await page.locator('#editTextValue').inputValue(),'Segunda edición');
 const beforeHistory=(await saved(page)).history.length;
 await page.locator('#editTextValue').press('End');await page.locator('#editTextValue').pressSequentially(' abc');await page.locator('#editTextValue').press('Meta+z');
 assert.equal((await saved(page)).history.length,beforeHistory);await page.locator('#modalCloseBtn').click();pass('undo/redo restores revisions and textarea undo does not change document history');
 for(const tool of ['select','editText']){await page.locator(`[data-tool="${tool}"]`).tap();await tap(page,first);assert.equal(await page.locator('#editTextValue').inputValue(),'Segunda edición');await page.locator('#modalCloseBtn').click();}pass('tool switching preserves editable replacement');
 // A drag must scroll without opening a modal.
 const r=await first.boundingBox();
 if(engine==='chromium') {
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+20,y:r.y+8}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+20,y:r.y-70}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 } else {
 await first.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:r.x+20,clientY:r.y+8});
 await first.dispatchEvent('pointermove',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:r.x+20,clientY:r.y-70});
 await first.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:r.x+20,clientY:r.y-70});
 }
 assert.equal(await page.locator('#modalBackdrop').isVisible(),false);pass('touch drag does not activate text editor');
 await page.screenshot({path:`${output}/mobile-editor.png`});
 const bytes=await download(page,'sample-edited');const exported=await inspect(page,bytes);
 assert.equal(exported.length,2);assert.ok(exported[0].items.some(i=>i.str==='Segunda edición'));pass('export produces a readable PDF containing replacement text');
 await saved(page);await page.reload();await page.evaluate(()=>import('./app.js'));await page.locator('#restoreBtn').click();await page.locator('.loading-cover').waitFor({state:'detached'});
 await page.waitForFunction(()=>document.querySelector('#overlaySvg').textContent.includes('Segunda edición'));
 assert.equal((await saved(page)).pages[0].annotations.length,1);pass('reload recovers PDF, annotations and undo history from IndexedDB');
 // Complete precache before disconnecting.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);await page.reload();await page.evaluate(()=>import('./app.js'));await page.locator('#restoreBtn').click();await page.locator('.loading-cover').waitFor({state:'detached'});
 await page.locator('[data-tool="editText"]').tap();await tap(page,page.locator('.text-hit').first());await apply(page,'Edición offline');
 const offline=await inspect(page,await download(page,'offline-edited'));assert.ok(offline[0].items.some(i=>i.str==='Edición offline'));assert.deepEqual(external,[]);pass('offline reload, recovery, editing and export require no CDN');
 await context.setOffline(false);
 // A deterministic PDF fixture: paragraph, columns, rotated text and blank page.
 const fixture=await page.evaluate(async()=>{
  const {PDFDocument,StandardFonts,degrees}=window.PDFLib;const doc=await PDFDocument.create();const f=await doc.embedFont(StandardFonts.Helvetica);const p=doc.addPage([612,792]);
  const text=(s,x,y,size=12)=>p.drawText(s,{x,y,size,font:f});
  text('First paragraph line',50,720);text('Second paragraph line',50,705);text('Third paragraph line',50,690);
  text('Left column line one',50,620);text('Left column line two',50,605);text('Right column one',320,620);text('Right column two',320,605);
  p.drawText('Rotated text',{x:500,y:300,size:12,font:f,rotate:degrees(90)});
  const p2=doc.addPage([612,792]);p2.drawText('Page with rotation',{x:50,y:700,size:18,font:f});p2.setRotation(degrees(90));doc.addPage([612,792]);return Array.from(await doc.save());
 });
 await open(page,{name:'paragraphs.pdf',mimeType:'application/pdf',buffer:Buffer.from(fixture)});
 await page.locator('[data-tool="editText"]').tap();await page.locator('.text-hit').first().waitFor();
 const titles=await page.locator('.text-hit').evaluateAll(es=>es.map(e=>e.title));
 assert.ok(titles.includes('First paragraph line\nSecond paragraph line\nThird paragraph line'));assert.ok(titles.includes('Left column line one\nLeft column line two'));assert.ok(titles.includes('Right column one\nRight column two'));pass('real PDF extraction joins paragraphs and keeps columns separate');
 const paragraph=page.locator('.text-hit').first();await tap(page,paragraph);await apply(page,'Este párrafo tiene varias palabras y se ajusta dentro del bloque original sin salir de sus límites.');
 session=await saved(page);const ann=session.pages[0].annotations[0];
 const svg=await page.locator('#overlaySvg text').evaluateAll(es=>es.map(e=>({text:e.textContent,x:+e.getAttribute('x'),y:+e.getAttribute('y')})));
 const layoutPages=await inspect(page,await download(page,'paragraph-edited'));
 const newItems=layoutPages[0].items.filter(i=>svg.some(s=>s.text===i.str));assert.equal(newItems.length,svg.length);
 const scale=await page.locator('#pdfCanvas').evaluate(e=>parseFloat(e.style.width)/612);
 for(const line of svg){const i=newItems.find(i=>i.str===line.text);assert.ok(Math.abs(i.transform[4]*scale-line.x)<.05);assert.ok(Math.abs((792-i.transform[5])*scale-line.y)<.05);}pass('preview and export have identical line breaks and baseline positions');
 await page.locator('#canvasScroller').evaluate(e=>e.scrollTo(0,0));await page.screenshot({path:`${output}/paragraph-mobile.png`});
 await tap(page,paragraph);await page.locator('#editTextValue').fill('🙂');await page.getByRole('button',{name:'Aplicar',exact:true}).click();assert.match(await page.locator('#editError').textContent(),/no admite/);await page.locator('#modalCloseBtn').click();pass('unsupported characters are rejected before saving/exporting');
 const rotated=page.locator('.text-hit[title="Rotated text"]');await tap(page,rotated);await apply(page,'Texto girado');
 const rotatedExport=await inspect(page,await download(page,'rotated-text'));const ri=rotatedExport[0].items.find(i=>i.str==='Texto girado');assert.ok(ri);assert.ok(Math.abs(ri.transform[0])<.01 && ri.transform[1]>0);pass('rotated source text retains its baseline angle on export');
 await page.locator('#nextPageBtn').click();await page.waitForFunction(()=>document.querySelector('.text-hit')?.title==='Page with rotation');await tap(page,page.locator('.text-hit').first());await apply(page,'Página girada');
 const rotatedPage=await inspect(page,await download(page,'rotated-page'));assert.equal(rotatedPage[1].rotation,90);assert.ok(rotatedPage[1].items.some(i=>i.str==='Página girada'));pass('editing works on a page with existing 90-degree rotation');
 await page.locator('#nextPageBtn').click();await page.waitForFunction(()=>document.querySelector('#pageInput').value==='3' && document.querySelectorAll('.text-hit').length===0);pass('blank pages report no editable text without crashing');
 assert.deepEqual(errors,[]);pass('no unhandled browser errors');
 await context.close();
 // Fresh desktop context; force DOM measurement failure and exercise fallback.
 const desktop=await browser.newContext({viewport:{width:1280,height:900}});const d=await desktop.newPage();d.setDefaultTimeout(15000);await ready(d);
 await d.evaluate(async()=>{const pdf=await import('./vendor/pdfjs/pdf.mjs');pdf.TextLayer.prototype.render=()=>Promise.reject(new Error('Intentional measurement failure'));});
 await open(d,new URL('../test-sample.pdf',import.meta.url).pathname);await d.locator('[data-tool="editText"]').click();await d.locator('.text-hit').first().click();assert.match(await d.locator('#editTextValue').inputValue(),/Hello PDF Editor/);await apply(d,'Fallback works');pass('TextLayer failure falls back to PDF geometry and remains editable');
 await d.locator('#rotateRightBtn').click();await d.waitForFunction(()=>document.querySelector('#pdfCanvas').width>document.querySelector('#pdfCanvas').height);
 await d.locator('#duplicatePageBtn').click();await d.waitForFunction(()=>document.querySelector('#pageTotal').textContent==='/ 3');
 const structured=await inspect(d,await download(d,'structural'));assert.equal(structured.length,3);assert.equal(structured[0].rotation,90);assert.equal(structured[1].rotation,90);assert.ok(structured[1].items.some(i=>i.str==='Fallback works'));pass('rotation and duplication preserve edits during structural export');
 await d.locator('#undoBtn').click();await d.waitForFunction(()=>document.querySelector('#pageTotal').textContent==='/ 2');
 await d.evaluate(()=>{for(let i=0;i<6;i++){document.querySelector('#zoomInBtn').click();document.querySelector('#zoomOutBtn').click();}});
 await d.waitForFunction(()=>document.querySelector('#pageStage').getAttribute('aria-busy')==='false');await d.locator('.text-hit').first().waitFor();await d.screenshot({path:`${output}/desktop-editor.png`});pass('structural undo and rapid zoom complete without overlapping canvas renders');
 await d.locator('#fitBtn').click();await d.waitForFunction(()=>document.querySelector('#pageStage').getAttribute('aria-busy')==='false');
 await d.locator('[data-tool="addText"]').click();
 await d.locator('#pageStage').click({position:{x:130,y:130}});
 await d.locator('#newTextValue').fill('Added text on a rotated page');await d.getByRole('button',{name:'Agregar',exact:true}).click();
 const added=(await saved(d)).pages[0].annotations.at(-1);
 const hit=d.locator(`[data-ann-id="${added.id}"]`),label=d.locator('#overlaySvg text').last();
 const hr=await hit.boundingBox(),tr=await label.boundingBox();
 assert.ok(tr.x+tr.width/2>=hr.x && tr.x+tr.width/2<=hr.x+hr.width && tr.y+tr.height/2>=hr.y && tr.y+tr.height/2<=hr.y+hr.height,'added text hitbox contains its visible center after rotation');
 await d.mouse.click(tr.x+tr.width/2,tr.y+tr.height/2);assert.equal(await d.locator('#editTextValue').inputValue(),'Added text on a rotated page');await d.locator('#modalCloseBtn').click();pass('added text remains selectable on rotated pages');
 await desktop.close();console.log(`All ${passed} browser checks passed. Artifacts: ${output}`);
} finally {await browser.close();}
