import { useState, useEffect, useCallback, useMemo } from "react";
import {
  HiOutlineUsers, HiOutlineUserPlus, HiOutlineTrash, HiOutlineKey,
  HiOutlineXMark, HiOutlineCheck, HiOutlineExclamationCircle,
  HiOutlineShieldCheck, HiOutlineUserCircle, HiOutlineUser,
  HiOutlineCpuChip, HiOutlineAdjustmentsHorizontal, HiOutlineMagnifyingGlass
} from "react-icons/hi2";

const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Admin",
  operator: "Operator",
};

const ROLE_COLORS = {
  superadmin: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  admin:      "bg-amber-500/15  text-amber-500  border-amber-500/30",
  operator:   "bg-sky-500/15    text-sky-500    border-sky-500/30",
};

const ROLE_ICONS = {
  superadmin: <HiOutlineShieldCheck />,
  admin:      <HiOutlineUserCircle />,
  operator:   <HiOutlineUser />,
};

/* ── Cihaz seçici ──
   Şirket bazlı erişimin ÜSTÜNE tek tek cihaz eklemek için.
   Kullanıcının gerçek yetkisi = şirketindeki cihazlar ∪ buradan seçilenler.
   Şirketi zaten kapsayan cihazlar ayrıca işaretlenmeye gerek olmadığı için
   gri gösterilir. */
