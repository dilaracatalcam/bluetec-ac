const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "bluetech.db");
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
      `SELECT id, device_code, serial_no, mac, company, location, connection,
              logo, sw_version, msp_fw, msp_sw, hw_version, note, updated_at, created_at, extra_fields, is_revision
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

function replaceAllDevices(rows) {
  const insert = db.prepare(`
    INSERT INTO devices
      (device_code, serial_no, mac, company, location, connection,
       logo, sw_version, msp_fw, msp_sw, hw_version, note, updated_at, created_at, extra_fields, is_revision)
    VALUES
      (@device_code, @serial_no, @mac, @company, @location, @connection,
       @logo, @sw_version, @msp_fw, @msp_sw, @hw_version, @note, @updated_at, @created_at, @extra_fields, @is_revision)
  `);

  const importAll = db.transaction((items) => {
    db.prepare("DELETE FROM devices").run();
    for (const row of items) {
      // created_at verilmemişse (yani gerçekten yeni bir cihazsa) şimdiki tam zaman damgasını ata —
      // verilmişse (mevcut bir cihaz güncelleniyorsa) olduğu gibi korunur, "eklenme sırası" bozulmaz
      insert.run({
        ...row,
        msp_sw: row.msp_sw ?? null,
        created_at: row.created_at || new Date().toISOString(),
        extra_fields: JSON.stringify(row.extra_fields && typeof row.extra_fields === "object" ? row.extra_fields : {}),
      });
    }
  });

  importAll(rows);
  return rows.length;
}

module.exports = {
  getCompanies, getLocations, getDevices, getDeviceByCode, replaceAllDevices,
  getCustomFields, addCustomField, deleteCustomField,
};