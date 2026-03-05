import Navigation from "../components/Navigation.jsx";
import Panel from "../components/Panel.jsx";
import InfoRow from "../components/InfoRow.jsx";
import MetricCard from "../components/MetricCard.jsx";
import ActionButton from "../components/ActionButton.jsx";
import EditableRow from "../components/EditableRow.jsx";
import { useState, useEffect, useCallback } from "react";

import {
  HiOutlineGlobeAlt, HiOutlineLink, HiOutlineQrCode,
  HiOutlineBolt, HiOutlineWifi, HiOutlineLockClosed,
  HiOutlinePhone, HiOutlinePhoto, HiOutlineTag,
  HiOutlineCog6Tooth, HiOutlineArrowPath, HiOutlineStop,
  HiOutlineCpuChip, HiOutlineClock, HiOutlineExclamationTriangle,
  HiOutlineArrowUpTray, HiOutlineKey, HiOutlineIdentification,
  HiOutlineAdjustmentsHorizontal, HiOutlineCommandLine,
  HiOutlinePencilSquare
} from "react-icons/hi2";
import { TbPlugConnected, TbBrandApple, TbBrandGooglePlay, TbGauge, TbColorSwatch, TbTargetArrow, TbActivity, TbAlertCircle } from "react-icons/tb";
import { BsLightningCharge, BsBattery, BsUsbSymbol, BsShieldLock } from "react-icons/bs";
import { MdOutlineRestartAlt, MdSignalCellularAlt } from "react-icons/md";

/* ── Parametre Tanımları ──
   readOnly: sadece read butonu (InfoRow)
   editable: edit modunda read + save (EditableRow)
*/

// Read-only parametreler (OCPP & WiFi — sadece okunur)
const OCPP_WIFI = [
  { id: 0,  icon: <HiOutlineIdentification />, label: "ESP ID" },
  { id: 1,  icon: <HiOutlineGlobeAlt />,       label: "OCPP URL" },
  { id: 2,  icon: <HiOutlineLink />,           label: "OCPP ID" },
  { id: 3,  icon: <HiOutlineQrCode />,         label: "QR Kod" },
  { id: 4,  icon: <HiOutlineBolt />,           label: "Maks. Güç" },
  { id: 5,  icon: <HiOutlineWifi />,           label: "WiFi SSID" },
  { id: 6,  icon: <HiOutlineLockClosed />,     label: "WiFi Şifre" },
];

// Editable parametreler (UI ayarları — set + read)
const UI_PARAMS = [
  { id: 7,  icon: <TbPlugConnected />,         label: "Bağlantı Türü",
    type: "dropdown", options: [
      { value: "0", label: "CommSupported" },
      { value: "1", label: "GSM" },
      { value: "2", label: "WiFi" },
      { value: "3", label: "ETH" },
    ]},
  { id: 9,  icon: <HiOutlinePhone />,          label: "Şirket Tel", type: "phone" },
  { id: 10, icon: <HiOutlineGlobeAlt />,       label: "Site" },
  { id: 11, icon: <TbBrandApple />,            label: "Appstore" },
  { id: 12, icon: <TbBrandGooglePlay />,       label: "Play Store" },
  { id: 13, icon: <HiOutlinePhoto />,          label: "Logo / Yazı",
    type: "dropdown", options: [
      { value: "1", label: "Logo" },
      { value: "0", label: "Yazı" },
    ]},
  { id: 14, icon: <HiOutlineTag />,            label: "Şirket Adı", dependsOn: 13, dependsValue: "0" },
  { id: 35, icon: <TbColorSwatch />,           label: "Gradient/Renk",
    type: "dropdown", options: [
      { value: "1", label: "Gradient" },
      { value: "0", label: "Renk" },
    ]},
  { id: 36, icon: <TbTargetArrow />,           label: "Renk Seçimi",
    type: "color", dependsOn: 35, dependsValue: "0",
    depMessage: "Renk seçimi yapabilmek için lütfen Gradient seçmeyin" },
];

