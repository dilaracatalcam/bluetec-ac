/*
 * Cihaz aktivasyon kodu — MAC adresinin 30 karakterlik "BLUETECH" kodu.
 *
 * Cihaz ekranı ve mobil uygulamanın QR'ı aynı kodu gösterir; müşteriye bu kod
 * verilir ve "Cihaz Seç → Cihaz ekle" ile girilir. Kod şifreleme değil
 * karıştırmadır (gizli anahtar yok), MAC'ten her zaman aynı kod çıkar:
 *   1) MAC'in 6 baytı ters sıraya çevrilir     30EDA031BE64 → 64BE31A0ED30
 *   2) 48 bitlik sayının bitleri ters çevrilir  → ondalık 13980211641638
 *   3) 15 haneye tamamlanıp rakamları ters dizilir → 836146112089310
 *   4) rakamlar BLUETECH harfleriyle sırayla örülür → B8L3U6E1T4E6C1H1B2L0U8E9T3E1C0
 * decode bunun tersidir (Flutter tarafındaki _reverseMacBytes ile aynı).
 */

const BRAND = "BLUETECH";

function reverseBits48(value) {
  let out = 0n;
  for (let bit = 0; bit < 48; bit += 1) out = (out << 1n) | ((value >> BigInt(bit)) & 1n);
  return out;
}

function reverseBytes48(value) {
  let out = 0n;
  for (let byte = 0; byte < 6; byte += 1) out = (out << 8n) | ((value >> BigInt(byte * 8)) & 0xFFn);
  return out;
}

// "30:ED:A0:31:BE:64" → "B8L3U6E1T4E6C1H1B2L0U8E9T3E1C0"; geçersiz MAC → null
function encodeActivationCode(mac) {
  const hex = String(mac || "").replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) return null;
  const value = reverseBits48(reverseBytes48(BigInt(`0x${hex}`)));
  const digits = value.toString().padStart(15, "0").split("").reverse().join("");
  let code = "";
  for (let i = 0; i < 15; i += 1) code += BRAND[i % BRAND.length] + digits[i];
  return code;
}

// Kod → "30EDA031BE64" (iki nokta üst üste olmadan); geçersiz kod → null
function decodeActivationCode(rawToken) {
  const token = String(rawToken || "").trim().toUpperCase().replace(/\s+/g, "");
  if (token.length !== 30) return null;
  let digits = "";
  for (let index = 0; index < 15; index += 1) {
    if (token[index * 2] !== BRAND[index % BRAND.length]) return null;
    const digit = token[index * 2 + 1];
    if (!/[0-9]/.test(digit)) return null;
    digits += digit;
  }
  const value = reverseBits48(BigInt(digits.split("").reverse().join("")));
  return reverseBytes48(value).toString(16).toUpperCase().padStart(12, "0");
}

module.exports = { encodeActivationCode, decodeActivationCode };
