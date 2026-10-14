import { useState, useEffect, useRef, useCallback } from "react";
import { HiOutlineClock, HiChevronRight, HiOutlinePause, HiOutlinePlay, HiOutlineTrash } from "react-icons/hi2";

/* ── Canlı OCPP Konsolu (frame 3 28 3) ──
   /api/ocpp-live/feed'den sadece yeni satırları çeker; en yeni satır en üstte.
   - company verilirse: o şirketin cihazları (Toplu Okuma). Bu istekler açık
     kaldıkça sunucu her cihaza bir kez bağlanıp 3 28 3 gönderir ve bağlantıyı
     tutar (bkz. backend/ocpp-watch.js); bileşen kapanınca /leave ile 3 28 0
     gönderilir, bağlantılar bırakılır ve loglar silinir.
   Yalnızca tanınan OCPP mesajları gelir; cihazın sistem satırları gösterilmez.
   - session verilirse: oturumun bağlı olduğu cihaz (Loglar sayfası).
*/

const POLL_MS = 1000;
const MAX_LINES = 400;

const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const DIR_LABEL = { out: "Cihaz Mesajı", in: "Sunucu Mesajı" };

const PHASE_TEXT = { activating: "bağlanıyor", queued: "sırada", offline: "çevrimdışı", occupied: "kullanımda" };

export default function OcppLiveConsole({ token, company, session = false, onPickDevice, height = "h-[300px]", emptyText, collapsed = false }) {
  const [lines, setLines] = useState([]);
  const [watch, setWatch] = useState(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const afterRef = useRef(0);
  const inFlightRef = useRef(false); // yavaş bağlantıda istekler üst üste binip aynı satırları iki kez eklemesin

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const qs = new URLSearchParams({ after: String(afterRef.current) });
    if (session) qs.set("session", "1");
    else if (company) qs.set("company", company);
    try {
      const r = await fetch(`/api/ocpp-live/feed?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Canlı akış alınamadı"); return; }
      setError("");
      setWatch(d.watch || null);
      // Sunucu yeniden başladıysa id'ler sıfırlanır
      if (d.lastId < afterRef.current) { afterRef.current = 0; setLines([]); return; }
      afterRef.current = d.lastId;
      if (d.lines?.length) {
        const fresh = d.lines.slice().reverse();
        setLines((prev) => {
          const seen = new Set(prev.map((l) => l.id));
          return fresh.filter((l) => !seen.has(l.id)).concat(prev).slice(0, MAX_LINES);
        });
      }
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      inFlightRef.current = false;
    }
  }, [token, company, session]);

  // Kapsam değişince (şirket / cihaz) baştan başla; sayfadan çıkınca ya da şirket
  // değişince sunucuya haber ver: cihazlara 3 28 0 gider, bağlantılar bırakılır
  useEffect(() => {
    afterRef.current = 0;
    setLines([]);
    if (session) return undefined;
    const leave = () => fetch("/api/ocpp-live/leave", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ company: company || undefined }),
    }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, [company, session, token]);

  useEffect(() => {
    if (paused) return;
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => clearInterval(iv);
  }, [paused, poll]);

  const name = (l) => [l.location, l.deviceCode].filter(Boolean).join(" ") || l.mac || "Cihaz";

  return (
    <div className="rounded-xl overflow-hidden border border-black/40 bg-[#2b2b2b]">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#222] border-b border-black/40">
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-slate-300">
          <span className={`w-2 h-2 rounded-full ${paused ? "bg-slate-500" : "bg-emerald-400 animate-pulse"}`} />
          CANLI OCPP <span className="font-mono text-slate-500">frame 3 28 3</span>
          {watch && (
            <span className="font-normal text-slate-400">
              · dinlenen {watch.watching || 0}/{watch.total}
              {Object.entries(PHASE_TEXT).filter(([k]) => watch[k]).map(([k, t]) => ` · ${watch[k]} ${t}`).join("")}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <button onClick={() => setPaused((p) => !p)} title={paused ? "Devam" : "Duraklat"}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10">
            {paused ? <HiOutlinePlay /> : <HiOutlinePause />}
          </button>
          <button onClick={() => setLines([])} title="Temizle"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10">
            <HiOutlineTrash />
          </button>
        </span>
      </div>
      <div className={`${collapsed ? "hidden" : height} overflow-auto custom-scroll px-3 py-2 font-mono text-[12px] leading-[1.55]`}>
        {error && <div className="text-rose-400 mb-1">{error}</div>}
        {lines.length === 0 ? (
          <div className="text-slate-500 italic">
            {emptyText || "Canlı OCPP mesajı bekleniyor…"}
          </div>
        ) : lines.map((l) => (
          <div key={l.id} title={l.raw}
            onClick={() => onPickDevice?.(l)}
            className={`flex items-center gap-1.5 whitespace-nowrap text-slate-100 ${onPickDevice && l.deviceId != null ? "cursor-pointer hover:bg-white/5" : ""}`}>
            <HiOutlineClock className="text-sky-300 shrink-0" />
            <span className="font-semibold">{fmt(l.at)}</span>
            <HiChevronRight className="text-amber-300 shrink-0" />
            <span className="font-semibold">{name(l)}</span>
            <HiChevronRight className="text-amber-300 shrink-0" />
            <span className="text-cyan-300">[ {DIR_LABEL[l.dir] || "Log"} ]</span>
            <span className="text-cyan-300">[ {l.action || "Bilinmeyen"} ]</span>
          </div>
        ))}
      </div>
    </div>
  );
}
