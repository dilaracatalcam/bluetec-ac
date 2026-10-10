import { useState, useEffect, useCallback, useRef } from "react";
import {
  HiOutlineArrowUpTray, HiOutlineCheckCircle, HiOutlineExclamationCircle,
  HiOutlineXMark, HiOutlineArrowPath, HiOutlineBolt, HiOutlineClock,
} from "react-icons/hi2";

/* ── Toplu Güncelleme (OTA firmware) ──
   Gerçek akış (bağlan → şarj kontrolü → OTA komutu → indirme/yazma/doğrulama
   log izleme) artık BACKEND'de çalışıyor (bkz. ota-bulk-jobs.js) — Toplu
   Parametre ile aynı gerekçe: tarayıcı sekmesine bağlı kalmasın, panelde
   gezinsen/sekmeyi kapatsan bile iş sunucuda sürsün. Bu bileşen sadece bir
   iş başlatıp durumunu SORAN bir izleyici. */

// ESP indirmeleri uçtan uca ~5-6sn, MSP ~1sn sürebiliyor (bkz. backend'deki
// ota-bulk-jobs.js MONITOR_INTERVAL_MS açıklaması) — panel bu hıza yetişsin
// diye sıkı pollüyoruz.
const POLL_MS = 1000;

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

const HARD_PHASES = ["success", "uptodate", "failed", "skipped"];
const DONE_PHASES = ["success", "uptodate", "unverified", "noresponse", "failed", "skipped"];

