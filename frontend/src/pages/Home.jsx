import Navigation from "../components/Navigation.jsx";
import Panel from "../components/Panel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import ActionButton from "../components/ActionButton.jsx";
import EditableRow from "../components/EditableRow.jsx";
import InfoRow from "../components/InfoRow.jsx";
import { useState, useEffect, useCallback } from "react";

import {
  HiOutlineGlobeAlt, HiOutlineLink, HiOutlineQrCode,
  HiOutlineBolt, HiOutlineWifi, HiOutlineLockClosed,
  HiOutlinePhone, HiOutlinePhoto, HiOutlineTag,
  HiOutlineCog6Tooth, HiOutlineArrowPath, HiOutlineStop,
  HiOutlineCpuChip, HiOutlineClock, HiOutlineExclamationTriangle,
  HiOutlineArrowUpTray, HiOutlineKey,
  HiOutlineAdjustmentsHorizontal, HiOutlineCommandLine,
  HiOutlinePencilSquare, HiOutlineIdentification,
  HiOutlineWrenchScrewdriver, HiOutlineServerStack,
  HiOutlineFingerPrint, HiOutlineCircleStack
} from "react-icons/hi2";
import { TbPlugConnected, TbBrandApple, TbBrandGooglePlay, TbGauge, TbColorSwatch, TbTargetArrow, TbActivity, TbAlertCircle } from "react-icons/tb";
import { BsLightningCharge, BsBattery, BsUsbSymbol, BsShieldLock } from "react-icons/bs";
import { MdOutlineRestartAlt, MdSignalCellularAlt } from "react-icons/md";

/* ── Parametre Tanımları ──
   readOnly: sadece read butonu (InfoRow)
   editable: edit modunda read + save (EditableRow)
*/

