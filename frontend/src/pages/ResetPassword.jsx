import { useState, useEffect } from "react";
import {
  HiOutlineLockClosed, HiOutlineExclamationCircle,
  HiOutlineEye, HiOutlineEyeSlash, HiOutlineSun, HiOutlineMoon,
  HiOutlineCheckCircle,
} from "react-icons/hi2";
import { passwordPolicyError, PASSWORD_HINT } from "../lib/passwordPolicy.js";

/* ── Şifre Sıfırlama Sayfası ──
   Login.jsx'teki "Şifremi unuttum" akışının devamı — e-postadaki
   linkten (?resetToken=...) buraya düşülür. Aynı tema/görsel sistemi
   Login.jsx ile birebir aynı (App.jsx bu sayfayı Login/Home yerine
   bağımsız render eder, o yüzden tema kurulumu burada da tekrarlanır).
   Backend API: POST /api/reset-password  body: { token, newPassword }
*/
export default function ResetPassword({ token, onDone }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

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

    const pwError = passwordPolicyError(newPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Şifreler eşleşmiyor");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(data.error || "Şifre sıfırlanamadı");
        return;
      }

      setDone(true);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)] font-body relative overflow-hidden">
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

        .login-grid-bg {
          background-image:
            linear-gradient(var(--border-subtle) 1px, transparent 1px),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
        }

        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fade-up 0.5s ease-out both; }
      `}</style>

      <div className="absolute inset-0 login-grid-bg pointer-events-none" />
      <div
        className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full pointer-events-none opacity-40"
        style={{ background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-40 -left-40 w-[400px] h-[400px] rounded-full pointer-events-none opacity-30"
        style={{ background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)" }}
      />

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

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 pb-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm fade-up">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 sm:p-8 shadow-xl shadow-black/20 backdrop-blur-sm">

            <div className="text-center mb-6">
              <h1 className="text-[20px] sm:text-[22px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
                Yeni Şifre Belirle
              </h1>
              <p className="text-[13px] text-[var(--text-muted)] mt-1.5">
                Hesabınız için yeni bir şifre girin
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[13px]">
                <HiOutlineExclamationCircle className="text-[14px] shrink-0 mt-[1px]" />
                <span className="font-medium leading-snug">{error}</span>
              </div>
            )}

            {done ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[13px]">
                  <HiOutlineCheckCircle className="text-[16px] shrink-0" />
                  <span className="font-medium leading-snug">Şifreniz değiştirildi. Şimdi yeni şifrenizle giriş yapabilirsiniz.</span>
                </div>
                <button
                  type="button"
                  onClick={onDone}
                  className="w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                             bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                >
                  Girişe Dön
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Yeni Şifre
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] mb-1.5 ml-0.5">{PASSWORD_HINT}</p>
                  <div className="relative">
                    <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Yeni şifre"
                      autoComplete="new-password"
                      autoFocus
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

                <div>
                  <label className="block text-[11px] font-bold tracking-[0.15em] uppercase text-[var(--text-muted)] mb-1.5 ml-0.5">
                    Yeni Şifre (Tekrar)
                  </label>
                  <div className="relative">
                    <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[15px] pointer-events-none" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Şifreyi tekrar girin"
                      autoComplete="new-password"
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
                      className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 pl-10 pr-3 py-2.5 rounded-lg text-[14px] font-mono outline-none
                                 placeholder:text-[var(--text-muted)] placeholder:font-sans
                                 focus:border-[var(--accent)] focus:bg-[var(--bg-sunken)] transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !newPassword || !confirmPassword}
                  className={`w-full py-2.5 rounded-lg text-[14px] font-bold transition mt-2
                    ${loading || !newPassword || !confirmPassword
                      ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
                      : "bg-[var(--accent)] hover:brightness-110 text-white shadow-md shadow-blue-500/30 cursor-pointer"
                    }`}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Kaydediliyor…
                    </span>
                  ) : "Şifreyi Kaydet"}
                </button>
              </div>
            )}
          </div>

          <div className="text-center mt-5 text-[11px] text-[var(--text-muted)] font-mono tracking-wide">
            © bluetech · EV Charge Controller
          </div>
        </form>
      </main>
    </div>
  );
}
