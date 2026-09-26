// Texterkennung (Tesseract, lokal) – gemeinsam für mehrere Werkzeuge.
const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;
let tessP, workerP, progress = () => {};

const loadScript = (src, global) => new Promise((res, rej) => {
  if (window[global]) return res(window[global]);
  const s = Object.assign(document.createElement('script'), { src, onload: () => res(window[global]), onerror: () => rej(new Error('Texterkennung konnte nicht geladen werden')) });
  document.head.append(s);
});

function worker() {
  return (workerP ??= (async () => {
    const T = await (tessP ??= loadScript(V('tesseract/tesseract.min.js'), 'Tesseract'));
    return T.createWorker('deu', 1, {
      workerPath: V('tesseract/worker.min.js'), corePath: V('tesseract/'), langPath: V('tesseract/lang'),
      logger: (m) => progress(m),
    });
  })());
}

/**
 * Erkennt Text in einem Bild/Canvas.
 * onProgress(0..1, text) – optional
 * Rückgabe: { text, words: [{ text, x0, y0, x1, y1 }] } in Bildpixeln
 */
export async function recognize(image, onProgress = () => {}) {
  progress = (m) => {
    if (m.status === 'recognizing text') onProgress(m.progress, 'Texterkennung');
    else if (m.status === 'loading language traineddata') onProgress(0, 'Sprachmodell wird geladen');
    else if (m.status) onProgress(0, 'Texterkennung wird vorbereitet');
  };
  const w = await worker();
  const { data } = await w.recognize(image);
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    if (wd.text?.trim()) words.push({ text: wd.text, conf: wd.confidence, ...wd.bbox });
  }
  return { text: data.text || '', words };
}

/** Kleine Fotos hochskalieren, große verkleinern, Graustufen + Kontrast – verbessert Tesseract. */
export async function prepare(source) {
  const bmp = source instanceof Blob ? await createImageBitmap(source, { imageOrientation: 'from-image' }) : source;
  const maxSide = Math.max(bmp.width, bmp.height);
  const scale = maxSide < 1400 ? 1400 / maxSide : maxSide > 3200 ? 3200 / maxSide : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
