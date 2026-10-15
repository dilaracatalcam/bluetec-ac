import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  HiOutlineCommandLine, HiOutlineArrowDownTray, HiOutlineTrash, HiOutlinePause, HiOutlinePlay,
  HiOutlineDocumentText, HiOutlineEye, HiOutlineArrowPath, HiOutlineXMark,
} from "react-icons/hi2";
import OcppArchive from "./OcppArchive.jsx";

/* ── Cihaz Logları ──
   İki sekme:
   - Canlı loglar: frame 3 28 N (verbose) ve frame 3 29 N (debug) ile cihazdan
     log akışı açılır; satırlar responses.json üzerinden gelir, backend biriktirir
     (bkz. device-log-stream.js), burada 500ms'de bir sadece yeni satırlar çekilir.
     En yeni satır en altta.
   - Kayıtlı arşiv: frame 3 30 N ile cihazdaki kalıcı arşiv Bluetech sunucusuna
     aktarılır (ACK'li); dosyalar orada current/history olarak tutulur ve buradan
     listelenir/önizlenir/indirilir (bkz. device-archive-logs.js). Aktarım ilerlemesi
     msg 30 satırlarından (QUEUED / S / D / E / ERR / STATUS) okunur.
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

const ARCHIVE_SCOPES = [
  { value: 0, label: "Disable", hint: "Arşiv aktarımını kapat" },
  { value: 1, label: "Günlük log", hint: "Cihazın en yeni (günlük) kayıtları" },
  { value: 2, label: "LittleFS", hint: "Cihazın dahili arşivi" },
  { value: 3, label: "SD / FRAM", hint: "Harici arşiv" },
  { value: 4, label: "Tüm arşiv", hint: "LittleFS + SD / FRAM" },
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

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

const ARCHIVE_IDLE = { phase: "ready", percent: null, total: 0, offset: 0, scope: null, note: "Hazır" };

export default function DeviceLogs({ token, isConnected, isActive, mac }) {
  const [lines, setLines] = useState([]);
  const [modes, setModes] = useState({ 28: 0, 29: 0 });
  const [tab, setTab] = useState("live");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [hiddenLevels, setHiddenLevels] = useState(() => new Set());
  const [hiddenCats, setHiddenCats] = useState(() => new Set());
  const [sending, setSending] = useState(null);
  const [error, setError] = useState("");
  const [archiveFiles, setArchiveFiles] = useState([]);
  const [archiveFetchedAt, setArchiveFetchedAt] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [preview, setPreview] = useState(null);
  const [archive, setArchive] = useState(ARCHIVE_IDLE);
  const [pullStatus, setPullStatus] = useState(null);

  const cursorRef = useRef({ epoch: null, lastId: 0 });
  const boxRef = useRef(null);

  const authFetch = useCallback((url, options = {}) => fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  // Arşiv aktarımının durum satırları (msg 30) — log listesine değil ilerleme çubuğuna gider
  const handleArchiveLine = useCallback((line) => {
    const data = String(line?.data || "");
    const parts = data.split(",");
    if (!data) return;
    // Cihazın ilerleme satırı: "sid=30668 % 42.5 | indiriliyor | segment=1 kayıt=288 ..."
    // Hata yalnızca durum kısmından anlaşılır — ayrıntıda "CRC-hata=0" gibi alanlar da geçer.
    const pct = data.match(/%\s*(\d+(?:[.,]\d+)?)/);
    if (pct) {
      const percent = Math.min(100, Math.round(parseFloat(pct[1].replace(",", ".")) * 10) / 10);
      const segments = data.split("|").map((x) => x.trim());
      const status = segments[1] || "";
      const done = percent >= 100 || /tamamland/i.test(status);
      const failed = !done && /hata|başarısız|error|fail|iptal/i.test(status);
      setArchive((s) => ({
        ...s,
        phase: failed ? "error" : done ? "complete" : "transferring",
        percent,
        note: status ? status.charAt(0).toLocaleUpperCase("tr-TR") + status.slice(1) : (done ? "Arşiv aktarımı tamamlandı" : "Arşiv aktarılıyor"),
        detail: segments.slice(2).join(" · "),
      }));
      return;
    }
    if (data.startsWith("QUEUED,")) {
      const total = Number(data.match(/bytes=(\d+)/)?.[1] || 0);
      const scope = Number(data.match(/scope=(\d+)/)?.[1] || 0) || null;
      setArchive((s) => ({
        ...s, phase: "queued", percent: 0, total, offset: 0, scope,
        note: total ? `Arşiv aktarımı sıraya alındı · ${formatBytes(total)}` : "Arşiv aktarımı sıraya alındı",
      }));
      return;
    }
    if (parts[0] === "S" && parts.length >= 4) {
      const total = Number(parts[3]) || 0;
      setArchive((s) => ({ ...s, phase: "transferring", percent: 0, total, offset: 0, note: total ? `Arşiv aktarılıyor · ${formatBytes(total)}` : "Arşiv aktarılıyor" }));
      return;
    }
    if (parts[0] === "D" && parts.length >= 3) {
      const offset = Number(parts[2]) || 0;
      setArchive((s) => ({
        ...s, phase: "transferring", offset,
        percent: s.total ? Math.min(100, Math.round((offset * 100) / s.total)) : null,
        note: s.total ? `Arşiv aktarılıyor · ${formatBytes(offset)} / ${formatBytes(s.total)}` : "Arşiv aktarılıyor",
      }));
      return;
    }
    if (parts[0] === "E" || parts[0] === "F") {
      setArchive((s) => ({ ...s, phase: "complete", percent: 100, offset: s.total, note: "Arşiv aktarımı tamamlandı" }));
      return;
    }
    if (data.startsWith("ERR") || /zaman aşımı|başarısız|hata/i.test(data)) {
      setArchive((s) => ({ ...s, phase: "error", note: data }));
      return;
    }
    if (data.startsWith("STATUS,")) setArchive((s) => ({ ...s, note: data.replace(/^STATUS,/, "Durum: ") }));
  }, []);

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
        fresh.filter((l) => Number(l.msg) === 30).forEach(handleArchiveLine);
        const logLines = fresh.filter((l) => Number(l.msg) !== 30);
        setLines((prev) => {
          const next = prev.concat(logLines);
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      }
    } catch {}
  }, [authFetch, handleArchiveLine]);

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

  // Son arşiv çekimi (otomatik ya da elle) — "Cihaz arşivini çek" altında gösterilir
  const loadPullStatus = useCallback(async () => {
    if (!isConnected) return;
    try {
      const r = await authFetch("/api/device-log-archive/pull-status");
      if (r.ok) setPullStatus(await r.json());
    } catch {}
  }, [authFetch, isConnected]);

  const loadArchive = useCallback(async () => {
    if (!isConnected) return;
    loadPullStatus();
    setArchiveLoading(true);
    setArchiveError("");
    try {
      const r = await authFetch("/api/device-log-archive/catalog");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Kayıtlı loglar okunamadı");
      setArchiveFiles(d.files || []);
      setArchiveFetchedAt(d.fetchedAt || new Date().toISOString());
    } catch (e) {
      setArchiveError(e.message || "Uzak log sunucusuna ulaşılamadı");
    } finally {
      setArchiveLoading(false);
    }
  }, [authFetch, isConnected, loadPullStatus]);

  useEffect(() => {
    if (tab === "archive" && isConnected) loadArchive();
  }, [tab, isConnected, loadArchive]);

  // Aktarım bitince dosya listesi tazelenir
  useEffect(() => {
    if (archive.phase !== "complete") return undefined;
    loadArchive();
    const t = setTimeout(loadPullStatus, 2000); // sunucu çekimi kaydetsin
    return () => clearTimeout(t);
  }, [archive.phase, loadArchive, loadPullStatus]);

  const previewFile = async (name, title) => {
    setArchiveError("");
    try {
      const r = await authFetch(`/api/device-log-archive/preview?name=${encodeURIComponent(name)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Önizleme alınamadı");
      setPreview({ ...d, title });
    } catch (e) {
      setArchiveError(e.message || "Önizleme alınamadı");
    }
  };

  const downloadFile = async (name) => {
    setArchiveError("");
    try {
      const r = await authFetch(`/api/device-log-archive/download?name=${encodeURIComponent(name)}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Log indirilemedi");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setArchiveError(e.message || "Log indirilemedi");
    }
  };

  const requestArchive = async (scope) => {
    setArchiveError("");
    setSending(`30-${scope}`);
    setArchive(scope === 0
      ? { ...ARCHIVE_IDLE, phase: "requesting", scope, note: "Arşiv aktarımı kapatılıyor…" }
      : { phase: "requesting", percent: 0, total: 0, offset: 0, scope, note: "Cihaza arşiv isteği gönderiliyor…" });
    try {
      const r = await authFetch("/api/log/command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: 30, level: scope }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || "Arşiv isteği gönderilemedi");
      setModes((prev) => ({ ...prev, 30: scope }));
      setArchive((s) => (scope === 0
        ? { ...ARCHIVE_IDLE, phase: "disabled", scope: 0, note: "Arşiv aktarımı kapatıldı" }
        : { ...s, phase: "queued", note: `Scope ${scope} isteği cihaza iletildi; cevap bekleniyor…` }));
    } catch (e) {
      setArchive((s) => ({ ...s, phase: "error", note: e.message || "Arşiv isteği gönderilemedi" }));
      setArchiveError(e.message || "Arşiv isteği gönderilemedi");
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
      <div className="flex items-center justify-between gap-3 flex-wrap bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setTab("live")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold transition ${tab === "live" ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
            <HiOutlineCommandLine /> Canlı loglar <span className="font-mono opacity-75">28 / 29</span>
          </button>
          <button onClick={() => setTab("archive")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold transition ${tab === "archive" ? "bg-emerald-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
            <HiOutlineDocumentText /> Kayıtlı arşiv <span className="font-mono opacity-75">30</span>
          </button>
        </div>
        <div className="text-[11px] text-[var(--text-muted)] pr-2">
          {mac ? `Bağlı cihaz: ${mac}` : "Cihaz seçilmedi"}
        </div>
      </div>

      {tab === "live" ? (
        <>
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
        </>
      ) : (
        <>
          <ArchivePanel
            isActive={isActive}
            isConnected={isConnected}
            files={archiveFiles}
            fetchedAt={archiveFetchedAt}
            loading={archiveLoading}
            error={archiveError}
            state={archive}
            pullStatus={pullStatus}
            sending={sending}
            onRefresh={loadArchive}
            onScope={requestArchive}
            onPreview={previewFile}
            onDownload={downloadFile}
            preview={preview}
            onClosePreview={() => setPreview(null)}
          />
          {isConnected && <OcppArchive token={token} mac={mac} />}
        </>
      )}
    </div>
  );
}

const PULL_RESULT_TEXT = {
  charging: "şarj verdiği için ertelendi", offline: "cihaz çevrimdışıydı", busy: "cihaz kullanımdaydı",
  failed: "başarısız oldu", timeout: "zaman aşımına uğradı", interrupted: "kullanıcı bağlandığı için yarıda kaldı",
};

// Son çekim saati + öneri: arşiv eşitse yalnızca Günlük log yeterli
function PullInfo({ status }) {
  if (!status) return null;
  const { lastSuccessAt, lastSource, lastAttemptAt, lastResult, autoEligible, synced, running, minVersion, intervalHours } = status;
  const lastTryFailed = lastResult && lastResult !== "ok" && lastAttemptAt && (!lastSuccessAt || lastAttemptAt > lastSuccessAt);
  return (
    <div className="mt-2.5 space-y-1 text-[11px]">
      <div className="text-[var(--text-secondary)]">
        <span className="text-[var(--text-muted)]">Son çekim: </span>
        {lastSuccessAt
          ? <><span className="font-semibold">{formatDate(lastSuccessAt)}</span> <span className="text-[var(--text-muted)]">({lastSource === "auto" ? "otomatik" : "elle"})</span></>
          : <span className="font-semibold">henüz çekilmedi</span>}
        {running && <span className="ml-2 text-sky-500 font-semibold">· otomatik çekim sürüyor</span>}
      </div>
      {lastTryFailed && (
        <div className="text-amber-600 dark:text-amber-400">
          Son otomatik deneme ({formatDate(lastAttemptAt)}) {PULL_RESULT_TEXT[lastResult] || lastResult}; yeniden denenecek.
        </div>
      )}
      <div className="text-[var(--text-muted)]">
        {autoEligible
          ? `Otomatik çekim açık: ${intervalHours} saatte bir, cihaz şarj vermiyorken Günlük log çekilir.`
          : `Otomatik çekim kapalı: yazılımı ${minVersion} üzeri olan cihazlarda çalışır. Sürüm günde bir kontrol edilir; cihaz güncellenince kendiliğinden açılır.`}
      </div>
      {synced ? (
        <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
          Arşiv eşit — yeni kayıtlar için 1 · Günlük log yeterli.
        </div>
      ) : lastSuccessAt ? (
        <div className="text-amber-600 dark:text-amber-400">
          Son çekimin üzerinden {intervalHours} saatten fazla geçti; arada kayıt kaçmış olabilir, gerekirse 4 · Tüm arşiv seçin.
        </div>
      ) : (
        <div className="text-[var(--text-muted)]">Bu cihazdan kayıtlı çekim yok; ilk seferde 4 · Tüm arşiv önerilir.</div>
      )}
    </div>
  );
}

// Kullanıcıya gösterilen ad: SteVe biçimli OCPP logları "OCPP current/history log", canlı kayıt kendi adıyla
function fileTitle(f) {
  if (f.family === "ocpp") return f.period === "history" ? "OCPP history log" : "OCPP current log";
  return f.label;
}

function ArchivePanel({
  isActive, isConnected, files, fetchedAt, loading, error, state, pullStatus, sending,
  onRefresh, onScope, onPreview, onDownload, preview, onClosePreview,
}) {
  // Yalnızca OCPP logu (SteVe biçimi) ve canlı kayıt gösterilir; diğer dosyalar (renkli log, HTML, OCL) gizli
  const shown = files.filter((f) => f.family === "live" || (f.family === "ocpp" && /steve/i.test(f.name)));
  const current = shown.filter((f) => f.period === "current");
  const history = shown.filter((f) => f.period === "history");
  const noteColor = state.phase === "complete" ? "text-emerald-500" : state.phase === "error" ? "text-rose-500" : "text-sky-500";

  const fileRow = (f) => (
    <div key={f.name} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
      <div className="min-w-0 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
          <HiOutlineDocumentText />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{fileTitle(f)}</div>
          <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
            {formatBytes(f.size)} · {formatDate(f.modifiedAt)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded border ${f.format === "ocl"
          ? "text-violet-500 border-violet-500/30 bg-violet-500/10"
          : "text-sky-500 border-sky-500/30 bg-sky-500/10"}`}>
          {f.format.toUpperCase()}
        </span>
        <button onClick={() => onPreview(f.name, fileTitle(f))} title="Önizle"
          className="p-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <HiOutlineEye />
        </button>
        <button onClick={() => onDownload(f.name)} title="İndir"
          className="p-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--accent)]">
          <HiOutlineArrowDownTray />
        </button>
      </div>
    </div>
  );

  const stat = (label, value, small = false) => (
    <div className="rounded-lg border border-[var(--border-subtle)] p-2.5">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={small ? "text-[11px] font-semibold text-[var(--text-primary)] mt-1" : "text-[16px] font-bold text-[var(--text-primary)]"}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {!isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 px-4 py-3 text-[12px]">
          Kayıtlı logları görmek için önce bir cihaza bağlanın.
        </div>
      )}
      {!isActive && isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 px-4 py-3 text-[12px]">
          Cihaz aktif değil; arşiv komutu gönderilemez.
        </div>
      )}

      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-[var(--text-primary)]">Kalıcı cihaz logları</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Frame 3 / 30 ile cihaz arşivini Bluetech sunucusuna aktarır; dosyalar current ve history olarak orada tutulur.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {stat("Current", current.length)}
          {stat("History", history.length)}
          {stat("Toplam boyut", formatBytes(shown.reduce((sum, f) => sum + Number(f.size || 0), 0)))}
          {stat("Son okuma", formatDate(fetchedAt), true)}
        </div>

        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-[12px] font-semibold text-[var(--text-primary)]">Cihaz arşivini çek</div>
              <div className="text-[10px] text-[var(--text-muted)]">1–4 kapsamından birini seç, 0 aktarımı kapatır; cihaz gönderimi ACK ile ilerler.</div>
              <div className="text-[10.5px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                Arşiv 6 saatte bir yenilenmektedir. Günlük logu seçmeniz tavsiye edilmektedir.
              </div>
            </div>
            <span className={`text-[11px] font-semibold ${noteColor}`}>{state.note}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ARCHIVE_SCOPES.map((s) => {
              const recommended = s.value === 1 && pullStatus?.synced;
              const selected = state.scope === s.value && state.phase !== "ready" && s.value !== 0;
              return (
                <button key={s.value} onClick={() => onScope(s.value)} disabled={!isActive || sending !== null} title={s.hint}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md border transition ${selected
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : recommended
                      ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30"
                      : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                  <span>
                    {sending === `30-${s.value}` ? "Gönderiliyor…" : `${s.value} · ${s.label}`}
                    {recommended && !selected && <span className="ml-1.5 text-[9px] uppercase tracking-wide">Önerilen</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <PullInfo status={pullStatus} />
          {state.percent !== null && state.phase !== "ready" && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
                <span>{state.phase === "complete" ? "Tamamlandı" : "İlerleme"}</span>
                <span>{state.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                <div className={`h-full transition-all ${state.phase === "error" ? "bg-rose-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }} />
              </div>
              {state.detail && <div className="mt-1.5 text-[10px] font-mono text-[var(--text-muted)] break-words">{state.detail}</div>}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 px-3 py-2 text-[11px]">{error}</div>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button onClick={onRefresh} disabled={!isConnected || loading}
          className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40">
          <HiOutlineArrowPath className={loading ? "animate-spin" : ""} /> {loading ? "Tazeleniyor…" : "Dosyaları tazele"}
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 !mt-2">
        {[["current", "Current dosyaları", current], ["history", "History dosyaları", history]].map(([key, title, list]) => (
          <div key={key} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[12px] font-bold text-[var(--text-primary)]">{title}</h4>
              <span className="text-[10px] text-[var(--text-muted)]">{list.length} dosya</span>
            </div>
            <div className="space-y-2">
              {list.length ? list.map(fileRow) : <div className="text-[11px] text-[var(--text-muted)] italic">Henüz dosya bulunamadı.</div>}
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClosePreview}>
          <div className="w-full max-w-5xl max-h-[85vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
              <div className="min-w-0">
                <h4 className="text-[13px] font-bold text-[var(--text-primary)] truncate">{preview.title || preview.name}</h4>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {formatBytes(preview.size)}{preview.truncated ? " · son 1 MB gösteriliyor" : ""}
                </span>
              </div>
              <button onClick={onClosePreview} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <HiOutlineXMark />
              </button>
            </div>
            <pre className="m-0 p-4 max-h-[70vh] overflow-auto bg-[#0a0f1a] text-slate-200 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
              {preview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
