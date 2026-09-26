// QR Code Scanner
import { $, esc, download } from './common.js?v=dd1f3874';
import { createDecoder, cameraScanner, fileCanvas, beep } from './codescan.js?v=fee473fe';
import { parseQr } from './qrparse.js?v=9c934c33';

const hist = [];
let decoder, scanner, cams = [];

async function ready() {
  decoder ??= await createDecoder(['qr_code']);
  $('#engine').textContent = `Erkennung: ${decoder.engine === 'nativ' ? 'Browser (schnell)' : 'ZXing'}`;
  return decoder;
}

function show(value) {
  const r = parseQr(value);
  $('#result').innerHTML = `<span class="qr-card__type">${esc(r.title)}</span>
    <h3>${esc(r.type === 'url' ? r.fields[0][1] : (r.fields[0]?.[1] || value).slice(0, 120))}</h3>
    <dl class="kv">${r.fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
    <div style="margin-top:10px">${r.actions.map((a, i) => `<button class="btn ${i ? 'btn--ghost' : ''}" type="button" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  $('#result').onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = r.actions[Number(b.dataset.a)];
    if (a.kind === 'copy') { try { await navigator.clipboard.writeText(a.value); b.textContent = 'Kopiert ✓'; } catch { prompt('Zum Kopieren:', a.value); } }
    if (a.kind === 'open') window.open(a.value, '_blank', 'noopener,noreferrer');
    if (a.kind === 'file') download(a.name, a.value, a.mime);
  };
  return r;
}
function add(value) {
  const r = show(value);
  hist.unshift({ value, title: r.title, at: new Date() });
  renderHist();
  $('#cam').classList.add('is-hit');
  setTimeout(() => $('#cam').classList.remove('is-hit'), 600);
}
function renderHist() {
  $('#hist').innerHTML = hist.map((h, i) => `<li data-i="${i}"><b>${esc(h.title)}</b><span>${esc(h.value)}</span><time>${h.at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time></li>`).join('') || '<li style="cursor:default"><span></span><span class="small">Leer</span><span></span></li>';
}

async function start(deviceId) {
  try {
    await ready();
    scanner ??= cameraScanner({
      video: $('#video'), decoder,
      onResult: (r) => { beep(); add(r.value); },
      onState: (s) => {
        const on = s === 'running';
        $('#cam').classList.toggle('is-off', !on);
        $('#camStart').hidden = on; $('#camTools').hidden = !on; $('#camHint').hidden = !on;
      },
    });
    await scanner.start(deviceId);
    $('#torch').hidden = !scanner.torchSupported();
    cams = await scanner.cameras();
    $('#switch').hidden = cams.length < 2;
  } catch (e) {
    $('#camNote').textContent = e.name === 'NotAllowedError' ? 'Kein Kamerazugriff erlaubt. Du kannst stattdessen ein Bild wählen.' : 'Keine Kamera gefunden. Du kannst stattdessen ein Bild wählen.';
  }
}
async function fromFile(file) {
  if (!file?.type.startsWith('image/')) return;
  await ready();
  const res = await decoder.decode(await fileCanvas(file));
  if (res.length) add(res[0].value);
  else $('#result').innerHTML = '<p class="qr-empty">In diesem Bild wurde kein QR-Code gefunden. Tipp: Bild zuschneiden, sodass der Code größer ist.</p>';
}

$('#start').addEventListener('click', () => start());
$('#stop').addEventListener('click', () => scanner?.stop());
$('#switch').addEventListener('click', () => { const i = cams.findIndex((c) => c.deviceId === scanner.currentId()); start(cams[(i + 1) % cams.length].deviceId); });
$('#torch').addEventListener('click', async (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; try { await scanner.torch(on); e.currentTarget.setAttribute('aria-pressed', String(on)); } catch { /* nicht unterstützt */ } });
$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => { fromFile(e.target.files[0]); e.target.value = ''; });
$('#hist').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) show(hist[Number(li.dataset.i)].value); });
$('#clear').addEventListener('click', () => { hist.length = 0; renderHist(); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); fromFile(e.dataTransfer?.files?.[0]); });
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) fromFile(f); });
window.addEventListener('pagehide', () => scanner?.stop());
renderHist();
ready();
