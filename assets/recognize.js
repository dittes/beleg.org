// Erkennung: Kontoauszüge und Belege aus Text (PDF-Textebene oder OCR).
// Reine Funktionen ohne DOM – laufen im Browser und in Node (Tests).

/* ————————————————— Beträge & Daten ————————————————— */
// Deutsche Beträge: 1.234,56 · -12,34 · 12,34- · 12,34 S · −8,00 € · 5,00EUR
const AMOUNT_RE = /(?<![\d,.])([-+−–]\s?)?(\d{1,3}(?:[.\s']\d{3})+|\d+),(\d{2})(?![\d])\s?(€|EUR)?\s?([-+](?![\d])|S\b|H\b)?/g;

export function findAmounts(str) {
  const out = [];
  AMOUNT_RE.lastIndex = 0;
  let m;
  while ((m = AMOUNT_RE.exec(str))) {
    const int = m[2].replace(/[.\s']/g, '');
    let value = Number(`${int}.${m[3]}`);
    const lead = (m[1] || '').trim(), trail = (m[5] || '').trim();
    let explicit = null;
    if (/[-−–]/.test(lead) || trail === '-' || trail === 'S') explicit = -1;
    else if (lead === '+' || trail === '+' || trail === 'H') explicit = 1;
    if (explicit === -1) value = -value;
    out.push({ value, explicit, index: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}

export const parseAmount = (s) => { const a = findAmounts(String(s)); return a.length ? a[a.length - 1].value : null; };

const DATE_RE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.((?:19|20)?\d{2})?(?!\d)/g;
const ISO_RE = /(?<!\d)((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/g;

export function findDates(str, fallbackYear) {
  const out = [];
  DATE_RE.lastIndex = 0;
  let m;
  while ((m = DATE_RE.exec(str))) {
    const d = Number(m[1]), mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    let y = m[3] ? Number(m[3]) : fallbackYear;
    if (y && y < 100) y += 2000;
    if (!y) continue;
    out.push({ iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, index: m.index, end: m.index + m[0].length, hasYear: !!m[3] });
  }
  ISO_RE.lastIndex = 0;
  while ((m = ISO_RE.exec(str))) out.push({ iso: `${m[1]}-${m[2]}-${m[3]}`, index: m.index, end: m.index + m[0].length, hasYear: true });
  return out.sort((a, b) => a.index - b.index);
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ————————————————— Zeilen aus PDF-Textelementen ————————————————— */
// items: [{str, x, y, w}] einer Seite → Zeilen mit Teilen (x-Positionen bleiben erhalten)
export function itemsToLines(items) {
  const sorted = items.filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2.5, (it.h || 10) * 0.35)) last.parts.push(it);
    else lines.push({ y: it.y, parts: [it] });
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    // Teile zusammenführen, die direkt aneinander liegen
    const merged = [];
    for (const p of l.parts) {
      const prev = merged[merged.length - 1];
      if (prev && p.x - (prev.x + prev.w) < Math.max(3, (p.h || 10) * 0.35)) {
        const gap = p.x - (prev.x + prev.w) > 0.8 ? ' ' : '';
        prev.str += gap + p.str; prev.w = p.x + p.w - prev.x;
      } else merged.push({ ...p });
    }
    l.parts = merged;
    l.text = merged.map((p) => p.str.trim()).join('  ');
  }
  return lines;
}
export const textToLines = (text) => String(text).split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => ({ y: -i, parts: [{ str: t, x: 0, w: 0 }], text: t }));

/* ————————————————— Kontoauszug ————————————————— */
const STOP_RE = /^(seite\b|übertrag|uebertrag|kontostand|saldo|alter\b|neuer\b|summe|zwischensumme|buchungstag|buchung\s|datum\b|bu-?tag|iban\b|bic\b|kontoauszug|auszug\b|blatt\b|bitte\b|rechnungsabschluss|anlage)/i;
const START_BAL_RE = /(alter|anfangs|vorheriger|start|bisheriger)[\s-]*(konto)?[\s-]*(stand|saldo)|saldo[\s-]*(alt|vortrag)/i;
const END_BAL_RE = /(neuer|end|aktueller|schluss|neu)[\s-]*(konto)?[\s-]*(stand|saldo)|saldo[\s-]*neu/i;

function dominantYear(lines) {
  const count = new Map();
  for (const l of lines) for (const d of findDates(l.text)) if (d.hasYear) { const y = d.iso.slice(0, 4); count.set(y, (count.get(y) || 0) + 1); }
  let best = null, n = 0;
  for (const [y, c] of count) if (c > n) { best = Number(y); n = c; }
  return best || new Date().getFullYear();
}

function detectColumns(lines) {
  const cols = {};
  for (const l of lines) {
    if (l.parts.length < 2) continue;
    for (const p of l.parts) {
      const s = p.str.trim().toLowerCase();
      const c = p.x + p.w / 2;
      if (/^(soll|belastung|ausgang|lastschrift|abbuchung|zahlungsausgang|- ?€?)$/.test(s)) cols.debit = c;
      if (/^(haben|gutschrift|eingang|zahlungseingang|\+ ?€?)$/.test(s)) cols.credit = c;
      if (/^(saldo|kontostand|stand)$/.test(s)) cols.balance = c;
      if (/^(betrag|umsatz|betrag in eur|betrag \(eur\)|betrag eur)$/.test(s)) cols.amount = c;
    }
    if (cols.debit && cols.credit) break;
  }
  return cols;
}

export function parseStatement(lines) {
  const year = dominantYear(lines);
  const cols = detectColumns(lines);
  const hasX = lines.some((l) => l.parts.some((p) => p.x > 0));
  const rows = [];
  let cur = null, startBal = null, endBal = null;
  const generic = []; // „Kontostand am …“ ohne Richtung: erster = Anfang, letzter = Ende

  const amountsWithX = (l) => {
    const res = [];
    for (const p of l.parts) for (const a of findAmounts(p.str)) res.push({ ...a, x: p.x + p.w / 2, part: p });
    return res;
  };

  for (const l of lines) {
    const t = l.text;
    if (START_BAL_RE.test(t)) { const a = findAmounts(t); if (a.length) startBal = a[a.length - 1].value; if (cur) cur = null; continue; }
    if (END_BAL_RE.test(t)) { const a = findAmounts(t); if (a.length) endBal = a[a.length - 1].value; if (cur) cur = null; continue; }
    if (/kontostand|saldo/i.test(t) && !(findDates(t)[0]?.index <= 2 && !/kontostand|saldo/i.test(t.slice(0, 12)))) {
      const a = findAmounts(t);
      if (a.length) { generic.push(a[a.length - 1].value); cur = null; continue; }
    }

    const dates = findDates(t, year);
    const startsWithDate = dates.length && dates[0].index <= 2;
    const amts = amountsWithX(l);

    if (startsWithDate && amts.length) {
      // Neue Buchung
      let amount = amts[0], balance = null;
      if (hasX && cols.balance && amts.length > 1) {
        const byBal = amts.reduce((a, b) => (Math.abs(b.x - cols.balance) < Math.abs(a.x - cols.balance) ? b : a));
        balance = byBal.value;
        amount = amts.find((a) => a !== byBal) || amount;
      } else if (amts.length > 1) {
        balance = amts[amts.length - 1].value;
        amount = amts[0];
      }
      let value = amount.value;
      if (amount.explicit === null && hasX && cols.debit && cols.credit) {
        const toDebit = Math.abs(amount.x - cols.debit), toCredit = Math.abs(amount.x - cols.credit);
        value = toDebit < toCredit ? -Math.abs(value) : Math.abs(value);
      }
      // Beschreibung = Text zwischen Datumsangaben und Betrag
      let lastDateEnd = dates[0].end, valuta = '';
      if (dates[1] && dates[1].index - dates[0].end < 6) { valuta = dates[1].iso; lastDateEnd = dates[1].end; }
      const firstAmtIdx = findAmounts(t)[0]?.index ?? t.length;
      const desc = t.slice(lastDateEnd, firstAmtIdx).replace(/\s{2,}/g, ' ').trim();
      cur = { date: dates[0].iso, valuta, text: desc, purpose: '', amount: r2(value), balance: balance !== null ? r2(balance) : null };
      rows.push(cur);
      continue;
    }

    if (!cur) continue;
    if (STOP_RE.test(t)) { cur = null; continue; }
    // Folgezeile (bei manchen Banken beginnt sie mit dem Valutadatum)
    let rest = t;
    if (startsWithDate) {
      if (!cur.valuta) cur.valuta = dates[0].iso;
      rest = t.slice(dates[0].end).trim();
    }
    if (amts.length && !startsWithDate) { cur = null; continue; }
    if (rest) cur.purpose = (cur.purpose ? cur.purpose + ' ' : '') + rest.replace(/\s{2,}/g, ' ');
  }

  if (startBal === null && generic.length >= 2) startBal = generic[0];
  if (endBal === null && generic.length >= 2) endBal = generic[generic.length - 1];

  // Wenn Saldo-Spalte vorhanden, Vorzeichen daraus ableiten
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.balance !== null && b.balance !== null) {
      const diff = r2(b.balance - a.balance);
      if (Math.abs(Math.abs(diff) - Math.abs(b.amount)) < 0.011) b.amount = diff;
    }
  }

  const sum = r2(rows.reduce((s, r) => s + r.amount, 0));
  const inflow = r2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const outflow = r2(rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
  let reconciled = null;
  if (startBal !== null && endBal !== null) reconciled = Math.abs(r2(startBal + sum) - endBal) < 0.011;
  return { rows, startBal, endBal, sum, inflow, outflow, reconciled, year, columns: cols };
}

export function looksLikeStatement(lines) {
  const text = lines.map((l) => l.text).join('\n');
  let score = 0;
  if (/kontoauszug|umsatzübersicht|umsatzuebersicht|kontoumsätze|account statement/i.test(text)) score += 3;
  if (START_BAL_RE.test(text) || END_BAL_RE.test(text)) score += 2;
  if (/\bIBAN\b/.test(text)) score += 1;
  const dated = lines.filter((l) => { const d = findDates(l.text); return d.length && d[0].index <= 2 && findAmounts(l.text).length; }).length;
  if (dated >= 5) score += 2;
  if (/summe|gesamt|zu zahlen|mwst|ust\.?|bon|kasse/i.test(text) && dated < 5) score -= 2;
  return score >= 3;
}

/* ————————————————— Beleg / Kassenbon / Rechnung ————————————————— */
const TOTAL_KEYS = [
  /zu\s*zahlen|zahlbetrag|rechnungsbetrag|gesamtbetrag|endbetrag|bruttobetrag|gesamt\s*brutto|total\s*eur|summe\s*eur|betrag\s*eur/i,
  /^\s*(summe|gesamt|total)\b|\b(summe|gesamtsumme)\b/i,
  /\b(bar|gegeben|ec[- ]?karte|girocard|kartenzahlung|visa|mastercard|maestro)\b/i,
];
const NOISE_RE = /^(rechnung|quittung|kassenbon|beleg|bon|kopie|kundenbeleg|händlerbeleg|www\.|http|tel|fax|datum|uhrzeit|\d)/i;

function vatFromLine(t) {
  const rm = t.match(/(?<![\d,])(19|16|7|5|0)(?:[,.]0{1,2})?\s?%/);
  if (!rm) return null;
  const rate = Number(rm[1]);
  const amts = findAmounts(t.slice(rm.index + rm[0].length)).map((a) => Math.abs(a.value));
  if (!amts.length) return { rate };
  const k = rate / 100;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.02, b * 0.002);
  if (amts.length >= 3) {
    // Reihenfolge unbekannt – Kombination suchen: netto + steuer = brutto
    for (const n of amts) for (const s of amts) for (const g of amts) if (n !== g && near(r2(n + s), g) && near(r2(n * k), s)) return { rate, net: n, tax: s, gross: g };
  }
  if (amts.length >= 2) {
    const [a, b] = amts;
    if (near(r2(a * k), b)) return { rate, net: a, tax: b, gross: r2(a + b) };
    if (near(r2(b * k), a)) return { rate, net: b, tax: a, gross: r2(a + b) };
    if (near(r2(a * k / (1 + k)), b)) return { rate, gross: a, tax: b, net: r2(a - b) };
    if (near(r2(b * k / (1 + k)), a)) return { rate, gross: b, tax: a, net: r2(b - a) };
  }
  return { rate, tax: amts.length === 1 ? amts[0] : undefined, _amts: amts };
}

export function parseReceipt(text) {
  const lines = String(text).split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const conf = {};

  // Händler: erste sinnvolle Zeile
  const merchant = lines.slice(0, 8).find((l) => l.length > 2 && /[a-zäöü]{2}/i.test(l) && !NOISE_RE.test(l) && !findAmounts(l).length) || '';
  conf.merchant = merchant ? 'mittel' : 'keine';

  // Datum: bevorzugt nach „Datum“, sonst das erste plausible
  let date = '';
  const dl = lines.find((l) => /datum|date|vom\b/i.test(l) && findDates(l).length);
  const cands = dl ? findDates(dl) : lines.flatMap((l) => findDates(l));
  const yearNow = new Date().getFullYear();
  const plausible = cands.find((d) => d.hasYear && Number(d.iso.slice(0, 4)) >= yearNow - 12 && Number(d.iso.slice(0, 4)) <= yearNow + 1);
  if (plausible) { date = plausible.iso; conf.date = dl ? 'hoch' : 'mittel'; } else conf.date = 'keine';

  // Gesamtbetrag
  let total = null;
  for (const re of TOTAL_KEYS) {
    const hit = lines.filter((l) => re.test(l) && !/%/.test(l) && findAmounts(l).length);
    if (hit.length) {
      const a = findAmounts(hit[0]);
      total = Math.abs(a[a.length - 1].value);
      conf.total = re === TOTAL_KEYS[0] ? 'hoch' : 'mittel';
      break;
    }
  }
  if (total === null) {
    const amounts = lines.flatMap((l) => findAmounts(l).map((a) => Math.abs(a.value)));
    if (amounts.length) { total = Math.max(...amounts); conf.total = 'niedrig'; } else conf.total = 'keine';
  }

  // Umsatzsteuer je Satz
  const vat = new Map();
  for (const l of lines) {
    if (!/%/.test(l)) continue;
    if (/rabatt|nachlass|skonto/i.test(l)) continue;
    const v = vatFromLine(l);
    if (!v || v.rate === 0) continue;
    const prev = vat.get(v.rate);
    if (!prev || (v.net !== undefined && prev.net === undefined)) vat.set(v.rate, v);
  }
  // Einzelnen Steuerbetrag über den Gesamtbetrag einordnen
  for (const v of vat.values()) {
    if (v.net === undefined && total) {
      const k = v.rate / 100;
      const guess = v._amts?.find((a) => Math.abs(a - total * k / (1 + k)) < 0.03) ?? v.tax;
      if (guess !== undefined && vat.size === 1) { v.tax = guess; v.gross = total; v.net = r2(total - guess); }
    }
    delete v._amts;
  }
  const taxes = [...vat.values()].filter((v) => v.tax !== undefined).sort((a, b) => b.rate - a.rate);
  const taxSum = r2(taxes.reduce((s, v) => s + (v.tax || 0), 0));
  conf.vat = taxes.length ? (taxes.every((t) => t.net !== undefined) ? 'hoch' : 'mittel') : 'keine';

  const vatId = (all.match(/\b(DE)\s?(\d{3})\s?(\d{3})\s?(\d{3})\b/) || []).slice(1).join('') || '';
  const taxNo = (all.match(/(?:St\.?[-\s]?Nr\.?|Steuer[-\s]?(?:nummer|nr\.?))\s*:?\s*([\d/ ]{10,16}\d)/i) || [])[1]?.trim() || '';
  const numM = all.match(/(?:Rechnungs?[-\s]?(?:nr|nummer)|Beleg[-\s]?(?:nr|nummer)?|Bon[-\s]?(?:nr)?|Quittungs?[-\s]?nr|Invoice\s?(?:no|number)?)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,24})/i);
  const number = numM ? numM[1].replace(/[.:]$/, '') : '';
  let payment = '';
  if (/girocard|ec[- ]?karte|\bec\b|maestro|v pay/i.test(all)) payment = 'Karte (girocard)';
  else if (/visa|mastercard|amex|american express|kreditkarte/i.test(all)) payment = 'Kreditkarte';
  else if (/paypal/i.test(all)) payment = 'PayPal';
  else if (/überweisung|ueberweisung|iban/i.test(all)) payment = 'Überweisung';
  else if (/\bbar\b|gegeben|rückgeld|rueckgeld/i.test(all)) payment = 'bar';

  const t19 = taxes.find((t) => t.rate === 19 || t.rate === 16);
  const t7 = taxes.find((t) => t.rate === 7 || t.rate === 5);
  const net = total !== null ? r2(total - taxSum) : null;
  return {
    merchant, date, number, total, net,
    tax19: t19?.tax ?? null, tax7: t7?.tax ?? null,
    taxes, vatId, taxNo, payment, conf,
  };
}
