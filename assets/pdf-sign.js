// PDF unterschreiben – Signaturfeld, Bild-Import, Platzieren
import { $, $$ } from './common.js?v=dd1f3874';
import { pdflib, savePdf, setupDrop, isPdf, isImage, baseName, status } from './pdfkit.js?v=78b28a4a';
import { loadDoc, renderAll, frac, placeable, drawAt } from './pageview.js?v=b6cf31fe';

let bytes = null, name = 'dokument', views = [], placed = [];
let ink = '#0b2a8a', strokes = [], uploaded = null, sig = null;
const st = status($('#status'));
const pad = $('#pad');

/* ————— Signaturfeld ————— */
function sizePad() {
  const r = pad.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
  drawPad();
}
function drawPad() {
  const x = pad.getContext('2d');
  x.clearRect(0, 0, pad.width, pad.height);
  if (uploaded) { const k = Math.min(pad.width / uploaded.width, pad.height / uploaded.height) * 0.9; x.drawImage(uploaded, (pad.width - uploaded.width * k) / 2, (pad.height - uploaded.height * k) / 2, uploaded.width * k, uploaded.height * k); return; }
  x.strokeStyle = ink; x.lineCap = 'round'; x.lineJoin = 'round';
  for (const s of strokes) {
    x.beginPath();
    s.forEach((p, i) => {
      x.lineWidth = Math.max(1.4, 3.4 - p.v * 1.6) * (window.devicePixelRatio || 1);
      if (!i) x.moveTo(p.x * pad.width, p.y * pad.height);
      else { const q = s[i - 1]; x.quadraticCurveTo(q.x * pad.width, q.y * pad.height, (q.x + p.x) / 2 * pad.width, (q.y + p.y) / 2 * pad.height); }
    });
    x.stroke();
  }
}
let cur = null, last = 0;
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); uploaded = null; pad.setPointerCapture(e.pointerId); const r = pad.getBoundingClientRect(); cur = [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, v: 0 }]; strokes.push(cur); last = performance.now(); });
pad.addEventListener('pointermove', (e) => {
  if (!cur) return;
  const r = pad.getBoundingClientRect();
  const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  const prev = cur[cur.length - 1], now = performance.now();
  p.v = Math.min(1, Math.hypot(p.x - prev.x, p.y - prev.y) * r.width / Math.max(1, now - last) / 2);
  last = now; cur.push(p); drawPad();
});
const endStroke = () => { if (cur) { cur = null; updateSig(); } };
pad.addEventListener('pointerup', endStroke); pad.addEventListener('pointercancel', endStroke);

/* ————— Unterschrift als transparentes PNG (zugeschnitten) ————— */
function sigCanvas() {
  const src = pad;
  const x = src.getContext('2d');
  const { data, width: w, height: h } = x.getImageData(0, 0, src.width, src.height);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (data[(y * w + i) * 4 + 3] > 20) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const line = $('#line').value.trim();
  const m = 8, lh = line ? Math.max(18, (y1 - y0) * 0.28) : 0;
  const c = document.createElement('canvas');
  const tw = line ? (() => { const t = c.getContext('2d'); t.font = `400 ${lh * 0.8}px "IBM Plex Sans", sans-serif`; return t.measureText(line).width; })() : 0;
  c.width = Math.max(x1 - x0, tw) + 2 * m; c.height = y1 - y0 + 2 * m + (line ? lh * 1.6 : 0);
  const cx = c.getContext('2d');
  cx.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, m, m, x1 - x0 + 1, y1 - y0 + 1);
  if (line) {
    const ly = y1 - y0 + m + lh * 0.3;
    cx.strokeStyle = '#6b7280'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(m, ly); cx.lineTo(c.width - m, ly); cx.stroke();
    cx.fillStyle = '#111827'; cx.font = `400 ${lh * 0.8}px "IBM Plex Sans", sans-serif`; cx.textBaseline = 'top'; cx.fillText(line, m, ly + lh * 0.25);
  }
  return c;
}
function updateSig() {
  const c = sigCanvas();
  sig = c ? { url: c.toDataURL('image/png'), aspect: c.width / c.height } : null;
  for (const p of placed) if (sig) p.h.update(sig.url);
  $('#save').disabled = !(sig && placed.length);
}
async function loadSignatureImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  const k = Math.min(1, 1600 / bmp.width);
  c.width = bmp.width * k; c.height = bmp.height * k;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height);
  // Helles Papier durchsichtig, Strich in gewählter Tinte (Kontrast verstärkt)
  const [r0, g0, b0] = [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)];
  for (let i = 0; i < d.data.length; i += 4) {
    const l = d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114;
    const a = Math.max(0, Math.min(255, (185 - l) * 3));
    d.data[i] = r0; d.data[i + 1] = g0; d.data[i + 2] = b0; d.data[i + 3] = a;
  }
  x.putImageData(d, 0, 0);
  uploaded = c; strokes = []; drawPad(); updateSig();
}

/* ————— Dokument & Platzieren ————— */
async function open(file) {
  try {
    st.set('Datei wird geladen …');
    let doc;
    ({ doc, bytes } = await loadDoc(file));
    name = baseName(file.name); placed = [];
    $('#desk').hidden = false;
    sizePad();
    views = await renderAll($('#view'), doc);
    for (const v of views) {
      v.layer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.placed')) return;
        if (!sig) { st.set('Bitte zuerst im Feld rechts unterschreiben.', 'err'); return; }
        const r = v.layer.getBoundingClientRect(), p = frac(v.layer, e);
        const w = 0.28, h = w * (r.width / r.height) / sig.aspect;
        const box = { x: Math.min(1 - w, Math.max(0, p.x - w / 2)), y: Math.min(1 - h, Math.max(0, p.y - h / 2)), w, h };
        const item = { page: v.num - 1, v };
        item.h = placeable(v.layer, { src: sig.url, box, aspect: () => sig.aspect, onRemove: () => { placed = placed.filter((x) => x !== item); updateSig(); } });
        item.box = item.h.box;
        placed.push(item); updateSig(); st.clear();
      });
    }
    st.clear();
  } catch (e) { st.set(e.message, 'err'); }
}
$('#save').addEventListener('click', async () => {
  const { PDFDocument, degrees } = await pdflib();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const png = await pdf.embedPng(await (await fetch(sig.url)).arrayBuffer());
  const pages = pdf.getPages();
  for (const p of placed) drawAt(pages[p.page], png, p.box, p.v.vp, p.v.page.rotate, degrees);
  await savePdf(pdf, `${name}_unterschrieben.pdf`);
});

$('#clearPad').addEventListener('click', () => { strokes = []; uploaded = null; drawPad(); updateSig(); });
$$('#ink button').forEach((b) => b.addEventListener('click', () => { ink = b.dataset.c; $$('#ink button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawPad(); updateSig(); }));
$('#loadImg').addEventListener('click', () => $('#sigFile').click());
$('#sigFile').addEventListener('change', (e) => { if (e.target.files[0]) loadSignatureImage(e.target.files[0]); e.target.value = ''; });
$('#line').addEventListener('input', updateSig);
window.addEventListener('resize', () => { if (!$('#desk').hidden) sizePad(); });
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: (f) => isPdf(f) || isImage(f) });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
