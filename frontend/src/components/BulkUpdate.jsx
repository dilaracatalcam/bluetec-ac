import { useState, useEffect, useCallback, useRef } from "react";
import {
  HiOutlineArrowUpTray, HiOutlineCheckCircle, HiOutlineExclamationCircle,
  HiOutlineXMark, HiOutlineArrowPath, HiOutlineBolt, HiOutlineClock,
} from "react-icons/hi2";

/* ─────────────────────────────────────────────────────────────
   ZAMAN SABITLERI — gercek log olcumlerine gore kalibre edildi

   ESP (fw_hw13_v407.bin, 1.8 MB):
     manifest -> indirme baslangici : 3sn ile 128sn arasi olculdu
     indirme suresi                 : ~2.5 dakika
     indirme icindeki en uzun sessizlik: ~26sn
   MSP (msp_hw31.txt, 58 KB):
     indirme suresi                 : ~1 saniye

   Eski kodda tek bir 90sn "hic baslamadi" suresi vardi ve bu, manifest
   aldiktan 128 saniye sonra indirmeye baslayan CALISAN cihazlari
   "yanit alinamadi" diye gomuyordu.
   ───────────────────────────────────────────────────────────── */
const TIMING = {
  esp: {
    STUCK_TIMEOUT_MS: 120 * 1000,        // indirme yuzdesi bu kadar ilerlemezse takildi
    NO_ACTIVITY_GRACE_MS: 360 * 1000,    // "preparing update" KOR PENCERESI (asagiya bkz.)
    PREPARE_TIMEOUT_MS: 240 * 1000,      // manifest var ama indirme baslamiyor
    VERIFY_WINDOW_MS: 25 * 60 * 1000,    // update_written sonrasi surum dogrulama (asagiya bkz.)
  },
  msp: {
    STUCK_TIMEOUT_MS: 60 * 1000,
    NO_ACTIVITY_GRACE_MS: 240 * 1000,
    PREPARE_TIMEOUT_MS: 120 * 1000,
    VERIFY_WINDOW_MS: 0,                 // MSP'de msp_write_success dogrudan kesin basari
  },
};

/* ── "PREPARING UPDATE" KOR PENCERESI ──
   ESP, guncelleme komutunu aldiktan sonra kendi icinde hazirlik yapiyor
   (MQTT'yi birakip HTTP'ye geciyor). Bu sure boyunca OTA sunucusuna HIC
   dokunmuyor, dolayisiyla LOGLARDA HICBIR IZ YOK. Ilk iz cihazin
   /firmware.json istegidir.

   Bu pencere cihazdan cihaza degisiyor ve ust siniri bilinmiyor. Bu yuzden:
     - sure comert tutuluyor,
     - sure dolsa bile cihaz KALICI basarisiz sayilmiyor; "Yanit yok"
       durumuna gecip IZLENMEYE DEVAM ediyor. Sonradan loglarda gorunurse
       otomatik "Indiriliyor"a doner.
     - gercek baslama gecikmesi olculup ekranda gosteriliyor ki bu sabit
       ileride kesin veriyle ayarlanabilsin.
   Panelin "basarisiz" demesi indirmeyi durdurmaz — o yuzden panel de
   kesin konusmamali. */

/* ── SURUM DOGRULAMA (opsiyonel) ──
   update_written "flash'a yazdim" demektir, "yeni surumle acildim" DEMEZ.
   Gercek kanit, cihazin reboot sonrasi /firmware.json cekip uzerindeki
   surumu bildirmesidir.

   ANCAK: test duzeninde cihazlar KASTEN eski surumu bildiriyor — boylece
   sunucu her turda yeni firmware onerir ve tekrar tekrar guncelleme
   denemesi yapilabilir (aksi halde no_new_firmware gelir). Bu yuzden
   surum dogrulamasi ZORUNLU KRITER DEGIL, acilip kapanabilir:
     - Test cihazlarinda KAPALI  -> update_written dogrudan basari
     - Sahada gercek dagitimda ACIK -> surum eslesmesi aranir

   Dogrulama acikken olculen check-in araligi (cihaz kendi periyoduyla
   bildiriyor, biz tetikleyemiyoruz):
     09:57 update_written -> 10:15 check-in  (18 dk)
     09:55 update_written -> 10:22 check-in  (27 dk)
   Bu yuzden pencere 25 dakika. Eslesmezlik "basarisiz" degil "dogrulanamadi"
   olarak isaretlenir — sebebi kasitli surum sabitlemesi de olabilir. */

function formatDuration(ms) {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}sn`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}dk ${r}sn` : `${m}dk`;
}

