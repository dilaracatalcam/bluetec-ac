export default function Panel({ icon, title, children, className = "" }) {
  return (
    <div className={`bg-[#0c1829] border border-slate-700/40 rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/30 bg-[#0f1f35]">
        {icon && <span className="text-[13px] text-sky-400/70">{icon}</span>}
        <h3 className="text-[12px] font-bold text-slate-300 tracking-widest uppercase">{title}</h3>
      </div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}