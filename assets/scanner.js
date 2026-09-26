// Beleg scannen: Kamera → Zuschneiden → Verbessern → PDF
import { $, $$, esc, download } from './common.js?v=dd1f3874';
import { detectCorners, warp, applyFilter, rotate90, toCanvas, FILTERS } from './imaging.js?v=062d8b10';
import { handoff } from './handoff.js?v=e51abca0';

const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;
const state = {
  stream: null, track: null,
  source: null,       // HTMLCanvasElement des Originalfotos
  corners: null,      // 4 Punkte in Bildkoordinaten
  warped: null,       // ImageData nach Entzerrung
  filter: 'color',
  result: null,       // ImageData nach Filter
  pages: [],          // { canvas, thumb, filter }
  queue: [],          // weitere ausgewählte Bilder
};

/* ————— Schritte ————— */
function show(step) {
  const inCam = step === 'camera';
  for (const el of $$('[data-step]')) el.hidden = !(el.dataset.step === step || (step === 'capture' && el.dataset.step === 'capture'));
  for (const el of $$('[data-bar]')) el.hidden = el.dataset.bar !== (inCam ? 'capture' : step);
  const order = ['capture', 'crop', 'enhance', 'save'];
  const cur = inCam ? 'capture' : step;
  for (const li of $$('#stepsBar li')) {
    const i = order.indexOf(li.dataset.s), c = order.indexOf(cur);
    li.classList.toggle('is-on', i === c || (li.dataset.s === 'save' && state.pages.length && cur === 'capture'));
    li.classList.toggle('is-done', i < c);
  }
  if (step !== 'camera') stopCamera();
}
const busy = (on, text = 'wird berechnet …') => { const b = $('#busy'); b.hidden = !on; b.textContent = text; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ————— Kamera ————— */
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('#fileCam').click(); return; }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false,
    });
    state.track = state.stream.getVideoTracks()[0];
    const v = $('#video');
    v.srcObject = state.stream;
    await v.play();
    const caps = state.track.getCapabilities?.() || {};
    $('#torch').hidden = !caps.torch;
    show('camera');
  } catch (e) {
    $('#camNote').textContent = e.name === 'NotAllowedError'
      ? 'Kein Kamerazugriff erlaubt. Du kannst stattdessen ein Bild auswählen.'
      : 'Keine Kamera gefunden. Du kannst stattdessen ein Bild auswählen.';
  }
}
function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null; state.track = null;
}
async function capture() {
  const v = $('#video');
  $('#flash').classList.remove('go'); void $('#flash').offsetWidth; $('#flash').classList.add('go');
  let bmp = null;
  try { if ('ImageCapture' in window) bmp = await new ImageCapture(state.track).grabFrame(); } catch { /* Fallback unten */ }
  const w = bmp?.width || v.videoWidth, h = bmp?.height || v.videoHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp || v, 0, 0, w, h);
  loadSource(c);
}

/* ————— Bild laden ————— */
async function loadFile(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = 4000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  loadSource(c);
}
async function loadSource(canvas) {
  state.source = canvas;
  show('crop');
  busy(true, 'Ränder werden gesucht …');
  await nextFrame();
  state.corners = detectCorners(canvas) || fullCorners();
  busy(false);
  drawCrop();
}
const fullCorners = () => {
  const { width: w, height: h } = state.source;
  const m = Math.round(Math.min(w, h) * 0.04);
  return [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }];
};

/* ————— Zuschneiden ————— */
function drawCrop() {
  const c = $('#cropCanvas'), src = state.source;
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const svg = $('#cropSvg');
  svg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
  const r = Math.max(src.width, src.height) / 70;
  const pts = state.corners;
  svg.innerHTML = `<polygon points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>`
    + pts.map((p, i) => `<circle class="hit" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${r * 2.6}"/><circle class="h" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${r}"/>`).join('');
}
let drag = null;
$('#cropSvg').addEventListener('pointerdown', (e) => {
  const i = e.target.dataset?.i;
  if (i === undefined) return;
  drag = Number(i);
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
});
$('#cropSvg').addEventListener('pointermove', (e) => {
  if (drag === null) return;
  const svg = $('#cropSvg');
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const { width: w, height: h } = state.source;
  state.corners[drag] = { x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) };
  drawCrop();
});
const endDrag = () => { drag = null; };
$('#cropSvg').addEventListener('pointerup', endDrag);
$('#cropSvg').addEventListener('pointercancel', endDrag);

// Ecken sortieren (falls vertauscht gezogen): oben links, oben rechts, unten rechts, unten links
function orderCorners(pts) {
  const s = pts.map((p) => p.x + p.y), d = pts.map((p) => p.x - p.y);
  const pick = (arr, fn) => pts[arr.indexOf(fn(...arr))];
  return [pick(s, Math.min), pick(d, Math.max), pick(s, Math.max), pick(d, Math.min)];
}

