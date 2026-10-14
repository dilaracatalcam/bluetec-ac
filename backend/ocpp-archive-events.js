/*
 * frame 3 30 ile Bluetech sunucusuna aktarılan OCPP arşivini olay listesine çevirir.
 *
 * Arşivdeki metin dosyaları (ocpp-*-steve.log, ocpp-*-color.log, ocpp-*.html)
 * her satırda bir OCPP-J mesajı taşır: [2,"id","Action",{...}] (CALL),
 * [3,"id",{...}] (CALLRESULT), [4,"id","Kod","Açıklama",{...}] (CALLERROR).
 * Satır formatı kaynağa göre değişebildiği için ayrıştırıcı toleranslıdır:
 * ANSI renk kodları ve HTML etiketleri atılır, satırdaki ilk geçerli OCPP
 * dizisi JSON olarak okunur, zaman damgası satırın JSON'dan önceki kısmından
 * (ISO, gg/aa/yyyy veya epoch) alınır. CALL ve cevabı uniqueId ile eşlenir.
 */

const ACTION_LABELS = {
  Heartbeat: "Heartbeat",
  BootNotification: "Boot Notification",
  MeterValues: "Meter Value",
  StatusNotification: "Status Notification",
  StartTransaction: "Start Transaction",
  StopTransaction: "Stop Transaction",
  Authorize: "Authorize",
  Reset: "Reset",
  RemoteStartTransaction: "Remote Start",
  RemoteStopTransaction: "Remote Stop",
  ChangeConfiguration: "Change Configuration",
  GetConfiguration: "Get Configuration",
  ChangeAvailability: "Change Availability",
  DataTransfer: "Data Transfer",
  TriggerMessage: "Trigger Message",
  UnlockConnector: "Unlock Connector",
  ClearCache: "Clear Cache",
  UpdateFirmware: "Update Firmware",
  FirmwareStatusNotification: "Firmware Status",
  DiagnosticsStatusNotification: "Diagnostics Status",
  GetDiagnostics: "Get Diagnostics",
};

// Cihazın (şarj noktasının) başlattığı mesajlar — yön ipucu yoksa CALL'ın yönü buradan çıkar.
const CP_INITIATED = new Set([
  "Heartbeat", "BootNotification", "MeterValues", "StatusNotification", "StartTransaction",
  "StopTransaction", "Authorize", "DataTransfer", "FirmwareStatusNotification", "DiagnosticsStatusNotification",
]);

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const ISO_RE = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/;
const TR_RE = /(\d{2})[./](\d{2})[./](\d{4})[ T,]+(\d{2}):(\d{2}):(\d{2})/;
const EPOCH_RE = /\b(1[6-9]\d{8})(\d{3})?\b/;
const DISCONNECT_RE = /\b(disconnect(ed)?|connection (closed|lost)|ws(s)? closed|bağlantı (koptu|kesildi))\b/i;

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&rarr;/g, "→").replace(/&larr;/g, "←").replace(/&uarr;/g, "↑").replace(/&darr;/g, "↓")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function cleanLines(text, format) {
  let t = String(text || "");
  if (format === "html") {
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    t = decodeEntities(t);
  }
  return t.replace(ANSI_RE, "").split(/\r?\n/);
}