// OCPP & WiFi parametreleri (set + read)
const OCPP_WIFI = [
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

const MSP_CONFIG_BASE = [
  { id: 15, icon: <MdOutlineRestartAlt />,     label: "Cihaz Reset", isToggle: true, color: "red" },
];

const MSP_CONFIG_ADMIN = [
  { id: 16, icon: <TbGauge />,                 label: "AC Ölçer",    color: "red" },
  { id: 19, icon: <HiOutlineCommandLine />,    label: "Mod",
    isDropdown: true, options: [
      { value: "0", label: "Ürün Modu" },
      { value: "1", label: "Test Modu" },
    ]},
  { id: 18, icon: <HiOutlineCpuChip />,        label: "Model",
    isDropdown: true, options: [
      { value: "0", label: "Kablosuz" },
      { value: "1", label: "Kablolu" },
    ]},
];

const OTA = [
  { id: 31, icon: <HiOutlineArrowUpTray />,    label: "OTA Update" },
  { id: 32, icon: <HiOutlineKey />,            label: "OTA Key" },
  { id: 33, icon: <HiOutlineTag />,            label: "OTA Versiyon" },
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

// OCPP Credentials (set + read panelde, sadece read dashboardda)
const OCPP_CREDS = [
  { id: 39, icon: <HiOutlineIdentification />,     label: "CP Vendor" },
  { id: 40, icon: <HiOutlineServerStack />,         label: "CP Model" },
  { id: 41, icon: <HiOutlineFingerPrint />,         label: "CP Seri No" },
  { id: 42, icon: <HiOutlineCircleStack />,         label: "Meter Seri No" },
  { id: 43, icon: <HiOutlineWrenchScrewdriver />,   label: "Meter Tipi" },
  { id: 44, icon: <HiOutlineTag />,                 label: "Box Seri No" },
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
  if (id === 19) return v === "0" ? "Ürün Modu" : v === "1" ? "Test Modu" : v;
  if (id === 18) return v === "0" ? "Kablosuz" : v === "1" ? "Kablolu" : v;
  if (id === 15) return v === "0" ? "Kapalı" : v === "1" ? "Aktif" : v;
  return v;
}
function csColor(raw) {
  const v = String(raw);
  return v === "0" ? "yellow" : v === "1" ? "green" : v === "2" ? "blue" : undefined;
}

/* ── Main ── */
export default function Home({ token, onNavigate, onLogout, isAdmin = false }) {
  // authFetch — token değişince bu fonksiyon da güncellenir
  const authFetch = useCallback((url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Authorization": `Bearer ${token}`,
      },
    });
  }, [token]);

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
        const r = await authFetch("/api/get-status");
        const d = await r.json();
        setEspStatus(d.espState);
        if (d.timedOut) { setIsConnected(false); setMessage("10dk inaktivite — bağlantı kesildi."); }
      } catch { setEspStatus("nonactive"); }
    };
    f(); const iv = setInterval(f, 3000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch]);

  useEffect(() => {
    if (!isConnected) return;
    const f = () => authFetch("/api/keepalive", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
    f(); const iv = setInterval(f, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch]);

  useEffect(() => {
    if (!isConnected) { setReadValues({}); setSetOkMap({}); return; }
    const f = async () => {
      try {
        const r = await authFetch("/api/responses");
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
  }, [isConnected, authFetch]);

  const sendCommand = useCallback(async (type, variable, value = "") => {
    if (!isActive) { setMessage("ESP aktif değil"); return false; }
    try {
      const r = await authFetch("/api/send-command", {
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
  }, [isActive, authFetch]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setMessage(""); setLoading(true);
    try {
      const r = await authFetch("/api/update-target", {
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
      await authFetch("/api/disconnect", {
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
          const resp = await authFetch("/api/responses");
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

    // --- İlk deneme ---
    for (let i = 0; i < toSend.length; i++) {
      const p = toSend[i];
      const val = bulkDrafts[p.id];
      setBulkProgress(`${p.label} kaydediliyor… (${i + 1}/${toSend.length})`);

      await sendCommand("set", p.id, val);
      await new Promise((r) => setTimeout(r, 2500));

      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find(
            (m) => Number(m.msg) === p.id && m.data === "SET OK"
          );
          if (found) {
            success = true;
            setSetOkMap((prev) => ({ ...prev, [p.id]: true }));
            break;
          }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 2000));
      }

      failed[p.id] = !success;
    }

    // --- Başarısız olanları tekrar dene ---
    const failedItems = toSend.filter((p) => failed[p.id]);

    if (failedItems.length > 0) {
      const failedNames = failedItems.map((p) => p.label).join(", ");
      setBulkProgress(`${failedNames} kaydedilemedi, tekrar deneniyor…`);
      setFailedSets((prev) => {
        const updated = { ...prev };
        failedItems.forEach((p) => { updated[p.id] = true; });
        return updated;
      });

      await new Promise((r) => setTimeout(r, 1500));

      for (let i = 0; i < failedItems.length; i++) {
        const p = failedItems[i];
        const val = bulkDrafts[p.id];
        setBulkProgress(`${p.label} tekrar kaydediliyor… (${i + 1}/${failedItems.length})`);

        await sendCommand("set", p.id, val);
        await new Promise((r) => setTimeout(r, 3000));

        let success = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const resp = await authFetch("/api/responses");
            const j = await resp.json();
            const msgs = j.message_response || [];
            const found = msgs.find(
              (m) => Number(m.msg) === p.id && m.data === "SET OK"
            );
            if (found) {
              success = true;
              setSetOkMap((prev) => ({ ...prev, [p.id]: true }));
              break;
            }
          } catch {}
          if (retry < 2) await new Promise((r) => setTimeout(r, 2000));
        }

        failed[p.id] = !success;
      }
    }

    setFailedSets((prev) => ({ ...prev, ...failed }));

    // Başarılı olan değerleri readValues'a yaz — kapanınca yeni değerler görünsün
    const successValues = {};
    toSend.forEach((p) => {
      if (!failed[p.id]) {
        successValues[p.id] = bulkDrafts[p.id];
      }
    });
    setReadValues((prev) => ({ ...prev, ...successValues }));

    const finalFailCount = Object.values(failed).filter(Boolean).length;
    const retried = failedItems.length > 0;
    setBulkProgress("");
    setBulkSaving(false);
    setBulkEditingId(null);
    setBulkDrafts({});

    if (finalFailCount > 0) {
      const stillFailedNames = toSend.filter((p) => failed[p.id]).map((p) => p.label).join(", ");
      setMessage(`${toSend.length - finalFailCount} değer kaydedildi, ${stillFailedNames} kaydedilemedi ⚠️`);
    } else if (retried) {
      setMessage(`${toSend.length} değer kaydedildi (${failedItems.length} tanesi tekrar denemede başarılı) ✓`);
    } else {
      setMessage(`${toSend.length} değer başarıyla kaydedildi ✓`);
    }
    setTimeout(() => setMessage(""), 5000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#070e1a] text-slate-100">
      <Navigation activePage={isAdmin ? "panel" : "dashboard"} onNavigate={onNavigate} onLogout={onLogout} />

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

            {/* OCPP & WiFi Ayarları (Panel component) */}
            <Panel icon={<HiOutlineGlobeAlt />} title="OCPP & WiFi Ayarları">
              {OCPP_WIFI.map((p, i) => (
                <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                  value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                  failed={failedReads[p.id]}
                  setFailed={failedSets[p.id]}
                  bulkEditing={bulkEditingId === "ocpp"}
                  bulkDraft={bulkDrafts[p.id] ?? ""}
                  onBulkDraftChange={updateBulkDraft}
                  onSet={(id, val) => sendCommand("set", id, val)}
                  onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                  last={i === OCPP_WIFI.length - 1} />
              ))}

              {/* Toplu Set / Read butonları */}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                {(batchReadingId === "ocpp" && batchProgress) ? (
                  <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{batchProgress}</span>
                ) : (bulkSaving && bulkProgress) ? (
                  <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{bulkProgress}</span>
                ) : <span />}

                <div className="flex items-center gap-2">
                  {bulkEditingId === "ocpp" ? (
                    <>
                      <button onClick={cancelBulkEdit}
                        className="text-[10px] font-semibold px-2.5 py-[4px] rounded-md
                                   bg-slate-800/50 text-slate-500 border border-slate-600/30
                                   hover:text-slate-300 transition cursor-pointer">
                        İptal
                      </button>
                      <button onClick={() => batchSet(OCPP_WIFI, "ocpp")}
                        disabled={!isActive || bulkSaving}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                          ${(!isActive || bulkSaving)
                            ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                            : "bg-emerald-600/80 text-white border-emerald-500/50 hover:bg-emerald-600 cursor-pointer"
                          }`}>
                        <HiOutlinePencilSquare className={`text-[12px] ${bulkSaving ? "animate-spin" : ""}`} />
                        {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => startBulkEdit(OCPP_WIFI, "ocpp")}
                      disabled={!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                        ${(!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving)
                          ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                          : "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30 cursor-pointer"
                        }`}>
                      <HiOutlinePencilSquare className="text-[12px]" />
                      Toplu Edit
                    </button>
                  )}

                  <button onClick={() => batchRead(OCPP_WIFI, "ocpp")}
                    disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                      ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
                        ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                        : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                      }`}>
                    <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "ocpp" ? "animate-spin" : ""}`} />
                    {batchReadingId === "ocpp" ? "Okunuyor…" : "Tümünü Oku"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* UI — editable, edit modunda oku + kaydet */}
            <Panel icon={<TbPlugConnected />} title="Bağlantı & UI Ayarları">
              {UI_PARAMS.map((p, i) => {
                // Bağımlılık kontrolü:
                // Toplu edit modundayken → bulkDrafts'taki değere bak
                // Normal modda → readValues'taki değere bak
                let depDisabled = false;
                if (p.dependsOn !== undefined) {
                  const parentVal = bulkEditingId === "ui"
                    ? (bulkDrafts[p.dependsOn] ?? String(readValues[p.dependsOn] ?? ""))
                    : String(readValues[p.dependsOn] ?? "");
                  depDisabled = parentVal !== p.dependsValue;
                }

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
                {[...MSP_CONFIG_BASE, ...(isAdmin ? MSP_CONFIG_ADMIN : [])].map((p) => {
                  const curVal = String(readValues[p.id] ?? "0");

                  /* ── Toggle buton (Cihaz Reset) ── */
                  if (p.isToggle) {
                    const isOn = curVal === "1";
                    return (
                      <button key={p.id}
                        disabled={!isActive}
                        onClick={() => {
                          const next = isOn ? "0" : "1";
                          sendCommand("set", p.id, next);
                          setReadValues((prev) => ({ ...prev, [p.id]: next }));
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-[7px] rounded-lg border transition-all duration-150
                          ${!isActive ? "opacity-50 cursor-not-allowed bg-slate-800/30 border-slate-700/30" :
                            "hover:bg-slate-800/60 cursor-pointer bg-slate-800/30 border-slate-700/30"}`}
                      >
                        <span className="text-[13px] text-slate-400 shrink-0">{p.icon}</span>
                        <span className="text-[11px] text-slate-400 font-medium flex-1 text-left">{p.label}</span>
                        {/* Toggle switch */}
                        <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${isOn ? "bg-red-500/60" : "bg-slate-600/40"}`}>
                          <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all duration-200
                            ${isOn ? "left-[16px]" : "left-[2px]"}`} />
                        </div>
                      </button>
                    );
                  }

                  /* ── Dropdown (Mode, Model) ── */
                  if (p.isDropdown) {
                    return (
                      <div key={p.id}
                        className="flex items-center gap-2 w-full px-3 py-[5px] rounded-lg bg-slate-800/30 border border-slate-700/30">
                        <span className="text-[13px] text-slate-400 shrink-0">{p.icon}</span>
                        <span className="text-[11px] text-slate-400 font-medium flex-1 text-left">{p.label}</span>
                        <select
                          value={curVal}
                          disabled={!isActive}
                          onChange={(e) => {
                            const val = e.target.value;
                            sendCommand("set", p.id, val);
                            setReadValues((prev) => ({ ...prev, [p.id]: val }));
                          }}
                          className={`text-[10px] font-bold px-2 py-[3px] rounded-md border outline-none transition
                            bg-slate-900/80 border-slate-600/40 text-slate-200
                            ${!isActive ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-slate-500/60"}`}
                        >
                          {p.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  /* ── Normal ActionButton ── */
                  return (
                    <ActionButton key={p.id} icon={p.icon} label={p.label}
                      badge={V(p.id)} color={p.color} disabled={!isActive} />
                  );
                })}
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
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <TbActivity className="text-[13px] text-sky-400/60" />
                <h3 className="text-[11px] font-bold text-slate-400 tracking-widest uppercase">Canlı Telemetri</h3>
                {batchReadingId === "tele" && batchProgress && (
                  <span className="text-[10px] text-sky-400/80 font-medium animate-pulse ml-2">{batchProgress}</span>
                )}
              </div>
              <button
                onClick={() => batchRead(TELEMETRY, "tele")}
                disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                  ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
                    ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                    : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                  }`}
              >
                <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "tele" ? "animate-spin" : ""}`} />
                {batchReadingId === "tele" ? "Okunuyor…" : "Tümünü Oku"}
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {TELEMETRY.map((p) => (
                <div key={p.id} className="bg-[#0c1829] border border-slate-700/40 rounded-xl px-4 py-3 flex flex-col">
                  <div className="flex items-center gap-1.5 mb-2">
                    {p.icon && <span className="text-[13px] text-slate-500">{p.icon}</span>}
                    <span className="text-[11px] text-slate-500 font-medium">{p.label}</span>
                    {failedReads[p.id] && (
                      <span className="text-[9px] text-red-400/80 ml-auto">okunamadı</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className={`text-lg font-bold tracking-tight ${
                      p.id === 25 ? (
                        csColor(readValues[25]) === "green" ? "text-emerald-400" :
                        csColor(readValues[25]) === "yellow" ? "text-amber-400" :
                        csColor(readValues[25]) === "blue" ? "text-sky-400" : "text-slate-100"
                      ) : "text-slate-100"
                    }`}>
                      {V(p.id) || "——"}
                    </span>
                    {p.unit && <span className="text-[11px] font-semibold text-slate-500">{p.unit}</span>}
                  </div>
                  <button
                    onClick={() => { setFailedReads((prev) => ({ ...prev, [p.id]: false })); sendCommand("read", p.id); }}
                    disabled={!isActive || !!batchReadingId}
                    className={`mt-auto flex items-center justify-center gap-1 w-full py-[4px] rounded-md border text-[10px] font-semibold transition
                      ${(!isActive || !!batchReadingId)
                        ? "bg-slate-800/20 text-slate-600 border-slate-700/20 cursor-not-allowed"
                        : "bg-sky-600/10 text-sky-400/70 border-sky-500/20 hover:bg-sky-600/20 hover:text-sky-400 cursor-pointer"
                      }`}
                  >
                    <HiOutlineArrowPath className="text-[10px]" />
                    Oku
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* OCPP Credentials — panelde edit+read, dashboardda sadece read */}
          <div className="mt-4">
            <Panel icon={<HiOutlineIdentification />} title="OCPP Credentials">
              {isAdmin ? (
                /* Panel modu — edit + read */
                <>
                  {OCPP_CREDS.map((p, i) => (
                    <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                      value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                      failed={failedReads[p.id]}
                      setFailed={failedSets[p.id]}
                      bulkEditing={bulkEditingId === "creds"}
                      bulkDraft={bulkDrafts[p.id] ?? ""}
                      onBulkDraftChange={updateBulkDraft}
                      onSet={(id, val) => sendCommand("set", id, val)}
                      onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                      last={i === OCPP_CREDS.length - 1} />
                  ))}

                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                    {(batchReadingId === "creds" && batchProgress) ? (
                      <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{batchProgress}</span>
                    ) : (bulkSaving && bulkProgress) ? (
                      <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{bulkProgress}</span>
                    ) : <span />}

                    <div className="flex items-center gap-2">
                      {bulkEditingId === "creds" ? (
                        <>
                          <button onClick={cancelBulkEdit}
                            className="text-[10px] font-semibold px-2.5 py-[4px] rounded-md
                                       bg-slate-800/50 text-slate-500 border border-slate-600/30
                                       hover:text-slate-300 transition cursor-pointer">
                            İptal
                          </button>
                          <button onClick={() => batchSet(OCPP_CREDS, "creds")}
                            disabled={!isActive || bulkSaving}
                            className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                              ${(!isActive || bulkSaving)
                                ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                                : "bg-emerald-600/80 text-white border-emerald-500/50 hover:bg-emerald-600 cursor-pointer"
                              }`}>
                            <HiOutlinePencilSquare className={`text-[12px] ${bulkSaving ? "animate-spin" : ""}`} />
                            {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => startBulkEdit(OCPP_CREDS, "creds")}
                          disabled={!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving}
                          className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                            ${(!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving)
                              ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                              : "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30 cursor-pointer"
                            }`}>
                          <HiOutlinePencilSquare className="text-[12px]" />
                          Toplu Edit
                        </button>
                      )}
                      <button onClick={() => batchRead(OCPP_CREDS, "creds")}
                        disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                          ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
                            ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                            : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                          }`}>
                        <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "creds" ? "animate-spin" : ""}`} />
                        {batchReadingId === "creds" ? "Okunuyor…" : "Tümünü Oku"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Dashboard modu — sadece read */
                <>
                  {OCPP_CREDS.map((p, i) => (
                    <InfoRow key={p.id} icon={p.icon} label={p.label}
                      value={V(p.id)} disabled={!isActive}
                      failed={failedReads[p.id]}
                      onRead={() => { setFailedReads((prev) => ({ ...prev, [p.id]: false })); sendCommand("read", p.id); }}
                      last={i === OCPP_CREDS.length - 1} />
                  ))}

                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                    {(batchReadingId === "creds" && batchProgress) ? (
                      <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{batchProgress}</span>
                    ) : <span />}
                    <button onClick={() => batchRead(OCPP_CREDS, "creds")}
                      disabled={!isActive || !!batchReadingId}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                        ${(!isActive || !!batchReadingId)
                          ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                          : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                        }`}>
                      <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "creds" ? "animate-spin" : ""}`} />
                      {batchReadingId === "creds" ? "Okunuyor…" : "Tümünü Oku"}
                    </button>
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* OTA — sadece admin modda */}
          {isAdmin && (
            <div className="mt-4">
              <Panel icon={<HiOutlineArrowUpTray />} title="OTA Konfigürasyon">
                {OTA.map((p, i) => (
                  <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                    value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                    failed={failedReads[p.id]}
                    setFailed={failedSets[p.id]}
                    bulkEditing={bulkEditingId === "ota"}
                    bulkDraft={bulkDrafts[p.id] ?? ""}
                    onBulkDraftChange={updateBulkDraft}
                    onSet={(id, val) => sendCommand("set", id, val)}
                    onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                    last={i === OTA.length - 1} />
                ))}

                <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-700/25">
                  {(batchReadingId === "ota" && batchProgress) ? (
                    <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{batchProgress}</span>
                  ) : (bulkSaving && bulkProgress) ? (
                    <span className="text-[11px] text-sky-400/80 font-medium animate-pulse">{bulkProgress}</span>
                  ) : <span />}
                  <div className="flex items-center gap-2">
                    {bulkEditingId === "ota" ? (
                      <>
                        <button onClick={cancelBulkEdit}
                          className="text-[10px] font-semibold px-2.5 py-[4px] rounded-md
                                     bg-slate-800/50 text-slate-500 border border-slate-600/30
                                     hover:text-slate-300 transition cursor-pointer">
                          İptal
                        </button>
                        <button onClick={() => batchSet(OTA, "ota")}
                          disabled={!isActive || bulkSaving}
                          className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                            ${(!isActive || bulkSaving)
                              ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                              : "bg-emerald-600/80 text-white border-emerald-500/50 hover:bg-emerald-600 cursor-pointer"
                            }`}>
                          <HiOutlinePencilSquare className={`text-[12px] ${bulkSaving ? "animate-spin" : ""}`} />
                          {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
                        </button>
                      </>
                    ) : (
                      <button onClick={() => startBulkEdit(OTA, "ota")}
                        disabled={!isActive || !!bulkEditingId || bulkSaving}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                          ${(!isActive || !!bulkEditingId || bulkSaving)
                            ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                            : "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30 cursor-pointer"
                          }`}>
                        <HiOutlinePencilSquare className="text-[12px]" />
                        Toplu Edit
                      </button>
                    )}
                    <button onClick={() => batchRead(OTA, "ota")}
                      disabled={!isActive || !!batchReadingId || !!bulkEditingId}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition
                        ${(!isActive || !!batchReadingId || !!bulkEditingId)
                          ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                          : "bg-sky-600/20 text-sky-400 border-sky-500/30 hover:bg-sky-600/30 cursor-pointer"
                        }`}>
                      <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "ota" ? "animate-spin" : ""}`} />
                      {batchReadingId === "ota" ? "Okunuyor…" : "Tümünü Oku"}
                    </button>
                  </div>
                </div>
              </Panel>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}