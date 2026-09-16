/* ═══════════════════════════════════════════════════════════════
   Toplu Güncelleme (OTA firmware) — arka planda çalışan kalıcı iş kaydı

   Daha önce bu akış (bağlan → şarj kontrolü → OTA komutu gönder →
   indirme/yazma/doğrulama logunu izle) TAMAMEN TARAYICIDA
   (BulkUpdate.jsx) çalışıyordu — Toplu Parametre'nin eski hâliyle
   birebir aynı sorun: sekme kapanınca/sayfa değişince iş görünmez
   oluyordu, yenilenince TAMAMEN duruyordu.

   Şimdi aynı mantık BURADA, backend'de (server.js'in kendi process'i
   içinde) çalışıyor — bkz. bulk-jobs.js'teki aynı gerekçe. Panel sadece
   bir iş başlatıp durumunu SORAN bir izleyiciye dönüşüyor (bkz.
   GET /api/ota-bulk-jobs/:id). İlerleme SQLite'a yazılıyor.

   Zamanlama sabitleri (TIMING) ve akışın kendisi BulkUpdate.jsx'ten
   BİREBİR taşındı — gerçek log ölçümlerine göre kalibre edildikleri
   için değiştirilmedi (bkz. eski dosyadaki yorumlar).
   ═══════════════════════════════════════════════════════════════ */

const crypto = require("crypto");
const dbFns = require("./db");

const TIMING = {
  esp: {
    STUCK_TIMEOUT_MS: 120 * 1000,
    // %100'e ulaştıktan sonra ("flash'a yazıyor") için ayrı, çok daha cömert
    // eşik — sahada yazma 45sn-2dk+ sürebiliyor, indirme durmasıyla aynı
    // eşiği kullanmak erken "başarısız" yanlış pozitifine yol açıyordu.
    WRITE_TIMEOUT_MS: 8 * 60 * 1000,
    NO_ACTIVITY_GRACE_MS: 360 * 1000,
    PREPARE_TIMEOUT_MS: 240 * 1000,
    VERIFY_WINDOW_MS: 25 * 60 * 1000,
  },
  msp: {
    STUCK_TIMEOUT_MS: 60 * 1000,
    WRITE_TIMEOUT_MS: 5 * 60 * 1000,
    NO_ACTIVITY_GRACE_MS: 240 * 1000,
    PREPARE_TIMEOUT_MS: 120 * 1000,
    VERIFY_WINDOW_MS: 0,
  },
};

// Bir cihaz "noresponse"/"unverified" gibi yumuşak-bitmiş bir faza düştükten
// sonra orijinal (tarayıcı) sürüm sekme açık kaldığı sürece SONSUZA KADAR
// izlemeye devam ediyordu. Backend'de iş kalıcı olduğu için bir yerde
// durmak lazım — bu ekstra pencere dolunca o cihaz için izleme bırakılır
// (son bilinen durum DB'de kalır, iş diğer cihazlar biterse "done" olabilir).
const GIVE_UP_EXTRA_MS = { esp: 30 * 60 * 1000, msp: 10 * 60 * 1000 };

const ACTIVATE_WAITS = [60, 30, 30];
// Loglardan ölçüldü: bir ESP indirmesi (fw_*.bin, ~1.9MB) UÇTAN UCA ~5-6
// saniyede bitebiliyor, MSP (msp_*.txt, ~58KB) ~1 saniyede. Eskiden bu
// aralık 5 saniyeydi — yani koca bir indirmenin ömrü boyunca panel belki
// BİR kez örnekleme yapabiliyordu, rastgele bir yüzdede yakalayıp sonra
// doğrudan "bitti"ye atlıyordu ("anlık takip edemiyor" şikayeti buradan
// geliyordu). Alt saniyeye indirilerek indirme boyunca birkaç örnek
// alınabiliyor, ilerleme çubuğu gerçekten akıyormuş gibi görünür.
const MONITOR_INTERVAL_MS = 800;
const CHARGE_ATTEMPTS = 3;
const CHARGE_POLLS = 10;

const MONITORED_PHASES = ["waiting", "preparing", "downloading", "verifying", "noresponse", "unverified"];
const HARD_PHASES = ["success", "uptodate", "failed", "skipped"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// responses.json'daki her mesaj "2026-09-11 11:46:59" gibi damgasız-yerel-
// saat formatında bir "time" taşıyor (bkz. server.js örneği) — OTA log
// satırlarıyla AYNI biçim, aynı gerekçeyle aynı ofset varsayılıyor
// (bkz. ota-log-tailer.js LOG_TZ_OFFSET).
const RESPONSE_TZ_OFFSET = process.env.RESPONSE_TZ_OFFSET || "+03:00";
function parseResponseTime(str) {
  if (!str) return null;
  const ts = Date.parse(`${String(str).replace(" ", "T")}${RESPONSE_TZ_OFFSET}`);
  return Number.isNaN(ts) ? null : ts;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}sn`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}dk ${r}sn` : `${m}dk`;
}

/* jobId -> true : "Durdur"a basıldı — tetikleme kuyruğu bir sonraki cihaza
   geçmez, izleme döngüsü de bir sonraki turda çıkar. */
const stopRequested = new Set();

// Manuel "Tekrar Dene" ucuyla (server.js) AYNI kriter — otomatik tekrar da
// bunu kullanır (bkz. bulk-jobs.js'teki aynı desen).
const RETRYABLE_PHASES = ["failed", "skipped", "noresponse", "unverified"];

