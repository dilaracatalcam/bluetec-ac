import { useState, useEffect, useCallback, useRef } from "react";
import {
  HiOutlinePencilSquare, HiOutlineCheckCircle, HiOutlineExclamationCircle,
  HiOutlineXMark, HiOutlineArrowPath, HiOutlineBolt, HiOutlineClock, HiOutlinePlus,
} from "react-icons/hi2";

/* ── Toplu gönderilebilecek parametreler ──
   Gerçek akış (bağlan → şarj kontrolü → set → aktifleştir → mod → reset →
   yeniden bağlan → doğrula) artık BACKEND'de çalışıyor (bkz. bulk-jobs.js) —
   bu liste sadece dropdown'ı doldurmak için; activateId/modeId/resetId gibi
   "hangi ek adımlar gerekir" bilgisi backend'de de AYNI ŞEKİLDE (güvenlik için
   orada sabit) tutuluyor. Burada sadece etiket ve tip (logo/text) lazım. */
// Aşağıdaki dropdown seçenekleri Home.jsx'teki tekli cihaz ekranının
// (OCPP_WIFI/UI_PARAMS/MSP_CONFIG_ADMIN/ESP_CTRL) etiketleriyle BİREBİR
// aynı — kullanıcı iki ekranda da aynı isimleri görsün diye.
const BULK_PARAMS = [
  { id: 64, label: "Logo Adı", type: "logo" },
  { id: 14, label: "Şirket Adı", type: "text" },
  { id: 10, label: "Site", type: "text" },
  { id: 11, label: "Appstore", type: "text" },
  { id: 12, label: "Play Store", type: "text" },
  { id: 9,  label: "Şirket Tel", type: "text" },
  { id: 1,  label: "OCPP URL", type: "text" },
  { id: 2,  label: "OCPP ID", type: "text" },
  { id: 3,  label: "QR Kod", type: "text" },
  { id: 4,  label: "Maks. Güç", type: "text" },
  { id: 5,  label: "WiFi SSID", type: "text" },
  { id: 6,  label: "WiFi Şifre", type: "text" },
  { id: 7,  label: "Bağlantı Türü", type: "dropdown", options: [
      { value: "0", label: "CommSupported" }, { value: "1", label: "GSM" },
      { value: "2", label: "WiFi" }, { value: "3", label: "ETH" },
    ]},
  { id: 16, label: "AC Ölçer", type: "dropdown", options: [
      { value: "0", label: "MSP Hesaplama" }, { value: "1", label: "AC Meter" },
    ]},
  { id: 17, label: "Konfig Modu", type: "dropdown", options: [
      { value: "0", label: "Ürün Modu" }, { value: "1", label: "Test Modu" },
    ]},
  { id: 19, label: "ESP Modu", type: "dropdown", options: [
      { value: "0", label: "Plug & Charge" }, { value: "1", label: "RFID Charge" }, { value: "2", label: "OCPP Charge" },
    ]},
  { id: 35, label: "Gradient/Renk", type: "dropdown", options: [
      { value: "0", label: "Gradient" }, { value: "1", label: "Renk" },
    ]},
  { id: 38, label: "OCPP Aktif", type: "dropdown", options: [
      { value: "0", label: "Deaktif" }, { value: "1", label: "Aktif" },
    ]},
  { id: 39, label: "CP Vendor", type: "text" },
  { id: 40, label: "CP Model", type: "text" },
  { id: 41, label: "CP Seri No", type: "text" },
  { id: 42, label: "Meter Seri No", type: "text" },
  { id: 43, label: "Meter Tipi", type: "text" },
  { id: 44, label: "Box Seri No", type: "text" },
  { id: 69, label: "OCPP Sanal Mod", type: "dropdown", options: [
      { value: "0", label: "Disable" }, { value: "1", label: "Soket Takılı" }, { value: "2", label: "Şarja Geç" },
    ]},
];

const POLL_MS = 2000;

