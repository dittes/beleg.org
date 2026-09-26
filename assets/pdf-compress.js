// PDF verkleinern – Scanseiten neu rendern und komprimieren, Textseiten unverändert
import { $, $$, download } from './common.js?v=dd1f3874';
import { pdflib, openPdf, renderPage, canvasBlob, blobBytes, setupDrop, isPdf, baseName, fmtBytes, status } from './pdfkit.js?v=78b28a4a';

const LEVELS = {
  strong: { dpi: 110, q: 0.5, info: '110 dpi, starke Kompression' },
  medium: { dpi: 150, q: 0.65, info: '150 dpi, gute Lesbarkeit' },
  light: { dpi: 200, q: 0.78, info: '200 dpi, kaum sichtbare Verluste' },
  lossless: { info: 'Nur Struktur optimieren, Inhalt bleibt unverändert' },
};
let level = 'medium', bytes = null, doc = null, name = 'dokument', result = null;
const st = status($('#status'));
const showLevel = () => { $('#levelInfo').textContent = LEVELS[level].info; };

async function open(file) {
  try {
    ({ doc, bytes } = await openPdf(file));
    name = baseName(file.name); result = null;
    $('#desk').hidden = false;
    $('#sizeIn').textContent = fmtBytes(bytes.length);
    $('#sizeOut').textContent = $('#saved').textContent = '–';
    $('#save').disabled = true;
    $('#grid').innerHTML = '';
    for (let i = 1; i <= Math.min(doc.numPages, 12); i++) {
      const { canvas } = await renderPage(await doc.getPage(i), { width: 180 });
      $('#grid').insertAdjacentHTML('beforeend', `<div class="pcard"><div class="pcard__img"><img src="${canvas.toDataURL('image/jpeg', 0.7)}" alt="Seite ${i}"></div><div class="pcard__meta"><b>${i}</b></div></div>`);
    }
  } catch (e) { st.set(e.message, 'err'); $('#desk').hidden = false; }
}

async function run() {
  const { PDFDocument } = await pdflib();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  let out;
  if (level === 'lossless') {
    out = src;
  } else {
    const { dpi, q } = LEVELS[level];
    out = await PDFDocument.create();
    for (let i = 1; i <= doc.numPages; i++) {
      st.set(`Seite ${i} von ${doc.numPages} …`);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const hasText = tc.items.reduce((n, it) => n + (it.str?.trim().length || 0), 0) > 40;
      if (hasText && $('#keepText').checked) { const [p] = await out.copyPages(src, [i - 1]); out.addPage(p); continue; }
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const { canvas } = await renderPage(page, { scale: dpi / 72 });
      if ($('#gray').checked) { const c = canvas.getContext('2d'); c.filter = 'grayscale(1)'; c.drawImage(canvas, 0, 0); }
      const img = await out.embedJpg(await blobBytes(await canvasBlob(canvas, 'image/jpeg', q)));
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    }
  }
  result = await out.save({ useObjectStreams: true });
  const smaller = result.length < bytes.length;
  $('#sizeOut').textContent = fmtBytes(result.length);
  $('#saved').textContent = smaller ? `−${Math.round((1 - result.length / bytes.length) * 100)} %` : '±0 %';
  st.set(smaller ? 'Fertig.' : 'Kleiner geht es mit dieser Einstellung nicht. Probier „Stark“ oder Graustufen.', smaller ? '' : 'err');
  $('#save').disabled = !smaller;
}

$$('#level button').forEach((b) => b.addEventListener('click', () => { level = b.dataset.l; $$('#level button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); showLevel(); }));
$('#run').addEventListener('click', run);
$('#save').addEventListener('click', () => download(`${name}_klein.pdf`, new Blob([result], { type: 'application/pdf' })));
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: isPdf });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
showLevel();
