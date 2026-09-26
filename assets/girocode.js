// GiroCode (EPC-QR) erstellen
import { $, esc, money, parseNum, fmtIban, formData, fillForm, store, download, debounce } from './common.js?v=dd1f3874';
import { qrMatrix, qrSvg, epcPayload, epcErrors } from './qr.js?v=ff898161';

const KEY = 'beleg:girocode';
const form = $('#form');
let svg = '';

async function update() {
  const f = formData(form);
  const data = { name: f.name, iban: f.iban, bic: f.bic, amount: f.amount ? parseNum(f.amount) : null, purpose: f.purpose };
  const errs = epcErrors(data);
  const ready = f.name.trim() && f.iban.trim();
  $('#err').hidden = !(ready && errs.length);
  $('#err').textContent = errs.join(' · ');
  if (!ready || errs.length) {
    $('#qr').innerHTML = '<p class="small">Name und IBAN eingeben</p>';
    $('#sum').textContent = '';
    $('#png').disabled = $('#svg').disabled = true;
    return;
  }
  svg = qrSvg(await qrMatrix(epcPayload(data), 'M'), { size: 560, label: 'GiroCode' });
  $('#qr').innerHTML = svg;
  $('#sum').innerHTML = `${esc(f.name)} · <span class="mono">${esc(fmtIban(f.iban))}</span>${data.amount ? `<br><b>${money(data.amount)}</b>` : ''}${f.purpose ? ` · ${esc(f.purpose)}` : ''}`;
  $('#png').disabled = $('#svg').disabled = false;
}
const save = debounce(() => store.set(KEY, formData(form)), 400);

$('#svg').addEventListener('click', () => download('girocode.svg', svg, 'image/svg+xml'));
$('#png').addEventListener('click', async () => {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 1000;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, 1000, 1000);
  c.toBlob((b) => download('girocode.png', b), 'image/png');
});
form.addEventListener('input', () => { update(); save(); });
fillForm(form, store.get(KEY));
update();
