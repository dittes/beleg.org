// PDF zu Bildern
import { $, $$, download } from './common.js?v=dd1f3874';
import { openPdf, renderPage, canvasBlob, blobBytes, downloadZip, setupDrop, isPdf, baseName, status } from './pdfkit.js?v=78b28a4a';

let doc = null, name = 'dokument', fmt = 'jpg';
const st = status($('#status'));

async function open(file) {
  try {
    ({ doc } = await openPdf(file));
    name = baseName(file.name);
    $('#desk').hidden = false;
    $('#grid').innerHTML = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const { canvas } = await renderPage(await doc.getPage(i), { width: 200 });
      $('#grid').insertAdjacentHTML('beforeend', `<button type="button" class="pcard" data-i="${i}" style="cursor:pointer" title="Seite ${i} speichern"><div class="pcard__img"><img src="${canvas.toDataURL('image/jpeg', 0.7)}" alt="Seite ${i}"></div><div class="pcard__meta"><b>${i}</b><span>↓ ${fmt.toUpperCase()}</span></div></button>`);
    }
    $('#zip').disabled = false;
  } catch (e) { st.set(e.message, 'err'); $('#desk').hidden = false; }
}
async function pageImage(i) {
  const { canvas } = await renderPage(await doc.getPage(i), { scale: Number($('#dpi').value) / 72 });
  return canvasBlob(canvas, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
}
function pages() {
  const r = $('#range').value.trim();
  if (!r) return Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const set = new Set();
  for (const part of r.split(/[,;]+/)) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) continue;
    for (let i = Number(m[1]); i <= Number(m[2] || m[1]); i++) if (i >= 1 && i <= doc.numPages) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}
$('#grid').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-i]'); if (!c) return;
  const i = Number(c.dataset.i);
  download(`${name}_s${i}.${fmt}`, await pageImage(i));
});
$('#zip').addEventListener('click', async () => {
  const list = pages(), entries = [];
  for (const [n, i] of list.entries()) { st.set(`Seite ${n + 1} von ${list.length} …`); entries.push({ name: `${name}_s${String(i).padStart(2, '0')}.${fmt}`, data: await blobBytes(await pageImage(i)) }); }
  st.clear();
  if (entries.length === 1) download(entries[0].name, new Blob([entries[0].data]));
  else await downloadZip(`${name}_bilder.zip`, entries);
});
$$('#fmt button').forEach((b) => b.addEventListener('click', () => { fmt = b.dataset.f; $$('#fmt button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $$('.pcard__meta span').forEach((s) => { s.textContent = `↓ ${fmt.toUpperCase()}`; }); }));
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: (f) => open(f[0]), accept: isPdf });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
