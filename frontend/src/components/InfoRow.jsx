export default function InfoRow({ icon, label, value = "—", valueColor, last = false }) {
  const colorMap = {
    green: "text-emerald-400",
    red: "text-red-400",
    yellow: "text-amber-400",
    blue: "text-sky-400",
  };

  return (
    <div className={`flex items-center justify-between py-[7px] ${!last ? "border-b border-slate-700/25" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[13px] text-slate-500">{icon}</span>}
        <span className="text-[12px] text-slate-500 font-medium">{label}:</span>
      </div>
      <span className={`text-[12px] font-semibold truncate max-w-[55%] text-right ${colorMap[valueColor] || "text-slate-200"}`}>
        {value || "—"}
      </span>
    </div>
  );
}