// Rechner: MwSt, Skonto, Reisepauschalen, Kleinunternehmer
import { $, money, dec, parseNum, round2, PAUSCHALE } from './common.js?v=dd1f3874';
const row = (k, v, hl) => `<div${hl ? ' class="hl"' : ''}><span>${k}</span><b>${v}</b></div>`;
const chipVal = (form, sel) => form.querySelector(`${sel} [aria-pressed="true"]`)?.dataset.v;
function chips(form, sel, cb) {
  form.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
    form.querySelectorAll(`${sel} button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); cb();
  }));
}

/* MwSt */
const mw = $('#mwst');
function mwst() {
  const f = mw.elements;
  const other = f.rate.value === 'x';
  mw.querySelector('[data-other]').hidden = !other;
  const rate = other ? parseNum(f.other.value) : Number(f.rate.value);
  const a = parseNum(f.amount.value);
  const gross = chipVal(mw, '[data-dir]') === 'gross';
  const net = gross ? round2(a / (1 + rate / 100)) : a;
  const br = gross ? a : round2(a * (1 + rate / 100));
  mw.querySelector('[data-out]').innerHTML = row('Netto', money(net), !gross) + row(`Umsatzsteuer ${dec(rate)} %`, money(round2(br - net))) + row('Brutto', money(br), gross);
}
chips(mw, '[data-dir]', mwst); mw.addEventListener('input', mwst);

/* Skonto */
const sk = $('#skonto');
function skonto() {
  const f = sk.elements;
  const a = parseNum(f.amount.value), p = parseNum(f.pct.value), fast = Number(f.fast.value), due = Number(f.due.value);
  const save = round2(a * p / 100);
  const days = due - fast;
  const rate = days > 0 && p < 100 ? (p / (100 - p)) * (360 / days) * 100 : null;
  sk.querySelector('[data-out]').innerHTML = row('Skontobetrag', money(save)) + row(`Zahlbetrag bis Tag ${fast}`, money(round2(a - save)), true)
    + row('Effektiver Jahreszins', rate !== null ? `${dec(rate, 1)} %` : '–')
    + (rate !== null ? `<div class="verdict-line${rate < 10 ? ' is-warn' : ''}" style="border-bottom:0">${rate >= 10 ? 'Skonto ziehen lohnt sich: Das ist teurer als fast jeder Kredit.' : 'Geringer Vorteil. Früh zahlen lohnt sich nur, wenn das Geld ohnehin da ist.'}</div>` : '');
}
sk.addEventListener('input', skonto);

/* Reise */
const re = $('#reise');
function reise() {
  const f = re.elements;
  const multi = chipVal(re, '[data-kind]') === 'multi';
  re.querySelector('[data-day]').hidden = multi;
  re.querySelector('[data-multi]').hidden = !multi;
  let base, label;
  if (multi) {
    const d = Math.max(2, Number(f.days.value) || 2);
    base = 2 * PAUSCHALE.day + (d - 2) * PAUSCHALE.full;
    label = `2 × 14 € + ${d - 2} × 28 €`;
  } else {
    const h = Number(f.hours.value) || 0;
    base = h > 8 ? PAUSCHALE.day : 0;
    label = h > 8 ? 'über 8 Stunden' : '8 Stunden oder weniger';
  }
  const cut = Number(f.b.value) * PAUSCHALE.breakfast + (Number(f.l.value) + Number(f.d.value)) * PAUSCHALE.meal;
  const meals = Math.max(0, round2(base - cut));
  const km = round2((Number(f.km.value) || 0) * PAUSCHALE.km);
  re.querySelector('[data-out]').innerHTML = row(`Verpflegung (${label})`, money(base)) + (cut ? row('Kürzung gestellte Mahlzeiten', `−${money(Math.min(cut, base))}`) : '')
    + row(`Fahrtkosten (${dec(Number(f.km.value) || 0)} km × 0,30 €)`, money(km)) + row('Erstattungsfähig gesamt', money(round2(meals + km)), true);
}
chips(re, '[data-kind]', reise); re.addEventListener('input', reise);

/* Kleinunternehmer */
const ku = $('#ku');
function kleinunternehmer() {
  const f = ku.elements;
  const prev = parseNum(f.prev.value), cur = parseNum(f.cur.value), isNew = f.new.checked;
  f.prev.disabled = isNew;
  let cls = '', msg;
  if (isNew) {
    msg = cur <= 25000 ? 'Du kannst im Gründungsjahr Kleinunternehmer sein, solange dein Umsatz 25.000 € nicht übersteigt.'
      : 'Im Gründungsjahr liegt die Grenze bei 25.000 €. Mit dem Umsatz, der sie überschreitet, endet die Kleinunternehmerregelung.';
    if (cur > 25000) cls = ' is-err';
  } else if (prev > 25000) {
    cls = ' is-err';
    msg = 'Dein Vorjahresumsatz liegt über 25.000 €. Die Kleinunternehmerregelung gilt dieses Jahr nicht, du musst Umsatzsteuer ausweisen.';
  } else if (cur > 100000) {
    cls = ' is-err';
    msg = 'Die 100.000-€-Grenze wird überschritten. Ab dem Umsatz, mit dem du sie überschreitest, gilt die Regelbesteuerung.';
  } else if (cur > 25000) {
    cls = ' is-warn';
    msg = 'Dieses Jahr bleibst du Kleinunternehmer. Da du voraussichtlich über 25.000 € kommst, gilt die Regelung im nächsten Jahr aber nicht mehr.';
  } else {
    msg = 'Du kannst Kleinunternehmer sein, dieses Jahr und voraussichtlich auch im nächsten.';
  }
  ku.querySelector('[data-out]').innerHTML = `<div class="calc-out">${row('Vorjahr', isNew ? '–' : money(prev))}${row('Laufendes Jahr', money(cur))}</div><div class="verdict-line${cls}">${msg}</div>`;
}
ku.addEventListener('input', kleinunternehmer);

mwst(); skonto(); reise(); kleinunternehmer();
