const { getCompanies, getLocations, getDevices, getDeviceByCode, getCustomFields, addCustomField, deleteCustomField, isSyntheticSessionStale, updateDeviceLocation, updateDeviceInventoryByMac } = require('./db');
require('dotenv').config();

const INACTIVITY_TIMEOUT      = 5 * 60 * 1000;  // 5 dakika (ms) — hareketsiz bağlantı otomatik kapatma süresi
const SLOT_CLEANUP_INTERVAL   = 30 * 1000;      // 30 saniyede bir slot temizliği
const SLOT_CLEAR_MSG_INTERVAL = 1500;           // send_message'ı temizleme gecikmesi

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const multer = require('multer');
const SftpClient = require('ssh2-sftp-client');
const { validateBin, validateTxt, convertCtoBin, validateIndexed4Logo } = require('./ota-validators');
const { updateFirmwareJson, dottedVersion, readFirmwareJson, extractVersions, removeFromFirmwareJson } = require('./ota-firmware-json');
const { readOtaConfig, writeOtaConfig } = require('./ota-config');
const otaLogTailer = require('./ota-log-tailer');
const { buildScope, allowsDevice, allowsMac, visibleDevices } = require('./device-scope');
const rateLimit = require('express-rate-limit');
const {
    sendPasswordResetEmail,
    sendRegistrationVerificationEmail,
    sendRegistrationApprovedEmail,
} = require('./email');

const app = express();
app.use(cors());
app.use(express.json());

// React build'i static olarak sun
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    console.log('[STATIC] React build sunuluyor:', distPath);
}

const TARGET_PATH    = process.env.TARGET_PATH    || '/home/bluetech/target.json';
const RESPONSES_PATH = process.env.RESPONSES_PATH || '/home/bluetech/responses.json';
const USERS_PATH     = process.env.USERS_PATH     || path.join(__dirname, 'users.json');
const DEVICE_SHARE_REQUESTS_PATH = process.env.DEVICE_SHARE_REQUESTS_PATH || path.join(__dirname, 'device_share_requests.json');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';

// ── OTA Sunucu Kontrolü — şirket sunucusuna SFTP ile dosya gönderme ──
const OTA_REMOTE_HOST    = process.env.OTA_REMOTE_HOST    || '85.105.100.7';
const OTA_REMOTE_USER    = process.env.OTA_REMOTE_USER    || 'bluetech';
const OTA_REMOTE_PATH    = process.env.OTA_REMOTE_PATH    || '/home/bluetech/ota_system/public';
const OTA_LOG_PATH       = process.env.OTA_LOG_PATH       || '/home/bluetech/ota_system/logs/ota_server.log';
const OTA_SSH_KEY_PATH   = process.env.OTA_SSH_KEY_PATH   || '/root/.ssh/ota_transfer_key';
const OTA_MAX_FILE_SIZE  = 8 * 1024 * 1024; // 8MB — firmware/logo dosyaları için yeterli üst sınır
const OTA_HTTP_PORT      = process.env.OTA_HTTP_PORT      || '5050'; // ota_server.py'nin serve ettiği port
// firmware.json'un LOCAL kopyası — proje kökünde (target.json/responses.json ile aynı seviyede).
// Bu dosya, mevcut senkron mekanizmasıyla zaten 85.105.100.7'deki kopyaya otomatik yansıyor —
// biz burada sadece local kopyayı güncelliyoruz, kendimiz ayrıca SFTP ile göndermiyoruz.
const OTA_FIRMWARE_JSON_PATH = process.env.OTA_FIRMWARE_JSON_PATH || '/root/bluetech/firmware.json';
const OTA_CONFIG_JSON_PATH   = process.env.OTA_CONFIG_JSON_PATH   || '/root/bluetech/ota_config.json';
const OTA_DEVICES_JSON_PATH  = process.env.OTA_DEVICES_JSON_PATH  || '/root/bluetech/devices.json';

const BCRYPT_ROUNDS = 10;

/* ═══════════════════════════════════════════════════════════════
   ÇOKLU SESSION YAPISI

   target.json:
   {
     "requests": [
       { "session_id": "merve", "target": "30:ED:...", "control": "activate", "send_message": "frame 2 38 0" },
       ...
     ]
   }

   responses.json:
   {
     "responses": {
       "merve": {
         "session_id": "merve",
         "target": "30:ED:...",
         "status_response": { "topic": "...", "data": "ESP aktif", "time": "..." },
         "message_response": [{ "cmd": 2, "msg": 38, "data": "1", "time": "..." }]
       }
     }
   }

   slotMeta (RAM):
   {
     "merve": {
       lastActivity: 1709...,
       lastDeactivatedBy: "ali" | null,   ← başka kullanıcı deaktif ettiyse
       fullName: "Merve Öztürk"           ← UI'da gösterim için
     }
   }
   ═══════════════════════════════════════════════════════════════ */

// =============================================
//  YETKİLENDİRME — users.json
// =============================================

function readUsers() {
    if (!fs.existsSync(USERS_PATH)) {
        fs.writeFileSync(USERS_PATH, '[]', 'utf-8');
        console.log(`[USERS] ${USERS_PATH} otomatik oluşturuldu`);
        return [];
    }
    try {
        const raw = fs.readFileSync(USERS_PATH, 'utf-8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.error('[USERS] users.json okunamadı:', e.message);
        return [];
    }
}

function writeUsers(users) {
    const tmp = USERS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf-8');
    fs.renameSync(tmp, USERS_PATH);
}

function readDeviceShareRequests() {
    if (!fs.existsSync(DEVICE_SHARE_REQUESTS_PATH)) return [];
    try {
        const raw = fs.readFileSync(DEVICE_SHARE_REQUESTS_PATH, 'utf-8');
        const requests = JSON.parse(raw);
        return Array.isArray(requests) ? requests : [];
    } catch (e) {
        console.error('[BLE-SHARE] istek dosyası okunamadı:', e.message);
        return [];
    }
}

function writeDeviceShareRequests(requests) {
    const tmp = DEVICE_SHARE_REQUESTS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(requests, null, 2), 'utf-8');
    fs.renameSync(tmp, DEVICE_SHARE_REQUESTS_PATH);
}

// Istek sahibinin cihaz erisim kapsami
function scopeFor(req) {
    const users = readUsers();
    return buildScope(users.find((u) => u.username === req.username), req.userRole);
}

// Bireysel operator hesapları için panel kısıtı. Şirket hesabı olmayan ve
// cihazları tek tek allowedMacs ile atanmış kullanıcılar bu kapsamdadır.
function isRestrictedOperator(req) {
    if (req.userRole !== 'operator') return false;
    const user = readUsers().find((u) => u.username === req.username);
    return !user || !user.company || isIndividualDeviceCompany(user.company);
}

function deviceForMac(mac) {
    const compact = String(mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(compact)) return null;
    return getDevices({}).find((device) =>
        String(device.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase() === compact
    ) || null;
}

// Bireysel cihazlarda yalnızca Wi-Fi/bağlantı, RFID ve temel kontrol/telemetri
// değişkenleri kullanılabilir. OCPP alanları API seviyesinde de kapalıdır.
const INDIVIDUAL_READ_IDS = new Set([
    5, 6, 7, 8, 15, 19, 20, 21, 22, 23, 24, 25, 26, 27, 33, 34, 44,
    46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 62, 66, 67, 68,
]);
const INDIVIDUAL_SET_IDS = new Set([5, 6, 7, 8, 15, 20, 21, 62, 66]);

function individualCommandAllowed(type, variable) {
    const id = Number(variable);
    if (type === 'read') return INDIVIDUAL_READ_IDS.has(id);
    if (type === 'set') return INDIVIDUAL_SET_IDS.has(id);
    return false;
}

function isRestrictedTarget(req, mac) {
    const company = deviceForMac(mac)?.company;
    return req.userRole === 'operator' && (isIndividualDeviceCompany(company) || !String(company || '').trim());
}

// Token deposu
const activeSessions = {};
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000;

// Slot meta — her session_id için aktivite + deactivate tracking
const slotMeta = {};

function touchSlot(sessionId) {
    if (!sessionId) return;
    if (!slotMeta[sessionId]) slotMeta[sessionId] = {};
    slotMeta[sessionId].lastActivity = Date.now();
}

// ── LOGIN ──
app.post('/api/login', async (req, res) => {
    const { username, password, page } = req.body || {};

    if (!username || !password || !page) {
        return res.status(400).json({ error: 'Eksik bilgi' });
    }
    if (page !== 'dashboard' && page !== 'admin') {
        return res.status(400).json({ error: 'Geçersiz sayfa' });
    }

    const users = readUsers();
    const user = users.find((u) => u.username === username);
    if (!user) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });

    let ok = false;
    try { ok = await bcrypt.compare(password, user.passwordHash || ''); }
    catch (e) { return res.status(500).json({ error: 'Doğrulama hatası' }); }
    if (!ok) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });

    // Yeni kayıtlar e-posta kodu ile doğrulanır. Eski users.json
    // kayıtlarında status yoksa geriye dönük olarak aktif kabul edilir.
    if (user.status === 'pending_email') {
        return res.status(403).json({ error: 'Önce e-posta adresinize gelen doğrulama kodunu girin.' });
    }
    if (user.status === 'pending') {
        return res.status(403).json({ error: 'Hesabınız eski kayıt akışı nedeniyle yönetici onayı bekliyor.' });
    }
    if (user.status === 'disabled') {
        return res.status(403).json({ error: 'Hesabınız devre dışı bırakılmış.' });
    }

    if (page === 'admin' && user.role === 'operator') {
        return res.status(403).json({ error: 'Bu sayfaya yetkiniz yok' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions[token] = {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        page,
        createdAt: Date.now(),
    };

    // Slot meta'sında fullName'i de tutalım (UI'da gösterim için)
    if (!slotMeta[user.username]) slotMeta[user.username] = {};
    slotMeta[user.username].fullName = user.fullName;

    console.log(`[AUTH] ${user.username} (${user.role}) → ${page} giriş başarılı`);

    res.json({
        token,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
        session_id: user.username,   // ← Frontend bunu localStorage'a kaydedip her API çağrısında gönderecek
    });
});

// ── Auth Middleware ──
function requireAuth(allowedRoles = null) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token gerekli' });
        }

        const token = authHeader.split(' ')[1];
        const session = activeSessions[token];
        if (!session) return res.status(401).json({ error: 'Geçersiz token' });

        if (Date.now() - session.createdAt > TOKEN_EXPIRY) {
            delete activeSessions[token];
            return res.status(401).json({ error: 'Oturum süresi doldu' });
        }

        if (allowedRoles && Array.isArray(allowedRoles)) {
            if (session.role !== 'superadmin' && !allowedRoles.includes(session.role)) {
                return res.status(403).json({ error: 'Bu sayfaya yetkiniz yok' });
            }
        }

        req.userRole = session.role;
        req.username = session.username;
        req.userFullName = session.fullName;
        req.sessionId = session.username; // session_id = username
        next();
    };
}

// ── Logout ──
app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        if (activeSessions[token]) {
            const username = activeSessions[token].username;
            console.log(`[AUTH] ${username} çıkış yaptı`);
            delete activeSessions[token];

            // O kullanıcının slot'unu da temizle
            removeSlot(username).catch((e) => console.error('logout slot temizle:', e));
        }
    }
    res.json({ message: 'Çıkış yapıldı' });
});

// ── /api/me ──
app.get('/api/me', requireAuth(), (req, res) => {
    const users = readUsers();
    const user = users.find((u) => u.username === req.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    res.json({
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        company: user.company || null,
        status: user.status || 'active',
        email: user.email || null,
        session_id: user.username,
    });
});

// ── BLE çevrimdışı kurulum yetkilendirmesi ──────────────────────
// Flutter QR'daki gizlenmiş kimliği çözüp gerçek eFuse MAC'ini gönderir.
// Bu endpoint yeni bir tablo kullanmaz; mevcut cihaz kaydı ve device-scope
// kuralları üzerinden yetki verir. Böylece başka şirkete/kullanıcıya ait
// cihazın BLE ayarlarına erişilemez.
// Aktivasyon kodu (30 karakter, BLUETECH + rakamlar) → MAC; bkz. activation-code.js
const { decodeActivationCode: decodeBleDeviceToken } = require('./activation-code');

app.post('/api/ble/authorize-device', requireAuth(), (req, res) => {
    const supplied = String(req.body?.deviceId || '').trim();
    const compactMac = supplied.replace(/[^0-9a-f]/gi, '').toUpperCase();

    if (!/^[0-9A-F]{12}$/.test(compactMac)) {
        return res.status(400).json({ error: 'Geçerli bir cihaz MAC adresi gerekli' });
    }

    const mac = compactMac.match(/.{2}/g).join(':');
    const device = getDevices({}).find((item) =>
        String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase() === compactMac
    );

    if (!device) {
        return res.status(404).json({ error: 'Cihaz kayıtlı değil' });
    }

    if (!allowsDevice(scopeFor(req), device)) {
        console.warn(`[BLE-AUTH] ${req.username} yetkisiz BLE kurulumu denedi: ${mac}`);
        return res.status(403).json({ error: 'Bu cihaz için yetkiniz yok' });
    }

    console.log(`[BLE-AUTH] ${req.username} BLE kurulum yetkisi aldı: ${mac}`);
    return res.json({ allowed: true });
});

// "Bireysel" cihazlar şirket adı alanında tutulabilir. Bu değerler
// erişim kurallarında şirket cihazı gibi değerlendirilmez; cihaz sahibi
// kullanıcı olur ve başka kullanıcı ekleme onay akışı çalışır.
function isIndividualDeviceCompany(value) {
    const normalized = String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return ['bireysel', 'individual', 'kisisel', 'private', 'ozel'].includes(normalized);
}

// Cihaz kayıtlarında şirket alanı boş bırakıldığında bu cihaz henüz
// "Atanabilir" durumdadır. Bireysel sahiplik için açıkça Bireysel seçilir.
function normalizeDeviceCompany(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    return isIndividualDeviceCompany(raw) ? 'Bireysel' : raw;
}

function normalizeMacValue(value) {
    return String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

function formattedMacValue(value) {
    const compact = normalizeMacValue(value);
    return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g).join(':') : String(value || '').trim();
}

function companyForRequest(req) {
    const user = readUsers().find((item) => item.username === req.username);
    return normalizeDeviceCompany(user?.company);
}

function isCompanyManager(req, company) {
    return (req.userRole === 'admin' || req.userRole === 'operator') &&
        !!String(company || '').trim() && !isIndividualDeviceCompany(company);
}

// Superadmin ve şirketi olmayan admin tüm şirketlerde işlem yapabilir.
// Şirket yöneticisi yalnızca kendi şirketine veya kendi hesabına ait
// bireysel (boş şirketli) cihaza kayıt/güncelleme yapabilir.
function canManageDeviceCompany(req, company) {
    if (req.userRole === 'superadmin') return true;
    if (req.userRole !== 'admin') return false;
    const ownCompany = companyForRequest(req);
    return !ownCompany || company === null || company === ownCompany;
}

function addOwnedDeviceToUser(user, mac) {
    const formatted = formattedMacValue(mac);
    const compact = normalizeMacValue(mac);
    if (!/^[0-9A-F]{12}$/.test(compact)) return false;
    const owned = Array.isArray(user.ownedMacs) ? user.ownedMacs : [];
    const allowed = Array.isArray(user.allowedMacs) ? user.allowedMacs : [];
    const hasOwned = owned.some((value) => normalizeMacValue(value) === compact);
    const hasAllowed = allowed.some((value) => normalizeMacValue(value) === compact);
    if (!hasOwned) user.ownedMacs = [...owned, formatted];
    if (!hasAllowed) user.allowedMacs = [...allowed, formatted];
    return !hasOwned || !hasAllowed;
}

function removeOwnedDeviceFromUser(user, mac) {
    const compact = normalizeMacValue(mac);
    const owned = Array.isArray(user.ownedMacs) ? user.ownedMacs : [];
    const wasOwned = owned.some((value) => normalizeMacValue(value) === compact);
    user.ownedMacs = owned.filter((value) => normalizeMacValue(value) !== compact);
    if (wasOwned) {
        const allowed = Array.isArray(user.allowedMacs) ? user.allowedMacs : [];
        user.allowedMacs = allowed.filter((value) => normalizeMacValue(value) !== compact);
    }
    return wasOwned;
}

function removeCompanyAccess(target, company, allDevices) {
    const companyMacs = new Set(allDevices
        .filter((item) => String(item.company || '').trim() === company)
        .map((item) => String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase())
        .filter((mac) => /^[0-9A-F]{12}$/.test(mac)));
    const targetMacs = Array.isArray(target.allowedMacs) ? target.allowedMacs : [];
    const filteredMacs = targetMacs.filter((value) => !companyMacs.has(String(value).replace(/[^0-9a-f]/gi, '').toUpperCase()));
    const removedMacCount = targetMacs.length - filteredMacs.length;
    const companyRemoved = String(target.company || '').trim() === company;
    target.allowedMacs = filteredMacs;
    if (companyRemoved) target.company = null;
    return { changed: companyRemoved || removedMacCount > 0, removedMacCount };
}

// ── BLE cihaz kodu ile cihaz sahiplenme ─────────────────────────
// ESP ekranındaki 30 karakterlik BLUETECH+rakam kodu çözülür ve yeni
// operator hesabının allowedMacs listesine eklenir. Bu işlem yeni bir tablo
// kullanmaz; mevcut users.json yetki modeli kullanılır.
//
// Güvenlik kuralları:
//   * Superadmin/admin zaten kapsam dışı bırakılmaz; onlar için işlem no-op'tur.
//   * Başka bir kullanıcının allowedMacs listesinde olan cihaz taşınamaz.
//   * Firmaya atanmış cihazı bireysel/operator hesap sahiplenemez; firma
//     yöneticisi tarafından atanması gerekir.
//   * Boş/unassigned cihaz hesaba eklenebilir; firma cihazı bireysel hesaba
//     aktarılmaz. BLE ayar değişiklikleri ayrıca /authorize-device kapsamına
//     tabidir.
app.post('/api/ble/claim-device', requireAuth(), (req, res) => {
    const token = String(req.body?.deviceToken || '').trim();
    const supplied = String(req.body?.deviceId || '').trim();
    const decodedTokenMac = token ? decodeBleDeviceToken(token) : null;
    const compactMac = decodedTokenMac || supplied.replace(/[^0-9a-f]/gi, '').toUpperCase();

    if (!/^[0-9A-F]{12}$/.test(compactMac)) {
        return res.status(400).json({ error: 'Geçerli bir cihaz MAC adresi gerekli' });
    }

    const mac = compactMac.match(/.{2}/g).join(':');
    const device = getDevices({}).find((item) =>
        String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase() === compactMac
    );
    if (!device) return res.status(404).json({ error: 'Cihaz kayıtlı değil' });

    const users = readUsers();
    const current = users.find((user) => user.username === req.username);
    if (!current) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Admin ve superadmin için QR ile sahiplenme gerekmez; mevcut kapsamları
    // aynen korunur. UI yanlışlıkla bu endpoint'i çağırsa bile yetki daralmaz.
    if (req.userRole !== 'operator') {
        if (!allowsDevice(scopeFor(req), device)) {
            return res.status(403).json({ error: 'Bu cihaz için yetkiniz yok' });
        }
        return res.json({ claimed: false, allowed: true, deviceCode: device.device_code || null });
    }

    const normalizeMac = (value) => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    const currentMacs = Array.isArray(current.allowedMacs) ? current.allowedMacs : [];
    if (currentMacs.some((value) => normalizeMac(value) === compactMac)) {
        return res.json({ claimed: false, allowed: true, deviceCode: device.device_code || null });
    }

    const deviceCompany = String(device.company || '').trim();
    // Açıkça Bireysel olan veya henüz firma atanmamış (boş) cihazlar kod ile
    // sahiplenilebilir. Firmaya atanmış cihaz yalnız şirket yöneticisiyle paylaşılır.
    const individualDevice = isIndividualDeviceCompany(deviceCompany) || !deviceCompany;
    // Şirket cihazı QR/kod ile bireysel olarak sahiplenilmez. Şirket yetkilisi
    // Device Select içindeki "Kullanıcı ekle" akışından paylaşmalıdır.
    if (!individualDevice) {
        console.warn(`[BLE-CLAIM] ${req.username} firma cihazını sahiplenmek istedi: ${mac} (${deviceCompany})`);
        return res.status(403).json({ error: 'Bu cihaz firmaya atanmış. Cihazı şirket yetkilisi hesabınıza eklemeli.' });
    }

    // Kod sahibi olmayan bireysel kullanıcı cihaz kodunu girdiğinde cihaz
    // sahibine onay isteği gönderilir. Sahip onay verene kadar hedef hesaba
    // allowedMacs yazılmaz.
    const explicitOwners = users.filter((user) => Array.isArray(user.ownedMacs) &&
        user.ownedMacs.some((value) => normalizeMac(value) === compactMac));
    const fallbackOwners = users.filter((user) => user.username !== req.username &&
        Array.isArray(user.allowedMacs) &&
        user.allowedMacs.some((value) => normalizeMac(value) === compactMac));
    const owners = explicitOwners.length > 0 ? explicitOwners : fallbackOwners;
    const owner = owners.length === 1 ? owners[0] : null;
    if (owner && owner.username !== req.username) {
        const requests = readDeviceShareRequests();
        const duplicate = requests.find((request) => request.status === 'pending' &&
            request.ownerUsername === owner.username &&
            request.targetUsername === current.username &&
            request.deviceMac === mac);
        if (duplicate) {
            return res.status(409).json({ error: 'Onay isteğiniz zaten gönderildi; cihaz sahibinin onayı bekleniyor.', pendingApproval: true });
        }

        requests.push({
            id: crypto.randomBytes(12).toString('hex'),
            ownerUsername: owner.username,
            targetUsername: current.username,
            deviceMac: mac,
            deviceId: device.id,
            deviceCode: device.device_code || null,
            location: device.location || null,
            status: 'pending',
            createdAt: new Date().toISOString(),
        });
        writeDeviceShareRequests(requests);
        console.log(`[BLE-CLAIM] onay isteği ${current.username} -> ${owner.username}: ${mac}`);
        return res.status(202).json({
            pendingApproval: true,
            ownerUsername: owner.username,
            message: 'İstek gönderildi. Cihaz sahibi onayladığında cihaz hesabınıza eklenecek.',
        });
    }

    current.allowedMacs = [...new Set([...currentMacs, mac.toUpperCase()])];
    current.ownedMacs = [...new Set([...(Array.isArray(current.ownedMacs) ? current.ownedMacs : []), mac.toUpperCase()])];
    writeUsers(users);
    console.log(`[BLE-CLAIM] ${req.username} cihazı hesabına ekledi: ${mac}`);
    return res.json({
        claimed: true,
        allowed: true,
        deviceCode: device.device_code || null,
        location: device.location || null,
    });
});

// ── Cihazı başka aktif kullanıcıya paylaşma ─────────────────────
// Kaynak kullanıcı cihazı zaten görebiliyor olmalı. Bireysel cihazlarda
// paylaşım, cihazın mevcut allowedMacs yetkisi üzerinden yapılır; şirket
// cihazlarında hem kaynak hem hedef aynı şirkette olmalıdır.
app.post('/api/ble/share-device', requireAuth(), (req, res) => {
    const targetUsername = String(req.body?.username || '').trim();
    const suppliedId = String(req.body?.deviceId || '').trim();
    const token = String(req.body?.deviceToken || '').trim();
    const tokenMac = token ? decodeBleDeviceToken(token) : null;
    const compactMac = tokenMac || suppliedId.replace(/[^0-9a-f]/gi, '').toUpperCase();

    if (!targetUsername) return res.status(400).json({ error: 'Eklenecek kullanıcı adı gerekli' });

    const allDevices = getDevices({});
    let device = null;
    if (/^\d+$/.test(suppliedId)) {
        device = allDevices.find((item) => String(item.id) === suppliedId);
    }
    if (!device && /^[0-9A-F]{12}$/.test(compactMac)) {
        device = allDevices.find((item) =>
            String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase() === compactMac
        );
    }
    if (!device) return res.status(404).json({ error: 'Cihaz kayıtlı değil' });

    const users = readUsers();
    const source = users.find((user) => user.username === req.username);
    const target = users.find((user) => String(user.username || '').toLowerCase() === targetUsername.toLowerCase());
    if (!source) return res.status(404).json({ error: 'Kaynak kullanıcı bulunamadı' });
    if (!target) return res.status(404).json({ error: 'Eklenecek kullanıcı bulunamadı' });
    if (target.role === 'superadmin') return res.status(400).json({ error: 'Superadmin cihaz listesine eklenemez' });
    if (target.status === 'disabled' || target.status === 'pending_email' || target.status === 'pending') {
        return res.status(403).json({ error: 'Sadece aktif kullanıcıya cihaz eklenebilir' });
    }
    if (target.username === source.username) {
        return res.status(400).json({ error: 'Kullanıcı zaten bu hesaba ait' });
    }

    const sourceScope = scopeFor(req);
    if (!allowsDevice(sourceScope, device)) {
        console.warn(`[BLE-SHARE] ${req.username} yetkisiz cihaz paylaşımı denedi: ${device.mac || device.id}`);
        return res.status(403).json({ error: 'Bu cihazı paylaşma yetkiniz yok' });
    }

    const rawDeviceCompany = String(device.company || '').trim();
    const deviceCompany = (!rawDeviceCompany || isIndividualDeviceCompany(rawDeviceCompany)) ? '' : rawDeviceCompany;
    const sourceCompany = String(source.company || '').trim();
    const targetCompany = String(target.company || '').trim();
    const unrestrictedSource = req.userRole === 'superadmin' || (req.userRole === 'admin' && !sourceCompany);
    // Şirket yöneticisi, kendi şirketindeki cihaza daha önce kendi hesabını
    // oluşturmuş ama şirketi henüz boş olan aktif bir kullanıcıyı ekleyebilir.
    // Bu işlem hedef hesabı şirketine bağlar; böylece tek cihaz değil,
    // şirket kapsamındaki tüm cihazlar görünür.
    const canAssignTargetCompany = isCompanyManager(req, sourceCompany) &&
        !!deviceCompany && sourceCompany === deviceCompany && !targetCompany;

    if (!unrestrictedSource && deviceCompany && sourceCompany !== deviceCompany) {
        return res.status(403).json({ error: 'Bu şirket cihazını yalnızca şirket yetkilisi paylaşabilir' });
    }
    if (deviceCompany && targetCompany && targetCompany !== deviceCompany && !unrestrictedSource) {
        return res.status(403).json({ error: 'Şirket cihazı yalnızca aynı şirketteki kullanıcıya eklenebilir' });
    }
    if (deviceCompany && !targetCompany && !canAssignTargetCompany && !unrestrictedSource) {
        return res.status(403).json({ error: 'Bu kullanıcıya önce aynı şirket atanmalı; şirket yöneticisi eklemelidir' });
    }
    if (!deviceCompany && targetCompany && !unrestrictedSource) {
        return res.status(403).json({ error: 'Bireysel cihaz şirket hesabına eklenemez' });
    }

    const normalizedMac = String(device.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(normalizedMac)) {
        return res.status(422).json({ error: 'Cihazın MAC kimliği geçersiz' });
    }
    const formattedMac = normalizedMac.match(/.{2}/g).join(':');
    const targetMacs = Array.isArray(target.allowedMacs) ? target.allowedMacs : [];
    let targetChanged = false;

    if (canAssignTargetCompany) {
        target.company = deviceCompany;
        targetChanged = true;
    }

    // Bireysel cihazı yalnızca sahibi paylaşım isteği oluşturabilir. Yeni
    // sahiplik alanı olmayan eski kayıtlarda, cihazı allowedMacs listesinde
    // taşıyan tek kullanıcı geriye dönük olarak sahip kabul edilir.
    if (!deviceCompany && !unrestrictedSource) {
        const explicitOwners = users.filter((user) => Array.isArray(user.ownedMacs) &&
            user.ownedMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === normalizedMac));
        const fallbackOwners = users.filter((user) => Array.isArray(user.allowedMacs) &&
            user.allowedMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === normalizedMac));
        const owners = explicitOwners.length > 0 ? explicitOwners : fallbackOwners;
        const owner = owners.length === 1 ? owners[0] : null;
        if (owner && owner.username !== source.username) {
            return res.status(403).json({ error: 'Bu cihazın paylaşımını yalnızca cihaz sahibi başlatabilir' });
        }

        const requests = readDeviceShareRequests();
        const duplicate = requests.find((request) => request.status === 'pending' &&
            request.ownerUsername === source.username &&
            request.targetUsername === target.username &&
            request.deviceMac === formattedMac);
        if (duplicate) {
            return res.status(409).json({ error: 'Bu kullanıcı için zaten bekleyen bir onay isteği var', pendingApproval: true });
        }

        const request = {
            id: crypto.randomBytes(12).toString('hex'),
            ownerUsername: source.username,
            targetUsername: target.username,
            deviceMac: formattedMac,
            deviceId: device.id,
            deviceCode: device.device_code || null,
            location: device.location || null,
            status: 'pending',
            createdAt: new Date().toISOString(),
        };
        requests.push(request);
        writeDeviceShareRequests(requests);
        console.log(`[BLE-SHARE] onay bekliyor ${source.username} -> ${target.username}: ${formattedMac}`);
        return res.status(202).json({ pendingApproval: true, ownerUsername: source.username, deviceCode: device.device_code || null });
    }

    if (!targetMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === normalizedMac)) {
        target.allowedMacs = [...new Set([...targetMacs, formattedMac])];
        targetChanged = true;
    }
    if (targetChanged) {
        writeUsers(users);
    }

    console.log(`[BLE-SHARE] ${req.username} -> ${target.username}: ${formattedMac}`);
    return res.json({
        shared: true,
        username: target.username,
        companyAssigned: canAssignTargetCompany,
        company: target.company || null,
        deviceCode: device.device_code || null,
    });
});

