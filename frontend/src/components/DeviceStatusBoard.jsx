import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import {
  HiOutlineViewColumns, HiOutlineMapPin, HiOutlineArrowPath,
  HiOutlineBolt, HiOutlineBoltSlash, HiOutlinePauseCircle, HiOutlineFlag, HiOutlineExclamationTriangle,
  HiOutlineMoon, HiOutlineSignalSlash, HiOutlineQuestionMarkCircle,
} from "react-icons/hi2";
import { TbPlugConnected } from "react-icons/tb";
import OcppLiveConsole from "./OcppLiveConsole.jsx";
import OcppDeviceModal from "./OcppDeviceModal.jsx";

// Kutucuk popover'ındaki "Mesaj Geçmişi" düğmesi cihaz penceresini açar —
// tile'lar birkaç bileşen derinde olduğu için prop zinciri yerine context.
const OpenHistoryContext = createContext(null);

/* ── Toplu Okuma ──
   Şirket bazlı, sürekli tazelenen canlı cihaz durumu panosu. "Toplu
   Güncelleme/Parametre" gibi bir İŞ değil — sadece görüntüleme. Backend
   (device-status-poll.js) bu sayfa her GET attığında arka plandaki izleme
   döngüsünü canlı tutuyor; sayfadan çıkılıp bir süre GET atılmazsa döngü
   kendiliğinden duruyor. Biz burada sadece periyodik olarak soruyoruz. */

const POLL_MS = 4000;

const STATE_META = {
  charging: {
    dot: "bg-emerald-500", text: "text-emerald-500", label: "Şarj Oluyor", icon: HiOutlineBolt,
    chip: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
    bar: "bg-emerald-500",
  },
  waiting_rfid: {
    dot: "bg-amber-500", text: "text-amber-500", label: "Soket Takılı, Şarj Yok", icon: HiOutlinePauseCircle,
    chip: "bg-amber-500/10 text-amber-500 border-amber-500/25",
    bar: "bg-amber-500",
  },
  charge_ended: {
    dot: "bg-indigo-500", text: "text-indigo-500", label: "Şarj Bitti, Soket Takılı", icon: HiOutlineFlag,
    chip: "bg-indigo-500/10 text-indigo-500 border-indigo-500/25",
    bar: "bg-indigo-500",
  },
  not_plugged: {
    dot: "bg-sky-500", text: "text-sky-500", label: "Soket Takılı Değil", icon: HiOutlineBoltSlash,
    chip: "bg-sky-500/10 text-sky-500 border-sky-500/25",
    bar: "bg-sky-500",
  },
  idle: {
    dot: "bg-sky-500", text: "text-sky-500", label: "Boşta", icon: HiOutlineMoon,
    chip: "bg-sky-500/10 text-sky-500 border-sky-500/25",
    bar: "bg-sky-500",
  },
  error: {
    dot: "bg-red-500", text: "text-red-500", label: "Hata", icon: HiOutlineExclamationTriangle,
    chip: "bg-red-500/10 text-red-500 border-red-500/25",
    bar: "bg-red-500",
  },
  offline: {
    dot: "bg-rose-500", text: "text-rose-500", label: "Çevrimdışı", icon: HiOutlineSignalSlash,
    chip: "bg-rose-500/10 text-rose-500 border-rose-500/25",
    bar: "bg-rose-500",
  },
  unknown: {
    dot: "bg-[var(--text-muted)]", text: "text-[var(--text-muted)]", label: "Bilinmiyor", icon: HiOutlineQuestionMarkCircle,
    chip: "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)]",
    bar: "bg-[var(--text-muted)]",
  },
  checking: {
    dot: "bg-[var(--text-muted)]", text: "text-[var(--text-muted)]", label: "Kontrol ediliyor", icon: HiOutlineArrowPath,
    chip: "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)]",
    bar: "bg-[var(--text-muted)]",
  },
};
const STATE_ORDER = ["charging", "waiting_rfid", "charge_ended", "not_plugged", "idle", "error", "offline", "unknown", "checking"];
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

