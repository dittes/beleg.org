// Digitaler Belegstempel
import { $, $$, todayISO, fmtDate } from './common.js?v=dd1f3874';
import { pdflib, savePdf, setupDrop, isPdf, isImage, baseName, status } from './pdfkit.js?v=78b28a4a';
import { loadDoc, renderAll, frac, placeable, drawAt } from './pageview.js?v=b6cf31fe';

let bytes = null, name = 'beleg', views = [], stamps = [];
let kind = 'GEBUCHT', color = '#1b3fd1', img = null;
const st = status($('#status'));
$('#date').value = todayISO();

/* ————— Stempel zeichnen (Canvas, 4-fach aufgelöst) ————— */
function stampCanvas() {
  const S = 4;
  const title = ($('#custom').value.trim() || kind).toUpperCase();
  const lines = [];
  if ($('#date').value) lines.push(['Datum', fmtDate($('#date').value)]);
  if ($('#acct').value.trim()) lines.push(['Konto', $('#acct').value.trim()]);
  if ($('#cc').value.trim()) lines.push(['KSt', $('#cc').value.trim()]);
  if ($('#no').value.trim()) lines.push(['Nr.', $('#no').value.trim()]);
  const note = $('#note').value.trim();
  const m = document.createElement('canvas').getContext('2d');
  m.font = `700 ${26 * S}px "IBM Plex Mono", monospace`;
  const tw = m.measureText(title).width;
  m.font = `500 ${13 * S}px "IBM Plex Mono", monospace`;
  const lw = Math.max(0, ...lines.map(([k, v]) => m.measureText(`${k}  ${v}`).width), note ? m.measureText(note).width : 0);
  const w = Math.max(tw, lw) + 44 * S;
  const h = (26 + 22 + lines.length * 19 + (note ? 19 : 0) + 22) * S;
  const tilt = $('#tilt').checked ? -4 * Math.PI / 180 : 0;
  const pad = tilt ? Math.ceil(Math.abs(Math.sin(tilt)) * w / 2 + 6 * S) : 6 * S;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w + pad * 2); c.height = Math.ceil(h + pad * 2);
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2); x.rotate(tilt); x.translate(-w / 2, -h / 2);
  x.strokeStyle = color; x.fillStyle = color; x.globalAlpha = 0.9;
  const rr = (o, lw2, r) => { x.lineWidth = lw2; x.beginPath(); x.roundRect(o, o, w - 2 * o, h - 2 * o, r); x.stroke(); };
  rr(3 * S, 5 * S, 10 * S); rr(10 * S, 1.6 * S, 6 * S);
  x.textAlign = 'center'; x.textBaseline = 'top';
  x.font = `700 ${26 * S}px "IBM Plex Mono", monospace`;
  x.fillText(title, w / 2, 20 * S);
  let y = (20 + 26 + 10) * S;
  if (lines.length || note) { x.lineWidth = 1.2 * S; x.beginPath(); x.moveTo(20 * S, y - 4 * S); x.lineTo(w - 20 * S, y - 4 * S); x.stroke(); }
  x.font = `500 ${13 * S}px "IBM Plex Mono", monospace`;
  x.textAlign = 'left';
  for (const [k, v] of lines) { x.fillText(k, 22 * S, y); x.textAlign = 'right'; x.fillText(v, w - 22 * S, y); x.textAlign = 'left'; y += 19 * S; }
  if (note) { x.textAlign = 'center'; x.fillText(note, w / 2, y); }
  return c;
}
function refresh() {
  const c = stampCanvas();
  img = { url: c.toDataURL('image/png'), aspect: c.width / c.height };
  $('#preview').innerHTML = `<img src="${img.url}" alt="Stempelvorschau" style="max-width:88%;max-height:170px">`;
  for (const s of stamps) s.h.update(img.url);
}

/* ————— Platzieren ————— */
function place(v, box) {
  const s = { id: Math.random(), page: v.num - 1, v };
  s.h = placeable(v.layer, {
    src: img.url, box, aspect: () => img.aspect,
    onRemove: () => { stamps = stamps.filter((x) => x !== s); $('#save').disabled = !stamps.length; },
  });
  s.box = s.h.box;
  stamps.push(s);
  $('#save').disabled = false;
}
function defaultBox(v, at) {
  const r = v.layer.getBoundingClientRect();
  const w = 0.3, h = w * (r.width / r.height) / img.aspect;
  const x = at ? at.x - w / 2 : 1 - w - 0.05, y = at ? at.y - h / 2 : 0.04;
  return { x: Math.min(1 - w, Math.max(0, x)), y: Math.min(1 - h, Math.max(0, y)), w, h };
}

async function open(file) {
  try {
    st.set('Datei wird geladen …');
    let doc;
    ({ doc, bytes } = await loadDoc(file));
    name = baseName(file.name);
    stamps = [];
    $('#desk').hidden = false;
    await document.fonts.ready;
    refresh();
    views = await renderAll($('#view'), doc);
    for (const v of views) {
      v.layer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.placed')) return;
        for (const p of document.querySelectorAll('.placed.is-active')) p.classList.remove('is-active');
        place(v, defaultBox(v, frac(v.layer, e)));
      });
    }
    place(views[0], defaultBox(views[0]));
    st.clear();
  } catch (e) { st.set(e.message, 'err'); }
}

$('#allPages').addEventListener('click', () => {
  const ref = stamps[stamps.length - 1]; if (!ref) return;
  for (const v of views) if (v.num - 1 !== ref.page) place(v, { ...ref.box });
});
$('#save').addEventListener('click', async () => {
  const { PDFDocument, degrees } = await pdflib();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const png = await pdf.embedPng(await (await fetch(img.url)).arrayBuffer());
  const pages = pdf.getPages();
  for (const s of stamps) drawAt(pages[s.page], png, s.box, s.v.vp, s.v.page.rotate, degrees);
  await savePdf(pdf, `${name}_gestempelt.pdf`);
});

$$('#kind button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; $$('#kind button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#custom').value = ''; refresh(); }));
$$('#color button').forEach((b) => b.addEventListener('click', () => { color = b.dataset.c; $$('#color button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); refresh(); }));
for (const id of ['#custom', '#date', '#acct', '#cc', '#no', '#note', '#tilt']) $(id).addEventListener('input', refresh);
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: (f) => isPdf(f) || isImage(f) });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
document.fonts.ready.then(refresh);
