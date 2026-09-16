import { useState, useEffect } from "react";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

const LS_KEYS = {
  token: "bluetech-token",
  role:  "bluetech-role",
  page:  "bluetech-page",
};
const lsGet = (k, fallback = null) => {
  try { return window.localStorage?.getItem(k) ?? fallback; }
  catch { return fallback; }
};
const lsSet = (k, v) => {
  try {
    if (v === null || v === undefined) window.localStorage?.removeItem(k);
    else window.localStorage?.setItem(k, v);
  } catch {}
};

export default function App() {
  const [page, setPage]   = useState(() => lsGet(LS_KEYS.page, "dashboard"));
  const [token, setToken] = useState(() => lsGet(LS_KEYS.token));
  const [role, setRole]   = useState(() => lsGet(LS_KEYS.role));

  useEffect(() => { lsSet(LS_KEYS.page, page); }, [page]);
  useEffect(() => { lsSet(LS_KEYS.token, token); }, [token]);
  useEffect(() => { lsSet(LS_KEYS.role, role); }, [role]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me", {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (!r.ok && !cancelled) {
          setToken(null);
          setRole(null);
          setPage("dashboard");
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (newToken, newRole) => {
    setToken(newToken);
    setRole(newRole);
    if (newRole === "operator") setPage("dashboard");
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch("/api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        });
      } catch {}
    }
    setToken(null);
    setRole(null);
    setPage("dashboard");
  };

  const handleNavigate = (newPage) => {
    setPage(newPage);
  };

  // E-postadaki şifre sıfırlama linki (?resetToken=...) — oturum durumundan
  // bağımsız, her zaman öncelikli. Link tıklanınca Login/Home yerine bu görünür.
  // "Girişe Dön" sadece URL'yi (history.replaceState ile) temizlerse React bunu
  // fark edip yeniden render etmez — resetTokenDone state'i bu yeniden render'ı tetikler.
  const [resetTokenDone, setResetTokenDone] = useState(false);
  const resetToken = resetTokenDone ? null : (() => {
    try { return new URLSearchParams(window.location.search).get("resetToken"); }
    catch { return null; }
  })();
  const clearResetToken = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("resetToken");
    window.history.replaceState({}, "", url.toString());
    setResetTokenDone(true);
  };
  if (resetToken) {
    return <ResetPassword token={resetToken} onDone={clearResetToken} />;
  }

  // Token yoksa daima dashboard login göster — localStorage'daki page'i yoksay
  if (!token) {
    return <Login page="dashboard" onLogin={handleLogin} />;
  }

  if (page === "panel" && role === "operator") {
    setPage("dashboard");
    return null;
  }

  return (
    <Home
      token={token}
      isAdmin={page === "panel"}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
      role={role}
    />
  );
}
