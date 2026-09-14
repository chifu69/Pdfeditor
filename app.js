import './compat.js';
import { groupTextLayerEntriesIntoBlocks } from './text-blocks.js';
import { layoutText, frameCorners } from './text-layout.js';
import { saveSession, loadSession, clearSession, normalizeSession } from './storage.js';
import { getTextContentCompat } from './pdf-text.js';
import * as pdfjsLib from './pdf.mjs';
import './pdf-lib.min.js';
const pdfJsBase = '.';
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf-worker.js';
async function ensurePdfLib() { return window.PDFLib; }
let previewFonts;
async function prepareFonts() {
  if (previewFonts) return;
  const {PDFDocument,StandardFonts}=window.PDFLib;
  const doc=await PDFDocument.create();
  previewFonts={};
  for (const name of ['Helvetica','TimesRoman','Courier']) previewFonts[name]=await doc.embedFont(StandardFonts[name]);
}

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), openBtn: $('openBtn'), emptyOpenBtn: $('emptyOpenBtn'), exportBtn: $('exportBtn'),
  pdfInput: $('pdfInput'), imageInput: $('imageInput'), fileMeta: $('fileMeta'), emptyState: $('emptyState'),
  documentView: $('documentView'), sidebar: $('sidebar'), thumbs: $('thumbs'), pageCount: $('pageCount'),
  pageInput: $('pageInput'), pageTotal: $('pageTotal'), prevPageBtn: $('prevPageBtn'), nextPageBtn: $('nextPageBtn'),
  zoomOutBtn: $('zoomOutBtn'), zoomInBtn: $('zoomInBtn'), zoomLabel: $('zoomLabel'), fitBtn: $('fitBtn'),
  canvasScroller: $('canvasScroller'), stage: $('pageStage'), canvas: $('pdfCanvas'), overlay: $('overlaySvg'),
  textMeasureLayer: $('pdfTextMeasureLayer'), textHitLayer: $('textHitLayer'), selectionLayer: $('selectionLayer'), toolbar: $('toolbar'),
  properties: $('properties'), propertiesBody: $('propertiesBody'), closePropertiesBtn: $('closePropertiesBtn'), pageToolsBtn: $('pageToolsBtn'), undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), imageBtn: $('imageBtn'),
  signatureBtn: $('signatureBtn'), rotateLeftBtn: $('rotateLeftBtn'), rotateRightBtn: $('rotateRightBtn'),
  duplicatePageBtn: $('duplicatePageBtn'), deletePageBtn: $('deletePageBtn'), moveUpBtn: $('moveUpBtn'), moveDownBtn: $('moveDownBtn'),
  modalBackdrop: $('modalBackdrop'), modalTitle: $('modalTitle'), modalBody: $('modalBody'), modalFooter: $('modalFooter'),
  modalCloseBtn: $('modalCloseBtn'), toast: $('toast')
};

const state = {
  originalBytes: null,
  fileName: '',
  pdfJsDoc: null,
  pages: [],
  current: 0,
  tool: 'select',
  fit: true,
  zoom: 1,
  displayScale: 1,
  viewport: null,
  renderSeq: 0,
  selectedId: null,
  pendingImage: null,
  drag: null,
  history: [],
  future: [],
  encrypted: false,
  password: null,
  loadingTask: null, documentTask: null,
  thumbObserver: null,
  modalResolver: null,
  textItems: [],
  activeTextLayer: null,
  textSeq: 0, renderTask: null, renderQueue: Promise.resolve(), textCache: new Map(), tap: null, openSeq: 0,
  assets: new Map(), assetByDataUrl: new Map()
};

function uid(prefix = 'a') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function deepClonePages(pages = state.pages) {
  return structuredClone(pages);
}
function resetAssets(records = {}) {
  state.assets = new Map();
  state.assetByDataUrl = new Map();
  for (const [id,value] of Object.entries(records || {})) {
    const record=typeof value==='string'?{dataUrl:value}:value;
    if (!record?.dataUrl) continue;
    state.assets.set(id,{...record});
    state.assetByDataUrl.set(record.dataUrl,id);
  }
}
function registerAsset(dataUrl,{mime,name}={}) {
  if (!dataUrl) return null;
  const existing=state.assetByDataUrl.get(dataUrl);
  if (existing) return existing;
  const id=uid('asset');
  const match=/^data:([^;,]+)/i.exec(dataUrl);
  const record={dataUrl,mime:mime || match?.[1] || 'application/octet-stream',...(name?{name}:{})};
  state.assets.set(id,record);
  state.assetByDataUrl.set(dataUrl,id);
  return id;
}
function assetRecord(ann) {
  if (ann?.assetId && state.assets.has(ann.assetId)) return state.assets.get(ann.assetId);
  if (ann?.dataUrl) return {dataUrl:ann.dataUrl,mime:ann.mime};
  return null;
}
function serializedAssets() {
  const used=new Set();
  const scan=pages=>{for(const page of pages || [])for(const ann of page.annotations || [])if(ann.assetId)used.add(ann.assetId);};
  scan(state.pages);
  for(const snap of state.history)scan(snap.pages);
  for(const snap of state.future)scan(snap.pages);
  return Object.fromEntries([...used].flatMap(id=>state.assets.has(id)?[[id,structuredClone(state.assets.get(id))]]:[]));
}
function currentPageInfo() { return state.pages[state.current] || null; }
function currentAnnotation() {
  const p = currentPageInfo();
  return p?.annotations.find(a => a.id === state.selectedId) || null;
}
function snapshot() {
  return { pages: deepClonePages(), current: state.current, selectedId: state.selectedId };
}
function restoreSnapshot(snap) {
  state.pages = deepClonePages(snap.pages);
  state.current = Math.max(0, Math.min(snap.current, state.pages.length - 1));
  state.selectedId = snap.selectedId;
  refreshPageUI(true);
  persistSoon();
}
function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
  updateUndoRedo();
}
function updateUndoRedo() {
  els.undoBtn.disabled = state.history.length === 0;
  els.redoBtn.disabled = state.future.length === 0;
}
function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restoreSnapshot(state.history.pop());
  updateUndoRedo();
}
function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restoreSnapshot(state.future.pop());
  updateUndoRedo();
}

let toastTimer;
function toast(message, ms = 2600) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}
function setLoading(on) {
  let cover = document.querySelector('.loading-cover');
  if (on && !cover) {
    cover = document.createElement('div');
    cover.className = 'loading-cover';
    cover.innerHTML = '<div class="spinner" aria-label="Cargando"></div>';
    document.querySelector('.editor-area').appendChild(cover);
  } else if (!on && cover) cover.remove();
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

function openModal({title, body, actions = [{label:'Cancelar', value:null, kind:'secondary'}]}) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = '';
  if (typeof body === 'string') els.modalBody.innerHTML = body;
  else if (body) els.modalBody.appendChild(body);
  els.modalFooter.innerHTML = '';
  actions.forEach(action => {
    const b = document.createElement('button');
    b.className = `btn ${action.kind || 'secondary'}`;
    b.textContent = action.label;
    b.addEventListener('click', () => { if (action.validate && !action.validate()) return; closeModal(action.value); });
    els.modalFooter.appendChild(b);
  });
  els.modalBackdrop.classList.remove('hidden');
  return new Promise(resolve => { state.modalResolver = resolve; });
}
function closeModal(value = null) {
  els.modalBackdrop.classList.add('hidden');
  const r = state.modalResolver;
  state.modalResolver = null;
  if (r) r(value);
}
els.closePropertiesBtn.addEventListener('click', () => els.properties.classList.remove('mobile-open'));
els.pageToolsBtn.addEventListener('click', () => els.properties.classList.add('mobile-open'));
els.modalCloseBtn.addEventListener('click', () => closeModal(null));
els.modalBackdrop.addEventListener('click', e => { if (e.target === els.modalBackdrop) closeModal(null); });

