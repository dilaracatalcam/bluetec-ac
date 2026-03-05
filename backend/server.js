require('dotenv').config();

const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 dakika (ms)
const ESP_TIMEOUT = 60; // 60 saniye (responses.json yaşı için - artırıldı)

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const TARGET_PATH = '/home/bluetech/target.json';
const RESPONSES_PATH = process.env.RESPONSES_PATH || '/home/bluetech/responses.json';
const serverStartTime = Date.now();

// =============================================
//  KULLANICI AKTİVİTE TAKİBİ (10dk Timeout)
// =============================================
let lastActivityTime = null;
let inactivityTimer = null;
let isDeactivatedByTimeout = false;

function resetInactivityTimer() {
    lastActivityTime = Date.now();
    isDeactivatedByTimeout = false;

    if (inactivityTimer) clearTimeout(inactivityTimer);

    inactivityTimer = setTimeout(async () => {
        try {
            const data = await readJson(TARGET_PATH);
            data.control = "deactivate";
            await writeJson(TARGET_PATH, data);
            isDeactivatedByTimeout = true;
            console.log('[TIMEOUT] 10 dakika inaktivite → deactivate yazıldı');
        } catch (e) {
            console.error('[TIMEOUT] deactivate yazılamadı:', e);
        }
    }, INACTIVITY_TIMEOUT);

    console.log(`[ACTIVITY] Timer sıfırlandı. Timeout: ${Math.floor(INACTIVITY_TIMEOUT / 60000)} dk sonra`);
}

// =============================================

function readJson(p) {
    return new Promise((resolve, reject) => {
        fs.readFile(p, 'utf-8', (err, data) => {
            if (err) {
                // Dosya yoksa varsayılan oluştur
                if (err.code === 'ENOENT') {
                    const defaults = {
                        [TARGET_PATH]: { target: "", control: "deactivate", send_message: "" },
                        [RESPONSES_PATH]: { status_response: null, message_response: [] }
                    };
                    const defaultData = defaults[p] || {};
                    fs.writeFile(p, JSON.stringify(defaultData, null, 2), 'utf-8', (writeErr) => {
                        if (writeErr) return reject(writeErr);
                        console.log(`[AUTO] ${p} oluşturuldu`);
                        resolve(defaultData);
                    });
                    return;
                }
                return reject(err);
            }
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(e); }
        });
    });
}

function writeJson(filePath, data) {
    return new Promise((resolve, reject) => {
        const tmpPath = filePath + '.tmp';
        const content = JSON.stringify(data, null, 2);
        fs.writeFile(tmpPath, content, 'utf-8', (err) => {
            if (err) return reject(err);
            fs.rename(tmpPath, filePath, (renameErr) => {
                if (renameErr) return reject(renameErr);
                resolve();
            });
        });
    });
}

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
    gradient_or_color: 35, select_color: 36
};

app.get('/', (_, res) => {
    res.send('Sunucu çalışıyor');
});

// =============================================
//  YARDIMCI: Deactivate → Bekle → Activate döngüsü
//  Eski kalıntı "ESP aktif" durumunu temizler,
//  sonra gerçek aktiflik kontrolü yapar.
//  denek.py her 1 saniyede target.json okur,
//  bu yüzden deactivate sonrası 2s bekliyoruz.
// =============================================
const DEACTIVATE_WAIT_MS = 2000;

async function deactivateThenActivate(data) {
    // 1) Deactivate yaz
    data.control = "deactivate";
    await writeJson(TARGET_PATH, data);
    console.log('[CYCLE] deactivate yazıldı');

    // 2) responses.json'daki status'u sıfırla
    //    ESP kapalıysa "ESP aktif" kalıntısı temizlenir
    try {
        const resp = await readJson(RESPONSES_PATH);
        resp.status_response = { topic: "", data: "" };
        await writeJson(RESPONSES_PATH, resp);
    } catch {}

    // 3) Bekle — denek.py bunu okusun, ESP'ye göndersin
    await new Promise(r => setTimeout(r, DEACTIVATE_WAIT_MS));

    // 4) Activate yaz
    data.control = "activate";
    await writeJson(TARGET_PATH, data);
    console.log('[CYCLE] activate yazıldı');

    // 5) ESP'nin cevap vermesi için bekle
    //    ESP açıksa ~1-2s içinde "ESP aktif" yazar
    await new Promise(r => setTimeout(r, DEACTIVATE_WAIT_MS));
}

