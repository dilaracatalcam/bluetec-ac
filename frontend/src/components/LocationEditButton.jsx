import { useState } from "react";
import { HiOutlinePencilSquare } from "react-icons/hi2";

/* ── Bağlı cihazın konumunu üst çubuktan düzenleme ──
   Cihaz adının yanındaki kalem; açılan küçük formda konum adı ve koordinatlar.
   Sunucu ucu Cihaz Seç'teki "Konumu düzenle" ile aynı: PUT /api/devices/:id/location
   — kullanıcı yalnızca kendi yetkisindeki cihazın konumunu değiştirebilir. */

const input = "mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

export default function LocationEditButton({ device, authFetch, onSaved, align = "left" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ location: "", latitude: "", longitude: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  if (!device?.id) return null;

  const start = () => {
    setForm({
      location: device.location || "",
      latitude: device.latitude ?? "",
      longitude: device.longitude ?? "",
    });
    setMsg("");
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const r = await authFetch(`/api/devices/${encodeURIComponent(device.id)}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || "Konum güncellenemedi."); return; }
      onSaved?.(d.device || { ...device, ...form });
      setOpen(false);
    } catch {
      setMsg("Sunucuya ulaşılamadı.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button type="button" onClick={() => (open ? setOpen(false) : start())} title="Konumu düzenle" aria-label="Konumu düzenle"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition">
        <HiOutlinePencilSquare className="text-[14px]" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Kapat" onClick={() => setOpen(false)} className="fixed inset-0 z-30 cursor-default" />
          <form onSubmit={save}
            className={`absolute top-full mt-2 z-40 w-[300px] max-w-[calc(100vw-32px)] ${align === "right" ? "right-0" : "left-0"}
                        rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl p-3 flex flex-col gap-2 text-left`}>
            <div className="text-[12px] font-bold text-[var(--text-primary)]">Cihaz konumu</div>
            <label className="text-[11px] font-semibold text-[var(--text-muted)]">
              Konum adı
              <input autoFocus value={form.location} maxLength={160} placeholder="İstanbul Merkez" className={input}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                Enlem
                <input value={form.latitude} placeholder="41.0422" inputMode="decimal" className={`${input} font-mono`}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} />
              </label>
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                Boylam
                <input value={form.longitude} placeholder="29.0010" inputMode="decimal" className={`${input} font-mono`}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} />
              </label>
            </div>
            {msg && <div className="text-[11px] text-rose-500">{msg}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                Vazgeç
              </button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-bold text-white hover:brightness-110 disabled:opacity-50">
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        </>
      )}
    </span>
  );
}
