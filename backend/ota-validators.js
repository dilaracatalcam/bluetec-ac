/* ═══════════════════════════════════════════════════════════════
   OTA SUNUCU KONTROLÜ — İçerik Doğrulama
   Uzantıya değil, dosyanın gerçek içeriğine bakarak doğrulama yapar.
   ═══════════════════════════════════════════════════════════════ */

// ── .bin (ESP firmware) ──
// ESP32 OTA image'ları 0xE9 magic byte ile başlar.
// Ek olarak: gerçekten binary mi (null byte oranı) kontrol edilir,
// yoksa biri sadece ilk byte'ı 0xE9 yapıp geri kalanını metin bırakabilir.
function validateBin(buffer) {
    if (!buffer || buffer.length < 32) {
        return { valid: false, reason: "Dosya çok küçük veya boş" };
    }
    if (buffer[0] !== 0xE9) {
        return { valid: false, reason: "Geçerli bir ESP32 firmware image'ı değil (magic byte eksik)" };
    }
    // İlk 4KB içinde null byte oranına bak — gerçek binary dosyalar
    // genelde düzenli null byte / non-printable byte içerir.
    const sampleSize = Math.min(buffer.length, 4096);
    let nullOrControlCount = 0;
    for (let i = 0; i < sampleSize; i++) {
        const b = buffer[i];
        if (b === 0x00 || (b < 0x09) || (b > 0x0D && b < 0x20 && b !== 0x1B)) {
            nullOrControlCount++;
        }
    }
    const ratio = nullOrControlCount / sampleSize;
    if (ratio < 0.02) {
        return { valid: false, reason: "Dosya binary formatta görünmüyor" };
    }
    return { valid: true };
}

// ── .txt (MSP) ──
// Geçerli UTF-8 mü, kontrol karakteri (tab/newline hariç) içeriyor mu?
// Binary bir dosyanın uzantısı değiştirilip yüklenmesini engeller.
function validateTxt(buffer) {
    if (!buffer || buffer.length === 0) {
        return { valid: false, reason: "Dosya boş" };
    }
    // UTF-8 round-trip kontrolü: decode edip tekrar encode edince
    // byte-eşit çıkmıyorsa geçersiz UTF-8 demektir.
    const text = buffer.toString("utf8");
    const reEncoded = Buffer.from(text, "utf8");
    if (!reEncoded.equals(buffer)) {
        return { valid: false, reason: "Geçerli bir metin dosyası değil (UTF-8 hatası)" };
    }
    // Kontrol karakteri kontrolü — tab(0x09), LF(0x0A), CR(0x0D) hariç
    // 0x00-0x1F aralığında herhangi bir byte varsa binary içerik demektir.
    for (let i = 0; i < buffer.length; i++) {
        const b = buffer[i];
        if (b < 0x20 && b !== 0x09 && b !== 0x0A && b !== 0x0D) {
            return { valid: false, reason: "Dosya binary içerik barındırıyor, metin dosyası değil" };
        }
    }
    return { valid: true };
}

// ── .c (logo kaynak dosyası) → .bin dönüşümü ──
// c_to_logo_bin_multi.py ile aynı regex mantığı.
// Array bulunamazsa dosya zaten geçersiz sayılır (doğrulama = dönüştürebilme).
function convertCtoBin(buffer) {
    const text = buffer.toString("utf8");

    const match = text.match(/const\s+.*?uint8_t\s+.*?_data\[\]\s*=\s*\{([\s\S]*?)\};/);
    if (!match) {
        return { valid: false, reason: "Dosya içinde geçerli bir C uint8_t array bulunamadı" };
    }

    const hexValues = match[1].match(/0x[0-9A-Fa-f]{1,2}/g);
    if (!hexValues || hexValues.length === 0) {
        return { valid: false, reason: "Array içinde hex değer bulunamadı" };
    }

    const data = Buffer.from(hexValues.map((h) => parseInt(h, 16)));
    return { valid: true, buffer: data };
}

module.exports = { validateBin, validateTxt, convertCtoBin };