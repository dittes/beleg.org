// 02 · Belegerkennung: Kontoauszüge → Tabelle, Belege → Felder
import { $, $$, esc, money, parseNum, fmtDate, download } from './common.js';
import { itemsToLines, textToLines, parseStatement, parseReceipt, looksLikeStatement } from './recognize.js';
import { parseXML } from './einvoice.js';
import { handoff } from './handoff.js';

const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;
let pdfjsP, tessP, xlsxP, workerP;
const loadPdfjs = () => (pdfjsP ??= import(V('pdfjs/pdf.min.mjs')).then((m) => { m.GlobalWorkerOptions.workerSrc = V('pdfjs/pdf.worker.min.mjs'); return m; }));
const loadScript = (src, global) => new Promise((res, rej) => {
  if (window[global]) return res(window[global]);
  const s = Object.assign(document.createElement('script'), { src, onload: () => res(window[global]), onerror: () => rej(new Error(`${src} konnte nicht geladen werden`)) });
  document.head.append(s);
});
const loadXlsx = () => (xlsxP ??= loadScript(V('xlsx/xlsx.mini.min.js'), 'XLSX'));

// OCR-Worker (einmalig), Fortschritt wird an den aktuellen Auftrag gemeldet
let ocrProgress = () => {};
function getWorker() {
  return (workerP ??= (async () => {
    const T = await (tessP ??= loadScript(V('tesseract/tesseract.min.js'), 'Tesseract'));
    return T.createWorker('deu', 1, {
      workerPath: V('tesseract/worker.min.js'),
      corePath: V('tesseract/'),
      langPath: V('tesseract/lang'),
      logger: (m) => ocrProgress(m),
    });
  })());
}

/* ————— Zustand ————— */
const state = { mode: document.getElementById('bed')?.dataset.mode || 'auto', statements: [], receipts: [], running: 0 };
let uid = 0;

/* ————— Stapel (Auftragsliste) ————— */
function addJob(name) {
  const li = document.createElement('li');
  li.className = 'job';
  li.innerHTML = `<div class="job__thumb"></div><div style="min-width:0"><div class="job__name">${esc(name)}</div><div class="job__info">wartet …</div><div class="job__bar"><i></i></div></div><span class="job__tag">…</span>`;
  $('#stack').append(li);
  return {
    info: (t) => { li.querySelector('.job__info').textContent = t; },
    bar: (p) => { li.querySelector('.job__bar i').style.width = `${Math.round(p * 100)}%`; },
    thumb: (url) => { li.querySelector('.job__thumb').style.backgroundImage = `url("${url}")`; },
    tag: (t, cls) => { const e = li.querySelector('.job__tag'); e.textContent = t; e.className = `job__tag ${cls || ''}`; },
  };
}
function busy(delta) {
  state.running += delta;
  $('#bed').classList.toggle('is-busy', state.running > 0);
  $('#bedState').textContent = state.running > 0 ? `${state.running} in Arbeit` : 'bereit';
}

/* ————— Verarbeitung ————— */
async function ocr(image, job, label = 'Texterkennung') {
  job.info(`${label}: Modell wird geladen …`);
  const worker = await getWorker();
  ocrProgress = (m) => {
    if (m.status === 'recognizing text') { job.info(`${label} … ${Math.round(m.progress * 100)} %`); job.bar(0.2 + m.progress * 0.75); }
    else if (m.status) job.info(`${label}: ${m.status === 'loading language traineddata' ? 'Sprachmodell wird geladen' : 'wird vorbereitet'} …`);
  };
  const { data } = await worker.recognize(image);
  return data.text || '';
}

async function prepareImage(file) {
  // Kleine Fotos hochskalieren, große verkleinern – das verbessert Tesseract spürbar
  const bmp = await createImageBitmap(file);
  const maxSide = Math.max(bmp.width, bmp.height);
  const scale = maxSide < 1400 ? 1400 / maxSide : maxSide > 3200 ? 3200 / maxSide : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}

