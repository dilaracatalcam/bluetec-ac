/*
 * Toplu Okuma — canlı OCPP izleyici (frame 3 28 3).
 *
 * Toplu Okuma sayfası açıkken o şirketin cihazlarına KALICI bağlantı açılır:
 * her cihaz için bir kez activate, bir kez şarj durumu okuma (id 25), bir kez
 * "frame 3 28 3". Sonra bağlantı açık tutulur ve cihazın OCPP satırları
 * responses.json'dan toplanıp ocpp-live-store'a yazılır. Komut tekrar
 * gönderilmez.
 *
 * Sayfayı izleyen kimse kalmayınca (açık çıkış isteği ya da IDLE_MS boyunca
 * istek gelmemesi) her cihaza "frame 3 28 0" gönderilir, bağlantılar bırakılır
 * ve o cihazların canlı OCPP kayıtları silinir.
 *
 * Gerçek bir kullanıcı izlenen cihaza bağlanırsa server.js release() çağırır:
 * önce 3 28 0, sonra slot bırakılır; cihaz kullanıcı ayrılana kadar izlenmez.
 */

const SESSION_PREFIX = "ocppwatch:";
const SESSION_RE = /^ocppwatch:/;
const ACTIVATE_CONCURRENCY = 4;   // aynı anda kaç cihaza bağlanılmaya çalışılır
const MAX_DEVICES = 60;           // bir şirkette en fazla bu kadar cihaz izlenir
const ACTIVATE_WAIT_SEC = 20;     // "ESP aktif" için bekleme
const STATUS_READ_POLLS = 4;      // id 25 cevabı için deneme (~6 sn)
const POLL_MS = 1500;
const READ_TICK_MS = 300;         // responses.json okuma aralığı
const IDLE_MS = 20 * 1000;        // bu süre istek gelmezse izleyici kapanır
const RETRY_MS = 3 * 60 * 1000;   // çevrimdışı / meşgul cihazı yeniden deneme
const TOUCH_MS = 60 * 1000;       // slotun inaktiviteden düşmemesi için
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const compactMac = (mac) => String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

function firstMessage(resp) {
  const m = resp?.message_response;
  if (Array.isArray(m)) return m[0] || null;
  return m && typeof m === "object" ? m : null;
}
const signatureOf = (m) => (m ? `${m.cmd}|${m.msg}|${m.time}|${m.data}` : "");

