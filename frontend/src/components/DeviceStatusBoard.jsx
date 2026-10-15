import { useState, useEffect, useCallback, useMemo, useRef, useId, createContext, useContext } from "react";
import {
  HiOutlineViewColumns, HiOutlineMapPin, HiOutlineArrowPath,
  HiOutlineBolt, HiOutlineBoltSlash, HiOutlinePauseCircle, HiOutlineFlag, HiOutlineExclamationTriangle,
  HiOutlineMoon, HiOutlineSignalSlash, HiOutlineQuestionMarkCircle, HiOutlineMagnifyingGlass,
  HiOutlineChevronDown, HiOutlineArrowsPointingIn, HiOutlineArrowsPointingOut, HiOutlineServerStack,
} from "react-icons/hi2";
import { TbPlugConnected } from "react-icons/tb";
import OcppLiveConsole from "./OcppLiveConsole.jsx";
import OcppDeviceModal from "./OcppDeviceModal.jsx";

// Kutucuk popover'ındaki "Mesaj Geçmişi" düğmesi cihaz penceresini açar —
// tile'lar birkaç bileşen derinde olduğu için prop zinciri yerine context.
const OpenHistoryContext = createContext(null);
// "Durumu şimdi oku": { onRefresh(cihaz | cihazlar), refreshingIds: { [id]: true } }
const RefreshContext = createContext({ onRefresh: null, refreshingIds: {} });
const isRefreshing = (refreshingIds, d) => !!d.polling || !!refreshingIds[String(d.id)];

/* ── Toplu Okuma ──
   Şirket bazlı, sürekli tazelenen canlı cihaz durumu panosu. "Toplu
   Güncelleme/Parametre" gibi bir İŞ değil — sadece görüntüleme. Backend
   (device-status-poll.js) bu sayfa her GET attığında arka plandaki izleme
   döngüsünü canlı tutuyor; sayfadan çıkılıp bir süre GET atılmazsa döngü
   kendiliğinden duruyor. Biz burada sadece periyodik olarak soruyoruz. */

const POLL_MS = 4000;

// Renkler Echargo "Bağlantı Renkleri" açıklamasıyla aynı anlamda:
// yeşil bağlantı var/müsait, mavi şarj, sarı araç bağlı, mor şarj bitti,
// gri arıza, kırmızı bağlantı yok, beyaz erişim yok / henüz okunmadı.
const tone = (hex, text, extra = {}) => ({
  hex, text, dot: "", bar: "",
  chip: `border-transparent text-white`,
  ...extra,
});
const STATE_META = {
  charging:     { ...tone("#2f80ed", "text-[#2f80ed]"), label: "Şarj Oluyor", icon: HiOutlineBolt },
  waiting_rfid: { ...tone("#f2c037", "text-[#c99a0e]"), label: "Araç Bağlı, Şarj Yok", icon: HiOutlinePauseCircle },
  charge_ended: { ...tone("#9b51e0", "text-[#9b51e0]"), label: "Şarj Bitti, Soket Takılı", icon: HiOutlineFlag },
  not_plugged:  { ...tone("#4caf50", "text-[#3d9a41]"), label: "Müsait (Soket Takılı Değil)", icon: HiOutlineBoltSlash },
  idle:         { ...tone("#4caf50", "text-[#3d9a41]"), label: "Müsait", icon: HiOutlineMoon },
  error:        { ...tone("#7d7d7d", "text-[#6b6b6b]"), label: "Arıza", icon: HiOutlineExclamationTriangle },
  offline:      { ...tone("#e0245e", "text-[#e0245e]"), label: "Bağlantı Yok", icon: HiOutlineSignalSlash },
  unknown:      { ...tone("#ffffff", "text-[var(--text-muted)]"), label: "Erişim Yok", icon: HiOutlineQuestionMarkCircle },
  checking:     { ...tone("#ffffff", "text-[var(--text-muted)]"), label: "Kontrol ediliyor", icon: HiOutlineArrowPath },
};
const STATE_ORDER = ["idle", "not_plugged", "charging", "waiting_rfid", "charge_ended", "error", "offline", "unknown", "checking"];

// Alttaki "Bağlantı Renkleri" açıklaması ve üstteki sayaç kutuları
const LEGEND = [
  { label: "Cihazda Bağlantı Var", hex: "#4caf50" },
  { label: "Cihazda Bağlantı Yok", hex: "#e0245e" },
  { label: "Cihazda Araç Bağlı", hex: "#f2c037" },
  { label: "Cihazda Şarj Oluyor", hex: "#2f80ed" },
  { label: "Cihazda Şarj Bitti", hex: "#9b51e0" },
  { label: "Cihazda Arıza", hex: "#7d7d7d" },
  { label: "Cihazda Erişim Yok", hex: "#ffffff" },
];
const STAT_CARDS = [
  { key: "online",   label: "Çevrimiçi",   sub: "Online",   hex: "#4caf50", states: ["idle", "not_plugged", "charging", "waiting_rfid", "charge_ended", "error"] },
  { key: "charging", label: "Şarjda",      sub: "Charging", hex: "#2f80ed", states: ["charging"] },
  { key: "vehicle",  label: "Araç Bağlı",  sub: "Vehicle",  hex: "#f2c037", states: ["waiting_rfid"] },
  { key: "ended",    label: "Şarj Bitti",  sub: "Ended",    hex: "#9b51e0", states: ["charge_ended"] },
  { key: "faulted",  label: "Arızalı",     sub: "Faulted",  hex: "#7d7d7d", states: ["error"] },
  { key: "offline",  label: "Çevrimdışı",  sub: "Offline",  hex: "#e0245e", states: ["offline"] },
  { key: "idle",     label: "Boşta",       sub: "Idle",     hex: "#94a3b8", states: ["idle", "not_plugged"] },
];

