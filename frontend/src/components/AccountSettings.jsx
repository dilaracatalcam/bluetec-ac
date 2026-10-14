import { useState, useEffect } from "react";
import {
  HiOutlineCheck, HiOutlineExclamationCircle, HiOutlineCheckCircle,
  HiOutlineEnvelope, HiOutlineKey, HiOutlineUserCircle, HiOutlineIdentification,
} from "react-icons/hi2";
import { passwordPolicyError, PASSWORD_HINT } from "../lib/passwordPolicy.js";

/* ── Hesap Yönetimi bölümü ──
   Herkes (rol fark etmez) kendi hesabını buradan yönetir: e-posta, kullanıcı
   adı, şifre. Şifre değiştirme bölümü e-posta tanımlanana kadar KİLİTLİ —
   backend de aynı kuralı zorluyor (PUT /api/me/email, POST /api/users/:u/password),
   burada sadece o kuralı arayüzde de yansıtıyoruz.
   Kullanıcı adı değişince backend o kullanıcının tüm oturumlarını (bu oturum
   dahil) iptal ediyor — bu yüzden başarı sonrası burada otomatik çıkış yapılır. */
export default function AccountSettings({ token, currentUser, onEmailUpdated, onLogout }) {
  const authFetch = (url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  });

  const inputCls = `w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                    px-2.5 py-1.5 rounded-md text-[13px] outline-none
                    focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]`;

  const hasEmail = !!currentUser?.email;

  /* ── Şirket kullanıcı erişimi ──
     Şirket hesabındaki admin/operatör, şirketine bir kullanıcı ekleyip çıkarabilir;
     eklenen kullanıcı şirketin tüm cihazlarını görür. Bireysel hesaplarda yok. */
  const companyKey = String(currentUser?.company || "").trim().toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const canManageCompanyUsers = (currentUser?.role === "admin" || currentUser?.role === "operator")
    && !!companyKey && !["bireysel", "individual", "kisisel", "private", "ozel"].includes(companyKey);
  const [companyUser, setCompanyUser] = useState("");
  const [companyBusy, setCompanyBusy] = useState("");
  const [companyMsg, setCompanyMsg] = useState("");

  const handleCompanyUser = async (action) => {
    const username = companyUser.trim();
    if (!username) { setCompanyMsg("Kullanıcı adını girin."); return; }
    setCompanyBusy(action); setCompanyMsg("");
    try {
      const r = await authFetch(action === "assign" ? "/api/company/assign-user" : "/api/company/revoke-user", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setCompanyMsg(d.error || "İşlem gerçekleştirilemedi."); return; }
      setCompanyMsg(action === "assign"
        ? `${d.username || username} şirket hesabına eklendi; tüm şirket cihazlarını görebilir.`
        : `${d.username || username} şirket erişiminden çıkarıldı.`);
      setCompanyUser("");
    } catch { setCompanyMsg("Sunucuya ulaşılamadı."); }
    finally { setCompanyBusy(""); }
  };

  /* ── Cihaz paylaşım onayları ──
     Bireysel cihazın sahibi, cihazına başka bir kullanıcı eklenmeden önce onay verir
     (istek DeviceSelect'teki "Hesabıma ekle" ile oluşur). */
  const [shareRequests, setShareRequests] = useState([]);
  const [shareLoading, setShareLoading] = useState(true);
  const [shareBusy, setShareBusy] = useState("");
  const [shareError, setShareError] = useState("");

  const loadShareRequests = async () => {
    try {
      const r = await authFetch("/api/me/device-share-requests");
      const d = await r.json();
      if (r.ok) setShareRequests(d.requests || []);
    } catch { setShareError("Cihaz onayları alınamadı."); }
    finally { setShareLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadShareRequests(); }, [token]);

  const handleShareRequest = async (id, action) => {
    setShareBusy(id); setShareError("");
    try {
      const r = await authFetch(`/api/me/device-share-requests/${encodeURIComponent(id)}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (!r.ok) { setShareError(d.error || "İşlem gerçekleştirilemedi"); return; }
      setShareRequests((list) => list.filter((x) => x.id !== id));
    } catch { setShareError("Sunucuya ulaşılamadı."); }
    finally { setShareBusy(""); }
  };

  /* ── E-posta ── */
  const [email, setEmail] = useState(currentUser?.email || "");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);

  useEffect(() => { setEmail(currentUser?.email || ""); }, [currentUser?.email]);

  const handleSaveEmail = async (e) => {
    e?.preventDefault?.();
    setEmailError(""); setEmailSaved(false);
    if (!email.trim()) { setEmailError("E-posta adresi gerekli"); return; }
    if (!emailCurrentPassword) { setEmailError("Onaylamak için mevcut şifrenizi girin"); return; }

    setEmailSaving(true);
    try {
      const r = await authFetch("/api/me/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), currentPassword: emailCurrentPassword }),
      });
      const d = await r.json();
      if (!r.ok) { setEmailError(d.error || "Kaydedilemedi"); return; }
      setEmailSaved(true);
      setEmailCurrentPassword("");
      onEmailUpdated?.(email.trim());
    } catch { setEmailError("Sunucuya ulaşılamadı"); }
    finally { setEmailSaving(false); }
  };

  /* ── Kullanıcı adı ── */
  const [newUsername, setNewUsername] = useState("");
  const [usernameCurrentPassword, setUsernameCurrentPassword] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [usernameDone, setUsernameDone] = useState(false);

  const handleChangeUsername = async (e) => {
    e?.preventDefault?.();
    setUsernameError("");
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(newUsername)) {
      setUsernameError("Kullanıcı adı 3-32 karakter olmalı (harf/rakam/_/-)");
      return;
    }
    if (!usernameCurrentPassword) {
      setUsernameError("Onaylamak için mevcut şifrenizi girin");
      return;
    }

    setUsernameSaving(true);
    try {
      const r = await authFetch("/api/me/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newUsername: newUsername.trim(), currentPassword: usernameCurrentPassword }),
      });
      const d = await r.json();
      if (!r.ok) { setUsernameError(d.error || "Değiştirilemedi"); setUsernameSaving(false); return; }
      setUsernameDone(true);
      // Backend bu kullanıcının tüm oturumlarını iptal etti — token artık geçersiz.
      setTimeout(() => onLogout?.(), 1500);
    } catch { setUsernameError("Sunucuya ulaşılamadı"); setUsernameSaving(false); }
  };

  /* ── Şifre değiştir ── */
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);

  const handleChangePassword = async (e) => {
    e?.preventDefault?.();
    setPwError(""); setPwSaved(false);
    if (!oldPassword) { setPwError("Mevcut şifreniz gerekli"); return; }
    const pwErr = passwordPolicyError(newPassword);
    if (pwErr) { setPwError(pwErr); return; }
    if (newPassword === oldPassword) { setPwError("Yeni şifre eski şifreyle aynı olamaz"); return; }

    setPwSaving(true);
    try {
      const r = await authFetch(`/api/users/${encodeURIComponent(currentUser.username)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const d = await r.json();
      if (!r.ok) { setPwError(d.error || "Şifre değiştirilemedi"); return; }
      setPwSaved(true);
      setOldPassword(""); setNewPassword("");
    } catch { setPwError("Sunucuya ulaşılamadı"); }
    finally { setPwSaving(false); }
  };

  return (
    <div>
      {canManageCompanyUsers && (
        <div className="mb-6 max-w-2xl rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
          <div className="flex items-center gap-2 text-[13px] font-bold text-[var(--accent)]">
            <HiOutlineUserCircle className="text-[17px]" />
            Şirket kullanıcı erişimi
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-secondary)]">{currentUser.company}</span> şirketine aktif bir kullanıcı ekleyin veya erişimini kaldırın. Eklenen kullanıcı şirketin tüm cihazlarını görür.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={companyUser} onChange={(e) => setCompanyUser(e.target.value)} autoComplete="off"
              placeholder="Kullanıcı adı" className={inputCls} />
            <button type="button" disabled={!!companyBusy} onClick={() => handleCompanyUser("assign")}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-[12px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              {companyBusy === "assign" ? "Ekleniyor…" : "Şirkete ekle"}
            </button>
            <button type="button" disabled={!!companyBusy} onClick={() => handleCompanyUser("revoke")}
              className="shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3.5 py-2 text-[12px] font-bold text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50">
              {companyBusy === "revoke" ? "Kaldırılıyor…" : "Erişimi kaldır"}
            </button>
          </div>
          {companyMsg && <div className="mt-2 text-[11px] font-medium text-[var(--text-muted)]">{companyMsg}</div>}
        </div>
      )}

      {(shareLoading || shareRequests.length > 0 || shareError) && (
        <div className="mb-6 max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-[13px] font-bold text-amber-500">
            <HiOutlineExclamationCircle className="text-[17px]" />
            Cihaz paylaşım onayları
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            Sahibi olduğunuz bireysel cihazlara başka kullanıcı eklenmeden önce sizin onayınız gerekir.
          </p>
          {shareError && <div className="mt-2 text-[11px] font-medium text-rose-400">{shareError}</div>}
          {shareLoading ? (
            <div className="mt-3 text-[12px] text-[var(--text-muted)]">Onaylar yükleniyor…</div>
          ) : shareRequests.length === 0 ? (
            <div className="mt-3 text-[12px] text-[var(--text-muted)]">Bekleyen cihaz paylaşım isteği yok.</div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {shareRequests.map((req) => (
                <div key={req.id} className="flex flex-col gap-3 rounded-lg border border-amber-500/20 bg-[var(--bg-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                      <span className="font-mono">{req.targetUsername}</span> kullanıcısı cihazınıza erişim istiyor.
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {req.location || req.deviceCode || "Bireysel cihaz"} · Cihaz sahibi onayı gerekli
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={shareBusy === req.id} onClick={() => handleShareRequest(req.id, "approve")}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50">
                      Onayla
                    </button>
                    <button type="button" disabled={shareBusy === req.id} onClick={() => handleShareRequest(req.id, "reject")}
                      className="rounded-lg border border-rose-500/30 px-3 py-2 text-[11px] font-bold text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50">
                      Reddet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-6 max-w-md">
        {/* ── E-posta ── */}
        <form onSubmit={handleSaveEmail}>
          <div className="flex items-center gap-2 mb-2">
            <HiOutlineEnvelope className="text-[14px] text-[var(--accent)]" />
            <label className="text-[12px] font-bold tracking-wide uppercase text-[var(--text-secondary)]">E-posta</label>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            Şifrenizi unutursanız sıfırlama linki bu adrese gönderilir.
          </p>

          {emailError && (
            <div className="mb-2 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[12px] font-medium flex items-center gap-1.5">
              <HiOutlineExclamationCircle className="text-[13px] shrink-0" />{emailError}
            </div>
          )}
          {emailSaved && (
            <div className="mb-2 px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[12px] font-medium flex items-center gap-1.5">
              <HiOutlineCheckCircle className="text-[13px] shrink-0" />E-posta kaydedildi
            </div>
          )}

          <div className="flex flex-col gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@sirket.com" className={inputCls} />
            <div className="flex gap-2">
              <input type="password" value={emailCurrentPassword} onChange={(e) => setEmailCurrentPassword(e.target.value)}
                placeholder="Onaylamak için mevcut şifreniz" autoComplete="current-password" className={inputCls} />
              <button type="submit" disabled={emailSaving}
                className={`shrink-0 flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                  ${emailSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                <HiOutlineCheck className="text-[13px]" />
                {emailSaving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </form>

        {/* ── Kullanıcı adı ── */}
        <form onSubmit={handleChangeUsername} className="pt-6 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-2">
            <HiOutlineIdentification className="text-[14px] text-[var(--accent)]" />
            <label className="text-[12px] font-bold tracking-wide uppercase text-[var(--text-secondary)]">Kullanıcı Adı</label>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mb-2">
            Şu an: <span className="font-mono text-[var(--text-secondary)]">@{currentUser?.username}</span>.
            Değiştirirseniz aktif cihaz bağlantınız/oturumunuz sonlanır, yeni kullanıcı adınızla tekrar giriş yapmanız gerekir.
          </p>

          {usernameError && (
            <div className="mb-2 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[12px] font-medium flex items-center gap-1.5">
              <HiOutlineExclamationCircle className="text-[13px] shrink-0" />{usernameError}
            </div>
          )}
          {usernameDone && (
            <div className="mb-2 px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[12px] font-medium flex items-center gap-1.5">
              <HiOutlineCheckCircle className="text-[13px] shrink-0" />Kullanıcı adı değiştirildi, çıkış yapılıyor…
            </div>
          )}

          <div className="flex flex-col gap-2">
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
              placeholder="yeni.kullaniciadi" disabled={usernameDone} className={inputCls + " font-mono"} />
            <div className="flex gap-2">
              <input type="password" value={usernameCurrentPassword} onChange={(e) => setUsernameCurrentPassword(e.target.value)}
                placeholder="Onaylamak için mevcut şifreniz" autoComplete="current-password" disabled={usernameDone} className={inputCls} />
              <button type="submit" disabled={usernameSaving || usernameDone}
                className={`shrink-0 flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                  ${(usernameSaving || usernameDone) ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-amber-500 hover:bg-amber-400 text-white border-amber-400 cursor-pointer"}`}>
                <HiOutlineCheck className="text-[13px]" />
                {usernameSaving ? "Kaydediliyor…" : "Değiştir"}
              </button>
            </div>
          </div>
        </form>

        {/* ── Şifre değiştir ── */}
        <div className="pt-6 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-2">
            <HiOutlineKey className="text-[14px] text-[var(--accent)]" />
            <label className="text-[12px] font-bold tracking-wide uppercase text-[var(--text-secondary)]">Şifre Değiştir</label>
          </div>

          {!hasEmail ? (
            <p className="text-[12px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-2">
              Şifrenizi değiştirmeden önce yukarıdan bir e-posta adresi kaydedin — aksi halde yeni şifrenizi unutursanız hesabınıza kimse ulaşamaz.
            </p>
          ) : (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
              {pwError && (
                <div className="px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[12px] font-medium flex items-center gap-1.5">
                  <HiOutlineExclamationCircle className="text-[13px] shrink-0" />{pwError}
                </div>
              )}
              {pwSaved && (
                <div className="px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[12px] font-medium flex items-center gap-1.5">
                  <HiOutlineCheckCircle className="text-[13px] shrink-0" />Şifre değiştirildi
                </div>
              )}
              <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Mevcut şifre" autoComplete="current-password" className={inputCls} />
              <p className="text-[11px] text-[var(--text-muted)] -mt-1">{PASSWORD_HINT}</p>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Yeni şifre" autoComplete="new-password" className={inputCls} />
              <button type="submit" disabled={pwSaving}
                className={`self-end flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                  ${pwSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                <HiOutlineCheck className="text-[13px]" />
                {pwSaving ? "Kaydediliyor…" : "Şifreyi Değiştir"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
