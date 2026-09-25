// 01 · E-Rechnung lesen & prüfen
import { $, $$, esc, download, session } from './common.js';
import { parseXML, check, renderInvoice, toCII, buildModel, SAMPLE_FORM, TYPE_CODES, UNIT_CODES, describeProfile } from './einvoice.js';

const PDFJS = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ??= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }));

const drop = $('#drop'), fileInput = $('#file'), errBox = $('#dropErr');
let current = null; // { model, xml, name }

const ICONS = {
  ok: '<svg class="ic" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#1b3fd1" stroke-width="1.4"/><path d="m5 8.2 2 2 4-4.2" stroke="#1b3fd1" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 16 16" fill="none"><path d="M8 1.8 15 14H1z" stroke="#9a5b00" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 11.8v.1" stroke="#9a5b00" stroke-width="1.6" stroke-linecap="round"/></svg>',
  err: '<svg class="ic" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#b4232b" stroke-width="1.4"/><path d="m5.5 5.5 5 5m0-5-5 5" stroke="#b4232b" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/* ————— Eingang ————— */
function showError(msg) {
  errBox.innerHTML = msg;
  errBox.hidden = false;
}
async function handleFile(file) {
  errBox.hidden = true;
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) return await handlePdf(file);
    const text = await file.text();
    if (text.trimStart().startsWith('%PDF')) return await handlePdf(file);
    show(text, file.name, null);
  } catch (e) {
    showError(`<b>Die Datei konnte nicht gelesen werden.</b><br>${esc(e.message)}`);
  }
}

async function handlePdf(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const att = (await pdf.getAttachments()) || {};
  const files = Object.values(att);
  const pref = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'zugferd_invoice.xml'];
  const hit = files.find((a) => pref.includes((a.filename || '').toLowerCase())) || files.find((a) => /\.xml$/i.test(a.filename || ''));
  if (!hit) {
    showError(`<b>In dieser PDF steckt keine E-Rechnung.</b><br>„${esc(file.name)}“ enthält keine eingebetteten XML-Daten. Seit 2025 gilt so eine Datei im B2B-Verkehr als „sonstige Rechnung“ und nicht als E-Rechnung. Bitte den Absender um eine XRechnung oder ZUGFeRD-Datei.`);
    return;
  }
  const xml = new TextDecoder('utf-8').decode(hit.content);
  show(xml, `${file.name} → ${hit.filename}`, pdf);
}

/* ————— Darstellung ————— */
function show(xml, name, pdf) {
  const model = parseXML(xml);
  const res = check(model);
  current = { model, xml, name };

  const prof = describeProfile(model.profile);
  $('#rTitle').innerHTML = `${esc(TYPE_CODES[model.typeCode] || 'Rechnung')} <em>${esc(model.number || '')}</em>`;
  $('#rFile').textContent = `${name} · ${prof.name} · ${model.syntax}`;
  $('#vDoc').innerHTML = renderInvoice(model);
  $('#xmlSrc').innerHTML = highlight(xml);

  const { ok, warn, err } = res.score;
  $('#score').innerHTML = `<span><i class="i-ok"></i>${ok} erfüllt</span><span><i class="i-warn"></i>${warn} Hinweis${warn === 1 ? '' : 'e'}</span><span><i class="i-err"></i>${err} Fehler</span>`;
  const stamp = err ? ['stamp--err', 'Mängel', `${err} Fehler`] : warn ? ['stamp--warn', 'Geprüft', 'mit Hinweisen'] : ['', 'Geprüft', 'plausibel'];
  $('#stamp').innerHTML = `<span class="stamp stamp--in ${stamp[0]}">${stamp[1]}<small>${stamp[2]}</small></span>`;

  const order = { err: 0, warn: 1, ok: 2 };
  $('#checks').innerHTML = res.items
    .slice().sort((a, b) => order[a.level] - order[b.level])
    .map((c) => `<li class="${c.level}" data-l="${c.level}">${ICONS[c.level]}<div><code>${esc(c.code)}</code>${esc(c.text)}${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</div></li>`).join('');
  setFilter('all');

  // PDF-Seiten
  const tabPdf = $('#tabPdf');
  tabPdf.hidden = !pdf;
  $('#pdfPages').innerHTML = '';
  if (pdf) renderPdf(pdf);
  setView('doc');

  const r = $('#result');
  r.hidden = false;
  r.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function renderPdf(pdf) {
  const box = $('#pdfPages');
  const n = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    c.setAttribute('aria-label', `Seite ${i}`);
    box.append(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
  if (pdf.numPages > n) box.insertAdjacentHTML('beforeend', `<p class="small">… und ${pdf.numPages - n} weitere Seiten</p>`);
}

function highlight(xml) {
  return esc(xml)
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="t">$2</span>')
    .replace(/([\w:.-]+)=(&quot;.*?&quot;)/g, '<span class="a">$1</span>=<span class="v">$2</span>');
}

function setView(v) {
  for (const b of $$('.views button')) b.setAttribute('aria-selected', String(b.dataset.view === v));
  $('#vDoc').hidden = v !== 'doc';
  $('#vPdf').hidden = v !== 'pdf';
  $('#vXml').hidden = v !== 'xml';
}
function setFilter(f) {
  for (const b of $$('#filter button')) b.setAttribute('aria-pressed', String(b.dataset.f === f));
  for (const li of $$('#checks li')) li.hidden = f !== 'all' && li.dataset.l !== f;
}

/* ————— Export ————— */
function csv() {
  const m = current.model;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const n = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const head = ['Rechnungsnr', 'Datum', 'Verkäufer', 'Pos', 'Bezeichnung', 'Beschreibung', 'Menge', 'Einheit', 'Einzelpreis', 'USt-Satz', 'Netto', 'Währung'];
  const rows = m.lines.map((l) => [m.number, m.issueDate, m.seller?.name, l.id, l.name, l.desc, n(l.qty), UNIT_CODES[l.unit] || l.unit, n(l.price), n(l.taxRate), n(l.net), m.currency]);
  const text = '﻿' + [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
  download(`${safe(m.number)}-positionen.csv`, text, 'text/csv;charset=utf-8');
}
const safe = (s) => String(s || 'rechnung').replace(/[^\w.-]+/g, '_');

/* ————— Ereignisse ————— */
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value = ''; });

let depth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; drop.classList.add('is-over'); } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.classList.remove('is-over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0; drop.classList.remove('is-over');
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea')) return;
  const f = e.clipboardData?.files?.[0];
  if (f) return handleFile(f);
  const t = e.clipboardData?.getData('text') || '';
  if (t.trim().startsWith('<')) {
    errBox.hidden = true;
    try { show(t, 'Eingefügter Text', null); } catch (err) { showError(`<b>Der eingefügte Text ist keine lesbare E-Rechnung.</b><br>${esc(err.message)}`); }
  }
});

$('#sample').addEventListener('click', (e) => {
  e.stopPropagation();
  errBox.hidden = true;
  const f = { ...SAMPLE_FORM };
  const xml = toCII(buildModel(f));
  show(xml, 'beispiel-xrechnung.xml', null);
});
$$('.views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('#filter button').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.f)));
$('#csv').addEventListener('click', csv);
$('#json').addEventListener('click', () => download(`${safe(current.model.number)}.json`, JSON.stringify(current.model, null, 2), 'application/json'));
$('#again').addEventListener('click', () => { $('#result').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); drop.focus(); });

// Übergabe aus „E-Rechnung schreiben“
const handoff = session.take('beleg:handoff');
if (handoff) { try { show(handoff, 'aus „E-Rechnung schreiben“', null); } catch (e) { showError(esc(e.message)); } }

