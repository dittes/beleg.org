// Code-Scanner-Kern: QR- und Strichcodes aus Kamera oder Bild lesen.
// Nutzt den eingebauten BarcodeDetector (Chrome, Android, Edge), sonst ZXing (Safari, Firefox).
const V = (p) => new URL(`../vendor/${p}`, import.meta.url).href;

export const FORMAT_NAMES = {
  qr_code: 'QR-Code', data_matrix: 'Data Matrix', aztec: 'Aztec', pdf417: 'PDF417',
  ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E', code_128: 'Code 128', code_39: 'Code 39',
  code_93: 'Code 93', itf: 'ITF', codabar: 'Codabar', rss_14: 'GS1 DataBar', rss_expanded: 'GS1 DataBar Expanded',
};
const ZX_NAMES = { QR_CODE: 'qr_code', DATA_MATRIX: 'data_matrix', AZTEC: 'aztec', PDF_417: 'pdf417', EAN_13: 'ean_13', EAN_8: 'ean_8', UPC_A: 'upc_a', UPC_E: 'upc_e', CODE_128: 'code_128', CODE_39: 'code_39', CODE_93: 'code_93', ITF: 'itf', CODABAR: 'codabar', RSS_14: 'rss_14', RSS_EXPANDED: 'rss_expanded' };
const TO_ZX = Object.fromEntries(Object.entries(ZX_NAMES).map(([k, v]) => [v, k]));

let zxingP;
const loadZxing = () => (zxingP ??= new Promise((res, rej) => {
  if (window.ZXing) return res(window.ZXing);
  const s = Object.assign(document.createElement('script'), { src: V('zxing/zxing.min.js'), onload: () => res(window.ZXing), onerror: rej });
  document.head.append(s);
}));

/** Decoder für die gewünschten Formate. Rückgabe: async (canvas) => [{ format, value }] */
export async function createDecoder(formats) {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const use = formats.filter((f) => supported.includes(f));
      if (use.length >= Math.min(formats.length, formats.includes('qr_code') ? 1 : 4)) {
        const det = new window.BarcodeDetector({ formats: use });
        return { engine: 'nativ', decode: async (src) => (await det.detect(src)).map((r) => ({ format: r.format, value: r.rawValue })) };
      }
    } catch { /* weiter mit ZXing */ }
  }
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats.map((f) => Z.BarcodeFormat[TO_ZX[f]]).filter((x) => x !== undefined));
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const tryDecode = (canvas) => {
    try {
      const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)));
      return [{ format: ZX_NAMES[Z.BarcodeFormat[r.getBarcodeFormat()]] || 'unbekannt', value: r.getText() }];
    } catch { return []; }
  };
  return {
    engine: 'ZXing',
    decode: async (canvas) => {
      let r = tryDecode(canvas);
      if (!r.length && canvas.width > 1200) r = tryDecode(scaled(canvas, 1200 / canvas.width));
      return r;
    },
  };
}

function scaled(src, k) {
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Bilddatei → Canvas (max. 2400 px) */
export async function fileCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/**
 * Kamera-Scanner. onResult({ format, value }) wird pro neuem Code aufgerufen
 * (derselbe Inhalt wird innerhalb von `repeatMs` nicht erneut gemeldet).
 */
export function cameraScanner({ video, decoder, onResult, onState = () => {}, repeatMs = 2500 }) {
  let stream = null, track = null, timer = null, running = false, busy = false;
  const last = new Map();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function start(deviceId) {
    stop();
    onState('start');
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play();
    running = true;
    onState('running');
    loop();
  }
  async function loop() {
    if (!running) return;
    if (!busy && video.videoWidth) {
      busy = true;
      const k = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * k); canvas.height = Math.round(video.videoHeight * k);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const res = await decoder.decode(decoder.engine === 'nativ' ? video : canvas);
        const now = Date.now();
        for (const r of res) {
          if (!r.value) continue;
          if (now - (last.get(r.value) || 0) < repeatMs) { last.set(r.value, now); continue; }
          last.set(r.value, now);
          navigator.vibrate?.(60);
          onResult(r, canvas);
        }
      } catch { /* nächster Versuch */ }
      busy = false;
    }
    timer = setTimeout(loop, decoder.engine === 'nativ' ? 120 : 220);
  }
  function stop() {
    running = false;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; track = null;
    video.srcObject = null;
    onState('stopped');
  }
  return {
    start, stop,
    get running() { return running; },
    torchSupported: () => !!track?.getCapabilities?.().torch,
    async torch(on) { await track?.applyConstraints({ advanced: [{ torch: on }] }); },
    async cameras() { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); },
    currentId: () => track?.getSettings?.().deviceId,
  };
}

/** Kurzer Bestätigungston (optional) */
export function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1320; g.gain.value = 0.06;
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.08);
    o.onended = () => a.close();
  } catch { /* egal */ }
}
