import Navigation from "../components/Navigation.jsx";
import Panel from "../components/Panel.jsx";
import InfoRow from "../components/InfoRow.jsx";
import MetricCard from "../components/MetricCard.jsx";
import ActionButton from "../components/ActionButton.jsx";
import EditableRow from "../components/EditableRow.jsx";
import { useState, useEffect, useCallback } from "react";

// react-icons
import {
  HiOutlineGlobeAlt, HiOutlineLink, HiOutlineQrCode,
  HiOutlineBolt, HiOutlineWifi, HiOutlineLockClosed,
  HiOutlineSignal, HiOutlinePhone, HiOutlineBuildingStorefront,
  HiOutlinePaintBrush, HiOutlinePhoto, HiOutlineTag,
  HiOutlineCog6Tooth, HiOutlineArrowPath, HiOutlineStop,
  HiOutlineCpuChip, HiOutlineClock, HiOutlineExclamationTriangle,
  HiOutlineArrowUpTray, HiOutlineKey, HiOutlineIdentification,
  HiOutlineAdjustmentsHorizontal, HiOutlineCommandLine
} from "react-icons/hi2";
import { TbPlugConnected, TbBrandApple, TbBrandGooglePlay, TbGauge, TbColorSwatch, TbTargetArrow, TbActivity, TbAlertCircle } from "react-icons/tb";
import { BsLightningCharge, BsBattery, BsUsbSymbol, BsShieldLock } from "react-icons/bs";
import { MdOutlineRestartAlt, MdSignalCellularAlt } from "react-icons/md";

/* ── Parametre Tanımları ── */
const OCPP_WIFI = [
  { id: 0,  icon: <HiOutlineIdentification />, label: "ESP ID" },
  { id: 1,  icon: <HiOutlineGlobeAlt />,       label: "OCPP URL" },
  { id: 2,  icon: <HiOutlineLink />,           label: "OCPP ID" },
  { id: 3,  icon: <HiOutlineQrCode />,         label: "QR Kod" },
  { id: 4,  icon: <HiOutlineBolt />,           label: "Maks. Güç" },
  { id: 5,  icon: <HiOutlineWifi />,           label: "WiFi SSID" },
  { id: 6,  icon: <HiOutlineLockClosed />,     label: "WiFi Şifre" },
];

const UI_PARAMS = [
  { id: 7,  icon: <TbPlugConnected />,         label: "Bağlantı Türü" },
  { id: 9,  icon: <HiOutlinePhone />,          label: "Tel" },
  { id: 10, icon: <HiOutlineGlobeAlt />,       label: "Site" },
  { id: 11, icon: <TbBrandApple />,            label: "Appstore" },
  { id: 12, icon: <TbBrandGooglePlay />,       label: "Play Store" },
  { id: 13, icon: <HiOutlinePhoto />,          label: "Logo / Yazı" },
  { id: 14, icon: <HiOutlineTag />,            label: "Şirket Adı" },
  { id: 35, icon: <TbColorSwatch />,           label: "Gradient/Renk" },
  { id: 36, icon: <TbTargetArrow />,           label: "Renk Seçimi" },
];

const MSP_CONFIG = [
  { id: 15, icon: <MdOutlineRestartAlt />,     label: "Cihaz Reset", color: "red" },
  { id: 16, icon: <TbGauge />,                 label: "AC Ölçer",    color: "red" },
  { id: 19, icon: <HiOutlineCommandLine />,    label: "Test Modu",   color: "red" },
  { id: 18, icon: <HiOutlineCpuChip />,        label: "Model",       isInfo: true },
];

const ESP_CTRL = [
  { id: 17, icon: <HiOutlineAdjustmentsHorizontal />, label: "OCPP Modu",  color: "blue" },
  { id: 8,  icon: <BsShieldLock />,            label: "Kilitleme",   color: "red" },
  { id: 20, icon: <HiOutlineArrowPath />,      label: "ESP Reset",   color: "red" },
  { id: 21, icon: <HiOutlineStop />,           label: "Şarj Durdur", color: "red" },
];

const TELEMETRY = [
  { id: 22, icon: <HiOutlineClock />,          label: "Şarj Süresi",      unit: "dk" },
  { id: 23, icon: <BsLightningCharge />,       label: "Çıkış Gücü",       unit: "kW" },
  { id: 24, icon: <BsBattery />,               label: "Tüketilen Enerji",  unit: "kWh" },
  { id: 25, icon: <TbAlertCircle />,           label: "Durum" },
  { id: 34, icon: <MdSignalCellularAlt />,     label: "GSM Sinyal" },
  { id: 27, icon: <HiOutlineExclamationTriangle />, label: "Hata" },
  { id: 26, icon: <BsUsbSymbol />,             label: "UART" },
];

