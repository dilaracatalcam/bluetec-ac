/* ═══════════════════════════════════════════════════════════════
   Toplu Okuma — şirket bazlı canlı cihaz durumu panosu

   Toplu Güncelleme/Parametre'den farklı: bu bir "iş" değil, SÜREKLİ
   ÇALIŞAN salt-okunur bir izleme. Bir şirketin sayfası açık olduğu
   sürece (bkz. ensureWatching — her GET isteği "hâlâ birisi bakıyor"
   der), arka planda o şirketin TÜM cihazlarını N paralel şeritle sırayla
   dolaşıp (bağlan → id 25 oku → bağlantıyı kes) canlı durumu
   device_live_status tablosuna yazar. Kimse bakmıyorsa (WATCH_IDLE_
   TIMEOUT_MS boyunca istek gelmezse) döngü kendiliğinden durur —
   gereksiz yere cihazlara sürekli bağlanıp kaynak tüketmesin.

   Bu, Toplu Güncelleme'deki güvenlik-kritik şarj kontrolünden FARKLI bir
   amaç taşıyor — burada hiçbir komut gönderilmiyor, sadece görüntüleniyor.
   Bu yüzden çift okuma/tutarlılık kontrolü gibi ekstra katmanlar yok;
   yanlış bir okumanın bedeli sadece ekranda bir an yanlış görünmesi,
   fiziksel bir sonucu yok. ═══════════════════════════════════════════ */

const LANE_COUNT = 4;                 // aynı anda kaç cihaza bağlanılsın
const ACTIVATE_WAIT_SEC = 20;         // "aktif mi" için tek deneme, kısa (sadece görüntüleme)
const READ_POLLS = 8;                 // id 25 cevabı için deneme sayısı (~12sn)
const READ_POLL_MS = 1500;
// Maks. Güç (id 4) normal bir parametre — id 25'in aksine (pasif telemetri,
// sadece durum DEĞİŞİNCE kendiliğinden yayınlanıyor) bir "oku" isteğine
// hemen cevap veriyor, bu yüzden çok daha kısa bir bütçe yeterli.
const POWER_READ_POLLS = 4;
const WATCH_IDLE_TIMEOUT_MS = 45 * 1000; // bu süre boyunca kimse istemezse döngü durur
// Canlı OCPP konsolu açıkken her cihazda 3 28 3 ile bu kadar süre log toplanır,
// çıkarken 3 28 0 gönderilir. Konsol kapalıyken tur süresi uzamasın diye yapılmaz.
const LIVE_LOG_DWELL_MS = 10 * 1000;
const LIVE_LOG_POLL_MS = 250;
const LIVE_LOG_IDLE_MS = 20 * 1000;   // konsol bu süre istek atmazsa toplama kapanır
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cihazın gönderdiği ham durum kodları — firmware'deki switch(currentState)
// case'leriyle BİREBİR aynı: P1_IDLE, P2_PLUG_IN (soket takılı DEĞİL),
// P3_SCAN_RFID (soket takılı, şarj yok — RFID bekleniyor), P4_CHARGING,
// P5_CHARGE_ENDED (şarj bitti, soket hâlâ takılı), P6_ERR. Eskiden "PLUG"
// geçen her kod (P2_PLUG_IN) yanlışlıkla "takılı, şarj etmiyor" sayılıyordu —
// asıl "takılı, şarj etmiyor" durumu P3_SCAN_RFID'dir, P2 tam tersine soketin
// TAKILI OLMADIĞI anlamına gelir.
function classify(espActive, raw) {
  if (!espActive) return { state: "offline", label: "Çevrimdışı" };
  const v = String(raw || "").toUpperCase();
  if (v.includes("CHARGE_END")) return { state: "charge_ended", label: "Şarj Bitti, Soket Takılı" };
  if (v.includes("CHARGING")) return { state: "charging", label: "Şarj Oluyor" };
  if (v.includes("SCAN_RFID")) return { state: "waiting_rfid", label: "Soket Takılı, Şarj Yok" };
  if (v.includes("PLUG_IN")) return { state: "not_plugged", label: "Soket Takılı Değil" };
  if (v.includes("ERR")) return { state: "error", label: "Hata" };
  if (v.includes("IDLE")) return { state: "idle", label: "Boşta" };
  if (!v) return { state: "unknown", label: "Bilinmiyor" };
  return { state: "idle", label: "Boşta" };
}

