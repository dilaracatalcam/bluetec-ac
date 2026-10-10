export default function ActionButton({ icon, label, badge = "Kapalı", color = "red", disabled = true, onClick }) {
  const badgeColors = {
    green: "bg-emerald-500/20 text-emerald-500",
    red: "bg-red-500/20 text-red-500",
    yellow: "bg-amber-500/20 text-amber-500",
    blue: "bg-sky-500/20 text-[var(--accent)]",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-3.5 py-2.5 rounded-lg
        bg-[var(--bg-subtle)] border border-[var(--border-subtle)]
        transition-all duration-150
        ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--bg-hover)] cursor-pointer"}
      `}
    >
      {icon && <span className="text-[14px] text-[var(--text-secondary)] shrink-0">{icon}</span>}
      <span className="text-[13px] text-[var(--text-secondary)] font-medium flex-1 text-left">{label}</span>
      <span className={`text-[11px] font-bold px-2 py-[2px] rounded-full ${badgeColors[color] || badgeColors.red}`}>
        {badge}
      </span>
    </button>
  );
}