// Leitweg-ID prüfen
import { $, esc } from './common.js?v=dd1f3874';
import { validate, checkDigits } from './leitweg.js?v=67765086';

function show() {
  const v = $('#id').value.trim();
  if (!v) { $('#res').innerHTML = '<p class="small" style="margin:0">Gib eine Leitweg-ID ein.</p>'; ['#pGrob', '#pFein', '#pPz'].forEach((s) => { $(s).textContent = '–'; }); return; }
  const r = validate(v);
  $('#pGrob').textContent = r.parts.grob || '–';
  $('#pFein').textContent = r.parts.fein || '–';
  $('#pPz').textContent = r.parts.pz || '–';
  $('#res').innerHTML = r.ok
    ? `<span class="stamp stamp--in">Gültig<small>Prüfziffer stimmt</small></span>
       <dl class="kv" style="margin-top:18px"><dt>Leitweg-ID</dt><dd class="mono">${esc(r.normalized)}</dd>${r.region ? `<dt>Bereich</dt><dd>${esc(r.region)}</dd>` : ''}</dl>`
    : `<span class="stamp stamp--in stamp--err">Ungültig<small>bitte prüfen</small></span>
       <ul style="margin:16px 0 0;padding-left:18px">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
       ${r.expected && r.parts.grob ? `<p style="margin:12px 0 0">Mit korrekter Prüfziffer: <b class="mono">${esc(r.normalized)}</b></p>` : ''}`;
}
$('#id').addEventListener('input', show);
$('#calc').addEventListener('click', () => {
  const raw = $('#id').value.trim().toUpperCase().replace(/\s+/g, '').replace(/-\d{2}$/, '').replace(/-$/, '');
  if (!/^\d{2,12}(-[A-Z0-9]{1,30})?$/.test(raw)) { $('#res').innerHTML = '<p style="margin:0">Bitte Grobadressierung (2–12 Ziffern) und optional Feinadressierung eingeben, z. B. <span class="mono">991-01234</span>.</p>'; return; }
  $('#id').value = `${raw}-${checkDigits(raw)}`;
  show();
});
$('#example').addEventListener('click', () => { $('#id').value = '04011000-1234512345-06'; show(); });
const q = new URLSearchParams(location.search).get('id');
if (q) { $('#id').value = q; show(); }