// ── Şirket yöneticisi: kullanıcıyı şirket kapsamına alma ─────────
// Bu akış cihaz seçim ekranından bağımsızdır. Şirket yöneticisi Hesap
// Yönetimi bölümünde aktif kullanıcının adını yazar; kullanıcı şirketin
// tüm cihazlarını görür.
app.post('/api/company/assign-user', requireAuth(), (req, res) => {
    const targetUsername = String(req.body?.username || '').trim();
    if (!targetUsername) return res.status(400).json({ error: 'Eklenecek kullanıcı adı gerekli' });

    const users = readUsers();
    const source = users.find((user) => user.username === req.username);
    const target = users.find((user) => String(user.username || '').toLowerCase() === targetUsername.toLowerCase());
    const sourceCompany = String(source?.company || '').trim();

    if (!isCompanyManager(req, sourceCompany)) {
        return res.status(403).json({ error: 'Bu işlem yalnızca şirket yöneticisi hesabından yapılabilir' });
    }
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (target.username === source.username) return res.status(400).json({ error: 'Kendi hesabınız zaten bu şirkete bağlı' });
    if (target.role === 'superadmin') return res.status(400).json({ error: 'Superadmin şirkete atanamaz' });
    if (target.status === 'disabled' || target.status === 'pending_email' || target.status === 'pending') {
        return res.status(403).json({ error: 'Sadece aktif kullanıcı şirkete atanabilir' });
    }
    const targetCompany = String(target.company || '').trim();
    if (targetCompany && targetCompany !== sourceCompany) {
        return res.status(403).json({ error: 'Kullanıcı başka bir şirkete zaten atanmış' });
    }

    target.company = sourceCompany;
    writeUsers(users);
    console.log(`[COMPANY] ${req.username} -> ${target.username}: ${sourceCompany} şirketine atandı`);
    return res.json({ assigned: true, username: target.username, company: sourceCompany });
});

// ── Şirket yöneticisi: kullanıcının şirket erişimini kaldırma ─────
app.post('/api/company/revoke-user', requireAuth(), (req, res) => {
    const targetUsername = String(req.body?.username || '').trim();
    if (!targetUsername) return res.status(400).json({ error: 'Erişimi kaldırılacak kullanıcı adı gerekli' });

    const users = readUsers();
    const source = users.find((user) => user.username === req.username);
    const target = users.find((user) => String(user.username || '').toLowerCase() === targetUsername.toLowerCase());
    const sourceCompany = String(source?.company || '').trim();

    if (!isCompanyManager(req, sourceCompany)) {
        return res.status(403).json({ error: 'Bu işlem yalnızca şirket yöneticisi hesabından yapılabilir' });
    }
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (target.username === source.username) return res.status(400).json({ error: 'Kendi şirket erişiminizi kaldıramazsınız' });
    if (target.role === 'superadmin') return res.status(400).json({ error: 'Superadmin erişimi kaldırılamaz' });
    if (String(target.company || '').trim() !== sourceCompany) {
        return res.status(404).json({ error: 'Kullanıcının bu şirkete erişimi yok' });
    }

    const result = removeCompanyAccess(target, sourceCompany, getDevices({}));
    if (!result.changed) return res.status(404).json({ error: 'Kullanıcının bu şirkete erişimi yok' });
    writeUsers(users);
    console.log(`[COMPANY] ${req.username} -> ${target.username}: ${sourceCompany} şirket erişimi kaldırıldı`);
    return res.json({ revoked: true, username: target.username, company: null, removedMacCount: result.removedMacCount });
});

// ── Kullanıcının cihaz/şirket erişimini kaldırma ─────────────────
// Şirket yöneticisi kendi şirketindeki kullanıcıyı şirketten çıkarabilir.
// Şirket erişimi kaldırıldığında kullanıcının o şirkete ait cihaz MAC'leri
// de allowedMacs listesinden temizlenir; başka şirket/bireysel cihazları
// korunur. Bireysel cihazlarda ise yalnızca ilgili cihaz yetkisi kaldırılır.
app.post('/api/ble/revoke-device-access', requireAuth(), (req, res) => {
    const targetUsername = String(req.body?.username || '').trim();
    const suppliedId = String(req.body?.deviceId || '').trim();
    const token = String(req.body?.deviceToken || '').trim();
    const tokenMac = token ? decodeBleDeviceToken(token) : null;
    const compactMac = tokenMac || suppliedId.replace(/[^0-9a-f]/gi, '').toUpperCase();

    if (!targetUsername) return res.status(400).json({ error: 'Erişimi kaldırılacak kullanıcı adı gerekli' });

    const allDevices = getDevices({});
    let device = null;
    if (/^\d+$/.test(suppliedId)) {
        device = allDevices.find((item) => String(item.id) === suppliedId);
    }
    if (!device && /^[0-9A-F]{12}$/.test(compactMac)) {
        device = allDevices.find((item) =>
            String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase() === compactMac
        );
    }
    if (!device) return res.status(404).json({ error: 'Cihaz kayıtlı değil' });

    const users = readUsers();
    const source = users.find((user) => user.username === req.username);
    const target = users.find((user) => String(user.username || '').toLowerCase() === targetUsername.toLowerCase());
    if (!source) return res.status(404).json({ error: 'Kaynak kullanıcı bulunamadı' });
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (target.role === 'superadmin') return res.status(400).json({ error: 'Superadmin erişimi kaldırılamaz' });
    if (target.username === source.username) return res.status(400).json({ error: 'Kendi erişiminizi bu işlemle kaldıramazsınız' });

    const sourceScope = scopeFor(req);
    if (!allowsDevice(sourceScope, device)) {
        console.warn(`[BLE-REVOKE] ${req.username} yetkisiz erişim kaldırma denedi: ${device.mac || device.id}`);
        return res.status(403).json({ error: 'Bu cihazın erişimini kaldırma yetkiniz yok' });
    }

    const rawDeviceCompany = String(device.company || '').trim();
    const deviceCompany = (!rawDeviceCompany || isIndividualDeviceCompany(rawDeviceCompany)) ? '' : rawDeviceCompany;
    const sourceCompany = String(source.company || '').trim();
    const targetCompany = String(target.company || '').trim();
    const unrestrictedSource = req.userRole === 'superadmin' || (req.userRole === 'admin' && !sourceCompany);

    if (deviceCompany) {
        const companyManager = req.userRole === 'admin' && sourceCompany === deviceCompany;
        if (!unrestrictedSource && !companyManager) {
            return res.status(403).json({ error: 'Bu şirket kullanıcısının erişimini yalnızca şirket yöneticisi kaldırabilir' });
        }
        if (targetCompany !== deviceCompany) {
            return res.status(404).json({ error: 'Kullanıcının bu şirkete erişimi yok' });
        }

        const companyMacs = new Set(allDevices
            .filter((item) => String(item.company || '').trim() === deviceCompany)
            .map((item) => String(item.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase())
            .filter((mac) => /^[0-9A-F]{12}$/.test(mac)));
        const targetMacs = Array.isArray(target.allowedMacs) ? target.allowedMacs : [];
        const filteredMacs = targetMacs.filter((value) => !companyMacs.has(String(value).replace(/[^0-9a-f]/gi, '').toUpperCase()));
        const removedMacCount = targetMacs.length - filteredMacs.length;
        target.allowedMacs = filteredMacs;
        target.company = null;
        writeUsers(users);

        console.log(`[BLE-REVOKE] ${req.username} -> ${target.username}: ${deviceCompany} şirket erişimi kaldırıldı`);
        return res.json({
            revoked: true,
            username: target.username,
            companyRevoked: true,
            removedMacCount,
            message: 'Kullanıcının şirket cihazlarına erişimi kaldırıldı',
        });
    }

    // Bireysel cihazı yalnızca sahibi (veya superadmin) paylaşım kapsamından
    // çıkarabilir. Şirket yöneticisi bireysel cihaz erişimini kaldıramaz.
    if (!unrestrictedSource) {
        const normalizedMac = String(device.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
        const explicitOwners = users.filter((user) => Array.isArray(user.ownedMacs) &&
            user.ownedMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === normalizedMac));
        const fallbackOwners = users.filter((user) => Array.isArray(user.allowedMacs) &&
            user.allowedMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === normalizedMac));
        const owners = explicitOwners.length > 0 ? explicitOwners : fallbackOwners;
        const owner = owners.length === 1 ? owners[0] : null;
        if (!owner || owner.username !== source.username) {
            return res.status(403).json({ error: 'Bireysel cihaz erişimini yalnızca cihaz sahibi kaldırabilir' });
        }
    }

    const normalizedMac = String(device.mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(normalizedMac)) {
        return res.status(422).json({ error: 'Cihazın MAC kimliği geçersiz' });
    }
    const targetMacs = Array.isArray(target.allowedMacs) ? target.allowedMacs : [];
    const filteredMacs = targetMacs.filter((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() !== normalizedMac);
    if (filteredMacs.length === targetMacs.length) {
        return res.status(404).json({ error: 'Kullanıcının bu cihaz için erişimi yok' });
    }

    target.allowedMacs = filteredMacs;
    writeUsers(users);

    const formattedMac = normalizedMac.match(/.{2}/g).join(':');
    const requests = readDeviceShareRequests();
    let pendingChanged = false;
    for (const request of requests) {
        if (request.status === 'pending' && request.ownerUsername === source.username &&
            request.targetUsername === target.username && request.deviceMac === formattedMac) {
            request.status = 'revoked';
            request.revokedAt = new Date().toISOString();
            pendingChanged = true;
        }
    }
    if (pendingChanged) writeDeviceShareRequests(requests);

    console.log(`[BLE-REVOKE] ${req.username} -> ${target.username}: ${formattedMac}`);
    return res.json({ revoked: true, username: target.username, companyRevoked: false, deviceCode: device.device_code || null });
});

// Bireysel cihaz paylaşım istekleri yalnızca cihaz sahibine görünür.
app.get('/api/me/device-share-requests', requireAuth(), (req, res) => {
    const requests = readDeviceShareRequests()
        .filter((request) => request.ownerUsername === req.username && request.status === 'pending')
        .map((request) => ({ ...request }));
    return res.json({ requests });
});

function resolveShareRequest(req, requestId) {
    const requests = readDeviceShareRequests();
    const index = requests.findIndex((request) => request.id === requestId);
    if (index < 0) return { requests, index, request: null };
    return { requests, index, request: requests[index] };
}

app.post('/api/me/device-share-requests/:id/approve', requireAuth(), (req, res) => {
    const resolved = resolveShareRequest(req, req.params.id);
    if (!resolved.request) return res.status(404).json({ error: 'Onay isteği bulunamadı' });
    if (resolved.request.ownerUsername !== req.username) return res.status(403).json({ error: 'Bu isteği yalnızca cihaz sahibi onaylayabilir' });
    if (resolved.request.status !== 'pending') return res.status(409).json({ error: 'Bu istek artık beklemede değil' });

    const users = readUsers();
    const target = users.find((user) => user.username === resolved.request.targetUsername);
    if (!target || target.status === 'disabled' || target.status === 'pending_email' || target.status === 'pending') {
        return res.status(404).json({ error: 'Eklenecek kullanıcı artık aktif değil' });
    }

    const mac = String(resolved.request.deviceMac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(mac)) return res.status(422).json({ error: 'Cihaz kimliği geçersiz' });
    const targetMacs = Array.isArray(target.allowedMacs) ? target.allowedMacs : [];
    if (!targetMacs.some((value) => String(value).replace(/[^0-9a-f]/gi, '').toUpperCase() === mac)) {
        target.allowedMacs = [...new Set([...targetMacs, mac.match(/.{2}/g).join(':')])];
        writeUsers(users);
    }

    resolved.request.status = 'approved';
    resolved.request.approvedAt = new Date().toISOString();
    writeDeviceShareRequests(resolved.requests);
    console.log(`[BLE-SHARE] onaylandı ${req.username} -> ${target.username}: ${resolved.request.deviceMac}`);
    return res.json({ approved: true, username: target.username, deviceCode: resolved.request.deviceCode || null });
});

app.post('/api/me/device-share-requests/:id/reject', requireAuth(), (req, res) => {
    const resolved = resolveShareRequest(req, req.params.id);
    if (!resolved.request) return res.status(404).json({ error: 'Onay isteği bulunamadı' });
    if (resolved.request.ownerUsername !== req.username) return res.status(403).json({ error: 'Bu isteği yalnızca cihaz sahibi reddedebilir' });
    if (resolved.request.status !== 'pending') return res.status(409).json({ error: 'Bu istek artık beklemede değil' });

    resolved.request.status = 'rejected';
    resolved.request.rejectedAt = new Date().toISOString();
    writeDeviceShareRequests(resolved.requests);
    console.log(`[BLE-SHARE] reddedildi ${req.username}: ${resolved.request.targetUsername} / ${resolved.request.deviceMac}`);
    return res.json({ rejected: true });
});

// =============================================
//  KULLANICI YÖNETİMİ — sadece superadmin
// =============================================

function requireSuperadmin(req, res, next) {
    if (req.userRole !== 'superadmin') {
        return res.status(403).json({ error: 'Bu işlem için superadmin yetkisi gerekli' });
    }
    next();
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Şifre kuralları — tüm şifre belirleme/değiştirme uçlarında (kullanıcı
// oluşturma, kendi şifresini değiştirme, e-posta ile sıfırlama) ortak kullanılır.
function passwordPolicyError(pw) {
    if (!pw || pw.length < 6) return 'Şifre en az 6 karakter olmalı';
    if (!/[a-z]/.test(pw)) return 'Şifre en az bir küçük harf içermeli';
    if (!/[A-Z]/.test(pw)) return 'Şifre en az bir büyük harf içermeli';
    if (!/[^a-zA-Z0-9]/.test(pw)) return 'Şifre en az bir özel karakter içermeli';
    return null;
}

// ── PUBLIC KAYIT + E-POSTA DOĞRULAMA ───────────────────────────
// Yeni hesaplar operator + pending_email açılır. Kullanıcı e-postasına
// gönderilen 6 haneli kodu girince hesap active olur. Cihaz/şirket yetkisi
// yine otomatik verilmez.
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.REGISTER_RATE_LIMIT) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla kayıt denemesi — lütfen daha sonra tekrar deneyin' },
});

app.post('/api/register', registerLimiter, async (req, res) => {
    const fullName = String(req.body?.fullName || '').trim();
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!fullName || !username || !password) {
        return res.status(400).json({ error: 'Ad soyad, kullanıcı adı ve şifre gerekli' });
    }
    if (fullName.length < 2 || fullName.length > 80) {
        return res.status(400).json({ error: 'Ad soyad 2-80 karakter olmalı' });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı (harf/rakam/_/-)' });
    }
    if (email && !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'Geçersiz e-posta adresi' });
    }
    const registerPwError = passwordPolicyError(password);
    if (registerPwError) return res.status(400).json({ error: registerPwError });

    const users = readUsers();
    const usernameTaken = users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase());
    if (usernameTaken) return res.status(409).json({ error: 'Bu kullanıcı adı zaten mevcut' });
    if (email && users.some((u) => String(u.email || '').toLowerCase() === email)) {
        return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
    }

    if (!email) {
        return res.status(400).json({ error: 'E-posta adresi doğrulama kodu için gerekli' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const verificationCode = String(crypto.randomInt(100000, 1000000));
        const verificationCodeHash = crypto.createHash('sha256').update(verificationCode).digest('hex');

        // Mail gönderilemezse doğrulanamayacak hesabı users.json'a yazmayalım.
        await sendRegistrationVerificationEmail(email, fullName, username, verificationCode);

        users.push({
            username,
            fullName,
            passwordHash,
            role: 'operator',
            status: 'pending_email',
            company: null,
            allowedMacs: [],
            email,
            verificationCodeHash,
            verificationExpiresAt: Date.now() + 10 * 60 * 1000,
            verificationAttempts: 0,
            createdAt: new Date().toISOString(),
        });
        writeUsers(users);
        console.log(`[REGISTER] doğrulama maili gönderildi: ${username} -> ${email}`);
        return res.status(201).json({
            message: 'Doğrulama kodu e-posta adresinize gönderildi.',
            username,
            status: 'pending_email',
            verificationRequired: true,
            emailSent: true,
        });
    } catch (e) {
        console.error('[REGISTER] doğrulama maili/kayıt başarısız:', e.message);
        return res.status(503).json({ error: 'Doğrulama e-postası gönderilemedi. SMTP ayarlarını kontrol edin.' });
    }
});

const registerVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.REGISTER_VERIFY_RATE_LIMIT) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla kod denemesi — lütfen daha sonra tekrar deneyin' },
});

function verificationHash(code) {
    return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

app.post('/api/register/verify', registerVerifyLimiter, (req, res) => {
    const username = String(req.body?.username || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!username || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '6 haneli doğrulama kodu gerekli' });
    }

    const users = readUsers();
    const user = users.find((u) => String(u.username || '').toLowerCase() === username.toLowerCase());
    if (!user || user.status !== 'pending_email' || !user.verificationCodeHash) {
        return res.status(400).json({ error: 'Doğrulama kodu geçersiz veya süresi dolmuş' });
    }
    if (Number(user.verificationAttempts || 0) >= 5) {
        return res.status(429).json({ error: 'Çok fazla hatalı kod denemesi. Yeni kod isteyin.' });
    }
    if (Number(user.verificationExpiresAt || 0) < Date.now()) {
        return res.status(410).json({ error: 'Doğrulama kodunun süresi dolmuş. Yeni kod isteyin.' });
    }
    if (verificationHash(code) !== user.verificationCodeHash) {
        user.verificationAttempts = Number(user.verificationAttempts || 0) + 1;
        writeUsers(users);
        return res.status(400).json({ error: 'Doğrulama kodu hatalı' });
    }

    user.status = 'active';
    delete user.verificationCodeHash;
    delete user.verificationExpiresAt;
    delete user.verificationAttempts;
    writeUsers(users);
    console.log(`[REGISTER] e-posta doğrulandı: ${user.username}`);
    return res.json({ message: 'E-posta doğrulandı. Artık giriş yapabilirsiniz.', username: user.username, status: 'active' });
});

const registerResendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.REGISTER_RESEND_RATE_LIMIT) || 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla kod istemi — lütfen daha sonra tekrar deneyin' },
});

app.post('/api/register/resend', registerResendLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const users = readUsers();
    const user = users.find((u) => String(u.username || '').toLowerCase() === username.toLowerCase());
    // Eski sürümde yönetici onayı bekleyen kullanıcılar da burada e-posta
    // kodu alarak yeni akışa geçirilebilir.
    if (!user || !['pending', 'pending_email'].includes(user.status) || !user.email) {
        return res.status(400).json({ error: 'Kod gönderilemedi' });
    }

    try {
        const code = String(crypto.randomInt(100000, 1000000));
        await sendRegistrationVerificationEmail(user.email, user.fullName, user.username, code);
        user.verificationCodeHash = verificationHash(code);
        user.verificationExpiresAt = Date.now() + 10 * 60 * 1000;
        user.verificationAttempts = 0;
        user.status = 'pending_email';
        writeUsers(users);
        return res.json({ message: 'Yeni doğrulama kodu gönderildi.' });
    } catch (e) {
        console.error(`[REGISTER] yeni doğrulama maili gönderilemedi: ${e.message}`);
        return res.status(503).json({ error: 'Doğrulama e-postası gönderilemedi. SMTP ayarlarını kontrol edin.' });
    }
});

app.get('/api/users', requireAuth(), requireSuperadmin, (_req, res) => {
    const users = readUsers();
    res.json(users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        company: u.company || null,
        allowedMacs: Array.isArray(u.allowedMacs) ? u.allowedMacs : [],
        email: u.email || null,
        status: u.status || 'active',
        createdAt: u.createdAt,
    })));
});

app.post('/api/users', requireAuth(), requireSuperadmin, async (req, res) => {
    const { username, fullName, password, role, company, allowedMacs, email } = req.body || {};

    if (!username || !fullName || !password || !role) {
        return res.status(400).json({ error: 'Tüm alanlar gerekli' });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter (harf/rakam/_/-)' });
    }
    const createPwError = passwordPolicyError(password);
    if (createPwError) {
        return res.status(400).json({ error: createPwError });
    }
    if (role !== 'admin' && role !== 'operator') {
        return res.status(400).json({ error: 'Rol "admin" veya "operator" olmalı' });
    }
    if (email && !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'Geçersiz e-posta adresi' });
    }

    const users = readUsers();
    if (users.find((u) => u.username === username)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten mevcut' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const cleanMacs = Array.isArray(allowedMacs)
            ? [...new Set(allowedMacs.map((m) => String(m).trim().toUpperCase()).filter((m) => MAC_REGEX.test(m)))]
            : [];
        users.push({
            username, fullName, passwordHash, role,
            company: company || null,
            allowedMacs: cleanMacs,
            email: email || null,
            createdAt: new Date().toISOString(),
        });
        writeUsers(users);
        console.log(`[USERS] ${req.username} yeni kullanıcı ekledi: ${username} (${role})`);
        res.json({ message: 'Kullanıcı eklendi', username });
    } catch (e) {
        res.status(500).json({ error: 'Kullanıcı eklenemedi' });
    }
});

// ── Kullanicinin sirket / cihaz yetkisini duzenle ── //
app.put('/api/users/:username', requireAuth(), requireSuperadmin, async (req, res) => {
    const { company, allowedMacs, role, email, status } = req.body || {};
    const users = readUsers();
    const user = users.find((u) => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Superadmin yetkisi değiştirilemez' });

    if (role !== undefined) {
        if (role !== 'admin' && role !== 'operator') {
            return res.status(400).json({ error: 'Rol "admin" veya "operator" olmalı' });
        }
        user.role = role;
    }
    if (company !== undefined) user.company = company || null;
    if (allowedMacs !== undefined) {
        user.allowedMacs = Array.isArray(allowedMacs)
            ? [...new Set(allowedMacs.map((m) => String(m).trim().toUpperCase()).filter((m) => MAC_REGEX.test(m)))]
            : [];
    }
    if (email !== undefined) {
        if (email && !EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: 'Geçersiz e-posta adresi' });
        }
        user.email = email || null;
    }
    const previousStatus = user.status || 'active';
    if (status !== undefined) {
        if (!['pending', 'pending_email', 'active', 'disabled'].includes(status)) {
            return res.status(400).json({ error: 'Geçersiz kullanıcı durumu' });
        }
        user.status = status;
    }

    writeUsers(users);
    let approvalEmailSent = false;
    if (status === 'active' && previousStatus !== 'active' && user.email) {
        try {
            await sendRegistrationApprovedEmail(user.email, user.fullName, user.username);
            approvalEmailSent = true;
            console.log(`[USERS] onay maili gönderildi: ${user.username} -> ${user.email}`);
        } catch (mailError) {
            console.error(`[USERS] onay maili gönderilemedi: ${mailError.message}`);
        }
    }
    console.log(`[USERS] ${req.username} yetki güncelledi: ${user.username} (şirket: ${user.company || '—'}, cihaz: ${(user.allowedMacs || []).length})`);
    res.json({ message: 'Yetkiler güncellendi', approvalEmailSent });
});

app.delete('/api/users/:username', requireAuth(), requireSuperadmin, async (req, res) => {
    const targetUsername = req.params.username;
    if (targetUsername === req.username) return res.status(400).json({ error: 'Kendinizi silemezsiniz' });

    const users = readUsers();
    const idx = users.findIndex((u) => u.username === targetUsername);
    if (idx === -1) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (users[idx].role === 'superadmin') return res.status(403).json({ error: 'Superadmin silinemez' });

    users.splice(idx, 1);
    writeUsers(users);

    for (const tok of Object.keys(activeSessions)) {
        if (activeSessions[tok].username === targetUsername) delete activeSessions[tok];
    }
    await removeSlot(targetUsername).catch(() => {});

    console.log(`[USERS] ${req.username} sildi: ${targetUsername}`);
    res.json({ message: 'Kullanıcı silindi' });
});

// Kendi e-postasını tanımla/güncelle — herhangi bir rol, sadece kendi hesabı için.
// Şifresini unutan bir kullanıcının bize ulaşabilmesi için (forgot-password akışı)
// her hesapta bir e-posta olması hedefleniyor; kendi şifresini değiştirme de
// aşağıda bu alan doluysa açılıyor.
app.put('/api/me/email', requireAuth(), async (req, res) => {
    const { email, currentPassword } = req.body || {};
    if (!email || !EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
    }
    if (!currentPassword) {
        return res.status(400).json({ error: 'Mevcut şifreniz gerekli' });
    }

    const users = readUsers();
    const user = users.find((u) => u.username === req.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Kurtarma e-postası, hesap ele geçirme senaryolarında en çok istismar edilen
    // alanlardan biri — bu yüzden değiştirmeden önce şifre ile "step-up" doğrulama
    // isteniyor (Google/GitHub vb. sitelerdeki yaklaşımın aynısı).
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Şifre hatalı' });

    user.email = email;
    writeUsers(users);
    console.log(`[USERS] ${req.username} kendi e-postasını tanımladı`);
    res.json({ message: 'E-posta kaydedildi', email });
});

// Kendi kullanıcı adını değiştir — herhangi bir rol, sadece kendi hesabı için.
// Kullanıcı adı; aktif oturumların (activeSessions) ve cihaz bağlantı slotlarının
// (target.json/responses.json/slotMeta) anahtarı olduğu için değişince eski
// kullanıcı adına ait her şey temizlenir ve kullanıcı yeniden giriş yapmalıdır.
app.put('/api/me/username', requireAuth(), async (req, res) => {
    const { newUsername, currentPassword } = req.body || {};
    const oldUsername = req.username;

    if (!newUsername || !/^[a-zA-Z0-9_-]{3,32}$/.test(newUsername)) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı (harf/rakam/_/-)' });
    }
    if (newUsername === oldUsername) {
        return res.status(400).json({ error: 'Yeni kullanıcı adı mevcut kullanıcı adıyla aynı' });
    }
    if (!currentPassword) {
        return res.status(400).json({ error: 'Mevcut şifreniz gerekli' });
    }

    const users = readUsers();
    if (users.some((u) => u.username === newUsername)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor' });
    }

    const user = users.find((u) => u.username === oldUsername);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Kullanıcı adı = giriş bilgisi — e-postada olduğu gibi burada da şifre ile
    // step-up doğrulama isteniyor (ele geçirilmiş bir oturumun sessizce hesabı
    // devralmasını engellemek için).
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Şifre hatalı' });

    user.username = newUsername;
    writeUsers(users);

    // Eski kullanıcı adına bağlı aktif cihaz bağlantısını/oturum verisini temizle.
    await removeSlot(oldUsername).catch(() => {});

    // Bu kullanıcının tüm token'ları (isteğin kendi token'ı dahil) iptal edilir —
    // yeni kullanıcı adıyla tekrar giriş yapması gerekir.
    for (const tok of Object.keys(activeSessions)) {
        if (activeSessions[tok].username === oldUsername) delete activeSessions[tok];
    }

    console.log(`[USERS] ${oldUsername} kullanıcı adını ${newUsername} olarak değiştirdi`);
    res.json({ message: 'Kullanıcı adı değiştirildi', username: newUsername });
});

app.post('/api/users/:username/password', requireAuth(), async (req, res) => {
    const targetUsername = req.params.username;
    const { newPassword, oldPassword } = req.body || {};

    const changePwError = passwordPolicyError(newPassword);
    if (changePwError) {
        return res.status(400).json({ error: changePwError });
    }

    const isSelf = req.username === targetUsername;
    const isSuperadmin = req.userRole === 'superadmin';

    if (!isSelf && !isSuperadmin) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    }

    const users = readUsers();
    const user = users.find((u) => u.username === targetUsername);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Kendi şifresini değiştiren herkes (rol fark etmez) önce bir kurtarma
    // e-postası tanımlamış olmalı — aksi halde yeni şifreyi unutursa hesabına
    // ulaşmanın hiçbir yolu kalmaz.
    if (isSelf && !user.email) {
        return res.status(400).json({ error: 'Şifre değiştirmeden önce e-posta adresinizi tanımlamalısınız' });
    }

    if (isSelf && !isSuperadmin) {
        if (!oldPassword) return res.status(400).json({ error: 'Eski şifre gerekli' });
        const ok = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'Eski şifre hatalı' });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsOld) {
        return res.status(400).json({ error: 'Yeni şifre eski şifreyle aynı olamaz' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    writeUsers(users);
    console.log(`[USERS] ${req.username} şifre değiştirdi: ${targetUsername}`);
    res.json({ message: 'Şifre değiştirildi' });
});

// =============================================
//  ŞİFREMİ UNUTTUM — e-posta ile şifre sıfırlama
//  Oturum gerektirmez. Token bellekte tutulur (activeSessions ile aynı
//  desen) — tek kullanımlık, 30dk geçerli.
// =============================================

const PASSWORD_RESET_TOKEN_TTL = 30 * 60 * 1000; // 30 dakika
const passwordResetTokens = {}; // token -> { username, expiresAt }

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.FORGOT_PASSWORD_RATE_LIMIT) || 5, // testlerde yüksek bir değere set edilir
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla istek — lütfen daha sonra tekrar deneyin' },
});

app.post('/api/forgot-password', forgotPasswordLimiter, async (req, res) => {
    const { username } = req.body || {};
    // Kullanıcı adı sistemde olsun ya da olmasın aynı yanıt dönülür —
    // aksi halde yanıt farkından hangi kullanıcı adlarının var olduğu anlaşılabilir.
    const genericResponse = { message: 'Eğer bu kullanıcı adı sistemde kayıtlıysa, şifre sıfırlama e-postası gönderildi.' };

    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli' });

    const users = readUsers();
    const user = users.find((u) => u.username === username);

    if (!user || !user.email) {
        return res.json(genericResponse);
    }

    const token = crypto.randomBytes(32).toString('hex');
    passwordResetTokens[token] = { username: user.username, expiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL };
    const resetLink = `${PUBLIC_BASE_URL}/?resetToken=${token}`;

    try {
        await sendPasswordResetEmail(user.email, resetLink, user.fullName);
        console.log(`[AUTH] ${username} için şifre sıfırlama e-postası gönderildi`);
    } catch (e) {
        console.error(`[AUTH] şifre sıfırlama e-postası gönderilemedi (${username}):`, e.message);
    }

    res.json(genericResponse);
});

app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ error: 'Token ve yeni şifre gerekli' });
    const resetPwError = passwordPolicyError(newPassword);
    if (resetPwError) return res.status(400).json({ error: resetPwError });

    const entry = passwordResetTokens[token];
    if (!entry || entry.expiresAt < Date.now()) {
        delete passwordResetTokens[token];
        return res.status(400).json({ error: 'Link geçersiz veya süresi dolmuş' });
    }

    const users = readUsers();
    const user = users.find((u) => u.username === entry.username);
    if (!user) {
        delete passwordResetTokens[token];
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsOld) {
        return res.status(400).json({ error: 'Yeni şifre eski şifreyle aynı olamaz' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    writeUsers(users);
    delete passwordResetTokens[token];

    // Güvenlik: linkle şifre değiştirilince bu kullanıcının tüm aktif oturumları iptal edilir.
    for (const tok of Object.keys(activeSessions)) {
        if (activeSessions[tok].username === user.username) delete activeSessions[tok];
    }

    console.log(`[AUTH] ${user.username} şifresini sıfırlama linkiyle değiştirdi`);
    res.json({ message: 'Şifre başarıyla değiştirildi' });
});

// =============================================
//  JSON YARDIMCILARI
// =============================================

function readJsonRaw(p) {
    return new Promise((resolve, reject) => {
        fs.readFile(p, 'utf-8', (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    const defaults = {
                        [TARGET_PATH]: { requests: [] },
                        [RESPONSES_PATH]: { responses: {} }
                    };
                    const def = defaults[p] || {};
                    fs.writeFile(p, JSON.stringify(def, null, 2), 'utf-8', (we) => {
                        if (we) return reject(we);
                        console.log(`[AUTO] ${p} oluşturuldu`);
                        resolve(def);
                    });
                    return;
                }
                return reject(err);
            }
            try { resolve(JSON.parse(data)); }
            catch (e) {
                setTimeout(() => {
                    fs.readFile(p, 'utf-8', (err2, data2) => {
                        if (err2) return reject(err2);
                        try { resolve(JSON.parse(data2)); }
                        catch (e2) { reject(e2); }
                    });
                }, 80);
            }
        });
    });
}

// Aynı dosyaya (özellikle target.json) eşzamanlı yazımlar — paralel bulk-job
// şeritleri ya da birden fazla kullanıcı aynı anda — ayrı ayrı .tmp dosyaları
// kullanmıyor, HEPSİ "<path>.tmp" ismini paylaşıyor. İki yazım üst üste
// binerse biri diğerinin .tmp'sini yeniden adlandırmaya çalışırken
// "ENOENT: no such file" alır (dosya zaten öbürü tarafından taşınmış).
// Bu yüzden aynı path'e yazımlar burada SIRAYLA (bir kuyrukla) yapılıyor.
const writeQueues = new Map(); // filePath -> son yazımın "kesin bitti" sözü (hiç reddetmez)
function writeJsonRaw(filePath, data) {
    const prevSettled = writeQueues.get(filePath) || Promise.resolve();
    const result = prevSettled.then(() => new Promise((resolve, reject) => {
        const tmpPath = filePath + '.tmp';
        const content = JSON.stringify(data, null, 2);
        fs.writeFile(tmpPath, content, 'utf-8', (err) => {
            if (err) return reject(err);
            fs.rename(tmpPath, filePath, (rErr) => {
                if (rErr) return reject(rErr);
                resolve();
            });
        });
    }));
    // Kuyruğa, hatayla da bitse bir sonrakini engellemeyecek "sessiz" hâlini koy —
    // ama çağırana gerçek başarı/hata result üzerinden aynen ulaşır.
    writeQueues.set(filePath, result.catch(() => {}));
    return result;
}

// ── Genel amaçlı kilit (mutex) ──
// writeJsonRaw'daki kuyruk sadece SON yazma adımını sıraya koyuyordu — ama
// "oku target.json'ı -> değiştir -> yaz" dizisinin TAMAMI atomik değilse şu
// olabiliyor: İki şerit nerdeyse aynı anda okur (ikisi de aynı eski hâli
// görür), ikisi de kendi değişikliğini üstüne ekleyip yazar — yazmalar
// sırayla gerçekleşir ama İKİNCİSİ, BİRİNCİNİN eklediği değişikliği hiç
// görmediği için yazdığında onu SİLER (ya da tam tersi, silinen bir slot'u
// geri diriltir). Sahada gerçekten gözlendi: bir bulk-job şeridinin
// removeSlot'u, tam o anda başka bir şeridin activate yazmasıyla çakışıp
// kaybolmuştu — cihaz sonsuza dek "meşgul" görünmeye devam etti.
// Çözüm: "oku+değiştir+yaz" dizisinin TAMAMINI (sadece son yazmayı değil)
// dosya bazlı bir kilitle sarmalamak — bkz. withLock kullanan yerler.
const criticalSectionLocks = new Map();
function withLock(key, fn) {
    const prev = criticalSectionLocks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    criticalSectionLocks.set(key, run.catch(() => {}));
    return run;
}

// target.json yapısı garanti et: { requests: [...] }
async function readTarget() {
    let data;
    try { data = await readJsonRaw(TARGET_PATH); }
    catch (e) { data = { requests: [] }; }
    if (!data || typeof data !== 'object') data = { requests: [] };
    if (!Array.isArray(data.requests)) data.requests = [];
    return data;
}

// ESP'den okunan değerler veritabanına işlenir (bkz. device-inventory-sync.js)
const { initDeviceInventorySync } = require('./device-inventory-sync');
const inventorySync = initDeviceInventorySync({ readTarget, getDevices, updateDeviceInventoryByMac });
let archiveAutoPull = null; // aşağıda başlatılır (bkz. archive-auto-pull.js)

// responses.json yapısı garanti et: { responses: { ... } }
async function readResponses() {
    let data;
    try { data = await readJsonRaw(RESPONSES_PATH); }
    catch (e) { data = { responses: {} }; }
    if (!data || typeof data !== 'object') data = { responses: {} };
    if (!data.responses || typeof data.responses !== 'object') data.responses = {};
    try { inventorySync.observe(data); } catch {}
    try { archiveAutoPull?.observe(data); } catch {}
    return data;
}

// =============================================
//  SLOT YÖNETİMİ
// =============================================

// Slot bul (yoksa oluştur)
function findOrCreateSlot(requests, sessionId, defaultTarget = "") {
    let slot = requests.find((r) => r.session_id === sessionId);
    if (!slot) {
        slot = {
            session_id: sessionId,
            target: defaultTarget,
            control: "deactivate",
            send_message: ""
        };
        requests.push(slot);
    }
    return slot;
}

// Slot'u target.json + responses.json + slotMeta'dan tamamen sil
async function removeSlot(sessionId) {
    try {
        await withLock(TARGET_PATH, async () => {
            const t = await readTarget();
            t.requests = t.requests.filter((r) => r.session_id !== sessionId);
            await writeJsonRaw(TARGET_PATH, t);
        });
    } catch (e) { console.error('removeSlot target:', e); }

    try {
        await withLock(RESPONSES_PATH, async () => {
            const r = await readResponses();
            if (r.responses[sessionId]) {
                delete r.responses[sessionId];
                await writeJsonRaw(RESPONSES_PATH, r);
            }
        });
    } catch (e) { console.error('removeSlot responses:', e); }

    delete slotMeta[sessionId];
    console.log(`[SLOT] silindi: ${sessionId}`);
}

// Periyodik slot temizliği — INACTIVITY_TIMEOUT boyunca hareketsiz kalan bağlantılar
// önce yumuşak kapatılır (kullanıcıya "inaktivite" bildirimi gösterilsin diye),
// hâlâ kimse geri dönmezse bir INACTIVITY_TIMEOUT daha sonra tamamen silinir.
// require.main guard: server.js bir test dosyasından require() edildiğinde bu
// arka plan işi başlamasın (gerçek başlatmada — node server.js — davranış aynı).
if (require.main === module) {
setInterval(async () => {
    const now = Date.now();
    const timedOut = [];
    for (const [sessionId, meta] of Object.entries(slotMeta)) {
        if (!meta.lastActivity) continue;
        if (now - meta.lastActivity > INACTIVITY_TIMEOUT) timedOut.push(sessionId);
    }
    if (timedOut.length === 0) return;

    // Deaktif etmeden önce cihazdaki açık log modlarını kapat (slot hâlâ aktifken)
    for (const sessionId of timedOut) {
        await stopDeviceLogs(sessionId).catch(() => {});
    }

    const toHardRemove = [];
    try {
        const data = await readTarget();
        let changed = false;
        for (const sessionId of timedOut) {
            const slot = data.requests.find((r) => r.session_id === sessionId);
            if (slot && slot.control === 'activate') {
                slot.control = 'deactivate';
                changed = true;
                slotMeta[sessionId].lastDeactivatedBy = 'İnaktivite (5 dakika boyunca işlem yapılmadı)';
                slotMeta[sessionId].lastActivity = now; // hemen tekrar zaman aşımına uğramasın, bildirimi görmeye vakti olsun
                console.log(`[CLEANUP] ${sessionId} inaktivite nedeniyle deaktif edildi`);
            } else {
                toHardRemove.push(sessionId);
            }
        }
        if (changed) await writeJsonRaw(TARGET_PATH, data);
    } catch (e) {
        console.error('[CLEANUP] deaktivasyon hatası:', e.message);
    }

    for (const sessionId of toHardRemove) {
        console.log(`[CLEANUP] ${sessionId} uzun süre inaktif — slot tamamen siliniyor`);
        await removeSlot(sessionId);
    }
}, SLOT_CLEANUP_INTERVAL);
}

// =============================================
//  ESP YARDIMCILARI
// =============================================

function isPythonRunning() {
    return new Promise((resolve) => {
        exec('pgrep -f "denek.py"', (error, stdout) => {
            resolve(stdout.trim().length > 0);
        });
    });
}

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

const VAR_MAP = {
    esp_id: 0, ocpp_url: 1, ocpp_id: 2, qr_id: 3,
    max_power: 4, wifi_ssid: 5, wifi_pass: 6,
    conn_type: 7, unlock: 8,
    tel_num: 9, comp_url: 10, app_url: 11, play_url: 12,
    logo: 13, comp_name: 14,
    reset_config: 15, measure_type: 16, mode: 17,
    model: 18, esp_mode: 19, reset_esp: 20, stop_charge: 21,
    charge_time: 22, prms: 23, total_energy: 24,
    charge_state: 25, uart: 26, error: 27,
    log_verbose: 28, log_debug: 29, log_info: 30,
    ota_active: 31, ota_key: 32, ota_version: 33, gsm_signal: 34,
    gradient_or_color: 35, select_color: 36,
    commsupport_net: 37, ocpp_active: 38,
    cp_vendor: 39, cp_model: 40, cp_serial: 41,
    meter_serial: 42, meter_type: 43, box_serial: 44,
    ocpp_conn: 45,
    msp_actuator: 46, msp_temp: 47, msp_leak: 48, msp_state: 49,
    msp_rgb: 50, msp_cp_volt: 51, msp_rly: 52, msp_pwm: 53,
    msp_l1_volt: 54, msp_l1_cur: 55, msp_l2_volt: 56, msp_l2_cur: 57,
    msp_l3_volt: 58, msp_l3_cur: 59,
    msp_hw_ver: 60, msp_sw_ver: 61,
    scan_list: 62, logo_update: 63, logo_name: 64, active_logo: 65,
    msp_mode: 69, // OCPP sanal mod — 0: disable, 1: soket takılı, 2: şarja geç
    active_transaction: 70,
};

