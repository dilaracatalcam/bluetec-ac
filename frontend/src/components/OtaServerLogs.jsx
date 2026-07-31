import { useState, useEffect, useCallback } from "react";
import { HiOutlineCommandLine, HiOutlineArrowPath } from "react-icons/hi2";

/* ── OTA Sunucu Logları — ota_system/logs/ota_server.log'un son satırları ──
   Varsayılan olarak canlı akar (5s'de bir), en yeni satır en üstte gösterilir.
*/
export default function OtaServerLogs({ token }) {
  const [lines, setLines] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/ota-server/logs?lines=200", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Log alınamadı"); return; }
      setLines(d.lines || []);
      setTotalLines(d.totalLines || 0);
      setFetchedAt(d.fetchedAt);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(load, 500);
    return () => clearInterval(iv);
  }, [autoRefresh, load]);

  const lineColor = (line) => {
    if (/error|hata|fail/i.test(line)) return "text-rose-400";
    if (/warn/i.test(line)) return "text-amber-400";
    if (/info/i.test(line)) return "text-sky-400";
    return "text-[var(--text-muted)]";
  };

  // En yeni satır en üstte görünsün diye ters çeviriyoruz (dosyadaki sıra eski→yeni)
  const displayLines = [...lines].reverse();

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <HiOutlineCommandLine className="text-[15px] text-[var(--accent)]" />
          <h4 className="text-[13px] font-bold text-[var(--text-primary)]">OTA Sunucu Logları</h4>
          {totalLines > 0 && (
            <span className="text-[10px] text-[var(--text-muted)]">(son {lines.length} / bilinen {totalLines} satır — en yeni üstte)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="cursor-pointer"
            />
            Canlı (0.5s)
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border
                       border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]
                       hover:border-[var(--border-strong)] transition"
          >
            <HiOutlineArrowPath className={`text-[12px] ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-400 mb-2">{error}</p>}

      <div className="bg-[#0a0f1a] rounded-lg p-3 max-h-[400px] overflow-y-auto overflow-x-auto custom-scroll font-mono text-[11px] leading-relaxed">
        {displayLines.length === 0 && !loading ? (
          <p className="text-[var(--text-muted)] italic">Log satırı yok</p>
        ) : (
          displayLines.map((line, i) => (
            <div key={i} className={`whitespace-pre ${lineColor(line)}`}>{line}</div>
          ))
        )}
      </div>

      {fetchedAt && (
        <p className="text-[10px] text-[var(--text-muted)] mt-2">
          Son çekilme: {new Date(fetchedAt).toLocaleTimeString("tr-TR")}
        </p>
      )}
    </div>
  );
}