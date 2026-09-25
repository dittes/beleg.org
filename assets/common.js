// Gemeinsame Helfer für alle Seiten.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eurFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n, cur = 'EUR') => {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const s = eurFmt.format(n);
  return cur === 'EUR' ? `${s} €` : `${s} ${cur}`;
};
export const dec = (n, d = 2) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d }).format(n);

// Eingaben wie "1.234,50" oder "1234.5" in Zahlen umwandeln.
export function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s|€/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Betrag in Worten (für Quittungen), z. B. 1234,56 → "eintausendzweihundertvierunddreißig Euro 56 Cent"
const ONES = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
function below1000(n) {
  let out = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out += ONES[h] + 'hundert';
  if (r) {
    if (r < 20) out += ONES[r];
    else { const o = r % 10, t = Math.floor(r / 10); out += (o ? ONES[o] + 'und' : '') + TENS[t]; }
  }
  return out;
}
export function numberToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'null';
  const parts = [];
  const mio = Math.floor(n / 1e6), tsd = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (mio) parts.push(mio === 1 ? 'eine Million ' : below1000(mio) + ' Millionen ');
  if (tsd) parts.push(below1000(tsd) + 'tausend');
  if (rest) parts.push(below1000(rest));
  let s = parts.join('').trim();
  if (s.endsWith('ein')) s += 's';
  return s;
}
export function amountInWords(amount) {
  const a = round2(Math.abs(amount));
  const euro = Math.floor(a), cent = Math.round((a - euro) * 100);
  let s = `${numberToWords(euro)} Euro`;
  if (cent) s += ` und ${numberToWords(cent)} Cent`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// IBAN-Prüfziffer (Modulo 97)
export function ibanValid(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith('DE') && s.length !== 22) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
export const fmtIban = (iban) => String(iban || '').replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

export function download(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Browser-Speicher nur als Komfort – darf fehlschlagen.
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignorieren */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignorieren */ } },
};
export const session = {
  take(key) {
    try { const v = sessionStorage.getItem(key); sessionStorage.removeItem(key); return v; } catch { return null; }
  },
  put(key, value) { try { sessionStorage.setItem(key, value); return true; } catch { return false; } },
};

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Formularwerte als flaches Objekt (name → value / checked)
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
export function fillForm(form, data) {
  if (!data) return;
  for (const el of form.elements) {
    if (!el.name || !(el.name in data)) continue;
    if (el.type === 'checkbox') el.checked = !!data[el.name];
    else el.value = data[el.name];
  }
}