const VALID_IDS = [
    0,1,2,3,4,5,6,7,8, 9,10,11,12,13,14, 15,16,17,18,19,
    20,21, 22,23,24,25,26,27, 28,29,30, 31,32,33,34,
    35,36, 37,38, 39,40,41,42,43,44, 45,
    46,47,48,49,50,51,52,53, 54,55,56,57,58,59,
    60,61, 62,63,64,65, 66,67,68, 69, 70
];

const DEACTIVATE_WAIT_MS = 2000;

// Slot için deactivate → bekle → activate döngüsü
// (sadece o session_id'nin slot'unu değiştirir, diğerleri etkilenmez)
async function deactivateThenActivateForSlot(sessionId, target) {
    await withLock(TARGET_PATH, async () => {
        const data = await readTarget();
        const slot = findOrCreateSlot(data.requests, sessionId, target);
        slot.target = target;
        slot.control = "deactivate";
        await writeJsonRaw(TARGET_PATH, data);
    });
    console.log(`[CYCLE] ${sessionId} deactivate yazıldı`);

    // Bu session'ın status_response'unu sıfırla
    try {
        await withLock(RESPONSES_PATH, async () => {
            const r = await readResponses();
            if (r.responses[sessionId]) {
                r.responses[sessionId].status_response = { topic: "", data: "" };
                await writeJsonRaw(RESPONSES_PATH, r);
            }
        });
    } catch {}

    await new Promise(r => setTimeout(r, DEACTIVATE_WAIT_MS));

    await withLock(TARGET_PATH, async () => {
        const data = await readTarget();
        const slot = findOrCreateSlot(data.requests, sessionId, target);
        slot.target = target;
        slot.control = "activate";
        await writeJsonRaw(TARGET_PATH, data);
    });
    console.log(`[CYCLE] ${sessionId} activate yazıldı`);

    await new Promise(r => setTimeout(r, DEACTIVATE_WAIT_MS));
}

// ── Toplu Parametre — arka planda çalışan kalıcı iş (bkz. bulk-jobs.js) ──
// Kendi session_id'sini ("bulk:<jobId>") kullanır, gerçek kullanıcı
// oturumlarıyla çakışmaz; tarayıcı sekmesi kapansa bile server.js process'i
// içinde çalışmaya devam eder.
const { initBulkJobs } = require('./bulk-jobs');
const bulkJobs = initBulkJobs({
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, RESPONSES_PATH, touchSlot, readUsers, withLock,
    checkLogoWritten: otaLogTailer.checkLogoWritten, OTA_LOG_PATH,
});

// ── Toplu Güncelleme (OTA firmware) — aynı gerekçeyle backend'de kalıcı
// (bkz. ota-bulk-jobs.js). Kendi session_id'sini ("ota:<jobId>") kullanır. ──
const { initOtaBulkJobs } = require('./ota-bulk-jobs');
const otaBulkJobs = initOtaBulkJobs({
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, RESPONSES_PATH, touchSlot, readUsers, withLock,
    getMacUpdateStatus: otaLogTailer.getMacUpdateStatus, OTA_LOG_PATH,
});

// Sunucu yeniden başladığında (deploy, crash-restart) bekleyen otomatik
// tekrar denemelerini (bkz. "Kaç dakikada, kaç kere" ayarı) DB'den okuyup
// yeniden kurar — aksi halde bir restart sessizce bu zamanlayıcıları kaybeder.
bulkJobs.resumeAutoRetries();
otaBulkJobs.resumeAutoRetries();

// Otomatik tekrar için "başarısız/doğrulanamadı" sayılan fazlar — manuel
// "Tekrar Dene" uçları da AYNI listeyi kullanır (tek kaynak, bkz. bulk-jobs.js).
const BULK_JOB_RETRYABLE_PHASES = bulkJobs.RETRYABLE_PHASES;
const OTA_BULK_JOB_RETRYABLE_PHASES = otaBulkJobs.RETRYABLE_PHASES;

// Panelden gelen "N dakikada bir, toplam M kere" ayarını makul sınırlara
// oturtur — 0/boş = kapalı (mevcut davranış, geriye dönük uyumlu).
function clampAutoRetry(minutesRaw, maxRaw) {
    const minutes = Math.max(0, Math.min(Number(minutesRaw) || 0, 24 * 60)); // en fazla 24 saat arayla
    const max = Math.max(0, Math.min(Number(maxRaw) || 0, 20)); // en fazla 20 otomatik deneme
    if (minutes <= 0 || max <= 0) return { autoRetryMinutes: null, autoRetryMax: null };
    return { autoRetryMinutes: minutes, autoRetryMax: max };
}

// ── Toplu Okuma — şirket bazlı canlı cihaz durumu panosu (bkz. device-status-poll.js) ──
const { initDeviceStatusPoll } = require('./device-status-poll');
const deviceStatusPoll = initDeviceStatusPoll({
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, touchSlot, withLock, getDevices,
});

// ── Cihaz Canlı Log Akışı — frame 3 28/29 (bkz. device-log-stream.js) ──
const { initDeviceLogStream } = require('./device-log-stream');
// Canlı OCPP olayları (frame 3 28 3) — Loglar sayfası ve Toplu Okuma konsolu (bkz. ocpp-live-store.js)
const { initOcppLiveStore } = require('./ocpp-live-store');
const ocppLive = initOcppLiveStore();
const logSessionMacs = new Map(); // sessionId -> bağlı cihaz MAC'i (log komutunda öğrenilir)
const OCPP_LIVE_LEVEL = 3;        // frame 3 28 3 = Canlı OCPP Akışı
// Toplu Okuma açıkken şirketin cihazlarına kalıcı bağlanıp bir kez 3 28 3 gönderen izleyici (bkz. ocpp-watch.js)
const { initOcppWatch } = require('./ocpp-watch');
const { classify: classifyChargeState } = require('./device-status-poll');
const { chargeStateFromOcpp } = require('./ocpp-charge-state');
const ocppWatch = initOcppWatch({
    readTarget, writeJsonRaw, withLock, TARGET_PATH, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, touchSlot, readResponses, getDevices, ocppLive, SLOT_CLEAR_MSG_INTERVAL, RESPONSES_PATH,
    // İzlenen cihazlar Toplu Okuma şeritlerince okunamaz; durumlarını izleyici günceller
    onStatus(device, active, raw) {
        if (active && raw == null) return;
        const { state, label } = classifyChargeState(active, raw);
        require('./db').upsertDeviceLiveStatus({
            mac: device.mac, company: device.company, location: device.location, deviceCode: device.device_code,
            state, label, raw, swVersion: device.sw_version, maxPower: null,
        });
    },
    // Sessizlik yoklamasında taze "ESP aktif" geldi
    onAlive(device) { require('./db').touchDeviceLiveStatus(device.mac); },
    // Akan OCPP mesajı (StatusNotification, MeterValues, Start/StopTransaction) durumu günceller
    onOcppLine(device, line) {
        const st = chargeStateFromOcpp(line);
        if (!st) { require('./db').touchDeviceLiveStatus(device.mac); return; } // durum yok ama veri geldi
        require('./db').upsertDeviceLiveStatus({
            mac: device.mac, company: device.company, location: device.location, deviceCode: device.device_code,
            state: st.state, label: st.label, raw: st.raw, swVersion: device.sw_version, maxPower: null,
        });
    },
});
// Sürümü uygun cihazların günlük logunu 6 saatte bir (şarj yokken) çeker
const { initArchiveAutoPull } = require('./archive-auto-pull');
archiveAutoPull = initArchiveAutoPull({
    readTarget, writeJsonRaw, withLock, TARGET_PATH, deactivateThenActivateForSlot, removeSlot, touchSlot,
    readResponses, getDevices, SLOT_CLEAR_MSG_INTERVAL, RESPONSES_PATH,
    getArchivePull: require('./db').getArchivePull,
    recordArchivePull: require('./db').recordArchivePull,
    getDeviceLiveState: require('./db').getDeviceLiveState,
    markVersionCheck: require('./db').markVersionCheck,
    updateDeviceVersion: require('./db').updateDeviceVersion,
});
// systemd yeniden başlatırken izlenen cihazlarda log modu açık kalmasın
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
        archiveAutoPull.stop();
        Promise.race([ocppWatch.stopAll(), new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(0));
    });
}
const deviceLog = initDeviceLogStream({
    RESPONSES_PATH, readResponses,
    onLine(sessionId, msg, data) {
        if (msg !== 28 || deviceLog.modes(sessionId)[28] !== OCPP_LIVE_LEVEL) return;
        const mac = logSessionMacs.get(sessionId);
        if (mac) ocppLive.add(mac, data);
    },
});
const { initDeviceArchiveLogs } = require('./device-archive-logs');
const { parseOcppLog, mergeEvents, pickOcppFiles } = require('./ocpp-archive-events');
const deviceArchiveLogs = initDeviceArchiveLogs({
    host: process.env.LOG_REMOTE_HOST || OTA_REMOTE_HOST,
    username: process.env.LOG_REMOTE_USER || OTA_REMOTE_USER,
    privateKeyPath: process.env.LOG_SSH_KEY_PATH || OTA_SSH_KEY_PATH,
    root: process.env.LOG_REMOTE_ROOT || '/home/bluetech/platform_mqtt/logs',
});

// Bağlantı kapanmadan/değişmeden HEMEN ÖNCE çağrılır: cihazda açık bırakılmış log
// modlarını kapatır (frame 3 28 0 / frame 3 29 0). Bunsuz cihaz, panel bağlantısı
// kesildikten sonra da log yayınlamaya devam ediyordu (slot silinene kadar da bu
// satırlar panele akıyordu). Slot hâlâ target.json'da ve aktifken çağrılmalı.
async function stopDeviceLogs(sessionId) {
    const groups = deviceLog.activeGroups(sessionId);
    if (groups.length === 0) return;
    for (const group of groups) {
        const frame = `frame 3 ${group} 0`;
        let sent = false;
        await withLock(TARGET_PATH, async () => {
            const data = await readTarget();
            const slot = data.requests.find((r) => r.session_id === sessionId && r.control === 'activate');
            if (!slot) return;
            slot.send_message = frame;
            await writeJsonRaw(TARGET_PATH, data);
            sent = true;
        });
        if (!sent) break;
        console.log(`[LOG] ${sessionId}: ${frame} (bağlantı kapanırken otomatik)`);
        // köprü frame'i okusun diye bekle, sonra temizle (bkz. /api/send-command)
        await new Promise((r) => setTimeout(r, SLOT_CLEAR_MSG_INTERVAL));
        await withLock(TARGET_PATH, async () => {
            const data = await readTarget();
            const slot = data.requests.find((r) => r.session_id === sessionId);
            if (slot && slot.send_message === frame) { slot.send_message = ""; await writeJsonRaw(TARGET_PATH, data); }
        });
    }
    deviceLog.clearModes(sessionId);
}

// =============================================
//  ANA API ENDPOINT'LERİ — SESSION_ID BAZLI
// =============================================

// Bağlan — target değiştir
app.post('/api/update-target', requireAuth(), async (req, res) => {
    const { newTarget, deviceCode, deviceId, force } = req.body || {};
    const sessionId = req.sessionId;

    let targetMac = newTarget;
    let resolvedDeviceCode = deviceCode || null;

    // Cihaz seçim ekranı artık herkes için MAC yerine deviceId gönderiyor
    // (operatör MAC'i hiç görmüyor). ID üzerinden MAC backend tarafından çözülür.
    if (deviceId !== undefined && deviceId !== null) {
        const devices = getDevices({});
        const device = devices.find(
            (d) => String(d.id) === String(deviceId)
        );

        if (!device) {
            return res.status(404).json({ error: 'Cihaz bulunamadı' });
        }

        if (!allowsDevice(scopeFor(req), device)) {
            return res.status(403).json({
                error: 'Bu cihaza bağlanma yetkiniz yok'
            });
        }

        targetMac = device.mac;
        resolvedDeviceCode = device.device_code || null;
    }

    // Operatör deviceId olmadan doğrudan MAC/deviceCode gönderemez.
    else if (req.userRole === 'operator') {
        return res.status(400).json({ error: 'Cihaz seçilmedi' });
    }

    // Ham deviceCode ile bağlantı (deviceId gönderilmediyse).
    else if (deviceCode) {
        const device = getDeviceByCode(String(deviceCode));

        if (!device) {
            return res.status(404).json({ error: 'Cihaz bulunamadı' });
        }

        targetMac = device.mac;
        resolvedDeviceCode = device.device_code || deviceCode;
    }

    if (!targetMac || !MAC_REGEX.test(targetMac)) {
        return res.status(400).json({
            error: 'Geçersiz cihaz veya MAC adresi'
        });
    }

    // Yetki kontrolu — HER yol icin (ham MAC girisi, deviceCode, deviceId)
    const connScope = scopeFor(req);
    if (!connScope.unrestricted && !allowsMac(connScope, targetMac)) {
        console.warn(`[AUTH] ${req.username} yetkisiz cihaza baglanmayi denedi: ${targetMac}`);
        return res.status(403).json({ error: 'Bu cihaza bağlanma yetkiniz yok' });
    }

    // ── Cihaz meşgul mü? — Exclusive lock ──
    // Aynı MAC'e başka bir session zaten "activate" durumundaysa:
    //  - superadmin değilse tamamen engelle (override seçeneği yok)
    //  - superadmin ise, force=true gelmediyse önce kime ait olduğunu bildirip onay iste
    try {
        const targetData = await readTarget();
        const occupant = targetData.requests.find(
            (r) => r.target === targetMac && r.control === 'activate' && r.session_id !== sessionId
        );

        if (occupant && ocppWatch.isWatchSession(occupant.session_id)) {
            // Toplu Okuma canlı OCPP izleyicisi — kullanıcı önceliklidir: 3 28 0 gönderilip cihaz bırakılır
            console.log(`[OCCUPANCY] ${targetMac} OCPP izleyicisinden kullanıcıya bırakıldı`);
            await ocppWatch.release(occupant.session_id);
        } else if (occupant && archiveAutoPull.isArchiveSession(occupant.session_id)) {
            // Otomatik günlük log çekimi — kullanıcı önceliklidir, çekim sonra yeniden denenir
            console.log(`[OCCUPANCY] ${targetMac} otomatik arşiv çekiminden kullanıcıya bırakıldı`);
            await archiveAutoPull.release(occupant.session_id);
        } else if (occupant && isSyntheticSessionStale(occupant.session_id)) {
            // bulk:/ota: önekli sahte bir session, sahibi iş artık çalışmıyor —
            // çökmüş/durmuş bir toplu iş şeridinden kalma yetim kayıt. Zaman
            // aşımı beklemeden hemen temizle, kullanıcıyı "meşgul" diye
            // engelleme (bkz. db.js isSyntheticSessionStale açıklaması).
            console.log(`[OCCUPANCY] yetim session temizlendi: ${occupant.session_id} (${targetMac} üzerinde takılı kalmış)`);
            await removeSlot(occupant.session_id).catch(() => {});
        } else if (occupant) {
            const users2 = readUsers();
            const occupantUser = users2.find((u) => u.username === occupant.session_id);
            const occupantLabel = occupantUser?.fullName || occupant.session_id;

            if (req.userRole !== 'superadmin') {
                return res.status(409).json({
                    error: `Bu cihaz şu anda ${occupantLabel} tarafından kullanılıyor`
                });
            }
            if (!force) {
                return res.status(409).json({
                    error: 'occupied',
                    code: 'DEVICE_OCCUPIED',
                    occupiedBy: occupantLabel
                });
            }

            // superadmin + force → önceki kullanıcının slot'unu deaktif et, ona bildirim düşsün
            occupant.control = 'deactivate';
            await writeJsonRaw(TARGET_PATH, targetData);
            if (!slotMeta[occupant.session_id]) slotMeta[occupant.session_id] = {};
            slotMeta[occupant.session_id].lastDeactivatedBy = req.userFullName || req.username;
            console.log(`[OVERRIDE] ${sessionId} (superadmin) ${occupant.session_id} kullanıcısını ${targetMac} üzerinden düşürdü`);
        }
    } catch (e) {
        console.error('occupancy kontrol hatası:', e);
    }

    try {
        await stopDeviceLogs(sessionId).catch(() => {}); // önceki cihazda log açık kalmasın
        await deactivateThenActivateForSlot(sessionId, targetMac);
        touchSlot(sessionId);
        // Önceki bağlantının "kapatıldı/devralındı" bilgisi yeni bağlantıda uyarı açmasın
        if (slotMeta[sessionId]) slotMeta[sessionId].lastDeactivatedBy = null;

        console.log(`[CONNECT] ${sessionId} → ${targetMac}`);
        deviceLog.drop(sessionId); // önceki cihazın log satırları yeni cihazınkilere karışmasın

        res.json({
            message: 'Başarılı',
            deviceCode: resolvedDeviceCode
        });
    } catch (e) {
        console.error('update-target hata:', e);
        res.status(500).json({ error: 'target.json yazılamadı' });
    }
});

// Kullanıcı panelde gerçekten bir şey yapıyor (fare, klavye, kaydırma, dokunma) —
// ön yüz en fazla dakikada bir bildirir. Sekmenin yalnızca açık durması değil, gerçek
// kullanım aktivite sayılır; böylece logları/arşivi incelerken bağlantı kopmaz,
// açık unutulan sekme ise cihazı 5 dk sonra yine bırakır.
app.post('/api/activity', requireAuth(), async (req, res) => {
    try {
        const target = await readTarget();
        const slot = target.requests.find((r) => r.session_id === req.sessionId && r.control === 'activate');
        if (slot) touchSlot(req.sessionId);
        res.json({ touched: !!slot });
    } catch (e) {
        res.status(500).json({ error: 'activity hata' });
    }
});

// Keepalive — sadece token/oturumun canlı olduğunu doğrular.
// ARTIK slot aktivitesini YENİLEMİYOR: sekmenin açık kalması "kullanım" sayılmasın —
// 5dk hareketsizlik kuralı gerçek işlemlere (bağlan, komut gönder) göre işlesin.
app.post('/api/keepalive', requireAuth(), async (req, res) => {
    try {
        res.json({ message: 'keepalive ok' });
    } catch (e) {
        res.status(500).json({ error: 'keepalive hata' });
    }
});

// Disconnect — slot'u tamamen sil
app.post('/api/disconnect', requireAuth(), async (req, res) => {
    const sessionId = req.sessionId;
    try {
        await stopDeviceLogs(sessionId).catch(() => {});
        await removeSlot(sessionId);
        console.log(`[DISCONNECT] ${sessionId} bağlantı koparıldı`);
        res.json({ message: 'Bağlantı koparıldı' });
    } catch (e) {
        res.status(500).json({ error: 'Bağlantı koparılamadı' });
    }
});

// Komut gönder
app.post('/api/send-command', requireAuth(), async (req, res) => {
    const { type, variable, value } = req.body || {};
    const sessionId = req.sessionId;

    let varCode = typeof variable === 'number' ? variable : VAR_MAP[variable];
    if (varCode === undefined && !isNaN(Number(variable))) varCode = Number(variable);

    if (!type || (type !== 'set' && type !== 'read')) {
        return res.status(400).json({ message: 'Geçersiz komut tipi.' });
    }
    if (!VALID_IDS.includes(varCode)) {
        return res.status(400).json({ message: `Geçersiz değişken: ${varCode}` });
    }

    let frame;
    if (type === 'set') {
        if (!value && value !== 0 && value !== "0") {
            return res.status(400).json({ message: 'set için değer gerekli.' });
        }
        const cleanValue = varCode === 9 ? String(value).replace(/[^0-9]/g, '') : value;
        frame = `frame 1 ${varCode} ${cleanValue}`;
    } else {
        frame = `frame 2 ${varCode} 0`;
    }

    try {
        let notConnected = false, unauthorizedTarget = null;
        await withLock(TARGET_PATH, async () => {
            const data = await readTarget();
            const slot = data.requests.find((r) => r.session_id === sessionId);
            if (!slot) { notConnected = true; return; }
            const cmdScope = scopeFor(req);
            if (!cmdScope.unrestricted && !allowsMac(cmdScope, slot.target)) { unauthorizedTarget = slot.target; return; }
            if (isRestrictedTarget(req, slot.target) && !individualCommandAllowed(type, varCode)) {
                unauthorizedTarget = 'INDIVIDUAL_RESTRICTED_COMMAND';
                return;
            }
            slot.send_message = frame;
            await writeJsonRaw(TARGET_PATH, data);
            if (slot.target) logSessionMacs.set(sessionId, slot.target);
        });
        if (notConnected) return res.status(400).json({ message: 'Önce bir cihaza bağlanmalısınız.' });
        if (unauthorizedTarget) {
            if (unauthorizedTarget === 'INDIVIDUAL_RESTRICTED_COMMAND') {
                return res.status(403).json({ message: 'Bireysel cihazda bu OCPP/komut alanına erişim kapalı' });
            }
            console.warn(`[AUTH] ${req.username} yetkisiz cihaza komut denedi: ${unauthorizedTarget}`);
            return res.status(403).json({ message: 'Bu cihaza komut gönderme yetkiniz yok' });
        }
        touchSlot(sessionId);

        // 1.5sn sonra send_message'ı temizle (denek.py mesajı okumuş olur) —
        // ama sadece hâlâ BİZİM gönderdiğimiz frame duruyorsa. Aksi halde,
        // 1.5sn içinde art arda gönderilen bir sonraki komutun frame'ini,
        // eski komutun gecikmeli temizleyicisi silebilir (bkz. bulk-jobs.js
        // sendFrame'deki aynı düzeltme).
        setTimeout(async () => {
            try {
                await withLock(TARGET_PATH, async () => {
                    const d = await readTarget();
                    const s = d.requests.find((r) => r.session_id === sessionId);
                    if (s && s.send_message === frame) {
                        s.send_message = "";
                        await writeJsonRaw(TARGET_PATH, d);
                    }
                });
            } catch {}
        }, SLOT_CLEAR_MSG_INTERVAL);

        console.log(`[CMD] ${sessionId}: ${frame}`);
        res.json({ message: 'Komut gönderildi', frame });
    } catch (e) {
        console.error('send-command hata:', e);
        res.status(500).json({ error: 'Komut gönderilemedi.' });
    }
});