async function askPassword(updatePassword, reason) {
  state.encrypted = true;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="muted">Este PDF está protegido. Escribe la contraseña para visualizarlo. La exportación editada de PDFs cifrados no está disponible en este build.</p>
    <div class="form-row"><label>Contraseña</label><input id="pwdField" type="password" autocomplete="current-password" /></div>`;
  const resultPromise = openModal({title: reason === 2 ? 'Contraseña incorrecta' : 'PDF protegido', body: wrap, actions:[
    {label:'Cancelar', value:null}, {label:'Abrir', value:'open', kind:'primary'}
  ]});
  setTimeout(() => wrap.querySelector('#pwdField')?.focus(), 20);
  const result = await resultPromise;
  if (result === 'open') {
    const pwd = wrap.querySelector('#pwdField').value;
    state.password = pwd;
    updatePassword(pwd);
  } else {
    try { state.loadingTask?.destroy(); } catch {}
    setLoading(false);
  }
}

async function openPdfFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('Selecciona un archivo PDF.');
    return;
  }
  const openSeq=++state.openSeq;
  const previousEncrypted=state.encrypted,previousPassword=state.password;
  setLoading(true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await prepareFonts();

    state.encrypted = false;
    state.password = null;
    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      cMapUrl: `${pdfJsBase}/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfJsBase}/`,
      wasmUrl: `${pdfJsBase}/`
    });
    state.loadingTask = loadingTask;
    loadingTask.onPassword = (updatePassword, reason) => askPassword(updatePassword, reason);
    const doc = await loadingTask.promise;
    if(openSeq!==state.openSeq){await loadingTask.destroy();return;}
    const previousTask = state.documentTask;
    state.documentTask=loadingTask;
    state.pdfJsDoc = doc;
    state.originalBytes = bytes;
    state.fileName = file.name || 'document.pdf';
    state.textCache.clear();
    resetAssets();
    previousTask?.destroy().catch(console.warn);
    state.pages = Array.from({length: doc.numPages}, (_, i) => ({
      id: uid('p'), sourceIndex: i, rotationDelta: 0, annotations: []
    }));
    state.current = 0;
    state.selectedId = null;
    state.history = [];
    state.future = [];
    state.fit = true;
    state.zoom = 1;
    els.emptyState.classList.add('hidden');
    els.documentView.classList.remove('hidden');
    els.exportBtn.disabled = false;
    [els.rotateLeftBtn, els.rotateRightBtn, els.duplicatePageBtn, els.deletePageBtn, els.moveUpBtn, els.moveDownBtn].forEach(b => b.disabled = false);
    els.fileMeta.textContent = `${state.fileName} • ${doc.numPages} pág. • ${formatBytes(file.size)} • local`;
    buildThumbnails();
    await renderCurrentPage();
    updateUndoRedo();
    persistSoon();
    toast('PDF abierto. Toca Editar texto y después un bloque.');
  } catch (err) {
    console.error(err);
    state.encrypted=previousEncrypted;state.password=previousPassword;
    if (!state.encrypted || err?.name !== 'PasswordException') {
      toast(`No se pudo abrir el PDF: ${err?.message || 'error desconocido'}`, 5000);
    }
  } finally {
    if(openSeq===state.openSeq){setLoading(false);els.pdfInput.value = '';}

  }
}

function renderCurrentPage(options = {}) {
  ++state.renderSeq;
  ++state.textSeq;
  state.tap=null;state.pendingTap=null;state.textItems=[];
  els.textHitLayer.replaceChildren();els.stage.setAttribute('aria-busy','true');
  state.renderTask?.cancel();
  const seq=state.renderSeq;
  state.renderQueue=state.renderQueue.catch(()=>{}).then(async()=>{
    if (seq!==state.renderSeq) return;
    try { await paintCurrentPage(options,seq); }
    catch (err) { if (err.name!=='RenderingCancelledException') {console.error(err);toast('No se pudo dibujar la página.');} }
    finally {if(seq===state.renderSeq)els.stage.setAttribute('aria-busy','false');}
  });
  return state.renderQueue;
}
async function paintCurrentPage({keepScroll = false} = {}, seq) {
  const pageInfo = currentPageInfo();
  if (!pageInfo || !state.pdfJsDoc) return;

  const sourcePage = await state.pdfJsDoc.getPage(pageInfo.sourceIndex + 1);
  if (seq !== state.renderSeq) return;
  const totalRotation = ((sourcePage.rotate || 0) + pageInfo.rotationDelta + 360) % 360;
  const base = sourcePage.getViewport({scale:1, rotation: totalRotation});
  const scrollerWidth = Math.max(200, els.canvasScroller.clientWidth - (window.innerWidth <= 700 ? 16 : 44));
  let scale = state.fit ? Math.min(2.2, scrollerWidth / base.width) : state.zoom;
  scale = Math.max(.2, Math.min(4, scale));
  state.displayScale = scale;
  state.viewport = sourcePage.getViewport({scale, rotation: totalRotation});
  state.totalRotation = totalRotation;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const renderViewport = sourcePage.getViewport({scale: scale * dpr, rotation: totalRotation});
  if (seq !== state.renderSeq) return;
  const canvas = els.canvas;
  canvas.width = Math.max(1, Math.floor(renderViewport.width));
  canvas.height = Math.max(1, Math.floor(renderViewport.height));
  canvas.style.width = `${state.viewport.width}px`;
  canvas.style.height = `${state.viewport.height}px`;
  els.stage.style.width = `${state.viewport.width}px`;
  els.stage.style.height = `${state.viewport.height}px`;
  els.overlay.setAttribute('viewBox', `0 0 ${state.viewport.width} ${state.viewport.height}`);
  const ctx = canvas.getContext('2d', {alpha:false});
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  state.renderTask=sourcePage.render({canvasContext:ctx, viewport:renderViewport});
  await state.renderTask.promise;
  state.renderTask=null;
  if (seq !== state.renderSeq) return;
  renderOverlay();
  await renderTextHitLayer(sourcePage, seq);
  renderProperties();
  updatePageControls();
  updateThumbActive();
  if (!keepScroll && state.fit) els.canvasScroller.scrollTo({top:0, left:0});
}

async function extractTextBlocks(sourcePage, token) {
  const content = await getTextContentCompat(sourcePage,{includeMarkedContent:true});
  const items = content.items.filter(item=>typeof item.str==='string');
  const canonical = sourcePage.getViewport({scale:1,rotation:0});
  const host=document.createElement('div');
  host.className='pdfjs-text-layer measure-host';
  host.style.width=`${canonical.width}px`;host.style.height=`${canonical.height}px`;
  host.style.setProperty('--total-scale-factor','1');
  document.body.appendChild(host);
  let layer, divs=[];
  try {
    layer=new pdfjsLib.TextLayer({textContentSource:content,container:host,viewport:canonical});
    // PDF.js viewer dimensions use CSS round(); explicit pixels also support older Safari.
    host.style.width=`${canonical.width}px`;host.style.height=`${canonical.height}px`;
    state.activeTextLayer=layer;
    await layer.render();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    divs=layer.textDivs;
  } catch (err) {
    if (token!==state.textSeq) {host.remove();return [];}
    console.warn('TextLayer: using PDF geometry',err);
  }
  try {
    const hostRect=host.getBoundingClientRect();
    const entries=items.flatMap((item,idx)=>{
      if (!item.str.trim()) return [];
      const tx=pdfjsLib.Util.transform(canonical.transform,item.transform);
      const fontHeight=Math.max(1,Math.hypot(tx[2],tx[3]));
      const angle=Math.atan2(tx[1],tx[0]);
      const style=content.styles[item.fontName] || {};
      const ascent=Number.isFinite(style.ascent)?style.ascent:.8;
      const rect=divs[idx]?.getBoundingClientRect();
      const valid=rect && rect.width>0 && rect.height>0 && rect.width<canonical.width*4 && rect.height<fontHeight*4;
      return [{item,text:item.str,idx,sourceIndex:idx,fontHeight,angle,
        x:valid?rect.left-hostRect.left:tx[4], y:valid?rect.top-hostRect.top:tx[5]-fontHeight*ascent,
        width:valid?rect.width:Math.max(1,Math.abs(item.width)),height:valid?rect.height:fontHeight,
        ascent, fontFamily:style.fontFamily || ''}];
    });
    return groupTextLayerEntriesIntoBlocks(entries).map(meta=>{
      const sourceKey=meta.items.map(m=>m.sourceIndex).sort((a,b)=>a-b).join(',');
      let frame;
      if (Math.abs(meta.angle)>.001 && meta.items.length===1) {
        const m=meta.items[0],t=m.item.transform,a=Math.atan2(t[1],t[0]);
        frame={x:t[4]-Math.sin(a)*m.fontHeight*m.ascent,y:t[5]+Math.cos(a)*m.fontHeight*m.ascent,width:Math.max(2,m.item.width),height:m.fontHeight,angle:a};
      } else {
        const [x,y]=canonical.convertToPdfPoint(meta.x,meta.y);
        frame={x,y,width:meta.width,height:meta.height,angle:0};
      }
      const corners=frameCorners(frame),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
      return {...meta,sourceKey,frame,rect:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)},fontSize:meta.fontHeight};
    });
  } finally {host.remove(); if(state.activeTextLayer===layer)state.activeTextLayer=null;}
}

async function renderTextHitLayer(sourcePage, seq) {
  if(seq!==state.renderSeq)return;
  const token=++state.textSeq;
  try {state.activeTextLayer?.cancel();} catch {}
  els.textHitLayer.replaceChildren();state.textItems=[];
  if (!['select','editText'].includes(state.tool)) return;
  try {
    const sourceIndex=currentPageInfo().sourceIndex;
    let targets=state.textCache.get(sourceIndex);
    if (!targets) {
      targets=await extractTextBlocks(sourcePage,token);
      if (seq!==state.renderSeq || token!==state.textSeq) return;
      state.textCache.set(sourceIndex,targets);
    }
    if (seq!==state.renderSeq || token!==state.textSeq) return;
    state.textItems=targets.map(meta=>({...meta,...(meta.frame?frameToViewportBounds(meta.frame):pdfRectToViewport(meta.rect))}));
    for (const [idx,meta] of state.textItems.entries()) {
      const box=document.createElement('button');
      box.type='button';box.className='text-hit text-block-hit';
      Object.assign(box.style,{left:`${meta.x-2}px`,top:`${meta.y-2}px`,width:`${Math.max(18,meta.width+4)}px`,height:`${Math.max(18,meta.height+4)}px`});
      box.dataset.textBlock=String(idx);
      box.setAttribute('aria-label',`Editar: ${meta.text.slice(0,100)}`);
      box.title=meta.text;meta.box=box;

      els.textHitLayer.appendChild(box);
    }
    if (!targets.length && state.tool==='editText') toast('Esta página no tiene texto seleccionable. Los escaneos necesitan OCR.',4500);
  } catch (err) {console.warn(err);toast('No pude detectar el texto de esta página.',4000);}
}

function frameToViewportBounds(frame) {
  const points=frameCorners(frame).map(point=>state.viewport.convertToViewportPoint(...point));
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
function pdfRectToViewport(rect) {
  const corners = [
    state.viewport.convertToViewportPoint(rect.x, rect.y),
    state.viewport.convertToViewportPoint(rect.x + rect.width, rect.y),
    state.viewport.convertToViewportPoint(rect.x, rect.y + rect.height),
    state.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
  ];
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  return {x:Math.min(...xs), y:Math.min(...ys), width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys)};
}
function viewportRectToPdf(a, b) {
  const p1 = state.viewport.convertToPdfPoint(a.x, a.y);
  const p2 = state.viewport.convertToPdfPoint(b.x, b.y);
  return {x:Math.min(p1[0],p2[0]), y:Math.min(p1[1],p2[1]), width:Math.abs(p2[0]-p1[0]), height:Math.abs(p2[1]-p1[1])};
}
function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function renderOverlay() {
  els.overlay.innerHTML = '';
  els.selectionLayer.innerHTML = '';
  const pageInfo = currentPageInfo();
  if (!pageInfo || !state.viewport) return;
  for (const ann of pageInfo.annotations) {
    renderAnnotation(ann);
  }
  if (state.drag?.type === 'rect') {
    const x = Math.min(state.drag.start.x, state.drag.now.x);
    const y = Math.min(state.drag.start.y, state.drag.now.y);
    const w = Math.abs(state.drag.now.x - state.drag.start.x);
    const h = Math.abs(state.drag.now.y - state.drag.start.y);
    const type = state.drag.tool;
    const fill = type === 'whiteout' ? '#fff' : type === 'redact' ? '#111' : '#fde047';
    const opacity = type === 'highlight' ? '.38' : '1';
    els.overlay.appendChild(svgEl('rect', {x,y,width:w,height:h,fill,opacity,stroke:type==='whiteout'?'#94a3b8':'none','stroke-dasharray':'4 3'}));
  }
  if (state.drag?.type === 'draw' && state.drag.points.length > 1) {
    const pts = state.drag.points.map(p => `${p.x},${p.y}`).join(' ');
    els.overlay.appendChild(svgEl('polyline', {points:pts,fill:'none',stroke:state.drag.color,'stroke-width':state.drag.width,'stroke-linecap':'round','stroke-linejoin':'round'}));
  }
  if (['select','editText'].includes(state.tool)) renderAnnotationHitboxes(pageInfo.annotations.filter(a=>state.tool==='select'||a.type==='replaceText'||a.type==='text'));
  const selected = currentAnnotation();
  if (selected) renderSelection(selected);
}
function renderAnnotation(ann) {
  if (['whiteout','redact','highlight','replaceText'].includes(ann.type) && ann.rect) {
    const r = pdfRectToViewport(ann.rect);
    let fill = ann.type === 'redact' ? '#000' : ann.type === 'highlight' ? (ann.color || '#fde047') : '#fff';
    let opacity = ann.type === 'highlight' ? (ann.opacity ?? .35) : 1;
    if (ann.type==='replaceText' && ann.frame) {
      const points=frameCorners(ann.frame).map(p=>state.viewport.convertToViewportPoint(...p).join(',')).join(' ');
      els.overlay.appendChild(svgEl('polygon',{points,fill,opacity}));
    } else els.overlay.appendChild(svgEl('rect', {x:r.x,y:r.y,width:r.width,height:r.height,fill,opacity}));
    if (ann.type === 'replaceText') renderTextAnnotation(ann, true);
    return;
  }
  if (ann.type === 'text') { renderTextAnnotation(ann, false); return; }
  if (ann.type === 'draw' && ann.points?.length > 1) {
    const pts = ann.points.map(([x,y]) => state.viewport.convertToViewportPoint(x,y)).map(p => `${p[0]},${p[1]}`).join(' ');
    els.overlay.appendChild(svgEl('polyline', {points:pts,fill:'none',stroke:ann.color || '#111827','stroke-width':Math.max(1,(ann.width || 2)*state.viewport.scale),'stroke-linecap':'round','stroke-linejoin':'round',opacity:ann.opacity ?? 1}));
    return;
  }
  if (ann.type === 'image' && ann.rect) {
    const asset=assetRecord(ann);
    if (!asset?.dataUrl) return;
    const r = pdfRectToViewport(ann.rect);
    const image = svgEl('image', {x:r.x,y:r.y,width:r.width,height:r.height,href:asset.dataUrl,preserveAspectRatio:'none',opacity:ann.opacity ?? 1});
    els.overlay.appendChild(image);
  }
}
function renderTextAnnotation(ann) {
  if (!previewFonts) return;
  let layout;
  try {layout=layoutText(ann,previewFonts[ann.font]||previewFonts.Helvetica);}
  catch (err) {console.warn(err);return;}
  const font=ann.font || 'Helvetica';
  for (const line of layout.lines) {
    const p=state.viewport.convertToViewportPoint(line.x,line.y);
    const q=state.viewport.convertToViewportPoint(line.x+Math.cos(layout.angle),line.y+Math.sin(layout.angle));
    const angle=Math.atan2(q[1]-p[1],q[0]-p[0])*180/Math.PI;
    const text=svgEl('text',{x:p[0],y:p[1],fill:ann.color||'#111111','font-size':layout.size*state.viewport.scale,'font-family':fontFamilyCss(font),opacity:ann.opacity??1,transform:`rotate(${angle} ${p[0]} ${p[1]})`});
    if (line.width>0) {text.setAttribute('textLength',line.width*state.viewport.scale);text.setAttribute('lengthAdjust','spacingAndGlyphs');}
    text.textContent=line.text;els.overlay.appendChild(text);
  }
}

function annotationViewportBounds(ann) {
  if (ann.frame) return frameToViewportBounds(ann.frame);
  if (ann.rect) return pdfRectToViewport(ann.rect);
  if (ann.type === 'text') {
    const font=previewFonts[ann.font]||previewFonts.Helvetica;
    const layout=layoutText(ann,font);
    const ascent=font.heightAtSize(layout.size,{descender:false});
    const points=layout.lines.flatMap(line=>frameCorners({x:line.x-Math.sin(layout.angle)*ascent,y:line.y+Math.cos(layout.angle)*ascent,width:Math.max(2,line.width),height:font.heightAtSize(layout.size),angle:layout.angle})).map(p=>state.viewport.convertToViewportPoint(...p));
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    return {x:Math.min(...xs)-3,y:Math.min(...ys)-3,width:Math.max(...xs)-Math.min(...xs)+6,height:Math.max(...ys)-Math.min(...ys)+6};
  }
  if (ann.type === 'draw') {
    const pts = ann.points.map(([x,y]) => state.viewport.convertToViewportPoint(x,y));
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    return {x:Math.min(...xs)-4,y:Math.min(...ys)-4,width:Math.max(...xs)-Math.min(...xs)+8,height:Math.max(...ys)-Math.min(...ys)+8};
  }
  return null;
}
function renderAnnotationHitboxes(annotations) {
  for (const ann of annotations) {
    const r = annotationViewportBounds(ann);
    if (!r) continue;
    const hit = document.createElement('div');
    hit.className = 'selection-hit';
    hit.style.left = `${r.x}px`; hit.style.top = `${r.y}px`; hit.style.width = `${Math.max(8,r.width)}px`; hit.style.height = `${Math.max(8,r.height)}px`;
    hit.dataset.annId = ann.id;
    hit.setAttribute('role','button');hit.tabIndex=0;
    hit.setAttribute('aria-label',`Editar anotación: ${ann.text || ann.type}`);
    hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activateAnnotation(ann);}});
    els.selectionLayer.appendChild(hit);
  }
}

function renderSelection(ann) {
  const r = annotationViewportBounds(ann);
  if (!r) return;
  const box = document.createElement('div');
  box.className = 'selection-box';
  box.style.left = `${r.x}px`; box.style.top = `${r.y}px`; box.style.width = `${r.width}px`; box.style.height = `${r.height}px`;
  box.title = 'Anotación seleccionada';

  els.selectionLayer.appendChild(box);
}

function setTool(tool) {
  state.tool = tool;
  state.selectedId=null;state.tap=null;
  els.stage.classList.toggle('tool-markup',['whiteout','redact','highlight','draw'].includes(tool));
  state.pendingImage = tool === 'imagePlacement' ? state.pendingImage : (['select','editText','addText','whiteout','redact','highlight','draw'].includes(tool) ? null : state.pendingImage);
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  els.imageBtn.classList.toggle('active', tool === 'imagePlacement');
  els.signatureBtn.classList.remove('active');
  els.stage.classList.toggle('tool-editText', tool === 'editText');
  els.stage.classList.toggle('tool-selectText', tool === 'select');
  els.textHitLayer.style.pointerEvents = ['select','editText'].includes(tool) ? 'auto' : 'none';

  // Tool changes should not repaint the PDF canvas. Rebuilding only the text
  // interaction layer avoids overlapping render tasks on iPhone Safari.
  if (!state.pdfJsDoc) return;
  if (['select','editText'].includes(tool)) {
    const seq = state.renderSeq;
    const toolRequest=++state.textSeq;
    const pageInfo = currentPageInfo();
    state.pdfJsDoc.getPage(pageInfo.sourceIndex + 1)
      .then(page => {if(toolRequest===state.textSeq)return renderTextHitLayer(page, seq);})
      .catch(err => console.warn('Text layer refresh failed', err));
  } else {
    try { state.activeTextLayer?.cancel?.(); } catch {}
    ++state.textSeq;
    state.activeTextLayer = null;
    els.textMeasureLayer.innerHTML = '';
    els.textHitLayer.innerHTML = '';
    state.textItems = [];
  }
  renderOverlay();
  renderProperties();
}

function stagePointFromEvent(e) {
  const rect = els.stage.getBoundingClientRect();
  return {x:Math.max(0,Math.min(rect.width,e.clientX-rect.left)), y:Math.max(0,Math.min(rect.height,e.clientY-rect.top))};
}

function findTextAtPoint(point, tolerance = 14) {
  if (!state.textItems.length) return null;
  const stageRect = els.stage.getBoundingClientRect();
  let best = null;
  let bestDistance = Infinity;
  for (const meta of state.textItems) {
    const r = meta.box?.getBoundingClientRect();
    if (!r) continue;
    const left = r.left - stageRect.left;
    const top = r.top - stageRect.top;
    const right = left + r.width;
    const bottom = top + r.height;
    const dx = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
    const dy = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = meta;
    }
  }
  return bestDistance <= tolerance ? best : null;
}
function addAnnotation(ann) {
  const page = currentPageInfo();
  if (!page) return;
  pushHistory();
  ann.id ||= uid('a');
  page.annotations.push(ann);
  state.selectedId = ann.id;
  renderOverlay();
  renderProperties();
  persistSoon();
}

function activateAnnotation(ann) {
  state.selectedId=ann.id;
  if (['text','replaceText'].includes(ann.type)) {editExistingText(null,ann);return;}
  renderOverlay();renderProperties();
  if(window.innerWidth<=700)els.properties.classList.add('mobile-open');
}

els.stage.addEventListener('pointerdown', e => {
  if (!state.pdfJsDoc || e.button > 0 || els.stage.getAttribute('aria-busy')==='true') return;
  if (['select','editText','addText'].includes(state.tool)) {
    state.pendingTap=null;
    if (!e.isPrimary) {state.tap=null;return;}
    state.tap={id:e.pointerId,x:e.clientX,y:e.clientY,target:e.target,scrollX:els.canvasScroller.scrollLeft,scrollY:els.canvasScroller.scrollTop};
    return;
  }
  const p = stagePointFromEvent(e);
  if (state.tool === 'imagePlacement' && state.pendingImage) {
    placePendingImage(p);
    return;
  }
  if (state.tool === 'addText') {
    createTextAt(p);
    return;
  }
  if (['whiteout','redact','highlight'].includes(state.tool)) {
    state.drag = {type:'rect', tool:state.tool, start:p, now:p};
    els.stage.setPointerCapture(e.pointerId);
    renderOverlay();
    return;
  }
  if (state.tool === 'draw') {
    state.drag = {type:'draw', points:[p], color:'#111827', width:2.5};
    els.stage.setPointerCapture(e.pointerId);
    renderOverlay();
    return;
  }

});
els.stage.addEventListener('pointermove', e => {
  if(state.tap && Math.hypot(e.clientX-state.tap.x,e.clientY-state.tap.y)>8)state.tap=null;
  if (!state.drag) return;
  const p = stagePointFromEvent(e);
  if (state.drag.type === 'rect') state.drag.now = p;
  else if (state.drag.type === 'draw') {
    const last = state.drag.points[state.drag.points.length-1];
    if (Math.hypot(p.x-last.x,p.y-last.y) > 1.5) state.drag.points.push(p);
  }
  renderOverlay();
});
els.stage.addEventListener('pointerup', e => {
  const tap=state.tap;state.tap=null;
  if(tap && tap.id===e.pointerId && Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<=8 && Math.abs(tap.scrollY-els.canvasScroller.scrollTop)<4 && Math.abs(tap.scrollX-els.canvasScroller.scrollLeft)<4) {
    state.pendingTap={target:tap.target,point:stagePointFromEvent(e),tolerance:e.pointerType==='touch'?12:4};
  }
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  if (drag.type === 'rect') {
    const w = Math.abs(drag.now.x-drag.start.x), h = Math.abs(drag.now.y-drag.start.y);
    if (w > 4 && h > 4) {
      const rect = viewportRectToPdf(drag.start, drag.now);
      addAnnotation({type:drag.tool, rect, color:drag.tool==='highlight'?'#fde047':undefined, opacity:drag.tool==='highlight'?.35:1});
    } else renderOverlay();
  } else if (drag.type === 'draw' && drag.points.length > 1) {
    const points = drag.points.map(pt => state.viewport.convertToPdfPoint(pt.x,pt.y));
    addAnnotation({type:'draw', points, color:drag.color, width:drag.width/state.viewport.scale, opacity:1});
  }
  try { els.stage.releasePointerCapture(e.pointerId); } catch {}
});
// Open on the completed click, not pointerup: otherwise the compatibility
// click from a touch can hit Apply/Cancel in the newly opened modal.
els.stage.addEventListener('click',e=>{
  if(!['select','editText','addText'].includes(state.tool))return;
  const pending=state.pendingTap;state.pendingTap=null;
  if(!pending && e.detail!==0)return;
  e.preventDefault();e.stopPropagation();
  if(state.tool==='addText'){if(pending)createTextAt(pending.point);return;}
  const target=pending?.target || e.target;
  const hit=target.closest('[data-ann-id]');
  const ann=hit && currentPageInfo()?.annotations.find(a=>a.id===hit.dataset.annId);
  if(ann){activateAnnotation(ann);return;}
  const direct=target.closest('[data-text-block]');
  const meta=direct?state.textItems[Number(direct.dataset.textBlock)]:pending && findTextAtPoint(pending.point,pending.tolerance);
  if(meta){editExistingText(meta);return;}
  state.selectedId=null;renderOverlay();renderProperties();els.properties.classList.remove('mobile-open');
});
els.stage.addEventListener('pointercancel', () => { state.tap=null;state.pendingTap=null;state.drag = null; renderOverlay(); });

async function editExistingText(meta, existing = null) {
  if (state.modalResolver) return;
  const page=currentPageInfo();
  existing ||= page.annotations.find(a=>a.type==='replaceText' && a.sourceKey===meta?.sourceKey);
  const base=existing || {type:'replaceText',sourceKey:meta.sourceKey,rect:structuredClone(meta.rect),frame:structuredClone(meta.frame),text:meta.text,fontSize:meta.fontSize,font:'Helvetica',color:'#111111',opacity:1};
  const wrap=document.createElement('div');
  wrap.innerHTML=`<div class="form-row"><label for="editTextValue">Texto del bloque</label><textarea id="editTextValue" spellcheck="true"></textarea></div>
    <div class="row-2"><div class="form-row"><label for="editTextSize">Tamaño (pt)</label><input id="editTextSize" type="number" min="4" max="144" step="0.25"></div><div class="form-row"><label for="editTextColor">Color</label><input id="editTextColor" type="color"></div></div>
    <div class="form-row"><label for="editTextFont">Fuente</label><select id="editTextFont"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select></div>
    <p class="muted">Los saltos de línea se conservan. El texto se ajusta al bloque al exportar y en la vista previa. El original queda cubierto visualmente.</p><p id="editError" role="alert"></p>`;
  wrap.querySelector('#editTextValue').value=base.text;
  wrap.querySelector('#editTextSize').value=base.fontSize;
  wrap.querySelector('#editTextColor').value=base.color;
  wrap.querySelector('#editTextFont').value=base.font;
  let candidate;
  const validate=()=>{
    candidate={...base,text:wrap.querySelector('#editTextValue').value,fontSize:Number(wrap.querySelector('#editTextSize').value),color:wrap.querySelector('#editTextColor').value,font:wrap.querySelector('#editTextFont').value};
    try {layoutText(candidate,previewFonts[candidate.font]);return true;}
    catch(err){wrap.querySelector('#editError').textContent=err.message;return false;}
  };
  const promise=openModal({title:existing?'Editar texto aplicado':'Editar bloque de texto',body:wrap,actions:[{label:'Cancelar',value:null},{label:'Aplicar',value:'apply',kind:'primary',validate}]});
  // Keep focus inside the user gesture so Safari can open the keyboard.
  const editor=wrap.querySelector('#editTextValue');
  try {editor.focus({preventScroll:true});} catch {editor.focus();}
  editor.setSelectionRange(editor.value.length,editor.value.length);
  const result=await promise;
  if(result!=='apply' || currentPageInfo()!==page) return;
  if(existing) {
    if(JSON.stringify(existing)===JSON.stringify(candidate))return;
    pushHistory();Object.assign(existing,candidate);state.selectedId=existing.id;
    renderOverlay();renderProperties();persistSoon();
  } else addAnnotation(candidate);
}

async function createTextAt(viewPoint) {
  const pdfPoint = state.viewport.convertToPdfPoint(viewPoint.x,viewPoint.y);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="form-row"><label>Texto</label><textarea id="newTextValue" placeholder="Escribe aquí"></textarea></div>
    <div class="row-2"><div class="form-row"><label>Tamaño</label><input id="newTextSize" type="number" min="4" max="144" value="18" /></div><div class="form-row"><label>Color</label><input id="newTextColor" type="color" value="#111111" /></div></div>
    <div class="form-row"><label>Fuente</label><select id="newTextFont"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select></div>`;
  const result = await openModal({title:'Agregar texto',body:wrap,actions:[{label:'Cancelar',value:null},{label:'Agregar',value:'add',kind:'primary'}]});
  if (result !== 'add') return;
  const text = wrap.querySelector('#newTextValue').value;
  if (!text.trim()) return;
  const annotation={type:'text',x:pdfPoint[0],y:pdfPoint[1],text,fontSize:Number(wrap.querySelector('#newTextSize').value)||18,color:wrap.querySelector('#newTextColor').value,font:wrap.querySelector('#newTextFont').value,opacity:1};
  try {layoutText(annotation,previewFonts[annotation.font]);}catch(err){toast(err.message,5000);return;}
  addAnnotation(annotation);
  setTool('select');
}