function initDeviceStatusPoll(deps) {
  const {
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, touchSlot, getDevices, withLock,
    onOcppLine,
  } = deps;
  const dbFns = require("./db");
  const normalizeMac = (value) => String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  const pollingDevices = new Map();

  // withLock ŞART — bkz. server.js'teki aynı gerekçe: kilitsiz "oku→değiştir→
  // yaz" dizisi paralel şeritler arasında kayıp güncelleme yaratır.
  const sendFrame = async (sessionId, frame) => {
    await withLock(TARGET_PATH, async () => {
      const data = await readTarget();
      const slot = findOrCreateSlot(data.requests, sessionId, "");
      slot.send_message = frame;
      await writeJsonRaw(TARGET_PATH, data);
    });
    touchSlot(sessionId);
    setTimeout(async () => {
      try {
        await withLock(TARGET_PATH, async () => {
          const d = await readTarget();
          const s = d.requests.find((r) => r.session_id === sessionId);
          if (s && s.send_message === frame) { s.send_message = ""; await writeJsonRaw(TARGET_PATH, d); }
        });
      } catch {}
    }, 1500);
  };
  const sendRead = (sessionId, varId) => sendFrame(sessionId, `frame 2 ${varId} 0`);

  const getEspState = async (sessionId, mac) => {
    const pythonRunning = await isPythonRunning();
    if (!pythonRunning) return "nonactive";
    const responses = await readResponses();
    const myResp = responses.responses[sessionId];
    const topic = (myResp?.status_response?.topic || "").toUpperCase();
    const topicMatches = !topic || topic.startsWith(mac.toUpperCase());
    const statusText = topicMatches ? (myResp?.status_response?.data || "").toLowerCase() : "";
    if (statusText.includes("esp aktif")) return "active";
    return "nonactive";
  };

  // Tek bir varId oku — id 25 (şarj durumu) ve id 4 (Maks. Güç) için ortak.
  // Sıralı (art arda, aynı anda değil) çağrılıyor: message_response tek bir
  // yuva (dizi değil) olabiliyor ve her yeni cevapla ÜZERİNE YAZILIYOR (bkz.
  // ota-bulk-jobs.js'teki aynı kök neden) — iki farklı varId'yi PARALEL
  // okumaya kalksak biri diğerinin cevabını ezebilirdi.
  const readValue = async (sessionId, varId, polls) => {
    await sendRead(sessionId, varId);
    for (let i = 0; i < polls; i++) {
      await sleep(READ_POLL_MS);
      const responses = await readResponses();
      const m = responses.responses[sessionId]?.message_response;
      const msgs = Array.isArray(m) ? m : (m ? [m] : []);
      const found = msgs.find((x) => Number(x.cmd) === 2 && Number(x.msg) === varId && x.data !== undefined && x.data !== null);
      if (found) return String(found.data);
    }
    return null;
  };
  const readCharge = (sessionId) => readValue(sessionId, 25, READ_POLLS);
  const readMaxPower = (sessionId) => readValue(sessionId, 4, POWER_READ_POLLS);

  // 3 28 3 açıkken message_response her yeni log satırıyla üzerine yazılır;
  // imza değiştikçe satır sayılır (bkz. device-log-stream.js aynı yöntem).
  const collectOcppLines = async (sessionId, mac, ms) => {
    const sigOf = (m) => (m ? `${m.cmd}|${m.msg}|${m.time}|${m.data}` : "");
    const first = (resp) => {
      const m = resp?.message_response;
      return Array.isArray(m) ? m[0] || null : (m && typeof m === "object" ? m : null);
    };
    let lastSig = sigOf(first((await readResponses()).responses[sessionId]));
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await sleep(LIVE_LOG_POLL_MS);
      let m;
      try { m = first((await readResponses()).responses[sessionId]); } catch { continue; }
      const sig = sigOf(m);
      if (sig === lastSig) continue;
      lastSig = sig;
      if (!m || Number(m.cmd) !== 3 || Number(m.msg) !== 28) continue;
      for (const line of String(m.data ?? "").split(/\r?\n/)) {
        if (line.trim()) onOcppLine?.(mac, line);
      }
    }
  };

  // Bu izleyici SÜREKLİ çalıştığı için (tek seferlik bir iş değil), gerçek
  // bir kullanıcının o an bağlı olduğu bir cihaza asla KOMUT göndermemeli —
  // meşgulse bağlanmayı denemeden bu turu atlıyoruz. Ama bunun bedeli, o
  // cihazın Toplu Okuma'da dakikalarca (meşguliyet sürdüğü sürece) BAYAT
  // veri göstermesi olmasın diye: meşgul oturumun zaten yaptığı okumaları
  // (kendi message/status_response'u) PASİF olarak — hiçbir şey yazmadan —
  // gözlemleyip yakalayabilirsek cache'i onunla tazeliyoruz (bkz. peekOccupiedState).
  const findOccupyingSession = async (sessionId, mac) => {
    const target = await readTarget();
    const occ = target.requests.find((r) => r.target === mac && r.control === "activate" && r.session_id !== sessionId);
    return occ ? occ.session_id : null;
  };

  const peekOccupiedState = async (occupierSessionId, mac) => {
    const responses = await readResponses();
    const resp = responses.responses[occupierSessionId];
    if (!resp) return null;
    const topic = (resp.status_response?.topic || "").toUpperCase();
    const topicMatches = !topic || topic.startsWith(mac.toUpperCase());
    const statusText = topicMatches ? (resp.status_response?.data || "").toLowerCase() : "";
    const active = statusText.includes("esp aktif");
    const m = resp.message_response;
    const msgs = Array.isArray(m) ? m : (m ? [m] : []);
    const found = msgs.find((x) => Number(x.cmd) === 2 && Number(x.msg) === 25 && x.data !== undefined && x.data !== null);
    return { active, raw: found ? String(found.data) : undefined };
  };

  async function pollOne(sessionId, device, { liveLogs = false } = {}) {
    const pollingKey = normalizeMac(device.mac);
    let ocppLogOn = false;
    pollingDevices.set(pollingKey, (pollingDevices.get(pollingKey) || 0) + 1);
    try {
      const occupierSessionId = await findOccupyingSession(sessionId, device.mac);
      if (occupierSessionId) {
        try {
          const peek = await peekOccupiedState(occupierSessionId, device.mac);
          if (peek && peek.active && peek.raw !== undefined) {
            const { state, label } = classify(true, peek.raw);
            dbFns.upsertDeviceLiveStatus({
              mac: device.mac, company: device.company, location: device.location,
              deviceCode: device.device_code, state, label, raw: peek.raw,
              swVersion: device.sw_version, maxPower: null, // meşgulken Maks. Güç okunamıyor — önceki değer korunur
            });
          }
        } catch (e) {
          console.error(`[STATUS-POLL] ${device.mac} meşgul-gözlem hatası:`, e.message);
        }
        return;
      }

      try { await deactivateThenActivateForSlot(sessionId, device.mac); touchSlot(sessionId); } catch {}

      let active = false;
      for (let i = 0; i < ACTIVATE_WAIT_SEC; i++) {
        await sleep(1000);
        if ((await getEspState(sessionId, device.mac)) === "active") { active = true; break; }
      }

      let raw = null;
      let maxPower = null;
      if (active) {
        raw = await readCharge(sessionId);
        maxPower = await readMaxPower(sessionId);
        if (liveLogs && onOcppLine) {
          ocppLogOn = true;
          await sendFrame(sessionId, "frame 3 28 3");
          await collectOcppLines(sessionId, device.mac, LIVE_LOG_DWELL_MS);
        }
      }

      const { state, label } = classify(active, raw);
      dbFns.upsertDeviceLiveStatus({
        mac: device.mac, company: device.company, location: device.location,
        deviceCode: device.device_code, state, label, raw,
        swVersion: device.sw_version, maxPower,
      });
    } catch (e) {
      console.error(`[STATUS-POLL] ${device.mac} okuma hatası:`, e.message);
    } finally {
      // Cihazdan çıkmadan log modu kapatılır; köprü frame'i okusun diye kısa beklenir.
      if (ocppLogOn) {
        try { await sendFrame(sessionId, "frame 3 28 0"); await sleep(1600); } catch {}
      }
      const remaining = (pollingDevices.get(pollingKey) || 1) - 1;
      if (remaining > 0) pollingDevices.set(pollingKey, remaining);
      else pollingDevices.delete(pollingKey);
      try { await removeSlot(sessionId); } catch {}
    }
  }

  // company -> { lastRequestedAt }
  const activeLoops = new Map();

  // Genel Bakış için: tek bir şirket yerine TÜM cihazları dolaşan döngünün anahtarı.
  // Şirket döngüleriyle aynı şerit sayısını (LANE_COUNT) kullanır — şirket başına
  // ayrı döngü açıp köprüye 10×4 paralel bağlantı yüklememek için tek döngü.
  const ALL_COMPANIES = "tümü";
  const devicesFor = (company) => (company === ALL_COMPANIES ? getDevices({}) : getDevices({ company }));

  const manualQueues = new Map(); // company -> cihazlar (öncelikli manuel okumalar)
  const enqueueManual = (company, devices) => {
    const queue = manualQueues.get(company) || [];
    const queued = new Set(queue.map((d) => normalizeMac(d.mac)));
    for (const device of devices) {
      const key = normalizeMac(device.mac);
      if (key && !queued.has(key)) {
        queue.push(device);
        queued.add(key);
      }
    }
    manualQueues.set(company, queue);
  };
  const takeManual = (company) => {
    const queue = manualQueues.get(company);
    if (!queue?.length) return null;
    const device = queue.shift();
    if (queue.length === 0) manualQueues.delete(company);
    return device;
  };

  async function runCompanyLoop(company) {
    const isStillWatched = () => {
      const loop = activeLoops.get(company);
      return !!loop && (
        Date.now() - loop.lastRequestedAt <= WATCH_IDLE_TIMEOUT_MS ||
        (manualQueues.get(company)?.length || 0) > 0
      );
    };

    while (isStillWatched()) {
      const devices = devicesFor(company);
      if (devices.length === 0) { await sleep(5000); continue; }

      const queue = [...devices];
      const laneCount = Math.max(1, Math.min(LANE_COUNT, queue.length));
      const lane = async (laneIndex) => {
        await sleep(laneIndex * 800);
        const sessionId = `status:${company}:w${laneIndex}`;
        while (isStillWatched()) {
          let device = takeManual(company);
          if (device) {
            const duplicateIndex = queue.findIndex((item) => normalizeMac(item.mac) === normalizeMac(device.mac));
            if (duplicateIndex >= 0) queue.splice(duplicateIndex, 1);
          } else {
            device = queue.shift();
          }
          if (!device) {
            if ((manualQueues.get(company)?.length || 0) > 0) continue;
            break;
          }
          if (!device || !device.mac) continue;
          const loop = activeLoops.get(company);
          await pollOne(sessionId, device, { liveLogs: !!loop && Date.now() - (loop.liveLogsAt || 0) <= LIVE_LOG_IDLE_MS });
        }
      };
      await Promise.all(Array.from({ length: laneCount }, (_, i) => lane(i)));
    }

    activeLoops.delete(company);
    console.log(`[STATUS-POLL] ${company} için izleme durdu (kimse bakmıyor)`);
  }

  function ensureWatching(company, { liveLogs = false } = {}) {
    const existing = activeLoops.get(company);
    if (existing) {
      existing.lastRequestedAt = Date.now();
      if (liveLogs) existing.liveLogsAt = Date.now();
      return;
    }
    activeLoops.set(company, { lastRequestedAt: Date.now(), liveLogsAt: liveLogs ? Date.now() : 0 });
    console.log(`[STATUS-POLL] ${company} için izleme başladı`);
    runCompanyLoop(company).catch((e) => {
      console.error(`[STATUS-POLL] ${company} döngü hatası:`, e);
      activeLoops.delete(company);
    });
  }

  function requestRefresh(company, devices) {
    const list = Array.isArray(devices) ? devices.filter((device) => device?.mac) : [];
    enqueueManual(company, list);
    ensureWatching(company);
    return { queued: list.map((device) => device.id).filter((id) => id !== undefined && id !== null) };
  }

  // Henüz hiç okunmamış (ilk tur süren) cihazlar device_live_status'ta yok
  // diye ekrandan kaybolmasınlar — tüm cihaz listesini temel al, bilineni
  // üzerine bindir, bilinmeyeni "kontrol ediliyor" olarak göster.
  function getStatuses(company) {
    const known = dbFns.getDeviceLiveStatusForCompany(company);
    const knownByMac = new Map(known.map((r) => [r.mac, r]));
    const devices = getDevices({ company });
    return devices
      .map((d) => {
        const live = knownByMac.get(d.mac);
        // id ve sw_version HER ZAMAN devices tablosundan (güncel) alınır —
        // bir OTA güncellemesi sw_version'ı değiştirdiğinde canlı önbellek
        // henüz tazelenmemiş olsa bile bayat sürüm görünmesin (bkz.
        // db.js updateDeviceVersion). id, "Cihaza Bağlan" butonu için gerekli
        // (bkz. DeviceStatusBoard.jsx) — operatörden MAC gizlense de id kalır.
        const polling = (pollingDevices.get(normalizeMac(d.mac)) || 0) > 0;
        return live
          ? { ...live, id: d.id, sw_version: d.sw_version, polling }
          : {
              id: d.id, mac: d.mac, company: d.company, location: d.location || null,
              device_code: d.device_code, state: "checking", label: "Kontrol ediliyor",
              raw: null, updated_at: null, sw_version: d.sw_version, max_power: null, polling,
            };
      })
      .sort((a, b) => (a.location || "").localeCompare(b.location || "", "tr") || (a.mac || "").localeCompare(b.mac || ""));
  }

  return { ensureWatching, requestRefresh, getStatuses, ALL_COMPANIES };
}

module.exports = { initDeviceStatusPoll };
