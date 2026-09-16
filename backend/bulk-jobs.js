/* ═══════════════════════════════════════════════════════════════
   Toplu Parametre — arka planda çalışan kalıcı iş kaydı

   Daha önce bu akış (bağlan → şarj kontrolü → set → aktifleştir →
   mod → reset → yeniden bağlan → doğrula) tamamen TARAYICIDA
   (BulkParamUpdate.jsx) çalışıyordu. Sekme kapanınca/sayfa
   değişince (component unmount) iş görünmez oluyordu, sayfa
   yenilenince (deploy dahil) TAMAMEN duruyordu.

   Şimdi aynı mantık BURADA, backend'de (server.js'in kendi process'i
   içinde, arka planda) çalışıyor — server.js zaten haftalardır kesintisiz
   ayakta, tarayıcı sekmesinden bağımsız. Panel sadece bir iş başlatıp
   sonra durumunu SORAN bir izleyiciye dönüşüyor (bkz. GET /api/bulk-jobs/:id).
   İlerleme her adımda SQLite'a yazılıyor — kalıcı, sorgulanabilir kayıt.
   ═══════════════════════════════════════════════════════════════ */

const crypto = require("crypto");
const dbFns = require("./db");

/* ── Parametre tanımları — BulkParamUpdate.jsx'teki BULK_PARAMS ile birebir
   aynı. Frontend sadece paramId+value gönderir, activateId/modeId/resetId
   gibi "hangi ek adımlar gerekiyor" bilgisi GÜVENLİK için burada, backend'de
   sabit tutuluyor — frontend'in keyfi bir resetId göndermesine izin verilmez. */
const BULK_PARAMS = {
  64: { label: "Logo Adı", activateId: 63, modeId: 13, modeValue: "1", verifyId: 65, resetId: 20 },
  14: { label: "Şirket Adı" },
  10: { label: "Site" },
  11: { label: "Appstore" },
  12: { label: "Play Store" },
  9:  { label: "Şirket Tel" },
  1:  { label: "OCPP URL" },
  2:  { label: "OCPP ID" },
  3:  { label: "QR Kod" },
  4:  { label: "Maks. Güç" },
  5:  { label: "WiFi SSID" },
  6:  { label: "WiFi Şifre" },
  7:  { label: "Bağlantı Türü" },
  16: { label: "AC Ölçer" },
  17: { label: "Konfig Modu" },
  19: { label: "ESP Modu" },
  35: { label: "Gradient/Renk" },
  38: { label: "OCPP Aktif" },
  39: { label: "CP Vendor" },
  40: { label: "CP Model" },
  41: { label: "CP Seri No" },
  42: { label: "Meter Seri No" },
  43: { label: "Meter Tipi" },
  44: { label: "Box Seri No" },
  69: { label: "MSP Modu" },
};

const ACTIVATE_WAITS = [60, 30, 30];
const RECONNECT_AFTER_RESET_WAITS = [60, 30, 30];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// responses.json'daki her mesaj "2026-09-11 11:46:59" gibi damgasız-yerel-
// saat formatında bir "time" taşıyor — bkz. ota-bulk-jobs.js'teki AYNI
// düzeltme ve oradaki uzun açıklama (sahada doğrulanan kök neden: uzak
// köprü eski/önbellek mesajları geri gönderip yerel temizliği ezebiliyordu).
const RESPONSE_TZ_OFFSET = process.env.RESPONSE_TZ_OFFSET || "+03:00";
function parseResponseTime(str) {
  if (!str) return null;
  const ts = Date.parse(`${String(str).replace(" ", "T")}${RESPONSE_TZ_OFFSET}`);
  return Number.isNaN(ts) ? null : ts;
}

/* jobId -> true : "Durdur"a basıldı, sıradaki cihaza geçilmesin.
   Bellekte tutulması sorun değil — süreç yeniden başlarsa zaten iş de
   yarım kalmış sayılır, DB'deki son durum kalıcı kalır. */
const stopRequested = new Set();