els.imageBtn.addEventListener('click', () => els.imageInput.click());
els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files?.[0];
  els.imageInput.value = '';
  if (!file) return;
  if (!['image/png','image/jpeg'].includes(file.type)) { toast('Usa una imagen PNG o JPEG.'); return; }
  const dataUrl = await fileToDataUrl(file);
  const dims = await imageDimensions(dataUrl);
  state.pendingImage = {dataUrl, aspect:dims.width/dims.height, mime:file.type, name:file.name};
  setTool('imagePlacement');
  toast('Toca la página donde quieres colocar la imagen.');
});
async function placePendingImage(viewPoint) {
  const pending = state.pendingImage;
  if (!pending) return;
  const sourcePage = await state.pdfJsDoc.getPage(currentPageInfo().sourceIndex+1);
  const [x1,y1,x2,y2] = sourcePage.view;
  const pageW = x2-x1, pageH = y2-y1;
  const p = state.viewport.convertToPdfPoint(viewPoint.x,viewPoint.y);
  let width = pageW * .32;
  let height = width / pending.aspect;
  if (height > pageH*.45) { height=pageH*.45; width=height*pending.aspect; }
  let x = p[0]-width/2, y = p[1]-height/2;
  x = Math.max(x1, Math.min(x, x2-width));
  y = Math.max(y1, Math.min(y, y2-height));
  const assetId=registerAsset(pending.dataUrl,{mime:pending.mime,name:pending.name});
  addAnnotation({type:'image',rect:{x,y,width,height},assetId,mime:pending.mime,opacity:1});
  state.pendingImage = null;
  setTool('select');
}
function fileToDataUrl(file) { return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}); }
function imageDimensions(src) { return new Promise((resolve,reject)=>{const im=new Image(); im.onload=()=>resolve({width:im.naturalWidth,height:im.naturalHeight}); im.onerror=reject; im.src=src;}); }

