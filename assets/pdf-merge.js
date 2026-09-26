// PDF zusammenfügen & teilen
import { $, esc } from './common.js?v=dd1f3874';
import { pdflib, openPdf, renderPage, imageCanvas, addImagePage, savePdf, downloadZip, setupDrop, isPdf, isImage, baseName, safeName, status } from './pdfkit.js?v=78b28a4a';

const COLORS = ['#1b3fd1', '#e0662c', '#159b6b', '#a23fd1', '#c9a100', '#d1335b', '#2c9ad1', '#6b7a99'];
const files = [];   // { name, kind, bytes, canvas, color, libDoc }
let pages = [];     // { id, f, idx, rot, thumb, w, h }
const selected = new Set();
let uid = 0;
const st = status($('#status'));

async function addFiles(list) {
  $('#desk').hidden = false;
  for (const file of list) {
    try {
      const fi = files.length;
      const color = COLORS[fi % COLORS.length];
      if (isPdf(file)) {
        st.set(`${file.name} wird gelesen …`);
        const { doc, bytes } = await openPdf(file);
        files.push({ name: file.name, kind: 'pdf', bytes, color });
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const { canvas } = await renderPage(page, { width: 260 });
          pages.push({ id: ++uid, f: fi, idx: i - 1, rot: 0, thumb: canvas.toDataURL('image/jpeg', 0.75) });
          if (i % 4 === 0) { render(); st.set(`${file.name}: Seite ${i} von ${doc.numPages}`); }
        }
      } else if (isImage(file)) {
        const canvas = await imageCanvas(file, 3000);
        files.push({ name: file.name, kind: 'image', canvas, color });
        const t = document.createElement('canvas');
        t.width = 260; t.height = Math.round(canvas.height * 260 / canvas.width);
        t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
        pages.push({ id: ++uid, f: fi, idx: 0, rot: 0, thumb: t.toDataURL('image/jpeg', 0.75) });
      }
    } catch (e) {
      st.set(`${file.name}: ${e.message}`, 'err');
      await new Promise((r) => setTimeout(r, 1500));
    }
    render();
  }
  if (files[0] && $('#fname').value === 'zusammengefuegt' && files.length === 1) $('#fname').value = baseName(files[0].name) + '_bearbeitet';
  st.clear();
}

function render() {
  $('#legend').innerHTML = files.map((f) => `<span><i class="pcard__src" style="background:${f.color}"></i>${esc(f.name)}</span>`).join('');
  $('#grid').innerHTML = pages.map((p, i) => `
    <div class="pcard${selected.has(p.id) ? ' is-sel' : ''}" draggable="true" data-id="${p.id}">
      <input class="pcard__chk" type="checkbox" data-sel="${p.id}" ${selected.has(p.id) ? 'checked' : ''} aria-label="Seite ${i + 1} auswählen">
      <div class="pcard__img"><img src="${p.thumb}" alt="Seite ${i + 1}" style="transform:rotate(${p.rot}deg)${p.rot % 180 ? ';max-width:77%' : ''}"></div>
      <div class="pcard__meta"><span style="display:flex;gap:6px;align-items:center"><i class="pcard__src" style="background:${files[p.f].color}"></i><b>${i + 1}</b></span>
        <span class="pcard__acts">
          <button type="button" data-mv="-1" aria-label="Nach links">←</button><button type="button" data-mv="1" aria-label="Nach rechts">→</button>
          <button type="button" data-rot aria-label="Drehen">↻</button><button type="button" class="del" data-del aria-label="Löschen">✕</button>
        </span></div>
    </div>`).join('');
  $('#nPages').textContent = pages.length;
  $('#nFiles').textContent = files.length;
  $('#nSel').textContent = selected.size;
  $('#saveSel').disabled = $('#delSel').disabled = !selected.size;
  $('#saveAll').disabled = !pages.length;
}

