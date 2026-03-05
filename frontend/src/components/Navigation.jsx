import { useState } from "react";
import { HiOutlineMenu, HiOutlineX } from "react-icons/hi";
import { HiOutlineArrowRightOnRectangle } from "react-icons/hi2";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "panel", label: "Panel" },
];

export default function Navigation({ activePage = "dashboard", onNavigate, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleClick = (key) => {
    onNavigate?.(key);
    setMenuOpen(false);
  };

  return (
    <header className="w-full">
      <nav className="flex items-center justify-between px-6 py-3 bg-[#0a1628] border-b border-slate-700/30">
        {/* Logo */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => handleClick("dashboard")}>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-[11px] font-black">B</span>
          </div>
          <span className="text-[15px] font-bold tracking-tight">
            <span className="text-sky-400">blue</span>
            <span className="text-slate-300">tech</span>
          </span>
        </div>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => handleClick(item.key)}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer
                ${activePage === item.key
                  ? "text-sky-400 bg-sky-500/10"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
            >
              {item.label}
            </button>
          ))}

          {/* Çıkış butonu */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500
                         px-3 py-1.5 rounded-md hover:text-red-400 hover:bg-red-500/10
                         transition-colors cursor-pointer ml-2"
              title="Çıkış Yap"
            >
              <HiOutlineArrowRightOnRectangle className="text-[14px]" />
              Çıkış
            </button>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-xl text-slate-400 hover:text-white transition"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <HiOutlineX /> : <HiOutlineMenu />}
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-[#0a1628] border-b border-slate-700/30 px-6 py-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => handleClick(item.key)}
              className={`block w-full text-left text-[12px] font-medium py-2 transition-colors
                ${activePage === item.key
                  ? "text-sky-400"
                  : "text-slate-500 hover:text-slate-200"
                }`}
            >
              {item.label}
            </button>
          ))}
          {onLogout && (
            <button
              onClick={onLogout}
              className="block w-full text-left text-[12px] font-medium py-2 text-red-400
                         hover:text-red-300 transition-colors"
            >
              Çıkış Yap
            </button>
          )}
        </div>
      )}
    </header>
  );
}