/* ————— Verbessern ————— */
async function toEnhance() {
  show('enhance');
  busy(true, 'wird entzerrt …');
  await nextFrame();
  state.warped = warp(state.source, orderCorners(state.corners));
  await renderFilter();
}
async function renderFilter() {
  busy(true, 'Filter wird angewendet …');
  await nextFrame();
  state.result = applyFilter(state.warped, state.filter);
  const c = $('#outCanvas');
  c.width = state.result.width; c.height = state.result.height;
  c.getContext('2d').putImageData(state.result, 0, 0);
  busy(false);
  for (const b of $$('#filters button')) b.setAttribute('aria-pressed', String(b.dataset.f === state.filter));
}
$('#filters').innerHTML = Object.entries(FILTERS).map(([k, n]) => `<button type="button" data-f="${k}" aria-pressed="${k === state.filter}">${esc(n)}</button>`).join('');
$('#filters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.filter = b.dataset.f; renderFilter(); } });

/* ————— Seiten ————— */
function addPage() {
  const canvas = toCanvas(state.result);
  const t = document.createElement('canvas');
  const k = 120 / canvas.width;
  t.width = 120; t.height = Math.round(canvas.height * k);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  state.pages.push({ canvas, thumb: t.toDataURL('image/jpeg', 0.7), filter: state.filter });
  renderPages();
  // weitere ausgewählte Bilder direkt anschließen
  const next = state.queue.shift();
  if (next) loadFile(next); else show('capture');
}
function renderPages() {
  $('#pgCount').textContent = String(state.pages.length);
  $('#pages').innerHTML = state.pages.map((p, i) => `
    <li class="pg"><img src="${p.thumb}" alt="Seite ${i + 1}">
      <div><b>Seite ${i + 1}</b><small>${p.canvas.width}×${p.canvas.height} · ${esc(FILTERS[p.filter])}</small></div>
      <div class="pg__act"><button type="button" data-up="${i}" aria-label="Nach oben" ${i ? '' : 'disabled'}>↑</button><button type="button" class="del" data-del="${i}" aria-label="Seite löschen">✕</button></div></li>`).join('');
  const has = state.pages.length > 0;
  for (const id of ['#savePdf', '#saveJpg', '#toRead']) $(id).disabled = !has;
  $('#more').hidden = !has;
}
$('#pages').addEventListener('click', (e) => {
  const up = e.target.closest('[data-up]'), del = e.target.closest('[data-del]');
  if (up) { const i = Number(up.dataset.up); [state.pages[i - 1], state.pages[i]] = [state.pages[i], state.pages[i - 1]]; renderPages(); }
  if (del) { state.pages.splice(Number(del.dataset.del), 1); renderPages(); }
});

/* ————— Speichern ————— */
const jpeg = (canvas, q = 0.82) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
function defaultName() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `beleg_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
const fname = () => ($('#fname').value.trim() || defaultName()).replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, '');

async function buildPdf() {
  const { PDFDocument } = await import(V('pdf-lib/pdf-lib.esm.min.js'));
  const doc = await PDFDocument.create();
  const a4 = $('#psize').value === 'a4';
  for (const p of state.pages) {
    const img = await doc.embedJpg(new Uint8Array(await (await jpeg(p.canvas, p.filter === 'bw' ? 0.7 : 0.82)).arrayBuffer()));
    if (a4) {
      const W = 595.28, H = 841.89, m = 28;
      const k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
      const w = img.width * k, h = img.height * k;
      doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: H - m - h, width: w, height: h });
    } else {
      const k = 72 / 200; // 200 dpi
      doc.addPage([img.width * k, img.height * k]).drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
    }
  }
  doc.setTitle(fname());
  doc.setCreator('beleg.org');
  doc.setProducer('beleg.org · pdf-lib');
  return doc.save();
}
$('#savePdf').addEventListener('click', async () => {
  $('#savePdf').disabled = true;
  try { download(`${fname()}.pdf`, new Blob([await buildPdf()], { type: 'application/pdf' })); } finally { $('#savePdf').disabled = false; }
});
$('#saveJpg').addEventListener('click', async () => {
  for (const [i, p] of state.pages.entries()) download(`${fname()}${state.pages.length > 1 ? `_${i + 1}` : ''}.jpg`, await jpeg(p.canvas, 0.9));
});
$('#toRead').addEventListener('click', async () => {
  const files = [];
  for (const [i, p] of state.pages.entries()) files.push(new File([await jpeg(p.canvas, 0.92)], `${fname()}_${i + 1}.jpg`, { type: 'image/jpeg' }));
  await handoff.put(files);
  location.href = '../belege-auslesen/?von=scanner';
});

/* ————— Ereignisse ————— */
$('#camStart').addEventListener('click', startCamera);
$('#camStop').addEventListener('click', () => show('capture'));
$('#shutter').addEventListener('click', capture);
$('#torch').addEventListener('click', async (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  try { await state.track.applyConstraints({ advanced: [{ torch: on }] }); e.currentTarget.setAttribute('aria-pressed', String(on)); } catch { /* nicht unterstützt */ }
});
$('#pickImg').addEventListener('click', () => $('#fileImg').click());
for (const id of ['#fileImg', '#fileCam']) {
  $(id).addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    state.queue = files.slice(1);
    loadFile(files[0]);
  });
}
$('#autoCrop').addEventListener('click', () => { state.corners = detectCorners(state.source) || fullCorners(); drawCrop(); });
$('#fullCrop').addEventListener('click', () => { const { width: w, height: h } = state.source; state.corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; drawCrop(); });
$('#rotSrc').addEventListener('click', () => {
  const s = state.source, c = document.createElement('canvas');
  c.width = s.height; c.height = s.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(s, 0, 0);
  loadSource(c);
});
$('#toEnhance').addEventListener('click', toEnhance);
$('#rotOut').addEventListener('click', async () => { state.warped = rotate90(state.warped); await renderFilter(); });
$('#addPage').addEventListener('click', addPage);
$('#more').addEventListener('click', () => { show('capture'); $('#view').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
for (const b of $$('[data-back]')) b.addEventListener('click', () => { if (b.dataset.back === 'crop') { show('crop'); drawCrop(); } else show('capture'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { state.queue = files.slice(1); loadFile(files[0]); }
});
window.addEventListener('pagehide', stopCamera);
$('#fname').placeholder = defaultName();
show('capture');
