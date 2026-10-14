import { useEffect, useRef, useState } from "react";
import OcppLiveConsole from "./OcppLiveConsole.jsx";
import { OcppLiveViews } from "./OcppDeviceModal.jsx";

/* ── Loglar: bağlı cihazın canlı OCPP akışı ──
   Kart açılınca (cihaz aktifse) frame 3 28 3 gönderilir; karttan/sayfadan
   çıkınca ya da cihaz değişince frame 3 28 0 ile log modu sıfırlanır.
   Bağlantı kesilirken sunucu da açık kalan modu kapatır (bkz. stopDeviceLogs).
*/

const LIVE_LEVEL = 3;

function sendLevel(token, level) {
  return fetch("/api/log/command", {
    method: "POST",
    keepalive: true, // sayfa kapanırken de 3 28 0 gitsin
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ group: 28, level }),
  });
}

export default function OcppLiveDevice({ token, isActive, mac }) {
  const [status, setStatus] = useState("");
  const onRef = useRef(false);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setStatus("Canlı OCPP akışı açılıyor…");
    sendLevel(token, LIVE_LEVEL)
      .then(async (r) => {
        if (cancelled) return;
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setStatus(d.message || d.error || "Komut gönderilemedi"); return; }
        onRef.current = true;
        setStatus("");
      })
      .catch(() => { if (!cancelled) setStatus("Sunucuya ulaşılamadı"); });

    const off = () => { if (onRef.current) { onRef.current = false; sendLevel(token, 0).catch(() => {}); } };
    window.addEventListener("pagehide", off);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", off);
      off();
    };
  }, [token, isActive, mac]);

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[12px] font-bold text-[var(--text-secondary)]">Canlı OCPP</span>
        <span className="text-[11px] font-mono text-[var(--text-muted)]">frame 3 28 3 · çıkınca 3 28 0</span>
        {status && <span className="text-[12px] text-amber-500">{status}</span>}
      </div>
      {!isActive ? (
        <p className="text-[12px] text-[var(--text-muted)]">Canlı OCPP akışı için önce aktif bir cihaza bağlanın.</p>
      ) : (
        <>
          <OcppLiveConsole token={token} session height="h-[260px]" />
          <OcppLiveViews token={token} name={mac} />
        </>
      )}
    </div>
  );
}