function SegmentedBar({ devices, className = "" }) {
  const total = devices.length || 1;
  const counts = {};
  for (const d of devices) counts[d.state] = (counts[d.state] || 0) + 1;
  return (
    <div className={`h-1.5 rounded-full overflow-hidden flex bg-[var(--border-subtle)] ${className}`}>
      {STATE_ORDER.filter((s) => counts[s]).map((s) => (
        <div key={s} className={metaFor(s).bar} style={{ width: `${(counts[s] / total) * 100}%` }} />
      ))}
    </div>
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
        className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0
                    transition hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${meta.chip}
                    ${isOpen ? "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--bg-page,transparent)]" : ""}`}
      >
        <Icon className={`text-[19px] ${d.state === "checking" ? "animate-spin" : ""}`} />
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
            <span className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${meta.chip}`}>
              <Icon className={`text-[14px] ${d.state === "checking" ? "animate-spin" : ""}`} />
            </span>
            <span className={`text-[13px] font-bold truncate flex-1 ${meta.text}`}>
              {(d.device_code || "Cihaz").trim()}
            </span>
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
    <div className="flex flex-wrap gap-2">
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

function LocationCard({ site, devices, blocks, openKey, setOpenKey, onConnectDevice, connecting, connectError }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated,transparent)] p-4 flex flex-col gap-3.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[14px] shrink-0">
          <HiOutlineMapPin />
        </span>
        <span className="text-[13.5px] font-bold text-[var(--text-primary)] truncate" title={site}>{site}</span>
      </div>

      {blocks ? (
        <div className="flex flex-col gap-3">
          {blocks.map((b) => (
            <div key={b.label}>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{b.label}</div>
              <DeviceTileRow devices={b.devices} openKey={openKey} setOpenKey={setOpenKey}
                onConnectDevice={onConnectDevice} connecting={connecting} connectError={connectError} />
            </div>
          ))}
        </div>
      ) : (
        <DeviceTileRow devices={devices} openKey={openKey} setOpenKey={setOpenKey}
          onConnectDevice={onConnectDevice} connecting={connecting} connectError={connectError} />
      )}

      <div className="flex items-center gap-2.5 pt-3 border-t border-[var(--border-subtle)]">
        <SegmentedBar devices={devices} className="h-1 flex-1" />
        <span className="shrink-0 text-[11px] font-bold text-[var(--text-muted)]">{devices.length} cihaz</span>
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
        if (!cancelled) setDevices(d.devices || []);
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
  const grouped = useMemo(() => buildSiteGroups(devices, activeCompany), [devices, activeCompany]);

  const counts = useMemo(() => {
    const c = {};
    for (const d of devices) c[d.state] = (c[d.state] || 0) + 1;
    return c;
  }, [devices]);
  const total = devices.length;

  return (
    <OpenHistoryContext.Provider value={openHistory}>
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
          <div className="mb-6 px-4 py-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              {STATE_ORDER.filter((s) => counts[s]).map((s) => (
                <span key={s} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold ${metaFor(s).chip}`}>
                  <span className="tabular-nums">{counts[s]}</span> {metaFor(s).label}
                </span>
              ))}
              <span className="text-[12px] text-[var(--text-muted)] ml-auto font-semibold">Toplam {total} cihaz</span>
            </div>
            <SegmentedBar devices={devices} className="h-2" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {grouped.map((g) => (
              <LocationCard key={g.site} site={g.site} devices={g.devices} blocks={g.blocks} openKey={openKey} setOpenKey={setOpenKey}
                onConnectDevice={handleConnectDevice} connecting={connecting} connectError={connectError} />
            ))}
          </div>

          {/* Konsol açık kaldıkça Toplu Okuma her cihazda 3 28 3 ile OCPP logu toplar, çıkarken 3 28 0 gönderir */}
          <div className="mt-6">
            <OcppLiveConsole token={token} company={isSuperadmin ? selectedCompany : undefined}
              onPickDevice={(l) => l.deviceId != null && setHistoryDevice({
                deviceId: l.deviceId, name: [l.location, l.deviceCode].filter(Boolean).join(" ") || "Cihaz",
              })}
              emptyText="Canlı OCPP mesajı bekleniyor… Toplu Okuma her cihaza uğradığında kısa süre log toplar." />
          </div>
        </>
      )}
      <OcppDeviceModal token={token} device={historyDevice} onClose={() => setHistoryDevice(null)} />
    </div>
    </OpenHistoryContext.Provider>
  );
}
