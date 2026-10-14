import { useState, useEffect, useCallback, useMemo } from "react";
import {
  HiOutlineCpuChip, HiOutlineArrowPath, HiOutlineMagnifyingGlass, HiOutlinePlus, HiOutlineXMark,
} from "react-icons/hi2";
import { TbPlugConnected } from "react-icons/tb";
import ScrollableTable from "./ScrollableTable.jsx";

/* ── Cihaz Seç ──
   - Cihaz Ekle: cihaz ekranındaki 30 karakterlik Bluetech koduyla cihaz hesaba eklenir
     (POST /api/ble/claim-device). Cihaz başka bir bireysel kullanıcıya aitse sahibine
     onay isteği gider; sahibi Hesap Yönetimi'nden onaylar.
   - Şirket seçerek ya da şirket seçmeden arayarak cihaz bulunur, "Seç & Bağlan" ile bağlanılır.
   - Seçili cihazın konum adı ve koordinatları düzenlenebilir (PUT /api/devices/:id/location).
*/
export default function DeviceSelect({ token, onConnect, onSelect, isSuperadmin, autoOpenClaim = false, onClaimOpenHandled }) {
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

  /* Cihaz Ekle (Bluetech kodu) */
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimCode, setClaimCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  /* Konum düzenleme */
  const [editingLocation, setEditingLocation] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationMsg, setLocationMsg] = useState("");
  const [locationForm, setLocationForm] = useState({ location: "", latitude: "", longitude: "" });

  // Üst bardaki "+ Ekle" bu sayfayı kod alanı açık olarak getirir
  useEffect(() => {
    if (autoOpenClaim) {
      setClaimOpen(true);
      onClaimOpenHandled?.();
    }
  }, [autoOpenClaim, onClaimOpenHandled]);

  useEffect(() => {
    authFetch("/api/devices/companies")
      .then((r) => r.json())
      .then((d) => {
        setCompanies(d.companies || []);
        if ((d.companies || []).length === 1) setSelectedCompany(d.companies[0]);
      })
      .catch(() => {});
  }, [authFetch, reloadKey]);

  // Şirket seçmeden arama için tüm (yetkili) cihazlar
  useEffect(() => {
    setLoadingAll(true);
    authFetch("/api/devices")
      .then((r) => r.json())
      .then((d) => { setAllDevices(d.devices || []); setLoadingAll(false); })
      .catch(() => setLoadingAll(false));
  }, [authFetch, reloadKey]);

  const handleClaim = async (e) => {
    e?.preventDefault();
    const code = claimCode.toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{30}$/.test(code)) {
      setClaimMsg("Cihaz ekranındaki 30 karakterlik Bluetech kodunu eksiksiz girin.");
      return;
    }
    setClaiming(true);
    setClaimMsg("");
    try {
      const r = await authFetch("/api/ble/claim-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceToken: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setClaimMsg(d.error || "Cihaz hesabınıza eklenemedi."); return; }
      setClaimMsg(d.pendingApproval
        ? "Onay isteği gönderildi. Cihaz sahibi Hesap Yönetimi bölümünden onaylamalı."
        : d.claimed
          ? "Cihaz hesabınıza eklendi. Liste yenileniyor…"
          : "Bu cihaz hesabınızda zaten yetkili.");
      setClaimCode("");
      setReloadKey((k) => k + 1);
    } catch {
      setClaimMsg("Sunucuya ulaşılamadı.");
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    setSelectedDevice(null);
    setEditingLocation(false);
    setLocationMsg("");
    setSearch("");
    if (!selectedCompany) { setDevices([]); return; }
    setLoading(true);
    authFetch(`/api/devices?company=${encodeURIComponent(selectedCompany)}`)
      .then((r) => r.json())
      .then((d) => { setDevices(d.devices || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedCompany, authFetch, reloadKey]);

  const saveLocation = async (e) => {
    e?.preventDefault();
    if (!selectedDevice?.id) return;
    setSavingLocation(true);
    setLocationMsg("");
    try {
      const r = await authFetch(`/api/devices/${encodeURIComponent(selectedDevice.id)}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(locationForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLocationMsg(d.error || "Konum güncellenemedi."); return; }
      const updated = d.device || { ...selectedDevice, ...locationForm };
      setSelectedDevice(updated);
      setDevices((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setAllDevices((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setLocationMsg("Konum kaydedildi.");
      setEditingLocation(false);
    } catch {
      setLocationMsg("Sunucuya ulaşılamadı.");
    } finally {
      setSavingLocation(false);
    }
  };

  // Operatöre MAC gönderilmiyor — sütun sadece MAC görebilen rollerde gösterilir
  const showMac = useMemo(() => allDevices.some((d) => d.mac) || devices.some((d) => d.mac), [allDevices, devices]);

  const source = selectedCompany ? devices : search.trim() ? allDevices : [];
  const isLoading = selectedCompany ? loading : search.trim() ? loadingAll : false;

  const filtered = source.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (d.location || "").toLowerCase().includes(q)
      || (d.device_code || "").toLowerCase().includes(q)
      || (d.serial_no || "").toLowerCase().includes(q)
      || (d.mac || "").toLowerCase().includes(q)
      || (d.company || "").toLowerCase().includes(q);
  });

  const handleConnect = async (force = false) => {
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
        body: JSON.stringify({ deviceId: selectedDevice.id, force }),
      });
      const data = await r.json();
      if (!r.ok && r.status === 409 && data.code === "DEVICE_OCCUPIED" && isSuperadmin) {
        setConnecting(false);
        if (window.confirm(`Bu cihaz şu anda ${data.occupiedBy} tarafından kullanılıyor.\n\nBağlantısını keserek devralmak istiyor musunuz?`)) {
          handleConnect(true);
        }
        return;
      }
      if (!r.ok) { setError(data.error || "Bağlanılamadı"); setConnecting(false); return; }
      onConnect?.(selectedDevice.mac || "", selectedDevice);
    } catch {
      setError("Sunucuya ulaşılamadı");
      setConnecting(false);
    }
  };

  const gridCols = showMac ? "grid-cols-[minmax(200px,1fr)_140px_90px]" : "grid-cols-[minmax(200px,1fr)_90px]";
  const coordInput = "mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

  return (
    <div>
      {/* ── Cihaz Ekle ── */}
      <div className="mb-5 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
              <HiOutlinePlus className="text-[var(--accent)]" />
              Cihaz Ekle
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
              Cihaz ekranındaki 30 karakterlik Bluetech kodunu girin. Cihaz size aitse hesabınıza eklenir; başka bir bireysel kullanıcıya aitse cihaz sahibine onay isteği gönderilir. Şirket cihazlarını yalnızca şirket yetkilisi hesabı üzerinden ekleyebilirsiniz.
            </p>
          </div>
          <button type="button" onClick={() => { setClaimOpen((o) => !o); setClaimMsg(""); }}
            className="shrink-0 rounded-lg border border-[var(--accent-border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft-hover)]">
            {claimOpen ? <HiOutlineXMark className="text-[16px]" /> : "Kod gir"}
          </button>
        </div>
        {claimOpen && (
          <form onSubmit={handleClaim} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              maxLength={30}
              autoComplete="off"
              spellCheck="false"
              placeholder="B7L9U3E4T7E1C6H3B8L2U6E2T5E6C0"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-[12px] tracking-[0.08em] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <button type="submit" disabled={claiming}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[12px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              {claiming ? "Ekleniyor…" : "Hesabıma ekle"}
            </button>
          </form>
        )}
        {claimMsg && <div className="mt-2 text-[11px] font-medium text-[var(--text-muted)]">{claimMsg}</div>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer"
        >
          <option value="">Şirket seçin...</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[14px]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedDevice(null); }}
            placeholder={selectedCompany
              ? (showMac ? "Konum, ID veya MAC ara..." : "Konum veya ID ara...")
              : (showMac ? "MAC, konum veya ID ile ara (şirket seçmeden)..." : "Konum veya ID ile ara (şirket seçmeden)...")}
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       pl-8 pr-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition
                       placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>

      {(selectedCompany || search.trim()) && (
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-[12px] text-[var(--text-muted)]">
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
          <ScrollableTable minWidth={showMac ? "460px" : "320px"}>
            <div className={`grid ${gridCols} px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]`}>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Konum — ID</span>
              {showMac && <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MAC Adresi</span>}
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Bağlantı</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto custom-scroll">
              {filtered.map((d) => {
                const isSel = selectedDevice?.id === d.id;
                return (
                  <div
                    key={d.id}
                    onClick={() => {
                      setSelectedDevice(d);
                      setLocationForm({ location: d.location || "", latitude: d.latitude ?? "", longitude: d.longitude ?? "" });
                      setEditingLocation(false);
                      setLocationMsg("");
                      setError("");
                      onSelect?.(d);
                    }}
                    className={`grid ${gridCols} items-center px-4 py-3 cursor-pointer transition-colors border-b border-[var(--border-subtle)] last:border-b-0
                      ${isSel ? "bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]" : "hover:bg-[var(--bg-hover)]"}`}
                  >
                    <div>
                      <div className="text-[13px] text-[var(--text-primary)] font-medium leading-tight">
                        {d.location || "—"}
                        {d.device_code && <span className="text-[var(--text-muted)]"> — {d.device_code}</span>}
                        {!selectedCompany && d.company && <span className="text-[var(--accent)]"> · {d.company}</span>}
                      </div>
                      {d.serial_no && <div className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{d.serial_no}</div>}
                    </div>
                    {showMac && <div className="text-[12px] text-[var(--text-muted)] font-mono truncate pr-2">{d.mac || "—"}</div>}
                    <div>
                      {d.connection ? (
                        <span className={`inline-flex items-center text-[11px] font-bold px-2 py-[3px] rounded-full
                          ${d.connection.toLowerCase().includes("wifi")
                            ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                          {d.connection}
                        </span>
                      ) : <span className="text-[12px] text-[var(--text-muted)]">—</span>}
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
          <p className="text-[13px]">Eşleşen cihaz bulunamadı</p>
        </div>
      )}

      {!selectedCompany && !search.trim() && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineCpuChip className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[13px]">
            {allDevices.length === 0 && !loadingAll ? "Size atanmış cihaz yok" : "Bir şirket seçin veya arama yapın"}
          </p>
        </div>
      )}

      {selectedDevice && (
        <>
          <div className="mt-2 p-4 bg-[var(--bg-subtle)] border border-[var(--accent-border)] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[var(--text-primary)] truncate">
                {selectedDevice.location || "—"}{selectedDevice.device_code && ` — ${selectedDevice.device_code}`}
              </div>
              {selectedDevice.mac
                ? <div className="text-[12px] text-[var(--text-muted)] font-mono mt-0.5">{selectedDevice.mac}</div>
                : selectedDevice.company
                  ? <div className="text-[12px] text-[var(--text-muted)] mt-0.5">{selectedDevice.company}</div>
                  : null}
              {error && <div className="text-[12px] text-rose-400 font-medium mt-1">{error}</div>}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setEditingLocation((v) => !v); setLocationMsg(""); }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold border border-[var(--border-subtle)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
                Konumu düzenle
              </button>
              <button
                onClick={() => handleConnect()}
                disabled={connecting}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-bold border transition
                  ${connecting
                    ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                    : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}
              >
                <TbPlugConnected className="text-[14px]" />
                {connecting ? "Bağlanılıyor..." : "Seç & Bağlan"}
              </button>
            </div>
          </div>

          {editingLocation && (
            <form onSubmit={saveLocation}
              className="mt-2 grid grid-cols-1 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto] sm:items-end">
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                Konum adı
                <input value={locationForm.location} placeholder="İstanbul Merkez" className={coordInput}
                  onChange={(e) => setLocationForm((f) => ({ ...f, location: e.target.value }))} />
              </label>
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                Enlem
                <input value={locationForm.latitude} placeholder="41.0422" inputMode="decimal" className={`${coordInput} font-mono`}
                  onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))} />
              </label>
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                Boylam
                <input value={locationForm.longitude} placeholder="29.0010" inputMode="decimal" className={`${coordInput} font-mono`}
                  onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))} />
              </label>
              <button type="submit" disabled={savingLocation}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[12px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                {savingLocation ? "Kaydediliyor…" : "Kaydet"}
              </button>
              {locationMsg && <div className="text-[11px] text-[var(--text-muted)] sm:col-span-full">{locationMsg}</div>}
            </form>
          )}
        </>
      )}
    </div>
  );
}