// Log modu seç — frame 3 <28|29> <0-5>
// 28: verbose grubu, 29: debug grubu; 0 kapatır. Satırlar responses.json'daki
// message_response.data üzerinden akar, deviceLog bunları biriktirir.
app.post('/api/log/command', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ message: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    const sessionId = req.sessionId;
    const group = Number(req.body?.group);
    const level = Number(req.body?.level);
    if (!deviceLog.LOG_GROUPS.includes(group)) {
        return res.status(400).json({ message: 'Geçersiz log grubu.' });
    }
    if (!Number.isInteger(level) || level < 0 || level > deviceLog.MAX_LEVEL) {
        return res.status(400).json({ message: 'Geçersiz log seviyesi.' });
    }
    const frame = `frame 3 ${group} ${level}`;

    try {
        let notConnected = false, unauthorizedTarget = null;
        await deviceLog.watch(sessionId);
        await withLock(TARGET_PATH, async () => {
            const data = await readTarget();
            const slot = data.requests.find((r) => r.session_id === sessionId);
            if (!slot) { notConnected = true; return; }
            const cmdScope = scopeFor(req);
            if (!cmdScope.unrestricted && !allowsMac(cmdScope, slot.target)) { unauthorizedTarget = slot.target; return; }
            slot.send_message = frame;
            await writeJsonRaw(TARGET_PATH, data);
        });
        if (notConnected) return res.status(400).json({ message: 'Önce bir cihaza bağlanmalısınız.' });
        if (unauthorizedTarget) {
            console.warn(`[AUTH] ${req.username} yetkisiz cihaza log komutu denedi: ${unauthorizedTarget}`);
            return res.status(403).json({ message: 'Bu cihaza komut gönderme yetkiniz yok' });
        }
        touchSlot(sessionId);
        deviceLog.setMode(sessionId, group, level);

        // bkz. /api/send-command — sadece hâlâ bizim frame duruyorsa temizle
        setTimeout(async () => {
            try {
                await withLock(TARGET_PATH, async () => {
                    const d = await readTarget();
                    const s = d.requests.find((r) => r.session_id === sessionId);
                    if (s && s.send_message === frame) {
                        s.send_message = "";
                        await writeJsonRaw(TARGET_PATH, d);
                    }
                });
            } catch {}
        }, SLOT_CLEAR_MSG_INTERVAL);

        console.log(`[LOG] ${sessionId}: ${frame}`);
        res.json({ message: 'Komut gönderildi', frame });
    } catch (e) {
        console.error('log/command hata:', e);
        res.status(500).json({ error: 'Komut gönderilemedi.' });
    }
});

// Biriken log satırları — ?after=<id> ile sadece yeniler
app.get('/api/log/lines', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ message: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    await deviceLog.watch(req.sessionId);
    // Açık bir log akışını izlemek aktivite sayılır — yoksa kullanıcı komut göndermeden
    // sadece logları izlerken 5 dakikada "inaktivite"den bağlantısı kesiliyordu.
    if (deviceLog.activeGroups(req.sessionId).length > 0) touchSlot(req.sessionId);
    res.json(deviceLog.read(req.sessionId, req.query.after));
});

app.post('/api/log/clear', requireAuth(), (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ message: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    deviceLog.clear(req.sessionId);
    res.json({ message: 'ok' });
});

// ── Kalıcı cihaz logları — Bluetech sunucusundaki current/history dosyaları ──
// Bu uçlar dosyaları btcharge diskine yazmaz. Her istekte 85.105 üzerindeki
// platform_mqtt/logs/<MAC>/ klasörü SFTP ile okunur; böylece arşivin tek kaynağı
// Bluetech sunucusu olur ve panel sunucusunda log büyümesi yaşanmaz.
async function archiveMacForRequest(req) {
    const target = await readTarget();
    const slot = target.requests.find((r) => r.session_id === req.sessionId && r.control === 'activate');
    if (!slot || !slot.target) {
        const err = new Error('Önce bir cihaza bağlanmalısınız.');
        err.statusCode = 400;
        throw err;
    }
    if (!scopeFor(req).unrestricted && !allowsMac(scopeFor(req), slot.target)) {
        const err = new Error('Bu cihazın loglarına erişme yetkiniz yok');
        err.statusCode = 403;
        throw err;
    }
    return slot.target;
}

function archiveError(res, error) {
    const status = Number(error?.statusCode) || 502;
    res.status(status).json({ error: error?.message || 'Uzak log sunucusuna erişilemedi' });
}

app.get('/api/device-log-archive/catalog', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    try {
        const mac = await archiveMacForRequest(req);
        res.json(await deviceArchiveLogs.list(mac));
    } catch (e) {
        console.error('[DEVICE-LOG-ARCHIVE] listeleme hatası:', e.message);
        archiveError(res, e);
    }
});

// Son arşiv çekimi (otomatik ya da elle) ve otomatik çekime uygunluk
app.get('/api/device-log-archive/pull-status', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    try {
        const mac = await archiveMacForRequest(req);
        res.json(archiveAutoPull.status(mac));
    } catch (e) {
        archiveError(res, e);
    }
});

async function archiveFileIsAllowed(mac, name) {
    const catalog = await deviceArchiveLogs.list(mac);
    return catalog.files.some((file) => file.name === name);
}

app.get('/api/device-log-archive/preview', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    try {
        const mac = await archiveMacForRequest(req);
        const name = String(req.query.name || '');
        if (!await archiveFileIsAllowed(mac, name)) return res.status(404).json({ error: 'Log dosyası bulunamadı' });
        res.json(await deviceArchiveLogs.preview(mac, name));
    } catch (e) {
        console.error('[DEVICE-LOG-ARCHIVE] önizleme hatası:', e.message);
        archiveError(res, e);
    }
});

app.get('/api/device-log-archive/download', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    try {
        const mac = await archiveMacForRequest(req);
        const name = String(req.query.name || '');
        if (!await archiveFileIsAllowed(mac, name)) return res.status(404).json({ error: 'Log dosyası bulunamadı' });
        const result = await deviceArchiveLogs.download(mac, name);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${result.name.replace(/"/g, '')}"`);
        res.setHeader('Content-Length', String(result.buffer.length));
        res.send(result.buffer);
    } catch (e) {
        console.error('[DEVICE-LOG-ARCHIVE] indirme hatası:', e.message);
        archiveError(res, e);
    }
});

// frame 3 30 ile aktarılan OCPP arşivi — İşlem Geçmişi / Zaman Çizelgesi verisi.
// Dosyalar her filtrede yeniden SFTP ile çekilmesin diye cihaz başına kısa süre önbelleklenir.
const OCPP_EVENTS_CACHE_MS = 30 * 1000;
const ocppEventsCache = new Map(); // mac -> { at, events, files }

async function loadOcppEvents(mac, fresh) {
    const cached = ocppEventsCache.get(mac);
    if (!fresh && cached && Date.now() - cached.at < OCPP_EVENTS_CACHE_MS) return cached;
    const catalog = await deviceArchiveLogs.list(mac);
    const files = pickOcppFiles(catalog.files);
    const lists = [];
    for (const file of files) {
        const { buffer } = await deviceArchiveLogs.download(mac, file.name);
        lists.push(parseOcppLog(buffer.toString('utf8'), file.format));
    }
    const entry = { at: Date.now(), events: mergeEvents(lists), files: files.map((f) => f.name) };
    ocppEventsCache.set(mac, entry);
    return entry;
}

app.get('/api/device-log-archive/ocpp-events', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) {
        return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    }
    try {
        const mac = await archiveMacForRequest(req);
        const from = req.query.from ? Date.parse(req.query.from) : -Infinity;
        const to = req.query.to ? Date.parse(req.query.to) : Infinity;
        if (Number.isNaN(from) || Number.isNaN(to)) return res.status(400).json({ error: 'Geçersiz tarih aralığı' });
        const { events, files, at } = await loadOcppEvents(mac, req.query.fresh === '1');
        res.json({
            mac, files, fetchedAt: new Date(at).toISOString(),
            events: events.filter((e) => e.time >= from && e.time <= to),
        });
    } catch (e) {
        console.error('[DEVICE-LOG-ARCHIVE] OCPP olay hatası:', e.message);
        archiveError(res, e);
    }
});

// ── Canlı OCPP (frame 3 28 3) — siyah konsol akışı ve cihaz olayları ──
// ?session=1: oturumun bağlı olduğu cihaz (Loglar sayfası). Aksi halde şirket
// kapsamı (Toplu Okuma); bu istek Toplu Okuma döngüsünde log toplamayı da açık tutar.
async function sessionDeviceMac(req) {
    const target = await readTarget();
    const slot = target.requests.find((r) => r.session_id === req.sessionId && r.control === 'activate');
    return slot?.target || null;
}

function deviceInfoByMac() {
    const map = new Map();
    for (const d of getDevices({})) map.set(String(d.mac || '').toUpperCase(), d);
    return map;
}

app.get('/api/ocpp-live/feed', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    try {
        const scope = scopeFor(req);
        const info = deviceInfoByMac();
        let filter;
        if (req.query.session === '1') {
            const mac = (await sessionDeviceMac(req) || '').toUpperCase();
            if (!mac) return res.json({ lastId: ocppLive.feed(0, () => false).lastId, lines: [] });
            filter = (m) => m === mac;
        } else {
            const company = scope.unrestricted ? (req.query.company || null) : scope.company;
            if (!company) return res.json({ lastId: ocppLive.feed(0, () => false).lastId, lines: [] });
            ocppWatch.ensure(company, req.sessionId);
            filter = (m) => {
                const d = info.get(m);
                return !!d && String(d.company || '').trim() === company && (scope.unrestricted || allowsDevice(scope, d));
            };
        }
        // Yalnızca tanınan OCPP mesajları; cihazın sistem/log satırları gösterilmez
        const out = ocppLive.feed(req.query.after, (mac) => filter(mac));
        const hideMac = req.userRole === 'operator';
        const company = req.query.session === '1' ? null : (scope.unrestricted ? (req.query.company || null) : scope.company);
        res.json({
            lastId: out.lastId,
            watch: company ? ocppWatch.state(company) : null,
            lines: out.lines.filter((l) => l.action).map((l) => {
                const d = info.get(l.mac);
                return { ...l, mac: hideMac ? undefined : l.mac, deviceId: d?.id ?? null, location: d?.location || null, deviceCode: d?.device_code || null };
            }),
        });
    } catch (e) {
        console.error('[OCPP-LIVE] akış hatası:', e.message);
        res.status(500).json({ error: 'Canlı OCPP akışı alınamadı' });
    }
});

// Toplu Okuma sayfasından çıkış — izleyen kalmadıysa her cihaza 3 28 0, bağlantılar bırakılır, loglar silinir
app.post('/api/ocpp-live/leave', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    const scope = scopeFor(req);
    const company = scope.unrestricted ? (req.body?.company || null) : scope.company;
    if (company) await ocppWatch.leave(company, req.sessionId).catch(() => {});
    res.json({ message: 'ok' });
});

app.get('/api/ocpp-live/events', requireAuth(), async (req, res) => {
    if (isRestrictedOperator(req)) return res.status(403).json({ error: 'Bireysel/kısıtlı hesaplarda cihaz logları kapalı' });
    try {
        const scope = scopeFor(req);
        let mac;
        if (req.query.deviceId) {
            const d = getDevices({}).find((x) => String(x.id) === String(req.query.deviceId));
            if (!d) return res.status(404).json({ error: 'Cihaz bulunamadı' });
            if (!scope.unrestricted && !allowsDevice(scope, d)) return res.status(403).json({ error: 'Bu cihazın loglarına erişme yetkiniz yok' });
            mac = d.mac;
        } else {
            mac = await sessionDeviceMac(req);
            if (!mac) return res.status(400).json({ error: 'Önce bir cihaza bağlanmalısınız.' });
        }
        const from = req.query.from ? Date.parse(req.query.from) : -Infinity;
        const to = req.query.to ? Date.parse(req.query.to) : Infinity;
        if (Number.isNaN(from) || Number.isNaN(to)) return res.status(400).json({ error: 'Geçersiz tarih aralığı' });
        res.json({ events: ocppLive.events(mac, from, to), fetchedAt: new Date().toISOString() });
    } catch (e) {
        console.error('[OCPP-LIVE] olay hatası:', e.message);
        res.status(500).json({ error: 'Canlı OCPP olayları alınamadı' });
    }
});

// Status — bu session'un status'unu döner + başka kullanıcı deactivate ettiyse onu da bildir
app.get('/api/get-status', requireAuth(), async (req, res) => {
    const sessionId = req.sessionId;
    try {
        const pythonRunning = await isPythonRunning();
        if (!pythonRunning) {
            return res.json({
                espState: "nonactive",
                pythonRunning: false,
                timedOut: false,
                status_response: null,
                message_response: null,
            });
        }

        const target = await readTarget();
        const mySlot = target.requests.find((r) => r.session_id === sessionId);
        const responses = await readResponses();
        const myResp = responses.responses[sessionId];

        // Slot var ama control = deactivate ve ben yapmadım → "başkası deaktif etti"
        const meta = slotMeta[sessionId] || {};
        const deactivatedBy = meta.lastDeactivatedBy || null;

        // Süre kontrolü
        let inactivityRemaining = null;
        if (meta.lastActivity) {
            const elapsed = Date.now() - meta.lastActivity;
            inactivityRemaining = Math.max(0, Math.floor((INACTIVITY_TIMEOUT - elapsed) / 1000));
        }

        // ESP state — responses'tan oku
        let espState = "nonactive";
        const statusText = (myResp?.status_response?.data || "").toLowerCase();
        if (statusText.includes("esp aktif")) {
            espState = "active";
        } else if (mySlot && mySlot.control === "activate" && !statusText.includes("esp pasif")) {
            espState = "unknown";
        }

        // timedOut: slot silindi mi (lastActivity yok)
        const timedOut = !!meta.lastActivity && (Date.now() - meta.lastActivity > INACTIVITY_TIMEOUT);

        res.json({
            espState,
            pythonRunning: true,
            timedOut,
            deactivatedBy,           // ← UI bunu görüp modal gösterecek
            inactivityRemaining,
            status_response: myResp?.status_response || null,
            message_response: (() => {
                const m = myResp?.message_response;
                if (Array.isArray(m)) return m[0] || null;
                if (m && typeof m === 'object') return m;
                return null;
            })(),
            mySlotTarget: mySlot?.target || null,
            mySlotControl: mySlot?.control || null,
        });
    } catch (e) {
        console.error('get-status hata:', e);
        res.json({
            espState: "nonactive",
            pythonRunning: false,
            timedOut: false,
            deactivatedBy: null,
            status_response: null,
            message_response: null,
        });
    }
});

// Responses — bu session'un message_response'unu döner
app.get('/api/responses', requireAuth(), async (req, res) => {
    const sessionId = req.sessionId;
    try {
        const data = await readResponses();
        const mine = data.responses[sessionId];
        if (!mine) {
            return res.json({ status_response: null, message_response: [] });
        }
        // denek.py message_response'u tek obje olarak yazıyor → frontend dizi bekliyor
        // Adapter: obje ise diziye sar
        let msgResp = mine.message_response;
        if (msgResp && !Array.isArray(msgResp)) {
            msgResp = [msgResp];
        } else if (!msgResp) {
            msgResp = [];
        }
        res.json({
            status_response: mine.status_response || null,
            message_response: msgResp,
        });
    } catch (err) {
        res.status(500).json({ error: 'responses okunamadı' });
    }
});

// Deactivate-by-other — "deactivatedBy" bayrağını UI okuduktan sonra temizle
app.post('/api/ack-deactivated', requireAuth(), (req, res) => {
    const sessionId = req.sessionId;
    if (slotMeta[sessionId]) slotMeta[sessionId].lastDeactivatedBy = null;
    res.json({ message: 'ok' });
});

// =============================================
//  /api/connections — Aktif bağlantı listesi
//  (admin ve superadmin görür — kim hangi MAC'e bağlı)
// =============================================
app.get('/api/connections', requireAuth(['admin']), async (req, res) => {
    try {
        const target = await readTarget();
        const myMac = target.requests.find((r) => r.session_id === req.sessionId)?.target;
        const users = readUsers();

        const list = target.requests
            .filter((r) => r.target && r.control === "activate")
            .map((r) => {
                const u = users.find((x) => x.username === r.session_id);
                return {
                    session_id: r.session_id,
                    username: r.session_id,
                    fullName: u?.fullName || r.session_id,
                    role: u?.role || 'unknown',
                    target: r.target,
                    isSelf: r.session_id === req.sessionId,
                    sameMac: myMac && r.target === myMac && r.session_id !== req.sessionId,
                };
            });

        res.json({ connections: list, myMac });
    } catch (e) {
        res.status(500).json({ error: 'connections okunamadı' });
    }
});

// Aktif Bağlantılar sayfasından — superadmin istediği kullanıcının bağlantısını kesebilir
app.post('/api/connections/:sessionId/disconnect', requireAuth(), requireSuperadmin, async (req, res) => {
    const targetSessionId = req.params.sessionId;
    try {
        await stopDeviceLogs(targetSessionId).catch(() => {});
        const data = await readTarget();
        const slot = data.requests.find((r) => r.session_id === targetSessionId && r.control === 'activate');
        if (!slot) return res.status(404).json({ error: 'Aktif bağlantı bulunamadı' });

        slot.control = 'deactivate';
        await writeJsonRaw(TARGET_PATH, data);
        if (!slotMeta[targetSessionId]) slotMeta[targetSessionId] = {};
        slotMeta[targetSessionId].lastDeactivatedBy = req.userFullName || req.username;

        console.log(`[ADMIN-DISCONNECT] ${req.username} (superadmin) ${targetSessionId} bağlantısını kesti`);
        res.json({ message: 'Bağlantı kesildi' });
    } catch (e) {
        console.error('connections disconnect hata:', e);
        res.status(500).json({ error: 'Bağlantı kesilemedi' });
    }
});

// =============================================
//  ÇOKLU KULLANICI ÇAKIŞMA TESPİTİ
//  Her status okumasında: aynı MAC'e başka kullanıcı bağlı mı?
//  Eğer başka biri "deactivate" yapmışsa, bizim slot'umuzda da
//  control "deactivate" olabilir → lastDeactivatedBy bayrağı set edilir.
//
//  Bu denetim periyodik olarak çalışır (denek.py'nin slot'umuzun
//  control'unu manuel deactivate yapması durumu için).
// =============================================
// require.main guard: bkz. yukarıdaki ilk setInterval açıklaması.
if (require.main === module) {
setInterval(async () => {
    try {
        const target = await readTarget();
        for (const slot of target.requests) {
            const meta = slotMeta[slot.session_id];
            if (!meta) continue;

            // Eğer bu slot deactive olduysa ve son aktivite yakın zamandaysa
            // (yani kullanıcı disconnect yapmamışsa) → bayrak set et
            if (slot.control === "deactivate" && meta.lastActivity &&
                (Date.now() - meta.lastActivity < INACTIVITY_TIMEOUT) &&
                !meta.lastDeactivatedBy) {

                // Aynı MAC'e başka kim activate? O biriyse atıfta bulun
                const others = target.requests.filter((r) =>
                    r.session_id !== slot.session_id &&
                    r.target === slot.target &&
                    r.control === "activate"
                );
                if (others.length > 0) {
                    // En son aktivite eden başka kullanıcının fullName'ini al
                    const candidate = others[0];
                    const otherMeta = slotMeta[candidate.session_id] || {};
                    meta.lastDeactivatedBy = otherMeta.fullName || candidate.session_id;
                    console.log(`[CONFLICT] ${slot.session_id} slot'u ${meta.lastDeactivatedBy} tarafından deaktif edilmiş olabilir`);
                }
            }
        }
    } catch (e) {
        // sessiz
    }
}, 5000); // 5sn'de bir kontrol
}

// =============================================
//  SUNUCU BAŞLAT
// =============================================
// require.main guard: bu blok (HTTPS/HTTP dinleme + başlangıç temizliği)
// sadece "node server.js" ile doğrudan çalıştırıldığında yürütülür. Bir test
// dosyası server.js'i require() ettiğinde port dinlemesi/arka plan temizliği
// başlamaz — module.exports = app ile aşağıda dışa açılan app supertest'e
// verilir. Gerçek başlatma yönteminde (node server.js) davranış birebir aynı.
if (require.main === module) {

const PORT = process.env.PORT || 8005;
const HTTPS_PORT = process.env.HTTPS_PORT || 8005;

const https = require('https');
const sslPath = '/etc/letsencrypt/live/btcharge.services';
try {
    const sslOptions = {
        cert: fs.readFileSync(sslPath + '/fullchain.pem'),
        key: fs.readFileSync(sslPath + '/privkey.pem')
    };
    https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`HTTPS çalışıyor: https://btcharge.services:${HTTPS_PORT}`);
    });
} catch (e) {
    console.log('[SSL] Sertifika bulunamadı, sadece HTTP çalışacak');
}

app.listen(8005, '0.0.0.0', () => {
    console.log('HTTP çalışıyor: http://localhost:8005');
});

// Başlangıç logları
console.log(`[USERS] users.json yolu: ${USERS_PATH}`);
const initialUsers = readUsers();
console.log(`[USERS] Kayıtlı kullanıcı sayısı: ${initialUsers.length}`);
if (initialUsers.length === 0) {
    console.log('[USERS] ⚠️  Hiç kullanıcı yok. İlk superadmin için: node create-superadmin.js');
}
console.log(`[TARGET] ${TARGET_PATH}`);
console.log(`[RESPONSES] ${RESPONSES_PATH}`);
console.log(`[SLOTS] inaktivite timeout: ${INACTIVITY_TIMEOUT / 60000} dk`);

// Başlangıçta yetim slot temizliği — session_id gerçek bir kullanıcıya
// karşılık gelmiyorsa (eski "kullanıcı_hash" şemasından kalma) sil.
// Geriye kalanlara "şimdi" aktivite zamanı ata: slotMeta RAM'de tutulduğu
// için her restart'ta sıfırlanıyor, atama yapılmazsa 10dk'lık temizlik
// onları hiç göremez ve terk edilmiş slotlar sonsuza kadar "bağlı" görünür.
(async () => {
    try {
        const validUsernames = new Set(readUsers().map((u) => u.username));

        const leftover = (await readTarget()).requests.filter((r) => ocppWatch.isWatchSession(r.session_id) && r.control === 'activate');
        if (leftover.length) {
            // Önceki çalışmadan kalan OCPP izleyici bağlantıları: silmeden önce cihazlarda log modunu kapat
            await withLock(TARGET_PATH, async () => {
                const d = await readTarget();
                for (const r of d.requests) if (ocppWatch.isWatchSession(r.session_id)) r.send_message = 'frame 3 28 0';
                await writeJsonRaw(TARGET_PATH, d);
            });
            await new Promise((r) => setTimeout(r, SLOT_CLEAR_MSG_INTERVAL + 500));
            console.log(`[STARTUP] ${leftover.length} eski OCPP izleyici bağlantısına 3 28 0 gönderildi`);
        }

        const t = await readTarget();
        const beforeCount = t.requests.length;
        t.requests = t.requests.filter((r) => validUsernames.has(r.session_id));
        if (t.requests.length !== beforeCount) {
            await writeJsonRaw(TARGET_PATH, t);
            console.log(`[STARTUP] ${beforeCount - t.requests.length} yetim slot temizlendi (target.json)`);
        }

        const r = await readResponses();
        let removedResp = 0;
        for (const key of Object.keys(r.responses)) {
            if (!validUsernames.has(key)) { delete r.responses[key]; removedResp++; }
        }
        if (removedResp > 0) {
            await writeJsonRaw(RESPONSES_PATH, r);
            console.log(`[STARTUP] ${removedResp} yetim response temizlendi (responses.json)`);
        }

        for (const slot of t.requests) {
            if (!slotMeta[slot.session_id]) slotMeta[slot.session_id] = {};
            slotMeta[slot.session_id].lastActivity = Date.now();
        }

        // Restart anında "running" görünen bulk-job'lar — onları çalıştıran
        // arka plan görevi process'le birlikte öldü, sonsuza kadar "devam
        // ediyor" gibi takılı kalırlardı. Açıkça durdurulmuş say.
        const stuckJobs = bulkJobs.listJobs({ activeOnly: true });
        for (const j of stuckJobs) {
            bulkJobs.stopJob(j.id);
            console.log(`[STARTUP] yarım kalan bulk-job durduruldu: ${j.id}`);
        }
        const stuckOtaJobs = otaBulkJobs.listJobs({ activeOnly: true });
        for (const j of stuckOtaJobs) {
            otaBulkJobs.stopJob(j.id);
            console.log(`[STARTUP] yarım kalan ota-bulk-job durduruldu: ${j.id}`);
        }
    } catch (e) {
        console.error('[STARTUP] slot temizliği hatası:', e.message);
    }
})();

}

