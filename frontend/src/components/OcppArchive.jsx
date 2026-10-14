import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  HiOutlineArrowDownTray, HiOutlineArrowPath, HiOutlineFunnel, HiOutlineXMark, HiOutlineChevronDown,
  HiArrowUp, HiArrowDown, HiOutlineListBullet, HiOutlineChartBar,
} from "react-icons/hi2";

/* ── OCPP Arşivi (frame 3 30) ──
   frame 3 30 cihazdaki kalıcı OCPP arşivini Bluetech sunucusuna aktarır; aktarılan
   dosyalar /api/device-log-archive/ocpp-events ile olaylara çevrilip (bkz.
   backend/ocpp-archive-events.js) iki şekilde gösterilir:
   - İşlem Geçmişi: tarih/kayıt tipi filtreli, sayfalı tablo
   - Zaman Çizelgesi: seçilen günün olayları kayıt tipine göre satır satır
*/

// Kayıt tipleri — sıra filtre listesindeki sırayla aynı; renk/şekil zaman çizelgesinde de kullanılır.
const TYPES = [
  { type: "Unknown",             color: "#94a3b8", shape: "circle" },
  { type: "Heartbeat",           color: "#22c55e", shape: "bar" },
  { type: "Boot Notification",   color: "#eab308", shape: "circle" },
  { type: "Meter Value",         color: "#6b7280", shape: "bar" },
  { type: "Status Notification", color: "#3b82f6", shape: "circle" },
  { type: "Start Transaction",   color: "#22d3ee", shape: "up" },
  { type: "Stop Transaction",    color: "#1f2937", shape: "down" },
  { type: "Authorize",           color: "#1e3a8a", shape: "square" },
  { type: "Reset",               color: "#172554", shape: "square" },
  { type: "Disconnected",        color: "#e11d48", shape: "down" },
];
const TYPE_META = Object.fromEntries(TYPES.map((t) => [t.type, t]));
const OTHER_META = { color: "#a855f7", shape: "circle" };
const metaOf = (type) => TYPE_META[type] || OTHER_META;

const PAGE_SIZES = [10, 25, 50, 100];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const fmtDateTime = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const toLocalInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toDateInput = (ms) => toLocalInput(ms).slice(0, 10);
const dayStart = (dateStr) => new Date(`${dateStr}T00:00:00`).getTime();

