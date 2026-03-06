import { useState } from "react";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";

/*
  Yetkilendirme mantığı:
  - Dashboard'a giriş → dashToken alınır
  - Panel'e giriş → panelToken alınır
  - Her iki sayfaya da giriş yapılabilir
  - Sayfa değiştirildiğinde o sayfanın token'ı yoksa login gösterilir
  
  ESP bağlantı durumu:
  - Home component'ı key={page} OLMADAN render ediliyor
  - Bu sayede sayfa değişince component yeniden oluşmaz
  - isAdmin prop'u değişir ama state (isConnected, mac, vs.) korunur
  
  Token seçimi:
  - Panel'deyken panelToken kullanılır
  - Dashboard'dayken dashToken kullanılır
  - Ama ESP bağlantısı ikisi arasında ortaktır
*/

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [dashToken, setDashToken] = useState(null);
  const [panelToken, setPanelToken] = useState(null);

  // Aktif sayfanın token'ı
  const currentToken = page === "panel" ? panelToken : dashToken;

  // Login
  const handleLogin = (token, role) => {
    if (role === "admin") setPanelToken(token);
    else setDashToken(token);
  };

  // Logout — sadece aktif sayfanın token'ını sil
  const handleLogout = async () => {
    const token = currentToken;
    if (token) {
      try {
        await fetch("/api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        });
      } catch {}
    }
    if (page === "panel") setPanelToken(null);
    else setDashToken(null);
  };

  // Navigasyon
  const handleNavigate = (newPage) => {
    setPage(newPage);
  };

  // Token yoksa login göster
  if (!currentToken) {
    return <Login page={page === "panel" ? "admin" : "dashboard"} onLogin={handleLogin} />;
  }

  // Home component'ı her zaman aynı instance — key YOK
  // isAdmin değişince sadece render güncellenir, state korunur
  // token da aktif sayfaya göre geçiriliyor
  return (
    <Home
      token={currentToken}
      isAdmin={page === "panel"}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
    />
  );
}