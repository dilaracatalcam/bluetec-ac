import { useState, useEffect, useCallback, useMemo } from "react";
import { HiOutlineCpuChip, HiOutlineArrowPath, HiOutlineMagnifyingGlass } from "react-icons/hi2";
import { TbPlugConnected } from "react-icons/tb";
import ScrollableTable from "./ScrollableTable.jsx";

export default function DeviceSelect({ token, onConnect }) {
  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  const [companies, setCompanies] = useState([]);
  const [devices, setDevices] = useState([]);
  const [allDevices, setAllDevices] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    authFetch("/api/devices/companies")
      .then((r) => r.json())
      .then((d) => {
        setCompanies(d.companies || []);
        if ((d.companies || []).length === 1) setSelectedCompany(d.companies[0]);
      })
      .catch(() => {});
  }, [authFetch]);

  // Şirket seçmeden konum/MAC ile hızlı arama yapabilmek için tüm (yetkili) cihazları arka planda yükle
  useEffect(() => {
    setLoadingAll(true);
    authFetch("/api/devices")
      .then((r) => r.json())
      .then((d) => { setAllDevices(d.devices || []); setLoadingAll(false); })
      .catch(() => setLoadingAll(false));
  }, [authFetch]);

  useEffect(() => {
    setSelectedDevice(null);
    setSearch("");
    if (!selectedCompany) { setDevices([]); return; }
    setLoading(true);
    authFetch(`/api/devices?company=${encodeURIComponent(selectedCompany)}`)
      .then((r) => r.json())
      .then((d) => { setDevices(d.devices || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedCompany, authFetch]);

  /* Operatörlere backend MAC göndermiyor (yetki sızdırmamak için).
     Liste boyunca hiç MAC yoksa MAC sütununu ve MAC aramasını gizle —
     boş bir sütun göstermenin anlamı yok. */
  const hasMacs = useMemo(
    () => allDevices.some((d) => d.mac) || devices.some((d) => d.mac),
    [allDevices, devices]
  );

  const searchSource = selectedCompany ? devices : (search.trim() ? allDevices : []);
  const isLoading = selectedCompany ? loading : (search.trim() ? loadingAll : false);

  const filtered = searchSource.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (d.location || "").toLowerCase().includes(q) ||
      (d.device_code || "").toLowerCase().includes(q) ||
      (d.serial_no || "").toLowerCase().includes(q) ||
      (d.mac || "").toLowerCase().includes(q) ||
      (d.company || "").toLowerCase().includes(q)
    );
  });

  /* ── Bağlantı ──
     MAC yerine deviceId gönderiliyor. Sebep: operatörler MAC'i hiç görmüyor,
     eski kod `if (!selectedDevice?.mac) return;` ile SESSİZCE geri dönüyordu —
     buton hiçbir şey yapmıyor, hata da göstermiyordu.
     deviceId ile backend MAC'i kendi çözüyor ve yetkiyi kendi doğruluyor. */
  const handleConnect = async () => {
    if (!selectedDevice) return;
    if (selectedDevice.id === undefined || selectedDevice.id === null) {
      setError("Cihaz kimliği okunamadı, sayfayı yenileyip tekrar deneyin");
      return;
    }

    setConnecting(true);
    setError("");
    try {
      const r = await authFetch("/api/update-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selectedDevice.id }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Bağlanılamadı"); setConnecting(false); return; }
      onConnect?.(selectedDevice.mac || "", selectedDevice);
    } catch {
      setError("Sunucuya ulaşılamadı");
      setConnecting(false);
    }
  };

  const gridCols = hasMacs
    ? "grid-cols-[minmax(200px,1fr)_140px_90px]"
    : "grid-cols-[minmax(200px,1fr)_90px]";

  return (
    <div>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineCpuChip />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
              Cihaz Seç
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Bağlanmak istediğiniz cihazı seçin
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)] transition cursor-pointer"
        >
          <option value="">Şirket seçin...</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[13px]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedDevice(null); }}
            placeholder={
              selectedCompany
                ? (hasMacs ? "Konum, ID veya MAC ara..." : "Konum veya ID ara...")
                : (hasMacs ? "MAC, konum veya ID ile ara (şirket seçmeden)..." : "Konum veya ID ile ara (şirket seçmeden)...")
            }
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       pl-8 pr-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)] transition
                       placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>

      {(selectedCompany || search.trim()) && (
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-[11px] text-[var(--text-muted)]">
            {isLoading ? "Yükleniyor..." : (
              <>
                <span className="text-[var(--accent)] font-semibold">{filtered.length}</span>
                {selectedCompany
                  ? (search ? ` sonuç (toplam ${devices.length})` : " cihaz listelendi")
                  : ` sonuç (${allDevices.length} cihaz arasında)`}
              </>
            )}
          </span>
          {isLoading && <HiOutlineArrowPath className="text-[var(--accent)] text-[14px] animate-spin" />}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-4">
          <ScrollableTable minWidth={hasMacs ? "460px" : "320px"}>
            <div className={`grid ${gridCols} px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]`}>
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Konum — ID</span>
              {hasMacs && (
                <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MAC Adresi</span>
              )}
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Bağlantı</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto custom-scroll">
              {filtered.map((d) => {
                const isSelected = selectedDevice?.id === d.id;
                return (
                  <div
                    key={d.id}
                    onClick={() => { setSelectedDevice(d); setError(""); }}
                    className={`grid ${gridCols} items-center px-4 py-3 cursor-pointer transition-colors border-b border-[var(--border-subtle)] last:border-b-0
                      ${isSelected ? "bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]" : "hover:bg-[var(--bg-hover)]"}`}
                  >
                    <div>
                      <div className="text-[12px] text-[var(--text-primary)] font-medium leading-tight">
                        {d.location || "—"}
                        {d.device_code && <span className="text-[var(--text-muted)]"> — {d.device_code}</span>}
                        {!selectedCompany && d.company && (
                          <span className="text-[var(--accent)]"> · {d.company}</span>
                        )}
                      </div>
                      {d.serial_no && (
                        <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">{d.serial_no}</div>
                      )}
                    </div>
                    {hasMacs && (
                      <div className="text-[11px] text-[var(--text-muted)] font-mono truncate pr-2">{d.mac || "—"}</div>
                    )}
                    <div>
                      {d.connection ? (
                        <span className={`inline-flex items-center text-[10px] font-bold px-2 py-[3px] rounded-full
                          ${d.connection.toLowerCase().includes("wifi")
                            ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                          {d.connection}
                        </span>
                      ) : <span className="text-[11px] text-[var(--text-muted)]">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollableTable>
        </div>
      )}

      {!isLoading && (selectedCompany || search.trim()) && filtered.length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineMagnifyingGlass className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[12px]">Eşleşen cihaz bulunamadı</p>
        </div>
      )}

      {!selectedCompany && !search.trim() && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineCpuChip className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[12px]">
            {allDevices.length === 0 && !loadingAll
              ? "Size atanmış cihaz yok"
              : "Bir şirket seçin veya arama yapın"}
          </p>
        </div>
      )}

      {selectedDevice && (
        <div className="mt-2 p-4 bg-[var(--bg-subtle)] border border-[var(--accent-border)] rounded-xl flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {selectedDevice.location || "—"}{selectedDevice.device_code && ` — ${selectedDevice.device_code}`}
            </div>
            {selectedDevice.mac ? (
              <div className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{selectedDevice.mac}</div>
            ) : selectedDevice.company ? (
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{selectedDevice.company}</div>
            ) : null}
            {error && <div className="text-[11px] text-rose-400 font-medium mt-1">{error}</div>}
          </div>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-bold border transition shrink-0 tracking-wide uppercase
              ${connecting
                ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 shadow-sm shadow-emerald-500/30 cursor-pointer"}`}
          >
            <TbPlugConnected className="text-[14px]" />
            {connecting ? "Bağlanılıyor..." : "Seç & Bağlan"}
          </button>
        </div>
      )}
    </div>
  );
}