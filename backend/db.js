const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "bluetech.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT,
    serial_no   TEXT,
    mac         TEXT,
    company     TEXT,
    location    TEXT,
    latitude    REAL,
    longitude   REAL,
    connection  TEXT,
    logo        TEXT,
    sw_version  TEXT,
    msp_fw      TEXT,
    hw_version  TEXT,
    note        TEXT,
    updated_at  TEXT,
    is_revision INTEGER DEFAULT 0
  )
`);

// ── Migration: created_at kolonu ──
// updated_at, düzenlemede de değişen "iş" tarihi (örn. içe aktarılan dosyadaki TARİH sütunu).
// created_at ise SADECE bu cihaz panele/veritabanına ilk eklendiğinde set edilir, düzenlemede değişmez —
// "en yeni eklenen" sıralamasının doğru çalışması için gerekli.
const existingColumns = db.prepare("PRAGMA table_info(devices)").all().map((c) => c.name);
if (!existingColumns.includes("created_at")) {
  db.exec("ALTER TABLE devices ADD COLUMN created_at TEXT");
  // Geriye dönük kayıtlar için gerçek ekleme tarihi bilinmiyor — elimizdeki en iyi tahmin olarak
  // updated_at'i kullanıyoruz (yoksa şu anki zaman).
  db.exec("UPDATE devices SET created_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL");
}

// ── Migration: extra_fields kolonu ──
// Sabit kolonlara sığmayan, panelden kullanıcı tarafından tanımlanan özel alanları
// (örn. "Kurulum Ekibi") JSON olarak burada tutuyoruz — { "kurulum_ekibi": "Ahmet" } gibi.
// ── Migration: activation_code — MAC'ten türetilen müşteri aktivasyon kodu (bkz. activation-code.js) ──
// Her açılışta tüm cihazlar için yeniden hesaplanır; kod yalnızca MAC'e bağlı olduğu için
// eksik/bozuk değer kendiliğinden düzelir.
if (!existingColumns.includes("activation_code")) {
  db.exec("ALTER TABLE devices ADD COLUMN activation_code TEXT");
}
{
  const { encodeActivationCode } = require("./activation-code");
  const rows = db.prepare("SELECT id, mac, activation_code FROM devices").all();
  const set = db.prepare("UPDATE devices SET activation_code = ? WHERE id = ?");
  db.transaction(() => {
    for (const r of rows) {
      const code = encodeActivationCode(r.mac);
      if (code !== r.activation_code) set.run(code, r.id);
    }
  })();
}

if (!existingColumns.includes("extra_fields")) {
  db.exec("ALTER TABLE devices ADD COLUMN extra_fields TEXT DEFAULT '{}'");
  db.exec("UPDATE devices SET extra_fields = '{}' WHERE extra_fields IS NULL");
}

// ── Özel alan tanımları — hangi extra_fields anahtarlarının var olduğunu, etiketini tutar ──
// Bu tablo olmadan extra_fields JSON'undaki key'ler "yetim" kalır, panel hangi alanların
// var olduğunu bilemez (örn. yeni cihaz formunda hangi ekstra input'ları göstereceğini).
db.exec(`
  CREATE TABLE IF NOT EXISTS device_custom_fields (
    field_key   TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    field_type  TEXT DEFAULT 'text',
    created_at  TEXT
  )
`);

// ── Migration: msp_sw kolonu ──
// Broker dosyasına sonradan eklenen "MSP430 SW VER" sütunu için — msp_fw (MSP430 FW VER)'den ayrı.
if (!existingColumns.includes("msp_sw")) {
  db.exec("ALTER TABLE devices ADD COLUMN msp_sw TEXT");
}

// Harita/konum desteği — eski cihaz kayıtlarında koordinat boş kalır.
if (!existingColumns.includes("latitude")) db.exec("ALTER TABLE devices ADD COLUMN latitude REAL");
if (!existingColumns.includes("longitude")) db.exec("ALTER TABLE devices ADD COLUMN longitude REAL");

// Şehir / ilçe — Toplu Okuma'daki Şehir → İlçe → Lokasyon görünümü için. Kolonlar ilk
// eklendiğinde eski kayıtlar konum metninde geçen il/ilçe adından bir kez doldurulur
// (bkz. turkey-locations.js); bulunamayanlar boş kalır, Cihaz Yönetimi'nden girilir.
if (!existingColumns.includes("city") || !existingColumns.includes("district")) {
  if (!existingColumns.includes("city")) db.exec("ALTER TABLE devices ADD COLUMN city TEXT");
  if (!existingColumns.includes("district")) db.exec("ALTER TABLE devices ADD COLUMN district TEXT");
  const { inferCityDistrict } = require("./turkey-locations");
  const fill = db.prepare("UPDATE devices SET city = @city, district = @district WHERE id = @id");
  const rows = db.prepare("SELECT id, location FROM devices WHERE city IS NULL AND district IS NULL").all();
  db.transaction(() => {
    for (const row of rows) {
      const { city, district } = inferCityDistrict(row.location);
      if (city || district) fill.run({ id: row.id, city, district });
    }
  })();
}

// ── Toplu Parametre işleri — backend'de arka planda çalışan, kalıcı iş kaydı ──
// Tarayıcı sekmesi kapansa/yenilense bile ("Toplu Parametre" bileşeni unmount
// olsa bile) işin durumu burada kalıcı — panel sadece bunu okuyup gösteren
// bir izleyiciye dönüşüyor.
db.exec(`
  CREATE TABLE IF NOT EXISTS bulk_jobs (
    id          TEXT PRIMARY KEY,
    company     TEXT,
    param_id    INTEGER,
    param_label TEXT,
    value       TEXT,
    created_by  TEXT,
    status       TEXT DEFAULT 'running',
    dismissed    INTEGER DEFAULT 0,
    worker_count INTEGER DEFAULT 1,
    params_json  TEXT,
    created_at   TEXT,
    updated_at   TEXT
  )