// Cihaz API

app.get("/api/devices/companies", requireAuth(), (req, res) => {
  try {
    const scope = scopeFor(req);
    if (scope.unrestricted) return res.json({ companies: getCompanies() });

    // Tek tek atanan cihazlar baska sirketlerden olabilir — onlarin
    // sirketleri de listede gorunmeli.
    const companies = [...new Set(visibleDevices(scope).map((d) => d.company).filter(Boolean))];
    res.json({ companies });
  } catch (e) {
    res.status(500).json({ error: "Sirket listesi alinamadi" });
  }
});

app.get("/api/devices/filters", requireAuth(), (req, res) => {
  try {
    const scope = scopeFor(req);
    if (scope.unrestricted) {
      return res.json({ locations: getLocations(req.query.company || null) });
    }
    let list = visibleDevices(scope);
    if (req.query.company) list = list.filter((d) => d.company === req.query.company);
    res.json({ locations: [...new Set(list.map((d) => d.location).filter(Boolean))] });
  } catch (e) {
    res.status(500).json({ error: "Filtre listesi alinamadi" });
  }
});

app.get("/api/devices", requireAuth(), (req, res) => {
  try {
    const scope = scopeFor(req);
    let devices;

    if (scope.unrestricted) {
      devices = getDevices({
        company: req.query.company || null,
        location: req.query.location || null,
        role: req.userRole,
      });
    } else {
      devices = visibleDevices(scope);
      if (req.query.company) devices = devices.filter((d) => d.company === req.query.company);
      if (req.query.location) devices = devices.filter((d) => d.location === req.query.location);
    }

    // Operatorler MAC gormez — cihaz secimi id uzerinden yapilir. Aktivasyon kodu
    // MAC'e geri çevrilebildiği için o da gizlenir.
    const sanitized = devices.map((d) => ({
      ...d,
      mac: req.userRole === "operator" ? undefined : d.mac,
      activation_code: req.userRole === "operator" ? undefined : d.activation_code,
    }));
    res.json({ devices: sanitized });
  } catch (e) {
    res.status(500).json({ error: "Cihaz listesi alinamadi" });
  }
});

// ── Toplu Okuma — şirket bazlı canlı cihaz durumu (bkz. device-status-poll.js) ──
// Her GET isteği arka plandaki izleme döngüsünü "hâlâ birisi bakıyor" diye
// canlı tutar (ensureWatching) — sayfa kapatılınca 45sn içinde kendiliğinden
// durur. Operatör sadece kendi şirketini görebilir, superadmin ?company= ile
// istediğini sorgulayabilir.
app.get("/api/device-status", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu okuma kapalı" });
  try {
    const scope = scopeFor(req);
    const company = scope.unrestricted ? (req.query.company || null) : scope.company;
    if (!company) return res.json({ devices: [] });

    deviceStatusPoll.ensureWatching(company);
    const rows = deviceStatusPoll.getStatuses(company);
    const sanitized = rows.map((r) => ({ ...r, mac: req.userRole === "operator" ? undefined : r.mac }));
    res.json({ devices: sanitized });
  } catch (e) {
    console.error("[STATUS-POLL] durum alınamadı:", e.message);
    res.status(500).json({ error: "Durum alınamadı" });
  }
});

// Toplu Okuma ekranındaki sektör veya tek cihaz "şimdi oku" düğmesi.
// Cihaz MAC'i istemciden alınmaz; cihaz ID'si yetki kapsamı içinde çözülür.
app.post("/api/device-status/refresh", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu okuma kapalı" });
  try {
    const requestedIds = Array.isArray(req.body?.deviceIds)
      ? [...new Set(req.body.deviceIds.map((id) => String(id)).filter(Boolean))].slice(0, 100)
      : [];
    if (requestedIds.length === 0) return res.status(400).json({ error: "Okunacak cihaz seçilmedi" });

    const scope = scopeFor(req);
    const all = getDevices({});
    const devices = requestedIds.map((id) => all.find((device) => String(device.id) === id)).filter(Boolean);
    if (devices.length !== requestedIds.length) return res.status(404).json({ error: "Cihaz bulunamadı" });

    const unauthorized = devices.find((device) => !allowsDevice(scope, device));
    if (unauthorized) return res.status(403).json({ error: "Bu cihazı okuma yetkiniz yok" });

    const requestedCompany = String(req.body?.company || "").trim();
    const company = scope.unrestricted ? (requestedCompany || devices[0].company || "") : (scope.company || "");
    if (!company) return res.status(400).json({ error: "Şirket kapsamı bulunamadı" });
    if (devices.some((device) => String(device.company || "").trim() !== company)) {
      return res.status(403).json({ error: "Aynı şirkete ait cihazlar birlikte okunabilir" });
    }

    const result = deviceStatusPoll.requestRefresh(company, devices);
    return res.status(202).json({ queued: result.queued });
  } catch (e) {
    console.error("[STATUS-REFRESH] manuel okuma hatası:", e.message);
    return res.status(500).json({ error: "Okuma başlatılamadı" });
  }
});

// ── Genel Bakış — kullanıcının kapsamındaki cihazların özeti ──
// Her istek (sayfa 30sn'de bir çeker) arka plandaki durum taramasını canlı tutar
// (bkz. device-status-poll.js ensureWatching) — sayfa kapanınca 45sn içinde durur.
// Tarama cihazları sırayla dolaştığı için sayılar device_live_status'taki SON
// OKUNAN değerlerdir; tam bir tur dakikalar sürer, bu yüzden lastStatusAt da döner.
app.get("/api/overview", requireAuth(), async (req, res) => {
  try {
    const { getAllDeviceLiveStatus, listRecentJobs } = require("./db");
    const scope = scopeFor(req);
    const devices = visibleDevices(scope);
    if (scope.unrestricted) deviceStatusPoll.ensureWatching(deviceStatusPoll.ALL_COMPANIES);
    else if (scope.company) deviceStatusPoll.ensureWatching(scope.company);
    const up = (m) => String(m || "").toUpperCase();
    const liveByMac = new Map(getAllDeviceLiveStatus().map((r) => [up(r.mac), r]));

    const states = {};       // state -> { state, label, count }
    const companies = {};    // company -> { company, total, states: { state: adet } }
    const versions = {};     // sürüm -> adet
    const connTypes = {};    // bağlantı tipi -> adet
    let lastStatusAt = null;

    for (const d of devices) {
      const live = liveByMac.get(up(d.mac));
      const state = live?.state || "never";
      const label = live?.label || "Hiç Okunmadı";
      if (!states[state]) states[state] = { state, label, count: 0 };
      states[state].count++;
      if (live?.updated_at && (!lastStatusAt || live.updated_at > lastStatusAt)) lastStatusAt = live.updated_at;

      const cname = d.company || "—";
      if (!companies[cname]) companies[cname] = { company: cname, total: 0, states: {} };
      companies[cname].total++;
      companies[cname].states[state] = (companies[cname].states[state] || 0) + 1;

      const ver = String(d.sw_version || "").trim().toLowerCase() || "bilinmiyor";
      versions[ver] = (versions[ver] || 0) + 1;
      const conn = String(d.connection || "").trim().toUpperCase() || "BİLİNMİYOR";
      connTypes[conn] = (connTypes[conn] || 0) + 1;
    }

    const byCount = (a, b) => b.count - a.count;
    const toList = (obj, key) => Object.entries(obj).map(([k, count]) => ({ [key]: k, count })).sort(byCount);

    // Aktif bağlantılar — /api/connections ile aynı yetki (admin + superadmin)
    let activeConnections = null;
    if (req.userRole === "superadmin" || req.userRole === "admin") {
      const target = await readTarget();
      const users = readUsers();
      const devByMac = new Map(devices.map((d) => [up(d.mac), d]));
      activeConnections = target.requests
        .filter((r) => r.target && r.control === "activate" && users.some((u) => u.username === r.session_id))
        .map((r) => {
          const u = users.find((x) => x.username === r.session_id);
          const dev = devByMac.get(up(r.target));
          return { fullName: u.fullName || u.username, device: dev?.location || dev?.device_code || r.target, company: dev?.company || null };
        });
    }

    const recentJobs = BULK_JOB_ROLES.includes(req.userRole)
      ? listRecentJobs({
          createdBy: scope.unrestricted ? null : req.username,
          includeOta: scope.unrestricted && OTA_BULK_JOB_ROLES.includes(req.userRole),
        })
      : [];

    res.json({
      totalDevices: devices.length,
      totalCompanies: Object.keys(companies).length,
      states: Object.values(states).sort(byCount),
      lastStatusAt,
      companies: Object.values(companies).sort((a, b) => b.total - a.total),
      versions: toList(versions, "version"),
      connTypes: toList(connTypes, "type"),
      activeConnections,
      recentJobs,
    });
  } catch (e) {
    console.error("[OVERVIEW] özet alınamadı:", e.message);
    res.status(500).json({ error: "Özet alınamadı" });
  }
});

// Cihaz Yönetimi / Cihaz Kurulum — superadmin ve admin (device-scope'ta ikisi de
// unrestricted); operator ve altı bu uçlara erişemez.
const DEVICE_MGMT_ROLES = ["superadmin", "admin"];

