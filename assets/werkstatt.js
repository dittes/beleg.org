// 03 · Belegwerkstatt
import { $, $$, esc, money, parseNum, round2, fmtDate, todayISO, amountInWords, store, formData, fillForm, debounce } from './common.js?v=dd1f3874';

const type = document.body.dataset.vtype || 'eigen';
const KEY = (t) => `beleg:werkstatt:${t}`;
const forms = Object.fromEntries($$('.pane').map((f) => [f.dataset.pane, f]));

const v = (s, ph = '—') => (String(s ?? '').trim() ? esc(s) : `<span class="d-empty">${ph}</span>`);
const row = (k, val, ph) => `<div class="d-row"><dt>${k}</dt><dd>${v(val, ph)}</dd></div>`;
const meta = (pairs) => `<dl class="d-meta">${pairs.map(([k, val]) => `<div><dt>${k}</dt><dd>${v(val)}</dd></div>`).join('')}</dl>`;
const sign = (left, right) => `<div class="d-sign"><div><b>${left}</b>Ort, Datum</div><div><b></b>${right}</div></div>`;
const foot = (label) => `<div class="d-foot"><span>${label}</span><span>erstellt mit beleg.org</span></div>`;
const place = (d) => [d.place, d.created || d.date ? fmtDate(d.created || d.date) : ''].filter(Boolean).map(esc).join(', ');