const OTA = [
  { id: 31, icon: <HiOutlineArrowUpTray />,    label: "OTA Update" },
  { id: 32, icon: <HiOutlineKey />,            label: "OTA Key" },
  { id: 33, icon: <HiOutlineTag />,            label: "OTA Versiyon" },
];

/* ── Helpers ── */
function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "——";
  const v = String(raw);
  if (id === 13) return v === "0" ? "Yazı" : v === "1" ? "Logo" : v;
  if (id === 27) return v === "0" ? "Hata Yok" : `Hata: ${v}`;
  if (id === 25) return ({ "0": "Beklemede", "1": "Şarj Oluyor", "2": "Tamamlandı" })[v] || v;
  return v;
}
function csColor(raw) {
  const v = String(raw);
  return v === "0" ? "yellow" : v === "1" ? "green" : v === "2" ? "blue" : undefined;
}

/* ── Main ── */
export default function Home() {
  const [espStatus, setEspStatus] = useState("unknown");
  const [isConnected, setIsConnected] = useState(false);
  const [mac, setMac] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [readValues, setReadValues] = useState({});
  const [setOkMap, setSetOkMap] = useState({});
  const isActive = isConnected && espStatus === "active";

  useEffect(() => {
    if (!isConnected) { setEspStatus("unknown"); return; }
    const f = async () => {
      try {
        const r = await fetch("/api/get-status");
        const d = await r.json();
        setEspStatus(d.espState);
        if (d.timedOut) { setIsConnected(false); setMessage("10dk inaktivite — bağlantı kesildi."); }
      } catch { setEspStatus("nonactive"); }
    };
    f(); const iv = setInterval(f, 3000);
    return () => clearInterval(iv);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    const f = () => fetch("/api/keepalive", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
    f(); const iv = setInterval(f, 20000);
    return () => clearInterval(iv);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) { setReadValues({}); setSetOkMap({}); return; }
    const f = async () => {
      try {
        const r = await fetch("/responses");
        const j = await r.json();
        const ok = {}, rv = {};
        (j.message_response || []).forEach((r) => {
          if (r?.data === "SET OK") ok[r.msg] = true;
          if (r?.cmd === 2) rv[r.msg] = r.data;
        });
        setSetOkMap(ok);
        setReadValues((p) => ({ ...p, ...rv }));
      } catch {}
    };
    f(); const iv = setInterval(f, 2000);
    return () => clearInterval(iv);
  }, [isConnected]);

  const sendCommand = useCallback(async (type, variable, value = "") => {
    if (!isActive) { setMessage("ESP aktif değil"); return false; }
    try {
      const r = await fetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, variable, value }),
      });
      const d = await r.json();
      if (!r.ok) { setMessage(d.message || "Hata"); return false; }
      setMessage(`✓ ${d.frame}`);
      return true;
    } catch { setMessage("Sunucuya ulaşılamadı"); return false; }
  }, [isActive]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setMessage(""); setLoading(true);
    try {
      const r = await fetch("/api/update-target", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTarget: mac }),
      });
      const d = await r.json();
      if (!r.ok) { setMessage(d.error || "Hata"); setIsConnected(false); }
      else { setMessage(""); setIsConnected(true); }
    } catch { setMessage("Sunucuya ulaşılamadı"); setIsConnected(false); }
    finally { setLoading(false); }
  };

  const badge = (() => {
    if (!isConnected) return { t: "Bağlantı Yok", c: "bg-slate-800/80 border-slate-600/50 text-slate-500", d: "bg-slate-600" };
    if (espStatus === "active") return { t: "Çevrimiçi", c: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", d: "bg-emerald-400 animate-pulse" };
    if (espStatus === "unknown") return { t: "Bekleniyor…", c: "bg-amber-500/10 border-amber-500/30 text-amber-400", d: "bg-amber-400 animate-pulse" };
    return { t: "Çevrimdışı", c: "bg-red-500/10 border-red-500/30 text-red-400", d: "bg-red-400" };
  })();

  const V = (id) => mapValue(id, readValues[id]);

  return (
    <div className="min-h-screen flex flex-col bg-[#070e1a] text-slate-100">
      <Navigation />

      <main className="flex-1 py-5 px-4">
        <div className="max-w-[1200px] mx-auto">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold border ${badge.c}`}>
                <span className={`w-[6px] h-[6px] rounded-full ${badge.d}`} />
                {badge.t}
              </span>
              {isConnected && mac && (
                <span className="text-[11px] text-slate-600 font-mono">{mac}</span>
              )}
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input value={mac} onChange={(e) => setMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF" required
                className="bg-[#0c1829] border border-slate-700/50 text-slate-200
                           px-3 py-1.5 rounded-lg text-[12px] font-mono outline-none
                           focus:border-sky-500/50 transition w-48" />
              <button disabled={loading}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition cursor-pointer
                  ${loading ? "bg-slate-700 text-slate-500" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
                {loading ? "…" : "Bağlan"}
              </button>
            </form>
          </div>

          {message && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#0c1829] border border-slate-700/30 text-[12px] text-slate-400">
              {message}
            </div>
          )}

          {/* Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            <Panel icon={<HiOutlineGlobeAlt />} title="OCPP & WiFi Ayarları">
              {OCPP_WIFI.map((p, i) => (
                <InfoRow key={p.id} icon={p.icon} label={p.label}
                  value={V(p.id)} valueColor={p.id === 5 ? "green" : undefined}
                  last={i === OCPP_WIFI.length - 1} />
              ))}
            </Panel>

            <Panel icon={<TbPlugConnected />} title="Bağlantı & UI Ayarları">
              {UI_PARAMS.map((p, i) => (
                <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                  value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                  onSet={(id, val) => sendCommand("set", id, val)}
                  last={i === UI_PARAMS.length - 1} />
              ))}
            </Panel>

            <Panel icon={<HiOutlineCog6Tooth />} title="MSP Konfigürasyon">
              <div className="grid grid-cols-2 gap-2 py-1">
                {MSP_CONFIG.map((p) =>
                  p.isInfo ? (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-[6px] rounded-lg bg-slate-800/30 border border-slate-700/30">
                      <span className="text-[13px] text-slate-500">{p.icon}</span>
                      <span className="text-[11px] text-slate-500">{p.label}:</span>
                      <span className="text-[11px] text-slate-200 font-semibold">{V(p.id)}</span>
                    </div>
                  ) : (
                    <ActionButton key={p.id} icon={p.icon} label={p.label}
                      badge={V(p.id)} color={p.color} disabled={!isActive} />
                  )
                )}
              </div>
            </Panel>

            <Panel icon={<HiOutlineCpuChip />} title="ESP Kontrol">
              <div className="grid grid-cols-2 gap-2 py-1">
                {ESP_CTRL.map((p) => (
                  <ActionButton key={p.id} icon={p.icon} label={p.label}
                    badge={V(p.id)} color={p.color} disabled={!isActive} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2 px-3 py-[6px] rounded-lg bg-slate-800/20 border border-slate-700/20">
                <TbActivity className="text-[13px] text-slate-500" />
                <span className="text-[11px] text-slate-500">Durum:</span>
                <span className={`text-[11px] font-bold ${
                  csColor(readValues[25]) === "green" ? "text-emerald-400" :
                  csColor(readValues[25]) === "yellow" ? "text-amber-400" :
                  csColor(readValues[25]) === "blue" ? "text-sky-400" : "text-slate-400"
                }`}>{V(25)}</span>
              </div>
            </Panel>
          </div>

          {/* Telemetry */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <TbActivity className="text-[13px] text-sky-400/60" />
              <h3 className="text-[11px] font-bold text-slate-400 tracking-widest uppercase">Canlı Telemetri</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {TELEMETRY.map((p) => (
                <MetricCard key={p.id} icon={p.icon} label={p.label}
                  value={V(p.id)} unit={p.unit || ""}
                  valueColor={p.id === 25 ? csColor(readValues[25]) : undefined} />
              ))}
            </div>
          </div>

          {/* OTA */}
          <div className="mt-4">
            <Panel icon={<HiOutlineArrowUpTray />} title="OTA Konfigürasyon">
              {OTA.map((p, i) => (
                <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                  value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                  onSet={(id, val) => sendCommand("set", id, val)}
                  last={i === OTA.length - 1} />
              ))}
            </Panel>
          </div>

        </div>
      </main>
    </div>
  );
}