// Soket tipi: konumda / kodda "DC" geçiyorsa DC, yoksa AC
const socketType = (d) => (/\bDC\b/i.test(`${d.location || ""} ${d.device_code || ""}`) ? "DC" : "AC");

function timeAgo(value) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dakika`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} saat` : `${Math.floor(h / 24)} gün`;
}

const metaFor = (state) => STATE_META[state] || STATE_META.unknown;

// Aynı sitedeki cihazlar çoğu zaman "... - 1", "...-2", "... AC 01" (sonda)
// ya da "ac1 ...", "dc2 ..." (başta) gibi sadece bir cihaz numarasıyla
// ayrılan konum adları kullanıyor. Bu iki genel kalıbı atıp ortak site adına
// indiriyoruz. Cihazın TAM konumu yine de tıklanan kutucuğun bilgi
// balonunda gösteriliyor, hiçbir şey kaybolmuyor.
const TRAILING_INDEX_RE = /[\s,\-–]*\b(?:AC|DC)?\s*\d+\s*$/i;
const LEADING_INDEX_RE = /^[A-Za-z]{1,4}\d{1,3}\s+/;
function siteNameOf(rawLocation) {
  const loc = (rawLocation || "").trim();
  if (!loc) return "Konum belirtilmemiş";
  let stripped = loc.replace(TRAILING_INDEX_RE, "").trim();
  stripped = stripped.replace(LEADING_INDEX_RE, "").trim();
  return stripped.length >= 2 ? stripped : loc;
}

// Genel kural her şirkette işe yaramıyor — örneğin "Grand Ankara Otel
// Atatürk Bul..." ile "Grand Ankara Otel Kapalı Otop..." aynı önekle
// başlıyor ama FARKLI siteler; kör "ortak önek → birleştir" kuralı burada
// yanlış gruplar oluşturur. Bu yüzden sadece kullanıcının onayladığı,
// burada açıkça tanımlı istisnalar için elle kural tanımlıyoruz:
//  - "single": şirketin TÜM cihazları tek kartta toplanır (konumlar önemsiz)
//  - "blocks": belirtilen önekle başlayan konumlar aynı site kartında
//    toplanır, önekten sonra kalan kısım ("D Blok" gibi) kart içinde ayrı
//    bir alt-blok başlığı olarak gösterilir.
const COMPANY_GROUPING_RULES = {
  "bluetech": { mode: "single" },
  "Sepaş": { mode: "blocks", prefixes: ["Zeray Anadolu", "Zeray Anatolia", "Zeray Esil", "Zeray Perla"] },
};

function buildSiteGroups(devices, company) {
  const rule = COMPANY_GROUPING_RULES[company];

  if (rule?.mode === "single") {
    return [{ site: company || "Tüm cihazlar", devices, blocks: null }];
  }

  const bySite = new Map(); // site -> { devices: [], blocksMap: Map<label, device[]> }
  for (const d of devices) {
    const loc = (d.location || "").trim();
    let site = null;
    let blockLabel = null;

    if (rule?.mode === "blocks") {
      const prefix = rule.prefixes.find((p) => loc.toLowerCase().startsWith(p.toLowerCase()));
      if (prefix) {
        site = prefix;
        blockLabel = (loc.slice(prefix.length).trim().replace(/\bblok\b/i, "Blok")) || "Diğer";
      }
    }
    if (!site) site = siteNameOf(loc);

    if (!bySite.has(site)) bySite.set(site, { devices: [], blocksMap: new Map() });
    const entry = bySite.get(site);
    entry.devices.push(d);
    if (blockLabel) {
      if (!entry.blocksMap.has(blockLabel)) entry.blocksMap.set(blockLabel, []);
      entry.blocksMap.get(blockLabel).push(d);
    }
  }

  return [...bySite.entries()]
    .map(([site, { devices, blocksMap }]) => ({
      site,
      devices,
      blocks: blocksMap.size > 1
        ? [...blocksMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr")).map(([label, devs]) => ({ label, devices: devs }))
        : null,
    }))
    .sort((a, b) => a.site.localeCompare(b.site, "tr"));
}

function countStates(devices) {
  const counts = {};
  for (const d of devices) counts[d.state] = (counts[d.state] || 0) + 1;
  return counts;
}

function SegmentedBar({ devices, className = "" }) {
  const total = devices.length || 1;
  const counts = countStates(devices);
  return (
    <div className={`h-1.5 rounded-full overflow-hidden flex bg-[var(--border-subtle)] ${className}`}>
      {STATE_ORDER.filter((s) => counts[s]).map((s) => (
        <div key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: metaFor(s).hex === "#ffffff" ? "#d4d4d8" : metaFor(s).hex }} />
      ))}
    </div>
  );
}

