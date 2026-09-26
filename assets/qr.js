// QR-Codes und GiroCode (EPC-QR, „Zahlen mit Code“)
import { ibanValid } from './common.js?v=dd1f3874';

const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;
let libP;
const lib = () => (libP ??= new Promise((res, rej) => {
  if (window.qrcode) return res(window.qrcode);
  const s = Object.assign(document.createElement('script'), { src: V('qrcode/qrcode.js'), onload: () => res(window.qrcode), onerror: rej });
  document.head.append(s);
}));

/** QR-Matrix (boolean[][]) für einen Text. */
export async function qrMatrix(text, ecc = 'M') {
  const q = await lib();
  q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
  const code = q(0, ecc);
  code.addData(text, 'Byte');
  code.make();
  const n = code.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => code.isDark(r, c)));
}

/** SVG-Markup (Ruhezone 4 Module) */
export function qrSvg(m, { size = 200, color = '#0b1a3f', label = '' } = {}) {
  const n = m.length, q = 4, total = n + 2 * q;
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + q} ${r + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="${color}"/></svg>`;
}

/** QR in ein pdf-lib-Dokument zeichnen (Vektor). x/y = linke untere Ecke, size in pt */
export function drawQr(page, m, x, y, size, rgbColor) {
  const n = m.length, cell = size / n;
  m.forEach((row, r) => row.forEach((on, c) => {
    if (on) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.02, height: cell + 0.02, color: rgbColor });
  }));
}

/**
 * EPC-QR-Payload (European Payments Council, Version 002).
 * Pflicht: name (≤70), iban. Optional: bic, amount (0.01–999999999.99), purpose (Verwendungszweck ≤140)
 */
export function epcPayload({ name, iban, bic = '', amount = null, purpose = '', reference = '' }) {
  const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  const amt = amount && amount > 0 ? `EUR${Number(amount).toFixed(2)}` : '';
  const lines = ['BCD', '002', '1', 'SCT', clean(bic, 11).toUpperCase(), clean(name, 70), String(iban || '').replace(/\s/g, '').toUpperCase(), amt, '', clean(reference, 35), reference ? '' : clean(purpose, 140)];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export function epcErrors({ name, iban, amount }) {
  const e = [];
  if (!String(name || '').trim()) e.push('Name des Empfängers fehlt');
  if (!ibanValid(iban)) e.push('IBAN ist ungültig');
  if (amount && (amount < 0.01 || amount > 999999999.99)) e.push('Betrag außerhalb des erlaubten Bereichs');
  return e;
}

/** GiroCode in eine gerenderte Lesefassung (renderInvoice) einsetzen. */
export async function fillInvoiceQr(root, m) {
  const el = root.querySelector('[data-qr]');
  if (!el) return;
  const p = m.payment, t = m.totals;
  const data = { name: p.accountName || m.seller?.name, iban: p.iban, bic: p.bic, amount: t.due ?? t.grand, purpose: p.reference || m.number };
  if (epcErrors(data).length) { el.remove(); return; }
  el.innerHTML = `${qrSvg(await qrMatrix(epcPayload(data), 'M'), { size: 96, label: 'GiroCode' })}<span>Zahlen mit Code</span>`;
}
