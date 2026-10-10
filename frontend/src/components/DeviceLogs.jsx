import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { HiOutlineCommandLine, HiOutlineArrowDownTray, HiOutlineTrash, HiOutlinePause, HiOutlinePlay } from "react-icons/hi2";

/* ── Cihaz Canlı Logları ──
   frame 3 28 N (verbose) ve frame 3 29 N (debug) ile cihazdan log akışı açılır;
   satırlar responses.json üzerinden gelir, backend biriktirir (bkz. device-log-stream.js),
   burada 500ms'de bir sadece yeni satırlar çekilir. En yeni satır en altta.
*/
const GROUPS = [
  {
    id: 28, title: "Verbose", hint: "frame 3 28",
    options: ["Kapalı", "Canlı Network", "Canlı MSP Akışı", "Canlı OCPP Akışı", "Tüm Mesajlar", "Sistem Notları"],
  },
  {
    id: 29, title: "Debug", hint: "frame 3 29",
    options: ["Kapalı", "Network Debug", "MSP Debug", "Memory", "Tüm Debug Mesajları", "Sistem Notları"],
  },
];

const MAX_LINES = 5000;
const POLL_MS = 500;

const LEVEL_STYLE = {
  VERBOSE: "text-slate-300",
  DEBUG:   "text-amber-300",
  INFO:    "text-sky-300",
  OCPP:    "text-cyan-300",
  FRAME:   "text-fuchsia-400",
  WARN:    "text-orange-400",
  ERROR:   "text-rose-400",
};

// Kategori (cat=...) renkleri — bilinenler sabit, yeni çıkan kategoriler paletten sırayla alır.
// Satır kategorisi varsa o renkte, yoksa seviye renginde gösterilir.
const CAT_STYLE = {
  msp:     "text-emerald-300",
  net:     "text-sky-300",
  storage: "text-amber-300",
  ocpp:    "text-cyan-300",
  mem:     "text-violet-300",
  sys:     "text-pink-300",
};
const CAT_PALETTE = [
  "text-lime-300", "text-orange-300", "text-fuchsia-300", "text-teal-300",
  "text-indigo-300", "text-yellow-200", "text-red-300", "text-blue-300",
];
const dynamicCatStyle = new Map();
export function catStyle(cat) {
  if (!cat) return "";
  const key = cat.toLowerCase();
  if (CAT_STYLE[key]) return CAT_STYLE[key];
  if (!dynamicCatStyle.has(key)) dynamicCatStyle.set(key, CAT_PALETTE[dynamicCatStyle.size % CAT_PALETTE.length]);
  return dynamicCatStyle.get(key);
}

// Satırın kendi içinde seviye yazıyorsa onu, yazmıyorsa geldiği gruba göre seviyeyi belirle
export function classifyLine(line) {
  const data = String(line.data ?? "");
  const own = data.match(/^\W*(VERBOSE|DEBUG|INFO|OCPP|FRAME|WARN|ERROR)\b/i);
  let level = own ? own[1].toUpperCase() : line.msg === 28 ? "VERBOSE" : line.msg === 29 ? "DEBUG" : "DİĞER";
  if (!own && /\b(error|hata|fail)/i.test(data)) level = "ERROR";
  const cat = data.match(/\bcat=(\w+)/)?.[1] || "";
  return { level, cat };
}