els.signatureBtn.addEventListener('click', createSignature);
async function createSignature() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p class="muted">Firma dentro del recuadro. Puedes usar dedo, Apple Pencil o mouse.</p><canvas class="signature-pad" width="900" height="360"></canvas><div class="action-row"><button id="clearSig" class="mini-btn">Limpiar</button></div>`;
  const canvas = wrap.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#111111';
  let drawing=false, hasInk=false;
  const pt = e => { const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}; };
  canvas.addEventListener('pointerdown',e=>{drawing=true;hasInk=true;canvas.setPointerCapture(e.pointerId);const p=pt(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=pt(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
  canvas.addEventListener('pointerup',()=>drawing=false); canvas.addEventListener('pointercancel',()=>drawing=false);
  wrap.querySelector('#clearSig').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false;});
  const result = await openModal({title:'Crear firma',body:wrap,actions:[{label:'Cancelar',value:null},{label:'Usar firma',value:'use',kind:'primary'}]});
  if (result !== 'use' || !hasInk) return;
  const dataUrl = trimSignatureCanvas(canvas).toDataURL('image/png');
  const dims = await imageDimensions(dataUrl);
  state.pendingImage = {dataUrl,aspect:dims.width/dims.height,mime:'image/png',name:'signature.png'};
  setTool('imagePlacement');
  toast('Toca la página donde quieres colocar la firma.');
}
function trimSignatureCanvas(source) {
  const ctx = source.getContext('2d');
  const {width,height} = source;
  const data = ctx.getImageData(0,0,width,height).data;
  let minX=width,minY=height,maxX=0,maxY=0,found=false;
  for(let y=0;y<height;y+=2){for(let x=0;x<width;x+=2){const a=data[(y*width+x)*4+3];if(a>8){found=true;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}}
  if(!found) return source;
  const pad=16; minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(width,maxX+pad);maxY=Math.min(height,maxY+pad);
  const out=document.createElement('canvas'); out.width=Math.max(1,maxX-minX);out.height=Math.max(1,maxY-minY);
  out.getContext('2d').drawImage(source,minX,minY,out.width,out.height,0,0,out.width,out.height); return out;
}

function renderProperties() {
  const ann = currentAnnotation();
  if (!ann) {
    els.propertiesBody.innerHTML = `<div class="muted">Selecciona una anotación para editarla. En móvil, toca un objeto y usa los controles básicos; los cambios también se pueden deshacer.</div>`;
    return;
  }
  const wrap = document.createElement('div');
  const typeLabel = {text:'Texto',replaceText:'Texto reemplazado',whiteout:'Borrado visual',redact:'Redacción',highlight:'Resaltado',draw:'Dibujo',image:'Imagen/Firma'}[ann.type] || ann.type;
  wrap.innerHTML = `<div class="section-title">${typeLabel}</div>`;
  if (ann.type === 'text' || ann.type === 'replaceText') {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="form-row"><label>Texto</label><textarea data-prop="text"></textarea></div>
      <div class="row-2"><div class="form-row"><label>Tamaño</label><input data-prop="fontSize" type="number" min="4" max="144" step="0.5"></div><div class="form-row"><label>Color</label><input data-prop="color" type="color"></div></div>
      <div class="form-row"><label>Fuente</label><select data-prop="font"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select></div>`);
    wrap.querySelector('[data-prop=text]').value = ann.text || '';
    wrap.querySelector('[data-prop=fontSize]').value = ann.fontSize || 16;
    wrap.querySelector('[data-prop=color]').value = ann.color || '#111111';
    wrap.querySelector('[data-prop=font]').value = ann.font || 'Helvetica';
  } else if (ann.type === 'highlight') {
    wrap.insertAdjacentHTML('beforeend', `<div class="form-row"><label>Color</label><input data-prop="color" type="color"></div><div class="form-row"><label>Opacidad</label><input data-prop="opacity" type="range" min="0.1" max="0.8" step="0.05"></div>`);
    wrap.querySelector('[data-prop=color]').value = ann.color || '#fde047';
    wrap.querySelector('[data-prop=opacity]').value = ann.opacity ?? .35;
  } else if (ann.type === 'draw') {
    wrap.insertAdjacentHTML('beforeend', `<div class="form-row"><label>Color</label><input data-prop="color" type="color"></div><div class="form-row"><label>Grosor</label><input data-prop="width" type="range" min="0.5" max="12" step="0.5"></div>`);
    wrap.querySelector('[data-prop=color]').value = ann.color || '#111827';
    wrap.querySelector('[data-prop=width]').value = ann.width || 2;
  } else if (ann.type === 'image') {
    wrap.insertAdjacentHTML('beforeend', `<div class="row-2"><div class="form-row"><label>Ancho (pt)</label><input data-prop="widthRect" type="number" min="10" step="1"></div><div class="form-row"><label>Alto (pt)</label><input data-prop="heightRect" type="number" min="10" step="1"></div></div><div class="form-row"><label>Opacidad</label><input data-prop="opacity" type="range" min="0.1" max="1" step="0.05"></div>`);
    wrap.querySelector('[data-prop=widthRect]').value = ann.rect.width.toFixed(1);
    wrap.querySelector('[data-prop=heightRect]').value = ann.rect.height.toFixed(1);
    wrap.querySelector('[data-prop=opacity]').value = ann.opacity ?? 1;
  }
  wrap.insertAdjacentHTML('beforeend', `<div class="action-row"><button id="dupAnn" class="mini-btn">Duplicar</button><button id="deleteAnn" class="mini-btn danger">Eliminar</button></div>`);
  wrap.querySelectorAll('[data-prop]').forEach(input => {
    input.addEventListener('change', () => {
      const live = currentAnnotation(); if (!live) return;
      const before=structuredClone(live);
      const prop = input.dataset.prop;
      if (prop === 'widthRect') live.rect.width = Math.max(10, Number(input.value)||live.rect.width);
      else if (prop === 'heightRect') live.rect.height = Math.max(10, Number(input.value)||live.rect.height);
      else if (['fontSize','opacity','width'].includes(prop)) live[prop] = Number(input.value);
      else live[prop] = input.value;
      try {if(['text','replaceText'].includes(live.type))layoutText(live,previewFonts[live.font]);}
      catch(err){Object.assign(live,before);toast(err.message,5000);renderProperties();return;}
      const after=structuredClone(live);Object.assign(live,before);pushHistory();Object.assign(live,after);
      renderOverlay();
      renderProperties();persistSoon();
    });
  });
  wrap.querySelector('#deleteAnn').addEventListener('click', deleteSelectedAnnotation);
  wrap.querySelector('#dupAnn').addEventListener('click', duplicateSelectedAnnotation);
  els.propertiesBody.innerHTML = '';
  els.propertiesBody.appendChild(wrap);
}
function deleteSelectedAnnotation() {
  const p = currentPageInfo(); if (!p || !state.selectedId) return;
  const idx = p.annotations.findIndex(a => a.id===state.selectedId); if (idx<0) return;
  pushHistory(); p.annotations.splice(idx,1); state.selectedId=null; els.properties.classList.remove('mobile-open'); renderOverlay(); renderProperties();persistSoon();
}
function duplicateSelectedAnnotation() {
  const a = currentAnnotation(); const p=currentPageInfo(); if(!a||!p)return;
  pushHistory(); const c=structuredClone(a); c.id=uid('a');
  delete c.sourceKey;
  if(c.frame){c.frame.x+=8;c.frame.y-=8;}
  if(c.rect){c.rect.x+=8;c.rect.y-=8;} else if(c.x!=null){c.x+=8;c.y-=8;} else if(c.points){c.points=c.points.map(([x,y])=>[x+8,y-8]);}
  p.annotations.push(c); state.selectedId=c.id; renderOverlay(); renderProperties();persistSoon();
}

