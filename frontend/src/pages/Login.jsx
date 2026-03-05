import { useState } from "react";
import { HiOutlineLockClosed, HiOutlineUser, HiOutlineExclamationCircle } from "react-icons/hi2";

export default function Login({ page, onLogin }) {
  // page = "dashboard" veya "admin"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Backend'e kullanıcı adı + şifre + sayfa bilgisi gönder
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, page }),
      });

      const data = await r.json();

      if (!r.ok) {
        // Backend hata döndü (yanlış şifre vs.)
        setError(data.error || "Giriş başarısız");
        return;
      }

      // Başarılı — token'ı üst component'e gönder
      onLogin(data.token, data.role);

    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  };

  const titles = {
    dashboard: "Dashboard Girişi",
    admin: "Admin Panel Girişi",
  };

  const accents = {
    dashboard: { border: "border-sky-500/30", bg: "bg-sky-600", hover: "hover:bg-sky-500", ring: "focus:border-sky-500/50" },
    admin: { border: "border-amber-500/30", bg: "bg-amber-600", hover: "hover:bg-amber-500", ring: "focus:border-amber-500/50" },
  };
  const a = accents[page] || accents.dashboard;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070e1a] px-4">
      <div className={`w-full max-w-sm bg-[#0c1829] rounded-2xl border ${a.border} p-8`}>

        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-[12px] font-black">B</span>
          </div>
          <span className="text-[17px] font-bold tracking-tight">
            <span className="text-sky-400">blue</span>
            <span className="text-slate-300">tech</span>
          </span>
        </div>

        {/* Title */}
        <h2 className="text-center text-[14px] font-bold text-slate-300 mb-6">
          {titles[page] || "Giriş"}
        </h2>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-[12px]">
            <HiOutlineExclamationCircle className="text-[14px] shrink-0" />
            {error}
          </div>
        )}

        {/* Form */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <HiOutlineUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[14px]" />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Kullanıcı adı"
              className={`w-full bg-slate-800/60 border border-slate-700/50 text-slate-200
                         pl-9 pr-3 py-2.5 rounded-lg text-[13px] outline-none
                         ${a.ring} transition`}
            />
          </div>

          <div className="relative">
            <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[14px]" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)}
              className={`w-full bg-slate-800/60 border border-slate-700/50 text-slate-200
                         pl-9 pr-3 py-2.5 rounded-lg text-[13px] outline-none
                         ${a.ring} transition`}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !username || !password}
            className={`w-full py-2.5 rounded-lg text-[13px] font-bold transition cursor-pointer mt-1
              ${loading || !username || !password
                ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                : `${a.bg} ${a.hover} text-white`
              }`}
          >
            {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
          </button>
        </div>
      </div>
    </div>
  );
}