`);
{
  const cols = db.prepare("PRAGMA table_info(bulk_jobs)").all().map((c) => c.name);
  if (!cols.includes("dismissed")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN dismissed INTEGER DEFAULT 0");
  if (!cols.includes("worker_count")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN worker_count INTEGER DEFAULT 1");
  // params_json — birden fazla parametrenin tek işte gönderilebilmesi için.
  // param_id/param_label/value kolonları geriye dönük uyumluluk/basit
  // görüntüleme için ilk parametreyle dolduruluyor, asıl kaynak params_json.
  if (!cols.includes("params_json")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN params_json TEXT");
  // ── Otomatik tekrar deneme ("alarm" gibi: N dakikada bir, toplam M kere) ──
  // İş bitince hâlâ başarısız/doğrulanamayan cihaz kaldıysa ve bu ayarlar
  // doluysa, bkz. bulk-jobs.js maybeScheduleAutoRetry — kullanıcı elle
  // "Tekrar Dene"ye basmasa da arka planda otomatik yeni bir iş açılır.
  if (!cols.includes("auto_retry_minutes")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN auto_retry_minutes INTEGER");
  if (!cols.includes("auto_retry_max")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN auto_retry_max INTEGER");
  if (!cols.includes("auto_retry_used")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN auto_retry_used INTEGER DEFAULT 0");
  if (!cols.includes("auto_retry_next_at")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN auto_retry_next_at TEXT");
  if (!cols.includes("auto_retry_child_id")) db.exec("ALTER TABLE bulk_jobs ADD COLUMN auto_retry_child_id TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS bulk_job_devices (
    job_id      TEXT,
    device_id   INTEGER,
    location    TEXT,
    device_code TEXT,
    mac         TEXT,
    phase       TEXT DEFAULT 'queued',
    message     TEXT,
    updated_at  TEXT,
    PRIMARY KEY (job_id, device_id)
  )
`);
{
  const cols = db.prepare("PRAGMA table_info(bulk_job_devices)").all().map((c) => c.name);
  if (!cols.includes("mac")) db.exec("ALTER TABLE bulk_job_devices ADD COLUMN mac TEXT");
}

function createBulkJob({ id, company, params, createdBy, devices, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed }) {
  const now = new Date().toISOString();
  const first = params[0];
  db.prepare(`
    INSERT INTO bulk_jobs (id, company, param_id, param_label, value, created_by, status, worker_count, params_json, created_at, updated_at, auto_retry_minutes, auto_retry_max, auto_retry_used)
    VALUES (@id, @company, @paramId, @paramLabel, @value, @createdBy, 'running', @workerCount, @paramsJson, @now, @now, @autoRetryMinutes, @autoRetryMax, @autoRetryUsed)
  `).run({
    id, company: company || null, createdBy, workerCount: workerCount || 1, now,
    paramId: first.id, paramLabel: first.label, value: first.value,
    paramsJson: JSON.stringify(params.map((p) => ({ id: p.id, label: p.label, value: p.value, operation: p.operation || "set" }))),
    autoRetryMinutes: autoRetryMinutes || null, autoRetryMax: autoRetryMax || null, autoRetryUsed: autoRetryUsed || 0,
  });

  const insertDevice = db.prepare(`
    INSERT INTO bulk_job_devices (job_id, device_id, location, device_code, mac, phase, message, updated_at)
    VALUES (@jobId, @deviceId, @location, @deviceCode, @mac, 'queued', 'Sırada bekliyor...', @now)
  `);
  const insertAll = db.transaction((devs) => {
    for (const d of devs) {
      insertDevice.run({ jobId: id, deviceId: d.id, location: d.location || null, deviceCode: d.device_code || null, mac: d.mac || null, now });
    }
  });
  insertAll(devices);
}

