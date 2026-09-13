import { groupTextMetasIntoBlocks, groupTextLayerEntriesIntoBlocks } from './text-blocks.js';

let pdfjsLib;
let pdfJsBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289';
try {
  pdfjsLib = await import(`${pdfJsBase}/build/pdf.mjs`);
} catch (firstError) {
  console.warn('PDF.js primary CDN failed, using fallback.', firstError);
  pdfJsBase = 'https://unpkg.com/pdfjs-dist@6.3.289';
  pdfjsLib = await import(`${pdfJsBase}/build/pdf.mjs`);
}
pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfJsBase}/build/pdf.worker.mjs`;

async function ensurePdfLib() {
  if (window.PDFLib) return window.PDFLib;
  const urls = [
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
  ];
  let lastError;
  for (const src of urls) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src; script.crossOrigin = 'anonymous';
        script.onload = resolve; script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(script);
      });
      if (window.PDFLib) return window.PDFLib;
    } catch (err) { lastError = err; }
  }
  throw lastError || new Error('No se pudo cargar pdf-lib');
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
  loadingTask: null,
  thumbObserver: null,
  modalResolver: null,
  textItems: [],
  activeTextLayer: null
};

function uid(prefix = 'a') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function deepClonePages(pages = state.pages) {
  return pages.map(p => ({...p, annotations: p.annotations.map(a => ({...a, rect: a.rect ? {...a.rect} : undefined, points: a.points ? a.points.map(pt => [...pt]) : undefined}))}));
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
    b.addEventListener('click', () => closeModal(action.value));
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
  setLoading(true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.originalBytes = bytes;
    state.fileName = file.name || 'document.pdf';
    state.encrypted = false;
    state.password = null;
    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      cMapUrl: `${pdfJsBase}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfJsBase}/standard_fonts/`,
      wasmUrl: `${pdfJsBase}/wasm/`
    });
    state.loadingTask = loadingTask;
    loadingTask.onPassword = (updatePassword, reason) => askPassword(updatePassword, reason);
    const doc = await loadingTask.promise;
    state.pdfJsDoc = doc;
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
    toast('PDF abierto. Los cambios permanecen en este dispositivo hasta exportar.');
  } catch (err) {
    console.error(err);
    if (!state.encrypted || err?.name !== 'PasswordException') {
      toast(`No se pudo abrir el PDF: ${err?.message || 'error desconocido'}`, 5000);
    }
  } finally {
    setLoading(false);
    els.pdfInput.value = '';
  }
}

async function renderCurrentPage({keepScroll = false} = {}) {
  const pageInfo = currentPageInfo();
  if (!pageInfo || !state.pdfJsDoc) return;
  const seq = ++state.renderSeq;
  const sourcePage = await state.pdfJsDoc.getPage(pageInfo.sourceIndex + 1);
  const totalRotation = ((sourcePage.rotate || 0) + pageInfo.rotationDelta + 360) % 360;
  const base = sourcePage.getViewport({scale:1, rotation: totalRotation});
  const scrollerWidth = Math.max(320, els.canvasScroller.clientWidth - 36);
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
  await sourcePage.render({canvasContext:ctx, viewport:renderViewport}).promise;
  if (seq !== state.renderSeq) return;
  renderOverlay();
  await renderTextHitLayer(sourcePage, seq);
  renderProperties();
  updatePageControls();
  updateThumbActive();
  if (!keepScroll && state.fit) els.canvasScroller.scrollTo({top:0, left:0});
}

async function renderTextHitLayer(sourcePage, seq) {
  els.textHitLayer.innerHTML = '';
  els.textMeasureLayer.innerHTML = '';
  state.textItems = [];
  try { state.activeTextLayer?.cancel?.(); } catch {}
  state.activeTextLayer = null;

  const textSelectable = ['select','editText'].includes(state.tool);
  els.stage.classList.toggle('tool-editText', state.tool === 'editText');
  els.stage.classList.toggle('tool-selectText', state.tool === 'select');
  if (!textSelectable) return;

  try {
    const content = await sourcePage.getTextContent({includeMarkedContent:true});
    if (seq !== state.renderSeq || !['select','editText'].includes(state.tool)) return;

    const textItems = content.items.filter(item => typeof item?.str === 'string');
    const layerHost = els.textMeasureLayer;
    layerHost.innerHTML = '';
    layerHost.style.setProperty('--total-scale-factor', String(state.viewport.scale));
    layerHost.style.setProperty('--scale-factor', String(state.viewport.scale));

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: content,
      container: layerHost,
      viewport: state.viewport
    });
    state.activeTextLayer = textLayer;
    await textLayer.render();
    if (seq !== state.renderSeq || state.activeTextLayer !== textLayer || !['select','editText'].includes(state.tool)) return;

    // PDF.js intentionally relies on viewer CSS for TextLayer font sizing.
    // This PWA does not load the full viewer stylesheet because it conflicts
    // with our toolbar styles, so materialize the few span styles we need.
    for (const div of textLayer.textDivs) {
      const fontHeight = parseFloat(div.style.getPropertyValue('--font-height')) || 0;
      const scaleX = div.style.getPropertyValue('--scale-x').trim() || '1';
      const rotate = div.style.getPropertyValue('--rotate').trim() || '0deg';
      div.style.position = 'absolute';
      div.style.whiteSpace = 'pre';
      div.style.lineHeight = '1';
      div.style.transformOrigin = '0 0';
      div.style.fontSize = `${Math.max(1, fontHeight * state.viewport.scale)}px`;
      div.style.transform = `rotate(${rotate}) scaleX(${scaleX})`;
      div.style.webkitTextSizeAdjust = 'none';
      div.style.textSizeAdjust = 'none';
    }

    // Give Safari one layout turn so getBoundingClientRect reflects PDF.js's
    // span geometry before we build the touch targets.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (seq !== state.renderSeq || state.activeTextLayer !== textLayer || !['select','editText'].includes(state.tool)) return;

    const stageRect = els.stage.getBoundingClientRect();
    const rawMetas = [];
    textLayer.textDivs.forEach((div, idx) => {
      const item = textItems[idx];
      const text = item?.str ?? div.textContent ?? '';
      if (!text.trim()) return;
      const rect = div.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      rawMetas.push({
        item,
        text,
        idx,
        sourceIndex: idx,
        x: rect.left - stageRect.left,
        y: rect.top - stageRect.top,
        width: rect.width,
        height: rect.height,
        fontHeight: rect.height,
        angle: 0,
        hasEOL: !!item?.hasEOL
      });
    });

    let targets = state.tool === 'editText' ? groupTextLayerEntriesIntoBlocks(rawMetas) : rawMetas;

    // Safety fallback: if PDF.js reports text but browser geometry could not be
    // measured, fall back to matrix geometry rather than silently showing no boxes.
    if (!targets.length && textItems.some(item => item.str?.trim())) {
      const fallback = [];
      textItems.forEach((item, idx) => {
        if (!item.str?.trim()) return;
        const tx = pdfjsLib.Util.transform(state.viewport.transform, item.transform);
        const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]));
        fallback.push({item, text:item.str, idx, x:tx[4], y:tx[5]-fontHeight, width:Math.max(4,Math.abs(item.width*state.viewport.scale)), height:fontHeight*1.1, fontHeight, angle:Math.atan2(tx[1],tx[0]), hasEOL:!!item.hasEOL});
      });
      targets = state.tool === 'editText' ? groupTextMetasIntoBlocks(fallback) : fallback;
    }

    state.textItems = targets;
    targets.forEach((meta, idx) => {
      const box = document.createElement('div');
      box.className = meta.isTextBlock ? 'text-hit text-block-hit' : 'text-hit';
      const hitPadX = meta.isTextBlock ? 4 : 4;
      const hitPadY = meta.isTextBlock ? 3 : Math.max(0, (Math.max(24, meta.height + 8) - meta.height) / 2);
      box.style.left = `${meta.x - hitPadX}px`;
      box.style.top = `${meta.y - hitPadY}px`;
      box.style.width = `${Math.max(14, meta.width + hitPadX * 2)}px`;
      box.style.height = `${Math.max(meta.isTextBlock ? 18 : 24, meta.height + hitPadY * 2)}px`;
      box.title = meta.text || meta.item?.str || '';
      box.dataset.textBlock = String(idx);
      meta.box = box;
      box.addEventListener('pointerup', e => {
        e.preventDefault();
        e.stopPropagation();
        editExistingText(meta);
      });
      els.textHitLayer.appendChild(box);
    });

    if (state.tool === 'editText' && targets.length === 0) {
      toast('No encontré bloques de texto editables en esta página.');
    }
  } catch (err) {
    if (err?.name === 'AbortException') return;
    console.warn('Text extraction / TextLayer failed', err);
    if (state.tool === 'editText') toast('No pude crear los cuadros de texto de esta página.', 4200);
  }
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
  if (state.tool === 'select') renderAnnotationHitboxes(pageInfo.annotations);
  const selected = currentAnnotation();
  if (selected) renderSelection(selected);
}
function renderAnnotation(ann) {
  if (['whiteout','redact','highlight','replaceText'].includes(ann.type) && ann.rect) {
    const r = pdfRectToViewport(ann.rect);
    let fill = ann.type === 'redact' ? '#000' : ann.type === 'highlight' ? (ann.color || '#fde047') : '#fff';
    let opacity = ann.type === 'highlight' ? (ann.opacity ?? .35) : 1;
    els.overlay.appendChild(svgEl('rect', {x:r.x,y:r.y,width:r.width,height:r.height,fill,opacity}));
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
    const r = pdfRectToViewport(ann.rect);
    const image = svgEl('image', {x:r.x,y:r.y,width:r.width,height:r.height,href:ann.dataUrl,preserveAspectRatio:'none',opacity:ann.opacity ?? 1});
    els.overlay.appendChild(image);
  }
}
function renderTextAnnotation(ann, replacement) {
  let anchorX, anchorY;
  if (replacement && ann.rect) {
    const r = pdfRectToViewport(ann.rect);
    anchorX = r.x + 1;
    anchorY = r.y + Math.min(r.height - 1, (ann.fontSize || 12) * state.viewport.scale);
  } else {
    const p = state.viewport.convertToViewportPoint(ann.x, ann.y);
    anchorX = p[0]; anchorY = p[1];
  }
  const lines = String(ann.text || '').split(/\r?\n/);
  const text = svgEl('text', {x:anchorX,y:anchorY,fill:ann.color || '#111827','font-size':Math.max(5,(ann.fontSize || 16)*state.viewport.scale),'font-family':fontFamilyCss(ann.font),'font-weight':ann.bold?'700':'400',opacity:ann.opacity ?? 1});
  const rotation = state.totalRotation || 0;
  if (rotation) text.setAttribute('transform', `rotate(${rotation} ${anchorX} ${anchorY})`);
  lines.forEach((line,i) => {
    const tspan = svgEl('tspan', {x:anchorX,dy:i===0?'0':'1.2em'});
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  els.overlay.appendChild(text);
}
function annotationViewportBounds(ann) {
  if (ann.rect) return pdfRectToViewport(ann.rect);
  if (ann.type === 'text') {
    const p = state.viewport.convertToViewportPoint(ann.x, ann.y);
    const size = (ann.fontSize || 16) * state.viewport.scale;
    const lines = String(ann.text || '').split(/\r?\n/);
    const max = Math.max(1,...lines.map(s=>s.length));
    return {x:p[0]-2,y:p[1]-size-3,width:Math.max(20,max*size*.58+5),height:Math.max(size*1.3,lines.length*size*1.25)};
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
    hit.addEventListener('pointerdown', e => {
      e.stopPropagation();
      state.selectedId = ann.id;
      renderOverlay();
      renderProperties();
      if (window.matchMedia('(max-width: 700px)').matches) els.properties.classList.add('mobile-open');
    });
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
  box.addEventListener('click', e => e.stopPropagation());
  els.selectionLayer.appendChild(box);
}

function setTool(tool) {
  state.tool = tool;
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
    const pageInfo = currentPageInfo();
    state.pdfJsDoc.getPage(pageInfo.sourceIndex + 1)
      .then(page => renderTextHitLayer(page, seq))
      .catch(err => console.warn('Text layer refresh failed', err));
  } else {
    try { state.activeTextLayer?.cancel?.(); } catch {}
    state.activeTextLayer = null;
    els.textMeasureLayer.innerHTML = '';
    els.textHitLayer.innerHTML = '';
    state.textItems = [];
  }
  renderOverlay();
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
}

els.stage.addEventListener('pointerdown', e => {
  if (!state.pdfJsDoc || e.button > 0) return;
  if (e.target.closest('.text-hit') || e.target.closest('.selection-box')) return;
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
  if (['select','editText'].includes(state.tool)) {
    const meta = findTextAtPoint(p, state.tool === 'editText' ? 20 : 14);
    if (meta) {
      editExistingText(meta);
      return;
    }
  }
  if (state.tool === 'select') {
    state.selectedId = null;
    els.properties.classList.remove('mobile-open');
    renderOverlay();
    renderProperties();
  }
});
els.stage.addEventListener('pointermove', e => {
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
els.stage.addEventListener('pointercancel', () => { state.drag = null; renderOverlay(); });

async function editExistingText(meta) {
  const topLeft = {x:meta.x,y:meta.y};
  const bottomRight = {x:meta.x+meta.width,y:meta.y+meta.height};
  const rect = viewportRectToPdf(topLeft,bottomRight);
  const approxPt = Math.max(5, meta.fontHeight / state.viewport.scale);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="form-row"><label>Texto nuevo</label><textarea id="editTextValue"></textarea></div>
    <div class="row-2">
      <div class="form-row"><label>Tamaño</label><input id="editTextSize" type="number" min="4" max="144" step="0.5" /></div>
      <div class="form-row"><label>Color</label><input id="editTextColor" type="color" value="#111111" /></div>
    </div>
    <div class="form-row"><label>Fuente</label><select id="editTextFont"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select></div>
    <p class="muted">El PDF se mantiene visualmente: se cubre el texto original y se coloca el nuevo encima. Esto funciona incluso cuando el PDF no permite editar su estructura interna como Word.</p>`;
  wrap.querySelector('#editTextValue').value = meta.text ?? meta.item?.str ?? '';
  wrap.querySelector('#editTextSize').value = approxPt.toFixed(1);
  const choicePromise = openModal({title:'Editar texto',body:wrap,actions:[{label:'Cancelar',value:null},{label:'Aplicar',value:'apply',kind:'primary'}]});
  setTimeout(() => {
    const field = wrap.querySelector('#editTextValue');
    field?.focus();
    field?.select();
  }, 20);
  const choice = await choicePromise;
  if (choice !== 'apply') return;
  addAnnotation({type:'replaceText',rect,text:wrap.querySelector('#editTextValue').value,fontSize:Number(wrap.querySelector('#editTextSize').value)||approxPt,color:wrap.querySelector('#editTextColor').value,font:wrap.querySelector('#editTextFont').value,opacity:1});
  if (state.tool === 'editText') renderOverlay();
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
  addAnnotation({type:'text',x:pdfPoint[0],y:pdfPoint[1],text,fontSize:Number(wrap.querySelector('#newTextSize').value)||18,color:wrap.querySelector('#newTextColor').value,font:wrap.querySelector('#newTextFont').value,opacity:1});
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
  addAnnotation({type:'image',rect:{x,y,width,height},dataUrl:pending.dataUrl,mime:pending.mime,opacity:1});
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
      pushHistory();
      const prop = input.dataset.prop;
      if (prop === 'widthRect') live.rect.width = Math.max(10, Number(input.value)||live.rect.width);
      else if (prop === 'heightRect') live.rect.height = Math.max(10, Number(input.value)||live.rect.height);
      else if (['fontSize','opacity','width'].includes(prop)) live[prop] = Number(input.value);
      else live[prop] = input.value;
      renderOverlay();
      renderProperties();
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
  pushHistory(); p.annotations.splice(idx,1); state.selectedId=null; els.properties.classList.remove('mobile-open'); renderOverlay(); renderProperties();
}
function duplicateSelectedAnnotation() {
  const a = currentAnnotation(); const p=currentPageInfo(); if(!a||!p)return;
  pushHistory(); const c=structuredClone(a); c.id=uid('a');
  if(c.rect){c.rect.x+=8;c.rect.y-=8;} else if(c.x!=null){c.x+=8;c.y-=8;} else if(c.points){c.points=c.points.map(([x,y])=>[x+8,y-8]);}
  p.annotations.push(c); state.selectedId=c.id; renderOverlay(); renderProperties();
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
  await renderCurrentPage();
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

function mutatePage(fn,{rebuild=true}={}) { if(!currentPageInfo())return; pushHistory(); fn(); state.selectedId=null; if(rebuild) buildThumbnails(); renderCurrentPage({keepScroll:true}); }
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
  if (ann.type==='replaceText' && ann.rect) {
    page.drawRectangle({...ann.rect,color:rgb(1,1,1),borderWidth:0});
    const font=fonts[ann.font]||fonts.Helvetica; let size=Math.max(4,ann.fontSize||12); const text=String(ann.text||'');
    const widest=Math.max(1,...text.split(/\r?\n/).map(line=>font.widthOfTextAtSize(line,size)));
    if (widest>ann.rect.width-2) size=Math.max(4,size*((ann.rect.width-2)/widest));
    const c=hexToRgb(ann.color||'#111111');
    page.drawText(text,{x:ann.rect.x+1,y:ann.rect.y+Math.max(1,(ann.rect.height-size)*.35),size,font,color:rgb(c.r,c.g,c.b),lineHeight:size*1.15,opacity:ann.opacity??1,maxWidth:Math.max(1,ann.rect.width-2)}); return;
  }
  if (ann.type==='text') {
    const c=hexToRgb(ann.color||'#111111'); const font=fonts[ann.font]||fonts.Helvetica; const size=Math.max(4,ann.fontSize||16);
    page.drawText(String(ann.text||''),{x:ann.x,y:ann.y,size,font,color:rgb(c.r,c.g,c.b),lineHeight:size*1.2,opacity:ann.opacity??1}); return;
  }
  if (ann.type==='draw' && ann.points?.length>1) {
    const c=hexToRgb(ann.color||'#111827'); for(let i=1;i<ann.points.length;i++)page.drawLine({start:{x:ann.points[i-1][0],y:ann.points[i-1][1]},end:{x:ann.points[i][0],y:ann.points[i][1]},thickness:ann.width||2,color:rgb(c.r,c.g,c.b),opacity:ann.opacity??1}); return;
  }
  if (ann.type==='image' && ann.rect && ann.dataUrl) {
    let embedded=imageCache.get(ann.dataUrl); if(!embedded){const bytes=dataUrlToBytes(ann.dataUrl);embedded=ann.mime==='image/jpeg'?await doc.embedJpg(bytes):await doc.embedPng(bytes);imageCache.set(ann.dataUrl,embedded);}
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
  const cmd=e.ctrlKey||e.metaKey;
  if(cmd&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
  if(cmd&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
  if((e.key==='Delete'||e.key==='Backspace')&&state.selectedId&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();deleteSelectedAnnotation();}
  if(e.key==='Escape'){if(!els.modalBackdrop.classList.contains('hidden'))closeModal(null);else{state.pendingImage=null;setTool('select');}}
});
let resizeTimer; window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.pdfJsDoc&&state.fit)renderCurrentPage({keepScroll:true});},150);});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('SW',err)));
}

updateUndoRedo();