// =============================================
//  UPDATE-TARGET
// =============================================
app.post('/api/update-target', async (req, res) => {
    const { newTarget } = req.body;
    if (!newTarget || !MAC_REGEX.test(newTarget)) {
        return res.status(400).json({ error: 'Geçersiz veya eksik MAC adresi' });
    }

    try {
        const data = await readJson(TARGET_PATH);
        data.target = newTarget;

        // Deactivate → Bekle → Activate döngüsü
        await deactivateThenActivate(data);

        resetInactivityTimer();

        console.log(`target.json güncellendi → ${newTarget}`);
        res.json({ message: 'Başarılı', newTarget });
    } catch (e) {
        console.error('update-target hata:', e);
        res.status(500).json({ error: 'target.json yazılamadı' });
    }
});

// =============================================
//  KEEPALIVE — Periyodik aktiflik kontrolü
//  Deactivate → Bekle → Activate döngüsü ile
//  ESP'nin gerçekten bağlı olup olmadığını doğrular.
// =============================================
app.post('/api/keepalive', async (req, res) => {
    try {
        const data = await readJson(TARGET_PATH);

        // Deactivate → Bekle → Activate döngüsü
        await deactivateThenActivate(data);

        resetInactivityTimer();

        console.log('[KEEPALIVE] deactivate→activate döngüsü tamamlandı');
        res.json({ message: 'keepalive gönderildi' });
    } catch (e) {
        console.error('keepalive hata:', e);
        res.status(500).json({ error: 'keepalive gönderilemedi' });
    }
});

// =============================================
//  SEND-COMMAND
// =============================================
app.post('/api/send-command', async (req, res) => {
    const { type, variable, value } = req.body;
    const varCode = typeof variable === 'number' ? variable : VAR_MAP[variable];

    if (!type || (type !== 'set' && type !== 'read')) {
        return res.status(400).json({ message: 'Geçersiz komut tipi.' });
    }

    // Geçerli variable ID'leri (ESP parametre listesine göre)
    const VALID_IDS = [
        0, 1, 2, 3, 4, 5, 6, 7, 8,       // MQTT / Connection
        9, 10, 11, 12, 13, 14,             // UI / Branding
        15, 16, 17, 18, 19,                // MSP Config
        20, 21,                             // Actions (reset, stop)
        22, 23, 24, 25, 26, 27,            // Runtime / Telemetry
        28, 29, 30,                         // LOG tipleri
        31, 32, 33, 34,                     // OTA + GSM Signal
        35, 36                              // Gradient/Color
    ];

    if (!VALID_IDS.includes(varCode)) {
        return res.status(400).json({ message: `Geçersiz değişken: ${varCode}` });
    }

    let frame;
    if (type === 'set') {
        if (!value && value !== 0 && value !== "0") return res.status(400).json({ message: 'set için değer gerekli.' });
        const cleanValue = varCode === 9 ? value.replace(/[^0-9]/g, '') : value;
        frame = `frame 1 ${varCode} ${cleanValue}`;
    } else if (type === 'read') {
        frame = `frame 2 ${varCode} 0`;
    }

    try {
        const data = await readJson(TARGET_PATH);
        data.send_message = frame;
        await writeJson(TARGET_PATH, data);

        resetInactivityTimer();

        // denek.py'nin mesajı okuması için kısa bekle, sonra sıfırla.
        // Bu sayede aynı komut tekrar gönderildiğinde
        // denek.py "msg != last_message" koşulunu geçer.
        setTimeout(async () => {
            try {
                const d = await readJson(TARGET_PATH);
                d.send_message = "";
                await writeJson(TARGET_PATH, d);
            } catch {}
        }, 1500);

        console.log(`Komut gönderildi: ${frame}`);
        res.json({ message: 'Komut gönderildi', frame });
    } catch (e) {
        console.error('send-command hata:', e);
        res.status(500).json({ error: 'Komut gönderilemedi.' });
    }
});