function parseCoordinate(value, min, max, label) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label} - ${min} ile ${max} arasında geçerli bir sayı olmalı`);
    error.statusCode = 400;
    throw error;
  }
  return Number(number.toFixed(7));
}

// Şehir / ilçe: gönderildiyse resmi yazımına çevrilir; gönderilmediyse konum metninden tahmin edilir
const { inferCityDistrict, canonicalCity, canonicalDistrict, iller: TURKEY_CITIES } = require('./turkey-locations');
function parseCityDistrict(body, location, previous = null) {
  const has = (key) => body && Object.prototype.hasOwnProperty.call(body, key);
  let city = has("city") ? canonicalCity(body.city) : previous?.city ?? null;
  let district = has("district") ? canonicalDistrict(city, body.district) : previous?.district ?? null;
  if (!city && !district && !has("city") && !has("district")) {
    ({ city, district } = inferCityDistrict(location));
  }
  return { city: city || null, district: district || null };
}

function parseLocationCoordinates(body) {
  return {
    latitude: parseCoordinate(body?.latitude, -90, 90, "Enlem"),
    longitude: parseCoordinate(body?.longitude, -180, 180, "Boylam"),
  };
}

// Türkiye il/ilçe listesi — Cihaz Yönetimi'ndeki Şehir/İlçe seçimi için
app.get("/api/locations/turkey", requireAuth(), (req, res) => {
  res.json({ iller: TURKEY_CITIES });
});

// Cihaz listesi export
app.get("/api/devices/export", requireAuth(), async (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const scope = scopeFor(req);
    const devices = scope.unrestricted ? getDevices({}) : visibleDevices(scope);
    const { execSync } = require("child_process");
    const result = execSync("python3 /root/bluetech-panel/backend/export_devices.py", { input: JSON.stringify(devices), maxBuffer: 20 * 1024 * 1024 });
    res.setHeader("Content-Type", "application/vnd.oasis.opendocument.spreadsheet");
    res.setHeader("Content-Disposition", "attachment; filename=bluetech_cihazlar.ods");
    res.send(result);
  } catch (e) {
    console.error("export hata:", e.message);
    res.status(500).json({ error: "Export basarisiz" });
  }
});

// ── Cihaz içe aktarma — export_devices.py'nin ürettiği .ods formatını geri okur ── //
const deviceImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post("/api/devices/import", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });

  deviceImportUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "Dosya yüklenemedi: " + err.message });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Dosya bulunamadı" });

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".ods") {
      return res.status(400).json({ error: "Sadece .ods dosyaları kabul edilir (panelin 'Dışa Aktar' ile ürettiği format)" });
    }

    const tmpPath = path.join(os.tmpdir(), `device_import_${Date.now()}.ods`);
    try {
      fs.writeFileSync(tmpPath, file.buffer);
      const { execSync } = require("child_process");
      const { replaceAllDevices, getDevices } = require("./db");
      const output = execSync(`python3 "${path.join(__dirname, "import_devices.py")}" "${tmpPath}"`, { maxBuffer: 20 * 1024 * 1024 });
      const imported = JSON.parse(output.toString("utf-8"));

      if (!Array.isArray(imported) || imported.length === 0) {
        return res.status(400).json({ error: "Dosyada geçerli (MAC adresi olan) cihaz bulunamadı" });
      }

      // MAC'e göre eşleştir: varsa güncelle, yoksa yeni ekle (mevcut cihazları silmez)
      const scope = scopeFor(req);
      const importingCompany = companyForRequest(req);
      const existing = getDevices({});
      const sourceUser = readUsers().find((item) => item.username === req.username);
      const byMac = {};
      existing.forEach((d) => { if (d.mac) byMac[normalizeMacValue(d.mac)] = d; });

      let added = 0, updated = 0;
      for (const imp of imported) {
        imp.company = normalizeDeviceCompany(imp.company);
        const key = normalizeMacValue(imp.mac);
        const current = byMac[key];

        // Şirket yöneticisi başka şirkete ait bir satırı içe aktaramaz.
        // Boş FIRMA/Bireysel satırlar ise kendi hesabına atanır.
        if (!scope.unrestricted && importingCompany && imp.company && imp.company !== importingCompany) {
          return res.status(403).json({ error: `Dosyada ${imp.company} şirketine ait yetkisiz cihaz bulundu` });
        }
        if (!scope.unrestricted && current && !allowsDevice(scope, current)) {
          return res.status(403).json({ error: 'Dosyada erişim kapsamınız dışındaki cihaz bulundu' });
        }
        if (sourceUser && importingCompany && isIndividualDeviceCompany(imp.company) && !current) {
          addOwnedDeviceToUser(sourceUser, imp.mac);
        }

        if (byMac[key]) {
          // Eski Excel dosyalarında koordinat sütunları yoksa, panelden
          // kullanıcının verdiği konumu/harita koordinatını silme.
          if (imp.latitude === null || imp.latitude === undefined || imp.latitude === '') {
            imp.latitude = byMac[key].latitude ?? null;
          }
          if (imp.longitude === null || imp.longitude === undefined || imp.longitude === '') {
            imp.longitude = byMac[key].longitude ?? null;
          }
          if (!imp.city) imp.city = byMac[key].city ?? null;
          if (!imp.district) imp.district = byMac[key].district ?? null;
          Object.assign(byMac[key], imp);
          updated++;
        } else {
          byMac[key] = {
            ...imp,
            ...(imp.city || imp.district ? {} : inferCityDistrict(imp.location)),
            is_revision: (imp.location || "").toLowerCase().includes("revizyon") ? 1 : 0,
          };
          added++;
        }
      }

      replaceAllDevices(Object.values(byMac));
      if (sourceUser && importingCompany) writeUsers(readUsers().map((item) => item.username === sourceUser.username ? sourceUser : item));
      console.log(`[DEVICES-IMPORT] ${req.username}: ${added} yeni, ${updated} güncellendi`);
      res.json({ message: `İçe aktarma tamamlandı: ${added} yeni cihaz, ${updated} güncellendi`, added, updated });
    } catch (e) {
      console.error("[DEVICES-IMPORT] hata:", e.message);
      res.status(500).json({ error: "İçe aktarma başarısız: " + e.message });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  });
});

app.get("/api/devices/:code", requireAuth(), (req, res) => {
  try {
    const device = getDeviceByCode(req.params.code);
    if (!device) return res.status(404).json({ error: "Cihaz bulunamadi" });
    if (!allowsDevice(scopeFor(req), device)) {
      return res.status(403).json({ error: "Yetkisiz" });
    }
    const result = { ...device };
    if (req.userRole === "operator") delete result.mac;
    res.json({ device: result });
  } catch (e) {
    res.status(500).json({ error: "Cihaz alinamadi" });
  }
});

// Cihaz Yönetimi — sadece superadmin

app.post("/api/devices", requireAuth(), async (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { device_code, serial_no, mac, location, connection, logo, sw_version, msp_fw, msp_sw, hw_version, note, extra_fields } = req.body || {};
    const company = normalizeDeviceCompany(req.body?.company);
    const { latitude, longitude } = parseLocationCoordinates(req.body || {});
    const { city, district } = parseCityDistrict(req.body || {}, location);
    if (!mac) return res.status(400).json({ error: "MAC zorunlu" });
    if (!canManageDeviceCompany(req, company)) {
      return res.status(403).json({ error: "Şirket yöneticisi yalnızca kendi şirketine veya Bireysel sahipliğine cihaz ekleyebilir" });
    }
    const { replaceAllDevices, getDevices } = require("./db");
    const existing = getDevices({});

    const duplicate = existing.find((d) => (d.mac || "").trim().toUpperCase() === mac.trim().toUpperCase());
    if (duplicate) {
      return res.status(409).json({
        error: `Bu MAC adresi zaten kayıtlı: ${duplicate.location || duplicate.device_code || duplicate.mac} (${duplicate.company})`,
      });
    }

    existing.push({
      device_code: device_code || null,
      serial_no: serial_no || null,
      mac,
      company,
      location: location || null,
      city,
      district,
      latitude,
      longitude,
      connection: connection || null,
      logo: logo || null,
      sw_version: sw_version || null,
      msp_fw: msp_fw || null,
      msp_sw: msp_sw || null,
      hw_version: hw_version || null,
      note: note || null,
      updated_at: new Date().toISOString().split("T")[0],
      extra_fields: extra_fields && typeof extra_fields === "object" ? extra_fields : {},
      is_revision: (location || "").toLowerCase().includes("revizyon") ? 1 : 0,
    });
    replaceAllDevices(existing);
    if (isIndividualDeviceCompany(company) && req.userRole === 'admin' && companyForRequest(req)) {
      const users = readUsers();
      const source = users.find((item) => item.username === req.username);
      if (source && addOwnedDeviceToUser(source, mac)) writeUsers(users);
    }
    res.json({ message: "Cihaz eklendi" });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: "Cihaz eklenemedi" });
  }
});

app.delete("/api/devices/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { replaceAllDevices, getDevices } = require("./db");
    const existing = getDevices({});
    const target = existing.find((d) => String(d.id) === String(req.params.id));
    if (!target) return res.status(404).json({ error: "Cihaz bulunamadı" });
    if (!scopeFor(req).unrestricted && !allowsDevice(scopeFor(req), target)) {
      return res.status(403).json({ error: "Bu cihazı silme yetkiniz yok" });
    }
    const filtered = existing.filter((d) => String(d.id) !== String(req.params.id));
    replaceAllDevices(filtered);
    if (isIndividualDeviceCompany(target.company)) {
      const users = readUsers();
      let changed = false;
      for (const user of users) changed = removeOwnedDeviceFromUser(user, target.mac) || changed;
      if (changed) writeUsers(users);
    }
    res.json({ message: "Cihaz silindi" });
  } catch (e) {
    res.status(500).json({ error: "Cihaz silinemedi" });
  }
});

app.put("/api/devices/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { device_code, serial_no, mac, location, connection, logo, sw_version, msp_fw, msp_sw, hw_version, note, extra_fields } = req.body || {};
    const company = normalizeDeviceCompany(req.body?.company);
    const { latitude, longitude } = parseLocationCoordinates(req.body || {});
    if (!mac) return res.status(400).json({ error: "MAC zorunlu" });
    if (!canManageDeviceCompany(req, company)) {
      return res.status(403).json({ error: "Şirket yöneticisi yalnızca kendi şirketini veya Bireysel sahipliğini kullanabilir" });
    }
    const { replaceAllDevices, getDevices } = require("./db");
    const existing = getDevices({});
    const idx = existing.findIndex((d) => String(d.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: "Cihaz bulunamadı" });
    const previousDevice = existing[idx];
    const { city, district } = parseCityDistrict(req.body || {}, location, previousDevice);
    if (normalizeMacValue(mac) !== normalizeMacValue(previousDevice.mac)) {
      return res.status(409).json({ error: "MAC adresi değiştirilemez; cihaz kimliği sabittir" });
    }
    const scope = scopeFor(req);
    if (!scope.unrestricted && !allowsDevice(scope, previousDevice)) {
      return res.status(403).json({ error: "Bu cihazı düzenleme yetkiniz yok" });
    }

    const duplicate = existing.find((d, i) => i !== idx && (d.mac || "").trim().toUpperCase() === mac.trim().toUpperCase());
    if (duplicate) {
      return res.status(409).json({
        error: `Bu MAC adresi başka bir cihazda kayıtlı: ${duplicate.location || duplicate.device_code || duplicate.mac} (${duplicate.company})`,
      });
    }

    existing[idx] = {
      ...existing[idx],
      device_code: device_code || null,
      serial_no: serial_no || null,
      mac,
      company,
      location: location || null,
      city,
      district,
      latitude,
      longitude,
      connection: connection || null,
      logo: logo || null,
      sw_version: sw_version || null,
      msp_fw: msp_fw || null,
      msp_sw: msp_sw || null,
      hw_version: hw_version || null,
      note: note || null,
      updated_at: new Date().toISOString().split("T")[0],
      extra_fields: extra_fields && typeof extra_fields === "object" ? extra_fields : (existing[idx].extra_fields || {}),
      is_revision: (location || "").toLowerCase().includes("revizyon") ? 1 : 0,
    };
    replaceAllDevices(existing);
    if (req.userRole === 'admin' && companyForRequest(req)) {
      const users = readUsers();
      const source = users.find((item) => item.username === req.username);
      let changed = false;
      if (source && isIndividualDeviceCompany(company)) changed = addOwnedDeviceToUser(source, mac) || changed;
      if (source && !isIndividualDeviceCompany(company) && isIndividualDeviceCompany(previousDevice.company)) {
        changed = removeOwnedDeviceFromUser(source, previousDevice.mac) || changed;
      }
      if (changed) writeUsers(users);
    }
    res.json({ message: "Cihaz güncellendi" });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: "Cihaz güncellenemedi" });
  }
});

// Kullanıcıların yalnızca kendi erişim kapsamındaki cihazın konum bilgisini
// güncelleyebilmesi. Şirket/MAC/versiyon/OCPP alanları bu uçtan değiştirilemez.
app.put("/api/devices/:id/location", requireAuth(), (req, res) => {
  try {
    const device = getDevices({}).find((item) => String(item.id) === String(req.params.id));
    if (!device) return res.status(404).json({ error: "Cihaz bulunamadı" });
    if (!allowsDevice(scopeFor(req), device)) return res.status(403).json({ error: "Bu cihazın konumunu değiştirme yetkiniz yok" });

    const location = String(req.body?.location || "").trim();
    if (location.length > 160) return res.status(400).json({ error: "Konum adı 160 karakteri geçemez" });
    const { latitude, longitude } = parseLocationCoordinates(req.body || {});
    updateDeviceLocation(device.id, { location, latitude, longitude });

    const updated = getDevices({}).find((item) => String(item.id) === String(device.id));
    if (req.userRole === "operator" && updated) delete updated.mac;
    return res.json({ message: "Konum güncellendi", device: updated });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error("[DEVICE-LOCATION] güncelleme hatası:", e.message);
    return res.status(500).json({ error: "Konum güncellenemedi" });
  }
});

// Başarılı cihaz okuması veya SET OK sonrası envanterdeki karşılığı güncelle.
// Eşleştirme yalnızca MAC üzerinden yapılır; MAC'in kendisi ve açıklama alanı
// bu endpoint ile kesinlikle değiştirilemez. Frontend MAC göndermese bile
// aktif oturumun target'ından backend çözer.
app.post("/api/devices/sync-field", requireAuth(), async (req, res) => {
  try {
    const variable = Number(req.body?.variable);
    const rawValue = req.body?.value;
    const value = rawValue === undefined || rawValue === null ? "" : String(rawValue).trim();
    const fieldMap = {
      2: "device_code",   // OCPP ID
      4: null,             // Maks. güç — envanterde sabit alan değil
      7: "connection",     // Bağlantı türü
      33: "sw_version",    // ESP yazılımı
      44: "serial_no",     // Box/seri no
      61: "msp_sw",        // MSP yazılımı
      64: "logo",          // Aktif logo adı
      68: "hw_version",    // ESP donanımı
    };
    const field = fieldMap[variable];
    if (!field || !value || value === "SET OK") return res.json({ updated: false });

    let mac = String(req.body?.mac || "").trim();
    if (!mac) {
      const targetData = await readTarget();
      mac = targetData.requests.find((item) => item.session_id === req.sessionId && item.control === "activate")?.target || "";
    }
    if (!MAC_REGEX.test(mac)) return res.status(400).json({ error: "Aktif cihaz MAC'i bulunamadı" });

    let normalizedValue = value;
    if (field === "connection") {
      const connectionMap = { "0": "CommSupported", "1": "GSM", "2": "WiFi", "3": "ETH" };
      normalizedValue = connectionMap[value] || value;
    }

    const device = getDevices({}).find((item) =>
      String(item.mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase() ===
      mac.replace(/[^0-9a-f]/gi, "").toUpperCase()
    );
    if (!device) return res.status(404).json({ error: "Cihaz kayıtlı değil" });
    if (!allowsDevice(scopeFor(req), device)) return res.status(403).json({ error: "Bu cihazı güncelleme yetkiniz yok" });

    const { changes } = { changes: { [field]: normalizedValue } };
    const updated = updateDeviceInventoryByMac(mac, changes);
    return res.json({ updated: updated > 0, field, value: normalizedValue });
  } catch (e) {
    console.error("[DEVICE-SYNC] envanter güncelleme hatası:", e.message);
    return res.status(500).json({ error: "Envanter güncellenemedi" });
  }
});

// ── Toplu cihaz düzenleme — seçilen cihazlara aynı değeri atar, ya da bul-değiştir yapar ── //
const BULK_EDITABLE_FIELDS = ["company", "location", "city", "district", "latitude", "longitude", "connection", "logo", "sw_version", "msp_fw", "msp_sw", "hw_version", "note"];

app.post("/api/devices/bulk-update", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { ids, field, isCustom, mode, value, find, replace } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Cihaz seçilmedi" });
    if (!isCustom && !BULK_EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: "Geçersiz alan" });
    if (!["set", "replace"].includes(mode)) return res.status(400).json({ error: "Geçersiz mod" });
    if (mode === "replace" && !find) return res.status(400).json({ error: "'Bul' değeri boş olamaz" });
    if (!isCustom && ["latitude", "longitude"].includes(field) && mode !== "set") {
      return res.status(400).json({ error: "Koordinatlarda yalnızca değer ata modu kullanılabilir" });
    }
    const normalizedBulkValue = !isCustom && field === "company"
      ? normalizeDeviceCompany(value)
      : !isCustom && field === "city"
        ? canonicalCity(value)
      : !isCustom && field === "latitude"
        ? parseCoordinate(value, -90, 90, "Enlem")
        : !isCustom && field === "longitude"
          ? parseCoordinate(value, -180, 180, "Boylam")
          : value;
    if (!isCustom && field === "company" && !canManageDeviceCompany(req, normalizedBulkValue)) {
      return res.status(403).json({ error: "Şirket yöneticisi yalnızca kendi şirketine veya Bireysel sahipliğine geçiş yapabilir" });
    }

    const { getDevices, replaceAllDevices } = require("./db");
    const existing = getDevices({});
    const idSet = new Set(ids.map(String));
    const today = new Date().toISOString().split("T")[0];

    let updated = 0;
    for (const d of existing) {
      if (!idSet.has(String(d.id))) continue;
      if (!scopeFor(req).unrestricted && !allowsDevice(scopeFor(req), d)) {
        return res.status(403).json({ error: "Seçilen cihazlardan biri erişim kapsamınız dışında" });
      }

      if (isCustom) {
        d.extra_fields = d.extra_fields && typeof d.extra_fields === "object" ? { ...d.extra_fields } : {};
        if (mode === "set") {
          d.extra_fields[field] = value || "";
          d.updated_at = today;
          updated++;
        } else {
          const current = d.extra_fields[field] || "";
          if (current.includes(find)) {
            d.extra_fields[field] = current.split(find).join(replace || "");
            d.updated_at = today;
            updated++;
          }
        }
        continue;
      }

      if (mode === "set") {
        d[field] = normalizedBulkValue ?? null;
        d.updated_at = today;
        updated++;
      } else {
        const current = d[field] || "";
        if (current.includes(find)) {
          d[field] = current.split(find).join(replace || "");
          d.updated_at = today;
          updated++;
        }
      }
    }

    replaceAllDevices(existing);
    if (!isCustom && field === "company" && isIndividualDeviceCompany(normalizedBulkValue) && req.userRole === 'admin' && companyForRequest(req)) {
      const users = readUsers();
      const source = users.find((item) => item.username === req.username);
      let changed = false;
      if (source) {
        for (const d of existing) if (idSet.has(String(d.id))) changed = addOwnedDeviceToUser(source, d.mac) || changed;
      }
      if (changed) writeUsers(users);
    }
    console.log(`[DEVICES-BULK] ${req.username}: ${updated} cihaz güncellendi (alan: ${field}, mod: ${mode})`);
    res.json({ message: `${updated} cihaz güncellendi`, updated });
  } catch (e) {
    console.error("[DEVICES-BULK] hata:", e.message);
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    res.status(500).json({ error: "Toplu güncelleme başarısız: " + e.message });
  }
});

// =============================================
//  Toplu Parametre — kalıcı, arka planda çalışan işler (bkz. bulk-jobs.js)
//  superadmin/admin (Panel, device-scope zaten unrestricted) ve operator
//  (kendi şirket hesabı, Dashboard) erişir.
// =============================================
const BULK_JOB_ROLES = ["superadmin", "admin", "operator"];

app.post("/api/bulk-jobs", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { company, deviceIds, workerCount, autoRetryMinutes, autoRetryMax } = req.body || {};
    // Geriye dönük uyumluluk: eski tekli {paramId, value} de kabul edilir,
    // asıl beklenen yeni biçim: params: [{paramId, value}, ...] — tek
    // ekrandan birden fazla parametre aynı cihazlara art arda gönderilebilsin.
    const rawParams = Array.isArray(req.body?.params) && req.body.params.length > 0
      ? req.body.params
      : (req.body?.paramId !== undefined ? [{ paramId: req.body.paramId, value: req.body.value }] : []);
    if (rawParams.length === 0) return res.status(400).json({ error: "Parametre seçilmedi" });

    const params = [];
    for (const rp of rawParams) {
      const paramIdNum = Number(rp.paramId);
      const def = bulkJobs.BULK_PARAMS[paramIdNum];
      if (!def) return res.status(400).json({ error: `Geçersiz parametre: ${rp.paramId}` });
      const operation = rp.operation === "read" ? "read" : "set";
      if (operation === "set" && (rp.value === undefined || rp.value === null || rp.value === "")) {
        return res.status(400).json({ error: `"${def.label}" için değer boş olamaz` });
      }
      params.push({ id: paramIdNum, value: operation === "read" ? "" : String(rp.value), operation });
    }
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) return res.status(400).json({ error: "Cihaz seçilmedi" });
    // Üst sınır 8 — uzaktaki köprü (85.105.100.7:9001) tek TCP bağlantısı
    // üzerinden her şeyi yönlendiriyor, aşırı paralellik orayı zorlayabilir.
    const clampedWorkerCount = Math.max(1, Math.min(Number(workerCount) || 1, 8));

    const scope = scopeFor(req);
    const allDevices = getDevices({});
    const idSet = new Set(deviceIds.map(String));
    const devices = allDevices.filter((d) => idSet.has(String(d.id)));
    if (devices.length !== deviceIds.length) return res.status(404).json({ error: "Bazı cihazlar bulunamadı" });
    const unauthorized = devices.find((d) => !allowsDevice(scope, d));
    if (unauthorized) return res.status(403).json({ error: "Bu cihazlardan en az birine erişim yetkiniz yok" });

    const autoRetry = clampAutoRetry(autoRetryMinutes, autoRetryMax);
    const jobId = bulkJobs.startJob({
      company: company || null, params, devices, createdBy: req.username, workerCount: clampedWorkerCount, ...autoRetry,
    });
    const paramSummary = params.map((p) => `${bulkJobs.BULK_PARAMS[p.id].label} ${p.operation === "read" ? "(READ)" : `=${p.value}`}`).join(", ");
    const autoRetryNote = autoRetry.autoRetryMinutes ? `, oto-tekrar=${autoRetry.autoRetryMinutes}dk×${autoRetry.autoRetryMax}` : "";
    console.log(`[BULK-JOB] ${req.username} başlattı: ${jobId} (${paramSummary}, ${devices.length} cihaz, ${clampedWorkerCount} paralel${autoRetryNote})`);
    res.json({ id: jobId });
  } catch (e) {
    console.error("[BULK-JOB] başlatma hatası:", e.message);
    res.status(500).json({ error: "İş başlatılamadı: " + e.message });
  }
});

app.get("/api/bulk-jobs/:id", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = bulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    const scope = scopeFor(req);
    if (!scope.unrestricted && job.created_by !== req.username) {
      return res.status(403).json({ error: "Bu işi görme yetkiniz yok" });
    }
    // Operatörler diğer uçlarda (/api/devices) olduğu gibi MAC görmez.
    const sanitizedJob = req.userRole === "operator"
      ? { ...job, devices: job.devices.map((d) => ({ ...d, mac: undefined })) }
      : job;
    res.json({ job: sanitizedJob });
  } catch (e) {
    res.status(500).json({ error: "İş alınamadı" });
  }
});

app.get("/api/bulk-jobs", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const scope = scopeFor(req);
    const opts = { activeOnly: req.query.active === "1" };
    if (!scope.unrestricted) opts.createdBy = req.username; // operator sadece kendi işlerini görür
    else if (req.query.company) opts.company = req.query.company;
    res.json({ jobs: bulkJobs.listJobs(opts) });
  } catch (e) {
    res.status(500).json({ error: "İşler alınamadı" });
  }
});

app.post("/api/bulk-jobs/:id/stop", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = bulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    const scope = scopeFor(req);
    if (!scope.unrestricted && job.created_by !== req.username) return res.status(403).json({ error: "Yetkisiz" });
    bulkJobs.stopJob(req.params.id);
    res.json({ message: "Durduruldu" });
  } catch (e) {
    res.status(500).json({ error: "Durdurulamadı" });
  }
});

// "Kapat" — işi listeden gizle (veri silinmiyor, sadece otomatik yakalamadan çıkarılıyor)
app.post("/api/bulk-jobs/:id/dismiss", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = bulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    const scope = scopeFor(req);
    if (!scope.unrestricted && job.created_by !== req.username) return res.status(403).json({ error: "Yetkisiz" });
    bulkJobs.dismissJob(req.params.id);
    res.json({ message: "Kapatıldı" });
  } catch (e) {
    res.status(500).json({ error: "Kapatılamadı" });
  }
});

app.post("/api/bulk-jobs/:id/retry", requireAuth(), (req, res) => {
  if (isRestrictedOperator(req)) return res.status(403).json({ error: "Bireysel/kısıtlı hesaplarda toplu gönderim kapalı" });
  if (!BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const oldJob = bulkJobs.getJob(req.params.id);
    if (!oldJob) return res.status(404).json({ error: "İş bulunamadı" });
    const scope = scopeFor(req);
    if (!scope.unrestricted && oldJob.created_by !== req.username) return res.status(403).json({ error: "Yetkisiz" });

    const retryDevices = oldJob.devices.filter((d) => BULK_JOB_RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return res.status(400).json({ error: "Tekrar denenecek cihaz yok" });

    // Elle tekrar deneniyorsa bu işe ait bekleyen otomatik tekrar (varsa)
    // artık gereksiz — ikisi çakışıp iki ayrı iş doğurmasın.
    bulkJobs.cancelScheduledAutoRetry(req.params.id);

    // device_id (SQLite autoincrement) yerine MAC üzerinden eşleştiriliyor —
    // aradan bir toplu cihaz düzenleme/import geçtiyse id'ler yeniden atanmış
    // olabilir (bkz. replaceAllDevices), o zaman device_id artık aynı fiziksel
    // cihaza denk gelmeyebilir ama MAC değişmez. Daha önce tam bu yüzden bir
    // retry sıfır cihazla sessizce "bitmiş" görünmüştü.
    const retryMacs = new Set(retryDevices.map((d) => d.mac).filter(Boolean));
    const devices = getDevices({}).filter((d) => retryMacs.has(d.mac));
    if (devices.length === 0) {
      return res.status(404).json({ error: "Tekrar denenecek cihazlar artık bulunamıyor (MAC eşleşmedi — cihaz listesi değişmiş olabilir)" });
    }
    const unauthorized = devices.find((d) => !allowsDevice(scope, d));
    if (unauthorized) return res.status(403).json({ error: "Bu cihazlardan en az birine erişim yetkiniz yok" });

    const jobId = bulkJobs.startJob({
      company: oldJob.company,
      params: oldJob.params.map((p) => ({ id: p.id, value: p.value, operation: p.operation || "set" })),
      devices, createdBy: req.username, workerCount: oldJob.worker_count || 1,
      // Başta seçilen oto-tekrar ayarları elle tekrar denendiğinde de korunur —
      // "used" sayacı TAŞINMAZ, bu elle tetiklenen bir deneme (otomatik
      // haktan düşülmüyor), ama devam eden zincir aynı ayarlarla sürer.
      autoRetryMinutes: oldJob.auto_retry_minutes, autoRetryMax: oldJob.auto_retry_max, autoRetryUsed: oldJob.auto_retry_used,
    });
    console.log(`[BULK-JOB] ${req.username} tekrar denedi: ${req.params.id} -> ${jobId} (${devices.length} cihaz)`);
    res.json({ id: jobId });
  } catch (e) {
    console.error("[BULK-JOB] retry hatası:", e.message);
    res.status(500).json({ error: "Tekrar denenemedi" });
  }
});

// =============================================
//  Toplu Güncelleme (OTA firmware) — kalıcı, arka planda çalışan işler
//  (bkz. ota-bulk-jobs.js). superadmin ve admin — device-scope'ta ikisi de
//  unrestricted, BulkUpdate.jsx da ikisine açık (Home.jsx'teki "bulk-update" case'i).
// =============================================
const OTA_BULK_JOB_ROLES = ["superadmin", "admin"];

app.post("/api/ota-bulk-jobs", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { company, kind, verifyVersion, devices, workerCount, autoRetryMinutes, autoRetryMax } = req.body || {};
    if (kind !== "esp" && kind !== "msp") return res.status(400).json({ error: "Geçersiz güncelleme tipi" });
    if (!Array.isArray(devices) || devices.length === 0) return res.status(400).json({ error: "Cihaz seçilmedi" });

    const cleanDevices = [];
    for (const d of devices) {
      const mac = String(d?.mac || "").toUpperCase();
      if (!MAC_REGEX.test(mac)) return res.status(400).json({ error: `Geçersiz MAC: ${d?.mac}` });
      cleanDevices.push({ mac, location: d.location || null, device_code: d.device_code || null });
    }
    // Üst sınır 8 — Toplu Parametre'deki aynı gerekçe (uzaktaki köprü tek TCP
    // bağlantısı). İndirmenin kendisi ayrı bir HTTP hattından gittiği için bu
    // sınır sadece bağlan/aktifleştir/komut gönder adımlarını korur.
    const clampedWorkerCount = Math.max(1, Math.min(Number(workerCount) || 1, 8));

    const otaType = kind === "esp" ? "1" : "2";
    const autoRetry = clampAutoRetry(autoRetryMinutes, autoRetryMax);
    const jobId = otaBulkJobs.startJob({
      company: company || null, kind, otaType, verifyVersion: !!verifyVersion,
      devices: cleanDevices, createdBy: req.username, workerCount: clampedWorkerCount, ...autoRetry,
    });
    const autoRetryNote = autoRetry.autoRetryMinutes ? `, oto-tekrar=${autoRetry.autoRetryMinutes}dk×${autoRetry.autoRetryMax}` : "";
    console.log(`[OTA-BULK-JOB] ${req.username} başlattı: ${jobId} (${kind}, doğrulama=${!!verifyVersion}, ${cleanDevices.length} cihaz, ${clampedWorkerCount} paralel${autoRetryNote})`);
    res.json({ id: jobId });
  } catch (e) {
    console.error("[OTA-BULK-JOB] başlatma hatası:", e.message);
    res.status(500).json({ error: "İş başlatılamadı: " + e.message });
  }
});

app.get("/api/ota-bulk-jobs/:id", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = otaBulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    res.json({ job });
  } catch (e) {
    res.status(500).json({ error: "İş alınamadı" });
  }
});

app.get("/api/ota-bulk-jobs", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const opts = { activeOnly: req.query.active === "1" };
    if (req.query.company) opts.company = req.query.company;
    res.json({ jobs: otaBulkJobs.listJobs(opts) });
  } catch (e) {
    res.status(500).json({ error: "İşler alınamadı" });
  }
});

app.post("/api/ota-bulk-jobs/:id/stop", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = otaBulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    otaBulkJobs.stopJob(req.params.id);
    res.json({ message: "Durduruldu" });
  } catch (e) {
    res.status(500).json({ error: "Durdurulamadı" });
  }
});

app.post("/api/ota-bulk-jobs/:id/dismiss", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const job = otaBulkJobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "İş bulunamadı" });
    otaBulkJobs.dismissJob(req.params.id);
    res.json({ message: "Kapatıldı" });
  } catch (e) {
    res.status(500).json({ error: "Kapatılamadı" });
  }
});

// "Tekrar Dene" — başarısız/atlanan/yanıt vermeyen/doğrulanamayan cihazlarla
// AYNI ayarlarla (kind/otaType/verifyVersion) yeni bir iş başlatır. Toplu
// Parametre'nin retry'ından farkı: burada device_id yerine mac/location/
// device_code zaten job kaydının kendisinde duruyor (devices tablosuna
// bağımlı değil), o yüzden yeniden çözümlemeye gerek yok.
app.post("/api/ota-bulk-jobs/:id/retry", requireAuth(), (req, res) => {
  if (!OTA_BULK_JOB_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const oldJob = otaBulkJobs.getJob(req.params.id);
    if (!oldJob) return res.status(404).json({ error: "İş bulunamadı" });

    const retryDevices = oldJob.devices.filter((d) => OTA_BULK_JOB_RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return res.status(400).json({ error: "Tekrar denenecek cihaz yok" });

    otaBulkJobs.cancelScheduledAutoRetry(req.params.id);

    const otaType = oldJob.kind === "esp" ? "1" : "2";
    const jobId = otaBulkJobs.startJob({
      company: oldJob.company, kind: oldJob.kind, otaType, verifyVersion: !!oldJob.verify_version,
      devices: retryDevices.map((d) => ({ mac: d.mac, location: d.location, device_code: d.device_code })),
      createdBy: req.username, workerCount: oldJob.worker_count || 1,
      autoRetryMinutes: oldJob.auto_retry_minutes, autoRetryMax: oldJob.auto_retry_max, autoRetryUsed: oldJob.auto_retry_used,
    });
    console.log(`[OTA-BULK-JOB] ${req.username} tekrar denedi: ${req.params.id} -> ${jobId} (${retryDevices.length} cihaz)`);
    res.json({ id: jobId });
  } catch (e) {
    console.error("[OTA-BULK-JOB] retry hatası:", e.message);
    res.status(500).json({ error: "Tekrar denenemedi" });
  }
});

// ── Özel alan tanımları — panelden yeni bir cihaz özelliği tanımlama (Excel'e gerek kalmadan) ── //
app.get("/api/device-fields", requireAuth(), (req, res) => {
  try {
    res.json({ fields: getCustomFields() });
  } catch (e) {
    res.status(500).json({ error: "Alanlar alınamadı" });
  }
});

app.post("/api/device-fields", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { label } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: "Alan adı boş olamaz" });
    const field = addCustomField(label);
    console.log(`[DEVICE-FIELDS] ${req.username} yeni alan ekledi: ${field.field_key}`);
    res.json({ message: "Alan eklendi", field });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/device-fields/:key", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    deleteCustomField(req.params.key);
    console.log(`[DEVICE-FIELDS] ${req.username} alanı sildi: ${req.params.key}`);
    res.json({ message: "Alan silindi" });
  } catch (e) {
    res.status(500).json({ error: "Alan silinemedi" });
  }
});



// Cihaz kurulum profilleri
app.get("/api/device-profiles", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, "device_profiles.json"), "utf-8"));
    res.json({ profiles });
  } catch (e) {
    res.status(500).json({ error: "Profiller yuklenemedi" });
  }
});

const DEVICE_PROFILES_PATH = path.join(__dirname, "device_profiles.json");

function readProfiles() {
  return JSON.parse(fs.readFileSync(DEVICE_PROFILES_PATH, "utf-8"));
}
function writeProfiles(profiles) {
  const tmpPath = DEVICE_PROFILES_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(profiles, null, 2), "utf-8");
  fs.renameSync(tmpPath, DEVICE_PROFILES_PATH);
}

// ── Yeni şirket profili oluştur (KALICI) ── //
app.post("/api/device-profiles", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { label } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: "Şirket adı boş olamaz" });

    const baseKey = label.trim().toLocaleUpperCase("tr").replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
    if (!baseKey) return res.status(400).json({ error: "Geçerli bir şirket adı girin" });

    const profiles = readProfiles();
    let key = baseKey;
    let suffix = 2;
    while (profiles[key]) { key = `${baseKey}${suffix}`; suffix++; }

    profiles[key] = { label: label.trim(), params: [] };
    writeProfiles(profiles);
    console.log(`[DEVICE-PROFILES] ${req.username} yeni şirket profili ekledi: ${key}`);
    res.json({ message: "Şirket eklendi", key, profile: profiles[key] });
  } catch (e) {
    res.status(500).json({ error: "Şirket eklenemedi: " + e.message });
  }
});

// ── Bir şirket profiline KALICI yeni parametre ekle ── //
app.post("/api/device-profiles/:company/params", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { company } = req.params;
    const { id, label, value } = req.body || {};
    const idNum = parseInt(id, 10);
    if (!label || !label.trim()) return res.status(400).json({ error: "Etiket boş olamaz" });
    if (Number.isNaN(idNum)) return res.status(400).json({ error: "Geçerli bir parametre ID'si girin" });

    const profiles = readProfiles();
    if (!profiles[company]) return res.status(404).json({ error: "Şirket profili bulunamadı" });

    if (profiles[company].params.some((p) => p.id === idNum)) {
      return res.status(409).json({ error: "Bu ID zaten bu profilde var" });
    }

    profiles[company].params.push({ id: idNum, label: label.trim(), value: value ?? "" });
    writeProfiles(profiles);
    console.log(`[DEVICE-PROFILES] ${req.username} -> ${company}'a parametre ekledi: #${idNum} ${label}`);
    res.json({ message: "Parametre eklendi", params: profiles[company].params });
  } catch (e) {
    res.status(500).json({ error: "Parametre eklenemedi: " + e.message });
  }
});

