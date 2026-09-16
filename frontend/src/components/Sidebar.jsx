import { HiOutlineArrowRightOnRectangle, HiOutlineSun, HiOutlineMoon, HiOutlineXMark, HiOutlineUserCircle } from "react-icons/hi2";

/* ── Sidebar ──
   Masaüstünde sabit (260px), mobilde slide-in overlay.
   Section listesi dışarıdan gelir — Home.jsx karar verir.
   activePage → "dashboard" | "panel" (Navigation'daki gibi)
   activeSection → hangi section görünür (örn. "ocpp-wifi")
*/
export default function Sidebar({
  sections = [],
  activeSection,
  onSectionChange,
  activePage = "dashboard",
  onNavigate,
  onLogout,
  theme = "dark",
  onToggleTheme,
  mobileOpen = false,
  onCloseMobile,
  currentUser = null,
  onOpenAccount,
}) {
  const handleClick = (key) => {
    onSectionChange?.(key);
    onCloseMobile?.();
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          aria-label="Close sidebar"
          onClick={onCloseMobile}
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      )}

      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-40 h-screen w-[260px]
          flex flex-col shrink-0
          bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)]
          transition-transform duration-300
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Brand */}
        <div className="h-[60px] flex items-center justify-between px-5 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col leading-none gap-1">
              <img
                src={theme === "dark" ? "/brand/bluetech-logo-white.png" : "/brand/bluetech-logo-dark.png"}
                alt="Bluetech"
                className="h-4 w-auto"
              />
              <span className="text-[9px] font-medium tracking-[0.15em] uppercase text-[var(--text-muted)]">
                EV Charge Panel
              </span>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
          >
            <HiOutlineXMark className="text-lg" />
          </button>
        </div>

        {/* Mode Switch (Dashboard / Panel) */}
        <div className="px-3 pt-3 pb-2">
          <div className="relative p-[3px] rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex">
            <div
              className={`absolute top-[3px] bottom-[3px] rounded-md bg-[var(--accent)] shadow-sm shadow-cyan-500/20 transition-all duration-300 ease-out
                ${activePage === "dashboard" ? "left-[3px] right-[50%]" : "left-[50%] right-[3px]"}`}
            />
            <button
              onClick={() => onNavigate?.("dashboard")}
              className={`relative flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-colors z-10
                ${activePage === "dashboard" ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => onNavigate?.("panel")}
              className={`relative flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-colors z-10
                ${activePage === "panel" ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
            >
              Panel
            </button>
          </div>
        </div>

        {/* Section List */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 custom-scroll">
          <div className="px-3 pb-2 pt-1 text-[9px] font-bold tracking-[0.2em] uppercase text-[var(--text-muted)]">
            Bölümler
          </div>
          <ul className="space-y-0.5">
            {sections.map((s) => {
              const isActive = activeSection === s.key;
              return (
                <li key={s.key}>
                  <button
                    onClick={() => handleClick(s.key)}
                    className={`group relative w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-all
                      ${isActive
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                  >
                    {/* Active indicator bar */}
                    <span
                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all
                        ${isActive ? "h-5 bg-[var(--accent)]" : "h-0 bg-transparent"}`}
                    />
                    <span className={`text-[15px] shrink-0 transition-colors
                      ${isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}`}>
                      {s.icon}
                    </span>
                    <span className="text-[12px] font-medium flex-1 truncate">{s.label}</span>
                    {s.badge && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider
                        ${isActive
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
                        }`}>
                        {s.badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Current user info */}
        {currentUser && (
          <div className="border-t border-[var(--border-subtle)] px-3 py-3">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0
                ${currentUser.role === "superadmin" ? "bg-violet-500/15 text-violet-400 border border-violet-500/30" :
                  currentUser.role === "admin"      ? "bg-amber-500/15 text-amber-500 border border-amber-500/30" :
                                                      "bg-sky-500/15 text-sky-500 border border-sky-500/30"}`}>
                {(currentUser.fullName || currentUser.username || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
                  {currentUser.fullName || currentUser.username}
                </div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-[var(--text-muted)] mt-0.5">
                  {currentUser.role === "superadmin" ? "Superadmin" :
                   currentUser.role === "admin" ? "Admin" : "Operator"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="border-t border-[var(--border-subtle)] px-3 py-3 space-y-1">
          {onOpenAccount && (
            <button
              onClick={onOpenAccount}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] font-medium
                         text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]
                         transition-colors"
            >
              <HiOutlineUserCircle className="text-[15px]" />
              <span className="flex-1 text-left">Hesabım</span>
              {currentUser && !currentUser.email && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="E-posta tanımlı değil" />
              )}
            </button>
          )}

          <button
            onClick={onToggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] font-medium
                       text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]
                       transition-colors"
          >
            <span className="text-[15px]">
              {theme === "dark" ? <HiOutlineSun /> : <HiOutlineMoon />}
            </span>
            <span className="flex-1 text-left">
              {theme === "dark" ? "Açık Tema" : "Koyu Tema"}
            </span>
            <span className="text-[9px] font-bold tracking-wider text-[var(--text-muted)]">
              {theme === "dark" ? "LIGHT" : "DARK"}
            </span>
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] font-medium
                         text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-400
                         transition-colors"
            >
              <HiOutlineArrowRightOnRectangle className="text-[15px]" />
              <span className="flex-1 text-left">Çıkış Yap</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}