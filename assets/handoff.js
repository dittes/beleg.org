// Übergabe von Dateien zwischen Werkzeugen (z. B. Scanner → Belege auslesen).
// Kurzzeitig in IndexedDB dieses Browsers, beim Abholen sofort gelöscht.
const DB = 'beleg-handoff', STORE = 'files';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}

export const handoff = {
  async put(files) {
    try { const db = await open(); await tx(db, 'readwrite', (s) => s.put(files, 'pending')); db.close(); return true; } catch { return false; }
  },
  async take() {
    try {
      const db = await open();
      const files = await tx(db, 'readonly', (s) => s.get('pending'));
      await tx(db, 'readwrite', (s) => s.delete('pending'));
      db.close();
      return files || [];
    } catch { return []; }
  },
};
