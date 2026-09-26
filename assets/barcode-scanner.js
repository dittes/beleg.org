// Barcode Scanner mit Scanliste
import { $, esc, download } from './common.js?v=dd1f3874';
import { createDecoder, cameraScanner, fileCanvas, beep, FORMAT_NAMES } from './codescan.js?v=fee473fe';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec', 'qr_code'];
let decoder, scanner, cams = [], rows = [], lastId = 0;

/* ————— GTIN: Prüfziffer, GS1-Präfix, ISBN ————— */
export function gtinCheck(code) {
  const d = String(code).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) return null;
  const body = d.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  const expected = (10 - (sum % 10)) % 10;
  return { ok: expected === Number(d.at(-1)), expected };
}
const GS1 = [[0, 19, 'USA/Kanada'], [20, 29, 'interne Nummer (Handel)'], [30, 39, 'USA'], [60, 139, 'USA/Kanada'], [300, 379, 'Frankreich'], [380, 380, 'Bulgarien'], [383, 383, 'Slowenien'], [385, 385, 'Kroatien'],
  [400, 440, 'Deutschland'], [450, 459, 'Japan'], [460, 469, 'Russland'], [471, 471, 'Taiwan'], [474, 474, 'Estland'], [475, 475, 'Lettland'], [477, 477, 'Litauen'], [489, 489, 'Hongkong'], [490, 499, 'Japan'],
  [500, 509, 'Vereinigtes Königreich'], [520, 521, 'Griechenland'], [528, 528, 'Libanon'], [529, 529, 'Zypern'], [539, 539, 'Irland'], [540, 549, 'Belgien/Luxemburg'], [560, 560, 'Portugal'], [569, 569, 'Island'],
  [570, 579, 'Dänemark'], [590, 590, 'Polen'], [594, 594, 'Rumänien'], [599, 599, 'Ungarn'], [600, 601, 'Südafrika'], [640, 649, 'Finnland'], [690, 699, 'China'], [700, 709, 'Norwegen'], [729, 729, 'Israel'],
  [730, 739, 'Schweden'], [760, 769, 'Schweiz/Liechtenstein'], [770, 771, 'Kolumbien'], [789, 790, 'Brasilien'], [800, 839, 'Italien'], [840, 849, 'Spanien'], [858, 858, 'Slowakei'], [859, 859, 'Tschechien'],
  [860, 860, 'Serbien'], [869, 869, 'Türkei'], [870, 879, 'Niederlande'], [880, 880, 'Südkorea'], [885, 885, 'Thailand'], [888, 888, 'Singapur'], [890, 890, 'Indien'], [893, 893, 'Vietnam'],
  [900, 919, 'Österreich'], [930, 939, 'Australien'], [940, 949, 'Neuseeland'], [955, 955, 'Malaysia'], [977, 977, 'Zeitschrift (ISSN)'], [978, 979, 'Buch (ISBN)'], [980, 980, 'Rückerstattungsbeleg'], [981, 984, 'Gutschein'], [990, 999, 'Coupon']];
function gtinInfo(code, format) {
  const d = String(code).replace(/\D/g, '');
  const out = [];
  if (!['ean_13', 'ean_8', 'upc_a', 'upc_e'].includes(format) && !(format === 'manual' && [8, 12, 13].includes(d.length))) return { text: '', ok: null };
  const c = gtinCheck(d.length === 12 ? '0' + d : d);
  if (c) out.push(c.ok ? 'Prüfziffer ✓' : `Prüfziffer falsch (erwartet ${c.expected})`);
  const g = d.length === 13 ? d : d.length === 12 ? '0' + d : '';
  if (g) {
    const p3 = Number(g.slice(0, 3));
    const hit = GS1.find(([a, b]) => p3 >= a && p3 <= b);
    if (hit) out.push(hit[2]);
    if (/^97[89]/.test(g)) out.push(`ISBN ${g}`);
  }
  return { text: out.join(' · '), ok: c ? c.ok : null };
}