// "Tekrar Dene" (elle) ile aynı kriter — otomatik tekrar da BUNU kullanır,
// tek bir yerden yönetilsin diye (bkz. server.js manuel retry ucu, aynı
// listeyi burada dışa aktarılan RETRYABLE_PHASES'ten alıyor).
const RETRYABLE_PHASES = ["failed", "unverified"];

// jobId -> setTimeout handle. Otomatik tekrar zamanlayıcıları — sunucu
// süreci hayatta olduğu sürece bellekte tutulur; süreç yeniden başlarsa
// resumeAutoRetries() DB'deki auto_retry_next_at'ten yeniden kurar (bkz.
// server.js başlangıç çağrısı).
const autoRetryTimers = new Map();

function cancelAutoRetryTimer(jobId) {
  const handle = autoRetryTimers.get(jobId);
  if (handle) { clearTimeout(handle); autoRetryTimers.delete(jobId); }
}

function armAutoRetryTimer(jobId, delayMs, fireFn) {
  cancelAutoRetryTimer(jobId);
  const handle = setTimeout(() => {
    autoRetryTimers.delete(jobId);
    fireFn(jobId).catch((e) => console.error(`[BULK-JOB ${jobId}] otomatik tekrar hatası:`, e.message));
  }, Math.max(0, delayMs));
  autoRetryTimers.set(jobId, handle);
}