function updatePageControls() {
  const total=state.pages.length;
  els.pageInput.value = total ? state.current+1 : 0;
  els.pageTotal.textContent = `/ ${total}`;
  els.pageCount.textContent = total;
  els.prevPageBtn.disabled = state.current<=0;
  els.nextPageBtn.disabled = state.current>=total-1;
  els.moveUpBtn.disabled = state.current<=0;
  els.moveDownBtn.disabled = state.current>=total-1;
  els.deletePageBtn.disabled = total<=1;
  els.zoomLabel.textContent = `${Math.round(state.displayScale*100)}%`;
}
async function goToPage(index) {
  if (!state.pages.length) return;
  state.current = Math.max(0,Math.min(index,state.pages.length-1));
  state.selectedId=null;
  els.properties.classList.remove('mobile-open');
  await renderCurrentPage();persistSoon();
}
function refreshPageUI(rebuildThumbs=false) {
  updatePageControls();
  if(rebuildThumbs) buildThumbnails();
  renderCurrentPage({keepScroll:true});
}
els.prevPageBtn.addEventListener('click',()=>goToPage(state.current-1));
els.nextPageBtn.addEventListener('click',()=>goToPage(state.current+1));
els.pageInput.addEventListener('change',()=>goToPage((Number(els.pageInput.value)||1)-1));
els.zoomInBtn.addEventListener('click',()=>{state.fit=false;state.zoom=Math.min(4,(state.displayScale||1)*1.2);renderCurrentPage({keepScroll:true});});
els.zoomOutBtn.addEventListener('click',()=>{state.fit=false;state.zoom=Math.max(.2,(state.displayScale||1)/1.2);renderCurrentPage({keepScroll:true});});
els.fitBtn.addEventListener('click',()=>{state.fit=true;renderCurrentPage();});