const MSP_CONFIG = [
  { id: 15, icon: <MdOutlineRestartAlt />,     label: "Cihaz Reset", color: "red" },
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

/* ── Helpers ── */
function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "——";
  const v = String(raw);
  if (id === 7) return ({ "0": "CommSupported", "1": "GSM", "2": "WiFi", "3": "ETH" })[v] || v;
  if (id === 13) return v === "0" ? "Yazı" : v === "1" ? "Logo" : v;
  if (id === 35) return v === "0" ? "Renk" : v === "1" ? "Gradient" : v;
  if (id === 27) return v === "0" ? "Hata Yok" : `Hata: ${v}`;
  if (id === 25) return ({ "0": "Beklemede", "1": "Şarj Oluyor", "2": "Tamamlandı" })[v] || v;
  return v;
}
function csColor(raw) {
  const v = String(raw);
  return v === "0" ? "yellow" : v === "1" ? "green" : v === "2" ? "blue" : undefined;
}

/* ── Main ── */
export default function Home({ onNavigate }) {
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
    f(); const iv = setInterval(f, 5 * 60 * 1000); // 5 dakikada bir
    return () => clearInterval(iv);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) { setReadValues({}); setSetOkMap({}); return; }
    const f = async () => {
      try {
        const r = await fetch("/api/responses");
        const j = await r.json();
        const ok = {}, rv = {};
        
        const msgs = j.message_response || [];
        msgs.forEach((entry) => {
          if (!entry) return;
          const cmd = Number(entry.cmd);
          const msg = Number(entry.msg);
          const data = entry.data;
          
          // SET OK kontrolü (cmd=1, data="SET OK")
          if (data === "SET OK") {
            ok[msg] = true;
          }
          // READ cevabı (cmd=2)
          if (cmd === 2 && data !== undefined && data !== null) {
            rv[msg] = data;
          }
        });

        if (Object.keys(rv).length > 0) {
          console.log("[POLL] READ:", rv);
        }
        if (Object.keys(ok).length > 0) {
          console.log("[POLL] SET OK:", ok);
        }

        setSetOkMap((prev) => ({ ...prev, ...ok }));
        setReadValues((prev) => ({ ...prev, ...rv }));
      } catch (e) {
        console.error("[POLL] Hata:", e);
      }
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

      // SET yapıldıysa → gönderilen değeri hemen UI'da göster
      if (type === "set" && value !== undefined && value !== null) {
        setReadValues((prev) => ({ ...prev, [variable]: String(value) }));
      }

      setMessage(type === "set" ? "Değer gönderildi…" : "Okunuyor…");
      setTimeout(() => setMessage(""), 3000);
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

  const handleDisconnect = async () => {
    try {
      const data = { newTarget: mac };
      await fetch("/api/disconnect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {}
    setIsConnected(false);
    setEspStatus("unknown");
    setReadValues({});
    setSetOkMap({});
    setFailedReads({});
    setMessage("Bağlantı koparıldı.");
    setTimeout(() => setMessage(""), 3000);
  };

  const badge = (() => {
    if (!isConnected) return { t: "Bağlantı Yok", c: "bg-slate-800/80 border-slate-600/50 text-slate-500", d: "bg-slate-600" };
    if (espStatus === "active") return { t: "Çevrimiçi", c: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", d: "bg-emerald-400 animate-pulse" };
    if (espStatus === "unknown") return { t: "Bekleniyor…", c: "bg-amber-500/10 border-amber-500/30 text-amber-400", d: "bg-amber-400 animate-pulse" };
    return { t: "Çevrimdışı", c: "bg-red-500/10 border-red-500/30 text-red-400", d: "bg-red-400" };
  })();

  const V = (id) => mapValue(id, readValues[id]);

  /* ── Toplu Read — sırayla oku, doğrula, başarısızsa işaretle ── */
  const [batchReadingId, setBatchReadingId] = useState(null);
  const [batchProgress, setBatchProgress] = useState("");
  const [failedReads, setFailedReads] = useState({});

  const batchRead = async (params, panelId) => {
    if (!isActive || batchReadingId) return;
    setBatchReadingId(panelId);
    const failed = {};

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      setBatchProgress(`${p.label} okunuyor… (${i + 1}/${params.length})`);

      await sendCommand("read", p.id);
      await new Promise((r) => setTimeout(r, 2500));

      // Değer geldi mi kontrol et
      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await fetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find(
            (m) => Number(m.cmd) === 2 && Number(m.msg) === p.id
          );
          if (found && found.data !== undefined && found.data !== null) {
            setReadValues((prev) => ({ ...prev, [p.id]: found.data }));
            success = true;
            break;
          }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 2000));
      }

      failed[p.id] = !success;
    }

    setFailedReads((prev) => ({ ...prev, ...failed }));

    const failCount = Object.values(failed).filter(Boolean).length;
    setBatchProgress("");
    setBatchReadingId(null);

    if (failCount > 0) {
      setMessage(`${params.length - failCount} değer okundu, ${failCount} değer okunamadı ⚠️`);
    } else {
      setMessage("Tüm değerler okundu ✓");
    }
    setTimeout(() => setMessage(""), 4000);
  };

  /* ── Toplu Set — tüm inputları aç, sırayla kaydet ── */
  const [bulkEditingId, setBulkEditingId] = useState(null); // "ocpp" | "ui" | null
  const [bulkDrafts, setBulkDrafts] = useState({});         // { paramId: "value" }
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [failedSets, setFailedSets] = useState({});

  const startBulkEdit = (params, panelId) => {
    if (!isActive || bulkSaving) return;
    // Mevcut değerlerle doldur
    const drafts = {};
    params.forEach((p) => {
      const v = readValues[p.id];
      drafts[p.id] = (v !== undefined && v !== null && v !== "——") ? String(v) : "";
    });
    setBulkDrafts(drafts);
    setBulkEditingId(panelId);
    setFailedSets({});
  };

  const cancelBulkEdit = () => {
    setBulkEditingId(null);
    setBulkDrafts({});
  };

  const updateBulkDraft = (id, value) => {
    setBulkDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const batchSet = async (params, panelId) => {
    if (!isActive || bulkSaving) return;
    setBulkSaving(true);
    const failed = {};

    // Sadece değeri değişen parametreleri gönder
    const toSend = params.filter((p) => {
      const draft = bulkDrafts[p.id] ?? "";
      return draft !== "" ; // boş bırakılanları atla
    });

    for (let i = 0; i < toSend.length; i++) {
      const p = toSend[i];
      const val = bulkDrafts[p.id];
      setBulkProgress(`${p.label} kaydediliyor… (${i + 1}/${toSend.length})`);

      // SET komutu gönder
      const ok = await sendCommand("set", p.id, val);
      await new Promise((r) => setTimeout(r, 2500));

      // SET OK geldi mi kontrol et
      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await fetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find(
            (m) => Number(m.msg) === p.id && m.data === "SET OK"
          );
          if (found) {
            success = true;
            break;
          }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 2000));
      }

      failed[p.id] = !success;
    }

    setFailedSets((prev) => ({ ...prev, ...failed }));

    const failCount = Object.values(failed).filter(Boolean).length;
    setBulkProgress("");
    setBulkSaving(false);
    setBulkEditingId(null);
    setBulkDrafts({});

    if (failCount > 0) {
      setMessage(`${toSend.length - failCount} değer kaydedildi, ${failCount} değer kaydedilemedi ⚠️`);
    } else {
      setMessage(`${toSend.length} değer başarıyla kaydedildi ✓`);
    }
    setTimeout(() => setMessage(""), 4000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#070e1a] text-slate-100">
      <Navigation activePage="dashboard" onNavigate={onNavigate} />

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
            <div className="flex gap-2 items-center">
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
              {isConnected && (
                <button onClick={handleDisconnect}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition cursor-pointer
                             bg-red-600/80 hover:bg-red-500 text-white">
                  Kopar
                </button>
              )}
            </div>
          </div>

          {message && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#0c1829] border border-slate-700/30 text-[12px] text-slate-400">
              {message}
            </div>
          )}

          {/* Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* OCPP & WiFi — read-only, her satırda oku butonu */}
            <Panel icon={<HiOutlineGlobeAlt />} title="OCPP & WiFi Ayarları">
              {OCPP_WIFI.map((p, i) => (
                <InfoRow key={p.id} icon={p.icon} label={p.label}
                  value={V(p.id)} valueColor={p.id === 5 ? "green" : undefined}
                  disabled={!isActive}
                  failed={failedReads[p.id]}
                  onRead={() => { setFailedReads((prev) => ({ ...prev, [p.id]: false })); sendCommand("read", p.id); }}
                  last={i === OCPP_WIFI.length - 1} />
              ))}

              {/* Toplu Read butonu */}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                {batchReadingId === "ocpp" && batchProgress ? (
                  <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">
                    {batchProgress}
                  </span>
                ) : <span />}
                <button
                  onClick={() => batchRead(OCPP_WIFI, "ocpp")}
                  disabled={!isActive || !!batchReadingId}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                    ${(!isActive || !!batchReadingId)
                      ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                      : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                    }`}
                >
                  <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "ocpp" ? "animate-spin" : ""}`} />
                  {batchReadingId === "ocpp" ? "Okunuyor…" : "Tümünü Oku"}
                </button>
              </div>
            </Panel>

            {/* UI — editable, edit modunda oku + kaydet */}
            <Panel icon={<TbPlugConnected />} title="Bağlantı & UI Ayarları">
              {UI_PARAMS.map((p, i) => {
                // Bağımlılık: id 14 (Şirket Adı) sadece id 13 = "0" (Yazı) ise aktif
                const depDisabled = p.dependsOn !== undefined
                  ? String(readValues[p.dependsOn] ?? "") !== p.dependsValue
                  : false;

                return (
                  <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                    value={V(p.id)} setOk={setOkMap[p.id]}
                    disabled={!isActive || depDisabled}
                    depDisabled={depDisabled}
                    depMessage={p.depMessage}
                    failed={failedReads[p.id]}
                    setFailed={failedSets[p.id]}
                    inputType={p.type}
                    options={p.options}
                    bulkEditing={bulkEditingId === "ui" && !depDisabled}
                    bulkDraft={bulkDrafts[p.id] ?? ""}
                    onBulkDraftChange={updateBulkDraft}
                    onSet={(id, val) => sendCommand("set", id, val)}
                    onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                    last={i === UI_PARAMS.length - 1} />
                );
              })}

              {/* Toplu Set / Read butonları */}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                {/* Progress */}
                {(batchReadingId === "ui" && batchProgress) ? (
                  <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{batchProgress}</span>
                ) : (bulkSaving && bulkProgress) ? (
                  <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{bulkProgress}</span>
                ) : <span />}

                <div className="flex items-center gap-2">
                  {/* Toplu Set butonu */}
                  {bulkEditingId === "ui" ? (
                    <>
                      <button
                        onClick={cancelBulkEdit}
                        className="text-[10px] font-semibold px-2.5 py-[4px] rounded-md
                                   bg-slate-800/50 text-slate-500 border border-slate-600/30
                                   hover:text-slate-300 transition cursor-pointer">
                        İptal
                      </button>
                      <button
                        onClick={() => batchSet(UI_PARAMS, "ui")}
                        disabled={!isActive || bulkSaving}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                          ${(!isActive || bulkSaving)
                            ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                            : "bg-emerald-600/80 text-white border-emerald-500/50 hover:bg-emerald-600 cursor-pointer"
                          }`}
                      >
                        <HiOutlinePencilSquare className={`text-[12px] ${bulkSaving ? "animate-spin" : ""}`} />
                        {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startBulkEdit(UI_PARAMS, "ui")}
                      disabled={!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                        ${(!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving)
                          ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                          : "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30 cursor-pointer"
                        }`}
                    >
                      <HiOutlinePencilSquare className="text-[12px]" />
                      Toplu Edit
                    </button>
                  )}

                  {/* Toplu Read butonu */}
                  <button
                    onClick={() => batchRead(UI_PARAMS, "ui")}
                    disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                      ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
                        ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                        : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                      }`}
                  >
                    <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "ui" ? "animate-spin" : ""}`} />
                    {batchReadingId === "ui" ? "Okunuyor…" : "Tümünü Oku"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* MSP */}
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

            {/* ESP Kontrol */}
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

        </div>
      </main>
    </div>
  );
}