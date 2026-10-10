import { HiOutlineArrowPath, HiOutlineExclamationCircle } from "react-icons/hi2";

export default function InfoRow({ icon, label, value = "—", valueColor, onRead, disabled = false, failed = false, last = false }) {
  const colorMap = {
    green: "text-emerald-500",
    red: "text-red-500",
    yellow: "text-amber-500",
    blue: "text-[var(--accent)]",
  };

  return (
    <div className={`flex items-center justify-between py-2.5 min-h-[50px] ${!last ? "border-b border-[var(--border-subtle)]" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[14px] text-[var(--text-muted)]">{icon}</span>}
        <span className="text-[14px] text-[var(--text-secondary)] font-medium">{label}</span>
        {failed && (
          <span className="flex items-center gap-1 text-[11px] text-amber-500 font-medium" title="Değer okunamadı">
            <HiOutlineExclamationCircle className="text-[12px]" />
            okunamadı
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[14px] font-semibold text-right break-all ${failed ? "text-amber-500/60" : (colorMap[valueColor] || "text-[var(--text-primary)]")}`}>
          {value || "—"}
        </span>
        {onRead && (
          <button
            onClick={onRead}
            disabled={disabled}
            title="Güncel değeri oku"
            className={`p-1.5 rounded-lg border transition shrink-0
              ${disabled
                ? "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                : failed
                  ? "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer"
                  : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
              }`}
          >
            <HiOutlineArrowPath className="text-[13px]" />
          </button>
        )}
      </div>
    </div>
  );
}