export default function MetricCard({ icon, label, value = "——", unit = "", valueColor }) {
  const colorMap = {
    green: "text-emerald-400",
    red: "text-red-400",
    yellow: "text-amber-400",
    blue: "text-sky-400",
  };

  return (
    <div className="bg-[#0c1829] border border-slate-700/40 rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-[13px] text-slate-500">{icon}</span>}
        <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold tracking-tight ${colorMap[valueColor] || "text-slate-100"}`}>
          {value || "——"}
        </span>
        {unit && <span className="text-[11px] font-semibold text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}