/* ————— Liste ————— */
function add(format, value) {
  const existing = $('#merge').checked && rows.find((r) => r.value === value && r.format === format);
  if (existing) { existing.qty += 1; existing.flash = true; }
  else rows.unshift({ id: ++lastId, format, value, qty: 1, note: '', at: new Date(), info: gtinInfo(value, format), flash: true });
  if ($('#sound').checked) beep();
  const r = existing || rows[0];
  $('#last').innerHTML = `<span class="qr-card__type">${esc(FORMAT_NAMES[format] || format)}</span><h3 class="mono" style="font-family:var(--f-mono)">${esc(value)}</h3>
    ${r.info.text ? `<p style="margin:8px 0 0;color:${r.info.ok === false ? 'var(--err)' : 'var(--ink-2)'}">${esc(r.info.text)}</p>` : ''}
    ${/^https?:\/\//.test(value) ? '<div class="warn">Dieser Code enthält einen Link. Für Links nutze den <a href="../qr-code-scanner/">QR Code Scanner</a> mit Sicherheitsprüfung.</div>' : ''}
    <p class="small" style="margin:8px 0 0">Menge in der Liste: <b>${r.qty}</b></p>
    <button class="btn btn--ghost" type="button" id="copyLast">Code kopieren</button>`;
  $('#copyLast').onclick = () => navigator.clipboard?.writeText(value);
  $('#cam').classList.add('is-hit'); setTimeout(() => $('#cam').classList.remove('is-hit'), 600);
  render();
}
function render() {
  $('#count').textContent = String(rows.reduce((s, r) => s + r.qty, 0));
  $('#rows').innerHTML = rows.length ? rows.map((r, i) => `<tr data-id="${r.id}" class="${r.flash ? 'is-new' : ''}"><td>${rows.length - i}</td><td>${esc(FORMAT_NAMES[r.format] || r.format)}</td><td class="mono">${esc(r.value)}</td>
    <td class="small" style="${r.info.ok === false ? 'color:var(--err)' : ''}">${esc(r.info.text)}</td>
    <td><input type="number" min="0" value="${r.qty}" data-k="qty" aria-label="Menge"></td><td><input class="note-in" value="${esc(r.note)}" data-k="note" placeholder="Notiz" aria-label="Notiz"></td>
    <td><button type="button" data-del aria-label="Entfernen">✕</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="small" style="padding:18px">Die Liste ist leer. Scanne einen Barcode oder gib einen Code von Hand ein.</td></tr>';
  rows.forEach((r) => { r.flash = false; });
}
$('#rows').addEventListener('input', (e) => {
  const tr = e.target.closest('tr'); const r = rows.find((x) => x.id === Number(tr.dataset.id)); if (!r) return;
  if (e.target.dataset.k === 'qty') { r.qty = Math.max(0, Number(e.target.value) || 0); $('#count').textContent = String(rows.reduce((s, x) => s + x.qty, 0)); }
  else r.note = e.target.value;
});
$('#rows').addEventListener('click', (e) => { if (e.target.closest('[data-del]')) { const id = Number(e.target.closest('tr').dataset.id); rows = rows.filter((r) => r.id !== id); render(); } });
$('#clear').addEventListener('click', () => { if (!rows.length || confirm('Liste wirklich leeren?')) { rows = []; render(); } });
$('#copy').addEventListener('click', async () => { const t = rows.map((r) => `${r.value}\t${r.qty}`).reverse().join('\n'); try { await navigator.clipboard.writeText(t); $('#copy').textContent = 'Kopiert ✓'; setTimeout(() => { $('#copy').textContent = 'Alle kopieren'; }, 1500); } catch { prompt('Zum Kopieren:', t); } });
$('#csv').addEventListener('click', () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Nr', 'Format', 'Code', 'Menge', 'Info', 'Notiz', 'Zeit'].map(q).join(';'),
    ...rows.slice().reverse().map((r, i) => [i + 1, FORMAT_NAMES[r.format] || r.format, `="${r.value}"`, r.qty, r.info.text, r.note, r.at.toLocaleString('de-DE')].map((v, k) => (k === 2 ? v : q(v))).join(';'))];
  download(`barcodes_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
});
$('#manual').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = e.target.value.trim(); if (!v) return;
  const d = v.replace(/\s/g, '');
  const fmt = /^\d{13}$/.test(d) ? 'ean_13' : /^\d{8}$/.test(d) ? 'ean_8' : /^\d{12}$/.test(d) ? 'upc_a' : 'manual';
  add(fmt, d); e.target.value = '';
});

/* ————— Kamera & Bilder ————— */
async function ready() {
  decoder ??= await createDecoder(FORMATS);
  $('#engine').textContent = `Erkennung: ${decoder.engine === 'nativ' ? 'Browser (schnell)' : 'ZXing'}`;
  return decoder;
}
async function start(deviceId) {
  try {
    await ready();
    scanner ??= cameraScanner({
      video: $('#video'), decoder, repeatMs: 1800,
      onResult: (r) => add(r.format, r.value),
      onState: (s) => { const on = s === 'running'; $('#cam').classList.toggle('is-off', !on); $('#camStart').hidden = on; $('#camTools').hidden = !on; $('#camHint').hidden = !on; },
    });
    await scanner.start(deviceId);
    $('#torch').hidden = !scanner.torchSupported();
    cams = await scanner.cameras();
    $('#switch').hidden = cams.length < 2;
  } catch (e) {
    $('#camNote').textContent = e.name === 'NotAllowedError' ? 'Kein Kamerazugriff erlaubt. Du kannst stattdessen ein Bild wählen.' : 'Keine Kamera gefunden. Du kannst stattdessen ein Bild wählen.';
  }
}
async function fromFiles(files) {
  await ready();
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const res = await decoder.decode(await fileCanvas(f));
    if (res.length) res.forEach((r) => add(r.format, r.value));
    else $('#last').innerHTML = `<p class="qr-empty">In „${esc(f.name)}“ wurde kein Barcode gefunden. Tipp: Bild so zuschneiden, dass der Code groß und gerade ist.</p>`;
  }
}
$('#start').addEventListener('click', () => start());
$('#stop').addEventListener('click', () => scanner?.stop());
$('#switch').addEventListener('click', () => { const i = cams.findIndex((c) => c.deviceId === scanner.currentId()); start(cams[(i + 1) % cams.length].deviceId); });
$('#torch').addEventListener('click', async (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; try { await scanner.torch(on); e.currentTarget.setAttribute('aria-pressed', String(on)); } catch { /* nicht unterstützt */ } });
$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => { fromFiles([...e.target.files]); e.target.value = ''; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); fromFiles([...(e.dataTransfer?.files || [])]); });
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) fromFiles(f); });
window.addEventListener('pagehide', () => scanner?.stop());
render();
ready();