export default function DeviceLogs({ token, isConnected, isActive, mac }) {
  const [lines, setLines] = useState([]);
  const [modes, setModes] = useState({ 28: 0, 29: 0 });
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [hiddenLevels, setHiddenLevels] = useState(() => new Set());
  const [hiddenCats, setHiddenCats] = useState(() => new Set());
  const [sending, setSending] = useState(null);
  const [error, setError] = useState("");

  const cursorRef = useRef({ epoch: null, lastId: 0 });
  const boxRef = useRef(null);

  const authFetch = useCallback((url, options = {}) => fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  const poll = useCallback(async () => {
    try {
      const r = await authFetch(`/api/log/lines?after=${cursorRef.current.lastId}`);
      if (!r.ok) return;
      const d = await r.json();
      // Sunucu yeniden başladıysa ya da tampon sıfırlandıysa (cihaz değişti) baştan al
      const restarted = cursorRef.current.epoch !== null &&
        (d.epoch !== cursorRef.current.epoch || d.lastId < cursorRef.current.lastId);
      if (restarted) {
        cursorRef.current = { epoch: d.epoch, lastId: 0 };
        setLines([]);
        return;
      }
      cursorRef.current = { epoch: d.epoch, lastId: d.lastId };
      setModes(d.modes || { 28: 0, 29: 0 });
      if (d.lines?.length) {
        const fresh = d.lines.map((l) => ({ ...l, ...classifyLine(l) }));
        setLines((prev) => {
          const next = prev.concat(fresh);
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      }
    } catch {}
  }, [authFetch]);

  useEffect(() => {
    if (paused) return;
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => clearInterval(iv);
  }, [paused, poll]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) =>
      !hiddenLevels.has(l.level) &&
      !hiddenCats.has(l.cat) &&
      (!q || l.data.toLowerCase().includes(q)));
  }, [lines, search, hiddenLevels, hiddenCats]);

  const levels = useMemo(() => [...new Set(lines.map((l) => l.level))].sort(), [lines]);
  const cats = useMemo(() => [...new Set(lines.map((l) => l.cat).filter(Boolean))].sort(), [lines]);

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [visible, autoScroll]);

  const sendMode = async (group, level) => {
    setError("");
    setSending(`${group}-${level}`);
    try {
      const r = await authFetch("/api/log/command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, level }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || d.error || "Komut gönderilemedi"); return; }
      setModes((prev) => ({ ...prev, [group]: level }));
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setSending(null);
    }
  };

  const clearAll = async () => {
    setLines([]);
    try { await authFetch("/api/log/clear", { method: "POST" }); } catch {}
  };

  const download = () => {
    const text = visible.map((l) => `${l.time}\t${l.level}\t${l.data}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `log-${(mac || "cihaz").replace(/:/g, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleLevel = toggleIn(setHiddenLevels);
  const toggleCat = toggleIn(setHiddenCats);

  const btnBase = "text-[12px] font-semibold px-2.5 py-1.5 rounded-md border transition disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">

        {!isActive && (
          <p className="text-[12px] text-amber-400 mb-3">
            {isConnected ? "Cihaz aktif değil — log komutu gönderilemez." : "Log almak için önce bir cihaza bağlanın."}
          </p>
        )}

        <div className="space-y-3">
          {GROUPS.map((g) => (
            <div key={g.id}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[12px] font-bold text-[var(--text-secondary)]">{g.title}</span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">{g.hint}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.options.map((label, level) => {
                  const selected = modes[g.id] === level;
                  const cls = selected
                    ? level === 0
                      ? "bg-[var(--bg-subtle)] border-[var(--border-strong)] text-[var(--text-primary)]"
                      : "bg-[var(--accent)] border-[var(--accent)] text-white"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]";
                  return (
                    <button
                      key={level}
                      disabled={!isActive || sending !== null}
                      onClick={() => sendMode(g.id, level)}
                      className={`${btnBase} ${cls}`}
                    >
                      {sending === `${g.id}-${level}` ? "Gönderiliyor…" : label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-[12px] text-rose-400 mt-3">{error}</p>}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {levels.map((lv) => (
              <button
                key={lv}
                onClick={() => toggleLevel(lv)}
                className={`text-[11px] font-bold font-mono px-2 py-1 rounded border transition
                  ${hiddenLevels.has(lv)
                    ? "border-[var(--border-subtle)] text-[var(--text-muted)] line-through opacity-60"
                    : `border-[var(--border-strong)] ${LEVEL_STYLE[lv] || "text-[var(--text-secondary)]"} bg-[#0a0f1a]`}`}
              >
                {lv}
              </button>
            ))}
            {cats.length > 0 && <span className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />}
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => toggleCat(c)}
                className={`flex items-center gap-1.5 text-[11px] font-bold font-mono px-2 py-1 rounded border transition
                  ${hiddenCats.has(c)
                    ? "border-[var(--border-subtle)] text-[var(--text-muted)] line-through opacity-60"
                    : `border-[var(--border-strong)] ${catStyle(c)} bg-[#0a0f1a]`}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {c}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Satırlarda ara…"
              className="text-[12px] px-2 py-1 rounded-md bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)] w-[160px]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--text-muted)]">
              {visible.length === lines.length ? `${lines.length} satır` : `${visible.length} / ${lines.length} satır`}
            </span>
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] cursor-pointer select-none">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="cursor-pointer" />
              Otomatik kaydır
            </label>
            <button onClick={() => setPaused((p) => !p)}
              className={`${btnBase} flex items-center gap-1 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}>
              {paused ? <HiOutlinePlay className="text-[13px]" /> : <HiOutlinePause className="text-[13px]" />}
              {paused ? "Devam" : "Duraklat"}
            </button>
            <button onClick={download} disabled={visible.length === 0}
              className={`${btnBase} flex items-center gap-1 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}>
              <HiOutlineArrowDownTray className="text-[13px]" /> İndir
            </button>
            <button onClick={clearAll} disabled={lines.length === 0}
              className={`${btnBase} flex items-center gap-1 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-rose-400`}>
              <HiOutlineTrash className="text-[13px]" /> Temizle
            </button>
          </div>
        </div>

        <div
          ref={boxRef}
          className="bg-[#0a0f1a] rounded-lg p-3 h-[60vh] min-h-[320px] overflow-auto custom-scroll font-mono text-[12px] leading-relaxed"
        >
          {visible.length === 0 ? (
            <p className="text-slate-500 italic">
              {lines.length === 0 ? "Henüz log satırı yok — yukarıdan bir log modu seçin." : "Filtreye uyan satır yok."}
            </p>
          ) : (
            visible.map((l) => (
              <div key={l.id} className={`whitespace-pre ${catStyle(l.cat) || LEVEL_STYLE[l.level] || "text-slate-400"}`}>
                <span className="text-slate-500">{l.time}</span>
                {" | "}
                <span className="inline-block w-[58px]">{l.level}</span>
                {" | "}
                {l.data}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
