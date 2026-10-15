/*
 * Canlı OCPP mesajından şarj durumu (Toplu Okuma kutucukları için).
 *
 * Toplu Okuma'da cihazlar 3 28 3 ile OCPP mesajlarını akıtırken durum ayrıca
 * okunmaz; mesajın kendisinden çıkarılır:
 *   StatusNotification  → OCPP durumu doğrudan eşlenir
 *   StartTransaction    → şarj oluyor
 *   StopTransaction     → şarj bitti
 *   MeterValues         → güç/akım çekiliyorsa ya da işlem numarası varsa şarj oluyor
 * Durum çıkarılamayan mesajlar (Heartbeat vb.) null döner; mevcut durum korunur.
 *
 * İki satır biçimi okunur:
 *   - cihazın 3 28 3 log satırı: "VERBOSE | seq=.. cat=ocpp | <- Received   MeterValues
 *     transactionId=1645 power=8290.0 energy=32050.000" (power W cinsinden)
 *   - ham OCPP-J dizisi: [2,"id","StatusNotification",{...}] (arşiv / diğer kaynaklar)
 * state değerleri device-status-poll.js classify() ile aynıdır.
 */

const { extractFrame } = require("./ocpp-archive-events");

const STATES = {
  idle: { state: "idle", label: "Boşta" },
  charging: { state: "charging", label: "Şarj Oluyor" },
  plugged: { state: "waiting_rfid", label: "Soket Takılı, Şarj Yok" },
  ended: { state: "charge_ended", label: "Şarj Bitti, Soket Takılı" },
  error: { state: "error", label: "Hata" },
};

// OCPP 1.6 ChargePointStatus
const STATUS_MAP = {
  Available: STATES.idle,
  Preparing: STATES.plugged,
  Charging: STATES.charging,
  SuspendedEV: STATES.plugged,
  SuspendedEVSE: STATES.plugged,
  Finishing: STATES.ended,
  Faulted: STATES.error,
  Unavailable: STATES.error,
};

const MIN_POWER_W = 100;   // bu gücün üstü "şarj oluyor"
const MIN_CURRENT_A = 0.5;

// MeterValues içinden anlık güç (W) ve akım (A); ölçülmemişse null
function readMeter(payload) {
  let power = null;
  let current = null;
  for (const mv of payload?.meterValue || []) {
    for (const sv of mv?.sampledValue || []) {
      const value = parseFloat(String(sv?.value ?? "").replace(",", "."));
      if (!Number.isFinite(value)) continue;
      const measurand = sv.measurand || "Energy.Active.Import.Register";
      if (measurand === "Power.Active.Import") {
        const w = /^kw$/i.test(sv.unit || "") ? value * 1000 : value;
        power = (power ?? 0) + w; // fazlar ayrı gelirse toplanır
      } else if (measurand === "Current.Import") {
        current = Math.max(current ?? 0, value);
      }
    }
  }
  return { power, current };
}

// Cihaz log satırı: "-> Sending  <Eylem>  k=v k=v" / "<- Received  <Eylem>  k=v"
const DEVICE_LINE_RE = /\b(?:Sending|Received)\s+([A-Za-z]+)\s*(.*)$/;

function fromDeviceLine(text) {
  const m = String(text).match(DEVICE_LINE_RE);
  if (!m) return null;
  const action = m[1];
  const rest = m[2] || "";
  const kv = {};
  for (const [, k, v] of rest.matchAll(/([A-Za-z]+)=("[^"]*"|\S+)/g)) kv[k] = v.replace(/^"|"$/g, "");
  if (action === "StatusNotification") {
    const status = kv.status || Object.keys(STATUS_MAP).find((s) => new RegExp(`\\b${s}\\b`).test(rest));
    if (!status) return null;
    return { action, payload: { connectorId: kv.connectorId ?? 1, status, errorCode: kv.errorCode } };
  }
  if (action === "MeterValues") {
    const sampledValue = [];
    if (kv.power != null) sampledValue.push({ value: kv.power, measurand: "Power.Active.Import", unit: "W" });
    if (kv.current != null) sampledValue.push({ value: kv.current, measurand: "Current.Import", unit: "A" });
    return { action, payload: { transactionId: kv.transactionId, meterValue: [{ sampledValue }] } };
  }
  return { action, payload: { reason: kv.reason } };
}

/*
 * text → { state, label, raw } | null
 * raw: kutucuk ayrıntısında gösterilecek kısa açıklama ("OCPP: Charging" gibi)
 */
function chargeStateFromOcpp(text) {
  const frame = extractFrame(String(text || ""));
  let action;
  let payload;
  if (frame) {
    if (frame.arr[0] !== 2) return null; // yalnızca istekler (cevaplar durum taşımaz)
    action = String(frame.arr[2] || "");
    payload = frame.arr[3] && typeof frame.arr[3] === "object" ? frame.arr[3] : {};
  } else {
    const parsed = fromDeviceLine(text);
    if (!parsed) return null;
    ({ action, payload } = parsed);
  }

  if (action === "StatusNotification") {
    const status = String(payload.status || "");
    const mapped = STATUS_MAP[status];
    if (!mapped) return null;
    // Konnektör 0 tüm istasyonu anlatır; yalnızca arıza / hizmet dışı durumu alınır
    if (Number(payload.connectorId) === 0 && mapped !== STATES.error) return null;
    const err = payload.errorCode && payload.errorCode !== "NoError" ? ` (${payload.errorCode})` : "";
    return { ...mapped, raw: `OCPP: ${status}${err}` };
  }
  if (action === "StartTransaction") return { ...STATES.charging, raw: "OCPP: StartTransaction" };
  if (action === "StopTransaction") return { ...STATES.ended, raw: `OCPP: StopTransaction${payload.reason ? ` (${payload.reason})` : ""}` };
  if (action === "MeterValues") {
    const { power, current } = readMeter(payload);
    if (power != null || current != null) {
      const drawing = (power != null && power > MIN_POWER_W) || (current != null && current > MIN_CURRENT_A);
      if (!drawing) return null; // güç yok — araç bağlı mı bitti mi bilinmez, mevcut durum korunur
      const kw = power != null ? ` ${(power / 1000).toFixed(1)} kW` : "";
      return { ...STATES.charging, raw: `OCPP: MeterValues${kw}` };
    }
    // Ölçü yalnızca enerji sayacıysa: işlem numarası şarjın sürdüğünü gösterir
    if (payload.transactionId != null) return { ...STATES.charging, raw: "OCPP: MeterValues" };
  }
  return null;
}

module.exports = { chargeStateFromOcpp, readMeter };
