/*
 * Kayıtlı log arşivinin otomatik çekimi (frame 3 30 1 — "Günlük log").
 *
 * Yazılımı MIN_VERSION ve üzeri olan cihazlar, son başarılı çekimin üzerinden
 * INTERVAL_MS geçince sırayla çekilir:
 *   1) cihaz başka bir oturumda açıksa atlanır (kullanıcı önceliklidir),
 *   2) "archive:<MAC>" oturumuyla bağlanılır, ESP aktif beklenir,
 *   3) şarj durumu okunur (frame 2 25 0) — şarj veriyorsa çekim ertelenir,
 *   4) "frame 3 30 1" gönderilir; msg 30 ilerleme satırları "% 100 ...
 *      tamamlandı" olana kadar izlenir, sonra bağlantı bırakılır.
 * Başarısız / ertelenen cihaz RETRY_MS sonra yeniden denenir.
 *
 * Sürüm kontrolü: cihaz sonradan güncellenip MIN_VERSION'a ulaşabilir.
 * Veritabanındaki sürüm her taramada yeniden okunduğu için OTA ya da ESP
 * okumasıyla güncellenen cihaz kendiliğinden listeye girer. Panel dışından
 * güncellenmiş olabilecek cihazlar için, sürümü uygun görünmeyen her cihazın
 * yazılım sürümü (id 33) VERSION_CHECK_MS'de bir ESP'den okunup veritabanına
 * yazılır; uygun çıkarsa aynı taramada çekilir.
 *
 * Elle yapılan çekimler de kaydedilir: observe() responses.json'daki yeni
 * "tamamlandı" satırını görünce o oturumun cihazına "manual" çekim yazar.
 * Gerçek bir kullanıcı çekim sürerken cihaza bağlanırsa server.js release()
 * çağırır; çekim yarıda bırakılır ve sonra yeniden denenir.
 */

