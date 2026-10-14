/*
 * Canlı OCPP olay deposu (frame 3 28 3 — "Canlı OCPP Akışı").
 *
 * Satırlar iki yoldan gelir:
 *  - Loglar sayfasında bağlı kullanıcının oturumu 28'i 3'e aldığında (device-log-stream)
 *  - Toplu Okuma her cihaza uğradığında kısa süre 3 28 3 açıp topladığında (device-status-poll)
 * Her satır cihaz MAC'iyle buraya eklenir. İki görünüm beslenir:
 *  - feed: tüm cihazların son satırları (siyah canlı konsol), artan id ile
 *  - events: cihaz başına olaylar (zaman çizelgesi / işlem geçmişi), arşiv
 *    olaylarıyla aynı biçimde (bkz. ocpp-archive-events.js)
 * Veriler RAM'de tutulur; sunucu yeniden başlarsa sıfırlanır.
 */

const { extractFrame, directionHint, labelFor, CP_INITIATED, DISCONNECT_RE, ACTION_LABELS } = require("./ocpp-archive-events");

const MAX_FEED = 1000;
const MAX_EVENTS_PER_DEVICE = 5000;
const EVENT_TTL_MS = 48 * 60 * 60 * 1000;

// JSON çerçevesi parçalı gelirse (MQTT çerçevesi kısa) eylem adı metinden yakalanır.
const ACTION_RE = new RegExp(`\\b(${Object.keys(ACTION_LABELS).join("|")})\\b`);

const up = (mac) => String(mac || "").toUpperCase();

function initOcppLiveStore() {
  const feed = [];
  let nextId = 1;
  const devices = new Map(); // MAC -> { events: [], byUid: Map }

  function deviceOf(mac) {
    let d = devices.get(mac);
    if (!d) { d = { events: [], byUid: new Map() }; devices.set(mac, d); }
    return d;
  }

  function prune(d, now) {
    const cut = now - EVENT_TTL_MS;
    let drop = 0;
    while (drop < d.events.length && (d.events[drop].time < cut || d.events.length - drop > MAX_EVENTS_PER_DEVICE)) drop++;
    if (drop) {
      for (const ev of d.events.slice(0, drop)) d.byUid.delete(ev.id);
      d.events.splice(0, drop);
    }
  }

  // Tek satırı olaya çevirip depolar; konsol için feed girdisini döndürür.
  function add(mac, line, at = Date.now()) {
    const key = up(mac);
    const text = String(line || "").trim();
    if (!key || !text) return null;
    const d = deviceOf(key);
    const frame = extractFrame(text);
    const hint = directionHint(frame ? text.slice(0, frame.index) : text);
    let ev = null;
    let action = "";
    let dir = hint;

    if (frame) {
      const { arr, raw } = frame;
      const uid = arr[1];
      if (arr[0] === 2) {
        action = String(arr[2] || "");
        dir = hint || (CP_INITIATED.has(action) ? "out" : "in");
        ev = { id: uid, time: at, action, type: labelFor(action), call: { raw, dir, time: at }, result: null, error: null };
        d.byUid.set(uid, ev);
        d.events.push(ev);
      } else {
        const prev = d.byUid.get(uid);
        action = prev?.action || "";
        dir = hint || (prev?.call ? (prev.call.dir === "out" ? "in" : "out") : "in");
        const part = { raw, dir, time: at };
        if (prev) {
          if (arr[0] === 3) prev.result = part; else prev.error = part;
        } else {
          ev = { id: uid, time: at, action: "", type: "Unknown", call: null, result: arr[0] === 3 ? part : null, error: arr[0] === 4 ? part : null };
          d.byUid.set(uid, ev);
          d.events.push(ev);
        }
      }
    } else if (DISCONNECT_RE.test(text)) {
      action = "Disconnected";
      ev = { id: `disc-${at}-${nextId}`, time: at, action, type: "Disconnected", call: { raw: text, dir: null, time: at }, result: null, error: null };
      d.events.push(ev);
    } else {
      action = text.match(ACTION_RE)?.[1] || "";
      if (action) {
        dir = hint || (CP_INITIATED.has(action) ? "out" : "in");
        ev = { id: `txt-${at}-${nextId}`, time: at, action, type: labelFor(action), call: { raw: text, dir, time: at }, result: null, error: null };
        d.events.push(ev);
      }
    }
    prune(d, at);

    const entry = { id: nextId++, at, mac: key, action, type: action ? labelFor(action) : "Unknown", dir: dir || null, raw: text };
    feed.push(entry);
    if (feed.length > MAX_FEED) feed.splice(0, feed.length - MAX_FEED);
    return entry;
  }

  return {
    add,
    // after: son görülen id; filter(mac) kapsam kontrolü (true = göster)
    feed(after, filter, limit = 300) {
      const a = Number(after) || 0;
      const lines = feed.filter((l) => l.id > a && (!filter || filter(l.mac)));
      return { lastId: nextId - 1, lines: lines.slice(-limit) };
    },
    events(mac, from = -Infinity, to = Infinity) {
      const d = devices.get(up(mac));
      if (!d) return [];
      return d.events.filter((e) => e.time >= from && e.time <= to);
    },
    clear(mac) { devices.delete(up(mac)); },
  };
}

module.exports = { initOcppLiveStore };