function initBulkJobs(deps) {
  const {
    readTarget, writeJsonRaw, findOrCreateSlot, deactivateThenActivateForSlot,
    removeSlot, readResponses, isPythonRunning, TARGET_PATH, RESPONSES_PATH, touchSlot, readUsers, withLock,
    checkLogoWritten, OTA_LOG_PATH,
  } = deps;

  // Reset atıldıktan sonra logo/firmware'in OTA sunucu loguna "written"
  // düşmesini bekler — MQTT'den bağımsız, çok daha güvenilir bir kanıt
  // (bkz. ota-log-tailer.js'teki checkLogoWritten açıklaması).
  // 3 dakika — paralel çalışırken birden fazla cihaz aynı OTA sunucusundan
  // aynı .bin dosyasını sırayla indirmek zorunda kalabiliyor, bu da tekil
  // bir cihazın normalden çok daha geç "written" düşmesine yol açabiliyor
  // (sahada gözlendi: 90sn'lik pencere kaçırdı, gerçek yazma birkaç dakika
  // sonra gerçekleşti). Bu kontrol MQTT'ye hiç yük bindirmiyor (sadece
  // yerel log dosyasını okuyor), o yüzden pencereyi cömert tutmanın bedeli yok.
  const pollLogoWritten = async (mac, sinceTs, totalMs = 180000, intervalMs = 3000) => {
    if (!checkLogoWritten || !mac) return false;
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
      if (await checkLogoWritten({ logPath: OTA_LOG_PATH, mac, sinceTs })) return true;
      await sleep(intervalMs);
    }
    return false;
  };

  // ── responses.json'dan SET OK / read cevabı bekleyen küçük yardımcılar ──
  // HTTP /api/send-command + /api/responses ile BİREBİR AYNI mantık, sadece
  // fetch yerine doğrudan fonksiyon çağrısı.
  const sendFrame = async (sessionId, frame) => {
    // withLock ŞART — bu fonksiyon her set/read'de HER paralel şerit
    // tarafından çağrılıyor; kilitsiz hâliyle tam olarak sahada gözlenen
    // "kayıp güncelleme" hatasının en olası kaynağıydı (bkz. server.js'teki
    // withLock açıklaması).
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
          // Sadece HÂLÂ bu frame duruyorsa temizle — art arda hızlı gönderilen
          // (1.5sn içinde) bir sonraki komut send_message'ı çoktan üzerine
          // yazmış olabilir; o zaman burada silinen şey artık BİZİM eski
          // komutumuz değil, henüz cihaza ulaşmamış YENİ komut olur (bkz.
          // sahada gözlenen "önceki parametreler OK, sonrakiler SET OK gelmedi").
          if (s && s.send_message === frame) { s.send_message = ""; await writeJsonRaw(TARGET_PATH, d); }
        });
      } catch {}
    }, 1500);
  };

  const sendSet = (sessionId, varId, value) => sendFrame(sessionId, `frame 1 ${varId} ${value}`);
  const sendRead = (sessionId, varId) => sendFrame(sessionId, `frame 2 ${varId} 0`);

  // sinceTs verilirse, "time" alanı bu andan (5sn tolerans payıyla) ÖNCE
  // olan mesajlar ELENİR — bkz. aşağıdaki KRİTİK GÜVENLİK DÜZELTMESİ notu.
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
     birden fazla cihaz için kullandığından, yeni bir cihaza bağlanınca bu
     yuvada hâlâ ÖNCEKİ cihazın (hatta dakikalar önceki bir isteğin) son
     mesajı duruyor olabilir.

     Sahada DOĞRULANDI: responses.json'da canlı olarak görüldü — aynı
     session'ın status_response'u "11:52:15" iken message_response'u hâlâ
     "11:46:59" idi (~5 dakika eski). Yerel dosyayı bağlanır bağlanmaz
     temizlemek (clearMessageResponse) TEK BAŞINA yeterli değildi — uzak
     köprü periyodik tam senkronizasyon push'larıyla bu yerel temizliği
     ezebiliyor. Sonuç: şarj kontrolü (id 25, Logo gibi resetId gerektiren
     parametrelerde) eski bir "şarj yok" cevabıyla eşleşip GERÇEKTEN şarj
     veren bir cihazda güncelleme başlatabiliyordu.

     Kalıcı çözüm: her okuma isteğinden hemen önce bir zaman damgası alıp
     (sinceTs), gelen cevabın "time" alanının bu andan SONRA olmasını ŞART
     koşmak — bkz. getMessageResponses'taki filtre (bkz. ota-bulk-jobs.js'
     teki aynı düzeltme). clearMessageResponse yine de korunuyor (ek
     güvenlik katmanı) ama artık TEK savunma hattı değil. */
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
  // geldi? (bkz. ota-bulk-jobs.js'teki aynı düzeltme)
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

  const waitSetOk = async (sessionId, varId, sinceTs, tries = 6) => {
    for (let i = 0; i < tries; i++) {
      await sleep(1000);
      const msgs = await getMessageResponses(sessionId, sinceTs);
      if (msgs.find((m) => Number(m.msg) === varId && m.data === "SET OK")) return true;
    }
    return false;
  };

  const waitReadMatch = async (sessionId, varId, expected, tries = 6) => {
    const sinceTs = Date.now();
    await sendRead(sessionId, varId);
    for (let i = 0; i < tries; i++) {
      await sleep(1000);
      const msgs = await getMessageResponses(sessionId, sinceTs);
      const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === varId && m.data !== undefined && m.data !== null);
      if (found) return String(found.data) === String(expected);
    }
    return null;
  };

  // Bu MAC'i şu an BAŞKA bir session (gerçek bir kullanıcı elle bağlanmış,
  // ya da aynı işin başka bir paralel şeridi, ya da başka bir bulk iş) mi
  // kullanıyor? Paralelleştirdikçe bu çakışma ihtimali arttığı için —
  // gerçek kullanıcının işini bölmemek, iki şeridin aynı cihazı ezmemesi
  // için — bağlanmadan önce kontrol ediyoruz.
  const checkOccupancy = async (sessionId, mac) => {
    const target = await readTarget();
    const occupant = target.requests.find((r) => r.target === mac && r.control === "activate" && r.session_id !== sessionId);
    if (!occupant) return null;

    // Occupant bulk:/ota: önekli sahte bir session ve sahibi iş artık
    // çalışmıyorsa (çökmüş/durmuş şerit) — bu KESİN yetim, zaman aşımı
    // beklemeden hemen temizle ve meşgul deme (bkz. db.js
    // isSyntheticSessionStale açıklaması).
    if (dbFns.isSyntheticSessionStale(occupant.session_id)) {
      console.log(`[BULK-JOB] yetim session temizlendi: ${occupant.session_id} (${mac} üzerinde takılı kalmış)`);
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

  const connectAndWait = async (sessionId, mac, waitLabel, waits) => {
    for (let attempt = 1; attempt <= waits.length; attempt++) {
      const occupant = await checkOccupancy(sessionId, mac);
      if (occupant) return { ok: false, message: `Cihaz meşgul: ${occupant}` };

      try {
        await deactivateThenActivateForSlot(sessionId, mac);
        touchSlot(sessionId);
      } catch { /* aşağıda yeniden denenir */ }

      const waitSec = waits[attempt - 1];
      for (let i = 0; i < waitSec; i++) {
        await sleep(1000);
        if ((await getEspState(sessionId)) === "active") return { ok: true };
      }
    }
    return { ok: false, message: `Cihaz aktif olmadı (${waits.length} deneme)` };
  };

  /* ═══ GERÇEK KÖK NEDEN (sahada loglanan ham verilerle doğrulandı) ═══
     id 25 "0"/"1"/"2" değil, İSİMLİ durum kodları gönderiyor:
       "P4_CHARGING" = şarj oluyor, "P2_PLUG_IN" = soket takılı DEĞİL (asıl
       "takılı ama şarj etmiyor" durumu "P3_SCAN_RFID"tir — bkz. deviceValueMapping.js).
     Eski kontrol (`chargeStatus === "1"`) bu yüzden "P4_CHARGING"yi HİÇBİR
     ZAMAN yakalamıyordu. Ayrıca id 25 anlık okuma isteğine cevap veren bir
     değer DEĞİL — cihazın durum DEĞİŞTİĞİNDE kendiliğinden yayınladığı
     pasif bir telemetri (bkz. ota-bulk-jobs.js'teki aynı düzeltme ve
     oradaki uzun açıklama — "iki bağımsız okuma" denemesinde ikincisi hep
     boş dönüyordu, çünkü "oku" komutu yeni bir cevap tetiklemiyor). Bu
     yüzden "isteğimden SONRA gelmiş olmalı" şartı gevşetildi: makul ölçüde
     güncel (son birkaç dakika) HERHANGİ bir bilinen değer kabul ediliyor,
     ama "ŞARJ" geçen HİÇBİR durum asla güvenli sayılmıyor. */
  const CHARGE_ATTEMPTS = 3, CHARGE_POLLS = 10, CHARGE_FRESHNESS_MS = 3 * 60 * 1000;
  const isChargingValue = (raw) => {
    const v = String(raw || "").toUpperCase();
    // "CHARG" değil "CHARGING" eşleşmeli — "P5_CHARGE_ENDED" (şarj BİTTİ)
    // gibi kodlar da "CHARG" içeriyor ama şu an şarj olmuyor demek; bunu
    // "şarjda" sayıp gereksiz yere engellememek için tam kelime arıyoruz.
    return v === "1" || v.includes("CHARGING");
  };
  const checkCharging = async (sessionId, mac) => {
    let chargeStatus = null;
    let rawFound = null;
    for (let attempt = 1; attempt <= CHARGE_ATTEMPTS && chargeStatus === null; attempt++) {
      await sendRead(sessionId, 25);
      for (let i = 0; i < CHARGE_POLLS; i++) {
        await sleep(1500);
        const msgs = await getMessageResponses(sessionId, Date.now() - CHARGE_FRESHNESS_MS);
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === 25 && m.data !== undefined && m.data !== null);
        if (found) { chargeStatus = String(found.data); rawFound = found; break; }
      }
    }
    console.log(`[CHARGE-CHECK] mac=${mac} sid=${sessionId} sonuç=${chargeStatus === null ? "OKUNAMADI" : chargeStatus} şarj_mı=${chargeStatus !== null ? isChargingValue(chargeStatus) : "-"} ham=${rawFound ? JSON.stringify(rawFound) : "yok"}`);
    return chargeStatus;
  };

  const setAndConfirm = async (sessionId, varId, value) => {
    const sinceTs = Date.now();
    await sendSet(sessionId, varId, value);
    return waitSetOk(sessionId, varId, sinceTs);
  };

  // Bir cihaz zaten BAĞLIYKEN tek bir parametreyi uygular — set → (varsa)
  // aktifleştir → (varsa) mod → (varsa) reset+yeniden bağlan → doğrula.
  // Bağlanmayı/bağlantıyı kesmeyi ÇAĞIRAN yönetir (çoklu parametrede tek
  // bağlantıyla art arda birden fazla parametre uygulanabilsin diye).
  // Döner: { ok: true (doğrulandı) | false (kesin başarısız) | null (belirsiz/doğrulanamadı), note }
  async function applyParam(jobId, sessionId, device, param, setPhase) {
    if (param.resetId) {
      setPhase("sending", `${param.label} için şarj durumu kontrol ediliyor...`);
      const chargeStatus = await checkCharging(sessionId, device.mac);
      if (chargeStatus === null) return { ok: false, note: "şarj durumu okunamadı, güvenlik için atlandı" };
      if (isChargingValue(chargeStatus)) return { ok: false, note: `cihaz şarj veriyor (${chargeStatus}), reset gerektiği için atlandı` };
    }

    setPhase("sending", `${param.label} gönderiliyor...`);
    const setOk = await setAndConfirm(sessionId, param.id, param.value);
    if (!setOk) return { ok: false, note: "SET OK gelmedi" };

    if (param.activateId) {
      setPhase("sending", `${param.label} aktifleştiriliyor...`);
      const actOk = await setAndConfirm(sessionId, param.activateId, "1");
      if (!actOk) return { ok: null, note: "aktifleştirme onayı alınamadı" };
    }

    if (param.modeId) {
      setPhase("sending", `${param.label} için görüntü modu gönderiliyor...`);
      const modeOk = await setAndConfirm(sessionId, param.modeId, param.modeValue);
      if (!modeOk) return { ok: null, note: "görüntü modu (Logo/Yazı) onayı alınamadı" };
    }

    if (param.resetId) {
      const resetSentAt = Date.now();
      setPhase("restarting", `${param.label} için cihaz resetleniyor...`);
      await sendSet(sessionId, param.resetId, "1");
      await waitSetOk(sessionId, param.resetId, resetSentAt, 3);
      try { await removeSlot(sessionId); } catch {}

      setPhase("restarting", "Cihaz yeniden başlıyor, bekleniyor...");
      await sleep(10000);

      // ── Doğrulama: ÖNCE OTA sunucu logu (path=/logo_report status=written) ──
      // Bu, cihazın dosyayı GERÇEKTEN indirip flash'a yazdığının MQTT'den
      // bağımsız, kesin kanıtı. Önceki sürüm sadece MQTT üzerinden "Aktif
      // Logo"yu (id 65) okuyup karşılaştırıyordu ama sahada defalarca yanlış
      // "doğrulanamadı" verdi — log'da "written" yazan cihazlar bile MQTT
      // okumasında farklı/boş cevap veriyordu. Log varken ona güveniyoruz.
      setPhase("verifying", `${param.label} doğrulanıyor — cihaz indirip yazıyor olabilir, sürebilir...`);
      const writtenInLog = await pollLogoWritten(device.mac, resetSentAt);
      if (writtenInLog) return { ok: true, note: "OTA sunucu logunda yazıldığı doğrulandı" };

      // Log'da onay yoksa (örn. bu MAC hiç bu OTA sunucusundan geçmiyorsa)
      // son çare olarak MQTT üzerinden yeniden bağlanıp okumayı dene.
      const reconn = await connectAndWait(sessionId, device.mac, "Yeniden bağlanılıyor", RECONNECT_AFTER_RESET_WAITS);
      if (!reconn.ok) {
        return { ok: null, note: `ne log'da yazma onayı bulundu ne reset sonrası tekrar bağlanılabildi (${reconn.message})` };
      }
      const verifyId = param.verifyId || param.id;
      const matched = await waitReadMatch(sessionId, verifyId, param.value);
      try { await removeSlot(sessionId); } catch {}
      if (matched === true) return { ok: true, note: "MQTT üzerinden doğrulandı" };
      if (matched === false) return { ok: false, note: "cihaz farklı bir değer bildiriyor" };
      return { ok: null, note: "ne log'da ne MQTT'de doğrulama bulunamadı" };
    }

    // resetId olmayan (anlık yazılan) basit parametreler — MQTT read yeterli.
    setPhase("verifying", `${param.label} doğrulanıyor...`);
    const verifyId = param.verifyId || param.id;
    const matched = await waitReadMatch(sessionId, verifyId, param.value);
    if (matched === true) return { ok: true, note: "doğrulandı" };
    if (matched === false) return { ok: false, note: "cihaz farklı bir değer bildiriyor" };
    return { ok: null, note: "doğrulama okunamadı" };
  }

  // ── Bir cihaz için tüm akış — bağlan, seçilen TÜM parametreleri sırayla
  // uygula, bağlantıyı kes. Tek parametre gönderildiğinde davranış öncekiyle
  // birebir aynı; birden fazla parametre varsa hepsi aynı bağlantı üzerinden
  // art arda gönderilir (her biri için ayrı ayrı bağlanıp kesmek yerine). ──
  /* Bağlanma (status_response) topic doğrulamalı (bkz. getEspState) — cevap
     yanlış cihazdan gelirse yakalayıp reddedebiliyoruz. Parametre uygulama
     (message_response) için aynı doğrulama mümkün değil (bkz. ota-bulk-
     jobs.js'teki aynı not) — teorik bir çapraz-karışma riski var ama sahada
     kanıtlanmış bir örneği yok; bulunan somut hatalar düzeltildi. Kullanıcı
     kararıyla tamamen paralel bırakıldı. */
  async function processDevice(jobId, sessionId, device, params) {
    const setPhase = (phase, message) => dbFns.updateBulkJobDevice(jobId, device.id, { phase, message });

    // 1. BAĞLAN — paralel (topic doğrulamalı, güvenli).
    setPhase("connecting", "Bağlanıyor — cihazın aktif olması bekleniyor...");
    const conn = await connectAndWait(sessionId, device.mac, "Bağlanıyor", ACTIVATE_WAITS);
    if (!conn.ok) {
      setPhase("failed", conn.message);
      try { await removeSlot(sessionId); } catch {}
      return;
    }

    // 2. PARAMETRE UYGULAMA — kullanıcı isteğiyle tekrar paralel (bkz.
    // ota-bulk-jobs.js'teki aynı geri alma ve gerekçe).
    // Bu cihaza dair HİÇBİR komut göndermeden önce — bkz. clearMessageResponse
    // tanımındaki açıklama (önceki cihazdan kalan mesaj yanlış okunabiliyordu).
    await clearMessageResponse(sessionId);

    const results = [];
    for (const param of params) {
      const outcome = await applyParam(jobId, sessionId, device, param, setPhase);
      results.push({ label: param.label, ...outcome });
    }
    try { await removeSlot(sessionId); } catch {}

    const summary = results
      .map((r) => `${r.label}: ${r.ok === true ? "✓" : r.ok === false ? "✕" : "△"} (${r.note})`)
      .join(" · ");
    if (results.some((r) => r.ok === false)) setPhase("failed", summary);
    else if (results.some((r) => r.ok === null)) setPhase("unverified", summary);
    else setPhase("success", summary);
  }

  // N paralel "robot session" — her şerit ortak kuyruktan cihaz çekip kendi
  // bağımsız session_id'siyle (bulk:<jobId>:w<n>) aynı akışı çalıştırır.
  // Gerçek kullanıcı girişi yok, tarayıcıya bağlı değil — backend'in kendi
  // ürettiği sahte kimlikler. queue.shift() JS'te tek thread olduğu için
  // (await noktaları dışında kesilmez) iki şeridin aynı cihazı çekmesi
  // mümkün değil.
  async function runJob(jobId, devices, params, workerCount) {
    const queue = [...devices];
    const laneCount = Math.max(1, Math.min(Number(workerCount) || 1, queue.length || 1));

    const lane = async (laneIndex) => {
      // Şeritler tam aynı anda değil, birer saniye arayla ilk bağlantısını
      // atsın — kilit sayesinde artık veri bozulmuyor ama N cihaz aynı
      // milisaniyede activate isteği yollayınca uzaktaki köprü/MQTT tarafı
      // hâlâ zorlanabiliyor. Kademeli başlangıç, o ilk yığılmayı yumuşatır.
      await sleep(laneIndex * 1000);
      const sessionId = `bulk:${jobId}:w${laneIndex}`;
      while (queue.length > 0) {
        if (stopRequested.has(jobId)) break;
        const device = queue.shift();
        if (!device) break;
        try {
          await processDevice(jobId, sessionId, device, params);
        } catch (e) {
          console.error(`[BULK-JOB ${jobId}] cihaz ${device.id} hata:`, e.message);
          dbFns.updateBulkJobDevice(jobId, device.id, { phase: "failed", message: "Beklenmeyen hata: " + e.message });
          try { await removeSlot(sessionId); } catch {}
        }
      }
    };

    await Promise.all(Array.from({ length: laneCount }, (_, i) => lane(i)));
    // Elle "Durdur"a basılmışsa otomatik tekrar PLANLANMAZ — kullanıcı işi
    // bilerek kesmiş, arkadan sessizce yeni bir iş açmak sürpriz olurdu.
    const wasStopped = stopRequested.has(jobId);
    stopRequested.delete(jobId);
    dbFns.setBulkJobStatus(jobId, "done");
    console.log(`[BULK-JOB ${jobId}] tamamlandı (${laneCount} paralel şerit)`);
    if (!wasStopped) maybeScheduleAutoRetry(jobId);
  }

  // params: [{ id, value }, ...] — activateId/modeId/resetId/verifyId gibi
  // "hangi ek adımlar gerekir" bilgisi HER ZAMAN buradaki BULK_PARAMS'tan
  // (sunucu tarafı, sabit) alınır — frontend'in keyfi bir wiring göndermesine
  // izin verilmez.
  function startJob({ company, params, devices, createdBy, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed }) {
    if (!Array.isArray(params) || params.length === 0) throw new Error("Parametre seçilmedi");
    const resolvedParams = params.map((p) => {
      const def = BULK_PARAMS[p.id];
      if (!def) throw new Error(`Geçersiz parametre: ${p.id}`);
      return { id: p.id, value: String(p.value), ...def };
    });

    const id = crypto.randomBytes(8).toString("hex");
    dbFns.createBulkJob({ id, company, params: resolvedParams, createdBy, devices, workerCount, autoRetryMinutes, autoRetryMax, autoRetryUsed });
    // Arka planda başlat — bu HTTP isteğinin cevabını BEKLEMİYOR.
    runJob(id, devices, resolvedParams, workerCount).catch((e) => {
      console.error(`[BULK-JOB ${id}] iş çöktü:`, e);
      dbFns.setBulkJobStatus(id, "done");
    });
    return id;
  }

  function stopJob(jobId) {
    stopRequested.add(jobId);
    dbFns.setBulkJobStatus(jobId, "stopped");
  }

  function getJob(jobId) {
    return dbFns.getBulkJob(jobId);
  }

  function listJobs(opts) {
    return dbFns.listBulkJobs(opts);
  }

  function dismissJob(jobId) {
    cancelAutoRetryTimer(jobId);
    dbFns.dismissBulkJob(jobId);
  }

  // ── Otomatik tekrar ("alarm" gibi: N dakikada bir, toplam M kere) ──
  // Bir iş "done" olunca çağrılır. Ayarlar doluysa VE hâlâ başarısız/
  // doğrulanamamış cihaz VE hak kaldıysa, N dakika sonrası için bir
  // zamanlayıcı kurar (bkz. armAutoRetryTimer).
  function maybeScheduleAutoRetry(jobId) {
    const job = dbFns.getBulkJob(jobId);
    if (!job) return;
    const minutes = Number(job.auto_retry_minutes) || 0;
    const max = Number(job.auto_retry_max) || 0;
    if (minutes <= 0 || max <= 0) return;
    if ((job.auto_retry_used || 0) >= max) return;
    const retryDevices = job.devices.filter((d) => RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return; // hepsi başarılı — tekrara gerek yok

    const nextAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    dbFns.setBulkJobAutoRetryNextAt(jobId, nextAt);
    armAutoRetryTimer(jobId, minutes * 60 * 1000, fireAutoRetry);
    console.log(`[BULK-JOB ${jobId}] otomatik tekrar planlandı: ${minutes}dk sonra (${(job.auto_retry_used || 0) + 1}/${max}, ${retryDevices.length} cihaz)`);
  }

  async function fireAutoRetry(jobId) {
    const job = dbFns.getBulkJob(jobId);
    // Kapatılmış (dismiss) ya da elle iptal edilmişse (auto_retry_next_at
    // temizlenmişse) sessizce çık.
    if (!job || job.dismissed || !job.auto_retry_next_at) return;
    dbFns.setBulkJobAutoRetryNextAt(jobId, null); // bu tur tüketildi

    const retryDevices = job.devices.filter((d) => RETRYABLE_PHASES.includes(d.phase));
    if (retryDevices.length === 0) return;

    // device_id yerine MAC üzerinden yeniden çözülüyor — bkz. server.js'teki
    // manuel retry ucundaki aynı gerekçe (id'ler bir toplu düzenleme/import
    // sonrası değişmiş olabilir, MAC değişmez).
    const retryMacs = new Set(retryDevices.map((d) => d.mac).filter(Boolean));
    const freshDevices = dbFns.getDevices({}).filter((d) => retryMacs.has(d.mac));
    if (freshDevices.length === 0) {
      console.warn(`[BULK-JOB ${jobId}] otomatik tekrar: cihazlar artık bulunamıyor (MAC eşleşmedi)`);
      return;
    }

    const nextUsed = (job.auto_retry_used || 0) + 1;
    const newId = startJob({
      company: job.company,
      params: job.params.map((p) => ({ id: p.id, value: p.value })),
      devices: freshDevices,
      createdBy: job.created_by,
      workerCount: job.worker_count || 1,
      autoRetryMinutes: job.auto_retry_minutes,
      autoRetryMax: job.auto_retry_max,
      autoRetryUsed: nextUsed,
    });
    dbFns.setBulkJobAutoRetryChild(jobId, newId);
    console.log(`[BULK-JOB ${jobId}] otomatik tekrar (#${nextUsed}/${job.auto_retry_max}) tetiklendi -> ${newId} (${freshDevices.length} cihaz)`);
  }

  // Elle "Tekrar Dene"ye basılırsa, o işe ait bekleyen otomatik tekrar
  // artık gereksiz (manuel tekrar zaten yeni bir iş açacak) — çakışıp iki
  // ayrı retry job'u doğmasın diye iptal edilir.
  function cancelScheduledAutoRetry(jobId) {
    cancelAutoRetryTimer(jobId);
    dbFns.setBulkJobAutoRetryNextAt(jobId, null);
  }

  // Sunucu yeniden başladığında bekleyen otomatik tekrarları DB'den okuyup
  // yeniden kurar — server.js başlangıçta bir kere çağırır.
  function resumeAutoRetries() {
    const pending = dbFns.listPendingAutoRetryBulkJobs();
    for (const row of pending) {
      const delay = new Date(row.auto_retry_next_at).getTime() - Date.now();
      armAutoRetryTimer(row.id, delay, fireAutoRetry);
    }
    if (pending.length) console.log(`[BULK-JOB] ${pending.length} bekleyen otomatik tekrar yeniden kuruldu`);
  }

  return { startJob, stopJob, dismissJob, getJob, listJobs, BULK_PARAMS, RETRYABLE_PHASES, cancelScheduledAutoRetry, resumeAutoRetries };
}

module.exports = { initBulkJobs };