async function processFile(file) {
  const job = addJob(file.name);
  busy(1);
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isXml = /xml/.test(file.type) || /\.xml$/i.test(file.name);
    let lines = [], text = '', preview = '', source = '';

    if (isXml) {
      const m = parseXML(await file.text());
      return addReceiptFromInvoice(m, file.name, job, '');
    }
    if (isPdf) {
      job.info('PDF wird gelesen …');
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const first = await pdf.getPage(1);
      preview = (await renderPage(first, 0.6)).toDataURL('image/jpeg', 0.8);
      job.thumb(preview);
      // E-Rechnung? Dann exakte Daten statt Erkennung
      const att = Object.values((await pdf.getAttachments()) || {}).find((a) => /\.xml$/i.test(a.filename || ''));
      if (att) {
        try { return addReceiptFromInvoice(parseXML(new TextDecoder().decode(att.content)), file.name, job, preview); } catch { /* weiter mit Text */ }
      }
      let chars = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const items = tc.items.filter((it) => 'str' in it).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));
        chars += items.reduce((s, it) => s + it.str.trim().length, 0);
        lines.push(...itemsToLines(items));
        job.bar((i / pdf.numPages) * 0.9);
      }
      if (chars < 40 * pdf.numPages) {
        // Gescannte PDF – Seiten rendern und erkennen
        lines = [];
        const n = Math.min(pdf.numPages, 12);
        for (let i = 1; i <= n; i++) {
          const canvas = await renderPage(await pdf.getPage(i), 2.2);
          const t = await ocr(canvas, job, `Seite ${i}/${n}`);
          text += t + '\n';
        }
        lines = textToLines(text);
        source = 'OCR';
      } else {
        text = lines.map((l) => l.text).join('\n');
        source = 'Textebene';
      }
    } else {
      const url = URL.createObjectURL(file);
      preview = url;
      job.thumb(url);
      text = await ocr(await prepareImage(file), job);
      lines = textToLines(text);
      source = 'OCR';
    }

    const kind = state.mode === 'auto' ? (looksLikeStatement(lines) ? 'statement' : 'receipt') : state.mode;
    if (kind === 'statement') {
      const st = parseStatement(lines);
      const id = ++uid;
      st.rows.forEach((r) => { r.src = file.name; r.sid = id; r.id = ++uid; });
      state.statements.push({ id, name: file.name, ...st });
      job.tag('Kontoauszug', 'is-st');
      job.info(`${source} · ${st.rows.length} Buchungen${st.reconciled === true ? ' · Saldo abgestimmt' : st.reconciled === false ? ' · Saldo weicht ab' : ''}`);
      renderStatements();
    } else {
      const r = parseReceipt(text);
      state.receipts.push({ id: ++uid, src: file.name, preview, text, ...r });
      job.tag('Beleg', 'is-rc');
      job.info(`${source} · ${r.merchant || 'Händler unbekannt'} · ${r.total !== null ? money(r.total) : 'Betrag nicht erkannt'}`);
      renderReceipts();
    }
    job.bar(1);
  } catch (e) {
    console.error(e);
    job.tag('Fehler', 'is-err');
    job.info(e.message || 'Datei konnte nicht verarbeitet werden');
  } finally { busy(-1); }
}

function addReceiptFromInvoice(m, name, job, preview) {
  const tax = (rates) => m.taxes.filter((t) => rates.includes(t.rate)).reduce((s, t) => s + (t.amount || 0), 0) || null;
  state.receipts.push({
    id: ++uid, src: name, preview, text: `E-Rechnung (${m.syntax}) – Daten exakt aus dem eingebetteten XML übernommen.`,
    merchant: m.seller?.name || '', date: m.issueDate, number: m.number, total: m.totals.grand, net: m.totals.taxBasis,
    tax19: tax([19, 16]), tax7: tax([7, 5]), vatId: m.seller?.vatId || '', taxNo: m.seller?.taxNo || '',
    payment: m.payment.iban ? 'Überweisung' : '', conf: { merchant: 'hoch', date: 'hoch', total: 'hoch', vat: 'hoch' },
  });
  job.tag('E-Rechnung', 'is-rc');
  job.info(`exakt aus XML · ${m.seller?.name || ''} · ${money(m.totals.grand)}`);
  job.bar(1);
  renderReceipts();
}