function parseTime(prefix) {
  let m = prefix.match(ISO_RE);
  if (m) {
    const zone = m[8] ? (m[8] === "Z" ? "Z" : m[8].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "";
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}${zone}`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  m = prefix.match(TR_RE);
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  m = prefix.match(EPOCH_RE);
  if (m) return Number(m[1]) * 1000 + (m[2] ? Number(m[2]) : 0);
  return null;
}

function directionHint(prefix) {
  if (/(->|→|>>|↑|\b(tx|send|sent|outgoing|cp\s*>\s*cs)\b)/i.test(prefix)) return "out";
  if (/(<-|←|<<|↓|\b(rx|recv|received|incoming|cs\s*>\s*cp)\b)/i.test(prefix)) return "in";
  return null;
}

// Satırdaki ilk geçerli OCPP-J dizisini bulur: [2|3|4, "id", ...]
function extractFrame(line) {
  const re = /\[\s*([234])\s*,\s*"/g;
  let m;
  while ((m = re.exec(line))) {
    const start = m.index;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          const raw = line.slice(start, i + 1);
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && typeof arr[1] === "string") return { arr, raw, index: start };
          } catch {}
          break;
        }
      }
    }
  }
  return null;
}

function payloadTime(arr) {
  const body = arr[0] === 2 ? arr[3] : arr[2];
  const t = body?.timestamp || body?.currentTime || body?.meterValue?.[0]?.timestamp;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function labelFor(action) {
  return ACTION_LABELS[action] || action || "Unknown";
}

/*
 * text → [{ id, time, action, type, call, result, error }]
 * call/result: { raw, dir: "out"|"in", time } — dir cihaz açısından: out = cihazdan sunucuya.
 */
function parseOcppLog(text, format = "text") {
  const events = [];
  const byId = new Map();
  let lastTime = null;
  let seq = 0;

  for (const line of cleanLines(text, format)) {
    if (!line.trim()) continue;
    const frame = extractFrame(line);
    const prefix = frame ? line.slice(0, frame.index) : line;
    let time = parseTime(prefix);

    if (!frame) {
      if (DISCONNECT_RE.test(line)) {
        if (time == null) time = lastTime;
        if (time == null) continue;
        lastTime = time;
        events.push({ id: `disc-${time}-${seq++}`, time, action: "Disconnected", type: "Disconnected", call: { raw: line.trim(), dir: null, time }, result: null, error: null });
      }
      continue;
    }

    const { arr, raw } = frame;
    if (time == null) time = payloadTime(arr) ?? lastTime;
    if (time == null) continue;
    lastTime = time;
    const hint = directionHint(prefix);
    const uid = arr[1];

    if (arr[0] === 2) {
      const action = String(arr[2] || "");
      const dir = hint || (CP_INITIATED.has(action) ? "out" : "in");
      const ev = { id: uid, time, action, type: labelFor(action), call: { raw, dir, time }, result: null, error: null };
      const prev = byId.get(uid);
      if (prev && !prev.call) {
        // cevap CALL'dan önce gelmiş (satırlar sıralı değil) — birleştir
        Object.assign(prev, { time, action, type: ev.type, call: ev.call });
        continue;
      }
      if (prev && prev.call?.raw === raw) continue; // current + history çakışması
      byId.set(uid, ev);
      events.push(ev);
    } else {
      const ev = byId.get(uid);
      const dir = hint || (ev?.call ? (ev.call.dir === "out" ? "in" : "out") : "in");
      const part = { raw, dir, time };
      if (ev) {
        if (arr[0] === 3) ev.result = part; else ev.error = part;
      } else {
        const orphan = { id: uid, time, action: "", type: "Unknown", call: null, result: arr[0] === 3 ? part : null, error: arr[0] === 4 ? part : null };
        byId.set(uid, orphan);
        events.push(orphan);
      }
    }
  }
  return events;
}

// Birden çok dosyanın olaylarını birleştirir, aynı uniqueId'yi tekrarlamaz, zamana göre sıralar.
function mergeEvents(lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const ev of list) {
      const key = ev.action === "Disconnected" ? `${ev.id}` : `${ev.id}|${ev.action}`;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, ev); continue; }
      if (!prev.result && ev.result) prev.result = ev.result;
      if (!prev.error && ev.error) prev.error = ev.error;
      if (!prev.call && ev.call) Object.assign(prev, { call: ev.call, action: ev.action, type: ev.type, time: ev.time });
    }
  }
  return [...seen.values()].sort((a, b) => a.time - b.time);
}

// Arşiv kataloğundan okunacak OCPP metin dosyalarını seçer: tercih sırası steve → color → html.
function pickOcppFiles(files) {
  const ocpp = files.filter((f) => f.family === "ocpp" && f.format !== "ocl" && !f.name.endsWith(".part") && !f.name.endsWith(".json") && f.size > 0);
  for (const test of [(n) => n.includes("steve"), (n) => n.includes("color"), (n) => n.endsWith(".html")]) {
    const chosen = ocpp.filter((f) => test(f.name.toLowerCase()));
    if (chosen.length) return chosen;
  }
  return ocpp;
}

module.exports = { parseOcppLog, mergeEvents, pickOcppFiles, labelFor, ACTION_LABELS };