function buildThumbnails() {
  els.thumbs.innerHTML='';
  state.thumbObserver?.disconnect();
  state.thumbObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if(entry.isIntersecting){ const c=entry.target.querySelector('canvas'); if(c && !c.dataset.rendered) renderThumb(c, Number(c.dataset.index)); }
  }), {root:els.thumbs,rootMargin:'240px'});
  state.pages.forEach((page,i)=>{
    const item=document.createElement('div'); item.className='thumb'+(i===state.current?' active':''); item.dataset.index=i;
    item.innerHTML=`<canvas data-index="${i}" width="120" height="150"></canvas><div class="thumb-meta"><span>Página ${i+1}</span><span>${page.annotations.length ? `${page.annotations.length} cambio${page.annotations.length===1?'':'s'}` : ''}</span></div>`;
    item.addEventListener('click',()=>goToPage(i)); els.thumbs.appendChild(item); state.thumbObserver.observe(item);
  });
  updatePageControls();
}
async function renderThumb(canvas,index) {
  const info=state.pages[index]; if(!info||!canvas.isConnected)return;
  try{
    const page=await state.pdfJsDoc.getPage(info.sourceIndex+1); const rot=((page.rotate||0)+info.rotationDelta+360)%360;
    const b=page.getViewport({scale:1,rotation:rot}); const scale=Math.min(135/b.width,170/b.height); const v=page.getViewport({scale,rotation:rot});
    canvas.width=Math.max(1,Math.floor(v.width));canvas.height=Math.max(1,Math.floor(v.height));canvas.style.width=`${v.width}px`;canvas.style.height=`${v.height}px`;
    await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:v}).promise;canvas.dataset.rendered='1';
  }catch(err){console.warn('thumb',err);}
}
function updateThumbActive(){document.querySelectorAll('.thumb').forEach((el,i)=>el.classList.toggle('active',i===state.current));}

