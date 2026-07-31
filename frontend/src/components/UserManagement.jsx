import { useState, useEffect, useCallback } from "react";
import {
  HiOutlineUsers, HiOutlineUserPlus, HiOutlineTrash, HiOutlineKey,
  HiOutlineXMark, HiOutlineCheck, HiOutlineExclamationCircle,
  HiOutlineShieldCheck, HiOutlineUserCircle, HiOutlineUser
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

export default function UserManagement({ token, currentUsername }) {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [addForm, setAddForm] = useState({
    username: "", fullName: "", password: "", role: "operator", company: "",
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [pwModalUser, setPwModalUser] = useState(null);
  const [pwNew, setPwNew] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");

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

  useEffect(() => { loadUsers(); loadCompanies(); }, [loadUsers, loadCompanies]);

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    setAddError("");

    if (!addForm.username || !addForm.fullName || !addForm.password) {
      setAddError("Tüm alanlar gerekli"); return;
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(addForm.username)) {
      setAddError("Kullanıcı adı 3-32 karakter olmalı (harf/rakam/_/-)"); return;
    }
    if (addForm.password.length < 6) {
      setAddError("Şifre en az 6 karakter olmalı"); return;
    }
    if (addForm.role === "operator" && !addForm.company) {
      setAddError("Operator için şirket seçimi zorunlu"); return;
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
      setAddForm({ username: "", fullName: "", password: "", role: "operator", company: "" });
      await loadUsers();
    } catch { setAddError("Sunucuya ulaşılamadı"); }
    finally { setAddSaving(false); }
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

  return (
    <>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineUsers />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">Kullanıcı Yönetimi</h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Kullanıcıları görüntüle, ekle, sil ve şifre değiştir</p>
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
            <HiOutlineExclamationCircle className="text-[12px]" />{addError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Kullanıcı Adı</label>
            <input type="text" value={addForm.username}
              onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
              placeholder="ali_ozturk"
              className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[12px] outline-none font-mono
                         focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Ad Soyad</label>
            <input type="text" value={addForm.fullName}
              onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
              placeholder="Ali Öztürk"
              className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[12px] outline-none
                         focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Şifre</label>
            <input type="text" value={addForm.password}
              onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
              placeholder="en az 6 karakter"
              className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[12px] outline-none font-mono
                         focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Rol</label>
            <select value={addForm.role}
              onChange={(e) => setAddForm({ ...addForm, role: e.target.value, company: "" })}
              className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[12px] outline-none font-semibold
                         focus:border-[var(--accent)] transition cursor-pointer">
              <option value="operator">Operator (sadece Dashboard)</option>
              <option value="admin">Admin (Dashboard + Panel)</option>
            </select>
          </div>

          {/* Şirket — sadece operator için */}
          {addForm.role === "operator" && (
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">
                Şirket <span className="text-rose-400">*</span>
              </label>
              <select value={addForm.company}
                onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
                className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-2.5 py-1.5 rounded-md text-[12px] outline-none
                           focus:border-[var(--accent)] transition cursor-pointer">
                <option value="">Şirket seçin...</option>
                {companies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
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
                      <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        {u.company}
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
              className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-3 py-2 rounded-md text-[13px] outline-none font-mono
                         focus:border-[var(--accent)] transition mb-4" />
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
