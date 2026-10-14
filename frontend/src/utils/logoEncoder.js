/* ── Logo kodlayıcı: PNG/JPG/WEBP → cihazın 4-bit indeksli logo .bin dosyası ──
   Biçim (LVGL LV_IMG_CF_INDEXED_4BIT, 238×88):
   - 64 byte palet: 16 renk × [B, G, R, A]
   - piksel verisi: satır başına ceil(238/2) = 119 byte, byte başına 2 piksel,
     soldaki piksel üst 4 bitte
   Toplam 10536 byte — backend validateIndexed4Logo ve önizleme kodu
   (LogoUploadPanel/BulkParamUpdate decodeLogoPreview) bununla birebir aynı.
*/

export const LOGO_W = 238;
export const LOGO_H = 88;
const PALETTE_SIZE = 16;
const ROW_BYTES = (LOGO_W + 1) >> 1;
const ALPHA_CUTOFF = 128;

async function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Görseli oranını bozmadan 238×88 alana ortalar (kalan alan saydam).
function rasterize(source) {
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_W; canvas.height = LOGO_H;
  const ctx = canvas.getContext("2d");
  const sw = source.width, sh = source.height;
  const scale = Math.min(LOGO_W / sw, LOGO_H / sh);
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, Math.floor((LOGO_W - w) / 2), Math.floor((LOGO_H - h) / 2), w, h);
  return ctx.getImageData(0, 0, LOGO_W, LOGO_H).data;
}

// Median-cut: renk kutusunu en geniş kanalından ikiye bölerek `count` renge indirir.
function medianCut(colors, count) {
  if (colors.length === 0) return [];
  let boxes = [colors];
  while (boxes.length < count) {
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const c of box) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch; }
      }
    });
    if (best < 0) break; // kalan kutuların hepsi tek renk
    const box = boxes[best].sort((a, b) => a[bestCh] - b[bestCh]);
    // Aynı renk iki kutuya bölünmesin: kesim, medyan değerin başladığı yerde
    // (o başa denk gelirse bittiği yerde) yapılır.
    const m = box[box.length >> 1][bestCh];
    let cut = box.findIndex((c) => c[bestCh] >= m);
    if (cut === 0) cut = box.findIndex((c) => c[bestCh] > m);
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const c of box) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; }
    return sum.map((s) => Math.round(s / box.length));
  });
}

export function encodeIndexed4(rgba) {
  const opaque = [];
  let hasTransparent = false;
  for (let i = 0; i < LOGO_W * LOGO_H; i++) {
    if (rgba[i * 4 + 3] < ALPHA_CUTOFF) hasTransparent = true;
    else opaque.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  }

  const palette = medianCut(opaque, hasTransparent ? PALETTE_SIZE - 1 : PALETTE_SIZE);
  const transparentIndex = hasTransparent ? palette.length : -1;

  const out = new Uint8Array(64 + ROW_BYTES * LOGO_H);
  palette.forEach(([r, g, b], i) => { out[i * 4] = b; out[i * 4 + 1] = g; out[i * 4 + 2] = r; out[i * 4 + 3] = 255; });
  // saydam giriş 0,0,0,0 olarak kalır

  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx !== undefined) return idx;
    let bestD = Infinity;
    palette.forEach(([pr, pg, pb], i) => {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bestD) { bestD = d; idx = i; }
    });
    cache.set(key, idx);
    return idx;
  };

  for (let y = 0; y < LOGO_H; y++) {
    for (let x = 0; x < LOGO_W; x++) {
      const p = (y * LOGO_W + x) * 4;
      const index = rgba[p + 3] < ALPHA_CUTOFF ? transparentIndex : nearest(rgba[p], rgba[p + 1], rgba[p + 2]);
      const o = 64 + y * ROW_BYTES + (x >> 1);
      out[o] |= (x & 1) ? (index & 0x0f) : ((index & 0x0f) << 4);
    }
  }
  return out;
}

export async function encodeLogoImageToIndexed4(file) {
  const source = await loadImage(file);
  const bytes = encodeIndexed4(rasterize(source));
  source.close?.();
  const name = String(file.name || "logo").replace(/\.[^.]+$/, "") + ".bin";
  return new File([bytes], name, { type: "application/octet-stream" });
}