// jobId -> setTimeout handle — bkz. bulk-jobs.js'teki aynı mekanizma.
const autoRetryTimers = new Map();

function cancelAutoRetryTimer(jobId) {
  const handle = autoRetryTimers.get(jobId);
  if (handle) { clearTimeout(handle); autoRetryTimers.delete(jobId); }
}

function armAutoRetryTimer(jobId, delayMs, fireFn) {
  cancelAutoRetryTimer(jobId);
  const handle = setTimeout(() => {
    autoRetryTimers.delete(jobId);
    fireFn(jobId).catch((e) => console.error(`[OTA-BULK-JOB ${jobId}] otomatik tekrar hatası:`, e.message));
  }, Math.max(0, delayMs));
  autoRetryTimers.set(jobId, handle);
}

function initOtaBulkJobs(deps) {
  const {
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, RESPONSES_PATH, touchSlot, readUsers, withLock,
    getMacUpdateStatus, OTA_LOG_PATH,
  } = deps;

  // ── HTTP /api/send-command ile BİREBİR AYNI mantık (bkz. bulk-jobs.js
  // sendFrame) — temizleme SADECE hâlâ kendi frame'imiz duruyorsa yapılır,
  // aksi halde 1.5sn içinde art arda gönderilen bir sonraki komutu silebilir. */
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
  const sendSet = (sessionId, varId, value) => sendFrame(sessionId, `frame 1 ${varId} ${value}`);
  const sendRead = (sessionId, varId) => sendFrame(sessionId, `frame 2 ${varId} 0`);

  // sinceTs verilirse, "time" alanı bu andan (5sn tolerans payıyla) ÖNCE
  // olan mesajlar ELENİR — bkz. aşağıdaki uzun açıklama. sinceTs
  // verilmezse (ör. getEspState gibi "en son ne varsa onu göster" kullanım
  // yerlerinde) filtre uygulanmaz.
  const RESPONSE_STALE_MARGIN_MS = 5000;
  const getMessageResponses = async (sessionId, sinceTs) => {
    const data = await readResponses();
    const mine = data.responses[sessionId];
    if (!mine) return [];
    const m = mine.message_response;
    if (!m) return [];
    const arr = Array.isArray(m) ? m : [m];
    if (!sinceTs) return arr;
    return arr.filter((msg) => {
      const t = parseResponseTime(msg?.time);
      return t !== null && t >= sinceTs - RESPONSE_STALE_MARGIN_MS;
    });
  };

  /* ═══ KRİTİK GÜVENLİK DÜZELTMESİ ═══
     denek.py/uzak köprü message_response'u DİZİ değil TEK OBJE olarak
     yazıyor (en son mesaj neyse üstüne yazılıyor) — bkz. server.js
     /api/responses'taki aynı yorum. Bir şerit aynı session_id'yi ART ARDA
     birden fazla cihaz için kullandığından (bkz. runJob'daki lane), yeni
     bir cihaza bağlanınca bu yuvada hâlâ ÖNCEKİ cihazın (hatta bambaşka,
     dakikalar önceki bir isteğin) son mesajı duruyor olabilir.

     Sahada DOĞRULANDI: responses.json'da canlı olarak görüldü — aynı
     session'ın status_response'u "11:52:15" iken message_response'u hâlâ
     "11:46:59" idi (~5 dakika eski). Yerel dosyayı bağlanır bağlanmaz
     temizlemek (clearMessageResponse) TEK BAŞINA yeterli değildi — uzak
     köprü periyodik tam senkronizasyon push'larıyla bu yerel temizliği
     ezebiliyor (bkz. json_client.py receiver_loop, responses_update TÜM
     responses.json'ı üzerine yazıyor). Sonuç: şarj kontrolü (id 25) eski
     bir "şarj yok" cevabıyla eşleşip GERÇEKTEN şarj veren bir cihazda
     güncelleme başlatabiliyordu.

     Kalıcı çözüm: SADECE yerel temizlik değil, her okuma isteğinden hemen
     önce bir zaman damgası alıp (sinceTs), gelen cevabın "time" alanının
     bu andan SONRA olmasını ŞART koşmak — bkz. getMessageResponses'taki
     filtre. Böylece kaynağı ne olursa olsun (yerel kalıntı ya da uzaktan
     gelen eski önbellek) HER TÜRLÜ bayat mesaj güvenilir şekilde elenir.
     clearMessageResponse yine de korunuyor (ek güvenlik katmanı, zararı
     yok) ama artık TEK savunma hattı değil. */
  const clearMessageResponse = async (sessionId) => {
    try {
      await withLock(RESPONSES_PATH, async () => {
        const r = await readResponses();
        if (r.responses[sessionId]) {
          r.responses[sessionId].message_response = null;
          await writeJsonRaw(RESPONSES_PATH, r);
        }
      });
    } catch {}
  };

  // status_response.topic "{MAC}/status" biçiminde — message_response'un
  // aksine (o hiç cihaz kimliği taşımıyor) BURADA gerçekten doğrulama
  // yapabiliyoruz: cevap gerçekten şu an bağlanmaya çalıştığımız MAC'ten mi
  // geldi? Paralel çalışırken uzak sunucunun başka bir session'ın (başka
  // bir cihazın) durumunu bize sızdırma ihtimaline karşı gerçek bir
  // koruma — karşı sunucuya güvenmeden kendi başımıza doğrulayabildiğimiz
  // TEK alan bu.
  const getEspState = async (sessionId) => {
    const pythonRunning = await isPythonRunning();
    if (!pythonRunning) return "nonactive";
    const target = await readTarget();
    const mySlot = target.requests.find((r) => r.session_id === sessionId);
    const responses = await readResponses();
    const myResp = responses.responses[sessionId];
    const topic = (myResp?.status_response?.topic || "").toUpperCase();
    const expectedMac = (mySlot?.target || "").toUpperCase();
    const topicMatches = !expectedMac || !topic || topic.startsWith(expectedMac);
    const statusText = topicMatches ? (myResp?.status_response?.data || "").toLowerCase() : "";
    if (statusText.includes("esp aktif")) return "active";
    if (mySlot && mySlot.control === "activate" && !statusText.includes("esp pasif")) return "unknown";
    return "nonactive";
  };

  const waitSetOk = async (sessionId, varId, sinceTs, tries = 5) => {
    for (let i = 0; i < tries; i++) {
      await sleep(1000);
      const msgs = await getMessageResponses(sessionId, sinceTs);
      if (msgs.find((m) => Number(m.msg) === varId && m.data === "SET OK")) return true;
    }
    return false;
  };

  // Aynı MAC'i şu an BAŞKA bir session mı kullanıyor? (bkz. bulk-jobs.js
  // checkOccupancy — aynı gerekçe: gerçek kullanıcının/başka bir işin
  // bağlantısını ezmemek.)
  const checkOccupancy = async (sessionId, mac) => {
    const target = await readTarget();
    const occupant = target.requests.find((r) => r.target === mac && r.control === "activate" && r.session_id !== sessionId);
    if (!occupant) return null;

    // Occupant bulk:/ota: önekli sahte bir session ve sahibi iş artık
    // çalışmıyorsa (çökmüş/durmuş şerit) — bu KESİN yetim, zaman aşımı
    // beklemeden hemen temizle ve meşgul deme (bkz. db.js
    // isSyntheticSessionStale açıklaması).
    if (dbFns.isSyntheticSessionStale(occupant.session_id)) {
      console.log(`[OTA-BULK-JOB] yetim session temizlendi: ${occupant.session_id} (${mac} üzerinde takılı kalmış)`);
      try { await removeSlot(occupant.session_id); } catch {}
      return null;
    }

    try {
      const users = readUsers();
      const occupantUser = users.find((u) => u.username === occupant.session_id);
      return occupantUser?.fullName || occupant.session_id;
    } catch {
      return occupant.session_id;
    }
  };

  const fetchStatuses = (macEntries, kind) => getMacUpdateStatus({ logPath: OTA_LOG_PATH, macEntries, kind });

  /* ═══ GERÇEK KÖK NEDEN (sahada loglanan ham verilerle doğrulandı) ═══
     id 25 "0"/"1"/"2" değil, İSİMLİ durum kodları gönderiyor:
       "P4_CHARGING" = şarj oluyor, "P2_PLUG_IN" = soket takılı DEĞİL (asıl
       "takılı ama şarj etmiyor" durumu "P3_SCAN_RFID"tir — bkz. deviceValueMapping.js).
     Eski kontrol (`chargeStatus === "1"`) bu yüzden "P4_CHARGING"yi HİÇBİR
     ZAMAN yakalamıyordu — cihaz açıkça "ŞARJ OLUYOR" dese bile kod bunu
     "şarjda değil" sanıp devam ediyordu. Ayrıca id 25 anlık okuma isteğine
     cevap veren bir değer DEĞİL — cihazın durum DEĞİŞTİĞİNDE kendiliğinden
     yayınladığı pasif bir telemetri (bkz. "iki bağımsız okuma" denemesinde
     ikincisinin hep boş dönmesi — "oku" komutu yeni bir cevap tetiklemiyor).
     Bu yüzden "isteğimden SONRA gelmiş olmalı" şartı da gevşetildi: artık
     makul ölçüde güncel (son birkaç dakika) HERHANGİ bir bilinen değer
     kabul ediliyor, ama "ŞARJ" geçen HİÇBİR durum asla güvenli sayılmıyor. */
  const CHARGE_FRESHNESS_MS = 3 * 60 * 1000;
  const isChargingValue = (raw) => {
    const v = String(raw || "").toUpperCase();
    // "CHARG" değil "CHARGING" eşleşmeli — "P5_CHARGE_ENDED" (şarj BİTTİ)
    // gibi kodlar da "CHARG" içeriyor ama şu an şarj olmuyor demek; bunu
    // "şarjda" sayıp gereksiz yere engellememek için tam kelime arıyoruz.
    return v === "1" || v.includes("CHARGING");
  };

  const readChargeStatusOnce = async (sessionId, mac) => {
    let chargeStatus = null;
    let rawFound = null;
    for (let attempt = 1; attempt <= CHARGE_ATTEMPTS && chargeStatus === null; attempt++) {
      try { await sendRead(sessionId, 25); } catch {}
      for (let i = 0; i < CHARGE_POLLS; i++) {
        await sleep(1500);
        // Anlık okumaya cevap vermeyebilen pasif bir telemetri olduğu için
        // burada "isteğimden sonra" değil "makul ölçüde güncel" filtreleniyor.
        const msgs = await getMessageResponses(sessionId, Date.now() - CHARGE_FRESHNESS_MS);
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === 25 && m.data !== undefined && m.data !== null);
        if (found) { chargeStatus = String(found.data); rawFound = found; break; }
      }
    }
    console.log(`[CHARGE-CHECK] mac=${mac} sid=${sessionId} sonuç=${chargeStatus === null ? "OKUNAMADI" : chargeStatus} şarj_mı=${chargeStatus !== null ? isChargingValue(chargeStatus) : "-"} ham=${rawFound ? JSON.stringify(rawFound) : "yok"}`);
    return chargeStatus;
  };

  const confirmNotCharging = async (sessionId, mac) => readChargeStatusOnce(sessionId, mac);

  /* Cihaz ZATEN indiriyor mu? (bkz. eski BulkUpdate.jsx checkAlreadyActive —
     saat kaymasına karşı aynı korumalar.) */
  const checkAlreadyActive = async (mac, kind) => {
    const t = TIMING[kind];
    try {
      const statuses = await fetchStatuses([{ mac, since: Date.now() - t.STUCK_TIMEOUT_MS }], kind);
      const st = statuses[mac];
      if (!st) return null;
      if (st.clockSkew) return null;
      if (!st.hasStarted || !st.lastProgressAt) return null;
      const age = Date.now() - st.lastProgressAt;
      if (age < 0) return null;
      return age < t.STUCK_TIMEOUT_MS ? st : null;
    } catch { return null; }
  };

  /* Bağlanma (status_response) topic doğrulamalı — cevap yanlış cihazdan
     gelirse bunu YAKALAYIP reddedebiliyoruz (bkz. getEspState). Şarj
     kontrolü + komut gönderme (message_response) için aynı doğrulama
     mümkün değil (o alan hiç cihaz kimliği taşımıyor) — bu, teorik bir
     çapraz-karışma riski taşır ama sahada KANITLANMIŞ bir örneği yok;
     bulunan somut hatalar (yanlış değer eşleştirme, bayat mesaj, dar
     tazelik penceresi) düzeltildi ve tüm gözlemlenen belirtileri zaten
     açıklıyordu. Kullanıcı kararıyla tamamen paralel bırakıldı. */
  async function connectDevice(sessionId, mac, kind, setPhase) {
    let active = false;
    for (let attempt = 1; attempt <= ACTIVATE_WAITS.length && !active; attempt++) {
      if (attempt > 1) {
        const nowActive = await checkAlreadyActive(mac, kind);
        if (nowActive) return { started: true, percent: nowActive.percent ?? null };
      }

      const occupant = await checkOccupancy(sessionId, mac);
      if (occupant) {
        setPhase("connecting", { message: `Cihaz meşgul: ${occupant} — bekleniyor...` });
      } else {
        const waitSec = ACTIVATE_WAITS[attempt - 1];
        setPhase("connecting", {
          message: attempt === 1
            ? `Bağlanıyor — cihazın aktif olması bekleniyor (${waitSec}sn)...`
            : `Cihaz aktif değil, activate tekrar gönderiliyor (${attempt}/${ACTIVATE_WAITS.length})...`,
        });
        try { await deactivateThenActivateForSlot(sessionId, mac); touchSlot(sessionId); } catch {}
      }

      const waitSec = ACTIVATE_WAITS[attempt - 1];
      for (let i = 0; i < waitSec; i++) {
        await sleep(1000);
        if ((await getEspState(sessionId)) === "active") { active = true; break; }
      }
    }

    if (!active) {
      const totalSec = ACTIVATE_WAITS.reduce((a, b) => a + b, 0);
      setPhase("failed", { message: `Cihaz aktif olmadı (${ACTIVATE_WAITS.length} deneme, toplam ${totalSec}sn beklendi)` });
      try { await removeSlot(sessionId); } catch {}
      return { active: false };
    }
    return { active: true };
  }

  async function chargeCheckAndSend(sessionId, mac, otaType, setPhase) {
    // Bu cihaza dair HİÇBİR komut göndermeden önce — bkz. clearMessageResponse
    // tanımındaki açıklama (önceki cihazdan kalan mesaj yanlış okunabiliyordu).
    await clearMessageResponse(sessionId);

    // Şarj durumu (id 25) — güvenlik kriteri.
    setPhase("checking-charge", { message: "Şarj durumu kontrol ediliyor..." });
    const chargeStatus = await confirmNotCharging(sessionId, mac);

    if (chargeStatus === null) {
      setPhase("skipped", { message: "Şarj durumu okunamadı — güvenlik için atlandı" });
      try { await removeSlot(sessionId); } catch {}
      return { sent: false };
    }
    if (isChargingValue(chargeStatus)) {
      setPhase("skipped", { message: `Cihaz şu an şarj veriyor (${chargeStatus}) — güncellenmedi` });
      try { await removeSlot(sessionId); } catch {}
      return { sent: false };
    }

    // OTA tipi (31) + Güncellemeyi başlat (20). SET OK sadece bilgi amaçlı.
    setPhase("sending", { message: "Güncelleme komutu gönderiliyor..." });
    try {
      const t1 = Date.now();
      await sendSet(sessionId, 31, otaType);
      await waitSetOk(sessionId, 31, t1);
      const t2 = Date.now();
      await sendSet(sessionId, 20, "1");
      await waitSetOk(sessionId, 20, t2);
    } catch {}
    return { sent: true };
  }

  /* Bir cihazı tetikler: bağlan → şarj kontrolü → OTA tipi+başlat komutu →
     indirme başlayana kadar (üst sınırla) bekle. Döner: { triggeredAt } ya
     da null (bağlanamadı/şarjda/okunamadı — bu durumlarda iş bu cihaz için
     biter, izleme döngüsüne hiç girmez). */
  async function triggerDevice(jobId, sessionId, device, kind, otaType) {
    const mac = device.mac;
    const setPhase = (phase, patch = {}) => dbFns.updateOtaBulkJobDevice(jobId, mac, { phase, ...patch });
    const firstTriggeredAt = Date.now();

    const already = await checkAlreadyActive(mac, kind);
    if (already) {
      setPhase("downloading", {
        message: "Cihaz zaten indiriyor, bağlanılmadı — log izleniyor...",
        percent: already.percent ?? null,
      });
      return { triggeredAt: firstTriggeredAt };
    }

    // 1. BAĞLAN — paralel (topic doğrulamalı, güvenli).
    const conn = await connectDevice(sessionId, mac, kind, setPhase);
    if (conn.started) {
      setPhase("downloading", {
        message: "Cihaz indirmeye başladı, activate gönderilmiyor — log izleniyor...",
        percent: conn.percent ?? null,
      });
      return { triggeredAt: firstTriggeredAt };
    }
    if (!conn.active) return null;

    // 2. ŞARJ KONTROLÜ + KOMUT GÖNDER — kullanıcı isteğiyle tekrar paralel
    // (bkz. tartışma: session_id+MAC eşleşmesi zaten açık/belirsiz değil,
    // kanıtlanmış bir çapraz-karışma yoktu, sadece ihtimal olarak kilitlenmişti).
    const result = await chargeCheckAndSend(sessionId, mac, otaType, setPhase);
    if (!result.sent) return null;

    try { await removeSlot(sessionId); } catch {}

    setPhase("waiting", { message: "Komut gönderildi, cihaz hazırlanıyor...", percent: null });

    /* Eski (tarayıcı) sürümde burada indirme başlayana kadar bekleyip
       sıradaki cihaza GEÇMİYORDU — çünkü hepsi TEK bir paylaşılan MQTT
       oturumunu kullanıyordu, sıradaki cihaz için update-target çağırmak bu
       cihazın hedefini "preparing update" kör penceresinde değiştirip
       süreci kendi kendine kesebiliyordu. Burada durum farklı: her şerit
       kendi bağımsız session_id'sini ("ota:<jobId>:w<n>") kullanıyor ve
       komutu gönderir göndermez removeSlot ile HEMEN bağlantıyı kesiyor —
       yani sıradaki cihaza geçmek bu cihazı hiç etkilemiyor. İzleme
       (waiting → preparing → downloading → ...) artık tamamen paylaşılan
       monitorLoop'un işi (bkz. aşağıdaki branch 5/6/7) — burada ayrıca
       beklemek sadece şeridi gereksiz yere kilitler. */
    return { triggeredAt: firstTriggeredAt };
  }

  /* ── İzleme döngüsü — eski BulkUpdate.jsx'teki tick() ile BİREBİR aynı
     dallara ayrılmış karar mantığı, sadece updateDeviceState yerine DB'ye
     yazıyor. Tüm tetiklenmiş cihazları TEK bir toplu log sorgusuyla
     (fetchStatuses) izler — cihaz sayısı arttıkça log okuma maliyeti
     artmaz. ── */
  async function monitorLoop(jobId, kind, verifyVersion, triggeredAtByMac) {
    const t = TIMING[kind];
    const startDelayByMac = {};
    const giveUpMacs = new Set();

    while (true) {
      if (stopRequested.has(jobId)) break;

      const job = dbFns.getOtaBulkJob(jobId);
      if (!job) break;

      // Paralel şeritler bu döngüyle EŞ ZAMANLI çalışıyor — henüz tetiklenmemiş
      // ("queued"/"connecting"/"checking-charge"/"sending") cihazlar var
      // olabilir, onlar için henüz bakılacak log yok ama döngü YİNE DE açık
      // kalmalı (aksi halde işin başında "izlenecek hiçbir şey yok" diye
      // hemen çıkardı). Sadece TÜM cihazlar kesin bir sonuca ulaşınca
      // (hard-done ya da vazgeçildi) döngü biter.
      const pending = job.devices.filter((d) => !HARD_PHASES.includes(d.phase) && !giveUpMacs.has(d.mac));
      if (pending.length === 0) break;

      const active = pending.filter((d) => MONITORED_PHASES.includes(d.phase));
      if (active.length === 0) { await sleep(MONITOR_INTERVAL_MS); continue; }

      let statuses = {};
      try {
        statuses = await fetchStatuses(active.map((d) => ({ mac: d.mac, since: triggeredAtByMac[d.mac] || 0 })), kind);
      } catch { await sleep(MONITOR_INTERVAL_MS); continue; }

      const now = Date.now();

      for (const cur of active) {
        const mac = cur.mac;
        const st = statuses[mac];
        if (!st) continue;
        if (st.clockSkew) continue;

        const setPhase = (phase, patch = {}) => dbFns.updateOtaBulkJobDevice(jobId, mac, { phase, ...patch });

        if (st.percent !== null && st.percent !== undefined) {
          dbFns.updateOtaBulkJobDevice(jobId, mac, { percent: st.percent });
        }

        /* Gecikmeyi ölç ve sakla — aşağıdaki dallardan önce, "3. ESP" başarı
           mesajı bunu kullanıyor (bkz. eski dosyadaki "Cannot access
           'delayNote' before initialization" hatasının düzeltmesi — burada
           en baştan doğru sırada). */
        let startDelayMs = startDelayByMac[mac] ?? null;
        if (startDelayMs === null && st.lastActivityAt && triggeredAtByMac[mac]) {
          const d = st.lastActivityAt - triggeredAtByMac[mac];
          if (d >= 0) startDelayMs = d;
        }
        if (startDelayMs !== null) startDelayByMac[mac] = startDelayMs;
        const delayNote = startDelayMs !== null ? ` — komuttan ${formatDuration(startDelayMs)} sonra başladı` : "";

        /* ── 1. Kesin sonlandırıcı raporlar ──
           percent: null — aşağıdaki "uptodate"/"waiting"/"preparing"/
           "noresponse" dallarının HEPSİNDE bilerek sıfırlanıyor. Sahada
           gözlendi: log tamponu (bkz. ota-log-tailer.js MAX_BUFFERED_LINES)
           paralel çok sayıda cihaz indirirken bir cihazın "başladı" kanıtını
           kaybedebiliyor — cihaz aslında %73'e kadar inmişken sonraki
           kontrolde sanki hiç başlamamış gibi görünüp bu dallardan birine
           düşüyordu, ama eski %73 DB'de kalıp fazla ile çelişen, yanlış bir
           ilerleme çubuğu gösteriyordu. Artık faz gerçek indirme dışı bir
           şeye geçtiğinde yüzde de onunla birlikte temizleniyor. */
        if (st.lastResult === "no_update") {
          setPhase("uptodate", { percent: null, message: `Cihaz zaten güncel${st.currentVersion ? ` (${st.currentVersion})` : ""}` });
          continue;
        }
        if (st.lastResult === "failed") {
          setPhase("failed", { message: `Güncelleme başarısız: ${st.lastStatus}` });
          continue;
        }

        /* ── 2. MSP: msp_write_success kesin başarı ── */
        if (kind === "msp" && st.lastResult === "success") {
          // Envanterdeki (Cihaz Yönetimi) msp_fw'yi de tazele — panelde
          // "başarılı" görünen bir cihazın eski sürümü göstermeye devam
          // etmesin diye (bkz. db.js updateDeviceVersion).
          dbFns.updateDeviceVersion(mac, { msp_fw: st.targetVersion || st.latestVersion });
          setPhase("success", { percent: 100, message: "MSP güncellendi ✓" });
          continue;
        }

        /* ── 3. ESP: update_written BAŞARI DEĞİL, sadece "flash'a yazıldı" ── */
        if (kind === "esp" && st.lastResult === "written") {
          if (!verifyVersion) {
            dbFns.updateDeviceVersion(mac, { sw_version: st.targetVersion || st.latestVersion });
            setPhase("success", { percent: 100, message: `Firmware yazıldı ✓${delayNote}` });
            continue;
          }

          const target = st.targetVersion || st.latestVersion;

          if (st.postWriteVersion) {
            if (target && st.postWriteVersion === target) {
              dbFns.updateDeviceVersion(mac, { sw_version: st.postWriteVersion });
              setPhase("success", { percent: 100, message: `Güncellendi ve doğrulandı ✓ (${st.postWriteVersion})` });
            } else {
              setPhase("unverified", {
                percent: 100,
                message: `Firmware yazıldı ama cihaz ${st.postWriteVersion} bildiriyor${target ? ` (hedef ${target})` : ""} — sürüm sabitlenmiş olabilir`,
              });
            }
            continue;
          }

          if (st.lastResultAt && now - st.lastResultAt > t.VERIFY_WINDOW_MS) {
            setPhase("unverified", { percent: 100, message: "Firmware yazıldı, cihaz sürüm bildirimi yapmadı — doğrulanamadı" });
            continue;
          }

          setPhase("verifying", { percent: 100, message: "Firmware yazıldı, cihazın sürüm bildirimi bekleniyor (genelde 20-30 dk)..." });
          continue;
        }

        /* ── 4. Bilinmeyen status — otomatik başarısız SAYMA, izlemeye devam ── */
        if (st.lastResult === "unknown") {
          dbFns.updateOtaBulkJobDevice(jobId, mac, { message: `Bilinmeyen durum bildirildi: ${st.lastStatus} — izleniyor...` });
        }

        /* ── 5. İndirme sürüyor mu? ──
           %100'e ulaştıktan sonra cihaz artık indirmiyor, flash'a YAZIYOR —
           bu STUCK_TIMEOUT_MS'in yakalamaya çalıştığı "indirme durdu" durumu
           değil. Sahada gözlendi: yazma 45sn ile 2 dakika+ arası sürebiliyor,
           bazen daha da uzun. Eskiden ikisi AYNI (kısa) eşiği kullanıyordu —
           yazma bu eşiği aşınca cihaz "başarısız" olarak işaretleniyordu,
           SONRA "yazıldı" raporu gelse bile (branch 3 her turda ÖNCE
           kontrol edilir) artık MONITORED_PHASES'te olmadığı için ("failed"
           kalıcı/hard bir faz) bir daha hiç kontrol edilmiyordu — log gerçek
           başarıyı gösterse bile panel sonsuza kadar "başarısız" görünüyordu.
           Çözüm: %100'deyken çok daha cömert (WRITE_TIMEOUT_MS), aksi halde
           kısa (STUCK_TIMEOUT_MS) eşik kullan. */
        if (st.hasStarted) {
          const writing = st.percent === 100;
          const msg = writing ? "İndirme tamamlandı, cihaz firmware'i yazıyor..." : `Firmware indiriliyor${delayNote}`;
          if (cur.phase !== "downloading" || cur.message !== msg) {
            setPhase("downloading", { message: msg });
          }
          if (st.lastProgressAt) {
            const idle = now - st.lastProgressAt;
            const timeout = writing ? t.WRITE_TIMEOUT_MS : t.STUCK_TIMEOUT_MS;
            if (idle >= 0 && idle > timeout) {
              setPhase("failed", {
                message: writing
                  ? `Firmware yazıldı ama cihaz ${formatDuration(idle)}dır rapor vermedi — yanıt alınamadı`
                  : `%${st.percent ?? "?"}'da takılı kaldı (${Math.round(timeout / 1000)}sn ilerlemedi)`,
              });
            }
          }
          continue;
        }

        /* ── 6. Cihaz OTA sunucusuna bağlandı ama henüz indirmeye başlamadı ──
           updateAvailable === false, cihazın manifest kontrolünde sunucunun
           "sana yeni firmware yok" dediği KESİN bir sinyal (muhtemelen cihaz
           zaten hedef sürümde/ondan yeni) — hasStarted asla true olmayacağı
           için bu durum düzeltilmeden "preparing"de SONSUZA KADAR beklerdi
           (gerçek bir "no_new_firmware" RAPORU hiç gelmeyebiliyor, sadece
           manifest'te available=False görülüyor). Artık bunu doğrudan kesin
           sonuç (Zaten Güncel) sayıyoruz. */
        if (st.updateAvailable === false) {
          setPhase("uptodate", { percent: null, message: `Cihaz zaten güncel${st.currentVersion ? ` (${st.currentVersion})` : ""} — sunucu yeni sürüm sunmuyor` });
          continue;
        }

        if (st.lastActivityAt) {
          const waited = now - st.lastActivityAt;
          if (waited >= 0 && waited > t.PREPARE_TIMEOUT_MS) {
            setPhase("noresponse", { percent: null, message: `Cihaz sunucuya bağlandı ama ${formatDuration(waited)}dır indirmeye başlamadı — izleme sürüyor` });
          } else {
            setPhase("preparing", { percent: null, message: `Cihaz sunucuya bağlandı, indirme bekleniyor${delayNote}` });
          }
          continue;
        }

        /* ── 7. Hâlâ hiçbir iz yok ── */
        const triggeredAt = triggeredAtByMac[mac];
        if (triggeredAt) {
          const elapsed = now - triggeredAt;
          if (elapsed > t.NO_ACTIVITY_GRACE_MS) {
            setPhase("noresponse", { percent: null, message: `${formatDuration(elapsed)}dır OTA sunucusuna bağlanmadı — izleme sürüyor, cihaz geç başlarsa durum güncellenir` });
          } else {
            setPhase("waiting", { percent: null, message: `Cihaz hazırlanıyor — ${formatDuration(elapsed)} (henüz OTA sunucusuna bağlanmadı)` });
          }
        }
      }

      // Yumuşak-bitmiş (noresponse/unverified) cihazlar için üst sınır —
      // bkz. dosya başındaki GIVE_UP_EXTRA_MS açıklaması.
      for (const cur of active) {
        if (["noresponse", "unverified"].includes(cur.phase)) {
          const since = triggeredAtByMac[cur.mac] || 0;
          if (since && now - since > t.VERIFY_WINDOW_MS + GIVE_UP_EXTRA_MS[kind]) {
            giveUpMacs.add(cur.mac);
          }
        }
      }

      await sleep(MONITOR_INTERVAL_MS);
    }
  }

  /* N paralel "robot session" — Toplu Parametre'deki (bulk-jobs.js) lane
     deseniyle birebir aynı: her şerit ortak kuyruktan cihaz çekip kendi
     bağımsız session_id'siyle (ota:<jobId>:w<n>) çalışır. Eskiden (tarayıcı
     sürümünde ve bu portun ilk hâlinde) TEK paylaşılan session kullanıldığı
     için sıralı işlemek zorunluydu — artık her şeridin kendi session'ı
     olduğu için cihazlar birbirini etkilemeden paralel tetiklenebiliyor. */
  async function runJob(jobId, devices, kind, otaType, verifyVersion, laneCount) {
    const queue = [...devices];
    const triggeredAtByMac = {};
    const actualLaneCount = Math.max(1, Math.min(Number(laneCount) || 1, queue.length || 1));

    const lane = async (laneIndex) => {
      // Şeritler tam aynı anda değil, birer saniye arayla ilk komutunu
      // atsın — uzaktaki köprü N cihazın activate isteğini aynı milisaniyede
      // yemek zorunda kalmasın (bkz. bulk-jobs.js'teki aynı gerekçe).
      await sleep(laneIndex * 1000);
      const sessionId = `ota:${jobId}:w${laneIndex}`;
      while (queue.length > 0) {
        if (stopRequested.has(jobId)) break;
        const device = queue.shift();
        if (!device) break;
        try {
          const result = await triggerDevice(jobId, sessionId, device, kind, otaType);
          if (result) triggeredAtByMac[device.mac] = result.triggeredAt;
        } catch (e) {
          console.error(`[OTA-BULK-JOB ${jobId}] cihaz ${device.mac} tetikleme hatası:`, e.message);
          dbFns.updateOtaBulkJobDevice(jobId, device.mac, { phase: "failed", message: "Beklenmeyen hata: " + e.message });
          try { await removeSlot(sessionId); } catch {}
        }
      }
    };

    // İzleme döngüsü, tetikleme şeritleriyle EŞ ZAMANLI başlar — bir cihaz
    // tetiklenir tetiklenmez (diğer şeritler hâlâ başka cihazları
    // tetiklerken) durumu izlenmeye başlar, sıraya girmez.
    const lanes = Promise.all(Array.from({ length: actualLaneCount }, (_, i) => lane(i)));
    const monitoring = (async () => {
      try {
        await monitorLoop(jobId, kind, verifyVersion, triggeredAtByMac);
      } catch (e) {
        console.error(`[OTA-BULK-JOB ${jobId}] izleme hatası:`, e.message);
      }
    })();

    await Promise.all([lanes, monitoring]);

    // Elle "Durdur"a basılmışsa otomatik tekrar PLANLANMAZ (bkz. bulk-jobs.js'teki aynı gerekçe).
    const wasStopped = stopRequested.has(jobId);
    stopRequested.delete(jobId);
    dbFns.setOtaBulkJobStatus(jobId, "done");
    console.log(`[OTA-BULK-JOB ${jobId}] tamamlandı (${actualLaneCount} paralel şerit)`);
    if (!wasStopped) maybeScheduleAutoRetry(jobId);
  }

  function startJob({ company, kind, otaType, verifyVersion, devices, createdBy, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed }) {
    if (!Array.isArray(devices) || devices.length === 0) throw new Error("Cihaz seçilmedi");
    if (kind !== "esp" && kind !== "msp") throw new Error("Geçersiz güncelleme tipi");

    const id = crypto.randomBytes(8).toString("hex");
    dbFns.createOtaBulkJob({ id, company, kind, verifyVersion, createdBy, devices, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed });
    runJob(id, devices, kind, otaType, !!verifyVersion, workerCount).catch((e) => {
      console.error(`[OTA-BULK-JOB ${id}] iş çöktü:`, e);
      dbFns.setOtaBulkJobStatus(id, "done");
    });
    return id;
  }

  function stopJob(jobId) {
    stopRequested.add(jobId);
    dbFns.setOtaBulkJobStatus(jobId, "stopped");
  }

  function getJob(jobId) { return dbFns.getOtaBulkJob(jobId); }
  function listJobs(opts) { return dbFns.listOtaBulkJobs(opts); }
  function dismissJob(jobId) {
    cancelAutoRetryTimer(jobId);
    dbFns.dismissOtaBulkJob(jobId);
  }

  // ── Otomatik tekrar — bkz. bulk-jobs.js'teki aynı desen ve gerekçe.
  // OTA işlerinde cihaz bilgisi (mac/location/device_code) zaten job
  // kaydının kendisinde duruyor — Toplu Parametre'nin aksine devices
  // tablosundan yeniden çözümlemeye gerek yok (bkz. manuel retry ucundaki
  // aynı not, server.js). ──
  function maybeScheduleAutoRetry(jobId) {
    const job = dbFns.getOtaBulkJob(jobId);
    if (!job) return;
    const minutes = Number(job.auto_retry_minutes) || 0;
    const max = Number(job.auto_retry_max) || 0;
    if (minutes <= 0 || max <= 0) return;
    if ((job.auto_retry_used || 0) >= max) return;
    const retryDevices = job.devices.filter((d) => RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return;

    const nextAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    dbFns.setOtaBulkJobAutoRetryNextAt(jobId, nextAt);
    armAutoRetryTimer(jobId, minutes * 60 * 1000, fireAutoRetry);
    console.log(`[OTA-BULK-JOB ${jobId}] otomatik tekrar planlandı: ${minutes}dk sonra (${(job.auto_retry_used || 0) + 1}/${max}, ${retryDevices.length} cihaz)`);
  }

  async function fireAutoRetry(jobId) {
    const job = dbFns.getOtaBulkJob(jobId);
    if (!job || job.dismissed || !job.auto_retry_next_at) return;
    dbFns.setOtaBulkJobAutoRetryNextAt(jobId, null);

    const retryDevices = job.devices.filter((d) => RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return;

    const otaType = job.kind === "esp" ? "1" : "2";
    const nextUsed = (job.auto_retry_used || 0) + 1;
    const newId = startJob({
      company: job.company, kind: job.kind, otaType, verifyVersion: !!job.verify_version,
      devices: retryDevices.map((d) => ({ mac: d.mac, location: d.location, device_code: d.device_code })),
      createdBy: job.created_by, workerCount: job.worker_count || 1,
      autoRetryMinutes: job.auto_retry_minutes, autoRetryMax: job.auto_retry_max, autoRetryUsed: nextUsed,
    });
    dbFns.setOtaBulkJobAutoRetryChild(jobId, newId);
    console.log(`[OTA-BULK-JOB ${jobId}] otomatik tekrar (#${nextUsed}/${job.auto_retry_max}) tetiklendi -> ${newId} (${retryDevices.length} cihaz)`);
  }

  function cancelScheduledAutoRetry(jobId) {
    cancelAutoRetryTimer(jobId);
    dbFns.setOtaBulkJobAutoRetryNextAt(jobId, null);
  }

  function resumeAutoRetries() {
    const pending = dbFns.listPendingAutoRetryOtaBulkJobs();
    for (const row of pending) {
      const delay = new Date(row.auto_retry_next_at).getTime() - Date.now();
      armAutoRetryTimer(row.id, delay, fireAutoRetry);
    }
    if (pending.length) console.log(`[OTA-BULK-JOB] ${pending.length} bekleyen otomatik tekrar yeniden kuruldu`);
  }

  return { startJob, stopJob, dismissJob, getJob, listJobs, RETRYABLE_PHASES, cancelScheduledAutoRetry, resumeAutoRetries };
}

module.exports = { initOtaBulkJobs };