/* Activate denemeleri ve her denemeden sonra beklenecek saniye.
   Ilk deneme uzun: update-target'i erken yeniden gondermek deactivate ->
   activate dongusunu bastan baslatip sureci kendi kendine kesiyor. */
const ACTIVATE_WAITS = [60, 30, 30];
const MONITOR_INTERVAL_MS = 5000;

/* Komut gonderildikten sonra, indirme baslayana kadar siradaki cihaza
   GECILMEZ (bkz. triggerDevice icindeki "KRITIK PENCERE" aciklamasi).
   Olculen baslama gecikmeleri: 15sn, 21sn, 23sn, 34sn, 1dk47sn, 3dk5sn. */
const HANDOFF_WAIT_MS = 210 * 1000;
const HANDOFF_POLL_MS = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASE_LABELS = {
  queued: "Sırada",
  connecting: "Bağlanıyor",
  "checking-charge": "Şarj kontrolü",
  sending: "Komut gönderiliyor",
  waiting: "Hazırlanıyor",
  preparing: "Sunucuya bağlandı",
  downloading: "İndiriliyor",
  verifying: "Doğrulanıyor",
  success: "Başarılı",
  uptodate: "Zaten güncel",
  unverified: "Doğrulanamadı",
  noresponse: "Yanıt yok",
  skipped: "Atlandı",
  failed: "Başarısız",
};

const PHASE_COLORS = {
  queued: "text-[var(--text-muted)]",
  connecting: "text-sky-500",
  "checking-charge": "text-sky-500",
  sending: "text-sky-500",
  waiting: "text-sky-500",
  preparing: "text-sky-500",
  downloading: "text-amber-500",
  verifying: "text-amber-500",
  success: "text-emerald-500",
  uptodate: "text-sky-500",
  unverified: "text-amber-500",
  noresponse: "text-amber-500",
  skipped: "text-rose-500",
  failed: "text-rose-500",
};

/* Bu fazlardaki cihazlar loglardan takip edilmeye DEVAM eder.
   noresponse ve unverified de burada — cihaz gec de olsa ortaya cikarsa
   panel kendi kararini geri alip dogru duruma gecebilsin. */
const MONITORED_PHASES = ["waiting", "preparing", "downloading", "verifying", "noresponse", "unverified"];

/* Sayacta "bitti" kabul edilenler (noresponse/unverified dahil — kullanici
   bekletilmez ama izleme arkada surer). */
const DONE_PHASES = ["success", "uptodate", "unverified", "noresponse", "failed", "skipped"];

/* Gercekten kesin, geri donusu olmayan durumlar */
const HARD_PHASES = ["success", "uptodate", "failed", "skipped"];

