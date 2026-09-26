// Bilder zu PDF
import { $, esc } from './common.js?v=dd1f3874';
import { pdflib, imageCanvas, addImagePage, savePdf, setupDrop, isImage, safeName, status } from './pdfkit.js?v=78b28a4a';

let items = []; // { name, canvas, thumb }
const st = status($('#status'));

async function add(files) {
  $('#desk').hidden = false;
  for (const f of files) {
    try {
      const canvas = await imageCanvas(f, 3000);
      const t = document.createElement('canvas');
      t.width = 120; t.height = Math.round(canvas.height * 120 / canvas.width);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      items.push({ name: f.name, canvas, thumb: t.toDataURL('image/jpeg', 0.7) });
      render();
    } catch { st.set(`${f.name} konnte nicht gelesen werden (Format nicht unterstützt?)`, 'err'); }
  }
}
function render() {
  $('#list').innerHTML = items.map((it, i) => `<li class="fitem"><div class="fitem__th" style="background-image:url(${it.thumb})"></div>
    <div style="min-width:0"><div class="fitem__name">${i + 1}. ${esc(it.name)}</div><div class="fitem__info">${it.canvas.width} × ${it.canvas.height} px</div></div>
    <div class="fitem__acts"><button type="button" data-up="${i}" aria-label="Nach oben" ${i ? '' : 'disabled'}>↑</button><button type="button" data-down="${i}" aria-label="Nach unten" ${i < items.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="del" data-del="${i}" aria-label="Entfernen">✕</button></div></li>`).join('');
  $('#save').disabled = !items.length;
}
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const i = Number(b.dataset.up ?? b.dataset.down ?? b.dataset.del);
  if ('up' in b.dataset) [items[i - 1], items[i]] = [items[i], items[i - 1]];
  if ('down' in b.dataset) [items[i + 1], items[i]] = [items[i], items[i + 1]];
  if ('del' in b.dataset) items.splice(i, 1);
  render();
});
$('#save').addEventListener('click', async () => {
  const { PDFDocument } = await pdflib();
  const d = await PDFDocument.create();
  const size = $('#size').value, margin = Number($('#margin').value), quality = Number($('#quality').value);
  for (const [i, it] of items.entries()) {
    st.set(`Bild ${i + 1} von ${items.length} …`);
    await addImagePage(d, it.canvas, { fit: size === 'image' ? 'image' : 'a4', landscape: size === 'a4-auto' ? 'auto' : size === 'a4-land', margin, quality, dpi: 200 });
  }
  st.clear();
  await savePdf(d, `${safeName($('#fname').value)}.pdf`);
});
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: add, accept: isImage });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