/* ————— Tabellen ————— */
const fmtN = (n) => (n === null || n === undefined || Number.isNaN(n) ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inp = (key, val, cls = '', low = false) => `<input data-k="${key}" class="${cls}${low ? ' low' : ''}" value="${esc(val ?? '')}">`;
const dIn = (iso) => (iso ? fmtDate(iso) : '');
const dOut = (s) => { const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };

function allRows() { return state.statements.flatMap((s) => s.rows).sort((a, b) => a.date.localeCompare(b.date)); }

function renderStatements() {
  const rows = allRows();
  $('#stBlock').hidden = !state.statements.length;
  $('#stCount').textContent = `${rows.length}`;
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const inflow = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  // Abgleich über alle Auszüge: jeder einzeln
  const checks = state.statements.map((s) => {
    if (s.startBal === null || s.endBal === null) return null;
    const sSum = s.rows.reduce((a, r) => a + r.amount, 0);
    return Math.abs(Math.round((s.startBal + sSum - s.endBal) * 100)) < 1;
  });
  const known = checks.filter((c) => c !== null);
  const ok = known.length && known.every(Boolean);
  const first = state.statements.find((s) => s.startBal !== null);
  const stamp = !known.length ? '<span class="stamp stamp--warn">Ohne Saldo<small>nicht abgleichbar</small></span>'
    : ok ? '<span class="stamp stamp--in">Abgestimmt<small>Saldo stimmt</small></span>'
      : '<span class="stamp stamp--in stamp--err">Differenz<small>bitte prüfen</small></span>';
  $('#stLedger').innerHTML = `
    <div><span>Anfangssaldo</span><b>${first ? money(first.startBal) : '–'}</b></div>
    <div><span>Eingänge</span><b class="pos">${money(inflow)}</b></div>
    <div><span>Ausgänge</span><b class="neg">${money(outflow)}</b></div>
    <div><span>Summe Umsätze</span><b>${money(sum)}</b></div>
    <div>${stamp}</div>`;
  $('#stTable').innerHTML = `
    <thead><tr><th>Buchung</th><th>Valuta</th><th>Buchungstext / Empfänger</th><th>Verwendungszweck</th><th class="r">Betrag €</th><th>Datei</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}">
      <td>${inp('date', dIn(r.date), 'd')}</td><td>${inp('valuta', dIn(r.valuta), 'd')}</td>
      <td>${inp('text', r.text)}</td><td>${inp('purpose', r.purpose)}</td>
      <td>${inp('amount', fmtN(r.amount), `n${r.amount < 0 ? ' neg' : ''}`)}</td>
      <td class="src" title="${esc(r.src)}">${esc(r.src)}</td>
      <td class="act"><button class="del" type="button" data-del="st" aria-label="Zeile löschen">✕</button></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4">Summe</td><td>${fmtN(sum)}</td><td colspan="2"></td></tr></tfoot>`;
}

function renderReceipts() {
  const R = state.receipts;
  $('#rcBlock').hidden = !R.length;
  $('#rcCount').textContent = `${R.length}`;
  const low = (r, k) => ['niedrig', 'keine'].includes(r.conf?.[k]);
  const total = R.reduce((s, r) => s + (r.total || 0), 0);
  $('#rcTable').innerHTML = `
    <thead><tr><th>Datei</th><th>Händler / Aussteller</th><th>Datum</th><th>Beleg-Nr.</th><th class="r">Netto</th><th class="r">USt 19 %</th><th class="r">USt 7 %</th><th class="r">Brutto</th><th>Zahlung</th><th>USt-IdNr.</th><th></th></tr></thead>
    <tbody>${R.map((r) => `<tr data-id="${r.id}">
      <td class="src" title="${esc(r.src)}">${esc(r.src)}</td>
      <td>${inp('merchant', r.merchant, '', low(r, 'merchant'))}</td>
      <td>${inp('date', dIn(r.date), 'd', low(r, 'date'))}</td>
      <td>${inp('number', r.number)}</td>
      <td>${inp('net', fmtN(r.net), 'n', low(r, 'vat'))}</td>
      <td>${inp('tax19', fmtN(r.tax19), 'n', low(r, 'vat'))}</td>
      <td>${inp('tax7', fmtN(r.tax7), 'n', low(r, 'vat'))}</td>
      <td>${inp('total', fmtN(r.total), 'n', low(r, 'total'))}</td>
      <td>${inp('payment', r.payment)}</td>
      <td>${inp('vatId', r.vatId)}</td>
      <td class="act"><button type="button" data-view="${r.id}">Ansehen</button><button class="del" type="button" data-del="rc" aria-label="Beleg entfernen">✕</button></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7">Summe brutto</td><td>${fmtN(total)}</td><td colspan="3"></td></tr></tfoot>`;
}

// Bearbeiten → Zustand
function onEdit(e) {
  const input = e.target.closest('input[data-k]');
  if (!input) return;
  const tr = input.closest('tr'), id = Number(tr.dataset.id), k = input.dataset.k;
  const isSt = tr.closest('#stTable');
  const obj = isSt ? allRows().find((r) => r.id === id) : state.receipts.find((r) => r.id === id);
  if (!obj) return;
  if (['date', 'valuta'].includes(k)) obj[k] = dOut(input.value);
  else if (['amount', 'net', 'tax19', 'tax7', 'total'].includes(k)) {
    obj[k] = input.value.trim() === '' ? null : parseNum(input.value);
    if (k === 'amount') input.classList.toggle('neg', obj[k] < 0);
  } else obj[k] = input.value;
  input.classList.remove('low');
  if (e.type === 'change') (isSt ? renderStatements : renderReceipts)();
}
for (const t of ['#stTable', '#rcTable']) { $(t).addEventListener('input', onEdit); $(t).addEventListener('change', onEdit); }
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const id = Number(del.closest('tr').dataset.id);
    if (del.dataset.del === 'st') { for (const s of state.statements) s.rows = s.rows.filter((r) => r.id !== id); state.statements = state.statements.filter((s) => s.rows.length); renderStatements(); }
    else { state.receipts = state.receipts.filter((r) => r.id !== id); renderReceipts(); }
    return;
  }
  const view = e.target.closest('[data-view]');
  if (view) {
    const tr = view.closest('tr');
    const next = tr.nextElementSibling;
    if (next?.classList.contains('detail')) { next.remove(); return; }
    const r = state.receipts.find((x) => x.id === Number(view.dataset.view));
    const d = document.createElement('tr');
    d.className = 'detail';
    d.innerHTML = `<td colspan="11"><div class="detail__in">${r.preview ? `<img src="${esc(r.preview)}" alt="Vorschau ${esc(r.src)}">` : '<div></div>'}<pre>${esc(r.text || '')}</pre></div></td>`;
    tr.after(d);
  }
});

