/* ═══════════════════════════════════════════════════════════════
   ota_config.json (local kopya) okuma/yazma.
   /root/bluetech/ altında duruyor, firmware.json gibi mevcut
   senkron mekanizmasıyla 85.105.100.7'ye otomatik yansıyor.
   ═══════════════════════════════════════════════════════════════ */

const fs = require("fs");

function readOtaConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error("ota_config.json bulunamadı: " + filePath);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.trim() ? JSON.parse(raw) : {};
}

function writeOtaConfig(filePath, config) {
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
}

module.exports = { readOtaConfig, writeOtaConfig };