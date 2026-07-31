/* ═══════════════════════════════════════════════════════════════
   firmware.json (local kopya) güncelleme mantığı.
   Bu dosya proje kökünde duruyor, mevcut senkron mekanizmasıyla
   85.105.100.7'deki kopyaya zaten otomatik yansıyor — burada
   sadece LOCAL kopyayı güncelliyoruz.
   ═══════════════════════════════════════════════════════════════ */

const fs = require("fs");

// "404" -> "4.0.4", "11" -> "1.1"  (her rakam arasına nokta)
function dottedVersion(raw) {
    return String(raw).split("").join(".");
}

// kind: "esp" | "msp"
function updateFirmwareJson(filePath, { kind, hw, sw, url }) {
    let data = {};
    if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        try {
            data = raw.trim() ? JSON.parse(raw) : {};
        } catch (e) {
            throw new Error("firmware.json parse hatası: " + e.message);
        }
    }

    const groupKey = kind === "esp" ? "esp_firmwares" : "msp_firmwares";
    const versionPrefix = kind === "esp" ? "v" : "msp";
    const versionKey = `${versionPrefix}@${dottedVersion(sw)}`;

    if (!data[groupKey]) data[groupKey] = {};
    if (!data[groupKey][hw]) data[groupKey][hw] = { versions: {} };
    if (!data[groupKey][hw].versions) data[groupKey][hw].versions = {};

    data[groupKey][hw].versions[versionKey] = { url };

    // Atomic yazma: önce .tmp'ye yaz, sonra rename et — yarım kalmış dosya riskini önler
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);

    return { groupKey, hw, versionKey, url };
}

function readFirmwareJson(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw.trim() ? JSON.parse(raw) : {};
}

// esp_firmwares / msp_firmwares altındaki tüm hw'lerin versiyonlarını
// tekilleştirip (dropdown için) düz bir liste olarak döndürür.
function extractVersions(data) {
    function collect(group) {
        const versions = new Set();
        for (const hw of Object.keys(group || {})) {
            const versionsObj = (group[hw] && group[hw].versions) || {};
            for (const v of Object.keys(versionsObj)) versions.add(v);
        }
        return Array.from(versions).sort();
    }
    return {
        espVersions: collect(data.esp_firmwares),
        mspVersions: collect(data.msp_firmwares),
    };
}

// Belirli bir hw/versionKey kaydını firmware.json'dan kaldırır.
// hw altında başka versiyon kalmazsa hw girdisini de temizler.
function removeFromFirmwareJson(filePath, { kind, hw, versionKey }) {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = raw.trim() ? JSON.parse(raw) : {};

    const groupKey = kind === "esp" ? "esp_firmwares" : "msp_firmwares";
    if (!data[groupKey] || !data[groupKey][hw] || !data[groupKey][hw].versions) return false;

    const existed = versionKey in data[groupKey][hw].versions;
    delete data[groupKey][hw].versions[versionKey];

    if (Object.keys(data[groupKey][hw].versions).length === 0) {
        delete data[groupKey][hw];
    }

    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);

    return existed;
}

module.exports = { updateFirmwareJson, dottedVersion, readFirmwareJson, extractVersions, removeFromFirmwareJson };