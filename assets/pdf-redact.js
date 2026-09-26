// PDF schwärzen – echte Schwärzung durch Neuerzeugung der Seite als Bild
import { $, $$, esc } from './common.js?v=dd1f3874';
import { pdflib, renderPage, canvasBlob, blobBytes, savePdf, setupDrop, isPdf, isImage, baseName, status } from './pdfkit.js?v=78b28a4a';
import { loadDoc, renderAll, frac } from './pageview.js?v=b6cf31fe';

let doc = null, bytes = null, name = 'dokument', views = [];
let boxes = []; // { id, page, x, y, w, h }
let uid = 0;
const st = status($('#status'));

const PRESETS = {
  iban: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g,
  amount: /[-+−]?\s?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s?(?:€|EUR|S|H))?/g,
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  phone: /(?:\+\d{2}|\b0)[\d\s/()-]{6,}\d/g,
  date: /\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?\b/g,
};

async function open(file) {
  try {
    st.set('Datei wird geladen …');
    ({ doc, bytes } = await loadDoc(file));
    name = baseName(file.name);
    boxes = [];
    $('#desk').hidden = false;
    views = await renderAll($('#view'), doc);
    views.forEach(bindLayer);
    draw();
    st.clear();
  } catch (e) { st.set(e.message, 'err'); $('#desk').hidden = false; }
}

/* ————— Rechtecke aufziehen ————— */
function bindLayer(v) {
  let start = null, draft = null;
  v.layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.rbox')) return;
    e.preventDefault();
    start = frac(v.layer, e);
    draft = document.createElement('div');
    draft.className = 'rbox is-draft';
    v.layer.append(draft);
    v.layer.setPointerCapture(e.pointerId);
  });
  v.layer.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = frac(v.layer, e);
    Object.assign(draft.style, { left: `${Math.min(start.x, p.x) * 100}%`, top: `${Math.min(start.y, p.y) * 100}%`, width: `${Math.abs(p.x - start.x) * 100}%`, height: `${Math.abs(p.y - start.y) * 100}%` });
  });
  v.layer.addEventListener('pointerup', (e) => {
    if (!start) return;
    const p = frac(v.layer, e);
    const b = { id: ++uid, page: v.num - 1, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    draft.remove(); start = null;
    if (b.w > 0.008 && b.h > 0.004) boxes.push(b);
    draw();
  });
}
function draw() {
  for (const v of views) {
    v.layer.innerHTML = boxes.filter((b) => b.page === v.num - 1).map((b) => `<div class="rbox" data-id="${b.id}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"><button type="button" aria-label="Schwärzung entfernen">✕</button></div>`).join('');
  }
  $('#count').textContent = String(boxes.length);
  $('#save').disabled = !boxes.length;
}
$('#view').addEventListener('click', (e) => {
  const btn = e.target.closest('.rbox button'); if (!btn) return;
  const id = Number(btn.parentElement.dataset.id);
  boxes = boxes.filter((b) => b.id !== id); draw();
});

/* ————— Automatisch finden (Textebene) ————— */
async function findAll(re) {
  let hits = 0;
  for (const v of views) {
    const tc = await v.page.getTextContent();
    const items = tc.items.filter((it) => it.str?.length);
    // Zeilen bilden
    const lines = [];
    for (const it of items) {
      const y = it.transform[5];
      let l = lines.find((x) => Math.abs(x.y - y) < Math.max(2, (it.height || 8) * 0.4));
      if (!l) { l = { y, items: [] }; lines.push(l); }
      l.items.push(it);
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = ''; const map = [];
      l.items.forEach((it, k) => {
        if (k) { text += ' '; map.push(null); }
        for (let c = 0; c < it.str.length; c++) { text += it.str[c]; map.push({ it, c }); }
      });
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0].trim()) { re.lastIndex++; continue; }
        const covered = new Map();
        for (let i = m.index; i < m.index + m[0].length; i++) {
          const ref = map[i]; if (!ref) continue;
          const r = covered.get(ref.it) || { a: ref.c, b: ref.c };
          r.a = Math.min(r.a, ref.c); r.b = Math.max(r.b, ref.c);
          covered.set(ref.it, r);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [it, r] of covered) {
          const cw = it.width / it.str.length;
          const h = it.height || Math.abs(it.transform[3]) || 10;
          const px0 = it.transform[4] + cw * r.a, px1 = it.transform[4] + cw * (r.b + 1);
          const py0 = it.transform[5] - h * 0.25, py1 = it.transform[5] + h * 0.95;
          const rect = v.vp.convertToViewportRectangle([px0, py0, px1, py1]);
          x0 = Math.min(x0, rect[0], rect[2]); x1 = Math.max(x1, rect[0], rect[2]);
          y0 = Math.min(y0, rect[1], rect[3]); y1 = Math.max(y1, rect[1], rect[3]);
        }
        if (x0 === Infinity) continue;
        const pad = 1.5;
        boxes.push({ id: ++uid, page: v.num - 1, x: (x0 - pad) / v.vp.width, y: (y0 - pad) / v.vp.height, w: (x1 - x0 + 2 * pad) / v.vp.width, h: (y1 - y0 + 2 * pad) / v.vp.height });
        hits++;
      }
    }
  }
  draw();
  st.set(hits ? `${hits} Treffer geschwärzt` : 'Keine Treffer. Bei gescannten PDFs bitte von Hand markieren.', hits ? '' : 'err');
}
$$('#presets button').forEach((b) => b.addEventListener('click', () => findAll(new RegExp(PRESETS[b.dataset.p].source, 'g'))));
$('#find').addEventListener('click', () => {
  const q = $('#q').value.trim(); if (!q) return;
  findAll(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi'));
});
$('#clear').addEventListener('click', () => { boxes = []; draw(); st.clear(); });

/* ————— Speichern ————— */
$('#save').addEventListener('click', async () => {
  const { PDFDocument } = await pdflib();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const dpi = Number($('#dpi').value);
  for (const v of views) {
    const mine = boxes.filter((b) => b.page === v.num - 1);
    st.set(`Seite ${v.num} von ${views.length} …`);
    if (!mine.length) { const [p] = await out.copyPages(src, [v.num - 1]); out.addPage(p); continue; }
    const { canvas } = await renderPage(v.page, { scale: dpi / 72 });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    for (const b of mine) ctx.fillRect(Math.floor(b.x * canvas.width), Math.floor(b.y * canvas.height), Math.ceil(b.w * canvas.width) + 1, Math.ceil(b.h * canvas.height) + 1);
    const img = await out.embedJpg(await blobBytes(await canvasBlob(canvas, 'image/jpeg', 0.88)));
    const page = out.addPage([v.vp.width, v.vp.height]);
    page.drawImage(img, { x: 0, y: 0, width: v.vp.width, height: v.vp.height });
  }
  st.set('Gespeichert. Prüfe das Ergebnis, bevor du es weitergibst.');
  await savePdf(out, `${name}_geschwaerzt.pdf`);
});

setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: (f) => isPdf(f) || isImage(f) });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