const PHASE_LABELS = {
  queued: "Sırada", connecting: "Bağlanıyor", sending: "Gönderiliyor",
  restarting: "Yeniden Başlatılıyor",
  verifying: "Doğrulanıyor", success: "Güncellendi", unverified: "Doğrulanamadı",
  failed: "Güncellenemedi",
};
const PHASE_COLORS = {
  queued: "text-[var(--text-muted)]", connecting: "text-sky-500", sending: "text-sky-500",
  restarting: "text-sky-500",
  verifying: "text-amber-500", success: "text-emerald-500", unverified: "text-amber-500",
  failed: "text-rose-500",
};
const DONE_PHASES = ["success", "unverified", "failed"];

// "3dk 12sn" gibi — bkz. backend'deki formatDuration (ota-bulk-jobs.js), aynı biçim.
function formatCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}dk ${r}sn` : `${r}sn`;
}

export default function BulkParamUpdate({ token }) {
  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [companyDevices, setCompanyDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState({}); // { [id]: {id, location, device_code, company} }

  // Birden fazla parametre tek seferde gönderilebilir — her satır kendi
  // parametresini ve değerini taşır (aynı cihazlara, tek bağlantı üzerinden
  // art arda uygulanır, bkz. backend'deki processDevice).
  const rowKeySeq = useRef(0);
  const newRow = () => ({ key: ++rowKeySeq.current, paramId: 64, value: "" });
  const [rows, setRows] = useState(() => [newRow()]);
  const usedParamIds = new Set(rows.map((r) => r.paramId));
  const updateRow = (key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const unused = BULK_PARAMS.find((p) => !usedParamIds.has(p.id));
    if (!unused) return; // hepsi zaten eklenmiş
    setRows((prev) => [...prev, { key: ++rowKeySeq.current, paramId: unused.id, value: "" }]);
  };
  const removeRow = (key) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  // Kaç cihaz aynı anda ("robot session" ile) işlensin — backend'de her biri
  // bağımsız bir sahte kimlikle (bulk:<jobId>:w0, w1, ...) çalışıyor.
  // Sınırlı tutuluyor (max 8) — uzaktaki köprü tek TCP bağlantısı, aşırı
  // paralellik orayı zorlayabilir; ilk denemede düşük tutmak mantıklı.
  const [workerCount, setWorkerCount] = useState(8);

  // Otomatik tekrar — telefon alarmı gibi: "N dakikada bir, toplam M kere"
  // (bkz. BulkUpdate.jsx'teki aynı desen, backend: bulk-jobs.js maybeScheduleAutoRetry).
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(false);
  const [autoRetryMinutes, setAutoRetryMinutes] = useState(15);
  const [autoRetryMax, setAutoRetryMax] = useState(4);

  // Logo Adı için — OTA sunucusunda gerçekten yüklü olan logolar
  const [logoOptions, setLogoOptions] = useState([]);
  const refreshLogoOptions = useCallback(async () => {
    try {
      const r = await authFetch("/api/ota-server/list");
      const d = await r.json();
      const opts = (d.logos || [])
        .map((f) => f.name.replace(/\.bin$/i, ""))
        .map((v) => ({ value: v, label: v.replace(/_logo$/i, "").replace(/_/g, " ") }));
      setLogoOptions(opts);
    } catch {}
  }, [authFetch]);
  useEffect(() => { refreshLogoOptions(); }, [refreshLogoOptions]);

  useEffect(() => {
    authFetch("/api/devices/companies").then((r) => r.json())
      .then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, [authFetch]);

  useEffect(() => {
    if (companies.length === 1 && !selectedCompany) setSelectedCompany(companies[0]);
  }, [companies, selectedCompany]);

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
      if (next[d.id]) delete next[d.id];
      else next[d.id] = { id: d.id, location: d.location, device_code: d.device_code, company: d.company, mac: d.mac };
      return next;
    });
  };
  const selectAllInCompany = () => {
    setSelectedDevices((prev) => {
      const next = { ...prev };
      companyDevices.forEach((d) => {
        next[d.id] = { id: d.id, location: d.location, device_code: d.device_code, company: d.company, mac: d.mac };
      });
      return next;
    });
  };
  const removeSelected = (id) => setSelectedDevices((prev) => { const n = { ...prev }; delete n[id]; return n; });
  const clearSelection = () => setSelectedDevices({});

  // ── İş (job) durumu — artık backend'de kalıcı. Bu bileşen sadece
  // başlatıp/durdurup periyodik olarak durumunu soruyor. Sekme kapansa,
  // sayfa yenilense, "Toplu Parametre"den çıkıp geri dönülse bile iş backend'de
  // sürüyor — sayfa açılır açılmaz aktif bir iş varsa otomatik yakalanır. ──
  const [job, setJob] = useState(null); // { id, status, param_label, value, devices: [...] } | null
  const [starting, setStarting] = useState(false);
  const [jobActionError, setJobActionError] = useState("");
  const pollRef = useRef(null);

  const fetchJob = useCallback(async (jobId) => {
    try {
      const r = await authFetch(`/api/bulk-jobs/${jobId}`);
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
      if (j.auto_retry_child_id && j.auto_retry_child_id !== jobId) {
        startPolling(j.auto_retry_child_id);
        return;
      }
      if (j.status !== "running" && !j.auto_retry_next_at) stopPolling();
    };
    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }, [fetchJob]);

  useEffect(() => () => stopPolling(), []);

  // Sayfa açılır açılmaz — devam eden ya da az önce bitmiş ama henüz
  // kapatılmamış bir iş var mı diye bak, varsa yakala. (Backend "dismissed"
  // olanları zaten listeye hiç koymuyor — "Kapat"a basılan işler bir daha
  // burada çıkmaz.)
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch("/api/bulk-jobs");
        const d = await r.json();
        const recent = (d.jobs || [])[0];
        if (recent) startPolling(recent.id);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRowsFilled = rows.every((r) => r.value);
  const startBulk = async () => {
    const devices = Object.values(selectedDevices);
    if (devices.length === 0 || !allRowsFilled) return;
    setStarting(true);
    try {
      const r = await authFetch("/api/bulk-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: selectedCompany,
          params: rows.map((row) => ({ paramId: row.paramId, value: row.value })),
          deviceIds: devices.map((d) => d.id),
          workerCount,
          autoRetryMinutes: autoRetryEnabled ? autoRetryMinutes : 0,
          autoRetryMax: autoRetryEnabled ? autoRetryMax : 0,
        }),
      });
      const d = await r.json();
      if (r.ok && d.id) startPolling(d.id);
    } catch {}
    setStarting(false);
  };

  const stopBulk = async () => {
    if (!job) return;
    try { await authFetch(`/api/bulk-jobs/${job.id}/stop`, { method: "POST" }); } catch {}
    // Az sonraki poll zaten "stopped" durumunu getirecek — burada forma dönmüyoruz,
    // durdurulan işin son hâli görünür kalsın (istersen ayrıca "Kapat"a basarsın).
  };

  const retryFailed = async () => {
    if (!job) return;
    setJobActionError("");
    try {
      const r = await authFetch(`/api/bulk-jobs/${job.id}/retry`, { method: "POST" });
      const d = await r.json();
      if (r.ok && d.id) startPolling(d.id);
      else setJobActionError(d.error || "Tekrar denenemedi");
    } catch {
      setJobActionError("Sunucuya ulaşılamadı");
    }
  };

  // "Kapat" — sunucuda kalıcı olarak dismiss edilir, bir daha sayfa
  // açılışında otomatik yakalanmaz (kayıt silinmiyor, sadece gizleniyor).
  const closeJob = async () => {
    stopPolling();
    if (job) { try { await authFetch(`/api/bulk-jobs/${job.id}/dismiss`, { method: "POST" }); } catch {} }
    setJob(null);
  };

  // null = kapalı, aksi halde "hangi satırın" logo yükleme paneli açık
  const [showLogoUploadForRow, setShowLogoUploadForRow] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [logoCustomName, setLogoCustomName] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadResult, setLogoUploadResult] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => {
    authFetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setCurrentUser(d); }).catch(() => {});
  }, [authFetch]);
  const isSuperadmin = currentUser?.role === "superadmin";

  const uploadNewLogo = async (rowKey) => {
    if (!logoFile || !logoCustomName.trim()) return;
    setLogoUploading(true);
    setLogoUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", logoFile);
      fd.append("fileType", "logo");
      fd.append("customName", logoCustomName.trim());
      const r = await authFetch("/api/ota-server/upload", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) {
        setLogoUploadResult({ ok: false, message: d.error || "Yükleme başarısız" });
      } else {
        const newValue = `${logoCustomName.trim().replace(/[^a-zA-Z0-9_-]/g, "_")}_logo`;
        await refreshLogoOptions();
        updateRow(rowKey, { value: newValue });
        setLogoFile(null);
        setLogoCustomName("");
        setShowLogoUploadForRow(null);
      }
    } catch {
      setLogoUploadResult({ ok: false, message: "Sunucuya ulaşılamadı" });
    } finally {
      setLogoUploading(false);
    }
  };

  const selectedList = Object.values(selectedDevices);
  const jobDevices = job?.devices || [];
  const counts = jobDevices.reduce((acc, d) => {
    acc[d.phase] = (acc[d.phase] || 0) + 1;
    return acc;
  }, {});
  const doneCount = DONE_PHASES.reduce((n, p) => n + (counts[p] || 0), 0);
  const running = job?.status === "running";
  const allDone = !!job && !running;
  const retryableCount = jobDevices.filter((d) => d.phase === "failed" || d.phase === "unverified").length;
  const canRetry = allDone && retryableCount > 0;

  return (
    <div>

      {!job && (
        <>
          <div className="mb-4">
            <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
              Şirket
            </label>
            <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}
              className="w-full sm:w-1/2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
              <option value="">Şirket seçin...</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
              Parametreler — tek seferde birden fazla gönderilebilir
            </label>
            <div className="flex flex-col gap-3">
              {rows.map((row) => {
                const rowParam = BULK_PARAMS.find((p) => p.id === row.paramId) || BULK_PARAMS[0];
                return (
                  <div key={row.key} className="border border-[var(--border-subtle)] rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <select value={row.paramId} onChange={(e) => updateRow(row.key, { paramId: Number(e.target.value), value: "" })}
                        className="shrink-0 w-[150px] bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                   px-2 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                        {BULK_PARAMS.map((p) => (
                          <option key={p.id} value={p.id} disabled={p.id !== row.paramId && usedParamIds.has(p.id)}>
                            {p.label}
                          </option>
                        ))}
                      </select>

                      <div className="flex-1 min-w-0">
                        {rowParam.type === "logo" ? (
                          <select value={row.value} onChange={(e) => updateRow(row.key, { value: e.target.value })}
                            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                       px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                            <option value="">Logo seçin...</option>
                            {logoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : rowParam.type === "dropdown" ? (
                          <select value={row.value} onChange={(e) => updateRow(row.key, { value: e.target.value })}
                            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                       px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                            <option value="">Değer seçin...</option>
                            {rowParam.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input type="text" value={row.value} onChange={(e) => updateRow(row.key, { value: e.target.value })}
                            placeholder={`${rowParam.label} için yeni değer`}
                            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                       px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition
                                       placeholder:text-[var(--text-muted)]" />
                        )}
                      </div>

                      {rows.length > 1 && (
                        <button onClick={() => removeRow(row.key)} className="shrink-0 p-2 text-[var(--text-muted)] hover:text-rose-500 transition">
                          <HiOutlineXMark className="text-[14px]" />
                        </button>
                      )}
                    </div>

                    {rowParam.type === "logo" && isSuperadmin && (
                      <div className="mt-2 border border-dashed border-[var(--border-subtle)] rounded-lg p-3">
                        {showLogoUploadForRow !== row.key ? (
                          <button type="button" onClick={() => setShowLogoUploadForRow(row.key)}
                            className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)] hover:underline cursor-pointer">
                            <HiOutlinePlus className="text-[14px]" /> Listede yok — yeni logo ekle
                          </button>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <p className="text-[11px] text-[var(--text-muted)]">
                              .c dosyası — OTA sunucusuna otomatik .bin'e çevrilerek yüklenir (OTA Sunucu Kontrolü'ndeki ile aynı işlem)
                            </p>
                            <input type="file" accept=".c"
                              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                              className="text-[12px] text-[var(--text-primary)] file:mr-2 file:px-3 file:py-1.5 file:rounded-md file:border-0
                                         file:bg-[var(--accent-soft)] file:text-[var(--accent)] file:text-[11px] file:font-bold file:cursor-pointer cursor-pointer" />
                            <input type="text" value={logoCustomName} onChange={(e) => setLogoCustomName(e.target.value)}
                              placeholder="logo ismi (örn: otopriz)"
                              className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                         px-3 py-1.5 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition
                                         placeholder:text-[var(--text-muted)]" />
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => uploadNewLogo(row.key)} disabled={!logoFile || !logoCustomName.trim() || logoUploading}
                                className={`text-[12px] font-bold px-3 py-1.5 rounded-md border transition
                                  ${!logoFile || !logoCustomName.trim() || logoUploading
                                    ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                                    : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                                {logoUploading ? "Yükleniyor..." : "Yükle"}
                              </button>
                              <button type="button"
                                onClick={() => { setShowLogoUploadForRow(null); setLogoFile(null); setLogoCustomName(""); setLogoUploadResult(null); }}
                                className="text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                                Vazgeç
                              </button>
                            </div>
                            {logoUploadResult && (
                              <p className={`text-[11px] font-medium ${logoUploadResult.ok ? "text-emerald-500" : "text-rose-500"}`}>
                                {logoUploadResult.message}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {rows.length < BULK_PARAMS.length && (
                <button onClick={addRow}
                  className="self-start flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)] hover:underline cursor-pointer">
                  <HiOutlinePlus className="text-[14px]" /> Parametre Ekle
                </button>
              )}
            </div>
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
                    <input type="checkbox" checked={!!selectedDevices[d.id]} onChange={() => toggleDevice(d)} className="cursor-pointer" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || "—"} {d.device_code && <span className="text-[var(--text-muted)]">— {d.device_code}</span>}
                      </div>
                      {d.mac && <div className="text-[11px] text-[var(--text-muted)] font-mono">{d.mac}</div>}
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
                  <div key={d.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[var(--text-primary)] font-medium truncate">
                        {d.location || d.device_code || `#${d.id}`}
                      </div>
                      {d.mac && <div className="text-[11px] text-[var(--text-muted)] font-mono">{d.mac}</div>}
                    </div>
                    <button onClick={() => removeSelected(d.id)} className="p-1 text-[var(--text-muted)] hover:text-rose-500 transition">
                      <HiOutlineXMark className="text-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            <button onClick={startBulk} disabled={selectedList.length === 0 || !allRowsFilled || starting}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold border transition
                ${selectedList.length === 0 || !allRowsFilled || starting
                  ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                  : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
              <HiOutlineBolt className="text-[14px]" />
              {starting ? "Başlatılıyor..." : `${selectedList.length} Cihaza Gönder`}
            </button>
          </div>
        </>
      )}

      {job && (
        <>
          <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-muted)]">
            {(job.params || []).map((p, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <b className="text-[var(--text-primary)]">{p.label}</b> → <span className="font-mono">{p.value}</span>
              </span>
            ))}
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
              {(counts.unverified || 0) > 0 && <span className="text-amber-500">{counts.unverified} doğrulanamadı</span>}
              <span className="text-rose-500">✕ {counts.failed || 0} güncellenemedi</span>
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
              <button onClick={allDone ? closeJob : stopBulk}
                className="text-[11px] font-semibold px-3.5 py-2 rounded-lg border bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 transition cursor-pointer">
                {allDone ? "Kapat" : "Durdur"}
              </button>
            </div>
          </div>

          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {jobDevices.map((d) => {
              const isGood = d.phase === "success";
              const isBad = d.phase === "failed";
              const isWarn = d.phase === "unverified";
              const isDone = DONE_PHASES.includes(d.phase);
              return (
                <div key={d.device_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {d.location || d.device_code || `#${d.device_id}`}
                      {d.mac && <span className="text-[11px] text-[var(--text-muted)] font-mono ml-2">{d.mac}</span>}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isGood && <HiOutlineCheckCircle className="text-emerald-500 text-[14px]" />}
                      {(isBad || isWarn) && <HiOutlineExclamationCircle className={`text-[14px] ${isBad ? "text-rose-500" : "text-amber-500"}`} />}
                      {!isDone && <HiOutlineArrowPath className="text-amber-500 text-[14px] animate-spin" />}
                      <span className={`text-[12px] font-bold ${PHASE_COLORS[d.phase] || "text-[var(--text-muted)]"}`}>
                        {PHASE_LABELS[d.phase] || d.phase}
                      </span>
                    </div>
                  </div>
                  {d.message && <p className="text-[11px] text-[var(--text-muted)]">{d.message}</p>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