// Renkli nokta + adet (şehir / ilçe başlıklarında)
function StateCounts({ devices }) {
  const counts = countStates(devices);
  const groups = new Map();
  for (const s of STATE_ORDER) {
    if (!counts[s]) continue;
    const hex = metaFor(s).hex;
    groups.set(hex, (groups.get(hex) || 0) + counts[s]);
  }
  return (
    <span className="flex items-center gap-2.5 flex-wrap">
      {[...groups].map(([hex, n]) => (
        <span key={hex} className="flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)] tabular-nums">
          <span className="w-2 h-2 rounded-full border border-black/10" style={{ background: hex }} />{n}
        </span>
      ))}
    </span>
  );
}

// Şarj cihazı çizimi (fotoğraf değil, SVG): soketin çevresindeki halka ve köşedeki
// nokta cihazın durum rengini taşır. Beyaz durumlar (erişim yok / kontrol) açık
// zeminde görünmediği için gri çizilir.
function ChargerGlyph({ hex, dim = false }) {
  const ring = hex.toLowerCase() === "#ffffff" ? "#9aa3ad" : hex;
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 56" className={`w-[36px] h-[50px] drop-shadow-sm ${dim ? "opacity-60" : ""}`} aria-hidden="true">
      <defs>
        <linearGradient id={`side${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8d949c" /><stop offset=".45" stopColor="#e4e7ea" /><stop offset="1" stopColor="#9aa1a8" />
        </linearGradient>
        <radialGradient id={`glow${uid}`} cx=".5" cy=".5" r=".5">
          <stop offset=".55" stopColor={ring} stopOpacity=".55" /><stop offset="1" stopColor={ring} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="3" y="2" width="34" height="51" rx="6" fill="#2a2e34" stroke="#4a515a" strokeWidth=".8" />
      <rect x="3.6" y="5" width="5.4" height="45" rx="2.4" fill={`url(#side${uid})`} />
      <rect x="31" y="5" width="5.4" height="45" rx="2.4" fill={`url(#side${uid})`} />
      <rect x="9" y="3.5" width="22" height="48" rx="3.5" fill="#1d2126" />
      <rect x="13" y="8.5" width="14" height="10" rx="1.6" fill="#59616b" />
      <circle cx="20" cy="35" r="11" fill={`url(#glow${uid})`} />
      <circle cx="20" cy="35" r="7.6" fill="#15181c" stroke={ring} strokeWidth="2.2" />
      <circle cx="20" cy="35" r="4.6" fill="#24282e" stroke="#3a4048" strokeWidth=".6" />
      {[[18.2, 33.2], [21.8, 33.2], [17.2, 35.6], [20, 35.6], [22.8, 35.6], [18.6, 37.8], [21.4, 37.8]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r=".75" fill="#7a828c" />
      ))}
      <rect x="9" y="51.5" width="22" height="2" rx="1" fill="#000" opacity=".25" />
    </svg>
  );
}

// Referans görseldeki gibi: her cihaz kendi renkli kutucuğu. Dokunmatikte de
// çalışsın diye hover değil, TIKLAMA ile açılan estetik bir bilgi kutucuğu —
// konum, MAC, aktiflik ve şarj durumunu gösteriyor.
const POPOVER_W = 256; // w-64
const POPOVER_MARGIN = 10; // ekran kenarından minimum boşluk

