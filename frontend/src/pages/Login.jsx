import { useState, useEffect, useRef } from "react";
import {
  HiOutlineLockClosed, HiOutlineUser, HiOutlineExclamationCircle,
  HiOutlineEye, HiOutlineEyeSlash, HiOutlineSun, HiOutlineMoon,
  HiOutlineShieldCheck
} from "react-icons/hi2";

/* ── Login Sayfası ──
   Home.jsx ile aynı tema sistemini kullanır (CSS variables).
   Backend API kontratı değişmedi:
     POST /api/login  body: { username, password, page }
     → { token, role } döner
*/
export default function Login({ page, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Bazı tarayıcılar (özellikle Chrome autofill) kayıtlı kullanıcı adı/şifreyi
  // dolduruyor ama React'in onChange'ini tetiklemiyor — state boş kalıp "Giriş
  // Yap" pasif görünüyor. ref ile gönderim anında gerçek DOM değerini okuyoruz.
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  // ── Şifremi unuttum ──
  const [mode, setMode] = useState("login"); // "login" | "forgot" | "register" | "verify"
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  const [registerFullName, setRegisterFullName] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPassword2, setRegisterPassword2] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterPassword2, setShowRegisterPassword2] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMessage, setRegisterMessage] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const goToForgot = () => {
    setError("");
    setForgotMessage("");
    setForgotUsername(username);
    setMode("forgot");
  };
  const goToLogin = () => {
    setError("");
    setForgotMessage("");
    setRegisterMessage("");
    setVerificationMessage("");
    setMode("login");
  };

  const goToRegister = () => {
    setError("");
    setForgotMessage("");
    setRegisterMessage("");
    setVerificationMessage("");
    setMode("register");
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!forgotUsername) return;
    setError("");
    setForgotLoading(true);
    try {
      const r = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername }),
      });
      const data = await r.json().catch(() => ({}));
      setForgotMessage(data.message || "Eğer bu kullanıcı adı sistemde kayıtlıysa, şifre sıfırlama e-postası gönderildi.");
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setRegisterMessage("");

    if (!registerFullName.trim() || !registerUsername.trim() || !registerEmail.trim() || !registerPassword) {
      setError("Ad soyad, kullanıcı adı, e-posta ve şifre gerekli");
      return;
    }
    if (registerPassword !== registerPassword2) {
      setError("Şifreler aynı olmalı");
      return;
    }

    setRegisterLoading(true);
    try {
      const r = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: registerFullName.trim(),
          username: registerUsername.trim(),
          email: registerEmail.trim(),
          password: registerPassword,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || "Kayıt başarısız");
        return;
      }

      setUsername(registerUsername.trim());
      setPassword("");
      setRegisterPassword("");
      setRegisterPassword2("");
      setShowRegisterPassword(false);
      setShowRegisterPassword2(false);
      setRegisterCode("");
      setVerificationMessage(data.message || "Doğrulama kodu e-posta adresinize gönderildi.");
      setMode("verify");
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleVerifySubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!registerCode.trim() || !/^\d{6}$/.test(registerCode.trim())) {
      setError("6 haneli doğrulama kodunu girin");
      return;
    }

    setVerifyLoading(true);
    try {
      const r = await fetch("/api/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: registerUsername.trim(), code: registerCode.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || "Doğrulama başarısız");
        return;
      }
      setUsername(registerUsername.trim());
      setRegisterMessage(data.message || "E-posta doğrulandı. Artık giriş yapabilirsiniz.");
      setRegisterCode("");
      setMode("login");
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setResendLoading(true);
    try {
      const r = await fetch("/api/register/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: registerUsername.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || "Kod tekrar gönderilemedi");
        return;
      }
      setVerificationMessage(data.message || "Yeni doğrulama kodu gönderildi.");
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setResendLoading(false);
    }
  };

  // Tema — Home.jsx ile aynı localStorage anahtarı, aynı class sistemi
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try { return window.localStorage?.getItem("bluetech-theme-v2") || "light"; } catch { return "light"; }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    try { window.localStorage?.setItem("bluetech-theme-v2", theme); } catch {}
  }, [theme]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Autofill'in doldurup React state'ine yansıtmadığı durumlar için gerçek
    // DOM değerlerini esas al.
    const u = usernameRef.current?.value ?? username;
    const p = passwordRef.current?.value ?? password;
    if (!u || !p) {
      setError("Kullanıcı adı ve şifre gerekli");
      return;
    }

    setLoading(true);

    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p, page }),
      });

      const data = await r.json();

      if (!r.ok) {
        setError(data.error || "Giriş başarısız");
        return;
      }

      onLogin(data.token, data.role);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = page === "admin";
  const title = mode === "forgot"
    ? "Şifre Sıfırlama"
    : mode === "register"
      ? "Kayıt Ol"
      : mode === "verify"
        ? "E-posta Doğrulama"
    : isAdmin ? "Admin Panel Girişi" : "Dashboard Girişi";
  const subtitle = mode === "forgot"
    ? "Kullanıcı adınızı girin, size bir sıfırlama linki gönderelim"
    : mode === "register"
      ? "Hesabınızı oluşturmak için bilgilerinizi girin"
      : mode === "verify"
        ? "E-posta adresinize gelen 6 haneli kodu girin"
    : isAdmin ? "Yönetici yetkisi gerektirir" : "İzleme ve temel kontrol paneli";

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] font-body relative overflow-hidden">
      {/* Google Fonts + CSS Variables — Home.jsx ile aynı sistem */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root.theme-dark {
          --bg-app: #0a0f18;
          --bg-sidebar: #0d1420;
          --bg-surface: #111827;
          --bg-subtle: #1a2232;
          --bg-sunken: #0b1220;
          --bg-hover: #1e2a3f;
          --border-subtle: rgba(148, 163, 184, 0.12);
          --border-strong: rgba(148, 163, 184, 0.22);
          --text-primary: #e2e8f0;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --accent: #3b82f6;
          --accent-soft: rgba(59, 130, 246, 0.10);
          --accent-soft-hover: rgba(59, 130, 246, 0.18);
          --accent-border: rgba(59, 130, 246, 0.28);
        }
        :root.theme-light {
          --bg-app: #f5f7fb;
          --bg-sidebar: #ffffff;
          --bg-surface: #ffffff;
          --bg-subtle: #f1f5f9;
          --bg-sunken: #e2e8f0;
          --bg-hover: #e6edf5;
          --border-subtle: rgba(15, 23, 42, 0.08);
          --border-strong: rgba(15, 23, 42, 0.15);
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --text-muted: #94a3b8;
          --accent: #2563eb;
          --accent-soft: rgba(37, 99, 235, 0.08);
          --accent-soft-hover: rgba(37, 99, 235, 0.14);
          --accent-border: rgba(37, 99, 235, 0.28);
        }
        .font-display { font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif; }
        /* Jakarta'nın kelime boşluğu dar — sıkı harf aralığıyla kelimeler yapışmasın */
        .font-display.font-display { letter-spacing: -0.012em; word-spacing: 0.1em; }
        .font-body    { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
        .font-mono    { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }

        .theme-light input { color-scheme: light; }
        .theme-dark input  { color-scheme: dark; }

        /* Arka plan grid pattern */
        .login-grid-bg {
          background-image:
            linear-gradient(var(--border-subtle) 1px, transparent 1px),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
        }

        /* Giriş animasyonu */
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fade-up 0.5s ease-out both; }
      `}</style>

      {/* Decorative background */}
      <div className="absolute inset-0 login-grid-bg pointer-events-none" />
      <div
        className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full pointer-events-none opacity-40"
        style={{ background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full pointer-events-none opacity-30"
        style={{ background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)" }}
      />

      {/* Top bar: brand + theme toggle */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col leading-none gap-1">
            <img
              src={theme === "dark" ? "/brand/bluetech-logo-white.png" : "/brand/bluetech-logo-dark.png"}
              alt="Bluetech"
              className="h-5 w-auto"
            />
            <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-[var(--text-muted)]">
              EV Charge Panel
            </span>
          </div>
        </div>

        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     bg-[var(--bg-subtle)] border border-[var(--border-subtle)]
                     text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]
                     transition text-[12px] font-semibold"
        >
          {theme === "dark" ? <HiOutlineSun className="text-[14px]" /> : <HiOutlineMoon className="text-[14px]" />}
          <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </header>

      {/* Center card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-8">
        <form onSubmit={mode === "forgot" ? handleForgotSubmit : mode === "register" ? handleRegisterSubmit : mode === "verify" ? handleVerifySubmit : handleSubmit}
          className="w-full max-w-sm fade-up">

          {/* Rol etiketi */}
          <div className="flex items-center justify-center mb-5">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold tracking-[0.15em] uppercase
              ${isAdmin
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-[var(--accent-soft)] border-[var(--accent-border)] text-[var(--accent)]"
              }`}>
              <HiOutlineShieldCheck className="text-[13px]" />
              {isAdmin ? "Admin Erişimi" : "Dashboard Erişimi"}
            </div>
          </div>

          {/* Kart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8 shadow-xl shadow-black/20 backdrop-blur-sm">

            {/* Başlık */}
            <div className="text-center mb-6">
              <h1 className="text-[20px] sm:text-[22px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
                {title}
              </h1>
              <p className="text-[13px] text-[var(--text-muted)] mt-1.5">
                {subtitle}
              </p>
            </div>

            {/* Hata kutusu */}
            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[13px]">
                <HiOutlineExclamationCircle className="text-[14px] shrink-0 mt-[1px]" />
                <span className="font-medium leading-snug">{error}</span>
              </div>
            )}
            {registerMessage && mode === "login" && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[13px]">
                <span className="font-medium leading-snug">{registerMessage}</span>
              </div>
            )}

            {/* Form alanları */}
            {mode === "login" ? (
              <div className="flex flex-col gap-3">
                {/* Kullanıcı adı */}
                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Kullanıcı Adı
                  </label>
                  <div className="relative">
                    <HiOutlineUser className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                    <input
                      ref={usernameRef}
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="kullanici.adi"
                      autoComplete="username"
                      className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 pl-10 pr-3 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                 placeholder:text-[var(--text-muted)] placeholder:font-sans
                                 focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                    />
                  </div>
                </div>

                {/* Şifre */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 ml-0.5 mr-0.5">
                    <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)]">
                      Şifre
                    </label>
                    <button
                      type="button"
                      onClick={goToForgot}
                      className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition cursor-pointer"
                    >
                      Şifremi unuttum?
                    </button>
                  </div>
                  <div className="relative">
                    <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                    <input
                      ref={passwordRef}
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
                      className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 pl-10 pr-10 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                 placeholder:text-[var(--text-muted)] placeholder:font-sans
                                 focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      tabIndex={-1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                                 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]
                                 transition"
                      title={showPass ? "Şifreyi gizle" : "Şifreyi göster"}
                    >
                      {showPass ? <HiOutlineEyeSlash className="text-[15px]" /> : <HiOutlineEye className="text-[15px]" />}
                    </button>
                  </div>
                </div>

                {/* Giriş butonu */}
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                    ${loading
                      ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                      : isAdmin
                        ? "bg-amber-500 hover:bg-amber-400 text-white shadow-md shadow-amber-500/30 cursor-pointer"
                        : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                    }`}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Giriş yapılıyor…
                    </span>
                  ) : "Giriş Yap"}
                </button>

                {!isAdmin && (
                  <button
                    type="button"
                    onClick={goToRegister}
                    className="text-[12px] font-semibold text-[var(--accent)] hover:underline transition cursor-pointer text-center mt-1"
                  >
                    Hesabın yok mu? Kayıt Ol
                  </button>
                )}
              </div>
            ) : mode === "forgot" ? (
              <div className="flex flex-col gap-3">
                {forgotMessage ? (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[13px]">
                    <span className="font-medium leading-snug">{forgotMessage}</span>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                      Kullanıcı Adı
                    </label>
                    <div className="relative">
                      <HiOutlineUser className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                      <input
                        type="text"
                        value={forgotUsername}
                        onChange={(e) => setForgotUsername(e.target.value)}
                        placeholder="kullanici.adi"
                        autoComplete="username"
                        autoFocus
                        className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                   pl-10 pr-3 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                   placeholder:text-[var(--text-muted)] placeholder:font-sans
                                   focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                      />
                    </div>
                  </div>
                )}

                {!forgotMessage && (
                  <button
                    type="submit"
                    disabled={forgotLoading || !forgotUsername}
                    className={`w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                      ${forgotLoading || !forgotUsername
                        ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                        : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                      }`}
                  >
                    {forgotLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Gönderiliyor…
                      </span>
                    ) : "Sıfırlama Linki Gönder"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={goToLogin}
                  className="text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition cursor-pointer text-center mt-1"
                >
                  ← Girişe dön
                </button>
              </div>
            ) : mode === "register" ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Ad Soyad
                  </label>
                  <input
                    type="text"
                    value={registerFullName}
                    onChange={(e) => setRegisterFullName(e.target.value)}
                    placeholder="Ad Soyad"
                    autoComplete="name"
                    autoFocus
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-3 py-2.5 rounded-lg text-[14px] outline-none
                               placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Kullanıcı Adı
                  </label>
                  <input
                    type="text"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    placeholder="kullanici_adi"
                    autoComplete="username"
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-3 py-2.5 rounded-lg text-[14px] font-mono outline-none
                               placeholder:text-[var(--text-muted)] placeholder:font-sans
                               focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    E-posta <span className="normal-case font-normal tracking-normal">(doğrulama kodu için gerekli)</span>
                  </label>
                  <input
                    type="email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    placeholder="ornek@mail.com"
                    autoComplete="email"
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-3 py-2.5 rounded-lg text-[14px] outline-none
                               placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Şifre
                  </label>
                  <div className="relative">
                    <input
                      type={showRegisterPassword ? "text" : "password"}
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder="En az 6 karakter, A/a ve özel karakter"
                      autoComplete="new-password"
                      className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 px-3 pr-10 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                 placeholder:text-[var(--text-muted)] placeholder:font-sans
                                 focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegisterPassword((s) => !s)}
                      tabIndex={-1}
                      title={showRegisterPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                                 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                    >
                      {showRegisterPassword ? <HiOutlineEyeSlash className="text-[15px]" /> : <HiOutlineEye className="text-[15px]" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Şifre Tekrar
                  </label>
                  <div className="relative">
                    <input
                      type={showRegisterPassword2 ? "text" : "password"}
                      value={registerPassword2}
                      onChange={(e) => setRegisterPassword2(e.target.value)}
                      placeholder="Şifreyi tekrar yazın"
                      autoComplete="new-password"
                      className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 px-3 pr-10 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                 placeholder:text-[var(--text-muted)] placeholder:font-sans
                                 focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegisterPassword2((s) => !s)}
                      tabIndex={-1}
                      title={showRegisterPassword2 ? "Şifreyi gizle" : "Şifreyi göster"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md
                                 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                    >
                      {showRegisterPassword2 ? <HiOutlineEyeSlash className="text-[15px]" /> : <HiOutlineEye className="text-[15px]" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={registerLoading}
                  className={`w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                    ${registerLoading
                      ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                      : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                    }`}
                >
                  {registerLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Kaydediliyor…
                    </span>
                  ) : "Kayıt Ol"}
                </button>

                <button
                  type="button"
                  onClick={goToLogin}
                  className="text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition cursor-pointer text-center mt-1"
                >
                  ← Girişe dön
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {verificationMessage && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[13px]">
                    <span className="font-medium leading-snug">{verificationMessage}</span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Kullanıcı Adı
                  </label>
                  <input
                    type="text"
                    value={registerUsername}
                    readOnly
                    className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-secondary)]
                               px-3 py-2.5 rounded-lg text-[14px] font-mono outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Doğrulama Kodu
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={registerCode}
                    onChange={(e) => setRegisterCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    autoFocus
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-3 py-2.5 rounded-lg text-[20px] font-mono tracking-[0.3em] text-center outline-none
                               placeholder:text-[var(--text-muted)] placeholder:tracking-normal
                               focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifyLoading || registerCode.length !== 6}
                  className={`w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                    ${verifyLoading || registerCode.length !== 6
                      ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                      : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                    }`}
                >
                  {verifyLoading ? "Doğrulanıyor…" : "Kodu Doğrula"}
                </button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendLoading}
                  className="text-[12px] font-semibold text-[var(--accent)] hover:underline transition cursor-pointer text-center mt-1 disabled:opacity-50"
                >
                  {resendLoading ? "Kod gönderiliyor…" : "Kodu tekrar gönder"}
                </button>

                <button
                  type="button"
                  onClick={goToLogin}
                  className="text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)] transition cursor-pointer text-center"
                >
                  ← Girişe dön
                </button>
              </div>
            )}

            {/* Alt bilgi */}
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] tracking-wide">
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isAdmin ? "bg-amber-400" : "bg-[var(--accent)]"}`} />
                {isAdmin ? "admin.bluetech" : "dashboard.bluetech"}
              </span>
              <span>v1.0</span>
            </div>
          </div>

          {/* Alt footer */}
          <div className="text-center mt-5 text-[11px] text-[var(--text-muted)] font-mono tracking-wide">
            © bluetech · EV Charge Controller
          </div>
        </form>
      </main>
    </div>
  );
}
