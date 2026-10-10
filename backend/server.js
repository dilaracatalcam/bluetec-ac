const { getCompanies, getLocations, getDevices, getDeviceByCode, getCustomFields, addCustomField, deleteCustomField, isSyntheticSessionStale } = require('./db');
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
const { validateBin, validateTxt, convertCtoBin } = require('./ota-validators');
const { updateFirmwareJson, dottedVersion, readFirmwareJson, extractVersions, removeFromFirmwareJson } = require('./ota-firmware-json');
const { readOtaConfig, writeOtaConfig } = require('./ota-config');
const otaLogTailer = require('./ota-log-tailer');
const { buildScope, allowsDevice, allowsMac, visibleDevices } = require('./device-scope');
const rateLimit = require('express-rate-limit');
const { sendPasswordResetEmail } = require('./email');

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

// Istek sahibinin cihaz erisim kapsami
function scopeFor(req) {
    const users = readUsers();
    return buildScope(users.find((u) => u.username === req.username), req.userRole);
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
        email: user.email || null,
        session_id: user.username,
    });
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

app.get('/api/users', requireAuth(), requireSuperadmin, (_req, res) => {
    const users = readUsers();
    res.json(users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        company: u.company || null,
        allowedMacs: Array.isArray(u.allowedMacs) ? u.allowedMacs : [],
        email: u.email || null,
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
app.put('/api/users/:username', requireAuth(), requireSuperadmin, (req, res) => {
    const { company, allowedMacs, role, email } = req.body || {};
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

    writeUsers(users);
    console.log(`[USERS] ${req.username} yetki güncelledi: ${user.username} (şirket: ${user.company || '—'}, cihaz: ${(user.allowedMacs || []).length})`);
    res.json({ message: 'Yetkiler güncellendi' });
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

// responses.json yapısı garanti et: { responses: { ... } }
async function readResponses() {
    let data;
    try { data = await readJsonRaw(RESPONSES_PATH); }
    catch (e) { data = { responses: {} }; }
    if (!data || typeof data !== 'object') data = { responses: {} };
    if (!data.responses || typeof data.responses !== 'object') data.responses = {};
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
};

const VALID_IDS = [
    0,1,2,3,4,5,6,7,8, 9,10,11,12,13,14, 15,16,17,18,19,
    20,21, 22,23,24,25,26,27, 28,29,30, 31,32,33,34,
    35,36, 37,38, 39,40,41,42,43,44, 45,
    46,47,48,49,50,51,52,53, 54,55,56,57,58,59,
    60,61, 62,63,64,65, 66,67,68, 69
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
const deviceLog = initDeviceLogStream({ RESPONSES_PATH, readResponses });

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

        if (occupant && isSyntheticSessionStale(occupant.session_id)) {
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
            slot.send_message = frame;
            await writeJsonRaw(TARGET_PATH, data);
        });
        if (notConnected) return res.status(400).json({ message: 'Önce bir cihaza bağlanmalısınız.' });
        if (unauthorizedTarget) {
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
    await deviceLog.watch(req.sessionId);
    // Açık bir log akışını izlemek aktivite sayılır — yoksa kullanıcı komut göndermeden
    // sadece logları izlerken 5 dakikada "inaktivite"den bağlantısı kesiliyordu.
    if (deviceLog.activeGroups(req.sessionId).length > 0) touchSlot(req.sessionId);
    res.json(deviceLog.read(req.sessionId, req.query.after));
});

app.post('/api/log/clear', requireAuth(), (req, res) => {
    deviceLog.clear(req.sessionId);
    res.json({ message: 'ok' });
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

    // Operatorler MAC gormez — cihaz secimi id uzerinden yapilir.
    const sanitized = devices.map((d) => ({
      ...d,
      mac: req.userRole === "operator" ? undefined : d.mac,
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

// Cihaz listesi export
app.get("/api/devices/export", requireAuth(), async (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const devices = getDevices({});
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
      const existing = getDevices({});
      const byMac = {};
      existing.forEach((d) => { if (d.mac) byMac[d.mac.toUpperCase()] = d; });

      let added = 0, updated = 0;
      for (const imp of imported) {
        const key = imp.mac.toUpperCase();
        if (byMac[key]) {
          Object.assign(byMac[key], imp);
          updated++;
        } else {
          byMac[key] = {
            ...imp,
            is_revision: (imp.location || "").toLowerCase().includes("revizyon") ? 1 : 0,
          };
          added++;
        }
      }

      replaceAllDevices(Object.values(byMac));
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
    const { device_code, serial_no, mac, company, location, connection, logo, sw_version, msp_fw, msp_sw, hw_version, note, extra_fields } = req.body || {};
    if (!mac || !company) return res.status(400).json({ error: "MAC ve şirket zorunlu" });
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
    res.json({ message: "Cihaz eklendi" });
  } catch (e) {
    res.status(500).json({ error: "Cihaz eklenemedi" });
  }
});

app.delete("/api/devices/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { replaceAllDevices, getDevices } = require("./db");
    const existing = getDevices({});
    const filtered = existing.filter((d) => String(d.id) !== String(req.params.id));
    if (filtered.length === existing.length) return res.status(404).json({ error: "Cihaz bulunamadı" });
    replaceAllDevices(filtered);
    res.json({ message: "Cihaz silindi" });
  } catch (e) {
    res.status(500).json({ error: "Cihaz silinemedi" });
  }
});

app.put("/api/devices/:id", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { device_code, serial_no, mac, company, location, connection, logo, sw_version, msp_fw, msp_sw, hw_version, note, extra_fields } = req.body || {};
    if (!mac || !company) return res.status(400).json({ error: "MAC ve şirket zorunlu" });
    const { replaceAllDevices, getDevices } = require("./db");
    const existing = getDevices({});
    const idx = existing.findIndex((d) => String(d.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: "Cihaz bulunamadı" });

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
    res.json({ message: "Cihaz güncellendi" });
  } catch (e) {
    res.status(500).json({ error: "Cihaz güncellenemedi" });
  }
});

// ── Toplu cihaz düzenleme — seçilen cihazlara aynı değeri atar, ya da bul-değiştir yapar ── //
const BULK_EDITABLE_FIELDS = ["company", "location", "connection", "logo", "sw_version", "msp_fw", "msp_sw", "hw_version", "note"];

app.post("/api/devices/bulk-update", requireAuth(), (req, res) => {
  if (!DEVICE_MGMT_ROLES.includes(req.userRole)) return res.status(403).json({ error: "Yetkisiz" });
  try {
    const { ids, field, isCustom, mode, value, find, replace } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "Cihaz seçilmedi" });
    if (!isCustom && !BULK_EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: "Geçersiz alan" });
    if (!["set", "replace"].includes(mode)) return res.status(400).json({ error: "Geçersiz mod" });
    if (mode === "replace" && !find) return res.status(400).json({ error: "'Bul' değeri boş olamaz" });

    const { getDevices, replaceAllDevices } = require("./db");
    const existing = getDevices({});
    const idSet = new Set(ids.map(String));
    const today = new Date().toISOString().split("T")[0];

    let updated = 0;
    for (const d of existing) {
      if (!idSet.has(String(d.id))) continue;

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
        d[field] = value || null;
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
    console.log(`[DEVICES-BULK] ${req.username}: ${updated} cihaz güncellendi (alan: ${field}, mod: ${mode})`);
    res.json({ message: `${updated} cihaz güncellendi`, updated });
  } catch (e) {
    console.error("[DEVICES-BULK] hata:", e.message);
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
      if (rp.value === undefined || rp.value === null || rp.value === "") {
        return res.status(400).json({ error: `"${def.label}" için değer boş olamaz` });
      }
      params.push({ id: paramIdNum, value: String(rp.value) });
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
    const paramSummary = params.map((p) => `${bulkJobs.BULK_PARAMS[p.id].label}=${p.value}`).join(", ");
    const autoRetryNote = autoRetry.autoRetryMinutes ? `, oto-tekrar=${autoRetry.autoRetryMinutes}dk×${autoRetry.autoRetryMax}` : "";
    console.log(`[BULK-JOB] ${req.username} başlattı: ${jobId} (${paramSummary}, ${devices.length} cihaz, ${clampedWorkerCount} paralel${autoRetryNote})`);
    res.json({ id: jobId });
  } catch (e) {
    console.error("[BULK-JOB] başlatma hatası:", e.message);
    res.status(500).json({ error: "İş başlatılamadı: " + e.message });
  }
});

app.get("/api/bulk-jobs/:id", requireAuth(), (req, res) => {
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
      params: oldJob.params.map((p) => ({ id: p.id, value: p.value })),
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

app.post("/api/ota-server/upload", requireAuth(), (req, res) => {
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

  otaUpload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: `Dosya çok büyük (limit: ${OTA_MAX_FILE_SIZE / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: "Dosya yüklenemedi: " + err.message });
    }

    const { fileType, company, customName, hwVersion, swVersion } = req.body || {};
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Dosya bulunamadı" });
    if (!["bin", "txt", "logo"].includes(fileType)) {
      return res.status(400).json({ error: "Geçersiz dosya tipi" });
    }

    let uploadBuffer = file.buffer;
    let remoteFileName;

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
      const converted = convertCtoBin(file.buffer);
      if (!converted.valid) return res.status(400).json({ error: converted.reason });
      uploadBuffer = converted.buffer;

      // İsimlendirme: özel isim girildiyse o öncelikli, yoksa dropdown'dan seçilen şirket kullanılır
      let baseName = "";
      const trimmedCustom = (customName || "").trim();
      if (trimmedCustom) {
        baseName = trimmedCustom.replace(/[^a-zA-Z0-9_\-]/g, "_");
      } else if (OTA_LOGO_COMPANIES.includes(company)) {
        baseName = company;
      } else {
        return res.status(400).json({ error: "Şirket seçin veya özel bir isim girin" });
      }
      remoteFileName = `${baseName}_logo.bin`;
    }

    // ── SFTP ile şirket sunucusuna gönder ──
    const sftp = new SftpClient();
    try {
      await sftp.connect({
        host: OTA_REMOTE_HOST,
        username: OTA_REMOTE_USER,
        privateKey: fs.readFileSync(OTA_SSH_KEY_PATH),
      });

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
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

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
    const logos    = logoList.filter((i) => i.type === "-").map(toEntry);

    res.json({ firmware, msp, other, logos });
  } catch (e) {
    try { await sftp.end(); } catch {}
    console.error("[OTA-SERVER] Listeleme hata:", e.message);
    res.status(500).json({ error: "Dosya listesi alınamadı: " + e.message });
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
  if (req.userRole !== "superadmin") return res.status(403).json({ error: "Yetkisiz" });

  const { fileType, hwVersion, swVersion, logoName } = req.body || {};
  if (!["bin", "txt", "logo"].includes(fileType)) {
    return res.status(400).json({ error: "Geçersiz dosya tipi" });
  }

  let remoteFileName, remotePath;
  let cleanHw, cleanSw;

  if (fileType === "logo") {
    const cleanLogoName = (logoName || "").trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    if (!cleanLogoName) return res.status(400).json({ error: "Logo adı gerekli" });
    remoteFileName = `${cleanLogoName}_logo.bin`;
    remotePath = `${OTA_REMOTE_PATH}/logos/${remoteFileName}`;
  } else {
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
