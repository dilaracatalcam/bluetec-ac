/* ── Logo kodlayıcı: PNG/JPG/WEBP → cihazın 4-bit indeksli logo .bin dosyası ──
   Canlıdaki build'den (13.10.2026) birebir geri çıkarıldı.
   Biçim (LVGL LV_IMG_CF_INDEXED_4BIT, 238×88):
   - 64 byte palet: 16 renk × [B, G, R, A]; 0. renk saydam (hepsi 0)
   - piksel verisi: satır başına ceil(238/2) = 119 byte, byte başına 2 piksel,
     soldaki piksel üst 4 bitte
   Toplam 10536 byte — backend validateIndexed4Logo ve önizleme kodu ile aynı.
*/

const LOGO_W = 238;
const LOGO_H = 88;
const LOGO_SIZE = 64 + Math.ceil(LOGO_W / 2) * LOGO_H;

function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Logo resmi okunamadı")); };
    img.src = url;
  });
}

// Alfa farkı renk farkından iki kat ağır sayılır
function colorDistance(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b, da = a.a - b.a;
  return dr * dr + dg * dg + db * db + da * da * 2;
}

export async function encodeLogoImageToIndexed4(file) {
  if (!file) throw new Error("Logo dosyası seçilmedi");
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_W;
  canvas.height = LOGO_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Logo çizim alanı oluşturulamadı");
  ctx.clearRect(0, 0, LOGO_W, LOGO_H);
  ctx.imageSmoothingEnabled = true;

  const srcW = image.width || image.naturalWidth;
  const srcH = image.height || image.naturalHeight;
  if (!srcW || !srcH) throw new Error("Logo resmi boş");
  // Oranı koruyarak 238×88 alana ortala; kalan alan saydam
  const scale = Math.min(LOGO_W / srcW, LOGO_H / srcH);
  const w = srcW * scale, h = srcH * scale;
  ctx.drawImage(image, (LOGO_W - w) / 2, (LOGO_H - h) / 2, w, h);
  if (typeof image.close === "function") image.close();

  const px = ctx.getImageData(0, 0, LOGO_W, LOGO_H).data;

  // Renkleri kaba kovalara topla (RGB 5 bit, alfa 4 bit); en sık 15 kova palet olur
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < 8) continue;
    const key = `${px[i] & 248},${px[i + 1] & 248},${px[i + 2] & 248},${a >> 4}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1; bucket.r += px[i]; bucket.g += px[i + 1]; bucket.b += px[i + 2]; bucket.a += a;
    } else {
      buckets.set(key, { count: 1, r: px[i], g: px[i + 1], b: px[i + 2], a });
    }
  }
  const palette = Array.from(buckets.values())
    .sort((x, y) => y.count - x.count)
    .slice(0, 15)
    .map((c) => ({ r: Math.round(c.r / c.count), g: Math.round(c.g / c.count), b: Math.round(c.b / c.count), a: Math.round(c.a / c.count) }));
  while (palette.length < 15) palette.push({ r: 0, g: 0, b: 0, a: 0 });

  const out = new Uint8Array(LOGO_SIZE);
  // 0. renk saydam kalır; 1..15 paletten
  for (let i = 0; i < 15; i += 1) {
    const c = palette[i], o = (i + 1) * 4;
    out[o] = c.b; out[o + 1] = c.g; out[o + 2] = c.r; out[o + 3] = c.a;
  }

  const indices = new Uint8Array(LOGO_W * LOGO_H);
  for (let y = 0; y < LOGO_H; y += 1) {
    for (let x = 0; x < LOGO_W; x += 1) {
      const p = (y * LOGO_W + x) * 4, a = px[p + 3];
      if (a < 8) continue;
      const color = { r: px[p], g: px[p + 1], b: px[p + 2], a };
      let best = 1, bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < palette.length; i += 1) {
        const d = colorDistance(color, palette[i]);
        if (d < bestD) { bestD = d; best = i + 1; }
      }
      indices[y * LOGO_W + x] = best;
    }
  }

  let o = 64;
  for (let y = 0; y < LOGO_H; y += 1) {
    for (let x = 0; x < LOGO_W; x += 2) {
      const hi = indices[y * LOGO_W + x] & 15;
      const lo = x + 1 < LOGO_W ? indices[y * LOGO_W + x + 1] & 15 : 0;
      out[o++] = (hi << 4) | lo;
    }
  }

  const base = file.name.replace(/\.[^.]+$/, "") || "logo";
  return new File([out], `${base}_logo.bin`, { type: "application/octet-stream" });
}