export default function BulkUpdate({ token }) {
  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [companyDevices, setCompanyDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [otaType, setOtaType] = useState("1"); // 1=ESP, 2=MSP

  // Surum dogrulamasi — test cihazlari kasten eski surumu bildirdigi icin
  // varsayilan KAPALI. Sahada gercek dagitim yaparken acin.
  const [verifyVersion, setVerifyVersion] = useState(false);
  const verifyVersionRef = useRef(verifyVersion);
  verifyVersionRef.current = verifyVersion;

  const kind = otaType === "1" ? "esp" : "msp";
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const [manualMac, setManualMac] = useState("");
  const [manualMacError, setManualMacError] = useState("");

  const handleAddManualMac = () => {
    setManualMacError("");
    const mac = manualMac.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
      setManualMacError("Geçerli bir MAC adresi girin (örn: AA:BB:CC:DD:EE:FF)");
      return;
    }
    if (selectedDevices[mac]) {
      setManualMacError("Bu MAC zaten seçili");
      return;
    }
    setSelectedDevices((prev) => ({ ...prev, [mac]: { mac, location: null, device_code: null, company: "Elle girildi" } }));
    setManualMac("");
  };

  const [running, setRunning] = useState(false);
  const [deviceStates, setDeviceStates] = useState({});
  const [clockSkewWarning, setClockSkewWarning] = useState(false);

  const runningRef = useRef(false);
  const triggerQueueRef = useRef(Promise.resolve());
  const firstTriggeredAtRef = useRef({});
  // İzleme döngüsü state'i ref'ten okur — böylece her state güncellemesinde
  // setInterval yeniden kurulmaz (eski kodda her tick'te sıfırlanıyordu)
  const deviceStatesRef = useRef({});
  const selectedDevicesRef = useRef({});
  selectedDevicesRef.current = selectedDevices;

  useEffect(() => {
    authFetch("/api/devices/companies").then((r) => r.json()).then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, [authFetch]);

  useEffect(() => {
    if (!selectedCompany) { setCompanyDevices([]); return; }
    setLoadingDevices(true);
    authFetch(`/api/devices?company=${encodeURIComponent(selectedCompany)}`)
      .then((r) => r.json())
      .then((d) => setCompanyDevices(d.devices || []))
      .catch(() => setCompanyDevices([]))
      .finally(() => setLoadingDevices(false));
  }, [selectedCompany, authFetch]);

  const toggleDevice = (d) => {
    setSelectedDevices((prev) => {
      const next = { ...prev };
      if (next[d.mac]) delete next[d.mac];
      else next[d.mac] = { mac: d.mac, location: d.location, device_code: d.device_code, company: d.company };
      return next;
    });
  };

  const removeSelected = (mac) => {
    setSelectedDevices((prev) => { const n = { ...prev }; delete n[mac]; return n; });
  };
  const clearSelection = () => setSelectedDevices({});

  const updateDeviceState = useCallback((mac, patch) => {
    deviceStatesRef.current = {
      ...deviceStatesRef.current,
      [mac]: { ...deviceStatesRef.current[mac], ...patch },
    };
    setDeviceStates(deviceStatesRef.current);
  }, []);

  /* Log durumunu sorgula — kind parametresi ZORUNLU, aksi halde ESP izlerken
     eski bir MSP raporu (ya da tersi) yanlış karara yol açar. */
  const fetchStatuses = useCallback(async (macEntries) => {
    const macsParam = macEntries.map(({ mac, since }) => `${encodeURIComponent(mac)}|${since || 0}`).join(",");
    const r = await authFetch(`/api/ota-server/update-status?macs=${macsParam}&kind=${kindRef.current}`);
    const j = await r.json();
    return j.statuses || {};
  }, [authFetch]);

  /* ── Cihaz ZATEN indiriyor mu? ──
     ÖNEMLİ: Saat kayması varsa lastProgressAt gelecekte çıkar ve
     (Date.now() - lastProgressAt) negatif olur — negatif her zaman
     timeout'tan küçük olduğu için hiçbir şey yapmayan cihaz "aktif"
     sanılırdı. Artık gelecek zamanlı veriye güvenilmiyor. */
  const checkAlreadyActive = useCallback(async (mac) => {
    const t = TIMING[kindRef.current];
    try {
      const statuses = await fetchStatuses([{ mac, since: Date.now() - t.STUCK_TIMEOUT_MS }]);
      const st = statuses[mac];
      if (!st) return null;
      if (st.clockSkew) { setClockSkewWarning(true); return null; }
      if (!st.hasStarted || !st.lastProgressAt) return null;
      const age = Date.now() - st.lastProgressAt;
      if (age < 0) { setClockSkewWarning(true); return null; }  // gelecekten gelen log — güvenme
      return age < t.STUCK_TIMEOUT_MS ? st : null;
    } catch { return null; }
  }, [fetchStatuses]);

  const triggerDevice = useCallback(async (device) => {
    const mac = device.mac;
    if (!firstTriggeredAtRef.current[mac]) firstTriggeredAtRef.current[mac] = Date.now();

    const alreadyActive = await checkAlreadyActive(mac);
    if (alreadyActive) {
      updateDeviceState(mac, {
        phase: "downloading",
        message: "Cihaz zaten indiriyor, bağlanılmadı — log izleniyor...",
        triggeredAt: Date.now(), percent: alreadyActive.percent,
      });
      return;
    }

    /* ── Cihazi aktif hale getirme ──
       DIKKAT: Her update-target cagrisi deactivate -> bekle -> activate
       dongusunu BASTAN baslatiyor. Eski kod her denemede sadece 25sn
       bekleyip komutu yeniden gonderiyordu; dongusu 25sn'den uzun suren
       cihazlarda bu, sureci surekli KENDI KENDINE kesiyordu ve cihaz hic
       aktif olamiyordu. Sahada dogrulandi: ayni cihaza Dashboard'dan
       manuel baglanmak calisiyor (kullanici bir kez gonderip bekliyor),
       toplu guncellemede 5 denemenin hepsi basarisiz oluyordu.
       Bu yuzden ILK denemeye uzun sure taniniyor. */
    let active = false;
    for (let attempt = 1; attempt <= ACTIVATE_WAITS.length && !active; attempt++) {
      if (attempt > 1) {
        const nowActive = await checkAlreadyActive(mac);
        if (nowActive) {
          updateDeviceState(mac, {
            phase: "downloading",
            message: "Cihaz indirmeye başladı, activate gönderilmiyor — log izleniyor...",
            triggeredAt: Date.now(), percent: nowActive.percent,
          });
          return;
        }
      }

      const waitSec = ACTIVATE_WAITS[attempt - 1];
      updateDeviceState(mac, {
        phase: "connecting",
        message: attempt === 1
          ? `Bağlanıyor — cihazın aktif olması bekleniyor (${waitSec}sn)...`
          : `Cihaz aktif değil, activate tekrar gönderiliyor (${attempt}/${ACTIVATE_WAITS.length})...`,
      });

      try {
        const r = await authFetch("/api/update-target", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newTarget: mac }),
        });
        if (!r.ok) continue;
      } catch { continue; }

      for (let i = 0; i < waitSec; i++) {
        await sleep(1000);
        try {
          const r = await authFetch("/api/get-status");
          const j = await r.json();
          if (j.espState === "active") { active = true; break; }
        } catch {}
      }
    }

    if (!active) {
      const totalSec = ACTIVATE_WAITS.reduce((a, b) => a + b, 0);
      updateDeviceState(mac, {
        phase: "failed",
        message: `Cihaz aktif olmadı (${ACTIVATE_WAITS.length} deneme, toplam ${totalSec}sn beklendi)`,
      });
      try { await authFetch("/api/disconnect", { method: "POST" }); } catch {}
      return;
    }

    /* Sarj durumu (id 25) — guvenlik kriteri.
       Cevap zinciri uzun: target.json -> 192.168.1.45 senkron -> denek.py
       (1sn polling) -> MQTT -> ESP -> responses.json -> geri senkron.
       Tek atis ve kisa bekleme, CALISAN cihazi gereksiz yere atliyordu.
       Bu yuzden komut birkac kez gonderiliyor ve toplam bekleme uzun. */
    const CHARGE_ATTEMPTS = 3;
    const CHARGE_POLLS = 10;      // her denemede 10 x 1.5sn = 15sn
    let chargeStatus = null;

    for (let attempt = 1; attempt <= CHARGE_ATTEMPTS && chargeStatus === null; attempt++) {
      updateDeviceState(mac, {
        phase: "checking-charge",
        message: attempt === 1
          ? "Şarj durumu kontrol ediliyor..."
          : `Şarj durumu okunamadı, tekrar soruluyor (${attempt}/${CHARGE_ATTEMPTS})...`,
      });

      try {
        await authFetch("/api/send-command", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "read", variable: 25 }),
        });
      } catch {}

      for (let i = 0; i < CHARGE_POLLS; i++) {
        await sleep(1500);
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === 25);
          if (found && found.data !== undefined && found.data !== null) {
            chargeStatus = String(found.data);
            break;
          }
        } catch {}
      }
    }

    if (chargeStatus === "1") {
      updateDeviceState(mac, { phase: "skipped", message: "Cihaz şu an şarj veriyor — güncellenmedi" });
      try { await authFetch("/api/disconnect", { method: "POST" }); } catch {}
      return;
    }
    if (chargeStatus === null) {
      updateDeviceState(mac, {
        phase: "skipped",
        message: `Şarj durumu ${CHARGE_ATTEMPTS} denemede okunamadı (cihaz MQTT'ye yanıt vermiyor) — güvenlik için atlandı`,
      });
      try { await authFetch("/api/disconnect", { method: "POST" }); } catch {}
      return;
    }

    // OTA tipi (31) + Güncellemeyi başlat (20).
    // SET OK sadece bilgi amaçlı — ESP bu komutlar için güvenilir onay
    // göndermeyebiliyor ama komut fiilen işleniyor. Karar SADECE loglardan.
    updateDeviceState(mac, { phase: "sending", message: "Güncelleme komutu gönderiliyor..." });

    const waitSetOk = async (varId, tries = 5) => {
      for (let i = 0; i < tries; i++) {
        await sleep(1000);
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          if (msgs.find((m) => Number(m.msg) === varId && m.data === "SET OK")) return true;
        } catch {}
      }
      return false;
    };

    try {
      await authFetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set", variable: 31, value: otaType }),
      });
      await waitSetOk(31);
      await authFetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set", variable: 20, value: "1" }),
      });
      await waitSetOk(20);
    } catch {}

    try { await authFetch("/api/disconnect", { method: "POST" }); } catch {}

    updateDeviceState(mac, {
      phase: "waiting", message: "Komut gönderildi, cihaz hazırlanıyor...",
      triggeredAt: Date.now(), percent: null, startDelayMs: null,
    });

    /* ── KRITIK PENCERE: komut gonderildi ama indirme HENUZ baslamadi ──
       session_id = username oldugu icin tek baglanti slotu var. Sirdaki
       cihaza gecmek (update-target) onceki cihazin hedefliligini dusuruyor
       ve deactivate/activate dongusu tetikliyor. ESP tam "preparing update"
       asamasindayken bu MQTT trafigini yerse OTA'yi IPTAL EDIP reboot
       ediyor — loglarda manifest var ama indirme hic baslamiyor olarak
       goruluyor (gercek turda 2 cihazda gozlendi).

       Indirme bir kez basladiktan sonra surec ayri bir HTTP oturumu
       oldugu icin guvenli. Bu yuzden burada indirme baslayana kadar
       (ust sinirla) bekliyoruz. */
    const handoffDeadline = Date.now() + HANDOFF_WAIT_MS;
    while (Date.now() < handoffDeadline) {
      await sleep(HANDOFF_POLL_MS);
      let st = null;
      try {
        const statuses = await fetchStatuses([{ mac, since: firstTriggeredAtRef.current[mac] || 0 }]);
        st = statuses[mac];
      } catch {}

      if (st && st.hasStarted) {
        updateDeviceState(mac, { phase: "downloading", message: "Firmware indiriliyor...", percent: st.percent });
        return; // indirme basladi — siradaki cihaza gecilebilir
      }
      if (st && st.lastResult) return; // kesin bir cevap geldi, izleme dongusu devralsin

      const waited = Date.now() - (firstTriggeredAtRef.current[mac] || Date.now());
      updateDeviceState(mac, {
        phase: st && st.lastActivityAt ? "preparing" : "waiting",
        message: st && st.lastActivityAt
          ? `Cihaz sunucuya bağlandı, indirme bekleniyor — ${formatDuration(waited)}`
          : `Cihaz hazırlanıyor — ${formatDuration(waited)} (sıradaki cihaza geçilmiyor)`,
      });
    }
    /* Sure doldu — siradaki cihaza geciliyor, izleme dongusu bu cihazi
       takip etmeye devam eder. */
  }, [authFetch, otaType, checkAlreadyActive, updateDeviceState, fetchStatuses]);

  const enqueueTrigger = useCallback((device) => {
    const run = () => triggerDevice(device);
    triggerQueueRef.current = triggerQueueRef.current.then(run, run);
    return triggerQueueRef.current;
  }, [triggerDevice]);

  const startBulkUpdate = async () => {
    const devices = Object.values(selectedDevices);
    if (devices.length === 0) return;

    setRunning(true);
    setClockSkewWarning(false);
    runningRef.current = true;
    triggerQueueRef.current = Promise.resolve();
    firstTriggeredAtRef.current = {};

    const initial = {};
    devices.forEach((d) => { initial[d.mac] = { phase: "queued", message: "Sırada bekliyor...", percent: null }; });
    deviceStatesRef.current = initial;
    setDeviceStates(initial);

    for (const device of devices) {
      if (!runningRef.current) break;
      await enqueueTrigger(device);
    }
  };

  const stopBulkUpdate = () => {
    runningRef.current = false;
    setRunning(false);
  };

  /* ── İzleme döngüsü ──
     Sadece [running]'e bağlı; state ref'ten okunuyor. Eski kodda
     deviceStates bağımlılığı yüzünden her güncellemede interval
     yeniden kuruluyordu. */
  useEffect(() => {
    if (!running) return;

    const tick = async () => {
      const t = TIMING[kindRef.current];
      const active = Object.entries(deviceStatesRef.current)
        .filter(([, s]) => MONITORED_PHASES.includes(s.phase));
      if (active.length === 0) return;

      let statuses = {};
      try {
        statuses = await fetchStatuses(active.map(([mac]) => ({ mac, since: firstTriggeredAtRef.current[mac] || 0 })));
      } catch { return; }

      const now = Date.now();

      for (const [mac, cur] of active) {
        const st = statuses[mac];
        if (!st) continue;
        if (st.clockSkew) { setClockSkewWarning(true); continue; }

        if (st.percent !== null && st.percent !== undefined) {
          updateDeviceState(mac, { percent: st.percent });
        }

        /* ── 1. Kesin sonlandırıcı raporlar ── */
        if (st.lastResult === "no_update") {
          updateDeviceState(mac, {
            phase: "uptodate",
            message: `Cihaz zaten güncel${st.currentVersion ? ` (${st.currentVersion})` : ""}`,
          });
          continue;
        }
        if (st.lastResult === "failed") {
          updateDeviceState(mac, { phase: "failed", message: `Güncelleme başarısız: ${st.lastStatus}` });
          continue;
        }

        /* ── 2. MSP: msp_write_success kesin başarı ── */
        if (kindRef.current === "msp" && st.lastResult === "success") {
          updateDeviceState(mac, { phase: "success", percent: 100, message: "MSP güncellendi ✓" });
          continue;
        }

        /* ── 3. ESP: update_written BAŞARI DEĞİL, sadece "flash'a yazıldı" ──
           Loglar gösteriyor ki cihaz bunu dedikten sonra hâlâ eski
           sürümle açılabiliyor. Gerçek başarı = reboot sonrası yeni
           sürümle check-in. */
        if (kindRef.current === "esp" && st.lastResult === "written") {
          // Doğrulama kapalıysa: firmware yazıldı = başarı. Test cihazları
          // kasten eski sürümü bildirdiği için sürüm karşılaştırması
          // anlamlı olmaz.
          if (!verifyVersionRef.current) {
            updateDeviceState(mac, {
              phase: "success", percent: 100,
              message: `Firmware yazıldı ✓${delayNote}`,
            });
            continue;
          }

          const target = st.targetVersion || st.latestVersion;

          if (st.postWriteVersion) {
            if (target && st.postWriteVersion === target) {
              updateDeviceState(mac, { phase: "success", percent: 100, message: `Güncellendi ve doğrulandı ✓ (${st.postWriteVersion})` });
            } else {
              updateDeviceState(mac, {
                phase: "unverified", percent: 100,
                message: `Firmware yazıldı ama cihaz ${st.postWriteVersion} bildiriyor${target ? ` (hedef ${target})` : ""} — sürüm sabitlenmiş olabilir`,
              });
            }
            continue;
          }

          if (st.lastResultAt && now - st.lastResultAt > t.VERIFY_WINDOW_MS) {
            updateDeviceState(mac, {
              phase: "unverified", percent: 100,
              message: "Firmware yazıldı, cihaz sürüm bildirimi yapmadı — doğrulanamadı",
            });
            continue;
          }

          updateDeviceState(mac, {
            phase: "verifying", percent: 100,
            message: "Firmware yazıldı, cihazın sürüm bildirimi bekleniyor (genelde 20-30 dk)...",
          });
          continue;
        }

        /* ── 4. Bilinmeyen status — otomatik başarısız SAYMA, izlemeye devam ── */
        if (st.lastResult === "unknown") {
          updateDeviceState(mac, { message: `Bilinmeyen durum bildirildi: ${st.lastStatus} — izleniyor...` });
        }

        /* Cihaz ilk kez loglarda göründü mü? Gecikmeyi ölç ve sakla —
           "preparing update" kör penceresinin gerçek süresi budur. */
        let startDelayMs = cur.startDelayMs ?? null;
        if (startDelayMs === null && st.lastActivityAt && cur.triggeredAt) {
          const d = st.lastActivityAt - cur.triggeredAt;
          if (d >= 0) startDelayMs = d;
        }
        const delayNote = startDelayMs !== null ? ` — komuttan ${formatDuration(startDelayMs)} sonra başladı` : "";

        /* ── 5. İndirme sürüyor mu? ──
           Buraya "noresponse" durumundan da girilebilir: cihaz geç de olsa
           ortaya çıktıysa panel kendi kararını geri alır. */
        if (st.hasStarted) {
          // %100 = SUNUCUNUN gonderdigi bayt. ESP bu noktada hala flash'a
          // yaziyor olabilir (olculdu: gonderim bitisi 13:50:52 ->
          // update_written 13:51:37, yaklasik 45sn). Cihaz ekraninda daha
          // dusuk bir yuzde gormek normaldir.
          const writing = st.percent === 100;
          const msg = writing
            ? "İndirme tamamlandı, cihaz firmware'i yazıyor..."
            : `Firmware indiriliyor${delayNote}`;
          if (cur.phase !== "downloading" || cur.message !== msg) {
            updateDeviceState(mac, { phase: "downloading", message: msg, startDelayMs });
          }
          if (st.lastProgressAt) {
            const idle = now - st.lastProgressAt;
            if (idle >= 0 && idle > t.STUCK_TIMEOUT_MS) {
              updateDeviceState(mac, {
                phase: "failed",
                message: `%${st.percent ?? "?"}'da takılı kaldı (${Math.round(t.STUCK_TIMEOUT_MS / 1000)}sn ilerlemedi)`,
              });
            }
          }
          continue;
        }

        /* ── 6. Cihaz OTA sunucusuna bağlandı (manifest/check-in) ama henüz
           indirmeye başlamadı. Cihaz CANLI olduğu için ayrı ve daha uzun
           bir süre tanınır. */
        if (st.lastActivityAt) {
          const waited = now - st.lastActivityAt;
          if (waited >= 0 && waited > t.PREPARE_TIMEOUT_MS) {
            updateDeviceState(mac, {
              phase: "noresponse", startDelayMs,
              message: `Cihaz sunucuya bağlandı ama ${formatDuration(waited)}dır indirmeye başlamadı — izleme sürüyor`,
            });
          } else {
            updateDeviceState(mac, {
              phase: "preparing", startDelayMs,
              message: st.updateAvailable === false
                ? `Cihaz sunucuya bağlandı, yeni sürüm görünmüyor${delayNote}`
                : `Cihaz sunucuya bağlandı, indirme bekleniyor${delayNote}`,
            });
          }
          continue;
        }

        /* ── 7. Hâlâ hiçbir iz yok — cihaz "preparing update" kör
           penceresinde olabilir. Süre dolsa bile KALICI başarısız deme:
           izlemeye devam et, cihaz sonradan çıkarsa yukarıdaki dallar
           durumu düzeltir. */
        if (cur.triggeredAt) {
          const elapsed = now - cur.triggeredAt;
          if (elapsed > t.NO_ACTIVITY_GRACE_MS) {
            if (cur.phase !== "noresponse") {
              updateDeviceState(mac, {
                phase: "noresponse",
                message: `${formatDuration(elapsed)}dır OTA sunucusuna bağlanmadı — izleme sürüyor, cihaz geç başlarsa durum güncellenir`,
              });
            } else {
              updateDeviceState(mac, {
                message: `${formatDuration(elapsed)}dır OTA sunucusuna bağlanmadı — izleme sürüyor, cihaz geç başlarsa durum güncellenir`,
              });
            }
          } else {
            updateDeviceState(mac, {
              phase: "waiting",
              message: `Cihaz hazırlanıyor — ${formatDuration(elapsed)} (henüz OTA sunucusuna bağlanmadı)`,
            });
          }
        }
      }
    };

    const iv = setInterval(tick, MONITOR_INTERVAL_MS);
    tick();
    return () => clearInterval(iv);
  }, [running, fetchStatuses, updateDeviceState]);

  const selectedList = Object.values(selectedDevices);
  // Sayac SADECE secili cihazlar uzerinden — deviceStates'te onceki bir
  // turdan kalmis kayit varsa sayaca sizmasin (satirlarla tutarsizlik olur)
  const counts = selectedList.reduce((acc, d) => {
    const p = deviceStates[d.mac]?.phase || "queued";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const doneCount = DONE_PHASES.reduce((n, p) => n + (counts[p] || 0), 0);
  const allDone = running && selectedList.length > 0 && doneCount >= selectedList.length;

  return (
    <div>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineArrowUpTray />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
              Toplu Güncelleme
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Birden fazla cihazı güncelleyin — şarj olan cihazlar otomatik atlanır
            </p>
          </div>
        </div>
      </div>

      {clockSkewWarning && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-600">
          Log dosyasındaki zaman damgaları sunucu saatiyle uyuşmuyor. Sonuçlar güvenilir olmayabilir —
          backend'de OTA_LOG_TZ_OFFSET ayarını kontrol edin.
        </div>
      )}

      {!running && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
                Şirket
              </label>
              <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                <option value="">Şirket seçin...</option>
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
                Güncelleme Tipi (tüm seçim için ortak)
              </label>
              <div className="flex gap-2">
                <button onClick={() => setOtaType("1")}
                  className={`flex-1 text-[12px] font-bold py-2 rounded-lg border transition
                    ${otaType === "1" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                  ESP
                </button>
                <button onClick={() => setOtaType("2")}
                  className={`flex-1 text-[12px] font-bold py-2 rounded-lg border transition
                    ${otaType === "2" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                  MSP
                </button>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={verifyVersion}
                onChange={(e) => setVerifyVersion(e.target.checked)}
                className="mt-[2px] cursor-pointer" />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[var(--text-primary)]">
                  Sürüm doğrulaması yap
                </span>
                <span className="block text-[10px] text-[var(--text-muted)] leading-snug">
                  Açıkken, firmware yazıldıktan sonra cihazın yeni sürümü bildirmesi beklenir (20-30 dk sürebilir).
                  Sürümü kasten sabitlenmiş test cihazlarında kapalı bırakın — aksi halde çalışan güncelleme
                  "doğrulanamadı" görünür.
                </span>
              </span>
            </label>
          </div>

          <div className="mb-4">
            <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
              MAC Adresi ile Ekle
            </label>
            <div className="flex gap-2">
              <input type="text" value={manualMac}
                onChange={(e) => setManualMac(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddManualMac()}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)] transition font-mono
                           placeholder:text-[var(--text-muted)]" />
              <button onClick={handleAddManualMac}
                className="text-[11px] font-bold px-4 py-2 rounded-lg border tracking-wide uppercase
                           bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] transition cursor-pointer shrink-0">
                Ekle
              </button>
            </div>
            {manualMacError && <p className="text-[11px] text-rose-500 font-medium mt-1.5">{manualMacError}</p>}
          </div>

          {selectedCompany && (
            <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-4">
              <div className="px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
                <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">
                  {selectedCompany} — {companyDevices.length} cihaz
                </span>
              </div>
              <div className="max-h-[280px] overflow-y-auto custom-scroll divide-y divide-[var(--border-subtle)]">
                {loadingDevices ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">Yükleniyor...</div>
                ) : companyDevices.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">Bu şirkete ait cihaz yok</div>
                ) : companyDevices.map((d) => (
                  <label key={d.id} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--bg-hover)] transition">
                    <input type="checkbox" checked={!!selectedDevices[d.mac]} onChange={() => toggleDevice(d)} className="cursor-pointer" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || "—"} {d.device_code && <span className="text-[var(--text-muted)]">— {d.device_code}</span>}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{d.mac}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">
                Seçilen Cihazlar ({selectedList.length})
              </span>
              {selectedList.length > 0 && (
                <button onClick={clearSelection} className="text-[10px] font-semibold text-rose-500 hover:underline">
                  Tümünü Temizle
                </button>
              )}
            </div>
            {selectedList.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">
                Henüz cihaz seçilmedi — yukarıdan şirket seçip cihaz işaretleyin
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto custom-scroll divide-y divide-[var(--border-subtle)]">
                {selectedList.map((d) => (
                  <div key={d.mac} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || "—"} <span className="text-[var(--text-muted)]">({d.company})</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{d.mac}</div>
                    </div>
                    <button onClick={() => removeSelected(d.mac)} className="p-1 text-[var(--text-muted)] hover:text-rose-500 transition">
                      <HiOutlineXMark className="text-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={startBulkUpdate} disabled={selectedList.length === 0}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-bold border transition tracking-wide uppercase
              ${selectedList.length === 0
                ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 shadow-sm shadow-emerald-500/20 cursor-pointer"}`}>
            <HiOutlineBolt className="text-[14px]" />
            {selectedList.length} Cihazı Güncelle ({otaType === "1" ? "ESP" : "MSP"})
          </button>
        </>
      )}

      {running && (
        <>
          <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-4 text-[11px] font-semibold flex-wrap">
              <span className="text-emerald-500">✓ {counts.success || 0} başarılı</span>
              {(counts.uptodate || 0) > 0 && <span className="text-sky-500">{counts.uptodate} zaten güncel</span>}
              {(counts.unverified || 0) > 0 && <span className="text-amber-500">{counts.unverified} doğrulanamadı</span>}
              {(counts.noresponse || 0) > 0 && <span className="text-amber-500">{counts.noresponse} yanıt yok (izleniyor)</span>}
              <span className="text-rose-500">✕ {(counts.failed || 0) + (counts.skipped || 0)} başarısız/atlandı</span>
              <span className="text-amber-500 flex items-center gap-1">
                <HiOutlineClock className="text-[12px]" />
                {selectedList.length - doneCount} devam ediyor
              </span>
            </div>
            <button onClick={stopBulkUpdate}
              className="text-[10px] font-bold px-3 py-1.5 rounded-md border tracking-wide uppercase bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer">
              {allDone ? "Kapat" : "Durdur"}
            </button>
          </div>

          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {selectedList.map((d) => {
              const s = deviceStates[d.mac] || { phase: "queued", message: "" };
              const isHard = HARD_PHASES.includes(s.phase);
              const isGood = s.phase === "success" || s.phase === "uptodate";
              const isWarn = s.phase === "noresponse" || s.phase === "unverified";
              return (
                <div key={d.mac} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">{d.location || d.mac}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono ml-2">{d.mac}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isGood && <HiOutlineCheckCircle className="text-emerald-500 text-[14px]" />}
                      {isHard && !isGood && <HiOutlineExclamationCircle className="text-rose-500 text-[14px]" />}
                      {isWarn && <HiOutlineExclamationCircle className="text-amber-500 text-[14px]" />}
                      {!isHard && !isWarn && <HiOutlineArrowPath className="text-amber-500 text-[13px] animate-spin" />}
                      <span className={`text-[11px] font-bold ${PHASE_COLORS[s.phase] || "text-[var(--text-muted)]"}`}>
                        {PHASE_LABELS[s.phase] || s.phase}
                      </span>
                    </div>
                  </div>
                  {s.message && <p className="text-[10px] text-[var(--text-muted)]">{s.message}</p>}
                  {s.percent !== null && s.percent !== undefined && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                        <div className={`h-full transition-all duration-500 ${isGood ? "bg-emerald-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.max(0, Math.min(100, Number(s.percent) || 0))}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0 w-9 text-right">
                        %{s.percent}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}