function DeviceTile({ d, tileKey, isOpen, onToggle, onConnectDevice, connecting, connectError }) {
  const meta = metaFor(d.state);
  const Icon = meta.icon;
  const active = d.state === "checking" ? null : d.state !== "offline";
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null); // { left, arrowLeft, top, side }
  const openHistory = useContext(OpenHistoryContext);
  const { onRefresh, refreshingIds } = useContext(RefreshContext);
  const refreshing = !!refreshingIds[String(d.id)];

  // Kutucuk her zaman tıklanan cihazın TAM ortasına, ekranın merkezine değil —
  // bu yüzden konumu viewport'a göre hesaplayıp kenarlardan taşmayacak şekilde
  // kırpıyoruz (bkz. ok işaretinin ayrı hesaplanan konumu, kutunun kendisi
  // kaysa da hep tıklanan cihazı işaret etsin diye). Sayfa 4 saniyede bir
  // arka planda kendiliğinden tazelendiği için (bkz. POLL_MS) açık bir
  // kutucuğun altındaki/üstündeki içerik boy değiştirip kutucuğu kaydırabilir
  // — bu yüzden sadece açılışta değil, açık kaldığı sürece de periyodik
  // olarak yeniden ölçüyoruz.
  useEffect(() => {
    if (!isOpen || !btnRef.current) { setPos(null); return; }
    const update = () => {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const centerX = rect.left + rect.width / 2;
      const left = Math.max(POPOVER_MARGIN, Math.min(centerX - POPOVER_W / 2, vw - POPOVER_W - POPOVER_MARGIN));
      const arrowLeft = Math.max(14, Math.min(centerX - left, POPOVER_W - 14));
      const side = (vh - rect.bottom) > 230 ? "bottom" : "top";
      const top = side === "bottom" ? rect.bottom + 10 : rect.top - 10;
      setPos({ left, arrowLeft, top, side });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const iv = setInterval(update, 500);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      clearInterval(iv);
    };
  }, [isOpen]);

  return (
    <div className="relative" data-tile-key={tileKey}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={`${(d.device_code || "Cihaz").trim()} · ${socketType(d)} — ${meta.label}`}
        className={`relative w-[62px] h-[70px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]
                    flex items-center justify-center shrink-0
                    transition hover:-translate-y-0.5 hover:shadow-md active:scale-95
                    ${isOpen ? "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--bg-page,transparent)]" : ""}`}
      >
        <ChargerGlyph hex={meta.hex} dim={d.state === "offline" || d.state === "checking"} />
        <span className="absolute right-1 top-1 w-[9px] h-[9px] rounded-full border border-black/15" style={{ background: meta.hex }} />
        {(d.polling || refreshing) && (
          <span className="absolute -right-1 -top-1 w-4 h-4 rounded-full bg-[var(--bg-elevated,#fff)] border border-[var(--accent-border)] text-[var(--accent)] flex items-center justify-center shadow-sm">
            <HiOutlineArrowPath className="text-[10px] animate-spin" />
          </span>
        )}
      </button>

      {isOpen && pos && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", left: pos.left, width: POPOVER_W,
            ...(pos.side === "bottom" ? { top: pos.top } : { top: pos.top, transform: "translateY(-100%)" }),
          }}
          className="z-30 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated,#fff)] shadow-2xl p-3.5 text-left"
        >
          <div className="flex items-center gap-2 mb-2.5 pb-2.5 border-b border-[var(--border-subtle)]">
            <span className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center shrink-0 text-white"
              style={{ background: meta.hex === "#ffffff" ? "#a1a1aa" : meta.hex }}>
              <Icon className={`text-[14px] ${d.state === "checking" ? "animate-spin" : ""}`} />
            </span>
            <span className={`text-[13px] font-bold truncate flex-1 ${meta.text}`}>
              {(d.device_code || "Cihaz").trim()}
            </span>
            <button
              type="button"
              title="Durumu şimdi oku"
              onClick={(e) => { e.stopPropagation(); onRefresh?.(d); }}
              disabled={refreshing}
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center border
                         bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)]
                         hover:bg-[var(--accent-soft-hover)] transition cursor-pointer
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <HiOutlineArrowPath className={`text-[12px] ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              title="Cihaza Bağlan"
              onClick={(e) => { e.stopPropagation(); onConnectDevice?.(d); }}
              disabled={connecting || d.id === undefined || d.id === null}
              className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center border
                         bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)]
                         hover:bg-[var(--accent-soft-hover)] transition cursor-pointer
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {connecting
                ? <HiOutlineArrowPath className="text-[13px] animate-spin" />
                : <TbPlugConnected className="text-[13px]" />}
            </button>
          </div>
          <dl className="flex flex-col gap-1.5 text-[11.5px]">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0 pt-px">Konum</dt>
              <dd className={`font-semibold text-right break-words ${meta.text}`}>{d.location || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">MAC adresi</dt>
              <dd className={`font-mono text-[11px] text-right truncate ${meta.text}`}>{d.mac || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">Aktif mi</dt>
              <dd className={`font-bold ${active === null ? "text-[var(--text-muted)]" : active ? "text-emerald-500" : "text-rose-500"}`}>
                {active === null ? "Kontrol ediliyor" : active ? "Evet" : "Hayır"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">Şarj durumu</dt>
              <dd className={`font-bold ${meta.text}`}>{meta.label}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">Maks. Güç</dt>
              <dd className={`font-bold ${meta.text}`}>{d.max_power || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">Versiyon</dt>
              <dd className={`font-mono text-[11px] font-bold ${meta.text}`}>{d.sw_version || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">Son veri</dt>
              <dd className="font-semibold text-[var(--text-secondary)]">{timeAgo(d.updated_at)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)] font-medium shrink-0">İlçe / Şehir</dt>
              <dd className="font-semibold text-right text-[var(--text-secondary)]">{[d.district, d.city].filter(Boolean).join(" / ") || "—"}</dd>
            </div>
          </dl>
          {connectError && (
            <p className="mt-2 text-[11px] font-semibold text-rose-500">{connectError}</p>
          )}
          {openHistory && d.id !== undefined && d.id !== null && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); openHistory(d); }}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11.5px] font-semibold px-2 py-1.5 rounded-lg border
                         border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition">
              <HiOutlineViewColumns className="text-[13px]" /> Mesaj Geçmişi
            </button>
          )}
          <div
            style={{ left: pos.arrowLeft }}
            className={`absolute w-2.5 h-2.5 rotate-45 bg-[var(--bg-elevated,#fff)]
                        ${pos.side === "top"
                          ? "top-full -mt-[6px] border-r border-b border-[var(--border-subtle)]"
                          : "bottom-full -mb-[6px] border-l border-t border-[var(--border-subtle)]"}`}
          />
        </div>
      )}
    </div>
  );
}

function DeviceTileRow({ devices, openKey, setOpenKey, onConnectDevice, connecting, connectError }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {devices.map((d) => {
        const key = d.mac || d.device_code;
        return (
          <DeviceTile
            key={key}
            tileKey={key}
            d={d}
            isOpen={openKey === key}
            onToggle={() => setOpenKey(openKey === key ? null : key)}
            onConnectDevice={onConnectDevice}
            connecting={connecting}
            connectError={connectError}
          />
        );
      })}
    </div>
  );
}

function RefreshButton({ devices, title, small = false }) {
  const { onRefresh, refreshingIds } = useContext(RefreshContext);
  const busy = devices.some((d) => isRefreshing(refreshingIds, d));
  return (
    <button type="button" title={title} onClick={() => onRefresh?.(devices)} disabled={busy}
      className={`${small ? "w-5 h-5" : "w-7 h-7"} rounded-full flex items-center justify-center border shrink-0
                  bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)]
                  hover:bg-[var(--accent-soft-hover)] transition cursor-pointer
                  disabled:opacity-40 disabled:cursor-not-allowed`}>
      <HiOutlineArrowPath className={`${small ? "text-[10px]" : "text-[13px]"} ${busy ? "animate-spin" : ""}`} />
    </button>
  );
}

function LocationCard({ site, devices, blocks, openKey, setOpenKey, onConnectDevice, connecting, connectError }) {
  return (
    <div className="h-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 flex flex-col gap-3 hover:shadow-sm transition">
      <div className="flex items-center gap-1.5 min-w-0">
        <HiOutlineMapPin className="text-[var(--accent)] text-[15px] shrink-0" />
        <span className="text-[13px] font-bold text-[var(--text-primary)] leading-snug break-words flex-1 min-w-0" title={site}>{site}</span>
        <RefreshButton devices={devices} title="Bu sektörü şimdi oku" small />
      </div>

      {blocks ? (
        // Bloklar yan yana dizilir — her blok ayrı satır kaplayıp kartı uzatmasın
        <div className="flex flex-wrap gap-x-4 gap-y-3">
          {blocks.map((b) => (
            <div key={b.label}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{b.label}</div>
                <RefreshButton devices={b.devices} title="Bu bölümü şimdi oku" small />
              </div>
              <DeviceTileRow devices={b.devices} openKey={openKey} setOpenKey={setOpenKey}
                onConnectDevice={onConnectDevice} connecting={connecting} connectError={connectError} />
            </div>
          ))}
        </div>
      ) : (
        <DeviceTileRow devices={devices} openKey={openKey} setOpenKey={setOpenKey}
          onConnectDevice={onConnectDevice} connecting={connecting} connectError={connectError} />
      )}

      <div className="mt-auto flex items-center gap-2.5 pt-2.5 border-t border-dashed border-[var(--border-subtle)] text-[11px] font-bold text-[var(--text-muted)]">
        {["AC", "DC"].map((t) => {
          const n = devices.filter((d) => socketType(d) === t).length;
          return n ? <span key={t}>{t} <span className="text-[var(--text-secondary)]">{n}</span></span> : null;
        })}
        <SegmentedBar devices={devices} className="h-1 flex-1 ml-1" />
      </div>
    </div>
  );
}

const NO_CITY = "Şehir belirtilmemiş";
const NO_DISTRICT = "İlçe belirtilmemiş";

// Şehir → İlçe → Lokasyon (site) ağacı. Şehir/ilçe Cihaz Yönetimi'nden girilir;
// boş olanlar "belirtilmemiş" grubunda en sonda toplanır.
function buildHierarchy(devices, company) {
  const cities = new Map();
  for (const d of devices) {
    const city = d.city || NO_CITY;
    const district = d.district || NO_DISTRICT;
    if (!cities.has(city)) cities.set(city, new Map());
    const districts = cities.get(city);
    if (!districts.has(district)) districts.set(district, []);
    districts.get(district).push(d);
  }
  const lastIf = (name, empty) => (a, b) => (a[0] === empty) - (b[0] === empty) || a[0].localeCompare(b[0], "tr");
  return [...cities].sort(lastIf(null, NO_CITY)).map(([city, districts]) => {
    const list = [...districts].sort(lastIf(null, NO_DISTRICT)).map(([district, devs]) => ({
      district, devices: devs, sites: buildSiteGroups(devs, company),
    }));
    return { city, districts: list, devices: list.flatMap((x) => x.devices) };
  });
}

function StatCard({ label, sub, hex, value, pct, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`relative text-left rounded-xl border bg-[var(--bg-surface)] px-4 py-3 transition hover:shadow-sm overflow-hidden
        ${active ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30" : "border-[var(--border-subtle)]"}`}>
      {hex && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: hex }} />}
      <div className="flex items-start gap-1.5">
        {hex && <span className="mt-[5px] w-2 h-2 rounded-full shrink-0" style={{ background: hex }} />}
        <div className="min-w-0">
          <div className={hex ? "text-[12.5px] font-semibold text-[var(--text-primary)] leading-tight" : "text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--text-muted)]"}>{label}</div>
          {sub && <div className="text-[10px] text-[var(--text-muted)] leading-tight">{sub}</div>}
        </div>
      </div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[28px] leading-none font-bold font-display text-[var(--text-primary)] tabular-nums">{value}</span>
        {pct !== undefined && <span className="text-[11px] font-medium text-[var(--text-muted)] tabular-nums">{pct}%</span>}
      </div>
    </button>
  );
}