function initOcppWatch(deps) {
  const {
    readTarget, writeJsonRaw, withLock, TARGET_PATH, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, touchSlot, readResponses, getDevices, ocppLive, onStatus, SLOT_CLEAR_MSG_INTERVAL = 1500,
  } = deps;

  const watchers = new Map(); // company -> watcher
  const bySession = new Map(); // sessionId -> { watcher, entry }

  const sendFrame = async (sessionId, frame) => {
    let sent = false;
    await withLock(TARGET_PATH, async () => {
      const data = await readTarget();
      const slot = data.requests.find((r) => r.session_id === sessionId);
      if (!slot) return;
      slot.send_message = frame;
      await writeJsonRaw(TARGET_PATH, data);
      sent = true;
    });
    if (!sent) return false;
    touchSlot(sessionId);
    setTimeout(async () => {
      try {
        await withLock(TARGET_PATH, async () => {
          const d = await readTarget();
          const s = d.requests.find((r) => r.session_id === sessionId);
          if (s && s.send_message === frame) { s.send_message = ""; await writeJsonRaw(TARGET_PATH, d); }
        });
      } catch {}
    }, SLOT_CLEAR_MSG_INTERVAL);
    return true;
  };

  const espActive = (resp, mac) => {
    const topic = String(resp?.status_response?.topic || "").toUpperCase();
    if (topic && !topic.startsWith(String(mac).toUpperCase())) return false;
    return String(resp?.status_response?.data || "").toLowerCase().includes("esp aktif");
  };

  // Cihaz başka bir oturumda açık mı? Toplu Okuma şeritleri (status:) kısa sürelidir — beklenir.
  const occupantOf = async (mac, sessionId) => {
    const target = await readTarget();
    return target.requests.find((r) => r.target === mac && r.control === "activate" && r.session_id !== sessionId) || null;
  };

  async function activate(watcher, entry) {
    const { mac, sessionId } = entry;
    entry.phase = "activating";
    try {
      const occ = await occupantOf(mac, sessionId);
      if (occ) {
        entry.phase = "occupied";
        entry.retryAt = Date.now() + (occ.session_id.startsWith("status:") ? 15000 : RETRY_MS);
        return;
      }
      await deactivateThenActivateForSlot(sessionId, mac);
      touchSlot(sessionId);
      let resp = null;
      let active = false;
      for (let i = 0; i < ACTIVATE_WAIT_SEC && !watcher.stopped; i++) {
        await sleep(1000);
        resp = (await readResponses()).responses[sessionId];
        if (espActive(resp, mac)) { active = true; break; }
      }
      if (watcher.stopped) return;
      if (!active) {
        entry.phase = "offline";
        entry.retryAt = Date.now() + RETRY_MS;
        await removeSlot(sessionId).catch(() => {});
        onStatus?.(entry.device, false, null);
        return;
      }

      // Şarj durumu bir kez okunur — izleme süresince Toplu Okuma şeritleri bu cihazı okuyamaz
      await sendFrame(sessionId, "frame 2 25 0");
      let raw = null;
      for (let i = 0; i < STATUS_READ_POLLS && !watcher.stopped; i++) {
        await sleep(POLL_MS);
        const m = firstMessage((await readResponses()).responses[sessionId]);
        if (m && Number(m.cmd) === 2 && Number(m.msg) === 25 && m.data != null) { raw = String(m.data); break; }
      }
      onStatus?.(entry.device, true, raw);
      if (watcher.stopped) return;

      entry.lastSig = signatureOf(firstMessage((await readResponses()).responses[sessionId]));
      await sendFrame(sessionId, "frame 3 28 3");
      entry.logOn = true;
      entry.phase = "watching";
      entry.touchedAt = Date.now();
    } catch (e) {
      entry.phase = "offline";
      entry.retryAt = Date.now() + RETRY_MS;
      console.error(`[OCPP-WATCH] ${mac} bağlanamadı:`, e.message);
    }
  }

  async function activationLoop(watcher) {
    while (!watcher.stopped) {
      const due = [...watcher.devices.values()].filter((e) =>
        (e.phase === "queued") || ((e.phase === "offline" || e.phase === "occupied") && Date.now() >= e.retryAt));
      if (due.length === 0) { await sleep(2000); continue; }
      const queue = [...due];
      await Promise.all(Array.from({ length: Math.min(ACTIVATE_CONCURRENCY, queue.length) }, async () => {
        while (queue.length && !watcher.stopped) await activate(watcher, queue.shift());
      }));
    }
  }

  // Tüm izlenen oturumların yeni satırlarını tek responses.json okumasıyla toplar
  async function readTick() {
    const watching = [];
    for (const w of watchers.values()) {
      if (w.stopped) continue;
      for (const e of w.devices.values()) if (e.phase === "watching") watching.push(e);
    }
    if (watching.length === 0) return;
    let responses;
    try { responses = (await readResponses()).responses; } catch { return; }
    const now = Date.now();
    for (const e of watching) {
      const resp = responses[e.sessionId];
      const m = firstMessage(resp);
      const sig = signatureOf(m);
      if (sig !== e.lastSig) {
        e.lastSig = sig;
        if (m && Number(m.cmd) === 3 && Number(m.msg) === 28) {
          for (const line of String(m.data ?? "").split(/\r?\n/)) if (line.trim()) ocppLive.add(e.mac, line);
        } else if (m && Number(m.cmd) === 2 && Number(m.msg) === 25 && m.data != null) {
          onStatus?.(e.device, true, String(m.data));
        }
      }
      if (now - (e.touchedAt || 0) > TOUCH_MS) { touchSlot(e.sessionId); e.touchedAt = now; }
    }
  }

  async function stopWatcher(company, reason) {
    const w = watchers.get(company);
    if (!w || w.stopped) return;
    w.stopped = true;
    watchers.delete(company);
    const entries = [...w.devices.values()];
    const withLog = entries.filter((e) => e.logOn);
    await Promise.all(withLog.map((e) => sendFrame(e.sessionId, "frame 3 28 0").catch(() => {})));
    if (withLog.length) await sleep(SLOT_CLEAR_MSG_INTERVAL + 100); // köprü 3 28 0'ı okusun
    for (const e of entries) {
      bySession.delete(e.sessionId);
      await removeSlot(e.sessionId).catch(() => {});
      ocppLive.clear(e.mac);
    }
    console.log(`[OCPP-WATCH] ${company} izleme durdu (${reason}); ${withLog.length} cihaza 3 28 0 gönderildi`);
  }

  function start(company) {
    const devices = getDevices({ company }).filter((d) => d.mac).slice(0, MAX_DEVICES);
    const w = { company, viewers: new Map(), devices: new Map(), stopped: false };
    for (const device of devices) {
      const sessionId = `${SESSION_PREFIX}${slug(company)}:${compactMac(device.mac)}`;
      const entry = { mac: device.mac, device, sessionId, phase: "queued", retryAt: 0, lastSig: null, logOn: false };
      w.devices.set(device.mac, entry);
      bySession.set(sessionId, { watcher: w, entry });
    }
    watchers.set(company, w);
    console.log(`[OCPP-WATCH] ${company} izleme başladı (${devices.length} cihaz)`);
    activationLoop(w).catch((e) => console.error("[OCPP-WATCH] döngü hatası:", e));
    return w;
  }

  const timer = setInterval(() => {
    readTick().catch(() => {});
    const now = Date.now();
    for (const [company, w] of watchers) {
      for (const [viewer, seen] of w.viewers) if (now - seen > IDLE_MS) w.viewers.delete(viewer);
      if (w.viewers.size === 0) stopWatcher(company, "izleyen kalmadı").catch(() => {});
    }
  }, READ_TICK_MS);
  timer.unref?.();

  return {
    isWatchSession: (sessionId) => SESSION_RE.test(String(sessionId || "")),
    // Sayfa her akış isteğinde çağırır — izleyici yoksa başlatır, varsa canlı tutar
    ensure(company, viewerId) {
      const w = watchers.get(company) || start(company);
      w.viewers.set(viewerId, Date.now());
      return w;
    },
    // Sayfadan çıkış: bu izleyici ayrılır; kimse kalmadıysa izleme hemen kapanır
    async leave(company, viewerId) {
      const w = watchers.get(company);
      if (!w) return;
      w.viewers.delete(viewerId);
      if (w.viewers.size === 0) await stopWatcher(company, "sayfadan çıkıldı");
    },
    // Gerçek kullanıcı cihaza bağlanmadan önce: 3 28 0, sonra slot bırakılır
    async release(sessionId) {
      const hit = bySession.get(sessionId);
      if (!hit) { await removeSlot(sessionId).catch(() => {}); return; }
      const { entry } = hit;
      if (entry.logOn) {
        await sendFrame(sessionId, "frame 3 28 0").catch(() => {});
        await sleep(SLOT_CLEAR_MSG_INTERVAL + 100);
        entry.logOn = false;
      }
      await removeSlot(sessionId).catch(() => {});
      entry.phase = "occupied";
      entry.retryAt = Date.now() + RETRY_MS;
    },
    state(company) {
      const w = watchers.get(company);
      if (!w) return null;
      const counts = {};
      for (const e of w.devices.values()) counts[e.phase] = (counts[e.phase] || 0) + 1;
      return { total: w.devices.size, ...counts };
    },
    stopAll: () => Promise.all([...watchers.keys()].map((c) => stopWatcher(c, "kapanış"))),
    _stopTimer: () => clearInterval(timer),
  };
}

module.exports = { initOcppWatch, OCPP_WATCH_SESSION_RE: SESSION_RE };