const RENDER = {
  eigen(d) {
    const amt = parseNum(d.amount);
    return `
      <header class="d-head">
        <div><span class="d-kind">Ersatzbeleg</span><h2 class="d-title">Eigen<em>beleg</em></h2>
          <p class="d-from">${v(d.aName, 'Name / Firma')}<br>${v(d.aAddr, 'Anschrift')}</p></div>
        ${meta([['Beleg-Nr.', d.nr], ['Ausgabe am', d.date ? fmtDate(d.date) : ''], ['Zahlung', d.method]])}
      </header>
      <dl class="d-rows">
        ${row('Zahlungsempfänger', d.payee, 'Name und Anschrift des Empfängers')}
        ${row('Art der Ausgabe', d.purpose, 'Was wurde bezahlt, und warum war es betrieblich?')}
        ${row('Grund', [d.reason, d.extra].filter(Boolean).join(' – '))}
      </dl>
      <div class="d-amount"><div><span class="d-amount__k">Betrag (brutto)</span><div class="d-amount__words">${amt ? esc(amountInWords(amt)) : '&nbsp;'}</div></div><div class="d-amount__v">${money(amt)}</div></div>
      <p class="d-hint">Ich versichere, dass die Ausgabe in der genannten Höhe betrieblich veranlasst war und kein anderer Beleg zu erhalten ist. Aus diesem Eigenbeleg wird keine Vorsteuer geltend gemacht.</p>
      ${sign(place(d), 'Unterschrift Aussteller')}
      ${foot('Eigenbeleg')}`;
  },
  bewirtung(d) {
    const amt = parseNum(d.amount), tip = parseNum(d.tip), total = round2(amt + tip);
    const guests = String(d.guests || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return `
      <header class="d-head">
        <div><span class="d-kind">Nachweis nach § 4 Abs. 5 Nr. 2 EStG</span><h2 class="d-title">Bewirtungs<em>beleg</em></h2>
          <p class="d-from">${v(d.host, 'Bewirtende Person / Firma')}</p></div>
        ${meta([['Beleg-Nr.', d.nr], ['Tag', d.date ? fmtDate(d.date) : ''], ['Personen', guests.length ? String(guests.length) : '']])}
      </header>
      <dl class="d-rows">
        ${row('Ort der Bewirtung', d.venue, 'Name und Anschrift des Restaurants')}
        ${row('Anlass', d.occasion, 'Konkreter geschäftlicher Anlass')}
        <div class="d-row"><dt>Teilnehmende</dt><dd>${guests.length ? `<ol class="d-list">${guests.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>` : '<span class="d-empty">Alle Personen inkl. Bewirtender</span>'}</dd></div>
      </dl>
      <table class="d-split">
        <tr><td>Betrag laut Rechnung</td><td>${money(amt)}</td></tr>
        <tr><td>Trinkgeld</td><td>${money(tip)}</td></tr>
        <tr><td>Aufwendungen gesamt</td><td>${money(total)}</td></tr>
      </table>
      <div class="d-attach">Rechnung des Restaurants<br>hier anheften</div>
      ${sign(place(d), 'Unterschrift Bewirtende Person')}
      ${foot('Bewirtungsbeleg')}`;
  },
  quittung(d) {
    const gross = parseNum(d.amount);
    const rate = d.ku ? 0 : Number(d.rate);
    const net = round2(gross / (1 + rate / 100)), tax = round2(gross - net);
    return `
      <header class="d-head">
        <div><span class="d-kind">Zahlungsbestätigung</span><h2 class="d-title"><em>Quittung</em></h2>
          <p class="d-from">${v(d.issuer, 'Empfänger mit Anschrift')}${d.taxid ? `<br>St.-Nr./USt-IdNr. ${esc(d.taxid)}` : ''}</p></div>
        ${meta([['Nr.', d.nr], ['Datum', d.date ? fmtDate(d.date) : ''], ['Zahlung', 'bar']])}
      </header>
      <div class="d-amount"><div><span class="d-amount__k">Betrag</span><div class="d-amount__words">${gross ? esc(amountInWords(gross)) : '&nbsp;'}</div></div><div class="d-amount__v">${money(gross)}</div></div>
      <table class="d-split">
        ${d.ku ? `<tr><td>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</td><td></td></tr>` : `
        <tr><td>Nettobetrag</td><td>${money(net)}</td></tr>
        <tr><td>zzgl. ${rate} % Umsatzsteuer</td><td>${money(tax)}</td></tr>`}
        <tr><td>Gesamtbetrag</td><td>${money(gross)}</td></tr>
      </table>
      <dl class="d-rows">
        ${row('Erhalten von', d.payer, 'Name und Anschrift')}
        ${row('Für', d.purpose, 'Leistung oder Ware')}
      </dl>
      <p class="d-hint">Den oben genannten Betrag habe ich in bar erhalten.</p>
      ${sign(place(d), 'Stempel / Unterschrift Empfänger')}
      ${foot('Quittung')}`;
  },
};

function calcHelpers(d) {
  if (type === 'bewirtung') {
    const total = round2(parseNum(d.amount) + parseNum(d.tip));
    $('#bwTotal').textContent = money(total);
    $('#bw70').textContent = money(round2(total * 0.7));
    $('#bw30').textContent = money(round2(total - round2(total * 0.7)));
  }
  if (type === 'quittung') {
    const gross = parseNum(d.amount), rate = d.ku ? 0 : Number(d.rate);
    const net = round2(gross / (1 + rate / 100));
    $('#qNet').textContent = money(net);
    $('#qTax').textContent = money(round2(gross - net));
    $('#qGross').textContent = money(gross);
    forms.quittung.elements.rate.disabled = !!d.ku;
  }
}

function render() {
  const d = formData(forms[type]);
  $('#doc').innerHTML = RENDER[type](d);
  calcHelpers(d);
  fit();
}
const save = debounce(() => store.set(KEY(type), formData(forms[type])), 300);

// A4 in die Vorschaufläche einpassen
function fit() {
  const box = $('#fit'), doc = $('#doc');
  const s = Math.min(1, box.clientWidth / doc.offsetWidth);
  doc.style.transform = `scale(${s})`;
  box.style.height = `${doc.offsetHeight * s}px`;
}
new ResizeObserver(fit).observe($('#fit'));


// Start: gespeicherte Entwürfe laden, Datumsfelder vorbelegen
for (const [k, f] of Object.entries(forms)) {
  const saved = store.get(KEY(k));
  if (saved) fillForm(f, saved);
  for (const el of f.querySelectorAll('input[type="date"]')) if (!el.value) el.value = todayISO();
  f.addEventListener('input', () => { render(); save(); });
  f.addEventListener('change', () => { render(); save(); });
}
$('#print').addEventListener('click', () => window.print());
$('#reset').addEventListener('click', () => {
  forms[type].reset();
  for (const el of forms[type].querySelectorAll('input[type="date"]')) el.value = todayISO();
  store.del(KEY(type));
  render();
});
render();
document.fonts?.ready.then(fit);