function DistrictSection({ district, devices, sites, open, onToggle, tileProps }) {
  return (
    <div className="border-t border-[var(--border-subtle)] first:border-t-0">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition text-left">
        <HiOutlineChevronDown className={`text-[13px] text-[var(--text-muted)] transition ${open ? "" : "-rotate-90"}`} />
        <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--text-secondary)] w-[180px] truncate shrink-0">{district}</span>
        <StateCounts devices={devices} />
        <SegmentedBar devices={devices} className="h-1 flex-1 min-w-[60px]" />
      </button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] items-stretch gap-3 px-3 pb-3">
          {sites.map((g) => (
            <LocationCard key={g.site} site={g.site} devices={g.devices} blocks={g.blocks} {...tileProps} />
          ))}
        </div>
      )}
    </div>
  );
}

function CityCard({ city, districts, devices, open, onToggle, openDistricts, toggleDistrict, tileProps }) {
  const header = (
    <button type="button" onClick={onToggle} className="w-full text-left flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <HiOutlineChevronDown className={`text-[13px] text-[var(--text-muted)] transition ${open ? "" : "-rotate-90"}`} />
        <span className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-primary)] truncate">{city}</span>
      </div>
      <div className="pl-5 text-[11px] text-[var(--accent)] font-medium">
        {districts.length} ilçe · {devices.length} istasyon
      </div>
      <div className="pl-5"><StateCounts devices={devices} /></div>
      <SegmentedBar devices={devices} className="h-1.5 mt-1" />
    </button>
  );
  if (!open) {
    return <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 hover:shadow-sm transition">{header}</div>;
  }
  return (
    <div className="col-span-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] overflow-hidden">
      <div className="p-3.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">{header}</div>
      <div className="bg-[var(--bg-surface)]">
        {districts.map((x) => (
          <DistrictSection key={x.district} {...x} open={openDistricts.has(`${city}|${x.district}`)}
            onToggle={() => toggleDistrict(`${city}|${x.district}`)} tileProps={tileProps} />
        ))}
      </div>
    </div>
  );
}

