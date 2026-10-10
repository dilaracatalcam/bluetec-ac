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
  const [mode, setMode] = useState("login"); // "login" | "forgot"
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  const goToForgot = () => {
    setError("");
    setForgotMessage("");
    setForgotUsername(username);
    setMode("forgot");
  };
  const goToLogin = () => {
    setError("");
    setForgotMessage("");
    setMode("login");
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
    : isAdmin ? "Admin Panel Girişi" : "Dashboard Girişi";
  const subtitle = mode === "forgot"
    ? "Kullanıcı adınızı girin, size bir sıfırlama linki gönderelim"
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
        <form onSubmit={mode === "forgot" ? handleForgotSubmit : handleSubmit}
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
              </div>
            ) : (
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