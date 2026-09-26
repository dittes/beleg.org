// 04 · E-Rechnung schreiben
import { $, $$, esc, money, dec, parseNum, fmtDate, fmtIban, todayISO, addDaysISO, download, store, session, formData, fillForm, debounce } from './common.js?v=dd1f3874';
import { buildModel, toCII, check, renderInvoice, SAMPLE_FORM, GUIDELINES, UNIT_CODES, TYPE_CODES, MEANS_CODES } from './einvoice.js?v=02638bd2';
import { fillInvoiceQr, qrMatrix, epcPayload, epcErrors, drawQr } from './qr.js?v=ff898161';

const PDFLIB = new URL('../vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url).href;
const KEY = 'beleg:rechnung';
const form = $('#form');
const UNITS = [['C62', 'Stück'], ['HUR', 'Stunde'], ['DAY', 'Tag'], ['MON', 'Monat'], ['LS', 'pauschal'], ['KGM', 'kg'], ['MTR', 'Meter'], ['KMT', 'km']];
const RATES = [19, 7, 0];

/* ————— Positionen ————— */
function lineRow(l = {}) {
  const el = document.createElement('div');
  el.className = 'line';
  el.innerHTML = `
    <span class="line__no"></span>
    <div><input data-k="name" placeholder="Leistung oder Artikel" value="${esc(l.name || '')}" aria-label="Bezeichnung">
      <input data-k="desc" class="line__desc" placeholder="Beschreibung (optional)" value="${esc(l.desc || '')}" aria-label="Beschreibung"></div>
    <input data-k="qty" class="num-in" inputmode="decimal" value="${esc(l.qty ?? 1)}" aria-label="Menge">
    <select data-k="unit" aria-label="Einheit">${UNITS.map(([c, n]) => `<option value="${c}" ${c === (l.unit || 'C62') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <input data-k="price" class="num-in" inputmode="decimal" value="${l.price !== undefined && l.price !== '' ? esc(String(l.price).replace('.', ',')) : ''}" placeholder="0,00" aria-label="Einzelpreis netto">
    <select data-k="rate" name="rate" aria-label="Umsatzsteuersatz">${RATES.map((r) => `<option value="${r}" ${Number(l.rate ?? 19) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select>
    <button type="button" class="line__del" aria-label="Position entfernen">✕</button>
    <span class="line__sum"></span>`;
  el.querySelector('.line__del').addEventListener('click', () => { el.remove(); if (!$$('.line').length) $('#lines').append(lineRow()); update(); });
  return el;
}
function readLines() {
  return $$('.line').map((el) => {
    const g = (k) => el.querySelector(`[data-k="${k}"]`).value;
    return { name: g('name').trim(), desc: g('desc').trim(), qty: parseNum(g('qty')), unit: g('unit'), price: parseNum(g('price')), rate: Number(g('rate')) };
  });
}
function setLines(lines) {
  $('#lines').replaceChildren(...(lines?.length ? lines : [{}]).map(lineRow));
}

/* ————— Modell ————— */
function current() {
  const f = formData(form);
  f.profile = form.querySelector('[name="profile"]:checked')?.value || 'xrechnung';
  f.lines = readLines();
  f.dueDate = f.issueDate && f.dueDays !== '' ? addDaysISO(f.issueDate, f.dueDays) : '';
  return f;
}

function update() {
  const f = current();
  const m = buildModel(f);
  // Zeilen-Nummern und -Summen
  $$('.line').forEach((el, i) => {
    el.querySelector('.line__no').textContent = String(i + 1).padStart(2, '0');
    const l = f.lines[i];
    el.querySelector('.line__sum').textContent = l.price ? `= ${money(Math.round(l.qty * l.price * 100) / 100)}` : '';
  });
  $('#linesBox').classList.toggle('ku-rate', !!f.kleinunternehmer);
  for (const el of $$('[data-when]')) el.hidden = el.dataset.when !== f.periodMode;

  $('#doc').innerHTML = renderInvoice(m, { compact: true });
  fillInvoiceQr($('#doc'), m);
  const res = check(m);
  const { ok, warn, err } = res.score;
  const live = $('#live');
  live.dataset.state = err ? 'err' : warn ? 'warn' : 'ok';
  live.innerHTML = `<span><i class="i-${err ? 'err' : warn ? 'warn' : 'ok'}" style="background:var(--${err ? 'err' : warn ? 'warn' : 'blue'})"></i>${err ? `${err} Fehler` : warn ? `${warn} Hinweis${warn === 1 ? '' : 'e'}` : 'Prüfung bestanden'}</span><span class="small">${ok}/${ok + warn + err}</span>`;
  const issues = res.items.filter((x) => x.level !== 'ok');
  $('#issues').innerHTML = issues.length
    ? issues.map((x) => `<li class="${x.level}"><code>${esc(x.code)}</code><span>${esc(x.text)}</span></li>`).join('')
    : '<li><code style="color:var(--blue)">OK</code><span>Alle Pflichtangaben vorhanden, alle Summen stimmen.</span></li>';
  return { f, m, res };
}
const persist = debounce(() => { store.set(KEY, current()); const sv = $('#saved'); if (sv) sv.textContent = `gespeichert ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`; }, 400);

/* ————— Export ————— */
const fileBase = (m) => `Rechnung_${String(m.number || 'entwurf').replace(/[^\w.-]+/g, '_')}`;
function guardErrors(res) {
  if (!res.score.err) return true;
  const open = $('#issues');
  open.hidden = false;
  $('#live').setAttribute('aria-expanded', 'true');
  return confirm(`Die Rechnung hat noch ${res.score.err} Fehler. Trotzdem herunterladen?`);
}

$('#dlXml').addEventListener('click', () => {
  const { m, res } = update();
  if (!guardErrors(res)) return;
  download(`${fileBase(m)}.xml`, toCII(m), 'application/xml');
});
$('#toCheck').addEventListener('click', () => {
  const { m } = update();
  session.put('beleg:handoff', toCII(m));
  location.href = '../e-rechnung-pruefen/';
});
$('#dlPdf').addEventListener('click', async () => {
  const { m, res } = update();
  if (!guardErrors(res)) return;
  const btn = $('#dlPdf');
  btn.disabled = true;
  try {
    const bytes = await buildPdf(m);
    download(`${fileBase(m)}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
  } catch (e) {
    alert(`PDF konnte nicht erstellt werden: ${e.message}`);
  } finally { btn.disabled = false; }
});

/* ————— PDF (pdf-lib) ————— */
async function buildPdf(m) {
  const { PDFDocument, StandardFonts, rgb, AFRelationship, PDFName } = await import(PDFLIB);
  // In der PDF immer mit EN-16931-Kennung (factur-x.xml) – das lesen alle ZUGFeRD-Empfänger
  const xml = toCII(m, GUIDELINES.en16931);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const chars = new Set(font.getCharacterSet());
  const clean = (s) => [...String(s ?? '')].map((c) => (chars.has(c.codePointAt(0)) ? c : c === '€' ? 'EUR' : '?')).join('');

  const INK = rgb(0.043, 0.102, 0.247), BLUE = rgb(0.106, 0.247, 0.82), DEEP = rgb(0.047, 0.145, 0.51), MUTED = rgb(0.4, 0.46, 0.6), RULE = rgb(0.84, 0.875, 0.957);
  const W = 595.28, H = 841.89, L = 50, R = W - 50;
  let page, y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: DEEP });
    page.drawRectangle({ x: L, y: H - 18.5, width: 90, height: 4.5, color: BLUE });
    y = H - 60;
  };
  const text = (s, x, yy, { f = font, size = 9.5, color = INK, align = 'left', maxW } = {}) => {
    let t = clean(s);
    if (maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
    const w = f.widthOfTextAtSize(t, size);
    const xx = align === 'right' ? x - w : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color });
  };
  const wrap = (s, maxW, size = 9.5, f = font) => {
    const words = clean(s).split(/\s+/); const out = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur);
    return out;
  };
  const label = (s, x, yy, align) => text(s.toUpperCase(), x, yy, { f: mono, size: 7, color: MUTED, align });
  const hr = (yy, c = RULE, t = 0.6) => page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: t, color: c });

  newPage();
  const s = m.seller, b = m.buyer, cur = m.currency;
  const eur = (n) => clean(money(n, cur));
  // Kopf
  text(s.name, L, y, { f: bold, size: 16, maxW: 300 });
  text([s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '), L, y - 16, { size: 8.5, color: MUTED });
  text([s.contact?.phone, s.contact?.email].filter(Boolean).join(' · '), L, y - 28, { size: 8.5, color: MUTED });
  text(TYPE_CODES[m.typeCode]?.toUpperCase() || 'RECHNUNG', R, y + 2, { f: bold, size: 18, color: BLUE, align: 'right' });
  y -= 56; hr(y, INK, 1.2);

  // Empfänger & Metadaten
  y -= 22;
  label('Rechnung an', L, y);
  const by = y;
  text(b.name, L, y - 16, { f: bold, size: 11, maxW: 260 });
  let yy = y - 30;
  for (const ln of [b.street, [b.zip, b.city].filter(Boolean).join(' '), b.country !== 'DE' ? b.country : ''].filter(Boolean)) { text(ln, L, yy); yy -= 13; }
  const meta = [['Rechnungs-Nr.', m.number], ['Datum', fmtDate(m.issueDate)],
    ['Leistung', m.period?.start ? `${fmtDate(m.period.start)} - ${fmtDate(m.period.end)}` : fmtDate(m.deliveryDate)],
    ['Fällig', m.payment.dueDate ? fmtDate(m.payment.dueDate) : ''], ['Käuferreferenz', m.buyerReference !== m.number ? m.buyerReference : '']].filter(([, v]) => v && v !== '–');
  let my = by + 4;
  const MX = 360;
  for (const [k, v] of meta) {
    page.drawLine({ start: { x: MX, y: my }, end: { x: R, y: my }, thickness: 0.6, color: RULE });
    label(k, MX, my - 12); text(v, R, my - 12, { f: mono, size: 9, align: 'right' });
    my -= 19;
  }
  page.drawLine({ start: { x: MX, y: my }, end: { x: R, y: my }, thickness: 0.6, color: RULE });
  y = Math.min(yy, my) - 26;

  text(`${TYPE_CODES[m.typeCode] || 'Rechnung'} ${m.number}`, L, y, { f: bold, size: 15 });
  y -= 18;
  for (const n of m.notes) for (const ln of wrap(n, R - L, 9)) { text(ln, L, y, { size: 9, color: MUTED }); y -= 12; }
  y -= 8;

  // Tabelle
  const C = { pos: L, name: L + 26, qty: 330, price: 412, rate: 446, net: R };
  const head = () => {
    label('Pos.', C.pos, y); label('Bezeichnung', C.name, y); label('Menge', C.qty, y, 'right'); label('Einzelpreis', C.price, y, 'right'); label('USt.', C.rate, y, 'right'); label('Netto', C.net, y, 'right');
    y -= 6; hr(y, INK, 0.9); y -= 14;
  };
  head();
  for (const l of m.lines) {
    const nameLines = wrap(l.name, C.qty - C.name - 50, 9.5, bold);
    const descLines = l.desc ? wrap(l.desc, C.qty - C.name - 50, 8.5) : [];
    const hgt = nameLines.length * 12 + descLines.length * 11 + 10;
    if (y - hgt < 170) { newPage(); head(); }
    text(l.id, C.pos, y, { f: mono, size: 8.5, color: MUTED });
    nameLines.forEach((t, i) => text(t, C.name, y - i * 12, { f: bold, size: 9.5 }));
    descLines.forEach((t, i) => text(t, C.name, y - nameLines.length * 12 - i * 11, { size: 8.5, color: MUTED }));
    text(`${dec(l.qty, 4)} ${UNIT_CODES[l.unit] || l.unit}`, C.qty, y, { f: mono, size: 8.5, align: 'right' });
    text(eur(l.price), C.price, y, { f: mono, size: 8.5, align: 'right' });
    text(`${dec(l.taxRate)} %`, C.rate, y, { f: mono, size: 8.5, align: 'right', color: MUTED });
    text(eur(l.net), C.net, y, { f: mono, size: 9, align: 'right' });
    y -= hgt; hr(y + 6);
  }

  // Summen
  if (y < 200) newPage();
  y -= 10;
  const SX = 330;
  const sumRow = (k, v, strong) => {
    if (strong) { page.drawLine({ start: { x: SX, y: y + 12 }, end: { x: R, y: y + 12 }, thickness: 1.1, color: INK }); }
    text(k, SX, y, { f: strong ? bold : font, size: strong ? 11 : 9.5 });
    text(v, R, y, { f: strong ? bold : mono, size: strong ? 11 : 9, align: 'right' });
    y -= strong ? 20 : 15;
  };
  sumRow('Nettobetrag', eur(m.totals.taxBasis));
  for (const t of m.taxes) sumRow(t.cat === 'E' ? 'Umsatzsteuer (befreit)' : `USt. ${dec(t.rate)} % auf ${eur(t.basis)}`, eur(t.amount));
  y -= 4;
  sumRow('Gesamtbetrag', eur(m.totals.grand), true);
  for (const t of m.taxes.filter((t) => t.reason)) for (const ln of wrap(t.reason, R - SX, 8)) { text(ln, SX, y, { size: 8, color: MUTED }); y -= 10; }

  // Fuß
  const fy = 96;
  page.drawLine({ start: { x: L, y: fy + 26 }, end: { x: R, y: fy + 26 }, thickness: 0.6, color: RULE });
  label('Zahlung', L, fy + 12);
  const p = m.payment;
  text(`${MEANS_CODES[p.meansCode] || ''}${p.accountName ? ' an ' + p.accountName : ''}`, L, fy, { size: 8.5, maxW: 250 });
  if (p.iban) text(`IBAN ${fmtIban(p.iban)}${p.bic ? '  BIC ' + p.bic : ''}`, L, fy - 12, { f: mono, size: 8 });
  if (p.terms) text(p.terms, L, fy - 24, { size: 8, color: MUTED, maxW: 250 });
  label('Steuer', 320, fy + 12);
  if (s.vatId) text(`USt-IdNr. ${s.vatId}`, 320, fy, { size: 8.5 });
  if (s.taxNo) text(`Steuernr. ${s.taxNo}`, 320, fy - (s.vatId ? 12 : 0), { size: 8.5 });
  // GiroCode rechts unten
  const epc = { name: p.accountName || s.name, iban: p.iban, bic: p.bic, amount: m.totals.due, purpose: p.reference || m.number };
  if (p.iban && m.totals.due > 0 && !epcErrors(epc).length) {
    const qs = 64;
    drawQr(page, await qrMatrix(epcPayload(epc), 'M'), R - qs, fy - 46, qs, INK);
    text('ZAHLEN MIT CODE', R - qs / 2 - mono.widthOfTextAtSize('ZAHLEN MIT CODE', 6) / 2, fy - 54, { f: mono, size: 6, color: MUTED });
  }
  text('E-Rechnung: strukturierte Daten nach EN 16931 als factur-x.xml eingebettet · erstellt mit beleg.org', L, 40, { f: mono, size: 6.5, color: MUTED });

  // XML einbetten
  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {
    mimeType: 'text/xml', description: 'Factur-X/ZUGFeRD Rechnungsdaten',
    creationDate: new Date(), modificationDate: new Date(), afRelationship: AFRelationship.Alternative,
  });
  const level = 'EN 16931';
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${level}</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(`Rechnung ${m.number}`)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const meta2 = doc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta2));
  doc.setTitle(`Rechnung ${m.number}`);
  doc.setAuthor(s.name);
  doc.setSubject('E-Rechnung (ZUGFeRD / Factur-X)');
  doc.setCreator('beleg.org');
  doc.setProducer('beleg.org · pdf-lib');
  return doc.save();
}

/* ————— Start ————— */
function load(data) {
  form.reset();
  fillForm(form, data);
  const prof = form.querySelector(`[name="profile"][value="${data?.profile || 'xrechnung'}"]`);
  if (prof) prof.checked = true;
  setLines(data?.lines);
  if (!form.issueDate.value) form.issueDate.value = todayISO();
  if (!form.deliveryDate.value) form.deliveryDate.value = form.issueDate.value;
  update();
}
load(store.get(KEY) || null);

form.addEventListener('input', () => { update(); persist(); });
form.addEventListener('change', () => { update(); persist(); });
$('#addLine').addEventListener('click', () => { const r = lineRow(); $('#lines').append(r); r.querySelector('input').focus(); update(); });
$('#sample').addEventListener('click', () => { load(SAMPLE_FORM); persist(); });
$('#clear').addEventListener('click', () => { if (confirm('Alle Eingaben löschen?')) { store.del(KEY); load(null); } });
$('#live').addEventListener('click', () => {
  const box = $('#issues');
  box.hidden = !box.hidden;
  $('#live').setAttribute('aria-expanded', String(!box.hidden));
});