export default function DeviceStatusBoard({ token, currentUser, onConnect }) {
  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  // admin da device-scope'ta superadmin gibi unrestricted (bkz. backend/device-scope.js) —
  // şirket seçici ve ?company= sorgusu ikisi için de aynı şekilde çalışmalı.
  const isSuperadmin = currentUser?.role === "superadmin" || currentUser?.role === "admin";

  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [openKey, setOpenKeyRaw] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  // Popover değişince önceki denemenin hata mesajı yeni cihaza taşınmasın diye.
  const setOpenKey = useCallback((key) => { setConnectError(""); setOpenKeyRaw(key); }, []);
  const [historyDevice, setHistoryDevice] = useState(null); // { deviceId, name }
  const [search, setSearch] = useState("");
  const [statFilter, setStatFilter] = useState(null); // STAT_CARDS key
  const [openCities, setOpenCities] = useState(() => new Set());
  const [openDistricts, setOpenDistricts] = useState(() => new Set());
  const [showConsole, setShowConsole] = useState(true);
  const diagramRef = useRef(null);
  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // "Şimdi oku" istenen cihazlar: yeni bir okuma (updated_at değişimi) gelene ya da
  // 45 sn dolana kadar dönen simgeyle gösterilir.
  const [refreshingIds, setRefreshingIds] = useState({});
  const lastUpdatedRef = useRef(new Map()); // id -> updated_at
  const refreshTimersRef = useRef(new Map()); // id -> timeout
  const openHistory = useCallback((d) => {
    setOpenKeyRaw(null);
    setHistoryDevice({ deviceId: d.id, name: [d.location, d.device_code].filter(Boolean).join(" ") || "Cihaz" });
  }, []);

  // Dışarıya (başka bir kutucuğa ya da boş bir yere) tıklanınca açık
  // bilgi kutucuğunu kapat — dokunmatik cihazlarda da doğal davranır.
  useEffect(() => {
    if (!openKey) return;
    const onDocClick = (e) => {
      if (!e.target.closest("[data-tile-key]")) setOpenKey(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [openKey, setOpenKey]);

  useEffect(() => { setOpenKey(null); }, [selectedCompany, setOpenKey]);

  // "Cihaza Bağlan" — DeviceSelect.jsx'teki AYNI mantık: MAC yerine deviceId
  // gönderiliyor ki operatörler de (MAC'i görmeseler bile) bağlanabilsin,
  // yetki backend'de deviceId üzerinden doğrulanıyor.
  const handleConnectDevice = useCallback(async (d, force = false) => {
    if (d.id === undefined || d.id === null) { setConnectError("Cihaz kimliği okunamadı"); return; }
    setConnecting(true);
    setConnectError("");
    try {
      const r = await authFetch("/api/update-target", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: d.id, force }),
      });
      const data = await r.json();

      if (!r.ok && r.status === 409 && data.code === "DEVICE_OCCUPIED" && isSuperadmin) {
        setConnecting(false);
        if (window.confirm(`Bu cihaz şu anda ${data.occupiedBy} tarafından kullanılıyor.\n\nBağlantısını keserek devralmak istiyor musunuz?`)) {
          handleConnectDevice(d, true);
        }
        return;
      }
      if (!r.ok) { setConnectError(data.error || "Bağlanılamadı"); setConnecting(false); return; }
      onConnect?.(d.mac || "", d);
    } catch {
      setConnectError("Sunucuya ulaşılamadı");
      setConnecting(false);
    }
  }, [authFetch, isSuperadmin, onConnect]);

  const dropRefreshing = useCallback((ids) => setRefreshingIds((prev) => {
    const next = { ...prev };
    ids.forEach((id) => { delete next[id]; });
    return next;
  }), []);

  const refreshDevices = useCallback(async (target) => {
    const list = Array.isArray(target) ? target : [target];
    const ids = [...new Set(list.map((d) => d?.id).filter((id) => id !== undefined && id !== null).map(String))];
    if (ids.length === 0) return;
    setConnectError("");
    setRefreshingIds((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = true; });
      return next;
    });
    ids.forEach((id) => {
      const old = refreshTimersRef.current.get(id);
      if (old) clearTimeout(old);
      refreshTimersRef.current.set(id, setTimeout(() => {
        dropRefreshing([id]);
        refreshTimersRef.current.delete(id);
      }, 45000));
    });
    try {
      const r = await authFetch("/api/device-status/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceIds: ids, company: selectedCompany || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setConnectError(d.error || "Okuma başlatılamadı"); dropRefreshing(ids); }
    } catch {
      setConnectError("Durum okunamadı");
      dropRefreshing(ids);
    }
  }, [authFetch, selectedCompany, dropRefreshing]);

  useEffect(() => {
    if (!isSuperadmin) return;
    authFetch("/api/devices/companies").then((r) => r.json())
      .then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, [authFetch, isSuperadmin]);

  useEffect(() => {
    if (isSuperadmin && companies.length === 1 && !selectedCompany) setSelectedCompany(companies[0]);
  }, [companies, isSuperadmin, selectedCompany]);

  // Operatör kendi şirketine kilitli — backend query'yi zaten görmezden gelip
  // kendi kapsamını kullanıyor, burada sadece "hazır" say ki poll başlasın.
  const ready = isSuperadmin ? !!selectedCompany : true;

  useEffect(() => {
    if (!ready) { setDevices([]); hasLoadedOnce.current = false; return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const url = isSuperadmin
          ? `/api/device-status?company=${encodeURIComponent(selectedCompany)}`
          : "/api/device-status";
        const r = await authFetch(url);
        const d = await r.json();
        if (!cancelled) {
          const list = d.devices || [];
          const prevUpdated = lastUpdatedRef.current;
          // Yeni bir okuma geldiyse (updated_at değişti) o cihazın "okunuyor" işareti kalkar
          setRefreshingIds((prev) => {
            const next = { ...prev };
            list.forEach((dev) => {
              const id = String(dev.id), before = prevUpdated.get(id);
              if (next[id] && dev.updated_at && before && dev.updated_at !== before) {
                delete next[id];
                const t = refreshTimersRef.current.get(id);
                if (t) clearTimeout(t);
                refreshTimersRef.current.delete(id);
              }
            });
            return next;
          });
          lastUpdatedRef.current = new Map(list.map((dev) => [String(dev.id), dev.updated_at || null]));
          setDevices(list);
        }
      } catch {}
      if (!cancelled) { setLoading(false); hasLoadedOnce.current = true; }
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, isSuperadmin, selectedCompany, ready]);

  // Cihaz kayıtları kendi "company" alanını taşıyor — superadmin'in seçtiği
  // değeri değil, gerçek veriyi esas alıyoruz (operatörde selectedCompany zaten boş).
  const activeCompany = devices[0]?.company || selectedCompany;
  const total = devices.length;

  const counts = useMemo(() => countStates(devices), [devices]);
  const countOf = (states) => states.reduce((n, st) => n + (counts[st] || 0), 0);
  const pctOf = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // Arama + sayaç kutusu filtresi
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    const states = statFilter ? STAT_CARDS.find((c) => c.key === statFilter)?.states : null;
    return devices.filter((d) => {
      if (states && !states.includes(d.state)) return false;
      if (!q) return true;
      return [d.location, d.device_code, d.city, d.district, d.mac, d.serial_no]
        .some((v) => String(v || "").toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [devices, search, statFilter]);

  const hierarchy = useMemo(() => buildHierarchy(visible, activeCompany), [visible, activeCompany]);
  // Arama ya da filtre varken eşleşen tüm şehir ve ilçeler açık gösterilir
  const filtering = !!search.trim() || !!statFilter;
  const isCityOpen = (city) => filtering || openCities.has(city);
  const districtSetFor = filtering
    ? new Set(hierarchy.flatMap((c) => c.districts.map((x) => `${c.city}|${x.district}`)))
    : openDistricts;
  const anyOpen = openCities.size > 0 || openDistricts.size > 0;

  const toggleCity = (city) => {
    toggleIn(setOpenCities)(city);
    // Şehir ilk açıldığında tek ilçesi varsa onu da aç
    const entry = hierarchy.find((c) => c.city === city);
    if (entry && entry.districts.length === 1 && !openCities.has(city)) {
      setOpenDistricts((prev) => new Set(prev).add(`${city}|${entry.districts[0].district}`));
    }
  };

  const toggleFullscreen = () => {
    const el = diagramRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  };

  const tileProps = { openKey, setOpenKey, onConnectDevice: handleConnectDevice, connecting, connectError };
  const btn = "flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-md border transition";

  return (
    <OpenHistoryContext.Provider value={openHistory}>
    <RefreshContext.Provider value={{ onRefresh: refreshDevices, refreshingIds }}>
    <div>

      {isSuperadmin && (
        <div className="mb-4">
          <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
            Şirket
          </label>
          <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}
            className="w-full sm:w-1/2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
            <option value="">Şirket seçin...</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {!ready ? (
        <div className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
          Görüntülemek için yukarıdan bir şirket seçin.
        </div>
      ) : loading && !hasLoadedOnce.current ? (
        <div className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)] flex items-center justify-center gap-2">
          <HiOutlineArrowPath className="animate-spin text-[14px]" /> Yükleniyor...
        </div>
      ) : total === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
          Bu şirkete ait cihaz bulunamadı.
        </div>
      ) : (
        <>
          {/* ── Sayaç kutuları — tıklayınca diyagram o duruma süzülür ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
            <StatCard label="Toplam İstasyon" value={total} sub="Anlık durum özeti"
              active={!statFilter} onClick={() => setStatFilter(null)} />
            {STAT_CARDS.map((c) => {
              const n = countOf(c.states);
              return (
                <StatCard key={c.key} label={c.label} sub={c.sub} hex={c.hex} value={n} pct={pctOf(n)}
                  active={statFilter === c.key} onClick={() => setStatFilter(statFilter === c.key ? null : c.key)} />
              );
            })}
          </div>

          <div className="relative mb-4">
            <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[16px]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="İstasyon, lokasyon, şehir/ilçe veya kod ara..."
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         pl-10 pr-3 py-2.5 rounded-xl text-[14px] outline-none focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]" />
          </div>

          {/* ── Bağlantı Diyagramı ── */}
          <div ref={diagramRef} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-auto">
            <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-3 border-b border-[var(--border-subtle)]">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">Bağlantı Diyagramı</span>
              <div className="flex items-center gap-2">
                {anyOpen && !filtering && (
                  <button type="button" onClick={() => { setOpenCities(new Set()); setOpenDistricts(new Set()); }}
                    className={`${btn} border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-soft)]`}>
                    <HiOutlineArrowsPointingIn /> Hepsini Daralt
                  </button>
                )}
                <button type="button" onClick={() => setShowConsole((v) => !v)}
                  title="Canlı OCPP mesajlarını göster / gizle"
                  className={`${btn} ${showConsole
                    ? "bg-amber-400 border-amber-400 text-slate-900"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}>
                  <HiOutlineServerStack /> Cihaz Mesajları
                </button>
                <button type="button" onClick={toggleFullscreen} title="Tam ekran"
                  className="p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                  <HiOutlineArrowsPointingOut />
                </button>
              </div>
            </div>

            <div className="p-4">
              {hierarchy.length === 0 ? (
                <p className="text-center text-[13px] text-[var(--text-muted)] py-8">Aramaya / filtreye uyan istasyon yok.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {hierarchy.map((c) => (
                    <CityCard key={c.city} {...c} open={isCityOpen(c.city)} onToggle={() => toggleCity(c.city)}
                      openDistricts={districtSetFor} toggleDistrict={toggleIn(setOpenDistricts)} tileProps={tileProps} />
                  ))}
                </div>
              )}
            </div>

            {/* Sayfa açıkken sunucu her cihaza bir kez 3 28 3 gönderip dinler; sayfadan çıkınca 3 28 0.
                Düğme yalnızca görünümü açıp kapatır, dinleme sürer. */}
            {(
              <div className="px-4 pb-4">
                <OcppLiveConsole token={token} company={isSuperadmin ? selectedCompany : undefined} collapsed={!showConsole}
                  onPickDevice={(l) => l.deviceId != null && setHistoryDevice({
                    deviceId: l.deviceId, name: [l.location, l.deviceCode].filter(Boolean).join(" ") || "Cihaz",
                  })}
                  emptyText="Canlı OCPP mesajı bekleniyor… Cihazlara bağlanılıyor; her cihaza bir kez 3 28 3 gönderilir." />
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Bağlantı Renkleri</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {LEGEND.map((l) => (
                <span key={l.label} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <span className="w-7 h-4 rounded-sm border border-black/15" style={{ background: l.hex }} />{l.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
      <OcppDeviceModal token={token} device={historyDevice} onClose={() => setHistoryDevice(null)} />
    </div>
    </RefreshContext.Provider>
    </OpenHistoryContext.Provider>
  );
}