// ── Bir şirket profilindeki parametreyi KALICI düzenle ── //
app.put("/api/device-profiles/:company/params/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { company } = req.params;
    const idNum = parseInt(req.params.id, 10);
    const { label, value } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: "Etiket boş olamaz" });

    const profiles = readProfiles();
    if (!profiles[company]) return res.status(404).json({ error: "Şirket profili bulunamadı" });

    const idx = profiles[company].params.findIndex((p) => p.id === idNum);
    if (idx === -1) return res.status(404).json({ error: "Parametre bulunamadı" });

    profiles[company].params[idx] = { id: idNum, label: label.trim(), value: value ?? "" };
    writeProfiles(profiles);
    console.log(`[DEVICE-PROFILES] ${req.username} -> ${company}'da parametre düzenledi: #${idNum}`);
    res.json({ message: "Parametre güncellendi", params: profiles[company].params });
  } catch (e) {
    res.status(500).json({ error: "Parametre güncellenemedi: " + e.message });
  }
});

// ── Bir şirket profilinden parametreyi KALICI sil ── //
app.delete("/api/device-profiles/:company/params/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { company } = req.params;
    const idNum = parseInt(req.params.id, 10);

    const profiles = readProfiles();
    if (!profiles[company]) return res.status(404).json({ error: "Şirket profili bulunamadı" });

    const before = profiles[company].params.length;
    profiles[company].params = profiles[company].params.filter((p) => p.id !== idNum);
    if (profiles[company].params.length === before) {
      return res.status(404).json({ error: "Parametre bulunamadı" });
    }

    writeProfiles(profiles);
    console.log(`[DEVICE-PROFILES] ${req.username} -> ${company}'dan parametre sildi: #${idNum}`);
    res.json({ message: "Parametre silindi", params: profiles[company].params });
  } catch (e) {
    res.status(500).json({ error: "Parametre silinemedi: " + e.message });
  }
});

// =============================================
//  OTA SUNUCU KONTROLÜ — sadece superadmin
//  ESP'ye değil, şirket sunucusuna (OTA host) müdahale eder.
//  Dosya bellekte doğrulanır, diske yazılmadan SFTP ile gönderilir.
// =============================================

const otaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OTA_MAX_FILE_SIZE },
});

const OTA_LOGO_COMPANIES = ["celikler", "ctg", "sepas", "acrapol", "estasyon", "otopriz"];
const OTA_LOG_EVENTS_PATH = process.env.OTA_LOG_EVENTS_PATH || path.join(__dirname, "logo_upload_events.json");

function logoCompanySlug(value) {
  const key = String(value || "").trim().toLocaleLowerCase("tr-TR")
    .replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "");
  const aliases = { celikler: "celikler", celik: "celikler", ctg: "ctg", sepas: "sepas", sepaş: "sepas", acrapol: "acrapol", estasyon: "estasyon", otopriz: "otopriz" };
  if (aliases[key]) return aliases[key];
  if (["bireysel", "individual", "kisisel", "private", "ozel"].includes(key)) return "";
  return key;
}

function logoRemoteFileName(value) {
  const clean = String(value || "").trim().replace(/\.bin$/i, "").replace(/[^a-zA-Z0-9_\-]/g, "_");
  if (!clean) return "";
  return clean.endsWith("_logo") || /_logo_\d+$/i.test(clean) ? `${clean}.bin` : `${clean}_logo.bin`;
}

function logoScopeForRequest(req) {
  if (req.userRole === "superadmin" || req.userRole === "admin") return { unrestricted: true, company: null, slug: null };
  const user = readUsers().find((u) => u.username === req.username);
  const company = user?.company || null;
  return { unrestricted: false, company, slug: logoCompanySlug(company) };
}

function appendLogoUploadEvent(event) {
  try {
    let events = [];
    if (fs.existsSync(OTA_LOG_EVENTS_PATH)) events = JSON.parse(fs.readFileSync(OTA_LOG_EVENTS_PATH, "utf8")) || [];
    events.unshift({ ...event, time: new Date().toISOString() });
    fs.writeFileSync(OTA_LOG_EVENTS_PATH, JSON.stringify(events.slice(0, 200), null, 2), "utf8");
  } catch (e) { console.error("[OTA-SERVER] logo bildirimi yazılamadı:", e.message); }
}

app.post("/api/ota-server/upload", requireAuth(), (req, res) => {
  const logoScope = logoScopeForRequest(req);
  if (!logoScope.unrestricted && !logoScope.slug) return res.status(403).json({ error: "Bu hesap için logo şirketi tanımlı değil" });

  otaUpload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `Dosya çok büyük (limit: ${OTA_MAX_FILE_SIZE / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: "Dosya yüklenemedi: " + err.message });
    }

    const { fileType, company, customName, hwVersion, swVersion, logoFormat } = req.body || {};
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Dosya bulunamadı" });
    if (!["bin", "txt", "logo"].includes(fileType)) {
      return res.status(400).json({ error: "Geçersiz dosya tipi" });
    }
    if (!logoScope.unrestricted && fileType !== "logo") {
      return res.status(403).json({ error: "Şirket hesapları yalnızca kendi logosunu yükleyebilir" });
    }

    let uploadBuffer = file.buffer;
    let remoteFileName;
    let logoBaseName = "";

    // hw/sw versiyonlarını dosya adında güvenle kullanabilmek için temizle (sadece harf/rakam)
    const cleanHw = (hwVersion || "").trim().replace(/[^a-zA-Z0-9]/g, "");
    const cleanSw = (swVersion || "").trim().replace(/[^a-zA-Z0-9]/g, "");

    // ── İçerik doğrulama (uzantıya değil, gerçek içeriğe bakarak) ──
    if (fileType === "bin") {
      const check = validateBin(file.buffer);
      if (!check.valid) return res.status(400).json({ error: check.reason });
      if (!cleanHw || !cleanSw) {
        return res.status(400).json({ error: "Hardware ve software versiyonu girilmeli" });
      }
      remoteFileName = `fw_hw${cleanHw}_v${cleanSw}.bin`;
    }

    if (fileType === "txt") {
      const check = validateTxt(file.buffer);
      if (!check.valid) return res.status(400).json({ error: check.reason });
      if (!cleanHw || !cleanSw) {
        return res.status(400).json({ error: "Hardware ve software versiyonu girilmeli" });
      }
      remoteFileName = `msp_hw${cleanHw}_v${cleanSw}.txt`;
    }

    if (fileType === "logo") {
      if (logoFormat === "indexed4") {
        const check = validateIndexed4Logo(file.buffer);
        if (!check.valid) return res.status(400).json({ error: check.reason });
        uploadBuffer = file.buffer;
      } else {
        const converted = convertCtoBin(file.buffer);
        if (!converted.valid) return res.status(400).json({ error: converted.reason });
        uploadBuffer = converted.buffer;
      }

      // Logo adı şirket + sıra numarasıdır: sepas_logo_1.bin, sepas_logo_2.bin...
      logoBaseName = logoScope.unrestricted ? logoCompanySlug(company) : logoScope.slug;
      if (!logoBaseName) return res.status(400).json({ error: "Firma seçin" });
      remoteFileName = `${logoBaseName}_logo_1.bin`;
    }

    // ── SFTP ile şirket sunucusuna gönder ──
    const sftp = new SftpClient();
    try {
      await sftp.connect({
        host: OTA_REMOTE_HOST,
        username: OTA_REMOTE_USER,
        privateKey: fs.readFileSync(OTA_SSH_KEY_PATH),
      });

      if (fileType === "logo") {
        const existing = await sftp.list(`${OTA_REMOTE_PATH}/logos`).catch(() => []);
        const prefix = `${logoBaseName}_logo_`;
        const used = new Set(existing.filter((x) => x.type === "-").map((x) => x.name));
        let seq = 1;
        while (used.has(`${prefix}${seq}.bin`)) seq++;
        remoteFileName = `${prefix}${seq}.bin`;
      }

      const remotePath = fileType === "logo"
        ? `${OTA_REMOTE_PATH}/logos/${remoteFileName}`
        : `${OTA_REMOTE_PATH}/${remoteFileName}`;
      await sftp.put(uploadBuffer, remotePath);

      // ── Bütünlük doğrulama — gönderilen dosyayı geri okuyup karşılaştır ──
      const verifyBuffer = await sftp.get(remotePath);
      const checksumLocal  = crypto.createHash("sha256").update(uploadBuffer).digest("hex");
      const checksumRemote = crypto.createHash("sha256").update(verifyBuffer).digest("hex");

      await sftp.end();

      if (checksumLocal !== checksumRemote) {
        return res.status(500).json({ error: "Transfer doğrulanamadı — dosya bozulmuş olabilir, tekrar deneyin" });
      }

      console.log(`[OTA-SERVER] ${req.username} -> ${remotePath} (${uploadBuffer.length} byte, sha256:${checksumLocal.slice(0, 12)}…)`);
      if (fileType === "logo") {
        appendLogoUploadEvent({ username: req.username, fullName: req.userFullName || req.username,
          company: logoScope.company || (company || null), fileName: remoteFileName, size: uploadBuffer.length });
      }

      // ── firmware.json'u güncelle (yalnızca bin/txt — logo bu dosyanın kapsamında değil) ──
      let firmwareJsonInfo = null;
      if (fileType === "bin" || fileType === "txt") {
        try {
          const downloadUrl = `http://${OTA_REMOTE_HOST}:${OTA_HTTP_PORT}/${remoteFileName}`;
          const info = updateFirmwareJson(OTA_FIRMWARE_JSON_PATH, {
            kind: fileType === "bin" ? "esp" : "msp",
            hw: cleanHw,
            sw: cleanSw,
            url: downloadUrl,
          });
          firmwareJsonInfo = { updated: true, versionKey: info.versionKey, url: downloadUrl };
          console.log(`[OTA-SERVER] firmware.json güncellendi: ${info.groupKey}.${info.hw}.versions["${info.versionKey}"]`);
        } catch (e) {
          console.error("[OTA-SERVER] firmware.json güncellenemedi:", e.message);
          firmwareJsonInfo = { updated: false, error: e.message };
        }
      }

      res.json({
        message: "Dosya sunucuya başarıyla gönderildi ve doğrulandı",
        fileName: remoteFileName,
        remotePath,
        size: uploadBuffer.length,
        checksum: checksumLocal,
        logoName: fileType === "logo" ? remoteFileName.replace(/\.bin$/i, "") : null,
        notification: fileType === "logo" ? "Logo yüklendi; yetkili yöneticiler bildirim kaydında görebilir" : null,
        firmwareJson: firmwareJsonInfo,
      });
    } catch (e) {
      try { await sftp.end(); } catch {}
      console.error("[OTA-SERVER] SFTP hata:", e.message);
      res.status(500).json({ error: "Sunucuya gönderilemedi: " + e.message });
    }
  });
});

// ── Sunucudaki mevcut dosyaları listele (VS Code'a bakmadan panelden görmek için) ──
app.get("/api/ota-server/list", requireAuth(), async (req, res) => {
  const logoScope = logoScopeForRequest(req);

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: OTA_REMOTE_HOST,
      username: OTA_REMOTE_USER,
      privateKey: fs.readFileSync(OTA_SSH_KEY_PATH),
    });

    const rootList = await sftp.list(OTA_REMOTE_PATH);
    const logoList = await sftp.list(`${OTA_REMOTE_PATH}/logos`).catch(() => []);

    await sftp.end();

    const toEntry = (item) => ({
      name: item.name,
      size: item.size,
      modifyTime: item.modifyTime,
    });

    const firmware = rootList.filter((i) => i.type === "-" && i.name.startsWith("fw")).map(toEntry);
    const msp      = rootList.filter((i) => i.type === "-" && i.name.startsWith("msp")).map(toEntry);
    const other    = rootList.filter((i) => i.type === "-" && !i.name.startsWith("fw") && !i.name.startsWith("msp")).map(toEntry);
    let logos = logoList.filter((i) => i.type === "-").map(toEntry);
    if (!logoScope.unrestricted) logos = logos.filter((i) =>
      i.name === `${logoScope.slug}_logo.bin` || i.name.startsWith(`${logoScope.slug}_logo_`));

    let notifications = [];
    if (logoScope.unrestricted && fs.existsSync(OTA_LOG_EVENTS_PATH)) {
      try { notifications = JSON.parse(fs.readFileSync(OTA_LOG_EVENTS_PATH, "utf8")).slice(0, 20); } catch {}
    }

    res.json({
      firmware: logoScope.unrestricted ? firmware : [],
      msp: logoScope.unrestricted ? msp : [],
      other: logoScope.unrestricted ? other : [],
      logos, notifications,
      logoScope: { company: logoScope.company, slug: logoScope.slug, canUpload: logoScope.unrestricted || !!logoScope.slug },
    });
  } catch (e) {
    try { await sftp.end(); } catch {}
    console.error("[OTA-SERVER] Listeleme hata:", e.message);
    res.status(500).json({ error: "Dosya listesi alınamadı: " + e.message });
  }
});

// Logo önizlemesi için ham dosyayı döndürür. Şirket hesabı yalnızca kendi
// canonical logosunu isteyebilir; admin/superadmin tüm logolara erişebilir.
app.get("/api/ota-server/logo/:logoName", requireAuth(), async (req, res) => {
  const logoScope = logoScopeForRequest(req);
  const cleanLogoName = String(req.params.logoName || "").replace(/\.bin$/i, "").replace(/[^a-zA-Z0-9_\-]/g, "_");
  if (!cleanLogoName) return res.status(400).json({ error: "Logo adı gerekli" });
  if (!logoScope.unrestricted && cleanLogoName !== logoScope.slug && !cleanLogoName.startsWith(`${logoScope.slug}_logo_`)) {
    return res.status(403).json({ error: "Bu logoyu görüntüleme yetkiniz yok" });
  }
  const remotePath = `${OTA_REMOTE_PATH}/logos/${logoRemoteFileName(cleanLogoName)}`;
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host: OTA_REMOTE_HOST, username: OTA_REMOTE_USER, privateKey: fs.readFileSync(OTA_SSH_KEY_PATH) });
    const buffer = await sftp.get(remotePath);
    await sftp.end();
    res.type("application/octet-stream").send(buffer);
  } catch (e) {
    try { await sftp.end(); } catch {}
    res.status(404).json({ error: "Logo önizlemesi alınamadı" });
  }
});

// ── OTA Config (ota_config.json) — oku ── //
app.get("/api/ota-server/config", requireAuth(), (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });
  try {
    const config = readOtaConfig(OTA_CONFIG_JSON_PATH);
    res.json({ config });
  } catch (e) {
    res.status(500).json({ error: "ota_config.json okunamadı: " + e.message });
  }
});

// ── OTA Config (ota_config.json) — güncelle ── //
app.post("/api/ota-server/config", requireAuth(), (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

  const { ota_key, test_mode, esp_target_version, msp_target_version } = req.body || {};

  if (typeof ota_key !== "string" || !ota_key.trim()) {
    return res.status(400).json({ error: "ota_key boş olamaz" });
  }
  if (typeof test_mode !== "boolean") {
    return res.status(400).json({ error: "test_mode true/false olmalı" });
  }
  if (typeof esp_target_version !== "string" || !esp_target_version.trim()) {
    return res.status(400).json({ error: "esp_target_version boş olamaz" });
  }
  if (typeof msp_target_version !== "string" || !msp_target_version.trim()) {
    return res.status(400).json({ error: "msp_target_version boş olamaz" });
  }

  try {
    const newConfig = {
      ota_key: ota_key.trim(),
      test_mode,
      esp_target_version: esp_target_version.trim(),
      msp_target_version: msp_target_version.trim(),
    };
    writeOtaConfig(OTA_CONFIG_JSON_PATH, newConfig);
    console.log(`[OTA-SERVER] ${req.username} ota_config.json güncelledi`);
    res.json({ message: "ota_config.json güncellendi", config: newConfig });
  } catch (e) {
    console.error("[OTA-SERVER] ota_config.json yazılamadı:", e.message);
    res.status(500).json({ error: "ota_config.json yazılamadı: " + e.message });
  }
});

// ── firmware.json'daki mevcut versiyonları listele (dropdown seçenekleri için) ── //
app.get("/api/ota-server/firmware-versions", requireAuth(), (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });
  try {
    const data = readFirmwareJson(OTA_FIRMWARE_JSON_PATH);
    res.json(extractVersions(data));
  } catch (e) {
    res.status(500).json({ error: "firmware.json okunamadı: " + e.message });
  }
});

// ── Cihaz Versiyon Takibi — devices.json (MAC bazlı) + kendi cihaz veritabanımızla eşleştirme ── //
app.get("/api/ota-server/device-versions", requireAuth(), (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });
  try {
    const raw = fs.readFileSync(OTA_DEVICES_JSON_PATH, "utf-8");
    const devicesJson = raw.trim() ? JSON.parse(raw) : {};

    // Kendi veritabanımızdaki cihazları MAC'e göre hızlı arama için sözlüğe koy
    const ourDevices = getDevices({});
    const byMac = {};
    for (const d of ourDevices) {
      if (d.mac) byMac[d.mac.toUpperCase()] = d;
    }

    const rows = Object.entries(devicesJson).map(([mac, info]) => {
      const matched = byMac[mac.toUpperCase()] || null;
      return {
        mac,
        espSoftwareVersion: info.current_version || "",
        espHardwareVersion: info.esp_hw_version || "",
        mspSoftwareVersion: info.msp_current_version || "",
        mspHardwareVersion: info.msp_hw_version || "",
        espRequestedVersion: info.esp_requested_version || "",
        mspRequestedVersion: info.msp_requested_version || "",
        location: matched?.location || null,
        company: matched?.company || null,
        deviceCode: matched?.device_code || null,
        raw: info, // detay penceresi için devices.json'daki TÜM alanlar, olduğu gibi
      };
    });

    res.json({ devices: rows });
  } catch (e) {
    res.status(500).json({ error: "devices.json okunamadı: " + e.message });
  }
});

// ── OTA sunucusundaki (85.105) ota_server.log dosyasının son satırlarını getir ── //
app.get("/api/ota-server/logs", requireAuth(), async (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

  const requestedLines = Math.min(parseInt(req.query.lines, 10) || 200, 1000);

  try {
    const result = await otaLogTailer.getRecentLogLines({
      host: OTA_REMOTE_HOST,
      username: OTA_REMOTE_USER,
      privateKeyPath: OTA_SSH_KEY_PATH,
      logPath: OTA_LOG_PATH,
      requestedLines,
    });
    res.json(result);
  } catch (e) {
    console.error("[OTA-SERVER] Log okuma hatası:", e.message);
    res.status(500).json({ error: "Log dosyası okunamadı: " + e.message });
  }
});

// ── Toplu Güncelleme (BulkUpdate.jsx) izleme döngüsünün soru sorduğu uç —
// OTA sunucu logundan MAC başına indirme/rapor durumunu döner. Daha önce
// bu route hiç yoktu (sadece frontend'de çağrılıyordu) — panel "Hazırlanıyor/
// Sırada"da donup kalıyordu çünkü ilerleme/başarı/başarısız bilgisi hiç
// gelmiyordu (her istek 404). Mantığın kendisi zaten ota-log-tailer.js'te
// (getMacUpdateStatus) hazırdı, sadece buraya bağlanmamıştı.
// macs=<mac>|<sinceMs>,<mac>|<sinceMs>,...  kind=esp|msp
app.get("/api/ota-server/update-status", requireAuth(), async (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

  const kind = req.query.kind === "msp" ? "msp" : "esp";
  const macsParam = req.query.macs || "";
  const macEntries = macsParam.split(",").filter(Boolean).map((part) => {
    const [mac, since] = part.split("|");
    return { mac, since: Number(since) || 0 };
  });
  if (macEntries.length === 0) return res.json({ statuses: {} });

  try {
    const statuses = await otaLogTailer.getMacUpdateStatus({ logPath: OTA_LOG_PATH, macEntries, kind });
    res.json({ statuses });
  } catch (e) {
    console.error("[OTA-SERVER] update-status hatası:", e.message);
    res.status(500).json({ error: "Durum okunamadı: " + e.message });
  }
});

// ── Yüklenmiş bir ESP/MSP firmware'ini sil — hem 85.105'teki dosyayı hem firmware.json kaydını ── //
app.post("/api/ota-server/delete", requireAuth(), async (req, res) => {
  const logoScope = logoScopeForRequest(req);

  const { fileType, hwVersion, swVersion, logoName } = req.body || {};
  if (!["bin", "txt", "logo"].includes(fileType)) {
    return res.status(400).json({ error: "Geçersiz dosya tipi" });
  }

  let remoteFileName, remotePath;
  let cleanHw, cleanSw;

  if (fileType === "logo") {
    const cleanLogoName = (logoName || "").trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    if (!cleanLogoName) return res.status(400).json({ error: "Logo adı gerekli" });
    if (!logoScope.unrestricted && cleanLogoName !== logoScope.slug && !cleanLogoName.startsWith(`${logoScope.slug}_logo_`)) {
      return res.status(403).json({ error: "Yalnızca kendi şirket logonuzu silebilirsiniz" });
    }
    remoteFileName = logoRemoteFileName(cleanLogoName);
    remotePath = `${OTA_REMOTE_PATH}/logos/${remoteFileName}`;
  } else {
    if (req.userRole !== "superadmin") return res.status(403).json({ error: "Firmware silme yetkisi yok" });
    cleanHw = (hwVersion || "").trim().replace(/[^a-zA-Z0-9]/g, "");
    cleanSw = (swVersion || "").trim().replace(/[^a-zA-Z0-9]/g, "");
    if (!cleanHw || !cleanSw) {
      return res.status(400).json({ error: "Hardware ve software versiyonu gerekli" });
    }
    remoteFileName = fileType === "bin"
      ? `fw_hw${cleanHw}_v${cleanSw}.bin`
      : `msp_hw${cleanHw}_v${cleanSw}.txt`;
    remotePath = `${OTA_REMOTE_PATH}/${remoteFileName}`;
  }

  // 1) Uzak dosyayı SFTP ile sil
  const sftp = new SftpClient();
  let fileDeleted = false;
  let fileError = null;
  try {
    await sftp.connect({
      host: OTA_REMOTE_HOST,
      username: OTA_REMOTE_USER,
      privateKey: fs.readFileSync(OTA_SSH_KEY_PATH),
    });
    await sftp.delete(remotePath);
    fileDeleted = true;
  } catch (e) {
    fileError = e.message;
  } finally {
    try { await sftp.end(); } catch {}
  }

  // 2) firmware.json'dan kaydı kaldır — logo bu dosyanın kapsamında değil, yalnızca bin/txt için
  let firmwareJsonInfo = null;
  if (fileType !== "logo") {
    try {
      const kind = fileType === "bin" ? "esp" : "msp";
      const versionPrefix = kind === "esp" ? "v" : "msp";
      const versionKey = `${versionPrefix}@${dottedVersion(cleanSw)}`;
      const removed = removeFromFirmwareJson(OTA_FIRMWARE_JSON_PATH, { kind, hw: cleanHw, versionKey });
      firmwareJsonInfo = { updated: true, removed, versionKey };
    } catch (e) {
      firmwareJsonInfo = { updated: false, error: e.message };
    }
  }

  console.log(`[OTA-SERVER] ${req.username} SİLDİ -> ${remotePath} (dosya: ${fileDeleted ? "silindi" : "hata: " + fileError})`);

  res.json({
    message: fileDeleted ? "Dosya silindi" : "Dosya silinemedi",
    fileDeleted,
    fileError,
    remotePath,
    firmwareJson: firmwareJsonInfo,
  });
});

// Testler için: gerçek e-posta gönderimi olmadan (SMTP yapılandırılmamış test
// ortamında) şifre sıfırlama token'ına erişim. Production'da process.env.VITEST
// tanımlı olmadığı için bu blok hiç çalışmaz, app._testHooks eklenmez.
if (process.env.VITEST) {
    app._testHooks = { passwordResetTokens };
}

module.exports = app;
