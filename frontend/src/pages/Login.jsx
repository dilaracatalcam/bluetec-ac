import { useState, useEffect } from "react";
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

  // Tema — Home.jsx ile aynı localStorage anahtarı, aynı class sistemi
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try { return window.localStorage?.getItem("bluetech-theme") || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    try { window.localStorage?.setItem("bluetech-theme", theme); } catch {}
  }, [theme]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, page }),
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
  const title = isAdmin ? "Admin Panel Girişi" : "Dashboard Girişi";
  const subtitle = isAdmin
    ? "Yönetici yetkisi gerektirir"
    : "İzleme ve temel kontrol paneli";

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] font-body relative overflow-hidden">
      {/* Google Fonts + CSS Variables — Home.jsx ile aynı sistem */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

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
          --accent: #06b6d4;
          --accent-soft: rgba(6, 182, 212, 0.10);
          --accent-soft-hover: rgba(6, 182, 212, 0.18);
          --accent-border: rgba(6, 182, 212, 0.28);
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
          --accent: #0891b2;
          --accent-soft: rgba(8, 145, 178, 0.08);
          --accent-soft-hover: rgba(8, 145, 178, 0.14);
          --accent-border: rgba(8, 145, 178, 0.28);
        }
        .font-display { font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; font-feature-settings: 'cv11','ss01'; }
        .font-body    { font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif; }
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
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor">
              <path d="M7 2v11h3v9l7-12h-4l3-8z" />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[14px] font-bold tracking-tight text-[var(--text-primary)] font-display">
              bluetech
            </span>
            <span className="text-[9px] font-medium tracking-[0.15em] uppercase text-[var(--text-muted)] mt-0.5">
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
                     transition text-[11px] font-semibold tracking-wide uppercase"
        >
          {theme === "dark" ? <HiOutlineSun className="text-[14px]" /> : <HiOutlineMoon className="text-[14px]" />}
          <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </header>

      {/* Center card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-8">
        <form onSubmit={handleSubmit}
          className="w-full max-w-sm fade-up">

          {/* Rol etiketi */}
          <div className="flex items-center justify-center mb-5">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold tracking-[0.15em] uppercase
              ${isAdmin
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-[var(--accent-soft)] border-[var(--accent-border)] text-[var(--accent)]"
              }`}>
              <HiOutlineShieldCheck className="text-[12px]" />
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
              <p className="text-[12px] text-[var(--text-muted)] mt-1.5">
                {subtitle}
              </p>
            </div>

            {/* Hata kutusu */}
            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[12px]">
                <HiOutlineExclamationCircle className="text-[14px] shrink-0 mt-[1px]" />
                <span className="font-medium leading-snug">{error}</span>
              </div>
            )}

            {/* Form alanları */}
            <div className="flex flex-col gap-3">
              {/* Kullanıcı adı */}
              <div>
                <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                  Kullanıcı Adı
                </label>
                <div className="relative">
                  <HiOutlineUser className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="kullanici.adi"
                    autoComplete="username"
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               pl-10 pr-3 py-2.5 rounded-lg text-[13px] font-mono outline-none
                               placeholder:text-[var(--text-muted)] placeholder:font-sans
                               focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                  />
                </div>
              </div>

              {/* Şifre */}
              <div>
                <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                  Şifre
                </label>
                <div className="relative">
                  <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                  <input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
                    className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               pl-10 pr-10 py-2.5 rounded-lg text-[13px] font-mono outline-none
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
                disabled={loading || !username || !password}
                className={`w-full py-2.5 rounded-lg text-[13px] font-bold tracking-wide uppercase transition mt-2
                  ${loading || !username || !password
                    ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                    : isAdmin
                      ? "bg-amber-500 hover:bg-amber-400 text-white shadow-md shadow-amber-500/30 cursor-pointer"
                      : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-cyan-500/30 cursor-pointer"
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

            {/* Alt bilgi */}
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] tracking-wide">
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isAdmin ? "bg-amber-400" : "bg-[var(--accent)]"}`} />
                {isAdmin ? "admin.bluetech" : "dashboard.bluetech"}
              </span>
              <span>v1.0</span>
            </div>
          </div>

          {/* Alt footer */}
          <div className="text-center mt-5 text-[10px] text-[var(--text-muted)] font-mono tracking-wide">
            © bluetech · EV Charge Controller
          </div>
        </form>
      </main>
    </div>
  );
}