import { useState } from "react";

export default function EditableRow({ icon, label, id, value = "—", setOk = false, disabled = false, onSet, last = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    if (disabled) return;
    setDraft(value === "——" ? "" : (value ?? ""));
    setEditing(true);
  };

  const save = () => {
    onSet?.(id, draft);
    setEditing(false);
    setDraft("");
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  return (
    <div className={`flex items-center justify-between gap-2 py-[7px] ${!last ? "border-b border-slate-700/25" : ""}`}>
      <div className="flex items-center gap-2 shrink-0">
        {icon && <span className="text-[13px] text-slate-500">{icon}</span>}
        <span className="text-[12px] text-slate-500 font-medium">{label}</span>
      </div>

      <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
        {!editing ? (
          <>
            <span className="text-[12px] text-slate-200 font-semibold truncate max-w-[160px]">
              {value || "—"}
            </span>
            {setOk && <span className="text-emerald-400 text-[10px] font-bold">✓</span>}
            <button
              onClick={startEdit}
              disabled={disabled}
              className={`text-[10px] font-semibold px-2.5 py-[3px] rounded-md border transition shrink-0
                ${disabled
                  ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                  : "bg-slate-800/50 text-slate-400 border-slate-600/40 hover:text-white hover:border-slate-500 cursor-pointer"
                }`}
            >
              Edit
            </button>
          </>
        ) : (
          <>
            <input
              className="w-full max-w-[160px] bg-slate-800/80 border border-slate-600/50 text-slate-100
                         px-2.5 py-1 rounded-md text-[12px] outline-none
                         focus:border-sky-500/60 transition"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Değer girin"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
            />
            <button onClick={cancel}
              className="text-[10px] font-semibold px-2 py-[3px] rounded-md
                         bg-slate-800/50 text-slate-500 border border-slate-600/30
                         hover:text-slate-300 transition cursor-pointer shrink-0">
              ✕
            </button>
            <button onClick={save} disabled={disabled}
              className={`text-[10px] font-semibold px-2.5 py-[3px] rounded-md border transition shrink-0
                ${disabled
                  ? "bg-slate-800/30 text-slate-600 border-slate-700/30 cursor-not-allowed"
                  : "bg-sky-600/80 text-white border-sky-500/50 hover:bg-sky-600 cursor-pointer"
                }`}>
              Kaydet
            </button>
          </>
        )}
      </div>
    </div>
  );
}