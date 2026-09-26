// 02 · Aufbewahrungsfristen
import { $, $$, esc } from './common.js?v=dd1f3874';

// Stand: Rechtslage ab 1.1.2025 (BEG IV)
const CATS = [
  { group: 'Unternehmen', id: 'buchung', name: 'Buchungsbelege', ex: 'Rechnungen, Quittungen, Kontoauszüge, Lieferscheine mit Buchungsbezug, Kassenbons', years: 8, law: '§ 147 Abs. 1 Nr. 4, Abs. 3 AO · § 257 Abs. 1 Nr. 4, Abs. 4 HGB · § 14b UStG' },
  { group: 'Unternehmen', id: 'buecher', name: 'Bücher & Abschlüsse', ex: 'Journale, Kassenbuch, Inventare, Jahresabschlüsse, Lageberichte, Eröffnungsbilanz', years: 10, law: '§ 147 Abs. 1 Nr. 1, Abs. 3 AO · § 257 Abs. 1 Nr. 1, Abs. 4 HGB' },
  { group: 'Unternehmen', id: 'orga', name: 'Organisationsunterlagen', ex: 'Arbeitsanweisungen, Verfahrensdokumentation zur Buchführung', years: 10, law: '§ 147 Abs. 1 Nr. 1 AO · § 257 Abs. 1 Nr. 1 HGB' },
  { group: 'Unternehmen', id: 'briefe', name: 'Handels- & Geschäftsbriefe', ex: 'Empfangene und versandte Briefe und E-Mails, angenommene Angebote, Auftragsbestätigungen', years: 6, law: '§ 147 Abs. 1 Nr. 2, 3 AO · § 257 Abs. 1 Nr. 2, 3 HGB' },
  { group: 'Unternehmen', id: 'lohn', name: 'Lohnunterlagen', ex: 'Lohnkonten und dazugehörige Belege (ab letzter Eintragung)', years: 6, law: '§ 41 Abs. 1 S. 9 EStG' },
  { group: 'Unternehmen', id: 'sonstige', name: 'Sonstige steuerrelevante Unterlagen', ex: 'Unterlagen, die für die Besteuerung von Bedeutung sind (z. B. Kalkulationen, Preislisten)', years: 6, law: '§ 147 Abs. 1 Nr. 5, Abs. 3 AO' },
  { group: 'Privat', id: 'handwerker', name: 'Handwerkerrechnungen (privat)', ex: 'Rechnungen über Arbeiten an Haus oder Grundstück, z. B. Handwerker, Gartenbau, Reinigung', years: 2, law: '§ 14b Abs. 1 S. 5 UStG' },
  { group: 'Privat', id: 'ueberschuss', name: 'Private Belege bei hohen Einkünften', ex: 'Wenn Überschusseinkünfte (z. B. Miete, Kapital) über 500.000 € im Jahr liegen', years: 6, law: '§ 147a AO' },
];

const now = new Date();
const thisYear = now.getFullYear();
const state = { cat: 'buchung', year: thisYear - 8, plan: thisYear };

// Frist endet am 31.12. von (Jahr + Jahre); Vernichtung ab 1.1. des Folgejahres
const freeFrom = (year, years) => year + years + 1;

function renderCats() {
  let html = '', group = '';
  for (const c of CATS) {
    if (c.group !== group) { group = c.group; html += `<div class="cats__group">${esc(group)}</div>`; }
    html += `<label class="cat"><input type="radio" name="cat" value="${c.id}" ${c.id === state.cat ? 'checked' : ''}>
      <span><b>${esc(c.name)}</b><small>${esc(c.ex)}</small></span>
      <span class="cat__y">${c.years}<span>JAHRE</span></span></label>`;
  }
  $('#cats').innerHTML = html;
}

function renderVerdict() {
  const c = CATS.find((x) => x.id === state.cat);
  const y = Number(state.year);
  const from = freeFrom(y, c.years);
  const may = thisYear >= from;
  const left = from - thisYear;

  $('#vK').textContent = `${c.name} aus ${y}`;
  if (y > thisYear) {
    $('#vBig').innerHTML = 'Dieses Jahr liegt <em>in der Zukunft.</em>';
    $('#vSub').textContent = 'Wähle das Jahr, in dem der Beleg entstanden ist.';
    $('#vStamp').innerHTML = '';
  } else if (may) {
    $('#vBig').innerHTML = 'Ja, der darf <em>weg.</em>';
    $('#vSub').innerHTML = `Die Aufbewahrungsfrist ist am <b>31.12.${from - 1}</b> abgelaufen. Seit dem 1.1.${from} darfst du diese Unterlagen aus ${y} vernichten, sofern keine Ablaufhemmung besteht.`;
    $('#vStamp').innerHTML = '<span class="stamp stamp--in">Freigegeben<small>zur Vernichtung</small></span>';
  } else {
    $('#vBig').innerHTML = `Aufheben bis <em>31.12.${from - 1}</em>`;
    $('#vSub').innerHTML = `Noch <b>${left} Jahreswechsel</b>. Ab dem <b>1.1.${from}</b> darfst du diese Unterlagen aus ${y} vernichten.`;
    $('#vStamp').innerHTML = '<span class="stamp stamp--in stamp--err">Aufbewahren<small>Frist läuft</small></span>';
  }
  $('#vLaw').textContent = `Frist: ${c.years} Jahre · ${c.law}`;
  renderRuler(y, from);
}