function updateBulkJobDevice(jobId, deviceId, { phase, message }) {
  db.prepare(`
    UPDATE bulk_job_devices SET phase = @phase, message = @message, updated_at = @now
    WHERE job_id = @jobId AND device_id = @deviceId
  `).run({ jobId, deviceId, phase, message: message || "", now: new Date().toISOString() });
}

function setBulkJobStatus(jobId, status) {
  db.prepare(`UPDATE bulk_jobs SET status = @status, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, status, now: new Date().toISOString() });
}

function dismissBulkJob(jobId) {
  // Kapatılan bir işin bekleyen otomatik tekrarı da anlamsızlaşır — temizle.
  db.prepare(`UPDATE bulk_jobs SET dismissed = 1, auto_retry_next_at = NULL, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, now: new Date().toISOString() });
}

// nextAt: ISO zaman damgası (planlandı) ya da null (iptal/tüketildi).
function setBulkJobAutoRetryNextAt(jobId, nextAt) {
  db.prepare(`UPDATE bulk_jobs SET auto_retry_next_at = @nextAt, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, nextAt: nextAt || null, now: new Date().toISOString() });
}

// Otomatik tekrar tetiklenip yeni bir iş açıldığında — panel bu ID'yi takip
// ederek izlemeyi otomatik yeni işe geçirebilsin diye (bkz. BulkParamUpdate.jsx).
function setBulkJobAutoRetryChild(jobId, childId) {
  db.prepare(`UPDATE bulk_jobs SET auto_retry_child_id = @childId, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, childId, now: new Date().toISOString() });
}

// Sunucu yeniden başladığında bekleyen otomatik tekrarları yeniden kurmak için.
function listPendingAutoRetryBulkJobs() {
  return db.prepare(`SELECT id, auto_retry_next_at FROM bulk_jobs WHERE dismissed = 0 AND status = 'done' AND auto_retry_next_at IS NOT NULL`).all();
}

function getBulkJob(jobId) {
  const job = db.prepare(`SELECT * FROM bulk_jobs WHERE id = ?`).get(jobId);
  if (!job) return null;
  const devices = db.prepare(`SELECT * FROM bulk_job_devices WHERE job_id = ? ORDER BY rowid`).all(jobId);
  let params = [];
  try { params = job.params_json ? JSON.parse(job.params_json) : [{ id: job.param_id, label: job.param_label, value: job.value }]; }
  catch { params = [{ id: job.param_id, label: job.param_label, value: job.value }]; }
  return { ...job, params, devices };
}

// activeOnly: sadece hâlâ çalışanlar. Aksi halde (varsayılan) dismissed=0
// olan en son işler — yani "hâlâ çalışıyor" ya da "az önce bitti ama henüz
// kapatılmadı" — sayfa açılışında otomatik yakalanabilsin diye.
function listBulkJobs({ company, createdBy, activeOnly } = {}) {
  const conditions = ["dismissed = 0"];
  const params = {};
  if (company) { conditions.push("company = @company"); params.company = company; }
  if (createdBy) { conditions.push("created_by = @createdBy"); params.createdBy = createdBy; }
  if (activeOnly) conditions.push("status = 'running'");
  const where = "WHERE " + conditions.join(" AND ");
  return db.prepare(`SELECT * FROM bulk_jobs ${where} ORDER BY created_at DESC LIMIT 20`).all(params);
}