// =============================================
//  GET-STATUS (DÜZELTİLMİŞ AKTİFLİK MANTIĞI)
// =============================================
app.get("/api/get-status", async (_, res) => {
    try {
        const pythonRunning = await isPythonRunning();

        if (!pythonRunning) {
            return res.json({
                espState: "nonactive",
                pythonRunning: false,
                timedOut: isDeactivatedByTimeout,
                status_response: null,
                message_response: null
            });
        }

        // Timeout ile deactivate edildiyse direkt nonactive
        if (isDeactivatedByTimeout) {
            return res.json({
                espState: "nonactive",
                pythonRunning: true,
                timedOut: true,
                lastSeenSeconds: null,
                inactivityRemaining: 0,
                status_response: null,
                message_response: null
            });
        }

        // responses.json var mı kontrol et
        if (!fs.existsSync(RESPONSES_PATH)) {
            return res.json({
                espState: "nonactive",
                pythonRunning: true,
                timedOut: false,
                status_response: null,
                message_response: null
            });
        }

        let stat;
        try {
            stat = fs.statSync(RESPONSES_PATH);
        } catch {
            return res.json({
                espState: "nonactive",
                pythonRunning: true,
                timedOut: false,
                status_response: null,
                message_response: null
            });
        }

        const lastWrite = stat.mtimeMs;
        const now = Date.now();
        const ageSeconds = (now - lastWrite) / 1000;

        const data = await readJson(RESPONSES_PATH);

        // =============================================
        // AKTİFLİK MANTIĞI:
        //
        // Keepalive her 20s'de deactivate→activate döngüsü yapar.
        // Bu sayede responses.json'daki eski "ESP aktif" temizlenir.
        // Eğer hâlâ "ESP aktif" yazıyorsa → ESP gerçekten bağlı.
        //
        // Ek kontrol: responses.json son 30s içinde güncellenmişse
        // status henüz dönmemiş olabilir → "bekleniyor" durumu.
        // =============================================

        let espState = "nonactive";

        const statusText = data.status_response?.data || "";
        const hasActiveStatus = statusText.toLowerCase().includes("esp aktif");
        const hasPasifStatus = statusText.toLowerCase().includes("esp pasif");

        if (hasActiveStatus) {
            // responses.json "ESP aktif" diyor → gerçek aktiflik
            espState = "active";
        } else if (!hasPasifStatus && ageSeconds <= 10) {
            // Henüz ne aktif ne pasif, dosya çok taze → döngü devam ediyor
            espState = "unknown";
        }

        // Kalan süreyi hesapla
        let remainingSeconds = null;
        if (lastActivityTime) {
            const elapsed = now - lastActivityTime;
            remainingSeconds = Math.max(0, Math.floor((INACTIVITY_TIMEOUT - elapsed) / 1000));
        }

        res.json({
            espState,
            pythonRunning: true,
            timedOut: false,
            lastSeenSeconds: Math.floor(ageSeconds),
            inactivityRemaining: remainingSeconds,
            status_response: data.status_response || null,
            message_response: data.message_response?.[0] || null
        });

    } catch (e) {
        res.json({
            espState: "nonactive",
            pythonRunning: false,
            timedOut: false,
            status_response: null,
            message_response: null
        });
    }
});

app.get('/api/responses', async (req, res) => {
    try {
        const data = await readJson(RESPONSES_PATH);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'responses okunamadı' });
    }
});

const PORT = 8005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server çalışıyor: http://localhost:${PORT}`);
});