// "3dk 12sn" gibi — bkz. backend'deki formatDuration (ota-bulk-jobs.js), aynı biçim.
function formatCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}dk ${r}sn` : `${r}sn`;
}

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

  // Sürüm doğrulaması — test cihazları kasten eski sürümü bildirdiği için
  // varsayılan KAPALI. Sahada gerçek dağıtım yaparken açın.
  const [verifyVersion, setVerifyVersion] = useState(false);

  // Otomatik tekrar — telefon alarmı gibi: "N dakikada bir, toplam M kere"
  // İş bitince hâlâ başarısız/doğrulanamamış cihaz kaldıysa, panelde kimse
  // olmasa bile arka planda kendiliğinden tekrar dener (bkz. ota-bulk-jobs.js
  // maybeScheduleAutoRetry). Varsayılan KAPALI — mevcut davranışı bozmasın.
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(false);
  const [autoRetryMinutes, setAutoRetryMinutes] = useState(15);
  const [autoRetryMax, setAutoRetryMax] = useState(4);

  // Kaç cihaz aynı anda ("robot session" ile) tetiklensin — Toplu
  // Parametre'deki ile aynı mantık, artık her cihaz kendi bağımsız sahte
  // kimliğiyle (ota:<jobId>:w0, w1, ...) çalışıyor. İndirmenin bant
  // genişliği ayrı bir HTTP hattından gittiği için parametre işine göre
  // biraz daha ihtiyatlı bir varsayılanla başlıyoruz.
  const [workerCount, setWorkerCount] = useState(4);

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
  const selectAllInCompany = () => {
    setSelectedDevices((prev) => {
      const next = { ...prev };
      companyDevices.forEach((d) => {
        next[d.mac] = { mac: d.mac, location: d.location, device_code: d.device_code, company: d.company };
      });
      return next;
    });
  };
  const removeSelected = (mac) => setSelectedDevices((prev) => { const n = { ...prev }; delete n[mac]; return n; });
  const clearSelection = () => setSelectedDevices({});

  // ── İş (job) durumu — artık backend'de kalıcı. Bu bileşen sadece
  // başlatıp/durdurup periyodik olarak durumunu soruyor. Panelde başka
  // yere gitsen, sekmeyi kapatsan bile iş sunucuda sürüyor. ──
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [jobActionError, setJobActionError] = useState("");
  const pollRef = useRef(null);

  const fetchJob = useCallback(async (jobId) => {
    try {
      const r = await authFetch(`/api/ota-bulk-jobs/${jobId}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.job;
    } catch { return null; }
  }, [authFetch]);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const startPolling = useCallback((jobId) => {
    stopPolling();
    const tick = async () => {
      const j = await fetchJob(jobId);
      if (!j) return;
      setJob(j);
      // Otomatik tekrar tetiklendiyse (bkz. auto_retry_child_id) izlemeyi
      // sessizce yeni işe devret — kullanıcı elle bir şey yapmadan zincir sürsün.
      if (j.auto_retry_child_id && j.auto_retry_child_id !== jobId) {
        startPolling(j.auto_retry_child_id);
        return;
      }
      // İş bitti ama bekleyen bir otomatik tekrar varsa (geri sayım için)
      // pollamaya devam et — sadece "done" olması yetmez.
      if (j.status !== "running" && !j.auto_retry_next_at) stopPolling();
    };
    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }, [fetchJob]);

  useEffect(() => () => stopPolling(), []);

  // Sayfa açılır açılmaz — devam eden ya da az önce bitmiş ama henüz
  // kapatılmamış bir iş var mı diye bak, varsa yakala.
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch("/api/ota-bulk-jobs");
        const d = await r.json();
        const recent = (d.jobs || [])[0];
        if (recent) startPolling(recent.id);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startBulkUpdate = async () => {
    const devices = Object.values(selectedDevices);
    if (devices.length === 0) return;
    setStarting(true);
    try {
      const r = await authFetch("/api/ota-bulk-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: selectedCompany || null,
          kind: otaType === "1" ? "esp" : "msp",
          verifyVersion,
          workerCount,
          autoRetryMinutes: autoRetryEnabled ? autoRetryMinutes : 0,
          autoRetryMax: autoRetryEnabled ? autoRetryMax : 0,
          devices: devices.map((d) => ({ mac: d.mac, location: d.location, device_code: d.device_code })),
        }),
      });
      const d = await r.json();
      if (r.ok && d.id) startPolling(d.id);
      else setJobActionError(d.error || "Başlatılamadı");
    } catch {
      setJobActionError("Sunucuya ulaşılamadı");
    }
    setStarting(false);
  };

  const stopBulkUpdate = async () => {
    if (!job) return;
    try { await authFetch(`/api/ota-bulk-jobs/${job.id}/stop`, { method: "POST" }); } catch {}
  };

  const closeJob = async () => {
    stopPolling();
    if (job) { try { await authFetch(`/api/ota-bulk-jobs/${job.id}/dismiss`, { method: "POST" }); } catch {} }
    setJob(null);
  };

  const retryFailed = async () => {
    if (!job) return;
    setJobActionError("");
    try {
      const r = await authFetch(`/api/ota-bulk-jobs/${job.id}/retry`, { method: "POST" });
      const d = await r.json();
      if (r.ok && d.id) startPolling(d.id);
      else setJobActionError(d.error || "Tekrar denenemedi");
    } catch {
      setJobActionError("Sunucuya ulaşılamadı");
    }
  };

  const selectedList = Object.values(selectedDevices);
  const jobDevices = job?.devices || [];
  const counts = jobDevices.reduce((acc, d) => { acc[d.phase] = (acc[d.phase] || 0) + 1; return acc; }, {});
  const doneCount = DONE_PHASES.reduce((n, p) => n + (counts[p] || 0), 0);
  const running = job?.status === "running";
  const allDone = !!job && !running;
  const retryableCount = jobDevices.filter((d) => ["failed", "skipped", "noresponse", "unverified"].includes(d.phase)).length;
  const canRetry = allDone && retryableCount > 0;

  return (
    <div>

      {!job && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
                Şirket
              </label>
              <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                <option value="">Şirket seçin...</option>
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
                Güncelleme Tipi (tüm seçim için ortak)
              </label>
              <div className="flex gap-2">
                <button onClick={() => setOtaType("1")}
                  className={`flex-1 text-[13px] font-bold py-2 rounded-lg border transition
                    ${otaType === "1" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]"}`}>
                  ESP
                </button>
                <button onClick={() => setOtaType("2")}
                  className={`flex-1 text-[13px] font-bold py-2 rounded-lg border transition
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
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  Sürüm doğrulaması yap
                </span>
                <span className="block text-[11px] text-[var(--text-muted)] leading-snug">
                  Açıkken, firmware yazıldıktan sonra cihazın yeni sürümü bildirmesi beklenir (20-30 dk sürebilir).
                  Sürümü kasten sabitlenmiş test cihazlarında kapalı bırakın — aksi halde çalışan güncelleme
                  "doğrulanamadı" görünür.
                </span>
              </span>
            </label>
          </div>

          <div className="mb-4 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={autoRetryEnabled}
                onChange={(e) => setAutoRetryEnabled(e.target.checked)}
                className="mt-[2px] cursor-pointer" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  Başarısız cihazları otomatik tekrar dene
                </span>
                <span className="block text-[11px] text-[var(--text-muted)] leading-snug">
                  Alarm gibi çalışır: iş bitince hâlâ güncellenemeyen cihaz kaldıysa, aşağıdaki aralıkla
                  kendiliğinden yeniden dener — panelde kimse olmasa bile.
                </span>
              </span>
            </label>
            {autoRetryEnabled && (
              <div className="flex items-center gap-4 mt-3 pl-[26px] flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--text-muted)]">Kaç dakikada bir</label>
                  <input type="number" min={1} max={1440} value={autoRetryMinutes}
                    onChange={(e) => setAutoRetryMinutes(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition text-center" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--text-muted)]">Kaç kere denesin</label>
                  <input type="number" min={1} max={20} value={autoRetryMax}
                    onChange={(e) => setAutoRetryMax(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition text-center" />
                </div>
              </div>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
              MAC Adresi ile Ekle
            </label>
            <div className="flex gap-2">
              <input type="text" value={manualMac}
                onChange={(e) => setManualMac(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddManualMac()}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition font-mono
                           placeholder:text-[var(--text-muted)]" />
              <button onClick={handleAddManualMac}
                className="text-[12px] font-semibold px-4 py-2 rounded-lg border
                           bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] transition cursor-pointer shrink-0">
                Ekle
              </button>
            </div>
            {manualMacError && <p className="text-[12px] text-rose-500 font-medium mt-1.5">{manualMacError}</p>}
          </div>

          {selectedCompany && (
            <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-4">
              <div className="px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] flex items-center justify-between">
                <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">
                  {selectedCompany} — {companyDevices.length} cihaz
                </span>
                {companyDevices.length > 0 && (
                  <button onClick={selectAllInCompany} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">
                    Tümünü Seç
                  </button>
                )}
              </div>
              <div className="max-h-[280px] overflow-y-auto custom-scroll divide-y divide-[var(--border-subtle)]">
                {loadingDevices ? (
                  <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Yükleniyor...</div>
                ) : companyDevices.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Bu şirkete ait cihaz yok</div>
                ) : companyDevices.map((d) => (
                  <label key={d.id} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--bg-hover)] transition">
                    <input type="checkbox" checked={!!selectedDevices[d.mac]} onChange={() => toggleDevice(d)} className="cursor-pointer" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || "—"} {d.device_code && <span className="text-[var(--text-muted)]">— {d.device_code}</span>}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono">{d.mac}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">
                Seçilen Cihazlar ({selectedList.length})
              </span>
              {selectedList.length > 0 && (
                <button onClick={clearSelection} className="text-[11px] font-semibold text-rose-500 hover:underline">
                  Tümünü Temizle
                </button>
              )}
            </div>
            {selectedList.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
                Henüz cihaz seçilmedi — yukarıdan şirket seçip cihaz işaretleyin
              </div>
            ) : (
              <div className="max-h-[200px] overflow-y-auto custom-scroll divide-y divide-[var(--border-subtle)]">
                {selectedList.map((d) => (
                  <div key={d.mac} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || "—"} <span className="text-[var(--text-muted)]">({d.company})</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] font-mono">{d.mac}</div>
                    </div>
                    <button onClick={() => removeSelected(d.mac)} className="p-1 text-[var(--text-muted)] hover:text-rose-500 transition">
                      <HiOutlineXMark className="text-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {jobActionError && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[12px] text-rose-500 font-medium">
              {jobActionError}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--text-muted)]">
                Paralel
              </label>
              <select value={workerCount} onChange={(e) => setWorkerCount(Number(e.target.value))}
                className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-2 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          <button onClick={startBulkUpdate} disabled={selectedList.length === 0 || starting}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold border transition
              ${selectedList.length === 0 || starting
                ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
            <HiOutlineBolt className="text-[14px]" />
            {starting ? "Başlatılıyor..." : `${selectedList.length} Cihazı Güncelle (${otaType === "1" ? "ESP" : "MSP"})`}
          </button>
          </div>
        </>
      )}

      {job && (
        <>
          <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-muted)]">
            <b className="text-[var(--text-primary)]">{job.kind === "esp" ? "ESP" : "MSP"}</b> güncellemesi
            {job.created_by && <> — başlatan: <b>{job.created_by}</b></>}
            {job.worker_count > 1 && <> — <b>{job.worker_count}</b> paralel şerit</>}
          </div>

          {jobActionError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[12px] text-rose-500 font-medium">
              {jobActionError}
            </div>
          )}

          {job.auto_retry_next_at && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-500 font-medium flex items-center gap-1.5">
              <HiOutlineClock className="text-[13px] shrink-0" />
              Otomatik tekrar deneme {(job.auto_retry_used || 0) + 1}/{job.auto_retry_max}
              {" — "}{formatCountdown(new Date(job.auto_retry_next_at).getTime() - Date.now())} sonra başlayacak
            </div>
          )}

          <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-4 text-[12px] font-semibold flex-wrap">
              <span className="text-emerald-500">✓ {counts.success || 0} başarılı</span>
              {(counts.uptodate || 0) > 0 && <span className="text-sky-500">{counts.uptodate} zaten güncel</span>}
              {(counts.unverified || 0) > 0 && <span className="text-amber-500">{counts.unverified} doğrulanamadı</span>}
              {(counts.noresponse || 0) > 0 && <span className="text-amber-500">{counts.noresponse} yanıt yok (izleniyor)</span>}
              <span className="text-rose-500">✕ {(counts.failed || 0) + (counts.skipped || 0)} başarısız/atlandı</span>
              {running && (
                <span className="text-amber-500 flex items-center gap-1">
                  <HiOutlineClock className="text-[13px]" />
                  {jobDevices.length - doneCount} devam ediyor
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canRetry && (
                <button onClick={retryFailed}
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-2 rounded-lg border
                             bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20 transition cursor-pointer">
                  <HiOutlineArrowPath className="text-[12px]" />
                  {retryableCount} Tanesini Tekrar Dene
                </button>
              )}
              <button onClick={allDone ? closeJob : stopBulkUpdate}
                className="text-[11px] font-semibold px-3.5 py-2 rounded-lg border bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer">
                {allDone ? "Kapat" : "Durdur"}
              </button>
            </div>
          </div>

          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {jobDevices.map((d) => {
              const isHard = HARD_PHASES.includes(d.phase);
              const isGood = d.phase === "success" || d.phase === "uptodate";
              const isWarn = d.phase === "noresponse" || d.phase === "unverified";
              return (
                <div key={d.mac} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">{d.location || d.mac}</span>
                      <span className="text-[11px] text-[var(--text-muted)] font-mono ml-2">{d.mac}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isGood && <HiOutlineCheckCircle className="text-emerald-500 text-[14px]" />}
                      {isHard && !isGood && <HiOutlineExclamationCircle className="text-rose-500 text-[14px]" />}
                      {isWarn && <HiOutlineExclamationCircle className="text-amber-500 text-[14px]" />}
                      {!isHard && !isWarn && <HiOutlineArrowPath className="text-amber-500 text-[14px] animate-spin" />}
                      <span className={`text-[12px] font-bold ${PHASE_COLORS[d.phase] || "text-[var(--text-muted)]"}`}>
                        {PHASE_LABELS[d.phase] || d.phase}
                      </span>
                    </div>
                  </div>
                  {d.message && <p className="text-[11px] text-[var(--text-muted)]">{d.message}</p>}
                  {d.percent !== null && d.percent !== undefined && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                        <div className={`h-full transition-all duration-500 ${isGood ? "bg-emerald-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.max(0, Math.min(100, Number(d.percent) || 0))}%` }} />
                      </div>
                      <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0 w-9 text-right">
                        %{d.percent}
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
