// Seitenbetrachter mit Ebene – gemeinsam für Schwärzen, Belegstempel und Unterschrift.
// Positionen werden als Anteile (0–1) der angezeigten Seite gespeichert und erst beim
// Speichern in PDF-Koordinaten umgerechnet (inkl. gedrehter Seiten).
import { pdflib, pdfjs, openPdf, imageCanvas, addImagePage, isPdf } from './pdfkit.js?v=78b28a4a';

/** Datei öffnen; Bilder werden vorher in ein einseitiges PDF verwandelt. */
export async function loadDoc(file) {
  if (isPdf(file)) return { ...(await openPdf(file)), name: file.name };
  const { PDFDocument } = await pdflib();
  const d = await PDFDocument.create();
  await addImagePage(d, await imageCanvas(file, 3200), { fit: 'image', dpi: 200, quality: 0.9 });
  const bytes = await d.save();
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  return { doc, bytes, name: file.name };
}

/** Alle Seiten in container rendern. Rückgabe: [{ num, el, layer, vp (Scale 1), page }] */
export async function renderAll(container, doc, { maxWidth = 900 } = {}) {
  container.innerHTML = '';
  const out = [];
  const width = Math.min(maxWidth, container.clientWidth - 36);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = (width / vp1.width) * dpr;
    const vp = page.getViewport({ scale, rotation: page.rotate });
    const el = document.createElement('div');
    el.className = 'pview__page';
    el.style.width = `${width}px`;
    el.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const layer = document.createElement('div');
    layer.className = 'pview__layer';
    layer.dataset.page = String(i - 1);
    el.innerHTML = `<span class="pview__no">${i} / ${doc.numPages}</span>`;
    el.append(c, layer);
    container.append(el);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push({ num: i, el, layer, vp: vp1, page });
  }
  return out;
}

/** Zeigerposition → Anteil der Seite */
export function frac(layer, e) {
  const r = layer.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}

/**
 * Bild (PNG-Bytes) an einer Anteilsposition auf eine pdf-lib-Seite zeichnen.
 * box: { x, y, w, h } als Anteile der angezeigten Seite, vp: pdf.js-Viewport (Scale 1)
 */
export function drawAt(pdfPage, image, box, vp, rotation, degrees) {
  const W = vp.width, H = vp.height;
  const q = vp.convertToPdfPoint(box.x * W, (box.y + box.h) * H); // untere linke Ecke der Anzeige
  pdfPage.drawImage(image, { x: q[0], y: q[1], width: box.w * W, height: box.h * H, rotate: degrees(rotation) });
}

/** Verschiebbare/skalierbare Platzierung in der Ebene anlegen. */
export function placeable(layer, { src, box, onChange, onRemove, aspect }) {
  const el = document.createElement('div');
  el.className = 'placed is-active';
  el.innerHTML = `<img src="${src}" alt=""><button type="button" aria-label="Entfernen">✕</button><span class="rs" aria-hidden="true"></span>`;
  layer.append(el);
  const apply = () => { el.style.left = `${box.x * 100}%`; el.style.top = `${box.y * 100}%`; el.style.width = `${box.w * 100}%`; };
  apply();
  let mode = null, start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    mode = e.target.classList.contains('rs') ? 'resize' : 'move';
    start = { p: frac(layer, e), box: { ...box } };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const p = frac(layer, e);
    if (mode === 'move') {
      box.x = Math.min(1 - box.w, Math.max(0, start.box.x + p.x - start.p.x));
      box.y = Math.min(1 - box.h, Math.max(0, start.box.y + p.y - start.p.y));
    } else {
      const r = layer.getBoundingClientRect();
      box.w = Math.min(1 - box.x, Math.max(0.04, start.box.w + p.x - start.p.x));
      box.h = box.w * (r.width / r.height) / aspect();
    }
    apply();
  });
  el.addEventListener('pointerup', () => { if (mode) { mode = null; onChange?.(box); } });
  el.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); el.remove(); onRemove?.(); });
  return { el, box, update: (src2) => { el.querySelector('img').src = src2; box.h = box.w * (layer.getBoundingClientRect().width / layer.getBoundingClientRect().height) / aspect(); apply(); } };
}