const SESSION_PREFIX = "archive:";
const SESSION_RE = /^archive:/;
const MIN_VERSION = [4, 1, 7];
const INTERVAL_MS = 6 * 60 * 60 * 1000;   // başarılı çekimler arası
const RETRY_MS = 30 * 60 * 1000;          // şarjda / çevrimdışı / meşgul → yeniden deneme
const TICK_MS = 5 * 60 * 1000;            // vadesi gelen cihaz taraması
const FIRST_TICK_MS = 2 * 60 * 1000;      // sunucu açıldıktan sonra ilk tarama
const VERSION_CHECK_MS = 24 * 60 * 60 * 1000; // uygun olmayan cihazın sürümü bu sıklıkla okunur
const VERSION_CHECKS_PER_TICK = 6;             // bir taramada en fazla bu kadar cihaz
const ACTIVATE_WAIT_SEC = 20;
const STATUS_READ_POLLS = 4;
const POLL_MS = 1500;
const PROGRESS_POLL_MS = 2000;
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;    // bu süre ilerleme gelmezse vazgeçilir
const TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const compactMac = (mac) => String(mac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();

// "v@4.1.7", "V@4.2.4(reset )", "v@4.0.4 fd1" → [4, 1, 7]; sürüm okunamazsa null
function parseVersion(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

function isEligibleVersion(v) {
  const p = parseVersion(v);
  if (!p) return false;
  for (let i = 0; i < 3; i++) if (p[i] !== MIN_VERSION[i]) return p[i] > MIN_VERSION[i];
  return true;
}

// "sid=30668 % 100.0 | indirme ve çözümleme tamamlandı | segment=1 kayıt=288 ..."
function parseProgress(data) {
  const text = String(data || "");
  const pct = text.match(/%\s*(\d+(?:[.,]\d+)?)/);
  if (!pct) {
    if (/^ERR/i.test(text)) return { percent: null, done: false, failed: true, status: text, detail: "" };
    return null;
  }
  const percent = Math.min(100, parseFloat(pct[1].replace(",", ".")));
  const segments = text.split("|").map((x) => x.trim());
  const status = segments[1] || "";
  const done = percent >= 100 || /tamamland/i.test(status);
  const failed = !done && /hata|başarısız|error|fail|iptal/i.test(status);
  return { percent, done, failed, status, detail: segments.slice(2).join(" · ") };
}

function messagesOf(resp) {
  const m = resp?.message_response;
  if (Array.isArray(m)) return m.filter((x) => x && typeof x === "object");
  return m && typeof m === "object" ? [m] : [];
}
const signatureOf = (msgs) => msgs.map((m) => `${m.cmd}|${m.msg}|${m.time}|${m.data}`).join("\n");

function initArchiveAutoPull(deps) {
  const {
    readTarget, writeJsonRaw, withLock, TARGET_PATH, deactivateThenActivateForSlot, removeSlot, touchSlot,
    readResponses, getDevices, getArchivePull, recordArchivePull, getDeviceLiveState,
    markVersionCheck, updateDeviceVersion,
    SLOT_CLEAR_MSG_INTERVAL = 1500, log = console, timing = {},
  } = deps;
  const T = {
    PROGRESS_POLL_MS, IDLE_TIMEOUT_MS, TOTAL_TIMEOUT_MS, ACTIVATE_WAIT_SEC, POLL_MS, ...timing,
  };

  let current = null;     // şu an çekilen cihaz { mac, sessionId, released }
  let running = false;
  let stopped = false;
  const lastSig = new Map(); // elle çekim gözlemi: sessionId -> son mesaj imzası

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
    const topic = compactMac(String(resp?.status_response?.topic || "").split("/")[0]);
    if (topic && topic !== compactMac(mac)) return false;
    return String(resp?.status_response?.data || "").toLowerCase().includes("esp aktif");
  };

  const occupantOf = async (mac, sessionId) => {
    const target = await readTarget();
    return target.requests.find((r) => compactMac(r.target) === compactMac(mac) && r.control === "activate" && r.session_id !== sessionId) || null;
  };

  const isCharging = (raw) => /CHARGING/i.test(String(raw || "")) && !/CHARGE_ENDED/i.test(String(raw || ""));

  async function pullOne(device) {
    const mac = device.mac;
    const sessionId = `${SESSION_PREFIX}${compactMac(mac)}`;
    const record = (result, detail = null) => recordArchivePull({ mac, result, source: "auto", detail });

    const occ = await occupantOf(mac, sessionId);
    if (occ) {
      // Toplu Okuma şeritleri birkaç saniyede bırakır — kayıt düşmeden sonraki taramada denenir
      if (!/^status:/.test(occ.session_id)) record("busy");
      return "busy";
    }

    const job = { mac, sessionId, released: false };
    current = job;
    try {
      await deactivateThenActivateForSlot(sessionId, mac);
      touchSlot(sessionId);
      let active = false;
      for (let i = 0; i < T.ACTIVATE_WAIT_SEC && !job.released && !stopped; i++) {
        await sleep(1000);
        if (espActive((await readResponses()).responses[sessionId], mac)) { active = true; break; }
      }
      if (job.released || stopped) { record("interrupted"); return "interrupted"; }
      if (!active) { record("offline"); return "offline"; }

      // Şarj veriyorsa çekim ertelenir
      await sendFrame(sessionId, "frame 2 25 0");
      let raw = null;
      for (let i = 0; i < STATUS_READ_POLLS && !job.released; i++) {
        await sleep(T.POLL_MS);
        const m = messagesOf((await readResponses()).responses[sessionId])
          .find((x) => Number(x.cmd) === 2 && Number(x.msg) === 25 && x.data != null);
        if (m) { raw = String(m.data); break; }
      }
      if (job.released) { record("interrupted"); return "interrupted"; }
      const charging = raw != null ? isCharging(raw) : getDeviceLiveState?.(mac)?.state === "charging";
      if (charging) { record("charging"); return "charging"; }

      let sig = signatureOf(messagesOf((await readResponses()).responses[sessionId]));
      await sendFrame(sessionId, "frame 3 30 1");
      const startedAt = Date.now();
      let lastProgressAt = startedAt;
      let lastDetail = null;
      while (!job.released && !stopped) {
        await sleep(T.PROGRESS_POLL_MS);
        const now = Date.now();
        const msgs = messagesOf((await readResponses()).responses[sessionId]);
        const nextSig = signatureOf(msgs);
        if (nextSig !== sig) {
          sig = nextSig;
          for (const m of msgs) {
            if (Number(m.cmd) !== 3 || Number(m.msg) !== 30) continue;
            const p = parseProgress(m.data);
            if (!p) continue;
            lastProgressAt = now;
            lastDetail = p.detail || lastDetail;
            if (p.done) { record("ok", p.detail || null); return "ok"; }
            if (p.failed) { record("failed", p.status); return "failed"; }
          }
        }
        if (now - lastProgressAt > T.IDLE_TIMEOUT_MS || now - startedAt > T.TOTAL_TIMEOUT_MS) {
          record("timeout", lastDetail);
          return "timeout";
        }
        if (now - startedAt > 60 * 1000) touchSlot(sessionId);
      }
      record("interrupted");
      return "interrupted";
    } catch (e) {
      log.error?.(`[ARCHIVE-AUTO] ${mac} hata:`, e.message);
      record("failed", e.message);
      return "failed";
    } finally {
      if (current === job) current = null;
      if (!job.released) await removeSlot(sessionId).catch(() => {});
    }
  }

  // Cihaza kısa bağlanıp yazılım sürümünü (id 33) okur ve veritabanına yazar
  async function checkVersion(device) {
    const mac = device.mac;
    const sessionId = `${SESSION_PREFIX}${compactMac(mac)}`;
    if (await occupantOf(mac, sessionId)) return "busy"; // sonraki taramada denenir
    const job = { mac, sessionId, released: false };
    current = job;
    try {
      await deactivateThenActivateForSlot(sessionId, mac);
      touchSlot(sessionId);
      let active = false;
      for (let i = 0; i < T.ACTIVATE_WAIT_SEC && !job.released && !stopped; i++) {
        await sleep(1000);
        if (espActive((await readResponses()).responses[sessionId], mac)) { active = true; break; }
      }
      if (job.released || stopped) return "interrupted";
      markVersionCheck(mac);
      if (!active) return "offline";
      await sendFrame(sessionId, "frame 2 33 0");
      for (let i = 0; i < STATUS_READ_POLLS && !job.released; i++) {
        await sleep(T.POLL_MS);
        const m = messagesOf((await readResponses()).responses[sessionId])
          .find((x) => Number(x.cmd) === 2 && Number(x.msg) === 33 && x.data != null && String(x.data).trim() && !/^SET\b/i.test(String(x.data)));
        if (m) {
          const version = String(m.data).trim();
          if (version !== String(device.sw_version || "").trim()) {
            updateDeviceVersion(mac, { sw_version: version });
            log.log?.(`[ARCHIVE-AUTO] ${mac} sürüm güncellendi: "${device.sw_version || ""}" → "${version}"`);
          }
          return isEligibleVersion(version) ? "eligible" : "checked";
        }
      }
      return "no-answer";
    } catch (e) {
      log.error?.(`[ARCHIVE-AUTO] ${mac} sürüm okunamadı:`, e.message);
      return "failed";
    } finally {
      if (current === job) current = null;
      if (!job.released) await removeSlot(sessionId).catch(() => {});
    }
  }

  // Sürümü uygun görünmeyen ve sürümü VERSION_CHECK_MS'den beri okunmamış cihazlar
  function versionCheckDue(now = Date.now()) {
    return getDevices({}).filter((d) => {
      if (!d.mac || isEligibleVersion(d.sw_version)) return false;
      const at = getArchivePull(d.mac)?.last_version_check_at;
      return !at || now - Date.parse(at) >= VERSION_CHECK_MS;
    }).slice(0, VERSION_CHECKS_PER_TICK);
  }

  // Vadesi gelen cihazlar: sürümü uygun, son başarılı çekim INTERVAL_MS'den eski,
  // son deneme RETRY_MS'den eski
  function dueDevices(now = Date.now()) {
    return getDevices({}).filter((d) => {
      if (!d.mac || !isEligibleVersion(d.sw_version)) return false;
      const rec = getArchivePull(d.mac);
      const lastOk = rec?.last_success_at ? Date.parse(rec.last_success_at) : 0;
      if (now - lastOk < INTERVAL_MS) return false;
      const lastTry = rec?.last_attempt_at ? Date.parse(rec.last_attempt_at) : 0;
      return now - lastTry >= RETRY_MS;
    });
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const due = dueDevices();
      if (due.length) log.log?.(`[ARCHIVE-AUTO] ${due.length} cihazın günlük logu çekilecek`);
      for (const device of due) {
        if (stopped) break;
        const result = await pullOne(device);
        log.log?.(`[ARCHIVE-AUTO] ${device.mac} (${device.sw_version}) → ${result}`);
      }
      // Sonradan güncellenmiş olabilecek cihazlar: sürümü oku, uygunsa hemen çek
      for (const device of versionCheckDue()) {
        if (stopped) break;
        const result = await checkVersion(device);
        if (result === "eligible") {
          const fresh = dueDevices().find((d) => compactMac(d.mac) === compactMac(device.mac));
          if (fresh) {
            const pulled = await pullOne(fresh);
            log.log?.(`[ARCHIVE-AUTO] ${fresh.mac} (${fresh.sw_version}) → ${pulled}`);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  // Elle çekim gözlemi — readResponses her çağrıldığında
  function observe(data) {
    const responses = data?.responses;
    if (!responses || typeof responses !== "object") return;
    const done = [];
    for (const [sessionId, resp] of Object.entries(responses)) {
      if (SESSION_RE.test(sessionId)) continue; // otomatik çekim kendi sonucunu yazar
      const msgs = messagesOf(resp);
      const sig = signatureOf(msgs);
      const prev = lastSig.get(sessionId);
      lastSig.set(sessionId, sig);
      if (prev === undefined || prev === sig) continue;
      for (const m of msgs) {
        if (Number(m.cmd) !== 3 || Number(m.msg) !== 30) continue;
        const p = parseProgress(m.data);
        if (p?.done) done.push({ sessionId, topic: String(resp?.status_response?.topic || ""), detail: p.detail || null });
      }
    }
    for (const id of lastSig.keys()) if (!(id in responses)) lastSig.delete(id);
    if (!done.length) return;
    readTarget().then((target) => {
      for (const { sessionId, topic, detail } of done) {
        const slot = target.requests.find((r) => r.session_id === sessionId && r.control === "activate");
        const mac = compactMac(slot?.target);
        if (mac.length !== 12) continue;
        if (topic && compactMac(topic.split("/")[0]) !== mac) continue;
        recordArchivePull({ mac: slot.target, result: "ok", source: "manual", detail });
      }
    }).catch(() => {});
  }

  const firstTimer = setTimeout(() => tick().catch(() => {}), FIRST_TICK_MS);
  const timer = setInterval(() => tick().catch(() => {}), TICK_MS);
  firstTimer.unref?.();
  timer.unref?.();

  return {
    isArchiveSession: (sessionId) => SESSION_RE.test(String(sessionId || "")),
    observe,
    tick,
    // Kullanıcı cihaza bağlanmadan önce: çekim yarıda bırakılır, slot boşaltılır
    async release(sessionId) {
      if (current?.sessionId === sessionId) current.released = true;
      await removeSlot(sessionId).catch(() => {});
    },
    status(mac) {
      const device = getDevices({}).find((d) => compactMac(d.mac) === compactMac(mac));
      const rec = getArchivePull(mac) || getArchivePull(device?.mac) || null;
      const lastOk = rec?.last_success_at ? Date.parse(rec.last_success_at) : null;
      const eligible = isEligibleVersion(device?.sw_version);
      return {
        swVersion: device?.sw_version || null,
        autoEligible: eligible,
        minVersion: MIN_VERSION.join("."),
        intervalHours: INTERVAL_MS / 3600000,
        lastSuccessAt: rec?.last_success_at || null,
        lastSource: rec?.last_source || null,
        lastDetail: rec?.last_detail || null,
        lastAttemptAt: rec?.last_attempt_at || null,
        lastResult: rec?.last_result || null,
        // Son başarılı çekim bir periyot (+1 saat pay) içindeyse arşiv eşit sayılır
        synced: lastOk != null && Date.now() - lastOk <= INTERVAL_MS + 60 * 60 * 1000,
        running: current ? compactMac(current.mac) === compactMac(mac) : false,
      };
    },
    stop() { stopped = true; clearTimeout(firstTimer); clearInterval(timer); },
  };
}

module.exports = { initArchiveAutoPull, isEligibleVersion, parseVersion, parseProgress, ARCHIVE_SESSION_RE: SESSION_RE };