function mutatePage(fn,{rebuild=true}={}) { if(!currentPageInfo())return; pushHistory(); fn(); state.selectedId=null; if(rebuild) buildThumbnails(); renderCurrentPage({keepScroll:true});persistSoon(); }
els.rotateLeftBtn.addEventListener('click',()=>mutatePage(()=>{currentPageInfo().rotationDelta=(currentPageInfo().rotationDelta+270)%360;}));
els.rotateRightBtn.addEventListener('click',()=>mutatePage(()=>{currentPageInfo().rotationDelta=(currentPageInfo().rotationDelta+90)%360;}));
els.duplicatePageBtn.addEventListener('click',()=>mutatePage(()=>{const copy=structuredClone(currentPageInfo());copy.id=uid('p');copy.annotations=copy.annotations.map(a=>({...a,id:uid('a')}));state.pages.splice(state.current+1,0,copy);state.current++;}));
els.deletePageBtn.addEventListener('click',()=>{if(state.pages.length<=1)return;mutatePage(()=>{state.pages.splice(state.current,1);state.current=Math.min(state.current,state.pages.length-1);});});
els.moveUpBtn.addEventListener('click',()=>{if(state.current<=0)return;mutatePage(()=>{[state.pages[state.current-1],state.pages[state.current]]=[state.pages[state.current],state.pages[state.current-1]];state.current--;});});
els.moveDownBtn.addEventListener('click',()=>{if(state.current>=state.pages.length-1)return;mutatePage(()=>{[state.pages[state.current+1],state.pages[state.current]]=[state.pages[state.current],state.pages[state.current+1]];state.current++;});});

