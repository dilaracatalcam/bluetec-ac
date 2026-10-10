import { useState, useEffect, useCallback } from "react";
import {
  HiOutlineArrowPath, HiOutlineDocumentMagnifyingGlass, HiOutlineXMark,
  HiOutlineMapPin,
} from "react-icons/hi2";
import ScrollableTable from "./ScrollableTable.jsx";

function VersionBadge({ value }) {
  if (!value) return <span className="text-[var(--text-muted)]">—</span>;
  return <span className="font-mono text-[12px] text-[var(--text-primary)]">{value}</span>;
}

/* ── Detay penceresi — devices.json'daki TÜM alanları olduğu gibi listeler ── */
function DetailModal({ device, onClose }) {
  if (!device) return null;
  const entries = Object.entries(device.raw || {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 max-w-md w-full shadow-2xl max-h-[80vh] overflow-y-auto custom-scroll"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Cihaz Detayları</h3>
            <p className="text-[12px] text-[var(--text-muted)] font-mono mt-0.5">{device.mac}</p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition">
            <HiOutlineXMark className="text-[14px]" />
          </button>
        </div>

        {device.location && (
          <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-md bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[12px] text-[var(--accent)]">
            <HiOutlineMapPin className="text-[14px] shrink-0" />
            <span className="font-semibold">{device.location}</span>
            {device.company && <span className="opacity-70"> · {device.company}</span>}
            {device.deviceCode && <span className="opacity-70"> · {device.deviceCode}</span>}
          </div>
        )}

        <div className="flex flex-col gap-1">
          {entries.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic">devices.json içinde bu MAC için veri yok</p>
          ) : entries.map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-3 text-[12px] py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
              <span className="text-[var(--text-muted)] font-mono shrink-0">{key}</span>
              <span className="text-[var(--text-primary)] font-mono text-right break-all">
                {value === "" || value === null || value === undefined ? "—" : String(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DeviceVersions({ token }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/ota-server/device-versions", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Liste alınamadı"); return; }
      setDevices(d.devices || []);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition shrink-0
                       bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer disabled:opacity-50">
            <HiOutlineArrowPath className={`text-[14px] ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-rose-400 mb-3">{error}</p>}

      {!loading && devices.length > 0 && (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden">
          <ScrollableTable minWidth="800px">
            <div className="grid grid-cols-[140px_85px_85px_85px_85px_95px_95px_minmax(140px,1fr)_40px] px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MAC</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">ESP SW</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">ESP HW</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MSP SW</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MSP HW</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">ESP İstenen</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MSP İstenen</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Konum</span>
              <span />
            </div>
            <div className="max-h-[500px] overflow-y-auto custom-scroll">
              {devices.map((d) => (
                <div key={d.mac}
                  className="grid grid-cols-[140px_85px_85px_85px_85px_95px_95px_minmax(140px,1fr)_40px] items-center px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-hover)] transition-colors">
                  <span className="text-[12px] text-[var(--text-muted)] font-mono truncate pr-2">{d.mac}</span>
                  <VersionBadge value={d.espSoftwareVersion} />
                  <VersionBadge value={d.espHardwareVersion} />
                  <VersionBadge value={d.mspSoftwareVersion} />
                  <VersionBadge value={d.mspHardwareVersion} />
                  <VersionBadge value={d.espRequestedVersion} />
                  <VersionBadge value={d.mspRequestedVersion} />
                  <div className="min-w-0">
                    {d.location ? (
                      <span className="text-[12px] text-[var(--text-primary)] truncate block">
                        {d.location}
                        {d.company && <span className="text-[var(--text-muted)]"> · {d.company}</span>}
                      </span>
                    ) : (
                      <span className="text-[12px] text-[var(--text-muted)]">Eşleşmedi</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button onClick={() => setSelected(d)}
                      title="Detayları göster"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)]
                                 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition cursor-pointer">
                      <HiOutlineDocumentMagnifyingGlass className="text-[13px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollableTable>
        </div>
      )}

      {!loading && devices.length === 0 && !error && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineDocumentMagnifyingGlass className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[13px]">devices.json içinde kayıt bulunamadı</p>
        </div>
      )}

      <DetailModal device={selected} onClose={() => setSelected(null)} />
    </div>
  );
}