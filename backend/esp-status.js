/*
 * "ESP aktif" durumunun TAZE olup olmadığı.
 *
 * Köprü status_response'u yeni bir durum gelene kadar olduğu gibi bırakır:
 * cihaz kapansa bile aynı oturumdaki eski "ESP aktif" satırı kalır. Bu yüzden
 * yeniden activate gönderildikten sonra yalnızca o andan SONRA gelen durum
 * sayılır. Zaman 85.105 sunucusunun yerel saatidir (UTC+3, dilimsiz yazılır);
 * iki sunucunun saat farkına karşı SKEW_MS pay bırakılır.
 */

const SOURCE_TZ_OFFSET = process.env.LOG_SOURCE_TZ_OFFSET || "+03:00";
const SKEW_MS = 30 * 1000;

const compactMac = (mac) => String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();

function statusTime(resp) {
  const t = String(resp?.status_response?.time || "");
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${SOURCE_TZ_OFFSET}`);
  return Number.isFinite(ms) ? ms : null;
}

// since verilirse durum o andan (SKEW_MS payla) sonra gelmiş olmalı; zamanı yazılmamış durum kabul edilir
function espActive(resp, mac, since = null) {
  const topic = compactMac(String(resp?.status_response?.topic || "").split("/")[0]);
  if (topic && topic !== compactMac(mac)) return false;
  if (!String(resp?.status_response?.data || "").toLowerCase().includes("esp aktif")) return false;
  if (since == null) return true;
  const at = statusTime(resp);
  return at == null || at >= since - SKEW_MS;
}

// Okunan "ESP aktif" cevabını siler: activate'ten önce ve okunduktan sonra çağrılır,
// böylece sonraki yoklama eski cevabı göremez. Uzak köprü dosyayı periyodik tam
// senkronizasyonla yeniden yazıp silinen satırı geri getirebildiği için (bkz.
// bulk-jobs.js clearMessageResponse notu) tek savunma bu değil — espActive'in
// zaman kontrolü de korunur.
function makeClearStatus({ withLock, readResponses, writeJsonRaw, RESPONSES_PATH }) {
  return async function clearStatus(sessionId) {
    if (!withLock || !RESPONSES_PATH) return;
    try {
      await withLock(RESPONSES_PATH, async () => {
        const r = await readResponses();
        if (r.responses[sessionId]?.status_response) {
          r.responses[sessionId].status_response = null;
          await writeJsonRaw(RESPONSES_PATH, r);
        }
      });
    } catch {}
  };
}

module.exports = { espActive, statusTime, makeClearStatus };
