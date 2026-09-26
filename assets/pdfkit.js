// Gemeinsamer Kern der PDF-Werkstatt: Bibliotheken laden, Dateien öffnen, Vorschauen, ZIP.
import { download } from './common.js?v=dd1f3874';

const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;
let pdfjsP, pdflibP, fflateP;
export const pdfjs = () => (pdfjsP ??= import(V('pdfjs/pdf.min.mjs')).then((m) => { m.GlobalWorkerOptions.workerSrc = V('pdfjs/pdf.worker.min.mjs'); return m; }));
export const pdflib = () => (pdflibP ??= import(V('pdf-lib/pdf-lib.esm.min.js')));
export const fflate = () => (fflateP ??= import(V('fflate/fflate.mjs')));

export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f) => /^image\/(png|jpe?g|webp|gif|bmp)$/.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
export const baseName = (name) => String(name || 'dokument').replace(/\.[^.]+$/, '');
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dokument';

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
}

/** PDF mit pdf.js öffnen (für Vorschau/Rendering). Gibt { doc, bytes } zurück. */
export async function openPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lib = await pdfjs();
  try {
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;
    return { doc, bytes };
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('Die PDF ist mit einem Passwort geschützt.');
    throw new Error('Die Datei ist keine lesbare PDF.');
  }
}

/** Seite in ein Canvas rendern. scale oder targetWidth (px). */
export async function renderPage(page, { scale, width, rotation = 0 } = {}) {
  const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
  const s = scale || (width ? width / base.width : 1);
  const vp = page.getViewport({ scale: s, rotation: page.rotate + rotation });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, viewport: vp };
}

/** Bild (File/Blob) in ein Canvas laden, EXIF-Drehung beachten. */
export async function imageCanvas(file, maxSide = 4000) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export const canvasBlob = (c, type = 'image/jpeg', q = 0.85) => new Promise((r) => c.toBlob(r, type, q));
export const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());

/** Bild als Seite in ein pdf-lib-Dokument einfügen. fit: 'a4' | 'image' */
export async function addImagePage(pdfDoc, canvas, { fit = 'a4', landscape = false, margin = 28, quality = 0.85, dpi = 150 } = {}) {
  const img = await pdfDoc.embedJpg(await blobBytes(await canvasBlob(canvas, 'image/jpeg', quality)));
  if (fit === 'image') {
    const k = 72 / dpi;
    const page = pdfDoc.addPage([img.width * k, img.height * k]);
    page.drawImage(img, { x: 0, y: 0, width: img.width * k, height: img.height * k });
    return page;
  }
  let W = 595.28, H = 841.89;
  if (landscape === 'auto' ? img.width > img.height : landscape) [W, H] = [H, W];
  const s = Math.min((W - 2 * margin) / img.width, (H - 2 * margin) / img.height);
  const w = img.width * s, h = img.height * s;
  const page = pdfDoc.addPage([W, H]);
  page.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  return page;
}

export async function savePdf(pdfDoc, filename) {
  pdfDoc.setProducer('beleg.org · pdf-lib');
  pdfDoc.setCreator('beleg.org');
  const bytes = await pdfDoc.save({ useObjectStreams: true });
  download(filename, new Blob([bytes], { type: 'application/pdf' }));
  return bytes;
}

/** Dateien als ZIP herunterladen: [{ name, data: Uint8Array }] */
export async function downloadZip(filename, entries) {
  const { zipSync } = await fflate();
  const obj = {};
  const used = new Set();
  for (const e of entries) {
    let n = e.name, i = 2;
    while (used.has(n)) n = e.name.replace(/(\.[^.]+)?$/, `_${i++}$1`);
    used.add(n);
    obj[n] = [e.data, { level: /\.(jpe?g|png|pdf|zip)$/i.test(n) ? 0 : 6 }];
  }
  download(filename, new Blob([zipSync(obj)], { type: 'application/zip' }));
}

/** Ablagefeld verdrahten: Klick, Tastatur, Drag & Drop (auch aufs ganze Fenster), Einfügen. */
export function setupDrop({ zone, input, onFiles, accept = () => true }) {
  const take = (list) => { const files = [...list].filter(accept); if (files.length) onFiles(files); };
  zone.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, label')) input.click(); });
  zone.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === zone) { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; zone.classList.add('is-over'); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('is-over'); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); depth = 0; zone.classList.remove('is-over');
    take(e.dataTransfer.files);
  });
  document.addEventListener('paste', (e) => { if (!e.target.closest('input, textarea') && e.clipboardData?.files?.length) take(e.clipboardData.files); });
}

/** Einfacher Status-Text mit Fortschritt */
export function status(el) {
  return {
    set(text, kind = '') { el.hidden = !text; el.textContent = text; el.dataset.kind = kind; },
    clear() { el.hidden = true; el.textContent = ''; },
  };
}
