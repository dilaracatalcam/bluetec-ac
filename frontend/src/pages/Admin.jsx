import Navigation from "../components/Navigation.jsx";
import Panel from "../components/Panel.jsx";
import EditableRow from "../components/EditableRow.jsx";
import ActionButton from "../components/ActionButton.jsx";
import { useState, useEffect, useCallback } from "react";

import {
  HiOutlineArrowUpTray, HiOutlineKey, HiOutlineTag,
  HiOutlineCog6Tooth, HiOutlineArrowPath, HiOutlineCpuChip,
  HiOutlineCommandLine, HiOutlinePencilSquare
} from "react-icons/hi2";
import { TbGauge } from "react-icons/tb";
import { MdOutlineRestartAlt } from "react-icons/md";

/* ── Admin-only parametreler ── */
const ADMIN_MSP = [
  { id: 16, icon: <TbGauge />,                 label: "AC Ölçer",    color: "red" },
  { id: 19, icon: <HiOutlineCommandLine />,    label: "Test Modu",   color: "red" },
  { id: 18, icon: <HiOutlineCpuChip />,        label: "Model",       isInfo: true },
];

const OTA = [
  { id: 31, icon: <HiOutlineArrowUpTray />,    label: "OTA Update" },
  { id: 32, icon: <HiOutlineKey />,            label: "OTA Key" },
  { id: 33, icon: <HiOutlineTag />,            label: "OTA Versiyon" },
];

function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "——";
  return String(raw);
}

export default function Admin({ token, onNavigate, onLogout }) {
  const authFetch = (url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Authorization": `Bearer ${token}`,
      },
    });
  };

  const [espStatus, setEspStatus] = useState("unknown");
  const [isConnected, setIsConnected] = useState(false);
  const [mac, setMac] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [readValues, setReadValues] = useState({});
  const [setOkMap, setSetOkMap] = useState({});
  const isActive = isConnected && espStatus === "active";

  /* ── Polling ── */
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
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    const f = () => authFetch("/api/keepalive", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
    f(); const iv = setInterval(f, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isConnected]);

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
          if (data === "SET OK") ok[msg] = true;
          if (cmd === 2 && data !== undefined && data !== null) rv[msg] = data;
        });
        setSetOkMap((prev) => ({ ...prev, ...ok }));
        setReadValues((prev) => ({ ...prev, ...rv }));
      } catch {}
    };
    f(); const iv = setInterval(f, 2000);
    return () => clearInterval(iv);
  }, [isConnected]);

  const sendCommand = useCallback(async (type, variable, value = "") => {
    if (!isActive) { setMessage("ESP aktif değil"); return false; }
    try {
      const r = await authFetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, variable, value }),
      });
      const d = await r.json();
      if (!r.ok) { setMessage(d.message || "Hata"); return false; }
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
      await authFetch("/api/disconnect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTarget: mac }),
      });
    } catch {}
    setIsConnected(false);
    setEspStatus("unknown");
    setReadValues({});
    setSetOkMap({});
    setMessage("Bağlantı koparıldı.");
    setTimeout(() => setMessage(""), 3000);
  };

  /* ── Batch Read ── */
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
      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === p.id);
          if (found && found.data !== undefined) { setReadValues((prev) => ({ ...prev, [p.id]: found.data })); success = true; break; }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 2000));
      }
      failed[p.id] = !success;
    }
    setFailedReads((prev) => ({ ...prev, ...failed }));
    const failCount = Object.values(failed).filter(Boolean).length;
    setBatchProgress(""); setBatchReadingId(null);
    setMessage(failCount > 0 ? `${params.length - failCount} okundu, ${failCount} okunamadı ⚠️` : "Tüm değerler okundu ✓");
    setTimeout(() => setMessage(""), 4000);
  };

  /* ── Batch Set ── */
  const [bulkEditingId, setBulkEditingId] = useState(null);
  const [bulkDrafts, setBulkDrafts] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [failedSets, setFailedSets] = useState({});

  const startBulkEdit = (params, panelId) => {
    if (!isActive || bulkSaving) return;
    const drafts = {};
    params.forEach((p) => { const v = readValues[p.id]; drafts[p.id] = (v && v !== "——") ? String(v) : ""; });
    setBulkDrafts(drafts); setBulkEditingId(panelId); setFailedSets({});
  };
  const cancelBulkEdit = () => { setBulkEditingId(null); setBulkDrafts({}); };
  const updateBulkDraft = (id, value) => { setBulkDrafts((prev) => ({ ...prev, [id]: value })); };

  const batchSet = async (params, panelId) => {
    if (!isActive || bulkSaving) return;
    setBulkSaving(true);
    const failed = {};
    const toSend = params.filter((p) => (bulkDrafts[p.id] ?? "") !== "");
    for (let i = 0; i < toSend.length; i++) {
      const p = toSend[i];
      setBulkProgress(`${p.label} kaydediliyor… (${i + 1}/${toSend.length})`);
      await sendCommand("set", p.id, bulkDrafts[p.id]);
      await new Promise((r) => setTimeout(r, 2500));
      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const found = (j.message_response || []).find((m) => Number(m.msg) === p.id && m.data === "SET OK");
          if (found) { success = true; break; }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 2000));
      }
      failed[p.id] = !success;
    }
    setFailedSets((prev) => ({ ...prev, ...failed }));
    const failCount = Object.values(failed).filter(Boolean).length;
    setBulkProgress(""); setBulkSaving(false); setBulkEditingId(null); setBulkDrafts({});
    setMessage(failCount > 0 ? `${toSend.length - failCount} kaydedildi, ${failCount} kaydedilemedi ⚠️` : `${toSend.length} değer kaydedildi ✓`);
    setTimeout(() => setMessage(""), 4000);
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
      <Navigation activePage="admin" onNavigate={onNavigate} onLogout={onLogout} />

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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* MSP Admin */}
            <Panel icon={<HiOutlineCog6Tooth />} title="MSP Konfigürasyon (Admin)">
              <div className="grid grid-cols-2 gap-2 py-1">
                {ADMIN_MSP.map((p) =>
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

            {/* OTA */}
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
        </div>
      </main>
    </div>
  );
}