/* ————— Interaktion ————— */
$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.pcard'); if (!card) return;
  const id = Number(card.dataset.id), i = pages.findIndex((p) => p.id === id);
  if (e.target.matches('[data-sel]')) { e.target.checked ? selected.add(id) : selected.delete(id); render(); return; }
  if (e.target.closest('[data-rot]')) { pages[i].rot = (pages[i].rot + 90) % 360; render(); }
  if (e.target.closest('[data-del]')) { pages.splice(i, 1); selected.delete(id); render(); }
  const mv = e.target.closest('[data-mv]');
  if (mv) { const j = i + Number(mv.dataset.mv); if (j >= 0 && j < pages.length) { [pages[i], pages[j]] = [pages[j], pages[i]]; render(); } }
});
let dragId = null;
$('#grid').addEventListener('dragstart', (e) => { const c = e.target.closest('.pcard'); if (!c) return; dragId = Number(c.dataset.id); c.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); });
$('#grid').addEventListener('dragend', () => { dragId = null; render(); });
$('#grid').addEventListener('dragover', (e) => {
  if (dragId === null) return;
  e.preventDefault();
  const c = e.target.closest('.pcard');
  for (const x of document.querySelectorAll('.pcard.is-target')) x.classList.remove('is-target');
  if (c && Number(c.dataset.id) !== dragId) c.classList.add('is-target');
});
$('#grid').addEventListener('drop', (e) => {
  if (dragId === null) return;
  e.preventDefault(); e.stopPropagation();
  const c = e.target.closest('.pcard'); if (!c) return;
  const from = pages.findIndex((p) => p.id === dragId);
  const [moved] = pages.splice(from, 1);
  let to = pages.findIndex((p) => p.id === Number(c.dataset.id));
  const r = c.getBoundingClientRect();
  if (e.clientX > r.left + r.width / 2) to++;
  pages.splice(to, 0, moved);
  dragId = null; render();
});
$('#selAll').addEventListener('click', () => { pages.forEach((p) => selected.add(p.id)); render(); });
$('#selNone').addEventListener('click', () => { selected.clear(); render(); });
$('#delSel').addEventListener('click', () => { pages = pages.filter((p) => !selected.has(p.id)); selected.clear(); render(); });

/* ————— Ausgabe ————— */
async function build(list) {
  const { PDFDocument, degrees } = await pdflib();
  const out = await PDFDocument.create();
  for (const [n, p] of list.entries()) {
    st.set(`Seite ${n + 1} von ${list.length} …`);
    const f = files[p.f];
    if (f.kind === 'pdf') {
      f.libDoc ??= await PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false });
      const [pg] = await out.copyPages(f.libDoc, [p.idx]);
      if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
      out.addPage(pg);
    } else {
      const pg = await addImagePage(out, f.canvas, { fit: 'a4', landscape: 'auto' });
      if (p.rot) pg.setRotation(degrees(p.rot));
    }
  }
  st.clear();
  return out;
}
const name = () => safeName($('#fname').value || 'dokument');
$('#saveAll').addEventListener('click', async () => savePdf(await build(pages), `${name()}.pdf`));
$('#saveSel').addEventListener('click', async () => savePdf(await build(pages.filter((p) => selected.has(p.id))), `${name()}_auswahl.pdf`));

async function saveGroups(groups, suffix) {
  if (!groups.length) return;
  if (groups.length === 1) return savePdf(await build(groups[0].pages), `${name()}_${groups[0].label}.pdf`);
  const entries = [];
  for (const g of groups) {
    const doc = await build(g.pages);
    doc.setProducer('beleg.org · pdf-lib');
    entries.push({ name: `${name()}_${g.label}.pdf`, data: await doc.save() });
  }
  await downloadZip(`${name()}_${suffix}.zip`, entries);
}
$('#split').addEventListener('click', async () => {
  const n = Math.max(1, Number($('#every').value) || 1);
  const groups = [];
  for (let i = 0; i < pages.length; i += n) groups.push({ label: n === 1 ? `s${i + 1}` : `s${i + 1}-${Math.min(i + n, pages.length)}`, pages: pages.slice(i, i + n) });
  await saveGroups(groups, 'aufgeteilt');
});
$('#extract').addEventListener('click', async () => {
  const groups = [];
  for (const part of $('#ranges').value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) { st.set(`„${part}“ ist kein gültiger Bereich`, 'err'); return; }
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    const sel = pages.slice(Math.max(0, Math.min(a, b) - 1), Math.max(a, b));
    if (sel.length) groups.push({ label: a === b ? `s${a}` : `s${a}-${b}`, pages: sel });
  }
  if (!groups.length) { st.set('Bitte Seitenbereiche angeben, z. B. 1-3, 5', 'err'); return; }
  await saveGroups(groups, 'bereiche');
});

const accept = (f) => isPdf(f) || isImage(f);
setupDrop({ zone: $('#drop'), input: $('#file'), onFiles: addFiles, accept });
$('#drop2').addEventListener('click', () => $('#file2').click());
$('#file2').addEventListener('change', (e) => { addFiles([...e.target.files].filter(accept)); e.target.value = ''; });
$('#pick').addEventListener('click', (e) => { e.stopPropagation(); $('#file').click(); });
