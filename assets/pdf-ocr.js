// PDF durchsuchbar machen – unsichtbare Textebene über gescannten Seiten
import { $, download } from './common.js?v=dd1f3874';
import { pdflib, pdfjs, openPdf, renderPage, imageCanvas, addImagePage, savePdf, setupDrop, isPdf, isImage, baseName, status } from './pdfkit.js?v=78b28a4a';
import { recognize } from './ocr.js?v=2890f10c';

let bytes = null, doc = null, name = 'dokument', results = [];
const st = status($('#status'));

async function open(files) {
  try {
    st.set('Dateien werden geladen …');
    const { PDFDocument } = await pdflib();
    if (files.length === 1 && isPdf(files[0])) {
      ({ doc, bytes } = await openPdf(files[0]));
    } else {
      const d = await PDFDocument.create();
      for (const f of files) {
        if (isPdf(f)) { const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true }); for (const p of await d.copyPages(src, src.getPageIndices())) d.addPage(p); }
        else await addImagePage(d, await imageCanvas(f, 3400), { fit: 'image', dpi: 250, quality: 0.9 });
      }
      bytes = await d.save();
      doc = await (await pdfjs()).getDocument({ data: bytes.slice() }).promise;
    }
    name = baseName(files[0].name);
    results = [];
    $('#desk').hidden = false;
    $('#nPages').textContent = doc.numPages;
    $('#grid').innerHTML = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const { canvas } = await renderPage(await doc.getPage(i), { width: 220 });
      $('#grid').insertAdjacentHTML('beforeend', `<div class="pcard" data-i="${i}"><div class="pcard__img"><img src="${canvas.toDataURL('image/jpeg', 0.7)}" alt="Seite ${i}"></div><div class="pcard__meta"><b>${i}</b><span data-state>wartet</span></div></div>`);
    }
    $('#save').disabled = $('#txt').disabled = true;
    $('#run').disabled = false;
    st.clear();
  } catch (e) { st.set(e.message, 'err'); $('#desk').hidden = false; }
}

async function run() {
  $('#run').disabled = true;
  results = [];
  let words = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const stateEl = document.querySelector(`.pcard[data-i="${i}"] [data-state]`);
    const tc = await page.getTextContent();
    const hasText = tc.items.reduce((n, it) => n + (it.str?.trim().length || 0), 0) > 40;
    if (hasText && $('#skipText').checked) {
      results.push({ skip: true, text: tc.items.map((it) => it.str).join(' ') });
      stateEl.textContent = 'hat Text';
    } else {
      const base = page.getViewport({ scale: 1, rotation: page.rotate });
      const scale = Math.min(3, 3000 / Math.max(base.width, base.height));
      const { canvas, viewport } = await renderPage(page, { scale });
      stateEl.textContent = 'läuft …';
      const r = await recognize(canvas, (p, label) => {
        $('#bar').style.width = `${((i - 1 + p) / doc.numPages) * 100}%`;
        st.set(`Seite ${i} von ${doc.numPages}: ${label} ${Math.round(p * 100)} %`);
      });
      results.push({ ...r, viewport, rotate: page.rotate });
      words += r.words.length;
      stateEl.textContent = `${r.words.length} Wörter`;
    }
    $('#nDone').textContent = i;
    $('#nWords').textContent = words;
  }
  $('#bar').style.width = '100%';
  st.set('Fertig. Du kannst das PDF jetzt speichern.');
  $('#save').disabled = $('#txt').disabled = false;
  $('#run').disabled = false;
}

async function save() {
  const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, setCharacterSqueeze, showText } = await pdflib();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const chars = new Set(font.getCharacterSet());
  const clean = (s) => [...s].filter((c) => chars.has(c.codePointAt(0))).join('');
  pdf.getPages().forEach((page, i) => {
    const r = results[i];
    if (!r || r.skip || !r.words.length) return;
    const key = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of r.words) {
      const text = clean(w.text);
      if (!text) continue;
      const [x0, y0] = r.viewport.convertToPdfPoint(w.x0, w.y1);
      const [x1, y1] = r.viewport.convertToPdfPoint(w.x1, w.y0);
      const hPt = Math.abs(y1 - y0), wPt = Math.abs(x1 - x0);
      const size = Math.max(2, hPt * 0.92);
      const natural = font.widthOfTextAtSize(text, size);
      const squeeze = natural > 0 ? Math.max(20, Math.min(300, (wPt / natural) * 100)) : 100;
      ops.push(beginText(), setFontAndSize(key, size), setCharacterSqueeze(squeeze), setTextMatrix(1, 0, 0, 1, Math.min(x0, x1), Math.min(y0, y1) + hPt * 0.18), showText(font.encodeText(text)), endText());
    }
    ops.push(popGraphicsState());
    page.pushOperators(...ops);
  });
  await savePdf(pdf, `${name}_durchsuchbar.pdf`);
}

$('#run').addEventListener('click', run);
$('#save').addEventListener('click', save);
$('#txt').addEventListener('click', () => download(`${name}.txt`, results.map((r, i) => `— Seite ${i + 1} —\n${r.text}`).join('\n\n'), 'text/plain;charset=utf-8'));
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: open, accept: (f) => isPdf(f) || isImage(f) });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
