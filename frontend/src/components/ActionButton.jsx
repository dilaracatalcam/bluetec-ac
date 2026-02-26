export default function ActionButton({ icon, label, badge = "Kapalı", color = "red", disabled = true, onClick }) {
  const badgeColors = {
    green: "bg-emerald-500/20 text-emerald-400",
    red: "bg-red-500/20 text-red-400",
    yellow: "bg-amber-500/20 text-amber-400",
    blue: "bg-sky-500/20 text-sky-400",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-3 py-[7px] rounded-lg
        bg-slate-800/30 border border-slate-700/30
        transition-all duration-150
        ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-800/60 cursor-pointer"}
      `}
    >
      {icon && <span className="text-[13px] text-slate-400 shrink-0">{icon}</span>}
      <span className="text-[11px] text-slate-400 font-medium flex-1 text-left">{label}</span>
      <span className={`text-[10px] font-bold px-2 py-[2px] rounded-full ${badgeColors[color] || badgeColors.red}`}>
        {badge}
      </span>
    </button>
  );
}