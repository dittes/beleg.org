// PDF-Metadaten anzeigen & entfernen
import { $, esc, download } from './common.js?v=dd1f3874';
import { pdflib, openPdf, setupDrop, isPdf, baseName, fmtBytes, status } from './pdfkit.js?v=78b28a4a';

let bytes = null, name = 'dokument';
const st = status($('#status'));
const LABELS = { Title: 'Titel', Author: 'Autor', Subject: 'Thema', Keywords: 'Stichwörter', Creator: 'Erstellt mit', Producer: 'PDF erzeugt von', CreationDate: 'Erstellt am', ModDate: 'Geändert am' };

function pdfDate(s) {
  const m = String(s || '').match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  return m ? `${m[3] || '01'}.${m[2] || '01'}.${m[1]}${m[4] ? ` ${m[4]}:${m[5] || '00'}` : ''}` : s;
}

async function open(file) {
  try {
    const r = await openPdf(file);
    bytes = r.bytes; name = baseName(file.name);
    const { info, metadata } = await r.doc.getMetadata();
    const att = Object.values((await r.doc.getAttachments()) || {});
    const rows = [];
    for (const k of Object.keys(LABELS)) {
      const v = info[k];
      rows.push([LABELS[k], v ? esc(k.endsWith('Date') ? pdfDate(v) : v) : '<span class="small">–</span>', !!v]);
    }
    const xmp = metadata ? metadata.getAll() : null;
    rows.push(['XMP-Metadaten', xmp && Object.keys(xmp).length ? `${Object.keys(xmp).length} Einträge<br><span class="small">${esc(Object.keys(xmp).slice(0, 8).join(', '))}${Object.keys(xmp).length > 8 ? ' …' : ''}</span>` : '<span class="small">keine</span>', !!(xmp && Object.keys(xmp).length)]);
    rows.push(['Dateianhänge', att.length ? att.map((a) => esc(a.filename)).join('<br>') : '<span class="small">keine</span>', att.length > 0]);
    rows.push(['PDF-Version', esc(info.PDFFormatVersion || '–'), false]);
    rows.push(['Seiten · Größe', `${r.doc.numPages} · ${fmtBytes(bytes.length)}`, false]);
    const found = rows.filter((x) => x[2]).length;
    $('#rows').innerHTML = rows.map(([k, v, hit]) => `<tr><td style="width:40%" class="mono">${hit ? '● ' : ''}${k}</td><td>${v}</td></tr>`).join('');
    if (att.some((a) => /factur-x|zugferd|xrechnung/i.test(a.filename))) st.set('Achtung: Diese PDF ist eine E-Rechnung. Anhänge und XMP nicht entfernen.', 'err');
    else st.set(found ? `${found} Einträge mit Metadaten gefunden.` : 'Keine Metadaten gefunden.');
    $('#desk').hidden = false;
    $('#save').disabled = false;
  } catch (e) { st.set(e.message, 'err'); $('#desk').hidden = false; }
}

$('#save').addEventListener('click', async () => {
  const { PDFDocument, PDFName, PDFDict } = await pdflib();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if ($('#rmInfo').checked) pdf.context.trailerInfo.Info = undefined;
  if ($('#rmXmp').checked) pdf.catalog.delete(PDFName.of('Metadata'));
  if ($('#rmAtt').checked) {
    const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    names?.delete(PDFName.of('EmbeddedFiles'));
    pdf.catalog.delete(PDFName.of('AF'));
  }
  const out = await pdf.save({ useObjectStreams: true });
  download(`${name}_bereinigt.pdf`, new Blob([out], { type: 'application/pdf' }));
  st.set(`Gespeichert (${fmtBytes(out.length)}).`);
});
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: isPdf });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