function structuralChanges() {
  if (!state.pdfJsDoc || state.pages.length !== state.pdfJsDoc.numPages) return true;
  return state.pages.some((p,i)=>p.sourceIndex!==i);
}
function hexToRgb(hex) {
  const h=(hex||'#000000').replace('#',''); const v=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  return {r:((v>>16)&255)/255,g:((v>>8)&255)/255,b:(v&255)/255};
}
function fontFamilyCss(font){ return font==='TimesRoman'?'Times New Roman, serif':font==='Courier'?'Courier New, monospace':'Arial, Helvetica, sans-serif'; }
function dataUrlToBytes(dataUrl){ const base64=dataUrl.split(',')[1]; const bin=atob(base64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i); return out; }
async function exportPdf() {
  if (!state.originalBytes || !state.pages.length) return;
  if (state.encrypted) {
    toast('Este PDF está cifrado. Desbloquéalo primero en una app compatible y luego vuelve a abrir la copia sin contraseña.', 6000);
    return;
  }
  setLoading(true);
  try {
    const PDFLib = await ensurePdfLib();
    const {PDFDocument, StandardFonts, rgb, degrees} = PDFLib;
    const source = await PDFDocument.load(state.originalBytes.slice(), {updateMetadata:false});
    const structural = structuralChanges();
    let out, outPages;
    if (!structural) {
      out = source;
      outPages = out.getPages();
    } else {
      out = await PDFDocument.create();
      const copied = await out.copyPages(source, state.pages.map(p=>p.sourceIndex));
      copied.forEach(p=>out.addPage(p));
      outPages = out.getPages();
      try {
        const title=source.getTitle(); if(title)out.setTitle(title);
        const author=source.getAuthor(); if(author)out.setAuthor(author);
        const subject=source.getSubject(); if(subject)out.setSubject(subject);
        const keywords=source.getKeywords(); if(keywords?.length)out.setKeywords(keywords);
      } catch {}
    }
    const fonts = {
      Helvetica: await out.embedFont(StandardFonts.Helvetica),
      TimesRoman: await out.embedFont(StandardFonts.TimesRoman),
      Courier: await out.embedFont(StandardFonts.Courier)
    };
    const imageCache = new Map();
    for (let i=0;i<state.pages.length;i++) {
      const info=state.pages[i], page=outPages[i];
      const baseRot=page.getRotation()?.angle || 0;
      page.setRotation(degrees(((baseRot+info.rotationDelta)%360+360)%360));
      for (const ann of info.annotations) await applyAnnotationToPdf(out,page,ann,fonts,imageCache,rgb);
    }
    out.setModificationDate(new Date());
    const bytes = await out.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:40});
    const blob = new Blob([bytes],{type:'application/pdf'});
    const name = (state.fileName || 'document.pdf').replace(/\.pdf$/i,'') + '-edited.pdf';
    const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    toast(`Exportado: ${name}`,4000);
  } catch (err) {
    console.error(err);
    toast(`No se pudo exportar: ${err?.message || err}`,6000);
  } finally { setLoading(false); }
}
async function applyAnnotationToPdf(doc,page,ann,fonts,imageCache,rgb) {
  if (ann.type==='whiteout' && ann.rect) {
    page.drawRectangle({...ann.rect,color:rgb(1,1,1),borderWidth:0}); return;
  }
  if (ann.type==='redact' && ann.rect) {
    page.drawRectangle({...ann.rect,color:rgb(0,0,0),borderWidth:0}); return;
  }
  if (ann.type==='highlight' && ann.rect) {
    const c=hexToRgb(ann.color||'#fde047'); page.drawRectangle({...ann.rect,color:rgb(c.r,c.g,c.b),opacity:ann.opacity??.35,borderWidth:0}); return;
  }
  if (ann.type==='replaceText' || ann.type==='text') {
    const font=fonts[ann.font]||fonts.Helvetica;
    const layout=layoutText(ann,font);
    if(ann.type==='replaceText') {
      const f=ann.frame || {x:ann.rect.x,y:ann.rect.y+ann.rect.height,width:ann.rect.width,height:ann.rect.height,angle:0};
      page.drawRectangle({x:f.x+Math.sin(f.angle)*f.height,y:f.y-Math.cos(f.angle)*f.height,width:f.width,height:f.height,rotate:window.PDFLib.degrees(f.angle*180/Math.PI),color:rgb(1,1,1),borderWidth:0});
    }
    const c=hexToRgb(ann.color||'#111111');
    for(const line of layout.lines) if(line.text)page.drawText(line.text,{x:line.x,y:line.y,size:layout.size,font,color:rgb(c.r,c.g,c.b),rotate:window.PDFLib.degrees(layout.angle*180/Math.PI),opacity:ann.opacity??1});
    return;
  }
  if (ann.type==='draw' && ann.points?.length>1) {
    const c=hexToRgb(ann.color||'#111827'); for(let i=1;i<ann.points.length;i++)page.drawLine({start:{x:ann.points[i-1][0],y:ann.points[i-1][1]},end:{x:ann.points[i][0],y:ann.points[i][1]},thickness:ann.width||2,color:rgb(c.r,c.g,c.b),opacity:ann.opacity??1}); return;
  }
  if (ann.type==='image' && ann.rect) {
    const asset=assetRecord(ann);
    if(!asset?.dataUrl)return;
    let embedded=imageCache.get(ann.assetId || asset.dataUrl);
    if(!embedded){const bytes=dataUrlToBytes(asset.dataUrl);const mime=asset.mime || ann.mime;embedded=mime==='image/jpeg'?await doc.embedJpg(bytes):await doc.embedPng(bytes);imageCache.set(ann.assetId || asset.dataUrl,embedded);}
    page.drawImage(embedded,{...ann.rect,opacity:ann.opacity??1});
  }
}

els.exportBtn.addEventListener('click', exportPdf);
els.undoBtn.addEventListener('click', undo); els.redoBtn.addEventListener('click', redo);
els.openBtn.addEventListener('click',()=>els.pdfInput.click()); els.emptyOpenBtn.addEventListener('click',()=>els.pdfInput.click());
els.pdfInput.addEventListener('change',()=>openPdfFile(els.pdfInput.files?.[0]));
document.querySelectorAll('.tool[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));

['dragenter','dragover'].forEach(type=>window.addEventListener(type,e=>{e.preventDefault(); if(e.dataTransfer?.types?.includes('Files'))document.querySelector('.editor-area').classList.add('drop-active');}));
['dragleave','drop'].forEach(type=>window.addEventListener(type,e=>{e.preventDefault(); if(type==='drop'){const f=e.dataTransfer?.files?.[0]; if(f)openPdfFile(f);} document.querySelector('.editor-area').classList.remove('drop-active');}));

window.addEventListener('keydown', e => {
  const editing=document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
  if(editing && e.key!=='Escape')return;
  const cmd=e.ctrlKey||e.metaKey;
  if(cmd&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
  if(cmd&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
  if((e.key==='Delete'||e.key==='Backspace')&&state.selectedId&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();deleteSelectedAnnotation();}
  if(e.key==='Escape'){if(!els.modalBackdrop.classList.contains('hidden'))closeModal(null);else{state.pendingImage=null;setTool('select');}}
});
let resizeTimer, previousWidth=els.canvasScroller.clientWidth;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const width=els.canvasScroller.clientWidth;if(width!==previousWidth){previousWidth=width;if(state.pdfJsDoc&&state.fit)renderCurrentPage({keepScroll:true});}},150);});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    const announce=()=>{if(reg.waiting){$('updateBtn').classList.remove('hidden');$('updateBtn').onclick=async()=>{await persistNow();reg.waiting.postMessage({type:'ACTIVATE'});};}};
    announce();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',announce));
  }).catch(err=>console.warn('SW',err));
  let controlled=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controlled)location.reload();controlled=true;});
}

updateUndoRedo();

let saveTimer, saveQueue=Promise.resolve(), restoredSession;
function persistSoon() {
  clearTimeout(saveTimer);
  $('saveStatus').textContent='Guardando…';
  saveTimer=setTimeout(()=>persistNow(),100);
}
function persistNow() {
  clearTimeout(saveTimer);
  if(!state.originalBytes)return Promise.resolve();
  if(state.encrypted) {
    $('saveStatus').textContent='PDF protegido: sin recuperación local';
    saveQueue=saveQueue.catch(()=>{}).then(()=>clearSession()).catch(console.warn);
    return saveQueue;
  }
  const session={version:2,bytes:state.originalBytes.slice(),fileName:state.fileName,...snapshot(),assets:serializedAssets(),history:structuredClone(state.history),future:structuredClone(state.future)};
  saveQueue=saveQueue.catch(()=>{}).then(()=>saveSession(session)).then(()=>{$('saveStatus').textContent='Guardado en este dispositivo';}).catch(err=>{console.warn(err);$('saveStatus').textContent='No se pudo guardar. Exporta para conservar cambios.';});
  return saveQueue;
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)persistNow();});
window.addEventListener('pagehide',()=>persistNow());
$('restoreBtn').addEventListener('click',async()=>{
  if(!restoredSession)return;
  const saved=restoredSession;
  await openPdfFile(new File([saved.bytes],saved.fileName,{type:'application/pdf'}));
  if(!state.pdfJsDoc)return;
  clearTimeout(saveTimer);
  state.pages=saved.pages;state.current=saved.current;state.selectedId=null;
  resetAssets(saved.assets);
  state.history=saved.history || [];state.future=saved.future || [];
  updateUndoRedo();buildThumbnails();await renderCurrentPage();persistSoon();
  $('restoreBtn').classList.add('hidden');$('forgetBtn').classList.add('hidden');
});
$('forgetBtn').addEventListener('click',async()=>{
  clearTimeout(saveTimer);
  saveQueue=saveQueue.catch(()=>{}).then(()=>clearSession());
  await saveQueue;restoredSession=null;
  $('restoreBtn').classList.add('hidden');$('forgetBtn').classList.add('hidden');
});
loadSession().then(saved=>{
  const normalized=normalizeSession(saved);
  if(normalized?.version===2 && normalized.bytes && normalized.pages?.length && !state.pdfJsDoc){restoredSession=normalized;$('restoreBtn').classList.remove('hidden');$('forgetBtn').classList.remove('hidden');}
}).catch(console.warn);
