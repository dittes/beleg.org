// Bildverarbeitung für den Belegscanner – reines Canvas/ImageData, keine Bibliotheken.

/* ————— Dokumentränder automatisch finden ————— */
// Idee: Belege sind meist heller als der Untergrund. Bild verkleinern, Otsu-Schwelle,
// größte helle Fläche suchen, deren Eckpunkte über x+y / x−y bestimmen.
export function detectCorners(source) {
  const W = 360;
  const scale = W / source.width;
  const w = W, h = Math.max(1, Math.round(source.height * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'blur(2px)';
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const g = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) | 0;
    gray[i] = g; hist[g]++;
  }
  const t = otsu(hist, gray.length);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > t ? 1 : 0;

  // größte zusammenhängende helle Fläche (4er-Nachbarschaft)
  const label = new Int32Array(w * h);
  let best = { size: 0, id: 0 }, id = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    id++; let sp = 0, size = 0;
    stack[sp++] = start; label[start] = id;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (size > best.size) best = { size, id };
  }
  const area = w * h;
  // Zu klein oder praktisch das ganze Bild → kein klarer Beleg erkennbar
  if (best.size < area * 0.06 || best.size > area * 0.97) return null;
  let tl, tr, br, bl;
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== best.id) continue;
    const x = p % w, y = (p / w) | 0;
    const s = x + y, d = x - y;
    if (s < sMin) { sMin = s; tl = [x, y]; }
    if (s > sMax) { sMax = s; br = [x, y]; }
    if (d > dMax) { dMax = d; tr = [x, y]; }
    if (d < dMin) { dMin = d; bl = [x, y]; }
  }
  return [tl, tr, br, bl].map(([x, y]) => ({ x: x / scale, y: y / scale }));
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; thr = i; }
  }
  return thr;
}

/* ————— Perspektive entzerren ————— */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Homographie, die das Einheitsquadrat auf das Viereck abbildet
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, hh = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + hh * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + hh * p3.y, f: p0.y,
    g, h: hh,
  };
}

// corners: [oben links, oben rechts, unten rechts, unten links] in Bildkoordinaten
export function warp(source, corners, maxSide = 2600) {
  let outW = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
  let outH = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  const k = Math.min(1, maxSide / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * k)); outH = Math.max(1, Math.round(outH * k));

  const sc = new OffscreenCanvas(source.width, source.height);
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(source, 0, 0);
  const src = sctx.getImageData(0, 0, source.width, source.height);
  const sd = src.data, sw = src.width, sh = src.height;
  const out = new ImageData(outW, outH);
  const od = out.data;
  const H = squareToQuad(corners);
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      const den = H.g * u + H.h * v + 1;
      let sx = (H.a * u + H.b * v + H.c) / den - 0.5;
      let sy = (H.d * u + H.e * v + H.f) / den - 0.5;
      if (sx < 0) sx = 0; if (sy < 0) sy = 0;
      if (sx > sw - 1.001) sx = sw - 1.001; if (sy > sh - 1.001) sy = sh - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * fx;
        const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * fx;
        od[o + ch] = top + (bot - top) * fy;
      }
      od[o + 3] = 255;
    }
  }
  return out;
}

/* ————— Filter ————— */
// Integralbild für schnelle Box-Mittelwerte
function integral(values, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += values[(y - 1) * w + (x - 1)];
      I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x] + row;
    }
  }
  return I;
}
function boxMean(I, w, h, x, y, r) {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
  return s / ((x1 - x0) * (y1 - y0));
}

function luminance(img) {
  const { data, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
  return L;
}

// Hintergrund (Papierhelligkeit) schätzen: auf verkleinertem Bild Blockmaximum (überdeckt Schrift),
// dann glätten und wieder hochrechnen. Schnell genug auch für Handys.
function paperEstimate(L, w, h) {
  const f = Math.max(2, Math.round(Math.min(w, h) / 220));
  const w2 = Math.ceil(w / f), h2 = Math.ceil(h / f);
  const S = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++) {
    const row = ((y / f) | 0) * w2;
    for (let x = 0; x < w; x++) { const k = row + ((x / f) | 0); const v = L[y * w + x]; if (v > S[k]) S[k] = v; }
  }
  // kleine Dilatation (Radius 2) auf dem verkleinerten Bild
  const D = new Float32Array(S.length);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let m = 0;
    for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= h2) continue; for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx >= 0 && xx < w2) { const v = S[yy * w2 + xx]; if (v > m) m = v; } } }
    D[y * w2 + x] = m;
  }
  const I = integral(D, w2, h2);
  const R = Math.max(3, Math.round(Math.min(w2, h2) / 14));
  const B = new Float32Array(D.length);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) B[y * w2 + x] = boxMean(I, w2, h2, x, y, R);
  // bilinear hochrechnen
  const bg = new Float32Array(L.length);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h2 - 1.001, Math.max(0, y / f - 0.5)), y0 = sy | 0, fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w2 - 1.001, Math.max(0, x / f - 0.5)), x0 = sx | 0, fx = sx - x0;
      const i = y0 * w2 + x0;
      const a = B[i] + (B[i + 1] - B[i]) * fx, b = B[i + w2] + (B[i + w2 + 1] - B[i + w2]) * fx;
      bg[y * w + x] = a + (b - a) * fy;
    }
  }
  return bg;
}

export const FILTERS = {
  original: 'Original',
  color: 'Farbe optimiert',
  gray: 'Graustufen',
  bw: 'Schwarzweiß',
};

export function applyFilter(img, mode) {
  const { width: w, height: h } = img;
  const out = new ImageData(new Uint8ClampedArray(img.data), w, h);
  if (mode === 'original') return out;
  const d = out.data;
  const L = luminance(img);
  const bg = paperEstimate(L, w, h);

  if (mode === 'color') {
    // Schatten entfernen: jeden Kanal durch den Papierwert teilen, dann leicht Kontrast
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      const k = 255 / Math.max(40, bg[i]);
      for (let ch = 0; ch < 3; ch++) {
        let v = d[j + ch] * k;
        v = (v - 128) * 1.12 + 128 + 6;
        d[j + ch] = v;
      }
    }
    return out;
  }
  if (mode === 'gray') {
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      let v = (L[i] / Math.max(40, bg[i])) * 255;
      v = (v - 140) * 1.35 + 150;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
    return out;
  }
  // Schwarzweiß: normalisieren, dann adaptive Schwelle (Sauvola-ähnlich über lokalen Mittelwert)
  const N = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) N[i] = Math.min(255, (L[i] / Math.max(40, bg[i])) * 255);
  const I = integral(N, w, h);
  const r = Math.max(6, Math.round(Math.min(w, h) / 70));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const m = boxMean(I, w, h, x, y, r);
    const v = N[i] < m * 0.86 && N[i] < 215 ? 0 : 255;
    const j = i * 4;
    d[j] = d[j + 1] = d[j + 2] = v;
  }
  return out;
}

export function rotate90(img) {
  const { width: w, height: h, data } = img;
  const out = new ImageData(h, w);
  const od = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, t = (x * h + (h - 1 - y)) * 4;
    od[t] = data[s]; od[t + 1] = data[s + 1]; od[t + 2] = data[s + 2]; od[t + 3] = 255;
  }
  return out;
}

export function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
