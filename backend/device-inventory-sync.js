/*
 * ESP → veritabanı eşitlemesi.
 *
 * ESP'den okunan değer en güncel bilgidir. responses.json her okunduğunda
 * (tek okuma, "tümünü oku", Toplu Okuma, toplu işler — hepsi aynı dosyadan
 * geçer) her oturumun YENİ gelen okuma cevabına bakılır; eşlenen bir
 * değişkense (OCPP ID, bağlantı türü, ESP SW/HW, seri no, MSP SW, logo) o
 * oturumun bağlı olduğu cihazın kaydı güncellenir.
 *
 * - Sadece imzası değişen (yeni gelen) mesaj işlenir; sunucu açılışında ve
 *   ilk görülen oturumda var olan mesaj yalnızca hafızaya alınır — oturum
 *   başka cihaza geçmişken kalan eski cevap yanlış cihaza yazılmasın diye.
 * - status_response.topic başka bir MAC'i gösteriyorsa (cevap henüz yeni
 *   cihazdan gelmemiş) yazılmaz.
 * - Değer veritabanındakiyle aynıysa dokunulmaz (updated_at değişmez).
 */

const FIELD_MAP = {
  2: "device_code",   // OCPP ID
  7: "connection",    // Bağlantı türü
  33: "sw_version",   // ESP yazılımı
  44: "serial_no",    // Box/seri no
  61: "msp_sw",       // MSP yazılımı
  64: "logo",         // Aktif logo adı
  68: "hw_version",   // ESP donanımı
};
const CONNECTION_MAP = { "0": "CommSupported", "1": "GSM", "2": "WiFi", "3": "ETH" };

const compactMac = (mac) => String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();

function normalize(field, raw) {
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!value || /^SET\b/i.test(value)) return "";
  if (field === "connection") return CONNECTION_MAP[value] || value;
  return value;
}

function messagesOf(resp) {
  const m = resp?.message_response;
  if (Array.isArray(m)) return m.filter((x) => x && typeof x === "object");
  return m && typeof m === "object" ? [m] : [];
}
const signatureOf = (msgs) => msgs.map((m) => `${m.cmd}|${m.msg}|${m.time}|${m.data}`).join("\n");

function initDeviceInventorySync({ readTarget, getDevices, updateDeviceInventoryByMac, log = console }) {
  const lastSig = new Map(); // sessionId -> son görülen mesaj imzası
  let busy = Promise.resolve();

  async function apply(candidates) {
    const target = await readTarget();
    const devices = getDevices({});
    for (const { sessionId, topic, field, value } of candidates) {
      const slot = target.requests.find((r) => r.session_id === sessionId && r.control === "activate");
      const mac = compactMac(slot?.target);
      if (mac.length !== 12) continue;
      if (topic && !compactMac(topic.split("/")[0]).startsWith(mac)) continue;
      const device = devices.find((d) => compactMac(d.mac) === mac);
      if (!device || String(device[field] ?? "").trim() === value) continue;
      const old = device[field];
      if (updateDeviceInventoryByMac(mac, { [field]: value }) > 0) {
        device[field] = value;
        log.log?.(`[DEVICE-SYNC] ${slot.target} ${field}: "${old ?? ""}" → "${value}" (ESP'den okundu)`);
      }
    }
  }

  // responses.json içeriği her okunduğunda çağrılır; çağıranı bekletmez
  function observe(data) {
    const responses = data?.responses;
    if (!responses || typeof responses !== "object") return;
    const candidates = [];
    for (const [sessionId, resp] of Object.entries(responses)) {
      const msgs = messagesOf(resp);
      const sig = signatureOf(msgs);
      const prev = lastSig.get(sessionId);
      lastSig.set(sessionId, sig);
      if (prev === undefined || prev === sig) continue;
      for (const m of msgs) {
        if (Number(m.cmd) !== 2) continue;
        const field = FIELD_MAP[Number(m.msg)];
        const value = field && normalize(field, m.data);
        if (value) candidates.push({ sessionId, topic: String(resp?.status_response?.topic || ""), field, value });
      }
    }
    for (const id of lastSig.keys()) if (!(id in responses)) lastSig.delete(id);
    if (candidates.length === 0) return;
    busy = busy.then(() => apply(candidates)).catch((e) => log.error?.("[DEVICE-SYNC] hata:", e.message));
  }

  return { observe, _idle: () => busy };
}

module.exports = { initDeviceInventorySync, FIELD_MAP, normalize };
