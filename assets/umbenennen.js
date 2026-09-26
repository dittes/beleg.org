// Belege automatisch umbenennen
import { $, esc, money, download } from './common.js?v=dd1f3874';
import { pdflib, openPdf, renderPage, imageCanvas, addImagePage, blobBytes, downloadZip, setupDrop, isPdf, isImage, baseName, status } from './pdfkit.js?v=78b28a4a';
import { itemsToLines, parseReceipt } from './recognize.js?v=d7b6fd35';
import { parseXML } from './einvoice.js?v=02638bd2';
import { recognize, prepare } from './ocr.js?v=2890f10c';

const rows = []; // { file, thumb, data, name, state }
const st = status($('#status'));
let queue = Promise.resolve();

const slug = (s, max = 40) => String(s || '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
const ext = (r) => (($('#toPdf').checked && isImage(r.file)) ? 'pdf' : (r.file.name.match(/\.([^.]+)$/)?.[1] || 'pdf').toLowerCase());

function makeName(r) {
  const d = r.data || {};
  const vals = {
    datum: d.date || '', haendler: slug(d.merchant), betrag: d.total != null ? d.total.toFixed(2).replace('.', '-') : '',
    nr: slug(d.number, 24), original: slug(baseName(r.file.name)),
  };
  let n = $('#tpl').value.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? '');
  n = n.replace(/_{2,}/g, '_').replace(/^[_-]+|[_-]+$/g, '') || slug(baseName(r.file.name)) || 'beleg';
  return n;
}

async function analyse(r) {
  const f = r.file;
  if (/\.xml$/i.test(f.name)) {
    const m = parseXML(await f.text());
    return { date: m.issueDate, merchant: m.seller?.name, total: m.totals.grand, number: m.number, src: 'E-Rechnung' };
  }
  let canvas;
  if (isPdf(f)) {
    const { doc } = await openPdf(f);
    const att = Object.values((await doc.getAttachments()) || {}).find((a) => /\.xml$/i.test(a.filename || ''));
    if (att) { try { const m = parseXML(new TextDecoder().decode(att.content)); return { date: m.issueDate, merchant: m.seller?.name, total: m.totals.grand, number: m.number, src: 'E-Rechnung' }; } catch { /* weiter */ } }
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => 'str' in it).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }));
    const { canvas: th } = await renderPage(page, { width: 120 });
    r.thumb = th.toDataURL('image/jpeg', 0.7); render();
    if (items.reduce((n, it) => n + it.str.trim().length, 0) > 40) {
      return { ...parseReceipt(itemsToLines(items).map((l) => l.text).join('\n')), src: 'Textebene' };
    }
    canvas = (await renderPage(page, { scale: 2.4 })).canvas;
  } else {
    canvas = await prepare(f);
  }
  const { text } = await recognize(canvas, (p) => { r.state = `Texterkennung ${Math.round(p * 100)} %`; render(); });
  return { ...parseReceipt(text), src: 'OCR' };
}

function add(files) {
  $('#desk').hidden = false;
  for (const file of files) {
    const r = { file, thumb: '', data: null, name: '', state: 'wartet', custom: false };
    rows.push(r);
    if (isImage(file)) imageCanvas(file, 240).then((c) => { r.thumb = c.toDataURL('image/jpeg', 0.7); render(); });
    queue = queue.then(async () => {
      r.state = 'wird gelesen …'; render();
      try { r.data = await analyse(r); r.state = r.data.src; } catch (e) { r.state = `Fehler: ${e.message}`; r.data = {}; }
      if (!r.custom) r.name = makeName(r);
      progress(); render();
    });
  }
  render();
}
function progress() {
  const done = rows.filter((r) => r.data).length;
  $('#bar').style.width = `${(done / rows.length) * 100}%`;
  st.set(`${done} von ${rows.length} Belegen gelesen`);
  $('#zip').disabled = $('#csv').disabled = done < rows.length;
}
function render() {
  $('#list').innerHTML = rows.map((r, i) => {
    const d = r.data || {};
    return `<li class="fitem rn-row${r.data ? '' : ' is-busy'}"><div class="fitem__th" style="background-image:url(${r.thumb || ''})"></div>
      <div style="min-width:0"><div style="display:flex;gap:6px;align-items:center"><input data-i="${i}" value="${esc(r.name)}" ${r.data ? '' : 'disabled'} aria-label="Neuer Dateiname"><span class="mono small">.${ext(r)}</span></div>
      <div class="fitem__info">${esc(r.file.name)} · ${esc(r.state)}${r.data ? ` · <b>${esc(d.date || 'kein Datum')}</b> · <b>${esc(d.merchant || 'kein Händler')}</b> · <b>${d.total != null ? money(d.total) : 'kein Betrag'}</b>` : ''}</div></div>
      <div class="fitem__acts"><button type="button" class="del" data-del="${i}" aria-label="Entfernen">✕</button></div></li>`;
  }).join('');
}
$('#list').addEventListener('input', (e) => { const i = Number(e.target.dataset.i); if (!Number.isNaN(i)) { rows[i].name = e.target.value; rows[i].custom = true; } });
$('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { rows.splice(Number(b.dataset.del), 1); render(); if (rows.length) progress(); } });
$('#tpl').addEventListener('input', () => { for (const r of rows) if (r.data && !r.custom) r.name = makeName(r); render(); });
$('#toPdf').addEventListener('change', render);
$('#tokens').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const t = $('#tpl'); t.value += (t.value && !t.value.endsWith('_') ? '_' : '') + b.textContent; t.dispatchEvent(new Event('input')); });

$('#zip').addEventListener('click', async () => {
  const entries = [];
  const { PDFDocument } = await pdflib();
  for (const r of rows) {
    let data;
    if ($('#toPdf').checked && isImage(r.file)) {
      const d = await PDFDocument.create();
      await addImagePage(d, await imageCanvas(r.file, 3000), { fit: 'image', dpi: 200, quality: 0.85 });
      data = await d.save();
    } else data = await blobBytes(r.file);
    entries.push({ name: `${(r.name || 'beleg').replace(/[\\/:*?"<>|]+/g, '_')}.${ext(r)}`, data });
  }
  await downloadZip(`belege_umbenannt_${new Date().toISOString().slice(0, 10)}.zip`, entries);
});
$('#csv').addEventListener('click', () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Alter Name', 'Neuer Name', 'Datum', 'Händler', 'Betrag', 'Beleg-Nr.'].map(q).join(';'),
    ...rows.map((r) => [r.file.name, `${r.name}.${ext(r)}`, r.data?.date, r.data?.merchant, r.data?.total != null ? r.data.total.toFixed(2).replace('.', ',') : '', r.data?.number].map(q).join(';'))];
  download('belege_liste.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
});
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: add, accept: (f) => isPdf(f) || isImage(f) || /\.xml$/i.test(f.name) });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