/* ————— Export ————— */
const stamp = () => new Date().toISOString().slice(0, 10);
const csvCell = (v) => {
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',');
  if (v === null || v === undefined) return '';
  return `"${String(v).replace(/"/g, '""')}"`;
};
function tableData(kind) {
  if (kind === 'st') {
    return { name: 'Umsaetze', head: ['Buchungstag', 'Valuta', 'Buchungstext', 'Verwendungszweck', 'Betrag', 'Datei'],
      rows: allRows().map((r) => [r.date, r.valuta, r.text, r.purpose, r.amount, r.src]), dateCols: [0, 1], numCols: [4] };
  }
  return { name: 'Belege', head: ['Datei', 'Händler', 'Datum', 'Beleg-Nr', 'Netto', 'USt 19%', 'USt 7%', 'Brutto', 'Zahlung', 'USt-IdNr', 'Steuernummer'],
    rows: state.receipts.map((r) => [r.src, r.merchant, r.date, r.number, r.net, r.tax19, r.tax7, r.total, r.payment, r.vatId, r.taxNo]), dateCols: [2], numCols: [4, 5, 6, 7] };
}
async function exportAs(kind, fmt) {
  const t = tableData(kind);
  if (fmt === 'csv') {
    const rows = t.rows.map((r) => r.map((v, i) => (t.dateCols.includes(i) ? (v ? fmtDate(v) : '') : csvCell(v))));
    download(`beleg-${t.name.toLowerCase()}-${stamp()}.csv`, '﻿' + [t.head.map(csvCell), ...rows].map((r) => r.join(';')).join('\r\n'), 'text/csv;charset=utf-8');
    return;
  }
  const XLSX = await loadXlsx();
  const aoa = [t.head, ...t.rows.map((r) => r.map((v, i) => (t.dateCols.includes(i) && v ? new Date(`${v}T12:00:00`) : v ?? '')))];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = 1; R <= range.e.r; R++) {
    for (const c of t.numCols) { const cell = ws[XLSX.utils.encode_cell({ r: R, c })]; if (cell && cell.t === 'n') cell.z = '#,##0.00'; }
    for (const c of t.dateCols) { const cell = ws[XLSX.utils.encode_cell({ r: R, c })]; if (cell && cell.t === 'd') cell.z = 'dd.mm.yyyy'; }
  }
  ws['!cols'] = t.head.map((h, i) => ({ wch: t.numCols.includes(i) ? 12 : t.dateCols.includes(i) ? 11 : Math.min(48, Math.max(12, ...t.rows.map((r) => String(r[i] ?? '').length))) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t.name);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
  download(`beleg-${t.name.toLowerCase()}-${stamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
$$('[data-export]').forEach((b) => b.addEventListener('click', () => { const [k, f] = b.dataset.export.split('-'); exportAs(k, f); }));

/* ————— Beispiele (werden im Browser erzeugt) ————— */
async function demoStatement() {
  const { PDFDocument, StandardFonts, rgb } = await import(V('pdf-lib/pdf-lib.esm.min.js'));
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const T = (s, x, y, o = {}) => page.drawText(s, { x, y, size: 9, font: f, color: rgb(0.1, 0.1, 0.2), ...o });
  const R = (s, x, y, o = {}) => T(s, x - (o.font || f).widthOfTextAtSize(s, o.size || 9), y, o);
  T('Beispielbank eG', 50, 790, { font: b, size: 14 });
  T('Kontoauszug Nr. 9/2026 · IBAN DE02 1203 0000 0000 2020 51', 50, 772);
  T('Bu-Tag', 50, 730, { font: b }); T('Wert', 100, 730, { font: b }); T('Vorgang', 150, 730, { font: b }); R('Soll', 460, 730, { font: b }); R('Haben', 545, 730, { font: b });
  T('Alter Kontostand vom 31.08.2026', 150, 712); R('1.482,15', 545, 712);
  const tx = [
    ['01.09.', '01.09.', 'Dauerauftrag Hausverwaltung Nord', 'Miete September Whg. 3', '-950,00'],
    ['02.09.', '02.09.', 'Kartenzahlung REWE Markt', 'girocard 2026-09-01 18:42', '-63,17'],
    ['03.09.', '03.09.', 'Gutschrift Bäckerei Kranz OHG', 'RE-2026-0142 Verpackungsserie', '3.382,20'],
    ['05.09.', '04.09.', 'Lastschrift Stadtwerke Hamburg', 'Abschlag Strom 09/2026', '-88,00'],
    ['08.09.', '08.09.', 'Überweisung Finanzamt', 'USt-VZ 08/2026 St.-Nr. 12/345/67890', '-512,40'],
    ['12.09.', '12.09.', 'Gutschrift Studio Blau', 'Honorar Fotografie', '760,00'],
  ];
  let y = 690;
  for (const [d, w, t, p, a] of tx) {
    T(d, 50, y); T(w, 100, y); T(t, 150, y);
    const neg = a.startsWith('-');
    R(a.replace('-', ''), neg ? 460 : 545, y);
    T(p, 150, y - 11, { color: rgb(0.4, 0.45, 0.6), size: 8 });
    y -= 32;
  }
  T('Neuer Kontostand vom 12.09.2026', 150, y, { font: b }); R('4.010,78', 545, y, { font: b });
  return new File([await doc.save()], 'beispiel-kontoauszug.pdf', { type: 'application/pdf' });
}
async function demoReceipt() {
  const c = document.createElement('canvas');
  c.width = 620; c.height = 900;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  const L = (s, y, size = 26, align = 'left') => { ctx.font = `${size}px "IBM Plex Mono", monospace`; ctx.textAlign = align; ctx.fillText(s, align === 'center' ? 310 : align === 'right' ? 580 : 40, y); };
  const row = (a, b, y) => { L(a, y); L(b, y, 26, 'right'); };
  L('CAFÉ HAFENBLICK', 70, 34, 'center');
  L('Große Elbstraße 12, 22767 Hamburg', 108, 20, 'center');
  L('St.-Nr. 41/123/45678', 136, 20, 'center');
  row('2x Cappuccino', '7,80', 210); row('1x Käsekuchen', '4,50', 250); row('1x Mineralwasser', '3,20', 290); row('1x Club Sandwich', '11,90', 330);
  L('--------------------------------', 370, 22);
  row('SUMME EUR', '27,40', 410);
  row('Geg. Girocard', '27,40', 450);
  L('MwSt     Netto    Steuer   Brutto', 520, 20);
  L('19%      23,03     4,37    27,40', 556, 20);
  L('Datum: 19.09.2026  13:47', 630, 22);
  L('Bon-Nr. 20417   Kasse 2', 666, 22);
  L('Vielen Dank für Ihren Besuch!', 740, 22, 'center');
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([blob], 'beispiel-kassenbon.png', { type: 'image/png' });
}

/* ————— Ereignisse ————— */
const fileInput = $('#file'), drop = $('#drop'), bed = $('#bed');
const run = async (files) => { for (const f of files) await processFile(f); };
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener('click', (e) => { if (!e.target.closest('button')) fileInput.click(); });
drop.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === drop) { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { run([...fileInput.files]); fileInput.value = ''; });
let depth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; bed.classList.add('is-over'); } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; bed.classList.remove('is-over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; bed.classList.remove('is-over'); if (e.dataTransfer?.files?.length) run([...e.dataTransfer.files]); });
document.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) run(files); });
$$('#mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === state.mode)));
$$('#mode button').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  $$('#mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('#demo').addEventListener('click', async (e) => {
  e.stopPropagation();
  await document.fonts?.ready;
  const files = [];
  if (state.mode !== 'receipt') files.push(await demoStatement());
  if (state.mode !== 'statement') files.push(await demoReceipt());
  run(files);
});

// Übergabe aus „Beleg scannen“
if (new URLSearchParams(location.search).has('von')) {
  handoff.take().then((files) => { if (files.length) run(files); });
  try { history.replaceState(null, '', location.pathname); } catch { /* egal */ }
}