function useArchiveFetch(token) {
  return useCallback(async ({ from, to, fresh }) => {
    const qs = new URLSearchParams();
    if (from != null) qs.set("from", new Date(from).toISOString());
    if (to != null) qs.set("to", new Date(to).toISOString());
    if (fresh) qs.set("fresh", "1");
    const r = await fetch(`/api/device-log-archive/ocpp-events?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || "OCPP arşivi okunamadı");
    return d;
  }, [token]);
}

export function TypeBadge({ type }) {
  const { color } = metaOf(type);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: `${color}22`, color }}>
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {type}
    </span>
  );
}

function PayloadLine({ part }) {
  if (!part) return null;
  const out = part.dir === "out";
  return (
    <div className="flex items-start gap-1.5">
      {part.dir == null
        ? <span className="w-[13px] shrink-0" />
        : out
          ? <HiArrowUp className="text-emerald-500 shrink-0 mt-[3px]" title="Cihazdan sunucuya" />
          : <HiArrowDown className="text-rose-500 shrink-0 mt-[3px]" title="Sunucudan cihaza" />}
      <span className="break-all">{part.raw}</span>
    </div>
  );
}

function TypeSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (t) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange(next);
  };
  const summary = selected.size === 0 ? "Tümü" : [...selected].join(", ");

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 h-8 pl-2 pr-1.5 w-[190px] rounded-md border bg-[var(--bg-surface)] cursor-pointer text-[12px]
          ${open ? "border-[var(--accent)]" : "border-[var(--border-subtle)]"}`}>
        <span className={`flex-1 truncate ${selected.size ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>{summary}</span>
        {selected.size > 0 && (
          <HiOutlineXMark className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={(e) => { e.stopPropagation(); onChange(new Set()); }} />
        )}
        <HiOutlineChevronDown className="text-[var(--text-muted)]" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-[190px] max-h-[260px] overflow-auto custom-scroll rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg py-1">
          {options.map((t) => (
            <div key={t} onClick={() => toggle(t)}
              className={`px-3 py-1.5 text-[12px] cursor-pointer
                ${selected.has(t) ? "bg-[var(--accent)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pager({ page, pages, onPage }) {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = [];
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  const btn = "min-w-[26px] h-[26px] px-1.5 rounded text-[12px] disabled:opacity-30";
  return (
    <div className="flex items-center gap-1 text-[var(--text-muted)]">
      <button className={btn} disabled={page <= 1} onClick={() => onPage(1)}>«</button>
      <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      {nums.map((n) => (
        <button key={n} onClick={() => onPage(n)}
          className={`${btn} ${n === page ? "bg-[var(--accent)] text-white font-semibold" : "hover:bg-[var(--bg-hover)]"}`}>{n}</button>
      ))}
      <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
      <button className={btn} disabled={page >= pages} onClick={() => onPage(pages)}>»</button>
    </div>
  );
}

/* ── İşlem Geçmişi ── */
export function HistoryView({ fetchEvents, mac, preset }) {
  const [from, setFrom] = useState(() => toLocalInput(Date.now() - 2 * DAY_MS));
  const [to, setTo] = useState(() => toLocalInput(Date.now() + 60 * 1000));
  const [types, setTypes] = useState(() => new Set());
  const [applied, setApplied] = useState(null); // { events, types }
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (f, t, ty) => {
    setLoading(true); setError("");
    try {
      const d = await fetchEvents({ from: new Date(f).getTime(), to: new Date(t).getTime() });
      setApplied({ events: d.events || [], types: ty, files: d.files || [] });
      setPage(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchEvents]);

  // Zaman çizelgesinden bir olaya tıklanınca o günün o tipteki kayıtları açılır
  useEffect(() => {
    if (preset) {
      const f = toLocalInput(preset.from), t = toLocalInput(preset.to), ty = new Set([preset.type]);
      setFrom(f); setTo(t); setTypes(ty);
      run(f, t, ty);
    } else {
      run(from, to, types);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, run]);

  const rows = useMemo(() => {
    if (!applied) return [];
    const list = applied.types.size ? applied.events.filter((e) => applied.types.has(e.type)) : applied.events;
    return list.slice().sort((a, b) => b.time - a.time);
  }, [applied]);

  const typeOptions = useMemo(() => {
    const extra = new Set((applied?.events || []).map((e) => e.type).filter((t) => !TYPE_META[t]));
    return [...TYPES.map((t) => t.type), ...[...extra].sort()];
  }, [applied]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = rows.slice((page - 1) * pageSize, page * pageSize);
  const firstNo = rows.length ? (page - 1) * pageSize + 1 : 0;
  const lastNo = Math.min(rows.length, page * pageSize);

  const download = () => {
    const text = rows.map((e) => [
      `${fmtDateTime(e.time)}\t${e.type}`,
      ...[e.call, e.result, e.error].filter(Boolean).map((p) => `\t${p.dir === "out" ? "↑" : p.dir === "in" ? "↓" : " "} ${p.raw}`),
    ].join("\n")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocpp-gecmis-${(mac || "cihaz").replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const input = "h-8 px-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-primary)]";
  const label = "text-[12px] font-semibold text-[var(--text-secondary)]";

  const pagerBar = (
    <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2">
      <Pager page={page} pages={pages} onPage={setPage} />
      <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
        <span>{rows.length} kayıttan {firstNo} ve {lastNo} arasındakileri görüntülüyorsunuz.</span>
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className={input}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg">
      <div className="flex items-center justify-end gap-3 flex-wrap px-3 py-3 border-b border-[var(--border-subtle)]">
        <button onClick={download} disabled={rows.length === 0}
          className={`${input} flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40`}>
          <HiOutlineArrowDownTray /> İndir
        </button>
        <span className={label}>Kayıt Tipi</span>
        <TypeSelect options={typeOptions} selected={types} onChange={setTypes} />
        <span className={label}>Başlangıç Tarihi</span>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        <span className={label}>Bitiş Tarihi</span>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        <button onClick={() => run(from, to, new Set(types))} disabled={loading || !from || !to}
          className="h-8 px-3 rounded-md bg-[var(--accent)] text-white text-[12px] font-semibold flex items-center gap-1 disabled:opacity-50">
          <HiOutlineFunnel /> {loading ? "Yükleniyor…" : "Filtrele"}
        </button>
      </div>

      {error && <p className="text-[12px] text-rose-500 px-3 pt-3">{error}</p>}

      {pagerBar}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[var(--bg-subtle)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="text-left font-bold px-3 py-2 w-[150px]">İşlem Tarihi</th>
              <th className="text-left font-bold px-3 py-2 w-[170px]">Kayıt Tipi</th>
              <th className="text-left font-bold px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {current.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-[var(--text-muted)] italic">
                {loading ? "Yükleniyor…" : applied ? "Bu aralıkta kayıt yok." : ""}
              </td></tr>
            ) : current.map((e) => (
              <tr key={`${e.id}|${e.time}`} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] align-top">
                <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(e.time)}</td>
                <td className="px-3 py-2.5"><TypeBadge type={e.type} /></td>
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-[var(--text-secondary)] space-y-1">
                  {/* en yeni üstte: cevap, altında isteği */}
                  <PayloadLine part={e.error} />
                  <PayloadLine part={e.result} />
                  <PayloadLine part={e.call} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && <div className="border-t border-[var(--border-subtle)]">{pagerBar}</div>}
    </div>
  );
}

/* ── Zaman Çizelgesi ── */
const ROW_ORDER = [
  "Disconnected", "Reset", "Authorize", "Stop Transaction", "Start Transaction",
  "Status Notification", "Meter Value", "Boot Notification", "Heartbeat",
];

// Yakın aralıklı noktaları (heartbeat, meter value) kesintisiz çubuğa birleştirir.
function segmentsOf(times, maxGap) {
  const segs = [];
  for (const t of times) {
    const last = segs[segs.length - 1];
    if (last && t - last.end <= maxGap) last.end = t;
    else segs.push({ start: t, end: t, count: 0 });
    segs[segs.length - 1].count++;
  }
  return segs;
}

function heartbeatGap(times) {
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  if (!gaps.length) return 5 * 60 * 1000;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.min(30 * 60 * 1000, Math.max(2 * 60 * 1000, median * 2.5));
}

function Marker({ shape, x, y, color, size = 5 }) {
  if (shape === "square") return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} fill={color} />;
  if (shape === "up") return <polygon points={`${x},${y - size} ${x - size},${y + size} ${x + size},${y + size}`} fill={color} />;
  if (shape === "down") return <polygon points={`${x - size},${y - size} ${x + size},${y - size} ${x},${y + size}`} fill={color} />;
  return <circle cx={x} cy={y} r={size - 1} fill={color} />;
}

export function TimelineView({ fetchEvents, onPick, autoRefreshMs = 0 }) {
  const [date, setDate] = useState(() => toDateInput(Date.now()));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(900);
  const boxRef = useRef(null);

  const from = dayStart(date);
  const to = from + DAY_MS;

  const load = useCallback(async (fresh) => {
    if (!date) return;
    setLoading(true); setError("");
    try {
      const d = await fetchEvents({ from: dayStart(date), to: dayStart(date) + DAY_MS, fresh });
      setEvents(d.events || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [date, fetchEvents]);

  useEffect(() => { load(false); }, [load]);

  // Canlı veride (frame 3 28 3) çizelge kendiliğinden tazelenir
  useEffect(() => {
    if (!autoRefreshMs) return;
    const iv = setInterval(() => load(false), autoRefreshMs);
    return () => clearInterval(iv);
  }, [autoRefreshMs, load]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowsOf = useMemo(() => {
    const extra = [...new Set(events.map((e) => e.type).filter((t) => !ROW_ORDER.includes(t)))];
    return extra.length ? ["Diğer", ...ROW_ORDER] : ROW_ORDER;
  }, [events]);

  const PAD_L = 16, PAD_R = 16, ROW_H = 20, TOP = 12;
  const plotW = width - PAD_L - PAD_R;
  const xOf = (t) => PAD_L + ((t - from) / DAY_MS) * plotW;
  const yOf = (row) => TOP + rowsOf.indexOf(row) * ROW_H;
  const axisY = TOP + rowsOf.length * ROW_H;
  const height = axisY + 32;

  const byType = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      const row = ROW_ORDER.includes(e.type) ? e.type : "Diğer";
      if (!m.has(row)) m.set(row, []);
      m.get(row).push(e);
    }
    return m;
  }, [events]);

  const ticks = [];
  for (let h = 0; h <= 24; h += 2) ticks.push(h);
  const dayLabel = (ms) => new Date(ms).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

  const legend = [...ROW_ORDER].reverse();

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">İşlem Geçmişi Zaman Çizelgesi</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-8 px-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-primary)]" />
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="h-8 px-3 rounded-md border border-[var(--border-subtle)] text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 disabled:opacity-50">
          <HiOutlineArrowPath className={loading ? "animate-spin" : ""} /> Yenile
        </button>
      </div>

      {error && <p className="text-[12px] text-rose-500 px-4 pt-3">{error}</p>}

      <div ref={boxRef} className="px-4 py-4">
        <svg width={width} height={height} className="block max-w-full">
          {rowsOf.map((row) => (
            <line key={row} x1={PAD_L} x2={width - PAD_R} y1={yOf(row)} y2={yOf(row)} stroke="var(--border-subtle)" />
          ))}

          {rowsOf.map((row) => {
            const list = byType.get(row) || [];
            if (!list.length) return null;
            const y = yOf(row);
            const meta = row === "Diğer" ? OTHER_META : metaOf(row);
            if (meta.shape === "bar") {
              const times = list.map((e) => e.time).sort((a, b) => a - b);
              const gap = row === "Heartbeat" ? heartbeatGap(times) : 15 * 60 * 1000;
              return segmentsOf(times, gap).map((s) => {
                const thick = row === "Heartbeat" ? 8 : 6;
                const x1 = xOf(s.start), x2 = Math.max(xOf(s.end), x1 + 0.1);
                return (
                  <line key={`${row}-${s.start}`} x1={x1} x2={x2} y1={y} y2={y} stroke={meta.color}
                    strokeWidth={thick} strokeLinecap="round" className="cursor-pointer"
                    onClick={() => onPick({ type: row, from: s.start, to: s.end + 1000 })}>
                    <title>{`${row}: ${fmtDateTime(s.start)} – ${fmtDateTime(s.end)} (${s.count} kayıt)`}</title>
                  </line>
                );
              });
            }
            return list.map((e) => (
              <g key={`${e.id}|${e.time}`} className="cursor-pointer"
                onClick={() => onPick({ type: e.type, from: e.time - 1000, to: e.time + 1000 })}>
                <Marker shape={meta.shape} x={xOf(e.time)} y={y} color={meta.color} />
                <title>{`${e.type} — ${fmtDateTime(e.time)}`}</title>
              </g>
            ));
          })}

          <line x1={PAD_L} x2={width - PAD_R} y1={axisY} y2={axisY} stroke="var(--text-muted)" />
          {ticks.map((h) => {
            const x = xOf(from + h * 60 * 60 * 1000);
            const text = h === 0 ? dayLabel(from) : h === 24 ? dayLabel(to) : `${pad(h)}:00`;
            return (
              <g key={h}>
                <line x1={x} x2={x} y1={axisY} y2={axisY + 5} stroke="var(--text-muted)" />
                <text x={x} y={axisY + 18} fontSize="10" fill="var(--text-muted)"
                  textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>{text}</text>
              </g>
            );
          })}
        </svg>

        {!loading && events.length === 0 && !error && (
          <p className="text-[12px] text-[var(--text-muted)] italic text-center -mt-2">Bu gün için arşivde kayıt yok.</p>
        )}

        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-3 text-[11px] text-[var(--text-secondary)]">
          {legend.map((t) => {
            const meta = metaOf(t);
            return (
              <span key={t} className="flex items-center gap-1.5">
                <svg width="12" height="12"><Marker shape={meta.shape === "bar" ? "circle" : meta.shape} x={6} y={6} color={meta.color} /></svg>
                {t}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Arşiv aktarımı Kayıtlı arşiv sekmesindeki scope 1–4 düğmeleriyle başlatılır;
// bu kart aktarılan OCPP dosyalarını olaylara çevirip gösterir.
export default function OcppArchive({ token, mac }) {
  const [view, setView] = useState("history");
  const [preset, setPreset] = useState(null);
  const fetchEvents = useArchiveFetch(token);

  const pick = (p) => { setPreset(p); setView("history"); };

  const tab = (key, icon, text) => (
    <button onClick={() => setView(key)}
      className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-md border transition
        ${view === key
          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
          : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
      {icon} {text}
    </button>
  );

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-bold text-[var(--text-secondary)]">OCPP Arşivi</span>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">aktarılan OCPP dosyalarından</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {tab("history", <HiOutlineListBullet />, "İşlem Geçmişi")}
          {tab("timeline", <HiOutlineChartBar />, "Zaman Çizelgesi")}
        </div>
      </div>

      {view === "history"
        ? <HistoryView fetchEvents={fetchEvents} mac={mac} preset={preset} />
        : <TimelineView fetchEvents={fetchEvents} onPick={pick} />}
    </div>
  );
}
