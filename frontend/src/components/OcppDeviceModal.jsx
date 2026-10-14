import { useState, useCallback, useEffect } from "react";
import { HiOutlineXMark, HiOutlineListBullet, HiOutlineChartBar } from "react-icons/hi2";
import { HistoryView, TimelineView } from "./OcppArchive.jsx";

/* ── Cihaz İşlemleri ve Veri Hareketleri ──
   Bir cihazın canlı OCPP olayları (frame 3 28 3 ile toplananlar, bkz.
   backend/ocpp-live-store.js): Zaman Çizelgesi ve İşlem Geçmişi.
   deviceId verilmezse oturumun bağlı olduğu cihaz kullanılır.
*/

export function useLiveEventsFetch(token, deviceId) {
  return useCallback(async ({ from, to }) => {
    const qs = new URLSearchParams();
    if (deviceId != null) qs.set("deviceId", String(deviceId));
    if (from != null) qs.set("from", new Date(from).toISOString());
    if (to != null) qs.set("to", new Date(to).toISOString());
    const r = await fetch(`/api/ocpp-live/events?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || "Canlı OCPP olayları alınamadı");
    return d;
  }, [token, deviceId]);
}

// Zaman Çizelgesi ⇄ İşlem Geçmişi; çizelgede bir olaya tıklanınca geçmiş o kayda süzülür.
export function OcppLiveViews({ token, deviceId, name }) {
  const [view, setView] = useState("timeline");
  const [preset, setPreset] = useState(null);
  const fetchEvents = useLiveEventsFetch(token, deviceId);

  const btn = (key, icon, text) => (
    <button onClick={() => { setView(key); if (key === "history") setPreset(null); }}
      className={`w-full flex items-center justify-center gap-2 text-[12px] font-semibold px-3 py-2 rounded-md border transition
        ${view === key
          ? "bg-slate-600 border-slate-600 text-white"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
      {icon} {text}
    </button>
  );

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="md:w-[200px] shrink-0 space-y-2">
        {btn("timeline", <HiOutlineChartBar />, "Zaman Çizelgesi")}
        {btn("history", <HiOutlineListBullet />, "İşlem Geçmişi")}
        <p className="text-[11px] text-[var(--text-muted)] leading-snug pt-1">
          Veriler cihazın canlı OCPP akışından (frame 3 28 3) toplanır; sunucu yeniden başlarsa sıfırlanır.
        </p>
      </div>
      <div className="flex-1 min-w-0">
        {view === "timeline"
          ? <TimelineView fetchEvents={fetchEvents} autoRefreshMs={15000}
              onPick={(p) => { setPreset(p); setView("history"); }} />
          : <HistoryView fetchEvents={fetchEvents} mac={name} preset={preset} />}
      </div>
    </div>
  );
}

export default function OcppDeviceModal({ token, device, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!device) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[1500px] mt-8 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
            Cihaz İşlemleri ve Veri Hareketleri - {device.name}
          </h3>
          <button onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[12px] font-bold">
            <HiOutlineXMark /> Kapat
          </button>
        </div>
        <div className="p-5">
          <OcppLiveViews token={token} deviceId={device.deviceId} name={device.name} />
        </div>
      </div>
    </div>
  );
}
