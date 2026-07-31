import { useState, useEffect } from "react";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";

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
