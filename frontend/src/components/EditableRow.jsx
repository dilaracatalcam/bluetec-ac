import { useState, useRef } from "react";
import { HiOutlineArrowPath, HiOutlineExclamationCircle, HiOutlinePencilSquare } from "react-icons/hi2";

/* ── Hex çevrim yardımcıları ──
   ESP "0x4DB748" formatında bekliyor.
   HTML color picker "#4db748" formatında döner.
*/
export function espHexToHtml(v) {
  if (!v) return "#000000";
  const clean = String(v).replace(/^0x/i, "").replace(/^#/, "");
  return "#" + clean.padStart(6, "0").toLowerCase();
}
export function htmlToEspHex(v) {
  const clean = String(v).replace(/^#/, "").toUpperCase();
  return "0x" + clean;
}

export default function EditableRow({
  icon, label, id, value = "—",
  setOk = false, disabled = false,
  depDisabled = false, depMessage,
  failed = false, setFailed = false,
  inputType, options, allowCustom = false, readOnly = false,
  onSet, onRead, last = false,
  bulkEditing = false, bulkDraft = "", onBulkDraftChange,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [customMode, setCustomMode] = useState(false); // allowCustom dropdown'da "Yeni Ekle" tıklandı mı
  const colorRef = useRef(null);

  const startEdit = () => {
    if (disabled) return;
    const raw = value === "——" ? "" : (value ?? "");
    if (inputType === "dropdown" && options) {
      const found = options.find((o) => o.label === raw);
      setDraft(found ? found.value : raw);
    } else if (inputType === "color") {
      setDraft(raw);
    } else {
      setDraft(raw);
    }
    setEditing(true);
  };

  const save = () => {
    if (inputType === "phone" && draft && !/^[0-9+\-() ]{7,20}$/.test(draft)) return;
    onSet?.(id, draft);
    setEditing(false);
    setDraft("");
    setCustomMode(false);
  };

  const read = () => {
    onRead?.(id);
    setEditing(false);
    setDraft("");
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
    setCustomMode(false);
  };

  /* ── Input Render ── */
  const renderInput = (val, onChange, isBulk = false) => {
    const fire = (v) => {
      if (isBulk) onChange(id, v, true);
      else onChange(null, v, false);
    };

    if (inputType === "dropdown" && options) {
      // allowCustom destekli dropdown — listede olmayan değer girilebilir
      if (allowCustom) {
        // Değer listede mi? VEYA kullanıcı "Yeni Ekle"ye basıp custom mode'a girdi mi?
        const valInList = val && options.some((o) => o.value === val);
        const showCustomInput = customMode || (val && !valInList);
        const selectVal = showCustomInput ? "__custom__" : (val || "");
        return (
          <div className="flex flex-col gap-1 w-full max-w-[180px]">
            <select
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]
                         px-2 py-1 rounded-md text-[13px] outline-none
                         focus:border-sky-500/60 transition cursor-pointer"
              value={selectVal}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") {
                  setCustomMode(true);
                  fire("");
                } else {
                  setCustomMode(false);
                  fire(v);
                }
              }}
            >
              <option value="" className="bg-[var(--bg-surface)]">Seçiniz…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value} className="bg-[var(--bg-surface)]">{o.label}</option>
              ))}
              <option value="__custom__" className="bg-[var(--bg-surface)]">+ Yeni Ekle</option>
            </select>
            {showCustomInput && (
              <input
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]
                           px-2 py-1 rounded-md text-[12px] outline-none
                           focus:border-sky-500/60 transition font-mono"
                value={val}
                onChange={(e) => fire(e.target.value)}
                placeholder="Yeni logo adı girin…"
                autoFocus={!isBulk}
              />
            )}
          </div>
        );
      }
      return (
        <select
          className="w-full max-w-[180px] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]
                     px-2 py-1 rounded-md text-[13px] outline-none
                     focus:border-sky-500/60 transition cursor-pointer"
          value={val}
          onChange={(e) => fire(e.target.value)}
        >
          <option value="" className="bg-[var(--bg-surface)]">Seçiniz…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-[var(--bg-surface)]">{o.label}</option>
          ))}
        </select>
      );
    }

    if (inputType === "color") {
      const htmlColor = espHexToHtml(val);
      return (
        <div className="flex items-center gap-2 max-w-[180px]">
          {/* Renk önizleme kutusu — tıklanınca picker açılır */}
          <button
            type="button"
            onClick={() => colorRef.current?.click()}
            className="w-7 h-7 rounded-md border border-[var(--border-strong)] shrink-0 cursor-pointer transition hover:scale-105"
            style={{ backgroundColor: htmlColor }}
            title={htmlColor}
          />
          {/* Gizli native color picker */}
          <input
            ref={colorRef}
            type="color"
            className="sr-only"
            value={htmlColor}
            onChange={(e) => fire(htmlToEspHex(e.target.value))}
          />
          {/* Hex kodu göster */}
          <span className="text-[12px] text-[var(--text-secondary)] font-mono">
            {val || "—"}
          </span>
        </div>
      );
    }

    if (inputType === "phone") {
      return (
        <input
          className="w-full max-w-[180px] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]
                     px-2.5 py-1 rounded-md text-[13px] outline-none
                     focus:border-sky-500/60 transition"
          type="tel"
          value={val}
          onChange={(e) => fire(e.target.value.replace(/[^0-9+\-() ]/g, ""))}
          placeholder="05XX XXX XX XX"
          autoFocus={!isBulk}
          onKeyDown={!isBulk ? (e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          } : undefined}
        />
      );
    }

    return (
      <input
        className="w-full max-w-[180px] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]
                   px-2.5 py-1 rounded-md text-[13px] outline-none
                   focus:border-sky-500/60 transition"
        value={val}
        onChange={(e) => fire(e.target.value)}
        placeholder="Değer girin"
        autoFocus={!isBulk}
        onKeyDown={!isBulk ? (e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        } : undefined}
      />
    );
  };

  const handleChange = (idOrNull, val, isBulk) => {
    if (isBulk) onBulkDraftChange?.(idOrNull, val);
    else setDraft(val);
  };

  /* ── Renk önizleme (normal modda) ── */
  const colorPreview = inputType === "color" && value && value !== "——" && value !== "—" ? (
    <span
      className="w-4 h-4 rounded-[3px] border border-[var(--border-strong)] shrink-0 inline-block"
      style={{ backgroundColor: espHexToHtml(value) }}
    />
  ) : null;

  return (
    <div className={`flex items-center justify-between gap-2 py-2.5 min-h-[50px] ${!last ? "border-b border-[var(--border-subtle)]" : ""}`}>
      <div className="flex items-center gap-2 shrink-0">
        {icon && <span className="text-[14px] text-[var(--text-muted)]">{icon}</span>}
        <span className={`text-[14px] font-medium ${depDisabled ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}`}>{label}</span>
        {failed && (
          <span className="flex items-center gap-1 text-[11px] text-amber-500 font-medium">
            <HiOutlineExclamationCircle className="text-[12px]" />
            okunamadı
          </span>
        )}
        {setFailed && (
          <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
            <HiOutlineExclamationCircle className="text-[12px]" />
            kaydedilemedi
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
        {depDisabled && !bulkEditing ? (
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] italic">
            <span className="text-red-500 text-[11px] font-bold">*</span>
            {depMessage || "Bu alana değer girilememektedir"}
          </span>
        ) : bulkEditing ? (
          renderInput(bulkDraft, handleChange, true)
        ) : !editing ? (
          <>
            {colorPreview}
            <span className="text-[14px] text-[var(--text-primary)] font-semibold break-all">
              {value || "—"}
            </span>
            {setOk && <span className="text-emerald-500 text-[11px] font-bold">✓</span>}
            <button
              onClick={() => onRead?.(id)}
              disabled={disabled}
              title="Güncel değeri oku"
              className={`p-1.5 rounded-lg border transition shrink-0
                ${disabled
                  ? "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                  : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
                }`}
            >
              <HiOutlineArrowPath className="text-[13px]" />
            </button>
            {!readOnly && (
              <button
                onClick={startEdit}
                disabled={disabled}
                className={`flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition shrink-0
                  ${disabled
                    ? "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer"
                  }`}
              >
                <HiOutlinePencilSquare className="text-[12px]" />
                Düzenle
              </button>
            )}
          </>
        ) : (
          <>
            {renderInput(draft, handleChange, false)}
            <button onClick={read} disabled={disabled}
              title="Güncel değeri oku"
              className={`p-1.5 rounded-lg border transition shrink-0
                ${disabled
                  ? "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                  : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
                }`}>
              <HiOutlineArrowPath className="text-[13px]" />
            </button>
            <button onClick={cancel}
              className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg
                         bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]
                         hover:text-[var(--text-primary)] transition cursor-pointer shrink-0">
              ✕
            </button>
            <button onClick={save} disabled={disabled}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition shrink-0
                ${disabled
                  ? "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                  : "bg-[var(--accent)] text-white border-[var(--accent)] hover:brightness-110 cursor-pointer"
                }`}>
              Kaydet
            </button>
          </>
        )}
      </div>
    </div>
  );
}