function DevicePicker({ devices, selectedMacs, onToggle, coveredCompany }) {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  const companies = useMemo(
    () => [...new Set(devices.map((d) => d.company).filter(Boolean))].sort(),
    [devices]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (companyFilter && d.company !== companyFilter) return false;
      if (!q) return true;
      return [d.location, d.device_code, d.mac, d.company]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [devices, query, companyFilter]);

  const selectedSet = useMemo(
    () => new Set(selectedMacs.map((m) => m.toUpperCase())),
    [selectedMacs]
  );

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-2 p-2 bg-[var(--bg-sunken)] border-b border-[var(--border-subtle)]">
        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-[var(--text-muted)]" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Konum, kod veya MAC ara..."
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       pl-7 pr-2 py-1.5 rounded-md text-[11px] outline-none
                       focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]" />
        </div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-2 py-1.5 rounded-md text-[11px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
          <option value="">Tüm şirketler</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="max-h-[240px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-[var(--text-muted)]">
            Eşleşen cihaz yok
          </div>
        ) : filtered.map((d) => {
          const mac = String(d.mac || "").toUpperCase();
          const covered = coveredCompany && d.company === coveredCompany;
          const checked = selectedSet.has(mac);
          return (
            <label key={d.id ?? mac}
              className={`flex items-center gap-2.5 px-3 py-1.5 transition
                ${covered ? "opacity-50" : "cursor-pointer hover:bg-[var(--bg-hover)]"}`}
              title={covered ? "Şirket yetkisiyle zaten erişilebiliyor" : ""}>
              <input type="checkbox" checked={checked || !!covered} disabled={!!covered}
                onChange={() => onToggle(mac)}
                className={covered ? "" : "cursor-pointer"} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[var(--text-primary)] font-medium truncate">
                  {d.location || "—"}
                  {d.device_code && <span className="text-[var(--text-muted)]"> — {d.device_code}</span>}
                </div>
                <div className="text-[9px] text-[var(--text-muted)] font-mono">
                  {mac || "MAC yok"} · {d.company || "—"}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="px-3 py-1.5 bg-[var(--bg-sunken)] border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">
        {selectedMacs.length} cihaz ayrıca atandı
        {coveredCompany && <span> · {coveredCompany} şirketinin tüm cihazları zaten dahil</span>}
      </div>
    </div>
  );
}

export default function UserManagement({ token, currentUsername }) {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [addForm, setAddForm] = useState({
    username: "", fullName: "", password: "", role: "operator", company: "", allowedMacs: [],
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [pwModalUser, setPwModalUser] = useState(null);
  const [pwNew, setPwNew] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");

  const [scopeUser, setScopeUser] = useState(null); // { username, company, allowedMacs }
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const authFetch = useCallback((url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), "Authorization": `Bearer ${token}` },
    });
  }, [token]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await authFetch("/api/users");
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || "Liste yüklenemedi"); return; }
      const data = await r.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch { setError("Sunucuya ulaşılamadı"); }
    finally { setLoading(false); }
  }, [authFetch]);

  const loadCompanies = useCallback(async () => {
    try {
      const r = await authFetch("/api/devices/companies");
      if (!r.ok) return;
      const d = await r.json();
      setCompanies(d.companies || []);
    } catch {}
  }, [authFetch]);

  const loadDevices = useCallback(async () => {
    try {
      const r = await authFetch("/api/devices");
      if (!r.ok) return;
      const d = await r.json();
      // MAC'i olmayan cihazlar atanamaz — yetki MAC üzerinden kuruluyor
      setDevices((d.devices || []).filter((x) => x.mac));
    } catch {}
  }, [authFetch]);

  useEffect(() => { loadUsers(); loadCompanies(); loadDevices(); }, [loadUsers, loadCompanies, loadDevices]);

  const toggleAddMac = (mac) => {
    setAddForm((f) => {
      const set = new Set(f.allowedMacs);
      if (set.has(mac)) set.delete(mac); else set.add(mac);
      return { ...f, allowedMacs: [...set] };
    });
  };

  const toggleScopeMac = (mac) => {
    setScopeUser((s) => {
      const set = new Set(s.allowedMacs);
      if (set.has(mac)) set.delete(mac); else set.add(mac);
      return { ...s, allowedMacs: [...set] };
    });
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    setAddError("");

    if (!addForm.username || !addForm.fullName || !addForm.password) {
      setAddError("Kullanıcı adı, ad soyad ve şifre gerekli"); return;
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(addForm.username)) {
      setAddError("Kullanıcı adı 3-32 karakter olmalı (harf/rakam/_/-)"); return;
    }
    if (addForm.password.length < 6) {
      setAddError("Şifre en az 6 karakter olmalı"); return;
    }
    if (addForm.role === "operator" && !addForm.company && addForm.allowedMacs.length === 0) {
      setAddError("Operator için şirket seçin ya da en az bir cihaz atayın — aksi halde hiçbir cihaz göremez");
      return;
    }

    setAddSaving(true);
    try {
      const r = await authFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const d = await r.json();
      if (!r.ok) { setAddError(d.error || "Kullanıcı eklenemedi"); return; }
      setInfo(`${addForm.fullName} (${addForm.username}) eklendi`);
      setTimeout(() => setInfo(""), 4000);
      setAddForm({ username: "", fullName: "", password: "", role: "operator", company: "", allowedMacs: [] });
      await loadUsers();
    } catch { setAddError("Sunucuya ulaşılamadı"); }
    finally { setAddSaving(false); }
  };

  const handleScopeSave = async () => {
    if (!scopeUser) return;
    setScopeError("");
    setScopeSaving(true);
    try {
      const r = await authFetch(`/api/users/${encodeURIComponent(scopeUser.username)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: scopeUser.company || null, allowedMacs: scopeUser.allowedMacs }),
      });
      const d = await r.json();
      if (!r.ok) { setScopeError(d.error || "Yetkiler güncellenemedi"); return; }
      setInfo(`${scopeUser.username} yetkileri güncellendi`);
      setTimeout(() => setInfo(""), 4000);
      setScopeUser(null);
      await loadUsers();
    } catch { setScopeError("Sunucuya ulaşılamadı"); }
    finally { setScopeSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const r = await authFetch(`/api/users/${encodeURIComponent(confirmDelete)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Kullanıcı silinemedi"); return; }
      setInfo(`${confirmDelete} silindi`);
      setTimeout(() => setInfo(""), 4000);
      setConfirmDelete(null);
      await loadUsers();
    } catch { setError("Sunucuya ulaşılamadı"); }
    finally { setDeleting(false); }
  };

  const handlePasswordChange = async (e) => {
    e?.preventDefault?.();
    setPwError("");
    if (!pwNew || pwNew.length < 6) { setPwError("Şifre en az 6 karakter olmalı"); return; }
    setPwSaving(true);
    try {
      const r = await authFetch(`/api/users/${encodeURIComponent(pwModalUser)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pwNew }),
      });
      const d = await r.json();
      if (!r.ok) { setPwError(d.error || "Şifre değiştirilemedi"); return; }
      setInfo(`${pwModalUser} şifresi değiştirildi`);
      setTimeout(() => setInfo(""), 4000);
      setPwModalUser(null); setPwNew("");
    } catch { setPwError("Sunucuya ulaşılamadı"); }
    finally { setPwSaving(false); }
  };

  const inputCls = `w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                    px-2.5 py-1.5 rounded-md text-[12px] outline-none
                    focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]`;

  return (
    <>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineUsers />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">Kullanıcı Yönetimi</h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Kullanıcı ekle, cihaz yetkisi ata, şifre değiştir</p>
          </div>
        </div>
      </div>

      {(error || info) && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-[12px] font-medium border
          ${error ? "bg-rose-500/10 border-rose-500/30 text-rose-500" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"}`}>
          {error || info}
        </div>
      )}

      {/* Yeni Kullanıcı Ekle */}
      <div className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <HiOutlineUserPlus className="text-[16px] text-[var(--accent)]" />
          <h3 className="text-[12px] font-bold text-[var(--text-primary)] tracking-wide uppercase">Yeni Kullanıcı Ekle</h3>
        </div>

        {addError && (
          <div className="mb-3 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px] font-medium flex items-center gap-1.5">
            <HiOutlineExclamationCircle className="text-[12px] shrink-0" />{addError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Kullanıcı Adı</label>
            <input type="text" value={addForm.username}
              onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
              placeholder="ali_ozturk" className={inputCls + " font-mono"} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Ad Soyad</label>
            <input type="text" value={addForm.fullName}
              onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
              placeholder="Ali Öztürk" className={inputCls} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Şifre</label>
            <input type="text" value={addForm.password}
              onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
              placeholder="en az 6 karakter" className={inputCls + " font-mono"} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Rol</label>
            <select value={addForm.role}
              onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
              className={inputCls + " font-semibold cursor-pointer"}>
              <option value="operator">Operator (sadece Dashboard)</option>
              <option value="admin">Admin (Dashboard + Panel)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">
              Şirket {addForm.role === "operator" && addForm.allowedMacs.length === 0 && <span className="text-rose-400">*</span>}
            </label>
            <select value={addForm.company}
              onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
              className={inputCls + " cursor-pointer"}>
              <option value="">
                {addForm.role === "admin" ? "Kısıtlama yok (tüm cihazlar)" : "Şirket seçin..."}
              </option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Şirket seçilirse o şirketin tüm cihazlarına erişir. Aşağıdan tek tek cihaz da eklenebilir.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">
              Ek Cihaz Yetkisi
            </label>
            <DevicePicker devices={devices} selectedMacs={addForm.allowedMacs}
              onToggle={toggleAddMac} coveredCompany={addForm.company} />
          </div>
        </div>

        <div className="flex justify-end mt-3">
          <button onClick={handleAdd} disabled={addSaving}
            className={`flex items-center gap-1.5 text-[11px] font-bold px-4 py-1.5 rounded-md border transition tracking-wide uppercase
              ${addSaving
                ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed"
                : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 shadow-sm shadow-emerald-500/20 cursor-pointer"}`}>
            <HiOutlineUserPlus className="text-[13px]" />
            {addSaving ? "Ekleniyor…" : "Kullanıcı Ekle"}
          </button>
        </div>
      </div>

      {/* Kullanıcı Listesi */}
      <div className="px-1">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[var(--text-muted)]">
            Kayıtlı Kullanıcılar ({users.length})
          </div>
          <button onClick={loadUsers} disabled={loading}
            className="text-[10px] font-semibold tracking-wide uppercase text-[var(--accent)] hover:underline disabled:opacity-50">
            {loading ? "Yükleniyor…" : "Yenile"}
          </button>
        </div>

        {users.length === 0 && !loading && (
          <div className="text-center py-8 text-[12px] text-[var(--text-muted)]">Henüz kullanıcı yok</div>
        )}

        <div className="space-y-2">
          {users.map((u) => {
            const isMe = u.username === currentUsername;
            const isSuperadmin = u.role === "superadmin";
            const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString("tr-TR") : "—";
            const macCount = (u.allowedMacs || []).length;
            const noScope = u.role === "operator" && !u.company && macCount === 0;
            return (
              <div key={u.username}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] hover:border-[var(--accent-border)] transition-colors">
                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center text-[16px] shrink-0 ${ROLE_COLORS[u.role] || ROLE_COLORS.operator}`}>
                  {ROLE_ICONS[u.role] || ROLE_ICONS.operator}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-[var(--text-primary)] font-display tracking-tight">
                      {u.fullName || u.username}
                    </span>
                    {isMe && (
                      <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-border)]">Sen</span>
                    )}
                    <span className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border ${ROLE_COLORS[u.role] || ROLE_COLORS.operator}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    {u.company && (
                      <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        {u.company}
                      </span>
                    )}
                    {macCount > 0 && (
                      <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border bg-sky-500/10 text-sky-400 border-sky-500/20">
                        <HiOutlineCpuChip className="text-[10px]" />
                        {macCount} cihaz
                      </span>
                    )}
                    {noScope && (
                      <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                        yetki yok
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                    <span>@{u.username}</span>
                    <span className="opacity-50">·</span>
                    <span>{created}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isSuperadmin && (
                    <button onClick={() => { setScopeUser({ username: u.username, company: u.company || "", allowedMacs: [...(u.allowedMacs || [])] }); setScopeError(""); }}
                      title="Cihaz yetkisini düzenle"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-sky-500/10 hover:text-sky-500 hover:border-sky-500/30 transition cursor-pointer">
                      <HiOutlineAdjustmentsHorizontal className="text-[13px]" />
                    </button>
                  )}
                  <button onClick={() => { setPwModalUser(u.username); setPwNew(""); setPwError(""); }}
                    title="Şifre değiştir"
                    className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-amber-500/10 hover:text-amber-500 hover:border-amber-500/30 transition cursor-pointer">
                    <HiOutlineKey className="text-[13px]" />
                  </button>
                  {!isMe && !isSuperadmin && (
                    <button onClick={() => setConfirmDelete(u.username)}
                      title="Kullanıcıyı sil"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 transition cursor-pointer">
                      <HiOutlineTrash className="text-[13px]" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cihaz Yetkisi Modal */}
      {scopeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !scopeSaving && setScopeUser(null)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-w-lg w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Cihaz Yetkisi</h3>
              <button onClick={() => setScopeUser(null)} disabled={scopeSaving}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition">
                <HiOutlineXMark className="text-[16px]" />
              </button>
            </div>

            <div className="mb-3 text-[12px] font-mono text-[var(--text-primary)] font-semibold">@{scopeUser.username}</div>

            {scopeError && (
              <div className="mb-3 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px] font-medium flex items-center gap-1.5">
                <HiOutlineExclamationCircle className="text-[12px] shrink-0" />{scopeError}
              </div>
            )}

            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Şirket</label>
            <select value={scopeUser.company}
              onChange={(e) => setScopeUser({ ...scopeUser, company: e.target.value })}
              className={inputCls + " cursor-pointer mb-3"}>
              <option value="">Şirket yetkisi yok</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Ek Cihazlar</label>
            <DevicePicker devices={devices} selectedMacs={scopeUser.allowedMacs}
              onToggle={toggleScopeMac} coveredCompany={scopeUser.company} />

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setScopeUser(null)} disabled={scopeSaving}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer tracking-wide uppercase disabled:opacity-50">
                İptal
              </button>
              <button onClick={handleScopeSave} disabled={scopeSaving}
                className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border transition tracking-wide uppercase
                  ${scopeSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 cursor-pointer"}`}>
                <HiOutlineCheck className="text-[13px]" />
                {scopeSaving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Şifre Modal */}
      {pwModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !pwSaving && setPwModalUser(null)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Şifre Değiştir</h3>
              <button onClick={() => setPwModalUser(null)} disabled={pwSaving}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition">
                <HiOutlineXMark className="text-[16px]" />
              </button>
            </div>
            <div className="mb-4">
              <div className="text-[11px] text-[var(--text-muted)] mb-1">Kullanıcı:</div>
              <div className="text-[12px] font-mono text-[var(--text-primary)] font-semibold">@{pwModalUser}</div>
            </div>
            {pwError && (
              <div className="mb-3 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[11px] font-medium flex items-center gap-1.5">
                <HiOutlineExclamationCircle className="text-[12px]" />{pwError}
              </div>
            )}
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Yeni Şifre</label>
            <input type="text" value={pwNew} onChange={(e) => setPwNew(e.target.value)}
              placeholder="en az 6 karakter" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handlePasswordChange(); }}
              className={inputCls + " font-mono mb-4"} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPwModalUser(null)} disabled={pwSaving}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer tracking-wide uppercase disabled:opacity-50">
                İptal
              </button>
              <button onClick={handlePasswordChange} disabled={pwSaving}
                className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border transition tracking-wide uppercase
                  ${pwSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-emerald-500 hover:bg-emerald-400 text-white border-emerald-400 cursor-pointer"}`}>
                <HiOutlineCheck className="text-[13px]" />
                {pwSaving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Silme Onay Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 text-[18px]">
                <HiOutlineExclamationCircle />
              </div>
              <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Kullanıcıyı Sil?</h3>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] mb-5 leading-relaxed">
              <span className="font-mono font-semibold text-[var(--text-primary)]">@{confirmDelete}</span> kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-md border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer tracking-wide uppercase disabled:opacity-50">
                İptal
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border transition tracking-wide uppercase
                  ${deleting ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-rose-500 hover:bg-rose-400 text-white border-rose-400 cursor-pointer"}`}>
                <HiOutlineTrash className="text-[13px]" />
                {deleting ? "Siliniyor…" : "Sil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}