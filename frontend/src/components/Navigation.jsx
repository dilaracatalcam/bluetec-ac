import { useState } from "react";
import { HiOutlineMenu, HiOutlineX } from "react-icons/hi";

export default function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="w-full">
      <nav className="flex items-center justify-between px-6 py-3 bg-[#0a1628] border-b border-slate-700/30">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-[11px] font-black">B</span>
          </div>
          <span className="text-[15px] font-bold tracking-tight">
            <span className="text-sky-400">blue</span>
            <span className="text-slate-300">tech</span>
          </span>
        </div>

        {/* Desktop menu */}
        <ul className="hidden md:flex items-center gap-1">
          {["Dashboard", "Cihazlar", "Ayarlar"].map((item) => (
            <li key={item}>
              <a
                href="#"
                className="text-[12px] text-slate-500 font-medium px-3 py-1.5 rounded-md
                           hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              >
                {item}
              </a>
            </li>
          ))}
        </ul>

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
          {["Dashboard", "Cihazlar", "Ayarlar"].map((item) => (
            <a
              key={item}
              href="#"
              className="block text-[12px] text-slate-500 font-medium py-2
                         hover:text-slate-200 transition-colors"
            >
              {item}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}