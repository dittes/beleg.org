// Reisekostenabrechnung mit Pauschalen und PDF-Mappe
import { $, esc, money, parseNum, round2, store, debounce, formData, fillForm, PAUSCHALE } from './common.js?v=dd1f3874';
import { pdflib, imageCanvas, addImagePage, savePdf, setupDrop, isPdf, isImage, status } from './pdfkit.js?v=78b28a4a';

const KEY = 'beleg:reisekosten';
const form = $('#form');
const st = status($('#status'));
const TYPES = ['Bahn', 'Flug', 'ÖPNV', 'Taxi', 'Mietwagen', 'Übernachtung', 'Parken', 'Maut', 'Nebenkosten'];
let meals = {};   // { 'YYYY-MM-DD': { b, l, d } }
let costs = [];   // { type, desc, amount }
const files = []; // File[]

/* ————— Tage & Verpflegung ————— */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function tripDays() {
  const s = new Date(form.elements.start.value), e = new Date(form.elements.end.value);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return [];
  const days = [];
  const d = new Date(s); d.setHours(0, 0, 0, 0);
  const last = new Date(e); last.setHours(0, 0, 0, 0);
  const n = Math.round((last - d) / 864e5) + 1;
  if (n > 60) return [];
  for (let i = 0; i < n; i++) {
    const day = new Date(d); day.setDate(d.getDate() + i);
    let base, note;
    if (n === 1) { const h = (e - s) / 36e5; base = h > 8 ? PAUSCHALE.day : 0; note = `${h.toFixed(1).replace('.', ',')} Std.`; }
    else if (i === 0 || i === n - 1) { base = PAUSCHALE.day; note = i === 0 ? 'Anreisetag' : 'Abreisetag'; }
    else { base = PAUSCHALE.full; note = 'voller Tag'; }
    const k = dayKey(day), m = meals[k] || { b: false, l: false, d: false };
    const cut = (m.b ? PAUSCHALE.breakfast : 0) + (m.l ? PAUSCHALE.meal : 0) + (m.d ? PAUSCHALE.meal : 0);
    days.push({ k, date: day, base, note, m, amount: Math.max(0, round2(base - cut)) });
  }
  return days;
}
function renderDays(days) {
  $('#days').innerHTML = days.length ? days.map((d) => `<tr><td>${d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}<div class="small">${d.note}</div></td><td class="mono">${money(d.base)}</td>
    ${['b', 'l', 'd'].map((x) => `<td><input type="checkbox" data-day="${d.k}" data-meal="${x}" ${d.m[x] ? 'checked' : ''} ${d.base ? '' : 'disabled'} aria-label="Mahlzeit gestellt"></td>`).join('')}
    <td class="r">${money(d.amount)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="small">Beginn und Ende der Reise eintragen.</td></tr>';
}

/* ————— Kosten ————— */
function renderCosts() {
  $('#costs').innerHTML = costs.map((c, i) => `<div class="cost" data-i="${i}">
    <select data-k="type" aria-label="Art">${TYPES.map((t) => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <input data-k="desc" value="${esc(c.desc)}" placeholder="Beschreibung, z. B. ICE Hamburg–Kiel" aria-label="Beschreibung">
    <input data-k="amount" class="num-in" inputmode="decimal" value="${esc(c.amount)}" placeholder="0,00" aria-label="Betrag in Euro">
    <button type="button" data-del aria-label="Entfernen">✕</button></div>`).join('');
}

/* ————— Summen ————— */
function totals() {
  const days = tripDays();
  const f = formData(form);
  const verpf = round2(days.reduce((s, d) => s + d.amount, 0));
  const km = Number(f.km) || 0, rate = Number(f.vehicle);
  const fahrt = round2(km * rate);
  const byType = {};
  for (const c of costs) { const a = parseNum(c.amount); if (a) byType[c.type] = round2((byType[c.type] || 0) + a); }
  const belege = round2(Object.values(byType).reduce((s, v) => s + v, 0));
  return { days, verpf, km, rate, fahrt, byType, belege, total: round2(verpf + fahrt + belege), f };
}
function update() {
  const t = totals();
  renderDays(t.days);
  const row = (k, v, hl) => `<div${hl ? ' class="hl"' : ''}><span>${k}</span><b>${v}</b></div>`;
  $('#out').innerHTML = row(`Verpflegung (${t.days.length} Tag${t.days.length === 1 ? '' : 'e'})`, money(t.verpf))
    + row(`Fahrtkosten (${t.km} km)`, money(t.fahrt))
    + Object.entries(t.byType).map(([k, v]) => row(k, money(v))).join('')
    + row('Gesamt', money(t.total), true);
  save();
}
const save = debounce(() => store.set(KEY, { form: formData(form), meals, costs }), 400);

/* ————— PDF-Mappe ————— */
async function buildPdf() {
  const t = totals();
  const { PDFDocument, StandardFonts, rgb } = await pdflib();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const chars = new Set(font.getCharacterSet());
  const clean = (s) => [...String(s ?? '')].map((c) => (chars.has(c.codePointAt(0)) ? c : '?')).join('');
  const INK = rgb(0.043, 0.102, 0.247), BLUE = rgb(0.106, 0.247, 0.82), MUTED = rgb(0.4, 0.46, 0.6), RULE = rgb(0.84, 0.875, 0.957);
  let page = pdf.addPage([595.28, 841.89]), y = 780;
  const L = 50, R = 545;
  const txt = (s, x, yy, o = {}) => page.drawText(clean(s), { x: o.right ? x - (o.f || font).widthOfTextAtSize(clean(s), o.size || 10) : x, y: yy, size: o.size || 10, font: o.f || font, color: o.c || INK });
  const line = (yy, c = RULE, w = 0.6) => page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: w, color: c });
  const ensure = (h) => { if (y - h < 60) { page = pdf.addPage([595.28, 841.89]); y = 790; } };
  page.drawRectangle({ x: 0, y: 827, width: 595.28, height: 15, color: rgb(0.047, 0.145, 0.51) });
  txt('REISEKOSTENABRECHNUNG', L, y, { f: bold, size: 18, c: BLUE }); y -= 26;
  const f = t.f;
  const fmtDT = (v) => (v ? new Date(v).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  for (const [k, v] of [['Name', f.person], ['Reiseziel', f.dest], ['Anlass', f.reason], ['Beginn', fmtDT(f.start)], ['Ende', fmtDT(f.end)]]) { txt(k.toUpperCase(), L, y, { size: 7.5, c: MUTED }); txt(v || '-', L + 90, y); y -= 16; }
  y -= 8; line(y, INK, 1); y -= 20;
  txt('Verpflegungsmehraufwand', L, y, { f: bold, size: 11 }); y -= 16;
  for (const d of t.days) {
    ensure(16);
    const cut = ['b', 'l', 'd'].filter((x) => d.m[x]).map((x) => ({ b: 'Frühstück', l: 'Mittag', d: 'Abend' }[x])).join(', ');
    txt(d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }), L, y);
    txt(`${d.note}${cut ? ` · gestellt: ${cut}` : ''}`, L + 110, y, { size: 8.5, c: MUTED });
    txt(money(d.amount), R, y, { right: true }); y -= 15;
  }
  line(y + 6); y -= 12;
  txt(`Fahrtkosten: ${t.km} km × ${String(t.rate.toFixed(2)).replace('.', ',')} €`, L, y); txt(money(t.fahrt), R, y, { right: true }); y -= 22;
  if (costs.length) {
    txt('Kosten laut Beleg', L, y, { f: bold, size: 11 }); y -= 16;
    for (const c of costs) { if (!parseNum(c.amount)) continue; ensure(15); txt(c.type, L, y); txt(c.desc || '', L + 110, y, { size: 8.5, c: MUTED }); txt(money(parseNum(c.amount)), R, y, { right: true }); y -= 15; }
    y -= 6;
  }
  ensure(60);
  line(y + 4, INK, 1.2); y -= 14;
  txt('Gesamt', L, y, { f: bold, size: 13 }); txt(money(t.total), R, y, { f: bold, size: 13, right: true }); y -= 50;
  ensure(60);
  page.drawLine({ start: { x: L, y }, end: { x: L + 200, y }, thickness: 0.6, color: INK });
  page.drawLine({ start: { x: R - 200, y }, end: { x: R, y }, thickness: 0.6, color: INK });
  txt('Datum, Unterschrift Reisende/r', L, y - 12, { size: 7.5, c: MUTED });
  txt('Geprüft / genehmigt', R - 200, y - 12, { size: 7.5, c: MUTED });
  txt(`Anlagen: ${files.length} Beleg${files.length === 1 ? '' : 'e'} · erstellt mit beleg.org`, L, 40, { size: 7, c: MUTED });
  for (const [i, file] of files.entries()) {
    st.set(`Beleg ${i + 1} von ${files.length} wird angehängt …`);
    try {
      if (isPdf(file)) { const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }); for (const p of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(p); }
      else await addImagePage(pdf, await imageCanvas(file, 2600), { fit: 'a4', landscape: 'auto', quality: 0.8 });
    } catch { st.set(`${file.name} konnte nicht angehängt werden`, 'err'); }
  }
  st.clear();
  await savePdf(pdf, `Reisekosten_${(f.dest || 'Reise').replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${(f.start || '').slice(0, 10)}.pdf`);
}

function renderFiles() {
  $('#att').innerHTML = files.map((f, i) => `<li class="fitem"><div class="fitem__th"></div><div style="min-width:0"><div class="fitem__name">${esc(f.name)}</div><div class="fitem__info">${isPdf(f) ? 'PDF' : 'Bild'} · ${Math.round(f.size / 1024)} KB</div></div><div class="fitem__acts"><button type="button" class="del" data-f="${i}" aria-label="Entfernen">✕</button></div></li>`).join('');
}

/* ————— Ereignisse ————— */
form.addEventListener('input', (e) => {
  const c = e.target.closest('.cost');
  if (c) costs[Number(c.dataset.i)][e.target.dataset.k] = e.target.value;
  if (e.target.dataset.day) { const k = e.target.dataset.day; meals[k] = { ...(meals[k] || {}), [e.target.dataset.meal]: e.target.checked }; }
  update();
});
$('#costs').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { costs.splice(Number(b.closest('.cost').dataset.i), 1); renderCosts(); update(); } });
$('#addCost').addEventListener('click', () => { costs.push({ type: 'Bahn', desc: '', amount: '' }); renderCosts(); $('#costs .cost:last-child input').focus(); });
$('#att').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { files.splice(Number(b.dataset.f), 1); renderFiles(); } });
$('#pdf').addEventListener('click', buildPdf);
$('#reset').addEventListener('click', () => { if (!confirm('Alle Angaben löschen?')) return; store.del(KEY); form.reset(); meals = {}; costs = []; files.length = 0; renderCosts(); renderFiles(); init(); });
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (list) => { files.push(...list); renderFiles(); }, accept: (f) => isPdf(f) || isImage(f) });

function init() {
  const saved = store.get(KEY);
  if (saved) { fillForm(form, saved.form); meals = saved.meals || {}; costs = saved.costs || []; }
  if (!form.elements.start.value) {
    const d = new Date(); d.setHours(7, 30, 0, 0);
    const e = new Date(d); e.setDate(d.getDate() + 1); e.setHours(18, 0, 0, 0);
    const iso = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    form.elements.start.value = iso(d); form.elements.end.value = iso(e);
  }
  if (!costs.length) costs.push({ type: 'Übernachtung', desc: '', amount: '' });
  renderCosts(); update();
}
init();
