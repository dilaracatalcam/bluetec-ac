import { useState, useEffect, useCallback } from "react";
import {
  HiOutlineWrenchScrewdriver, HiOutlineArrowPath, HiOutlineCheckCircle,
  HiOutlineExclamationCircle, HiOutlinePlus, HiOutlineXMark,
  HiOutlinePencilSquare, HiOutlineTrash,
} from "react-icons/hi2";

export default function DeviceSetup({ token, isActive, sendCommand, setReadValues }) {
  const [profiles, setProfiles] = useState({});
  const [selectedProfile, setSelectedProfile] = useState("");
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState("");
  const [loadError, setLoadError] = useState("");

  // ── Yeni parametre ekleme (KALICI — device_profiles.json'a yazılır) ──
  const [showAddParam, setShowAddParam] = useState(false);
  const [newParamId, setNewParamId] = useState("");
  const [newParamLabel, setNewParamLabel] = useState("");
  const [newParamValue, setNewParamValue] = useState("");
  const [paramError, setParamError] = useState("");
  const [paramSaving, setParamSaving] = useState(false);

  // ── Mevcut parametreyi düzenleme (KALICI) ──
  const [editingParamId, setEditingParamId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editValue, setEditValue] = useState("");

  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  useEffect(() => {
    authFetch("/api/device-profiles")
      .then((r) => r.json())
      .then((d) => {
        if (d.profiles) setProfiles(d.profiles);
        else setLoadError("Profiller yüklenemedi");
      })
      .catch(() => setLoadError("Sunucuya ulaşılamadı"));
  }, [authFetch]);

  const handleProfileSelect = (key) => {
    setSelectedProfile(key);
    setResults(null);
    setResetResult("");
    setShowAddParam(false);
    setParamError("");
    setEditingParamId(null);
    if (!key) { setDrafts({}); return; }
    const profile = profiles[key];
    const d = {};
    profile.params.forEach((p) => { d[p.id] = p.value; });
    setDrafts(d);
  };

  const profile = selectedProfile ? profiles[selectedProfile] : null;

  // ── Yeni parametre ekle — device_profiles.json'a kalıcı yazılır ──
  const handleAddParam = async () => {
    setParamError("");
    const idNum = parseInt(newParamId, 10);
    if (!newParamId || Number.isNaN(idNum)) { setParamError("Geçerli bir parametre ID'si girin"); return; }
    if (!newParamLabel.trim()) { setParamError("Etiket boş olamaz"); return; }
    if (profile.params.some((p) => p.id === idNum)) { setParamError("Bu ID zaten bu profilde var"); return; }

    setParamSaving(true);
    try {
      const r = await authFetch(`/api/device-profiles/${selectedProfile}/params`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idNum, label: newParamLabel.trim(), value: newParamValue }),
      });
      const d = await r.json();
      if (!r.ok) { setParamError(d.error || "Eklenemedi"); return; }

      setProfiles((prev) => ({ ...prev, [selectedProfile]: { ...prev[selectedProfile], params: d.params } }));
      setDrafts((prev) => ({ ...prev, [idNum]: newParamValue }));
      setNewParamId(""); setNewParamLabel(""); setNewParamValue("");
      setShowAddParam(false);
    } catch { setParamError("Sunucuya ulaşılamadı"); }
    finally { setParamSaving(false); }
  };

  // ── Mevcut parametreyi düzenle — device_profiles.json'a kalıcı yazılır ──
  const startEditParam = (p) => {
    setEditingParamId(p.id);
    setEditLabel(p.label);
    setEditValue(p.value ?? "");
    setParamError("");
  };

  const cancelEditParam = () => {
    setEditingParamId(null);
    setEditLabel("");
    setEditValue("");
  };

  const handleSaveEditParam = async (id) => {
    setParamError("");
    if (!editLabel.trim()) { setParamError("Etiket boş olamaz"); return; }
    setParamSaving(true);
    try {
      const r = await authFetch(`/api/device-profiles/${selectedProfile}/params/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editLabel.trim(), value: editValue }),
      });
      const d = await r.json();
      if (!r.ok) { setParamError(d.error || "Güncellenemedi"); return; }

      setProfiles((prev) => ({ ...prev, [selectedProfile]: { ...prev[selectedProfile], params: d.params } }));
      setDrafts((prev) => ({ ...prev, [id]: editValue }));
      cancelEditParam();
    } catch { setParamError("Sunucuya ulaşılamadı"); }
    finally { setParamSaving(false); }
  };

  // ── Mevcut parametreyi sil — device_profiles.json'dan kalıcı kaldırılır ──
  const handleDeleteParam = async (p) => {
    if (!window.confirm(`"${p.label}" parametresini "${profile.label}" profilinden kalıcı olarak silmek istediğine emin misin?`)) return;
    setParamError("");
    try {
      const r = await authFetch(`/api/device-profiles/${selectedProfile}/params/${p.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { setParamError(d.error || "Silinemedi"); return; }

      setProfiles((prev) => ({ ...prev, [selectedProfile]: { ...prev[selectedProfile], params: d.params } }));
      setDrafts((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
    } catch { setParamError("Sunucuya ulaşılamadı"); }
  };

  const handleSend = async () => {
    if (!isActive || !selectedProfile) return;
    const toSend = profile.params.filter((p) => drafts[p.id] !== "");

    setSending(true);
    setResults(null);
    const success = [];
    const failed = [];

    for (let i = 0; i < toSend.length; i++) {
      const p = toSend[i];
      const val = drafts[p.id];
      setProgress(`${p.label} gönderiliyor... (${i + 1}/${toSend.length})`);

      try {
        const r = await authFetch("/api/send-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "set", variable: p.id, value: val }),
        });
        if (!r.ok) { failed.push(p.label); continue; }

        let ok = false;
        for (let retry = 0; retry < 3; retry++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const resp = await authFetch("/api/responses");
            const j = await resp.json();
            const msgs = j.message_response || [];
            if (msgs.find((m) => Number(m.msg) === p.id && m.data === "SET OK")) {
              ok = true; break;
            }
          } catch {}
        }

        if (ok) {
          success.push(p.label);
          setReadValues((prev) => ({ ...prev, [p.id]: String(val) }));
        } else {
          failed.push(p.label);
        }
      } catch {
        failed.push(p.label);
      }
    }

    setProgress("");
    setSending(false);
    setResults({ success, failed });
  };

  const handleReset = async () => {
    if (!isActive) return;
    setResetLoading(true);
    setResetResult("");
    try {
      const r = await authFetch("/api/send-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set", variable: 20, value: "1" }),
      });
      if (!r.ok) { setResetResult("Gönderilemedi"); setResetLoading(false); return; }

      let ok = false;
      for (let retry = 0; retry < 3; retry++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          if (msgs.find((m) => Number(m.msg) === 20 && m.data === "SET OK")) {
            ok = true; break;
          }
        } catch {}
      }
      setResetResult(ok ? "ESP resetlendi" : "Yanıt alınamadı");
    } catch {
      setResetResult("Hata oluştu");
    } finally {
      setResetLoading(false);
      setTimeout(() => setResetResult(""), 4000);
    }
  };

  return (
    <div>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineWrenchScrewdriver />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
              Cihaz Kurulum
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Şirket profili seçin, parametreleri düzenleyin ve toplu gönderin
            </p>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[12px] font-medium border bg-rose-500/10 border-rose-500/30 text-rose-500">
          {loadError}
        </div>
      )}

      <div className="mb-5">
        <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-2">
          Şirket Profili
        </label>
        <select
          value={selectedProfile}
          onChange={(e) => handleProfileSelect(e.target.value)}
          className="w-full sm:w-72 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)] transition cursor-pointer"
        >
          <option value="">Şirket seçin...</option>
          {Object.entries(profiles).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
      </div>

      {profile && (
        <>
          <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden mb-4">
            <div className="px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">
                {profile.label} — {profile.params.filter(p => drafts[p.id] !== "").length} parametre
              </span>
              <button
                onClick={() => { setShowAddParam((v) => !v); setParamError(""); }}
                className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md border transition tracking-wide uppercase
                           bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
              >
                <HiOutlinePlus className="text-[11px]" />
                Yeni Parametre
              </button>
            </div>

            {showAddParam && (
              <div className="px-4 py-3 bg-[var(--bg-sunken)] border-b border-[var(--border-subtle)] flex flex-col gap-2">
                <p className="text-[10px] text-[var(--text-muted)] italic">
                  Bu alan "{profile.label}" profiline kalıcı olarak eklenir — sen silene kadar burada kalır.
                </p>
                {paramError && (
                  <div className="text-[11px] text-rose-500 font-medium">{paramError}</div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="number" value={newParamId} onChange={(e) => setNewParamId(e.target.value)}
                    placeholder="Parametre ID (örn: 45)"
                    className="w-full sm:w-36 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2.5 py-1.5 rounded-md text-[12px] outline-none focus:border-[var(--accent)] transition font-mono
                               placeholder:text-[var(--text-muted)]" />
                  <input type="text" value={newParamLabel} onChange={(e) => setNewParamLabel(e.target.value)}
                    placeholder="Etiket"
                    className="w-full sm:w-40 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2.5 py-1.5 rounded-md text-[12px] outline-none focus:border-[var(--accent)] transition
                               placeholder:text-[var(--text-muted)]" />
                  <input type="text" value={newParamValue} onChange={(e) => setNewParamValue(e.target.value)}
                    placeholder="Değer"
                    className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2.5 py-1.5 rounded-md text-[12px] outline-none focus:border-[var(--accent)] transition font-mono
                               placeholder:text-[var(--text-muted)]" />
                  <button onClick={handleAddParam} disabled={paramSaving}
                    className={`flex items-center justify-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-md border transition tracking-wide uppercase shrink-0
                      ${paramSaving ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 cursor-pointer"}`}>
                    <HiOutlinePlus className="text-[12px]" />
                    {paramSaving ? "Ekleniyor..." : "Ekle"}
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-[var(--border-subtle)]">
              {profile.params.map((p) => {
                const isEditingThis = editingParamId === p.id;
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    {isEditingThis ? (
                      <>
                        <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Etiket"
                          className="w-[140px] shrink-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                     px-2 py-1 rounded-md text-[11px] outline-none focus:border-[var(--accent)] transition" />
                        <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          placeholder="Değer"
                          className="flex-1 bg-[var(--bg-sunken)] border border-[var(--accent)] text-[var(--text-primary)]
                                     px-2.5 py-1.5 rounded-md text-[12px] outline-none font-mono" />
                        <button onClick={() => handleSaveEditParam(p.id)} disabled={paramSaving}
                          title="Kaydet"
                          className="p-1.5 rounded-md border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30 transition cursor-pointer shrink-0">
                          <HiOutlineCheckCircle className="text-[13px]" />
                        </button>
                        <button onClick={cancelEditParam} title="Vazgeç"
                          className="p-1.5 rounded-md border bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] transition cursor-pointer shrink-0">
                          <HiOutlineXMark className="text-[13px]" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-[140px] shrink-0">
                          <span className="text-[11px] text-[var(--text-muted)] font-medium">{p.label}</span>
                          <span className="text-[9px] text-[var(--text-muted)] opacity-50 ml-1">#{p.id}</span>
                        </div>
                        <input
                          type="text"
                          value={drafts[p.id] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder={p.id === 2 ? "OCPP ID girin" : p.id === 44 ? "Seri no girin" : ""}
                          className={`flex-1 bg-[var(--bg-sunken)] border text-[var(--text-primary)]
                                     px-2.5 py-1.5 rounded-md text-[12px] outline-none transition
                                     placeholder:text-[var(--text-muted)] font-mono
                                     ${results?.failed?.includes(p.label)
                                       ? "border-rose-500/50 bg-rose-500/5"
                                       : results?.success?.includes(p.label)
                                         ? "border-emerald-500/50 bg-emerald-500/5"
                                         : "border-[var(--border-subtle)] focus:border-[var(--accent)]"
                                     }`}
                        />
                        {results?.success?.includes(p.label) && (
                          <HiOutlineCheckCircle className="text-emerald-400 text-[16px] shrink-0" />
                        )}
                        {results?.failed?.includes(p.label) && (
                          <HiOutlineExclamationCircle className="text-rose-400 text-[16px] shrink-0" />
                        )}
                        <button onClick={() => startEditParam(p)} title="Etiket/değer düzenle"
                          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition cursor-pointer shrink-0">
                          <HiOutlinePencilSquare className="text-[13px]" />
                        </button>
                        <button onClick={() => handleDeleteParam(p)} title="Profilden kalıcı sil"
                          className="p-1 rounded-md text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer shrink-0">
                          <HiOutlineTrash className="text-[13px]" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {paramError && !showAddParam && (
            <div className="mb-3 text-[11px] text-rose-500 font-medium">{paramError}</div>
          )}

          {progress && (
            <div className="mb-3 text-[11px] text-[var(--accent)] font-medium font-mono animate-pulse">
              {progress}
            </div>
          )}

          {results && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-[12px] font-medium border
              ${results.failed.length > 0
                ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"}`}>
              {results.success.length} parametre gönderildi
              {results.failed.length > 0 && ` — ${results.failed.join(", ")} gönderilemedi`}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSend}
              disabled={!isActive || sending}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-bold border transition tracking-wide uppercase
                ${(!isActive || sending)
                  ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                  : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 shadow-sm shadow-emerald-500/20 cursor-pointer"}`}
            >
              <HiOutlineArrowPath className={`text-[14px] ${sending ? "animate-spin" : ""}`} />
              {sending ? "Gönderiliyor..." : "Toplu Gönder"}
            </button>

            <button
              onClick={handleReset}
              disabled={!isActive || resetLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold border transition tracking-wide uppercase
                ${(!isActive || resetLoading)
                  ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                  : "bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border-rose-500/30 cursor-pointer"}`}
            >
              <HiOutlineArrowPath className={`text-[14px] ${resetLoading ? "animate-spin" : ""}`} />
              {resetLoading ? "Bekleniyor..." : "ESP Reset"}
            </button>

            {resetResult && (
              <span className={`text-[11px] font-medium font-mono ${resetResult.includes("resetlendi") ? "text-emerald-400" : "text-rose-400"}`}>
                {resetResult}
              </span>
            )}
          </div>
        </>
      )}

      {!profile && !loadError && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineWrenchScrewdriver className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[12px]">Başlamak için bir şirket profili seçin</p>
        </div>
      )}
    </div>
  );
}