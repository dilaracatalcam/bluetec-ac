import { HiOutlineArrowPath, HiOutlineExclamationCircle } from "react-icons/hi2";

export default function InfoRow({ icon, label, value = "—", valueColor, onRead, disabled = false, failed = false, last = false }) {
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
        {failed && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium" title="Değer okunamadı">
            <HiOutlineExclamationCircle className="text-[11px]" />
            okunamadı
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[12px] font-semibold text-right break-all ${failed ? "text-amber-400/60" : (colorMap[valueColor] || "text-slate-200")}`}>
          {value || "—"}
        </span>
        {onRead && (
          <button
            onClick={onRead}
            disabled={disabled}
            title="Güncel değeri oku"
            className={`p-[4px] rounded-md border transition shrink-0
              ${disabled
                ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                : failed
                  ? "bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30 cursor-pointer"
                  : "bg-emerald-600/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-600/30 cursor-pointer"
              }`}
          >
            <HiOutlineArrowPath className="text-[12px]" />
          </button>
        )}
      </div>
    </div>
  );
}