function renderRuler(y, from) {
  const start = Math.min(y, thisYear) - 1;
  const end = Math.max(from, thisYear) + 2;
  const span = end - start;
  const pct = (v) => ((v - start) / span) * 100;
  const keep = $('#rKeep'), free = $('#rFree'), nowEl = $('#rNow');
  keep.style.left = pct(y) + '%';
  keep.style.width = (pct(from) - pct(y)) + '%';
  free.style.left = pct(from) + '%';
  free.style.width = (100 - pct(from)) + '%';
  const nowPos = thisYear + (now.getMonth() + now.getDate() / 31) / 12;
  nowEl.style.left = pct(nowPos) + '%';
  nowEl.dataset.label = 'HEUTE';
  const step = span > 16 ? 2 : 1;
  let ticks = '';
  for (let t = start + 1; t <= end; t += step) ticks += `<span style="left:${pct(t)}%">${t}</span>`;
  $('#ticks').innerHTML = ticks;
}

function renderPlan() {
  const py = Number(state.plan);
  $('#planYearLabel').textContent = `${py}`;
  const years = [];
  for (let y = py - 11; y <= py; y++) years.push(y);
  const check = '<svg viewBox="0 0 14 14" fill="none"><path d="m3 7.4 2.6 2.6L11 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let html = `<thead><tr><th scope="col">Belegart</th>${years.map((y) => `<th scope="col">${y}</th>`).join('')}</tr></thead><tbody>`;
  for (const c of CATS) {
    html += `<tr><th scope="row">${esc(c.name)}<small>${c.years} Jahre</small></th>`;
    for (const y of years) {
      const from = freeFrom(y, c.years);
      const sel = c.id === state.cat && y === Number(state.year) ? ' is-sel' : '';
      let cell;
      if (py >= from) cell = `<span class="cell cell--go" title="${c.name} ${y}: darf ${py} vernichtet werden">${check}</span>`;
      else if (from - py === 1) cell = `<span class="cell cell--last" title="${c.name} ${y}: ab 1.1.${from}">${String(from).slice(2)}</span>`;
      else cell = `<span class="cell cell--keep" title="${c.name} ${y}: aufbewahren bis 31.12.${from - 1}">${String(from).slice(2)}</span>`;
      html += `<td class="${sel}">${cell}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  $('#matrix').innerHTML = html;
}

function update() {
  renderVerdict();
  renderPlan();
  try { history.replaceState(null, '', `#${state.cat}-${state.year}`); } catch { /* egal */ }
}

// Start – ggf. aus Adresse (#buchung-2017)
const m = location.hash.match(/^#([a-z]+)-(\d{4})$/);
if (m && CATS.some((c) => c.id === m[1])) { state.cat = m[1]; state.year = Number(m[2]); }

$('#year').value = state.year;
$('#planYear').value = state.plan;
renderCats();
update();

$('#cats').addEventListener('change', (e) => { if (e.target.name === 'cat') { state.cat = e.target.value; update(); } });
$('#year').addEventListener('input', (e) => { const v = Number(e.target.value); if (v >= 1990 && v <= 2100) { state.year = v; update(); } });
$('#planYear').addEventListener('input', (e) => { const v = Number(e.target.value); if (v >= 2000 && v <= 2100) { state.plan = v; renderPlan(); } });
$$('[data-step]').forEach((b) => b.addEventListener('click', () => { state.year += Number(b.dataset.step); $('#year').value = state.year; update(); }));
$$('[data-plan]').forEach((b) => b.addEventListener('click', () => { state.plan += Number(b.dataset.plan); $('#planYear').value = state.plan; renderPlan(); }));
$('#matrix').addEventListener('click', (e) => {
  const td = e.target.closest('td');
  if (!td) return;
  const row = td.parentElement, col = [...row.children].indexOf(td);
  const catIdx = [...row.parentElement.children].indexOf(row);
  state.cat = CATS[catIdx].id;
  state.year = Number(state.plan) - 11 + (col - 1);
  $('#year').value = state.year;
  renderCats();
  update();
  $('.verdict').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
