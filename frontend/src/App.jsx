import { useState } from "react";
import Home from "./pages/Home.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  const [page, setPage] = useState("dashboard");

  if (page === "admin") {
    return <Admin onNavigate={setPage} />;
  }

  return <Home onNavigate={setPage} />;
}