// ── Toplu Güncelleme (OTA firmware) işleri — Toplu Parametre'yle aynı sebep:
// tarayıcı sekmesine bağlı çalışmasın, kalıcı olsun (bkz. ota-bulk-jobs.js). ──
db.exec(`
  CREATE TABLE IF NOT EXISTS ota_bulk_jobs (
    id            TEXT PRIMARY KEY,
    company       TEXT,
    kind          TEXT,        -- esp | msp
    verify_version INTEGER DEFAULT 0,
    created_by    TEXT,
    status        TEXT DEFAULT 'running',
    dismissed     INTEGER DEFAULT 0,
    worker_count  INTEGER DEFAULT 1,
    created_at    TEXT,
    updated_at    TEXT
  )
`);
{
  const cols = db.prepare("PRAGMA table_info(ota_bulk_jobs)").all().map((c) => c.name);
  if (!cols.includes("worker_count")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN worker_count INTEGER DEFAULT 1");
  // ── Otomatik tekrar deneme — bkz. bulk_jobs'taki aynı kolonların notu ──
  if (!cols.includes("auto_retry_minutes")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN auto_retry_minutes INTEGER");
  if (!cols.includes("auto_retry_max")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN auto_retry_max INTEGER");
  if (!cols.includes("auto_retry_used")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN auto_retry_used INTEGER DEFAULT 0");
  if (!cols.includes("auto_retry_next_at")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN auto_retry_next_at TEXT");
  if (!cols.includes("auto_retry_child_id")) db.exec("ALTER TABLE ota_bulk_jobs ADD COLUMN auto_retry_child_id TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS ota_bulk_job_devices (
    job_id      TEXT,
    mac         TEXT,
    location    TEXT,
    device_code TEXT,
    phase       TEXT DEFAULT 'queued',
    message     TEXT,
    percent     INTEGER,
    updated_at  TEXT,
    PRIMARY KEY (job_id, mac)
  )
`);

function createOtaBulkJob({ id, company, kind, verifyVersion, createdBy, devices, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ota_bulk_jobs (id, company, kind, verify_version, created_by, status, worker_count, created_at, updated_at, auto_retry_minutes, auto_retry_max, auto_retry_used)
    VALUES (@id, @company, @kind, @verifyVersion, @createdBy, 'running', @workerCount, @now, @now, @autoRetryMinutes, @autoRetryMax, @autoRetryUsed)
  `).run({
    id, company: company || null, kind, verifyVersion: verifyVersion ? 1 : 0, createdBy, workerCount: workerCount || 1, now,
    autoRetryMinutes: autoRetryMinutes || null, autoRetryMax: autoRetryMax || null, autoRetryUsed: autoRetryUsed || 0,
  });

  const insertDevice = db.prepare(`
    INSERT INTO ota_bulk_job_devices (job_id, mac, location, device_code, phase, message, percent, updated_at)
    VALUES (@jobId, @mac, @location, @deviceCode, 'queued', 'Sırada bekliyor...', NULL, @now)
  `);
  const insertAll = db.transaction((devs) => {
    for (const d of devs) {
      insertDevice.run({ jobId: id, mac: d.mac, location: d.location || null, deviceCode: d.device_code || null, now });
    }
  });
  insertAll(devices);
}

function updateOtaBulkJobDevice(jobId, mac, { phase, message, percent }) {
  const current = db.prepare(`SELECT phase, message, percent FROM ota_bulk_job_devices WHERE job_id = ? AND mac = ?`).get(jobId, mac);
  if (!current) return;
  db.prepare(`
    UPDATE ota_bulk_job_devices SET phase = @phase, message = @message, percent = @percent, updated_at = @now
    WHERE job_id = @jobId AND mac = @mac
  `).run({
    jobId, mac, now: new Date().toISOString(),
    phase: phase !== undefined ? phase : current.phase,
    message: message !== undefined ? message : current.message,
    percent: percent !== undefined ? percent : current.percent,
  });
}

function setOtaBulkJobStatus(jobId, status) {
  db.prepare(`UPDATE ota_bulk_jobs SET status = @status, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, status, now: new Date().toISOString() });
}

function dismissOtaBulkJob(jobId) {
  db.prepare(`UPDATE ota_bulk_jobs SET dismissed = 1, auto_retry_next_at = NULL, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, now: new Date().toISOString() });
}

function setOtaBulkJobAutoRetryNextAt(jobId, nextAt) {
  db.prepare(`UPDATE ota_bulk_jobs SET auto_retry_next_at = @nextAt, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, nextAt: nextAt || null, now: new Date().toISOString() });
}

function setOtaBulkJobAutoRetryChild(jobId, childId) {
  db.prepare(`UPDATE ota_bulk_jobs SET auto_retry_child_id = @childId, updated_at = @now WHERE id = @jobId`)
    .run({ jobId, childId, now: new Date().toISOString() });
}

function listPendingAutoRetryOtaBulkJobs() {
  return db.prepare(`SELECT id, auto_retry_next_at FROM ota_bulk_jobs WHERE dismissed = 0 AND status = 'done' AND auto_retry_next_at IS NOT NULL`).all();
}

function getOtaBulkJob(jobId) {
  const job = db.prepare(`SELECT * FROM ota_bulk_jobs WHERE id = ?`).get(jobId);
  if (!job) return null;
  const devices = db.prepare(`SELECT * FROM ota_bulk_job_devices WHERE job_id = ? ORDER BY rowid`).all(jobId);
  return { ...job, devices };
}

function listOtaBulkJobs({ company, createdBy, activeOnly } = {}) {
  const conditions = ["dismissed = 0"];
  const params = {};
  if (company) { conditions.push("company = @company"); params.company = company; }
  if (createdBy) { conditions.push("created_by = @createdBy"); params.createdBy = createdBy; }
  if (activeOnly) conditions.push("status = 'running'");
  const where = "WHERE " + conditions.join(" AND ");
  return db.prepare(`SELECT * FROM ota_bulk_jobs ${where} ORDER BY created_at DESC LIMIT 20`).all(params);
}

function getCustomFields() {
  return db.prepare("SELECT field_key, label, field_type, created_at FROM device_custom_fields ORDER BY created_at").all();
}

function addCustomField(label) {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!key) throw new Error("Geçersiz alan adı");

  const exists = db.prepare("SELECT 1 FROM device_custom_fields WHERE field_key = ?").get(key);
  if (exists) throw new Error("Bu isimde bir alan zaten var");

  db.prepare("INSERT INTO device_custom_fields (field_key, label, field_type, created_at) VALUES (?, ?, 'text', ?)")
    .run(key, label.trim(), new Date().toISOString());

  return { field_key: key, label: label.trim(), field_type: "text" };
}

function deleteCustomField(fieldKey) {
  db.prepare("DELETE FROM device_custom_fields WHERE field_key = ?").run(fieldKey);
  // Not: cihazların extra_fields JSON'undaki bu key'e ait değerler kasıtlı olarak silinmiyor —
  // zararsız "yetim" veri olarak kalır, alan tekrar eklenirse eski değerler geri görünür.
}

function getCompanies() {
  return db
    .prepare("SELECT DISTINCT company FROM devices WHERE company IS NOT NULL ORDER BY company")
    .all()
    .map((r) => r.company);
}

function getLocations(company) {
  const stmt = company
    ? db.prepare("SELECT DISTINCT location FROM devices WHERE company = ? AND location IS NOT NULL ORDER BY location")
    : db.prepare("SELECT DISTINCT location FROM devices WHERE location IS NOT NULL ORDER BY location");
  return (company ? stmt.all(company) : stmt.all()).map((r) => r.location);
}

function getDevices({ company, location, role, userCompany } = {}) {
  const conditions = [];
  const params = [];

  const effectiveCompany = role === "operator" ? userCompany : company;

  if (effectiveCompany) {
    conditions.push("company = ?");
    params.push(effectiveCompany);
  }
  if (location) {
    conditions.push("LOWER(location) = LOWER(?)");
    params.push(location);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const rows = db
    .prepare(
      `SELECT id, device_code, serial_no, mac, company, location, city, district, latitude, longitude, connection,
              logo, sw_version, msp_fw, msp_sw, hw_version, note, updated_at, created_at, extra_fields, is_revision,
              activation_code
       FROM devices ${where}
       ORDER BY company, location, device_code`
    )
    .all(...params);

  return rows.map((r) => {
    let extra_fields = {};
    try { extra_fields = r.extra_fields ? JSON.parse(r.extra_fields) : {}; } catch { extra_fields = {}; }
    return { ...r, extra_fields };
  });
}

function getDeviceByCode(deviceCode) {
  return db.prepare("SELECT * FROM devices WHERE device_code = ?").get(deviceCode);
}

// Toplu OTA güncellemesi bir cihazı BAŞARIYLA güncelleyince, envanterdeki
// (Cihaz Yönetimi'nde görünen) eski sürüm numarası bayat kalmasın diye
// çağrılıyor (bkz. ota-bulk-jobs.js monitorLoop, setPhase("success", ...)
// anları). SADECE ilgili sürüm kolonunu değiştirir, cihazın diğer
// alanlarına dokunmaz. Sonraki bir toplu içe aktarma (replaceAllDevices)
// bu değeri yine de üzerine yazabilir — bu, tüm devices tablosunun zaten
// içe aktarmada "sil, yeniden ekle" mantığıyla çalışmasının doğal bir
// sonucu, burada özel olarak ele alınmıyor.
function updateDeviceVersion(mac, fields) {
  const cols = Object.keys(fields).filter((k) => ["sw_version", "msp_fw"].includes(k) && fields[k]);
  if (cols.length === 0 || !mac) return;
  const setClause = cols.map((c) => `${c} = @${c}`).join(", ");
  const params = { mac };
  for (const c of cols) params[c] = fields[c];
  db.prepare(`UPDATE devices SET ${setClause} WHERE UPPER(mac) = UPPER(@mac)`).run(params);
}

// Cihazdan başarılı bir okuma/SET OK geldikten sonra envanter alanlarını
// MAC'e göre günceller. MAC ve kullanıcı açıklaması özellikle bu fonksiyona
// dahil değildir; ikisi de envanter kimliği/manuel alan olarak kalır.
function updateDeviceInventoryByMac(mac, fields) {
  const allowed = ["device_code", "serial_no", "connection", "sw_version", "msp_sw", "hw_version", "logo"];
  const clean = {};
  for (const key of allowed) {
    if (fields && fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== "") {
      clean[key] = String(fields[key]).trim();
    }
  }
  const compact = String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact) || Object.keys(clean).length === 0) return 0;
  const formatted = compact.match(/.{2}/g).join(":");
  const setClause = Object.keys(clean).map((key) => `${key} = @${key}`).join(", ");
  const params = { mac: formatted, updatedAt: new Date().toISOString().split("T")[0], ...clean };
  const result = db.prepare(`UPDATE devices SET ${setClause}, updated_at = @updatedAt WHERE UPPER(REPLACE(mac, ':', '')) = @macCompact`)
    .run({ ...params, macCompact: compact });
  return result.changes;
}

const { encodeActivationCode } = require("./activation-code");

function replaceAllDevices(rows) {
  const insert = db.prepare(`
    INSERT INTO devices
      (device_code, serial_no, mac, company, location, city, district, latitude, longitude, connection,
       logo, sw_version, msp_fw, msp_sw, hw_version, note, updated_at, created_at, extra_fields, is_revision,
       activation_code)
    VALUES
      (@device_code, @serial_no, @mac, @company, @location, @city, @district, @latitude, @longitude, @connection,
       @logo, @sw_version, @msp_fw, @msp_sw, @hw_version, @note, @updated_at, @created_at, @extra_fields, @is_revision,
       @activation_code)
  `);

  const importAll = db.transaction((items) => {
    db.prepare("DELETE FROM devices").run();
    for (const row of items) {
      // created_at verilmemişse (yani gerçekten yeni bir cihazsa) şimdiki tam zaman damgasını ata —
      // verilmişse (mevcut bir cihaz güncelleniyorsa) olduğu gibi korunur, "eklenme sırası" bozulmaz
      insert.run({
        ...row,
        city: row.city || null,
        district: row.district || null,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        msp_sw: row.msp_sw ?? null,
        created_at: row.created_at || new Date().toISOString(),
        activation_code: encodeActivationCode(row.mac), // Excel/istekten gelen değer değil, her zaman MAC'ten
        extra_fields: JSON.stringify(row.extra_fields && typeof row.extra_fields === "object" ? row.extra_fields : {}),
      });
    }
  });

  importAll(rows);
  return rows.length;
}

function updateDeviceLocation(id, { location, latitude, longitude }) {
  return db.prepare(`
    UPDATE devices
       SET location = @location,
           latitude = @latitude,
           longitude = @longitude,
           updated_at = @updatedAt
     WHERE id = @id
  `).run({
    id: Number(id),
    location: location || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    updatedAt: new Date().toISOString().split("T")[0],
  });
}

// bulk:<jobId>:w<n> / ota:<jobId>:w<n> — toplu iş şeritlerinin kullandığı
// sahte session_id'ler. Bunlar ASLA gerçek bir kullanıcıya ait olamaz, bu
// yüzden "sahibi iş hâlâ çalışıyor mu" diye KESİN olarak sorulabilir —
// gerçek kullanıcı session'ları için böyle bir kesinlik yok (biri gerçekten
// bağlı olabilir), o yüzden bu fonksiyon SADECE bu iki önek için anlamlı.
const SYNTHETIC_SESSION_RE = /^(bulk|ota):([0-9a-f]+):w\d+$/;

// status:<şirket>:w<n> — Toplu Okuma'nın arka plan izleme şeritlerinin
// kullandığı sahte session_id (bkz. device-status-poll.js). bulk:/ota:'dan
// FARKLI olarak buna bağlı bir "iş" kaydı yok — kontrol edilecek "hâlâ
// çalışıyor mu" durumu yok, çünkü zaten HER ZAMAN önceliksiz: birkaç
// saniyelik bağlan→oku→kopar turu, kesilirse bir sonraki turda sorunsuz
// tekrar dener. Gerçek bir kullanıcı bağlanmak istediğinde bunun önünde
// durmasın diye her zaman "bayat" (anında bırakılabilir) sayılıyor.
const STATUS_POLL_SESSION_RE = /^status:.+:w\d+$/;

// Backend süreci yeniden başlamadan (startup temizliği) ve 5-10 dakikalık
// inaktivite zaman aşımı dolmadan önce de bir şerit çökebilir/takılabilir —
// bu durumda target.json'da "activate" durumunda yetim bir satır kalır ve
// checkOccupancy bunu GERÇEK bir meşguliyet sanıp cihazı bloke eder (sahada
// gözlendi: kullanıcı aynı cihaza tekrar tekrar bağlanmaya çalışıyor ama
// "cihaz meşgul: ota:<eski_iş>:w0" diye reddediliyor). Bu fonksiyon, occupant
// bir sahte session'sa, sahibi işin durumuna bakıp KESİN karar verir —
// zaman aşımı beklemeden.
function isSyntheticSessionStale(sessionId) {
  if (STATUS_POLL_SESSION_RE.test(sessionId)) return true;
  const m = sessionId.match(SYNTHETIC_SESSION_RE);
  if (!m) return false; // gerçek kullanıcı session'ı ya da tanınmayan biçim — dokunma
  const [, kind, jobId] = m;
  const job = kind === "bulk" ? getBulkJob(jobId) : getOtaBulkJob(jobId);
  return !job || job.status !== "running";
}

// ── Toplu Okuma — şirket bazlı canlı cihaz durumu panosu ──
// Ayrı bir "iş" değil, sürekli güncellenen tek bir anlık görüntü: her MAC
// için en son bilinen durum üstüne yazılır (kalıcı geçmiş tutulmuyor).
db.exec(`
  CREATE TABLE IF NOT EXISTS device_live_status (
    mac         TEXT PRIMARY KEY,
    company     TEXT,
    location    TEXT,
    device_code TEXT,
    state       TEXT,   -- charging | plugged | idle | offline | unknown
    label       TEXT,   -- kullanıcıya gösterilecek Türkçe etiket
    raw         TEXT,   -- ham id 25 değeri (varsa) — teşhis için
    updated_at  TEXT
  )
`);
{
  const cols = db.prepare("PRAGMA table_info(device_live_status)").all().map((c) => c.name);
  // max_power — id 4'ten canlı okunan Maks. Güç (bkz. device-status-poll.js
  // pollOne). sw_version zaten devices tablosunda var ama Toplu Okuma
  // popover'ı sadece bu tablodan okuduğu için burada da kopyası tutuluyor.
  if (!cols.includes("sw_version")) db.exec("ALTER TABLE device_live_status ADD COLUMN sw_version TEXT");
  if (!cols.includes("max_power")) db.exec("ALTER TABLE device_live_status ADD COLUMN max_power TEXT");
}

function upsertDeviceLiveStatus({ mac, company, location, deviceCode, state, label, raw, swVersion, maxPower }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO device_live_status (mac, company, location, device_code, state, label, raw, sw_version, max_power, updated_at)
    VALUES (@mac, @company, @location, @deviceCode, @state, @label, @raw, @swVersion, @maxPower, @now)
    ON CONFLICT(mac) DO UPDATE SET
      company = @company, location = @location, device_code = @deviceCode,
      state = @state, label = @label, raw = @raw,
      -- Bu turda taze okunamadıysa (cihaz meşgul/pasif) önceki bilinen
      -- değeri koru — her turda NULL'a düşüp ekranda titremesin.
      sw_version = COALESCE(@swVersion, sw_version),
      max_power = COALESCE(@maxPower, max_power),
      updated_at = @now
  `).run({
    mac, company: company || null, location: location || null, deviceCode: deviceCode || null,
    state, label, raw: raw || null, swVersion: swVersion || null, maxPower: maxPower || null, now,
  });
}

function getDeviceLiveStatusForCompany(company) {
  return db.prepare(`SELECT * FROM device_live_status WHERE company = ? ORDER BY location, mac`).all(company);
}

// ── Genel Bakış — salt okunur özet sorguları ──
function getAllDeviceLiveStatus() {
  return db.prepare(`SELECT mac, state, label, updated_at FROM device_live_status`).all();
}

// Toplu Parametre + Toplu Güncelleme (OTA) işleri tek listede, en yeni üstte.
// createdBy verilirse sadece o kullanıcının işleri; includeOta=false ise OTA işleri hariç.
function listRecentJobs({ createdBy, includeOta = true, limit = 8 } = {}) {
  const where = createdBy ? "WHERE j.created_by = @createdBy" : "";
  const paramSql = `
    SELECT 'param' AS type, j.id, j.company, j.param_label AS title, j.created_by, j.status, j.created_at,
      (SELECT COUNT(*) FROM bulk_job_devices d WHERE d.job_id = j.id) AS total,
      (SELECT COUNT(*) FROM bulk_job_devices d WHERE d.job_id = j.id AND d.phase = 'success') AS ok
    FROM bulk_jobs j ${where}`;
  const otaSql = `
    SELECT 'ota' AS type, j.id, j.company, j.kind AS title, j.created_by, j.status, j.created_at,
      (SELECT COUNT(*) FROM ota_bulk_job_devices d WHERE d.job_id = j.id) AS total,
      (SELECT COUNT(*) FROM ota_bulk_job_devices d WHERE d.job_id = j.id AND d.phase IN ('success', 'uptodate')) AS ok
    FROM ota_bulk_jobs j ${where}`;
  const sql = (includeOta ? `${paramSql} UNION ALL ${otaSql}` : paramSql) + ` ORDER BY created_at DESC LIMIT @limit`;
  const params = { limit };
  if (createdBy) params.createdBy = createdBy;
  return db.prepare(sql).all(params);
}

// Durum değişmeden yalnızca "Son veri" zamanı (Heartbeat vb. her canlı mesajda)
function touchDeviceLiveStatus(mac, at = new Date().toISOString()) {
  db.prepare("UPDATE device_live_status SET updated_at = ? WHERE mac = ? AND state != 'offline'").run(at, mac);
}

function getDeviceLiveState(mac) {
  return db.prepare("SELECT state, raw, updated_at FROM device_live_status WHERE mac = ?").get(mac) || null;
}

// ── Kayıtlı log arşivi çekimleri (frame 3 30) — cihaz başına son çekim ──
// Otomatik çekim (bkz. archive-auto-pull.js) ve kullanıcının elle yaptığı
// çekimler aynı satıra yazılır; ekranda "son çekim" ve eşitlik buradan gelir.
db.exec(`
  CREATE TABLE IF NOT EXISTS archive_pulls (
    mac              TEXT PRIMARY KEY,
    last_success_at  TEXT,
    last_source      TEXT,   -- auto | manual
    last_detail      TEXT,   -- cihazın son ilerleme satırının ayrıntısı
    last_attempt_at  TEXT,
    last_result      TEXT    -- ok | charging | offline | busy | failed | timeout | interrupted
  )
`);

{
  // Sürümü uygun olmayan cihazlarda günde bir kez ESP'den sürüm okunur (bkz. archive-auto-pull.js)
  const cols = db.prepare("PRAGMA table_info(archive_pulls)").all().map((c) => c.name);
  if (!cols.includes("last_version_check_at")) db.exec("ALTER TABLE archive_pulls ADD COLUMN last_version_check_at TEXT");
}

function markVersionCheck(mac, at = new Date().toISOString()) {
  db.prepare(`
    INSERT INTO archive_pulls (mac, last_version_check_at) VALUES (@mac, @at)
    ON CONFLICT(mac) DO UPDATE SET last_version_check_at = @at
  `).run({ mac, at });
}

function getArchivePull(mac) {
  return db.prepare("SELECT * FROM archive_pulls WHERE mac = ?").get(mac) || null;
}

function recordArchivePull({ mac, result, source, detail = null, at = new Date().toISOString() }) {
  const ok = result === "ok";
  db.prepare(`
    INSERT INTO archive_pulls (mac, last_success_at, last_source, last_detail, last_attempt_at, last_result)
    VALUES (@mac, @successAt, @source, @detail, @at, @result)
    ON CONFLICT(mac) DO UPDATE SET
      last_success_at = COALESCE(@successAt, last_success_at),
      last_source     = CASE WHEN @successAt IS NULL THEN last_source ELSE @source END,
      last_detail     = CASE WHEN @successAt IS NULL THEN last_detail ELSE @detail END,
      last_attempt_at = @at,
      last_result     = @result
  `).run({ mac, successAt: ok ? at : null, source: source || null, detail, at, result });
}

module.exports = {
  getDeviceLiveState, touchDeviceLiveStatus, getArchivePull, recordArchivePull, markVersionCheck,
  getAllDeviceLiveStatus, listRecentJobs,
  getCompanies, getLocations, getDevices, getDeviceByCode, replaceAllDevices, updateDeviceVersion, updateDeviceInventoryByMac, updateDeviceLocation,
  getCustomFields, addCustomField, deleteCustomField,
  createBulkJob, updateBulkJobDevice, setBulkJobStatus, dismissBulkJob, getBulkJob, listBulkJobs,
  setBulkJobAutoRetryNextAt, setBulkJobAutoRetryChild, listPendingAutoRetryBulkJobs,
  createOtaBulkJob, updateOtaBulkJobDevice, setOtaBulkJobStatus, dismissOtaBulkJob, getOtaBulkJob, listOtaBulkJobs,
  setOtaBulkJobAutoRetryNextAt, setOtaBulkJobAutoRetryChild, listPendingAutoRetryOtaBulkJobs,
  isSyntheticSessionStale,
  upsertDeviceLiveStatus, getDeviceLiveStatusForCompany,
};
